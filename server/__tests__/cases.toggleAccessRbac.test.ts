import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---------------------------------------------------------------------------
// Verifies POST /:id/toggle-access requires at least the "admin" role — a
// viewer/agent-role admin must not be able to enable/disable a case's portal
// access via the API. Mirrors the RBAC test pattern used for the
// portal-warning mutation routes.
// ---------------------------------------------------------------------------

const TEST_ADMIN_USERNAME = "toggle-access-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

const VIEWER_USERNAME = "toggle-access-viewer";
const AGENT_USERNAME = "toggle-access-agent";

let storedCase: any = null;
let lastUpdatePayload: any = null;
const auditLogs: any[] = [];

vi.mock("../db", () => ({ db: {} }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) => {
      if (token === "viewer-token") {
        return {
          id: "session-ta-viewer",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: VIEWER_USERNAME,
        };
      }
      if (token === "agent-token") {
        return {
          id: "session-ta-agent",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: AGENT_USERNAME,
        };
      }
      return {
        id: "session-ta-1",
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
      return null;
    }),
    getCaseById: vi.fn(async () => storedCase),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    createAdminMessage: vi.fn(async () => ({})),
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
      if (username === VIEWER_USERNAME) return "viewer";
      if (username === AGENT_USERNAME) return "agent";
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
vi.mock("../services/session-store", () => ({
  deleteSessionsByCaseId: vi.fn(async () => 0),
}));
vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyUser: vi.fn(async () => {}),
  },
}));

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

const BASE_CASE = {
  id: "case-toggle-access-1",
  accessCode: "TOGGLE-ACCESS-CODE-1",
  userName: "Toggle Access Test User",
  userEmail: "toggleaccess@example.com",
  status: "active",
  isDisabled: false,
};

beforeEach(() => {
  auditLogs.length = 0;
  lastUpdatePayload = null;
  storedCase = { ...BASE_CASE };
});

describe("POST /api/cases/:id/toggle-access RBAC", () => {
  it("returns 403 for a viewer-role admin", async () => {
    const res = await request(app)
      .post("/api/cases/case-toggle-access-1/toggle-access")
      .set(viewerAuth)
      .send({ disabled: true });

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
    expect(auditLogs).toHaveLength(0);
  });

  it("returns 403 for an agent-role admin", async () => {
    const res = await request(app)
      .post("/api/cases/case-toggle-access-1/toggle-access")
      .set(agentAuth)
      .send({ disabled: true });

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
    expect(auditLogs).toHaveLength(0);
  });

  it("succeeds for an admin-role (env-var/super_admin) caller", async () => {
    const res = await request(app)
      .post("/api/cases/case-toggle-access-1/toggle-access")
      .set(auth)
      .send({ disabled: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(lastUpdatePayload).toMatchObject({ isDisabled: true });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe("disable_user_access");
  });

  it("returns 401 without an auth token", async () => {
    const res = await request(app)
      .post("/api/cases/case-toggle-access-1/toggle-access")
      .send({ disabled: true });

    expect(res.status).toBe(401);
    expect(lastUpdatePayload).toBeNull();
    expect(auditLogs).toHaveLength(0);
  });
});
