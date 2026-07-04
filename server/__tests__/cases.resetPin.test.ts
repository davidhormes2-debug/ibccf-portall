import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---------------------------------------------------------------------------
// Admin auth env — mirrors cases.accessCodeRotation.test.ts so the legacy
// env-var path in resolveAdminRoleFromUsername gives super_admin without a
// DB lookup by default.
// ---------------------------------------------------------------------------

const TEST_ADMIN_USERNAME = "reset-pin-test-admin";
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
let runInTransactionShouldThrow = false;

// Non-super-admin usernames used to exercise the requireAdminRole("admin")
// guard on this route.
const VIEWER_USERNAME = "reset-pin-viewer";
const AGENT_USERNAME = "reset-pin-agent";
const ADMIN_USERNAME = "reset-pin-admin";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({ db: {} }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) => {
      if (token === "viewer-token") {
        return {
          id: "session-reset-pin-viewer",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: VIEWER_USERNAME,
        };
      }
      if (token === "agent-token") {
        return {
          id: "session-reset-pin-agent",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: AGENT_USERNAME,
        };
      }
      if (token === "admin-token") {
        return {
          id: "session-reset-pin-admin",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: ADMIN_USERNAME,
        };
      }
      return {
        id: "session-reset-pin-1",
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
      if (username === AGENT_USERNAME) {
        return { username: AGENT_USERNAME, isActive: true, role: "agent" };
      }
      if (username === ADMIN_USERNAME) {
        return { username: ADMIN_USERNAME, isActive: true, role: "admin" };
      }
      return null;
    }),
    getCaseById: vi.fn(async () => storedCase),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (runInTransactionShouldThrow) {
        throw new Error("transaction failed");
      }
      return fn({});
    }),
  }),
}));

// adminPermissions resolves role via a DB lookup for non-env-var usernames;
// mock it directly so VIEWER_USERNAME/AGENT_USERNAME resolve deterministically
// without touching the real `db` module.
vi.mock("../routes/adminPermissions", async () => {
  const actual = await vi.importActual<typeof import("../routes/adminPermissions")>(
    "../routes/adminPermissions",
  );
  return {
    ...actual,
    resolveAdminRoleFromUsername: vi.fn(async (username: string) => {
      if (username === VIEWER_USERNAME) return "viewer";
      if (username === AGENT_USERNAME) return "agent";
      if (username === ADMIN_USERNAME) return "admin";
      return "super_admin";
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
  emailService: createEmailServiceMock({}),
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
const agentAuth = { Authorization: "Bearer agent-token" };
const adminAuth = { Authorization: "Bearer admin-token" };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CASE = {
  id: "case-reset-pin-1",
  accessCode: "RESET-PIN-CODE-1",
  userName: "Reset Pin Test User",
  userEmail: "resetpin@example.com",
  status: "active",
  userPin: "1234",
  isDisabled: false,
};

beforeEach(() => {
  auditLogs.length = 0;
  lastUpdatePayload = null;
  deleteSessionsCalledWith = [];
  runInTransactionShouldThrow = false;
  storedCase = { ...BASE_CASE };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/cases/:id/reset-pin", () => {
  it("clears the PIN, invalidates portal sessions, and writes an audit log", async () => {
    const res = await request(app)
      .post("/api/cases/case-reset-pin-1/reset-pin")
      .set(auth)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(lastUpdatePayload).toMatchObject({ userPin: null });
    expect(storedCase.userPin).toBeNull();

    expect(deleteSessionsCalledWith).toContain("case-reset-pin-1");

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe("reset_user_pin");
    expect(auditLogs[0].targetId).toBe("case-reset-pin-1");
    expect(auditLogs[0].newValue).toContain(BASE_CASE.userName);
  });

  it("returns 404 for an unknown case and makes no changes", async () => {
    storedCase = null;

    const res = await request(app)
      .post("/api/cases/unknown-case/reset-pin")
      .set(auth)
      .send();

    expect(res.status).toBe(404);
    expect(lastUpdatePayload).toBeNull();
    expect(auditLogs).toHaveLength(0);
    expect(deleteSessionsCalledWith).toHaveLength(0);
  });

  it("returns 401 without an auth token", async () => {
    const res = await request(app)
      .post("/api/cases/case-reset-pin-1/reset-pin")
      .send();

    expect(res.status).toBe(401);
    expect(lastUpdatePayload).toBeNull();
    expect(auditLogs).toHaveLength(0);
  });

  it("returns 500 and writes no audit log when the PIN-clear transaction fails", async () => {
    runInTransactionShouldThrow = true;

    const res = await request(app)
      .post("/api/cases/case-reset-pin-1/reset-pin")
      .set(auth)
      .send();

    expect(res.status).toBe(500);
    expect(auditLogs).toHaveLength(0);
    expect(storedCase.userPin).toBe(BASE_CASE.userPin);
    expect(deleteSessionsCalledWith).toHaveLength(0);
  });

  it("returns 403 for a viewer-role admin and makes no changes", async () => {
    const res = await request(app)
      .post("/api/cases/case-reset-pin-1/reset-pin")
      .set(viewerAuth)
      .send();

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
    expect(storedCase.userPin).toBe(BASE_CASE.userPin);
    expect(auditLogs).toHaveLength(0);
    expect(deleteSessionsCalledWith).toHaveLength(0);
  });

  it("returns 403 for an agent-role admin and makes no changes", async () => {
    const res = await request(app)
      .post("/api/cases/case-reset-pin-1/reset-pin")
      .set(agentAuth)
      .send();

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
    expect(storedCase.userPin).toBe(BASE_CASE.userPin);
    expect(auditLogs).toHaveLength(0);
    expect(deleteSessionsCalledWith).toHaveLength(0);
  });

  it("succeeds for a super_admin-role admin", async () => {
    const res = await request(app)
      .post("/api/cases/case-reset-pin-1/reset-pin")
      .set(auth)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storedCase.userPin).toBeNull();
  });

  it("succeeds for an admin-role admin", async () => {
    const res = await request(app)
      .post("/api/cases/case-reset-pin-1/reset-pin")
      .set(adminAuth)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storedCase.userPin).toBeNull();
  });
});
