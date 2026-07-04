import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---------------------------------------------------------------------------
// Admin auth env — mirror the pattern in cases.portalWarning.test.ts so the
// legacy env-var path in resolveAdminRoleFromUsername gives super_admin
// without a DB lookup.
// ---------------------------------------------------------------------------

const TEST_ADMIN_USERNAME = "rpm-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---------------------------------------------------------------------------
// Test state — shared across PATCH and GET handlers so the round-trip
// can be verified without a real database.
// ---------------------------------------------------------------------------

let storedCase: any = null;
let lastUpdatePayload: any = null;
const auditLogs: any[] = [];

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({ db: {} }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // Admin session validation (checkAdminAuth).
    getAdminSessionByToken: vi.fn(async (_token: string) => ({
      id: "session-rpm-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),

    // getCaseById is used by PATCH /:id to read the current case before updating.
    getCaseById: vi.fn(async () => storedCase),

    // Audit log writes.
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),

    // runInTransaction used by some sub-paths of PATCH /:id.
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),

    // Rate limiter for GET reactivation-info (checkPinRateLimit / recordPinAttempt).
    // Returning null from getAdminLoginAttemptByKey makes checkPinRateLimit allow
    // the request without hitting any lockout branch.
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
    // updateCase: called by PATCH /:id — persist the data into storedCase so
    // the subsequent GET reactivation-info sees the updated field.
    updateCase: vi.fn(async (_id: string, data: any) => {
      lastUpdatePayload = data;
      storedCase = { ...(storedCase ?? {}), ...data };
      return storedCase;
    }),

    // getCaseByAccessCode: called by GET reactivation-info — returns storedCase
    // which has been mutated by the preceding PATCH call.
    getCaseByAccessCode: vi.fn(async () => storedCase),

    // Stubs for other caseService methods the router may import.
    createCase: vi.fn(),
    getAllCases: vi.fn(),
    getCaseById: vi.fn(async () => storedCase),
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendPortalWarning: vi.fn(async () => ({ success: true })),
    sendCaseEmail: vi.fn(async () => ({ success: true })),
    sendAccountReactivationNotification: vi.fn(async () => ({ success: true })),
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
  deleteSessionsByCaseId: vi.fn(async () => {}),
}));
vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyUser: vi.fn(async () => {}),
  },
}));

// ---------------------------------------------------------------------------
// App setup — real casesRouter, identical to cases.portalWarning.test.ts
// ---------------------------------------------------------------------------

const { casesRouter } = await import("../routes/cases");
const { caseService } = await import("../services");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const app = buildApp();
const auth = { Authorization: "Bearer test-token" };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CASE = {
  id: "case-rpm-1",
  accessCode: "RPM-0001",
  userName: "RPM Test User",
  userEmail: "rpm@example.com",
  status: "active",
  letterSent: false,
  isDisabled: true,                  // required for GET reactivation-info to return 200
  depositAddress: "TXtest1234",
  depositAsset: "USDT",
  depositNetwork: "TRC20",
  activityDepositAmount: "500",
  portalWarningMessage: "General warning",
  reactivationPageMessage: null,
};

beforeEach(() => {
  auditLogs.length = 0;
  lastUpdatePayload = null;
  storedCase = { ...BASE_CASE };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PATCH /api/cases/:id — reactivationPageMessage persistence", () => {
  it("(a) PATCH with reactivationPageMessage calls updateCase with the correct value", async () => {
    const res = await request(app)
      .patch("/api/cases/case-rpm-1")
      .set(auth)
      .send({ reactivationPageMessage: "Please submit your deposit to restore access." });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload).toMatchObject({
      reactivationPageMessage: "Please submit your deposit to restore access.",
    });
  });

  it("(b) PATCH with reactivationPageMessage=empty-string clears the field (sends null)", async () => {
    const res = await request(app)
      .patch("/api/cases/case-rpm-1")
      .set(auth)
      .send({ reactivationPageMessage: "" });

    expect(res.status).toBe(200);
    // updateCaseSchema trims and nullifies empty strings for nullable text fields.
    const stored = lastUpdatePayload?.reactivationPageMessage ?? null;
    expect(stored === null || stored === "").toBe(true);
  });

  it("(c) PATCH without a token returns 401", async () => {
    const res = await request(app)
      .patch("/api/cases/case-rpm-1")
      .send({ reactivationPageMessage: "Should be rejected" });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/cases/access/:code/reactivation-info — reactivationPageMessage round-trip", () => {
  it("(d) GET returns reactivationPageMessage that was persisted by a preceding PATCH", async () => {
    // Step 1: admin sets the message via PATCH.
    const patchRes = await request(app)
      .patch("/api/cases/case-rpm-1")
      .set(auth)
      .send({ reactivationPageMessage: "Compliance hold — submit deposit." });

    expect(patchRes.status).toBe(200);

    // Step 2: the reactivation-info GET now sees the updated case (storedCase
    // was mutated by the updateCase mock above, and getCaseByAccessCode returns
    // storedCase, so the round-trip is closed).
    const getRes = await request(app)
      .get("/api/cases/access/RPM-0001/reactivation-info");

    expect(getRes.status).toBe(200);
    expect(getRes.body.reactivationPageMessage).toBe(
      "Compliance hold — submit deposit.",
    );
  });

  it("(e) GET returns null for reactivationPageMessage after it is cleared by PATCH", async () => {
    // Start with a message set.
    storedCase = { ...BASE_CASE, reactivationPageMessage: "Old message" };

    // Step 1: admin clears the message via PATCH (empty string → null).
    await request(app)
      .patch("/api/cases/case-rpm-1")
      .set(auth)
      .send({ reactivationPageMessage: "" });

    // Step 2: GET reactivation-info should reflect the cleared state.
    const getRes = await request(app)
      .get("/api/cases/access/RPM-0001/reactivation-info");

    expect(getRes.status).toBe(200);
    expect(getRes.body.reactivationPageMessage === null || getRes.body.reactivationPageMessage === "").toBe(true);
  });

  it("(f) GET reactivation-info includes both reactivationPageMessage and portalWarningMessage independently", async () => {
    storedCase = {
      ...BASE_CASE,
      reactivationPageMessage: "Admin custom notice",
      portalWarningMessage: "General portal warning",
    };

    const res = await request(app)
      .get("/api/cases/access/RPM-0001/reactivation-info");

    expect(res.status).toBe(200);
    expect(res.body.reactivationPageMessage).toBe("Admin custom notice");
    expect(res.body.portalWarningMessage).toBe("General portal warning");
  });

  it("(g) GET reactivation-info returns 410 for an enabled (non-disabled) case", async () => {
    storedCase = { ...BASE_CASE, isDisabled: false };

    const res = await request(app)
      .get("/api/cases/access/RPM-0001/reactivation-info");

    expect(res.status).toBe(410);
  });

  it("(h) GET reactivation-info returns 404 when the access code is not found", async () => {
    storedCase = null;

    const res = await request(app)
      .get("/api/cases/access/UNKNOWN/reactivation-info");

    expect(res.status).toBe(404);
  });
});

describe("POST /api/cases/:id/toggle-access — reactivationPageMessage cleared on re-enable", () => {
  it("(i) re-enabling a case nulls out reactivationPageMessage", async () => {
    // Start with a disabled case that has a non-null reactivationPageMessage.
    storedCase = {
      ...BASE_CASE,
      isDisabled: true,
      reactivationPageMessage: "Pending deposit required to restore access.",
    };

    // The toggle-access handler calls getCaseByAccessCode to check for
    // access-code collisions when generating a new code on reactivation.
    // Returning null means no collision, so the first candidate is accepted.
    vi.mocked(caseService.getCaseByAccessCode).mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/api/cases/case-rpm-1/toggle-access")
      .set(auth)
      .send({ disabled: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // The updateCase call must have included reactivationPageMessage: null
    // so the stale copy does not resurface on the next suspension cycle.
    expect(lastUpdatePayload).toMatchObject({ reactivationPageMessage: null });
  });
});
