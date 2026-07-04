import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// bot-response-generator — moderation column regression guard
//
// A missing `is_flagged`/`flag_reason` column on the live DB (present in
// shared/schema.ts but not applied to the database) previously caused every
// row returned by `db.select().from(communityThreads|communityPosts)` inside
// this service to carry those extra moderation fields, and the community bot
// silently stopped producing replies. There was no coverage that exercised
// the scheduling/delivery pipeline with rows that actually include
// `isFlagged`/`flagReason`, so a future moderation-column change could
// reintroduce the same silent failure without any test catching it.
//
// These tests drive `scheduleResponsesForThread` and `processPendingResponses`
// end-to-end against a mocked `db` where thread/post rows carry
// `isFlagged`/`flagReason` values (including a flagged thread), asserting the
// pipeline completes without throwing and still performs its expected writes.
// ============================================================================

function createChainable(getResult: () => unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy", "limit", "values", "set"]) {
    chain[method] = () => chain;
  }
  chain.returning = () => Promise.resolve(getResult());
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(getResult()).then(resolve, reject);
  chain.catch = (reject: (e: unknown) => unknown) =>
    Promise.resolve(getResult()).catch(reject);
  return chain;
}

let selectQueue: unknown[][] = [];
let insertReturningQueue: unknown[][] = [];
let updateReturningQueue: unknown[][] = [];
const insertedRows: Array<{ table: string; values: unknown }> = [];
const updatedCalls: Array<{ table: string; values: unknown }> = [];

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => createChainable(() => selectQueue.shift() ?? [])),
    insert: vi.fn((table: { __name?: string }) => {
      const chain = createChainable(() => insertReturningQueue.shift() ?? []);
      const originalValues = chain.values as (v: unknown) => unknown;
      chain.values = (v: unknown) => {
        insertedRows.push({ table: String(table), values: v });
        return originalValues(v);
      };
      return chain;
    }),
    update: vi.fn((table: { __name?: string }) => {
      const chain = createChainable(() => updateReturningQueue.shift() ?? []);
      const originalSet = chain.set as (v: unknown) => unknown;
      chain.set = (v: unknown) => {
        updatedCalls.push({ table: String(table), values: v });
        return originalSet(v);
      };
      return chain;
    }),
  },
}));

import {
  scheduleResponsesForThread,
  processPendingResponses,
} from "../services/bot-response-generator";

const FLAGGED_THREAD = {
  id: 1,
  title: "Flagged thread title",
  content: "Flagged thread content",
  isLocked: false,
  isFlagged: true,
  flagReason: "keyword_match: scam",
  replyCount: 2,
};

const CLEAN_THREAD = {
  id: 2,
  title: "Clean thread title",
  content: "Clean thread content",
  isLocked: false,
  isFlagged: false,
  flagReason: null,
  replyCount: 0,
};

const FLAGGED_POST_ROW = {
  id: 5,
  threadId: 1,
  content: "A previously flagged reply",
  isFlagged: true,
  flagReason: "keyword_match: scam",
};

const ACTIVE_BOT = {
  id: 10,
  handle: "recovered_survivor",
  personality: "supportive",
  postCount: "3",
};

beforeEach(() => {
  selectQueue = [];
  insertReturningQueue = [];
  updateReturningQueue = [];
  insertedRows.length = 0;
  updatedCalls.length = 0;
  vi.spyOn(Math, "random").mockReturnValue(0);
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scheduleResponsesForThread — thread/post rows carry isFlagged/flagReason", () => {
  it("does not throw when the target thread is flagged and existing posts are flagged", async () => {
    // Order of db.select() calls inside scheduleResponsesForThread:
    //   1. the thread itself
    //   2. existing posts for the thread
    //   3. community-wide recent posts (for cross-thread dedup)
    //   4. getRandomActiveBot() (Math.random mocked to 0 -> numberOfResponses = 1)
    selectQueue = [
      [FLAGGED_THREAD],
      [FLAGGED_POST_ROW],
      [{ content: FLAGGED_POST_ROW.content }],
      [ACTIVE_BOT],
    ];

    await expect(scheduleResponsesForThread(1)).resolves.not.toThrow();

    expect(insertedRows.length).toBe(1);
    const inserted = insertedRows[0].values as Record<string, unknown>;
    expect(inserted.threadId).toBe(1);
    expect(inserted.status).toBe("pending");
    expect(typeof inserted.content).toBe("string");
  });

  it("does not throw for a clean (unflagged) thread either", async () => {
    selectQueue = [
      [CLEAN_THREAD],
      [],
      [],
      [ACTIVE_BOT],
    ];

    await expect(scheduleResponsesForThread(2)).resolves.not.toThrow();
    expect(insertedRows.length).toBe(1);
  });

  it("does not throw and schedules nothing when the thread lookup is empty (missing row)", async () => {
    selectQueue = [[]];
    await expect(scheduleResponsesForThread(999)).resolves.not.toThrow();
    expect(insertedRows.length).toBe(0);
  });
});

describe("processPendingResponses — delivers a reply into a thread carrying moderation fields", () => {
  it("delivers the pending response without throwing when the thread row includes isFlagged/flagReason", async () => {
    const pendingRow = {
      id: 100,
      threadId: 1,
      botId: ACTIVE_BOT.id,
      content: "queued reply content",
      status: "pending",
      scheduledFor: new Date(0),
    };

    // Order of db.select()/db.update().returning() calls inside processPendingResponses:
    //   1. select pending rows due for delivery
    //   2. update -> claim the row (status pending -> processing), .returning()
    //   3. select the bot by id
    //   4. select the thread by id (carries isFlagged/flagReason)
    //   5. insert the new community post, .returning()
    selectQueue = [[pendingRow], [ACTIVE_BOT], [FLAGGED_THREAD]];
    updateReturningQueue = [[{ ...pendingRow, status: "processing" }]];
    insertReturningQueue = [[{ id: 555, content: pendingRow.content }]];

    await expect(processPendingResponses()).resolves.not.toThrow();

    expect(insertedRows.length).toBe(1);
    const deliveredUpdate = updatedCalls.find(
      (c) => (c.values as Record<string, unknown>).status === "delivered",
    );
    expect(deliveredUpdate).toBeDefined();
  });
});
