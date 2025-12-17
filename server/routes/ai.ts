import { Router } from "express";
import { z } from "zod";
import { 
  generateChatResponse, 
  generateSmartReplySuggestions, 
  classifyMessageIntent,
  analyzeCaseWithAI,
  generateCaseInsights,
  generateAutoResponse
} from "../services/ai-chatbot";
import { storage } from "../storage";
import { checkAdminAuth } from "./middleware";

export const aiRouter = Router();

aiRouter.post("/chat", async (req, res) => {
  try {
    const input = z.object({
      message: z.string().min(1),
      caseId: z.string().optional(),
    }).parse(req.body);

    let context: {
      userName?: string;
      caseStatus?: string;
      withdrawalStage?: number;
      previousMessages?: Array<{ role: 'user' | 'admin' | 'bot'; content: string }>;
    } = {};

    if (input.caseId) {
      const caseData = await storage.getCaseByAccessCode(input.caseId);
      if (caseData) {
        context.userName = caseData.userName || undefined;
        context.caseStatus = caseData.status || undefined;
        context.withdrawalStage = caseData.withdrawalStage ? parseInt(caseData.withdrawalStage) : undefined;
        
        const messages = await storage.getChatMessagesByCaseId(caseData.id);
        context.previousMessages = messages.slice(-5).map(m => ({
          role: m.sender as 'user' | 'admin' | 'bot',
          content: m.message
        }));
      }
    }

    const response = await generateChatResponse(input.message, context);
    
    res.json({ response, isAI: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error("AI chat error:", error);
      res.status(500).json({ error: "Failed to generate AI response" });
    }
  }
});

aiRouter.post("/suggestions", checkAdminAuth, async (req, res) => {
  try {
    const input = z.object({
      message: z.string().min(1),
      caseId: z.string().optional(),
    }).parse(req.body);

    let context: { caseStatus?: string } = {};
    
    if (input.caseId) {
      const caseData = await storage.getCaseById(input.caseId);
      if (caseData) {
        context.caseStatus = caseData.status || undefined;
      }
    }

    const suggestions = await generateSmartReplySuggestions(input.message, context);
    
    res.json({ suggestions });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error("AI suggestions error:", error);
      res.status(500).json({ error: "Failed to generate suggestions" });
    }
  }
});

aiRouter.post("/classify", checkAdminAuth, async (req, res) => {
  try {
    const input = z.object({
      message: z.string().min(1),
    }).parse(req.body);

    const classification = await classifyMessageIntent(input.message);
    
    res.json(classification);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error("AI classification error:", error);
      res.status(500).json({ error: "Failed to classify message" });
    }
  }
});

aiRouter.post("/analyze-case", checkAdminAuth, async (req, res) => {
  try {
    const input = z.object({
      caseId: z.string().min(1),
    }).parse(req.body);

    const caseData = await storage.getCaseById(input.caseId);
    if (!caseData) {
      return res.status(404).json({ error: "Case not found" });
    }

    const messages = await storage.getChatMessagesByCaseId(input.caseId);
    const submissions = await storage.getSubmissionsByCaseId(input.caseId);
    const receipts = await storage.getDepositReceiptsByCaseId(input.caseId);

    const analysis = await analyzeCaseWithAI({
      userName: caseData.userName || undefined,
      userEmail: caseData.userEmail || undefined,
      status: caseData.status || undefined,
      withdrawalStage: caseData.withdrawalStage || undefined,
      withdrawalAmount: caseData.withdrawalAmount || undefined,
      depositReceipts: receipts.length,
      submissions: submissions.length,
      messages: messages.length,
      createdAt: caseData.createdAt,
      internalNotes: caseData.internalNotes || undefined,
    });

    res.json(analysis);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error("AI case analysis error:", error);
      res.status(500).json({ error: "Failed to analyze case" });
    }
  }
});

aiRouter.get("/insights", checkAdminAuth, async (req, res) => {
  try {
    const cases = await storage.getAllCases();
    
    const caseData = cases.map(c => ({
      status: c.status || 'unknown',
      createdAt: c.createdAt,
      withdrawalAmount: c.withdrawalAmount || undefined,
      withdrawalStage: c.withdrawalStage || undefined,
    }));

    const insights = await generateCaseInsights(caseData);
    
    res.json(insights);
  } catch (error) {
    console.error("AI insights error:", error);
    res.status(500).json({ error: "Failed to generate insights" });
  }
});

aiRouter.post("/auto-response", checkAdminAuth, async (req, res) => {
  try {
    const input = z.object({
      messageType: z.enum(['welcome', 'stage_update', 'document_request', 'followup', 'resolution']),
      userName: z.string().optional(),
      stageName: z.string().optional(),
      documentType: z.string().optional(),
    }).parse(req.body);

    const response = await generateAutoResponse(input.messageType, {
      userName: input.userName,
      stageName: input.stageName,
      documentType: input.documentType,
    });

    res.json({ response });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error("AI auto-response error:", error);
      res.status(500).json({ error: "Failed to generate auto-response" });
    }
  }
});
