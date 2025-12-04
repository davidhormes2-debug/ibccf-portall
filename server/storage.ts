import { 
  type Case, type InsertCase, type UpdateCase, cases,
  type CaseLetter, type InsertCaseLetter, type UpdateCaseLetter, caseLetters,
  type CaseSubmission, type InsertCaseSubmission, caseSubmissions,
  type ChatMessage, type InsertChatMessage, chatMessages,
  type AdminMessage, type InsertAdminMessage, adminMessages,
  type DepositReceipt, type InsertDepositReceipt, depositReceipts
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  // Case operations
  createCase(data: InsertCase): Promise<Case>;
  getCaseById(id: string): Promise<Case | undefined>;
  getCaseByAccessCode(accessCode: string): Promise<Case | undefined>;
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
}

export const storage = new DatabaseStorage();
