import { storage } from "../storage";
import type { 
  ChatMessage, InsertChatMessage,
  AdminMessage, InsertAdminMessage,
  ChatTemplate, InsertChatTemplate
} from "@shared/schema";

export class MessageService {
  async createChatMessage(data: InsertChatMessage): Promise<ChatMessage> {
    return storage.createChatMessage(data);
  }

  async getChatMessagesByCaseId(caseId: string): Promise<ChatMessage[]> {
    return storage.getChatMessagesByCaseId(caseId);
  }

  async markMessagesAsRead(caseId: string, sender: string): Promise<void> {
    return storage.markMessagesAsRead(caseId, sender);
  }

  async getUnreadCount(caseId: string, sender: string): Promise<number> {
    return storage.getUnreadCount(caseId, sender);
  }

  async createAdminMessage(data: InsertAdminMessage): Promise<AdminMessage> {
    return storage.createAdminMessage(data);
  }

  async getAdminMessagesByCaseId(caseId: string): Promise<AdminMessage[]> {
    return storage.getAdminMessagesByCaseId(caseId);
  }

  async getAdminMessageById(id: number): Promise<AdminMessage | undefined> {
    return storage.getAdminMessageById(id);
  }

  async updateAdminMessage(id: number, data: Partial<InsertAdminMessage>): Promise<AdminMessage | undefined> {
    return storage.updateAdminMessage(id, data);
  }

  async deleteAdminMessage(id: number): Promise<void> {
    return storage.deleteAdminMessage(id);
  }

  async markAdminMessageAsRead(id: number): Promise<void> {
    return storage.markAdminMessageAsRead(id);
  }

  async getAllChatTemplates(): Promise<ChatTemplate[]> {
    return storage.getAllChatTemplates();
  }

  async createChatTemplate(data: InsertChatTemplate): Promise<ChatTemplate> {
    return storage.createChatTemplate(data);
  }

  async deleteChatTemplate(id: number): Promise<void> {
    return storage.deleteChatTemplate(id);
  }

  async incrementTemplateUsage(id: number): Promise<void> {
    return storage.incrementTemplateUsage(id);
  }
}

export const messageService = new MessageService();
