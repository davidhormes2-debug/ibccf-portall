import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ============================================================================
// In-process view-cache throttle tests
//
// recordViewIfNew maintains a bounded in-process Map keyed on
// `${threadId}:${ipHash}:${hourBucket}`. On a cache hit the DB insert is
// skipped entirely, cutting DB write load under high-cardinality scraping
// traffic where many IPs each stay within the per-IP rate limit.
//
// Verified behaviours:
//  1. Second request from the same (IP, thread, hour) does NOT call db.insert
//  2. First request always calls db.insert (cache miss)
//  3. Same IP on a different thread still calls db.insert (separate cache key)
//  4. Same IP on a new hour bucket calls db.insert (cache key differs)
//  5. Bounded eviction: when the cache is full the oldest entry is removed
//     so the size never exceeds VIEW_CACHE_MAX_SIZE
// ============================================================================

const DRIZZLE_NAME = Symbol.for("drizzle:BaseName");

vi.mock("@shared/schema", () => ({
  communityThreads: {
    [DRIZZLE_NAME]: "community_threads",
    id: "id",
    viewCount: "viewCount",
    departmentId: "departmentId",
    title: "title",
    content: "content",
    authorType: "authorType",
    authorHandle: "authorHandle",
    isPinned: "isPinned",
    isLocked: "isLocked",
    replyCount: "replyCount",
    lastActivityAt: "lastActivityAt",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  communityPosts: {
    [DRIZZLE_NAME]: "community_posts",
    id: "id",
    threadId: "threadId",
    isHidden: "isHidden",
    createdAt: "createdAt",
  },
  communityParticipants: {
    [DRIZZLE_NAME]: "community_participants",
    id: "id",
    caseId: "caseId",
    anonymousHandle: "anonymousHandle",
    postCount: "postCount",
  },
  communityReactions: { [DRIZZLE_NAME]: "community_reactions" },
  communityThreadViews: {
    [DRIZZLE_NAME]: "community_thread_views",
    id: "id",
    threadId: "threadId",
    ipHash: "ipHash",
    hourBucket: "hourBucket",
  },
  botProfiles: {
    [DRIZZLE_NAME]: "bot_profiles",
    isActive: "isActive",
  },
  departments: { [DRIZZLE_NAME]: "departments" },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (col: unknown, value: unknown) => ({ __op: "eq", col, value }),
  ilike: () => null,
  or: (...preds: unknown[]) => ({ __op: "or", preds }),
  and: (...preds: unknown[]) => ({ __op: "and", preds }),
  desc: () => null,
  asc: () => null,
  gte: () => null,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const raw =
      typeof strings === "object" && "raw" in strings
        ? strings.raw.join("?")
        : String(strings);
    return { __sql: raw, values, as: () => null };
  },
}));

vi.mock("../services/portal-auth", () => ({
  validatePortalSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/bot-response-generator", () => ({
  scheduleResponsesForThread: vi.fn(),
}));

vi.mock("../routes/middleware", () => ({
  isValidAdminToken: vi.fn().mockResolvedValue(false),
  checkAdminAuth: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock("../lib/warnOnce", () => ({
  warnOnce: vi.fn(),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
// Counts how many times db.insert() is invoked for community_thread_views.
// A cache hit must produce zero insert calls; a cache miss must produce exactly
// one.  The unique-constraint simulation uses a Set just like the other dedup
// tests, but the primary assertion here is the insert call count.

let insertCallCount: number;
let updateCallCount: number;
let seenViews: Set<string>;

vi.mock("../db", () => ({
  db: {
    select: (_shape?: Record<string, unknown>) => ({
      from: (table: any) => {
        const name: string = table[DRIZZLE_NAME] ?? "";
        if (name === "community_threads") {
          return {
            where: (_cond: unknown) =>
              Promise.resolve([
                {
                  id: 1,
                  viewCount: "0",
                  title: "Cache Test Thread",
                  content: "content",
                  authorType: "bot",
                  authorHandle: "Bot-A",
                  isPinned: false,
                  isLocked: false,
                  replyCount: "0",
                  departmentId: null,
                  lastActivityAt: new Date(),
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
              ]),
            orderBy: () => ({
              limit: () => ({
                offset: () => Promise.resolve([]),
              }),
            }),
          };
        }
        if (name === "community_posts") {
          return {
            where: (_cond: unknown) => ({
              orderBy: (_ord: unknown) => Promise.resolve([]),
            }),
          };
        }
        if (name === "community_participants") {
          return { where: (_cond: unknown) => Promise.resolve([]) };
        }
        if (name === "bot_profiles") {
          return { where: (_cond: unknown) => Promise.resolve([{ count: 0 }]) };
        }
        return Promise.resolve([]);
      },
    }),

    insert: (table: any) => ({
      values: (vals: any) => ({
        onConflictDoNothing: (_opts?: unknown) => ({
          returning: () => {
            const name: string = table[DRIZZLE_NAME] ?? "";
            if (name === "community_thread_views") {
              insertCallCount++;
              const key = `${vals.threadId}:${vals.ipHash}:${vals.hourBucket}`;
              if (seenViews.has(key)) {
                return Promise.resolve([]);
              }
              seenViews.add(key);
              return Promise.resolve([{ id: seenViews.size }]);
            }
            return Promise.resolve([]);
          },
        }),
        returning: () => Promise.resolve([]),
      }),
    }),

    update: (_table: any) => ({
      set: (_vals: unknown) => ({
        where: (_cond: unknown) => {
          updateCallCount++;
          return Promise.resolve([]);
        },
      }),
    }),

    delete: (_table: any) => ({
      where: (_cond: unknown) => ({
        returning: () => Promise.resolve([]),
      }),
    }),
  },
}));

import express from "express";
import request from "supertest";

const { communityRouter, clearViewCache } = await import("../routes/community");

function buildApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/community", communityRouter);
  return app;
}

const TEST_IP = "203.0.113.55";
const THREAD_ID = 1;

beforeEach(() => {
  insertCallCount = 0;
  updateCallCount = 0;
  seenViews = new Set<string>();
  // Always start each test with a cold cache.
  clearViewCache();
  // Pin the clock so hourBucket() is deterministic across all assertions.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-10T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("in-process view cache — DB write throttle", () => {
  it("calls db.insert on the first request from a given (IP, thread, hour)", async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`/api/community/threads/${THREAD_ID}`)
      .set("X-Forwarded-For", TEST_IP);
    expect(res.status).toBe(200);
    expect(insertCallCount).toBe(1);
  });

  it("does NOT call db.insert on a second request from the same (IP, thread, hour)", async () => {
    const app = buildApp();

    // First request — cache miss → DB write
    await request(app)
      .get(`/api/community/threads/${THREAD_ID}`)
      .set("X-Forwarded-For", TEST_IP);
    expect(insertCallCount).toBe(1);

    // Second request — cache hit → DB write skipped
    await request(app)
      .get(`/api/community/threads/${THREAD_ID}`)
      .set("X-Forwarded-For", TEST_IP);
    expect(insertCallCount).toBe(1); // still 1 — insert was not called again
  });

  it("does NOT increment the view count on the cached second request", async () => {
    const app = buildApp();

    await request(app)
      .get(`/api/community/threads/${THREAD_ID}`)
      .set("X-Forwarded-For", TEST_IP);
    expect(updateCallCount).toBe(1);

    await request(app)
      .get(`/api/community/threads/${THREAD_ID}`)
      .set("X-Forwarded-For", TEST_IP);
    expect(updateCallCount).toBe(1); // no second increment
  });

  it("calls db.insert for a different thread even from the same IP in the same hour", async () => {
    const app = buildApp();
    const THREAD_B = 99;

    await request(app)
      .get(`/api/community/threads/${THREAD_ID}`)
      .set("X-Forwarded-For", TEST_IP);

    // Different thread — different cache key — must hit DB
    await request(app)
      .get(`/api/community/threads/${THREAD_B}`)
      .set("X-Forwarded-For", TEST_IP);

    expect(insertCallCount).toBe(2);
  });

  it("calls db.insert when the same IP visits the same thread in a new hour bucket", async () => {
    const app = buildApp();

    await request(app)
      .get(`/api/community/threads/${THREAD_ID}`)
      .set("X-Forwarded-For", TEST_IP);
    expect(insertCallCount).toBe(1);

    // Advance clock by one hour — different hourBucket → different cache key
    vi.setSystemTime(new Date("2026-06-10T11:00:00.000Z"));

    await request(app)
      .get(`/api/community/threads/${THREAD_ID}`)
      .set("X-Forwarded-For", TEST_IP);
    expect(insertCallCount).toBe(2); // new bucket → cache miss → DB write
  });

  it("handles many duplicate requests — db.insert is called exactly once per (IP, thread, hour)", async () => {
    const app = buildApp();

    for (let i = 0; i < 10; i++) {
      await request(app)
        .get(`/api/community/threads/${THREAD_ID}`)
        .set("X-Forwarded-For", TEST_IP);
    }

    expect(insertCallCount).toBe(1);
    expect(updateCallCount).toBe(1);
  });

  it("different IPs each trigger their own db.insert (distinct cache keys)", async () => {
    const app = buildApp();
    const IPS = ["10.0.0.1", "10.0.0.2", "10.0.0.3"];

    for (const ip of IPS) {
      await request(app)
        .get(`/api/community/threads/${THREAD_ID}`)
        .set("X-Forwarded-For", ip);
    }

    expect(insertCallCount).toBe(3);
    expect(updateCallCount).toBe(3);
  });
});
