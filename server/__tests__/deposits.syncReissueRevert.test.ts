/**
 * Unit tests for the syncReissueFromReceipt revert logic inside the PATCH
 * /api/deposit-receipts/:id handler (server/routes/deposits.ts).
 *
 * The existing deposits.reissueReceipt.test.ts covers the approved→reviewed
 * walk-back (case d). This file focuses on the two additional revert paths
 * called out in the task: approved→pending and rejected→pending.
 *
 * Isolation pattern mirrors deposits.reissueReceipt.test.ts: every storage
 * method and email helper is mocked so no real DB or SMTP is required.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "sync-reissue-revert-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---- captured state --------------------------------------------------------

const auditLogs: any[] = [];
const sentEmails: any[] = [];

let receiptRow: any = null;
let reissueRow: any = null;
let caseRow: any = null;
let updatedReceiptPayload: any = null;
let updatedReissuePayloads: any[] = [];

const sendLocalizedCaseEmail = vi.fn(async () => ({ success: true }));

// ---- mocks -----------------------------------------------------------------

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (_token: string) => ({
      id: "session-revert",
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
  emailService: createEmailServiceMock({ sendLocalizedCaseEmail }),
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async (params: any) => {
    sentEmails.push({ tag: params.tag, to: params.to, caseId: params.caseId });
    await params.send("en");
    return { sent: true };
  }),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

// Import after vi.mock calls.
const { depositsRouter } = await import("../routes/deposits");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/deposits", depositsRouter);
  return app;
}

// ---- fixtures --------------------------------------------------------------

const baseCase = {
  id: "case-revert",
  accessCode: "REVT-0001",
  userName: "Revert User",
  userEmail: "revert@example.com",
};

const baseReceipt = {
  id: 55,
  caseId: "case-revert",
  reissueId: 9,
  status: "approved",
  adminNotes: null,
};

const basePaidReissue = {
  id: 9,
  caseId: "case-revert",
  version: 3,
  reissueFee: "2000 USDT",
  status: "paid",
  receiptId: 55,
  paidAt: new Date("2025-01-15T10:00:00Z"),
};

beforeEach(() => {
  auditLogs.length = 0;
  sentEmails.length = 0;
  updatedReceiptPayload = null;
  updatedReissuePayloads = [];
  receiptRow = { ...baseReceipt };
  reissueRow = { ...basePaidReissue };
  caseRow = { ...baseCase };
  sendLocalizedCaseEmail.mockClear();
});

// ---- tests -----------------------------------------------------------------

describe("syncReissueFromReceipt — revert paths via PATCH /api/deposits/:id", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it(
    "(a) approved→pending: reverts a paid reissue round to awaiting_review, " +
      "clears paidAt, audits reissue_paid_reverted, and sends no email",
    async () => {
      // receipt was approved, reissue round is paid
      receiptRow = { ...baseReceipt, status: "approved" };
      reissueRow = { ...basePaidReissue, status: "paid", receiptId: 55 };

      const res = await request(app)
        .patch("/api/deposits/55")
        .set(auth)
        .send({ status: "pending" });

      expect(res.status).toBe(200);

      // Receipt row status updated to pending.
      expect(updatedReceiptPayload).toMatchObject({ status: "pending" });

      // Reissue round reverted: status=awaiting_review, paidAt cleared.
      const revertUpdate = updatedReissuePayloads.find(
        (p) => p.status === "awaiting_review",
      );
      expect(revertUpdate).toBeTruthy();
      expect(revertUpdate.paidAt).toBeNull();

      // Audit entry for the revert must be present.
      const revertAudit = auditLogs.find(
        (a) => a.action === "reissue_paid_reverted",
      );
      expect(revertAudit).toBeTruthy();
      expect(revertAudit.targetType).toBe("case");
      expect(revertAudit.targetId).toBe("case-revert");

      // Reverting is silent on the user side — no email fires.
      expect(sentEmails).toHaveLength(0);
      expect(sendLocalizedCaseEmail).not.toHaveBeenCalled();
    },
  );

  it(
    "(b) rejected→pending: updates the receipt row to pending, does NOT touch " +
      "a non-paid reissue round, and sends no email",
    async () => {
      // receipt was rejected; reissue round is still awaiting_review (not paid)
      receiptRow = { ...baseReceipt, status: "rejected", reissueId: 9 };
      reissueRow = {
        ...basePaidReissue,
        status: "awaiting_review",
        paidAt: null,
        receiptId: 55,
      };

      const res = await request(app)
        .patch("/api/deposits/55")
        .set(auth)
        .send({ status: "pending" });

      expect(res.status).toBe(200);

      // Receipt row status updated to pending.
      expect(updatedReceiptPayload).toMatchObject({ status: "pending" });

      // Reissue round must NOT be touched — it was never paid.
      expect(
        updatedReissuePayloads.find((p) => p.status === "awaiting_review"),
      ).toBeUndefined();
      expect(
        auditLogs.find((a) => a.action === "reissue_paid_reverted"),
      ).toBeUndefined();

      // No email fires either direction.
      expect(sentEmails).toHaveLength(0);
      expect(sendLocalizedCaseEmail).not.toHaveBeenCalled();
    },
  );

  it(
    "(c) approved→pending on a receipt whose reissue round belongs to a " +
      "different receipt: revert does NOT fire (round.receiptId guard)",
    async () => {
      // Same paid round, but the round was paid via receipt 99, not 55.
      receiptRow = { ...baseReceipt, status: "approved" };
      reissueRow = { ...basePaidReissue, status: "paid", receiptId: 99 };

      const res = await request(app)
        .patch("/api/deposits/55")
        .set(auth)
        .send({ status: "pending" });

      expect(res.status).toBe(200);

      // Receipt row update still happens.
      expect(updatedReceiptPayload).toMatchObject({ status: "pending" });

      // But the round is NOT reverted because round.receiptId !== 55.
      expect(
        updatedReissuePayloads.find((p) => p.status === "awaiting_review"),
      ).toBeUndefined();
      expect(
        auditLogs.find((a) => a.action === "reissue_paid_reverted"),
      ).toBeUndefined();
      expect(sentEmails).toHaveLength(0);
    },
  );

  it(
    "(d) approved→pending on a cancelled reissue round: syncReissueFromReceipt " +
      "exits early, round is unchanged",
    async () => {
      receiptRow = { ...baseReceipt, status: "approved" };
      reissueRow = { ...basePaidReissue, status: "cancelled", paidAt: null };

      const res = await request(app)
        .patch("/api/deposits/55")
        .set(auth)
        .send({ status: "pending" });

      expect(res.status).toBe(200);

      expect(updatedReissuePayloads).toHaveLength(0);
      expect(
        auditLogs.find((a) => a.action === "reissue_paid_reverted"),
      ).toBeUndefined();
      expect(sentEmails).toHaveLength(0);
    },
  );

  it(
    "(e) approved→pending when getLetterReissueById returns null (orphaned FK): " +
      "handler returns 200, receipt row is updated, no updateLetterReissue call, " +
      "no reissue_paid_reverted audit",
    async () => {
      // Receipt references a reissueId that no longer exists in the DB.
      receiptRow = { ...baseReceipt, status: "approved", reissueId: 9 };
      reissueRow = null; // simulates a deleted or never-inserted reissue row

      const res = await request(app)
        .patch("/api/deposits/55")
        .set(auth)
        .send({ status: "pending" });

      // Handler must still succeed — the missing reissue row is not a fatal error.
      expect(res.status).toBe(200);

      // Receipt row update happened normally.
      expect(updatedReceiptPayload).toMatchObject({ status: "pending" });

      // No reissue mutations: updateLetterReissue was never called.
      expect(updatedReissuePayloads).toHaveLength(0);

      // No audit entry for the revert — there was nothing to revert.
      expect(
        auditLogs.find((a) => a.action === "reissue_paid_reverted"),
      ).toBeUndefined();

      // No email fires — the orphaned-FK early-return is silent.
      expect(sentEmails).toHaveLength(0);
      expect(sendLocalizedCaseEmail).not.toHaveBeenCalled();
    },
  );
});
