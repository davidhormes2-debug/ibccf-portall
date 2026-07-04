import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Eye,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useFormat } from "@/i18n/format";
import { useAdminDashboard } from "../AdminDashboardContext";

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

type StatusFilter = "all" | "uploaded" | "reviewed" | "approved" | "rejected";

const STATUS_COLOR: Record<string, string> = {
  uploaded: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  reviewed: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
};

function isActionable(status: string | null) {
  return !status || status === "uploaded" || status === "reviewed";
}

interface Props {
  onOpenCase?: (caseId: string) => void;
}

/**
 * Cross-case admin "Supporting Documents" inbox. Lists supporting files
 * uploaded by case holders via POST /api/cases/:id/user-documents through
 * the admin endpoint GET /api/user-documents.
 *
 * Task #308 — initial cross-case browse view.
 * Task #309 — inline approve/reject with optimistic UI.
 * Task #446 — checkbox row selection + "Approve selected" / "Reject selected"
 *             contextual toolbar.
 *
 * Badge-refresh contract (Task #425):
 * After every successful approve/reject, `act()` calls `loadUserDocPendingCounts()`
 * directly (via `useAdminDashboard()`) to keep the per-case badge counts
 * accurate. If you add new action paths here, always call
 * `loadUserDocPendingCounts()` on success.
 */
export function SupportingDocumentsTab({ onOpenCase }: Props) {
  const { authToken, cases, userDocPendingCounts, loadUserDocPendingCounts } =
    useAdminDashboard();
  const { toast } = useToast();
  const { formatDateTime } = useFormat();

  const [docs, setDocs] = useState<SupportingDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("uploaded");
  const [caseIdFilter, setCaseIdFilter] = useState("");
  const [search, setSearch] = useState("");
  const [notesMap, setNotesMap] = useState<Record<number, string>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [bulkRejectConfirming, setBulkRejectConfirming] = useState(false);
  const [bulkRejectNotes, setBulkRejectNotes] = useState("");
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const pendingRef = useRef<Set<number>>(new Set());
  const previewClosedRef = useRef(false);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Selection state (Task #446)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectionRejectConfirming, setSelectionRejectConfirming] = useState(false);
  const [selectionRejectNotes, setSelectionRejectNotes] = useState("");
  const [selectionApproving, setSelectionApproving] = useState(false);
  const [selectionRejecting, setSelectionRejecting] = useState(false);
  const [selectionProgress, setSelectionProgress] = useState<{ done: number; total: number } | null>(null);

  // Refs mirroring current state for synchronous reads in event handlers and
  // debounced effects — avoids stale closures / updater side-effects (Task #508).
  const selectedIdsRef = useRef<Set<number>>(new Set());
  const docsRef = useRef<SupportingDoc[]>([]);

  // Separate display value for the case-ID input so typing stays responsive
  // while a pending filter-change confirmation is shown (Task #508).
  const [caseIdDisplay, setCaseIdDisplay] = useState("");

  // Filter-change pending confirmation (Task #508): when a filter change would
  // drop ALL current selections, stash the intended change here and prompt the
  // admin before proceeding — no fetch fires until they confirm.
  const [pendingFilterChange, setPendingFilterChange] = useState<{
    type: "status" | "caseId";
    newValue: string;
    droppedCount: number;
  } | null>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{
    fileName: string;
    fileData: string | null;
    fileType: string;
  } | null>(null);

  /**
   * When a filter-triggered reload fires we capture the first selected doc ID
   * here so the post-load useEffect can scroll it back into view (Task #507).
   */
  const pendingScrollTargetRef = useRef<number | null>(null);

  // Keep refs in sync so event handlers / debounces always read the latest
  // snapshot without relying on stale closures (Task #508).
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { docsRef.current = docs; }, [docs]);

  // Prune selectedIds when a doc's status changes in-place to a non-actionable
  // value while remaining in the array (e.g. approved/rejected via a side
  // panel or a concurrent admin session). The load() pruning (Task #455)
  // handles IDs that disappear from the response entirely; this effect handles
  // the status-only-changed case where the doc is still present but is no
  // longer actionable (Task #709).
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const actionableIdSet = new Set(
      docs.filter((d) => isActionable(d.status)).map((d) => d.id),
    );
    const pruned = new Set([...selectedIds].filter((id) => actionableIdSet.has(id)));
    if (pruned.size !== selectedIds.size) {
      setSelectedIds(pruned);
    }
  }, [docs]); // eslint-disable-line react-hooks/exhaustive-deps

  const authHeaders = (): Record<string, string> =>
    authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const trimmedCaseId = caseIdFilter.trim();
      if (trimmedCaseId) params.set("caseId", trimmedCaseId);
      const res = await fetch(
        `/api/user-documents${params.toString() ? `?${params}` : ""}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const data: SupportingDoc[] = Array.isArray(raw) ? raw : [];
      setDocs(data);
      // Preserve selections for IDs still present in the new result set;
      // drop any IDs that the server no longer returns (Task #455).
      const newIdSet = new Set(data.map((d) => d.id));
      setSelectedIds((prev) => new Set([...prev].filter((id) => newIdSet.has(id))));
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

  /**
   * Intercept status-filter changes before they reach state (Task #508).
   * If the new view has zero overlap with the current selection, show a
   * confirmation prompt instead of applying immediately.
   */
  const handleStatusFilterChange = (v: string) => {
    const newStatus = v as StatusFilter;
    const currentSelected = selectedIdsRef.current;
    if (currentSelected.size === 0) {
      setStatusFilter(newStatus);
      return;
    }
    const hasOverlap = docsRef.current.some((d) => {
      if (!currentSelected.has(d.id)) return false;
      return newStatus === "all" || (d.status ?? "uploaded") === newStatus;
    });
    if (hasOverlap) {
      // Partial/full overlap — apply immediately; surviving selections are
      // preserved by the Task #455 intersection logic inside load().
      // Dismiss any stale zero-overlap prompt that may still be visible.
      setPendingFilterChange(null);
      pendingScrollTargetRef.current = [...currentSelected][0] ?? null;
      setStatusFilter(newStatus);
    } else {
      // Zero overlap — ask before wiping the selection.
      setPendingFilterChange({
        type: "status",
        newValue: newStatus,
        droppedCount: currentSelected.size,
      });
    }
  };

  // Initial load + reload whenever an *applied* filter changes (Task #882).
  // Previously two separate effects — one keyed on [statusFilter], one on
  // [caseIdFilter] — both fired load() during the initial render, issuing two
  // identical GET /api/user-documents requests on mount. That wasted a
  // round-trip and let the second redundant fetch overwrite freshly-loaded
  // data (a subtle test/data race). Collapsing them into a single effect keyed
  // on both filters means mount fires exactly one fetch, while a change to
  // either filter still triggers a reload.
  useEffect(() => {
    // Capture first selected ID so we can scroll back to it after the reload (Task #507).
    if (selectedIds.size > 0) {
      pendingScrollTargetRef.current = [...selectedIds][0];
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, caseIdFilter]);

  // Watch the caseId *display* value (debounced, Task #508).  When the display
  // settles, check if any selected doc would survive before committing the
  // applied filter value.  Only zero-overlap changes are held for confirmation;
  // all others advance caseIdFilter immediately, which triggers the load() below.
  useEffect(() => {
    const handle = setTimeout(() => {
      const currentSelected = selectedIdsRef.current;
      if (currentSelected.size === 0) {
        setCaseIdFilter(caseIdDisplay);
        return;
      }
      const trimmed = caseIdDisplay.trim();
      const hasOverlap = docsRef.current.some((d) => {
        if (!currentSelected.has(d.id)) return false;
        return !trimmed || d.caseId.toLowerCase().includes(trimmed.toLowerCase());
      });
      if (hasOverlap) {
        // Dismiss any stale zero-overlap prompt that may still be visible.
        setPendingFilterChange(null);
        pendingScrollTargetRef.current = [...currentSelected][0] ?? null;
        setCaseIdFilter(caseIdDisplay);
      } else {
        setPendingFilterChange({
          type: "caseId",
          newValue: caseIdDisplay,
          droppedCount: currentSelected.size,
        });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [caseIdDisplay]);

  // (Re-fetch on applied caseId-filter changes is handled by the combined
  // mount/filter effect above — Task #882. The debounce + overlap check in the
  // caseIdDisplay effect still gates when caseIdFilter is allowed to advance.)

  // After a filter-triggered reload, scroll the first previously-selected row
  // back into view if it survived the new result set (Task #507).
  useEffect(() => {
    const targetId = pendingScrollTargetRef.current;
    if (targetId == null) return;
    pendingScrollTargetRef.current = null;
    requestAnimationFrame(() => {
      const row = document.querySelector(
        `[data-testid="row-supporting-doc-${targetId}"]`,
      );
      row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [docs]);

  const caseLookup = useMemo(() => {
    const m = new Map<string, { name: string; email: string }>();
    for (const c of cases) {
      m.set(c.id, {
        name: (c.userName ?? "").trim() || "—",
        email: c.userEmail ?? "",
      });
    }
    return m;
  }, [cases]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((doc) => {
      const c = caseLookup.get(doc.caseId);
      const haystack =
        `${doc.fileName} ${doc.category ?? ""} ${doc.description ?? ""} ${doc.caseId} ${c?.name ?? ""} ${c?.email ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [docs, search, caseLookup]);

  const pendingTotal = useMemo(
    () => Object.values(userDocPendingCounts).reduce((a, b) => a + b, 0),
    [userDocPendingCounts],
  );

  // Derived selection helpers (Task #446)
  const actionableFiltered = useMemo(
    () => filtered.filter((d) => isActionable(d.status)),
    [filtered],
  );
  const selectedActionableIds = useMemo(
    () => new Set([...selectedIds].filter((id) => {
      const doc = filtered.find((d) => d.id === id);
      return doc ? isActionable(doc.status) : false;
    })),
    [selectedIds, filtered],
  );
  const allActionableSelected =
    actionableFiltered.length > 0 &&
    actionableFiltered.every((d) => selectedIds.has(d.id));
  const someActionableSelected = selectedActionableIds.size > 0;

  const toggleSelectAll = () => {
    if (allActionableSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const d of actionableFiltered) next.delete(d.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const d of actionableFiltered) next.add(d.id);
        return next;
      });
    }
  };

  const toggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Approve a specific selection of documents (Task #446).
   */
  const approveSelected = async () => {
    const targets = filtered.filter(
      (d) => selectedActionableIds.has(d.id),
    );
    if (targets.length === 0) return;
    setSelectionApproving(true);
    setSelectionProgress({ done: 0, total: targets.length });
    let succeeded = 0;
    let failed = 0;
    try {
      const results = await Promise.allSettled(
        targets.map((doc) =>
          fetch(`/api/user-documents/${doc.id}`, {
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
            setSelectionProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev);
          }),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled") succeeded += 1;
        else failed += 1;
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
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of approvedIds) next.delete(id);
        return next;
      });
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
      setSelectionProgress(null);
      loadUserDocPendingCounts();
    }
  };

  /**
   * Reject a specific selection of documents (Task #446).
   */
  const rejectSelected = async () => {
    const targets = filtered.filter(
      (d) => selectedActionableIds.has(d.id),
    );
    if (targets.length === 0) return;
    setSelectionRejecting(true);
    setSelectionProgress({ done: 0, total: targets.length });
    const sharedNotes = selectionRejectNotes.trim() || undefined;
    let succeeded = 0;
    let failed = 0;
    try {
      const results = await Promise.allSettled(
        targets.map((doc) =>
          fetch(`/api/user-documents/${doc.id}`, {
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
            setSelectionProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev);
          }),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled") succeeded += 1;
        else failed += 1;
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
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of rejectedIds) next.delete(id);
        return next;
      });
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
      setSelectionProgress(null);
      loadUserDocPendingCounts();
      await load();
    }
  };

  /**
   * Bulk-approve all currently visible pending documents.
   *
   * Badge-refresh contract (Task #439): `loadUserDocPendingCounts()` is called
   * in the `finally` block so badge counts are refreshed even when some (or all)
   * individual PATCHes fail (partial-failure path).
   */
  const bulkApproveVisible = async () => {
    const targets = filtered.filter((d) => isActionable(d.status));
    if (targets.length === 0) return;
    setBulkApproving(true);
    setBulkProgress({ done: 0, total: targets.length });
    let succeeded = 0;
    let failed = 0;
    try {
      const results = await Promise.allSettled(
        targets.map((doc) =>
          fetch(`/api/user-documents/${doc.id}`, {
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
        if (r.status === "fulfilled") succeeded += 1;
        else failed += 1;
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
      setBulkProgress(null);
      loadUserDocPendingCounts();
    }
  };

  /**
   * Bulk-reject all currently visible pending documents.
   *
   * Badge-refresh contract (Task #442): `loadUserDocPendingCounts()` is called
   * in the `finally` block so badge counts are refreshed even when some (or all)
   * individual PATCHes fail (partial-failure path).
   */
  const bulkRejectVisible = async () => {
    const targets = filtered.filter((d) => isActionable(d.status));
    if (targets.length === 0) return;
    setBulkRejecting(true);
    setBulkProgress({ done: 0, total: targets.length });
    const sharedNotes = bulkRejectNotes.trim() || undefined;
    let succeeded = 0;
    let failed = 0;
    try {
      const results = await Promise.allSettled(
        targets.map((doc) =>
          fetch(`/api/user-documents/${doc.id}`, {
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
        if (r.status === "fulfilled") succeeded += 1;
        else failed += 1;
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
      setBulkProgress(null);
      loadUserDocPendingCounts();
    }
  };

  const act = async (doc: SupportingDoc, decision: "approved" | "rejected") => {
    if (pendingRef.current.has(doc.id)) return;
    pendingRef.current.add(doc.id);
    setActingId(doc.id);
    const notes = notesMap[doc.id] ?? "";

    const prevDocs = docs;
    setDocs((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, status: decision } : d)),
    );
    setExpandedId(null);

    try {
      const res = await fetch(`/api/user-documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          status: decision,
          adminNotes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as SupportingDoc;
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? updated : d)));
      toast({
        title:
          decision === "approved" ? "Document approved" : "Document rejected",
      });
    } catch (err) {
      setDocs(prevDocs);
      toast({
        variant: "destructive",
        title: "Action failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      pendingRef.current.delete(doc.id);
      setActingId(null);
      loadUserDocPendingCounts();
    }
  };

  const openPreview = async (doc: SupportingDoc) => {
    previewClosedRef.current = false;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewDoc({
      fileName: doc.fileName,
      fileData: null,
      fileType: doc.fileType,
    });
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

  /**
   * Scrolls the first currently-selected (and still-visible) row into view.
   * Used by the manual toolbar button and called automatically after a
   * filter-triggered reload (Task #507).
   */
  const scrollToFirstSelected = () => {
    const firstId = filtered.find((d) => selectedIds.has(d.id))?.id;
    if (firstId == null) return;
    const row = document.querySelector(
      `[data-testid="row-supporting-doc-${firstId}"]`,
    );
    row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const anyBulkBusy = bulkApproving || bulkRejecting || selectionApproving || selectionRejecting;

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <Upload className="w-5 h-5 text-amber-400" /> Supporting Documents
          </h2>
          <p className="text-slate-400 text-sm">
            Review every file uploaded directly by case holders across all
            cases — approve or reject inline without leaving this view.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {filtered.some((d) => isActionable(d.status)) && (
            <>
              <Button
                size="sm"
                disabled={anyBulkBusy || actingId !== null}
                onClick={() => void bulkApproveVisible()}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
                data-testid="button-bulk-approve-supporting-docs"
                title="Approve all currently visible pending documents"
              >
                {bulkApproving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    {bulkProgress
                      ? `Approving ${bulkProgress.done} of ${bulkProgress.total}…`
                      : "Approving…"}
                  </>
                ) : (
                  <>
                    <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
                    Approve all
                  </>
                )}
              </Button>
              {!bulkRejectConfirming && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={anyBulkBusy || actingId !== null}
                  onClick={() => setBulkRejectConfirming(true)}
                  data-testid="button-bulk-reject-supporting-docs"
                  title="Reject all currently visible pending documents"
                >
                  <XCircle className="w-3.5 h-3.5 mr-1.5" />
                  Reject all
                </Button>
              )}
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="border-slate-700 text-slate-200 hover:bg-slate-800"
            data-testid="button-refresh-supporting-docs"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {bulkRejectConfirming && (
        <div
          className="mb-4 rounded-lg border border-red-500/30 bg-red-950/20 p-4 space-y-3"
          data-testid="panel-bulk-reject-confirm-supporting-docs"
        >
          <p className="text-sm text-red-300 font-medium">
            Reject all {filtered.filter((d) => isActionable(d.status)).length} visible pending document{filtered.filter((d) => isActionable(d.status)).length === 1 ? "" : "s"}?
          </p>
          <Textarea
            placeholder="Reason for rejection (optional — applies to all rejected documents)"
            value={bulkRejectNotes}
            onChange={(e) => setBulkRejectNotes(e.target.value)}
            rows={2}
            disabled={bulkRejecting}
            className="text-xs bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none"
            data-testid="textarea-bulk-reject-notes-supporting-docs"
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
              data-testid="button-bulk-reject-cancel-supporting-docs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={bulkRejecting}
              onClick={() => void bulkRejectVisible()}
              className="h-7 text-xs bg-red-600 hover:bg-red-500 text-white"
              data-testid="button-bulk-reject-confirm-supporting-docs"
            >
              {bulkRejecting ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  {bulkProgress
                    ? `Rejecting ${bulkProgress.done} of ${bulkProgress.total}…`
                    : "Rejecting…"}
                </>
              ) : (
                <>
                  <X className="w-3 h-3 mr-1" />
                  Confirm rejection
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Selection toolbar — visible when ≥1 actionable row is checked (Task #446) */}
      {someActionableSelected && !selectionRejectConfirming && (
        <div
          className="mb-4 rounded-lg border border-blue-500/30 bg-blue-950/20 p-3 flex items-center gap-3 flex-wrap"
          data-testid="toolbar-selection-supporting-docs"
        >
          <span className="text-sm text-blue-200 font-medium">
            {selectedActionableIds.size} document{selectedActionableIds.size === 1 ? "" : "s"} selected
          </span>
          <Button
            size="sm"
            disabled={anyBulkBusy || actingId !== null}
            onClick={() => void approveSelected()}
            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
            data-testid="button-approve-selected-supporting-docs"
          >
            {selectionApproving ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                {selectionProgress
                  ? `Approving ${selectionProgress.done}/${selectionProgress.total}…`
                  : "Approving…"}
              </>
            ) : (
              <>
                <Check className="w-3 h-3 mr-1" />
                Approve selected
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={anyBulkBusy || actingId !== null}
            onClick={() => setSelectionRejectConfirming(true)}
            className="h-7 text-xs"
            data-testid="button-reject-selected-supporting-docs"
          >
            <X className="w-3 h-3 mr-1" />
            Reject selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={anyBulkBusy}
            onClick={() => setSelectedIds(new Set())}
            className="h-7 text-xs text-slate-400 hover:text-slate-200"
            data-testid="button-clear-selection-supporting-docs"
          >
            Clear selection
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={anyBulkBusy}
            onClick={scrollToFirstSelected}
            className="h-7 text-xs text-slate-400 hover:text-slate-200"
            data-testid="button-scroll-to-first-selected-supporting-docs"
            title="Scroll to the first selected document"
          >
            Scroll to selection
          </Button>
        </div>
      )}

      {/* Reject-selected confirmation panel (Task #446) */}
      {selectionRejectConfirming && (
        <div
          className="mb-4 rounded-lg border border-red-500/30 bg-red-950/20 p-4 space-y-3"
          data-testid="panel-selection-reject-confirm-supporting-docs"
        >
          <p className="text-sm text-red-300 font-medium">
            Reject {selectedActionableIds.size} selected document{selectedActionableIds.size === 1 ? "" : "s"}?
          </p>
          <Textarea
            placeholder="Reason for rejection (optional — applies to all selected documents)"
            value={selectionRejectNotes}
            onChange={(e) => setSelectionRejectNotes(e.target.value)}
            rows={2}
            disabled={selectionRejecting}
            className="text-xs bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none"
            data-testid="textarea-selection-reject-notes-supporting-docs"
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
              data-testid="button-selection-reject-cancel-supporting-docs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={selectionRejecting}
              onClick={() => void rejectSelected()}
              className="h-7 text-xs bg-red-600 hover:bg-red-500 text-white"
              data-testid="button-selection-reject-confirm-supporting-docs"
            >
              {selectionRejecting ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  {selectionProgress
                    ? `Rejecting ${selectionProgress.done}/${selectionProgress.total}…`
                    : "Rejecting…"}
                </>
              ) : (
                <>
                  <X className="w-3 h-3 mr-1" />
                  Confirm rejection
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Filter-change selection-clear confirmation (Task #508).
          No fetch has fired yet — the pending filter change is stored in state
          and only applied if the admin clicks "Continue". "Cancel" discards the
          change entirely so both the filter controls and the displayed data
          remain consistent with each other. */}
      {pendingFilterChange && (
        <div
          className="mb-4 rounded-lg border border-amber-500/30 bg-amber-950/20 p-4 space-y-3"
          data-testid="panel-filter-clear-confirm-supporting-docs"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-300 font-medium">
              Your {pendingFilterChange.droppedCount} selection{pendingFilterChange.droppedCount === 1 ? "" : "s"} will be cleared — the new filter view has no overlap. Continue?
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // Revert caseId display input to match the still-applied filter value
                // so there is no mismatch between input and displayed data.
                if (pendingFilterChange.type === "caseId") {
                  setCaseIdDisplay(caseIdFilter);
                }
                setPendingFilterChange(null);
              }}
              className="h-7 text-xs"
              data-testid="button-filter-clear-cancel-supporting-docs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                // Clear selections first, then advance the filter — the appropriate
                // useEffect will fire and call load() with the new filter value.
                setSelectedIds(new Set());
                if (pendingFilterChange.type === "status") {
                  setStatusFilter(pendingFilterChange.newValue as StatusFilter);
                } else {
                  setCaseIdFilter(pendingFilterChange.newValue);
                }
                setPendingFilterChange(null);
              }}
              className="h-7 text-xs bg-amber-600 hover:bg-amber-500 text-white"
              data-testid="button-filter-clear-continue-supporting-docs"
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* Counter strip */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card className="bg-slate-950 border-slate-800 p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide">
            Shown
          </p>
          <p className="text-2xl font-bold text-white">{filtered.length}</p>
        </Card>
        <Card className="bg-slate-950 border-slate-800 p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide">
            Pending across all cases
          </p>
          <p className="text-2xl font-bold text-amber-300" data-testid="supporting-docs-pending-total">{pendingTotal}</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-slate-950 border-slate-800 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Status</Label>
            <Select
              value={statusFilter}
              onValueChange={handleStatusFilterChange}
            >
              <SelectTrigger
                className="bg-slate-900 border-slate-700 text-slate-200"
                data-testid="select-filter-supporting-status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="uploaded">Uploaded — awaiting review</SelectItem>
                <SelectItem value="reviewed">Under review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Case ID</Label>
            <Input
              value={caseIdDisplay}
              onChange={(e) => setCaseIdDisplay(e.target.value)}
              placeholder="Filter by case ID"
              className="bg-slate-900 border-slate-700 text-slate-200"
              data-testid="filter-supporting-docs-case-id"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="File name, user name, email…"
              className="bg-slate-900 border-slate-700 text-slate-200"
              data-testid="input-filter-supporting-search"
            />
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="bg-slate-950 border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-900">
              <TableRow className="hover:bg-slate-900 border-slate-800">
                {/* Select-all checkbox — only enabled when there are actionable rows */}
                <TableHead className="w-10 text-slate-400 pl-3">
                  {actionableFiltered.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Select all actionable documents"
                      checked={allActionableSelected}
                      onChange={toggleSelectAll}
                      data-testid="checkbox-select-all-supporting-docs"
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800 accent-blue-500 cursor-pointer"
                    />
                  )}
                </TableHead>
                <TableHead className="text-slate-400">Uploaded</TableHead>
                <TableHead className="text-slate-400">Case / User</TableHead>
                <TableHead className="text-slate-400">File</TableHead>
                <TableHead className="text-slate-400">Category</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && filtered.length === 0 ? (
                [...Array(3)].map((_, i) => (
                  <TableRow
                    key={i}
                    className="hover:bg-transparent border-slate-800 animate-pulse"
                  >
                    <TableCell colSpan={7}>
                      <div className="h-10 bg-slate-900/60 rounded" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow className="hover:bg-transparent border-slate-800">
                  <TableCell
                    colSpan={7}
                    className="text-center py-12 text-slate-500"
                    data-testid="supporting-docs-empty"
                  >
                    No supporting documents match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((doc) => {
                  const c = caseLookup.get(doc.caseId);
                  const status = doc.status ?? "uploaded";
                  const actionable = isActionable(doc.status);
                  const isExpanded = expandedId === doc.id;
                  const acting = actingId === doc.id;
                  const isChecked = selectedIds.has(doc.id);

                  return (
                    <Fragment key={doc.id}>
                      <TableRow
                        className="hover:bg-slate-900/50 border-slate-800 align-top"
                        data-testid={`row-supporting-doc-${doc.id}`}
                      >
                        {/* Per-row checkbox — only actionable docs can be checked */}
                        <TableCell className="pl-3 w-10">
                          {actionable && (
                            <input
                              type="checkbox"
                              aria-label={`Select document ${doc.fileName}`}
                              checked={isChecked}
                              onChange={() => toggleRow(doc.id)}
                              data-testid={`checkbox-supporting-doc-${doc.id}`}
                              className="h-4 w-4 rounded border-slate-600 bg-slate-800 accent-blue-500 cursor-pointer"
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-slate-300 text-xs whitespace-nowrap">
                          {new Date(doc.uploadedAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium text-white truncate max-w-[180px]">
                            {c?.name || "—"}
                          </div>
                          <div className="text-slate-500 truncate max-w-[180px]">
                            {c?.email || "—"}
                          </div>
                          <div className="text-slate-600 font-mono text-[10px] mt-0.5 truncate max-w-[180px]">
                            {onOpenCase ? (
                              <button
                                type="button"
                                onClick={() => onOpenCase(doc.caseId)}
                                className="text-blue-400 hover:text-blue-300 hover:underline"
                                data-testid={`link-supporting-doc-case-${doc.id}`}
                              >
                                {doc.caseId.slice(0, 8)}…
                              </button>
                            ) : (
                              doc.caseId
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-start gap-1.5 min-w-0">
                            <FileText className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p
                                className="text-slate-200 font-medium truncate max-w-[200px]"
                                title={doc.fileName}
                              >
                                {doc.fileName}
                              </p>
                              {doc.fileSize && (
                                <p className="text-slate-600 text-[10px]">
                                  {doc.fileSize}
                                </p>
                              )}
                              {doc.description && (
                                <p className="text-slate-500 text-[11px] mt-0.5 line-clamp-2 max-w-[200px]">
                                  {doc.description}
                                </p>
                              )}
                              {doc.adminNotes && (
                                <p className="text-amber-300/80 text-[11px] mt-0.5 italic">
                                  Note: {doc.adminNotes}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {doc.category ?? "general"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize border ${STATUS_COLOR[status] ?? STATUS_COLOR.uploaded}`}
                          >
                            {status}
                          </Badge>
                          {doc.reviewedBy && (
                            <p
                              className="text-[10px] text-slate-500 mt-0.5"
                              data-testid={`supdoc-tab-reviewer-${doc.id}`}
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
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-slate-400 hover:text-slate-200"
                              title="Preview file"
                              onClick={() => openPreview(doc)}
                              data-testid={`button-preview-supporting-doc-${doc.id}`}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            {onOpenCase && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-blue-300 hover:text-blue-200"
                                onClick={() => onOpenCase(doc.caseId)}
                                data-testid={`btn-open-supporting-doc-case-${doc.id}`}
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {actionable && (
                              <>
                                <Button
                                  size="sm"
                                  disabled={acting || anyBulkBusy}
                                  onClick={() => act(doc, "approved")}
                                  className="h-7 px-2 text-xs bg-emerald-600/80 hover:bg-emerald-500 text-white"
                                  data-testid={`button-approve-supporting-doc-${doc.id}`}
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
                                  variant="outline"
                                  disabled={acting || anyBulkBusy}
                                  onClick={() =>
                                    setExpandedId(isExpanded ? null : doc.id)
                                  }
                                  className="h-7 px-2 text-xs border-red-500/40 text-red-300 hover:bg-red-500/10"
                                  data-testid={`button-reject-supporting-doc-${doc.id}`}
                                >
                                  {acting ? (
                                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                  ) : (
                                    <X className="h-3 w-3 mr-1" />
                                  )}
                                  Reject
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {isExpanded && actionable && (
                        <TableRow
                          key={`${doc.id}-reject`}
                          className="hover:bg-transparent border-slate-800"
                        >
                          <TableCell
                            colSpan={7}
                            className="bg-red-950/10 py-2 px-4"
                          >
                            <div className="space-y-2 max-w-lg">
                              <Textarea
                                placeholder="Admin notes for the user (optional)"
                                value={notesMap[doc.id] ?? ""}
                                onChange={(e) =>
                                  setNotesMap((prev) => ({
                                    ...prev,
                                    [doc.id]: e.target.value,
                                  }))
                                }
                                rows={2}
                                className="text-xs bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none"
                                data-testid={`textarea-reject-supporting-doc-${doc.id}`}
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setExpandedId(null);
                                    setNotesMap((prev) => ({
                                      ...prev,
                                      [doc.id]: "",
                                    }));
                                  }}
                                  className="h-7 text-xs"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={acting || anyBulkBusy}
                                  onClick={() => act(doc, "rejected")}
                                  className="h-7 text-xs bg-red-600 hover:bg-red-500 text-white"
                                  data-testid={`button-confirm-reject-supporting-doc-${doc.id}`}
                                >
                                  {acting && (
                                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                  )}
                                  Confirm rejection
                                </Button>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* File preview dialog */}
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
    </>
  );
}

export default SupportingDocumentsTab;
