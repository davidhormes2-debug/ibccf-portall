import { 
  type Case, type InsertCase, cases,
  type UserDocument, userDocuments,
  type CaseEmail, type InsertCaseEmail, caseEmails,
  type CaseLetter, type UpdateCaseLetter, caseLetters,
  type CaseSubmission, type InsertCaseSubmission, caseSubmissions,
  type ChatMessage, type InsertChatMessage, chatMessages,
  type AdminMessage, type InsertAdminMessage, adminMessages,
  type DepositReceipt, type InsertDepositReceipt, depositReceipts,
  type LetterReissue, type InsertLetterReissue, letterReissues,
  type ActivityLog, type InsertActivityLog, activityLogs,
  type AuditLog, type InsertAuditLog, auditLogs,
  type MessageTemplate, type InsertMessageTemplate, messageTemplates,
  type DocumentRequest, type InsertDocumentRequest, documentRequests,
  type UserSession, type InsertUserSession, userSessions,
  type ScheduledMessage, type InsertScheduledMessage, scheduledMessages,
  type HelpArticle, type InsertHelpArticle, helpArticles,
  type Notification, type InsertNotification, notifications,
  type UserFeedback, type InsertUserFeedback, userFeedback,
  type AdminSession, type InsertAdminSession, adminSessions,
  type AdminMirrorToken, type InsertAdminMirrorToken, adminMirrorTokens,
  type PortalSession, type InsertPortalSession, portalSessions,
  type AdminLoginAttempt, adminLoginAttempts,
  satisfactionTokenNonces,
  type AdminTwoFactor, type InsertAdminTwoFactor, adminTwoFactor,
  type ChatTemplate, type InsertChatTemplate, chatTemplates,
  type CaseNote, type InsertCaseNote, caseNotes,
  type Translation, type InsertTranslation, translations,
  type NewsletterSubscriber, type InsertNewsletterSubscriber, newsletterSubscribers,
  type ScamAlert, type InsertScamAlert, scamAlerts,
  type Testimonial, type InsertTestimonial, testimonials,
  type SiteStatistic, type InsertSiteStatistic, siteStatistics,
  type ContactSubmission, type InsertContactSubmission, contactSubmissions,
  type PublicComplaint, type InsertPublicComplaint, publicComplaints,
  type FaqItem, type InsertFaqItem, faqItems,
  type ActiveVisitor, type InsertActiveVisitor, activeVisitors,
  type VisitorHistory, type InsertVisitorHistory, visitorHistory,
  type BlockedVisitor, type InsertBlockedVisitor, blockedVisitors,
  type AdminAvailability, type InsertAdminAvailability, adminAvailability,
  type OfflineMessage, type InsertOfflineMessage, offlineMessages,
  type ChatSatisfactionRating, type InsertChatSatisfactionRating, chatSatisfactionRatings,
  type DeclarationSubmission, type InsertDeclarationSubmission, declarationSubmissions,
  type WithdrawalRequest, type InsertWithdrawalRequest, withdrawalRequests,
  type CaseLedgerEntry, type InsertCaseLedgerEntry, caseLedgerEntries,
  type CaseNda, type InsertCaseNda, caseNdas,
  type AppSetting, appSettings,
  type CertificateFeePayment, type InsertCertificateFeePayment, certificateFeePayments,
  type StampDutyReceipt, type InsertStampDutyReceipt, stampDutyReceipts,
  type SessionRefreshReceipt, type InsertSessionRefreshReceipt, sessionRefreshReceipts,
  type BlockedIp, type InsertBlockedIp, blockedIps,
  type WithdrawalSecurityToken, type InsertWithdrawalSecurityToken, withdrawalSecurityTokens,
  communityParticipants,
  communityThreadViews,
  type RefundClaim, refundClaims,
  type AdminUser, type InsertAdminUser, adminUsers,
} from "@shared/schema";
import { db, type DbExecutor } from "./db";
import { eq, desc, and, lt, gt, or, isNull, isNotNull, sql, ne, inArray, gte, asc, ilike, count } from "drizzle-orm";

// Params for server-side paginated/filtered case listing (Task #2443).
// `search` matches (case-insensitively) against caseRef, accessCode,
// userName, and userEmail. `status`/`locale`/`sealed` are exact-match
// filters; omit or pass "all" to skip a filter.
export interface CasesPageParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  locale?: string;
  sealed?: "sealed" | "open";
}

export interface FailedAdminLoginByIp {
  ipAddress: string;
  attemptCount: number;
  badPasswordCount: number;
  throttledCount: number;
  distinctUsernames: string[];
  firstAttemptAt: Date;
  lastAttemptAt: Date;
  isThrottled: boolean;
}

// Per-IP rollup of unauthorized declaration-read attempts. Mirrors
// FailedAdminLoginByIp but groups the audit rows written by the GET
// /api/cases/:id/declaration brute-force trap (Task #109).
//
// `credentialTypeCounts` is a sparse map of the JSON-encoded credentialType
// (e.g. "none", "wrong_code", "wrong_session", "expired_code",
// "case_missing") to its count within the window — gives the dashboard a
// quick read of what an attacker is iterating on without needing to load
// every individual row.
export interface DeclarationReadByIp {
  ipAddress: string;
  attemptCount: number;
  unauthorizedCount: number;
  rateLimitedCount: number;
  distinctCaseCount: number;
  distinctCaseIds: string[];
  credentialTypeCounts: Record<string, number>;
  firstAttemptAt: Date;
  lastAttemptAt: Date;
  isThrottled: boolean;
}

export interface IStorage {
  // Case operations
  createCase(data: InsertCase): Promise<Case>;
  getCaseById(id: string): Promise<Case | undefined>;
  getCaseByAccessCode(accessCode: string): Promise<Case | undefined>;
  getCaseByPin(hashedPin: string): Promise<Case | undefined>;
  getAllCases(): Promise<Case[]>;
  getCasesPage(params: CasesPageParams): Promise<{ cases: Case[]; total: number }>;
  updateCase(id: string, data: Partial<InsertCase>, executor?: DbExecutor): Promise<Case | undefined>;
  deleteCase(id: string, executor?: DbExecutor): Promise<void>;
  runInTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
  
  // Case letter operations
  getCaseLetterByCaseId(caseId: string): Promise<CaseLetter | undefined>;
  createOrUpdateCaseLetter(caseId: string, data: UpdateCaseLetter, executor?: DbExecutor): Promise<CaseLetter>;
  
  // Case submission operations
  createSubmission(data: InsertCaseSubmission): Promise<CaseSubmission>;
  getSubmissionsByCaseId(caseId: string): Promise<CaseSubmission[]>;
  getAllSubmissions(): Promise<CaseSubmission[]>;
  deleteSubmission(id: number): Promise<void>;
  
  // Case NDA operations
  getCaseNdaByCaseId(caseId: string): Promise<CaseNda | undefined>;
  createCaseNda(data: InsertCaseNda, executor?: DbExecutor): Promise<CaseNda>;
  getAllSealedCaseNdas(): Promise<CaseNda[]>;

  // Case email operations
  createCaseEmail(data: InsertCaseEmail, executor?: DbExecutor): Promise<CaseEmail>;
  getCaseEmailsByCaseId(caseId: string): Promise<CaseEmail[]>;
  getCaseEmailById(id: number): Promise<CaseEmail | undefined>;
  updateCaseEmailStatus(id: number, status: string, errorMessage?: string): Promise<CaseEmail | undefined>;
  
  // Chat message operations
  createChatMessage(data: InsertChatMessage): Promise<ChatMessage>;
  getChatMessagesByCaseId(caseId: string): Promise<ChatMessage[]>;
  markMessagesAsRead(caseId: string, sender: string): Promise<void>;
  getUnreadCount(caseId: string, sender: string): Promise<number>;
  
  // Admin message operations
  createAdminMessage(data: InsertAdminMessage): Promise<AdminMessage>;
  getAdminMessagesByCaseId(caseId: string): Promise<AdminMessage[]>;
  getAdminMessageById(id: number): Promise<AdminMessage | undefined>;
  updateAdminMessage(id: number, data: Partial<InsertAdminMessage>): Promise<AdminMessage | undefined>;
  deleteAdminMessage(id: number): Promise<void>;
  markAdminMessageAsRead(id: number): Promise<void>;
  getUnreadAdminMessagesCount(caseId: string): Promise<number>;
  
  // Deposit receipt operations
  createDepositReceipt(data: InsertDepositReceipt, executor?: DbExecutor): Promise<DepositReceipt>;
  getDepositReceiptsByCaseId(caseId: string): Promise<DepositReceipt[]>;
  getAllDepositReceipts(): Promise<DepositReceipt[]>;
  getDepositReceiptById(id: number): Promise<DepositReceipt | undefined>;
  updateDepositReceiptStatus(id: number, status: string, executor?: DbExecutor): Promise<DepositReceipt | undefined>;
  updateDepositReceipt(id: number, data: { status?: string; adminNotes?: string; imageData?: string; fileName?: string | null }, executor?: DbExecutor): Promise<DepositReceipt | undefined>;

  getReactivationPendingCounts(): Promise<Record<string, number>>;

  // Certificate fee payments (Task #70)
  createCertificateFeePayment(data: InsertCertificateFeePayment, executor?: DbExecutor): Promise<CertificateFeePayment>;
  getCertificateFeePaymentsByCaseId(caseId: string): Promise<CertificateFeePayment[]>;
  getAllCertificateFeePayments(): Promise<CertificateFeePayment[]>;
  getCertificateFeePaymentById(id: number): Promise<CertificateFeePayment | undefined>;
  createStampDutyReceipt(data: InsertStampDutyReceipt, executor?: DbExecutor): Promise<StampDutyReceipt>;
  getStampDutyReceiptsByCaseId(caseId: string): Promise<StampDutyReceipt[]>;
  getAllStampDutyReceipts(): Promise<StampDutyReceipt[]>;
  getStampDutyReceiptById(id: number): Promise<StampDutyReceipt | undefined>;
  updateStampDutyReceipt(
    id: number,
    data: { status?: string; adminNotes?: string | null; reviewedBy?: string | null; reviewedAt?: Date | null },
    executor?: DbExecutor,
  ): Promise<StampDutyReceipt | undefined>;
  updateCertificateFeePayment(
    id: number,
    data: { status?: string; adminNotes?: string | null; reviewedBy?: string | null; reviewedAt?: Date | null },
    executor?: DbExecutor,
  ): Promise<CertificateFeePayment | undefined>;

  // Session Refresh Deposit gate
  createSessionRefreshReceipt(data: InsertSessionRefreshReceipt, executor?: DbExecutor): Promise<SessionRefreshReceipt>;
  getSessionRefreshReceiptsByCaseId(caseId: string): Promise<SessionRefreshReceipt[]>;
  getSessionRefreshReceiptById(id: number): Promise<SessionRefreshReceipt | undefined>;
  updateSessionRefreshReceipt(
    id: number,
    data: { adminNotes?: string | null; reviewedBy?: string | null; reviewedAt?: Date | null },
    executor?: DbExecutor,
  ): Promise<SessionRefreshReceipt | undefined>;

  // Letter reissue operations — versioned history of reissued rounds
  createLetterReissue(data: InsertLetterReissue, executor?: DbExecutor): Promise<LetterReissue>;
  getLetterReissuesByCaseId(caseId: string): Promise<LetterReissue[]>;
  getActiveLetterReissue(caseId: string): Promise<LetterReissue | undefined>;
  getLetterReissueById(id: number): Promise<LetterReissue | undefined>;
  updateLetterReissue(
    id: number,
    data: Partial<{ status: string; receiptId: number | null; paidAt: Date | null; cancelledAt: Date | null; reissueFee: string; reason: string | null }>,
    executor?: DbExecutor,
  ): Promise<LetterReissue | undefined>;
  
  // Activity log operations
  createActivityLog(data: InsertActivityLog): Promise<ActivityLog>;
  getActivityLogsByCaseId(caseId: string): Promise<ActivityLog[]>;
  getAllActivityLogs(): Promise<ActivityLog[]>;
  
  // Audit log operations
  createAuditLog(data: InsertAuditLog, executor?: DbExecutor): Promise<AuditLog>;
  getAllAuditLogs(): Promise<AuditLog[]>;
  getEmergencyResetAuditLogs(limit: number): Promise<AuditLog[]>;
  getRecentFailedAdminLogins(limit: number): Promise<AuditLog[]>;
  getFailedAdminLoginCountSince(since: Date): Promise<number>;
  getRecentDeclarationReadAttempts(
    limit: number,
    ipAddress?: string,
  ): Promise<AuditLog[]>;
  getDeclarationReadAttemptCountSince(since: Date): Promise<number>;
  getLatestNdaIntegrityCheck(caseId: string): Promise<AuditLog | undefined>;
  getRecentEmailFailures(
    since: Date,
  ): Promise<
    Array<{
      caseId: string;
      tag: string;
      at: string;
      error: string | null;
      source: "audit" | "case_emails";
    }>
  >;
  getEmailAuditLogsForCase(caseId: string, limit?: number): Promise<AuditLog[]>;
  getAuditLogById(id: number): Promise<AuditLog | undefined>;
  getEmailDeliverySummaryForCases(
    caseIds: string[],
  ): Promise<
    Map<string, { pending: number; failed24h: number; lastFailureAt: string | null }>
  >;
  getLatestNdaIntegrityChecksForCases(caseIds: string[]): Promise<Map<string, AuditLog>>;
  getDeclarationReadAttemptsByIp(
    since: Date,
    throttleSince: Date,
    limit?: number,
  ): Promise<DeclarationReadByIp[]>;
  getFailedAdminLoginsByIp(
    since: Date,
    throttleSince: Date,
    limit?: number,
  ): Promise<FailedAdminLoginByIp[]>;
  pruneAuditLogsOlderThan(cutoff: Date): Promise<number>;
  pruneCommunityParticipantsForInactiveCases(cutoff: Date, batchSize?: number, executor?: DbExecutor): Promise<{
    removed: number;
    caseIds: string[];
  }>;
  countCommunityParticipantsForInactiveCases(cutoff: Date): Promise<number>;
  
  // Clear logs (preserves accounts)
  clearAllLogs(): Promise<void>;
  
  // Message template operations
  createMessageTemplate(data: InsertMessageTemplate): Promise<MessageTemplate>;
  getAllMessageTemplates(): Promise<MessageTemplate[]>;
  getMessageTemplatesByCategory(category: string): Promise<MessageTemplate[]>;
  updateMessageTemplate(id: number, data: Partial<InsertMessageTemplate>): Promise<MessageTemplate | undefined>;
  deleteMessageTemplate(id: number): Promise<void>;
  
  // User document operations (admin status management)
  getAllUserDocuments(filters?: { status?: string; caseId?: string }): Promise<Omit<UserDocument, 'fileData'>[]>;
  getUserDocumentsByCaseId(caseId: string): Promise<Omit<UserDocument, 'fileData'>[]>;
  getUserDocumentById(id: number): Promise<UserDocument | undefined>;
  updateUserDocument(id: number, data: Partial<Pick<UserDocument, 'status' | 'adminNotes' | 'reviewedAt' | 'reviewedBy'>>, tx?: DbExecutor): Promise<UserDocument | undefined>;
  getPendingUserDocumentCounts(): Promise<Record<string, number>>;

  // Document request operations
  createDocumentRequest(data: InsertDocumentRequest, executor?: DbExecutor): Promise<DocumentRequest>;
  getDocumentRequestsByCaseId(caseId: string): Promise<DocumentRequest[]>;
  getAllDocumentRequests(): Promise<DocumentRequest[]>;
  getDocumentRequestById(id: number): Promise<DocumentRequest | undefined>;
  updateDocumentRequest(id: number, data: Partial<InsertDocumentRequest>, executor?: DbExecutor): Promise<DocumentRequest | undefined>;
  archiveOldApprovedDocumentBlobs(cutoff: Date): Promise<number>;

  // User session operations
  createUserSession(data: InsertUserSession, executor?: DbExecutor): Promise<UserSession>;
  getUserSessionsByCaseId(caseId: string): Promise<UserSession[]>;
  getAllUserSessions(): Promise<UserSession[]>;
  invalidateUserSession(id: number): Promise<void>;
  invalidateAllUserSessions(caseId: string, executor?: DbExecutor): Promise<void>;
  deactivateUserSession(id: number, executor?: DbExecutor): Promise<UserSession | undefined>;
  
  // Scheduled message operations
  createScheduledMessage(data: InsertScheduledMessage): Promise<ScheduledMessage>;
  getScheduledMessagesByCaseId(caseId: string): Promise<ScheduledMessage[]>;
  getPendingScheduledMessages(): Promise<ScheduledMessage[]>;
  updateScheduledMessage(id: number, data: Partial<InsertScheduledMessage>): Promise<ScheduledMessage | undefined>;
  cancelScheduledMessage(id: number): Promise<ScheduledMessage | undefined>;
  
  // Help article operations
  createHelpArticle(data: InsertHelpArticle): Promise<HelpArticle>;
  getAllHelpArticles(): Promise<HelpArticle[]>;
  getHelpArticlesByCategory(category: string): Promise<HelpArticle[]>;
  getHelpArticleById(id: number): Promise<HelpArticle | undefined>;
  updateHelpArticle(id: number, data: Partial<InsertHelpArticle>): Promise<HelpArticle | undefined>;
  deleteHelpArticle(id: number): Promise<void>;
  
  // Notification operations
  createNotification(data: InsertNotification): Promise<Notification>;
  getNotificationById(id: number): Promise<Notification | undefined>;
  getNotificationsByRecipient(recipientType: string, recipientId: string): Promise<Notification[]>;
  markNotificationAsRead(id: number): Promise<void>;
  markAllNotificationsAsRead(recipientType: string, recipientId: string): Promise<void>;
  clearAllAdminNotifications(): Promise<void>;
  getUnreadNotificationCount(recipientType: string, recipientId: string): Promise<number>;
  
  // User feedback operations
  createUserFeedback(data: InsertUserFeedback): Promise<UserFeedback>;
  getUserFeedbackByCaseId(caseId: string): Promise<UserFeedback[]>;
  getAllUserFeedback(): Promise<UserFeedback[]>;
  
  // Admin session operations
  createAdminSession(data: InsertAdminSession, executor?: DbExecutor): Promise<AdminSession>;
  getAdminSessionsByUsername(username: string): Promise<AdminSession[]>;
  getAdminSessionByToken(token: string): Promise<AdminSession | undefined>;
  getActiveAdminSessions(username: string): Promise<AdminSession[]>;
  updateAdminSessionActivity(id: string): Promise<void>;
  revokeAdminSession(id: string, reason?: string, executor?: DbExecutor): Promise<void>;
  revokeAllAdminSessions(username: string, exceptId?: string, executor?: DbExecutor): Promise<number>;
  revokeNonCanonicalAdminSessions(canonicalUsername: string): Promise<number>;
  deleteExpiredAdminSessions(revokedRetentionDays?: number): Promise<number>;

  // Persistent backing for the admin-login rate limiter so 429 lockouts
  // survive a server restart (see middleware/security.ts).
  getActiveAdminLoginAttempts(): Promise<AdminLoginAttempt[]>;
  getAdminLoginAttemptByKey(key: string): Promise<AdminLoginAttempt | undefined>;
  clearAdminLoginAttemptKey(key: string): Promise<void>;
  // Atomic additive increment — count is always count+1, never GREATEST.
  // Returns the new count and resetAt so the caller can make the allow/deny
  // decision from a single authoritative DB round-trip without a separate read.
  atomicIncrementRateLimit(params: {
    key: string;
    windowResetAt: Date;
    lockoutResetAt?: Date;
    maxCount?: number;
  }): Promise<{ count: number; resetAt: Date }>;
  upsertAdminLoginAttempt(attempt: { key: string; count: number; resetAt: Date }): Promise<void>;
  deleteExpiredAdminLoginAttempts(): Promise<number>;

  // Admin 2FA operations
  getAdminTwoFactor(username: string): Promise<AdminTwoFactor | undefined>;
  createAdminTwoFactor(data: InsertAdminTwoFactor): Promise<AdminTwoFactor>;
  updateAdminTwoFactor(username: string, data: Partial<InsertAdminTwoFactor>): Promise<AdminTwoFactor | undefined>;
  deleteAdminTwoFactor(username: string): Promise<void>;
  
  // Chat template operations
  createChatTemplate(data: InsertChatTemplate): Promise<ChatTemplate>;
  getAllChatTemplates(): Promise<ChatTemplate[]>;
  getChatTemplatesByCategory(category: string): Promise<ChatTemplate[]>;
  updateChatTemplate(id: number, data: Partial<InsertChatTemplate>): Promise<ChatTemplate | undefined>;
  deleteChatTemplate(id: number): Promise<void>;
  incrementTemplateUsage(id: number): Promise<void>;
  
  // Case notes operations
  // Declaration of Compliance
  createDeclarationSubmission(data: InsertDeclarationSubmission & { ipAddress?: string; userAgent?: string }): Promise<DeclarationSubmission>;
  getDeclarationSubmissionsByCaseId(caseId: string): Promise<DeclarationSubmission[]>;
  getLatestDeclarationByCase(caseId: string): Promise<DeclarationSubmission | undefined>;
  getDeclarationSubmissionById(id: number): Promise<DeclarationSubmission | undefined>;
  listDeclarationSubmissions(opts?: { status?: string; limit?: number; offset?: number }): Promise<{ rows: DeclarationSubmission[]; total: number }>;
  updateDeclarationSubmissionStatus(id: number, status: string, reviewedBy: string, reviewerNotes?: string): Promise<DeclarationSubmission | undefined>;

  createCaseNote(data: InsertCaseNote): Promise<CaseNote>;
  getCaseNotesByCaseId(caseId: string): Promise<CaseNote[]>;
  updateCaseNote(id: number, data: Partial<InsertCaseNote>): Promise<CaseNote | undefined>;
  deleteCaseNote(id: number): Promise<void>;
  toggleCaseNotePin(id: number): Promise<CaseNote | undefined>;
  
  // Translation operations
  getTranslation(key: string, locale: string): Promise<Translation | undefined>;
  getTranslationsByLocale(locale: string): Promise<Translation[]>;
  createTranslation(data: InsertTranslation): Promise<Translation>;
  updateTranslation(id: number, data: Partial<InsertTranslation>): Promise<Translation | undefined>;
  deleteTranslation(id: number): Promise<void>;
  
  // Newsletter subscriber operations
  createNewsletterSubscriber(data: InsertNewsletterSubscriber): Promise<NewsletterSubscriber>;
  getAllNewsletterSubscribers(): Promise<NewsletterSubscriber[]>;
  unsubscribeNewsletter(email: string): Promise<void>;
  updateNewsletterSubscriber(
    id: number,
    data: Partial<Pick<NewsletterSubscriber, "email" | "isActive" | "unsubscribedAt">>,
  ): Promise<NewsletterSubscriber>;
  deleteNewsletterSubscriber(id: number): Promise<NewsletterSubscriber | undefined>;
  
  // Scam alert operations
  createScamAlert(data: InsertScamAlert): Promise<ScamAlert>;
  getActiveScamAlerts(): Promise<ScamAlert[]>;
  getAllScamAlerts(): Promise<ScamAlert[]>;
  updateScamAlert(id: number, data: Partial<InsertScamAlert>): Promise<ScamAlert | undefined>;
  deleteScamAlert(id: number): Promise<void>;
  
  // Testimonial operations
  createTestimonial(data: InsertTestimonial): Promise<Testimonial>;
  getApprovedTestimonials(): Promise<Testimonial[]>;
  getAllTestimonials(): Promise<Testimonial[]>;
  updateTestimonial(id: number, data: Partial<InsertTestimonial>): Promise<Testimonial | undefined>;
  deleteTestimonial(id: number): Promise<void>;
  
  // Site statistics operations
  getSiteStatistics(): Promise<SiteStatistic[]>;
  getSiteStatisticByKey(key: string): Promise<SiteStatistic | undefined>;
  createSiteStatistic(data: InsertSiteStatistic): Promise<SiteStatistic>;
  updateSiteStatistic(id: number, data: Partial<InsertSiteStatistic>): Promise<SiteStatistic | undefined>;
  
  // Contact submission operations
  createContactSubmission(data: InsertContactSubmission): Promise<ContactSubmission>;
  getAllContactSubmissions(): Promise<ContactSubmission[]>;
  updateContactSubmission(id: number, data: Partial<InsertContactSubmission>): Promise<ContactSubmission | undefined>;

  // Public complaint intake operations
  createPublicComplaint(data: InsertPublicComplaint): Promise<PublicComplaint>;
  getAllPublicComplaints(): Promise<PublicComplaint[]>;
  updatePublicComplaint(id: number, data: Partial<InsertPublicComplaint>): Promise<PublicComplaint | undefined>;
  deletePublicComplaint(id: number): Promise<void>;
  
  // FAQ operations
  createFaqItem(data: InsertFaqItem): Promise<FaqItem>;
  getActiveFaqItems(): Promise<FaqItem[]>;
  getAllFaqItems(): Promise<FaqItem[]>;
  updateFaqItem(id: number, data: Partial<InsertFaqItem>): Promise<FaqItem | undefined>;
  deleteFaqItem(id: number): Promise<void>;
  
  // Active visitor operations
  createActiveVisitor(data: InsertActiveVisitor): Promise<ActiveVisitor>;
  getActiveVisitors(): Promise<ActiveVisitor[]>;
  getActiveVisitorByVisitorId(visitorId: string): Promise<ActiveVisitor | undefined>;
  getActiveVisitorCount(): Promise<number>;
  updateActiveVisitor(id: number, data: Partial<InsertActiveVisitor>): Promise<ActiveVisitor | undefined>;
  deleteActiveVisitor(id: number): Promise<void>;
  cleanupStaleVisitors(staleTimeout: number): Promise<number>;
  
  // Visitor history operations
  createVisitorHistory(data: InsertVisitorHistory): Promise<VisitorHistory>;
  getVisitorHistory(visitorId: string): Promise<VisitorHistory[]>;
  getTodayVisitorStats(): Promise<{ totalVisitors: number; totalChats: number; avgSessionDuration: number }>;
  listVisitorHistory(opts: {
    limit: number;
    offset: number;
    search?: string;
    country?: string;
    persona?: string;
    minRisk?: number;
  }): Promise<{ rows: VisitorHistory[]; total: number }>;
  getVisitorHistoryById(id: number): Promise<VisitorHistory | undefined>;
  getVisitorHistoryStats(sinceDays: number): Promise<{
    totalSessions: number;
    uniqueIps: number;
    uniqueVisitors: number;
    topCountries: Array<{ country: string; count: number }>;
    topPersonas: Array<{ persona: string; count: number }>;
    avgRisk: number;
    highRiskCount: number;
  }>;
  pruneVisitorHistoryOlderThan(cutoff: Date, batchSize?: number): Promise<number>;
  
  // Blocked visitor operations
  createBlockedVisitor(data: InsertBlockedVisitor): Promise<BlockedVisitor>;
  getBlockedVisitors(): Promise<BlockedVisitor[]>;
  deleteBlockedVisitor(id: number): Promise<void>;
  isVisitorBlocked(visitorId: string): Promise<boolean>;
  isIpAddressBlocked(ipAddress: string): Promise<boolean>;
  countActiveVisitorsByIp(ipAddress: string): Promise<number>;
  visitorHadChatForCase(visitorId: string, caseId: string): Promise<boolean>;
  satisfactionRatingExistsForVisitorCase(visitorId: string, caseId: string): Promise<boolean>;
  // Single-use nonce claim for satisfaction tokens (see satisfactionToken.ts).
  // Returns true the first time a given nonce is claimed, false if it has
  // already been claimed (replay) — atomic across all autoscale instances.
  claimSatisfactionTokenNonce(nonce: string, expiresAt: Date): Promise<boolean>;
  deleteExpiredSatisfactionTokenNonces(): Promise<number>;
  
  // Admin availability operations
  getAdminAvailability(username: string): Promise<AdminAvailability | undefined>;
  updateAdminAvailability(username: string, data: Partial<InsertAdminAvailability>): Promise<AdminAvailability>;
  
  // Offline message operations
  createOfflineMessage(data: InsertOfflineMessage): Promise<OfflineMessage>;
  getAllOfflineMessages(): Promise<OfflineMessage[]>;
  getOfflineMessageById(id: number): Promise<OfflineMessage | undefined>;
  updateOfflineMessage(id: number, data: Partial<InsertOfflineMessage>): Promise<OfflineMessage | undefined>;
  deleteOfflineMessage(id: number): Promise<void>;
  getUnreadOfflineMessagesCount(): Promise<number>;
  
  // Chat satisfaction rating operations
  createChatSatisfactionRating(data: InsertChatSatisfactionRating): Promise<ChatSatisfactionRating>;
  getChatSatisfactionRatingsByCaseId(caseId: string): Promise<ChatSatisfactionRating[]>;
  getAllChatSatisfactionRatings(): Promise<ChatSatisfactionRating[]>;
  getAverageSatisfactionRating(): Promise<{ avgRating: number; totalRatings: number }>;

  // Generic key/value app-settings store. Used for runtime-tunable
  // configuration that admins can change from the dashboard (e.g. the
  // audit-log retention window) without redeploying.
  getAppSetting(key: string): Promise<AppSetting | undefined>;
  setAppSetting(key: string, value: string, updatedBy?: string | null, executor?: DbExecutor): Promise<AppSetting>;

  // Blocked IPs (Task #113) — admin-managed denylist enforced by
  // server/routes/middleware.ts#checkIpNotBlocked before the case +
  // declaration routes. listBlockedIps returns every row (including
  // expired ones — the middleware filters those out at read time so
  // the dashboard can still show their history). isIpBlocked is a
  // single-row helper for ad-hoc checks; the middleware uses an
  // in-memory cache populated from listBlockedIps for the hot path.
  listBlockedIps(): Promise<BlockedIp[]>;
  blockIp(input: InsertBlockedIp, executor?: DbExecutor): Promise<BlockedIp>;
  unblockIp(ipAddress: string, executor?: DbExecutor): Promise<BlockedIp | undefined>;
  isIpBlocked(ipAddress: string): Promise<boolean>;

  // Withdrawal request operations (Task #47 — admin-controlled window)
  createWithdrawalRequest(data: InsertWithdrawalRequest & {
    twoFactorProvidedAt?: Date | null;
    termsAcceptedAt?: Date;
  }, executor?: DbExecutor): Promise<WithdrawalRequest>;
  getWithdrawalRequestsByCaseId(caseId: string): Promise<WithdrawalRequest[]>;
  getWithdrawalRequestById(id: number): Promise<WithdrawalRequest | undefined>;
  updateWithdrawalRequest(
    id: number,
    data: Partial<{
      status: string;
      reviewedAt: Date | null;
      reviewedBy: string | null;
      adminNote: string | null;
    }>,
  ): Promise<WithdrawalRequest | undefined>;
  getPendingWithdrawalRequestCountByCaseId(caseId: string): Promise<number>;
  getPendingWithdrawalRequestCounts(): Promise<Record<string, number>>;
  listWithdrawalRequests(opts: {
    status?: 'pending' | 'approved' | 'rejected' | 'cancelled';
    caseId?: string;
    limit?: number;
  }): Promise<WithdrawalRequest[]>;

  // Case ledger operations (Task #55 — admin per-case ledger)
  getCaseLedgerEntriesByCaseId(caseId: string, executor?: DbExecutor): Promise<CaseLedgerEntry[]>;
  getCaseLedgerEntryById(id: number): Promise<CaseLedgerEntry | undefined>;
  createCaseLedgerEntry(data: InsertCaseLedgerEntry, executor?: DbExecutor): Promise<CaseLedgerEntry>;
  updateCaseLedgerEntry(
    id: number,
    data: Partial<{
      direction: 'credit' | 'debit';
      amount: string;
      asset: string;
      category: string | null;
      entryDate: Date;
      userVisible: boolean;
      userNote: string | null;
      adminNote: string | null;
    }>,
    executor?: DbExecutor,
  ): Promise<CaseLedgerEntry | undefined>;
  deleteCaseLedgerEntry(id: number, executor?: DbExecutor): Promise<boolean>;
  computeCaseLedgerTotal(caseId: string, executor?: DbExecutor): Promise<string>;

  // Admin "Open as User" mirror tokens — single-use, short-TTL handoff rows
  // shared across all app instances via Postgres.
  createMirrorToken(data: InsertAdminMirrorToken, executor?: DbExecutor): Promise<AdminMirrorToken>;
  consumeMirrorToken(token: string, executor?: DbExecutor): Promise<AdminMirrorToken | undefined>;
  deleteExpiredMirrorTokens(now?: Date): Promise<number>;

  // Portal session tokens — persisted so validate / delete / delete-by-case
  // behave uniformly across every app instance (Task #123).
  createPortalSession(data: InsertPortalSession): Promise<PortalSession>;
  getPortalSession(token: string): Promise<PortalSession | undefined>;
  deletePortalSession(token: string): Promise<void>;
  deletePortalSessionsByCaseId(caseId: string): Promise<number>;
  deleteExpiredPortalSessions(now?: Date): Promise<number>;
  // Read-only lookup used to warn admins before a destructive action (e.g.
  // rotating a case's access code) when the user is currently mid-session.
  // Excludes mirror sessions (admin "open as user" impersonation) since
  // those don't represent genuine user activity.
  getActivePortalSessionByCaseId(caseId: string): Promise<PortalSession | undefined>;
  // Bumped on every successful validateSession() call so admins can see how
  // recently the user was active, not just that the token is still valid.
  updatePortalSessionActivity(token: string): Promise<void>;

  // Refund claims
  createRefundClaim(data: {
    caseId: string;
    documentaryRecommendations?: string | null;
    requestedBy?: string;
  }): Promise<RefundClaim>;
  getRefundClaimByCase(caseId: string): Promise<RefundClaim | undefined>;
  updateRefundClaim(
    id: number,
    data: Partial<Pick<RefundClaim,
      | "status"
      | "entries"
      | "documentaryRecommendations"
      | "adminNotes"
      | "submittedAt"
      | "reviewedAt"
      | "reviewedBy"
    >>,
  ): Promise<RefundClaim>;

  // Sub-admin user management
  listAdminUsers(): Promise<AdminUser[]>;
  getAdminUserByUsername(username: string): Promise<AdminUser | undefined>;
  getAdminUserById(id: number): Promise<AdminUser | undefined>;
  createAdminUser(data: InsertAdminUser): Promise<AdminUser>;
  updateAdminUser(id: number, data: Partial<Pick<AdminUser, 'role' | 'displayName' | 'email' | 'isActive' | 'passwordHash' | 'lastLoginAt' | 'twoFactorEnabled' | 'twoFactorSecret'>>): Promise<AdminUser | undefined>;
  deleteAdminUser(id: number): Promise<void>;
}

/**
 * Task #177 — Centralized receipt-status vocabulary normalizer.
 *
 * `stamp_duty_receipts.status` and `certificate_fee_payments.status` both
 * default to `'pending'` at the DB layer for "uploaded, awaiting admin
 * review". The case-level mirror column `cases.stampDutyStatus` uses
 * `'awaiting_admin_approval'` for the same state. Task #176 unified the
 * vocabulary at the merged-endpoint layer only; this helper pushes that
 * normalization down to storage so every read path agrees:
 *
 *   raw DB 'pending'  →  app-layer 'awaiting_admin_approval'
 *
 * Approved / rejected / any other value passes through untouched. Writes
 * still send the raw DB vocabulary ('pending' on insert default,
 * 'approved'/'rejected' on review) — the column is unchanged per the
 * user-preference rule against modifying shared/schema.ts without
 * explicit approval. Callers reading `status` from these two tables can
 * now rely on a single vocabulary without going through the merged
 * endpoint.
 */
function normalizeReceiptStatus<T extends { status?: string | null }>(row: T): T {
  if (row && row.status === 'pending') {
    return { ...row, status: 'awaiting_admin_approval' };
  }
  return row;
}

export class DatabaseStorage implements IStorage {
  async createCase(data: InsertCase): Promise<Case> {
    if (!data.caseRef) {
      const year = new Date().getFullYear();
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(cases);
      const seq = n + 1;
      (data as Record<string, unknown>).caseRef = `IBF-${year}-${String(seq).padStart(4, '0')}`;
    }
    const [newCase] = await db.insert(cases).values(data).returning();
    return newCase;
  }

  async getCaseById(id: string): Promise<Case | undefined> {
    const [caseData] = await db.select().from(cases).where(eq(cases.id, id));
    return caseData;
  }

  async getCaseByAccessCode(accessCode: string): Promise<Case | undefined> {
    const [caseData] = await db.select().from(cases).where(eq(cases.accessCode, accessCode));
    return caseData;
  }

  async getCaseByPin(hashedPin: string): Promise<Case | undefined> {
    const [caseData] = await db.select().from(cases).where(eq(cases.userPin, hashedPin));
    return caseData;
  }

  async getAllCases(): Promise<Case[]> {
    return await db.select().from(cases).orderBy(desc(cases.createdAt));
  }

  // Server-side paginated + filtered case listing (Task #2443). Filtering
  // and LIMIT/OFFSET both happen in SQL so the client never has to fetch
  // (or the server assemble) the full cases table just to show one page.
  async getCasesPage(params: CasesPageParams): Promise<{ cases: Case[]; total: number }> {
    const { page, pageSize, search, status, locale, sealed } = params;
    const conditions = [];

    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      const pattern = `%${trimmedSearch}%`;
      conditions.push(
        or(
          ilike(cases.id, pattern),
          ilike(cases.caseRef, pattern),
          ilike(cases.accessCode, pattern),
          ilike(cases.userName, pattern),
          ilike(cases.userEmail, pattern),
        ),
      );
    }
    if (status && status !== "all") {
      conditions.push(eq(cases.status, status));
    }
    if (locale && locale !== "all") {
      // "__none__" mirrors the legacy client-side filter's "Auto (unset)"
      // option, which matched cases with no preferredLocale (null or "")
      // rather than a literal locale code — keep that semantic in SQL.
      conditions.push(
        locale === "__none__"
          ? or(isNull(cases.preferredLocale), eq(cases.preferredLocale, ""))
          : eq(cases.preferredLocale, locale),
      );
    }
    if (sealed === "sealed") {
      conditions.push(isNotNull(cases.sealedAt));
    } else if (sealed === "open") {
      conditions.push(isNull(cases.sealedAt));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), 200);
    const offset = (safePage - 1) * safePageSize;

    const [rows, [{ value: total }]] = await Promise.all([
      whereClause
        ? db.select().from(cases).where(whereClause).orderBy(desc(cases.createdAt)).limit(safePageSize).offset(offset)
        : db.select().from(cases).orderBy(desc(cases.createdAt)).limit(safePageSize).offset(offset),
      whereClause
        ? db.select({ value: count() }).from(cases).where(whereClause)
        : db.select({ value: count() }).from(cases),
    ]);

    return { cases: rows, total: Number(total) };
  }

  async updateCase(
    id: string,
    data: Partial<InsertCase>,
    executor: DbExecutor = db,
  ): Promise<Case | undefined> {
    const [updated] = await executor
      .update(cases)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async deleteCase(id: string, executor: DbExecutor = db): Promise<void> {
    // Delete all related records first (cascade delete)
    await executor.delete(depositReceipts).where(eq(depositReceipts.caseId, id));
    await executor.delete(adminMessages).where(eq(adminMessages.caseId, id));
    await executor.delete(chatMessages).where(eq(chatMessages.caseId, id));
    await executor.delete(caseSubmissions).where(eq(caseSubmissions.caseId, id));
    await executor.delete(caseLetters).where(eq(caseLetters.caseId, id));
    // Task #126 — explicitly drop the community participant row before
    // the case itself goes away. The FK now has ON DELETE CASCADE
    // (migration 0013) but doing it explicitly is resilient on DBs that
    // haven't yet had the migration applied; community_reactions /
    // earned_badges still cascade off the participant row.
    await executor.delete(communityParticipants).where(eq(communityParticipants.caseId, id));
    await executor.delete(cases).where(eq(cases.id, id));
  }

  // Run a callback inside a single database transaction. The callback
  // receives a transaction handle (`tx`) that must be threaded through to
  // every storage / repository method involved so the entire group of
  // writes either commits together or rolls back together. Used by admin
  // mutation handlers that pair a row change with an audit-log write —
  // see Task #137.
  async runInTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => fn(tx as DbExecutor));
  }

  // Case Letter operations
  async getCaseLetterByCaseId(caseId: string): Promise<CaseLetter | undefined> {
    const [letter] = await db.select().from(caseLetters).where(eq(caseLetters.caseId, caseId));
    return letter;
  }

  async createOrUpdateCaseLetter(
    caseId: string,
    data: UpdateCaseLetter,
    executor: DbExecutor = db,
  ): Promise<CaseLetter> {
    const existing = await this.getCaseLetterByCaseId(caseId);

    if (existing) {
      const [updated] = await executor
        .update(caseLetters)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(caseLetters.caseId, caseId))
        .returning();
      return updated;
    } else {
      const [created] = await executor
        .insert(caseLetters)
        .values({ caseId, ...data })
        .returning();
      return created;
    }
  }

  // Case Submission operations
  async createSubmission(data: InsertCaseSubmission): Promise<CaseSubmission> {
    const [submission] = await db.insert(caseSubmissions).values(data).returning();
    return submission;
  }

  async getSubmissionsByCaseId(caseId: string): Promise<CaseSubmission[]> {
    return await db
      .select()
      .from(caseSubmissions)
      .where(eq(caseSubmissions.caseId, caseId))
      .orderBy(desc(caseSubmissions.submittedAt));
  }

  async getAllSubmissions(): Promise<CaseSubmission[]> {
    return await db
      .select()
      .from(caseSubmissions)
      .orderBy(desc(caseSubmissions.submittedAt));
  }

  async deleteSubmission(id: number): Promise<void> {
    await db.delete(caseSubmissions).where(eq(caseSubmissions.id, id));
  }

  // Case email operations
  async getCaseNdaByCaseId(caseId: string): Promise<CaseNda | undefined> {
    // Returns the most recent signed NDA for the case. After an
    // admin override clears the seal, prior rows are intentionally
    // preserved for evidentiary durability; a subsequent user re-sign
    // inserts a NEW row that supersedes the older one here.
    const [row] = await db
      .select()
      .from(caseNdas)
      .where(eq(caseNdas.caseId, caseId))
      .orderBy(desc(caseNdas.createdAt))
      .limit(1);
    return row;
  }

  async createCaseNda(data: InsertCaseNda, executor: DbExecutor = db): Promise<CaseNda> {
    const [created] = await executor.insert(caseNdas).values(data).returning();
    return created;
  }

  // Returns every signed NDA row that belongs to a case which is presently
  // sealed (cases.sealedAt IS NOT NULL), including historical rows from
  // earlier sign cycles on the same case (after an admin Override Seal +
  // user re-sign, the older rows remain in case_ndas for evidentiary
  // durability). The nightly integrity sweep re-hashes every one of these
  // rows so at-rest tampering of *any* sealed-case NDA row is detected,
  // not just the currently-displayed one. Drives the nightly integrity
  // sweep — see server/nda-integrity-sweep.ts.
  async getAllSealedCaseNdas(): Promise<CaseNda[]> {
    return await db
      .select({
        id: caseNdas.id,
        caseId: caseNdas.caseId,
        templateVersion: caseNdas.templateVersion,
        renderedBody: caseNdas.renderedBody,
        signedName: caseNdas.signedName,
        signedAt: caseNdas.signedAt,
        signedIp: caseNdas.signedIp,
        signedUserAgent: caseNdas.signedUserAgent,
        signedPdfBase64: caseNdas.signedPdfBase64,
        contentHash: caseNdas.contentHash,
        createdAt: caseNdas.createdAt,
        updatedAt: caseNdas.updatedAt,
      })
      .from(caseNdas)
      .innerJoin(cases, eq(cases.id, caseNdas.caseId))
      .where(isNotNull(cases.sealedAt))
      .orderBy(desc(caseNdas.createdAt));
  }

  async createCaseEmail(
    data: InsertCaseEmail,
    executor: DbExecutor = db,
  ): Promise<CaseEmail> {
    const [email] = await executor.insert(caseEmails).values(data).returning();
    return email;
  }

  async getCaseEmailsByCaseId(caseId: string): Promise<CaseEmail[]> {
    return await db.select().from(caseEmails)
      .where(eq(caseEmails.caseId, caseId))
      .orderBy(desc(caseEmails.createdAt));
  }

  async getCaseEmailById(id: number): Promise<CaseEmail | undefined> {
    const [row] = await db.select().from(caseEmails).where(eq(caseEmails.id, id));
    return row;
  }

  async updateCaseEmailStatus(id: number, status: string, errorMessage?: string): Promise<CaseEmail | undefined> {
    const [updated] = await db.update(caseEmails)
      .set({ 
        status, 
        errorMessage,
        sentAt: status === 'sent' ? new Date() : undefined
      })
      .where(eq(caseEmails.id, id))
      .returning();
    return updated;
  }

  // Chat message operations
  async createChatMessage(data: InsertChatMessage): Promise<ChatMessage> {
    const [message] = await db.insert(chatMessages).values(data).returning();
    return message;
  }

  async getChatMessagesByCaseId(caseId: string): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.caseId, caseId))
      .orderBy(chatMessages.createdAt);
  }

  async markMessagesAsRead(caseId: string, sender: string): Promise<void> {
    await db
      .update(chatMessages)
      .set({ isRead: 'true' })
      .where(and(eq(chatMessages.caseId, caseId), eq(chatMessages.sender, sender)));
  }

  async getUnreadCount(caseId: string, sender: string): Promise<number> {
    const messages = await db
      .select()
      .from(chatMessages)
      .where(and(
        eq(chatMessages.caseId, caseId),
        eq(chatMessages.sender, sender),
        eq(chatMessages.isRead, 'false')
      ));
    return messages.length;
  }

  // Admin message operations
  async createAdminMessage(data: InsertAdminMessage): Promise<AdminMessage> {
    const [message] = await db.insert(adminMessages).values(data).returning();
    return message;
  }

  async getAdminMessagesByCaseId(caseId: string): Promise<AdminMessage[]> {
    return await db
      .select()
      .from(adminMessages)
      .where(eq(adminMessages.caseId, caseId))
      .orderBy(desc(adminMessages.createdAt));
  }

  async getAdminMessageById(id: number): Promise<AdminMessage | undefined> {
    const [message] = await db.select().from(adminMessages).where(eq(adminMessages.id, id));
    return message;
  }

  async updateAdminMessage(id: number, data: Partial<InsertAdminMessage>): Promise<AdminMessage | undefined> {
    const [updated] = await db
      .update(adminMessages)
      .set(data)
      .where(eq(adminMessages.id, id))
      .returning();
    return updated;
  }

  async deleteAdminMessage(id: number): Promise<void> {
    await db.delete(adminMessages).where(eq(adminMessages.id, id));
  }

  async markAdminMessageAsRead(id: number): Promise<void> {
    await db.update(adminMessages).set({ isRead: true }).where(eq(adminMessages.id, id));
  }

  async getUnreadAdminMessagesCount(caseId: string): Promise<number> {
    const messages = await db
      .select()
      .from(adminMessages)
      .where(and(eq(adminMessages.caseId, caseId), eq(adminMessages.isRead, false)));
    return messages.length;
  }

  // Deposit receipt operations
  async createDepositReceipt(data: InsertDepositReceipt, executor: DbExecutor = db): Promise<DepositReceipt> {
    const [receipt] = await executor.insert(depositReceipts).values(data).returning();
    return receipt;
  }

  async getDepositReceiptsByCaseId(caseId: string): Promise<DepositReceipt[]> {
    return await db
      .select()
      .from(depositReceipts)
      .where(eq(depositReceipts.caseId, caseId))
      .orderBy(desc(depositReceipts.uploadedAt));
  }

  async countDepositReceiptsByCaseId(caseId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(depositReceipts)
      .where(eq(depositReceipts.caseId, caseId));
    return row?.count ?? 0;
  }

  async updateDepositReceiptStatus(id: number, status: string, executor: DbExecutor = db): Promise<DepositReceipt | undefined> {
    const [updated] = await executor
      .update(depositReceipts)
      .set({ status })
      .where(eq(depositReceipts.id, id))
      .returning();
    return updated;
  }

  async updateDepositReceipt(id: number, data: { status?: string; adminNotes?: string; imageData?: string; fileName?: string | null }, executor: DbExecutor = db): Promise<DepositReceipt | undefined> {
    const updateData: any = {};
    if (data.status) updateData.status = data.status;
    if (data.adminNotes !== undefined) updateData.adminNotes = data.adminNotes;
    if (data.imageData !== undefined) updateData.imageData = data.imageData;
    if (data.fileName !== undefined) updateData.fileName = data.fileName;

    const [updated] = await executor
      .update(depositReceipts)
      .set(updateData)
      .where(eq(depositReceipts.id, id))
      .returning();
    return updated;
  }

  async getDepositReceiptById(id: number): Promise<DepositReceipt | undefined> {
    const [receipt] = await db.select().from(depositReceipts).where(eq(depositReceipts.id, id));
    return receipt;
  }

  async getAllDepositReceipts(): Promise<DepositReceipt[]> {
    return await db.select().from(depositReceipts).orderBy(desc(depositReceipts.uploadedAt));
  }

  // ----- Certificate fee payments (Task #70) -----
  async createCertificateFeePayment(data: InsertCertificateFeePayment, executor: DbExecutor = db): Promise<CertificateFeePayment> {
    const [row] = await executor.insert(certificateFeePayments).values(data).returning();
    return normalizeReceiptStatus(row);
  }

  async getCertificateFeePaymentsByCaseId(caseId: string): Promise<CertificateFeePayment[]> {
    const rows = await db
      .select()
      .from(certificateFeePayments)
      .where(eq(certificateFeePayments.caseId, caseId))
      .orderBy(desc(certificateFeePayments.uploadedAt));
    return rows.map(normalizeReceiptStatus);
  }

  async getCertificateFeePaymentById(id: number): Promise<CertificateFeePayment | undefined> {
    const [row] = await db.select().from(certificateFeePayments).where(eq(certificateFeePayments.id, id));
    return row ? normalizeReceiptStatus(row) : row;
  }

  async getAllCertificateFeePayments(): Promise<CertificateFeePayment[]> {
    const rows = await db.select().from(certificateFeePayments).orderBy(desc(certificateFeePayments.uploadedAt));
    return rows.map(normalizeReceiptStatus);
  }

  async updateCertificateFeePayment(
    id: number,
    data: { status?: string; adminNotes?: string | null; reviewedBy?: string | null; reviewedAt?: Date | null },
    executor: DbExecutor = db,
  ): Promise<CertificateFeePayment | undefined> {
    const update: Record<string, unknown> = {};
    if (data.status !== undefined) update.status = data.status;
    if (data.adminNotes !== undefined) update.adminNotes = data.adminNotes;
    if (data.reviewedBy !== undefined) update.reviewedBy = data.reviewedBy;
    if (data.reviewedAt !== undefined) update.reviewedAt = data.reviewedAt;
    const [row] = await executor
      .update(certificateFeePayments)
      .set(update)
      .where(eq(certificateFeePayments.id, id))
      .returning();
    return row;
  }

  // ----- Stamp Duty receipts (Task #72) -----
  async createStampDutyReceipt(data: InsertStampDutyReceipt, executor: DbExecutor = db): Promise<StampDutyReceipt> {
    const [row] = await executor.insert(stampDutyReceipts).values(data).returning();
    return row;
  }

  async getStampDutyReceiptsByCaseId(caseId: string): Promise<StampDutyReceipt[]> {
    const rows = await db
      .select()
      .from(stampDutyReceipts)
      .where(eq(stampDutyReceipts.caseId, caseId))
      .orderBy(desc(stampDutyReceipts.uploadedAt));
    return rows.map(normalizeReceiptStatus);
  }

  async getStampDutyReceiptById(id: number): Promise<StampDutyReceipt | undefined> {
    const [row] = await db.select().from(stampDutyReceipts).where(eq(stampDutyReceipts.id, id));
    return row ? normalizeReceiptStatus(row) : row;
  }

  async getAllStampDutyReceipts(): Promise<StampDutyReceipt[]> {
    const rows = await db.select().from(stampDutyReceipts).orderBy(desc(stampDutyReceipts.uploadedAt));
    return rows.map(normalizeReceiptStatus);
  }

  async updateStampDutyReceipt(
    id: number,
    data: { status?: string; adminNotes?: string | null; reviewedBy?: string | null; reviewedAt?: Date | null },
    executor: DbExecutor = db,
  ): Promise<StampDutyReceipt | undefined> {
    const update: Record<string, unknown> = {};
    if (data.status !== undefined) update.status = data.status;
    if (data.adminNotes !== undefined) update.adminNotes = data.adminNotes;
    if (data.reviewedBy !== undefined) update.reviewedBy = data.reviewedBy;
    if (data.reviewedAt !== undefined) update.reviewedAt = data.reviewedAt;
    const [row] = await executor
      .update(stampDutyReceipts)
      .set(update)
      .where(eq(stampDutyReceipts.id, id))
      .returning();
    return row;
  }

  // Session Refresh Deposit gate
  async createSessionRefreshReceipt(
    data: InsertSessionRefreshReceipt,
    executor: DbExecutor = db,
  ): Promise<SessionRefreshReceipt> {
    const [row] = await executor.insert(sessionRefreshReceipts).values(data).returning();
    return row;
  }

  async getSessionRefreshReceiptsByCaseId(caseId: string): Promise<SessionRefreshReceipt[]> {
    return await db
      .select()
      .from(sessionRefreshReceipts)
      .where(eq(sessionRefreshReceipts.caseId, caseId))
      .orderBy(desc(sessionRefreshReceipts.submittedAt));
  }

  async getSessionRefreshReceiptById(id: number): Promise<SessionRefreshReceipt | undefined> {
    const [row] = await db.select().from(sessionRefreshReceipts).where(eq(sessionRefreshReceipts.id, id));
    return row;
  }

  async updateSessionRefreshReceipt(
    id: number,
    data: { adminNotes?: string | null; reviewedBy?: string | null; reviewedAt?: Date | null },
    executor: DbExecutor = db,
  ): Promise<SessionRefreshReceipt | undefined> {
    const update: Record<string, unknown> = {};
    if (data.adminNotes !== undefined) update.adminNotes = data.adminNotes;
    if (data.reviewedBy !== undefined) update.reviewedBy = data.reviewedBy;
    if (data.reviewedAt !== undefined) update.reviewedAt = data.reviewedAt;
    const [row] = await executor
      .update(sessionRefreshReceipts)
      .set(update)
      .where(eq(sessionRefreshReceipts.id, id))
      .returning();
    return row;
  }

  // Withdrawal request operations
  async createWithdrawalRequest(
    data: InsertWithdrawalRequest & {
      twoFactorProvidedAt?: Date | null;
      termsAcceptedAt?: Date;
    },
    executor: DbExecutor = db,
  ): Promise<WithdrawalRequest> {
    const [row] = await executor.insert(withdrawalRequests).values(data).returning();
    return row;
  }

  async getWithdrawalRequestsByCaseId(caseId: string): Promise<WithdrawalRequest[]> {
    return await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.caseId, caseId))
      .orderBy(desc(withdrawalRequests.createdAt));
  }

  async getWithdrawalRequestById(id: number): Promise<WithdrawalRequest | undefined> {
    const [row] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id));
    return row;
  }

  async updateWithdrawalRequest(
    id: number,
    data: Partial<{
      status: string;
      reviewedAt: Date | null;
      reviewedBy: string | null;
      adminNote: string | null;
    }>,
    executor: DbExecutor = db,
  ): Promise<WithdrawalRequest | undefined> {
    const [row] = await executor
      .update(withdrawalRequests)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(withdrawalRequests.id, id))
      .returning();
    return row;
  }

  async getPendingWithdrawalRequestCountByCaseId(caseId: string): Promise<number> {
    const rows = await db
      .select({ id: withdrawalRequests.id })
      .from(withdrawalRequests)
      .where(and(eq(withdrawalRequests.caseId, caseId), eq(withdrawalRequests.status, 'pending')));
    return rows.length;
  }

  async getPendingWithdrawalRequestCounts(): Promise<Record<string, number>> {
    const rows = await db
      .select({
        caseId: withdrawalRequests.caseId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.status, 'pending'))
      .groupBy(withdrawalRequests.caseId);
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.caseId] = row.count;
    }
    return result;
  }

  async getReactivationPendingCounts(): Promise<Record<string, number>> {
    const rows = await db
      .select({
        caseId: depositReceipts.caseId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(depositReceipts)
      .where(
        and(
          eq(depositReceipts.category, 'reissue'),
          isNull(depositReceipts.reissueId),
          eq(depositReceipts.status, 'pending'),
        ),
      )
      .groupBy(depositReceipts.caseId);
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.caseId] = row.count;
    }
    return result;
  }

  async listWithdrawalRequests(opts: {
    status?: 'pending' | 'approved' | 'rejected' | 'cancelled';
    caseId?: string;
    limit?: number;
  }): Promise<WithdrawalRequest[]> {
    const conditions = [];
    if (opts.status) conditions.push(eq(withdrawalRequests.status, opts.status));
    if (opts.caseId) conditions.push(eq(withdrawalRequests.caseId, opts.caseId));
    const where = conditions.length ? and(...conditions) : undefined;
    const q = db.select().from(withdrawalRequests);
    const rows = await (where ? q.where(where) : q)
      .orderBy(desc(withdrawalRequests.createdAt))
      .limit(opts.limit ?? 100);
    return rows;
  }

  // ------------------------------------------------------------------
  // Case ledger operations (Task #55)
  // ------------------------------------------------------------------
  async getCaseLedgerEntriesByCaseId(caseId: string, executor: DbExecutor = db): Promise<CaseLedgerEntry[]> {
    // Task #173 — accept an optional transaction executor so callers
    // running inside `runInTransaction` (e.g. `computeCaseLedgerTotal`
    // via `autoAdjustBalance`) see the in-flight INSERT/UPDATE/DELETE
    // and recompute the balance from authoritative, not stale, state.
    return await executor
      .select()
      .from(caseLedgerEntries)
      .where(eq(caseLedgerEntries.caseId, caseId))
      .orderBy(desc(caseLedgerEntries.entryDate), desc(caseLedgerEntries.id));
  }

  async getCaseLedgerEntryById(id: number): Promise<CaseLedgerEntry | undefined> {
    const [row] = await db
      .select()
      .from(caseLedgerEntries)
      .where(eq(caseLedgerEntries.id, id));
    return row;
  }

  async createCaseLedgerEntry(data: InsertCaseLedgerEntry, executor: DbExecutor = db): Promise<CaseLedgerEntry> {
    const [row] = await executor.insert(caseLedgerEntries).values(data).returning();
    return row;
  }

  async updateCaseLedgerEntry(
    id: number,
    data: Partial<{
      direction: 'credit' | 'debit';
      amount: string;
      asset: string;
      category: string | null;
      entryDate: Date;
      userVisible: boolean;
      userNote: string | null;
      adminNote: string | null;
    }>,
    executor: DbExecutor = db,
  ): Promise<CaseLedgerEntry | undefined> {
    const [row] = await executor
      .update(caseLedgerEntries)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(caseLedgerEntries.id, id))
      .returning();
    return row;
  }

  async deleteCaseLedgerEntry(id: number, executor: DbExecutor = db): Promise<boolean> {
    const result = await executor.delete(caseLedgerEntries).where(eq(caseLedgerEntries.id, id)).returning();
    return result.length > 0;
  }

  /**
   * Sum credits minus debits for a case and return a stable string in
   * the same `"<amount> USDT"` shape the existing balance card already
   * renders. Non-numeric amounts are coerced to 0 so a malformed legacy
   * row can never throw mid-aggregation. The asset of the most recent
   * entry wins; we default to USDT when there are no entries.
   */
  async computeCaseLedgerTotal(caseId: string, executor: DbExecutor = db): Promise<string> {
    // Task #173 — thread the transaction executor through so balance
    // recompute inside a runInTransaction callback observes uncommitted
    // writes from the same transaction. Without this the recompute
    // sees the pre-mutation row set and persists a stale total.
    const rows = await this.getCaseLedgerEntriesByCaseId(caseId, executor);
    if (rows.length === 0) return "";
    let total = 0;
    for (const r of rows) {
      const n = Number.parseFloat(String(r.amount ?? "").replace(/,/g, ""));
      if (!Number.isFinite(n)) continue;
      total += r.direction === 'debit' ? -n : n;
    }
    // Pick the asset of the first (most recent by entryDate) entry, then
    // fall back to USDT.
    const asset = (rows[0]?.asset || 'USDT').trim() || 'USDT';
    // Two-decimal formatting with thousands separators — matches the
    // existing balance copy used elsewhere ("12,450.00 USDT").
    const formatted = total.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${formatted} ${asset}`;
  }

  // Letter reissue operations
  async createLetterReissue(
    data: InsertLetterReissue,
    executor: DbExecutor = db,
  ): Promise<LetterReissue> {
    const [row] = await executor.insert(letterReissues).values(data).returning();
    return row;
  }

  async getLetterReissuesByCaseId(caseId: string): Promise<LetterReissue[]> {
    return await db
      .select()
      .from(letterReissues)
      .where(eq(letterReissues.caseId, caseId))
      .orderBy(desc(letterReissues.createdAt));
  }

  async getActiveLetterReissue(caseId: string): Promise<LetterReissue | undefined> {
    // The active round is the most recent non-cancelled row. A 'paid' round
    // remains "active" until the user actually resubmits — the submissions
    // gate uses status==='paid' as the unlock condition.
    const [row] = await db
      .select()
      .from(letterReissues)
      .where(and(eq(letterReissues.caseId, caseId), ne(letterReissues.status, 'cancelled')))
      .orderBy(desc(letterReissues.createdAt))
      .limit(1);
    return row;
  }

  async getLetterReissueById(id: number): Promise<LetterReissue | undefined> {
    const [row] = await db.select().from(letterReissues).where(eq(letterReissues.id, id));
    return row;
  }

  async updateLetterReissue(
    id: number,
    data: Partial<{ status: string; receiptId: number | null; paidAt: Date | null; cancelledAt: Date | null; reissueFee: string; reason: string | null }>,
    executor: DbExecutor = db,
  ): Promise<LetterReissue | undefined> {
    const update: any = {};
    if (data.status !== undefined) update.status = data.status;
    if (data.receiptId !== undefined) update.receiptId = data.receiptId;
    if (data.paidAt !== undefined) update.paidAt = data.paidAt;
    if (data.cancelledAt !== undefined) update.cancelledAt = data.cancelledAt;
    if (data.reissueFee !== undefined) update.reissueFee = data.reissueFee;
    if (data.reason !== undefined) update.reason = data.reason;
    const [row] = await executor.update(letterReissues).set(update).where(eq(letterReissues.id, id)).returning();
    return row;
  }

  // Activity log operations
  async createActivityLog(data: InsertActivityLog): Promise<ActivityLog> {
    const [log] = await db.insert(activityLogs).values(data).returning();
    return log;
  }

  async getActivityLogsByCaseId(caseId: string): Promise<ActivityLog[]> {
    return await db.select().from(activityLogs).where(eq(activityLogs.caseId, caseId)).orderBy(desc(activityLogs.createdAt));
  }

  async getAllActivityLogs(): Promise<ActivityLog[]> {
    return await db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt));
  }

  // Audit log operations
  async createAuditLog(
    data: InsertAuditLog,
    executor: DbExecutor = db,
  ): Promise<AuditLog> {
    const [log] = await executor.insert(auditLogs).values(data).returning();
    return log;
  }

  async getAllAuditLogs(): Promise<AuditLog[]> {
    // Admin login events (success/failure/throttle) are recorded in the same
    // audit_logs table but have their own dedicated views in the dashboard
    // ("Failed Sign-ins"), so exclude them from the general audit trail to
    // keep that listing focused on case/account actions.
    return await db
      .select()
      .from(auditLogs)
      .where(
        sql`${auditLogs.action} not in ('admin_login_success', 'admin_login_failed', 'admin_login_throttled')`,
      )
      .orderBy(desc(auditLogs.createdAt));
  }

  // Emergency credential-reset activity ("Locked out?" recovery flow). This
  // is a security-sensitive event — a completed reset rewrites the admin's
  // own credentials — so it gets its own dedicated, always-fresh view
  // (bounded by `limit`) rather than requiring admins to scroll the general
  // audit trail to notice it.
  async getEmergencyResetAuditLogs(limit: number): Promise<AuditLog[]> {
    return await db
      .select()
      .from(auditLogs)
      .where(
        sql`${auditLogs.action} in ('admin_emergency_reset_requested', 'admin_emergency_reset_used')`,
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  // Returns the most recent NDA integrity-check audit row for a case
  // (either a `nda_integrity_verified` pass or `nda_integrity_failed`
  // tamper flag). Drives the persistent "verification status" badge on
  // the admin case-detail Sealed banner so a flagged seal stays
  // visible after the dialog is closed and re-opened.
  async getLatestNdaIntegrityCheck(caseId: string): Promise<AuditLog | undefined> {
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, "case"),
          eq(auditLogs.targetId, caseId),
          inArray(auditLogs.action, [
            "nda_integrity_verified",
            "nda_integrity_failed",
          ]),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    return row;
  }

  // Recent transactional-email audit rows for a case (any `email_*`
  // action — both successful sends and `_failed` variants). Powers the
  // per-case email-delivery panel in the admin case-detail dialog so
  // reviewers can confirm whether a background SMTP dispatch actually
  // landed without scrolling the global audit log.
  async getAuditLogById(id: number): Promise<AuditLog | undefined> {
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.id, id));
    return row;
  }

  async getEmailAuditLogsForCase(
    caseId: string,
    limit: number = 50,
  ): Promise<AuditLog[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    return await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, "case"),
          eq(auditLogs.targetId, caseId),
          sql`${auditLogs.action} like 'email_%'`,
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit);
  }

  // Bulk per-case email delivery summary for the admin Cases list.
  // Returns, per case id (only when there is something to report):
  //   - pending: count of `case_emails` rows still in 'pending' status
  //     (i.e. the SMTP dispatcher hasn't yet flipped them to sent/failed)
  //   - failed24h: count of `email_*_failed` audit rows AND case_emails
  //     rows with status='failed' in the last 24 hours
  //   - lastFailureAt: ISO timestamp of the most recent failure (audit
  //     row or case_emails row), for tooltip context.
  // Avoids N round-trips for the Cases list badge — a per-row fetch of
  // /:id/emails + /:id/email-audit-logs would be O(N) requests, this is
  // O(1) per request regardless of case count.
  async getEmailDeliverySummaryForCases(
    caseIds: string[],
  ): Promise<
    Map<
      string,
      { pending: number; failed24h: number; lastFailureAt: string | null }
    >
  > {
    const out = new Map<
      string,
      { pending: number; failed24h: number; lastFailureAt: string | null }
    >();
    if (caseIds.length === 0) return out;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const ensure = (caseId: string) => {
      let row = out.get(caseId);
      if (!row) {
        row = { pending: 0, failed24h: 0, lastFailureAt: null };
        out.set(caseId, row);
      }
      return row;
    };
    const bumpFailure = (
      caseId: string,
      at: Date | string | null | undefined,
    ) => {
      const row = ensure(caseId);
      row.failed24h += 1;
      if (at) {
        const iso = at instanceof Date ? at.toISOString() : String(at);
        if (!row.lastFailureAt || iso > row.lastFailureAt) {
          row.lastFailureAt = iso;
        }
      }
    };

    // case_emails: pending (any age) + failed in last 24h.
    const ceRows = await db
      .select({
        caseId: caseEmails.caseId,
        status: caseEmails.status,
        createdAt: caseEmails.createdAt,
        sentAt: caseEmails.sentAt,
      })
      .from(caseEmails)
      .where(
        and(
          inArray(caseEmails.caseId, caseIds),
          or(
            eq(caseEmails.status, "pending"),
            and(
              eq(caseEmails.status, "failed"),
              gte(caseEmails.createdAt, since),
            ),
          ),
        ),
      );
    for (const r of ceRows) {
      if (!r.caseId) continue;
      if (r.status === "pending") {
        ensure(r.caseId).pending += 1;
      } else if (r.status === "failed") {
        bumpFailure(r.caseId, r.sentAt ?? r.createdAt);
      }
    }

    // audit logs: any email_*_failed in the last 24h. Skip the two
    // tags whose dispatchers ALSO persist a `case_emails` row
    // (`email_custom` and `email_stage_instructions` come from
    // POST /:id/email and POST /:id/send-stage-email respectively),
    // otherwise the same failed send would be counted twice — once
    // from case_emails.status='failed' and once from the audit row.
    // Mirrors the AUDIT_TAGS_DUPED_IN_CASE_EMAILS guard in the
    // CaseEmailDeliveryPanel's row-merge logic.
    const alRows = await db
      .select({
        targetId: auditLogs.targetId,
        action: auditLogs.action,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, "case"),
          inArray(auditLogs.targetId, caseIds),
          sql`${auditLogs.action} like 'email_%_failed'`,
          sql`${auditLogs.action} not in ('email_custom_failed', 'email_stage_instructions_failed')`,
          gte(auditLogs.createdAt, since),
        ),
      );
    for (const r of alRows) {
      if (!r.targetId) continue;
      bumpFailure(r.targetId, r.createdAt);
    }

    return out;
  }

  // Cross-case rollup of every `email_*_failed` audit row and every
  // `case_emails` row with status='failed' since `since`. Powers the
  // dashboard-wide email-delivery alert banner (Task #150). Mirrors the
  // dedup rule in getEmailDeliverySummaryForCases — audit rows for the
  // two tags whose dispatchers ALSO persist a case_emails row
  // (`email_custom_failed`, `email_stage_instructions_failed`) are
  // skipped to avoid double-counting the same send.
  async getRecentEmailFailures(
    since: Date,
  ): Promise<
    Array<{
      caseId: string;
      tag: string;
      at: string;
      error: string | null;
      source: "audit" | "case_emails";
    }>
  > {
    const out: Array<{
      caseId: string;
      tag: string;
      at: string;
      error: string | null;
      source: "audit" | "case_emails";
    }> = [];

    const ceRows = await db
      .select({
        caseId: caseEmails.caseId,
        subject: caseEmails.subject,
        errorMessage: caseEmails.errorMessage,
        createdAt: caseEmails.createdAt,
        sentAt: caseEmails.sentAt,
      })
      .from(caseEmails)
      .where(
        and(
          eq(caseEmails.status, "failed"),
          gte(caseEmails.createdAt, since),
        ),
      );
    for (const r of ceRows) {
      if (!r.caseId) continue;
      const tag = /^Stage\s+\d+\s+of\s+14\b/i.test(r.subject ?? "")
        ? "stage_instructions"
        : "custom";
      const at = (r.sentAt ?? r.createdAt) ?? new Date();
      out.push({
        caseId: r.caseId,
        tag,
        at: at instanceof Date ? at.toISOString() : String(at),
        error: r.errorMessage ?? null,
        source: "case_emails",
      });
    }

    const alRows = await db
      .select({
        targetId: auditLogs.targetId,
        action: auditLogs.action,
        newValue: auditLogs.newValue,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, "case"),
          sql`${auditLogs.action} like 'email_%_failed'`,
          sql`${auditLogs.action} not in ('email_custom_failed', 'email_stage_instructions_failed')`,
          gte(auditLogs.createdAt, since),
        ),
      );
    for (const r of alRows) {
      if (!r.targetId) continue;
      const tag = r.action.replace(/^email_/, "").replace(/_failed$/, "");
      const at = r.createdAt ?? new Date();
      out.push({
        caseId: r.targetId,
        tag,
        at: at instanceof Date ? at.toISOString() : String(at),
        error: r.newValue ?? null,
        source: "audit",
      });
    }

    out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return out;
  }

  // Bulk variant of getLatestNdaIntegrityCheck for the admin Cases
  // list. Returns a Map keyed by caseId so a row-level "Integrity
  // failed" badge can be rendered without N round-trips. Callers should
  // pre-filter to sealed case IDs to keep the query small.
  async getLatestNdaIntegrityChecksForCases(
    caseIds: string[],
  ): Promise<Map<string, AuditLog>> {
    const out = new Map<string, AuditLog>();
    if (caseIds.length === 0) return out;
    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, "case"),
          inArray(auditLogs.targetId, caseIds),
          inArray(auditLogs.action, [
            "nda_integrity_verified",
            "nda_integrity_failed",
          ]),
        ),
      )
      .orderBy(desc(auditLogs.createdAt));
    for (const row of rows) {
      if (row.targetId && !out.has(row.targetId)) {
        out.set(row.targetId, row);
      }
    }
    return out;
  }

  // Most recent stamp-duty fee reminder audit row for a case (either
  // `stamp_duty_reminder_sent` or `stamp_duty_reminder_failed`). Surfaced
  // in the admin case-detail dialog so reviewers see "last reminder: X
  // ago" and don't double-nudge users.
  async getLatestStampDutyReminder(
    caseId: string,
  ): Promise<AuditLog | undefined> {
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, "case"),
          eq(auditLogs.targetId, caseId),
          inArray(auditLogs.action, [
            "stamp_duty_reminder_sent",
            "stamp_duty_reminder_failed",
          ]),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    return row;
  }

  async getRecentFailedAdminLogins(limit: number): Promise<AuditLog[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    return await db
      .select()
      .from(auditLogs)
      .where(
        inArray(auditLogs.action, [
          "admin_login_failed",
          "admin_login_throttled",
        ]),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit);
  }

  async getFailedAdminLoginCountSince(since: Date): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(
        and(
          inArray(auditLogs.action, [
            "admin_login_failed",
            "admin_login_throttled",
          ]),
          gte(auditLogs.createdAt, since),
        ),
      );
    return row?.count ?? 0;
  }

  // Aggregates failed-sign-in audit rows by source IP within a time window so
  // admins can see "203.0.113.42 tried 47 times against 6 different usernames"
  // at a glance instead of paging through 47 individual rows.
  //
  // `since`         — lower bound of the aggregation window (e.g. last 24h)
  // `throttleSince` — narrower window matching the rate-limiter's lockout
  //                    duration. If the IP triggered any 429 within that
  //                    window we treat the IP as "currently rate-limited".
  //                    This is a heuristic — the rate-limiter state itself
  //                    lives in memory, but a recent throttle row is a strong
  //                    proxy and avoids reaching into the limiter's closure.
  //
  // Rows where ip_address is NULL are dropped. Postgres-specific aggregates
  // (array_agg DISTINCT, FILTER) are used to keep the work in the database.
  async getFailedAdminLoginsByIp(
    since: Date,
    throttleSince: Date,
    limit = 200,
  ): Promise<FailedAdminLoginByIp[]> {
    // Defensive cap so a curious caller (or a misbehaving polling client)
    // can't ask the admin UI to render thousands of attacker IPs in one go.
    const safeLimit = Math.min(Math.max(1, limit), 500);

    // Aggregate window must include the throttle lookback even when the
    // requested grouping window is shorter than 15 minutes — otherwise
    // `isThrottled` would silently underreport for narrow windows.
    const aggregateSince =
      throttleSince.getTime() < since.getTime() ? throttleSince : since;

    const rows = await db
      .select({
        ipAddress: auditLogs.ipAddress,
        attemptCount: sql<number>`count(*) filter (where ${auditLogs.createdAt} >= ${since})::int`,
        badPasswordCount: sql<number>`count(*) filter (where ${auditLogs.action} = 'admin_login_failed' and ${auditLogs.createdAt} >= ${since})::int`,
        throttledCount: sql<number>`count(*) filter (where ${auditLogs.action} = 'admin_login_throttled' and ${auditLogs.createdAt} >= ${since})::int`,
        distinctUsernames: sql<string[]>`array_agg(distinct ${auditLogs.adminUsername}) filter (where ${auditLogs.createdAt} >= ${since})`,
        firstAttemptAt: sql<Date>`min(${auditLogs.createdAt}) filter (where ${auditLogs.createdAt} >= ${since})`,
        lastAttemptAt: sql<Date>`max(${auditLogs.createdAt}) filter (where ${auditLogs.createdAt} >= ${since})`,
        recentThrottleCount: sql<number>`count(*) filter (where ${auditLogs.action} = 'admin_login_throttled' and ${auditLogs.createdAt} >= ${throttleSince})::int`,
      })
      .from(auditLogs)
      .where(
        and(
          inArray(auditLogs.action, [
            "admin_login_failed",
            "admin_login_throttled",
          ]),
          gte(auditLogs.createdAt, aggregateSince),
          sql`${auditLogs.ipAddress} is not null`,
        ),
      )
      .groupBy(auditLogs.ipAddress)
      // Drop IPs whose only rows were old throttles pulled in to compute
      // `isThrottled` — they have nothing to show in the requested window.
      .having(sql`count(*) filter (where ${auditLogs.createdAt} >= ${since}) > 0`)
      .orderBy(sql`count(*) filter (where ${auditLogs.createdAt} >= ${since}) desc`)
      .limit(safeLimit);

    return rows.map((row) => ({
      ipAddress: row.ipAddress ?? "unknown",
      attemptCount: row.attemptCount,
      badPasswordCount: row.badPasswordCount,
      throttledCount: row.throttledCount,
      distinctUsernames: (row.distinctUsernames ?? []).filter(
        (u): u is string => typeof u === "string" && u.length > 0,
      ),
      firstAttemptAt: row.firstAttemptAt,
      lastAttemptAt: row.lastAttemptAt,
      isThrottled: row.recentThrottleCount > 0,
    }));
  }

  // ---- Declaration-read brute-force telemetry (mirrors getRecentFailedAdminLogins) ----
  //
  // The audit rows written by GET /api/cases/:id/declaration when an
  // unauthorized read is attempted (`declaration_read_unauthorized`) or
  // throttled by the in-memory limiter (`declaration_read_rate_limited`).
  // Returned newest-first for the per-attempt forensic view.
  async getRecentDeclarationReadAttempts(
    limit: number,
    ipAddress?: string,
  ): Promise<AuditLog[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const actionFilter = inArray(auditLogs.action, [
      "declaration_read_unauthorized",
      "declaration_read_rate_limited",
    ]);
    // Optional per-IP filter powers the dashboard's "expand IP row to see
    // its individual attempts" drilldown without dumping the full feed.
    const where = ipAddress
      ? and(actionFilter, eq(auditLogs.ipAddress, ipAddress))
      : actionFilter;
    return await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit);
  }

  async getDeclarationReadAttemptCountSince(since: Date): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(
        and(
          inArray(auditLogs.action, [
            "declaration_read_unauthorized",
            "declaration_read_rate_limited",
          ]),
          gte(auditLogs.createdAt, since),
        ),
      );
    return row?.count ?? 0;
  }

  // Aggregates declaration-read brute-force audit rows by source IP. Same
  // shape as getFailedAdminLoginsByIp — the "active rate-limit" badge is
  // inferred from whether the IP triggered any throttle row inside the
  // limiter's lockout window (15min, matching the in-memory limiter).
  async getDeclarationReadAttemptsByIp(
    since: Date,
    throttleSince: Date,
    limit = 200,
  ): Promise<DeclarationReadByIp[]> {
    const safeLimit = Math.min(Math.max(1, limit), 500);
    const aggregateSince =
      throttleSince.getTime() < since.getTime() ? throttleSince : since;

    const rows = await db
      .select({
        ipAddress: auditLogs.ipAddress,
        attemptCount: sql<number>`count(*) filter (where ${auditLogs.createdAt} >= ${since})::int`,
        unauthorizedCount: sql<number>`count(*) filter (where ${auditLogs.action} = 'declaration_read_unauthorized' and ${auditLogs.createdAt} >= ${since})::int`,
        rateLimitedCount: sql<number>`count(*) filter (where ${auditLogs.action} = 'declaration_read_rate_limited' and ${auditLogs.createdAt} >= ${since})::int`,
        // array_agg(distinct ...) over text — drops nulls naturally.
        distinctCaseIds: sql<string[]>`array_agg(distinct ${auditLogs.targetId}) filter (where ${auditLogs.createdAt} >= ${since} and ${auditLogs.targetId} is not null)`,
        firstAttemptAt: sql<Date>`min(${auditLogs.createdAt}) filter (where ${auditLogs.createdAt} >= ${since})`,
        lastAttemptAt: sql<Date>`max(${auditLogs.createdAt}) filter (where ${auditLogs.createdAt} >= ${since})`,
        recentThrottleCount: sql<number>`count(*) filter (where ${auditLogs.action} = 'declaration_read_rate_limited' and ${auditLogs.createdAt} >= ${throttleSince})::int`,
        // The credentialType is JSON-encoded inside new_value, so we let
        // Postgres extract it via jsonb path so we can group on it without
        // shipping every row to the application layer.
        // Correlated subquery: groups credential types per outer IP.
        // The RHS of the correlation predicate hard-codes the outer
        // `audit_logs.ip_address` rather than `${auditLogs.ipAddress}`
        // because drizzle renders the latter as a bare `"ip_address"`,
        // which Postgres resolves to the inner `inner_logs` alias and
        // collapses every IP into a single global rollup.
        //
        // Task #115 audit: this is the ONLY correlated subquery in the
        // server tree that interpolates a Drizzle table object with a
        // local alias inside a sql template (`from ${table} alias`). If
        // a second instance is ever introduced, replicate the same
        // hard-coded outer-table-name pattern on its correlation
        // predicate to avoid this silent failure mode.
        credentialTypeCounts: sql<Record<string, number>>`(
          select coalesce(jsonb_object_agg(ct, c), '{}'::jsonb)
          from (
            select coalesce(inner_logs.new_value::jsonb ->> 'credentialType', 'unknown') as ct,
                   count(*)::int as c
            from ${auditLogs} inner_logs
            where inner_logs.ip_address = audit_logs.ip_address
              and inner_logs.action = 'declaration_read_unauthorized'
              and inner_logs.created_at >= ${since}
            group by ct
          ) sub
        )`,
      })
      .from(auditLogs)
      .where(
        and(
          inArray(auditLogs.action, [
            "declaration_read_unauthorized",
            "declaration_read_rate_limited",
          ]),
          gte(auditLogs.createdAt, aggregateSince),
          sql`${auditLogs.ipAddress} is not null`,
        ),
      )
      .groupBy(auditLogs.ipAddress)
      .having(sql`count(*) filter (where ${auditLogs.createdAt} >= ${since}) > 0`)
      .orderBy(sql`count(*) filter (where ${auditLogs.createdAt} >= ${since}) desc`)
      .limit(safeLimit);

    return rows.map((row) => {
      const distinctCaseIds = (row.distinctCaseIds ?? []).filter(
        (c): c is string => typeof c === "string" && c.length > 0,
      );
      const credentialTypeCounts: Record<string, number> = {};
      const raw = row.credentialTypeCounts ?? {};
      for (const [k, v] of Object.entries(raw)) {
        // jsonb_object_agg gives us number | string in the wire payload,
        // so coerce defensively before exposing it to the client.
        const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
        if (Number.isFinite(n) && n > 0) credentialTypeCounts[k] = n;
      }
      return {
        ipAddress: row.ipAddress ?? "unknown",
        attemptCount: row.attemptCount,
        unauthorizedCount: row.unauthorizedCount,
        rateLimitedCount: row.rateLimitedCount,
        distinctCaseCount: distinctCaseIds.length,
        distinctCaseIds: distinctCaseIds.slice(0, 25),
        credentialTypeCounts,
        firstAttemptAt: row.firstAttemptAt,
        lastAttemptAt: row.lastAttemptAt,
        isThrottled: row.recentThrottleCount > 0,
      };
    });
  }

  // Retention sweep for the audit_logs table. Deletes any rows whose
  // created_at is strictly older than `cutoff` and returns the total number
  // of rows removed across all batches.
  //
  // Implementation notes:
  // - We delete in capped batches (default 5_000 rows) using a CTE-driven
  //   `WHERE id IN (SELECT id ... LIMIT N)` pattern. This keeps each
  //   transaction short, prevents a single sweep from holding a long lock
  //   on the audit_logs table, and bounds peak memory regardless of how
  //   large the backlog is on first run.
  // - We rely on the rowCount returned by the driver (no `RETURNING id`)
  //   so we don't materialize potentially huge id payloads.
  // - The audit_logs_created_at_idx index defined on the table keeps the
  //   inner SELECT cheap even as the table grows.
  //
  // Callers choose `cutoff` from a configurable retention window
  // (see AUDIT_LOG_RETENTION_DAYS in server/index.ts) so this helper stays
  // policy-free.
  async pruneAuditLogsOlderThan(
    cutoff: Date,
    batchSize: number = 5000,
  ): Promise<number> {
    let total = 0;
    // Defensive cap on iterations — even at 5k/batch this allows pruning
    // up to 5M rows per call, far beyond any realistic single sweep.
    const MAX_BATCHES = 1000;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const result = await db.execute(sql`
        DELETE FROM audit_logs
        WHERE id IN (
          SELECT id FROM audit_logs
          WHERE created_at < ${cutoff}
          LIMIT ${batchSize}
        )
      `);
      const removed = (result as { rowCount?: number | null }).rowCount ?? 0;
      total += removed;
      if (removed < batchSize) break;
    }
    return total;
  }

  // Task #126 — prune community participant rows whose owning case has
  // been sealed, completed, or had its last activity (updated_at) before
  // `cutoff`. The FK on community_reactions.participant_id is ON DELETE
  // CASCADE so any "Like / Helpful / Thanks" reactions the user authored
  // go away with the participant row in the same transaction. Earned
  // badges cascade the same way.
  //
  // Returns both the row count and the list of case_ids actually removed
  // so the scheduled sweep can write a single audit row per batch with
  // the targets, capped to a reasonable size to keep the audit payload
  // manageable.
  //
  // Skipped explicitly:
  //   * NULL case_id rows (admin-created handles, bot scaffolding) — they
  //     have no owning case to "abandon".
  //   * cases whose status is NOT sealed/completed AND whose updated_at
  //     is more recent than cutoff — still active, leave alone.
  async pruneCommunityParticipantsForInactiveCases(
    cutoff: Date,
    batchSize: number = 500,
    executor: DbExecutor = db,
  ): Promise<{ removed: number; caseIds: string[] }> {
    // Single DELETE … RETURNING. The participant table is small (bounded
    // by the number of cases that have ever posted), so we don't need
    // the batched loop the audit-log sweep uses. The LIMIT in the inner
    // SELECT is a safety cap in case the sealed/completed backlog is
    // unexpectedly large on first run.
    const result = await executor.execute(sql`
      DELETE FROM community_participants
      WHERE id IN (
        SELECT cp.id
        FROM community_participants cp
        JOIN cases c ON c.id = cp.case_id
        WHERE cp.case_id IS NOT NULL
          AND (
            c.sealed_at IS NOT NULL
            OR c.status = 'completed'
            OR c.status = 'sealed'
          )
          AND c.updated_at < ${cutoff}
        LIMIT ${batchSize}
      )
      RETURNING case_id
    `);
    const rows = ((result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<{ case_id: string | null }>;
    const caseIds = rows
      .map((r) => r.case_id)
      .filter((id): id is string => typeof id === "string");
    return { removed: rows.length, caseIds };
  }

  // Task #130 — read-only sibling to pruneCommunityParticipantsForInactiveCases
  // used by the admin Settings card to show "how many rows would be removed
  // right now at the current window". The WHERE clause is intentionally
  // identical to the prune query (minus the LIMIT) so the displayed number
  // matches what the next sweep would actually delete.
  async countCommunityParticipantsForInactiveCases(
    cutoff: Date,
  ): Promise<number> {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM community_participants cp
      JOIN cases c ON c.id = cp.case_id
      WHERE cp.case_id IS NOT NULL
        AND (
          c.sealed_at IS NOT NULL
          OR c.status = 'completed'
          OR c.status = 'sealed'
        )
        AND c.updated_at < ${cutoff}
    `);
    const rows = ((result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<{ count: number | string }>;
    if (rows.length === 0) return 0;
    const raw = rows[0].count;
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : 0;
  }

  async clearAllLogs(): Promise<void> {
    await db.delete(activityLogs);
    await db.delete(chatMessages);
  }

  // Message template operations
  async createMessageTemplate(data: InsertMessageTemplate): Promise<MessageTemplate> {
    const [template] = await db.insert(messageTemplates).values(data).returning();
    return template;
  }

  async getAllMessageTemplates(): Promise<MessageTemplate[]> {
    return await db.select().from(messageTemplates).orderBy(desc(messageTemplates.createdAt));
  }

  async getMessageTemplatesByCategory(category: string): Promise<MessageTemplate[]> {
    return await db.select().from(messageTemplates).where(eq(messageTemplates.category, category)).orderBy(desc(messageTemplates.createdAt));
  }

  async updateMessageTemplate(id: number, data: Partial<InsertMessageTemplate>): Promise<MessageTemplate | undefined> {
    const [updated] = await db.update(messageTemplates).set({ ...data, updatedAt: new Date() }).where(eq(messageTemplates.id, id)).returning();
    return updated;
  }

  async deleteMessageTemplate(id: number): Promise<void> {
    await db.delete(messageTemplates).where(eq(messageTemplates.id, id));
  }

  // Document request operations
  async createDocumentRequest(
    data: InsertDocumentRequest,
    executor: DbExecutor = db,
  ): Promise<DocumentRequest> {
    const [request] = await executor.insert(documentRequests).values(data).returning();
    return request;
  }

  async getDocumentRequestsByCaseId(caseId: string): Promise<DocumentRequest[]> {
    return await db.select().from(documentRequests).where(eq(documentRequests.caseId, caseId)).orderBy(desc(documentRequests.createdAt));
  }

  async getAllDocumentRequests(): Promise<DocumentRequest[]> {
    // Project out the base64 file blob so the admin polling endpoint never
    // ships multi-megabyte payloads. Admins lazy-fetch the blob via the
    // per-id GET when they hit Preview / Download. A boolean
    // `hasSubmittedFile` lets the admin UI show the Preview/Download
    // controls without exposing the bytes themselves.
    const rows = await db
      .select({
        id: documentRequests.id,
        caseId: documentRequests.caseId,
        documentType: documentRequests.documentType,
        description: documentRequests.description,
        status: documentRequests.status,
        deadline: documentRequests.deadline,
        submittedAt: documentRequests.submittedAt,
        submittedFileName: documentRequests.submittedFileName,
        approvedAt: documentRequests.approvedAt,
        adminNotes: documentRequests.adminNotes,
        uploadsEnabled: documentRequests.uploadsEnabled,
        createdAt: documentRequests.createdAt,
        hasSubmittedFile: sql<boolean>`${documentRequests.submittedFileData} is not null`,
      })
      .from(documentRequests)
      .orderBy(desc(documentRequests.createdAt));
    return rows.map((r) => ({
      ...r,
      submittedFileData: null,
    })) as unknown as DocumentRequest[];
  }

  async getDocumentRequestById(id: number): Promise<DocumentRequest | undefined> {
    const [row] = await db.select().from(documentRequests).where(eq(documentRequests.id, id)).limit(1);
    return row;
  }

  async updateDocumentRequest(id: number, data: Partial<InsertDocumentRequest>, executor: DbExecutor = db): Promise<DocumentRequest | undefined> {
    const [updated] = await executor.update(documentRequests).set(data).where(eq(documentRequests.id, id)).returning();
    return updated;
  }

  // Null out the base64 file blob for approved document requests whose
  // submission is older than the cutoff. Keeps every other column intact
  // (filename, notes, status, audit-log breadcrumbs) so the compliance
  // record is preserved while the heavy text payload is freed. Returns
  // the number of rows affected so the sweep can log it.
  async archiveOldApprovedDocumentBlobs(cutoff: Date): Promise<number> {
    // Retention is measured from approval time. For rows reviewed before
    // the approved_at column existed we fall back to submitted_at via
    // COALESCE so legacy data still ages out instead of being permanently
    // exempt.
    const result = await db.update(documentRequests)
      .set({ submittedFileData: null })
      .where(and(
        eq(documentRequests.status, 'approved'),
        isNotNull(documentRequests.submittedFileData),
        sql`COALESCE(${documentRequests.approvedAt}, ${documentRequests.submittedAt}) < ${cutoff}`,
      ))
      .returning({ id: documentRequests.id });
    return result.length;
  }

  // User session operations
  async createUserSession(
    data: InsertUserSession,
    executor: DbExecutor = db,
  ): Promise<UserSession> {
    const [session] = await executor.insert(userSessions).values(data).returning();
    return session;
  }

  async getUserSessionsByCaseId(caseId: string): Promise<UserSession[]> {
    return await db.select().from(userSessions).where(eq(userSessions.caseId, caseId)).orderBy(desc(userSessions.createdAt));
  }

  async getAllUserSessions(): Promise<UserSession[]> {
    return await db.select().from(userSessions).orderBy(desc(userSessions.createdAt));
  }

  async invalidateUserSession(id: number): Promise<void> {
    await db.update(userSessions).set({ isActive: false }).where(eq(userSessions.id, id));
  }

  async invalidateAllUserSessions(
    caseId: string,
    executor: DbExecutor = db,
  ): Promise<void> {
    await executor.update(userSessions).set({ isActive: false }).where(eq(userSessions.caseId, caseId));
  }

  async deactivateUserSession(
    id: number,
    executor: DbExecutor = db,
  ): Promise<UserSession | undefined> {
    const [updated] = await executor.update(userSessions).set({ isActive: false }).where(eq(userSessions.id, id)).returning();
    return updated;
  }

  // Scheduled message operations
  async createScheduledMessage(data: InsertScheduledMessage): Promise<ScheduledMessage> {
    const [message] = await db.insert(scheduledMessages).values(data).returning();
    return message;
  }

  async getScheduledMessagesByCaseId(caseId: string): Promise<ScheduledMessage[]> {
    return await db.select().from(scheduledMessages).where(eq(scheduledMessages.caseId, caseId)).orderBy(desc(scheduledMessages.scheduledFor));
  }

  async getPendingScheduledMessages(): Promise<ScheduledMessage[]> {
    return await db.select().from(scheduledMessages)
      .where(and(eq(scheduledMessages.status, 'pending'), lt(scheduledMessages.scheduledFor, new Date())))
      .orderBy(scheduledMessages.scheduledFor);
  }

  async updateScheduledMessage(id: number, data: Partial<InsertScheduledMessage>): Promise<ScheduledMessage | undefined> {
    const [updated] = await db.update(scheduledMessages).set(data).where(eq(scheduledMessages.id, id)).returning();
    return updated;
  }

  async cancelScheduledMessage(id: number): Promise<ScheduledMessage | undefined> {
    const [updated] = await db.update(scheduledMessages).set({ status: 'cancelled' }).where(eq(scheduledMessages.id, id)).returning();
    return updated;
  }

  // Help article operations
  async createHelpArticle(data: InsertHelpArticle): Promise<HelpArticle> {
    const [article] = await db.insert(helpArticles).values(data).returning();
    return article;
  }

  async getAllHelpArticles(): Promise<HelpArticle[]> {
    return await db.select().from(helpArticles).where(eq(helpArticles.isPublished, true)).orderBy(helpArticles.order);
  }

  async getHelpArticlesByCategory(category: string): Promise<HelpArticle[]> {
    return await db.select().from(helpArticles)
      .where(and(eq(helpArticles.category, category), eq(helpArticles.isPublished, true)))
      .orderBy(helpArticles.order);
  }

  async getHelpArticleById(id: number): Promise<HelpArticle | undefined> {
    const [article] = await db.select().from(helpArticles).where(eq(helpArticles.id, id));
    return article;
  }

  async updateHelpArticle(id: number, data: Partial<InsertHelpArticle>): Promise<HelpArticle | undefined> {
    const [updated] = await db.update(helpArticles).set({ ...data, updatedAt: new Date() }).where(eq(helpArticles.id, id)).returning();
    return updated;
  }

  async deleteHelpArticle(id: number): Promise<void> {
    await db.delete(helpArticles).where(eq(helpArticles.id, id));
  }

  // Notification operations
  async createNotification(data: InsertNotification): Promise<Notification> {
    const [notification] = await db.insert(notifications).values(data).returning();
    return notification;
  }

  async getNotificationById(id: number): Promise<Notification | undefined> {
    const [row] = await db.select().from(notifications).where(eq(notifications.id, id));
    return row;
  }

  async getNotificationsByRecipient(recipientType: string, recipientId: string): Promise<Notification[]> {
    return await db.select().from(notifications)
      .where(and(eq(notifications.recipientType, recipientType), eq(notifications.recipientId, recipientId)))
      .orderBy(desc(notifications.createdAt));
  }

  async markNotificationAsRead(id: number): Promise<void> {
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
  }

  async markAllNotificationsAsRead(recipientType: string, recipientId: string): Promise<void> {
    await db.update(notifications).set({ isRead: true })
      .where(and(eq(notifications.recipientType, recipientType), eq(notifications.recipientId, recipientId)));
  }

  async clearAllAdminNotifications(): Promise<void> {
    await db.delete(notifications)
      .where(and(eq(notifications.recipientType, 'admin'), eq(notifications.recipientId, 'admin')));
  }

  async getUnreadNotificationCount(recipientType: string, recipientId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(
        eq(notifications.recipientType, recipientType),
        eq(notifications.recipientId, recipientId),
        eq(notifications.isRead, false)
      ));
    return result[0]?.count || 0;
  }

  // User feedback operations
  async createUserFeedback(data: InsertUserFeedback): Promise<UserFeedback> {
    const [feedback] = await db.insert(userFeedback).values(data).returning();
    return feedback;
  }

  async getUserFeedbackByCaseId(caseId: string): Promise<UserFeedback[]> {
    return await db.select().from(userFeedback).where(eq(userFeedback.caseId, caseId)).orderBy(desc(userFeedback.createdAt));
  }

  async getAllUserFeedback(): Promise<UserFeedback[]> {
    return await db.select().from(userFeedback).orderBy(desc(userFeedback.createdAt));
  }

  // Admin session operations
  async createAdminSession(
    data: InsertAdminSession,
    executor: DbExecutor = db,
  ): Promise<AdminSession> {
    const [session] = await executor.insert(adminSessions).values(data).returning();
    return session;
  }

  async getAdminSessionsByUsername(username: string): Promise<AdminSession[]> {
    return await db.select().from(adminSessions)
      .where(eq(adminSessions.adminUsername, username))
      .orderBy(desc(adminSessions.createdAt));
  }

  async getAdminSessionByToken(token: string): Promise<AdminSession | undefined> {
    const [session] = await db.select().from(adminSessions)
      .where(and(eq(adminSessions.token, token), eq(adminSessions.isActive, true)));
    return session;
  }

  async getActiveAdminSessions(username: string): Promise<AdminSession[]> {
    return await db.select().from(adminSessions)
      .where(and(
        eq(adminSessions.adminUsername, username),
        eq(adminSessions.isActive, true),
        isNull(adminSessions.revokedAt)
      ))
      .orderBy(desc(adminSessions.lastActivityAt));
  }

  async updateAdminSessionActivity(id: string): Promise<void> {
    await db.update(adminSessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(adminSessions.id, id));
  }

  async revokeAdminSession(
    id: string,
    reason?: string,
    executor: DbExecutor = db,
  ): Promise<void> {
    await executor.update(adminSessions)
      .set({ isActive: false, revokedAt: new Date(), revokedReason: reason })
      .where(eq(adminSessions.id, id));
  }

  async revokeAllAdminSessions(
    username: string,
    exceptId?: string,
    executor: DbExecutor = db,
  ): Promise<number> {
    // Always exclude already-revoked rows so revokedAt stays accurate (we
    // don't want to bump the timestamp on a row that was killed yesterday).
    // When exceptId is provided, also keep that one session alive — this is
    // how "sign out other sessions" preserves the caller's current token.
    const whereClause = exceptId
      ? and(
          eq(adminSessions.adminUsername, username),
          eq(adminSessions.isActive, true),
          ne(adminSessions.id, exceptId),
        )
      : and(
          eq(adminSessions.adminUsername, username),
          eq(adminSessions.isActive, true),
        );
    const updated = await executor
      .update(adminSessions)
      .set({ isActive: false, revokedAt: new Date(), revokedReason: 'Bulk revoke' })
      .where(whereClause)
      .returning({ id: adminSessions.id });
    return updated.length;
  }

  async revokeNonCanonicalAdminSessions(canonicalUsername: string): Promise<number> {
    const updated = await db
      .update(adminSessions)
      .set({
        isActive: false,
        revokedAt: new Date(),
        revokedReason: 'Non-canonical username — revoked at startup',
      })
      .where(
        and(
          ne(adminSessions.adminUsername, canonicalUsername),
          eq(adminSessions.isActive, true),
        ),
      )
      .returning({ id: adminSessions.id });
    return updated.length;
  }

  // Delete admin sessions that are no longer useful so the table doesn't grow
  // unbounded. Two cohorts qualify:
  //   1) past their `expires_at` deadline (the middleware already rejects them)
  //   2) revoked more than `revokedRetentionDays` ago (default 30 days) — kept
  //      around briefly so admins can audit recent revocations
  // Returns the number of rows removed.
  async deleteExpiredAdminSessions(revokedRetentionDays: number = 30): Promise<number> {
    const now = new Date();
    const revokedCutoff = new Date(now.getTime() - revokedRetentionDays * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(adminSessions)
      .where(
        or(
          lt(adminSessions.expiresAt, now),
          lt(adminSessions.revokedAt, revokedCutoff),
        ),
      )
      .returning({ id: adminSessions.id });
    return deleted.length;
  }

  // Load every login-attempt row whose cool-down hasn't expired yet so the
  // limiter middleware can rebuild its in-memory cache after a restart.
  async getActiveAdminLoginAttempts(): Promise<AdminLoginAttempt[]> {
    return await db
      .select()
      .from(adminLoginAttempts)
      .where(gte(adminLoginAttempts.resetAt, new Date()));
  }

  // Single-key lookup used by per-request live enforcement so any instance
  // can see another instance's accumulated count without a full table scan.
  async getAdminLoginAttemptByKey(key: string): Promise<AdminLoginAttempt | undefined> {
    const [row] = await db
      .select()
      .from(adminLoginAttempts)
      .where(eq(adminLoginAttempts.key, key));
    return row;
  }

  // Reset a specific rate-limit counter (e.g. on successful authentication).
  // Fire-and-forget by callers; a failed delete is non-fatal — the row expires
  // naturally when resetAt passes.
  async clearAdminLoginAttemptKey(key: string): Promise<void> {
    await db
      .delete(adminLoginAttempts)
      .where(eq(adminLoginAttempts.key, key));
  }

  // Atomic additive increment in a single SQL round-trip. Uses count+1
  // (not GREATEST) so every instance's writes accumulate correctly even under
  // concurrent autoscale traffic. Handles two modes:
  //   - Simple window (no lockout): reset_at stays fixed for the window.
  //   - Window + lockout: when the new count reaches maxCount the reset_at is
  //     extended to lockoutResetAt so the attacker stays locked beyond the
  //     normal window end.
  // The RETURNING clause gives the caller the authoritative post-increment
  // values so no second read is needed to decide allow vs. deny.
  async atomicIncrementRateLimit(params: {
    key: string;
    windowResetAt: Date;
    lockoutResetAt?: Date;
    maxCount?: number;
  }): Promise<{ count: number; resetAt: Date }> {
    const { key, windowResetAt, lockoutResetAt, maxCount } = params;
    const useWindowEnd = sql`${windowResetAt}::timestamptz`;
    const now = new Date();

    let result: { rows: Array<{ count: unknown; reset_at: unknown }> };
    if (lockoutResetAt !== undefined && maxCount !== undefined) {
      const useLockoutEnd = sql`${lockoutResetAt}::timestamptz`;
      const useMaxCount = sql`${maxCount}::int`;
      result = await db.execute(sql`
        INSERT INTO admin_login_attempts (key, count, reset_at, updated_at)
        VALUES (${key}, 1, ${useWindowEnd}, ${now}::timestamptz)
        ON CONFLICT (key) DO UPDATE SET
          count = CASE
            WHEN admin_login_attempts.reset_at <= NOW() THEN 1
            ELSE admin_login_attempts.count + 1
          END,
          reset_at = CASE
            WHEN admin_login_attempts.reset_at <= NOW() THEN ${useWindowEnd}
            WHEN admin_login_attempts.count + 1 >= ${useMaxCount} THEN ${useLockoutEnd}
            ELSE admin_login_attempts.reset_at
          END,
          updated_at = ${now}::timestamptz
        RETURNING count, reset_at
      `) as { rows: Array<{ count: unknown; reset_at: unknown }> };
    } else {
      result = await db.execute(sql`
        INSERT INTO admin_login_attempts (key, count, reset_at, updated_at)
        VALUES (${key}, 1, ${useWindowEnd}, ${now}::timestamptz)
        ON CONFLICT (key) DO UPDATE SET
          count = CASE
            WHEN admin_login_attempts.reset_at <= NOW() THEN 1
            ELSE admin_login_attempts.count + 1
          END,
          reset_at = CASE
            WHEN admin_login_attempts.reset_at <= NOW() THEN ${useWindowEnd}
            ELSE admin_login_attempts.reset_at
          END,
          updated_at = ${now}::timestamptz
        RETURNING count, reset_at
      `) as { rows: Array<{ count: unknown; reset_at: unknown }> };
    }

    const row = result.rows[0];
    return {
      count: Number(row.count),
      resetAt: row.reset_at instanceof Date ? row.reset_at : new Date(row.reset_at as string),
    };
  }

  // Write-through path used by the limiter on every counter change. The PK is
  // the cache key, so an upsert keeps exactly one row per (namespace, ip,
  // route) tuple.
  //
  // The merge is intentionally MONOTONIC because the limiter fires writes
  // off as fire-and-forget — under DB latency, an older upsert can land
  // after a newer one in the same window. To stop a stale write from
  // rolling the counter backward (which would weaken the lockout) we:
  //   - keep the highest `reset_at` we've ever seen (windows only move
  //     forward, never backward), and
  //   - within the same window, take MAX(existing.count, incoming.count);
  //     when the incoming `reset_at` is strictly newer than what's stored,
  //     it's a brand-new window so we accept the incoming count verbatim
  //     (which will typically be 1 — the first hit of the new window).
  async upsertAdminLoginAttempt(attempt: {
    key: string;
    count: number;
    resetAt: Date;
  }): Promise<void> {
    await db
      .insert(adminLoginAttempts)
      .values({
        key: attempt.key,
        count: attempt.count,
        resetAt: attempt.resetAt,
      })
      .onConflictDoUpdate({
        target: adminLoginAttempts.key,
        set: {
          count: sql`CASE WHEN EXCLUDED.reset_at > ${adminLoginAttempts.resetAt} THEN EXCLUDED.count ELSE GREATEST(${adminLoginAttempts.count}, EXCLUDED.count) END`,
          resetAt: sql`GREATEST(${adminLoginAttempts.resetAt}, EXCLUDED.reset_at)`,
          updatedAt: new Date(),
        },
      });
  }

  // Periodically clear out expired counter rows so the table doesn't grow
  // unbounded — every brute-force IP would otherwise leave a row behind once
  // its cool-down ended.
  async deleteExpiredAdminLoginAttempts(): Promise<number> {
    const deleted = await db
      .delete(adminLoginAttempts)
      .where(lt(adminLoginAttempts.resetAt, new Date()))
      .returning({ key: adminLoginAttempts.key });
    return deleted.length;
  }

  // Admin 2FA operations
  async getAdminTwoFactor(username: string): Promise<AdminTwoFactor | undefined> {
    const [twoFactor] = await db.select().from(adminTwoFactor)
      .where(eq(adminTwoFactor.adminUsername, username));
    return twoFactor;
  }

  async createAdminTwoFactor(data: InsertAdminTwoFactor): Promise<AdminTwoFactor> {
    const [created] = await db.insert(adminTwoFactor).values(data).returning();
    return created;
  }

  async updateAdminTwoFactor(username: string, data: Partial<InsertAdminTwoFactor>): Promise<AdminTwoFactor | undefined> {
    const [updated] = await db.update(adminTwoFactor)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(adminTwoFactor.adminUsername, username))
      .returning();
    return updated;
  }

  async deleteAdminTwoFactor(username: string): Promise<void> {
    await db.delete(adminTwoFactor).where(eq(adminTwoFactor.adminUsername, username));
  }

  // Chat template operations
  async createChatTemplate(data: InsertChatTemplate): Promise<ChatTemplate> {
    const [template] = await db.insert(chatTemplates).values(data).returning();
    return template;
  }

  async getAllChatTemplates(): Promise<ChatTemplate[]> {
    return await db.select().from(chatTemplates)
      .where(eq(chatTemplates.isActive, true))
      .orderBy(chatTemplates.name);
  }

  async getChatTemplatesByCategory(category: string): Promise<ChatTemplate[]> {
    return await db.select().from(chatTemplates)
      .where(and(eq(chatTemplates.category, category), eq(chatTemplates.isActive, true)))
      .orderBy(chatTemplates.name);
  }

  async updateChatTemplate(id: number, data: Partial<InsertChatTemplate>): Promise<ChatTemplate | undefined> {
    const [updated] = await db.update(chatTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(chatTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteChatTemplate(id: number): Promise<void> {
    await db.delete(chatTemplates).where(eq(chatTemplates.id, id));
  }

  async incrementTemplateUsage(id: number): Promise<void> {
    const [template] = await db.select().from(chatTemplates).where(eq(chatTemplates.id, id));
    if (template) {
      const currentCount = parseInt(template.usageCount || '0', 10);
      await db.update(chatTemplates)
        .set({ usageCount: String(currentCount + 1) })
        .where(eq(chatTemplates.id, id));
    }
  }

  // Case notes operations
  async createCaseNote(data: InsertCaseNote): Promise<CaseNote> {
    const [note] = await db.insert(caseNotes).values(data).returning();
    return note;
  }

  async getCaseNotesByCaseId(caseId: string): Promise<CaseNote[]> {
    return await db.select().from(caseNotes)
      .where(eq(caseNotes.caseId, caseId))
      .orderBy(desc(caseNotes.isPinned), desc(caseNotes.createdAt));
  }

  async updateCaseNote(id: number, data: Partial<InsertCaseNote>): Promise<CaseNote | undefined> {
    const [updated] = await db.update(caseNotes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(caseNotes.id, id))
      .returning();
    return updated;
  }

  async deleteCaseNote(id: number): Promise<void> {
    await db.delete(caseNotes).where(eq(caseNotes.id, id));
  }

  async toggleCaseNotePin(id: number): Promise<CaseNote | undefined> {
    const [note] = await db.select().from(caseNotes).where(eq(caseNotes.id, id));
    if (note) {
      const [updated] = await db.update(caseNotes)
        .set({ isPinned: !note.isPinned, updatedAt: new Date() })
        .where(eq(caseNotes.id, id))
        .returning();
      return updated;
    }
    return undefined;
  }

  // Translation operations
  async getTranslation(key: string, locale: string): Promise<Translation | undefined> {
    const [translation] = await db.select().from(translations)
      .where(and(eq(translations.key, key), eq(translations.locale, locale)));
    return translation;
  }

  async getTranslationsByLocale(locale: string): Promise<Translation[]> {
    return await db.select().from(translations)
      .where(eq(translations.locale, locale))
      .orderBy(translations.key);
  }

  async createTranslation(data: InsertTranslation): Promise<Translation> {
    const [translation] = await db.insert(translations).values(data).returning();
    return translation;
  }

  async updateTranslation(id: number, data: Partial<InsertTranslation>): Promise<Translation | undefined> {
    const [updated] = await db.update(translations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(translations.id, id))
      .returning();
    return updated;
  }

  async deleteTranslation(id: number): Promise<void> {
    await db.delete(translations).where(eq(translations.id, id));
  }

  // Newsletter subscriber operations
  async createNewsletterSubscriber(data: InsertNewsletterSubscriber): Promise<NewsletterSubscriber> {
    const [subscriber] = await db.insert(newsletterSubscribers).values(data).returning();
    return subscriber;
  }

  async getAllNewsletterSubscribers(): Promise<NewsletterSubscriber[]> {
    return await db.select().from(newsletterSubscribers).orderBy(desc(newsletterSubscribers.subscribedAt));
  }

  async unsubscribeNewsletter(email: string): Promise<void> {
    await db.update(newsletterSubscribers)
      .set({ isActive: false, unsubscribedAt: new Date() })
      .where(eq(newsletterSubscribers.email, email));
  }

  async updateNewsletterSubscriber(
    id: number,
    data: Partial<Pick<NewsletterSubscriber, "email" | "isActive" | "unsubscribedAt">>,
  ): Promise<NewsletterSubscriber> {
    const [subscriber] = await db
      .update(newsletterSubscribers)
      .set(data)
      .where(eq(newsletterSubscribers.id, id))
      .returning();
    return subscriber;
  }

  async deleteNewsletterSubscriber(id: number): Promise<NewsletterSubscriber | undefined> {
    const [deleted] = await db
      .delete(newsletterSubscribers)
      .where(eq(newsletterSubscribers.id, id))
      .returning();
    return deleted;
  }

  // Scam alert operations
  async createScamAlert(data: InsertScamAlert): Promise<ScamAlert> {
    const [alert] = await db.insert(scamAlerts).values(data).returning();
    return alert;
  }

  async getActiveScamAlerts(): Promise<ScamAlert[]> {
    return await db.select().from(scamAlerts)
      .where(eq(scamAlerts.isActive, true))
      .orderBy(desc(scamAlerts.createdAt));
  }

  async getAllScamAlerts(): Promise<ScamAlert[]> {
    return await db.select().from(scamAlerts).orderBy(desc(scamAlerts.createdAt));
  }

  async updateScamAlert(id: number, data: Partial<InsertScamAlert>): Promise<ScamAlert | undefined> {
    const [updated] = await db.update(scamAlerts).set(data).where(eq(scamAlerts.id, id)).returning();
    return updated;
  }

  async deleteScamAlert(id: number): Promise<void> {
    await db.delete(scamAlerts).where(eq(scamAlerts.id, id));
  }

  // Testimonial operations
  async createTestimonial(data: InsertTestimonial): Promise<Testimonial> {
    const [testimonial] = await db.insert(testimonials).values(data).returning();
    return testimonial;
  }

  async getApprovedTestimonials(): Promise<Testimonial[]> {
    return await db.select().from(testimonials)
      .where(eq(testimonials.isApproved, true))
      .orderBy(desc(testimonials.createdAt));
  }

  async getAllTestimonials(): Promise<Testimonial[]> {
    return await db.select().from(testimonials).orderBy(desc(testimonials.createdAt));
  }

  async updateTestimonial(id: number, data: Partial<InsertTestimonial>): Promise<Testimonial | undefined> {
    const [updated] = await db.update(testimonials).set(data).where(eq(testimonials.id, id)).returning();
    return updated;
  }

  async deleteTestimonial(id: number): Promise<void> {
    await db.delete(testimonials).where(eq(testimonials.id, id));
  }

  // Site statistics operations
  async getSiteStatistics(): Promise<SiteStatistic[]> {
    return await db.select().from(siteStatistics).orderBy(siteStatistics.displayOrder);
  }

  async getSiteStatisticByKey(key: string): Promise<SiteStatistic | undefined> {
    const [stat] = await db.select().from(siteStatistics).where(eq(siteStatistics.key, key));
    return stat;
  }

  async createSiteStatistic(data: InsertSiteStatistic): Promise<SiteStatistic> {
    const [stat] = await db.insert(siteStatistics).values(data).returning();
    return stat;
  }

  async updateSiteStatistic(id: number, data: Partial<InsertSiteStatistic>): Promise<SiteStatistic | undefined> {
    const [updated] = await db.update(siteStatistics).set({ ...data, updatedAt: new Date() }).where(eq(siteStatistics.id, id)).returning();
    return updated;
  }

  async deleteSiteStatistic(id: number): Promise<void> {
    await db.delete(siteStatistics).where(eq(siteStatistics.id, id));
  }

  // Contact submission operations
  async createContactSubmission(data: InsertContactSubmission): Promise<ContactSubmission> {
    const [submission] = await db.insert(contactSubmissions).values(data).returning();
    return submission;
  }

  async getAllContactSubmissions(): Promise<ContactSubmission[]> {
    return await db.select().from(contactSubmissions).orderBy(desc(contactSubmissions.createdAt));
  }

  async updateContactSubmission(id: number, data: Partial<InsertContactSubmission>): Promise<ContactSubmission | undefined> {
    const [updated] = await db.update(contactSubmissions).set(data).where(eq(contactSubmissions.id, id)).returning();
    return updated;
  }

  // Public complaint intake operations
  async createPublicComplaint(data: InsertPublicComplaint): Promise<PublicComplaint> {
    const [complaint] = await db.insert(publicComplaints).values(data).returning();
    return complaint;
  }

  async getAllPublicComplaints(): Promise<PublicComplaint[]> {
    return await db.select().from(publicComplaints).orderBy(desc(publicComplaints.createdAt));
  }

  async updatePublicComplaint(id: number, data: Partial<InsertPublicComplaint>): Promise<PublicComplaint | undefined> {
    const [updated] = await db.update(publicComplaints).set(data).where(eq(publicComplaints.id, id)).returning();
    return updated;
  }

  async deletePublicComplaint(id: number): Promise<void> {
    await db.delete(publicComplaints).where(eq(publicComplaints.id, id));
  }

  // FAQ operations
  async createFaqItem(data: InsertFaqItem): Promise<FaqItem> {
    const [item] = await db.insert(faqItems).values(data).returning();
    return item;
  }

  async getActiveFaqItems(): Promise<FaqItem[]> {
    return await db.select().from(faqItems)
      .where(eq(faqItems.isActive, true))
      .orderBy(faqItems.displayOrder);
  }

  async getAllFaqItems(): Promise<FaqItem[]> {
    return await db.select().from(faqItems).orderBy(faqItems.displayOrder);
  }

  async updateFaqItem(id: number, data: Partial<InsertFaqItem>): Promise<FaqItem | undefined> {
    const [updated] = await db.update(faqItems).set(data).where(eq(faqItems.id, id)).returning();
    return updated;
  }

  async deleteFaqItem(id: number): Promise<void> {
    await db.delete(faqItems).where(eq(faqItems.id, id));
  }

  // Active visitor operations
  //
  // Two browser tabs from the same visitor can race the heartbeat — both see
  // "no row exists" from the prior `getActiveVisitorByVisitorId` call and
  // both try to INSERT, tripping the `visitor_id` unique constraint. The
  // second insert used to surface as a noisy `duplicate key value violates`
  // error in the logs even though the data was fine. Upserting on the
  // unique key collapses both writes into one row and silences the noise.
  async createActiveVisitor(data: InsertActiveVisitor): Promise<ActiveVisitor> {
    const [visitor] = await db
      .insert(activeVisitors)
      .values(data)
      .onConflictDoUpdate({
        target: activeVisitors.visitorId,
        set: {
          // Only refresh fields that legitimately change between two
          // back-to-back inserts for the same visitor. Identity columns
          // (visitorId, sessionStartedAt) stay put.
          currentPage: data.currentPage,
          pageTitle: data.pageTitle,
          referrer: data.referrer,
          deviceType: data.deviceType,
          browser: data.browser,
          browserVersion: data.browserVersion,
          os: data.os,
          osVersion: data.osVersion,
          userAgent: data.userAgent,
          screenWidth: data.screenWidth,
          screenHeight: data.screenHeight,
          screenResolution: data.screenResolution,
          language: data.language,
          timezone: data.timezone,
          connectionType: data.connectionType,
          fingerprintHash: data.fingerprintHash,
          ipAddress: data.ipAddress,
          country: data.country,
          region: data.region,
          city: data.city,
          isp: data.isp,
          asn: data.asn,
          pagesViewed: data.pagesViewed,
          pageViewCount: data.pageViewCount,
          pageTimeline: data.pageTimeline,
          isIdle: data.isIdle,
          engagementScore: data.engagementScore,
          persona: data.persona,
          personaConfidence: data.personaConfidence,
          personaReasoning: data.personaReasoning,
          riskScore: data.riskScore,
          riskFlags: data.riskFlags,
          caseId: data.caseId,
          lastHeartbeatAt: data.lastHeartbeatAt ?? new Date(),
        },
      })
      .returning();
    return visitor;
  }

  // Shared stale-window for active_visitors. Any row whose last heartbeat
  // is older than this is considered ghost traffic. Must stay in sync with
  // STALE_VISITOR_TIMEOUT_MS in server/routes/visitors.ts (see replit.md).
  static readonly ACTIVE_VISITOR_STALE_MS = 60_000;

  async getActiveVisitors(): Promise<ActiveVisitor[]> {
    // Filter to rows with a recent heartbeat so stale attacker-created
    // rows cannot accumulate in admin-facing reads even before cleanup runs.
    const cutoff = new Date(Date.now() - DatabaseStorage.ACTIVE_VISITOR_STALE_MS);
    return await db
      .select()
      .from(activeVisitors)
      .where(gte(activeVisitors.lastHeartbeatAt, cutoff))
      .orderBy(desc(activeVisitors.lastHeartbeatAt));
  }

  async getActiveVisitorByVisitorId(visitorId: string): Promise<ActiveVisitor | undefined> {
    const [visitor] = await db.select().from(activeVisitors).where(eq(activeVisitors.visitorId, visitorId));
    return visitor;
  }

  async getActiveVisitorCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(activeVisitors);
    return Number(result[0]?.count || 0);
  }

  async updateActiveVisitor(id: number, data: Partial<InsertActiveVisitor>): Promise<ActiveVisitor | undefined> {
    const [updated] = await db.update(activeVisitors).set(data).where(eq(activeVisitors.id, id)).returning();
    return updated;
  }

  async deleteActiveVisitor(id: number): Promise<void> {
    await db.delete(activeVisitors).where(eq(activeVisitors.id, id));
  }

  async cleanupStaleVisitors(staleTimeout: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleTimeout);
    const stale = await db.select().from(activeVisitors).where(lt(activeVisitors.lastHeartbeatAt, cutoff));
    
    // Save to history before deleting
    for (const visitor of stale) {
      const sessionDuration = Math.floor(
        (new Date().getTime() - new Date(visitor.sessionStartedAt).getTime()) / 1000
      );
      await db.insert(visitorHistory).values({
        visitorId: visitor.visitorId,
        caseId: visitor.caseId,
        pagesViewed: visitor.pagesViewed,
        pageViewCount: visitor.pageViewCount || 0,
        sessionDuration,
        deviceType: visitor.deviceType,
        browser: visitor.browser,
        country: visitor.country,
        city: visitor.city,
        hadChat: visitor.hasActiveChat || false,
        sessionStartedAt: visitor.sessionStartedAt,
        sessionEndedAt: new Date(),
      });
    }
    
    await db.delete(activeVisitors).where(lt(activeVisitors.lastHeartbeatAt, cutoff));
    return stale.length;
  }

  // Visitor history operations
  async createVisitorHistory(data: InsertVisitorHistory): Promise<VisitorHistory> {
    const [history] = await db.insert(visitorHistory).values(data).returning();
    return history;
  }

  async getVisitorHistory(visitorId: string): Promise<VisitorHistory[]> {
    return await db.select().from(visitorHistory)
      .where(eq(visitorHistory.visitorId, visitorId))
      .orderBy(desc(visitorHistory.sessionEndedAt));
  }

  async getTodayVisitorStats(): Promise<{ totalVisitors: number; totalChats: number; avgSessionDuration: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const stats = await db.select({
      totalVisitors: sql<number>`count(*)`,
      totalChats: sql<number>`count(case when had_chat = true then 1 end)`,
      avgSessionDuration: sql<number>`avg(session_duration)`,
    }).from(visitorHistory);
    
    return {
      totalVisitors: Number(stats[0]?.totalVisitors || 0),
      totalChats: Number(stats[0]?.totalChats || 0),
      avgSessionDuration: Number(stats[0]?.avgSessionDuration || 0),
    };
  }

  // Paginated, filtered list of visit history rows for the admin
  // "Visit History" view. The `search` term matches IP, visitorId, country,
  // city, browser and persona via case-insensitive ILIKE. Filters are
  // composable. The `total` is the count matching the same WHERE clause so
  // the UI can render correct pagination.
  async listVisitorHistory(opts: {
    limit: number;
    offset: number;
    search?: string;
    country?: string;
    persona?: string;
    minRisk?: number;
  }): Promise<{ rows: VisitorHistory[]; total: number }> {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const offset = Math.max(0, opts.offset ?? 0);

    const conds: any[] = [];
    if (opts.search && opts.search.trim().length > 0) {
      const term = `%${opts.search.trim()}%`;
      conds.push(
        or(
          sql`${visitorHistory.ipAddress} ILIKE ${term}`,
          sql`${visitorHistory.visitorId} ILIKE ${term}`,
          sql`${visitorHistory.country} ILIKE ${term}`,
          sql`${visitorHistory.city} ILIKE ${term}`,
          sql`${visitorHistory.browser} ILIKE ${term}`,
          sql`${visitorHistory.persona} ILIKE ${term}`,
        ),
      );
    }
    if (opts.country) conds.push(eq(visitorHistory.country, opts.country));
    if (opts.persona) conds.push(eq(visitorHistory.persona, opts.persona));
    if (typeof opts.minRisk === "number" && opts.minRisk > 0) {
      conds.push(gte(visitorHistory.riskScore, opts.minRisk));
    }
    const whereClause = conds.length > 0 ? and(...conds) : undefined;

    const rowsPromise = db
      .select()
      .from(visitorHistory)
      .where(whereClause as any)
      .orderBy(desc(visitorHistory.sessionStartedAt))
      .limit(limit)
      .offset(offset);

    const totalPromise = db
      .select({ c: sql<number>`count(*)` })
      .from(visitorHistory)
      .where(whereClause as any);

    const [rows, totalRows] = await Promise.all([rowsPromise, totalPromise]);
    return { rows, total: Number(totalRows[0]?.c ?? 0) };
  }

  async getVisitorHistoryById(id: number): Promise<VisitorHistory | undefined> {
    const [row] = await db.select().from(visitorHistory).where(eq(visitorHistory.id, id));
    return row;
  }

  // Stats for the Visitor Insights stats tiles. Window is the trailing
  // `sinceDays` from now. Top countries/personas are top-5.
  async getVisitorHistoryStats(sinceDays: number): Promise<{
    totalSessions: number;
    uniqueIps: number;
    uniqueVisitors: number;
    topCountries: Array<{ country: string; count: number }>;
    topPersonas: Array<{ persona: string; count: number }>;
    avgRisk: number;
    highRiskCount: number;
  }> {
    const since = new Date(Date.now() - Math.max(1, sinceDays) * 24 * 60 * 60 * 1000);

    const [agg] = await db
      .select({
        totalSessions: sql<number>`count(*)`,
        uniqueIps: sql<number>`count(distinct ${visitorHistory.ipAddress})`,
        uniqueVisitors: sql<number>`count(distinct ${visitorHistory.visitorId})`,
        avgRisk: sql<number>`coalesce(avg(${visitorHistory.riskScore}), 0)`,
        highRiskCount: sql<number>`count(case when ${visitorHistory.riskScore} >= 50 then 1 end)`,
      })
      .from(visitorHistory)
      .where(gte(visitorHistory.sessionStartedAt, since));

    const topCountries = await db
      .select({
        country: visitorHistory.country,
        count: sql<number>`count(*)`,
      })
      .from(visitorHistory)
      .where(and(gte(visitorHistory.sessionStartedAt, since), sql`${visitorHistory.country} is not null`))
      .groupBy(visitorHistory.country)
      .orderBy(sql`count(*) desc`)
      .limit(5);

    const topPersonas = await db
      .select({
        persona: visitorHistory.persona,
        count: sql<number>`count(*)`,
      })
      .from(visitorHistory)
      .where(and(gte(visitorHistory.sessionStartedAt, since), sql`${visitorHistory.persona} is not null`))
      .groupBy(visitorHistory.persona)
      .orderBy(sql`count(*) desc`)
      .limit(5);

    return {
      totalSessions: Number(agg?.totalSessions ?? 0),
      uniqueIps: Number(agg?.uniqueIps ?? 0),
      uniqueVisitors: Number(agg?.uniqueVisitors ?? 0),
      topCountries: topCountries
        .filter((r) => r.country)
        .map((r) => ({ country: r.country as string, count: Number(r.count) })),
      topPersonas: topPersonas
        .filter((r) => r.persona)
        .map((r) => ({ persona: r.persona as string, count: Number(r.count) })),
      avgRisk: Math.round(Number(agg?.avgRisk ?? 0)),
      highRiskCount: Number(agg?.highRiskCount ?? 0),
    };
  }

  // Retention sweep for visitor_history. Same batched DELETE pattern as
  // pruneAuditLogsOlderThan — bounded memory, short locks, driver
  // rowCount accounting.
  async pruneVisitorHistoryOlderThan(cutoff: Date, batchSize: number = 5000): Promise<number> {
    let total = 0;
    const MAX_BATCHES = 1000;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const result = await db.execute(sql`
        DELETE FROM visitor_history
        WHERE id IN (
          SELECT id FROM visitor_history
          WHERE session_started_at < ${cutoff}
          LIMIT ${batchSize}
        )
      `);
      const removed = (result as { rowCount?: number | null }).rowCount ?? 0;
      total += removed;
      if (removed < batchSize) break;
    }
    return total;
  }

  // Blocked visitor operations
  async createBlockedVisitor(data: InsertBlockedVisitor): Promise<BlockedVisitor> {
    const [blocked] = await db.insert(blockedVisitors).values(data).returning();
    return blocked;
  }

  async getBlockedVisitors(): Promise<BlockedVisitor[]> {
    return await db.select().from(blockedVisitors).orderBy(desc(blockedVisitors.blockedAt));
  }

  async deleteBlockedVisitor(id: number): Promise<void> {
    await db.delete(blockedVisitors).where(eq(blockedVisitors.id, id));
  }

  async isVisitorBlocked(visitorId: string): Promise<boolean> {
    const [blocked] = await db.select().from(blockedVisitors)
      .where(eq(blockedVisitors.visitorId, visitorId));
    return !!blocked;
  }

  async isIpAddressBlocked(ipAddress: string): Promise<boolean> {
    const [blocked] = await db.select().from(blockedVisitors)
      .where(eq(blockedVisitors.ipAddress, ipAddress));
    return !!blocked;
  }

  async countActiveVisitorsByIp(ipAddress: string): Promise<number> {
    // Count only non-stale rows so cleanup lag doesn't inflate the per-IP
    // cap and produce false 429s for legitimate users behind NAT.
    const cutoff = new Date(Date.now() - DatabaseStorage.ACTIVE_VISITOR_STALE_MS);
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(activeVisitors)
      .where(and(eq(activeVisitors.ipAddress, ipAddress), gte(activeVisitors.lastHeartbeatAt, cutoff)));
    return Number(result[0]?.count || 0);
  }

  async visitorHadChatForCase(visitorId: string, caseId: string): Promise<boolean> {
    // Check current active session first (visitor is still on-site with chat open).
    const [active] = await db
      .select()
      .from(activeVisitors)
      .where(
        and(
          eq(activeVisitors.visitorId, visitorId),
          eq(activeVisitors.caseId, caseId),
          eq(activeVisitors.hasActiveChat, true),
        ),
      );
    if (active) return true;

    // Also accept a completed session that had a chat for this case.
    const [hist] = await db
      .select()
      .from(visitorHistory)
      .where(
        and(
          eq(visitorHistory.visitorId, visitorId),
          eq(visitorHistory.caseId, caseId),
          eq(visitorHistory.hadChat, true),
        ),
      );
    return !!hist;
  }

  async satisfactionRatingExistsForVisitorCase(visitorId: string, caseId: string): Promise<boolean> {
    const [existing] = await db
      .select()
      .from(chatSatisfactionRatings)
      .where(
        and(
          eq(chatSatisfactionRatings.visitorId, visitorId),
          eq(chatSatisfactionRatings.caseId, caseId),
        ),
      );
    return !!existing;
  }

  // Atomically claims a satisfaction-token nonce. The primary key on `nonce`
  // makes this safe under concurrent requests across every autoscale
  // instance: only the first INSERT to land wins, everyone else observes the
  // conflict and gets `false` (replay). This is also what makes rotating
  // SESSION_SECRET safe — an attacker who captured a token before rotation
  // still can't replay it more than once, and legitimate single-use-per-token
  // semantics hold regardless of which process verifies the signature.
  async claimSatisfactionTokenNonce(nonce: string, expiresAt: Date): Promise<boolean> {
    const inserted = await db
      .insert(satisfactionTokenNonces)
      .values({ nonce, expiresAt })
      .onConflictDoNothing({ target: satisfactionTokenNonces.nonce })
      .returning({ nonce: satisfactionTokenNonces.nonce });
    return inserted.length > 0;
  }

  // Prunes nonce rows whose parent token could no longer verify anyway
  // (expiresAt in the past), keeping the table bounded to the live 24h
  // token window's worth of traffic.
  async deleteExpiredSatisfactionTokenNonces(): Promise<number> {
    const deleted = await db
      .delete(satisfactionTokenNonces)
      .where(lt(satisfactionTokenNonces.expiresAt, new Date()))
      .returning({ nonce: satisfactionTokenNonces.nonce });
    return deleted.length;
  }

  // Admin availability operations
  async getAdminAvailability(username: string): Promise<AdminAvailability | undefined> {
    const [availability] = await db.select().from(adminAvailability)
      .where(eq(adminAvailability.adminUsername, username));
    return availability;
  }

  async updateAdminAvailability(username: string, data: Partial<InsertAdminAvailability>): Promise<AdminAvailability> {
    const existing = await this.getAdminAvailability(username);
    if (existing) {
      const [updated] = await db.update(adminAvailability)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(adminAvailability.adminUsername, username))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(adminAvailability)
        .values({ adminUsername: username, ...data })
        .returning();
      return created;
    }
  }

  // Offline message operations
  async createOfflineMessage(data: InsertOfflineMessage): Promise<OfflineMessage> {
    const [message] = await db.insert(offlineMessages).values(data).returning();
    return message;
  }

  async getAllOfflineMessages(): Promise<OfflineMessage[]> {
    return await db.select().from(offlineMessages).orderBy(desc(offlineMessages.createdAt));
  }

  async getOfflineMessageById(id: number): Promise<OfflineMessage | undefined> {
    const [message] = await db.select().from(offlineMessages).where(eq(offlineMessages.id, id));
    return message;
  }

  async updateOfflineMessage(id: number, data: Partial<InsertOfflineMessage>): Promise<OfflineMessage | undefined> {
    const [updated] = await db.update(offlineMessages)
      .set(data)
      .where(eq(offlineMessages.id, id))
      .returning();
    return updated;
  }

  async deleteOfflineMessage(id: number): Promise<void> {
    await db.delete(offlineMessages).where(eq(offlineMessages.id, id));
  }

  async getUnreadOfflineMessagesCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(offlineMessages)
      .where(eq(offlineMessages.status, 'new'));
    return Number(result[0]?.count || 0);
  }

  // Chat satisfaction rating operations
  async createChatSatisfactionRating(data: InsertChatSatisfactionRating): Promise<ChatSatisfactionRating> {
    const [rating] = await db.insert(chatSatisfactionRatings).values(data).returning();
    return rating;
  }

  async getChatSatisfactionRatingsByCaseId(caseId: string): Promise<ChatSatisfactionRating[]> {
    return await db.select().from(chatSatisfactionRatings)
      .where(eq(chatSatisfactionRatings.caseId, caseId))
      .orderBy(desc(chatSatisfactionRatings.createdAt));
  }

  async getAllChatSatisfactionRatings(): Promise<ChatSatisfactionRating[]> {
    return await db.select().from(chatSatisfactionRatings).orderBy(desc(chatSatisfactionRatings.createdAt));
  }

  async getAverageSatisfactionRating(): Promise<{ avgRating: number; totalRatings: number }> {
    const result = await db.select({
      avgRating: sql<number>`avg(rating)`,
      totalRatings: sql<number>`count(*)`,
    }).from(chatSatisfactionRatings);
    return {
      avgRating: Number(result[0]?.avgRating || 0),
      totalRatings: Number(result[0]?.totalRatings || 0),
    };
  }

  // ==========================================================================
  // Declaration of Compliance
  // ==========================================================================
  async createDeclarationSubmission(
    data: InsertDeclarationSubmission & { ipAddress?: string; userAgent?: string },
  ): Promise<DeclarationSubmission> {
    const [row] = await db
      .insert(declarationSubmissions)
      .values({ ...data, status: 'submitted' })
      .returning();
    return row;
  }

  async getDeclarationSubmissionsByCaseId(caseId: string): Promise<DeclarationSubmission[]> {
    return await db
      .select()
      .from(declarationSubmissions)
      .where(eq(declarationSubmissions.caseId, caseId))
      .orderBy(desc(declarationSubmissions.submittedAt));
  }

  async getLatestDeclarationByCase(caseId: string): Promise<DeclarationSubmission | undefined> {
    const [row] = await db
      .select()
      .from(declarationSubmissions)
      .where(eq(declarationSubmissions.caseId, caseId))
      .orderBy(desc(declarationSubmissions.submittedAt))
      .limit(1);
    return row;
  }

  async getDeclarationSubmissionById(id: number): Promise<DeclarationSubmission | undefined> {
    const [row] = await db
      .select()
      .from(declarationSubmissions)
      .where(eq(declarationSubmissions.id, id))
      .limit(1);
    return row;
  }

  async listDeclarationSubmissions(
    opts: { status?: string; limit?: number; offset?: number } = {},
  ): Promise<{ rows: DeclarationSubmission[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const where = opts.status ? eq(declarationSubmissions.status, opts.status) : undefined;

    const baseSelect = db.select().from(declarationSubmissions);
    const rowsQuery = where ? baseSelect.where(where) : baseSelect;
    const rows = await rowsQuery
      .orderBy(desc(declarationSubmissions.submittedAt))
      .limit(limit)
      .offset(offset);

    const baseCount = db.select({ c: sql<number>`count(*)` }).from(declarationSubmissions);
    const countQuery = where ? baseCount.where(where) : baseCount;
    const totalRow = await countQuery;
    const total = Number(totalRow[0]?.c ?? 0);

    return { rows, total };
  }

  async updateDeclarationSubmissionStatus(
    id: number,
    status: string,
    reviewedBy: string,
    reviewerNotes?: string,
    executor: DbExecutor = db,
  ): Promise<DeclarationSubmission | undefined> {
    const [row] = await executor
      .update(declarationSubmissions)
      .set({
        status,
        reviewedBy,
        reviewerNotes: reviewerNotes ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(declarationSubmissions.id, id))
      .returning();
    return row;
  }

  async getAppSetting(key: string): Promise<AppSetting | undefined> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return row;
  }

  async setAppSetting(
    key: string,
    value: string,
    updatedBy?: string | null,
    executor: DbExecutor = db,
  ): Promise<AppSetting> {
    // Single-statement upsert so concurrent writers (e.g. an admin save
    // racing the periodic cache refresh) can never insert duplicate keys.
    // Task #157 — accept an optional executor so callers can pair the
    // write with a `createAuditLog` row inside the same transaction; an
    // audit-write failure then rolls the setting change back instead of
    // leaving the row and the audit trail drifted apart.
    const [row] = await executor
      .insert(appSettings)
      .values({ key, value, updatedBy: updatedBy ?? null })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedBy: updatedBy ?? null, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async listBlockedIps(): Promise<BlockedIp[]> {
    return await db
      .select()
      .from(blockedIps)
      .orderBy(desc(blockedIps.blockedAt));
  }

  async blockIp(input: InsertBlockedIp, executor: DbExecutor = db): Promise<BlockedIp> {
    // Upsert keyed on ip_address: re-blocking an already-listed IP just
    // refreshes the reason / blockedBy / expiresAt, which is the
    // intuitive behavior when an admin re-clicks Block on a row they
    // had earlier auto-expired or partly-throttled.
    const [row] = await executor
      .insert(blockedIps)
      .values({
        ipAddress: input.ipAddress,
        reason: input.reason ?? null,
        blockedBy: input.blockedBy ?? null,
        expiresAt: input.expiresAt ?? null,
      })
      .onConflictDoUpdate({
        target: blockedIps.ipAddress,
        set: {
          reason: input.reason ?? null,
          blockedBy: input.blockedBy ?? null,
          expiresAt: input.expiresAt ?? null,
          blockedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async unblockIp(ipAddress: string, executor: DbExecutor = db): Promise<BlockedIp | undefined> {
    const [row] = await executor
      .delete(blockedIps)
      .where(eq(blockedIps.ipAddress, ipAddress))
      .returning();
    return row;
  }

  async isIpBlocked(ipAddress: string): Promise<boolean> {
    const [row] = await db
      .select()
      .from(blockedIps)
      .where(eq(blockedIps.ipAddress, ipAddress));
    if (!row) return false;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
    return true;
  }

  // ------------------------------------------------------------------
  // Withdrawal security tokens (Task #66 — final-stage activation flow)
  // ------------------------------------------------------------------
  async createWithdrawalSecurityToken(
    data: InsertWithdrawalSecurityToken,
    executor: DbExecutor = db,
  ): Promise<WithdrawalSecurityToken> {
    const [row] = await executor.insert(withdrawalSecurityTokens).values(data).returning();
    return row;
  }

  async getActiveWithdrawalSecurityToken(
    caseId: string,
  ): Promise<WithdrawalSecurityToken | undefined> {
    const [row] = await db
      .select()
      .from(withdrawalSecurityTokens)
      .where(eq(withdrawalSecurityTokens.caseId, caseId))
      .orderBy(desc(withdrawalSecurityTokens.createdAt))
      .limit(1);
    return row;
  }

  async incrementWithdrawalSecurityTokenAttempts(id: number, executor: DbExecutor = db): Promise<void> {
    await executor
      .update(withdrawalSecurityTokens)
      .set({ attempts: sql`${withdrawalSecurityTokens.attempts} + 1` })
      .where(eq(withdrawalSecurityTokens.id, id));
  }

  async markWithdrawalSecurityTokenConsumed(id: number, executor: DbExecutor = db): Promise<void> {
    await executor
      .update(withdrawalSecurityTokens)
      .set({ consumedAt: new Date() })
      .where(eq(withdrawalSecurityTokens.id, id));
  }

  // ------------------------------------------------------------------
  // Admin "Open as User" mirror tokens (Task #119 — multi-instance safe)
  //
  // Previously held in a per-process `Map`. Under autoscale the mint and
  // redeem requests can hit different instances, so we persist the token
  // row in Postgres and let `consumeMirrorToken` do an atomic
  // delete-returning so the single-use semantics survive across instances
  // and any race between two redeem attempts.
  // ------------------------------------------------------------------
  async createMirrorToken(
    data: InsertAdminMirrorToken,
    executor: DbExecutor = db,
  ): Promise<AdminMirrorToken> {
    const [row] = await executor.insert(adminMirrorTokens).values(data).returning();
    return row;
  }

  async consumeMirrorToken(
    token: string,
    executor: DbExecutor = db,
  ): Promise<AdminMirrorToken | undefined> {
    const [row] = await executor
      .delete(adminMirrorTokens)
      .where(eq(adminMirrorTokens.token, token))
      .returning();
    return row;
  }

  async deleteExpiredMirrorTokens(now: Date = new Date()): Promise<number> {
    const rows = await db
      .delete(adminMirrorTokens)
      .where(lt(adminMirrorTokens.expiresAt, now))
      .returning({ token: adminMirrorTokens.token });
    return rows.length;
  }

  // ------------------------------------------------------------------
  // Portal session tokens (Task #123 — multi-instance safe)
  //
  // Stored in Postgres rather than a per-process Map so that:
  //   • a session minted on instance A is recognised by instance B,
  //   • admin "Force logout" actually invalidates the token on every
  //     instance (not just the one that ran the action), and
  //   • tokens survive a single-instance restart instead of silently
  //     signing every user out.
  // ------------------------------------------------------------------
  async createPortalSession(data: InsertPortalSession): Promise<PortalSession> {
    const [row] = await db.insert(portalSessions).values(data).returning();
    return row;
  }

  async getPortalSession(token: string): Promise<PortalSession | undefined> {
    const [row] = await db
      .select()
      .from(portalSessions)
      .where(eq(portalSessions.token, token));
    return row;
  }

  async deletePortalSession(token: string): Promise<void> {
    await db.delete(portalSessions).where(eq(portalSessions.token, token));
  }

  async deletePortalSessionsByCaseId(caseId: string): Promise<number> {
    const rows = await db
      .delete(portalSessions)
      .where(eq(portalSessions.caseId, caseId))
      .returning({ token: portalSessions.token });
    return rows.length;
  }

  async deleteExpiredPortalSessions(now: Date = new Date()): Promise<number> {
    const rows = await db
      .delete(portalSessions)
      .where(lt(portalSessions.expiresAt, now))
      .returning({ token: portalSessions.token });
    return rows.length;
  }

  async getActivePortalSessionByCaseId(caseId: string): Promise<PortalSession | undefined> {
    const now = new Date();
    const [row] = await db
      .select()
      .from(portalSessions)
      .where(
        and(
          eq(portalSessions.caseId, caseId),
          eq(portalSessions.isMirror, false),
          gt(portalSessions.expiresAt, now),
        ),
      )
      // Most-recently-active first: if a case somehow has more than one live
      // (non-mirror) session, admins should see the freshest activity signal
      // rather than whichever token happened to be minted last.
      .orderBy(desc(portalSessions.lastActivityAt))
      .limit(1);
    return row;
  }

  async updatePortalSessionActivity(token: string): Promise<void> {
    await db
      .update(portalSessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(portalSessions.token, token));
  }

  // ------------------------------------------------------------------
  // User documents (supporting documents uploaded by case holders)
  // ------------------------------------------------------------------

  async getAllUserDocuments(filters?: { status?: string; caseId?: string }): Promise<Omit<UserDocument, 'fileData'>[]> {
    const conditions = [];
    if (filters?.caseId) conditions.push(eq(userDocuments.caseId, filters.caseId));
    if (filters?.status) conditions.push(eq(userDocuments.status, filters.status));
    const rows = await db
      .select({
        id: userDocuments.id,
        caseId: userDocuments.caseId,
        fileName: userDocuments.fileName,
        fileType: userDocuments.fileType,
        fileSize: userDocuments.fileSize,
        category: userDocuments.category,
        description: userDocuments.description,
        status: userDocuments.status,
        adminNotes: userDocuments.adminNotes,
        reviewedAt: userDocuments.reviewedAt,
        reviewedBy: userDocuments.reviewedBy,
        uploadedAt: userDocuments.uploadedAt,
      })
      .from(userDocuments)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(userDocuments.uploadedAt));
    return rows;
  }

  async getUserDocumentsByCaseId(caseId: string): Promise<Omit<UserDocument, 'fileData'>[]> {
    const rows = await db
      .select({
        id: userDocuments.id,
        caseId: userDocuments.caseId,
        fileName: userDocuments.fileName,
        fileType: userDocuments.fileType,
        fileSize: userDocuments.fileSize,
        category: userDocuments.category,
        description: userDocuments.description,
        status: userDocuments.status,
        adminNotes: userDocuments.adminNotes,
        reviewedAt: userDocuments.reviewedAt,
        reviewedBy: userDocuments.reviewedBy,
        uploadedAt: userDocuments.uploadedAt,
      })
      .from(userDocuments)
      .where(eq(userDocuments.caseId, caseId))
      .orderBy(desc(userDocuments.uploadedAt));
    return rows;
  }

  async getUserDocumentById(id: number): Promise<UserDocument | undefined> {
    const [row] = await db
      .select()
      .from(userDocuments)
      .where(eq(userDocuments.id, id));
    return row;
  }

  async updateUserDocument(
    id: number,
    data: Partial<Pick<UserDocument, 'status' | 'adminNotes' | 'reviewedAt' | 'reviewedBy'>>,
    tx?: DbExecutor,
  ): Promise<UserDocument | undefined> {
    const executor = tx ?? db;
    const [row] = await executor
      .update(userDocuments)
      .set(data)
      .where(eq(userDocuments.id, id))
      .returning();
    return row;
  }

  async createUserDocument(data: {
    caseId: string;
    fileName: string;
    fileType: string;
    fileData: string;
    fileSize?: string;
    category?: string;
    description?: string;
  }, tx?: DbExecutor): Promise<UserDocument> {
    const executor = tx ?? db;
    const [row] = await executor
      .insert(userDocuments)
      .values({
        caseId: data.caseId,
        fileName: data.fileName,
        fileType: data.fileType,
        fileData: data.fileData,
        fileSize: data.fileSize ?? null,
        category: data.category ?? 'general',
        description: data.description ?? null,
        status: 'uploaded',
      })
      .returning();
    return row;
  }

  async getPendingUserDocumentCounts(): Promise<Record<string, number>> {
    const rows = await db
      .select({
        caseId: userDocuments.caseId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(userDocuments)
      .where(eq(userDocuments.status, 'uploaded'))
      .groupBy(userDocuments.caseId);
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.caseId] = row.count;
    }
    return result;
  }

  // ── Refund Claims ────────────────────────────────────────────────────────

  async createRefundClaim(data: {
    caseId: string;
    refundableAmount?: string | null;
    documentaryRecommendations?: string | null;
    requestedBy?: string;
  }): Promise<RefundClaim> {
    const [row] = await db
      .insert(refundClaims)
      .values({
        caseId: data.caseId,
        status: "pending_submission",
        entries: [],
        refundableAmount: data.refundableAmount ?? null,
        documentaryRecommendations: data.documentaryRecommendations ?? null,
        requestedBy: data.requestedBy ?? null,
      })
      .returning();
    return row;
  }

  async getRefundClaimByCase(caseId: string): Promise<RefundClaim | undefined> {
    const [row] = await db
      .select()
      .from(refundClaims)
      .where(eq(refundClaims.caseId, caseId))
      .orderBy(desc(refundClaims.requestedAt))
      .limit(1);
    return row;
  }

  async updateRefundClaim(
    id: number,
    data: Partial<Pick<RefundClaim,
      | "status"
      | "entries"
      | "documentaryRecommendations"
      | "adminNotes"
      | "submittedAt"
      | "reviewedAt"
      | "reviewedBy"
    >>,
  ): Promise<RefundClaim> {
    const [row] = await db
      .update(refundClaims)
      .set(data)
      .where(eq(refundClaims.id, id))
      .returning();
    return row;
  }

  async getCommunityViewsOverTime(opts: {
    hours?: number;
    threadId?: number;
  } = {}): Promise<{ hourBucket: string; views: number }[]> {
    const hours = Math.min(Math.max(opts.hours ?? 48, 1), 48);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const conditions = [gte(communityThreadViews.createdAt, cutoff)];
    if (opts.threadId != null) {
      conditions.push(eq(communityThreadViews.threadId, opts.threadId));
    }
    const rows = await db
      .select({
        hourBucket: communityThreadViews.hourBucket,
        views: sql<number>`count(*)::int`,
      })
      .from(communityThreadViews)
      .where(and(...conditions))
      .groupBy(communityThreadViews.hourBucket)
      .orderBy(asc(communityThreadViews.hourBucket));
    return rows;
  }

  async listAdminUsers(): Promise<AdminUser[]> {
    return db.select().from(adminUsers).orderBy(asc(adminUsers.username));
  }

  async getAdminUserByUsername(username: string): Promise<AdminUser | undefined> {
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.username, username));
    return row;
  }

  async getAdminUserById(id: number): Promise<AdminUser | undefined> {
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
    return row;
  }

  async createAdminUser(data: InsertAdminUser): Promise<AdminUser> {
    const [row] = await db.insert(adminUsers).values(data).returning();
    return row;
  }

  async updateAdminUser(id: number, data: Partial<Pick<AdminUser, 'role' | 'displayName' | 'email' | 'isActive' | 'passwordHash' | 'lastLoginAt' | 'twoFactorEnabled' | 'twoFactorSecret'>>): Promise<AdminUser | undefined> {
    const [row] = await db.update(adminUsers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(adminUsers.id, id))
      .returning();
    return row;
  }

  async deleteAdminUser(id: number): Promise<void> {
    await db.delete(adminUsers).where(eq(adminUsers.id, id));
  }
}

export const storage = new DatabaseStorage();
