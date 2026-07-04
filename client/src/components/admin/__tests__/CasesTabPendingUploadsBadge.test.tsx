// @vitest-environment jsdom
//
// Task #423 — Cover the pending-uploads badge counter wiring in CasesTab.
//
// Two contracts verified:
//   1. The "N NEW UPLOADS" badge (SupportingDocsQuickPopover) renders only
//      for cases whose id is present in userDocPendingCounts with a value > 0
//      and is absent for cases with a 0/missing count.
//   2. When the popover fires its `onActioned` callback (after an admin
//      approves or rejects a doc), CasesTab calls `loadUserDocPendingCounts`
//      so the badge count refreshes.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import type { Case } from "@/components/admin/shared";

// ── mock use-toast so shadcn toasts don't throw ──────────────────────────────
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── mock AdminDashboardContext – we control the values under test ─────────────
// The actual hook is a createContext / useContext pair; we replace it entirely
// so CasesTab never tries to reach the real provider or make real network calls
// through context helpers.
const loadUserDocPendingCountsMock = vi.fn();

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => buildMockContext(),
  };
});

// ── stub SupportingDocsQuickPopover ──────────────────────────────────────────
// The real component opens a Radix Popover and fires fetch calls. We replace
// it with a minimal stub that:
//   • renders the badge trigger with the same data-testid the real component
//     uses (badge-user-doc-pending-<caseId>) so test 1 can assert presence
//   • renders an "act" button that immediately invokes onActioned so test 2
//     can verify the loadUserDocPendingCounts wiring without poking at Radix.
vi.mock("@/components/admin/SupportingDocsQuickPopover", () => ({
  SupportingDocsQuickPopover: ({
    caseId,
    count,
    onActioned,
  }: {
    caseId: string;
    count: number;
    authToken: string | null;
    onActioned?: () => void;
  }) => (
    <span>
      <span data-testid={`badge-user-doc-pending-${caseId}`}>
        {count} NEW UPLOADS
      </span>
      <button
        data-testid={`trigger-onActioned-${caseId}`}
        onClick={() => onActioned?.()}
      >
        act
      </button>
    </span>
  ),
}));

// ── minimal Case fixture ──────────────────────────────────────────────────────
const CASE_WITH_UPLOADS = {
  id: "case-has-uploads",
  accessCode: "UPLOAD01",
  status: "active" as const,
};

const CASE_WITHOUT_UPLOADS = {
  id: "case-no-uploads",
  accessCode: "CLEAN002",
  status: "active" as const,
};

// ── helper to build the mock context ─────────────────────────────────────────
// Task #799 — built from the shared, type-checked factory so adding a new
// required field to AdminDashboardContextValue surfaces a COMPILE error here
// (the factory will fail to satisfy the interface) instead of crashing this
// test at runtime with "Cannot read properties of undefined". We only override
// the handful of values these tests actually exercise.
function buildMockContext(): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: [CASE_WITH_UPLOADS, CASE_WITHOUT_UPLOADS] as unknown as Case[],
    filteredCases: [CASE_WITH_UPLOADS, CASE_WITHOUT_UPLOADS] as unknown as Case[],
    // ← the values under test
    userDocPendingCounts: { "case-has-uploads": 3 },
    loadUserDocPendingCounts: loadUserDocPendingCountsMock,
  });
}

// ── fetch stub – silences the on-mount effects that call admin APIs ────────────
function notFoundResponse() {
  return Promise.resolve(
    new Response(JSON.stringify({}), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }) as unknown as Response,
  );
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  // jsdom doesn't ship ResizeObserver or pointer-capture APIs that
  // Radix/Popover may reference even in the stub.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (
    !(
      Element.prototype as unknown as { hasPointerCapture?: unknown }
    ).hasPointerCapture
  ) {
    (
      Element.prototype as unknown as { hasPointerCapture: () => boolean }
    ).hasPointerCapture = () => false;
  }

  // Stub sessionStorage so effects that gate on adminToken don't silently
  // skip (the nda/integrity-status and email-delivery-summary effects check
  // for a token before fetching).
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    _: new Map<string, string>(),
    getItem(k: string) {
      return (this as { _: Map<string, string> })._.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      (this as { _: Map<string, string> })._.set(k, String(v));
    },
    removeItem(k: string) {
      (this as { _: Map<string, string> })._.delete(k);
    },
    clear() {
      (this as { _: Map<string, string> })._.clear();
    },
  };
  (globalThis as unknown as { sessionStorage: { setItem: (k: string, v: string) => void } }).sessionStorage.setItem(
    "adminToken",
    "test-token",
  );

  // Return 404 for every on-mount effect fetch so they exit early without
  // state mutations that could interfere with assertions.
  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
    .fn()
    .mockImplementation(notFoundResponse);

  loadUserDocPendingCountsMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── import under test (after all mocks are declared) ─────────────────────────
import { CasesTab } from "../tabs/CasesTab";
import { usePendingCountsPolling } from "@/hooks/usePendingCountsPolling";

// ─────────────────────────────────────────────────────────────────────────────
describe("CasesTab – pending-uploads badge", () => {
  it("renders the badge only for cases with a pending-uploads count > 0", async () => {
    render(<CasesTab />);

    // The badge for the case that HAS pending uploads must appear.
    await waitFor(() =>
      expect(
        screen.getByTestId("badge-user-doc-pending-case-has-uploads"),
      ).toBeTruthy(),
    );

    // The badge for the case with zero count must NOT appear in the DOM.
    expect(
      screen.queryByTestId("badge-user-doc-pending-case-no-uploads"),
    ).toBeNull();
  });

  it("calls loadUserDocPendingCounts when the popover fires onActioned", async () => {
    render(<CasesTab />);

    // Wait for the badge stub to mount so we know the row is rendered.
    await waitFor(() =>
      expect(
        screen.getByTestId("badge-user-doc-pending-case-has-uploads"),
      ).toBeTruthy(),
    );

    // Simulate the popover's onActioned callback via the stub trigger button.
    const triggerBtn = screen.getByTestId(
      "trigger-onActioned-case-has-uploads",
    );
    fireEvent.click(triggerBtn);

    // CasesTab wires onActioned to () => loadUserDocPendingCounts().
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The tests below exercise the REAL `usePendingCountsPolling` hook
// (client/src/hooks/usePendingCountsPolling.ts), which AdminDashboard now
// calls instead of inlining the interval + visibilitychange effect.
// If someone removes the interval or the listener from the hook, these tests
// will fail — giving us genuine regression protection.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thin wrapper that mounts usePendingCountsPolling so we can test the hook
 * in a jsdom render context without needing to boot AdminDashboard.
 */
function PendingCountsPollingHarness({
  loadFn,
  intervalMs,
}: {
  loadFn: () => void;
  intervalMs?: number;
}) {
  usePendingCountsPolling(loadFn, intervalMs);
  return null;
}

describe("usePendingCountsPolling – polling contract", () => {
  it("calls loadUserDocPendingCounts immediately on mount then again after each 3-second interval", () => {
    const loadFn = vi.fn();

    render(<PendingCountsPollingHarness loadFn={loadFn} />);

    // One immediate call on mount.
    expect(loadFn).toHaveBeenCalledTimes(1);

    // Advance exactly one interval tick.
    vi.advanceTimersByTime(3000);
    expect(loadFn).toHaveBeenCalledTimes(2);

    // Advance a second tick to confirm the interval keeps firing.
    vi.advanceTimersByTime(3000);
    expect(loadFn).toHaveBeenCalledTimes(3);
  });

  it("calls loadUserDocPendingCounts when the document fires a visibilitychange event with visibilityState 'visible'", () => {
    const loadFn = vi.fn();

    render(<PendingCountsPollingHarness loadFn={loadFn} />);

    // Reset after the immediate mount call so we only count event-driven calls.
    loadFn.mockClear();

    // Simulate the tab becoming visible (user switches back to the tab).
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(loadFn).toHaveBeenCalledTimes(1);
  });

  it("does NOT call loadUserDocPendingCounts when visibilityState is 'hidden'", () => {
    const loadFn = vi.fn();

    render(<PendingCountsPollingHarness loadFn={loadFn} />);

    loadFn.mockClear();

    // Simulate the tab being hidden (user switches away — should be ignored).
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(loadFn).not.toHaveBeenCalled();
  });
});
