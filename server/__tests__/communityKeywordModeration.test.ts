import { describe, it, expect, vi, beforeEach } from "vitest";
import { invalidateModerationCache } from "../services/communityModeration";

// ============================================================================
// Community keyword moderation service — unit tests
//
// Tests cover:
//   1. Clean content passes (no keywords loaded).
//   2. Banned exact-match keyword flags the post.
//   3. Wildcard pattern matches.
//   4. Keyword disabled does not flag.
//   5. Case-insensitive exact matching.
//   6. Wildcard with prefix/suffix.
//   7. Empty content is not flagged.
//   8. Empty keyword list is not flagged.
//   9. DB error falls back gracefully (returns { flagged: false }).
// ============================================================================

// ---------------------------------------------------------------------------
// Mock the drizzle db module so tests run without a real DB connection.
// The mock is re-configurable per-test by reassigning mockRows.
// ---------------------------------------------------------------------------
let mockRows: Array<{ pattern: string; isWildcard: boolean }> = [];
let dbShouldThrow = false;

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (dbShouldThrow) throw new Error("DB connection failed");
          return mockRows;
        },
      }),
    }),
  },
}));

// Re-import after mock is established (top-level await for ESM dynamic import)
const { checkContent } = await import("../services/communityModeration");

beforeEach(() => {
  mockRows = [];
  dbShouldThrow = false;
  // Reset the 60-second cache before each test so stale rows don't bleed.
  invalidateModerationCache();
});

// ── 1. Clean content — empty blocklist ──────────────────────────────────────

describe("checkContent — clean content passes", () => {
  it("returns flagged=false when the blocklist is empty", async () => {
    mockRows = [];
    const result = await checkContent("Hello, this is a perfectly normal post");
    expect(result.flagged).toBe(false);
    expect(result.matchedPattern).toBeUndefined();
  });

  it("returns flagged=false for content that does not match any keyword", async () => {
    mockRows = [{ pattern: "scam", isWildcard: false }];
    const result = await checkContent("I need help with my withdrawal request");
    expect(result.flagged).toBe(false);
  });
});

// ── 2. Banned exact-match keyword flags the post ────────────────────────────

describe("checkContent — exact-match keyword flagging", () => {
  it("flags content containing the banned keyword", async () => {
    mockRows = [{ pattern: "scam", isWildcard: false }];
    const result = await checkContent("This platform is a scam and should be shut down");
    expect(result.flagged).toBe(true);
    expect(result.matchedPattern).toBe("scam");
  });

  it("returns the matched pattern when flagged", async () => {
    mockRows = [{ pattern: "fraud", isWildcard: false }];
    const result = await checkContent("Report fraud immediately");
    expect(result.flagged).toBe(true);
    expect(result.matchedPattern).toBe("fraud");
  });

  it("flags content containing keyword anywhere in the string", async () => {
    mockRows = [{ pattern: "pump", isWildcard: false }];
    const result = await checkContent("pump-and-dump scheme detected");
    expect(result.flagged).toBe(true);
  });
});

// ── 3. Wildcard pattern matches ──────────────────────────────────────────────

describe("checkContent — wildcard pattern matching", () => {
  it("matches a wildcard pattern with * as suffix", async () => {
    mockRows = [{ pattern: "free*money", isWildcard: true }];
    const result = await checkContent("get free easy money now");
    expect(result.flagged).toBe(true);
    expect(result.matchedPattern).toBe("free*money");
  });

  it("matches a wildcard with leading star", async () => {
    mockRows = [{ pattern: "*phishing*", isWildcard: true }];
    const result = await checkContent("avoid phishing attacks");
    expect(result.flagged).toBe(true);
  });

  it("does not flag content that does not match the wildcard pattern", async () => {
    mockRows = [{ pattern: "buy*now*fast", isWildcard: true }];
    const result = await checkContent("please review my document");
    expect(result.flagged).toBe(false);
  });

  it("matches a wildcard spanning multiple words", async () => {
    mockRows = [{ pattern: "send*bitcoin*now", isWildcard: true }];
    const result = await checkContent("please send all your bitcoin right now");
    expect(result.flagged).toBe(true);
  });
});

// ── 4. Keyword disabled does not flag ───────────────────────────────────────

describe("checkContent — disabled keywords are ignored", () => {
  it("does not flag when the only matching keyword is disabled (not in active list)", async () => {
    // The mock only returns ACTIVE patterns. Disabled ones are filtered by the
    // WHERE clause in getActivePatterns(). So an empty mockRows simulates
    // a keyword that exists but is not active.
    mockRows = [];
    const result = await checkContent("scam fraud ponzi scheme");
    expect(result.flagged).toBe(false);
  });
});

// ── 5. Case-insensitive matching ─────────────────────────────────────────────

describe("checkContent — case-insensitive exact matching", () => {
  it("flags an uppercase occurrence of a lowercase pattern", async () => {
    mockRows = [{ pattern: "scam", isWildcard: false }];
    const result = await checkContent("This is a SCAM");
    expect(result.flagged).toBe(true);
  });

  it("flags a mixed-case occurrence", async () => {
    mockRows = [{ pattern: "phishing", isWildcard: false }];
    const result = await checkContent("Phishing attempt detected");
    expect(result.flagged).toBe(true);
  });
});

// ── 6. Empty / blank content ─────────────────────────────────────────────────

describe("checkContent — empty content", () => {
  it("returns flagged=false for an empty string", async () => {
    mockRows = [{ pattern: "scam", isWildcard: false }];
    const result = await checkContent("");
    expect(result.flagged).toBe(false);
  });

  it("returns flagged=false for whitespace-only content", async () => {
    mockRows = [{ pattern: "scam", isWildcard: false }];
    const result = await checkContent("   ");
    expect(result.flagged).toBe(false);
  });
});

// ── 7. DB error fallback ─────────────────────────────────────────────────────

describe("checkContent — DB error graceful fallback", () => {
  it("returns flagged=false when the DB lookup throws", async () => {
    dbShouldThrow = true;
    const result = await checkContent("This content has the keyword scam");
    expect(result.flagged).toBe(false);
  });
});
