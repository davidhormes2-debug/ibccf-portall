// @vitest-environment jsdom
//
// Unit tests for withdrawalActivationHistory — covers the normal
// forward-transition path and the high-water mark roll-back suppression
// introduced to keep the Activity Timeline consistent when an admin resets
// the withdrawal-activation status back to an earlier value.

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordActivationObservation,
  getActivationHistory,
  hasSeenActivationBanner,
  markActivationBannerSeen,
  type WithdrawalActivationSnapshot,
} from "../withdrawalActivationHistory";

const snap = (
  status: string,
  approvedAt: string | null = null,
): WithdrawalActivationSnapshot => ({ status, approvedAt });

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Guard rails — invalid inputs
// ---------------------------------------------------------------------------

describe("recordActivationObservation — invalid inputs", () => {
  it("returns isNew:false for an empty caseId", () => {
    const result = recordActivationObservation("", snap("approved"));
    expect(result).toEqual({ previous: null, isNew: false });
  });

  it("returns isNew:false for an empty status", () => {
    const result = recordActivationObservation("case-1", snap(""));
    expect(result).toEqual({ previous: null, isNew: false });
  });
});

// ---------------------------------------------------------------------------
// Normal forward transitions (no roll-backs involved)
// ---------------------------------------------------------------------------

describe("recordActivationObservation — forward transitions", () => {
  it("records the very first status observation", () => {
    const result = recordActivationObservation("case-1", snap("pending_address"));
    expect(result).toEqual({ previous: null, isNew: true });
    expect(getActivationHistory("case-1")).toHaveLength(1);
    expect(getActivationHistory("case-1")[0].snapshot.status).toBe(
      "pending_address",
    );
  });

  it("records a forward status change and returns the previous snapshot", () => {
    recordActivationObservation("case-1", snap("pending_address"));
    const result = recordActivationObservation("case-1", snap("receipt_uploaded"));
    expect(result.isNew).toBe(true);
    expect(result.previous?.status).toBe("pending_address");
    expect(getActivationHistory("case-1")).toHaveLength(2);
  });

  it("is idempotent — same snapshot twice does not append a duplicate", () => {
    recordActivationObservation("case-1", snap("receipt_uploaded"));
    const result = recordActivationObservation("case-1", snap("receipt_uploaded"));
    expect(result.isNew).toBe(false);
    expect(getActivationHistory("case-1")).toHaveLength(1);
  });

  it("builds a multi-step ascending history", () => {
    ["pending_address", "receipt_uploaded", "approved"].forEach((s) =>
      recordActivationObservation("case-1", snap(s)),
    );
    const statuses = getActivationHistory("case-1").map(
      (e) => e.snapshot.status,
    );
    expect(statuses).toEqual(["pending_address", "receipt_uploaded", "approved"]);
  });

  it("records approval with approvedAt and returns isNew:true", () => {
    const approvedAt = "2024-06-01T10:00:00.000Z";
    recordActivationObservation("case-1", snap("receipt_uploaded"));
    const result = recordActivationObservation(
      "case-1",
      snap("approved", approvedAt),
      approvedAt,
    );
    expect(result.isNew).toBe(true);
    expect(result.previous?.status).toBe("receipt_uploaded");
    const history = getActivationHistory("case-1");
    expect(history).toHaveLength(2);
    expect(history[1].snapshot.approvedAt).toBe(approvedAt);
  });
});

// ---------------------------------------------------------------------------
// Roll-back suppression (the core of this task)
// ---------------------------------------------------------------------------

describe("recordActivationObservation — roll-back suppression with highWaterApprovedAt", () => {
  const approvedAt = "2024-06-01T10:00:00.000Z";

  it("drops a roll-back when admin clears approvedAt (server reset)", () => {
    // Case was approved — local history records it.
    recordActivationObservation("case-1", snap("approved", approvedAt), approvedAt);

    // Admin resets status to pending_address; approvedAt is now null on server.
    const result = recordActivationObservation(
      "case-1",
      snap("pending_address", null),
      null,
    );
    expect(result.isNew).toBe(false);
    // History should be unchanged.
    expect(getActivationHistory("case-1")).toHaveLength(1);
    expect(getActivationHistory("case-1")[0].snapshot.status).toBe("approved");
  });

  it("uses highWaterApprovedAt as high-water even when local history is empty", () => {
    // First observation on this device; server already has an approval
    // recorded (highWaterApprovedAt set) but the current snapshot has
    // no approvedAt (admin rolled back status to pending_address while
    // retaining the historical timestamp as a server high-water hint).
    const result = recordActivationObservation(
      "case-1",
      snap("pending_address", null),
      approvedAt,
    );
    expect(result.isNew).toBe(false);
    expect(getActivationHistory("case-1")).toHaveLength(0);
  });

  it("suppresses when server currently has null approvedAt but local history saw one", () => {
    // Record approval locally.
    recordActivationObservation("case-1", snap("approved", approvedAt), approvedAt);
    // Reload: server now has null approvedAt (admin reset).
    const result = recordActivationObservation(
      "case-1",
      snap("pending_address", null),
      null,
    );
    expect(result.isNew).toBe(false);
    expect(getActivationHistory("case-1")).toHaveLength(1);
  });

  it("picks the higher of highWaterApprovedAt and local history as the high-water mark", () => {
    // Local history records an approval.
    recordActivationObservation("case-1", snap("approved", approvedAt), approvedAt);

    // Server now reports an earlier approvedAt (lag/race), snapshot has null.
    const earlierAt = "2024-05-01T00:00:00.000Z";
    const result = recordActivationObservation(
      "case-1",
      snap("pending_address", null),
      earlierAt,
    );
    // Local HW (approvedAt) wins — the roll-back is still suppressed.
    expect(result.isNew).toBe(false);
    expect(getActivationHistory("case-1")).toHaveLength(1);
  });

  it("allows a later approvedAt to advance the record (forward path)", () => {
    const laterApprovedAt = "2024-07-01T10:00:00.000Z";

    recordActivationObservation("case-1", snap("approved", approvedAt), approvedAt);
    const result = recordActivationObservation(
      "case-1",
      snap("approved", laterApprovedAt),
      laterApprovedAt,
    );
    expect(result.isNew).toBe(true);
    expect(getActivationHistory("case-1")).toHaveLength(2);
  });

  it("does not suppress when no high-water exists (null) — normal forward path", () => {
    const result = recordActivationObservation(
      "case-1",
      snap("receipt_uploaded", null),
      null,
    );
    expect(result.isNew).toBe(true);
    expect(getActivationHistory("case-1")).toHaveLength(1);
  });

  it("does not suppress when highWaterApprovedAt is undefined", () => {
    const result = recordActivationObservation(
      "case-1",
      snap("receipt_uploaded"),
      undefined,
    );
    expect(result.isNew).toBe(true);
  });

  it("keeps the timeline clean across roll-back + re-advance", () => {
    // Advance through statuses to approved.
    recordActivationObservation("case-1", snap("pending_address"));
    recordActivationObservation("case-1", snap("receipt_uploaded"));
    recordActivationObservation("case-1", snap("approved", approvedAt), approvedAt);

    // Admin resets to pending_address with null approvedAt — suppressed.
    recordActivationObservation("case-1", snap("pending_address", null), null);

    // Admin re-approves with a later timestamp.
    const newApprovedAt = "2024-08-01T00:00:00.000Z";
    recordActivationObservation(
      "case-1",
      snap("approved", newApprovedAt),
      newApprovedAt,
    );

    const history = getActivationHistory("case-1");
    expect(history).toHaveLength(4);
    expect(history.map((e) => e.snapshot.status)).toEqual([
      "pending_address",
      "receipt_uploaded",
      "approved",
      "approved",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Banner seen helpers (regression guard)
// ---------------------------------------------------------------------------

describe("hasSeenActivationBanner / markActivationBannerSeen", () => {
  it("returns false before the banner has been marked seen", () => {
    expect(hasSeenActivationBanner("case-1", "approved")).toBe(false);
  });

  it("returns true after marking the banner seen", () => {
    markActivationBannerSeen("case-1", "approved");
    expect(hasSeenActivationBanner("case-1", "approved")).toBe(true);
  });

  it("is scoped per status — marking one does not affect another", () => {
    markActivationBannerSeen("case-1", "approved");
    expect(hasSeenActivationBanner("case-1", "rejected")).toBe(false);
  });

  it("is scoped per case", () => {
    markActivationBannerSeen("case-1", "approved");
    expect(hasSeenActivationBanner("case-2", "approved")).toBe(false);
  });
});
