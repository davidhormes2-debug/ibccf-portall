import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, serial, boolean, integer, index, check, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export type RefundClaimStatus = 'pending_submission' | 'submitted' | 'approved' | 'rejected';
export type RefundClaimStatusFilter = 'all' | RefundClaimStatus;

export const cases = pgTable("cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accessCode: text("access_code").notNull().unique(),
  status: text("status").notNull().default('created'),
  
  // User registration data
  userName: text("user_name"),
  userEmail: text("user_email"),
  userMobile: text("user_mobile"),
  
  // Admin finalization data
  vipStatus: text("vip_status"),
  username: text("username"),
  withdrawalAmount: text("withdrawal_amount"),
  withdrawalBatches: text("withdrawal_batches"),
  physilocal0: text("physilocal0"),
  
  // Per-user deposit and profile settings.
  // depositAsset / depositNetwork are free-text on purpose so admins can set
  // anything (USDT, USDC, BTC, ETH, or some custom token), and the portal
  // renders whatever is here. The admin UI offers a curated dropdown plus a
  // "Custom" escape hatch — those are *suggestions*, not a constraint.
  depositAddress: text("deposit_address"),
  depositAsset: text("deposit_asset"),     // e.g. "USDT", "USDC", "BTC", "ETH"
  depositNetwork: text("deposit_network"), // e.g. "TRC20", "ERC20", "BEP20", "Bitcoin"

  // User-declared preferred settlement asset + network (Task #938). The
  // portal coin/network selector writes these; the deposit upload category
  // dropdown and the withdrawal request form pre-fill from them. Admins can
  // also view and override from the case edit dialog. Free-text so any asset
  // (USDT, USDC, BTC, ETH, BNB …) and any network (TRC20, ERC20, BEP20,
  // Bitcoin …) can be stored. Default 'USDT' / 'TRC20' preserves legacy
  // behaviour for rows written before this column existed.
  preferredDepositAsset: text("preferred_deposit_asset").default('USDT'),
  preferredDepositNetwork: text("preferred_deposit_network").default('TRC20'),
  // Admin-configurable batch merge processing fee amount. Portal shows this
  // figure in the merge-withdrawal confirmation card. Defaults to '500' when
  // not set so existing behaviour is preserved for legacy cases.
  mergeFeeAmount: text("merge_fee_amount"),
  // When true, the contextual merge-fee banner in DepositView is suppressed
  // for this case even when the user arrives via the merge flow. Default false
  // (banner shows normally).
  mergeFeeHideBanner: boolean("merge_fee_hide_banner").default(false),

  profileRedirectUrl: text("profile_redirect_url"),
  hasRequirements: boolean("has_requirements").default(false),
  
  // Letter control - admin manually sends letters
  letterSent: boolean("letter_sent").default(false),
  
  // Landing page preference after finalization
  landingPage: text("landing_page").default('dashboard'), // 'dashboard', 'letter', 'deposit', 'messages'
  
  // Priority level for case management
  priority: text("priority").default('medium'), // 'high', 'medium', 'low'
  
  // Case assignment and tags
  assignedTo: text("assigned_to"),
  tags: text("tags"), // JSON array of tags
  
  // Internal admin notes (not visible to user)
  internalNotes: text("internal_notes"),

  // Admin-assigned friendly reference label (e.g. "IBF-2025-0042").
  // Auto-generated on case creation in the format IBF-YYYY-NNNN.
  // Admin can edit it freely to any unique label at any time.
  caseRef: text("case_ref"),
  
  // IP/Location tracking
  lastLoginIp: text("last_login_ip"),
  lastLoginLocation: text("last_login_location"),
  lastLoginAt: timestamp("last_login_at"),
  
  // Progress tracking
  completionPercentage: text("completion_percentage").default('0'),
  
  // Withdrawal progress tracking (admin-controlled visibility)
  showWithdrawalProgress: boolean("show_withdrawal_progress").default(false),
  // Withdrawal Guide banner (admin-controlled). When true the portal renders
  // the contextual withdrawal-guide banner on the dashboard.
  withdrawalGuideVisible: boolean("withdrawal_guide_visible").default(false),
  // Optional freeform override copy for the Withdrawal Guide banner. When
  // set, the portal renders this text instead of the generic seven-step list.
  // Null / empty string falls back to the default step layout.
  withdrawalGuideBody: text("withdrawal_guide_body"),
  withdrawalStage: text("withdrawal_stage").default('1'), // 1-14 stages
  // Highest withdrawal stage this case has ever reached. Set automatically
  // by CaseService.updateCase when withdrawalStage advances forward.
  // Never decremented — used by the portal to preserve access to nav items
  // and content that were unlocked at a higher stage even after an admin
  // rolls the live stage back. Nullable; NULL is treated as withdrawalStage
  // (i.e. no override in effect).
  maxStageReached: integer("max_stage_reached"),
  activityDepositAmount: text("activity_deposit_amount"), // Amount user needs to keep in wallet
  
  // Phrase Key tracking
  phraseKeyDepositAmount: text("phrase_key_deposit_amount"), // Admin-set deposit amount for phrase key
  phraseKeyMergeDeposit: text("phrase_key_merge_deposit"), // Calculated 30% of phraseKeyDepositAmount
  activityWalletRequirement: text("activity_wallet_requirement"), // USDT amount for activity verification
  phraseKeyCertificateSent: boolean("phrase_key_certificate_sent").default(false), // Flag for auto-message
  
  // Simplified submission URL approach
  submissionUrl: text("submission_url"), // External URL where user submits their request
  
  // User's personal 6-digit PIN (set by user after verifying admin-provided access code)
  userPin: text("user_pin"), // 6-digit PIN for future logins
  
  // Account status
  isDisabled: boolean("is_disabled").default(false), // Admin can disable user access
  
  // Department assignment
  departmentId: integer("department_id"), // References department for case categorization
  currentStageId: integer("current_stage_id"), // Current workflow stage
  
  // Declaration of Compliance (admin-triggered legal/regulatory form)
  // 'not_requested' | 'pending' (admin asked, user has not submitted) |
  // 'submitted' (user submitted, awaiting review) | 'approved' | 'rejected'
  declarationStatus: text("declaration_status").default('not_requested'),
  declarationRequestedAt: timestamp("declaration_requested_at"),
  declarationRequestedBy: text("declaration_requested_by"), // admin username
  // Per-case access code an admin issues to the user out-of-band (after
  // verifying the 1500 USDT deposit). The user must enter this exact code on
  // the declaration form to be allowed to submit. Auto-generated when the
  // admin clicks "Request Declaration"; admin-visible only.
  declarationAccessCode: text("declaration_access_code"),
  // The declaration access code is valid for a fixed window (24h by default)
  // from the moment the admin opens the portal for declaration. After this
  // timestamp passes the user can no longer submit using the issued code and
  // must request a fresh one.
  declarationAccessExpiresAt: timestamp("declaration_access_expires_at"),

  // Refund Claim — admin-triggered flow to document & approve the
  // 1,000 USDT refundable activation balance.
  // NULL = not requested | 'pending_submission' | 'submitted' |
  // 'approved' | 'rejected'
  refundClaimStatus: text("refund_claim_status").$type<RefundClaimStatus>(),

  // Admin-triggered force logout. When an admin clicks "Log Out User",
  // this is set to the current time. The portal stores its login time
  // locally; on every data refresh it compares the two and, if this
  // value is newer, signs the user out and returns them to the gateway.
  forceLogoutAt: timestamp("force_logout_at"),

  // Portal Closure Warning — admin-triggered timed warning overlay.
  // When set, the portal shows a fullscreen countdown over the dashboard.
  // At zero the user is automatically logged out. Admin can cancel before
  // expiry by clearing all three columns (DELETE /:id/portal-warning).
  portalWarningAt: timestamp("portal_warning_at"),
  portalWarningMinutes: integer("portal_warning_minutes"),
  portalWarningMessage: text("portal_warning_message"),

  // Reactivation Page Message — admin-authored freeform text displayed at
  // the top of the reactivation deposit page for suspended accounts.
  // Persists independently of the portal closure warning so it survives
  // session changes and remains visible until explicitly cleared.
  reactivationPageMessage: text("reactivation_page_message"),

  // Stamped each time an admin re-enables a previously disabled account.
  // The portal uses this to show a one-time celebratory "welcome back /
  // account 100% restored" banner on the dashboard, dismissible per
  // reactivation event (the timestamp itself is part of the dismiss key).
  reactivatedAt: timestamp("reactivated_at"),

  // Admin-controlled account balance shown to the user on their dashboard.
  // Free-form text so the admin can include currency/units (e.g. "12,450.00 USDT").
  userBalance: text("user_balance"),

  // Last `userBalance` value that was synchronised with the computed
  // ledger total (Task #55). When a ledger entry is created/edited/
  // deleted, the auto-adjust path updates BOTH `userBalance` and this
  // column atomically. When an admin manually edits `userBalance`
  // through the case editor, `userBalance` diverges from this column —
  // that's the signal that the admin has taken manual control. The
  // ledger panel surfaces a "Manual override active" pill and stops
  // auto-syncing until the admin clicks "Sync balance to ledger total".
  // Free-form text so it matches the formatting of `userBalance`.
  userBalanceLastSyncedTotal: text("user_balance_last_synced_total"),

  // Verified Payout Wallet — the disbursement address admins designate as
  // the destination for the user's funds. Display-only on the portal side;
  // this app does NOT route, hold, or relay funds.
  payoutWalletAddress: text("payout_wallet_address"),
  payoutWalletAsset: text("payout_wallet_asset"),
  payoutWalletNetwork: text("payout_wallet_network"),
  payoutWalletNote: text("payout_wallet_note"),
  payoutWalletVerifiedAt: timestamp("payout_wallet_verified_at"),
  payoutWalletVerifiedBy: text("payout_wallet_verified_by"),

  // Validation Deposit Gate — during the withdrawal validation phase, the
  // admin designates a wallet for a one-time 550 USDT (or equivalent in any
  // coin) deposit before the withdrawal completes. The portal shows a deposit
  // instruction card; the admin confirms receipt to unblock the final stage.
  // `validationDepositAmount` defaults to '550' and is overridable per-case.
  // `validationDepositConfirmedAt/By` are server-stamped when the admin
  // flips `validationDepositConfirmed` to true; never accepted from clients.
  validationDepositWalletAddress: text("validation_deposit_wallet_address"),
  validationDepositWalletAsset: text("validation_deposit_wallet_asset"),
  validationDepositWalletNetwork: text("validation_deposit_wallet_network"),
  validationDepositAmount: text("validation_deposit_amount"),
  validationDepositConfirmed: boolean("validation_deposit_confirmed").default(false),
  validationDepositConfirmedAt: timestamp("validation_deposit_confirmed_at"),
  validationDepositConfirmedBy: text("validation_deposit_confirmed_by"),

  // Token Wallet Setup (Task #927) — admin inserts a setup guide URL and
  // optional instruction note after the validation deposit is confirmed.
  // The portal surfaces an action card when the link is set; flips to an
  // emerald "Verified" banner once `tokenWalletSetupConfirmed` is true.
  // `tokenWalletSetupConfirmedAt/By` are server-stamped; never accepted
  // from clients.
  tokenWalletSetupLink: text("token_wallet_setup_link"),
  tokenWalletSetupNote: text("token_wallet_setup_note"),
  tokenWalletSetupConfirmed: boolean("token_wallet_setup_confirmed").default(false),
  tokenWalletSetupConfirmedAt: timestamp("token_wallet_setup_confirmed_at"),
  tokenWalletSetupConfirmedBy: text("token_wallet_setup_confirmed_by"),

  // "Fully Regulated" badge — admin toggles this on the EditAccount dialog
  // when the user has cleared every regulatory checkpoint. The portal
  // renders a blue verified checkmark next to the user's name when true.
  // Display-only flag; does NOT alter case workflow or unlock any stage.
  isRegulated: boolean("is_regulated").default(false),

  // Country mode: when admin sets a country and toggles localizedCurrencyEnabled,
  // every USDT figure shown in the user portal is rendered with a parenthetical
  // local-currency estimate (e.g. "1,500 USDT (~2,040 CAD)"). The conversion is
  // display-only — invoices and on-chain deposits remain denominated in USDT.
  // `country` is a free-form ISO-3166 alpha-2 code (e.g. "CA", "DE", "GB"). The
  // country→currency mapping lives in shared/currencies.ts.
  country: text("country"),
  localizedCurrencyEnabled: boolean("localized_currency_enabled").default(false),

  // Recipient's preferred UI locale (BCP-47 base code: en/es/fr/de/pt/zh).
  // Written by the portal on sign-in and on every locale switch (see
  // `client/src/i18n/useLocale.ts` + `GET /api/cases/access/:code`). Read
  // by every `sendLocalizedCaseEmail` callsite so admin-triggered emails
  // (declaration assigned/approved/rejected, document requested/reviewed,
  // payout-wallet set, letter reissued, etc.) render in the recipient's
  // language even though the request is made by the admin. Nullable —
  // legacy rows fall back to the admin's `req.userLocale`, then English.
  preferredLocale: text("preferred_locale"),

  // Withdrawal Window — admin-controlled toggle. When true, the portal
  // surfaces a "Request Withdrawal" CTA on the dashboard that opens the
  // four-section WithdrawalRequestDialog. When false (default) the CTA is
  // hidden and any POST /api/cases/:id/withdrawal-requests is rejected.
  // The platform is display-only; this flag does NOT route or relay funds.
  withdrawalWindowEnabled: boolean("withdrawal_window_enabled").default(false),

  // NDA toggle — admin-controlled flag that decides whether this case
  // requires the Sealed Settlement & NDA signing step at all. Defaults
  // to `true` so every existing case keeps its current behaviour.
  // When toggled OFF:
  //   • the portal Sealed view hides the typed-signature flow and
  //     surfaces a clear "NDA not required" notice instead,
  //   • POST /api/cases/:id/nda/sign is rejected server-side so the
  //     user cannot create a snapshot the workflow doesn't need,
  //   • the case can advance / be sealed administratively without a
  //     signed NDA on file.
  // Admins re-enable it at any time; previously signed snapshots
  // (case_ndas rows) are retained for audit durability regardless.
  ndaEnabled: boolean("nda_enabled").default(true),

  // Sealed Settlement & NDA — once the user types-and-signs the NDA at the
  // end of the workflow, the case is permanently locked. `sealedAt` is the
  // server-stamped moment of sealing; `sealedBy` records who triggered the
  // seal (usually the user's own action, but admin overrides also stamp
  // here). Both NULL while the case is still mutable. The only supported
  // way to clear them is the admin "Override Seal" endpoint, which writes
  // an audit row. See `case_ndas` for the signed document + integrity hash.
  sealedAt: timestamp("sealed_at"),
  sealedBy: text("sealed_by"),

  // Withdrawal Activation (final-stage flow, Task #66) — admin-gated
  // disbursement gate that runs AFTER the user reaches stage 14. The user
  // binds a withdrawal wallet on the third-party platform, optionally
  // satisfies a one-time email security code, then funds a "token wallet"
  // with a per-case minimum USDT activation deposit reusing the existing
  // deposit-receipt flow. Until the admin approves the activation receipt,
  // the portal blocks any disbursement with the exact message:
  //   "You need to deposit the minimum amount into your token wallet
  //    before withdrawal processing can run."
  // The platform is display-only — none of these fields route or hold funds.
  withdrawalActivationMinUsdt: text("withdrawal_activation_min_usdt"),
  withdrawalSecurityTokenRequired: boolean("withdrawal_security_token_required").default(true),
  withdrawalAddressSubmitted: text("withdrawal_address_submitted"),
  withdrawalDetailsAsset: text("withdrawal_details_asset"),
  withdrawalDetailsNetwork: text("withdrawal_details_network"),
  withdrawalDetailsAmount: text("withdrawal_details_amount"),
  withdrawalDetailsMemo: text("withdrawal_details_memo"),
  // Lifecycle: 'pending_address' (waiting for user to submit address+details)
  // → 'awaiting_token' (security code emailed, awaiting verification — only
  // if withdrawalSecurityTokenRequired) → 'awaiting_deposit' (user must
  // upload activation receipt) → 'awaiting_admin_approval' (receipt
  // uploaded, admin must approve) → 'approved' | 'rejected'.
  withdrawalActivationStatus: text("withdrawal_activation_status").default('pending_address'),
  withdrawalActivationReceiptId: integer("withdrawal_activation_receipt_id"),
  withdrawalActivationApprovedAt: timestamp("withdrawal_activation_approved_at"),
  withdrawalActivationApprovedBy: text("withdrawal_activation_approved_by"),
  withdrawalActivationRejectedAt: timestamp("withdrawal_activation_rejected_at"),
  withdrawalActivationRejectionReason: text("withdrawal_activation_rejection_reason"),
  withdrawalAddressSubmittedAt: timestamp("withdrawal_address_submitted_at"),
  withdrawalTokenVerifiedAt: timestamp("withdrawal_token_verified_at"),

  // Scaling token-deposit permit. The withdrawal token deposit is NOT a
  // fixed amount — it scales with the case's withdrawal balance at a per-case
  // rate (default 600 USDT per 100,000 USDT of withdrawalAmount). Required
  // deposit = (numeric withdrawalAmount / 100_000) * tokenDepositRatePer100k.
  // The admin "Paid" tab (visible at stage 14) lets staff enter the amount
  // actually deposited (`tokenDepositPaidAmount`) and click "Permit Withdrawal",
  // which sets `withdrawalActivationStatus='approved'`, emails the user an
  // invoice (PDF + body), and increments `tokenDepositPermitCount`. Each
  // withdrawal cycle needs a fresh permit — "Mark Done" relocks the gate by
  // resetting the status so the next disbursement requires Paid → Permit again.
  // The platform is display-only; none of these fields route or hold funds.
  tokenDepositRatePer100k: text("token_deposit_rate_per_100k").default('600'),
  tokenDepositPaidAmount: text("token_deposit_paid_amount"),
  tokenDepositPermitCount: integer("token_deposit_permit_count").default(0),
  tokenDepositLastPermittedAt: timestamp("token_deposit_last_permitted_at"),
  tokenDepositLastPermittedBy: text("token_deposit_last_permitted_by"),

  // Task #70 — NDA-triggered auto-finalization. When the user signs the
  // NDA, the case is flipped to stage 14, status='completed' and these
  // two columns are server-stamped. They're set ONCE (idempotent) so a
  // re-sign (after admin override) does not re-fire side effects.
  autoFinalizedAt: timestamp("auto_finalized_at"),
  autoFinalizedBy: text("auto_finalized_by"),

  // Task #70 — Merge Phrase Certificate. Admin-toggled premium artefact
  // delivered as a watermarked preview until the user pays the
  // certification fee (% of withdrawalAmount). Fee is server-computed;
  // client never supplies the amount. Status values:
  //   'not_required'            — default
  //   'awaiting_admin_approval' — fee receipt uploaded, awaiting admin review
  //   'approved'                — admin approved, clean PDF unlocked
  //   'rejected'                — admin rejected; user can re-upload
  certificateEnabled: boolean("certificate_enabled").default(false),
  certificateFeePercent: text("certificate_fee_percent"), // null = use global default
  certificateFeeStatus: text("certificate_fee_status").default('not_required'),
  certificateFeeApprovedAt: timestamp("certificate_fee_approved_at"),
  certificateFeeApprovedBy: text("certificate_fee_approved_by"),

  // Task #72 — Stamp Duty Deposit gate (sealed-settlement prerequisite).
  // When `stampDutyEnabled` is true and `stampDutyStatus !== 'approved'`,
  // POST /:id/nda/sign is refused server-side with code `stamp_duty_required`.
  // The portal SealedView intercepts to a stamp-duty upload sub-view. The
  // resolved amount is per-case override (`stampDutyAmountUsdt`) or the
  // global default (`app_settings.stamp_duty_default_usdt`, fallback 250).
  // Status values:
  //   'awaiting_upload'         — default; user has not uploaded a receipt
  //   'awaiting_admin_approval' — receipt uploaded, awaiting admin review
  //   'approved'                — admin approved; NDA sealing unlocked
  //   'rejected'                — admin rejected; user can re-upload
  stampDutyEnabled: boolean("stamp_duty_enabled").default(true),
  stampDutyAmountUsdt: text("stamp_duty_amount_usdt"), // null = use global default
  stampDutyStatus: text("stamp_duty_status").default('awaiting_upload'),
  stampDutyApprovedAt: timestamp("stamp_duty_approved_at"),
  stampDutyApprovedBy: text("stamp_duty_approved_by"),
  stampDutyRejectionReason: text("stamp_duty_rejection_reason"),

  // Session Refresh Deposit gate — admin-controlled checkpoint that
  // blocks portal access until the user deposits the specified amount
  // and the admin approves the submitted receipt. When
  // `sessionRefreshRequired` is true and `sessionRefreshStatus` is not
  // 'approved', the portal redirects to a dedicated blocking gate page
  // immediately after login, bypassing all other routing.
  //
  // Status lifecycle:
  //   null / undefined — gate is configured but user hasn't been sent
  //   'pending'        — gate is active, waiting for user to submit
  //   'submitted'      — user submitted receipt, awaiting admin review
  //   'approved'       — admin approved; portal access restored
  //   'rejected'       — admin rejected; user must re-submit
  sessionRefreshRequired: boolean("session_refresh_required").default(false),
  sessionRefreshAddress: text("session_refresh_address"),
  sessionRefreshAmount: text("session_refresh_amount"),
  sessionRefreshAsset: text("session_refresh_asset"),
  sessionRefreshNetwork: text("session_refresh_network"),
  sessionRefreshNote: text("session_refresh_note"),
  sessionRefreshStatus: text("session_refresh_status"),

  // Wallet Connect Phrase Code (Task #332) — admin-controlled feature that
  // surfaces a "Wallet Connection" step in the portal. The admin toggles the
  // feature on per-case, types the phrase code, and the portal displays it in
  // a visually "generated" monospace word-grid layout. `walletPhraseCode` is
  // NEVER exposed through the portal-facing GET /api/cases/access/:code —
  // only the dedicated GET /:id/wallet-phrase endpoint (portal-auth required)
  // returns it, and only when the feature is enabled and a phrase is set.
  // `walletExchangeName` persists which wallet the user selected (crypto.com,
  // Trust Wallet, SafePal, or a custom name).
  walletPhraseEnabled: boolean("wallet_phrase_enabled").default(false),
  walletPhraseCode: text("wallet_phrase_code"),
  walletExchangeName: text("wallet_exchange_name"),

  // Stage Skip Request — an agent or admin can flag a case for a
  // non-sequential stage transition that only a super_admin may approve.
  // The request captures who asked, when, which target stage, and why.
  // `stageSkipStatus` lifecycle:
  //   NULL               — no active request
  //   'pending'          — waiting for super_admin review
  //   'approved'         — super_admin approved and applied the transition
  //   'rejected'         — super_admin declined; requestor can re-submit
  // These fields are NEVER writable through the generic PATCH /:id endpoint;
  // they are managed exclusively by the dedicated stage-skip-request routes.
  stageSkipRequestedBy: text("stage_skip_requested_by"),
  stageSkipRequestedAt: timestamp("stage_skip_requested_at"),
  stageSkipTargetStage: text("stage_skip_target_stage"),
  stageSkipReason: text("stage_skip_reason"),
  stageSkipStatus: text("stage_skip_status"),

  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (t) => ({
  // Two integrity guards added at the database level so the rules survive
  // even if a code path forgets to enforce them:
  //
  // 1. `withdrawalStage` is text but conceptually 1..14. Reject anything
  //    that isn't a clean integer in that range. NULL stays allowed because
  //    legacy rows may not have a stage assigned yet.
  // 2. `declarationAccessCode` is generated per-case and shown to one user
  //    only — collisions would let one user submit another user's
  //    declaration. The unique index ignores NULLs so cases that haven't
  //    been issued a code don't conflict with each other.
  withdrawalStageRange: check(
    "cases_withdrawal_stage_range",
    sql`${t.withdrawalStage} IS NULL OR (${t.withdrawalStage} ~ '^[0-9]+$' AND ${t.withdrawalStage}::int BETWEEN 1 AND 14)`,
  ),
  declarationAccessCodeUnique: uniqueIndex(
    "cases_declaration_access_code_unique_idx",
  ).on(t.declarationAccessCode),
  caseRefUnique: uniqueIndex(
    "cases_case_ref_unique_idx",
  ).on(t.caseRef),
}));

export const insertCaseSchema = createInsertSchema(cases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  refundClaimStatus: z.enum(['pending_submission', 'submitted', 'approved', 'rejected']).nullable().optional(),
});

export const updateCaseSchema = insertCaseSchema
  .partial()
  .omit({
    // userPin is the user's private credential — it must only be changed
    // through the dedicated user PIN flow, never through a generic admin edit.
    userPin: true,
    // Stage-skip request fields are managed exclusively by the dedicated
    // stage-skip-request endpoints and must not be settable via generic PATCH.
    stageSkipRequestedBy: true,
    stageSkipRequestedAt: true,
    stageSkipTargetStage: true,
    stageSkipReason: true,
    stageSkipStatus: true,
  })
  .extend({
    refundClaimStatus: z.enum(['pending_submission', 'submitted', 'approved', 'rejected']).nullable().optional(),
  });

export type InsertCase = z.infer<typeof insertCaseSchema>;
export type UpdateCase = z.infer<typeof updateCaseSchema>;
// Explicit intersection so that TypeScript can see all columns regardless of
// type-inference depth limits that drizzle $inferSelect can hit on very large
// tables. The stage-skip fields are listed here because they were added when
// the cases table already had many columns.
export type Case = typeof cases.$inferSelect & {
  stageSkipRequestedBy: string | null;
  stageSkipRequestedAt: Date | null;
  stageSkipTargetStage: string | null;
  stageSkipReason: string | null;
  stageSkipStatus: string | null;
};

// Custom letter content per case
export const caseLetters = pgTable("case_letters", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  
  // Simple file upload - stores base64 data of uploaded PDF/image
  letterFile: text("letter_file"), // Base64 encoded file data
  letterFileName: text("letter_file_name"), // Original filename
  letterFileType: text("letter_file_type"), // MIME type (image/png, application/pdf, etc.)
  
  // Letter sections that admin can customize (legacy - kept for backwards compatibility)
  headline: text("headline").default("Withdrawal Protocol Selection"),
  introduction: text("introduction"),
  bodyContent: text("body_content"),
  footerNote: text("footer_note"),
  
  // Compliance reference text
  complianceReference: text("compliance_reference"),
  
  // Option A customization (matching screenshot exactly)
  optionATitle: text("option_a_title").default("Accelerated Release"),
  optionADescription: text("option_a_description"),
  optionAAmount: text("option_a_amount"),
  optionAFrequency: text("option_a_frequency"), // e.g., "every 12 hours"
  optionABatches: text("option_a_batches"), // e.g., "10 Transfers"
  optionAKeyCost: text("option_a_key_cost"), // e.g., "260.996 USDT"
  optionATotalRequirement: text("option_a_total_requirement"), // e.g., "2,609.96 USDT"
  optionATotalAmount: text("option_a_total_amount"),
  optionAFilelocoId: text("option_a_fileloco_id"),
  
  // Option B customization
  optionBTitle: text("option_b_title").default("Standard Release"),
  optionBDescription: text("option_b_description"),
  optionBAmount: text("option_b_amount"),
  optionBFrequency: text("option_b_frequency"), // e.g., "every 12 hours"
  optionBBatches: text("option_b_batches"), // e.g., "20 Transfers"
  optionBKeyCost: text("option_b_key_cost"), // e.g., "521.993 USDT"
  optionBTotalRequirement: text("option_b_total_requirement"), // e.g., "5,219.92 USDT"
  optionBTotalAmount: text("option_b_total_amount"),
  optionBFilelocoId: text("option_b_fileloco_id"),
  
  // Phrase Key Requirements section (JSON array of bullet points)
  phraseKeyRequirements: text("phrase_key_requirements"),
  
  // Compliance Notice warning text
  complianceNotice: text("compliance_notice"),
  
  // Scheduling - for scheduled letter delivery
  scheduledFor: timestamp("scheduled_for"),
  sentAt: timestamp("sent_at"),
  
  // Deadline/expiration for action
  expiresAt: timestamp("expires_at"),

  // Reissue versioning — every reissue increments this. Round details live in
  // the letterReissues history table; the active round (if any) is the most
  // recent row for this case whose status is not 'paid' or 'cancelled'.
  letterVersion: integer("letter_version").notNull().default(1),

  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// One row per reissue round. Preserves history, supports multiple reissues,
// and ties the fee to a real deposit receipt rather than a checkbox.
export const letterReissues = pgTable("letter_reissues", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  version: integer("version").notNull(), // The letterVersion AFTER this round (i.e. v2 means second issuance)
  reissueFee: text("reissue_fee").notNull(), // e.g. "150 USDT"
  reason: text("reason"),
  status: text("status").notNull().default('awaiting_deposit'),
  // 'awaiting_deposit' — admin issued, user has not uploaded a receipt yet
  // 'awaiting_review' — user uploaded a receipt, admin has not yet approved
  // 'paid' — admin approved the receipt; user may now resubmit
  // 'cancelled' — admin cleared the round (history row preserved)
  receiptId: integer("receipt_id"), // FK to depositReceipts when user uploads (no notNull / no FK constraint to keep the cycle simple)
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  paidAt: timestamp("paid_at"),
  cancelledAt: timestamp("cancelled_at"),
});

export const insertLetterReissueSchema = createInsertSchema(letterReissues).omit({
  id: true,
  createdAt: true,
});
export type InsertLetterReissue = z.infer<typeof insertLetterReissueSchema>;
export type LetterReissue = typeof letterReissues.$inferSelect;

export const insertCaseLetterSchema = createInsertSchema(caseLetters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateCaseLetterSchema = insertCaseLetterSchema.partial();

export type InsertCaseLetter = z.infer<typeof insertCaseLetterSchema>;
export type UpdateCaseLetter = z.infer<typeof updateCaseLetterSchema>;
export type CaseLetter = typeof caseLetters.$inferSelect;

// Submission history
export const caseSubmissions = pgTable("case_submissions", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  
  selectedOption: text("selected_option").notNull(),
  notes: text("notes"),
  
  // Snapshot of user info at submission time
  userName: text("user_name"),
  userEmail: text("user_email"),
  
  // Snapshot of withdrawal details at submission time
  withdrawalAmount: text("withdrawal_amount"),
  withdrawalBatches: text("withdrawal_batches"),
  
  submittedAt: timestamp("submitted_at").notNull().default(sql`now()`),
});

// Sealed Settlement & NDA — one row per case once the user types-and-signs
// the closing acknowledgement. The signed PDF is stored inline (base64) so
// re-downloads + hash verification do not depend on any external object
// store. The SHA-256 `contentHash` is computed over the byte-exact PDF and
// is the integrity proof shown to the user and admin alike.
export const caseNdas = pgTable("case_ndas", {
  id: serial("id").primaryKey(),
  // Intentionally NOT unique: when an admin clears a seal via the
  // Override Seal endpoint, the historical row is preserved (audit
  // durability) and a subsequent user re-sign inserts a NEW row. The
  // "current" NDA is the most recent createdAt for the case.
  caseId: varchar("case_id").notNull().references(() => cases.id),
  // Version tag of the NDA template the user signed. Tracks template
  // evolution so a sealed case always re-renders against the version it
  // was signed under, not whatever the latest code happens to be.
  templateVersion: text("template_version").notNull(),
  // Snapshot of the rendered NDA body the user actually saw at signing
  // time. Kept verbatim so disputes are resolvable without re-deriving
  // the document from live code.
  renderedBody: text("rendered_body").notNull(),
  // Typed-name signature + audit metadata captured at submission time.
  signedName: text("signed_name").notNull(),
  signedAt: timestamp("signed_at").notNull().default(sql`now()`),
  signedIp: text("signed_ip"),
  signedUserAgent: text("signed_user_agent"),
  // Base64-encoded signed PDF. Stored inline so re-downloads + hash
  // verification do not depend on any external blob store.
  signedPdfBase64: text("signed_pdf_base64").notNull(),
  // SHA-256 (lowercase hex) of the byte-exact PDF. Re-generated PDFs of
  // the same signed case must hash identically — see the generator
  // determinism notes in `server/services/NdaService.ts`.
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertCaseNdaSchema = createInsertSchema(caseNdas).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCaseNda = z.infer<typeof insertCaseNdaSchema>;
export type CaseNda = typeof caseNdas.$inferSelect;

// Task #70 — Certificate fee payment receipts. Mirrors deposit_receipts
// for the Merge Phrase Certificate flow: user uploads a payment receipt
// for the certification fee (% of withdrawalAmount), admin approves or
// rejects. `amountUsdt` is the server-computed amount at upload time;
// the client never supplies it. `baseAmountUsed` and `percentUsed`
// capture the inputs so a later admin can verify the math even if the
// global default % or the case's withdrawal amount changes.
export const certificateFeePayments = pgTable("certificate_fee_payments", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  amountUsdt: text("amount_usdt").notNull(),
  percentUsed: text("percent_used").notNull(),
  baseAmountUsed: text("base_amount_used").notNull(),
  fileData: text("file_data").notNull(), // base64 data URL
  fileName: text("file_name"),
  notes: text("notes"),
  status: text("status").notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  adminNotes: text("admin_notes"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  uploadedAt: timestamp("uploaded_at").notNull().default(sql`now()`),
});

// Task #72 — Stamp Duty receipts. Mirrors certificate_fee_payments but
// without percent/baseAmount (stamp duty is a fixed amount in USDT).
// Server resolves the amount at upload time (per-case override or global
// default); the client never supplies it.
export const stampDutyReceipts = pgTable("stamp_duty_receipts", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  amountUsdt: text("amount_usdt").notNull(),
  fileData: text("file_data").notNull(), // base64 data URL
  fileName: text("file_name"),
  notes: text("notes"),
  status: text("status").notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  adminNotes: text("admin_notes"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  uploadedAt: timestamp("uploaded_at").notNull().default(sql`now()`),
});

export const insertStampDutyReceiptSchema = createInsertSchema(stampDutyReceipts).omit({
  id: true,
  uploadedAt: true,
  reviewedAt: true,
  reviewedBy: true,
  adminNotes: true,
  status: true,
});
export type InsertStampDutyReceipt = z.infer<typeof insertStampDutyReceiptSchema>;
export type StampDutyReceipt = typeof stampDutyReceipts.$inferSelect;

// Session Refresh Deposit receipts — one row per user submission per
// gate activation round. The admin reviews the latest submission to
// approve or reject portal re-entry.
export const sessionRefreshReceipts = pgTable("session_refresh_receipts", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  txHash: text("tx_hash"),
  receiptData: text("receipt_data").notNull(), // base64 data URL
  fileName: text("file_name"),
  adminNotes: text("admin_notes"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  submittedAt: timestamp("submitted_at").notNull().default(sql`now()`),
});

export const insertSessionRefreshReceiptSchema = createInsertSchema(sessionRefreshReceipts).omit({
  id: true,
  submittedAt: true,
  reviewedAt: true,
  reviewedBy: true,
  adminNotes: true,
});
export type InsertSessionRefreshReceipt = z.infer<typeof insertSessionRefreshReceiptSchema>;
export type SessionRefreshReceipt = typeof sessionRefreshReceipts.$inferSelect;

export const insertCertificateFeePaymentSchema = createInsertSchema(certificateFeePayments).omit({
  id: true,
  uploadedAt: true,
  reviewedAt: true,
  reviewedBy: true,
  adminNotes: true,
  status: true,
});
export type InsertCertificateFeePayment = z.infer<typeof insertCertificateFeePaymentSchema>;
export type CertificateFeePayment = typeof certificateFeePayments.$inferSelect;

export const insertCaseSubmissionSchema = createInsertSchema(caseSubmissions).omit({
  id: true,
  submittedAt: true,
});

export type InsertCaseSubmission = z.infer<typeof insertCaseSubmissionSchema>;
export type CaseSubmission = typeof caseSubmissions.$inferSelect;

// Chat messages between admin and user
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  sender: text("sender").notNull(), // 'admin' or 'user'
  message: text("message").notNull(),
  isRead: text("is_read").default('false'),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Admin messages with categories (Urgent/Processing/Resolved)
export const adminMessages = pgTable("admin_messages", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  category: text("category").notNull().default('processing'), // 'urgent', 'processing', 'resolved'
  title: text("title").notNull(),
  body: text("body").notNull(),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertAdminMessageSchema = createInsertSchema(adminMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertAdminMessage = z.infer<typeof insertAdminMessageSchema>;
export type AdminMessage = typeof adminMessages.$inferSelect;

// Deposit receipts uploaded by users
export const depositReceipts = pgTable("deposit_receipts", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  submissionId: serial("submission_id"),
  imageData: text("image_data"), // Base64 encoded image
  fileName: text("file_name"),
  notes: text("notes"),
  status: text("status").default('pending'), // 'pending', 'reviewed', 'approved', 'rejected'
  adminNotes: text("admin_notes"), // Admin feedback/notes on the receipt
  // When the user uploads a receipt to pay a reissue fee, this links to the
  // letterReissues row so admin approval here flips that round to 'paid'.
  reissueId: integer("reissue_id"),
  // Task #163 — Unified receipt uploads. App-layer enum:
  //   'activation' — 1,500 USDT activation deposit (default for legacy rows
  //                  without a reissueId)
  //   'reissue'    — letter reissue fee payment (always paired with reissueId)
  //   'other'      — free-form upload the user wants to attach (e.g. extra
  //                  proof, additional payment screenshot, miscellaneous file)
  // NOTE: certificate_fee_payments and stamp_duty_receipts remain in their
  // own tables — unification is at the UI/admin-inbox layer, not schema.
  category: text("category"),
  uploadedAt: timestamp("uploaded_at").notNull().default(sql`now()`),
});

export const insertDepositReceiptSchema = createInsertSchema(depositReceipts).omit({
  id: true,
  uploadedAt: true,
});

export type InsertDepositReceipt = z.infer<typeof insertDepositReceiptSchema>;
export type DepositReceipt = typeof depositReceipts.$inferSelect;

// User-submitted withdrawal requests, gated by `cases.withdrawalWindowEnabled`.
// One row per submission. The portal posts here; admins review from the case
// detail dialog. The platform is display-only — approving here NEVER routes,
// holds, or relays funds; it only records the admin decision and emits an
// audit + email.
export const withdrawalRequests = pgTable("withdrawal_requests", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: 'cascade' }),

  // Lifecycle. `pending` until admin reviews; `cancelled` is a future
  // user-initiated state (not exposed yet but reserved so the enum is stable).
  status: text("status").notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'cancelled'

  // Section 1 — Withdrawal inputs (what the user wants withdrawn).
  amount: text("amount").notNull(),                 // free-form: "5,000 USDT"
  asset: text("asset").notNull(),                   // e.g. "USDT", "USDC", "BTC"
  network: text("network").notNull(),               // e.g. "TRC20", "ERC20"
  withdrawalType: text("withdrawal_type").notNull().default('full'), // 'full' | 'partial'

  // Section 2 — Requested destination wallet (SEPARATE from the admin-
  // designated payout wallet; admin still verifies before any release).
  requestedWalletAddress: text("requested_wallet_address").notNull(),
  requestedWalletAsset: text("requested_wallet_asset"),
  requestedWalletNetwork: text("requested_wallet_network"),

  // Section 3 — Preferences.
  preferredPayoutDate: timestamp("preferred_payout_date"),
  confirmationChannel: text("confirmation_channel").notNull().default('email'), // 'email' | 'sms' | 'both'

  // Section 4 — Security & terms. Stamped server-side when present.
  twoFactorProvidedAt: timestamp("two_factor_provided_at"),
  termsAcceptedAt: timestamp("terms_accepted_at").notNull().default(sql`now()`),

  // Optional user note + request provenance for the audit trail.
  userNote: text("user_note"),
  reqIp: text("req_ip"),
  reqUserAgent: text("req_user_agent"),

  // Admin review.
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  adminNote: text("admin_note"),

  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (t) => ({
  caseIdIdx: index("withdrawal_requests_case_id_idx").on(t.caseId),
  statusIdx: index("withdrawal_requests_status_idx").on(t.status),
  statusCheck: check(
    "withdrawal_requests_status_check",
    sql`${t.status} IN ('pending','approved','rejected','cancelled')`,
  ),
  typeCheck: check(
    "withdrawal_requests_type_check",
    sql`${t.withdrawalType} IN ('full','partial')`,
  ),
  channelCheck: check(
    "withdrawal_requests_channel_check",
    sql`${t.confirmationChannel} IN ('email','sms','both')`,
  ),
}));

export const insertWithdrawalRequestSchema = createInsertSchema(withdrawalRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
  reviewedBy: true,
  adminNote: true,
  twoFactorProvidedAt: true,
  termsAcceptedAt: true,
});
export type InsertWithdrawalRequest = z.infer<typeof insertWithdrawalRequestSchema>;
export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect;

// Per-case admin ledger entries (Task #55). Each row is a credit or debit
// the admin records against the case. Credits add to the computed total;
// debits subtract. The computed total auto-syncs into `cases.userBalance`
// only while `userBalance === userBalanceLastSyncedTotal` — once an admin
// edits the balance manually those columns diverge and the ledger panel
// surfaces a "Manual override active" pill until the admin re-syncs.
//
// Display-only — entries describe accounting state; this platform does NOT
// move funds. `userVisible=true` exposes the (sanitised) row to the portal
// Account History card; `notifyByEmail=true` triggers a best-effort
// transactional email on create.
export const caseLedgerEntries = pgTable("case_ledger_entries", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: 'cascade' }),
  direction: text("direction").notNull(),  // 'credit' | 'debit'
  amount: text("amount").notNull(),        // free-form numeric string e.g. "250.00"
  asset: text("asset").notNull().default('USDT'),
  category: text("category"),              // optional short tag (e.g. "fee", "refund")
  entryDate: timestamp("entry_date").notNull().default(sql`now()`),
  userVisible: boolean("user_visible").notNull().default(false),
  userNote: text("user_note"),             // shown to the user when userVisible
  adminNote: text("admin_note"),           // officer-only, never exposed via portal
  createdBy: text("created_by"),           // admin username (or 'system')
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (t) => ({
  caseIdIdx: index("case_ledger_entries_case_id_idx").on(t.caseId),
  directionCheck: check(
    "case_ledger_entries_direction_check",
    sql`${t.direction} IN ('credit','debit')`,
  ),
}));

export const insertCaseLedgerEntrySchema = createInsertSchema(caseLedgerEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCaseLedgerEntry = z.infer<typeof insertCaseLedgerEntrySchema>;
export type CaseLedgerEntry = typeof caseLedgerEntries.$inferSelect;

// Activity timeline - tracks all user/admin actions
export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").references(() => cases.id),
  actorType: text("actor_type").notNull(), // 'user', 'admin', 'system'
  actorId: text("actor_id"), // admin username or 'user'
  action: text("action").notNull(), // 'login', 'submission', 'message_sent', 'document_uploaded', etc.
  description: text("description").notNull(),
  metadata: text("metadata"), // JSON for additional data
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

// Audit log - tracks all admin actions for compliance
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  adminUsername: text("admin_username").notNull(),
  action: text("action").notNull(), // 'create_case', 'finalize_case', 'send_message', etc.
  targetType: text("target_type"), // 'case', 'user', 'message', etc.
  targetId: text("target_id"),
  previousValue: text("previous_value"), // JSON of old state
  newValue: text("new_value"), // JSON of new state
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // Structured side-data attached to the row. For email_<tag> audits this
  // carries stable foreign keys to the source record (e.g.
  // `declarationSubmissionId`, `adminMessageId`, `documentRequestId`,
  // `depositReceiptId`) so the retry handler can re-load the exact
  // original content instead of falling back to "latest matching row on
  // the case" — see Task #158.
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  // The recent-failed-logins panel, the by-IP rollup, and the periodic
  // retention sweep all filter on created_at, so an index here keeps both
  // the read and the prune cheap as the table grows.
  createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt),
}));

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// Admin users with role-based access
export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default('agent'), // 'super_admin', 'admin', 'agent', 'viewer'
  displayName: text("display_name"),
  email: text("email"),
  isActive: boolean("is_active").default(true),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorSecret: text("two_factor_secret"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertAdminUserSchema = createInsertSchema(adminUsers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminUser = typeof adminUsers.$inferSelect;

// User feedback/ratings
export const userFeedback = pgTable("user_feedback", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  rating: text("rating").notNull(), // '1' to '5'
  comment: text("comment"),
  feedbackType: text("feedback_type").default('support'), // 'support', 'overall', 'feature'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertUserFeedbackSchema = createInsertSchema(userFeedback).omit({
  id: true,
  createdAt: true,
});

export type InsertUserFeedback = z.infer<typeof insertUserFeedbackSchema>;
export type UserFeedback = typeof userFeedback.$inferSelect;

// Message templates for quick replies
export const messageTemplates = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").default('general'), // 'greeting', 'follow_up', 'urgent', 'general'
  content: text("content").notNull(),
  isActive: boolean("is_active").default(true),
  usageCount: text("usage_count").default('0'),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertMessageTemplateSchema = createInsertSchema(messageTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMessageTemplate = z.infer<typeof insertMessageTemplateSchema>;
export type MessageTemplate = typeof messageTemplates.$inferSelect;

// Document requests from admin
export const documentRequests = pgTable("document_requests", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  documentType: text("document_type").notNull(), // 'id_proof', 'address_proof', 'bank_statement', etc.
  description: text("description"),
  status: text("status").default('pending'), // 'pending', 'submitted', 'approved', 'rejected'
  submittedFileData: text("submitted_file_data"), // Base64
  submittedFileName: text("submitted_file_name"),
  adminNotes: text("admin_notes"),
  deadline: timestamp("deadline"),
  submittedAt: timestamp("submitted_at"),
  // Set when status transitions to 'approved'. Used by the document
  // archive sweep so the 90-day retention window is measured from the
  // moment of approval rather than from submission. Nullable for rows
  // approved before this column existed — the sweep falls back to
  // submittedAt in that case so legacy rows aren't permanently exempt.
  approvedAt: timestamp("approved_at"),
  // Admin-controlled toggle for the user-facing upload link. When false the
  // portal hides/disables the "Upload Document" button and the unauth
  // PATCH /api/document-requests/:id submission endpoint refuses uploads
  // for this row. Defaults to true so existing requests stay open.
  uploadsEnabled: boolean("uploads_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertDocumentRequestSchema = createInsertSchema(documentRequests).omit({
  id: true,
  createdAt: true,
});

export type InsertDocumentRequest = z.infer<typeof insertDocumentRequestSchema>;
export type DocumentRequest = typeof documentRequests.$inferSelect;

// User sessions for session management
export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  sessionToken: text("session_token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  location: text("location"),
  isActive: boolean("is_active").default(true),
  lastActivityAt: timestamp("last_activity_at").notNull().default(sql`now()`),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at"),
});

export const insertUserSessionSchema = createInsertSchema(userSessions).omit({
  id: true,
  createdAt: true,
});

export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;
export type UserSession = typeof userSessions.$inferSelect;

// Scheduled messages for future delivery
export const scheduledMessages = pgTable("scheduled_messages", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").references(() => cases.id),
  messageType: text("message_type").notNull(), // 'chat', 'admin_message', 'letter'
  category: text("category"), // For admin messages: 'urgent', 'processing', 'resolved'
  title: text("title"),
  content: text("content").notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  status: text("status").default('pending'), // 'pending', 'sent', 'cancelled'
  sentAt: timestamp("sent_at"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertScheduledMessageSchema = createInsertSchema(scheduledMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertScheduledMessage = z.infer<typeof insertScheduledMessageSchema>;
export type ScheduledMessage = typeof scheduledMessages.$inferSelect;

// Help center articles
export const helpArticles = pgTable("help_articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").default('general'), // 'general', 'deposits', 'withdrawals', 'account'
  order: text("display_order").default('0'),
  isPublished: boolean("is_published").default(true),
  viewCount: text("view_count").default('0'),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertHelpArticleSchema = createInsertSchema(helpArticles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertHelpArticle = z.infer<typeof insertHelpArticleSchema>;
export type HelpArticle = typeof helpArticles.$inferSelect;

// Notifications center
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  recipientType: text("recipient_type").notNull(), // 'admin', 'user'
  recipientId: text("recipient_id"), // admin username or caseId
  type: text("type").notNull(), // 'new_message', 'new_submission', 'document_uploaded', etc.
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"), // URL to navigate to
  isRead: boolean("is_read").default(false),
  metadata: text("metadata"), // JSON
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// Admin sessions for session management and 2FA
export const adminSessions = pgTable("admin_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminUsername: text("admin_username").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  location: text("location"),
  isActive: boolean("is_active").default(true),
  lastActivityAt: timestamp("last_activity_at").notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  revokedReason: text("revoked_reason"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertAdminSessionSchema = createInsertSchema(adminSessions).omit({
  id: true,
  createdAt: true,
});

export type InsertAdminSession = z.infer<typeof insertAdminSessionSchema>;
export type AdminSession = typeof adminSessions.$inferSelect;

// Admin "Open as User" mirror tokens. Stored in Postgres (rather than a
// per-process Map) so the mint and redeem requests can land on different
// app instances under autoscale and still find the same token. Rows are
// single-use: the redeem path deletes by token and only succeeds if a row
// came back. A short TTL is enforced by `expiresAt` and pruned best-effort
// on every mint/redeem.
export const adminMirrorTokens = pgTable("admin_mirror_tokens", {
  token: text("token").primaryKey(),
  caseId: varchar("case_id").notNull(),
  accessCode: text("access_code").notNull(),
  issuedBy: text("issued_by").notNull(),
  reason: text("reason").notNull(),
  issuerIp: text("issuer_ip"),
  issuerUserAgent: text("issuer_user_agent"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertAdminMirrorTokenSchema = createInsertSchema(adminMirrorTokens).omit({
  createdAt: true,
});

export type InsertAdminMirrorToken = z.infer<typeof insertAdminMirrorTokenSchema>;
export type AdminMirrorToken = typeof adminMirrorTokens.$inferSelect;

// Portal session tokens (Task #123). Previously held in a per-process Map,
// which under Replit autoscale meant a portal user signed in on instance A
// would appear logged out (or get a 401) if their next request was served
// by instance B — and admin "Force logout" only dropped sessions from the
// instance that ran the action. Persisting the token row in Postgres makes
// validate / delete / delete-by-case work uniformly across every instance.
export const portalSessions = pgTable("portal_sessions", {
  token: text("token").primaryKey(),
  caseId: varchar("case_id").notNull(),
  accessCode: text("access_code").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at").notNull(),
  // Mirror sessions are short-lived admin-impersonation sessions. Flagged here
  // so requirePortalSessionOnly can reject them on consent-bearing routes
  // (NDA preview/sign) where only genuine user participation is acceptable.
  isMirror: boolean("is_mirror").notNull().default(false),
  // Bumped on every successful validateSession() call (i.e. every request
  // that actually used the token), independent of createdAt/expiresAt.
  // Lets admins distinguish "session technically valid but idle for days"
  // from "user active right now" — surfaced on the rotate-code warning.
  lastActivityAt: timestamp("last_activity_at").notNull().default(sql`now()`),
}, (t) => ({
  byCase: index("portal_sessions_case_id_idx").on(t.caseId),
  byExpiry: index("portal_sessions_expires_at_idx").on(t.expiresAt),
}));

export const insertPortalSessionSchema = createInsertSchema(portalSessions).omit({
  createdAt: true,
});

export type InsertPortalSession = z.infer<typeof insertPortalSessionSchema>;
export type PortalSession = typeof portalSessions.$inferSelect;

// Persistent backing store for the admin-login rate limiter. We mirror the
// in-memory counters here on every increment so an attacker who tripped the
// 15-minute lockout right before a deploy still sees 429 once the new server
// boots, instead of getting a fresh 5-attempt budget on every restart.
//
// The `key` column matches the in-memory cache key
// ("<persistNamespace>:<ip>:<route>") so hydration can drop rows back into the
// cache verbatim. `resetAt` is the wall-clock moment the current window
// expires; rows past that point are treated as absent and pruned on a timer.
export const adminLoginAttempts = pgTable("admin_login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertAdminLoginAttemptSchema = createInsertSchema(adminLoginAttempts).omit({
  updatedAt: true,
});

export type InsertAdminLoginAttempt = z.infer<typeof insertAdminLoginAttemptSchema>;
export type AdminLoginAttempt = typeof adminLoginAttempts.$inferSelect;

// Single-use nonces embedded in satisfaction-rating eligibility tokens
// (see server/lib/satisfactionToken.ts). Claiming a nonce is an atomic
// INSERT ... ON CONFLICT DO NOTHING so exactly one instance in an autoscale
// fleet can ever successfully redeem a given token, even if the same token is
// replayed concurrently across multiple processes. `expiresAt` mirrors the
// token's own expiry (not a fixed TTL) so the sweep never outlives the token
// it protects, and rows are cheap to prune once the token could no longer
// verify anyway.
export const satisfactionTokenNonces = pgTable("satisfaction_token_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export type SatisfactionTokenNonce = typeof satisfactionTokenNonces.$inferSelect;

// Admin 2FA settings
export const adminTwoFactor = pgTable("admin_two_factor", {
  id: serial("id").primaryKey(),
  adminUsername: text("admin_username").notNull().unique(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes"), // JSON array of hashed backup codes
  isEnabled: boolean("is_enabled").default(false),
  lastVerifiedAt: timestamp("last_verified_at"),
  enabledAt: timestamp("enabled_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertAdminTwoFactorSchema = createInsertSchema(adminTwoFactor).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAdminTwoFactor = z.infer<typeof insertAdminTwoFactorSchema>;
export type AdminTwoFactor = typeof adminTwoFactor.$inferSelect;

// Chat templates for quick responses
export const chatTemplates = pgTable("chat_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  category: text("category").default('general'), // 'general', 'support', 'verification', 'deposits'
  shortcut: text("shortcut"), // Quick keyboard shortcut like /greeting
  isActive: boolean("is_active").default(true),
  usageCount: text("usage_count").default('0'),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertChatTemplateSchema = createInsertSchema(chatTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertChatTemplate = z.infer<typeof insertChatTemplateSchema>;
export type ChatTemplate = typeof chatTemplates.$inferSelect;

// Case notes (admin-only comments)
export const caseNotes = pgTable("case_notes", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  adminUsername: text("admin_username").notNull(),
  content: text("content").notNull(),
  isPinned: boolean("is_pinned").default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertCaseNoteSchema = createInsertSchema(caseNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCaseNote = z.infer<typeof insertCaseNoteSchema>;
export type CaseNote = typeof caseNotes.$inferSelect;

// Localization/translations
export const translations = pgTable("translations", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  locale: text("locale").notNull(), // 'en', 'es', 'zh', etc.
  value: text("value").notNull(),
  context: text("context"), // Where this translation is used
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertTranslationSchema = createInsertSchema(translations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTranslation = z.infer<typeof insertTranslationSchema>;
export type Translation = typeof translations.$inferSelect;

// Newsletter subscribers
export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  isActive: boolean("is_active").default(true),
  subscribedAt: timestamp("subscribed_at").notNull().default(sql`now()`),
  unsubscribedAt: timestamp("unsubscribed_at"),
});

export const insertNewsletterSubscriberSchema = createInsertSchema(newsletterSubscribers).omit({
  id: true,
  subscribedAt: true,
});

export type InsertNewsletterSubscriber = z.infer<typeof insertNewsletterSubscriberSchema>;
export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;

// Scam alerts for ticker
export const scamAlerts = pgTable("scam_alerts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  severity: text("severity").default('medium'), // 'low', 'medium', 'high', 'critical'
  platformName: text("platform_name"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertScamAlertSchema = createInsertSchema(scamAlerts).omit({
  id: true,
  createdAt: true,
});

export type InsertScamAlert = z.infer<typeof insertScamAlertSchema>;
export type ScamAlert = typeof scamAlerts.$inferSelect;

// Testimonials
export const testimonials = pgTable("testimonials", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  avatar: text("avatar"), // URL or base64
  rating: text("rating").notNull().default('5'), // 1-5
  content: text("content").notNull(),
  isApproved: boolean("is_approved").default(false),
  isFeatured: boolean("is_featured").default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertTestimonialSchema = createInsertSchema(testimonials).omit({
  id: true,
  createdAt: true,
});

export type InsertTestimonial = z.infer<typeof insertTestimonialSchema>;
export type Testimonial = typeof testimonials.$inferSelect;

// Site statistics
export const siteStatistics = pgTable("site_statistics", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // 'cases_reviewed', 'users_protected', 'response_time', 'resolution_rate'
  value: text("value").notNull(),
  label: text("label").notNull(),
  icon: text("icon"),
  displayOrder: text("display_order").default('0'),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertSiteStatisticSchema = createInsertSchema(siteStatistics).omit({
  id: true,
  updatedAt: true,
});

export type InsertSiteStatistic = z.infer<typeof insertSiteStatisticSchema>;
export type SiteStatistic = typeof siteStatistics.$inferSelect;

// Contact form submissions
export const contactSubmissions = pgTable("contact_submissions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  subject: text("subject"),
  message: text("message").notNull(),
  status: text("status").default('new'), // 'new', 'read', 'replied', 'archived'
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertContactSubmissionSchema = createInsertSchema(contactSubmissions).omit({
  id: true,
  createdAt: true,
});

export type InsertContactSubmission = z.infer<typeof insertContactSubmissionSchema>;
export type ContactSubmission = typeof contactSubmissions.$inferSelect;

// FAQ items
export const faqItems = pgTable("faq_items", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: text("category").default('general'),
  displayOrder: text("display_order").default('0'),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertFaqItemSchema = createInsertSchema(faqItems).omit({
  id: true,
  createdAt: true,
});

export type InsertFaqItem = z.infer<typeof insertFaqItemSchema>;
export type FaqItem = typeof faqItems.$inferSelect;

// ============================================
// DEPARTMENTS & COMMUNITY SYSTEM
// ============================================

// Departments - 5 main departments for case categorization
export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // 'submission', 'request', 'complaint', 'compliance', 'recovery'
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"), // lucide icon name
  color: text("color").default('#004182'), // brand color
  displayOrder: text("display_order").default('0'),
  isActive: boolean("is_active").default(true),
  workflowConfig: text("workflow_config"), // JSON workflow settings
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertDepartmentSchema = createInsertSchema(departments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;
export type Department = typeof departments.$inferSelect;

// Department stages - workflow stages for each department
export const departmentStages = pgTable("department_stages", {
  id: serial("id").primaryKey(),
  departmentId: integer("department_id").references(() => departments.id),
  name: text("name").notNull(),
  description: text("description"),
  stageOrder: text("stage_order").notNull().default('1'),
  slaDays: text("sla_days"), // expected days to complete
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertDepartmentStageSchema = createInsertSchema(departmentStages).omit({
  id: true,
  createdAt: true,
});

export type InsertDepartmentStage = z.infer<typeof insertDepartmentStageSchema>;
export type DepartmentStage = typeof departmentStages.$inferSelect;

// Community threads - discussion topics organized by department
export const communityThreads = pgTable("community_threads", {
  id: serial("id").primaryKey(),
  departmentId: integer("department_id").references(() => departments.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  authorType: text("author_type").notNull().default('bot'), // 'user', 'bot', 'admin'
  authorHandle: text("author_handle").notNull(), // anonymous display name
  authorBotId: integer("author_bot_id"), // references bot profile if bot
  isPinned: boolean("is_pinned").default(false),
  isLocked: boolean("is_locked").default(false),
  viewCount: integer("view_count").default(0),
  replyCount: integer("reply_count").default(0),
  lastActivityAt: timestamp("last_activity_at").notNull().default(sql`now()`),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  // Keyword moderation: set by checkContent() on every user-authored thread.
  // Flagged threads are hidden from public until an admin approves or removes them.
  isFlagged: boolean("is_flagged").default(false),
  flagReason: text("flag_reason"),
});

export const insertCommunityThreadSchema = createInsertSchema(communityThreads).omit({
  id: true,
  createdAt: true,
});

export type InsertCommunityThread = z.infer<typeof insertCommunityThreadSchema>;
export type CommunityThread = typeof communityThreads.$inferSelect;

// Community posts - replies within threads
export const communityPosts = pgTable("community_posts", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").references(() => communityThreads.id),
  content: text("content").notNull(),
  authorType: text("author_type").notNull().default('bot'), // 'user', 'bot', 'admin'
  authorHandle: text("author_handle").notNull(), // anonymous display name
  authorBotId: integer("author_bot_id"), // references bot profile if bot
  isHidden: boolean("is_hidden").default(false),
  likeCount: text("like_count").default('0'),
  // Keyword moderation: set by checkContent() on every user-authored post.
  // Flagged posts are hidden from public until an admin approves or removes them.
  isFlagged: boolean("is_flagged").default(false),
  flagReason: text("flag_reason"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertCommunityPostSchema = createInsertSchema(communityPosts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCommunityPost = z.infer<typeof insertCommunityPostSchema>;
export type CommunityPost = typeof communityPosts.$inferSelect;

// Community participants - maps real users to anonymous handles
export const communityParticipants = pgTable("community_participants", {
  id: serial("id").primaryKey(),
  // ON DELETE CASCADE: deleting a case must remove its participant row (and
  // — via the cascade on community_reactions.participant_id — every reaction
  // tied to that participant). Without the cascade, deleted cases would
  // leave orphan handles in the directory and inflate the table. See
  // server/community-cleanup.ts for the scheduled prune that handles the
  // softer "case sealed/closed for N days" path.
  caseId: varchar("case_id").references(() => cases.id, { onDelete: 'cascade' }),
  anonymousHandle: text("anonymous_handle").notNull().unique(),
  departmentId: integer("department_id").references(() => departments.id),
  joinedAt: timestamp("joined_at").notNull().default(sql`now()`),
  postCount: text("post_count").default('0'),
  reputation: text("reputation").default('0'),
  badgeLevel: text("badge_level").default('newcomer'), // 'newcomer', 'member', 'trusted', 'veteran'
}, (t) => ({
  // At-most-one participant per case. Matches migration 0012 and lets
  // getOrCreateParticipantForSession use ON CONFLICT (case_id) DO NOTHING
  // to resolve cross-instance races deterministically. Non-partial so the
  // index is a valid ON CONFLICT arbiter; multiple NULL case_id rows are
  // still allowed because Postgres treats NULLs as distinct by default.
  uniqueCaseId: uniqueIndex("community_participants_unique_case_id").on(t.caseId),
}));

export const insertCommunityParticipantSchema = createInsertSchema(communityParticipants).omit({
  id: true,
  joinedAt: true,
});

export type InsertCommunityParticipant = z.infer<typeof insertCommunityParticipantSchema>;
export type CommunityParticipant = typeof communityParticipants.$inferSelect;

// Community reactions - likes/helpful marks on posts
export const communityReactions = pgTable("community_reactions", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").references(() => communityPosts.id),
  // ON DELETE CASCADE: when a participant row is removed (case deleted, or
  // pruned by the scheduled cleanup in server/community-cleanup.ts), every
  // reaction authored by that participant goes with it. Reactions for bot /
  // admin authors carry participant_id = NULL and are unaffected.
  participantId: integer("participant_id").references(() => communityParticipants.id, { onDelete: 'cascade' }),
  reactionType: text("reaction_type").notNull().default('like'), // 'like', 'helpful', 'thanks'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertCommunityReactionSchema = createInsertSchema(communityReactions).omit({
  id: true,
  createdAt: true,
});

export type InsertCommunityReaction = z.infer<typeof insertCommunityReactionSchema>;
export type CommunityReaction = typeof communityReactions.$inferSelect;

// Bot profiles - 600+ simulated community members
export const botProfiles = pgTable("bot_profiles", {
  id: serial("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarInitials: text("avatar_initials").notNull(), // 2 letter initials for avatar
  departmentId: integer("department_id").references(() => departments.id),
  caseStage: text("case_stage").default('active'), // simulated case progress
  personality: text("personality"), // JSON personality traits for content generation
  joinedDate: timestamp("joined_date").notNull().default(sql`now()`),
  postCount: text("post_count").default('0'),
  reputation: text("reputation").default('0'),
  badgeLevel: text("badge_level").default('member'),
  isActive: boolean("is_active").default(true),
  lastPostAt: timestamp("last_post_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertBotProfileSchema = createInsertSchema(botProfiles).omit({
  id: true,
  createdAt: true,
});

export type InsertBotProfile = z.infer<typeof insertBotProfileSchema>;
export type BotProfile = typeof botProfiles.$inferSelect;

// Bot scheduled posts - pre-planned bot activity
export const botScheduledPosts = pgTable("bot_scheduled_posts", {
  id: serial("id").primaryKey(),
  botId: integer("bot_id").references(() => botProfiles.id),
  threadId: integer("thread_id").references(() => communityThreads.id),
  postType: text("post_type").notNull().default('reply'), // 'thread', 'reply'
  content: text("content").notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  status: text("status").default('pending'), // 'pending', 'posted', 'cancelled'
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertBotScheduledPostSchema = createInsertSchema(botScheduledPosts).omit({
  id: true,
  createdAt: true,
});

export type InsertBotScheduledPost = z.infer<typeof insertBotScheduledPostSchema>;
export type BotScheduledPost = typeof botScheduledPosts.$inferSelect;

// Community moderation log
export const communityModerationLogs = pgTable("community_moderation_logs", {
  id: serial("id").primaryKey(),
  adminUsername: text("admin_username").notNull(),
  action: text("action").notNull(), // 'hide_post', 'lock_thread', 'pin_thread', 'ban_participant'
  targetType: text("target_type").notNull(), // 'thread', 'post', 'participant'
  targetId: text("target_id").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertCommunityModerationLogSchema = createInsertSchema(communityModerationLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertCommunityModerationLog = z.infer<typeof insertCommunityModerationLogSchema>;
export type CommunityModerationLog = typeof communityModerationLogs.$inferSelect;

// Configurable keyword blocklist for community content moderation.
// Each entry may be a literal string (exact match, case-insensitive) or a
// simple wildcard glob (isWildcard = true, * matches any substring).
// Active keywords are loaded by communityModeration.ts with a 60-second TTL
// cache and tested against every user-authored thread title/content and post.
export const communityKeywordBlocklist = pgTable("community_keyword_blocklist", {
  id: serial("id").primaryKey(),
  pattern: text("pattern").notNull(),
  isWildcard: boolean("is_wildcard").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  createdBy: text("created_by"),
});

export const insertCommunityKeywordBlocklistSchema = createInsertSchema(communityKeywordBlocklist).omit({
  id: true,
  createdAt: true,
});

export type InsertCommunityKeywordBlocklist = z.infer<typeof insertCommunityKeywordBlocklistSchema>;
export type CommunityKeywordBlocklist = typeof communityKeywordBlocklist.$inferSelect;

// User badges/achievements
export const userBadges = pgTable("user_badges", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  icon: text("icon"), // emoji or icon name
  color: text("color").default('#004182'),
  requirement: text("requirement"), // JSON criteria to earn badge
  displayOrder: text("display_order").default('0'),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertUserBadgeSchema = createInsertSchema(userBadges).omit({
  id: true,
  createdAt: true,
});

export type InsertUserBadge = z.infer<typeof insertUserBadgeSchema>;
export type UserBadge = typeof userBadges.$inferSelect;

// User earned badges
export const earnedBadges = pgTable("earned_badges", {
  id: serial("id").primaryKey(),
  // ON DELETE CASCADE: a participant row may be pruned when its case is
  // deleted or has been sealed/closed past the retention window. Earned
  // badge rows belong to that participant and have no meaning without
  // them, so cascade rather than leave a dangling participant_id.
  participantId: integer("participant_id").references(() => communityParticipants.id, { onDelete: 'cascade' }),
  badgeId: integer("badge_id").references(() => userBadges.id),
  earnedAt: timestamp("earned_at").notNull().default(sql`now()`),
});

export const insertEarnedBadgeSchema = createInsertSchema(earnedBadges).omit({
  id: true,
  earnedAt: true,
});

export type InsertEarnedBadge = z.infer<typeof insertEarnedBadgeSchema>;
export type EarnedBadge = typeof earnedBadges.$inferSelect;

// User documents uploaded
export const userDocuments = pgTable("user_documents", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(), // 'pdf', 'image', 'doc'
  fileData: text("file_data"), // base64 encoded
  fileSize: text("file_size"),
  category: text("category").default('general'), // 'id_proof', 'transaction', 'evidence', 'general'
  description: text("description"),
  status: text("status").default('uploaded'), // 'uploaded', 'reviewed', 'approved', 'rejected'
  adminNotes: text("admin_notes"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  uploadedAt: timestamp("uploaded_at").notNull().default(sql`now()`),
});

export const insertUserDocumentSchema = createInsertSchema(userDocuments).omit({
  id: true,
  uploadedAt: true,
});

export type InsertUserDocument = z.infer<typeof insertUserDocumentSchema>;
export type UserDocument = typeof userDocuments.$inferSelect;

// Pending bot responses - AI-generated responses scheduled for delayed delivery
export const pendingBotResponses = pgTable("pending_bot_responses", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").references(() => communityThreads.id),
  triggerPostId: integer("trigger_post_id").references(() => communityPosts.id), // The user post that triggered this response
  botId: integer("bot_id").references(() => botProfiles.id),
  content: text("content").notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(), // When to deliver the response
  status: text("status").default('pending'), // 'pending', 'delivered', 'cancelled', 'failed'
  deliveredAt: timestamp("delivered_at"),
  resultPostId: integer("result_post_id"), // The actual post created when delivered
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertPendingBotResponseSchema = createInsertSchema(pendingBotResponses).omit({
  id: true,
  createdAt: true,
});

export type InsertPendingBotResponse = z.infer<typeof insertPendingBotResponseSchema>;
export type PendingBotResponse = typeof pendingBotResponses.$inferSelect;

// Access key requests - self-service key generation with admin approval
export const accessKeyRequests = pgTable("access_key_requests", {
  id: serial("id").primaryKey(),
  requestId: text("request_id").notNull().unique(), // Public ID for users to check status (e.g., "REQ-XXXXXX")
  generatedKey: text("generated_key").notNull(), // The access key (shown to user after approval)
  status: text("status").notNull().default('pending'), // 'pending', 'approved', 'rejected', 'expired'
  
  // User info from request
  userName: text("user_name"),
  userEmail: text("user_email"),
  userPhone: text("user_phone"),
  requestReason: text("request_reason"), // Why they need access
  
  // Admin messaging
  adminMessages: text("admin_messages"), // JSON array of admin messages to user
  adminUsername: text("admin_username"), // Admin who processed the request
  
  // Linked case (created after approval)
  caseId: varchar("case_id").references(() => cases.id),
  
  // Read tracking (server-side, replaces localStorage)
  userMessagesReadCount: integer("user_messages_read_count").default(0),

  // Timestamps
  expiresAt: timestamp("expires_at").notNull(), // Auto-expire after 7 days
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  keyViewedAt: timestamp("key_viewed_at"), // When user first viewed their approved key
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertAccessKeyRequestSchema = createInsertSchema(accessKeyRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAccessKeyRequest = z.infer<typeof insertAccessKeyRequestSchema>;
export type AccessKeyRequest = typeof accessKeyRequests.$inferSelect;

// ============================================
// CUSTOMER SERVICE PLATFORM TABLES
// ============================================

// Active visitors - real-time tracking of users on the site
export const activeVisitors = pgTable("active_visitors", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id").notNull().unique(), // Unique browser fingerprint/session ID
  caseId: varchar("case_id").references(() => cases.id), // If logged in user
  
  // Visitor info
  currentPage: text("current_page"),
  pageTitle: text("page_title"),
  referrer: text("referrer"),
  
  // Device & browser
  deviceType: text("device_type"), // 'desktop', 'mobile', 'tablet'
  browser: text("browser"),
  browserVersion: text("browser_version"),
  os: text("os"),
  osVersion: text("os_version"),
  userAgent: text("user_agent"), // raw UA string for forensics
  screenResolution: text("screen_resolution"),
  screenWidth: integer("screen_width"),
  screenHeight: integer("screen_height"),
  language: text("language"),
  timezone: text("timezone"),
  connectionType: text("connection_type"), // navigator.connection.effectiveType
  fingerprintHash: text("fingerprint_hash"), // stable hash of UA+screen+lang+tz+colorDepth
  
  // Location (from IP)
  ipAddress: text("ip_address"),
  country: text("country"),
  region: text("region"),
  city: text("city"),
  isp: text("isp"),
  asn: text("asn"),
  
  // Session tracking
  pagesViewed: text("pages_viewed"), // JSON array of pages visited
  pageViewCount: integer("page_view_count").default(1),
  pageTimeline: text("page_timeline"), // JSON array of {path,title,enteredAt,leftAt,dwellMs}
  isIdle: boolean("is_idle").default(false),
  idleSince: timestamp("idle_since"),
  
  // Engagement scoring
  engagementScore: integer("engagement_score").default(0), // 0-100
  
  // Behavior intelligence
  persona: text("persona"), // inferred label: scam-research, victim-portal, researcher, community, browser, etc.
  personaConfidence: integer("persona_confidence"), // 0-100
  personaReasoning: text("persona_reasoning"), // JSON array of strings
  riskScore: integer("risk_score"), // 0-100, higher = more suspicious
  riskFlags: text("risk_flags"), // JSON array of {flag,reason}
  
  // Chat status
  hasActiveChat: boolean("has_active_chat").default(false),
  chatStartedAt: timestamp("chat_started_at"),
  proactiveGreeting: text("proactive_greeting"),
  
  // Admin notes
  notes: text("notes"),
  
  // Timestamps
  sessionStartedAt: timestamp("session_started_at").notNull().default(sql`now()`),
  lastHeartbeatAt: timestamp("last_heartbeat_at").notNull().default(sql`now()`),
});

export const insertActiveVisitorSchema = createInsertSchema(activeVisitors).omit({
  id: true,
});

export type InsertActiveVisitor = z.infer<typeof insertActiveVisitorSchema>;
export type ActiveVisitor = typeof activeVisitors.$inferSelect;

// Visitor history - track returning visitors (one row per ended session)
export const visitorHistory = pgTable("visitor_history", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id").notNull(),
  caseId: varchar("case_id").references(() => cases.id),
  
  // Session summary
  pagesViewed: text("pages_viewed"), // JSON array
  pageViewCount: integer("page_view_count").default(0),
  pageTimeline: text("page_timeline"), // JSON array of {path,title,enteredAt,leftAt,dwellMs}
  sessionDuration: integer("session_duration"), // seconds
  engagementScore: integer("engagement_score"),
  
  // Device info
  deviceType: text("device_type"),
  browser: text("browser"),
  browserVersion: text("browser_version"),
  os: text("os"),
  osVersion: text("os_version"),
  userAgent: text("user_agent"),
  screenResolution: text("screen_resolution"),
  language: text("language"),
  timezone: text("timezone"),
  connectionType: text("connection_type"),
  fingerprintHash: text("fingerprint_hash"),
  referrer: text("referrer"),
  
  // Network / location
  ipAddress: text("ip_address"),
  country: text("country"),
  region: text("region"),
  city: text("city"),
  isp: text("isp"),
  asn: text("asn"),
  
  // Behavior intelligence (final values at session-end)
  persona: text("persona"),
  personaConfidence: integer("persona_confidence"),
  personaReasoning: text("persona_reasoning"),
  riskScore: integer("risk_score"),
  riskFlags: text("risk_flags"),
  
  // Chat info
  hadChat: boolean("had_chat").default(false),
  chatId: integer("chat_id"),
  
  sessionStartedAt: timestamp("session_started_at").notNull(),
  sessionEndedAt: timestamp("session_ended_at").notNull().default(sql`now()`),
}, (table) => ({
  // The history list is paginated by recency; an index here keeps the
  // ORDER BY session_started_at DESC LIMIT N path cheap as the table grows.
  sessionStartedAtIdx: index("visitor_history_session_started_at_idx").on(table.sessionStartedAt),
  // Filter helpers used by the admin search.
  ipAddressIdx: index("visitor_history_ip_address_idx").on(table.ipAddress),
  visitorIdIdx: index("visitor_history_visitor_id_idx").on(table.visitorId),
}));

export const insertVisitorHistorySchema = createInsertSchema(visitorHistory).omit({
  id: true,
});

export type InsertVisitorHistory = z.infer<typeof insertVisitorHistorySchema>;
export type VisitorHistory = typeof visitorHistory.$inferSelect;

// Blocked visitors
export const blockedVisitors = pgTable("blocked_visitors", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id"),
  ipAddress: text("ip_address"),
  reason: text("reason"),
  blockedBy: text("blocked_by"), // admin username
  blockedAt: timestamp("blocked_at").notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at"), // null = permanent
});

export const insertBlockedVisitorSchema = createInsertSchema(blockedVisitors).omit({
  id: true,
});

export type InsertBlockedVisitor = z.infer<typeof insertBlockedVisitorSchema>;
export type BlockedVisitor = typeof blockedVisitors.$inferSelect;

// Auto-greetings - triggered messages based on conditions
export const autoGreetings = pgTable("auto_greetings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  message: text("message").notNull(),
  
  // Trigger conditions
  triggerType: text("trigger_type").notNull(), // 'page_visit', 'time_on_page', 'returning_visitor', 'exit_intent'
  triggerPage: text("trigger_page"), // URL pattern to match
  triggerDelay: integer("trigger_delay").default(0), // seconds
  
  // Target audience
  targetNewVisitors: boolean("target_new_visitors").default(true),
  targetReturningVisitors: boolean("target_returning_visitors").default(true),
  targetLoggedIn: boolean("target_logged_in").default(true),
  targetAnonymous: boolean("target_anonymous").default(true),
  
  // Settings
  isActive: boolean("is_active").default(true),
  priority: integer("priority").default(0),
  showOncePerSession: boolean("show_once_per_session").default(true),
  
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertAutoGreetingSchema = createInsertSchema(autoGreetings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAutoGreeting = z.infer<typeof insertAutoGreetingSchema>;
export type AutoGreeting = typeof autoGreetings.$inferSelect;

// Admin availability status
export const adminAvailability = pgTable("admin_availability", {
  id: serial("id").primaryKey(),
  adminUsername: text("admin_username").notNull().unique(),
  status: text("status").notNull().default('offline'), // 'online', 'away', 'busy', 'offline'
  statusMessage: text("status_message"),
  autoAwayAfter: integer("auto_away_after").default(300), // seconds of inactivity
  
  // Notification preferences
  soundEnabled: boolean("sound_enabled").default(true),
  desktopNotifications: boolean("desktop_notifications").default(true),
  emailNotifications: boolean("email_notifications").default(false),
  
  lastActivityAt: timestamp("last_activity_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertAdminAvailabilitySchema = createInsertSchema(adminAvailability).omit({
  id: true,
  updatedAt: true,
});

export type InsertAdminAvailability = z.infer<typeof insertAdminAvailabilitySchema>;
export type AdminAvailability = typeof adminAvailability.$inferSelect;

// Working hours configuration
export const workingHours = pgTable("working_hours", {
  id: serial("id").primaryKey(),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sunday, 6=Saturday
  startTime: text("start_time"), // "09:00"
  endTime: text("end_time"), // "17:00"
  isEnabled: boolean("is_enabled").default(true),
  timezone: text("timezone").default('UTC'),
});

export const insertWorkingHoursSchema = createInsertSchema(workingHours).omit({
  id: true,
});

export type InsertWorkingHours = z.infer<typeof insertWorkingHoursSchema>;
export type WorkingHours = typeof workingHours.$inferSelect;

// Offline messages - when no agents available
export const offlineMessages = pgTable("offline_messages", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id"),
  caseId: varchar("case_id").references(() => cases.id),
  
  // Contact info
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  
  // Message
  subject: text("subject"),
  message: text("message").notNull(),
  
  // Status
  status: text("status").default('new'), // 'new', 'read', 'replied', 'resolved'
  repliedBy: text("replied_by"),
  repliedAt: timestamp("replied_at"),
  
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertOfflineMessageSchema = createInsertSchema(offlineMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertOfflineMessage = z.infer<typeof insertOfflineMessageSchema>;
export type OfflineMessage = typeof offlineMessages.$inferSelect;

// Chat tags for conversation organization
export const chatTags = pgTable("chat_tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").default('#004182'),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertChatTagSchema = createInsertSchema(chatTags).omit({
  id: true,
  createdAt: true,
});

export type InsertChatTag = z.infer<typeof insertChatTagSchema>;
export type ChatTag = typeof chatTags.$inferSelect;

// Conversation tags (many-to-many)
export const conversationTags = pgTable("conversation_tags", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  tagId: integer("tag_id").notNull().references(() => chatTags.id),
  addedBy: text("added_by"),
  addedAt: timestamp("added_at").notNull().default(sql`now()`),
});

export const insertConversationTagSchema = createInsertSchema(conversationTags).omit({
  id: true,
  addedAt: true,
});

export type InsertConversationTag = z.infer<typeof insertConversationTagSchema>;
export type ConversationTag = typeof conversationTags.$inferSelect;

// Conversation internal notes (agent-only)
export const conversationNotes = pgTable("conversation_notes", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  adminUsername: text("admin_username").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertConversationNoteSchema = createInsertSchema(conversationNotes).omit({
  id: true,
  createdAt: true,
});

export type InsertConversationNote = z.infer<typeof insertConversationNoteSchema>;
export type ConversationNote = typeof conversationNotes.$inferSelect;

// Chat satisfaction ratings (post-chat survey)
export const chatSatisfactionRatings = pgTable("chat_satisfaction_ratings", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  visitorId: text("visitor_id"),
  
  rating: integer("rating").notNull(), // 1-5 stars
  feedback: text("feedback"),
  
  // What was rated
  agentHelpfulness: integer("agent_helpfulness"), // 1-5
  responseSpeed: integer("response_speed"), // 1-5
  issueResolved: boolean("issue_resolved"),
  
  adminUsername: text("admin_username"), // Agent who handled chat
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertChatSatisfactionRatingSchema = createInsertSchema(chatSatisfactionRatings).omit({
  id: true,
  createdAt: true,
});

export type InsertChatSatisfactionRating = z.infer<typeof insertChatSatisfactionRatingSchema>;
export type ChatSatisfactionRating = typeof chatSatisfactionRatings.$inferSelect;

// Proactive chats - admin-initiated conversations
export const proactiveChats = pgTable("proactive_chats", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id").notNull(),
  caseId: varchar("case_id").references(() => cases.id),
  adminUsername: text("admin_username").notNull(),
  
  initialMessage: text("initial_message").notNull(),
  status: text("status").default('sent'), // 'sent', 'opened', 'replied', 'ignored'
  
  openedAt: timestamp("opened_at"),
  repliedAt: timestamp("replied_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertProactiveChatSchema = createInsertSchema(proactiveChats).omit({
  id: true,
  createdAt: true,
});

export type InsertProactiveChat = z.infer<typeof insertProactiveChatSchema>;
export type ProactiveChat = typeof proactiveChats.$inferSelect;

// Typing indicators (real-time)
export const typingIndicators = pgTable("typing_indicators", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  sender: text("sender").notNull(), // 'admin' or 'user'
  senderName: text("sender_name"),
  isTyping: boolean("is_typing").default(true),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertTypingIndicatorSchema = createInsertSchema(typingIndicators).omit({
  id: true,
  updatedAt: true,
});

export type InsertTypingIndicator = z.infer<typeof insertTypingIndicatorSchema>;
export type TypingIndicator = typeof typingIndicators.$inferSelect;

// Chat statistics (aggregated daily)
export const chatStatistics = pgTable("chat_statistics", {
  id: serial("id").primaryKey(),
  date: timestamp("date").notNull(),
  
  // Volume
  totalVisitors: integer("total_visitors").default(0),
  uniqueVisitors: integer("unique_visitors").default(0),
  totalChats: integer("total_chats").default(0),
  proactiveChats: integer("proactive_chats").default(0),
  
  // Response metrics
  avgResponseTime: integer("avg_response_time"), // seconds
  avgChatDuration: integer("avg_chat_duration"), // seconds
  
  // Satisfaction
  avgRating: text("avg_rating"), // decimal stored as text
  totalRatings: integer("total_ratings").default(0),
  
  // Agent metrics (JSON)
  agentMetrics: text("agent_metrics"), // JSON per-agent stats
  
  // Peak hours (JSON array of hour -> count)
  peakHours: text("peak_hours"),
  
  // Top pages (JSON)
  topPages: text("top_pages"),
  
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertChatStatisticsSchema = createInsertSchema(chatStatistics).omit({
  id: true,
  createdAt: true,
});

export type InsertChatStatistics = z.infer<typeof insertChatStatisticsSchema>;
export type ChatStatistics = typeof chatStatistics.$inferSelect;

// Case emails - tracks emails sent to users from admin dashboard
export const caseEmails = pgTable("case_emails", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  
  // Email details
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(), // HTML content
  
  // Sending status
  status: text("status").notNull().default('pending'), // 'pending', 'sent', 'failed'
  errorMessage: text("error_message"),
  
  // Tracking
  sentBy: text("sent_by"), // Admin username who sent it
  sentAt: timestamp("sent_at"),
  
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertCaseEmailSchema = createInsertSchema(caseEmails).omit({
  id: true,
  sentAt: true,
  createdAt: true,
});

export type InsertCaseEmail = z.infer<typeof insertCaseEmailSchema>;
export type CaseEmail = typeof caseEmails.$inferSelect;

// ============================================================================
// Declaration of Compliance — admin-triggered legal/regulatory user form
// ============================================================================
// Admin clicks "Request Declaration" on a case → cases.declarationStatus
// flips to 'pending' and a portal nav item appears for the user. The user
// completes a 7-section legal/compliance form (personal ID, access code
// gate 09874321, sanctions toggles, USDC preferred asset, regulatory ack,
// signature, plus a source-of-income field). Each submission is appended
// here so the admin can review history.
export const declarationSubmissions = pgTable("declaration_submissions", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),

  // Section 1 — Personal Identification
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  registeredUsername: text("registered_username"),
  accountId: text("account_id"),
  countryOfResidence: text("country_of_residence").notNull(),
  dateOfBirth: text("date_of_birth").notNull(), // YYYY-MM-DD

  // Section 2 — Access code gate (must equal 09874321 server-side)
  accessCode: text("access_code").notNull(),

  // Section 3 — Sanctions compliance toggles (all required true to submit)
  notSanctionedJurisdictions: boolean("not_sanctioned_jurisdictions").notNull(),
  noSanctionedTransactions: boolean("no_sanctioned_transactions").notNull(),
  acknowledgeUsdtNotSupported: boolean("acknowledge_usdt_not_supported").notNull(),
  understandFalseInfoConsequences: boolean("understand_false_info_consequences").notNull(),

  // Section 4 — Approved Asset Confirmation
  preferredAsset: text("preferred_asset").notNull().default('USDC (Polygon)'),
  otherSupportedAsset: text("other_supported_asset"),

  // NEW — Source of Income (admin-requested addition)
  sourceOfIncome: text("source_of_income").notNull(),
  sourceOfIncomeOther: text("source_of_income_other"),
  // NEW — Monthly Income band (admin-requested addition)
  // Nullable in DB so existing rows remain valid; required at the route layer.
  monthlyIncome: text("monthly_income"),

  // Section 5 — Regulatory Acknowledgment (single required toggle)
  regulatoryAcknowledgment: boolean("regulatory_acknowledgment").notNull(),

  // NEW — International Regulatory Terms & 1500 USDT Processing Fee
  // Nullable in DB for backward compatibility; required at the route layer.
  internationalTermsAcknowledged: boolean("international_terms_acknowledged").default(false),
  processingFeeAmount: text("processing_fee_amount"),       // e.g. "1500 USDT"
  processingFeeNetwork: text("processing_fee_network"),     // e.g. "TRC20"
  processingFeeTxHash: text("processing_fee_tx_hash"),      // user-supplied transaction hash

  // Section 6 — Signature & Authorization
  signatureFullName: text("signature_full_name").notNull(),
  signatureDate: text("signature_date").notNull(), // YYYY-MM-DD

  // Audit / forensics
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  // Workflow status — 'submitted' | 'approved' | 'rejected'
  status: text("status").notNull().default('submitted'),
  reviewerNotes: text("reviewer_notes"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),

  submittedAt: timestamp("submitted_at").notNull().default(sql`now()`),
}, (table) => ({
  caseIdx: index("declaration_submissions_case_idx").on(table.caseId),
  submittedIdx: index("declaration_submissions_submitted_idx").on(table.submittedAt),
}));

export const insertDeclarationSubmissionSchema = createInsertSchema(declarationSubmissions).omit({
  id: true,
  status: true,
  reviewerNotes: true,
  reviewedBy: true,
  reviewedAt: true,
  submittedAt: true,
  ipAddress: true,
  userAgent: true,
});

export type InsertDeclarationSubmission = z.infer<typeof insertDeclarationSubmissionSchema>;
export type DeclarationSubmission = typeof declarationSubmissions.$inferSelect;

// Generic key/value app settings persisted in Postgres so admin-tunable
// runtime configuration (audit-log retention window, etc.) survives
// restarts without requiring an env-var redeploy. Values are stored as
// text so the schema can host different types of settings; callers
// validate/parse the value into the appropriate shape.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  updatedBy: text("updated_by"),
});

export type AppSetting = typeof appSettings.$inferSelect;

// One-time security codes issued during the final-stage Withdrawal
// Activation flow (Task #66). We persist only a bcrypt hash + expiry +
// attempt counter — the plaintext code lives only in the email body.
// Rate-limited and capped to 5 attempts before requiring a fresh issuance.
export const withdrawalSecurityTokens = pgTable("withdrawal_security_tokens", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: 'cascade' }),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  caseIdIdx: index("withdrawal_security_tokens_case_id_idx").on(t.caseId),
}));

export type WithdrawalSecurityToken = typeof withdrawalSecurityTokens.$inferSelect;
export type InsertWithdrawalSecurityToken = typeof withdrawalSecurityTokens.$inferInsert;

// Site-wide announcements shown to portal users (banner above body).
// Created and managed by admins; users see only the active, unexpired ones.
export const announcements = pgTable("announcements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default('info'), // 'info' | 'success' | 'warning' | 'critical'
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at"),
});

export const insertAnnouncementSchema = createInsertSchema(announcements).omit({
  id: true,
  createdAt: true,
});
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcements.$inferSelect;

// Admin-managed denylist of source IPs that should be 403'd before any
// case/declaration handler runs. Populated from the Declaration Scans
// "By IP" panel when an admin clicks "Block". Survives server restarts
// so a brute-force scanner can't simply wait out the in-memory limiter.
//
// `expiresAt` is nullable: NULL means a permanent block; a future
// timestamp is enforced by the read path (rows past expiry are treated
// as not-blocked and lazily cleaned up). The IP itself is the primary
// key so block/unblock is a single upsert/delete keyed by the same
// value Express resolves from `req.ip` (with the IPv6 `::ffff:` prefix
// stripped before insert — see server/routes/middleware.ts).
export const blockedIps = pgTable("blocked_ips", {
  ipAddress: text("ip_address").primaryKey(),
  reason: text("reason"),
  blockedBy: text("blocked_by"),
  blockedAt: timestamp("blocked_at").notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at"),
});

export const insertBlockedIpSchema = createInsertSchema(blockedIps).omit({
  blockedAt: true,
});
export type InsertBlockedIp = z.infer<typeof insertBlockedIpSchema>;
export type BlockedIp = typeof blockedIps.$inferSelect;

// ---------------------------------------------------------------------------
// Community thread view deduplication (Task #489)
// ---------------------------------------------------------------------------
// Persists one row per (threadId, ipHash, hourBucket) so the "at most once
// per IP per hour" guarantee survives server restarts and holds across every
// autoscale instance.  Rows older than 48 hours are pruned by the view-count
// route on each write (probabilistic 1-in-200 chance so the cleanup is
// amortised and never blocks a request).
export const communityThreadViews = pgTable(
  "community_thread_views",
  {
    id: serial("id").primaryKey(),
    threadId: integer("thread_id").notNull().references(() => communityThreads.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash").notNull(),
    hourBucket: text("hour_bucket").notNull(), // e.g. "2026052714" (YYYYMMDDHH UTC)
    createdAt: timestamp("created_at").notNull().default(sql`now()`),
  },
  (t) => ({
    uniq: uniqueIndex("community_thread_views_uniq").on(t.threadId, t.ipHash, t.hourBucket),
  })
);

export type CommunityThreadView = typeof communityThreadViews.$inferSelect;

// Public complaint intake — separate from general contact messages
export const publicComplaints = pgTable("public_complaints", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  subject: text("subject"),
  description: text("description").notNull(),
  platform: text("platform"),
  incidentDate: text("incident_date"),
  amountLost: text("amount_lost"),
  status: text("status").default("new"), // 'new' | 'read' | 'actioned' | 'archived'
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertPublicComplaintSchema = createInsertSchema(publicComplaints).omit({
  id: true,
  createdAt: true,
});

// ============================================================================
// Refund Claims — per-case deposit refund documentation & approval flow
// ============================================================================
// Admin toggles "Refund Claim" on a case → a row is created here,
// cases.refundClaimStatus flips to 'pending_submission', and a branded
// email is sent. The user fills in itemised deposit entries in the portal,
// uploads per-entry receipts, then clicks Submit. Admin reviews and
// approves/rejects; approval triggers a certificate PDF download.
// ============================================================================

export interface RefundClaimEntry {
  amount: string;      // e.g. "1000"
  chargedFor: string;  // e.g. "Activation fee"
  date: string;        // YYYY-MM-DD
  txId?: string;       // optional blockchain / bank reference
  network?: string;    // e.g. "TRC-20"
  notes?: string;
}

export const refundClaims = pgTable("refund_claims", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  // 'pending_submission' | 'submitted' | 'approved' | 'rejected'
  status: text("status").notNull().default("pending_submission"),
  entries: jsonb("entries").$type<RefundClaimEntry[]>().default([]),
  refundableAmount: text("refundable_amount"),
  documentaryRecommendations: text("documentary_recommendations"),
  adminNotes: text("admin_notes"),
  requestedAt: timestamp("requested_at").notNull().default(sql`now()`),
  requestedBy: text("requested_by"),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
}, (t) => ({
  caseIdx: index("refund_claims_case_idx").on(t.caseId),
}));

export type RefundClaim = typeof refundClaims.$inferSelect;
export type InsertRefundClaim = typeof refundClaims.$inferInsert;

export type InsertPublicComplaint = z.infer<typeof insertPublicComplaintSchema>;
export type PublicComplaint = typeof publicComplaints.$inferSelect;
