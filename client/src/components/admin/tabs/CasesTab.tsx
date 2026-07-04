import { useEffect, useMemo, useState } from "react";
import type { RefundClaimStatusFilter } from "@shared/types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CasesKpiStrip } from "@/components/admin/CasesKpiStrip";
import { CaseFilterPresets } from "@/components/admin/CaseFilterPresets";
import {
  Plus,
  RefreshCw,
  Trash2,
  FileText,
  ShieldAlert,
  X,
  UserCheck,
  Edit3,
  MailCheck,
  Mail,
  History,
  MessageCircle,
  Bell,
  Image,
  Scale,
  FileSignature,
  ShieldCheck,
  AlertTriangle,
  Copy,
  RotateCcw,
  Eye,
  Pencil,
  LogOut,
  Lock,
  LockOpen,
  Unlock,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Stamp,
  AlertCircle,
  Layers,
  Ban,
  ToggleLeft,
  ChevronRight,
  ChevronLeft,
  CheckCheck,
  Check,
  Filter,
  LayoutDashboard,
  Wallet,
  MapPin,
  BellOff,
  FileDown,
  Fingerprint,
} from "lucide-react";
import { useAdminDashboard } from "../AdminDashboardContext";
import { SupportingDocsQuickPopover } from "@/components/admin/SupportingDocsQuickPopover";
import type { Case } from "@/components/admin/shared";
import { AdminCaseLedgerDialog } from "@/components/admin/AdminCaseLedgerDialog";
import { BookOpen, Award, KeyRound } from "lucide-react";
import { checkHasActiveSession } from "@/lib/rotateAccessCodeSession";
import { RefundClaimRequestDialog } from "@/components/admin/RefundClaimRequestDialog";
import { RefundClaimReviewDialog } from "@/components/admin/RefundClaimReviewDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SUPPORTED_LOCALES } from "@/i18n";
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { STAGE_INSTRUCTIONS } from "@shared/stageInstructions";
import { STAGE_SHORT_LABELS, QUICK_SEND_TEMPLATES } from "@/lib/adminEmailTemplates";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import { ExpandableFailureList, type FailureEntry } from "@/components/portal/ExpandableFailureList";

// Exhaustiveness helper — causes a compile error if a new union member is
// passed without adding a branch to the calling switch/ternary chain.
function assertNeverRefundStatus(x: never): never {
  throw new Error(`Unhandled refund claim status: ${String(x)}`);
}

// Chip label map for the refund-claim filter chip.  The key type is derived
// directly from the context union (minus "all") so TypeScript will flag this
// record as incomplete the moment a new status value is added to the union.
type RefundClaimStatusActive = Exclude<
  AdminDashboardContextValue["refundClaimStatusFilter"],
  "all"
>;
const REFUND_CLAIM_STATUS_LABELS: Record<RefundClaimStatusActive, string> = {
  pending_submission: "Pending submission",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

// Exhaustiveness helper for the case-status chip.  TypeScript narrows
// c.status to `never` once every union member is covered; passing it here
// without a cast produces a compile error when a new status is added.
function assertNeverCaseStatus(x: never): never {
  throw new Error(`Unhandled case status: ${String(x)}`);
}

// Typed class map for the case-status chip.  The key type is derived
// directly from Case["status"] so TypeScript flags this record as
// incomplete the moment a new status value is added to the Case interface.
type CaseStatusActive = Case["status"];
export const CASE_STATUS_CLASSES: Record<CaseStatusActive, string> = {
  created:    "text-slate-400 border-slate-700",
  registered: "text-blue-400 border-blue-700 bg-blue-500/10",
  syncing:    "text-amber-400 border-amber-700 bg-amber-500/10 animate-pulse",
  active:     "text-green-400 border-green-700 bg-green-500/10",
  completed:  "text-purple-400 border-purple-700 bg-purple-500/10",
  sealed:     "text-indigo-200 border-indigo-600 bg-indigo-500/10",
};

// Portal landing-page options surfaced wherever an admin can set
// `cases.landingPage`. Values match the ViewState enum consumed by
// PortalContext / AuthViews — unknown values fall back to 'dashboard'
// at the portal, so the dropdown is the safe authoring surface.
const LANDING_PAGE_OPTIONS: Array<{
  value: string;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { value: "dashboard", label: "Dashboard (Default)", icon: LayoutDashboard },
  { value: "letter", label: "Withdrawal Letter", icon: FileText },
  { value: "deposit", label: "Deposit Information", icon: Wallet },
  { value: "messages", label: "Required Actions", icon: Bell },
  { value: "chat", label: "Support Chat", icon: MessageCircle },
  { value: "history", label: "Submission History", icon: History },
];

const BULK_DEPOSIT_COINS = ["USDT", "USDC", "BTC", "ETH", "BNB", "BUSD", "DAI", "TRX"] as const;
const BULK_DEPOSIT_NETWORKS = [
  "TRC20 (TRON)",
  "ERC20 (Ethereum)",
  "BEP20 (BSC)",
  "Polygon",
  "Solana",
  "Avalanche (C-Chain)",
  "Arbitrum",
  "Optimism",
  "Bitcoin",
] as const;

const BULK_COIN_NETWORK_MAP: Record<string, string[]> = {
  USDT: ["TRC20 (TRON)", "ERC20 (Ethereum)", "BEP20 (BSC)", "Polygon", "Solana", "Avalanche (C-Chain)", "Arbitrum", "Optimism"],
  USDC: ["ERC20 (Ethereum)", "BEP20 (BSC)", "Polygon", "Solana", "Avalanche (C-Chain)", "Arbitrum", "Optimism"],
  BTC: ["Bitcoin"],
  ETH: ["ERC20 (Ethereum)", "Arbitrum", "Optimism"],
  BNB: ["BEP20 (BSC)"],
  BUSD: ["BEP20 (BSC)", "ERC20 (Ethereum)"],
  DAI: ["ERC20 (Ethereum)", "BEP20 (BSC)", "Polygon", "Arbitrum", "Optimism"],
  TRX: ["TRC20 (TRON)"],
};

function isValidBulkAmount(val: string): boolean {
  const n = parseFloat(val.trim());
  return val.trim() !== "" && !isNaN(n) && n > 0 && isFinite(n);
}

function buildBulkEmailTemplates(coin = "USDT", network = "TRC20 (TRON)", amount = "750"): { label: string; subject: string; body: string }[] {
  return [
    {
      label: "Access Window Renewal Required",
      subject: "Important: Your Case Portal — Access Window Renewal Required",
      body: `Dear [User Name],

We are writing to inform you that your active portal session has entered a compliance-mandated refresh cycle, which has temporarily suspended your access to the IBCCF case management portal until a brief renewal process is completed.

WHY THIS HAS HAPPENED

Your case portal operates within a defined access window — a secure, time-bounded environment provisioned specifically for your case. Think of this in the same way you would think about cloud storage or a safety deposit box: the service provider allocates dedicated, encrypted capacity on your behalf, and that allocation must be periodically confirmed to remain active. When an access window expires without renewal confirmation, the system automatically gates access to protect both you and the integrity of your case.

This is not a penalty or a sign of any issue with your case. It is a mandatory checkpoint built into the platform's security architecture. Every active case holder goes through this process.

WHAT IS REQUIRED

To restore your portal access and resume case activity, a Refundable Access Renewal Deposit of ${amount} ${coin} per declaration is required. Here is what you need to know:

  • The deposit amount is ${amount} ${coin} per declaration on your case.
  • Payment must be sent in ${coin} on the ${network} network — deposits on any other network cannot be credited.
  • The deposit is entirely refundable — it is held in trust against your case and returned to you at the conclusion of the withdrawal process, alongside your case settlement.
  • It is not a fee. No portion of this amount is retained by IBCCF as a charge for the renewal itself.
  • Once your deposit is received and verified, your access window will be reinstated immediately.

Coin: ${coin}
Network: ${network}

WHY THIS CANNOT BE BYPASSED

The access window framework is a regulatory compliance requirement tied to the security layer governing your case file. When a window lapses, the platform automatically moves your case into a protected hold state. This cannot be overridden by our compliance team, cannot be waived, and cannot be deferred — the system architecture does not permit manual session re-injection without a confirmed deposit, because doing so would break the cryptographic audit trail your case depends on for its legal and regulatory standing.

Attempting to access the portal through alternative means (direct URLs, cached sessions, third-party tools) will not succeed. The protection operates at the authentication infrastructure level, not at the interface level.

YOUR CASE IS FULLY SECURE

  • All of your case documents, correspondence, and progress are fully preserved and unaffected.
  • No deadlines within your case file are impacted by this renewal period.
  • Your personal information remains encrypted and accessible only to authorised parties.
  • This renewal in no way affects the outcome or timeline of your settlement process.

NEXT STEPS

Please log in to the portal using your case access credentials and follow the on-screen instructions to complete the Access Window Renewal. Once your ${amount} ${coin} deposit on the ${network} network has been processed and confirmed, your portal access will be restored.

If you have any questions, please contact our compliance team via the secure messaging feature in your portal.

We appreciate your cooperation and understanding.

Warm regards,
IBCCF Compliance Management Team
ISO-D Compliance & Case Resolution Division`,
    },
    {
      label: "Access Window Renewal — Reminder",
      subject: "Reminder: Access Window Renewal Still Outstanding",
      body: `Dear [User Name],

This is a follow-up to our previous message. Our records indicate that your Access Window Renewal is still outstanding and your portal access remains suspended.

As outlined in our previous correspondence, the renewal requires a Refundable Access Renewal Deposit of ${amount} ${coin} per declaration sent on the ${network} network to reactivate your dedicated session environment. This deposit is held entirely in trust and is returned to you as part of your case settlement — it is not a fee or a charge.

Please ensure you send ${coin} specifically on the ${network} network. Deposits sent on any other network cannot be credited to your case.

Coin: ${coin}
Network: ${network}

Until the renewal is completed, your portal access cannot be restored. The compliance checkpoint is enforced at the infrastructure level and cannot be bypassed or deferred by our team.

Your case data, documents, and withdrawal progress are fully preserved and secure. Completing the renewal promptly will allow your case to continue without further delay.

To proceed, please log in to the portal with your access credentials and follow the on-screen instructions.

If you have any questions, please reach out via the secure messaging feature in your portal.

Regards,
IBCCF Compliance Management Team
ISO-D Compliance & Case Resolution Division`,
    },
  ];
}

export function CasesTab() {
  const {
    cases,
    filteredCases,
    isDataLoading,
    unreadCounts,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    localeFilter,
    setLocaleFilter,
    sealedFilter,
    setSealedFilter,
    stampDutyPendingOnly,
    setStampDutyPendingOnly,
    // Task #780 — defaulted so older/partial context mocks in tests that
    // predate these fields don't crash the memo/filter below.
    withdrawalPendingCounts = {},
    withdrawalPendingOnly = false,
    setWithdrawalPendingOnly = () => {},
    reactivationPendingCounts = {},
    reactivationPendingOnly = false,
    setReactivationPendingOnly = () => {},
    refundClaimStatusFilter = "all",
    setRefundClaimStatusFilter = () => {},
    setIsCreateOpen,
    loadData,
    clearLogs,
    toggleLetterSent,
    getCaseSubmissionCount,
    documentRequests,
    userDocPendingCounts,
    loadUserDocPendingCounts,
    mutedAlertCaseIds,
    mutedWalletAlertCaseIds,
    openFinalizeModal,
    openLetterEditor,
    openSubmissionsModal,
    openChat,
    openAdminMessageDialog,
    openCaseEmailDelivery,
    openReceiptsDialog,
    openSendEmailDialog,
    openWithdrawalRequestsDialog,
    requestDeclaration,
    regenerateDeclarationAccessCode,
    clearDeclarationRequest,
    openDeclarationDialog,
    openReissueLetterDialog,
    openEditAccountDialog,
    openUserMirror,
    openSignedNdaDialog,
    openPreviewNdaDialog,
    forceLogoutUser,
    toggleUserAccess,
    resetUserPin,
    toast,
    authToken,
    setActiveTab,
    setReceiptsInboxFilter,
    adminRole,
  } = useAdminDashboard();

  const [sealSort, setSealSort] = useState<"none" | "desc" | "asc">("none");
  // Task #2406 — client-side pagination of the (already filtered) case list.
  // The full case list is still fetched/filtered/sorted in memory (nothing
  // else in this tab depends on server-side paging), but only one page's
  // worth of <TableRow>s is ever mounted, which is what actually froze the
  // tab at ~4,300+ rows (see .agents/memory/local-devdb-case-volume.md —
  // the API responds fast; the bottleneck is purely the client render of
  // every row's rich markup at once). Task #2443 replaced the *fetch* side
  // of this for the common case too — see the server-pagination block just
  // below. Bulk selection, CSV export, and the picker-based "apply to all
  // matching" flows continue to operate on the full `displayedCases`/`cases`
  // arrays (already resident from the dashboard-wide poll), not just the
  // current page.
  const CASES_PAGE_SIZE = 50;
  const [casesPage, setCasesPage] = useState(1);
  // Task #2443 — server-side pagination/search/filtering for the common
  // browse/search path. When none of the "niche" client-only filters below
  // are active, the visible page is fetched (search+filter+LIMIT/OFFSET all
  // done in SQL) from `/api/cases?page=...` instead of being sliced out of
  // the full in-memory `cases` array — so the table no longer has to fetch
  // or render every case row just to show 50 of them. The niche filters
  // (stamp-duty/withdrawal/reactivation pending, refund-claim status,
  // legacy access code, seal-date sort) depend on data not queryable by the
  // simple cases-table WHERE clause (join-derived pending counts, etc.), so
  // when any of those is active we fall back to the existing client-side
  // filter/sort over the already-resident full case list.
  const [serverCases, setServerCases] = useState<Case[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [isServerCasesLoading, setIsServerCasesLoading] = useState(false);
  // If the paginated fetch itself ever fails (network hiccup, or an
  // environment where /api/cases?page=... isn't reachable), fall back to
  // slicing the already-resident `displayedCases` client-side rather than
  // rendering an empty table — see `serverPagingActive` below.
  const [serverFetchFailed, setServerFetchFailed] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);
  // Local filter (not lifted to context — nothing outside this tab needs it)
  // that narrows the table to cases whose access code contains letters.
  const [legacyAccessCodeOnly, setLegacyAccessCodeOnly] = useState(false);
  // `stampDutyPendingOnly` / `setStampDutyPendingOnly` come from the dashboard
  // context (Task #127) so the Cases nav badge can pre-activate this triage
  // filter when admins click it from another tab.
  const [ledgerCase, setLedgerCase] = useState<{ id: string; accessCode: string } | null>(null);

  // Per-case integrity-check status for sealed cases, keyed by case id.
  // Only includes cases that have at least one recorded check; missing
  // entries mean "no verification on file" and render no badge.
  type IntegrityStatus = {
    status: "ok" | "failed";
    checkedAt: string;
    checkedBy: string | null;
  };
  const [integrityStatuses, setIntegrityStatuses] = useState<
    Record<string, IntegrityStatus>
  >({});

  // Per-case transactional-email delivery summary (Task #146). Keyed by
  // case id; only includes cases with something to report (a pending
  // send or a failure in the last 24h). Powers the row-level
  // "N pending · N failed" badge so admins spot stuck SMTP dispatches
  // from the Cases list without opening each case detail dialog.
  type EmailDeliverySummary = {
    pending: number;
    failed24h: number;
    lastFailureAt: string | null;
  };
  const [emailDeliverySummaries, setEmailDeliverySummaries] = useState<
    Record<string, EmailDeliverySummary>
  >({});

  // ────────────────────────────────────────────────────────────────────
  // Bulk multi-select + inline quick-edit state.
  // selectedIds tracks the user's pending bulk selection;
  // busyIds is the set of cases that currently have an in-flight inline
  // PATCH so we can disable their controls and show a subtle spinner cue.
  // We deliberately keep both pieces of state local to CasesTab — they
  // don't need to survive remounts and the parent dashboard doesn't read
  // them. authToken comes from the dashboard context above.
  // ────────────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  // Confirmation threshold for large bulk batches (access codes, bulk
  // email, bulk IP blocks — Tasks #2355 / #2362 / #2395). Below the
  // threshold the action fires immediately, same as before; above it, an
  // admin confirmation dialog gates the send so a misclick with a broad
  // filter can't silently email/block hundreds of users. Deployments with
  // different case volumes can override the default of 20 via
  // VITE_BULK_CONFIRM_THRESHOLD (must be a positive integer — any other
  // value falls back to the default).
  const DEFAULT_BULK_CONFIRM_THRESHOLD = 20;
  const BULK_CONFIRM_THRESHOLD = (() => {
    const raw = import.meta.env.VITE_BULK_CONFIRM_THRESHOLD as
      | string
      | undefined;
    const parsed = raw !== undefined ? Number(raw) : NaN;
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_BULK_CONFIRM_THRESHOLD;
  })();
  const [confirmAccessCodeSend, setConfirmAccessCodeSend] = useState(false);
  const BULK_ACCESS_CODE_CONFIRM_THRESHOLD = BULK_CONFIRM_THRESHOLD;
  const [confirmAccessCodeRotate, setConfirmAccessCodeRotate] = useState(false);
  const BULK_ACCESS_CODE_ROTATE_CONFIRM_THRESHOLD = BULK_CONFIRM_THRESHOLD;
  // Task #2448 — surfaces how many of the targeted cases currently have an
  // active portal session before the admin commits to a bulk rotation
  // (which force-drops every one of those sessions via deleteSessionsByCaseId
  // on the server). Snapshotted at the moment the confirm dialog opens
  // rather than derived via useEffect, since `targetIds` is recomputed on
  // every render and would otherwise refire the per-case network checks
  // continuously while the dialog is open.
  const [bulkRotateActiveSessionCheck, setBulkRotateActiveSessionCheck] = useState<{
    checking: boolean;
    count: number | null;
  }>({ checking: false, count: null });
  const [confirmBulkEmailSend, setConfirmBulkEmailSend] = useState(false);
  const BULK_EMAIL_CONFIRM_THRESHOLD = BULK_CONFIRM_THRESHOLD;
  const [confirmBulkBlockIps, setConfirmBulkBlockIps] = useState(false);
  const BULK_BLOCK_IPS_CONFIRM_THRESHOLD = BULK_CONFIRM_THRESHOLD;

  // Selection-pruning effect is declared further down — after
  // `displayedCases` exists — so it can intersect against the *actually
  // rendered* row set (including the local sealed / stamp-duty filters),
  // not just the upstream `filteredCases` list. Pruning here against the
  // wrong set would let off-screen rows stay selected and silently get
  // picked up by bulk actions.

  const toggleSelected = (id: string, on: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // Generic PATCH /api/cases/:id helper used by both inline quick-edit
  // and the bulk action bar. Returns true on 2xx, false otherwise. We
  // mark the case "busy" while in flight so the inline Select disables
  // and the user can't double-fire.
  const patchCase = async (
    caseId: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> => {
    setBusyIds((p) => {
      const n = new Set(p);
      n.add(caseId);
      return n;
    });
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true };
      // Surface the server's reason so admins see why (e.g. sealed-case
      // 423) instead of a generic "update failed". Falls back to the
      // status code when the body isn't JSON.
      let error: string | undefined;
      try {
        const body = await res.json();
        if (typeof body?.error === "string") error = body.error;
        else if (Array.isArray(body?.error) && body.error[0]?.message)
          error = body.error[0].message;
        else if (typeof body?.message === "string") error = body.message;
      } catch {
        /* non-JSON body */
      }
      if (!error) error = `HTTP ${res.status}`;
      return { ok: false, error };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    } finally {
      setBusyIds((p) => {
        const n = new Set(p);
        n.delete(caseId);
        return n;
      });
    }
  };

  // Inline quick-edit handler: PATCH + toast + refresh. The dashboard
  // poll will refetch within a few seconds; loadData(true) gives instant
  // feedback so the row reflects the new value immediately.
  const inlineEdit = async (
    caseId: string,
    payload: Record<string, unknown>,
    label: string,
  ) => {
    const result = await patchCase(caseId, payload);
    if (result.ok) {
      toast({ title: `${label} updated` });
      loadData(true);
    } else {
      toast({
        title: `${label} update failed`,
        description: result.error,
        variant: "destructive",
      });
    }
  };

  // Run an async per-case operation against an explicit id list with a
  // small concurrency cap so we don't hammer the API. Surfaces a single
  // toast summary at the end. The Functions Sidebar resolves the id
  // list (either checkbox selection or filter-matched set) before
  // calling — we deliberately don't read selectedIds here so the same
  // helper can drive "apply to all matching" runs that weren't
  // pre-selected on the table.
  const runBulk = async (
    label: string,
    perform: (caseId: string) => Promise<boolean>,
    ids: string[],
  ) => {
    if (ids.length === 0) return;
    setIsBulkRunning(true);
    const concurrency = 5;
    let okCount = 0;
    let failCount = 0;
    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (idx < ids.length) {
        const i = idx++;
        const id = ids[i];
        try {
          const ok = await perform(id);
          if (ok) okCount++;
          else failCount++;
        } catch {
          failCount++;
        }
      }
    });
    await Promise.all(workers);
    setIsBulkRunning(false);
    toast({
      title: `${label}: ${okCount} succeeded${failCount ? `, ${failCount} failed` : ""}`,
      variant: failCount > 0 ? "destructive" : undefined,
    });
    loadData(true);
  };

  // ── Bulk operation handlers ────────────────────────────────────────
  // Each one wraps runBulk with a per-case function. We keep prompt()-based
  // value collection minimal so the action bar stays one-click — for
  // anything richer (multi-line email body), we route through window.prompt
  // for now to avoid a new dialog component scope.

  const bulkAdvanceStage = (ids: string[]) =>
    runBulk("Advance stage", async (id) => {
      const c = cases.find((x) => x.id === id);
      if (!c) return false;
      // withdrawalStage is stored as text ('1'..'14') — parse defensively.
      const raw = c.withdrawalStage;
      const current = raw && /^[0-9]+$/.test(raw) ? parseInt(raw, 10) : 0;
      if (current >= 14) return true; // already at terminal stage — no-op success
      return (await patchCase(id, { withdrawalStage: String(current + 1) })).ok;
    }, ids);

  const bulkSetStage = (ids: string[], stage: number) =>
    runBulk(`Jump to stage ${stage}`, async (id) =>
      (await patchCase(id, { withdrawalStage: String(stage) })).ok,
      ids,
    );

  const bulkSetPriority = (ids: string[], priority: "low" | "medium" | "high") =>
    runBulk(`Set priority ${priority}`, async (id) => (await patchCase(id, { priority })).ok, ids);

  const bulkSetLandingPage = (ids: string[], landingPage: string) =>
    runBulk(`Landing page → ${landingPage}`, async (id) =>
      (await patchCase(id, { landingPage })).ok,
      ids,
    );

  const bulkSetAssignee = (ids: string[], assignee: string) => {
    const trimmed = assignee.trim();
    void runBulk(
      trimmed ? `Assign to ${trimmed}` : "Unassign",
      async (id) => (await patchCase(id, { assignedTo: trimmed || null })).ok,
      ids,
    );
  };

  // Feature-flag bulk toggle — sets the flag to a specific boolean
  // across the resolved id set so the result is deterministic regardless
  // of each row's current state.
  const bulkSetFlag = (
    ids: string[],
    field:
      | "isRegulated"
      | "ndaEnabled"
      | "certificateEnabled"
      | "stampDutyEnabled"
      | "withdrawalWindowEnabled",
    value: boolean,
  ) =>
    runBulk(
      `${field} ${value ? "enabled" : "disabled"}`,
      async (id) => (await patchCase(id, { [field]: value })).ok,
      ids,
    );

  // Bulk-send access codes (Task #2335). Hits the dedicated batch endpoint
  // (rather than fanning out N single-case requests from the client) so
  // the server can enforce a single batch cap and keep audit-log ordering
  // deterministic. Per-case success/failure comes back in one response —
  // we surface it as a single toast summary, same shape as other bulk
  // actions in this panel.
  const bulkSendAccessCodes = async (ids: string[]) => {
    const targets = ids
      .map((id) => cases.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c && !!c.userEmail);
    if (targets.length === 0) {
      toast({
        title: "No target cases have an email address on file",
        variant: "destructive",
      });
      return;
    }
    setIsBulkRunning(true);
    try {
      const res = await fetch("/api/cases/bulk/send-access-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ ids: targets.map((c) => c.id) }),
      });
      if (!res.ok) {
        let error = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (typeof body?.error === "string") error = body.error;
        } catch {
          /* non-JSON body */
        }
        toast({ title: "Bulk send access code failed", description: error, variant: "destructive" });
        return;
      }
      const data = (await res.json()) as {
        successCount: number;
        failureCount: number;
        results: Array<{ id: string; success: boolean; sentTo?: string; error?: string }>;
      };
      const failures = (data.results || [])
        .filter((r) => !r.success)
        .map((r) => {
          const c = targets.find((t) => t.id === r.id);
          const name = c
            ? `${c.userName || c.accessCode || r.id}${c.accessCode ? ` (${c.accessCode})` : ""}`
            : r.id;
          return {
            id: r.id,
            name,
            error: r.error || "Unknown error",
            accessCode: c?.accessCode ?? "",
            email: c?.userEmail ?? "",
          };
        });
      setLastAccessCodeFailures(failures);
      toast({
        title: `Access codes sent: ${data.successCount} succeeded${data.failureCount ? `, ${data.failureCount} failed` : ""}`,
        description: failures.length > 0 ? <ExpandableFailureList failures={failures} /> : undefined,
        variant: data.failureCount > 0 ? "destructive" : undefined,
      });
    } catch (e) {
      toast({
        title: "Bulk send access code failed",
        description: e instanceof Error ? e.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setIsBulkRunning(false);
      loadData(true);
    }
  };

  // Bulk-rotate access codes (Task #2440). Lets admins clear the legacy
  // alphanumeric access-code backlog surfaced by the "Legacy access codes"
  // filter in one action instead of opening each case's Edit Account
  // dialog to rotate it individually. Hits the dedicated batch endpoint
  // (same pattern as bulkSendAccessCodes above) so the server can enforce
  // a single batch cap, audit-log ordering, and best-effort new-code
  // notification per case.
  const bulkRotateAccessCodes = async (ids: string[]) => {
    if (ids.length === 0) {
      toast({ title: "No cases selected", variant: "destructive" });
      return;
    }
    setIsBulkRunning(true);
    try {
      const res = await fetch("/api/cases/bulk/rotate-access-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        let error = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (typeof body?.error === "string") error = body.error;
        } catch {
          /* non-JSON body */
        }
        toast({ title: "Bulk rotate access code failed", description: error, variant: "destructive" });
        return;
      }
      const data = (await res.json()) as {
        successCount: number;
        failureCount: number;
        results: Array<{
          id: string;
          success: boolean;
          newAccessCode?: string;
          notified?: boolean;
          notifyError?: string;
          error?: string;
        }>;
      };
      const failures = (data.results || [])
        .filter((r) => !r.success || (r.notified === false && r.notifyError))
        .map((r) => {
          const c = ids
            .map((id) => cases.find((x) => x.id === id))
            .find((x) => x?.id === r.id);
          const displayCode = r.newAccessCode ?? c?.accessCode ?? "";
          const name = c
            ? `${c.userName || c.accessCode || r.id}${displayCode ? ` (${displayCode})` : ""}`
            : r.id;
          return {
            id: r.id,
            name,
            error: r.error || r.notifyError || "Unknown error",
            accessCode: displayCode,
            email: c?.userEmail ?? "",
          };
        });
      setLastAccessCodeRotateFailures(failures);
      toast({
        title: `Access codes rotated: ${data.successCount} succeeded${data.failureCount ? `, ${data.failureCount} failed` : ""}`,
        description: failures.length > 0 ? <ExpandableFailureList failures={failures} /> : undefined,
        variant: data.failureCount > 0 ? "destructive" : undefined,
      });
    } catch (e) {
      toast({
        title: "Bulk rotate access code failed",
        description: e instanceof Error ? e.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setIsBulkRunning(false);
      loadData(true);
    }
  };

  const bulkSendEmail = async (ids: string[], subject: string, body: string) => {
    const targets = ids
      .map((id) => cases.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c && !!c.userEmail);
    if (targets.length === 0) {
      toast({
        title: "No target cases have an email address on file",
        variant: "destructive",
      });
      return;
    }
    if (!subject.trim()) {
      toast({ title: "Email subject is required", variant: "destructive" });
      return;
    }
    setIsBulkRunning(true);
    let ok = 0;
    let fail = 0;
    for (const t of targets) {
      try {
        const res = await fetch(`/api/cases/${t.id}/email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ subject, body }),
        });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setIsBulkRunning(false);
    toast({
      title: `Bulk email: ${ok} sent${fail ? `, ${fail} failed` : ""}`,
      variant: fail > 0 ? "destructive" : undefined,
    });
  };

  const bulkBlockIps = async (ids: string[], reason: string) => {
    const ipMap = new Map<string, string[]>(); // ip -> accessCodes
    ids.forEach((id) => {
      const c = cases.find((x) => x.id === id);
      const ip = (c?.lastLoginIp ?? "").trim();
      if (!ip) return;
      const arr = ipMap.get(ip) ?? [];
      arr.push(c!.accessCode);
      ipMap.set(ip, arr);
    });
    if (ipMap.size === 0) {
      toast({
        title: "No last-login IPs on file for target cases",
        variant: "destructive",
      });
      return;
    }
    setIsBulkRunning(true);
    let ok = 0;
    let fail = 0;
    for (const [ip, codes] of ipMap.entries()) {
      try {
        const res = await fetch("/api/admin/blocked-ips", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            ipAddress: ip,
            reason: reason || `Bulk block — cases: ${codes.join(", ")}`,
          }),
        });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setIsBulkRunning(false);
    toast({
      title: `Bulk block: ${ok} IP${ok === 1 ? "" : "s"} blocked${fail ? `, ${fail} failed` : ""}`,
      variant: fail > 0 ? "destructive" : undefined,
    });
  };

  // Export the target cases as CSV (reuses the same column shape
  // as the full-export button above so admins can diff/merge easily).
  const bulkExportSelected = (ids: string[]) => {
    const targets = ids
      .map((id) => cases.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c);
    if (targets.length === 0) return;
    const escapeCSV = (val: string | null | undefined): string => {
      if (val == null) return '""';
      const str = String(val);
      const escaped = str.replace(/"/g, '""').replace(/\n/g, " ").replace(/\r/g, "");
      return `"${escaped}"`;
    };
    const headers = [
      "Access Code", "Status", "User Name", "Email", "Mobile", "VIP Status",
      "Withdrawal Amount", "Stage", "Priority", "Assigned To", "Created At",
    ];
    const csv = [
      headers.map(escapeCSV).join(","),
      ...targets.map((c) =>
        [
          escapeCSV(c.accessCode),
          escapeCSV(c.status),
          escapeCSV(c.userName),
          escapeCSV(c.userEmail),
          escapeCSV(c.userMobile),
          escapeCSV(c.vipStatus),
          escapeCSV(c.withdrawalAmount),
          escapeCSV(c.withdrawalStage != null ? String(c.withdrawalStage) : ""),
          escapeCSV(c.priority),
          escapeCSV(c.assignedTo),
          escapeCSV(new Date(c.createdAt).toLocaleDateString()),
        ].join(","),
      ),
    ].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `cases-selected-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    toast({ title: `Exported ${targets.length} selected case${targets.length === 1 ? "" : "s"}` });
  };

  // Task #2359 — let admins download the per-case failure list from the
  // last bulk access-code send (name, access code, email, error reason)
  // instead of only being able to view it inline. Reuses the same
  // CSV-building pattern as bulkExportSelected above.
  const exportAccessCodeFailures = () => {
    if (lastAccessCodeFailures.length === 0) return;
    const escapeCSV = (val: string | null | undefined): string => {
      if (val == null) return '""';
      const str = String(val);
      const escaped = str.replace(/"/g, '""').replace(/\n/g, " ").replace(/\r/g, "");
      return `"${escaped}"`;
    };
    const headers = ["Name", "Access Code", "Email", "Error Reason"];
    const csv = [
      headers.map(escapeCSV).join(","),
      ...lastAccessCodeFailures.map((f) =>
        [
          escapeCSV(f.name),
          escapeCSV(f.accessCode),
          escapeCSV(f.email),
          escapeCSV(f.error),
        ].join(","),
      ),
    ].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `access-code-failures-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    toast({ title: `Exported ${lastAccessCodeFailures.length} failed case${lastAccessCodeFailures.length === 1 ? "" : "s"}` });
  };

  // Task #2440 — same CSV export pattern as exportAccessCodeFailures above,
  // scoped to the last bulk access-code *rotation's* failures.
  const exportAccessCodeRotateFailures = () => {
    if (lastAccessCodeRotateFailures.length === 0) return;
    const escapeCSV = (val: string | null | undefined): string => {
      if (val == null) return '""';
      const str = String(val);
      const escaped = str.replace(/"/g, '""').replace(/\n/g, " ").replace(/\r/g, "");
      return `"${escaped}"`;
    };
    const headers = ["Name", "Access Code", "Email", "Error Reason"];
    const csv = [
      headers.map(escapeCSV).join(","),
      ...lastAccessCodeRotateFailures.map((f) =>
        [
          escapeCSV(f.name),
          escapeCSV(f.accessCode),
          escapeCSV(f.email),
          escapeCSV(f.error),
        ].join(","),
      ),
    ].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `access-code-rotate-failures-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    toast({ title: `Exported ${lastAccessCodeRotateFailures.length} failed case${lastAccessCodeRotateFailures.length === 1 ? "" : "s"}` });
  };

  // Feature-flag toggles use the same PATCH path; we always pass the
  // boolean so the server stamps the correct audit log direction.
  const toggleFlag = (
    c: typeof cases[number],
    field:
      | "isRegulated"
      | "ndaEnabled"
      | "certificateEnabled"
      | "stampDutyEnabled"
      | "withdrawalWindowEnabled",
  ) => {
    const current = (c as unknown as Record<string, unknown>)[field];
    const next = !(current === true);
    void inlineEdit(c.id, { [field]: next }, `${field} ${next ? "enabled" : "disabled"}`);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const token = sessionStorage.getItem("adminToken");
      if (!token) return;
      try {
        const res = await fetch("/api/cases/nda/integrity-status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, IntegrityStatus>;
        if (!cancelled) setIntegrityStatuses(data);
      } catch {
        // Best-effort — the per-case detail dialog still surfaces the
        // status authoritatively, so failures here just hide the badge.
      }
    };
    load();
    // Re-poll every 30s so a verification run inside the case-detail
    // dialog (which flips the latest audit row to ok/failed) propagates
    // back to the row badge without needing a full page refresh. The
    // bulk endpoint is a single audit-log query so the cost is small.
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Also re-fetch whenever the cases array reference changes (loadData
    // poll, new seal, override) so badge state tracks the underlying
    // dataset instead of only the sealed-count.
  }, [cases]);

  // Bulk per-case email-delivery summary (Task #146). One admin-bearer
  // request fans out across every case so the list view can show a
  // "pending / failed" badge without N round-trips. Polls every 20s so
  // a pending dispatch flipping to sent/failed (case_emails.status set
  // by the background SMTP dispatcher) clears the badge quickly.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const token = sessionStorage.getItem("adminToken");
      if (!token) return;
      try {
        const res = await fetch("/api/cases/email-delivery-summary", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as Record<
          string,
          EmailDeliverySummary
        >;
        if (!cancelled) setEmailDeliverySummaries(data ?? {});
      } catch {
        // Best-effort — the per-case detail dialog still surfaces the
        // delivery breakdown authoritatively, so failures here just
        // hide the row-level badge.
      }
    };
    load();
    const interval = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [cases]);

  const getSignerInitials = (sealedBy?: string | null): string => {
    if (!sealedBy) return "";
    const raw = sealedBy.includes(":") ? sealedBy.slice(sealedBy.indexOf(":") + 1) : sealedBy;
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "";
    const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
    return initials || raw.slice(0, 2).toUpperCase();
  };

  const formatSealDate = (iso?: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  // True when the case is enabled for stamp duty AND the user has uploaded a
  // receipt that's currently waiting on an admin decision. Mirrors the same
  // condition used to render the reviewer panel inside the case-detail dialog
  // (Task #113), so the badge clears the moment a reviewer approves/rejects.
  const isStampDutyPending = (c: typeof cases[number]) =>
    c.stampDutyEnabled !== false &&
    c.stampDutyStatus === 'awaiting_admin_approval';

  const stampDutyPendingCount = useMemo(
    () => cases.filter(isStampDutyPending).length,
    [cases],
  );

  // Task #780 — total pending withdrawal requests across all cases. Drives the
  // visibility + count of the "Withdrawal requests pending review" filter pill.
  const withdrawalPendingTotal = useMemo(
    () => Object.values(withdrawalPendingCounts).reduce((sum, n) => sum + n, 0),
    [withdrawalPendingCounts],
  );

  // Total pending reactivation receipts across all cases. Drives the triage
  // filter pill visibility + count. Only disabled cases can have these receipts
  // (the reactivation-receipt endpoint requires the account to be suspended)
  // so the badge is exclusive to locked rows.
  const reactivationPendingTotal = useMemo(
    () => Object.values(reactivationPendingCounts).reduce((sum, n) => sum + n, 0),
    [reactivationPendingCounts],
  );

  // A "legacy" access code contains letters (older codes were alphanumeric;
  // newer ones are digits-only). Mirrors the same digits-only regex used by
  // the per-row "Legacy" badge below so the KPI/filter and the badge never
  // drift out of sync.
  const isLegacyAccessCode = (c: typeof cases[number]) => !/^[0-9]+$/.test(c.accessCode);

  const legacyAccessCodeCount = useMemo(
    () => cases.filter(isLegacyAccessCode).length,
    [cases],
  );

  // ----- Functions Sidebar state (Task #139) -----
  // The sidebar replaces the old floating bulk-action bar. It exposes
  // the same set of admin functions plus a target picker that can act
  // on either (a) the checkbox selection from the table or (b) every
  // case matching an ad-hoc filter the operator builds in the panel.
  // Open/active state persists in localStorage so the operator's
  // preferred panel survives reload.
  type SidebarFunctionId =
    | "stage"
    | "priority"
    | "assign"
    | "session-refresh"
    | "landing"
    | "email"
    | "access-code"
    | "export"
    | "block"
    | "flags";
  type TargetMode = "selected" | "filter";
  const SIDEBAR_STORAGE_KEY = "ibccf.admin.functionsSidebar";

  const [activeFunction, setActiveFunction] = useState<SidebarFunctionId | null>(() => {
    try {
      const raw = typeof localStorage !== "undefined"
        ? localStorage.getItem(SIDEBAR_STORAGE_KEY)
        : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { activeFunction?: SidebarFunctionId | null };
      return parsed.activeFunction ?? null;
    } catch {
      return null;
    }
  });
  // Explicit collapsed flag — independent of activeFunction so the
  // operator can choose between icon rail (collapsed) and labeled rail
  // (expanded) regardless of whether a panel is open. Persisted to
  // localStorage so the choice survives reload. On narrow viewports
  // (< lg) the nav reflows to a wrapping icon row regardless.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      const raw = typeof localStorage !== "undefined"
        ? localStorage.getItem(SIDEBAR_STORAGE_KEY)
        : null;
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { collapsed?: boolean };
      return parsed.collapsed === true;
    } catch {
      return false;
    }
  });
  const [targetMode, setTargetMode] = useState<TargetMode>("selected");
  // Task #2356 — per-case failures from the last bulk access-code send, so
  // the admin can see exactly which cases failed (and why) instead of only
  // an aggregate "N failed" toast, and can retarget just that subset.
  const [lastAccessCodeFailures, setLastAccessCodeFailures] = useState<
    Array<FailureEntry & { id: string; accessCode: string; email: string }>
  >([]);
  // Task #2440 — per-case failures from the last bulk access-code *rotation*
  // (distinct from the send-failures above), so the admin can retarget just
  // the cases whose rotation or new-code notification didn't go through.
  const [lastAccessCodeRotateFailures, setLastAccessCodeRotateFailures] = useState<
    Array<FailureEntry & { id: string; accessCode: string; email: string }>
  >([]);
  // Picker-filter inputs — distinct from the table-level filters above
  // so the operator can build a target set without disturbing what's
  // visible on screen.
  const [pickerStage, setPickerStage] = useState<string>("any");        // "any" | "none" | "1".."14"
  const [pickerPriority, setPickerPriority] = useState<string>("any");  // "any" | "high" | "medium" | "low" | "none"
  const [pickerStatus, setPickerStatus] = useState<string>("any");      // "any" | created | registered | syncing | active | completed
  const [pickerAssignee, setPickerAssignee] = useState<string>("");     // substring (case-insensitive); "" = any
  const [pickerSearch, setPickerSearch] = useState<string>("");
  // Per-function panel inputs
  const [sidebarStageInput, setSidebarStageInput] = useState<string>("1");
  const [sidebarAssigneeInput, setSidebarAssigneeInput] = useState<string>("");
  const [sidebarEmailSubject, setSidebarEmailSubject] = useState<string>("");
  const [sidebarEmailBody, setSidebarEmailBody] = useState<string>("");
  const [sidebarEmailTemplate, setSidebarEmailTemplate] = useState<string>("");

  // Saved (admin-defined) email templates from Settings
  const [savedEmailTemplates, setSavedEmailTemplates] = useState<{ id: string; name: string; subject: string; body: string }[]>([]);
  useEffect(() => {
    const token = sessionStorage.getItem("adminToken") ?? "";
    fetch("/api/admin/settings/email-templates", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.templates)) setSavedEmailTemplates(d.templates);
      })
      .catch(() => {});
  }, []);
  const [bulkDepositCoin, setBulkDepositCoin] = useState<string>("USDT");
  const [bulkDepositNetwork, setBulkDepositNetwork] = useState<string>("TRC20 (TRON)");
  const [bulkDepositAmount, setBulkDepositAmount] = useState<string>("750");
  const [sidebarBlockReason, setSidebarBlockReason] = useState<string>("Bulk block from cases tab");

  // Per-case Payout Wallet editor (opened from the Manage dropdown).
  // Persisting non-empty values triggers the server-side audit log +
  // `payout-wallet-set` / `payout-wallet-changed` email automatically
  // inside PATCH /api/cases/:id — no extra endpoint needed.
  const [walletDialogCase, setWalletDialogCase] = useState<Case | null>(null);
  const [refundClaimRequestCase, setRefundClaimRequestCase] = useState<Case | null>(null);
  const [refundClaimReviewCaseId, setRefundClaimReviewCaseId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [walletAsset, setWalletAsset] = useState<string>("USDT");
  const [walletNetwork, setWalletNetwork] = useState<string>("TRC20");
  const [walletNote, setWalletNote] = useState<string>("");
  const [walletSaving, setWalletSaving] = useState<boolean>(false);
  const openPayoutWalletDialog = (c: Case) => {
    setWalletDialogCase(c);
    setWalletAddress((c.payoutWalletAddress ?? "").toString());
    setWalletAsset((c.payoutWalletAsset ?? "").toString() || "USDT");
    setWalletNetwork((c.payoutWalletNetwork ?? "").toString() || "TRC20");
    setWalletNote((c.payoutWalletNote ?? "").toString());
  };
  const savePayoutWallet = async () => {
    if (!walletDialogCase) return;
    const trimmedAddr = walletAddress.trim();
    if (!trimmedAddr) {
      toast({ title: "Address required", description: "Enter the verified payout wallet address.", variant: "destructive" });
      return;
    }
    setWalletSaving(true);
    const result = await patchCase(walletDialogCase.id, {
      payoutWalletAddress: trimmedAddr,
      payoutWalletAsset: walletAsset.trim() || null,
      payoutWalletNetwork: walletNetwork.trim() || null,
      payoutWalletNote: walletNote.trim() || null,
    });
    setWalletSaving(false);
    if (result.ok) {
      const wasFirstSet = !(walletDialogCase.payoutWalletAddress ?? "").toString().trim();
      toast({
        title: wasFirstSet ? "Payout wallet calibrated" : "Payout wallet updated",
        description: walletDialogCase.userEmail
          ? `${walletDialogCase.userName ?? "User"} has been notified by email.`
          : "Saved. No email on file for this case.",
      });
      setWalletDialogCase(null);
      loadData(true);
    } else {
      toast({ title: "Failed to save payout wallet", description: result.error, variant: "destructive" });
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(
        SIDEBAR_STORAGE_KEY,
        JSON.stringify({ activeFunction, collapsed: isSidebarCollapsed }),
      );
    } catch {
      /* localStorage may be unavailable (private mode, quota) — ignore */
    }
  }, [activeFunction, isSidebarCollapsed]);

  const displayedCases = useMemo(() => {
    const filtered = filteredCases.filter((c) => {
      if (sealedFilter === "sealed" && !c.sealedAt) return false;
      if (sealedFilter === "open" && c.sealedAt) return false;
      if (stampDutyPendingOnly && !isStampDutyPending(c)) return false;
      if (withdrawalPendingOnly && (withdrawalPendingCounts[c.id] ?? 0) === 0) return false;
      if (reactivationPendingOnly && !(c.isDisabled && (reactivationPendingCounts[c.id] ?? 0) > 0)) return false;
      if (refundClaimStatusFilter !== "all" && (c.refundClaimStatus ?? null) !== refundClaimStatusFilter) return false;
      if (legacyAccessCodeOnly && !isLegacyAccessCode(c)) return false;
      return true;
    });
    if (sealSort === "none") return filtered;
    // sort intentionally unaffected by stampDutyPendingOnly toggle
    const sorted = [...filtered].sort((a, b) => {
      const ta = a.sealedAt ? new Date(a.sealedAt).getTime() : 0;
      const tb = b.sealedAt ? new Date(b.sealedAt).getTime() : 0;
      if (ta === 0 && tb === 0) return 0;
      if (ta === 0) return 1;
      if (tb === 0) return -1;
      return sealSort === "desc" ? tb - ta : ta - tb;
    });
    return sorted;
  }, [filteredCases, sealedFilter, sealSort, stampDutyPendingOnly, withdrawalPendingOnly, withdrawalPendingCounts, reactivationPendingOnly, reactivationPendingCounts, refundClaimStatusFilter, legacyAccessCodeOnly]);

  // Jump back to page 1 whenever the *criteria* driving displayedCases
  // change, so a new/narrower search never leaves the operator stranded on
  // a now-empty page. Deliberately does NOT depend on `displayedCases`
  // itself — the list also changes on every background poll refresh, and
  // resetting the page on every poll would yank the operator back to page 1
  // mid-review.
  useEffect(() => {
    setCasesPage(1);
  }, [searchQuery, statusFilter, localeFilter, sealedFilter, sealSort, stampDutyPendingOnly, withdrawalPendingOnly, reactivationPendingOnly, refundClaimStatusFilter, legacyAccessCodeOnly]);

  // Whether the "simple" server-paginated path applies (see comment on
  // `serverCases` above). False whenever a niche client-only filter/sort
  // that the SQL WHERE clause can't express is active.
  const useServerPaging =
    sealSort === "none" &&
    !stampDutyPendingOnly &&
    !withdrawalPendingOnly &&
    !reactivationPendingOnly &&
    refundClaimStatusFilter === "all" &&
    !legacyAccessCodeOnly;

  useEffect(() => {
    if (!useServerPaging) return;
    let cancelled = false;
    const params = new URLSearchParams({
      page: String(casesPage),
      pageSize: String(CASES_PAGE_SIZE),
    });
    if (debouncedSearchQuery.trim()) params.set("search", debouncedSearchQuery.trim());
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (localeFilter !== "all") params.set("locale", localeFilter);
    if (sealedFilter !== "all") params.set("sealed", sealedFilter);

    setIsServerCasesLoading(true);
    fetch(`/api/cases?${params.toString()}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { cases: Case[]; total: number }) => {
        if (cancelled) return;
        setServerCases(data.cases);
        setServerTotal(data.total);
        setServerFetchFailed(false);
      })
      .catch(() => {
        // Best-effort — fall back to the client-side slice of the already
        // in-memory `displayedCases` rather than showing an empty table on
        // a transient network hiccup (see `serverPagingActive`).
        if (!cancelled) setServerFetchFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsServerCasesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [useServerPaging, casesPage, debouncedSearchQuery, statusFilter, localeFilter, sealedFilter, authToken]);

  // The server-paginated path is only actually "active" once it has a
  // working fetch. If the paginated request fails (network hiccup, a test
  // environment that doesn't stub /api/cases, etc.), fall back to slicing
  // the already client-resident `displayedCases` — the same fallback path
  // used for the niche filters — rather than rendering an empty table.
  const serverPagingActive = useServerPaging && !serverFetchFailed;

  const casesPageCount = serverPagingActive
    ? Math.max(1, Math.ceil(serverTotal / CASES_PAGE_SIZE))
    : Math.max(1, Math.ceil(displayedCases.length / CASES_PAGE_SIZE));

  // Clamp defensively if the page count shrinks out from under the current
  // page (e.g. another admin's action removes cases between polls).
  useEffect(() => {
    setCasesPage((p) => (p > casesPageCount ? casesPageCount : p));
  }, [casesPageCount]);

  const pagedCases = useMemo(
    () =>
      serverPagingActive
        ? serverCases
        : displayedCases.slice((casesPage - 1) * CASES_PAGE_SIZE, casesPage * CASES_PAGE_SIZE),
    [serverPagingActive, serverCases, displayedCases, casesPage],
  );

  // Prune selectedIds against the *displayed* row set. Local filters
  // (sealedFilter, stampDutyPendingOnly) shrink what the operator can see,
  // so anything no longer rendered must drop out of selection — otherwise
  // bulk actions could mutate off-screen rows the operator can't review.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(displayedCases.map((c) => c.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [displayedCases]);

  const toggleSealSort = () => {
    setSealSort((prev) => (prev === "none" ? "desc" : prev === "desc" ? "asc" : "none"));
  };

  // Cases that match the picker filter — recomputed every time any
  // picker input or the underlying case list changes. The filter is
  // applied against the *full* case list (not displayedCases) so an
  // operator can act on rows that aren't currently visible on the table.
  const matchedIds = useMemo(() => {
    const assigneeQ = pickerAssignee.trim().toLowerCase();
    const searchQ = pickerSearch.trim().toLowerCase();
    return cases
      .filter((c) => {
        if (pickerStatus !== "any" && c.status !== pickerStatus) return false;
        const stageRaw = (c.withdrawalStage ?? "").toString();
        if (pickerStage === "none") {
          if (stageRaw !== "") return false;
        } else if (pickerStage !== "any") {
          if (stageRaw !== pickerStage) return false;
        }
        const pri = (c.priority ?? "").toString();
        if (pickerPriority === "none") {
          if (pri) return false;
        } else if (pickerPriority !== "any") {
          if (pri !== pickerPriority) return false;
        }
        if (assigneeQ) {
          if (!(c.assignedTo ?? "").toLowerCase().includes(assigneeQ)) return false;
        }
        if (searchQ) {
          const hay = `${c.caseRef ?? ""} ${c.accessCode} ${c.userName ?? ""} ${c.userEmail ?? ""}`.toLowerCase();
          if (!hay.includes(searchQ)) return false;
        }
        return true;
      })
      .map((c) => c.id);
  }, [cases, pickerStatus, pickerStage, pickerPriority, pickerAssignee, pickerSearch]);

  const targetIds: string[] = targetMode === "selected"
    ? Array.from(selectedIds)
    : matchedIds;
  const targetCount = targetIds.length;
  const canRun = targetCount > 0 && !isBulkRunning;

  // Per-function effective counts. `targetCount` is the headline blast
  // radius, but a couple of actions silently narrow it before doing
  // work — email skips rows missing userEmail, block-IPs dedupes by IP
  // and skips rows without lastLoginIp. Surfacing the true count in
  // each panel's CTA prevents the operator from being surprised by a
  // smaller-than-expected toast result.
  const emailEligibleCount = useMemo(
    () => targetIds.reduce((n, id) => {
      const c = cases.find((x) => x.id === id);
      return n + (c?.userEmail ? 1 : 0);
    }, 0),
    [targetIds, cases],
  );
  const blockableIpCount = useMemo(() => {
    const ips = new Set<string>();
    targetIds.forEach((id) => {
      const ip = (cases.find((x) => x.id === id)?.lastLoginIp ?? "").trim();
      if (ip) ips.add(ip);
    });
    return ips.size;
  }, [targetIds, cases]);

  // Sidebar function metadata — labels + icons shown in the rail and
  // panel header. Order matches the spec.
  type SidebarFunctionMeta = {
    id: SidebarFunctionId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    testId: string;
  };
  const SIDEBAR_GROUPS: ReadonlyArray<{
    id: string;
    label: string;
    items: ReadonlyArray<SidebarFunctionMeta>;
  }> = [
    {
      id: "workflow",
      label: "Workflow",
      items: [
        { id: "stage",          label: "Stage",           icon: Layers,      testId: "sidebar-fn-stage" },
        { id: "priority",       label: "Priority",        icon: AlertCircle, testId: "sidebar-fn-priority" },
        { id: "assign",         label: "Assignment",      icon: UserCheck,   testId: "sidebar-fn-assign" },
        { id: "session-refresh", label: "Session Refresh", icon: RefreshCw,   testId: "sidebar-fn-session-refresh" },
      ],
    },
    {
      id: "communicate",
      label: "Communicate",
      items: [
        { id: "landing",     label: "Landing page",  icon: MapPin, testId: "sidebar-fn-landing" },
        { id: "email",       label: "Email",         icon: Mail,   testId: "sidebar-fn-email" },
        { id: "access-code", label: "Access code",   icon: KeyRound, testId: "sidebar-fn-access-code" },
      ],
    },
    {
      id: "operations",
      label: "Operations",
      items: [
        { id: "export", label: "Export",        icon: FileText,   testId: "sidebar-fn-export" },
        { id: "block",  label: "Block IPs",     icon: Ban,        testId: "sidebar-fn-block" },
        { id: "flags",  label: "Feature flags", icon: ToggleLeft, testId: "sidebar-fn-flags" },
      ],
    },
  ];
  const SIDEBAR_FUNCTIONS: ReadonlyArray<SidebarFunctionMeta> =
    SIDEBAR_GROUPS.flatMap((g) => g.items);

  const toggleFunction = (id: SidebarFunctionId) => {
    setActiveFunction((prev) => (prev === id ? null : id));
    // Opening a function panel needs panel width — auto-expand the rail
    // if the operator had it collapsed to icons. Closing a panel never
    // forces a collapse change, so the operator's explicit collapse
    // choice is preserved.
    if (isSidebarCollapsed && activeFunction !== id) {
      setIsSidebarCollapsed(false);
    }
  };

  return (
    <>
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Case Management</h2>
          <p className="text-slate-400 text-sm">Manage secure access codes, edit letters, and approve synchronizations.</p>
        </div>
        <div className="flex gap-2">
          {(adminRole === 'admin' || adminRole === 'super_admin') && (
          <Button onClick={() => setIsCreateOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-new-case">
            <Plus className="w-4 h-4 mr-2" /> New Case
          </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
            onClick={() => {
              const escapeCSV = (val: string | null | undefined): string => {
                if (val == null) return '""';
                const str = String(val);
                const escaped = str.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
                return `"${escaped}"`;
              };

              const headers = ['Access Code', 'Status', 'User Name', 'Email', 'Mobile', 'VIP Status', 'Withdrawal Amount', 'Batches', 'Created At', 'Sealed', 'Sealed At', 'Sealed By'];
              const csvContent = [
                headers.map(h => escapeCSV(h)).join(','),
                ...displayedCases.map(c => [
                  escapeCSV(c.accessCode),
                  escapeCSV(c.status),
                  escapeCSV(c.userName),
                  escapeCSV(c.userEmail),
                  escapeCSV(c.userMobile),
                  escapeCSV(c.vipStatus),
                  escapeCSV(c.withdrawalAmount),
                  escapeCSV(c.withdrawalBatches),
                  escapeCSV(new Date(c.createdAt).toLocaleDateString()),
                  escapeCSV(c.sealedAt ? 'Yes' : 'No'),
                  escapeCSV(c.sealedAt ? new Date(c.sealedAt).toLocaleDateString() : ''),
                  escapeCSV(c.sealedBy || '')
                ].join(','))
              ].join('\n');

              const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
              const link = document.createElement('a');
              link.href = URL.createObjectURL(blob);
              link.download = `cases-export-${new Date().toISOString().split('T')[0]}.csv`;
              link.click();
              toast({ title: "Export Complete", description: `Exported ${displayedCases.length} cases to CSV.` });
            }}
            data-testid="button-export-csv"
          >
            <FileText className="w-4 h-4 mr-2" /> Export CSV
          </Button>
          <Button variant="destructive" size="sm" onClick={clearLogs} data-testid="button-clear-logs">
            <Trash2 className="w-4 h-4 mr-2" /> Clear Logs
          </Button>
        </div>
      </div>

      {cases.some(c => c.status === 'syncing') && (
        <div className="mb-6 bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-amber-500">
            <ShieldAlert className="w-6 h-6 animate-pulse" />
            <div>
              <h3 className="font-bold">Action Required</h3>
              <p className="text-sm opacity-80">There are users waiting for synchronization approval.</p>
            </div>
          </div>
        </div>
      )}

      {/* Functions Sidebar (Task #139) — replaces the old floating
          bulk-action bar. The icon rail is always visible; clicking a
          function toggles the panel beneath it. Every function applies
          to the resolved `targetIds` (table-checkbox selection OR the
          filter-matched id set, whichever mode is active). On narrow
          viewports the sidebar stacks above the table. */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <aside
          className={`lg:flex-shrink-0 lg:sticky lg:top-2 lg:self-start ${
            isSidebarCollapsed ? "w-auto lg:w-16" : "w-full lg:w-72"
          }`}
          data-testid="functions-sidebar"
          data-collapsed={isSidebarCollapsed}
        >
          {/* Premium glass rail — gradient body, gold-tinged border,
              ambient shadow, grouped sections with uppercase eyebrows,
              animated gold accent bar on the active function. */}
          <nav
            className={`relative flex gap-1 rounded-xl border border-amber-500/15 bg-gradient-to-b from-slate-900/90 via-slate-950/90 to-slate-950/95 p-2 shadow-[0_8px_32px_-12px_rgba(200,169,81,0.25)] backdrop-blur-xl ${
              isSidebarCollapsed ? "flex-row flex-wrap lg:flex-col" : "flex-wrap lg:flex-col"
            }`}
            aria-label="Case admin functions"
          >
            {/* subtle top highlight */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/30 to-transparent"
            />
            <div className="flex w-full items-center justify-between px-1.5 pb-2 mb-1 border-b border-amber-500/10">
              {!isSidebarCollapsed && (
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] font-semibold bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text text-transparent">
                  <span className="inline-block h-1 w-1 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" />
                  Functions
                </span>
              )}
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed((v) => !v)}
                className={`flex items-center justify-center h-6 w-6 rounded-md text-slate-400 hover:text-amber-200 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/30 transition-colors ${
                  isSidebarCollapsed ? "mx-auto" : ""
                }`}
                title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar to icons"}
                aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!isSidebarCollapsed}
                data-testid="sidebar-collapse-toggle"
              >
                {isSidebarCollapsed
                  ? <ChevronRight className="w-3.5 h-3.5" />
                  : <ChevronLeft className="w-3.5 h-3.5" />}
              </button>
            </div>
            {SIDEBAR_GROUPS.map((group, gIdx) => (
              <div
                key={group.id}
                className={`flex w-full ${
                  isSidebarCollapsed ? "flex-row flex-wrap lg:flex-col gap-1" : "flex-col gap-0.5"
                } ${gIdx > 0 ? (isSidebarCollapsed ? "lg:pt-1.5 lg:mt-1 lg:border-t lg:border-slate-800/60" : "pt-2 mt-1") : ""}`}
              >
                {!isSidebarCollapsed && (
                  <span className="px-2 pb-1 text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">
                    {group.label}
                  </span>
                )}
                {group.items.map((fn) => {
                  const Icon = fn.icon;
                  const active = activeFunction === fn.id;
                  return (
                    <button
                      key={fn.id}
                      type="button"
                      onClick={() => toggleFunction(fn.id)}
                      aria-pressed={active}
                      aria-label={fn.label}
                      title={isSidebarCollapsed ? fn.label : undefined}
                      className={`group relative flex items-center gap-2.5 rounded-lg pl-3 pr-2 py-2 text-sm transition-all duration-150 ${
                        isSidebarCollapsed ? "justify-center pl-2" : ""
                      } ${
                        active
                          ? "bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent text-amber-50 border border-amber-500/40 shadow-[0_4px_16px_-6px_rgba(200,169,81,0.4)]"
                          : "text-slate-300 hover:bg-slate-800/60 hover:text-white border border-transparent hover:border-slate-700/60"
                      }`}
                      data-testid={fn.testId}
                    >
                      {/* active accent bar */}
                      {active && !isSidebarCollapsed && (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-gradient-to-b from-amber-300 to-amber-500 shadow-[0_0_8px_rgba(251,191,36,0.7)]"
                        />
                      )}
                      <span
                        className={`flex items-center justify-center h-7 w-7 rounded-md flex-shrink-0 transition-colors ${
                          active
                            ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40"
                            : "bg-slate-800/60 text-slate-400 group-hover:bg-slate-700/70 group-hover:text-amber-200/90"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <span className={`truncate font-medium tracking-tight ${isSidebarCollapsed ? "hidden" : ""}`}>
                        {fn.label}
                      </span>
                      {active && !isSidebarCollapsed && (
                        <span
                          aria-hidden
                          className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {activeFunction && (
            <div
              className="relative mt-2 rounded-xl border border-amber-500/25 bg-gradient-to-b from-slate-900/95 to-slate-950/95 p-3.5 space-y-3 shadow-[0_12px_40px_-12px_rgba(200,169,81,0.35)] backdrop-blur-xl"
              data-testid={`sidebar-panel-${activeFunction}`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent"
              />
              <header className="flex items-center justify-between border-b border-amber-500/10 pb-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  {(() => {
                    const fn = SIDEBAR_FUNCTIONS.find((f) => f.id === activeFunction);
                    const Icon = fn?.icon;
                    return (
                      <>
                        {Icon && (
                          <span className="flex items-center justify-center h-6 w-6 rounded-md bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40">
                            <Icon className="w-3.5 h-3.5" />
                          </span>
                        )}
                        <span className="bg-gradient-to-r from-amber-100 to-amber-300 bg-clip-text text-transparent tracking-tight">
                          {fn?.label}
                        </span>
                      </>
                    );
                  })()}
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveFunction(null)}
                  className="flex items-center justify-center h-6 w-6 rounded-md text-slate-400 hover:text-amber-200 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/30 transition-colors"
                  title="Close panel"
                  data-testid="sidebar-panel-close"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </header>

              {/* Target picker — choose between table-checkbox selection
                  and the ad-hoc filter set built below. Live counts make
                  the blast radius unambiguous before clicking Apply. */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-800/80 bg-slate-900/70 p-1 shadow-inner">
                  <button
                    type="button"
                    onClick={() => setTargetMode("selected")}
                    className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all ${
                      targetMode === "selected"
                        ? "bg-gradient-to-b from-amber-500/25 to-amber-500/10 text-amber-100 ring-1 ring-amber-400/40 shadow-[0_2px_8px_-2px_rgba(200,169,81,0.4)]"
                        : "text-slate-400 hover:text-amber-200/90 hover:bg-slate-800/60"
                    }`}
                    data-testid="sidebar-target-selected"
                  >
                    <Check className="w-3 h-3" /> Selected
                    <span className={`tabular-nums ${targetMode === "selected" ? "text-amber-200" : "text-slate-500"}`}>({selectedIds.size})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetMode("filter")}
                    className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all ${
                      targetMode === "filter"
                        ? "bg-gradient-to-b from-amber-500/25 to-amber-500/10 text-amber-100 ring-1 ring-amber-400/40 shadow-[0_2px_8px_-2px_rgba(200,169,81,0.4)]"
                        : "text-slate-400 hover:text-amber-200/90 hover:bg-slate-800/60"
                    }`}
                    data-testid="sidebar-target-filter"
                  >
                    <Filter className="w-3 h-3" /> Matching
                    <span className={`tabular-nums ${targetMode === "filter" ? "text-amber-200" : "text-slate-500"}`}>({matchedIds.length})</span>
                  </button>
                </div>

                {targetMode === "filter" && (
                  <div className="space-y-2 rounded-lg border border-slate-800/80 bg-slate-900/60 p-2.5">
                    <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">
                      Filter criteria
                    </span>
                    <Select value={pickerStatus} onValueChange={setPickerStatus}>
                      <SelectTrigger className="h-8 text-xs bg-slate-950/80 border-slate-700/80 text-white hover:border-amber-500/30 transition-colors" data-testid="picker-status">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-white">
                        <SelectItem value="any">Any status</SelectItem>
                        <SelectItem value="created">Created</SelectItem>
                        <SelectItem value="registered">Registered</SelectItem>
                        <SelectItem value="syncing">Syncing</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={pickerStage} onValueChange={setPickerStage}>
                      <SelectTrigger className="h-8 text-xs bg-slate-950/80 border-slate-700/80 text-white hover:border-amber-500/30 transition-colors" data-testid="picker-stage">
                        <SelectValue placeholder="Stage" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-white max-h-72">
                        <SelectItem value="any">Any stage</SelectItem>
                        <SelectItem value="none">No stage set</SelectItem>
                        {STAGE_INSTRUCTIONS.map((s) => (
                          <SelectItem key={s.stage} value={String(s.stage)}>
                            {String(s.stage).padStart(2, "0")} — {s.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={pickerPriority} onValueChange={setPickerPriority}>
                      <SelectTrigger className="h-8 text-xs bg-slate-950/80 border-slate-700/80 text-white hover:border-amber-500/30 transition-colors" data-testid="picker-priority">
                        <SelectValue placeholder="Priority" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-white">
                        <SelectItem value="any">Any priority</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="none">Unset</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="relative">
                      <UserCheck className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="text"
                        value={pickerAssignee}
                        onChange={(e) => setPickerAssignee(e.target.value)}
                        placeholder="Assignee contains…"
                        className="w-full h-8 text-xs bg-slate-950/80 border border-slate-700/80 text-white rounded-md pl-7 pr-2 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                        data-testid="picker-assignee"
                      />
                    </div>
                    <div className="relative">
                      <svg className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      <input
                        type="text"
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        placeholder="Search code / name / email…"
                        className="w-full h-8 text-xs bg-slate-950/80 border border-slate-700/80 text-white rounded-md pl-7 pr-2 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                        data-testid="picker-search"
                      />
                    </div>
                  </div>
                )}

                {/* Blast-radius summary — emphasized so the operator always
                    sees the count before triggering an action. */}
                <div className="flex items-center justify-between rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-200/80">Will act on</span>
                  <span className="flex items-baseline gap-1">
                    <span className="text-base font-bold tabular-nums bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text text-transparent">
                      {targetCount}
                    </span>
                    <span className="text-[10px] text-amber-200/70">case{targetCount === 1 ? "" : "s"}</span>
                  </span>
                </div>
              </div>

              {/* Per-function controls. Each panel reads/writes its
                  panel-local input state and dispatches against
                  `targetIds`. Premium uniform styling: section eyebrow,
                  unified input/button heights, color-coded primary CTA. */}

              {activeFunction === "stage" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Quick action</span>
                    <Button
                      size="sm"
                      className="w-full h-9 bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold shadow-[0_4px_14px_-4px_rgba(200,169,81,0.5)]"
                      disabled={!canRun}
                      onClick={() => void bulkAdvanceStage(targetIds)}
                      data-testid="panel-advance-stage"
                    >
                      <ArrowUp className="w-3.5 h-3.5 mr-1.5" /> Advance stage +1
                    </Button>
                  </div>
                  <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
                    <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Jump to specific stage</span>
                    <Select value={sidebarStageInput} onValueChange={setSidebarStageInput}>
                      <SelectTrigger className="h-8 text-xs bg-slate-950/80 border-slate-700/80 text-white hover:border-amber-500/30 transition-colors" data-testid="panel-jump-stage-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-white max-h-72">
                        {STAGE_INSTRUCTIONS.map((s) => (
                          <SelectItem key={s.stage} value={String(s.stage)}>
                            {String(s.stage).padStart(2, "0")} — {s.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full h-9 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-100"
                      disabled={!canRun}
                      onClick={() => void bulkSetStage(targetIds, parseInt(sidebarStageInput, 10))}
                      data-testid="panel-jump-stage-apply"
                    >
                      Apply to {targetCount} case{targetCount === 1 ? "" : "s"}
                    </Button>
                  </div>
                </div>
              )}

              {activeFunction === "priority" && (
                <div className="space-y-3">
                  <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Set priority</span>
                  <div className="space-y-1.5">
                    {([
                      { value: "high",   label: "High",   dot: "bg-red-500",    border: "border-red-500/40",    bg: "bg-gradient-to-r from-red-500/15 to-transparent",    text: "text-red-100",   hover: "hover:from-red-500/25", glow: "shadow-[0_0_10px_rgba(239,68,68,0.4)]" },
                      { value: "medium", label: "Medium", dot: "bg-amber-500",  border: "border-amber-500/40",  bg: "bg-gradient-to-r from-amber-500/15 to-transparent",  text: "text-amber-100", hover: "hover:from-amber-500/25", glow: "shadow-[0_0_10px_rgba(251,191,36,0.4)]" },
                      { value: "low",    label: "Low",    dot: "bg-slate-400",  border: "border-slate-700",     bg: "bg-slate-800/60",                                    text: "text-slate-200", hover: "hover:bg-slate-700/60", glow: "shadow-[0_0_8px_rgba(148,163,184,0.3)]" },
                    ] as const).map((p) => (
                      <Button
                        key={p.value}
                        size="sm"
                        variant="outline"
                        className={`w-full h-9 justify-start ${p.border} ${p.bg} ${p.text} ${p.hover}`}
                        disabled={!canRun}
                        onClick={() => void bulkSetPriority(targetIds, p.value)}
                        data-testid={`panel-priority-${p.value}`}
                      >
                        <span className={`inline-block w-2 h-2 rounded-full ${p.dot} ${p.glow} mr-2.5`} />
                        <span className="font-medium">{p.label}</span>
                        <span className="ml-auto text-[10px] text-slate-400">→ {targetCount}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {activeFunction === "assign" && (
                <div className="space-y-2.5">
                  <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Assignee</span>
                  <div className="relative">
                    <UserCheck className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input
                      type="text"
                      value={sidebarAssigneeInput}
                      onChange={(e) => setSidebarAssigneeInput(e.target.value)}
                      placeholder="Assignee name (blank to unassign)"
                      className="w-full h-9 text-xs bg-slate-950/80 border border-slate-700/80 text-white rounded-md pl-8 pr-2 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                      data-testid="panel-assign-input"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-9 bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold shadow-[0_4px_14px_-4px_rgba(200,169,81,0.5)]"
                    disabled={!canRun}
                    onClick={() => bulkSetAssignee(targetIds, sidebarAssigneeInput)}
                    data-testid="panel-assign-apply"
                  >
                    <UserCheck className="w-3.5 h-3.5 mr-1.5" />
                    {sidebarAssigneeInput.trim() ? `Assign ${targetCount}` : `Unassign ${targetCount}`}
                  </Button>
                </div>
              )}

              {activeFunction === "landing" && (
                <div className="space-y-2">
                  <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Set landing page</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {LANDING_PAGE_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={!canRun}
                          onClick={() => void bulkSetLandingPage(targetIds, opt.value)}
                          className="group flex flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-3 text-[11px] text-slate-200 hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-100 disabled:opacity-50 disabled:pointer-events-none transition-all"
                          data-testid={`panel-landing-${opt.value}`}
                        >
                          <span className="flex items-center justify-center h-8 w-8 rounded-md bg-slate-800/80 text-amber-300 group-hover:bg-amber-500/20 group-hover:text-amber-200 ring-1 ring-slate-700/60 group-hover:ring-amber-400/40 transition-all">
                            <Icon className="w-4 h-4" />
                          </span>
                          <span className="font-medium truncate w-full text-center">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeFunction === "email" && (
                <div className="space-y-2.5">
                  <div className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Amount</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={bulkDepositAmount}
                      onChange={(e) => setBulkDepositAmount(e.target.value)}
                      placeholder="750"
                      className={`w-full h-8 text-[11px] bg-slate-950/80 border text-white rounded-md px-2 focus:outline-none focus:ring-1 transition-colors ${!isValidBulkAmount(bulkDepositAmount) && bulkDepositAmount !== "" ? "border-rose-500/60 focus:ring-rose-500/30" : "border-slate-700/80 focus:border-amber-500/50 focus:ring-amber-500/30"}`}
                    />
                    {!isValidBulkAmount(bulkDepositAmount) && bulkDepositAmount !== "" && (
                      <p className="text-rose-400 text-[10px]">Enter a valid positive number</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Coin</span>
                      <select
                        value={bulkDepositCoin}
                        onChange={(e) => setBulkDepositCoin(e.target.value)}
                        className="w-full h-8 text-[11px] bg-slate-950/80 border border-slate-700/80 text-white rounded-md px-2 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                      >
                        {BULK_DEPOSIT_COINS.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Network</span>
                      <select
                        value={bulkDepositNetwork}
                        onChange={(e) => setBulkDepositNetwork(e.target.value)}
                        className="w-full h-8 text-[11px] bg-slate-950/80 border border-slate-700/80 text-white rounded-md px-2 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                      >
                        {BULK_DEPOSIT_NETWORKS.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {!!(BULK_COIN_NETWORK_MAP[bulkDepositCoin] && !BULK_COIN_NETWORK_MAP[bulkDepositCoin].includes(bulkDepositNetwork)) && (
                    <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-rose-500/8 border border-rose-500/25">
                      <span className="text-rose-400 flex-shrink-0 mt-px">⚠</span>
                      <p className="text-rose-300 text-[10px] leading-relaxed">
                        <span className="font-semibold">Network mismatch:</span> {bulkDepositCoin} is not typically sent on {bulkDepositNetwork}. Verify before sending.
                      </p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Quick Templates</span>
                    <select
                      value={sidebarEmailTemplate}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) return;
                        if (val.startsWith("saved:")) {
                          const savedIdx = Number(val.slice(6));
                          const saved = savedEmailTemplates[savedIdx];
                          if (!saved) return;
                          setSidebarEmailSubject(saved.subject);
                          setSidebarEmailBody(saved.body);
                          setSidebarEmailTemplate("");
                          return;
                        }
                        const tpl = buildBulkEmailTemplates(bulkDepositCoin, bulkDepositNetwork, bulkDepositAmount)[Number(val)];
                        if (!tpl) return;
                        setSidebarEmailSubject(tpl.subject);
                        setSidebarEmailBody(tpl.body);
                        setSidebarEmailTemplate("");
                      }}
                      className="w-full h-8 text-[11px] bg-slate-950/80 border border-slate-700/80 text-white rounded-md px-2 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    >
                      <option value="">— Select a template —</option>
                      <optgroup label="Built-in">
                        {buildBulkEmailTemplates(bulkDepositCoin, bulkDepositNetwork, bulkDepositAmount).map((tpl, i) => (
                          <option key={i} value={String(i)}>{tpl.label}</option>
                        ))}
                      </optgroup>
                      {savedEmailTemplates.length > 0 && (
                        <optgroup label="Saved Templates">
                          {savedEmailTemplates.map((tpl, i) => (
                            <option key={tpl.id} value={`saved:${i}`}>{tpl.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Subject</span>
                    <input
                      type="text"
                      value={sidebarEmailSubject}
                      onChange={(e) => setSidebarEmailSubject(e.target.value)}
                      placeholder="Subject line"
                      className="w-full h-9 text-xs bg-slate-950/80 border border-slate-700/80 text-white rounded-md px-2.5 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                      data-testid="panel-email-subject"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Body</span>
                      <span className="text-[10px] text-slate-500 tabular-nums">{sidebarEmailBody.length} chars</span>
                    </div>
                    <textarea
                      value={sidebarEmailBody}
                      onChange={(e) => setSidebarEmailBody(e.target.value)}
                      placeholder="Plain-text message body…"
                      rows={5}
                      className="w-full text-xs bg-slate-950/80 border border-slate-700/80 text-white rounded-md px-2.5 py-2 resize-y placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                      data-testid="panel-email-body"
                    />
                  </div>
                  {/* Before you send note */}
                  <div className="rounded-lg border border-slate-700/40 bg-slate-950/60 p-2.5 space-y-1.5">
                    <p className="text-[9px] uppercase tracking-widest font-semibold text-slate-500">Before you send</p>
                    <ul className="space-y-1.5">
                      {[
                        `Amount is ${bulkDepositAmount || "—"} ${bulkDepositCoin} per declaration on ${bulkDepositNetwork}.`,
                        "Each case's deposit address must be set — bulk sends do not include per-case addresses.",
                        'Use "Required" for first contact, "Reminder" for 48h follow-up. Not both same day.',
                        "Review the body above before hitting Send — bulk emails cannot be recalled.",
                      ].map((tip, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="mt-0.5 flex-shrink-0 w-3 h-3 rounded-full bg-amber-500/20 flex items-center justify-center">
                            <span className="w-1 h-1 rounded-full bg-amber-400" />
                          </span>
                          <p className="text-slate-400 text-[10px] leading-relaxed">{tip}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] ${
                    emailEligibleCount === 0
                      ? "bg-red-500/10 border border-red-500/30 text-red-200"
                      : emailEligibleCount < targetCount
                      ? "bg-amber-500/10 border border-amber-500/30 text-amber-200"
                      : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-200"
                  }`}>
                    <Mail className="w-3 h-3 flex-shrink-0" />
                    <span><span className="font-semibold tabular-nums">{emailEligibleCount}</span> of <span className="tabular-nums">{targetCount}</span> have email on file</span>
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-9 bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold shadow-[0_4px_14px_-4px_rgba(200,169,81,0.5)] disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:shadow-none"
                    disabled={!canRun || !sidebarEmailSubject.trim() || emailEligibleCount === 0 || !isValidBulkAmount(bulkDepositAmount)}
                    onClick={() => {
                      if (emailEligibleCount > BULK_EMAIL_CONFIRM_THRESHOLD) {
                        setConfirmBulkEmailSend(true);
                      } else {
                        void bulkSendEmail(targetIds, sidebarEmailSubject, sidebarEmailBody);
                      }
                    }}
                    data-testid="panel-email-send"
                  >
                    <Mail className="w-3.5 h-3.5 mr-1.5" /> Send to {emailEligibleCount}
                  </Button>
                </div>
              )}

              {activeFunction === "access-code" && (
                <div className="space-y-2.5">
                  <div className="flex items-start gap-2 rounded-md border border-slate-700/60 bg-slate-900/50 p-2.5">
                    <KeyRound className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-300" />
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Emails each target case's current access code to their registered address. Codes are unchanged — pair with a rotation first if a fresh code is needed. Per-case success/failure is reported after sending.
                    </p>
                  </div>
                  <div className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] ${
                    emailEligibleCount === 0
                      ? "bg-red-500/10 border border-red-500/30 text-red-200"
                      : emailEligibleCount < targetCount
                      ? "bg-amber-500/10 border border-amber-500/30 text-amber-200"
                      : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-200"
                  }`}>
                    <Mail className="w-3 h-3 flex-shrink-0" />
                    <span><span className="font-semibold tabular-nums">{emailEligibleCount}</span> of <span className="tabular-nums">{targetCount}</span> have email on file</span>
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-9 bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold shadow-[0_4px_14px_-4px_rgba(200,169,81,0.5)] disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:shadow-none"
                    disabled={!canRun || emailEligibleCount === 0}
                    onClick={() => {
                      if (emailEligibleCount > BULK_ACCESS_CODE_CONFIRM_THRESHOLD) {
                        setConfirmAccessCodeSend(true);
                      } else {
                        void bulkSendAccessCodes(targetIds);
                      }
                    }}
                    data-testid="panel-access-code-send"
                  >
                    <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Send access code to {emailEligibleCount}
                  </Button>
                  {lastAccessCodeFailures.length > 0 && (
                    <div
                      className="space-y-1.5 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-[11px] text-red-200"
                      data-testid="access-code-failure-list"
                    >
                      <p className="font-semibold text-red-100">
                        {lastAccessCodeFailures.length} failed on last send
                      </p>
                      <ExpandableFailureList failures={lastAccessCodeFailures} />
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1 h-7 w-full border-red-500/40 bg-transparent text-[11px] text-red-100 hover:bg-red-500/10"
                        onClick={() => {
                          setSelectedIds(new Set(lastAccessCodeFailures.map((f) => f.id)));
                          setTargetMode("selected");
                        }}
                        data-testid="access-code-retry-failed"
                      >
                        Retarget {lastAccessCodeFailures.length} failed case{lastAccessCodeFailures.length === 1 ? "" : "s"} for retry
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-full border-red-500/40 bg-transparent text-[11px] text-red-100 hover:bg-red-500/10"
                        onClick={exportAccessCodeFailures}
                        data-testid="access-code-export-failures"
                      >
                        <FileText className="w-3 h-3 mr-1.5" /> Export {lastAccessCodeFailures.length} failed case{lastAccessCodeFailures.length === 1 ? "" : "s"} as CSV
                      </Button>
                    </div>
                  )}

                  {/* Task #2440 — bulk-rotate section of the same panel, so
                      admins clearing the legacy access-code backlog can
                      rotate the whole target set (then optionally send-code
                      above if any notification failed) without switching
                      panels. */}
                  <div className="mt-3 border-t border-slate-700/60 pt-2.5 space-y-2.5">
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                      <KeyRound className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-300" />
                      <p className="text-[11px] text-amber-100/90 leading-relaxed">
                        Issues a fresh access code for each target case (old code stops working, active sessions signed out) and emails the new code to the case's registered address. Use with the "Legacy access codes" filter to clear the backlog in one action.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="w-full h-9 bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold shadow-[0_4px_14px_-4px_rgba(239,68,68,0.5)] disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:shadow-none"
                      disabled={!canRun}
                      onClick={() => {
                        if (targetCount > BULK_ACCESS_CODE_ROTATE_CONFIRM_THRESHOLD) {
                          const idsSnapshot = targetIds;
                          setBulkRotateActiveSessionCheck({ checking: true, count: null });
                          setConfirmAccessCodeRotate(true);
                          // checkHasActiveSession() already swallows its own
                          // fetch errors and resolves with hasActiveSession:
                          // false (fail-open), so Promise.all here won't
                          // normally reject. The .catch is defense-in-depth
                          // only — e.g. if a future change to the helper
                          // starts rejecting — and renders the "could not
                          // check" fallback below rather than silently
                          // showing a possibly-wrong count.
                          Promise.all(
                            idsSnapshot.map((id) => checkHasActiveSession(id, authToken)),
                          )
                            .then((results) => {
                              setBulkRotateActiveSessionCheck({
                                checking: false,
                                count: results.filter((r) => r.hasActiveSession).length,
                              });
                            })
                            .catch(() => {
                              setBulkRotateActiveSessionCheck({ checking: false, count: null });
                            });
                        } else {
                          void bulkRotateAccessCodes(targetIds);
                        }
                      }}
                      data-testid="panel-access-code-rotate"
                    >
                      <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Rotate access code for {targetCount}
                    </Button>
                    {lastAccessCodeRotateFailures.length > 0 && (
                      <div
                        className="space-y-1.5 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-[11px] text-red-200"
                        data-testid="access-code-rotate-failure-list"
                      >
                        <p className="font-semibold text-red-100">
                          {lastAccessCodeRotateFailures.length} failed on last rotation
                        </p>
                        <ExpandableFailureList failures={lastAccessCodeRotateFailures} />
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-1 h-7 w-full border-red-500/40 bg-transparent text-[11px] text-red-100 hover:bg-red-500/10"
                          onClick={() => {
                            setSelectedIds(new Set(lastAccessCodeRotateFailures.map((f) => f.id)));
                            setTargetMode("selected");
                          }}
                          data-testid="access-code-rotate-retry-failed"
                        >
                          Retarget {lastAccessCodeRotateFailures.length} failed case{lastAccessCodeRotateFailures.length === 1 ? "" : "s"} for retry
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 w-full border-red-500/40 bg-transparent text-[11px] text-red-100 hover:bg-red-500/10"
                          onClick={exportAccessCodeRotateFailures}
                          data-testid="access-code-rotate-export-failures"
                        >
                          <FileText className="w-3 h-3 mr-1.5" /> Export {lastAccessCodeRotateFailures.length} failed case{lastAccessCodeRotateFailures.length === 1 ? "" : "s"} as CSV
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeFunction === "export" && (
                <div className="space-y-2.5">
                  <div className="flex items-start gap-2 rounded-md border border-slate-700/60 bg-slate-900/50 p-2.5">
                    <FileText className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-300" />
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Download a CSV with access code, status, contact, withdrawal amount, batches and seal info for the selected cases.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-9 bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold shadow-[0_4px_14px_-4px_rgba(200,169,81,0.5)] disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:shadow-none"
                    disabled={targetCount === 0}
                    onClick={() => bulkExportSelected(targetIds)}
                    data-testid="panel-export-apply"
                  >
                    <FileText className="w-3.5 h-3.5 mr-1.5" /> Export {targetCount} as CSV
                  </Button>
                </div>
              )}

              {activeFunction === "block" && (
                <div className="space-y-2.5">
                  <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2.5">
                    <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-300" />
                    <p className="text-[11px] text-red-100/90 leading-relaxed">
                      Blocks the most recent login IP for each target case. This affects every visitor on that IP — use with care.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Reason</span>
                    <input
                      type="text"
                      value={sidebarBlockReason}
                      onChange={(e) => setSidebarBlockReason(e.target.value)}
                      placeholder="Reason (optional, shown in audit log)"
                      className="w-full h-9 text-xs bg-slate-950/80 border border-slate-700/80 text-white rounded-md px-2.5 placeholder:text-slate-500 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/30 transition-colors"
                      data-testid="panel-block-reason"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-slate-700/60 bg-slate-900/50 px-2.5 py-1.5 text-[11px] text-slate-300">
                    <span>Unique IPs</span>
                    <span className="tabular-nums font-semibold text-white">{blockableIpCount} / {targetCount}</span>
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-9 bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold shadow-[0_4px_14px_-4px_rgba(239,68,68,0.5)] disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:shadow-none"
                    disabled={!canRun || blockableIpCount === 0}
                    onClick={() => {
                      if (blockableIpCount > BULK_BLOCK_IPS_CONFIRM_THRESHOLD) {
                        setConfirmBulkBlockIps(true);
                      } else {
                        void bulkBlockIps(targetIds, sidebarBlockReason);
                      }
                    }}
                    data-testid="panel-block-apply"
                  >
                    <Ban className="w-3.5 h-3.5 mr-1.5" /> Block {blockableIpCount} IP{blockableIpCount === 1 ? "" : "s"}
                  </Button>
                </div>
              )}

              {activeFunction === "flags" && (
                <div className="space-y-1.5">
                  <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Per-case feature flags</span>
                  {([
                    { field: "isRegulated",             label: "Regulated badge",   hint: "Show regulator badge" },
                    { field: "ndaEnabled",              label: "NDA",               hint: "Require non-disclosure" },
                    { field: "certificateEnabled",      label: "Certificate",       hint: "Issue completion cert." },
                    { field: "stampDutyEnabled",        label: "Stamp duty",        hint: "Collect stamp duty" },
                    { field: "withdrawalWindowEnabled", label: "Withdrawal window", hint: "Time-bound payout" },
                  ] as const).map((f) => (
                    <div
                      key={f.field}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/80 bg-slate-900/60 px-2.5 py-2 hover:border-amber-500/30 hover:bg-slate-900/80 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-slate-100 truncate">{f.label}</div>
                        <div className="text-[10px] text-slate-500 truncate">{f.hint}</div>
                      </div>
                      <div className="flex flex-shrink-0 rounded-md border border-slate-700 bg-slate-950/60 p-0.5">
                        <button
                          type="button"
                          disabled={!canRun}
                          onClick={() => void bulkSetFlag(targetIds, f.field, true)}
                          className="h-6 px-2.5 text-[10px] font-semibold rounded text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-100 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                          data-testid={`panel-flag-${f.field}-on`}
                        >
                          ON
                        </button>
                        <button
                          type="button"
                          disabled={!canRun}
                          onClick={() => void bulkSetFlag(targetIds, f.field, false)}
                          className="h-6 px-2.5 text-[10px] font-semibold rounded text-slate-400 hover:bg-slate-700/60 hover:text-slate-100 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                          data-testid={`panel-flag-${f.field}-off`}
                        >
                          OFF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeFunction === "session-refresh" && (
                <div className="space-y-2">
                  <span className="block text-[9px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Session Refresh</span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Request or review a session-refresh deposit gate for a specific case. Select exactly one case from the table, then open its workflow panel below.
                  </p>
                  {selectedIds.size === 1 && (() => {
                    const cid = Array.from(selectedIds)[0];
                    const sc = cases.find((x) => x.id === cid);
                    return sc ? (
                      <button
                        type="button"
                        onClick={() => openAdminMessageDialog(sc, "workflow")}
                        data-testid="sidebar-fn-session-refresh-open"
                        className="w-full mt-1 flex items-center justify-center gap-1.5 rounded-md border border-teal-600/40 bg-teal-600/10 px-3 py-2 text-[11px] font-semibold text-teal-300 hover:bg-teal-600/20 hover:text-teal-100 transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Open Session Refresh — {sc.userName || sc.accessCode}
                      </button>
                    ) : null;
                  })()}
                  {selectedIds.size !== 1 && (
                    <p className="text-[11px] text-amber-400/80 mt-1">
                      {selectedIds.size === 0
                        ? "Select a case row to enable this action."
                        : "Select exactly one case to manage session refresh."}
                    </p>
                  )}
                </div>
              )}

              {selectedIds.size > 0 && (
                <div className="pt-2 border-t border-slate-800/60">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full h-7 text-[11px] text-slate-400 hover:text-amber-200 hover:bg-amber-500/5"
                    onClick={() => setSelectedIds(new Set())}
                    data-testid="sidebar-clear-selection"
                  >
                    <X className="w-3.5 h-3.5 mr-1" /> Clear table selection ({selectedIds.size})
                  </Button>
                </div>
              )}
            </div>
          )}
        </aside>

        <div className="flex-1 min-w-0 w-full">
      <CasesKpiStrip
        cases={cases}
        documentRequestsPending={
          documentRequests.filter((d) => d.status === "pending" || d.status === "requested").length
        }
        userDocPendingTotal={Object.values(userDocPendingCounts).reduce((sum, n) => sum + n, 0)}
        withdrawalPendingTotal={withdrawalPendingTotal}
        refundClaimPendingCount={cases.filter((c) => c.refundClaimStatus === "submitted").length}
        legacyAccessCodeCount={legacyAccessCodeCount}
        authToken={authToken}
        onFilter={(key) => {
          // Each KPI card is a one-click filter into the matching slice of work.
          // Pending receipts / documents / failed-emails jump to the relevant
          // admin section instead of just narrowing the Cases list, because
          // those datasets live outside the case table.
          if (key === "open") {
            setSearchQuery("");
            setStatusFilter("all");
            setLocaleFilter("all");
            setSealedFilter("all");
            setStampDutyPendingOnly(false);
            setWithdrawalPendingOnly(false);
            setReactivationPendingOnly(false);
            setRefundClaimStatusFilter("all");
            setLegacyAccessCodeOnly(false);
            return;
          }
          if (key === "awaiting_admin") {
            setSearchQuery("");
            setStatusFilter("syncing");
            setLocaleFilter("all");
            setSealedFilter("all");
            setStampDutyPendingOnly(true);
            setWithdrawalPendingOnly(false);
            setReactivationPendingOnly(false);
            setRefundClaimStatusFilter("all");
            setLegacyAccessCodeOnly(false);
            return;
          }
          if (key === "pending_receipts") {
            setActiveTab("receipts");
            return;
          }
          if (key === "pending_reactivation") {
            setReceiptsInboxFilter("reactivation");
            setActiveTab("receipts");
            return;
          }
          if (key === "pending_documents") {
            setActiveTab("documents");
            return;
          }
          if (key === "pending_uploads") {
            setActiveTab("supporting-docs");
            return;
          }
          if (key === "pending_withdrawals") {
            setSearchQuery("");
            setStatusFilter("all");
            setLocaleFilter("all");
            setSealedFilter("all");
            setStampDutyPendingOnly(false);
            setWithdrawalPendingOnly(true);
            setReactivationPendingOnly(false);
            setRefundClaimStatusFilter("all");
            setLegacyAccessCodeOnly(false);
            return;
          }
          if (key === "pending_refund_claims") {
            setSearchQuery("");
            setStatusFilter("all");
            setLocaleFilter("all");
            setSealedFilter("all");
            setStampDutyPendingOnly(false);
            setWithdrawalPendingOnly(false);
            setReactivationPendingOnly(false);
            setRefundClaimStatusFilter("submitted");
            setLegacyAccessCodeOnly(false);
            return;
          }
          if (key === "failed_emails") {
            setActiveTab("analytics");
            return;
          }
          if (key === "legacy_access_codes") {
            setSearchQuery("");
            setStatusFilter("all");
            setLocaleFilter("all");
            setSealedFilter("all");
            setStampDutyPendingOnly(false);
            setWithdrawalPendingOnly(false);
            setReactivationPendingOnly(false);
            setRefundClaimStatusFilter("all");
            setLegacyAccessCodeOnly(true);
            return;
          }
        }}
      />
      <CaseFilterPresets
        current={{ searchQuery, statusFilter, localeFilter, sealedFilter, stampDutyPendingOnly, reactivationPendingOnly, refundClaimStatusFilter, legacyAccessCodeOnly }}
        apply={(s) => {
          setSearchQuery(s.searchQuery);
          setStatusFilter(s.statusFilter);
          setLocaleFilter(s.localeFilter);
          setSealedFilter(s.sealedFilter as "all" | "sealed" | "open");
          setStampDutyPendingOnly(s.stampDutyPendingOnly);
          setReactivationPendingOnly(s.reactivationPendingOnly);
          setRefundClaimStatusFilter(s.refundClaimStatusFilter as RefundClaimStatusFilter);
          setLegacyAccessCodeOnly(s.legacyAccessCodeOnly);
        }}
      />
      <Card className="bg-slate-950 border-slate-800 overflow-hidden">
        <CardHeader className="border-b border-slate-800 bg-slate-900/50 py-4">
           <div className="flex flex-col gap-4">
             <div className="flex justify-between items-center">
               <CardTitle className="text-base font-medium text-white">Active Cases</CardTitle>
               <Button variant="outline" size="sm" className="border-slate-700 bg-slate-800 text-slate-300" onClick={() => loadData(true)} data-testid="button-refresh">
                 <RefreshCw className="w-4 h-4 mr-2" /> Refresh
               </Button>
             </div>

             {/* Search and Filter Row */}
             <div className="flex flex-col sm:flex-row gap-3">
               <div className="relative flex-1">
                 <input
                   type="text"
                   placeholder="Search by code, name, or email..."
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 pl-10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                   data-testid="input-search-cases"
                 />
                 <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                 </svg>
                 {searchQuery && (
                   <button
                     onClick={() => setSearchQuery("")}
                     className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                   >
                     <X className="w-4 h-4" />
                   </button>
                 )}
               </div>

               <Select value={statusFilter} onValueChange={setStatusFilter}>
                 <SelectTrigger className="w-full sm:w-[180px] bg-slate-900 border-slate-700 text-white" data-testid="select-status-filter">
                   <SelectValue placeholder="Filter by status" />
                 </SelectTrigger>
                 <SelectContent className="bg-slate-900 border-slate-700">
                   <SelectItem value="all" className="text-white hover:bg-slate-800">All Statuses</SelectItem>
                   <SelectItem value="created" className="text-white hover:bg-slate-800">Created</SelectItem>
                   <SelectItem value="syncing" className="text-white hover:bg-slate-800">Syncing</SelectItem>
                   <SelectItem value="active" className="text-white hover:bg-slate-800">Active</SelectItem>
                   <SelectItem value="completed" className="text-white hover:bg-slate-800">Completed</SelectItem>
                 </SelectContent>
               </Select>

               <Select value={sealedFilter} onValueChange={(v) => setSealedFilter(v as "all" | "sealed" | "open")}>
                 <SelectTrigger className="w-full sm:w-[160px] bg-slate-900 border-slate-700 text-white" data-testid="select-sealed-filter">
                   <SelectValue placeholder="Filter by seal" />
                 </SelectTrigger>
                 <SelectContent className="bg-slate-900 border-slate-700">
                   <SelectItem value="all" className="text-white hover:bg-slate-800">All Cases</SelectItem>
                   <SelectItem value="sealed" className="text-white hover:bg-slate-800">Sealed Only</SelectItem>
                   <SelectItem value="open" className="text-white hover:bg-slate-800">Open Only</SelectItem>
                 </SelectContent>
               </Select>

               <Select
                 value={refundClaimStatusFilter}
                 onValueChange={(v) => setRefundClaimStatusFilter(v as RefundClaimStatusFilter)}
               >
                 <SelectTrigger className="w-full sm:w-[200px] bg-slate-900 border-slate-700 text-white" data-testid="select-refund-claim-filter">
                   <SelectValue placeholder="Filter by refund claim" />
                 </SelectTrigger>
                 <SelectContent className="bg-slate-900 border-slate-700">
                   <SelectItem value="all" className="text-white hover:bg-slate-800">All Refund Claims</SelectItem>
                   <SelectItem value="pending_submission" className="text-white hover:bg-slate-800">Pending Submission</SelectItem>
                   <SelectItem value="submitted" className="text-white hover:bg-slate-800">Submitted</SelectItem>
                   <SelectItem value="approved" className="text-white hover:bg-slate-800">Approved</SelectItem>
                   <SelectItem value="rejected" className="text-white hover:bg-slate-800">Rejected</SelectItem>
                 </SelectContent>
               </Select>

               <Select value={localeFilter} onValueChange={setLocaleFilter}>
                 <SelectTrigger className="w-full sm:w-[180px] bg-slate-900 border-slate-700 text-white" data-testid="select-locale-filter">
                   <SelectValue placeholder="Filter by email language" />
                 </SelectTrigger>
                 <SelectContent className="bg-slate-900 border-slate-700">
                   <SelectItem value="all" className="text-white hover:bg-slate-800">All Languages</SelectItem>
                   <SelectItem value="__none__" className="text-white hover:bg-slate-800">Auto (unset)</SelectItem>
                   {SUPPORTED_LOCALES.map((l) => (
                     <SelectItem key={l.code} value={l.code} className="text-white hover:bg-slate-800">
                       {l.code.toUpperCase()} — {l.label}
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>

             {/* Quick-triage pill — visible only when at least one case is
                 currently awaiting stamp-duty review, so the chrome stays
                 quiet during normal operations. */}
             {stampDutyPendingCount > 0 && (
               <div className="flex flex-wrap items-center gap-2">
                 <button
                   type="button"
                   onClick={() => setStampDutyPendingOnly(!stampDutyPendingOnly)}
                   className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                     stampDutyPendingOnly
                       ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                       : 'border-amber-700 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                   }`}
                   aria-pressed={stampDutyPendingOnly}
                   data-testid="button-filter-stamp-duty-pending"
                 >
                   <Stamp className="h-3.5 w-3.5" />
                   Stamp duty pending review
                   <span className="ml-0.5 rounded-full bg-amber-500/30 px-1.5 text-[10px] text-amber-100">
                     {stampDutyPendingCount}
                   </span>
                 </button>
               </div>
             )}

             {/* Quick-triage pill for cases with a withdrawal request awaiting
                 admin review (Task #780). Mirrors the stamp-duty pill — only
                 visible when at least one request is pending. */}
             {withdrawalPendingTotal > 0 && (
               <div className="flex flex-wrap items-center gap-2">
                 <button
                   type="button"
                   onClick={() => setWithdrawalPendingOnly(!withdrawalPendingOnly)}
                   className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                     withdrawalPendingOnly
                       ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                       : 'border-emerald-700 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                   }`}
                   aria-pressed={withdrawalPendingOnly}
                   data-testid="button-filter-withdrawal-pending"
                 >
                   <Wallet className="h-3.5 w-3.5" />
                   Withdrawal requests pending review
                   <span className="ml-0.5 rounded-full bg-emerald-500/30 px-1.5 text-[10px] text-emerald-100">
                     {withdrawalPendingTotal}
                   </span>
                 </button>
               </div>
             )}

             {/* Quick-triage pill — visible only when at least one disabled case
                 has a reactivation receipt awaiting review. */}
             {reactivationPendingTotal > 0 && (
               <div className="flex flex-wrap items-center gap-2">
                 <button
                   type="button"
                   onClick={() => setReactivationPendingOnly(!reactivationPendingOnly)}
                   className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                     reactivationPendingOnly
                       ? 'border-rose-400 bg-rose-500/20 text-rose-200'
                       : 'border-rose-700 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                   }`}
                   aria-pressed={reactivationPendingOnly}
                   data-testid="button-filter-reactivation-pending"
                 >
                   <RefreshCw className="h-3.5 w-3.5" />
                   Reactivation receipts pending review
                   <span className="ml-0.5 rounded-full bg-rose-500/30 px-1.5 text-[10px] text-rose-100">
                     {reactivationPendingTotal}
                   </span>
                 </button>
               </div>
             )}

             {/* Quick-triage pill — visible only when at least one case still
                 has a legacy (alphanumeric) access code. */}
             {legacyAccessCodeCount > 0 && (
               <div className="flex flex-wrap items-center gap-2">
                 <button
                   type="button"
                   onClick={() => setLegacyAccessCodeOnly(!legacyAccessCodeOnly)}
                   className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                     legacyAccessCodeOnly
                       ? 'border-orange-400 bg-orange-500/20 text-orange-200'
                       : 'border-orange-700 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20'
                   }`}
                   aria-pressed={legacyAccessCodeOnly}
                   data-testid="button-filter-legacy-access-code"
                 >
                   <AlertTriangle className="h-3.5 w-3.5" />
                   Legacy access codes
                   <span className="ml-0.5 rounded-full bg-orange-500/30 px-1.5 text-[10px] text-orange-100">
                     {legacyAccessCodeCount}
                   </span>
                 </button>
               </div>
             )}

             {/* Active refund-claim filter chip — dismissible, only shown when a
                 specific status is selected so admins can clear it individually. */}
             {refundClaimStatusFilter !== "all" && (
               <div className="flex flex-wrap items-center gap-2">
                 <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400 bg-violet-500/20 px-3 py-1 text-xs font-medium text-violet-200">
                   <RotateCcw className="h-3.5 w-3.5" />
                   Refund:{" "}
                   {refundClaimStatusFilter === "pending_submission"
                     ? REFUND_CLAIM_STATUS_LABELS.pending_submission
                     : refundClaimStatusFilter === "submitted"
                       ? REFUND_CLAIM_STATUS_LABELS.submitted
                       : refundClaimStatusFilter === "approved"
                         ? REFUND_CLAIM_STATUS_LABELS.approved
                         : refundClaimStatusFilter === "rejected"
                           ? REFUND_CLAIM_STATUS_LABELS.rejected
                           : assertNeverRefundStatus(refundClaimStatusFilter)}
                   <button
                     type="button"
                     onClick={() => setRefundClaimStatusFilter("all")}
                     className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/30 transition-colors"
                     aria-label="Clear refund claim filter"
                     data-testid="button-clear-refund-claim-filter"
                   >
                     <X className="h-3 w-3" />
                   </button>
                 </span>
               </div>
             )}

             {/* Results count. In server-paging mode the total comes from the
                 DB's COUNT(*) rather than the length of a fully-fetched
                 client array. */}
             <div className="text-xs text-slate-500">
               {(() => {
                 const totalMatching = serverPagingActive ? serverTotal : displayedCases.length;
                 return (
                   <>
                     Showing {totalMatching === 0 ? 0 : (casesPage - 1) * CASES_PAGE_SIZE + 1}
                     –{Math.min(casesPage * CASES_PAGE_SIZE, totalMatching)} of {totalMatching} matching ({cases.length} total) cases
                     {isServerCasesLoading && <span className="ml-2 text-slate-600">(loading…)</span>}
                   </>
                 );
               })()}
               {(searchQuery || statusFilter !== 'all' || localeFilter !== 'all' || sealedFilter !== 'all' || stampDutyPendingOnly || withdrawalPendingOnly || reactivationPendingOnly || refundClaimStatusFilter !== 'all' || legacyAccessCodeOnly) && (
                 <button
                   onClick={() => { setSearchQuery(""); setStatusFilter("all"); setLocaleFilter("all"); setSealedFilter("all"); setStampDutyPendingOnly(false); setWithdrawalPendingOnly(false); setReactivationPendingOnly(false); setRefundClaimStatusFilter("all"); setLegacyAccessCodeOnly(false); }}
                   className="ml-2 text-blue-400 hover:text-blue-300"
                   data-testid="button-clear-all-filters"
                 >
                   Clear filters
                 </button>
               )}
             </div>
           </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-900">
              <TableRow className="hover:bg-slate-900 border-slate-800">
                <TableHead className="text-slate-400 w-[36px]">
                  {/* Master checkbox — selects every currently-visible row.
                      Indeterminate when only some are selected. Driven by a
                      ref so we can set the DOM `indeterminate` flag, which
                      isn't a React prop. */}
                  <input
                    type="checkbox"
                    aria-label="Select all visible cases"
                    className="h-4 w-4 cursor-pointer accent-amber-500"
                    checked={
                      displayedCases.length > 0 &&
                      displayedCases.every((c) => selectedIds.has(c.id))
                    }
                    ref={(el) => {
                      if (el) {
                        const some = displayedCases.some((c) => selectedIds.has(c.id));
                        const all = displayedCases.every((c) => selectedIds.has(c.id));
                        el.indeterminate = some && !all;
                      }
                    }}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds((prev) => {
                          const n = new Set(prev);
                          displayedCases.forEach((c) => n.add(c.id));
                          return n;
                        });
                      } else {
                        setSelectedIds((prev) => {
                          const n = new Set(prev);
                          displayedCases.forEach((c) => n.delete(c.id));
                          return n;
                        });
                      }
                    }}
                    data-testid="checkbox-select-all"
                  />
                </TableHead>
                <TableHead className="text-slate-400 w-[100px]">Status</TableHead>
                <TableHead className="text-slate-400">Case Ref</TableHead>
                <TableHead className="text-slate-400">Access Code</TableHead>
                <TableHead className="text-slate-400">User Identity</TableHead>
                <TableHead className="text-slate-400">Contact</TableHead>
                <TableHead className="text-slate-400 w-[160px]">Stage</TableHead>
                <TableHead className="text-slate-400 w-[200px]">Quick Edit</TableHead>
                <TableHead className="text-slate-400">
                  <button
                    type="button"
                    onClick={toggleSealSort}
                    className="inline-flex items-center gap-1 hover:text-white"
                    data-testid="button-sort-sealed"
                    title="Sort by sealed date"
                  >
                    Sealed
                    {sealSort === "desc" ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : sealSort === "asc" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-slate-400 text-center">Submissions</TableHead>
                <TableHead className="text-slate-400 text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isDataLoading ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent border-slate-800 animate-pulse">
                    <TableCell><div className="h-4 w-4 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-20 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-24 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-32 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-28 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-24 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-36 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-20 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-16 bg-slate-800 rounded mx-auto"></div></TableCell>
                    <TableCell><div className="h-8 w-24 bg-slate-800 rounded mx-auto"></div></TableCell>
                  </TableRow>
                ))
              ) : displayedCases.length === 0 ? (
                <TableRow className="hover:bg-transparent border-slate-800">
                  <TableCell colSpan={11} className="text-center py-12 text-slate-500">
                    {cases.length === 0
                      ? "No active cases. Create one to get started."
                      : "No cases match your search criteria."}
                  </TableCell>
                </TableRow>
              ) : (
                pagedCases.map((c) => (
                  <TableRow
                    key={c.id}
                    className={`hover:bg-slate-900/50 border-slate-800 group ${selectedIds.has(c.id) ? "bg-amber-500/5" : ""}`}
                    data-testid={`row-case-${c.id}`}
                  >
                    {/* Per-row checkbox — toggles this case in/out of the
                        bulk-action selection. Wrapped in a label so the
                        whole cell is a click target. */}
                    <TableCell className="w-[36px]">
                      <input
                        type="checkbox"
                        aria-label={`Select case ${c.accessCode}`}
                        className="h-4 w-4 cursor-pointer accent-amber-500"
                        checked={selectedIds.has(c.id)}
                        onChange={(e) => toggleSelected(c.id, e.target.checked)}
                        data-testid={`checkbox-select-${c.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant="outline"
                          className={
                            c.status === 'created'    ? CASE_STATUS_CLASSES.created    :
                            c.status === 'registered' ? CASE_STATUS_CLASSES.registered :
                            c.status === 'syncing'    ? CASE_STATUS_CLASSES.syncing    :
                            c.status === 'active'     ? CASE_STATUS_CLASSES.active     :
                            c.status === 'completed'  ? CASE_STATUS_CLASSES.completed  :
                            c.status === 'sealed'     ? CASE_STATUS_CLASSES.sealed     :
                            assertNeverCaseStatus(c.status)
                          }
                          data-testid={`badge-case-status-${c.id}`}
                        >
                          {c.status.toUpperCase()}
                        </Badge>
                        {c.isDisabled && (
                          <Badge variant="outline" className="text-rose-300 border-rose-700 bg-rose-500/10" data-testid={`badge-locked-${c.id}`}>
                            <Lock className="w-3 h-3 mr-1" /> LOCKED
                          </Badge>
                        )}
                        {c.isDisabled && (reactivationPendingCounts[c.id] ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => openReceiptsDialog(c)}
                            title="Reactivation receipt uploaded — awaiting your review. Click to open receipts."
                            data-testid={`badge-reactivation-pending-${c.id}`}
                          >
                            <Badge
                              variant="outline"
                              className="cursor-pointer text-rose-200 border-rose-400 bg-rose-500/15 animate-pulse hover:bg-rose-500/25"
                            >
                              <RefreshCw className="w-3 h-3 mr-1" /> REACTIVATION PENDING
                            </Badge>
                          </button>
                        )}
                        {isStampDutyPending(c) && (
                          <Badge
                            variant="outline"
                            className="text-amber-200 border-amber-500 bg-amber-500/15 animate-pulse"
                            title="Stamp-duty receipt uploaded — awaiting your review"
                            data-testid={`badge-stamp-duty-pending-${c.id}`}
                          >
                            <Stamp className="w-3 h-3 mr-1" /> STAMP DUTY PENDING
                          </Badge>
                        )}
                        {(userDocPendingCounts[c.id] ?? 0) > 0 && (
                          <SupportingDocsQuickPopover
                            caseId={c.id}
                            count={userDocPendingCounts[c.id] ?? 0}
                            authToken={authToken}
                            onActioned={() => loadUserDocPendingCounts()}
                          />
                        )}
                        {(withdrawalPendingCounts[c.id] ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => openWithdrawalRequestsDialog(c)}
                            title="Withdrawal request awaiting your review — click to review"
                            data-testid={`badge-withdrawal-pending-${c.id}`}
                          >
                            <Badge
                              variant="outline"
                              className="cursor-pointer text-emerald-200 border-emerald-500 bg-emerald-500/15 animate-pulse hover:bg-emerald-500/25"
                            >
                              <Wallet className="w-3 h-3 mr-1" /> WITHDRAWAL PENDING
                            </Badge>
                          </button>
                        )}
                        {mutedAlertCaseIds.has(c.id) && (
                          <Badge
                            variant="outline"
                            className="text-amber-200 border-amber-500 bg-amber-500/15"
                            title="Upload alerts are muted for this case — admins will not be emailed for new supporting-document uploads until unmuted."
                            data-testid={`badge-doc-upload-alert-muted-${c.id}`}
                          >
                            <BellOff className="w-3 h-3 mr-1" /> MUTED
                          </Badge>
                        )}
                        {mutedWalletAlertCaseIds.has(c.id) && (
                          <Badge
                            variant="outline"
                            className="text-purple-200 border-purple-500 bg-purple-500/15"
                            title="Wallet-connect alerts are muted for this case — the admin email that fires on the user's first wallet phrase reveal is silenced until unmuted."
                            data-testid={`badge-wallet-alert-muted-${c.id}`}
                          >
                            <BellOff className="w-3 h-3 mr-1" /> WALLET MUTED
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {c.caseRef ? (
                        <span
                          className="font-mono text-xs text-fuchsia-300 tracking-wider"
                          data-testid={`text-case-ref-${c.id}`}
                        >
                          {c.caseRef}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono">
                      <div className="flex flex-col gap-1.5">
                        {/* Login access code — what the user types in to sign in.
                            Copy button so the admin can paste it straight into chat
                            or email when a user says they've lost it. */}
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-white font-bold tracking-wider select-all"
                            data-testid={`text-access-code-${c.id}`}
                          >
                            {c.accessCode}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-slate-400 hover:text-white hover:bg-slate-800"
                            title="Copy login access code"
                            onClick={() => {
                              try {
                                navigator.clipboard?.writeText(c.accessCode);
                                toast({
                                  title: "Access code copied",
                                  description: c.accessCode,
                                });
                              } catch {
                                toast({
                                  title: "Could not copy",
                                  variant: "destructive",
                                });
                              }
                            }}
                            data-testid={`button-copy-access-code-${c.id}`}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          {!/^[0-9]+$/.test(c.accessCode) && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-sans font-semibold uppercase tracking-wide text-amber-300"
                              title="Legacy-format access code (contains letters). Still works, but consider using Rotate Access Code (in Edit Account) to issue a new digits-only code."
                              data-testid={`badge-legacy-access-code-${c.id}`}
                            >
                              <AlertTriangle className="h-2.5 w-2.5" />
                              Legacy
                            </span>
                          )}
                        </div>
                        {/* Portal PIN — PINs are stored as bcrypt hashes and
                            are never displayed in plaintext. This badge simply
                            indicates whether the user has completed PIN setup. */}
                        {c.userPin && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-sans">
                              PIN:
                            </span>
                            <span
                              className="text-emerald-400 text-xs font-sans"
                              title="User has set a portal PIN"
                              data-testid={`text-pin-set-${c.id}`}
                            >
                              Set
                            </span>
                          </div>
                        )}
                        {/* Declaration access code — separate single-use code only
                            needed for the Declaration of Compliance step. Hidden
                            unless one has been issued. */}
                        {c.declarationAccessCode && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-sans">
                              Declaration:
                            </span>
                            <span
                              className="text-blue-300 text-sm tracking-wider select-all"
                              data-testid={`text-declaration-code-${c.id}`}
                            >
                              {c.declarationAccessCode}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 w-5 p-0 text-slate-400 hover:text-white hover:bg-slate-800"
                              title="Copy declaration access code"
                              onClick={() => {
                                try {
                                  navigator.clipboard?.writeText(c.declarationAccessCode!);
                                  toast({
                                    title: "Declaration code copied",
                                    description: c.declarationAccessCode!,
                                  });
                                } catch {
                                  toast({
                                    title: "Could not copy",
                                    variant: "destructive",
                                  });
                                }
                              }}
                              data-testid={`button-copy-declaration-code-${c.id}`}
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-300">
                      {c.userName ? (
                         <div className="font-medium text-white">{c.userName}</div>
                      ) : (
                        <span className="text-slate-600 italic">Pending Login...</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-400 text-sm">
                      {(() => {
                        const code = (c.preferredLocale ?? "").trim().toLowerCase();
                        const meta = SUPPORTED_LOCALES.find(
                          (l) => l.code.toLowerCase() === code,
                        );
                        const localeBadge =
                          code && meta ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 text-indigo-300 border-indigo-700/60 bg-indigo-500/10 uppercase tracking-wider"
                              title={`Email language: ${meta.label} (${meta.nativeLabel})`}
                              data-testid={`badge-locale-${c.id}`}
                            >
                              {meta.code.toUpperCase()}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 text-slate-400 border-slate-700 uppercase tracking-wider"
                              title="Email language not set — defaults to user's browser language"
                              data-testid={`badge-locale-${c.id}`}
                            >
                              Auto
                            </Badge>
                          );
                        const emailSummary = emailDeliverySummaries[c.id];
                        return (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {c.userEmail ? (
                                <span>{c.userEmail}</span>
                              ) : (
                                <span className="text-slate-600">-</span>
                              )}
                              {localeBadge}
                            </div>
                            {c.userMobile && (
                              <span className="text-xs opacity-70">{c.userMobile}</span>
                            )}
                            {emailSummary &&
                              (emailSummary.pending > 0 ||
                                emailSummary.failed24h > 0) && (
                                <button
                                  type="button"
                                  onClick={() => openCaseEmailDelivery(c)}
                                  data-testid={`badge-email-delivery-${c.id}`}
                                  title={
                                    `${emailSummary.pending} pending · ` +
                                    `${emailSummary.failed24h} failed in last 24h` +
                                    (emailSummary.lastFailureAt
                                      ? ` (last failure ${new Date(
                                          emailSummary.lastFailureAt,
                                        ).toLocaleString()})`
                                      : "") +
                                    " — click to open email delivery"
                                  }
                                  className={`inline-flex items-center gap-1 self-start rounded border px-1.5 py-0.5 text-[10px] font-semibold focus:outline-none focus:ring-1 ${
                                    emailSummary.failed24h > 0
                                      ? "border-red-600/70 bg-red-950/60 text-red-200 hover:bg-red-900/70 focus:ring-red-500"
                                      : "border-amber-600/70 bg-amber-950/60 text-amber-200 hover:bg-amber-900/70 focus:ring-amber-500"
                                  }`}
                                >
                                  {emailSummary.failed24h > 0 ? (
                                    <AlertTriangle className="h-3 w-3" />
                                  ) : (
                                    <Mail className="h-3 w-3" />
                                  )}
                                  {emailSummary.pending > 0 && (
                                    <span>{emailSummary.pending} pending</span>
                                  )}
                                  {emailSummary.pending > 0 &&
                                    emailSummary.failed24h > 0 && (
                                      <span className="opacity-60">·</span>
                                    )}
                                  {emailSummary.failed24h > 0 && (
                                    <span>
                                      {emailSummary.failed24h} failed 24h
                                    </span>
                                  )}
                                </button>
                              )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    {/* Stage badge cell — read-only at-a-glance indicator
                        of the current withdrawal stage so admins can see
                        each user's position without opening the case. */}
                    <TableCell>
                      {(() => {
                        const raw = c.withdrawalStage;
                        const num = raw && /^[0-9]+$/.test(raw) ? parseInt(raw, 10) : null;
                        const label = num ? STAGE_SHORT_LABELS[num] : null;
                        if (!num || !label) {
                          return (
                            <span className="text-slate-600 text-xs">—</span>
                          );
                        }
                        return (
                          <div className="flex flex-col gap-0.5" data-testid={`stage-badge-${c.id}`}>
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                              Stage {num}
                            </span>
                            <span className="text-xs text-slate-300 leading-snug max-w-[140px]">
                              {label}
                            </span>
                          </div>
                        );
                      })()}
                    </TableCell>
                    {/* Quick-edit cell — priority + assignee + stage in
                        compact inline controls. Each one PATCHes
                        /api/cases/:id immediately on change so admins
                        don't need to open the full Edit Account dialog
                        for these high-frequency tweaks. Disabled while
                        the row has an in-flight PATCH so rapid changes
                        don't race. */}
                    <TableCell className="text-xs">
                      <div className="flex flex-col gap-1.5">
                        <Select
                          value={c.priority ?? "medium"}
                          onValueChange={(v) =>
                            inlineEdit(c.id, { priority: v }, "Priority")
                          }
                          disabled={busyIds.has(c.id)}
                        >
                          <SelectTrigger
                            className="h-7 w-full bg-slate-900 border-slate-700 text-white text-xs px-2"
                            data-testid={`inline-priority-${c.id}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-700">
                            <SelectItem value="high" className="text-white text-xs">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                                High
                              </span>
                            </SelectItem>
                            <SelectItem value="medium" className="text-white text-xs">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                                Medium
                              </span>
                            </SelectItem>
                            <SelectItem value="low" className="text-white text-xs">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-500" />
                                Low
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <input
                          type="text"
                          defaultValue={c.assignedTo ?? ""}
                          placeholder="Assignee…"
                          disabled={busyIds.has(c.id)}
                          className="h-7 w-full bg-slate-900 border border-slate-700 rounded px-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if ((v || null) === (c.assignedTo ?? null)) return;
                            void inlineEdit(c.id, { assignedTo: v || null }, "Assignee");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          data-testid={`inline-assignee-${c.id}`}
                        />
                        <Select
                          value={
                            c.withdrawalStage && /^[0-9]+$/.test(c.withdrawalStage)
                              ? c.withdrawalStage
                              : "__none__"
                          }
                          onValueChange={(v) => {
                            if (v === "__none__") return;
                            void inlineEdit(
                              c.id,
                              { withdrawalStage: v },
                              "Stage",
                            );
                          }}
                          disabled={busyIds.has(c.id)}
                        >
                          <SelectTrigger
                            className="h-7 w-full bg-slate-900 border-slate-700 text-white text-xs px-2"
                            data-testid={`inline-stage-${c.id}`}
                          >
                            <SelectValue placeholder="Stage…" />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-700 max-h-80">
                            <SelectItem value="__none__" disabled className="text-slate-500 text-xs">
                              No stage
                            </SelectItem>
                            {STAGE_INSTRUCTIONS.map((s) => (
                              <SelectItem
                                key={s.stage}
                                value={String(s.stage)}
                                className="text-white text-xs"
                              >
                                {String(s.stage).padStart(2, "0")} — {s.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={c.landingPage || "dashboard"}
                          onValueChange={(v) =>
                            inlineEdit(c.id, { landingPage: v }, "Landing page")
                          }
                          disabled={busyIds.has(c.id)}
                        >
                          <SelectTrigger
                            className="h-7 w-full bg-slate-900 border-slate-700 text-white text-xs px-2"
                            data-testid={`inline-landing-${c.id}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-700">
                            {LANDING_PAGE_OPTIONS.map((opt) => {
                              const Icon = opt.icon;
                              return (
                                <SelectItem
                                  key={opt.value}
                                  value={opt.value}
                                  className="text-white text-xs"
                                >
                                  <span className="inline-flex items-center gap-1.5">
                                    <Icon className="w-3 h-3" />
                                    {opt.label}
                                  </span>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                    <TableCell data-testid={`cell-sealed-${c.id}`}>
                      {c.sealedAt ? (
                        <div className="flex flex-col items-start gap-1">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-amber-600/20 text-amber-300 border border-amber-600/40 inline-flex items-center gap-1">
                              <Lock className="h-3 w-3" />
                              Sealed
                            </Badge>
                            <div className="text-xs leading-tight">
                              <p className="text-slate-300">{formatSealDate(c.sealedAt)}</p>
                              {getSignerInitials(c.sealedBy) && (
                                <p className="text-slate-500" title={c.sealedBy || ''}>
                                  {getSignerInitials(c.sealedBy)}
                                </p>
                              )}
                            </div>
                          </div>
                          {integrityStatuses[c.id]?.status === "failed" && (
                            <button
                              type="button"
                              onClick={() => openAdminMessageDialog(c)}
                              title={`Last check ${new Date(
                                integrityStatuses[c.id].checkedAt,
                              ).toLocaleString()}${
                                integrityStatuses[c.id].checkedBy
                                  ? ` by ${integrityStatuses[c.id].checkedBy}`
                                  : ""
                              } — click to open Sealed banner`}
                              data-testid={`badge-integrity-failed-${c.id}`}
                              className="inline-flex items-center gap-1 rounded border border-red-600/70 bg-red-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-red-200 hover:bg-red-900/70 focus:outline-none focus:ring-1 focus:ring-red-500"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Integrity failed
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-500 text-xs">
                          <LockOpen className="h-3 w-3" />
                          Open
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {(() => {
                        const withdrawalCount = getCaseSubmissionCount(c.id);
                        // A "declaration submission" exists once the user has
                        // sent the form back — i.e. status moves past
                        // requested/not_requested. Treat any of submitted /
                        // approved / rejected as one declaration on file.
                        const declarationCount = ['submitted', 'approved', 'rejected'].includes(
                          (c.declarationStatus ?? '') as string
                        )
                          ? 1
                          : 0;
                        // A "document upload" is a document_request the user
                        // has actually submitted (submittedAt is set, or the
                        // status moved past 'requested').
                        const docCount = documentRequests.filter((d) => {
                          if (d.caseId !== c.id) return false;
                          if (d.submittedAt) return true;
                          const s = (d.status ?? '').toLowerCase();
                          return s === 'submitted' || s === 'approved' || s === 'rejected';
                        }).length;
                        const total = withdrawalCount + declarationCount + docCount;
                        const tooltip = `${withdrawalCount} withdrawal · ${declarationCount} declaration · ${docCount} docs`;
                        return (
                          <div className="flex flex-col items-center gap-1">
                            <Badge
                              variant="outline"
                              className={
                                total > 0
                                  ? 'text-blue-300 border-blue-700/60 bg-blue-900/20'
                                  : 'text-slate-400 border-slate-700'
                              }
                              title={tooltip}
                              data-testid={`badge-submissions-${c.id}`}
                            >
                              {total} submission{total === 1 ? '' : 's'}
                            </Badge>
                            <span
                              className="text-[10px] text-slate-500 leading-tight whitespace-nowrap"
                              title={tooltip}
                            >
                              {withdrawalCount}w · {declarationCount}d · {docCount}f
                            </span>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-center gap-2">
                        {c.status === 'syncing' && (
                          <Button
                            size="sm"
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                            onClick={() => openFinalizeModal(c)}
                            data-testid={`button-finalize-${c.id}`}
                          >
                            <UserCheck className="w-4 h-4 mr-1" /> Finalize
                          </Button>
                        )}
                        {(c.status === 'active' || c.status === 'syncing') && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-slate-700 bg-slate-800"
                              onClick={() => openLetterEditor(c)}
                              data-testid={`button-edit-letter-${c.id}`}
                            >
                              <Edit3 className="w-4 h-4 mr-1" /> Letter
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className={c.letterSent
                                ? "border-green-700 bg-green-900/50 text-green-400 hover:bg-green-800"
                                : "border-slate-600 bg-slate-800/50 text-slate-400 hover:bg-slate-700"
                              }
                              onClick={() => toggleLetterSent(c)}
                              data-testid={`button-send-letter-${c.id}`}
                            >
                              {c.letterSent ? (
                                <><MailCheck className="w-4 h-4 mr-1" /> Sent</>
                              ) : (
                                <><Mail className="w-4 h-4 mr-1" /> Send</>
                              )}
                            </Button>
                          </>
                        )}
                        {getCaseSubmissionCount(c.id) > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-slate-700 bg-slate-800"
                            onClick={() => openSubmissionsModal(c)}
                            data-testid={`button-view-submissions-${c.id}`}
                          >
                            <History className="w-4 h-4 mr-1" /> History
                          </Button>
                        )}
                        {c.status !== 'created' && (
                          <>
                            {/* Always-visible quick actions: chat (with unread badge)
                                and the most-used Edit Account. Everything else is
                                tucked into the Manage Case dropdown. */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-blue-700 bg-blue-900/50 text-blue-400 hover:bg-blue-800 relative"
                              onClick={() => openChat(c)}
                              data-testid={`button-chat-${c.id}`}
                            >
                              <MessageCircle className="w-4 h-4 mr-1" /> Chat
                              {unreadCounts[c.id] > 0 && (
                                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-xs text-white flex items-center justify-center font-bold animate-pulse">
                                  {unreadCounts[c.id]}
                                </span>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-fuchsia-700 bg-fuchsia-900/40 text-fuchsia-200 hover:bg-fuchsia-800"
                              onClick={() => openEditAccountDialog(c)}
                              data-testid={`button-edit-account-${c.id}`}
                              title="Edit any field on the user's account"
                            >
                              <Pencil className="w-4 h-4 mr-1" /> Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-700 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800"
                              onClick={() => setLedgerCase({ id: c.id, accessCode: c.accessCode })}
                              data-testid={`button-ledger-${c.id}`}
                              title="Manage this case's credit/debit ledger"
                            >
                              <BookOpen className="w-4 h-4 mr-1" /> Ledger
                            </Button>

                            {/* Highlight the declaration if it needs the admin's
                                attention right now (a fresh submission to review).
                                Everything else goes inside the dropdown. */}
                            {c.declarationStatus === 'submitted' && (
                              <Button
                                size="sm"
                                className="bg-amber-500 text-slate-900 hover:bg-amber-400 font-semibold"
                                onClick={() => openDeclarationDialog(c)}
                                data-testid={`button-review-declaration-${c.id}`}
                              >
                                <FileSignature className="w-4 h-4 mr-1" /> Review Declaration
                              </Button>
                            )}

                            {/* Manage Case dropdown — single entry point for the
                                rest of the actions, grouped by purpose. */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-slate-700 bg-slate-900/70 text-slate-200 hover:bg-slate-800"
                                  data-testid={`button-manage-case-${c.id}`}
                                >
                                  <MoreHorizontal className="w-4 h-4 mr-1" /> Manage
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="w-60 bg-slate-950 border-slate-800 text-slate-100"
                              >
                                {/* Communication */}
                                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500">
                                  Communication
                                </DropdownMenuLabel>
                                <DropdownMenuItem
                                  onClick={() => openAdminMessageDialog(c)}
                                  data-testid={`menu-manage-${c.id}`}
                                  className="cursor-pointer focus:bg-purple-900/40 focus:text-purple-200"
                                >
                                  <Bell className="w-4 h-4 mr-2 text-purple-400" /> Send Notification
                                </DropdownMenuItem>
                                {c.userEmail && (
                                  <DropdownMenuSub>
                                    <DropdownMenuSubTrigger
                                      className="cursor-pointer focus:bg-cyan-900/40 focus:text-cyan-200"
                                      data-testid={`menu-email-${c.id}`}
                                    >
                                      <Mail className="w-4 h-4 mr-2 text-cyan-400" />
                                      Quick Send
                                      <ChevronRight className="w-3 h-3 ml-auto opacity-60" />
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuPortal>
                                      <DropdownMenuSubContent className="bg-slate-950 border-slate-800 text-slate-100">
                                        {QUICK_SEND_TEMPLATES.map((tmpl) => {
                                          const stageNum = c.withdrawalStage
                                            ? parseInt(c.withdrawalStage, 10)
                                            : null;
                                          const stageName =
                                            stageNum && STAGE_SHORT_LABELS[stageNum]
                                              ? STAGE_SHORT_LABELS[stageNum]
                                              : "Your current stage";
                                          return (
                                            <DropdownMenuItem
                                              key={tmpl.id}
                                              data-testid={`menu-email-${c.id}-${tmpl.id}`}
                                              className="cursor-pointer focus:bg-cyan-900/40 focus:text-cyan-200"
                                              onClick={() =>
                                                openSendEmailDialog(
                                                  c,
                                                  tmpl.getSubject(stageName),
                                                  tmpl.getBody(c.userName ?? "", stageName, stageNum),
                                                )
                                              }
                                            >
                                              {tmpl.label}
                                            </DropdownMenuItem>
                                          );
                                        })}
                                      </DropdownMenuSubContent>
                                    </DropdownMenuPortal>
                                  </DropdownMenuSub>
                                )}
                                {c.userEmail && (
                                  <DropdownMenuItem
                                    onClick={() => openSendEmailDialog(c)}
                                    data-testid={`menu-compose-email-${c.id}`}
                                    className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                  >
                                    <Pencil className="w-4 h-4 mr-2 text-amber-400" /> Send Email…
                                  </DropdownMenuItem>
                                )}

                                <DropdownMenuSeparator className="bg-slate-800" />

                                {/* Account access */}
                                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500">
                                  Account Access
                                </DropdownMenuLabel>
                                {adminRole === 'super_admin' && (
                                <DropdownMenuItem
                                  onClick={() => openUserMirror(c)}
                                  data-testid={`menu-mirror-${c.id}`}
                                  className="cursor-pointer focus:bg-indigo-900/40 focus:text-indigo-200"
                                >
                                  <Eye className="w-4 h-4 mr-2 text-indigo-400" /> Open as User
                                </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  onClick={() => forceLogoutUser(c)}
                                  data-testid={`menu-force-logout-${c.id}`}
                                  className="cursor-pointer focus:bg-rose-900/40 focus:text-rose-200"
                                >
                                  <LogOut className="w-4 h-4 mr-2 text-rose-400" /> Log Out User
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => resetUserPin(c)}
                                  data-testid={`menu-reset-pin-${c.id}`}
                                  className="cursor-pointer focus:bg-rose-900/40 focus:text-rose-200"
                                >
                                  <Fingerprint className="w-4 h-4 mr-2 text-rose-400" /> Reset PIN
                                </DropdownMenuItem>
                                {c.isDisabled ? (
                                  <DropdownMenuItem
                                    onClick={() => toggleUserAccess(c, false)}
                                    data-testid={`menu-unlock-account-${c.id}`}
                                    className="cursor-pointer focus:bg-emerald-900/40 focus:text-emerald-200"
                                  >
                                    <Unlock className="w-4 h-4 mr-2 text-emerald-400" /> Unlock Account
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    onClick={() => toggleUserAccess(c, true)}
                                    data-testid={`menu-lock-account-${c.id}`}
                                    className="cursor-pointer focus:bg-rose-900/40 focus:text-rose-200"
                                  >
                                    <Lock className="w-4 h-4 mr-2 text-rose-400" /> Lock Account
                                  </DropdownMenuItem>
                                )}

                                <DropdownMenuSeparator className="bg-slate-800" />

                                {/* Payout Wallet — verified disbursement
                                    address shown to the user. Persisting
                                    triggers the server-side audit log +
                                    "wallet calibrated" email. */}
                                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500">
                                  Payout Wallet
                                </DropdownMenuLabel>
                                <DropdownMenuItem
                                  onClick={() => openPayoutWalletDialog(c)}
                                  data-testid={`menu-payout-wallet-${c.id}`}
                                  className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                >
                                  <Wallet className="w-4 h-4 mr-2 text-amber-400" />
                                  {(c.payoutWalletAddress ?? "").toString().trim()
                                    ? "Update Payout Wallet"
                                    : "Calibrate Payout Wallet"}
                                </DropdownMenuItem>

                                <DropdownMenuSeparator className="bg-slate-800" />

                                {/* Documents */}
                                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500">
                                  Documents
                                </DropdownMenuLabel>
                                {c.refundClaimStatus != null && (
                                  <DropdownMenuItem
                                    onClick={() => setRefundClaimReviewCaseId(c.id)}
                                    className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                    data-testid={`menu-refund-claim-${c.id}`}
                                  >
                                    <Award className="w-4 h-4 mr-2 text-amber-400" />
                                    Review Refund Claim
                                    {c.refundClaimStatus === "submitted" && (
                                      <span className="ml-auto text-[10px] bg-blue-500/20 text-blue-300 rounded px-1.5 py-0.5">
                                        Pending
                                      </span>
                                    )}
                                    {c.refundClaimStatus === "approved" && (
                                      <span className="ml-auto text-[10px] bg-green-500/20 text-green-300 rounded px-1.5 py-0.5">
                                        Approved
                                      </span>
                                    )}
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  onClick={() => {
                                    const a = document.createElement("a");
                                    a.href = `/api/cases/${c.id}/chronology/pdf`;
                                    a.download = `IBCCF-Chronology-${c.id}.pdf`;
                                    const headers: HeadersInit = authToken ? { Authorization: `Bearer ${authToken}` } : {};
                                    fetch(a.href, { headers })
                                      .then((r) => r.blob())
                                      .then((blob) => {
                                        a.href = URL.createObjectURL(blob);
                                        a.click();
                                        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
                                      })
                                      .catch(() => {});
                                  }}
                                  data-testid={`menu-chronology-pdf-${c.id}`}
                                  className="cursor-pointer focus:bg-emerald-900/40 focus:text-emerald-200"
                                >
                                  <FileDown className="w-4 h-4 mr-2 text-emerald-400" /> Download Chronology PDF
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => openReceiptsDialog(c)}
                                  data-testid={`menu-receipts-${c.id}`}
                                  className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                >
                                  <Image className="w-4 h-4 mr-2 text-amber-400" /> View Receipts
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => openReissueLetterDialog(c)}
                                  data-testid={`menu-reissue-letter-${c.id}`}
                                  className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                >
                                  <RefreshCw className="w-4 h-4 mr-2 text-amber-400" /> Reissue Letter
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => openWithdrawalRequestsDialog(c)}
                                  data-testid={`menu-withdrawal-requests-${c.id}`}
                                  className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                >
                                  <Image className="w-4 h-4 mr-2 text-amber-400" /> Withdrawal Requests
                                </DropdownMenuItem>

                                <DropdownMenuSeparator className="bg-slate-800" />

                                {/* NDA — admin-only review of what the user
                                    will sign / has already signed. */}
                                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500">
                                  NDA / Sealed Settlement
                                </DropdownMenuLabel>
                                {c.sealedAt && (
                                  <DropdownMenuItem
                                    onClick={() => openSignedNdaDialog(c)}
                                    data-testid={`menu-view-signed-nda-${c.id}`}
                                    className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                  >
                                    <FileSignature className="w-4 h-4 mr-2 text-amber-400" /> View signed NDA
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  onClick={() => openPreviewNdaDialog(c)}
                                  data-testid={`menu-preview-nda-${c.id}`}
                                  className="cursor-pointer focus:bg-blue-900/40 focus:text-blue-200"
                                >
                                  <FileText className="w-4 h-4 mr-2 text-blue-300" /> Preview unsigned NDA
                                </DropdownMenuItem>

                                {/* Workflow controls — fast one-click stage
                                    override (1–14) and a per-case feature-flag
                                    toggle group, both PATCH /api/cases/:id
                                    directly so admins skip opening Edit. */}
                                <DropdownMenuSeparator className="bg-slate-800" />
                                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500">
                                  Workflow
                                </DropdownMenuLabel>
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger
                                    className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                    data-testid={`menu-jump-stage-${c.id}`}
                                  >
                                    <Layers className="w-4 h-4 mr-2 text-amber-400" />
                                    Jump to stage…
                                    <ChevronRight className="w-3 h-3 ml-auto opacity-60" />
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuPortal>
                                    <DropdownMenuSubContent className="bg-slate-950 border-slate-800 text-slate-100 max-h-80 overflow-y-auto">
                                      {STAGE_INSTRUCTIONS.map((s) => {
                                        const isCurrent = c.withdrawalStage === String(s.stage);
                                        return (
                                          <DropdownMenuItem
                                            key={s.stage}
                                            onClick={() =>
                                              inlineEdit(
                                                c.id,
                                                { withdrawalStage: String(s.stage) },
                                                `Stage → ${s.stage}`,
                                              )
                                            }
                                            disabled={isCurrent || busyIds.has(c.id)}
                                            className="cursor-pointer focus:bg-slate-800 text-xs"
                                            data-testid={`menu-jump-stage-${c.id}-${s.stage}`}
                                          >
                                            <span className="font-mono text-[10px] text-slate-500 mr-2 w-5">
                                              {String(s.stage).padStart(2, "0")}
                                            </span>
                                            <span className="flex-1">{s.title}</span>
                                            {isCurrent && (
                                              <CheckCheck className="w-3 h-3 ml-2 text-emerald-400" />
                                            )}
                                          </DropdownMenuItem>
                                        );
                                      })}
                                    </DropdownMenuSubContent>
                                  </DropdownMenuPortal>
                                </DropdownMenuSub>
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger
                                    className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                    data-testid={`menu-flags-${c.id}`}
                                  >
                                    <ToggleLeft className="w-4 h-4 mr-2 text-amber-400" />
                                    Feature flags
                                    <ChevronRight className="w-3 h-3 ml-auto opacity-60" />
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuPortal>
                                    <DropdownMenuSubContent className="bg-slate-950 border-slate-800 text-slate-100 w-56">
                                      <DropdownMenuCheckboxItem
                                        checked={c.isRegulated === true}
                                        disabled={busyIds.has(c.id)}
                                        onCheckedChange={() => toggleFlag(c, "isRegulated")}
                                        className="cursor-pointer focus:bg-slate-800"
                                        data-testid={`flag-isRegulated-${c.id}`}
                                      >
                                        Regulated
                                      </DropdownMenuCheckboxItem>
                                      <DropdownMenuCheckboxItem
                                        checked={c.ndaEnabled === true}
                                        disabled={busyIds.has(c.id)}
                                        onCheckedChange={() => toggleFlag(c, "ndaEnabled")}
                                        className="cursor-pointer focus:bg-slate-800"
                                        data-testid={`flag-ndaEnabled-${c.id}`}
                                      >
                                        NDA enabled
                                      </DropdownMenuCheckboxItem>
                                      <DropdownMenuCheckboxItem
                                        checked={c.certificateEnabled === true}
                                        disabled={busyIds.has(c.id)}
                                        onCheckedChange={() => toggleFlag(c, "certificateEnabled")}
                                        className="cursor-pointer focus:bg-slate-800"
                                        data-testid={`flag-certificateEnabled-${c.id}`}
                                      >
                                        Certificate enabled
                                      </DropdownMenuCheckboxItem>
                                      <DropdownMenuCheckboxItem
                                        checked={c.stampDutyEnabled === true}
                                        disabled={busyIds.has(c.id)}
                                        onCheckedChange={() => toggleFlag(c, "stampDutyEnabled")}
                                        className="cursor-pointer focus:bg-slate-800"
                                        data-testid={`flag-stampDutyEnabled-${c.id}`}
                                      >
                                        Stamp duty enabled
                                      </DropdownMenuCheckboxItem>
                                      <DropdownMenuCheckboxItem
                                        checked={c.withdrawalWindowEnabled === true}
                                        disabled={busyIds.has(c.id)}
                                        onCheckedChange={() =>
                                          toggleFlag(c, "withdrawalWindowEnabled")
                                        }
                                        className="cursor-pointer focus:bg-slate-800"
                                        data-testid={`flag-withdrawalWindowEnabled-${c.id}`}
                                      >
                                        Withdrawal window enabled
                                      </DropdownMenuCheckboxItem>
                                      <DropdownMenuSeparator className="bg-slate-800" />
                                      <DropdownMenuCheckboxItem
                                        checked={c.refundClaimStatus != null}
                                        disabled={busyIds.has(c.id) || c.refundClaimStatus != null}
                                        onCheckedChange={(checked) => {
                                          if (checked && c.refundClaimStatus == null) {
                                            setRefundClaimRequestCase(c);
                                          }
                                        }}
                                        className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                        data-testid={`flag-refundClaim-${c.id}`}
                                      >
                                        <Award className="w-3.5 h-3.5 mr-1.5 text-amber-400 inline" />
                                        Refund Claim
                                        {c.refundClaimStatus && (
                                          <span className="ml-1.5 text-[10px] text-amber-400/70 font-normal">
                                            ({c.refundClaimStatus})
                                          </span>
                                        )}
                                      </DropdownMenuCheckboxItem>
                                    </DropdownMenuSubContent>
                                  </DropdownMenuPortal>
                                </DropdownMenuSub>
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger
                                    className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                    data-testid={`menu-landing-${c.id}`}
                                  >
                                    <MapPin className="w-4 h-4 mr-2 text-amber-400" />
                                    Landing page…
                                    <ChevronRight className="w-3 h-3 ml-auto opacity-60" />
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuPortal>
                                    <DropdownMenuSubContent className="bg-slate-950 border-slate-800 text-slate-100 w-56">
                                      {LANDING_PAGE_OPTIONS.map((opt) => {
                                        const Icon = opt.icon;
                                        const isCurrent =
                                          (c.landingPage || "dashboard") === opt.value;
                                        return (
                                          <DropdownMenuItem
                                            key={opt.value}
                                            onClick={() =>
                                              inlineEdit(
                                                c.id,
                                                { landingPage: opt.value },
                                                "Landing page",
                                              )
                                            }
                                            disabled={isCurrent || busyIds.has(c.id)}
                                            className="cursor-pointer focus:bg-slate-800 text-xs"
                                            data-testid={`menu-landing-${c.id}-${opt.value}`}
                                          >
                                            <Icon className="w-3.5 h-3.5 mr-2 text-amber-300" />
                                            <span className="flex-1">{opt.label}</span>
                                            {isCurrent && (
                                              <CheckCheck className="w-3 h-3 ml-2 text-emerald-400" />
                                            )}
                                          </DropdownMenuItem>
                                        );
                                      })}
                                    </DropdownMenuSubContent>
                                  </DropdownMenuPortal>
                                </DropdownMenuSub>

                                <DropdownMenuItem
                                  onClick={() => openAdminMessageDialog(c, "workflow")}
                                  data-testid={`menu-session-refresh-${c.id}`}
                                  className="cursor-pointer focus:bg-teal-900/40 focus:text-teal-200"
                                >
                                  <RefreshCw className="w-4 h-4 mr-2 text-teal-400" /> Session Refresh
                                </DropdownMenuItem>

                                {/* Declaration — varies by status */}
                                {(() => {
                                  const ds = c.declarationStatus ?? 'not_requested';
                                  return (
                                    <>
                                      <DropdownMenuSeparator className="bg-slate-800" />
                                      <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500">
                                        Declaration
                                      </DropdownMenuLabel>
                                      {ds === 'not_requested' && (
                                        <DropdownMenuItem
                                          onClick={() => requestDeclaration(c)}
                                          data-testid={`menu-request-declaration-${c.id}`}
                                          className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-300"
                                        >
                                          <Scale className="w-4 h-4 mr-2 text-amber-400" /> Request Declaration
                                        </DropdownMenuItem>
                                      )}
                                      {ds === 'pending' && (
                                        <>
                                          <DropdownMenuItem
                                            onClick={() => openDeclarationDialog(c)}
                                            data-testid={`menu-view-declaration-${c.id}`}
                                            className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                          >
                                            <Scale className="w-4 h-4 mr-2 text-amber-400" /> View — Awaiting User
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => regenerateDeclarationAccessCode(c)}
                                            data-testid={`menu-regenerate-access-code-${c.id}`}
                                            className="cursor-pointer focus:bg-blue-900/40 focus:text-blue-200"
                                          >
                                            <RotateCcw className="w-4 h-4 mr-2 text-blue-400" /> Issue New Access Code
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => clearDeclarationRequest(c)}
                                            data-testid={`menu-clear-declaration-${c.id}`}
                                            className="cursor-pointer focus:bg-slate-800 focus:text-slate-200"
                                          >
                                            <X className="w-4 h-4 mr-2 text-slate-400" /> Cancel Request
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                      {ds === 'submitted' && (
                                        <>
                                          <DropdownMenuItem
                                            onClick={() => openDeclarationDialog(c)}
                                            data-testid={`menu-review-declaration-${c.id}`}
                                            className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                          >
                                            <FileSignature className="w-4 h-4 mr-2 text-amber-400" /> Review Submission
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => requestDeclaration(c)}
                                            data-testid={`menu-reask-declaration-${c.id}`}
                                            className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                          >
                                            <RefreshCw className="w-4 h-4 mr-2 text-amber-400" /> Re-ask Declaration
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => regenerateDeclarationAccessCode(c)}
                                            data-testid={`menu-regenerate-access-code-${c.id}`}
                                            className="cursor-pointer focus:bg-blue-900/40 focus:text-blue-200"
                                          >
                                            <RotateCcw className="w-4 h-4 mr-2 text-blue-400" /> Issue New Access Code
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                      {ds === 'approved' && (
                                        <>
                                          <DropdownMenuItem
                                            onClick={() => openDeclarationDialog(c)}
                                            data-testid={`menu-view-declaration-${c.id}`}
                                            className="cursor-pointer focus:bg-emerald-900/40 focus:text-emerald-300"
                                          >
                                            <ShieldCheck className="w-4 h-4 mr-2 text-emerald-400" /> View — Approved
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => requestDeclaration(c)}
                                            data-testid={`menu-reask-declaration-${c.id}`}
                                            className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                          >
                                            <RefreshCw className="w-4 h-4 mr-2 text-amber-400" /> Re-ask Declaration
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => regenerateDeclarationAccessCode(c)}
                                            data-testid={`menu-regenerate-access-code-${c.id}`}
                                            className="cursor-pointer focus:bg-blue-900/40 focus:text-blue-200"
                                          >
                                            <RotateCcw className="w-4 h-4 mr-2 text-blue-400" /> Issue New Access Code
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                      {ds === 'rejected' && (
                                        <>
                                          <DropdownMenuItem
                                            onClick={() => openDeclarationDialog(c)}
                                            data-testid={`menu-view-declaration-${c.id}`}
                                            className="cursor-pointer focus:bg-red-900/40 focus:text-red-300"
                                          >
                                            <AlertTriangle className="w-4 h-4 mr-2 text-red-400" /> View — Rejected
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => requestDeclaration(c)}
                                            data-testid={`menu-reask-declaration-${c.id}`}
                                            className="cursor-pointer focus:bg-amber-900/40 focus:text-amber-200"
                                          >
                                            <RefreshCw className="w-4 h-4 mr-2 text-amber-400" /> Re-ask Declaration
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => regenerateDeclarationAccessCode(c)}
                                            data-testid={`menu-regenerate-access-code-${c.id}`}
                                            className="cursor-pointer focus:bg-blue-900/40 focus:text-blue-200"
                                          >
                                            <RotateCcw className="w-4 h-4 mr-2 text-blue-400" /> Issue New Access Code
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                    </>
                                  );
                                })()}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {/* Pagination controls — only the current page's rows are mounted
            above (Task #2406), so this is the only way to reach the rest
            of the matching cases. Hidden when everything fits on one page. */}
        {casesPageCount > 1 && (
          <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-sm text-slate-400">
            <span data-testid="text-cases-page-info">
              Page {casesPage} of {casesPageCount}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-slate-700 bg-slate-800 text-slate-300 hover:text-white disabled:opacity-40"
                onClick={() => setCasesPage((p) => Math.max(1, p - 1))}
                disabled={casesPage <= 1}
                data-testid="button-cases-prev-page"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-700 bg-slate-800 text-slate-300 hover:text-white disabled:opacity-40"
                onClick={() => setCasesPage((p) => Math.min(casesPageCount, p + 1))}
                disabled={casesPage >= casesPageCount}
                data-testid="button-cases-next-page"
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
        </div>
      </div>

      {ledgerCase && (
        <AdminCaseLedgerDialog
          open={true}
          onOpenChange={(open) => { if (!open) setLedgerCase(null); }}
          caseId={ledgerCase.id}
          caseLabel={ledgerCase.accessCode}
          authToken={authToken}
        />
      )}

      {/* Confirm gate for large access-code batches (Task #2355). Access
          codes are live login credentials — a misclick with a broad filter
          must not silently email a large batch of users with no undo. */}
      <AlertDialog
        open={confirmAccessCodeSend}
        onOpenChange={(open) => { if (!open) setConfirmAccessCodeSend(false); }}
      >
        <AlertDialogContent className="bg-slate-900 border-slate-700" data-testid="dialog-confirm-access-code-send">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Send access codes to {emailEligibleCount} cases?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 space-y-2">
              <span className="block">
                This will email each target case's current access code — a live login credential — to their registered address. This action cannot be undone.
              </span>
              <span className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] ${
                emailEligibleCount < targetCount
                  ? "bg-amber-500/10 border border-amber-500/30 text-amber-200"
                  : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-200"
              }`}>
                <Mail className="w-3 h-3 flex-shrink-0" />
                <span><span className="font-semibold tabular-nums">{emailEligibleCount}</span> of <span className="tabular-nums">{targetCount}</span> have email on file</span>
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
              data-testid="button-confirm-access-code-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmAccessCodeSend(false);
                void bulkSendAccessCodes(targetIds);
              }}
              className="bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold"
              data-testid="button-confirm-access-code-send"
            >
              Send to {emailEligibleCount}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm gate for large access-code rotation batches (Task #2440) —
          same rationale as the send-confirm dialog above, but rotation is
          more disruptive still: it invalidates the old code and force-drops
          any active session for every target case. */}
      <AlertDialog
        open={confirmAccessCodeRotate}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAccessCodeRotate(false);
            setBulkRotateActiveSessionCheck({ checking: false, count: null });
          }
        }}
      >
        <AlertDialogContent className="bg-slate-900 border-slate-700" data-testid="dialog-confirm-access-code-rotate">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Rotate access codes for {targetCount} cases?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 space-y-2">
              <span className="block">
                This will issue a brand-new access code for each target case — the old code stops working immediately and any active portal session is signed out. A notification email with the new code is sent where an address is on file. This action cannot be undone.
              </span>
              <span className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] ${
                emailEligibleCount < targetCount
                  ? "bg-amber-500/10 border border-amber-500/30 text-amber-200"
                  : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-200"
              }`}>
                <Mail className="w-3 h-3 flex-shrink-0" />
                <span><span className="font-semibold tabular-nums">{emailEligibleCount}</span> of <span className="tabular-nums">{targetCount}</span> have email on file</span>
              </span>
              <span
                className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] ${
                  bulkRotateActiveSessionCheck.checking
                    ? "bg-slate-700/40 border border-slate-600/40 text-slate-300"
                    : bulkRotateActiveSessionCheck.count
                      ? "bg-red-500/10 border border-red-500/30 text-red-200"
                      : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-200"
                }`}
                data-testid="bulk-rotate-active-session-warning"
              >
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                {bulkRotateActiveSessionCheck.checking ? (
                  <span>Checking for active portal sessions…</span>
                ) : bulkRotateActiveSessionCheck.count === null ? (
                  <span>Could not check active sessions — proceed with caution.</span>
                ) : (
                  <span>
                    <span className="font-semibold tabular-nums">{bulkRotateActiveSessionCheck.count}</span> of{" "}
                    <span className="tabular-nums">{targetCount}</span> {bulkRotateActiveSessionCheck.count === 1 ? "user is" : "users are"} currently logged into the portal and will be signed out immediately
                  </span>
                )}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
              data-testid="button-confirm-access-code-rotate-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmAccessCodeRotate(false);
                void bulkRotateAccessCodes(targetIds);
              }}
              className="bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold"
              data-testid="button-confirm-access-code-rotate"
            >
              Rotate {targetCount}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm gate for large bulk-email batches (Task #2362). Mirrors
          the access-code confirmation above — a misclick with a broad
          filter must not silently email a large batch of users. */}
      <AlertDialog
        open={confirmBulkEmailSend}
        onOpenChange={(open) => { if (!open) setConfirmBulkEmailSend(false); }}
      >
        <AlertDialogContent className="bg-slate-900 border-slate-700" data-testid="dialog-confirm-bulk-email-send">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Send email to {emailEligibleCount} cases?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 space-y-2">
              <span className="block">
                This will send the message above to every target case's registered address. This action cannot be undone.
              </span>
              <span className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] ${
                emailEligibleCount < targetCount
                  ? "bg-amber-500/10 border border-amber-500/30 text-amber-200"
                  : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-200"
              }`}>
                <Mail className="w-3 h-3 flex-shrink-0" />
                <span><span className="font-semibold tabular-nums">{emailEligibleCount}</span> of <span className="tabular-nums">{targetCount}</span> have email on file</span>
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
              data-testid="button-confirm-bulk-email-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmBulkEmailSend(false);
                void bulkSendEmail(targetIds, sidebarEmailSubject, sidebarEmailBody);
              }}
              className="bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold"
              data-testid="button-confirm-bulk-email-send"
            >
              Send to {emailEligibleCount}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm gate for large bulk-block-IPs batches (Task #2362). Same
          misclick-blast-radius rationale — blocking an IP affects every
          visitor on that address, not just the target case. */}
      <AlertDialog
        open={confirmBulkBlockIps}
        onOpenChange={(open) => { if (!open) setConfirmBulkBlockIps(false); }}
      >
        <AlertDialogContent className="bg-slate-900 border-slate-700" data-testid="dialog-confirm-bulk-block-ips">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Block {blockableIpCount} IP{blockableIpCount === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 space-y-2">
              <span className="block">
                This will block the most recent login IP for each target case. This affects every visitor on that IP, not just the target case, and cannot be undone from here.
              </span>
              <span className="flex items-center justify-between rounded-md border border-slate-700/60 bg-slate-900/50 px-2.5 py-1.5 text-[11px] text-slate-300">
                <span>Unique IPs</span>
                <span className="tabular-nums font-semibold text-white">{blockableIpCount} / {targetCount}</span>
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
              data-testid="button-confirm-bulk-block-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmBulkBlockIps(false);
                void bulkBlockIps(targetIds, sidebarBlockReason);
              }}
              className="bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold"
              data-testid="button-confirm-bulk-block-send"
            >
              Block {blockableIpCount} IP{blockableIpCount === 1 ? "" : "s"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Payout Wallet dialog — admin enters the verified disbursement
          address for one case. On save the server stamps
          payoutWalletVerifiedAt/By, writes an audit log, and emails the
          user ("wallet calibrated and bound to IBCCF secure wallet"). */}
      <Dialog
        open={!!walletDialogCase}
        onOpenChange={(open) => { if (!open) setWalletDialogCase(null); }}
      >
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="flex items-center justify-center h-7 w-7 rounded-md bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40">
                <Wallet className="w-4 h-4" />
              </span>
              <span className="bg-gradient-to-r from-amber-100 to-amber-300 bg-clip-text text-transparent">
                {(walletDialogCase?.payoutWalletAddress ?? "").toString().trim()
                  ? "Update Payout Wallet"
                  : "Calibrate Payout Wallet"}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Set the verified disbursement address for case{" "}
              <span className="font-semibold text-slate-200">
                {walletDialogCase?.accessCode}
              </span>
              . On save the user{walletDialogCase?.userEmail ? "" : " (no email on file)"} is notified
              that their wallet has been calibrated and bound with their IBCCF secure wallet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">
                Wallet address <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder="e.g. TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
                className="w-full h-9 text-xs font-mono bg-slate-900/80 border border-slate-700/80 text-white rounded-md px-2.5 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                data-testid="wallet-dialog-address"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Asset</label>
                <input
                  type="text"
                  value={walletAsset}
                  onChange={(e) => setWalletAsset(e.target.value)}
                  placeholder="USDT"
                  className="w-full h-9 text-xs bg-slate-900/80 border border-slate-700/80 text-white rounded-md px-2.5 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                  data-testid="wallet-dialog-asset"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">Network</label>
                <input
                  type="text"
                  value={walletNetwork}
                  onChange={(e) => setWalletNetwork(e.target.value)}
                  placeholder="TRC20"
                  className="w-full h-9 text-xs bg-slate-900/80 border border-slate-700/80 text-white rounded-md px-2.5 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                  data-testid="wallet-dialog-network"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-[0.22em] font-semibold text-slate-500/80">
                Internal officer note <span className="text-slate-600">(not shown to user)</span>
              </label>
              <textarea
                value={walletNote}
                onChange={(e) => setWalletNote(e.target.value)}
                placeholder="Optional context for fellow officers…"
                rows={2}
                className="w-full text-xs bg-slate-900/80 border border-slate-700/80 text-white rounded-md px-2.5 py-2 resize-y placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                data-testid="wallet-dialog-note"
              />
            </div>

            {walletDialogCase && !walletDialogCase.userEmail && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-100/90">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-300" />
                <span>No email is on file for this case — the wallet will be saved, but the notification cannot be delivered.</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
              onClick={() => setWalletDialogCase(null)}
              disabled={walletSaving}
              data-testid="wallet-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              className="bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold shadow-[0_4px_14px_-4px_rgba(200,169,81,0.5)]"
              onClick={() => void savePayoutWallet()}
              disabled={walletSaving || !walletAddress.trim()}
              data-testid="wallet-dialog-save"
            >
              <Wallet className="w-4 h-4 mr-2" />
              {walletSaving
                ? "Saving…"
                : (walletDialogCase?.payoutWalletAddress ?? "").toString().trim()
                  ? "Update & notify user"
                  : "Calibrate & notify user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RefundClaimRequestDialog
        open={refundClaimRequestCase !== null}
        caseRow={refundClaimRequestCase}
        onClose={() => setRefundClaimRequestCase(null)}
        onSent={() => { setRefundClaimRequestCase(null); loadData(); }}
        authToken={authToken}
      />

      <RefundClaimReviewDialog
        open={refundClaimReviewCaseId !== null}
        caseId={refundClaimReviewCaseId ?? ""}
        caseName={cases.find((c) => c.id === refundClaimReviewCaseId)?.userName ?? refundClaimReviewCaseId ?? ""}
        onClose={() => setRefundClaimReviewCaseId(null)}
        onActioned={() => { setRefundClaimReviewCaseId(null); loadData(); }}
        authToken={authToken}
      />
    </>
  );
}
