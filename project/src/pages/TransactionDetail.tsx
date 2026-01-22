import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  Building,
  Globe,
  CreditCard,
  FileText,
  AlertTriangle,
  CheckCircle,
  Clock,
  Save,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type RiskLevel = "low" | "medium" | "high";

const TransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [reviewNotes, setReviewNotes] = useState("");

  const { data: transaction, isLoading } = useQuery({
    queryKey: ["transaction", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select(`
          *,
          risk_assessment:risk_assessments(*),
          session:analysis_sessions(file_name)
        `)
        .eq("id", id!)
        .single();

      if (error) throw error;

      const riskAssessment = Array.isArray(data.risk_assessment)
        ? data.risk_assessment[0]
        : data.risk_assessment;

      setReviewNotes(riskAssessment?.review_notes || "");

      return {
        ...data,
        risk_assessment: riskAssessment,
      };
    },
    enabled: !!id,
  });

  const markReviewedMutation = useMutation({
    mutationFn: async (reviewed: boolean) => {
      const { error } = await supabase
        .from("risk_assessments")
        .update({
          reviewed,
          reviewed_at: reviewed ? new Date().toISOString() : null,
          reviewed_by: reviewed ? user?.id : null,
          review_notes: reviewNotes,
        })
        .eq("transaction_id", id!);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction", id] });
      toast.success("Review status updated");
    },
    onError: () => {
      toast.error("Failed to update review status");
    },
  });

  const saveNotesMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("risk_assessments")
        .update({ review_notes: reviewNotes })
        .eq("transaction_id", id!);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Notes saved");
    },
    onError: () => {
      toast.error("Failed to save notes");
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Transaction not found</p>
        <Button variant="link" onClick={() => navigate("/transactions")}>
          Back to Transactions
        </Button>
      </div>
    );
  }

  const riskAssessment = transaction.risk_assessment;
  const riskLevel = riskAssessment?.risk_level as RiskLevel | undefined;
  const riskScore = riskAssessment?.risk_score || 0;

  const getRiskColor = (level: RiskLevel | undefined) => {
    switch (level) {
      case "low":
        return "text-green-600";
      case "medium":
        return "text-yellow-600";
      case "high":
        return "text-red-600";
      default:
        return "text-muted-foreground";
    }
  };

  const getRiskBgColor = (level: RiskLevel | undefined) => {
    switch (level) {
      case "low":
        return "bg-green-100";
      case "medium":
        return "bg-yellow-100";
      case "high":
        return "bg-red-100";
      default:
        return "bg-muted";
    }
  };

  const getProgressColor = (score: number) => {
    if (score < 34) return "bg-green-500";
    if (score < 67) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/transactions")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Transaction {transaction.transaction_id}
          </h1>
          <p className="text-muted-foreground mt-1">
            From {(transaction.session as { file_name: string })?.file_name || "Unknown file"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Transaction Details */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Transaction Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Calendar className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">
                    {format(new Date(transaction.transaction_date), "MMMM d, yyyy")}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Amount</p>
                  <p className="font-medium text-lg">
                    ₹{transaction.amount.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Building className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Vendor</p>
                  <p className="font-medium">{transaction.vendor_name}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Globe className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Country</p>
                  <p className="font-medium">{transaction.vendor_country}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <CreditCard className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Payment Method</p>
                  <p className="font-medium">{transaction.payment_method}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Department</p>
                  <p className="font-medium">{transaction.department}</p>
                </div>
              </div>
            </div>

            {transaction.description && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Description</p>
                  <p className="text-foreground">{transaction.description}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Risk Score Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Risk Assessment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {riskAssessment ? (
              <>
                <div className="text-center">
                  <div
                    className={`inline-flex items-center justify-center w-24 h-24 rounded-full ${getRiskBgColor(
                      riskLevel
                    )}`}
                  >
                    <span className={`text-3xl font-bold ${getRiskColor(riskLevel)}`}>
                      {riskScore}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">Risk Score (0-100)</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Risk Level</span>
                    <Badge
                      className={
                        riskLevel === "high"
                          ? "bg-red-100 text-red-800"
                          : riskLevel === "medium"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-green-100 text-green-800"
                      }
                    >
                      {riskLevel?.toUpperCase()}
                    </Badge>
                  </div>
                  <Progress
                    value={riskScore}
                    className="h-2"
                    style={
                      {
                        "--progress-background": getProgressColor(riskScore),
                      } as React.CSSProperties
                    }
                  />
                </div>

                <Separator />

                <div className="flex items-center gap-2">
                  {riskAssessment.reviewed ? (
                    <>
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span className="text-green-600 font-medium">Reviewed</span>
                    </>
                  ) : (
                    <>
                      <Clock className="h-5 w-5 text-muted-foreground" />
                      <span className="text-muted-foreground">Pending Review</span>
                    </>
                  )}
                </div>

                <Button
                  className="w-full"
                  variant={riskAssessment.reviewed ? "outline" : "default"}
                  onClick={() => markReviewedMutation.mutate(!riskAssessment.reviewed)}
                  disabled={markReviewedMutation.isPending}
                >
                  {riskAssessment.reviewed ? "Mark as Pending" : "Mark as Reviewed"}
                </Button>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No risk assessment available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Analysis Section */}
      {riskAssessment && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Audit Observation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">
                {riskAssessment.audit_observation || "No observation available."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Risk Reason</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">
                {riskAssessment.risk_reason || "No risk reason provided."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Suggested Action</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">
                {riskAssessment.suggested_action || "No suggested action available."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Review Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Add your review notes here..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={4}
              />
              <Button
                onClick={() => saveNotesMutation.mutate()}
                disabled={saveNotesMutation.isPending}
                className="w-full"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Notes
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default TransactionDetail;
