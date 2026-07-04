import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// aiChatLimiter DB-persistence cap guard
//
// aiChatLimiter (applied to POST /api/ai/chat) uses
// `persistNamespace: AI_CHAT_RATE_LIMIT_NAMESPACE` so the 5-req/min
// per-IP cap holds across all autoscale instances. Without DB persistence the
// per-instance budget would scale linearly with instance count, multiplying
// the effective OpenAI spend ceiling by the number of live processes.
//
// The test below asserts that EXACTLY 5 requests are allowed and the 6th is
// blocked. Quietly raising the cap degrades the OpenAI spend ceiling without
// any code-review signal — this assertion fails immediately, catching that
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

// Mock the AI chatbot service so tests don't need a real OpenAI key.
vi.mock("../services/ai-chatbot", () => ({
  generateChatResponse: vi.fn(async () => "mock-response"),
  generateSmartReplySuggestions: vi.fn(async () => ["s1", "s2", "s3"]),
  classifyMessageIntent: vi.fn(async () => ({
    intent: "general_question",
    urgency: "low",
    sentiment: "neutral",
  })),
  analyzeCaseWithAI: vi.fn(async () => ({})),
  generateCaseInsights: vi.fn(async () => ({})),
  generateAutoResponse: vi.fn(async () => "auto"),
}));

// Mock admin auth guard used by ai.ts (imported via "./middleware").
vi.mock("../routes/middleware", () => ({
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
}));

const { aiRouter } = await import("../routes/ai");
const { storage } = await import("../storage");

let nextIp = 1;
function freshIp(): string {
  return `10.77.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`;
}

function buildApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/ai", aiRouter);
  return app;
}

describe("POST /api/ai/chat rate limiting (DB-persistent: aiChatLimiter)", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 on the 6th rapid POST from the same IP", async () => {
    const app = buildApp();
    const ip = freshIp();
    const body = { message: "hello" };

    const allowed = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/ai/chat")
          .set("x-forwarded-for", ip)
          .send(body),
      ),
    );
    // Any non-429 status confirms the window is still open.
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    const blocked = await request(app)
      .post("/api/ai/chat")
      .set("x-forwarded-for", ip)
      .send(body);

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("allowed-window cap is exactly 5 — OpenAI spend snapshot guard", async () => {
    // Rationale: each accepted POST /api/ai/chat calls a paid OpenAI endpoint.
    // The cap of 5 per IP per 60-second window was deliberately chosen to make
    // automated abuse impractical while remaining comfortable for genuine users
    // (see aiChatLimiter in server/routes/ai.ts). Persisted to the DB so an
    // attacker cannot bypass it by spraying requests across autoscale instances.
    //
    // This test is a self-contained snapshot: it independently verifies that
    // EXACTLY 5 requests are allowed and the 6th is blocked. Quietly raising
    // the cap (e.g. to 20) increases worst-case OpenAI spend without any
    // code-review signal — this assertion fails immediately, catching that
    // regression before it ships. If you intentionally change the cap, update
    // the literal 5 in the assertions AND the comment above in the same commit.
    const app = buildApp();
    const ip = freshIp();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/ai/chat")
          .set("x-forwarded-for", ip)
          .send({ message: "cap-test" }),
      ),
    );

    // All 5 requests in the allowed window must be non-429.
    responses.forEach((r, i) =>
      expect(r.status, `ai/chat request ${i + 1} of 5 must be inside the allowed window (non-429)`).not.toBe(429),
    );

    // Each of the 5 allowed requests must have incremented the DB counter
    // exactly once (DB-persistent path is active). Filter by IP so the global
    // hourly-budget counter (keyed "ai_chat_global_budget:global:hourly") is
    // excluded from this per-IP cap assertion.
    const callsAfterAllowed = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ip),
    ).length;
    expect(
      callsAfterAllowed,
      "aiChatLimiter cap must be exactly 5 per IP per window — raise this assertion if the cap is intentionally changed",
    ).toBe(5);

    // The 6th request must be blocked — window is exhausted.
    const blocked = await request(app)
      .post("/api/ai/chat")
      .set("x-forwarded-for", ip)
      .send({ message: "cap-test" });
    expect(blocked.status, "6th ai/chat request must be rate-limited (429)").toBe(429);
  });

  it("calls storage.atomicIncrementRateLimit on every allowed request — DB-persistence guard", async () => {
    // Core regression guard: atomicIncrementRateLimit must be called for each
    // request in the allowed window (not just the one that triggers 429).
    // In-memory limiters (no persistNamespace) never call this function, so a
    // missing persistNamespace option is caught here before it reaches production.
    const app = buildApp();
    const ip = freshIp();

    for (let i = 1; i <= 5; i++) {
      const callsBefore = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
        (c) => c[0].key.includes(ip),
      ).length;

      await request(app)
        .post("/api/ai/chat")
        .set("x-forwarded-for", ip)
        .send({ message: "ping" });

      const callsAfter = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
        (c) => c[0].key.includes(ip),
      ).length;

      expect(
        callsAfter,
        `request ${i}: aiChatLimiter must call atomicIncrementRateLimit (DB-persistence guard — OpenAI spend prevention)`,
      ).toBeGreaterThan(callsBefore);
    }
  });

  it("uses a key containing the canonical namespace — stable across restarts", async () => {
    // An auto-generated namespace (no persistNamespace) changes on every boot,
    // making stored rows unmatchable after a restart. The key must contain the
    // canonical AI_CHAT_RATE_LIMIT_NAMESPACE string so rows survive server
    // restarts and cross-instance routing.
    const app = buildApp();
    const ip = freshIp();

    await request(app)
      .post("/api/ai/chat")
      .set("x-forwarded-for", ip)
      .send({ message: "ns-test" });

    const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ip),
    );
    expect(calls.length).toBeGreaterThan(0);
    // Key format: "<namespace>:<IP>:<routeKey>" (see security.ts).
    // "ai_chat" is AI_CHAT_RATE_LIMIT_NAMESPACE.
    expect(calls[0][0].key).toContain("ai_chat");
  });

  it("window duration is exactly 60 000 ms — OpenAI spend snapshot guard", async () => {
    // Rationale: aiChatLimiter's window (60 * 1000 ms, see server/routes/ai.ts)
    // combines with the 5-request cap to bound worst-case OpenAI spend per IP.
    // Quietly shortening the window (e.g. to 10s) multiplies the effective
    // per-IP throughput the same way raising the cap would, without any
    // code-review signal — this assertion fails immediately, catching that
    // regression before it ships. If you intentionally change the window,
    // update the literal 60_000 in this assertion in the same commit.
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
        .post("/api/ai/chat")
        .set("x-forwarded-for", ip)
        .send({ message: "window-test" });

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
        (c) => c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);

      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "aiChatLimiter window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows a different IP through after one IP is blocked", async () => {
    const app = buildApp();
    const ipA = freshIp();
    const ipB = freshIp();

    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/ai/chat")
          .set("x-forwarded-for", ipA)
          .send({ message: "flood" }),
      ),
    );

    const blockedA = await request(app)
      .post("/api/ai/chat")
      .set("x-forwarded-for", ipA)
      .send({ message: "flood" });
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .post("/api/ai/chat")
      .set("x-forwarded-for", ipB)
      .send({ message: "legit" });
    expect(okB.status).not.toBe(429);

    // ipB's allowed request must have gone through the DB-persistent path.
    const callsForB = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ipB),
    );
    expect(callsForB.length).toBeGreaterThan(0);
  });
});

describe("POST /api/ai/chat global hourly budget window (DB-persistent: consumeGlobalAiChatBudget)", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("window duration is exactly 3 600 000 ms (1 hour) — call-site snapshot guard against a quietly shortened window", async () => {
    // Rationale: AI_CHAT_HOURLY_WINDOW_MS gates the global circuit breaker
    // in server/routes/ai.ts (consumeGlobalAiChatBudget), which bounds
    // worst-case OpenAI spend across ALL IPs combined. A separate test
    // (aiChat.test.ts) already snapshots the exported constant, but the
    // constant alone doesn't prove the call site actually uses it — someone
    // could pass `new Date(now + AI_CHAT_HOURLY_WINDOW_MS / 2)` to
    // atomicIncrementRateLimit while leaving the constant untouched, halving
    // the effective window (doubling worst-case spend) without failing the
    // constant-only test. This test asserts the actual `windowResetAt` value
    // passed at the call site, under frozen time, for exact equality. If you
    // intentionally change the window, update the literal 3_600_000 here (and
    // the AI_CHAT_HOURLY_WINDOW_MS assertion in aiChat.test.ts) in the same
    // commit.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildApp();
      const ip = freshIp();

      await request(app)
        .post("/api/ai/chat")
        .set("x-forwarded-for", ip)
        .send({ message: "hello" });

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes("ai_chat_global_budget"),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "AI chat global hourly budget window must be exactly 3 600 000 ms (1 hour) — raise this assertion if the window is intentionally changed",
      ).toBe(3_600_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
