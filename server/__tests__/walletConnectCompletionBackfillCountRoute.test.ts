import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// API-level coverage for the read-only missing-completion count:
// GET /api/admin/wallet-connect-completion-backfill.
//
// Verifies:
//   1. The route is guarded by admin bearer auth (401 without a valid token),
//      and never invokes the count service when unauthenticated.
//   2. The happy path returns the { scanned, missing } shape verbatim.
//   3. A service failure surfaces as a 500 with an error body (the route's
//      try/catch), rather than leaking a stack or hanging.

let countResult = { scanned: 6, missing: 2 };
let countShouldThrow = false;
const countMock = vi.fn(async () => {
  if (countShouldThrow) throw new Error("forced count failure");
  return countResult;
});

vi.mock("../services/walletConnectAlert", () => ({
  countMissingWalletConnectCompletions: countMock,
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({}),
}));

vi.mock("../db", () => ({ db: {} }));

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

const ENDPOINT = "/api/admin/wallet-connect-completion-backfill";

beforeEach(() => {
  countResult = { scanned: 6, missing: 2 };
  countShouldThrow = false;
  countMock.mockClear();
});

describe("GET wallet-connect-completion-backfill auth", () => {
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

describe("GET wallet-connect-completion-backfill happy path", () => {
  it("returns the { scanned, missing } count", async () => {
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scanned: 6, missing: 2 });
    expect(countMock).toHaveBeenCalledTimes(1);
  });

  it("passes a zeroed count straight through when nothing is missing", async () => {
    countResult = { scanned: 4, missing: 0 };
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scanned: 4, missing: 0 });
  });
});

describe("GET wallet-connect-completion-backfill failure", () => {
  it("returns 500 with an error body when the count service throws", async () => {
    countShouldThrow = true;
    const res = await request(buildApp())
      .get(ENDPOINT)
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});
