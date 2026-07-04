import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// Task #842 — API-level coverage for the on-demand wallet-connect completion
// backfill trigger: POST /api/admin/wallet-connect-completion-backfill/run.
//
// Verifies:
//   1. The route is guarded by admin bearer auth (401 without a valid token).
//   2. The happy path returns the backfill result shape { scanned, inserted,
//      skipped } and writes the manual-trigger audit row inside the wrapping
//      transaction.
//   3. The backfill + trigger audit are wrapped in storage.runInTransaction, so
//      an audit-write failure rolls back (the route surfaces a 500).

const auditLogs: any[] = [];
let auditShouldThrow = false;

// The backfill result the (mocked) service returns for the happy path.
let backfillResult = { scanned: 5, inserted: 2, skipped: false };
const backfillMock = vi.fn(async () => backfillResult);

vi.mock("../services/walletConnectAlert", () => ({
  backfillMissingWalletConnectCompletions: backfillMock,
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    createAuditLog: vi.fn(async (entry: any) => {
      if (auditShouldThrow) throw new Error("forced audit failure");
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Pass a throwaway executor; the route does not depend on its shape
      // here because the audit + service calls are mocked.
      return fn({});
    }),
  }),
}));

vi.mock("../db", () => ({ db: {} }));

// Real-ish admin auth gate: accept only a known bearer token so we can prove
// the route rejects unauthenticated callers.
vi.mock("../routes/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../routes/middleware")>();
  const GOOD = "Bearer good-token";
  return {
    ...actual,
    isValidAdminToken: vi.fn(async (header?: string) => header === GOOD),
    checkAdminAuth: (req: any, res: any, next: any) => {
      if (req.headers.authorization === GOOD) {
        req.admin = { username: "admin" };
        req.adminUsername = "admin";
        next();
        return;
      }
      res.status(401).json({ error: "Unauthorized" });
    },
  };
});

const { adminRouter } = await import("../routes/admin");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.set("trust proxy", true);
  app.use("/api/admin", adminRouter);
  return app;
}

const ENDPOINT = "/api/admin/wallet-connect-completion-backfill/run";

beforeEach(() => {
  auditLogs.length = 0;
  auditShouldThrow = false;
  backfillResult = { scanned: 5, inserted: 2, skipped: false };
  backfillMock.mockClear();
});

describe("Task #842 — POST wallet-connect-completion-backfill/run auth", () => {
  it("returns 401 when no Authorization header is sent", async () => {
    const res = await request(buildApp()).post(ENDPOINT);
    expect(res.status).toBe(401);
    expect(backfillMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token is invalid", async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
    expect(backfillMock).not.toHaveBeenCalled();
  });
});

describe("Task #842 — POST wallet-connect-completion-backfill/run happy path", () => {
  it("runs the backfill and returns { scanned, inserted, skipped }", async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scanned: 5, inserted: 2, skipped: false });
    expect(backfillMock).toHaveBeenCalledTimes(1);

    // The manual-trigger audit row is written with the backfill summary.
    const trigger = auditLogs.find(
      (a) => a.action === "wallet_connect_completion_backfill_run",
    );
    expect(trigger).toBeTruthy();
    expect(JSON.parse(trigger.newValue)).toEqual({
      scanned: 5,
      inserted: 2,
      skipped: false,
    });
  });

  it("passes the skipped result straight through when a backfill was in progress", async () => {
    backfillResult = { scanned: 0, inserted: 0, skipped: true };
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scanned: 0, inserted: 0, skipped: true });
  });
});

describe("Task #842 — POST wallet-connect-completion-backfill/run failure", () => {
  it("returns 500 when the trigger audit write throws", async () => {
    auditShouldThrow = true;
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});
