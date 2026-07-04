// @vitest-environment jsdom
//
// Task #780 — Cover the "WITHDRAWAL PENDING" badge in CasesTab.
//
// Contracts verified:
//   1. The `badge-withdrawal-pending-<caseId>` badge renders only for cases
//      whose id has a pending count > 0 in `withdrawalPendingCounts`.
//   2. The badge is absent for cases with no pending withdrawal request.
//   3. Clicking the badge opens the withdrawal-requests dialog for that case.

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
const PENDING_CASE_ID = "case-wr-pending";
const CLEAR_CASE_ID = "case-wr-clear";

const CASE_PENDING = {
  id: PENDING_CASE_ID,
  accessCode: "WRPEND1",
  status: "active" as const,
};

const CASE_CLEAR = {
  id: CLEAR_CASE_ID,
  accessCode: "WRCLEAR2",
  status: "active" as const,
};

// Spy shared across the suite so we can assert the click handler wiring.
const openWithdrawalRequestsDialog = vi.fn();

// ── mock context builder ──────────────────────────────────────────────────────
// Task #813 — built from the shared, type-checked factory so adding a new
// required field to AdminDashboardContextValue surfaces a COMPILE error here
// instead of crashing this test at runtime. We only override the handful of
// values these tests actually exercise.
function buildMockContext(): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: [CASE_PENDING, CASE_CLEAR] as unknown as Case[],
    filteredCases: [CASE_PENDING, CASE_CLEAR] as unknown as Case[],
    // ← the values under test
    withdrawalPendingCounts: { [PENDING_CASE_ID]: 2 },
    openWithdrawalRequestsDialog,
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
  vi.useFakeTimers({ shouldAdvanceTime: true });
  openWithdrawalRequestsDialog.mockClear();

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
describe("CasesTab – withdrawal-pending badge", () => {
  it("renders the badge only for a case with a pending withdrawal count > 0", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-withdrawal-pending-${PENDING_CASE_ID}`),
      ).toBeTruthy(),
    );

    expect(
      screen.getByTestId(`badge-withdrawal-pending-${PENDING_CASE_ID}`)
        .textContent,
    ).toContain("WITHDRAWAL PENDING");
  });

  it("does NOT render the badge for a case with no pending withdrawal request", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-withdrawal-pending-${PENDING_CASE_ID}`),
      ).toBeTruthy(),
    );

    expect(
      screen.queryByTestId(`badge-withdrawal-pending-${CLEAR_CASE_ID}`),
    ).toBeNull();
  });

  it("opens the withdrawal-requests dialog when the badge is clicked", async () => {
    render(<CasesTab />);

    const badge = await screen.findByTestId(
      `badge-withdrawal-pending-${PENDING_CASE_ID}`,
    );
    fireEvent.click(badge);

    expect(openWithdrawalRequestsDialog).toHaveBeenCalledTimes(1);
    expect(openWithdrawalRequestsDialog.mock.calls[0][0]).toMatchObject({
      id: PENDING_CASE_ID,
    });
  });
});
