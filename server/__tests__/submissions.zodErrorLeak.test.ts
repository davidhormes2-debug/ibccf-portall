import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Zod Validation-Leak Tests — POST /api/submissions
//
// The public complaint-intake endpoint validates its body with Zod.
// These tests assert that a malformed payload never surfaces raw ZodError
// internals (the `.errors` / `.issues` array, the word "ZodError", or Zod
// field-level diagnostic keys like "path", "code", "minimum") in the response.
// ============================================================================

vi.mock("../storage", () => ({
  storage: createStorageMock({}),
}));

// Bypass the per-IP rate limiter so tests are not throttled.
vi.mock("../middleware/security", () => ({
  rateLimiter: () => (_req: any, _res: any, next: any) => next(),
  SUBMISSIONS_POST_RATE_LIMIT_NAMESPACE: "submissions_post",
}));

const { submissionsRouter } = await import("../routes/submissions");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/submissions", submissionsRouter);
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

describe("POST /api/submissions — Zod error not leaked on invalid input", () => {
  it("returns a plain string error when required fields are missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/submissions")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when name is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/submissions")
      .send({ email: "user@example.com", message: "help" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when email is invalid", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/submissions")
      .send({ name: "Alice", email: "not-an-email", message: "help" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when message is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/submissions")
      .send({ name: "Alice", email: "alice@example.com" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when name exceeds max length", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/submissions")
      .send({ name: "A".repeat(201), email: "alice@example.com", message: "help" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("does not leak ZodError internals when body fields have wrong types", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/submissions")
      .send({ name: 12345, email: true, message: [] });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});
