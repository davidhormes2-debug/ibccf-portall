// @vitest-environment jsdom
//
// Unit tests for stageHistory — covers the normal forward-transition path
// and the roll-back clamping path introduced to keep the Activity Timeline
// in ascending order when an admin lowers the live withdrawalStage.

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordStageObservation,
  getStageHistory,
  hasSeenStageBanner,
  markStageBannerSeen,
} from "../stageHistory";

// Reset localStorage between tests so each case starts clean.
beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Guard rails — invalid inputs
// ---------------------------------------------------------------------------

describe("recordStageObservation — invalid inputs", () => {
  it("returns isNew:false for an empty caseId", () => {
    const result = recordStageObservation("", 5);
    expect(result).toEqual({ previousStage: null, isNew: false });
  });

  it("returns isNew:false for stage 0", () => {
    const result = recordStageObservation("case-1", 0);
    expect(result).toEqual({ previousStage: null, isNew: false });
  });

  it("returns isNew:false for a negative stage", () => {
    const result = recordStageObservation("case-1", -1);
    expect(result).toEqual({ previousStage: null, isNew: false });
  });

  it("returns isNew:false for NaN stage", () => {
    const result = recordStageObservation("case-1", NaN);
    expect(result).toEqual({ previousStage: null, isNew: false });
  });
});

// ---------------------------------------------------------------------------
// Normal forward transitions (no roll-backs involved)
// ---------------------------------------------------------------------------

describe("recordStageObservation — forward transitions", () => {
  it("records the very first stage observation", () => {
    const result = recordStageObservation("case-1", 1);
    expect(result).toEqual({ previousStage: null, isNew: true });
    expect(getStageHistory("case-1")).toHaveLength(1);
    expect(getStageHistory("case-1")[0].stage).toBe(1);
  });

  it("records a forward step and returns previousStage", () => {
    recordStageObservation("case-1", 3);
    const result = recordStageObservation("case-1", 5);
    expect(result).toEqual({ previousStage: 3, isNew: true });
    const history = getStageHistory("case-1");
    expect(history).toHaveLength(2);
    expect(history[0].stage).toBe(3);
    expect(history[1].stage).toBe(5);
  });

  it("is idempotent — same stage twice does not append a duplicate", () => {
    recordStageObservation("case-1", 4);
    const result = recordStageObservation("case-1", 4);
    expect(result).toEqual({ previousStage: 4, isNew: false });
    expect(getStageHistory("case-1")).toHaveLength(1);
  });

  it("builds up a multi-step ascending history", () => {
    [1, 3, 5, 7, 10].forEach((s) => recordStageObservation("case-1", s));
    const stages = getStageHistory("case-1").map((e) => e.stage);
    expect(stages).toEqual([1, 3, 5, 7, 10]);
  });
});

// ---------------------------------------------------------------------------
// Roll-back clamping (the core of this task)
// ---------------------------------------------------------------------------

describe("recordStageObservation — roll-back clamping with maxStageReached", () => {
  it("does NOT add a backwards entry when stage < last recorded stage", () => {
    // Build history up to stage 10.
    [5, 8, 10].forEach((s) => recordStageObservation("case-1", s));

    // Admin rolls back to stage 7. Should be silently dropped.
    const result = recordStageObservation("case-1", 7);
    expect(result.isNew).toBe(false);
    const stages = getStageHistory("case-1").map((e) => e.stage);
    expect(stages).toEqual([5, 8, 10]); // unchanged
  });

  it("does NOT fire the banner (isNew:false) on a roll-back", () => {
    recordStageObservation("case-1", 10);
    const result = recordStageObservation("case-1", 6, 10);
    expect(result.isNew).toBe(false);
  });

  it("uses maxStageReached as high-water even when local history is empty", () => {
    // First observation on this device, but server says max was already 8.
    const result = recordStageObservation("case-1", 5, 8);
    expect(result.isNew).toBe(false);
    expect(getStageHistory("case-1")).toHaveLength(0);
  });

  it("records a forward step correctly when stage >= maxStageReached", () => {
    recordStageObservation("case-1", 8, 8);
    // Stage advances to 9 — should record.
    const result = recordStageObservation("case-1", 9, 8);
    expect(result.isNew).toBe(true);
    expect(result.previousStage).toBe(8);
    expect(getStageHistory("case-1")).toHaveLength(2);
  });

  it("treats maxStageReached=null the same as no high-water (normal forward path)", () => {
    const result = recordStageObservation("case-1", 3, null);
    expect(result.isNew).toBe(true);
    expect(getStageHistory("case-1")).toHaveLength(1);
  });

  it("treats maxStageReached=undefined the same as no high-water", () => {
    const result = recordStageObservation("case-1", 3, undefined);
    expect(result.isNew).toBe(true);
    expect(getStageHistory("case-1")).toHaveLength(1);
  });

  it("picks the higher of maxStageReached and local history as the high-water mark", () => {
    // Local history ends at 12, but server reports maxStageReached=10.
    // (Can happen if server maxStageReached lags behind client observation.)
    [10, 12].forEach((s) => recordStageObservation("case-1", s));
    // Roll back to 11 — local history says 12 is the max, so 11 < 12 is dropped.
    const result = recordStageObservation("case-1", 11, 10);
    expect(result.isNew).toBe(false);
    expect(getStageHistory("case-1")).toHaveLength(2); // unchanged
  });

  it("does not append a duplicate even when stage === maxStageReached", () => {
    recordStageObservation("case-1", 10);
    // Reload: stage is still 10, maxStageReached=10.
    const result = recordStageObservation("case-1", 10, 10);
    expect(result.isNew).toBe(false);
    expect(getStageHistory("case-1")).toHaveLength(1);
  });

  it("keeps the timeline in ascending order across a roll-back + re-advance", () => {
    // User sees stages 1 → 5 → 10.
    [1, 5, 10].forEach((s) => recordStageObservation("case-1", s));
    // Admin rolls back to 7 — ignored.
    recordStageObservation("case-1", 7, 10);
    // Admin re-advances to 11 — recorded.
    recordStageObservation("case-1", 11, 10);
    const stages = getStageHistory("case-1").map((e) => e.stage);
    expect(stages).toEqual([1, 5, 10, 11]);
  });
});

// ---------------------------------------------------------------------------
// Banner seen helpers (unchanged behavior — regression guard)
// ---------------------------------------------------------------------------

describe("hasSeenStageBanner / markStageBannerSeen", () => {
  it("returns false before the banner has been marked seen", () => {
    expect(hasSeenStageBanner("case-1", 5)).toBe(false);
  });

  it("returns true after marking the banner seen", () => {
    markStageBannerSeen("case-1", 5);
    expect(hasSeenStageBanner("case-1", 5)).toBe(true);
  });

  it("is scoped per stage — marking one stage does not affect another", () => {
    markStageBannerSeen("case-1", 5);
    expect(hasSeenStageBanner("case-1", 6)).toBe(false);
  });

  it("is scoped per case — marking one case does not affect another", () => {
    markStageBannerSeen("case-1", 5);
    expect(hasSeenStageBanner("case-2", 5)).toBe(false);
  });
});
