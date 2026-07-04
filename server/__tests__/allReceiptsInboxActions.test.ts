import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "all-receipts-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// Task #170 — Lock down per-source dispatch from the cross-case
// All Receipts inbox (Task #164 row actions).
//
// The inbox does NOT have its own approve/reject endpoint — each row
// dispatches to the existing per-table route based on its `source`
// discriminator. The point of this file is to assert that, for each
// of the three sources, an approve/reject click:
//   1. mutates the right per-table storage method,
//   2. writes an audit log with the source-specific action, and
//   3. fires the source-specific transactional email tag.
//
// Routes exercised (mirrors AllReceiptsTab.reviewReceipt):
//   - deposit     : PATCH /api/deposit-receipts/:id   { status }
//   - certificate : POST  /api/cases/:id/certificate/fee-payments/:id/(approve|reject)
//   - stamp_duty  : POST  /api/cases/:id/stamp-duty/receipts/:id/(approve|reject)

// ---- Mutable test fixtures (reset in beforeEach) --------------------------

const auditLogs: any[] = [];
const sentEmails: any[] = [];
const caseUpdates: any[] = [];

let depositReceiptRow: any = null;
let certPaymentRow: any = null;
let stampReceiptRow: any = null;
let reissueRow: any = null;
let caseRow: any = null;

let updatedDepositPayload: any = null;
let updatedCertPayload: any = null;
let updatedStampPayload: any = null;
const updatedReissuePayloads: any[] = [];

const sendLocalizedCaseEmail = vi.fn(async () => ({ success: true }));

// ---- Mocks ----------------------------------------------------------------

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({}),
    ),

    // Deposit receipt path.
    getDepositReceiptById: vi.fn(async () => depositReceiptRow),
    updateDepositReceipt: vi.fn(async (_id: number, data: any) => {
      updatedDepositPayload = data;
      depositReceiptRow = { ...(depositReceiptRow ?? {}), ...data };
      return depositReceiptRow;
    }),
    getLetterReissueById: vi.fn(async () => reissueRow),
    updateLetterReissue: vi.fn(async (_id: number, data: any) => {
      updatedReissuePayloads.push(data);
      reissueRow = { ...(reissueRow ?? {}), ...data };
      return reissueRow;
    }),

    // Certificate fee-payment path.
    getCertificateFeePaymentById: vi.fn(async () => certPaymentRow),
    updateCertificateFeePayment: vi.fn(async (_id: number, data: any) => {
      updatedCertPayload = data;
      certPaymentRow = { ...(certPaymentRow ?? {}), ...data };
      return certPaymentRow;
    }),

    // Stamp-duty receipt path.
    getStampDutyReceiptById: vi.fn(async () => stampReceiptRow),
    updateStampDutyReceipt: vi.fn(async (_id: number, data: any) => {
      updatedStampPayload = data;
      stampReceiptRow = { ...(stampReceiptRow ?? {}), ...data };
      return stampReceiptRow;
    }),

    getCaseById: vi.fn(async () => caseRow),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async (_id: string, data: any) => {
      caseUpdates.push(data);
      caseRow = { ...(caseRow ?? {}), ...data };
      return caseRow;
    }),
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendLocalizedCaseEmail,
  }),
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async (params: any) => {
    sentEmails.push({
      tag: params.tag,
      to: params.to,
      caseId: params.caseId,
      adminUser: params.adminUser,
    });
    await params.send("en");
    return { sent: true };
  }),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

// Imports AFTER vi.mock calls.
const { depositsRouter } = await import("../routes/deposits");
const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  // Match the production mount layout from server/routes.ts so the
  // AllReceiptsTab URLs hit the exact same handler.
  app.use("/api/deposit-receipts", depositsRouter);
  app.use("/api/cases", casesRouter);
  return app;
}

const auth = { Authorization: "Bearer test-token" };

const baseCase = {
  id: "case-1",
  accessCode: "ABCD-1234",
  userName: "Test User",
  userEmail: "user@example.com",
  stampDutyStatus: "awaiting_admin_approval",
};

beforeEach(() => {
  auditLogs.length = 0;
  sentEmails.length = 0;
  caseUpdates.length = 0;
  updatedReissuePayloads.length = 0;
  updatedDepositPayload = null;
  updatedCertPayload = null;
  updatedStampPayload = null;

  depositReceiptRow = {
    id: 50,
    caseId: "case-1",
    status: "pending",
    reissueId: 7,
    adminNotes: null,
    category: "reissue",
  };
  reissueRow = {
    id: 7,
    caseId: "case-1",
    version: 2,
    reissueFee: "1500 USDT",
    status: "awaiting_review",
    receiptId: 50,
    paidAt: null,
  };
  certPaymentRow = {
    id: 11,
    caseId: "case-1",
    status: "pending",
    amountUsdt: "500",
    adminNotes: null,
  };
  stampReceiptRow = {
    id: 99,
    caseId: "case-1",
    status: "pending",
    amountUsdt: "250",
    adminNotes: null,
  };
  caseRow = { ...baseCase };

  sendLocalizedCaseEmail.mockClear();
});

// ---- deposit source -------------------------------------------------------

describe("All Receipts inbox — deposit source dispatch", () => {
  const app = buildApp();

  it("approve routes to PATCH /api/deposit-receipts/:id, updates the deposit row, writes the audit, and fires reissue-receipt-approved email", async () => {
    const res = await request(app)
      .patch("/api/deposit-receipts/50")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);

    // Per-table storage method was called with the inbox's status.
    expect(updatedDepositPayload).toMatchObject({ status: "approved" });
    // Cert + stamp tables were NOT touched.
    expect(updatedCertPayload).toBeNull();
    expect(updatedStampPayload).toBeNull();

    // Source-specific audit action fired.
    const depositAudit = auditLogs.find(
      (a) => a.action === "admin_update_deposit_receipt",
    );
    expect(depositAudit).toBeTruthy();
    expect(depositAudit.targetType).toBe("deposit_receipt");

    // Reissue round was flipped to paid (the deposit→reissue side effect).
    expect(updatedReissuePayloads[0]).toMatchObject({ status: "paid" });
    const reissueAudit = auditLogs.find(
      (a) => a.action === "reissue_marked_paid",
    );
    expect(reissueAudit).toBeTruthy();

    // Email side-effect is fire-and-forget — drain microtasks before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    expect(sentEmails.some((e) => e.tag === "reissue-receipt-approved")).toBe(
      true,
    );
    // And the cert/stamp email tags must NOT have fired from this dispatch.
    expect(sentEmails.some((e) => e.tag === "certificate_unlocked")).toBe(false);
    expect(sentEmails.some((e) => e.tag === "stamp_duty_approved")).toBe(false);
  });

  it("reject routes to the same PATCH endpoint and fires reissue-receipt-rejected email", async () => {
    const res = await request(app)
      .patch("/api/deposit-receipts/50")
      .set(auth)
      .send({ status: "rejected", adminNotes: "Illegible receipt." });

    expect(res.status).toBe(200);
    expect(updatedDepositPayload).toMatchObject({
      status: "rejected",
      adminNotes: "Illegible receipt.",
    });
    expect(updatedCertPayload).toBeNull();
    expect(updatedStampPayload).toBeNull();

    expect(
      auditLogs.find((a) => a.action === "admin_update_deposit_receipt"),
    ).toBeTruthy();

    await new Promise((resolve) => setImmediate(resolve));

    expect(sentEmails.some((e) => e.tag === "reissue-receipt-rejected")).toBe(
      true,
    );
    expect(sentEmails.some((e) => e.tag === "certificate_fee_rejected")).toBe(
      false,
    );
    expect(sentEmails.some((e) => e.tag === "stamp_duty_rejected")).toBe(false);
  });
});

// ---- certificate source ---------------------------------------------------

describe("All Receipts inbox — certificate source dispatch", () => {
  const app = buildApp();

  it("approve routes to POST .../certificate/fee-payments/:id/approve, updates the cert row + case, writes certificate_fee_approved audit, fires certificate_unlocked email", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/certificate/fee-payments/11/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // Cert-specific storage method called; deposit/stamp untouched.
    expect(updatedCertPayload).toMatchObject({
      status: "approved",
      reviewedBy: "Admin",
    });
    expect(updatedDepositPayload).toBeNull();
    expect(updatedStampPayload).toBeNull();

    // Case row flipped.
    expect(caseUpdates).toHaveLength(1);
    expect(caseUpdates[0]).toMatchObject({
      certificateFeeStatus: "approved",
      certificateFeeApprovedBy: "Admin",
    });

    // Source-specific audit.
    const certAudit = auditLogs.find(
      (a) => a.action === "certificate_fee_approved",
    );
    expect(certAudit).toBeTruthy();
    expect(certAudit.targetType).toBe("case");
    expect(certAudit.targetId).toBe("case-1");

    await new Promise((resolve) => setImmediate(resolve));

    // Certificate approve fires the "certificate_unlocked" tag (not
    // approve-symmetric — keep this contract pinned).
    expect(sentEmails.some((e) => e.tag === "certificate_unlocked")).toBe(true);
    expect(sentEmails.some((e) => e.tag === "stamp_duty_approved")).toBe(false);
    expect(sentEmails.some((e) => e.tag === "reissue-receipt-approved")).toBe(
      false,
    );
  });

  it("reject routes to POST .../certificate/fee-payments/:id/reject, writes certificate_fee_rejected audit, fires certificate_fee_rejected email", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/certificate/fee-payments/11/reject")
      .set(auth)
      .send({ adminNotes: "Wrong amount." });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    expect(updatedCertPayload).toMatchObject({
      status: "rejected",
      adminNotes: "Wrong amount.",
      reviewedBy: "Admin",
    });
    expect(updatedDepositPayload).toBeNull();
    expect(updatedStampPayload).toBeNull();

    expect(caseUpdates).toHaveLength(1);
    expect(caseUpdates[0]).toMatchObject({ certificateFeeStatus: "rejected" });

    expect(
      auditLogs.find((a) => a.action === "certificate_fee_rejected"),
    ).toBeTruthy();

    await new Promise((resolve) => setImmediate(resolve));

    expect(sentEmails.some((e) => e.tag === "certificate_fee_rejected")).toBe(
      true,
    );
    expect(sentEmails.some((e) => e.tag === "stamp_duty_rejected")).toBe(false);
    expect(sentEmails.some((e) => e.tag === "reissue-receipt-rejected")).toBe(
      false,
    );
  });
});

// ---- stamp_duty source ----------------------------------------------------

describe("All Receipts inbox — stamp_duty source dispatch", () => {
  const app = buildApp();

  it("approve routes to POST .../stamp-duty/receipts/:id/approve, updates the stamp row + case, writes stamp_duty_approved audit, fires stamp_duty_approved email", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    expect(updatedStampPayload).toMatchObject({
      status: "approved",
      reviewedBy: "Admin",
    });
    expect(updatedDepositPayload).toBeNull();
    expect(updatedCertPayload).toBeNull();

    expect(caseUpdates).toHaveLength(1);
    expect(caseUpdates[0]).toMatchObject({
      stampDutyStatus: "approved",
      stampDutyApprovedBy: "Admin",
    });

    expect(
      auditLogs.find((a) => a.action === "stamp_duty_approved"),
    ).toBeTruthy();

    expect(sentEmails.some((e) => e.tag === "stamp_duty_approved")).toBe(true);
    expect(sentEmails.some((e) => e.tag === "certificate_unlocked")).toBe(false);
    expect(sentEmails.some((e) => e.tag === "reissue-receipt-approved")).toBe(
      false,
    );
  });

  it("reject routes to POST .../stamp-duty/receipts/:id/reject, writes stamp_duty_rejected audit, fires stamp_duty_rejected email", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/reject")
      .set(auth)
      .send({ adminNotes: "Illegible." });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    expect(updatedStampPayload).toMatchObject({
      status: "rejected",
      adminNotes: "Illegible.",
      reviewedBy: "Admin",
    });
    expect(updatedDepositPayload).toBeNull();
    expect(updatedCertPayload).toBeNull();

    expect(caseUpdates).toHaveLength(1);
    expect(caseUpdates[0]).toMatchObject({
      stampDutyStatus: "rejected",
      stampDutyRejectionReason: "Illegible.",
    });

    expect(
      auditLogs.find((a) => a.action === "stamp_duty_rejected"),
    ).toBeTruthy();

    expect(sentEmails.some((e) => e.tag === "stamp_duty_rejected")).toBe(true);
    expect(sentEmails.some((e) => e.tag === "certificate_fee_rejected")).toBe(
      false,
    );
    expect(sentEmails.some((e) => e.tag === "reissue-receipt-rejected")).toBe(
      false,
    );
  });
});
