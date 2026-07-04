import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

const settings = new Map<string, { value: string | null }>();
let getAppSettingThrows: Error | null = null;
const createAuditLog = vi.fn(async () => undefined);
const notifyAdmin = vi.fn(async () => undefined);
const sendStaleAlert = vi.fn(async (_arg?: unknown) => ({ success: true }));
const sendFailureAlert = vi.fn(async (_arg?: unknown) => ({ success: true }));
let getAllSealedCaseNdas = vi.fn(async () => [] as any[]);

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAppSetting: vi.fn(async (key: string) => {
      if (getAppSettingThrows) throw getAppSettingThrows;
      return settings.get(key) ?? null;
    }),
    setAppSetting: vi.fn(async (key: string, value: string | null) => {
      settings.set(key, { value });
    }),
    createAuditLog,
    getAllSealedCaseNdas: vi.fn(async (...args: any[]) =>
      getAllSealedCaseNdas(...args),
    ),
  }),
}));

vi.mock("../services/NotificationService", () => ({
  notificationService: { notifyAdmin },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendNdaIntegritySweepStaleAlert: sendStaleAlert,
    sendNdaIntegrityFailureAlert: sendFailureAlert,
    sendNdaIntegritySweepSummary: vi.fn(async () => ({ success: true })),
  }),
}));

const LAST_SUCCESS_KEY = "nda_integrity_sweep_last_success_at";
const STALE_SENT_KEY = "nda_integrity_sweep_stale_alert_last_sent_at";

beforeEach(() => {
  settings.clear();
  getAppSettingThrows = null;
  createAuditLog.mockClear();
  notifyAdmin.mockClear();
  sendStaleAlert.mockClear();
  sendFailureAlert.mockClear();
  getAllSealedCaseNdas = vi.fn(async () => []);
  process.env.NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS = "1";
});

describe("computeNdaIntegritySweepStaleness", () => {
  it("returns not-stale when last success is fresh", async () => {
    const mod = await import("../nda-integrity-sweep");
    const now = new Date();
    settings.set(LAST_SUCCESS_KEY, {
      value: new Date(now.getTime() - 60 * 1000).toISOString(),
    });
    const out = await mod.computeNdaIntegritySweepStaleness(now);
    expect(out.isStale).toBe(false);
    expect(out.readError).toBe(false);
    expect(out.neverRan).toBe(false);
  });

  it("returns not stale when last success is within the grace window", async () => {
    const mod = await import("../nda-integrity-sweep");
    const now = new Date();
    // Grace is 1h (set in beforeEach); default interval is 24h, so a
    // success 24.5h ago is past the interval but still inside the
    // 25h threshold — watchdog should hold its fire.
    const withinGraceMs =
      (mod.NDA_INTEGRITY_SWEEP_INTERVAL_DEFAULT_HOURS + 0.5) * 60 * 60 * 1000;
    settings.set(LAST_SUCCESS_KEY, {
      value: new Date(now.getTime() - withinGraceMs).toISOString(),
    });
    const out = await mod.computeNdaIntegritySweepStaleness(now);
    expect(out.isStale).toBe(false);
    expect(out.overdueMs).toBe(0);
    expect(out.neverRan).toBe(false);
  });

  it("returns stale when last success is past threshold", async () => {
    const mod = await import("../nda-integrity-sweep");
    const now = new Date();
    const tooOldMs = (mod.NDA_INTEGRITY_SWEEP_INTERVAL_DEFAULT_HOURS + 5)
      * 60 * 60 * 1000;
    settings.set(LAST_SUCCESS_KEY, {
      value: new Date(now.getTime() - tooOldMs).toISOString(),
    });
    const out = await mod.computeNdaIntegritySweepStaleness(now);
    expect(out.isStale).toBe(true);
    expect(out.overdueMs).toBeGreaterThan(0);
  });

  it("fail-closes when app_settings read throws (DB unreachable)", async () => {
    const mod = await import("../nda-integrity-sweep");
    getAppSettingThrows = new Error("connect ECONNREFUSED");
    const out = await mod.computeNdaIntegritySweepStaleness(new Date());
    expect(out.isStale).toBe(true);
    expect(out.readError).toBe(true);
    expect(out.readErrorMessage).toContain("ECONNREFUSED");
  });

  it("treats neverRan past threshold-from-boot as stale", async () => {
    const mod = await import("../nda-integrity-sweep");
    // No last_success row; simulate "now" well past PROCESS_STARTED_AT + threshold.
    const farFuture = new Date(
      mod.PROCESS_STARTED_AT.getTime()
        + (mod.NDA_INTEGRITY_SWEEP_INTERVAL_DEFAULT_HOURS + 5) * 60 * 60 * 1000,
    );
    const out = await mod.computeNdaIntegritySweepStaleness(farFuture);
    expect(out.neverRan).toBe(true);
    expect(out.isStale).toBe(true);
  });

  it("treats neverRan within grace window as not stale", async () => {
    const mod = await import("../nda-integrity-sweep");
    const out = await mod.computeNdaIntegritySweepStaleness(
      new Date(mod.PROCESS_STARTED_AT.getTime() + 1000),
    );
    expect(out.neverRan).toBe(true);
    expect(out.isStale).toBe(false);
  });
});

describe("runNdaIntegritySweepStaleCheck", () => {
  it("no-ops when not stale", async () => {
    const mod = await import("../nda-integrity-sweep");
    const now = new Date();
    settings.set(LAST_SUCCESS_KEY, { value: now.toISOString() });
    const result = await mod.runNdaIntegritySweepStaleCheck(now);
    expect(result.alerted).toBe(false);
    expect(sendStaleAlert).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("when stale + no recipient: audits, notifies, stamps throttle, no email", async () => {
    const mod = await import("../nda-integrity-sweep");
    const now = new Date();
    settings.set(LAST_SUCCESS_KEY, {
      value: new Date(now.getTime() - 100 * 60 * 60 * 1000).toISOString(),
    });
    // No admin_alert_email setting and no ADMIN_ALERT_EMAIL env var.
    delete process.env.ADMIN_ALERT_EMAIL;
    const result = await mod.runNdaIntegritySweepStaleCheck(now);
    expect(result.staleness.isStale).toBe(true);
    expect(result.alerted).toBe(false);
    expect(result.reason).toBe("no-recipient");
    expect(sendStaleAlert).not.toHaveBeenCalled();
    expect(notifyAdmin).toHaveBeenCalled();
    // Stale audit row + a "_failed" audit row noting the missing recipient.
    const actions = createAuditLog.mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toContain(mod.NDA_INTEGRITY_SWEEP_STALE_AUDIT_ACTION);
    expect(actions).toContain(
      `${mod.NDA_INTEGRITY_SWEEP_STALE_EMAIL_AUDIT_ACTION}_failed`,
    );
    // Throttle still stamped so we don't re-emit the same noise every hour.
    expect(settings.get(STALE_SENT_KEY)?.value).toBeTruthy();
  });

  it("when stale: audits, notifies, emails, and stamps the throttle", async () => {
    const mod = await import("../nda-integrity-sweep");
    const now = new Date();
    settings.set(LAST_SUCCESS_KEY, {
      value: new Date(
        now.getTime() - 100 * 60 * 60 * 1000,
      ).toISOString(),
    });
    settings.set("admin_alert_email", { value: "ops@example.com" });
    const result = await mod.runNdaIntegritySweepStaleCheck(now);
    expect(result.staleness.isStale).toBe(true);
    expect(createAuditLog).toHaveBeenCalled();
    expect(notifyAdmin).toHaveBeenCalled();
    expect(sendStaleAlert).toHaveBeenCalledTimes(1);
    expect(settings.get(STALE_SENT_KEY)?.value).toBeTruthy();
  });

  it("throttles repeat alerts within thresholdHours", async () => {
    const mod = await import("../nda-integrity-sweep");
    const now = new Date();
    settings.set(LAST_SUCCESS_KEY, {
      value: new Date(now.getTime() - 100 * 60 * 60 * 1000).toISOString(),
    });
    settings.set(STALE_SENT_KEY, {
      value: new Date(now.getTime() - 60 * 1000).toISOString(),
    });
    settings.set("admin_alert_email", { value: "ops@example.com" });
    const result = await mod.runNdaIntegritySweepStaleCheck(now);
    expect(result.alerted).toBe(false);
    expect(sendStaleAlert).not.toHaveBeenCalled();
  });

  it("stamps throttle even when email send fails (no spam loop)", async () => {
    const mod = await import("../nda-integrity-sweep");
    const now = new Date();
    settings.set(LAST_SUCCESS_KEY, {
      value: new Date(now.getTime() - 100 * 60 * 60 * 1000).toISOString(),
    });
    settings.set("admin_alert_email", { value: "ops@example.com" });
    sendStaleAlert.mockRejectedValueOnce(new Error("smtp down"));
    await mod.runNdaIntegritySweepStaleCheck(now);
    expect(settings.get(STALE_SENT_KEY)?.value).toBeTruthy();
  });

  it("successful sweep stamps last_success and clears the stale-alert throttle", async () => {
    const mod = await import("../nda-integrity-sweep");
    // Pre-seed throttle as if an alert had previously fired during an outage.
    const earlier = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    settings.set(STALE_SENT_KEY, { value: earlier });
    await mod.runNdaIntegritySweep();
    // status === "ok" should both stamp last_success and clear the throttle
    // so a recovery-then-relapse cycle re-alerts immediately.
    expect(settings.get(LAST_SUCCESS_KEY)?.value).toBeTruthy();
    expect(settings.get(STALE_SENT_KEY)?.value).toBe("");
  });
});

describe("runNdaIntegritySweep — per-case deep-link notifications", () => {
  function makeNda(caseId: string, hash: string) {
    const buf = Buffer.from(`pdf-content-for-${caseId}`);
    return {
      id: 1,
      caseId,
      templateVersion: "v1",
      signedPdfBase64: buf.toString("base64"),
      contentHash: hash,
      renderedBody: "",
      signedName: "Test User",
      signedAt: new Date(),
      signedIp: "127.0.0.1",
      signedUserAgent: "test",
      signedEmail: "test@example.com",
    };
  }

  it("emits one notifyAdmin call per failing case with the case deep-link", async () => {
    const mod = await import("../nda-integrity-sweep");
    // Two cases with deliberately wrong hashes so the sweep treats them as failures.
    getAllSealedCaseNdas = vi.fn(async () => [
      makeNda("case-aaa", "wrong-hash-aaa"),
      makeNda("case-bbb", "wrong-hash-bbb"),
    ]);
    await mod.runNdaIntegritySweep();
    const links: string[] = notifyAdmin.mock.calls.map((c: any[]) => c[3]);
    expect(links.some((l) => l === "/admin?tab=cases&caseId=case-aaa")).toBe(true);
    expect(links.some((l) => l === "/admin?tab=cases&caseId=case-bbb")).toBe(true);
  });

  it("emits exactly one notifyAdmin per unique failing case ID (deduped)", async () => {
    const mod = await import("../nda-integrity-sweep");
    // Two NDA rows for the same case, both failing.
    getAllSealedCaseNdas = vi.fn(async () => [
      makeNda("case-dup", "wrong-hash-1"),
      makeNda("case-dup", "wrong-hash-2"),
    ]);
    await mod.runNdaIntegritySweep();
    const matchingCalls = notifyAdmin.mock.calls.filter(
      (c: any[]) => c[3] === "/admin?tab=cases&caseId=case-dup",
    );
    expect(matchingCalls).toHaveLength(1);
  });

  it("uses /admin?tab=cases (no caseId) for a sweep-error notification", async () => {
    const mod = await import("../nda-integrity-sweep");
    // Force the sweep to throw by making getAllSealedCaseNdas reject.
    getAllSealedCaseNdas = vi.fn(async () => {
      throw new Error("db gone");
    });
    await mod.runNdaIntegritySweep();
    const links: string[] = notifyAdmin.mock.calls.map((c: any[]) => c[3]);
    expect(links.some((l) => l === "/admin?tab=cases")).toBe(true);
  });

  it("uses /admin?tab=cases (no caseId) for a stale-sweep notification", async () => {
    const mod = await import("../nda-integrity-sweep");
    const now = new Date();
    settings.set(LAST_SUCCESS_KEY, {
      value: new Date(now.getTime() - 100 * 60 * 60 * 1000).toISOString(),
    });
    settings.set("admin_alert_email", { value: "ops@example.com" });
    await mod.runNdaIntegritySweepStaleCheck(now);
    const links: string[] = notifyAdmin.mock.calls.map((c: any[]) => c[3]);
    expect(links.some((l) => l === "/admin?tab=cases")).toBe(true);
  });

  it("tamper alert email is called with caseDeepLinks containing a URL for each failing case", async () => {
    const mod = await import("../nda-integrity-sweep");
    settings.set("admin_alert_email", { value: "ops@example.com" });
    getAllSealedCaseNdas = vi.fn(async () => [
      makeNda("case-link-aaa", "wrong-hash-aaa"),
      makeNda("case-link-bbb", "wrong-hash-bbb"),
    ]);
    await mod.runNdaIntegritySweep();
    expect(sendFailureAlert).toHaveBeenCalledTimes(1);
    const opts = sendFailureAlert.mock.calls[0][0] as any;
    expect(opts.caseDeepLinks).toBeDefined();
    const urls: string[] = opts.caseDeepLinks.map((d: any) => d.url);
    expect(urls.some((u) => u.includes("caseId=case-link-aaa"))).toBe(true);
    expect(urls.some((u) => u.includes("caseId=case-link-bbb"))).toBe(true);
    const caseIds: string[] = opts.caseDeepLinks.map((d: any) => d.caseId);
    expect(caseIds).toContain("case-link-aaa");
    expect(caseIds).toContain("case-link-bbb");
  });
});
