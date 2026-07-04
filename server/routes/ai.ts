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
import { rateLimiter, AI_CHAT_RATE_LIMIT_NAMESPACE } from "../middleware/security";
import { warnOnce } from "../lib/warnOnce";

export const aiRouter = Router();

// Strict per-IP rate limit for the public AI chat endpoint (5 req/min).
// Persisted to the DB so an attacker cannot bypass the per-IP cap by
// spraying requests across autoscale instances — each request hits a
// paid OpenAI endpoint, so the per-instance budget must be authoritative.
const aiChatLimiter = rateLimiter(5, 60 * 1000, {
  persistNamespace: AI_CHAT_RATE_LIMIT_NAMESPACE,
});

// Server-side global hourly budget for anonymous AI chat calls.
// Acts as a circuit breaker: once the hourly cap is reached, all further
// requests return 429 until the window resets, regardless of source IP.
// This caps worst-case OpenAI spend even when an attacker rotates IPs.
//
// The counter is persisted to the shared DB via atomicIncrementRateLimit so
// the budget is authoritative across all autoscale instances — an attacker
// cannot bypass it by spreading requests across different processes.
const AI_CHAT_HOURLY_BUDGET = 200;
// Exported only for use in unit tests — a snapshot test asserts this is
// exactly 3,600,000 ms (60 minutes). Shortening this window (e.g. to 1
// minute) resets the budget 60x more often, multiplying worst-case OpenAI
// spend by 60x without touching the cap itself, so it needs its own guard.
export const AI_CHAT_HOURLY_WINDOW_MS = 60 * 60 * 1000;
// Stable DB key used across all instances. Must not change once deployed.
const AI_CHAT_GLOBAL_BUDGET_KEY = "ai_chat_global_budget:global:hourly";

// In-memory fallback state used only when the DB is unavailable.
let aiChatFallbackCount = 0;
let aiChatFallbackResetAt = Date.now() + AI_CHAT_HOURLY_WINDOW_MS;

async function consumeGlobalAiChatBudget(res: import("express").Response): Promise<boolean> {
  const now = Date.now();
  try {
    const { count, resetAt } = await storage.atomicIncrementRateLimit({
      key: AI_CHAT_GLOBAL_BUDGET_KEY,
      windowResetAt: new Date(now + AI_CHAT_HOURLY_WINDOW_MS),
    });
    if (count > AI_CHAT_HOURLY_BUDGET) {
      const retryAfter = Math.ceil((resetAt.getTime() - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.status(429).json({
        message: "Service temporarily unavailable. Please try again later.",
        retryAfter,
      });
      return false;
    }
    return true;
  } catch {
    // DB unavailable — fall back to in-memory. Degraded but not disabled:
    // the circuit breaker still fires per-instance rather than failing open.
    if (now >= aiChatFallbackResetAt) {
      aiChatFallbackCount = 0;
      aiChatFallbackResetAt = now + AI_CHAT_HOURLY_WINDOW_MS;
    }
    if (aiChatFallbackCount >= AI_CHAT_HOURLY_BUDGET) {
      const retryAfter = Math.ceil((aiChatFallbackResetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.status(429).json({
        message: "Service temporarily unavailable. Please try again later.",
        retryAfter,
      });
      return false;
    }
    aiChatFallbackCount++;
    return true;
  }
}

// Exported only for use in unit tests — resets module-level fallback counters.
export function _resetAiChatBudgetForTest(budget = AI_CHAT_HOURLY_BUDGET): void {
  aiChatFallbackCount = 0;
  aiChatFallbackResetAt = Date.now() + AI_CHAT_HOURLY_WINDOW_MS;
  // Allow callers to pre-fill the counter to test the threshold.
  aiChatFallbackCount = AI_CHAT_HOURLY_BUDGET - budget;
}

aiRouter.post("/chat", aiChatLimiter, async (req, res) => {
  try {
    // Validate input first so malformed requests never consume the global budget.
    const input = z.object({
      message: z.string().min(1).max(1000),
    }).parse(req.body);

    // Check global hourly circuit breaker only after input is valid.
    if (!await consumeGlobalAiChatBudget(res)) return;

    const response = await generateChatResponse(input.message, {});
    
    res.json({ response, isAI: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      warnOnce("ai:chat", "AI chat error:", error);
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
      res.status(400).json({ error: "Invalid request" });
    } else {
      warnOnce("ai:suggestions", "AI suggestions error", error);
      res.status(500).json({ error: "Failed to generate suggestions" });
    }
  }
});

aiRouter.post("/classify", checkAdminAuth, async (req, res) => {
  try {
    const input = z.object({
      message: z.string().min(1).max(2000),
    }).parse(req.body);

    const result = await classifyMessageIntent(input.message);

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      warnOnce("ai:classify", "AI classify error:", error);
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
      res.status(400).json({ error: "Invalid request" });
    } else {
      warnOnce("ai:analyze-case", "AI case analysis error:", error);
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
    warnOnce("ai:insights", "AI insights error", error);
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
      res.status(400).json({ error: "Invalid request" });
    } else {
      warnOnce("ai:auto-response", "AI auto-response error:", error);
      res.status(500).json({ error: "Failed to generate auto-response" });
    }
  }
});
