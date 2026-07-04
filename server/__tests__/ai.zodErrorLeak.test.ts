import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// AI Routes — Zod Validation-Leak Tests
//
// Guards the contract that every POST handler in server/routes/ai.ts returns
// a plain string { error: "Invalid request" } on bad input, NEVER raw Zod
// internals such as:
//   • { errors: [...] }  — the ZodError.errors array
//   • { issues: [...] }  — the ZodError.issues alias
//   • field-path / validator-name properties (path, code, minimum, maximum,
//     expected, received, validation, unionErrors, …)
//
// Routes covered:
//   POST /api/ai/chat
//   POST /api/ai/suggestions
//   POST /api/ai/classify
//   POST /api/ai/analyze-case
//   POST /api/ai/auto-response
//
// A future refactor that reverts to `res.json({ error: error.errors })` or
// similar will immediately break these tests, surfacing the regression before
// it ships.
// ============================================================================

const storageMock = createStorageMock({
  getCaseByAccessCode: vi.fn(),
  getChatMessagesByCaseId: vi.fn(),
  getCaseById: vi.fn(),
  getSubmissionsByCaseId: vi.fn(),
  getDepositReceiptsByCaseId: vi.fn(),
  getAllCases: vi.fn(async () => []),
});

vi.mock("../storage", () => ({
  storage: storageMock,
}));

vi.mock("../services/ai-chatbot", () => ({
  generateChatResponse: vi.fn(async () => "mock-response"),
  generateSmartReplySuggestions: vi.fn(async () => ["s1", "s2"]),
  classifyMessageIntent: vi.fn(async () => ({
    intent: "general_question",
    urgency: "low",
    sentiment: "neutral",
  })),
  analyzeCaseWithAI: vi.fn(async () => ({})),
  generateCaseInsights: vi.fn(async () => ({})),
  generateAutoResponse: vi.fn(async () => "auto"),
}));

vi.mock("../middleware/security", () => ({
  rateLimiter: () => (_req: any, _res: any, next: any) => next(),
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
  AI_CHAT_RATE_LIMIT_NAMESPACE: "ai_chat",
}));

vi.mock("../routes/middleware", () => ({
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
}));

async function buildApp() {
  const { aiRouter, _resetAiChatBudgetForTest } = await import("../routes/ai");
  const app = express();
  app.use(express.json());
  app.use("/api/ai", aiRouter);
  _resetAiChatBudgetForTest();
  return app;
}

// ── Shared assertion helper ──────────────────────────────────────────────────

function assertNoZodLeak(body: unknown) {
  const text = JSON.stringify(body);

  // Must never expose the raw ZodError.errors / ZodError.issues arrays.
  expect(text).not.toMatch(/"errors":\s*\[/);
  expect(text).not.toMatch(/"issues":\s*\[/);

  // Must never expose Zod field-path or validator-name internals.
  expect(text).not.toMatch(/"path":/);
  expect(text).not.toMatch(/"code":/);
  expect(text).not.toMatch(/"minimum":/);
  expect(text).not.toMatch(/"maximum":/);
  expect(text).not.toMatch(/"expected":/);
  expect(text).not.toMatch(/"received":/);
  expect(text).not.toMatch(/"validation":/);
  expect(text).not.toMatch(/ZodError/i);
}

// ── POST /api/ai/chat ─────────────────────────────────────────────────────────

describe("POST /api/ai/chat — Zod error not leaked on invalid input", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    app = await buildApp();
  });

  it("returns a plain string error when message is missing", async () => {
    const res = await request(app).post("/api/ai/chat").send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when message is an empty string", async () => {
    const res = await request(app).post("/api/ai/chat").send({ message: "" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when message exceeds 1000 characters", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ message: "x".repeat(1001) });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when message is a non-string type", async () => {
    const res = await request(app).post("/api/ai/chat").send({ message: 42 });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── POST /api/ai/suggestions ──────────────────────────────────────────────────

describe("POST /api/ai/suggestions — Zod error not leaked on invalid input", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    app = await buildApp();
  });

  it("returns a plain string error when message is missing", async () => {
    const res = await request(app).post("/api/ai/suggestions").send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when message is an empty string", async () => {
    const res = await request(app)
      .post("/api/ai/suggestions")
      .send({ message: "" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when message is a non-string type", async () => {
    const res = await request(app)
      .post("/api/ai/suggestions")
      .send({ message: [] });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── POST /api/ai/classify ─────────────────────────────────────────────────────

describe("POST /api/ai/classify — Zod error not leaked on invalid input", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    app = await buildApp();
  });

  it("returns a plain string error when message is missing", async () => {
    const res = await request(app).post("/api/ai/classify").send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when message is an empty string", async () => {
    const res = await request(app)
      .post("/api/ai/classify")
      .send({ message: "" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when message exceeds 2000 characters", async () => {
    const res = await request(app)
      .post("/api/ai/classify")
      .send({ message: "y".repeat(2001) });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when message is a non-string type", async () => {
    const res = await request(app)
      .post("/api/ai/classify")
      .send({ message: { nested: "object" } });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── POST /api/ai/analyze-case ─────────────────────────────────────────────────

describe("POST /api/ai/analyze-case — Zod error not leaked on invalid input", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    app = await buildApp();
  });

  it("returns a plain string error when caseId is missing", async () => {
    const res = await request(app).post("/api/ai/analyze-case").send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when caseId is an empty string", async () => {
    const res = await request(app)
      .post("/api/ai/analyze-case")
      .send({ caseId: "" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when caseId is a non-string type", async () => {
    const res = await request(app)
      .post("/api/ai/analyze-case")
      .send({ caseId: 99 });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("does not leak ZodError internals when body contains wrong field types", async () => {
    const res = await request(app)
      .post("/api/ai/analyze-case")
      .send({ caseId: { id: "oops" } });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── POST /api/ai/auto-response ────────────────────────────────────────────────

describe("POST /api/ai/auto-response — Zod error not leaked on invalid input", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    app = await buildApp();
  });

  it("returns a plain string error when body is empty", async () => {
    const res = await request(app).post("/api/ai/auto-response").send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when messageType is not a valid enum value", async () => {
    const res = await request(app)
      .post("/api/ai/auto-response")
      .send({ messageType: "not_a_valid_type" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when messageType is missing", async () => {
    const res = await request(app)
      .post("/api/ai/auto-response")
      .send({ userName: "Alice" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when messageType is a non-string type", async () => {
    const res = await request(app)
      .post("/api/ai/auto-response")
      .send({ messageType: 42 });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("does not leak ZodError internals when multiple fields have wrong types", async () => {
    const res = await request(app)
      .post("/api/ai/auto-response")
      .send({ messageType: [], userName: 99, stageName: false });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});
