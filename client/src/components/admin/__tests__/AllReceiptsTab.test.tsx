// @vitest-environment jsdom
//
// Task #182 — Cover the optimistic-update + rollback + refresh behavior
// of the All Receipts cross-case admin inbox when an approve/reject
// request comes back with HTTP 409 ("already reviewed" — Task #180).
// The contract we verify: on 409 the row's optimistic flip is rolled
// back AND the panel re-fetches `/api/deposits/all-receipts` so a
// stale Approve button isn't left visible.
//
// Also covers: regression guard ensuring the category filter dropdown
// has a SelectItem for every key in CATEGORY_LABEL (which is typed as
// Record<MergedReceipt["category"], string> — TypeScript enforces it
// covers every union member, and this test enforces the dropdown does too).

import React from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const mockLoadReactivationPendingCounts = vi.fn();

vi.mock("../AdminDashboardContext", () => ({
  useAdminDashboard: () => ({
    adminRole: "super_admin",
    loadReactivationPendingCounts: mockLoadReactivationPendingCounts,
  }),
}));

import { AllReceiptsTab, CATEGORY_LABEL } from "../AllReceiptsTab";

const PENDING_STAMP_DUTY_ROW = {
  source: "stamp_duty" as const,
  id: 42,
  caseId: "case-xyz",
  category: "stamp_duty" as const,
  status: "awaiting_admin_approval",
  fileName: "receipt.pdf",
  notes: null,
  adminNotes: null,
  amountUsdt: "250",
  reissueId: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: "2026-05-22T12:00:00.000Z",
};

function jsonOk(body: any): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

function jsonStatus(status: number, body: any): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  (globalThis as any).sessionStorage = {
    _: new Map<string, string>(),
    getItem(k: string) {
      return (this._ as Map<string, string>).get(k) ?? null;
    },
    setItem(k: string, v: string) {
      (this._ as Map<string, string>).set(k, String(v));
    },
    removeItem(k: string) {
      (this._ as Map<string, string>).delete(k);
    },
    clear() {
      (this._ as Map<string, string>).clear();
    },
  };
  sessionStorage.setItem("adminToken", "test-token");
  mockLoadReactivationPendingCounts.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AllReceiptsTab — 409 already-reviewed refresh", () => {
  it("rolls back the optimistic flip and re-fetches /api/deposits/all-receipts after a 409 from the stamp-duty approve endpoint", async () => {
    // Sequence of fetch responses:
    //   1) initial mount load — returns the pending stamp-duty row
    //   2) POST .../stamp-duty/receipts/42/approve — 409 already_reviewed
    //   3) re-load triggered by the 409 branch — returns the row as approved
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([PENDING_STAMP_DUTY_ROW]))
      .mockResolvedValueOnce(
        jsonStatus(409, {
          error: "Receipt already reviewed",
          code: "stamp_duty_already_reviewed",
          status: "approved",
        }),
      )
      .mockResolvedValueOnce(
        jsonOk([{ ...PENDING_STAMP_DUTY_ROW, status: "approved" }]),
      );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    // Wait for the initial load + render of the row.
    const approveBtn = await screen.findByTestId("btn-all-receipts-approve-stamp_duty-42");
    expect(approveBtn).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/deposits\/all-receipts/);

    // Click Approve — fires POST then the 409 branch should fire a 3rd
    // fetch back to /api/deposits/all-receipts to refresh.
    fireEvent.click(approveBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // Call #2 was the POST to the stamp-duty approve endpoint.
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/cases/case-xyz/stamp-duty/receipts/42/approve",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });

    // Call #3 is the refresh (load()) — same URL family as the first call.
    expect(fetchMock.mock.calls[2][0]).toMatch(/\/api\/deposits\/all-receipts/);

    // After the refresh resolves the row should render as `approved`
    // (no longer actionable — Approve/Reject buttons should be gone).
    await waitFor(() =>
      expect(screen.queryByTestId("btn-all-receipts-approve-stamp_duty-42")).toBeNull(),
    );
  });
});

describe("AllReceiptsTab — non-OK reload guard clears stale rows", () => {
  it("clears stale rows when a reload returns a non-2xx response", async () => {
    // First load succeeds, then a manual refresh returns 500.
    // The stale row must be cleared so the admin sees an empty list,
    // not data from the previous successful fetch.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([PENDING_STAMP_DUTY_ROW]))
      .mockResolvedValueOnce(jsonStatus(500, { error: "Internal Server Error" }));
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    // Wait for the first load — row must be visible.
    await screen.findByTestId("btn-all-receipts-approve-stamp_duty-42");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Trigger a manual reload via the refresh button.
    fireEvent.click(screen.getByTestId("btn-all-receipts-refresh"));

    // After the 500, the row must be gone.
    await waitFor(() =>
      expect(screen.queryByTestId("btn-all-receipts-approve-stamp_duty-42")).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears stale rows when a reload throws a network error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([PENDING_STAMP_DUTY_ROW]))
      .mockRejectedValueOnce(new Error("Network failure"));
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    await screen.findByTestId("btn-all-receipts-approve-stamp_duty-42");

    fireEvent.click(screen.getByTestId("btn-all-receipts-refresh"));

    await waitFor(() =>
      expect(screen.queryByTestId("btn-all-receipts-approve-stamp_duty-42")).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("AllReceiptsTab — reactivation receipt rendering", () => {
  const REACTIVATION_RECEIPT = {
    source: "deposit" as const,
    id: 99,
    caseId: "case-reactivation",
    accessCode: "ABC123",
    category: "reissue" as const,
    status: "pending" as const,
    fileName: "reactivation.pdf",
    notes: null,
    adminNotes: null,
    amountUsdt: "500",
    reissueId: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: "2026-06-01T09:00:00.000Z",
  };

  it("renders the amber row background when category=reissue and reissueId=null with pending status", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([REACTIVATION_RECEIPT]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const row = await screen.findByTestId("all-receipt-row-deposit-99");
    expect(row.className).toContain("bg-amber-950/20");
  });

  it("renders the Reactivation badge with the expected data-testid", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([REACTIVATION_RECEIPT]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const badge = await screen.findByTestId("badge-all-receipts-reactivation-deposit-99");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("Reactivation");
  });

  it("labels the approve button 'Approve & Reactivate' for a reactivation receipt", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([REACTIVATION_RECEIPT]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const approveBtn = await screen.findByTestId("btn-all-receipts-approve-deposit-99");
    expect(approveBtn.textContent).toContain("Approve & Reactivate");
  });

  it("shows the portal re-enablement helper text for a reactivation receipt", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([REACTIVATION_RECEIPT]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    await screen.findByTestId("btn-all-receipts-approve-deposit-99");
    const helperText = screen.getByText(/Approving re-enables portal access/i);
    expect(helperText).toBeTruthy();
  });
});

describe("AllReceiptsTab — reactivation receipt reject path", () => {
  const REACTIVATION_RECEIPT_REJECT = {
    source: "deposit" as const,
    id: 99,
    caseId: "case-reactivation",
    accessCode: "ABC123",
    category: "reissue" as const,
    status: "pending" as const,
    fileName: "reactivation.pdf",
    notes: null,
    adminNotes: null,
    amountUsdt: "500",
    reissueId: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: "2026-06-01T09:00:00.000Z",
  };

  it("renders the Reject button with the correct testid for a reactivation receipt", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([REACTIVATION_RECEIPT_REJECT]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const rejectBtn = await screen.findByTestId("btn-all-receipts-reject-deposit-99");
    expect(rejectBtn).toBeTruthy();
  });

  it("fires PATCH /api/deposit-receipts/<id> with status=rejected when Reject is clicked", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([REACTIVATION_RECEIPT_REJECT]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const rejectBtn = await screen.findByTestId("btn-all-receipts-reject-deposit-99");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(rejectBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls[1][0]).toBe("/api/deposit-receipts/99");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ status: "rejected" }),
    });
  });

  it("removes Approve and Reject buttons after optimistic flip to rejected status", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([REACTIVATION_RECEIPT_REJECT]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const rejectBtn = await screen.findByTestId("btn-all-receipts-reject-deposit-99");
    fireEvent.click(rejectBtn);

    await waitFor(() =>
      expect(screen.queryByTestId("btn-all-receipts-reject-deposit-99")).toBeNull(),
    );
    expect(screen.queryByTestId("btn-all-receipts-approve-deposit-99")).toBeNull();
  });
});

describe("AllReceiptsTab — loadReactivationPendingCounts wiring in reviewReceipt", () => {
  it("calls loadReactivationPendingCounts inside the res.ok success branch of reviewReceipt", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../AllReceiptsTab.tsx"),
      "utf8",
    );

    // Locate the reviewReceipt function declaration.
    const fnStart = src.indexOf("const reviewReceipt = async");
    expect(fnStart, "reviewReceipt function not found in AllReceiptsTab.tsx").toBeGreaterThan(-1);

    // Bound the slice to the closing brace of reviewReceipt (the first `};`
    // that follows the function start).
    const fnEnd = src.indexOf("\n  };\n", fnStart);
    expect(fnEnd, "reviewReceipt closing brace not found").toBeGreaterThan(-1);

    const fnBody = src.slice(fnStart, fnEnd);

    // 1. The call must exist somewhere in the function body.
    expect(
      fnBody.includes("loadReactivationPendingCounts"),
      "reviewReceipt must call loadReactivationPendingCounts to keep the Cases nav badge in sync",
    ).toBe(true);

    // 2. The call must appear BEFORE the `if (data.accountReactivated)` branch
    //    so it fires on every successful action (approve or reject), not only
    //    when the account is fully reactivated.
    const loadIdx = fnBody.indexOf("loadReactivationPendingCounts");
    const reactivatedIdx = fnBody.indexOf("data.accountReactivated");
    expect(reactivatedIdx, "data.accountReactivated branch not found in reviewReceipt").toBeGreaterThan(-1);
    expect(
      loadIdx < reactivatedIdx,
      "loadReactivationPendingCounts must be called BEFORE the if (data.accountReactivated) branch so it fires on every successful receipt action",
    ).toBe(true);

    // 3. The call must appear inside the `if (res.ok)` block, not outside it.
    const resOkIdx = fnBody.indexOf("if (res.ok)");
    expect(resOkIdx, "if (res.ok) block not found in reviewReceipt").toBeGreaterThan(-1);
    expect(
      loadIdx > resOkIdx,
      "loadReactivationPendingCounts must be inside the res.ok success branch",
    ).toBe(true);
  });

  it("calls loadReactivationPendingCounts on a successful approve via the context mock", async () => {
    // mockLoadReactivationPendingCounts is captured by the module-level
    // vi.mock factory and reset in beforeEach so this test starts clean.
    const REACTIVATION_ROW = {
      source: "deposit" as const,
      id: 55,
      caseId: "case-react-test",
      accessCode: "XYZ",
      category: "reissue" as const,
      status: "pending" as const,
      fileName: "r.pdf",
      notes: null,
      adminNotes: null,
      amountUsdt: "100",
      reissueId: null,
      reviewedAt: null,
      reviewedBy: null,
      uploadedAt: "2026-06-01T09:00:00.000Z",
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([REACTIVATION_ROW]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accountReactivated: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const approveBtn = await screen.findByTestId("btn-all-receipts-approve-deposit-55");
    fireEvent.click(approveBtn);

    await waitFor(() =>
      expect(mockLoadReactivationPendingCounts).toHaveBeenCalledTimes(1),
    );
  });
});

describe("AllReceiptsTab — category filter dropdown completeness", () => {
  it("has a SelectItem for every key in CATEGORY_LABEL plus any virtual categories", () => {
    // CATEGORY_LABEL is typed Record<MergedReceipt["category"], string>, so
    // TypeScript already enforces it covers every union member. This test
    // then enforces the filter dropdown covers every key of CATEGORY_LABEL,
    // catching the regression where merge_fee / token_deposit were in the
    // type but missing from the <SelectContent> block.
    //
    // Virtual categories (e.g. 'reactivation') are derived server-side from
    // a combination of DB fields — they have no CATEGORY_LABEL entry because
    // they are not stored as a distinct DB category, but they ARE valid filter
    // values and MUST appear in the dropdown.
    const VIRTUAL_FILTER_CATEGORIES = ["reactivation"];

    const src = fs.readFileSync(
      path.resolve(__dirname, "../AllReceiptsTab.tsx"),
      "utf8",
    );

    // Anchor on the category filter trigger's data-testid, then find the
    // <SelectContent> that follows. Bound the slice to </SelectContent>
    // to avoid false-positives from the status-filter's identical tags.
    const anchorIdx = src.indexOf('data-testid="filter-all-receipts-category"');
    expect(anchorIdx, 'data-testid="filter-all-receipts-category" not found in AllReceiptsTab.tsx').toBeGreaterThan(-1);

    const contentStart = src.indexOf("<SelectContent>", anchorIdx);
    expect(contentStart, "<SelectContent> not found after category filter anchor").toBeGreaterThan(-1);

    const contentEnd = src.indexOf("</SelectContent>", contentStart);
    expect(contentEnd, "</SelectContent> not found after category SelectContent").toBeGreaterThan(-1);

    const block = src.slice(contentStart, contentEnd);

    // Collect every value="..." from <SelectItem> tags inside the block,
    // skipping the "all" sentinel which has no matching category key.
    const itemRe = /<SelectItem\s+value="([^"]+)"/g;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(block)) !== null) {
      if (m[1] !== "all") found.push(m[1]);
    }

    // Expected = every key in CATEGORY_LABEL (real DB categories) PLUS every
    // virtual category that's accepted by the server but has no label entry.
    const expectedCategories = [
      ...Object.keys(CATEGORY_LABEL),
      ...VIRTUAL_FILTER_CATEGORIES,
    ].sort();
    expect(found.sort()).toEqual(expectedCategories);
  });
});
