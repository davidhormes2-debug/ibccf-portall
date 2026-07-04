import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---- Regression coverage for Task #158 / #160 -----------------------------
//
// The retry handler at POST /api/cases/:id/email-audit-logs/:auditId/retry
// must resolve the source record from `audit_logs.metadata` (stamped at the
// moment of the original send) instead of "the latest matching row on the
// case". These tests stand up multiple matching rows per case and assert
// that retrying the OLDER row's failure resends the OLDER row's content.

const TEST_ADMIN_USERNAME = "retry-by-audit-id-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

const auditLogs: any[] = [];
const sentEmails: any[] = [];

let caseRow: any = null;
let auditRows: Record<number, any> = {};
let adminMessagesById: Record<number, any> = {};
let adminMessagesByCase: Record<string, any[]> = {};
let declarationsById: Record<number, any> = {};
let declarationsByCase: Record<string, any[]> = {};
let docRequestsById: Record<number, any> = {};
let docRequestsByCase: Record<string, any[]> = {};
let depositReceiptsById: Record<number, any> = {};
let depositReceiptsByCase: Record<string, any[]> = {};
let letterReissuesById: Record<number, any> = {};

const sendLocalizedCaseEmail = vi.fn(async (_arg?: unknown) => ({ success: true }));

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
    getCaseById: vi.fn(async (_id: string) => caseRow),
    getAuditLogById: vi.fn(async (id: number) => auditRows[id] ?? null),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    getAdminMessageById: vi.fn(async (id: number) => adminMessagesById[id] ?? null),
    getAdminMessagesByCaseId: vi.fn(async (caseId: string) => adminMessagesByCase[caseId] ?? []),
    getDeclarationSubmissionById: vi.fn(async (id: number) => declarationsById[id] ?? null),
    getDeclarationSubmissionsByCaseId: vi.fn(async (caseId: string) => declarationsByCase[caseId] ?? []),
    getDocumentRequestById: vi.fn(async (id: number) => docRequestsById[id] ?? null),
    getDocumentRequestsByCaseId: vi.fn(async (caseId: string) => docRequestsByCase[caseId] ?? []),
    getDepositReceiptById: vi.fn(async (id: number) => depositReceiptsById[id] ?? null),
    getDepositReceiptsByCaseId: vi.fn(async (caseId: string) => depositReceiptsByCase[caseId] ?? []),
    getLetterReissueById: vi.fn(async (id: number) => letterReissuesById[id] ?? null),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  }),
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendLocalizedCaseEmail,
  }),
}));

// Capture each call AND expose a per-call promise so the test can await
// the background fire-and-forget dispatch the retry handler kicks off
// after the JSON response has already been sent.
let dispatchResolvers: Array<() => void> = [];

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async (params: any) => {
    sentEmails.push({
      tag: params.tag,
      to: params.to,
      caseId: params.caseId,
      adminUser: params.adminUser,
      metadata: params.metadata,
    });
    try {
      await params.send("en");
    } finally {
      const r = dispatchResolvers.shift();
      if (r) r();
    }
    return { sent: true };
  }),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

// Build the deferred BEFORE issuing the request so the resolver is in the
// queue by the time the fire-and-forget background dispatch runs.
function armDispatch(): Promise<void> {
  return new Promise<void>((resolve) => {
    dispatchResolvers.push(resolve);
  });
}

const baseCase = {
  id: "case-1",
  accessCode: "ABCD-1234",
  userName: "Test User",
  userEmail: "user@example.com",
  preferredLocale: "en",
  payoutWalletAddress: null,
  payoutWalletAsset: null,
  payoutWalletNetwork: null,
};

beforeEach(() => {
  auditLogs.length = 0;
  sentEmails.length = 0;
  caseRow = { ...baseCase };
  auditRows = {};
  adminMessagesById = {};
  adminMessagesByCase = {};
  declarationsById = {};
  declarationsByCase = {};
  docRequestsById = {};
  docRequestsByCase = {};
  depositReceiptsById = {};
  depositReceiptsByCase = {};
  letterReissuesById = {};
  dispatchResolvers = [];
  sendLocalizedCaseEmail.mockClear();
});

const auth = { Authorization: "Bearer test-token" };

describe("POST /api/cases/:id/email-audit-logs/:auditId/retry — Task #158 metadata-driven retry", () => {
  const app = buildApp();

  it("(a) two compliance messages — retrying the OLDER failure resends the OLDER message body", async () => {
    const older = {
      id: 101,
      caseId: "case-1",
      category: "request",
      title: "First message",
      body: "FIRST body — please respond.",
    };
    const newer = {
      id: 102,
      caseId: "case-1",
      category: "alert",
      title: "Second message",
      body: "SECOND body — different content.",
    };
    adminMessagesById[101] = older;
    adminMessagesById[102] = newer;
    // getAdminMessagesByCaseId returns newest-first per existing code (`msgs?.[0]`).
    adminMessagesByCase["case-1"] = [newer, older];

    auditRows[5001] = {
      id: 5001,
      targetType: "case",
      targetId: "case-1",
      action: "email_compliance-message_failed",
      metadata: { adminMessageId: 101 },
    };

    const dispatched = armDispatch();
    const res = await request(app)
      .post("/api/cases/case-1/email-audit-logs/5001/retry")
      .set(auth)
      .send({});
    expect(res.status).toBe(200);

    await dispatched;

    expect(sendLocalizedCaseEmail).toHaveBeenCalledTimes(1);
    expect(sendLocalizedCaseEmail.mock.calls[0][0]).toMatchObject({
      logTag: "compliance-message",
      templateKey: "complianceMessage",
      vars: {
        category: "request",
        title: "First message",
        body: "FIRST body — please respond.",
      },
    });
    // Crucially, the NEWER row's body must NOT leak in.
    expect((sendLocalizedCaseEmail.mock.calls[0] as any[])[0].vars.body).not.toContain(
      "SECOND",
    );
  });

  it("(b) two rejected declaration submissions — retry resends the OLDER reviewer notes", async () => {
    const older = {
      id: 201,
      caseId: "case-1",
      status: "rejected",
      reviewerNotes: "OLDER rejection notes",
    };
    const newer = {
      id: 202,
      caseId: "case-1",
      status: "rejected",
      reviewerNotes: "NEWER rejection notes",
    };
    declarationsById[201] = older;
    declarationsById[202] = newer;
    declarationsByCase["case-1"] = [newer, older];

    auditRows[5002] = {
      id: 5002,
      targetType: "case",
      targetId: "case-1",
      action: "email_declaration-rejected_failed",
      metadata: {
        declarationSubmissionId: 201,
        reviewerNotes: "OLDER rejection notes",
      },
    };

    const dispatched = armDispatch();
    const res = await request(app)
      .post("/api/cases/case-1/email-audit-logs/5002/retry")
      .set(auth)
      .send({});
    expect(res.status).toBe(200);

    await dispatched;

    expect(sendLocalizedCaseEmail).toHaveBeenCalledTimes(1);
    expect(sendLocalizedCaseEmail.mock.calls[0][0]).toMatchObject({
      logTag: "declaration-rejected",
      templateKey: "declarationRejected",
      vars: { notes: "OLDER rejection notes" },
    });
    expect((sendLocalizedCaseEmail.mock.calls[0] as any[])[0].vars.notes).not.toContain(
      "NEWER",
    );
  });

  it("(c) two pending document requests — retry resends the OLDER request's documentType + description", async () => {
    const older = {
      id: 301,
      caseId: "case-1",
      status: "pending",
      documentType: "Proof of Income",
      description: "OLDER description",
      deadline: null,
      adminNotes: null,
    };
    const newer = {
      id: 302,
      caseId: "case-1",
      status: "pending",
      documentType: "Source of Funds",
      description: "NEWER description",
      deadline: null,
      adminNotes: null,
    };
    docRequestsById[301] = older;
    docRequestsById[302] = newer;
    // getDocumentRequestsByCaseId order doesn't matter here because the fallback
    // uses .find(pending) — the metadata path is what we're proving.
    docRequestsByCase["case-1"] = [newer, older];

    auditRows[5003] = {
      id: 5003,
      targetType: "case",
      targetId: "case-1",
      action: "email_document-requested_failed",
      metadata: { documentRequestId: 301 },
    };

    const dispatched = armDispatch();
    const res = await request(app)
      .post("/api/cases/case-1/email-audit-logs/5003/retry")
      .set(auth)
      .send({});
    expect(res.status).toBe(200);

    await dispatched;

    expect(sendLocalizedCaseEmail).toHaveBeenCalledTimes(1);
    expect(sendLocalizedCaseEmail.mock.calls[0][0]).toMatchObject({
      logTag: "document-requested",
      templateKey: "documentRequested",
      vars: {
        documentType: "Proof of Income",
        description: "OLDER description",
        deadline: "",
      },
    });
  });

  it("(d) one approved + one rejected reissue receipt — retry sends the matching one with the snapshotted round version/fee", async () => {
    const approvedReceipt = {
      id: 401,
      caseId: "case-1",
      reissueId: 71,
      status: "approved",
      adminNotes: null,
    };
    const rejectedReceipt = {
      id: 402,
      caseId: "case-1",
      reissueId: 72,
      status: "rejected",
      adminNotes: "Receipt is blurry, please resubmit.",
    };
    depositReceiptsById[401] = approvedReceipt;
    depositReceiptsById[402] = rejectedReceipt;
    depositReceiptsByCase["case-1"] = [rejectedReceipt, approvedReceipt];

    // Note: round 71's *current* fee/version are intentionally different
    // from what the original email captured, so we can prove the retry
    // uses the audit-row snapshot, not the live round.
    letterReissuesById[71] = {
      id: 71,
      caseId: "case-1",
      version: 9,
      reissueFee: "9999 USDT",
      status: "paid",
    };
    letterReissuesById[72] = {
      id: 72,
      caseId: "case-1",
      version: 4,
      reissueFee: "1500 USDT",
      status: "awaiting_review",
    };

    auditRows[5004] = {
      id: 5004,
      targetType: "case",
      targetId: "case-1",
      action: "email_reissue-receipt-approved_failed",
      metadata: {
        depositReceiptId: 401,
        letterReissueId: 71,
        version: 3,
        reissueFee: "1500 USDT",
      },
    };

    const dispatched = armDispatch();
    let res = await request(app)
      .post("/api/cases/case-1/email-audit-logs/5004/retry")
      .set(auth)
      .send({});
    expect(res.status).toBe(200);

    await dispatched;

    expect(sendLocalizedCaseEmail).toHaveBeenCalledTimes(1);
    expect(sendLocalizedCaseEmail.mock.calls[0][0]).toMatchObject({
      logTag: "reissue-receipt-approved",
      templateKey: "reissueApproved",
      vars: { version: 3, reissueFee: "1500 USDT" },
    });
    // Live round values (9 / "9999 USDT") must NOT leak in.
    expect((sendLocalizedCaseEmail.mock.calls[0] as any[])[0].vars).not.toMatchObject({
      version: 9,
    });

    // ---- Now retry the *rejected* row's audit; must NOT pick up the
    // approved receipt that lives on the same case.
    auditRows[5005] = {
      id: 5005,
      targetType: "case",
      targetId: "case-1",
      action: "email_reissue-receipt-rejected_failed",
      metadata: {
        depositReceiptId: 402,
        letterReissueId: 72,
        notes: "Receipt is blurry, please resubmit.",
      },
    };

    const dispatched2 = armDispatch();
    res = await request(app)
      .post("/api/cases/case-1/email-audit-logs/5005/retry")
      .set(auth)
      .send({});
    expect(res.status).toBe(200);

    await dispatched2;

    expect(sendLocalizedCaseEmail).toHaveBeenCalledTimes(2);
    expect(sendLocalizedCaseEmail.mock.calls[1][0]).toMatchObject({
      logTag: "reissue-receipt-rejected",
      templateKey: "reissueRejected",
      vars: { notes: "Receipt is blurry, please resubmit." },
    });
  });
});
