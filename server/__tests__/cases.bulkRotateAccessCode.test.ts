import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---------------------------------------------------------------------------
// Admin auth env — mirrors cases.bulkSendAccessCode.test.ts so the legacy
// env-var path in resolveAdminRoleFromUsername gives super_admin without a
// DB lookup by default. A separate viewer identity exercises the RBAC gate.
// ---------------------------------------------------------------------------

const TEST_ADMIN_USERNAME = "brac-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

const VIEWER_USERNAME = "brac-viewer";

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let casesById: Record<string, any> = {};
const auditLogs: any[] = [];
let updateCaseCalls: Array<{ id: string; data: any }> = [];
let deleteSessionsCalledWith: string[] = [];
let sendAccessCodeEmailCalledWith: any[] = [];
let sendAccessCodeEmailResultByEmail: Record<string, { success: boolean; error?: string }> = {};
let accessCodeCollisionOnce = false;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({ db: {} }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) => {
      if (token === "viewer-token") {
        return {
          id: "session-brac-viewer",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: VIEWER_USERNAME,
        };
      }
      return {
        id: "session-brac-1",
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
    getCaseById: vi.fn(async (id: string) => casesById[id] ?? null),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  }),
}));

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
    updateCase: vi.fn(async (id: string, data: any) => {
      updateCaseCalls.push({ id, data });
      casesById[id] = { ...(casesById[id] ?? {}), ...data };
      return casesById[id];
    }),
    getCaseByAccessCode: vi.fn(async () => {
      // One-shot collision so the retry-loop path is exercised at least once.
      if (accessCodeCollisionOnce) {
        accessCodeCollisionOnce = false;
        return { id: "some-other-case" };
      }
      return null;
    }),
    createCase: vi.fn(),
    getAllCases: vi.fn(),
    getCaseById: vi.fn(async (id: string) => casesById[id] ?? null),
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendAccessCodeEmail: vi.fn(async (caseRecord: any) => {
      sendAccessCodeEmailCalledWith.push(caseRecord);
      return (
        sendAccessCodeEmailResultByEmail[caseRecord.userEmail] ?? { success: true }
      );
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

beforeEach(() => {
  auditLogs.length = 0;
  updateCaseCalls = [];
  deleteSessionsCalledWith = [];
  sendAccessCodeEmailCalledWith = [];
  sendAccessCodeEmailResultByEmail = {};
  accessCodeCollisionOnce = false;
  casesById = {
    "case-1": {
      id: "case-1",
      accessCode: "LEGACY-CODE-1",
      userName: "User One",
      userEmail: "one@example.com",
      status: "active",
      isDisabled: false,
    },
    "case-2": {
      id: "case-2",
      accessCode: "LEGACY-CODE-2",
      userName: "User Two",
      userEmail: "two@example.com",
      status: "active",
      isDisabled: false,
    },
    "case-3-no-email": {
      id: "case-3-no-email",
      accessCode: "LEGACY-CODE-3",
      userName: "User Three",
      userEmail: null,
      status: "active",
      isDisabled: false,
    },
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/cases/bulk/rotate-access-code", () => {
  it("rotates every case, drops sessions, audit-logs, and notifies where possible", async () => {
    accessCodeCollisionOnce = true;
    sendAccessCodeEmailResultByEmail["two@example.com"] = { success: false, error: "SMTP down" };

    const res = await request(app)
      .post("/api/cases/bulk/rotate-access-code")
      .set(auth)
      .send({ ids: ["case-1", "case-2", "case-3-no-email", "unknown-case"] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(4);
    expect(res.body.successCount).toBe(3);
    expect(res.body.failureCount).toBe(1);

    const byId = Object.fromEntries(res.body.results.map((r: any) => [r.id, r]));

    // case-1: rotated + notified successfully.
    expect(byId["case-1"].success).toBe(true);
    expect(typeof byId["case-1"].newAccessCode).toBe("string");
    expect(byId["case-1"].newAccessCode).not.toBe("LEGACY-CODE-1");
    expect(byId["case-1"].notified).toBe(true);

    // case-2: rotated, but notification failed.
    expect(byId["case-2"].success).toBe(true);
    expect(byId["case-2"].notified).toBe(false);
    expect(byId["case-2"].notifyError).toBe("SMTP down");

    // case-3-no-email: rotated, no email on file so not notified.
    expect(byId["case-3-no-email"].success).toBe(true);
    expect(byId["case-3-no-email"].notified).toBe(false);
    expect(byId["case-3-no-email"].notifyError).toBe("This case has no registered email on file.");

    // unknown-case: hard failure, never attempted.
    expect(byId["unknown-case"]).toMatchObject({ success: false, error: "Case not found" });

    // Sessions dropped for every case whose rotation succeeded.
    expect(deleteSessionsCalledWith.sort()).toEqual(["case-1", "case-2", "case-3-no-email"].sort());

    // The actual stored access code was updated to the new value.
    expect(casesById["case-1"].accessCode).toBe(byId["case-1"].newAccessCode);

    // One audit log entry per rotated case (not per not-found case).
    const rotateAuditLogs = auditLogs.filter((l) => l.action === "rotate_access_code");
    expect(rotateAuditLogs).toHaveLength(3);

    // Only the two cases with an email on file should ever hit the email service.
    expect(sendAccessCodeEmailCalledWith).toHaveLength(2);
  });

  it("does not swallow the literal 'bulk' path segment into :id routes", async () => {
    // Regression guard: this route is registered before
    // POST /:id/rotate-access-code specifically so "bulk" is never treated
    // as a case id by the single-case handler.
    const res = await request(app)
      .post("/api/cases/bulk/rotate-access-code")
      .set(auth)
      .send({ ids: ["case-1"] });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("accessCode");
    expect(res.body.results).toBeDefined();
  });

  it("rejects an empty ids array", async () => {
    const res = await request(app)
      .post("/api/cases/bulk/rotate-access-code")
      .set(auth)
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a missing ids field", async () => {
    const res = await request(app)
      .post("/api/cases/bulk/rotate-access-code")
      .set(auth)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects a batch larger than the cap", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `case-${i}`);
    const res = await request(app)
      .post("/api/cases/bulk/rotate-access-code")
      .set(auth)
      .send({ ids });
    expect(res.status).toBe(400);
    expect(updateCaseCalls).toHaveLength(0);
  });

  it("rejects requests below the minimum role (viewer)", async () => {
    const res = await request(app)
      .post("/api/cases/bulk/rotate-access-code")
      .set(viewerAuth)
      .send({ ids: ["case-1"] });
    expect(res.status).toBe(403);
    expect(updateCaseCalls).toHaveLength(0);
  });

  it("returns 401 without an auth token", async () => {
    const res = await request(app)
      .post("/api/cases/bulk/rotate-access-code")
      .send({ ids: ["case-1"] });
    expect(res.status).toBe(401);
  });
});
