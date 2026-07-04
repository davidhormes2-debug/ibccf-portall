import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../storage";

// Hoist both the factory helper and the counters map so they are available
// inside vi.mock (which vitest also hoists before module initialisation).
// A plain top-level `import { createStorageMock }` would trigger
// "Cannot access '__vi_import_N__' before initialization" because the import
// binding doesn't exist yet when the mock factory runs.
const { createStorageMock, atomicCounters } = await vi.hoisted(async () => {
  const { createStorageMock } = await import("./helpers/storageMock");
  const atomicCounters = new Map<string, number>();
  return { createStorageMock, atomicCounters };
});

vi.mock("../storage", () => ({
  DatabaseStorage: class MockDatabaseStorage {
    static readonly ACTIVE_VISITOR_STALE_MS = 60_000;
  },
  storage: createStorageMock({
    createOfflineMessage: vi.fn(async (data: any) => ({ id: 1, ...data })),
    visitorHadChatForCase: vi.fn(async () => true),
    satisfactionRatingExistsForVisitorCase: vi.fn(async () => false),
    createChatSatisfactionRating: vi.fn(async (data: any) => ({ id: 1, ...data })),
    createPublicComplaint: vi.fn(async (data: any) => ({ id: 1, ...data })),
    createActiveVisitor: vi.fn(async (_data: any) => ({ id: 1 })),
    getAllPublicComplaints: vi.fn(async () => []),
    getAdminSessionByToken: vi.fn(async () => ({
      id: 1,
      token: "admin-test-token",
      isActive: true,
      revokedAt: null,
      expiresAt: null,
      adminUsername: "admin-tester",
    })),
    getAdminAvailability: vi.fn(async () => ({ status: "offline" })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    upsertAdminLoginAttempt: vi.fn(async () => {}),
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

const visitorsRouter = (await import("../routes/visitors")).default;

function buildApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/visitors", visitorsRouter);
  return app;
}

let nextIp = 1;
function freshIp(): string {
  return `10.88.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`;
}

describe("visitor offline-messages rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.createOfflineMessage).mockClear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 after 5 rapid POSTs to /offline-messages from the same IP", async () => {
    const app = buildApp();
    const ip = freshIp();
    const body = {
      name: "Alice",
      email: "alice@example.com",
      subject: "Help",
      message: "Hello",
    };

    const allowed = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/visitors/offline-messages")
          .set("x-forwarded-for", ip)
          .send(body),
      ),
    );
    allowed.forEach((r) => expect(r.status).toBe(201));

    const callsBeforeBlock = vi.mocked(storage.createOfflineMessage).mock.calls.length;

    const blocked = await request(app)
      .post("/api/visitors/offline-messages")
      .set("x-forwarded-for", ip)
      .send(body);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    // The blocked request must not have reached storage.
    expect(vi.mocked(storage.createOfflineMessage).mock.calls.length).toBe(callsBeforeBlock);
    // Total: only the 5 allowed requests touched storage.
    expect(vi.mocked(storage.createOfflineMessage)).toHaveBeenCalledTimes(5);
  });

  it("allows a different IP through after one IP is blocked", async () => {
    const app = buildApp();
    const ipA = freshIp();
    const ipB = freshIp();
    const body = {
      name: "Bob",
      email: "bob@example.com",
      subject: "Question",
      message: "Hi there",
    };

    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/visitors/offline-messages")
          .set("x-forwarded-for", ipA)
          .send(body),
      ),
    );
    const callsBeforeBlock = vi.mocked(storage.createOfflineMessage).mock.calls.length;
    const blockedA = await request(app)
      .post("/api/visitors/offline-messages")
      .set("x-forwarded-for", ipA)
      .send(body);
    expect(blockedA.status).toBe(429);
    // The blocked request must not have reached storage.
    expect(vi.mocked(storage.createOfflineMessage).mock.calls.length).toBe(callsBeforeBlock);

    const okB = await request(app)
      .post("/api/visitors/offline-messages")
      .set("x-forwarded-for", ipB)
      .send(body);
    expect(okB.status).toBe(201);
    // 5 from ipA (rate-limited on 6th) + 1 from ipB = 6 storage calls total.
    expect(vi.mocked(storage.createOfflineMessage)).toHaveBeenCalledTimes(6);
  });

  it("calls storage.atomicIncrementRateLimit exactly once for a single allowed request — DB-persistence guard", async () => {
    // Core regression guard: if persistNamespace is removed or renamed from the
    // offline-messages limiter, the middleware falls back to in-memory limiting
    // which never calls storage.atomicIncrementRateLimit.  This test would then
    // fail with "Expected 1 call, received 0", catching the regression before
    // it reaches production.
    const app = buildApp();
    const body = {
      name: "Alice",
      email: "alice@example.com",
      subject: "Help",
      message: "Hello",
    };

    const res = await request(app)
      .post("/api/visitors/offline-messages")
      .set("x-forwarded-for", freshIp())
      .send(body);

    expect(res.status).toBe(201);
    expect(vi.mocked(storage.atomicIncrementRateLimit)).toHaveBeenCalledTimes(1);
  });

  it("window duration is exactly 60 000 ms — abuse-prevention snapshot guard", async () => {
    // Rationale: VISITOR_OFFLINE_MSG's window (PUBLIC_WRITE_WINDOW_MS, see
    // server/routes/visitors.ts) combines with the 5-request cap to bound
    // worst-case abuse throughput. Quietly shortening the window multiplies
    // the effective per-IP rate the same way raising the cap would, without
    // any code-review signal. Time is frozen so `windowResetAt` can be
    // asserted for EXACT equality. If you intentionally change the window,
    // update the literal 60_000 in this assertion in the same commit.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildApp();
      const ip = freshIp();

      await request(app)
        .post("/api/visitors/offline-messages")
        .set("x-forwarded-for", ip)
        .send({ name: "Window", email: "w@example.com", subject: "Hi", message: "hi" });

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "offline-messages rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("visitor satisfaction rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.createChatSatisfactionRating).mockClear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 after 5 rapid POSTs to /satisfaction from the same IP", async () => {
    const app = express();
    app.set("trust proxy", true);
    app.use(express.json());
    app.use("/api/visitors", visitorsRouter);
    const ip = freshIp();
    const body = {
      visitorId: "vis-123",
      caseId: "case-abc",
      rating: 5,
    };

    const allowed = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/visitors/satisfaction")
          .set("x-forwarded-for", ip)
          .send(body),
      ),
    );
    allowed.forEach((r) => expect(r.status).toBe(201));

    const callCountBeforeBlocked = vi.mocked(storage.createChatSatisfactionRating).mock.calls.length;

    const blocked = await request(app)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", ip)
      .send(body);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();

    expect(vi.mocked(storage.createChatSatisfactionRating)).toHaveBeenCalledTimes(5);
    // The blocked request must not have triggered a storage write.
    expect(vi.mocked(storage.createChatSatisfactionRating).mock.calls.length).toBe(callCountBeforeBlocked);
  });

  it("allows a different IP through after one IP is blocked", async () => {
    const app = buildApp();
    const ipA = freshIp();
    const ipB = freshIp();
    const body = {
      visitorId: "vis-456",
      caseId: "case-def",
      rating: 4,
    };

    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/visitors/satisfaction")
          .set("x-forwarded-for", ipA)
          .send(body),
      ),
    );
    const callsBeforeBlock = vi.mocked(storage.createChatSatisfactionRating).mock.calls.length;
    const blockedA = await request(app)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", ipA)
      .send(body);
    expect(blockedA.status).toBe(429);
    // The blocked request must not have reached storage.
    expect(vi.mocked(storage.createChatSatisfactionRating).mock.calls.length).toBe(callsBeforeBlock);

    const okB = await request(app)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", ipB)
      .send(body);
    expect(okB.status).toBe(201);
    // 5 from ipA (rate-limited on 6th) + 1 from ipB = 6 storage calls total.
    expect(vi.mocked(storage.createChatSatisfactionRating)).toHaveBeenCalledTimes(6);
  });

  it("calls storage.atomicIncrementRateLimit exactly once for a single allowed request — DB-persistence guard", async () => {
    // Core regression guard: if persistNamespace is removed or renamed from the
    // satisfaction limiter, the middleware falls back to in-memory limiting
    // which never calls storage.atomicIncrementRateLimit.  This test would then
    // fail with "Expected 1 call, received 0", catching the regression before
    // it reaches production.
    const app = buildApp();
    const body = { visitorId: "vis-guard", caseId: "case-guard", rating: 5 };

    const res = await request(app)
      .post("/api/visitors/satisfaction")
      .set("x-forwarded-for", freshIp())
      .send(body);

    expect(res.status).toBe(201);
    expect(vi.mocked(storage.atomicIncrementRateLimit)).toHaveBeenCalledTimes(1);
  });

  it("window duration is exactly 60 000 ms — abuse-prevention snapshot guard", async () => {
    // Rationale: see the offline-messages window test above for full context.
    // VISITOR_SATISFACTION uses the same PUBLIC_WRITE_WINDOW_MS constant but is
    // a distinct persistNamespace, so it can regress independently.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildApp();
      const ip = freshIp();

      await request(app)
        .post("/api/visitors/satisfaction")
        .set("x-forwarded-for", ip)
        .send({ visitorId: "vis-window", caseId: "case-window", rating: 5 });

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "satisfaction rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("visitor heartbeat rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.createActiveVisitor).mockClear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 after 60 rapid POSTs to /heartbeat from the same IP", async () => {
    // Sandbox note: 60 parallel supertest requests take longer than the 5 s
    // default; raised to 30 s so this does not flake on slow CI/sandbox runs.
    const app = buildApp();
    const ip = freshIp();
    const body = { visitorId: `vis-hb-${ip}`, currentPage: "/test" };

    const allowed = await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app)
          .post("/api/visitors/heartbeat")
          .set("x-forwarded-for", ip)
          .send(body),
      ),
    );
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    const callsBeforeBlock = vi.mocked(storage.createActiveVisitor).mock.calls.length;

    const blocked = await request(app)
      .post("/api/visitors/heartbeat")
      .set("x-forwarded-for", ip)
      .send(body);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    // The blocked request must not have reached storage.
    expect(vi.mocked(storage.createActiveVisitor).mock.calls.length).toBe(callsBeforeBlock);
  }, 30_000);

  it("allows a different IP through after one IP is blocked on /heartbeat", async () => {
    // Sandbox note: two batches of 60 parallel supertest requests can exceed
    // the 5 s default on slow CI/sandbox runs; raised to 30 s.
    const app = buildApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app)
          .post("/api/visitors/heartbeat")
          .set("x-forwarded-for", ipA)
          .send({ visitorId: `vis-hb-a-${ipA}`, currentPage: "/test" }),
      ),
    );
    const callsBeforeBlock = vi.mocked(storage.createActiveVisitor).mock.calls.length;
    const blockedA = await request(app)
      .post("/api/visitors/heartbeat")
      .set("x-forwarded-for", ipA)
      .send({ visitorId: `vis-hb-a-${ipA}`, currentPage: "/test" });
    expect(blockedA.status).toBe(429);
    // The blocked request must not have reached storage.
    expect(vi.mocked(storage.createActiveVisitor).mock.calls.length).toBe(callsBeforeBlock);

    const okB = await request(app)
      .post("/api/visitors/heartbeat")
      .set("x-forwarded-for", ipB)
      .send({ visitorId: `vis-hb-b-${ipB}`, currentPage: "/test" });
    expect(okB.status).not.toBe(429);
    // ipB's request must have reached storage.
    expect(vi.mocked(storage.createActiveVisitor).mock.calls.length).toBeGreaterThan(callsBeforeBlock);
  }, 30_000);

  it("calls storage.atomicIncrementRateLimit exactly once for a single allowed request — DB-persistence guard", async () => {
    // Core regression guard: if persistNamespace is removed or renamed from the
    // heartbeat limiter, the middleware falls back to in-memory limiting which
    // never calls storage.atomicIncrementRateLimit.  This test would then fail
    // with "Expected 1 call, received 0", catching the regression before it
    // reaches production.
    const app = buildApp();

    const res = await request(app)
      .post("/api/visitors/heartbeat")
      .set("x-forwarded-for", freshIp())
      .send({ visitorId: "vis-hb-guard", currentPage: "/test" });

    expect(res.status).not.toBe(429);
    expect(vi.mocked(storage.atomicIncrementRateLimit)).toHaveBeenCalledTimes(1);
  });

  it("window duration is exactly 60 000 ms — abuse-prevention snapshot guard", async () => {
    // Rationale: see the offline-messages window test above for full context.
    // VISITOR_HEARTBEAT uses the same PUBLIC_WRITE_WINDOW_MS constant but is a
    // distinct persistNamespace, so it can regress independently.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildApp();
      const ip = freshIp();

      await request(app)
        .post("/api/visitors/heartbeat")
        .set("x-forwarded-for", ip)
        .send({ visitorId: `vis-hb-window-${ip}`, currentPage: "/test" });

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "heartbeat rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("visitor typing-indicator rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 after 120 rapid POSTs to /typing from the same IP", async () => {
    // 120 parallel supertest requests can exceed the 5 s default on slow
    // CI/sandbox runs; timeout raised to 30 s to avoid flakes.
    const app = buildApp();
    const ip = freshIp();
    const body = { caseId: "rl-case-1", sender: "user", isTyping: true };

    const allowed = await Promise.all(
      Array.from({ length: 120 }, () =>
        request(app)
          .post("/api/visitors/typing")
          .set("x-forwarded-for", ip)
          .send(body),
      ),
    );
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    // The typing handler writes only to in-memory state (typingIndicators map),
    // not to the database. Snapshot atomicIncrementRateLimit calls: the blocked
    // request adds exactly one more write (the rate-limiter counter increment),
    // with no additional writes from the handler body itself.
    const callsBeforeBlock = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    const blocked = await request(app)
      .post("/api/visitors/typing")
      .set("x-forwarded-for", ip)
      .send(body);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    // Exactly one additional storage write (the rate-limiter counter increment);
    // no extra writes from the handler body occurred.
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(
      callsBeforeBlock + 1,
    );
  }, 30_000);

  it("allows a different IP through after one IP is blocked on /typing", async () => {
    // Two batches of 120 parallel supertest requests; timeout raised to 30 s.
    const app = buildApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: 120 }, () =>
        request(app)
          .post("/api/visitors/typing")
          .set("x-forwarded-for", ipA)
          .send({ caseId: "rl-case-2", sender: "user", isTyping: true }),
      ),
    );
    const callsBeforeBlock = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    const blockedA = await request(app)
      .post("/api/visitors/typing")
      .set("x-forwarded-for", ipA)
      .send({ caseId: "rl-case-2", sender: "user", isTyping: true });
    expect(blockedA.status).toBe(429);
    // Only the rate-limiter's counter increment ran; the handler body did not.
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(
      callsBeforeBlock + 1,
    );

    const okB = await request(app)
      .post("/api/visitors/typing")
      .set("x-forwarded-for", ipB)
      .send({ caseId: "rl-case-3", sender: "user", isTyping: true });
    expect(okB.status).not.toBe(429);
  }, 30_000);

  it("calls storage.atomicIncrementRateLimit exactly once for a single allowed request — DB-persistence guard", async () => {
    // Core regression guard: if persistNamespace is removed or renamed from the
    // POST typing limiter, the middleware falls back to in-memory limiting which
    // never calls storage.atomicIncrementRateLimit.  This test would then fail
    // with "Expected 1 call, received 0", catching the regression before it
    // reaches production.
    const app = buildApp();

    const res = await request(app)
      .post("/api/visitors/typing")
      .set("x-forwarded-for", freshIp())
      .send({ caseId: "rl-guard-case", sender: "user", isTyping: true });

    expect(res.status).not.toBe(429);
    expect(vi.mocked(storage.atomicIncrementRateLimit)).toHaveBeenCalledTimes(1);
  });

  it("window duration is exactly 60 000 ms — abuse-prevention snapshot guard", async () => {
    // Rationale: see the offline-messages window test above for full context.
    // VISITOR_TYPING uses the same PUBLIC_WRITE_WINDOW_MS constant but is a
    // distinct persistNamespace, so it can regress independently.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildApp();
      const ip = freshIp();

      await request(app)
        .post("/api/visitors/typing")
        .set("x-forwarded-for", ip)
        .send({ caseId: "rl-window-case", sender: "user", isTyping: true });

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "typing (POST) rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("visitor GET typing-indicator rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 after 120 rapid GETs to /typing/:caseId from the same IP", async () => {
    // 120 parallel supertest requests can exceed the 5 s default on slow
    // CI/sandbox runs; timeout raised to 30 s to avoid flakes.
    const app = buildApp();
    const ip = freshIp();

    const allowed = await Promise.all(
      Array.from({ length: 120 }, () =>
        request(app)
          .get("/api/visitors/typing/rl-get-case-1")
          .set("x-forwarded-for", ip),
      ),
    );
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    // The GET typing handler reads only in-memory state — no storage calls.
    // Snapshot atomicIncrementRateLimit calls: the blocked request adds
    // exactly one more write (the rate-limiter counter increment).
    const callsBeforeBlock = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    const blocked = await request(app)
      .get("/api/visitors/typing/rl-get-case-1")
      .set("x-forwarded-for", ip);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    // Exactly one additional storage write (the rate-limiter counter increment);
    // no extra writes from the handler body occurred.
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(
      callsBeforeBlock + 1,
    );
  }, 30_000);

  it("allows a different IP through after one IP is blocked on GET /typing/:caseId", async () => {
    // Two batches of 120 parallel supertest requests; timeout raised to 30 s.
    const app = buildApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: 120 }, () =>
        request(app)
          .get("/api/visitors/typing/rl-get-case-2")
          .set("x-forwarded-for", ipA),
      ),
    );
    const callsBeforeBlock = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    const blockedA = await request(app)
      .get("/api/visitors/typing/rl-get-case-2")
      .set("x-forwarded-for", ipA);
    expect(blockedA.status).toBe(429);
    // Only the rate-limiter's counter increment ran; the handler body did not.
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(
      callsBeforeBlock + 1,
    );

    const okB = await request(app)
      .get("/api/visitors/typing/rl-get-case-3")
      .set("x-forwarded-for", ipB);
    expect(okB.status).not.toBe(429);
  }, 30_000);

  it("calls storage.atomicIncrementRateLimit exactly once for a single allowed request — DB-persistence guard", async () => {
    // Core regression guard: if persistNamespace is removed or renamed from the
    // GET typing limiter, the middleware falls back to in-memory limiting which
    // never calls storage.atomicIncrementRateLimit.  This test would then fail
    // with "Expected 1 call, received 0", catching the regression before it
    // reaches production.
    const app = buildApp();

    const res = await request(app)
      .get("/api/visitors/typing/rl-get-guard-case")
      .set("x-forwarded-for", freshIp());

    expect(res.status).not.toBe(429);
    expect(vi.mocked(storage.atomicIncrementRateLimit)).toHaveBeenCalledTimes(1);
  });

  it("window duration is exactly 60 000 ms — abuse-prevention snapshot guard", async () => {
    // Rationale: see the offline-messages window test above for full context.
    // GET /typing/:caseId uses the same PUBLIC_WRITE_WINDOW_MS constant but is
    // a distinct persistNamespace, so it can regress independently.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildApp();
      const ip = freshIp();

      await request(app)
        .get("/api/visitors/typing/rl-get-window-case")
        .set("x-forwarded-for", ip);

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "typing (GET) rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

const { submissionsRouter } = await import("../routes/submissions");
const { adminPublicContentRouter } = await import("../routes/public");

function buildSubmissionsApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/submissions", submissionsRouter);
  return app;
}

function buildAdminContentApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/admin/content", adminPublicContentRouter);
  return app;
}

describe("public complaint-intake rate limiting (POST /api/submissions)", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.createPublicComplaint).mockClear();
  });

  it("returns 429 on the 6th rapid POST from the same IP", async () => {
    const app = buildSubmissionsApp();
    const ip = freshIp();
    const body = {
      name: "Alice",
      email: "alice@example.com",
      subject: "Fraud complaint",
      message: "I was defrauded by a blockchain platform.",
    };

    const allowed = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/submissions")
          .set("x-forwarded-for", ip)
          .send(body),
      ),
    );
    allowed.forEach((r) => expect(r.status).toBe(201));

    const callsBeforeBlock = vi.mocked(storage.createPublicComplaint).mock.calls.length;

    const blocked = await request(app)
      .post("/api/submissions")
      .set("x-forwarded-for", ip)
      .send(body);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    // The blocked request must not have reached storage.
    expect(vi.mocked(storage.createPublicComplaint).mock.calls.length).toBe(callsBeforeBlock);
  });

  it("allows a different IP through after one IP is blocked", async () => {
    const app = buildSubmissionsApp();
    const ipA = freshIp();
    const ipB = freshIp();
    const body = {
      name: "Bob",
      email: "bob@example.com",
      message: "Another complaint.",
    };

    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/submissions")
          .set("x-forwarded-for", ipA)
          .send(body),
      ),
    );
    const callsBeforeBlock = vi.mocked(storage.createPublicComplaint).mock.calls.length;
    const blockedA = await request(app)
      .post("/api/submissions")
      .set("x-forwarded-for", ipA)
      .send(body);
    expect(blockedA.status).toBe(429);
    // The blocked request must not have reached storage.
    expect(vi.mocked(storage.createPublicComplaint).mock.calls.length).toBe(callsBeforeBlock);

    const okB = await request(app)
      .post("/api/submissions")
      .set("x-forwarded-for", ipB)
      .send(body);
    expect(okB.status).toBe(201);
  });

  it("returns 400 for a missing required field", async () => {
    atomicCounters.clear();
    const app = buildSubmissionsApp();
    const res = await request(app)
      .post("/api/submissions")
      .set("x-forwarded-for", freshIp())
      .send({ name: "Mallory" });
    expect(res.status).toBe(400);
  });

  it("calls createPublicComplaint (not createContactSubmission) with the submitted data", async () => {
    atomicCounters.clear();
    vi.mocked(storage.createPublicComplaint).mockClear();

    const app = buildSubmissionsApp();
    const body = {
      name: "Carol",
      email: "carol@example.com",
      subject: "Scam report",
      message: "I lost funds on a fraudulent platform.",
    };

    const res = await request(app)
      .post("/api/submissions")
      .set("x-forwarded-for", freshIp())
      .send(body);

    expect(res.status).toBe(201);

    expect(vi.mocked(storage.createPublicComplaint)).toHaveBeenCalledOnce();
    expect(vi.mocked(storage.createPublicComplaint)).toHaveBeenCalledWith({
      name: "Carol",
      email: "carol@example.com",
      subject: "Scam report",
      description: "I lost funds on a fraudulent platform.",
      status: "new",
      platform: null,
      incidentDate: null,
      amountLost: null,
    });

    // Confirm the old contact_submissions table is not touched.
    // With the Proxy-based mock, accessing any property auto-creates a stub,
    // so we assert the method was never *called* rather than being absent.
    expect((storage as any).createContactSubmission).not.toHaveBeenCalled();
  });

  it("stores platform, incidentDate, and amountLost when all three are provided", async () => {
    atomicCounters.clear();
    vi.mocked(storage.createPublicComplaint).mockClear();

    const app = buildSubmissionsApp();
    const body = {
      name: "Dave",
      email: "dave@example.com",
      subject: "Lost funds",
      message: "My funds were stolen on an exchange.",
      platform: "Binance",
      incidentDate: "2026-01-15",
      amountLost: "12,500 USDT",
    };

    const res = await request(app)
      .post("/api/submissions")
      .set("x-forwarded-for", freshIp())
      .send(body);

    expect(res.status).toBe(201);

    expect(vi.mocked(storage.createPublicComplaint)).toHaveBeenCalledOnce();
    expect(vi.mocked(storage.createPublicComplaint)).toHaveBeenCalledWith({
      name: "Dave",
      email: "dave@example.com",
      subject: "Lost funds",
      description: "My funds were stolen on an exchange.",
      status: "new",
      platform: "Binance",
      incidentDate: "2026-01-15",
      amountLost: "12,500 USDT",
    });
  });

  it("returns 201 and stores nulls when the three new fields are omitted (legacy clients)", async () => {
    atomicCounters.clear();
    vi.mocked(storage.createPublicComplaint).mockClear();

    const app = buildSubmissionsApp();
    const body = {
      name: "Erin",
      email: "erin@example.com",
      message: "A complaint without the new optional fields.",
    };

    const res = await request(app)
      .post("/api/submissions")
      .set("x-forwarded-for", freshIp())
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });

    expect(vi.mocked(storage.createPublicComplaint)).toHaveBeenCalledOnce();
    expect(vi.mocked(storage.createPublicComplaint)).toHaveBeenCalledWith({
      name: "Erin",
      email: "erin@example.com",
      subject: null,
      description: "A complaint without the new optional fields.",
      status: "new",
      platform: null,
      incidentDate: null,
      amountLost: null,
    });
  });

  it("accepts a partial subset of the new fields and nulls the rest", async () => {
    atomicCounters.clear();
    vi.mocked(storage.createPublicComplaint).mockClear();

    const app = buildSubmissionsApp();
    const body = {
      name: "Frank",
      email: "frank@example.com",
      message: "Only platform provided.",
      platform: "Coinbase",
    };

    const res = await request(app)
      .post("/api/submissions")
      .set("x-forwarded-for", freshIp())
      .send(body);

    expect(res.status).toBe(201);
    expect(vi.mocked(storage.createPublicComplaint)).toHaveBeenCalledWith({
      name: "Frank",
      email: "frank@example.com",
      subject: null,
      description: "Only platform provided.",
      status: "new",
      platform: "Coinbase",
      incidentDate: null,
      amountLost: null,
    });
  });

  it("returns 500 with the error message when createPublicComplaint throws", async () => {
    atomicCounters.clear();
    vi.mocked(storage.createPublicComplaint).mockReset();
    vi.mocked(storage.createPublicComplaint).mockRejectedValueOnce(
      new Error("database is down"),
    );

    const app = buildSubmissionsApp();
    const body = {
      name: "Grace",
      email: "grace@example.com",
      subject: "Scam report",
      message: "My complaint should fail to save.",
    };

    const res = await request(app)
      .post("/api/submissions")
      .set("x-forwarded-for", freshIp())
      .send(body);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to submit complaint" });
    expect(vi.mocked(storage.createPublicComplaint)).toHaveBeenCalledOnce();
  });

  it("window duration is exactly 60 000 ms — SMTP-flood snapshot guard", async () => {
    // Rationale: see the offline-messages window test above for full context.
    // POST /api/submissions uses PUBLIC_WRITE_WINDOW_MS via its own
    // persistNamespace, so it can regress independently.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildSubmissionsApp();
      const ip = freshIp();

      await request(app)
        .post("/api/submissions")
        .set("x-forwarded-for", ip)
        .send({
          name: "Window",
          email: "window@example.com",
          subject: "Test",
          message: "Window test message.",
        });

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "submissions rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── vi.mock declarations for access-key-requests tests ───────────────────────
// These are hoisted by vitest before module initialisation, so they apply to
// every module imported in this file.  The db, portal-auth, EmailService, and
// warnOnce mocks have no effect on the existing visitors/submissions/admin
// routers (which use ../storage, not ../db) so the existing suites are not
// impacted.

vi.mock("../db", () => ({
  db: {
    // Minimal fluent Drizzle stub — returns an empty result set for any
    // select().from().where() chain so the route handlers get a 404 or 401
    // (business-logic gate) rather than an unhandled-promise rejection, letting
    // the rate-limiter counters accumulate normally across requests 1–20.
    select: () => ({ from: () => ({ where: async () => [], orderBy: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  },
}));

vi.mock("../services/portal-auth", () => ({
  isAuthorizedForCase: vi.fn(async () => false),
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({ sendEmail: vi.fn(async () => {}) }),
}));

vi.mock("../lib/warnOnce", () => ({
  warnOnce: vi.fn(),
}));

// ── access-key-requests router (imported after all vi.mock declarations) ──────
const { accessKeyRequestsRouter } = await import("../routes/access-key-requests");

function buildAccessKeyRequestsApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/access-key-requests", accessKeyRequestsRouter);
  return app;
}

// keyRequestStatusLimiter cap: 20 req/min per IP.
const KEY_REQUEST_STATUS_RATE_MAX = 20;

describe("access-key-request GET /status/:requestId rate limiting", () => {
  // keyRequestStatusLimiter uses persistNamespace: ACCESS_KEY_STATUS_RATE_LIMIT_NAMESPACE,
  // so it calls storage.atomicIncrementRateLimit on every request.  Each test
  // clears atomicCounters and the mock call history in beforeEach, and uses
  // fresh IPs (via freshIp()) so counter rows never bleed between tests.
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 after 20 rapid GETs to /status/:requestId from the same IP", async () => {
    // 20 parallel supertest requests are lightweight but bump the timeout
    // to 30 s to guard against slow sandbox environments.
    const app = buildAccessKeyRequestsApp();
    const ip = freshIp();

    const allowed = await Promise.all(
      Array.from({ length: KEY_REQUEST_STATUS_RATE_MAX }, () =>
        request(app)
          .get(`/api/access-key-requests/status/REQ-RLTEST-STATUS-${ip}`)
          .set("x-forwarded-for", ip),
      ),
    );
    // Handlers return 404 (no matching row in the mocked DB) or 410 for
    // legacy IDs — anything except 429 is fine for the allowed window.
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    const blocked = await request(app)
      .get(`/api/access-key-requests/status/REQ-RLTEST-STATUS-${ip}`)
      .set("x-forwarded-for", ip);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  }, 30_000);

  it("allows a different IP through after one IP is blocked on /status/:requestId", async () => {
    const app = buildAccessKeyRequestsApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: KEY_REQUEST_STATUS_RATE_MAX }, () =>
        request(app)
          .get(`/api/access-key-requests/status/REQ-RLTEST-STATUS-A-${ipA}`)
          .set("x-forwarded-for", ipA),
      ),
    );

    const blockedA = await request(app)
      .get(`/api/access-key-requests/status/REQ-RLTEST-STATUS-A-${ipA}`)
      .set("x-forwarded-for", ipA);
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .get(`/api/access-key-requests/status/REQ-RLTEST-STATUS-B-${ipB}`)
      .set("x-forwarded-for", ipB);
    expect(okB.status).not.toBe(429);
  }, 30_000);

  it("calls storage.atomicIncrementRateLimit exactly once for a single allowed request — DB-persistence guard", async () => {
    // Core regression guard: if persistNamespace is removed or renamed from
    // keyRequestStatusLimiter, the middleware falls back to in-memory limiting
    // which never calls storage.atomicIncrementRateLimit.  This test would
    // then fail with "Expected 1 call, received 0", catching the regression
    // before it reaches production.
    const app = buildAccessKeyRequestsApp();

    const res = await request(app)
      .get(`/api/access-key-requests/status/REQ-RLTEST-STATUS-GUARD`)
      .set("x-forwarded-for", freshIp());

    expect(res.status).not.toBe(429);
    expect(vi.mocked(storage.atomicIncrementRateLimit)).toHaveBeenCalledTimes(1);
  });
});

describe("access-key-request GET /case/:caseId rate limiting", () => {
  // Same DB-backed limiter (keyRequestStatusLimiter with
  // persistNamespace: ACCESS_KEY_STATUS_RATE_LIMIT_NAMESPACE);
  // atomicCounters are cleared in beforeEach and fresh IPs isolate each test.
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 after 20 rapid GETs to /case/:caseId from the same IP", async () => {
    const app = buildAccessKeyRequestsApp();
    const ip = freshIp();

    const allowed = await Promise.all(
      Array.from({ length: KEY_REQUEST_STATUS_RATE_MAX }, () =>
        request(app)
          .get(`/api/access-key-requests/case/rl-case-akr-${ip}`)
          .set("x-forwarded-for", ip),
      ),
    );
    // isAuthorizedForCase returns false → 401 for all allowed requests.
    // The rate limiter still counted each one via the DB-persistent store.
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    const blocked = await request(app)
      .get(`/api/access-key-requests/case/rl-case-akr-${ip}`)
      .set("x-forwarded-for", ip);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  }, 30_000);

  it("allows a different IP through after one IP is blocked on /case/:caseId", async () => {
    const app = buildAccessKeyRequestsApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: KEY_REQUEST_STATUS_RATE_MAX }, () =>
        request(app)
          .get(`/api/access-key-requests/case/rl-case-akr-a-${ipA}`)
          .set("x-forwarded-for", ipA),
      ),
    );

    const blockedA = await request(app)
      .get(`/api/access-key-requests/case/rl-case-akr-a-${ipA}`)
      .set("x-forwarded-for", ipA);
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .get(`/api/access-key-requests/case/rl-case-akr-b-${ipB}`)
      .set("x-forwarded-for", ipB);
    expect(okB.status).not.toBe(429);
  }, 30_000);

  it("calls storage.atomicIncrementRateLimit exactly once for a single allowed request — DB-persistence guard", async () => {
    // Core regression guard: if persistNamespace is removed or renamed from
    // keyRequestStatusLimiter, the middleware falls back to in-memory limiting
    // which never calls storage.atomicIncrementRateLimit.  This test would
    // then fail with "Expected 1 call, received 0", catching the regression
    // before it reaches production.
    const app = buildAccessKeyRequestsApp();

    const res = await request(app)
      .get(`/api/access-key-requests/case/rl-case-akr-guard`)
      .set("x-forwarded-for", freshIp());

    expect(res.status).not.toBe(429);
    expect(vi.mocked(storage.atomicIncrementRateLimit)).toHaveBeenCalledTimes(1);
  });

  it("window duration is exactly 60 000 ms — abuse-prevention snapshot guard", async () => {
    // Rationale: see the offline-messages window test above for full context.
    // GET /case/:caseId shares keyRequestStatusLimiter with GET /status/:id, so
    // its window is the same ACCESS_KEY_STATUS_RATE_LIMIT_NAMESPACE constant —
    // pinned here too in case the two routes are ever split onto separate
    // limiters with divergent windows.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildAccessKeyRequestsApp();
      const ip = freshIp();

      await request(app)
        .get(`/api/access-key-requests/case/rl-case-akr-window-${ip}`)
        .set("x-forwarded-for", ip);

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "access-key-request case-status rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("admin complaints queue read (GET /api/admin/content/public-complaints)", () => {
  const ADMIN_TOKEN = "admin-test-token";
  const originalAdminUsername = process.env.ADMIN_USERNAME;

  beforeAll(() => {
    // isValidAdminToken cross-checks the session's adminUsername against the
    // currently configured admin identity, so it must match the mocked session.
    process.env.ADMIN_USERNAME = "admin-tester";
  });

  afterAll(() => {
    if (originalAdminUsername === undefined) {
      delete process.env.ADMIN_USERNAME;
    } else {
      process.env.ADMIN_USERNAME = originalAdminUsername;
    }
  });

  it("surfaces platform, incidentDate, and amountLost to the admin queue", async () => {
    vi.mocked(storage.getAllPublicComplaints).mockResolvedValueOnce([
      {
        id: 1,
        name: "Dave",
        email: "dave@example.com",
        subject: "Lost funds",
        description: "My funds were stolen on an exchange.",
        status: "new",
        platform: "Binance",
        incidentDate: "2026-01-15",
        amountLost: "12,500 USDT",
        adminNotes: null,
        createdAt: new Date("2026-01-16T00:00:00.000Z"),
      } as any,
    ]);

    const app = buildAdminContentApp();
    const res = await request(app)
      .get("/api/admin/content/public-complaints")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      platform: "Binance",
      incidentDate: "2026-01-15",
      amountLost: "12,500 USDT",
    });
  });

  it("rejects unauthenticated reads of the complaints queue", async () => {
    const app = buildAdminContentApp();
    const res = await request(app).get(
      "/api/admin/content/public-complaints",
    );
    expect(res.status).toBe(401);
  });
});

// ── keyRequestSubmitLimiter DB-persistence guard ──────────────────────────────
//
// keyRequestSubmitLimiter (applied to POST /api/access-key-requests) uses
// `persistNamespace: ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE` so the 5-req/hr
// per-IP cap holds across all autoscale instances.  Without DB persistence the
// SMTP flood ceiling would scale linearly with instance count.
//
// The tests below assert that storage.atomicIncrementRateLimit IS called for
// every request in the allowed window — confirming the DB-backed path is active.
// If persistNamespace is accidentally removed, the middleware falls back to the
// in-memory path (which never calls atomicIncrementRateLimit), and every
// assertion here fails immediately, surfacing the regression before it ships.

describe("access-key-request POST / rate limiting (DB-persistent: keyRequestSubmitLimiter)", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 on the 6th rapid POST from the same IP", async () => {
    const app = buildAccessKeyRequestsApp();
    const ip = freshIp();
    // Intentionally omit required fields so the handler returns 400 via its
    // early-exit guard — this avoids the Drizzle mock chain's .limit() gap
    // while still exercising the keyRequestSubmitLimiter middleware path.
    const body = {};

    const allowed = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/access-key-requests")
          .set("x-forwarded-for", ip)
          .send(body),
      ),
    );
    // 400 (validation) is expected; any non-429 confirms the window is open.
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    const blocked = await request(app)
      .post("/api/access-key-requests")
      .set("x-forwarded-for", ip)
      .send(body);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("allowed-window cap is exactly 5 — SMTP-flood snapshot guard", async () => {
    // Rationale: each accepted POST / triggers a confirmation email, a DB row,
    // and an admin notification.  The cap of 5 per IP per 60-minute window was
    // deliberately chosen to make mail-bombing impractical while remaining
    // comfortable for legitimate use (see keyRequestSubmitLimiter in
    // server/routes/access-key-requests.ts).
    //
    // This test is a self-contained snapshot: it independently verifies that
    // EXACTLY 5 requests are allowed and the 6th is blocked.  Quietly raising
    // the cap (e.g. to 20) degrades the SMTP flood ceiling without any code
    // review signal — this assertion fails immediately, catching that regression
    // before it ships.  If you intentionally change the cap, update the literal
    // 5 in the assertions AND the comment above in the same commit.
    const app = buildAccessKeyRequestsApp();
    const ip = freshIp();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/access-key-requests")
          .set("x-forwarded-for", ip)
          .send({}),
      ),
    );

    // All 5 requests in the allowed window must be non-429 (400 from validation
    // is fine; any non-429 status confirms the window is still open).
    responses.forEach((r, i) =>
      expect(r.status, `request ${i + 1} of 5 must be inside the allowed window (non-429)`).not.toBe(429),
    );

    // Each of the 5 allowed requests must have incremented the DB counter
    // exactly once (DB-persistent path is active), giving a total of exactly 5.
    const callsAfterAllowed = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ip),
    ).length;
    expect(
      callsAfterAllowed,
      "keyRequestSubmitLimiter cap must be exactly 5 per IP per window — raise this assertion if the cap is intentionally changed",
    ).toBe(5);

    // The 6th request must be blocked — window is exhausted.
    const blocked = await request(app)
      .post("/api/access-key-requests")
      .set("x-forwarded-for", ip)
      .send({});
    expect(blocked.status, "6th request must be rate-limited (429)").toBe(429);
  });

  it("calls storage.atomicIncrementRateLimit on every allowed request — DB-persistence guard", async () => {
    // Core regression guard: atomicIncrementRateLimit must be called for each
    // request in the allowed window (not just the one that triggers 429).
    // In-memory limiters (no persistNamespace) never call this function, so a
    // missing persistNamespace option is caught here before it reaches production.
    const app = buildAccessKeyRequestsApp();
    const ip = freshIp();

    for (let i = 1; i <= 5; i++) {
      const callsBefore = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

      await request(app)
        .post("/api/access-key-requests")
        .set("x-forwarded-for", ip)
        .send({});

      expect(
        vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length,
        `request ${i}: atomicIncrementRateLimit must be called (DB-persistence guard — SMTP flood prevention)`,
      ).toBeGreaterThan(callsBefore);
    }
  });

  it("atomicIncrementRateLimit is also called for the blocked (429) request", async () => {
    // Sustained brute-force must not be able to reset its budget by landing on
    // a fresh instance that hasn't seen the earlier requests.  The DB counter
    // must increment even for blocked requests so the window is truly global.
    const app = buildAccessKeyRequestsApp();
    const ip = freshIp();

    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/access-key-requests")
          .set("x-forwarded-for", ip)
          .send({}),
      ),
    );

    const callsBeforeBlock = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    const blocked = await request(app)
      .post("/api/access-key-requests")
      .set("x-forwarded-for", ip)
      .send({});

    expect(blocked.status).toBe(429);
    // Exactly one additional DB increment on the blocked request.
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(
      callsBeforeBlock + 1,
    );
  });

  it("uses a key containing the canonical namespace — stable across restarts", async () => {
    // An auto-generated namespace (no persistNamespace) changes on every boot,
    // making stored rows unmatchable after a restart.  The key must contain the
    // canonical ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE string so rows survive
    // server restarts and cross-instance routing.
    const app = buildAccessKeyRequestsApp();
    const ip = freshIp();

    await request(app)
      .post("/api/access-key-requests")
      .set("x-forwarded-for", ip)
      .send({});

    const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // Key format: "<namespace>:<IP>:<routeKey>" (see security.ts).
    // "access_key_submit" is ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE.
    expect(calls[0][0].key).toContain("access_key_submit");
  });

  it("allows a different IP through after one IP is blocked", async () => {
    const app = buildAccessKeyRequestsApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/access-key-requests")
          .set("x-forwarded-for", ipA)
          .send({}),
      ),
    );

    const blockedA = await request(app)
      .post("/api/access-key-requests")
      .set("x-forwarded-for", ipA)
      .send({});
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .post("/api/access-key-requests")
      .set("x-forwarded-for", ipB)
      .send({});
    expect(okB.status).not.toBe(429);
    // ipB's allowed request must have gone through the DB-persistent path too.
    const callsForB = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ipB),
    );
    expect(callsForB.length).toBeGreaterThan(0);
  });

  it("window duration is exactly 3 600 000 ms (1 hour) — SMTP-flood snapshot guard", async () => {
    // Rationale: each accepted POST / triggers a confirmation email, a DB row,
    // and an admin notification (see keyRequestSubmitLimiter in
    // server/routes/access-key-requests.ts). The 1-hour window combines with
    // the 5-request cap to bound worst-case mail-bombing throughput; quietly
    // shortening the window multiplies the effective per-IP send rate the
    // same way raising the cap would, without any code-review signal. If you
    // intentionally change the window, update the literal 3_600_000 here.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildAccessKeyRequestsApp();
      const ip = freshIp();

      await request(app)
        .post("/api/access-key-requests")
        .set("x-forwarded-for", ip)
        .send({});

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "access-key-request submit window must be exactly 3 600 000 ms (1 hour) — raise this assertion if the window is intentionally changed",
      ).toBe(3_600_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("visitor end-session rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 200 on each of the first 5 POSTs to /end-session from the same IP", async () => {
    const app = buildApp();
    const ip = freshIp();

    const allowed = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/visitors/end-session")
          .set("x-forwarded-for", ip)
          .send({ visitorId: `vis-es-${ip}` }),
      ),
    );
    allowed.forEach((r) => expect(r.status).not.toBe(429));
  });

  it("returns 429 after 5 rapid POSTs to /end-session from the same IP", async () => {
    const app = buildApp();
    const ip = freshIp();

    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/visitors/end-session")
          .set("x-forwarded-for", ip)
          .send({ visitorId: `vis-es-${ip}` }),
      ),
    );

    const callsBeforeBlock = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    const blocked = await request(app)
      .post("/api/visitors/end-session")
      .set("x-forwarded-for", ip)
      .send({ visitorId: `vis-es-${ip}` });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    // Exactly one additional DB increment (the rate-limiter counter); the handler
    // body does not run on blocked requests.
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(
      callsBeforeBlock + 1,
    );
  });

  it("allows a different IP through after one IP is blocked on /end-session", async () => {
    const app = buildApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/visitors/end-session")
          .set("x-forwarded-for", ipA)
          .send({ visitorId: `vis-es-a-${ipA}` }),
      ),
    );
    const blockedA = await request(app)
      .post("/api/visitors/end-session")
      .set("x-forwarded-for", ipA)
      .send({ visitorId: `vis-es-a-${ipA}` });
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .post("/api/visitors/end-session")
      .set("x-forwarded-for", ipB)
      .send({ visitorId: `vis-es-b-${ipB}` });
    expect(okB.status).not.toBe(429);
  });

  it("calls storage.atomicIncrementRateLimit exactly once for a single allowed request — DB-persistence guard", async () => {
    // Core regression guard: if persistNamespace is removed or renamed from the
    // end-session limiter, the middleware falls back to in-memory limiting which
    // never calls storage.atomicIncrementRateLimit.  This test would then fail
    // with "Expected 1 call, received 0", catching the regression before it
    // reaches production.
    const app = buildApp();

    const res = await request(app)
      .post("/api/visitors/end-session")
      .set("x-forwarded-for", freshIp())
      .send({ visitorId: "vis-es-guard" });

    expect(res.status).not.toBe(429);
    expect(vi.mocked(storage.atomicIncrementRateLimit)).toHaveBeenCalledTimes(1);
  });

  it("key contains the canonical visitor_end_session namespace — stable across restarts", async () => {
    // An auto-generated namespace (no persistNamespace) changes on every boot,
    // making stored rows unmatchable after a restart.  The key must contain the
    // canonical VISITOR_END_SESSION_RATE_LIMIT_NAMESPACE string so rows survive
    // server restarts and cross-instance routing.
    const app = buildApp();
    const ip = freshIp();

    await request(app)
      .post("/api/visitors/end-session")
      .set("x-forwarded-for", ip)
      .send({ visitorId: `vis-es-ns-${ip}` });

    const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0].key).toContain("visitor_end_session");
  });

  it("window duration is exactly 60 000 ms — abuse-prevention snapshot guard", async () => {
    // Rationale: see the offline-messages window test above for full context.
    // VISITOR_END_SESSION uses the same PUBLIC_WRITE_WINDOW_MS constant but is
    // a distinct persistNamespace, so it can regress independently.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildApp();
      const ip = freshIp();

      await request(app)
        .post("/api/visitors/end-session")
        .set("x-forwarded-for", ip)
        .send({ visitorId: `vis-es-window-${ip}` });

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "end-session rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("visitor GET agent-status rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns a well-formed response with isOnline and status fields when under the rate limit", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/visitors/agent-status")
      .set("x-forwarded-for", freshIp());

    expect(res.status).toBe(200);
    expect(typeof res.body.isOnline).toBe("boolean");
    expect(typeof res.body.status).toBe("string");
    expect(res.body.status.length).toBeGreaterThan(0);
  });

  it("calls storage.atomicIncrementRateLimit exactly once for a single allowed GET — DB-persistence guard", async () => {
    // Core regression guard: if the rateLimiter() middleware is removed from
    // the /agent-status handler (or VISITOR_AGENT_STATUS_RATE_LIMIT_NAMESPACE
    // is renamed/deleted so the persistNamespace option drops), the middleware
    // falls back to the in-memory path which never calls
    // storage.atomicIncrementRateLimit.  This test would then fail with
    // "Expected 1 call, received 0", surfacing the regression before it ships.
    const app = buildApp();
    const res = await request(app)
      .get("/api/visitors/agent-status")
      .set("x-forwarded-for", freshIp());

    expect(res.status).toBe(200);
    expect(vi.mocked(storage.atomicIncrementRateLimit)).toHaveBeenCalledTimes(1);
  });

  it("returns 429 after 60 rapid GETs to /agent-status from the same IP", async () => {
    // 60 parallel supertest requests; timeout raised to 30 s on slow CI runs.
    const app = buildApp();
    const ip = freshIp();

    const allowed = await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app)
          .get("/api/visitors/agent-status")
          .set("x-forwarded-for", ip),
      ),
    );
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    // Snapshot counter after the allowed burst. The next (61st) request is
    // intercepted by the rate limiter before the handler runs, adding exactly
    // one more atomicIncrementRateLimit call with no storage side-effects
    // from the handler body itself.
    const callsBeforeBlock = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    const blocked = await request(app)
      .get("/api/visitors/agent-status")
      .set("x-forwarded-for", ip);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(
      callsBeforeBlock + 1,
    );
  }, 30_000);

  it("allows a different IP through after one IP is blocked on GET /agent-status", async () => {
    // Two batches of requests; timeout raised to 30 s.
    const app = buildApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app)
          .get("/api/visitors/agent-status")
          .set("x-forwarded-for", ipA),
      ),
    );
    const callsBeforeBlock = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    const blockedA = await request(app)
      .get("/api/visitors/agent-status")
      .set("x-forwarded-for", ipA);
    expect(blockedA.status).toBe(429);
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(
      callsBeforeBlock + 1,
    );

    const okB = await request(app)
      .get("/api/visitors/agent-status")
      .set("x-forwarded-for", ipB);
    expect(okB.status).not.toBe(429);
  }, 30_000);

  it("window duration is exactly 60 000 ms — abuse-prevention snapshot guard", async () => {
    // Rationale: see the offline-messages window test above for full context.
    // VISITOR_AGENT_STATUS uses the same PUBLIC_WRITE_WINDOW_MS constant but is
    // a distinct persistNamespace, so it can regress independently.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildApp();
      const ip = freshIp();

      await request(app)
        .get("/api/visitors/agent-status")
        .set("x-forwarded-for", ip);

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "agent-status rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
