import React, { useEffect, useState, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import type { RefundClaimStatusFilter } from "@shared/types";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent } from "@/components/ui/tabs";

import { 
  
  
  
  
  
   
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldAlert, RefreshCw, Trash2, Lock, Plus, FileText, Edit3, History, User, LogOut, ShieldCheck, Key, KeyRound, ExternalLink, X, MessageCircle, Send, Bell, AlertTriangle, Clock, CheckCircle, Image, Wallet, Mail, MapPin, Settings, Moon, Sun, TrendingUp, Save, LayoutDashboard, Eye, Zap, Pin, StickyNote, ChevronDown, Languages, Scale, Download, ShieldOff, BellOff, Fingerprint } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { useToast } from "@/hooks/use-toast";
import { isActionableReceiptStatus } from "@/lib/receiptStatus";
import {
  checkHasActiveSession,
  buildRotateAccessCodeConfirmMessage,
  buildLockAccountConfirmMessage,
  buildResetPinConfirmMessage,
  buildForceLogoutConfirmMessage,
  postAccessCodeAction,
  type ActiveSessionInfo,
} from "@/lib/rotateAccessCodeSession";
import { countRefundClaimSubmitted } from "@/lib/refundClaimBadge";
import { buildDepositQuickSendTemplates } from "@/lib/depositQuickSendTemplates";
import { getPasswordStrengthDetail, PASSWORD_WEAK_HINTS } from "../../../shared/passwordStrength";
import { getAdminLoginErrorMessage, type AdminLoginErrorResult } from "./adminLoginError";
import { useTranslation } from "react-i18next";
import { useChatAutoScroll } from "@/hooks/use-chat-autoscroll";
import { usePendingCountsSync } from "@/hooks/usePendingCountsSync";
import { useCrossTabSync } from "@/hooks/useCrossTabSync";
import { useSessionStorageDismissal } from "@/hooks/useSessionStorageDismissal";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useTheme } from "@/App";
import { SubduedSpaceBackground } from "@/components/PremiumBackground";
import { SessionRefreshPanel } from "@/components/admin/SessionRefreshPanel";
import { StageSkipPanels } from "@/components/admin/StageSkipPanels";
import { WeakAdminPasswordBanner } from "@/components/admin/WeakAdminPasswordBanner";
import { WeakAdminUsernameBanner } from "@/components/admin/WeakAdminUsernameBanner";
import { WeakSessionSecretBanner } from "@/components/admin/WeakSessionSecretBanner";
import { WeakPasswordBanner } from "@/components/admin/WeakPasswordBanner";
import { EscapeHatchDevBanner } from "@/components/admin/EscapeHatchDevBanner";
import { EscapeHatchProdBanner } from "@/components/admin/EscapeHatchProdBanner";
import { ServiceDegradedBanner } from "@/components/admin/ServiceDegradedBanner";
import { EmergencyResetBanner } from "@/components/admin/EmergencyResetBanner";
import { EmailDeliveryAlertBanner } from "@/components/admin/EmailDeliveryAlertBanner";
import { ComplianceStrip } from "@/components/ComplianceStrip";
const ContentManagement = lazy(() =>
  import("@/components/admin/ContentManagement").then((m) => ({ default: m.ContentManagement })),
);

const CommunityManagement = lazy(() =>
  import("@/components/admin/CommunityManagement").then((m) => ({ default: m.CommunityManagement })),
);
import { CaseEmailDeliveryPanel } from "@/components/admin/CaseEmailDeliveryPanel";
import { formatAuditValue, getAuditActionLabel } from "@/components/admin/auditValueFormatter";
import { CaseDialogHeaderSkeleton, CaseTabContentSkeleton } from "@/components/admin/CaseDialogSkeleton";
const KeyRequestsManagement = lazy(() =>
  import("@/components/admin/KeyRequestsManagement").then((m) => ({
    default: m.KeyRequestsManagement,
  })),
);
import { ErrorBoundary } from "@/components/ErrorBoundary";


import { SUPPORTED_LOCALES } from "@/i18n";
import {
  AdminTabFallback,
  AdminTabLoading,
  playNotificationSound,
  type AdminData,
  type Case,
  type AdminMessage,
  type DepositReceipt,
  type StampDutyReceipt,
  type CaseLetter,
  type Submission,
  type ChatMessage,
  type ChatTemplate,
  type CaseNote,
  type AuditLog,
  type FailedLoginAttempt,
  type FailedLoginByIp,
  type DeclarationReadAttempt,
  type DeclarationReadByIp,
  type Notification,
  type ScheduledMessage,
  type MessageTemplate,
  type HelpArticle,
  type UserFeedback,
  type DocumentRequest,
  type SettingsView,
  type DeclarationSubmission,
} from "@/components/admin/shared";
import {
  AdminDashboardContext,
  type EmergencyResetActivity,
  type AdminSessionWithCurrent,
  type AuditLogRetentionSetting,
  type CommunityParticipantRetentionSetting,
  type CommunityParticipantCleanupRunResult,
  type WalletConnectAlertMarkerCleanupRunResult,
  type WalletConnectAlertMarkerCountResult,
  type WalletConnectCompletionBackfillRunResult,
  type WalletConnectCompletionBackfillCountResult,
  type WalletConnectAlertCleanupIntervalSetting,
  type CommunityThreadViewsCleanupRunResult,
  type NdaIntegritySweepIntervalSetting,
  type NdaIntegritySweepStaleGraceSetting,
  type NdaIntegritySweepSummaryFrequency,
  type NdaIntegritySweepSummaryFrequencySetting,
  type TamperAlertEmailSetting,
  type DocumentUploadAlertEmailSetting,
  type DocUploadAlertCooldownSetting,
  type EmailFailureAlertCooldownSetting,
  type NdaIntegritySweepStaleness,
} from "@/components/admin/AdminDashboardContext";
import { AdminWithdrawalRequestsDialog } from "@/components/admin/AdminWithdrawalRequestsDialog";
import { AdminNotificationsPanel } from "@/components/admin/AdminNotificationsPanel";
import { SignedNdaDialog, PreviewNdaDialog } from "@/components/admin/NdaAdminDialogs";
const AllReceiptsTab = lazy(() =>
  import("@/components/admin/AllReceiptsTab").then((m) => ({ default: m.AllReceiptsTab })),
);

import { EditAccountDialog } from "@/components/admin/EditAccountDialog";
import { DepositReceiptsDialog } from "@/components/admin/DepositReceiptsDialog";
import { AdminGroupedNav } from "@/components/admin/AdminGroupedNav";
import { AdminCaseFinder } from "@/components/admin/AdminCaseFinder";
import { CaseDetailTabsList, CASE_DETAIL_TABS } from "@/components/admin/CaseDetailTabsList";
import { generatePhraseKey, countPhraseWords, phraseLengthFromCode, PHRASE_KEY_LENGTHS, type PhraseKeyLength } from "@/lib/phraseKeyWords";
import { SupportingDocumentsPanel } from "@/components/admin/SupportingDocumentsPanel";
const CasesTab = lazy(() =>
  import("@/components/admin/tabs/CasesTab").then((m) => ({ default: m.CasesTab })),
);
const SubmissionsTab = lazy(() =>
  import("@/components/admin/tabs/SubmissionsTab").then((m) => ({ default: m.SubmissionsTab })),
);
const ConversationsTab = lazy(() =>
  import("@/components/admin/tabs/ConversationsTab").then((m) => ({ default: m.ConversationsTab })),
);
const AnalyticsTab = lazy(() =>
  import("@/components/admin/tabs/AnalyticsTab").then((m) => ({ default: m.AnalyticsTab })),
);
const SettingsTab = lazy(() =>
  import("@/components/admin/tabs/SettingsTab").then((m) => ({ default: m.SettingsTab })),
);
const VisitorsTab = lazy(() =>
  import("@/components/admin/tabs/VisitorsTab").then((m) => ({ default: m.VisitorsTab })),
);
const CommunicationsTab = lazy(() => import("@/components/admin/tabs/CommunicationsTab"));
const DocumentsTab = lazy(() =>
  import("@/components/admin/tabs/DocumentsTab").then((m) => ({ default: m.DocumentsTab })),
);
const SupportingDocumentsTab = lazy(() =>
  import("@/components/admin/tabs/SupportingDocumentsTab").then((m) => ({
    default: m.SupportingDocumentsTab,
  })),
);
const DeclarationsTab = lazy(() =>
  import("@/components/admin/tabs/DeclarationsTab").then((m) => ({ default: m.DeclarationsTab })),
);
const DepositsTab = lazy(() =>
  import("@/components/admin/tabs/DepositsTab").then((m) => ({ default: m.DepositsTab })),
);
import { CaseDocumentsSection } from "@/components/admin/CaseDocumentsSection";
import { SealedNdaMetadata } from "@/components/admin/SealedNdaMetadata";
import { WithdrawalGuidePreview } from "@/components/admin/WithdrawalGuidePreview";
import { PayoutWalletHistoryHint } from "@/components/admin/PayoutWalletHistoryHint";
import { ReissueLetterDialog, type ReissueDraft } from "@/components/admin/ReissueLetterDialog";
import { DeclarationEmailDialog, type DeclarationEmailDraft } from "@/components/admin/DeclarationEmailDialog";
import { StageEmailDialog, type StageEmailDraft } from "@/components/admin/StageEmailDialog";
import { SendEmailDialog } from "@/components/admin/SendEmailDialog";
import { FinalizeAccountDialog } from "@/components/admin/FinalizeAccountDialog";

import { TokenDepositPaidTab } from "@/components/admin/TokenDepositPaidTab";
import { AdminPortalWarningPanel } from "@/components/admin/AdminPortalWarningPanel";
import AdminEmergencyResetDialog from "@/components/admin/AdminEmergencyResetDialog";


interface BuildInfo {
  buildStamp: string;
  bootTime: string;
  nodeEnv: string;
}

export default function AdminDashboard() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  // Currently-deployed build identifier — drives the small "build"
  // badge in the dashboard header so an admin can confirm at a glance
  // which release the server is on without curling X-Build-Stamp.
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  // Server-reported security flags. Fetched once after login; used to
  // surface a banner when development escape hatches are active in production.
  const [securityFlags, setSecurityFlags] = useState<{
    weakAdminPasswordAllowed: boolean;
    weakAdminUsernameAllowed: boolean;
    weakSessionSecretAllowed: boolean;
    isProduction: boolean;
    weakPassword: boolean;
  } | null>(null);
  // Per-session dismissal of the "new version available" banner. We
  // store the *server* build stamp we dismissed against so that a
  // second deploy in the same session re-arms the banner (the new
  // stamp won't match the dismissed one).
  const [dismissedStaleStamp, setDismissedStaleStamp] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('adminStaleDismissedStamp');
    } catch {
      return null;
    }
  });
  const [ndaIntegritySweep, setNdaIntegritySweep] = useState<{
    startedAt: string;
    finishedAt: string;
    total: number;
    verified: number;
    failed: number;
    failures: Array<{ caseId: string; ndaId: number; storedHash: string; recomputedHash: string; bytes: number; templateVersion: string; reason: 'hash_mismatch' | 'verify_error'; error?: string }>;
    status: 'ok' | 'error';
    errorMessage?: string;
  } | null>(null);
  const [isReRunningNdaSweep, setIsReRunningNdaSweep] = useState(false);
  // Dismissal is keyed to the sweep's finishedAt timestamp so the banner
  // re-appears as soon as a NEWER sweep produces a failure/error — an
  // operator can't permanently silence the warning by hitting X.
  // Persisted in sessionStorage (Task #169) so reloading the dashboard
  // during the same sweep window doesn't re-show an already-acknowledged
  // banner — mirrors the email-delivery banner's behavior below.
  const NDA_SWEEP_DISMISSED_KEY = 'ibccf.admin.dismissedNdaSweepFinishedAt';
  const [dismissedNdaSweepFinishedAt, setDismissedNdaSweepFinishedAtState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return window.sessionStorage.getItem(NDA_SWEEP_DISMISSED_KEY);
    } catch {
      return null;
    }
  });
  const setDismissedNdaSweepFinishedAt = (value: string | null) => {
    setDismissedNdaSweepFinishedAtState(value);
    if (typeof window === 'undefined') return;
    try {
      if (value === null) {
        window.sessionStorage.removeItem(NDA_SWEEP_DISMISSED_KEY);
      } else {
        window.sessionStorage.setItem(NDA_SWEEP_DISMISSED_KEY, value);
      }
    } catch {
      // sessionStorage may be unavailable (private mode / quota) — best effort.
    }
  };
  // Dashboard-wide transactional-email failure alert (Task #150). Polls
  // /api/cases/email-delivery-alerts and surfaces a top-of-dashboard
  // banner whenever any case has an email_*_failed audit row (or a
  // case_emails row with status='failed') in the last hour. Dismissal
  // is keyed to the latest failure timestamp so a NEWER failure
  // re-shows the banner automatically — operators can't permanently
  // silence the warning by hitting X.
  const [emailDeliveryAlerts, setEmailDeliveryAlerts] = useState<{
    windowMinutes: number;
    since: string;
    total: number;
    uniqueCaseCount: number;
    uniqueCaseIds: string[];
    latestAt: string | null;
    alertRecipientConfigured: boolean;
    lastAlertSentAt: string | null;
    alertCooldownMinutes: number;
    failures: Array<{
      caseId: string;
      tag: string;
      at: string;
      error: string | null;
      source: "audit" | "case_emails";
    }>;
  } | null>(null);
  // Persist the email-delivery banner dismissal in sessionStorage keyed to
  // the latest failure timestamp (Task #153). The banner can re-fire as
  // often as every minute during an SMTP outage, so a plain useState would
  // re-show an already-acknowledged window on every reload. Storing the
  // dismissed `latestAt` for the session means a NEWER failure still
  // re-surfaces the banner (since the key changes) while a reload during
  // the same failure window keeps it hidden.
  const EMAIL_DELIVERY_DISMISSED_KEY = 'ibccf.admin.dismissedEmailDeliveryAlertAt';
  const [dismissedEmailDeliveryAlertAt, setDismissedEmailDeliveryAlertAtState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return window.sessionStorage.getItem(EMAIL_DELIVERY_DISMISSED_KEY);
    } catch {
      return null;
    }
  });
  const setDismissedEmailDeliveryAlertAt = (value: string | null) => {
    setDismissedEmailDeliveryAlertAtState(value);
    if (typeof window === 'undefined') return;
    try {
      if (value === null) {
        window.sessionStorage.removeItem(EMAIL_DELIVERY_DISMISSED_KEY);
      } else {
        window.sessionStorage.setItem(EMAIL_DELIVERY_DISMISSED_KEY, value);
      }
    } catch {
      // sessionStorage may be unavailable (private mode / quota) — best effort.
    }
  };
  // "Emergency reset was used" one-time banner dismissal (Task #2403),
  // same pattern as the email-delivery alert above.
  const [dismissedEmergencyResetUsedAt, setDismissedEmergencyResetUsedAt] = useSessionStorageDismissal('ibccf.admin.dismissedEmergencyResetUsedAt');
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<AdminLoginErrorResult | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [passwordOverrideActive, setPasswordOverrideActive] = useState(false);
  const [loginRequires2FA, setLoginRequires2FA] = useState(false);
  const [loginTotpCode, setLoginTotpCode] = useState("");
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [showEmergencyReset, setShowEmergencyReset] = useState(false);

  const [cases, setCases] = useState<Case[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  // Bumped each time the admin clicks the per-row "email delivery" badge on
  // the Cases list (Task #146) so the CaseEmailDeliveryPanel inside the
  // already-mounted case-detail dialog can `scrollIntoView` and refresh.
  // Using a number signal (rather than a boolean) lets the panel react to
  // every click even when the same case is re-opened back-to-back.
  const [emailPanelScrollSignal, setEmailPanelScrollSignal] = useState(0);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState("");
  const [isFinalizeOpen, setIsFinalizeOpen] = useState(false);
  const [isLetterEditorOpen, setIsLetterEditorOpen] = useState(false);
  const [isSubmissionsOpen, setIsSubmissionsOpen] = useState(false);
  const [caseSubmissions, setCaseSubmissions] = useState<Submission[]>([]);
  const [letterData, setLetterData] = useState<Partial<CaseLetter>>({
    headline: "Withdrawal Protocol Selection",
    introduction: "",
    bodyContent: "",
    footerNote: "",
    complianceReference: "",
    optionATitle: "Accelerated Release",
    optionADescription: "",
    optionAAmount: "",
    optionAFrequency: "every 12 hours",
    optionABatches: "",
    optionAKeyCost: "",
    optionATotalRequirement: "",
    optionBTitle: "Standard Release",
    optionBDescription: "",
    optionBAmount: "",
    optionBFrequency: "every 12 hours",
    optionBBatches: "",
    optionBKeyCost: "",
    optionBTotalRequirement: "",
    phraseKeyRequirements: "",
    complianceNotice: ""
  });
  const [landingPageEdit, setLandingPageEdit] = useState("dashboard");
  const [finalizeData, setFinalizeData] = useState<AdminData>({
    vipStatus: "Gold Tier",
    username: "",
    withdrawalAmount: "500,000 USDT",
    withdrawalBatches: "10",
    physilocal0: "PHY-001"
  });
  
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatCase, setChatCase] = useState<Case | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [totalUnread, setTotalUnread] = useState(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef<Record<string, number>>({});
  const isInitialLoadRef = useRef(true);
  
  // Track last known counts for notifications
  const lastRegisteredCountRef = useRef(0);
  const lastSubmissionsCountRef = useRef(0);
  const lastSyncingCountRef = useRef(0);
  const lastSubmittedDocCountRef = useRef(0);
  const isInitialDataLoadRef = useRef(true);
  const isInitialDocLoadRef = useRef(true);
  // Visitor arrival notifications
  const lastVisitorCountRef = useRef(-1);
  const isInitialVisitorLoadRef = useRef(true);
  // Pending receipt (user uploaded, awaiting admin approval) notifications
  const lastPendingReceiptCountRef = useRef(-1);
  const isInitialReceiptLoadRef = useRef(true);
  // Reactivation receipt notifications (suspended-account reactivation payments)
  const lastPendingReactivationCountRef = useRef(-1);
  const isInitialReactivationLoadRef = useRef(true);
  // Active portal-warnings badge (Communications tab) + near-expiry toasts
  const [activeWarningsCount, setActiveWarningsCount] = useState(0);
  const nearExpiryToastedIdsRef = useRef<Set<number>>((() => {
    try {
      const stored = sessionStorage.getItem('ibccf.admin.nearExpiryToasted');
      if (stored) return new Set<number>(JSON.parse(stored) as number[]);
    } catch {
      // ignore parse errors
    }
    return new Set<number>();
  })());
  
  // Admin messages and deposit receipts
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [depositReceipts, setDepositReceipts] = useState<DepositReceipt[]>([]);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(false);
  // Task #163: when admin opens the receipts dialog via the All Receipts
  // inbox, this carries the `${source}-${id}` of the clicked row so the
  // merged uploads panel scrolls to + highlights it. Suffixed with a
  // timestamp on each click so repeat-clicks re-trigger the scroll.
  const [mergedReceiptsScrollKey, setMergedReceiptsScrollKey] = useState<string | null>(null);
  // Task #113 — Stamp Duty receipt reviewer panel inside the case-detail
  // dialog. The list endpoint omits the base64 blob; we lazy-load the full
  // row on click so a case with many old receipts doesn't bloat the dialog.
  const [stampDutyReceipts, setStampDutyReceipts] = useState<StampDutyReceipt[]>([]);
  const [stampDutyReceiptBlobs, setStampDutyReceiptBlobs] = useState<Record<number, string>>({});
  const [pendingStampDutyIds, setPendingStampDutyIds] = useState<Set<number>>(new Set());
  const pendingStampDutyIdsRef = useRef<Set<number>>(new Set());
  const [stampDutyRejectingId, setStampDutyRejectingId] = useState<number | null>(null);
  const [stampDutyRejectReason, setStampDutyRejectReason] = useState("");
  const [stampDutyApprovalNote, setStampDutyApprovalNote] = useState("");
  // Admin-triggered Stamp Duty fee reminder. Lets the reviewer email the
  // configured deposit address(es) + amount to an arbitrary recipient
  // (defaults to the case's userEmail) without leaving the case dialog.
  const [stampDutyReminderEmail, setStampDutyReminderEmail] = useState("");
  const [stampDutyReminderMessage, setStampDutyReminderMessage] = useState("");
  const [stampDutyReminderSending, setStampDutyReminderSending] = useState(false);
  // Latest stamp-duty reminder audit entry for the selected case. Surfaced
  // above the form as "Last reminder: <when> to <email>" so the reviewer
  // doesn't double-nudge the same user.
  const [lastStampDutyReminder, setLastStampDutyReminder] = useState<{
    success: boolean;
    sentAt: string;
    adminUsername: string | null;
    details: string | null;
  } | null>(null);
  // Per-receipt "send notification email" flag (true = send, false = suppress).
  // Defaults to true for every receipt; admin can toggle it off before approving.
  // Reset to {} whenever the receipts dialog closes.
  const [receiptEmailFlags, setReceiptEmailFlags] = useState<Record<number, boolean>>({});
  // Tracks receipts that have an in-flight approve/reject request so the
  // buttons can disable themselves while we wait for the server. Paired with
  // an optimistic UI update so the badge flips instantly even on slow links.
  const [pendingReceiptIds, setPendingReceiptIds] = useState<Set<number>>(new Set());
  // Synchronous mirror of pendingReceiptIds — React state updates are async,
  // so a fast double-click can fire two updateReceiptStatus calls before the
  // disabled button re-renders. The ref lets us reject the second call
  // immediately and avoid stomping the first call's `previous` snapshot.
  const pendingReceiptIdsRef = useRef<Set<number>>(new Set());
  const [isAdminMessageOpen, setIsAdminMessageOpen] = useState(false);
  const [isCaseDialogLoading, setIsCaseDialogLoading] = useState(false);
  const reducedMotion = useReducedMotion();
  const dialogFadeTransition = reducedMotion ? { duration: 0 } : { duration: 0.15, ease: "easeInOut" as const };
  const [isReceiptsOpen, setIsReceiptsOpen] = useState(false);
  const [isWithdrawalRequestsOpen, setIsWithdrawalRequestsOpen] = useState(false);
  const [withdrawalRequestsCase, setWithdrawalRequestsCase] = useState<Case | null>(null);
  const [isDeclarationOpen, setIsDeclarationOpen] = useState(false);
  const [declarationCase, setDeclarationCase] = useState<Case | null>(null);
  const [declarationSubmissions, setDeclarationSubmissions] = useState<DeclarationSubmission[]>([]);
  const [isLoadingDeclarations, setIsLoadingDeclarations] = useState(false);
  const [declarationReviewerNotes, setDeclarationReviewerNotes] = useState("");
  const [updatingDeclarationStatus, setUpdatingDeclarationStatus] = useState(false);
  const [selectedDeclIdx, setSelectedDeclIdx] = useState(0);
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isSendingPhraseCodeNotice, setIsSendingPhraseCodeNotice] = useState(false);
  const [isSendingStageEmail, setIsSendingStageEmail] = useState(false);
  const [isDeclarationEmailDialogOpen, setIsDeclarationEmailDialogOpen] = useState(false);
  const [isRequestingDeclaration, setIsRequestingDeclaration] = useState(false);
  const [declarationEmailCase, setDeclarationEmailCase] = useState<Case | null>(null);
  const [declarationEmailDraft, setDeclarationEmailDraft] = useState<DeclarationEmailDraft>({
    sendEmail: true,
    subject: "",
    intro: "",
    whatToDoText: "",
    closingNote: "",
  });
  // Letter reissue dialog state
  const [isReissueDialogOpen, setIsReissueDialogOpen] = useState(false);
  const [reissueCase, setReissueCase] = useState<Case | null>(null);
  const [isReissueSubmitting, setIsReissueSubmitting] = useState(false);
  // Reissue draft holds the fee + reason AND the editable letter content
  // (pre-filled from the previous letter when the dialog opens, then sent
  // together with the version bump). Empty strings mean "leave unchanged"
  // for legacy cases that never had a letter row, but in practice we
  // always seed from the current letter on open.
  const [reissueDraft, setReissueDraft] = useState<ReissueDraft>({
    reissueFee: "",
    reason: "",
    headline: "",
    introduction: "",
    bodyContent: "",
    footerNote: "",
    complianceReference: "",
    complianceNotice: "",
    phraseKeyRequirements: "",
    optionATitle: "",
    optionADescription: "",
    optionAFrequency: "",
    optionABatches: "",
    optionAKeyCost: "",
    optionATotalRequirement: "",
    optionAAmount: "",
    optionATotalAmount: "",
    optionBTitle: "",
    optionBDescription: "",
    optionBFrequency: "",
    optionBBatches: "",
    optionBKeyCost: "",
    optionBTotalRequirement: "",
    optionBAmount: "",
    optionBTotalAmount: "",
  });
  const [isReissueLoadingLetter, setIsReissueLoadingLetter] = useState(false);
  const [isStageEmailDialogOpen, setIsStageEmailDialogOpen] = useState(false);
  const [stageEmailDraft, setStageEmailDraft] = useState<StageEmailDraft>({
    stageNumber: 1,
    stageTitle: "",
    subject: "",
    summary: "",
    detailedExplanation: "",
    whyItMatters: "",
    whatToDoText: "",
    whatToExpect: "",
    regulatoryBasisText: "",
  });
  const [newAdminMessage, setNewAdminMessage] = useState({
    category: 'processing' as 'urgent' | 'processing' | 'resolved',
    title: '',
    body: ''
  });
  const [depositAddressEdit, setDepositAddressEdit] = useState("");
  // Crypto + network for the deposit. Free-text on the wire so admins can
  // pick anything; the dropdown is just suggestions and a "Custom" escape
  // hatch flips the row into a free-text input. The "...Custom" boolean
  // tracks whether the user has explicitly chosen Custom — if a loaded
  // value doesn't match any preset we infer Custom on hydration.
  const [depositAssetEdit, setDepositAssetEdit] = useState("");
  const [depositAssetCustom, setDepositAssetCustom] = useState(false);
  const [depositNetworkEdit, setDepositNetworkEdit] = useState("");
  const [depositNetworkCustom, setDepositNetworkCustom] = useState(false);
  // Verified Payout Wallet — admin-designated disbursement address for
  // the case. Display-only on the portal side; the server stamps
  // verifiedAt/verifiedBy whenever any of these four fields change.
  const [payoutWalletAddressEdit, setPayoutWalletAddressEdit] = useState("");
  const [payoutWalletAssetEdit, setPayoutWalletAssetEdit] = useState("");
  const [payoutWalletAssetCustom, setPayoutWalletAssetCustom] = useState(false);
  const [payoutWalletNetworkEdit, setPayoutWalletNetworkEdit] = useState("");
  const [_payoutWalletNetworkCustom, setPayoutWalletNetworkCustom] = useState(false);
  const [payoutWalletNoteEdit, setPayoutWalletNoteEdit] = useState("");
  const [savingDepositDetails, setSavingDepositDetails] = useState(false);
  const [savingPayoutWallet, setSavingPayoutWallet] = useState(false);
  // Task #332 — Wallet Connect Phrase Code admin controls.
  const [walletPhraseEnabledEdit, setWalletPhraseEnabledEdit] = useState(false);
  const [walletPhraseCodeEdit, setWalletPhraseCodeEdit] = useState("");
  const [walletPhraseRevealed, setWalletPhraseRevealed] = useState(false);
  // Admin-chosen phrase length (6 or 12 words) used by the auto-generate button
  // and the word-count hint. UI-only; persisted implicitly via the saved phrase
  // content (no schema change).
  const [walletPhraseLength, setWalletPhraseLength] = useState<PhraseKeyLength>(12);
  const [savingWalletPhrase, setSavingWalletPhrase] = useState(false);
  const [profileRedirectEdit, setProfileRedirectEdit] = useState("");
  const [showWithdrawalProgressEdit, setShowWithdrawalProgressEdit] = useState(false);
  const [withdrawalGuideVisibleEdit, setWithdrawalGuideVisibleEdit] = useState(false);
  const [withdrawalGuideBodyEdit, setWithdrawalGuideBodyEdit] = useState("");

  // Full-account edit ("autonomy") + impersonation/mirror state
  const [isEditAccountOpen, setIsEditAccountOpen] = useState(false);
  const [editAccountCase, setEditAccountCase] = useState<Case | null>(null);
  // Persistent "last active" signal for the edit-account dialog (#2382).
  const [editAccountActiveSession, setEditAccountActiveSession] = useState<ActiveSessionInfo | null>(null);
  const [editAccountForm, setEditAccountForm] = useState<Record<string, string>>({});
  const [savingEditAccount, setSavingEditAccount] = useState(false);
  const [rotatingAccessCode, setRotatingAccessCode] = useState(false);
  const [sendingAccessCode, setSendingAccessCode] = useState(false);
  const [withdrawalStageEdit, setWithdrawalStageEdit] = useState("1");
  const [stageOverrideChecked, setStageOverrideChecked] = useState(false);
  const [stageOverrideReason, setStageOverrideReason] = useState("");
  const [stageSkipRequestReason, setStageSkipRequestReason] = useState("");
  const [stageSkipRequestSubmitting, setStageSkipRequestSubmitting] = useState(false);
  const [stageSkipRejectReason, setStageSkipRejectReason] = useState("");
  const [stageSkipActioning, setStageSkipActioning] = useState(false);
  const [currentAdminRole, setCurrentAdminRole] = useState<string>("admin");
  const [activityDepositAmountEdit, setActivityDepositAmountEdit] = useState("");
  const [phraseKeyDepositAmountEdit, setPhraseKeyDepositAmountEdit] = useState("");
  const [activityWalletRequirementEdit, setActivityWalletRequirementEdit] = useState("");
  const [submissionUrlEdit, setSubmissionUrlEdit] = useState("");
  const [saveProgressError, setSaveProgressError] = useState<string | null>(null);
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [localeFilter, setLocaleFilter] = useState<string>("all");
  const [sealedFilter, setSealedFilter] = useState<"all" | "sealed" | "open">("all");
  // Task #168 — persist the active admin section across reloads. A
  // `#section=<id>` hash takes precedence over the saved value so
  // deep-links keep working. Valid IDs match AdminGroupedNav.
  const ADMIN_SECTION_KEY = "ibccf.admin.activeSection";
  const VALID_ADMIN_SECTIONS = new Set<string>([
    "cases", "submissions", "key-requests", "visitors",
    "conversations", "communications", "content", "community",
    "documents", "supporting-documents", "receipts", "analytics", "settings",
  ]);
  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      const hashMatch = typeof window !== "undefined"
        ? window.location.hash.match(/section=([\w-]+)/)
        : null;
      if (hashMatch && VALID_ADMIN_SECTIONS.has(hashMatch[1])) return hashMatch[1];
      const saved = typeof window !== "undefined"
        ? window.localStorage.getItem(ADMIN_SECTION_KEY)
        : null;
      if (saved && VALID_ADMIN_SECTIONS.has(saved)) return saved;
    } catch { /* ignore */ }
    return "cases";
  });
  useEffect(() => {
    try { window.localStorage.setItem(ADMIN_SECTION_KEY, activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  // When the admin manually switches sections (via nav click or Tabs trigger),
  // clear the case search box so a stale pre-filled case ID from a previous
  // deep-link does not persist across unrelated tab visits.
  const handleManualTabChange = useCallback((next: string) => {
    setSearchQuery("");
    setActiveTab(next);
  }, []);

  // Receipts inbox controlled category filter. Shared with AllReceiptsTab so the
  // "Pending Reactivations" KPI tile can pre-select the reactivation filter in
  // one click, and admin manual changes propagate back here (clearing the filter
  // sets it back to "all" so a later navigation does not re-apply the old filter).
  const [receiptsCategoryFilter, setReceiptsCategoryFilter] = useState<string>("all");
  const setReceiptsInboxFilter = (category: string) => {
    setReceiptsCategoryFilter(category);
  };

  // Task #168 — persist the active case-detail dialog tab across sessions
  // and dialog re-opens. `#tab=<id>` hash overrides the saved value.
  const CASE_DETAIL_TAB_KEY = "ibccf.admin.caseDetailTab";
  // Derived from CASE_DETAIL_TABS (single source of truth) so tab persistence,
  // hash deep-links, and hidden-tab sanitization automatically recognize any
  // tab added to the dialog without drifting out of sync.
  const VALID_CASE_DETAIL_TABS = new Set<string>(CASE_DETAIL_TABS.map((t) => t.value));
  const [caseDetailTab, setCaseDetailTabState] = useState<string>(() => {
    try {
      const hashMatch = typeof window !== "undefined"
        ? window.location.hash.match(/tab=([\w-]+)/)
        : null;
      if (hashMatch && VALID_CASE_DETAIL_TABS.has(hashMatch[1])) return hashMatch[1];
      const saved = typeof window !== "undefined"
        ? window.localStorage.getItem(CASE_DETAIL_TAB_KEY)
        : null;
      if (saved && VALID_CASE_DETAIL_TABS.has(saved)) return saved;
    } catch { /* ignore */ }
    return "overview";
  });
  const setCaseDetailTab = (next: string) => {
    setCaseDetailTabState(next);
    try { window.localStorage.setItem(CASE_DETAIL_TAB_KEY, next); } catch { /* ignore */ }
  };
  useEffect(() => {
    (window as any).__setCaseDetailTab = (v: string) => setCaseDetailTab(v);
    return () => { delete (window as any).__setCaseDetailTab; };
  });

  useEffect(() => {
    // Exposed so sibling tabs (e.g. CommunicationsTab) can deep-link to a
    // specific case by access code without needing to lift state to a common
    // ancestor. When the case is already loaded in memory, open its detail
    // dialog directly (true one-click open); otherwise fall back to
    // switching to the Cases section and pre-filling the search box.
    (window as any).__adminOpenCase = (accessCode: string) => {
      setActiveTab("cases");
      const target = cases.find(
        (c) => c.accessCode === accessCode || c.id === accessCode,
      );
      if (target) {
        openAdminMessageDialog(target);
      } else {
        setSearchQuery(accessCode);
      }
    };
    return () => { delete (window as any).__adminOpenCase; };
  });

  // On page load, if a ?caseId=<id> query param is present (e.g. from an
  // admin notification deep-link), open that case's detail dialog directly
  // once it is loaded in memory; otherwise (case not found once the case
  // list has loaded) switch to the Cases section and pre-fill the search
  // box so the row is immediately visible. Runs once per param value via
  // caseIdParamHandledRef so repeat case-list refreshes don't reopen the
  // dialog or reset the search box.
  const caseIdParamHandledRef = useRef(false);
  useEffect(() => {
    if (caseIdParamHandledRef.current) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const caseId = params.get("caseId");
      if (!caseId) return;
      setActiveTab("cases");
      const target = cases.find(
        (c) => c.id === caseId || c.accessCode === caseId,
      );
      if (target) {
        openAdminMessageDialog(target);
        caseIdParamHandledRef.current = true;
      } else if (cases.length > 0) {
        // Case list has loaded but the id wasn't found; fall back to the
        // search box once rather than waiting forever.
        setSearchQuery(caseId);
        caseIdParamHandledRef.current = true;
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases]);

  // Task #N — hideable case-detail dialog tabs. Admins can suppress tabs
  // they never use (e.g. Audit) so the dialog feels less cluttered. The
  // preference is global (per admin browser) and stored in localStorage.
  // At least one tab is always kept visible to prevent an empty dialog.
  const HIDDEN_CASE_TABS_KEY = "ibccf.admin.hiddenCaseTabs";
  const [hiddenCaseTabs, setHiddenCaseTabs] = useState<string[]>(() => {
    try {
      const saved = typeof window !== "undefined"
        ? window.localStorage.getItem(HIDDEN_CASE_TABS_KEY) : null;
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed))
          return (parsed as unknown[])
            .filter((v): v is string => typeof v === "string" && VALID_CASE_DETAIL_TABS.has(v));
      }
    } catch { /* ignore */ }
    return [];
  });
  const [showTabConfig, setShowTabConfig] = useState(false);
  const toggleHiddenCaseTab = (tabValue: string) => {
    setHiddenCaseTabs((prev) => {
      const allTabValues = CASE_DETAIL_TABS.map((t) => t.value);
      const wouldHide = !prev.includes(tabValue);
      // Guard: never hide the last visible tab.
      const visibleAfter = allTabValues.filter(
        (v) => !(wouldHide ? [...prev, tabValue] : prev.filter((x) => x !== tabValue)).includes(v),
      );
      if (visibleAfter.length === 0) return prev;
      const next = wouldHide ? [...prev, tabValue] : prev.filter((v) => v !== tabValue);
      try { window.localStorage.setItem(HIDDEN_CASE_TABS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      // If the currently active tab was just hidden, jump to the first visible tab.
      if (next.includes(caseDetailTab) && visibleAfter.length > 0) {
        setCaseDetailTab(visibleAfter[0]);
      }
      return next;
    });
  };

  // Task #127 — quick-triage filter for stamp-duty receipts awaiting admin
  // review. Lifted out of CasesTab so the cases nav badge can both display
  // the count and pre-activate the filter when admins click it from any tab.
  const [stampDutyPendingOnly, setStampDutyPendingOnly] = useState<boolean>(false);
  // Pending stamp-duty-review count drives the Cases nav badge (Task #127).
  // Mirrors `isStampDutyPending` inside CasesTab so the badge clears as
  // soon as a reviewer approves/rejects the receipt.
  const stampDutyPendingCount = useMemo(
    () =>
      cases.filter(
        (c) =>
          c.stampDutyEnabled !== false &&
          c.stampDutyStatus === 'awaiting_admin_approval',
      ).length,
    [cases],
  );

  // Chat templates state
  const [chatTemplates, setChatTemplates] = useState<ChatTemplate[]>([]);
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', content: '', category: '' });
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  
  // Case notes state
  const [caseNotes, setCaseNotes] = useState<CaseNote[]>([]);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  
  // Enterprise features state
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [emergencyResetActivity, setEmergencyResetActivity] = useState<EmergencyResetActivity>({ events: [], lastUsedAt: null });
  const [adminSessions, setAdminSessions] = useState<AdminSessionWithCurrent[]>([]);
  const [failedLogins, setFailedLogins] = useState<FailedLoginAttempt[]>([]);
  const [failedLoginCount24h, setFailedLoginCount24h] = useState(0);
  const [failedLoginsByIp, setFailedLoginsByIp] = useState<FailedLoginByIp[]>([]);
  const [failedLoginsByIpWindowHours, setFailedLoginsByIpWindowHours] = useState(24);
  // Suspicious declaration-read attempts (Task #109 audit feed)
  const [declarationReadAttempts, setDeclarationReadAttempts] = useState<
    DeclarationReadAttempt[]
  >([]);
  const [declarationReadCount24h, setDeclarationReadCount24h] = useState(0);
  const [declarationReadByIp, setDeclarationReadByIp] = useState<
    DeclarationReadByIp[]
  >([]);
  const [declarationReadByIpWindowHours, setDeclarationReadByIpWindowHours] =
    useState(24);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [helpArticles, setHelpArticles] = useState<HelpArticle[]>([]);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [userSessions, setUserSessions] = useState<any[]>([]);
  const [userFeedback, setUserFeedback] = useState<UserFeedback[]>([]);
  const [documentRequests, setDocumentRequests] = useState<DocumentRequest[]>([]);
  // Pending user-uploaded supporting document count (Task #270).
  // Document requests with status "submitted" have been uploaded by the case
  // holder but not yet reviewed by an admin. Drives the Documents nav badge
  // so new uploads surface immediately without the admin having to open
  // each case manually. Resets as admins approve/reject each request.
  const pendingDocCount = useMemo(
    () => documentRequests.filter((d) => d.status === 'submitted').length,
    [documentRequests],
  );
  const [userDocPendingCounts, setUserDocPendingCounts] = useState<Record<string, number>>({});
  // True once the pending-counts badge data has been fetched at least once.
  // Combined with the cases load below, this drives the `admin-data-ready`
  // sentinel that E2E tests wait on instead of racing the 3 s polling loop.
  const [pendingCountsLoaded, setPendingCountsLoaded] = useState(false);
  const supportingDocPendingCount = useMemo(
    () => Object.values(userDocPendingCounts).reduce((sum, n) => sum + n, 0),
    [userDocPendingCounts],
  );
  // Task #780 — per-case count of withdrawal requests still awaiting admin
  // review (status='pending'). Drives a cross-case badge/filter pill and a
  // per-row badge on the Cases list so new withdrawal applications surface
  // immediately. Clears as soon as an admin approves/rejects/cancels the
  // request (the review dialog calls loadWithdrawalPendingCounts; the
  // 3 s poll is the backstop).
  const [withdrawalPendingCounts, setWithdrawalPendingCounts] = useState<Record<string, number>>({});
  const [withdrawalPendingOnly, setWithdrawalPendingOnly] = useState<boolean>(false);
  const [reactivationPendingCounts, setReactivationPendingCounts] = useState<Record<string, number>>({});
  const [reactivationPendingOnly, setReactivationPendingOnly] = useState<boolean>(false);
  const REFUND_CLAIM_FILTER_KEY = "ibccf.admin.refundClaimStatusFilter";
  const VALID_REFUND_CLAIM_STATUSES = new Set<RefundClaimStatusFilter>(["all", "pending_submission", "submitted", "approved", "rejected"]);
  const [refundClaimStatusFilter, _setRefundClaimStatusFilter] = useState<RefundClaimStatusFilter>(() => {
    try {
      const stored = localStorage.getItem(REFUND_CLAIM_FILTER_KEY);
      if (stored && VALID_REFUND_CLAIM_STATUSES.has(stored as RefundClaimStatusFilter)) {
        return stored as RefundClaimStatusFilter;
      }
    } catch { /* ignore */ }
    return "all";
  });
  const setRefundClaimStatusFilter = (v: RefundClaimStatusFilter) => {
    const safe = VALID_REFUND_CLAIM_STATUSES.has(v) ? v : "all";
    _setRefundClaimStatusFilter(safe as RefundClaimStatusFilter);
    try { localStorage.setItem(REFUND_CLAIM_FILTER_KEY, safe); } catch { /* ignore */ }
  };
  // Submitted-but-unreviewed refund claim count drives the Cases nav badge.
  // Mirrors the `refundClaimStatusFilter === 'submitted'` path in CasesTab so
  // the badge clears as soon as an admin approves or rejects the claim.
  // The cast is safe: the server always writes one of the four valid status
  // literals; typing via RefundClaimStatus catches invalid predicate strings
  // at compile time (e.g. accidentally checking === 'pending' is a TS error).
  const refundClaimSubmittedCount = useMemo(
    () => countRefundClaimSubmitted(
      cases.map(c => ({ refundClaimStatus: c.refundClaimStatus }))
    ),
    [cases],
  );
  const withdrawalPendingCount = useMemo(
    () => Object.values(withdrawalPendingCounts).reduce((sum, n) => sum + n, 0),
    [withdrawalPendingCounts],
  );
  const reactivationPendingTotal = useMemo(
    () => Object.values(reactivationPendingCounts).reduce((sum, n) => sum + n, 0),
    [reactivationPendingCounts],
  );
  const [translations, setTranslations] = useState<{id: number; key: string; value: string; locale: string}[]>([]);
  const [selectedLocale, setSelectedLocale] = useState('en');
  const [newTranslationKey, setNewTranslationKey] = useState('');
  const [newTranslationValue, setNewTranslationValue] = useState('');
  // Audit-log retention setting (lets admins tune the sweep window from
  // the dashboard instead of bouncing the server with a new env var).
  const [auditRetention, setAuditRetention] = useState<AuditLogRetentionSetting | null>(null);
  const [isAuditRetentionLoading, setIsAuditRetentionLoading] = useState(false);
  const [isAuditRetentionSaving, setIsAuditRetentionSaving] = useState(false);
  // Community-participant cleanup retention window — same shape as the
  // audit-log retention card so admins can tune it without redeploying.
  const [communityParticipantRetention, setCommunityParticipantRetention] =
    useState<CommunityParticipantRetentionSetting | null>(null);
  const [isCommunityParticipantRetentionLoading, setIsCommunityParticipantRetentionLoading] =
    useState(false);
  const [isCommunityParticipantRetentionSaving, setIsCommunityParticipantRetentionSaving] =
    useState(false);
  const [isCommunityParticipantRetentionRunning, setIsCommunityParticipantRetentionRunning] =
    useState(false);
  const [lastCommunityParticipantRetentionRun, setLastCommunityParticipantRetentionRun] =
    useState<CommunityParticipantCleanupRunResult | null>(null);
  // Wallet-connect alert marker cleanup — on-demand sweep only (no
  // tunable retention window). Mirrors the community-participant "run"
  // control so admins can reclaim orphaned markers without waiting for
  // the hourly background sweep.
  const [
    isWalletConnectAlertMarkerCleanupRunning,
    setIsWalletConnectAlertMarkerCleanupRunning,
  ] = useState(false);
  const [
    lastWalletConnectAlertMarkerCleanupRun,
    setLastWalletConnectAlertMarkerCleanupRun,
  ] = useState<WalletConnectAlertMarkerCleanupRunResult | null>(null);
  const [
    walletConnectAlertMarkerCount,
    setWalletConnectAlertMarkerCount,
  ] = useState<WalletConnectAlertMarkerCountResult | null>(null);
  const [
    isWalletConnectAlertMarkerCountLoading,
    setIsWalletConnectAlertMarkerCountLoading,
  ] = useState(false);
  // Task #842 — on-demand wallet-connect completion backfill (durably writes any
  // missing `wallet_connect_completed` audit rows from the fired markers,
  // normally only run at boot).
  const [
    isWalletConnectCompletionBackfillRunning,
    setIsWalletConnectCompletionBackfillRunning,
  ] = useState(false);
  const [
    lastWalletConnectCompletionBackfillRun,
    setLastWalletConnectCompletionBackfillRun,
  ] = useState<WalletConnectCompletionBackfillRunResult | null>(null);
  const [
    walletConnectCompletionBackfillCount,
    setWalletConnectCompletionBackfillCount,
  ] = useState<WalletConnectCompletionBackfillCountResult | null>(null);
  const [
    isWalletConnectCompletionBackfillCountLoading,
    setIsWalletConnectCompletionBackfillCountLoading,
  ] = useState(false);
  // Wallet-connect alert marker cleanup sweep cadence (stored in ms;
  // presented in minutes). Mirrors the NDA sweep cadence pattern so
  // admins can tune how often orphaned markers are pruned.
  const [
    walletConnectAlertCleanupInterval,
    setWalletConnectAlertCleanupInterval,
  ] = useState<WalletConnectAlertCleanupIntervalSetting | null>(null);
  const [
    isWalletConnectAlertCleanupIntervalLoading,
    setIsWalletConnectAlertCleanupIntervalLoading,
  ] = useState(false);
  const [
    isWalletConnectAlertCleanupIntervalSaving,
    setIsWalletConnectAlertCleanupIntervalSaving,
  ] = useState(false);
  // Community thread-views cleanup (Task #802). Same on-demand-only
  // pattern as the wallet-connect marker sweep — no retention window to
  // configure, just a manual trigger that reports how many stale dedup
  // rows the sweep removed.
  const [
    isCommunityThreadViewsCleanupRunning,
    setIsCommunityThreadViewsCleanupRunning,
  ] = useState(false);
  const [
    lastCommunityThreadViewsCleanupRun,
    setLastCommunityThreadViewsCleanupRun,
  ] = useState<CommunityThreadViewsCleanupRunResult | null>(null);
  // Stale-row count for the thread-views card (Task #836). null = not yet
  // fetched or loading; 'unavailable' = the count query failed server-side.
  const [
    communityThreadViewsStaleCount,
    setCommunityThreadViewsStaleCount,
  ] = useState<number | null | 'unavailable'>(null);
  const [
    isCommunityThreadViewsStaleCountLoading,
    setIsCommunityThreadViewsStaleCountLoading,
  ] = useState(false);
  // Sealed-NDA integrity sweep cadence (hours). Mirrors the audit
  // retention pattern so admins can tighten the cadence after a
  // tampering incident without redeploying the server.
  const [ndaSweepInterval, setNdaSweepInterval] = useState<NdaIntegritySweepIntervalSetting | null>(null);
  const [isNdaSweepIntervalLoading, setIsNdaSweepIntervalLoading] = useState(false);
  const [isNdaSweepIntervalSaving, setIsNdaSweepIntervalSaving] = useState(false);
  // Stale-sweep watchdog grace window (hours). Same env > DB > default
  // precedence as the cadence above. Lets ops dial up sensitivity right
  // after a tampering incident, or loosen it when running an
  // intentionally slow cadence.
  const [ndaSweepStaleGrace, setNdaSweepStaleGrace] = useState<NdaIntegritySweepStaleGraceSetting | null>(null);
  const [isNdaSweepStaleGraceLoading, setIsNdaSweepStaleGraceLoading] = useState(false);
  const [isNdaSweepStaleGraceSaving, setIsNdaSweepStaleGraceSaving] = useState(false);
  // Email-failure alert cooldown (Task #152). Same env > DB > default
  // pattern as the NDA sweep cadence. The dispatcher reads the value
  // at send time so admin changes take effect on the next failure.
  const [emailFailureAlertCooldown, setEmailFailureAlertCooldown] =
    useState<EmailFailureAlertCooldownSetting | null>(null);
  const [isEmailFailureAlertCooldownLoading, setIsEmailFailureAlertCooldownLoading] =
    useState(false);
  const [isEmailFailureAlertCooldownSaving, setIsEmailFailureAlertCooldownSaving] =
    useState(false);
  const [tamperAlertEmail, setTamperAlertEmail] = useState<TamperAlertEmailSetting | null>(null);
  const [isTamperAlertEmailLoading, setIsTamperAlertEmailLoading] = useState(false);
  const [isTamperAlertEmailSaving, setIsTamperAlertEmailSaving] = useState(false);
  const [isTamperAlertEmailTesting, setIsTamperAlertEmailTesting] = useState(false);
  const [documentUploadAlertEmail, setDocumentUploadAlertEmail] = useState<DocumentUploadAlertEmailSetting | null>(null);
  const [isDocumentUploadAlertEmailLoading, setIsDocumentUploadAlertEmailLoading] = useState(false);
  const [isDocumentUploadAlertEmailSaving, setIsDocumentUploadAlertEmailSaving] = useState(false);
  const [isDocumentUploadAlertEmailTesting, setIsDocumentUploadAlertEmailTesting] = useState(false);
  const [docUploadAlertCooldown, setDocUploadAlertCooldown] = useState<DocUploadAlertCooldownSetting | null>(null);
  const [isDocUploadAlertCooldownLoading, setIsDocUploadAlertCooldownLoading] = useState(false);
  const [isDocUploadAlertCooldownSaving, setIsDocUploadAlertCooldownSaving] = useState(false);
  // Task #379 — per-case mute for the document upload alert. A
  // dashboard-wide set (refreshed every 30s) drives the "Muted" badges
  // in the Cases list and the All Receipts inbox; `alertMuteSaving`
  // tracks the in-flight toggle inside the case-detail dialog.
  const [mutedAlertCaseIds, setMutedAlertCaseIds] = useState<Set<string>>(new Set());
  const [isAlertMuteSaving, setIsAlertMuteSaving] = useState(false);
  // Task #492 — per-case mute for the wallet-connect alert. Mirrors
  // mutedAlertCaseIds above; refreshed every 30s alongside it.
  const [mutedWalletAlertCaseIds, setMutedWalletAlertCaseIds] = useState<Set<string>>(new Set());
  const [isWalletAlertMuteSaving, setIsWalletAlertMuteSaving] = useState(false);
  // Stale-sweep watchdog state — drives the staleness banner in the
  // Tamper Alert Recipient panel. The server-side watchdog tick fires
  // the actual email; this is a read-only mirror so admins can see the
  // condition without opening the audit log.
  const [ndaSweepStaleness, setNdaSweepStaleness] =
    useState<NdaIntegritySweepStaleness | null>(null);
  const [isNdaSweepStalenessLoading, setIsNdaSweepStalenessLoading] =
    useState(false);
  // "All clear" heartbeat cadence for the sealed-NDA integrity sweep.
  // Mirrors the interval setting above so non-technical operators can
  // dial summary noise up or down without touching env vars.
  const [ndaSweepSummaryFrequency, setNdaSweepSummaryFrequency] =
    useState<NdaIntegritySweepSummaryFrequencySetting | null>(null);
  const [isNdaSweepSummaryFrequencyLoading, setIsNdaSweepSummaryFrequencyLoading] =
    useState(false);
  const [isNdaSweepSummaryFrequencySaving, setIsNdaSweepSummaryFrequencySaving] =
    useState(false);
  
  // Settings view state
  const [settingsView, setSettingsView] = useState<SettingsView>('main');
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationBellRef = useRef<HTMLDivElement>(null);
  const notificationPanelRef = useRef<HTMLDivElement>(null);
  const [notificationPanelPos, setNotificationPanelPos] = useState<{ top: number; right: number; width: number; maxHeight: number } | null>(null);

  useEffect(() => {
    if (!isNotificationsOpen) { setNotificationPanelPos(null); return; }
    const MARGIN = 8;
    const MAX_PANEL_WIDTH = 320; // w-80 ideal width
    const compute = () => {
      const rect = notificationBellRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Shrink the panel if the viewport is narrower than the ideal width + margins
      const panelWidth = Math.min(MAX_PANEL_WIDTH, window.innerWidth - 2 * MARGIN);
      // Align right edge of panel with right edge of bell; clamp so panel stays within viewport
      const rawRight = window.innerWidth - rect.right;
      const clampedRight = Math.max(MARGIN, Math.min(rawRight, window.innerWidth - panelWidth - MARGIN));
      // Clamp top so panel never overflows the bottom of the viewport
      const rawTop = rect.bottom + MARGIN;
      const maxHeight = Math.max(MARGIN, window.innerHeight - rawTop - MARGIN);
      setNotificationPanelPos({ top: rawTop, right: clampedRight, width: panelWidth, maxHeight });
    };
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [isNotificationsOpen]);
  
  // New scheduled message form
  const [newScheduledMessage, setNewScheduledMessage] = useState({
    caseId: '',
    messageType: 'admin_message' as 'chat' | 'admin_message' | 'letter',
    category: 'processing',
    title: '',
    content: '',
    scheduledFor: ''
  });
  
  // New message template form
  const [newMessageTemplate, setNewMessageTemplate] = useState({
    name: '',
    content: '',
    category: 'general'
  });
  
  // New help article form
  const [newHelpArticle, setNewHelpArticle] = useState({
    title: '',
    content: '',
    category: 'general',
    isPublished: false
  });
  
  // New document request form. `category` is an optional routing hint
  // used by the financial-signatory flow (Task #140) — the server stores
  // it only in the audit log; documentType remains the human-readable label.
  const [newDocumentRequest, setNewDocumentRequest] = useState<{
    caseId: string;
    documentType: string;
    description: string;
    deadline: string;
    category?: string;
  }>({
    caseId: '',
    documentType: '',
    description: '',
    deadline: ''
  });
  
  // Filtered cases based on search and status filter
  const filteredCases = useMemo(() => {
    return cases.filter(c => {
      const matchesSearch = searchQuery === "" || 
        c.id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.accessCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.userName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.userEmail?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;

      const caseLocale = (c.preferredLocale ?? "").trim().toLowerCase();
      const matchesLocale =
        localeFilter === "all" ||
        (localeFilter === "__none__"
          ? caseLocale === ""
          : caseLocale === localeFilter.toLowerCase());

      return matchesSearch && matchesStatus && matchesLocale;
    });
  }, [cases, searchQuery, statusFilter, localeFilter]);
  
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation("admin");

  // Check if a passkey is registered so we can show the biometric button
  useEffect(() => {
    if (isLoggedIn) return;
    fetch('/api/webauthn/status')
      .then(r => r.ok ? r.json() : { available: false })
      .then(d => setBiometricAvailable(!!d.available))
      .catch(() => {});
  }, [isLoggedIn]);

  const handleBiometricLogin = async () => {
    setIsBiometricLoading(true);
    setLoginError(null);
    try {
      const optRes = await fetch('/api/webauthn/authentication/options', { method: 'POST' });
      if (!optRes.ok) throw new Error('Failed to get authentication challenge');
      const { options, sessionKey } = await optRes.json();

      const { startAuthentication } = await import('@simplewebauthn/browser');
      const authResponse = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch('/api/webauthn/authentication/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey, authentication: authResponse }),
      });

      if (verifyRes.ok) {
        const { token } = await verifyRes.json();
        sessionStorage.setItem('adminToken', token);
        setAuthToken(token);
        setIsLoggedIn(true);
        toast({ title: t("toasts.accessGranted.title"), description: t("toasts.accessGranted.description") });
      } else {
        const data = await verifyRes.json().catch(() => ({}));
        toast({ variant: 'destructive', title: 'Biometric Failed', description: data.error ?? 'Authentication failed' });
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'NotAllowedError') {
        toast({ variant: 'destructive', title: 'Biometric Error', description: err.message });
      }
    } finally {
      setIsBiometricLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const body: Record<string, string> = {
        username: loginUsername,
        password: loginPassword,
      };
      if (loginRequires2FA && loginTotpCode) {
        body.totpCode = loginTotpCode.replace(/\s/g, "");
      }

      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        // Store token in sessionStorage FIRST before state updates
        sessionStorage.setItem('adminToken', data.token);
        setAuthToken(data.token);
        setIsLoggedIn(true);
        setLoginRequires2FA(false);
        setLoginTotpCode("");
        // Fetch role after login so the stage-sequence guard UI is correct.
        fetch('/api/admin/verify', { headers: { 'Authorization': `Bearer ${data.token}` } })
          .then(async r => { if (r.ok) { const v = await r.json().catch(() => ({})); if (v.role) setCurrentAdminRole(v.role); } })
          .catch(() => {});
        toast({ title: t("toasts.accessGranted.title"), description: t("toasts.accessGranted.description") });
      } else {
        const data = await response.json().catch(() => ({}));
        const serverBlock = getAdminLoginErrorMessage({ status: response.status, body: data });
        if (serverBlock) {
          // 503: server refused the login for an operator-facing reason
          // (e.g. ADMIN_PASSWORD too weak). Surface the specific message
          // directly on the form so the operator can act on it without
          // having to inspect server logs.
          setLoginRequires2FA(false);
          setLoginTotpCode("");
          setLoginError(serverBlock);
        } else if (data?.requiresTwoFactor) {
          // Password was correct — prompt for the authenticator code.
          setLoginRequires2FA(true);
          setLoginTotpCode("");
        } else {
          // Reset 2FA step on a hard credential failure so the user
          // can re-enter their password from scratch.
          setLoginRequires2FA(false);
          setLoginTotpCode("");
          toast({ variant: "destructive", title: t("toasts.accessDenied.title"), description: t("toasts.accessDenied.description") });
        }
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.connectionError.title"), description: t("toasts.connectionError.description") });
    }
    
    setIsLoggingIn(false);
  };

  const handleLogout = async () => {
    // Revoke server-side first so the token can't be reused. We still clear
    // local state even if the network call fails — a stale local token is
    // worse than a stale server row, which the cleanup job will reap anyway.
    const tokenToRevoke = authToken || sessionStorage.getItem('adminToken');
    if (tokenToRevoke) {
      try {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokenToRevoke}` },
        });
      } catch (err) {
        console.error('Failed to revoke admin session on logout:', err);
      }
    }
    setIsLoggedIn(false);
    setAuthToken(null);
    setLoginUsername("");
    setLoginPassword("");
    sessionStorage.removeItem('adminToken');
    toast({ title: t("toasts.loggedOut.title"), description: t("toasts.loggedOut.description") });
  };

  // Check for existing session on mount
  useEffect(() => {
    const storedToken = sessionStorage.getItem('adminToken');
    if (storedToken) {
      fetch('/api/admin/verify', {
        headers: { 'Authorization': `Bearer ${storedToken}` }
      }).then(async res => {
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.role) setCurrentAdminRole(data.role);
          setAuthToken(storedToken);
          setIsLoggedIn(true);
        } else {
          sessionStorage.removeItem('adminToken');
        }
      }).catch(() => {
        sessionStorage.removeItem('adminToken');
      });
    }
  }, []);

  // Fetch password-override status on mount so the login page can warn
  // operators that the ADMIN_PASSWORD env var is currently being bypassed.
  // This is a public endpoint — no credentials required.
  useEffect(() => {
    if (isLoggedIn) return;
    fetch('/api/admin/public/password-override-active')
      .then(res => (res.ok ? res.json() : null))
      .then((data: { active: boolean } | null) => {
        if (data) setPasswordOverrideActive(data.active);
      })
      .catch(() => { /* advisory only — ignore network errors */ });
  }, [isLoggedIn]);

  // Fetch the live build identifier once we have an authenticated
  // session, and re-poll periodically / when the tab regains focus so
  // that an admin who left a tab open across a deploy can be warned
  // that their loaded bundle is older than what's now serving.
  useEffect(() => {
    if (!isLoggedIn || !authToken) {
      setBuildInfo(null);
      return;
    }
    let cancelled = false;
    const fetchOnce = () => {
      fetch('/api/admin/build-info', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      })
        .then(res => (res.ok ? res.json() : null))
        .then((data: BuildInfo | null) => {
          if (!cancelled && data) setBuildInfo(data);
        })
        .catch(() => { /* non-critical — header just won't show the badge */ });
    };
    fetchOnce();
    const intervalId = window.setInterval(fetchOnce, 5 * 60 * 1000);
    const onFocus = () => {
      if (document.visibilityState === 'visible') fetchOnce();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [isLoggedIn, authToken]);

  // Fetch server-side security flags on login and whenever the tab regains
  // focus (visibilitychange / focus). The flags are static per process, but
  // re-fetching on focus lets the banner react to a re-deploy that changes
  // them without requiring a manual page reload.
  useEffect(() => {
    if (!isLoggedIn || !authToken) {
      setSecurityFlags(null);
      return;
    }
    let cancelled = false;
    const fetchFlags = () => {
      fetch('/api/admin/security-flags', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      })
        .then(res => (res.ok ? res.json() : null))
        .then((data: { weakAdminPasswordAllowed: boolean; weakAdminUsernameAllowed: boolean; weakSessionSecretAllowed: boolean; isProduction: boolean; weakPassword: boolean } | null) => {
          if (!cancelled && data) setSecurityFlags(data);
        })
        .catch(() => { /* non-critical — banner just won't show */ });
    };
    fetchFlags();
    // Only re-fetch when the tab transitions from hidden → visible.
    // A bare window focus (user clicks within the same tab or switches back
    // from another app without the tab ever being hidden) must NOT trigger a
    // spurious round-trip.
    let wasHidden = false;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden = true;
      } else if (document.visibilityState === 'visible' && wasHidden) {
        wasHidden = false;
        fetchFlags();
      }
    };
    const onFocus = () => {
      if (wasHidden && document.visibilityState === 'visible') {
        wasHidden = false;
        fetchFlags();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isLoggedIn, authToken]);

  // The bundle the admin loaded carries the build stamp it was compiled
  // against (VITE_SENTRY_RELEASE, see client/src/main.tsx). When the
  // live server reports a different stamp, the loaded JS is stale.
  const clientBuildStamp = (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) ?? null;
  const isStaleBuild = Boolean(
    buildInfo &&
    clientBuildStamp &&
    buildInfo.buildStamp !== clientBuildStamp,
  );
  const showStaleBanner =
    isStaleBuild && buildInfo?.buildStamp !== dismissedStaleStamp;

  const dismissStaleBanner = () => {
    if (!buildInfo) return;
    try {
      sessionStorage.setItem('adminStaleDismissedStamp', buildInfo.buildStamp);
    } catch { /* sessionStorage may be unavailable; in-memory dismissal still works */ }
    setDismissedStaleStamp(buildInfo.buildStamp);
  };

  // Auto-logout disabled - admin stays logged in

  const loadData = async (showToast = false) => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const headers = { 'Authorization': `Bearer ${token}` };
      const [casesRes, submissionsRes] = await Promise.all([
        fetch('/api/cases', { headers }),
        fetch('/api/submissions', { headers })
      ]);
      
      if (casesRes.ok) {
        const data = await casesRes.json();
        
        // Check for accounts needing authorization (syncing status)
        const syncingCases = data.filter((c: Case) => c.status === 'syncing');
        const currentSyncingCount = syncingCases.length;
        
        if (!isInitialDataLoadRef.current && currentSyncingCount > lastSyncingCountRef.current) {
          const newCount = currentSyncingCount - lastSyncingCountRef.current;
          const newCase = syncingCases[syncingCases.length - 1];
          playNotificationSound();
          toast({ 
            title: t("toasts.accountNeedsAuth.title"), 
            description: t("toasts.accountNeedsAuth.description", { name: newCase?.userName || 'A user', extra: newCount > 1 ? ` (+${newCount} total)` : '' })
          });
        }
        lastSyncingCountRef.current = currentSyncingCount;
        
        // Check for new registrations
        const registeredCases = data.filter((c: Case) => c.status !== 'created');
        const currentRegisteredCount = registeredCases.length;
        
        if (!isInitialDataLoadRef.current && currentRegisteredCount > lastRegisteredCountRef.current) {
          const newCount = currentRegisteredCount - lastRegisteredCountRef.current;
          const newCase = registeredCases[registeredCases.length - 1];
          playNotificationSound();
          toast({ 
            title: t("toasts.newUserRegistered.title"), 
            description: t("toasts.newUserRegistered.description", { name: newCase?.userName || 'A user', extra: newCount > 1 ? ` (+${newCount} total)` : '' })
          });
        }
        lastRegisteredCountRef.current = currentRegisteredCount;
        
        setCases(data);
      }
      
      if (submissionsRes.ok) {
        const data = await submissionsRes.json();
        
        // Check for new submissions
        const currentSubmissionsCount = data.length;
        
        if (!isInitialDataLoadRef.current && currentSubmissionsCount > lastSubmissionsCountRef.current) {
          const newCount = currentSubmissionsCount - lastSubmissionsCountRef.current;
          const newSubmission = data[data.length - 1];
          playNotificationSound();
          toast({ 
            title: t("toasts.newSubmission.title"), 
            description: t("toasts.newSubmission.description", { option: newSubmission?.selectedOption || '', extra: newCount > 1 ? ` (+${newCount} total)` : '' })
          });
        }
        lastSubmissionsCountRef.current = currentSubmissionsCount;
        
        setAllSubmissions(data);
      }
      
      // Mark initial data load complete
      if (isInitialDataLoadRef.current) {
        isInitialDataLoadRef.current = false;
      }
      
      if (showToast) {
        toast({ title: t("toasts.refreshed.title"), description: t("toasts.refreshed.description") });
      }
    } catch (_e) {
      if (showToast) {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.refreshFailed.description") });
      }
    } finally {
      setIsDataLoading(false);
    }
  };

  // One-shot trigger: when the admin first lands on the dashboard and
  // cases finish loading, fetch every case's regulatory document
  // requests so the global Documents tab is populated without forcing
  // a manual Refresh. Re-loads after create/approve/reject still go
  // through the existing handlers.
  const documentRequestsHydratedRef = useRef(false);
  useEffect(() => {
    if (isLoggedIn && cases.length > 0 && !documentRequestsHydratedRef.current) {
      documentRequestsHydratedRef.current = true;
      loadDocumentRequests();
    }
  }, [isLoggedIn, cases.length]);

  useEffect(() => {
    if (isLoggedIn) {
      loadData();
      loadChatTemplates();
      // Pull failed-login telemetry on login and every 60s so the Settings
      // overview tile reflects the current 24h count without having to open
      // the panel first.
      loadFailedLogins();
      loadFailedLoginsByIp();
      loadDeclarationReadAttempts();
      loadDeclarationReadByIp();
      loadNdaIntegritySweep();
      loadEmailDeliveryAlerts();
      loadActiveWarnings();
      loadEmergencyResetActivity();
      const interval = setInterval(loadData, 3000);
      // Re-poll the nightly NDA integrity sweep summary every 5 minutes so
      // the global tamper banner appears within a few minutes of the daily
      // sweep firing, without thrashing the admin DB.
      const ndaIntegritySweepInterval = setInterval(loadNdaIntegritySweep, 5 * 60 * 1000);
      // Re-poll the email-delivery alert rollup every 30s so a stuck
      // SMTP provider surfaces within seconds rather than the 20s
      // per-row badge polling cycle (Task #150).
      const emailDeliveryAlertsInterval = setInterval(loadEmailDeliveryAlerts, 30 * 1000);
      // Re-poll active warnings every 30s so the Communications nav badge
      // and near-expiry toasts stay current from any tab.
      const activeWarningsInterval = setInterval(loadActiveWarnings, 30 * 1000);
      // Document-request polling and cross-tab sync are managed by
      // useCrossTabSync (called below, after fetchDocumentRequestsData is
      // declared).  The hook handles leader election, polling, and
      // BroadcastChannel distribution so only one tab polls the server per
      // interval — no interval or visibilitychange listener needed here.
      // Task #379 — keep the muted-alert set fresh so the "Muted" badges
      // stay accurate without a manual refresh.
      loadMutedAlertCases();
      loadMutedWalletAlertCases();
      const mutedAlertCasesInterval = setInterval(() => {
        loadMutedAlertCases();
        loadMutedWalletAlertCases();
      }, 30 * 1000);
      const failedLoginsInterval = setInterval(() => {
        loadFailedLogins();
        loadFailedLoginsByIp();
        loadDeclarationReadAttempts();
        loadDeclarationReadByIp();
        loadEmergencyResetActivity();
      }, 60000);
      return () => {
        clearInterval(interval);
        clearInterval(mutedAlertCasesInterval);
        clearInterval(failedLoginsInterval);
        clearInterval(ndaIntegritySweepInterval);
        clearInterval(emailDeliveryAlertsInterval);
        clearInterval(activeWarningsInterval);
      };
    }
  }, [isLoggedIn]);

  // ── Visitor arrival sound ──────────────────────────────────────────────────
  // Poll /api/visitors/active every 15 s. When the active count rises above the
  // last-known value, play the doorbell tone and show a toast so the admin is
  // immediately alerted that someone is browsing the site.
  useEffect(() => {
    if (!isLoggedIn || !authToken) return;
    const pollVisitors = async () => {
      try {
        const res = await fetch('/api/visitors/active', {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (!res.ok) return;
        const data: unknown[] = await res.json();
        const count = Array.isArray(data) ? data.length : 0;
        if (!isInitialVisitorLoadRef.current && count > lastVisitorCountRef.current && lastVisitorCountRef.current >= 0) {
          void playNotificationSound('visitor');
          toast({
            title: '👤 New visitor on site',
            description: `${count} visitor${count !== 1 ? 's' : ''} currently active`,
          });
        }
        lastVisitorCountRef.current = count;
        isInitialVisitorLoadRef.current = false;
      } catch {
        // silent — don't spam on network errors
      }
    };
    pollVisitors();
    const visitorInterval = setInterval(pollVisitors, 15_000);
    return () => clearInterval(visitorInterval);
  }, [isLoggedIn, authToken]);

  // ── Pending receipt upload sound ───────────────────────────────────────────
  // Poll /api/deposits/all-receipts every 12 s. When the count of receipts with
  // status 'pending' rises, play the urgent receipt tone so the admin knows a
  // user has submitted a payment and is waiting for review.
  useEffect(() => {
    if (!isLoggedIn || !authToken) return;
    const pollPendingReceipts = async () => {
      try {
        const res = await fetch('/api/deposits/all-receipts', {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (!res.ok) return;
        const data: { status?: string; alertMuted?: boolean }[] = await res.json();
        const pendingCount = Array.isArray(data)
          ? data.filter(r => r.status === 'pending' && !r.alertMuted).length
          : 0;
        if (!isInitialReceiptLoadRef.current && pendingCount > lastPendingReceiptCountRef.current && lastPendingReceiptCountRef.current >= 0) {
          void playNotificationSound('receipt');
          toast({
            title: '🧾 New receipt awaiting review',
            description: `${pendingCount} pending receipt${pendingCount !== 1 ? 's' : ''} need${pendingCount === 1 ? 's' : ''} approval`,
          });
        }
        lastPendingReceiptCountRef.current = pendingCount;
        isInitialReceiptLoadRef.current = false;
      } catch {
        // silent
      }
    };
    pollPendingReceipts();
    const receiptInterval = setInterval(pollPendingReceipts, 12_000);
    return () => clearInterval(receiptInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, authToken]);

  // ── Reactivation receipt alert ──────────────────────────────────────────────
  // Poll /api/deposits/all-receipts?category=reactivation&status=pending every
  // 12 s (same cadence as general receipts). When the count of pending
  // reactivation receipts rises, play the urgent receipt tone and show a
  // dedicated toast so admins can prioritise suspended-account cases above
  // routine activation uploads.
  useEffect(() => {
    if (!isLoggedIn || !authToken) return;
    const pollReactivationReceipts = async () => {
      try {
        const res = await fetch('/api/deposits/all-receipts?category=reactivation&status=pending', {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (!res.ok) return;
        const data: { alertMuted?: boolean }[] = await res.json();
        const count = Array.isArray(data)
          ? data.filter((r) => !r.alertMuted).length
          : 0;
        if (
          !isInitialReactivationLoadRef.current &&
          count > lastPendingReactivationCountRef.current &&
          lastPendingReactivationCountRef.current >= 0
        ) {
          void playNotificationSound('receipt');
          toast({
            title: '🔓 Reactivation receipt received',
            description: `${count} pending reactivation receipt${count !== 1 ? 's' : ''} from suspended account${count !== 1 ? 's' : ''} awaiting review`,
          });
        }
        lastPendingReactivationCountRef.current = count;
        isInitialReactivationLoadRef.current = false;
      } catch {
        // silent
      }
    };
    pollReactivationReceipts();
    const reactivationInterval = setInterval(pollReactivationReceipts, 12_000);
    return () => clearInterval(reactivationInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, authToken]);

  // Latest nightly NDA integrity sweep summary. Powers the top-of-dashboard
  // tamper banner: "N sealed cases failed last integrity sweep". Falls
  // through quietly on auth/network errors so a transient issue doesn't
  // wipe a previously-loaded failure count from the UI.
  const loadNdaIntegritySweep = async () => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      if (!token) return;
      const res = await fetch('/api/admin/nda-integrity-sweep', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setNdaIntegritySweep(data);
    } catch {
      // Best-effort poll; keep last known state on failure.
    }
  };

  // Active portal-warnings badge: fetches the count from /api/cases/active-warnings
  // every 30s so the Communications nav item shows a live count visible from
  // every tab. Also fires a one-shot toast the first time any warning enters
  // the near-expiry window (≤1h remaining) during the admin session.
  const NEAR_EXPIRY_MS = 60 * 60 * 1000;
  const loadActiveWarnings = async () => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      if (!token) return;
      const res = await fetch('/api/cases/active-warnings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: { count: number; cases: Array<{ id: number; msLeft: number; userName: string; accessCode: string }> } = await res.json();
      setActiveWarningsCount(data.count);
      // Near-expiry toast: fire once per case ID per session
      for (const w of data.cases) {
        if (w.msLeft > 0 && w.msLeft <= NEAR_EXPIRY_MS && !nearExpiryToastedIdsRef.current.has(w.id)) {
          nearExpiryToastedIdsRef.current.add(w.id);
          try {
            sessionStorage.setItem('ibccf.admin.nearExpiryToasted', JSON.stringify([...nearExpiryToastedIdsRef.current]));
          } catch {
            // best-effort; ignore quota/security errors
          }
          toast({
            title: "Portal Warning Expiring Soon",
            description: `Warning for ${w.userName} (${w.accessCode}) expires in less than 1 hour.`,
            variant: "destructive",
          });
        }
      }
    } catch {
      // Best-effort; keep last-known count on failure.
    }
  };

  // Cross-case rollup of transactional-email failures in the last hour
  // (Task #150). Best-effort: a transient error leaves the last-known
  // state in place so a momentary 5xx doesn't wipe an active alert.
  const loadEmailDeliveryAlerts = async () => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      if (!token) return;
      const res = await fetch('/api/cases/email-delivery-alerts?windowMinutes=60', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setEmailDeliveryAlerts(data);
    } catch {
      // Best-effort poll; keep last known state on failure.
    }
  };

  const reRunNdaIntegritySweep = async () => {
    setIsReRunningNdaSweep(true);
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      if (!token) return;
      const res = await fetch('/api/admin/nda-integrity-sweep/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setNdaIntegritySweep(data);
        setDismissedNdaSweepFinishedAt(null);
        toast({
          title: 'Integrity sweep complete',
          description:
            data.failed > 0
              ? `${data.failed} of ${data.total} sealed case(s) failed verification.`
              : `${data.verified} of ${data.total} sealed case(s) verified clean.`,
          variant: data.failed > 0 ? 'destructive' : 'default',
        });
      }
    } catch {
      // Toast suppressed on transient failure — the next 5-minute poll
      // will refresh the banner.
    } finally {
      setIsReRunningNdaSweep(false);
    }
  };

  // Load chat templates
  const loadChatTemplates = async () => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const res = await fetch('/api/chat-templates', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const templates = await res.json();
        setChatTemplates(templates);
      }
    } catch (error) {
      console.error('Failed to load chat templates:', error);
    }
  };

  // Create chat template
  const createChatTemplate = async () => {
    if (!newTemplate.name.trim() || !newTemplate.content.trim()) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Name and content are required" });
      return;
    }
    try {
      const res = await fetch('/api/chat-templates', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(newTemplate)
      });
      if (res.ok) {
        toast({ title: t("toasts.templateCreated.title"), description: t("toasts.templateCreated.description") });
        setNewTemplate({ name: '', content: '', category: '' });
        loadChatTemplates();
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to create template" });
    }
  };

  // Delete chat template
  const deleteChatTemplate = async (id: number) => {
    try {
      await fetch(`/api/chat-templates/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      toast({ title: t("toasts.deleted.title"), description: t("toasts.templateRemoved.description") });
      loadChatTemplates();
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to delete template" });
    }
  };

  // Use template (insert into message)
  const useTemplate = async (template: ChatTemplate) => {
    setNewMessage(template.content);
    setShowTemplateDropdown(false);
    // Increment usage count
    try {
      await fetch(`/api/chat-templates/${template.id}/use`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
    } catch (error) {
      console.error('Failed to increment template usage:', error);
    }
  };

  // Load case notes
  const loadCaseNotes = async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/notes`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const notes = await res.json();
        setCaseNotes(notes);
      }
    } catch (error) {
      console.error('Failed to load case notes:', error);
    }
  };

  // Create case note
  const createCaseNote = async (caseId: string) => {
    if (!newNoteContent.trim()) return;
    setIsAddingNote(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/notes`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          content: newNoteContent,
          adminUsername: 'Admin2025'
        })
      });
      if (res.ok) {
        toast({ title: t("toasts.noteAdded.title"), description: t("toasts.noteAdded.description") });
        setNewNoteContent('');
        loadCaseNotes(caseId);
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to add note" });
    } finally {
      setIsAddingNote(false);
    }
  };

  // Delete case note
  const deleteCaseNote = async (noteId: number, caseId: string) => {
    try {
      await fetch(`/api/case-notes/${noteId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      toast({ title: t("toasts.deleted.title"), description: t("toasts.noteRemoved.description") });
      loadCaseNotes(caseId);
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to delete note" });
    }
  };

  // Toggle note pin
  const toggleNotePin = async (noteId: number, caseId: string) => {
    try {
      await fetch(`/api/case-notes/${noteId}/toggle-pin`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      loadCaseNotes(caseId);
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to toggle pin" });
    }
  };

  // ==================== ENTERPRISE FEATURES API FUNCTIONS ====================

  // Load audit logs
  const loadAuditLogs = async () => {
    try {
      const res = await fetch('/api/audit-logs', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const logs = await res.json();
        setAuditLogs(logs);
      }
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    }
  };

  // Emergency-reset ("Locked out?") activity — Task #2403.
  const loadEmergencyResetActivity = async () => {
    try {
      const res = await fetch('/api/admin/emergency-reset-activity', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) setEmergencyResetActivity(await res.json());
    } catch (error) {
      console.error('Failed to load emergency reset activity:', error);
    }
  };

  // Load recent failed admin sign-in attempts plus the 24h count for the
  // Settings overview tile.
  const loadFailedLogins = async () => {
    try {
      const res = await fetch('/api/audit-logs/failed-logins?limit=20', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setFailedLogins(Array.isArray(data?.items) ? data.items : []);
        setFailedLoginCount24h(typeof data?.count24h === 'number' ? data.count24h : 0);
      }
    } catch (error) {
      console.error('Failed to load failed login attempts:', error);
    }
  };

  // Load failed sign-ins rolled up by source IP. Powers the "By IP" tab in
  // the Settings → Failed sign-ins panel so a brute-force burst from one IP
  // collapses into a single highlighted row instead of N separate entries.
  const loadFailedLoginsByIp = async () => {
    try {
      const res = await fetch('/api/audit-logs/failed-logins/by-ip?windowHours=24', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setFailedLoginsByIp(Array.isArray(data?.items) ? data.items : []);
        setFailedLoginsByIpWindowHours(
          typeof data?.windowHours === 'number' ? data.windowHours : 24
        );
      }
    } catch (error) {
      console.error('Failed to load failed-login by-IP rollup:', error);
    }
  };

  // Recent unauthorized declaration-read attempts (Task #109 audit feed)
  // — same shape as the failed-logins endpoint so the dashboard can
  // mirror that UI pattern. Powers both the Settings tile badge and the
  // chronological / by-IP detail tabs.
  const loadDeclarationReadAttempts = async () => {
    try {
      const res = await fetch(
        '/api/audit-logs/declaration-read-attempts?limit=20',
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      if (res.ok) {
        const data = await res.json();
        setDeclarationReadAttempts(
          Array.isArray(data?.items) ? data.items : [],
        );
        setDeclarationReadCount24h(
          typeof data?.count24h === 'number' ? data.count24h : 0,
        );
      }
    } catch (error) {
      console.error('Failed to load declaration-read attempts:', error);
    }
  };

  const loadDeclarationReadByIp = async () => {
    try {
      const res = await fetch(
        '/api/audit-logs/declaration-read-attempts/by-ip?windowHours=24',
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      if (res.ok) {
        const data = await res.json();
        setDeclarationReadByIp(Array.isArray(data?.items) ? data.items : []);
        setDeclarationReadByIpWindowHours(
          typeof data?.windowHours === 'number' ? data.windowHours : 24,
        );
      }
    } catch (error) {
      console.error('Failed to load declaration-read by-IP rollup:', error);
    }
  };

  // Load the current audit-log retention window so admins can view it in
  // the Settings tab. The endpoint returns the effective value plus the
  // bounds and whether an env-var override is currently in effect.
  const loadAuditRetention = async () => {
    setIsAuditRetentionLoading(true);
    try {
      const res = await fetch('/api/admin/settings/audit-log-retention', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAuditRetention(data as AuditLogRetentionSetting);
      }
    } catch (error) {
      console.error('Failed to load audit-log retention setting:', error);
    } finally {
      setIsAuditRetentionLoading(false);
    }
  };

  // Persist a new retention window. The server validates bounds and
  // kicks off an immediate sweep so the new value takes effect within
  // seconds rather than waiting for the next hourly tick.
  const saveAuditRetention = async (days: number) => {
    setIsAuditRetentionSaving(true);
    try {
      const res = await fetch('/api/admin/settings/audit-log-retention', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ days }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || 'Failed to update retention');
      }
      setAuditRetention(data as AuditLogRetentionSetting);
      toast({
        title: 'Retention updated',
        description: `Audit logs will now be kept for ${(data as AuditLogRetentionSetting).days} day(s).`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update retention';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsAuditRetentionSaving(false);
    }
  };

  // Load the current community-participant cleanup retention window so
  // admins can view it in the Settings tab. Same endpoint shape as the
  // audit-log retention card.
  const loadCommunityParticipantRetention = async (
    options: { previewDays?: number } = {},
  ) => {
    setIsCommunityParticipantRetentionLoading(true);
    try {
      // Task #130 — when the SettingsTab passes a draft value we forward
      // it as `?previewDays=` so the response includes a hypothetical
      // count alongside the live one. Plain loads omit the param.
      const url =
        typeof options.previewDays === 'number' && Number.isFinite(options.previewDays)
          ? `/api/admin/settings/community-participant-retention?previewDays=${encodeURIComponent(options.previewDays)}`
          : '/api/admin/settings/community-participant-retention';
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCommunityParticipantRetention(data as CommunityParticipantRetentionSetting);
      }
    } catch (error) {
      console.error('Failed to load community-participant retention setting:', error);
    } finally {
      setIsCommunityParticipantRetentionLoading(false);
    }
  };

  // Persist a new retention window for the community-participant sweep.
  // The server validates bounds and refreshes its cached value; the
  // next hourly tick (or an on-demand run) honors the new window.
  const saveCommunityParticipantRetention = async (days: number) => {
    setIsCommunityParticipantRetentionSaving(true);
    try {
      const res = await fetch('/api/admin/settings/community-participant-retention', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ days }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || 'Failed to update retention');
      }
      setCommunityParticipantRetention(data as CommunityParticipantRetentionSetting);
      toast({
        title: 'Retention updated',
        description: `Community participants will now be kept for ${(data as CommunityParticipantRetentionSetting).days} day(s) past case closure.`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update retention';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsCommunityParticipantRetentionSaving(false);
    }
  };

  // Trigger the cleanup sweep on demand so admins can verify the
  // configured window or reclaim space immediately after a retention
  // change instead of waiting up to an hour for the next tick.
  const runCommunityParticipantRetention = async () => {
    setIsCommunityParticipantRetentionRunning(true);
    try {
      const res = await fetch('/api/admin/settings/community-participant-retention/run', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || 'Failed to run cleanup');
      }
      const result = data as CommunityParticipantCleanupRunResult;
      setLastCommunityParticipantRetentionRun(result);
      toast({
        title: result.skipped ? 'Cleanup already running' : 'Cleanup complete',
        description: result.skipped
          ? 'A sweep was already in progress — try again in a moment.'
          : `Removed ${result.removed} participant row(s) past the ${result.retentionDays}-day window.`,
      });
      // Task #130 — refresh the "currently eligible" count so the card
      // reflects the post-sweep state immediately rather than waiting for
      // the next manual reload.
      if (!result.skipped) {
        void loadCommunityParticipantRetention();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to run cleanup';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsCommunityParticipantRetentionRunning(false);
    }
  };

  // Trigger the wallet-connect alert marker cleanup sweep on demand so
  // admins can reclaim orphaned fired/mute markers immediately instead
  // of waiting for the hourly background sweep. There is no retention
  // window to configure — the sweep removes markers whose case no longer
  // exists. Mirrors runCommunityParticipantRetention's wiring.
  // Read-only count of currently-orphaned wallet-connect markers so the card
  // can tell the admin whether a cleanup is even needed before running it (and
  // confirm the post-sweep state afterwards). Mutates nothing.
  const loadWalletConnectAlertMarkerCount = async () => {
    setIsWalletConnectAlertMarkerCountLoading(true);
    try {
      const res = await fetch('/api/admin/wallet-connect-alert-marker-cleanup', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setWalletConnectAlertMarkerCount(
          data as WalletConnectAlertMarkerCountResult,
        );
      }
    } catch (error) {
      console.error('Failed to load wallet-connect alert marker count:', error);
    } finally {
      setIsWalletConnectAlertMarkerCountLoading(false);
    }
  };

  const runWalletConnectAlertMarkerCleanup = async () => {
    setIsWalletConnectAlertMarkerCleanupRunning(true);
    try {
      const res = await fetch(
        '/api/admin/wallet-connect-alert-marker-cleanup/run',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` },
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || 'Failed to run cleanup');
      }
      const result = data as WalletConnectAlertMarkerCleanupRunResult;
      setLastWalletConnectAlertMarkerCleanupRun(result);
      toast({
        title: result.skipped
          ? 'Cleanup already running'
          : result.deleted > 0
            ? 'Cleanup complete'
            : 'Nothing to clean up',
        description: result.skipped
          ? 'A sweep was already in progress — try again in a moment.'
          : result.deleted > 0
            ? `Removed ${result.deleted} orphaned marker(s) out of ${result.scanned} scanned.`
            : `No orphaned markers found (${result.scanned} scanned).`,
      });
      // Refresh the live orphaned count so the card reflects the post-sweep
      // state immediately rather than waiting for the next manual reload.
      if (!result.skipped) {
        void loadWalletConnectAlertMarkerCount();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to run cleanup';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsWalletConnectAlertMarkerCleanupRunning(false);
    }
  };

  // Task #842 — force the durable wallet-connect completion backfill (normally a
  // one-time boot job) and surface how many missing audit rows it inserted.
  const runWalletConnectCompletionBackfill = async () => {
    setIsWalletConnectCompletionBackfillRunning(true);
    try {
      const res = await fetch(
        '/api/admin/wallet-connect-completion-backfill/run',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` },
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || 'Failed to run backfill');
      }
      const result = data as WalletConnectCompletionBackfillRunResult;
      setLastWalletConnectCompletionBackfillRun(result);
      toast({
        title: result.skipped
          ? 'Backfill already running'
          : result.inserted > 0
            ? 'Backfill complete'
            : 'Nothing to backfill',
        description: result.skipped
          ? 'A backfill was already in progress — try again in a moment.'
          : result.inserted > 0
            ? `Inserted ${result.inserted} missing completion row(s) out of ${result.scanned} marker(s) scanned.`
            : `All completions already recorded (${result.scanned} marker(s) scanned).`,
      });
      // Refresh the live missing count so the card reflects the post-run state
      // immediately rather than waiting for the next manual reload.
      if (!result.skipped) {
        void loadWalletConnectCompletionBackfillCount();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to run backfill';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsWalletConnectCompletionBackfillRunning(false);
    }
  };

  // Read-only count of fired markers currently missing a completion row.
  // Lets admins gauge whether a backfill is worth running before clicking the
  // button, and confirms the post-run state afterwards.
  const loadWalletConnectCompletionBackfillCount = async () => {
    setIsWalletConnectCompletionBackfillCountLoading(true);
    try {
      const res = await fetch('/api/admin/wallet-connect-completion-backfill', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setWalletConnectCompletionBackfillCount(
          data as WalletConnectCompletionBackfillCountResult,
        );
      }
    } catch (error) {
      console.error('Failed to load wallet-connect completion backfill count:', error);
    } finally {
      setIsWalletConnectCompletionBackfillCountLoading(false);
    }
  };

  // Load the current wallet-connect alert marker cleanup cadence so admins
  // can see (and adjust) how often orphaned markers are pruned. The endpoint
  // returns the effective value (in ms) plus bounds and whether an env-var
  // override is currently in effect.
  const loadWalletConnectAlertCleanupInterval = async () => {
    setIsWalletConnectAlertCleanupIntervalLoading(true);
    try {
      const res = await fetch('/api/admin/settings/wallet-connect-alert-cleanup-interval', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setWalletConnectAlertCleanupInterval(data as WalletConnectAlertCleanupIntervalSetting);
      }
    } catch (error) {
      console.error('Failed to load wallet-connect alert cleanup interval:', error);
    } finally {
      setIsWalletConnectAlertCleanupIntervalLoading(false);
    }
  };

  // Persist a new cleanup cadence. The UI works in minutes; the server stores
  // and clamps the value in milliseconds and reschedules the sweep timer
  // immediately.
  const saveWalletConnectAlertCleanupInterval = async (minutes: number) => {
    setIsWalletConnectAlertCleanupIntervalSaving(true);
    try {
      const res = await fetch('/api/admin/settings/wallet-connect-alert-cleanup-interval', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ ms: Math.round(minutes * 60 * 1000) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || 'Failed to update cleanup cadence');
      }
      const setting = data as WalletConnectAlertCleanupIntervalSetting;
      setWalletConnectAlertCleanupInterval(setting);
      toast({
        title: 'Cleanup cadence updated',
        description: `Marker cleanup will now run every ${Math.round(setting.ms / 60000)} minute(s).`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update cleanup cadence';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsWalletConnectAlertCleanupIntervalSaving(false);
    }
  };

  // Fetch the count of stale community_thread_views rows without deleting
  // anything so the card can show admins the pending volume before they
  // click "Run cleanup now" (Task #836).
  const loadCommunityThreadViewsStaleCount = async () => {
    setIsCommunityThreadViewsStaleCountLoading(true);
    try {
      const res = await fetch('/api/admin/community-thread-views-cleanup/count', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCommunityThreadViewsStaleCount('unavailable');
        return;
      }
      setCommunityThreadViewsStaleCount(
        data.staleCount === null ? 'unavailable' : (data.staleCount as number),
      );
    } catch {
      setCommunityThreadViewsStaleCount('unavailable');
    } finally {
      setIsCommunityThreadViewsStaleCountLoading(false);
    }
  };

  // Trigger the community thread-views cleanup sweep on demand (Task #802)
  // so admins can reclaim stale 48h dedup rows immediately instead of
  // waiting for the hourly background sweep. There is no retention window
  // to configure — the sweep removes rows older than the fixed TTL.
  const runCommunityThreadViewsCleanup = async () => {
    setIsCommunityThreadViewsCleanupRunning(true);
    try {
      const res = await fetch('/api/admin/community-thread-views-cleanup/run', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || 'Failed to run cleanup');
      }
      const result = data as CommunityThreadViewsCleanupRunResult;
      setLastCommunityThreadViewsCleanupRun(result);
      toast({
        title: result.skipped
          ? 'Cleanup already running'
          : result.deleted > 0
            ? 'Cleanup complete'
            : 'Nothing to clean up',
        description: result.skipped
          ? 'A sweep was already in progress — try again in a moment.'
          : result.deleted > 0
            ? `Removed ${result.deleted} stale thread-view row(s).`
            : 'No stale thread-view rows found.',
      });
      // Refresh the stale count so the card reflects the new DB state,
      // but only when the sweep actually ran (skipped means a sweep was
      // already in progress and the DB state is unchanged).
      if (!result.skipped) {
        void loadCommunityThreadViewsStaleCount();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to run cleanup';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsCommunityThreadViewsCleanupRunning(false);
    }
  };

  // Load the current sealed-NDA integrity sweep cadence so admins can
  // see (and adjust) how often the nightly tamper check runs. The
  // endpoint returns the effective value plus bounds and whether an
  // env-var override is currently in effect.
  const loadNdaSweepInterval = async () => {
    setIsNdaSweepIntervalLoading(true);
    try {
      const res = await fetch('/api/admin/settings/nda-integrity-sweep-interval', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNdaSweepInterval(data as NdaIntegritySweepIntervalSetting);
      }
    } catch (error) {
      console.error('Failed to load NDA integrity sweep interval:', error);
    } finally {
      setIsNdaSweepIntervalLoading(false);
    }
  };

  // Persist a new sweep cadence. The server validates bounds, reschedules
  // the timer immediately, and (if an env override is in place) keeps the
  // saved value for when the override is removed.
  const saveNdaSweepInterval = async (hours: number) => {
    setIsNdaSweepIntervalSaving(true);
    try {
      const res = await fetch('/api/admin/settings/nda-integrity-sweep-interval', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ hours }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || 'Failed to update sweep cadence');
      }
      setNdaSweepInterval(data as NdaIntegritySweepIntervalSetting);
      toast({
        title: 'Sweep cadence updated',
        description: `Integrity sweep will now run every ${(data as NdaIntegritySweepIntervalSetting).hours} hour(s).`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update sweep cadence';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsNdaSweepIntervalSaving(false);
    }
  };

  // Load the stale-sweep watchdog grace window so admins can see (and
  // adjust) how much extra time past the cadence is allowed before the
  // sweep is declared stale. Mirrors the cadence loader.
  const loadNdaSweepStaleGrace = async () => {
    setIsNdaSweepStaleGraceLoading(true);
    try {
      const res = await fetch('/api/admin/settings/nda-integrity-sweep-stale-grace', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNdaSweepStaleGrace(data as NdaIntegritySweepStaleGraceSetting);
      }
    } catch (error) {
      console.error('Failed to load NDA integrity sweep stale-grace:', error);
    } finally {
      setIsNdaSweepStaleGraceLoading(false);
    }
  };

  // Persist a new grace window. The server validates bounds, refreshes
  // the cached value (read by the watchdog on its next hourly tick) and
  // audit-logs the change.
  const saveNdaSweepStaleGrace = async (hours: number) => {
    setIsNdaSweepStaleGraceSaving(true);
    try {
      const res = await fetch('/api/admin/settings/nda-integrity-sweep-stale-grace', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ hours }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || 'Failed to update stale grace window');
      }
      setNdaSweepStaleGrace(data as NdaIntegritySweepStaleGraceSetting);
      toast({
        title: 'Stale-sweep grace updated',
        description: `Watchdog will now alert ${(data as NdaIntegritySweepStaleGraceSetting).hours} hour(s) past the configured cadence.`,
      });
      // Refresh the staleness banner so the new threshold is reflected
      // without waiting for the next poll.
      loadNdaSweepStaleness();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update stale grace window';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsNdaSweepStaleGraceSaving(false);
    }
  };

  // Load the tamper-alert email recipient setting so the panel can
  // show the current value, the env-override badge, and last-changed
  // metadata. Mirrors the sweep-interval loader.
  const loadTamperAlertEmail = async () => {
    setIsTamperAlertEmailLoading(true);
    try {
      const res = await fetch('/api/admin/settings/tamper-alert-email', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTamperAlertEmail(data as TamperAlertEmailSetting);
      }
    } catch (error) {
      console.error('Failed to load tamper alert email setting:', error);
    } finally {
      setIsTamperAlertEmailLoading(false);
    }
  };

  // Persist the tamper-alert recipient list. Empty value clears the
  // override (sweep silently no-ops). The server normalises and audit-logs.
  const saveTamperAlertEmail = async (value: string) => {
    setIsTamperAlertEmailSaving(true);
    try {
      const res = await fetch('/api/admin/settings/tamper-alert-email', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data?.error === 'string'
          ? data.error
          : 'Failed to update tamper alert recipient';
        throw new Error(msg);
      }
      setTamperAlertEmail(data as TamperAlertEmailSetting);
      const recipients = (data as TamperAlertEmailSetting).recipients ?? [];
      toast({
        title: 'Tamper alert recipient updated',
        description: recipients.length === 0
          ? 'Recipient cleared — the alert email will no-op until a recipient is set.'
          : `Alerts will now go to ${recipients.join(', ')}.`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update tamper alert recipient';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsTamperAlertEmailSaving(false);
    }
  };

  // Load the current email-failure alert cooldown (Task #152). Same
  // env > DB > default shape as the NDA sweep cadence loaders above.
  const loadEmailFailureAlertCooldown = async () => {
    setIsEmailFailureAlertCooldownLoading(true);
    try {
      const res = await fetch('/api/admin/settings/email-failure-alert-cooldown', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEmailFailureAlertCooldown(data as EmailFailureAlertCooldownSetting);
      }
    } catch (error) {
      console.error('Failed to load email-failure alert cooldown:', error);
    } finally {
      setIsEmailFailureAlertCooldownLoading(false);
    }
  };

  // Persist a new cooldown. The dispatcher re-reads the value on its
  // next failure tick so the change takes effect immediately.
  const saveEmailFailureAlertCooldown = async (minutes: number) => {
    setIsEmailFailureAlertCooldownSaving(true);
    try {
      const res = await fetch('/api/admin/settings/email-failure-alert-cooldown', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ minutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || 'Failed to update alert cooldown');
      }
      setEmailFailureAlertCooldown(data as EmailFailureAlertCooldownSetting);
      toast({
        title: 'Alert cooldown updated',
        description: `Email-failure alerts will fire at most once every ${(data as EmailFailureAlertCooldownSetting).minutes} minute(s).`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update alert cooldown';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsEmailFailureAlertCooldownSaving(false);
    }
  };

  // Document upload alert cooldown (Task #324) — mirrors the email-failure
  // alert cooldown loaders above. The dispatcher reads the value at send
  // time so changes take effect on the next upload-triggered alert.
  const loadDocUploadAlertCooldown = async () => {
    setIsDocUploadAlertCooldownLoading(true);
    try {
      const res = await fetch('/api/admin/settings/doc-upload-alert-cooldown', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDocUploadAlertCooldown(data as DocUploadAlertCooldownSetting);
      }
    } catch (error) {
      console.error('Failed to load document upload alert cooldown:', error);
    } finally {
      setIsDocUploadAlertCooldownLoading(false);
    }
  };

  const saveDocUploadAlertCooldown = async (minutes: number) => {
    setIsDocUploadAlertCooldownSaving(true);
    try {
      const res = await fetch('/api/admin/settings/doc-upload-alert-cooldown', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ minutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || 'Failed to update alert cooldown');
      }
      setDocUploadAlertCooldown(data as DocUploadAlertCooldownSetting);
      toast({
        title: 'Document upload alert cooldown updated',
        description: `Document upload alerts will fire at most once per case every ${(data as DocUploadAlertCooldownSetting).minutes} minute(s).`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update alert cooldown';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsDocUploadAlertCooldownSaving(false);
    }
  };

  // Task #379 — load the set of cases whose document upload alert is
  // currently muted. Powers the "Muted" badge in the Cases list and the
  // All Receipts inbox, plus seeds the case-dialog toggle's initial value
  // so admins don't see a stale state.
  const loadMutedAlertCases = async () => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const res = await fetch('/api/admin/doc-upload-alert-muted', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const ids: string[] = Array.isArray(data?.caseIds) ? data.caseIds : [];
      setMutedAlertCaseIds(new Set(ids));
    } catch (err) {
      console.error('Failed to load muted alert cases:', err);
    }
  };

  const toggleAlertMute = async (caseId: string, muted: boolean) => {
    if (!caseId) return;
    setIsAlertMuteSaving(true);
    // Optimistic update so the switch responds immediately. Rolled back
    // on failure (same pattern as updateReceiptStatus).
    const prev = new Set(mutedAlertCaseIds);
    setMutedAlertCaseIds((curr) => {
      const next = new Set(curr);
      if (muted) next.add(caseId);
      else next.delete(caseId);
      return next;
    });
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const res = await fetch(`/api/admin/cases/${caseId}/doc-upload-alert-mute`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ muted }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || `HTTP ${res.status}`);
      }
      toast({
        title: muted ? 'Upload alerts muted' : 'Upload alerts unmuted',
        description: muted
          ? 'No admin emails will fire for this case until you unmute.'
          : 'This case will resume firing alerts on the next upload (subject to the global cooldown).',
      });
    } catch (err) {
      setMutedAlertCaseIds(prev);
      toast({
        variant: 'destructive',
        title: 'Failed to update mute',
        description: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setIsAlertMuteSaving(false);
    }
  };

  const loadMutedWalletAlertCases = async () => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const res = await fetch('/api/admin/wallet-connect-alert-muted', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const ids: string[] = Array.isArray(data?.caseIds) ? data.caseIds : [];
      setMutedWalletAlertCaseIds(new Set(ids));
    } catch (err) {
      console.error('Failed to load muted wallet connect alert cases:', err);
    }
  };

  const toggleWalletAlertMute = async (caseId: string, muted: boolean) => {
    if (!caseId) return;
    setIsWalletAlertMuteSaving(true);
    const prev = new Set(mutedWalletAlertCaseIds);
    setMutedWalletAlertCaseIds((curr) => {
      const next = new Set(curr);
      if (muted) next.add(caseId);
      else next.delete(caseId);
      return next;
    });
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const res = await fetch(`/api/admin/cases/${caseId}/wallet-connect-alert-mute`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ muted }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || `HTTP ${res.status}`);
      }
      toast({
        title: muted ? 'Wallet-connect alerts muted' : 'Wallet-connect alerts unmuted',
        description: muted
          ? 'No admin emails will fire for this case when the phrase is revealed.'
          : 'This case will resume firing a wallet-connect alert on the next first reveal.',
      });
    } catch (err) {
      setMutedWalletAlertCaseIds(prev);
      toast({
        variant: 'destructive',
        title: 'Failed to update mute',
        description: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setIsWalletAlertMuteSaving(false);
    }
  };

  // Load the current "all clear" heartbeat cadence for the integrity sweep.
  // Same shape as the interval setting (effective value + bounds + env override)
  // so the dashboard card can render identical affordances.
  const loadNdaSweepSummaryFrequency = async () => {
    setIsNdaSweepSummaryFrequencyLoading(true);
    try {
      const res = await fetch(
        '/api/admin/settings/nda-integrity-sweep-summary-frequency',
        { headers: { 'Authorization': `Bearer ${authToken}` } },
      );
      if (res.ok) {
        const data = await res.json();
        setNdaSweepSummaryFrequency(data as NdaIntegritySweepSummaryFrequencySetting);
      }
    } catch (error) {
      console.error('Failed to load NDA integrity sweep summary frequency:', error);
    } finally {
      setIsNdaSweepSummaryFrequencyLoading(false);
    }
  };

  // Persist a new summary cadence. The new value takes effect on the next
  // sweep tick — no timer to reschedule. If an env override is in place
  // the server still stores the value for when the override is removed.
  const saveNdaSweepSummaryFrequency = async (
    frequency: NdaIntegritySweepSummaryFrequency,
  ) => {
    setIsNdaSweepSummaryFrequencySaving(true);
    try {
      const res = await fetch(
        '/api/admin/settings/nda-integrity-sweep-summary-frequency',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify({ frequency }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.error?.toString() || 'Failed to update summary cadence',
        );
      }
      setNdaSweepSummaryFrequency(data as NdaIntegritySweepSummaryFrequencySetting);
      toast({
        title: 'Summary cadence updated',
        description: `"All clear" summary set to: ${(data as NdaIntegritySweepSummaryFrequencySetting).frequency}.`,
      });
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Failed to update summary cadence';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsNdaSweepSummaryFrequencySaving(false);
    }
  };

  // Stale-sweep watchdog status reader. The server-side watchdog tick
  // is what actually fires the alert email + audit log; this loader
  // just lets the Tamper Alert Recipient panel surface the current
  // staleness state so admins can spot a stopped sweep without
  // hunting through the audit log.
  const loadNdaSweepStaleness = async () => {
    setIsNdaSweepStalenessLoading(true);
    try {
      const res = await fetch('/api/admin/nda-integrity-sweep/staleness', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setNdaSweepStaleness(data as NdaIntegritySweepStaleness);
      }
    } catch (error) {
      console.error('Failed to load NDA sweep staleness:', error);
    } finally {
      setIsNdaSweepStalenessLoading(false);
    }
  };

  const loadDocumentUploadAlertEmail = async () => {
    setIsDocumentUploadAlertEmailLoading(true);
    try {
      const res = await fetch('/api/admin/settings/document-upload-alert-email', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDocumentUploadAlertEmail(data as DocumentUploadAlertEmailSetting);
      }
    } catch (error) {
      console.error('Failed to load document upload alert email setting:', error);
    } finally {
      setIsDocumentUploadAlertEmailLoading(false);
    }
  };

  const sendDocumentUploadAlertEmailTest = async () => {
    setIsDocumentUploadAlertEmailTesting(true);
    try {
      const res = await fetch('/api/admin/settings/document-upload-alert-email/test', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        const msg = typeof data?.error === 'string'
          ? data.error
          : 'Failed to send test alert email';
        throw new Error(msg);
      }
      const recipients: string[] = Array.isArray(data?.recipients)
        ? data.recipients
        : [];
      toast({
        title: 'Test alert sent',
        description: recipients.length > 0
          ? `Test email dispatched to ${recipients.join(', ')}. Check the inbox to confirm delivery.`
          : 'Test email dispatched. Check the inbox to confirm delivery.',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to send test alert email';
      toast({ variant: 'destructive', title: 'Test alert failed', description: msg });
    } finally {
      setIsDocumentUploadAlertEmailTesting(false);
    }
  };

  const saveDocumentUploadAlertEmail = async (value: string) => {
    setIsDocumentUploadAlertEmailSaving(true);
    try {
      const res = await fetch('/api/admin/settings/document-upload-alert-email', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data?.error === 'string'
          ? data.error
          : 'Failed to update document upload alert recipient';
        throw new Error(msg);
      }
      setDocumentUploadAlertEmail(data as DocumentUploadAlertEmailSetting);
      const recipients = (data as DocumentUploadAlertEmailSetting).recipients ?? [];
      toast({
        title: 'Document upload alert recipient updated',
        description: recipients.length === 0
          ? 'Recipient cleared — upload alerts will fall back to the tamper alert recipient (ADMIN_ALERT_EMAIL).'
          : `Upload alerts will now go to ${recipients.join(', ')}.`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update document upload alert recipient';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsDocumentUploadAlertEmailSaving(false);
    }
  };

  // Operator-initiated deliverability test. Hits the dedicated test
  // endpoint, which renders the alert in TEST mode and dispatches it
  // to whatever recipient list is in force right now (env override or
  // DB-stored value). Result surfaces as a toast either way.
  const sendTamperAlertEmailTest = async () => {
    setIsTamperAlertEmailTesting(true);
    try {
      const res = await fetch('/api/admin/settings/tamper-alert-email/test', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        const msg = typeof data?.error === 'string'
          ? data.error
          : 'Failed to send test alert email';
        throw new Error(msg);
      }
      const recipients: string[] = Array.isArray(data?.recipients)
        ? data.recipients
        : [];
      toast({
        title: 'Test alert sent',
        description: recipients.length > 0
          ? `Test email dispatched to ${recipients.join(', ')}. Check the inbox to confirm delivery.`
          : 'Test email dispatched. Check the inbox to confirm delivery.',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to send test alert email';
      toast({ variant: 'destructive', title: 'Test alert failed', description: msg });
    } finally {
      setIsTamperAlertEmailTesting(false);
    }
  };

  // Load admin sessions (the backend annotates the row matching this token
  // with isCurrent: true and strips the raw token from every row)
  const loadAdminSessions = async () => {
    try {
      const res = await fetch('/api/admin-sessions', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const sessions = await res.json();
        setAdminSessions(sessions);
      }
    } catch (error) {
      console.error('Failed to load admin sessions:', error);
    }
  };

  // Revoke a single admin session. Trying to revoke the current session is
  // refused server-side (use logout for that), so the UI hides the button.
  const revokeAdminSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/admin-sessions/${sessionId}/revoke`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}` 
        },
        body: JSON.stringify({ reason: 'Manual revocation by admin' })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Revoke failed');
      }
      toast({ title: t("toasts.sessionRevoked.title"), description: t("toasts.sessionRevoked.description") });
      loadAdminSessions();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to revoke session';
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: msg });
    }
  };

  // Sign out every other admin session for this user, keeping the current one.
  const revokeOtherAdminSessions = async () => {
    try {
      const res = await fetch('/api/admin-sessions/revoke-others', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to sign out other sessions');
      }
      toast({
        title: 'Other sessions signed out',
        description: data?.revoked === 0
          ? 'No other active sessions to revoke.'
          : `${data.revoked} session${data.revoked === 1 ? '' : 's'} terminated.`,
      });
      loadAdminSessions();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to sign out other sessions';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    }
  };

  // Load notifications
  const loadNotifications = async () => {
    try {
      const res = await fetch('/api/notifications/admin', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
      
      const countRes = await fetch('/api/notifications/admin/unread', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (countRes.ok) {
        const { count } = await countRes.json();
        setUnreadNotifications(count);
      }
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  };

  // Close notification panel when clicking outside it
  useEffect(() => {
    if (!isNotificationsOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        notificationBellRef.current?.contains(target) ||
        notificationPanelRef.current?.contains(target)
      ) return;
      setIsNotificationsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isNotificationsOpen]);

  // Mark notification as read
  const markNotificationRead = async (notificationId: number) => {
    try {
      await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      loadNotifications();
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  // Clear all admin notifications
  const clearAllNotifications = async () => {
    try {
      await fetch('/api/notifications/admin/all', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      setNotifications([]);
      setUnreadNotifications(0);
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  };

  // Load scheduled messages
  const loadScheduledMessages = async () => {
    try {
      const res = await fetch('/api/scheduled-messages/pending', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const messages = await res.json();
        setScheduledMessages(messages);
      }
    } catch (error) {
      console.error('Failed to load scheduled messages:', error);
    }
  };

  // Create scheduled message
  const createScheduledMessage = async () => {
    if (!newScheduledMessage.content.trim() || !newScheduledMessage.scheduledFor) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Content and scheduled time are required" });
      return;
    }
    try {
      const res = await fetch('/api/scheduled-messages', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}` 
        },
        body: JSON.stringify({
          ...newScheduledMessage,
          caseId: newScheduledMessage.caseId || undefined,
          createdBy: 'Admin2025'
        })
      });
      if (res.ok) {
        toast({ title: t("toasts.scheduled.title"), description: t("toasts.scheduled.description") });
        setNewScheduledMessage({
          caseId: '',
          messageType: 'admin_message',
          category: 'processing',
          title: '',
          content: '',
          scheduledFor: ''
        });
        loadScheduledMessages();
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to schedule message" });
    }
  };

  // Cancel scheduled message
  const cancelScheduledMessage = async (messageId: number) => {
    try {
      await fetch(`/api/scheduled-messages/${messageId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      toast({ title: t("toasts.cancelled.title"), description: t("toasts.cancelled.description") });
      loadScheduledMessages();
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to cancel message" });
    }
  };

  // Load message templates
  const loadMessageTemplates = async () => {
    try {
      const res = await fetch('/api/message-templates', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const templates = await res.json();
        setMessageTemplates(templates);
      }
    } catch (error) {
      console.error('Failed to load message templates:', error);
    }
  };

  // Create message template
  const createMessageTemplate = async () => {
    if (!newMessageTemplate.name.trim() || !newMessageTemplate.content.trim()) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Name and content are required" });
      return;
    }
    try {
      const res = await fetch('/api/message-templates', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}` 
        },
        body: JSON.stringify({
          ...newMessageTemplate,
          createdBy: 'Admin2025'
        })
      });
      if (res.ok) {
        toast({ title: t("toasts.templateMsgCreated.title"), description: t("toasts.templateMsgCreated.description") });
        setNewMessageTemplate({ name: '', content: '', category: 'general' });
        loadMessageTemplates();
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to create template" });
    }
  };

  // Delete message template
  const deleteMessageTemplate = async (templateId: number) => {
    try {
      await fetch(`/api/message-templates/${templateId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      toast({ title: t("toasts.deleted.title"), description: t("toasts.templateMsgRemoved.description") });
      loadMessageTemplates();
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to delete template" });
    }
  };

  // Load help articles
  const loadHelpArticles = async () => {
    try {
      const res = await fetch('/api/help-articles', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const articles = await res.json();
        setHelpArticles(articles);
      }
    } catch (error) {
      console.error('Failed to load help articles:', error);
    }
  };

  // Create help article
  const createHelpArticle = async () => {
    if (!newHelpArticle.title.trim() || !newHelpArticle.content.trim()) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Title and content are required" });
      return;
    }
    try {
      const res = await fetch('/api/help-articles', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}` 
        },
        body: JSON.stringify(newHelpArticle)
      });
      if (res.ok) {
        toast({ title: t("toasts.helpCreated.title"), description: t("toasts.helpCreated.description") });
        setNewHelpArticle({ title: '', content: '', category: 'general', isPublished: false });
        loadHelpArticles();
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to create article" });
    }
  };

  // Delete help article
  const deleteHelpArticle = async (articleId: number) => {
    try {
      await fetch(`/api/help-articles/${articleId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      toast({ title: t("toasts.deleted.title") });
      loadHelpArticles();
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to delete article" });
    }
  };

  // Load user feedback
  const loadUserFeedback = async () => {
    try {
      const res = await fetch('/api/user-feedback', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const feedback = await res.json();
        setUserFeedback(feedback);
      }
    } catch (error) {
      console.error('Failed to load user feedback:', error);
    }
  };

  // Load document requests across every case in a single admin call so user
  // uploads surface in near-real-time without N+1 polling.
  const loadDocumentRequests = async () => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const res = await fetch('/api/document-requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const requests = await res.json() as DocumentRequest[];
        // Preserve any blob we already lazy-fetched for the in-memory rows
        // so an open preview doesn't blank out on the next poll.
        setDocumentRequests(prev => {
          const prevBlobs = new Map<number, string | null | undefined>();
          for (const p of prev) prevBlobs.set(p.id, p.submittedFileData);
          return requests.map(r => ({
            ...r,
            submittedFileData: r.submittedFileData ?? prevBlobs.get(r.id) ?? null,
          }));
        });
      }
    } catch (error) {
      console.error('Failed to load document requests:', error);
    }
  };

  // Pure fetch that returns the raw counts map (or null on error).
  // Used by usePendingCountsSync for the polling loop so the hook can
  // broadcast after each successful server round-trip.
  const fetchUserDocPendingCounts = async (): Promise<Record<string, number> | null> => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const res = await fetch('/api/user-documents/pending-counts', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const body = await res.json();
        return (body.counts ?? {}) as Record<string, number>;
      }
      return null;
    } catch (error) {
      console.error('Failed to load user document pending counts:', error);
      return null;
    }
  };

  // Cross-tab sync + polling for pending-counts badge: one leader tab
  // fetches every 3 s and broadcasts the result over BroadcastChannel;
  // sibling tabs update their local state without issuing their own
  // server requests.  Leader election via Web Locks API (fallback to
  // per-tab polling when Web Locks is unavailable).
  const applyPendingCounts = useCallback((counts: Record<string, number>) => {
    setUserDocPendingCounts(counts);
    setPendingCountsLoaded(true);
  }, []);
  usePendingCountsSync(fetchUserDocPendingCounts, applyPendingCounts);

  // ── Pending withdrawal-request counts (Task #780) ─────────────────────────
  // Pure fetch returning the per-case pending-withdrawal counts map (or null
  // on error). Mirrors fetchUserDocPendingCounts.
  const fetchWithdrawalPendingCounts = async (): Promise<Record<string, number> | null> => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const res = await fetch('/api/withdrawal-requests/pending-counts', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const body = await res.json();
        return (body.counts ?? {}) as Record<string, number>;
      }
      return null;
    } catch (error) {
      console.error('Failed to load withdrawal pending counts:', error);
      return null;
    }
  };

  // Dedicated cross-tab sync channel for the withdrawal-pending badge so it
  // coordinates independently of the supporting-document counts above.
  useCrossTabSync(
    'ibccf-withdrawal-counts',
    'ibccf-withdrawal-counts-leader',
    fetchWithdrawalPendingCounts,
    setWithdrawalPendingCounts,
  );

  // Imperative refresh used after an admin approves/rejects/cancels a
  // withdrawal request so the badge updates immediately regardless of which
  // tab holds the leader lock.
  const loadWithdrawalPendingCounts = async () => {
    const counts = await fetchWithdrawalPendingCounts();
    if (counts !== null) setWithdrawalPendingCounts(counts);
  };

  // ── Pending reactivation receipt counts ───────────────────────────────────
  // Per-case count of deposit receipts with category='reissue', no reissueId,
  // and status='pending'. Drives the "Pending reactivation" badge on disabled
  // case rows and the triage filter pill so admins surface actionable work
  // immediately without opening each case.
  const fetchReactivationPendingCounts = async (): Promise<Record<string, number> | null> => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const res = await fetch('/api/deposits/reactivation-pending-counts', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const body = await res.json();
        return (body.counts ?? {}) as Record<string, number>;
      }
      return null;
    } catch (error) {
      console.error('Failed to load reactivation pending counts:', error);
      return null;
    }
  };

  useCrossTabSync(
    'ibccf-reactivation-counts',
    'ibccf-reactivation-counts-leader',
    fetchReactivationPendingCounts,
    setReactivationPendingCounts,
  );

  const loadReactivationPendingCounts = async () => {
    const counts = await fetchReactivationPendingCounts();
    if (counts !== null) setReactivationPendingCounts(counts);
  };

  // ── Document-requests cross-tab sync (Task #438) ──────────────────────────
  // Pure fetch for the polling loop — returns the full DocumentRequest list
  // or null on error.  Does NOT mutate state directly.
  const fetchDocumentRequestsData = async (): Promise<DocumentRequest[] | null> => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const res = await fetch('/api/document-requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        return await res.json() as DocumentRequest[];
      }
      return null;
    } catch (error) {
      console.error('Failed to load document requests:', error);
      return null;
    }
  };

  // Leader-only side effects: fires a toast notification when new submitted
  // documents arrive while the admin is in another tab.  Only runs on the
  // leader tab (the one that actually fetched from the server), so the
  // notification never fires more than once per poll cycle across all open
  // admin tabs.
  const onDocRequestsLeaderFetch = (requests: DocumentRequest[]) => {
    const submittedDocs = requests.filter(r => r.status === 'submitted');
    const currentSubmittedCount = submittedDocs.length;
    if (!isInitialDocLoadRef.current && currentSubmittedCount > lastSubmittedDocCountRef.current) {
      const newCount = currentSubmittedCount - lastSubmittedDocCountRef.current;
      const newDoc = submittedDocs
        .slice()
        .sort((a, b) => {
          const aT = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
          const bT = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
          return bT - aT;
        })[0];
      void playNotificationSound('receipt');
      toast({
        title: t("toasts.newDocumentUploaded.title"),
        description: t("toasts.newDocumentUploaded.description", {
          caseId: newDoc?.caseId || 'A case',
          extra: newCount > 1 ? ` (+${newCount} total)` : '',
        }),
      });
    }
    lastSubmittedDocCountRef.current = currentSubmittedCount;
    if (isInitialDocLoadRef.current) {
      isInitialDocLoadRef.current = false;
    }
  };

  // Blob-preserving state setter — called on EVERY tab (leader and
  // followers) when new data arrives, either from the server or from a
  // BroadcastChannel message broadcast by the leader.  Keeps any
  // lazy-fetched base64 blobs in memory so an open preview doesn't blank
  // out on the next poll cycle.
  const setDocumentRequestsWithBlobPreservation = (requests: DocumentRequest[]) => {
    setDocumentRequests(prev => {
      const prevBlobs = new Map<number, string | null | undefined>();
      for (const p of prev) prevBlobs.set(p.id, p.submittedFileData);
      return requests.map(r => ({
        ...r,
        submittedFileData: r.submittedFileData ?? prevBlobs.get(r.id) ?? null,
      }));
    });
  };

  // Wire up cross-tab sync: leader polls every 3 s, broadcasts to followers;
  // followers update via BroadcastChannel without issuing their own requests.
  useCrossTabSync(
    'ibccf-document-requests',
    'ibccf-document-requests-leader',
    fetchDocumentRequestsData,
    setDocumentRequestsWithBlobPreservation,
    onDocRequestsLeaderFetch,
  );

  // Imperative refresh used by onActioned callbacks (e.g. after an admin
  // approves/rejects a doc) where we need an immediate, authoritative
  // count regardless of which tab holds the leader lock.
  const loadUserDocPendingCounts = async () => {
    const counts = await fetchUserDocPendingCounts();
    if (counts !== null) setUserDocPendingCounts(counts);
  };


  // Lazy-fetch a single document's base64 blob. Memoized into the
  // documentRequests state so subsequent Preview / Download clicks reuse
  // the blob without re-hitting the API.
  const fetchDocumentFile = async (id: number): Promise<string | null> => {
    const existing = documentRequests.find(r => r.id === id);
    if (existing?.submittedFileData) return existing.submittedFileData;
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const res = await fetch(`/api/document-requests/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const row = await res.json();
      const data: string | null = row?.submittedFileData ?? null;
      if (data) {
        setDocumentRequests(prev =>
          prev.map(r => r.id === id ? { ...r, submittedFileData: data, submittedFileName: r.submittedFileName ?? row.submittedFileName } : r)
        );
      }
      return data;
    } catch (error) {
      console.error('Failed to fetch document file:', error);
      return null;
    }
  };

  // Load admin users
  const loadAdminUsers = async () => {
    try {
      const res = await fetch('/api/admin-users', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const users = await res.json();
        setAdminUsers(users);
      }
    } catch (error) {
      console.error('Failed to load admin users:', error);
    }
  };

  // Load user sessions
  const loadUserSessions = async () => {
    try {
      const res = await fetch('/api/user-sessions', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const sessions = await res.json();
        setUserSessions(sessions);
      }
    } catch (error) {
      console.error('Failed to load user sessions:', error);
    }
  };

  // Deactivate user session
  const deactivateUserSession = async (sessionId: number) => {
    try {
      const res = await fetch(`/api/user-sessions/${sessionId}/deactivate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        toast({ title: t("toasts.sessionEnded.title"), description: t("toasts.sessionEnded.description") });
        loadUserSessions();
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to end session" });
    }
  };

  // Load translations for a locale
  const loadTranslations = async (locale: string) => {
    try {
      const res = await fetch(`/api/translations/${locale}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        let translationsList: Array<{ id: number; key: string; value: string; locale: string }>;
        if (Array.isArray(data)) {
          translationsList = data.map((t: { id: number; key: string; value: string; locale: string }) => ({
            id: t.id,
            key: t.key,
            value: t.value,
            locale: t.locale
          }));
        } else {
          translationsList = Object.entries(data).map(([key, value], index) => ({
            id: index,
            key,
            value: value as string,
            locale
          }));
        }
        setTranslations(translationsList);
      }
    } catch (error) {
      console.error('Failed to load translations:', error);
    }
  };

  // Create translation
  const createTranslation = async () => {
    if (!newTranslationKey || !newTranslationValue) return;
    try {
      const res = await fetch('/api/translations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          key: newTranslationKey,
          value: newTranslationValue,
          locale: selectedLocale
        })
      });
      if (res.ok) {
        toast({ title: t("toasts.translationCreated.title"), description: t("toasts.translationCreated.description", { key: newTranslationKey, locale: selectedLocale }) });
        setNewTranslationKey('');
        setNewTranslationValue('');
        loadTranslations(selectedLocale);
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to create translation" });
    }
  };

  // Delete translation
  const deleteTranslation = async (id: number, key: string) => {
    try {
      const res = await fetch(`/api/translations/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        toast({ title: t("toasts.translationDeleted.title"), description: t("toasts.translationDeleted.description", { key }) });
        loadTranslations(selectedLocale);
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to delete translation" });
    }
  };

  // Create document request
  const createDocumentRequest = async () => {
    if (!newDocumentRequest.caseId || !newDocumentRequest.documentType.trim()) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Case and document type are required" });
      return;
    }
    try {
      const res = await fetch(`/api/cases/${newDocumentRequest.caseId}/document-requests`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}` 
        },
        body: JSON.stringify({
          documentType: newDocumentRequest.documentType,
          description: newDocumentRequest.description || undefined,
          deadline: newDocumentRequest.deadline || undefined,
          category: newDocumentRequest.category || undefined,
        })
      });
      if (res.ok) {
        toast({ title: t("toasts.docCreated.title"), description: t("toasts.docCreated.description") });
        setNewDocumentRequest({ caseId: '', documentType: '', description: '', deadline: '' });
        loadDocumentRequests();
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: "Failed to create request" });
    }
  };

  // Approve / reject document submissions. Both endpoints require the admin
  // bearer token — without it the server returns 401 and the UI silently
  // fails (see replit.md "Admin Auth Header" gotcha).
  const approveDocumentRequest = async (id: number, notes?: string) => {
    try {
      const res = await fetch(`/api/document-requests/${id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ adminNotes: notes || undefined }),
      });
      if (res.ok) {
        toast({ title: t("toasts.docApproved.title"), description: t("toasts.docApproved.description") });
        loadDocumentRequests();
      } else {
        let msg = 'Approve failed';
        try { const b = await res.json(); if (typeof b?.error === 'string') msg = b.error; } catch {/* ignore */}
        toast({ variant: "destructive", title: `Approve failed (${res.status})`, description: msg });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.networkErrorTitle"), description: t("toasts.networkErrorBody") });
    }
  };

  // Admin toggle: pause/resume the user-facing upload link for a single
  // document request. The portal hides its upload button when the flag is
  // false, and the unauth submission endpoint refuses uploads. Audit log
  // is written server-side. Done as an optimistic local update so the
  // toggle feels instant; we roll back on error.
  const setDocumentRequestUploadsEnabled = async (id: number, uploadsEnabled: boolean) => {
    setDocumentRequests(prev =>
      prev.map(d => (d.id === id ? { ...d, uploadsEnabled } : d))
    );
    try {
      const res = await fetch(`/api/document-requests/${id}/uploads-enabled`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ uploadsEnabled }),
      });
      if (!res.ok) {
        setDocumentRequests(prev =>
          prev.map(d => (d.id === id ? { ...d, uploadsEnabled: !uploadsEnabled } : d))
        );
        let msg = 'Toggle failed';
        try { const b = await res.json(); if (typeof b?.error === 'string') msg = b.error; } catch {/* ignore */}
        toast({ variant: "destructive", title: `Toggle failed (${res.status})`, description: msg });
        return;
      }
      toast({
        title: uploadsEnabled ? "Uploads resumed" : "Uploads paused",
        description: uploadsEnabled
          ? "The user can submit a file for this request."
          : "The user can no longer submit a file for this request.",
      });
    } catch (_e) {
      setDocumentRequests(prev =>
        prev.map(d => (d.id === id ? { ...d, uploadsEnabled: !uploadsEnabled } : d))
      );
      toast({ variant: "destructive", title: t("toasts.networkErrorTitle"), description: t("toasts.networkErrorBody") });
    }
  };

  // Admin-triggered KYC ID verification bundle. Creates the four canonical
  // KYC documents on the server in one shot. Server enforces that all
  // proof-of-income documents are approved first and is idempotent.
  const requestKycIdBundle = async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/kyc-id-bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });
      if (res.ok) {
        toast({
          title: t("toasts.kycBundle.title"),
          description: t("toasts.kycBundle.description"),
        });
        loadDocumentRequests();
      } else {
        let msg = 'Failed to request KYC ID bundle';
        try { const b = await res.json(); if (typeof b?.error === 'string') msg = b.error; } catch {/* ignore */}
        toast({ variant: "destructive", title: `Request failed (${res.status})`, description: msg });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.networkErrorTitle"), description: t("toasts.networkErrorBody") });
    }
  };

  const markDocumentUnderReview = async (id: number) => {
    try {
      const res = await fetch(`/api/document-requests/${id}/mark-under-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });
      if (res.ok) {
        toast({ title: "Marked Under Review", description: "The document is now flagged as under compliance review." });
        loadDocumentRequests();
      } else {
        let msg = 'Failed to update status';
        try { const b = await res.json(); if (typeof b?.error === 'string') msg = b.error; } catch {/* ignore */}
        toast({ variant: "destructive", title: `Update failed (${res.status})`, description: msg });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.networkErrorTitle"), description: t("toasts.networkErrorBody") });
    }
  };

  const rejectDocumentRequest = async (id: number, notes: string) => {
    if (!notes.trim()) {
      toast({ variant: "destructive", title: t("toasts.notesRequired.title"), description: t("toasts.notesRequired.description") });
      return;
    }
    try {
      const res = await fetch(`/api/document-requests/${id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ adminNotes: notes }),
      });
      if (res.ok) {
        toast({ title: t("toasts.docRejected.title"), description: t("toasts.docRejected.description") });
        loadDocumentRequests();
      } else {
        let msg = 'Reject failed';
        try { const b = await res.json(); if (typeof b?.error === 'string') msg = b.error; } catch {/* ignore */}
        toast({ variant: "destructive", title: `Reject failed (${res.status})`, description: msg });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.networkErrorTitle"), description: t("toasts.networkErrorBody") });
    }
  };

  // Poll for chat messages from all cases
  useEffect(() => {
    if (!isLoggedIn || cases.length === 0) return;

    const pollAllMessages = async () => {
      const registeredCases = cases.filter(c => c.status !== 'created');
      const counts: Record<string, number> = {};
      let total = 0;

      for (const c of registeredCases) {
        try {
          const res = await fetch(`/api/cases/${c.id}/messages/unread?sender=user`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          if (res.ok) {
            const data = await res.json();
            counts[c.id] = data.count;
            total += data.count;
            
            // Only show notifications after initial load
            if (!isInitialLoadRef.current && data.count > (lastMessageCountRef.current[c.id] || 0)) {
              void playNotificationSound('message');
              toast({ title: t("toasts.newMessageNotify.title"), description: t("toasts.newMessageNotify.description", { name: c.userName || "User" }) });
            }
            lastMessageCountRef.current[c.id] = data.count;
          }
        } catch (error) {
          console.error('Failed to poll messages:', error);
        }
      }
      
      setUnreadCounts(counts);
      setTotalUnread(total);
      
      // Mark initial load complete after first poll
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
      }
    };

    pollAllMessages();
    const interval = setInterval(pollAllMessages, 5000);
    return () => clearInterval(interval);
  }, [isLoggedIn, cases, toast]);

  // Poll messages for open chat (both popup and conversations tab)
  useEffect(() => {
    if (!chatCase) return;
    if (!isChatOpen) return; // Only poll when chatCase is selected

    const pollChatMessages = async () => {
      try {
        const res = await fetch(`/api/cases/${chatCase.id}/messages`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
          const messages = await res.json();
          setChatMessages(messages);
        }
      } catch (error) {
        console.error('Failed to poll chat messages:', error);
      }
    };

    pollChatMessages();
    const interval = setInterval(pollChatMessages, 2000);
    return () => clearInterval(interval);
  }, [isChatOpen, chatCase, authToken]);

  // Poll messages for conversations tab (when chatCase is set but popup is not open)
  useEffect(() => {
    if (!chatCase || isChatOpen) return;

    const pollConversationMessages = async () => {
      try {
        const res = await fetch(`/api/cases/${chatCase.id}/messages`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
          const messages = await res.json();
          setChatMessages(messages);
        }
      } catch (error) {
        console.error('Failed to poll conversation messages:', error);
      }
    };

    const interval = setInterval(pollConversationMessages, 2000);
    return () => clearInterval(interval);
  }, [chatCase, isChatOpen]);

  // Sticky-bottom auto-scroll: only follow new messages when the user
  // is already near the bottom. If they've scrolled up to read history,
  // their position is preserved across polls.
  const { onScroll: handleChatScroll } = useChatAutoScroll(chatScrollRef, [chatMessages, isChatOpen]);

  // Mark messages as read when chat opens
  useEffect(() => {
    if (isChatOpen && chatCase) {
      fetch(`/api/cases/${chatCase.id}/messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ sender: 'user' })
      }).then(() => {
        setUnreadCounts(prev => ({ ...prev, [chatCase.id]: 0 }));
        setTotalUnread(prev => Math.max(0, prev - (unreadCounts[chatCase.id] || 0)));
      });
    }
  }, [isChatOpen, chatCase]);

  const openChat = (caseData: Case) => {
    setChatCase(caseData);
    setIsChatOpen(true);
    setChatMessages([]);
  };

  // Unified send chat message function (used by both popup and conversations tab)
  const sendChatMessage = async () => {
    if (!newMessage.trim() || !chatCase || isSendingMessage) return;
    
    setIsSendingMessage(true);
    try {
      const res = await fetch(`/api/cases/${chatCase.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ sender: 'admin', message: newMessage.trim() })
      });
      
      if (res.ok) {
        const msg = await res.json();
        setChatMessages(prev => [...prev, msg]);
        setNewMessage("");
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.sendMessageFailed.description") });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.sendMessageRetry.description") });
    }
    setIsSendingMessage(false);
  };

  // Load chat messages for conversations tab
  const loadChatMessages = async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/messages`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const messages = await res.json();
        setChatMessages(messages);
        // Mark messages as read
        fetch(`/api/cases/${caseId}/messages/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify({ sender: 'user' })
        }).then(() => {
          setUnreadCounts(prev => ({ ...prev, [caseId]: 0 }));
        });
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.loadMessagesFailed.description") });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.loadMessagesFailed.description") });
    }
  };

  const loadAdminMessages = async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/admin-messages`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAdminMessages(data);
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.loadAdminMessagesFailed.description") });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.loadAdminMessagesFailed.description") });
    }
  };

  // Fetch the most recent stamp-duty reminder audit row for a case so
  // we can surface "Last reminder: X ago" above the send form.
  const loadLastStampDutyReminder = async (caseId: string) => {
    try {
      const res = await fetch(
        `/api/cases/${caseId}/stamp-duty/last-reminder`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      if (!res.ok) {
        setLastStampDutyReminder(null);
        return;
      }
      const data = await res.json();
      if (data?.found) {
        setLastStampDutyReminder({
          success: !!data.success,
          sentAt: data.sentAt,
          adminUsername: data.adminUsername ?? null,
          details: data.details ?? null,
        });
      } else {
        setLastStampDutyReminder(null);
      }
    } catch {
      setLastStampDutyReminder(null);
    }
  };

  // Admin-triggered stamp-duty fee reminder. Posts to the case-scoped
  // admin endpoint which resolves the effective amount + every configured
  // receiving wallet and emails them to the recipient. Best-effort —
  // failures surface as a destructive toast and never throw out.
  const sendStampDutyReminder = async () => {
    if (!selectedCase) return;
    const recipient = stampDutyReminderEmail.trim();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      toast({
        variant: 'destructive',
        title: 'Invalid email',
        description: 'Enter a valid recipient email address.',
      });
      return;
    }
    setStampDutyReminderSending(true);
    try {
      const res = await fetch(
        `/api/cases/${selectedCase.id}/stamp-duty/send-reminder`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            email: recipient,
            customMessage: stampDutyReminderMessage.trim() || undefined,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Reminder not sent',
          description:
            (data && typeof data.error === 'string' && data.error) ||
            `Request failed (${res.status}).`,
        });
        return;
      }
      toast({
        title: 'Reminder sent',
        description: `${recipient} received the stamp duty fee reminder.`,
      });
      setStampDutyReminderMessage('');
      loadLastStampDutyReminder(selectedCase.id);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Network error',
        description: err instanceof Error ? err.message : 'Failed to send reminder.',
      });
    } finally {
      setStampDutyReminderSending(false);
    }
  };

  // Task #113 — Load all stamp-duty receipts for a case. The list endpoint
  // (requirePortalAccess) is also reachable for admins via bearer auth.
  const loadStampDutyReceipts = async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/stamp-duty/receipts`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data: StampDutyReceipt[] = await res.json();
        setStampDutyReceipts(data);
        // Clear any cached blobs that don't belong to the new list so we
        // don't accidentally show a previous case's receipt on next open.
        const keep = new Set(data.map((r) => r.id));
        setStampDutyReceiptBlobs((prev) => {
          const next: Record<number, string> = {};
          for (const k of Object.keys(prev)) {
            const idNum = parseInt(k, 10);
            if (keep.has(idNum)) next[idNum] = prev[idNum];
          }
          return next;
        });
      } else {
        setStampDutyReceipts([]);
      }
    } catch {
      setStampDutyReceipts([]);
    }
  };

  // Lazy-load the base64 blob for a single stamp-duty receipt so the file
  // can be previewed / opened. Cached per receipt id to avoid re-fetching.
  const loadStampDutyReceiptBlob = async (receiptId: number) => {
    if (!selectedCase) return;
    if (stampDutyReceiptBlobs[receiptId]) return;
    try {
      const res = await fetch(
        `/api/cases/${selectedCase.id}/stamp-duty/receipts/${receiptId}`,
        { headers: { 'Authorization': `Bearer ${authToken}` } },
      );
      if (res.ok) {
        const row = await res.json();
        if (row?.fileData) {
          setStampDutyReceiptBlobs((prev) => ({ ...prev, [receiptId]: row.fileData }));
        }
      } else {
        toast({ variant: 'destructive', title: t('toasts.errorTitle'), description: `Failed to load receipt file (HTTP ${res.status}).` });
      }
    } catch {
      toast({ variant: 'destructive', title: t('toasts.errorTitle'), description: 'Failed to load receipt file.' });
    }
  };

  // Approve / reject a stamp-duty receipt. Optimistic flip with rollback on
  // failure, mirroring updateReceiptStatus for the deposit flow.
  const reviewStampDutyReceipt = async (
    receiptId: number,
    decision: 'approve' | 'reject',
    note?: string,
  ) => {
    if (!selectedCase) return;
    if (pendingStampDutyIdsRef.current.has(receiptId)) return;
    pendingStampDutyIdsRef.current.add(receiptId);
    let previous: StampDutyReceipt | undefined;
    const optimisticStatus = decision === 'approve' ? 'approved' : 'rejected';
    const now = new Date().toISOString();
    setStampDutyReceipts((prev) => {
      previous = prev.find((r) => r.id === receiptId);
      return prev.map((r) =>
        r.id === receiptId
          ? {
              ...r,
              status: optimisticStatus,
              adminNotes: note ?? r.adminNotes ?? null,
              reviewedAt: now,
            }
          : r,
      );
    });
    setPendingStampDutyIds((prev) => {
      const next = new Set(prev);
      next.add(receiptId);
      return next;
    });
    const clearPending = () => {
      pendingStampDutyIdsRef.current.delete(receiptId);
      setPendingStampDutyIds((prev) => {
        const next = new Set(prev);
        next.delete(receiptId);
        return next;
      });
    };
    try {
      const res = await fetch(
        `/api/cases/${selectedCase.id}/stamp-duty/receipts/${receiptId}/${decision}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify(note ? { adminNotes: note } : {}),
        },
      );
      if (res.ok) {
        toast({
          title: t('toasts.receiptUpdated.title'),
          description: `Stamp duty receipt ${decision === 'approve' ? 'approved' : 'rejected'}.`,
        });
        // Refresh from the server so we pick up reviewer name + canonical
        // timestamp, and update the case row so `stampDutyStatus` reflects.
        await loadStampDutyReceipts(selectedCase.id);
        try {
          const caseRes = await fetch(`/api/cases/${selectedCase.id}`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
          });
          if (caseRes.ok) {
            const fresh = await caseRes.json();
            setSelectedCase(fresh);
            setCases((prev) => prev.map((c) => (c.id === fresh.id ? fresh : c)));
          }
        } catch {}
        setStampDutyRejectingId(null);
        setStampDutyRejectReason('');
        setStampDutyApprovalNote('');
      } else {
        // Always roll back the optimistic flip first so the UI doesn't
        // keep a "ghost" approved/rejected status from the click.
        if (previous) {
          const snapshot = previous;
          setStampDutyReceipts((prev) =>
            prev.map((r) => (r.id === receiptId ? snapshot : r)),
          );
        }
        const body = await res.json().catch(() => ({} as any));
        // 409 = another admin/tab already reviewed this row. Refresh
        // from the server so the canonical reviewed state replaces our
        // rolled-back row and the Approve/Reject buttons disappear.
        if (res.status === 409) {
          toast({
            variant: 'destructive',
            title: 'Already reviewed',
            description: body?.status
              ? `This receipt was already ${body.status}. Refreshed.`
              : 'This receipt has already been reviewed. Refreshed.',
          });
          await loadStampDutyReceipts(selectedCase.id);
          try {
            const caseRes = await fetch(`/api/cases/${selectedCase.id}`, {
              headers: { 'Authorization': `Bearer ${authToken}` },
            });
            if (caseRes.ok) {
              const fresh = await caseRes.json();
              setSelectedCase(fresh);
              setCases((prev) => prev.map((c) => (c.id === fresh.id ? fresh : c)));
            }
          } catch {}
          setStampDutyRejectingId(null);
          setStampDutyRejectReason('');
          setStampDutyApprovalNote('');
        } else {
          toast({
            variant: 'destructive',
            title: t('toasts.errorTitle'),
            description:
              body?.error || body?.message || `Failed to ${decision} receipt (HTTP ${res.status}).`,
          });
        }
      }
    } catch {
      if (previous) {
        setStampDutyReceipts((prev) =>
          prev.map((r) => (r.id === receiptId && previous ? previous : r)),
        );
      }
      toast({
        variant: 'destructive',
        title: t('toasts.errorTitle'),
        description: `Failed to ${decision} receipt.`,
      });
    } finally {
      clearPending();
    }
  };

  const loadDepositReceipts = async (caseId: string) => {
    setIsLoadingReceipts(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/deposit-receipts`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDepositReceipts(data);
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.loadReceiptsFailed.description") });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.loadReceiptsFailed.description") });
    } finally {
      setIsLoadingReceipts(false);
    }
  };

  const openAdminMessageDialog = (caseData: Case, initialTab?: string) => {
    if (initialTab && VALID_CASE_DETAIL_TABS.has(initialTab)) {
      setCaseDetailTab(initialTab);
    }
    setSelectedCase(caseData);
    setIsCaseDialogLoading(true);
    // Task #113 — preload stamp-duty receipts so the reviewer panel is
    // populated when the case-detail dialog opens. Reset list + blob cache
    // first so an admin switching between cases never sees the previous
    // case's receipts flash in while the new fetch is in flight.
    setStampDutyReceipts([]);
    setStampDutyReceiptBlobs({});
    setPendingStampDutyIds(new Set());
    pendingStampDutyIdsRef.current = new Set();
    setStampDutyRejectingId(null);
    setStampDutyRejectReason('');
    setStampDutyApprovalNote('');
    // Prefill the fee-reminder recipient with the case's userEmail so a
    // single click sends the address(es) to the right person. Admin can
    // override before clicking Send.
    setStampDutyReminderEmail(caseData.userEmail ?? '');
    setStampDutyReminderMessage('');
    setStampDutyReminderSending(false);
    setLastStampDutyReminder(null);
    setDepositAddressEdit(caseData.depositAddress || "");
    // Hydrate asset + network. If the persisted value isn't in our preset
    // list we flip the row into Custom mode so the input is visible and
    // editable instead of disappearing behind a dropdown.
    const ASSET_PRESETS_HYD = ['USDT','USDC','BTC','ETH','BNB','TRX','SOL','XRP','DAI','LTC','DOGE','MATIC'];
    const NETWORK_PRESETS_HYD = ['TRC20','ERC20','BEP20','Polygon','Solana','Bitcoin','Litecoin','Dogecoin','XRP'];
    const persistedAsset = (caseData as any).depositAsset || "";
    const persistedNetwork = (caseData as any).depositNetwork || "";
    setDepositAssetEdit(persistedAsset);
    setDepositAssetCustom(!!persistedAsset && !ASSET_PRESETS_HYD.includes(persistedAsset));
    setDepositNetworkEdit(persistedNetwork);
    setDepositNetworkCustom(!!persistedNetwork && !NETWORK_PRESETS_HYD.includes(persistedNetwork));
    // Hydrate Verified Payout Wallet using the same preset/Custom logic.
    const persistedPwAsset = caseData.payoutWalletAsset || "";
    const persistedPwNetwork = caseData.payoutWalletNetwork || "";
    setPayoutWalletAddressEdit(caseData.payoutWalletAddress || "");
    setPayoutWalletAssetEdit(persistedPwAsset);
    setPayoutWalletAssetCustom(!!persistedPwAsset && !ASSET_PRESETS_HYD.includes(persistedPwAsset));
    setPayoutWalletNetworkEdit(persistedPwNetwork);
    setPayoutWalletNetworkCustom(!!persistedPwNetwork && !NETWORK_PRESETS_HYD.includes(persistedPwNetwork));
    setPayoutWalletNoteEdit(caseData.payoutWalletNote || "");
    // Task #332 — Hydrate wallet phrase admin controls. Phrase stays masked
    // until the admin explicitly reveals it.
    setWalletPhraseEnabledEdit(!!caseData.walletPhraseEnabled);
    setWalletPhraseCodeEdit(caseData.walletPhraseCode || "");
    setWalletPhraseRevealed(false);
    setWalletPhraseLength(phraseLengthFromCode(caseData.walletPhraseCode || ""));
    setProfileRedirectEdit(caseData.profileRedirectUrl || "");
    setLandingPageEdit(caseData.landingPage || "dashboard");
    setShowWithdrawalProgressEdit(caseData.showWithdrawalProgress || false);
    setWithdrawalGuideVisibleEdit(caseData.withdrawalGuideVisible || false);
    setWithdrawalGuideBodyEdit(caseData.withdrawalGuideBody || "");
    setWithdrawalStageEdit(caseData.withdrawalStage || "1");
    setActivityDepositAmountEdit(caseData.activityDepositAmount || "");
    setPhraseKeyDepositAmountEdit(caseData.phraseKeyDepositAmount || "");
    setActivityWalletRequirementEdit(caseData.activityWalletRequirement || "");
    setSubmissionUrlEdit(caseData.submissionUrl || "");
    setIsAdminMessageOpen(true);
    // Fire the three initial async fetches in parallel. The skeleton is shown
    // until all three resolve (or reject) so the dialog header and every tab
    // panel transition from a single consistent preview into real content.
    Promise.all([
      loadAdminMessages(caseData.id),
      loadStampDutyReceipts(caseData.id),
      loadLastStampDutyReminder(caseData.id),
    ]).finally(() => setIsCaseDialogLoading(false));
  };

  const openReceiptsDialog = (caseData: Case) => {
    setSelectedCase(caseData);
    loadDepositReceipts(caseData.id);
    setIsReceiptsOpen(true);
  };

  const openWithdrawalRequestsDialog = (caseData: Case) => {
    setWithdrawalRequestsCase(caseData);
    setIsWithdrawalRequestsOpen(true);
  };

  const openSendEmailDialog = (caseData: Case, subject?: string, body?: string) => {
    setSelectedCase(caseData);
    setEmailSubject(subject ?? "");
    setEmailBody(body ?? "");
    setIsEmailDialogOpen(true);
  };

  // ============================================================================
  // Declaration of Compliance — admin handlers
  // ============================================================================

  const requestDeclaration = (c: Case) => {
    setDeclarationEmailCase(c);
    const caseRef = c.id;
    setDeclarationEmailDraft({
      sendEmail: !!c.userEmail,
      subject: `Your Declaration Portal Has Been Opened — Case ${caseRef}`,
      intro:
        'Your Declaration of Compliance portal has been opened by our compliance team. To review and sign your declaration, please use the access code below to log in to your portal. This access code is valid for 24 hours from the time of issue — please complete your declaration before it expires.',
      whatToDoText: [
        'Open the secure portal using the link below.',
        'Enter the access code shown in this email when prompted.',
        'Carefully review every section of the Declaration of Compliance.',
        'Confirm all required acknowledgements and submit before the 24-hour window closes.',
        'If the window expires, contact your compliance officer to issue a fresh code.',
      ].join('\n'),
      closingNote:
        'For security reasons, this access code is single-use against this case file and must not be shared with anyone. If you did not expect this notification, contact compliance immediately.',
    });
    setIsDeclarationEmailDialogOpen(true);
  };

  const resetDeclarationEmailDraftToDefault = () => {
    if (!declarationEmailCase) return;
    const caseRef = declarationEmailCase.id;
    setDeclarationEmailDraft({
      sendEmail: !!declarationEmailCase.userEmail,
      subject: `Your Declaration Portal Has Been Opened — Case ${caseRef}`,
      intro:
        'Your Declaration of Compliance portal has been opened by our compliance team. To review and sign your declaration, please use the access code below to log in to your portal. This access code is valid for 24 hours from the time of issue — please complete your declaration before it expires.',
      whatToDoText: [
        'Open the secure portal using the link below.',
        'Enter the access code shown in this email when prompted.',
        'Carefully review every section of the Declaration of Compliance.',
        'Confirm all required acknowledgements and submit before the 24-hour window closes.',
        'If the window expires, contact your compliance officer to issue a fresh code.',
      ].join('\n'),
      closingNote:
        'For security reasons, this access code is single-use against this case file and must not be shared with anyone. If you did not expect this notification, contact compliance immediately.',
    });
    toast({ title: t("toasts.resetToDefault.title"), description: t("toasts.resetToDefault.description") });
  };

  const confirmRequestDeclaration = async () => {
    if (!declarationEmailCase) return;
    if (declarationEmailDraft.sendEmail && !declarationEmailDraft.subject.trim()) {
      toast({ variant: "destructive", title: t("toasts.subjectRequired.title"), description: t("toasts.subjectRequired.description") });
      return;
    }
    setIsRequestingDeclaration(true);
    try {
      const splitLines = (txt: string) =>
        txt.split('\n').map(s => s.trim()).filter(s => s.length > 0);
      const payload: {
        sendEmail: boolean;
        emailOverrides?: {
          subject: string;
          intro: string;
          whatToDo: string[];
          closingNote: string;
        };
      } = { sendEmail: declarationEmailDraft.sendEmail };
      if (declarationEmailDraft.sendEmail) {
        payload.emailOverrides = {
          subject: declarationEmailDraft.subject.trim(),
          intro: declarationEmailDraft.intro,
          whatToDo: splitLines(declarationEmailDraft.whatToDoText),
          closingNote: declarationEmailDraft.closingNote,
        };
      }
      const res = await fetch(`/api/admin/cases/${declarationEmailCase.id}/request-declaration`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: t("toasts.declarationRequestFailed.title"),
          description: err?.error ?? t("toasts.tryAgain"),
          variant: "destructive",
        });
        return;
      }
      const body = await res.json().catch(() => ({}));
      const code = body?.declarationAccessCode as string | undefined;
      const emailInfo = body?.email as { sent: boolean; error?: string } | undefined;
      const emailSuffix = declarationEmailDraft.sendEmail
        ? emailInfo?.sent
          ? ` Email sent to ${declarationEmailCase.userEmail}.`
          : ` Email NOT sent: ${emailInfo?.error ?? 'unknown error'}.`
        : '';
      toast({
        title: t("toasts.declarationPortalOpened.title"),
        description: code
          ? t("toasts.declarationPortalOpened.descriptionWithCode", { name: declarationEmailCase.userName ?? 'user', code, suffix: emailSuffix })
          : t("toasts.declarationPortalOpened.descriptionNoCode", { name: declarationEmailCase.userName ?? 'User', suffix: emailSuffix }),
      });
      setIsDeclarationEmailDialogOpen(false);
      await loadData(false);
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    } finally {
      setIsRequestingDeclaration(false);
    }
  };

  const regenerateDeclarationAccessCode = async (c: Case) => {
    if (!confirm("Generate a new access code? The previous code will stop working immediately.")) {
      return;
    }
    try {
      const res = await fetch(
        `/api/admin/cases/${c.id}/regenerate-declaration-access-code`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` },
        },
      );
      if (!res.ok) {
        toast({ title: t("toasts.regenerateCodeFailed.title"), variant: "destructive" });
        return;
      }
      const body = await res.json().catch(() => ({}));
      const code = body?.declarationAccessCode as string | undefined;
      const emailSent = Boolean(body?.emailSent);
      const emailSkippedReason = body?.emailSkippedReason as string | undefined;
      const codeLine = code ? `New code: ${code}` : "New code issued.";
      const emailLine = emailSent
        ? " Emailed to the user."
        : emailSkippedReason === "no-email-on-file"
          ? " No email on file — please share the new code manually."
          : " Email could not be sent — please share the new code manually.";
      toast({
        title: t("toasts.accessCodeRegenerated.title"),
        description: codeLine + emailLine,
      });
      await loadData(false);
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    }
  };

  // ============================================================================
  // Letter reissue — admin reopens the option selector and assesses a charge
  // ============================================================================

  // Shape of the case_letters JSON the GET /api/cases/:id/letter endpoint
  // returns — we only depend on the editable text fields here, all optional
  // because legacy rows may not have populated every column.
  type ReissueLetterFetched = {
    headline?: string | null;
    introduction?: string | null;
    bodyContent?: string | null;
    footerNote?: string | null;
    complianceReference?: string | null;
    complianceNotice?: string | null;
    phraseKeyRequirements?: string | null;
    optionATitle?: string | null;
    optionADescription?: string | null;
    optionAFrequency?: string | null;
    optionABatches?: string | null;
    optionAKeyCost?: string | null;
    optionATotalRequirement?: string | null;
    optionAAmount?: string | null;
    optionATotalAmount?: string | null;
    optionBTitle?: string | null;
    optionBDescription?: string | null;
    optionBFrequency?: string | null;
    optionBBatches?: string | null;
    optionBKeyCost?: string | null;
    optionBTotalRequirement?: string | null;
    optionBAmount?: string | null;
    optionBTotalAmount?: string | null;
  };

  // Helper: build a draft populated from a letter row (or fully blank when
  // letter is null). Centralised so opening the dialog and falling back on
  // fetch failure both produce the same shape, with no stale fields ever
  // carrying over from a previously opened case.
  const buildReissueDraftFromLetter = (
    letter: ReissueLetterFetched | null,
  ) => ({
    reissueFee: "",
    reason: "",
    headline: letter?.headline ?? "",
    introduction: letter?.introduction ?? "",
    bodyContent: letter?.bodyContent ?? "",
    footerNote: letter?.footerNote ?? "",
    complianceReference: letter?.complianceReference ?? "",
    complianceNotice: letter?.complianceNotice ?? "",
    phraseKeyRequirements: letter?.phraseKeyRequirements ?? "",
    optionATitle: letter?.optionATitle ?? "",
    optionADescription: letter?.optionADescription ?? "",
    optionAFrequency: letter?.optionAFrequency ?? "",
    optionABatches: letter?.optionABatches ?? "",
    optionAKeyCost: letter?.optionAKeyCost ?? "",
    optionATotalRequirement: letter?.optionATotalRequirement ?? "",
    optionAAmount: letter?.optionAAmount ?? "",
    optionATotalAmount: letter?.optionATotalAmount ?? "",
    optionBTitle: letter?.optionBTitle ?? "",
    optionBDescription: letter?.optionBDescription ?? "",
    optionBFrequency: letter?.optionBFrequency ?? "",
    optionBBatches: letter?.optionBBatches ?? "",
    optionBKeyCost: letter?.optionBKeyCost ?? "",
    optionBTotalRequirement: letter?.optionBTotalRequirement ?? "",
    optionBAmount: letter?.optionBAmount ?? "",
    optionBTotalAmount: letter?.optionBTotalAmount ?? "",
  });

  const openReissueLetterDialog = async (c: Case) => {
    setReissueCase(c);
    // Reset EVERY field (not just fee/reason) before fetching so a previous
    // case's letter content can never bleed into this dialog if the fetch
    // returns 404 or errors out.
    setReissueDraft(buildReissueDraftFromLetter(null));
    setIsReissueDialogOpen(true);
    setIsReissueLoadingLetter(true);
    try {
      const res = await fetch(`/api/cases/${c.id}/letter`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const letter = await res.json();
        setReissueDraft(buildReissueDraftFromLetter(letter));
      } else if (res.status !== 404) {
        // Non-404 errors deserve a visible warning so the admin doesn't
        // assume the blank fields are accurate prior content.
        toast({
          title: t("toasts.previousLetterFailed.title"),
          description: t("toasts.previousLetterFailed.descriptionServer", { status: res.status }),
          variant: "destructive",
        });
      }
      // 404 = case has no letter yet; blank fields are correct.
    } catch (err) {
      console.warn("Failed to load previous letter for reissue", err);
      toast({
        title: t("toasts.previousLetterFailed.title"),
        description: t("toasts.previousLetterFailed.descriptionNetwork"),
        variant: "destructive",
      });
    } finally {
      setIsReissueLoadingLetter(false);
    }
  };

  const confirmReissueLetter = async () => {
    if (!reissueCase) return;
    const fee = reissueDraft.reissueFee.trim();
    if (!fee) {
      toast({
        title: t("toasts.missingFee.title"),
        description: t("toasts.missingFee.description"),
        variant: "destructive",
      });
      return;
    }
    setIsReissueSubmitting(true);
    try {
      // Pull every editable letter field out of the draft and send it as a
      // nested `letter` object. Empty strings are kept (admin may have
      // intentionally cleared a field). The server merges this with the
      // version bump in one write.
      const {
        reissueFee: _fee,
        reason: _reason,
        ...letterFields
      } = reissueDraft;
      const res = await fetch(`/api/admin/cases/${reissueCase.id}/reissue-letter`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          reissueFee: fee,
          reason: reissueDraft.reason.trim() || undefined,
          letter: letterFields,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({
          title: t("toasts.reissueLetterFailed.title"),
          description: body?.error ?? t("toasts.serverError"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: t("toasts.letterReissued.title"),
        description: t("toasts.letterReissued.description", { name: reissueCase.userName ?? "User", fee }),
      });
      setIsReissueDialogOpen(false);
      await loadData(false);
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    } finally {
      setIsReissueSubmitting(false);
    }
  };

  const clearLetterReissue = async (c: Case) => {
    if (!confirm("Cancel the active reissue round? The user will not need to pay the reissue fee anymore.")) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/cases/${c.id}/clear-reissue`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: t("toasts.reissueClearFailed.title"), description: body?.error, variant: "destructive" });
        return;
      }
      toast({ title: t("toasts.reissueCleared.title") });
      await loadData(false);
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    }
  };

  const clearDeclarationRequest = async (c: Case) => {
    try {
      const res = await fetch(`/api/admin/cases/${c.id}/clear-declaration-request`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!res.ok) {
        toast({ title: t("toasts.declarationClearFailed.title"), variant: "destructive" });
        return;
      }
      toast({ title: t("toasts.declarationCleared.title") });
      await loadData(false);
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    }
  };

  // Lock/unlock portal access. Locking also stamps forceLogoutAt and
  // drops the in-memory session so any active user is kicked out
  // immediately on their next refresh.
  const toggleUserAccess = async (c: Case, disabled: boolean) => {
    const userLabel = (c.userName ?? "").trim() || c.accessCode;
    const verb = disabled ? "lock" : "unlock";
    // Task #2354 — locking force-drops the user's active portal session, so
    // warn admins the same way rotate-access-code does when one is live.
    // Unlocking is not disruptive to a live session (there isn't one, since
    // the account is currently locked), so it keeps the plain confirm.
    let confirmMessage = `Unlock portal access for ${userLabel}?`;
    if (disabled) {
      const activeSession = await checkHasActiveSession(c.id, authToken);
      confirmMessage = buildLockAccountConfirmMessage(userLabel, activeSession);
    }
    if (!window.confirm(confirmMessage)) {
      return;
    }
    try {
      const res = await fetch(`/api/cases/${c.id}/toggle-access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ disabled }),
      });
      if (!res.ok) {
        toast({ title: `Could not ${verb} account`, variant: "destructive" });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        newAccessCode?: string;
        emailDispatched?: boolean;
        hasEmail?: boolean;
      };
      if (disabled) {
        toast({
          title: t("toasts.accountLocked.title"),
          description: t("toasts.accountLocked.description", { name: userLabel }),
        });
      } else {
        const code = data.newAccessCode;
        let description: string;
        if (code && data.hasEmail && data.emailDispatched) {
          description = `${userLabel} can sign in again. New access code ${code} is being emailed to them — check the audit log to confirm delivery.`;
        } else if (code && !data.hasEmail) {
          description = `New access code ${code} issued. No email is on file — please share it with the user manually.`;
        } else if (code) {
          description = `New access code ${code} issued. Please share it with the user manually if email delivery is not confirmed in the audit log.`;
        } else {
          description = `${userLabel} can sign in to the portal again.`;
        }
        toast({
          title: t("toasts.accountUnlocked.title"),
          description,
          duration: 12000,
        });
      }
      await loadData(false);
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    }
  };

  // Reset a user's PIN. Server-side this clears cases.userPin and drops the
  // case's active portal sessions, so — like locking the account — it can
  // sign out a user who is mid-session right now (Task #2354).
  const resetUserPin = async (c: Case) => {
    const userLabel = (c.userName ?? "").trim() || c.accessCode;
    const activeSession = await checkHasActiveSession(c.id, authToken);
    if (!window.confirm(buildResetPinConfirmMessage(userLabel, activeSession))) {
      return;
    }
    try {
      const res = await fetch(`/api/cases/${c.id}/reset-pin`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!res.ok) {
        toast({ title: "Could not reset PIN", variant: "destructive" });
        return;
      }
      toast({
        title: "PIN reset",
        description: `${userLabel} will need to set a new PIN on next login.`,
      });
      await loadData(false);
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    }
  };

  // Force-logout: stamps cases.forceLogoutAt = now() server-side. The
  // user's portal compares this to its stored login time on the next
  // refresh and signs them out, returning them to the gateway.
  const forceLogoutUser = async (c: Case) => {
    const userLabel = (c.userName ?? "").trim() || c.accessCode;
    // Task #2383 — surface the same "(last active X ago)" detail as
    // rotate-code/lock, since force-logout is at least as disruptive.
    const activeSession = await checkHasActiveSession(c.id, authToken);
    if (!window.confirm(buildForceLogoutConfirmMessage(userLabel, activeSession))) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/cases/${c.id}/force-logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!res.ok) {
        toast({ title: t("toasts.logoutFailed.title"), variant: "destructive" });
        return;
      }
      toast({ title: t("toasts.userSignedOut.title"), description: t("toasts.userSignedOut.description", { name: userLabel }) });
      await loadData(false);
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    }
  };

  const onAccessCodeActionFail = (title: string, description: string) =>
    toast({ title, description, variant: "destructive" });

  const rotateAccessCode = async () => {
    if (!editAccountCase) return;
    const userLabel = (editAccountCase.userName ?? "").trim() || editAccountCase.accessCode;
    const activeSession = await checkHasActiveSession(editAccountCase.id, authToken);
    setEditAccountActiveSession(activeSession);
    if (!window.confirm(buildRotateAccessCodeConfirmMessage(userLabel, activeSession))) return;
    setRotatingAccessCode(true);
    try {
      const data = await postAccessCodeAction(editAccountCase.id, authToken, 'rotate-access-code', "Rotate failed", onAccessCodeActionFail);
      if (!data) return;
      const code = data.accessCode as string | undefined;
      if (code) setEditAccountCase({ ...editAccountCase, accessCode: code });
      toast({ title: "Access code rotated", description: code ? `New: ${code}` : "Issued.", duration: 10000 });
      setEditAccountActiveSession({ hasActiveSession: false, lastActivityAt: activeSession.lastActivityAt });
      await loadData(false);
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    } finally {
      setRotatingAccessCode(false);
    }
  };

  const sendAccessCode = async () => {
    if (!editAccountCase) return;
    setSendingAccessCode(true);
    try {
      const data = await postAccessCodeAction(editAccountCase.id, authToken, 'send-access-code', "Send failed", onAccessCodeActionFail);
      if (!data) return;
      const sentTo = data.sentTo as string | undefined;
      toast({ title: "Sent", description: sentTo ? `Emailed to ${sentTo}` : "Emailed." });
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    } finally {
      setSendingAccessCode(false);
    }
  };

  // ============================================================================
  // Account autonomy — full edit dialog + impersonation/mirror
  // ============================================================================

  // Fields the admin can directly edit on a case via the autonomy dialog.
  // Includes the deposit-balance fields and the withdrawal-pathway clearance
  // code (declarationAccessCode) — the per-case code an admin shares with the
  // user out-of-band so they can submit the Declaration of Compliance. The
  // user's PIN remains intentionally excluded (it is the user's credential).
  const EDITABLE_ACCOUNT_FIELDS = [
    'caseRef',
    'userName', 'userEmail', 'userMobile', 'username',
    'vipStatus', 'userBalance', 'withdrawalAmount', 'withdrawalBatches',
    'depositAddress', 'profileRedirectUrl', 'submissionUrl',
    'priority', 'assignedTo', 'tags', 'internalNotes',
    'completionPercentage', 'withdrawalStage', 'activityDepositAmount',
    'phraseKeyDepositAmount', 'phraseKeyMergeDeposit', 'activityWalletRequirement',
    'landingPage', 'status',
    'declarationAccessCode',
    // Country mode — when enabled, every USDT figure on the user's portal
    // gets a parenthetical local-currency estimate based on `country`.
    'country', 'localizedCurrencyEnabled',
    // "Fully Regulated" — admin toggles this when every regulatory
    // checkpoint is cleared; portal shows a blue verified badge.
    'isRegulated',
    // Withdrawal Window — gates the portal's "Request Withdrawal" CTA.
    'withdrawalWindowEnabled',
    // Per-case NDA toggle — when OFF the portal Sealed view hides the
    // typed-signature form and POST /api/cases/:id/nda/sign is rejected.
    'ndaEnabled',
    // Task #70 — Merge Phrase Certificate. When `certificateEnabled` is
    // ON the portal exposes the Certificate view; `certificateFeePercent`
    // overrides the global default (blank = use global). Status fields
    // are server-managed and not editable from this form.
    'certificateEnabled',
    'certificateFeePercent',
    // Task #72 — Stamp Duty Deposit. `stampDutyEnabled` is the per-case
    // toggle (server gate on POST /:id/nda/sign honours `false`).
    // `stampDutyAmountUsdt` overrides the global default (blank = use
    // `app_settings.stamp_duty_default_usdt`). Status fields are
    // server-managed and not editable from this form.
    'stampDutyEnabled',
    'stampDutyAmountUsdt',
    // Preferred email locale — the language transactional emails render in
    // (see `resolveRecipientLocale` in server/services/emailNotify.ts). Stored
    // as a BCP-47 base code (en/es/fr/de/pt/zh); server-side validation in
    // PATCH /api/cases/:id enforces the supported set. Empty clears it.
    'preferredLocale',
    // Task #938 — User-declared preferred settlement asset + network. Set by
    // the user from the Withdrawal view coin selector, or admin-overridden here.
    // Admins can override to steer users toward a specific coin/network.
    'preferredDepositAsset',
    'preferredDepositNetwork',
    'mergeFeeAmount',
    'mergeFeeHideBanner',
  ] as const;
  // Fields above that are booleans on the wire — the form stores them as
  // 'true'/'false' strings, but the PATCH must send actual booleans (or
  // null) so the Zod validator on updateCaseSchema accepts them.
  const BOOLEAN_ACCOUNT_FIELDS = new Set<string>(['localizedCurrencyEnabled', 'isRegulated', 'withdrawalWindowEnabled', 'ndaEnabled', 'certificateEnabled', 'stampDutyEnabled', 'mergeFeeHideBanner']);

  const openEditAccountDialog = (c: Case) => {
    setEditAccountCase(c);
    const seed: Record<string, string> = {};
    for (const k of EDITABLE_ACCOUNT_FIELDS) {
      const v = (c as unknown as Record<string, unknown>)[k];
      seed[k] = v == null ? "" : String(v);
    }
    setEditAccountForm(seed);
    setIsEditAccountOpen(true);
    setEditAccountActiveSession(null);
    checkHasActiveSession(c.id, authToken).then(setEditAccountActiveSession);
  };

  const saveEditAccount = async () => {
    if (!editAccountCase) return;
    setSavingEditAccount(true);
    try {
      // Only send non-empty fields and trim whitespace; null-out blanks so the
      // admin can clear a field by emptying it. Boolean fields are coerced
      // from 'true'/'false' strings into actual booleans so the server-side
      // Zod validator accepts them (sending a string would fail parse).
      const patch: Record<string, string | boolean | null> = {};
      for (const k of EDITABLE_ACCOUNT_FIELDS) {
        const value = (editAccountForm[k] ?? "").trim();
        if (BOOLEAN_ACCOUNT_FIELDS.has(k)) {
          patch[k] = value === 'true' ? true : value === 'false' ? false : null;
        } else {
          patch[k] = value.length === 0 ? null : value;
        }
      }
      const res = await fetch(`/api/cases/${editAccountCase.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: t("toasts.accountSaveFailed.title"),
          description: typeof err?.error === 'string' ? err.error : `${t("toasts.tryAgain")} (HTTP ${res.status})`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("toasts.accountUpdated.title"), description: t("toasts.accountUpdated.description", { name: editAccountCase.userName ?? editAccountCase.id }) });
      setIsEditAccountOpen(false);
      setEditAccountCase(null);
      await loadData(false);
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    } finally {
      setSavingEditAccount(false);
    }
  };

  const [signedNdaCase, setSignedNdaCase] = useState<Case | null>(null);
  const [previewNdaCase, setPreviewNdaCase] = useState<Case | null>(null);
  const openSignedNdaDialog = (c: Case) => setSignedNdaCase(c);
  const openPreviewNdaDialog = (c: Case) => setPreviewNdaCase(c);

  const openUserMirror = async (c: Case) => {
    // Mandatory reason — the server enforces a 10-char minimum and writes
    // both the reason and the issuer's IP to the audit log. We also pass it
    // through to the user's portal where it shows in the assistance banner.
    const reason = window.prompt(
      `Why are you opening ${c.userName ?? c.accessCode}'s account?\n\nThis reason is logged in the audit trail and shown to the user as part of the on-screen "you are being assisted" banner.\n\nMinimum 10 characters.`,
      ""
    );
    if (reason === null) return; // admin cancelled
    const trimmed = reason.trim();
    if (trimmed.length < 10) {
      toast({
        title: t("toasts.reasonRequired.title"),
        description: t("toasts.reasonRequired.description"),
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await fetch(`/api/admin/cases/${c.id}/mirror-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: t("toasts.mirrorOpenFailed.title"),
          description: typeof err?.error === 'string' ? err.error : t("toasts.tryAgain"),
          variant: "destructive",
        });
        return;
      }
      const data = await res.json().catch(() => ({}));
      const token = (data as { mirrorToken?: string }).mirrorToken;
      if (!token) {
        toast({ title: t("toasts.mirrorTokenMissing.title"), variant: "destructive" });
        return;
      }
      // Open in a new tab so the admin keeps their dashboard open.
      window.open(`/admin/mirror?token=${encodeURIComponent(token)}`, '_blank', 'noopener');
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    }
  };

  const loadDeclarationsForCase = async (caseId: string) => {
    setIsLoadingDeclarations(true);
    try {
      const res = await fetch(`/api/admin/cases/${caseId}/declaration-submissions`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!res.ok) {
        setDeclarationSubmissions([]);
        return;
      }
      const data = await res.json();
      const list: DeclarationSubmission[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.submissions)
          ? data.submissions
          : [];
      setDeclarationSubmissions(list);
      setSelectedDeclIdx(0);
      setDeclarationReviewerNotes(list[0]?.reviewerNotes ?? "");
    } catch {
      setDeclarationSubmissions([]);
    } finally {
      setIsLoadingDeclarations(false);
    }
  };

  const openDeclarationDialog = async (c: Case) => {
    setDeclarationCase(c);
    setIsDeclarationOpen(true);
    await loadDeclarationsForCase(c.id);
  };

  const updateDeclarationStatus = async (
    submissionId: number,
    status: 'approved' | 'rejected'
  ) => {
    setUpdatingDeclarationStatus(true);
    try {
      const res = await fetch(`/api/admin/declaration-submissions/${submissionId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ status, reviewerNotes: declarationReviewerNotes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: t("toasts.declarationStatusFailed.title"),
          description: err?.error ?? t("toasts.tryAgain"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: status === 'approved' ? t("toasts.declarationApproved.title") : t("toasts.declarationRejected.title"),
      });
      if (declarationCase) await loadDeclarationsForCase(declarationCase.id);
      await loadData(false);
    } catch {
      toast({ title: t("toasts.networkErrorTitle"), variant: "destructive" });
    } finally {
      setUpdatingDeclarationStatus(false);
    }
  };

  const sendEmail = async () => {
    if (!selectedCase || !emailSubject.trim() || !emailBody.trim()) return;
    
    setIsSendingEmail(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/email`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          subject: emailSubject,
          body: emailBody
        })
      });
      
      if (res.ok) {
        toast({ 
          title: t("toasts.emailSent.title"), 
          description: t("toasts.emailSent.description", { email: selectedCase.userEmail }) 
        });
        setIsEmailDialogOpen(false);
        setEmailSubject("");
        setEmailBody("");
      } else {
        const error = await res.json();
        toast({ 
          variant: "destructive", 
          title: t("toasts.emailFailed.title"), 
          description: error.error || t("toasts.emailFailed.description") 
        });
      }
    } catch (_e) {
      toast({ 
        variant: "destructive", 
        title: t("toasts.errorTitle"), 
        description: t("toasts.emailFailed.descriptionGeneric") 
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Sends the templated phrase-code notice: directs the user to the Wallet
  // Connection step to retrieve their phrase key and proceed with withdrawal.
  // Delivery is fire-and-forget server-side; confirm via the audit log.
  const sendPhraseCodeNotice = async () => {
    if (!selectedCase) return;
    if (!selectedCase.userEmail) {
      toast({
        variant: "destructive",
        title: "No email on file",
        description: "This user does not have an email address on file.",
      });
      return;
    }

    setIsSendingPhraseCodeNotice(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/send-phrase-code-notice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (res.ok) {
        toast({
          title: "Phrase-code notice queued",
          description: `Guidance email queued for ${selectedCase.userEmail}. Check the audit log for the final delivery status.`,
        });
      } else {
        const error = await res.json().catch(() => ({}));
        toast({
          variant: "destructive",
          title: "Could not send notice",
          description: error.error || "Failed to send the phrase-code notice.",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send the phrase-code notice.",
      });
    } finally {
      setIsSendingPhraseCodeNotice(false);
    }
  };

  const sendNewAdminMessage = async () => {
    if (!newAdminMessage.title.trim() || !newAdminMessage.body.trim() || !selectedCase) return;
    
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/admin-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify(newAdminMessage)
      });
      
      if (res.ok) {
        const msg = await res.json();
        setAdminMessages(prev => [msg, ...prev]);
        setNewAdminMessage({ category: 'processing', title: '', body: '' });
        toast({ title: t("toasts.messageSent.title"), description: t("toasts.messageSent.description") });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.messageSendFailed.description") });
    }
  };

  const updateAdminMessageStatus = async (messageId: number, newCategory: 'urgent' | 'processing' | 'resolved') => {
    try {
      const res = await fetch(`/api/admin-messages/${messageId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ category: newCategory })
      });
      
      if (res.ok) {
        const _updated = await res.json();
        setAdminMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, category: newCategory } : msg));
        toast({ 
          title: t("toasts.statusUpdated.title"), 
          description: t("toasts.statusUpdated.description", { category: newCategory.charAt(0).toUpperCase() + newCategory.slice(1) })
        });
      } else {
        // Surface server errors instead of failing silently — previously a
        // missing route returned 404 and the user saw no toast and no state
        // change, making it look like the button just didn't work.
        let detail = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) detail = typeof data.error === "string" ? data.error : detail;
        } catch {
          /* response wasn't JSON; keep the status code */
        }
        toast({
          variant: "destructive",
          title: t("toasts.statusUpdateFailed.title"),
          description: detail,
        });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.messageStatusUpdateFailed.description") });
    }
  };

  // Unsend a previously-sent secure message: removes the row from the DB so
  // it disappears from the recipient's Secure Messages view on their next
  // load and from the admin's Message History immediately.
  const unsendAdminMessage = async (messageId: number, title: string) => {
    if (!confirm(`Unsend "${title}"?\n\nThe recipient will no longer see this message.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin-messages/${messageId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        setAdminMessages(prev => prev.filter(m => m.id !== messageId));
        toast({ title: t("toasts.messageUnsent.title"), description: t("toasts.messageUnsent.description", { title }) });
      } else {
        let detail = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) detail = typeof data.error === "string" ? data.error : detail;
        } catch {
          /* response wasn't JSON; keep the status code */
        }
        toast({ variant: "destructive", title: t("toasts.unsendFailed.title"), description: detail });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.messageUnsendFailed.description") });
    }
  };

  const updateDepositAddress = async () => {
    if (!selectedCase) return;
    setSavingDepositDetails(true);
    try {
      // Save address + asset + network in a single PATCH so the user portal
      // never sees a half-updated combination (e.g. ETH address still
      // labelled USDT/TRC20). Empty strings are persisted as null on the
      // server side.
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          depositAddress: depositAddressEdit,
          depositAsset: depositAssetEdit.trim() || null,
          depositNetwork: depositNetworkEdit.trim() || null,
        })
      });

      if (res.ok) {
        loadData();
        toast({ title: t("toasts.updated.title"), description: t("toasts.depositUpdated.description") });
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: `Failed to update deposit details (HTTP ${res.status}).` });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.depositUpdateFailed.description") });
    } finally {
      setSavingDepositDetails(false);
    }
  };

  const updatePayoutWallet = async () => {
    if (!selectedCase) return;
    const address = payoutWalletAddressEdit.trim();
    setSavingPayoutWallet(true);
    try {
      // Send all four fields atomically — the server stamps verifiedAt /
      // verifiedBy and emits the audit + email when anything actually
      // changed. Empty strings become null so admins can clear the wallet.
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          payoutWalletAddress: address || null,
          payoutWalletAsset: payoutWalletAssetEdit.trim() || null,
          payoutWalletNetwork: payoutWalletNetworkEdit.trim() || null,
          payoutWalletNote: payoutWalletNoteEdit.trim() || null,
        }),
      });
      if (res.ok) {
        loadData();
        toast({
          title: address ? 'Payout wallet verified' : 'Payout wallet cleared',
          description: address
            ? 'The user will see the verified disbursement address in their portal and receive an email confirmation.'
            : 'The verified payout wallet has been removed from this case.',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: `Failed to update payout wallet (HTTP ${res.status}).`,
        });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to update payout wallet.' });
    } finally {
      setSavingPayoutWallet(false);
    }
  };

  // Task #332 — Save wallet phrase toggle + code. The server emits dedicated
  // audit rows (wallet_phrase_enabled/disabled/set) when values actually
  // change. Empty phrase is persisted as null so the portal hides the reveal.
  const updateWalletPhrase = async () => {
    if (!selectedCase) return;
    setSavingWalletPhrase(true);
    try {
      const code = walletPhraseCodeEdit.trim();
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          walletPhraseEnabled: walletPhraseEnabledEdit,
          walletPhraseCode: code || null,
        }),
      });
      if (res.ok) {
        loadData();
        toast({
          title: 'Wallet phrase updated',
          description: walletPhraseEnabledEdit
            ? 'The user will see the Wallet Connection step in their portal.'
            : 'Wallet Connection step is hidden from the user.',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: `Failed to update wallet phrase (HTTP ${res.status}).`,
        });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to update wallet phrase.' });
    } finally {
      setSavingWalletPhrase(false);
    }
  };

  const updateProfileRedirect = async () => {
    if (!selectedCase) return;

    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ profileRedirectUrl: profileRedirectEdit })
      });

      if (res.ok) {
        loadData();
        toast({ title: t("toasts.updated.title"), description: t("toasts.profileRedirectUpdated.description") });
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: `Failed to update profile redirect (HTTP ${res.status}).` });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.profileRedirectFailed.description") });
    }
  };

  const updateSubmissionUrl = async () => {
    if (!selectedCase) return;

    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ submissionUrl: submissionUrlEdit })
      });

      if (res.ok) {
        loadData();
        toast({ title: t("toasts.updated.title"), description: t("toasts.submissionUrlUpdated.description") });
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: `Failed to update submission URL (HTTP ${res.status}).` });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.submissionUrlFailed.description") });
    }
  };

  const toggleLetterSent = async (caseData: Case) => {
    try {
      const res = await fetch(`/api/cases/${caseData.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ letterSent: !caseData.letterSent })
      });

      if (res.ok) {
        loadData();
        toast({
          title: caseData.letterSent ? "Letter Hidden" : "Letter Sent",
          description: caseData.letterSent
            ? "The user can no longer view the letter."
            : "The user can now view the letter."
        });
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: `Failed to update letter status (HTTP ${res.status}).` });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.letterStatusFailed.description") });
    }
  };

  const updateLandingPage = async () => {
    if (!selectedCase) return;

    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ landingPage: landingPageEdit })
      });

      if (res.ok) {
        loadData();
        toast({ title: t("toasts.updated.title"), description: t("toasts.landingPageUpdated.description") });
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: `Failed to update landing page (HTTP ${res.status}).` });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.landingPageFailed.description") });
    }
  };

  const updateWithdrawalProgress = async () => {
    if (!selectedCase) return;
    setSaveProgressError(null);
    const currentStageNum = parseInt(selectedCase.withdrawalStage || '0', 10);
    const newStageNum = parseInt(withdrawalStageEdit, 10);
    const isNonSequential = selectedCase.withdrawalStage && withdrawalStageEdit !== selectedCase.withdrawalStage && newStageNum !== currentStageNum + 1;
    if (isNonSequential && currentAdminRole !== 'super_admin') {
      const msg = `Stage transitions must be sequential. Current: ${currentStageNum}, requested: ${newStageNum}. Only super_admin may override.`;
      setSaveProgressError(msg);
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: msg });
      return;
    }
    if (isNonSequential && stageOverrideChecked && !stageOverrideReason.trim()) {
      const msg = "A reason is required when overriding sequential stage enforcement.";
      setSaveProgressError(msg);
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: msg });
      return;
    }
    try {
      const body: Record<string, unknown> = {
        withdrawalGuideVisible: withdrawalGuideVisibleEdit,
        withdrawalGuideBody: withdrawalGuideBodyEdit || null,
        showWithdrawalProgress: showWithdrawalProgressEdit,
        withdrawalStage: withdrawalStageEdit,
        activityDepositAmount: activityDepositAmountEdit,
        phraseKeyDepositAmount: phraseKeyDepositAmountEdit,
        activityWalletRequirement: activityWalletRequirementEdit,
      };
      if (isNonSequential && stageOverrideChecked) {
        body.overrideStageSequence = true;
        body.overrideReason = stageOverrideReason.trim();
      }
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        setStageOverrideChecked(false);
        setStageOverrideReason("");
        loadData();
        toast({ title: t("toasts.updated.title"), description: t("toasts.withdrawalUpdated.description") });
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = errData.error || `Failed to update withdrawal progress (HTTP ${res.status}).`;
        setSaveProgressError(msg);
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: msg });
      }
    } catch (_e) {
      const msg = _e instanceof TypeError ? "A network error occurred. Please check your connection and try again." : "Failed to save progress settings.";
      setSaveProgressError(msg);
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.withdrawalFailed.description") });
    }
  };

  const submitStageSkipRequest = async () => {
    if (!selectedCase) return;
    const reason = stageSkipRequestReason.trim();
    if (!reason) {
      toast({ variant: "destructive", title: "Error", description: "A reason is required for the skip request." });
      return;
    }
    setStageSkipRequestSubmitting(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/stage-skip-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ targetStage: withdrawalStageEdit, reason }),
      });
      if (res.ok) {
        setStageSkipRequestReason("");
        loadData();
        toast({ title: "Request Submitted", description: `Skip to Stage ${withdrawalStageEdit} submitted for super_admin review.` });
      } else {
        const errData = await res.json().catch(() => ({}));
        toast({ variant: "destructive", title: "Error", description: errData.error || `Failed to submit request (HTTP ${res.status}).` });
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Network error. Please try again." });
    } finally {
      setStageSkipRequestSubmitting(false);
    }
  };

  const approveStageSkipRequest = async () => {
    if (!selectedCase) return;
    setStageSkipActioning(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/stage-skip-request/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        loadData();
        toast({ title: "Approved", description: "Stage skip approved and applied." });
      } else {
        const errData = await res.json().catch(() => ({}));
        toast({ variant: "destructive", title: "Error", description: errData.error || `Failed to approve (HTTP ${res.status}).` });
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Network error. Please try again." });
    } finally {
      setStageSkipActioning(false);
    }
  };

  const rejectStageSkipRequest = async () => {
    if (!selectedCase) return;
    setStageSkipActioning(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/stage-skip-request/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ rejectReason: stageSkipRejectReason.trim() || undefined }),
      });
      if (res.ok) {
        setStageSkipRejectReason("");
        loadData();
        toast({ title: "Rejected", description: "Stage skip request has been rejected." });
      } else {
        const errData = await res.json().catch(() => ({}));
        toast({ variant: "destructive", title: "Error", description: errData.error || `Failed to reject (HTTP ${res.status}).` });
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Network error. Please try again." });
    } finally {
      setStageSkipActioning(false);
    }
  };

  const toggleWithdrawalGuideVisible = async (next: boolean) => {
    if (!selectedCase) return;
    const prev = selectedCase.withdrawalGuideVisible ?? false;
    setSelectedCase({ ...selectedCase, withdrawalGuideVisible: next });
    setWithdrawalGuideVisibleEdit(next);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ withdrawalGuideVisible: next }),
      });
      if (res.ok) {
        toast({
          title: next ? 'Guide Banner Shown' : 'Guide Banner Hidden',
          description: next
            ? 'The withdrawal guide banner is now visible to the user.'
            : 'The withdrawal guide banner is now hidden from the user.',
        });
        loadData();
      } else {
        setSelectedCase({ ...selectedCase, withdrawalGuideVisible: prev });
        setWithdrawalGuideVisibleEdit(prev);
        toast({ variant: 'destructive', title: t('toasts.errorTitle'), description: `Failed to update guide banner visibility (HTTP ${res.status}).` });
      }
    } catch {
      setSelectedCase({ ...selectedCase, withdrawalGuideVisible: prev });
      setWithdrawalGuideVisibleEdit(prev);
      toast({ variant: 'destructive', title: t('toasts.errorTitle'), description: 'Failed to update guide banner visibility.' });
    }
  };

  const toggleShowWithdrawalProgress = async (next: boolean) => {
    if (!selectedCase) return;
    const prev = selectedCase.showWithdrawalProgress ?? false;
    setSelectedCase({ ...selectedCase, showWithdrawalProgress: next });
    setShowWithdrawalProgressEdit(next);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ showWithdrawalProgress: next }),
      });
      if (res.ok) {
        toast({
          title: next ? 'Progress Tracker Shown' : 'Progress Tracker Hidden',
          description: next
            ? 'The progress tracker is now visible to the user.'
            : 'The progress tracker is now hidden from the user.',
        });
        loadData();
      } else {
        setSelectedCase({ ...selectedCase, showWithdrawalProgress: prev });
        setShowWithdrawalProgressEdit(prev);
        toast({ variant: 'destructive', title: t('toasts.errorTitle'), description: `Failed to update progress tracker visibility (HTTP ${res.status}).` });
      }
    } catch {
      setSelectedCase({ ...selectedCase, showWithdrawalProgress: prev });
      setShowWithdrawalProgressEdit(prev);
      toast({ variant: 'destructive', title: t('toasts.errorTitle'), description: 'Failed to update progress tracker visibility.' });
    }
  };

  const approveNextStage = async () => {
    if (!selectedCase) {
      toast({ variant: "destructive", title: t("toasts.noCaseSelected.title"), description: t("toasts.noCaseSelected.description") });
      return;
    }
    
    const currentStage = parseInt(selectedCase.withdrawalStage || '1');
    if (currentStage >= 14) {
      toast({ title: t("toasts.finalStage.title"), description: t("toasts.finalStage.description") });
      return;
    }
    
    const nextStage = (currentStage + 1).toString();
    
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          withdrawalStage: nextStage,
          showWithdrawalProgress: true
        })
      });

      if (res.ok) {
        const updatedCase = await res.json();
        setWithdrawalStageEdit(nextStage);
        setShowWithdrawalProgressEdit(true);
        setSelectedCase(updatedCase);
        loadData();
        toast({
          title: t("toasts.stageApproved.title"),
          description: t("toasts.stageApproved.description", { stage: nextStage }),
          className: "bg-green-50 border-green-200 text-green-900"
        });
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.stageApproveHttpFailed.description", { status: res.status }) });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.stageApproveFailed.description") });
    }
  };

  const openStageEmailDialog = async () => {
    if (!selectedCase) {
      toast({ variant: "destructive", title: t("toasts.noCaseSelected.title"), description: t("toasts.noCaseSelected.description") });
      return;
    }
    if (!selectedCase.userEmail) {
      toast({ variant: "destructive", title: t("toasts.noEmailOnFile.title"), description: t("toasts.noEmailOnFile.description") });
      return;
    }
    const { getStageInstruction } = await import("@shared/stageInstructions");
    const stageNumber = parseInt(selectedCase.withdrawalStage || "1", 10) || 1;
    const stage = getStageInstruction(stageNumber);
    const caseRef = selectedCase.id;
    setStageEmailDraft({
      stageNumber: stage.stage,
      stageTitle: stage.title,
      subject: `Stage ${stage.stage} of 14: ${stage.title} — Case ${caseRef}`,
      summary: stage.summary,
      detailedExplanation: stage.detailedExplanation,
      whyItMatters: stage.whyItMatters,
      whatToDoText: stage.whatToDo.join("\n"),
      whatToExpect: stage.whatToExpect,
      regulatoryBasisText: stage.regulatoryBasis.join("\n"),
    });
    setIsStageEmailDialogOpen(true);
  };

  const resetStageEmailDraftToDefault = async () => {
    if (!selectedCase) return;
    const { getStageInstruction } = await import("@shared/stageInstructions");
    const stage = getStageInstruction(stageEmailDraft.stageNumber);
    const caseRef = selectedCase.id;
    setStageEmailDraft({
      stageNumber: stage.stage,
      stageTitle: stage.title,
      subject: `Stage ${stage.stage} of 14: ${stage.title} — Case ${caseRef}`,
      summary: stage.summary,
      detailedExplanation: stage.detailedExplanation,
      whyItMatters: stage.whyItMatters,
      whatToDoText: stage.whatToDo.join("\n"),
      whatToExpect: stage.whatToExpect,
      regulatoryBasisText: stage.regulatoryBasis.join("\n"),
    });
    toast({ title: t("toasts.resetToDefault.title"), description: t("toasts.stageResetDefault.description") });
  };

  const confirmSendStageEmail = async () => {
    if (!selectedCase) return;
    if (!stageEmailDraft.subject.trim()) {
      toast({ variant: "destructive", title: t("toasts.subjectRequired.title"), description: t("toasts.subjectRequired.description") });
      return;
    }
    setIsSendingStageEmail(true);
    try {
      const splitLines = (txt: string) =>
        txt.split("\n").map(s => s.trim()).filter(s => s.length > 0);
      const payload = {
        subject: stageEmailDraft.subject.trim(),
        summary: stageEmailDraft.summary,
        detailedExplanation: stageEmailDraft.detailedExplanation,
        whyItMatters: stageEmailDraft.whyItMatters,
        whatToExpect: stageEmailDraft.whatToExpect,
        whatToDo: splitLines(stageEmailDraft.whatToDoText),
        regulatoryBasis: splitLines(stageEmailDraft.regulatoryBasisText),
      };
      const res = await fetch(`/api/cases/${selectedCase.id}/send-stage-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({
          title: t("toasts.stageEmailSent.title"),
          description: body?.message || t("toasts.stageEmailSent.description", { stage: stageEmailDraft.stageNumber, email: selectedCase.userEmail }),
          className: "bg-green-50 border-green-200 text-green-900",
        });
        setIsStageEmailDialogOpen(false);
      } else {
        const err = await res.json().catch(() => ({}));
        toast({
          variant: "destructive",
          title: t("toasts.emailFailed.title"),
          description: err?.error || t("toasts.stageEmailHttpFailed.description", { status: res.status }),
        });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.stageEmailFailed.description") });
    } finally {
      setIsSendingStageEmail(false);
    }
  };

  const updateReceiptStatus = async (receiptId: number, status: 'approved' | 'rejected', adminNotes?: string, suppressEmail?: boolean) => {
    // Synchronous re-entrancy guard: if a request for this receipt is
    // already in flight, drop the duplicate before we touch state. This
    // prevents a fast double-click from capturing a stale `previous`
    // snapshot and rolling the UI back to the wrong value.
    if (pendingReceiptIdsRef.current.has(receiptId)) return;
    pendingReceiptIdsRef.current.add(receiptId);
    // Optimistic update: flip the receipt's status in the UI immediately so
    // the admin sees the result without waiting for the round-trip. Snapshot
    // the previous row so we can revert cleanly if the server rejects the
    // change.
    let previous: typeof depositReceipts[number] | undefined;
    setDepositReceipts(prev => {
      previous = prev.find(r => r.id === receiptId);
      return prev.map(r => r.id === receiptId ? { ...r, status, adminNotes: adminNotes ?? r.adminNotes } : r);
    });
    setPendingReceiptIds(prev => {
      const next = new Set(prev);
      next.add(receiptId);
      return next;
    });
    const clearPending = () => {
      pendingReceiptIdsRef.current.delete(receiptId);
      setPendingReceiptIds(prev => {
        const next = new Set(prev);
        next.delete(receiptId);
        return next;
      });
    };
    try {
      const res = await fetch(`/api/deposit-receipts/${receiptId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ status, adminNotes, suppressEmail })
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({})) as {
          accountReactivated?: boolean;
          newAccessCode?: string;
          hasEmail?: boolean;
        };
        // Refresh the reactivation badge immediately after any receipt action
        // so the triage pill + row badge clear without waiting for the next poll.
        void loadReactivationPendingCounts();
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
          // Refresh cases list so isDisabled flag updates in the dashboard.
          await loadData(false);
        } else {
          toast({ title: t("toasts.receiptUpdated.title"), description: t("toasts.receiptUpdated.description", { status }) });
        }
      } else {
        // Roll the optimistic change back on failure so the UI reflects
        // server truth again.
        if (previous) {
          setDepositReceipts(prev => prev.map(r => r.id === receiptId && previous ? previous : r));
        }
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: `Failed to update receipt status (HTTP ${res.status}).` });
      }
    } catch (_e) {
      if (previous) {
        setDepositReceipts(prev => prev.map(r => r.id === receiptId && previous ? previous : r));
      }
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.receiptUpdateFailed.description") });
    } finally {
      clearPending();
    }
  };

  const clearLogs = async () => {
    if(confirm("Clear all activity logs and chat history? This will NOT delete any verified user accounts.")) {
      try {
        const res = await fetch('/api/admin/clear-logs', { 
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
          loadData();
          toast({ title: t("toasts.logsCleared.title"), description: t("toasts.logsCleared.description") });
        } else {
          toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.logsClearFailed.description") });
        }
      } catch (_e) {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.logsClearFailed.description") });
      }
    }
  };

  const deleteCase = async (caseId: string, caseName: string) => {
    const caseToDelete = cases.find(c => c.id === caseId);
    const isVerifiedAccount = caseToDelete && ['registered', 'syncing', 'active', 'completed'].includes(caseToDelete.status);
    
    if (isVerifiedAccount) {
      if (!confirm(`WARNING: This is a verified account (${caseName || caseId}). Are you absolutely sure you want to permanently delete this account and all associated data? This action cannot be undone.`)) {
        return;
      }
      if (!confirm(`FINAL CONFIRMATION: This will permanently delete account "${caseName || caseId}" and all associated data. Click OK to confirm.`)) {
        return;
      }
    } else {
      if (!confirm(`Delete account ${caseName || caseId}? This action cannot be undone.`)) {
        return;
      }
    }
    
    try {
      const url = isVerifiedAccount 
        ? `/api/cases/${caseId}?force=true` 
        : `/api/cases/${caseId}`;
      
      const res = await fetch(url, { 
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        setIsAdminMessageOpen(false);
        setSelectedCase(null);
        loadData();
        toast({ title: t("toasts.accountDeleted.title"), description: t("toasts.accountDeleted.description", { name: caseName || caseId }) });
      } else {
        const error = await res.json();
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: error.error || "Failed to delete account." });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.accountDeleteFailed.description") });
    }
  };

  const handleCreateCase = async () => {
    if (!newAccessCode) return;
    
    try {
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          accessCode: newAccessCode,
          status: 'created'
        })
      });
      
      if (response.ok) {
        const newCase = await response.json();
        setIsCreateOpen(false);
        setNewAccessCode("");
        loadData();
        toast({ title: t("toasts.caseCreated.title"), description: t("toasts.caseCreated.description", { code: newCase.accessCode }) });
      } else {
        const errorText = await response.text();
        try {
          const errorData = JSON.parse(errorText);
          toast({ variant: "destructive", title: t("toasts.errorTitle"), description: errorData.error || "Failed to create case." });
        } catch {
          toast({ variant: "destructive", title: t("toasts.errorTitle"), description: errorText || "Failed to create case." });
        }
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.caseCreateFailed.description") });
    }
  };

  const openFinalizeModal = async (c: Case) => {
    setSelectedCase(c);
    setFinalizeData({
      ...finalizeData,
      username: c.userName || ""
    });
    
    // Also load letter data for editing
    try {
      const response = await fetch(`/api/cases/${c.id}/letter`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setLetterData(data);
        } else {
          setLetterData({
            headline: "Withdrawal Protocol Selection",
            introduction: `Dear ${c.userName || "Client"},\n\nWe acknowledge the successful completion of your re-authentication procedure.`,
            bodyContent: "In accordance with IBCCF cross-border withdrawal regulations, please review the finalised withdrawal options for your account.",
            footerNote: "Please select your preferred option below to proceed with the withdrawal process.",
            complianceReference: `CCR-${Date.now().toString(36).toUpperCase()}`,
            optionATitle: "Accelerated Release",
            optionADescription: "Full withdrawal amount processed in accelerated batches.",
            optionAAmount: "500,000 USDT",
            optionAFrequency: "every 12 hours",
            optionABatches: "10",
            optionAKeyCost: "50,000 USDT",
            optionATotalRequirement: "50,000 USDT",
            optionBTitle: "Standard Release",
            optionBDescription: "Half allocation processed in standard batches.",
            optionBAmount: "250,000 USDT",
            optionBFrequency: "every 24 hours",
            optionBBatches: "5",
            optionBKeyCost: "25,000 USDT",
            optionBTotalRequirement: "25,000 USDT",
            phraseKeyRequirements: "A phrase key is a cryptographic security measure that must be purchased to unlock and authorize each withdrawal transaction.",
            complianceNotice: "Important: All withdrawal protocols are subject to IBCCF compliance verification. Failure to complete selected option requirements within 14 business days may result in account restrictions."
          });
        }
      }
    } catch (error) {
      console.error('Failed to load letter:', error);
    }
    
    setIsFinalizeOpen(true);
  };

  const openLetterEditor = async (c: Case) => {
    setSelectedCase(c);
    try {
      const response = await fetch(`/api/cases/${c.id}/letter`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setLetterData(data);
        } else {
          setLetterData({
            headline: "Withdrawal Protocol Selection",
            introduction: `Dear ${c.userName || "Client"},\n\nWe acknowledge the successful completion of your re-authentication procedure.`,
            bodyContent: "In accordance with IBCCF cross-border withdrawal regulations, please review the finalised withdrawal options for your account.",
            footerNote: "Please select your preferred option below to proceed with the withdrawal process.",
            complianceReference: `CCR-${Date.now().toString(36).toUpperCase()}`,
            optionATitle: "Accelerated Release",
            optionADescription: "Full withdrawal amount processed in accelerated batches.",
            optionAAmount: "500,000 USDT",
            optionAFrequency: "every 12 hours",
            optionABatches: "10",
            optionAKeyCost: "50,000 USDT",
            optionATotalRequirement: "50,000 USDT",
            optionBTitle: "Standard Release",
            optionBDescription: "Half allocation processed in standard batches.",
            optionBAmount: "250,000 USDT",
            optionBFrequency: "every 24 hours",
            optionBBatches: "5",
            optionBKeyCost: "25,000 USDT",
            optionBTotalRequirement: "25,000 USDT",
            phraseKeyRequirements: "A phrase key is a cryptographic security measure that must be purchased to unlock and authorize each withdrawal transaction.",
            complianceNotice: "Important: All withdrawal protocols are subject to IBCCF compliance verification. Failure to complete selected option requirements within 14 business days may result in account restrictions."
          });
        }
      }
    } catch (error) {
      console.error('Failed to load letter:', error);
    }
    setIsLetterEditorOpen(true);
  };

  const openSubmissionsModal = async (c: Case) => {
    setSelectedCase(c);
    try {
      const response = await fetch(`/api/cases/${c.id}/submissions`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCaseSubmissions(data);
      }
    } catch (error) {
      console.error('Failed to load submissions:', error);
    }
    setIsSubmissionsOpen(true);
  };

  const handleSaveLetter = async () => {
    if (!selectedCase) return;
    
    try {
      const response = await fetch(`/api/cases/${selectedCase.id}/letter`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify(letterData)
      });

      if (response.ok) {
        setIsLetterEditorOpen(false);
        toast({ title: t("toasts.letterSaved.title"), description: t("toasts.letterSaved.description") });
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.letterSaveFailed.description") });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.letterSaveFailed.description") });
    }
  };

  const handleFinalize = async () => {
    if (!selectedCase) return;
    
    try {
      // Save the letter first
      const letterResponse = await fetch(`/api/cases/${selectedCase.id}/letter`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify(letterData)
      });

      if (!letterResponse.ok) {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.letterContentSaveFailed.description") });
        return;
      }

      // Then finalize the case
      const response = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({
          status: 'active',
          vipStatus: finalizeData.vipStatus,
          username: finalizeData.username,
          withdrawalAmount: finalizeData.withdrawalAmount,
          withdrawalBatches: finalizeData.withdrawalBatches,
          physilocal0: finalizeData.physilocal0
        })
      });

      if (response.ok) {
        setIsFinalizeOpen(false);
        setSelectedCase(null);
        loadData();
        toast({ title: t("toasts.accountActivated.title"), description: t("toasts.accountActivated.description") });
      } else {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.finalizeFailed.description") });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.finalizeFailed.description") });
    }
  };

  const getCaseSubmissionCount = (caseId: string) => {
    return allSubmissions.filter(s => s.caseId === caseId).length;
  };

  const handleDeleteSubmission = async (submissionId: number) => {
    if (confirm("Delete this submission? This action cannot be undone.")) {
      try {
        const response = await fetch(`/api/submissions/${submissionId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
          loadData(true);
          toast({ title: t("toasts.submissionDeleted.title"), description: t("toasts.submissionDeleted.description") });
        } else {
          toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.submissionDeleteFailed.description") });
        }
      } catch (_e) {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.submissionDeleteFailed.description") });
      }
    }
  };

  // LOGIN PAGE
  if (!isLoggedIn) {
    return (
      <div className="relative min-h-screen flex items-center justify-center p-4 font-sans overflow-hidden">
        <SubduedSpaceBackground />
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative max-w-md w-full z-10"
        >
          <div className="text-center mb-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.5 }}
              className="relative w-20 h-20 mx-auto mb-5"
              data-testid="img-admin-logo"
            >
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#004182] to-[#0a3a8c] blur-xl opacity-60" />
              <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center bg-gradient-to-br from-[#004182] via-[#0a3a8c] to-[#001a3d] border border-blue-400/20"
                style={{ boxShadow: '0 8px 32px rgba(0,65,130,0.45), inset 0 1px 0 rgba(255,255,255,0.12)' }}>
                <ShieldCheck className="h-10 w-10 text-white drop-shadow-[0_0_12px_rgba(120,180,255,0.7)]" />
              </div>
            </motion.div>
            <h1 className="text-xl font-bold text-white tracking-wider">{t("login.headerTitle")}</h1>
            <p className="text-slate-400 text-xs uppercase tracking-widest mt-1.5">{t("login.headerSubtitle")}</p>
          </div>
          <div
            className="relative rounded-2xl overflow-hidden"
            style={{
              background: 'linear-gradient(180deg, rgba(15,23,42,0.85) 0%, rgba(2,9,18,0.9) 100%)',
              border: '1px solid rgba(148,163,184,0.12)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,90,230,0.06), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/30 to-transparent" />
            <div className="px-6 pt-6 pb-2">
              <h2 className="text-white text-center flex items-center justify-center gap-2 font-semibold">
                <ShieldCheck className="w-4 h-4 text-amber-400" /> {t("login.cardTitle")}
              </h2>
            </div>
            <div className="px-6 py-5">
              <form onSubmit={handleLogin} className="space-y-4">
                {!loginRequires2FA ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{t("login.usernameLabel")}</label>
                      <div className="relative group">
                        <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                        <Input 
                          type="text" 
                          placeholder={t("login.usernamePlaceholder")} 
                          className="pl-9 bg-slate-900/60 border-slate-700/60 text-white placeholder:text-slate-600 focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 transition-all"
                          value={loginUsername}
                          onChange={(e) => setLoginUsername(e.target.value)}
                          data-testid="input-admin-username"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{t("login.passwordLabel")}</label>
                      <div className="relative group">
                        <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                        <Input 
                          type="password" 
                          placeholder={t("login.passwordPlaceholder")} 
                          className="pl-9 bg-slate-900/60 border-slate-700/60 text-white placeholder:text-slate-600 focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 transition-all"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          data-testid="input-admin-password"
                        />
                      </div>
                      {loginPassword && (() => {
                        const { strength, weakReason } = getPasswordStrengthDetail(loginPassword);
                        const isWeak = strength === "Weak";
                        const isMedium = strength === "Medium";
                        const isStrong = strength === "Strong";
                        return (
                          <div className="mt-2 space-y-1">
                            <div className="flex gap-1">
                              <div className={`h-1 flex-1 rounded-full transition-colors ${isWeak || isMedium || isStrong ? "bg-red-500" : "bg-slate-700"}`} />
                              <div className={`h-1 flex-1 rounded-full transition-colors ${isMedium || isStrong ? "bg-amber-400" : "bg-slate-700"}`} />
                              <div className={`h-1 flex-1 rounded-full transition-colors ${isStrong ? "bg-green-500" : "bg-slate-700"}`} />
                            </div>
                            <p className={`text-[11px] font-medium ${isWeak ? "text-red-400" : isMedium ? "text-amber-400" : "text-green-400"}`}>
                              {strength}
                            </p>
                            {weakReason && (
                              <p data-testid="login-strength-hint" className="text-[11px] text-red-400/80">
                                {PASSWORD_WEAK_HINTS[weakReason]}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25">
                      <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                      <p className="text-amber-300 text-xs">Enter the 6-digit code from your authenticator app, or a backup code.</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Verification Code</label>
                      <div className="relative group">
                        <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                        <Input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="000000"
                          className="pl-9 bg-slate-900/60 border-slate-700/60 text-white placeholder:text-slate-600 focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 transition-all tracking-widest text-center font-mono"
                          value={loginTotpCode}
                          onChange={(e) => setLoginTotpCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                          maxLength={6}
                          autoFocus
                          data-testid="input-admin-totp"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-slate-500 text-xs hover:text-slate-300 transition-colors"
                      onClick={() => { setLoginRequires2FA(false); setLoginTotpCode(""); }}
                    >
                      &larr; Back to login
                    </button>
                  </div>
                )}
                {passwordOverrideActive && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-200"
                    data-testid="alert-password-override-active"
                  >
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                    <p className="text-xs leading-relaxed">
                      A dashboard-set password is active. The <code className="font-mono text-amber-300">ADMIN_PASSWORD</code> env var is currently being bypassed.
                    </p>
                  </div>
                )}
                {loginError && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200"
                    data-testid="alert-admin-login-error"
                  >
                    <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-red-300" />
                    <div className="text-xs leading-relaxed">
                      {loginError.isWeakPassword && (
                        <div className="font-semibold text-red-100 mb-0.5">
                          Login blocked: weak admin password
                        </div>
                      )}
                      <div>{loginError.message}</div>
                      {loginError.weakReasonHint && (
                        <div
                          className="mt-1 text-red-300/90"
                          data-testid="text-admin-login-weak-reason"
                        >
                          {loginError.weakReasonHint}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <Button 
                  type="submit" 
                  className="w-full text-white font-semibold tracking-wide border-0 transition-all hover:brightness-110 active:scale-[0.99]"
                  style={{
                    background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
                    boxShadow: '0 6px 20px rgba(217,119,6,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
                  }}
                  disabled={isLoggingIn || (loginRequires2FA && loginTotpCode.length < 6)}
                  data-testid="button-admin-login"
                >
                  {isLoggingIn ? t("login.authenticating") : loginRequires2FA ? "Verify Code" : t("login.submit")}
                </Button>
                {biometricAvailable && !loginRequires2FA && (
                  <>
                    <div className="flex items-center gap-2 my-1">
                      <div className="flex-1 h-px bg-slate-800" />
                      <span className="text-[11px] text-slate-600 uppercase tracking-wider">or</span>
                      <div className="flex-1 h-px bg-slate-800" />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-slate-700/60 text-slate-300 hover:bg-slate-800/60 hover:text-white hover:border-blue-500/50 transition-all"
                      disabled={isBiometricLoading}
                      onClick={handleBiometricLogin}
                      data-testid="button-admin-biometric-login"
                    >
                      <Fingerprint className="w-4 h-4 mr-2 text-blue-400" />
                      {isBiometricLoading ? "Authenticating…" : "Sign in with Biometric"}
                    </Button>
                  </>
                )}
              </form>
            </div>
            <div className="border-t border-slate-800/60 px-6 py-4 flex flex-col items-center gap-2 bg-slate-950/40">
              <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider">
                 <Lock className="w-3 h-3" /> {t("login.footer")}
              </div>
              <button
                type="button"
                className="text-[11px] text-slate-500 hover:text-amber-300 transition-colors underline underline-offset-2"
                onClick={() => setShowEmergencyReset(true)}
                data-testid="button-emergency-reset-link"
              >
                Locked out? Request emergency access recovery
              </button>
            </div>
          </div>
        </motion.div>
        {showEmergencyReset && (
          <AdminEmergencyResetDialog onClose={() => setShowEmergencyReset(false)} />
        )}
      </div>
    );
  }

  // ADMIN DASHBOARD
  return (
    <div className="admin-premium-shell relative min-h-screen text-slate-100 font-sans" style={{ background: '#0a1929' }}>
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true" />
      {/* Stable "initial data loaded" signal for E2E tests. Renders only once
          the first /api/cases load has settled AND the pending-counts badge
          data has been fetched at least once, so tests can wait on a single
          deterministic element instead of racing the 3 s polling loop. */}
      {!isDataLoading && pendingCountsLoaded && (
        <span data-testid="admin-data-ready" hidden aria-hidden="true" />
      )}
      {showStaleBanner && (
        <div
          role="status"
          aria-live="polite"
          className="relative z-10 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-sm border-b border-amber-400/30 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-500/15 text-amber-100"
          data-testid="admin-stale-build-banner"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-300" />
            <span className="truncate">
              A new version of the admin dashboard is available. Reload to pick up the latest build
              {buildInfo?.buildStamp ? (
                <span className="hidden sm:inline text-amber-200/80 font-mono text-xs ml-2">
                  ({buildInfo.buildStamp})
                </span>
              ) : null}
              .
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 border-amber-300/50 bg-amber-400/10 text-amber-50 hover:bg-amber-400/20 hover:text-white"
              onClick={() => window.location.reload()}
              data-testid="button-admin-stale-reload"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reload
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-amber-200/80 hover:text-white hover:bg-amber-400/10"
              onClick={dismissStaleBanner}
              aria-label="Dismiss new version notice"
              data-testid="button-admin-stale-dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
      <ServiceDegradedBanner
        onViewHealth={() => {
          setActiveTab("settings");
          setSettingsView("service-health");
        }}
      />
      <EscapeHatchDevBanner flags={securityFlags} />
      <EscapeHatchProdBanner flags={securityFlags} />
      <WeakAdminPasswordBanner flags={securityFlags} />
      <WeakAdminUsernameBanner flags={securityFlags} />
      <WeakSessionSecretBanner flags={securityFlags} />
      <WeakPasswordBanner
        flags={securityFlags}
        onGoToSettings={() => {
          setActiveTab("settings");
          setSettingsView("change-password");
        }}
      />
      {/* z-index ladder: z-10 banners/strip/main, z-20 security-banners (pre-header), z-30 <header>.
          Bell dropdown: createPortal+fixed → escapes stacking contexts. No new siblings with z>20. */}
      <header
        className="relative z-30 px-6 py-3 flex justify-between items-center"
        style={{
          background: '#0d3050',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex items-center gap-3 relative">
           <div className="relative w-9 h-9" data-testid="img-logo">
             <div className="absolute inset-0 rounded-lg bg-[#004182] blur-md opacity-50" />
             <div className="relative w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#004182] via-[#0a3a8c] to-[#001a3d] border border-blue-400/20"
               style={{ boxShadow: '0 4px 12px rgba(0,65,130,0.4), inset 0 1px 0 rgba(255,255,255,0.12)' }}>
               <ShieldCheck className="h-5 w-5 text-white drop-shadow-[0_0_6px_rgba(120,180,255,0.6)]" />
             </div>
           </div>
           <div>
             <h1 className="font-bold text-lg tracking-tight text-white">{t("header.title")}</h1>
             <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400">
               <span className="relative flex h-1.5 w-1.5">
                 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                 <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
               </span>
               {t("header.status")}
             </div>
           </div>
        </div>
        <div className="flex items-center gap-4">
          {buildInfo && (
            <div
              className="hidden md:flex flex-col items-end leading-tight text-right border border-slate-700/70 rounded-md px-2 py-1 bg-slate-900/40"
              title={`Build ${buildInfo.buildStamp}\nBooted ${new Date(buildInfo.bootTime).toLocaleString()}\nEnv: ${buildInfo.nodeEnv}`}
              data-testid="admin-build-info"
            >
              <span className="text-[9px] uppercase tracking-wider text-slate-500">Build</span>
              <span
                className="text-[11px] font-mono text-slate-300 max-w-[160px] truncate"
                data-testid="admin-build-stamp"
              >
                {buildInfo.buildStamp}
              </span>
            </div>
          )}
          <div className="text-right hidden md:block">
            <p className="text-xs text-slate-400">{t("header.sessionLabel")}</p>
            <p className="text-sm font-bold text-white">{t("header.sessionRole")}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500"
            onClick={toggleTheme}
            data-testid="button-theme-toggle-admin"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
          
          <div className="relative" ref={notificationBellRef}>
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 relative"
              onClick={() => { setIsNotificationsOpen(!isNotificationsOpen); loadNotifications(); }}
              data-testid="button-notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center font-bold animate-pulse">
                  {unreadNotifications}
                </span>
              )}
            </Button>
            
            {isNotificationsOpen && notificationPanelPos && createPortal(
              <div
                ref={notificationPanelRef}
                data-testid="notification-panel"
                className="fixed bg-slate-950 border border-slate-800 rounded-lg shadow-xl z-[9999]"
                style={{
                  top: notificationPanelPos.top,
                  right: notificationPanelPos.right,
                  width: notificationPanelPos.width,
                  maxHeight: notificationPanelPos.maxHeight,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <AdminNotificationsPanel
                  notifications={notifications}
                  onClose={() => setIsNotificationsOpen(false)}
                  onMarkRead={markNotificationRead}
                  onClearAll={clearAllNotifications}
                  title={t("header.notifications")}
                  emptyLabel={t("header.noNotifications")}
                />
              </div>,
              document.body
            )}
          </div>
          
          <AdminCaseFinder
            cases={cases}
            onPick={(c) => {
              const full = cases.find((x) => x.id === c.id);
              if (full) openAdminMessageDialog(full);
            }}
          />
          <a href="/" target="_blank" rel="noopener noreferrer">
            <Button 
              variant="outline" 
              size="sm" 
              className="border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
              data-testid="button-user-portal"
            >
              <ExternalLink className="w-4 h-4 mr-2" /> {t("header.userPortal")}
            </Button>
          </a>
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-slate-400 hover:text-white"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" /> {t("header.logout")}
          </Button>
        </div>
      </header>

      {/* Global tamper alert. Surfaced when the nightly NDA integrity
          sweep finds one or more sealed cases whose stored PDF hash no
          longer matches the hash captured at signing, OR when the sweep
          itself errored before completing (so silence isn't read as a
          clean bill of health). Dismissal is keyed to the sweep's
          finishedAt timestamp — a newer failed/errored sweep re-shows
          the banner automatically, so it can't be permanently silenced. */}
      {(() => {
        if (!ndaIntegritySweep) return null;
        const isError = ndaIntegritySweep.status === 'error';
        const hasFailures = ndaIntegritySweep.failed > 0;
        if (!isError && !hasFailures) return null;
        if (dismissedNdaSweepFinishedAt === ndaIntegritySweep.finishedAt) return null;
        const uniqueCaseIds = Array.from(new Set(ndaIntegritySweep.failures.map((f) => f.caseId)));
        return (
          <div className="relative z-10 border-y border-red-500/40 bg-red-950/60 px-6 py-3 text-red-100" data-testid="banner-nda-integrity-failed">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-red-300 shrink-0" />
              <div className="flex-1 min-w-[240px] text-sm">
                {isError ? (
                  <>
                    <span className="font-semibold">Sealed NDA integrity sweep failed to complete</span>
                    <span className="ml-2 text-red-200/80 text-xs">
                      Errored {new Date(ndaIntegritySweep.finishedAt).toLocaleString()} •
                      {' '}{ndaIntegritySweep.errorMessage ?? 'unknown error'}
                      {' '}— partial counts ({ndaIntegritySweep.verified}/{ndaIntegritySweep.total} verified, {ndaIntegritySweep.failed} failed) are not a clean bill of health. Re-run when resolved.
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-semibold">
                      {uniqueCaseIds.length} sealed case{uniqueCaseIds.length === 1 ? '' : 's'} failed last integrity sweep
                      {ndaIntegritySweep.failed !== uniqueCaseIds.length && ` (${ndaIntegritySweep.failed} NDA row(s) total)`}
                    </span>
                    <span className="ml-2 text-red-200/80 text-xs">
                      Swept {new Date(ndaIntegritySweep.finishedAt).toLocaleString()} • {ndaIntegritySweep.verified}/{ndaIntegritySweep.total} verified clean •
                      {' '}Affected: <span className="font-mono">{uniqueCaseIds.slice(0, 5).join(', ')}</span>
                      {uniqueCaseIds.length > 5 && ` + ${uniqueCaseIds.length - 5} more`}
                    </span>
                  </>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="bg-transparent border-red-400/50 text-red-100 hover:bg-red-900/50"
                onClick={reRunNdaIntegritySweep}
                disabled={isReRunningNdaSweep}
                data-testid="button-rerun-nda-integrity-sweep"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isReRunningNdaSweep ? 'animate-spin' : ''}`} />
                Re-run sweep
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-200 hover:text-white hover:bg-red-900/40"
                onClick={() => setDismissedNdaSweepFinishedAt(ndaIntegritySweep.finishedAt)}
                data-testid="button-dismiss-nda-integrity-banner"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })()}

      <EmailDeliveryAlertBanner
        emailDeliveryAlerts={emailDeliveryAlerts}
        dismissedEmailDeliveryAlertAt={dismissedEmailDeliveryAlertAt}
        setDismissedEmailDeliveryAlertAt={setDismissedEmailDeliveryAlertAt}
        onRefresh={loadEmailDeliveryAlerts}
        onOpenCase={(caseId) => {
          const c = cases.find((row) => row.id === caseId);
          if (!c) {
            toast({
              title: 'Case not loaded yet',
              description: `Case ${caseId} isn't in the current list — try refreshing.`,
            });
            return;
          }
          openAdminMessageDialog(c);
          setEmailPanelScrollSignal((n) => n + 1);
        }}
      />

      <EmergencyResetBanner
        emergencyResetActivity={emergencyResetActivity}
        dismissedEmergencyResetUsedAt={dismissedEmergencyResetUsedAt}
        setDismissedEmergencyResetUsedAt={setDismissedEmergencyResetUsedAt}
        onViewDetails={() => {
          setSettingsView('emergency-reset');
          setActiveTab('settings');
        }}
      />

      {/* Bank-grade regulatory assurance bar — same compliance posture
          shown across the user portal so admins see the same evidence
          of escrow + AML + audit-trail guarantees. */}
      <div className="relative z-10">
        <ComplianceStrip variant="dark" />
      </div>

      <main id="main-content" tabIndex={-1} className="relative z-10">
        <AdminDashboardContext.Provider
          value={{
            authToken,
            adminRole: currentAdminRole,
            cases,
            filteredCases,
            allSubmissions,
            isDataLoading,
            loadData,
            clearLogs,
            setIsCreateOpen,
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
            withdrawalPendingCounts,
            withdrawalPendingOnly,
            setWithdrawalPendingOnly,
            loadWithdrawalPendingCounts,
            reactivationPendingCounts,
            reactivationPendingOnly,
            setReactivationPendingOnly,
            loadReactivationPendingCounts,
            refundClaimStatusFilter,
            setRefundClaimStatusFilter,
            activeTab,
            setActiveTab,
            setReceiptsInboxFilter,
            getCaseSubmissionCount,
            toggleLetterSent,
            openFinalizeModal,
            openLetterEditor,
            openSubmissionsModal,
            openChat,
            openAdminMessageDialog,
            openCaseEmailDelivery: (caseData: Case) => {
              openAdminMessageDialog(caseData);
              setEmailPanelScrollSignal((n) => n + 1);
            },
            openReceiptsDialog,
            openSendEmailDialog,
            openWithdrawalRequestsDialog,
            requestDeclaration,
            regenerateDeclarationAccessCode,
            clearDeclarationRequest,
            openReissueLetterDialog,
            clearLetterReissue,
            openEditAccountDialog,
            openUserMirror,
            openSignedNdaDialog,
            openPreviewNdaDialog,
            forceLogoutUser,
            toggleUserAccess,
            resetUserPin,
            handleChatScroll,
            openDeclarationDialog,
            handleDeleteSubmission,
            chatCase,
            setChatCase,
            chatMessages,
            loadChatMessages,
            sendChatMessage,
            newMessage,
            setNewMessage,
            isSendingMessage,
            unreadCounts,
            chatScrollRef,
            settingsView,
            setSettingsView,
            theme,
            toggleTheme,
            auditLogs,
            loadAuditLogs,
            emergencyResetActivity,
            loadEmergencyResetActivity,
            adminSessions,
            loadAdminSessions,
            revokeAdminSession,
            revokeOtherAdminSessions,
            failedLogins,
            failedLoginCount24h,
            loadFailedLogins,
            failedLoginsByIp,
            failedLoginsByIpWindowHours,
            loadFailedLoginsByIp,
            declarationReadAttempts,
            declarationReadCount24h,
            loadDeclarationReadAttempts,
            declarationReadByIp,
            declarationReadByIpWindowHours,
            loadDeclarationReadByIp,
            scheduledMessages,
            loadScheduledMessages,
            createScheduledMessage,
            cancelScheduledMessage,
            newScheduledMessage,
            setNewScheduledMessage,
            messageTemplates,
            loadMessageTemplates,
            createMessageTemplate,
            deleteMessageTemplate,
            newMessageTemplate,
            setNewMessageTemplate,
            helpArticles,
            loadHelpArticles,
            createHelpArticle,
            deleteHelpArticle,
            newHelpArticle,
            setNewHelpArticle,
            userFeedback,
            loadUserFeedback,
            documentRequests,
            loadDocumentRequests,
            userDocPendingCounts,
            loadUserDocPendingCounts,
            fetchDocumentFile,
            createDocumentRequest,
            newDocumentRequest,
            setNewDocumentRequest,
            setDocumentRequestUploadsEnabled,
            approveDocumentRequest,
            rejectDocumentRequest,
            markDocumentUnderReview,
            requestKycIdBundle,
            adminUsers,
            loadAdminUsers,
            userSessions,
            loadUserSessions,
            deactivateUserSession,
            translations,
            selectedLocale,
            setSelectedLocale,
            loadTranslations,
            createTranslation,
            deleteTranslation,
            newTranslationKey,
            setNewTranslationKey,
            newTranslationValue,
            setNewTranslationValue,
            chatTemplates,
            setIsTemplateManagerOpen,
            auditRetention,
            isAuditRetentionLoading,
            isAuditRetentionSaving,
            loadAuditRetention,
            saveAuditRetention,
            communityParticipantRetention,
            isCommunityParticipantRetentionLoading,
            isCommunityParticipantRetentionSaving,
            isCommunityParticipantRetentionRunning,
            lastCommunityParticipantRetentionRun,
            loadCommunityParticipantRetention,
            saveCommunityParticipantRetention,
            runCommunityParticipantRetention,
            isWalletConnectAlertMarkerCleanupRunning,
            lastWalletConnectAlertMarkerCleanupRun,
            runWalletConnectAlertMarkerCleanup,
            walletConnectAlertMarkerCount,
            isWalletConnectAlertMarkerCountLoading,
            loadWalletConnectAlertMarkerCount,
            isWalletConnectCompletionBackfillRunning,
            lastWalletConnectCompletionBackfillRun,
            runWalletConnectCompletionBackfill,
            walletConnectCompletionBackfillCount,
            isWalletConnectCompletionBackfillCountLoading,
            loadWalletConnectCompletionBackfillCount,
            walletConnectAlertCleanupInterval,
            isWalletConnectAlertCleanupIntervalLoading,
            isWalletConnectAlertCleanupIntervalSaving,
            loadWalletConnectAlertCleanupInterval,
            saveWalletConnectAlertCleanupInterval,
            isCommunityThreadViewsCleanupRunning,
            lastCommunityThreadViewsCleanupRun,
            runCommunityThreadViewsCleanup,
            communityThreadViewsStaleCount,
            isCommunityThreadViewsStaleCountLoading,
            loadCommunityThreadViewsStaleCount,
            ndaSweepInterval,
            isNdaSweepIntervalLoading,
            isNdaSweepIntervalSaving,
            loadNdaSweepInterval,
            saveNdaSweepInterval,
            ndaSweepStaleGrace,
            isNdaSweepStaleGraceLoading,
            isNdaSweepStaleGraceSaving,
            loadNdaSweepStaleGrace,
            saveNdaSweepStaleGrace,
            ndaSweepSummaryFrequency,
            isNdaSweepSummaryFrequencyLoading,
            isNdaSweepSummaryFrequencySaving,
            loadNdaSweepSummaryFrequency,
            saveNdaSweepSummaryFrequency,
            ndaIntegritySweep,
            emailFailureAlertCooldown,
            isEmailFailureAlertCooldownLoading,
            isEmailFailureAlertCooldownSaving,
            loadEmailFailureAlertCooldown,
            saveEmailFailureAlertCooldown,
            tamperAlertEmail,
            isTamperAlertEmailLoading,
            isTamperAlertEmailSaving,
            isTamperAlertEmailTesting,
            loadTamperAlertEmail,
            saveTamperAlertEmail,
            sendTamperAlertEmailTest,
            documentUploadAlertEmail,
            isDocumentUploadAlertEmailLoading,
            isDocumentUploadAlertEmailSaving,
            isDocumentUploadAlertEmailTesting,
            loadDocumentUploadAlertEmail,
            saveDocumentUploadAlertEmail,
            sendDocumentUploadAlertEmailTest,
            docUploadAlertCooldown,
            isDocUploadAlertCooldownLoading,
            isDocUploadAlertCooldownSaving,
            loadDocUploadAlertCooldown,
            saveDocUploadAlertCooldown,
            mutedAlertCaseIds,
            loadMutedAlertCases,
            toggleAlertMute,
            isAlertMuteSaving,
            mutedWalletAlertCaseIds,
            ndaSweepStaleness,
            isNdaSweepStalenessLoading,
            loadNdaSweepStaleness,
            toast,
          }}
        >
        <Tabs value={activeTab} onValueChange={handleManualTabChange}>
          <div className="flex flex-col lg:flex-row items-stretch min-h-[calc(100vh-56px)]">
            <AdminGroupedNav
              activeTab={activeTab}
              setActiveTab={handleManualTabChange}
              totalUnread={totalUnread}
              stampDutyPendingCount={stampDutyPendingCount}
              onStampDutyBadgeClick={() => {
                setStampDutyPendingOnly(true);
                setActiveTab("cases");
              }}
              pendingDocCount={pendingDocCount}
              onPendingDocBadgeClick={() => setActiveTab("documents")}
              supportingDocPendingCount={supportingDocPendingCount}
              onSupportingDocBadgeClick={() => setActiveTab("supporting-docs")}
              withdrawalPendingCount={withdrawalPendingCount}
              onWithdrawalBadgeClick={() => {
                setWithdrawalPendingOnly(true);
                setActiveTab("cases");
              }}
              refundClaimPendingCount={refundClaimSubmittedCount}
              onRefundClaimBadgeClick={() => {
                setRefundClaimStatusFilter("submitted");
                setActiveTab("cases");
              }}
              reactivationPendingCount={reactivationPendingTotal}
              onReactivationBadgeClick={() => {
                setReactivationPendingOnly(true);
                setActiveTab("cases");
              }}
              activeWarningsCount={activeWarningsCount}
            />
            <div className="flex-1 min-w-0 w-full p-6">
          <Suspense fallback={<AdminTabLoading label="panel" />}>

          <TabsContent value="cases">
            <ErrorBoundary fallback={<AdminTabFallback label="Cases" />}>
              <CasesTab />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="submissions">
            <ErrorBoundary fallback={<AdminTabFallback label="Submissions" />}>
              <SubmissionsTab />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="conversations">
            <ErrorBoundary fallback={<AdminTabFallback label="Conversations" />}>
              <ConversationsTab />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="analytics">
            <ErrorBoundary fallback={<AdminTabFallback label="Analytics" />}>
              <AnalyticsTab />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="settings">
            <ErrorBoundary fallback={<AdminTabFallback label="Settings" />}>
              <SettingsTab />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="content">
            <ErrorBoundary fallback={<AdminTabFallback label="Content" />}>
              <ContentManagement />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="community">
            <ErrorBoundary fallback={<AdminTabFallback label="Community" />}>
              <CommunityManagement />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="key-requests">
            <ErrorBoundary fallback={<AdminTabFallback label="Key Requests" />}>
              <KeyRequestsManagement authToken={authToken} />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="visitors">
            <ErrorBoundary fallback={<AdminTabFallback label="Visitors" />}>
              <VisitorsTab />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="communications">
            <ErrorBoundary fallback={<AdminTabFallback label="Communications" />}>
              <CommunicationsTab />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="declarations">
            <ErrorBoundary fallback={<AdminTabFallback label="Declarations" />}>
              <DeclarationsTab />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="deposit-requests">
            <ErrorBoundary fallback={<AdminTabFallback label="Deposit Requests" />}>
              <DepositsTab />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="documents">
            <ErrorBoundary fallback={<AdminTabFallback label="Documents" />}>
              <DocumentsTab />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="supporting-docs">
            <ErrorBoundary fallback={<AdminTabFallback label="Supporting Documents" />}>
              <SupportingDocumentsTab
                onOpenCase={async (caseId) => {
                  const cached = cases.find((c) => c.id === caseId || c.accessCode === caseId);
                  if (cached) {
                    openAdminMessageDialog(cached, "documents");
                    return;
                  }
                  try {
                    const res = await fetch(`/api/cases/${caseId}`, {
                      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const fresh = await res.json();
                    openAdminMessageDialog(fresh, "documents");
                  } catch (err) {
                    toast({
                      variant: "destructive",
                      title: "Could not open case",
                      description: err instanceof Error ? err.message : "Unknown error",
                    });
                  }
                }}
              />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="receipts">
            <ErrorBoundary fallback={<AdminTabFallback label="All Receipts" />}>
              <AllReceiptsTab
                categoryFilter={receiptsCategoryFilter}
                onCategoryFilterChange={setReceiptsCategoryFilter}
                onOpenCase={async (caseId, receiptKey) => {
                  // Bump scroll key so the merged panel scrolls to and
                  // highlights the receipt the admin clicked in the
                  // inbox (Task #163 review fix). Suffix with timestamp
                  // so repeat-clicks on the same row re-trigger.
                  const cached = cases.find((c) => c.id === caseId || c.accessCode === caseId);
                  if (cached) {
                    setDepositReceipts([]);
                    setMergedReceiptsScrollKey(receiptKey ? `${receiptKey}#${Date.now()}` : null);
                    openReceiptsDialog(cached);
                    return;
                  }
                  try {
                    setDepositReceipts([]);
                    const res = await fetch(`/api/cases/${caseId}`, {
                      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const fresh = await res.json();
                    setMergedReceiptsScrollKey(receiptKey ? `${receiptKey}#${Date.now()}` : null);
                    openReceiptsDialog(fresh);
                  } catch (err) {
                    toast({
                      variant: "destructive",
                      title: "Could not open case",
                      description: err instanceof Error ? err.message : "Unknown error",
                    });
                  }
                }}
              />
            </ErrorBoundary>
          </TabsContent>
          </Suspense>
            </div>
          </div>
        </Tabs>
        </AdminDashboardContext.Provider>
        <SignedNdaDialog
          caseData={signedNdaCase}
          open={!!signedNdaCase}
          onOpenChange={(open) => { if (!open) setSignedNdaCase(null); }}
          authToken={authToken}
        />
        <PreviewNdaDialog
          caseData={previewNdaCase}
          open={!!previewNdaCase}
          onOpenChange={(open) => { if (!open) setPreviewNdaCase(null); }}
          authToken={authToken}
        />
      </main>

      {/* Create Case Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>{t("dialogs.createCase.title")}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {t("dialogs.createCase.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="code" className="text-slate-400">Access Password</Label>
            <Input 
              id="code" 
              value={newAccessCode} 
              onChange={(e) => setNewAccessCode(e.target.value)}
              className="bg-slate-900 border-slate-700 text-white mt-2"
              placeholder="e.g. 774982" 
              data-testid="input-access-code"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateCase} className="bg-blue-600 text-white" data-testid="button-create-case">Create Case</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finalize Sync Modal with User Details & Letter Editor Tabs */}
      <FinalizeAccountDialog
        open={isFinalizeOpen}
        onOpenChange={setIsFinalizeOpen}
        finalizeData={finalizeData}
        setFinalizeData={setFinalizeData}
        letterData={letterData}
        setLetterData={setLetterData}
        handleFinalize={handleFinalize}
      />

      {/* Letter Editor Modal */}
      <Dialog open={isLetterEditorOpen} onOpenChange={setIsLetterEditorOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="w-5 h-5" /> {t("dialogs.editLetter.title")}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Customize the withdrawal letter for {selectedCase?.userName || "this user"}.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label className="text-slate-400">Headline</Label>
              <Input 
                value={letterData.headline || ""}
                onChange={(e) => setLetterData({...letterData, headline: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white"
                data-testid="input-letter-headline"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Introduction</Label>
              <Textarea 
                value={letterData.introduction || ""}
                onChange={(e) => setLetterData({...letterData, introduction: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white min-h-[80px]"
                placeholder="Dear [User Name],..."
                data-testid="input-letter-introduction"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Body Content</Label>
              <Textarea 
                value={letterData.bodyContent || ""}
                onChange={(e) => setLetterData({...letterData, bodyContent: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white min-h-[100px]"
                placeholder="Main letter content..."
                data-testid="input-letter-body"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Footer Note</Label>
              <Textarea 
                value={letterData.footerNote || ""}
                onChange={(e) => setLetterData({...letterData, footerNote: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                data-testid="input-letter-footer"
              />
            </div>

            <div className="border-t border-slate-800 pt-4">
              <h4 className="text-sm font-medium text-slate-300 mb-3">Option Customization</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-400">Option A Title</Label>
                  <Input 
                    value={letterData.optionATitle || ""}
                    onChange={(e) => setLetterData({...letterData, optionATitle: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white"
                    data-testid="input-option-a-title"
                  />
                  <Textarea 
                    value={letterData.optionADescription || ""}
                    onChange={(e) => setLetterData({...letterData, optionADescription: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                    placeholder="Option A description..."
                    data-testid="input-option-a-desc"
                  />
                  <div>
                    <Label className="text-slate-400">Amount</Label>
                    <Input 
                      value={letterData.optionAAmount || ""}
                      onChange={(e) => setLetterData({...letterData, optionAAmount: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 15000"
                      data-testid="input-option-a-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Batch Details</Label>
                    <Textarea 
                      value={letterData.optionABatches || ""}
                      onChange={(e) => setLetterData({...letterData, optionABatches: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1 min-h-[60px]"
                      placeholder="e.g., 3000 per key. Total = 5keys (75,000 USDT) Every 6 hours"
                      data-testid="input-option-a-batches"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Frequency</Label>
                    <Input
                      value={letterData.optionAFrequency || ""}
                      onChange={(e) => setLetterData({...letterData, optionAFrequency: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., every 12 hours"
                      data-testid="input-option-a-frequency"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Phrase Key Cost</Label>
                    <Input
                      value={letterData.optionAKeyCost || ""}
                      onChange={(e) => setLetterData({...letterData, optionAKeyCost: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 50,000 USDT"
                      data-testid="input-option-a-key-cost"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Total Withdrawal Amount</Label>
                    <Input 
                      value={letterData.optionATotalRequirement || ""}
                      onChange={(e) => setLetterData({...letterData, optionATotalRequirement: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 75,000 USDT"
                      data-testid="input-option-a-total-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Withdrawal ID</Label>
                    <Input 
                      value={letterData.optionAFilelocoId || ""}
                      onChange={(e) => setLetterData({...letterData, optionAFilelocoId: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 11223344"
                      data-testid="input-option-a-withdrawal-id"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-400">Option B Title</Label>
                  <Input 
                    value={letterData.optionBTitle || ""}
                    onChange={(e) => setLetterData({...letterData, optionBTitle: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white"
                    data-testid="input-option-b-title"
                  />
                  <Textarea 
                    value={letterData.optionBDescription || ""}
                    onChange={(e) => setLetterData({...letterData, optionBDescription: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                    placeholder="Option B description..."
                    data-testid="input-option-b-desc"
                  />
                  <div>
                    <Label className="text-slate-400">Amount</Label>
                    <Input 
                      value={letterData.optionBAmount || ""}
                      onChange={(e) => setLetterData({...letterData, optionBAmount: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 7500"
                      data-testid="input-option-b-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Batch Details</Label>
                    <Textarea 
                      value={letterData.optionBBatches || ""}
                      onChange={(e) => setLetterData({...letterData, optionBBatches: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1 min-h-[60px]"
                      placeholder="e.g., 2000 per key. Total = 8keys (75,000 USDT) Every 12 hours"
                      data-testid="input-option-b-batches"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Frequency</Label>
                    <Input
                      value={letterData.optionBFrequency || ""}
                      onChange={(e) => setLetterData({...letterData, optionBFrequency: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., every 24 hours"
                      data-testid="input-option-b-frequency"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Phrase Key Cost</Label>
                    <Input
                      value={letterData.optionBKeyCost || ""}
                      onChange={(e) => setLetterData({...letterData, optionBKeyCost: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 25,000 USDT"
                      data-testid="input-option-b-key-cost"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Total Withdrawal Amount</Label>
                    <Input 
                      value={letterData.optionBTotalRequirement || ""}
                      onChange={(e) => setLetterData({...letterData, optionBTotalRequirement: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 75,000 USDT"
                      data-testid="input-option-b-total-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Withdrawal ID</Label>
                    <Input 
                      value={letterData.optionBFilelocoId || ""}
                      onChange={(e) => setLetterData({...letterData, optionBFilelocoId: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 11223344"
                      data-testid="input-option-b-withdrawal-id"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsLetterEditorOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveLetter} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-save-letter">
              Save Letter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submissions History Modal */}
      <Dialog open={isSubmissionsOpen} onOpenChange={setIsSubmissionsOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" /> {t("dialogs.submissionHistory.title")}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Previous submissions for {selectedCase?.userName || "this user"}.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            {caseSubmissions.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No submissions yet for this case.
              </div>
            ) : (
              <div className="space-y-3">
                {caseSubmissions.map((s) => (
                  <div key={s.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4" data-testid={`card-submission-${s.id}`}>
                    <div className="flex justify-between items-start mb-2">
                      <Badge className={s.selectedOption === 'A' ? 'bg-blue-600' : 'bg-slate-600'}>
                        Option {s.selectedOption}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {new Date(s.submittedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-slate-500">Amount:</span>{" "}
                        <span className="text-green-400">{s.withdrawalAmount}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Batches:</span>{" "}
                        <span className="text-slate-300">{s.withdrawalBatches}</span>
                      </div>
                    </div>
                    {s.notes && (
                      <div className="mt-2 text-xs text-slate-400">
                        Notes: {s.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsSubmissionsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chat Panel */}
      <AnimatePresence>
        {isChatOpen && chatCase && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-96 bg-slate-950 border-l border-slate-800 flex flex-col shadow-2xl"
          >
            <div className="bg-slate-900 text-white px-4 py-3 flex justify-between items-center border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold">{chatCase.userName || 'User'}</div>
                  <div className="text-xs text-slate-400">Code: {chatCase.accessCode}</div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-800"
                onClick={() => setIsChatOpen(false)}
                data-testid="button-close-admin-chat"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900/50">
              {chatMessages.length === 0 ? (
                <div className="text-center text-slate-500 mt-8">
                  <MessageCircle className="h-12 w-12 mx-auto text-slate-700 mb-3" />
                  <p className="text-sm">No messages yet.</p>
                  <p className="text-xs text-slate-600 mt-1">Start a conversation with {chatCase.userName || 'this user'}.</p>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender === 'admin' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                        msg.sender === 'admin'
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : 'bg-slate-800 text-slate-100 border border-slate-700 rounded-bl-md'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      <p className={`text-xs mt-1 ${msg.sender === 'admin' ? 'text-blue-200' : 'text-slate-500'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="p-3 border-t border-slate-800 bg-slate-900">
              {/* Template Selector */}
              {chatTemplates.length > 0 && (
                <div className="mb-2 relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                    className="text-xs text-slate-400 hover:text-white gap-1 h-7 px-2"
                  >
                    <Zap className="h-3 w-3" />
                    Quick Replies
                    <ChevronDown className={`h-3 w-3 transition-transform ${showTemplateDropdown ? 'rotate-180' : ''}`} />
                  </Button>
                  {showTemplateDropdown && (
                    <div className="absolute bottom-full left-0 mb-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl w-64 max-h-48 overflow-y-auto z-10">
                      {chatTemplates.map(template => (
                        <button
                          key={template.id}
                          onClick={() => useTemplate(template)} // eslint-disable-line react-hooks/rules-of-hooks
                          className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 border-b border-slate-700 last:border-0"
                        >
                          <div className="font-medium">{template.name}</div>
                          <div className="text-xs text-slate-400 truncate">{template.content}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Type your message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChatMessage()}
                  disabled={isSendingMessage}
                  className="flex-1 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  data-testid="input-admin-chat-message"
                />
                <Button
                  onClick={sendChatMessage}
                  disabled={!newMessage.trim() || isSendingMessage}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="button-send-admin-message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Templates Manager Dialog */}
      <Dialog open={isTemplateManagerOpen} onOpenChange={setIsTemplateManagerOpen}>
        <DialogContent className="max-w-2xl bg-slate-950 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-400" />
              {t("dialogs.chatTemplates.title")}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Create quick response templates for faster customer support
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* New Template Form */}
            <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800 space-y-3">
              <h4 className="text-sm font-medium text-slate-300">Create New Template</h4>
              <div className="grid gap-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="Template name..."
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                    className="flex-1 bg-slate-800 border-slate-700"
                  />
                  <Input
                    placeholder="Category (optional)"
                    value={newTemplate.category}
                    onChange={(e) => setNewTemplate({ ...newTemplate, category: e.target.value })}
                    className="w-32 bg-slate-800 border-slate-700"
                  />
                </div>
                <Textarea
                  placeholder="Template content..."
                  value={newTemplate.content}
                  onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })}
                  className="bg-slate-800 border-slate-700 min-h-[80px]"
                />
                <Button onClick={createChatTemplate} size="sm" className="w-fit bg-blue-600 hover:bg-blue-700">
                  <Plus className="h-4 w-4 mr-1" /> Add Template
                </Button>
              </div>
            </div>
            
            {/* Existing Templates */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {chatTemplates.length === 0 ? (
                <p className="text-center text-slate-500 py-6">No templates yet. Create your first one above!</p>
              ) : (
                chatTemplates.map(template => (
                  <div key={template.id} className="flex items-start gap-3 p-3 bg-slate-900/30 rounded-lg border border-slate-800">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{template.name}</span>
                        {template.category && (
                          <Badge variant="secondary" className="text-[10px] bg-slate-700 text-slate-300">
                            {template.category}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">{template.content}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteChatTemplate(template.id)}
                      className="h-8 w-8 p-0 text-slate-500 hover:text-red-400 hover:bg-red-950/30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin Message Dialog - Redesigned with Clear Sections */}
      <Dialog open={isAdminMessageOpen} onOpenChange={setIsAdminMessageOpen}>
        <DialogContent
          className="max-w-3xl max-h-[85vh] overflow-y-auto bg-slate-950 border-slate-800 text-white"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="pb-4 border-b border-slate-800 sticky top-0 bg-slate-950 z-10">
            <AnimatePresence initial={false}>
              {isCaseDialogLoading ? (
                <motion.div key="header-skeleton" exit={{ opacity: 0 }} transition={dialogFadeTransition}>
                  <CaseDialogHeaderSkeleton />
                </motion.div>
              ) : (
                <motion.div key="header-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={dialogFadeTransition}>
                <DialogTitle className="flex items-center gap-3 text-xl">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                    <User className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="block truncate">Manage Case: {selectedCase?.userName || 'Unknown'}</span>
                    <span className="text-sm font-normal text-slate-400">Case #{selectedCase?.accessCode}</span>
                  </div>
                </DialogTitle>
                {/* Persistent identity/status/stage/sealed summary + quick actions
                    (Open Mirror / Send Email / View Audit). Kept above the tabs so
                    operators always have one-click access regardless of which tab
                    they're on. */}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/80 px-2 py-0.5 text-slate-200">
                    Status: <span className="font-semibold text-white">{selectedCase?.status || '—'}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/80 px-2 py-0.5 text-slate-200">
                    Stage: <span className="font-semibold text-white">{selectedCase?.withdrawalStage ?? '—'}</span>
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                      selectedCase?.sealedAt
                        ? 'bg-amber-500/15 text-amber-200 border border-amber-500/40'
                        : 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/30'
                    }`}
                  >
                    {selectedCase?.sealedAt ? 'Sealed (read-only)' : 'Open'}
                  </span>
                  <span className="ml-auto flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-slate-700 bg-slate-800 text-slate-200 hover:text-white"
                      onClick={() => selectedCase && openUserMirror(selectedCase)}
                      data-testid="header-action-open-mirror"
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" /> Open Mirror
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-slate-700 bg-slate-800 text-slate-200 hover:text-white"
                      onClick={() => selectedCase && openSendEmailDialog(selectedCase)}
                      data-testid="header-action-send-email"
                    >
                      <Mail className="h-3.5 w-3.5 mr-1" /> Send Email
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-slate-700 bg-slate-800 text-slate-200 hover:text-white"
                      onClick={() => {
                        loadAuditLogs();
                        setActiveTab('analytics');
                      }}
                      data-testid="header-action-view-audit"
                    >
                      <History className="h-3.5 w-3.5 mr-1" /> View Audit
                    </Button>
                  </span>
                </div>
                <DialogDescription className="text-slate-400 mt-2">
                  Configure account settings and communicate with the user from this panel.
                </DialogDescription>
                </motion.div>
              )}
            </AnimatePresence>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <AnimatePresence initial={false}>
              {isCaseDialogLoading && (
                <motion.div key="body-skeleton" exit={{ opacity: 0 }} transition={dialogFadeTransition}>
                  <CaseTabContentSkeleton />
                </motion.div>
              )}
            </AnimatePresence>
            {/* Sealed Settlement & NDA banner — rendered ABOVE the form so
                the override button stays outside the read-only fieldset.
                Once `sealedAt` is set, every form control below is
                disabled at the DOM level via <fieldset disabled>; the
                only escape is the Override Seal action here, which
                requires an audit-logged reason. */}
            {!isCaseDialogLoading && (
            <motion.div key="body-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={dialogFadeTransition} className="space-y-6">
            {selectedCase?.sealedAt && (
              <div
                className="space-y-3 rounded-lg border border-amber-700/60 bg-amber-950/30 p-4"
                data-testid="sealed-case-banner"
              >
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-amber-200 font-medium flex items-center gap-2">
                    <Lock className="h-4 w-4 text-amber-300" />
                    Case sealed
                  </Label>
                  <span className="text-[10px] text-amber-200 bg-amber-900/50 border border-amber-700/60 px-2 py-0.5 rounded uppercase tracking-wide">
                    Read-only
                  </span>
                </div>
                <p className="text-xs text-amber-100/80">
                  Sealed by <span className="font-semibold">{selectedCase.sealedBy || "user"}</span> on{' '}
                  <span className="font-mono">{new Date(selectedCase.sealedAt).toLocaleString()}</span>.
                  Every field below is disabled until you clear the seal with a recorded reason.
                </p>
                <SealedNdaMetadata
                  caseId={selectedCase.id}
                  authToken={authToken}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-700 text-amber-100 hover:bg-amber-900/40"
                  onClick={async () => {
                    const reason = window.prompt(
                      "Reason for overriding the seal (minimum 8 characters). This is permanently recorded in the audit log.",
                      "",
                    );
                    if (!reason || reason.trim().length < 8) return;
                    try {
                      const res = await fetch(
                        `/api/cases/${selectedCase.id}/nda/override-seal`,
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${authToken}`,
                          },
                          body: JSON.stringify({ reason: reason.trim() }),
                        },
                      );
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        toast({
                          title: t("toasts.sealOverrideFailed.title"),
                          description: err?.error || `HTTP ${res.status}`,
                          variant: "destructive",
                        });
                        return;
                      }
                      toast({ title: t("toasts.sealCleared.title"), description: t("toasts.sealCleared.description") });
                      setSelectedCase({
                        ...selectedCase,
                        sealedAt: null,
                        sealedBy: null,
                        status: 'active',
                      });
                    } catch (e) {
                      toast({
                        title: t("toasts.overrideFailed.title"),
                        description: e instanceof Error ? e.message : t("toasts.unknownError"),
                        variant: "destructive",
                      });
                    }
                  }}
                  data-testid="button-override-seal"
                >
                  <ShieldOff className="h-4 w-4 mr-1" />
                  Override Seal
                </Button>
              </div>
            )}

            {/* Tabbed case-detail dialog. Each tab wraps its
                form controls in its own <fieldset disabled> so that the
                sealed read-only state still propagates without forcing
                a single fieldset to span every tab. The DialogHeader
                above acts as the persistent header. */}
            <Tabs value={caseDetailTab} onValueChange={setCaseDetailTab} className="space-y-4" data-testid="case-detail-tabs">
              {/* Tab header row — the ⚙ gear opens a small overlay that
                  lets the admin hide tabs they never use. The preference
                  is stored in localStorage and survives page refreshes. */}
              <div className="relative">
                <CaseDetailTabsList hiddenTabs={hiddenCaseTabs} />
                <button
                  type="button"
                  onClick={() => setShowTabConfig((v) => !v)}
                  onBlur={(e) => {
                    // Close the config panel when focus leaves it entirely.
                    if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
                      setShowTabConfig(false);
                    }
                  }}
                  className="absolute right-0 top-0 h-full px-2 text-slate-500 hover:text-slate-300 transition-colors"
                  title="Configure visible tabs"
                  aria-label="Configure visible tabs"
                  aria-expanded={showTabConfig}
                  data-testid="button-configure-case-tabs"
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
                {showTabConfig && (
                  <div
                    className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-slate-700 bg-slate-900 shadow-2xl p-3 space-y-2"
                    data-testid="panel-tab-config"
                  >
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                      Visible tabs
                    </p>
                    {CASE_DETAIL_TABS.map((t) => {
                      const isHidden = hiddenCaseTabs.includes(t.value);
                      const visibleCount = CASE_DETAIL_TABS.filter(
                        (x) => !hiddenCaseTabs.includes(x.value),
                      ).length;
                      const isLastVisible = !isHidden && visibleCount === 1;
                      return (
                        <div key={t.value} className="flex items-center justify-between gap-2">
                          <Label
                            htmlFor={`tab-cfg-${t.value}`}
                            className="text-sm text-slate-300 cursor-pointer"
                          >
                            {t.label}
                          </Label>
                          <Switch
                            id={`tab-cfg-${t.value}`}
                            checked={!isHidden}
                            disabled={isLastVisible}
                            onCheckedChange={() => toggleHiddenCaseTab(t.value)}
                            data-testid={`switch-tab-visible-${t.value}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <TabsContent value="overview" className="space-y-6 mt-0">
            <fieldset disabled={!!selectedCase?.sealedAt} className="contents space-y-6">
            {/* Identity & Email Locale — surfaces the email/name the user
                receives transactional emails as, and the language those
                emails render in. The locale field auto-saves on change via
                PATCH /api/cases/:id (server-side allowlist of supported
                codes). Cuts the "why is this user emailing me in German?"
                support loop without making admins open the audit log. */}
            {selectedCase && (
              <div className="space-y-3 rounded-xl border border-slate-800/50 bg-slate-900/40 p-4">
                <div className="flex items-center gap-2 pb-1">
                  <div className="h-6 w-6 rounded bg-indigo-500/20 flex items-center justify-center">
                    <Languages className="h-3.5 w-3.5 text-indigo-300" />
                  </div>
                  <h3 className="text-sm font-semibold text-indigo-300 uppercase tracking-wide">
                    Recipient Profile
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase tracking-wide text-slate-500">Name</Label>
                    <p className="text-slate-200 truncate" data-testid="case-detail-user-name">
                      {selectedCase.userName || <span className="text-slate-500">— not set —</span>}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase tracking-wide text-slate-500">Email</Label>
                    <p className="text-slate-200 truncate font-mono text-xs" data-testid="case-detail-user-email">
                      {selectedCase.userEmail || <span className="text-slate-500 font-sans">— not set —</span>}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label
                      htmlFor="case-detail-preferred-locale"
                      className="text-[11px] uppercase tracking-wide text-slate-500"
                    >
                      Email Language
                    </Label>
                    <Select
                      value={selectedCase.preferredLocale || "__none__"}
                      onValueChange={async (val) => {
                        if (!selectedCase) return;
                        const next = val === "__none__" ? null : val;
                        if (next === (selectedCase.preferredLocale ?? null)) return;
                        try {
                          const res = await fetch(`/api/cases/${selectedCase.id}`, {
                            method: 'PATCH',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${authToken}`,
                            },
                            body: JSON.stringify({ preferredLocale: next }),
                          });
                          if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            toast({
                              title: 'Could not update email language',
                              description: typeof err?.error === 'string' ? err.error : `HTTP ${res.status}`,
                              variant: 'destructive',
                            });
                            return;
                          }
                          const updated = await res.json();
                          setSelectedCase(updated);
                          const label = next
                            ? (SUPPORTED_LOCALES.find((l) => l.code === next)?.nativeLabel ?? next)
                            : 'Auto (admin/browser)';
                          toast({
                            title: 'Email language updated',
                            description: `Transactional emails will render in ${label}.`,
                          });
                          await loadData(false);
                        } catch {
                          toast({ title: 'Network error', variant: 'destructive' });
                        }
                      }}
                    >
                      <SelectTrigger
                        id="case-detail-preferred-locale"
                        className="bg-slate-800/50 border-slate-700 text-white h-9"
                        data-testid="select-case-preferred-locale"
                      >
                        <SelectValue placeholder="Auto" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-white">
                        <SelectItem value="__none__">Auto (admin/browser)</SelectItem>
                        {SUPPORTED_LOCALES.map((l) => (
                          <SelectItem key={l.code} value={l.code}>
                            {l.nativeLabel} ({l.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  Outbound transactional emails (letter ready, declaration, documents, payout wallet, etc.)
                  are rendered in this language regardless of which admin triggered the send.
                </p>
              </div>
            )}

            </fieldset>
              
            <fieldset disabled={!!selectedCase?.sealedAt} className="contents space-y-6">
            {/* SECTION 4: Danger Zone — collapsed inside Advanced disclosure.
                Delete is super_admin-only on the server; hide the UI for lower
                roles to avoid confusing 403 responses. */}
            {currentAdminRole === 'super_admin' && (
            <details className="group rounded-xl border border-red-500/20 bg-red-500/5 open:bg-red-500/10" data-testid="advanced-danger-zone">
              <summary className="cursor-pointer list-none p-4 flex items-center justify-between text-sm font-semibold text-red-300 hover:text-red-200">
                <span className="flex items-center gap-2">
                  <Trash2 className="h-3.5 w-3.5" /> Advanced — Danger Zone
                </span>
                <span className="text-[10px] text-red-600 bg-red-950 px-2 py-0.5 rounded">PERMANENT</span>
              </summary>
              <div className="px-4 pb-4 space-y-4">
              <div className="p-4 bg-red-500/5 rounded-xl border border-red-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-red-300">Delete this account</p>
                    <p className="text-xs text-red-400/70 mt-1">
                      {selectedCase && ['registered', 'syncing', 'active', 'completed'].includes(selectedCase.status) 
                        ? 'This is a verified account. Deletion requires double confirmation.'
                        : 'This will permanently remove the account and all associated data.'}
                    </p>
                  </div>
                  <Button 
                    variant="destructive"
                    size="sm"
                    onClick={() => selectedCase && deleteCase(selectedCase.id, selectedCase.userName || selectedCase.accessCode)}
                    className="bg-red-600 hover:bg-red-700"
                    data-testid="button-delete-account"
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Delete Account
                  </Button>
                </div>
              </div>
              </div>
            </details>
            )}
            </fieldset>
              
</TabsContent>

              {/* Phrase Key — admin-managed wallet recovery phrase the user
                  reveals/imports. Lives in its own dedicated tab and is
                  intentionally NOT wrapped in the sealed-disabled fieldset:
                  the server allows editing the phrase even after a case is
                  sealed. walletPhraseCode is never returned by GET; the portal
                  fetches it via /:id/wallet-phrase. */}
              <TabsContent value="phrase-key" className="space-y-6 mt-0">
                <div className="space-y-3 rounded-xl border border-purple-700/50 bg-purple-950/20 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-purple-100 font-medium flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-purple-400" />
                      Wallet Connection (Phrase Key)
                    </Label>
                    <span className="text-[10px] text-purple-300 bg-purple-950/50 border border-purple-800/50 px-2 py-0.5 rounded">
                      USER-FACING
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 -mt-1">
                    The wallet recovery phrase the user reveals and imports.{' '}
                    <span className="text-purple-200 font-medium">Not</span> the numeric
                    "Phrase Key Deposit" amount in the Workflow tab.
                  </p>

                  <div className="flex items-center justify-between bg-slate-800/30 border border-slate-700/50 rounded-lg px-3 py-2">
                    <Label className="text-slate-200 text-sm">Enable Wallet Connection step</Label>
                    <Switch
                      checked={walletPhraseEnabledEdit}
                      onCheckedChange={setWalletPhraseEnabledEdit}
                      data-testid="switch-wallet-phrase-enabled"
                    />
                  </div>

                  {/* Email the user a templated guide to retrieving their phrase
                      key and completing the withdrawal in the secure portal. */}
                  <div className="flex items-center justify-between gap-3 bg-slate-800/30 border border-slate-700/50 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <Label className="text-slate-200 text-sm">Notify user by email</Label>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Sends a guide to retrieve their phrase key and complete the withdrawal.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0 border-purple-700/60 text-purple-200 hover:bg-purple-900/30"
                      onClick={sendPhraseCodeNotice}
                      disabled={isSendingPhraseCodeNotice || !selectedCase?.userEmail}
                      title={selectedCase?.userEmail ? undefined : "No email address on file for this user"}
                      data-testid="button-send-phrase-code-notice"
                    >
                      <Mail className="h-3.5 w-3.5 mr-1" />
                      {isSendingPhraseCodeNotice ? "Sending…" : "Send Notice"}
                    </Button>
                  </div>

                  {/* Length selector (6 / 12 / 24 words) + one-click auto-generate */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                        Length
                      </Label>
                      <div className="flex rounded-lg border border-slate-700 overflow-hidden">
                        {PHRASE_KEY_LENGTHS.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setWalletPhraseLength(n)}
                            className={`px-3 py-1 text-xs font-medium transition-colors ${
                              walletPhraseLength === n
                                ? 'bg-purple-600 text-white'
                                : 'bg-slate-800/50 text-slate-400 hover:text-slate-200'
                            }`}
                            data-testid={`button-wallet-phrase-length-${n}`}
                          >
                            {n} words
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 border-purple-700/60 text-purple-200 hover:bg-purple-900/30"
                      onClick={() => {
                        setWalletPhraseCodeEdit(generatePhraseKey(walletPhraseLength));
                        setWalletPhraseRevealed(true);
                      }}
                      data-testid="button-generate-wallet-phrase"
                    >
                      <Zap className="h-3.5 w-3.5 mr-1" />
                      Auto-generate
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                        Phrase Key ({walletPhraseLength} space-separated words)
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px] text-slate-400 hover:text-white"
                        onClick={() => setWalletPhraseRevealed((v) => !v)}
                        data-testid="button-toggle-wallet-phrase-reveal"
                      >
                        {walletPhraseRevealed ? 'Hide' : 'Reveal'}
                      </Button>
                    </div>
                    <Textarea
                      value={walletPhraseCodeEdit}
                      onChange={(e) => setWalletPhraseCodeEdit(e.target.value)}
                      onFocus={() => setWalletPhraseRevealed(true)}
                      placeholder="word1 word2 word3 word4 word5 word6 …"
                      className={`bg-slate-800/50 border-slate-700 text-white font-mono text-sm resize-none cursor-text ${
                        walletPhraseRevealed ? '' : 'blur-sm hover:blur-none focus:blur-none transition-all'
                      }`}
                      rows={3}
                      data-testid="textarea-wallet-phrase-code"
                    />
                    {!walletPhraseRevealed && walletPhraseCodeEdit.trim() && (
                      <p className="text-[10px] text-slate-500" data-testid="text-wallet-phrase-edit-hint">
                        Blurred for privacy — click the field (or “Reveal”) to view and edit it.
                      </p>
                    )}
                    {walletPhraseCodeEdit.trim() && (() => {
                      const n = countPhraseWords(walletPhraseCodeEdit);
                      return (
                        <p className="text-[10px] text-slate-500" data-testid="text-wallet-phrase-word-count">
                          {n} word{n === 1 ? '' : 's'} entered
                          {n !== walletPhraseLength && (
                            <span className="text-amber-400/80"> · expected {walletPhraseLength}</span>
                          )}
                        </p>
                      );
                    })()}
                  </div>

                  {selectedCase?.walletExchangeName && (
                    <div
                      className="text-[11px] text-purple-200/90 bg-purple-950/30 border border-purple-800/50 rounded-lg px-3 py-2"
                      data-testid="wallet-exchange-name-display"
                    >
                      User-selected wallet:{' '}
                      <span className="font-semibold">{selectedCase.walletExchangeName}</span>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      onClick={updateWalletPhrase}
                      disabled={savingWalletPhrase}
                      size="sm"
                      className="bg-purple-600 hover:bg-purple-700"
                      data-testid="button-save-wallet-phrase"
                    >
                      <Save className="h-4 w-4 mr-1" />
                      {savingWalletPhrase ? 'Saving…' : 'Save Wallet Phrase'}
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="workflow" className="space-y-6 mt-0">
            <fieldset disabled={!!selectedCase?.sealedAt} className="contents space-y-6">
            {/* SECTION 1: Account Settings */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2">
                <div className="h-6 w-6 rounded bg-blue-500/20 flex items-center justify-center">
                  <Settings className="h-3.5 w-3.5 text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wide">{t("sections.accountSettings")}</h3>
              </div>
              
              <div className="grid gap-4 p-4 bg-slate-900/50 rounded-xl border border-slate-800/50">
                {/* Deposit Address — admin chooses crypto, network, address. Saved together. */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300 font-medium flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-slate-500" />
                      Deposit Details
                    </Label>
                    <span className="text-[10px] text-slate-600 bg-slate-800 px-2 py-0.5 rounded">CRYPTO WALLET</span>
                  </div>
                  <p className="text-xs text-slate-500 -mt-1">Choose which crypto, which network, and the wallet address the user will deposit to</p>

                  {/* Asset + Network row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Crypto / asset */}
                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wide text-slate-500">Crypto</Label>
                      <Select
                        value={depositAssetCustom ? "__custom__" : (depositAssetEdit || "__none__")}
                        onValueChange={(val) => {
                          if (val === "__custom__") {
                            setDepositAssetCustom(true);
                          } else if (val === "__none__") {
                            setDepositAssetCustom(false);
                            setDepositAssetEdit("");
                          } else {
                            setDepositAssetCustom(false);
                            setDepositAssetEdit(val);
                          }
                        }}
                      >
                        <SelectTrigger className="bg-slate-800/50 border-slate-700 text-white" data-testid="select-deposit-asset">
                          <SelectValue placeholder="Select crypto" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— None —</SelectItem>
                          <SelectItem value="USDT">USDT (Tether)</SelectItem>
                          <SelectItem value="USDC">USDC (USD Coin)</SelectItem>
                          <SelectItem value="BTC">BTC (Bitcoin)</SelectItem>
                          <SelectItem value="ETH">ETH (Ethereum)</SelectItem>
                          <SelectItem value="BNB">BNB</SelectItem>
                          <SelectItem value="TRX">TRX (TRON)</SelectItem>
                          <SelectItem value="SOL">SOL (Solana)</SelectItem>
                          <SelectItem value="XRP">XRP</SelectItem>
                          <SelectItem value="DAI">DAI</SelectItem>
                          <SelectItem value="LTC">LTC (Litecoin)</SelectItem>
                          <SelectItem value="DOGE">DOGE (Dogecoin)</SelectItem>
                          <SelectItem value="MATIC">MATIC (Polygon)</SelectItem>
                          <SelectItem value="__custom__">Custom…</SelectItem>
                        </SelectContent>
                      </Select>
                      {depositAssetCustom && (
                        <Input
                          value={depositAssetEdit}
                          onChange={(e) => setDepositAssetEdit(e.target.value)}
                          placeholder="e.g., AVAX, LINK, …"
                          className="bg-slate-800/50 border-slate-700 text-white text-sm"
                          data-testid="input-deposit-asset-custom"
                        />
                      )}
                    </div>

                    {/* Network */}
                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wide text-slate-500">Network</Label>
                      <Select
                        value={depositNetworkCustom ? "__custom__" : (depositNetworkEdit || "__none__")}
                        onValueChange={(val) => {
                          if (val === "__custom__") {
                            setDepositNetworkCustom(true);
                          } else if (val === "__none__") {
                            setDepositNetworkCustom(false);
                            setDepositNetworkEdit("");
                          } else {
                            setDepositNetworkCustom(false);
                            setDepositNetworkEdit(val);
                          }
                        }}
                      >
                        <SelectTrigger className="bg-slate-800/50 border-slate-700 text-white" data-testid="select-deposit-network">
                          <SelectValue placeholder="Select network" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— None —</SelectItem>
                          <SelectItem value="TRC20">TRC20 (TRON)</SelectItem>
                          <SelectItem value="ERC20">ERC20 (Ethereum)</SelectItem>
                          <SelectItem value="BEP20">BEP20 (BNB Smart Chain)</SelectItem>
                          <SelectItem value="Polygon">Polygon</SelectItem>
                          <SelectItem value="Solana">Solana</SelectItem>
                          <SelectItem value="Bitcoin">Bitcoin</SelectItem>
                          <SelectItem value="Litecoin">Litecoin</SelectItem>
                          <SelectItem value="Dogecoin">Dogecoin</SelectItem>
                          <SelectItem value="XRP">XRP Ledger</SelectItem>
                          <SelectItem value="__custom__">Custom…</SelectItem>
                        </SelectContent>
                      </Select>
                      {depositNetworkCustom && (
                        <Input
                          value={depositNetworkEdit}
                          onChange={(e) => setDepositNetworkEdit(e.target.value)}
                          placeholder="e.g., Avalanche C-Chain"
                          className="bg-slate-800/50 border-slate-700 text-white text-sm"
                          data-testid="input-deposit-network-custom"
                        />
                      )}
                    </div>
                  </div>

                  {/* Address */}
                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wide text-slate-500">Wallet Address</Label>
                    <div className="flex gap-2">
                      <Input
                        value={depositAddressEdit}
                        onChange={(e) => setDepositAddressEdit(e.target.value)}
                        placeholder="Enter deposit address (e.g., 0x1234...abcd)"
                        className="bg-slate-800/50 border-slate-700 text-white flex-1 font-mono text-sm"
                        data-testid="input-deposit-address"
                      />
                      <Button onClick={updateDepositAddress} size="sm" className="bg-blue-600 hover:bg-blue-700" disabled={savingDepositDetails} data-testid="button-save-deposit-details">
                        <Save className="h-4 w-4 mr-1" />{savingDepositDetails ? "Saving…" : "Save"}
                      </Button>
                    </div>
                    {(depositAssetEdit || depositNetworkEdit) && (
                      <p className="text-[11px] text-slate-500" data-testid="text-deposit-preview">
                        Saving will tell the user to send{' '}
                        <span className="text-slate-300 font-semibold">{depositAssetEdit || '(any)'}</span>
                        {depositNetworkEdit && (
                          <>
                            {' '}on the{' '}
                            <span className="text-slate-300 font-semibold">{depositNetworkEdit}</span>{' '}network
                          </>
                        )}.
                      </p>
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-slate-800/50"></div>

                {/* Sealed-banner is rendered above the read-only
                    fieldset (see top of dialog body). The override
                    button must stay outside the fieldset so admins
                    can still clear the seal — keeping the banner here
                    would make its own button disabled. */}

                {/* Verified Payout Wallet — admin-designated disbursement
                    address shown on the user's portal. Display-only on the
                    portal; this app does NOT route or relay funds. The
                    server stamps verifiedAt + verifiedBy automatically. */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300 font-medium flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-emerald-400" />
                      Verified Payout Wallet
                    </Label>
                    <span className="text-[10px] text-emerald-300 bg-emerald-900/40 border border-emerald-800/60 px-2 py-0.5 rounded uppercase tracking-wide">
                      Disbursement Address
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 -mt-1">
                    The wallet you have verified as the destination for this case's payout.
                    Shown to the user as <em>display only</em> — the platform never holds, routes, or relays funds.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wide text-slate-500">Asset</Label>
                      <Select
                        value={payoutWalletAssetCustom ? "__custom__" : (payoutWalletAssetEdit || "__none__")}
                        onValueChange={(val) => {
                          if (val === "__custom__") { setPayoutWalletAssetCustom(true); }
                          else if (val === "__none__") { setPayoutWalletAssetCustom(false); setPayoutWalletAssetEdit(""); }
                          else { setPayoutWalletAssetCustom(false); setPayoutWalletAssetEdit(val); }
                        }}
                      >
                        <SelectTrigger className="bg-slate-800/50 border-slate-700 text-white" data-testid="select-payout-wallet-asset">
                          <SelectValue placeholder="Select asset" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— None —</SelectItem>
                          <SelectItem value="USDT">USDT (Tether)</SelectItem>
                          <SelectItem value="USDC">USDC (USD Coin)</SelectItem>
                          <SelectItem value="BTC">BTC (Bitcoin)</SelectItem>
                          <SelectItem value="ETH">ETH (Ethereum)</SelectItem>
                          <SelectItem value="BNB">BNB</SelectItem>
                          <SelectItem value="TRX">TRX (TRON)</SelectItem>
                          <SelectItem value="SOL">SOL (Solana)</SelectItem>
                          <SelectItem value="XRP">XRP</SelectItem>
                          <SelectItem value="DAI">DAI</SelectItem>
                          <SelectItem value="LTC">LTC (Litecoin)</SelectItem>
                          <SelectItem value="DOGE">DOGE (Dogecoin)</SelectItem>
                          <SelectItem value="MATIC">MATIC (Polygon)</SelectItem>
                          <SelectItem value="__custom__">Custom…</SelectItem>
                        </SelectContent>
                      </Select>
                      {payoutWalletAssetCustom && (
                        <Input
                          value={payoutWalletAssetEdit}
                          onChange={(e) => setPayoutWalletAssetEdit(e.target.value)}
                          placeholder="e.g., AVAX"
                          className="bg-slate-800/50 border-slate-700 text-white text-sm"
                          data-testid="input-payout-wallet-asset-custom"
                        />
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wide text-slate-500">Network</Label>
                      <Select
                        value={payoutWalletNetworkEdit || "__none__"}
                        onValueChange={(val) => {
                          if (val === "__none__") setPayoutWalletNetworkEdit("");
                          else setPayoutWalletNetworkEdit(val);
                        }}
                      >
                        <SelectTrigger className="bg-slate-800/50 border-slate-700 text-white" data-testid="select-payout-wallet-network">
                          <SelectValue placeholder="Select network" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— None —</SelectItem>
                          <SelectItem value="TRC20">TRC20 (TRON)</SelectItem>
                          <SelectItem value="ERC20">ERC20 (Ethereum)</SelectItem>
                          <SelectItem value="BEP20">BEP20 (BNB Smart Chain)</SelectItem>
                          <SelectItem value="Polygon">Polygon</SelectItem>
                          <SelectItem value="Solana">Solana</SelectItem>
                          <SelectItem value="Bitcoin">Bitcoin</SelectItem>
                          <SelectItem value="Litecoin">Litecoin</SelectItem>
                          <SelectItem value="Dogecoin">Dogecoin</SelectItem>
                          <SelectItem value="XRP">XRP Ledger</SelectItem>
                        </SelectContent>
                      </Select>
                      {/* Custom networks intentionally disallowed — server
                          enforces an allowlist, so the admin UI mirrors it. */}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wide text-slate-500">Wallet Address</Label>
                    <Input
                      value={payoutWalletAddressEdit}
                      onChange={(e) => setPayoutWalletAddressEdit(e.target.value.replace(/\s+/g, ''))}
                      placeholder="Enter the verified destination address"
                      className="bg-slate-800/50 border-slate-700 text-white font-mono text-sm"
                      data-testid="input-payout-wallet-address"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                      Internal Officer Note (admin-only)
                    </Label>
                    <Textarea
                      value={payoutWalletNoteEdit}
                      onChange={(e) => setPayoutWalletNoteEdit(e.target.value)}
                      placeholder="Internal-only — never sent to the user. Capture how the address was verified, channel used, etc."
                      className="bg-slate-800/50 border-slate-700 text-white text-sm resize-none"
                      rows={2}
                      data-testid="textarea-payout-wallet-note"
                    />
                    <p className="text-[10px] text-slate-500">
                      This note is <span className="text-amber-300 font-semibold">internal</span> — it is
                      not displayed in the user portal and not included in any email.
                    </p>
                  </div>

                  {selectedCase && (
                    <PayoutWalletHistoryHint
                      caseId={selectedCase.id}
                      authToken={authToken}
                    />
                  )}

                  {selectedCase?.payoutWalletVerifiedAt && (
                    <div
                      className="text-[11px] text-emerald-300/90 bg-emerald-950/30 border border-emerald-800/50 rounded-lg px-3 py-2"
                      data-testid="payout-wallet-verified-meta"
                    >
                      Last verified by{' '}
                      <span className="font-semibold">
                        {selectedCase.payoutWalletVerifiedBy || 'Admin'}
                      </span>{' '}
                      on{' '}
                      <span className="font-mono">
                        {new Date(selectedCase.payoutWalletVerifiedAt).toLocaleString()}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      onClick={updatePayoutWallet}
                      disabled={savingPayoutWallet}
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700"
                      data-testid="button-save-payout-wallet"
                    >
                      <Save className="h-4 w-4 mr-1" />
                      {savingPayoutWallet ? 'Saving…' : 'Save Verified Wallet'}
                    </Button>
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-slate-800/50"></div>

                {/* Task #492 — per-case mute toggle for the wallet-connect
                    alert. The Wallet Connection phrase controls now live in the
                    dedicated Phrase Key tab; this toggle silences that workflow.
                    When muted, the first-reveal SMTP send and audit stamp
                    are skipped; the hasAlreadyFired check still applies so
                    unmuting after the first reveal won't re-trigger. */}
                {selectedCase && (() => {
                  const isWalletMuted = mutedWalletAlertCaseIds.has(selectedCase.id);
                  return (
                    <div
                      className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-4"
                      data-testid="case-wallet-connect-alert-mute-panel"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                            <BellOff className="h-4 w-4 text-purple-400" />
                            Mute wallet-connect alerts
                          </h4>
                          <p className="text-xs text-slate-500 mt-1 max-w-md">
                            When muted, the admin email that fires on the user's
                            first wallet phrase reveal is silenced for this case.
                            Mute applies only to the SMTP send — the{' '}
                            <code className="text-purple-300">wallet_connect_completed</code>{' '}
                            audit row is still written on first reveal. Both
                            mute and unmute actions are audit-logged.
                          </p>
                          {isWalletMuted && (
                            <Badge
                              variant="outline"
                              className="mt-2 text-purple-200 border-purple-500 bg-purple-500/15"
                              data-testid="badge-wallet-connect-alert-muted"
                            >
                              <BellOff className="w-3 h-3 mr-1" /> MUTED
                            </Badge>
                          )}
                        </div>
                        <Switch
                          checked={isWalletMuted}
                          disabled={isWalletAlertMuteSaving}
                          onCheckedChange={(v) => toggleWalletAlertMute(selectedCase.id, v)}
                          data-testid="switch-wallet-connect-alert-mute"
                        />
                      </div>
                    </div>
                  );
                })()}

                {/* Divider */}
                <div className="border-t border-slate-800/50"></div>

                {/* Profile Redirect URL */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300 font-medium flex items-center gap-2">
                      <ExternalLink className="h-4 w-4 text-slate-500" />
                      Profile Redirect URL
                    </Label>
                    <span className="text-[10px] text-slate-600 bg-slate-800 px-2 py-0.5 rounded">OPTIONAL</span>
                  </div>
                  <p className="text-xs text-slate-500 -mt-1">Redirect users to an external profile or verification page</p>
                  <div className="flex gap-2">
                    <Input
                      value={profileRedirectEdit}
                      onChange={(e) => setProfileRedirectEdit(e.target.value)}
                      placeholder="https://example.com/profile"
                      className="bg-slate-800/50 border-slate-700 text-white flex-1"
                      data-testid="input-profile-redirect"
                    />
                    <Button onClick={updateProfileRedirect} size="sm" className="bg-blue-600 hover:bg-blue-700">
                      <Save className="h-4 w-4 mr-1" /> Save
                    </Button>
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-slate-800/50"></div>

                {/* Submission URL */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300 font-medium flex items-center gap-2">
                      <ExternalLink className="h-4 w-4 text-green-500" />
                      Submission URL
                    </Label>
                    <span className="text-[10px] text-green-600 bg-green-900/30 px-2 py-0.5 rounded">LETTER FORM</span>
                  </div>
                  <p className="text-xs text-slate-500 -mt-1">External URL where users submit their withdrawal request (replaces Option A/B)</p>
                  <div className="flex gap-2">
                    <Input
                      value={submissionUrlEdit}
                      onChange={(e) => setSubmissionUrlEdit(e.target.value)}
                      placeholder="https://forms.example.com/submit"
                      className="bg-slate-800/50 border-slate-700 text-white flex-1"
                      data-testid="input-submission-url"
                    />
                    <Button onClick={updateSubmissionUrl} size="sm" className="bg-green-600 hover:bg-green-700">
                      <Save className="h-4 w-4 mr-1" /> Save
                    </Button>
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-slate-800/50"></div>

                {/* Landing Page Preference */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300 font-medium flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-slate-500" />
                      Default Landing Page
                    </Label>
                    <span className="text-[10px] text-slate-600 bg-slate-800 px-2 py-0.5 rounded">NAVIGATION</span>
                  </div>
                  <p className="text-xs text-slate-500 -mt-1">Choose which page the user sees first after logging in</p>
                  <div className="flex gap-2">
                    <Select value={landingPageEdit} onValueChange={setLandingPageEdit}>
                      <SelectTrigger className="bg-slate-800/50 border-slate-700 text-white flex-1" data-testid="select-landing-page">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dashboard">
                          <span className="flex items-center gap-2"><LayoutDashboard className="h-4 w-4" /> Dashboard (Default)</span>
                        </SelectItem>
                        <SelectItem value="letter">
                          <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> Withdrawal Letter</span>
                        </SelectItem>
                        <SelectItem value="deposit">
                          <span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Deposit Information</span>
                        </SelectItem>
                        <SelectItem value="messages">
                          <span className="flex items-center gap-2"><Bell className="h-4 w-4" /> Required Actions</span>
                        </SelectItem>
                        <SelectItem value="chat">
                          <span className="flex items-center gap-2"><MessageCircle className="h-4 w-4" /> Support Chat</span>
                        </SelectItem>
                        <SelectItem value="history">
                          <span className="flex items-center gap-2"><History className="h-4 w-4" /> Submission History</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={updateLandingPage} size="sm" className="bg-blue-600 hover:bg-blue-700">
                      <Save className="h-4 w-4 mr-1" /> Save
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION: Withdrawal Progress */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2">
                <div className="h-6 w-6 rounded bg-emerald-500/20 flex items-center justify-center">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                </div>
                <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wide">{t("sections.withdrawalProgress")}</h3>
              </div>
              
              <div className="p-4 bg-gradient-to-br from-emerald-500/10 to-green-500/5 rounded-xl border border-emerald-500/20">
                <p className="text-xs text-slate-400 mb-3">Control the withdrawal progress display shown to the user on their dashboard.</p>

                {/* Guide Banner state summary — mirrors the stamp-duty gate pill
                    pattern so compliance staff can audit at a glance (Task #227). */}
                {selectedCase && (
                  <div className="grid grid-cols-2 gap-2 text-[11px] mb-4">
                    <div className="bg-slate-800/40 border border-slate-700/60 rounded px-3 py-2">
                      <div className="text-slate-500 uppercase tracking-wide text-[10px]">Guide Banner</div>
                      {/* WITHDRAWAL_GUIDE_BANNER_STATE_START */}
                      <div
                        className={`font-semibold ${selectedCase.withdrawalGuideVisible ? 'text-emerald-400' : 'text-slate-400'}`}
                        data-testid="withdrawal-guide-banner-state"
                      >
                        {selectedCase.withdrawalGuideVisible ? 'Visible' : 'Hidden'}
                      </div>
                    </div>
                    <div className="bg-slate-800/40 border border-slate-700/60 rounded px-3 py-2">
                      <div className="text-slate-500 uppercase tracking-wide text-[10px]">Progress Tracker</div>
                      <div className={`font-semibold ${selectedCase.showWithdrawalProgress ? 'text-emerald-400' : 'text-slate-400'}`} data-testid="progress-tracker-state">
                        {selectedCase.showWithdrawalProgress ? 'Visible' : 'Hidden'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Toggle to show/hide withdrawal guide banner — inline save
                    via toggleWithdrawalGuideVisible (Task #283). Optimistic
                    update keeps the status pill above in sync instantly. */}
                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg mb-3">
                  <div>
                    <Label className="text-slate-300 font-medium">Show Withdrawal Guide Banner</Label>
                    <p className="text-xs text-slate-500">When enabled, user will see the withdrawal guide banner on their dashboard</p>
                  </div>
                  <Switch
                    checked={selectedCase?.withdrawalGuideVisible ?? withdrawalGuideVisibleEdit}
                    onCheckedChange={toggleWithdrawalGuideVisible}
                    data-testid="switch-withdrawal-guide-visible"
                  />
                </div>

                {/* Custom guide banner copy — Task #311. When filled, the
                    portal renders this freeform text instead of the default
                    seven-step list. Saved alongside other withdrawal fields
                    via saveWithdrawalProgress. */}
                <div className="space-y-2 mb-4">
                  <Label className="text-slate-300 text-xs font-medium">Custom Guide Banner Copy</Label>
                  <p className="text-xs text-slate-500">
                    Override the default seven-step guide with case-specific instructions. Leave blank to show the standard step list.
                  </p>
                  <textarea
                    value={withdrawalGuideBodyEdit}
                    onChange={(e) => setWithdrawalGuideBodyEdit(e.target.value)}
                    placeholder="e.g. Please transfer funds to the verified payout wallet within 48 hours. Contact compliance if you need an extension."
                    rows={5}
                    className="w-full bg-slate-800/70 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 placeholder-slate-500 resize-y focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    data-testid="textarea-withdrawal-guide-body"
                  />
                  {withdrawalGuideBodyEdit && (
                    <p className="text-[11px] text-indigo-400">Custom copy active — default steps will be hidden for this case.</p>
                  )}
                  <WithdrawalGuidePreview body={withdrawalGuideBodyEdit} />
                </div>

                {/* Toggle to show/hide progress — inline save via
                    toggleShowWithdrawalProgress (Task #336). Mirrors the
                    Withdrawal Guide pattern: optimistic update keeps the
                    Progress Tracker status pill above in sync instantly,
                    rolling back on network or server error. */}
                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg mb-4">
                  <div>
                    <Label className="text-slate-300 font-medium">Show Progress to User</Label>
                    <p className="text-xs text-slate-500">When enabled, user will see the progress tracker on their dashboard</p>
                  </div>
                  <Switch
                    checked={selectedCase?.showWithdrawalProgress ?? showWithdrawalProgressEdit}
                    onCheckedChange={(next) => { setSaveProgressError(null); toggleShowWithdrawalProgress(next); }}
                    data-testid="switch-show-progress"
                  />
                </div>
                
                {/* Stage selector - 14 Stages */}
                {/* STAGE_SEQUENCE_SELECT_BLOCK_START */}
                <div className="space-y-2 mb-4">
                  <Label className="text-slate-300 text-xs font-medium">Current Stage (1-14)</Label>
                  {currentAdminRole !== 'super_admin' && (
                    <p className="text-xs text-amber-400/80">Only the next sequential stage is available for your role.</p>
                  )}
                  {(() => {
                    const currentStageNum = parseInt(selectedCase?.withdrawalStage || '0', 10);
                    const nextStageNum = currentStageNum + 1;
                    const allStages = [
                      { value: "1", label: "💰 Stage 1: Phrase Key Deposit Received" },
                      { value: "2", label: "⚙️ Stage 2: Generating Secure Phrase Key" },
                      { value: "3", label: "🔐 Stage 3: Phrase Key Approved & Available" },
                      { value: "4", label: "🚀 Stage 4: Withdrawal Process Initiated" },
                      { value: "5", label: "✅ Stage 5: Initial Deposit Verification" },
                      { value: "6", label: "🔑 Stage 6: Phrase Key Verification" },
                      { value: "7", label: "📊 Stage 7: Phrase Key Merge Deposit Required" },
                      { value: "8", label: "🏦 Stage 8: Financial Department Verification" },
                      { value: "9", label: "⛏️ Stage 9: Mining Withdrawal for Final Clearance" },
                      { value: "10", label: "🔗 Stage 10: Blockchain Activity Verification" },
                      { value: "11", label: "🏛️ Stage 11: IRS / International AML Verification" },
                      { value: "12", label: "📋 Stage 12: Final Withdrawal Processing" },
                      { value: "13", label: "🎉 Stage 13: Withdrawal Successfully Released" },
                      { value: "14", label: "⏰ Stage 14: Time-Stamp Deposit for Final Delivery" },
                    ];
                    return (
                      <Select
                        value={withdrawalStageEdit}
                        onValueChange={(v) => {
                          setWithdrawalStageEdit(v);
                          setSaveProgressError(null);
                          setStageOverrideChecked(false);
                          setStageOverrideReason("");
                        }}
                      >
                        <SelectTrigger className="bg-slate-800/70 border-slate-700" data-testid="select-withdrawal-stage">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-80">
                          {allStages.map((stage) => {
                            const stageNum = parseInt(stage.value, 10);
                            const isNextStage = stageNum === nextStageNum;
                            const isCurrent = stage.value === selectedCase?.withdrawalStage;
                            const disabled = currentAdminRole !== 'super_admin' && !isNextStage && !isCurrent;
                            return (
                              <SelectItem key={stage.value} value={stage.value} disabled={disabled}>
                                <span className={`flex items-center gap-2${disabled ? ' opacity-40' : ''}`}>{stage.label}</span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    );
                  })()}
                  {/* Super-admin override section — only shown when a non-sequential stage is selected */}
                  {currentAdminRole === 'super_admin' && selectedCase?.withdrawalStage && (() => {
                    const currentStageNum = parseInt(selectedCase.withdrawalStage, 10);
                    const newStageNum = parseInt(withdrawalStageEdit, 10);
                    const isNonSequential = withdrawalStageEdit !== selectedCase.withdrawalStage && newStageNum !== currentStageNum + 1;
                    if (!isNonSequential) return null;
                    return (
                      <div className="mt-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-2" data-testid="stage-override-section">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="stage-override-checkbox"
                            checked={stageOverrideChecked}
                            onChange={(e) => setStageOverrideChecked(e.target.checked)}
                            className="rounded"
                            data-testid="stage-override-checkbox"
                          />
                          <label htmlFor="stage-override-checkbox" className="text-xs text-amber-300 font-medium">
                            Override sequential enforcement (super_admin)
                          </label>
                        </div>
                        {stageOverrideChecked && (
                          <div>
                            <input
                              type="text"
                              value={stageOverrideReason}
                              onChange={(e) => setStageOverrideReason(e.target.value)}
                              placeholder="Reason for override (required)"
                              className="w-full text-xs bg-slate-800/70 border border-amber-500/40 rounded px-2 py-1 text-slate-200 placeholder:text-slate-500"
                              data-testid="stage-override-reason"
                            />
                          </div>
                        )}
                        <p className="text-[10px] text-amber-400/70">
                          Non-sequential transition: Stage {selectedCase.withdrawalStage} → {withdrawalStageEdit}. This override is audit-logged with your identity.
                        </p>
                      </div>
                    );
                  })()}

                  <StageSkipPanels
                    selectedCase={selectedCase!}
                    currentAdminRole={currentAdminRole}
                    withdrawalStageEdit={withdrawalStageEdit}
                    stageSkipRequestReason={stageSkipRequestReason}
                    setStageSkipRequestReason={setStageSkipRequestReason}
                    stageSkipRequestSubmitting={stageSkipRequestSubmitting}
                    submitStageSkipRequest={submitStageSkipRequest}
                    stageSkipRejectReason={stageSkipRejectReason}
                    setStageSkipRejectReason={setStageSkipRejectReason}
                    stageSkipActioning={stageSkipActioning}
                    approveStageSkipRequest={approveStageSkipRequest}
                    rejectStageSkipRequest={rejectStageSkipRequest}
                  />
                </div>
                {/* STAGE_SEQUENCE_SELECT_BLOCK_END */}

                {/* Phrase Key Deposit Amount */}
                <div className="space-y-2 mb-4">
                  <Label className="text-slate-300 text-xs font-medium">Phrase Key Deposit Amount</Label>
                  <p className="text-xs text-slate-500">Set the phrase key deposit amount. 30% merge deposit will be auto-calculated.</p>
                  <Input
                    value={phraseKeyDepositAmountEdit}
                    onChange={(e) => { setPhraseKeyDepositAmountEdit(e.target.value); setSaveProgressError(null); }}
                    placeholder="e.g., 100,000 USDT"
                    className="bg-slate-800/70 border-slate-700"
                    data-testid="input-phrase-key-deposit"
                  />
                  {phraseKeyDepositAmountEdit && (
                    <p className="text-xs text-emerald-400">
                      30% Merge Deposit: {(() => {
                        const numericMatch = phraseKeyDepositAmountEdit.match(/[\d,.]+/);
                        const currencyMatch = phraseKeyDepositAmountEdit.match(/[A-Za-z]+$/);
                        const currencySuffix = currencyMatch ? ' ' + currencyMatch[0] : '';
                        if (numericMatch) {
                          const amount = parseFloat(numericMatch[0].replace(/,/g, ''));
                          if (!isNaN(amount)) {
                            return (amount * 0.30).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + currencySuffix;
                          }
                        }
                        return '—';
                      })()}
                    </p>
                  )}
                  {selectedCase?.phraseKeyMergeDeposit && (
                    <p className="text-xs text-blue-400">
                      Saved Merge Deposit: {selectedCase.phraseKeyMergeDeposit}
                    </p>
                  )}
                </div>
                
                {/* Phrase Key Certificate Status */}
                {selectedCase?.phraseKeyCertificateSent && (
                  <div className="p-3 bg-green-500/10 rounded-lg border border-green-500/20 mb-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-400" />
                      <span className="text-xs text-green-400 font-medium">Phrase Key Certificate Sent</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Auto-generated secure message was sent to user when stage 3 was reached.</p>
                  </div>
                )}

                {/* Activity Wallet Requirement */}
                <div className="space-y-2 mb-4">
                  <Label className="text-slate-300 text-xs font-medium">Activity Wallet Requirement</Label>
                  <p className="text-xs text-slate-500">USDT amount user must maintain in wallet for blockchain activity verification (Stage 10)</p>
                  <Input
                    value={activityWalletRequirementEdit}
                    onChange={(e) => { setActivityWalletRequirementEdit(e.target.value); setSaveProgressError(null); }}
                    placeholder="e.g., 50,000 USDT"
                    className="bg-slate-800/70 border-slate-700"
                    data-testid="input-activity-wallet"
                  />
                </div>
                
                {/* Activity deposit amount (legacy) */}
                <div className="space-y-2 mb-4">
                  <Label className="text-slate-300 text-xs font-medium">Activity Deposit Amount (Display)</Label>
                  <p className="text-xs text-slate-500">General activity deposit amount shown to user</p>
                  <Input
                    value={activityDepositAmountEdit}
                    onChange={(e) => { setActivityDepositAmountEdit(e.target.value); setSaveProgressError(null); }}
                    placeholder="e.g., 50,000 USDT"
                    className="bg-slate-800/70 border-slate-700"
                    data-testid="input-activity-deposit"
                  />
                </div>
                
                {/* Quick Stage Approval */}
                <div className="p-4 bg-gradient-to-r from-blue-500/10 to-cyan-500/10 rounded-xl border border-blue-500/30 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="text-sm font-bold text-blue-400">Quick Stage Approval</h4>
                      <p className="text-xs text-slate-500">Current: Stage {selectedCase?.withdrawalStage || '1'} of 14</p>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold text-blue-400">{selectedCase?.withdrawalStage || '1'}</span>
                      <span className="text-slate-500 text-sm">/14</span>
                    </div>
                  </div>
                  <Button 
                    onClick={approveNextStage}
                    disabled={parseInt(selectedCase?.withdrawalStage || '1') >= 14}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600"
                    data-testid="button-approve-next-stage"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" /> 
                    {parseInt(selectedCase?.withdrawalStage || '1') >= 14 
                      ? 'Final Stage Reached' 
                      : `Approve → Stage ${parseInt(selectedCase?.withdrawalStage || '1') + 1}`
                    }
                  </Button>
                  <Button
                    onClick={openStageEmailDialog}
                    disabled={isSendingStageEmail || !selectedCase?.userEmail}
                    variant="outline"
                    className="w-full mt-2 border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100 disabled:opacity-60"
                    data-testid="button-open-stage-email"
                    title={!selectedCase?.userEmail ? "User has no email address on file" : `Preview & email Stage ${selectedCase?.withdrawalStage || '1'} instructions to ${selectedCase?.userEmail}`}
                  >
                    <Mail className="h-4 w-4 mr-2" />
                    {`Preview & Email Stage ${selectedCase?.withdrawalStage || '1'} Instructions…`}
                  </Button>
                  {!selectedCase?.userEmail && (
                    <p className="text-[11px] text-amber-300/70 mt-1.5 text-center">
                      No email address on file for this user.
                    </p>
                  )}
                </div>
                
                <Button 
                  onClick={updateWithdrawalProgress} 
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  data-testid="button-save-progress"
                >
                  <Save className="h-4 w-4 mr-2" /> Save Progress Settings
                </Button>
                {saveProgressError && (
                  <p role="alert" data-testid="save-error-message" className="text-sm text-red-400 mt-2 text-center">
                    {saveProgressError}
                  </p>
                )}
              </div>
            </div>

            </fieldset>

            {/* Task #181 — Stamp Duty receipt reviewer (relocated from inside
                SECTION 1 of the workflow tab). Kept inside the workflow
                TabsContent for discoverability, but rendered OUTSIDE the
                post-seal disabled fieldset so admins can still approve or
                reject late-arriving receipts after NDA seal. Matches the
                behavior of the merged Uploads panel and the cross-case
                All Receipts tab. */}
                {/* Task #113 — Stamp Duty receipt reviewer. The server gate
                    in /cases/:id/seal-nda blocks the NDA from sealing until
                    a receipt is approved here, so admins need first-class
                    visibility into pending uploads without leaving the
                    case-detail dialog. */}
                <div className="space-y-3" data-testid="section-stamp-duty-review">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300 font-medium flex items-center gap-2">
                      <Scale className="h-4 w-4 text-amber-300" />
                      Stamp Duty Receipts
                    </Label>
                    <span className="text-[10px] text-amber-200 bg-amber-900/40 border border-amber-800/60 px-2 py-0.5 rounded uppercase tracking-wide">
                      Review &amp; Approve
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 -mt-1">
                    User-submitted Stamp Duty Deposit receipts. Approving one unlocks the
                    Sealed Settlement &amp; NDA; rejecting one lets the user re-upload.
                  </p>

                  {selectedCase && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                      <div className="bg-slate-800/40 border border-slate-700/60 rounded px-3 py-2">
                        <div className="text-slate-500 uppercase tracking-wide text-[10px]">Gate</div>
                        <div className="text-slate-200 font-semibold" data-testid="stamp-duty-gate-state">
                          {selectedCase.stampDutyEnabled === false ? 'Disabled' : 'Enabled'}
                        </div>
                      </div>
                      <div className="bg-slate-800/40 border border-slate-700/60 rounded px-3 py-2">
                        <div className="text-slate-500 uppercase tracking-wide text-[10px]">Case Status</div>
                        <div className="text-slate-200 font-semibold" data-testid="stamp-duty-case-status">
                          {selectedCase.stampDutyStatus ?? 'awaiting_upload'}
                        </div>
                      </div>
                      <div className="bg-slate-800/40 border border-slate-700/60 rounded px-3 py-2">
                        <div className="text-slate-500 uppercase tracking-wide text-[10px]">Approved At</div>
                        <div className="text-slate-200 font-semibold">
                          {selectedCase.stampDutyApprovedAt
                            ? new Date(selectedCase.stampDutyApprovedAt).toLocaleString()
                            : '—'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Admin-triggered fee reminder. Emails the configured
                      deposit wallet(s) + amount to an arbitrary recipient
                      (prefilled with the case userEmail). Useful when a
                      user has stalled before uploading their receipt. */}
                  <div
                    className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 space-y-2"
                    data-testid="section-stamp-duty-reminder"
                  >
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-amber-300" />
                      <Label className="text-slate-300 text-xs font-semibold uppercase tracking-wide">
                        Send Fee Reminder
                      </Label>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Emails the stamp duty amount and every configured
                      deposit wallet to the recipient below. Defaults to the
                      case's email — edit to send anywhere.
                    </p>
                    {lastStampDutyReminder && (
                      <div
                        className={`text-[11px] rounded border px-2 py-1.5 ${
                          lastStampDutyReminder.success
                            ? 'bg-slate-800/40 border-slate-700/60 text-slate-300'
                            : 'bg-rose-950/40 border-rose-800/60 text-rose-200'
                        }`}
                        data-testid="text-last-stamp-duty-reminder"
                      >
                        <span className="text-slate-500">Last reminder:</span>{' '}
                        <span className="font-semibold">
                          {new Date(lastStampDutyReminder.sentAt).toLocaleString()}
                        </span>
                        {lastStampDutyReminder.adminUsername && (
                          <>
                            {' '}by{' '}
                            <span className="font-semibold">
                              {lastStampDutyReminder.adminUsername}
                            </span>
                          </>
                        )}
                        {!lastStampDutyReminder.success && (
                          <span className="ml-1 font-semibold uppercase tracking-wide text-rose-300">
                            · failed
                          </span>
                        )}
                        {lastStampDutyReminder.details && (
                          <div className="text-slate-500 mt-0.5 truncate">
                            {lastStampDutyReminder.details}
                          </div>
                        )}
                      </div>
                    )}
                    <Input
                      type="email"
                      value={stampDutyReminderEmail}
                      onChange={(e) => setStampDutyReminderEmail(e.target.value)}
                      placeholder="recipient@example.com"
                      className="bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 h-9 text-sm"
                      disabled={stampDutyReminderSending}
                      data-testid="input-stamp-duty-reminder-email"
                    />
                    <Textarea
                      value={stampDutyReminderMessage}
                      onChange={(e) => setStampDutyReminderMessage(e.target.value)}
                      placeholder="Optional note to include in the email (max 2000 chars)…"
                      className="bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 text-sm min-h-[60px]"
                      maxLength={2000}
                      disabled={stampDutyReminderSending}
                      data-testid="textarea-stamp-duty-reminder-message"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={sendStampDutyReminder}
                        disabled={
                          stampDutyReminderSending ||
                          !stampDutyReminderEmail.trim()
                        }
                        className="bg-amber-600 hover:bg-amber-700 text-white"
                        data-testid="button-send-stamp-duty-reminder"
                      >
                        {stampDutyReminderSending ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                            Sending…
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4 mr-1.5" />
                            Send Reminder
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {stampDutyReceipts.length === 0 ? (
                    <div
                      className="text-center text-xs text-slate-500 bg-slate-800/30 border border-dashed border-slate-700/60 rounded-lg py-6"
                      data-testid="stamp-duty-receipts-empty"
                    >
                      No stamp duty receipts have been uploaded yet.
                    </div>
                  ) : (
                    <div className="space-y-3" data-testid="stamp-duty-receipts-list">
                      {stampDutyReceipts.map((receipt) => {
                        const isPending = pendingStampDutyIds.has(receipt.id);
                        // Task #180 — unify the actionable rule across all
                        // three admin surfaces (this standalone section,
                        // CaseMergedReceiptsPanel, AllReceiptsTab) via the
                        // shared helpers in lib/receiptStatus.ts.
                        const canReview = isActionableReceiptStatus(receipt.status);
                        const isTerminal = !canReview;
                        const blob = stampDutyReceiptBlobs[receipt.id];
                        const isPdf =
                          (receipt.fileName ?? '').toLowerCase().endsWith('.pdf') ||
                          (blob ?? '').startsWith('data:application/pdf');
                        const badgeVariant =
                          receipt.status === 'approved'
                            ? 'default'
                            : receipt.status === 'rejected'
                            ? 'destructive'
                            : 'secondary';
                        return (
                          <div
                            key={receipt.id}
                            className="p-3 bg-slate-900/60 rounded-lg border border-slate-800"
                            data-testid={`stamp-duty-receipt-${receipt.id}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm text-slate-200 font-semibold truncate">
                                  {receipt.fileName || `Receipt #${receipt.id}`}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  Uploaded {new Date(receipt.uploadedAt).toLocaleString()} ·{' '}
                                  <span className="text-amber-300 font-semibold">
                                    {receipt.amountUsdt} USDT
                                  </span>
                                </div>
                                {receipt.notes && (
                                  <p className="text-xs text-slate-400 mt-2">
                                    <span className="text-slate-500">User note:</span> {receipt.notes}
                                  </p>
                                )}
                                {receipt.adminNotes && (
                                  <p className="text-xs text-slate-400 mt-1">
                                    <span className="text-slate-500">Admin note:</span> {receipt.adminNotes}
                                  </p>
                                )}
                                {(receipt.reviewedBy || receipt.reviewedAt) && (
                                  <p className="text-[11px] text-slate-500 mt-1">
                                    Reviewed by{' '}
                                    <span className="text-slate-300 font-semibold">
                                      {receipt.reviewedBy || 'Admin'}
                                    </span>
                                    {receipt.reviewedAt && (
                                      <>
                                        {' '}on{' '}
                                        <span className="font-mono">
                                          {new Date(receipt.reviewedAt).toLocaleString()}
                                        </span>
                                      </>
                                    )}
                                  </p>
                                )}
                              </div>
                              <Badge variant={badgeVariant} data-testid={`stamp-duty-receipt-status-${receipt.id}`}>
                                {receipt.status}
                              </Badge>
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {!blob ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="bg-slate-800/40 border-slate-700 text-slate-200 hover:bg-slate-800"
                                  onClick={() => loadStampDutyReceiptBlob(receipt.id)}
                                  data-testid={`button-load-stamp-duty-${receipt.id}`}
                                >
                                  <Eye className="h-4 w-4 mr-1" /> Load file preview
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="bg-slate-800/40 border-slate-700 text-slate-200 hover:bg-slate-800"
                                    onClick={() => window.open(blob, '_blank')}
                                    data-testid={`button-open-stamp-duty-${receipt.id}`}
                                  >
                                    <ExternalLink className="h-4 w-4 mr-1" /> Open in new tab
                                  </Button>
                                  <a
                                    href={blob}
                                    download={receipt.fileName || `stamp-duty-${receipt.id}`}
                                    className="inline-flex items-center text-[11px] text-slate-400 hover:text-slate-200 underline"
                                    data-testid={`link-download-stamp-duty-${receipt.id}`}
                                  >
                                    <Download className="h-3 w-3 mr-1" /> Download
                                  </a>
                                </>
                              )}
                            </div>

                            {blob && (
                              <div className="mt-3">
                                {isPdf ? (
                                  <iframe
                                    src={blob}
                                    title={`Stamp duty receipt ${receipt.id}`}
                                    className="w-full h-64 rounded border border-slate-800 bg-slate-950"
                                    data-testid={`preview-stamp-duty-pdf-${receipt.id}`}
                                  />
                                ) : (
                                  <img
                                    src={blob}
                                    alt={`Stamp duty receipt ${receipt.id}`}
                                    className="max-h-64 rounded border border-slate-800 cursor-pointer object-contain bg-slate-950"
                                    onClick={() => window.open(blob, '_blank')}
                                    data-testid={`preview-stamp-duty-img-${receipt.id}`}
                                  />
                                )}
                              </div>
                            )}

                            {!isTerminal && (
                              <div className="mt-3 space-y-2 border-t border-slate-800/60 pt-3">
                                {stampDutyRejectingId === receipt.id ? (
                                  <>
                                    <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                                      Rejection reason (sent to the user)
                                    </Label>
                                    <Textarea
                                      value={stampDutyRejectReason}
                                      onChange={(e) => setStampDutyRejectReason(e.target.value)}
                                      placeholder="Explain why this receipt is being rejected so the user can fix and re-upload."
                                      className="bg-slate-800/50 border-slate-700 text-white text-sm resize-none"
                                      rows={3}
                                      data-testid={`textarea-stamp-duty-reject-${receipt.id}`}
                                    />
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        disabled={isPending || !stampDutyRejectReason.trim()}
                                        onClick={() =>
                                          reviewStampDutyReceipt(
                                            receipt.id,
                                            'reject',
                                            stampDutyRejectReason.trim(),
                                          )
                                        }
                                        data-testid={`button-confirm-reject-stamp-duty-${receipt.id}`}
                                      >
                                        <X className="h-4 w-4 mr-1" />
                                        {isPending ? 'Saving…' : 'Confirm rejection'}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="bg-slate-800/40 border-slate-700 text-slate-200 hover:bg-slate-800"
                                        disabled={isPending}
                                        onClick={() => {
                                          setStampDutyRejectingId(null);
                                          setStampDutyRejectReason('');
                                        }}
                                        data-testid={`button-cancel-reject-stamp-duty-${receipt.id}`}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                                      Internal note (optional, attached to the audit trail)
                                    </Label>
                                    <Textarea
                                      value={stampDutyApprovalNote}
                                      onChange={(e) => setStampDutyApprovalNote(e.target.value)}
                                      placeholder="Optional note for the audit log."
                                      className="bg-slate-800/50 border-slate-700 text-white text-sm resize-none"
                                      rows={2}
                                      data-testid={`textarea-stamp-duty-approval-${receipt.id}`}
                                    />
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() =>
                                          reviewStampDutyReceipt(
                                            receipt.id,
                                            'approve',
                                            stampDutyApprovalNote.trim() || undefined,
                                          )
                                        }
                                        disabled={isPending}
                                        className="bg-green-600 hover:bg-green-700 disabled:opacity-60"
                                        data-testid={`button-approve-stamp-duty-${receipt.id}`}
                                      >
                                        <CheckCircle className="h-4 w-4 mr-1" />
                                        {isPending ? 'Saving…' : 'Approve'}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        disabled={isPending}
                                        onClick={() => {
                                          setStampDutyRejectingId(receipt.id);
                                          setStampDutyRejectReason('');
                                        }}
                                        data-testid={`button-reject-stamp-duty-${receipt.id}`}
                                      >
                                        <X className="h-4 w-4 mr-1" /> Reject…
                                      </Button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Session Refresh Deposit gate */}
                <SessionRefreshPanel
                  selectedCase={selectedCase}
                  authToken={authToken}
                  onCaseUpdated={(updated) => {
                    setSelectedCase(updated as typeof selectedCase);
                    setCases((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
                  }}
                />
              </TabsContent>

              <TabsContent value="communications" className="space-y-6 mt-0">
            {/* Portal Closure Warning — sits outside the sealed fieldset so it
                can be triggered even when the case is sealed (sealed cases can
                still have active portal sessions). */}
            {selectedCase && (
              <AdminPortalWarningPanel
                caseId={selectedCase.id}
                authToken={authToken}
                userLabel={(selectedCase.userName ?? "").trim() || selectedCase.accessCode}
                adminRole={currentAdminRole}
                portalWarningAt={selectedCase.portalWarningAt}
                portalWarningMinutes={selectedCase.portalWarningMinutes}
                portalWarningMessage={selectedCase.portalWarningMessage}
                activityDepositAmount={selectedCase.activityDepositAmount}
                reactivationPageMessage={selectedCase.reactivationPageMessage}
                onChanged={() => {
                  // Reload the case list so the dialog reflects the updated warning state.
                  void fetch(`/api/cases/${selectedCase.id}`, {
                    headers: { Authorization: `Bearer ${authToken}` },
                  })
                    .then((r) => r.ok ? r.json() : null)
                    .then((fresh) => {
                      if (fresh) {
                        setSelectedCase((prev) => prev ? { ...prev, ...fresh } : prev);
                        setCases((prev) =>
                          prev.map((c) => c.id === fresh.id ? { ...c, ...fresh } : c),
                        );
                      }
                    })
                    .catch(() => {});
                }}
                onOpenCase={(id) => {
                  setActiveTab("cases");
                  const target = cases.find((c) => c.id === id);
                  if (target) {
                    openAdminMessageDialog(target);
                  } else {
                    setSearchQuery(id);
                  }
                }}
              />
            )}
            <fieldset disabled={!!selectedCase?.sealedAt} className="contents space-y-6">
            {/* SECTION 2: Communication */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2">
                <div className="h-6 w-6 rounded bg-purple-500/20 flex items-center justify-center">
                  <MessageCircle className="h-3.5 w-3.5 text-purple-400" />
                </div>
                <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wide">{t("sections.communication")}</h3>
              </div>

              {/* Deposit Explanation Quick-Send Panel */}
              <div className="p-4 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 rounded-xl border border-emerald-500/20">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  <h4 className="font-semibold text-white">1,500 USDT Deposit — Quick Explanations</h4>
                  <span className="text-[10px] text-emerald-300/70 bg-emerald-500/20 px-2 py-0.5 rounded ml-auto">PRE-WRITTEN</span>
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  Tap <strong className="text-white">Insert</strong> to load the reply into the form below for review,
                  or <strong className="text-white">Send Now</strong> to deliver it instantly. The deposit amount is taken
                  from this case's <code className="text-emerald-300">activityDepositAmount</code> when set, otherwise defaults to 1,500 USDT.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {(() => {
                    const amount = (selectedCase?.activityDepositAmount && String(selectedCase.activityDepositAmount).trim())
                      || (selectedCase?.phraseKeyDepositAmount && String(selectedCase.phraseKeyDepositAmount).trim())
                      || '1,500';
                    const fee = '500';
                    const refundable = '1,000';
                    const templates = buildDepositQuickSendTemplates(amount, fee, refundable);
                    return templates.map((t, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg border ${
                          t.tone === 'red' ? 'bg-red-500/5 border-red-500/20' :
                          t.tone === 'amber' ? 'bg-amber-500/5 border-amber-500/20' :
                          'bg-emerald-500/5 border-emerald-500/20'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${
                              t.tone === 'red' ? 'text-red-300' :
                              t.tone === 'amber' ? 'text-amber-300' :
                              'text-emerald-300'
                            }`}>
                              {t.title}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 whitespace-pre-wrap">
                              {t.body.substring(0, 180)}…
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-slate-700 text-slate-200 hover:bg-slate-800 h-7 text-xs"
                            onClick={() => setNewAdminMessage({ category: t.category, title: t.title, body: t.body })}
                            data-testid={`button-deposit-template-insert-${idx}`}
                          >
                            Insert into form
                          </Button>
                          <Button
                            size="sm"
                            className={`h-7 text-xs text-white ${
                              t.tone === 'red' ? 'bg-red-600 hover:bg-red-700' :
                              t.tone === 'amber' ? 'bg-amber-600 hover:bg-amber-700' :
                              'bg-emerald-600 hover:bg-emerald-700'
                            }`}
                            onClick={async () => {
                              if (!selectedCase) return;
                              try {
                                const tok = authToken || sessionStorage.getItem('adminToken') || '';
                                const res = await fetch(`/api/cases/${selectedCase.id}/admin-messages`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
                                  body: JSON.stringify({ category: t.category, title: t.title, body: t.body }),
                                });
                                if (res.ok) {
                                  const created = await res.json();
                                  setAdminMessages(prev => [created, ...prev]);
                                  toast({ title: 'Sent', description: `"${t.title}" delivered to ${selectedCase.userName ?? 'user'}.` });
                                } else {
                                  toast({ title: 'Failed', description: 'Could not send the message.', variant: 'destructive' });
                                }
                              } catch {
                                toast({ title: 'Network error', description: 'Could not reach the server.', variant: 'destructive' });
                              }
                            }}
                            data-testid={`button-deposit-template-send-${idx}`}
                          >
                            <Send className="h-3 w-3 mr-1" /> Send Now
                          </Button>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* Send New Message Card */}
              <div className="p-4 bg-gradient-to-br from-purple-500/10 to-indigo-500/5 rounded-xl border border-purple-500/20">
                <div className="flex items-center gap-2 mb-4">
                  <Send className="h-4 w-4 text-purple-400" />
                  <h4 className="font-semibold text-white">Send Admin Message</h4>
                  <span className="text-[10px] text-purple-300/60 bg-purple-500/20 px-2 py-0.5 rounded ml-auto">REQUIRED ACTIONS</span>
                </div>
                <p className="text-xs text-slate-400 mb-4">Messages appear in the user's Required Actions section. Choose a category to indicate priority.</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs font-medium">Priority Category</Label>
                    <Select 
                      value={newAdminMessage.category} 
                      onValueChange={(v) => setNewAdminMessage(prev => ({ ...prev, category: v as any }))}
                    >
                      <SelectTrigger className="bg-slate-800/70 border-slate-700" data-testid="select-message-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="urgent">
                          <span className="flex items-center gap-2 text-red-400">
                            <AlertTriangle className="h-3.5 w-3.5" /> Urgent Action Required
                          </span>
                        </SelectItem>
                        <SelectItem value="processing">
                          <span className="flex items-center gap-2 text-amber-400">
                            <Clock className="h-3.5 w-3.5" /> Processing / In Progress
                          </span>
                        </SelectItem>
                        <SelectItem value="resolved">
                          <span className="flex items-center gap-2 text-green-400">
                            <CheckCircle className="h-3.5 w-3.5" /> Resolved / Complete
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs font-medium">Message Title</Label>
                    <Input
                      value={newAdminMessage.title}
                      onChange={(e) => setNewAdminMessage(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="Brief summary of the message..."
                      className="bg-slate-800/70 border-slate-700"
                      data-testid="input-message-title"
                    />
                  </div>
                </div>
                <div className="space-y-2 mb-4">
                  <Label className="text-slate-300 text-xs font-medium">Message Content</Label>
                  <Textarea
                    value={newAdminMessage.body}
                    onChange={(e) => setNewAdminMessage(prev => ({ ...prev, body: e.target.value }))}
                    placeholder="Enter the full message for the user..."
                    className="bg-slate-800/70 border-slate-700 min-h-[100px] resize-none"
                    data-testid="input-message-body"
                  />
                </div>
                <Button 
                  onClick={sendNewAdminMessage} 
                  className="w-full bg-purple-600 hover:bg-purple-700"
                  disabled={!newAdminMessage.title.trim() || !newAdminMessage.body.trim()}
                  data-testid="button-send-admin-message"
                >
                  <Send className="h-4 w-4 mr-2" /> Send Message to User
                </Button>
              </div>
            </div>

            </fieldset>
              
            <fieldset disabled={!!selectedCase?.sealedAt} className="contents space-y-6">
            {/* SECTION 5: Message History */}
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded bg-slate-700/50 flex items-center justify-center">
                    <History className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">{t("sections.messageHistory")}</h3>
                </div>
                <span className="text-xs text-slate-600">{adminMessages.length} message{adminMessages.length !== 1 ? 's' : ''}</span>
              </div>

              {adminMessages.length === 0 ? (
                <div className="text-center py-8 bg-slate-900/30 rounded-xl border border-slate-800/30 border-dashed">
                  <MessageCircle className="h-8 w-8 text-slate-700 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">No messages sent yet</p>
                  <p className="text-slate-600 text-xs">Messages you send will appear here</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
                  {adminMessages.map(msg => (
                    <motion.div 
                      key={msg.id} 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`p-4 rounded-xl border transition-all ${
                        msg.category === 'urgent' ? 'bg-red-500/5 border-red-500/20' :
                        msg.category === 'processing' ? 'bg-amber-500/5 border-amber-500/20' :
                        'bg-green-500/5 border-green-500/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                            msg.category === 'urgent' ? 'bg-red-500/20' :
                            msg.category === 'processing' ? 'bg-amber-500/20' :
                            'bg-green-500/20'
                          }`}>
                            {msg.category === 'urgent' && <AlertTriangle className="h-4 w-4 text-red-400" />}
                            {msg.category === 'processing' && <Clock className="h-4 w-4 text-amber-400" />}
                            {msg.category === 'resolved' && <CheckCircle className="h-4 w-4 text-green-400" />}
                          </div>
                          <div>
                            <span className="font-medium text-white block">{msg.title}</span>
                            <span className="text-xs text-slate-500">{new Date(msg.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {msg.isRead && (
                            <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/10">
                              <Eye className="h-3 w-3 mr-1" /> Read
                            </Badge>
                          )}
                          <Badge 
                            variant="outline" 
                            className={`text-[10px] capitalize ${
                              msg.category === 'urgent' ? 'border-red-500/50 text-red-400 bg-red-500/10' :
                              msg.category === 'processing' ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' :
                              'border-green-500/50 text-green-400 bg-green-500/10'
                            }`}
                          >
                            {msg.category}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm text-slate-300 mb-3 pl-10">{msg.body}</p>
                      <div className="flex justify-end gap-2 pl-10">
                        {msg.category === 'urgent' && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-7 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10 bg-transparent"
                            onClick={() => updateAdminMessageStatus(msg.id, 'processing')}
                          >
                            <Clock className="h-3 w-3 mr-1" /> Mark Processing
                          </Button>
                        )}
                        {msg.category === 'processing' && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10 bg-transparent"
                            onClick={() => updateAdminMessageStatus(msg.id, 'resolved')}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" /> Mark Resolved
                          </Button>
                        )}
                        {msg.category !== 'urgent' && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 bg-transparent"
                            onClick={() => updateAdminMessageStatus(msg.id, 'urgent')}
                          >
                            <AlertTriangle className="h-3 w-3 mr-1" /> Mark Urgent
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-slate-600/40 text-slate-300 hover:bg-slate-700/40 bg-transparent"
                          onClick={() => unsendAdminMessage(msg.id, msg.title)}
                          data-testid={`button-unsend-message-${msg.id}`}
                          title="Remove this message from the user's Secure Messages"
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Unsend
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
            </fieldset>
            {/* Per-case email delivery panel — Task #143. Surfaces the
                background-dispatched transactional emails (custom, stage
                instructions, account reactivation, and the rest of the
                sendCaseEmailWithAudit-driven sends) so admins can confirm
                a queued send actually landed without scrolling the global
                audit log. Sits OUTSIDE the sealed-disabled fieldset so it
                remains usable on sealed cases. */}
            {selectedCase && (
              <CaseEmailDeliveryPanel
                caseId={selectedCase.id}
                authToken={authToken}
                scrollSignal={emailPanelScrollSignal}
              />
            )}
              
</TabsContent>

              <TabsContent value="audit" className="space-y-6 mt-0">
            {/* SECTION 3a: Inline Audit Log Viewer (case-scoped) — sits OUTSIDE
                the sealed fieldset because reading the audit trail must stay
                available even on read-only sealed cases. */}
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded bg-blue-500/20 flex items-center justify-center">
                    <History className="h-3.5 w-3.5 text-blue-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wide">Audit Log</h3>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadAuditLogs()}
                  className="h-7 border-slate-700 bg-slate-800 text-slate-200 hover:text-white"
                  data-testid="case-audit-refresh"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
                </Button>
              </div>
              {(() => {
                const caseAudit = selectedCase
                  ? (auditLogs as Array<AuditLog & { targetType?: string | null; targetId?: string | null }>).filter(
                      (l) => l.targetType === 'case' && l.targetId === selectedCase.id,
                    )
                  : [];
                if (caseAudit.length === 0) {
                  return (
                    <div
                      className="text-center py-6 bg-slate-900/30 rounded-lg border border-slate-800/50"
                      data-testid="case-audit-empty"
                    >
                      <History className="h-8 w-8 mx-auto text-slate-700 mb-2" />
                      <p className="text-sm text-slate-500">No audit entries for this case yet</p>
                      <p className="text-xs text-slate-600">Use Refresh to pull the latest entries</p>
                    </div>
                  );
                }
                return (
                  <div
                    className="max-h-64 overflow-y-auto rounded-lg border border-slate-800/60 divide-y divide-slate-800/60"
                    data-testid="case-audit-list"
                  >
                    {caseAudit.map((log) => (
                      <div key={log.id} className="px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-slate-300">{getAuditActionLabel(log.action)}</span>
                          <span className="text-slate-500">
                            {new Date(log.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          by <span className="text-slate-300">{log.adminUsername}</span>
                        </div>
                        {log.newValue && (
                          <div className="mt-1 text-slate-400 bg-slate-800/60 rounded px-2 py-1 break-words text-[11px]">
                            {formatAuditValue(log.action, log.newValue)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <fieldset disabled={!!selectedCase?.sealedAt} className="contents space-y-6">
            {/* SECTION 3: Case Notes (Admin Only) */}
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded bg-indigo-500/20 flex items-center justify-center">
                    <StickyNote className="h-3.5 w-3.5 text-indigo-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wide">{t("sections.caseNotes")}</h3>
                </div>
                <span className="text-[10px] text-slate-600 bg-slate-800 px-2 py-0.5 rounded">PRIVATE</span>
              </div>
              
              {/* Add Note Input */}
              <div className="flex gap-2">
                <Input
                  placeholder="Add a private note..."
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && selectedCase && createCaseNote(selectedCase.id)}
                  className="flex-1 bg-slate-800/50 border-slate-700"
                />
                <Button
                  onClick={() => selectedCase && createCaseNote(selectedCase.id)}
                  disabled={!newNoteContent.trim() || isAddingNote}
                  size="sm"
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              {/* Notes List */}
              {caseNotes.length === 0 ? (
                <div className="text-center py-4 bg-slate-900/30 rounded-lg border border-slate-800/50">
                  <StickyNote className="h-8 w-8 mx-auto text-slate-700 mb-2" />
                  <p className="text-sm text-slate-500">No notes yet</p>
                  <p className="text-xs text-slate-600">Add private notes for internal tracking</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {caseNotes.map(note => (
                    <div 
                      key={note.id} 
                      className={`p-3 rounded-lg border ${note.isPinned ? 'bg-amber-500/5 border-amber-500/30' : 'bg-slate-900/30 border-slate-800/50'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm text-slate-200">{note.content}</p>
                          <p className="text-xs text-slate-500 mt-1">
                            {note.adminUsername} • {new Date(note.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => selectedCase && toggleNotePin(note.id, selectedCase.id)}
                            className={`h-7 w-7 p-0 ${note.isPinned ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'}`}
                          >
                            <Pin className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => selectedCase && deleteCaseNote(note.id, selectedCase.id)}
                            className="h-7 w-7 p-0 text-slate-500 hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            </fieldset>
              </TabsContent>

              <TabsContent value="paid" className="space-y-6 mt-0">
                {selectedCase && Number(selectedCase.withdrawalStage ?? 0) >= 14 ? (
                  <TokenDepositPaidTab
                    selectedCase={selectedCase}
                    authToken={authToken}
                    onRefresh={async () => {
                      const token = authToken || sessionStorage.getItem('adminToken');
                      if (!token || !selectedCase) return;
                      try {
                        const res = await fetch(`/api/cases/${selectedCase.id}`, {
                          headers: { 'Authorization': `Bearer ${token}` },
                        });
                        if (res.ok) { const fresh = await res.json(); setSelectedCase(fresh); }
                      } catch { /* ignore */ }
                    }}
                  />
                ) : (
                  <div className="text-center py-10 text-slate-500 text-sm">
                    The Paid tab is only available for cases at stage 14.
                  </div>
                )}
              </TabsContent>

              

              <TabsContent value="documents" className="space-y-6 mt-0">
            <ErrorBoundary fallback={<AdminTabFallback label="Documents" />}>
            <fieldset disabled={!!selectedCase?.sealedAt} className="contents space-y-6">
            {/* SECTION 4.5: Regulatory Documents */}
            {selectedCase && (
              <CaseDocumentsSection
                caseId={selectedCase.id}
                ndaSealed={!!selectedCase.sealedAt}
                requests={documentRequests.filter(d => d.caseId === selectedCase.id)}
                newRequest={newDocumentRequest}
                setNewRequest={setNewDocumentRequest}
                onCreate={createDocumentRequest}
                onApprove={approveDocumentRequest}
                onReject={rejectDocumentRequest}
                onMarkUnderReview={markDocumentUnderReview}
                onRequestKycIdBundle={requestKycIdBundle}
                fetchDocumentFile={fetchDocumentFile}
              />
            )}

            {/* Supporting documents uploaded directly by the case holder */}
            {selectedCase && (
              <SupportingDocumentsPanel
                caseId={selectedCase.id}
                authToken={authToken}
                onActioned={loadUserDocPendingCounts}
              />
            )}

            {/* Task #379 — per-case mute toggle for the document upload
                alert. Sits next to the supporting-documents panel because
                that's the exact workflow it silences (KYC remediation
                rounds, etc.). The global cooldown still applies; this is
                an override for noisy single cases. */}
            {selectedCase && (() => {
              const isMuted = mutedAlertCaseIds.has(selectedCase.id);
              return (
                <div
                  className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-4"
                  data-testid="case-doc-upload-alert-mute-panel"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <BellOff className="h-4 w-4 text-amber-400" />
                        Mute upload alerts
                      </h4>
                      <p className="text-xs text-slate-500 mt-1 max-w-md">
                        When muted, supporting-document uploads on this case
                        won't trigger admin email alerts. The global cooldown
                        is unaffected for other cases. Both mute and unmute
                        actions are audit-logged.
                      </p>
                      {isMuted && (
                        <Badge
                          variant="outline"
                          className="mt-2 text-amber-200 border-amber-500 bg-amber-500/15"
                          data-testid="badge-doc-upload-alert-muted"
                        >
                          <BellOff className="w-3 h-3 mr-1" /> MUTED
                        </Badge>
                      )}
                    </div>
                    <Switch
                      checked={isMuted}
                      disabled={isAlertMuteSaving}
                      onCheckedChange={(v) => toggleAlertMute(selectedCase.id, v)}
                      data-testid="switch-doc-upload-alert-mute"
                    />
                  </div>
                </div>
              );
            })()}

            {/* Task #163 unified per-case Uploads — opens the existing
                deposit-receipts dialog (which now renders the merged
                activation/reissue/certificate/stamp-duty/other panel via
                GET /api/cases/:id/all-receipts). Kept as a launcher so the
                Documents tab links into the same approved reviewer surface
                instead of forking a second copy. */}
            {selectedCase && (
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">
                      Receipts &amp; Uploads
                    </h4>
                    <p className="text-xs text-slate-500 mt-1">
                      Activation, reissue, certificate, stamp duty and other
                      user-submitted receipts for this case.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openReceiptsDialog(selectedCase)}
                    className="border-slate-700 bg-slate-800 text-slate-200 hover:text-white"
                    data-testid="case-documents-open-receipts"
                  >
                    <Image className="h-3.5 w-3.5 mr-1" /> Open receipts panel
                  </Button>
                </div>
              </div>
            )}

            </fieldset>
            </ErrorBoundary>
              </TabsContent>

              
            </Tabs>
            </motion.div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Declaration of Compliance — review dialog */}
      <Dialog open={isDeclarationOpen} onOpenChange={setIsDeclarationOpen}>
        <DialogContent className="max-w-3xl bg-slate-950 border-slate-800 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-amber-400" />
              {t("dialogs.declaration.title", { name: declarationCase?.userName ?? declarationCase?.id })}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {declarationCase?.declarationStatus === 'pending'
                ? 'User has been asked to complete the declaration. They have not yet submitted.'
                : declarationCase?.declarationStatus === 'submitted'
                  ? 'Review the user\'s declaration below and approve or reject.'
                  : declarationCase?.declarationStatus === 'approved'
                    ? 'This declaration has been approved.'
                    : declarationCase?.declarationStatus === 'rejected'
                      ? 'This declaration has been rejected.'
                      : 'No declaration submission found yet.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <AnimatePresence initial={false}>
              {isLoadingDeclarations ? (
                <motion.div
                  key="declaration-skeleton"
                  exit={{ opacity: 0 }}
                  transition={dialogFadeTransition}
                >
                  <div className="text-center py-8 text-slate-400">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading declarations…
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="declaration-content"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={dialogFadeTransition}
                >

            {declarationSubmissions.length === 0 && (
              <div className="text-center py-8 text-slate-400 border border-dashed border-slate-700 rounded-xl">
                {declarationCase?.declarationStatus === 'pending'
                  ? 'Awaiting user submission. The declaration form is available in their portal.'
                  : 'No declaration submissions on record for this case.'}
              </div>
            )}

            {declarationSubmissions.length > 0 && (() => {
              const sub = declarationSubmissions[selectedDeclIdx] ?? declarationSubmissions[0];
              const FieldRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
                <div className="grid grid-cols-3 gap-3 py-1.5 border-b border-slate-800/60 last:border-0">
                  <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">{label}</div>
                  <div className="col-span-2 text-sm text-slate-100 break-words">{value || <span className="text-slate-500 italic">—</span>}</div>
                </div>
              );
              const Yes = ({ ok }: { ok: boolean }) => (
                <Badge className={ok ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-red-500/15 text-red-300 border border-red-500/30"}>
                  {ok ? 'Yes' : 'No'}
                </Badge>
              );
              return (
                <>
                  {/* Submission picker — shown when there are multiple */}
                  {declarationSubmissions.length > 1 && (
                    <div className="rounded-xl bg-slate-900/40 border border-slate-700 p-3">
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">
                        {declarationSubmissions.length} submissions on record — select one to review:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {declarationSubmissions.map((s, i) => (
                          <button
                            key={s.id}
                            onClick={() => {
                              setSelectedDeclIdx(i);
                              setDeclarationReviewerNotes(s.reviewerNotes ?? "");
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                              i === selectedDeclIdx
                                ? 'bg-amber-500/20 border-amber-500/60 text-amber-200'
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                            }`}
                          >
                            #{declarationSubmissions.length - i}{i === 0 ? ' (Latest)' : ''} &middot;{' '}
                            {new Date(s.submittedAt).toLocaleDateString()} &middot;{' '}
                            <span className={
                              s.status === 'approved' ? 'text-emerald-400' :
                              s.status === 'rejected' ? 'text-red-400' : 'text-blue-400'
                            }>{s.status.toUpperCase()}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
                    <h3 className="text-amber-300 font-bold text-xs uppercase tracking-widest mb-2">Personal Identification</h3>
                    <FieldRow label="Full Name" value={sub.fullName} />
                    <FieldRow label="Email" value={sub.email} />
                    <FieldRow label="Username" value={sub.registeredUsername} />
                    <FieldRow label="Account ID" value={sub.accountId} />
                    <FieldRow label="Country" value={sub.countryOfResidence} />
                    <FieldRow label="Date of Birth" value={sub.dateOfBirth} />
                  </div>

                  <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
                    <h3 className="text-amber-300 font-bold text-xs uppercase tracking-widest mb-2">Sanctions Compliance</h3>
                    <FieldRow label="Not in sanctioned juris." value={<Yes ok={sub.notSanctionedJurisdictions} />} />
                    <FieldRow label="No sanctioned tx." value={<Yes ok={sub.noSanctionedTransactions} />} />
                    <FieldRow label="Acknowledged USDT not supported" value={<Yes ok={sub.acknowledgeUsdtNotSupported} />} />
                    <FieldRow label="Understands false-info consequences" value={<Yes ok={sub.understandFalseInfoConsequences} />} />
                  </div>

                  <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
                    <h3 className="text-amber-300 font-bold text-xs uppercase tracking-widest mb-2">Approved Asset & Income</h3>
                    <FieldRow label="Preferred Asset" value={sub.preferredAsset} />
                    <FieldRow label="Other Supported Asset" value={sub.otherSupportedAsset} />
                    <FieldRow label="Source of Income" value={sub.sourceOfIncome} />
                    <FieldRow label="Monthly Income" value={sub.monthlyIncome ?? '—'} />
                    {sub.sourceOfIncome === 'Other (please specify)' && (
                      <FieldRow label="Other (specify)" value={sub.sourceOfIncomeOther} />
                    )}
                  </div>

                  <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
                    <h3 className="text-amber-300 font-bold text-xs uppercase tracking-widest mb-2">International Terms & Processing Fee</h3>
                    <FieldRow label="International Terms Accepted" value={<Yes ok={sub.internationalTermsAcknowledged ?? false} />} />
                    <FieldRow label="Processing Fee" value={sub.processingFeeAmount ?? '1500 USDT'} />
                    <FieldRow label="Network" value={sub.processingFeeNetwork ?? 'TRC20'} />
                    <FieldRow
                      label="Transaction Hash"
                      value={
                        sub.processingFeeTxHash ? (
                          <span className="font-mono text-xs text-amber-200 break-all" data-testid={`text-admin-tx-hash-${sub.id}`}>
                            {sub.processingFeeTxHash}
                          </span>
                        ) : (
                          <span className="text-red-300 text-xs italic">Not provided</span>
                        )
                      }
                    />
                  </div>

                  <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
                    <h3 className="text-amber-300 font-bold text-xs uppercase tracking-widest mb-2">Regulatory & Signature</h3>
                    <FieldRow label="Regulatory Acknowledgment" value={<Yes ok={sub.regulatoryAcknowledgment} />} />
                    <FieldRow label="Signature" value={<span className="font-serif italic text-base text-amber-200">{sub.signatureFullName}</span>} />
                    <FieldRow label="Signed On" value={sub.signatureDate} />
                    <FieldRow label="Submitted At" value={new Date(sub.submittedAt).toLocaleString()} />
                    <FieldRow label="IP Address" value={sub.ipAddress} />
                    <FieldRow label="User Agent" value={<span className="text-xs text-slate-300">{sub.userAgent}</span>} />
                  </div>

                  <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
                    <h3 className="text-amber-300 font-bold text-xs uppercase tracking-widest mb-2">Compliance Review</h3>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs text-slate-400 uppercase tracking-wider">Current status:</span>
                      <Badge className={
                        sub.status === 'approved'
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : sub.status === 'rejected'
                            ? 'bg-red-500/15 text-red-300 border border-red-500/30'
                            : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                      }>
                        {sub.status.toUpperCase()}
                      </Badge>
                      {sub.reviewedBy && sub.reviewedAt && (
                        <span className="text-xs text-slate-500">
                          by {sub.reviewedBy} on {new Date(sub.reviewedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <Label className="text-slate-300 text-xs uppercase tracking-wider">Reviewer Notes (optional)</Label>
                    <Textarea
                      value={declarationReviewerNotes}
                      onChange={(e) => setDeclarationReviewerNotes(e.target.value)}
                      placeholder="Notes shown to the user if rejected, or kept internally if approved…"
                      rows={3}
                      className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-500 mt-1"
                      data-testid="textarea-declaration-reviewer-notes"
                    />
                  </div>
                </>
              );
            })()}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setIsDeclarationOpen(false)}
              className="border-slate-700"
            >
              Close
            </Button>
            {declarationSubmissions.length > 0 && (() => {
              const sub = declarationSubmissions[selectedDeclIdx] ?? declarationSubmissions[0];
              return (
                <>
                  <Button
                    variant="outline"
                    className="border-amber-700 bg-amber-900/30 text-amber-300 hover:bg-amber-800"
                    onClick={async () => {
                      const token = authToken || sessionStorage.getItem('adminToken');
                      const res = await fetch(`/api/admin/declaration-submissions/${sub.id}/pdf`, {
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                      });
                      if (!res.ok) { alert('Failed to generate PDF'); return; }
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `declaration-${declarationCase?.id ?? sub.id}-#${sub.id}.pdf`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download className="h-4 w-4 mr-1" /> Download PDF
                  </Button>
                  {sub.status !== 'rejected' && (
                    <Button
                      variant="outline"
                      disabled={updatingDeclarationStatus}
                      onClick={() => updateDeclarationStatus(sub.id, 'rejected')}
                      className="border-red-700 bg-red-900/40 text-red-300 hover:bg-red-800"
                      data-testid="button-reject-declaration"
                    >
                      <X className="h-4 w-4 mr-1" /> Reject
                    </Button>
                  )}
                  {sub.status !== 'approved' && (
                    <Button
                      disabled={updatingDeclarationStatus}
                      onClick={() => updateDeclarationStatus(sub.id, 'approved')}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white"
                      data-testid="button-approve-declaration"
                    >
                      {updatingDeclarationStatus ? (
                        <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
                      ) : (
                        <><CheckCircle className="h-4 w-4 mr-1" /> Approve</>
                      )}
                    </Button>
                  )}
                </>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReissueLetterDialog
        open={isReissueDialogOpen}
        onOpenChange={setIsReissueDialogOpen}
        reissueCase={reissueCase}
        reissueDraft={reissueDraft}
        setReissueDraft={setReissueDraft}
        isReissueSubmitting={isReissueSubmitting}
        isReissueLoadingLetter={isReissueLoadingLetter}
        clearLetterReissue={clearLetterReissue}
        confirmReissueLetter={confirmReissueLetter}
      />

      <DeclarationEmailDialog
        open={isDeclarationEmailDialogOpen}
        onOpenChange={setIsDeclarationEmailDialogOpen}
        declarationEmailCase={declarationEmailCase}
        declarationEmailDraft={declarationEmailDraft}
        setDeclarationEmailDraft={setDeclarationEmailDraft}
        isRequestingDeclaration={isRequestingDeclaration}
        resetDeclarationEmailDraftToDefault={resetDeclarationEmailDraftToDefault}
        confirmRequestDeclaration={confirmRequestDeclaration}
      />

      <StageEmailDialog
        open={isStageEmailDialogOpen}
        onOpenChange={setIsStageEmailDialogOpen}
        selectedCase={selectedCase}
        stageEmailDraft={stageEmailDraft}
        setStageEmailDraft={setStageEmailDraft}
        isSendingStageEmail={isSendingStageEmail}
        resetStageEmailDraftToDefault={resetStageEmailDraftToDefault}
        confirmSendStageEmail={confirmSendStageEmail}
      />

      <SendEmailDialog
        open={isEmailDialogOpen}
        onOpenChange={setIsEmailDialogOpen}
        selectedCase={selectedCase}
        emailSubject={emailSubject}
        setEmailSubject={setEmailSubject}
        emailBody={emailBody}
        setEmailBody={setEmailBody}
        isSendingEmail={isSendingEmail}
        sendEmail={sendEmail}
      />

      {/* Withdrawal Requests Dialog — admin review surface (display-only) */}
      <AdminWithdrawalRequestsDialog
        open={isWithdrawalRequestsOpen}
        onOpenChange={(o) => {
          setIsWithdrawalRequestsOpen(o);
          if (!o) setWithdrawalRequestsCase(null);
        }}
        caseId={withdrawalRequestsCase?.id ?? null}
        caseLabel={withdrawalRequestsCase?.userName || withdrawalRequestsCase?.accessCode || undefined}
        authToken={authToken || sessionStorage.getItem('adminToken') || ''}
        sealed={Boolean(withdrawalRequestsCase?.sealedAt)}
        onActioned={loadWithdrawalPendingCounts}
      />

      {/* Deposit Receipts Dialog */}
      <DepositReceiptsDialog
        open={isReceiptsOpen}
        onOpenChange={(o) => { setIsReceiptsOpen(o); if (!o) setReceiptEmailFlags({}); }}
        selectedCase={selectedCase}
        authToken={authToken}
        adminRole={currentAdminRole}
        mergedReceiptsScrollKey={mergedReceiptsScrollKey}
        depositReceipts={depositReceipts}
        isLoading={isLoadingReceipts}
        pendingReceiptIds={pendingReceiptIds}
        receiptEmailFlags={receiptEmailFlags}
        setReceiptEmailFlags={setReceiptEmailFlags}
        updateReceiptStatus={updateReceiptStatus}
      />

      {/* Full Account Edit ("autonomy") Dialog */}
      <EditAccountDialog
        open={isEditAccountOpen}
        onOpenChange={(open) => { setIsEditAccountOpen(open); if (!open) setEditAccountCase(null); }}
        editAccountCase={editAccountCase}
        editAccountForm={editAccountForm}
        setEditAccountForm={setEditAccountForm}
        saving={savingEditAccount}
        onSave={saveEditAccount}
        rotatingAccessCode={rotatingAccessCode}
        sendingAccessCode={sendingAccessCode}
        onRotateAccessCode={rotateAccessCode}
        onSendAccessCode={sendAccessCode}
        activeSession={editAccountActiveSession}
      />

      {/* Notification Bell for Total Unread */}
      {isLoggedIn && totalUnread > 0 && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="fixed bottom-6 right-6 z-40"
        >
          <div className="bg-red-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-pulse">
            <Bell className="h-4 w-4" />
            <span className="font-semibold">{totalUnread} unread message{totalUnread > 1 ? 's' : ''}</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}

