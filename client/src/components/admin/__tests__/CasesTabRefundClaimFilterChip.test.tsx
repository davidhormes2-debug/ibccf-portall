// @vitest-environment jsdom
//
// Tests for the refund-claim filter chip in CasesTab.
//
// Contracts verified:
//   1. Each refundClaimStatusFilter value ("pending_submission", "submitted",
//      "approved", "rejected") causes the chip to appear with the correct label.
//   2. Clicking data-testid="button-clear-refund-claim-filter" calls
//      setRefundClaimStatusFilter("all") without touching searchQuery or other
//      active filter state.
//   3. Filter value "all" produces no chip (chip absent from DOM).

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import type { RefundClaimStatusFilter } from "@shared/types";

// ── mock use-toast so shadcn toasts don't throw ──────────────────────────────
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── mock AdminDashboardContext – we control the values under test ─────────────
let mockContextFactory: () => AdminDashboardContextValue;

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => mockContextFactory(),
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

// ── shared spy ────────────────────────────────────────────────────────────────
const setRefundClaimStatusFilter = vi.fn();

// ── context builder ───────────────────────────────────────────────────────────
function buildContext(refundClaimStatusFilter: RefundClaimStatusFilter): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: [],
    filteredCases: [],
    refundClaimStatusFilter,
    setRefundClaimStatusFilter,
    // Keep searchQuery and other filters at their defaults to verify isolation.
    searchQuery: "my-query",
    statusFilter: "active",
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
  setRefundClaimStatusFilter.mockClear();

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

// ── helper to anchor on a stable element so we know the tab has mounted ───────
// "button-new-case" is always rendered in CasesTab regardless of filter state.
async function waitForTabMount() {
  await waitFor(() =>
    expect(screen.getByTestId("button-new-case")).toBeTruthy(),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe("CasesTab — refund-claim filter chip visibility", () => {
  it("shows no chip when refundClaimStatusFilter is 'all'", async () => {
    mockContextFactory = () => buildMockAdminDashboardContext({
      cases: [],
      filteredCases: [],
      refundClaimStatusFilter: "all",
      setRefundClaimStatusFilter,
    });

    render(<CasesTab />);
    await waitForTabMount();

    expect(
      screen.queryByTestId("button-clear-refund-claim-filter"),
    ).toBeNull();
  });

  it("shows chip labelled 'Refund: Pending submission' for pending_submission", async () => {
    mockContextFactory = () => buildContext("pending_submission");
    render(<CasesTab />);

    await waitForTabMount();

    const chip = screen.getByTestId("button-clear-refund-claim-filter");
    expect(chip.closest("span")?.textContent).toBe("Refund: Pending submission");
  });

  it("shows chip labelled 'Refund: Submitted' for submitted", async () => {
    mockContextFactory = () => buildContext("submitted");
    render(<CasesTab />);

    await waitForTabMount();

    const chip = screen.getByTestId("button-clear-refund-claim-filter");
    expect(chip.closest("span")?.textContent).toBe("Refund: Submitted");
  });

  it("shows chip labelled 'Refund: Approved' for approved", async () => {
    mockContextFactory = () => buildContext("approved");
    render(<CasesTab />);

    await waitForTabMount();

    const chip = screen.getByTestId("button-clear-refund-claim-filter");
    expect(chip.closest("span")?.textContent).toBe("Refund: Approved");
  });

  it("shows chip labelled 'Refund: Rejected' for rejected", async () => {
    mockContextFactory = () => buildContext("rejected");
    render(<CasesTab />);

    await waitForTabMount();

    const chip = screen.getByTestId("button-clear-refund-claim-filter");
    expect(chip.closest("span")?.textContent).toBe("Refund: Rejected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("CasesTab — refund-claim filter chip clear button", () => {
  const ACTIVE_STATUSES: RefundClaimStatusFilter[] = [
    "pending_submission",
    "submitted",
    "approved",
    "rejected",
  ];

  it.each(ACTIVE_STATUSES)(
    "clicking × calls setRefundClaimStatusFilter('all') when status is '%s'",
    async (status) => {
      mockContextFactory = () => buildContext(status);
      render(<CasesTab />);

      await waitForTabMount();

      const clearBtn = screen.getByTestId("button-clear-refund-claim-filter");
      fireEvent.click(clearBtn);

      expect(setRefundClaimStatusFilter).toHaveBeenCalledTimes(1);
      expect(setRefundClaimStatusFilter).toHaveBeenCalledWith("all");
    },
  );

  it.each(ACTIVE_STATUSES)(
    "chip disappears from the DOM after clicking × when status is '%s'",
    async (initialStatus) => {
      // StatefulCasesTab wires real React state into the mock context so the
      // component re-renders with the updated filter value when × is clicked.
      function StatefulCasesTab() {
        const [filter, setFilter] =
          React.useState<RefundClaimStatusFilter>(initialStatus);

        mockContextFactory = () =>
          buildMockAdminDashboardContext({
            cases: [],
            filteredCases: [],
            refundClaimStatusFilter: filter,
            setRefundClaimStatusFilter: (v) =>
              setFilter(v as RefundClaimStatusFilter),
            searchQuery: "my-query",
          });

        return <CasesTab />;
      }

      render(<StatefulCasesTab />);
      await waitForTabMount();

      // Chip is visible before click.
      expect(
        screen.getByTestId("button-clear-refund-claim-filter"),
      ).toBeTruthy();

      fireEvent.click(screen.getByTestId("button-clear-refund-claim-filter"));

      // After the setter transitions to "all", the chip must be absent.
      await waitFor(() =>
        expect(
          screen.queryByTestId("button-clear-refund-claim-filter"),
        ).toBeNull(),
      );
    },
  );

  it("clicking × does NOT call setSearchQuery or setStatusFilter (other filters isolated)", async () => {
    const setSearchQuery = vi.fn();
    const setStatusFilter = vi.fn();
    mockContextFactory = () =>
      buildMockAdminDashboardContext({
        cases: [],
        filteredCases: [],
        refundClaimStatusFilter: "pending_submission",
        setRefundClaimStatusFilter,
        searchQuery: "my-query",
        setSearchQuery,
        statusFilter: "active",
        setStatusFilter,
      });

    render(<CasesTab />);
    await waitForTabMount();

    const clearBtn = screen.getByTestId("button-clear-refund-claim-filter");
    fireEvent.click(clearBtn);

    expect(setRefundClaimStatusFilter).toHaveBeenCalledWith("all");
    expect(setSearchQuery).not.toHaveBeenCalled();
    expect(setStatusFilter).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("CasesTab — assertNeverRefundStatus exhaustiveness guard", () => {
  it("throws with the unknown status string when a value outside the union is passed", () => {
    // Simulate a future DB status that hasn't been added to the union yet.
    const unknownStatus = "under_review" as unknown as RefundClaimStatusFilter;
    mockContextFactory = () => buildContext(unknownStatus);

    // Inline error boundary so React can catch the thrown render error and we
    // can assert on the message without the test itself crashing.
    class ErrorBoundary extends React.Component<
      { children: React.ReactNode },
      { error: Error | null }
    > {
      constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      render() {
        if (this.state.error) {
          return (
            <span data-testid="assertnever-error">
              {this.state.error.message}
            </span>
          );
        }
        return this.props.children;
      }
    }

    // Suppress the React "uncaught error" console noise for this test.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <CasesTab />
      </ErrorBoundary>,
    );

    consoleError.mockRestore();

    const errorEl = screen.getByTestId("assertnever-error");
    expect(errorEl.textContent).toContain(
      "Unhandled refund claim status: under_review",
    );
  });
});
