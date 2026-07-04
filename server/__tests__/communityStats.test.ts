import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  communityThreads as CommunityThreadsTable,
  communityPosts as CommunityPostsTable,
  communityParticipants as CommunityParticipantsTable,
  botProfiles as BotProfilesTable,
} from "@shared/schema";
import express from "express";
import request from "supertest";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// These Pick<> declarations ensure that if any column names referenced by the
// community stats / delete handlers are renamed in shared/schema.ts, TypeScript
// reports an error here at `npm run check` time so the mocks can never silently
// drift.
//
// communityThreads columns: id, viewCount
declare const _communityThreadsGuard: Pick<
  typeof CommunityThreadsTable,
  "id" | "viewCount"
>;
// communityPosts: threadId, isHidden
declare const _communityPostsGuard: Pick<
  typeof CommunityPostsTable,
  "threadId" | "isHidden"
>;
// communityParticipants: id
declare const _communityParticipantsGuard: Pick<
  typeof CommunityParticipantsTable,
  "id"
>;
// botProfiles: isActive
declare const _botProfilesGuard: Pick<typeof BotProfilesTable, "isActive">;

// ============================================================================
// Community stats — Total Views accuracy after thread deletion
//
// GET /api/community/stats derives `totalViews` by SUM-ing the live
// `communityThreads.viewCount` column.  Because the DELETE handler removes
// the thread row from the table, the sum automatically excludes it — no
// extra filter or manual subtraction is needed.
//
// These tests verify the correctness of that guarantee via a stateful in-memory
// thread store that is shared between the DELETE handler mock and the stats SUM
// mock:
//
//  1. Before deletion, totalViews equals the sum of all thread viewCounts.
//  2. Deleting a thread via DELETE /api/community/threads/:id removes it from
//     the live store, so the subsequent GET /api/community/stats returns a
//     lower totalViews.
//  3. Deleting the last thread brings totalViews to 0 (COALESCE path).
// ============================================================================

const DRIZZLE_NAME = Symbol.for("drizzle:BaseName");

// ── In-memory thread store shared by both the delete and stats mocks ─────────
// Each test resets this to a known starting state before making requests.
type StoreThread = {
  id: number;
  viewCount: number;
  title: string;
  content: string;
  authorType: "bot" | "user" | "admin";
  authorHandle: string;
  isPinned: boolean;
  isLocked: boolean;
  replyCount: number;
  lastActivityAt: Date;
  createdAt: Date;
};
let threadStore: StoreThread[];

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
    const raw = typeof strings === "object" && "raw" in strings
      ? strings.raw.join("?")
      : String(strings);
    return { __sql: raw, values, as: () => null };
  },
}));

// Stub portal-auth so the community router can be imported without a real DB.
vi.mock("../services/portal-auth", () => ({
  validatePortalSession: vi.fn().mockResolvedValue(null),
}));

// Stub bot-response-generator so thread creation doesn't try to spawn real work.
vi.mock("../services/bot-response-generator", () => ({
  scheduleResponsesForThread: vi.fn(),
}));

// Mock the middleware so isValidAdminToken always grants access for our test
// admin token — the DELETE /threads/:id route uses this directly.
vi.mock("../routes/middleware", () => ({
  isValidAdminToken: vi.fn().mockResolvedValue(true),
  checkAdminAuth: vi.fn((_req: any, _res: any, next: any) => next()),
}));

// ── DB mock — reads/writes from the shared `threadStore` ─────────────────────
vi.mock("../db", () => ({
  db: {
    // SELECT queries — distinguish by the select-shape key:
    //   { count: ... }  → COUNT(*) queries (threads, posts, participants, bots)
    //   { total: ... }  → COALESCE(SUM(viewCount), 0) for stats totalViews
    select: (shape?: Record<string, unknown>) => ({
      from: (table: any) => {
        const name: string = table[DRIZZLE_NAME] ?? "";
        const isSumQuery = shape != null && "total" in shape;

        if (name === "community_threads") {
          if (isSumQuery) {
            const total = threadStore.reduce(
              (s, t) => s + (t.viewCount || 0),
              0,
            );
            return Promise.resolve([{ total }]);
          }
          // COUNT(*) — used by stats and by shouldScheduleBotResponses queries
          return Promise.resolve([{ count: threadStore.length }]);
        }

        if (name === "community_posts") {
          return Promise.resolve([{ count: 0 }]);
        }

        if (name === "community_participants") {
          return Promise.resolve([{ count: 0 }]);
        }

        if (name === "bot_profiles") {
          // stats botCount query chains .where() — return an object with .where()
          return {
            where: (_cond: unknown) => Promise.resolve([{ count: 0 }]),
          };
        }

        return Promise.resolve([]);
      },
    }),

    // DELETE — removes the matching thread from the in-memory store
    delete: (table: any) => {
      const name: string = table[DRIZZLE_NAME] ?? "";
      return {
        where: (cond: any) => {
          if (name === "community_threads") {
            return {
              returning: () => {
                // The mock eq() returns { __op: "eq", col, value } — value is
                // the thread ID passed to eq(communityThreads.id, threadId).
                const id = cond?.value;
                const idx = threadStore.findIndex((t) => t.id === id);
                if (idx === -1) return Promise.resolve([]);
                const [removed] = threadStore.splice(idx, 1);
                return Promise.resolve([removed]);
              },
            };
          }
          // communityPosts delete — just a no-op success
          return Promise.resolve([]);
        },
      };
    },

    // INSERT / UPDATE stubs — not exercised by stats or delete, but the
    // shouldScheduleBotResponses helper may reach them indirectly.
    insert: (_table: any) => ({
      values: (_vals: unknown) => ({
        onConflictDoNothing: (_opts?: unknown) => ({
          returning: () => Promise.resolve([]),
        }),
        returning: () => Promise.resolve([]),
      }),
    }),
    update: (_table: any) => ({
      set: (_vals: unknown) => ({
        where: (_cond: unknown) => Promise.resolve([]),
      }),
    }),
  },
}));

// ── Router / app factory ──────────────────────────────────────────────────────
// The router is imported once (top-level) so the mocks are already in place.
const { communityRouter } = await import("../routes/community");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/community", communityRouter);
  return app;
}

const ADMIN_AUTH = { Authorization: "Bearer test-admin-token" };

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  // Each test starts with a fresh thread store — mutated in-place by the mock
  threadStore = [
    {
      id: 1,
      viewCount: 80,
      title: "Thread A",
      content: "about blockchain",
      authorType: "bot",
      authorHandle: "Bot-X",
      isPinned: false,
      isLocked: false,
      replyCount: 0,
      lastActivityAt: new Date(),
      createdAt: new Date(),
    },
    {
      id: 2,
      viewCount: 20,
      title: "Thread B",
      content: "about crypto",
      authorType: "bot",
      authorHandle: "Bot-Y",
      isPinned: false,
      isLocked: false,
      replyCount: 0,
      lastActivityAt: new Date(),
      createdAt: new Date(),
    },
  ];
});

describe("GET /api/community/stats — Total Views after thread deletion", () => {
  it("reports the sum of all live thread viewCounts before any deletion", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/community/stats");
    expect(res.status).toBe(200);
    // 80 + 20 = 100
    expect(res.body.totalViews).toBe(100);
  });

  it("decreases totalViews when one thread is deleted", async () => {
    const app = buildApp();

    // Baseline: two threads, total views = 100
    const before = await request(app).get("/api/community/stats");
    expect(before.body.totalViews).toBe(100);

    // Delete thread 1 (viewCount = 80) via the admin endpoint
    const del = await request(app)
      .delete("/api/community/threads/1")
      .set(ADMIN_AUTH);
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    // After deletion only thread 2 (viewCount = 20) remains
    const after = await request(app).get("/api/community/stats");
    expect(after.status).toBe(200);
    expect(after.body.totalViews).toBe(20);
    expect(after.body.totalViews).toBeLessThan(before.body.totalViews);
  });

  it("returns totalViews 0 (COALESCE path) when all threads are deleted", async () => {
    const app = buildApp();

    // Delete both threads
    await request(app).delete("/api/community/threads/1").set(ADMIN_AUTH);
    await request(app).delete("/api/community/threads/2").set(ADMIN_AUTH);

    const res = await request(app).get("/api/community/stats");
    expect(res.status).toBe(200);
    expect(res.body.totalViews).toBe(0);
  });

  it("404s on a non-existent thread and leaves totalViews unchanged", async () => {
    const app = buildApp();
    const del = await request(app)
      .delete("/api/community/threads/999")
      .set(ADMIN_AUTH);
    expect(del.status).toBe(404);

    const res = await request(app).get("/api/community/stats");
    expect(res.body.totalViews).toBe(100);
  });
});
