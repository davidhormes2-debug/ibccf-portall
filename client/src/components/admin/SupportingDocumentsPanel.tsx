import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useFormat } from "@/i18n/format";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SupportingDoc = {
  id: number;
  caseId: string;
  fileName: string;
  fileType: string;
  fileSize: string | null;
  category: string | null;
  description: string | null;
  status: string | null;
  adminNotes: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  uploadedAt: string;
};

const STATUS_COLOR: Record<string, string> = {
  uploaded: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  reviewed: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  approved: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/20 text-red-300 border-red-500/30",
};

interface Props {
  caseId: string;
  authToken: string | null;
  onActioned?: () => void;
}

const lastViewedKey = (caseId: string) =>
  `ibccf.supdocs.lastViewed:${caseId}`;

function readLastViewed(caseId: string): number {
  try {
    const raw = window.localStorage.getItem(lastViewedKey(caseId));
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeLastViewed(caseId: string, ts: number) {
  try {
    window.localStorage.setItem(lastViewedKey(caseId), String(ts));
  } catch {
    /* ignore */
  }
}

/**
 * Badge-refresh contract (Task #425):
 * This component fires `onActioned?.()` after every successful approve/reject
 * so the caller can refresh `loadUserDocPendingCounts`. The caller in
 * AdminDashboard.tsx wires `onActioned={loadUserDocPendingCounts}`.
 * If you add new action paths here, always call `onActioned?.()` on success.
 */
export function SupportingDocumentsPanel({ caseId, authToken, onActioned }: Props) {
  const { toast } = useToast();
  const { formatDateTime } = useFormat();
  const reducedMotion = useReducedMotion();
  const fadeTransition = reducedMotion ? { duration: 0 } : { duration: 0.15, ease: "easeInOut" as const };
  const [docs, setDocs] = useState<SupportingDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const pendingRef = useRef<Set<number>>(new Set());
  const [notesMap, setNotesMap] = useState<Record<number, string>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Capture lastViewed once per mount so the "New" badge stays visible while
  // the admin reviews the list. The stored value is bumped to the latest
  // uploadedAt when the component unmounts (or when the admin manually clears).
  const lastViewedRef = useRef<number>(0);
  const latestUploadedAtRef = useRef<number>(0);
  const previewClosedRef = useRef(false);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{
    fileName: string;
    fileData: string | null;
    fileType: string;
  } | null>(null);

  // Bulk approve state
  const [bulkApproving, setBulkApproving] = useState(false);

  // Bulk reject state
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [bulkRejectConfirming, setBulkRejectConfirming] = useState(false);
  const [bulkRejectNotes, setBulkRejectNotes] = useState("");

  // Selection state (Task #454)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectionApproving, setSelectionApproving] = useState(false);
  const [selectionRejecting, setSelectionRejecting] = useState(false);
  const [selectionRejectConfirming, setSelectionRejectConfirming] = useState(false);
  const [selectionRejectNotes, setSelectionRejectNotes] = useState("");

  const authHeaders = (): Record<string, string> =>
    authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/user-documents`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const data: SupportingDoc[] = Array.isArray(raw) ? raw : [];
      setDocs(data);
      const latest = data.reduce((max, d) => {
        const t = new Date(d.uploadedAt).getTime();
        return Number.isFinite(t) && t > max ? t : max;
      }, 0);
      latestUploadedAtRef.current = latest;
    } catch (err) {
      setDocs([]);
      toast({
        variant: "destructive",
        title: "Failed to load supporting documents",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!caseId) return;
    lastViewedRef.current = readLastViewed(caseId);
    load();
    return () => {
      if (latestUploadedAtRef.current > 0) {
        writeLastViewed(caseId, latestUploadedAtRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const markAllSeen = () => {
    if (latestUploadedAtRef.current > 0) {
      writeLastViewed(caseId, latestUploadedAtRef.current);
      lastViewedRef.current = latestUploadedAtRef.current;
      // Force re-render so badges disappear immediately.
      setDocs((prev) => [...prev]);
    }
  };

  const newCount = docs.reduce((n, d) => {
    const t = new Date(d.uploadedAt).getTime();
    return Number.isFinite(t) && t > lastViewedRef.current ? n + 1 : n;
  }, 0);

  const isActionable = (status: string | null) =>
    !status || status === "uploaded" || status === "reviewed";

  const pendingDocs = docs.filter((d) => isActionable(d.status));
  const isBusy = bulkApproving || bulkRejecting || actingId !== null || selectionApproving || selectionRejecting;

  const allActionableSelected =
    pendingDocs.length > 0 && pendingDocs.every((d) => selectedIds.has(d.id));

  const toggleSelectAll = () => {
    if (allActionableSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingDocs.map((d) => d.id)));
    }
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const approveSelected = async () => {
    const targets = pendingDocs.filter((d) => selectedIds.has(d.id));
    if (targets.length === 0) return;
    setSelectionApproving(true);
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
        title: "Approve selected failed",
        description: "An unexpected error occurred.",
      });
    } finally {
      setSelectionApproving(false);
      setSelectedIds(new Set());
      await load();
      onActioned?.();
    }
  };

  const rejectSelected = async () => {
    const targets = pendingDocs.filter((d) => selectedIds.has(d.id));
    if (targets.length === 0) return;
    setSelectionRejecting(true);
    const sharedNotes = selectionRejectNotes.trim() || undefined;
    let succeeded = 0;
    let failed = 0;
    try {
      const results = await Promise.allSettled(
        targets.map((doc) =>
          fetch(`/api/admin/user-documents/${doc.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              status: "rejected",
              ...(sharedNotes ? { adminNotes: sharedNotes } : {}),
            }),
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
        title: "Reject selected failed",
        description: "An unexpected error occurred.",
      });
    } finally {
      setSelectionRejecting(false);
      setSelectionRejectConfirming(false);
      setSelectionRejectNotes("");
      setSelectedIds(new Set());
      await load();
      onActioned?.();
    }
  };

  const act = async (doc: SupportingDoc, decision: "approved" | "rejected") => {
    if (pendingRef.current.has(doc.id)) return;
    pendingRef.current.add(doc.id);
    setActingId(doc.id);
    try {
      const notes = notesMap[doc.id] ?? "";
      const res = await fetch(`/api/admin/user-documents/${doc.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          status: decision,
          adminNotes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      toast({
        title:
          decision === "approved"
            ? "Document approved"
            : "Document rejected",
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
      await load();
      setExpandedId(null);
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
   * Bulk-approve all currently pending docs.
   *
   * Badge-refresh contract (Task #445): `onActioned?.()` is called in the
   * `finally` block so the per-case badge count is always refreshed — even
   * when some (or all) individual PATCHes fail.
   */
  const bulkApprove = async () => {
    const targets = pendingDocs;
    if (targets.length === 0) return;
    setBulkApproving(true);
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
      setDocs((prev) =>
        prev.map((d) =>
          approvedIds.has(d.id) ? { ...d, status: "approved" } : d,
        ),
      );
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
      await load();
      onActioned?.();
    }
  };

  /**
   * Bulk-reject all currently pending docs.
   *
   * Badge-refresh contract (Task #445): `onActioned?.()` is called in the
   * `finally` block so the per-case badge count is always refreshed — even
   * when some (or all) individual PATCHes fail (partial-failure path).
   */
  const bulkReject = async () => {
    const targets = pendingDocs;
    if (targets.length === 0) return;
    setBulkRejecting(true);
    const sharedNotes = bulkRejectNotes.trim() || undefined;
    let succeeded = 0;
    let failed = 0;
    try {
      const results = await Promise.allSettled(
        targets.map((doc) =>
          fetch(`/api/admin/user-documents/${doc.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              status: "rejected",
              ...(sharedNotes ? { adminNotes: sharedNotes } : {}),
            }),
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
      setDocs((prev) =>
        prev.map((d) =>
          rejectedIds.has(d.id) ? { ...d, status: "rejected" } : d,
        ),
      );
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
      await load();
      onActioned?.();
    }
  };

  const openPreview = async (doc: SupportingDoc) => {
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
      if (mountedRef.current) {
        setPreviewDoc({
          fileName: data.fileName,
          fileData: data.fileData,
          fileType: data.fileType,
        });
      }
    } catch (err) {
      if (!previewClosedRef.current && mountedRef.current) {
        toast({
          variant: "destructive",
          title: "Preview failed",
          description: err instanceof Error ? err.message : "Unknown error",
        });
        setPreviewOpen(false);
      }
    } finally {
      if (mountedRef.current) {
        setPreviewLoading(false);
      }
    }
  };

  return (
    <AnimatePresence initial={false}>
      {loading ? (
        <motion.div
          key="sdp-loading"
          exit={{ opacity: 0 }}
          transition={fadeTransition}
        >
          <div className="flex items-center justify-center py-6 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading…
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="sdp-content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={fadeTransition}
        >
    <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex items-center gap-2">
          {pendingDocs.length > 0 && (
            <input
              type="checkbox"
              data-testid="checkbox-panel-select-all"
              checked={allActionableSelected}
              onChange={toggleSelectAll}
              disabled={isBusy}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-amber-400 cursor-pointer shrink-0"
              title={allActionableSelected ? "Deselect all" : "Select all actionable"}
            />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-200">
                Supporting Documents
              </h4>
              {newCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-300 border-amber-500/40"
                  data-testid="supdocs-new-count"
                >
                  {newCount} new
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Files uploaded directly by the case holder.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {newCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllSeen}
              className="h-7 px-2 text-xs text-amber-300 hover:text-amber-200"
              title="Mark all as seen"
            >
              Mark seen
            </Button>
          )}
          {pendingDocs.length >= 2 && (
            <>
              <Button
                size="sm"
                disabled={isBusy}
                onClick={() => void bulkApprove()}
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                data-testid="panel-bulk-approve"
                title="Approve all pending documents"
              >
                {bulkApproving ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    Approving…
                  </>
                ) : (
                  <>
                    <CheckCheck className="h-3 w-3 mr-1" />
                    Approve all
                  </>
                )}
              </Button>
              {!bulkRejectConfirming && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isBusy}
                  onClick={() => setBulkRejectConfirming(true)}
                  className="h-7 text-xs"
                  data-testid="panel-bulk-reject"
                  title="Reject all pending documents"
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  Reject all
                </Button>
              )}
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={load}
            className="h-7 w-7 p-0 text-slate-400 hover:text-slate-200"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {selectedIds.size > 0 && !selectionRejectConfirming && (
        <div
          className="flex items-center gap-2 rounded-md border border-slate-700/60 bg-slate-800/50 px-3 py-1.5"
          data-testid="toolbar-panel-selection"
        >
          <span className="text-xs text-slate-300 font-medium mr-1">
            {selectedIds.size} document{selectedIds.size === 1 ? "" : "s"} selected
          </span>
          <Button
            size="sm"
            disabled={isBusy}
            onClick={() => void approveSelected()}
            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
            data-testid="button-panel-approve-selected"
          >
            {selectionApproving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Approving…
              </>
            ) : (
              <>
                <Check className="h-3 w-3 mr-1" />
                Approve selected
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={isBusy}
            onClick={() => setSelectionRejectConfirming(true)}
            className="h-7 text-xs"
            data-testid="button-panel-reject-selected"
          >
            <X className="h-3 w-3 mr-1" />
            Reject selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isBusy}
            onClick={() => setSelectedIds(new Set())}
            className="h-7 text-xs text-slate-400 hover:text-slate-200 ml-auto"
            data-testid="button-panel-clear-selection"
          >
            Clear
          </Button>
        </div>
      )}

      {selectionRejectConfirming && (
        <div
          className="rounded-md border border-red-800/50 bg-red-950/20 p-3 space-y-2"
          data-testid="panel-selection-reject-confirm"
        >
          <p className="text-xs text-red-300 font-medium">
            Reject {selectedIds.size} selected document{selectedIds.size === 1 ? "" : "s"}?
          </p>
          <Textarea
            value={selectionRejectNotes}
            onChange={(e) => setSelectionRejectNotes(e.target.value)}
            placeholder="Reason for rejection (optional — applies to all selected)"
            rows={2}
            disabled={selectionRejecting}
            className="text-xs bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-500 resize-none min-h-[48px]"
            data-testid="textarea-panel-selection-reject-notes"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={selectionRejecting}
              onClick={() => {
                setSelectionRejectConfirming(false);
                setSelectionRejectNotes("");
              }}
              className="h-7 text-xs"
              data-testid="button-panel-selection-reject-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={selectionRejecting}
              onClick={() => void rejectSelected()}
              className="h-7 text-xs"
              data-testid="button-panel-selection-reject-confirm"
            >
              {selectionRejecting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Rejecting…
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

      {bulkRejectConfirming && (
        <div
          className="rounded-md border border-red-800/50 bg-red-950/20 p-3 space-y-2"
          data-testid="panel-bulk-reject-confirm"
        >
          <p className="text-xs text-red-300 font-medium">
            Reject all {pendingDocs.length} pending document{pendingDocs.length === 1 ? "" : "s"}?
          </p>
          <Textarea
            value={bulkRejectNotes}
            onChange={(e) => setBulkRejectNotes(e.target.value)}
            placeholder="Reason for rejection (optional — applies to all)"
            rows={2}
            disabled={bulkRejecting}
            className="text-xs bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-500 resize-none min-h-[48px]"
            data-testid="panel-bulk-reject-notes"
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
              data-testid="panel-bulk-reject-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={bulkRejecting}
              onClick={() => void bulkReject()}
              className="h-7 text-xs"
              data-testid="panel-bulk-reject-confirm-btn"
            >
              {bulkRejecting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Rejecting…
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

      {docs.length === 0 ? (
        <p className="text-xs text-slate-500 py-2">
          No supporting documents uploaded yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {docs.map((doc) => {
            const isExpanded = expandedId === doc.id;
            const acting = actingId === doc.id;
            const status = doc.status ?? "uploaded";
            const uploadedTs = new Date(doc.uploadedAt).getTime();
            const isNew =
              Number.isFinite(uploadedTs) && uploadedTs > lastViewedRef.current;
            return (
              <li
                key={doc.id}
                className="rounded-md border border-slate-800 bg-slate-900/50 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    {isActionable(doc.status) && (
                      <input
                        type="checkbox"
                        data-testid={`checkbox-panel-doc-${doc.id}`}
                        checked={selectedIds.has(doc.id)}
                        onChange={() => toggleSelectOne(doc.id)}
                        disabled={isBusy}
                        className="h-3.5 w-3.5 mt-0.5 rounded border-slate-600 bg-slate-800 accent-amber-400 cursor-pointer shrink-0"
                      />
                    )}
                    <FileText className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p
                        className="text-sm text-slate-200 font-medium truncate flex items-center gap-2"
                        title={doc.fileName}
                      >
                        <span className="truncate">{doc.fileName}</span>
                        {isNew && (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-300 border-amber-500/40 shrink-0"
                          >
                            New
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {doc.category ?? "general"} ·{" "}
                        {new Date(doc.uploadedAt).toLocaleDateString()}
                        {doc.fileSize ? ` · ${doc.fileSize}` : ""}
                      </p>
                      {doc.description && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {doc.description}
                        </p>
                      )}
                      {doc.adminNotes && !isExpanded && (
                        <p className="text-xs text-amber-300/80 mt-0.5">
                          Note: {doc.adminNotes}
                        </p>
                      )}
                      {doc.reviewedBy && (
                        <p
                          className="text-[11px] text-slate-500 mt-0.5"
                          data-testid={`supdoc-reviewer-${doc.id}`}
                          title={
                            doc.reviewedAt
                              ? `Reviewed by ${doc.reviewedBy} on ${formatDateTime(doc.reviewedAt)}`
                              : `Reviewed by ${doc.reviewedBy}`
                          }
                        >
                          Reviewed by {doc.reviewedBy}
                          {doc.reviewedAt
                            ? ` on ${formatDateTime(doc.reviewedAt)}`
                            : ""}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge
                      variant="outline"
                      className={`text-xs ${STATUS_COLOR[status] ?? STATUS_COLOR.uploaded}`}
                    >
                      {status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-slate-400 hover:text-slate-200"
                      title="Preview file"
                      data-testid={`button-panel-preview-${doc.id}`}
                      onClick={() => openPreview(doc)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    {isActionable(doc.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-slate-400 hover:text-slate-200"
                        title={isExpanded ? "Collapse" : "Review"}
                        data-testid={`button-panel-expand-${doc.id}`}
                        onClick={() =>
                          setExpandedId(isExpanded ? null : doc.id)
                        }
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {isExpanded && isActionable(doc.status) && (
                  <div className="space-y-2 pt-1 border-t border-slate-800">
                    <Textarea
                      placeholder="Admin notes (optional)"
                      value={notesMap[doc.id] ?? ""}
                      onChange={(e) =>
                        setNotesMap((prev) => ({
                          ...prev,
                          [doc.id]: e.target.value,
                        }))
                      }
                      rows={2}
                      className="text-xs bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none"
                      data-testid={`textarea-panel-doc-notes-${doc.id}`}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={acting}
                        onClick={() => act(doc, "approved")}
                        className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                        data-testid={`button-panel-approve-${doc.id}`}
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
                        data-testid={`button-panel-reject-${doc.id}`}
                      >
                        {acting ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <X className="h-3 w-3 mr-1" />
                        )}
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={previewOpen} onOpenChange={(open) => { if (!open) previewClosedRef.current = true; setPreviewOpen(open); }}>
        <DialogContent className="max-w-3xl bg-slate-950 border-slate-800 text-white max-h-[90vh] overflow-y-auto">
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
    </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
