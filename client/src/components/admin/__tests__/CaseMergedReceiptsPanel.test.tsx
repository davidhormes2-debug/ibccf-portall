// @vitest-environment jsdom
//
// Task #182 — Cover CaseMergedReceiptsPanel's 409 handling (Task #180).
// When the per-case merged uploads panel fires an approve/reject and
// gets HTTP 409 back, the panel must:
//   1) toast the "Already reviewed" message
//   2) re-fetch `/api/cases/:id/all-receipts` so the row reflects
//      whatever decision the other admin already made
//   3) return early (no further error toast)
//
// Also covers: regression guard ensuring the category filter dropdown
// has a SelectItem for every key in CATEGORY_LABEL (typed as
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

// Radix Select doesn't play well with jsdom (no real pointer events /
// portal rendering). Replace with a context-based stub so SelectItem
// clicks directly invoke the parent's onValueChange handler — no native
// <select> tricks needed, no HTML nesting warnings.
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

import { CaseMergedReceiptsPanel, CATEGORY_LABEL } from "../CaseMergedReceiptsPanel";

const PENDING_STAMP_DUTY_ROW = {
  source: "stamp_duty" as const,
  id: 77,
  caseId: "case-abc",
  category: "stamp_duty" as const,
  status: "awaiting_admin_approval",
  fileName: "stamp.pdf",
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
  // Element.scrollIntoView is not implemented in jsdom — the panel
  // calls it inside the scrollToKey effect.
  (Element.prototype as any).scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CaseMergedReceiptsPanel — 409 already-reviewed refresh", () => {
  it("re-fetches /api/cases/:id/all-receipts after a 409 from stamp-duty approve", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([PENDING_STAMP_DUTY_ROW]))
      .mockResolvedValueOnce(
        jsonStatus(409, {
          error: "Receipt already reviewed",
          code: "stamp_duty_already_reviewed",
          status: "rejected",
        }),
      )
      .mockResolvedValueOnce(
        jsonOk([{ ...PENDING_STAMP_DUTY_ROW, status: "rejected" }]),
      );
    (globalThis as any).fetch = fetchMock;

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    const approveBtn = await screen.findByTestId(
      "btn-merged-approve-stamp_duty-77",
    );
    expect(approveBtn).toBeTruthy();

    // Initial load = 1 call to /api/cases/case-abc/all-receipts.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/cases/case-abc/all-receipts");

    fireEvent.click(approveBtn);

    // After 409 the panel calls load() again → 3 total fetches.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // Call #2: the POST to the stamp-duty approve endpoint.
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/cases/case-abc/stamp-duty/receipts/77/approve",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });

    // Call #3: refresh of the merged-uploads list.
    expect(fetchMock.mock.calls[2][0]).toBe("/api/cases/case-abc/all-receipts");

    // After refresh the row is `rejected` — Approve button is gone
    // (status is no longer actionable).
    await waitFor(() =>
      expect(screen.queryByTestId("btn-merged-approve-stamp_duty-77")).toBeNull(),
    );
  });

  it("drops a double-clicked Approve so only one POST is fired", async () => {
    // Task #184 — the synchronous pendingKeysRef in the panel must
    // discard a fast second click before it can trigger a duplicate
    // POST to the stamp-duty review endpoint. We hold the approve
    // POST open with a deferred promise so both clicks land while
    // the first request is still in flight.
    let resolveApprove: (value: Response) => void = () => {};
    const approvePromise = new Promise<Response>((resolve) => {
      resolveApprove = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([PENDING_STAMP_DUTY_ROW]))
      .mockImplementationOnce(() => approvePromise)
      .mockResolvedValueOnce(
        jsonOk([{ ...PENDING_STAMP_DUTY_ROW, status: "approved" }]),
      );
    (globalThis as any).fetch = fetchMock;

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    const approveBtn = await screen.findByTestId(
      "btn-merged-approve-stamp_duty-77",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Two rapid clicks before the first POST resolves — the second
    // must be a no-op (no extra fetch).
    fireEvent.click(approveBtn);
    fireEvent.click(approveBtn);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/cases/case-abc/stamp-duty/receipts/77/approve",
    );

    // Let the in-flight approve resolve → the panel reloads.
    resolveApprove(jsonOk({}));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/cases/case-abc/all-receipts");
  });

  it("re-fetches after a 409 from the certificate reject endpoint too", async () => {
    const CERT_ROW = {
      ...PENDING_STAMP_DUTY_ROW,
      source: "certificate" as const,
      id: 88,
      category: "certificate" as const,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([CERT_ROW]))
      .mockResolvedValueOnce(
        jsonStatus(409, {
          error: "Receipt already reviewed",
          status: "approved",
        }),
      )
      .mockResolvedValueOnce(
        jsonOk([{ ...CERT_ROW, status: "approved" }]),
      );
    (globalThis as any).fetch = fetchMock;

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    const rejectBtn = await screen.findByTestId(
      "btn-merged-reject-certificate-88",
    );
    fireEvent.click(rejectBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/cases/case-abc/certificate/fee-payments/88/reject",
    );
    expect(fetchMock.mock.calls[2][0]).toBe("/api/cases/case-abc/all-receipts");
  });
});

describe("CaseMergedReceiptsPanel — non-OK reload guard clears stale rows", () => {
  it("clears stale rows when a reload returns a non-2xx response", async () => {
    // First load succeeds; then a manual refresh returns 500.
    // The stale row must be cleared so the admin sees the empty-state,
    // not data from the previous successful fetch.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([PENDING_STAMP_DUTY_ROW]))
      .mockResolvedValueOnce(jsonStatus(500, { error: "Internal Server Error" }));
    (globalThis as any).fetch = fetchMock;

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    // Wait for the first load — row must be visible.
    await screen.findByTestId("merged-upload-stamp_duty-77");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Trigger a manual reload via the refresh button.
    fireEvent.click(screen.getByTestId("btn-merged-uploads-refresh"));

    // After the failed reload, the stale row must be gone.
    await waitFor(() =>
      expect(screen.queryByTestId("merged-upload-stamp_duty-77")).toBeNull(),
    );
    // The empty-state placeholder must appear instead.
    expect(screen.getByTestId("merged-uploads-empty")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears stale rows when a reload throws a network error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([PENDING_STAMP_DUTY_ROW]))
      .mockRejectedValueOnce(new Error("Network failure"));
    (globalThis as any).fetch = fetchMock;

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    await screen.findByTestId("merged-upload-stamp_duty-77");

    fireEvent.click(screen.getByTestId("btn-merged-uploads-refresh"));

    await waitFor(() =>
      expect(screen.queryByTestId("merged-upload-stamp_duty-77")).toBeNull(),
    );
    expect(screen.getByTestId("merged-uploads-empty")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("CaseMergedReceiptsPanel — category filter behavior", () => {
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

  const STAMP_DUTY_ROW = {
    source: "stamp_duty" as const,
    id: 2,
    caseId: "case-abc",
    category: "stamp_duty" as const,
    status: "approved",
    fileName: "stamp.pdf",
    notes: null,
    adminNotes: null,
    amountUsdt: "250",
    reissueId: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: "2026-05-22T11:00:00.000Z",
  };

  // ---------------------------------------------------------------------------
  // Derive the `source` field from a category name.
  // `certificate` and `stamp_duty` have dedicated source tables; everything
  // else originates from deposit_receipts.  This function deliberately mirrors
  // the server's fan-out logic so no manual update is needed when a new
  // deposit-style category is added to CATEGORY_LABEL.
  // ---------------------------------------------------------------------------
  function sourceForCategory(cat: string): "deposit" | "certificate" | "stamp_duty" {
    if (cat === "certificate") return "certificate";
    if (cat === "stamp_duty") return "stamp_duty";
    return "deposit";
  }

  // One fixture row per known category, built from CATEGORY_LABEL so the list
  // stays in sync automatically when new categories are added.
  //
  // Note: the "reissue" row must have a non-null reissueId so the filter
  // treats it as a plain letter-reissue round rather than a reactivation
  // receipt (category='reissue' + reissueId=null → isReactivationReceipt).
  const ALL_CATEGORY_ROWS = Object.keys(CATEGORY_LABEL).map((cat, idx) => ({
    source: sourceForCategory(cat),
    id: 100 + idx,
    caseId: "case-abc",
    category: cat,
    status: "pending",
    fileName: `${cat}.pdf`,
    notes: null,
    adminNotes: null,
    amountUsdt: "100",
    reissueId: cat === "reissue" ? 1 : null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: "2026-05-22T10:00:00.000Z",
  }));

  it("shows all rows when filter is 'all' (default)", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([ACTIVATION_ROW, STAMP_DUTY_ROW]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    await screen.findByTestId("merged-upload-deposit-1");
    expect(screen.getByTestId("merged-upload-stamp_duty-2")).toBeTruthy();
  });

  it("hides non-matching rows when a specific category is selected", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([ACTIVATION_ROW, STAMP_DUTY_ROW]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    // Wait for rows to load.
    await screen.findByTestId("merged-upload-deposit-1");
    expect(screen.getByTestId("merged-upload-stamp_duty-2")).toBeTruthy();

    // Click the mocked SelectItem for "stamp_duty" — the context-based
    // stub calls onValueChange("stamp_duty") directly on click.
    fireEvent.click(screen.getByTestId("select-item-stamp_duty"));

    // Only stamp_duty row should remain visible; activation row filtered out.
    await waitFor(() => {
      expect(screen.queryByTestId("merged-upload-deposit-1")).toBeNull();
      expect(screen.getByTestId("merged-upload-stamp_duty-2")).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Parameterized: one test per category in CATEGORY_LABEL.
  // When a new category key is added to CATEGORY_LABEL the loop automatically
  // generates a test for it — no manual additions required.
  // ---------------------------------------------------------------------------
  for (const category of Object.keys(CATEGORY_LABEL)) {
    it(`selecting "${category}" shows only ${category} rows and hides all others`, async () => {
      (globalThis as any).fetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(ALL_CATEGORY_ROWS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

      // Wait until the row for this category appears before interacting.
      const thisRow = ALL_CATEGORY_ROWS.find((r) => r.category === category)!;
      await screen.findByTestId(
        `merged-upload-${thisRow.source}-${thisRow.id}`,
      );

      // Activate the category filter via the stubbed SelectItem.
      fireEvent.click(screen.getByTestId(`select-item-${category}`));

      // After filtering: only the selected category's row must be visible;
      // every other row must be absent from the DOM.
      await waitFor(() => {
        for (const row of ALL_CATEGORY_ROWS) {
          const testId = `merged-upload-${row.source}-${row.id}`;
          if (row.category === category) {
            expect(screen.getByTestId(testId)).toBeTruthy();
          } else {
            expect(screen.queryByTestId(testId)).toBeNull();
          }
        }
      });
    });
  }

  it("filter dropdown is visible even when there are no rows", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<CaseMergedReceiptsPanel caseId="case-abc" authToken="tok" />);

    // Empty state message should appear.
    await screen.findByTestId("merged-uploads-empty");

    // The category filter must still be mounted in the header.
    expect(screen.getByTestId("filter-merged-panel-category")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Explicit source-routing guard for CATEGORY_LABEL.
//
// `sourceForCategory` (the local helper used to build ALL_CATEGORY_ROWS above)
// falls back to "deposit" for any unrecognised key.  That means if a future
// developer adds a category backed by a NEW dedicated source table and forgets
// to update `sourceForCategory`, the parameterised filter tests still pass —
// they just silently exercise the wrong source.
//
// This describe block uses a fully-enumerated, hardcoded EXPECTED_SOURCE map
// instead.  Adding a key to CATEGORY_LABEL without also updating EXPECTED_SOURCE
// causes this test to fail immediately with a clear message identifying the gap.
// ---------------------------------------------------------------------------
describe("CaseMergedReceiptsPanel — sourceForCategory explicit routing map", () => {
  // -------------------------------------------------------------------------
  // THE MAP TO MAINTAIN.
  // When a new category is added to CATEGORY_LABEL you MUST add its source
  // entry here.  The test below will fail with a descriptive error if the two
  // sets diverge in either direction.
  // -------------------------------------------------------------------------
  const EXPECTED_SOURCE: Record<string, "deposit" | "certificate" | "stamp_duty"> = {
    activation: "deposit",
    reissue: "deposit",
    other: "deposit",
    certificate: "certificate",
    stamp_duty: "stamp_duty",
    merge_fee: "deposit",
    token_deposit: "deposit",
  };

  it("EXPECTED_SOURCE covers every CATEGORY_LABEL key with no extras", () => {
    const labelKeys = Object.keys(CATEGORY_LABEL).sort();
    const mapKeys = Object.keys(EXPECTED_SOURCE).sort();

    const missing = labelKeys.filter((k) => !(k in EXPECTED_SOURCE));
    const extra = mapKeys.filter((k) => !(k in CATEGORY_LABEL));

    expect(
      missing,
      `New categories in CATEGORY_LABEL are not mapped in EXPECTED_SOURCE: [${missing.join(", ")}]. ` +
        "Add each one to EXPECTED_SOURCE above with its correct source table " +
        '("deposit", "certificate", or "stamp_duty") so the routing is explicit.',
    ).toEqual([]);

    expect(
      extra,
      `EXPECTED_SOURCE has keys not present in CATEGORY_LABEL: [${extra.join(", ")}]. ` +
        "Remove the stale entry from EXPECTED_SOURCE.",
    ).toEqual([]);
  });

  it("each CATEGORY_LABEL key maps to the correct source table", () => {
    for (const [category, expectedSource] of Object.entries(EXPECTED_SOURCE)) {
      // Reproduce the same logic as sourceForCategory so this test stays
      // independent of that helper.
      let actualSource: string;
      if (category === "certificate") {
        actualSource = "certificate";
      } else if (category === "stamp_duty") {
        actualSource = "stamp_duty";
      } else {
        actualSource = "deposit";
      }

      expect(
        actualSource,
        `Category "${category}" should route to source "${expectedSource}" ` +
          `but sourceForCategory returns "${actualSource}". ` +
          "Update the routing branches in sourceForCategory (and the server-side " +
          "collectMergedReceipts fan-out) to reflect the new dedicated table.",
      ).toBe(expectedSource);
    }
  });
});

describe("CaseMergedReceiptsPanel — category filter dropdown completeness", () => {
  it("has a SelectItem for every key in CATEGORY_LABEL", () => {
    // CATEGORY_LABEL is typed Record<MergedReceipt["category"], string>, so
    // TypeScript already enforces it covers every union member. This test
    // then enforces the filter dropdown covers every key of CATEGORY_LABEL,
    // catching the regression where a new category is added to the type but
    // not reflected in the <SelectContent> block.
    const src = fs.readFileSync(
      path.resolve(__dirname, "../CaseMergedReceiptsPanel.tsx"),
      "utf8",
    );

    // Anchor on the category filter trigger's data-testid, then find the
    // <SelectContent> that follows. Bound the slice to </SelectContent>
    // to avoid false-positives from any other SelectContent blocks.
    const anchorIdx = src.indexOf('data-testid="filter-merged-panel-category"');
    expect(
      anchorIdx,
      'data-testid="filter-merged-panel-category" not found in CaseMergedReceiptsPanel.tsx',
    ).toBeGreaterThan(-1);

    const contentStart = src.indexOf("<SelectContent>", anchorIdx);
    expect(
      contentStart,
      "<SelectContent> not found after category filter anchor",
    ).toBeGreaterThan(-1);

    const contentEnd = src.indexOf("</SelectContent>", contentStart);
    expect(
      contentEnd,
      "</SelectContent> not found after category SelectContent",
    ).toBeGreaterThan(-1);

    const block = src.slice(contentStart, contentEnd);

    // Collect every value="..." from <SelectItem> tags inside the block,
    // skipping the "all" sentinel which has no matching category key.
    const itemRe = /<SelectItem\s+value="([^"]+)"/g;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(block)) !== null) {
      if (m[1] !== "all") found.push(m[1]);
    }

    // Virtual categories are derived from a combination of DB fields —
    // they are not stored as a distinct DB category so they have no
    // CATEGORY_LABEL entry, but they ARE valid filter values and MUST
    // appear in the dropdown.
    const VIRTUAL_FILTER_CATEGORIES = ["reactivation"];

    const expectedCategories = [
      ...Object.keys(CATEGORY_LABEL),
      ...VIRTUAL_FILTER_CATEGORIES,
    ].sort();
    expect(found.sort()).toEqual(expectedCategories);
  });
});
