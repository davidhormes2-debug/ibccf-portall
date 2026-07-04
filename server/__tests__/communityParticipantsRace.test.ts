import { describe, it, expect, beforeEach, vi } from "vitest";
import type { communityParticipants as CommunityParticipantsTable } from "@shared/schema";
import express from "express";
import request from "supertest";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// The mock below hand-rolls the communityParticipants.caseId column that
// getOrCreateParticipantForSession references for ON CONFLICT targeting. This
// Pick<> declaration ensures that if the column is renamed in shared/schema.ts,
// TypeScript reports an error here at `npm run check` time so the mock can
// never silently drift.
//
// Columns asserted: caseId
declare const _communityParticipantsGuard: Pick<
  typeof CommunityParticipantsTable,
  "caseId"
>;

// ---- In-memory "Postgres" with a unique-on-case_id index ------------------
//
// The point of this test is to prove that two simultaneous first-time
// community requests for the same case can never produce two
// community_participants rows. The production code (server/routes/community.ts)
// relies on a unique index on community_participants.case_id
// (migration 0012) plus ON CONFLICT DO NOTHING. We mirror that constraint here
// so the test fails loudly if either the index or the upsert is removed.

type Row = { id: number; caseId: string | null; anonymousHandle: string };
const store: Row[] = [];
let nextId = 1;

function uniqueViolation(caseId: string | null | undefined): boolean {
  if (caseId === null || caseId === undefined) return false;
  return store.some((r) => r.caseId === caseId);
}

// Drizzle's fluent insert/select API, just enough to back the helper we test.
function makeDbMock() {
  return {
    select() {
      return {
        from() {
          return {
            async where(predicate: (r: Row) => boolean) {
              if (typeof predicate !== "function") return [];
              return store.filter(predicate);
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          return {
            async where() {
              /* no-op for test */
            },
          };
        },
      };
    },
    insert() {
      return {
        values(v: { caseId?: string | null; anonymousHandle?: string }) {
          let conflictTarget: "caseId" | null = null;
          const builder = {
            onConflictDoNothing(opts: { target: "caseId" }) {
              conflictTarget = opts.target;
              return builder;
            },
            async returning() {
              // Simulate the race window: the in-memory check below is
              // logically what Postgres does when evaluating the
              // unique index. With ON CONFLICT DO NOTHING the duplicate
              // INSERT becomes a no-op (returns []).
              if (uniqueViolation(v.caseId)) {
                if (conflictTarget === "caseId") return [];
                throw new Error("duplicate key value violates unique constraint");
              }
              const row: Row = { id: nextId++, caseId: null, ...v } as Row;
              store.push(row);
              return [row];
            },
          };
          return builder;
        },
      };
    },
  };
}

// Lightweight stand-ins for the drizzle column refs the helper references.
vi.mock("@shared/schema", () => ({
  communityParticipants: { caseId: "caseId" as const },
  communityThreads: {},
  communityPosts: {},
  communityReactions: {},
  botProfiles: {},
  departments: {},
}));

// Spread the real drizzle-orm exports so new operators used in community.ts
// never break this test with a "No X export is defined on the mock" error.
// `eq` is overridden to return an in-memory predicate the db mock filters with.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const eq = (_col: unknown, value: string | null) => (r: Row) => r.caseId === value;
  return {
    ...actual,
    eq,
  };
});

const dbMock = makeDbMock();
vi.mock("../db", () => ({ db: dbMock }));

const validatePortalSession = vi.fn(async (_token: string) => ({
  caseId: "case-123",
  accessCode: "CODE-123",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 86400_000),
}));
vi.mock("../services/portal-auth", () => ({ validatePortalSession }));

vi.mock("../services/bot-response-generator", () => ({
  scheduleResponsesForThread: vi.fn(async () => undefined),
}));

vi.mock("./middleware", () => ({
  isValidAdminToken: vi.fn(async () => false),
}));

// ---- Tests ----------------------------------------------------------------

describe("community participants: cross-instance race", () => {
  beforeEach(() => {
    store.length = 0;
    nextId = 1;
    validatePortalSession.mockClear();
  });

  it("produces exactly one participant row for two concurrent first-time requests", async () => {
    // Re-import after mocks are in place so the helper picks up our fakes.
    vi.resetModules();
    const { communityRouter } = await import("../routes/community");

    const app = express();
    app.use(express.json());
    app.use("/api/community", communityRouter);

    // Two concurrent POST /threads from the same case — what would happen if
    // a load balancer routed the user's first two community clicks to two
    // different app instances at the same instant.
    const fire = () =>
      request(app)
        .post("/api/community/threads")
        .set("x-portal-session-token", "tok-abc")
        .send({
          departmentId: 1,
          title: "hello",
          content: "world",
        });

    const [resA, resB] = await Promise.all([fire(), fire()]);

    expect([resA.status, resB.status]).toEqual(expect.arrayContaining([201, 201]));

    const rowsForCase = store.filter((r) => r.caseId === "case-123");
    expect(rowsForCase).toHaveLength(1);

    // And both requests must surface the same anonymous handle to the user.
    expect(resA.body.authorHandle).toBe(resB.body.authorHandle);
    expect(resA.body.authorHandle).toBe(rowsForCase[0].anonymousHandle);
  });
});
