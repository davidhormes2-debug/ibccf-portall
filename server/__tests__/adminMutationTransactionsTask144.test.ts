import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// Task #144 — extends the Task #137 pattern to the remaining admin
// mutations that paired a row change with a non-transactional audit
// write. Each surface is verified by forcing the audit-log write to
// throw and asserting the row mutation rolled back.
//
// The storage mock models a tiny "committed / staged" state machine:
// individual storage writers stage their effect, runInTransaction
// commits everything staged when its callback resolves or discards it
// all if the callback throws.

type Staged = Record<string, unknown>;
const auditLogs: any[] = [];
const committed: Staged = {};
let staged: Staged = {};
let auditShouldThrow = false;

let docExisting: any = null;
let receiptExisting: any = null;
let withdrawalExisting: any = null;
let declarationExisting: any = null;
let announcementRow: any = null;

function commitStaged() {
  for (const [k, v] of Object.entries(staged)) committed[k] = v;
  staged = {};
}

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // --- common ---
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    createAuditLog: vi.fn(async (entry: any) => {
      if (auditShouldThrow) throw new Error("forced audit failure");
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      try {
        const result = await fn(makeDbStub());
        commitStaged();
        return result;
      } catch (err) {
        staged = {};
        throw err;
      }
    }),

    // --- document requests ---
    getDocumentRequestById: vi.fn(async () => docExisting),
    updateDocumentRequest: vi.fn(async (id: number, data: any) => {
      const row = { ...(docExisting ?? {}), id, ...data };
      staged.doc = row;
      return row;
    }),

    // --- deposit receipts ---
    getDepositReceiptById: vi.fn(async () => receiptExisting),
    getLetterReissueById: vi.fn(async () => null),
    updateDepositReceipt: vi.fn(async (id: number, data: any) => {
      const row = { ...(receiptExisting ?? {}), id, ...data };
      staged.receipt = row;
      return row;
    }),
    updateDepositReceiptStatus: vi.fn(async (id: number, status: string) => {
      const row = { ...(receiptExisting ?? {}), id, status };
      staged.receipt = row;
      return row;
    }),
    updateLetterReissue: vi.fn(async () => undefined),

    // --- withdrawal requests ---
    getWithdrawalRequestById: vi.fn(async () => withdrawalExisting),
    getCaseById: vi.fn(async () => ({ id: "case-1", sealedAt: null, userEmail: null })),
    updateWithdrawalRequest: vi.fn(async (id: number, data: any) => {
      const row = { ...(withdrawalExisting ?? {}), id, ...data };
      staged.withdrawal = row;
      return row;
    }),

    // --- declaration submissions ---
    getDeclarationSubmissionById: vi.fn(async () => declarationExisting),
    updateDeclarationSubmissionStatus: vi.fn(
      async (id: number, status: string, reviewedBy: string, notes?: string) => {
        const row = {
          ...(declarationExisting ?? {}),
          id,
          status,
          reviewedBy,
          reviewerNotes: notes ?? null,
        };
        staged.declaration = row;
        return row;
      },
    ),
    updateCase: vi.fn(async (id: string, data: any) => {
      const row = { id, ...data };
      staged.case = row;
      return row;
    }),

    // --- blocked IPs ---
    blockIp: vi.fn(async (input: any) => {
      const row = { ...input, blockedAt: new Date() };
      staged.block = row;
      return row;
    }),
    unblockIp: vi.fn(async (ip: string) => {
      const row = { ipAddress: ip, reason: null, blockedBy: "admin", expiresAt: null, blockedAt: new Date() };
      staged.unblock = row;
      return row;
    }),
  }),
}));

function makeAnnouncementBuilder(op: "insert" | "update" | "delete") {
  const api: any = {};
  api.values = (vals: any) => {
    api._vals = vals;
    return api;
  };
  api.set = (vals: any) => {
    api._vals = vals;
    return api;
  };
  api.where = () => api;
  api.returning = async () => {
    if (op === "insert") {
      announcementRow = { id: "ann-1", ...api._vals };
      staged.announcement = announcementRow;
      return [announcementRow];
    }
    if (op === "update") {
      announcementRow = { ...(announcementRow ?? { id: "ann-1" }), ...api._vals };
      staged.announcement = announcementRow;
      return [announcementRow];
    }
    if (op === "delete") {
      const prev = announcementRow ?? { id: "ann-1", title: "T", type: "info" };
      staged.announcement = null;
      announcementRow = null;
      return [prev];
    }
    return [];
  };
  return api;
}

function makeDbStub() {
  return {
    insert: () => makeAnnouncementBuilder("insert"),
    update: () => makeAnnouncementBuilder("update"),
    delete: () => makeAnnouncementBuilder("delete"),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    transaction: async (fn: (tx: any) => Promise<any>) => {
      try {
        const r = await fn(makeDbStub());
        commitStaged();
        return r;
      } catch (e) {
        staged = {};
        throw e;
      }
    },
  };
}

vi.mock("../db", () => ({
  db: makeDbStub(),
}));

vi.mock("../services", () => ({
  caseService: {},
}));

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async () => true),
}));

vi.mock("../routes/middleware", async () => {
  return {
    checkAdminAuth: (req: any, _res: any, next: any) => {
      req.admin = { username: "admin" };
      req.adminUsername = "admin";
      next();
    },
    isValidAdminToken: vi.fn(async () => true),
    invalidateBlockedIpsCache: vi.fn(),
    normalizeIp: (ip: string) => ip,
    getClientIp: () => "127.0.0.1",
  };
});

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({ sendLocalizedCaseEmail: vi.fn(async () => ({ success: true })) }),
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
}));

// Imports AFTER mocks
const { reviewDocumentRequest } = await (async () => {
  // content.ts doesn't export the helper; mount its router
  const mod: any = await import("../routes/content");
  return { reviewDocumentRequest: null, ...mod };
})();
const { documentRequestsRouter } = (await import("../routes/content")) as any;
const { depositsRouter } = await import("../routes/deposits");
const { adminRouter, blockedIpsRouter } = await import("../routes/admin");
const { registerCaseWithdrawalRoutes } = await import("../routes/withdrawalRequests");
const { communicationsRouter } = await import("../routes/communications");

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
  docExisting = { id: 1, caseId: "case-1", status: "submitted", documentType: "KYC" };
  receiptExisting = { id: 2, caseId: "case-1", status: "pending", reissueId: null };
  withdrawalExisting = { id: 3, caseId: "case-1", status: "pending", amount: "100", asset: "USDT" };
  declarationExisting = { id: 4, caseId: "case-1", status: "submitted" };
  announcementRow = { id: "ann-1", title: "Existing", message: "x", type: "info", active: true };
});

describe("Task #144 — document review transaction", () => {
  const app = () =>
    buildApp((a) => a.use("/api/document-requests", documentRequestsRouter));

  it("rolls back the document update when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/document-requests/1/approve")
      .set("Authorization", "Bearer admin-token")
      .send({});
    expect(res.status).toBe(500);
    expect(committed.doc).toBeUndefined();
    expect(auditLogs.find((a) => a.action === "document_approved")).toBeUndefined();
  });

  it("commits the update and audit row on the happy path", async () => {
    const res = await request(app())
      .post("/api/document-requests/1/approve")
      .set("Authorization", "Bearer admin-token")
      .send({});
    expect(res.status).toBe(200);
    expect((committed.doc as any)?.status).toBe("approved");
    expect(auditLogs.some((a) => a.action === "document_approved")).toBe(true);
  });
});

describe("Task #144 — deposit receipt PATCH transaction", () => {
  const app = () => buildApp((a) => a.use("/api/deposit-receipts", depositsRouter));

  it("rolls back the receipt PATCH when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .patch("/api/deposit-receipts/2")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "approved" });
    expect(res.status).toBe(500);
    expect(committed.receipt).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "admin_update_deposit_receipt"),
    ).toBeUndefined();
  });

  it("rolls back PATCH /:id/status when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .patch("/api/deposit-receipts/2/status")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "approved" });
    expect(res.status).toBe(500);
    expect(committed.receipt).toBeUndefined();
  });

  it("commits the receipt update and audit row on the happy path", async () => {
    const res = await request(app())
      .patch("/api/deposit-receipts/2")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "approved" });
    expect(res.status).toBe(200);
    expect((committed.receipt as any)?.status).toBe("approved");
    expect(
      auditLogs.some((a) => a.action === "admin_update_deposit_receipt"),
    ).toBe(true);
  });
});

describe("Task #144 — withdrawal request review transaction", () => {
  const app = () =>
    buildApp((a) => {
      const router = (express.Router as unknown as () => Router)();
      registerCaseWithdrawalRoutes(router);
      a.use("/api/cases", router);
    });

  it("rolls back the review when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .patch("/api/cases/case-1/withdrawal-requests/3")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "approved" });
    expect(res.status).toBe(500);
    expect(committed.withdrawal).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "withdrawal_request_approved"),
    ).toBeUndefined();
  });

  it("commits the review and audit row on the happy path", async () => {
    const res = await request(app())
      .patch("/api/cases/case-1/withdrawal-requests/3")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "approved" });
    expect(res.status).toBe(200);
    expect((committed.withdrawal as any)?.status).toBe("approved");
    expect(
      auditLogs.some((a) => a.action === "withdrawal_request_approved"),
    ).toBe(true);
  });
});

describe("Task #144 — declaration review transaction", () => {
  const app = () => buildApp((a) => a.use("/api/admin", adminRouter));

  it("rolls back the declaration review when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .patch("/api/admin/declaration-submissions/4/status")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "approved" });
    expect(res.status).toBe(500);
    expect(committed.declaration).toBeUndefined();
    expect(committed.case).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "declaration_approved"),
    ).toBeUndefined();
  });

  it("commits the declaration review, case mirror, and audit row on the happy path", async () => {
    const res = await request(app())
      .patch("/api/admin/declaration-submissions/4/status")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "approved" });
    expect(res.status).toBe(200);
    expect((committed.declaration as any)?.status).toBe("approved");
    expect((committed.case as any)?.declarationStatus).toBe("approved");
    expect(auditLogs.some((a) => a.action === "declaration_approved")).toBe(true);
  });
});

describe("Task #144 — blocked IPs transactions", () => {
  const app = () => buildApp((a) => a.use("/api/admin/blocked-ips", blockedIpsRouter));

  it("rolls back blockIp when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/admin/blocked-ips")
      .set("Authorization", "Bearer admin-token")
      .send({ ipAddress: "1.2.3.4" });
    expect(res.status).toBe(500);
    expect(committed.block).toBeUndefined();
    expect(auditLogs.find((a) => a.action === "ip_blocked")).toBeUndefined();
  });

  it("commits blockIp and the audit row on the happy path", async () => {
    const res = await request(app())
      .post("/api/admin/blocked-ips")
      .set("Authorization", "Bearer admin-token")
      .send({ ipAddress: "1.2.3.4" });
    expect(res.status).toBe(201);
    expect((committed.block as any)?.ipAddress).toBe("1.2.3.4");
    expect(auditLogs.some((a) => a.action === "ip_blocked")).toBe(true);
  });

  it("rolls back unblockIp when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .delete("/api/admin/blocked-ips/1.2.3.4")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(500);
    expect(committed.unblock).toBeUndefined();
    expect(auditLogs.find((a) => a.action === "ip_unblocked")).toBeUndefined();
  });

  it("commits unblockIp and the audit row on the happy path", async () => {
    const res = await request(app())
      .delete("/api/admin/blocked-ips/1.2.3.4")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(200);
    expect((committed.unblock as any)?.ipAddress).toBe("1.2.3.4");
    expect(auditLogs.some((a) => a.action === "ip_unblocked")).toBe(true);
  });
});

describe("Task #144 — announcement create/update/delete transactions", () => {
  const app = () => buildApp((a) => a.use("/api/admin", communicationsRouter));

  it("rolls back announcement creation when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .post("/api/admin/announcements")
      .set("Authorization", "Bearer admin-token")
      .send({ title: "Hello", message: "World", type: "info", active: true });
    expect(res.status).toBe(500);
    expect(committed.announcement).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "announcement_created"),
    ).toBeUndefined();
  });

  it("commits announcement creation and audit row on the happy path", async () => {
    const res = await request(app())
      .post("/api/admin/announcements")
      .set("Authorization", "Bearer admin-token")
      .send({ title: "Hello", message: "World", type: "info", active: true });
    expect(res.status).toBe(201);
    expect((committed.announcement as any)?.title).toBe("Hello");
    expect(auditLogs.some((a) => a.action === "announcement_created")).toBe(true);
  });

  it("rolls back announcement update when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .patch("/api/admin/announcements/ann-1")
      .set("Authorization", "Bearer admin-token")
      .send({ title: "Changed" });
    expect(res.status).toBe(500);
    expect(committed.announcement).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "announcement_updated"),
    ).toBeUndefined();
  });

  it("commits announcement update and audit row on the happy path", async () => {
    const res = await request(app())
      .patch("/api/admin/announcements/ann-1")
      .set("Authorization", "Bearer admin-token")
      .send({ title: "Changed" });
    expect(res.status).toBe(200);
    expect((committed.announcement as any)?.title).toBe("Changed");
    expect(auditLogs.some((a) => a.action === "announcement_updated")).toBe(true);
  });

  it("rolls back announcement delete when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(app())
      .delete("/api/admin/announcements/ann-1")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(500);
    expect(committed.announcement).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "announcement_deleted"),
    ).toBeUndefined();
  });

  it("commits announcement delete and audit row on the happy path", async () => {
    const res = await request(app())
      .delete("/api/admin/announcements/ann-1")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(200);
    expect(committed.announcement).toBeNull();
    expect(auditLogs.some((a) => a.action === "announcement_deleted")).toBe(true);
  });
});
