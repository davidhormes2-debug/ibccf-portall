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

  // Update deposit receipt status
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

  return httpServer;
}
