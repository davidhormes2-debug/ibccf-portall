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
// resolves to an empty array by default, but individual insert/select shapes
// used by the community routes are overridden below via a mutable table map.
function makeChain(resolveWith: any[] = []): any {
  function node(): any {
    return new Proxy(
      Object.assign(() => node(), {
        then(resolve: (v: any[]) => any, reject?: (e: any) => any) {
          return Promise.resolve(resolveWith).then(resolve, reject);
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

// A single fake thread/post row is enough for the routes under test to
// proceed past their existence checks and reach the rate limiter — the
// realistic-burst scenario cares about limiter behavior, not full DB fidelity.
const FAKE_THREAD = { id: 1, isLocked: false, isFlagged: false, replyCount: 0, departmentId: 1 };
const FAKE_PARTICIPANT = { id: 1, anonymousHandle: "TestUser1", isBanned: false };

vi.mock("../db", () => ({
  db: {
    select: () => makeChain([FAKE_THREAD]),
    insert: () => makeChain([{ ...FAKE_THREAD, id: 1 }]),
    update: () => makeChain([]),
    delete: () => makeChain([]),
  },
}));

vi.mock("../services/portal-auth", () => ({
  validatePortalSession: vi.fn(async () => ({
    caseId: 1,
    anonymousHandle: FAKE_PARTICIPANT.anonymousHandle,
  })),
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

const { communityRouter } = await import("../routes/community");

let nextIp = 1;
function freshIp(): string {
  return `10.88.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`;
}

function buildCommunityApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/community", communityRouter);
  return app;
}

// ── Realistic single-session burst ───────────────────────────────────────────
//
// Models one engaged user in an active discussion: they create a thread, then
// fire off a rapid string of replies (e.g. rebutting several other posters in
// quick succession) and a couple of reactions, all from the same IP/session
// within a few seconds. This must stay comfortably under the 30/min cap so
// legitimate participation is never throttled.
describe("community POST rate limit — realistic active-discussion burst stays under the cap", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("1 thread + 15 rapid replies + 4 reactions (20 total) from one IP all succeed", async () => {
    const app = buildCommunityApp();
    const ip = freshIp();
    const sessionToken = "fake-session-token";

    const threadRes = await request(app)
      .post("/api/community/threads")
      .set("x-forwarded-for", ip)
      .set("x-portal-session-token", sessionToken)
      .send({ departmentId: 1, title: "Has anyone else seen this scam pattern?", content: "Sharing details here." });
    expect(threadRes.status, `thread creation should not be rate-limited: ${JSON.stringify(threadRes.body)}`).not.toBe(429);

    const replyResponses = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        request(app)
          .post("/api/community/threads/1/posts")
          .set("x-forwarded-for", ip)
          .set("x-portal-session-token", sessionToken)
          .send({ content: `Reply number ${i + 1} with more context.` }),
      ),
    );
    replyResponses.forEach((r, i) => {
      expect(r.status, `reply ${i + 1} should not be rate-limited: ${JSON.stringify(r.body)}`).not.toBe(429);
    });

    const reactionResponses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post("/api/community/posts/1/react")
          .set("x-forwarded-for", ip)
          .set("x-portal-session-token", sessionToken)
          .send({ reactionType: "like" }),
      ),
    );
    reactionResponses.forEach((r, i) => {
      expect(r.status, `reaction ${i + 1} should not be rate-limited: ${JSON.stringify(r.body)}`).not.toBe(429);
    });

    // 1 thread + 15 replies + 4 reactions = 20 requests, comfortably under 30.
    const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
      c[0].key.includes(ip) && c[0].key.includes("community_post"),
    );
    expect(calls.length).toBe(20);
  });

  it("a genuine flood beyond 30/min from one IP still gets throttled with a Retry-After hint", async () => {
    const app = buildCommunityApp();
    const ip = freshIp();
    const sessionToken = "fake-session-token";

    const responses = await Promise.all(
      Array.from({ length: 31 }, () =>
        request(app)
          .post("/api/community/threads/1/posts")
          .set("x-forwarded-for", ip)
          .set("x-portal-session-token", sessionToken)
          .send({ content: "spam" }),
      ),
    );

    const throttled = responses.filter((r) => r.status === 429);
    expect(throttled.length).toBeGreaterThan(0);
    throttled.forEach((r) => {
      expect(r.headers["retry-after"]).toBeDefined();
      expect(r.body.message).toBe("Too many requests. Please try again later.");
    });
  }, 30_000);
});
