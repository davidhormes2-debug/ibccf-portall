import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// Tests for GET /api/admin/community-thread-views-cleanup/count
//
// Verifies:
//   1. The route is guarded by admin bearer auth (401 without a valid token),
//      and never invokes the count service when unauthenticated.
//   2. Happy path: returns { staleCount, cutoff, ttlHours } with a numeric staleCount.
//   3. A null return from countStaleCommunityThreadViews propagates as staleCount: null
//      in the 200 response (the function swallows its own errors and returns null).
//   4. An unexpected throw from countStaleCommunityThreadViews surfaces as 500.

let staleCountResult: number | null = 5;
let countShouldThrow = false;
const countMock = vi.fn(async () => {
  if (countShouldThrow) throw new Error("forced count failure");
  return staleCountResult;
});

vi.mock("../community-thread-views-cleanup", () => ({
  countStaleCommunityThreadViews: countMock,
  COMMUNITY_THREAD_VIEWS_TTL_HOURS: 48,
  runCommunityThreadViewsCleanup: vi.fn(async () => ({
    deleted: 0,
    cutoff: new Date().toISOString(),
    skipped: false,
  })),
  deleteStaleCommunityThreadViews: vi.fn(async () => []),
  startCommunityThreadViewsCleanupSweep: vi.fn(() => undefined),
  COMMUNITY_THREAD_VIEWS_CLEANUP_AUDIT_ACTION: "community_thread_views_cleanup",
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({}),
}));

vi.mock("../db", () => ({ db: {} }));

vi.mock("../lib/warnOnce", () => ({
  warnOnce: vi.fn(),
}));

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

const ENDPOINT = "/api/admin/community-thread-views-cleanup/count";

beforeEach(() => {
  staleCountResult = 5;
  countShouldThrow = false;
  countMock.mockClear();
});

describe("GET /api/admin/community-thread-views-cleanup/count — auth", () => {
  it("returns 401 when no Authorization header is sent", async () => {
    const res = await request(buildApp()).get(ENDPOINT);
    expect(res.status).toBe(401);
    expect(countMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token is invalid", async () => {
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
    expect(countMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/community-thread-views-cleanup/count — happy path", () => {
  it("returns staleCount, cutoff and ttlHours for a non-zero count", async () => {
    staleCountResult = 5;
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body.staleCount).toBe(5);
    expect(res.body.ttlHours).toBe(48);
    expect(typeof res.body.cutoff).toBe("string");
    expect(Number.isNaN(new Date(res.body.cutoff).getTime())).toBe(false);
    expect(countMock).toHaveBeenCalledTimes(1);
  });

  it("returns staleCount 0 when there are no stale rows", async () => {
    staleCountResult = 0;
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body.staleCount).toBe(0);
    expect(res.body.ttlHours).toBe(48);
  });

  it("returns staleCount: null when the count service returns null (query failed internally)", async () => {
    staleCountResult = null;
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body.staleCount).toBeNull();
    expect(res.body.ttlHours).toBe(48);
  });

  it("includes a cutoff ISO timestamp roughly 48 hours before now", async () => {
    staleCountResult = 3;
    const before = Date.now();
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");
    const after = Date.now();

    expect(res.status).toBe(200);
    const cutoffMs = new Date(res.body.cutoff).getTime();
    const expectedCutoffMs = before - 48 * 60 * 60 * 1000;
    expect(cutoffMs).toBeGreaterThanOrEqual(expectedCutoffMs - 2000);
    expect(cutoffMs).toBeLessThanOrEqual(after);
  });
});

describe("GET /api/admin/community-thread-views-cleanup/count — failure", () => {
  it("returns 500 with an error body when the count service throws", async () => {
    countShouldThrow = true;
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toBeTruthy();
  });
});
