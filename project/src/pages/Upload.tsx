import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload as UploadIcon, FileSpreadsheet, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

interface ParsedTransaction {
  transaction_id: string;
  transaction_date: string;
  amount: number;
  vendor_name: string;
  vendor_country: string;
  payment_method: string;
  department: string;
  description: string;
}

// Maximum file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;
// Maximum transactions per file
const MAX_TRANSACTIONS = 10000;
// Required columns for validation
const REQUIRED_COLUMNS = ["transaction_id", "transaction_date", "amount", "vendor_name"];
// Valid MIME types for uploads
const VALID_MIME_TYPES = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream', // Some browsers report this for xlsx
];

// Sanitize cell content to prevent formula injection
const sanitizeCell = (value: string): string => {
  if (!value || typeof value !== 'string') return value;
  // Formulas starting with =, +, -, @ can execute in Excel
  const dangerousPrefix = /^[=+\-@\t\r]/;
  if (dangerousPrefix.test(value)) {
    return "'" + value; // Prefix with single quote to treat as text
  }
  return value;
};

// Validate MIME type matches expected file types
const validateMimeType = (file: File): boolean => {
  // Some browsers don't report MIME type correctly, so we also check extension
  if (file.type && !VALID_MIME_TYPES.includes(file.type)) {
    return false;
  }
  return true;
};

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "analyzing" | "complete" | "error">("idle");
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File size exceeds maximum limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB`;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['csv', 'xlsx', 'xls'].includes(extension)) {
      return "Invalid file type. Only CSV and Excel files are accepted";
    }
    // Validate MIME type to prevent disguised malicious files
    if (!validateMimeType(file)) {
      return "File content type does not match expected format";
    }
    return null;
  };

  const validateTransactions = (transactions: ParsedTransaction[]): string | null => {
    if (transactions.length === 0) {
      return "No valid transactions found in file";
    }
    if (transactions.length > MAX_TRANSACTIONS) {
      return `File contains too many transactions. Maximum allowed: ${MAX_TRANSACTIONS}`;
    }
    // Check that required fields are present in at least one transaction
    const firstTx = transactions[0];
    for (const col of REQUIRED_COLUMNS) {
      const value = firstTx[col as keyof ParsedTransaction];
      if (value === undefined || value === null || String(value).trim() === '') {
        return `Missing required column: ${col}`;
      }
    }
    // Validate individual transactions
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      if (typeof tx.amount !== 'number' || !Number.isFinite(tx.amount) || tx.amount < 0) {
        return `Invalid amount in row ${i + 1}`;
      }
      if (!tx.transaction_date || !/^\d{4}-\d{2}-\d{2}$/.test(tx.transaction_date)) {
        return `Invalid date format in row ${i + 1}. Expected YYYY-MM-DD`;
      }
      // Sanitize text fields to prevent injection
      if (tx.vendor_name && tx.vendor_name.length > 500) {
        return `Vendor name too long in row ${i + 1}. Maximum 500 characters`;
      }
      if (tx.description && tx.description.length > 2000) {
        return `Description too long in row ${i + 1}. Maximum 2000 characters`;
      }
    }
    return null;
  };

  const parseFile = async (file: File): Promise<ParsedTransaction[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: "binary" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(sheet);

          const pick = (row: any, keys: string[]) => {
            for (const k of keys) {
              const v = row?.[k];
              if (v !== undefined && v !== null && String(v).trim() !== "") return v;
            }
            return undefined;
          };

          const toText = (v: unknown) => {
            const text = v === undefined || v === null ? "" : String(v).trim();
            return sanitizeCell(text); // Sanitize to prevent formula injection
          };

          const toNumber = (v: unknown) => {
            const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
            return Number.isFinite(n) ? n : 0;
          };

          const toISODate = (v: unknown) => {
            // Handles: ISO strings, "MM/DD/YYYY", JS Date, and Excel serial numbers
            if (v instanceof Date && !Number.isNaN(v.getTime())) {
              return v.toISOString().split("T")[0];
            }

            if (typeof v === "number" && Number.isFinite(v)) {
              const parsed = XLSX.SSF.parse_date_code(v);
              if (parsed?.y && parsed?.m && parsed?.d) {
                const yyyy = String(parsed.y).padStart(4, "0");
                const mm = String(parsed.m).padStart(2, "0");
                const dd = String(parsed.d).padStart(2, "0");
                return `${yyyy}-${mm}-${dd}`;
              }
            }

            const s = toText(v);
            if (!s) return new Date().toISOString().split("T")[0];

            const d = new Date(s);
            if (!Number.isNaN(d.getTime())) return d.toISOString().split("T")[0];

            // Fallback: keep as-is
            return s;
          };

          const transactions: ParsedTransaction[] = jsonData.map((row: any) => ({
            transaction_id: toText(
              pick(row, [
                "Transaction ID",
                "Transaction_Id",
                "Transaction_ID",
                "transaction_id",
                "TXN",
                "Txn",
                "txn",
              ])
            ),
            transaction_date: toISODate(
              pick(row, [
                "Date",
                "Transaction Date",
                "Transaction_Date",
                "transaction_date",
              ])
            ),
            amount: toNumber(pick(row, ["Amount", "amount"])),
            // IMPORTANT: support Vendor_Name column (identified vendors)
            vendor_name: toText(
              pick(row, ["Vendor Name", "Vendor_Name", "vendor_name", "Vendor", "vendor"])
            ),
            vendor_country: toText(
              pick(row, ["Vendor Country", "Vendor_Country", "vendor_country", "Country", "country"])
            ),
            payment_method: toText(
              pick(row, ["Payment Method", "Payment_Method", "payment_method", "Method", "method"])
            ),
            department: toText(pick(row, ["Department", "department"])),
            description: toText(pick(row, ["Description", "description"])),
          }));

          resolve(transactions);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsBinaryString(file);
    });
  };

  const handleUpload = async () => {
    if (!file || !user) return;

    // Validate file before processing
    const fileError = validateFile(file);
    if (fileError) {
      toast({ title: "Validation Error", description: fileError, variant: "destructive" });
      return;
    }

    setUploading(true);
    setStatus("parsing");
    setProgress(10);

    try {
      const transactions = await parseFile(file);
      
      // Validate parsed transactions
      const validationError = validateTransactions(transactions);
      if (validationError) {
        throw new Error(validationError);
      }

      setStatus("uploading");
      setProgress(30);

      // Create analysis session
      const { data: session, error: sessionError } = await supabase
        .from("analysis_sessions")
        .insert({
          user_id: user.id,
          file_name: file.name,
          total_transactions: transactions.length,
          status: "processing",
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      // Insert transactions
      const txWithSession = transactions.map((tx) => ({
        ...tx,
        session_id: session.id,
      }));

      const { data: insertedTx, error: txError } = await supabase
        .from("transactions")
        .insert(txWithSession)
        .select();

      if (txError) throw txError;

      setProgress(50);
      setStatus("analyzing");

      // Call AI analysis
      const { data: analysisResult, error: analysisError } = await supabase.functions.invoke(
        "analyze-transactions",
        {
          body: { transactions: insertedTx, sessionId: session.id },
        }
      );

      if (analysisError) throw analysisError;

      setProgress(80);

      // Store risk assessments
      if (analysisResult?.assessments) {
        const { error: riskError } = await supabase.from("risk_assessments").insert(
          analysisResult.assessments.map((a: any) => ({
            transaction_id: a.transaction_id,
            risk_score: a.risk_score,
            risk_level: a.risk_level,
            risk_factors: a.risk_factors,
            audit_observation: a.audit_observation,
            risk_reason: a.risk_reason,
            suggested_action: a.suggested_action,
          }))
        );

        if (riskError) throw riskError;

        // Update session with counts
        const high = analysisResult.assessments.filter((a: any) => a.risk_level === "high").length;
        const medium = analysisResult.assessments.filter((a: any) => a.risk_level === "medium").length;
        const low = analysisResult.assessments.filter((a: any) => a.risk_level === "low").length;

        await supabase
          .from("analysis_sessions")
          .update({
            high_risk_count: high,
            medium_risk_count: medium,
            low_risk_count: low,
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", session.id);
      }

      setProgress(100);
      setStatus("complete");
      toast({ title: "Analysis Complete", description: `${transactions.length} transactions analyzed` });

      setTimeout(() => navigate("/transactions"), 1500);
    } catch (err: any) {
      console.error(err);
      setStatus("error");
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith(".csv") || droppedFile.name.endsWith(".xlsx"))) {
      setFile(droppedFile);
      setStatus("idle");
    }
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Upload Transactions</h2>
        <p className="text-muted-foreground">Upload CSV or Excel files for AI-powered risk analysis</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>File Upload</CardTitle>
          <CardDescription>
            Required columns: Transaction ID, Date, Amount, Vendor Name, Vendor Country, Payment Method, Department, Description
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              file ? "border-success bg-success/5" : "border-border hover:border-primary/50"
            }`}
          >
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileSpreadsheet className="h-8 w-8 text-success" />
                <div>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
            ) : (
              <div>
                <UploadIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium">Drop your file here or click to browse</p>
                <p className="text-sm text-muted-foreground mt-1">CSV or Excel files only</p>
              </div>
            )}
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => {
                if (e.target.files?.[0]) setFile(e.target.files[0]);
              }}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </div>

          {uploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="capitalize">{status}...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {status === "complete" && (
            <div className="flex items-center gap-2 text-success">
              <CheckCircle className="h-5 w-5" />
              <span>Analysis complete! Redirecting...</span>
            </div>
          )}

          {status === "error" && (
            <div className="flex items-center gap-2 text-danger">
              <AlertCircle className="h-5 w-5" />
              <span>An error occurred. Please try again.</span>
            </div>
          )}

          <Button onClick={handleUpload} disabled={!file || uploading} className="w-full">
            {uploading ? "Processing..." : "Analyze Transactions"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}