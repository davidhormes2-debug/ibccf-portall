import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  communityThreads as CommunityThreadsTable,
  communityPosts as CommunityPostsTable,
  communityThreadViews as CommunityThreadViewsTable,
} from "@shared/schema";
import express from "express";
import request from "supertest";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// The mocks below hand-roll column objects for the tables that the community
// thread view-dedup route references. These Pick<> declarations ensure that if
// any of those column names are renamed in shared/schema.ts, TypeScript reports
// an error here at `npm run check` time so the mocks can never silently drift.
//
// communityThreads columns asserted:
//   id, departmentId, title, content, authorType, authorHandle,
//   isPinned, isLocked, viewCount, replyCount, lastActivityAt, createdAt
declare const _communityThreadsGuard: Pick<
  typeof CommunityThreadsTable,
  | "id"
  | "departmentId"
  | "title"
  | "content"
  | "authorType"
  | "authorHandle"
  | "isPinned"
  | "isLocked"
  | "viewCount"
  | "replyCount"
  | "lastActivityAt"
  | "createdAt"
>;
// communityPosts columns asserted: threadId, isHidden, createdAt
declare const _communityPostsGuard: Pick<
  typeof CommunityPostsTable,
  "threadId" | "isHidden" | "createdAt"
>;
// communityThreadViews columns asserted: id, threadId, ipHash, hourBucket, createdAt
declare const _communityThreadViewsGuard: Pick<
  typeof CommunityThreadViewsTable,
  "id" | "threadId" | "ipHash" | "hourBucket" | "createdAt"
>;

// ============================================================================
// Community thread view-count deduplication (Task #489)
//
// Task #489 replaced the old in-memory deduplication approach with a
// DB-backed approach using the `community_thread_views` table and an
// ON CONFLICT DO NOTHING upsert.  This guarantees the "at most once per
// (thread, IP, hour)" invariant survives server restarts and holds across
// all autoscale instances.
//
// Tests verify:
//  1. A second request from the SAME IP within the SAME hour does NOT
//     increment the view count (DB returns empty on conflict).
//  2. A request from the SAME IP in a DIFFERENT hour DOES increment the
//     count (different hourBucket → no conflict).
//  3. A request from a DIFFERENT IP in the same hour DOES increment the
//     count (different ipHash → no conflict).
//  4. The `community_thread_views` table receives exactly one unique
//     (threadId, ipHash, hourBucket) row even when the same endpoint is
//     called multiple times for the same combination.
// ============================================================================

const DRIZZLE_NAME = Symbol.for("drizzle:BaseName");

vi.mock("@shared/schema", () => ({
  communityThreads: {
    [DRIZZLE_NAME]: "community_threads",
    id: "id",
    departmentId: "departmentId",
    title: "title",
    content: "content",
    authorType: "authorType",
    authorHandle: "authorHandle",
    isPinned: "isPinned",
    isLocked: "isLocked",
    viewCount: "viewCount",
    replyCount: "replyCount",
    lastActivityAt: "lastActivityAt",
    createdAt: "createdAt",
  },
  communityPosts: {
    [DRIZZLE_NAME]: "community_posts",
    threadId: "threadId",
    isHidden: "isHidden",
    createdAt: "createdAt",
  },
  communityParticipants: { [DRIZZLE_NAME]: "community_participants" },
  communityReactions: { [DRIZZLE_NAME]: "community_reactions" },
  communityThreadViews: {
    [DRIZZLE_NAME]: "community_thread_views",
    id: "id",
    threadId: "threadId",
    ipHash: "ipHash",
    hourBucket: "hourBucket",
    createdAt: "createdAt",
  },
  botProfiles: { [DRIZZLE_NAME]: "bot_profiles" },
  departments: { [DRIZZLE_NAME]: "departments" },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (col: unknown, value: unknown) => ({ __op: "eq", col, value }),
  ilike: (col: unknown, value: unknown) => ({ __op: "ilike", col, value }),
  or: (...preds: unknown[]) => ({ __op: "or", preds }),
  and: (...preds: unknown[]) => ({ __op: "and", preds }),
  desc: () => null,
  asc: () => null,
  gte: () => null,
  lt: () => null,
  sql: () => ({ as: () => null }),
}));

// ---------------------------------------------------------------------------
// DB mock — simulates ON CONFLICT DO NOTHING behaviour for community_thread_views
//
// `seenViews` acts as the unique index on (threadId, ipHash, hourBucket).
// On first insert for a given tuple the mock returns [{id}] (row inserted).
// On subsequent inserts for the same tuple it returns [] (conflict → no-op).
// This exactly mirrors what Postgres does with ON CONFLICT DO NOTHING +
// .returning().
// ---------------------------------------------------------------------------
let seenViews: Set<string>;
let insertedRows: Array<{ threadId: number; ipHash: string; hourBucket: string }>;
let updateCallCount: number;

vi.mock("../db", () => {
  return {
    db: {
      select: () => ({
        from: (table: any) => {
          const name: string = table[Symbol.for("drizzle:BaseName")] ?? "";
          if (name === "community_threads") {
            return {
              where: () =>
                Promise.resolve([
                  {
                    id: 42,
                    departmentId: 1,
                    title: "Test thread",
                    content: "Some content",
                    authorType: "user",
                    authorHandle: "Member #X",
                    isPinned: false,
                    isLocked: false,
                    viewCount: "10",
                    replyCount: "0",
                    lastActivityAt: new Date(),
                    createdAt: new Date(),
                  },
                ]),
            };
          }
          return {
            where: () => ({
              orderBy: () => Promise.resolve([]),
            }),
          };
        },
      }),

      insert: (_table: any) => ({
        values: (vals: { threadId: number; ipHash: string; hourBucket: string }) => ({
          onConflictDoNothing: () => ({
            returning: (_sel: unknown) => {
              const key = `${vals.threadId}:${vals.ipHash}:${vals.hourBucket}`;
              insertedRows.push({ ...vals });
              if (seenViews.has(key)) {
                return Promise.resolve([]);
              }
              seenViews.add(key);
              return Promise.resolve([{ id: seenViews.size }]);
            },
          }),
        }),
      }),

      update: () => ({
        set: () => ({
          where: () => {
            updateCallCount++;
            return Promise.resolve();
          },
        }),
      }),

      delete: () => ({
        where: () => Promise.resolve(),
      }),
    },
  };
});

vi.mock("../services/bot-response-generator", () => ({
  scheduleResponsesForThread: vi.fn(async () => undefined),
}));

vi.mock("../services/portal-auth", () => ({
  validatePortalSession: vi.fn(async () => null),
}));

vi.mock("./middleware", () => ({
  isValidAdminToken: vi.fn(async () => false),
}));

vi.mock("../lib/warnOnce", () => ({
  warnOnce: vi.fn(),
}));

const { communityRouter, clearViewCache } = await import("../routes/community");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.set("trust proxy", true);
  app.use("/api/community", communityRouter);
  return app;
}

const app = buildApp();

beforeEach(() => {
  seenViews = new Set();
  insertedRows = [];
  updateCallCount = 0;
  // Clear the in-process view cache so each test starts from a cold state.
  clearViewCache();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helper — freeze the clock to a known UTC hour so hourBucket is predictable
// ---------------------------------------------------------------------------
function freezeAt(isoString: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoString));
}

describe("GET /api/community/threads/:id — DB-backed view-count deduplication (Task #489)", () => {
  // -------------------------------------------------------------------------
  // 1. Same IP, same hour → no double-count
  // -------------------------------------------------------------------------
  it("increments the view count exactly once when the same IP visits the same thread twice within the same hour", async () => {
    freezeAt("2026-05-29T14:00:00.000Z");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "1.2.3.10");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "1.2.3.10");

    expect(updateCallCount).toBe(1);
  });

  it("inserts exactly one row into community_thread_views for repeated same-IP same-hour requests", async () => {
    freezeAt("2026-05-29T14:00:00.000Z");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "1.2.3.10");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "1.2.3.10");

    // Two insert attempts were made but only one is a unique (threadId, ipHash, hourBucket)
    const uniqueKeys = new Set(
      insertedRows.map((r) => `${r.threadId}:${r.ipHash}:${r.hourBucket}`)
    );
    expect(uniqueKeys.size).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 2. Same IP, next hour → counts again
  // -------------------------------------------------------------------------
  it("counts a second visit from the same IP in a later hour as a new view", async () => {
    freezeAt("2026-05-29T14:00:00.000Z");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "2.3.4.5");

    // Advance the clock by one hour
    vi.setSystemTime(new Date("2026-05-29T15:00:00.000Z"));

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "2.3.4.5");

    expect(updateCallCount).toBe(2);
  });

  it("uses a different hourBucket for the next-hour request so two rows are stored", async () => {
    freezeAt("2026-05-29T14:00:00.000Z");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "2.3.4.5");

    vi.setSystemTime(new Date("2026-05-29T15:00:00.000Z"));

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "2.3.4.5");

    const buckets = insertedRows.map((r) => r.hourBucket);
    expect(buckets[0]).toBe("2026052914");
    expect(buckets[1]).toBe("2026052915");
    expect(new Set(buckets).size).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 3. Different IP, same hour → counts each one
  // -------------------------------------------------------------------------
  it("counts each unique IP as a separate view within the same hour", async () => {
    freezeAt("2026-05-29T14:00:00.000Z");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "10.0.0.1");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "10.0.0.2");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "10.0.0.3");

    expect(updateCallCount).toBe(3);
  });

  it("stores distinct ipHash values for different IPs visiting in the same hour", async () => {
    freezeAt("2026-05-29T14:00:00.000Z");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "10.0.0.1");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "10.0.0.2");

    const hashes = insertedRows.map((r) => r.ipHash);
    expect(new Set(hashes).size).toBe(2);
    // All hashes should be 64-char SHA-256 hex strings
    for (const h of hashes) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Different threads, same IP → treated independently
  // -------------------------------------------------------------------------
  it("treats different threads independently — counts each thread separately per IP", async () => {
    freezeAt("2026-05-29T14:00:00.000Z");

    await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "5.5.5.5");

    await request(app)
      .get("/api/community/threads/99")
      .set("X-Forwarded-For", "5.5.5.5");

    expect(updateCallCount).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 5. First request from any IP always counts
  // -------------------------------------------------------------------------
  it("increments the view count on the very first request from an IP", async () => {
    freezeAt("2026-05-29T14:00:00.000Z");

    const res = await request(app)
      .get("/api/community/threads/42")
      .set("X-Forwarded-For", "1.2.3.99");

    expect(res.status).toBe(200);
    expect(updateCallCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 6. Three requests — only the first counts, the next two are no-ops
  // -------------------------------------------------------------------------
  it("does not increment beyond once for three requests from the same IP in the same hour", async () => {
    freezeAt("2026-05-29T14:00:00.000Z");

    for (let i = 0; i < 3; i++) {
      await request(app)
        .get("/api/community/threads/42")
        .set("X-Forwarded-For", "7.7.7.7");
    }

    expect(updateCallCount).toBe(1);
  });
});
