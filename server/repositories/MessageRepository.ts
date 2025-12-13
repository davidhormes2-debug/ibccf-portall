import { db } from "../db";
import { eq, desc, and, lt } from "drizzle-orm";
import {
  chatMessages, adminMessages, scheduledMessages, 
  messageTemplates, chatTemplates,
  type ChatMessage, type InsertChatMessage,
  type AdminMessage, type InsertAdminMessage,
  type ScheduledMessage, type InsertScheduledMessage,
  type MessageTemplate, type InsertMessageTemplate,
  type ChatTemplate, type InsertChatTemplate
} from "@shared/schema";

export class MessageRepository {
  async createChatMessage(data: InsertChatMessage): Promise<ChatMessage> {
    const [message] = await db.insert(chatMessages).values(data).returning();
    return message;
  }

  async getChatMessages(caseId: string): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.caseId, caseId))
      .orderBy(chatMessages.createdAt);
  }

  async markChatMessagesAsRead(caseId: string, sender: string): Promise<void> {
    await db
      .update(chatMessages)
      .set({ isRead: 'true' })
      .where(and(eq(chatMessages.caseId, caseId), eq(chatMessages.sender, sender)));
  }

  async getUnreadChatCount(caseId: string, sender: string): Promise<number> {
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

  async createAdminMessage(data: InsertAdminMessage): Promise<AdminMessage> {
    const [message] = await db.insert(adminMessages).values(data).returning();
    return message;
  }

  async getAdminMessages(caseId: string): Promise<AdminMessage[]> {
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

  async createScheduledMessage(data: InsertScheduledMessage): Promise<ScheduledMessage> {
    const [message] = await db.insert(scheduledMessages).values(data).returning();
    return message;
  }

  async getScheduledMessages(caseId: string): Promise<ScheduledMessage[]> {
    return await db.select().from(scheduledMessages)
      .where(eq(scheduledMessages.caseId, caseId))
      .orderBy(desc(scheduledMessages.scheduledFor));
  }

  async getPendingScheduledMessages(): Promise<ScheduledMessage[]> {
    return await db.select().from(scheduledMessages)
      .where(and(eq(scheduledMessages.status, 'pending'), lt(scheduledMessages.scheduledFor, new Date())))
      .orderBy(scheduledMessages.scheduledFor);
  }

  async updateScheduledMessage(id: number, data: Partial<InsertScheduledMessage>): Promise<ScheduledMessage | undefined> {
    const [updated] = await db.update(scheduledMessages).set(data).where(eq(scheduledMessages.id, id)).returning();
    return updated;
  }

  async cancelScheduledMessage(id: number): Promise<ScheduledMessage | undefined> {
    const [updated] = await db.update(scheduledMessages).set({ status: 'cancelled' }).where(eq(scheduledMessages.id, id)).returning();
    return updated;
  }

  async createMessageTemplate(data: InsertMessageTemplate): Promise<MessageTemplate> {
    const [template] = await db.insert(messageTemplates).values(data).returning();
    return template;
  }

  async getAllMessageTemplates(): Promise<MessageTemplate[]> {
    return await db.select().from(messageTemplates).orderBy(desc(messageTemplates.createdAt));
  }

  async getMessageTemplatesByCategory(category: string): Promise<MessageTemplate[]> {
    return await db.select().from(messageTemplates)
      .where(eq(messageTemplates.category, category))
      .orderBy(desc(messageTemplates.createdAt));
  }

  async updateMessageTemplate(id: number, data: Partial<InsertMessageTemplate>): Promise<MessageTemplate | undefined> {
    const [updated] = await db.update(messageTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(messageTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteMessageTemplate(id: number): Promise<void> {
    await db.delete(messageTemplates).where(eq(messageTemplates.id, id));
  }

  async createChatTemplate(data: InsertChatTemplate): Promise<ChatTemplate> {
    const [template] = await db.insert(chatTemplates).values(data).returning();
    return template;
  }

  async getAllChatTemplates(): Promise<ChatTemplate[]> {
    return await db.select().from(chatTemplates)
      .where(eq(chatTemplates.isActive, true))
      .orderBy(chatTemplates.name);
  }

  async getChatTemplatesByCategory(category: string): Promise<ChatTemplate[]> {
    return await db.select().from(chatTemplates)
      .where(and(eq(chatTemplates.category, category), eq(chatTemplates.isActive, true)))
      .orderBy(chatTemplates.name);
  }

  async updateChatTemplate(id: number, data: Partial<InsertChatTemplate>): Promise<ChatTemplate | undefined> {
    const [updated] = await db.update(chatTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(chatTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteChatTemplate(id: number): Promise<void> {
    await db.delete(chatTemplates).where(eq(chatTemplates.id, id));
  }

  async incrementTemplateUsage(id: number): Promise<void> {
    const [template] = await db.select().from(chatTemplates).where(eq(chatTemplates.id, id));
    if (template) {
      const currentCount = parseInt(template.usageCount || '0', 10);
      await db.update(chatTemplates)
        .set({ usageCount: String(currentCount + 1) })
        .where(eq(chatTemplates.id, id));
    }
  }
}

export const messageRepository = new MessageRepository();
