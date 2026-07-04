import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  communityParticipants as CommunityParticipantsTable,
  communityThreads as CommunityThreadsTable,
  communityPosts as CommunityPostsTable,
} from "@shared/schema";
import express from "express";
import request from "supertest";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// The mocks below hand-roll community table columns that the session revocation
// routes reference. These Pick<> declarations ensure that if any of those
// column names are renamed in shared/schema.ts, TypeScript reports an error
// here at `npm run check` time so the mocks can never silently drift.
//
// communityParticipants columns asserted: caseId, id
declare const _communityParticipantsGuard: Pick<
  typeof CommunityParticipantsTable,
  "caseId" | "id"
>;
// communityThreads columns asserted: id, authorHandle, authorType
declare const _communityThreadsGuard: Pick<
  typeof CommunityThreadsTable,
  "id" | "authorHandle" | "authorType"
>;
// communityPosts columns asserted: threadId, authorHandle, authorType
declare const _communityPostsGuard: Pick<
  typeof CommunityPostsTable,
  "threadId" | "authorHandle" | "authorType"
>;

// ============================================================================
// Community Session Revocation Tests (Task #134)
//
// Verifies that community routes enforce DB-backed portal session revocation
// via validatePortalSession(), not just TTL validity. A portal user whose
// session has been revoked (account disabled, force-logout, or access code
// rotation) must receive 401 on community write and read routes, regardless
// of whether the session token is still within its 24-hour TTL.
//
// Routes under test:
//   POST /api/community/threads              — create thread
//   POST /api/community/threads/:id/posts   — reply to thread
//   GET  /api/community/participants/me     — get own handle
//   GET  /api/community/participants/me/posts — own post history
// ============================================================================

// --- In-memory stores -------------------------------------------------------

type ParticipantRow = {
  id: number;
  caseId: string;
  anonymousHandle: string;
  postCount: string;
};
type ThreadRow = { id: number; isLocked: boolean; replyCount: string };

const participantStore: ParticipantRow[] = [];
const threadStore: ThreadRow[] = [];

// Use Drizzle's internal name symbol to dispatch db.select().from(table) to
// the right in-memory store — same pattern as portalAuthHardening tests.
const DRIZZLE_NAME = Symbol.for("drizzle:BaseName");

vi.mock("@shared/schema", () => ({
  communityParticipants: {
    [Symbol.for("drizzle:BaseName")]: "community_participants",
    caseId: "caseId",
    id: "id",
  },
  communityThreads: {
    [Symbol.for("drizzle:BaseName")]: "community_threads",
    id: "id",
    authorHandle: "authorHandle",
    authorType: "authorType",
  },
  communityPosts: {
    [Symbol.for("drizzle:BaseName")]: "community_posts",
    threadId: "threadId",
    authorHandle: "authorHandle",
    authorType: "authorType",
  },
  communityReactions: {},
  botProfiles: {},
  departments: {},
}));

// Spread the real drizzle-orm exports so new operators used in community.ts
// never break this test with a "No X export is defined on the mock" error.
// Only the operators whose return values the in-memory db mock inspects are
// overridden with test-specific sentinels.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (_col: unknown, value: unknown) => ({ __eq: value }),
    and: (...preds: unknown[]) => ({ __and: preds }),
  };
});

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: async (pred: any) => {
          const tableName: string = table?.[DRIZZLE_NAME] ?? "";
          if (tableName === "community_participants") {
            // Support eq by caseId or id
            if (pred?.__eq !== undefined) {
              return participantStore.filter(
                (r) => r.caseId === pred.__eq || r.id === pred.__eq,
              );
            }
          }
          if (tableName === "community_threads") {
            if (pred?.__eq !== undefined) {
              return threadStore.filter((r) => r.id === pred.__eq);
            }
          }
          return [];
        },
        leftJoin: () => ({
          where: async () => [],
        }),
        orderBy: () => ({
          limit: () => ({
            offset: async () => [],
          }),
        }),
      }),
    }),
    insert: (table: any) => ({
      values: (v: any) => {
        const tableName: string = table?.[DRIZZLE_NAME] ?? "";
        const builder = {
          onConflictDoNothing: () => builder,
          async returning() {
            if (tableName === "community_participants") {
              const existing = participantStore.find((r) => r.caseId === v.caseId);
              if (existing) return []; // ON CONFLICT DO NOTHING
              const row: ParticipantRow = {
                id: participantStore.length + 1,
                caseId: v.caseId,
                anonymousHandle: v.anonymousHandle,
                postCount: "0",
              };
              participantStore.push(row);
              return [row];
            }
            if (tableName === "community_threads") {
              const row = { id: threadStore.length + 100, ...v };
              threadStore.push({ id: row.id, isLocked: false, replyCount: "0" });
              return [row];
            }
            // community_posts and others
            return [{ id: 999, ...v }];
          },
        };
        return builder;
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => {},
      }),
    }),
  },
}));

vi.mock("../services/bot-response-generator", () => ({
  scheduleResponsesForThread: vi.fn(async () => undefined),
}));

vi.mock("./middleware", () => ({
  isValidAdminToken: vi.fn(async () => false),
}));

// --- The key mock: validatePortalSession from portal-auth ------------------
const validatePortalSession = vi.fn<
  () => Promise<{
    caseId: string;
    accessCode: string;
    createdAt: Date;
    expiresAt: Date;
  } | null>
>();

vi.mock("../services/portal-auth", () => ({ validatePortalSession }));

// ---------------------------------------------------------------------------

const { communityRouter } = await import("../routes/community");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/community", communityRouter);
  return app;
}

const app = buildApp();

const VALID_SESSION = {
  caseId: "case-revocation-test",
  accessCode: "GOOD-CODE",
  createdAt: new Date(Date.now() - 1_000),
  expiresAt: new Date(Date.now() + 86_400_000),
};

// ---------------------------------------------------------------------------

describe("Community routes — revoked portal sessions are rejected", () => {
  beforeEach(() => {
    participantStore.length = 0;
    threadStore.length = 0;
    validatePortalSession.mockReset();
  });

  // -------------------------------------------------------------------------
  // POST /api/community/threads
  // -------------------------------------------------------------------------

  it("POST /threads — 401 when validatePortalSession returns null (revoked/expired)", async () => {
    validatePortalSession.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/community/threads")
      .set("x-portal-session-token", "stale-token-after-revocation")
      .send({ departmentId: 1, title: "Test thread", content: "Hello" });

    expect(res.status).toBe(401);
  });

  it("POST /threads — 201 when validatePortalSession confirms a valid session", async () => {
    validatePortalSession.mockResolvedValue(VALID_SESSION);

    const res = await request(app)
      .post("/api/community/threads")
      .set("x-portal-session-token", "live-token")
      .send({ departmentId: 1, title: "Test thread", content: "Hello" });

    expect(res.status).toBe(201);
  });

  // -------------------------------------------------------------------------
  // POST /api/community/threads/:id/posts
  //
  // Note: this route checks thread existence before the auth check, so the
  // revocation test pre-seeds a thread to ensure the auth path is reached.
  // -------------------------------------------------------------------------

  it("POST /threads/:id/posts — 401 when validatePortalSession returns null for an existing thread", async () => {
    validatePortalSession.mockResolvedValue(null);
    // Pre-seed a thread so the existence check passes and auth is evaluated.
    threadStore.push({ id: 42, isLocked: false, replyCount: "0" });

    const res = await request(app)
      .post("/api/community/threads/42/posts")
      .set("x-portal-session-token", "stale-token-after-revocation")
      .send({ content: "A reply" });

    expect(res.status).toBe(401);
  });

  it("POST /threads/:id/posts — 201 when session is valid and thread exists", async () => {
    validatePortalSession.mockResolvedValue(VALID_SESSION);
    threadStore.push({ id: 42, isLocked: false, replyCount: "0" });

    const res = await request(app)
      .post("/api/community/threads/42/posts")
      .set("x-portal-session-token", "live-token")
      .send({ content: "A reply" });

    expect(res.status).toBe(201);
  });

  // -------------------------------------------------------------------------
  // GET /api/community/participants/me
  // -------------------------------------------------------------------------

  it("GET /participants/me — 401 when validatePortalSession returns null (revoked)", async () => {
    validatePortalSession.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/community/participants/me")
      .set("x-portal-session-token", "stale-token-after-revocation");

    expect(res.status).toBe(401);
  });

  it("GET /participants/me — 200 with handle when session is valid", async () => {
    validatePortalSession.mockResolvedValue(VALID_SESSION);
    participantStore.push({
      id: 1,
      caseId: VALID_SESSION.caseId,
      anonymousHandle: "Member #A1B2C",
      postCount: "0",
    });

    const res = await request(app)
      .get("/api/community/participants/me")
      .set("x-portal-session-token", "live-token");

    expect(res.status).toBe(200);
    expect(res.body.anonymousHandle).toBe("Member #A1B2C");
  });

  // -------------------------------------------------------------------------
  // GET /api/community/participants/me/posts
  // -------------------------------------------------------------------------

  it("GET /participants/me/posts — 401 when validatePortalSession returns null (revoked)", async () => {
    validatePortalSession.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/community/participants/me/posts")
      .set("x-portal-session-token", "stale-token-after-revocation");

    expect(res.status).toBe(401);
  });

  it("GET /participants/me/posts — 200 when session is valid", async () => {
    validatePortalSession.mockResolvedValue(VALID_SESSION);
    participantStore.push({
      id: 1,
      caseId: VALID_SESSION.caseId,
      anonymousHandle: "Member #A1B2C",
      postCount: "2",
    });

    const res = await request(app)
      .get("/api/community/participants/me/posts")
      .set("x-portal-session-token", "live-token");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
