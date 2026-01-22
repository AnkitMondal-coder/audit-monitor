import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Download,
  Copy,
  RefreshCw,
  Calendar,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import type { Json } from "@/integrations/supabase/types";

interface KeyRiskTheme {
  theme: string;
  count: number;
}

interface AreaOfAttention {
  area: string;
  description: string;
}

interface Statistics {
  total_transactions: number;
  high_risk: number;
  medium_risk: number;
  low_risk: number;
  total_amount: number;
}

interface AuditReportRow {
  id: string;
  title: string;
  created_at: string;
  session_id: string;
  executive_summary: string | null;
  risk_posture: string | null;
  key_risk_themes: Json | null;
  areas_of_attention: Json | null;
  statistics: Json | null;
}

interface AuditReport {
  id: string;
  title: string;
  created_at: string;
  session_id: string;
  executive_summary: string | null;
  risk_posture: string | null;
  key_risk_themes: KeyRiskTheme[] | null;
  areas_of_attention: AreaOfAttention[] | null;
  statistics: Statistics | null;
}

interface AnalysisSession {
  id: string;
  file_name: string;
  created_at: string;
  status: string | null;
  total_transactions: number | null;
}

const Reports = () => {
  const { user } = useAuth();
  const [selectedSession, setSelectedSession] = useState<string>("");

  const { data: sessions } = useQuery({
    queryKey: ["analysis-sessions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_sessions")
        .select("*")
        .eq("user_id", user!.id)
        .eq("status", "completed")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as AnalysisSession[];
    },
    enabled: !!user,
  });

  const { data: reports, isLoading: reportsLoading, refetch: refetchReports } = useQuery({
    queryKey: ["audit-reports", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_reports")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      // Transform the Json types to proper typed objects
      return (data || []).map((row: AuditReportRow): AuditReport => ({
        id: row.id,
        title: row.title,
        created_at: row.created_at,
        session_id: row.session_id,
        executive_summary: row.executive_summary,
        risk_posture: row.risk_posture,
        key_risk_themes: row.key_risk_themes as unknown as KeyRiskTheme[] | null,
        areas_of_attention: row.areas_of_attention as unknown as AreaOfAttention[] | null,
        statistics: row.statistics as unknown as Statistics | null,
      }));
    },
    enabled: !!user,
  });

  const generateReportMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.functions.invoke("generate-audit-report", {
        body: { sessionId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Report generated successfully");
      refetchReports();
    },
    onError: (error) => {
      console.error("Report generation error:", error);
      toast.error("Failed to generate report");
    },
  });

  const copyToClipboard = (report: AuditReport) => {
    const content = formatReportAsText(report);
    navigator.clipboard.writeText(content);
    toast.success("Report copied to clipboard");
  };

  const downloadAsPdf = (report: AuditReport) => {
    // Create a simple text-based PDF content
    const content = formatReportAsText(report);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.title.replace(/\s+/g, "_")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Report downloaded");
  };

  const formatReportAsText = (report: AuditReport): string => {
    let text = `${report.title}\n${"=".repeat(50)}\n\n`;
    text += `Generated: ${format(new Date(report.created_at), "MMMM d, yyyy 'at' h:mm a")}\n\n`;

    if (report.executive_summary) {
      text += `EXECUTIVE SUMMARY\n${"-".repeat(30)}\n${report.executive_summary}\n\n`;
    }

    if (report.risk_posture) {
      text += `RISK POSTURE: ${report.risk_posture.toUpperCase()}\n\n`;
    }

    if (report.statistics) {
      text += `STATISTICS\n${"-".repeat(30)}\n`;
      text += `Total Transactions: ${report.statistics.total_transactions}\n`;
      text += `High Risk: ${report.statistics.high_risk}\n`;
      text += `Medium Risk: ${report.statistics.medium_risk}\n`;
      text += `Low Risk: ${report.statistics.low_risk}\n`;
      text += `Total Amount: ₹${report.statistics.total_amount.toLocaleString()}\n\n`;
    }

    if (report.key_risk_themes && report.key_risk_themes.length > 0) {
      text += `KEY RISK THEMES\n${"-".repeat(30)}\n`;
      report.key_risk_themes.forEach((theme, i) => {
        text += `${i + 1}. ${theme.theme} (${theme.count} occurrences)\n`;
      });
      text += "\n";
    }

    if (report.areas_of_attention && report.areas_of_attention.length > 0) {
      text += `AREAS REQUIRING ATTENTION\n${"-".repeat(30)}\n`;
      report.areas_of_attention.forEach((area, i) => {
        text += `${i + 1}. ${area.area}\n   ${area.description}\n\n`;
      });
    }

    return text;
  };

  const getRiskPostureBadge = (posture: string | null) => {
    if (!posture) return null;

    const colors: Record<string, string> = {
      low: "text-green-700",
      moderate: "text-yellow-700",
      high: "text-red-700",
      elevated: "text-orange-700",
    };

    return (
      <span className={`font-semibold ${colors[posture.toLowerCase()] || "text-muted-foreground"}`}>
        {posture}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Audit Reports</h1>
        <p className="text-muted-foreground mt-1">
          Generate and view comprehensive audit summary reports
        </p>
      </div>

      {/* Generate New Report */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Generate New Report
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[250px]">
              <label className="text-sm font-medium mb-2 block">
                Select Analysis Session
              </label>
              <Select value={selectedSession} onValueChange={setSelectedSession}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a completed analysis..." />
                </SelectTrigger>
                <SelectContent>
                  {sessions?.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      {session.file_name} ({session.total_transactions} transactions)
                    </SelectItem>
                  ))
                  }
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => generateReportMutation.mutate(selectedSession)}
              disabled={!selectedSession || generateReportMutation.isPending}
            >
              {generateReportMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Generate Report
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Existing Reports */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Generated Reports</h2>

        {reportsLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : reports && reports.length > 0 ? (
          <div className="space-y-6">
            {reports.map((report) => (
              <Card key={report.id}>
                <CardHeader className="pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="space-y-1">
                      <CardTitle className="text-lg sm:text-xl break-words">{report.title}</CardTitle>
                      <p className="text-xs sm:text-sm text-muted-foreground flex items-center gap-2">
                        <Calendar className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                        {format(new Date(report.created_at), "MMMM d, yyyy 'at' h:mm a")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {getRiskPostureBadge(report.risk_posture)}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(report)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadAsPdf(report)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6 pt-0">
                  {/* Statistics */}
                  {report.statistics && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                      <div className="bg-muted/50 rounded-lg p-3 sm:p-4 text-center">
                        <p className="text-lg sm:text-2xl font-bold">
                          {report.statistics.total_transactions}
                        </p>
                        <p className="text-xs sm:text-sm text-muted-foreground">Total Transactions</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-3 sm:p-4 text-center">
                        <p className="text-lg sm:text-2xl font-bold text-red-700">
                          {report.statistics.high_risk}
                        </p>
                        <p className="text-xs sm:text-sm text-red-600">High Risk</p>
                      </div>
                      <div className="bg-yellow-50 rounded-lg p-3 sm:p-4 text-center">
                        <p className="text-lg sm:text-2xl font-bold text-yellow-700">
                          {report.statistics.medium_risk}
                        </p>
                        <p className="text-xs sm:text-sm text-yellow-600">Medium Risk</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 sm:p-4 text-center">
                        <p className="text-lg sm:text-2xl font-bold text-green-700">
                          {report.statistics.low_risk}
                        </p>
                        <p className="text-xs sm:text-sm text-green-600">Low Risk</p>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3 sm:p-4 text-center col-span-2 sm:col-span-1">
                        <p className="text-lg sm:text-2xl font-bold text-foreground">
                          ₹{(report.statistics.total_amount / 1000).toFixed(0)}K
                        </p>
                        <p className="text-xs sm:text-sm text-muted-foreground">Total Amount</p>
                      </div>
                    </div>
                  )}

                  {/* Executive Summary */}
                  {report.executive_summary && (
                    <div>
                      <h3 className="font-semibold mb-2 flex items-center gap-2 text-sm sm:text-base">
                        <TrendingUp className="h-4 w-4 flex-shrink-0" />
                        Executive Summary
                      </h3>
                      <p className="text-foreground text-sm sm:text-base leading-relaxed bg-transparent !bg-transparent rounded-none cursor-default hover:bg-transparent">
                        {report.executive_summary}
                      </p>
                    </div>
                  )}

                  {/* Key Risk Themes */}
                  {report.key_risk_themes && report.key_risk_themes.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm sm:text-base">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                        Key Risk Themes
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {report.key_risk_themes.map((theme, index) => (
                          <Badge key={index} variant="secondary" className="text-xs sm:text-sm hover:bg-secondary cursor-default">
                            {theme.theme} ({theme.count})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Areas of Attention */}
                  {report.areas_of_attention && report.areas_of_attention.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm sm:text-base">
                        <CheckCircle className="h-4 w-4 flex-shrink-0" />
                        Areas Requiring Attention
                      </h3>
                      <div className="space-y-4">
                        {report.areas_of_attention.map((area, index) => (
                          <div key={index}>
                            <p className="font-semibold text-sm sm:text-base text-foreground static-text">{area.area}</p>
                            <p className="text-sm sm:text-base text-foreground mt-1 leading-relaxed static-text">
                              {area.description}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <FileText className="h-12 w-12 mb-4 opacity-50" />
              <p>No reports generated yet</p>
              <p className="text-sm">Select an analysis session above to generate a report</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Reports;
