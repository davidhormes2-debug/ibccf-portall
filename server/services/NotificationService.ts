import { storage } from "../storage";
import type { Notification, InsertNotification } from "@shared/schema";

export class NotificationService {
  async createNotification(data: InsertNotification): Promise<Notification> {
    return storage.createNotification(data);
  }

  async getNotificationsByRecipient(recipientType: string, recipientId: string): Promise<Notification[]> {
    return storage.getNotificationsByRecipient(recipientType, recipientId);
  }

  async markNotificationAsRead(id: number): Promise<void> {
    return storage.markNotificationAsRead(id);
  }

  async markAllNotificationsAsRead(recipientType: string, recipientId: string): Promise<void> {
    return storage.markAllNotificationsAsRead(recipientType, recipientId);
  }

  async getUnreadNotificationCount(recipientType: string, recipientId: string): Promise<number> {
    return storage.getUnreadNotificationCount(recipientType, recipientId);
  }

  async notifyAdmin(type: string, title: string, body?: string, link?: string): Promise<Notification> {
    return this.createNotification({
      recipientType: 'admin',
      recipientId: 'Admin2025',
      type,
      title,
      body,
      link
    });
  }

  async notifyUser(caseId: string, type: string, title: string, body?: string, link?: string): Promise<Notification> {
    return this.createNotification({
      recipientType: 'user',
      recipientId: caseId,
      type,
      title,
      body,
      link
    });
  }
}

export const notificationService = new NotificationService();
