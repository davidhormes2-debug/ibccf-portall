import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Integration tests for the admin login rate limiter (POST /api/admin/login).
//
// Three scenarios are covered:
//   1. DB-backed path via security.loginRateLimiter() directly: attempts 1–5
//      pass, attempt 6 returns 429.
//   2. In-memory fallback via security.loginRateLimiter() directly:
//      atomicIncrementRateLimit always throws, limiter falls back to the
//      process-local rateLimitStore — still allows 1–5, blocks on 6.
//   3. Route-level wrapper adminLoginLimiter() from server/routes/admin.ts:
//      uses the real exported function (which adds an `onThrottled` audit hook)
//      to confirm the wrapper wires the limiter correctly and fires
//      storage.createAuditLog with `admin_login_throttled` on the 6th attempt.
//
// Each scenario uses a distinct client IP so the shared module-level
// rateLimitStore never leaks state between tests.
// ============================================================================

const atomicIncrementRateLimit = vi.fn();
const createAuditLog = vi.fn(async () => ({ id: 1 }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    atomicIncrementRateLimit,
    createAuditLog,
    upsertAdminLoginAttempt: vi.fn(async () => {}),
    getActiveAdminLoginAttempts: vi.fn(async () => []),
  }),
}));

// Stub the heavy static/prerender chain that admin.ts pulls in transitively
// via `import { getBuildStamp, getBootTimeIso } from "../static"`.
vi.mock("../static", () => ({
  getBuildStamp: () => "test-build",
  getBootTimeIso: () => new Date().toISOString(),
  serveStaticAssets: vi.fn(),
}));

const security = await import("../middleware/security");
const { adminLoginLimiter } = await import("../routes/admin");
const express = (await import("express")).default;
const request = (await import("supertest")).default;

// ── DB-backed path ─────────────────────────────────────────────────────────

describe("admin login rate limiter — DB-backed path (atomicIncrementRateLimit succeeds)", () => {
  beforeEach(() => {
    let seq = 0;
    atomicIncrementRateLimit.mockImplementation(
      async ({ windowResetAt }: { key: string; windowResetAt: Date }) => {
        seq += 1;
        return { count: seq, resetAt: windowResetAt };
      },
    );
  });

  it("allows exactly 5 attempts and returns 429 on the 6th", async () => {
    const app = express();
    app.set("trust proxy", true);
    app.use("/api/admin/login", security.loginRateLimiter());
    app.post("/api/admin/login", (_req, res) => res.json({ ok: true }));

    const ip = "10.11.11.11";

    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post("/api/admin/login")
        .set("x-forwarded-for", ip)
        .send({ username: "u", password: "p" });
      expect(res.status, `attempt ${i} must not be rate-limited (got ${res.status})`).not.toBe(429);
    }

    const res6 = await request(app)
      .post("/api/admin/login")
      .set("x-forwarded-for", ip)
      .send({ username: "u", password: "p" });
    expect(res6.status).toBe(429);
    expect(res6.body).toMatchObject({ message: expect.stringContaining("Too many") });
    expect(res6.headers).toHaveProperty("retry-after");
  });

  it("window duration is exactly 900 000 ms (15 minutes) — brute-force lockout snapshot guard", async () => {
    // Rationale: LOGIN_RATE_LIMIT_WINDOW_MS (server/middleware/security.ts)
    // combines with the 5-attempt cap to bound worst-case admin credential
    // brute-force throughput. Quietly shortening the window (e.g. to 1 minute)
    // multiplies the effective per-IP guessing rate the same way raising the
    // cap would, without any code-review signal — this assertion fails
    // immediately, catching that regression before it ships. If you
    // intentionally change the window, update the literal 900_000 in this
    // assertion in the same commit.
    //
    // Time is frozen with fake timers so `windowResetAt = Date.now() + windowMs`
    // can be asserted for EXACT equality — a wall-clock before/after envelope
    // would let a shortened window slip through whenever request latency
    // happens to fill the gap.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = express();
      app.set("trust proxy", true);
      app.use("/api/admin/login", security.loginRateLimiter());
      app.post("/api/admin/login", (_req, res) => res.json({ ok: true }));

      const ip = "10.11.11.99";

      await request(app)
        .post("/api/admin/login")
        .set("x-forwarded-for", ip)
        .send({ username: "u", password: "p" });

      const calls = atomicIncrementRateLimit.mock.calls.filter((c: any) =>
        (c[0].key as string).includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);

      const windowResetAt = (calls[0][0] as { windowResetAt: Date }).windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "admin login rate-limit window must be exactly 900 000 ms (15 min) — raise this assertion if the window is intentionally changed",
      ).toBe(15 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── In-memory fallback path ────────────────────────────────────────────────

describe("admin login rate limiter — in-memory fallback (DB unavailable)", () => {
  beforeEach(() => {
    atomicIncrementRateLimit.mockImplementation(async () => {
      throw new Error("simulated DB outage — in-memory fallback test");
    });
  });

  it("falls back to per-process in-memory enforcement and still blocks on the 6th attempt", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const app = express();
      app.set("trust proxy", true);
      app.use("/api/admin/login", security.loginRateLimiter());
      app.post("/api/admin/login", (_req, res) => res.json({ ok: true }));

      const ip = "10.22.22.22";

      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post("/api/admin/login")
          .set("x-forwarded-for", ip)
          .send({ username: "u", password: "p" });
        expect(res.status, `attempt ${i} must not be rate-limited (got ${res.status})`).not.toBe(429);
      }

      const res6 = await request(app)
        .post("/api/admin/login")
        .set("x-forwarded-for", ip)
        .send({ username: "u", password: "p" });
      expect(res6.status).toBe(429);
      expect(res6.body).toMatchObject({ message: expect.stringContaining("Too many") });
      expect(res6.headers).toHaveProperty("retry-after");
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ── Route-level wrapper: adminLoginLimiter() from server/routes/admin.ts ──

describe("adminLoginLimiter() route export — onThrottled audit hook wiring", () => {
  beforeEach(() => {
    let seq = 0;
    atomicIncrementRateLimit.mockImplementation(
      async ({ windowResetAt }: { key: string; windowResetAt: Date }) => {
        seq += 1;
        return { count: seq, resetAt: windowResetAt };
      },
    );
    createAuditLog.mockClear();
  });

  it("blocks on the 6th attempt and calls storage.createAuditLog with admin_login_throttled", async () => {
    const app = express();
    app.use(express.json());
    app.set("trust proxy", true);
    app.use("/api/admin/login", adminLoginLimiter());
    app.post("/api/admin/login", (_req, res) => res.json({ ok: true }));

    const ip = "10.33.33.33";

    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post("/api/admin/login")
        .set("x-forwarded-for", ip)
        .send({ username: "testuser", password: "p" });
      expect(res.status, `attempt ${i} must not be rate-limited (got ${res.status})`).not.toBe(429);
    }

    const res6 = await request(app)
      .post("/api/admin/login")
      .set("x-forwarded-for", ip)
      .send({ username: "testuser", password: "p" });
    expect(res6.status).toBe(429);

    // Allow the fire-and-forget onThrottled hook to complete.
    await new Promise((r) => setImmediate(r));

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin_login_throttled",
        adminUsername: "testuser",
        targetType: "admin_session",
      }),
    );
  });
});
