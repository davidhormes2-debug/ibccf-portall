import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../storage";

// Hoist the factory helper and atomic counters map so they are available
// inside vi.mock (which vitest hoists before module initialisation).
const { createStorageMock, atomicCounters } = await vi.hoisted(async () => {
  const { createStorageMock } = await import("./helpers/storageMock");
  const atomicCounters = new Map<string, number>();
  return { createStorageMock, atomicCounters };
});

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getActiveScamAlerts: vi.fn(async () => []),
    getActiveFaqItems: vi.fn(async () => []),
    getApprovedTestimonials: vi.fn(async () => []),
    getSiteStatistics: vi.fn(async () => []),
    getAppSetting: vi.fn(async () => null),
    getAdminSessionByToken: vi.fn(async () => null),
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

// community.ts imports db directly (not via storage) and uses portal-auth /
// middleware — stub them so the router module can be imported cleanly.
// The chain builder below produces a thenable stub that supports any Drizzle
// query chain (select/from/where/orderBy/limit/offset/returning) and always
// resolves to an empty array, covering every read path in community.ts.
function makeChain(): any {
  const emptyResult: any[] = [];
  // A Proxy-based thenable: any property access returns another chain node,
  // any call returns another chain node, and awaiting it yields an empty array.
  function node(): any {
    return new Proxy(
      Object.assign(() => node(), {
        then(resolve: (v: any[]) => any, reject?: (e: any) => any) {
          return Promise.resolve(emptyResult).then(resolve, reject);
        },
      }),
      {
        get(target: any, prop: string | symbol) {
          if (prop === "then" || prop === "catch" || prop === "finally") {
            return target[prop].bind(target);
          }
          return () => node();
        },
        apply(_target: any, _this: any, _args: any[]) {
          return node();
        },
      },
    );
  }
  return node();
}

vi.mock("../db", () => ({
  db: {
    select: () => makeChain(),
    insert: () => makeChain(),
    update: () => makeChain(),
    delete: () => makeChain(),
  },
}));

vi.mock("../services/portal-auth", () => ({
  validatePortalSession: vi.fn(async () => null),
}));

vi.mock("../routes/middleware", () => ({
  isValidAdminToken: vi.fn(async () => false),
  checkAdminAuth: (_req: any, res: any, _next: any) => res.status(401).json({ error: "Unauthorized" }),
}));

vi.mock("../lib/warnOnce", () => ({ warnOnce: vi.fn() }));
vi.mock("../services/bot-response-generator", () => ({
  scheduleResponsesForThread: vi.fn(async () => {}),
}));
vi.mock("../services/communityModeration", () => ({
  checkContent: vi.fn(async () => ({ flagged: false })),
}));
vi.mock("../static", () => ({
  getBuildStamp: () => "test-stamp",
  getBootTimeIso: () => new Date().toISOString(),
}));

const { publicRouter } = await import("../routes/public");
const { communityRouter } = await import("../routes/community");

let nextIp = 1;
function freshIp(): string {
  return `10.77.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`;
}

function buildPublicApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/public", publicRouter);
  return app;
}

function buildCommunityApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/community", communityRouter);
  return app;
}

// ── public.ts GET rate limiting ──────────────────────────────────────────────

describe("public GET /build-info rate limiting (DB-persistent, public_get namespace)", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 200 with buildStamp and bootTime when under the rate limit", async () => {
    const app = buildPublicApp();
    const res = await request(app)
      .get("/api/public/build-info")
      .set("x-forwarded-for", freshIp());

    expect(res.status).toBe(200);
    expect(typeof res.body.buildStamp).toBe("string");
    expect(typeof res.body.bootTime).toBe("string");
  });

  it("calls atomicIncrementRateLimit on each request — DB-persistence guard", async () => {
    const app = buildPublicApp();
    const callsBefore = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    await request(app)
      .get("/api/public/build-info")
      .set("x-forwarded-for", freshIp());

    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(callsBefore + 1);
  });

  it("key contains the canonical public_get namespace — stable across restarts", async () => {
    const app = buildPublicApp();
    const ip = freshIp();

    await request(app)
      .get("/api/public/build-info")
      .set("x-forwarded-for", ip);

    const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0].key).toContain("public_get");
  });

  it("returns 429 after 60 rapid GETs from the same IP", async () => {
    const app = buildPublicApp();
    const ip = freshIp();

    const allowed = await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app).get("/api/public/build-info").set("x-forwarded-for", ip),
      ),
    );
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    const callsBeforeBlock = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    const blocked = await request(app)
      .get("/api/public/build-info")
      .set("x-forwarded-for", ip);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(
      callsBeforeBlock + 1,
    );
  }, 30_000);

  it("allows a different IP through after one IP is blocked", async () => {
    const app = buildPublicApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app).get("/api/public/build-info").set("x-forwarded-for", ipA),
      ),
    );

    const blockedA = await request(app)
      .get("/api/public/build-info")
      .set("x-forwarded-for", ipA);
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .get("/api/public/build-info")
      .set("x-forwarded-for", ipB);
    expect(okB.status).not.toBe(429);
  }, 30_000);

  it("window duration is exactly 60 000 ms — snapshot guard against a quietly shortened window", async () => {
    // Rationale: PUBLIC_GET_RATE_LIMIT_NAMESPACE's window (see server/routes/public.ts)
    // combines with the 60-request cap to bound worst-case scraping/DoS throughput
    // for every public GET route sharing this namespace. Quietly shortening the
    // window multiplies the effective per-IP request rate the same way raising the
    // cap would, without any code-review signal. Time is frozen so `windowResetAt`
    // can be asserted for EXACT equality — a wall-clock envelope would let a
    // shortened window slip through. If you intentionally change the window, update
    // the literal 60_000 in this assertion in the same commit.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildPublicApp();
      const ip = freshIp();

      await request(app)
        .get("/api/public/build-info")
        .set("x-forwarded-for", ip);

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "public_get rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("public GET /scam-alerts rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 200 under the rate limit", async () => {
    const app = buildPublicApp();
    const res = await request(app)
      .get("/api/public/scam-alerts")
      .set("x-forwarded-for", freshIp());
    expect(res.status).toBe(200);
  });

  it("calls atomicIncrementRateLimit — DB-persistence guard", async () => {
    const app = buildPublicApp();
    const callsBefore = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;
    await request(app)
      .get("/api/public/scam-alerts")
      .set("x-forwarded-for", freshIp());
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(callsBefore + 1);
  });

  it("returns 429 after 60 rapid GETs from the same IP", async () => {
    const app = buildPublicApp();
    const ip = freshIp();

    const allowed = await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app).get("/api/public/scam-alerts").set("x-forwarded-for", ip),
      ),
    );
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    const blocked = await request(app)
      .get("/api/public/scam-alerts")
      .set("x-forwarded-for", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  }, 30_000);

  it("allows a different IP through after one IP is blocked", async () => {
    const app = buildPublicApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app).get("/api/public/scam-alerts").set("x-forwarded-for", ipA),
      ),
    );
    const blockedA = await request(app)
      .get("/api/public/scam-alerts")
      .set("x-forwarded-for", ipA);
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .get("/api/public/scam-alerts")
      .set("x-forwarded-for", ipB);
    expect(okB.status).not.toBe(429);
  }, 30_000);
});

describe("public GET /faq rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 200 under the rate limit", async () => {
    const app = buildPublicApp();
    const res = await request(app)
      .get("/api/public/faq")
      .set("x-forwarded-for", freshIp());
    expect(res.status).toBe(200);
  });

  it("calls atomicIncrementRateLimit — DB-persistence guard", async () => {
    const app = buildPublicApp();
    const callsBefore = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;
    await request(app)
      .get("/api/public/faq")
      .set("x-forwarded-for", freshIp());
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(callsBefore + 1);
  });

  it("returns 429 after 60 rapid GETs from the same IP", async () => {
    const app = buildPublicApp();
    const ip = freshIp();

    await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app).get("/api/public/faq").set("x-forwarded-for", ip),
      ),
    );
    const blocked = await request(app)
      .get("/api/public/faq")
      .set("x-forwarded-for", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  }, 30_000);
});

describe("public GET /portal-refresh-mode rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 200 under the rate limit", async () => {
    const app = buildPublicApp();
    const res = await request(app)
      .get("/api/public/portal-refresh-mode")
      .set("x-forwarded-for", freshIp());
    expect(res.status).toBe(200);
    expect(typeof res.body.enabled).toBe("boolean");
  });

  it("calls atomicIncrementRateLimit — DB-persistence guard", async () => {
    const app = buildPublicApp();
    const callsBefore = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;
    await request(app)
      .get("/api/public/portal-refresh-mode")
      .set("x-forwarded-for", freshIp());
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(callsBefore + 1);
  });

  it("returns 429 after 60 rapid GETs from the same IP", async () => {
    const app = buildPublicApp();
    const ip = freshIp();

    await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app).get("/api/public/portal-refresh-mode").set("x-forwarded-for", ip),
      ),
    );
    const blocked = await request(app)
      .get("/api/public/portal-refresh-mode")
      .set("x-forwarded-for", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  }, 30_000);
});

// ── community.ts GET rate limiting ───────────────────────────────────────────

describe("community GET /threads rate limiting (DB-persistent, community_get namespace)", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 200 under the rate limit", async () => {
    const app = buildCommunityApp();
    const res = await request(app)
      .get("/api/community/threads")
      .set("x-forwarded-for", freshIp());
    expect(res.status).toBe(200);
  });

  it("calls atomicIncrementRateLimit on each request — DB-persistence guard", async () => {
    const app = buildCommunityApp();
    const callsBefore = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    await request(app)
      .get("/api/community/threads")
      .set("x-forwarded-for", freshIp());

    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(callsBefore + 1);
  });

  it("key contains the canonical community_get namespace — stable across restarts", async () => {
    const app = buildCommunityApp();
    const ip = freshIp();

    await request(app)
      .get("/api/community/threads")
      .set("x-forwarded-for", ip);

    const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0].key).toContain("community_get");
  });

  it("returns 429 after 60 rapid GETs from the same IP", async () => {
    const app = buildCommunityApp();
    const ip = freshIp();

    const allowed = await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app).get("/api/community/threads").set("x-forwarded-for", ip),
      ),
    );
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    const callsBeforeBlock = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;

    const blocked = await request(app)
      .get("/api/community/threads")
      .set("x-forwarded-for", ip);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(
      callsBeforeBlock + 1,
    );
  }, 30_000);

  it("allows a different IP through after one IP is blocked", async () => {
    const app = buildCommunityApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app).get("/api/community/threads").set("x-forwarded-for", ipA),
      ),
    );

    const blockedA = await request(app)
      .get("/api/community/threads")
      .set("x-forwarded-for", ipA);
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .get("/api/community/threads")
      .set("x-forwarded-for", ipB);
    expect(okB.status).not.toBe(429);
  }, 30_000);

  it("window duration is exactly 60 000 ms — snapshot guard against a quietly shortened window", async () => {
    // Rationale: COMMUNITY_GET_RATE_LIMIT_NAMESPACE's window (see
    // server/routes/community.ts) combines with the 60-request cap to bound
    // worst-case scraping/DoS throughput for every community GET route sharing
    // this namespace. See the public_get window test above for full rationale
    // on why exact-equality with frozen time is required. If you intentionally
    // change the window, update the literal 60_000 in this assertion in the
    // same commit.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildCommunityApp();
      const ip = freshIp();

      await request(app)
        .get("/api/community/threads")
        .set("x-forwarded-for", ip);

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "community_get rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("community GET /stats rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("calls atomicIncrementRateLimit — DB-persistence guard", async () => {
    const app = buildCommunityApp();
    const callsBefore = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;
    await request(app)
      .get("/api/community/stats")
      .set("x-forwarded-for", freshIp());
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(callsBefore + 1);
  });

  it("returns 429 after 60 rapid GETs from the same IP", async () => {
    const app = buildCommunityApp();
    const ip = freshIp();

    await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app).get("/api/community/stats").set("x-forwarded-for", ip),
      ),
    );
    const blocked = await request(app)
      .get("/api/community/stats")
      .set("x-forwarded-for", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  }, 30_000);
});

describe("community GET /recent rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("calls atomicIncrementRateLimit — DB-persistence guard", async () => {
    const app = buildCommunityApp();
    const callsBefore = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length;
    await request(app)
      .get("/api/community/recent")
      .set("x-forwarded-for", freshIp());
    expect(vi.mocked(storage.atomicIncrementRateLimit).mock.calls.length).toBe(callsBefore + 1);
  });

  it("returns 429 after 60 rapid GETs from the same IP", async () => {
    const app = buildCommunityApp();
    const ip = freshIp();

    await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app).get("/api/community/recent").set("x-forwarded-for", ip),
      ),
    );
    const blocked = await request(app)
      .get("/api/community/recent")
      .set("x-forwarded-for", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  }, 30_000);
});

describe("community POST /threads rate limiting (DB-persistent, community_post namespace)", () => {
  // The community POST routes authenticate inline inside the handler body
  // (admin bearer token or portal session token), so an unauthenticated
  // request still reaches — and is counted by — communityPostLimiter before
  // the handler rejects it with 401. That lets this window test fire a bare
  // POST with no auth and still observe the rate-limiter's windowResetAt.
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("window duration is exactly 60 000 ms — snapshot guard against a quietly shortened window", async () => {
    // Rationale: COMMUNITY_POST_RATE_LIMIT_NAMESPACE's window (see
    // server/routes/community.ts) combines with the 30-request cap to bound
    // worst-case spam/AI-job-fanout throughput for /threads, /threads/:id/posts,
    // /posts/:id/react, and /participants. See the public_get window test above
    // for full rationale on why exact-equality with frozen time is required.
    // If you intentionally change the window, update the literal 60_000 in
    // this assertion in the same commit.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildCommunityApp();
      const ip = freshIp();

      await request(app)
        .post("/api/community/threads")
        .set("x-forwarded-for", ip)
        .send({});

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "community_post rate-limit window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cross-route IP isolation: public_get namespace", () => {
  // Verifies that hitting the 60/min cap on /scam-alerts does NOT block
  // the same IP on /testimonials — counter isolation is per (namespace, IP, routePath).
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("blocking /scam-alerts does not spill over to /testimonials for the same IP", async () => {
    const app = buildPublicApp();
    const ip = freshIp();

    await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app).get("/api/public/scam-alerts").set("x-forwarded-for", ip),
      ),
    );
    const blockedAlerts = await request(app)
      .get("/api/public/scam-alerts")
      .set("x-forwarded-for", ip);
    expect(blockedAlerts.status).toBe(429);

    const okTestimonials = await request(app)
      .get("/api/public/testimonials")
      .set("x-forwarded-for", ip);
    expect(okTestimonials.status).not.toBe(429);
  }, 30_000);
});
