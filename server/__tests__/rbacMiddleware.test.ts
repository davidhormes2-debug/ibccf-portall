/**
 * RBAC Middleware Tests — Task #1949
 *
 * Covers:
 *   1. requireAdminRole() middleware in isolation (unit tests on role hierarchy)
 *   2. Route-level integration: viewer/agent tokens are rejected by write routes,
 *      admin/super_admin tokens are accepted.
 *   3. super_admin-only routes reject admin tokens.
 *   4. Backward-compat: legacy env-var admin always resolves to super_admin.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ── env setup ────────────────────────────────────────────────────────────────
// Must happen before importing any route module so module-level const guards
// (e.g. `const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? ""`) pick up
// the test values.
const ENV_ADMIN_USERNAME = "testadmin_rbac";
const ENV_ADMIN_PASSWORD = "Str0ng!P@sswrd4Rbac#Tests";
process.env.ADMIN_USERNAME = ENV_ADMIN_USERNAME;
process.env.ADMIN_PASSWORD = ENV_ADMIN_PASSWORD;

// ── token fixtures ────────────────────────────────────────────────────────────
const SUPER_ADMIN_TOKEN = "tok-super-admin";
const ADMIN_TOKEN = "tok-admin-role";
const AGENT_TOKEN = "tok-agent-role";
const VIEWER_TOKEN = "tok-viewer-role";
const INVALID_TOKEN = "tok-invalid";

// Helper: build a fake admin_sessions row for the given token / role.
// `adminUsername` determines the role:
//   - ENV_ADMIN_USERNAME → super_admin (legacy env-var path)
//   - "db-admin-user"   → admin  (admin_users table row)
//   - "db-agent-user"   → agent
//   - "db-viewer-user"  → viewer
function makeSession(token: string, adminUsername: string) {
  return {
    id: `session-${token}`,
    adminUsername,
    token,
    isActive: true,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    lastActivityAt: new Date(),
    createdAt: new Date(),
    ipAddress: null,
    userAgent: null,
    location: null,
  };
}

const SESSIONS: Record<string, ReturnType<typeof makeSession>> = {
  [SUPER_ADMIN_TOKEN]: makeSession(SUPER_ADMIN_TOKEN, ENV_ADMIN_USERNAME),
  [ADMIN_TOKEN]: makeSession(ADMIN_TOKEN, "db-admin-user"),
  [AGENT_TOKEN]: makeSession(AGENT_TOKEN, "db-agent-user"),
  [VIEWER_TOKEN]: makeSession(VIEWER_TOKEN, "db-viewer-user"),
};

// Active sub-admin rows that checkAdminAuth will verify on every request.
// Only includes the accounts referenced by test sessions above; env-var admin
// (SUPER_ADMIN_TOKEN) bypasses this lookup so no row is needed for it.
const SUB_ADMIN_ROWS: Record<string, { username: string; isActive: boolean }> = {
  "db-admin-user": { username: "db-admin-user", isActive: true },
  "db-agent-user": { username: "db-agent-user", isActive: true },
  "db-viewer-user": { username: "db-viewer-user", isActive: true },
};

// Mock the storage module — used by middleware.ts and all route files.
vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      SESSIONS[token] ?? null,
    ),
    getAdminUserByUsername: vi.fn(async (username: string) =>
      SUB_ADMIN_ROWS[username] ?? null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    revokeAdminSession: vi.fn(async () => {}),
    createAuditLog: vi.fn(async () => ({})),
    isIpBlocked: vi.fn(async () => false),
    listBlockedIps: vi.fn(async () => []),
    getAllDocumentRequests: vi.fn(async () => []),
    getDocumentRequestById: vi.fn(async () => null),
    getAllCases: vi.fn(async () => []),
    getDepositReceiptById: vi.fn(async () => null),
    updateDepositReceipt: vi.fn(async () => null),
    updateDepositReceiptStatus: vi.fn(async () => null),
    getCaseById: vi.fn(async () => null),
    updateCase: vi.fn(async () => null),
    runInTransaction: vi.fn(async (fn: any) => fn({})),
    getAllChatTemplates: vi.fn(async () => []),
    getChatTemplatesByCategory: vi.fn(async () => []),
    createChatTemplate: vi.fn(async () => ({ id: 1, name: "t", content: "c" })),
    updateChatTemplate: vi.fn(async () => ({ id: 1, name: "t", content: "c" })),
    deleteChatTemplate: vi.fn(async () => {}),
    incrementTemplateUsage: vi.fn(async () => {}),
    getAllMessageTemplates: vi.fn(async () => []),
    getMessageTemplatesByCategory: vi.fn(async () => []),
    createMessageTemplate: vi.fn(async () => ({ id: 1, name: "t", content: "c" })),
    updateMessageTemplate: vi.fn(async () => ({ id: 1, name: "t", content: "c" })),
    deleteMessageTemplate: vi.fn(async () => {}),
    getPendingScheduledMessages: vi.fn(async () => []),
    createScheduledMessage: vi.fn(async () => ({ id: 1 })),
    cancelScheduledMessage: vi.fn(async () => ({ id: 1, status: "cancelled" })),
  }),
}));

// Mock NotificationService — imported at module level by messages.ts.
vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyAdmin: vi.fn(async () => {}),
    notifyUser: vi.fn(async () => {}),
  },
}));

// Mock EmailService — imported at module level by communications.ts and cases.ts.
import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendLocalizedCaseEmail: vi.fn(async () => ({ success: true })),
    sendAdminNewMessageAlert: vi.fn(async () => ({ success: true })),
    sendCustomEmail: vi.fn(async () => ({ success: true })),
  }),
}));

// Mocks for cases.ts dependencies (used by portal-warning routes).
vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async () => null),
    advanceStage: vi.fn(async () => null),
    getStageConfig: vi.fn(async () => null),
  },
}));

vi.mock("../services/CaseService", () => ({
  StageTransitionError: class StageTransitionError extends Error {},
}));

vi.mock("../services/refundClaimCertificate", () => ({
  buildRefundClaimCertificate: vi.fn(async () => "data:application/pdf;base64,abc"),
}));

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: vi.fn((_req: any, _res: any, next: any) => next()),
  requireUnsealed: vi.fn((_req: any, _res: any, next: any) => next()),
  requirePortalSessionOnly: vi.fn((_req: any, _res: any, next: any) => next()),
  isAuthorizedForCase: vi.fn(async () => true),
}));

vi.mock("./content", () => ({
  validateDocumentDataUrl: vi.fn(() => ({ valid: true })),
}));

vi.mock("../lib/warnOnce", () => ({
  warnOnce: vi.fn(),
  __resetWarnDedupForTests: vi.fn(),
}));

vi.mock("../services/walletConnectAlert", () => ({
  maybeAlertOnWalletConnect: vi.fn(async () => {}),
  deleteWalletConnectAlertMarkersForCase: vi.fn(async () => {}),
  walletConnectAlertFiredKey: vi.fn(() => ""),
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async () => ({ success: true })),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

vi.mock("../services/pathwayReset", () => ({
  disableAndResetPathway: vi.fn(async () => {}),
}));

// Mock the DB used by adminPermissions.ts for admin_users lookups.
// Simulate four users with different roles in the admin_users table.
vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async (limit: number) => {
            // The mock is called with a `where(eq(adminUsers.username, username))`
            // clause — but since we can't easily introspect Drizzle's internal
            // objects here, we use a side-channel approach: the test sets up
            // per-test return values via __setRoleForUsername below.
            return [];
          }),
        })),
      })),
    })),
  },
}));

// ── Custom per-test role lookup ──────────────────────────────────────────────
// Rather than trying to introspect Drizzle clause objects in the DB mock above,
// we override the high-level helper directly so tests control exactly what role
// each username resolves to.
vi.mock("../routes/adminPermissions", async (importOriginal) => {
  const original = await importOriginal<typeof import("../routes/adminPermissions")>();
  // Keep ROLE_HIERARCHY and roleAtLeast from the real module.
  const roleMap: Record<string, string> = {
    [ENV_ADMIN_USERNAME]: "super_admin",
    "db-admin-user": "admin",
    "db-agent-user": "agent",
    "db-viewer-user": "viewer",
  };
  return {
    ...original,
    resolveAdminRoleFromUsername: vi.fn(async (username: string) => {
      return roleMap[username] ?? "super_admin";
    }),
  };
});

// ── Import routes AFTER mocks are in place ──────────────────────────────────
const { requireAdminRole, ROLE_HIERARCHY, roleAtLeast } = await import(
  "../routes/adminPermissions"
);
const { checkAdminAuth } = await import("../routes/middleware");
const { blockedIpsRouter } = await import("../routes/admin");
const { documentRequestsRouter } = await import("../routes/content");
const { depositsRouter } = await import("../routes/deposits");
const { messagesRouter, registerCaseMessageRoutes, registerCaseScheduledMessageRoutes, chatTemplatesRouter, messageTemplatesRouter, scheduledMessagesRouter } = await import("../routes/messages");
const { communicationsRouter } = await import("../routes/communications");
const { casesRouter } = await import("../routes/cases");

// ── App builders ─────────────────────────────────────────────────────────────

function buildBlockedIpsApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/blocked-ips", blockedIpsRouter);
  return app;
}

function buildMessagesApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin-messages", messagesRouter);
  return app;
}

function buildCommunicationsApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/communications", communicationsRouter);
  return app;
}

function buildCaseAdminMessagesApp() {
  const app = express();
  app.use(express.json());
  const casesRouter = express.Router();
  registerCaseMessageRoutes(casesRouter);
  app.use("/api/cases", casesRouter);
  return app;
}

function buildCaseScheduledMessagesApp() {
  const app = express();
  app.use(express.json());
  const casesRouter = express.Router();
  registerCaseScheduledMessageRoutes(casesRouter);
  app.use("/api/cases", casesRouter);
  return app;
}

function buildDocumentRequestsApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/document-requests", documentRequestsRouter);
  return app;
}

function buildDepositsApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/deposits", depositsRouter);
  return app;
}

function buildChatTemplatesApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/chat-templates", chatTemplatesRouter);
  return app;
}

function buildMessageTemplatesApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/message-templates", messageTemplatesRouter);
  return app;
}

function buildScheduledMessagesApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/scheduled-messages", scheduledMessagesRouter);
  return app;
}

function buildPortalWarningApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/cases", casesRouter);
  return app;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── Unit tests: requireAdminRole middleware ───────────────────────────────────

describe("requireAdminRole() — unit", () => {
  it("ROLE_HIERARCHY is ordered lowest→highest", () => {
    expect(ROLE_HIERARCHY).toEqual(["viewer", "agent", "admin", "super_admin"]);
  });

  it("roleAtLeast: super_admin satisfies every role", () => {
    for (const role of ROLE_HIERARCHY) {
      expect(roleAtLeast("super_admin", role)).toBe(true);
    }
  });

  it("roleAtLeast: viewer only satisfies viewer", () => {
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
    expect(roleAtLeast("viewer", "agent")).toBe(false);
    expect(roleAtLeast("viewer", "admin")).toBe(false);
    expect(roleAtLeast("viewer", "super_admin")).toBe(false);
  });

  it("roleAtLeast: agent satisfies viewer and agent but not admin or super_admin", () => {
    expect(roleAtLeast("agent", "viewer")).toBe(true);
    expect(roleAtLeast("agent", "agent")).toBe(true);
    expect(roleAtLeast("agent", "admin")).toBe(false);
    expect(roleAtLeast("agent", "super_admin")).toBe(false);
  });

  it("roleAtLeast: admin satisfies all except super_admin", () => {
    expect(roleAtLeast("admin", "viewer")).toBe(true);
    expect(roleAtLeast("admin", "agent")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("admin", "super_admin")).toBe(false);
  });

  it("requireAdminRole passes when req.adminRole meets the minimum", () => {
    const req = { adminRole: "admin" } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    requireAdminRole("admin")(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("requireAdminRole rejects when req.adminRole is below minimum", () => {
    const req = { adminRole: "viewer" } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    requireAdminRole("admin")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("admin") }),
    );
  });

  it("requireAdminRole passes super_admin on a super_admin-only route", () => {
    const req = { adminRole: "super_admin" } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    requireAdminRole("super_admin")(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("requireAdminRole rejects admin on a super_admin-only route", () => {
    const req = { adminRole: "admin" } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    requireAdminRole("super_admin")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("requireAdminRole with no adminRole on request falls back to viewer", () => {
    const req = {} as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    requireAdminRole("agent")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("requireAdminRole variadic: lowest listed role wins as minimum", () => {
    // requireAdminRole('admin', 'super_admin') → min is admin
    const req = { adminRole: "admin" } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    requireAdminRole("admin", "super_admin")(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

// ── Integration: blocked IPs routes ─────────────────────────────────────────

describe("GET /api/admin/blocked-ips — requireAdminRole('viewer')", () => {
  it("returns 401 with no token", async () => {
    const res = await request(buildBlockedIpsApp()).get(
      "/api/admin/blocked-ips",
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const res = await request(buildBlockedIpsApp())
      .get("/api/admin/blocked-ips")
      .set(authHeader(INVALID_TOKEN));
    expect(res.status).toBe(401);
  });

  it("viewer can read blocked IPs list", async () => {
    const res = await request(buildBlockedIpsApp())
      .get("/api/admin/blocked-ips")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(200);
  });

  it("super_admin can read blocked IPs list", async () => {
    const res = await request(buildBlockedIpsApp())
      .get("/api/admin/blocked-ips")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/blocked-ips — requireAdminRole('super_admin')", () => {
  const validBody = { ipAddress: "1.2.3.4", reason: "test" };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildBlockedIpsApp())
      .post("/api/admin/blocked-ips")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildBlockedIpsApp())
      .post("/api/admin/blocked-ips")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 403 for admin token", async () => {
    const res = await request(buildBlockedIpsApp())
      .post("/api/admin/blocked-ips")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("super_admin token is allowed (route handler may return 500/4xx due to mocked storage — that's fine)", async () => {
    const res = await request(buildBlockedIpsApp())
      .post("/api/admin/blocked-ips")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send(validBody);
    // RBAC passes → route handler runs → mocked storage returns undefined → 500.
    // We only care that the response is NOT 401 or 403.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("DELETE /api/admin/blocked-ips/:ip — requireAdminRole('super_admin')", () => {
  it("returns 403 for admin token", async () => {
    const res = await request(buildBlockedIpsApp())
      .delete("/api/admin/blocked-ips/1.2.3.4")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildBlockedIpsApp())
      .delete("/api/admin/blocked-ips/1.2.3.4")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: document requests approve/reject ────────────────────────────

describe("POST /api/document-requests/:id/approve — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildDocumentRequestsApp())
      .post("/api/document-requests/42/approve")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildDocumentRequestsApp())
      .post("/api/document-requests/42/approve")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("admin token is allowed (handler returns 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildDocumentRequestsApp())
      .post("/api/document-requests/42/approve")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildDocumentRequestsApp())
      .post("/api/document-requests/42/approve")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("POST /api/document-requests/:id/reject — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildDocumentRequestsApp())
      .post("/api/document-requests/42/reject")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildDocumentRequestsApp())
      .post("/api/document-requests/42/reject")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildDocumentRequestsApp())
      .post("/api/document-requests/42/reject")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: deposit receipt approval ────────────────────────────────────

describe("PATCH /api/deposits/:id — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildDepositsApp())
      .patch("/api/deposits/10")
      .set(authHeader(VIEWER_TOKEN))
      .send({ status: "approved" });
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildDepositsApp())
      .patch("/api/deposits/10")
      .set(authHeader(AGENT_TOKEN))
      .send({ status: "approved" });
    expect(res.status).toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildDepositsApp())
      .patch("/api/deposits/10")
      .set(authHeader(ADMIN_TOKEN))
      .send({ status: "approved" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildDepositsApp())
      .patch("/api/deposits/10")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send({ status: "approved" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("PATCH /api/deposits/:id/status — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildDepositsApp())
      .patch("/api/deposits/10/status")
      .set(authHeader(VIEWER_TOKEN))
      .send({ status: "approved" });
    expect(res.status).toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildDepositsApp())
      .patch("/api/deposits/10/status")
      .set(authHeader(ADMIN_TOKEN))
      .send({ status: "reviewed" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: cross-case deposit receipts export (requireAdminRole('agent')) ──

describe("GET /api/deposits/all-receipts — requireAdminRole('agent')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildDepositsApp())
      .get("/api/deposits/all-receipts")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("agent token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildDepositsApp())
      .get("/api/deposits/all-receipts")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildDepositsApp())
      .get("/api/deposits/all-receipts")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildDepositsApp())
      .get("/api/deposits/all-receipts")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: admin unread message counts (requireAdminRole('agent')) ──────

describe("GET /api/admin-messages/unread/all — requireAdminRole('agent')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildMessagesApp())
      .get("/api/admin-messages/unread/all")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("agent token is allowed", async () => {
    const res = await request(buildMessagesApp())
      .get("/api/admin-messages/unread/all")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildMessagesApp())
      .get("/api/admin-messages/unread/all")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildMessagesApp())
      .get("/api/admin-messages/unread/all")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: admin message patch (requireAdminRole('agent')) ──────────────

describe("PATCH /api/admin-messages/:id — requireAdminRole('agent')", () => {
  const validBody = { title: "Updated title", body: "Updated body" };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildMessagesApp())
      .patch("/api/admin-messages/1")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("agent token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildMessagesApp())
      .patch("/api/admin-messages/1")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildMessagesApp())
      .patch("/api/admin-messages/1")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildMessagesApp())
      .patch("/api/admin-messages/1")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: admin message delete (requireAdminRole('admin')) ─────────────

describe("DELETE /api/admin-messages/:id — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildMessagesApp())
      .delete("/api/admin-messages/1")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildMessagesApp())
      .delete("/api/admin-messages/1")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildMessagesApp())
      .delete("/api/admin-messages/1")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildMessagesApp())
      .delete("/api/admin-messages/1")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: announcement create (requireAdminRole('admin')) ──────────────

describe("POST /api/admin/communications/announcements — requireAdminRole('admin')", () => {
  const validBody = { title: "Test", message: "Hello", type: "info", active: true };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/announcements")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/announcements")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/announcements")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/announcements")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: announcement edit (requireAdminRole('admin')) ────────────────

describe("PATCH /api/admin/communications/announcements/:id — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildCommunicationsApp())
      .patch("/api/admin/communications/announcements/uuid-123")
      .set(authHeader(VIEWER_TOKEN))
      .send({ title: "New title" });
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildCommunicationsApp())
      .patch("/api/admin/communications/announcements/uuid-123")
      .set(authHeader(AGENT_TOKEN))
      .send({ title: "New title" });
    expect(res.status).toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCommunicationsApp())
      .patch("/api/admin/communications/announcements/uuid-123")
      .set(authHeader(ADMIN_TOKEN))
      .send({ title: "New title" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildCommunicationsApp())
      .patch("/api/admin/communications/announcements/uuid-123")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send({ title: "New title" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: announcement delete (requireAdminRole('admin')) ──────────────

describe("DELETE /api/admin/communications/announcements/:id — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildCommunicationsApp())
      .delete("/api/admin/communications/announcements/uuid-123")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildCommunicationsApp())
      .delete("/api/admin/communications/announcements/uuid-123")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCommunicationsApp())
      .delete("/api/admin/communications/announcements/uuid-123")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildCommunicationsApp())
      .delete("/api/admin/communications/announcements/uuid-123")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: email-user send (requireAdminRole('admin')) ─────────────────

describe("POST /api/admin/communications/email-user — requireAdminRole('admin')", () => {
  const validBody = { to: "user@example.com", subject: "Hello", body: "Test body" };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/email-user")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/email-user")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/email-user")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/email-user")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: email-bulk send (requireAdminRole('admin')) ──────────────────

describe("POST /api/admin/communications/email-bulk — requireAdminRole('admin')", () => {
  const validBody = { subject: "Broadcast", body: "Hello everyone", confirmBroadcast: true };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/email-bulk")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/email-bulk")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/email-bulk")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildCommunicationsApp())
      .post("/api/admin/communications/email-bulk")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: recipients list (requireAdminRole('agent')) ─────────────────

describe("GET /api/admin/communications/recipients — requireAdminRole('agent')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildCommunicationsApp())
      .get("/api/admin/communications/recipients")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("agent token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCommunicationsApp())
      .get("/api/admin/communications/recipients")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCommunicationsApp())
      .get("/api/admin/communications/recipients")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildCommunicationsApp())
      .get("/api/admin/communications/recipients")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: portal warning set (requireAdminRole('admin')) ───────────────

describe("POST /api/cases/:id/portal-warning — requireAdminRole('admin')", () => {
  const validBody = { minutes: 60, portalMessage: "", emailMessage: "" };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: portal warning clear (requireAdminRole('admin')) ─────────────

describe("DELETE /api/cases/:id/portal-warning — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildPortalWarningApp())
      .delete("/api/cases/case-xyz/portal-warning")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildPortalWarningApp())
      .delete("/api/cases/case-xyz/portal-warning")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildPortalWarningApp())
      .delete("/api/cases/case-xyz/portal-warning")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildPortalWarningApp())
      .delete("/api/cases/case-xyz/portal-warning")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: portal warning override (requireAdminRole('admin')) ──────────

describe("POST /api/cases/:id/portal-warning/override — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning/override")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning/override")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning/override")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning/override")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: portal warning skip-reactivation (requireAdminRole('admin')) ─

describe("POST /api/cases/:id/portal-warning/skip-reactivation — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning/skip-reactivation")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning/skip-reactivation")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning/skip-reactivation")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildPortalWarningApp())
      .post("/api/cases/case-xyz/portal-warning/skip-reactivation")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: case admin-message compose (requireAdminRole('agent')) ────────

describe("POST /api/cases/:id/admin-messages — requireAdminRole('agent')", () => {
  const validBody = { category: "urgent", title: "Action required", body: "Please respond." };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildCaseAdminMessagesApp())
      .post("/api/cases/case-abc/admin-messages")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("agent token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCaseAdminMessagesApp())
      .post("/api/cases/case-abc/admin-messages")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildCaseAdminMessagesApp())
      .post("/api/cases/case-abc/admin-messages")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildCaseAdminMessagesApp())
      .post("/api/cases/case-abc/admin-messages")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: case scheduled-messages list (requireAdminRole('agent')) ──────

describe("GET /api/cases/:id/scheduled-messages — requireAdminRole('agent')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildCaseScheduledMessagesApp())
      .get("/api/cases/case-abc/scheduled-messages")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("agent token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCaseScheduledMessagesApp())
      .get("/api/cases/case-abc/scheduled-messages")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCaseScheduledMessagesApp())
      .get("/api/cases/case-abc/scheduled-messages")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildCaseScheduledMessagesApp())
      .get("/api/cases/case-abc/scheduled-messages")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: case messages export (requireAdminRole('agent')) ──────────────

describe("GET /api/cases/:id/messages/export — requireAdminRole('agent')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildCaseAdminMessagesApp())
      .get("/api/cases/case-abc/messages/export")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("agent token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCaseAdminMessagesApp())
      .get("/api/cases/case-abc/messages/export")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildCaseAdminMessagesApp())
      .get("/api/cases/case-abc/messages/export")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildCaseAdminMessagesApp())
      .get("/api/cases/case-abc/messages/export")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: chat template create (requireAdminRole('agent')) ──────────────

describe("POST /api/chat-templates — requireAdminRole('agent')", () => {
  const validBody = { name: "Template A", content: "Hello {{name}}" };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildChatTemplatesApp())
      .post("/api/chat-templates")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("agent token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildChatTemplatesApp())
      .post("/api/chat-templates")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildChatTemplatesApp())
      .post("/api/chat-templates")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildChatTemplatesApp())
      .post("/api/chat-templates")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: chat template patch (requireAdminRole('agent')) ───────────────

describe("PATCH /api/chat-templates/:id — requireAdminRole('agent')", () => {
  const validBody = { name: "Updated" };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildChatTemplatesApp())
      .patch("/api/chat-templates/1")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("agent token is allowed", async () => {
    const res = await request(buildChatTemplatesApp())
      .patch("/api/chat-templates/1")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildChatTemplatesApp())
      .patch("/api/chat-templates/1")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: chat template delete (requireAdminRole('admin')) ─────────────

describe("DELETE /api/chat-templates/:id — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildChatTemplatesApp())
      .delete("/api/chat-templates/1")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildChatTemplatesApp())
      .delete("/api/chat-templates/1")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildChatTemplatesApp())
      .delete("/api/chat-templates/1")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildChatTemplatesApp())
      .delete("/api/chat-templates/1")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: message template create (requireAdminRole('agent')) ──────────

describe("POST /api/message-templates — requireAdminRole('agent')", () => {
  const validBody = { name: "Msg Template", content: "Body text" };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildMessageTemplatesApp())
      .post("/api/message-templates")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("agent token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .post("/api/message-templates")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .post("/api/message-templates")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: message template patch (requireAdminRole('agent')) ───────────

describe("PATCH /api/message-templates/:id — requireAdminRole('agent')", () => {
  const validBody = { name: "Updated" };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildMessageTemplatesApp())
      .patch("/api/message-templates/1")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("agent token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .patch("/api/message-templates/1")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .patch("/api/message-templates/1")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: message template delete (requireAdminRole('admin')) ──────────

describe("DELETE /api/message-templates/:id — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildMessageTemplatesApp())
      .delete("/api/message-templates/1")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildMessageTemplatesApp())
      .delete("/api/message-templates/1")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .delete("/api/message-templates/1")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .delete("/api/message-templates/1")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: scheduled message create (requireAdminRole('agent')) ─────────

describe("POST /api/scheduled-messages — requireAdminRole('agent')", () => {
  const validBody = {
    messageType: "chat",
    content: "Reminder text",
    scheduledFor: new Date(Date.now() + 60_000).toISOString(),
  };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildScheduledMessagesApp())
      .post("/api/scheduled-messages")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("agent token is allowed", async () => {
    const res = await request(buildScheduledMessagesApp())
      .post("/api/scheduled-messages")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildScheduledMessagesApp())
      .post("/api/scheduled-messages")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: scheduled message cancel (requireAdminRole('admin')) ─────────

describe("POST /api/scheduled-messages/:id/cancel — requireAdminRole('admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildScheduledMessagesApp())
      .post("/api/scheduled-messages/1/cancel")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildScheduledMessagesApp())
      .post("/api/scheduled-messages/1/cancel")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildScheduledMessagesApp())
      .post("/api/scheduled-messages/1/cancel")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildScheduledMessagesApp())
      .post("/api/scheduled-messages/1/cancel")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: chat template list GET (requireAdminRole('agent')) ────────────

describe("GET /api/chat-templates — requireAdminRole('agent')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildChatTemplatesApp())
      .get("/api/chat-templates")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("agent token is allowed (handler may 4xx/5xx due to mock — not 403)", async () => {
    const res = await request(buildChatTemplatesApp())
      .get("/api/chat-templates")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildChatTemplatesApp())
      .get("/api/chat-templates")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildChatTemplatesApp())
      .get("/api/chat-templates")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: chat template category GET (requireAdminRole('agent')) ────────

describe("GET /api/chat-templates/category/:category — requireAdminRole('agent')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildChatTemplatesApp())
      .get("/api/chat-templates/category/support")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("agent token is allowed", async () => {
    const res = await request(buildChatTemplatesApp())
      .get("/api/chat-templates/category/support")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildChatTemplatesApp())
      .get("/api/chat-templates/category/support")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildChatTemplatesApp())
      .get("/api/chat-templates/category/support")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: message template list GET (requireAdminRole('agent')) ─────────

describe("GET /api/message-templates — requireAdminRole('agent')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildMessageTemplatesApp())
      .get("/api/message-templates")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("agent token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .get("/api/message-templates")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .get("/api/message-templates")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .get("/api/message-templates")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: message template category GET (requireAdminRole('agent')) ─────

describe("GET /api/message-templates/category/:category — requireAdminRole('agent')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildMessageTemplatesApp())
      .get("/api/message-templates/category/onboarding")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("agent token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .get("/api/message-templates/category/onboarding")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .get("/api/message-templates/category/onboarding")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildMessageTemplatesApp())
      .get("/api/message-templates/category/onboarding")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── Integration: scheduled messages pending GET (requireAdminRole('agent')) ────

describe("GET /api/scheduled-messages/pending — requireAdminRole('agent')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildScheduledMessagesApp())
      .get("/api/scheduled-messages/pending")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("agent token is allowed", async () => {
    const res = await request(buildScheduledMessagesApp())
      .get("/api/scheduled-messages/pending")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("admin token is allowed", async () => {
    const res = await request(buildScheduledMessagesApp())
      .get("/api/scheduled-messages/pending")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super_admin token is allowed", async () => {
    const res = await request(buildScheduledMessagesApp())
      .get("/api/scheduled-messages/pending")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
