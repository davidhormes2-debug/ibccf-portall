// @vitest-environment jsdom
//
// Unit tests for stampDutyHistory — covers the normal forward-transition
// path and the high-water mark roll-back suppression introduced to keep
// the Activity Timeline consistent when an admin resets a stamp-duty
// approval back to an earlier status.

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordStampDutyObservation,
  getStampDutyHistory,
  hasSeenStampDutyBanner,
  markStampDutyBannerSeen,
  type StampDutySnapshot,
} from "../stampDutyHistory";

const snap = (
  status: StampDutySnapshot["status"],
  approvedAt: string | null = null,
): StampDutySnapshot => ({
  enabled: true,
  status,
  amount: "250",
  approvedAt,
});

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Guard rails — invalid inputs
// ---------------------------------------------------------------------------

describe("recordStampDutyObservation — invalid inputs", () => {
  it("returns isNew:false for an empty caseId", () => {
    const result = recordStampDutyObservation("", snap("approved"));
    expect(result).toEqual({ previous: null, isNew: false });
  });
});

// ---------------------------------------------------------------------------
// Normal forward transitions (no roll-backs involved)
// ---------------------------------------------------------------------------

describe("recordStampDutyObservation — forward transitions", () => {
  it("records the very first observation", () => {
    const result = recordStampDutyObservation("case-1", snap("awaiting_upload"));
    expect(result).toEqual({ previous: null, isNew: true });
    expect(getStampDutyHistory("case-1")).toHaveLength(1);
  });

  it("records a forward status change and returns the previous snapshot", () => {
    recordStampDutyObservation("case-1", snap("awaiting_upload"));
    const result = recordStampDutyObservation(
      "case-1",
      snap("awaiting_admin_approval"),
    );
    expect(result.isNew).toBe(true);
    expect(result.previous?.status).toBe("awaiting_upload");
    expect(getStampDutyHistory("case-1")).toHaveLength(2);
  });

  it("is idempotent — same snapshot twice does not append a duplicate", () => {
    recordStampDutyObservation("case-1", snap("awaiting_admin_approval"));
    const result = recordStampDutyObservation(
      "case-1",
      snap("awaiting_admin_approval"),
    );
    expect(result.isNew).toBe(false);
    expect(getStampDutyHistory("case-1")).toHaveLength(1);
  });

  it("records approval with approvedAt", () => {
    const approvedAt = "2024-06-01T10:00:00.000Z";
    recordStampDutyObservation("case-1", snap("awaiting_admin_approval"));
    const result = recordStampDutyObservation(
      "case-1",
      snap("approved", approvedAt),
      approvedAt,
    );
    expect(result.isNew).toBe(true);
    expect(result.previous?.status).toBe("awaiting_admin_approval");
    expect(getStampDutyHistory("case-1")).toHaveLength(2);
    expect(getStampDutyHistory("case-1")[1].snapshot.approvedAt).toBe(approvedAt);
  });
});

// ---------------------------------------------------------------------------
// Roll-back suppression (the core of this task)
// ---------------------------------------------------------------------------

describe("recordStampDutyObservation — roll-back suppression with highWaterApprovedAt", () => {
  const approvedAt = "2024-06-01T10:00:00.000Z";

  it("drops a roll-back when admin clears approvedAt (server reset)", () => {
    // Case was approved — local history records it.
    recordStampDutyObservation("case-1", snap("approved", approvedAt), approvedAt);

    // Admin resets status to awaiting_upload; approvedAt is now null on server.
    const result = recordStampDutyObservation(
      "case-1",
      snap("awaiting_upload", null),
      null,
    );
    expect(result.isNew).toBe(false);
    // History should be unchanged.
    expect(getStampDutyHistory("case-1")).toHaveLength(1);
    expect(getStampDutyHistory("case-1")[0].snapshot.status).toBe("approved");
  });

  it("uses highWaterApprovedAt as high-water even when local history is empty", () => {
    // First observation on this device, but server says it was already approved.
    const result = recordStampDutyObservation(
      "case-1",
      snap("awaiting_upload", null),
      approvedAt,
    );
    expect(result.isNew).toBe(false);
    expect(getStampDutyHistory("case-1")).toHaveLength(0);
  });

  it("picks the higher of highWaterApprovedAt and local history as the high-water", () => {
    // Local history recorded an approval.
    recordStampDutyObservation("case-1", snap("approved", approvedAt), approvedAt);

    // Server now reports an earlier approvedAt (e.g., race / lag).
    const earlierAt = "2024-05-01T00:00:00.000Z";
    const result = recordStampDutyObservation(
      "case-1",
      snap("awaiting_upload", null),
      earlierAt,
    );
    // Local HW (approvedAt) wins — the roll-back is still suppressed.
    expect(result.isNew).toBe(false);
    expect(getStampDutyHistory("case-1")).toHaveLength(1);
  });

  it("allows a later approvedAt to advance the record (forward path)", () => {
    const firstApprovedAt = "2024-06-01T10:00:00.000Z";
    const laterApprovedAt = "2024-07-01T10:00:00.000Z";

    // Record first approval.
    recordStampDutyObservation(
      "case-1",
      snap("approved", firstApprovedAt),
      firstApprovedAt,
    );
    // Admin re-approves later (e.g., after a re-upload cycle).
    const result = recordStampDutyObservation(
      "case-1",
      snap("approved", laterApprovedAt),
      laterApprovedAt,
    );
    expect(result.isNew).toBe(true);
    expect(getStampDutyHistory("case-1")).toHaveLength(2);
  });

  it("does not suppress when no high-water exists (null/undefined) — normal forward path", () => {
    const result = recordStampDutyObservation(
      "case-1",
      snap("awaiting_admin_approval"),
      null,
    );
    expect(result.isNew).toBe(true);
    expect(getStampDutyHistory("case-1")).toHaveLength(1);
  });

  it("does not suppress when highWaterApprovedAt is undefined", () => {
    const result = recordStampDutyObservation(
      "case-1",
      snap("awaiting_admin_approval"),
      undefined,
    );
    expect(result.isNew).toBe(true);
  });

  it("keeps the timeline clean across roll-back + re-advance", () => {
    // Upload → admin-approval → approved.
    recordStampDutyObservation("case-1", snap("awaiting_upload"));
    recordStampDutyObservation("case-1", snap("awaiting_admin_approval"));
    recordStampDutyObservation("case-1", snap("approved", approvedAt), approvedAt);

    // Admin resets to awaiting_upload — suppressed.
    recordStampDutyObservation("case-1", snap("awaiting_upload", null), null);

    // Admin re-approves with a new timestamp.
    const newApprovedAt = "2024-08-01T00:00:00.000Z";
    recordStampDutyObservation(
      "case-1",
      snap("approved", newApprovedAt),
      newApprovedAt,
    );

    const history = getStampDutyHistory("case-1");
    expect(history).toHaveLength(4);
    expect(history.map((e) => e.snapshot.status)).toEqual([
      "awaiting_upload",
      "awaiting_admin_approval",
      "approved",
      "approved",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Banner seen helpers (regression guard)
// ---------------------------------------------------------------------------

describe("hasSeenStampDutyBanner / markStampDutyBannerSeen", () => {
  it("returns false before the banner has been marked seen", () => {
    expect(hasSeenStampDutyBanner("case-1", "approved")).toBe(false);
  });

  it("returns true after marking the banner seen", () => {
    markStampDutyBannerSeen("case-1", "approved");
    expect(hasSeenStampDutyBanner("case-1", "approved")).toBe(true);
  });

  it("is scoped per status — marking one does not affect another", () => {
    markStampDutyBannerSeen("case-1", "approved");
    expect(hasSeenStampDutyBanner("case-1", "rejected")).toBe(false);
  });

  it("is scoped per case", () => {
    markStampDutyBannerSeen("case-1", "approved");
    expect(hasSeenStampDutyBanner("case-2", "approved")).toBe(false);
  });
});
