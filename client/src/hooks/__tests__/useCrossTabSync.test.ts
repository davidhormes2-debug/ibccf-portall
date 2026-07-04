// @vitest-environment jsdom
//
// Tests for useCrossTabSync (client/src/hooks/useCrossTabSync.ts).
//
// Three core contracts (from task spec):
//   C1. onLeaderFetch fires ONLY on the leader tab — follower tabs must NOT
//       invoke it even when they receive a BroadcastChannel update.
//   C2. Follower tabs receive the full data list via BroadcastChannel and
//       update state without issuing their own server requests.
//   C3. Blob preservation — lazy-fetched blob fields on existing rows are
//       not lost when the follower tab receives a broadcast update that
//       omits (or nulls) that field.
//
// Additional contracts (structural parity with usePendingCountsSync tests):
//   4. Leader polls fetchFn on each interval tick.
//   5. fetchFn is called on mount (initial load for all tabs).
//   6. All tabs call fetchFn on visibility restore.
//   7. When Web Locks is unavailable every tab polls independently (fallback).
//   8. With two hook instances only the lock holder interval-polls the server.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { useCrossTabSync } from "../useCrossTabSync";

// ── Shared data shape (mimics DocumentRequest rows) ──────────────────────────
interface FakeDoc {
  id: number;
  status: string;
  submittedFileData?: string | null;
}

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

// ── Web Locks mock ────────────────────────────────────────────────────────────
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
const CHANNEL_NAME = "ibccf-document-requests";
const LOCK_NAME = "ibccf-document-requests-leader";

function SyncHarness({
  fetchFn,
  setFn,
  onLeaderFetch,
  onBroadcastReceive,
  intervalMs = 3000,
  staleThresholdMs,
}: {
  fetchFn: () => Promise<FakeDoc[] | null>;
  setFn: (data: FakeDoc[]) => void;
  onLeaderFetch?: (data: FakeDoc[]) => void;
  onBroadcastReceive?: (data: FakeDoc[]) => void;
  intervalMs?: number;
  staleThresholdMs?: number;
}) {
  useCrossTabSync(
    CHANNEL_NAME,
    LOCK_NAME,
    fetchFn,
    setFn,
    onLeaderFetch,
    onBroadcastReceive,
    intervalMs,
    staleThresholdMs,
  );
  return null;
}

// ── Default test data ─────────────────────────────────────────────────────────
function makeDocs(overrides: Partial<FakeDoc>[] = []): FakeDoc[] {
  return overrides.map((o, i) => ({ id: i + 1, status: "pending", ...o }));
}

function makeFetchFn(docs: FakeDoc[] = makeDocs([{ status: "submitted" }])) {
  return vi.fn(async () => docs);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  channels = [];
  pendingLockCallbacks = new Map();
  (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
    FakeBroadcastChannel;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as unknown as Record<string, unknown>).BroadcastChannel;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).locks;
  } catch {
    /* non-configurable — leave as-is */
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// C1 — onLeaderFetch fires ONLY on the leader tab
// ─────────────────────────────────────────────────────────────────────────────
describe("C1: onLeaderFetch fires only on the leader tab", () => {
  it("invokes onLeaderFetch on the leader after each fetch", async () => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(true),
      writable: true,
      configurable: true,
    });

    const docs = makeDocs([{ status: "submitted" }]);
    const fetchFn = makeFetchFn(docs);
    const setFn = vi.fn();
    const onLeaderFetch = vi.fn();

    render(
      React.createElement(SyncHarness, { fetchFn, setFn, onLeaderFetch }),
    );
    await flushEffects();

    expect(onLeaderFetch).toHaveBeenCalled();
    expect(onLeaderFetch).toHaveBeenCalledWith(docs);
  });

  it("does NOT invoke onLeaderFetch on a follower tab that receives a BroadcastChannel message", async () => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(false), // follower — lock never granted
      writable: true,
      configurable: true,
    });

    const fetchFn = makeFetchFn(makeDocs([]));
    const setFn = vi.fn();
    const onLeaderFetch = vi.fn();

    render(
      React.createElement(SyncHarness, { fetchFn, setFn, onLeaderFetch }),
    );
    await flushEffects();
    onLeaderFetch.mockClear();

    // Simulate the leader broadcasting to the follower.
    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: {
          type: "sync-update",
          data: makeDocs([{ id: 99, status: "submitted" }]),
        },
      });
    });

    expect(onLeaderFetch).not.toHaveBeenCalled();
  });

  it("does NOT invoke onLeaderFetch when two leader+follower instances exist — only leader fires it", async () => {
    let granted = 0;
    Object.defineProperty(navigator, "locks", {
      value: {
        request: vi.fn((_name: string, _opts: unknown, cb: LockCallback) => {
          if (granted === 0) {
            granted++;
            void cb(); // Tab A gets the lock
          }
          return Promise.resolve();
        }),
      },
      writable: true,
      configurable: true,
    });

    const fetchA = makeFetchFn(makeDocs([{ status: "submitted" }]));
    const fetchB = makeFetchFn(makeDocs([{ status: "submitted" }]));
    const onLeaderFetchA = vi.fn();
    const onLeaderFetchB = vi.fn();
    const setA = vi.fn();
    const setB = vi.fn();

    render(
      React.createElement(SyncHarness, {
        fetchFn: fetchA,
        setFn: setA,
        onLeaderFetch: onLeaderFetchA,
        intervalMs: 3000,
      }),
    );
    render(
      React.createElement(SyncHarness, {
        fetchFn: fetchB,
        setFn: setB,
        onLeaderFetch: onLeaderFetchB,
        intervalMs: 3000,
      }),
    );
    await flushEffects();

    onLeaderFetchA.mockClear();
    onLeaderFetchB.mockClear();

    // Advance one full interval cycle.
    await advanceAndFlush(3000);

    // Only the leader (Tab A) should have called onLeaderFetch.
    expect(onLeaderFetchA.mock.calls.length).toBeGreaterThan(0);
    expect(onLeaderFetchB).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C2 — Follower tabs receive data via BroadcastChannel, not via server fetch
// ─────────────────────────────────────────────────────────────────────────────
describe("C2: follower tabs update state via BroadcastChannel without polling the server", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(false), // follower — lock never granted
      writable: true,
      configurable: true,
    });
  });

  it("calls setFn with the broadcast payload when a sync-update message arrives", async () => {
    const fetchFn = makeFetchFn(makeDocs([]));
    const setFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setFn }));
    await flushEffects();
    setFn.mockClear();

    const incomingDocs = makeDocs([{ id: 42, status: "submitted" }]);
    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: { type: "sync-update", data: incomingDocs },
      });
    });

    expect(setFn).toHaveBeenCalledTimes(1);
    expect(setFn).toHaveBeenCalledWith(incomingDocs);
  });

  it("does NOT poll the server on interval ticks while awaiting the lock", async () => {
    const fetchFn = makeFetchFn();
    const setFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setFn, intervalMs: 3000 }));
    await flushEffects();

    const callsAfterMount = fetchFn.mock.calls.length;

    await advanceAndFlush(9000);

    expect(fetchFn.mock.calls.length).toBe(callsAfterMount);
  });

  it("ignores messages with an unrecognised type", async () => {
    const fetchFn = makeFetchFn(makeDocs([]));
    const setFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setFn }));
    await flushEffects();
    setFn.mockClear();

    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: { type: "unknown-event", data: makeDocs([{ id: 1 }]) },
      });
    });

    expect(setFn).not.toHaveBeenCalled();
  });

  it("delivers the broadcast to a sibling channel on the same name", async () => {
    // Simulate a second tab that opens a raw channel with the same name.
    const sibling = new FakeBroadcastChannel(CHANNEL_NAME) as unknown as FakeChannel;
    const siblingHandler = vi.fn();
    sibling.onmessage = siblingHandler;

    // Override to leader so the hook actually broadcasts.
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(true),
      writable: true,
      configurable: true,
    });

    const docs = makeDocs([{ status: "pending" }]);
    const fetchFn = makeFetchFn(docs);

    render(React.createElement(SyncHarness, { fetchFn, setFn: vi.fn() }));
    await flushEffects();

    const received = siblingHandler.mock.calls.find(
      ([e]) =>
        e?.data?.type === "sync-update" &&
        JSON.stringify(e.data.data) === JSON.stringify(docs),
    );
    expect(received).toBeDefined();
  });

  it("invokes onBroadcastReceive callback on the receiving tab", async () => {
    const fetchFn = makeFetchFn(makeDocs([]));
    const setFn = vi.fn();
    const onBroadcastReceive = vi.fn();

    render(
      React.createElement(SyncHarness, { fetchFn, setFn, onBroadcastReceive }),
    );
    await flushEffects();

    const incomingDocs = makeDocs([{ id: 7, status: "submitted" }]);
    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: { type: "sync-update", data: incomingDocs },
      });
    });

    expect(onBroadcastReceive).toHaveBeenCalledTimes(1);
    expect(onBroadcastReceive).toHaveBeenCalledWith(incomingDocs);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C3 — Blob preservation: lazy-fetched blobs are not lost on broadcast updates
// ─────────────────────────────────────────────────────────────────────────────
describe("C3: blob preservation — existing blobs survive a BroadcastChannel update", () => {
  it("preserves a blob already held in state when the broadcast omits submittedFileData", async () => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(false), // follower
      writable: true,
      configurable: true,
    });

    // The follower's current in-memory state has a blob for id=1.
    const existingState: FakeDoc[] = [
      { id: 1, status: "submitted", submittedFileData: "data:image/png;base64,BLOB" },
      { id: 2, status: "pending", submittedFileData: null },
    ];

    // The blob-preserving setter — mirrors setDocumentRequestsWithBlobPreservation
    // in AdminDashboard.tsx.
    let currentState: FakeDoc[] = existingState;
    const blobPreservingSet = vi.fn((incoming: FakeDoc[]) => {
      const prevBlobs = new Map<number, string | null | undefined>();
      for (const p of currentState) prevBlobs.set(p.id, p.submittedFileData);
      currentState = incoming.map((r) => ({
        ...r,
        submittedFileData: r.submittedFileData ?? prevBlobs.get(r.id),
      }));
    });

    const fetchFn = vi.fn(async () => existingState);

    render(
      React.createElement(SyncHarness, {
        fetchFn,
        setFn: blobPreservingSet,
      }),
    );
    await flushEffects();
    blobPreservingSet.mockClear();

    // Leader broadcasts an update where submittedFileData is absent/null.
    const broadcastDocs: FakeDoc[] = [
      { id: 1, status: "submitted", submittedFileData: null }, // blob stripped server-side
      { id: 2, status: "pending", submittedFileData: null },
    ];

    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: { type: "sync-update", data: broadcastDocs },
      });
    });

    expect(blobPreservingSet).toHaveBeenCalledTimes(1);
    const received = blobPreservingSet.mock.calls[0][0] as FakeDoc[];
    expect(received).toEqual(broadcastDocs);

    // Confirm that the blob-preserving logic retained the blob for id=1.
    expect(currentState[0].submittedFileData).toBe("data:image/png;base64,BLOB");
    expect(currentState[1].submittedFileData).toBeNull();
  });

  it("does not overwrite a fresh blob from the server with a stale null", async () => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(false), // follower
      writable: true,
      configurable: true,
    });

    const existingState: FakeDoc[] = [
      { id: 1, status: "submitted", submittedFileData: null }, // not yet fetched
    ];

    let currentState: FakeDoc[] = existingState;
    const blobPreservingSet = (incoming: FakeDoc[]) => {
      const prevBlobs = new Map<number, string | null | undefined>();
      for (const p of currentState) prevBlobs.set(p.id, p.submittedFileData);
      currentState = incoming.map((r) => ({
        ...r,
        submittedFileData: r.submittedFileData ?? prevBlobs.get(r.id),
      }));
    };

    render(
      React.createElement(SyncHarness, {
        fetchFn: vi.fn(async () => existingState),
        setFn: blobPreservingSet,
      }),
    );
    await flushEffects();

    // A broadcast arrives with the blob now populated.
    const broadcastWithBlob: FakeDoc[] = [
      { id: 1, status: "submitted", submittedFileData: "data:image/png;base64,NEWBLOB" },
    ];

    const followerChannel = channels[channels.length - 1];
    act(() => {
      followerChannel.onmessage?.({
        data: { type: "sync-update", data: broadcastWithBlob },
      });
    });

    // The new blob from the broadcast should be kept.
    expect(currentState[0].submittedFileData).toBe("data:image/png;base64,NEWBLOB");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: leader polling behaviour
// ─────────────────────────────────────────────────────────────────────────────
describe("useCrossTabSync – leader tab (lock acquired immediately)", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(true),
      writable: true,
      configurable: true,
    });
  });

  it("calls fetchFn on mount and updates state", async () => {
    const docs = makeDocs([{ status: "submitted" }]);
    const fetchFn = makeFetchFn(docs);
    const setFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setFn }));
    await flushEffects();

    expect(fetchFn).toHaveBeenCalled();
    expect(setFn).toHaveBeenCalledWith(docs);
  });

  it("polls fetchFn on each interval tick", async () => {
    const fetchFn = makeFetchFn();
    const setFn = vi.fn();

    render(
      React.createElement(SyncHarness, { fetchFn, setFn, intervalMs: 3000 }),
    );
    await flushEffects();

    const callsAfterMount = fetchFn.mock.calls.length;
    await advanceAndFlush(3000);

    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("broadcasts fetched data over BroadcastChannel", async () => {
    const docs = makeDocs([{ status: "submitted" }]);
    const fetchFn = makeFetchFn(docs);

    render(React.createElement(SyncHarness, { fetchFn, setFn: vi.fn() }));
    await flushEffects();

    const channel = channels[0];
    expect(channel).toBeDefined();

    const broadcasted = channel?.postMessage.mock.calls.some(
      ([msg]) =>
        msg?.type === "sync-update" &&
        JSON.stringify(msg.data) === JSON.stringify(docs),
    );
    expect(broadcasted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: initial fetch on mount (all tabs)
// ─────────────────────────────────────────────────────────────────────────────
describe("useCrossTabSync – initial fetch on mount", () => {
  it("calls fetchFn once on mount regardless of lock state", async () => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(false), // follower
      writable: true,
      configurable: true,
    });

    const fetchFn = makeFetchFn();
    const setFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setFn }));
    await flushEffects();

    expect(fetchFn).toHaveBeenCalled();
    expect(setFn).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: visibility restore
// ─────────────────────────────────────────────────────────────────────────────
describe("useCrossTabSync – visibility restore", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: makeLocksAPI(false),
      writable: true,
      configurable: true,
    });
  });

  it("calls fetchFn when the tab becomes visible", async () => {
    const fetchFn = makeFetchFn();
    const setFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setFn }));
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
    const setFn = vi.fn();

    render(React.createElement(SyncHarness, { fetchFn, setFn }));
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
describe("useCrossTabSync – fallback: Web Locks unavailable", () => {
  it("polls independently when navigator.locks does not exist", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if ("locks" in nav) delete nav.locks;

    const fetchFn = makeFetchFn();
    const setFn = vi.fn();

    render(
      React.createElement(SyncHarness, { fetchFn, setFn, intervalMs: 3000 }),
    );
    await flushEffects();

    const callsAfterMount = fetchFn.mock.calls.length;
    await advanceAndFlush(3000);

    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: cross-tab leader/follower split
// ─────────────────────────────────────────────────────────────────────────────
describe("useCrossTabSync – cross-tab: only leader polls the server", () => {
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

    const fetchA = makeFetchFn();
    const fetchB = makeFetchFn();
    const setA = vi.fn();
    const setB = vi.fn();

    render(
      React.createElement(SyncHarness, { fetchFn: fetchA, setFn: setA, intervalMs: 3000 }),
    );
    render(
      React.createElement(SyncHarness, { fetchFn: fetchB, setFn: setB, intervalMs: 3000 }),
    );

    await flushEffects();
    fetchA.mockClear();
    fetchB.mockClear();

    await advanceAndFlush(9000);

    expect(fetchA.mock.calls.length).toBeGreaterThan(0);
    expect(fetchB.mock.calls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: stale-on-restore threshold
// ─────────────────────────────────────────────────────────────────────────────
describe("useCrossTabSync – stale-on-restore threshold", () => {
  const INTERVAL_MS = 3000;
  const THRESHOLD_MS = INTERVAL_MS * 2; // default staleThresholdMs = intervalMs × 2

  let locksRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    locksRequestMock = vi.fn((_name: string, _opts: unknown, _cb: LockCallback) => {
      // Never grant — this tab stays a follower for the initial lock request.
      return Promise.resolve();
    });
    Object.defineProperty(navigator, "locks", {
      value: { request: locksRequestMock },
      writable: true,
      configurable: true,
    });
  });

  it("does NOT use steal:true when the tab was hidden for less than the threshold", async () => {
    render(
      React.createElement(SyncHarness, {
        fetchFn: makeFetchFn(),
        setFn: vi.fn(),
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

  it("issues { mode: 'exclusive', steal: true } when the tab was hidden for longer than the threshold", async () => {
    render(
      React.createElement(SyncHarness, {
        fetchFn: makeFetchFn(),
        setFn: vi.fn(),
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

    // A steal request must have been made with the correct lock name and options.
    const stealCalls = locksRequestMock.mock.calls.filter(
      ([, opts]) => (opts as Record<string, unknown>)?.steal === true,
    );
    expect(stealCalls).toHaveLength(1);
    expect(stealCalls[0][0]).toBe(LOCK_NAME);
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
        setFn: vi.fn(),
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

    // Advance past the threshold — the leader should NOT steal from itself.
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

  it("accepts a custom staleThresholdMs and triggers steal only at that threshold", async () => {
    const customThreshold = 10000;

    render(
      React.createElement(SyncHarness, {
        fetchFn: makeFetchFn(),
        setFn: vi.fn(),
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

    // Hide again and advance past the custom threshold.
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
// Additional: follower-to-leader promotion interval reset (Task #518 / Task #611)
//
// Contract: when a follower steals the leader lock on visibility restore, the
// new interval is anchored to the promotion moment.  The next tick must fire
// at ~intervalMs after the steal — NOT relative to a drifted earlier reference
// point.  This mirrors the test in usePendingCountsSync.test.ts but drives the
// generic primitive directly so regressions in the shared layer are caught
// before any consumer hook notices.
// ─────────────────────────────────────────────────────────────────────────────
describe("useCrossTabSync – follower steal → interval reset at promotion moment", () => {
  const INTERVAL_MS = 3000;
  const STALE_THRESHOLD_MS = INTERVAL_MS * 2; // default staleThresholdMs = intervalMs × 2

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

    const fetchFn = makeFetchFn();
    const setFn = vi.fn();

    render(
      React.createElement(SyncHarness, {
        fetchFn,
        setFn,
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

    // Advance past the stale threshold while hidden so the restore triggers a
    // steal.
    await advanceAndFlush(STALE_THRESHOLD_MS + 1);

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

  it("no double-poll when the tab is hidden again before the first steal callback fires", async () => {
    // Deferred steal mock: store each steal callback rather than firing it
    // immediately.  This lets us control when each promotion resolves so we
    // can exercise the race where a second hide/restore cycle dispatches a
    // second steal before the first steal callback has run.
    const stealCallbacks: LockCallback[] = [];
    const locksRequestMock = vi.fn(
      (_name: string, opts: Record<string, unknown>, cb: LockCallback) => {
        if (opts?.steal === true) {
          stealCallbacks.push(cb);
        }
        // Initial exclusive request (no steal flag) is NOT granted → follower.
        return Promise.resolve();
      },
    );
    Object.defineProperty(navigator, "locks", {
      value: { request: locksRequestMock },
      writable: true,
      configurable: true,
    });

    const fetchFn = makeFetchFn();
    const setFn = vi.fn();

    render(
      React.createElement(SyncHarness, {
        fetchFn,
        setFn,
        intervalMs: INTERVAL_MS,
      }),
    );
    await flushEffects();

    // ── first hide/restore cycle ───────────────────────────────────────────
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await advanceAndFlush(STALE_THRESHOLD_MS + 1);

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

    // Steal 1 should have been requested but callback NOT yet called.
    expect(stealCallbacks).toHaveLength(1);

    // ── second hide/restore cycle (steal 1 still pending) ─────────────────
    // Because the first steal callback hasn't fired yet, isLeaderRef is still
    // false, so the second restore should also issue a steal request.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await advanceAndFlush(STALE_THRESHOLD_MS + 1);

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

    // Both steals should have been queued.
    expect(stealCallbacks).toHaveLength(2);

    // ── fire steal 1 callback then advance a partial interval ─────────────
    // Steal 1 becomes the leader and starts an interval.  The callback returns
    // a Promise that only resolves on unmount (it holds the lock), so we fire
    // it with void and flush microtasks instead of awaiting it.
    await act(async () => {
      void stealCallbacks[0]();
      await Promise.resolve();
      await Promise.resolve();
    });

    fetchFn.mockClear();
    // Advance roughly half an interval — steal 1's interval should NOT have
    // ticked yet, so there should be no new fetches.
    await advanceAndFlush(Math.floor(INTERVAL_MS / 2));
    const callsBetweenSteals = fetchFn.mock.calls.length;
    expect(callsBetweenSteals).toBe(0);

    // ── fire steal 2 callback ─────────────────────────────────────────────
    // Steal 2 clears steal 1's interval and anchors a fresh interval to this
    // exact moment.  There should still be no extra fetch from the old
    // interval after this point.  Same void + flush pattern as steal 1.
    await act(async () => {
      void stealCallbacks[1]();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Clear any fetches triggered by the second promotion's immediate
    // leaderPoll() so subsequent assertions count only interval ticks.
    fetchFn.mockClear();

    // Advancing just under one full interval from the steal 2 moment must NOT
    // produce a tick — this verifies the interval is anchored to steal 2, not
    // to the earlier steal 1 reference point, AND that no dangling interval
    // from steal 1 is still running.
    await advanceAndFlush(INTERVAL_MS - 100);
    const callsBeforeTick = fetchFn.mock.calls.length;
    // Hard zero: any value > 0 here means steal 1's interval survived, which
    // is the exact double-poll regression this test guards against.
    expect(callsBeforeTick).toBe(0);

    // The remaining slice completes exactly one interval from steal 2 and
    // should produce the first (and only) scheduled tick — no double-firing.
    await advanceAndFlush(100);
    const callsAfterTick = fetchFn.mock.calls.length;
    expect(callsAfterTick).toBeGreaterThan(callsBeforeTick);
    // Exactly one interval is running: the tick count increments by 1, not 2.
    expect(callsAfterTick - callsBeforeTick).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: leader interval reset on visibility restore
// ─────────────────────────────────────────────────────────────────────────────
describe("useCrossTabSync – leader interval reset on visibility restore", () => {
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
        setFn: vi.fn(),
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
    const setFn = vi.fn();

    render(
      React.createElement(SyncHarness, {
        fetchFn,
        setFn,
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

  it("re-anchors the interval after a second hide/restore cycle (no double-polling or missed ticks)", async () => {
    const INTERVAL = 3000;
    // Hide for only 200 ms each time — well within the 3 s interval window —
    // so the active interval never fires during a hidden period and we can
    // assert exact call counts throughout.
    const HIDDEN_MS = 200;

    const fetchFn = makeFetchFn();
    const setFn = vi.fn();

    render(
      React.createElement(SyncHarness, {
        fetchFn,
        setFn,
        intervalMs: INTERVAL,
      }),
    );
    await flushEffects();
    fetchFn.mockClear();

    // ── First hide/restore cycle ──────────────────────────────────────────────
    // Hide immediately (0 ms elapsed since mount-clear), well before the first
    // interval tick at T = INTERVAL.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Advance 200 ms while hidden — far from the interval boundary → 0 ticks.
    await advanceAndFlush(HIDDEN_MS);
    expect(fetchFn.mock.calls.length).toBe(0);

    // Restore the tab: triggers immediate safety fetch + interval reset anchored
    // to this moment (T = HIDDEN_MS from mount-clear).
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

    // Discard the immediate safety fetch; only measure scheduled ticks.
    fetchFn.mockClear();

    // 1 ms before the new interval boundary (anchored to restore-1) → 0 ticks.
    await advanceAndFlush(INTERVAL - 1);
    expect(fetchFn.mock.calls.length).toBe(0);

    // Crossing the boundary → exactly 1 tick (no double-polling from a stale
    // pre-hide interval that survived the restore).
    await advanceAndFlush(1);
    expect(fetchFn.mock.calls.length).toBe(1);
    fetchFn.mockClear();

    // ── Second hide/restore cycle ─────────────────────────────────────────────
    // Hide immediately after the first-cycle tick — still within the next
    // interval window, so no ticks can land during the hidden period.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Advance 200 ms while hidden — next interval tick is INTERVAL ms away → 0.
    await advanceAndFlush(HIDDEN_MS);
    expect(fetchFn.mock.calls.length).toBe(0);

    // Restore the tab: interval re-anchored to this moment.
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

    // Discard the immediate safety fetch from the second restore.
    fetchFn.mockClear();

    // 1 ms before the new interval boundary (anchored to restore-2) → 0 ticks.
    // A regression that leaves two active intervals would produce 1 tick here
    // because the stale first-cycle interval is already overdue.
    await advanceAndFlush(INTERVAL - 1);
    expect(fetchFn.mock.calls.length).toBe(0);

    // Exactly 1 tick at the new boundary — no double-polling.
    await advanceAndFlush(1);
    expect(fetchFn.mock.calls.length).toBe(1);
  });

  it("correctly re-anchors the interval across three or more hide/restore cycles without drift accumulation or double-polling", async () => {
    // This test extends the two-cycle coverage above to three cycles.
    // Each hide is short (HIDDEN_MS << INTERVAL) so no interval tick fires
    // while the tab is hidden.  After each restore we verify:
    //   (a) exactly ONE immediate safety fetch occurs,
    //   (b) no scheduled ticks fire before the fresh interval boundary, and
    //   (c) exactly ONE tick fires at the boundary (no leaked duplicate intervals).
    const INTERVAL = 3000;
    const HIDDEN_MS = 150; // well within one interval window

    const fetchFn = makeFetchFn();
    const setFn = vi.fn();

    render(
      React.createElement(SyncHarness, {
        fetchFn,
        setFn,
        intervalMs: INTERVAL,
      }),
    );
    await flushEffects();
    fetchFn.mockClear();

    // Helper: simulate one hide → advance HIDDEN_MS → restore cycle, then
    // assert the interval is freshly anchored.
    const runCycle = async (cycleLabel: string) => {
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

      // Advance while hidden — no interval tick should fire.
      await advanceAndFlush(HIDDEN_MS);
      expect(fetchFn.mock.calls.length).toBe(0);

      // Restore the tab: triggers immediate safety fetch + interval reset.
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

      // The restore must produce exactly one immediate fetch (safety net).
      expect(fetchFn.mock.calls.length).toBe(1, `cycle ${cycleLabel}: expected 1 immediate fetch on restore`);
      fetchFn.mockClear();

      // 1 ms before the freshly-anchored interval boundary → 0 scheduled ticks.
      await advanceAndFlush(INTERVAL - 1);
      expect(fetchFn.mock.calls.length).toBe(0, `cycle ${cycleLabel}: expected 0 ticks before interval boundary`);

      // Exactly 1 tick at the boundary — a leaked stale interval would produce > 1.
      await advanceAndFlush(1);
      expect(fetchFn.mock.calls.length).toBe(1, `cycle ${cycleLabel}: expected exactly 1 tick at interval boundary`);
      fetchFn.mockClear();
    };

    await runCycle("1");
    await runCycle("2");
    await runCycle("3");
  });
});
