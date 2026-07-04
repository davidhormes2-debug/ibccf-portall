// @vitest-environment jsdom
//
// Tests for usePendingCountsPolling (client/src/hooks/usePendingCountsPolling.ts).
//
// Contracts verified:
//   1. loadUserDocPendingCounts is called once on mount.
//   2. loadUserDocPendingCounts is called again on each interval tick.
//   3. loadUserDocPendingCounts is called when the tab becomes visible again.
//   4. loadUserDocPendingCounts is NOT called when visibilityState becomes 'hidden'.
//   5. The interval is cleared and the listener is removed on unmount.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { usePendingCountsPolling } from "../usePendingCountsPolling";

// ── Test harness component ────────────────────────────────────────────────────
function PollingHarness({
  loadFn,
  intervalMs = 3000,
}: {
  loadFn: () => void;
  intervalMs?: number;
}) {
  usePendingCountsPolling(loadFn, intervalMs);
  return null;
}

// ── Flush helpers ─────────────────────────────────────────────────────────────
async function advanceAndFlush(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("usePendingCountsPolling – mount behaviour", () => {
  it("calls loadFn once on mount", async () => {
    const loadFn = vi.fn();

    render(React.createElement(PollingHarness, { loadFn }));
    await flushEffects();

    expect(loadFn).toHaveBeenCalledTimes(1);
  });

  it("calls loadFn on each interval tick", async () => {
    const loadFn = vi.fn();

    render(React.createElement(PollingHarness, { loadFn, intervalMs: 3000 }));
    await flushEffects();

    const callsAfterMount = loadFn.mock.calls.length;

    await advanceAndFlush(3000);
    expect(loadFn.mock.calls.length).toBe(callsAfterMount + 1);

    await advanceAndFlush(3000);
    expect(loadFn.mock.calls.length).toBe(callsAfterMount + 2);
  });

  it("respects a custom intervalMs", async () => {
    const loadFn = vi.fn();

    render(React.createElement(PollingHarness, { loadFn, intervalMs: 1000 }));
    await flushEffects();

    const callsAfterMount = loadFn.mock.calls.length;

    // After 1 s with a 1 s interval, exactly one more call should have fired.
    await advanceAndFlush(1000);
    expect(loadFn.mock.calls.length).toBe(callsAfterMount + 1);

    // Nothing more before the next second elapses.
    await advanceAndFlush(500);
    expect(loadFn.mock.calls.length).toBe(callsAfterMount + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("usePendingCountsPolling – visibility restore", () => {
  it("calls loadFn when the tab becomes visible", async () => {
    const loadFn = vi.fn();

    render(React.createElement(PollingHarness, { loadFn }));
    await flushEffects();

    const callsAfterMount = loadFn.mock.calls.length;

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(loadFn.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("does NOT call loadFn when visibilityState becomes 'hidden'", async () => {
    const loadFn = vi.fn();

    render(React.createElement(PollingHarness, { loadFn }));
    await flushEffects();

    const callsAfterMount = loadFn.mock.calls.length;

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(loadFn.mock.calls.length).toBe(callsAfterMount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("usePendingCountsPolling – cleanup on unmount", () => {
  it("stops polling after the component unmounts", async () => {
    const loadFn = vi.fn();

    const { unmount } = render(
      React.createElement(PollingHarness, { loadFn, intervalMs: 3000 }),
    );
    await flushEffects();

    unmount();
    loadFn.mockClear();

    // Advancing past the interval should NOT trigger any more calls.
    await advanceAndFlush(9000);

    expect(loadFn).not.toHaveBeenCalled();
  });

  it("removes the visibilitychange listener after unmount", async () => {
    const loadFn = vi.fn();

    const { unmount } = render(React.createElement(PollingHarness, { loadFn }));
    await flushEffects();

    unmount();
    loadFn.mockClear();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(loadFn).not.toHaveBeenCalled();
  });
});
