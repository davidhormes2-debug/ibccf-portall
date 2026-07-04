import { describe, it, expect, beforeEach } from "vitest";
import {
  recordEmailFailure,
  getRecentFailureCount,
  _resetFailureCounter,
} from "../services/emailFailureAlert";

// ============================================================================
// In-process rolling email failure counter
//
// These tests use the real module (no mocks) to verify that:
//   1. The counter starts at zero after reset.
//   2. Each recordEmailFailure() call increments the count.
//   3. Failures outside the requested window are excluded.
// ============================================================================

describe("emailFailureAlert — rolling failure counter", () => {
  beforeEach(() => {
    _resetFailureCounter();
  });

  it("starts at zero after reset", () => {
    expect(getRecentFailureCount()).toBe(0);
  });

  it("increments on each recorded failure", () => {
    recordEmailFailure();
    recordEmailFailure();
    expect(getRecentFailureCount()).toBe(2);
  });

  it("respects the window (entries outside window are excluded)", () => {
    recordEmailFailure();
    // A negative window produces a cutoff in the future — no recorded
    // failure can have a timestamp ahead of now, so the count is 0.
    expect(getRecentFailureCount(-1)).toBe(0);
    // But the default 10-minute window includes the failure we just recorded.
    expect(getRecentFailureCount()).toBe(1);
  });

  it("counts multiple failures within the window", () => {
    recordEmailFailure();
    recordEmailFailure();
    recordEmailFailure();
    expect(getRecentFailureCount(10 * 60 * 1000)).toBe(3);
  });
});
