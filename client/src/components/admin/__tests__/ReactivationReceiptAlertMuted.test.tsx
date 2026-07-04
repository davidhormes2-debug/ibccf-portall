// @vitest-environment jsdom
//
// Regression guard: the reactivation-receipt polling loop in AdminDashboard.tsx
// must NOT fire the toast when every pending receipt has `alertMuted: true`,
// and MUST fire when at least one receipt has `alertMuted: false`.
//
// Two test layers (same pattern as WalletConnectAlertCleanupInterval.test.tsx):
//
//   1. Functional harness — a self-contained React component that replicates
//      the reactivation polling useEffect (including the alertMuted filter and
//      the count-rise gate) without rendering all of AdminDashboard.  The
//      harness receives `fetchImpl` and `toastImpl` as props so tests can
//      intercept both without any global-state coupling.
//
//   2. Static source assertions — read AdminDashboard.tsx from disk and verify
//      that the `!r.alertMuted` filter and the correct endpoint URL are still
//      present, so the harness cannot silently drift from the production code.

import React, { useRef, useEffect } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Static source under analysis
// ---------------------------------------------------------------------------

const ADMIN_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../pages/AdminDashboard.tsx"),
  "utf8",
);

/**
 * Extracts the reactivation polling useEffect body, bounded from
 * "Reactivation receipt alert" sentinel comment to the closing
 * `}, [isLoggedIn, authToken]);` of that effect.
 */
function extractReactivationPollingBlock(): string {
  const sentinel = "// ── Reactivation receipt alert";
  const start = ADMIN_SRC.indexOf(sentinel);
  if (start === -1) return "";
  // Bound to the next double-blank-line or "// ──" section divider after the
  // effect's closing deps array.
  const depsClose = ADMIN_SRC.indexOf("}, [isLoggedIn, authToken]);", start);
  if (depsClose === -1) return "";
  return ADMIN_SRC.slice(start, depsClose + 28);
}

// ---------------------------------------------------------------------------
// Functional harness
// ---------------------------------------------------------------------------

interface Receipt {
  alertMuted?: boolean;
}

interface HarnessProps {
  /** Injected fetch implementation so tests can control responses. */
  fetchImpl: (url: string, opts?: RequestInit) => Promise<Response>;
  /** Injected toast implementation so tests can capture calls. */
  toastImpl: (payload: { title: string; description: string }) => void;
  /** Auth token to pass in the Authorization header. */
  authToken?: string;
}

/**
 * Replicates the reactivation-receipt polling useEffect from AdminDashboard.tsx.
 *
 * Differences from the real implementation:
 *   • `playNotificationSound` is omitted (audio side-effect irrelevant here).
 *   • `isLoggedIn` is always treated as true (the harness is only mounted when
 *     the caller wants the effect to run).
 *   • `fetchImpl` / `toastImpl` are injected via props instead of captured
 *     from closure (makes them easy to mock per-test without global state).
 *
 * The filter expression `data.filter((r) => !r.alertMuted).length` is
 * identical to the production code so any change to the real filter that
 * changes the type signature or semantics will be caught by the static
 * source assertions below (Tier 2).
 */
function ReactivationPollingHarness({
  fetchImpl,
  toastImpl,
  authToken = "test-token",
}: HarnessProps) {
  const lastCountRef = useRef(-1);
  const isInitialRef = useRef(true);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetchImpl(
          "/api/deposits/all-receipts?category=reactivation&status=pending",
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (!res.ok) return;
        const data: Receipt[] = await res.json();
        const count = Array.isArray(data)
          ? data.filter((r) => !r.alertMuted).length
          : 0;
        if (
          !isInitialRef.current &&
          count > lastCountRef.current &&
          lastCountRef.current >= 0
        ) {
          toastImpl({
            title: "🔓 Reactivation receipt received",
            description: `${count} pending reactivation receipt${count !== 1 ? "s" : ""} from suspended account${count !== 1 ? "s" : ""} awaiting review`,
          });
        }
        lastCountRef.current = count;
        isInitialRef.current = false;
      } catch {
        // silent
      }
    };

    poll();
    const id = setInterval(poll, 12_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tier 1: Functional harness tests
// ---------------------------------------------------------------------------

describe("ReactivationPollingHarness — alertMuted guard", () => {
  it("does NOT fire toast when every receipt has alertMuted: true, even when count would otherwise rise", async () => {
    const toastMock = vi.fn();

    // Initial poll: 0 unmuted receipts → last = 0, isInitial = false
    // Second poll:  1 fully-muted receipt → filtered count still 0 → 0 > 0 is false → no toast
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) return jsonOk([]); // baseline — 0 unmuted
      return jsonOk([{ alertMuted: true }]); // muted — should not raise count
    });

    render(
      <ReactivationPollingHarness fetchImpl={fetchImpl} toastImpl={toastMock} />,
    );

    // Allow the initial poll to settle.
    await act(async () => {
      await Promise.resolve();
    });

    expect(toastMock).not.toHaveBeenCalled();

    // Advance one polling interval so the second poll fires.
    await act(async () => {
      vi.advanceTimersByTime(12_000);
      await Promise.resolve();
    });

    expect(toastMock).not.toHaveBeenCalled();
  });

  it("fires toast when a receipt with alertMuted: false arrives after a zero baseline", async () => {
    const toastMock = vi.fn();

    // Initial poll: 0 receipts → last = 0, isInitial = false
    // Second poll:  1 unmuted receipt → count = 1, 1 > 0 → toast fires
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) return jsonOk([]); // baseline
      return jsonOk([{ alertMuted: false }]); // unmuted — should fire
    });

    render(
      <ReactivationPollingHarness fetchImpl={fetchImpl} toastImpl={toastMock} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(toastMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(12_000);
      await Promise.resolve();
    });

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0].title).toContain("Reactivation receipt");
  });

  it("fires toast for the unmuted receipts only when a mix of muted and unmuted arrives", async () => {
    const toastMock = vi.fn();

    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) return jsonOk([]); // baseline: 0 unmuted
      // Second poll: 2 receipts — 1 muted, 1 unmuted → filtered count = 1
      return jsonOk([{ alertMuted: true }, { alertMuted: false }]);
    });

    render(
      <ReactivationPollingHarness fetchImpl={fetchImpl} toastImpl={toastMock} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(12_000);
      await Promise.resolve();
    });

    // Toast fires for the one unmuted receipt.
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0].description).toContain("1 pending");
  });

  it("does NOT fire toast on the initial load even when unmuted receipts are present", async () => {
    const toastMock = vi.fn();

    const fetchImpl = vi.fn(async () =>
      jsonOk([{ alertMuted: false }, { alertMuted: false }]),
    );

    render(
      <ReactivationPollingHarness fetchImpl={fetchImpl} toastImpl={toastMock} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // isInitialRef starts true — toast must be suppressed on first load.
    expect(toastMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tier 2: Static source assertions — AdminDashboard.tsx
// ---------------------------------------------------------------------------

describe("AdminDashboard.tsx — reactivation polling useEffect source", () => {
  const block = extractReactivationPollingBlock();

  it("contains the reactivation receipt alert sentinel comment", () => {
    expect(block).not.toBe(
      "",
      "Expected to find '// ── Reactivation receipt alert' in AdminDashboard.tsx",
    );
  });

  it("fetches the correct endpoint with category and status query params", () => {
    expect(block).toContain(
      "/api/deposits/all-receipts?category=reactivation&status=pending",
    );
  });

  it("filters receipts by !r.alertMuted before counting", () => {
    expect(block).toContain("!r.alertMuted");
    expect(block).toContain(".filter(");
  });

  it("guards the toast behind the count-rise condition", () => {
    const filterIdx = block.indexOf(".filter(");
    const toastIdx = block.indexOf("toast({");
    expect(filterIdx).not.toBe(-1);
    expect(toastIdx).not.toBe(-1);
    // filter runs before toast
    expect(filterIdx).toBeLessThan(toastIdx);
  });

  it("suppresses the alert on the initial load via the isInitial ref", () => {
    expect(block).toContain("isInitialReactivationLoadRef.current");
  });

  it("compares the filtered count against the last-known count", () => {
    expect(block).toContain("lastPendingReactivationCountRef.current");
    // The count-rise guard must appear before the toast call.
    const guardIdx = block.indexOf("count > lastPendingReactivationCountRef.current");
    const toastIdx = block.indexOf("toast({");
    expect(guardIdx).not.toBe(-1);
    expect(guardIdx).toBeLessThan(toastIdx);
  });
});
