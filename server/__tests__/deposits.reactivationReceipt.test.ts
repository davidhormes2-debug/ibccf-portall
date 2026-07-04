import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "reactivation-receipt-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---- Test state ----------------------------------------------------------

const auditLogs: any[] = [];
let receiptRow: any = null;
let caseRow: any = null;
let updatedReceiptPayload: any = null;
let updatedCasePayload: any = null;

// Controllable getCaseByAccessCode so collision-retry tests can simulate
// a collision on attempt 0 and succeed on attempt 1.
let getCaseByAccessCodeResponses: (any | undefined)[] = [];
let getCaseByAccessCodeCallCount = 0;

const sendAccountReactivationNotification = vi.fn(async () => true);
const deleteSessionsByCaseId = vi.fn(async () => {});
const notifyUser = vi.fn(async () => {});
const createAdminMessage = vi.fn(async () => {});

// ---- Module mocks --------------------------------------------------------

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
    getLetterReissueById: vi.fn(async () => null),
    getCaseById: vi.fn(async () => caseRow),
    updateCase: vi.fn(async (_id: string, data: any) => {
      updatedCasePayload = data;
      return { ...(caseRow ?? {}), ...data };
    }),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    createAdminMessage: vi.fn(async (data: any) => {
      createAdminMessage(data);
      return { id: 1, ...data };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    // Controllable collision checker: pull next response from the queue;
    // fall back to undefined (no collision) when queue is empty.
    getCaseByAccessCode: vi.fn(async (_code: string) => {
      const resp = getCaseByAccessCodeResponses[getCaseByAccessCodeCallCount] ?? undefined;
      getCaseByAccessCodeCallCount++;
      return resp;
    }),
  }),
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendAccountReactivationNotification,
  }),
}));

vi.mock("../services/session-store", () => ({
  deleteSessionsByCaseId,
}));

vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyUser,
  },
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
  id: "case-reactivate",
  accessCode: "OLD-CODE-0001",
  userName: "Disabled User",
  userEmail: "disabled@example.com",
  isDisabled: true,
};

const baseReactivationReceipt = {
  id: 99,
  caseId: "case-reactivate",
  reissueId: null,
  category: "reissue",
  notes: "Reactivation deposit receipt",
  status: "pending",
  adminNotes: null,
};

beforeEach(() => {
  auditLogs.length = 0;
  updatedReceiptPayload = null;
  updatedCasePayload = null;
  receiptRow = { ...baseReactivationReceipt };
  caseRow = { ...baseCase };
  sendAccountReactivationNotification.mockClear();
  deleteSessionsByCaseId.mockClear();
  notifyUser.mockClear();
  createAdminMessage.mockClear();
  // Reset collision-checker queue — default: no collisions.
  getCaseByAccessCodeResponses = [];
  getCaseByAccessCodeCallCount = 0;
});

const auth = { Authorization: "Bearer test-token" };

describe("PATCH /api/deposits/:id — account reactivation via receipt approval", () => {
  const app = buildApp();

  it("(a) approving a reactivation receipt re-enables the account atomically and returns accountReactivated:true", async () => {
    const res = await request(app)
      .patch("/api/deposits/99")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.accountReactivated).toBe(true);
    expect(res.body.newAccessCode).toBeTruthy();
    expect(typeof res.body.newAccessCode).toBe("string");
    expect(res.body.hasEmail).toBe(true);
  });

  it("(b) the case is updated with isDisabled=false and a new access code in the same transaction", async () => {
    await request(app)
      .patch("/api/deposits/99")
      .set(auth)
      .send({ status: "approved" });

    expect(updatedCasePayload).toBeTruthy();
    expect(updatedCasePayload.isDisabled).toBe(false);
    expect(updatedCasePayload.accessCode).toBeTruthy();
    expect(typeof updatedCasePayload.accessCode).toBe("string");
    expect(updatedCasePayload.accessCode).toHaveLength(12);
    expect(updatedCasePayload.forceLogoutAt).toBeNull();
    expect(updatedCasePayload.reactivatedAt).toBeInstanceOf(Date);
  });

  it("(c) an enable_user_access audit log is emitted", async () => {
    await request(app)
      .patch("/api/deposits/99")
      .set(auth)
      .send({ status: "approved" });

    const reactivationAudit = auditLogs.find((a) => a.action === "enable_user_access");
    expect(reactivationAudit).toBeTruthy();
    expect(reactivationAudit.targetType).toBe("case");
    expect(reactivationAudit.targetId).toBe("case-reactivate");
    expect(reactivationAudit.newValue).toContain("receipt 99");
  });

  it("(d) the receipt update audit and reactivation audit both land", async () => {
    await request(app)
      .patch("/api/deposits/99")
      .set(auth)
      .send({ status: "approved" });

    expect(auditLogs.find((a) => a.action === "admin_update_deposit_receipt")).toBeTruthy();
    expect(auditLogs.find((a) => a.action === "enable_user_access")).toBeTruthy();
  });

  it("(e) approving a non-reactivation receipt (has reissueId) does NOT trigger reactivation", async () => {
    // A receipt linked to a letter-reissue round — should NOT unlock the account.
    receiptRow = { ...baseReactivationReceipt, reissueId: 7 };

    const res = await request(app)
      .patch("/api/deposits/99")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.accountReactivated).toBeUndefined();
    expect(updatedCasePayload).toBeNull();
  });

  it("(f) approving a reissue receipt when account is NOT disabled does NOT trigger reactivation", async () => {
    caseRow = { ...baseCase, isDisabled: false };

    const res = await request(app)
      .patch("/api/deposits/99")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.accountReactivated).toBeUndefined();
    expect(updatedCasePayload).toBeNull();
  });

  it("(g) rejecting a reactivation receipt does NOT unlock the account", async () => {
    const res = await request(app)
      .patch("/api/deposits/99")
      .set(auth)
      .send({ status: "rejected" });

    expect(res.status).toBe(200);
    expect(res.body.accountReactivated).toBeUndefined();
    expect(updatedCasePayload).toBeNull();
    expect(auditLogs.find((a) => a.action === "enable_user_access")).toBeUndefined();
  });

  it("(h) reactivation does not fire when the receipt category is 'activation' (not reissue)", async () => {
    receiptRow = { ...baseReactivationReceipt, category: "activation" };

    const res = await request(app)
      .patch("/api/deposits/99")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.accountReactivated).toBeUndefined();
    expect(updatedCasePayload).toBeNull();
  });

  it("(i) the new access code contains only allowed characters and is 12 chars long", async () => {
    const res = await request(app)
      .patch("/api/deposits/99")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    const code: string = res.body.newAccessCode;
    expect(code).toHaveLength(12);
    // Only digits from the allowed charset
    expect(code).toMatch(/^[0-9]+$/);
  });

  it("(j) PATCH /api/deposits/:id/status also triggers reactivation when appropriate", async () => {
    const res = await request(app)
      .patch("/api/deposits/99/status")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.accountReactivated).toBe(true);
    expect(updatedCasePayload?.isDisabled).toBe(false);
    expect(auditLogs.find((a) => a.action === "enable_user_access")).toBeTruthy();
  });

  it("(k) stored-vs-emailed contract: the code written to cases.accessCode equals the code sent by email", async () => {
    const res = await request(app)
      .patch("/api/deposits/99")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);

    // The email is sent asynchronously after the response — flush microtasks.
    await new Promise((r) => setTimeout(r, 10));

    expect(sendAccountReactivationNotification).toHaveBeenCalledOnce();
    const emailedCode: string = sendAccountReactivationNotification.mock.calls[0][2];
    const storedCode: string = updatedCasePayload.accessCode;

    expect(emailedCode).toBeTruthy();
    expect(storedCode).toBeTruthy();
    expect(emailedCode).toBe(storedCode);
  });

  it("(l) collision-retry: retries when first candidate already exists on another case", async () => {
    // Simulate: attempt 0 → collision, attempt 1 → unique.
    getCaseByAccessCodeResponses = [
      { id: "other-case", accessCode: "COLLISION1" }, // attempt 0: taken
      undefined,                                       // attempt 1: free
    ];

    const res = await request(app)
      .patch("/api/deposits/99")
      .set(auth)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.accountReactivated).toBe(true);
    // Two calls were made to the collision checker.
    expect(getCaseByAccessCodeCallCount).toBe(2);
    // The code that ended up stored and emailed is valid.
    expect(updatedCasePayload.accessCode).toMatch(/^[0-9]{12}$/);
  });
});
