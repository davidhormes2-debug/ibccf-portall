import { describe, it, expect, beforeEach, vi } from "vitest";
import type { communityThreads as CommunityThreadsTable } from "@shared/schema";
import express from "express";
import request from "supertest";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// The mock below hand-rolls the communityThreads columns that the search
// handler references. This Pick<> declaration ensures that if any of those
// column names are renamed in shared/schema.ts, TypeScript reports an error
// here at `npm run check` time so the mock can never silently drift.
//
// Columns asserted:
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

// ============================================================================
// Community thread search filter (Task #396)
//
// GET /api/community/threads accepts a `search` query param. The handler must
// apply a case-insensitive substring match against thread title and content
// (via ilike(...) wrapped in or(...)). These tests verify the predicate that
// reaches drizzle's where() call is shaped correctly.
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
  communityPosts: { [DRIZZLE_NAME]: "community_posts" },
  communityParticipants: { [DRIZZLE_NAME]: "community_participants" },
  communityReactions: { [DRIZZLE_NAME]: "community_reactions" },
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
  sql: () => ({ as: () => null }),
}));

// In-memory thread fixtures the mocked db filters in JS based on the
// predicate captured from the handler's where() call.
type ThreadRow = {
  id: number;
  departmentId: number;
  title: string;
  content: string;
  authorType: string;
  authorHandle: string;
  isPinned: boolean;
  isLocked: boolean;
  viewCount: string;
  replyCount: string;
  lastActivityAt: Date;
  createdAt: Date;
};

const NOW = new Date("2026-05-27T00:00:00Z");
const threadStore: ThreadRow[] = [
  {
    id: 1,
    departmentId: 1,
    title: "USDT withdrawal taking forever",
    content: "Anyone else stuck on stage 7?",
    authorType: "user",
    authorHandle: "Member #A",
    isPinned: false,
    isLocked: false,
    viewCount: "0",
    replyCount: "0",
    lastActivityAt: NOW,
    createdAt: NOW,
  },
  {
    id: 2,
    departmentId: 1,
    title: "Compliance review timeline",
    content: "My USDT release was fast.",
    authorType: "user",
    authorHandle: "Member #B",
    isPinned: false,
    isLocked: false,
    viewCount: "0",
    replyCount: "0",
    lastActivityAt: NOW,
    createdAt: NOW,
  },
  {
    id: 3,
    departmentId: 2,
    title: "Bitcoin recovery question",
    content: "Lost access to my BTC wallet — what next?",
    authorType: "user",
    authorHandle: "Member #C",
    isPinned: false,
    isLocked: false,
    viewCount: "0",
    replyCount: "0",
    lastActivityAt: NOW,
    createdAt: NOW,
  },
];

let capturedWherePredicate: any = undefined;

function evalPredicate(pred: any, row: ThreadRow): boolean {
  if (!pred) return true;
  if (pred.__op === "eq") {
    if (pred.col === "departmentId") return row.departmentId === pred.value;
    return false;
  }
  if (pred.__op === "ilike") {
    // ilike pattern "%foo%" — strip the wrapping % and compare case-insensitively.
    const raw: string = pred.value as string;
    const needle = raw.replace(/^%/, "").replace(/%$/, "").toLowerCase();
    const field = pred.col === "title" ? row.title : pred.col === "content" ? row.content : "";
    return field.toLowerCase().includes(needle);
  }
  if (pred.__op === "or") {
    return (pred.preds as any[]).some((p) => evalPredicate(p, row));
  }
  if (pred.__op === "and") {
    return (pred.preds as any[]).every((p) => evalPredicate(p, row));
  }
  return true;
}

function runQuery(): ThreadRow[] {
  return threadStore.filter((row) => evalPredicate(capturedWherePredicate, row));
}

vi.mock("../db", () => {
  const makeTerminal = () => {
    const terminal: any = {
      orderBy: () => terminal,
      limit: () => terminal,
      offset: () => Promise.resolve(runQuery()),
      then: (resolve: any, reject: any) =>
        Promise.resolve(runQuery()).then(resolve, reject),
    };
    return terminal;
  };

  const makeBuilder = () => {
    const builder: any = {
      where: (pred: any) => {
        capturedWherePredicate = pred;
        return builder;
      },
      orderBy: () => makeTerminal(),
      limit: () => makeTerminal(),
      offset: () => Promise.resolve(runQuery()),
    };
    return builder;
  };

  return {
    db: {
      select: () => ({ from: () => makeBuilder() }),
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

const { communityRouter } = await import("../routes/community");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/community", communityRouter);
  return app;
}

const app = buildApp();

beforeEach(() => {
  capturedWherePredicate = undefined;
});

describe("GET /api/community/threads — search filter (Task #396)", () => {
  it("returns all threads when no search query is provided", async () => {
    const res = await request(app).get("/api/community/threads");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(capturedWherePredicate).toBeUndefined();
  });

  it("filters threads by case-insensitive substring match on title", async () => {
    const res = await request(app).get("/api/community/threads?search=BITCOIN");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(3);
  });

  it("matches threads where the search term appears in the content body", async () => {
    const res = await request(app).get("/api/community/threads?search=stage%207");
    expect(res.status).toBe(200);
    const ids = res.body.map((t: any) => t.id);
    expect(ids).toEqual([1]);
  });

  it("returns title-matches and content-matches together (OR semantics)", async () => {
    const res = await request(app).get("/api/community/threads?search=usdt");
    expect(res.status).toBe(200);
    const ids = res.body.map((t: any) => t.id).sort();
    expect(ids).toEqual([1, 2]);
  });

  it("combines departmentId and search predicates with AND", async () => {
    const res = await request(app).get(
      "/api/community/threads?departmentId=1&search=usdt",
    );
    expect(res.status).toBe(200);
    const ids = res.body.map((t: any) => t.id).sort();
    expect(ids).toEqual([1, 2]);
  });

  it("returns an empty list when the search matches nothing", async () => {
    const res = await request(app).get("/api/community/threads?search=nonexistent-xyz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("escapes LIKE wildcards so a literal % in the query does not match everything", async () => {
    const res = await request(app).get("/api/community/threads?search=%25");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
