import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  communityThreads as CommunityThreadsTable,
  communityThreadViews as CommunityThreadViewsTable,
} from "@shared/schema";
import express from "express";
import request from "supertest";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// Ensures column names used by recordViewIfNew / the view route are still valid.
declare const _threadsGuard: Pick<
  typeof CommunityThreadsTable,
  "id" | "viewCount"
>;
declare const _viewsGuard: Pick<
  typeof CommunityThreadViewsTable,
  "id" | "threadId" | "ipHash" | "hourBucket"
>;

// ============================================================================
// recordViewIfNew — per-(IP, hourBucket) deduplication contract
//
// GET /api/community/threads/:id calls recordViewIfNew(threadId, clientIp)
// before incrementing viewCount.  recordViewIfNew inserts a row into
// community_thread_views with a unique constraint on (threadId, ipHash,
// hourBucket) and uses onConflictDoNothing to detect duplicates:
//
//   • Same IP + same hourBucket  → insert is a no-op (returns [])  → returns false
//     → viewCount is NOT incremented
//   • Same IP + different hourBucket → insert succeeds (returns [{id}]) → returns true
//     → viewCount IS incremented
//
// These tests control the clock with vi.useFakeTimers({ toFake: ['Date'] }) so
// hourBucket() is deterministic, and use an in-memory Set to simulate the DB
// unique constraint.
//
// req.ip is injected via X-Forwarded-For + trust proxy so we can test distinct
// IPs without modifying Express internals.
// ============================================================================

const DRIZZLE_NAME = Symbol.for("drizzle:BaseName");

// ── Shared mutable state reset in beforeEach ──────────────────────────────────
// viewsStore: simulates the unique constraint on (threadId, ipHash, hourBucket)
let viewsStore: Set<string>;
// updateCallCount: how many times db.update() was committed (= viewCount increments)
let updateCallCount: number;

// ── Schema mock ───────────────────────────────────────────────────────────────
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

// ── drizzle-orm helpers mock ───────────────────────────────────────────────────
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

// ── Service / middleware stubs ─────────────────────────────────────────────────
vi.mock("../services/portal-auth", () => ({
  validatePortalSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/bot-response-generator", () => ({
  scheduleResponsesForThread: vi.fn(),
}));

vi.mock("../routes/middleware", () => ({
  isValidAdminToken: vi.fn().mockResolvedValue(true),
  checkAdminAuth: vi.fn((_req: any, _res: any, next: any) => next()),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
// select: returns a stub thread for community_threads; empty posts otherwise.
// insert into community_thread_views: simulates the unique constraint via viewsStore.
// update: counts increments via updateCallCount.
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
                  title: "Test Thread",
                  content: "test content",
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
          return {
            where: (_cond: unknown) => Promise.resolve([]),
          };
        }

        if (name === "bot_profiles") {
          return {
            where: (_cond: unknown) => Promise.resolve([{ count: 0 }]),
          };
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
              // Simulate the DB unique constraint on (threadId, ipHash, hourBucket).
              // vals.hourBucket is produced by hourBucket() inside recordViewIfNew,
              // which reads new Date() — controlled by vi.useFakeTimers({ toFake: ['Date'] }).
              const key = `${vals.threadId}:${vals.ipHash}:${vals.hourBucket}`;
              if (viewsStore.has(key)) {
                // Conflict → onConflictDoNothing → no row returned
                return Promise.resolve([]);
              }
              viewsStore.add(key);
              return Promise.resolve([{ id: viewsStore.size }]);
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

// ── Router / app factory ──────────────────────────────────────────────────────
const { communityRouter, clearViewCache } = await import("../routes/community");

/**
 * Build an Express app wired with the community router.
 * trust proxy is enabled so that X-Forwarded-For sets req.ip — the same
 * mechanism the production reverse proxy uses, and the cleanest way to
 * inject a specific IP without touching Express internals in tests.
 */
function buildApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/community", communityRouter);
  return app;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  viewsStore = new Set<string>();
  updateCallCount = 0;
  // Clear the in-process view cache so each test starts from a cold state.
  clearViewCache();
  // Pin the clock to a known UTC hour so hourBucket() is deterministic.
  // 2026-06-10 14:00:00 UTC → hourBucket = "2026061014"
  // Fake only Date — leaving setTimeout/setInterval real so supertest's HTTP
  // server machinery continues to work without timing out.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-10T14:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// Shared IP for the single-client tests
const TEST_IP = "203.0.113.42";

// ============================================================================
// Tests
// ============================================================================

describe("recordViewIfNew — per-(IP, hourBucket) deduplication", () => {
  it("returns false and skips viewCount increment on a duplicate hit (same IP, same hour)", async () => {
    const app = buildApp();

    // First hit: new (threadId=1, ip=TEST_IP, hour=2026061014) → recorded
    const first = await request(app)
      .get("/api/community/threads/1")
      .set("X-Forwarded-For", TEST_IP);
    expect(first.status).toBe(200);
    expect(updateCallCount).toBe(1); // viewCount incremented once

    // Second hit: same IP within the same hour → conflict → skipped
    const second = await request(app)
      .get("/api/community/threads/1")
      .set("X-Forwarded-For", TEST_IP);
    expect(second.status).toBe(200);
    expect(updateCallCount).toBe(1); // still 1 — no second increment
    expect(viewsStore.size).toBe(1); // only one row in the dedup store
  });

  it("returns true and increments viewCount when the same IP hits in a new hour", async () => {
    const app = buildApp();

    // First hit at hour 2026061014
    const first = await request(app)
      .get("/api/community/threads/1")
      .set("X-Forwarded-For", TEST_IP);
    expect(first.status).toBe(200);
    expect(updateCallCount).toBe(1);

    // Advance the clock by exactly one hour → hourBucket becomes "2026061015"
    vi.setSystemTime(new Date("2026-06-10T15:00:00.000Z"));

    // Second hit: same IP but new hour bucket → should register as a fresh view
    const second = await request(app)
      .get("/api/community/threads/1")
      .set("X-Forwarded-For", TEST_IP);
    expect(second.status).toBe(200);
    expect(updateCallCount).toBe(2); // incremented again for the new hour
    expect(viewsStore.size).toBe(2); // two distinct (ip, hour) rows stored
  });

  it("accepts simultaneous hits from two different IPs in the same hour", async () => {
    const app = buildApp();
    const IP_A = "203.0.113.10";
    const IP_B = "203.0.113.11";

    await request(app)
      .get("/api/community/threads/1")
      .set("X-Forwarded-For", IP_A);
    await request(app)
      .get("/api/community/threads/1")
      .set("X-Forwarded-For", IP_B);

    // Each distinct IP should produce one increment
    expect(updateCallCount).toBe(2);
    expect(viewsStore.size).toBe(2);
  });
});
