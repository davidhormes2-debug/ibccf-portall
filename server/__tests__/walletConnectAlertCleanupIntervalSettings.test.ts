import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// Route tests for GET/PUT /api/admin/settings/wallet-connect-alert-cleanup-interval
//
// Covers:
//   1. Admin bearer auth gate — 401 without / with wrong token.
//   2. PUT Zod bounds — rejects ms below MIN or above MAX with 400.
//   3. Happy path — saves, writes the wallet_connect_alert_cleanup_interval_updated
//      audit row, calls applyCleanupIntervalChange, and returns the new setting.
//   4. Transaction failure — 503, nothing persisted.
//   5. GET returns the effective setting shape.

const MIN_MS = 60 * 1000;
const MAX_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MS = 60 * 60 * 1000;

process.env.ADMIN_USERNAME = "test-admin";
delete process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS;

const auditLogs: any[] = [];
let runInTransactionShouldThrow: Error | null = null;
let savedMs: number | null = null;

const applyChangeMock = vi.fn(async () => {});
const saveIntervalMock = vi.fn(async (ms: number) => {
  savedMs = ms;
  return ms;
});
const readIntervalMock = vi.fn(async () => ({
  ms: savedMs ?? DEFAULT_MS,
  source: savedMs !== null ? ("db" as const) : ("default" as const),
  envOverride: false,
  minMs: MIN_MS,
  maxMs: MAX_MS,
  defaultMs: DEFAULT_MS,
  updatedAt: savedMs !== null ? new Date("2026-01-01T00:00:00Z") : null,
  updatedBy: savedMs !== null ? "test-admin" : null,
  lastSweepAt: null,
  nextSweepAt: null,
}));

vi.mock("../services/walletConnectAlert", () => ({
  WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS: MIN_MS,
  WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS: MAX_MS,
  readWalletConnectAlertCleanupIntervalSetting: readIntervalMock,
  saveWalletConnectAlertCleanupIntervalMs: saveIntervalMock,
  applyCleanupIntervalChange: applyChangeMock,
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (runInTransactionShouldThrow) throw runInTransactionShouldThrow;
      return fn({});
    }),
  }),
}));

vi.mock("../db", () => ({ db: {} }));

// Lightweight admin-auth gate: accept only a known bearer so we can prove
// that unauthenticated callers are rejected before any business logic runs.
vi.mock("../routes/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../routes/middleware")>();
  const GOOD = "Bearer good-token";
  return {
    ...actual,
    isValidAdminToken: vi.fn(async (header?: string) => header === GOOD),
    checkAdminAuth: (req: any, res: any, next: any) => {
      if (req.headers.authorization === GOOD) {
        req.admin = { username: "test-admin" };
        req.adminUsername = "test-admin";
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

const ENDPOINT = "/api/admin/settings/wallet-connect-alert-cleanup-interval";

function resetState() {
  auditLogs.length = 0;
  savedMs = null;
  runInTransactionShouldThrow = null;
  saveIntervalMock.mockClear();
  applyChangeMock.mockClear();
  readIntervalMock.mockClear();
}

// ---------------------------------------------------------------------------
// GET — auth + shape
// ---------------------------------------------------------------------------

describe("GET /api/admin/settings/wallet-connect-alert-cleanup-interval — auth", () => {
  beforeEach(resetState);

  it("returns 401 without any Authorization header", async () => {
    const res = await request(buildApp()).get(ENDPOINT);
    expect(res.status).toBe(401);
    expect(readIntervalMock).not.toHaveBeenCalled();
  });

  it("returns 401 with a wrong bearer token", async () => {
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
    expect(readIntervalMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/settings/wallet-connect-alert-cleanup-interval — response shape", () => {
  beforeEach(resetState);

  it("returns 200 with the expected setting fields when no value is persisted", async () => {
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ms: DEFAULT_MS,
      source: "default",
      envOverride: false,
      minMs: MIN_MS,
      maxMs: MAX_MS,
      defaultMs: DEFAULT_MS,
      updatedAt: null,
      updatedBy: null,
      lastSweepAt: null,
      nextSweepAt: null,
    });
    expect(readIntervalMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// PUT — auth
// ---------------------------------------------------------------------------

describe("PUT /api/admin/settings/wallet-connect-alert-cleanup-interval — auth", () => {
  beforeEach(resetState);

  it("returns 401 without any Authorization header", async () => {
    const res = await request(buildApp())
      .put(ENDPOINT)
      .send({ ms: DEFAULT_MS });
    expect(res.status).toBe(401);
    expect(saveIntervalMock).not.toHaveBeenCalled();
  });

  it("returns 401 with an invalid bearer token", async () => {
    const res = await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer bad")
      .send({ ms: DEFAULT_MS });
    expect(res.status).toBe(401);
    expect(saveIntervalMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PUT — Zod bounds validation
// ---------------------------------------------------------------------------

describe("PUT /api/admin/settings/wallet-connect-alert-cleanup-interval — bounds validation", () => {
  beforeEach(resetState);

  it("rejects ms below the minimum (59999) with 400 and writes nothing", async () => {
    const res = await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer good-token")
      .send({ ms: MIN_MS - 1 });
    expect(res.status).toBe(400);
    expect(saveIntervalMock).not.toHaveBeenCalled();
    expect(auditLogs).toHaveLength(0);
  });

  it("rejects ms=0 with 400", async () => {
    const res = await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer good-token")
      .send({ ms: 0 });
    expect(res.status).toBe(400);
    expect(saveIntervalMock).not.toHaveBeenCalled();
  });

  it("rejects ms above the maximum (MAX+1) with 400", async () => {
    const res = await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer good-token")
      .send({ ms: MAX_MS + 1 });
    expect(res.status).toBe(400);
    expect(saveIntervalMock).not.toHaveBeenCalled();
    expect(auditLogs).toHaveLength(0);
  });

  it("rejects a string ms field with 400", async () => {
    const res = await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer good-token")
      .send({ ms: "3600000" });
    expect(res.status).toBe(400);
    expect(saveIntervalMock).not.toHaveBeenCalled();
  });

  it("rejects a missing ms field with 400", async () => {
    const res = await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer good-token")
      .send({});
    expect(res.status).toBe(400);
    expect(saveIntervalMock).not.toHaveBeenCalled();
  });

  it("accepts the minimum allowed value (60000 ms = 1 min)", async () => {
    const res = await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer good-token")
      .send({ ms: MIN_MS });
    expect(res.status).toBe(200);
  });

  it("accepts the maximum allowed value (7 days in ms)", async () => {
    resetState();
    const res = await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer good-token")
      .send({ ms: MAX_MS });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PUT — happy path
// ---------------------------------------------------------------------------

describe("PUT /api/admin/settings/wallet-connect-alert-cleanup-interval — happy path", () => {
  beforeEach(resetState);

  it("persists the value and returns the new setting shape", async () => {
    const res = await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer good-token")
      .send({ ms: DEFAULT_MS });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ms: DEFAULT_MS,
      envOverride: false,
      minMs: MIN_MS,
      maxMs: MAX_MS,
      defaultMs: DEFAULT_MS,
    });
    expect(saveIntervalMock).toHaveBeenCalledTimes(1);
    expect(saveIntervalMock).toHaveBeenCalledWith(DEFAULT_MS, expect.anything(), expect.anything());
  });

  it("writes a wallet_connect_alert_cleanup_interval_updated audit row", async () => {
    await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer good-token")
      .send({ ms: DEFAULT_MS });

    const row = auditLogs.find(
      (a) => a.action === "wallet_connect_alert_cleanup_interval_updated",
    );
    expect(row).toBeTruthy();
    expect(row.targetType).toBe("app_setting");
    expect(row.targetId).toBe("wallet_connect_alert_cleanup_interval_ms");
    expect(row.adminUsername).toBe("test-admin");

    const prev = JSON.parse(row.previousValue);
    expect(prev).toMatchObject({ ms: DEFAULT_MS, source: "default" });
    const next = JSON.parse(row.newValue);
    expect(next).toMatchObject({ ms: DEFAULT_MS });
  });

  it("calls applyCleanupIntervalChange after the transaction commits", async () => {
    await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer good-token")
      .send({ ms: 120 * 60 * 1000 });

    expect(applyChangeMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// PUT — transaction failure
// ---------------------------------------------------------------------------

describe("PUT /api/admin/settings/wallet-connect-alert-cleanup-interval — transaction failure", () => {
  beforeEach(resetState);

  it("returns 503 and does NOT call applyCleanupIntervalChange if the audit-log transaction fails", async () => {
    runInTransactionShouldThrow = new Error("forced tx failure");

    const res = await request(buildApp())
      .put(ENDPOINT)
      .set("Authorization", "Bearer good-token")
      .send({ ms: DEFAULT_MS });

    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
    // applyCleanupIntervalChange must NOT run — the setting was not committed.
    expect(applyChangeMock).not.toHaveBeenCalled();
    // No audit row because the transaction rolled back.
    expect(auditLogs).toHaveLength(0);
  });
});
