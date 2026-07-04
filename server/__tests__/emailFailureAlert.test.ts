import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import { createStorageMock } from "./helpers/storageMock";

const ADMIN_TOKEN = "admin-token-test";
const TEST_ADMIN_USERNAME = "email-failure-alert-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
  delete process.env.ADMIN_ALERT_EMAIL;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

const auditLogs: any[] = [];
const appSettings = new Map<
  string,
  { value: string; updatedBy: string | null; updatedAt: Date }
>();
let adminAlertRecipients: string[] = ["ops@example.com"];
let recentFailures: Array<{
  caseId: string;
  tag: string;
  at: string;
  error: string | null;
  source: "audit" | "case_emails";
}> = [];
let recentFailuresThrows: Error | null = null;
const sendCalls: any[] = [];
let sendResultOverride: { success: boolean; error?: string } = {
  success: true,
};
let sendShouldThrow: Error | null = null;

vi.mock("../storage", () => ({
  storage: createStorageMock({
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
    getRecentEmailFailures: vi.fn(async (_since: Date) => {
      if (recentFailuresThrows) throw recentFailuresThrows;
      return recentFailures;
    }),
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? {
            id: "session-1",
            isActive: true,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            adminUsername: TEST_ADMIN_USERNAME,
          }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
  }),
}));

vi.mock("../nda-integrity-sweep", () => ({
  ADMIN_ALERT_EMAIL_SETTING_KEY: "admin_alert_email",
  parseAdminAlertRecipients: (raw: string | null | undefined) => {
    if (!raw) return [];
    // Returning the captured `adminAlertRecipients` directly lets each test
    // control the recipients without round-tripping through app_settings.
    return adminAlertRecipients;
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendCaseEmailFailureAlert: vi.fn(async (opts: any) => {
      sendCalls.push(opts);
      if (sendShouldThrow) throw sendShouldThrow;
      return sendResultOverride;
    }),
  }),
}));

import {
  maybeAlertOnEmailFailure,
  EMAIL_FAILURE_ALERT_LAST_SENT_AT_SETTING_KEY,
  EMAIL_FAILURE_ALERT_COOLDOWN_MS,
} from "../services/emailFailureAlert";

function resetState() {
  auditLogs.length = 0;
  sendCalls.length = 0;
  appSettings.clear();
  adminAlertRecipients = ["ops@example.com"];
  appSettings.set("admin_alert_email", {
    value: "ops@example.com",
    updatedBy: null,
    updatedAt: new Date(),
  });
  recentFailures = [
    {
      caseId: "case-1",
      tag: "letter-ready",
      at: new Date().toISOString(),
      error: "SMTP boom",
      source: "audit",
    },
  ];
  recentFailuresThrows = null;
  sendResultOverride = { success: true };
  sendShouldThrow = null;
  delete process.env.ADMIN_ALERT_EMAIL;
}

describe("maybeAlertOnEmailFailure (Task #150)", () => {
  beforeEach(() => {
    resetState();
  });

  it("fires exactly one alert email on a failed send and stamps the throttle", async () => {
    await maybeAlertOnEmailFailure({
      caseId: "case-1",
      tag: "letter-ready",
      error: "SMTP boom",
    });

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].to).toEqual(["ops@example.com"]);
    expect(sendCalls[0].failures).toHaveLength(1);
    expect(sendCalls[0].dashboardUrl).toMatch(/\/admin$/);

    const sentAudits = auditLogs.filter(
      (a) => a.action === "email_delivery_alert_sent",
    );
    expect(sentAudits).toHaveLength(1);
    expect(sentAudits[0].newValue).toContain("ops@example.com");
    expect(sentAudits[0].newValue).toContain("letter-ready");
    expect(
      auditLogs.some((a) => a.action === "email_delivery_alert_failed"),
    ).toBe(false);

    expect(
      appSettings.get(EMAIL_FAILURE_ALERT_LAST_SENT_AT_SETTING_KEY)?.value,
    ).toBeTruthy();
  });

  it("does NOT re-send a second alert inside the cooldown window", async () => {
    await maybeAlertOnEmailFailure({
      caseId: "case-1",
      tag: "letter-ready",
      error: "SMTP boom",
    });
    expect(sendCalls).toHaveLength(1);

    // Second failure 1 minute later — well inside the 60-minute cooldown.
    await maybeAlertOnEmailFailure({
      caseId: "case-2",
      tag: "declaration-ready",
      error: "SMTP still down",
    });

    expect(sendCalls).toHaveLength(1);
    // No additional sent/failed audit row for the throttled call.
    const sentAudits = auditLogs.filter(
      (a) => a.action === "email_delivery_alert_sent",
    );
    expect(sentAudits).toHaveLength(1);
  });

  it("DOES re-send once the cooldown has elapsed", async () => {
    // Pre-seed last-sent older than the cooldown window.
    const stale = new Date(
      Date.now() - EMAIL_FAILURE_ALERT_COOLDOWN_MS - 60_000,
    );
    appSettings.set(EMAIL_FAILURE_ALERT_LAST_SENT_AT_SETTING_KEY, {
      value: stale.toISOString(),
      updatedBy: "system",
      updatedAt: stale,
    });

    await maybeAlertOnEmailFailure({
      caseId: "case-3",
      tag: "stage_instructions",
      error: "SMTP boom",
    });

    expect(sendCalls).toHaveLength(1);
    expect(
      auditLogs.filter((a) => a.action === "email_delivery_alert_sent"),
    ).toHaveLength(1);
    const lastSent = appSettings.get(
      EMAIL_FAILURE_ALERT_LAST_SENT_AT_SETTING_KEY,
    );
    expect(lastSent?.value).toBeTruthy();
    expect(new Date(lastSent!.value).getTime()).toBeGreaterThan(
      stale.getTime(),
    );
  });

  it("writes email_delivery_alert_skipped (and does NOT throw or send) when no recipient is configured", async () => {
    adminAlertRecipients = [];
    appSettings.delete("admin_alert_email");

    await expect(
      maybeAlertOnEmailFailure({
        caseId: "case-9",
        tag: "letter-ready",
        error: "SMTP boom",
      }),
    ).resolves.toBeUndefined();

    expect(sendCalls).toHaveLength(0);
    const skipped = auditLogs.filter(
      (a) => a.action === "email_delivery_alert_skipped",
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0].targetType).toBe("system");
    expect(skipped[0].targetId).toBe("email_delivery_alert");
    expect(skipped[0].newValue).toMatch(/no admin recipient configured/i);
    expect(skipped[0].newValue).toContain("letter-ready");
    expect(skipped[0].newValue).toContain("case-9");

    // Skipped path must NOT stamp the throttle — otherwise a missing-recipient
    // outage would block real alerts once the recipient is finally configured.
    expect(
      appSettings.get(EMAIL_FAILURE_ALERT_LAST_SENT_AT_SETTING_KEY),
    ).toBeUndefined();
  });

  it("records email_delivery_alert_failed when the SMTP call rejects", async () => {
    sendShouldThrow = new Error("network down");
    await maybeAlertOnEmailFailure({
      caseId: "case-7",
      tag: "letter-ready",
      error: "SMTP boom",
    });
    expect(sendCalls).toHaveLength(1);
    const failed = auditLogs.filter(
      (a) => a.action === "email_delivery_alert_failed",
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].newValue).toContain("network down");
  });
});

describe("GET /api/cases/email-delivery-alerts dedupe contract (Task #150)", () => {
  it("storage.getRecentEmailFailures excludes the same duped-in-case_emails audit tags as the per-case summary", () => {
    // The dashboard rollup (`getRecentEmailFailures`) and the per-case
    // summary (`getEmailDeliverySummaryForCases`) must apply the same
    // exclusion list, otherwise an `email_custom_failed` /
    // `email_stage_instructions_failed` audit row would be counted once
    // by the rollup and ignored by the per-case badge (or vice versa).
    // We assert source-level parity so a future edit to one without the
    // other trips this test.
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "storage.ts"),
      "utf-8",
    );
    const excludeClause =
      "not in ('email_custom_failed', 'email_stage_instructions_failed')";
    const matches = src.match(
      /\$\{auditLogs\.action\} not in \('email_custom_failed', 'email_stage_instructions_failed'\)/g,
    );
    expect(matches, `expected both helpers to use \`${excludeClause}\``)
      .toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("rollup endpoint surfaces what storage returns and exposes the dispatcher's throttle state", async () => {
    resetState();
    // Two failures across two cases — the rollup must report both
    // verbatim (dedupe lives in storage.getRecentEmailFailures, which
    // we mock; the endpoint must not re-shuffle or drop them).
    recentFailures = [
      {
        caseId: "case-A",
        tag: "letter-ready",
        at: "2026-05-22T12:00:00.000Z",
        error: "auth failed",
        source: "audit",
      },
      {
        caseId: "case-B",
        tag: "custom",
        at: "2026-05-22T11:50:00.000Z",
        error: "auth failed",
        source: "case_emails",
      },
    ];
    appSettings.set(EMAIL_FAILURE_ALERT_LAST_SENT_AT_SETTING_KEY, {
      value: "2026-05-22T11:55:00.000Z",
      updatedBy: "system",
      updatedAt: new Date(),
    });

    const { casesRouter } = await import("../routes/cases");
    const app = express();
    app.use(express.json());
    app.use("/api/cases", casesRouter);

    const res = await request(app)
      .get("/api/cases/email-delivery-alerts")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.uniqueCaseCount).toBe(2);
    expect(res.body.uniqueCaseIds).toEqual(
      expect.arrayContaining(["case-A", "case-B"]),
    );
    expect(res.body.alertRecipientConfigured).toBe(true);
    expect(res.body.lastAlertSentAt).toBe("2026-05-22T11:55:00.000Z");
    expect(res.body.alertCooldownMinutes).toBe(60);
    expect(res.body.failures).toHaveLength(2);
    expect(res.body.failures[0].caseId).toBe("case-A");
  });

  it("rollup endpoint reports alertRecipientConfigured=false when neither env nor app_settings has a recipient", async () => {
    resetState();
    adminAlertRecipients = [];
    appSettings.delete("admin_alert_email");
    recentFailures = [];

    const { casesRouter } = await import("../routes/cases");
    const app = express();
    app.use(express.json());
    app.use("/api/cases", casesRouter);

    const res = await request(app)
      .get("/api/cases/email-delivery-alerts")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.alertRecipientConfigured).toBe(false);
    expect(res.body.total).toBe(0);
    expect(res.body.uniqueCaseCount).toBe(0);
  });
});
