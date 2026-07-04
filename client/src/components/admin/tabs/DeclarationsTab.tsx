import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Scale, Download, Eye } from "lucide-react";
import { useAdminDashboard } from "../AdminDashboardContext";
import type { DeclarationSubmission } from "../shared";

export function DeclarationsTab() {
  const { authToken, cases, openDeclarationDialog, toast } = useAdminDashboard();

  const [submissions, setSubmissions] = useState<DeclarationSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const PAGE_SIZE = 50;

  const load = async (status: string, pageIdx: number) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageIdx * PAGE_SIZE),
      });
      if (status !== "all") params.set("status", status);

      const res = await fetch(`/api/admin/declaration-submissions?${params}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setSubmissions(Array.isArray(data.rows) ? data.rows : []);
      setTotal(typeof data.total === "number" ? data.total : 0);
    } catch {
      toast({ title: "Failed to load declarations", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load(statusFilter, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, page]);

  const handleStatusFilter = (v: string) => {
    setPage(0);
    setStatusFilter(v);
  };

  const downloadPdf = async (sub: DeclarationSubmission) => {
    setDownloadingId(sub.id);
    try {
      const res = await fetch(`/api/admin/declaration-submissions/${sub.id}/pdf`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) { toast({ title: "PDF generation failed", variant: "destructive" }); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `declaration-${sub.caseId}-${sub.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  };

  const openReview = (sub: DeclarationSubmission) => {
    const caseObj = cases.find((c) => c.id === sub.caseId);
    if (caseObj) openDeclarationDialog(caseObj);
  };

  const statusBadge = (status: string) => {
    const cls =
      status === "approved"
        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
        : status === "rejected"
        ? "bg-red-500/15 text-red-300 border border-red-500/30"
        : "bg-blue-500/15 text-blue-300 border border-blue-500/30";
    return <Badge className={cls}>{status.toUpperCase()}</Badge>;
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <Scale className="h-6 w-6 text-amber-400" />
            Declarations of Compliance
          </h2>
          <p className="text-slate-400 text-sm">
            All declaration submissions across every case. Use the filter to
            find pending reviews.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={handleStatusFilter}>
            <SelectTrigger className="w-40 bg-slate-900 border-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-white">
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="border-slate-700"
            onClick={() => load(statusFilter, page)}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <Card className="bg-slate-950 border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-900">
              <TableRow className="hover:bg-slate-900 border-slate-800">
                <TableHead className="text-slate-400">Case ID</TableHead>
                <TableHead className="text-slate-400">Full Name</TableHead>
                <TableHead className="text-slate-400">Email</TableHead>
                <TableHead className="text-slate-400">Asset</TableHead>
                <TableHead className="text-slate-400">TX Hash</TableHead>
                <TableHead className="text-slate-400">Submitted</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400 text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i} className="border-slate-800 animate-pulse">
                    {[...Array(8)].map((__, j) => (
                      <TableCell key={j}>
                        <div className="h-4 bg-slate-800 rounded w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : submissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-slate-500">
                    No declarations found{statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}.
                  </TableCell>
                </TableRow>
              ) : (
                submissions.map((sub) => (
                  <TableRow
                    key={sub.id}
                    className="border-slate-800 hover:bg-slate-900/60 transition-colors"
                  >
                    <TableCell className="font-mono text-xs text-amber-300">
                      {sub.caseId}
                    </TableCell>
                    <TableCell className="text-slate-100 font-medium">
                      {sub.fullName}
                    </TableCell>
                    <TableCell className="text-slate-300 text-xs">
                      {sub.email}
                    </TableCell>
                    <TableCell className="text-slate-300 text-xs">
                      {sub.preferredAsset}
                    </TableCell>
                    <TableCell className="text-xs">
                      {sub.processingFeeTxHash ? (
                        <span className="font-mono text-amber-200 break-all">
                          {sub.processingFeeTxHash.slice(0, 12)}…
                        </span>
                      ) : (
                        <span className="text-slate-600 italic">none</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-400 text-xs whitespace-nowrap">
                      {new Date(sub.submittedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>{statusBadge(sub.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-slate-700 text-slate-300 hover:text-white h-7 px-2 text-xs"
                          onClick={() => openReview(sub)}
                          title="Open declaration review dialog"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" /> Review
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-700/50 text-amber-400 hover:text-amber-200 hover:border-amber-600 h-7 px-2 text-xs"
                          onClick={() => downloadPdf(sub)}
                          disabled={downloadingId === sub.id}
                          title="Download PDF"
                        >
                          {downloadingId === sub.id ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
            <span className="text-xs text-slate-500">
              {total} total · page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-slate-700 h-7 text-xs"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-slate-700 h-7 text-xs"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
