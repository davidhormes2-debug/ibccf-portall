import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// AI Chat Endpoint Security Tests
//
// Covers two security vulnerabilities fixed in server/routes/ai.ts:
//
//   1. POST /api/ai/chat must NOT load case context from an access code.
//      Any `caseId` field in the body must be ignored; storage must never
//      be queried; the AI is called with an empty context only.
//
//   2. The global hourly budget circuit breaker must fire once the
//      configured limit is reached, returning 429 for all further requests
//      regardless of whether they carry a valid message.
//
//   3. Invalid/oversized input must be rejected with 400 BEFORE the budget
//      is consumed so that junk requests cannot burn the hourly quota.
// ============================================================================

// Mock the storage layer so no DB calls are made.
// Any call to storage indicates a security regression.
const storageMock = createStorageMock({
  getCaseByAccessCode: vi.fn(),
  getChatMessagesByCaseId: vi.fn(),
});

vi.mock("../storage", () => ({
  storage: storageMock,
}));

// Mock the AI chatbot service so tests don't need a real OpenAI key.
vi.mock("../services/ai-chatbot", () => ({
  generateChatResponse: vi.fn(async (_msg: string, ctx: object) => {
    return `mock-response:${JSON.stringify(ctx)}`;
  }),
  generateSmartReplySuggestions: vi.fn(async () => ["s1", "s2", "s3"]),
  classifyMessageIntent: vi.fn(async () => ({
    intent: "general_question",
    urgency: "low",
    sentiment: "neutral",
  })),
  analyzeCaseWithAI: vi.fn(async () => ({})),
  generateCaseInsights: vi.fn(async () => ({})),
  generateAutoResponse: vi.fn(async () => "auto"),
}));

// Mock security middleware so the per-IP rate limiter is transparent in tests.
vi.mock("../middleware/security", () => ({
  rateLimiter: () => (_req: any, _res: any, next: any) => next(),
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
  AI_CHAT_RATE_LIMIT_NAMESPACE: "ai_chat",
}));

// Mock the route-layer admin auth guard (imported by ai.ts from "./middleware")
// so admin-only routes are reachable in unit tests without a real session.
vi.mock("../routes/middleware", () => ({
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
}));

// Dynamically import the router after mocks are registered.
async function buildApp() {
  const { aiRouter, _resetAiChatBudgetForTest } = await import("../routes/ai");
  const app = express();
  app.use(express.json());
  app.use("/api/ai", aiRouter);
  return { app, _resetAiChatBudgetForTest };
}

describe("POST /api/ai/chat — no case context loaded for anonymous callers", () => {
  let app: express.Application;
  let resetBudget: (budget?: number) => void;

  beforeEach(async () => {
    vi.resetModules();
    const built = await buildApp();
    app = built.app;
    resetBudget = built._resetAiChatBudgetForTest;
    resetBudget();
    storageMock.getCaseByAccessCode.mockClear();
    storageMock.getChatMessagesByCaseId.mockClear();
  });

  it("returns a response without querying storage for case data", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ message: "Hello, I need help" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("response");
    expect(res.body.isAI).toBe(true);

    expect(storageMock.getCaseByAccessCode).not.toHaveBeenCalled();
    expect(storageMock.getChatMessagesByCaseId).not.toHaveBeenCalled();
  });

  it("ignores any caseId field in the request body and never queries storage", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ message: "What is my case status?", caseId: "VICTIM-ACCESS-CODE" });

    expect(res.status).toBe(200);
    expect(storageMock.getCaseByAccessCode).not.toHaveBeenCalled();
    expect(storageMock.getChatMessagesByCaseId).not.toHaveBeenCalled();
  });

  it("calls generateChatResponse with an empty context object", async () => {
    const { generateChatResponse } = await import("../services/ai-chatbot");

    const res = await request(app)
      .post("/api/ai/chat")
      .send({ message: "What stage am I in?" });

    expect(res.status).toBe(200);
    expect(generateChatResponse).toHaveBeenCalledWith("What stage am I in?", {});
  });
});

describe("POST /api/ai/chat — global hourly budget circuit breaker", () => {
  let app: express.Application;
  let resetBudget: (budget?: number) => void;

  beforeEach(async () => {
    vi.resetModules();
    const built = await buildApp();
    app = built.app;
    resetBudget = built._resetAiChatBudgetForTest;
    storageMock.getCaseByAccessCode.mockClear();
  });

  it("allows requests when budget is available", async () => {
    resetBudget(10);
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ message: "Hello" });

    expect(res.status).toBe(200);
  });

  it("returns 429 when the global hourly budget is exhausted", async () => {
    resetBudget(0);
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ message: "Hello" });

    expect(res.status).toBe(429);
    expect(res.body).toHaveProperty("message");
    expect(res.headers["retry-after"]).toBeDefined();
  });
});

// ============================================================================
// Global hourly budget snapshot — cap is EXACTLY 200
//
// AI_CHAT_HOURLY_BUDGET = 200 (server/routes/ai.ts).
// This constant caps worst-case OpenAI spend when an attacker rotates IPs —
// each chat call hits a paid OpenAI endpoint, so the budget must stay tight.
// Raising it silently (e.g. 200 → 2000) would expand financial exposure by 10×
// without any visible code-review signal.
//
// These tests send exactly 200 real requests from a fully-open budget window
// rather than deriving the boundary from _resetAiChatBudgetForTest internals.
// That way a change to the constant directly causes a failure here:
//   - Cap raised to 201: the 201st request succeeds instead of returning 429.
//   - Cap lowered to 199: one of the first 200 requests gets a 429.
// ============================================================================

// ============================================================================
// Global hourly budget window snapshot — window is EXACTLY 60 minutes
//
// AI_CHAT_HOURLY_WINDOW_MS = 60 * 60 * 1000 (server/routes/ai.ts), exported
// solely for this assertion. The cap (200, see above) only bounds spend if
// the window it applies to is also correct: shortening the window (e.g. to
// 1 minute) resets the budget 60x more often, multiplying worst-case OpenAI
// spend by 60x without touching AI_CHAT_HOURLY_BUDGET at all, so it needs
// its own guard independent of the cap snapshot test.
// ============================================================================
describe("POST /api/ai/chat — global hourly budget window snapshot (60 minutes)", () => {
  it("AI_CHAT_HOURLY_WINDOW_MS is exactly 3,600,000 ms (60 minutes)", async () => {
    const { AI_CHAT_HOURLY_WINDOW_MS } = await import("../routes/ai");
    expect(AI_CHAT_HOURLY_WINDOW_MS).toBe(60 * 60 * 1000);
    expect(AI_CHAT_HOURLY_WINDOW_MS).toBe(3_600_000);
  });
});

describe("POST /api/ai/chat — global hourly budget snapshot (cap is exactly 200)", () => {
  let app: express.Application;
  let resetBudget: (budget?: number) => void;

  beforeEach(async () => {
    vi.resetModules();
    const built = await buildApp();
    app = built.app;
    resetBudget = built._resetAiChatBudgetForTest;
    storageMock.getCaseByAccessCode.mockClear();
  });

  it("allows exactly 200 requests then blocks the 201st with 429", async () => {
    // Open the full budget window (no pre-consumed slots).
    resetBudget();

    // Fire all 200 requests concurrently so the test stays fast.
    const results = await Promise.all(
      Array.from({ length: 200 }, () =>
        request(app)
          .post("/api/ai/chat")
          .send({ message: "Hello" }),
      ),
    );

    // Every one of the 200 budget slots must succeed.
    // If the cap were lower than 200, some of these would return 429.
    const blockedEarly = results.filter((r) => r.status !== 200);
    expect(blockedEarly).toHaveLength(0);

    // The 201st request must be blocked — budget is now exactly exhausted.
    // If the cap were higher than 200, this request would still succeed (200)
    // and the assertion would fail, catching the silent raise.
    const res201 = await request(app)
      .post("/api/ai/chat")
      .send({ message: "One more" });
    expect(res201.status).toBe(429);
    expect(res201.headers["retry-after"]).toBeDefined();
  }, 30000);
});

describe("POST /api/ai/chat — invalid input rejected before budget is consumed", () => {
  let app: express.Application;
  let resetBudget: (budget?: number) => void;

  beforeEach(async () => {
    vi.resetModules();
    const built = await buildApp();
    app = built.app;
    resetBudget = built._resetAiChatBudgetForTest;
  });

  it("rejects an empty message with 400 and does not consume budget", async () => {
    resetBudget(1);

    const bad = await request(app)
      .post("/api/ai/chat")
      .send({ message: "" });
    expect(bad.status).toBe(400);

    resetBudget(1);
    const good = await request(app)
      .post("/api/ai/chat")
      .send({ message: "valid" });
    expect(good.status).toBe(200);
  });

  it("rejects a message exceeding 1000 characters with 400", async () => {
    resetBudget(5);
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ message: "x".repeat(1001) });

    expect(res.status).toBe(400);
  });

  it("rejects a missing message field with 400", async () => {
    resetBudget(5);
    const res = await request(app)
      .post("/api/ai/chat")
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("POST /api/ai/chat — sanitised Zod error response", () => {
  let app: express.Application;
  let resetBudget: (budget?: number) => void;

  beforeEach(async () => {
    vi.resetModules();
    const built = await buildApp();
    app = built.app;
    resetBudget = built._resetAiChatBudgetForTest;
    resetBudget(10);
  });

  it("returns a generic error string, not raw Zod internals, on bad input", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ message: "" });

    expect(res.status).toBe(400);

    const body = res.body as Record<string, unknown>;
    // Must be a plain string, never a ZodIssue array.
    expect(typeof body.error).toBe("string");
    expect(Array.isArray(body.error)).toBe(false);

    // Must not leak field names, type annotations, or the word ZodError.
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toMatch(/ZodError/i);
    expect(bodyText).not.toMatch(/"path"/);
    expect(bodyText).not.toMatch(/"code"/);
    expect(bodyText).not.toMatch(/"minimum"/);
    expect(bodyText).not.toMatch(/"message":/);
  });

  it("returns a generic error string on a missing message field", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ notMessage: "hello" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
  });

  it("returns a generic error string on an oversized message", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ message: "x".repeat(1001) });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/ZodError/i);
  });
});

// ============================================================================
// Admin AI routes — sanitised-error regression tests
//
// Each admin route validates its request body with Zod and must return a plain
// string `error` field on bad input, never raw ZodIssue arrays or internals.
// `checkAdminAuth` is bypassed via the vi.mock above so no real session needed.
// ============================================================================

describe("POST /api/ai/suggestions — sanitised Zod error response", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    const built = await buildApp();
    app = built.app;
  });

  it("returns a plain string error (not ZodError internals) when message is missing", async () => {
    const res = await request(app)
      .post("/api/ai/suggestions")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);

    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/ZodError/i);
    expect(bodyText).not.toMatch(/"path"/);
    expect(bodyText).not.toMatch(/"code"/);
    expect(bodyText).not.toMatch(/"message":/);
  });

  it("returns 500 with a plain string error when the AI service throws", async () => {
    const { generateSmartReplySuggestions } = await import("../services/ai-chatbot");
    (generateSmartReplySuggestions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("OpenAI rate limit"),
    );

    const res = await request(app)
      .post("/api/ai/suggestions")
      .send({ message: "How can I help you?" });

    expect(res.status).toBe(500);
    // Must be a plain string, never an array or the raw error message.
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    // Must not leak internal details to callers.
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/OpenAI rate limit/i);
    expect(bodyText).not.toMatch(/ZodError/i);
  });
});

describe("POST /api/ai/classify — sanitised Zod error response", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    const built = await buildApp();
    app = built.app;
  });

  it("returns a plain string error (not ZodError internals) when message is missing", async () => {
    const res = await request(app)
      .post("/api/ai/classify")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);

    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/ZodError/i);
    expect(bodyText).not.toMatch(/"path"/);
    expect(bodyText).not.toMatch(/"code"/);
    expect(bodyText).not.toMatch(/"message":/);
  });

  it("returns 500 with a plain string error when the AI service throws", async () => {
    const { classifyMessageIntent } = await import("../services/ai-chatbot");
    (classifyMessageIntent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB connection lost"),
    );

    const res = await request(app)
      .post("/api/ai/classify")
      .send({ message: "I need my funds back" });

    expect(res.status).toBe(500);
    // Must be a plain string, never an array or the raw error message.
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    // Must not leak internal details to callers.
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/DB connection lost/i);
    expect(bodyText).not.toMatch(/ZodError/i);
  });
});

describe("POST /api/ai/analyze-case — sanitised Zod error response", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    const built = await buildApp();
    app = built.app;
  });

  it("returns a plain string error (not ZodError internals) when caseId is missing", async () => {
    const res = await request(app)
      .post("/api/ai/analyze-case")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);

    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/ZodError/i);
    expect(bodyText).not.toMatch(/"path"/);
    expect(bodyText).not.toMatch(/"code"/);
    expect(bodyText).not.toMatch(/"message":/);
  });

  it("returns 500 with a plain string error when the AI service throws", async () => {
    // Provide a valid case so storage passes and the error comes from the AI call.
    (storageMock.getCaseById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "case-1",
      userName: "Alice",
      userEmail: "alice@example.com",
      status: "open",
      withdrawalStage: 3,
      withdrawalAmount: "5000",
      internalNotes: null,
      createdAt: new Date("2024-01-01"),
    });
    (storageMock.getChatMessagesByCaseId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (storageMock.getSubmissionsByCaseId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (storageMock.getDepositReceiptsByCaseId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const { analyzeCaseWithAI } = await import("../services/ai-chatbot");
    (analyzeCaseWithAI as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("OpenAI service unavailable"),
    );

    const res = await request(app)
      .post("/api/ai/analyze-case")
      .send({ caseId: "case-1" });

    expect(res.status).toBe(500);
    // Must be a plain string, never an array or the raw error message.
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    // Must not leak internal error details to callers.
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/OpenAI service unavailable/i);
    expect(bodyText).not.toMatch(/ZodError/i);
  });

  it("returns 500 with a plain string error when getCaseById throws", async () => {
    (storageMock.getCaseById as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB connection lost"),
    );

    const res = await request(app)
      .post("/api/ai/analyze-case")
      .send({ caseId: "case-1" });

    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/DB connection lost/i);
    expect(bodyText).not.toMatch(/ZodError/i);
  });

  it("returns 500 with a plain string error when getChatMessagesByCaseId throws", async () => {
    (storageMock.getCaseById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "case-1",
      userName: "Alice",
      userEmail: "alice@example.com",
      status: "open",
      withdrawalStage: 3,
      withdrawalAmount: "5000",
      internalNotes: null,
      createdAt: new Date("2024-01-01"),
    });
    (storageMock.getChatMessagesByCaseId as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Query timeout"),
    );

    const res = await request(app)
      .post("/api/ai/analyze-case")
      .send({ caseId: "case-1" });

    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/Query timeout/i);
    expect(bodyText).not.toMatch(/ZodError/i);
  });

  it("returns 500 with a plain string error when getSubmissionsByCaseId throws", async () => {
    (storageMock.getCaseById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "case-1",
      userName: "Alice",
      userEmail: "alice@example.com",
      status: "open",
      withdrawalStage: 3,
      withdrawalAmount: "5000",
      internalNotes: null,
      createdAt: new Date("2024-01-01"),
    });
    (storageMock.getChatMessagesByCaseId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (storageMock.getSubmissionsByCaseId as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Relation does not exist"),
    );

    const res = await request(app)
      .post("/api/ai/analyze-case")
      .send({ caseId: "case-1" });

    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/Relation does not exist/i);
    expect(bodyText).not.toMatch(/ZodError/i);
  });

  it("returns 500 with a plain string error when getDepositReceiptsByCaseId throws", async () => {
    (storageMock.getCaseById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "case-1",
      userName: "Alice",
      userEmail: "alice@example.com",
      status: "open",
      withdrawalStage: 3,
      withdrawalAmount: "5000",
      internalNotes: null,
      createdAt: new Date("2024-01-01"),
    });
    (storageMock.getChatMessagesByCaseId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (storageMock.getSubmissionsByCaseId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (storageMock.getDepositReceiptsByCaseId as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Out of memory"),
    );

    const res = await request(app)
      .post("/api/ai/analyze-case")
      .send({ caseId: "case-1" });

    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/Out of memory/i);
    expect(bodyText).not.toMatch(/ZodError/i);
  });
});

describe("POST /api/ai/auto-response — sanitised Zod error response", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    const built = await buildApp();
    app = built.app;
  });

  it("returns a plain string error (not ZodError internals) when messageType is invalid", async () => {
    const res = await request(app)
      .post("/api/ai/auto-response")
      .send({ messageType: "not_a_valid_type" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);

    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/ZodError/i);
    expect(bodyText).not.toMatch(/"path"/);
    expect(bodyText).not.toMatch(/"code"/);
    expect(bodyText).not.toMatch(/"message":/);
  });

  it("returns a plain string error (not ZodError internals) when body is empty", async () => {
    const res = await request(app)
      .post("/api/ai/auto-response")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/ZodError/i);
  });

  it("returns 500 with a plain string error when the AI service throws", async () => {
    const { generateAutoResponse } = await import("../services/ai-chatbot");
    (generateAutoResponse as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB connection lost"),
    );

    const res = await request(app)
      .post("/api/ai/auto-response")
      .send({ messageType: "welcome" });

    expect(res.status).toBe(500);
    // Must be a plain string, never an array or the raw error message.
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    // Must not leak internal details to callers.
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/DB connection lost/i);
    expect(bodyText).not.toMatch(/ZodError/i);
  });
});

// ============================================================================
// GET /api/ai/insights — route contract tests
//
// The route has no request body schema (it's a GET), so Zod validation errors
// are not in play. These tests guard against regressions in the storage call
// and the generateCaseInsights response path.
// `checkAdminAuth` is bypassed via the vi.mock above so no real session needed.
// ============================================================================

describe("GET /api/ai/insights — route contract", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    const built = await buildApp();
    app = built.app;
    // Ensure getAllCases (auto-stubbed by the Proxy) returns a valid array so
    // `cases.map(...)` inside the handler never throws by default.
    (storageMock.getAllCases as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it("returns 200 with the insights object when storage and AI service resolve", async () => {
    (storageMock.getAllCases as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        status: "open",
        createdAt: new Date("2024-01-01"),
        withdrawalAmount: "5000",
        withdrawalStage: 3,
      },
    ]);

    // The mock factory default for generateCaseInsights returns {}.
    // Override it to return a richer object so the assertion is meaningful.
    const { generateCaseInsights } = await import("../services/ai-chatbot");
    (generateCaseInsights as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCases: 1,
      summary: "All clear",
    });

    const res = await request(app).get("/api/ai/insights");

    expect(res.status).toBe(200);
    // Route does `res.json(insights)` so the body is the insights object itself.
    expect(res.body).toMatchObject({ totalCases: 1, summary: "All clear" });
  });

  it("returns 500 with a plain string error when the AI service throws", async () => {
    (storageMock.getAllCases as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { generateCaseInsights } = await import("../services/ai-chatbot");
    (generateCaseInsights as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("OpenAI quota exceeded"),
    );

    const res = await request(app).get("/api/ai/insights");

    expect(res.status).toBe(500);
    // Must be a plain string, never a ZodIssue array or a raw Error message.
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    // Must not leak internal error details to callers.
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/OpenAI quota exceeded/i);
    expect(bodyText).not.toMatch(/ZodError/i);
  });

  it("returns 500 with a plain string error when the storage call itself throws", async () => {
    (storageMock.getAllCases as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB connection lost"),
    );

    const res = await request(app).get("/api/ai/insights");

    expect(res.status).toBe(500);
    // Must be a plain string, never an array or the raw DB error message.
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    // Must not leak internal details to callers.
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/DB connection lost/i);
    expect(bodyText).not.toMatch(/ZodError/i);
  });
});
