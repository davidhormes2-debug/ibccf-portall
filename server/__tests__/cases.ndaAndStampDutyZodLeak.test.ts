import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Zod Validation-Leak Tests — NDA sign + stamp-duty reminder routes
//
// Ensures that malformed request bodies are rejected with a plain string
// error and never expose raw ZodError internals to the caller.
//
// Endpoints covered:
//   POST /api/cases/:id/nda/sign              (portal) — ndaSignSchema
//   POST /api/cases/:id/stamp-duty/send-reminder (admin) — stampDutyReminderSchema
// ============================================================================

const TEST_ADMIN_USERNAME = "nda-stampdutyleak-test-admin";
let savedAdminUsername: string | undefined;

beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});

afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getCaseById: vi.fn(async () => ({
      id: "case-1",
      accessCode: "ABCDEF123456",
      userName: "Test User",
      userEmail: "user@example.com",
      status: "active",
      sealedAt: null,
      userPin: null,
      withdrawalStage: "14",
      ndaEnabled: true,
      stampDutyEnabled: true,
      stampDutyStatus: "awaiting_upload",
    })),
    createAuditLog: vi.fn(async () => ({ id: 1 })),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async (_id: string, data: any) => ({
      id: "case-1",
      ...data,
    })),
    createCase: vi.fn(),
    getAllCases: vi.fn(async () => []),
    getCaseByAccessCode: vi.fn(async () => null),
    getCaseById: vi.fn(async () => ({
      id: "case-1",
      sealedAt: null,
      userPin: null,
    })),
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendPayoutWalletEmail: vi.fn(async () => ({ success: true })),
    sendLetterReadyEmail: vi.fn(async () => ({ success: true })),
    sendStampDutyReminder: vi.fn(async () => ({ success: true })),
  }),
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async () => ({ sent: true })),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async () => true),
  validatePortalSession: vi.fn(async () => null),
}));

vi.mock("../services/walletConnectAlert", () => ({
  maybeAlertOnWalletConnect: vi.fn(async () => {}),
  deleteWalletConnectAlertMarkersForCase: vi.fn(async () => {}),
  walletConnectAlertFiredKey: vi.fn(() => "key"),
}));

vi.mock("../routes/content", () => ({
  validateDocumentDataUrl: vi.fn(() => ({ ok: true })),
}));

vi.mock("../lib/warnOnce", () => ({
  warnOnce: vi.fn(),
  __resetWarnDedupForTests: vi.fn(),
}));

// Import the router after mocks are registered.
const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/cases", casesRouter);
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

// ── POST /api/cases/:id/nda/sign ─────────────────────────────────────────────

describe("POST /api/cases/:id/nda/sign — Zod error not leaked on invalid input", () => {
  it("returns a plain string error when body is empty", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-1/nda/sign")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when typedName is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-1/nda/sign")
      .send({ agreed: true });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when agreed is false instead of true", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-1/nda/sign")
      .send({ typedName: "Alice Smith", agreed: false });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("does not leak ZodError internals when typedName is too short", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-1/nda/sign")
      .send({ typedName: "A", agreed: true });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("does not leak ZodError internals when field types are completely wrong", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-1/nda/sign")
      .send({ typedName: 12345, agreed: "yes" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── POST /api/cases/:id/stamp-duty/send-reminder ────────────────────────────

describe("POST /api/cases/:id/stamp-duty/send-reminder — Zod error not leaked on invalid input", () => {
  it("returns a plain string error when body is empty", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/send-reminder")
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when email is not a valid address", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/send-reminder")
      .set("Authorization", "Bearer test-token")
      .send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when email field has the wrong type", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/send-reminder")
      .set("Authorization", "Bearer test-token")
      .send({ email: 12345 });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("does not leak ZodError internals when customMessage exceeds max length", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/send-reminder")
      .set("Authorization", "Bearer test-token")
      .send({ email: "admin@example.com", customMessage: "x".repeat(2001) });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});
