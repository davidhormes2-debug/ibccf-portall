import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Server tests for GET /api/admin/emergency-reset-activity (Task #2403)
//
// Surfaces recent admin_emergency_reset_requested/used audit events so
// admins can see lockout-recovery activity for security awareness.
//
// checkAdminAuth is NOT bypassed here — the real middleware runs against a
// mocked storage so the unauthenticated-401 test exercises the actual
// production code path.
// ============================================================================

const ADMIN_TOKEN = "test-admin-token";
const ADMIN_USERNAME = "test-admin";
process.env.ADMIN_USERNAME = ADMIN_USERNAME;

const emergencyResetLogs = [
  {
    id: 2,
    adminUsername: "unauthenticated",
    action: "admin_emergency_reset_used",
    targetType: "admin_account",
    targetId: null,
    previousValue: null,
    newValue: null,
    ipAddress: "203.0.113.5",
    userAgent: null,
    createdAt: new Date("2026-07-01T10:00:00Z"),
  },
  {
    id: 1,
    adminUsername: "unauthenticated",
    action: "admin_emergency_reset_requested",
    targetType: "admin_account",
    targetId: null,
    previousValue: null,
    newValue: null,
    ipAddress: "203.0.113.5",
    userAgent: null,
    createdAt: new Date("2026-07-01T09:55:00Z"),
  },
];

const getEmergencyResetAuditLogs = vi.fn(async () => emergencyResetLogs);

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? {
            id: "session-1",
            adminUsername: ADMIN_USERNAME,
            isActive: true,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getEmergencyResetAuditLogs,
    isIpBlocked: vi.fn(async () => false),
  }),
}));

vi.mock("../static", () => ({
  getBuildStamp: vi.fn(() => "test-build"),
  getBootTimeIso: vi.fn(() => new Date().toISOString()),
}));

vi.mock("../services/portal-auth", () => ({
  isAuthorizedForCase: vi.fn(async () => false),
  isPortalSessionValidForCase: vi.fn(async () => false),
}));

vi.mock("../middleware", () => ({
  loginRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

const { adminRouter } = await import("../routes/admin");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

const app = buildApp();
const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };

describe("GET /api/admin/emergency-reset-activity", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/admin/emergency-reset-activity");
    expect(res.status).toBe(401);
  });

  it("returns recent emergency reset events with timestamp + IP, newest first", async () => {
    const res = await request(app)
      .get("/api/admin/emergency-reset-activity")
      .set(auth);
    expect(res.status).toBe(200);
    expect(getEmergencyResetAuditLogs).toHaveBeenCalledWith(20);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0]).toMatchObject({
      id: 2,
      action: "admin_emergency_reset_used",
      ipAddress: "203.0.113.5",
    });
    expect(res.body.events[1]).toMatchObject({
      id: 1,
      action: "admin_emergency_reset_requested",
    });
  });

  it("surfaces lastUsedAt as the most recent 'used' event timestamp", async () => {
    const res = await request(app)
      .get("/api/admin/emergency-reset-activity")
      .set(auth);
    expect(res.status).toBe(200);
    expect(new Date(res.body.lastUsedAt).toISOString()).toBe(
      new Date("2026-07-01T10:00:00Z").toISOString(),
    );
  });

  it("returns a null lastUsedAt when no reset has ever been completed", async () => {
    getEmergencyResetAuditLogs.mockResolvedValueOnce([emergencyResetLogs[1]]);
    const res = await request(app)
      .get("/api/admin/emergency-reset-activity")
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.lastUsedAt).toBeNull();
    expect(res.body.events).toHaveLength(1);
  });
});
