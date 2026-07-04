// @vitest-environment jsdom
//
// Task #175 — Cover the KPI strip filter wiring added in Task #166:
//   - Each KPI card invokes `onFilter` with the right key.
//   - The failed-emails card flips to a rose tone when count > 0.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CasesKpiStrip, type KpiFilterKey } from "../CasesKpiStrip";

const baseCases = [
  { id: "1", status: "active", stampDutyEnabled: false, stampDutyStatus: null },
  { id: "2", status: "syncing", stampDutyEnabled: false, stampDutyStatus: null },
  { id: "3", status: "completed", stampDutyEnabled: false, stampDutyStatus: null },
];

function mockFetch(failedTotal: number, pendingReceipts = 4, pendingReactivation = 0) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/deposits/all-receipts") && url.includes("category=reactivation")) {
      return {
        ok: true,
        json: async () => Array.from({ length: pendingReactivation }),
      } as Response;
    }
    if (url.includes("/api/deposits/all-receipts")) {
      return {
        ok: true,
        json: async () => ({ items: Array.from({ length: pendingReceipts }) }),
      } as Response;
    }
    if (url.includes("/api/email-delivery-alerts")) {
      return {
        ok: true,
        json: async () => ({ total: failedTotal }),
      } as Response;
    }
    return { ok: false, json: async () => ({}) } as Response;
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe("CasesKpiStrip", () => {
  it("invokes onFilter with the right key for every card", async () => {
    global.fetch = mockFetch(0) as unknown as typeof fetch;
    const onFilter = vi.fn<(k: KpiFilterKey) => void>();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <CasesKpiStrip
        cases={baseCases}
        documentRequestsPending={2}
        userDocPendingTotal={7}
        withdrawalPendingTotal={5}
        refundClaimPendingCount={0}
        authToken="t"
        onFilter={onFilter}
      />,
    );

    const expected: KpiFilterKey[] = [
      "open",
      "awaiting_admin",
      "pending_receipts",
      "pending_documents",
      "pending_uploads",
      "pending_withdrawals",
      "failed_emails",
    ];
    for (const key of expected) {
      await user.click(screen.getByTestId(`kpi-${key}`));
    }

    expect(onFilter).toHaveBeenCalledTimes(expected.length);
    expect(onFilter.mock.calls.map((c) => c[0])).toEqual(expected);
    expect(screen.getByTestId("kpi-pending_uploads").textContent).toContain("7");
    expect(screen.getByTestId("kpi-pending_withdrawals").textContent).toContain("5");
  });

  it("renders the pending-withdrawals card with its total and emerald tone when > 0", async () => {
    global.fetch = mockFetch(0) as unknown as typeof fetch;
    render(
      <CasesKpiStrip
        cases={baseCases}
        documentRequestsPending={0}
        userDocPendingTotal={0}
        withdrawalPendingTotal={3}
        refundClaimPendingCount={0}
        authToken="t"
        onFilter={() => {}}
      />,
    );

    const card = screen.getByTestId("kpi-pending_withdrawals");
    expect(card.textContent).toContain("3");
    expect(card.textContent).toContain("Pending Withdrawals");
  });

  it("keeps the failed-emails card neutral when the count is zero", async () => {
    global.fetch = mockFetch(0) as unknown as typeof fetch;
    render(
      <CasesKpiStrip
        cases={baseCases}
        documentRequestsPending={0}
        userDocPendingTotal={0}
        withdrawalPendingTotal={0}
        refundClaimPendingCount={0}
        authToken="t"
        onFilter={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("kpi-failed_emails").textContent).toContain("0");
    });
    const card = screen.getByTestId("kpi-failed_emails");
    expect(card.className).toContain("border-blue-500/30");
    expect(card.className).not.toContain("rose");
  });

  it("flips the failed-emails card to a rose tone when count > 0", async () => {
    global.fetch = mockFetch(3) as unknown as typeof fetch;
    render(
      <CasesKpiStrip
        cases={baseCases}
        documentRequestsPending={0}
        userDocPendingTotal={0}
        withdrawalPendingTotal={0}
        refundClaimPendingCount={0}
        authToken="t"
        onFilter={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("kpi-failed_emails").textContent).toContain("3");
    });
    const card = screen.getByTestId("kpi-failed_emails");
    expect(card.className).toContain("border-rose-500/30");
  });

  it("shows the pending-refund-claims card and fires onFilter with 'pending_refund_claims' when count > 0", async () => {
    global.fetch = mockFetch(0) as unknown as typeof fetch;
    const onFilter = vi.fn<(k: KpiFilterKey) => void>();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <CasesKpiStrip
        cases={baseCases}
        documentRequestsPending={0}
        userDocPendingTotal={0}
        withdrawalPendingTotal={0}
        refundClaimPendingCount={3}
        authToken="t"
        onFilter={onFilter}
      />,
    );

    const card = screen.getByTestId("kpi-pending_refund_claims");
    expect(card.textContent).toContain("3");
    expect(card.textContent).toContain("Pending Refund Claims");
    await user.click(card);
    expect(onFilter).toHaveBeenCalledWith("pending_refund_claims");
  });

  it("hides the pending-refund-claims card when count is 0", async () => {
    global.fetch = mockFetch(0) as unknown as typeof fetch;

    render(
      <CasesKpiStrip
        cases={baseCases}
        documentRequestsPending={0}
        userDocPendingTotal={0}
        withdrawalPendingTotal={0}
        refundClaimPendingCount={0}
        authToken="t"
        onFilter={() => {}}
      />,
    );

    expect(screen.queryByTestId("kpi-pending_refund_claims")).toBeNull();
  });

  it("shows the pending-reactivation card and fires onFilter with 'pending_reactivation' when count > 0", async () => {
    global.fetch = mockFetch(0, 4, 2) as unknown as typeof fetch;
    const onFilter = vi.fn<(k: KpiFilterKey) => void>();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <CasesKpiStrip
        cases={baseCases}
        documentRequestsPending={0}
        userDocPendingTotal={0}
        withdrawalPendingTotal={0}
        refundClaimPendingCount={0}
        authToken="t"
        onFilter={onFilter}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("kpi-pending_reactivation")).toBeDefined();
    });
    const card = screen.getByTestId("kpi-pending_reactivation");
    expect(card.textContent).toContain("2");
    expect(card.textContent).toContain("Pending Reactivations");
    await user.click(card);
    expect(onFilter).toHaveBeenCalledWith("pending_reactivation");
  });

  it("hides the pending-reactivation card when count is 0", async () => {
    global.fetch = mockFetch(0, 4, 0) as unknown as typeof fetch;

    render(
      <CasesKpiStrip
        cases={baseCases}
        documentRequestsPending={0}
        userDocPendingTotal={0}
        withdrawalPendingTotal={0}
        refundClaimPendingCount={0}
        authToken="t"
        onFilter={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("kpi-pending_receipts")).toBeDefined();
    });
    expect(screen.queryByTestId("kpi-pending_reactivation")).toBeNull();
  });

  it("shows the legacy-access-codes card and fires onFilter with 'legacy_access_codes' when count > 0", async () => {
    global.fetch = mockFetch(0) as unknown as typeof fetch;
    const onFilter = vi.fn<(k: KpiFilterKey) => void>();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <CasesKpiStrip
        cases={baseCases}
        documentRequestsPending={0}
        userDocPendingTotal={0}
        withdrawalPendingTotal={0}
        refundClaimPendingCount={0}
        legacyAccessCodeCount={4}
        authToken="t"
        onFilter={onFilter}
      />,
    );

    const card = screen.getByTestId("kpi-legacy_access_codes");
    expect(card.textContent).toContain("4");
    expect(card.textContent).toContain("Legacy Access Codes");
    await user.click(card);
    expect(onFilter).toHaveBeenCalledWith("legacy_access_codes");
  });

  it("hides the legacy-access-codes card when count is 0", async () => {
    global.fetch = mockFetch(0) as unknown as typeof fetch;

    render(
      <CasesKpiStrip
        cases={baseCases}
        documentRequestsPending={0}
        userDocPendingTotal={0}
        withdrawalPendingTotal={0}
        refundClaimPendingCount={0}
        legacyAccessCodeCount={0}
        authToken="t"
        onFilter={() => {}}
      />,
    );

    expect(screen.queryByTestId("kpi-legacy_access_codes")).toBeNull();
  });
});
