// @vitest-environment jsdom
//
// Tests for usePendingCountsSync (client/src/hooks/usePendingCountsSync.ts).
//
// Four core contracts (from task spec):
//   C1. When a BroadcastChannel message arrives, setCountsFn is called with
//       the received counts.
//   C2. broadcast(counts) posts the correct message shape to the channel.
//   C3. isRecentBroadcast() returns true immediately after receipt and false
//       after the staleness window expires.
//   C4. When BroadcastChannel is unavailable (stubbed as undefined), the hook
//       still polls independently (graceful no-op for the BC path).
//
// Additional contracts:
//   5. fetchFn is called on mount (initial load for all tabs).
//   6. The leader tab (lock acquired) polls fetchFn on each interval tick.
//   7. A follower tab (lock NOT granted) does NOT poll on interval ticks;
//      it relies solely on BroadcastChannel messages from the leader.
//   8. All tabs reload on visibility restore (visibilityState === 'visible').
//   9. When Web Locks is unavailable every tab polls independently (fallback).
//  10. Two simultaneous instances — only the leader fetches on interval ticks.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import {
  usePendingCountsSync,
  isRecentBroadcast,
  _resetBroadcastTimestamp,
  RECENT_BROADCAST_WINDOW_MS,
  STALE_THRESHOLD_MULTIPLIER,
} from "../usePendingCountsSync";

// ── BroadcastChannel mock ────────────────────────────────────────────────────
interface FakeChannel {
  name: string;
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

let channels: FakeChannel[] = [];

class FakeBroadcastChannel {
  name: string;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage = vi.fn((data: unknown) => {
    // Deliver to all OTHER channels with the same name.
    channels
      .filter((c) => c !== (this as unknown as FakeChannel) && c.name === this.name)
      .forEach((c) => c.onmessage?.({ data }));
  });
  close = vi.fn(() => {
    channels = channels.filter((c) => c !== (this as unknown as FakeChannel));
  });
  constructor(name: string) {
    this.name = name;
    channels.push(this as unknown as FakeChannel);
  }
}

// ── Web Locks mock ───────────────────────────────────────────────────────────
type LockCallback = () => Promise<void>;
let pendingLockCallbacks: Map<string, LockCallback[]> = new Map();

function makeLocksAPI(grantImmediately: boolean) {
  return {
    request: vi.fn((name: string, _opts: unknown, callback: LockCallback) => {
      if (grantImmediately) {
        void callback();
        return Promise.resolve();
      }
      const q = pendingLockCallbacks.get(name) ?? [];
      pendingLockCallbacks.set(name, [...q, callback]);
      return Promise.resolve();
    }),
  };
}

// Grant the pending lock to the next waiting requester (non-blocking).
function grantNextLock(name = "ibccf-pending-counts-leader") {
  const q = pendingLockCallbacks.get(name) ?? [];
  const cb = q.shift();
  pendingLockCallbacks.set(name, q);
  if (cb) void cb();
}

// ── Flush helpers ─────────────────────────────────────────────────────────────
async function advanceAndFlush(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ── Test harness component ────────────────────────────────────────────────────
function SyncHarness({
  fetchFn,
  setCountsFn,
  intervalMs = 3000,
  staleThresholdMs,
}: {
  fetchFn: () => Promise<Record<string, number> | null>;
  setCountsFn: (counts: Record<string, number>) => void;
  intervalMs?: number;
  staleThresholdMs?: number;
}) {
  usePendingCountsSync(fetchFn, setCountsFn, intervalMs, staleThresholdMs);
  return null;
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  channels = [];
  pendingLockCallbacks = new Map();
  _resetBroadcastTimestamp();

  (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
    FakeBroadcastChannel;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as unknown as Record<string, unknown>).BroadcastChannel;
  _resetBroadcastTimestamp();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).locks;
  } catch {
    /* non-configurable — leave as-is */
  }
});

// ── helpers ───────────────────────────────────────────────────────────────────
function makeFetchFn(counts: Record<string, number> = { "case-1": 2 }) {
  return vi.fn(async () => counts);
}

// ─────────────────────────────────────────────────────────────────────────────
// C1 — BroadcastChannel receive → setCountsFn is called
// ─────────────────────────────────────────────────────────────────────────────
describe("C1: BroadcastChannel message → setCountsFn receives the counts", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(false), // follower tab — lock never granted
      writable: true,
      configurable: true,
    });
  });

  it("calls setCountsFn with the counts payload from an incoming message", async () => {
    const fetchFn = makeFetchFn({});
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn }));
    await flushEffects();
    setCountsFn.mockClear();

    // Simulate the leader tab broadcasting to the follower's channel.
    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: { type: "sync-update", data: { "case-2": 7 } },
      });
    });

    expect(setCountsFn).toHaveBeenCalledTimes(1);
    expect(setCountsFn).toHaveBeenCalledWith({ "case-2": 7 });
  });

  it("ignores messages with an unrecognised type", async () => {
    const fetchFn = makeFetchFn({});
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn }));
    await flushEffects();
    setCountsFn.mockClear();

    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: { type: "unknown-event", counts: { "case-2": 7 } },
      });
    });

    expect(setCountsFn).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C2 — broadcast(counts) posts the correct message shape
// ─────────────────────────────────────────────────────────────────────────────
describe("C2: broadcast(counts) posts the correct message shape", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(true), // leader tab — lock granted immediately
      writable: true,
      configurable: true,
    });
  });

  it("posts a message with type='sync-update' and the fetched counts", async () => {
    const counts = { "case-1": 5 };
    const fetchFn = makeFetchFn(counts);
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn }));
    await flushEffects();

    const channel = channels[0];
    expect(channel).toBeDefined();

    const broadcastCall = channel?.postMessage.mock.calls.find(
      ([msg]) =>
        msg?.type === "sync-update" &&
        JSON.stringify(msg.data) === JSON.stringify(counts),
    );
    expect(broadcastCall).toBeDefined();
  });

  it("delivers the broadcast to sibling channels on the same name", async () => {
    // Register a second channel with the same name to act as a sibling tab.
    const sibling = new FakeBroadcastChannel("ibccf-pending-counts") as unknown as FakeChannel;
    const siblingHandler = vi.fn();
    sibling.onmessage = siblingHandler;

    const counts = { "case-3": 3 };
    const fetchFn = makeFetchFn(counts);

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn: vi.fn() }));
    await flushEffects();

    // The sibling should have received the broadcast.
    const receivedCounts = siblingHandler.mock.calls.find(
      ([e]) =>
        e?.data?.type === "sync-update" &&
        JSON.stringify(e.data.data) === JSON.stringify(counts),
    );
    expect(receivedCounts).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C3 — isRecentBroadcast() timing behaviour
// ─────────────────────────────────────────────────────────────────────────────
describe("C3: isRecentBroadcast() timing", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(false), // follower tab
      writable: true,
      configurable: true,
    });
  });

  it("returns false before any broadcast is received", () => {
    expect(isRecentBroadcast()).toBe(false);
  });

  it("returns true immediately after a broadcast is received", async () => {
    render(React.createElement(SyncHarness, { fetchFn: makeFetchFn({}), setCountsFn: vi.fn() }));
    await flushEffects();

    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: { type: "sync-update", data: { "case-1": 1 } },
      });
    });

    expect(isRecentBroadcast()).toBe(true);
  });

  it("returns true with a custom window that has not yet expired", async () => {
    render(React.createElement(SyncHarness, { fetchFn: makeFetchFn({}), setCountsFn: vi.fn() }));
    await flushEffects();

    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: { type: "sync-update", data: { "case-1": 1 } },
      });
    });

    // Advance to just before the window closes.
    await advanceAndFlush(RECENT_BROADCAST_WINDOW_MS - 1);
    expect(isRecentBroadcast(RECENT_BROADCAST_WINDOW_MS)).toBe(true);
  });

  it("returns false after the staleness window expires", async () => {
    render(React.createElement(SyncHarness, { fetchFn: makeFetchFn({}), setCountsFn: vi.fn() }));
    await flushEffects();

    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: { type: "sync-update", data: { "case-1": 1 } },
      });
    });

    // Advance past the full window.
    await advanceAndFlush(RECENT_BROADCAST_WINDOW_MS + 1);
    expect(isRecentBroadcast(RECENT_BROADCAST_WINDOW_MS)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C4 — BroadcastChannel unavailable → graceful no-op for BC path
// ─────────────────────────────────────────────────────────────────────────────
describe("C4: BroadcastChannel unavailable — hook is a no-op for the BC path", () => {
  it("does not throw and still polls when BroadcastChannel is undefined", async () => {
    delete (globalThis as unknown as Record<string, unknown>).BroadcastChannel;

    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(true),
      writable: true,
      configurable: true,
    });

    const fetchFn = makeFetchFn({ "case-1": 1 });
    const setCountsFn = vi.fn();

    expect(() =>
      render(React.createElement(SyncHarness, { fetchFn, setCountsFn, intervalMs: 3000 })),
    ).not.toThrow();
    await flushEffects();

    // No BroadcastChannel instances were created.
    expect(channels).toHaveLength(0);

    // The hook still fetches and sets state.
    expect(fetchFn).toHaveBeenCalled();
    expect(setCountsFn).toHaveBeenCalled();
  });

  it("isRecentBroadcast() always returns false when BC is unavailable (no messages received)", () => {
    delete (globalThis as unknown as Record<string, unknown>).BroadcastChannel;
    _resetBroadcastTimestamp();
    expect(isRecentBroadcast()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: leader tab polling behaviour
// ─────────────────────────────────────────────────────────────────────────────
describe("usePendingCountsSync – leader tab (lock acquired immediately)", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(true),
      writable: true,
      configurable: true,
    });
  });

  it("calls fetchFn on mount and updates state", async () => {
    const counts = { "case-1": 3 };
    const fetchFn = makeFetchFn(counts);
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn }));
    await flushEffects();

    expect(fetchFn).toHaveBeenCalled();
    expect(setCountsFn).toHaveBeenCalledWith(counts);
  });

  it("polls fetchFn on each interval tick", async () => {
    const fetchFn = makeFetchFn();
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn, intervalMs: 3000 }));
    await flushEffects();

    const callsAfterMount = fetchFn.mock.calls.length;
    await advanceAndFlush(3000);

    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("broadcasts fetched counts over BroadcastChannel", async () => {
    const counts = { "case-1": 5 };
    const fetchFn = makeFetchFn(counts);
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn }));
    await flushEffects();

    const channelForHook = channels[0];
    expect(channelForHook).toBeDefined();

    const broadcastedCounts = channelForHook?.postMessage.mock.calls.some(
      ([msg]) =>
        msg?.type === "sync-update" &&
        JSON.stringify(msg.data) === JSON.stringify(counts),
    );
    expect(broadcastedCounts).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: follower tab behaviour
// ─────────────────────────────────────────────────────────────────────────────
describe("usePendingCountsSync – follower tab (lock NOT granted)", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(false),
      writable: true,
      configurable: true,
    });
  });

  it("does NOT poll on interval ticks while awaiting the leader lock", async () => {
    const fetchFn = makeFetchFn();
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn, intervalMs: 3000 }));
    await flushEffects();

    const callsAfterMount = fetchFn.mock.calls.length;

    await advanceAndFlush(9000);

    expect(fetchFn.mock.calls.length).toBe(callsAfterMount);
  });

  it("updates state when a BroadcastChannel message arrives from the leader", async () => {
    const fetchFn = makeFetchFn({});
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn }));
    await flushEffects();
    setCountsFn.mockClear();

    // Simulate the leader broadcasting fresh counts.
    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: { type: "sync-update", data: { "case-2": 7 } },
      });
    });

    expect(setCountsFn).toHaveBeenCalledWith({ "case-2": 7 });
  });


  it("promotes to leader and starts polling once the lock is granted", async () => {
    const fetchFn = makeFetchFn({ "case-1": 1 });
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn, intervalMs: 3000 }));
    await flushEffects();

    const callsBeforePromotion = fetchFn.mock.calls.length;

    grantNextLock();
    await flushEffects();

    await advanceAndFlush(3000);

    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsBeforePromotion);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: visibility restore
// ─────────────────────────────────────────────────────────────────────────────
describe("usePendingCountsSync – visibility restore", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(false),
      writable: true,
      configurable: true,
    });
  });

  it("calls fetchFn when the tab becomes visible", async () => {
    const fetchFn = makeFetchFn({ "case-3": 4 });
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn }));
    await flushEffects();

    const callsAfterMount = fetchFn.mock.calls.length;

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("does NOT call fetchFn when visibilityState is 'hidden'", async () => {
    const fetchFn = makeFetchFn();
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn }));
    await flushEffects();

    const callsAfterMount = fetchFn.mock.calls.length;

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(fetchFn.mock.calls.length).toBe(callsAfterMount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: fallback when Web Locks unavailable
// ─────────────────────────────────────────────────────────────────────────────
describe("usePendingCountsSync – fallback: Web Locks unavailable", () => {
  it("polls independently when navigator.locks does not exist", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if ("locks" in nav) {
      delete nav.locks;
    }

    const fetchFn = makeFetchFn({ "case-1": 1 });
    const setCountsFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setCountsFn, intervalMs: 3000 }));
    await flushEffects();

    const callsAfterMount = fetchFn.mock.calls.length;
    await advanceAndFlush(3000);

    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("ALL tabs poll independently when BroadcastChannel is unavailable (multi-tab fallback)", async () => {
    delete (globalThis as unknown as Record<string, unknown>).BroadcastChannel;

    let granted = 0;
    Object.defineProperty(navigator, "locks", {
      value: {
        request: vi.fn((_name: string, _opts: unknown, cb: LockCallback) => {
          if (granted === 0) {
            granted++;
            void cb();
          }
          return Promise.resolve();
        }),
      },
      writable: true,
      configurable: true,
    });

    const fetchA = makeFetchFn({ "case-1": 1 });
    const fetchB = makeFetchFn({ "case-1": 1 });

    render(React.createElement(SyncHarness, { fetchFn: fetchA, setCountsFn: vi.fn(), intervalMs: 3000 }));
    render(React.createElement(SyncHarness, { fetchFn: fetchB, setCountsFn: vi.fn(), intervalMs: 3000 }));

    await flushEffects();
    fetchA.mockClear();
    fetchB.mockClear();

    await advanceAndFlush(3000);

    expect(fetchA.mock.calls.length).toBeGreaterThan(0);
    expect(fetchB.mock.calls.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: stale-on-restore threshold
// ─────────────────────────────────────────────────────────────────────────────
describe("usePendingCountsSync – stale-on-restore threshold", () => {
  const INTERVAL_MS = 3000;
  const THRESHOLD_MS = INTERVAL_MS * STALE_THRESHOLD_MULTIPLIER;

  let locksRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    locksRequestMock = vi.fn((_name: string, _opts: unknown, cb: LockCallback) => {
      // Never grant — this tab stays a follower for initial lock request.
      return Promise.resolve();
    });
    Object.defineProperty(navigator, "locks", {
      value: { request: locksRequestMock },
      writable: true,
      configurable: true,
    });
  });

  it("STALE_THRESHOLD_MULTIPLIER is 2", () => {
    expect(STALE_THRESHOLD_MULTIPLIER).toBe(2);
  });

  it("does NOT use steal:true when the tab was hidden for less than the threshold", async () => {
    render(
      React.createElement(SyncHarness, {
        fetchFn: makeFetchFn(),
        setCountsFn: vi.fn(),
        intervalMs: INTERVAL_MS,
      }),
    );
    await flushEffects();
    locksRequestMock.mockClear();

    // Hide the tab.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Advance time by less than the threshold.
    await advanceAndFlush(THRESHOLD_MS - 1);

    // Restore the tab.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // No steal request should have been made.
    const stealCalls = locksRequestMock.mock.calls.filter(
      ([, opts]) => (opts as Record<string, unknown>)?.steal === true,
    );
    expect(stealCalls).toHaveLength(0);
  });

  it("uses steal:true when the tab was hidden for longer than the threshold", async () => {
    render(
      React.createElement(SyncHarness, {
        fetchFn: makeFetchFn(),
        setCountsFn: vi.fn(),
        intervalMs: INTERVAL_MS,
      }),
    );
    await flushEffects();
    locksRequestMock.mockClear();

    // Hide the tab.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Advance time past the threshold.
    await advanceAndFlush(THRESHOLD_MS + 1);

    // Restore the tab.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // A steal request must have been made.
    const stealCalls = locksRequestMock.mock.calls.filter(
      ([, opts]) => (opts as Record<string, unknown>)?.steal === true,
    );
    expect(stealCalls).toHaveLength(1);
    expect(stealCalls[0][0]).toBe("ibccf-pending-counts-leader");
    expect(stealCalls[0][1]).toMatchObject({ mode: "exclusive", steal: true });
  });

  it("does NOT use steal:true when the tab is already the leader", async () => {
    // Grant the lock immediately so this tab becomes the leader.
    locksRequestMock = vi.fn((_name: string, _opts: unknown, cb: LockCallback) => {
      void cb();
      return Promise.resolve();
    });
    Object.defineProperty(navigator, "locks", {
      value: { request: locksRequestMock },
      writable: true,
      configurable: true,
    });

    render(
      React.createElement(SyncHarness, {
        fetchFn: makeFetchFn(),
        setCountsFn: vi.fn(),
        intervalMs: INTERVAL_MS,
      }),
    );
    await flushEffects();
    locksRequestMock.mockClear();

    // Hide the tab.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Advance past the threshold — leader should NOT steal from itself.
    await advanceAndFlush(THRESHOLD_MS + 1);

    // Restore the tab.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    const stealCalls = locksRequestMock.mock.calls.filter(
      ([, opts]) => (opts as Record<string, unknown>)?.steal === true,
    );
    expect(stealCalls).toHaveLength(0);
  });

  it("accepts a custom staleThresholdMs and triggers steal at that threshold", async () => {
    const customThreshold = 10000;

    render(
      React.createElement(SyncHarness, {
        fetchFn: makeFetchFn(),
        setCountsFn: vi.fn(),
        intervalMs: INTERVAL_MS,
        staleThresholdMs: customThreshold,
      }),
    );
    await flushEffects();
    locksRequestMock.mockClear();

    // Hide the tab.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Advance past the default threshold but NOT past the custom threshold.
    await advanceAndFlush(THRESHOLD_MS + 1);

    // Restore the tab — should NOT steal yet.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    const stealCallsBefore = locksRequestMock.mock.calls.filter(
      ([, opts]) => (opts as Record<string, unknown>)?.steal === true,
    ).length;
    expect(stealCallsBefore).toBe(0);

    // Now hide again and advance past the custom threshold.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    await advanceAndFlush(customThreshold + 1);

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    const stealCallsAfter = locksRequestMock.mock.calls.filter(
      ([, opts]) => (opts as Record<string, unknown>)?.steal === true,
    ).length;
    expect(stealCallsAfter).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: leader interval reset on visibility restore
// ─────────────────────────────────────────────────────────────────────────────
describe("usePendingCountsSync – leader interval reset on visibility restore", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(true), // leader tab — lock granted immediately
      writable: true,
      configurable: true,
    });
  });

  it("resets the polling interval when the leader tab restores from hidden", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    render(
      React.createElement(SyncHarness, {
        fetchFn: makeFetchFn(),
        setCountsFn: vi.fn(),
        intervalMs: 3000,
      }),
    );
    await flushEffects();

    const callsAfterMount = setIntervalSpy.mock.calls.length;

    // Hide the tab (simulating browser background throttling).
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Restore the tab.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The leader must have created a fresh interval to eliminate drift.
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("polls at the correct cadence after a visibility restore (fresh interval, not drifted)", async () => {
    const fetchFn = makeFetchFn();
    const setCountsFn = vi.fn();

    render(
      React.createElement(SyncHarness, {
        fetchFn,
        setCountsFn,
        intervalMs: 3000,
      }),
    );
    await flushEffects();

    // Consume the initial mount fetch.
    fetchFn.mockClear();

    // Advance almost to the next interval tick, then hide the tab.
    await advanceAndFlush(2900);

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Advance past the original interval boundary while hidden.
    await advanceAndFlush(200);

    // Restore the tab — the interval should now reset.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The restore itself triggers an immediate safety fetch.
    const callsAfterRestore = fetchFn.mock.calls.length;
    expect(callsAfterRestore).toBeGreaterThan(0);

    fetchFn.mockClear();

    // Advancing exactly one interval from restore should produce the next tick.
    await advanceAndFlush(3000);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: follower-to-leader promotion interval reset (Task #518)
// ─────────────────────────────────────────────────────────────────────────────
describe("usePendingCountsSync – follower steal → interval reset at promotion moment", () => {
  const INTERVAL_MS = 3000;
  const THRESHOLD_MS = INTERVAL_MS * STALE_THRESHOLD_MULTIPLIER;

  it("next interval tick fires at ~intervalMs after the steal, not from a drifted earlier reference", async () => {
    // Lock mock: never grant the initial request (follower), but grant steal
    // requests (steal: true) immediately so the promotion callback fires
    // synchronously in the test.
    const locksRequestMock = vi.fn(
      (_name: string, opts: Record<string, unknown>, cb: LockCallback) => {
        if (opts?.steal === true) {
          void cb();
        }
        // Initial exclusive request is NOT granted → tab stays a follower.
        return Promise.resolve();
      },
    );
    Object.defineProperty(navigator, "locks", {
      value: { request: locksRequestMock },
      writable: true,
      configurable: true,
    });

    const fetchFn = makeFetchFn({ "case-steal": 1 });
    const setCountsFn = vi.fn();

    render(
      React.createElement(SyncHarness, {
        fetchFn,
        setCountsFn,
        intervalMs: INTERVAL_MS,
      }),
    );
    await flushEffects();

    // ── hide the tab ──────────────────────────────────────────────────────────
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Advance past the stale threshold while hidden.
    await advanceAndFlush(THRESHOLD_MS + 1);

    // ── restore the tab (triggers steal) ─────────────────────────────────────
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Confirm the steal was attempted.
    const stealCalls = locksRequestMock.mock.calls.filter(
      ([, opts]) => (opts as Record<string, unknown>)?.steal === true,
    );
    expect(stealCalls).toHaveLength(1);

    // Clear fetch calls from the restore + immediate leaderPoll so we only
    // count interval ticks from the promotion moment onwards.
    fetchFn.mockClear();

    // Advancing less than one full interval should NOT produce a tick.
    await advanceAndFlush(INTERVAL_MS - 100);
    const callsBeforeTick = fetchFn.mock.calls.length;

    // Advancing the remaining slice completes exactly one interval from the
    // steal moment and should produce the first scheduled tick.
    await advanceAndFlush(100);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsBeforeTick);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: cross-tab leader/follower split
// ─────────────────────────────────────────────────────────────────────────────
describe("usePendingCountsSync – cross-tab: only leader polls the server", () => {
  it("with two hook instances the lock holder is the only one that interval-polls", async () => {
    let granted = 0;
    Object.defineProperty(navigator, "locks", {
      value: {
        request: vi.fn((_name: string, _opts: unknown, cb: LockCallback) => {
          if (granted === 0) {
            granted++;
            void cb(); // Tab A — grant immediately
          }
          return Promise.resolve();
        }),
      },
      writable: true,
      configurable: true,
    });

    const fetchA = makeFetchFn({ "case-1": 1 });
    const fetchB = makeFetchFn({ "case-1": 1 });
    const setA = vi.fn();
    const setB = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn: fetchA, setCountsFn: setA, intervalMs: 3000 }));
    render(React.createElement(SyncHarness, { fetchFn: fetchB, setCountsFn: setB, intervalMs: 3000 }));

    await flushEffects();

    fetchA.mockClear();
    fetchB.mockClear();

    await advanceAndFlush(9000);

    expect(fetchA.mock.calls.length).toBeGreaterThan(0);
    expect(fetchB.mock.calls.length).toBe(0);
  });
});
