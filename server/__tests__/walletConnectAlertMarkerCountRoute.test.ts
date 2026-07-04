import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// Task #823 — API-level coverage for the read-only orphaned-marker count:
// GET /api/admin/wallet-connect-alert-marker-cleanup.
//
// Verifies:
//   1. The route is guarded by admin bearer auth (401 without a valid token),
//      and never invokes the count service when unauthenticated.
//   2. The happy path returns the { scanned, orphaned } shape verbatim.
//   3. A service failure surfaces as a 500 with an error body (the route's
//      try/catch), rather than leaking a stack or hanging.

let countResult = { scanned: 7, orphaned: 3 };
let countShouldThrow = false;
const countMock = vi.fn(async () => {
  if (countShouldThrow) throw new Error("forced count failure");
  return countResult;
});

vi.mock("../services/walletConnectAlert", () => ({
  countOrphanedWalletConnectAlertMarkers: countMock,
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({}),
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

const ENDPOINT = "/api/admin/wallet-connect-alert-marker-cleanup";

beforeEach(() => {
  countResult = { scanned: 7, orphaned: 3 };
  countShouldThrow = false;
  countMock.mockClear();
});

describe("Task #823 — GET wallet-connect-alert-marker-cleanup auth", () => {
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

describe("Task #823 — GET wallet-connect-alert-marker-cleanup happy path", () => {
  it("returns the { scanned, orphaned } count", async () => {
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scanned: 7, orphaned: 3 });
    expect(countMock).toHaveBeenCalledTimes(1);
  });

  it("passes a zeroed count straight through when nothing is orphaned", async () => {
    countResult = { scanned: 0, orphaned: 0 };
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scanned: 0, orphaned: 0 });
  });
});

describe("Task #823 — GET wallet-connect-alert-marker-cleanup failure", () => {
  it("returns 500 with an error body when the count service throws", async () => {
    countShouldThrow = true;
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});
