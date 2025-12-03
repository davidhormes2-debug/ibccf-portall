import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, serial } from "drizzle-orm/pg-core";
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
  
  // Option B customization
  optionBTitle: text("option_b_title").default("Standard Release"),
  optionBDescription: text("option_b_description"),
  optionBAmount: text("option_b_amount"),
  optionBBatches: text("option_b_batches"),
  
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
