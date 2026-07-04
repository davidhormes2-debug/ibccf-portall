// @vitest-environment jsdom
//
// Verifies the Refund Claims KPI card in AnalyticsTab:
//   1. The card (data-testid="card-refund-claims-kpi") is absent when no
//      cases carry a refundClaimStatus — i.e. refundClaimTotal === 0.
//   2. The card is visible and shows the correct total when cases do carry
//      refundClaimStatus values.
//   3. Clicking the "Submitted" sub-count button invokes
//      setRefundClaimStatusFilter("submitted") and setActiveTab("cases").

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import type { Case } from "@/components/admin/shared";

// ── framer-motion: passthrough stub so motion.div etc. are plain divs ─────────
vi.mock("framer-motion", () => {
  const passthrough = (Tag: keyof React.JSX.IntrinsicElements) => {
    const C = ({ children, ...rest }: Record<string, unknown>) =>
      React.createElement(Tag, { ...rest, style: undefined }, children as React.ReactNode);
    C.displayName = `motion.${String(Tag)}`;
    return C;
  };
  return {
    motion: new Proxy({}, { get: (_t, prop: string) => passthrough(prop as keyof React.JSX.IntrinsicElements) }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

// ── recharts: stub chart components so SVG layout doesn't blow up in jsdom ────
vi.mock("recharts", () => ({
  BarChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="recharts-barchart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="recharts-piechart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  Legend: () => null,
  LineChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="recharts-linechart">{children}</div>,
  Line: () => null,
}));

// ── AdminDashboardContext: let each test supply its own context value ──────────
let mockContextValue: AdminDashboardContextValue;

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => mockContextValue,
  };
});

// ── Spies shared across the suite ─────────────────────────────────────────────
const setRefundClaimStatusFilter = vi.fn();
const setActiveTab = vi.fn();

// ── Case fixtures ─────────────────────────────────────────────────────────────
function makeCase(id: string, refundClaimStatus?: string): Partial<Case> {
  return { id, accessCode: id.toUpperCase(), status: "active" as const, refundClaimStatus } as Partial<Case>;
}

// ── fetch stub — silences on-mount community threads + views-over-time calls ──
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
  setActiveTab.mockClear();

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

  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
    .fn()
    .mockImplementation(notFoundResponse);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── component under test (imported after all vi.mock calls) ───────────────────
import { AnalyticsTab } from "../tabs/AnalyticsTab";

// ─────────────────────────────────────────────────────────────────────────────
describe("AnalyticsTab – Refund Claims KPI card", () => {
  it("hides the card when no cases have a refundClaimStatus (refundClaimTotal === 0)", async () => {
    mockContextValue = buildMockAdminDashboardContext({
      cases: [
        makeCase("case-a"),
        makeCase("case-b"),
      ] as unknown as Case[],
      setRefundClaimStatusFilter,
      setActiveTab,
    });

    render(<AnalyticsTab />);

    // Give mount effects time to settle.
    await vi.runAllTimersAsync();

    expect(screen.queryByTestId("card-refund-claims-kpi")).toBeNull();
  });

  it("shows the card with the correct total when cases carry refundClaimStatus values", async () => {
    mockContextValue = buildMockAdminDashboardContext({
      cases: [
        makeCase("case-1", "pending_submission"),
        makeCase("case-2", "submitted"),
        makeCase("case-3", "submitted"),
        makeCase("case-4", "approved"),
        makeCase("case-5"),
      ] as unknown as Case[],
      setRefundClaimStatusFilter,
      setActiveTab,
    });

    render(<AnalyticsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("card-refund-claims-kpi")).toBeTruthy(),
    );

    const totalEl = screen.getByTestId("text-refund-claims-total");
    expect(totalEl.textContent).toBe("4");
  });

  it("shows only the non-zero sub-count pills", async () => {
    mockContextValue = buildMockAdminDashboardContext({
      cases: [
        makeCase("case-1", "submitted"),
        makeCase("case-2", "submitted"),
        makeCase("case-3", "approved"),
      ] as unknown as Case[],
      setRefundClaimStatusFilter,
      setActiveTab,
    });

    render(<AnalyticsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("card-refund-claims-kpi")).toBeTruthy(),
    );

    expect(screen.getByTestId("text-refund-submitted").textContent).toBe("2");
    expect(screen.getByTestId("text-refund-approved").textContent).toBe("1");

    expect(screen.queryByTestId("text-refund-pending-submission")).toBeNull();
    expect(screen.queryByTestId("text-refund-rejected")).toBeNull();
  });

  it("clicking the Submitted button calls setRefundClaimStatusFilter('submitted') and setActiveTab('cases')", async () => {
    mockContextValue = buildMockAdminDashboardContext({
      cases: [
        makeCase("case-1", "submitted"),
      ] as unknown as Case[],
      setRefundClaimStatusFilter,
      setActiveTab,
    });

    render(<AnalyticsTab />);

    // Advance all pending timers so on-mount effects settle before we interact.
    await vi.runAllTimersAsync();

    // Use waitFor to ensure the button is present before clicking.
    await waitFor(() => {
      expect(screen.getByTestId("button-refund-submitted-kpi")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("button-refund-submitted-kpi"));

    expect(setRefundClaimStatusFilter).toHaveBeenCalledTimes(1);
    expect(setRefundClaimStatusFilter).toHaveBeenCalledWith("submitted");
    expect(setActiveTab).toHaveBeenCalledTimes(1);
    expect(setActiveTab).toHaveBeenCalledWith("cases");
  });

  it("clicking the Approved button calls setRefundClaimStatusFilter('approved') and setActiveTab('cases')", async () => {
    mockContextValue = buildMockAdminDashboardContext({
      cases: [
        makeCase("case-1", "approved"),
      ] as unknown as Case[],
      setRefundClaimStatusFilter,
      setActiveTab,
    });

    render(<AnalyticsTab />);

    await vi.runAllTimersAsync();

    await waitFor(() => {
      expect(screen.getByTestId("button-refund-approved-kpi")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("button-refund-approved-kpi"));

    expect(setRefundClaimStatusFilter).toHaveBeenCalledTimes(1);
    expect(setRefundClaimStatusFilter).toHaveBeenCalledWith("approved");
    expect(setActiveTab).toHaveBeenCalledTimes(1);
    expect(setActiveTab).toHaveBeenCalledWith("cases");
  });

  it("clicking the Rejected button calls setRefundClaimStatusFilter('rejected') and setActiveTab('cases')", async () => {
    mockContextValue = buildMockAdminDashboardContext({
      cases: [
        makeCase("case-1", "rejected"),
      ] as unknown as Case[],
      setRefundClaimStatusFilter,
      setActiveTab,
    });

    render(<AnalyticsTab />);

    await vi.runAllTimersAsync();

    await waitFor(() => {
      expect(screen.getByTestId("button-refund-rejected-kpi")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("button-refund-rejected-kpi"));

    expect(setRefundClaimStatusFilter).toHaveBeenCalledTimes(1);
    expect(setRefundClaimStatusFilter).toHaveBeenCalledWith("rejected");
    expect(setActiveTab).toHaveBeenCalledTimes(1);
    expect(setActiveTab).toHaveBeenCalledWith("cases");
  });

  it("approved pill count updates when a case transitions from submitted to approved", async () => {
    // Initial state: one submitted case, zero approved.
    mockContextValue = buildMockAdminDashboardContext({
      cases: [
        makeCase("case-1", "submitted"),
        makeCase("case-2", "submitted"),
      ] as unknown as Case[],
      setRefundClaimStatusFilter,
      setActiveTab,
    });

    const { rerender } = render(<AnalyticsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("card-refund-claims-kpi")).toBeTruthy(),
    );

    // Before transition: approved pill absent, submitted count is 2.
    expect(screen.queryByTestId("text-refund-approved")).toBeNull();
    expect(screen.getByTestId("text-refund-submitted").textContent).toBe("2");

    // Simulate case-1 moving from submitted → approved.
    mockContextValue = buildMockAdminDashboardContext({
      cases: [
        makeCase("case-1", "approved"),
        makeCase("case-2", "submitted"),
      ] as unknown as Case[],
      setRefundClaimStatusFilter,
      setActiveTab,
    });

    rerender(<AnalyticsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("text-refund-approved")).toBeTruthy(),
    );

    expect(screen.getByTestId("text-refund-approved").textContent).toBe("1");
    expect(screen.getByTestId("text-refund-submitted").textContent).toBe("1");
  });

  it("rejected pill count updates when a case transitions from submitted to rejected", async () => {
    // Initial state: one submitted case, zero rejected.
    mockContextValue = buildMockAdminDashboardContext({
      cases: [
        makeCase("case-1", "submitted"),
        makeCase("case-2", "submitted"),
      ] as unknown as Case[],
      setRefundClaimStatusFilter,
      setActiveTab,
    });

    const { rerender } = render(<AnalyticsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("card-refund-claims-kpi")).toBeTruthy(),
    );

    // Before transition: rejected pill absent, submitted count is 2.
    expect(screen.queryByTestId("text-refund-rejected")).toBeNull();
    expect(screen.getByTestId("text-refund-submitted").textContent).toBe("2");

    // Simulate case-2 moving from submitted → rejected.
    mockContextValue = buildMockAdminDashboardContext({
      cases: [
        makeCase("case-1", "submitted"),
        makeCase("case-2", "rejected"),
      ] as unknown as Case[],
      setRefundClaimStatusFilter,
      setActiveTab,
    });

    rerender(<AnalyticsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("text-refund-rejected")).toBeTruthy(),
    );

    expect(screen.getByTestId("text-refund-rejected").textContent).toBe("1");
    expect(screen.getByTestId("text-refund-submitted").textContent).toBe("1");
  });

  it("approved and rejected pills both appear simultaneously with correct counts", async () => {
    mockContextValue = buildMockAdminDashboardContext({
      cases: [
        makeCase("case-1", "approved"),
        makeCase("case-2", "approved"),
        makeCase("case-3", "rejected"),
        makeCase("case-4", "submitted"),
      ] as unknown as Case[],
      setRefundClaimStatusFilter,
      setActiveTab,
    });

    render(<AnalyticsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("card-refund-claims-kpi")).toBeTruthy(),
    );

    expect(screen.getByTestId("text-refund-approved").textContent).toBe("2");
    expect(screen.getByTestId("text-refund-rejected").textContent).toBe("1");
    expect(screen.getByTestId("text-refund-submitted").textContent).toBe("1");
    expect(screen.getByTestId("text-refund-claims-total").textContent).toBe("4");

    // pending_submission pill must be absent.
    expect(screen.queryByTestId("text-refund-pending-submission")).toBeNull();
  });
});
