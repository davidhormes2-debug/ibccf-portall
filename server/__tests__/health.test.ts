import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// GET /health — unified health endpoint
//
// Tests assert:
//   1. All-healthy → 200 with correct shape (db/smtp/ai/uptime/version/recentEmailFailures).
//   2. DB failure → 503.
//   3. SMTP unconfigured → 200 with smtp.status = "unconfigured".
//   4. AI timeout / degraded → 503.
//   5. recentEmailFailures counts failures recorded in the last 10 minutes.
//   6. ai.probe reflects the strategy that ran ("models" | "completion" | "models→completion-fallback").
// ============================================================================

// ── Mock the three probe functions and the failure counter ──────────────────

const mockCheckDatabase = vi.fn(async () => ({ status: "ok" as const }));
const mockCheckSmtp = vi.fn(async () => ({ status: "ok" as const }));
const mockCheckAi = vi.fn(async () => ({
  status: "ok" as const,
  probe: "models" as const,
}));
const mockGetRecentFailureCount = vi.fn(() => 0);

vi.mock("../services/healthCheck", () => ({
  checkDatabase: (...args: unknown[]) => mockCheckDatabase(...args),
  checkSmtp: (...args: unknown[]) => mockCheckSmtp(...args),
  checkAi: (...args: unknown[]) => mockCheckAi(...args),
}));

vi.mock("../services/emailFailureAlert", () => ({
  getRecentFailureCount: (...args: unknown[]) =>
    mockGetRecentFailureCount(...args),
  recordEmailFailure: vi.fn(),
  _resetFailureCounter: vi.fn(),
  maybeAlertOnEmailFailure: vi.fn(async () => {}),
  EMAIL_FAILURE_ALERT_COOLDOWN_MS: 3_600_000,
  EMAIL_FAILURE_ALERT_COOLDOWN_DEFAULT_MINUTES: 60,
  EMAIL_FAILURE_ALERT_COOLDOWN_MIN_MINUTES: 1,
  EMAIL_FAILURE_ALERT_COOLDOWN_MAX_MINUTES: 1440,
  EMAIL_FAILURE_ALERT_WINDOW_MS: 3_600_000,
  EMAIL_FAILURE_ALERT_LAST_SENT_AT_SETTING_KEY:
    "email_failure_alert_last_sent_at",
  EMAIL_FAILURE_ALERT_COOLDOWN_SETTING_KEY:
    "email_failure_alert_cooldown_minutes",
}));

// Stub the static module so we don't pull in the full build-stamp logic.
vi.mock("../static", () => ({
  getBuildStamp: () => "test-build",
  getBootTimeIso: () => new Date().toISOString(),
  serveStatic: vi.fn(),
  serveStaticAssets: vi.fn(),
}));

const { healthRouter } = await import("../routes/health");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  return app;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckDatabase.mockResolvedValue({ status: "ok" });
    mockCheckSmtp.mockResolvedValue({ status: "ok" });
    mockCheckAi.mockResolvedValue({ status: "ok", probe: "models" });
    mockGetRecentFailureCount.mockReturnValue(0);
  });

  it("returns 200 and correct shape when all probes succeed", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      db: { status: "ok" },
      smtp: { status: "ok" },
      ai: { status: "ok" },
      recentEmailFailures: 0,
    });
    expect(typeof res.body.uptime).toBe("number");
    expect(typeof res.body.version).toBe("string");
  });

  it("returns 503 when the DB probe is degraded", async () => {
    mockCheckDatabase.mockResolvedValue({
      status: "degraded",
      error: "connection refused",
    });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.db).toMatchObject({
      status: "degraded",
      error: "connection refused",
    });
  });

  it("returns 200 with smtp.status='unconfigured' when SMTP is not configured", async () => {
    mockCheckSmtp.mockResolvedValue({ status: "unconfigured" });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.smtp).toMatchObject({ status: "unconfigured" });
  });

  it("returns 503 when the AI probe is degraded", async () => {
    mockCheckAi.mockResolvedValue({
      status: "degraded",
      error: "OpenAI probe timed out",
    });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.ai).toMatchObject({
      status: "degraded",
      error: "OpenAI probe timed out",
    });
  });

  it("surfaces the recentEmailFailures count from the rolling counter", async () => {
    mockGetRecentFailureCount.mockReturnValue(3);
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.recentEmailFailures).toBe(3);
  });

  it("returns 503 when both SMTP and AI are degraded", async () => {
    mockCheckSmtp.mockResolvedValue({ status: "degraded", error: "timeout" });
    mockCheckAi.mockResolvedValue({ status: "degraded", error: "timeout" });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(503);
  });

  it("sets Cache-Control: no-store so proxies never cache the result", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });

  // ── ai.probe shape tests ──────────────────────────────────────────────────

  it('surfaces ai.probe="models" when the models strategy succeeds', async () => {
    mockCheckAi.mockResolvedValue({ status: "ok", probe: "models" });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ai.probe).toBe("models");
  });

  it('surfaces ai.probe="completion" when the completion strategy is configured', async () => {
    mockCheckAi.mockResolvedValue({ status: "ok", probe: "completion" });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ai.probe).toBe("completion");
  });

  it('surfaces ai.probe="models→completion-fallback" when models 404s and falls back', async () => {
    mockCheckAi.mockResolvedValue({
      status: "ok",
      probe: "models→completion-fallback",
    });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ai.probe).toBe("models→completion-fallback");
  });

  it("omits ai.probe when the AI probe is degraded", async () => {
    mockCheckAi.mockResolvedValue({
      status: "degraded",
      error: "OpenAI probe timed out",
    });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.ai.probe).toBeUndefined();
  });

  it("omits ai.probe when AI is unconfigured", async () => {
    mockCheckAi.mockResolvedValue({ status: "unconfigured" });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ai.probe).toBeUndefined();
  });
});

