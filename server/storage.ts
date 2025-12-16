import { 
  type Case, type InsertCase, type UpdateCase, cases,
  type CaseLetter, type InsertCaseLetter, type UpdateCaseLetter, caseLetters,
  type CaseSubmission, type InsertCaseSubmission, caseSubmissions,
  type ChatMessage, type InsertChatMessage, chatMessages,
  type AdminMessage, type InsertAdminMessage, adminMessages,
  type DepositReceipt, type InsertDepositReceipt, depositReceipts,
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
  type AdminTwoFactor, type InsertAdminTwoFactor, adminTwoFactor,
  type ChatTemplate, type InsertChatTemplate, chatTemplates,
  type CaseNote, type InsertCaseNote, caseNotes,
  type Translation, type InsertTranslation, translations,
  type NewsletterSubscriber, type InsertNewsletterSubscriber, newsletterSubscribers,
  type ScamAlert, type InsertScamAlert, scamAlerts,
  type Testimonial, type InsertTestimonial, testimonials,
  type SiteStatistic, type InsertSiteStatistic, siteStatistics,
  type ContactSubmission, type InsertContactSubmission, contactSubmissions,
  type FaqItem, type InsertFaqItem, faqItems,
  type ActiveVisitor, type InsertActiveVisitor, activeVisitors,
  type VisitorHistory, type InsertVisitorHistory, visitorHistory,
  type BlockedVisitor, type InsertBlockedVisitor, blockedVisitors,
  type AdminAvailability, type InsertAdminAvailability, adminAvailability,
  type OfflineMessage, type InsertOfflineMessage, offlineMessages,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, lt, isNull, sql } from "drizzle-orm";

export interface IStorage {
  // Case operations
  createCase(data: InsertCase): Promise<Case>;
  getCaseById(id: string): Promise<Case | undefined>;
  getCaseByAccessCode(accessCode: string): Promise<Case | undefined>;
  getCaseByPin(hashedPin: string): Promise<Case | undefined>;
  getAllCases(): Promise<Case[]>;
  updateCase(id: string, data: UpdateCase): Promise<Case | undefined>;
  deleteCase(id: string): Promise<void>;
  
  // Case letter operations
  getCaseLetterByCaseId(caseId: string): Promise<CaseLetter | undefined>;
  createOrUpdateCaseLetter(caseId: string, data: UpdateCaseLetter): Promise<CaseLetter>;
  
  // Case submission operations
  createSubmission(data: InsertCaseSubmission): Promise<CaseSubmission>;
  getSubmissionsByCaseId(caseId: string): Promise<CaseSubmission[]>;
  getAllSubmissions(): Promise<CaseSubmission[]>;
  deleteSubmission(id: number): Promise<void>;
  
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
  createDepositReceipt(data: InsertDepositReceipt): Promise<DepositReceipt>;
  getDepositReceiptsByCaseId(caseId: string): Promise<DepositReceipt[]>;
  updateDepositReceiptStatus(id: number, status: string): Promise<DepositReceipt | undefined>;
  updateDepositReceipt(id: number, data: { status?: string; adminNotes?: string }): Promise<DepositReceipt | undefined>;
  
  // Activity log operations
  createActivityLog(data: InsertActivityLog): Promise<ActivityLog>;
  getActivityLogsByCaseId(caseId: string): Promise<ActivityLog[]>;
  getAllActivityLogs(): Promise<ActivityLog[]>;
  
  // Audit log operations
  createAuditLog(data: InsertAuditLog): Promise<AuditLog>;
  getAllAuditLogs(): Promise<AuditLog[]>;
  
  // Clear logs (preserves accounts)
  clearAllLogs(): Promise<void>;
  
  // Message template operations
  createMessageTemplate(data: InsertMessageTemplate): Promise<MessageTemplate>;
  getAllMessageTemplates(): Promise<MessageTemplate[]>;
  getMessageTemplatesByCategory(category: string): Promise<MessageTemplate[]>;
  updateMessageTemplate(id: number, data: Partial<InsertMessageTemplate>): Promise<MessageTemplate | undefined>;
  deleteMessageTemplate(id: number): Promise<void>;
  
  // Document request operations
  createDocumentRequest(data: InsertDocumentRequest): Promise<DocumentRequest>;
  getDocumentRequestsByCaseId(caseId: string): Promise<DocumentRequest[]>;
  updateDocumentRequest(id: number, data: Partial<InsertDocumentRequest>): Promise<DocumentRequest | undefined>;
  
  // User session operations
  createUserSession(data: InsertUserSession): Promise<UserSession>;
  getUserSessionsByCaseId(caseId: string): Promise<UserSession[]>;
  getAllUserSessions(): Promise<UserSession[]>;
  invalidateUserSession(id: number): Promise<void>;
  invalidateAllUserSessions(caseId: string): Promise<void>;
  deactivateUserSession(id: number): Promise<UserSession | undefined>;
  
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
  getNotificationsByRecipient(recipientType: string, recipientId: string): Promise<Notification[]>;
  markNotificationAsRead(id: number): Promise<void>;
  markAllNotificationsAsRead(recipientType: string, recipientId: string): Promise<void>;
  getUnreadNotificationCount(recipientType: string, recipientId: string): Promise<number>;
  
  // User feedback operations
  createUserFeedback(data: InsertUserFeedback): Promise<UserFeedback>;
  getUserFeedbackByCaseId(caseId: string): Promise<UserFeedback[]>;
  getAllUserFeedback(): Promise<UserFeedback[]>;
  
  // Admin session operations
  createAdminSession(data: InsertAdminSession): Promise<AdminSession>;
  getAdminSessionsByUsername(username: string): Promise<AdminSession[]>;
  getAdminSessionByToken(token: string): Promise<AdminSession | undefined>;
  getActiveAdminSessions(username: string): Promise<AdminSession[]>;
  updateAdminSessionActivity(id: string): Promise<void>;
  revokeAdminSession(id: string, reason?: string): Promise<void>;
  revokeAllAdminSessions(username: string, exceptId?: string): Promise<void>;
  
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
  
  // Blocked visitor operations
  createBlockedVisitor(data: InsertBlockedVisitor): Promise<BlockedVisitor>;
  getBlockedVisitors(): Promise<BlockedVisitor[]>;
  deleteBlockedVisitor(id: number): Promise<void>;
  isVisitorBlocked(visitorId: string): Promise<boolean>;
  
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
}

export class DatabaseStorage implements IStorage {
  async createCase(data: InsertCase): Promise<Case> {
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

  async updateCase(id: string, data: UpdateCase): Promise<Case | undefined> {
    const [updated] = await db
      .update(cases)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async deleteCase(id: string): Promise<void> {
    // Delete all related records first (cascade delete)
    await db.delete(depositReceipts).where(eq(depositReceipts.caseId, id));
    await db.delete(adminMessages).where(eq(adminMessages.caseId, id));
    await db.delete(chatMessages).where(eq(chatMessages.caseId, id));
    await db.delete(caseSubmissions).where(eq(caseSubmissions.caseId, id));
    await db.delete(caseLetters).where(eq(caseLetters.caseId, id));
    await db.delete(cases).where(eq(cases.id, id));
  }

  // Case Letter operations
  async getCaseLetterByCaseId(caseId: string): Promise<CaseLetter | undefined> {
    const [letter] = await db.select().from(caseLetters).where(eq(caseLetters.caseId, caseId));
    return letter;
  }

  async createOrUpdateCaseLetter(caseId: string, data: UpdateCaseLetter): Promise<CaseLetter> {
    const existing = await this.getCaseLetterByCaseId(caseId);
    
    if (existing) {
      const [updated] = await db
        .update(caseLetters)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(caseLetters.caseId, caseId))
        .returning();
      return updated;
    } else {
      const [created] = await db
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
  async createDepositReceipt(data: InsertDepositReceipt): Promise<DepositReceipt> {
    const [receipt] = await db.insert(depositReceipts).values(data).returning();
    return receipt;
  }

  async getDepositReceiptsByCaseId(caseId: string): Promise<DepositReceipt[]> {
    return await db
      .select()
      .from(depositReceipts)
      .where(eq(depositReceipts.caseId, caseId))
      .orderBy(desc(depositReceipts.uploadedAt));
  }

  async updateDepositReceiptStatus(id: number, status: string): Promise<DepositReceipt | undefined> {
    const [updated] = await db
      .update(depositReceipts)
      .set({ status })
      .where(eq(depositReceipts.id, id))
      .returning();
    return updated;
  }

  async updateDepositReceipt(id: number, data: { status?: string; adminNotes?: string }): Promise<DepositReceipt | undefined> {
    const updateData: any = {};
    if (data.status) updateData.status = data.status;
    if (data.adminNotes !== undefined) updateData.adminNotes = data.adminNotes;
    
    const [updated] = await db
      .update(depositReceipts)
      .set(updateData)
      .where(eq(depositReceipts.id, id))
      .returning();
    return updated;
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
  async createAuditLog(data: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db.insert(auditLogs).values(data).returning();
    return log;
  }

  async getAllAuditLogs(): Promise<AuditLog[]> {
    return await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt));
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
  async createDocumentRequest(data: InsertDocumentRequest): Promise<DocumentRequest> {
    const [request] = await db.insert(documentRequests).values(data).returning();
    return request;
  }

  async getDocumentRequestsByCaseId(caseId: string): Promise<DocumentRequest[]> {
    return await db.select().from(documentRequests).where(eq(documentRequests.caseId, caseId)).orderBy(desc(documentRequests.createdAt));
  }

  async updateDocumentRequest(id: number, data: Partial<InsertDocumentRequest>): Promise<DocumentRequest | undefined> {
    const [updated] = await db.update(documentRequests).set(data).where(eq(documentRequests.id, id)).returning();
    return updated;
  }

  // User session operations
  async createUserSession(data: InsertUserSession): Promise<UserSession> {
    const [session] = await db.insert(userSessions).values(data).returning();
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

  async invalidateAllUserSessions(caseId: string): Promise<void> {
    await db.update(userSessions).set({ isActive: false }).where(eq(userSessions.caseId, caseId));
  }

  async deactivateUserSession(id: number): Promise<UserSession | undefined> {
    const [updated] = await db.update(userSessions).set({ isActive: false }).where(eq(userSessions.id, id)).returning();
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
  async createAdminSession(data: InsertAdminSession): Promise<AdminSession> {
    const [session] = await db.insert(adminSessions).values(data).returning();
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

  async revokeAdminSession(id: string, reason?: string): Promise<void> {
    await db.update(adminSessions)
      .set({ isActive: false, revokedAt: new Date(), revokedReason: reason })
      .where(eq(adminSessions.id, id));
  }

  async revokeAllAdminSessions(username: string, exceptId?: string): Promise<void> {
    if (exceptId) {
      await db.update(adminSessions)
        .set({ isActive: false, revokedAt: new Date(), revokedReason: 'Bulk revoke' })
        .where(and(
          eq(adminSessions.adminUsername, username),
          eq(adminSessions.isActive, true)
        ));
    } else {
      await db.update(adminSessions)
        .set({ isActive: false, revokedAt: new Date(), revokedReason: 'Bulk revoke' })
        .where(eq(adminSessions.adminUsername, username));
    }
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
  async createActiveVisitor(data: InsertActiveVisitor): Promise<ActiveVisitor> {
    const [visitor] = await db.insert(activeVisitors).values(data).returning();
    return visitor;
  }

  async getActiveVisitors(): Promise<ActiveVisitor[]> {
    return await db.select().from(activeVisitors).orderBy(desc(activeVisitors.lastHeartbeatAt));
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
}

export const storage = new DatabaseStorage();
