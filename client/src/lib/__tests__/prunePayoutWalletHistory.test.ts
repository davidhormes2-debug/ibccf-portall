// @vitest-environment jsdom
//
// Unit tests for prunePayoutWalletHistory — covers startup housekeeping that
// trims over-sized payout-wallet history entries in localStorage on every page
// load. The source-assertion in appPayoutWalletHistory.test.ts only verifies
// the call site exists in App.tsx; this file tests the actual pruning logic.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  prunePayoutWalletHistory,
  getPayoutWalletHistory,
  PAYOUT_WALLET_HISTORY_PREFIX,
} from "../payoutWalletHistory";

const PREFIX = PAYOUT_WALLET_HISTORY_PREFIX;
const MAX_ENTRIES = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(i: number) {
  return {
    observedAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    snapshot: {
      address: `addr-${i}`,
      asset: "USDT",
      network: "TRC20",
      note: null,
      verifiedAt: null,
    },
  };
}

function makeEntries(count: number) {
  return Array.from({ length: count }, (_, i) => makeEntry(i));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Entries within bounds — untouched
// ---------------------------------------------------------------------------

describe("prunePayoutWalletHistory — within bounds", () => {
  it("leaves an empty key alone", () => {
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify([]));
    prunePayoutWalletHistory();
    expect(JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!)).toEqual([]);
  });

  it("leaves a key with exactly MAX_ENTRIES entries untouched", () => {
    const entries = makeEntries(MAX_ENTRIES);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    prunePayoutWalletHistory();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!);
    expect(stored).toHaveLength(MAX_ENTRIES);
    expect(stored[0].snapshot.address).toBe("addr-0");
    expect(stored[MAX_ENTRIES - 1].snapshot.address).toBe(`addr-${MAX_ENTRIES - 1}`);
  });

  it("leaves a key with fewer than MAX_ENTRIES entries untouched", () => {
    const entries = makeEntries(5);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    prunePayoutWalletHistory();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!);
    expect(stored).toHaveLength(5);
  });

  it("does not write to localStorage when no pruning is needed", () => {
    const entries = makeEntries(10);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    prunePayoutWalletHistory();
    expect(setSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Entries beyond MAX_ENTRIES — trimmed to the last 30
// ---------------------------------------------------------------------------

describe("prunePayoutWalletHistory — trimming", () => {
  it("trims a key with MAX_ENTRIES + 1 entries to MAX_ENTRIES", () => {
    const entries = makeEntries(MAX_ENTRIES + 1);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    prunePayoutWalletHistory();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!);
    expect(stored).toHaveLength(MAX_ENTRIES);
  });

  it("keeps the LAST MAX_ENTRIES entries (most recent) after trimming", () => {
    const total = MAX_ENTRIES + 5;
    const entries = makeEntries(total);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    prunePayoutWalletHistory();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!);
    expect(stored).toHaveLength(MAX_ENTRIES);
    // The first 5 (oldest) should be gone; entry at index 5 becomes new [0].
    expect(stored[0].snapshot.address).toBe(`addr-5`);
    expect(stored[MAX_ENTRIES - 1].snapshot.address).toBe(`addr-${total - 1}`);
  });

  it("trims a very large key (100 entries) down to MAX_ENTRIES", () => {
    const entries = makeEntries(100);
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(entries));
    prunePayoutWalletHistory();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-1`)!);
    expect(stored).toHaveLength(MAX_ENTRIES);
    expect(stored[0].snapshot.address).toBe(`addr-${100 - MAX_ENTRIES}`);
    expect(stored[MAX_ENTRIES - 1].snapshot.address).toBe("addr-99");
  });

  it("trims each matching key independently when multiple case keys exist", () => {
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(makeEntries(MAX_ENTRIES + 2)));
    localStorage.setItem(`${PREFIX}case-2`, JSON.stringify(makeEntries(3)));
    localStorage.setItem(`${PREFIX}case-3`, JSON.stringify(makeEntries(MAX_ENTRIES + 10)));
    prunePayoutWalletHistory();
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
    prunePayoutWalletHistory();
    expect(localStorage.getItem("ibccf.locale")).toBe("en");
    expect(localStorage.getItem("ibccf_theme")).toBe("dark");
  });

  it("getPayoutWalletHistory returns exactly the trimmed slice per case after pruning", () => {
    // Write oversized entries for two cases directly to localStorage, bypassing safeWrite.
    const overA = MAX_ENTRIES + 7;
    const overB = MAX_ENTRIES + 3;
    localStorage.setItem(`${PREFIX}case-a`, JSON.stringify(makeEntries(overA)));
    localStorage.setItem(`${PREFIX}case-b`, JSON.stringify(makeEntries(overB)));

    prunePayoutWalletHistory();

    const histA = getPayoutWalletHistory("case-a");
    const histB = getPayoutWalletHistory("case-b");

    // Each case should be trimmed to exactly MAX_ENTRIES.
    expect(histA).toHaveLength(MAX_ENTRIES);
    expect(histB).toHaveLength(MAX_ENTRIES);

    // The slice keeps the LAST MAX_ENTRIES entries (most recent).
    expect(histA[0].snapshot.address).toBe(`addr-${overA - MAX_ENTRIES}`);
    expect(histA[MAX_ENTRIES - 1].snapshot.address).toBe(`addr-${overA - 1}`);

    expect(histB[0].snapshot.address).toBe(`addr-${overB - MAX_ENTRIES}`);
    expect(histB[MAX_ENTRIES - 1].snapshot.address).toBe(`addr-${overB - 1}`);

    // Trimming case-a did not alter case-b's content and vice-versa.
    expect(histA[0].snapshot.address).not.toBe(histB[0].snapshot.address);
  });
});

// ---------------------------------------------------------------------------
// Malformed JSON — skipped without throwing
// ---------------------------------------------------------------------------

describe("prunePayoutWalletHistory — malformed entries", () => {
  it("skips a key whose value is not valid JSON without throwing", () => {
    localStorage.setItem(`${PREFIX}case-bad`, "not-json{{{");
    expect(() => prunePayoutWalletHistory()).not.toThrow();
    // Key is left untouched (we skip, not delete).
    expect(localStorage.getItem(`${PREFIX}case-bad`)).toBe("not-json{{{");
  });

  it("skips a key whose JSON value is a non-array without throwing", () => {
    localStorage.setItem(`${PREFIX}case-obj`, JSON.stringify({ foo: "bar" }));
    expect(() => prunePayoutWalletHistory()).not.toThrow();
    expect(localStorage.getItem(`${PREFIX}case-obj`)).toBe(
      JSON.stringify({ foo: "bar" }),
    );
  });

  it("skips a key whose value is a JSON null without throwing", () => {
    localStorage.setItem(`${PREFIX}case-null`, "null");
    expect(() => prunePayoutWalletHistory()).not.toThrow();
    expect(localStorage.getItem(`${PREFIX}case-null`)).toBe("null");
  });

  it("skips a key whose value is a JSON string without throwing", () => {
    localStorage.setItem(`${PREFIX}case-str`, JSON.stringify("hello"));
    expect(() => prunePayoutWalletHistory()).not.toThrow();
  });

  it("still prunes a valid oversized key even when a malformed key is present", () => {
    localStorage.setItem(`${PREFIX}case-bad`, "not-json");
    localStorage.setItem(`${PREFIX}case-good`, JSON.stringify(makeEntries(MAX_ENTRIES + 3)));
    expect(() => prunePayoutWalletHistory()).not.toThrow();
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}case-good`)!);
    expect(stored).toHaveLength(MAX_ENTRIES);
  });

  it("handles a key with an empty string value without throwing", () => {
    localStorage.setItem(`${PREFIX}case-empty`, "");
    expect(() => prunePayoutWalletHistory()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// localStorage unavailable — handled gracefully
// ---------------------------------------------------------------------------

describe("prunePayoutWalletHistory — localStorage unavailable", () => {
  it("does not throw when Object.keys(localStorage) throws", () => {
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    // Spy on Object.keys at the global level for localStorage
    const keySpy = vi
      .spyOn(Object, "keys")
      .mockImplementationOnce((target) => {
        if (target === localStorage) throw new DOMException("SecurityError");
        return Object.getOwnPropertyNames(target);
      });
    expect(() => prunePayoutWalletHistory()).not.toThrow();
    keySpy.mockRestore();
  });

  it("does not throw when localStorage.getItem throws mid-iteration", () => {
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(makeEntries(5)));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(() => prunePayoutWalletHistory()).not.toThrow();
  });

  it("does not throw when localStorage.setItem throws during trim", () => {
    localStorage.setItem(`${PREFIX}case-1`, JSON.stringify(makeEntries(MAX_ENTRIES + 1)));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => prunePayoutWalletHistory()).not.toThrow();
  });
});
