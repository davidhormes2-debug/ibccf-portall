import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "stamp-duty-test-admin";
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
// Mirrors the isolation pattern in deposits.reissueReceipt.test.ts: every
// module the cases router pulls in is mocked so the stamp-duty handlers run
// without a real DB or SMTP. We intercept sendCaseEmailWithAudit at the
// module level so we can assert the exact `tag` passed in
// (`stamp_duty_approved` / `stamp_duty_rejected`) without re-running the
// real audit helper.

const auditLogs: any[] = [];
const sentEmails: any[] = [];

let receiptRow: any = null;
let caseRow: any = null;
let updatedReceiptPayload: any = null;
const caseUpdates: any[] = [];

const sendLocalizedCaseEmail = vi.fn(async (_arg?: unknown) => ({ success: true }));

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
    getStampDutyReceiptById: vi.fn(async () => receiptRow),
    updateStampDutyReceipt: vi.fn(async (_id: number, data: any) => {
      updatedReceiptPayload = data;
      receiptRow = { ...(receiptRow ?? {}), ...data };
      return receiptRow;
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

// Import AFTER vi.mock calls.
const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const baseCase = {
  id: "case-1",
  accessCode: "ABCD-1234",
  userName: "Test User",
  userEmail: "user@example.com",
  stampDutyStatus: "awaiting_admin_approval",
};

const baseReceipt = {
  id: 99,
  caseId: "case-1",
  status: "pending",
  amountUsdt: "250",
  adminNotes: null,
};

beforeEach(() => {
  auditLogs.length = 0;
  sentEmails.length = 0;
  caseUpdates.length = 0;
  updatedReceiptPayload = null;
  receiptRow = { ...baseReceipt };
  caseRow = { ...baseCase };
  sendLocalizedCaseEmail.mockClear();
});

const auth = { Authorization: "Bearer test-token" };

describe("POST /api/cases/:id/stamp-duty/receipts/:receiptId/approve", () => {
  const app = buildApp();

  it("flips case.stampDutyStatus to 'approved' and stamps approver/approvedAt", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // Receipt row was marked approved with reviewer metadata.
    expect(updatedReceiptPayload).toMatchObject({
      status: "approved",
      reviewedBy: "Admin",
    });
    expect(updatedReceiptPayload.reviewedAt).toBeInstanceOf(Date);

    // Case row was flipped to approved with approver stamps & cleared rejection reason.
    expect(caseUpdates).toHaveLength(1);
    expect(caseUpdates[0]).toMatchObject({
      stampDutyStatus: "approved",
      stampDutyApprovedBy: "Admin",
      stampDutyRejectionReason: null,
    });
    expect(caseUpdates[0].stampDutyApprovedAt).toBeInstanceOf(Date);

    // Audit log written.
    const approvedAudit = auditLogs.find((a) => a.action === "stamp_duty_approved");
    expect(approvedAudit).toBeTruthy();
    expect(approvedAudit.targetType).toBe("case");
    expect(approvedAudit.targetId).toBe("case-1");

    // Best-effort localised email fired with the right tag.
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({
      tag: "stamp_duty_approved",
      to: "user@example.com",
      caseId: "case-1",
    });
    expect(sendLocalizedCaseEmail).toHaveBeenCalledTimes(1);
    expect(sendLocalizedCaseEmail.mock.calls[0][0]).toMatchObject({
      templateKey: "stampDutyApproved",
      logTag: "stamp-duty-approved",
    });
  });

  it("returns 409 on a receipt that is already approved and does NOT re-audit or re-send email", async () => {
    receiptRow = { ...baseReceipt, status: "approved" };

    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "stamp_duty_already_reviewed",
      status: "approved",
    });
    expect(updatedReceiptPayload).toBeNull();
    expect(caseUpdates).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
    expect(sendLocalizedCaseEmail).not.toHaveBeenCalled();
  });

  it("returns 409 on a receipt that was already rejected (idempotency across terminal states)", async () => {
    receiptRow = { ...baseReceipt, status: "rejected" };

    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ status: "rejected" });
    expect(caseUpdates).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 404 when the URL caseId does not match the receipt's caseId", async () => {
    receiptRow = { ...baseReceipt, caseId: "other-case" };

    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Receipt not found" });
    expect(updatedReceiptPayload).toBeNull();
    expect(caseUpdates).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 401 when called without an admin bearer token", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/approve")
      .send({});

    expect(res.status).toBe(401);
    expect(caseUpdates).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 400 when the receiptId is not a finite number", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/not-a-number/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid receipt id" });
    expect(updatedReceiptPayload).toBeNull();
    expect(caseUpdates).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 400 when adminNotes is not a string (Zod body validation)", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/approve")
      .set(auth)
      .send({ adminNotes: 12345 });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    expect(updatedReceiptPayload).toBeNull();
    expect(caseUpdates).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 400 when adminNotes exceeds the 1000-char Zod bound", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/approve")
      .set(auth)
      .send({ adminNotes: "x".repeat(1001) });

    expect(res.status).toBe(400);
    expect(updatedReceiptPayload).toBeNull();
    expect(caseUpdates).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });
});

describe("POST /api/cases/:id/stamp-duty/receipts/:receiptId/reject", () => {
  const app = buildApp();

  it("writes the reason to cases.stampDutyRejectionReason and lets the user re-upload", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/reject")
      .set(auth)
      .send({ adminNotes: "Receipt is illegible, please re-upload a clearer copy." });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // Receipt was marked rejected with the admin notes.
    expect(updatedReceiptPayload).toMatchObject({
      status: "rejected",
      adminNotes: "Receipt is illegible, please re-upload a clearer copy.",
      reviewedBy: "Admin",
    });

    // Case row was flipped to rejected with the reason recorded — this is
    // what allows the portal to re-open the upload form for the user.
    expect(caseUpdates).toHaveLength(1);
    expect(caseUpdates[0]).toEqual({
      stampDutyStatus: "rejected",
      stampDutyRejectionReason: "Receipt is illegible, please re-upload a clearer copy.",
    });

    // Audit log + localised email both fire with the forwarded reason.
    const rejectedAudit = auditLogs.find((a) => a.action === "stamp_duty_rejected");
    expect(rejectedAudit).toBeTruthy();
    expect(rejectedAudit.targetId).toBe("case-1");

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({
      tag: "stamp_duty_rejected",
      to: "user@example.com",
      caseId: "case-1",
    });
    expect(sendLocalizedCaseEmail).toHaveBeenCalledTimes(1);
    expect(sendLocalizedCaseEmail.mock.calls[0][0]).toMatchObject({
      templateKey: "stampDutyRejected",
      logTag: "stamp-duty-rejected",
      vars: { reason: "Receipt is illegible, please re-upload a clearer copy." },
    });
  });

  it("returns 409 on a receipt that is already rejected and does NOT re-audit or re-send email", async () => {
    receiptRow = { ...baseReceipt, status: "rejected" };

    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/reject")
      .set(auth)
      .send({ adminNotes: "second look" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "stamp_duty_already_reviewed",
      status: "rejected",
    });
    expect(updatedReceiptPayload).toBeNull();
    expect(caseUpdates).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 409 on a receipt that was already approved (cannot reject after approval)", async () => {
    receiptRow = { ...baseReceipt, status: "approved" };

    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/reject")
      .set(auth)
      .send({ adminNotes: "wait" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ status: "approved" });
    expect(caseUpdates).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 404 when the URL caseId does not match the receipt's caseId", async () => {
    receiptRow = { ...baseReceipt, caseId: "other-case" };

    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/reject")
      .set(auth)
      .send({ adminNotes: "n/a" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Receipt not found" });
    expect(updatedReceiptPayload).toBeNull();
    expect(caseUpdates).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 401 when called without an admin bearer token", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/reject")
      .send({ adminNotes: "blocked" });

    expect(res.status).toBe(401);
    expect(caseUpdates).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 400 when the receiptId is not a finite number", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/not-a-number/reject")
      .set(auth)
      .send({ adminNotes: "n/a" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid receipt id" });
    expect(updatedReceiptPayload).toBeNull();
    expect(caseUpdates).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 400 when adminNotes is not a string (Zod body validation)", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/reject")
      .set(auth)
      .send({ adminNotes: { not: "a string" } });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    expect(updatedReceiptPayload).toBeNull();
    expect(caseUpdates).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 400 when adminNotes exceeds the 1000-char Zod bound", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/stamp-duty/receipts/99/reject")
      .set(auth)
      .send({ adminNotes: "x".repeat(1001) });

    expect(res.status).toBe(400);
    expect(updatedReceiptPayload).toBeNull();
    expect(caseUpdates).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });
});
