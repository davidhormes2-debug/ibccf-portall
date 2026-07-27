// Tests for heartbeat graceful degradation when the DB is unavailable.
//
// When HEARTBEAT_DEGRADED_ON_DB_FAIL=true and getActiveVisitorByVisitorId
// rejects with a transient DB error, the endpoint should return 202 with
// { success: false, degraded: true } instead of 500.

import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

// Mock the db module so the import of visitors router doesn't throw
// "DATABASE_URL is not set" at module load time.
vi.mock("../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  },
}));

const { createStorageMock, atomicCounters } = await vi.hoisted(async () => {
  const { createStorageMock } = await import("./helpers/storageMock");
  const atomicCounters = new Map<string, number>();
  return { createStorageMock, atomicCounters };
});

// Transient DB error message that matches isTransientDbError patterns.
const TRANSIENT_ERR = new Error(
  "Failed query: select ... from active_visitors where ...",
);

vi.mock("../storage", () => ({
  DatabaseStorage: class MockDatabaseStorage {
    static readonly ACTIVE_VISITOR_STALE_MS = 60_000;
  },
  storage: createStorageMock({
    getActiveVisitorByVisitorId: vi.fn(async () => {
      throw TRANSIENT_ERR;
    }),
    isVisitorBlocked: vi.fn(async () => false),
    isIpAddressBlocked: vi.fn(async () => false),
    countActiveVisitorsByIp: vi.fn(async () => 0),
    createActiveVisitor: vi.fn(async () => ({ id: "v-1" })),
    cleanupStaleVisitors: vi.fn(async () => 0),
    atomicIncrementRateLimit: vi.fn(
      async ({ key, windowResetAt }: { key: string; windowResetAt: Date }) => {
        const prev = atomicCounters.get(key) ?? 0;
        const next = prev + 1;
        atomicCounters.set(key, next);
        return { count: next, resetAt: windowResetAt };
      },
    ),
  }),
}));

const visitorsRouter = (await import("../routes/visitors")).default;

function buildApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/visitors", visitorsRouter);
  return app;
}

const HB_BODY = { visitorId: "v_test_123", currentPage: "/test" };

describe("POST /api/visitors/heartbeat — degraded mode on transient DB failure", () => {
  beforeAll(() => {
    atomicCounters.clear();
  });

  it("returns 500 (default) when HEARTBEAT_DEGRADED_ON_DB_FAIL is not set", async () => {
    delete process.env.HEARTBEAT_DEGRADED_ON_DB_FAIL;
    const res = await request(buildApp())
      .post("/api/visitors/heartbeat")
      .set("x-forwarded-for", "1.2.3.4")
      .send(HB_BODY);
    expect(res.status).toBe(500);
  });

  it("returns 202 with { degraded: true } when HEARTBEAT_DEGRADED_ON_DB_FAIL=true", async () => {
    process.env.HEARTBEAT_DEGRADED_ON_DB_FAIL = "true";
    try {
      const res = await request(buildApp())
        .post("/api/visitors/heartbeat")
        .set("x-forwarded-for", "1.2.3.5")
        .send(HB_BODY);
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ success: false, degraded: true });
    } finally {
      delete process.env.HEARTBEAT_DEGRADED_ON_DB_FAIL;
    }
  });

  it("does NOT degrade for non-transient errors even with HEARTBEAT_DEGRADED_ON_DB_FAIL=true", async () => {
    // Override getActiveVisitorByVisitorId to throw a non-transient error.
    const { storage } = await import("../storage");
    vi.mocked(storage.getActiveVisitorByVisitorId).mockRejectedValueOnce(
      new Error("permission denied for table active_visitors"),
    );

    process.env.HEARTBEAT_DEGRADED_ON_DB_FAIL = "true";
    try {
      const res = await request(buildApp())
        .post("/api/visitors/heartbeat")
        .set("x-forwarded-for", "1.2.3.6")
        .send({ visitorId: "v_perm_err", currentPage: "/test" });
      // Permission errors are not transient → should still return 500.
      expect(res.status).toBe(500);
    } finally {
      delete process.env.HEARTBEAT_DEGRADED_ON_DB_FAIL;
    }
  });
});
