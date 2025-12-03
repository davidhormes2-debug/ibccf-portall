import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { insertCaseSchema, updateCaseSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Create a new case (Admin)
  app.post("/api/cases", async (req, res) => {
    try {
      const data = insertCaseSchema.parse(req.body);
      const newCase = await storage.createCase(data);
      res.json(newCase);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create case" });
      }
    }
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

  return httpServer;
}
