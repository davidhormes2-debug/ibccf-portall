// ── Centralized compile-time schema guards for test mocks ─────────────────────
//
// WHY THIS FILE EXISTS
// Many test files in this folder hand-roll plain JavaScript objects that mimic
// Drizzle table row/column shapes (e.g. `dbCaseRow = { isDisabled, forceLogoutAt,
// accessCode }`, storage-mock return values, seeded receipt/document rows). If a
// column is renamed in `shared/schema.ts`, those hand-rolled mocks would drift
// silently because nothing ties their keys back to the schema.
//
// The per-file test suites carry inline `declare const _guard: Pick<...>` blocks
// for local documentation, but the root `tsconfig.json` EXCLUDES `**/*.test.ts`
// from `npm run check` — so guards living inside `*.test.ts` files are never
// actually typechecked. This module is a plain `.ts` file (NOT `*.test.ts`), so:
//   • `npm run check` (root `tsc`) DOES include and typecheck it, and
//   • Vitest IGNORES it (its `include` glob only matches `*.test.ts`).
//
// As a result, the guards below are the authoritative, enforced protection: if
// any referenced column is renamed in `shared/schema.ts`, `Pick<>` fails its
// `keyof` constraint and `npm run check` reports an error here. Keep each guard's
// column list in sync with the columns the named test file's mocks reference.
//
// This file emits no runtime code (only `import type` + ambient `declare const`).

import type {
  cases as CasesTable,
  accessKeyRequests as AccessKeyRequestsTable,
  letterReissues as LetterReissuesTable,
  depositReceipts as DepositReceiptsTable,
  certificateFeePayments as CertificateFeePaymentsTable,
  stampDutyReceipts as StampDutyReceiptsTable,
  newsletterSubscribers as NewsletterSubscribersTable,
  caseNdas as CaseNdasTable,
  documentRequests as DocumentRequestsTable,
  withdrawalRequests as WithdrawalRequestsTable,
  communityParticipants as CommunityParticipantsTable,
  communityThreads as CommunityThreadsTable,
  communityPosts as CommunityPostsTable,
  communityReactions as CommunityReactionsTable,
  communityThreadViews as CommunityThreadViewsTable,
  earnedBadges as EarnedBadgesTable,
  botProfiles as BotProfilesTable,
} from "@shared/schema";

// portalAuthHardening.test.ts — dbCaseRow + storage mock returns (cases)
declare const _portalAuthHardeningCases: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "isDisabled"
  | "forceLogoutAt"
  | "userPin"
  | "status"
  | "userName"
  | "withdrawalStage"
>;
// portalAuthHardening.test.ts — access-key-request insert mock (access_key_requests)
declare const _portalAuthHardeningAccessKeyRequests: Pick<
  typeof AccessKeyRequestsTable,
  | "id"
  | "requestId"
  | "generatedKey"
  | "status"
  | "userName"
  | "userEmail"
  | "userPhone"
  | "requestReason"
  | "caseId"
  | "expiresAt"
>;

// financialSignatory.test.ts — dbCaseRow + baseCase (cases)
declare const _financialSignatoryCases: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "isDisabled"
  | "forceLogoutAt"
  | "userName"
  | "userEmail"
  | "status"
  | "sealedAt"
  | "preferredLocale"
>;

// loginPin.reauth.test.ts — getCaseByAccessCode mock (cases)
declare const _loginPinReauthCases: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "userPin"
  | "isDisabled"
  | "status"
  | "userName"
  | "withdrawalStage"
>;

// deposits.unifiedUpload.test.ts — getCaseById mock (cases)
declare const _depositsUnifiedUploadCases: Pick<
  typeof CasesTable,
  "id" | "accessCode"
>;
// deposits.unifiedUpload.test.ts — baseReissue (letter_reissues)
declare const _depositsUnifiedUploadLetterReissues: Pick<
  typeof LetterReissuesTable,
  "id" | "caseId" | "version" | "reissueFee" | "status" | "receiptId" | "paidAt"
>;
// deposits.unifiedUpload.test.ts — depositRows (deposit_receipts)
declare const _depositsUnifiedUploadDepositReceipts: Pick<
  typeof DepositReceiptsTable,
  | "id"
  | "caseId"
  | "status"
  | "category"
  | "reissueId"
  | "fileName"
  | "notes"
  | "adminNotes"
  | "uploadedAt"
>;
// deposits.unifiedUpload.test.ts — certRows (certificate_fee_payments)
declare const _depositsUnifiedUploadCertificateFeePayments: Pick<
  typeof CertificateFeePaymentsTable,
  | "id"
  | "caseId"
  | "status"
  | "amountUsdt"
  | "fileName"
  | "notes"
  | "adminNotes"
  | "reviewedAt"
  | "reviewedBy"
  | "uploadedAt"
>;
// deposits.unifiedUpload.test.ts — stampRows (stamp_duty_receipts)
declare const _depositsUnifiedUploadStampDutyReceipts: Pick<
  typeof StampDutyReceiptsTable,
  | "id"
  | "caseId"
  | "status"
  | "amountUsdt"
  | "fileName"
  | "notes"
  | "adminNotes"
  | "reviewedAt"
  | "reviewedBy"
  | "uploadedAt"
>;

// newsletterSubscriberDelete.test.ts — deleteNewsletterSubscriber mock (newsletter_subscribers)
declare const _newsletterSubscriberDeleteNewsletterSubscribers: Pick<
  typeof NewsletterSubscribersTable,
  "id" | "email"
>;

// portalReadAuth.test.ts — dbCaseRow (cases)
declare const _portalReadAuthCases: Pick<
  typeof CasesTable,
  "isDisabled" | "forceLogoutAt" | "accessCode"
>;

// deposits.sessionRevocationAfterCodeRotation.test.ts — dbCaseRow (cases)
declare const _depositsSessionRevocationCases: Pick<
  typeof CasesTable,
  "isDisabled" | "forceLogoutAt" | "accessCode" | "sealedAt"
>;

// nda.test.ts — baseCase (cases)
declare const _ndaCases: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "userName"
  | "userEmail"
  | "status"
  | "withdrawalStage"
  | "withdrawalAmount"
  | "payoutWalletAddress"
  | "payoutWalletAsset"
  | "payoutWalletNetwork"
  | "sealedAt"
  | "sealedBy"
  | "stampDutyEnabled"
  | "stampDutyStatus"
>;
// nda.test.ts — storedNda (case_ndas)
declare const _ndaCaseNdas: Pick<
  typeof CaseNdasTable,
  | "id"
  | "caseId"
  | "templateVersion"
  | "signedName"
  | "signedAt"
  | "contentHash"
  | "signedPdfBase64"
>;

// englishOnlySigning.test.ts — baseCase (cases)
declare const _englishOnlySigningCases: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "userName"
  | "userEmail"
  | "status"
  | "withdrawalStage"
  | "withdrawalAmount"
  | "payoutWalletAddress"
  | "payoutWalletAsset"
  | "payoutWalletNetwork"
  | "preferredLocale"
  | "stampDutyEnabled"
  | "sealedAt"
  | "sealedBy"
  | "ndaEnabled"
>;

// cases.withdrawalGuide.test.ts — baseCase (cases)
declare const _withdrawalGuideCases: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "userName"
  | "userEmail"
  | "userMobile"
  | "userPin"
  | "status"
  | "letterSent"
  | "isDisabled"
  | "withdrawalGuideVisible"
  | "payoutWalletAddress"
  | "payoutWalletAsset"
  | "payoutWalletNetwork"
  | "payoutWalletNote"
  | "payoutWalletVerifiedAt"
  | "payoutWalletVerifiedBy"
  | "sealedAt"
  | "sealedBy"
  | "preferredLocale"
>;

// declarationAttachments.test.ts — baseCase + case-row mock (cases)
declare const _declarationAttachmentsCases: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "userName"
  | "userEmail"
  | "status"
  | "declarationStatus"
  | "declarationAccessCode"
  | "declarationAccessExpiresAt"
  | "isDisabled"
  | "forceLogoutAt"
>;
// declarationAttachments.test.ts — document_requests seed data (document_requests)
declare const _declarationAttachmentsDocumentRequests: Pick<
  typeof DocumentRequestsTable,
  | "id"
  | "caseId"
  | "documentType"
  | "status"
  | "submittedFileName"
  | "submittedAt"
>;

// withdrawalRequests.test.ts — beforeCase (cases)
declare const _withdrawalRequestsCases: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "userPin"
  | "userEmail"
  | "sealedAt"
  | "withdrawalWindowEnabled"
>;
// withdrawalRequests.test.ts — lastInsertedRequest (withdrawal_requests)
declare const _withdrawalRequestsWithdrawalRequests: Pick<
  typeof WithdrawalRequestsTable,
  "id" | "caseId" | "status" | "amount" | "asset" | "network"
>;

// communitySessionRevocation.test.ts — community table mocks
declare const _communitySessionRevocationParticipants: Pick<
  typeof CommunityParticipantsTable,
  "caseId" | "id"
>;
declare const _communitySessionRevocationThreads: Pick<
  typeof CommunityThreadsTable,
  "id" | "authorHandle" | "authorType"
>;
declare const _communitySessionRevocationPosts: Pick<
  typeof CommunityPostsTable,
  "threadId" | "authorHandle" | "authorType"
>;

// communityParticipantsRace.test.ts — communityParticipants mock
declare const _communityParticipantsRaceParticipants: Pick<
  typeof CommunityParticipantsTable,
  "caseId"
>;

// communityThreadSearch.test.ts — communityThreads mock
declare const _communityThreadSearchThreads: Pick<
  typeof CommunityThreadsTable,
  | "id"
  | "departmentId"
  | "title"
  | "content"
  | "authorType"
  | "authorHandle"
  | "isPinned"
  | "isLocked"
  | "viewCount"
  | "replyCount"
  | "lastActivityAt"
  | "createdAt"
>;

// communityThreadViewDedup.test.ts — community table mocks
declare const _communityThreadViewDedupThreads: Pick<
  typeof CommunityThreadsTable,
  | "id"
  | "departmentId"
  | "title"
  | "content"
  | "authorType"
  | "authorHandle"
  | "isPinned"
  | "isLocked"
  | "viewCount"
  | "replyCount"
  | "lastActivityAt"
  | "createdAt"
>;
declare const _communityThreadViewDedupPosts: Pick<
  typeof CommunityPostsTable,
  "threadId" | "isHidden" | "createdAt"
>;
declare const _communityThreadViewDedupThreadViews: Pick<
  typeof CommunityThreadViewsTable,
  "id" | "threadId" | "ipHash" | "hourBucket" | "createdAt"
>;

// community.sessionRevocationAfterCodeRotation.test.ts — community + cases mocks
declare const _communitySessionRevocationAfterRotationCases: Pick<
  typeof CasesTable,
  "id" | "isDisabled" | "forceLogoutAt" | "accessCode"
>;
declare const _communitySessionRevocationAfterRotationParticipants: Pick<
  typeof CommunityParticipantsTable,
  "caseId" | "id" | "postCount"
>;
declare const _communitySessionRevocationAfterRotationThreads: Pick<
  typeof CommunityThreadsTable,
  "id" | "isLocked" | "replyCount" | "authorHandle" | "authorType" | "lastActivityAt"
>;
declare const _communitySessionRevocationAfterRotationPosts: Pick<
  typeof CommunityPostsTable,
  "threadId" | "authorHandle" | "authorType" | "isHidden" | "createdAt"
>;

// community.reactRevocationAfterCodeRotation.test.ts — community + cases mocks
declare const _communityReactRevocationAfterRotationCases: Pick<
  typeof CasesTable,
  "id" | "isDisabled" | "forceLogoutAt" | "accessCode"
>;
declare const _communityReactRevocationAfterRotationParticipants: Pick<
  typeof CommunityParticipantsTable,
  "caseId" | "id" | "postCount"
>;
declare const _communityReactRevocationAfterRotationThreads: Pick<
  typeof CommunityThreadsTable,
  "id" | "isLocked" | "replyCount" | "authorHandle" | "authorType" | "lastActivityAt"
>;
declare const _communityReactRevocationAfterRotationPosts: Pick<
  typeof CommunityPostsTable,
  "id" | "threadId" | "authorHandle" | "authorType" | "isHidden" | "createdAt" | "likeCount"
>;
declare const _communityReactRevocationAfterRotationReactions: Pick<
  typeof CommunityReactionsTable,
  "postId" | "participantId"
>;

// community.threadsRevocationAfterCodeRotation.test.ts — community + cases mocks
declare const _communityThreadsRevocationAfterRotationCases: Pick<
  typeof CasesTable,
  "id" | "isDisabled" | "forceLogoutAt" | "accessCode"
>;
declare const _communityThreadsRevocationAfterRotationParticipants: Pick<
  typeof CommunityParticipantsTable,
  "caseId" | "id" | "postCount"
>;
declare const _communityThreadsRevocationAfterRotationThreads: Pick<
  typeof CommunityThreadsTable,
  "id" | "isLocked" | "replyCount" | "authorHandle" | "authorType" | "lastActivityAt"
>;
declare const _communityThreadsRevocationAfterRotationPosts: Pick<
  typeof CommunityPostsTable,
  "id" | "threadId" | "authorHandle" | "authorType" | "isHidden" | "createdAt" | "likeCount"
>;
declare const _communityThreadsRevocationAfterRotationReactions: Pick<
  typeof CommunityReactionsTable,
  "postId" | "participantId"
>;

// documentRequests.sessionRevocationAfterCodeRotation.test.ts — cases + document_requests mocks
declare const _documentRequestsRevocationAfterRotationCases: Pick<
  typeof CasesTable,
  "id" | "isDisabled" | "forceLogoutAt" | "accessCode"
>;
declare const _documentRequestsRevocationAfterRotationDocRequests: Pick<
  typeof DocumentRequestsTable,
  | "id"
  | "caseId"
  | "documentType"
  | "status"
  | "submittedFileData"
  | "submittedFileName"
  | "submittedAt"
>;

// admin.communityViewsOverTime.test.ts — communityThreadViews mock
declare const _adminCommunityViewsOverTimeThreadViews: Pick<
  typeof CommunityThreadViewsTable,
  "id" | "threadId" | "ipHash" | "hourBucket" | "createdAt"
>;

// communityParticipantCleanup.test.ts — in-memory db mock column shapes
declare const _communityParticipantCleanupCases: Pick<
  typeof CasesTable,
  "id" | "status" | "sealedAt" | "updatedAt"
>;
declare const _communityParticipantCleanupParticipants: Pick<
  typeof CommunityParticipantsTable,
  "id" | "caseId" | "anonymousHandle"
>;
declare const _communityParticipantCleanupReactions: Pick<
  typeof CommunityReactionsTable,
  "id" | "participantId"
>;
declare const _communityParticipantCleanupEarnedBadges: Pick<
  typeof EarnedBadgesTable,
  "id" | "participantId"
>;

// communityStats.test.ts — vi.mock("@shared/schema", ...) column shapes
// NOTE: the mock object also sets `updatedAt` on the communityThreads shape,
// but communityThreads has NO `updatedAt` column in shared/schema.ts — adding
// it here would break `npm run check` with a Pick<> key-constraint error.
// That extra mock key is an internal test artefact with no schema counterpart,
// so there is nothing to drift-protect against.
declare const _communityStatsThreads: Pick<
  typeof CommunityThreadsTable,
  | "id"
  | "viewCount"
  | "departmentId"
  | "title"
  | "content"
  | "authorType"
  | "authorHandle"
  | "isPinned"
  | "isLocked"
  | "replyCount"
  | "lastActivityAt"
  | "createdAt"
>;
declare const _communityStatsPosts: Pick<
  typeof CommunityPostsTable,
  "id" | "threadId" | "isHidden" | "createdAt"
>;
declare const _communityStatsParticipants: Pick<
  typeof CommunityParticipantsTable,
  "id" | "caseId" | "anonymousHandle" | "postCount"
>;
declare const _communityStatsThreadViews: Pick<
  typeof CommunityThreadViewsTable,
  "id" | "threadId" | "ipHash" | "hourBucket"
>;
declare const _communityStatsBotProfiles: Pick<
  typeof BotProfilesTable,
  "isActive"
>;

// communityThreadViewsCleanup.test.ts — vi.mock("@shared/schema", ...) column shapes
declare const _communityThreadViewsCleanupThreadViews: Pick<
  typeof CommunityThreadViewsTable,
  "id" | "threadId" | "ipHash" | "hourBucket" | "createdAt"
>;
