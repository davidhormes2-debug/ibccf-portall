import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// Regression test for Task #2419: the community POST limiter
// (communityPostLimiter, server/routes/community.ts) is keyed on
// `${namespace}:${clientIP}:${routeKey}` (server/middleware/security.ts).
// Before this fix, routeKey was the *literal* request URL, so
// /threads/1/posts and /threads/2/posts got separate counter buckets even
// though they hit the same route — an attacker could fan out across
// thousands of distinct thread/post IDs from a single IP without ever
// tripping the per-route cap. The fix keys on the matched route *template*
// (req.route.path, e.g. "/threads/:id/posts") instead, so all IDs on the
// same route share one budget.
//
// The thread lookup inside the handler is mocked to always return "not
// found" so the request resolves as a fast 404 without needing a full
// database — this exercises only the rate-limiter middleware, which runs
// before that lookup.

function makeDbMock() {
  return {
    select() {
      return {
        from() {
          return {
            async where() {
              return [] as unknown[];
            },
          };
        },
      };
    },
  };
}

vi.mock("@shared/schema", () => ({
  communityParticipants: {},
  communityThreads: {},
  communityPosts: {},
  communityReactions: {},
  botProfiles: {},
  departments: {},
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: () => () => false };
});

vi.mock("../db", () => ({ db: makeDbMock() }));

vi.mock("../services/portal-auth", () => ({
  validatePortalSession: vi.fn(async () => null),
}));

vi.mock("../services/bot-response-generator", () => ({
  scheduleResponsesForThread: vi.fn(async () => undefined),
}));

const { createStorageMock, atomicCounters } = await vi.hoisted(async () => {
  const { createStorageMock } = await import("./helpers/storageMock");
  const atomicCounters = new Map<string, number>();
  return { createStorageMock, atomicCounters };
});

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

let nextIp = 1;
function freshIp(): string {
  return `10.77.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`;
}

async function buildApp() {
  vi.resetModules();
  const { communityRouter } = await import("../routes/community");
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/community", communityRouter);
  return app;
}

describe("community POST limiter — route template keying (Task #2419)", () => {
  beforeEach(() => {
    atomicCounters.clear();
  });

  it("shares one budget across distinct thread IDs on /threads/:id/posts from the same IP", async () => {
    const app = await buildApp();
    const ip = freshIp();

    // COMMUNITY_POST_MAX is 30/minute. Hit 30 *distinct* thread IDs — if the
    // limiter incorrectly keyed on the literal URL (including :id), every
    // request would land in its own fresh bucket and none would ever be
    // throttled. With route-template keying they all share one bucket, so
    // the 31st distinct-ID request must be blocked.
    const statuses: number[] = [];
    for (let i = 1; i <= 31; i++) {
      const res = await request(app)
        .post(`/api/community/threads/${i}/posts`)
        .set("x-forwarded-for", ip)
        .send({ content: "hello" });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 30)).not.toContain(429);
    expect(statuses[30]).toBe(429);
  });

  it("allows requests to a different route template (/posts/:id/react) even after /threads/:id/posts is exhausted", async () => {
    const app = await buildApp();
    const ip = freshIp();

    for (let i = 1; i <= 30; i++) {
      await request(app)
        .post(`/api/community/threads/${i}/posts`)
        .set("x-forwarded-for", ip)
        .send({ content: "hello" });
    }
    const blocked = await request(app)
      .post("/api/community/threads/999/posts")
      .set("x-forwarded-for", ip)
      .send({ content: "hello" });
    expect(blocked.status).toBe(429);

    // /posts/:id/react is a different route template and therefore a
    // different bucket under the same shared COMMUNITY_POST_RATE_LIMIT_NAMESPACE.
    const reactRes = await request(app)
      .post("/api/community/posts/1/react")
      .set("x-forwarded-for", ip)
      .send({});
    expect(reactRes.status).not.toBe(429);
  });

  it("keeps a separate budget for a different IP hitting the same route template", async () => {
    const app = await buildApp();
    const ipA = freshIp();
    const ipB = freshIp();

    for (let i = 1; i <= 30; i++) {
      await request(app)
        .post(`/api/community/threads/${i}/posts`)
        .set("x-forwarded-for", ipA)
        .send({ content: "hello" });
    }
    const blockedA = await request(app)
      .post("/api/community/threads/999/posts")
      .set("x-forwarded-for", ipA)
      .send({ content: "hello" });
    expect(blockedA.status).toBe(429);

    const okB = await request(app)
      .post("/api/community/threads/1/posts")
      .set("x-forwarded-for", ipB)
      .send({ content: "hello" });
    expect(okB.status).not.toBe(429);
  });
});
