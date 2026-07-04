import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// Validation-Leak Tests — community write routes
//
// The community write routes validate content manually (auth check, content-length
// cap, required-field guards on admin paths). No Zod is used directly in the
// route handlers, but the pattern must hold: every error response carries a
// plain string `error` field and never exposes ZodError internals, raw exception
// details, or any structured validation metadata.
//
// Test surface:
//   POST /api/community/threads                — thread creation (portal + admin)
//   POST /api/community/threads/:id/posts      — reply creation (portal + admin)
//   POST /api/community/posts/:id/react        — reaction (portal + admin)
//   POST /api/community/participants           — participant upsert (portal + admin)
//   PATCH /api/community/threads/:id           — pin/lock update (admin only)
// ============================================================================

// Stable admin token used throughout the admin-path body-validation tests.
const VALID_ADMIN_TOKEN = "valid-admin-token";
const ADMIN_USERNAME = "community-zodleak-test-admin";

let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = ADMIN_USERNAME;
});
afterAll(() => {
  if (savedAdminUsername === undefined) {
    delete process.env.ADMIN_USERNAME;
  } else {
    process.env.ADMIN_USERNAME = savedAdminUsername;
  }
});

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
    id: "id",
    threadId: "threadId",
    content: "content",
    authorType: "authorType",
    authorHandle: "authorHandle",
    isHidden: "isHidden",
    createdAt: "createdAt",
  },
  communityParticipants: {
    [DRIZZLE_NAME]: "community_participants",
    id: "id",
    caseId: "caseId",
    anonymousHandle: "anonymousHandle",
    postCount: "postCount",
    departmentId: "departmentId",
  },
  communityReactions: {
    [DRIZZLE_NAME]: "community_reactions",
    id: "id",
    postId: "postId",
    participantId: "participantId",
    reactionType: "reactionType",
  },
  communityThreadViews: {
    [DRIZZLE_NAME]: "community_thread_views",
    id: "id",
    threadId: "threadId",
    ipHash: "ipHash",
    hourBucket: "hourBucket",
    createdAt: "createdAt",
  },
  botProfiles: {
    [DRIZZLE_NAME]: "bot_profiles",
    id: "id",
    handle: "handle",
    isActive: "isActive",
  },
  departments: { [DRIZZLE_NAME]: "departments" },
  adminSessions: {
    [DRIZZLE_NAME]: "admin_sessions",
    id: "id",
    token: "token",
    isActive: "isActive",
    adminUsername: "adminUsername",
    expiresAt: "expiresAt",
    revokedAt: "revokedAt",
  },
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
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ as: () => null }),
}));

// A mock participant returned by getOrCreateParticipantForSession.
const MOCK_PARTICIPANT = {
  id: 1,
  caseId: "case-1",
  anonymousHandle: "Member #ABCDE",
  postCount: "0",
  departmentId: null,
};

// Mutable state that controls what community_reactions queries return.
// Tests that need a pre-existing reaction set this before making the request.
const reactionQueryState = { rows: [] as any[] };

// Mutable state that controls what bot_profiles queries return.
// Tests exercising the bot-profile auth path seed this before making the request.
const botProfileQueryState = { rows: [] as any[] };

// Mutable state that controls what community_participants queries return.
// Defaults to [MOCK_PARTICIPANT] so existing tests are unaffected; set to []
// when a test needs to simulate a bot whose handle has no participant row.
const participantQueryState = { rows: [MOCK_PARTICIPANT] as any[] };

vi.mock("../services/portal-auth", () => ({
  validatePortalSession: vi.fn(async (token: string) => {
    if (token === "valid-token") {
      return { id: "session-1", caseId: "case-1", isActive: true, revokedAt: null };
    }
    return null;
  }),
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async () => true),
}));

// Mock storage so isValidAdminToken (which calls storage.getAdminSessionByToken)
// can be controlled: VALID_ADMIN_TOKEN authenticates as admin; any other value
// is rejected without hitting the real DB.
vi.mock("../storage", () => ({
  storage: {
    getAdminSessionByToken: vi.fn(async (token: string) => {
      if (token === VALID_ADMIN_TOKEN) {
        return {
          id: "admin-session-1",
          token: VALID_ADMIN_TOKEN,
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          adminUsername: ADMIN_USERNAME,
        };
      }
      return undefined;
    }),
    updateAdminSessionActivity: vi.fn(async () => {}),
  },
}));

vi.mock("./middleware", () => ({
  isValidAdminToken: vi.fn(async () => false),
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../services/bot-response-generator", () => ({
  scheduleResponsesForThread: vi.fn(async () => undefined),
}));

vi.mock("../lib/warnOnce", () => ({
  warnOnce: vi.fn(),
}));

// Build a DB mock that supports the query chains needed by the community routes.
// The participant lookup returns MOCK_PARTICIPANT; all other tables return empty.
vi.mock("../db", () => {
  const dbMock = {
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
                  title: "Existing thread",
                  content: "Some content",
                  authorType: "user",
                  authorHandle: "Member #ABCDE",
                  isPinned: false,
                  isLocked: false,
                  viewCount: "0",
                  replyCount: "0",
                  lastActivityAt: new Date(),
                  createdAt: new Date(),
                },
              ]),
          };
        }
        if (name === "community_participants") {
          return {
            where: () => Promise.resolve(participantQueryState.rows),
          };
        }
        if (name === "community_reactions") {
          return {
            where: () => Promise.resolve(reactionQueryState.rows),
          };
        }
        if (name === "bot_profiles") {
          return {
            where: () => Promise.resolve(botProfileQueryState.rows),
          };
        }
        return {
          where: () => Promise.resolve([]),
          orderBy: () => Promise.resolve([]),
        };
      },
    }),

    insert: (_table: any) => ({
      values: (_vals: any) => ({
        returning: () => Promise.resolve([{ id: 99, ...(_vals ?? {}) }]),
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([{ id: 99 }]),
        }),
      }),
    }),

    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),

    delete: () => ({
      where: () => Promise.resolve(),
    }),
  };

  return { db: dbMock };
});

const { communityRouter } = await import("../routes/community");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/community", communityRouter);
  return app;
}

// ── Helper ───────────────────────────────────────────────────────────────────
function assertNoZodLeak(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/ZodError/i);
  expect(text).not.toMatch(/"errors":\s*\[/);
  expect(text).not.toMatch(/"issues":\s*\[/);
  expect(text).not.toMatch(/"path":/);
  expect(text).not.toMatch(/"code":/);
  expect(text).not.toMatch(/"minimum":/);
  expect(text).not.toMatch(/"maximum":/);
  expect(text).not.toMatch(/"expected":/);
  expect(text).not.toMatch(/"received":/);
}

// ── POST /api/community/threads ───────────────────────────────────────────────

describe("POST /api/community/threads — no validation internals leaked on bad input", () => {
  it("returns a plain string error when no auth credentials are supplied", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/threads")
      .send({ title: "My thread", content: "Content" });

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when session token is invalid", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/threads")
      .set("x-portal-session-token", "invalid-token")
      .send({ title: "My thread", content: "Content" });

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when title exceeds the maximum length", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/threads")
      .set("x-portal-session-token", "valid-token")
      .send({ title: "T".repeat(301), content: "Normal content" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when content exceeds the maximum length", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/threads")
      .set("x-portal-session-token", "valid-token")
      .send({ title: "Normal title", content: "C".repeat(10_001) });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── POST /api/community/threads/:id/posts ────────────────────────────────────

describe("POST /api/community/threads/:id/posts — no validation internals leaked on bad input", () => {
  it("returns a plain string error when no auth credentials are supplied", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/threads/42/posts")
      .send({ content: "A reply" });

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when session token is invalid", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/threads/42/posts")
      .set("x-portal-session-token", "invalid-token")
      .send({ content: "A reply" });

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when reply content exceeds the maximum length", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/threads/42/posts")
      .set("x-portal-session-token", "valid-token")
      .send({ content: "R".repeat(10_001) });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── POST /api/community/posts/:id/react ──────────────────────────────────────

describe("POST /api/community/posts/:id/react — no validation internals leaked on bad input", () => {
  it("returns a plain string error when no auth credentials are supplied", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/posts/99/react")
      .send({ reactionType: "like" });

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when the session token is invalid", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/posts/99/react")
      .set("x-portal-session-token", "invalid-token")
      .send({ reactionType: "like" });

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when an empty body is sent without auth", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/posts/99/react")
      .send({});

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when admin omits participantId (body validation path)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/posts/99/react")
      .set("Authorization", `Bearer ${VALID_ADMIN_TOKEN}`)
      .send({ reactionType: "like" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when admin supplies non-numeric participantId (body validation path)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/posts/99/react")
      .set("Authorization", `Bearer ${VALID_ADMIN_TOKEN}`)
      .send({ reactionType: "like", participantId: "not-a-number" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when the authenticated participant has already reacted (duplicate rejection)", async () => {
    // Seed the reaction mock so the DB lookup finds an existing row.
    reactionQueryState.rows = [
      { id: 7, postId: 99, participantId: MOCK_PARTICIPANT.id, reactionType: "like" },
    ];
    try {
      const app = buildApp();
      const res = await request(app)
        .post("/api/community/posts/99/react")
        .set("x-portal-session-token", "valid-token")
        .send({ reactionType: "like" });

      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe("string");
      expect(Array.isArray(res.body.error)).toBe(false);
      assertNoZodLeak(res.body);
    } finally {
      // Always restore to the default empty state so other tests are unaffected.
      reactionQueryState.rows = [];
    }
  });

  it("returns a plain string error when admin re-reacts for an existing participantId (admin duplicate rejection)", async () => {
    // Seed the reaction mock so the DB lookup finds a pre-existing row for the
    // same participantId the admin is about to supply in the request body.
    reactionQueryState.rows = [
      { id: 8, postId: 99, participantId: MOCK_PARTICIPANT.id, reactionType: "like" },
    ];
    try {
      const app = buildApp();
      const res = await request(app)
        .post("/api/community/posts/99/react")
        .set("Authorization", `Bearer ${VALID_ADMIN_TOKEN}`)
        .send({ reactionType: "like", participantId: MOCK_PARTICIPANT.id });

      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe("string");
      expect(Array.isArray(res.body.error)).toBe(false);
      assertNoZodLeak(res.body);
    } finally {
      // Always restore to the default empty state so other tests are unaffected.
      reactionQueryState.rows = [];
    }
  });

  it("returns a plain string error when a bot profile re-reacts (bot-profile duplicate rejection)", async () => {
    // Seed the bot-profile mock so the DB lookup finds bot id 55 with a known handle.
    botProfileQueryState.rows = [
      { id: 55, handle: "Bot #12345", displayName: "Bot User", avatarInitials: "BU", isActive: true },
    ];
    // Seed the reaction mock so the duplicate-check query finds a pre-existing row
    // for the participant that the bot's handle resolves to (MOCK_PARTICIPANT.id).
    reactionQueryState.rows = [
      { id: 9, postId: 99, participantId: MOCK_PARTICIPANT.id, reactionType: "like" },
    ];
    try {
      const app = buildApp();
      const res = await request(app)
        .post("/api/community/posts/99/react")
        .set("Authorization", `Bearer ${VALID_ADMIN_TOKEN}`)
        .send({ reactionType: "like", botProfileId: 55 });

      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe("string");
      expect(Array.isArray(res.body.error)).toBe(false);
      assertNoZodLeak(res.body);
    } finally {
      // Always restore to the default empty state so other tests are unaffected.
      botProfileQueryState.rows = [];
      reactionQueryState.rows = [];
    }
  });

  it("returns a plain string 404 when the botProfileId supplied does not match any bot row (bot-profile not found)", async () => {
    // botProfileQueryState.rows is already [] by default — no bot row exists.
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/posts/99/react")
      .set("Authorization", `Bearer ${VALID_ADMIN_TOKEN}`)
      .send({ reactionType: "like", botProfileId: 9999 });

    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string 400 when an invalid reactionType is supplied (reactionType guard)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/posts/99/react")
      .set("Authorization", `Bearer ${VALID_ADMIN_TOKEN}`)
      .send({ reactionType: "invalid_type", participantId: MOCK_PARTICIPANT.id });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string 400 when the bot profile exists but has no community participant (missing participant guard)", async () => {
    // Seed the bot-profile mock so the route finds bot id 77, but deliberately
    // leave communityParticipants returning [] so the participant-resolution guard
    // fires (line ~497 in community.ts: "No community participant found for this bot profile").
    botProfileQueryState.rows = [
      { id: 77, handle: "Bot #99999", displayName: "Orphan Bot", avatarInitials: "OB", isActive: true },
    ];
    participantQueryState.rows = [];
    try {
      const app = buildApp();
      const res = await request(app)
        .post("/api/community/posts/99/react")
        .set("Authorization", `Bearer ${VALID_ADMIN_TOKEN}`)
        .send({ reactionType: "like", botProfileId: 77 });

      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe("string");
      expect(Array.isArray(res.body.error)).toBe(false);
      assertNoZodLeak(res.body);
    } finally {
      // Restore both states so subsequent tests see the default participant row.
      botProfileQueryState.rows = [];
      participantQueryState.rows = [MOCK_PARTICIPANT];
    }
  });
});

// ── POST /api/community/participants ─────────────────────────────────────────

describe("POST /api/community/participants — no validation internals leaked on bad input", () => {
  it("returns a plain string error when no auth credentials are supplied", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/participants")
      .send({});

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when the session token is invalid", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/participants")
      .set("x-portal-session-token", "invalid-token")
      .send({});

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when admin omits caseId (body validation path)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/participants")
      .set("Authorization", `Bearer ${VALID_ADMIN_TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when admin sends a null caseId (body validation path)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/community/participants")
      .set("Authorization", `Bearer ${VALID_ADMIN_TOKEN}`)
      .send({ caseId: null });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── PATCH /api/community/threads/:id ─────────────────────────────────────────

describe("PATCH /api/community/threads/:id — no validation internals leaked on bad input", () => {
  it("returns a plain string error when admin auth is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/api/community/threads/42")
      .send({ isPinned: true });

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when an invalid bearer token is supplied", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/api/community/threads/42")
      .set("Authorization", "Bearer not-a-valid-admin-token")
      .send({ isLocked: false });

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when a valid admin sends an update for a non-existent thread", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/api/community/threads/99999")
      .set("Authorization", `Bearer ${VALID_ADMIN_TOKEN}`)
      .send({ isPinned: true, isLocked: false });

    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});
