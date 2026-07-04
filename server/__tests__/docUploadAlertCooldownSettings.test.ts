import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import type { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const ADMIN_TOKEN = "admin-token-test";

process.env.ADMIN_USERNAME = "test-admin";
delete process.env.ADMIN_ALERT_EMAIL;
delete process.env.DOC_UPLOAD_ALERT_COOLDOWN_MINUTES;

const auditLogs: any[] = [];
const appSettings = new Map<
  string,
  { value: string; updatedBy: string | null; updatedAt: Date }
>();
let runInTransactionShouldThrow: Error | null = null;
let adminAlertRecipients: string[] = ["ops@example.com"];
const sendAlertCalls: any[] = [];

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
  parseAdminAlertRecipients: (raw: string | null | undefined) => {
    if (!raw) return [];
    return adminAlertRecipients;
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendUserDocumentUploadedAlert: vi.fn(async (opts: any) => {
      sendAlertCalls.push({ opts, at: Date.now() });
      return { success: true };
    }),
  }),
}));

let cachedAdminRouter: Router | null = null;

function buildApp() {
  if (!cachedAdminRouter) {
    throw new Error("adminRouter not loaded yet");
  }
  const app = express();
  app.use(express.json());
  app.use("/api/admin", cachedAdminRouter);
  return app;
}

function resetState() {
  auditLogs.length = 0;
  sendAlertCalls.length = 0;
  appSettings.clear();
  adminAlertRecipients = ["ops@example.com"];
  appSettings.set("admin_alert_email", {
    value: "ops@example.com",
    updatedBy: null,
    updatedAt: new Date(),
  });
  runInTransactionShouldThrow = null;
  delete process.env.DOC_UPLOAD_ALERT_COOLDOWN_MINUTES;
}

describe("GET /api/admin/settings/doc-upload-alert-cooldown (Task #324)", () => {
  beforeAll(async () => {
    const mod = await import("../routes/admin");
    cachedAdminRouter = mod.adminRouter;
  });

  beforeEach(() => {
    resetState();
  });

  it("requires admin auth", async () => {
    const res = await request(buildApp())
      .get("/api/admin/settings/doc-upload-alert-cooldown");
    expect(res.status).toBe(401);
  });

  it("returns the default (30 min) with source='default' when neither env nor DB has a value", async () => {
    const res = await request(buildApp())
      .get("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      minutes: 30,
      source: "default",
      envOverride: false,
      min: 1,
      max: 1440,
      default: 30,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("returns the DB-stored value with source='db' and metadata when no env override is set", async () => {
    const updatedAt = new Date("2026-05-01T12:00:00Z");
    appSettings.set("doc_upload_alert_cooldown_minutes", {
      value: "45",
      updatedBy: "test-admin",
      updatedAt,
    });

    const res = await request(buildApp())
      .get("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.minutes).toBe(45);
    expect(res.body.source).toBe("db");
    expect(res.body.envOverride).toBe(false);
    expect(res.body.updatedBy).toBe("test-admin");
    expect(new Date(res.body.updatedAt).toISOString()).toBe(
      updatedAt.toISOString(),
    );
  });

  it("env override wins over the DB value (source='env', envOverride=true)", async () => {
    process.env.DOC_UPLOAD_ALERT_COOLDOWN_MINUTES = "5";
    // DB value is present but must be ignored for `minutes`/`source`.
    appSettings.set("doc_upload_alert_cooldown_minutes", {
      value: "45",
      updatedBy: "test-admin",
      updatedAt: new Date("2026-05-01T12:00:00Z"),
    });

    const res = await request(buildApp())
      .get("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.minutes).toBe(5);
    expect(res.body.source).toBe("env");
    expect(res.body.envOverride).toBe(true);
    // The stored DB metadata is still surfaced for visibility even when env wins.
    expect(res.body.updatedBy).toBe("test-admin");
  });

  it("clamps an out-of-range env override to the supported range", async () => {
    process.env.DOC_UPLOAD_ALERT_COOLDOWN_MINUTES = "9999";
    const res = await request(buildApp())
      .get("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.minutes).toBe(1440);
    expect(res.body.source).toBe("env");
  });
});

describe("PUT /api/admin/settings/doc-upload-alert-cooldown (Task #324)", () => {
  beforeAll(async () => {
    const mod = await import("../routes/admin");
    cachedAdminRouter = mod.adminRouter;
  });

  beforeEach(() => {
    resetState();
  });

  it("requires admin auth", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/doc-upload-alert-cooldown")
      .send({ minutes: 60 });
    expect(res.status).toBe(401);
  });

  it("rejects minutes=0 with 400 and writes nothing", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 0 });
    expect(res.status).toBe(400);
    expect(appSettings.has("doc_upload_alert_cooldown_minutes")).toBe(false);
    expect(
      auditLogs.some((a) => a.action === "doc_upload_alert_cooldown_updated"),
    ).toBe(false);
  });

  it("rejects minutes=1441 (above max) with 400", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 1441 });
    expect(res.status).toBe(400);
    expect(appSettings.has("doc_upload_alert_cooldown_minutes")).toBe(false);
  });

  it("rejects NaN with 400", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: Number.NaN });
    expect(res.status).toBe(400);
    expect(appSettings.has("doc_upload_alert_cooldown_minutes")).toBe(false);
  });

  it("rejects a non-number minutes field with 400", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: "60" });
    expect(res.status).toBe(400);
    expect(appSettings.has("doc_upload_alert_cooldown_minutes")).toBe(false);
  });

  it("accepts a valid value, persists it, writes a doc_upload_alert_cooldown_updated audit row, and returns the new setting", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 60 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      minutes: 60,
      source: "db",
      envOverride: false,
      min: 1,
      max: 1440,
      default: 30,
    });
    expect(res.body.updatedBy).toBe("test-admin");

    const stored = appSettings.get("doc_upload_alert_cooldown_minutes");
    expect(stored?.value).toBe("60");
    expect(stored?.updatedBy).toBe("test-admin");

    const auditRows = auditLogs.filter(
      (a) => a.action === "doc_upload_alert_cooldown_updated",
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].targetType).toBe("app_setting");
    expect(auditRows[0].targetId).toBe("doc_upload_alert_cooldown_minutes");
    expect(auditRows[0].adminUsername).toBe("test-admin");
    // previousValue captures the prior resolved minutes/source (default in this case).
    const prev = JSON.parse(auditRows[0].previousValue);
    expect(prev).toMatchObject({ minutes: 30, source: "default" });
    const next = JSON.parse(auditRows[0].newValue);
    expect(next).toMatchObject({ minutes: 60 });
  });

  it("captures the prior DB value in previousValue when overwriting an existing setting", async () => {
    appSettings.set("doc_upload_alert_cooldown_minutes", {
      value: "20",
      updatedBy: "test-admin",
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .put("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 90 });

    expect(res.status).toBe(200);
    const auditRows = auditLogs.filter(
      (a) => a.action === "doc_upload_alert_cooldown_updated",
    );
    expect(auditRows).toHaveLength(1);
    const prev = JSON.parse(auditRows[0].previousValue);
    expect(prev).toMatchObject({ minutes: 20, source: "db" });
    const next = JSON.parse(auditRows[0].newValue);
    expect(next).toMatchObject({ minutes: 90 });
  });

  it("returns 503 and does NOT persist the setting if the audit-log transaction fails", async () => {
    runInTransactionShouldThrow = new Error("audit insert blew up");

    const res = await request(buildApp())
      .put("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 60 });

    expect(res.status).toBe(503);
    expect(appSettings.has("doc_upload_alert_cooldown_minutes")).toBe(false);
    expect(
      auditLogs.some((a) => a.action === "doc_upload_alert_cooldown_updated"),
    ).toBe(false);
  });
});

describe("maybeAlertOnDocumentUpload honours a freshly-saved cooldown without restart (Task #324)", () => {
  beforeAll(async () => {
    const mod = await import("../routes/admin");
    cachedAdminRouter = mod.adminRouter;
  });

  beforeEach(() => {
    resetState();
  });

  it("re-reads the cooldown on every call so a new admin-saved value applies to the very next upload", async () => {
    const { maybeAlertOnDocumentUpload, docUploadAlertLastSentKey } =
      await import("../services/documentUploadAlert");

    const CASE_ID = "case-cooldown-live";
    const PARAMS = {
      caseId: CASE_ID,
      docId: 1,
      documentType: "Proof of Income",
      fileName: "doc.pdf",
    };

    // 1) Admin sets a long cooldown via the PUT endpoint.
    const put1 = await request(buildApp())
      .put("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 120 });
    expect(put1.status).toBe(200);

    // 2) First upload sends an alert and stamps the throttle key.
    await maybeAlertOnDocumentUpload(PARAMS);
    expect(sendAlertCalls).toHaveLength(1);
    expect(appSettings.get(docUploadAlertLastSentKey(CASE_ID))).toBeDefined();

    // 3) Simulate the throttle entry being ~2 minutes old. Under the 120-min
    //    cooldown this is well inside the window and the next upload would be
    //    suppressed — so we can prove the new cooldown took effect by
    //    showing an upload now slips through.
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    appSettings.set(docUploadAlertLastSentKey(CASE_ID), {
      value: twoMinAgo,
      updatedBy: "system",
      updatedAt: new Date(),
    });

    // Confirm the 120-min cooldown still suppresses a fresh send.
    await maybeAlertOnDocumentUpload(PARAMS);
    expect(sendAlertCalls).toHaveLength(1);

    // 4) Admin shortens the cooldown to 1 minute via the same endpoint.
    const put2 = await request(buildApp())
      .put("/api/admin/settings/doc-upload-alert-cooldown")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ minutes: 1 });
    expect(put2.status).toBe(200);

    // 5) Re-stamp the throttle to ~2 minutes ago, then upload again.
    //    With the new 1-min cooldown the dispatcher must allow the send
    //    on the very next invocation — no process restart.
    appSettings.set(docUploadAlertLastSentKey(CASE_ID), {
      value: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      updatedBy: "system",
      updatedAt: new Date(),
    });

    await maybeAlertOnDocumentUpload(PARAMS);
    expect(sendAlertCalls).toHaveLength(2);
  });
});
