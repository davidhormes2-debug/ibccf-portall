import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Zod Validation-Leak Tests — visitor routes
//
// Two public write endpoints validate their bodies with Zod schemas derived
// from `@shared/schema` via drizzle-zod:
//
//   POST /api/visitors/offline-messages — publicOfflineMessageSchema.safeParse()
//   POST /api/visitors/satisfaction     — publicSatisfactionRatingSchema.safeParse()
//
// These tests assert that a malformed payload is rejected with a plain string
// error and never exposes raw ZodError internals (the `.errors` / `.issues`
// array, the word "ZodError", or field-level diagnostic keys) in the response.
// ============================================================================

vi.mock("../storage", () => ({
  storage: createStorageMock({}),
  DatabaseStorage: class {
    static ACTIVE_VISITOR_STALE_MS = 60_000;
  },
}));

vi.mock("../services/visitor-intel", () => ({
  parseUserAgent: vi.fn(() => ({})),
  lookupIpGeo: vi.fn(async () => ({})),
  getCachedIpGeo: vi.fn(() => null),
  inferPersona: vi.fn(() => "unknown"),
  computeRiskScore: vi.fn(() => 0),
}));

vi.mock("../middleware/security", () => ({
  rateLimiter: () => (_req: any, _res: any, next: any) => next(),
  VISITOR_OFFLINE_MSG_RATE_LIMIT_NAMESPACE: "visitor_offline_msg",
  VISITOR_SATISFACTION_RATE_LIMIT_NAMESPACE: "visitor_satisfaction",
  VISITOR_HEARTBEAT_RATE_LIMIT_NAMESPACE: "visitor_heartbeat",
  VISITOR_TYPING_RATE_LIMIT_NAMESPACE: "visitor_typing",
  VISITOR_TYPING_GET_RATE_LIMIT_NAMESPACE: "visitor_typing_get",
}));

vi.mock("./middleware", () => ({
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/warnOnce", () => ({
  warnOnce: vi.fn(),
}));

const visitorsRouter = (await import("../routes/visitors")).default;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/visitors", visitorsRouter);
  return app;
}

// ── Helper ───────────────────────────────────────────────────────────────────
function assertNoZodLeak(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/ZodError/i);
  expect(text).not.toMatch(/"errors":\s*\[/);
  expect(text).not.toMatch(/"issues":\s*\[/);
  expect(text).not.toMatch(/"path":/);
  expect(text).not.toMatch(/"code":/);
  expect(text).not.toMatch(/"minimum":/);
  expect(text).not.toMatch(/"maximum":/);
  expect(text).not.toMatch(/"expected":/);
  expect(text).not.toMatch(/"received":/);
}

// ── POST /api/visitors/offline-messages ──────────────────────────────────────

describe("POST /api/visitors/offline-messages — Zod error not leaked on invalid input", () => {
  it("returns a plain string error when body is empty", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/visitors/offline-messages")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when name is not a string", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/visitors/offline-messages")
      .send({ name: 99999, email: "alice@example.com", subject: "Help", message: "Hello" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when required field types are wrong", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/visitors/offline-messages")
      .send({ name: 12345, email: true, message: [] });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when message is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/visitors/offline-messages")
      .send({ name: "Alice", email: "alice@example.com" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── POST /api/visitors/satisfaction ─────────────────────────────────────────

describe("POST /api/visitors/satisfaction — Zod error not leaked on invalid input", () => {
  it("returns a plain string error when body is empty", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/visitors/satisfaction")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when rating is not an integer", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/visitors/satisfaction")
      .send({ visitorId: "v-1", caseId: "c-1", rating: "not-a-number" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when visitorId is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/visitors/satisfaction")
      .send({ caseId: "c-1", rating: 5 });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("does not leak ZodError internals when field types are wrong", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/visitors/satisfaction")
      .send({ visitorId: 99999, caseId: true, rating: "bad" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});
