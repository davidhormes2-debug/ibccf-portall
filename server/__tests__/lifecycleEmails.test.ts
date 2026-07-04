import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ============================================================================
// AI failure alert rate-limiting and health probe state-machine tests.
//
// These tests use full vi.mock() for EmailService so the EmailService
// methods are not actually called, only the call count / args are verified.
// ============================================================================

// ---------------------------------------------------------------------------
// Shared alert capture arrays
// ---------------------------------------------------------------------------

const aiAlertCalls: Array<{ to: string | string[]; errorMessage: string }> = [];
const healthAlertCalls: Array<{ type: string; services: string[] }> = [];

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendCountdownOverrideNotification: vi.fn(async () => ({ success: true })),
    sendCountdownExpiredNotification: vi.fn(async () => ({ success: true })),
    sendReactivationRequiredNotification: vi.fn(async () => ({ success: true })),
    sendAiFailureAlert: vi.fn(async (opts: any) => {
      aiAlertCalls.push(opts);
      return { success: true };
    }),
    sendHealthCheckAlert: vi.fn(async (opts: any) => {
      healthAlertCalls.push(opts);
      return { success: true };
    }),
  }),
}));

vi.mock("../storage", () => ({
  storage: {
    getAppSetting: vi.fn(async () => ({ value: "ops@example.com" })),
    createAuditLog: vi.fn(async () => {}),
    getCaseById: vi.fn(async () => null),
  },
}));

vi.mock("../nda-integrity-sweep", () => ({
  ADMIN_ALERT_EMAIL_SETTING_KEY: "admin_alert_email",
  parseAdminAlertRecipients: (raw: string | null | undefined) => {
    if (!raw) return [];
    return raw.split(",").map((s: string) => s.trim()).filter(Boolean);
  },
}));

vi.mock("../instrument", () => ({ Sentry: { captureException: vi.fn() } }));
vi.mock("../db", () => ({
  db: {
    execute: vi.fn(async () => ({ rows: [] })),
    insert: vi.fn(() => ({ values: vi.fn(async () => {}) })),
  },
}));

// ---------------------------------------------------------------------------
// AI failure alert rate limiting
// ---------------------------------------------------------------------------

describe("generateChatResponse — AI failure alert", () => {
  beforeEach(() => {
    aiAlertCalls.length = 0;
    vi.resetModules();
    delete process.env.ADMIN_ALERT_EMAIL;
    process.env.ADMIN_ALERT_EMAIL = "ops@example.com";
  });

  afterEach(() => {
    delete process.env.ADMIN_ALERT_EMAIL;
  });

  it("sends an alert when OpenAI throws and the cooldown has not been set", async () => {
    vi.doMock("openai", () => ({
      default: class OpenAI {
        chat = {
          completions: {
            create: vi.fn(async () => {
              throw new Error("OpenAI rate limit exceeded");
            }),
          },
        };
      },
    }));

    const { generateChatResponse, _resetAiFailureAlertTimerForTest } = await import(
      "../services/ai-chatbot"
    );
    _resetAiFailureAlertTimerForTest();
    aiAlertCalls.length = 0;

    await generateChatResponse("hello", {});
    // Let the fire-and-forget void promise resolve.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(aiAlertCalls.length).toBeGreaterThanOrEqual(1);
    expect(aiAlertCalls[0].errorMessage).toMatch(/OpenAI rate limit exceeded/i);
  });

  it("does NOT send a second alert while within the cooldown window", async () => {
    vi.doMock("openai", () => ({
      default: class OpenAI {
        chat = {
          completions: {
            create: vi.fn(async () => {
              throw new Error("network error");
            }),
          },
        };
      },
    }));

    const { generateChatResponse, _resetAiFailureAlertTimerForTest } = await import(
      "../services/ai-chatbot"
    );
    _resetAiFailureAlertTimerForTest();
    aiAlertCalls.length = 0;

    await generateChatResponse("hello", {});
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const countAfterFirst = aiAlertCalls.length;
    expect(countAfterFirst).toBeGreaterThanOrEqual(1);

    // Second call — still within cooldown, no additional alert.
    await generateChatResponse("hello again", {});
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(aiAlertCalls.length).toBe(countAfterFirst);
  });

  it("returns a fallback response string even when the alert itself fails", async () => {
    vi.doMock("openai", () => ({
      default: class OpenAI {
        chat = {
          completions: {
            create: vi.fn(async () => {
              throw new Error("AI failure");
            }),
          },
        };
      },
    }));

    const { generateChatResponse, _resetAiFailureAlertTimerForTest } = await import(
      "../services/ai-chatbot"
    );
    _resetAiFailureAlertTimerForTest();

    // Force the top-level mock's sendAiFailureAlert to throw once, then restore.
    const { emailService: emailMod } = await import("../services/EmailService");
    const spy = vi
      .spyOn(emailMod, "sendAiFailureAlert")
      .mockRejectedValueOnce(new Error("SMTP down"));

    const response = await generateChatResponse("help me", {});
    spy.mockRestore();

    // Must return a fallback string; must not throw.
    expect(typeof response).toBe("string");
    expect(response.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Health probe state-machine
// ---------------------------------------------------------------------------

describe("runHealthProbe — state transitions", () => {
  beforeEach(() => {
    healthAlertCalls.length = 0;
    vi.resetModules();
    delete process.env.ADMIN_ALERT_EMAIL;
    process.env.ADMIN_ALERT_EMAIL = "ops@example.com";
  });

  afterEach(() => {
    delete process.env.ADMIN_ALERT_EMAIL;
  });

  it("sends a failure alert when a service transitions from ok to degraded", async () => {
    vi.doMock("../services/healthCheck", () => ({
      checkDatabase: async () => ({ status: "degraded", error: "timeout" }),
      checkSmtp: async () => ({ status: "ok" }),
      checkAi: async () => ({ status: "ok" }),
    }));

    const { runHealthProbe, _resetHealthProbeStateForTests } = await import(
      "../services/healthProbe"
    );
    _resetHealthProbeStateForTests();
    healthAlertCalls.length = 0;

    await runHealthProbe();

    const failureCalls = healthAlertCalls.filter((c) => c.type === "failure");
    expect(failureCalls.length).toBe(1);
    expect(failureCalls[0].services).toContain("db");
  });

  it("sends no alert when a service stays degraded (throttled, not newly degraded)", async () => {
    vi.doMock("../services/healthCheck", () => ({
      checkDatabase: async () => ({ status: "degraded", error: "timeout" }),
      checkSmtp: async () => ({ status: "ok" }),
      checkAi: async () => ({ status: "ok" }),
    }));

    const { runHealthProbe, _resetHealthProbeStateForTests } = await import(
      "../services/healthProbe"
    );
    _resetHealthProbeStateForTests();
    healthAlertCalls.length = 0;

    await runHealthProbe(); // first call: ok→degraded, alert fires
    const countAfterFirst = healthAlertCalls.filter((c) => c.type === "failure").length;
    expect(countAfterFirst).toBe(1);

    await runHealthProbe(); // second call: degraded→degraded, within cooldown — no new alert
    const countAfterSecond = healthAlertCalls.filter((c) => c.type === "failure").length;
    expect(countAfterSecond).toBe(1);
  });

  it("sends a recovery alert when a previously degraded service comes back up", async () => {
    // The probe uses static imports for checkDatabase, so we can't swap the mock
    // mid-test after the module is bound. Instead, we:
    //  1. Set up a "healthy" healthCheck mock.
    //  2. Import healthProbe and pre-seed db as "degraded" via the test helper.
    //  3. Run the probe — it sees degraded→ok and fires a recovery alert.
    vi.doMock("../services/healthCheck", () => ({
      checkDatabase: async () => ({ status: "ok" }),
      checkSmtp: async () => ({ status: "ok" }),
      checkAi: async () => ({ status: "ok" }),
    }));

    const {
      runHealthProbe,
      _resetHealthProbeStateForTests,
      _seedServiceStatusForTest,
    } = await import("../services/healthProbe");

    _resetHealthProbeStateForTests();
    // Pre-seed db as already degraded so the probe sees a degraded→ok transition.
    _seedServiceStatusForTest("db", "degraded");
    healthAlertCalls.length = 0;

    await runHealthProbe();

    const recoveryCalls = healthAlertCalls.filter((c) => c.type === "recovery");
    expect(recoveryCalls.length).toBeGreaterThanOrEqual(1);
    expect(recoveryCalls[0].services).toContain("db");
  });

  it("sends no alert when all services remain healthy", async () => {
    vi.doMock("../services/healthCheck", () => ({
      checkDatabase: async () => ({ status: "ok" }),
      checkSmtp: async () => ({ status: "ok" }),
      checkAi: async () => ({ status: "ok" }),
    }));

    const { runHealthProbe, _resetHealthProbeStateForTests } = await import(
      "../services/healthProbe"
    );
    _resetHealthProbeStateForTests();
    healthAlertCalls.length = 0;

    await runHealthProbe();
    await runHealthProbe();

    expect(healthAlertCalls.length).toBe(0);
  });

  it("skips alert when no admin email is configured", async () => {
    delete process.env.ADMIN_ALERT_EMAIL;

    vi.doMock("../storage", () => ({
      storage: {
        getAppSetting: vi.fn(async () => null),
        createAuditLog: vi.fn(async () => {}),
      },
    }));
    vi.doMock("../nda-integrity-sweep", () => ({
      ADMIN_ALERT_EMAIL_SETTING_KEY: "admin_alert_email",
      parseAdminAlertRecipients: () => [],
    }));
    vi.doMock("../services/healthCheck", () => ({
      checkDatabase: async () => ({ status: "degraded", error: "timeout" }),
      checkSmtp: async () => ({ status: "ok" }),
      checkAi: async () => ({ status: "ok" }),
    }));

    const { runHealthProbe, _resetHealthProbeStateForTests } = await import(
      "../services/healthProbe"
    );
    _resetHealthProbeStateForTests();
    healthAlertCalls.length = 0;

    await runHealthProbe();

    expect(healthAlertCalls.length).toBe(0);
  });
});
