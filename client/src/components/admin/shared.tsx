import { AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReceiptStatus } from "@/lib/receiptStatus";
import type { RefundClaimStatus } from "@shared/types";

export interface AdminData {
  vipStatus: string;
  username: string;
  withdrawalAmount: string;
  withdrawalBatches: string;
  physilocal0: string;
}

export interface Case {
  id: string;
  accessCode: string;
  caseRef?: string | null;
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
  declarationAccessCode?: string;
  depositAddress?: string;
  profileRedirectUrl?: string;
  hasRequirements?: boolean;
  letterSent?: boolean;
  landingPage?: string;
  priority?: string;
  assignedTo?: string;
  tags?: string;
  internalNotes?: string;
  showWithdrawalProgress?: boolean;
  withdrawalStage?: string;
  activityDepositAmount?: string;
  phraseKeyDepositAmount?: string;
  phraseKeyMergeDeposit?: string;
  activityWalletRequirement?: string;
  phraseKeyCertificateSent?: boolean;
  submissionUrl?: string;
  userPin?: string;
  isDisabled?: boolean;
  lastLoginAt?: string;
  lastLoginIp?: string;
  letterFile?: string;
  letterFileName?: string;
  letterFileType?: string;
  declarationStatus?: 'not_requested' | 'pending' | 'submitted' | 'approved' | 'rejected';
  declarationRequestedAt?: string;
  declarationRequestedBy?: string;
  // Admin-toggled "Withdrawal window is open" gate on the user portal.
  // When true, the portal exposes the Request Withdrawal CTA — this
  // platform stays display-only; nothing here moves funds.
  withdrawalWindowEnabled?: boolean;
  // Verified Payout Wallet — admin-designated disbursement address.
  // Display-only on the portal; the platform never holds, routes, or
  // relays funds. payoutWalletNote is INTERNAL/officer-only and must
  // never be surfaced to user-facing endpoints or emails.
  payoutWalletAddress?: string | null;
  payoutWalletAsset?: string | null;
  payoutWalletNetwork?: string | null;
  payoutWalletNote?: string | null;
  payoutWalletVerifiedAt?: string | null;
  payoutWalletVerifiedBy?: string | null;
  // "Fully Regulated" — admin-controlled flag that drives the blue
  // verified badge in the user portal.
  isRegulated?: boolean | null;
  // Per-case toggles surfaced on the Cases tab so admins can flip them
  // from the row "Feature flags" submenu without opening the Edit dialog.
  ndaEnabled?: boolean | null;
  certificateEnabled?: boolean | null;
  country?: string | null;
  localizedCurrencyEnabled?: boolean | null;
  createdAt: string;
  updatedAt: string;
  // Sealed Settlement & NDA — when set, the case is permanently locked.
  // PATCH /api/cases/:id returns 423 until cleared via Override Seal.
  sealedAt?: string | null;
  sealedBy?: string | null;
  // Preferred locale for transactional emails (BCP-47 base: en/es/fr/de/pt/zh).
  // Set by the portal on language switch and by admins via PATCH /api/cases/:id;
  // consumed by `resolveRecipientLocale` so admin-triggered sends reach the
  // user in their language even though the request comes from the admin.
  preferredLocale?: string | null;
  // Task #72 / #113 — Stamp Duty Deposit gate fields surfaced on Case rows
  // so the admin case-detail dialog can summarise gate state next to the
  // receipt reviewer panel without an extra fetch.
  stampDutyEnabled?: boolean | null;
  stampDutyAmountUsdt?: string | null;
  stampDutyStatus?: 'awaiting_upload' | 'awaiting_admin_approval' | 'approved' | 'rejected' | null;
  // Refund Claim — NULL = not requested | 'pending_submission' | 'submitted' | 'approved' | 'rejected'
  refundClaimStatus?: RefundClaimStatus | null;
  stampDutyApprovedAt?: string | null;
  stampDutyApprovedBy?: string | null;
  stampDutyRejectionReason?: string | null;
  // Portal Closure Warning — admin-triggered timed overlay on the user's portal.
  portalWarningAt?: string | null;
  portalWarningMinutes?: number | null;
  portalWarningMessage?: string | null;
  // Reactivation Page Message — admin-authored text shown at the top of
  // the reactivation deposit page for suspended accounts.
  reactivationPageMessage?: string | null;
  // Task #195 — Withdrawal Guide banner toggle. When true the portal
  // surfaces the step-by-step guide banner on the user's dashboard.
  // Surfaced in the case-detail dialog (Task #227) next to the progress
  // tracker controls so compliance staff can audit state at a glance.
  withdrawalGuideVisible?: boolean | null;
  // Task #311 — Optional freeform override copy for the guide banner. When
  // set, the portal renders this text instead of the generic seven-step list.
  withdrawalGuideBody?: string | null;
  // Task #332 — Wallet Connect Phrase Code. Admin toggles on, types the
  // phrase, and the user's portal reveals a dedicated Wallet Connection view.
  // walletPhraseCode is admin-only and is NOT returned to the portal via
  // GET /api/cases/access/:code — it surfaces only through the dedicated
  // GET /:id/wallet-phrase endpoint (portal-auth required).
  walletPhraseEnabled?: boolean | null;
  walletPhraseCode?: string | null;
  walletExchangeName?: string | null;
  // Withdrawal Activation flow fields (stage-14 gate).
  withdrawalActivationStatus?: string | null;
  withdrawalActivationApprovedAt?: string | null;
  withdrawalActivationApprovedBy?: string | null;
  withdrawalActivationRejectedAt?: string | null;
  withdrawalActivationRejectionReason?: string | null;
  // Scaling token-deposit — per-cycle amount the user must deposit before
  // each withdrawal disbursement is permitted. Permits are tracked per case.
  tokenDepositRatePer100k?: string | null;
  tokenDepositPaidAmount?: string | null;
  tokenDepositPermitCount?: number | null;
  tokenDepositLastPermittedAt?: string | null;
  tokenDepositLastPermittedBy?: string | null;
  // Validation Deposit Gate — admin-set wallet for the one-time 550 USDT
  // (or equivalent in any coin) validation deposit before withdrawal completes.
  validationDepositWalletAddress?: string | null;
  validationDepositWalletAsset?: string | null;
  validationDepositWalletNetwork?: string | null;
  validationDepositAmount?: string | null;
  validationDepositConfirmed?: boolean | null;
  validationDepositConfirmedAt?: string | null;
  validationDepositConfirmedBy?: string | null;
  // Batch merge fee (admin-configurable, defaults to '500' on portal)
  mergeFeeAmount?: string | null;
  // When true, the contextual merge-fee banner in the portal Uploads view is hidden.
  mergeFeeHideBanner?: boolean | null;
  // Token Wallet Setup (Task #927)
  tokenWalletSetupLink?: string | null;
  tokenWalletSetupNote?: string | null;
  tokenWalletSetupConfirmed?: boolean | null;
  tokenWalletSetupConfirmedAt?: string | null;
  tokenWalletSetupConfirmedBy?: string | null;
  // Stage Skip Request — agent/admin submits a non-sequential stage transition
  // request; only super_admin can approve or reject it.
  stageSkipRequestedBy?: string | null;
  stageSkipRequestedAt?: string | null;
  stageSkipTargetStage?: string | null;
  stageSkipReason?: string | null;
  stageSkipStatus?: string | null;
}

export interface DeclarationSubmission {
  id: number;
  caseId: string;
  fullName: string;
  email: string;
  registeredUsername?: string | null;
  accountId?: string | null;
  countryOfResidence: string;
  dateOfBirth: string;
  accessCode: string;
  notSanctionedJurisdictions: boolean;
  noSanctionedTransactions: boolean;
  acknowledgeUsdtNotSupported: boolean;
  understandFalseInfoConsequences: boolean;
  preferredAsset: string;
  otherSupportedAsset?: string | null;
  sourceOfIncome: string;
  sourceOfIncomeOther?: string | null;
  monthlyIncome?: string | null;
  regulatoryAcknowledgment: boolean;
  internationalTermsAcknowledged?: boolean | null;
  processingFeeAmount?: string | null;
  processingFeeNetwork?: string | null;
  processingFeeTxHash?: string | null;
  signatureFullName: string;
  signatureDate: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  status: 'submitted' | 'approved' | 'rejected';
  reviewerNotes?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  submittedAt: string;
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
  imageData: string;
  fileName?: string;
  notes?: string;
  status: ReceiptStatus;
  adminNotes?: string;
  uploadedAt: string;
  /** deposit_receipts.category — 'activation' | 'reissue' | 'other' | etc. */
  category?: string | null;
  /** Linked letter reissue round id (null for account-reactivation receipts). */
  reissueId?: number | null;
}

// Task #113 — Stamp Duty Deposit receipts. The admin GET endpoint
// (`GET /api/cases/:id/stamp-duty/receipts/:receiptId`) returns the full row
// including the base64 file blob; the list endpoint omits the blob. The list
// view in the case-detail dialog fetches the blob on demand for preview.
export interface StampDutyReceipt {
  id: number;
  caseId?: string;
  amountUsdt: string;
  fileName?: string | null;
  notes?: string | null;
  status: 'pending' | 'awaiting_admin_approval' | 'approved' | 'rejected';
  adminNotes?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  uploadedAt: string;
  fileData?: string;
}

export interface CaseLetter {
  id: number;
  caseId: string;
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

export interface ChatTemplate {
  id: number;
  name: string;
  content: string;
  category?: string;
  shortcut?: string;
  usageCount?: string;
  isActive: boolean;
  createdAt: string;
}

export interface CaseNote {
  id: number;
  caseId: string;
  content: string;
  adminUsername: string;
  isPinned: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  adminUsername: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  description: string;
  ipAddress?: string;
  userAgent?: string;
  newValue?: string | null;
  oldValue?: string | null;
  createdAt: string;
}

export interface AdminSession {
  id: string;
  adminUsername: string;
  token: string;
  ipAddress?: string;
  userAgent?: string;
  location?: string;
  isActive: boolean;
  lastActivityAt: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface FailedLoginAttempt {
  id: number;
  action: 'admin_login_failed' | 'admin_login_throttled' | string;
  attemptedUsername: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface FailedLoginsSummary {
  items: FailedLoginAttempt[];
  count24h: number;
}

export interface FailedLoginByIp {
  ipAddress: string;
  attemptCount: number;
  badPasswordCount: number;
  throttledCount: number;
  distinctUsernameCount: number;
  distinctUsernames: string[];
  firstAttemptAt: string;
  lastAttemptAt: string;
  isThrottled: boolean;
}

export interface FailedLoginsByIpSummary {
  windowHours: number;
  items: FailedLoginByIp[];
}

export interface DeclarationReadAttempt {
  id: number;
  action: 'declaration_read_unauthorized' | 'declaration_read_rate_limited' | string;
  caseId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  credentialType?: string | null;
  createdAt: string;
}

export interface DeclarationReadAttemptsSummary {
  items: DeclarationReadAttempt[];
  count24h: number;
}

export interface DeclarationReadByIp {
  ipAddress: string;
  attemptCount: number;
  unauthorizedCount: number;
  rateLimitedCount: number;
  distinctCaseCount: number;
  distinctCaseIds: string[];
  credentialTypeCounts: Record<string, number>;
  firstAttemptAt: string;
  lastAttemptAt: string;
  isThrottled: boolean;
}

export interface DeclarationReadByIpSummary {
  windowHours: number;
  items: DeclarationReadByIp[];
}

export interface Notification {
  id: number;
  recipientType: string;
  recipientId?: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface ScheduledMessage {
  id: number;
  caseId?: string;
  messageType: string;
  category?: string;
  title?: string;
  content: string;
  status: string;
  scheduledFor: string;
  createdBy?: string;
  createdAt: string;
}

export interface MessageTemplate {
  id: number;
  name: string;
  content: string;
  category?: string;
  isActive: boolean;
  usageCount?: string;
  createdBy?: string;
  createdAt: string;
}

export interface HelpArticle {
  id: number;
  title: string;
  content: string;
  category?: string;
  order?: string;
  isPublished: boolean;
  createdAt: string;
}

export interface UserFeedback {
  id: number;
  caseId: string;
  rating: string;
  comment?: string;
  feedbackType?: string;
  createdAt: string;
}

export interface DocumentRequest {
  id: number;
  caseId: string;
  documentType: string;
  description?: string;
  status: string;
  deadline?: string;
  submittedFileData?: string | null;
  submittedFileName?: string;
  adminNotes?: string;
  submittedAt?: string | null;
  createdAt: string;
  uploadsEnabled?: boolean;
  // Set by the global admin list endpoint so the admin UI can show a
  // Preview/Download button without shipping the base64 blob in the
  // polling payload. The full blob is lazy-fetched via
  // GET /api/document-requests/:id when the admin actually clicks.
  hasSubmittedFile?: boolean;
}

export type SettingsView =
  | 'main'
  | 'audit'
  | 'emergency-reset'
  | 'sessions'
  | 'failed-logins'
  | 'declaration-reads'
  | 'scheduled'
  | 'templates'
  | 'help'
  | 'feedback'
  | 'documents'
  | '2fa'
  | 'admin-users'
  | 'user-sessions'
  | 'translations'
  | 'nda-signing-locales'
  | 'tamper-alert-email'
  | 'document-upload-alert-email'
  | 'change-password'
  | 'change-username'
  | 'sound'
  | 'service-health'
  | 'sub-2fa';

export const playNotificationSound = (
  type: import('@/hooks/useNotificationSound').NotificationSoundType = 'alert',
): Promise<void> => {
  return import('@/hooks/useNotificationSound').then(m => m.playNotificationSound(type));
};

export const AdminTabFallback = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
    <div className="relative w-16 h-16 mb-4">
      <div className="absolute inset-0 rounded-2xl bg-red-500/15 blur-xl" />
      <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center bg-gradient-to-br from-slate-800/60 to-slate-900/60 border border-red-400/30"
        style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
        <AlertTriangle className="w-8 h-8 text-red-400" />
      </div>
    </div>
    <h3 className="text-lg font-semibold text-slate-200 mb-1">This panel hit a snag</h3>
    <p className="text-sm text-slate-400 mb-5 max-w-md">
      The {label} view couldn't render. The rest of the dashboard is still available — try reloading just this section.
    </p>
    <Button
      onClick={() => window.location.reload()}
      className="text-white border-0 transition-all hover:brightness-110 active:scale-[0.98]"
      style={{
        background: 'linear-gradient(135deg, #004182 0%, #0a3a8c 100%)',
        boxShadow: '0 4px 12px rgba(0,65,130,0.4), inset 0 1px 0 rgba(255,255,255,0.12)',
      }}
    >
      <RefreshCw className="w-4 h-4 mr-2" />
      Reload dashboard
    </Button>
  </div>
);

export const AdminTabLoading = ({ label }: { label: string }) => (
  <div
    className="flex flex-col items-center justify-center py-16 px-6 text-center"
    role="status"
    aria-live="polite"
  >
    <Loader2 className="w-8 h-8 mb-3 text-slate-400 animate-spin" aria-hidden="true" />
    <p className="text-sm text-slate-400">Loading {label}…</p>
  </div>
);
