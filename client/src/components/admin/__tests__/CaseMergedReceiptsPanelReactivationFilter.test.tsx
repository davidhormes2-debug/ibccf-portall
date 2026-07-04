// @vitest-environment jsdom
//
// CaseMergedReceiptsPanel — Reactivation filter regression guard.
//
// Contracts verified:
//   1. Selecting "Reactivation" from the filter shows only rows where
//      category='reissue' AND reissueId=null (isReactivationReceipt = true).
//   2. Selecting "Reissue" shows only rows where category='reissue' AND
//      reissueId is non-null — it must NOT show the reactivation row.
//   3. The two subtypes are mutually exclusive: neither appears in the
//      other's filtered view.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Radix Select doesn't play well with jsdom — replace with a context-based
// stub so SelectItem clicks directly invoke the parent's onValueChange.
vi.mock("@/components/ui/select", async () => {
  const { createContext, useContext } = await import("react");
  const Ctx = createContext<((v: string) => void) | undefined>(undefined);
  return {
    Select: ({ value: _value, onValueChange, children }: any) => (
      <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>
    ),
    SelectTrigger: ({ children, ...props }: any) => (
      <div {...props}>{children}</div>
    ),
    SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ value, children }: any) => {
      const onValueChange = useContext(Ctx);
      return (
        <div
          role="option"
          data-testid={`select-item-${value}`}
          onClick={() => onValueChange?.(value)}
        >
          {children}
        </div>
      );
    },
  };
});

import { CaseMergedReceiptsPanel } from "../CaseMergedReceiptsPanel";

// ---------------------------------------------------------------------------
// Fixtures
//
// Three rows that exercise all three distinct cases the filter must handle:
//   - ACTIVATION_ROW:    category='activation',  reissueId=null
//                        → plain activation deposit, not reactivation
//   - REACTIVATION_ROW: category='reissue',      reissueId=null
//                        → isReactivationReceipt()=true; should appear only
//                          when "Reactivation" is selected
//   - PLAIN_REISSUE_ROW: category='reissue',      reissueId=9 (non-null)
//                        → isReactivationReceipt()=false; should appear only
//                          when "Reissue" is selected
// ---------------------------------------------------------------------------
const ACTIVATION_ROW = {
  source: "deposit" as const,
  id: 1,
  caseId: "case-abc",
  category: "activation" as const,
  status: "pending",
  fileName: "activation.pdf",
  notes: null,
  adminNotes: null,
  amountUsdt: "1000",
  reissueId: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: "2026-05-22T10:00:00.000Z",
};

const REACTIVATION_ROW = {
  source: "deposit" as const,
  id: 2,
  caseId: "case-abc",
  category: "reissue" as const,
  status: "pending",
  fileName: "reactivation-payment.pdf",
  notes: null,
  adminNotes: null,
  amountUsdt: "500",
  reissueId: null,          // null → this is a reactivation payment
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: "2026-05-22T11:00:00.000Z",
};

const PLAIN_REISSUE_ROW = {
  source: "deposit" as const,
  id: 3,
  caseId: "case-abc",
  category: "reissue" as const,
  status: "approved",
  fileName: "letter-reissue.pdf",
  notes: null,
  adminNotes: null,
  amountUsdt: "200",
  reissueId: 9,             // non-null → ordinary letter-reissue round
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: "2026-05-22T12:00:00.000Z",
};

const ALL_ROWS = [ACTIVATION_ROW, REACTIVATION_ROW, PLAIN_REISSUE_ROW];

function mockFetchOnce(rows: object[]) {
  (globalThis as any).fetch = vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  (Element.prototype as any).scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("CaseMergedReceiptsPanel — Reactivation filter", () => {
  it("shows all three rows when filter is 'all' (baseline)", async () => {
    mockFetchOnce(ALL_ROWS);

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    await screen.findByTestId("merged-upload-deposit-1");
    expect(screen.getByTestId("merged-upload-deposit-2")).toBeTruthy();
    expect(screen.getByTestId("merged-upload-deposit-3")).toBeTruthy();
  });

  it("selecting 'Reactivation' shows only the reactivation row (reissue + reissueId=null)", async () => {
    mockFetchOnce(ALL_ROWS);

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    // Wait for initial load.
    await screen.findByTestId("merged-upload-deposit-1");

    fireEvent.click(screen.getByTestId("select-item-reactivation"));

    await waitFor(() => {
      // Reactivation row (id=2) must be visible.
      expect(screen.getByTestId("merged-upload-deposit-2")).toBeTruthy();

      // Activation row (id=1) must be hidden.
      expect(screen.queryByTestId("merged-upload-deposit-1")).toBeNull();

      // Plain reissue row (id=3, reissueId=9) must also be hidden —
      // the critical regression: a plain reissue must NOT appear under
      // the Reactivation filter just because it shares category='reissue'.
      expect(screen.queryByTestId("merged-upload-deposit-3")).toBeNull();
    });
  });

  it("selecting 'Reissue' shows only the plain reissue row (reissueId non-null)", async () => {
    mockFetchOnce(ALL_ROWS);

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    await screen.findByTestId("merged-upload-deposit-1");

    fireEvent.click(screen.getByTestId("select-item-reissue"));

    await waitFor(() => {
      // Plain reissue row (id=3, reissueId=9) must be visible.
      expect(screen.getByTestId("merged-upload-deposit-3")).toBeTruthy();

      // Activation row (id=1) must be hidden.
      expect(screen.queryByTestId("merged-upload-deposit-1")).toBeNull();

      // Reactivation row (id=2, reissueId=null) must be hidden —
      // the critical regression: a reactivation receipt must NOT appear
      // under the Reissue filter even though both share category='reissue'.
      expect(screen.queryByTestId("merged-upload-deposit-2")).toBeNull();
    });
  });

  it("reactivation row bears the amber 'Reactivation' badge", async () => {
    mockFetchOnce([REACTIVATION_ROW]);

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    const row = await screen.findByTestId("merged-upload-deposit-2");

    // The amber Reactivation badge must be present inside the row element.
    // (scope with `within` to avoid matching the stubbed SelectItem which
    //  also renders the text "Reactivation".)
    expect(within(row).getByText("Reactivation")).toBeTruthy();
  });

  it("plain reissue row does NOT bear the amber 'Reactivation' badge", async () => {
    mockFetchOnce([PLAIN_REISSUE_ROW]);

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    const row = await screen.findByTestId("merged-upload-deposit-3");

    // The reactivation badge must NOT appear inside the plain reissue row.
    // (scope with `within` for the same reason as the test above.)
    expect(within(row).queryByText("Reactivation")).toBeNull();
  });
});
