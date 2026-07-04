import { createContext, useContext, RefObject } from "react";
import type { useToast } from "@/hooks/use-toast";
import type {
  Case,
  Submission,
  ChatMessage,
  ChatTemplate,
  AuditLog,
  AdminSession,
  FailedLoginAttempt,
  FailedLoginByIp,
  DeclarationReadAttempt,
  DeclarationReadByIp,
  ScheduledMessage,
  MessageTemplate,
  HelpArticle,
  UserFeedback,
  DocumentRequest,
  SettingsView,
} from "./shared";
import type { RefundClaimStatusFilter } from "@shared/types";

type ToastFn = ReturnType<typeof useToast>["toast"];

export type AdminSessionWithCurrent = Omit<AdminSession, "token"> & {
  isCurrent?: boolean;
};

export interface EmergencyResetActivityEvent {
  id: number;
  action: "admin_emergency_reset_requested" | "admin_emergency_reset_used";
  createdAt: string;
  ipAddress: string | null;
}

export interface EmergencyResetActivity {
  events: EmergencyResetActivityEvent[];
  lastUsedAt: string | null;
}

export interface AdminDashboardContextValue {
  // Admin auth — bearer token for any tab that needs to call admin-only APIs
  // directly. Always passed through this context (rather than the legacy
  // AdminContext which is never mounted) so children never throw outside an
  // AdminProvider.
  authToken: string | null;

  // Role of the currently-authenticated admin. Mirrors the value returned by
  // GET /api/admin/verify and follows the hierarchy viewer < agent < admin <
  // super_admin. Tabs use this to hide or disable actions the role cannot
  // perform rather than letting the server return a 403 after the fact.
  adminRole: string;

  // Cases / submissions
  cases: Case[];
  filteredCases: Case[];
  allSubmissions: Submission[];
  isDataLoading: boolean;
  loadData: (showToast?: boolean) => void | Promise<void>;
  clearLogs: () => void | Promise<void>;
  setIsCreateOpen: (open: boolean) => void;

  // Search/filter for cases tab
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  statusFilter: string;
  setStatusFilter: (s: string) => void;
  localeFilter: string;
  setLocaleFilter: (s: string) => void;
  sealedFilter: "all" | "sealed" | "open";
  setSealedFilter: (s: "all" | "sealed" | "open") => void;
  // Quick-triage filter for cases with a stamp-duty receipt awaiting admin
  // review. Lifted to the dashboard so the Cases nav badge (Task #127) can
  // both surface the pending count and pre-activate the filter when clicked
  // from another tab.
  stampDutyPendingOnly: boolean;
  setStampDutyPendingOnly: (v: boolean) => void;
  // Task #780 — cross-case pending withdrawal-request tracking. The counts
  // map is keyed by caseId (only cases with ≥1 pending request appear). The
  // `withdrawalPendingOnly` filter is lifted here so the Cases nav/filter pill
  // can surface the count and pre-activate the filter. `loadWithdrawalPendingCounts`
  // is the imperative refresh fired after a request is approved/rejected/cancelled.
  withdrawalPendingCounts: Record<string, number>;
  withdrawalPendingOnly: boolean;
  setWithdrawalPendingOnly: (v: boolean) => void;
  loadWithdrawalPendingCounts: () => void | Promise<void>;
  // Per-case count of deposit receipts awaiting reactivation review
  // (category='reissue', no reissueId, status='pending'). Drives the
  // "Pending reactivation" badge on disabled case rows and the triage
  // filter pill. Cleared the moment an admin approves/rejects the receipt.
  reactivationPendingCounts: Record<string, number>;
  reactivationPendingOnly: boolean;
  setReactivationPendingOnly: (v: boolean) => void;
  loadReactivationPendingCounts: () => void | Promise<void>;
  // Refund-claim status filter — lifted to context so the Analytics KPI
  // card can pre-activate the filter when admins click through to the
  // Cases tab (same pattern as sealedFilter / withdrawalPendingOnly).
  refundClaimStatusFilter: RefundClaimStatusFilter;
  setRefundClaimStatusFilter: (v: RefundClaimStatusFilter) => void;

  // Top-level tab state, exposed so KPI tiles on Analytics can drill
  // through to the Cases tab with the sealed filter pre-set.
  activeTab: string;
  setActiveTab: (t: string) => void;

  // Receipts inbox category pre-filter — set by the "Pending Reactivations"
  // KPI tile so clicking it jumps to the Receipts tab AND pre-selects the
  // "reactivation" category filter in one action.
  setReceiptsInboxFilter: (category: string) => void;

  // Case actions
  getCaseSubmissionCount: (caseId: string) => number;
  toggleLetterSent: (caseData: Case) => void | Promise<void>;
  openFinalizeModal: (c: Case) => void | Promise<void>;
  openLetterEditor: (c: Case) => void | Promise<void>;
  openSubmissionsModal: (c: Case) => void | Promise<void>;
  openChat: (caseData: Case) => void;
  openAdminMessageDialog: (caseData: Case, initialTab?: string) => void;
  // Opens the case-detail dialog AND scrolls to the per-case email-delivery
  // panel (Task #146). Used by the row-level "N pending / N failed" badge
  // on the Cases list so admins jump straight to the delivery breakdown
  // instead of opening the dialog and scrolling manually.
  openCaseEmailDelivery: (caseData: Case) => void;
  openReceiptsDialog: (caseData: Case) => void;
  openSendEmailDialog: (caseData: Case, subject?: string, body?: string) => void;
  openWithdrawalRequestsDialog: (caseData: Case) => void;

  // Declaration of Compliance — admin actions
  requestDeclaration: (c: Case) => void | Promise<void>;
  regenerateDeclarationAccessCode: (c: Case) => void | Promise<void>;
  clearDeclarationRequest: (c: Case) => void | Promise<void>;
  openDeclarationDialog: (c: Case) => void | Promise<void>;

  // Letter reissue — re-open option selector for a user who already submitted
  openReissueLetterDialog: (c: Case) => void | Promise<void>;
  clearLetterReissue: (c: Case) => void | Promise<void>;

  // Account autonomy — full edit + impersonation/mirror
  openEditAccountDialog: (c: Case) => void;
  openUserMirror: (c: Case) => void | Promise<void>;

  // NDA admin previews — view the bytes the user signed (sealed cases) or
  // dry-run the unsigned NDA the user is about to see (any case).
  openSignedNdaDialog: (c: Case) => void;
  openPreviewNdaDialog: (c: Case) => void;

  // Force-logout the user's portal session for this case
  forceLogoutUser: (c: Case) => void | Promise<void>;

  // Sticky-bottom auto-scroll handler bound to chatScrollRef. Attach
  // to the chat container's onScroll prop so the hook can track whether
  // the user is currently at the bottom and skip auto-scroll when they
  // have scrolled up to read history.
  handleChatScroll: React.UIEventHandler<HTMLDivElement>;

  // Lock / unlock portal access for a user (also kicks any active session)
  toggleUserAccess: (c: Case, disabled: boolean) => void | Promise<void>;

  // Reset a user's PIN (also kicks any active session)
  resetUserPin: (c: Case) => void | Promise<void>;

  // Submissions tab
  handleDeleteSubmission: (submissionId: number) => void | Promise<void>;

  // Conversations tab
  chatCase: Case | null;
  setChatCase: (c: Case | null) => void;
  chatMessages: ChatMessage[];
  loadChatMessages: (caseId: string) => void | Promise<void>;
  sendChatMessage: () => void | Promise<void>;
  newMessage: string;
  setNewMessage: (m: string) => void;
  isSendingMessage: boolean;
  unreadCounts: Record<string, number>;
  chatScrollRef: RefObject<HTMLDivElement | null>;

  // Settings tab — common
  settingsView: SettingsView;
  setSettingsView: (v: SettingsView) => void;
  theme: string;
  toggleTheme: () => void;

  // Settings - Audit
  auditLogs: AuditLog[];
  loadAuditLogs: () => void | Promise<void>;
  // Recent emergency admin-credential-reset ("Locked out?") activity —
  // surfaced separately from the general audit trail since a completed
  // reset rewrites the admin's own credentials.
  emergencyResetActivity: EmergencyResetActivity;
  loadEmergencyResetActivity: () => void | Promise<void>;

  // Settings - Admin sessions
  adminSessions: AdminSessionWithCurrent[];
  loadAdminSessions: () => void | Promise<void>;
  revokeAdminSession: (id: string) => void | Promise<void>;
  revokeOtherAdminSessions: () => void | Promise<void>;

  // Settings - Failed login attempts (credential failures + rate-limit hits)
  failedLogins: FailedLoginAttempt[];
  failedLoginCount24h: number;
  loadFailedLogins: () => void | Promise<void>;
  failedLoginsByIp: FailedLoginByIp[];
  failedLoginsByIpWindowHours: number;
  loadFailedLoginsByIp: () => void | Promise<void>;

  // Settings - Suspicious declaration-read attempts (Task #109 audit feed)
  declarationReadAttempts: DeclarationReadAttempt[];
  declarationReadCount24h: number;
  loadDeclarationReadAttempts: () => void | Promise<void>;
  declarationReadByIp: DeclarationReadByIp[];
  declarationReadByIpWindowHours: number;
  loadDeclarationReadByIp: () => void | Promise<void>;

  // Settings - Scheduled messages
  scheduledMessages: ScheduledMessage[];
  loadScheduledMessages: () => void | Promise<void>;
  createScheduledMessage: () => void | Promise<void>;
  cancelScheduledMessage: (id: number) => void | Promise<void>;
  newScheduledMessage: {
    caseId: string;
    messageType: 'chat' | 'admin_message' | 'letter';
    category: string;
    title: string;
    content: string;
    scheduledFor: string;
  };
  setNewScheduledMessage: (
    v: AdminDashboardContextValue["newScheduledMessage"]
  ) => void;

  // Settings - Message templates
  messageTemplates: MessageTemplate[];
  loadMessageTemplates: () => void | Promise<void>;
  createMessageTemplate: () => void | Promise<void>;
  deleteMessageTemplate: (id: number) => void | Promise<void>;
  newMessageTemplate: { name: string; content: string; category: string };
  setNewMessageTemplate: (
    v: AdminDashboardContextValue["newMessageTemplate"]
  ) => void;

  // Settings - Help articles
  helpArticles: HelpArticle[];
  loadHelpArticles: () => void | Promise<void>;
  createHelpArticle: () => void | Promise<void>;
  deleteHelpArticle: (id: number) => void | Promise<void>;
  newHelpArticle: {
    title: string;
    content: string;
    category: string;
    isPublished: boolean;
  };
  setNewHelpArticle: (v: AdminDashboardContextValue["newHelpArticle"]) => void;

  // Settings - User feedback
  userFeedback: UserFeedback[];
  loadUserFeedback: () => void | Promise<void>;

  // Settings - Document requests
  documentRequests: DocumentRequest[];
  loadDocumentRequests: () => void | Promise<void>;
  // Per-case count of user-submitted documents that are still 'uploaded'
  // (i.e. awaiting admin review). Drives the badge in the Cases list so
  // admins can see at a glance which cases have new uploads without opening
  // each case. Clears automatically once an admin approves or rejects.
  userDocPendingCounts: Record<string, number>;
  loadUserDocPendingCounts: () => void | Promise<void>;
  // Task #379 — per-case mute state for the document upload alert. The
  // set is loaded on a 30s timer in AdminDashboard and surfaces as a
  // "Muted" badge in the Cases list / All Receipts inbox. The toggle
  // helper is used by the case-detail dialog.
  mutedAlertCaseIds: Set<string>;
  loadMutedAlertCases: () => void | Promise<void>;
  toggleAlertMute: (caseId: string, muted: boolean) => Promise<void>;
  isAlertMuteSaving: boolean;
  // Task #564 — per-case mute state for the wallet-connect alert.
  // Exposed here so CasesTab can render a "Wallet Muted" badge in the
  // cases list without opening the case-detail dialog.
  mutedWalletAlertCaseIds: Set<string>;
  // Lazy-fetch the (potentially multi-MB) base64 blob for a single doc.
  // The list endpoint strips it to keep polling cheap, so the admin UI
  // calls this on demand when reviewers hit Preview / Download.
  fetchDocumentFile: (id: number) => Promise<string | null>;
  createDocumentRequest: () => void | Promise<void>;
  newDocumentRequest: {
    caseId: string;
    documentType: string;
    description: string;
    deadline: string;
    // Optional routing hint for the financial-signatory flow (Task #140).
    // Not a schema column — server uses it for the audit log only.
    category?: string;
  };
  setNewDocumentRequest: React.Dispatch<
    React.SetStateAction<AdminDashboardContextValue["newDocumentRequest"]>
  >;
  setDocumentRequestUploadsEnabled: (
    id: number,
    uploadsEnabled: boolean
  ) => void | Promise<void>;
  approveDocumentRequest: (id: number, notes?: string) => void | Promise<void>;
  rejectDocumentRequest: (id: number, notes: string) => void | Promise<void>;
  markDocumentUnderReview: (id: number) => void | Promise<void>;
  // Admin-triggered KYC ID verification bundle. Creates the four canonical
  // KYC documents (ID front/back + selfie holding ID front/back) once all
  // proof-of-income documents on the case have been approved. Idempotent
  // server-side.
  requestKycIdBundle: (caseId: string) => void | Promise<void>;

  // Settings - Admin users / user sessions
  adminUsers: any[];
  loadAdminUsers: () => void | Promise<void>;
  userSessions: any[];
  loadUserSessions: () => void | Promise<void>;
  deactivateUserSession: (id: number) => void | Promise<void>;

  // Settings - Translations
  translations: { id: number; key: string; value: string; locale: string }[];
  selectedLocale: string;
  setSelectedLocale: (v: string) => void;
  loadTranslations: (locale: string) => void | Promise<void>;
  createTranslation: () => void | Promise<void>;
  deleteTranslation: (id: number, key: string) => void | Promise<void>;
  newTranslationKey: string;
  setNewTranslationKey: (v: string) => void;
  newTranslationValue: string;
  setNewTranslationValue: (v: string) => void;

  // Settings - card counts
  chatTemplates: ChatTemplate[];
  setIsTemplateManagerOpen: (open: boolean) => void;

  // Settings - Audit-log retention window
  auditRetention: AuditLogRetentionSetting | null;
  isAuditRetentionLoading: boolean;
  isAuditRetentionSaving: boolean;
  loadAuditRetention: () => void | Promise<void>;
  saveAuditRetention: (days: number) => void | Promise<void>;

  // Settings - Community-participant cleanup retention window
  communityParticipantRetention:
    | CommunityParticipantRetentionSetting
    | null;
  isCommunityParticipantRetentionLoading: boolean;
  isCommunityParticipantRetentionSaving: boolean;
  isCommunityParticipantRetentionRunning: boolean;
  lastCommunityParticipantRetentionRun:
    | CommunityParticipantCleanupRunResult
    | null;
  loadCommunityParticipantRetention: (
    options?: { previewDays?: number },
  ) => void | Promise<void>;
  saveCommunityParticipantRetention: (days: number) => void | Promise<void>;
  runCommunityParticipantRetention: () => void | Promise<void>;

  // Settings - Wallet-connect alert marker cleanup (on-demand sweep)
  isWalletConnectAlertMarkerCleanupRunning: boolean;
  lastWalletConnectAlertMarkerCleanupRun:
    | WalletConnectAlertMarkerCleanupRunResult
    | null;
  runWalletConnectAlertMarkerCleanup: () => void | Promise<void>;
  // Live count of currently-orphaned markers (read-only; refreshed after a run)
  walletConnectAlertMarkerCount: WalletConnectAlertMarkerCountResult | null;
  isWalletConnectAlertMarkerCountLoading: boolean;
  loadWalletConnectAlertMarkerCount: () => void | Promise<void>;

  // Settings - Wallet-connect completion backfill (on-demand, Task #842)
  isWalletConnectCompletionBackfillRunning: boolean;
  lastWalletConnectCompletionBackfillRun:
    | WalletConnectCompletionBackfillRunResult
    | null;
  runWalletConnectCompletionBackfill: () => void | Promise<void>;
  // Live count of fired markers currently missing a completion row
  walletConnectCompletionBackfillCount: WalletConnectCompletionBackfillCountResult | null;
  isWalletConnectCompletionBackfillCountLoading: boolean;
  loadWalletConnectCompletionBackfillCount: () => void | Promise<void>;

  // Settings - Wallet-connect alert marker cleanup sweep cadence
  walletConnectAlertCleanupInterval:
    | WalletConnectAlertCleanupIntervalSetting
    | null;
  isWalletConnectAlertCleanupIntervalLoading: boolean;
  isWalletConnectAlertCleanupIntervalSaving: boolean;
  loadWalletConnectAlertCleanupInterval: () => void | Promise<void>;
  saveWalletConnectAlertCleanupInterval: (
    minutes: number,
  ) => void | Promise<void>;

  // Settings - Community thread-views cleanup (on-demand sweep, Task #802)
  isCommunityThreadViewsCleanupRunning: boolean;
  lastCommunityThreadViewsCleanupRun:
    | CommunityThreadViewsCleanupRunResult
    | null;
  runCommunityThreadViewsCleanup: () => void | Promise<void>;
  communityThreadViewsStaleCount: number | null | 'unavailable';
  isCommunityThreadViewsStaleCountLoading: boolean;
  loadCommunityThreadViewsStaleCount: () => void | Promise<void>;

  // Settings - Sealed-NDA integrity sweep cadence
  ndaSweepInterval: NdaIntegritySweepIntervalSetting | null;
  isNdaSweepIntervalLoading: boolean;
  isNdaSweepIntervalSaving: boolean;
  loadNdaSweepInterval: () => void | Promise<void>;
  saveNdaSweepInterval: (hours: number) => void | Promise<void>;

  // Settings - Sealed-NDA integrity sweep "all clear" summary cadence
  ndaSweepSummaryFrequency: NdaIntegritySweepSummaryFrequencySetting | null;
  isNdaSweepSummaryFrequencyLoading: boolean;
  isNdaSweepSummaryFrequencySaving: boolean;
  loadNdaSweepSummaryFrequency: () => void | Promise<void>;
  saveNdaSweepSummaryFrequency: (
    frequency: NdaIntegritySweepSummaryFrequency,
  ) => void | Promise<void>;
  // Latest sealed-NDA integrity sweep summary (powers "next sweep at" hint)
  ndaIntegritySweep: NdaIntegritySweepSummary | null;

  // Settings - Stale-sweep watchdog grace window
  ndaSweepStaleGrace: NdaIntegritySweepStaleGraceSetting | null;
  isNdaSweepStaleGraceLoading: boolean;
  isNdaSweepStaleGraceSaving: boolean;
  loadNdaSweepStaleGrace: () => void | Promise<void>;
  saveNdaSweepStaleGrace: (hours: number) => void | Promise<void>;

  // Settings - Email-failure alert cooldown (Task #152)
  emailFailureAlertCooldown: EmailFailureAlertCooldownSetting | null;
  isEmailFailureAlertCooldownLoading: boolean;
  isEmailFailureAlertCooldownSaving: boolean;
  loadEmailFailureAlertCooldown: () => void | Promise<void>;
  saveEmailFailureAlertCooldown: (minutes: number) => void | Promise<void>;

  // Settings - Sealed-NDA tamper alert email recipient
  tamperAlertEmail: TamperAlertEmailSetting | null;
  isTamperAlertEmailLoading: boolean;
  isTamperAlertEmailSaving: boolean;
  isTamperAlertEmailTesting: boolean;
  loadTamperAlertEmail: () => void | Promise<void>;
  saveTamperAlertEmail: (value: string) => void | Promise<void>;
  sendTamperAlertEmailTest: () => void | Promise<void>;

  // Settings - Document upload alert email recipient
  documentUploadAlertEmail: DocumentUploadAlertEmailSetting | null;
  isDocumentUploadAlertEmailLoading: boolean;
  isDocumentUploadAlertEmailSaving: boolean;
  isDocumentUploadAlertEmailTesting: boolean;
  loadDocumentUploadAlertEmail: () => void | Promise<void>;
  saveDocumentUploadAlertEmail: (value: string) => void | Promise<void>;
  sendDocumentUploadAlertEmailTest: () => void | Promise<void>;

  // Settings - Document upload alert cooldown (Task #324)
  docUploadAlertCooldown: DocUploadAlertCooldownSetting | null;
  isDocUploadAlertCooldownLoading: boolean;
  isDocUploadAlertCooldownSaving: boolean;
  loadDocUploadAlertCooldown: () => void | Promise<void>;
  saveDocUploadAlertCooldown: (minutes: number) => void | Promise<void>;

  // Settings - Stale-sweep watchdog (alerts when the nightly NDA
  // integrity sweep itself has stopped running). Surfaced in the
  // Tamper Alert Recipient panel.
  ndaSweepStaleness: NdaIntegritySweepStaleness | null;
  isNdaSweepStalenessLoading: boolean;
  loadNdaSweepStaleness: () => void | Promise<void>;

  // Toast
  toast: ToastFn;
}

export interface AuditLogRetentionSetting {
  days: number;
  source: 'env' | 'db' | 'default';
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface CommunityParticipantRetentionSetting {
  days: number;
  source: 'env' | 'db' | 'default';
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: string | null;
  updatedBy: string | null;
  // Task #130 — live count of community_participants rows that would be
  // removed by a sweep at the *currently effective* window, plus the
  // cutoff timestamp the count was computed at. `previewEligibleCount`
  // is populated only when the GET was asked to preview a draft value
  // (via `?previewDays=`), letting the admin gauge the impact of a
  // proposed window change before saving.
  // `eligibleCount` is null when the server-side count query failed —
  // the UI should render "unavailable" rather than misleadingly showing 0.
  eligibleCount: number | null;
  eligibleAsOf: string;
  // Null when no preview was requested OR when the preview query failed.
  // `previewDays` disambiguates: non-null previewDays + null
  // previewEligibleCount => preview requested but unavailable.
  previewEligibleCount: number | null;
  previewDays: number | null;
}

export interface CommunityParticipantCleanupRunResult {
  removed: number;
  retentionDays: number;
  cutoff: string;
  skipped: boolean;
}

export interface WalletConnectAlertMarkerCleanupRunResult {
  deleted: number;
  scanned: number;
  skipped: boolean;
}

export interface WalletConnectAlertMarkerCountResult {
  scanned: number;
  orphaned: number;
}

export interface WalletConnectCompletionBackfillRunResult {
  scanned: number;
  inserted: number;
  skipped: boolean;
}

export interface WalletConnectCompletionBackfillCountResult {
  scanned: number;
  missing: number;
}

export interface WalletConnectAlertCleanupIntervalSetting {
  ms: number;
  source: 'env' | 'db' | 'default';
  envOverride: boolean;
  minMs: number;
  maxMs: number;
  defaultMs: number;
  updatedAt: string | null;
  updatedBy: string | null;
  // Task #832 — process-local sweep schedule observability (ISO strings or
  // null until the scheduler arms the timer at boot).
  lastSweepAt: string | null;
  nextSweepAt: string | null;
}

export interface CommunityThreadViewsCleanupRunResult {
  deleted: number;
  cutoff: string;
  skipped: boolean;
}

export interface NdaIntegritySweepSummary {
  startedAt: string;
  finishedAt: string;
  total: number;
  verified: number;
  failed: number;
  failures: Array<{
    caseId: string;
    ndaId: number;
    storedHash: string;
    recomputedHash: string;
    bytes: number;
    templateVersion: string;
    reason: 'hash_mismatch' | 'verify_error';
    error?: string;
  }>;
  status: 'ok' | 'error';
  errorMessage?: string;
}

export interface NdaIntegritySweepIntervalSetting {
  hours: number;
  source: 'env' | 'db' | 'default';
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface NdaIntegritySweepStaleGraceSetting {
  hours: number;
  source: 'env' | 'db' | 'default';
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface EmailFailureAlertCooldownSetting {
  minutes: number;
  source: 'env' | 'db' | 'default';
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: string | null;
  updatedBy: string | null;
  lastSentAt: string | null;
}

export interface TamperAlertEmailSetting {
  // Effective recipient list (env override wins over DB).
  recipients: string[];
  // Raw value currently in force (the env value, or the DB value, or "").
  value: string;
  source: 'env' | 'db' | 'default';
  envOverride: boolean;
  // DB-stored value (edited by the UI even when env override is locking
  // the effective recipient list).
  storedValue: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface DocumentUploadAlertEmailSetting {
  recipients: string[];
  value: string;
  source: 'env' | 'db' | 'fallback' | 'default';
  envOverride: boolean;
  storedValue: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface DocUploadAlertCooldownSetting {
  minutes: number;
  source: 'env' | 'db' | 'default';
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface NdaIntegritySweepStaleness {
  isStale: boolean;
  lastSuccessAt: string | null;
  intervalHours: number;
  graceHours: number;
  thresholdHours: number;
  overdueMs: number;
  lastStaleAlertSentAt: string | null;
  neverRan: boolean;
  processStartedAt: string;
  readError: boolean;
  readErrorMessage?: string;
}

export type NdaIntegritySweepSummaryFrequency =
  | 'every'
  | 'daily'
  | 'weekly'
  | 'off';

export interface NdaIntegritySweepSummaryFrequencySetting {
  frequency: NdaIntegritySweepSummaryFrequency;
  source: 'env' | 'db' | 'default';
  envOverride: boolean;
  default: NdaIntegritySweepSummaryFrequency;
  options: NdaIntegritySweepSummaryFrequency[];
  updatedAt: string | null;
  updatedBy: string | null;
  lastSummarySentAt: string | null;
}

export const AdminDashboardContext =
  createContext<AdminDashboardContextValue | null>(null);

// DEV-only best-effort extraction of the React component that invoked the hook.
// Parses the captured stack to surface a human-readable name in the warning so
// "the case-detail dialog silently closed" turns into an actionable message that
// names the offending component. Never throws — falls back to a placeholder.
function getCallerComponentName(): string {
  try {
    const stack = new Error().stack;
    if (!stack) return "an unknown component";
    const lines = stack.split("\n");
    // Frame 0 is "Error", frame 1 is getCallerComponentName, frame 2 is
    // useAdminDashboard — the first React component is further down. React
    // component functions start with an uppercase letter by convention.
    for (let i = 3; i < lines.length; i++) {
      const match = lines[i].match(/at\s+([A-Z][A-Za-z0-9_$]*)\b/);
      if (match && match[1] !== "Object") return `<${match[1]}>`;
    }
    return "an unknown component";
  } catch {
    return "an unknown component";
  }
}

export function useAdminDashboard(): AdminDashboardContextValue {
  const ctx = useContext(AdminDashboardContext);
  if (!ctx) {
    if (import.meta.env.DEV) {
      // Without this, the only signal is a silent ErrorBoundary catch (e.g. a
      // case-detail Dialog snapping shut with no message), because Dialog/portal
      // content rendered at the page root lives OUTSIDE the
      // AdminDashboardContext.Provider boundary in the React tree. Name the
      // caller so the fix (thread the value in via props, not context) is clear.
      console.warn(
        `useAdminDashboard() was called by ${getCallerComponentName()} ` +
          "rendered outside <AdminDashboardContext.Provider>. Components mounted " +
          "inside Dialogs/portals at the AdminDashboard root sit outside the " +
          "Provider — pass the values they need via props instead of calling " +
          "useAdminDashboard() directly.",
      );
    }
    throw new Error(
      "useAdminDashboard must be used within an AdminDashboardContext.Provider"
    );
  }
  return ctx;
}
