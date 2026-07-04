// flagged_csv_export (sentinel — referenced by CI job)
//
// Unit tests for buildFlaggedCsvLines() from client/src/lib/flaggedCsvExport.ts,
// which is the production utility used by the Export CSV button in CommunityManagement.
//
// Coverage:
//   1. The header row contains exactly the expected column names.
//   2. Thread rows carry type="thread"; reply rows carry type="reply".
//   3. Content is truncated at 200 characters.
//   4. Double-quotes inside field values are escaped as "".
//   5. null/undefined flagReason collapses to an empty string.
//   6. Rows from both threads and posts are present in the combined output.

import { describe, it, expect } from "vitest";
import { buildFlaggedCsvLines } from "@/lib/flaggedCsvExport";
import type { FlaggedCsvThread, FlaggedCsvPost } from "@/lib/flaggedCsvExport";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const THREAD: FlaggedCsvThread = {
  id: 1,
  authorHandle: "user_alpha",
  content: "This is a flagged thread",
  flagReason: "spam",
  createdAt: "2026-06-01T10:00:00.000Z",
};

const POST: FlaggedCsvPost = {
  id: 2,
  authorHandle: "user_beta",
  content: "This is a flagged reply",
  flagReason: "keyword_match:bitcoin",
  createdAt: "2026-06-02T11:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildFlaggedCsvLines — header row", () => {
  it("first line contains the six expected column headers", () => {
    const lines = buildFlaggedCsvLines([], []);
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe('"id","type","author","content_preview","flag_reason","date_flagged"');
  });
});

describe("buildFlaggedCsvLines — thread rows", () => {
  it("thread row carries type='thread'", () => {
    const lines = buildFlaggedCsvLines([THREAD], []);
    expect(lines.length).toBe(2);
    const cells = lines[1].split(",");
    expect(cells[1]).toBe('"thread"');
  });

  it("thread row uses id, authorHandle, content, flagReason, createdAt", () => {
    const lines = buildFlaggedCsvLines([THREAD], []);
    const row = lines[1];
    expect(row).toContain('"1"');
    expect(row).toContain('"user_alpha"');
    expect(row).toContain('"This is a flagged thread"');
    expect(row).toContain('"spam"');
    expect(row).toContain('"2026-06-01T10:00:00.000Z"');
  });
});

describe("buildFlaggedCsvLines — post/reply rows", () => {
  it("post row carries type='reply'", () => {
    const lines = buildFlaggedCsvLines([], [POST]);
    expect(lines.length).toBe(2);
    const cells = lines[1].split(",");
    expect(cells[1]).toBe('"reply"');
  });

  it("post row uses id, authorHandle, content, flagReason, createdAt", () => {
    const lines = buildFlaggedCsvLines([], [POST]);
    const row = lines[1];
    expect(row).toContain('"2"');
    expect(row).toContain('"user_beta"');
    expect(row).toContain('"This is a flagged reply"');
    expect(row).toContain('"keyword_match:bitcoin"');
    expect(row).toContain('"2026-06-02T11:00:00.000Z"');
  });
});

describe("buildFlaggedCsvLines — combined output", () => {
  it("thread rows appear before post rows", () => {
    const lines = buildFlaggedCsvLines([THREAD], [POST]);
    expect(lines.length).toBe(3);
    expect(lines[1]).toContain('"thread"');
    expect(lines[2]).toContain('"reply"');
  });

  it("total row count = threads + posts + 1 header", () => {
    const threads: FlaggedCsvThread[] = [THREAD, { ...THREAD, id: 3 }];
    const posts: FlaggedCsvPost[] = [POST, { ...POST, id: 4 }];
    const lines = buildFlaggedCsvLines(threads, posts);
    expect(lines.length).toBe(5);
  });
});

describe("buildFlaggedCsvLines — content truncation", () => {
  it("content longer than 200 chars is truncated at exactly 200", () => {
    const longContent = "A".repeat(250);
    const thread: FlaggedCsvThread = { ...THREAD, content: longContent };
    const lines = buildFlaggedCsvLines([thread], []);
    const row = lines[1];
    const expectedPreview = `"${"A".repeat(200)}"`;
    expect(row).toContain(expectedPreview);
    expect(row).not.toContain(`"${"A".repeat(201)}`);
  });

  it("content exactly 200 chars is not truncated", () => {
    const exactContent = "B".repeat(200);
    const thread: FlaggedCsvThread = { ...THREAD, content: exactContent };
    const lines = buildFlaggedCsvLines([thread], []);
    expect(lines[1]).toContain(`"${"B".repeat(200)}"`);
  });

  it("content shorter than 200 chars is kept as-is", () => {
    const shortContent = "short";
    const thread: FlaggedCsvThread = { ...THREAD, content: shortContent };
    const lines = buildFlaggedCsvLines([thread], []);
    expect(lines[1]).toContain('"short"');
  });
});

describe("buildFlaggedCsvLines — CSV escaping", () => {
  it("double-quotes in a field value are escaped as two double-quotes", () => {
    const thread: FlaggedCsvThread = {
      ...THREAD,
      content: 'He said "hello" to me',
    };
    const lines = buildFlaggedCsvLines([thread], []);
    expect(lines[1]).toContain('"He said ""hello"" to me"');
  });

  it("double-quotes in the authorHandle are escaped", () => {
    const thread: FlaggedCsvThread = {
      ...THREAD,
      authorHandle: 'the "great" admin',
    };
    const lines = buildFlaggedCsvLines([thread], []);
    expect(lines[1]).toContain('"the ""great"" admin"');
  });

  it("double-quotes in flagReason are escaped", () => {
    const thread: FlaggedCsvThread = {
      ...THREAD,
      flagReason: 'matched: "bad word"',
    };
    const lines = buildFlaggedCsvLines([thread], []);
    expect(lines[1]).toContain('"matched: ""bad word"""');
  });
});

describe("buildFlaggedCsvLines — null flagReason", () => {
  it("null flagReason becomes an empty string in the thread output", () => {
    const thread: FlaggedCsvThread = { ...THREAD, flagReason: null };
    const lines = buildFlaggedCsvLines([thread], []);
    const cells = lines[1].split(",");
    expect(cells[4]).toBe('""');
  });

  it("null flagReason on a post becomes an empty string", () => {
    const post: FlaggedCsvPost = { ...POST, flagReason: null };
    const lines = buildFlaggedCsvLines([], [post]);
    const cells = lines[1].split(",");
    expect(cells[4]).toBe('""');
  });
});
