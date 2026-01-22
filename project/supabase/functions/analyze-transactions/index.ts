import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 10; // 10 analysis requests per hour per user

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
  
  if (userLimit.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((userLimit.resetTime - now) / 1000);
    return { allowed: false, retryAfter };
  }
  
  userLimit.count++;
  return { allowed: true };
}

// Vendor countries that trigger MEDIUM risk (strict rule list)
const MEDIUM_RISK_COUNTRIES = ["PANAMA", "UAE"];

interface Transaction {
  id: string;
  transaction_id: string;
  transaction_date: string;
  amount: number;
  vendor_name: string;
  vendor_country: string;
  payment_method: string;
  department: string;
  description: string;
}

interface RiskFactor {
  type: string;
  description: string;
  severity: "HIGH" | "MEDIUM";
}

interface RiskResult {
  level: "low" | "medium" | "high";
  factors: RiskFactor[];
  score: number;
  why: string;
}

// Build duplicate groups at dataset level FIRST
// Key: "VENDOR|DATE|AMOUNT" -> array of transaction IDs in that group
function buildDuplicateGroups(transactions: Transaction[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  
  for (const tx of transactions) {
    const vendor = (tx.vendor_name ?? "").trim().toUpperCase();
    const date = tx.transaction_date;
    const amount = Math.round((Number(tx.amount) || 0) * 100); // cents for precision
    
    if (!vendor) continue; // Skip if no vendor
    
    const key = `${vendor}|${date}|${amount}`;
    const existing = groups.get(key) || [];
    existing.push(tx.id);
    groups.set(key, existing);
  }
  
  return groups;
}

// Check if a transaction is part of a duplicate group (group size > 1)
function isDuplicate(txId: string, duplicateGroups: Map<string, string[]>): { isDup: boolean; count: number } {
  for (const [, ids] of duplicateGroups) {
    if (ids.includes(txId) && ids.length > 1) {
      return { isDup: true, count: ids.length };
    }
  }
  return { isDup: false, count: 0 };
}

function analyzeTransaction(
  transaction: Transaction, 
  allTransactions: Transaction[],
  duplicateGroups: Map<string, string[]>
): RiskResult {
  // Normalize values for comparison
  const vendorNameRaw = transaction.vendor_name ?? "";
  const vendorName = vendorNameRaw.trim().toUpperCase();
  const txDate = transaction.transaction_date;
  const amount = Number(transaction.amount) || 0;
  const amountK = Math.round(amount / 1000);

  let vendorCountry = (transaction.vendor_country ?? "").trim().toUpperCase();
  if (vendorCountry === "UNITED ARAB EMIRATES") vendorCountry = "UAE";

  // ============================================================
  // STRICT EVALUATION ORDER - Early exit when HIGH is triggered
  // ============================================================

  // RULE 1: Duplicate Transaction Rule (HIGH) - EVALUATE FIRST
  const { isDup, count } = isDuplicate(transaction.id, duplicateGroups);
  if (isDup) {
    // HIGH triggered - STOP further evaluation
    return {
      level: "high",
      score: 90,
      why: `Rule 1 triggered: Duplicate transaction (${count} occurrences)`,
      factors: [{
        type: "duplicate_transaction",
        description: `DUPLICATE TRANSACTION (Rule 1): Same vendor, amount, and date occurs ${count} times`,
        severity: "HIGH",
      }],
    };
  }

  // RULE 2: High-Value Transaction Rule
  if (amount > 1000000) {
    // HIGH triggered - STOP further evaluation
    return {
      level: "high",
      score: 85,
      why: `Rule 2 triggered: Amount > 1,000,000`,
      factors: [{
        type: "high_value_transaction",
        description: `HIGH-VALUE TRANSACTION (Rule 2): Amount ₹${amount.toLocaleString()} exceeds ₹1,000,000`,
        severity: "HIGH",
      }],
    };
  }
  
  if (amount >= 500000 && amount <= 1000000) {
    // MEDIUM triggered
    return {
      level: "medium",
      score: 60,
      why: `Rule 2 triggered: Amount between 500,000 and 1,000,000`,
      factors: [{
        type: "high_value_transaction",
        description: `HIGH-VALUE TRANSACTION (Rule 2): Amount ₹${amount.toLocaleString()} is between ₹500,000 and ₹1,000,000`,
        severity: "MEDIUM",
      }],
    };
  }

  // RULE 3: Vendor Risk Rule (MEDIUM)
  if (vendorCountry && MEDIUM_RISK_COUNTRIES.includes(vendorCountry)) {
    return {
      level: "medium",
      score: 50,
      why: `Rule 3 triggered: Vendor country is ${vendorCountry}`,
      factors: [{
        type: "vendor_country_risk",
        description: `VENDOR COUNTRY RISK (Rule 3): Vendor country is ${vendorCountry}`,
        severity: "MEDIUM",
      }],
    };
  }

  // RULE 4: Frequency Rule (MEDIUM)
  if (vendorName) {
    const sameVendorSameDateCount = allTransactions.filter((t) => {
      const otherVendor = (t.vendor_name ?? "").trim().toUpperCase();
      const otherDate = t.transaction_date;
      return otherVendor === vendorName && otherDate === txDate;
    }).length;

    if (sameVendorSameDateCount > 1) {
      return {
        level: "medium",
        score: 45,
        why: `Rule 4 triggered: ${sameVendorSameDateCount} payments to same vendor on same date`,
        factors: [{
          type: "frequency_risk",
          description: `FREQUENCY RISK (Rule 4): ${sameVendorSameDateCount} payments to the same vendor on the same date`,
          severity: "MEDIUM",
        }],
      };
    }
  }

  // NO RULE TRIGGERED - Assign LOW
  return {
    level: "low",
    score: 0,
    why: "No rule triggered",
    factors: [],
  };
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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error("Supabase configuration missing");
      throw new Error("Service configuration error");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      throw new Error("Service configuration error");
    }

    const { transactions, sessionId } = await req.json();

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      throw new Error("No transactions provided");
    }

    console.log(`Analyzing ${transactions.length} transactions for session ${sessionId}`);

    // STEP 1: Build duplicate groups at DATASET level BEFORE row-level analysis
    // This ensures ALL rows in a duplicate group are flagged consistently
    const duplicateGroups = buildDuplicateGroups(transactions);
    console.log(`Found ${[...duplicateGroups.values()].filter(g => g.length > 1).length} duplicate groups`);

    // STEP 2: Calculate risk scores for all transactions using strict audit rules
    const assessments = transactions.map((tx: Transaction) => {
      const { level, factors, score, why } = analyzeTransaction(tx, transactions, duplicateGroups);
      return {
        transaction_id: tx.id,
        risk_score: score,
        risk_level: level,
        risk_factors: factors,
        // Rule-based explanation (do not override with AI)
        risk_reason: why,
        // Include triggered rules summary
        triggered_rules: factors.map((f) => f.type).join(", ") || "None",
      };
    });

    // Filter high and medium risk transactions for AI explanation
    const flaggedTransactions = assessments.filter(a => a.risk_level !== "low");

    if (flaggedTransactions.length === 0) {
      // No flagged transactions, return basic assessments
      return new Response(JSON.stringify({ assessments }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prepare transactions for AI explanation
    const txDetails = flaggedTransactions.map(a => {
      const tx = transactions.find((t: Transaction) => t.id === a.transaction_id);
      return {
        ...a,
        transaction: tx
      };
    });

    // Call AI for audit-ready explanations with professional audit behavior rules
    const aiPrompt = `You are a senior internal auditor at a Big 4 accounting firm acting as a professional audit assistant.

CRITICAL BEHAVIOR RULES:
1. NEVER use speculative language (avoid "might", "could", "possibly", "perhaps")
2. ALWAYS justify every conclusion with specific evidence from the data
3. If data is insufficient for a definitive conclusion, explicitly state: "Insufficient data to determine [X]. Additional documentation required."
4. Prioritize EXPLAINABILITY - every finding must be traceable to specific data points
5. Use professional, factual language suitable for formal audit documentation
6. Be precise with numbers and percentages
7. Focus on WHAT was observed, WHY it matters, and WHAT action is needed

For each transaction, provide:
1. "audit_observation" - A factual 1-2 sentence finding based ONLY on available evidence
2. "risk_reason" - Specific, evidence-based explanation citing the exact risk factors detected
3. "suggested_action" - Concrete, actionable next step (e.g., "Request supporting invoice documentation from vendor")

Transactions to analyze:
${JSON.stringify(txDetails, null, 2)}

Respond with a JSON array matching this structure:
[
  {
    "transaction_id": "uuid",
    "audit_observation": "string",
    "risk_reason": "string", 
    "suggested_action": "string"
  }
]`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
- Act with professional skepticism but avoid speculation
- Every statement must be evidence-based and justifiable
- When data is limited, clearly state the limitation rather than guessing
- Use precise, professional audit terminology
- Ensure all findings are explainable to both technical and non-technical stakeholders

Always respond with valid JSON only, no markdown formatting.` 
          },
          { role: "user", content: aiPrompt }
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ 
          error: "Rate limit exceeded. Please try again in a moment.",
          assessments 
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ 
          error: "AI credits exhausted. Please add credits to continue.",
          assessments 
        }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Return assessments without AI explanations if AI fails
      return new Response(JSON.stringify({ assessments }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content;

    if (aiContent) {
      try {
        // Clean up potential markdown formatting
        const cleanContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const aiExplanations = JSON.parse(cleanContent);

        // Merge AI explanations with assessments (keep risk_reason strictly rule-based)
        for (const explanation of aiExplanations) {
          const assessment = assessments.find((a) => a.transaction_id === explanation.transaction_id);
          if (assessment) {
            Object.assign(assessment, {
              audit_observation: explanation.audit_observation,
              suggested_action: explanation.suggested_action,
            });
          }
        }
      } catch (parseError) {
        console.error("Failed to parse AI response:", parseError);
        // Continue with assessments without AI explanations
      }
    }

    return new Response(JSON.stringify({ assessments }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Analysis error:", error);
    // Return generic error message to avoid exposing internal details
    const userSafeErrors = ["No transactions provided"];
    const safeMessage = error instanceof Error && 
      userSafeErrors.some(msg => error.message.includes(msg))
      ? error.message 
      : "Analysis failed. Please try again.";
    return new Response(JSON.stringify({ 
      error: safeMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});