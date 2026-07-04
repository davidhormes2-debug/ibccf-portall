import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "refund-claim-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---- Mocks ----------------------------------------------------------------

const auditLogs: any[] = [];

let claimRow: any = null;
let caseRow: any = null;
let updatedClaimPayload: any = null;
let createdClaimPayload: any = null;
const caseUpdates: any[] = [];
const emailsSent: string[] = [];

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (_token: string) => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    runInTransaction: vi.fn(async (fn: any) => fn({})),
    getCaseById: vi.fn(async () => caseRow),
    getRefundClaimByCase: vi.fn(async () => claimRow),
    createRefundClaim: vi.fn(async (data: any) => {
      createdClaimPayload = data;
      claimRow = { id: 1, status: "pending_submission", entries: [], ...data };
      return claimRow;
    }),
    updateRefundClaim: vi.fn(async (_id: number, data: any) => {
      updatedClaimPayload = data;
      claimRow = { ...(claimRow ?? {}), ...data };
      return claimRow;
    }),
    updateCase: vi.fn(async (_id: string, data: any) => {
      caseUpdates.push(data);
      caseRow = { ...(caseRow ?? {}), ...data };
      return caseRow;
    }),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async () => {}),
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendRefundClaimRequest: vi.fn(async () => {
      emailsSent.push("request");
    }),
    sendRefundClaimApproved: vi.fn(async () => {
      emailsSent.push("approved");
    }),
    sendRefundClaimRejected: vi.fn(async () => {
      emailsSent.push("rejected");
    }),
  }),
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async () => ({ sent: true })),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

vi.mock("../services/portal-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/portal-auth")>();
  return {
    ...actual,
    requirePortalAccess: (_req: any, _res: any, next: any) => next(),
    requireUnsealed: (_req: any, _res: any, next: any) => next(),
    requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
    isAuthorizedForCase: vi.fn(async () => true),
  };
});

vi.mock("../services/refundClaimCertificate", () => ({
  buildRefundClaimCertificate: vi.fn(async () => Buffer.from("%PDF-1.4 fake")),
}));

// Import AFTER vi.mock calls.
const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const baseCase = {
  id: "case-1",
  accessCode: "ABCD-1234",
  userName: "Test User",
  userEmail: "user@example.com",
  refundClaimStatus: null,
  preferredLocale: "en",
};

const baseClaim = {
  id: 1,
  caseId: "case-1",
  status: "pending_submission",
  entries: [],
  documentaryRecommendations: null,
  adminNotes: null,
  submittedAt: null,
  reviewedAt: null,
};

beforeEach(() => {
  auditLogs.length = 0;
  emailsSent.length = 0;
  caseUpdates.length = 0;
  updatedClaimPayload = null;
  createdClaimPayload = null;
  claimRow = { ...baseClaim };
  caseRow = { ...baseCase };
});

const auth = { Authorization: "Bearer test-token" };

// ============================================================================
// POST /:id/refund-claim/request
// ============================================================================

describe("POST /api/cases/:id/refund-claim/request", () => {
  const app = buildApp();

  it("creates claim row, sets refundClaimStatus, writes audit log, fires email", async () => {
    claimRow = null;
    caseRow = { ...baseCase, refundClaimStatus: null };

    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/request")
      .set(auth)
      .send({ documentaryRecommendations: "Please include a bank statement." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, emailDispatched: true });

    expect(createdClaimPayload).toMatchObject({
      caseId: "case-1",
      documentaryRecommendations: "Please include a bank statement.",
    });

    const statusUpdate = caseUpdates.find((u) => "refundClaimStatus" in u);
    expect(statusUpdate).toMatchObject({ refundClaimStatus: "pending_submission" });

    const auditEntry = auditLogs.find((a) => a.action === "refund_claim_requested");
    expect(auditEntry).toBeTruthy();
    expect(auditEntry.targetType).toBe("case");
    expect(auditEntry.targetId).toBe("case-1");

    expect(emailsSent).toContain("request");
  });

  it("works without documentaryRecommendations (null stored)", async () => {
    claimRow = null;
    caseRow = { ...baseCase, refundClaimStatus: null };

    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/request")
      .set(auth)
      .send({});

    expect(res.status).toBe(200);
    expect(createdClaimPayload?.documentaryRecommendations).toBeNull();
  });

  it("returns 409 when a claim has already been requested for the case", async () => {
    caseRow = { ...baseCase, refundClaimStatus: "pending_submission" };

    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/request")
      .set(auth)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringContaining("already") });
    expect(createdClaimPayload).toBeNull();
    expect(auditLogs).toHaveLength(0);
  });

  it("returns 404 when the case does not exist", async () => {
    caseRow = null;

    const res = await request(app)
      .post("/api/cases/nonexistent/refund-claim/request")
      .set(auth)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Case not found" });
  });

  it("returns 401 when called without an admin bearer token", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/request")
      .send({});

    expect(res.status).toBe(401);
    expect(createdClaimPayload).toBeNull();
  });
});

// ============================================================================
// PATCH /:id/refund-claim  (portal session)
// ============================================================================

describe("PATCH /api/cases/:id/refund-claim", () => {
  const app = buildApp();

  const sampleEntries = [
    { amount: "500", chargedFor: "Activation fee", date: "2026-01-15", txId: "tx-abc", network: "TRC20", notes: "" },
  ];

  it("saves entries and returns updated claim", async () => {
    const res = await request(app)
      .patch("/api/cases/case-1/refund-claim")
      .set("x-portal-session-token", "test-portal-token")
      .send({ entries: sampleEntries });

    expect(res.status).toBe(200);
    expect(updatedClaimPayload).toMatchObject({ entries: sampleEntries });
    expect(auditLogs).toHaveLength(0);
  });

  it("sets status=submitted and writes audit log when submit=true", async () => {
    const res = await request(app)
      .patch("/api/cases/case-1/refund-claim")
      .set("x-portal-session-token", "test-portal-token")
      .send({ entries: sampleEntries, submit: true });

    expect(res.status).toBe(200);
    expect(updatedClaimPayload).toMatchObject({ status: "submitted" });
    expect(updatedClaimPayload.submittedAt).toBeInstanceOf(Date);

    const statusUpdate = caseUpdates.find((u) => "refundClaimStatus" in u);
    expect(statusUpdate).toMatchObject({ refundClaimStatus: "submitted" });

    const auditEntry = auditLogs.find((a) => a.action === "refund_claim_submitted");
    expect(auditEntry).toBeTruthy();
    expect(auditEntry.targetId).toBe("case-1");
  });

  it("returns 404 when no claim exists for the case", async () => {
    claimRow = null;

    const res = await request(app)
      .patch("/api/cases/case-1/refund-claim")
      .send({ entries: sampleEntries });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "No refund claim found" });
  });

  it("returns 409 when claim is not in pending_submission state", async () => {
    claimRow = { ...baseClaim, status: "submitted" };

    const res = await request(app)
      .patch("/api/cases/case-1/refund-claim")
      .send({ entries: sampleEntries });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringContaining("editable") });
    expect(updatedClaimPayload).toBeNull();
  });
});

// ============================================================================
// POST /:id/refund-claim/approve
// ============================================================================

describe("POST /api/cases/:id/refund-claim/approve", () => {
  const app = buildApp();

  beforeEach(() => {
    claimRow = { ...baseClaim, status: "submitted" };
  });

  it("sets claim status=approved, stamps reviewedAt/reviewedBy, updates case, writes audit log, fires email", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/approve")
      .set(auth)
      .send({ adminNotes: "Approved — all documentation is in order." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, emailDispatched: true });

    expect(updatedClaimPayload).toMatchObject({
      status: "approved",
      adminNotes: "Approved — all documentation is in order.",
    });
    expect(updatedClaimPayload.reviewedAt).toBeInstanceOf(Date);
    expect(updatedClaimPayload.reviewedBy).toBeTruthy();

    const statusUpdate = caseUpdates.find((u) => "refundClaimStatus" in u);
    expect(statusUpdate).toMatchObject({ refundClaimStatus: "approved" });

    const auditEntry = auditLogs.find((a) => a.action === "refund_claim_approved");
    expect(auditEntry).toBeTruthy();
    expect(auditEntry.targetId).toBe("case-1");

    expect(emailsSent).toContain("approved");
  });

  it("approves without adminNotes (null stored)", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(200);
    expect(updatedClaimPayload?.adminNotes).toBeNull();
  });

  it("returns 404 when no claim exists", async () => {
    claimRow = null;

    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "No refund claim found" });
    expect(updatedClaimPayload).toBeNull();
    expect(auditLogs).toHaveLength(0);
  });

  it("returns 404 when the case does not exist", async () => {
    caseRow = null;

    const res = await request(app)
      .post("/api/cases/nonexistent/refund-claim/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Case not found" });
  });

  it("returns 401 when called without admin auth", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/approve")
      .send({});

    expect(res.status).toBe(401);
    expect(updatedClaimPayload).toBeNull();
    expect(emailsSent).toHaveLength(0);
  });
});

// ============================================================================
// POST /:id/refund-claim/reject
// ============================================================================

describe("POST /api/cases/:id/refund-claim/reject", () => {
  const app = buildApp();

  beforeEach(() => {
    claimRow = { ...baseClaim, status: "submitted" };
  });

  it("sets claim status=rejected, stamps reviewedAt/reviewedBy, updates case, writes audit log, fires email", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/reject")
      .set(auth)
      .send({ adminNotes: "Insufficient documentation." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, emailDispatched: true });

    expect(updatedClaimPayload).toMatchObject({
      status: "rejected",
      adminNotes: "Insufficient documentation.",
    });
    expect(updatedClaimPayload.reviewedAt).toBeInstanceOf(Date);
    expect(updatedClaimPayload.reviewedBy).toBeTruthy();

    const statusUpdate = caseUpdates.find((u) => "refundClaimStatus" in u);
    expect(statusUpdate).toMatchObject({ refundClaimStatus: "rejected" });

    const auditEntry = auditLogs.find((a) => a.action === "refund_claim_rejected");
    expect(auditEntry).toBeTruthy();
    expect(auditEntry.targetId).toBe("case-1");

    expect(emailsSent).toContain("rejected");
  });

  it("rejects without adminNotes (null stored)", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/reject")
      .set(auth)
      .send({});

    expect(res.status).toBe(200);
    expect(updatedClaimPayload?.adminNotes).toBeNull();
  });

  it("returns 404 when no claim exists", async () => {
    claimRow = null;

    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/reject")
      .set(auth)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "No refund claim found" });
    expect(updatedClaimPayload).toBeNull();
    expect(auditLogs).toHaveLength(0);
  });

  it("returns 404 when the case does not exist", async () => {
    caseRow = null;

    const res = await request(app)
      .post("/api/cases/nonexistent/refund-claim/reject")
      .set(auth)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Case not found" });
  });

  it("returns 401 when called without admin auth", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/refund-claim/reject")
      .send({});

    expect(res.status).toBe(401);
    expect(updatedClaimPayload).toBeNull();
    expect(emailsSent).toHaveLength(0);
  });
});
