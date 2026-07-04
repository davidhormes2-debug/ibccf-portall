import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";
import { storage } from "../storage";

// ============================================================================
// Flagged content bulk-action endpoints — integration tests
//
// community_flagged_bulk_actions (sentinel — referenced by CI job)
//
// Endpoints under test:
//   POST /api/admin/community/flagged/posts/bulk-approve
//   POST /api/admin/community/flagged/posts/bulk-remove
//   POST /api/admin/community/flagged/threads/bulk-approve
//   POST /api/admin/community/flagged/threads/bulk-remove
//
// Tests cover:
//   1. Auth guard — 401 without a valid admin bearer token (all 4 endpoints).
//   2. Validation — 400 when ids is missing, empty, or all non-numeric.
//   3. Success shape — { ok: true, count: N } for each endpoint.
//   4. threads/bulk-remove — 404 when no flagged threads match the supplied ids.
//   5. threads/bulk-remove — cascade-delete ordering: child posts are deleted
//      BEFORE the parent thread rows.
// ============================================================================

// ---------------------------------------------------------------------------
// Admin auth env — use the canonical-admin shortcut so checkAdminAuth skips
// the sub-admin DB lookup (adminUsername === ADMIN_USERNAME env var).
// ---------------------------------------------------------------------------
const TEST_ADMIN_USERNAME = "flagged-bulk-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---------------------------------------------------------------------------
// DB mock state — mutated per-test via beforeEach resets.
// ---------------------------------------------------------------------------

/** Rows returned by db.select().from(communityThreads).where(...) for bulk-remove confirmation. */
let mockSelectResult: Array<{ id: number }> = [];

/** Ordered list of table names passed to db.delete(), for cascade-ordering assertions. */
const dbDeleteCalls: string[] = [];

/** WHERE condition passed to the most recent db.update().set().where() call. */
let lastUpdateWhere: unknown = undefined;

/** WHERE conditions passed to each db.delete().where() call (parallel to dbDeleteCalls). */
const dbDeleteWhereCalls: unknown[] = [];

/** WHERE condition passed to the most recent db.select().from().where() call. */
let lastSelectWhere: unknown = undefined;

/** Number of times db.update().set().where() was awaited. */
let dbUpdateCount = 0;

/** Rows returned by db.update().set().where().returning() for single-item routes. */
let mockUpdateReturningResult: Array<Record<string, unknown>> = [];

/** Rows returned by db.delete().where().returning() for single-item routes. */
let mockDeleteReturningResult: Array<Record<string, unknown>> = [];

// ---------------------------------------------------------------------------
// Mock @shared/schema — give each table a recognisable __tableName so the
// db.delete spy can tell posts from threads without the real Drizzle symbol.
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
// Mock drizzle-orm helpers — they only build query conditions; the DB mock
// ignores whatever it receives, so these can return a stable sentinel value.
// ---------------------------------------------------------------------------
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: (...args: unknown[]) => ({ __op: "and", args }),
  eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
  inArray: (col: unknown, vals: unknown) => ({ __op: "inArray", col, vals }),
  desc: (_col: unknown) => ({ __op: "desc" }),
}));

// ---------------------------------------------------------------------------
// Mock the drizzle db — tracks calls and returns controlled data.
// ---------------------------------------------------------------------------
vi.mock("../db", () => ({
  db: {
    update: (_table: any) => ({
      set: (_vals: any) => ({
        where: (cond: any) => {
          lastUpdateWhere = cond;
          dbUpdateCount += 1;
          return {
            then: (resolve: any, reject: any) =>
              Promise.resolve(undefined).then(resolve, reject),
            returning: () => Promise.resolve(mockUpdateReturningResult),
          };
        },
      }),
    }),
    delete: (table: any) => {
      const name: string = (table as any)?.__tableName ?? "unknown";
      dbDeleteCalls.push(name);
      return {
        where: (cond: any) => {
          dbDeleteWhereCalls.push(cond);
          return {
            then: (resolve: any, reject: any) =>
              Promise.resolve(undefined).then(resolve, reject),
            returning: () => Promise.resolve(mockDeleteReturningResult),
          };
        },
      };
    },
    select: (_fields?: any) => ({
      from: (_table: any) => ({
        where: (cond: any) => {
          lastSelectWhere = cond;
          return Promise.resolve(mockSelectResult);
        },
      }),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock storage — only the methods checkAdminAuth needs plus createAuditLog.
// ---------------------------------------------------------------------------
vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) => {
      if (token === "valid-admin-token") {
        return {
          id: "session-bulk-1",
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
// Bypass rate limiters so tests are never throttled.
// ---------------------------------------------------------------------------
vi.mock("../middleware/security", () => ({
  rateLimiter: () => (_req: any, _res: any, next: any) => next(),
  ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE: "access_key_submit",
}));

// ---------------------------------------------------------------------------
// Mock communityModeration — invalidateModerationCache is called by keyword
// routes (not bulk-action routes), but the module is imported by the router
// so we stub it to avoid real DB calls.
// ---------------------------------------------------------------------------
vi.mock("../services/communityModeration", () => ({
  invalidateModerationCache: vi.fn(),
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

// ---------------------------------------------------------------------------
// Reset per-test state.
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockSelectResult = [];
  mockUpdateReturningResult = [];
  mockDeleteReturningResult = [];
  dbDeleteCalls.length = 0;
  dbDeleteWhereCalls.length = 0;
  dbUpdateCount = 0;
  lastUpdateWhere = undefined;
  lastSelectWhere = undefined;
});

// ===========================================================================
// Auth guard — all four bulk endpoints require a valid admin token
// ===========================================================================

describe("Bulk-action auth guard — no token → 401", () => {
  const ENDPOINTS = [
    "/api/admin/community/flagged/posts/bulk-approve",
    "/api/admin/community/flagged/posts/bulk-remove",
    "/api/admin/community/flagged/threads/bulk-approve",
    "/api/admin/community/flagged/threads/bulk-remove",
  ];

  for (const path of ENDPOINTS) {
    it(`(a) ${path} returns 401 without Authorization header`, async () => {
      const res = await request(app).post(path).send({ ids: [1, 2] });
      expect(res.status).toBe(401);
    });

    it(`(b) ${path} returns 401 with an invalid token`, async () => {
      const res = await request(app)
        .post(path)
        .set("Authorization", "Bearer bad-token")
        .send({ ids: [1, 2] });
      expect(res.status).toBe(401);
    });
  }
});

// ===========================================================================
// Input validation — shared across all four endpoints
// ===========================================================================

describe("Bulk-action input validation", () => {
  const AUTH = { Authorization: "Bearer valid-admin-token" };

  const ENDPOINTS = [
    "/api/admin/community/flagged/posts/bulk-approve",
    "/api/admin/community/flagged/posts/bulk-remove",
    "/api/admin/community/flagged/threads/bulk-approve",
    "/api/admin/community/flagged/threads/bulk-remove",
  ];

  for (const path of ENDPOINTS) {
    describe(path, () => {
      it("returns 400 when ids is missing from the body", async () => {
        const res = await request(app).post(path).set(AUTH).send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/ids/i);
      });

      it("returns 400 when ids is an empty array", async () => {
        const res = await request(app).post(path).set(AUTH).send({ ids: [] });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/ids/i);
      });

      it("returns 400 when ids contains only non-numeric string values", async () => {
        const res = await request(app)
          .post(path)
          .set(AUTH)
          .send({ ids: ["abc", "xyz", "not-a-number"] });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/ids/i);
      });

      it("returns 400 when ids is not an array", async () => {
        const res = await request(app)
          .post(path)
          .set(AUTH)
          .send({ ids: 42 });
        expect(res.status).toBe(400);
      });
    });
  }
});

// ===========================================================================
// posts/bulk-approve — success path
// ===========================================================================

describe("POST /api/admin/community/flagged/posts/bulk-approve — success", () => {
  const PATH = "/api/admin/community/flagged/posts/bulk-approve";
  const AUTH = { Authorization: "Bearer valid-admin-token" };

  it("returns { ok: true, count: N } for valid ids", async () => {
    const res = await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [10, 20, 30] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(3);
  });

  it("filters out NaN values and uses the remaining numeric ids", async () => {
    const res = await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [5, "bad", 15] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it("calls db.update exactly once (no delete for approve)", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: [1] });
    expect(dbUpdateCount).toBe(1);
    expect(dbDeleteCalls.length).toBe(0);
  });

  it("ids for non-flagged records are a silent no-op (query still returns ok)", async () => {
    const res = await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [999] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ===========================================================================
// posts/bulk-remove — success path
// ===========================================================================

describe("POST /api/admin/community/flagged/posts/bulk-remove — success", () => {
  const PATH = "/api/admin/community/flagged/posts/bulk-remove";
  const AUTH = { Authorization: "Bearer valid-admin-token" };

  it("returns { ok: true, count: N } for valid ids", async () => {
    const res = await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [1, 2] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(2);
  });

  it("calls db.delete exactly once (the flagged posts)", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: [1] });
    expect(dbDeleteCalls.length).toBe(1);
    expect(dbDeleteCalls[0]).toBe("community_posts");
  });

  it("ids for non-flagged records are a silent no-op (query still returns ok)", async () => {
    const res = await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [999] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ===========================================================================
// threads/bulk-approve — success path
// ===========================================================================

describe("POST /api/admin/community/flagged/threads/bulk-approve — success", () => {
  const PATH = "/api/admin/community/flagged/threads/bulk-approve";
  const AUTH = { Authorization: "Bearer valid-admin-token" };

  it("returns { ok: true, count: N } for valid ids", async () => {
    const res = await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [100, 200] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(2);
  });

  it("calls db.update exactly once (no delete for approve)", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: [100] });
    expect(dbUpdateCount).toBe(1);
    expect(dbDeleteCalls.length).toBe(0);
  });
});

// ===========================================================================
// threads/bulk-remove — 404 when no flagged threads match
// ===========================================================================

describe("POST /api/admin/community/flagged/threads/bulk-remove — no matching flagged threads", () => {
  const PATH = "/api/admin/community/flagged/threads/bulk-remove";
  const AUTH = { Authorization: "Bearer valid-admin-token" };

  it("returns 404 when the confirmation select returns no rows", async () => {
    mockSelectResult = [];
    const res = await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [999] });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no matching flagged threads/i);
  });

  it("does not call db.delete when no flagged threads are found", async () => {
    mockSelectResult = [];
    await request(app).post(PATH).set(AUTH).send({ ids: [999] });
    expect(dbDeleteCalls.length).toBe(0);
  });
});

// ===========================================================================
// threads/bulk-remove — success path + cascade-delete ordering
// ===========================================================================

describe("POST /api/admin/community/flagged/threads/bulk-remove — success + cascade ordering", () => {
  const PATH = "/api/admin/community/flagged/threads/bulk-remove";
  const AUTH = { Authorization: "Bearer valid-admin-token" };

  beforeEach(() => {
    mockSelectResult = [{ id: 10 }, { id: 20 }];
  });

  it("returns { ok: true, count: N } equal to the number of confirmed flagged threads", async () => {
    const res = await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [10, 20, 30] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(2);
  });

  it("cascade-deletes child posts BEFORE removing the parent thread rows", async () => {
    await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [10, 20] });

    expect(dbDeleteCalls.length).toBe(2);
    expect(dbDeleteCalls[0]).toBe("community_posts");
    expect(dbDeleteCalls[1]).toBe("community_threads");
  });

  it("only removes threads whose ids are confirmed flagged (not all supplied ids)", async () => {
    mockSelectResult = [{ id: 10 }];
    const res = await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [10, 30] });
    expect(res.body.count).toBe(1);
  });

  it("still performs cascade even when all supplied ids are confirmed", async () => {
    const res = await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [10, 20] });
    expect(res.body.count).toBe(2);
    expect(dbDeleteCalls).toEqual(["community_posts", "community_threads"]);
  });

  it("scopes the child-post cascade delete to confirmedIds, not the raw supplied ids", async () => {
    await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [10, 20, 30] });

    expect(dbDeleteCalls[0]).toBe("community_posts");
    const postsDeleteWhere = dbDeleteWhereCalls[0] as Record<string, unknown>;
    expect(postsDeleteWhere).toEqual({
      __op: "inArray",
      col: "posts.threadId",
      vals: [10, 20],
    });
    expect(postsDeleteWhere.vals).not.toEqual([10, 20, 30]);
  });
});

// ===========================================================================
// WHERE-clause guard assertions
//
// These tests verify that the isFlagged = true filter is actually passed to the
// database layer for each bulk-action endpoint. A future refactor that drops the
// guard would break these tests before any data is silently unflagged.
// ===========================================================================

// ---------------------------------------------------------------------------
// Helper: walk a nested and({ __op, args }) / eq / inArray condition tree and
// collect all leaf nodes so assertions can inspect them regardless of nesting.
// ---------------------------------------------------------------------------
function collectConditions(node: unknown): Array<Record<string, unknown>> {
  if (!node || typeof node !== "object") return [];
  const n = node as Record<string, unknown>;
  if (n.__op === "and" && Array.isArray(n.args)) {
    return (n.args as unknown[]).flatMap(collectConditions);
  }
  return [n];
}

describe("WHERE-clause guard — posts/bulk-approve includes isFlagged=true", () => {
  const PATH = "/api/admin/community/flagged/posts/bulk-approve";
  const AUTH = { Authorization: "Bearer valid-admin-token" };
  const TEST_IDS = [10, 20, 30];

  it("passes an and() condition to db.update().set().where()", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    const cond = lastUpdateWhere as Record<string, unknown>;
    expect(cond.__op).toBe("and");
  });

  it("WHERE condition includes inArray on the posts.id column", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    const leaves = collectConditions(lastUpdateWhere);
    const inArrayNode = leaves.find((l) => l.__op === "inArray");
    expect(inArrayNode).toBeDefined();
    expect(inArrayNode!.col).toBe("posts.id");
    expect(inArrayNode!.vals).toEqual(TEST_IDS);
  });

  it("WHERE condition includes eq(isFlagged, true) so non-flagged posts are not touched", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    const leaves = collectConditions(lastUpdateWhere);
    const eqNode = leaves.find((l) => l.__op === "eq" && l.val === true);
    expect(eqNode).toBeDefined();
    expect(eqNode!.col).toBe("posts.isFlagged");
  });
});

describe("WHERE-clause guard — posts/bulk-remove includes isFlagged=true", () => {
  const PATH = "/api/admin/community/flagged/posts/bulk-remove";
  const AUTH = { Authorization: "Bearer valid-admin-token" };
  const TEST_IDS = [11, 22];

  it("passes an and() condition to db.delete().where()", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    expect(dbDeleteWhereCalls.length).toBe(1);
    const cond = dbDeleteWhereCalls[0] as Record<string, unknown>;
    expect(cond.__op).toBe("and");
  });

  it("WHERE condition includes inArray on the posts.id column", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    const leaves = collectConditions(dbDeleteWhereCalls[0]);
    const inArrayNode = leaves.find((l) => l.__op === "inArray");
    expect(inArrayNode).toBeDefined();
    expect(inArrayNode!.col).toBe("posts.id");
    expect(inArrayNode!.vals).toEqual(TEST_IDS);
  });

  it("WHERE condition includes eq(isFlagged, true) so non-flagged posts are not deleted", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    const leaves = collectConditions(dbDeleteWhereCalls[0]);
    const eqNode = leaves.find((l) => l.__op === "eq" && l.val === true);
    expect(eqNode).toBeDefined();
    expect(eqNode!.col).toBe("posts.isFlagged");
  });

  // -------------------------------------------------------------------------
  // Dedicated regression guard (see threads/bulk-remove's "not the raw ids"
  // test above). posts/bulk-remove has no separate DB-confirm select step —
  // it relies on a single delete whose WHERE clause combines inArray(ids)
  // with eq(isFlagged, true) so the database itself excludes non-flagged
  // posts. A future refactor could weaken this in two ways: (a) dropping the
  // isFlagged condition and collapsing the WHERE down to a bare inArray on
  // the raw ids, or (b) passing the raw, unparsed request body ids (which may
  // include non-numeric entries) instead of the filtered numericIds. This
  // test pins both: the AND must survive, and inArray must only ever see the
  // parsed numeric ids — never the raw supplied array.
  // -------------------------------------------------------------------------
  it("scopes the delete to parsed numeric ids ANDed with isFlagged=true, not the raw supplied ids array", async () => {
    await request(app)
      .post(PATH)
      .set(AUTH)
      .send({ ids: [11, "not-a-flagged-post", 22, 33] });

    expect(dbDeleteWhereCalls.length).toBe(1);
    const cond = dbDeleteWhereCalls[0] as Record<string, unknown>;
    expect(cond.__op).toBe("and");

    const leaves = collectConditions(cond);
    const inArrayNode = leaves.find((l) => l.__op === "inArray");
    const eqFlaggedNode = leaves.find(
      (l) => l.__op === "eq" && l.col === "posts.isFlagged",
    );

    expect(inArrayNode).toBeDefined();
    expect(eqFlaggedNode).toBeDefined();
    expect(eqFlaggedNode!.val).toBe(true);

    expect(inArrayNode!.vals).toEqual([11, 22, 33]);
    expect(inArrayNode!.vals).not.toEqual([11, "not-a-flagged-post", 22, 33]);
  });
});

describe("WHERE-clause guard — threads/bulk-approve includes isFlagged=true", () => {
  const PATH = "/api/admin/community/flagged/threads/bulk-approve";
  const AUTH = { Authorization: "Bearer valid-admin-token" };
  const TEST_IDS = [100, 200];

  it("passes an and() condition to db.update().set().where()", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    const cond = lastUpdateWhere as Record<string, unknown>;
    expect(cond.__op).toBe("and");
  });

  it("WHERE condition includes inArray on the threads.id column", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    const leaves = collectConditions(lastUpdateWhere);
    const inArrayNode = leaves.find((l) => l.__op === "inArray");
    expect(inArrayNode).toBeDefined();
    expect(inArrayNode!.col).toBe("threads.id");
    expect(inArrayNode!.vals).toEqual(TEST_IDS);
  });

  it("WHERE condition includes eq(isFlagged, true) so non-flagged threads are not touched", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    const leaves = collectConditions(lastUpdateWhere);
    const eqNode = leaves.find((l) => l.__op === "eq" && l.val === true);
    expect(eqNode).toBeDefined();
    expect(eqNode!.col).toBe("threads.isFlagged");
  });
});

describe("WHERE-clause guard — threads/bulk-remove SELECT includes isFlagged=true", () => {
  const PATH = "/api/admin/community/flagged/threads/bulk-remove";
  const AUTH = { Authorization: "Bearer valid-admin-token" };
  const TEST_IDS = [10, 20];

  beforeEach(() => {
    mockSelectResult = [{ id: 10 }, { id: 20 }];
  });

  it("passes an and() condition to db.select().from().where()", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    const cond = lastSelectWhere as Record<string, unknown>;
    expect(cond.__op).toBe("and");
  });

  it("SELECT WHERE condition includes inArray on the threads.id column", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    const leaves = collectConditions(lastSelectWhere);
    const inArrayNode = leaves.find((l) => l.__op === "inArray");
    expect(inArrayNode).toBeDefined();
    expect(inArrayNode!.col).toBe("threads.id");
    expect(inArrayNode!.vals).toEqual(TEST_IDS);
  });

  it("SELECT WHERE condition includes eq(isFlagged, true) so non-flagged threads are not deleted", async () => {
    await request(app).post(PATH).set(AUTH).send({ ids: TEST_IDS });
    const leaves = collectConditions(lastSelectWhere);
    const eqNode = leaves.find((l) => l.__op === "eq" && l.val === true);
    expect(eqNode).toBeDefined();
    expect(eqNode!.col).toBe("threads.isFlagged");
  });
});

// ===========================================================================
// Audit-log failure — all four bulk endpoints must return 500
// ===========================================================================

describe("Bulk-action audit-log failure — createAuditLog throws → 500", () => {
  const AUTH = { Authorization: "Bearer valid-admin-token" };

  beforeEach(() => {
    vi.mocked(storage.createAuditLog).mockResolvedValue({ id: 1 } as any);
  });

  it("posts/bulk-approve returns 500 when createAuditLog throws", async () => {
    vi.mocked(storage.createAuditLog).mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app)
      .post("/api/admin/community/flagged/posts/bulk-approve")
      .set(AUTH)
      .send({ ids: [1, 2] });
    expect(res.status).toBe(500);
  });

  it("posts/bulk-remove returns 500 when createAuditLog throws", async () => {
    vi.mocked(storage.createAuditLog).mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app)
      .post("/api/admin/community/flagged/posts/bulk-remove")
      .set(AUTH)
      .send({ ids: [1, 2] });
    expect(res.status).toBe(500);
  });

  it("threads/bulk-approve returns 500 when createAuditLog throws", async () => {
    vi.mocked(storage.createAuditLog).mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app)
      .post("/api/admin/community/flagged/threads/bulk-approve")
      .set(AUTH)
      .send({ ids: [1, 2] });
    expect(res.status).toBe(500);
  });

  it("threads/bulk-remove returns 500 when createAuditLog throws", async () => {
    mockSelectResult = [{ id: 1 }, { id: 2 }];
    vi.mocked(storage.createAuditLog).mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app)
      .post("/api/admin/community/flagged/threads/bulk-remove")
      .set(AUTH)
      .send({ ids: [1, 2] });
    expect(res.status).toBe(500);
  });
});

// ===========================================================================
// Audit-log fields — success path verifies action, targetType, targetId, count
// ===========================================================================

describe("Bulk-action audit-log fields — success path", () => {
  const AUTH = { Authorization: "Bearer valid-admin-token" };

  beforeEach(() => {
    vi.mocked(storage.createAuditLog).mockClear();
    vi.mocked(storage.createAuditLog).mockResolvedValue({ id: 1 } as any);
  });

  it("posts/bulk-approve logs correct action, targetType, targetId, and count", async () => {
    await request(app)
      .post("/api/admin/community/flagged/posts/bulk-approve")
      .set(AUTH)
      .send({ ids: [10, 20, 30] });
    const call = vi.mocked(storage.createAuditLog).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: "community_flagged_posts_bulk_approved",
      targetType: "community_post",
      targetId: "10,20,30",
    });
    expect(JSON.parse(call.newValue ?? "{}")).toMatchObject({ count: 3 });
  });

  it("posts/bulk-remove logs correct action, targetType, targetId, and count", async () => {
    await request(app)
      .post("/api/admin/community/flagged/posts/bulk-remove")
      .set(AUTH)
      .send({ ids: [5, 15] });
    const call = vi.mocked(storage.createAuditLog).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: "community_flagged_posts_bulk_removed",
      targetType: "community_post",
      targetId: "5,15",
    });
    expect(JSON.parse(call.newValue ?? "{}")).toMatchObject({ count: 2 });
  });

  it("threads/bulk-approve logs correct action, targetType, targetId, and count", async () => {
    await request(app)
      .post("/api/admin/community/flagged/threads/bulk-approve")
      .set(AUTH)
      .send({ ids: [100, 200] });
    const call = vi.mocked(storage.createAuditLog).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: "community_flagged_threads_bulk_approved",
      targetType: "community_thread",
      targetId: "100,200",
    });
    expect(JSON.parse(call.newValue ?? "{}")).toMatchObject({ count: 2 });
  });

  it("threads/bulk-remove logs correct action, targetType, confirmedIds, and count", async () => {
    mockSelectResult = [{ id: 10 }, { id: 20 }];
    await request(app)
      .post("/api/admin/community/flagged/threads/bulk-remove")
      .set(AUTH)
      .send({ ids: [10, 20, 30] });
    const call = vi.mocked(storage.createAuditLog).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: "community_flagged_threads_bulk_removed",
      targetType: "community_thread",
      targetId: "10,20",
    });
    expect(JSON.parse(call.newValue ?? "{}")).toMatchObject({ count: 2 });
  });
});

// ===========================================================================
// Single-item audit-log failure — the four non-bulk endpoints must also
// return 500 (not 200) when createAuditLog throws, matching the bulk
// endpoints' behavior.
// ===========================================================================

describe("Single-item audit-log failure — createAuditLog throws → 500", () => {
  const AUTH = { Authorization: "Bearer valid-admin-token" };

  beforeEach(() => {
    vi.mocked(storage.createAuditLog).mockReset();
    mockUpdateReturningResult = [{ id: 1, isFlagged: false, flagReason: null }];
    mockDeleteReturningResult = [{ id: 1, isFlagged: true, flagReason: "spam" }];
    mockSelectResult = [{ id: 1 }];
  });

  it("posts/:id/approve returns 500 when createAuditLog throws", async () => {
    vi.mocked(storage.createAuditLog).mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app)
      .post("/api/admin/community/flagged/posts/1/approve")
      .set(AUTH)
      .send({});
    expect(res.status).toBe(500);
  });

  it("posts/:id/remove returns 500 when createAuditLog throws", async () => {
    vi.mocked(storage.createAuditLog).mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app)
      .post("/api/admin/community/flagged/posts/1/remove")
      .set(AUTH)
      .send({});
    expect(res.status).toBe(500);
  });

  it("threads/:id/approve returns 500 when createAuditLog throws", async () => {
    vi.mocked(storage.createAuditLog).mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app)
      .post("/api/admin/community/flagged/threads/1/approve")
      .set(AUTH)
      .send({});
    expect(res.status).toBe(500);
  });

  it("threads/:id/remove returns 500 when createAuditLog throws", async () => {
    vi.mocked(storage.createAuditLog).mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app)
      .post("/api/admin/community/flagged/threads/1/remove")
      .set(AUTH)
      .send({});
    expect(res.status).toBe(500);
  });
});

// ===========================================================================
// Single-item audit-log fields — success path verifies action, targetType,
// targetId for each of the four non-bulk endpoints.
// ===========================================================================

describe("Single-item audit-log fields — success path", () => {
  const AUTH = { Authorization: "Bearer valid-admin-token" };

  beforeEach(() => {
    vi.mocked(storage.createAuditLog).mockReset();
    vi.mocked(storage.createAuditLog).mockResolvedValue({ id: 1 } as any);
    mockUpdateReturningResult = [{ id: 42, isFlagged: false, flagReason: null }];
    mockDeleteReturningResult = [{ id: 42, isFlagged: true, flagReason: "spam" }];
    mockSelectResult = [{ id: 42 }];
  });

  it("posts/:id/approve logs correct action, targetType, and targetId", async () => {
    await request(app)
      .post("/api/admin/community/flagged/posts/42/approve")
      .set(AUTH)
      .send({});
    const call = vi.mocked(storage.createAuditLog).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: "community_flagged_post_approved",
      targetType: "community_post",
      targetId: "42",
    });
  });

  it("posts/:id/remove logs correct action, targetType, and targetId", async () => {
    await request(app)
      .post("/api/admin/community/flagged/posts/42/remove")
      .set(AUTH)
      .send({});
    const call = vi.mocked(storage.createAuditLog).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: "community_flagged_post_removed",
      targetType: "community_post",
      targetId: "42",
    });
  });

  it("threads/:id/approve logs correct action, targetType, and targetId", async () => {
    await request(app)
      .post("/api/admin/community/flagged/threads/42/approve")
      .set(AUTH)
      .send({});
    const call = vi.mocked(storage.createAuditLog).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: "community_flagged_thread_approved",
      targetType: "community_thread",
      targetId: "42",
    });
  });

  it("threads/:id/remove logs correct action, targetType, and targetId", async () => {
    await request(app)
      .post("/api/admin/community/flagged/threads/42/remove")
      .set(AUTH)
      .send({});
    const call = vi.mocked(storage.createAuditLog).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: "community_flagged_thread_removed",
      targetType: "community_thread",
      targetId: "42",
    });
  });
});
