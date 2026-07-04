import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ── Shared in-memory state ──────────────────────────────────────────────────
const auditLogs: any[] = [];
const appSettings = new Map<
  string,
  { value: string; updatedBy: string | null; updatedAt: Date }
>();
let auditShouldThrow = false;

// staged / committed pattern mirrors adminMutationTransactionsTask157.test.ts
type Staged = Record<string, unknown>;
const committed: Staged = {};
let staged: Staged = {};

function commitStaged() {
  for (const [k, v] of Object.entries(staged)) committed[k] = v;
  staged = {};
}

// ── Storage mock ────────────────────────────────────────────────────────────
vi.mock("../storage", () => ({
  storage: createStorageMock({
    createAuditLog: vi.fn(async (entry: any) => {
      if (auditShouldThrow) throw new Error("forced audit failure");
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      try {
        const r = await fn({});
        commitStaged();
        return r;
      } catch (err) {
        staged = {};
        throw err;
      }
    }),
    getAppSetting: vi.fn(async (key: string) => {
      const row = appSettings.get(key);
      if (!row) return undefined;
      return { key, ...row };
    }),
    setAppSetting: vi.fn(
      async (
        key: string,
        value: string,
        updatedBy?: string | null,
        _executor?: unknown,
      ) => {
        const row = {
          value,
          updatedBy: updatedBy ?? null,
          updatedAt: new Date(),
        };
        staged[key] = row;
        appSettings.set(key, row);
        return { key, ...row };
      },
    ),
    getAdminSessionByToken: vi.fn(async () => null),
    updateAdminSessionActivity: vi.fn(async () => {}),
  }),
}));

vi.mock("../db", () => ({ db: {} }));

// Controllable auth: set rejectAuth = true in a test to simulate an
// unauthenticated request; the middleware will return 401 just as the
// real checkAdminAuth does when no valid bearer token is supplied.
let rejectAuth = false;

vi.mock("../routes/middleware", () => ({
  checkAdminAuth: (req: any, res: any, next: any) => {
    if (rejectAuth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.admin = { username: "admin" };
    req.adminUsername = "admin";
    next();
  },
  isValidAdminToken: vi.fn(async () => true),
  invalidateBlockedIpsCache: vi.fn(),
  normalizeIp: (ip: string) => ip,
  getClientIp: () => "127.0.0.1",
}));

// Stub every nda-integrity-sweep export the admin router imports so it
// doesn't blow up when this module is loaded in isolation.
vi.mock("../nda-integrity-sweep", () => ({
  ADMIN_ALERT_EMAIL_SETTING_KEY: "admin_alert_email",
  NDA_INTEGRITY_SWEEP_INTERVAL_MIN_HOURS: 1,
  NDA_INTEGRITY_SWEEP_INTERVAL_MAX_HOURS: 720,
  NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MIN: 0,
  NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MAX: 720,
  NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_VALUES: [
    "never",
    "daily",
    "weekly",
  ] as const,
  parseAdminAlertRecipients: (raw: string | null | undefined) => {
    if (!raw) return [];
    return raw
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
  },
  readNdaIntegritySweepIntervalSetting: vi.fn(async () => ({
    hours: 24,
    source: "default",
    envOverride: false,
    storedHours: null,
    updatedAt: null,
    updatedBy: null,
  })),
  readNdaIntegritySweepSummaryFrequencySetting: vi.fn(async () => ({
    frequency: "never",
    source: "default",
    envOverride: false,
    storedValue: null,
    updatedAt: null,
    updatedBy: null,
    lastSummarySentAt: null,
  })),
  readNdaIntegritySweepStaleGraceSetting: vi.fn(async () => ({
    hours: 2,
    source: "default",
    envOverride: false,
    storedHours: null,
    updatedAt: null,
    updatedBy: null,
  })),
  readAdminAlertEmailSetting: vi.fn(async () => ({
    recipients: [],
    value: "",
    source: "default",
    envOverride: false,
    storedValue: "",
    updatedAt: null,
    updatedBy: null,
  })),
  saveNdaIntegritySweepIntervalHours: vi.fn(async () => 24),
  saveNdaIntegritySweepSummaryFrequency: vi.fn(async () => "never"),
  saveNdaIntegritySweepStaleGraceHours: vi.fn(async () => 2),
  saveAdminAlertEmailRecipients: vi.fn(async () => ({
    recipients: [],
    value: "",
    source: "default",
    envOverride: false,
    storedValue: "",
    updatedAt: null,
    updatedBy: null,
  })),
  applyNdaIntegritySweepIntervalChange: vi.fn(async () => 24),
  refreshNdaIntegritySweepStaleGraceCache: vi.fn(async () => {}),
}));

vi.mock("../services/runtimeFlags", () => ({
  NDA_SIGNING_LOCALES_KEY: "nda_signing_locales",
  NDA_SUPPORTED_LOCALES: ["en", "es", "fr", "de", "pt", "zh"] as const,
  NDA_DEFAULT_LOCALE: "en",
  readNdaSigningLocales: vi.fn(async () => ["en"]),
  getNdaSigningLocales: vi.fn(async () => ["en"]),
  setNdaSigningLocales: vi.fn(async () => ["en"]),
  primeNdaSigningLocalesCache: vi.fn(),
}));

vi.mock("../services/stampDuty", () => ({
  STAMP_DUTY_PAYMENT_WALLETS_KEY: "stamp_duty_payment_wallets",
  getStampDutyPaymentWallets: vi.fn(async () => []),
  setStampDutyPaymentWallets: vi.fn(async () => []),
}));

vi.mock("../audit-retention", () => ({
  AUDIT_LOG_RETENTION_MIN_DAYS: 1,
  AUDIT_LOG_RETENTION_MAX_DAYS: 3650,
  readAuditLogRetentionSetting: vi.fn(async () => ({
    days: 90,
    source: "default",
    envOverride: false,
    storedDays: null,
    updatedAt: null,
    updatedBy: null,
  })),
  runAuditLogSweep: vi.fn(async () => {}),
  saveAuditLogRetentionDays: vi.fn(async () => 90),
  refreshAuditLogRetentionCache: vi.fn(async () => {}),
}));

vi.mock("../community-cleanup", () => ({
  COMMUNITY_PARTICIPANT_RETENTION_MIN_DAYS: 1,
  COMMUNITY_PARTICIPANT_RETENTION_MAX_DAYS: 3650,
  readCommunityParticipantRetentionSetting: vi.fn(async () => ({
    days: 90,
    source: "default",
    envOverride: false,
    storedDays: null,
    updatedAt: null,
    updatedBy: null,
    preview: null,
  })),
  runCommunityParticipantCleanup: vi.fn(async () => ({ removed: 0 })),
  saveCommunityParticipantRetentionDays: vi.fn(async () => 90),
  refreshCommunityParticipantRetentionCache: vi.fn(async () => {}),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function resetState() {
  auditLogs.length = 0;
  for (const k of Object.keys(committed)) delete committed[k];
  staged = {};
  auditShouldThrow = false;
  rejectAuth = false;
  appSettings.clear();
  delete process.env.DOCUMENT_UPLOAD_ALERT_EMAIL;
  delete process.env.ADMIN_ALERT_EMAIL;
}

const { adminRouter } = await import("../routes/admin");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.set("trust proxy", true);
  app.use("/api/admin", adminRouter);
  return app;
}

// ── Unit tests: resolveDocumentUploadAlertRecipientsLocal ───────────────────

describe("resolveDocumentUploadAlertRecipientsLocal — three-tier resolution", () => {
  beforeEach(() => resetState());
  afterEach(() => {
    delete process.env.DOCUMENT_UPLOAD_ALERT_EMAIL;
    delete process.env.ADMIN_ALERT_EMAIL;
  });

  it("tier 1 — returns the env var value when DOCUMENT_UPLOAD_ALERT_EMAIL is set", async () => {
    process.env.DOCUMENT_UPLOAD_ALERT_EMAIL = "upload-watch@example.com";

    const { resolveDocumentUploadAlertRecipientsLocal } = await import(
      "../routes/content"
    );
    const recipients = await resolveDocumentUploadAlertRecipientsLocal();

    expect(recipients).toEqual(["upload-watch@example.com"]);
  });

  it("tier 1 — env var trumps a DB setting", async () => {
    process.env.DOCUMENT_UPLOAD_ALERT_EMAIL = "env-addr@example.com";
    appSettings.set("document_upload_alert_email", {
      value: "db-addr@example.com",
      updatedBy: null,
      updatedAt: new Date(),
    });

    const { resolveDocumentUploadAlertRecipientsLocal } = await import(
      "../routes/content"
    );
    const recipients = await resolveDocumentUploadAlertRecipientsLocal();

    expect(recipients).toEqual(["env-addr@example.com"]);
  });

  it("tier 1 — env var supports comma-separated lists", async () => {
    process.env.DOCUMENT_UPLOAD_ALERT_EMAIL =
      "a@example.com, b@example.com,c@example.com";

    const { resolveDocumentUploadAlertRecipientsLocal } = await import(
      "../routes/content"
    );
    const recipients = await resolveDocumentUploadAlertRecipientsLocal();

    expect(recipients).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("tier 2 — returns the DB value when env var is absent", async () => {
    appSettings.set("document_upload_alert_email", {
      value: "db-upload@example.com",
      updatedBy: "admin",
      updatedAt: new Date(),
    });

    const { resolveDocumentUploadAlertRecipientsLocal } = await import(
      "../routes/content"
    );
    const recipients = await resolveDocumentUploadAlertRecipientsLocal();

    expect(recipients).toEqual(["db-upload@example.com"]);
  });

  it("tier 3a — falls back to ADMIN_ALERT_EMAIL env var when dedicated setting is absent", async () => {
    process.env.ADMIN_ALERT_EMAIL = "admin-fallback@example.com";

    const { resolveDocumentUploadAlertRecipientsLocal } = await import(
      "../routes/content"
    );
    const recipients = await resolveDocumentUploadAlertRecipientsLocal();

    expect(recipients).toEqual(["admin-fallback@example.com"]);
  });

  it("tier 3b — falls back to admin_alert_email DB setting when both env vars are absent", async () => {
    appSettings.set("admin_alert_email", {
      value: "db-admin@example.com",
      updatedBy: null,
      updatedAt: new Date(),
    });

    const { resolveDocumentUploadAlertRecipientsLocal } = await import(
      "../routes/content"
    );
    const recipients = await resolveDocumentUploadAlertRecipientsLocal();

    expect(recipients).toEqual(["db-admin@example.com"]);
  });

  it("default — returns empty array when nothing is configured", async () => {
    const { resolveDocumentUploadAlertRecipientsLocal } = await import(
      "../routes/content"
    );
    const recipients = await resolveDocumentUploadAlertRecipientsLocal();

    expect(recipients).toEqual([]);
  });
});

// ── Unit tests: readDocumentUploadAlertEmailSetting ─────────────────────────

describe("readDocumentUploadAlertEmailSetting — source tagging", () => {
  beforeEach(() => resetState());
  afterEach(() => {
    delete process.env.DOCUMENT_UPLOAD_ALERT_EMAIL;
    delete process.env.ADMIN_ALERT_EMAIL;
  });

  it('reports source="env" and envOverride=true when env var is set', async () => {
    process.env.DOCUMENT_UPLOAD_ALERT_EMAIL = "env@example.com";

    const { readDocumentUploadAlertEmailSetting } = await import(
      "../routes/content"
    );
    const setting = await readDocumentUploadAlertEmailSetting();

    expect(setting.source).toBe("env");
    expect(setting.envOverride).toBe(true);
    expect(setting.recipients).toEqual(["env@example.com"]);
    expect(setting.value).toBe("env@example.com");
  });

  it('reports source="db" and envOverride=false when only the DB setting exists', async () => {
    appSettings.set("document_upload_alert_email", {
      value: "db@example.com",
      updatedBy: "admin",
      updatedAt: new Date(),
    });

    const { readDocumentUploadAlertEmailSetting } = await import(
      "../routes/content"
    );
    const setting = await readDocumentUploadAlertEmailSetting();

    expect(setting.source).toBe("db");
    expect(setting.envOverride).toBe(false);
    expect(setting.recipients).toEqual(["db@example.com"]);
    expect(setting.storedValue).toBe("db@example.com");
  });

  it('reports source="fallback" when falling back to ADMIN_ALERT_EMAIL env var', async () => {
    process.env.ADMIN_ALERT_EMAIL = "fallback@example.com";

    const { readDocumentUploadAlertEmailSetting } = await import(
      "../routes/content"
    );
    const setting = await readDocumentUploadAlertEmailSetting();

    expect(setting.source).toBe("fallback");
    expect(setting.envOverride).toBe(false);
    expect(setting.recipients).toEqual(["fallback@example.com"]);
    expect(setting.value).toBe("");
  });

  it('reports source="fallback" when falling back to admin_alert_email DB row', async () => {
    appSettings.set("admin_alert_email", {
      value: "dbfallback@example.com",
      updatedBy: null,
      updatedAt: new Date(),
    });

    const { readDocumentUploadAlertEmailSetting } = await import(
      "../routes/content"
    );
    const setting = await readDocumentUploadAlertEmailSetting();

    expect(setting.source).toBe("fallback");
    expect(setting.recipients).toEqual(["dbfallback@example.com"]);
  });

  it('reports source="default" and empty recipients when nothing is configured', async () => {
    const { readDocumentUploadAlertEmailSetting } = await import(
      "../routes/content"
    );
    const setting = await readDocumentUploadAlertEmailSetting();

    expect(setting.source).toBe("default");
    expect(setting.envOverride).toBe(false);
    expect(setting.recipients).toEqual([]);
    expect(setting.value).toBe("");
  });
});

// ── Integration tests: GET /api/admin/settings/document-upload-alert-email ──

describe("GET /api/admin/settings/document-upload-alert-email", () => {
  beforeEach(() => resetState());
  afterEach(() => {
    delete process.env.DOCUMENT_UPLOAD_ALERT_EMAIL;
  });

  it("returns 200 with the setting object when authenticated", async () => {
    appSettings.set("document_upload_alert_email", {
      value: "watch@example.com",
      updatedBy: "admin",
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .get("/api/admin/settings/document-upload-alert-email")
      .set("Authorization", "Bearer t");

    expect(res.status).toBe(200);
    expect(res.body.recipients).toEqual(["watch@example.com"]);
    expect(res.body.source).toBe("db");
    expect(res.body.envOverride).toBe(false);
  });

  it("reflects the env var override in the response", async () => {
    process.env.DOCUMENT_UPLOAD_ALERT_EMAIL = "env@example.com";

    const res = await request(buildApp())
      .get("/api/admin/settings/document-upload-alert-email")
      .set("Authorization", "Bearer t");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("env");
    expect(res.body.envOverride).toBe(true);
    expect(res.body.recipients).toEqual(["env@example.com"]);
  });

  it('returns source="default" and empty recipients when nothing is configured', async () => {
    const res = await request(buildApp())
      .get("/api/admin/settings/document-upload-alert-email")
      .set("Authorization", "Bearer t");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("default");
    expect(res.body.recipients).toEqual([]);
  });
});

// ── Auth-required tests ──────────────────────────────────────────────────────

describe("GET and PATCH /api/admin/settings/document-upload-alert-email — require authentication", () => {
  beforeEach(() => {
    resetState();
    rejectAuth = true;
  });
  afterEach(() => {
    rejectAuth = false;
  });

  it("GET returns 401 when the request carries no valid bearer token", async () => {
    const res = await request(buildApp())
      .get("/api/admin/settings/document-upload-alert-email");

    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it("PATCH returns 401 when the request carries no valid bearer token", async () => {
    const res = await request(buildApp())
      .patch("/api/admin/settings/document-upload-alert-email")
      .send({ value: "hacker@evil.com" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();

    expect(
      auditLogs.some((a) => a.action === "document_upload_alert_email_updated"),
    ).toBe(false);
    expect(committed["document_upload_alert_email"]).toBeUndefined();
  });
});

// ── Integration tests: PATCH /api/admin/settings/document-upload-alert-email ─

describe("PATCH /api/admin/settings/document-upload-alert-email", () => {
  beforeEach(() => resetState());

  it("saves a valid email address and writes an audit log", async () => {
    const res = await request(buildApp())
      .patch("/api/admin/settings/document-upload-alert-email")
      .set("Authorization", "Bearer t")
      .send({ value: "newrecipient@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.recipients).toEqual(["newrecipient@example.com"]);

    const audits = auditLogs.filter(
      (a) => a.action === "document_upload_alert_email_updated",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].targetType).toBe("app_setting");
    expect(audits[0].targetId).toBe("document_upload_alert_email");
    expect(audits[0].newValue).toContain("newrecipient@example.com");
  });

  it("saves a comma-separated list of recipients", async () => {
    const res = await request(buildApp())
      .patch("/api/admin/settings/document-upload-alert-email")
      .set("Authorization", "Bearer t")
      .send({ value: "a@example.com, b@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.recipients).toEqual(["a@example.com", "b@example.com"]);

    const audit = auditLogs.find(
      (a) => a.action === "document_upload_alert_email_updated",
    );
    expect(audit).toBeTruthy();
    expect(JSON.parse(audit.newValue).recipients).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("saves an empty value to clear the setting", async () => {
    appSettings.set("document_upload_alert_email", {
      value: "old@example.com",
      updatedBy: "admin",
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .patch("/api/admin/settings/document-upload-alert-email")
      .set("Authorization", "Bearer t")
      .send({ value: "" });

    expect(res.status).toBe(200);
    expect(res.body.recipients).toEqual([]);

    const audit = auditLogs.find(
      (a) => a.action === "document_upload_alert_email_updated",
    );
    expect(audit).toBeTruthy();
    const prev = JSON.parse(audit.previousValue);
    expect(prev.recipients).toEqual(["old@example.com"]);
  });

  it("rejects a malformed email address with 400 and a clear error message", async () => {
    // Email validation runs before the transaction block so the admin sees
    // the real cause of the failure (bad email format) instead of a generic
    // 503 audit-log failure.
    const res = await request(buildApp())
      .patch("/api/admin/settings/document-upload-alert-email")
      .set("Authorization", "Bearer t")
      .send({ value: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid email address(es): not-an-email");

    expect(
      auditLogs.some((a) => a.action === "document_upload_alert_email_updated"),
    ).toBe(false);
    expect(committed["document_upload_alert_email"]).toBeUndefined();
  });

  it("rejects a mixed list where one address is invalid with 400 (no audit log, no committed change)", async () => {
    const res = await request(buildApp())
      .patch("/api/admin/settings/document-upload-alert-email")
      .set("Authorization", "Bearer t")
      .send({ value: "good@example.com, bad-email" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid email address(es): bad-email");
    expect(
      auditLogs.some((a) => a.action === "document_upload_alert_email_updated"),
    ).toBe(false);
    expect(committed["document_upload_alert_email"]).toBeUndefined();
  });

  it("rejects a request with no body value field with 400", async () => {
    const res = await request(buildApp())
      .patch("/api/admin/settings/document-upload-alert-email")
      .set("Authorization", "Bearer t")
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── Transaction rollback test ────────────────────────────────────────────────

describe("PATCH /api/admin/settings/document-upload-alert-email — transaction atomicity", () => {
  beforeEach(() => resetState());

  it("rolls back the setting change when the audit log write fails", async () => {
    appSettings.set("document_upload_alert_email", {
      value: "original@example.com",
      updatedBy: "admin",
      updatedAt: new Date(),
    });
    auditShouldThrow = true;

    const res = await request(buildApp())
      .patch("/api/admin/settings/document-upload-alert-email")
      .set("Authorization", "Bearer t")
      .send({ value: "new@example.com" });

    expect(res.status).toBe(503);

    expect(
      auditLogs.some((a) => a.action === "document_upload_alert_email_updated"),
    ).toBe(false);

    expect(committed["document_upload_alert_email"]).toBeUndefined();
  });

  it("commits both the setting change and audit log on success", async () => {
    const res = await request(buildApp())
      .patch("/api/admin/settings/document-upload-alert-email")
      .set("Authorization", "Bearer t")
      .send({ value: "committed@example.com" });

    expect(res.status).toBe(200);

    expect(
      auditLogs.some((a) => a.action === "document_upload_alert_email_updated"),
    ).toBe(true);

    expect(committed["document_upload_alert_email"]).toBeTruthy();
    expect(
      (committed["document_upload_alert_email"] as any).value,
    ).toBe("committed@example.com");
  });
});
