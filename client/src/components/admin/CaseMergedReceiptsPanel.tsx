import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Check, Eye, Loader2, RefreshCw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { assertNeverReceiptStatus, isActionableReceiptStatus, type ReceiptStatus } from "@/lib/receiptStatus";
import { RECEIPT_STATUS_CHIP_CLASSES } from "@/components/admin/AllReceiptsTab";

type MergedReceipt = {
  source: "deposit" | "certificate" | "stamp_duty";
  id: number;
  caseId: string;
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
};

export const CATEGORY_LABEL: Record<MergedReceipt["category"], string> = {
  activation: "Activation",
  reissue: "Reissue",
  other: "Other",
  certificate: "Certificate",
  stamp_duty: "Stamp duty",
  merge_fee: "Merge fee",
  token_deposit: "Token deposit",
};

/** True when the row is an account-reactivation payment (reissue category,
 *  no linked letter-reissue round). Used to render the "Reactivation" badge. */
function isReactivationReceipt(r: MergedReceipt): boolean {
  return r.category === "reissue" && r.reissueId === null;
}


interface Props {
  caseId: string;
  authToken: string;
  /** Optional `${source}-${id}` to scroll to + highlight when changed. */
  scrollToKey?: string | null;
}

/**
 * Task #163 — Per-case merged uploads timeline shown inside the deposit
 * dialog. Now also routes approve/reject for cert + stamp-duty rows to
 * their dedicated endpoints (deposit rows continue to be acted on in the
 * existing deposit receipts list below to avoid forking that flow).
 */
export function CaseMergedReceiptsPanel({ caseId, authToken, scrollToKey }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<MergedReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ fileName: string; data: string } | null>(null);
  // Task #184 — synchronous guard against double-clicks. `actingKey`
  // alone is async (state update batches), so a fast second click can
  // fire a second POST before React re-renders the disabled button.
  // The ref is checked + set synchronously inside `act` to drop the
  // duplicate request immediately.
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const authHeaders = (): Record<string, string> =>
    authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const openPreview = async (r: MergedReceipt) => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewDoc(null);
    try {
      let data: string | null = null;
      if (r.source === "deposit") {
        const resp = await fetch(`/api/cases/${caseId}/deposit-receipts`, { headers: authHeaders() });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const receipts = (await resp.json()) as Array<{ id: number; imageData?: string }>;
        data = receipts.find((x) => x.id === r.id)?.imageData ?? null;
      } else if (r.source === "stamp_duty") {
        const resp = await fetch(`/api/cases/${caseId}/stamp-duty/receipts/${r.id}`, { headers: authHeaders() });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const row = (await resp.json()) as { fileData?: string };
        data = row.fileData ?? null;
      } else if (r.source === "certificate") {
        const resp = await fetch(`/api/cases/${caseId}/certificate/fee-payments/${r.id}`, { headers: authHeaders() });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const row = (await resp.json()) as { fileData?: string };
        data = row.fileData ?? null;
      }
      if (data) {
        setPreviewDoc({ fileName: r.fileName ?? "receipt", data });
      } else {
        toast({ variant: "destructive", title: "No file data available for this receipt." });
        setPreviewOpen(false);
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Preview failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/all-receipts`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((await res.json()) as MergedReceipt[]);
    } catch (err) {
      setRows([]);
      toast({
        variant: "destructive",
        title: "Failed to load merged uploads",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (caseId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // Scroll-to-row from the All Receipts inbox (Task #163 review fix).
  // Parent passes `${source}-${id}#${timestamp}` so repeat-clicks on the
  // same row re-trigger this effect; strip the timestamp suffix before
  // looking up the row ref / highlight key.
  useEffect(() => {
    if (!scrollToKey || rows.length === 0) return;
    const baseKey = scrollToKey.split("#")[0];
    const el = rowRefs.current[baseKey];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightKey(baseKey);
      const t = setTimeout(() => setHighlightKey(null), 2500);
      return () => clearTimeout(t);
    }
  }, [scrollToKey, rows]);

  const act = async (r: MergedReceipt, action: "approve" | "reject") => {
    const key = `${r.source}-${r.id}`;
    // Task #184 — drop double-clicks synchronously. The `disabled`
    // prop trails state, so without this guard a fast second click
    // could fire a second POST before the re-render lands.
    if (pendingKeysRef.current.has(key)) return;
    pendingKeysRef.current.add(key);
    let url: string;
    let method: "POST" | "PATCH" = "POST";
    let body: any = {};

    if (r.source === "deposit") {
      // Deposit rows: existing PATCH /api/deposit-receipts/:id (status only).
      url = `/api/deposit-receipts/${r.id}`;
      method = "PATCH";
      body = { status: action === "approve" ? "approved" : "rejected" };
    } else if (r.source === "certificate") {
      url = `/api/cases/${r.caseId}/certificate/fee-payments/${r.id}/${action}`;
    } else {
      url = `/api/cases/${r.caseId}/stamp-duty/receipts/${r.id}/${action}`;
    }

    setActingKey(key);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        const message: string =
          body?.error || body?.message || `HTTP ${res.status}`;
        // 409 = already reviewed (e.g. another admin acted, or a
        // double-click). Refresh the row so the UI reflects truth
        // instead of stranding a stale Approve button.
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
          return;
        }
        throw new Error(message);
      }
      toast({ title: action === "approve" ? "Receipt approved" : "Receipt rejected" });
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: `Failed to ${action} receipt`,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      pendingKeysRef.current.delete(key);
      setActingKey(null);
    }
  };

  const isActionable = (status: string) => isActionableReceiptStatus(status);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 mt-2" data-testid="merged-uploads-panel">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-white">All uploads for this case</h4>
        <div className="flex items-center gap-2">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger
              className="h-7 w-[130px] text-xs bg-slate-800 border-slate-700 text-slate-200"
              data-testid="filter-merged-panel-category"
            >
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="activation">Activation</SelectItem>
              <SelectItem value="reactivation">Reactivation</SelectItem>
              <SelectItem value="reissue">Reissue</SelectItem>
              <SelectItem value="other">Other</SelectItem>
              <SelectItem value="certificate">Certificate</SelectItem>
              <SelectItem value="stamp_duty">Stamp duty</SelectItem>
              <SelectItem value="merge_fee">Merge fee</SelectItem>
              <SelectItem value="token_deposit">Token deposit</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            onClick={load}
            disabled={loading}
            className="h-7 text-slate-300"
            data-testid="btn-merged-uploads-refresh"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 py-2" data-testid="merged-uploads-empty">
          {loading ? "Loading…" : "No uploads yet across any category."}
        </p>
      ) : (
        <ul className="space-y-1.5 max-h-64 overflow-y-auto">
          {rows.filter((r) => {
            if (categoryFilter === "all") return true;
            if (categoryFilter === "reactivation") return isReactivationReceipt(r);
            // "reissue" must show plain reissue rows only — exclude reactivation
            // receipts (category='reissue' + reissueId=null) so they don't bleed
            // into the Reissue filtered view.
            if (categoryFilter === "reissue") return r.category === "reissue" && !isReactivationReceipt(r);
            return r.category === categoryFilter;
          }).map((r) => {
            const key = `${r.source}-${r.id}`;
            const highlighted = highlightKey === key;
            return (
              <li
                key={key}
                ref={(el) => { rowRefs.current[key] = el; }}
                className={`flex items-center justify-between gap-3 text-xs px-2 py-1.5 rounded transition-colors ${
                  highlighted ? "bg-amber-500/20 ring-1 ring-amber-400/60" : "bg-slate-800/40"
                }`}
                data-testid={`merged-upload-${r.source}-${r.id}`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Badge variant="outline" className="border-slate-700 text-slate-200 text-[10px] shrink-0">
                    {CATEGORY_LABEL[r.category] ?? r.category}
                  </Badge>
                  {isReactivationReceipt(r) && (
                    <Badge className="text-[10px] shrink-0 bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      Reactivation
                    </Badge>
                  )}
                  <span className="text-slate-300 truncate" title={r.fileName ?? ""}>
                    {r.fileName ?? "(unnamed)"}
                  </span>
                  <span className="text-slate-500 whitespace-nowrap">
                    {new Date(r.uploadedAt).toLocaleString()}
                  </span>
                </div>
                <Badge
                  data-testid={`badge-receipt-status-${r.source}-${r.id}`}
                  className={`text-[10px] shrink-0 ${
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
                  }`}
                >
                  {r.status}
                </Badge>
                {isActionable(r.status) && r.source !== "deposit" && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10"
                      onClick={() => act(r, "approve")}
                      disabled={actingKey === key}
                      data-testid={`btn-merged-approve-${key}`}
                    >
                      {actingKey === key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-red-300 hover:text-red-200 hover:bg-red-500/10"
                      onClick={() => act(r, "reject")}
                      disabled={actingKey === key}
                      data-testid={`btn-merged-reject-${key}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-blue-300 hover:text-blue-200 hover:bg-blue-500/10 shrink-0"
                  onClick={() => void openPreview(r)}
                  title="Preview file"
                  data-testid={`btn-merged-preview-${key}`}
                >
                  <Eye className="w-3 h-3" />
                </Button>
                {r.source === "deposit" && isActionable(r.status) && (
                  <span className="text-[10px] text-slate-500 italic shrink-0">act below ↓</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl bg-slate-950 border-slate-800 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-200">
              <Eye className="h-4 w-4 text-blue-400" />
              {previewDoc?.fileName ?? "Receipt Preview"}
            </DialogTitle>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading file…
            </div>
          ) : previewDoc?.data ? (
            <div className="mt-2">
              {previewDoc.data.startsWith("data:application/pdf") ||
              previewDoc.data.startsWith("data:application/octet") ? (
                <iframe
                  src={previewDoc.data}
                  className="w-full h-[60vh] rounded border border-slate-700"
                  title={previewDoc.fileName}
                />
              ) : (
                <img
                  src={previewDoc.data}
                  alt={previewDoc.fileName}
                  className="max-w-full rounded border border-slate-700"
                />
              )}
            </div>
          ) : (
            <p className="text-slate-400 text-sm py-4">No file data available for preview.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CaseMergedReceiptsPanel;
