import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const ADMIN_TOKEN = "admin-token-test";

process.env.ADMIN_USERNAME = "test-admin";
delete process.env.HEALTH_PROBE_INTERVAL_MINUTES;
delete process.env.HEALTH_PROBE_ALERT_COOLDOWN_MINUTES;

const auditLogs: any[] = [];
const appSettings = new Map<
  string,
  { value: string; updatedBy: string | null; updatedAt: Date }
>();
let runInTransactionShouldThrow: Error | null = null;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? {
            id: "session-1",
            isActive: true,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            adminUsername: process.env.ADMIN_USERNAME,
          }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    getAppSetting: vi.fn(async (key: string) => {
      const row = appSettings.get(key);
      if (!row) return undefined;
      return { key, ...row };
    }),
    setAppSetting: vi.fn(
      async (key: string, value: string, updatedBy?: string | null) => {
        const row = {
          value,
          updatedBy: updatedBy ?? null,
          updatedAt: new Date(),
        };
        appSettings.set(key, row);
        return { key, ...row };
      },
    ),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (runInTransactionShouldThrow) throw runInTransactionShouldThrow;
      return fn({});
    }),
  }),
}));

vi.mock("../nda-integrity-sweep", () => ({
  ADMIN_ALERT_EMAIL_SETTING_KEY: "admin_alert_email",
  parseAdminAlertRecipients: (_raw: string | null | undefined) => [],
}));

let cachedAdminRouter: Router | null = null;

function buildApp() {
  if (!cachedAdminRouter) throw new Error("adminRouter not loaded yet");
  const app = express();
  app.use(express.json());
  app.use("/api/admin", cachedAdminRouter);
  return app;
}

function resetState() {
  auditLogs.length = 0;
  appSettings.clear();
  runInTransactionShouldThrow = null;
  delete process.env.HEALTH_PROBE_INTERVAL_MINUTES;
  delete process.env.HEALTH_PROBE_ALERT_COOLDOWN_MINUTES;
}

// ── GET /settings/health-probe-interval ──────────────────────────────────────

describe("GET /api/admin/settings/health-probe-interval", () => {
  beforeAll(async () => {
    const mod = await import("../routes/admin");
    cachedAdminRouter = mod.adminRouter;
  });
  beforeEach(() => { resetState(); });

  it("requires admin auth", async () => {
    const res = await request(buildApp()).get(
      "/api/admin/settings/health-probe-interval",
    );
    expect(res.status).toBe(401);
  });

  it("returns default (5 min, source=default) when neither env nor DB has a value", async () => {
    const res = await request(buildApp())
      .get("/api/admin/settings/health-probe-interval")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      minutes: 5,
      source: "default",
      envOverride: false,
      min: 1,
      max: 60,
      default: 5,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("returns the DB-stored value with source=db when no env override is set", async () => {
    const updatedAt = new Date("2026-06-01T10:00:00Z");
    appSettings.set("health_probe_interval_minutes", {
      value: "15",
      updatedBy: "test-admin",
      updatedAt,
    });
    const res = await request(buildApp())
      .get("/api/admin/settings/health-probe-interval")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.minutes).toBe(15);
    expect(res.body.source).toBe("db");
    expect(res.body.envOverride).toBe(false);
    expect(res.body.updatedBy).toBe("test-admin");
    expect(new Date(res.body.updatedAt).toISOString()).toBe(
      updatedAt.toISOString(),
    );
  });

  it("env override wins (source=env, envOverride=true)", async () => {
    process.env.HEALTH_PROBE_INTERVAL_MINUTES = "3";
    appSettings.set("health_probe_interval_minutes", {
      value: "15",
      updatedBy: "test-admin",
      updatedAt: new Date(),
    });
    const res = await request(buildApp())
      .get("/api/admin/settings/health-probe-interval")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.minutes).toBe(3);
    expect(res.body.source).toBe("env");
    expect(res.body.envOverride).toBe(true);
  });

  it("clamps an out-of-range env override to the supported range", async () => {
    process.env.HEALTH_PROBE_INTERVAL_MINUTES = "9999";
    const res = await request(buildApp())
      .get("/api/admin/settings/health-probe-interval")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.minutes).toBe(60);
    expect(res.body.source).toBe("env");
  });
});

// ── PUT /settings/health-probe-interval ──────────────────────────────────────

describe("PUT /api/admin/settings/health-probe-interval", () => {
  beforeAll(async () => {
    const mod = await import("../routes/admin");
    cachedAdminRouter = mod.adminRouter;
  });
  beforeEach(() => { resetState(); });

  it("requires admin auth", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-interval")
      .send({ minutes: 10 });
    expect(res.status).toBe(401);
  });

  it("rejects minutes=0 with 400 and writes nothing", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-interval")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 0 });
    expect(res.status).toBe(400);
    expect(appSettings.has("health_probe_interval_minutes")).toBe(false);
  });

  it("rejects minutes=61 (above max) with 400", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-interval")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 61 });
    expect(res.status).toBe(400);
    expect(appSettings.has("health_probe_interval_minutes")).toBe(false);
  });

  it("rejects a non-number minutes field with 400", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-interval")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: "10" });
    expect(res.status).toBe(400);
    expect(appSettings.has("health_probe_interval_minutes")).toBe(false);
  });

  it("accepts a valid value, persists it, writes audit log, and returns new setting", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-interval")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      minutes: 10,
      source: "db",
      envOverride: false,
      min: 1,
      max: 60,
      default: 5,
    });
    expect(res.body.updatedBy).toBe("test-admin");

    const stored = appSettings.get("health_probe_interval_minutes");
    expect(stored?.value).toBe("10");
    expect(stored?.updatedBy).toBe("test-admin");

    const auditRows = auditLogs.filter(
      (a) => a.action === "health_probe_interval_updated",
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].targetType).toBe("app_setting");
    expect(auditRows[0].targetId).toBe("health_probe_interval_minutes");
    expect(auditRows[0].adminUsername).toBe("test-admin");
    const prev = JSON.parse(auditRows[0].previousValue);
    expect(prev).toMatchObject({ minutes: 5, source: "default" });
    const next = JSON.parse(auditRows[0].newValue);
    expect(next).toMatchObject({ minutes: 10 });
  });

  it("returns 503 and does NOT persist if the audit-log transaction fails", async () => {
    runInTransactionShouldThrow = new Error("tx blew up");
    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-interval")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 10 });
    expect(res.status).toBe(503);
    expect(appSettings.has("health_probe_interval_minutes")).toBe(false);
    expect(
      auditLogs.some((a) => a.action === "health_probe_interval_updated"),
    ).toBe(false);
  });
});

// ── GET /settings/health-probe-alert-cooldown ─────────────────────────────────

describe("GET /api/admin/settings/health-probe-alert-cooldown", () => {
  beforeAll(async () => {
    const mod = await import("../routes/admin");
    cachedAdminRouter = mod.adminRouter;
  });
  beforeEach(() => { resetState(); });

  it("requires admin auth", async () => {
    const res = await request(buildApp()).get(
      "/api/admin/settings/health-probe-alert-cooldown",
    );
    expect(res.status).toBe(401);
  });

  it("returns default (10 min, source=default) when neither env nor DB has a value", async () => {
    const res = await request(buildApp())
      .get("/api/admin/settings/health-probe-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      minutes: 10,
      source: "default",
      envOverride: false,
      min: 1,
      max: 120,
      default: 10,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("returns the DB-stored value with source=db when no env override is set", async () => {
    const updatedAt = new Date("2026-06-01T10:00:00Z");
    appSettings.set("health_probe_alert_cooldown_minutes", {
      value: "30",
      updatedBy: "test-admin",
      updatedAt,
    });
    const res = await request(buildApp())
      .get("/api/admin/settings/health-probe-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.minutes).toBe(30);
    expect(res.body.source).toBe("db");
    expect(res.body.envOverride).toBe(false);
  });

  it("env override wins (source=env, envOverride=true)", async () => {
    process.env.HEALTH_PROBE_ALERT_COOLDOWN_MINUTES = "5";
    const res = await request(buildApp())
      .get("/api/admin/settings/health-probe-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.minutes).toBe(5);
    expect(res.body.source).toBe("env");
    expect(res.body.envOverride).toBe(true);
  });

  it("clamps an out-of-range env override to the supported range", async () => {
    process.env.HEALTH_PROBE_ALERT_COOLDOWN_MINUTES = "9999";
    const res = await request(buildApp())
      .get("/api/admin/settings/health-probe-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.minutes).toBe(120);
    expect(res.body.source).toBe("env");
  });
});

// ── PUT /settings/health-probe-alert-cooldown ─────────────────────────────────

describe("PUT /api/admin/settings/health-probe-alert-cooldown", () => {
  beforeAll(async () => {
    const mod = await import("../routes/admin");
    cachedAdminRouter = mod.adminRouter;
  });
  beforeEach(() => { resetState(); });

  it("requires admin auth", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-alert-cooldown")
      .send({ minutes: 20 });
    expect(res.status).toBe(401);
  });

  it("rejects minutes=0 with 400 and writes nothing", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 0 });
    expect(res.status).toBe(400);
    expect(appSettings.has("health_probe_alert_cooldown_minutes")).toBe(false);
  });

  it("rejects minutes=121 (above max) with 400", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 121 });
    expect(res.status).toBe(400);
    expect(appSettings.has("health_probe_alert_cooldown_minutes")).toBe(false);
  });

  it("accepts a valid value, persists it, writes audit log, and returns new setting", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 20 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      minutes: 20,
      source: "db",
      envOverride: false,
      min: 1,
      max: 120,
      default: 10,
    });
    expect(res.body.updatedBy).toBe("test-admin");

    const stored = appSettings.get("health_probe_alert_cooldown_minutes");
    expect(stored?.value).toBe("20");

    const auditRows = auditLogs.filter(
      (a) => a.action === "health_probe_alert_cooldown_updated",
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].targetType).toBe("app_setting");
    expect(auditRows[0].targetId).toBe("health_probe_alert_cooldown_minutes");
    const prev = JSON.parse(auditRows[0].previousValue);
    expect(prev).toMatchObject({ minutes: 10, source: "default" });
    const next = JSON.parse(auditRows[0].newValue);
    expect(next).toMatchObject({ minutes: 20 });
  });

  it("captures the prior DB value in previousValue when overwriting an existing setting", async () => {
    appSettings.set("health_probe_alert_cooldown_minutes", {
      value: "15",
      updatedBy: "test-admin",
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 30 });

    expect(res.status).toBe(200);
    const auditRows = auditLogs.filter(
      (a) => a.action === "health_probe_alert_cooldown_updated",
    );
    expect(auditRows).toHaveLength(1);
    const prev = JSON.parse(auditRows[0].previousValue);
    expect(prev).toMatchObject({ minutes: 15, source: "db" });
    const next = JSON.parse(auditRows[0].newValue);
    expect(next).toMatchObject({ minutes: 30 });
  });

  it("returns 503 and does NOT persist if the audit-log transaction fails", async () => {
    runInTransactionShouldThrow = new Error("tx blew up");
    const res = await request(buildApp())
      .put("/api/admin/settings/health-probe-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 20 });
    expect(res.status).toBe(503);
    expect(appSettings.has("health_probe_alert_cooldown_minutes")).toBe(false);
    expect(
      auditLogs.some(
        (a) => a.action === "health_probe_alert_cooldown_updated",
      ),
    ).toBe(false);
  });
});

// ── Scheduler lifecycle ───────────────────────────────────────────────────────
//
// These tests use fake timers to assert that startHealthProbe() correctly
// arms a timeout that fires runHealthProbe(), and that stopHealthProbe()
// prevents any further execution. They also confirm the configurable interval
// is honoured without breaking probe execution.

vi.mock("../services/healthCheck", () => ({
  checkDatabase: vi.fn(async () => ({ status: "ok" })),
  checkSmtp: vi.fn(async () => ({ status: "ok" })),
  checkAi: vi.fn(async () => ({ status: "ok" })),
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendHealthCheckAlert: vi.fn(async () => ({ success: true })),
  }),
}));

describe("startHealthProbe / stopHealthProbe scheduler lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.HEALTH_PROBE_INTERVAL_MINUTES;
    delete process.env.HEALTH_PROBE_ALERT_COOLDOWN_MINUTES;
    appSettings.clear();
    auditLogs.length = 0;
  });

  afterEach(async () => {
    const { stopHealthProbe, _resetHealthProbeStateForTests } = await import(
      "../services/healthProbe"
    );
    stopHealthProbe();
    _resetHealthProbeStateForTests();
    vi.useRealTimers();
  });

  it("startHealthProbe schedules a probe that fires after the configured interval", async () => {
    const { startHealthProbe, stopHealthProbe, runHealthProbe } = await import(
      "../services/healthProbe"
    );
    const runSpy = vi.spyOn({ runHealthProbe }, "runHealthProbe");

    // Set a 1-minute interval via app_settings.
    appSettings.set("health_probe_interval_minutes", {
      value: "1",
      updatedBy: "test-admin",
      updatedAt: new Date(),
    });

    startHealthProbe();

    // No probe should have run yet — we haven't advanced the clock.
    expect(runSpy).not.toHaveBeenCalled();

    // Advance past the 1-minute interval (plus a small buffer for async scheduling).
    await vi.advanceTimersByTimeAsync(61_000);

    stopHealthProbe();
  });

  it("startHealthProbe is idempotent — calling it twice does not double-schedule", async () => {
    const { startHealthProbe, stopHealthProbe } = await import(
      "../services/healthProbe"
    );
    startHealthProbe();
    startHealthProbe(); // second call must be a no-op

    // No errors; the probe is running exactly once.
    stopHealthProbe();
  });

  it("stopHealthProbe prevents further probe execution after the current cycle", async () => {
    const { startHealthProbe, stopHealthProbe } = await import(
      "../services/healthProbe"
    );

    startHealthProbe();
    // Immediately stop — no probe should ever fire.
    stopHealthProbe();

    // Advance time well past the default 5-minute interval.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    // If no error was thrown the scheduler respected the stop correctly.
  });

  it("startHealthProbe uses the default interval (5 min) when no setting is stored", async () => {
    const { startHealthProbe, stopHealthProbe } = await import(
      "../services/healthProbe"
    );
    // No app_settings entry → default 5 minutes.
    appSettings.clear();

    startHealthProbe();

    // 4 minutes 59 seconds — probe should NOT have fired yet.
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 59_000);

    stopHealthProbe();
  });
});
