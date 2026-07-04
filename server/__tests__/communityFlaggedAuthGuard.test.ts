import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// GET /api/admin/community/flagged — auth guard tests
//
// community_flagged_auth_guard (sentinel — referenced by CI job)
//
// Verifies that the flagged-content list endpoint is correctly gated behind
// admin authentication:
//   1. No Authorization header → 401.
//   2. Invalid bearer token → 401.
//   3. Valid admin bearer token → 200 with { posts, threads } shape.
// ============================================================================

// ---------------------------------------------------------------------------
// Admin auth env — canonical-admin shortcut so checkAdminAuth skips sub-admin
// DB lookup (adminUsername === ADMIN_USERNAME env var).
// ---------------------------------------------------------------------------
const TEST_ADMIN_USERNAME = "flagged-auth-guard-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---------------------------------------------------------------------------
// Mock @shared/schema
// ---------------------------------------------------------------------------
vi.mock("@shared/schema", () => {
  const makeTable = (name: string, cols: Record<string, string> = {}) =>
    Object.assign({ __tableName: name }, cols);
  return {
    communityPosts: makeTable("community_posts", {
      id: "posts.id",
      threadId: "posts.threadId",
      isFlagged: "posts.isFlagged",
      flagReason: "posts.flagReason",
      createdAt: "posts.createdAt",
    }),
    communityThreads: makeTable("community_threads", {
      id: "threads.id",
      isFlagged: "threads.isFlagged",
      flagReason: "threads.flagReason",
      createdAt: "threads.createdAt",
    }),
    communityKeywordBlocklist: makeTable("community_keyword_blocklist", {
      id: "kw.id",
      pattern: "kw.pattern",
      isWildcard: "kw.isWildcard",
      isActive: "kw.isActive",
      createdAt: "kw.createdAt",
      createdBy: "kw.createdBy",
    }),
  };
});

// ---------------------------------------------------------------------------
// Mock drizzle-orm helpers
// ---------------------------------------------------------------------------
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (_col: unknown, _val: unknown) => ({ __op: "eq" }),
  desc: (_col: unknown) => ({ __op: "desc" }),
  and: (..._args: unknown[]) => ({ __op: "and" }),
  inArray: (_col: unknown, _vals: unknown) => ({ __op: "inArray" }),
}));

// ---------------------------------------------------------------------------
// Mock db — returns empty arrays for the flagged list query
// ---------------------------------------------------------------------------
vi.mock("../db", () => ({
  db: {
    select: (_fields?: any) => ({
      from: (_table: any) => ({
        where: (_cond: any) => ({
          orderBy: (_ord: any) => Promise.resolve([]),
        }),
      }),
    }),
    update: (_table: any) => ({
      set: (_vals: any) => ({
        where: (_cond: any) => Promise.resolve(undefined),
      }),
    }),
    delete: (_table: any) => ({
      where: (_cond: any) => Promise.resolve(undefined),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock storage — only what checkAdminAuth needs
// ---------------------------------------------------------------------------
vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) => {
      if (token === "valid-admin-token") {
        return {
          id: "session-auth-guard-1",
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: TEST_ADMIN_USERNAME,
        };
      }
      return null;
    }),
    updateAdminSessionActivity: vi.fn(async () => {}),
    createAuditLog: vi.fn(async () => ({ id: 1 })),
  }),
}));

// ---------------------------------------------------------------------------
// Bypass rate limiters
// ---------------------------------------------------------------------------
vi.mock("../middleware/security", () => ({
  rateLimiter: () => (_req: any, _res: any, next: any) => next(),
  ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE: "access_key_submit",
}));

// ---------------------------------------------------------------------------
// Stub communityModeration service (imported by the router)
// ---------------------------------------------------------------------------
vi.mock("../services/communityModeration", () => ({
  invalidateModerationCache: vi.fn(),
  checkContent: vi.fn(async () => ({ flagged: false, reason: null })),
}));

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const { adminCommunityModerationRouter } = await import(
  "../routes/adminCommunityModeration"
);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/community", adminCommunityModerationRouter);
  return app;
}

const app = buildApp();

// ===========================================================================
// Auth guard — GET /api/admin/community/flagged
// ===========================================================================

describe("GET /api/admin/community/flagged — auth guard", () => {
  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get("/api/admin/community/flagged");
    expect(res.status).toBe(401);
  });

  it("returns 401 when an invalid bearer token is provided", async () => {
    const res = await request(app)
      .get("/api/admin/community/flagged")
      .set("Authorization", "Bearer invalid-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is malformed (no Bearer prefix)", async () => {
    const res = await request(app)
      .get("/api/admin/community/flagged")
      .set("Authorization", "valid-admin-token");
    expect(res.status).toBe(401);
  });

  it("returns 200 with { posts, threads } shape when a valid admin token is provided", async () => {
    const res = await request(app)
      .get("/api/admin/community/flagged")
      .set("Authorization", "Bearer valid-admin-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("posts");
    expect(res.body).toHaveProperty("threads");
    expect(Array.isArray(res.body.posts)).toBe(true);
    expect(Array.isArray(res.body.threads)).toBe(true);
  });
});
