import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_REPORTS_PER_WINDOW = 20; // 20 reports per day per user

// In-memory rate limit store (resets on function cold start)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const userLimit = rateLimitStore.get(userId);
  
  if (!userLimit || now >= userLimit.resetTime) {
    // Reset or initialize the window
    rateLimitStore.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  
  if (userLimit.count >= MAX_REPORTS_PER_WINDOW) {
    const retryAfter = Math.ceil((userLimit.resetTime - now) / 1000);
    return { allowed: false, retryAfter };
  }
  
  userLimit.count++;
  return { allowed: true };
}

interface SessionStats {
  totalTransactions: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  topVendors: { name: string; count: number; totalAmount: number }[];
  topRiskFactors: { type: string; count: number }[];
  departmentBreakdown: { department: string; count: number; riskScore: number }[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing or invalid authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      throw new Error("Service configuration error");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Supabase configuration missing");
      throw new Error("Service configuration error");
    }

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    
    // Create client with user's auth for validation
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claimsData.claims.sub as string;
    console.log(`Authenticated user: ${userId}`);

    // Check rate limit
    const rateLimitResult = checkRateLimit(userId);
    if (!rateLimitResult.allowed) {
      return new Response(
        JSON.stringify({ 
          error: "Rate limit exceeded. Please try again later.",
          retry_after: rateLimitResult.retryAfter 
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "Retry-After": String(rateLimitResult.retryAfter)
          } 
        }
      );
    }

    // Use admin client for database operations
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { sessionId } = await req.json() as { sessionId: string };

    if (!sessionId) {
      throw new Error("Session ID is required");
    }

    // Fetch session data and verify ownership
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("analysis_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single();

    if (sessionError || !session) {
      throw new Error("Session not found or access denied");
    }

    // Fetch transactions for this session
    const { data: transactions, error: txError } = await supabaseAdmin
      .from("transactions")
      .select("*")
      .eq("session_id", sessionId);

    if (txError) {
      throw new Error("Failed to fetch transactions");
    }

    const fileName = session.file_name || "Unknown";
    const analysisDate = new Date(session.created_at).toLocaleDateString();

    // Fetch risk assessments for this session (transactions table doesn't store risk_level)
    const txIds = (transactions || []).map((t: any) => t.id);

    const { data: riskAssessments, error: raError } = await supabaseAdmin
      .from("risk_assessments")
      .select("transaction_id, risk_level, risk_score, risk_factors")
      .in("transaction_id", txIds);

    if (raError) {
      throw new Error("Failed to fetch risk assessments");
    }

    const raByTxId = new Map<string, any>();
    (riskAssessments || []).forEach((ra: any) => raByTxId.set(ra.transaction_id, ra));

    // Calculate session stats
    const totalTransactions = (transactions || []).length;
    const highRiskCount = (riskAssessments || []).filter((ra: any) => ra.risk_level === "high").length;
    const mediumRiskCount = (riskAssessments || []).filter((ra: any) => ra.risk_level === "medium").length;
    const lowRiskCount = (riskAssessments || []).filter((ra: any) => ra.risk_level === "low").length;

    // Build vendor stats - use vendor_name column (Vendor_Name supported at upload)
    const vendorMap = new Map<string, { count: number; totalAmount: number }>();
    (transactions || []).forEach((t: any) => {
      const vendor = t.vendor_name?.trim() || "Unidentified";
      const existing = vendorMap.get(vendor) || { count: 0, totalAmount: 0 };
      vendorMap.set(vendor, {
        count: existing.count + 1,
        totalAmount: existing.totalAmount + (t.amount || 0),
      });
    });
    const topVendors = Array.from(vendorMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 5);

    // Build risk factor stats (risk_factors is an array of objects)
    const riskFactorMap = new Map<string, number>();
    (riskAssessments || []).forEach((ra: any) => {
      const factors = Array.isArray(ra.risk_factors) ? ra.risk_factors : [];
      factors.forEach((factor: any) => {
        const key = factor?.type ? String(factor.type) : "unknown";
        riskFactorMap.set(key, (riskFactorMap.get(key) || 0) + 1);
      });
    });
    const topRiskFactors = Array.from(riskFactorMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Build department breakdown (average risk_score per department)
    const deptMap = new Map<string, { count: number; totalScore: number }>();
    (transactions || []).forEach((t: any) => {
      const dept = t.department || "Unknown";
      const ra = raByTxId.get(t.id);
      const score = ra?.risk_score ?? 0;
      const existing = deptMap.get(dept) || { count: 0, totalScore: 0 };
      deptMap.set(dept, {
        count: existing.count + 1,
        totalScore: existing.totalScore + score,
      });
    });
    const departmentBreakdown = Array.from(deptMap.entries())
      .map(([department, data]) => ({
        department,
        count: data.count,
        riskScore: data.totalScore / data.count,
      }))
      .sort((a, b) => b.riskScore - a.riskScore);

    const sessionStats: SessionStats = {
      totalTransactions,
      highRiskCount,
      mediumRiskCount,
      lowRiskCount,
      topVendors,
      topRiskFactors,
      departmentBreakdown,
    };

    const prompt = `You are a senior internal auditor at a Big 4 consulting firm acting as a professional audit assistant.

CRITICAL BEHAVIOR RULES:
1. ALL statistics below are EXACT COUNTS derived from the final classified transaction table - DO NOT infer, estimate, or round these numbers
2. Use ONLY the exact figures provided - never approximate or use phrases like "approximately", "around", "nearly"
3. NEVER use speculative language - avoid words like "might", "could", "possibly", "may indicate"
4. Every numerical statement must match the exact counts provided below
5. Reference SPECIFIC RISK RULES that triggered findings:
   - Rule 1 (DUPLICATE TRANSACTION): Same vendor, same amount, same date occurring more than once → HIGH risk
   - Rule 2 (HIGH-VALUE TRANSACTION): Amount > ₹1,000,000 → HIGH risk; ₹500,000-₹1,000,000 → MEDIUM risk
   - Rule 3 (VENDOR COUNTRY RISK): Vendors from Panama or UAE → MEDIUM risk
   - Rule 4 (FREQUENCY RISK): Multiple payments to same vendor on same date → MEDIUM risk
6. Focus on CONTROL WEAKNESSES implied by the findings (e.g., payment authorization, vendor monitoring)

EXAMPLE EXECUTIVE SUMMARY STYLE:
"The analysis of ${sessionStats.totalTransactions} transactions identified ${sessionStats.highRiskCount} high-risk and ${sessionStats.mediumRiskCount} medium-risk transactions. High-risk flags were triggered by [specific Rule 1/2 conditions]. Medium-risk flags were triggered by [specific Rule 2/3/4 conditions]. These findings indicate potential control weaknesses in payment authorization and vendor monitoring processes."

DATA LIMITATIONS:
- Analysis is based on exactly ${sessionStats.totalTransactions} transactions from file: ${fileName}
- Risk levels are assigned using predefined audit rules, not historical baselines
- Further investigation may be required to confirm initial findings

FILE ANALYZED: ${fileName}
ANALYSIS DATE: ${analysisDate}

===== EXACT STATISTICS FROM CLASSIFIED TABLE (DO NOT MODIFY) =====
Total Transactions: ${sessionStats.totalTransactions}
High Risk Count: ${sessionStats.highRiskCount} (${((sessionStats.highRiskCount / sessionStats.totalTransactions) * 100).toFixed(1)}%)
Medium Risk Count: ${sessionStats.mediumRiskCount} (${((sessionStats.mediumRiskCount / sessionStats.totalTransactions) * 100).toFixed(1)}%)
Low Risk Count: ${sessionStats.lowRiskCount} (${((sessionStats.lowRiskCount / sessionStats.totalTransactions) * 100).toFixed(1)}%)

RISK FACTORS (exact counts from rule triggers):
${sessionStats.topRiskFactors.map(f => `- ${f.type}: ${f.count} occurrences`).join('\n')}

VENDOR ANALYSIS (exact from transaction table):
${sessionStats.topVendors.map(v => `- ${v.name}: ${v.count} transactions, ₹${v.totalAmount.toLocaleString()} total`).join('\n')}

DEPARTMENT BREAKDOWN (exact from transaction table):
${sessionStats.departmentBreakdown.map(d => `- ${d.department}: ${d.count} transactions, avg risk score ${d.riskScore.toFixed(0)}`).join('\n')}
================================================================

Generate a professional audit report with these EXACT sections:
1. "executive_summary" - 2-3 paragraphs using ONLY the exact statistics above. State which specific rules triggered the high/medium risk flags. Mention control weaknesses.
2. "risk_posture" - "Satisfactory", "Needs Improvement", or "Unsatisfactory" WITH justification citing specific rule violations and exact counts
3. "key_risk_themes" - Array of 3-5 themes based on the SPECIFIC RULES that triggered (duplicate_transaction, high_value_transaction, vendor_country_risk, frequency_risk)
4. "areas_of_attention" - Array of 3-5 items with "area", "priority" (High/Medium/Low), and actionable "recommendation" addressing control gaps

Respond with valid JSON only:
{
  "executive_summary": "string",
  "risk_posture": "string",
  "key_risk_themes": [{"title": "string", "description": "string"}],
  "areas_of_attention": [{"area": "string", "priority": "High|Medium|Low", "recommendation": "string"}]
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { 
            role: "system", 
            content: `You are an expert internal auditor functioning as a professional audit assistant.

CORE PRINCIPLES:
- Act as a trusted advisor providing factual, evidence-based insights
- Never speculate - every statement must be traceable to specific data
- Acknowledge data limitations explicitly rather than overstating conclusions
- Use professional audit terminology appropriate for executive audiences
- Ensure findings are SCALABLE and suitable for enterprise audit programs
- Prioritize clarity and explainability over complexity

Always respond with valid JSON only, no markdown formatting.` 
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ 
          error: "Rate limit exceeded. Please try again in a moment." 
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (response.status === 402) {
        return new Response(JSON.stringify({ 
          error: "AI credits exhausted. Please add credits to continue." 
        }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const errorText = await response.text();
      console.error("AI API error:", response.status, errorText);
      throw new Error("Failed to generate report");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content in AI response");
    }

    // Clean and parse the response
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const report = JSON.parse(cleanContent);

    // Calculate total amount
    const totalAmount = transactions.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

    // Save report to database
    const { error: insertError } = await supabaseAdmin
      .from("audit_reports")
      .insert({
        session_id: sessionId,
        user_id: session.user_id,
        title: `Audit Report - ${fileName}`,
        executive_summary: report.executive_summary,
        risk_posture: report.risk_posture,
        key_risk_themes: report.key_risk_themes,
        areas_of_attention: report.areas_of_attention,
        statistics: {
          total_transactions: totalTransactions,
          high_risk: highRiskCount,
          medium_risk: mediumRiskCount,
          low_risk: lowRiskCount,
          total_amount: totalAmount,
        },
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      throw new Error("Failed to save report");
    }

    return new Response(JSON.stringify({ report, success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Report generation error:", error);
    // Return generic error message to avoid exposing internal details
    const userSafeErrors = ["Session ID is required", "Session not found or access denied"];
    const safeMessage = error instanceof Error && 
      userSafeErrors.some(msg => error.message.includes(msg))
      ? error.message 
      : "Report generation failed. Please try again.";
    return new Response(JSON.stringify({ 
      error: safeMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});