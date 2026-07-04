// @vitest-environment jsdom
//
// Unit tests for withdrawalRequestHistory — covers the normal
// forward-transition path and the high-water mark roll-back suppression
// introduced to keep the Activity Timeline consistent when an admin resets
// a withdrawal-request status back to an earlier value.

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordWithdrawalRequestObservation,
  getWithdrawalRequestHistory,
  hasSeenWithdrawalRequestBanner,
  markWithdrawalRequestBannerSeen,
} from "../withdrawalRequestHistory";

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Guard rails — invalid inputs
// ---------------------------------------------------------------------------

describe("recordWithdrawalRequestObservation — invalid inputs", () => {
  it("returns isNew:false for an empty caseId", () => {
    const result = recordWithdrawalRequestObservation("", 1, "approved");
    expect(result).toEqual({ previousStatus: null, isNew: false });
  });

  it("returns isNew:false for a non-finite requestId", () => {
    const result = recordWithdrawalRequestObservation("case-1", NaN, "approved");
    expect(result).toEqual({ previousStatus: null, isNew: false });
  });

  it("returns isNew:false for an empty status", () => {
    const result = recordWithdrawalRequestObservation("case-1", 1, "");
    expect(result).toEqual({ previousStatus: null, isNew: false });
  });
});

// ---------------------------------------------------------------------------
// Normal forward transitions (no roll-backs involved)
// ---------------------------------------------------------------------------

describe("recordWithdrawalRequestObservation — forward transitions", () => {
  it("records the very first status observation", () => {
    const result = recordWithdrawalRequestObservation("case-1", 1, "pending");
    expect(result).toEqual({ previousStatus: null, isNew: true });
    expect(getWithdrawalRequestHistory("case-1")).toHaveLength(1);
    expect(getWithdrawalRequestHistory("case-1")[0].status).toBe("pending");
  });

  it("records a forward status change and returns the previous status", () => {
    recordWithdrawalRequestObservation("case-1", 1, "pending");
    const result = recordWithdrawalRequestObservation("case-1", 1, "approved");
    expect(result.isNew).toBe(true);
    expect(result.previousStatus).toBe("pending");
    expect(getWithdrawalRequestHistory("case-1")).toHaveLength(2);
  });

  it("is idempotent — same status twice does not append a duplicate", () => {
    recordWithdrawalRequestObservation("case-1", 1, "approved");
    const result = recordWithdrawalRequestObservation("case-1", 1, "approved");
    expect(result.isNew).toBe(false);
    expect(getWithdrawalRequestHistory("case-1")).toHaveLength(1);
  });

  it("builds a multi-step ascending history", () => {
    ["pending", "approved"].forEach((s) =>
      recordWithdrawalRequestObservation("case-1", 1, s),
    );
    const statuses = getWithdrawalRequestHistory("case-1").map((e) => e.status);
    expect(statuses).toEqual(["pending", "approved"]);
  });

  it("tracks multiple request ids independently within the same case", () => {
    recordWithdrawalRequestObservation("case-1", 1, "pending");
    recordWithdrawalRequestObservation("case-1", 2, "pending");
    recordWithdrawalRequestObservation("case-1", 1, "approved");
    const history = getWithdrawalRequestHistory("case-1");
    expect(history).toHaveLength(3);
    const req1 = history.filter((e) => e.requestId === 1);
    const req2 = history.filter((e) => e.requestId === 2);
    expect(req1[req1.length - 1].status).toBe("approved");
    expect(req2[req2.length - 1].status).toBe("pending");
  });

  it("records approval with reviewedAt and returns isNew:true", () => {
    const reviewedAt = "2024-06-01T10:00:00.000Z";
    recordWithdrawalRequestObservation("case-1", 1, "pending");
    const result = recordWithdrawalRequestObservation(
      "case-1",
      1,
      "approved",
      reviewedAt,
    );
    expect(result.isNew).toBe(true);
    expect(result.previousStatus).toBe("pending");
    const history = getWithdrawalRequestHistory("case-1");
    expect(history).toHaveLength(2);
    expect(history[1].statusChangedAt).toBe(reviewedAt);
  });
});

// ---------------------------------------------------------------------------
// Roll-back suppression (the core of this task)
// ---------------------------------------------------------------------------

describe("recordWithdrawalRequestObservation — roll-back suppression with highWaterStatusChangedAt", () => {
  const reviewedAt = "2024-06-01T10:00:00.000Z";

  it("drops a roll-back when admin clears reviewedAt (server reset)", () => {
    // Request was approved — local history records it.
    recordWithdrawalRequestObservation("case-1", 1, "approved", reviewedAt);

    // Admin resets status to pending; reviewedAt is now null on server.
    const result = recordWithdrawalRequestObservation(
      "case-1",
      1,
      "pending",
      null,
    );
    expect(result.isNew).toBe(false);
    // History should be unchanged.
    expect(getWithdrawalRequestHistory("case-1")).toHaveLength(1);
    expect(getWithdrawalRequestHistory("case-1")[0].status).toBe("approved");
  });

  it("uses highWaterStatusChangedAt as high-water even when local history is empty", () => {
    // First observation on this device; server already has a reviewedAt
    // recorded but the current snapshot has null (admin rolled back).
    const result = recordWithdrawalRequestObservation(
      "case-1",
      1,
      "pending",
      reviewedAt,
    );
    // The server-supplied hint indicates a review occurred; this backwards
    // observation is suppressed.
    expect(result.isNew).toBe(false);
    expect(getWithdrawalRequestHistory("case-1")).toHaveLength(0);
  });

  it("suppresses when server currently has null reviewedAt but local history saw one", () => {
    // Record approval locally.
    recordWithdrawalRequestObservation("case-1", 1, "approved", reviewedAt);
    // Reload: server now has null reviewedAt (admin reset, no server hint).
    const result = recordWithdrawalRequestObservation(
      "case-1",
      1,
      "pending",
      null,
    );
    expect(result.isNew).toBe(false);
    expect(getWithdrawalRequestHistory("case-1")).toHaveLength(1);
  });

  it("picks the higher of highWaterStatusChangedAt and local history as the high-water mark", () => {
    // Local history records an approval.
    recordWithdrawalRequestObservation("case-1", 1, "approved", reviewedAt);

    // Server now reports an earlier reviewedAt (lag/race), incoming is null.
    const earlierAt = "2024-05-01T00:00:00.000Z";
    const result = recordWithdrawalRequestObservation(
      "case-1",
      1,
      "pending",
      earlierAt,
    );
    // Local HW (reviewedAt) wins — the roll-back is still suppressed.
    expect(result.isNew).toBe(false);
    expect(getWithdrawalRequestHistory("case-1")).toHaveLength(1);
  });

  it("allows a later reviewedAt to advance the record (forward path)", () => {
    const laterReviewedAt = "2024-07-01T10:00:00.000Z";

    recordWithdrawalRequestObservation("case-1", 1, "approved", reviewedAt);
    const result = recordWithdrawalRequestObservation(
      "case-1",
      1,
      "approved",
      laterReviewedAt,
    );
    expect(result.isNew).toBe(true);
    expect(getWithdrawalRequestHistory("case-1")).toHaveLength(2);
  });

  it("does not suppress when no high-water exists (null) — normal forward path", () => {
    const result = recordWithdrawalRequestObservation(
      "case-1",
      1,
      "pending",
      null,
    );
    expect(result.isNew).toBe(true);
    expect(getWithdrawalRequestHistory("case-1")).toHaveLength(1);
  });

  it("does not suppress when highWaterStatusChangedAt is undefined", () => {
    const result = recordWithdrawalRequestObservation(
      "case-1",
      1,
      "pending",
      undefined,
    );
    expect(result.isNew).toBe(true);
  });

  it("roll-back suppression is scoped to the requestId — other requests are unaffected", () => {
    // Request 1 was approved.
    recordWithdrawalRequestObservation("case-1", 1, "approved", reviewedAt);

    // Request 2 is still pending with no reviewedAt — should record normally.
    const result = recordWithdrawalRequestObservation(
      "case-1",
      2,
      "pending",
      null,
    );
    expect(result.isNew).toBe(true);
    const history = getWithdrawalRequestHistory("case-1");
    expect(history.filter((e) => e.requestId === 2)).toHaveLength(1);
  });

  it("keeps the timeline clean across roll-back + re-advance", () => {
    // Advance to approved.
    recordWithdrawalRequestObservation("case-1", 1, "pending");
    recordWithdrawalRequestObservation("case-1", 1, "approved", reviewedAt);

    // Admin resets to pending with null reviewedAt — suppressed.
    recordWithdrawalRequestObservation("case-1", 1, "pending", null);

    // Admin re-approves with a later timestamp.
    const newReviewedAt = "2024-08-01T00:00:00.000Z";
    recordWithdrawalRequestObservation("case-1", 1, "approved", newReviewedAt);

    const history = getWithdrawalRequestHistory("case-1").filter(
      (e) => e.requestId === 1,
    );
    expect(history).toHaveLength(3);
    expect(history.map((e) => e.status)).toEqual([
      "pending",
      "approved",
      "approved",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Banner seen helpers (regression guard)
// ---------------------------------------------------------------------------

describe("hasSeenWithdrawalRequestBanner / markWithdrawalRequestBannerSeen", () => {
  it("returns false before the banner has been marked seen", () => {
    expect(hasSeenWithdrawalRequestBanner("case-1", 1, "approved")).toBe(false);
  });

  it("returns true after marking the banner seen", () => {
    markWithdrawalRequestBannerSeen("case-1", 1, "approved");
    expect(hasSeenWithdrawalRequestBanner("case-1", 1, "approved")).toBe(true);
  });

  it("is scoped per status — marking one does not affect another", () => {
    markWithdrawalRequestBannerSeen("case-1", 1, "approved");
    expect(hasSeenWithdrawalRequestBanner("case-1", 1, "rejected")).toBe(false);
  });

  it("is scoped per requestId", () => {
    markWithdrawalRequestBannerSeen("case-1", 1, "approved");
    expect(hasSeenWithdrawalRequestBanner("case-1", 2, "approved")).toBe(false);
  });

  it("is scoped per case", () => {
    markWithdrawalRequestBannerSeen("case-1", 1, "approved");
    expect(hasSeenWithdrawalRequestBanner("case-2", 1, "approved")).toBe(false);
  });
});
