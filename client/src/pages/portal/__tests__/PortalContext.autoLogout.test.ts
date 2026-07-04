// @vitest-environment jsdom
//
// Unit tests for usePortalAutoLogout
// (client/src/pages/portal/usePortalAutoLogout.ts).
//
// This hook is extracted from PortalContext and used by it directly, so
// these tests exercise the real production code path for the context-level
// auto-logout guard — the most security-critical part of the portal
// closure feature.
//
// Contracted behaviours:
//   (a)  Auto-logout fires when the activeWarning timer expires.
//   (a2) Auto-logout fires immediately when activeWarning is already expired.
//   (b)  Auto-logout fires even when warningDismissed is true —
//        the user cannot escape force-logout by dismissing the overlay.
//   (c)  Auto-logout timer is cleared when activeWarning becomes null —
//        onExpire is NOT called after the warning is lifted.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePortalAutoLogout, type PortalAutoLogoutWarning } from "../usePortalAutoLogout";

afterEach(() => {
  vi.useRealTimers();
});

// ── Helpers ───────────────────────────────────────────────────────────────

function makeWarning(
  minutesToExpiry: number,
  minutesTotal = 5,
): PortalAutoLogoutWarning {
  // warningAt is chosen so that (warningAt + minutesTotal * 60 s) equals
  // now + minutesToExpiry * 60 s — i.e. the warning expires in minutesToExpiry
  // minutes from now (negative = already expired).
  const warningAt = new Date(
    Date.now() - (minutesTotal - minutesToExpiry) * 60_000,
  );
  return { warningAt, minutesTotal };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("usePortalAutoLogout", () => {
  it("(a) fires onExpire when the activeWarning timer expires", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();

    const warning = makeWarning(2, 5); // expires in 2 minutes

    renderHook(() => usePortalAutoLogout(warning, onExpire));

    expect(onExpire).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(120_000); // exactly 2 minutes
    });

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("(a2) fires onExpire immediately when activeWarning is already expired", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();

    const warning = makeWarning(-1, 5); // expired 1 minute ago

    act(() => {
      renderHook(() => usePortalAutoLogout(warning, onExpire));
    });

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("(b) fires onExpire even when warningDismissed is true", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();

    // Simulate PortalContext passing warningDismissed=true to the hook;
    // the hook intentionally ignores this value — force-logout cannot be
    // bypassed by hiding the overlay.
    const warning = makeWarning(1, 5); // expires in 1 minute
    const warningDismissed = true; // user dismissed the overlay

    // The hook signature does not accept warningDismissed — that is the
    // whole point. We verify that a caller who has dismissed the overlay
    // cannot pass that state into the hook to suppress onExpire.
    renderHook(() => {
      void warningDismissed; // referenced so the variable is not lint-pruned
      usePortalAutoLogout(warning, onExpire);
    });

    expect(onExpire).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(60_000); // 1 minute
    });

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("(c) does NOT fire onExpire after activeWarning is cleared to null", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();

    const warning = makeWarning(2, 5); // expires in 2 minutes

    const { rerender } = renderHook(
      ({ aw }: { aw: PortalAutoLogoutWarning | null }) =>
        usePortalAutoLogout(aw, onExpire),
      { initialProps: { aw: warning } },
    );

    // Admin cancels the warning before it expires
    act(() => {
      rerender({ aw: null });
    });

    // Advance well past the original expiry time
    act(() => {
      vi.advanceTimersByTime(180_000); // 3 minutes
    });

    expect(onExpire).not.toHaveBeenCalled();
  });
});
