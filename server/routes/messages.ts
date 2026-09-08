import { Router } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { checkAdminAuth, isValidAdminToken } from "./middleware";
import { requirePortalAccess, requireUnsealed, validatePortalSession } from "../services/portal-auth";
import { notificationService } from "../services/NotificationService";
import { warnOnce } from "../lib/warnOnce";
import { requireAdminRole } from "./adminPermissions";

export const messagesRouter = Router();

const CHAT_ATTACHMENT_MAX_BYTES = 6 * 1024 * 1024;
const CHAT_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

type ChatAttachmentInput = { fileName: string; mimeType: string; fileData: string };

function validateChatAttachment(input: ChatAttachmentInput): { base64: string; byteSize: number } {
  const mimeType = input.mimeType.toLowerCase();
  if (!CHAT_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    throw new Error('Unsupported attachment type');
  }
  const match = input.fileData.match(/^data:([^;,]+);base64,(.+)$/s);
  const base64 = match ? match[2] : input.fileData;
  if (match && match[1].toLowerCase() !== mimeType) {
    throw new Error('Attachment MIME type mismatch');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0 || buffer.length > CHAT_ATTACHMENT_MAX_BYTES) {
    throw new Error('Attachment size invalid');
  }
  return { base64, byteSize: buffer.length };
}

function attachmentMetadata(attachment: { id: number; fileName: string; mimeType: string; byteSize: number }) {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
  };
}

const TYPING_TTL_MS = 4500;
const typingPresence = new Map<string, number>();
const typingKey = (caseId: string, sender: 'admin' | 'user') => `${caseId}:${sender}`;

messagesRouter.get("/unread/all", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const cases = await storage.getAllCases();
    const unreadCounts: Record<string, number> = {};
    
    for (const caseItem of cases) {
      const count = await storage.getUnreadCount(caseItem.id, 'admin');
      if (count > 0) {
        unreadCounts[caseItem.id] = count;
      }
    }
    
    res.json(unreadCounts);
  } catch (_e) {
    res.status(500).json({ error: "Failed to get unread counts" });
  }
});

messagesRouter.patch("/:id", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const messageInput = z.object({
      category: z.enum(['urgent', 'processing', 'resolved']).optional(),
      title: z.string().min(1).optional(),
      body: z.string().min(1).optional()
    }).parse(req.body);

    const updated = await storage.updateAdminMessage(parseInt(req.params.id), messageInput);
    if (!updated) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update admin message" });
    }
  }
});

messagesRouter.delete("/:id", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    await storage.deleteAdminMessage(parseInt(req.params.id));
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete admin message" });
  }
});

messagesRouter.post("/:id/read", async (req, res) => {
  try {
    const messageId = parseInt(req.params.id);
    if (isNaN(messageId)) {
      res.status(400).json({ error: "Invalid message id" });
      return;
    }

    if (await isValidAdminToken(req.headers.authorization)) {
      await storage.markAdminMessageAsRead(messageId);
      res.json({ success: true });
      return;
    }

    const portalHeader = req.headers["x-portal-session-token"];
    const portalToken = Array.isArray(portalHeader) ? portalHeader[0] : portalHeader;
    if (typeof portalToken === "string" && portalToken.length > 0) {
      const session = await validatePortalSession(portalToken);
      if (session) {
        const message = await storage.getAdminMessageById(messageId);
        if (!message) {
          res.status(404).json({ error: "Message not found" });
          return;
        }
        if (message.caseId !== session.caseId) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        await storage.markAdminMessageAsRead(messageId);
        res.json({ success: true });
        return;
      }
    }

    res.status(401).json({ error: "Unauthorized" });
  } catch (_e) {
    res.status(500).json({ error: "Failed to mark message as read" });
  }
});

export function registerCaseMessageRoutes(router: Router) {
  // Archive is a non-destructive admin-only inbox action. It never deletes
  // messages or case data; it only moves a session out of the default inbox.
  router.post("/:id/conversation/archive", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const archivedAt = new Date();
      const archivedBy = req.adminUsername || "Admin";
      // Keep the mutation explicit so future generic case-patch allowlists do
      // not accidentally control conversation state.
      const conversationState = await storage.updateCase(req.params.id, {
        chatArchivedAt: archivedAt,
        chatArchivedBy: archivedBy,
      });
      await storage.createAuditLog({
        action: "conversation_archived",
        adminUsername: archivedBy,
        targetType: "case",
        targetId: req.params.id,
        newValue: `Conversation archived at ${archivedAt.toISOString()}`,
      }).catch(() => {});
      res.json(conversationState);
    } catch (_e) {
      res.status(500).json({ error: "Failed to archive conversation" });
    }
  });

  router.delete("/:id/conversation/archive", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const adminUsername = req.adminUsername || "Admin";
      const updated = await storage.updateCase(req.params.id, {
        chatArchivedAt: null,
        chatArchivedBy: null,
      });
      await storage.createAuditLog({
        action: "conversation_unarchived",
        adminUsername,
        targetType: "case",
        targetId: req.params.id,
        newValue: "Conversation restored to inbox",
      }).catch(() => {});
      res.json(updated);
    } catch (_e) {
      res.status(500).json({ error: "Failed to restore conversation" });
    }
  });

  router.post("/:id/typing", requirePortalAccess, async (req, res) => {
    try {
      const input = z.object({
        sender: z.enum(['admin', 'user']),
        isTyping: z.boolean(),
      }).parse(req.body);
      const callerIsAdmin = await isValidAdminToken(req.headers.authorization);
      if (callerIsAdmin !== (input.sender === 'admin')) {
        res.status(403).json({ error: "Typing sender does not match authenticated actor" });
        return;
      }
      const key = typingKey(req.params.id, input.sender);
      if (input.isTyping) typingPresence.set(key, Date.now() + TYPING_TTL_MS);
      else typingPresence.delete(key);
      res.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) res.status(400).json({ error: "Invalid request" });
      else res.status(500).json({ error: "Failed to update typing state" });
    }
  });

  router.get("/:id/typing", requirePortalAccess, async (req, res) => {
    const now = Date.now();
    const adminKey = typingKey(req.params.id, 'admin');
    const userKey = typingKey(req.params.id, 'user');
    const adminUntil = typingPresence.get(adminKey) ?? 0;
    const userUntil = typingPresence.get(userKey) ?? 0;
    if (adminUntil <= now) typingPresence.delete(adminKey);
    if (userUntil <= now) typingPresence.delete(userKey);
    res.json({ admin: adminUntil > now, user: userUntil > now });
  });

  router.get("/:id/messages", requirePortalAccess, async (req, res) => {
    try {
      const messages = await storage.getChatMessagesByCaseId(req.params.id);
      const attachments = await storage.getChatAttachmentsByMessageIds(messages.map((message) => message.id));
      const attachmentByMessageId = new Map(attachments.map((attachment) => [attachment.messageId, attachment]));
      res.json(messages.map((message) => {
        const attachment = attachmentByMessageId.get(message.id);
        return {
          ...message,
          attachment: attachment ? attachmentMetadata(attachment) : null,
        };
      }));
    } catch (_e) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  router.post("/:id/messages", requirePortalAccess, requireUnsealed, async (req, res) => {
    try {
      const messageInput = z.object({
        sender: z.enum(['admin', 'user']),
        message: z.string().max(4000).optional().default(''),
        attachment: z.object({
          fileName: z.string().trim().min(1).max(255),
          mimeType: z.string().trim().min(1).max(150),
          fileData: z.string().min(1),
        }).optional(),
      }).refine((value) => value.message.trim().length > 0 || !!value.attachment, {
        message: 'Message or attachment required',
      }).parse(req.body);

      const callerIsAdmin = await isValidAdminToken(req.headers.authorization);

      // Admin tokens must use sender:'admin'; they cannot forge user-originated messages.
      if (callerIsAdmin && messageInput.sender === 'user') {
        res.status(403).json({ error: "Admin credentials cannot create user-sender messages" });
        return;
      }

      // Portal sessions cannot create admin-sender messages.
      if (!callerIsAdmin && messageInput.sender === 'admin') {
        res.status(403).json({ error: "Unauthorized: Valid admin authentication required" });
        return;
      }

      const parsedAttachment = messageInput.attachment
        ? validateChatAttachment(messageInput.attachment)
        : null;

      const created = await storage.runInTransaction(async (tx) => {
        const message = await storage.createChatMessage({
          caseId: req.params.id,
          sender: messageInput.sender,
          message: messageInput.message.trim(),
          isRead: 'false',
        }, tx);
        const attachment = messageInput.attachment && parsedAttachment
          ? await storage.createChatAttachment({
              messageId: message.id,
              caseId: req.params.id,
              fileName: messageInput.attachment.fileName,
              mimeType: messageInput.attachment.mimeType.toLowerCase(),
              byteSize: parsedAttachment.byteSize,
              fileData: parsedAttachment.base64,
            }, tx)
          : null;
        return { message, attachment };
      });
      const message = created.message;
      
      if (messageInput.sender === 'user') {
        const caseData = await storage.getCaseById(req.params.id);
        // A fresh user message automatically restores an archived session so
        // new customer activity can never remain hidden in the archive.
        if (caseData?.chatArchivedAt) {
          await storage.updateCase(req.params.id, { chatArchivedAt: null, chatArchivedBy: null });
        }
        await notificationService.notifyAdmin(
          'new_message',
          `New message from ${caseData?.userName || 'User'}`,
          (messageInput.message.trim() || `Attachment: ${messageInput.attachment?.fileName || 'file'}`).substring(0, 80),
          `/admin`
        );

        // Gap 3: email admin alert alongside the in-app notification.
        // Fire-and-forget — never blocks the response or throws to the caller.
        void (async () => {
          try {
            const { emailService } = await import("../services/EmailService");
            const { resolveDocumentUploadAlertRecipientsLocal } = await import("./content");
            const recipients = await resolveDocumentUploadAlertRecipientsLocal();
            if (recipients.length === 0) return;

            const dashboardUrl = `${process.env.APP_BASE_URL?.replace(/\/+$/, '') || 'https://ibccf.site'}/admin`;
            const userName = caseData?.userName || 'User';
            const preview = (messageInput.message.trim() || `Attachment: ${messageInput.attachment?.fileName || 'file'}`).substring(0, 200);

            const result = await emailService.sendAdminNewMessageAlert({
              to: recipients,
              caseId: req.params.id,
              userName,
              messagePreview: preview,
              dashboardUrl,
            });

            // Audit-log directly so we can capture all recipients, not just
            // the first — sendCaseEmailWithAudit only accepts a single `to`.
            try {
              await storage.createAuditLog({
                action: result.success ? 'email_admin_new_message' : 'email_admin_new_message_failed',
                newValue: result.success
                  ? `Admin new-message alert sent to ${recipients.join(', ')}`
                  : `Admin new-message alert failed: ${result.error ?? 'unknown'}`,
                adminUsername: 'system',
                targetType: 'case',
                targetId: req.params.id,
                metadata: null,
              });
            } catch (auditErr) {
              warnOnce('messages:admin-new-message-audit-fail', '[messages] admin new-message audit log failed:', auditErr);
            }
          } catch (err) {
            warnOnce(
              'messages:admin-new-message-alert-fail',
              '[messages] admin new-message alert failed:',
              err,
            );
          }
        })();
      }
      
      res.json({
        ...message,
        attachment: created.attachment ? attachmentMetadata(created.attachment) : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
      } else {
        res.status(500).json({ error: "Failed to send message" });
      }
    }
  });

  router.get("/:id/messages/:messageId/attachments/:attachmentId", requirePortalAccess, async (req, res) => {
    try {
      const messageId = Number(req.params.messageId);
      const attachmentId = Number(req.params.attachmentId);
      if (!Number.isInteger(messageId) || !Number.isInteger(attachmentId)) {
        res.status(400).json({ error: "Invalid attachment id" });
        return;
      }
      const attachment = await storage.getChatAttachmentById(attachmentId);
      if (!attachment || attachment.caseId !== req.params.id || attachment.messageId !== messageId) {
        res.status(404).json({ error: "Attachment not found" });
        return;
      }
      const safeName = attachment.fileName.replace(/[\r\n"]/g, '_');
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader('Content-Length', String(attachment.byteSize));
      res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(Buffer.from(attachment.fileData, 'base64'));
    } catch (_e) {
      res.status(500).json({ error: "Failed to download attachment" });
    }
  });

  router.post("/:id/messages/read", requirePortalAccess, async (req, res) => {
    try {
      const { sender } = req.body;
      if (!sender || !['admin', 'user'].includes(sender)) {
        res.status(400).json({ error: "Invalid sender" });
        return;
      }
      await storage.markMessagesAsRead(req.params.id, sender);
      res.json({ success: true });
    } catch (_e) {
      res.status(500).json({ error: "Failed to mark messages as read" });
    }
  });

  router.get("/:id/messages/unread", requirePortalAccess, async (req, res) => {
    try {
      const { sender } = req.query;
      if (!sender || !['admin', 'user'].includes(sender as string)) {
        res.status(400).json({ error: "Invalid sender query parameter" });
        return;
      }
      const count = await storage.getUnreadCount(req.params.id, sender as string);
      res.json({ count });
    } catch (_e) {
      res.status(500).json({ error: "Failed to get unread count" });
    }
  });

  router.get("/:id/admin-messages", requirePortalAccess, async (req, res) => {
    try {
      const messages = await storage.getAdminMessagesByCaseId(req.params.id);
      res.json(messages);
    } catch (_e) {
      res.status(500).json({ error: "Failed to fetch admin messages" });
    }
  });

  router.post("/:id/admin-messages", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
    try {
      const messageInput = z.object({
        category: z.enum(['urgent', 'processing', 'resolved']),
        title: z.string().min(1),
        body: z.string().min(1)
      }).parse(req.body);

      const message = await storage.createAdminMessage({
        caseId: req.params.id,
        category: messageInput.category,
        title: messageInput.title,
        body: messageInput.body,
        isRead: false
      });
      
      await notificationService.notifyUser(
        req.params.id,
        messageInput.category === 'urgent' ? 'required_action' : 'new_message',
        messageInput.title,
        messageInput.body.substring(0, 100),
        '/dashboard'
      );

      // Email the user a copy of the compliance message so they don't have to
      // be live in the portal to see it. Best-effort.
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (caseRow?.userEmail) {
          const { emailService } = await import("../services/EmailService");
          const { sendCaseEmailWithAudit } = await import(
            "../services/emailNotify"
          );
          const userName =
            (caseRow.userName ?? "").trim() || caseRow.userEmail;
          const adminUser =
            (req as any).admin?.username || "Admin";
          await sendCaseEmailWithAudit({
            to: caseRow.userEmail,
            caseId: req.params.id,
            tag: "compliance-message",
            adminUser,
            // Task #158 — pin the source message so a retry sends THIS
            // body even if newer compliance messages have been posted.
            metadata: { adminMessageId: message.id },
            send: () =>
              emailService.sendLocalizedCaseEmail({
                to: caseRow.userEmail!,
                userName,
                caseRef: req.params.id,
                locale: caseRow.preferredLocale ?? req.userLocale,
                templateKey: 'complianceMessage',
                ctaPath: '/portal?view=messages',
                logTag: 'compliance-message',
                vars: {
                  category: messageInput.category,
                  title: messageInput.title,
                  body: messageInput.body,
                },
              }),
          });
        }
      } catch (err) {
        warnOnce("messages:compliance-email-fail", "[messages] compliance-message email failed:", err);
      }

      res.json(message);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
      } else {
        res.status(500).json({ error: "Failed to create admin message" });
      }
    }
  });

  router.get("/:id/admin-messages/unread", async (req, res) => {
    try {
      const count = await storage.getUnreadAdminMessagesCount(req.params.id);
      res.json({ count });
    } catch (_e) {
      res.status(500).json({ error: "Failed to get unread count" });
    }
  });

  router.get("/:id/messages/export", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
    try {
      const { format = 'text' } = req.query;
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const messages = await storage.getChatMessagesByCaseId(req.params.id);
      
      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=transcript-${caseData.accessCode}.json`);
        res.json({
          caseId: caseData.id,
          accessCode: caseData.accessCode,
          userName: caseData.userName || 'Unknown',
          exportedAt: new Date().toISOString(),
          messageCount: messages.length,
          messages: messages.map(m => ({
            sender: m.sender,
            message: m.message,
            timestamp: m.createdAt
          }))
        });
        return;
      }

      const lines: string[] = [
        '='.repeat(60),
        'IBCCF CHAT TRANSCRIPT',
        '='.repeat(60),
        '',
        `Case ID: ${caseData.id}`,
        `Access Code: ${caseData.accessCode}`,
        `User: ${caseData.userName || 'Unknown'}`,
        `Exported: ${new Date().toLocaleString()}`,
        `Total Messages: ${messages.length}`,
        '',
        '-'.repeat(60),
        'CONVERSATION',
        '-'.repeat(60),
        ''
      ];

      for (const msg of messages) {
        const timestamp = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : 'Unknown time';
        const senderLabel = msg.sender === 'admin' ? 'SUPPORT' : 'USER';
        lines.push(`[${timestamp}] ${senderLabel}:`);
        lines.push(msg.message);
        lines.push('');
      }

      lines.push('-'.repeat(60));
      lines.push('END OF TRANSCRIPT');
      lines.push('-'.repeat(60));

      const transcript = lines.join('\n');
      
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=transcript-${caseData.accessCode}.txt`);
      res.send(transcript);
    } catch (error) {
      warnOnce("messages:export-transcript-fail", "Error exporting transcript:", error);
      res.status(500).json({ error: "Failed to export transcript" });
    }
  });
}

export const chatTemplatesRouter = Router();

chatTemplatesRouter.get("/", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const templates = await storage.getAllChatTemplates();
    res.json(templates);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch chat templates" });
  }
});

chatTemplatesRouter.get("/category/:category", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const templates = await storage.getChatTemplatesByCategory(req.params.category);
    res.json(templates);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch chat templates" });
  }
});

chatTemplatesRouter.post("/", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const templateInput = z.object({
      name: z.string().min(1),
      content: z.string().min(1),
      category: z.string().optional()
    }).parse(req.body);

    const template = await storage.createChatTemplate(templateInput);
    res.json(template);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to create chat template" });
    }
  }
});

chatTemplatesRouter.patch("/:id", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const templateInput = z.object({
      name: z.string().min(1).optional(),
      content: z.string().min(1).optional(),
      category: z.string().optional(),
      isActive: z.boolean().optional()
    }).parse(req.body);

    const template = await storage.updateChatTemplate(parseInt(req.params.id), templateInput);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(template);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update chat template" });
    }
  }
});

chatTemplatesRouter.delete("/:id", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    await storage.deleteChatTemplate(parseInt(req.params.id));
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete chat template" });
  }
});

chatTemplatesRouter.post("/:id/use", async (req, res) => {
  try {
    await storage.incrementTemplateUsage(parseInt(req.params.id));
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to increment template usage" });
  }
});

export const messageTemplatesRouter = Router();

messageTemplatesRouter.get("/", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const templates = await storage.getAllMessageTemplates();
    res.json(templates);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch message templates" });
  }
});

messageTemplatesRouter.get("/category/:category", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const templates = await storage.getMessageTemplatesByCategory(req.params.category);
    res.json(templates);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch message templates" });
  }
});

messageTemplatesRouter.post("/", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const templateInput = z.object({
      name: z.string().min(1),
      content: z.string().min(1),
      category: z.string().optional(),
      createdBy: z.string().optional()
    }).parse(req.body);

    const template = await storage.createMessageTemplate(templateInput);
    res.json(template);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to create message template" });
    }
  }
});

messageTemplatesRouter.patch("/:id", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const templateInput = z.object({
      name: z.string().min(1).optional(),
      content: z.string().min(1).optional(),
      category: z.string().optional(),
      isActive: z.boolean().optional()
    }).parse(req.body);

    const template = await storage.updateMessageTemplate(parseInt(req.params.id), templateInput);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(template);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update message template" });
    }
  }
});

messageTemplatesRouter.delete("/:id", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    await storage.deleteMessageTemplate(parseInt(req.params.id));
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete message template" });
  }
});

export const scheduledMessagesRouter = Router();

scheduledMessagesRouter.get("/pending", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const messages = await storage.getPendingScheduledMessages();
    res.json(messages);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch pending scheduled messages" });
  }
});

scheduledMessagesRouter.post("/", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const messageInput = z.object({
      caseId: z.string().optional(),
      messageType: z.enum(['chat', 'admin_message', 'letter']),
      category: z.string().optional(),
      title: z.string().optional(),
      content: z.string().min(1),
      scheduledFor: z.string(),
      createdBy: z.string().optional()
    }).parse(req.body);

    const message = await storage.createScheduledMessage({
      ...messageInput,
      scheduledFor: new Date(messageInput.scheduledFor)
    });
    res.json(message);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to create scheduled message" });
    }
  }
});

scheduledMessagesRouter.post("/:id/cancel", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    const message = await storage.cancelScheduledMessage(parseInt(req.params.id));
    if (!message) {
      res.status(404).json({ error: "Scheduled message not found" });
      return;
    }
    res.json(message);
  } catch (_e) {
    res.status(500).json({ error: "Failed to cancel scheduled message" });
  }
});

export function registerCaseScheduledMessageRoutes(router: Router) {
  router.get("/:id/scheduled-messages", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
    try {
      const messages = await storage.getScheduledMessagesByCaseId(req.params.id);
      res.json(messages);
    } catch (_e) {
      res.status(500).json({ error: "Failed to fetch scheduled messages" });
    }
  });
}
