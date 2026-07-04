// @vitest-environment jsdom
//
// Unit tests for payoutWalletHistory — covers the normal forward-recording
// path and the high-water-mark roll-back suppression introduced to keep the
// Activity Timeline clean when an admin clears or resets the payout wallet.

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordPayoutWalletObservation,
  getPayoutWalletHistory,
  hasSeenPayoutWalletBanner,
  markPayoutWalletBannerSeen,
} from "../payoutWalletHistory";

// Reset localStorage between tests so each case starts clean.
beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snap(address: string | null, verifiedAt: string | null = null) {
  return { address, asset: "USDT", network: "TRC20", note: null, verifiedAt };
}

const T1 = "2024-01-01T00:00:00.000Z";
const T2 = "2024-06-01T00:00:00.000Z";
const T3 = "2025-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Guard rails — invalid / empty inputs
// ---------------------------------------------------------------------------

describe("recordPayoutWalletObservation — guard rails", () => {
  it("returns isNew:false for an empty caseId", () => {
    const result = recordPayoutWalletObservation("", snap("addr-1", T1));
    expect(result).toEqual({ previous: null, isNew: false });
  });

  it("does not record an empty snapshot when history is empty", () => {
    const result = recordPayoutWalletObservation(
      "case-1",
      { address: null, asset: null, network: null, note: null, verifiedAt: null },
    );
    expect(result).toEqual({ previous: null, isNew: false });
    expect(getPayoutWalletHistory("case-1")).toHaveLength(0);
  });

  it("does not record a whitespace-only address when history is empty", () => {
    const result = recordPayoutWalletObservation("case-1", {
      address: "   ",
      asset: "",
      network: "  ",
      note: null,
      verifiedAt: null,
    });
    expect(result).toEqual({ previous: null, isNew: false });
    expect(getPayoutWalletHistory("case-1")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Normal forward transitions (no roll-backs)
// ---------------------------------------------------------------------------

describe("recordPayoutWalletObservation — forward transitions", () => {
  it("records the very first wallet observation", () => {
    const result = recordPayoutWalletObservation("case-1", snap("addr-1", T1));
    expect(result).toEqual({ previous: null, isNew: true });
    expect(getPayoutWalletHistory("case-1")).toHaveLength(1);
  });

  it("records a new wallet address and returns the previous snapshot", () => {
    recordPayoutWalletObservation("case-1", snap("addr-1", T1));
    const result = recordPayoutWalletObservation("case-1", snap("addr-2", T2));
    expect(result.isNew).toBe(true);
    expect(result.previous?.address).toBe("addr-1");
    expect(getPayoutWalletHistory("case-1")).toHaveLength(2);
  });

  it("is idempotent — same snapshot twice does not append a duplicate", () => {
    recordPayoutWalletObservation("case-1", snap("addr-1", T1));
    const result = recordPayoutWalletObservation("case-1", snap("addr-1", T1));
    expect(result.isNew).toBe(false);
    expect(getPayoutWalletHistory("case-1")).toHaveLength(1);
  });

  it("builds up a multi-entry history for a sequence of wallet changes", () => {
    recordPayoutWalletObservation("case-1", snap("addr-1", T1));
    recordPayoutWalletObservation("case-1", snap("addr-2", T2));
    recordPayoutWalletObservation("case-1", snap("addr-3", T3));
    const history = getPayoutWalletHistory("case-1");
    expect(history).toHaveLength(3);
    expect(history.map((e) => e.snapshot.address)).toEqual([
      "addr-1",
      "addr-2",
      "addr-3",
    ]);
  });
});

// ---------------------------------------------------------------------------
// High-water mark roll-back suppression (the core of this task)
// ---------------------------------------------------------------------------

describe("recordPayoutWalletObservation — high-water mark roll-back suppression", () => {
  it("drops an observation whose verifiedAt is null when a high-water exists in local history", () => {
    // Establish history with a verified wallet.
    recordPayoutWalletObservation("case-1", snap("addr-1", T2));
    // Admin clears the wallet — new snapshot has no verifiedAt.
    const result = recordPayoutWalletObservation("case-1", snap(null, null));
    expect(result.isNew).toBe(false);
    // History unchanged.
    expect(getPayoutWalletHistory("case-1")).toHaveLength(1);
  });

  it("drops an observation whose verifiedAt is earlier than the local high-water", () => {
    recordPayoutWalletObservation("case-1", snap("addr-1", T2));
    // Admin resets to an older wallet state.
    const result = recordPayoutWalletObservation("case-1", snap("addr-old", T1));
    expect(result.isNew).toBe(false);
    expect(getPayoutWalletHistory("case-1")).toHaveLength(1);
  });

  it("does not re-fire the banner (isNew:false) after an admin reset", () => {
    recordPayoutWalletObservation("case-1", snap("addr-1", T2));
    // Admin resets.
    const result = recordPayoutWalletObservation(
      "case-1",
      snap(null, null),
      T2, // server-supplied high-water
    );
    expect(result.isNew).toBe(false);
  });

  it("uses server-supplied highWaterVerifiedAt even when local history is empty", () => {
    // First observation on this device but server says T2 is the max.
    const result = recordPayoutWalletObservation(
      "case-1",
      snap("addr-old", T1),
      T2,
    );
    expect(result.isNew).toBe(false);
    expect(getPayoutWalletHistory("case-1")).toHaveLength(0);
  });

  it("records a forward observation when verifiedAt equals the high-water", () => {
    // Initial wallet recorded at T2.
    recordPayoutWalletObservation("case-1", snap("addr-1", T2), T2);
    // Same verifiedAt but a different address — treated as a re-set at same time.
    // snapshotEqual returns false so it records.
    const result = recordPayoutWalletObservation(
      "case-1",
      snap("addr-2", T2),
      T2,
    );
    expect(result.isNew).toBe(true);
  });

  it("records a forward observation when verifiedAt is newer than the high-water", () => {
    recordPayoutWalletObservation("case-1", snap("addr-1", T2), T2);
    const result = recordPayoutWalletObservation(
      "case-1",
      snap("addr-2", T3),
      T2,
    );
    expect(result.isNew).toBe(true);
    expect(result.previous?.address).toBe("addr-1");
    expect(getPayoutWalletHistory("case-1")).toHaveLength(2);
  });

  it("picks the higher of server-supplied and local history as the effective high-water", () => {
    // Local history records up to T3, but server only reports T2.
    recordPayoutWalletObservation("case-1", snap("addr-1", T2));
    recordPayoutWalletObservation("case-1", snap("addr-2", T3));
    // Roll-back to T2 — local history has T3 as its max, so T2 < T3 is dropped.
    const result = recordPayoutWalletObservation(
      "case-1",
      snap("addr-1", T2),
      T2, // server lags behind
    );
    expect(result.isNew).toBe(false);
    expect(getPayoutWalletHistory("case-1")).toHaveLength(2); // unchanged
  });

  it("treats highWaterVerifiedAt=null the same as no high-water (normal forward path)", () => {
    const result = recordPayoutWalletObservation(
      "case-1",
      snap("addr-1", T1),
      null,
    );
    expect(result.isNew).toBe(true);
    expect(getPayoutWalletHistory("case-1")).toHaveLength(1);
  });

  it("treats highWaterVerifiedAt=undefined the same as no high-water", () => {
    const result = recordPayoutWalletObservation(
      "case-1",
      snap("addr-1", T1),
      undefined,
    );
    expect(result.isNew).toBe(true);
    expect(getPayoutWalletHistory("case-1")).toHaveLength(1);
  });

  it("keeps the timeline clean across a reset + re-advance cycle", () => {
    // User sees wallet set to addr-1 at T2.
    recordPayoutWalletObservation("case-1", snap("addr-1", T2), T2);
    // Admin resets (clears wallet) — ignored.
    recordPayoutWalletObservation("case-1", snap(null, null), T2);
    // Admin sets a new wallet at T3 — recorded.
    recordPayoutWalletObservation("case-1", snap("addr-2", T3), T2);
    const history = getPayoutWalletHistory("case-1");
    expect(history).toHaveLength(2);
    expect(history[0].snapshot.address).toBe("addr-1");
    expect(history[1].snapshot.address).toBe("addr-2");
  });

  it("does not re-record an existing entry after a roll-back + same-state re-open", () => {
    recordPayoutWalletObservation("case-1", snap("addr-1", T2), T2);
    // Admin resets — ignored.
    recordPayoutWalletObservation("case-1", snap(null, null), T2);
    // User reloads: still sees the cleared wallet — still ignored.
    const result = recordPayoutWalletObservation("case-1", snap(null, null), T2);
    expect(result.isNew).toBe(false);
    expect(getPayoutWalletHistory("case-1")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// safeRead resilience — externally deleted / missing keys
// ---------------------------------------------------------------------------

describe("getPayoutWalletHistory — safeRead resilience", () => {
  it("returns [] when no key has ever been written for the case", () => {
    expect(getPayoutWalletHistory("case-never-written")).toEqual([]);
  });

  it("returns [] when the key is removed from localStorage externally after observations were recorded", () => {
    // Record observations through the normal API.
    recordPayoutWalletObservation("case-1", snap("addr-1", T1));
    recordPayoutWalletObservation("case-1", snap("addr-2", T2));
    expect(getPayoutWalletHistory("case-1")).toHaveLength(2);

    // Simulate a logout or case-switch that wipes the key directly.
    localStorage.removeItem(`ibccf_payout_wallet_history_case-1`);

    // After external deletion the public getter must return [] without throwing.
    expect(getPayoutWalletHistory("case-1")).toEqual([]);
  });

  it("does not bleed data from one case into another after the first case's key is deleted", () => {
    recordPayoutWalletObservation("case-1", snap("addr-1", T1));
    recordPayoutWalletObservation("case-2", snap("addr-x", T2));

    // Delete case-1's key externally (e.g. logout clears only that case).
    localStorage.removeItem(`ibccf_payout_wallet_history_case-1`);

    expect(getPayoutWalletHistory("case-1")).toEqual([]);
    // case-2 must remain unaffected.
    expect(getPayoutWalletHistory("case-2")).toHaveLength(1);
    expect(getPayoutWalletHistory("case-2")[0].snapshot.address).toBe("addr-x");
  });
});

// ---------------------------------------------------------------------------
// Banner seen helpers (regression guard)
// ---------------------------------------------------------------------------

describe("hasSeenPayoutWalletBanner / markPayoutWalletBannerSeen", () => {
  it("returns false before the banner has been marked seen", () => {
    expect(hasSeenPayoutWalletBanner("case-1", "2024-01-01T00:00:00.000Z")).toBe(false);
  });

  it("returns true after marking the banner seen", () => {
    markPayoutWalletBannerSeen("case-1", "2024-01-01T00:00:00.000Z");
    expect(hasSeenPayoutWalletBanner("case-1", "2024-01-01T00:00:00.000Z")).toBe(true);
  });

  it("is scoped per timestamp — marking one stamp does not affect another", () => {
    markPayoutWalletBannerSeen("case-1", "2024-01-01T00:00:00.000Z");
    expect(hasSeenPayoutWalletBanner("case-1", "2024-06-01T00:00:00.000Z")).toBe(false);
  });

  it("is scoped per case — marking one case does not affect another", () => {
    markPayoutWalletBannerSeen("case-1", "2024-01-01T00:00:00.000Z");
    expect(hasSeenPayoutWalletBanner("case-2", "2024-01-01T00:00:00.000Z")).toBe(false);
  });
});
