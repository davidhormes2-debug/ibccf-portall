// @vitest-environment jsdom
//
// Verifies that the amber "active-warnings" badge on the "Broadcast" nav item
// in AdminGroupedNav renders with the correct count when activeWarningsCount > 0
// and is absent from the DOM when activeWarningsCount is 0.
//
// data-testid: "badge-communications-active-warnings"
//
// Contracts verified:
//   1. Non-zero count — badge is visible and displays the exact count.
//   2. Zero count — badge is not rendered at all.

import React, { useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AdminGroupedNav } from "../AdminGroupedNav";

// ── minimal harness ───────────────────────────────────────────────────────────
function NavHarness({ activeWarningsCount }: { activeWarningsCount: number }) {
  const [tab, setTab] = useState("communications");
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
        reactivationPendingCount={0}
        onReactivationBadgeClick={() => {}}
        activeWarningsCount={activeWarningsCount}
      />
      <TabsContent value="communications">PANEL-communications</TabsContent>
    </Tabs>
  );
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  localStorage.clear();

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
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("AdminGroupedNav — active-warnings badge", () => {
  it("renders the badge with the correct count when activeWarningsCount > 0", () => {
    render(<NavHarness activeWarningsCount={3} />);

    const badge = screen.getByTestId("badge-communications-active-warnings");
    expect(badge).toBeTruthy();
    expect(badge.textContent?.trim()).toBe("3");
  });

  it("badge is absent from the DOM when activeWarningsCount is 0", () => {
    render(<NavHarness activeWarningsCount={0} />);

    expect(
      screen.queryByTestId("badge-communications-active-warnings"),
    ).toBeNull();
  });
});
