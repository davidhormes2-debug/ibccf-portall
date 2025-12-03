import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
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
  
  // Submission data
  selectedOption: text("selected_option"),
  submittedAt: timestamp("submitted_at"),
  
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
