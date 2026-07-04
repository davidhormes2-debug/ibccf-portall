import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Refund Claim Route Tests
//
// Covers the happy-path (and key sad-path) behaviours of:
//   POST   /:id/refund-claim/request   — admin activates the flow
//   GET    /:id/refund-claim           — admin or portal fetches claim data
//   PATCH  /:id/refund-claim           — portal submits/updates claim entries
//
// The three storage methods introduced for refund claims are:
//   createRefundClaim      (called by POST /request)
//   getRefundClaimByCase   (called by GET, PATCH, approve, reject, cert)
//   updateRefundClaim      (called by PATCH, approve, reject)
//
// Every dependency the router touches is mocked so the suite stays hermetic.
// ============================================================================

const TEST_ADMIN_USERNAME = "refund-claim-test-admin";
let savedAdminUsername: string | undefined;

beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});

afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ── Shared test-state ────────────────────────────────────────────────────────

const auditLogs: any[] = [];
let caseRow: any = null;
let claimRow: any = null;
let nextClaimId = 1;
let lastCasePatch: any = null;
let lastClaimPatch: any = null;

const sendRefundClaimRequest = vi.fn(async () => {});
const sendRefundClaimApproved = vi.fn(async () => {});
const sendRefundClaimRejected = vi.fn(async () => {});

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // Admin session auth
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-refund-claim-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),

    // Case lookup
    getCaseById: vi.fn(async () => caseRow),
    updateCase: vi.fn(async (_id: string, patch: any) => {
      lastCasePatch = patch;
      caseRow = { ...(caseRow ?? {}), ...patch };
      return caseRow;
    }),

    // Refund claim storage methods — explicit stubs so their call counts
    // can be asserted and so any unexpected invocation is noisy.
    createRefundClaim: vi.fn(async (data: any) => {
      claimRow = {
        id: nextClaimId++,
        caseId: data.caseId,
        documentaryRecommendations: data.documentaryRecommendations ?? null,
        requestedBy: data.requestedBy ?? null,
        status: "pending_submission",
        entries: null,
        adminNotes: null,
        submittedAt: null,
        reviewedAt: null,
        reviewedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return claimRow;
    }),
    getRefundClaimByCase: vi.fn(async (_caseId: string) => claimRow ?? undefined),
    updateRefundClaim: vi.fn(async (id: number, patch: any) => {
      lastClaimPatch = patch;
      claimRow = { ...(claimRow ?? { id }), ...patch, updatedAt: new Date() };
      return claimRow;
    }),

    // Audit logging
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
  }),
}));

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (req: any, res: any, next: any) => {
    const token = req.headers["x-portal-session-token"];
    if (typeof token === "string" && token.length > 0) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async (req: any) => {
    const adminToken = (req.headers["authorization"] ?? "").replace("Bearer ", "");
    const portalToken = req.headers["x-portal-session-token"];
    return Boolean(adminToken || portalToken);
  }),
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendRefundClaimRequest,
    sendRefundClaimApproved,
    sendRefundClaimRejected,
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async (_id: string, data: any) => ({ id: _id, ...data })),
    createCase: vi.fn(),
    getAllCases: vi.fn(),
    getCaseByAccessCode: vi.fn(),
    getCaseById: vi.fn(),
  },
}));

vi.mock("../services/walletConnectAlert", () => ({
  maybeAlertOnWalletConnect: vi.fn(async () => {}),
  deleteWalletConnectAlertMarkersForCase: vi.fn(async () => {}),
  walletConnectAlertFiredKey: vi.fn(() => ""),
}));

const MINIMAL_PDF = Buffer.from("%PDF-1.4 minimal");
vi.mock("../services/refundClaimCertificate", () => ({
  buildRefundClaimCertificate: vi.fn(async () => MINIMAL_PDF),
}));

// ── App factory ──────────────────────────────────────────────────────────────

async function buildApp() {
  const { casesRouter } = await import("../routes/cases");
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_TOKEN = "Bearer test-admin-bearer-token";
const PORTAL_TOKEN = "portal-session-token-abc";
const CASE_ID = "case-refund-test-001";

function makeCaseRow(overrides: Record<string, any> = {}) {
  return {
    id: CASE_ID,
    accessCode: "RCTEST123456",
    userName: "Jane Doe",
    userEmail: "jane@example.com",
    status: "active",
    sealedAt: null,
    userPin: null,
    preferredLocale: "en",
    refundClaimStatus: null,
    ...overrides,
  };
}

// ── Suites ───────────────────────────────────────────────────────────────────

describe("POST /api/cases/:id/refund-claim/request — admin activates refund claim flow", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    auditLogs.length = 0;
    claimRow = null;
    lastCasePatch = null;
    nextClaimId = 1;
    sendRefundClaimRequest.mockClear();
    caseRow = makeCaseRow();
  });

  it("happy path: creates the claim row and returns { success: true, emailDispatched: true }", async () => {
    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/request`)
      .set("Authorization", ADMIN_TOKEN)
      .send({ documentaryRecommendations: "Please submit bank statement." });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailDispatched).toBe(true);
  });

  it("happy path: calls createRefundClaim with the correct caseId and recs", async () => {
    const { storage } = await import("../storage");
    const spy = storage.createRefundClaim as ReturnType<typeof vi.fn>;
    spy.mockClear();

    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/request`)
      .set("Authorization", ADMIN_TOKEN)
      .send({ documentaryRecommendations: "Show proof of funds." });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        documentaryRecommendations: "Show proof of funds.",
      }),
    );
  });

  it("happy path: updates the case refundClaimStatus to pending_submission", async () => {
    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/request`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    expect(lastCasePatch).toEqual(
      expect.objectContaining({ refundClaimStatus: "pending_submission" }),
    );
  });

  it("happy path: writes a refund_claim_requested audit log entry", async () => {
    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/request`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    const entry = auditLogs.find((e) => e.action === "refund_claim_requested");
    expect(entry).toBeDefined();
    expect(entry.targetId).toBe(CASE_ID);
    expect(entry.targetType).toBe("case");
  });

  it("happy path: dispatches the sendRefundClaimRequest email fire-and-forget", async () => {
    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/request`)
      .set("Authorization", ADMIN_TOKEN)
      .send({ documentaryRecommendations: "KYC docs required." });

    await vi.waitFor(() => expect(sendRefundClaimRequest).toHaveBeenCalledOnce());
    expect(sendRefundClaimRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "jane@example.com",
        caseId: CASE_ID,
        documentaryRecommendations: "KYC docs required.",
      }),
    );
  });

  it("returns 409 when a refund claim was already requested (refundClaimStatus != null)", async () => {
    caseRow = makeCaseRow({ refundClaimStatus: "pending_submission" });

    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/request`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already requested/i);
  });

  it("returns 404 when the case does not exist", async () => {
    caseRow = null;

    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/request`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    expect(res.status).toBe(404);
  });

  it("returns 401 when no admin bearer token is supplied", async () => {
    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/request`)
      .send({});

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/cases/:id/refund-claim — fetch claim data (admin or portal)", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    caseRow = makeCaseRow({ refundClaimStatus: "pending_submission" });
    claimRow = {
      id: 1,
      caseId: CASE_ID,
      status: "pending_submission",
      entries: null,
      documentaryRecommendations: "Please provide ID.",
      requestedBy: TEST_ADMIN_USERNAME,
      adminNotes: null,
      submittedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  it("happy path (admin bearer): returns the claim object", async () => {
    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim`)
      .set("Authorization", ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.caseId).toBe(CASE_ID);
    expect(res.body.status).toBe("pending_submission");
  });

  it("happy path (portal session): returns the claim object", async () => {
    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim`)
      .set("x-portal-session-token", PORTAL_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.caseId).toBe(CASE_ID);
  });

  it("happy path: calls getRefundClaimByCase with the correct caseId", async () => {
    const { storage } = await import("../storage");
    const spy = storage.getRefundClaimByCase as ReturnType<typeof vi.fn>;
    spy.mockClear();

    await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim`)
      .set("Authorization", ADMIN_TOKEN);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(CASE_ID);
  });

  it("returns 404 when no claim row exists for the case", async () => {
    claimRow = null;

    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim`)
      .set("Authorization", ADMIN_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no refund claim/i);
  });

  it("returns 401 when neither admin bearer nor portal token is present", async () => {
    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim`);

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/cases/:id/refund-claim — portal submits / updates claim entries", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    caseRow = makeCaseRow({ refundClaimStatus: "pending_submission" });
    lastClaimPatch = null;
    lastCasePatch = null;
    claimRow = {
      id: 1,
      caseId: CASE_ID,
      status: "pending_submission",
      entries: null,
      documentaryRecommendations: null,
      requestedBy: TEST_ADMIN_USERNAME,
      adminNotes: null,
      submittedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  it("happy path: updates entries and calls updateRefundClaim", async () => {
    const { storage } = await import("../storage");
    const spy = storage.updateRefundClaim as ReturnType<typeof vi.fn>;
    spy.mockClear();

    const entries = [{ description: "Lost funds", amount: "500 USDT" }];
    const res = await request(app)
      .patch(`/api/cases/${CASE_ID}/refund-claim`)
      .set("x-portal-session-token", PORTAL_TOKEN)
      .send({ entries });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ entries }),
    );
  });

  it("happy path with submit=true: marks the claim submitted and case status", async () => {
    const entries = [{ description: "Claim entry", amount: "200 USDT" }];
    const res = await request(app)
      .patch(`/api/cases/${CASE_ID}/refund-claim`)
      .set("x-portal-session-token", PORTAL_TOKEN)
      .send({ entries, submit: true });

    expect(res.status).toBe(200);
    expect(lastClaimPatch).toEqual(
      expect.objectContaining({ status: "submitted" }),
    );
    expect(lastCasePatch).toEqual(
      expect.objectContaining({ refundClaimStatus: "submitted" }),
    );
  });

  it("returns 404 when no claim exists", async () => {
    claimRow = null;

    const res = await request(app)
      .patch(`/api/cases/${CASE_ID}/refund-claim`)
      .set("x-portal-session-token", PORTAL_TOKEN)
      .send({ entries: [] });

    expect(res.status).toBe(404);
  });

  it("returns 409 when claim is no longer editable (status != pending_submission)", async () => {
    claimRow = { ...claimRow, status: "submitted" };

    const res = await request(app)
      .patch(`/api/cases/${CASE_ID}/refund-claim`)
      .set("x-portal-session-token", PORTAL_TOKEN)
      .send({ entries: [] });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no longer editable/i);
  });

  it("returns 401 when no portal session token is supplied", async () => {
    const res = await request(app)
      .patch(`/api/cases/${CASE_ID}/refund-claim`)
      .send({ entries: [] });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/cases/:id/refund-claim/approve — admin approves a refund claim", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    auditLogs.length = 0;
    lastCasePatch = null;
    lastClaimPatch = null;
    sendRefundClaimApproved.mockClear();
    caseRow = makeCaseRow({ refundClaimStatus: "submitted" });
    claimRow = {
      id: 1,
      caseId: CASE_ID,
      status: "submitted",
      entries: [{ description: "Lost funds", amount: "500 USDT" }],
      documentaryRecommendations: null,
      requestedBy: TEST_ADMIN_USERNAME,
      adminNotes: null,
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  it("happy path: returns 200 with { success: true, emailDispatched: true }", async () => {
    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/approve`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailDispatched).toBe(true);
  });

  it("happy path: calls updateRefundClaim with status: 'approved'", async () => {
    const { storage } = await import("../storage");
    const spy = storage.updateRefundClaim as ReturnType<typeof vi.fn>;
    spy.mockClear();

    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/approve`)
      .set("Authorization", ADMIN_TOKEN)
      .send({ adminNotes: "Looks good." });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "approved" }),
    );
  });

  it("happy path: calls updateCase with refundClaimStatus: 'approved'", async () => {
    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/approve`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    expect(lastCasePatch).toEqual(
      expect.objectContaining({ refundClaimStatus: "approved" }),
    );
  });

  it("happy path: writes a refund_claim_approved audit log entry", async () => {
    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/approve`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    const entry = auditLogs.find((e) => e.action === "refund_claim_approved");
    expect(entry).toBeDefined();
    expect(entry.targetId).toBe(CASE_ID);
    expect(entry.targetType).toBe("case");
  });

  it("happy path: dispatches sendRefundClaimApproved fire-and-forget", async () => {
    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/approve`)
      .set("Authorization", ADMIN_TOKEN)
      .send({ adminNotes: "Approved after review." });

    await vi.waitFor(() => expect(sendRefundClaimApproved).toHaveBeenCalledOnce());
    expect(sendRefundClaimApproved).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "jane@example.com",
        caseId: CASE_ID,
      }),
    );
  });

  it("returns 404 when no refund claim exists for the case", async () => {
    claimRow = null;

    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/approve`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no refund claim/i);
  });

  it("returns 404 when the case does not exist", async () => {
    caseRow = null;

    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/approve`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/case not found/i);
  });

  it("returns 401 when only a portal session token is supplied (endpoint is admin-only)", async () => {
    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/approve`)
      .set("x-portal-session-token", PORTAL_TOKEN)
      .send({});

    expect(res.status).toBe(401);
  });

  it("returns 401 when no admin bearer token is supplied", async () => {
    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/approve`)
      .send({});

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/cases/:id/refund-claim/reject — admin rejects a refund claim", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    auditLogs.length = 0;
    lastCasePatch = null;
    lastClaimPatch = null;
    sendRefundClaimRejected.mockClear();
    caseRow = makeCaseRow({ refundClaimStatus: "submitted" });
    claimRow = {
      id: 1,
      caseId: CASE_ID,
      status: "submitted",
      entries: [{ description: "Lost funds", amount: "500 USDT" }],
      documentaryRecommendations: null,
      requestedBy: TEST_ADMIN_USERNAME,
      adminNotes: null,
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  it("happy path: returns 200 with { success: true, emailDispatched: true }", async () => {
    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/reject`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailDispatched).toBe(true);
  });

  it("happy path: calls updateRefundClaim with status: 'rejected'", async () => {
    const { storage } = await import("../storage");
    const spy = storage.updateRefundClaim as ReturnType<typeof vi.fn>;
    spy.mockClear();

    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/reject`)
      .set("Authorization", ADMIN_TOKEN)
      .send({ adminNotes: "Insufficient documentation." });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "rejected" }),
    );
  });

  it("happy path: calls updateCase with refundClaimStatus: 'rejected'", async () => {
    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/reject`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    expect(lastCasePatch).toEqual(
      expect.objectContaining({ refundClaimStatus: "rejected" }),
    );
  });

  it("happy path: writes a refund_claim_rejected audit log entry", async () => {
    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/reject`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    const entry = auditLogs.find((e) => e.action === "refund_claim_rejected");
    expect(entry).toBeDefined();
    expect(entry.targetId).toBe(CASE_ID);
    expect(entry.targetType).toBe("case");
  });

  it("happy path: dispatches sendRefundClaimRejected fire-and-forget", async () => {
    await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/reject`)
      .set("Authorization", ADMIN_TOKEN)
      .send({ adminNotes: "Claim denied." });

    await vi.waitFor(() => expect(sendRefundClaimRejected).toHaveBeenCalledOnce());
    expect(sendRefundClaimRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "jane@example.com",
        caseId: CASE_ID,
      }),
    );
  });

  it("returns 404 when no refund claim exists for the case", async () => {
    claimRow = null;

    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/reject`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no refund claim/i);
  });

  it("returns 404 when the case does not exist", async () => {
    caseRow = null;

    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/reject`)
      .set("Authorization", ADMIN_TOKEN)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/case not found/i);
  });

  it("returns 401 when only a portal session token is supplied (endpoint is admin-only)", async () => {
    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/reject`)
      .set("x-portal-session-token", PORTAL_TOKEN)
      .send({});

    expect(res.status).toBe(401);
  });

  it("returns 401 when no admin bearer token is supplied", async () => {
    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/refund-claim/reject`)
      .send({});

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/cases/:id/refund-claim/certificate — generate certificate PDF", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    caseRow = makeCaseRow({ refundClaimStatus: "approved" });
    claimRow = {
      id: 1,
      caseId: CASE_ID,
      status: "approved",
      entries: [{ description: "Lost funds", amount: "500 USDT" }],
      documentaryRecommendations: "Provide bank statement.",
      requestedBy: TEST_ADMIN_USERNAME,
      adminNotes: null,
      submittedAt: new Date().toISOString(),
      reviewedAt: new Date().toISOString(),
      reviewedBy: TEST_ADMIN_USERNAME,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  it("happy path: returns 200 with content-type application/pdf", async () => {
    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim/certificate`)
      .set("Authorization", ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
  });

  it("happy path: content-disposition header contains the correct filename with the case ID", async () => {
    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim/certificate`)
      .set("Authorization", ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain(
      `IBCCF-RefundCertificate-${CASE_ID}.pdf`,
    );
  });

  it("happy path: calls buildRefundClaimCertificate with the correct holderName and holderEmail", async () => {
    const { buildRefundClaimCertificate } = await import(
      "../services/refundClaimCertificate"
    );
    const spy = buildRefundClaimCertificate as ReturnType<typeof vi.fn>;
    spy.mockClear();

    await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim/certificate`)
      .set("Authorization", ADMIN_TOKEN);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        holderName: "Jane Doe",
        holderEmail: "jane@example.com",
      }),
    );
  });

  it("happy path: response body is the buffer returned by buildRefundClaimCertificate", async () => {
    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim/certificate`)
      .set("Authorization", ADMIN_TOKEN)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.equals(MINIMAL_PDF)).toBe(true);
  });

  it("returns 404 when getRefundClaimByCase finds no row", async () => {
    claimRow = null;

    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim/certificate`)
      .set("Authorization", ADMIN_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no refund claim/i);
  });

  it("returns 404 when the case does not exist", async () => {
    caseRow = null;

    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim/certificate`)
      .set("Authorization", ADMIN_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/case not found/i);
  });

  it("returns 400 when the claim exists but is not approved", async () => {
    claimRow = { ...claimRow, status: "submitted" };

    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim/certificate`)
      .set("Authorization", ADMIN_TOKEN);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approved/i);
  });

  it("returns 401 when no admin bearer token is supplied", async () => {
    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim/certificate`);

    expect(res.status).toBe(401);
  });

  it("returns 401 when only a portal session token is supplied (endpoint is admin-only)", async () => {
    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/refund-claim/certificate`)
      .set("x-portal-session-token", PORTAL_TOKEN);

    expect(res.status).toBe(401);
  });
});
