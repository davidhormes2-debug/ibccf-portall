// @vitest-environment jsdom
//
// Unit tests for pruneStageHistory — covers startup housekeeping that trims
// over-sized stage-history entries in localStorage on every page load.
// The source-assertion in appStageHistory.test.ts only verifies the call site
// exists in App.tsx; this file tests the actual pruning logic.
//
// Also retains the original getStageHistory trim-on-read tests that verify
// the per-read cap and per-case isolation.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  pruneStageHistory,
  getStageHistory,
  STAGE_HISTORY_KEY_PREFIX,
  MAX_STAGE_HISTORY_ENTRIES,
} from "../stageHistory";

const PREFIX = STAGE_HISTORY_KEY_PREFIX;
const MAX_ENTRIES = MAX_STAGE_HISTORY_ENTRIES;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(i: number) {
  return {
    stage: (i % 14) + 1,
    observedAt: `2024-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  };
}

function makeEntries(count: number) {
  return Array.from({ length: count }, (_, i) => makeEntry(i));
}

function writeRaw(caseId: string, entries: ReturnType<typeof makeEntry>[]) {
  localStorage.setItem(`${PREFIX}${caseId}`, JSON.stringify(entries));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// pruneStageHistory — entries within bounds — untouched
// ---------------------------------------------------------------------------

describe("pruneStageHistory — within bounds", () => {
  it("leaves an empty key alone", () => {
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify([]));
    pruneStageHistory();
    expect(JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!)).toEqual([]);
  });

  it("leaves a key with exactly MAX_ENTRIES entries untouched", () => {
    const entries = makeEntries(MAX_ENTRIES);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    pruneStageHistory();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!);
    expect(stored).toHaveLength(MAX_ENTRIES);
    expect(stored[0].observedAt).toBe(entries[0].observedAt);
    expect(stored[MAX_ENTRIES - 1].observedAt).toBe(entries[MAX_ENTRIES - 1].observedAt);
  });

  it("leaves a key with fewer than MAX_ENTRIES entries untouched", () => {
    const entries = makeEntries(5);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    pruneStageHistory();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!);
    expect(stored).toHaveLength(5);
  });

  it("does not write to localStorage when no pruning is needed", () => {
    const entries = makeEntries(10);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    pruneStageHistory();
    expect(setSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// pruneStageHistory — entries beyond MAX_ENTRIES — trimmed to the last MAX_ENTRIES
// ---------------------------------------------------------------------------

describe("pruneStageHistory — trimming", () => {
  it("trims a key with MAX_ENTRIES + 1 entries to MAX_ENTRIES", () => {
    const entries = makeEntries(MAX_ENTRIES + 1);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    pruneStageHistory();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!);
    expect(stored).toHaveLength(MAX_ENTRIES);
  });

  it("keeps the LAST MAX_ENTRIES entries (most recent) after trimming", () => {
    const total = MAX_ENTRIES + 5;
    const entries = makeEntries(total);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    pruneStageHistory();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!);
    expect(stored).toHaveLength(MAX_ENTRIES);
    // The first 5 (oldest) should be gone; entry at index 5 becomes new [0].
    expect(stored[0].observedAt).toBe(entries[5].observedAt);
    expect(stored[MAX_ENTRIES - 1].observedAt).toBe(entries[total - 1].observedAt);
  });

  it("trims a very large key (100 entries) down to MAX_ENTRIES", () => {
    const entries = makeEntries(100);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    pruneStageHistory();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!);
    expect(stored).toHaveLength(MAX_ENTRIES);
    expect(stored[0].observedAt).toBe(entries[100 - MAX_ENTRIES].observedAt);
    expect(stored[MAX_ENTRIES - 1].observedAt).toBe(entries[99].observedAt);
  });

  it("trims each matching key independently when multiple case keys exist", () => {
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(makeEntries(MAX_ENTRIES + 2)));
    localStorage.setItem(`${PREFIX}case-2`, JSON.stringify(makeEntries(3)));
    localStorage.setItem(`${PREFIX}case-3`, JSON.stringify(makeEntries(MAX_ENTRIES + 10)));
    pruneStageHistory();
    expect(
      JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!),
    ).toHaveLength(MAX_ENTRIES);
    expect(
      JSON.parse(localStorage.getItem(`${PREFIX}case-2`)!),
    ).toHaveLength(3);
    expect(
      JSON.parse(localStorage.getItem(`${PREFIX}case-3`)!),
    ).toHaveLength(MAX_ENTRIES);
  });

  it("does not touch unrelated localStorage keys", () => {
    localStorage.setItem("ibccf.locale", "en");
    localStorage.setItem("ibccf_theme", "dark");
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(makeEntries(MAX_ENTRIES + 1)));
    pruneStageHistory();
    expect(localStorage.getItem("ibccf.locale")).toBe("en");
    expect(localStorage.getItem("ibccf_theme")).toBe("dark");
  });

  it("getStageHistory returns exactly the trimmed slice per case after pruning", () => {
    const overA = MAX_ENTRIES + 7;
    const overB = MAX_ENTRIES + 3;
    localStorage.setItem(`${PREFIX}case-a`, JSON.stringify(makeEntries(overA)));
    localStorage.setItem(`${PREFIX}case-b`, JSON.stringify(makeEntries(overB)));

    pruneStageHistory();

    const histA = getStageHistory("case-a");
    const histB = getStageHistory("case-b");

    expect(histA).toHaveLength(MAX_ENTRIES);
    expect(histB).toHaveLength(MAX_ENTRIES);

    expect(histA[0].observedAt).toBe(makeEntry(overA - MAX_ENTRIES).observedAt);
    expect(histA[MAX_ENTRIES - 1].observedAt).toBe(makeEntry(overA - 1).observedAt);

    expect(histB[0].observedAt).toBe(makeEntry(overB - MAX_ENTRIES).observedAt);
    expect(histB[MAX_ENTRIES - 1].observedAt).toBe(makeEntry(overB - 1).observedAt);

    expect(histA[0].observedAt).not.toBe(histB[0].observedAt);
  });
});

// ---------------------------------------------------------------------------
// pruneStageHistory — malformed JSON — skipped without throwing
// ---------------------------------------------------------------------------

describe("pruneStageHistory — malformed entries", () => {
  it("skips a key whose value is not valid JSON without throwing", () => {
    localStorage.setItem(`${PREFIX}case-bad`, "not-json{{{");
    expect(() => pruneStageHistory()).not.toThrow();
    expect(localStorage.getItem(`${PREFIX}case-bad`)).toBe("not-json{{{");
  });

  it("skips a key whose JSON value is a non-array without throwing", () => {
    localStorage.setItem(`${PREFIX}case-obj`, JSON.stringify({ foo: "bar" }));
    expect(() => pruneStageHistory()).not.toThrow();
    expect(localStorage.getItem(`${PREFIX}case-obj`)).toBe(
      JSON.stringify({ foo: "bar" }),
    );
  });

  it("skips a key whose value is a JSON null without throwing", () => {
    localStorage.setItem(`${PREFIX}case-null`, "null");
    expect(() => pruneStageHistory()).not.toThrow();
    expect(localStorage.getItem(`${PREFIX}case-null`)).toBe("null");
  });

  it("skips a key whose value is a JSON string without throwing", () => {
    localStorage.setItem(`${PREFIX}case-str`, JSON.stringify("hello"));
    expect(() => pruneStageHistory()).not.toThrow();
  });

  it("still prunes a valid oversized key even when a malformed key is present", () => {
    localStorage.setItem(`${PREFIX}case-bad`, "not-json");
    localStorage.setItem(`${PREFIX}case-good`, JSON.stringify(makeEntries(MAX_ENTRIES + 3)));
    expect(() => pruneStageHistory()).not.toThrow();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-good`)!);
    expect(stored).toHaveLength(MAX_ENTRIES);
  });

  it("handles a key with an empty string value without throwing", () => {
    localStorage.setItem(`${PREFIX}case-empty`, "");
    expect(() => pruneStageHistory()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// pruneStageHistory — localStorage unavailable — handled gracefully
// ---------------------------------------------------------------------------

describe("pruneStageHistory — localStorage unavailable", () => {
  it("does not throw when Object.keys(localStorage) throws", () => {
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    const keySpy = vi
      .spyOn(Object, "keys")
      .mockImplementationOnce((target) => {
        if (target === localStorage) throw new DOMException("SecurityError");
        return Object.getOwnPropertyNames(target);
      });
    expect(() => pruneStageHistory()).not.toThrow();
    keySpy.mockRestore();
  });

  it("does not throw when localStorage.getItem throws mid-iteration", () => {
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(makeEntries(5)));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(() => pruneStageHistory()).not.toThrow();
  });

  it("does not throw when localStorage.setItem throws during trim", () => {
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(makeEntries(MAX_ENTRIES + 1)));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => pruneStageHistory()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getStageHistory — trim on read (original tests retained)
// ---------------------------------------------------------------------------

describe("getStageHistory — trim on read", () => {
  it("returns [] for a case with no stored key", () => {
    expect(getStageHistory("case-unknown")).toEqual([]);
  });

  it("returns all entries when count equals MAX_ENTRIES", () => {
    writeRaw("case-1", makeEntries(MAX_ENTRIES));
    expect(getStageHistory("case-1")).toHaveLength(MAX_ENTRIES);
  });

  it("returns all entries when count is below MAX_ENTRIES", () => {
    writeRaw("case-1", makeEntries(10));
    expect(getStageHistory("case-1")).toHaveLength(10);
  });

  it("trims to MAX_ENTRIES when stored count exceeds the limit", () => {
    const oversized = MAX_ENTRIES + 15;
    writeRaw("case-1", makeEntries(oversized));
    expect(getStageHistory("case-1")).toHaveLength(MAX_ENTRIES);
  });

  it("keeps the LAST MAX_ENTRIES entries (most recent) after trimming", () => {
    const oversized = MAX_ENTRIES + 10;
    const entries = makeEntries(oversized);
    writeRaw("case-1", entries);

    const result = getStageHistory("case-1");

    const dropped = oversized - MAX_ENTRIES;
    expect(result[0].observedAt).toBe(entries[dropped].observedAt);
    expect(result[MAX_ENTRIES - 1].observedAt).toBe(
      entries[oversized - 1].observedAt,
    );
  });
});

// ---------------------------------------------------------------------------
// getStageHistory — malformed storage values — reader returns [] without throwing
// ---------------------------------------------------------------------------

describe("getStageHistory — malformed storage values", () => {
  it("returns [] for a key with invalid JSON without throwing", () => {
    localStorage.setItem(`${PREFIX}case-bad`, "not-valid-json{{{");
    expect(() => getStageHistory("case-bad")).not.toThrow();
    expect(getStageHistory("case-bad")).toEqual([]);
  });

  it("returns [] when the stored value is a JSON object (not an array)", () => {
    localStorage.setItem(`${PREFIX}case-obj`, JSON.stringify({ stage: 1 }));
    expect(getStageHistory("case-obj")).toEqual([]);
  });

  it("returns [] when the stored value is JSON null", () => {
    localStorage.setItem(`${PREFIX}case-null`, "null");
    expect(getStageHistory("case-null")).toEqual([]);
  });

  it("filters out array elements that are not valid StageHistoryEntry objects", () => {
    const mixed = [
      { stage: 3, observedAt: "2024-01-01T00:00:00.000Z" },
      { stage: "bad", observedAt: "2024-01-02T00:00:00.000Z" },
      null,
      42,
      { stage: 5, observedAt: "2024-01-03T00:00:00.000Z" },
    ];
    localStorage.setItem(`${PREFIX}case-mixed`, JSON.stringify(mixed));

    const result = getStageHistory("case-mixed");
    expect(result).toHaveLength(2);
    expect(result[0].stage).toBe(3);
    expect(result[1].stage).toBe(5);
  });
});
