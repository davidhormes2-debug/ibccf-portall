import { 
  type Case, type InsertCase, type UpdateCase, cases,
  type CaseLetter, type InsertCaseLetter, type UpdateCaseLetter, caseLetters,
  type CaseSubmission, type InsertCaseSubmission, caseSubmissions,
  type ChatMessage, type InsertChatMessage, chatMessages
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
    // Delete related submissions and letters first
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
}

export const storage = new DatabaseStorage();
