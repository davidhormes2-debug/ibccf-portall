import { type Case, type InsertCase, type UpdateCase, cases } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  // Case operations
  createCase(data: InsertCase): Promise<Case>;
  getCaseById(id: string): Promise<Case | undefined>;
  getCaseByAccessCode(accessCode: string): Promise<Case | undefined>;
  getAllCases(): Promise<Case[]>;
  updateCase(id: string, data: UpdateCase): Promise<Case | undefined>;
  deleteCase(id: string): Promise<void>;
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
    return await db.select().from(cases);
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
    await db.delete(cases).where(eq(cases.id, id));
  }
}

export const storage = new DatabaseStorage();
