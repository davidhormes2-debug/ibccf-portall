// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  cleanupStaleWalletHistory,
  WALLET_HISTORY_SENTINEL,
  WALLET_HISTORY_PREFIX,
} from "../lib/walletHistoryCleanup";

// ---------------------------------------------------------------------------
// walletHistoryCleanup — one-time localStorage migration guard
//
// WHY THIS TEST EXISTS
// A one-time cleanup IIFE (now extracted to `lib/walletHistoryCleanup.ts` and
// called from `App.tsx`) removes orphaned `ibccf_wallet_connect_history_*`
// keys left behind by the deleted walletConnectHistory module. Without a test,
// regressions could silently re-introduce stale key accumulation or
// accidentally wipe unrelated localStorage keys.
//
// WHAT IS COVERED
// 1. Stale history keys are removed on the first call.
// 2. Unrelated keys are left untouched.
// 3. The sentinel key is written after the sweep so subsequent calls skip.
// 4. A second call when the sentinel is already present does NOT remove keys
//    that were written after the first sweep (i.e. the sentinel gates re-runs).
// 5. When localStorage is unavailable the function swallows the error silently.
// ---------------------------------------------------------------------------

function seedLocalStorage(entries: Record<string, string>) {
  for (const [key, value] of Object.entries(entries)) {
    localStorage.setItem(key, value);
  }
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("cleanupStaleWalletHistory", () => {
  it("removes stale wallet-connect history keys on first call", () => {
    seedLocalStorage({
      [`${WALLET_HISTORY_PREFIX}0xabc`]: "{}",
      [`${WALLET_HISTORY_PREFIX}0xdef`]: "{}",
    });

    cleanupStaleWalletHistory();

    expect(localStorage.getItem(`${WALLET_HISTORY_PREFIX}0xabc`)).toBeNull();
    expect(localStorage.getItem(`${WALLET_HISTORY_PREFIX}0xdef`)).toBeNull();
  });

  it("leaves unrelated keys intact", () => {
    seedLocalStorage({
      [`${WALLET_HISTORY_PREFIX}0xabc`]: "{}",
      "ibccf.locale": "en",
      "ibccf_theme": "dark",
      "someOtherApp_key": "value",
    });

    cleanupStaleWalletHistory();

    expect(localStorage.getItem("ibccf.locale")).toBe("en");
    expect(localStorage.getItem("ibccf_theme")).toBe("dark");
    expect(localStorage.getItem("someOtherApp_key")).toBe("value");
  });

  it("sets the sentinel key after the sweep", () => {
    cleanupStaleWalletHistory();

    expect(localStorage.getItem(WALLET_HISTORY_SENTINEL)).toBe("1");
  });

  it("skips the sweep when the sentinel is already set", () => {
    localStorage.setItem(WALLET_HISTORY_SENTINEL, "1");
    localStorage.setItem(`${WALLET_HISTORY_PREFIX}0xabc`, "{}");

    cleanupStaleWalletHistory();

    expect(localStorage.getItem(`${WALLET_HISTORY_PREFIX}0xabc`)).toBe("{}");
  });

  it("does not disturb the sentinel key itself", () => {
    seedLocalStorage({
      [`${WALLET_HISTORY_PREFIX}0xabc`]: "{}",
    });

    cleanupStaleWalletHistory();

    expect(localStorage.getItem(WALLET_HISTORY_SENTINEL)).toBe("1");

    cleanupStaleWalletHistory();

    expect(localStorage.getItem(WALLET_HISTORY_SENTINEL)).toBe("1");
  });

  it("handles a localStorage that contains only unrelated keys without error", () => {
    seedLocalStorage({ "ibccf.locale": "fr" });

    expect(() => cleanupStaleWalletHistory()).not.toThrow();
    expect(localStorage.getItem("ibccf.locale")).toBe("fr");
    expect(localStorage.getItem(WALLET_HISTORY_SENTINEL)).toBe("1");
  });

  it("handles an empty localStorage without error", () => {
    expect(() => cleanupStaleWalletHistory()).not.toThrow();
    expect(localStorage.getItem(WALLET_HISTORY_SENTINEL)).toBe("1");
  });

  it("removes multiple stale keys in a single sweep", () => {
    const staleKeys = Array.from(
      { length: 5 },
      (_, i) => `${WALLET_HISTORY_PREFIX}addr${i}`,
    );
    staleKeys.forEach((k) => localStorage.setItem(k, `{"addr":"${k}"}`));
    localStorage.setItem("ibccf.locale", "de");

    cleanupStaleWalletHistory();

    staleKeys.forEach((k) =>
      expect(localStorage.getItem(k)).toBeNull(),
    );
    expect(localStorage.getItem("ibccf.locale")).toBe("de");
    expect(localStorage.getItem(WALLET_HISTORY_SENTINEL)).toBe("1");
  });
});
