import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "reissue-receipt-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---- Mocks ----------------------------------------------------------------
//
// Mirrors the isolation pattern in cases.payoutWallet.test.ts: every module
// the deposits router pulls in is mocked so the PATCH handler runs without a
// real DB or SMTP. We intercept sendCaseEmailWithAudit at the module level so
// we can observe the exact `tag` passed (`reissue-receipt-approved` /
// `reissue-receipt-rejected`) without re-running the real audit helper.

const auditLogs: any[] = [];
const sentEmails: any[] = [];

let receiptRow: any = null;
let reissueRow: any = null;
let caseRow: any = null;
let updatedReceiptPayload: any = null;
let updatedReissuePayloads: any[] = [];

const sendLocalizedCaseEmail = vi.fn(async (_arg?: unknown) => ({ success: true }));

// The mock is built with `createStorageMock`, which auto-stubs any storage
// method the route reaches for that we did NOT explicitly list below. That way
// when `deposits.ts` starts calling a new storage method, the test keeps
// running (and fails on a clear assertion) instead of crashing with a 500.
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
    updateDepositReceipt: vi.fn(async (_id: number, data: any) => {
      updatedReceiptPayload = data;
      return { ...(receiptRow ?? {}), ...data };
    }),
    updateDepositReceiptStatus: vi.fn(async (_id: number, status: string) => {
      updatedReceiptPayload = { status };
      return { ...(receiptRow ?? {}), status };
    }),
    getDepositReceiptById: vi.fn(async () => receiptRow),
    getLetterReissueById: vi.fn(async () => reissueRow),
    updateLetterReissue: vi.fn(async (_id: number, data: any) => {
      updatedReissuePayloads.push(data);
      reissueRow = { ...(reissueRow ?? {}), ...data };
      return reissueRow;
    }),
    getCaseById: vi.fn(async () => caseRow),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  }),
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

// Import AFTER vi.mock calls.
const { depositsRouter } = await import("../routes/deposits");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/deposits", depositsRouter);
  return app;
}

const baseCase = {
  id: "case-1",
  accessCode: "ABCD-1234",
  userName: "Test User",
  userEmail: "user@example.com",
};

const baseReceipt = {
  id: 42,
  caseId: "case-1",
  reissueId: 7,
  status: "pending",
  adminNotes: null,
};

const baseReissue = {
  id: 7,
  caseId: "case-1",
  version: 2,
  reissueFee: "1500 USDT",
  status: "awaiting_review",
  receiptId: 42,
  paidAt: null,
};

beforeEach(() => {
  auditLogs.length = 0;
  sentEmails.length = 0;
  updatedReceiptPayload = null;
  updatedReissuePayloads = [];
  receiptRow = { ...baseReceipt };
  reissueRow = { ...baseReissue };
  caseRow = { ...baseCase };
  sendLocalizedCaseEmail.mockClear();
});

describe("PATCH /api/deposits/:id — reissue receipt approval flow", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it("(a) approving a reissue receipt flips the round to paid, audits, and emails 'reissue-receipt-approved'", async () => {
    const res = await request(app)
      .patch("/api/deposits/42")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(updatedReceiptPayload).toEqual({ status: "approved" });

    // Round was flipped to paid with a paidAt timestamp.
    const paidUpdate = updatedReissuePayloads.find((p) => p.status === "paid");
    expect(paidUpdate).toBeTruthy();
    expect(paidUpdate.paidAt).toBeInstanceOf(Date);

    // Both audits land: the per-receipt admin update + the reissue_marked_paid.
    expect(
      auditLogs.find((a) => a.action === "admin_update_deposit_receipt"),
    ).toBeTruthy();
    const paidAudit = auditLogs.find((a) => a.action === "reissue_marked_paid");
    expect(paidAudit).toBeTruthy();
    expect(paidAudit.targetType).toBe("case");
    expect(paidAudit.targetId).toBe("case-1");

    // Best-effort email fired with the right tag and recipient.
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({
      tag: "reissue-receipt-approved",
      to: "user@example.com",
      caseId: "case-1",
    });
    expect(sendLocalizedCaseEmail).toHaveBeenCalledTimes(1);
    expect(sendLocalizedCaseEmail.mock.calls[0][0]).toMatchObject({
      templateKey: "reissueApproved",
      logTag: "reissue-receipt-approved",
    });
  });

  it("(b) rejecting a reissue receipt audits and emails 'reissue-receipt-rejected' with the admin notes", async () => {
    const res = await request(app)
      .patch("/api/deposits/42")
      .set(auth)
      .send({ status: "rejected", adminNotes: "Receipt blurry, please resubmit." });

    expect(res.status).toBe(200);
    expect(updatedReceiptPayload).toMatchObject({
      status: "rejected",
      adminNotes: "Receipt blurry, please resubmit.",
    });

    // Round must NOT be flipped to paid on a rejection.
    expect(updatedReissuePayloads.find((p) => p.status === "paid")).toBeUndefined();

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({
      tag: "reissue-receipt-rejected",
      to: "user@example.com",
      caseId: "case-1",
    });
    expect(sendLocalizedCaseEmail).toHaveBeenCalledTimes(1);
    // The admin notes from the request body get forwarded into the email vars.
    expect(sendLocalizedCaseEmail.mock.calls[0][0]).toMatchObject({
      templateKey: "reissueRejected",
      logTag: "reissue-receipt-rejected",
      vars: { notes: "Receipt blurry, please resubmit." },
    });
  });

  it("(c) re-approving a round that is already 'paid' does NOT double-fire the email or re-audit reissue_marked_paid", async () => {
    // Round was already approved earlier — the receipt is being re-saved.
    reissueRow = { ...baseReissue, status: "paid", paidAt: new Date("2024-06-01T00:00:00Z") };

    const res = await request(app)
      .patch("/api/deposits/42")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    // The receipt row update itself still happens & is audited.
    expect(
      auditLogs.find((a) => a.action === "admin_update_deposit_receipt"),
    ).toBeTruthy();
    // …but the reissue-side side effects are skipped because the round is
    // already paid.
    expect(updatedReissuePayloads.find((p) => p.status === "paid")).toBeUndefined();
    expect(auditLogs.find((a) => a.action === "reissue_marked_paid")).toBeUndefined();
    expect(sentEmails).toHaveLength(0);
    expect(sendLocalizedCaseEmail).not.toHaveBeenCalled();
  });

  it("(d) walking back an approval reverts a paid round to awaiting_review and audits 'reissue_paid_reverted'", async () => {
    reissueRow = {
      ...baseReissue,
      status: "paid",
      paidAt: new Date("2024-06-01T00:00:00Z"),
      receiptId: 42,
    };

    const res = await request(app)
      .patch("/api/deposits/42")
      .set(auth)
      .send({ status: "reviewed" });

    expect(res.status).toBe(200);
    const revertUpdate = updatedReissuePayloads.find(
      (p) => p.status === "awaiting_review",
    );
    expect(revertUpdate).toBeTruthy();
    expect(revertUpdate.paidAt).toBeNull();
    expect(
      auditLogs.find((a) => a.action === "reissue_paid_reverted"),
    ).toBeTruthy();
    // Reverting is silent on the user side — no email tag fires.
    expect(sentEmails).toHaveLength(0);
  });

  it("(e) approving a non-reissue receipt (no reissueId) does not touch reissue state or send an email", async () => {
    receiptRow = { ...baseReceipt, reissueId: null };

    const res = await request(app)
      .patch("/api/deposits/42")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(updatedReissuePayloads).toHaveLength(0);
    expect(auditLogs.find((a) => a.action === "reissue_marked_paid")).toBeUndefined();
    expect(sentEmails).toHaveLength(0);
  });

  it("(f) PATCH /api/deposits/:id rejects unauthenticated callers with 401", async () => {
    const res = await request(app)
      .patch("/api/deposits/42")
      .send({ status: "approved" });

    expect(res.status).toBe(401);
    expect(updatedReceiptPayload).toBeNull();
    expect(sentEmails).toHaveLength(0);
    expect(auditLogs.find((a) => a.action === "reissue_marked_paid")).toBeUndefined();
  });

  it("(g) PATCH /api/deposits/:id/status also drives the email + audit on approval", async () => {
    const res = await request(app)
      .patch("/api/deposits/42/status")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(
      auditLogs.find((a) => a.action === "admin_update_deposit_receipt_status"),
    ).toBeTruthy();
    expect(auditLogs.find((a) => a.action === "reissue_marked_paid")).toBeTruthy();
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].tag).toBe("reissue-receipt-approved");
  });

  it("(h) PATCH /api/deposits/:id/status rejects unauthenticated callers with 401", async () => {
    const res = await request(app)
      .patch("/api/deposits/42/status")
      .send({ status: "approved" });

    expect(res.status).toBe(401);
    expect(sentEmails).toHaveLength(0);
  });
});
