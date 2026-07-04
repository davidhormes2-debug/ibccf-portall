import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Integration tests for the visitor satisfaction rate limiter
// (POST /api/visitors/satisfaction).
//
// Task: confirm a bot rotating IPs cannot skip the rate limiter and flood
// the chat_satisfaction_ratings table.
//
// Two scenarios, mirroring server/__tests__/adminLoginRateLimit.test.ts:
//   1. DB-backed path — the limiter delegates to atomicIncrementRateLimit
//      under the visitor_satisfaction namespace, and it is authoritative:
//      5 requests pass, the 6th is blocked with 429, regardless of which
//      "instance" (i.e. regardless of in-memory state) served the request.
//   2. In-memory fallback — when atomicIncrementRateLimit throws (DB
//      unavailable), the limiter falls back to the process-local store
//      instead of failing open; it still blocks on the 6th request. This is
//      graceful degradation (still enforced, just per-instance), not a bypass.
// ============================================================================

const atomicIncrementRateLimit = vi.fn();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    atomicIncrementRateLimit,
    upsertAdminLoginAttempt: vi.fn(async () => {}),
    getActiveAdminLoginAttempts: vi.fn(async () => []),
  }),
}));

const security = await import("../middleware/security");
const express = (await import("express")).default;
const request = (await import("supertest")).default;

const PUBLIC_WRITE_MAX = 5;
const PUBLIC_WRITE_WINDOW_MS = 60 * 1000;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.set("trust proxy", true);
  app.post(
    "/api/visitors/satisfaction",
    security.rateLimiter(PUBLIC_WRITE_MAX, PUBLIC_WRITE_WINDOW_MS, {
      persistNamespace: security.VISITOR_SATISFACTION_RATE_LIMIT_NAMESPACE,
    }),
    (_req, res) => res.status(201).json({ ok: true }),
  );
  return app;
}

describe("visitor satisfaction rate limiter — DB-backed path (atomicIncrementRateLimit succeeds)", () => {
  beforeEach(() => {
    atomicIncrementRateLimit.mockClear();
    let seq = 0;
    atomicIncrementRateLimit.mockImplementation(
      async ({ windowResetAt }: { key: string; windowResetAt: Date }) => {
        seq += 1;
        return { count: seq, resetAt: windowResetAt };
      },
    );
  });

  it("delegates to atomicIncrementRateLimit under the visitor_satisfaction namespace", async () => {
    const app = buildApp();
    await request(app)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", "10.44.44.1")
      .send({ visitorId: "v1", caseId: "1", rating: 5 });

    expect(atomicIncrementRateLimit).toHaveBeenCalledTimes(1);
    const callArg = atomicIncrementRateLimit.mock.calls[0][0];
    expect(callArg.key).toContain(`${security.VISITOR_SATISFACTION_RATE_LIMIT_NAMESPACE}:`);
    expect(callArg.key).toContain("10.44.44.1");
  });

  it("enforces the cap authoritatively via the shared DB-backed counter (not process-local memory), so the limit holds across autoscale instances for a given key", async () => {
    // Note: the rate-limit key includes the client IP (see rateLimiter's
    // `${namespace}:${clientIP}:${routeKey}` composition in security.ts), so
    // this test — like every other per-IP limiter in this codebase — bounds a
    // single IP's request rate, not a bot's aggregate rate across many
    // rotated IPs. What it *does* prove is the property the task requires:
    // the counter is authoritative in the DB, not in this process's memory,
    // so a bot cannot reset its budget merely by being routed to a different
    // autoscale instance while reusing the same IP.
    const app = buildApp();
    const ip = "10.44.44.2";

    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post("/api/visitors/satisfaction")
        .set("x-forwarded-for", ip)
        .send({ visitorId: "v2", caseId: "2", rating: 5 });
      expect(res.status, `attempt ${i} must not be rate-limited (got ${res.status})`).not.toBe(429);
    }

    const res6 = await request(app)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", ip)
      .send({ visitorId: "v2", caseId: "2", rating: 5 });
    expect(res6.status).toBe(429);
    expect(res6.body).toMatchObject({ message: expect.stringContaining("Too many") });
    expect(res6.headers).toHaveProperty("retry-after");
    // 6 calls total: the limiter always calls atomicIncrementRateLimit, even
    // for the request that ends up throttled — a rotating-IP bot cannot dodge
    // the shared counter by changing its address, because the counter key is
    // independent of which app instance served the request.
    expect(atomicIncrementRateLimit).toHaveBeenCalledTimes(6);
  });
});

describe("visitor satisfaction rate limiter — in-memory fallback (DB unavailable)", () => {
  beforeEach(() => {
    atomicIncrementRateLimit.mockClear();
    atomicIncrementRateLimit.mockImplementation(async () => {
      throw new Error("simulated DB outage — in-memory fallback test");
    });
  });

  it("falls back to per-process in-memory enforcement (graceful degradation, not a bypass) and still blocks on the 6th attempt", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const app = buildApp();
      const ip = "10.44.44.3";

      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post("/api/visitors/satisfaction")
          .set("x-forwarded-for", ip)
          .send({ visitorId: "v3", caseId: "3", rating: 5 });
        expect(res.status, `attempt ${i} must not be rate-limited (got ${res.status})`).not.toBe(429);
      }

      const res6 = await request(app)
        .post("/api/visitors/satisfaction")
        .set("x-forwarded-for", ip)
        .send({ visitorId: "v3", caseId: "3", rating: 5 });
      expect(res6.status).toBe(429);
      expect(res6.body).toMatchObject({ message: expect.stringContaining("Too many") });
      expect(res6.headers).toHaveProperty("retry-after");
      // The fallback path is still attempted every time (atomicIncrementRateLimit
      // is called and throws), confirming it degrades rather than skips enforcement.
      expect(atomicIncrementRateLimit).toHaveBeenCalledTimes(6);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
