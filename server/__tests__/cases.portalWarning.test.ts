import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---- Admin auth env setup --------------------------------------------------

const TEST_ADMIN_USERNAME = "portal-warning-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---- Mocks -----------------------------------------------------------------
//
// Isolate the cases router from all external services so tests run without a
// real DB, SMTP server, or OpenAI key.

const auditLogs: any[] = [];
let storedCase: any = null;
let lastUpdatePayload: any = null;

// Non-super-admin usernames used to exercise the requireAdminRole("admin")
// guard on the portal-warning mutation routes.
const VIEWER_USERNAME = "portal-warning-viewer";
const AGENT_USERNAME = "portal-warning-agent";

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) => {
      if (token === "viewer-token") {
        return {
          id: "session-pw-viewer",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: VIEWER_USERNAME,
        };
      }
      if (token === "agent-token") {
        return {
          id: "session-pw-agent",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: AGENT_USERNAME,
        };
      }
      return {
        id: "session-pw-1",
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
    revokeAdminSession: vi.fn(async () => {}),
    getCaseById: vi.fn(async () => storedCase),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
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
    createCase: vi.fn(),
    getAllCases: vi.fn(),
    getCaseByAccessCode: vi.fn(),
    getCaseById: vi.fn(async () => storedCase),
  },
}));

// Email and locale helpers — best-effort fire-and-forget; captured for assertions.
const sentEmails: any[] = [];
import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendPortalWarning: vi.fn(async () => ({ success: true })),
  }),
}));
vi.mock("../services/emailNotify", () => ({
  resolveRecipientLocale: vi.fn(async () => "en"),
  sendCaseEmailWithAudit: vi.fn(async (params: any) => {
    sentEmails.push(params);
    return { sent: true };
  }),
}));

// Mock portal-auth so requirePortalAccess (used by the /expired endpoint) passes
// through whenever the x-portal-session-token header is present. Other portal-auth
// exports used by casesRouter are stubbed as passthrough so they do not throw if
// called by unrelated routes during module load.
vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: vi.fn(async (req: any, res: any, next: () => void) => {
    if (!req.headers["x-portal-session-token"]) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }),
  requireUnsealed: vi.fn((_req: any, _res: any, next: () => void) => next()),
  requirePortalSessionOnly: vi.fn((_req: any, _res: any, next: () => void) => next()),
  isAuthorizedForCase: vi.fn(async () => true),
}));

// Mock pathwayReset so disableAndResetPathway (called via dynamic import inside
// the route) doesn't hit the real DB. The mock simulates the writes that the
// real function performs so lastUpdatePayload and auditLogs stay consistent with
// the existing test assertions.
const DISABLE_AUDIT_ACTION: Record<string, string> = {
  override: "override_countdown",
  skip: "skip_to_reactivation",
  expired: "portal_warning_expired",
};
const DISABLE_AUDIT_MESSAGE: Record<string, string> = {
  override: "Admin overrode countdown — account disabled and user force-logged out",
  skip: "Admin skipped directly to reactivation — account disabled and user force-logged out",
  expired: "Portal closure countdown expired — account disabled automatically",
};
vi.mock("../services/pathwayReset", () => ({
  disableAndResetPathway: vi.fn(async (caseId: string, reason: string, adminUsername: string) => {
    const now = new Date();
    lastUpdatePayload = {
      isDisabled: true,
      forceLogoutAt: now,
      portalWarningAt: null,
      portalWarningMinutes: null,
      portalWarningMessage: null,
    };
    auditLogs.push({
      action: DISABLE_AUDIT_ACTION[reason] ?? reason,
      adminUsername,
      targetType: "case",
      targetId: caseId,
      newValue: DISABLE_AUDIT_MESSAGE[reason] ?? `Withdrawal pathway reset — reason: ${reason}`,
    });
  }),
  resetWithdrawalPathway: vi.fn(async () => {}),
}));

// ---- App setup -------------------------------------------------------------

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

// ---- Fixtures --------------------------------------------------------------

const baseCase = {
  id: "case-pw-1",
  accessCode: "PWRN-0001",
  userName: "Warning User",
  userEmail: "warn@example.com",
  status: "active",
  letterSent: false,
  portalWarningAt: null,
  portalWarningMinutes: null,
  portalWarningMessage: null,
};

beforeEach(() => {
  auditLogs.length = 0;
  sentEmails.length = 0;
  lastUpdatePayload = null;
  storedCase = { ...baseCase };
});

// ---- POST /:id/portal-warning tests ----------------------------------------

describe("POST /api/cases/:id/portal-warning", () => {
  it("(a) returns 401 when no Authorization header is provided", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .send({ minutes: 5 });
    expect(res.status).toBe(401);
  });

  it("(b) returns 404 when the case does not exist", async () => {
    storedCase = null;
    const res = await request(app)
      .post("/api/cases/no-such-case/portal-warning")
      .set(auth)
      .send({ minutes: 5 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Case not found");
  });

  it("(c) returns 400 when minutes is below the minimum (< 1)", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .set(auth)
      .send({ minutes: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("(d) returns 400 when minutes exceeds the maximum (> 7200)", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .set(auth)
      .send({ minutes: 7201 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("(e) returns 400 when minutes is not an integer", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .set(auth)
      .send({ minutes: 2.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("(f) success: sets portalWarningAt/Minutes/Message on the case", async () => {
    const before = Date.now();
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .set(auth)
      .send({ minutes: 10, portalMessage: "Please re-authenticate." });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(lastUpdatePayload).toBeTruthy();
    expect(lastUpdatePayload.portalWarningAt).toBeInstanceOf(Date);
    expect(lastUpdatePayload.portalWarningAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(lastUpdatePayload.portalWarningMinutes).toBe(10);
    expect(lastUpdatePayload.portalWarningMessage).toBe("Please re-authenticate.");
  });

  it("(g) success: stores null message when portalMessage is empty string", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .set(auth)
      .send({ minutes: 5, portalMessage: "" });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload.portalWarningMessage).toBeNull();
  });

  it("(h) success: creates a portal_warning_sent audit log entry", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .set(auth)
      .send({ minutes: 5 });

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "portal_warning_sent");
    expect(audit).toBeTruthy();
    expect(audit.targetType).toBe("case");
    expect(audit.targetId).toBe("case-pw-1");
    expect(audit.newValue).toContain("5");
  });

  it("(i) success: works with the minimum allowed duration (1 minute)", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .set(auth)
      .send({ minutes: 1 });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload.portalWarningMinutes).toBe(1);
  });

  it("(j) success: works with the maximum allowed duration (5 days / 7200 minutes)", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .set(auth)
      .send({ minutes: 7200 });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload.portalWarningMinutes).toBe(7200);
  });

  it("(k) success: works with multi-day duration (3 days = 4320 minutes)", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .set(auth)
      .send({ minutes: 4320 });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload.portalWarningMinutes).toBe(4320);
  });

  it("(l) returns 403 for a viewer-role admin", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .set(viewerAuth)
      .send({ minutes: 5 });

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
  });

  it("(m) returns 403 for an agent-role admin", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning")
      .set(agentAuth)
      .send({ minutes: 5 });

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
  });
});

// ---- DELETE /:id/portal-warning tests --------------------------------------

describe("DELETE /api/cases/:id/portal-warning", () => {
  it("(a) returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).delete(
      "/api/cases/case-pw-1/portal-warning",
    );
    expect(res.status).toBe(401);
  });

  it("(b) returns 404 when the case does not exist", async () => {
    storedCase = null;
    const res = await request(app)
      .delete("/api/cases/no-such-case/portal-warning")
      .set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Case not found");
  });

  it("(c) success: clears portalWarningAt, portalWarningMinutes, and portalWarningMessage", async () => {
    storedCase = {
      ...baseCase,
      portalWarningAt: new Date(Date.now() + 120_000),
      portalWarningMinutes: 5,
      portalWarningMessage: "Closing soon",
    };

    const res = await request(app)
      .delete("/api/cases/case-pw-1/portal-warning")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(lastUpdatePayload.portalWarningAt).toBeNull();
    expect(lastUpdatePayload.portalWarningMinutes).toBeNull();
    expect(lastUpdatePayload.portalWarningMessage).toBeNull();
  });

  it("(d) success: creates a portal_warning_cancelled audit log entry", async () => {
    storedCase = {
      ...baseCase,
      portalWarningAt: new Date(Date.now() + 120_000),
      portalWarningMinutes: 5,
      portalWarningMessage: null,
    };

    const res = await request(app)
      .delete("/api/cases/case-pw-1/portal-warning")
      .set(auth);

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "portal_warning_cancelled");
    expect(audit).toBeTruthy();
    expect(audit.targetType).toBe("case");
    expect(audit.targetId).toBe("case-pw-1");
    expect(audit.newValue).toContain("cancelled");
  });

  it("(e) success: cancel still works even when no warning was active", async () => {
    const res = await request(app)
      .delete("/api/cases/case-pw-1/portal-warning")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(lastUpdatePayload.portalWarningAt).toBeNull();
  });

  it("(f) returns 403 for a viewer-role admin", async () => {
    const res = await request(app)
      .delete("/api/cases/case-pw-1/portal-warning")
      .set(viewerAuth);

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
  });

  it("(g) returns 403 for an agent-role admin", async () => {
    const res = await request(app)
      .delete("/api/cases/case-pw-1/portal-warning")
      .set(agentAuth);

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
  });
});

// ---- POST /:id/portal-warning/override tests --------------------------------

describe("POST /api/cases/:id/portal-warning/override", () => {
  it("(a) returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).post(
      "/api/cases/case-pw-1/portal-warning/override",
    );
    expect(res.status).toBe(401);
  });

  it("(b) returns 404 when the case does not exist", async () => {
    storedCase = null;
    const res = await request(app)
      .post("/api/cases/no-such-case/portal-warning/override")
      .set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Case not found");
  });

  it("(c) success: disables account, stamps forceLogoutAt, clears countdown", async () => {
    storedCase = {
      ...baseCase,
      portalWarningAt: new Date(Date.now() + 60_000),
      portalWarningMinutes: 5,
      portalWarningMessage: "About to close",
    };

    const before = Date.now();
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/override")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(lastUpdatePayload.isDisabled).toBe(true);
    expect(lastUpdatePayload.forceLogoutAt).toBeInstanceOf(Date);
    expect(lastUpdatePayload.forceLogoutAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(lastUpdatePayload.portalWarningAt).toBeNull();
    expect(lastUpdatePayload.portalWarningMinutes).toBeNull();
    expect(lastUpdatePayload.portalWarningMessage).toBeNull();
  });

  it("(d) success: writes an override_countdown audit log entry", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/override")
      .set(auth);

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "override_countdown");
    expect(audit).toBeTruthy();
    expect(audit.targetType).toBe("case");
    expect(audit.targetId).toBe("case-pw-1");
    expect(audit.newValue).toContain("overrode");
  });

  it("(e) success: works even when no countdown was active", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/override")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(lastUpdatePayload.isDisabled).toBe(true);
  });

  it("(f) returns 403 for a viewer-role admin", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/override")
      .set(viewerAuth);

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
  });

  it("(g) returns 403 for an agent-role admin", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/override")
      .set(agentAuth);

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
  });
});

// ---- POST /:id/portal-warning/skip-reactivation tests ----------------------

describe("POST /api/cases/:id/portal-warning/skip-reactivation", () => {
  it("(a) returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).post(
      "/api/cases/case-pw-1/portal-warning/skip-reactivation",
    );
    expect(res.status).toBe(401);
  });

  it("(b) returns 404 when the case does not exist", async () => {
    storedCase = null;
    const res = await request(app)
      .post("/api/cases/no-such-case/portal-warning/skip-reactivation")
      .set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Case not found");
  });

  it("(c) success: disables account and stamps forceLogoutAt without requiring countdown", async () => {
    const before = Date.now();
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/skip-reactivation")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(lastUpdatePayload.isDisabled).toBe(true);
    expect(lastUpdatePayload.forceLogoutAt).toBeInstanceOf(Date);
    expect(lastUpdatePayload.forceLogoutAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(lastUpdatePayload.portalWarningAt).toBeNull();
  });

  it("(d) success: writes a skip_to_reactivation audit log entry", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/skip-reactivation")
      .set(auth);

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "skip_to_reactivation");
    expect(audit).toBeTruthy();
    expect(audit.targetType).toBe("case");
    expect(audit.targetId).toBe("case-pw-1");
    expect(audit.newValue).toContain("skipped");
  });

  it("(e) returns 403 for a viewer-role admin", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/skip-reactivation")
      .set(viewerAuth);

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
  });

  it("(f) returns 403 for an agent-role admin", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/skip-reactivation")
      .set(agentAuth);

    expect(res.status).toBe(403);
    expect(lastUpdatePayload).toBeNull();
  });
});

// ---- POST /:id/portal-warning/expired tests --------------------------------

const portalAuth = { "x-portal-session-token": "valid-portal-token" };

describe("POST /api/cases/:id/portal-warning/expired", () => {
  it("(a) returns 401 when no portal session token is provided", async () => {
    storedCase = {
      ...baseCase,
      portalWarningAt: new Date(Date.now() - 120_000),
      portalWarningMinutes: 1,
    };
    const res = await request(app).post(
      "/api/cases/case-pw-1/portal-warning/expired",
    );
    expect(res.status).toBe(401);
  });

  it("(b) returns 404 when the case does not exist", async () => {
    storedCase = null;
    const res = await request(app)
      .post("/api/cases/no-such-case/portal-warning/expired")
      .set(portalAuth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Case not found");
  });

  it("(c) returns 400 when there is no active portal warning", async () => {
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/expired")
      .set(portalAuth);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No active portal warning for this case");
  });

  it("(d) returns 400 when the countdown has not yet expired", async () => {
    storedCase = {
      ...baseCase,
      portalWarningAt: new Date(Date.now() - 60_000),
      portalWarningMinutes: 60,
    };
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/expired")
      .set(portalAuth);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Portal warning has not yet expired");
  });

  it("(e) returns success with alreadyDisabled when the case is already disabled", async () => {
    storedCase = { ...baseCase, isDisabled: true };
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/expired")
      .set(portalAuth);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.alreadyDisabled).toBe(true);
  });

  it("(f) success: sets isDisabled=true and stamps forceLogoutAt", async () => {
    storedCase = {
      ...baseCase,
      portalWarningAt: new Date(Date.now() - 120_000),
      portalWarningMinutes: 1,
    };
    const before = Date.now();
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/expired")
      .set(portalAuth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(lastUpdatePayload).toBeTruthy();
    expect(lastUpdatePayload.isDisabled).toBe(true);
    expect(lastUpdatePayload.forceLogoutAt).toBeInstanceOf(Date);
    expect(lastUpdatePayload.forceLogoutAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("(g) success: writes a portal_warning_expired audit log entry", async () => {
    storedCase = {
      ...baseCase,
      portalWarningAt: new Date(Date.now() - 120_000),
      portalWarningMinutes: 1,
    };
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/expired")
      .set(portalAuth);

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "portal_warning_expired");
    expect(audit).toBeTruthy();
    expect(audit.targetType).toBe("case");
    expect(audit.targetId).toBe("case-pw-1");
    expect(audit.newValue).toContain("expired");
  });

  it("(h) success: clears all portal warning fields (at/minutes/message set to null)", async () => {
    storedCase = {
      ...baseCase,
      portalWarningAt: new Date(Date.now() - 120_000),
      portalWarningMinutes: 1,
      portalWarningMessage: "Closing soon",
    };
    const res = await request(app)
      .post("/api/cases/case-pw-1/portal-warning/expired")
      .set(portalAuth);

    expect(res.status).toBe(200);
    expect(lastUpdatePayload.portalWarningAt).toBeNull();
    expect(lastUpdatePayload.portalWarningMinutes).toBeNull();
    expect(lastUpdatePayload.portalWarningMessage).toBeNull();
  });
});
