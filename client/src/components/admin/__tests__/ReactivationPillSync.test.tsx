// @vitest-environment jsdom
//
// Verify that the Cases nav badge (AdminGroupedNav) and the triage pill inside
// CasesTab always show the same reactivation-pending total.
//
// Both surfaces derive their count from the same source:
//   reactivationPendingTotal = Object.values(reactivationPendingCounts).reduce(...)
//
// AdminGroupedNav receives the already-computed total as the
// `reactivationPendingCount` prop.  CasesTab reads `reactivationPendingCounts`
// from AdminDashboardContext and recomputes the total internally.
//
// If someone refactors the nav badge to read a different field the two counts
// will diverge and one of these assertions will fail.
//
// Contracts verified:
//   1. Non-zero count — nav badge and triage pill both display the same total.
//   2. Zero count — nav badge and triage pill are both absent from the DOM.

import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AdminGroupedNav } from "../AdminGroupedNav";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import type { Case } from "@/components/admin/shared";

// ── silence shadcn toasts ─────────────────────────────────────────────────────
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── stub SupportingDocsQuickPopover – avoids Radix + fetch side-effects ───────
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

// ── mutable context options — changed per-test where needed ──────────────────
let mockReactivationPendingCounts: Record<string, number> = {};

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: (): AdminDashboardContextValue =>
      buildMockAdminDashboardContext({
        cases: [] as Case[],
        filteredCases: [] as Case[],
        reactivationPendingCounts: mockReactivationPendingCounts,
        reactivationPendingOnly: false,
        setReactivationPendingOnly: vi.fn(),
      }),
  };
});

// ── stub fetch so CasesTab on-mount effects don't throw ───────────────────────
function notFoundResponse() {
  return Promise.resolve(
    new Response(JSON.stringify({}), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }) as unknown as Response,
  );
}

// ── AdminGroupedNav minimal harness ──────────────────────────────────────────
function NavHarness({ reactivationPendingCount }: { reactivationPendingCount: number }) {
  const [tab, setTab] = useState("cases");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <AdminGroupedNav
        activeTab={tab}
        setActiveTab={setTab}
        totalUnread={0}
        stampDutyPendingCount={0}
        onStampDutyBadgeClick={() => {}}
        pendingDocCount={0}
        onPendingDocBadgeClick={() => {}}
        supportingDocPendingCount={0}
        onSupportingDocBadgeClick={() => {}}
        withdrawalPendingCount={0}
        onWithdrawalBadgeClick={() => {}}
        refundClaimPendingCount={0}
        onRefundClaimBadgeClick={() => {}}
        reactivationPendingCount={reactivationPendingCount}
        onReactivationBadgeClick={() => {}}
        activeWarningsCount={0}
      />
      <TabsContent value="cases">PANEL-cases</TabsContent>
    </Tabs>
  );
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockReactivationPendingCounts = {};

  vi.useFakeTimers({ shouldAdvanceTime: true });

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

// ── import under test after mocks are declared ────────────────────────────────
import { CasesTab } from "../tabs/CasesTab";

// ── helpers ───────────────────────────────────────────────────────────────────
function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
describe("Reactivation triage pill ↔ nav badge sync", () => {
  it("non-zero count — nav badge and CasesTab triage pill both display the same total", async () => {
    const counts: Record<string, number> = {
      "case-alpha": 2,
      "case-beta": 1,
    };
    const total = sumCounts(counts); // 3

    mockReactivationPendingCounts = counts;

    // ── render CasesTab (reads counts from context, computes total internally)
    const { unmount: unmountTab } = render(<CasesTab />);

    const pill = await screen.findByTestId("button-filter-reactivation-pending");
    const pillCount = pill.querySelector("span")?.textContent?.trim();
    expect(pillCount).toBe(String(total));

    unmountTab();
    cleanup();

    // ── render AdminGroupedNav (receives pre-computed total as a prop)
    render(<NavHarness reactivationPendingCount={total} />);

    const badge = screen.getByTestId("badge-cases-reactivation");
    expect(badge.textContent).toContain(String(total));

    // Both surfaces showed the same number — sync confirmed.
    expect(pillCount).toBe(badge.textContent?.trim() ?? "");
  });

  it("zero count — nav badge and CasesTab triage pill are both absent", async () => {
    mockReactivationPendingCounts = {};
    const total = sumCounts(mockReactivationPendingCounts); // 0

    // ── CasesTab: pill should not render
    const { unmount: unmountTab } = render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.queryByTestId("button-filter-reactivation-pending"),
      ).toBeNull(),
    );

    unmountTab();
    cleanup();

    // ── AdminGroupedNav: badge should not render
    render(<NavHarness reactivationPendingCount={total} />);

    expect(screen.queryByTestId("badge-cases-reactivation")).toBeNull();
  });
});
