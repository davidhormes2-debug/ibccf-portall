import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";
import type {
  cases as CasesTable,
  withdrawalRequests as WithdrawalRequestsTable,
} from "@shared/schema";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// `beforeCase` and `lastInsertedRequest` below hand-roll `cases` /
// `withdrawal_requests` columns. These Pick<> declarations fail `npm run check`
// if any referenced column is renamed in shared/schema.ts, preventing silent
// mock drift.
declare const _casesGuard: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "userPin"
  | "userEmail"
  | "sealedAt"
  | "withdrawalWindowEnabled"
>;
declare const _withdrawalRequestsGuard: Pick<
  typeof WithdrawalRequestsTable,
  "id" | "caseId" | "status" | "amount" | "asset" | "network"
>;

// ---- Mocks ----------------------------------------------------------------

const auditLogs: any[] = [];
const sentEmails: any[] = [];
const adminNotifications: any[] = [];
const adminAlertEmails: any[] = [];

let beforeCase: any = null;
let pendingCount = 0;
let pendingCounts: Record<string, number> = {};
let lastInsertedRequest: any = null;
let lastUpdate: { id: number; patch: any } | null = null;
let lastCaseUpdate: { id: string; patch: any } | null = null;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getCaseById: vi.fn(async () => beforeCase),
    getWithdrawalRequestsByCaseId: vi.fn(async () => []),
    getWithdrawalRequestById: vi.fn(async (id: number) =>
      lastInsertedRequest && lastInsertedRequest.id === id ? lastInsertedRequest : null,
    ),
    getPendingWithdrawalRequestCountByCaseId: vi.fn(async () => pendingCount),
    getPendingWithdrawalRequestCounts: vi.fn(async () => pendingCounts),
    createWithdrawalRequest: vi.fn(async (data: any) => {
      lastInsertedRequest = { id: 1, ...data };
      return lastInsertedRequest;
    }),
    updateWithdrawalRequest: vi.fn(async (id: number, patch: any) => {
      lastUpdate = { id, patch };
      lastInsertedRequest = { ...(lastInsertedRequest ?? {}), ...patch, id };
      return lastInsertedRequest;
    }),
    updateCase: vi.fn(async (id: string, patch: any) => {
      lastCaseUpdate = { id, patch };
      if (beforeCase && beforeCase.id === id) {
        beforeCase = { ...beforeCase, ...patch };
      }
      return { id, ...patch };
    }),
    listWithdrawalRequests: vi.fn(async () => []),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  }),
}));

// Bypass portal-auth + sealed-guard: we are testing the handler logic
// (toggle, PIN, rate-limit envelope, audit, email), not the auth chain.
vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (req: any, res: any, next: any) => {
    if (beforeCase?.sealedAt) {
      res.status(423).json({ error: "Case is sealed" });
      return;
    }
    next();
  },
  isAuthorizedForCase: vi.fn(async () => true),
}));

vi.mock("../routes/middleware", () => ({
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
  isValidAdminToken: vi.fn(async () => true),
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendWithdrawalRequestSubmittedEmail: vi.fn(async () => ({ success: true })),
    sendWithdrawalRequestApprovedEmail: vi.fn(async () => ({ success: true })),
    sendWithdrawalRequestRejectedEmail: vi.fn(async () => ({ success: true })),
    sendWithdrawalRequestCancelledEmail: vi.fn(async () => ({ success: true })),
    sendWithdrawalRequestAdminAlertEmail: vi.fn(async (alert: any) => {
      adminAlertEmails.push(alert);
      return { success: true };
    }),
  }),
}));

vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyAdmin: vi.fn(async (type: string, title: string, body?: string, link?: string) => {
      adminNotifications.push({ type, title, body, link });
      return { id: adminNotifications.length, type, title, body, link };
    }),
  },
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async (params: any) => {
    sentEmails.push({
      tag: params.tag,
      caseId: params.caseId,
      adminUser: params.adminUser,
    });
    try {
      await params.send?.("en");
    } catch {
      // ignore — test mocks return success
    }
    return { sent: true };
  }),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

// bcryptjs is used inside verifyPinOnly — leave it real so legacy
// plaintext PIN matching ("123456" === "123456") still works.

// Import AFTER mocks.
const { registerCaseWithdrawalRoutes, withdrawalRequestsRouter } = await import(
  "../routes/withdrawalRequests"
);

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  // Trust loopback so rateLimiter sees a stable req.ip across supertest calls.
  app.set("trust proxy", true);
  const router = (express.Router as unknown as () => Router)();
  registerCaseWithdrawalRoutes(router);
  app.use("/api/cases", router);
  return app;
}

function buildAdminApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.set("trust proxy", true);
  app.use("/api/withdrawal-requests", withdrawalRequestsRouter);
  return app;
}

beforeEach(() => {
  auditLogs.length = 0;
  sentEmails.length = 0;
  adminNotifications.length = 0;
  adminAlertEmails.length = 0;
  pendingCount = 0;
  pendingCounts = {};
  lastInsertedRequest = null;
  lastUpdate = null;
  lastCaseUpdate = null;
  beforeCase = {
    id: "case-1",
    accessCode: "ACC-1",
    userPin: "123456",
    userEmail: "user@example.com",
    userName: "Jane Doe",
    sealedAt: null,
    withdrawalWindowEnabled: true,
    withdrawalStage: "3",
  };
});

const goodBody = {
  amount: "1000",
  asset: "USDT",
  network: "TRC20",
  withdrawalType: "full" as const,
  requestedWalletAddress: "TXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV",
  confirmationChannel: "email" as const,
  pin: "123456",
  termsAccepted: true,
};

describe("withdrawal-requests: portal submit", () => {
  it("returns 403 when the admin toggle is off", async () => {
    beforeCase.withdrawalWindowEnabled = false;
    const res = await request(buildApp())
      .post("/api/cases/case-1/withdrawal-requests")
      .send(goodBody);
    expect(res.status).toBe(403);
  });

  it("returns 423 when the case is sealed", async () => {
    beforeCase.sealedAt = new Date().toISOString();
    const res = await request(buildApp())
      .post("/api/cases/case-1/withdrawal-requests")
      .send(goodBody);
    expect(res.status).toBe(423);
  });

  it("returns 400 (not 401) when the PIN is wrong", async () => {
    const res = await request(buildApp())
      .post("/api/cases/case-1/withdrawal-requests")
      .send({ ...goodBody, pin: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PIN/i);
  });

  it("happy-path: creates the row, writes an audit log, attempts an email", async () => {
    const res = await request(buildApp())
      .post("/api/cases/case-1/withdrawal-requests")
      .send(goodBody);
    expect(res.status).toBe(201);
    expect(lastInsertedRequest).toBeTruthy();
    expect(lastInsertedRequest.status).toBe("pending");
    expect(auditLogs.some((l) => l.action === "withdrawal_request_submitted")).toBe(true);
    // Email is fire-and-forget — give the microtask queue a tick to flush.
    await new Promise((r) => setImmediate(r));
    expect(sentEmails.some((e) => e.tag === "withdrawal-request-submitted")).toBe(true);
  });

  it("auto-advances the withdrawal stage by one (3 → 4) and audits it", async () => {
    const res = await request(buildApp())
      .post("/api/cases/case-1/withdrawal-requests")
      .send(goodBody);
    expect(res.status).toBe(201);
    expect(lastCaseUpdate).toEqual({ id: "case-1", patch: { withdrawalStage: "4", maxStageReached: 4 } });
    const adv = auditLogs.find((l) => l.action === "withdrawal_stage_auto_advanced");
    expect(adv).toBeTruthy();
    expect(adv.previousValue).toBe("3");
  });

  it("caps the stage at 14 and never advances past it", async () => {
    beforeCase.withdrawalStage = "14";
    // Stage 14 is gated behind an approved activation deposit; set it so we
    // get past that pre-existing guard and actually exercise the cap.
    beforeCase.withdrawalActivationStatus = "approved";
    const res = await request(buildApp())
      .post("/api/cases/case-1/withdrawal-requests")
      .send(goodBody);
    expect(res.status).toBe(201);
    expect(lastCaseUpdate).toBeNull();
    expect(auditLogs.some((l) => l.action === "withdrawal_stage_auto_advanced")).toBe(false);
  });

  it("leaves a null/absent stage untouched", async () => {
    beforeCase.withdrawalStage = null;
    const res = await request(buildApp())
      .post("/api/cases/case-1/withdrawal-requests")
      .send(goodBody);
    expect(res.status).toBe(201);
    expect(lastCaseUpdate).toBeNull();
    expect(auditLogs.some((l) => l.action === "withdrawal_stage_auto_advanced")).toBe(false);
  });

  it("notifies admins in-app and by email (best-effort)", async () => {
    const res = await request(buildApp())
      .post("/api/cases/case-1/withdrawal-requests")
      .send(goodBody);
    expect(res.status).toBe(201);
    // Admin alert is fire-and-forget — let the microtask queue flush.
    await new Promise((r) => setImmediate(r));
    expect(adminNotifications.some((n) => n.type === "withdrawal_request_submitted")).toBe(true);
    expect(adminAlertEmails.length).toBe(1);
    expect(adminAlertEmails[0].caseRef).toBe("case-1");
    expect(adminAlertEmails[0].newStage).toBe(4);
  });

  it("returns 409 when a pending request already exists", async () => {
    pendingCount = 1;
    const res = await request(buildApp())
      .post("/api/cases/case-1/withdrawal-requests")
      .send(goodBody);
    expect(res.status).toBe(409);
  });
});

describe("withdrawal-requests: admin review", () => {
  beforeEach(() => {
    lastInsertedRequest = {
      id: 42,
      caseId: "case-1",
      status: "pending",
      amount: "1000",
      asset: "USDT",
      network: "TRC20",
    };
  });

  it("approve → 200 and updates status", async () => {
    const res = await request(buildApp())
      .patch("/api/cases/case-1/withdrawal-requests/42")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "approved" });
    expect(res.status).toBe(200);
    expect(lastUpdate?.patch.status).toBe("approved");
    expect(auditLogs.some((l) => l.action === "withdrawal_request_approved")).toBe(true);
  });

  it("reject without a note → 400", async () => {
    const res = await request(buildApp())
      .patch("/api/cases/case-1/withdrawal-requests/42")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "rejected" });
    expect(res.status).toBe(400);
  });

  it("reject with a note → 200", async () => {
    const res = await request(buildApp())
      .patch("/api/cases/case-1/withdrawal-requests/42")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "rejected", adminNote: "Wallet on a sanctioned chain." });
    expect(res.status).toBe(200);
    expect(lastUpdate?.patch.status).toBe("rejected");
  });
});

describe("withdrawal-requests: admin pending-counts badge", () => {
  it("returns the per-case pending counts map", async () => {
    pendingCounts = { "case-1": 2, "case-9": 1 };
    const res = await request(buildAdminApp())
      .get("/api/withdrawal-requests/pending-counts")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ "case-1": 2, "case-9": 1 });
  });

  it("returns an empty map when no requests are pending", async () => {
    pendingCounts = {};
    const res = await request(buildAdminApp())
      .get("/api/withdrawal-requests/pending-counts")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({});
  });
});
