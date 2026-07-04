import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, ExternalLink, FileText, CheckCircle, X, BellOff } from "lucide-react";
import { useAdminDashboard } from "./AdminDashboardContext";

import {
  ACTIONABLE_RECEIPT_STATUSES,
  assertNeverReceiptStatus,
  type ReceiptStatus,
} from "@/lib/receiptStatus";

type MergedReceipt = {
  source: "deposit" | "certificate" | "stamp_duty";
  id: number;
  caseId: string;
  accessCode?: string | null;
  category: "activation" | "reissue" | "other" | "certificate" | "stamp_duty" | "merge_fee" | "token_deposit";
  status: ReceiptStatus;
  fileName: string | null;
  notes: string | null;
  adminNotes: string | null;
  amountUsdt: string | null;
  reissueId: number | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  uploadedAt: string;
  // Task #379 — per-case mute flag for the document upload alert.
  alertMuted?: boolean;
};

/** True when the row is an account-reactivation payment (reissue category,
 *  no linked letter-reissue round). Mirrors CaseMergedReceiptsPanel logic. */
export function isReactivationReceipt(r: MergedReceipt): boolean {
  return r.category === "reissue" && r.reissueId === null;
}

export const CATEGORY_LABEL: Record<MergedReceipt["category"], string> = {
  activation: "Activation",
  reissue: "Reissue",
  other: "Other",
  certificate: "Certificate",
  stamp_duty: "Stamp duty",
  merge_fee: "Merge fee",
  token_deposit: "Token deposit",
};

// Typed class map — key type is ReceiptStatus (the exhaustive union) so
// TypeScript flags this record as incomplete if a new status is added to
// the union without a corresponding entry here.
export const RECEIPT_STATUS_CHIP_CLASSES: Record<ReceiptStatus, string> = {
  pending: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  awaiting_admin_approval: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  reviewed: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  approved: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/20 text-red-300 border-red-500/30",
};

const ACTIONABLE_STATUSES = ACTIONABLE_RECEIPT_STATUSES;

interface Props {
  onOpenCase?: (caseId: string, receiptKey?: string) => void;
  /** Optional controlled category filter. When provided the parent owns
   *  the filter state; manual changes are propagated via onCategoryFilterChange
   *  so the parent stays in sync (e.g. admin clears → parent resets to "all",
   *  KPI tile click → parent sets "reactivation"). Without these props the
   *  component manages its own uncontrolled state. */
  categoryFilter?: string;
  onCategoryFilterChange?: (v: string) => void;
}

/**
 * Task #163 — Cross-case admin "All Receipts" inbox. Merges
 * deposit_receipts (activation/reissue/other), certificate_fee_payments,
 * and stamp_duty_receipts into one sortable, filterable list.
 *
 * Task #164 — Inline Approve / Reject quick actions on each row. They
 * reuse the existing per-table endpoints (no new server routes, audit
 * logging unchanged) and follow the same optimistic-update-with-rollback
 * pattern used by `updateReceiptStatus` / `reviewStampDutyReceipt` in
 * AdminDashboard.
 */
export function AllReceiptsTab({ onOpenCase, categoryFilter: categoryFilterProp, onCategoryFilterChange }: Props) {
  const { toast } = useToast();
  const { adminRole, loadReactivationPendingCounts } = useAdminDashboard();
  const canApproveReceipts = adminRole === 'admin' || adminRole === 'super_admin';
  const [rows, setRows] = useState<MergedReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Controlled/uncontrolled pattern: when the parent passes categoryFilter +
  // onCategoryFilterChange, the parent owns the state and admin changes are
  // propagated up (so clearing the filter is reflected in the parent). When
  // these props are absent the component manages its own local state.
  const [categoryFilterInternal, setCategoryFilterInternal] = useState<string>("all");
  const isControlled = categoryFilterProp !== undefined;
  const categoryFilter = isControlled ? categoryFilterProp : categoryFilterInternal;
  const setCategoryFilter = (v: string) => {
    if (!isControlled) setCategoryFilterInternal(v);
    onCategoryFilterChange?.(v);
  };

  const [caseFilter, setCaseFilter] = useState<string>("");
  // Tracks rows with an in-flight approve/reject request. Keyed by
  // `${source}-${id}` so the three source tables don't collide on
  // numeric ids. Paired with a synchronous ref to immediately reject
  // double-clicks before React re-renders the disabled button.
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const pendingKeysRef = useRef<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const token = sessionStorage.getItem("adminToken") || "";
      const qs = new URLSearchParams();
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (categoryFilter !== "all") qs.set("category", categoryFilter);
      const res = await fetch(`/api/deposits/all-receipts${qs.toString() ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MergedReceipt[];
      setRows(data);
    } catch (err) {
      setRows([]);
      toast({
        variant: "destructive",
        title: "Failed to load receipts",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, categoryFilter]);

  const filtered = useMemo(() => {
    const term = caseFilter.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.caseId.toLowerCase().includes(term) ||
        (r.accessCode ?? "").toLowerCase().includes(term),
    );
  }, [rows, caseFilter]);

  const reviewReceipt = async (row: MergedReceipt, decision: "approve" | "reject") => {
    const key = `${row.source}-${row.id}`;
    if (pendingKeysRef.current.has(key)) return;
    pendingKeysRef.current.add(key);
    setPendingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    const optimisticStatus = decision === "approve" ? "approved" : "rejected";
    const previous = row;
    setRows((prev) =>
      prev.map((r) =>
        r.source === row.source && r.id === row.id
          ? { ...r, status: optimisticStatus, reviewedAt: new Date().toISOString() }
          : r,
      ),
    );
    const clearPending = () => {
      pendingKeysRef.current.delete(key);
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    };
    try {
      const token = sessionStorage.getItem("adminToken") || "";
      let res: Response;
      if (row.source === "deposit") {
        res = await fetch(`/api/deposit-receipts/${row.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: optimisticStatus }),
        });
      } else if (row.source === "certificate") {
        res = await fetch(
          `/api/cases/${row.caseId}/certificate/fee-payments/${row.id}/${decision}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({}),
          },
        );
      } else {
        res = await fetch(
          `/api/cases/${row.caseId}/stamp-duty/receipts/${row.id}/${decision}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({}),
          },
        );
      }
      if (res.ok) {
        void loadReactivationPendingCounts();
        const data = await res.json().catch(() => ({})) as {
          accountReactivated?: boolean;
          newAccessCode?: string;
          hasEmail?: boolean;
        };
        if (data.accountReactivated) {
          const code = data.newAccessCode;
          let description: string;
          if (code && data.hasEmail) {
            description = `Receipt approved. Account reactivated — new access code ${code} is being emailed to the user. Check the audit log to confirm delivery.`;
          } else if (code) {
            description = `Receipt approved. Account reactivated — new access code ${code} issued. No email on file; please share the code manually.`;
          } else {
            description = `Receipt approved and account reactivated.`;
          }
          toast({ title: "Account Reactivated", description, duration: 12000 });
        } else {
          toast({
            title: "Receipt updated",
            description: `${CATEGORY_LABEL[row.category] ?? row.category} receipt ${
              decision === "approve" ? "approved" : "rejected"
            }.`,
          });
        }
      } else {
        // Always roll back the optimistic flip first.
        setRows((prev) =>
          prev.map((r) => (r.source === previous.source && r.id === previous.id ? previous : r)),
        );
        const body = await res.json().catch(() => ({} as any));
        // 409 = already reviewed by another admin / a stale tab. Refresh
        // the whole list so the row reflects the true server state
        // rather than leaving a stale Approve button visible.
        if (res.status === 409) {
          toast({
            variant: "destructive",
            title: "Already reviewed",
            description:
              body?.status
                ? `This receipt was already ${body.status}. Refreshed.`
                : "This receipt has already been reviewed. Refreshed.",
          });
          await load();
        } else {
          toast({
            variant: "destructive",
            title: "Failed to update receipt",
            description: body?.error || body?.message || `HTTP ${res.status}`,
          });
        }
      }
    } catch (err) {
      setRows((prev) =>
        prev.map((r) => (r.source === previous.source && r.id === previous.id ? previous : r)),
      );
      toast({
        variant: "destructive",
        title: "Failed to update receipt",
        description: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      clearPending();
    }
  };

  return (
    <Card className="bg-slate-900/40 border-slate-800">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-white flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-400" /> All Receipts
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Filter by case ID"
            value={caseFilter}
            onChange={(e) => setCaseFilter(e.target.value)}
            className="w-44 bg-slate-800/60 border-slate-700 text-white text-sm"
            data-testid="filter-all-receipts-case"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 bg-slate-800/60 border-slate-700 text-white text-sm" data-testid="filter-all-receipts-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="awaiting_admin_approval">Awaiting review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-40 bg-slate-800/60 border-slate-700 text-white text-sm" data-testid="filter-all-receipts-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="reactivation">Reactivation</SelectItem>
              <SelectItem value="activation">Activation</SelectItem>
              <SelectItem value="reissue">Reissue</SelectItem>
              <SelectItem value="certificate">Certificate</SelectItem>
              <SelectItem value="stamp_duty">Stamp duty</SelectItem>
              <SelectItem value="merge_fee">Merge fee</SelectItem>
              <SelectItem value="token_deposit">Token deposit</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading}
            className="border-slate-700 text-slate-200"
            data-testid="btn-all-receipts-refresh"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm" data-testid="all-receipts-empty">
            {loading ? "Loading receipts…" : "No receipts match the current filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-2">Uploaded</th>
                  <th className="py-2 px-2">Case</th>
                  <th className="py-2 px-2">Category</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Amount</th>
                  <th className="py-2 px-2">File</th>
                  <th className="py-2 px-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const key = `${r.source}-${r.id}`;
                  const isPending = pendingKeys.has(key);
                  const canReview = ACTIONABLE_STATUSES.has(r.status);
                  const isReactivation = isReactivationReceipt(r);
                  return (
                    <tr
                      key={key}
                      className={`border-b border-slate-800/60 ${isReactivation && canReview ? "bg-amber-950/20 hover:bg-amber-950/30" : "hover:bg-slate-800/30"}`}
                      data-testid={`all-receipt-row-${r.source}-${r.id}`}
                    >
                      <td className="py-2 px-2 text-slate-400 whitespace-nowrap">
                        {new Date(r.uploadedAt).toLocaleString()}
                      </td>
                      <td className="py-2 px-2 font-mono whitespace-nowrap" title={r.caseId}>
                        <div className="flex items-center gap-1.5">
                          {r.accessCode ? (
                            onOpenCase ? (
                              <button
                                type="button"
                                onClick={() => onOpenCase(r.caseId, `${r.source}-${r.id}`)}
                                className="text-blue-300 hover:text-blue-200 hover:underline"
                                data-testid={`link-case-access-${r.caseId}`}
                              >
                                IBCCF-{r.accessCode}
                              </button>
                            ) : (
                              <span className="text-slate-200">IBCCF-{r.accessCode}</span>
                            )
                          ) : (
                            <span className="text-slate-200">{r.caseId.slice(0, 8)}…</span>
                          )}
                          {r.alertMuted && (
                            <Badge
                              variant="outline"
                              className="text-amber-200 border-amber-500 bg-amber-500/15 text-[10px] px-1 py-0"
                              title="Upload alerts are muted for this case."
                              data-testid={`badge-all-receipts-muted-${r.source}-${r.id}`}
                            >
                              <BellOff className="w-3 h-3 mr-0.5" /> Muted
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className="border-slate-700 text-slate-200">
                            {CATEGORY_LABEL[r.category] ?? r.category}
                          </Badge>
                          {isReactivation && (
                            <Badge
                              className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40"
                              data-testid={`badge-all-receipts-reactivation-${r.source}-${r.id}`}
                            >
                              Reactivation
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <Badge
                          className={
                            r.status === "pending"
                              ? RECEIPT_STATUS_CHIP_CLASSES.pending
                              : r.status === "awaiting_admin_approval"
                              ? RECEIPT_STATUS_CHIP_CLASSES.awaiting_admin_approval
                              : r.status === "reviewed"
                              ? RECEIPT_STATUS_CHIP_CLASSES.reviewed
                              : r.status === "approved"
                              ? RECEIPT_STATUS_CHIP_CLASSES.approved
                              : r.status === "rejected"
                              ? RECEIPT_STATUS_CHIP_CLASSES.rejected
                              : assertNeverReceiptStatus(r.status)
                          }
                          data-testid={`badge-receipt-status-${r.source}-${r.id}`}
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-slate-300 whitespace-nowrap">{r.amountUsdt ?? "—"}</td>
                      <td className="py-2 px-2 text-slate-400 max-w-[12rem] truncate" title={r.fileName ?? ""}>
                        {r.fileName ?? "—"}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex flex-col items-end gap-1">
                          {canReview && canApproveReceipts && isReactivation && (
                            <p className="text-[10px] text-amber-400/80 flex items-center gap-1">
                              <RefreshCw className="w-3 h-3 shrink-0" />
                              Approving re-enables portal access &amp; issues a new code.
                            </p>
                          )}
                          <div className="flex items-center justify-end gap-1">
                            {canReview && canApproveReceipts && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => reviewReceipt(r, "approve")}
                                  disabled={isPending}
                                  className={`h-7 px-2 disabled:opacity-60 ${isReactivation ? "bg-amber-600 hover:bg-amber-700" : "bg-green-600 hover:bg-green-700"}`}
                                  data-testid={`btn-all-receipts-approve-${r.source}-${r.id}`}
                                >
                                  <CheckCircle className="w-3.5 h-3.5 mr-1" />
                                  {isPending ? "…" : isReactivation ? "Approve & Reactivate" : "Approve"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => reviewReceipt(r, "reject")}
                                  disabled={isPending}
                                  className="h-7 px-2 disabled:opacity-60"
                                  data-testid={`btn-all-receipts-reject-${r.source}-${r.id}`}
                                >
                                  <X className="w-3.5 h-3.5 mr-1" />
                                  {isPending ? "…" : "Reject"}
                                </Button>
                              </>
                            )}
                            {onOpenCase && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-blue-300 hover:text-blue-200"
                                onClick={() => onOpenCase(r.caseId, `${r.source}-${r.id}`)}
                                data-testid={`btn-open-case-${r.caseId}`}
                              >
                                Open <ExternalLink className="w-3.5 h-3.5 ml-1" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AllReceiptsTab;
