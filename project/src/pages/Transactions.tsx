import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Search, Filter, ArrowUpDown, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "sonner";

type RiskLevel = "low" | "medium" | "high";

interface TransactionWithRisk {
  id: string;
  transaction_id: string;
  transaction_date: string;
  amount: number;
  vendor_name: string;
  vendor_country: string;
  department: string;
  payment_method: string;
  description: string | null;
  risk_assessment: {
    risk_level: RiskLevel;
    risk_score: number;
    risk_reason: string | null;
    reviewed: boolean;
  } | null;
}

const Transactions = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("transaction_date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [isClearing, setIsClearing] = useState(false);

  const handleClearAllTransactions = async () => {
    if (!user) return;
    
    setIsClearing(true);
    try {
      // Get all session IDs for the user
      const { data: sessions, error: sessionsError } = await supabase
        .from("analysis_sessions")
        .select("id")
        .eq("user_id", user.id);

      if (sessionsError) {
        console.error("Error fetching sessions:", sessionsError);
        throw new Error("Failed to fetch sessions");
      }

      if (!sessions || sessions.length === 0) {
        toast.info("No transactions to clear");
        setIsClearing(false);
        return;
      }

      const sessionIds = sessions.map((s) => s.id);

      // Get all transaction IDs for these sessions
      const { data: transactionData, error: txFetchError } = await supabase
        .from("transactions")
        .select("id")
        .in("session_id", sessionIds);

      if (txFetchError) {
        console.error("Error fetching transactions:", txFetchError);
        throw new Error("Failed to fetch transactions");
      }

      // Delete risk assessments first (they reference transactions)
      if (transactionData && transactionData.length > 0) {
        const transactionIds = transactionData.map((t) => t.id);
        const { error: raDeleteError } = await supabase
          .from("risk_assessments")
          .delete()
          .in("transaction_id", transactionIds);

        if (raDeleteError) {
          console.error("Error deleting risk assessments:", raDeleteError);
          throw new Error("Failed to delete risk assessments");
        }
      }

      // Delete transactions
      const { error: txDeleteError } = await supabase
        .from("transactions")
        .delete()
        .in("session_id", sessionIds);

      if (txDeleteError) {
        console.error("Error deleting transactions:", txDeleteError);
        throw new Error("Failed to delete transactions");
      }

      // Delete audit reports
      const { error: reportDeleteError } = await supabase
        .from("audit_reports")
        .delete()
        .in("session_id", sessionIds);

      if (reportDeleteError) {
        console.error("Error deleting audit reports:", reportDeleteError);
        throw new Error("Failed to delete audit reports");
      }

      // Delete analysis sessions
      const { error: sessionDeleteError } = await supabase
        .from("analysis_sessions")
        .delete()
        .eq("user_id", user.id);

      if (sessionDeleteError) {
        console.error("Error deleting sessions:", sessionDeleteError);
        throw new Error("Failed to delete sessions");
      }

      // Invalidate queries to refresh the UI
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["departments"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["analysis-sessions"] });

      toast.success("All transactions cleared successfully");
    } catch (error) {
      console.error("Error clearing transactions:", error);
      toast.error(error instanceof Error ? error.message : "Failed to clear transactions");
    } finally {
      setIsClearing(false);
    }
  };

  const { data: transactions, isLoading } = useQuery({
    queryKey: ["transactions", user?.id],
    queryFn: async () => {
      const { data: sessions } = await supabase
        .from("analysis_sessions")
        .select("id")
        .eq("user_id", user!.id);

      if (!sessions || sessions.length === 0) return [];

      const sessionIds = sessions.map((s) => s.id);

      const { data, error } = await supabase
        .from("transactions")
        .select(`
          *,
          risk_assessment:risk_assessments(risk_level, risk_score, risk_reason, reviewed)
        `)
        .in("session_id", sessionIds);

      if (error) throw error;

      return (data || []).map((t) => ({
        ...t,
        risk_assessment: Array.isArray(t.risk_assessment)
          ? t.risk_assessment[0] || null
          : t.risk_assessment,
      })) as TransactionWithRisk[];
    },
    enabled: !!user,
  });

  const { data: departments } = useQuery({
    queryKey: ["departments", user?.id],
    queryFn: async () => {
      const { data: sessions } = await supabase
        .from("analysis_sessions")
        .select("id")
        .eq("user_id", user!.id);

      if (!sessions || sessions.length === 0) return [];

      const sessionIds = sessions.map((s) => s.id);

      const { data } = await supabase
        .from("transactions")
        .select("department")
        .in("session_id", sessionIds);

      const uniqueDepts = [...new Set(data?.map((t) => t.department) || [])];
      return uniqueDepts;
    },
    enabled: !!user,
  });

  const filteredTransactions = transactions
    ?.filter((t) => {
      const matchesSearch =
        t.transaction_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.vendor_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.description?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesRisk =
        riskFilter === "all" || t.risk_assessment?.risk_level === riskFilter;

      const matchesDepartment =
        departmentFilter === "all" || t.department === departmentFilter;

      return matchesSearch && matchesRisk && matchesDepartment;
    })
    .sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";

      switch (sortField) {
        case "transaction_date":
          aVal = new Date(a.transaction_date).getTime();
          bVal = new Date(b.transaction_date).getTime();
          break;
        case "amount":
          aVal = a.amount;
          bVal = b.amount;
          break;
        case "risk_score":
          aVal = a.risk_assessment?.risk_score || 0;
          bVal = b.risk_assessment?.risk_score || 0;
          break;
        default:
          aVal = a.transaction_date;
          bVal = b.transaction_date;
      }

      if (sortOrder === "asc") {
        return aVal > bVal ? 1 : -1;
      }
      return aVal < bVal ? 1 : -1;
    });

  const getRiskBadge = (level: RiskLevel | undefined) => {
    if (!level) return <Badge variant="outline">Not Analyzed</Badge>;

    const variants: Record<RiskLevel, "default" | "secondary" | "destructive"> = {
      low: "default",
      medium: "secondary",
      high: "destructive",
    };

    const colors: Record<RiskLevel, string> = {
      low: "bg-green-100 text-green-800 hover:bg-green-100",
      medium: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
      high: "bg-red-100 text-red-800 hover:bg-red-100",
    };

    return (
      <Badge className={colors[level]}>
        {level.charAt(0).toUpperCase() + level.slice(1)}
      </Badge>
    );
  };

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Transactions</h1>
          <p className="text-muted-foreground mt-1">
            View and filter all analyzed transactions
          </p>
        </div>
        
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button 
              variant="destructive" 
              disabled={!transactions || transactions.length === 0 || isClearing}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isClearing ? "Clearing..." : "Clear All Transactions"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear All Transactions</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all transactions, risk assessments, audit reports, and analysis sessions. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleClearAllTransactions}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Clear All
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by ID, vendor, or description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Risk Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risks</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>

            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments?.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filteredTransactions && filteredTransactions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction ID</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleSort("transaction_date")}
                      className="h-8 p-0 font-medium"
                    >
                      Date
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleSort("amount")}
                      className="h-8 p-0 font-medium"
                    >
                      Amount
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleSort("risk_score")}
                      className="h-8 p-0 font-medium"
                    >
                      Risk Level
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTransactions.map((transaction) => (
                  <TableRow
                    key={transaction.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/transactions/${transaction.id}`)}
                  >
                    <TableCell className="font-medium">
                      {transaction.transaction_id}
                    </TableCell>
                    <TableCell>
                      {format(new Date(transaction.transaction_date), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      ₹{transaction.amount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{transaction.vendor_name}</div>
                        <div className="text-sm text-muted-foreground">
                          {transaction.vendor_country}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{transaction.department}</TableCell>
                    <TableCell>
                      {getRiskBadge(transaction.risk_assessment?.risk_level)}
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate">
                      {transaction.risk_assessment
                        ? transaction.risk_assessment.risk_reason || "No rule triggered"
                        : "Not analyzed"}
                    </TableCell>
                    <TableCell>
                      {transaction.risk_assessment?.reviewed ? (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">
                          Reviewed
                        </Badge>
                      ) : (
                        <Badge variant="outline">Pending</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Search className="h-12 w-12 mb-4 opacity-50" />
              <p>No transactions found</p>
              <p className="text-sm">Upload a file to get started</p>
            </div>
          )}
        </CardContent>
      </Card>

      {filteredTransactions && filteredTransactions.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing {filteredTransactions.length} of {transactions?.length || 0} transactions
        </div>
      )}
    </div>
  );
};

export default Transactions;
