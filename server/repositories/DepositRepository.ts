import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import {
  depositReceipts,
  type DepositReceipt, type InsertDepositReceipt
} from "@shared/schema";

export class DepositRepository {
  async create(data: InsertDepositReceipt): Promise<DepositReceipt> {
    const [receipt] = await db.insert(depositReceipts).values(data).returning();
    return receipt;
  }

  async findByCaseId(caseId: string): Promise<DepositReceipt[]> {
    return await db
      .select()
      .from(depositReceipts)
      .where(eq(depositReceipts.caseId, caseId))
      .orderBy(desc(depositReceipts.uploadedAt));
  }

  async updateStatus(id: number, status: string): Promise<DepositReceipt | undefined> {
    const [updated] = await db
      .update(depositReceipts)
      .set({ status })
      .where(eq(depositReceipts.id, id))
      .returning();
    return updated;
  }

  async update(id: number, data: { status?: string; adminNotes?: string }): Promise<DepositReceipt | undefined> {
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

export const depositRepository = new DepositRepository();
