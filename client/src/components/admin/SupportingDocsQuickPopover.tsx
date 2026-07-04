import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Check, CheckCheck, Eye, FileText, FileUp, Loader2, X, XCircle } from "lucide-react";

type PendingDoc = {
  id: number;
  caseId: string;
  fileName: string;
  fileType: string;
  fileSize: string | null;
  category: string | null;
  description: string | null;
  status: string | null;
  uploadedAt: string;
};

interface Props {
  caseId: string;
  count: number;
  authToken: string | null;
  onActioned?: () => void;
}

const ACTIONABLE_STATUS = new Set(["uploaded", "reviewed", null, undefined]);

function isActionable(status: string | null | undefined) {
  return ACTIONABLE_STATUS.has(status ?? "uploaded");
}

/**
 * Task #338 — quick-action popover anchored to the per-case
 * "N NEW UPLOADS" badge in CasesTab. Lets admins approve/reject
 * pending supporting-document uploads without leaving the case list.
 * The full reviewer surface (notes, preview, history) still lives
 * inside the case-detail dialog's SupportingDocumentsPanel.
 *
 * Badge-refresh contract (Task #425, updated Task #436, Task #439, Task #442):
 * `onActioned?.()` is called in the `finally` block of `act()`,
 * `bulkApprove()`, and `bulkReject()` so badge counts are refreshed
 * regardless of whether the PATCH succeeded or failed — including
 * partial failures in bulk flows.
 * CasesTab wires that prop to `() => loadUserDocPendingCounts()` so the
 * per-case badge counts never go stale after a transient network error.
 */
export function SupportingDocsQuickPopover({
  caseId,
  count,
  authToken,
  onActioned,
}: Props) {
  const { toast } = useToast();
  const { t } = useTranslation("admin");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState<PendingDoc[]>([]);
  const [actingId, setActingId] = useState<number | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [bulkRejectConfirming, setBulkRejectConfirming] = useState(false);
  const [bulkRejectNotes, setBulkRejectNotes] = useState("");
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [notesById, setNotesById] = useState<Record<number, string>>({});
  const pendingRef = useRef<Set<number>>(new Set());
  const previewClosedRef = useRef(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{
    fileName: string;
    fileData: string | null;
    fileType: string;
  } | null>(null);

  const authHeaders = (): Record<string, string> =>
    authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const openPreview = async (doc: PendingDoc) => {
    previewClosedRef.current = false;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewDoc({ fileName: doc.fileName, fileData: null, fileType: doc.fileType });
    try {
      const res = await fetch(`/api/admin/user-documents/${doc.id}/file`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        fileData: string | null;
        fileType: string;
        fileName: string;
      };
      setPreviewDoc({
        fileName: data.fileName,
        fileData: data.fileData,
        fileType: data.fileType,
      });
    } catch (err) {
      if (!previewClosedRef.current) {
        toast({
          variant: "destructive",
          title: t("toasts.previewFailed.title"),
          description: err instanceof Error ? err.message : "Unknown error",
        });
        setPreviewOpen(false);
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/user-documents`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PendingDoc[];
      setDocs(data.filter((d) => isActionable(d.status)));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to load uploads",
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setDocs([]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void load();
    } else {
      setBulkRejectConfirming(false);
      setBulkRejectNotes("");
    }
  };

  const act = async (doc: PendingDoc, decision: "approved" | "rejected") => {
    if (pendingRef.current.has(doc.id)) return;
    pendingRef.current.add(doc.id);
    setActingId(doc.id);
    try {
      const trimmedNotes = (notesById[doc.id] ?? "").trim();
      const payload: { status: string; adminNotes?: string } = { status: decision };
      if (trimmedNotes) payload.adminNotes = trimmedNotes;
      const res = await fetch(`/api/admin/user-documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        throw new Error(
          (body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : "") || `HTTP ${res.status}`,
        );
      }
      toast({
        title: decision === "approved" ? t("toasts.docApproved.title") : t("toasts.docRejected.title"),
      });
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      setNotesById((prev) => {
        if (!(doc.id in prev)) return prev;
        const next = { ...prev };
        delete next[doc.id];
        return next;
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Action failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      pendingRef.current.delete(doc.id);
      setActingId(null);
      onActioned?.();
    }
  };

  /**
   * Bulk-approve all currently visible pending docs.
   *
   * Badge-refresh contract (Task #439): `onActioned?.()` is called in the
   * `finally` block so the per-case badge count is always refreshed — even
   * when some (or all) individual PATCHes fail (partial-failure path).
   */
  const bulkApprove = async () => {
    const targets = docs.filter((d) => isActionable(d.status));
    if (targets.length === 0) return;
    setBulkApproving(true);
    setBulkProgress({ done: 0, total: targets.length });
    let succeeded = 0;
    let failed = 0;
    try {
      const results = await Promise.allSettled(
        targets.map((doc) =>
          fetch(`/api/admin/user-documents/${doc.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ status: "approved" }),
          }).then(async (res) => {
            if (!res.ok) {
              const body = await res.json().catch(() => ({} as Record<string, unknown>));
              throw new Error(
                (body && typeof body === "object" && "error" in body
                  ? String((body as { error: unknown }).error)
                  : "") || `HTTP ${res.status}`,
              );
            }
            return doc.id;
          }).finally(() => {
            setBulkProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev);
          }),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          succeeded += 1;
        } else {
          failed += 1;
        }
      }
      const approvedIds = new Set(
        results
          .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
          .map((r) => r.value),
      );
      setDocs((prev) => prev.filter((d) => !approvedIds.has(d.id)));
      if (failed === 0) {
        toast({ title: `${succeeded} document${succeeded === 1 ? "" : "s"} approved` });
      } else {
        toast({
          variant: "destructive",
          title: `${succeeded} approved, ${failed} failed`,
          description: "Some documents could not be approved. Please retry.",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Bulk approve failed",
        description: "An unexpected error occurred.",
      });
    } finally {
      setBulkApproving(false);
      setBulkProgress(null);
      onActioned?.();
    }
  };

  /**
   * Bulk-reject all currently visible pending docs.
   *
   * Badge-refresh contract (Task #442): `onActioned?.()` is called in the
   * `finally` block so the per-case badge count is always refreshed — even
   * when some (or all) individual PATCHes fail (partial-failure path).
   */
  const bulkReject = async () => {
    const targets = docs.filter((d) => isActionable(d.status));
    if (targets.length === 0) return;
    setBulkRejecting(true);
    setBulkProgress({ done: 0, total: targets.length });
    const sharedNotes = bulkRejectNotes.trim() || undefined;
    let succeeded = 0;
    let failed = 0;
    try {
      const results = await Promise.allSettled(
        targets.map((doc) =>
          fetch(`/api/admin/user-documents/${doc.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ status: "rejected", ...(sharedNotes ? { adminNotes: sharedNotes } : {}) }),
          }).then(async (res) => {
            if (!res.ok) {
              const body = await res.json().catch(() => ({} as Record<string, unknown>));
              throw new Error(
                (body && typeof body === "object" && "error" in body
                  ? String((body as { error: unknown }).error)
                  : "") || `HTTP ${res.status}`,
              );
            }
            return doc.id;
          }).finally(() => {
            setBulkProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev);
          }),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          succeeded += 1;
        } else {
          failed += 1;
        }
      }
      const rejectedIds = new Set(
        results
          .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
          .map((r) => r.value),
      );
      setDocs((prev) => prev.filter((d) => !rejectedIds.has(d.id)));
      if (failed === 0) {
        toast({ title: `${succeeded} document${succeeded === 1 ? "" : "s"} rejected` });
      } else {
        toast({
          variant: "destructive",
          title: `${succeeded} rejected, ${failed} failed`,
          description: "Some documents could not be rejected. Please retry.",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Bulk reject failed",
        description: "An unexpected error occurred.",
      });
    } finally {
      setBulkRejecting(false);
      setBulkRejectConfirming(false);
      setBulkRejectNotes("");
      setBulkProgress(null);
      onActioned?.();
    }
  };

  const formatUploaded = (ts: string) => {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return ts;
    return d.toLocaleString();
  };

  const isBusy = bulkApproving || bulkRejecting || actingId !== null;

  return (
    <>
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Review ${count} pending supporting document${count === 1 ? "" : "s"}`}
          title={`${count} supporting document${count === 1 ? "" : "s"} uploaded — click to review`}
          data-testid={`badge-user-doc-pending-${caseId}`}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded-md"
        >
          <Badge
            variant="outline"
            className="text-violet-300 border-violet-500 bg-violet-500/15 animate-pulse cursor-pointer hover:bg-violet-500/25"
          >
            <FileUp className="w-3 h-3 mr-1" />
            {count} NEW UPLOAD{count === 1 ? "" : "S"}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-96 bg-slate-950 border-slate-800 text-slate-200 p-0"
        data-testid={`popover-user-doc-pending-${caseId}`}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-4 py-3 border-b border-slate-800 flex items-start justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-slate-200">
              Pending supporting uploads
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Preview, approve, or reject without leaving the case list. Open
              the case for notes history and full audit trail.
            </p>
          </div>
          {docs.length > 1 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                disabled={isBusy}
                onClick={() => void bulkApprove()}
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                data-testid={`popover-bulk-approve-${caseId}`}
                title="Approve all pending documents for this case"
              >
                {bulkApproving ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    {bulkProgress
                      ? `${bulkProgress.done} / ${bulkProgress.total}`
                      : "Approving…"}
                  </>
                ) : (
                  <>
                    <CheckCheck className="h-3 w-3 mr-1" />
                    Approve all
                  </>
                )}
              </Button>
              {bulkRejectConfirming ? null : (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isBusy}
                  onClick={() => setBulkRejectConfirming(true)}
                  className="h-7 text-xs"
                  data-testid={`popover-bulk-reject-${caseId}`}
                  title="Reject all pending documents for this case"
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  Reject all
                </Button>
              )}
            </div>
          )}
        </div>

        {bulkRejectConfirming && (
          <div
            className="px-4 py-3 border-b border-slate-800 bg-red-950/20 space-y-2"
            data-testid={`popover-bulk-reject-confirm-${caseId}`}
          >
            <p className="text-xs text-red-300 font-medium">
              Reject all {docs.filter((d) => isActionable(d.status)).length} pending document{docs.filter((d) => isActionable(d.status)).length === 1 ? "" : "s"}?
            </p>
            <Textarea
              value={bulkRejectNotes}
              onChange={(e) => setBulkRejectNotes(e.target.value)}
              placeholder="Reason for rejection (optional — applies to all)"
              rows={2}
              disabled={bulkRejecting}
              className="text-xs bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500 min-h-[48px]"
              data-testid={`popover-bulk-reject-notes-${caseId}`}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={bulkRejecting}
                onClick={() => {
                  setBulkRejectConfirming(false);
                  setBulkRejectNotes("");
                }}
                className="h-7 text-xs"
                data-testid={`popover-bulk-reject-cancel-${caseId}`}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={bulkRejecting}
                onClick={() => void bulkReject()}
                className="h-7 text-xs"
                data-testid={`popover-bulk-reject-confirm-btn-${caseId}`}
              >
                {bulkRejecting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    {bulkProgress
                      ? `${bulkProgress.done} / ${bulkProgress.total}`
                      : "Rejecting…"}
                  </>
                ) : (
                  <>
                    <X className="h-3 w-3 mr-1" />
                    Confirm rejection
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-slate-400 text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
              Loading…
            </div>
          ) : docs.length === 0 ? (
            <p className="text-xs text-slate-500 px-4 py-6 text-center">
              No pending uploads. The badge will clear on the next refresh.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {docs.map((doc) => {
                const acting = actingId === doc.id;
                return (
                  <li
                    key={doc.id}
                    className="px-4 py-3 space-y-2"
                    data-testid={`popover-user-doc-row-${doc.id}`}
                  >
                    <div className="min-w-0">
                      <p
                        className="text-sm font-medium text-slate-200 truncate"
                        title={doc.fileName}
                      >
                        {doc.fileName}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {doc.category ?? "general"} ·{" "}
                        {formatUploaded(doc.uploadedAt)}
                        {doc.fileSize ? ` · ${doc.fileSize}` : ""}
                      </p>
                    </div>
                    <Textarea
                      value={notesById[doc.id] ?? ""}
                      onChange={(e) =>
                        setNotesById((prev) => ({ ...prev, [doc.id]: e.target.value }))
                      }
                      placeholder="Optional review note (e.g. blurry — re-upload)"
                      rows={2}
                      disabled={acting}
                      className="text-xs bg-slate-900 border-slate-800 text-slate-200 placeholder:text-slate-500 min-h-[48px]"
                      data-testid={`popover-user-doc-notes-${doc.id}`}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={acting}
                        onClick={() => openPreview(doc)}
                        className="h-7 w-7 p-0 text-slate-400 hover:text-slate-200"
                        title="Preview file"
                        data-testid={`popover-user-doc-preview-${doc.id}`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        disabled={acting}
                        onClick={() => act(doc, "approved")}
                        className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                        data-testid={`popover-user-doc-approve-${doc.id}`}
                      >
                        {acting ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Check className="h-3 w-3 mr-1" />
                        )}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={acting}
                        onClick={() => act(doc, "rejected")}
                        className="h-7 text-xs"
                        data-testid={`popover-user-doc-reject-${doc.id}`}
                      >
                        {acting ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <X className="h-3 w-3 mr-1" />
                        )}
                        Reject
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>

    <Dialog open={previewOpen} onOpenChange={(open) => { if (!open) previewClosedRef.current = true; setPreviewOpen(open); }}>
      <DialogContent
        className="max-w-3xl bg-slate-950 border-slate-800 text-white max-h-[90vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        data-testid="sdqp-preview-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-200">
            <FileText className="h-4 w-4 text-amber-400" />
            {previewDoc?.fileName ?? "Document Preview"}
          </DialogTitle>
        </DialogHeader>
        {previewLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading file…
          </div>
        ) : previewDoc?.fileData ? (
          <div className="mt-2">
            {previewDoc.fileType === "pdf" ||
            previewDoc.fileData.startsWith("data:application/pdf") ? (
              <iframe
                src={previewDoc.fileData}
                className="w-full h-[60vh] rounded border border-slate-700"
                title={previewDoc.fileName}
              />
            ) : (
              <img
                src={previewDoc.fileData}
                alt={previewDoc.fileName}
                className="max-w-full rounded border border-slate-700"
              />
            )}
          </div>
        ) : (
          <p className="text-slate-400 text-sm py-4">
            No file data available for preview.
          </p>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

export default SupportingDocsQuickPopover;
