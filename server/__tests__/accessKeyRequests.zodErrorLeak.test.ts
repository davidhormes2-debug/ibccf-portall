import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// Validation-Leak Tests — POST /api/access-key-requests
//
// The public access-key-request submission endpoint validates its input with
// manual guards rather than Zod. These tests confirm that every validation
// failure path returns a plain string error and never exposes raw error
// internals (ZodError arrays, "errors"/"issues" arrays, or Zod diagnostic
// field keys) to the caller. The suite also acts as a regression guard: if a
// future refactor introduces Zod parsing on these routes, leaking its
// `.errors` array would immediately cause these tests to fail.
// ============================================================================

// Mock the database module so no real DB is required.
vi.mock("../db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        // Return a chainable no-op object for any drizzle query builder call.
        const noop: any = vi.fn(() => noop);
        noop.from = vi.fn(() => noop);
        noop.where = vi.fn(() => noop);
        noop.limit = vi.fn(() => Promise.resolve([]));
        noop.returning = vi.fn(() => Promise.resolve([]));
        noop.values = vi.fn(() => noop);
        noop.set = vi.fn(() => noop);
        noop.select = vi.fn(() => noop);
        noop.insert = vi.fn(() => noop);
        noop.update = vi.fn(() => noop);
        noop.orderBy = vi.fn(() => noop);
        if (typeof prop === "symbol") return undefined;
        return noop;
      },
    },
  ),
}));

// Bypass the per-IP rate limiter so tests are not throttled.
vi.mock("../middleware/security", () => ({
  rateLimiter: () => (_req: any, _res: any, next: any) => next(),
  ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE: "access_key_submit",
  ACCESS_KEY_STATUS_RATE_LIMIT_NAMESPACE: "access_key_status",
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendKeyRequestConfirmation: vi.fn(async () => {}),
    sendKeyApprovalNotification: vi.fn(async () => {}),
    sendRejectionEmail: vi.fn(async () => {}),
    sendAdminMessageNotification: vi.fn(async () => {}),
  }),
}));

vi.mock("../services/portal-auth", () => ({
  isAuthorizedForCase: vi.fn(async () => false),
}));

const { accessKeyRequestsRouter } = await import(
  "../routes/access-key-requests"
);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/access-key-requests", accessKeyRequestsRouter);
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

describe("POST /api/access-key-requests — validation error not leaked on invalid input", () => {
  it("returns a plain string error when userName and userEmail are both missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/access-key-requests")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when only userName is provided (email missing)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/access-key-requests")
      .send({ userName: "Alice" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when only userEmail is provided (name missing)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/access-key-requests")
      .send({ userEmail: "alice@example.com" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});
