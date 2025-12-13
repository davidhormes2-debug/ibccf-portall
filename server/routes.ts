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
    if (req.method === 'DELETE' && req.path.startsWith('/api/cases/')) {
      const caseId = req.path.split('/').pop();
      storage.createAuditLog({
        action: 'delete_case_unauthorized',
        newValue: `Unauthorized deletion attempt for case: ${caseId}`,
        adminUsername: 'Unknown',
        targetType: 'case',
        targetId: caseId || undefined
      }).catch(() => {});
    }
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
      
      // Auto-calculate 30% merge deposit when phraseKeyDepositAmount is set
      if (data.phraseKeyDepositAmount) {
        // Extract numeric portion and preserve currency suffix
        const numericMatch = data.phraseKeyDepositAmount.match(/[\d,.]+/);
        const currencyMatch = data.phraseKeyDepositAmount.match(/[A-Za-z]+$/);
        const currencySuffix = currencyMatch ? ' ' + currencyMatch[0] : '';
        
        if (numericMatch) {
          const depositAmount = parseFloat(numericMatch[0].replace(/,/g, ''));
          if (!isNaN(depositAmount)) {
            const mergeDeposit = depositAmount * 0.30;
            data.phraseKeyMergeDeposit = mergeDeposit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + currencySuffix;
          }
        }
      }
      
      // Get current case to check for stage changes
      const currentCase = await storage.getCaseById(req.params.id);
      const previousStage = currentCase?.withdrawalStage;
      
      const updated = await storage.updateCase(req.params.id, data);
      if (!updated) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      
      // Auto-send secure message when stage reaches 3 (Phrase Key Approved) and certificate not yet sent
      if (data.withdrawalStage === '3' && previousStage !== '3' && !updated.phraseKeyCertificateSent) {
        try {
          await storage.createAdminMessage({
            caseId: req.params.id,
            category: 'resolved',
            title: 'Phrase Key Certificate Approved',
            body: `Your Phrase Key has been successfully verified and approved. Your unique encryption certificate has been generated and is now active for withdrawal processing. This certificate is required for all future withdrawal transactions and ensures the security of your funds. Please proceed to the next verification stage.`,
            isRead: false
          });
          // Mark certificate as sent
          await storage.updateCase(req.params.id, { phraseKeyCertificateSent: true });
        } catch (msgError) {
          console.error('Failed to send phrase key certificate message:', msgError);
        }
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

  // Delete case (Admin only - with protection for verified accounts)
  app.delete("/api/cases/:id", checkAdminAuth, async (req, res) => {
    const caseId = req.params.id;
    const forceDelete = req.query.force === 'true';
    
    try {
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        try {
          await storage.createAuditLog({
            action: 'delete_case_attempt',
            newValue: `Attempted to delete non-existent case: ${caseId}`,
            adminUsername: 'Admin',
            targetType: 'case',
            targetId: caseId
          });
        } catch {}
        res.status(404).json({ error: "Case not found" });
        return;
      }
      
      const verifiedStatuses = ['registered', 'syncing', 'active', 'completed'];
      const isVerified = verifiedStatuses.includes(caseData.status || '');
      
      if (isVerified && !forceDelete) {
        try {
          await storage.createAuditLog({
            action: 'delete_case_blocked',
            newValue: `Blocked deletion of verified account: ${caseData.userName || caseData.accessCode} (Status: ${caseData.status}) - Force confirmation required`,
            adminUsername: 'Admin',
            targetType: 'case',
            targetId: caseId
          });
        } catch {}
        res.status(403).json({ 
          error: "This is a verified account and cannot be deleted without explicit confirmation",
          requiresConfirmation: true,
          status: caseData.status
        });
        return;
      }
      
      await storage.deleteCase(caseId);
      
      try {
        await storage.createAuditLog({
          action: 'delete_case_success',
          previousValue: `Account: ${caseData.userName || caseData.accessCode} (Status: ${caseData.status})`,
          newValue: `Successfully deleted (Verified: ${isVerified}, Force: ${forceDelete})`,
          adminUsername: 'Admin',
          targetType: 'case',
          targetId: caseId
        });
      } catch (auditError) {
        console.error('Failed to create audit log:', auditError);
      }
      
      res.json({ success: true });
    } catch (error) {
      try {
        await storage.createAuditLog({
          action: 'delete_case_error',
          newValue: `Error deleting case ${caseId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          adminUsername: 'Admin',
          targetType: 'case',
          targetId: caseId
        });
      } catch {}
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

  // ==================== ADMIN CLEAR LOGS ====================

  // Clear logs (activity logs, audit logs, chat messages) - preserves user accounts
  app.post("/api/admin/clear-logs", checkAdminAuth, async (req, res) => {
    try {
      await storage.clearAllLogs();
      res.json({ success: true, message: "Logs cleared successfully. User accounts preserved." });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear logs" });
    }
  });

  // ==================== ADMIN USERS ====================

  // Get all admin users
  app.get("/api/admin-users", checkAdminAuth, async (req, res) => {
    try {
      const adminUsers = [
        {
          id: 1,
          username: 'Admin2025',
          email: 'admin@ibc.com',
          role: 'super_admin',
          isActive: true,
          lastLoginAt: new Date().toISOString(),
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      ];
      res.json(adminUsers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch admin users" });
    }
  });

  // ==================== ADMIN SESSIONS ====================

  // Get admin sessions by username
  app.get("/api/admin-sessions/:username", checkAdminAuth, async (req, res) => {
    try {
      const sessions = await storage.getAdminSessionsByUsername(req.params.username);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch admin sessions" });
    }
  });

  // Create admin session
  app.post("/api/admin-sessions", checkAdminAuth, async (req, res) => {
    try {
      const sessionInput = z.object({
        adminUsername: z.string().min(1),
        token: z.string().min(1),
        ipAddress: z.string().optional(),
        userAgent: z.string().optional(),
        location: z.string().optional(),
        expiresAt: z.string()
      }).parse(req.body);

      const session = await storage.createAdminSession({
        ...sessionInput,
        expiresAt: new Date(sessionInput.expiresAt)
      });
      res.json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create admin session" });
      }
    }
  });

  // Revoke admin session
  app.post("/api/admin-sessions/:id/revoke", checkAdminAuth, async (req, res) => {
    try {
      const { reason } = req.body;
      await storage.revokeAdminSession(req.params.id, reason || 'Manual revocation');
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to revoke session" });
    }
  });

  // ==================== NOTIFICATIONS ====================

  // Get notifications for admin
  app.get("/api/notifications/admin", checkAdminAuth, async (req, res) => {
    try {
      const notifications = await storage.getNotificationsByRecipient('admin', 'admin');
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // Get notifications for a case/user
  app.get("/api/notifications/case/:caseId", async (req, res) => {
    try {
      const notifications = await storage.getNotificationsByRecipient('user', req.params.caseId);
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // Create notification
  app.post("/api/notifications", checkAdminAuth, async (req, res) => {
    try {
      const notificationInput = z.object({
        recipientType: z.enum(['admin', 'user']),
        recipientId: z.string().optional(),
        type: z.string().min(1),
        title: z.string().min(1),
        body: z.string().optional(),
        link: z.string().optional(),
        metadata: z.string().optional()
      }).parse(req.body);

      const notification = await storage.createNotification(notificationInput);
      res.json(notification);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create notification" });
      }
    }
  });

  // Mark notification as read
  app.post("/api/notifications/:id/read", async (req, res) => {
    try {
      await storage.markNotificationAsRead(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  });

  // Get unread notification count
  app.get("/api/notifications/admin/unread", checkAdminAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadNotificationCount('admin', 'admin');
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to get unread count" });
    }
  });

  // ==================== SCHEDULED MESSAGES ====================

  // Get scheduled messages for a case
  app.get("/api/cases/:id/scheduled-messages", checkAdminAuth, async (req, res) => {
    try {
      const messages = await storage.getScheduledMessagesByCaseId(req.params.id);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scheduled messages" });
    }
  });

  // Get all pending scheduled messages
  app.get("/api/scheduled-messages/pending", checkAdminAuth, async (req, res) => {
    try {
      const messages = await storage.getPendingScheduledMessages();
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pending scheduled messages" });
    }
  });

  // Create scheduled message
  app.post("/api/scheduled-messages", checkAdminAuth, async (req, res) => {
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
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create scheduled message" });
      }
    }
  });

  // Cancel scheduled message
  app.post("/api/scheduled-messages/:id/cancel", checkAdminAuth, async (req, res) => {
    try {
      const message = await storage.cancelScheduledMessage(parseInt(req.params.id));
      if (!message) {
        res.status(404).json({ error: "Scheduled message not found" });
        return;
      }
      res.json(message);
    } catch (error) {
      res.status(500).json({ error: "Failed to cancel scheduled message" });
    }
  });

  // ==================== MESSAGE TEMPLATES ====================

  // Get all message templates
  app.get("/api/message-templates", checkAdminAuth, async (req, res) => {
    try {
      const templates = await storage.getAllMessageTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch message templates" });
    }
  });

  // Get message templates by category
  app.get("/api/message-templates/category/:category", checkAdminAuth, async (req, res) => {
    try {
      const templates = await storage.getMessageTemplatesByCategory(req.params.category);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch message templates" });
    }
  });

  // Create message template
  app.post("/api/message-templates", checkAdminAuth, async (req, res) => {
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
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create message template" });
      }
    }
  });

  // Update message template
  app.patch("/api/message-templates/:id", checkAdminAuth, async (req, res) => {
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
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update message template" });
      }
    }
  });

  // Delete message template
  app.delete("/api/message-templates/:id", checkAdminAuth, async (req, res) => {
    try {
      await storage.deleteMessageTemplate(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete message template" });
    }
  });

  // ==================== DOCUMENT REQUESTS ====================

  // Get document requests for a case
  app.get("/api/cases/:id/document-requests", async (req, res) => {
    try {
      const requests = await storage.getDocumentRequestsByCaseId(req.params.id);
      res.json(requests);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch document requests" });
    }
  });

  // Create document request
  app.post("/api/cases/:id/document-requests", checkAdminAuth, async (req, res) => {
    try {
      const requestInput = z.object({
        documentType: z.string().min(1),
        description: z.string().optional(),
        deadline: z.string().optional()
      }).parse(req.body);

      const request = await storage.createDocumentRequest({
        caseId: req.params.id,
        ...requestInput,
        deadline: requestInput.deadline ? new Date(requestInput.deadline) : undefined
      });
      res.json(request);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create document request" });
      }
    }
  });

  // Update document request status
  app.patch("/api/document-requests/:id", async (req, res) => {
    try {
      const requestInput = z.object({
        status: z.enum(['pending', 'submitted', 'approved', 'rejected']).optional(),
        adminNotes: z.string().optional(),
        submittedFileData: z.string().optional(),
        submittedFileName: z.string().optional()
      }).parse(req.body);

      const request = await storage.updateDocumentRequest(parseInt(req.params.id), requestInput);
      if (!request) {
        res.status(404).json({ error: "Document request not found" });
        return;
      }
      res.json(request);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update document request" });
      }
    }
  });

  // ==================== USER SESSIONS ====================

  // Get all user sessions (admin view)
  app.get("/api/user-sessions", checkAdminAuth, async (req, res) => {
    try {
      const allSessions = await storage.getAllUserSessions();
      res.json(allSessions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user sessions" });
    }
  });

  // Get user sessions for a case
  app.get("/api/cases/:id/sessions", checkAdminAuth, async (req, res) => {
    try {
      const sessions = await storage.getUserSessionsByCaseId(req.params.id);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user sessions" });
    }
  });

  // Create user session
  app.post("/api/cases/:id/sessions", async (req, res) => {
    try {
      const sessionInput = z.object({
        sessionToken: z.string().min(1),
        ipAddress: z.string().optional(),
        userAgent: z.string().optional(),
        location: z.string().optional(),
        expiresAt: z.string().optional()
      }).parse(req.body);

      const session = await storage.createUserSession({
        caseId: req.params.id,
        ...sessionInput,
        expiresAt: sessionInput.expiresAt ? new Date(sessionInput.expiresAt) : undefined
      });
      res.json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create user session" });
      }
    }
  });

  // Deactivate user session
  app.post("/api/user-sessions/:id/deactivate", checkAdminAuth, async (req, res) => {
    try {
      const session = await storage.deactivateUserSession(parseInt(req.params.id));
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json(session);
    } catch (error) {
      res.status(500).json({ error: "Failed to deactivate session" });
    }
  });

  // ==================== HELP ARTICLES ====================

  // Get all help articles (public)
  app.get("/api/help-articles", async (req, res) => {
    try {
      const articles = await storage.getAllHelpArticles();
      res.json(articles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch help articles" });
    }
  });

  // Get help articles by category
  app.get("/api/help-articles/category/:category", async (req, res) => {
    try {
      const articles = await storage.getHelpArticlesByCategory(req.params.category);
      res.json(articles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch help articles" });
    }
  });

  // Get single help article
  app.get("/api/help-articles/:id", async (req, res) => {
    try {
      const article = await storage.getHelpArticleById(parseInt(req.params.id));
      if (!article) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      res.json(article);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch help article" });
    }
  });

  // Create help article
  app.post("/api/help-articles", checkAdminAuth, async (req, res) => {
    try {
      const articleInput = z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        category: z.string().optional(),
        order: z.string().optional(),
        isPublished: z.boolean().optional()
      }).parse(req.body);

      const article = await storage.createHelpArticle(articleInput);
      res.json(article);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create help article" });
      }
    }
  });

  // Update help article
  app.patch("/api/help-articles/:id", checkAdminAuth, async (req, res) => {
    try {
      const articleInput = z.object({
        title: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
        category: z.string().optional(),
        order: z.string().optional(),
        isPublished: z.boolean().optional()
      }).parse(req.body);

      const article = await storage.updateHelpArticle(parseInt(req.params.id), articleInput);
      if (!article) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      res.json(article);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update help article" });
      }
    }
  });

  // Delete help article
  app.delete("/api/help-articles/:id", checkAdminAuth, async (req, res) => {
    try {
      await storage.deleteHelpArticle(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete help article" });
    }
  });

  // ==================== USER FEEDBACK ====================

  // Get all user feedback
  app.get("/api/user-feedback", checkAdminAuth, async (req, res) => {
    try {
      const feedback = await storage.getAllUserFeedback();
      res.json(feedback);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user feedback" });
    }
  });

  // Get feedback for a case
  app.get("/api/cases/:id/feedback", async (req, res) => {
    try {
      const feedback = await storage.getUserFeedbackByCaseId(req.params.id);
      res.json(feedback);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user feedback" });
    }
  });

  // Create user feedback
  app.post("/api/cases/:id/feedback", async (req, res) => {
    try {
      const feedbackInput = z.object({
        rating: z.string().min(1),
        comment: z.string().optional(),
        feedbackType: z.string().optional()
      }).parse(req.body);

      const feedback = await storage.createUserFeedback({
        caseId: req.params.id,
        ...feedbackInput
      });
      res.json(feedback);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create user feedback" });
      }
    }
  });

  return httpServer;
}
