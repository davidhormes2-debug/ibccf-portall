import { describe, it, expect, vi, beforeEach } from "vitest";
import { invalidateModerationCache, CACHE_TTL_MS } from "../services/communityModeration";

// ============================================================================
// Community moderation cache invalidation — unit tests
//
// These tests verify that `invalidateModerationCache()` causes the next
// `checkContent()` call to re-query the DB so a re-enabled keyword is picked
// up immediately, rather than waiting up to 60 seconds for the TTL to expire.
//
// They also pin the CACHE_TTL_MS constant to 60 000 ms so any silent widening
// of the staleness window is caught before merge.
// ============================================================================

// ---------------------------------------------------------------------------
// Mock the drizzle db module. The mock tracks query counts and returns rows
// controlled by the per-test `mockRows` variable.
// ---------------------------------------------------------------------------
let dbQueryCount = 0;
let mockRows: Array<{ pattern: string; isWildcard: boolean }> = [];

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          dbQueryCount++;
          return mockRows;
        },
      }),
    }),
  },
}));

const { checkContent } = await import("../services/communityModeration");

beforeEach(() => {
  dbQueryCount = 0;
  mockRows = [];
  invalidateModerationCache();
});

// ── 1. Documented staleness window ──────────────────────────────────────────

describe("CACHE_TTL_MS — documented staleness contract", () => {
  it("is exactly 60 000 ms (60 seconds)", () => {
    expect(CACHE_TTL_MS).toBe(60_000);
  });
});

// ── 2. Cache is hot — DB is not re-queried on repeated calls ────────────────

describe("cache hit — DB is not re-queried while cache is valid", () => {
  it("queries the DB exactly once for two consecutive checkContent calls", async () => {
    mockRows = [{ pattern: "scam", isWildcard: false }];

    await checkContent("this is a scam");
    await checkContent("another scam post");

    expect(dbQueryCount).toBe(1);
  });
});

// ── 3. Cache invalidation — re-enabled keyword is picked up immediately ──────

describe("invalidateModerationCache — re-enabled keyword takes effect on next call", () => {
  it("re-queries the DB after invalidation and flags content with the newly-enabled keyword", async () => {
    // Step 1: keyword is disabled — empty active list loaded into cache.
    mockRows = [];
    const before = await checkContent("this is a scam");
    expect(before.flagged).toBe(false);
    expect(dbQueryCount).toBe(1);

    // Step 2: admin re-enables the keyword (simulated by updating mockRows).
    mockRows = [{ pattern: "scam", isWildcard: false }];

    // Step 3: admin PATCH handler calls invalidateModerationCache().
    invalidateModerationCache();

    // Step 4: next checkContent must re-query the DB (dbQueryCount rises to 2)
    // and now flag the content immediately — no 60-second wait.
    const after = await checkContent("this is a scam");
    expect(after.flagged).toBe(true);
    expect(after.matchedPattern).toBe("scam");
    expect(dbQueryCount).toBe(2);
  });

  it("re-queries the DB after invalidation and clears a disabled keyword", async () => {
    // Step 1: keyword is active.
    mockRows = [{ pattern: "fraud", isWildcard: false }];
    const before = await checkContent("report the fraud");
    expect(before.flagged).toBe(true);
    expect(dbQueryCount).toBe(1);

    // Step 2: admin disables the keyword.
    mockRows = [];
    invalidateModerationCache();

    // Step 3: next call must re-query and no longer flag the content.
    const after = await checkContent("report the fraud");
    expect(after.flagged).toBe(false);
    expect(dbQueryCount).toBe(2);
  });

  it("re-queries the DB after invalidation for a wildcard keyword", async () => {
    mockRows = [];
    await checkContent("send bitcoin now");
    expect(dbQueryCount).toBe(1);

    mockRows = [{ pattern: "send*bitcoin*now", isWildcard: true }];
    invalidateModerationCache();

    const result = await checkContent("send all your bitcoin right now");
    expect(result.flagged).toBe(true);
    expect(result.matchedPattern).toBe("send*bitcoin*now");
    expect(dbQueryCount).toBe(2);
  });
});

// ── 4. Multiple invalidations — each one forces a fresh DB fetch ─────────────

describe("invalidateModerationCache — multiple toggles each force a fresh fetch", () => {
  it("queries the DB once per invalidate-then-check cycle", async () => {
    mockRows = [];
    await checkContent("hello");
    expect(dbQueryCount).toBe(1);

    invalidateModerationCache();
    await checkContent("hello");
    expect(dbQueryCount).toBe(2);

    invalidateModerationCache();
    await checkContent("hello");
    expect(dbQueryCount).toBe(3);
  });
});
