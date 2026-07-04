// @vitest-environment jsdom
//
// Cover the "REACTIVATION PENDING" badge and triage pill in CasesTab.
//
// Contracts verified:
//   1. The `badge-reactivation-pending-<caseId>` badge renders only for a
//      disabled case whose id has a pending count > 0 in
//      `reactivationPendingCounts`.
//   2. The badge is absent for a disabled case with no pending count.
//   3. The badge is absent for an enabled case even when a count is provided.
//   4. Clicking the badge calls `openReceiptsDialog` for that case.
//   5. The badge disappears when `reactivationPendingCounts` drops to zero
//      for a case (simulating receipt approval or rejection).
//   6. The `button-filter-reactivation-pending` triage pill renders when the
//      aggregate pending count is > 0 and is absent when the count is 0.
//   7. Clicking the triage pill calls `setReactivationPendingOnly` with the
//      toggled value.
//   8. When `reactivationPendingOnly` is true the local rows memo only keeps
//      cases that are disabled AND have a pending count > 0, so the CLEAR and
//      ENABLED rows are excluded from the rendered list.
//   9. Clicking the "Clear filters" button (button-clear-all-filters) calls
//      `setReactivationPendingOnly(false)` so the triage pill visual state
//      stays in sync with the actual filter state after a reset.

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
vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => buildMockContext(),
  };
});

// ── stub SupportingDocsQuickPopover – the real one opens Radix + fetch ────────
vi.mock("@/components/admin/SupportingDocsQuickPopover", () => ({
  SupportingDocsQuickPopover: ({
    caseId,
    count,
  }: {
    caseId: string;
    count: number;
    authToken: string | null;
    onActioned?: () => void;
  }) => (
    <span data-testid={`badge-user-doc-pending-${caseId}`}>
      {count} NEW UPLOADS
    </span>
  ),
}));

// ── case fixtures ─────────────────────────────────────────────────────────────
const PENDING_CASE_ID = "case-react-pending";
const CLEAR_CASE_ID = "case-react-clear";
const ENABLED_CASE_ID = "case-react-enabled";

const CASE_PENDING: Partial<Case> = {
  id: PENDING_CASE_ID,
  accessCode: "RPEND1",
  status: "active" as const,
  isDisabled: true,
};

const CASE_CLEAR: Partial<Case> = {
  id: CLEAR_CASE_ID,
  accessCode: "RCLEAR2",
  status: "active" as const,
  isDisabled: true,
};

const CASE_ENABLED: Partial<Case> = {
  id: ENABLED_CASE_ID,
  accessCode: "RENABLED3",
  status: "active" as const,
  isDisabled: false,
};

// Spy shared across the suite so we can assert the click handler wiring.
const openReceiptsDialog = vi.fn();
const setReactivationPendingOnly = vi.fn();

// ── mutable context options – changed per-test where needed ──────────────────
type MockContextOptions = {
  reactivationPendingCounts: Record<string, number>;
  reactivationPendingOnly: boolean;
};

let mockContextOptions: MockContextOptions = {
  reactivationPendingCounts: {
    [PENDING_CASE_ID]: 1,
    [ENABLED_CASE_ID]: 2,
  },
  reactivationPendingOnly: false,
};

// ── mock context builder ──────────────────────────────────────────────────────
function buildMockContext(): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: [CASE_PENDING, CASE_CLEAR, CASE_ENABLED] as unknown as Case[],
    filteredCases: [CASE_PENDING, CASE_CLEAR, CASE_ENABLED] as unknown as Case[],
    reactivationPendingCounts: mockContextOptions.reactivationPendingCounts,
    reactivationPendingOnly: mockContextOptions.reactivationPendingOnly,
    setReactivationPendingOnly,
    openReceiptsDialog,
  });
}

// ── fetch stub – silences on-mount effects that call admin APIs ───────────────
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
  mockContextOptions = {
    reactivationPendingCounts: {
      [PENDING_CASE_ID]: 1,
      [ENABLED_CASE_ID]: 2,
    },
    reactivationPendingOnly: false,
  };

  vi.useFakeTimers({ shouldAdvanceTime: true });
  openReceiptsDialog.mockClear();
  setReactivationPendingOnly.mockClear();

  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (
    !(Element.prototype as unknown as { hasPointerCapture?: unknown })
      .hasPointerCapture
  ) {
    (
      Element.prototype as unknown as { hasPointerCapture: () => boolean }
    ).hasPointerCapture = () => false;
  }

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
  (
    globalThis as unknown as {
      sessionStorage: { setItem: (k: string, v: string) => void };
    }
  ).sessionStorage.setItem("adminToken", "test-token");

  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
    .fn()
    .mockImplementation(notFoundResponse);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── import under test (after all mocks are declared) ─────────────────────────
import { CasesTab } from "../tabs/CasesTab";

// ─────────────────────────────────────────────────────────────────────────────
describe("CasesTab – reactivation-pending badge", () => {
  it("renders the badge for a disabled case with a pending reactivation count > 0", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-reactivation-pending-${PENDING_CASE_ID}`),
      ).toBeTruthy(),
    );

    expect(
      screen.getByTestId(`badge-reactivation-pending-${PENDING_CASE_ID}`)
        .textContent,
    ).toContain("REACTIVATION PENDING");
  });

  it("does NOT render the badge for a disabled case with no pending count", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-reactivation-pending-${PENDING_CASE_ID}`),
      ).toBeTruthy(),
    );

    expect(
      screen.queryByTestId(`badge-reactivation-pending-${CLEAR_CASE_ID}`),
    ).toBeNull();
  });

  it("does NOT render the badge for an enabled case even when a count is present", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-reactivation-pending-${PENDING_CASE_ID}`),
      ).toBeTruthy(),
    );

    expect(
      screen.queryByTestId(`badge-reactivation-pending-${ENABLED_CASE_ID}`),
    ).toBeNull();
  });

  it("calls openReceiptsDialog for the correct case when the badge is clicked", async () => {
    render(<CasesTab />);

    const badge = await screen.findByTestId(
      `badge-reactivation-pending-${PENDING_CASE_ID}`,
    );
    fireEvent.click(badge);

    expect(openReceiptsDialog).toHaveBeenCalledTimes(1);
    expect(openReceiptsDialog.mock.calls[0][0]).toMatchObject({
      id: PENDING_CASE_ID,
    });
  });

  it("disappears for a case after its reactivationPendingCounts entry drops to zero (simulates receipt approval/rejection)", async () => {
    const { rerender } = render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-reactivation-pending-${PENDING_CASE_ID}`),
      ).toBeTruthy(),
    );

    // Simulate the counts being cleared after the admin approves or rejects the receipt.
    mockContextOptions = {
      reactivationPendingCounts: {},
      reactivationPendingOnly: false,
    };
    rerender(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.queryByTestId(`badge-reactivation-pending-${PENDING_CASE_ID}`),
      ).toBeNull(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("CasesTab – reactivation-pending triage pill", () => {
  it("renders the triage pill when at least one pending count is > 0", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId("button-filter-reactivation-pending"),
      ).toBeTruthy(),
    );
  });

  it("does NOT render the triage pill when all pending counts are zero", async () => {
    mockContextOptions = {
      reactivationPendingCounts: {},
      reactivationPendingOnly: false,
    };

    render(<CasesTab />);

    // Wait for the component to settle, then assert the pill is absent.
    await waitFor(() =>
      expect(
        screen.queryByTestId("button-filter-reactivation-pending"),
      ).toBeNull(),
    );
  });

  it("calls setReactivationPendingOnly(true) when the pill is clicked while inactive", async () => {
    render(<CasesTab />);

    const pill = await screen.findByTestId("button-filter-reactivation-pending");
    fireEvent.click(pill);

    expect(setReactivationPendingOnly).toHaveBeenCalledTimes(1);
    expect(setReactivationPendingOnly).toHaveBeenCalledWith(true);
  });

  it("calls setReactivationPendingOnly(false) when the pill is clicked while active", async () => {
    mockContextOptions = {
      reactivationPendingCounts: {
        [PENDING_CASE_ID]: 1,
      },
      reactivationPendingOnly: true,
    };

    render(<CasesTab />);

    const pill = await screen.findByTestId("button-filter-reactivation-pending");
    fireEvent.click(pill);

    expect(setReactivationPendingOnly).toHaveBeenCalledTimes(1);
    expect(setReactivationPendingOnly).toHaveBeenCalledWith(false);
  });

  it("filters the rendered rows so only disabled cases with a pending count appear when reactivationPendingOnly is true", async () => {
    mockContextOptions = {
      reactivationPendingCounts: {
        [PENDING_CASE_ID]: 1,
      },
      reactivationPendingOnly: true,
    };

    render(<CasesTab />);

    // PENDING_CASE_ID is disabled and has a count — its badge must show.
    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-reactivation-pending-${PENDING_CASE_ID}`),
      ).toBeTruthy(),
    );

    // CLEAR_CASE_ID is disabled but has count 0 — its row must be excluded by the filter.
    expect(
      screen.queryByTestId(`row-case-${CLEAR_CASE_ID}`),
    ).toBeNull();

    // ENABLED_CASE_ID is not disabled — its row must be excluded by the filter.
    expect(
      screen.queryByTestId(`row-case-${ENABLED_CASE_ID}`),
    ).toBeNull();
  });

  it("calls setReactivationPendingOnly(false) when the Clear filters button is clicked while the pill is active", async () => {
    mockContextOptions = {
      reactivationPendingCounts: {
        [PENDING_CASE_ID]: 1,
      },
      reactivationPendingOnly: true,
    };

    render(<CasesTab />);

    const clearBtn = await screen.findByTestId("button-clear-all-filters");
    fireEvent.click(clearBtn);

    expect(setReactivationPendingOnly).toHaveBeenCalledWith(false);
  });
});
