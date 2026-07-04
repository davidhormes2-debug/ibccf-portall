import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---------------------------------------------------------------------------
// Admin auth env — mirror the pattern in cases.portalWarning.test.ts so the
// legacy env-var path in checkAdminAuth bypasses the sub-admin DB check
// (session.adminUsername === canonicalAdmin, so the extra lookup is skipped).
// ---------------------------------------------------------------------------

const TEST_ADMIN_USERNAME = "akr-admin-list-test";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---------------------------------------------------------------------------
// Mock the database — the admin list handler chains:
//   db.select().from(accessKeyRequests)[.where(...)].orderBy(...)
// The Proxy below returns a self-referential chain where every method
// returns itself, except orderBy which resolves to an empty array.
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        const noop: any = vi.fn(() => noop);
        noop.from = vi.fn(() => noop);
        noop.where = vi.fn(() => noop);
        noop.orderBy = vi.fn(() => Promise.resolve([]));
        noop.limit = vi.fn(() => Promise.resolve([]));
        noop.returning = vi.fn(() => Promise.resolve([]));
        noop.values = vi.fn(() => noop);
        noop.set = vi.fn(() => noop);
        noop.select = vi.fn(() => noop);
        noop.insert = vi.fn(() => noop);
        noop.update = vi.fn(() => noop);
        return noop;
      },
    },
  ),
}));

// ---------------------------------------------------------------------------
// Mock storage — only the methods checkAdminAuth calls are needed.
// ---------------------------------------------------------------------------

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) => {
      if (token === "valid-admin-token") {
        return {
          id: "session-akr-list-1",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: TEST_ADMIN_USERNAME,
        };
      }
      return null;
    }),
    updateAdminSessionActivity: vi.fn(async () => {}),
  }),
}));

// Bypass the per-IP rate limiters so tests are never throttled.
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

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const { accessKeyRequestsRouter } = await import("../routes/access-key-requests");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/access-key-requests", accessKeyRequestsRouter);
  return app;
}

const app = buildApp();

// ---------------------------------------------------------------------------
// Tests — admin_list_auth_guard (sentinel string for CI)
// ---------------------------------------------------------------------------

describe("GET /api/access-key-requests/admin/list — auth guard", () => {
  it("(a) returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get("/api/access-key-requests/admin/list");
    expect(res.status).toBe(401);
  });

  it("(b) returns 401 when an invalid/expired token is provided", async () => {
    const res = await request(app)
      .get("/api/access-key-requests/admin/list")
      .set("Authorization", "Bearer bad-token");
    expect(res.status).toBe(401);
  });

  it("(c) returns 200 with an empty array when a valid bearer token is provided", async () => {
    const res = await request(app)
      .get("/api/access-key-requests/admin/list")
      .set("Authorization", "Bearer valid-admin-token");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("(d) returns 200 with status=pending filter applied", async () => {
    const res = await request(app)
      .get("/api/access-key-requests/admin/list?status=pending")
      .set("Authorization", "Bearer valid-admin-token");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("(e) returns 200 with status=approved filter applied", async () => {
    const res = await request(app)
      .get("/api/access-key-requests/admin/list?status=approved")
      .set("Authorization", "Bearer valid-admin-token");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("(f) returns 200 with status=all (no filter)", async () => {
    const res = await request(app)
      .get("/api/access-key-requests/admin/list?status=all")
      .set("Authorization", "Bearer valid-admin-token");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
