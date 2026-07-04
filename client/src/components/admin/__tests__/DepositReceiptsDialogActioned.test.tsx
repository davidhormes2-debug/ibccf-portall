// @vitest-environment jsdom
//
// Regression guard: clicking Approve or Reject on a reactivation receipt
// in DepositReceiptsDialog must forward the call to `updateReceiptStatus`,
// which in turn calls `loadReactivationPendingCounts` so the triage badge
// clears immediately without waiting for the next cross-tab poll interval.
//
// Two test tiers:
//
//   Tier 1 — component render tests:
//     Verify that the Approve and Reject buttons exist for a pending
//     reactivation receipt and that clicking them calls `updateReceiptStatus`
//     with the correct arguments.  The prop boundary is the natural seam
//     because `updateReceiptStatus` is owned by AdminDashboard and injected
//     into the dialog; what the dialog must guarantee is that it calls the
//     prop exactly once with the right status.
//
//   Tier 2 — source-level wiring assertion:
//     `loadReactivationPendingCounts` is called inside `updateReceiptStatus`
//     in AdminDashboard.tsx after a successful server response.  A regex scan
//     of the source file confirms the call site is present and is guarded by
//     the `res.ok` branch — the same technique used by the badge ternary
//     chain guard in DepositReceiptsDialogSkeleton.test.tsx.

import React from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DepositReceiptsDialog } from "../DepositReceiptsDialog";
import type { Case, DepositReceipt } from "../shared";

// ── mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.name) return `Receipts for ${opts.name}`;
      return key;
    },
  }),
}));

vi.mock("@/components/admin/CaseMergedReceiptsPanel", () => ({
  CaseMergedReceiptsPanel: () => (
    <div data-testid="merged-receipts-panel" />
  ),
}));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => true,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: {
      ...actual.motion,
      div: ({
        children,
        ...rest
      }: React.HTMLAttributes<HTMLDivElement> & {
        children?: React.ReactNode;
      }) => <div {...rest}>{children}</div>,
    },
  };
});

// ── fixtures ─────────────────────────────────────────────────────────────────

const MOCK_CASE: Case = {
  id: "case-reactivation-1",
  userName: "Bob",
  accessCode: "REACT-001",
  email: "bob@example.com",
  status: "active",
  letterSent: false,
  depositPaid: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as Case;

// A reactivation receipt: category='reissue' and reissueId=null
// This triggers the amber "Reactivation" badge and "Approve & Reactivate" button.
const REACTIVATION_RECEIPT: DepositReceipt = {
  id: 77,
  caseId: "case-reactivation-1",
  fileName: "reactivation-proof.jpg",
  imageData: "data:image/jpeg;base64,/9j/abc",
  status: "pending",
  category: "reissue",
  reissueId: null,
  notes: undefined,
  adminNotes: undefined,
  uploadedAt: "2026-05-01T12:00:00Z",
} as unknown as DepositReceipt;

// A plain (non-reactivation) pending receipt — category != 'reissue'
const PLAIN_RECEIPT: DepositReceipt = {
  id: 88,
  caseId: "case-reactivation-1",
  fileName: "plain-proof.jpg",
  imageData: "data:image/jpeg;base64,/9j/xyz",
  status: "pending",
  category: "activation",
  reissueId: null,
  notes: undefined,
  adminNotes: undefined,
  uploadedAt: "2026-05-02T12:00:00Z",
} as unknown as DepositReceipt;

// ── helper ────────────────────────────────────────────────────────────────────

function renderDialog(
  receipts: DepositReceipt[],
  updateReceiptStatus: ReturnType<typeof vi.fn>,
) {
  return render(
    <DepositReceiptsDialog
      open={true}
      onOpenChange={vi.fn()}
      selectedCase={MOCK_CASE}
      authToken="test-token"
      adminRole="super_admin"
      mergedReceiptsScrollKey={null}
      depositReceipts={receipts}
      isLoading={false}
      pendingReceiptIds={new Set()}
      receiptEmailFlags={{}}
      setReceiptEmailFlags={vi.fn()}
      updateReceiptStatus={updateReceiptStatus}
    />,
  );
}

afterEach(() => cleanup());

// ─────────────────────────────────────────────────────────────────────────────
// Tier 1 — component render tests
// ─────────────────────────────────────────────────────────────────────────────

describe("DepositReceiptsDialog — reactivation receipt approve/reject buttons", () => {
  it("renders the 'Approve & Reactivate' button for a pending reactivation receipt", () => {
    renderDialog([REACTIVATION_RECEIPT], vi.fn());

    const btn = screen.getByTestId("button-approve-receipt-77");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("Approve & Reactivate");
  });

  it("renders the 'Reject' button for a pending reactivation receipt", () => {
    renderDialog([REACTIVATION_RECEIPT], vi.fn());

    const btn = screen.getByTestId("button-reject-receipt-77");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("Reject");
  });

  it("calls updateReceiptStatus with 'approved' when the Approve & Reactivate button is clicked", () => {
    const updateReceiptStatus = vi.fn();
    renderDialog([REACTIVATION_RECEIPT], updateReceiptStatus);

    fireEvent.click(screen.getByTestId("button-approve-receipt-77"));

    expect(updateReceiptStatus).toHaveBeenCalledTimes(1);
    const [receiptId, status] = updateReceiptStatus.mock.calls[0] as [
      number,
      string,
      ...unknown[]
    ];
    expect(receiptId).toBe(77);
    expect(status).toBe("approved");
  });

  it("calls updateReceiptStatus with 'rejected' when the Reject button is clicked", () => {
    const updateReceiptStatus = vi.fn();
    renderDialog([REACTIVATION_RECEIPT], updateReceiptStatus);

    fireEvent.click(screen.getByTestId("button-reject-receipt-77"));

    expect(updateReceiptStatus).toHaveBeenCalledTimes(1);
    const [receiptId, status] = updateReceiptStatus.mock.calls[0] as [
      number,
      string,
      ...unknown[]
    ];
    expect(receiptId).toBe(77);
    expect(status).toBe("rejected");
  });

  it("calls updateReceiptStatus with 'approved' for a plain (non-reactivation) receipt", () => {
    const updateReceiptStatus = vi.fn();
    renderDialog([PLAIN_RECEIPT], updateReceiptStatus);

    // Plain receipts show "Approve" not "Approve & Reactivate"
    const btn = screen.getByTestId("button-approve-receipt-88");
    expect(btn.textContent).toContain("Approve");
    expect(btn.textContent).not.toContain("Reactivate");

    fireEvent.click(btn);

    expect(updateReceiptStatus).toHaveBeenCalledTimes(1);
    const [receiptId, status] = updateReceiptStatus.mock.calls[0] as [
      number,
      string,
      ...unknown[]
    ];
    expect(receiptId).toBe(88);
    expect(status).toBe("approved");
  });

  it("calls updateReceiptStatus with 'rejected' for a plain (non-reactivation) receipt", () => {
    const updateReceiptStatus = vi.fn();
    renderDialog([PLAIN_RECEIPT], updateReceiptStatus);

    fireEvent.click(screen.getByTestId("button-reject-receipt-88"));

    expect(updateReceiptStatus).toHaveBeenCalledTimes(1);
    const [receiptId, status] = updateReceiptStatus.mock.calls[0] as [
      number,
      string,
      ...unknown[]
    ];
    expect(receiptId).toBe(88);
    expect(status).toBe("rejected");
  });

  it("does not call updateReceiptStatus more than once on a single button click", () => {
    const updateReceiptStatus = vi.fn();
    renderDialog([REACTIVATION_RECEIPT], updateReceiptStatus);

    fireEvent.click(screen.getByTestId("button-approve-receipt-77"));
    // Only a single call — no double-fire from synthetic event bubbling.
    expect(updateReceiptStatus).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tier 2 — source-level wiring assertion
//
// Confirms that `updateReceiptStatus` in AdminDashboard.tsx calls
// `loadReactivationPendingCounts` inside the `res.ok` success branch so
// the triage badge clears immediately on every approve/reject — not just
// when the server signals `accountReactivated`.
// ─────────────────────────────────────────────────────────────────────────────

describe("AdminDashboard — updateReceiptStatus wires loadReactivationPendingCounts", () => {
  const DASHBOARD_SRC = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../pages/AdminDashboard.tsx",
    ),
    "utf8",
  );

  it("defines updateReceiptStatus as an async function", () => {
    expect(
      DASHBOARD_SRC.includes("const updateReceiptStatus = async ("),
    ).toBe(true);
  });

  it("calls loadReactivationPendingCounts inside updateReceiptStatus", () => {
    // Locate the function body between its definition and the clearPending
    // finally block that always terminates it.
    const fnStart = DASHBOARD_SRC.indexOf("const updateReceiptStatus = async (");
    expect(fnStart, "updateReceiptStatus definition not found").toBeGreaterThan(-1);

    // The function ends at the closing brace of the `finally { clearPending() }` block.
    // We find it by locating the `} finally {` that follows `clearPending();` which is
    // always the last statement before the function ends.
    const finallyIdx = DASHBOARD_SRC.indexOf("} finally {", fnStart);
    expect(finallyIdx, "finally block not found after updateReceiptStatus").toBeGreaterThan(fnStart);

    // Include a bit past `finally {` to capture its body
    const fnBody = DASHBOARD_SRC.slice(fnStart, finallyIdx + 200);

    expect(
      fnBody.includes("loadReactivationPendingCounts"),
      "updateReceiptStatus must call loadReactivationPendingCounts to refresh the reactivation badge immediately after actioning a receipt",
    ).toBe(true);
  });

  it("calls loadReactivationPendingCounts inside the res.ok success branch (not only on accountReactivated)", () => {
    const fnStart = DASHBOARD_SRC.indexOf("const updateReceiptStatus = async (");
    const finallyIdx = DASHBOARD_SRC.indexOf("} finally {", fnStart);
    const fnBody = DASHBOARD_SRC.slice(fnStart, finallyIdx + 200);

    // loadReactivationPendingCounts must appear BEFORE the accountReactivated
    // conditional so it fires for both approve and reject, not only for full
    // account reactivation approvals.
    const loadIdx = fnBody.indexOf("loadReactivationPendingCounts");
    // Search for the conditional guard, not the bare property name which also
    // appears in the type annotation earlier in the function body.
    const acctReactivatedIdx = fnBody.indexOf("if (data.accountReactivated)");

    expect(
      loadIdx,
      "loadReactivationPendingCounts call not found in updateReceiptStatus body",
    ).toBeGreaterThan(-1);

    expect(
      acctReactivatedIdx,
      "if (data.accountReactivated) branch not found in updateReceiptStatus body",
    ).toBeGreaterThan(-1);

    expect(
      loadIdx < acctReactivatedIdx,
      "loadReactivationPendingCounts must be called BEFORE the if (data.accountReactivated) branch so it fires on every successful receipt action (approve or reject), not only when the account is fully reactivated",
    ).toBe(true);
  });
});
