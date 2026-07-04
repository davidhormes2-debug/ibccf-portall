import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// withdrawalSubmitRateLimit DB-persistence cap guard
//
// withdrawalSubmitRateLimit (applied to POST /:id/withdrawal-requests) uses
// `persistNamespace: WITHDRAWAL_SUBMIT_RATE_LIMIT_NAMESPACE` so the 10-req /
// 5-min per-IP cap holds across all autoscale instances. Without DB persistence
// the per-instance budget would scale linearly with instance count, multiplying
// the effective PIN-guessing budget by the number of live processes.
//
// The test below asserts that EXACTLY 10 requests are allowed and the 11th is
// blocked. Quietly raising the cap expands the PIN brute-force budget without
// any code-review signal — an assertion here fails immediately, catching that
// regression before it ships.
// ============================================================================

const atomicCounters = new Map<string, number>();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    atomicIncrementRateLimit: vi.fn(
      async ({ key, windowResetAt }: { key: string; windowResetAt: Date }) => {
        const prev = atomicCounters.get(key) ?? 0;
        const next = prev + 1;
        atomicCounters.set(key, next);
        return { count: next, resetAt: windowResetAt };
      },
    ),
  }),
}));

// Allow all portal sessions through so the rate limiter — not the auth guard
// — is the first mechanism to fire a 429. Any non-429 response (400, 401,
// 403, 404, …) from the handler body confirms the rate-limit window is open.
vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async () => true),
}));

// Admin auth guard used by withdrawalRequests.ts via "./middleware".
vi.mock("../routes/middleware", () => ({
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
}));

// warnOnce: silence noisy console output in tests.
vi.mock("../lib/warnOnce", () => ({
  warnOnce: vi.fn(),
}));

const { registerCaseWithdrawalRoutes } = await import(
  "../routes/withdrawalRequests"
);
const { storage } = await import("../storage");

let nextIp = 1;
function freshIp(): string {
  return `10.55.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`;
}

function buildApp(): express.Application {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  // registerCaseWithdrawalRoutes mounts routes at "/:id/withdrawal-requests"
  // so we create a sub-router and mount it at /api/cases.
  const casesRouter = express.Router();
  registerCaseWithdrawalRoutes(casesRouter as unknown as Router);
  app.use("/api/cases", casesRouter);
  return app;
}

describe("POST /api/cases/:id/withdrawal-requests rate limiting (DB-persistent: withdrawalSubmitRateLimit)", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 on the 11th rapid POST from the same IP", async () => {
    const app = buildApp();
    const ip = freshIp();

    const allowed = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post("/api/cases/case-wr-rl/withdrawal-requests")
          .set("x-forwarded-for", ip)
          .send({}),
      ),
    );
    // Any non-429 status confirms the rate-limit window is still open.
    // Handler will return 404 (no case row from the mocked storage) but that
    // is not 429.
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    const blocked = await request(app)
      .post("/api/cases/case-wr-rl/withdrawal-requests")
      .set("x-forwarded-for", ip)
      .send({});

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("allowed-window cap is exactly 10 — withdrawal PIN brute-force snapshot guard", async () => {
    // Rationale: the portal withdrawal-request endpoint is gated behind a PIN
    // check (verifyPinOnly). 10 attempts per IP per 5-minute window limits
    // brute-force PIN guessing while remaining comfortable for one earnest user.
    // Persisted to the DB so the cap holds across autoscale instances —
    // otherwise the effective guessing budget scales linearly with instance
    // count (see withdrawalSubmitRateLimit in
    // server/routes/withdrawalRequests.ts).
    //
    // This test is a self-contained snapshot: it independently verifies that
    // EXACTLY 10 requests are allowed and the 11th is blocked. Quietly raising
    // the cap (e.g. to 50) expands the PIN brute-force budget without any
    // code-review signal — this assertion fails immediately, catching that
    // regression before it ships. If you intentionally change the cap, update
    // the literal 10 in the assertions AND the comment above in the same commit.
    const app = buildApp();
    const ip = freshIp();

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post("/api/cases/case-wr-snap/withdrawal-requests")
          .set("x-forwarded-for", ip)
          .send({}),
      ),
    );

    // All 10 requests in the allowed window must be non-429.
    responses.forEach((r, i) =>
      expect(r.status, `withdrawal-requests ${i + 1} of 10 must be inside the allowed window (non-429)`).not.toBe(429),
    );

    // Each of the 10 allowed requests must have incremented the DB counter
    // exactly once (DB-persistent path is active).
    const callsAfterAllowed = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ip),
    ).length;
    expect(
      callsAfterAllowed,
      "withdrawalSubmitRateLimit cap must be exactly 10 per IP per window — raise this assertion if the cap is intentionally changed",
    ).toBe(10);

    // The 11th request must be blocked — window is exhausted.
    const blocked = await request(app)
      .post("/api/cases/case-wr-snap/withdrawal-requests")
      .set("x-forwarded-for", ip)
      .send({});
    expect(blocked.status, "11th withdrawal-requests POST must be rate-limited (429)").toBe(429);
  });

  it("calls storage.atomicIncrementRateLimit on every allowed request — DB-persistence guard", async () => {
    // Core regression guard: atomicIncrementRateLimit must be called for each
    // request in the allowed window (not just the one that triggers 429).
    // In-memory limiters (no persistNamespace) never call this function, so a
    // missing persistNamespace option is caught here before it reaches production.
    const app = buildApp();
    const ip = freshIp();

    for (let i = 1; i <= 10; i++) {
      const callsBefore = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
        (c) => c[0].key.includes(ip),
      ).length;

      await request(app)
        .post("/api/cases/case-wr-db/withdrawal-requests")
        .set("x-forwarded-for", ip)
        .send({});

      const callsAfter = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
        (c) => c[0].key.includes(ip),
      ).length;

      expect(
        callsAfter,
        `withdrawal-requests ${i}: atomicIncrementRateLimit must be called (DB-persistence guard — PIN brute-force prevention)`,
      ).toBeGreaterThan(callsBefore);
    }
  });

  it("uses a key containing the canonical namespace — stable across restarts", async () => {
    // An auto-generated namespace (no persistNamespace) changes on every boot,
    // making stored rows unmatchable after a restart. The key must contain the
    // canonical WITHDRAWAL_SUBMIT_RATE_LIMIT_NAMESPACE string so rows survive
    // server restarts and cross-instance routing.
    const app = buildApp();
    const ip = freshIp();

    await request(app)
      .post("/api/cases/case-wr-ns/withdrawal-requests")
      .set("x-forwarded-for", ip)
      .send({});

    const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ip),
    );
    expect(calls.length).toBeGreaterThan(0);
    // "withdrawal_submit" is WITHDRAWAL_SUBMIT_RATE_LIMIT_NAMESPACE.
    expect(calls[0][0].key).toContain("withdrawal_submit");
  });

  it("allows a different IP through after one IP is blocked", async () => {
    const app = buildApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post("/api/cases/case-wr-iso/withdrawal-requests")
          .set("x-forwarded-for", ipA)
          .send({}),
      ),
    );

    const blockedA = await request(app)
      .post("/api/cases/case-wr-iso/withdrawal-requests")
      .set("x-forwarded-for", ipA)
      .send({});
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .post("/api/cases/case-wr-iso/withdrawal-requests")
      .set("x-forwarded-for", ipB)
      .send({});
    expect(okB.status).not.toBe(429);

    // ipB's allowed request must have gone through the DB-persistent path.
    const callsForB = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ipB),
    );
    expect(callsForB.length).toBeGreaterThan(0);
  });

  it("window duration is exactly 300 000 ms (5 minutes) — PIN brute-force snapshot guard", async () => {
    // Rationale: withdrawalSubmitRateLimit's window (5 * 60 * 1000 ms, see
    // server/routes/withdrawalRequests.ts) combines with the 10-request cap
    // to bound worst-case PIN brute-force throughput. Quietly shortening the
    // window (e.g. to 30s) multiplies the effective per-IP guessing rate the
    // same way raising the cap would, without any code-review signal — this
    // assertion fails immediately, catching that regression before it ships.
    // If you intentionally change the window, update the literal 300_000 in
    // this assertion in the same commit.
    //
    // Time is frozen with fake timers so `windowResetAt = Date.now() + windowMs`
    // can be asserted for EXACT equality — a wall-clock before/after envelope
    // would let a shortened window slip through whenever request latency
    // happens to fill the gap.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildApp();
      const ip = freshIp();

      await request(app)
        .post("/api/cases/case-wr-window/withdrawal-requests")
        .set("x-forwarded-for", ip)
        .send({});

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
        (c) => c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);

      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "withdrawalSubmitRateLimit window must be exactly 300 000 ms (5 min) — raise this assertion if the window is intentionally changed",
      ).toBe(5 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });
});
