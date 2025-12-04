import type { Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { insertCaseSchema, updateCaseSchema, updateCaseLetterSchema, insertCaseSubmissionSchema, insertChatMessageSchema, insertAdminMessageSchema, insertDepositReceiptSchema } from "@shared/schema";
import { z } from "zod";

const ADMIN_TOKEN = "ibc-admin-session-2025";

function checkAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${ADMIN_TOKEN}`) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // ==================== CASE ROUTES ====================
  
  // Create a new case (Admin)
  app.post("/api/cases", async (req, res) => {
    try {
      console.log('Received create case request:', req.body);
      
      const { accessCode, status } = req.body;
      if (!accessCode) {
        res.status(400).json({ error: "Access code is required" });
        return;
      }
      
      const newCase = await storage.createCase({ 
        accessCode, 
        status: status || 'created' 
      });
      console.log('Case created:', newCase);
      res.json(newCase);
    } catch (error: any) {
      console.error('Create case error:', error);
      if (error?.code === '23505') {
        res.status(400).json({ error: "Access code already exists" });
      } else {
        res.status(500).json({ error: error?.message || "Failed to create case" });
      }
    }
  });

  // Admin login
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (username === "Admin2025" && password === "Admin123456789") {
        res.json({ success: true, token: ADMIN_TOKEN });
      } else {
        res.status(401).json({ error: "Invalid credentials" });
      }
    } catch (error) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Verify admin token
  app.get("/api/admin/verify", checkAdminAuth, (req, res) => {
    res.json({ valid: true });
  });

  // Get all cases (Admin)
  app.get("/api/cases", async (req, res) => {
    try {
      const allCases = await storage.getAllCases();
      res.json(allCases);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cases" });
    }
  });

  // Get case by access code (User login)
  app.get("/api/cases/access/:code", async (req, res) => {
    try {
      const caseData = await storage.getCaseByAccessCode(req.params.code);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      res.json(caseData);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch case" });
    }
  });

  // Get case by ID
  app.get("/api/cases/:id", async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      res.json(caseData);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch case" });
    }
  });

  // Update case (for registration, finalization, submission)
  app.patch("/api/cases/:id", async (req, res) => {
    try {
      const data = updateCaseSchema.parse(req.body);
      const updated = await storage.updateCase(req.params.id, data);
      if (!updated) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update case" });
      }
    }
  });

  // Delete case (Admin)
  app.delete("/api/cases/:id", async (req, res) => {
    try {
      await storage.deleteCase(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete case" });
    }
  });

  // ==================== CASE LETTER ROUTES ====================

  // Get letter content for a case
  app.get("/api/cases/:id/letter", async (req, res) => {
    try {
      const letter = await storage.getCaseLetterByCaseId(req.params.id);
      res.json(letter || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch letter" });
    }
  });

  // Create or update letter content for a case
  app.put("/api/cases/:id/letter", async (req, res) => {
    try {
      const data = updateCaseLetterSchema.parse(req.body);
      const letter = await storage.createOrUpdateCaseLetter(req.params.id, data);
      res.json(letter);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update letter" });
      }
    }
  });

  // ==================== SUBMISSION ROUTES ====================

  // Get all submissions (Admin)
  app.get("/api/submissions", async (req, res) => {
    try {
      const submissions = await storage.getAllSubmissions();
      res.json(submissions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch submissions" });
    }
  });

  // Get submissions for a specific case
  app.get("/api/cases/:id/submissions", async (req, res) => {
    try {
      const submissions = await storage.getSubmissionsByCaseId(req.params.id);
      res.json(submissions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch submissions" });
    }
  });

  // Create a new submission
  app.post("/api/cases/:id/submissions", async (req, res) => {
    try {
      // Validate the required selectedOption field
      const submissionInput = z.object({
        selectedOption: z.enum(['A', 'B']),
        notes: z.string().optional().nullable()
      }).parse(req.body);

      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const submissionData = {
        caseId: req.params.id,
        selectedOption: submissionInput.selectedOption,
        notes: submissionInput.notes || null,
        userName: caseData.userName,
        userEmail: caseData.userEmail,
        withdrawalAmount: caseData.withdrawalAmount,
        withdrawalBatches: caseData.withdrawalBatches,
      };

      const submission = await storage.createSubmission(submissionData);
      
      // Update case status to reflect submission
      await storage.updateCase(req.params.id, { status: 'completed' });
      
      // Auto-transition urgent admin messages to processing when user submits
      const adminMessages = await storage.getAdminMessagesByCaseId(req.params.id);
      for (const msg of adminMessages) {
        if (msg.category === 'urgent') {
          await storage.updateAdminMessage(msg.id, { category: 'processing' });
        }
      }
      
      res.json(submission);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create submission" });
      }
    }
  });

  // Delete a submission
  app.delete("/api/submissions/:id", async (req, res) => {
    try {
      await storage.deleteSubmission(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete submission" });
    }
  });

  // ==================== CHAT ROUTES ====================
  
  // Get chat messages for a case
  app.get("/api/cases/:id/messages", async (req, res) => {
    try {
      const messages = await storage.getChatMessagesByCaseId(req.params.id);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Send a chat message
  app.post("/api/cases/:id/messages", async (req, res) => {
    try {
      const messageInput = z.object({
        sender: z.enum(['admin', 'user']),
        message: z.string().min(1)
      }).parse(req.body);

      const message = await storage.createChatMessage({
        caseId: req.params.id,
        sender: messageInput.sender,
        message: messageInput.message,
        isRead: 'false'
      });
      
      res.json(message);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to send message" });
      }
    }
  });

  // Mark messages as read
  app.post("/api/cases/:id/messages/read", async (req, res) => {
    try {
      const { sender } = req.body;
      if (!sender || !['admin', 'user'].includes(sender)) {
        res.status(400).json({ error: "Invalid sender" });
        return;
      }
      await storage.markMessagesAsRead(req.params.id, sender);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark messages as read" });
    }
  });

  // Get unread message count
  app.get("/api/cases/:id/messages/unread", async (req, res) => {
    try {
      const { sender } = req.query;
      if (!sender || !['admin', 'user'].includes(sender as string)) {
        res.status(400).json({ error: "Invalid sender query parameter" });
        return;
      }
      const count = await storage.getUnreadCount(req.params.id, sender as string);
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to get unread count" });
    }
  });

  // ==================== ADMIN MESSAGES ROUTES ====================
  
  // Get admin messages for a case
  app.get("/api/cases/:id/admin-messages", async (req, res) => {
    try {
      const messages = await storage.getAdminMessagesByCaseId(req.params.id);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch admin messages" });
    }
  });

  // Create admin message
  app.post("/api/cases/:id/admin-messages", async (req, res) => {
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
      
      res.json(message);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create admin message" });
      }
    }
  });

  // Update admin message
  app.patch("/api/admin-messages/:id", async (req, res) => {
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
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update admin message" });
      }
    }
  });

  // Delete admin message
  app.delete("/api/admin-messages/:id", async (req, res) => {
    try {
      await storage.deleteAdminMessage(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete admin message" });
    }
  });

  // Mark admin message as read
  app.post("/api/admin-messages/:id/read", async (req, res) => {
    try {
      await storage.markAdminMessageAsRead(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark message as read" });
    }
  });

  // Get unread admin messages count
  app.get("/api/cases/:id/admin-messages/unread", async (req, res) => {
    try {
      const count = await storage.getUnreadAdminMessagesCount(req.params.id);
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to get unread count" });
    }
  });

  // ==================== DEPOSIT RECEIPTS ROUTES ====================
  
  // Get deposit receipts for a case
  app.get("/api/cases/:id/deposit-receipts", async (req, res) => {
    try {
      const receipts = await storage.getDepositReceiptsByCaseId(req.params.id);
      res.json(receipts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch deposit receipts" });
    }
  });

  // Upload deposit receipt
  app.post("/api/cases/:id/deposit-receipts", async (req, res) => {
    try {
      const receiptInput = z.object({
        imageData: z.string(),
        fileName: z.string().optional(),
        notes: z.string().optional()
      }).parse(req.body);

      const receipt = await storage.createDepositReceipt({
        caseId: req.params.id,
        imageData: receiptInput.imageData,
        fileName: receiptInput.fileName || null,
        notes: receiptInput.notes || null,
        status: 'pending'
      });
      
      res.json(receipt);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to upload deposit receipt" });
      }
    }
  });

  // Update deposit receipt status (new route matching frontend)
  app.patch("/api/deposit-receipts/:id", async (req, res) => {
    try {
      const data = z.object({
        status: z.enum(['pending', 'reviewed', 'approved', 'rejected']).optional(),
        adminNotes: z.string().optional()
      }).parse(req.body);

      const updated = await storage.updateDepositReceipt(parseInt(req.params.id), data);
      if (!updated) {
        res.status(404).json({ error: "Receipt not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update receipt" });
      }
    }
  });

  // Legacy route for status updates
  app.patch("/api/deposit-receipts/:id/status", async (req, res) => {
    try {
      const { status } = z.object({
        status: z.enum(['pending', 'reviewed', 'approved', 'rejected'])
      }).parse(req.body);

      const updated = await storage.updateDepositReceiptStatus(parseInt(req.params.id), status);
      if (!updated) {
        res.status(404).json({ error: "Receipt not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update receipt status" });
      }
    }
  });

  // ==================== CHAT TEMPLATES ROUTES ====================

  // Get all chat templates
  app.get("/api/chat-templates", checkAdminAuth, async (req, res) => {
    try {
      const templates = await storage.getAllChatTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chat templates" });
    }
  });

  // Get chat templates by category
  app.get("/api/chat-templates/category/:category", checkAdminAuth, async (req, res) => {
    try {
      const templates = await storage.getChatTemplatesByCategory(req.params.category);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chat templates" });
    }
  });

  // Create chat template
  app.post("/api/chat-templates", checkAdminAuth, async (req, res) => {
    try {
      const templateInput = z.object({
        name: z.string().min(1),
        content: z.string().min(1),
        category: z.string().optional(),
        shortcut: z.string().optional()
      }).parse(req.body);

      const template = await storage.createChatTemplate(templateInput);
      res.json(template);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create chat template" });
      }
    }
  });

  // Update chat template
  app.patch("/api/chat-templates/:id", checkAdminAuth, async (req, res) => {
    try {
      const templateInput = z.object({
        name: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
        category: z.string().optional(),
        shortcut: z.string().optional(),
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
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update chat template" });
      }
    }
  });

  // Delete chat template
  app.delete("/api/chat-templates/:id", checkAdminAuth, async (req, res) => {
    try {
      await storage.deleteChatTemplate(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete chat template" });
    }
  });

  // Increment template usage
  app.post("/api/chat-templates/:id/use", checkAdminAuth, async (req, res) => {
    try {
      await storage.incrementTemplateUsage(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to increment template usage" });
    }
  });

  // ==================== CASE NOTES ROUTES ====================

  // Get case notes by case ID
  app.get("/api/cases/:id/notes", checkAdminAuth, async (req, res) => {
    try {
      const notes = await storage.getCaseNotesByCaseId(req.params.id);
      res.json(notes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch case notes" });
    }
  });

  // Create case note
  app.post("/api/cases/:id/notes", checkAdminAuth, async (req, res) => {
    try {
      const noteInput = z.object({
        content: z.string().min(1),
        adminUsername: z.string().min(1),
        isPinned: z.boolean().optional()
      }).parse(req.body);

      const note = await storage.createCaseNote({
        caseId: req.params.id,
        content: noteInput.content,
        adminUsername: noteInput.adminUsername,
        isPinned: noteInput.isPinned
      });
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create case note" });
      }
    }
  });

  // Update case note
  app.patch("/api/case-notes/:id", checkAdminAuth, async (req, res) => {
    try {
      const noteInput = z.object({
        content: z.string().min(1).optional(),
        isPinned: z.boolean().optional()
      }).parse(req.body);

      const note = await storage.updateCaseNote(parseInt(req.params.id), noteInput);
      if (!note) {
        res.status(404).json({ error: "Note not found" });
        return;
      }
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update case note" });
      }
    }
  });

  // Delete case note
  app.delete("/api/case-notes/:id", checkAdminAuth, async (req, res) => {
    try {
      await storage.deleteCaseNote(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete case note" });
    }
  });

  // Toggle case note pin
  app.post("/api/case-notes/:id/toggle-pin", checkAdminAuth, async (req, res) => {
    try {
      const note = await storage.toggleCaseNotePin(parseInt(req.params.id));
      if (!note) {
        res.status(404).json({ error: "Note not found" });
        return;
      }
      res.json(note);
    } catch (error) {
      res.status(500).json({ error: "Failed to toggle note pin" });
    }
  });

  // ==================== TRANSLATIONS ROUTES ====================

  // Get translations by locale
  app.get("/api/translations/:locale", async (req, res) => {
    try {
      const translations = await storage.getTranslationsByLocale(req.params.locale);
      const translationMap: Record<string, string> = {};
      translations.forEach(t => {
        translationMap[t.key] = t.value;
      });
      res.json(translationMap);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch translations" });
    }
  });

  // Create translation
  app.post("/api/translations", checkAdminAuth, async (req, res) => {
    try {
      const translationInput = z.object({
        key: z.string().min(1),
        locale: z.string().min(2),
        value: z.string().min(1)
      }).parse(req.body);

      const translation = await storage.createTranslation(translationInput);
      res.json(translation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create translation" });
      }
    }
  });

  // ==================== AUDIT LOGS ROUTES ====================

  // Get all audit logs
  app.get("/api/audit-logs", checkAdminAuth, async (req, res) => {
    try {
      const logs = await storage.getAllAuditLogs();
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  // Create audit log
  app.post("/api/audit-logs", checkAdminAuth, async (req, res) => {
    try {
      const logInput = z.object({
        adminUsername: z.string().min(1),
        action: z.string().min(1),
        resourceType: z.string().min(1),
        resourceId: z.string().optional(),
        description: z.string().min(1),
        ipAddress: z.string().optional(),
        userAgent: z.string().optional()
      }).parse(req.body);

      const log = await storage.createAuditLog(logInput);
      res.json(log);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create audit log" });
      }
    }
  });

  return httpServer;
}
