import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "reactivation-counts-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

let pendingCounts: Record<string, number> = {};

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getAdminPermissions: vi.fn(async () => null),
    getReactivationPendingCounts: vi.fn(async () => pendingCounts),
  }),
}));

// Import AFTER mocks.
const { depositsRouter } = await import("../routes/deposits");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/deposits", depositsRouter);
  return app;
}

const auth = { Authorization: `Bearer admin-token` };

describe("GET /api/deposits/reactivation-pending-counts", () => {
  it("requires admin auth — returns 401 without bearer token", async () => {
    const res = await request(buildApp()).get(
      "/api/deposits/reactivation-pending-counts",
    );
    expect(res.status).toBe(401);
  });

  it("returns empty counts object when no receipts are pending", async () => {
    pendingCounts = {};
    const res = await request(buildApp())
      .get("/api/deposits/reactivation-pending-counts")
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ counts: {} });
  });

  it("returns the per-case pending counts map keyed by caseId", async () => {
    pendingCounts = { "case-a": 2, "case-b": 1 };
    const res = await request(buildApp())
      .get("/api/deposits/reactivation-pending-counts")
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ counts: { "case-a": 2, "case-b": 1 } });
  });
});
