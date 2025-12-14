import { Router } from "express";
import { storage } from "../storage";
import { caseService } from "../services";
import { updateCaseSchema, updateCaseLetterSchema } from "@shared/schema";
import { z } from "zod";
import { checkAdminAuth } from "./middleware";
import { createHash } from "crypto";

function hashPin(pin: string): string {
  return createHash('sha256').update(pin + 'IBCCF_PIN_SALT').digest('hex');
}

export const casesRouter = Router();

casesRouter.post("/", async (req, res) => {
  try {
    const { accessCode, status } = req.body;
    if (!accessCode) {
      res.status(400).json({ error: "Access code is required" });
      return;
    }
    
    const newCase = await caseService.createCase({ 
      accessCode, 
      status: status || 'created' 
    });
    res.json(newCase);
  } catch (error: any) {
    if (error?.code === '23505') {
      res.status(400).json({ error: "Access code already exists" });
    } else {
      res.status(500).json({ error: error?.message || "Failed to create case" });
    }
  }
});

casesRouter.get("/", async (req, res) => {
  try {
    const allCases = await caseService.getAllCases();
    res.json(allCases);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

casesRouter.get("/access/:code", async (req, res) => {
  try {
    const caseData = await caseService.getCaseByAccessCode(req.params.code);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    res.json(caseData);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch case" });
  }
});

casesRouter.get("/:id", async (req, res) => {
  try {
    const caseData = await caseService.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    res.json(caseData);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch case" });
  }
});

casesRouter.patch("/:id", async (req, res) => {
  try {
    const data = updateCaseSchema.parse(req.body);
    const updated = await caseService.updateCase(req.params.id, data);
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

casesRouter.delete("/:id", checkAdminAuth, async (req, res) => {
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

casesRouter.get("/:id/letter", async (req, res) => {
  try {
    const letter = await storage.getCaseLetterByCaseId(req.params.id);
    res.json(letter || null);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch letter" });
  }
});

casesRouter.put("/:id/letter", async (req, res) => {
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

casesRouter.get("/:id/notes", async (req, res) => {
  try {
    const notes = await storage.getCaseNotesByCaseId(req.params.id);
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

casesRouter.post("/:id/notes", checkAdminAuth, async (req, res) => {
  try {
    const noteInput = z.object({
      content: z.string().min(1),
      isPinned: z.boolean().optional()
    }).parse(req.body);

    const note = await storage.createCaseNote({
      caseId: req.params.id,
      content: noteInput.content,
      isPinned: noteInput.isPinned || false,
      adminUsername: 'Admin'
    });
    res.json(note);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to create note" });
    }
  }
});

casesRouter.patch("/:caseId/notes/:noteId", checkAdminAuth, async (req, res) => {
  try {
    const noteInput = z.object({
      content: z.string().min(1).optional(),
      isPinned: z.boolean().optional()
    }).parse(req.body);

    const note = await storage.updateCaseNote(parseInt(req.params.noteId), noteInput);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(note);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to update note" });
    }
  }
});

casesRouter.delete("/:caseId/notes/:noteId", checkAdminAuth, async (req, res) => {
  try {
    await storage.deleteCaseNote(parseInt(req.params.noteId));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete note" });
  }
});

// Verify access code and check if PIN is already set
casesRouter.post("/verify-access-code", async (req, res) => {
  try {
    const { accessCode } = z.object({ accessCode: z.string().min(1) }).parse(req.body);
    
    const caseData = await caseService.getCaseByAccessCode(accessCode);
    if (!caseData) {
      res.status(404).json({ error: "Invalid access code" });
      return;
    }
    
    res.json({
      valid: true,
      caseId: caseData.id,
      hasPinSet: !!caseData.userPin,
      userName: caseData.userName
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Access code is required" });
    } else {
      res.status(500).json({ error: "Failed to verify access code" });
    }
  }
});

// Set user's 6-digit PIN after verifying access code
casesRouter.post("/set-pin", async (req, res) => {
  try {
    const { accessCode, pin } = z.object({
      accessCode: z.string().min(1),
      pin: z.string().length(6).regex(/^\d{6}$/, "PIN must be 6 digits")
    }).parse(req.body);
    
    const caseData = await caseService.getCaseByAccessCode(accessCode);
    if (!caseData) {
      res.status(404).json({ error: "Invalid access code" });
      return;
    }
    
    if (caseData.userPin) {
      res.status(400).json({ error: "PIN already set for this case" });
      return;
    }
    
    const hashedPin = hashPin(pin);
    const updated = await caseService.updateCase(caseData.id, { userPin: hashedPin });
    
    if (!updated) {
      res.status(500).json({ error: "Failed to set PIN" });
      return;
    }
    
    res.json({
      success: true,
      message: "PIN set successfully",
      caseId: caseData.id
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0]?.message || "Invalid input" });
    } else {
      res.status(500).json({ error: "Failed to set PIN" });
    }
  }
});

// Login with 6-digit PIN
casesRouter.post("/login-pin", async (req, res) => {
  try {
    const { pin } = z.object({
      pin: z.string().length(6).regex(/^\d{6}$/, "PIN must be 6 digits")
    }).parse(req.body);
    
    const hashedPin = hashPin(pin);
    const caseData = await storage.getCaseByPin(hashedPin);
    
    if (!caseData) {
      res.status(401).json({ error: "Invalid PIN" });
      return;
    }
    
    res.json({
      success: true,
      id: caseData.id,
      accessCode: caseData.accessCode
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "PIN must be 6 digits" });
    } else {
      res.status(500).json({ error: "Failed to login" });
    }
  }
});
