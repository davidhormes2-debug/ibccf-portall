import type { Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { insertCaseSchema, updateCaseSchema, updateCaseLetterSchema, insertCaseSubmissionSchema } from "@shared/schema";
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
      const data = insertCaseSchema.parse(req.body);
      const newCase = await storage.createCase(data);
      res.json(newCase);
    } catch (error) {
      console.error('Create case error:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else if ((error as any)?.code === '23505') {
        res.status(400).json({ error: "Access code already exists" });
      } else {
        res.status(500).json({ error: "Failed to create case" });
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

  return httpServer;
}
