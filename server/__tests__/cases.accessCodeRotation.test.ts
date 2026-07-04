import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---------------------------------------------------------------------------
// Admin auth env — mirrors cases.reactivationPageMessage.test.ts so the
// legacy env-var path in resolveAdminRoleFromUsername gives super_admin
// without a DB lookup by default. Individual tests override req.adminRole
// via the mocked getAdminSessionByToken/role lookup where needed.
// ---------------------------------------------------------------------------

const TEST_ADMIN_USERNAME = "acr-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let storedCase: any = null;
let lastUpdatePayload: any = null;
const auditLogs: any[] = [];
let deleteSessionsCalledWith: string[] = [];
let sendAccessCodeEmailCalledWith: any[] = [];
let sendAccessCodeEmailResult: { success: boolean; error?: string } = { success: true };
let activeSessionForCase: { token: string; caseId: string; expiresAt: Date; lastActivityAt?: Date } | null = null;
function activePortalSessionByCaseId(caseId: string) {
  if (activeSessionForCase && activeSessionForCase.caseId === caseId) {
    return activeSessionForCase;
  }
  return undefined;
}

// A separate non-super-admin username used to exercise RBAC below "agent".
const VIEWER_USERNAME = "acr-viewer";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({ db: {} }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) => {
      if (token === "viewer-token") {
        return {
          id: "session-acr-viewer",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: VIEWER_USERNAME,
        };
      }
      return {
        id: "session-acr-1",
        isActive: true,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        adminUsername: TEST_ADMIN_USERNAME,
      };
    }),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getAdminUserByUsername: vi.fn(async (username: string) => {
      if (username === VIEWER_USERNAME) {
        return { username: VIEWER_USERNAME, isActive: true, role: "viewer" };
      }
      return null;
    }),
    getCaseById: vi.fn(async () => storedCase),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    getActivePortalSessionByCaseId: vi.fn(async (caseId: string) => activePortalSessionByCaseId(caseId)),
  }),
}));

// adminPermissions resolves role via db lookup for non-env-var usernames;
// mock the `db` select chain so VIEWER_USERNAME resolves to "viewer".
vi.mock("../routes/adminPermissions", async () => {
  const actual = await vi.importActual<typeof import("../routes/adminPermissions")>(
    "../routes/adminPermissions",
  );
  return {
    ...actual,
    resolveAdminRoleFromUsername: vi.fn(async (username: string) => {
      if (username === TEST_ADMIN_USERNAME) return "super_admin";
      if (username === VIEWER_USERNAME) return "viewer";
      return "viewer";
    }),
  };
});

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async (_id: string, data: any) => {
      lastUpdatePayload = data;
      storedCase = { ...(storedCase ?? {}), ...data };
      return storedCase;
    }),
    getCaseByAccessCode: vi.fn(async () => null),
    createCase: vi.fn(),
    getAllCases: vi.fn(),
    getCaseById: vi.fn(async () => storedCase),
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendAccessCodeEmail: vi.fn(async (caseRecord: any) => {
      sendAccessCodeEmailCalledWith.push(caseRecord);
      return sendAccessCodeEmailResult;
    }),
    sendAccountReactivationNotification: vi.fn(async () => true),
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
vi.mock("../services/session-store", () => ({
  deleteSessionsByCaseId: vi.fn(async (caseId: string) => {
    deleteSessionsCalledWith.push(caseId);
    return 1;
  }),
}));
vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyUser: vi.fn(async () => {}),
  },
}));

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const app = buildApp();
const auth = { Authorization: "Bearer test-token" };
const viewerAuth = { Authorization: "Bearer viewer-token" };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CASE = {
  id: "case-acr-1",
  accessCode: "ORIGINAL-CODE-1",
  userName: "ACR Test User",
  userEmail: "acr@example.com",
  status: "active",
  isDisabled: false,
};

beforeEach(() => {
  auditLogs.length = 0;
  lastUpdatePayload = null;
  deleteSessionsCalledWith = [];
  sendAccessCodeEmailCalledWith = [];
  sendAccessCodeEmailResult = { success: true };
  storedCase = { ...BASE_CASE };
  activeSessionForCase = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/cases/:id/rotate-access-code", () => {
  it("generates a new code, stores it, and revokes sessions", async () => {
    const res = await request(app)
      .post("/api/cases/case-acr-1/rotate-access-code")
      .set(auth)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.accessCode).toBe("string");
    expect(res.body.accessCode).not.toBe(BASE_CASE.accessCode);

    expect(lastUpdatePayload).toMatchObject({ accessCode: res.body.accessCode });
    expect(storedCase.accessCode).toBe(res.body.accessCode);

    expect(deleteSessionsCalledWith).toContain("case-acr-1");

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe("rotate_access_code");
  });

  it("does not touch isDisabled — rotating a locked case keeps it locked", async () => {
    storedCase = { ...BASE_CASE, isDisabled: true };

    const res = await request(app)
      .post("/api/cases/case-acr-1/rotate-access-code")
      .set(auth)
      .send();

    expect(res.status).toBe(200);
    expect(lastUpdatePayload).not.toHaveProperty("isDisabled");
    expect(storedCase.isDisabled).toBe(true);
  });

  it("returns 404 for an unknown case", async () => {
    storedCase = null;
    const res = await request(app)
      .post("/api/cases/unknown-case/rotate-access-code")
      .set(auth)
      .send();
    expect(res.status).toBe(404);
  });

  it("rejects requests below the minimum role (viewer)", async () => {
    const res = await request(app)
      .post("/api/cases/case-acr-1/rotate-access-code")
      .set(viewerAuth)
      .send();
    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
  });

  it("returns 401 without an auth token", async () => {
    const res = await request(app)
      .post("/api/cases/case-acr-1/rotate-access-code")
      .send();
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cases/:id/active-session", () => {
  it("returns hasActiveSession: false when no session exists", async () => {
    const res = await request(app)
      .get("/api/cases/case-acr-1/active-session")
      .set(auth)
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hasActiveSession: false, expiresAt: null, lastActivityAt: null });
  });

  it("returns hasActiveSession: true and lastActivityAt when the case has a live portal session", async () => {
    activeSessionForCase = {
      token: "tok-1",
      caseId: "case-acr-1",
      expiresAt: new Date(Date.now() + 60_000),
      lastActivityAt: new Date(Date.now() - 2 * 60_000),
    };

    const res = await request(app)
      .get("/api/cases/case-acr-1/active-session")
      .set(auth)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.hasActiveSession).toBe(true);
    expect(res.body.expiresAt).toBeTruthy();
    expect(res.body.lastActivityAt).toBeTruthy();
  });

  it("returns 401 without an auth token", async () => {
    const res = await request(app)
      .get("/api/cases/case-acr-1/active-session")
      .send();
    expect(res.status).toBe(401);
  });
});

describe("POST /api/cases/:id/send-access-code", () => {
  it("calls sendAccessCodeEmail with the current (not stale) access code", async () => {
    storedCase = { ...BASE_CASE, accessCode: "CURRENT-CODE-9" };

    const res = await request(app)
      .post("/api/cases/case-acr-1/send-access-code")
      .set(auth)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sendAccessCodeEmailCalledWith).toHaveLength(1);
    expect(sendAccessCodeEmailCalledWith[0]).toMatchObject({
      accessCode: "CURRENT-CODE-9",
      userEmail: "acr@example.com",
    });

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe("email_access_code");
  });

  it("returns 400 when the case has no registered email", async () => {
    storedCase = { ...BASE_CASE, userEmail: null };

    const res = await request(app)
      .post("/api/cases/case-acr-1/send-access-code")
      .set(auth)
      .send();

    expect(res.status).toBe(400);
    expect(sendAccessCodeEmailCalledWith).toHaveLength(0);
  });

  it("returns 502 and audit-logs a failure when the email service fails", async () => {
    sendAccessCodeEmailResult = { success: false, error: "SMTP down" };

    const res = await request(app)
      .post("/api/cases/case-acr-1/send-access-code")
      .set(auth)
      .send();

    expect(res.status).toBe(502);
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe("email_access_code_failed");
  });

  it("returns 404 for an unknown case", async () => {
    storedCase = null;
    const res = await request(app)
      .post("/api/cases/unknown-case/send-access-code")
      .set(auth)
      .send();
    expect(res.status).toBe(404);
  });

  it("rejects requests below the minimum role (viewer)", async () => {
    const res = await request(app)
      .post("/api/cases/case-acr-1/send-access-code")
      .set(viewerAuth)
      .send();
    expect(res.status).toBe(403);
    expect(sendAccessCodeEmailCalledWith).toHaveLength(0);
  });
});
