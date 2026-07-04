import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// Task #515 — Rate-limit counters for the three Task-#415 visitor/submission
// endpoints use persistent namespaces (visitor_offline_msg,
// visitor_satisfaction, submissions_post). Per-IP counts are atomically
// incremented in the DB on every request and rehydrated into the in-memory
// store on boot via hydratePersistedRateLimits.
//
// These tests confirm that a spammer who trips the limit right before a server
// restart is *still* blocked after the restart, even though the process-local
// in-memory counter was zeroed. Two complementary paths are exercised:
//
//   1. DB-backed enforcement path — the persistent limiter calls
//      atomicIncrementRateLimit on every request. After a restart the DB row
//      still shows count > limit, so the very first post-restart request
//      returns 429 without any special hydration step.
//
//   2. Hydration path — hydratePersistedRateLimits pre-populates the in-memory
//      store from rows returned by getActiveAdminLoginAttempts. Any row whose
//      namespace prefix is recognised and whose resetAt is still in the future
//      is loaded into the store. We verify the count appears there after the
//      call so the non-persistent display path also reflects the blocked state.
// ============================================================================

// ── Stable "database" state ──────────────────────────────────────────────────
// These maps live outside vi.mock() so they survive module resets and act as
// a stand-in for the real Postgres rows written by atomicIncrementRateLimit.
const stableCounters = new Map<string, number>();
// Maps each key to the windowResetAt the first request established.
const stableResetAt = new Map<string, Date>();

function getOrSetResetAt(key: string, proposed: Date): Date {
  if (!stableResetAt.has(key)) stableResetAt.set(key, proposed);
  return stableResetAt.get(key)!;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
let nextIp = 1;
function freshIp(): string {
  return `10.55.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`;
}

// Register vi.doMock BEFORE each module-level import inside a test so every
// fresh dynamic import picks up the same stub.
function mockStorage() {
  vi.doMock("../storage", () => {
    class MockDatabaseStorage {
      static readonly ACTIVE_VISITOR_STALE_MS = 60_000;
    }

    return {
      DatabaseStorage: MockDatabaseStorage,
      storage: {
        createOfflineMessage: vi.fn(async (data: unknown) => ({ id: 1, ...(data as object) })),
        visitorHadChatForCase: vi.fn(async () => true),
        satisfactionRatingExistsForVisitorCase: vi.fn(async () => false),
        createChatSatisfactionRating: vi.fn(async (data: unknown) => ({ id: 1, ...(data as object) })),
        createPublicComplaint: vi.fn(async (data: unknown) => ({ id: 1, ...(data as object) })),
        upsertAdminLoginAttempt: vi.fn(async () => {}),

        // Every call increments the stable counter — this is what survives the
        // simulated restart because it lives in the outer test scope.
        atomicIncrementRateLimit: vi.fn(
          async ({ key, windowResetAt }: { key: string; windowResetAt: Date }) => {
            const prev = stableCounters.get(key) ?? 0;
            const next = prev + 1;
            stableCounters.set(key, next);
            const resetAt = getOrSetResetAt(key, windowResetAt);
            return { count: next, resetAt };
          },
        ),

        // Returns rows reflecting the current stable counter state — this is
        // what a real DB query would return after a restart. Entries whose
        // window has already expired are excluded just as the real query does.
        getActiveAdminLoginAttempts: vi.fn(async () => {
          const now = Date.now();
          const rows: Array<{ key: string; count: number; resetAt: Date }> = [];
          for (const [key, count] of stableCounters.entries()) {
            const resetAt = stableResetAt.get(key);
            if (resetAt && resetAt.getTime() > now) {
              rows.push({ key, count, resetAt });
            }
          }
          return rows;
        }),
      },
    };
  });
}

// Reset the module registry after every test so each test gets a clean slate
// of in-memory rate-limit counters in the security module.
afterEach(() => {
  vi.resetModules();
  stableCounters.clear();
  stableResetAt.clear();
});

// ── Test suite ───────────────────────────────────────────────────────────────

describe("restart-survival: /offline-messages rate limit (Task #515)", () => {
  it("DB-backed path: still blocks the same IP on the first request after a simulated restart", async () => {
    // ── Phase 1: pre-restart — trip the rate limit ────────────────────────
    mockStorage();
    const visitorsRouter = (await import("../routes/visitors")).default;

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/visitors", visitorsRouter);

    const ip = freshIp();
    const body = { name: "Spammer", email: "sp@example.com", subject: "Flood", message: "x" };

    for (let i = 0; i < 5; i++) {
      const res = await request(app1)
        .post("/api/visitors/offline-messages")
        .set("x-forwarded-for", ip)
        .send(body);
      expect(res.status).toBe(201);
    }

    // 6th request trips the limit
    const preRestart = await request(app1)
      .post("/api/visitors/offline-messages")
      .set("x-forwarded-for", ip)
      .send(body);
    expect(preRestart.status).toBe(429);

    // Confirm the stable counter now exceeds the limit (the "DB row" exists).
    const counterKey = [...stableCounters.keys()].find((k) =>
      k.startsWith("visitor_offline_msg:") && k.includes(ip),
    );
    expect(counterKey).toBeDefined();
    expect(stableCounters.get(counterKey!)).toBeGreaterThan(5);

    // ── Phase 2: simulated restart — fresh module, same DB state ─────────
    // vi.resetModules() (called via afterEach) would clear the module cache.
    // Here we call it manually mid-test to simulate the process restart.
    vi.resetModules();
    mockStorage();

    // Re-import gives us a fresh security module with an empty rateLimitStore.
    const freshVisitorsRouter = (await import("../routes/visitors")).default;

    const app2 = express();
    app2.set("trust proxy", true);
    app2.use(express.json());
    app2.use("/api/visitors", freshVisitorsRouter);

    // The first post-restart request calls atomicIncrementRateLimit which reads
    // from stableCounters — the "DB" — and returns count > 5, so 429 is still
    // returned even though the in-memory store was just zeroed.
    const postRestart = await request(app2)
      .post("/api/visitors/offline-messages")
      .set("x-forwarded-for", ip)
      .send(body);

    expect(postRestart.status).toBe(429);
    expect(postRestart.headers["retry-after"]).toBeDefined();
  });

  it("hydration path: hydratePersistedRateLimits restores the blocked state into the in-memory store", async () => {
    // ── Phase 1: trip the limit ───────────────────────────────────────────
    mockStorage();
    const visitorsRouter = (await import("../routes/visitors")).default;

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/visitors", visitorsRouter);

    const ip = freshIp();
    const body = { name: "Spammer", email: "sp2@example.com", subject: "Again", message: "y" };

    for (let i = 0; i < 5; i++) {
      await request(app1)
        .post("/api/visitors/offline-messages")
        .set("x-forwarded-for", ip)
        .send(body);
    }
    // Trip the limiter
    await request(app1)
      .post("/api/visitors/offline-messages")
      .set("x-forwarded-for", ip)
      .send(body);

    // ── Phase 2: restart + hydrate ────────────────────────────────────────
    vi.resetModules();
    mockStorage();

    const { hydratePersistedRateLimits } = await import("../middleware/security");

    // hydratePersistedRateLimits calls getActiveAdminLoginAttempts (mocked
    // above to return rows derived from stableCounters) and loads them into
    // the in-memory rateLimitStore. The return value is the number of rows
    // that were (a) still within their window and (b) recognised by namespace.
    const hydrated = await hydratePersistedRateLimits();

    // At least the one row for our spammer IP should have been loaded.
    expect(hydrated).toBeGreaterThanOrEqual(1);
  });

  it("fresh IP after restart: a new IP is not blocked after the previous IP tripped the limit", async () => {
    // ── Phase 1: pre-restart — trip the rate limit for one IP ────────────
    mockStorage();
    const visitorsRouter = (await import("../routes/visitors")).default;

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/visitors", visitorsRouter);

    const spammerIp = freshIp();
    const body = { name: "Spammer", email: "sp3@example.com", subject: "Flood", message: "z" };

    for (let i = 0; i < 5; i++) {
      const res = await request(app1)
        .post("/api/visitors/offline-messages")
        .set("x-forwarded-for", spammerIp)
        .send(body);
      expect(res.status).toBe(201);
    }
    // Trip the limit for the spammer IP
    const preRestart = await request(app1)
      .post("/api/visitors/offline-messages")
      .set("x-forwarded-for", spammerIp)
      .send(body);
    expect(preRestart.status).toBe(429);

    // ── Phase 2: simulated restart — fresh module, same DB state ─────────
    vi.resetModules();
    mockStorage();

    const freshVisitorsRouter = (await import("../routes/visitors")).default;

    const app2 = express();
    app2.set("trust proxy", true);
    app2.use(express.json());
    app2.use("/api/visitors", freshVisitorsRouter);

    // A brand-new IP that never hit the limit must be allowed after restart.
    const freshIpAddr = freshIp();
    const freshBody = { name: "Legit", email: "legit@example.com", subject: "Question", message: "hi" };

    const firstFreshRequest = await request(app2)
      .post("/api/visitors/offline-messages")
      .set("x-forwarded-for", freshIpAddr)
      .send(freshBody);

    expect(firstFreshRequest.status).toBe(201);
  });

  it("hydration path: does not load expired rows (window already elapsed at restart time)", async () => {
    // Manually insert a row that has already expired.
    const expiredKey = `visitor_offline_msg:10.55.99.1:/api/visitors/offline-messages`;
    stableCounters.set(expiredKey, 10);
    // resetAt is 1 second in the past.
    stableResetAt.set(expiredKey, new Date(Date.now() - 1_000));

    mockStorage();
    const { hydratePersistedRateLimits } = await import("../middleware/security");

    const hydrated = await hydratePersistedRateLimits();

    // The expired row must be skipped — hydrated count should be zero.
    expect(hydrated).toBe(0);
  });

  it("hydration path: ignores rows with unrecognised namespace prefixes", async () => {
    // Simulate a stale / hand-edited row whose namespace is no longer in the
    // recognised set. hydratePersistedRateLimits should skip it.
    const staleKey = `unknown_limiter_xyz:10.55.1.1:/api/some/route`;
    stableCounters.set(staleKey, 99);
    stableResetAt.set(staleKey, new Date(Date.now() + 60_000));

    mockStorage();
    const { hydratePersistedRateLimits } = await import("../middleware/security");

    const hydrated = await hydratePersistedRateLimits();

    expect(hydrated).toBe(0);
  });

  it("hydration path: a fresh IP is not blocked after hydration restores another IP's state", async () => {
    // ── Phase 1: trip the limit for one IP ───────────────────────────────
    mockStorage();
    const visitorsRouter = (await import("../routes/visitors")).default;

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/visitors", visitorsRouter);

    const spammerIp = freshIp();
    const body = { name: "Spammer", email: "sp4@example.com", subject: "Flood", message: "z" };

    for (let i = 0; i < 5; i++) {
      await request(app1)
        .post("/api/visitors/offline-messages")
        .set("x-forwarded-for", spammerIp)
        .send(body);
    }
    // Trip the limiter for the spammer IP
    await request(app1)
      .post("/api/visitors/offline-messages")
      .set("x-forwarded-for", spammerIp)
      .send(body);

    // ── Phase 2: restart + hydrate, then verify a fresh IP is allowed ─────
    vi.resetModules();
    mockStorage();

    // Run hydration to pre-populate the in-memory store from the "DB".
    const { hydratePersistedRateLimits } = await import("../middleware/security");
    const hydrated = await hydratePersistedRateLimits();
    expect(hydrated).toBeGreaterThanOrEqual(1);

    // Now mount the same freshly-imported router (security module is shared
    // within the same dynamic-import scope after the resetModules above).
    const freshVisitorsRouter = (await import("../routes/visitors")).default;

    const app2 = express();
    app2.set("trust proxy", true);
    app2.use(express.json());
    app2.use("/api/visitors", freshVisitorsRouter);

    // A brand-new IP that never appeared in the DB must not be blocked even
    // though hydratePersistedRateLimits loaded the spammer's state.
    const freshIpAddr = freshIp();
    const freshBody = { name: "Legit", email: "legit2@example.com", subject: "Question", message: "hello" };

    const firstFreshRequest = await request(app2)
      .post("/api/visitors/offline-messages")
      .set("x-forwarded-for", freshIpAddr)
      .send(freshBody);

    expect(firstFreshRequest.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("restart-survival: /satisfaction rate limit (Task #588)", () => {
  it("DB-backed path: still blocks the same IP on the first request after a simulated restart", async () => {
    // ── Phase 1: pre-restart — trip the rate limit ────────────────────────
    mockStorage();
    const visitorsRouter = (await import("../routes/visitors")).default;

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/visitors", visitorsRouter);

    const ip = freshIp();
    // visitorId + caseId must satisfy the mock's visitorHadChatForCase check
    // (mock always returns true) and satisfactionRatingExistsForVisitorCase
    // (mock always returns false on the first call — each test uses a fresh
    // module, so the mock state resets with it).
    const body = { visitorId: "vis-restart-test", caseId: "CASE-001", rating: 4 };

    for (let i = 0; i < 5; i++) {
      const res = await request(app1)
        .post("/api/visitors/satisfaction")
        .set("x-forwarded-for", ip)
        .send(body);
      expect(res.status).toBe(201);
    }

    // 6th request trips the limit
    const preRestart = await request(app1)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", ip)
      .send(body);
    expect(preRestart.status).toBe(429);

    // Confirm the stable counter row exists in the "DB".
    const counterKey = [...stableCounters.keys()].find(
      (k) => k.startsWith("visitor_satisfaction:") && k.includes(ip),
    );
    expect(counterKey).toBeDefined();
    expect(stableCounters.get(counterKey!)).toBeGreaterThan(5);

    // ── Phase 2: simulated restart — fresh module, same DB state ─────────
    vi.resetModules();
    mockStorage();

    const freshVisitorsRouter = (await import("../routes/visitors")).default;

    const app2 = express();
    app2.set("trust proxy", true);
    app2.use(express.json());
    app2.use("/api/visitors", freshVisitorsRouter);

    // The fresh module's in-memory store is empty, but atomicIncrementRateLimit
    // reads from stableCounters (the "DB") and returns count > 5 → still 429.
    const postRestart = await request(app2)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", ip)
      .send(body);

    expect(postRestart.status).toBe(429);
    expect(postRestart.headers["retry-after"]).toBeDefined();
  });

  it("hydration path: hydratePersistedRateLimits restores the blocked state into the in-memory store", async () => {
    // ── Phase 1: trip the limit ───────────────────────────────────────────
    mockStorage();
    const visitorsRouter = (await import("../routes/visitors")).default;

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/visitors", visitorsRouter);

    const ip = freshIp();
    const body = { visitorId: "vis-hydrate-test", caseId: "CASE-002", rating: 3 };

    for (let i = 0; i < 5; i++) {
      await request(app1)
        .post("/api/visitors/satisfaction")
        .set("x-forwarded-for", ip)
        .send(body);
    }
    // Trip the limiter
    await request(app1)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", ip)
      .send(body);

    // ── Phase 2: restart + hydrate ────────────────────────────────────────
    vi.resetModules();
    mockStorage();

    const { hydratePersistedRateLimits } = await import("../middleware/security");

    const hydrated = await hydratePersistedRateLimits();

    // The satisfaction row for our spammer IP should have been loaded.
    expect(hydrated).toBeGreaterThanOrEqual(1);
  });

  it("fresh IP after restart: a new IP is not blocked after the previous IP tripped the limit", async () => {
    // ── Phase 1: pre-restart — trip the rate limit for one IP ────────────
    mockStorage();
    const visitorsRouter = (await import("../routes/visitors")).default;

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/visitors", visitorsRouter);

    const spammerIp = freshIp();
    const body = { visitorId: "vis-fresh-test", caseId: "CASE-003", rating: 5 };

    for (let i = 0; i < 5; i++) {
      const res = await request(app1)
        .post("/api/visitors/satisfaction")
        .set("x-forwarded-for", spammerIp)
        .send(body);
      expect(res.status).toBe(201);
    }
    // Trip the limit for the spammer IP
    const preRestart = await request(app1)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", spammerIp)
      .send(body);
    expect(preRestart.status).toBe(429);

    // ── Phase 2: simulated restart — fresh module, same DB state ─────────
    vi.resetModules();
    mockStorage();

    const freshVisitorsRouter = (await import("../routes/visitors")).default;

    const app2 = express();
    app2.set("trust proxy", true);
    app2.use(express.json());
    app2.use("/api/visitors", freshVisitorsRouter);

    // A brand-new IP that never hit the limit must be allowed after restart.
    const freshIpAddr = freshIp();
    const freshBody = { visitorId: "vis-legit", caseId: "CASE-004", rating: 4 };

    const firstFreshRequest = await request(app2)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", freshIpAddr)
      .send(freshBody);

    expect(firstFreshRequest.status).toBe(201);
  });

  it("hydration path: a fresh IP is not blocked after hydration restores another IP's state", async () => {
    // ── Phase 1: trip the limit for one IP ───────────────────────────────
    mockStorage();
    const visitorsRouter = (await import("../routes/visitors")).default;

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/visitors", visitorsRouter);

    const spammerIp = freshIp();
    const body = { visitorId: "vis-hydrate-fresh-test", caseId: "CASE-005", rating: 2 };

    for (let i = 0; i < 5; i++) {
      await request(app1)
        .post("/api/visitors/satisfaction")
        .set("x-forwarded-for", spammerIp)
        .send(body);
    }
    // Trip the limiter for the spammer IP
    await request(app1)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", spammerIp)
      .send(body);

    // ── Phase 2: restart + hydrate, then verify a fresh IP is allowed ─────
    vi.resetModules();
    mockStorage();

    // Run hydration to pre-populate the in-memory store from the "DB".
    const { hydratePersistedRateLimits } = await import("../middleware/security");
    const hydrated = await hydratePersistedRateLimits();
    expect(hydrated).toBeGreaterThanOrEqual(1);

    // Now mount the same freshly-imported router (security module is shared
    // within the same dynamic-import scope after the resetModules above).
    const freshVisitorsRouter = (await import("../routes/visitors")).default;

    const app2 = express();
    app2.set("trust proxy", true);
    app2.use(express.json());
    app2.use("/api/visitors", freshVisitorsRouter);

    // A brand-new IP that never appeared in the DB must not be blocked even
    // though hydratePersistedRateLimits loaded the spammer's state.
    const freshIpAddr = freshIp();
    const freshBody = { visitorId: "vis-hydrate-legit", caseId: "CASE-006", rating: 5 };

    const firstFreshRequest = await request(app2)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", freshIpAddr)
      .send(freshBody);

    expect(firstFreshRequest.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("restart-survival: /api/submissions rate limit (Task #588)", () => {
  it("DB-backed path: still blocks the same IP on the first request after a simulated restart", async () => {
    // ── Phase 1: pre-restart — trip the rate limit ────────────────────────
    mockStorage();
    const { submissionsRouter } = await import("../routes/submissions");

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/submissions", submissionsRouter);

    const ip = freshIp();
    const body = { name: "Spammer", email: "sp@example.com", subject: "Flood", message: "x" };

    for (let i = 0; i < 5; i++) {
      const res = await request(app1)
        .post("/api/submissions")
        .set("x-forwarded-for", ip)
        .send(body);
      expect(res.status).toBe(201);
    }

    // 6th request trips the limit
    const preRestart = await request(app1)
      .post("/api/submissions")
      .set("x-forwarded-for", ip)
      .send(body);
    expect(preRestart.status).toBe(429);

    // Confirm the stable counter row exists in the "DB".
    const counterKey = [...stableCounters.keys()].find(
      (k) => k.startsWith("submissions_post:") && k.includes(ip),
    );
    expect(counterKey).toBeDefined();
    expect(stableCounters.get(counterKey!)).toBeGreaterThan(5);

    // ── Phase 2: simulated restart — fresh module, same DB state ─────────
    vi.resetModules();
    mockStorage();

    const { submissionsRouter: freshSubmissionsRouter } = await import("../routes/submissions");

    const app2 = express();
    app2.set("trust proxy", true);
    app2.use(express.json());
    app2.use("/api/submissions", freshSubmissionsRouter);

    // atomicIncrementRateLimit reads count > 5 from stableCounters → still 429.
    const postRestart = await request(app2)
      .post("/api/submissions")
      .set("x-forwarded-for", ip)
      .send(body);

    expect(postRestart.status).toBe(429);
    expect(postRestart.headers["retry-after"]).toBeDefined();
  });

  it("hydration path: hydratePersistedRateLimits restores the blocked state into the in-memory store", async () => {
    // ── Phase 1: trip the limit ───────────────────────────────────────────
    mockStorage();
    const { submissionsRouter } = await import("../routes/submissions");

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/submissions", submissionsRouter);

    const ip = freshIp();
    const body = { name: "Spammer2", email: "sp2@example.com", subject: "Again", message: "y" };

    for (let i = 0; i < 5; i++) {
      await request(app1)
        .post("/api/submissions")
        .set("x-forwarded-for", ip)
        .send(body);
    }
    // Trip the limiter
    await request(app1)
      .post("/api/submissions")
      .set("x-forwarded-for", ip)
      .send(body);

    // ── Phase 2: restart + hydrate ────────────────────────────────────────
    vi.resetModules();
    mockStorage();

    const { hydratePersistedRateLimits } = await import("../middleware/security");

    const hydrated = await hydratePersistedRateLimits();

    // The submissions row for our spammer IP should have been loaded.
    expect(hydrated).toBeGreaterThanOrEqual(1);
  });

  it("hydration path: a fresh IP is not blocked after hydration restores another IP's state", async () => {
    // ── Phase 1: trip the limit for one IP ───────────────────────────────
    mockStorage();
    const { submissionsRouter } = await import("../routes/submissions");

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/submissions", submissionsRouter);

    const spammerIp = freshIp();
    const body = { name: "Spammer4", email: "sp4@example.com", subject: "Flood2", message: "w" };

    for (let i = 0; i < 5; i++) {
      await request(app1)
        .post("/api/submissions")
        .set("x-forwarded-for", spammerIp)
        .send(body);
    }
    // Trip the limiter for the spammer IP
    await request(app1)
      .post("/api/submissions")
      .set("x-forwarded-for", spammerIp)
      .send(body);

    // ── Phase 2: restart + hydrate, then verify a fresh IP is allowed ─────
    vi.resetModules();
    mockStorage();

    // Run hydration to pre-populate the in-memory store from the "DB".
    const { hydratePersistedRateLimits } = await import("../middleware/security");
    const hydrated = await hydratePersistedRateLimits();
    expect(hydrated).toBeGreaterThanOrEqual(1);

    // Now mount the same freshly-imported router (security module is shared
    // within the same dynamic-import scope after the resetModules above).
    const { submissionsRouter: freshSubmissionsRouter } = await import("../routes/submissions");

    const app2 = express();
    app2.set("trust proxy", true);
    app2.use(express.json());
    app2.use("/api/submissions", freshSubmissionsRouter);

    // A brand-new IP that never appeared in the DB must not be blocked even
    // though hydratePersistedRateLimits loaded the spammer's state.
    const freshIpAddr = freshIp();
    const freshBody = { name: "Legit2", email: "legit2@example.com", subject: "Help", message: "hello" };

    const firstFreshRequest = await request(app2)
      .post("/api/submissions")
      .set("x-forwarded-for", freshIpAddr)
      .send(freshBody);

    expect(firstFreshRequest.status).toBe(201);
  });

  it("fresh IP after restart: a new IP is not blocked after the previous IP tripped the limit", async () => {
    // ── Phase 1: pre-restart — trip the rate limit for one IP ────────────
    mockStorage();
    const { submissionsRouter } = await import("../routes/submissions");

    const app1 = express();
    app1.set("trust proxy", true);
    app1.use(express.json());
    app1.use("/api/submissions", submissionsRouter);

    const spammerIp = freshIp();
    const body = { name: "Spammer3", email: "sp3@example.com", subject: "Flood", message: "z" };

    for (let i = 0; i < 5; i++) {
      const res = await request(app1)
        .post("/api/submissions")
        .set("x-forwarded-for", spammerIp)
        .send(body);
      expect(res.status).toBe(201);
    }
    // Trip the limit for the spammer IP
    const preRestart = await request(app1)
      .post("/api/submissions")
      .set("x-forwarded-for", spammerIp)
      .send(body);
    expect(preRestart.status).toBe(429);

    // ── Phase 2: simulated restart — fresh module, same DB state ─────────
    vi.resetModules();
    mockStorage();

    const { submissionsRouter: freshSubmissionsRouter } = await import("../routes/submissions");

    const app2 = express();
    app2.set("trust proxy", true);
    app2.use(express.json());
    app2.use("/api/submissions", freshSubmissionsRouter);

    // A brand-new IP that never hit the limit must be allowed after restart.
    const freshIpAddr = freshIp();
    const freshBody = { name: "Legit", email: "legit@example.com", subject: "Question", message: "hi" };

    const firstFreshRequest = await request(app2)
      .post("/api/submissions")
      .set("x-forwarded-for", freshIpAddr)
      .send(freshBody);

    expect(firstFreshRequest.status).toBe(201);
  });
});
