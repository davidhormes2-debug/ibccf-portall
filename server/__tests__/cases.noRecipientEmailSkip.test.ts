import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { __resetWarnDedupForTests } from "../lib/warnOnce";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---------------------------------------------------------------------------
// Admin auth env — the legacy env-var path in resolveAdminRoleFromUsername
// gives super_admin without a DB lookup when ADMIN_USERNAME matches.
// ---------------------------------------------------------------------------

const TEST_ADMIN_USERNAME = "no-recipient-email-skip-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
  delete process.env.DOCUMENT_UPLOAD_ALERT_EMAIL;
  delete process.env.ADMIN_ALERT_EMAIL;
});

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

const createdCase = {
  id: "IBCCF-TEST-NOEMAIL-001",
  accessCode: "TESTCODE001",
  status: "created",
  userEmail: null,
  userName: null,
  isDisabled: false,
  forceLogoutAt: null,
};

const storedMessage = {
  id: 99,
  caseId: createdCase.id,
  sender: "user",
  message: "Hello, I need help.",
  isRead: "false",
  createdAt: new Date().toISOString(),
};

const adminAlertEmailCalls: string[] = [];
const adminNewMessageEmailCalls: string[] = [];

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({ db: {} }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (_token: string) => ({
      id: "session-no-recipient-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getCaseById: vi.fn(async () => createdCase),
    createChatMessage: vi.fn(async () => storedMessage),
    createAuditLog: vi.fn(async (entry: any) => ({ id: 1, ...entry })),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    getAdminLoginAttemptByKey: vi.fn(async () => null),
    clearAdminLoginAttemptKey: vi.fn(async () => {}),
    atomicIncrementRateLimit: vi.fn(async () => ({
      count: 1,
      resetAt: new Date(Date.now() + 60_000),
    })),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    createCase: vi.fn(async () => createdCase),
    updateCase: vi.fn(async () => createdCase),
    getAllCases: vi.fn(async () => []),
    getCaseById: vi.fn(async () => createdCase),
    getCaseByAccessCode: vi.fn(async () => null),
  },
}));

// resolveDocumentUploadAlertRecipientsLocal returns [] — simulates the
// cleared-recipient scenario the task is guarding against.
vi.mock("../routes/content", async (importOriginal) => {
  const real = await importOriginal<typeof import("../routes/content")>();
  return {
    ...real,
    resolveDocumentUploadAlertRecipientsLocal: vi.fn(async () => []),
    validateDocumentDataUrl: real.validateDocumentDataUrl,
    readDocumentUploadAlertEmailSetting: vi.fn(async () => ({
      recipients: [],
      value: "",
      source: "default" as const,
      envOverride: false,
      storedValue: "",
      updatedAt: null,
      updatedBy: null,
    })),
  };
});

// Track whether the email-send methods are called — they must NOT be.
import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendAdminNewCaseAlert: vi.fn(async (opts: any) => {
      adminAlertEmailCalls.push(opts);
      return { success: true };
    }),
    sendAdminNewMessageAlert: vi.fn(async (opts: any) => {
      adminNewMessageEmailCalls.push(opts);
      return { success: true };
    }),
    sendPortalWarning: vi.fn(async () => ({ success: true })),
    sendCaseEmail: vi.fn(async () => ({ success: true })),
    sendUserDocumentUploadedAlert: vi.fn(async () => ({ success: true })),
  }),
}));

vi.mock("../services/emailNotify", () => ({
  resolveRecipientLocale: vi.fn(async () => "en"),
  sendCaseEmailWithAudit: vi.fn(async () => ({ sent: true })),
}));

vi.mock("../services/pathwayReset", () => ({
  disableAndResetPathway: vi.fn(async () => {}),
  resetWithdrawalPathway: vi.fn(async () => {}),
}));

// NotificationService: notifyAdmin no-op so the fire-and-forget in-app
// notification block doesn't fail and contaminate the test.
vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyAdmin: vi.fn(async () => {}),
  },
}));

// Portal-auth middleware: allow all requests through so the messages route
// can be exercised without a real portal session.
vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async () => true),
  validatePortalSession: vi.fn(async () => ({
    valid: true,
    caseId: createdCase.id,
  })),
}));

// isValidAdminToken: return false so sender:'user' messages are accepted
// as portal-session originated (not admin-originated), exercising the
// fire-and-forget email block.
vi.mock("../routes/middleware", async (importOriginal) => {
  const real = await importOriginal<typeof import("../routes/middleware")>();
  return {
    ...real,
    isValidAdminToken: vi.fn(async () => false),
  };
});

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const { casesRouter } = await import("../routes/cases");
const { registerCaseMessageRoutes } = await import("../routes/messages");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  // Mount the cases router (handles POST /).
  app.use("/api/cases", casesRouter);
  // Mount the case-message routes on a separate router (handles /:id/messages).
  const msgRouter = Router({ mergeParams: true });
  registerCaseMessageRoutes(msgRouter);
  app.use("/api/cases", msgRouter);
  return app;
}

const app = buildApp();
const auth = { Authorization: "Bearer test-token" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush all pending microtasks / macrotasks so fire-and-forget IIFEs complete. */
async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  adminAlertEmailCalls.length = 0;
  adminNewMessageEmailCalls.length = 0;
  delete process.env.DOCUMENT_UPLOAD_ALERT_EMAIL;
  delete process.env.ADMIN_ALERT_EMAIL;
  __resetWarnDedupForTests();
  // Spy on console.warn — warnOnce() delegates here when a fire-and-forget
  // catch block fires (i.e. on unexpected errors). If the empty-recipient
  // early-return path is working correctly, this spy should never be called.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("POST /api/cases — no email recipient configured", () => {
  it("returns 200 even when DOCUMENT_UPLOAD_ALERT_EMAIL is unset and admin_alert_email DB row is absent", async () => {
    const res = await request(app)
      .post("/api/cases")
      .set(auth)
      .send({ accessCode: "TESTCODE001", status: "created" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdCase.id);
  });

  it("does not invoke sendAdminNewCaseAlert and logs no errors when the recipient list is empty", async () => {
    await request(app)
      .post("/api/cases")
      .set(auth)
      .send({ accessCode: "TESTCODE001", status: "created" });

    // Give the fire-and-forget IIFE time to run to completion.
    await flushAsync();

    expect(adminAlertEmailCalls).toHaveLength(0);
    // warnOnce() routes to console.warn only when a catch block fires.
    // No warning should be emitted on the silent-skip (empty recipients) path.
    const emailErrorWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("admin-new-case-alert"),
    );
    expect(emailErrorWarnings).toHaveLength(0);
  });

  it("returns 200 when DOCUMENT_UPLOAD_ALERT_EMAIL is explicitly set to an empty string", async () => {
    process.env.DOCUMENT_UPLOAD_ALERT_EMAIL = "";

    const res = await request(app)
      .post("/api/cases")
      .set(auth)
      .send({ accessCode: "TESTCODE001", status: "created" });

    expect(res.status).toBe(200);
  });
});

describe("POST /api/cases/:id/messages — no email recipient configured", () => {
  it("returns 200 even when DOCUMENT_UPLOAD_ALERT_EMAIL is unset and admin_alert_email DB row is absent", async () => {
    const res = await request(app)
      .post(`/api/cases/${createdCase.id}/messages`)
      .set(auth)
      .send({ sender: "user", message: "Hello from the portal." });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(storedMessage.id);
  });

  it("does not invoke sendAdminNewMessageAlert and logs no errors when the recipient list is empty", async () => {
    await request(app)
      .post(`/api/cases/${createdCase.id}/messages`)
      .set(auth)
      .send({ sender: "user", message: "Checking in on my case." });

    // Give the fire-and-forget IIFE time to run to completion.
    await flushAsync();

    expect(adminNewMessageEmailCalls).toHaveLength(0);
    // warnOnce() routes to console.warn only when a catch block fires.
    // No warning should be emitted on the silent-skip (empty recipients) path.
    const emailErrorWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("admin-new-message-alert"),
    );
    expect(emailErrorWarnings).toHaveLength(0);
  });

  it("returns 200 when DOCUMENT_UPLOAD_ALERT_EMAIL is explicitly set to an empty string", async () => {
    process.env.DOCUMENT_UPLOAD_ALERT_EMAIL = "";

    const res = await request(app)
      .post(`/api/cases/${createdCase.id}/messages`)
      .set(auth)
      .send({ sender: "user", message: "Testing empty env var." });

    expect(res.status).toBe(200);
  });

  it("response is unaffected by the email path — body matches the stored message", async () => {
    const res = await request(app)
      .post(`/api/cases/${createdCase.id}/messages`)
      .set(auth)
      .send({ sender: "user", message: "Verifying response shape." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: storedMessage.id,
      caseId: createdCase.id,
      sender: "user",
    });
  });
});
