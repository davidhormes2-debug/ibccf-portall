import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// Task #137 — verifies that admin mutation handlers wrap their row
// change and audit-log write in a single DB transaction. When the
// audit-log write fails the mutation must roll back instead of leaving
// behind a silent, untracked change.
//
// We model "transactional" behaviour in the storage mock with a
// `committed` / `staged` state machine: storage methods write into the
// staged slot, runInTransaction commits or discards it based on whether
// the callback resolves or throws.

type StagedDelete = { caseId: string } | null;
type StagedRequest = { row: any } | null;

const auditLogs: any[] = [];
let stagedDelete: StagedDelete = null;
let committedDelete: StagedDelete = null;
let stagedRequest: StagedRequest = null;
let committedRequest: StagedRequest = null;
let auditShouldThrow = false;

let beforeCase: any = null;

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
    getPendingWithdrawalRequestCountByCaseId: vi.fn(async () => 0),
    deleteCase: vi.fn(async (caseId: string) => {
      stagedDelete = { caseId };
    }),
    createWithdrawalRequest: vi.fn(async (data: any) => {
      const row = { id: 99, ...data };
      stagedRequest = { row };
      return row;
    }),
    // Task #775 — the withdrawal POST handler auto-advances the case stage
    // inside the same transaction; provide the mock so it doesn't throw.
    updateCase: vi.fn(async (id: string, patch: any) => ({ id, ...patch })),
    createAuditLog: vi.fn(async (entry: any) => {
      if (auditShouldThrow) {
        throw new Error("forced audit failure");
      }
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      try {
        const result = await fn({});
        if (stagedDelete) {
          committedDelete = stagedDelete;
          stagedDelete = null;
        }
        if (stagedRequest) {
          committedRequest = stagedRequest;
          stagedRequest = null;
        }
        return result;
      } catch (err) {
        // Rollback: discard anything staged inside the failed callback.
        stagedDelete = null;
        stagedRequest = null;
        throw err;
      }
    }),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(),
    createCase: vi.fn(),
    getAllCases: vi.fn(),
    getCaseByAccessCode: vi.fn(),
    getCaseById: vi.fn(async () => beforeCase),
    deleteCase: vi.fn(),
  },
}));

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async () => true),
}));

vi.mock("../routes/middleware", () => ({
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
  isValidAdminToken: vi.fn(async () => true),
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({}),
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async () => ({ sent: true })),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

// Import AFTER mocks.
const { casesRouter } = await import("../routes/cases");
const { registerCaseWithdrawalRoutes } = await import("../routes/withdrawalRequests");

function buildCasesApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

function buildWithdrawalApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.set("trust proxy", true);
  const router = (express.Router as unknown as () => Router)();
  registerCaseWithdrawalRoutes(router);
  app.use("/api/cases", router);
  return app;
}

beforeEach(() => {
  auditLogs.length = 0;
  stagedDelete = null;
  committedDelete = null;
  stagedRequest = null;
  committedRequest = null;
  auditShouldThrow = false;
  beforeCase = {
    id: "case-1",
    accessCode: "ABCD-1234",
    userName: "Test User",
    userEmail: "user@example.com",
    userPin: "123456",
    status: "pending",
    sealedAt: null,
    withdrawalWindowEnabled: true,
    withdrawalStage: 1,
  };
});

describe("Task #137 — DELETE /api/cases/:id transaction", () => {
  it("rolls the delete back when the audit-log write fails", async () => {
    auditShouldThrow = true;

    const res = await request(buildCasesApp())
      .delete("/api/cases/case-1")
      .set("Authorization", "Bearer admin-token");

    // Handler should bubble the failure as a 500.
    expect(res.status).toBe(500);
    // Nothing was committed — the staged delete was discarded by the
    // transaction wrapper when the audit write threw.
    expect(committedDelete).toBeNull();
    expect(stagedDelete).toBeNull();
    // And no successful audit row leaked through.
    expect(auditLogs.find((a) => a.action === "delete_case_success")).toBeUndefined();
  });

  it("commits both the delete and the audit row on the happy path", async () => {
    const res = await request(buildCasesApp())
      .delete("/api/cases/case-1")
      .set("Authorization", "Bearer admin-token");

    expect(res.status).toBe(200);
    expect(committedDelete).toEqual({ caseId: "case-1" });
    expect(auditLogs.some((a) => a.action === "delete_case_success")).toBe(true);
  });
});

describe("Task #137 — POST /api/cases/:id/withdrawal-requests transaction", () => {
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

  it("rolls the withdrawal-request insert back when the audit write fails", async () => {
    auditShouldThrow = true;

    const res = await request(buildWithdrawalApp())
      .post("/api/cases/case-1/withdrawal-requests")
      .send(goodBody);

    expect(res.status).toBe(500);
    expect(committedRequest).toBeNull();
    expect(stagedRequest).toBeNull();
    expect(
      auditLogs.find((a) => a.action === "withdrawal_request_submitted"),
    ).toBeUndefined();
  });

  it("commits the insert and the audit row together on the happy path", async () => {
    const res = await request(buildWithdrawalApp())
      .post("/api/cases/case-1/withdrawal-requests")
      .send(goodBody);

    expect(res.status).toBe(201);
    expect(committedRequest?.row?.amount).toBe("1000");
    expect(
      auditLogs.some((a) => a.action === "withdrawal_request_submitted"),
    ).toBe(true);
  });
});
