import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import {
  cases, caseLetters, caseSubmissions, caseNotes,
  chatMessages, adminMessages, depositReceipts,
  type Case, type InsertCase, type UpdateCase,
  type CaseLetter, type UpdateCaseLetter,
  type CaseSubmission, type InsertCaseSubmission,
  type CaseNote, type InsertCaseNote
} from "@shared/schema";

export class CaseRepository {
  async create(data: InsertCase): Promise<Case> {
    const [newCase] = await db.insert(cases).values(data).returning();
    return newCase;
  }

  async findById(id: string): Promise<Case | undefined> {
    const [caseData] = await db.select().from(cases).where(eq(cases.id, id));
    return caseData;
  }

  async findByAccessCode(accessCode: string): Promise<Case | undefined> {
    const [caseData] = await db.select().from(cases).where(eq(cases.accessCode, accessCode));
    return caseData;
  }

  async findAll(): Promise<Case[]> {
    return await db.select().from(cases).orderBy(desc(cases.createdAt));
  }

  async update(id: string, data: UpdateCase): Promise<Case | undefined> {
    const [updated] = await db
      .update(cases)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async delete(id: string): Promise<void> {
    await db.delete(depositReceipts).where(eq(depositReceipts.caseId, id));
    await db.delete(adminMessages).where(eq(adminMessages.caseId, id));
    await db.delete(chatMessages).where(eq(chatMessages.caseId, id));
    await db.delete(caseSubmissions).where(eq(caseSubmissions.caseId, id));
    await db.delete(caseLetters).where(eq(caseLetters.caseId, id));
    await db.delete(cases).where(eq(cases.id, id));
  }

  async getLetter(caseId: string): Promise<CaseLetter | undefined> {
    const [letter] = await db.select().from(caseLetters).where(eq(caseLetters.caseId, caseId));
    return letter;
  }

  async createOrUpdateLetter(caseId: string, data: UpdateCaseLetter): Promise<CaseLetter> {
    const existing = await this.getLetter(caseId);
    
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

  async createSubmission(data: InsertCaseSubmission): Promise<CaseSubmission> {
    const [submission] = await db.insert(caseSubmissions).values(data).returning();
    return submission;
  }

  async getSubmissions(caseId: string): Promise<CaseSubmission[]> {
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

  async createNote(data: InsertCaseNote): Promise<CaseNote> {
    const [note] = await db.insert(caseNotes).values(data).returning();
    return note;
  }

  async getNotes(caseId: string): Promise<CaseNote[]> {
    return await db.select().from(caseNotes)
      .where(eq(caseNotes.caseId, caseId))
      .orderBy(desc(caseNotes.isPinned), desc(caseNotes.createdAt));
  }

  async updateNote(id: number, data: Partial<InsertCaseNote>): Promise<CaseNote | undefined> {
    const [updated] = await db.update(caseNotes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(caseNotes.id, id))
      .returning();
    return updated;
  }

  async deleteNote(id: number): Promise<void> {
    await db.delete(caseNotes).where(eq(caseNotes.id, id));
  }

  async toggleNotePin(id: number): Promise<CaseNote | undefined> {
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
}

export const caseRepository = new CaseRepository();
