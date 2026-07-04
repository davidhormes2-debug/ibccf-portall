import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// Task #157 — wraps the remaining admin app-setting PUT/PATCH handlers
// in storage.runInTransaction so a paired audit-log failure rolls back
// the row mutation. Mirrors the staged/committed mock pattern from
// adminMutationTransactionsTask148.test.ts.

type Staged = Record<string, unknown>;
const auditLogs: any[] = [];
const committed: Staged = {};
let staged: Staged = {};
let auditShouldThrow = false;

function commitStaged() {
  for (const [k, v] of Object.entries(staged)) committed[k] = v;
  staged = {};
}

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
    // Routes also call storage.getAppSetting after the read-back; we
    // return a minimal shape that the response handlers tolerate.
    getAppSetting: vi.fn(async () => ({
      key: "x",
      value: "",
      updatedAt: null,
      updatedBy: null,
    })),
  }),
}));

vi.mock("../db", () => ({ db: {} }));

vi.mock("../routes/middleware", () => ({
  checkAdminAuth: (req: any, _res: any, next: any) => {
    req.admin = { username: "admin" };
    req.adminUsername = "admin";
    next();
  },
  isValidAdminToken: vi.fn(async () => true),
  invalidateBlockedIpsCache: vi.fn(),
  normalizeIp: (ip: string) => ip,
  getClientIp: () => "127.0.0.1",
}));

// ---- runtimeFlags (nda-signing-locales) ----
vi.mock("../services/runtimeFlags", () => ({
  NDA_SIGNING_LOCALES_KEY: "nda_signing_locales",
  NDA_SUPPORTED_LOCALES: ["en", "es", "fr", "de", "pt", "zh"] as const,
  NDA_DEFAULT_LOCALE: "en",
  readNdaSigningLocales: vi.fn(async () => ["en"]),
  getNdaSigningLocales: vi.fn(async () => ["en"]),
  setNdaSigningLocales: vi.fn(async (locales: string[]) => {
    staged.ndaLocales = [...locales];
    return [...locales];
  }),
  primeNdaSigningLocalesCache: vi.fn(),
}));

// ---- stampDuty ----
vi.mock("../services/stampDuty", () => ({
  STAMP_DUTY_PAYMENT_WALLETS_KEY: "stamp_duty_payment_wallets",
  getStampDutyPaymentWallets: vi.fn(async () => []),
  setStampDutyPaymentWallets: vi.fn(async (wallets: any[]) => {
    staged.stampDutyWallets = wallets;
    return wallets;
  }),
}));

// ---- audit-retention ----
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
  saveAuditLogRetentionDays: vi.fn(async (days: number) => {
    staged.auditRetention = days;
    return days;
  }),
  refreshAuditLogRetentionCache: vi.fn(async () => {}),
}));

// ---- community-cleanup ----
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
  saveCommunityParticipantRetentionDays: vi.fn(async (days: number) => {
    staged.communityRetention = days;
    return days;
  }),
  refreshCommunityParticipantRetentionCache: vi.fn(async () => {}),
}));

// ---- nda-integrity-sweep (interval / summary / stale-grace / alert email) ----
vi.mock("../nda-integrity-sweep", () => ({
  NDA_INTEGRITY_SWEEP_INTERVAL_MIN_HOURS: 1,
  NDA_INTEGRITY_SWEEP_INTERVAL_MAX_HOURS: 720,
  NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MIN: 0,
  NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MAX: 720,
  NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_VALUES: ["never", "daily", "weekly"] as const,
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
  saveNdaIntegritySweepIntervalHours: vi.fn(async (h: number) => {
    staged.ndaIntervalHours = h;
    return h;
  }),
  saveNdaIntegritySweepSummaryFrequency: vi.fn(async (v: string) => {
    staged.ndaSummaryFreq = v;
    return v;
  }),
  saveNdaIntegritySweepStaleGraceHours: vi.fn(async (h: number) => {
    staged.ndaStaleGrace = h;
    return h;
  }),
  saveAdminAlertEmailRecipients: vi.fn(async (raw: string) => {
    const value = raw.trim();
    const setting = {
      recipients: value ? value.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [],
      value,
      source: value ? "db" : "default",
      envOverride: false,
      storedValue: value,
      updatedAt: null,
      updatedBy: null,
    };
    staged.adminAlertEmail = setting;
    return setting;
  }),
  applyNdaIntegritySweepIntervalChange: vi.fn(async () => 24),
  refreshNdaIntegritySweepStaleGraceCache: vi.fn(async () => {}),
}));

const { adminRouter } = await import("../routes/admin");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.set("trust proxy", true);
  app.use("/api/admin", adminRouter);
  return app;
}

beforeEach(() => {
  auditLogs.length = 0;
  for (const k of Object.keys(committed)) delete committed[k];
  staged = {};
  auditShouldThrow = false;
});

describe("Task #157 — nda-signing-locales PUT", () => {
  it("rolls back the locale change when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(buildApp())
      .put("/api/admin/nda-signing-locales")
      .set("Authorization", "Bearer t")
      .send({ value: ["en", "es"] });
    expect(res.status).toBe(503);
    expect(committed.ndaLocales).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "nda_signing_locales_changed"),
    ).toBeUndefined();
  });

  it("commits the locale change and audit on the happy path", async () => {
    const res = await request(buildApp())
      .put("/api/admin/nda-signing-locales")
      .set("Authorization", "Bearer t")
      .send({ value: ["en", "es"] });
    expect(res.status).toBe(200);
    expect(committed.ndaLocales).toEqual(["en", "es"]);
    expect(
      auditLogs.some((a) => a.action === "nda_signing_locales_changed"),
    ).toBe(true);
  });
});

describe("Task #157 — stamp-duty-wallets PUT", () => {
  const body = {
    wallets: [
      { address: "0xabc", asset: "USDT", network: "ERC20" },
    ],
  };

  it("rolls back the wallet change when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(buildApp())
      .put("/api/admin/settings/stamp-duty-wallets")
      .set("Authorization", "Bearer t")
      .send(body);
    expect(res.status).toBe(503);
    expect(committed.stampDutyWallets).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "stamp_duty_wallets_changed"),
    ).toBeUndefined();
  });

  it("commits the wallet change and audit on the happy path", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/stamp-duty-wallets")
      .set("Authorization", "Bearer t")
      .send(body);
    expect(res.status).toBe(200);
    expect(Array.isArray(committed.stampDutyWallets)).toBe(true);
    expect(
      auditLogs.some((a) => a.action === "stamp_duty_wallets_changed"),
    ).toBe(true);
  });
});

describe("Task #157 — audit-log-retention PUT", () => {
  it("rolls back the retention change when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(buildApp())
      .put("/api/admin/settings/audit-log-retention")
      .set("Authorization", "Bearer t")
      .send({ days: 180 });
    expect(res.status).toBe(503);
    expect(committed.auditRetention).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "audit_log_retention_updated"),
    ).toBeUndefined();
  });

  it("commits the retention change and audit on the happy path", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/audit-log-retention")
      .set("Authorization", "Bearer t")
      .send({ days: 180 });
    expect(res.status).toBe(200);
    expect(committed.auditRetention).toBe(180);
    expect(
      auditLogs.some((a) => a.action === "audit_log_retention_updated"),
    ).toBe(true);
  });
});

describe("Task #157 — community-participant-retention PUT", () => {
  it("rolls back the retention change when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(buildApp())
      .put("/api/admin/settings/community-participant-retention")
      .set("Authorization", "Bearer t")
      .send({ days: 60 });
    expect(res.status).toBe(503);
    expect(committed.communityRetention).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "community_participant_retention_updated"),
    ).toBeUndefined();
  });

  it("commits the retention change and audit on the happy path", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/community-participant-retention")
      .set("Authorization", "Bearer t")
      .send({ days: 60 });
    expect(res.status).toBe(200);
    expect(committed.communityRetention).toBe(60);
    expect(
      auditLogs.some((a) => a.action === "community_participant_retention_updated"),
    ).toBe(true);
  });
});

describe("Task #157 — nda-integrity-sweep-interval PUT", () => {
  it("rolls back the interval change when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(buildApp())
      .put("/api/admin/settings/nda-integrity-sweep-interval")
      .set("Authorization", "Bearer t")
      .send({ hours: 48 });
    expect(res.status).toBe(503);
    expect(committed.ndaIntervalHours).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "nda_integrity_sweep_interval_updated"),
    ).toBeUndefined();
  });

  it("commits the interval change and audit on the happy path", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/nda-integrity-sweep-interval")
      .set("Authorization", "Bearer t")
      .send({ hours: 48 });
    expect(res.status).toBe(200);
    expect(committed.ndaIntervalHours).toBe(48);
    expect(
      auditLogs.some((a) => a.action === "nda_integrity_sweep_interval_updated"),
    ).toBe(true);
  });
});

describe("Task #157 — nda-integrity-sweep-summary-frequency PUT", () => {
  it("rolls back the frequency change when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(buildApp())
      .put("/api/admin/settings/nda-integrity-sweep-summary-frequency")
      .set("Authorization", "Bearer t")
      .send({ frequency: "daily" });
    expect(res.status).toBe(503);
    expect(committed.ndaSummaryFreq).toBeUndefined();
    expect(
      auditLogs.find(
        (a) => a.action === "nda_integrity_sweep_summary_frequency_updated",
      ),
    ).toBeUndefined();
  });

  it("commits the frequency change and audit on the happy path", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/nda-integrity-sweep-summary-frequency")
      .set("Authorization", "Bearer t")
      .send({ frequency: "daily" });
    expect(res.status).toBe(200);
    expect(committed.ndaSummaryFreq).toBe("daily");
    expect(
      auditLogs.some(
        (a) => a.action === "nda_integrity_sweep_summary_frequency_updated",
      ),
    ).toBe(true);
  });
});

describe("Task #157 — nda-integrity-sweep-stale-grace PUT", () => {
  it("rolls back the grace change when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(buildApp())
      .put("/api/admin/settings/nda-integrity-sweep-stale-grace")
      .set("Authorization", "Bearer t")
      .send({ hours: 6 });
    expect(res.status).toBe(503);
    expect(committed.ndaStaleGrace).toBeUndefined();
    expect(
      auditLogs.find(
        (a) => a.action === "nda_integrity_sweep_stale_grace_updated",
      ),
    ).toBeUndefined();
  });

  it("commits the grace change and audit on the happy path", async () => {
    const res = await request(buildApp())
      .put("/api/admin/settings/nda-integrity-sweep-stale-grace")
      .set("Authorization", "Bearer t")
      .send({ hours: 6 });
    expect(res.status).toBe(200);
    expect(committed.ndaStaleGrace).toBe(6);
    expect(
      auditLogs.some(
        (a) => a.action === "nda_integrity_sweep_stale_grace_updated",
      ),
    ).toBe(true);
  });
});

describe("Task #157 — tamper-alert-email PATCH", () => {
  it("rolls back the alert-email change when the audit write fails", async () => {
    auditShouldThrow = true;
    const res = await request(buildApp())
      .patch("/api/admin/settings/tamper-alert-email")
      .set("Authorization", "Bearer t")
      .send({ value: "ops@example.com" });
    expect(res.status).toBe(503);
    expect(committed.adminAlertEmail).toBeUndefined();
    expect(
      auditLogs.find((a) => a.action === "tamper_alert_email_updated"),
    ).toBeUndefined();
  });

  it("commits the alert-email change and audit on the happy path", async () => {
    const res = await request(buildApp())
      .patch("/api/admin/settings/tamper-alert-email")
      .set("Authorization", "Bearer t")
      .send({ value: "ops@example.com" });
    expect(res.status).toBe(200);
    expect((committed.adminAlertEmail as any)?.recipients).toContain(
      "ops@example.com",
    );
    expect(
      auditLogs.some((a) => a.action === "tamper_alert_email_updated"),
    ).toBe(true);
  });
});
