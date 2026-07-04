import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  cases as CasesTable,
  communityParticipants as CommunityParticipantsTable,
  communityThreads as CommunityThreadsTable,
  communityPosts as CommunityPostsTable,
} from "@shared/schema";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// The mocks below hand-roll columns for the tables that community.ts and
// portal-auth.ts reference. These Pick<> declarations ensure that if any of
// those column names are renamed in shared/schema.ts, TypeScript reports an
// error here at `npm run check` time so the mocks can never silently drift.
//
// cases columns asserted: id, isDisabled, forceLogoutAt, accessCode
declare const _casesGuard: Pick<
  typeof CasesTable,
  "id" | "isDisabled" | "forceLogoutAt" | "accessCode"
>;
// communityParticipants columns asserted: caseId, id, postCount
declare const _communityParticipantsGuard: Pick<
  typeof CommunityParticipantsTable,
  "caseId" | "id" | "postCount"
>;
// communityThreads columns asserted: id, isLocked, replyCount, authorHandle, authorType, lastActivityAt
declare const _communityThreadsGuard: Pick<
  typeof CommunityThreadsTable,
  "id" | "isLocked" | "replyCount" | "authorHandle" | "authorType" | "lastActivityAt"
>;
// communityPosts columns asserted: threadId, authorHandle, authorType, isHidden, createdAt
declare const _communityPostsGuard: Pick<
  typeof CommunityPostsTable,
  "threadId" | "authorHandle" | "authorType" | "isHidden" | "createdAt"
>;

// ============================================================================
// Session revocation after access-code rotation — community write routes
//
// isCaseSessionRevoked() in portal-auth.ts compares the accessCode stored in
// the portal session against cases.accessCode in the DB. When an admin
// reissues a key (rotating the access code) the old session token must be
// rejected immediately on any subsequent request. These tests verify that
// POST /api/community/threads/:id/posts enforces this via
// validatePortalSession (called inside getOrCreateParticipantForSession).
//
// The real portal-auth middleware is used (not mocked) so the full revocation
// path — createSession → validateSession → isCaseSessionRevoked — is
// exercised.
//
// NOTE: The existing communitySessionRevocation.test.ts covers the same
// routes but mocks validatePortalSession directly; this file tests the
// deeper path through the real DB-backed revocation check.
// ============================================================================

// Symbol used by the Drizzle DB mock to dispatch table-specific selects.
const DRIZZLE_NAME = Symbol.for("drizzle:BaseName");

// Configurable DB case row shared by isCaseSessionRevoked (reads
// isDisabled / forceLogoutAt / accessCode).
let dbCaseRow: {
  isDisabled: boolean;
  forceLogoutAt: Date | null;
  accessCode: string;
} = {
  isDisabled: false,
  forceLogoutAt: null,
  accessCode: "ORIGINAL-CODE",
};

// A locked=false thread used by the thread-existence check in the post route.
const MOCK_THREAD = { id: 77, isLocked: false, replyCount: "0" };
// A mock participant so getOrCreateParticipantForSession succeeds on the
// happy-path test.
const MOCK_PARTICIPANT = {
  id: 1,
  caseId: "case-community-rotation-test",
  anonymousHandle: "Member #TSTXX",
  postCount: "0",
};

// Mock @shared/schema — only the fields that community.ts and portal-auth.ts
// actually reference.
vi.mock("@shared/schema", () => ({
  cases: {
    [DRIZZLE_NAME]: "cases",
    id: "id",
    isDisabled: "isDisabled",
    forceLogoutAt: "forceLogoutAt",
    accessCode: "accessCode",
  },
  communityParticipants: {
    [DRIZZLE_NAME]: "community_participants",
    caseId: "caseId",
    id: "id",
    authorHandle: "authorHandle",
    authorType: "authorType",
    postCount: "postCount",
  },
  communityThreads: {
    [DRIZZLE_NAME]: "community_threads",
    id: "id",
    isLocked: "isLocked",
    replyCount: "replyCount",
    authorHandle: "authorHandle",
    authorType: "authorType",
    lastActivityAt: "lastActivityAt",
  },
  communityPosts: {
    [DRIZZLE_NAME]: "community_posts",
    threadId: "threadId",
    authorHandle: "authorHandle",
    authorType: "authorType",
    isHidden: "isHidden",
    createdAt: "createdAt",
  },
  communityReactions: { [DRIZZLE_NAME]: "community_reactions" },
  botProfiles: { [DRIZZLE_NAME]: "bot_profiles" },
  departments: { [DRIZZLE_NAME]: "departments" },
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
          const name: string = table?.[DRIZZLE_NAME] ?? "";
          if (name === "cases") {
            return dbCaseRow ? [dbCaseRow] : [];
          }
          if (name === "community_threads") {
            if (pred?.__eq === MOCK_THREAD.id) return [MOCK_THREAD];
            return [];
          }
          if (name === "community_participants") {
            return [MOCK_PARTICIPANT];
          }
          return [];
        },
        orderBy: () => ({ limit: () => ({ offset: async () => [] }) }),
        leftJoin: () => ({ where: async () => [] }),
      }),
    }),
    insert: (table: any) => ({
      values: (data: any) => {
        const name: string = table?.[DRIZZLE_NAME] ?? "";
        const builder = {
          onConflictDoNothing: () => builder,
          returning: async () => {
            if (name === "community_posts") return [{ id: 999, ...data }];
            return [];
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

// In-memory stand-in for the portal_sessions Postgres table.
const portalSessionStore = new Map<string, any>();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async () => null),
    updateAdminSessionActivity: vi.fn(async () => {}),
    createPortalSession: vi.fn(async (data: any) => {
      const row = { ...data, createdAt: new Date() };
      portalSessionStore.set(data.token, row);
      return row;
    }),
    getPortalSession: vi.fn(async (token: string) =>
      portalSessionStore.get(token) ?? null,
    ),
    deletePortalSession: vi.fn(async (token: string) => {
      portalSessionStore.delete(token);
    }),
    deletePortalSessionsByCaseId: vi.fn(async () => 0),
    deleteExpiredPortalSessions: vi.fn(async () => 0),
  }),
}));

vi.mock("../services/bot-response-generator", () => ({
  scheduleResponsesForThread: vi.fn(async () => undefined),
}));

// middleware.isValidAdminToken must return false so requests fall through to
// the portal-session branch.
vi.mock("./middleware", () => ({
  isValidAdminToken: vi.fn(async () => false),
}));

const { communityRouter } = await import("../routes/community");
const { createSession } = await import("../services/session-store");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/community", communityRouter);
  return app;
}

const app = buildApp();

const CASE_ID = "case-community-rotation-test";
const ORIGINAL_CODE = "ORIGINAL-CODE";
const NEW_CODE = "ROTATED-CODE";
const THREAD_ID = MOCK_THREAD.id;

beforeEach(() => {
  dbCaseRow = { isDisabled: false, forceLogoutAt: null, accessCode: ORIGINAL_CODE };
  portalSessionStore.clear();
});

describe(
  "POST /api/community/threads/:id/posts — session revocation after access-code rotation",
  () => {
    it(
      "returns 401 when a session minted before code rotation is used after the code is rotated",
      async () => {
        const staleToken = await createSession(CASE_ID, ORIGINAL_CODE);

        // Admin rotates the access code.
        dbCaseRow = { ...dbCaseRow, accessCode: NEW_CODE };

        const res = await request(app)
          .post(`/api/community/threads/${THREAD_ID}/posts`)
          .set("x-portal-session-token", staleToken)
          .send({ content: "Hello from stale session" });

        expect(res.status).toBe(401);
      },
    );

    it(
      "returns 201 when a freshly-minted session (with the new code) is used after code rotation",
      async () => {
        // Admin has already rotated the access code.
        dbCaseRow = { ...dbCaseRow, accessCode: NEW_CODE };

        const freshToken = await createSession(CASE_ID, NEW_CODE);

        const res = await request(app)
          .post(`/api/community/threads/${THREAD_ID}/posts`)
          .set("x-portal-session-token", freshToken)
          .send({ content: "Hello from fresh session" });

        expect(res.status).toBe(201);
      },
    );
  },
);
