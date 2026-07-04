import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---------------------------------------------------------------------------
// Admin auth env — mirrors cases.accessCodeRotation.test.ts so the legacy
// env-var path in resolveAdminRoleFromUsername gives super_admin without a
// DB lookup by default. A separate viewer identity exercises the RBAC gate.
// ---------------------------------------------------------------------------

const TEST_ADMIN_USERNAME = "bsac-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

const VIEWER_USERNAME = "bsac-viewer";

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let casesById: Record<string, any> = {};
const auditLogs: any[] = [];
let sendAccessCodeEmailCalledWith: any[] = [];
let sendAccessCodeEmailResultByEmail: Record<string, { success: boolean; error?: string }> = {};

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({ db: {} }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) => {
      if (token === "viewer-token") {
        return {
          id: "session-bsac-viewer",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: VIEWER_USERNAME,
        };
      }
      return {
        id: "session-bsac-1",
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
    updateCase: vi.fn(),
    getCaseByAccessCode: vi.fn(async () => null),
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
  deleteSessionsByCaseId: vi.fn(async () => 1),
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
  sendAccessCodeEmailCalledWith = [];
  sendAccessCodeEmailResultByEmail = {};
  casesById = {
    "case-1": {
      id: "case-1",
      accessCode: "CODE-1",
      userName: "User One",
      userEmail: "one@example.com",
      status: "active",
      isDisabled: false,
    },
    "case-2": {
      id: "case-2",
      accessCode: "CODE-2",
      userName: "User Two",
      userEmail: "two@example.com",
      status: "active",
      isDisabled: false,
    },
    "case-3-no-email": {
      id: "case-3-no-email",
      accessCode: "CODE-3",
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

describe("POST /api/cases/bulk/send-access-code", () => {
  it("sends to every eligible case and reports a mixed success/failure summary", async () => {
    sendAccessCodeEmailResultByEmail["two@example.com"] = { success: false, error: "SMTP down" };

    const res = await request(app)
      .post("/api/cases/bulk/send-access-code")
      .set(auth)
      .send({ ids: ["case-1", "case-2", "case-3-no-email", "unknown-case"] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(4);
    expect(res.body.successCount).toBe(1);
    expect(res.body.failureCount).toBe(3);

    const byId = Object.fromEntries(res.body.results.map((r: any) => [r.id, r]));
    expect(byId["case-1"]).toMatchObject({ success: true, sentTo: "one@example.com" });
    expect(byId["case-2"]).toMatchObject({ success: false, error: "SMTP down" });
    expect(byId["case-3-no-email"].success).toBe(false);
    expect(byId["unknown-case"]).toMatchObject({ success: false, error: "Case not found" });

    // Only the two cases with an email on file should ever hit the email service.
    expect(sendAccessCodeEmailCalledWith).toHaveLength(2);

    // One audit log entry per attempted send (not per not-found/no-email case).
    const sendAuditLogs = auditLogs.filter((l) =>
      l.action === "email_access_code" || l.action === "email_access_code_failed",
    );
    expect(sendAuditLogs).toHaveLength(2);
  });

  it("does not swallow the literal 'bulk' path segment into :id routes", async () => {
    // Regression guard: this route is registered before
    // POST /:id/send-access-code specifically so "bulk" is never treated
    // as a case id by the single-case handler.
    const res = await request(app)
      .post("/api/cases/bulk/send-access-code")
      .set(auth)
      .send({ ids: ["case-1"] });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("sentTo");
    expect(res.body.results).toBeDefined();
  });

  it("rejects an empty ids array", async () => {
    const res = await request(app)
      .post("/api/cases/bulk/send-access-code")
      .set(auth)
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a missing ids field", async () => {
    const res = await request(app)
      .post("/api/cases/bulk/send-access-code")
      .set(auth)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects a batch larger than the cap", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `case-${i}`);
    const res = await request(app)
      .post("/api/cases/bulk/send-access-code")
      .set(auth)
      .send({ ids });
    expect(res.status).toBe(400);
    expect(sendAccessCodeEmailCalledWith).toHaveLength(0);
  });

  it("rejects requests below the minimum role (viewer)", async () => {
    const res = await request(app)
      .post("/api/cases/bulk/send-access-code")
      .set(viewerAuth)
      .send({ ids: ["case-1"] });
    expect(res.status).toBe(403);
    expect(sendAccessCodeEmailCalledWith).toHaveLength(0);
  });

  it("returns 401 without an auth token", async () => {
    const res = await request(app)
      .post("/api/cases/bulk/send-access-code")
      .send({ ids: ["case-1"] });
    expect(res.status).toBe(401);
  });
});
