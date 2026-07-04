import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// Task #148 — wraps the remaining admin write paths in
// storage.runInTransaction so a paired audit-log failure rolls back
// the row mutation. Mirrors the staged/committed mock pattern from
// adminMutationTransactionsTask144.test.ts.

type Staged = Record<string, unknown>;
const auditLogs: any[] = [];
const committed: Staged = {};
let staged: Staged = {};
let auditShouldThrow = false;

let caseRow: any = null;
let activeReissue: any = null;
let caseLetter: any = null;
let certPaymentRow: any = null;
let stampReceiptRow: any = null;
let priorNda: any = null;
let docRequestRow: any = null;
let depositReceiptRow: any = null;

function commitStaged() {
  for (const [k, v] of Object.entries(staged)) committed[k] = v;
  staged = {};
}

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-current",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getActiveAdminSessions: vi.fn(async () => [
      { id: "session-current" },
      { id: "session-other" },
    ]),
    createAuditLog: vi.fn(async (entry: any) => {
      if (auditShouldThrow) throw new Error("forced audit failure");
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      try {
        const r = await fn({});
        commitStaged();
        return r;
      } catch (err) {
        staged = {};
        throw err;
      }
    }),

    // --- admin sessions ---
    revokeAdminSession: vi.fn(async (id: string, reason?: string) => {
      staged.adminSession = { id, isActive: false, revokedReason: reason };
    }),
    revokeAllAdminSessions: vi.fn(async () => {
      staged.adminSession = { bulk: true, count: 1 };
      return 1;
    }),

    // --- cases ---
    getCaseById: vi.fn(async () => caseRow),
    updateCase: vi.fn(async (id: string, data: any) => {
      const row = { ...(caseRow ?? { id }), ...data };
      staged.case = row;
      return row;
    }),
    invalidateAllUserSessions: vi.fn(async () => {
      staged.userSessions = { invalidated: true };
    }),

    // --- letter reissue ---
    getActiveLetterReissue: vi.fn(async () => activeReissue),
    getCaseLetterByCaseId: vi.fn(async () => caseLetter),
    createOrUpdateCaseLetter: vi.fn(async (caseId: string, data: any) => {
      const row = { caseId, ...(caseLetter ?? {}), ...data };
      staged.letter = row;
      return row;
    }),
    createLetterReissue: vi.fn(async (data: any) => {
      const row = { id: 99, ...data };
      staged.reissue = row;
      return row;
    }),
    updateLetterReissue: vi.fn(async (id: number, data: any) => {
      const row = { ...(activeReissue ?? { id }), ...data };
      staged.reissue = row;
      return row;
    }),

    // --- mirror tokens ---
    deleteExpiredMirrorTokens: vi.fn(async () => 0),
    createMirrorToken: vi.fn(async (data: any) => {
      staged.mirrorToken = data;
      return data;
    }),

    // --- certificate fee payments ---
    getCertificateFeePaymentById: vi.fn(async () => certPaymentRow),
    updateCertificateFeePayment: vi.fn(async (id: number, data: any) => {
      const row = { ...(certPaymentRow ?? { id }), ...data };
      staged.certPayment = row;
      return row;
    }),

    // --- stamp duty receipts ---
    getStampDutyReceiptById: vi.fn(async () => stampReceiptRow),
    updateStampDutyReceipt: vi.fn(async (id: number, data: any) => {
      const row = { ...(stampReceiptRow ?? { id }), ...data };
      staged.stampReceipt = row;
      return row;
    }),

    // --- NDA / seal override ---
    getCaseNdaByCaseId: vi.fn(async () => priorNda),

    // --- document requests ---
    getDocumentRequestById: vi.fn(async () => docRequestRow),
    getDocumentRequestsByCaseId: vi.fn(async () => []),
    createDocumentRequest: vi.fn(async (data: any) => {
      const row = { id: 555, ...data };
      staged.docRequest = row;
      return row;
    }),
    updateDocumentRequest: vi.fn(async (id: number, data: any) => {
      const row = { ...(docRequestRow ?? { id }), ...data };
      staged.docRequest = row;
      return row;
    }),

    // --- deposit receipts ---
    updateDepositReceipt: vi.fn(async (id: number, data: any) => {
      const row = { ...(depositReceiptRow ?? { id }), ...data };
      staged.depositReceipt = row;
      return row;
    }),

    // --- withdrawal activation ---
    getActiveWithdrawalSecurityToken: vi.fn(async () => null),
  }),
}));

vi.mock("../db", () => ({
  db: {},
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async (id: string, data: any) => {
      const row = { ...(caseRow ?? { id }), ...data };
      staged.case = row;
      return row;
    }),
  },
}));

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async () => true),
}));

vi.mock("../routes/middleware", async () => ({
  checkAdminAuth: (req: any, _res: any, next: any) => {
    req.admin = { username: "admin" };
    req.adminUsername = "admin";
    next();
  },
  isValidAdminToken: vi.fn(async () => true),
  invalidateBlockedIpsCache: vi.fn(),
  normalizeIp: (ip: string) => ip,
  getClientIp: () => "127.0.0.1",
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendLocalizedCaseEmail: vi.fn(async () => ({ success: true })),
    sendNewDeclarationCodeNotification: vi.fn(async () => true),
    sendDeclarationAccessEmail: vi.fn(async () => ({ success: true })),
  }),
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async () => ({ sent: true })),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

vi.mock("../services/NotificationService", () => ({
  notificationService: { notifyAdmin: vi.fn(), notifyUser: vi.fn() },
}));

vi.mock("../services/session-store", () => ({
  validateSession: vi.fn(async () => null),
  deleteSessionsByCaseId: vi.fn(async () => 0),
  createSession: vi.fn(async () => "portal-session-token"),
}));

const { adminRouter, adminSessionsRouter } = await import("../routes/admin");
const { casesRouter } = await import("../routes/cases");
const { registerCaseDocumentRoutes, documentRequestsRouter } = await import(
  "../routes/content"
);
const { registerCaseWithdrawalActivationRoutes } = await import(
  "../routes/withdrawalActivation"
);
const { Router } = await import("express");

function buildApp(mount: (app: express.Express) => void) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.set("trust proxy", true);
  mount(app);
  return app;
}

beforeEach(() => {
  auditLogs.length = 0;
  for (const k of Object.keys(committed)) delete committed[k];
  staged = {};
  auditShouldThrow = false;
  caseRow = {
    id: "case-1",
    accessCode: "ACCESS123",
    userEmail: null,
    userName: null,
    sealedAt: new Date(),
    preferredLocale: "en",
  };
  activeReissue = { id: 7, caseId: "case-1", version: 1, status: "awaiting_deposit" };
  caseLetter = { caseId: "case-1", letterVersion: 1 };
  certPaymentRow = { id: 11, caseId: "case-1", status: "pending", amountUsdt: "100" };
  stampReceiptRow = { id: 22, caseId: "case-1", status: "pending", amountUsdt: "50" };
  priorNda = {
    id: 1,
    caseId: "case-1",
    templateVersion: "v1",
    contentHash: "abc",
  };
  docRequestRow = {
    id: 70,
    caseId: "case-1",
    documentType: "Proof of income",
    status: "requested",
    uploadsEnabled: true,
  };
  depositReceiptRow = { id: 80, status: "pending" };
});

function buildCaseDocsApp() {
  const r = Router();
  registerCaseDocumentRoutes(r);
  return buildApp((a) => a.use("/api/cases", r));
}

function buildWithdrawalApp() {
  const r = Router();
  registerCaseWithdrawalActivationRoutes(r);
  return buildApp((a) => a.use("/api/cases", r));
}

function buildDocRequestsApp() {
  return buildApp((a) => a.use("/api/document-requests", documentRequestsRouter));
}

describe("Task #148 — admin session revocation transactions", () => {
  const app = () =>
    buildApp((a) => a.use("/api/admin/sessions", adminSessionsRouter));

  it("rolls back revoke-others when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/admin/sessions/revoke-others")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(500);
    expect(committed.adminSession).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "admin_sessions_revoke_others"),
    ).toBeUndefined();
  });

  it("commits revoke-others and audit row on the happy path", async () => {
    const res = await request(app())
      .post("/api/admin/sessions/revoke-others")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(200);
    expect((committed.adminSession as any)?.bulk).toBe(true);
    expect(
      auditLogs.some((a) => a.action === "admin_sessions_revoke_others"),
    ).toBe(true);
  });

  it("rolls back single session revoke when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/admin/sessions/session-other/revoke")
      .set("Authorization", "Bearer admin-token")
      .send({ reason: "test" });
    expect(res.status).toBe(500);
    expect(committed.adminSession).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "admin_session_revoked"),
    ).toBeUndefined();
  });

  it("commits single session revoke and audit row on the happy path", async () => {
    const res = await request(app())
      .post("/api/admin/sessions/session-other/revoke")
      .set("Authorization", "Bearer admin-token")
      .send({ reason: "test" });
    expect(res.status).toBe(200);
    expect((committed.adminSession as any)?.id).toBe("session-other");
    expect(auditLogs.some((a) => a.action === "admin_session_revoked")).toBe(true);
  });
});

describe("Task #148 — force-logout transaction", () => {
  const app = () => buildApp((a) => a.use("/api/admin", adminRouter));

  it("rolls back force-logout when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/admin/cases/case-1/force-logout")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(500);
    expect(committed.case).toBeUndefined();
    expect(committed.userSessions).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "admin_force_logout_case"),
    ).toBeUndefined();
  });

  it("commits force-logout, session invalidation, and audit on happy path", async () => {
    const res = await request(app())
      .post("/api/admin/cases/case-1/force-logout")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(200);
    expect((committed.case as any)?.forceLogoutAt).toBeInstanceOf(Date);
    expect((committed.userSessions as any)?.invalidated).toBe(true);
    expect(
      auditLogs.some((a) => a.action === "admin_force_logout_case"),
    ).toBe(true);
  });
});

describe("Task #148 — reissue-letter transaction", () => {
  const app = () => buildApp((a) => a.use("/api/admin", adminRouter));

  it("rolls back reissue-letter when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/admin/cases/case-1/reissue-letter")
      .set("Authorization", "Bearer admin-token")
      .send({ reissueFee: "100 USDT", reason: "Need redo" });
    expect(res.status).toBe(500);
    expect(committed.letter).toBeUndefined();
    expect(committed.reissue).toBeUndefined();
    expect(auditLogs.find((a) => a.action === "reissue_letter")).toBeUndefined();
  });

  it("commits letter bump, reissue round, and audit on happy path", async () => {
    const res = await request(app())
      .post("/api/admin/cases/case-1/reissue-letter")
      .set("Authorization", "Bearer admin-token")
      .send({ reissueFee: "100 USDT", reason: "Need redo" });
    expect(res.status).toBe(200);
    expect((committed.letter as any)?.letterVersion).toBe(2);
    expect((committed.reissue as any)?.version).toBe(2);
    expect(auditLogs.some((a) => a.action === "reissue_letter")).toBe(true);
  });
});

describe("Task #148 — clear-reissue transaction", () => {
  const app = () => buildApp((a) => a.use("/api/admin", adminRouter));

  it("rolls back clear-reissue when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/admin/cases/case-1/clear-reissue")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(500);
    expect(committed.reissue).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "clear_reissue_letter"),
    ).toBeUndefined();
  });

  it("commits clear-reissue and audit on happy path", async () => {
    const res = await request(app())
      .post("/api/admin/cases/case-1/clear-reissue")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(200);
    expect((committed.reissue as any)?.status).toBe("cancelled");
    expect(auditLogs.some((a) => a.action === "clear_reissue_letter")).toBe(true);
  });
});

describe("Task #148 — mirror-token issue transaction", () => {
  const app = () => buildApp((a) => a.use("/api/admin", adminRouter));

  it("rolls back mirror-token creation when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/admin/cases/case-1/mirror-token")
      .set("Authorization", "Bearer admin-token")
      .send({ reason: "Investigating reported issue" });
    expect(res.status).toBe(500);
    expect(committed.mirrorToken).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "admin_mirror_token_issued"),
    ).toBeUndefined();
  });

  it("commits mirror-token and audit on happy path", async () => {
    const res = await request(app())
      .post("/api/admin/cases/case-1/mirror-token")
      .set("Authorization", "Bearer admin-token")
      .send({ reason: "Investigating reported issue" });
    expect(res.status).toBe(200);
    expect((committed.mirrorToken as any)?.caseId).toBe("case-1");
    expect(
      auditLogs.some((a) => a.action === "admin_mirror_token_issued"),
    ).toBe(true);
  });
});

describe("Task #148 — certificate fee approve/reject transactions", () => {
  const app = () => buildApp((a) => a.use("/api/cases", casesRouter));

  it("rolls back certificate fee approval when audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/cases/case-1/certificate/fee-payments/11/approve")
      .set("Authorization", "Bearer admin-token")
      .send({});
    expect(res.status).toBe(500);
    expect(committed.certPayment).toBeUndefined();
    expect(committed.case).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "certificate_fee_approved"),
    ).toBeUndefined();
  });

  it("commits certificate fee approval and audit on happy path", async () => {
    const res = await request(app())
      .post("/api/cases/case-1/certificate/fee-payments/11/approve")
      .set("Authorization", "Bearer admin-token")
      .send({});
    expect(res.status).toBe(200);
    expect((committed.certPayment as any)?.status).toBe("approved");
    expect((committed.case as any)?.certificateFeeStatus).toBe("approved");
    expect(
      auditLogs.some((a) => a.action === "certificate_fee_approved"),
    ).toBe(true);
  });

  it("rolls back certificate fee rejection when audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/cases/case-1/certificate/fee-payments/11/reject")
      .set("Authorization", "Bearer admin-token")
      .send({});
    expect(res.status).toBe(500);
    expect(committed.certPayment).toBeUndefined();
    expect(committed.case).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "certificate_fee_rejected"),
    ).toBeUndefined();
  });

  it("commits certificate fee rejection and audit on happy path", async () => {
    const res = await request(app())
      .post("/api/cases/case-1/certificate/fee-payments/11/reject")
      .set("Authorization", "Bearer admin-token")
      .send({});
    expect(res.status).toBe(200);
    expect((committed.certPayment as any)?.status).toBe("rejected");
    expect((committed.case as any)?.certificateFeeStatus).toBe("rejected");
    expect(
      auditLogs.some((a) => a.action === "certificate_fee_rejected"),
    ).toBe(true);
  });
});

describe("Task #148 — stamp duty approve/reject transactions", () => {
  const app = () => buildApp((a) => a.use("/api/cases", casesRouter));

  it("rolls back stamp duty approval when audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/cases/case-1/stamp-duty/receipts/22/approve")
      .set("Authorization", "Bearer admin-token")
      .send({});
    expect(res.status).toBe(500);
    expect(committed.stampReceipt).toBeUndefined();
    expect(committed.case).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "stamp_duty_approved"),
    ).toBeUndefined();
  });

  it("commits stamp duty approval and audit on happy path", async () => {
    const res = await request(app())
      .post("/api/cases/case-1/stamp-duty/receipts/22/approve")
      .set("Authorization", "Bearer admin-token")
      .send({});
    expect(res.status).toBe(200);
    expect((committed.stampReceipt as any)?.status).toBe("approved");
    expect((committed.case as any)?.stampDutyStatus).toBe("approved");
    expect(auditLogs.some((a) => a.action === "stamp_duty_approved")).toBe(true);
  });

  it("rolls back stamp duty rejection when audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/cases/case-1/stamp-duty/receipts/22/reject")
      .set("Authorization", "Bearer admin-token")
      .send({});
    expect(res.status).toBe(500);
    expect(committed.stampReceipt).toBeUndefined();
    expect(committed.case).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "stamp_duty_rejected"),
    ).toBeUndefined();
  });

  it("commits stamp duty rejection and audit on happy path", async () => {
    const res = await request(app())
      .post("/api/cases/case-1/stamp-duty/receipts/22/reject")
      .set("Authorization", "Bearer admin-token")
      .send({});
    expect(res.status).toBe(200);
    expect((committed.stampReceipt as any)?.status).toBe("rejected");
    expect((committed.case as any)?.stampDutyStatus).toBe("rejected");
    expect(auditLogs.some((a) => a.action === "stamp_duty_rejected")).toBe(true);
  });
});

describe("Task #148 — document request create + audit transaction", () => {
  const app = () => buildCaseDocsApp();

  it("rolls back document-request create when audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/cases/case-1/document-requests")
      .set("Authorization", "Bearer admin-token")
      .send({ documentType: "Proof of income" });
    expect(res.status).toBe(500);
    expect(committed.docRequest).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "document_requested"),
    ).toBeUndefined();
  });

  it("commits document-request and audit on happy path", async () => {
    const res = await request(app())
      .post("/api/cases/case-1/document-requests")
      .set("Authorization", "Bearer admin-token")
      .send({ documentType: "Proof of income" });
    expect(res.status).toBe(200);
    expect((committed.docRequest as any)?.documentType).toBe("Proof of income");
    expect(auditLogs.some((a) => a.action === "document_requested")).toBe(true);
  });
});

describe("Task #148 — document-request uploads-enabled toggle transaction", () => {
  const app = () => buildDocRequestsApp();

  it("rolls back uploads-enabled toggle when audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .patch("/api/document-requests/70/uploads-enabled")
      .set("Authorization", "Bearer admin-token")
      .send({ uploadsEnabled: false });
    expect(res.status).toBe(500);
    expect(committed.docRequest).toBeUndefined();
    expect(
      auditLogs.find(
        (a) =>
          a.action === "document_uploads_enabled" ||
          a.action === "document_uploads_disabled",
      ),
    ).toBeUndefined();
  });

  it("commits uploads-enabled toggle and audit on happy path", async () => {
    const res = await request(app())
      .patch("/api/document-requests/70/uploads-enabled")
      .set("Authorization", "Bearer admin-token")
      .send({ uploadsEnabled: false });
    expect(res.status).toBe(200);
    expect((committed.docRequest as any)?.uploadsEnabled).toBe(false);
    expect(
      auditLogs.some((a) => a.action === "document_uploads_disabled"),
    ).toBe(true);
  });
});

describe("Task #148 — withdrawal activation admin update transaction", () => {
  const app = () => buildWithdrawalApp();

  it("rolls back admin settings update when audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .patch("/api/cases/case-1/withdrawal-activation/admin")
      .set("Authorization", "Bearer admin-token")
      .send({ withdrawalActivationMinUsdt: "100" });
    expect(res.status).toBe(500);
    expect(committed.case).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "withdrawal_activation_admin_update"),
    ).toBeUndefined();
  });

  it("commits admin settings update and audit on happy path", async () => {
    const res = await request(app())
      .patch("/api/cases/case-1/withdrawal-activation/admin")
      .set("Authorization", "Bearer admin-token")
      .send({ withdrawalActivationMinUsdt: "100" });
    expect(res.status).toBe(200);
    expect((committed.case as any)?.withdrawalActivationMinUsdt).toBe("100");
    expect(
      auditLogs.some((a) => a.action === "withdrawal_activation_admin_update"),
    ).toBe(true);
  });
});

describe("Task #148 — withdrawal activation admin review transactions", () => {
  const app = () => buildWithdrawalApp();

  it("rolls back approve review when audit write fails", async () => {
    auditShouldThrow = true;
    caseRow.withdrawalActivationReceiptId = 80;
    caseRow.withdrawalActivationStatus = "awaiting_admin_approval";
    const res = await request(app())
      .post("/api/cases/case-1/withdrawal-activation/admin/review")
      .set("Authorization", "Bearer admin-token")
      .send({ decision: "approve" });
    expect(res.status).toBe(500);
    expect(committed.case).toBeUndefined();
    expect(committed.depositReceipt).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "withdrawal_activation_approved"),
    ).toBeUndefined();
  });

  it("commits approve review, receipt update, and audit on happy path", async () => {
    caseRow.withdrawalActivationReceiptId = 80;
    caseRow.withdrawalActivationStatus = "awaiting_admin_approval";
    const res = await request(app())
      .post("/api/cases/case-1/withdrawal-activation/admin/review")
      .set("Authorization", "Bearer admin-token")
      .send({ decision: "approve" });
    expect(res.status).toBe(200);
    expect((committed.case as any)?.withdrawalActivationStatus).toBe("approved");
    expect((committed.depositReceipt as any)?.status).toBe("approved");
    expect(
      auditLogs.some((a) => a.action === "withdrawal_activation_approved"),
    ).toBe(true);
  });

  it("rolls back reject review when audit write fails", async () => {
    auditShouldThrow = true;
    caseRow.withdrawalActivationReceiptId = 80;
    caseRow.withdrawalActivationStatus = "awaiting_admin_approval";
    const res = await request(app())
      .post("/api/cases/case-1/withdrawal-activation/admin/review")
      .set("Authorization", "Bearer admin-token")
      .send({ decision: "reject", reason: "Bad receipt" });
    expect(res.status).toBe(500);
    expect(committed.case).toBeUndefined();
    expect(committed.depositReceipt).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "withdrawal_activation_rejected"),
    ).toBeUndefined();
  });

  it("commits reject review, receipt update, and audit on happy path", async () => {
    caseRow.withdrawalActivationReceiptId = 80;
    caseRow.withdrawalActivationStatus = "awaiting_admin_approval";
    const res = await request(app())
      .post("/api/cases/case-1/withdrawal-activation/admin/review")
      .set("Authorization", "Bearer admin-token")
      .send({ decision: "reject", reason: "Bad receipt" });
    expect(res.status).toBe(200);
    expect((committed.case as any)?.withdrawalActivationStatus).toBe("rejected");
    expect((committed.depositReceipt as any)?.status).toBe("rejected");
    expect(
      auditLogs.some((a) => a.action === "withdrawal_activation_rejected"),
    ).toBe(true);
  });
});

describe("Task #148 — NDA seal override transaction", () => {
  const app = () => buildApp((a) => a.use("/api/cases", casesRouter));

  it("rolls back seal override when audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/cases/case-1/nda/override-seal")
      .set("Authorization", "Bearer admin-token")
      .send({ reason: "Restoring access after error" });
    expect(res.status).toBe(500);
    expect(committed.case).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "case_seal_overridden"),
    ).toBeUndefined();
  });

  it("commits seal override and audit on happy path", async () => {
    const res = await request(app())
      .post("/api/cases/case-1/nda/override-seal")
      .set("Authorization", "Bearer admin-token")
      .send({ reason: "Restoring access after error" });
    expect(res.status).toBe(200);
    expect((committed.case as any)?.status).toBe("active");
    expect((committed.case as any)?.sealedAt).toBeNull();
    expect(auditLogs.some((a) => a.action === "case_seal_overridden")).toBe(true);
  });
});
