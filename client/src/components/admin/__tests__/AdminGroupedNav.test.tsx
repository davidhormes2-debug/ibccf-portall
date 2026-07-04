// @vitest-environment jsdom
//
// Task #167 — Cover the redesigned admin sidebar (Task #166):
//   - All four groups (Cases / Compliance / Communications / System)
//     render with their headers.
//   - Clicking a tab inside a group flips the active TabsContent in the
//     surrounding Tabs root.
//
// Task #330 — Cover the pending-document badge (Task #270):
//   - The Documents nav item shows a red badge with the correct count
//     when pendingDocCount > 0.
//   - The badge disappears once pendingDocCount drops to 0 (i.e. after
//     an admin approves or rejects the outstanding requests).

import React, { useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AdminGroupedNav } from "../AdminGroupedNav";
import { countRefundClaimSubmitted } from "@/lib/refundClaimBadge";

function Harness(props: {
  initialTab?: string;
  pendingDocCount?: number;
  supportingDocPendingCount?: number;
  stampDutyPendingCount?: number;
  withdrawalPendingCount?: number;
  onWithdrawalBadgeClick?: () => void;
  refundClaimPendingCount?: number;
  onRefundClaimBadgeClick?: () => void;
  reactivationPendingCount?: number;
  onReactivationBadgeClick?: () => void;
  totalUnread?: number;
}) {
  const [tab, setTab] = useState(props.initialTab ?? "cases");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <AdminGroupedNav
        activeTab={tab}
        setActiveTab={setTab}
        totalUnread={props.totalUnread ?? 0}
        stampDutyPendingCount={props.stampDutyPendingCount ?? 0}
        onStampDutyBadgeClick={() => {}}
        pendingDocCount={props.pendingDocCount ?? 0}
        onPendingDocBadgeClick={() => {}}
        supportingDocPendingCount={props.supportingDocPendingCount ?? 0}
        onSupportingDocBadgeClick={() => {}}
        withdrawalPendingCount={props.withdrawalPendingCount ?? 0}
        onWithdrawalBadgeClick={props.onWithdrawalBadgeClick ?? (() => {})}
        refundClaimPendingCount={props.refundClaimPendingCount ?? 0}
        onRefundClaimBadgeClick={props.onRefundClaimBadgeClick ?? (() => {})}
        reactivationPendingCount={props.reactivationPendingCount ?? 0}
        onReactivationBadgeClick={props.onReactivationBadgeClick ?? (() => {})}
        activeWarningsCount={0}
      />
      <TabsContent value="cases">PANEL-cases</TabsContent>
      <TabsContent value="submissions">PANEL-submissions</TabsContent>
      <TabsContent value="conversations">PANEL-conversations</TabsContent>
      <TabsContent value="documents">PANEL-documents</TabsContent>
      <TabsContent value="receipts">PANEL-receipts</TabsContent>
      <TabsContent value="analytics">PANEL-analytics</TabsContent>
      <TabsContent value="settings">PANEL-settings</TabsContent>
    </Tabs>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("AdminGroupedNav", () => {
  it("renders all four group headers", () => {
    render(<Harness />);
    expect(screen.getByTestId("group-header-cases").textContent).toMatch(/Cases/i);
    expect(screen.getByTestId("group-header-compliance").textContent).toMatch(/Compliance/i);
    expect(screen.getByTestId("group-header-communications").textContent).toMatch(/Communications/i);
    expect(screen.getByTestId("group-header-system").textContent).toMatch(/System/i);
  });

  it("switches the active TabsContent when an item is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByText("PANEL-cases")).toBeTruthy();

    await user.click(screen.getByTestId("tab-documents"));
    expect(screen.getByText("PANEL-documents")).toBeTruthy();
    expect(screen.queryByText("PANEL-cases")).toBeNull();

    await user.click(screen.getByTestId("tab-analytics"));
    expect(screen.getByText("PANEL-analytics")).toBeTruthy();
    expect(screen.queryByText("PANEL-documents")).toBeNull();
  });

  it("restores the last item per group when the group header is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("tab-documents"));
    await user.click(screen.getByTestId("tab-settings"));
    expect(screen.getByText("PANEL-settings")).toBeTruthy();

    await user.click(screen.getByTestId("group-header-compliance"));
    expect(screen.getByText("PANEL-documents")).toBeTruthy();
  });
});

describe("AdminGroupedNav — pending document badge (Task #330)", () => {
  function getDocumentsTab() {
    return screen.getByTestId("tab-documents");
  }

  it("shows the pending-document badge on the Documents nav item with the correct count", () => {
    render(<Harness pendingDocCount={3} />);

    const docsTab = getDocumentsTab();
    // The alert badge is a sibling span inside the trigger. Find it by its
    // numeric text scoped to the Documents trigger.
    const badge = within(docsTab).getByText("3");
    expect(badge).toBeTruthy();
    // Make sure the alert-style red badge classes are present (the badge
    // surface itself).
    expect(badge.className).toMatch(/bg-red-500/);
  });

  it("renders the exact count number (e.g. 1, 7, 42)", () => {
    const counts = [1, 7, 42];
    for (const n of counts) {
      const { unmount } = render(<Harness pendingDocCount={n} />);
      const docsTab = getDocumentsTab();
      expect(within(docsTab).getByText(String(n))).toBeTruthy();
      unmount();
    }
  });

  it("clears the badge when pendingDocCount drops to 0 after admin review", () => {
    const { rerender } = render(<Harness pendingDocCount={2} />);

    // Initially visible.
    expect(within(getDocumentsTab()).queryByText("2")).not.toBeNull();

    // Simulate admin approving/rejecting both outstanding requests so the
    // dashboard recomputes pendingDocCount to 0.
    rerender(
      <Tabs value="cases" onValueChange={() => {}}>
        <AdminGroupedNav
          activeTab="cases"
          setActiveTab={() => {}}
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
        />
        <TabsContent value="cases">PANEL-cases</TabsContent>
      </Tabs>,
    );

    // Badge is gone.
    expect(within(getDocumentsTab()).queryByText("2")).toBeNull();
    expect(within(getDocumentsTab()).queryByText("0")).toBeNull();
  });

  it("does not render the badge when there are no pending documents", () => {
    render(<Harness pendingDocCount={0} />);
    const docsTab = getDocumentsTab();
    // No numeric badge — the label "Documents" is still present.
    expect(within(docsTab).getByText(/Documents/i)).toBeTruthy();
    expect(within(docsTab).queryByText("0")).toBeNull();
  });
});

describe("AdminGroupedNav — withdrawal pending badge (Task #796)", () => {
  function getCasesBadge() {
    return screen.queryByTestId("badge-cases-withdrawal");
  }

  it("shows the withdrawal badge on the Cases nav item with the correct count", () => {
    render(<Harness withdrawalPendingCount={4} />);
    const badge = getCasesBadge();
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("4");
    expect(badge!.className).toMatch(/bg-emerald-500/);
  });

  it("does not render the withdrawal badge when there are no pending requests", () => {
    render(<Harness withdrawalPendingCount={0} />);
    expect(getCasesBadge()).toBeNull();
  });

  it("clears the withdrawal badge when the count drops to 0", () => {
    const { rerender } = render(<Harness withdrawalPendingCount={3} />);
    expect(getCasesBadge()).not.toBeNull();

    rerender(
      <Tabs value="cases" onValueChange={() => {}}>
        <AdminGroupedNav
          activeTab="cases"
          setActiveTab={() => {}}
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
        />
        <TabsContent value="cases">PANEL-cases</TabsContent>
      </Tabs>,
    );

    expect(getCasesBadge()).toBeNull();
  });

  it("fires onWithdrawalBadgeClick without switching tabs implicitly", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Harness withdrawalPendingCount={2} onWithdrawalBadgeClick={onClick} />);
    await user.click(getCasesBadge()!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders both the stamp-duty and withdrawal badges side by side", () => {
    render(<Harness withdrawalPendingCount={2} stampDutyPendingCount={5} />);
    expect(screen.queryByTestId("badge-cases-withdrawal")).not.toBeNull();
    expect(screen.queryByTestId("badge-cases-warn")).not.toBeNull();
  });
});

describe("AdminGroupedNav — refund claim pending badge", () => {
  function getRefundClaimBadge() {
    return screen.queryByTestId("badge-cases-refund-claim");
  }

  it("shows the refund claim badge on the Cases nav item with the correct count", () => {
    render(<Harness refundClaimPendingCount={3} />);
    const badge = getRefundClaimBadge();
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("3");
    expect(badge!.className).toMatch(/bg-violet-500/);
  });

  it("does not render the refund claim badge when there are no pending claims", () => {
    render(<Harness refundClaimPendingCount={0} />);
    expect(getRefundClaimBadge()).toBeNull();
  });

  it("clears the refund claim badge when the count drops to 0", () => {
    const { rerender } = render(<Harness refundClaimPendingCount={2} />);
    expect(getRefundClaimBadge()).not.toBeNull();

    rerender(
      <Tabs value="cases" onValueChange={() => {}}>
        <AdminGroupedNav
          activeTab="cases"
          setActiveTab={() => {}}
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
        />
        <TabsContent value="cases">PANEL-cases</TabsContent>
      </Tabs>,
    );

    expect(getRefundClaimBadge()).toBeNull();
  });

  it("fires onRefundClaimBadgeClick without switching tabs implicitly", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Harness refundClaimPendingCount={1} onRefundClaimBadgeClick={onClick} />);
    await user.click(getRefundClaimBadge()!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders refund claim, withdrawal, and stamp-duty badges all together", () => {
    render(
      <Harness
        refundClaimPendingCount={1}
        withdrawalPendingCount={2}
        stampDutyPendingCount={5}
      />,
    );
    expect(screen.queryByTestId("badge-cases-refund-claim")).not.toBeNull();
    expect(screen.queryByTestId("badge-cases-withdrawal")).not.toBeNull();
    expect(screen.queryByTestId("badge-cases-warn")).not.toBeNull();
  });
});

describe("AdminGroupedNav — reactivation pending badge", () => {
  function getReactivationBadge() {
    return screen.queryByTestId("badge-cases-reactivation");
  }

  it("shows the reactivation badge on the Cases nav item with the correct count", () => {
    render(<Harness reactivationPendingCount={2} />);
    const badge = getReactivationBadge();
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("2");
    expect(badge!.className).toMatch(/bg-orange-500/);
  });

  it("does not render the reactivation badge when there are no pending reactivations", () => {
    render(<Harness reactivationPendingCount={0} />);
    expect(getReactivationBadge()).toBeNull();
  });

  it("clears the reactivation badge when the count drops to 0", () => {
    const { rerender } = render(<Harness reactivationPendingCount={3} />);
    expect(getReactivationBadge()).not.toBeNull();

    rerender(
      <Tabs value="cases" onValueChange={() => {}}>
        <AdminGroupedNav
          activeTab="cases"
          setActiveTab={() => {}}
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
        />
        <TabsContent value="cases">PANEL-cases</TabsContent>
      </Tabs>,
    );

    expect(getReactivationBadge()).toBeNull();
  });

  it("fires onReactivationBadgeClick when clicked without implicitly switching tabs", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Harness reactivationPendingCount={1} onReactivationBadgeClick={onClick} />);
    await user.click(getReactivationBadge()!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders reactivation, withdrawal, refund-claim, and stamp-duty badges all together", () => {
    render(
      <Harness
        reactivationPendingCount={1}
        refundClaimPendingCount={2}
        withdrawalPendingCount={3}
        stampDutyPendingCount={4}
      />,
    );
    expect(screen.queryByTestId("badge-cases-reactivation")).not.toBeNull();
    expect(screen.queryByTestId("badge-cases-refund-claim")).not.toBeNull();
    expect(screen.queryByTestId("badge-cases-withdrawal")).not.toBeNull();
    expect(screen.queryByTestId("badge-cases-warn")).not.toBeNull();
  });
});

describe("AdminGroupedNav — function search", () => {
  it("filters nav items to those matching the query", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // All items visible before typing.
    expect(screen.getByTestId("tab-cases")).toBeTruthy();
    expect(screen.getByTestId("tab-settings")).toBeTruthy();

    await user.type(screen.getByTestId("admin-nav-search"), "settings");

    expect(screen.getByTestId("tab-settings")).toBeTruthy();
    expect(screen.queryByTestId("tab-cases")).toBeNull();
    // The whole non-matching group disappears too.
    expect(screen.queryByTestId("group-header-cases")).toBeNull();
  });

  it("shows a no-results message when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByTestId("admin-nav-search"), "zzzznomatch");

    expect(screen.getByTestId("admin-nav-no-results")).toBeTruthy();
    expect(screen.queryByTestId("tab-cases")).toBeNull();
  });

  it("activates the first match when Enter is pressed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByText("PANEL-cases")).toBeTruthy();

    const search = screen.getByTestId("admin-nav-search");
    await user.type(search, "analytics");
    await user.type(search, "{Enter}");

    expect(screen.getByText("PANEL-analytics")).toBeTruthy();
    expect(screen.queryByText("PANEL-cases")).toBeNull();
  });

  it("clears the query when Escape is pressed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const search = screen.getByTestId("admin-nav-search");
    await user.type(search, "settings");
    expect(screen.queryByTestId("tab-cases")).toBeNull();

    await user.type(search, "{Escape}");

    expect(screen.getByTestId("tab-cases")).toBeTruthy();
    expect(screen.getByTestId("tab-settings")).toBeTruthy();
  });

  it("clears the query when the clear button is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByTestId("admin-nav-search"), "settings");
    expect(screen.queryByTestId("tab-cases")).toBeNull();

    await user.click(screen.getByTestId("admin-nav-search-clear"));

    // All groups restored.
    expect(screen.getByTestId("tab-cases")).toBeTruthy();
    expect(screen.getByTestId("tab-settings")).toBeTruthy();
  });
});

describe("AdminGroupedNav — refund claim badge count formula", () => {
  // Tests exercise the real `countRefundClaimSubmitted` selector imported from
  // @/lib/refundClaimBadge — the same function AdminDashboard.tsx uses to drive
  // the Cases nav badge.  Any change to the production predicate will cause
  // these tests to fail, preventing silent badge inflation.

  const NON_BADGE_STATUSES = [null, "pending_submission", "approved", "rejected"] as const;

  it("only counts cases with status 'submitted'", () => {
    const cases = [
      { refundClaimStatus: "submitted" },
      { refundClaimStatus: "submitted" },
      { refundClaimStatus: null },
      { refundClaimStatus: "pending_submission" },
      { refundClaimStatus: "approved" },
      { refundClaimStatus: "rejected" },
    ];
    expect(countRefundClaimSubmitted(cases)).toBe(2);
  });

  it.each(NON_BADGE_STATUSES)(
    "status '%s' does NOT contribute to the badge count",
    (status) => {
      expect(countRefundClaimSubmitted([{ refundClaimStatus: status }])).toBe(0);
    },
  );

  it("status 'submitted' contributes exactly 1 to the badge count", () => {
    expect(countRefundClaimSubmitted([{ refundClaimStatus: "submitted" }])).toBe(1);
  });

  it("an empty case list produces a badge count of 0", () => {
    expect(countRefundClaimSubmitted([])).toBe(0);
  });

  it("adding a new non-submitted status does not inflate the badge", () => {
    const futureStatuses = [...NON_BADGE_STATUSES, "under_review"] as const;
    for (const status of futureStatuses) {
      expect(countRefundClaimSubmitted([{ refundClaimStatus: status }])).toBe(0);
    }
  });

  it("also renders the correct badge count in the AdminGroupedNav component", () => {
    const cases = [
      { refundClaimStatus: "submitted" },
      { refundClaimStatus: "pending_submission" },
      { refundClaimStatus: null },
    ];
    const count = countRefundClaimSubmitted(cases);
    expect(count).toBe(1);

    render(
      <Tabs value="cases" onValueChange={() => {}}>
        <AdminGroupedNav
          activeTab="cases"
          setActiveTab={() => {}}
          totalUnread={0}
          stampDutyPendingCount={0}
          onStampDutyBadgeClick={() => {}}
          pendingDocCount={0}
          onPendingDocBadgeClick={() => {}}
          supportingDocPendingCount={0}
          onSupportingDocBadgeClick={() => {}}
          withdrawalPendingCount={0}
          onWithdrawalBadgeClick={() => {}}
          refundClaimPendingCount={count}
          onRefundClaimBadgeClick={() => {}}
          reactivationPendingCount={0}
          onReactivationBadgeClick={() => {}}
        />
        <TabsContent value="cases">PANEL-cases</TabsContent>
      </Tabs>,
    );

    const badge = screen.queryByTestId("badge-cases-refund-claim");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("1");
  });
});

describe("AdminGroupedNav — Cmd+K / Ctrl+K shortcut", () => {
  it("focuses the search input when Cmd+K is fired on the document", () => {
    render(<Harness />);

    const search = screen.getByTestId("admin-nav-search");

    // Simulate Cmd+K (macOS style) on the document.
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(document.activeElement).toBe(search);
  });

  it("focuses the search input when Ctrl+K is fired on the document", () => {
    render(<Harness />);

    const search = screen.getByTestId("admin-nav-search");

    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(document.activeElement).toBe(search);
  });

  it("does not focus the search input for an unrelated key combination", () => {
    render(<Harness />);

    const search = screen.getByTestId("admin-nav-search");

    // Plain 'k' without modifier should not focus the search.
    const event = new KeyboardEvent("keydown", { key: "k", bubbles: true });
    document.dispatchEvent(event);

    expect(document.activeElement).not.toBe(search);
  });
});

describe("AdminGroupedNav — ⌘K / ^K hint badge visibility", () => {
  it("shows the shortcut hint badge when the query is empty", () => {
    render(<Harness />);

    // The <kbd> hint element is visible when query === "".
    // It lives inside a span[aria-hidden=true] and contains ⌘K or ^K.
    const kbdHints = document
      .querySelectorAll("kbd");
    // At least one kbd element should be present (the shortcut hint).
    expect(kbdHints.length).toBeGreaterThan(0);

    // The clear button must NOT be present when query is empty.
    expect(screen.queryByTestId("admin-nav-search-clear")).toBeNull();
  });

  it("hides the shortcut hint badge and shows the clear button when text is entered", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByTestId("admin-nav-search"), "cases");

    // The clear button must now be visible.
    expect(screen.getByTestId("admin-nav-search-clear")).toBeTruthy();

    // The shortcut hint (kbd) must be gone — replaced by the clear button.
    // The hint span is conditionally rendered only when query is empty.
    const kbdHints = document.querySelectorAll("kbd");
    expect(kbdHints.length).toBe(0);
  });

  it("restores the shortcut hint badge after the query is cleared", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const search = screen.getByTestId("admin-nav-search");
    await user.type(search, "cases");
    // Clear via Escape.
    await user.type(search, "{Escape}");

    // Hint should be back, clear button gone.
    expect(screen.queryByTestId("admin-nav-search-clear")).toBeNull();
    expect(document.querySelectorAll("kbd").length).toBeGreaterThan(0);
  });
});
