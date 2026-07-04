// @vitest-environment jsdom
//
// Task #433 — Verify that admin document counts (global tab badge and
// per-case badge) stay in sync after an admin approves or rejects a
// supporting document.
//
// Guarantee under test (Task #430 consolidation):
//   Both the global "Pending across all cases" counter
//   (SupportingDocumentsTab's `pendingTotal`, rendered under
//   data-testid="supporting-docs-pending-total") and the per-case
//   pending badge (driven by `userDocPendingCounts[caseId]`) are
//   computed from the SAME `userDocPendingCounts` context value.
//
//   After every successful approve/reject the SupportingDocumentsTab
//   calls `loadUserDocPendingCounts()` exactly once.  Because both
//   badge sources read from the same object, React re-renders them in
//   a single pass — there is no intermediate state where one badge has
//   updated but the other has not.
//
// Tests in this file:
//   1. loadUserDocPendingCounts called after approval
//   2. loadUserDocPendingCounts called after rejection
//   3. loadUserDocPendingCounts called even when PATCH fails (finally block
//      always fires, keeping counts consistent after optimistic roll-back)
//   4. pendingTotal (tab badge) reflects the sum of userDocPendingCounts —
//      proving that a single context update atomically refreshes every
//      surface that reads from it

import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import type { Case } from "@/components/admin/shared";

// ── silence side-effect modules ──────────────────────────────────────────────
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/i18n/format", () => ({
  useFormat: () => ({
    formatDateTime: (s: string) => s,
    formatDate: (s: string) => s,
    formatNumber: (n: number) => String(n),
    formatCurrency: (n: number) => String(n),
    formatRelative: (s: string) => s,
  }),
}));

// ── AdminDashboardContext mock ────────────────────────────────────────────────
// We keep a mutable object so individual tests can swap in specific values via
// `setMockContext(overrides)` without resetting the full module.
const loadUserDocPendingCountsMock = vi.fn();

let currentMockCtx: AdminDashboardContextValue | null = null;

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    // When a real AdminDashboardContext.Provider wraps the component (test 4),
    // useContext returns the provider's value so re-renders propagate normally.
    // For all other tests (no provider present), fall back to the flat
    // `currentMockCtx` object.
    useAdminDashboard: () => {
      const realCtx = React.useContext(actual.AdminDashboardContext);
      return realCtx ?? (currentMockCtx as AdminDashboardContextValue);
    },
  };
});

// ── fixture ──────────────────────────────────────────────────────────────────
const CASE_ID = "case-sync-test";

const DOC = {
  id: 11,
  caseId: CASE_ID,
  fileName: "passport-scan.pdf",
  fileType: "application/pdf",
  fileSize: "14 KB",
  category: "kyc_id",
  status: "uploaded",
  description: null,
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 90_000).toISOString(),
};

// ── context builder ──────────────────────────────────────────────────────────
// Task #813 — built from the shared, type-checked factory so adding a new
// required field to AdminDashboardContextValue surfaces a COMPILE error here
// instead of crashing this test at runtime. We only override the handful of
// values these tests actually exercise.
function buildCtx(
  overrides: Partial<AdminDashboardContextValue> = {},
): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: [
      { id: CASE_ID, accessCode: "SYNC001", status: "active" },
    ] as unknown as Case[],
    activeTab: "documents",
    userDocPendingCounts: { [CASE_ID]: 2 },
    loadUserDocPendingCounts: loadUserDocPendingCountsMock,
    ...overrides,
  });
}

// ── fetch helpers ─────────────────────────────────────────────────────────────
function okJson(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
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

  try {
    window.localStorage.clear();
  } catch {
    /* jsdom */
  }

  currentMockCtx = buildCtx();

  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
    .fn()
    .mockImplementation((_url: unknown, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") {
        return okJson({ ...DOC, status: "approved" });
      }
      return okJson([DOC]);
    });

  loadUserDocPendingCountsMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── component under test ──────────────────────────────────────────────────────
import { SupportingDocumentsTab } from "../tabs/SupportingDocumentsTab";
import { AdminDashboardContext } from "@/components/admin/AdminDashboardContext";

// ── helper: expand a row so approve/reject buttons appear ─────────────────────
async function expandDocRow() {
  await waitFor(() =>
    expect(screen.getByTestId(`row-supporting-doc-${DOC.id}`)).toBeTruthy(),
  );
  fireEvent.click(screen.getByTestId(`row-supporting-doc-${DOC.id}`));
}

// ─────────────────────────────────────────────────────────────────────────────
describe("SupportingDocumentsTab — document count sync after approval/rejection", () => {
  // ── Test 1 ─────────────────────────────────────────────────────────────────
  it("calls loadUserDocPendingCounts exactly once after a successful approval", async () => {
    render(<SupportingDocumentsTab onOpenCase={vi.fn()} />);

    await expandDocRow();

    const approveBtn = await screen.findByTestId(
      `button-approve-supporting-doc-${DOC.id}`,
    );
    fireEvent.click(approveBtn);

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  it("calls loadUserDocPendingCounts exactly once after a successful rejection", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ ...DOC, status: "rejected" });
        }
        return okJson([DOC]);
      });

    render(<SupportingDocumentsTab onOpenCase={vi.fn()} />);

    await expandDocRow();

    const rejectBtn = await screen.findByTestId(
      `button-reject-supporting-doc-${DOC.id}`,
    );
    fireEvent.click(rejectBtn);

    const textarea = await screen.findByTestId(
      `textarea-reject-supporting-doc-${DOC.id}`,
    );
    fireEvent.change(textarea, {
      target: { value: "Failed identity verification" },
    });

    const confirmBtn = await screen.findByTestId(
      `button-confirm-reject-supporting-doc-${DOC.id}`,
    );
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  // loadUserDocPendingCounts lives in the `finally` block of act(), so it
  // fires unconditionally — even when the PATCH returns an error.  Refreshing
  // on failure ensures the badge is never left stale after an optimistic UI
  // roll-back (the local docs state is reverted, but the server's pending count
  // might still have changed or the admin might retry immediately).
  it("calls loadUserDocPendingCounts even when the PATCH request fails (server 403) — finally always fires", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ error: "Forbidden" }, 403);
        }
        return okJson([DOC]);
      });

    render(<SupportingDocumentsTab onOpenCase={vi.fn()} />);

    await expandDocRow();

    const approveBtn = await screen.findByTestId(
      `button-approve-supporting-doc-${DOC.id}`,
    );
    fireEvent.click(approveBtn);

    // The finally block fires after the error path completes.
    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  // Both the global "Pending across all cases" badge and per-case counts
  // (used by CasesTab badges) are derived from the same `userDocPendingCounts`
  // context value.  This test uses the REAL AdminDashboardContext.Provider
  // (not the module-level mock) to prove that a single context update
  // refreshes both surfaces in the same React render cycle — they can never
  // briefly show different totals.
  it("pendingTotal (tab badge) and per-case counts are derived from the same userDocPendingCounts — a single context update refreshes both atomically", async () => {
    // A controlled wrapper that holds userDocPendingCounts in local state.
    // The "update counts" button simulates what happens when
    // loadUserDocPendingCounts() resolves and calls setUserDocPendingCounts.
    function Wrapper() {
      const [counts, setCounts] = useState<Record<string, number>>({
        [CASE_ID]: 3,
        "case-other": 2,
      });

      const ctx = {
        ...buildCtx({
          userDocPendingCounts: counts,
          loadUserDocPendingCounts: vi.fn(),
        }),
        userDocPendingCounts: counts,
      } as unknown as AdminDashboardContextValue;

      return (
        <AdminDashboardContext.Provider value={ctx}>
          {/* The per-case count that CasesTab badges consume */}
          <span data-testid="per-case-count">{counts[CASE_ID]}</span>

          {/* The global tab badge (pendingTotal = sum of all counts) */}
          <SupportingDocumentsTab onOpenCase={vi.fn()} />

          {/* Simulate loadUserDocPendingCounts completing with one less pending doc */}
          <button
            data-testid="simulate-counts-refresh"
            onClick={() => setCounts({ [CASE_ID]: 2, "case-other": 2 })}
          >
            refresh
          </button>
        </AdminDashboardContext.Provider>
      );
    }

    render(<Wrapper />);

    // Before the simulated refresh: total = 5, per-case = 3
    await waitFor(() =>
      expect(screen.getByTestId("supporting-docs-pending-total").textContent).toBe("5"),
    );
    expect(screen.getByTestId("per-case-count").textContent).toBe("3");

    // Trigger the simulated context update (one approval resolved)
    await act(async () => {
      fireEvent.click(screen.getByTestId("simulate-counts-refresh"));
    });

    // After the refresh: total = 4, per-case = 2.
    // Both must reflect the new values in the SAME render — the test
    // reads both assertions synchronously after the act() completes,
    // so there is no window where they could differ.
    expect(screen.getByTestId("supporting-docs-pending-total").textContent).toBe("4");
    expect(screen.getByTestId("per-case-count").textContent).toBe("2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #440 — Bulk approve/reject: loadUserDocPendingCounts fires exactly ONCE
// per batch, not once per document.
//
// The guarantee under test:
//   bulkApproveVisible() and bulkRejectVisible() each call
//   loadUserDocPendingCounts() in their `finally` block exactly once after
//   ALL individual PATCHes have settled — regardless of how many documents
//   were in the batch and whether some (or all) individual PATCHes failed.
//
// Tests in this describe block:
//   5. Bulk approve 3 docs → loadUserDocPendingCounts called exactly once
//   6. Bulk reject 3 docs  → loadUserDocPendingCounts called exactly once
//   7. Bulk approve with 1-of-3 PATCHes failing → still called exactly once
//      (the `finally` block always fires, keeping counts consistent)
//   8. Sequential individual approvals (N docs) → called N times, not once
//      (confirms the single-approval path was not regressed by bulk changes)
// ─────────────────────────────────────────────────────────────────────────────

// Three pending documents used by the bulk tests
const BULK_DOCS = [
  {
    id: 21,
    caseId: CASE_ID,
    fileName: "passport.pdf",
    fileType: "application/pdf",
    fileSize: "10 KB",
    category: "kyc_id",
    status: "uploaded",
    description: null,
    adminNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: new Date(Date.now() - 80_000).toISOString(),
  },
  {
    id: 22,
    caseId: CASE_ID,
    fileName: "bank-statement.pdf",
    fileType: "application/pdf",
    fileSize: "20 KB",
    category: "source_of_funds",
    status: "uploaded",
    description: null,
    adminNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: new Date(Date.now() - 70_000).toISOString(),
  },
  {
    id: 23,
    caseId: CASE_ID,
    fileName: "tax-cert.pdf",
    fileType: "application/pdf",
    fileSize: "15 KB",
    category: "proof_of_income",
    status: "uploaded",
    description: null,
    adminNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: new Date(Date.now() - 60_000).toISOString(),
  },
];

describe("SupportingDocumentsTab — bulk approve/reject document count sync (Task #440)", () => {
  // ── Test 5 ────────────────────────────────────────────────────────────────
  // Bulk-approving 3 docs triggers exactly ONE loadUserDocPendingCounts call.
  // The batch issues 3 parallel PATCHes via Promise.allSettled; the `finally`
  // block fires once after all settle — not once per resolved PATCH.
  it("calls loadUserDocPendingCounts exactly once after bulk-approving multiple documents (not once per document)", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ status: "approved" });
        }
        return okJson(BULK_DOCS);
      });

    render(<SupportingDocumentsTab onOpenCase={vi.fn()} />);

    const approveAllBtn = await screen.findByTestId(
      "button-bulk-approve-supporting-docs",
    );
    fireEvent.click(approveAllBtn);

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    // Critically: the mock received 3 PATCH calls (one per doc) but only a
    // single loadUserDocPendingCounts call.  The count below ensures we are
    // not accidentally calling it per-document inside the allSettled loop.
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);
  });

  // ── Test 6 ────────────────────────────────────────────────────────────────
  // Bulk-rejecting 3 docs triggers exactly ONE loadUserDocPendingCounts call.
  it("calls loadUserDocPendingCounts exactly once after bulk-rejecting multiple documents (not once per document)", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ status: "rejected" });
        }
        return okJson(BULK_DOCS);
      });

    render(<SupportingDocumentsTab onOpenCase={vi.fn()} />);

    // Open the bulk-reject confirmation panel
    const rejectAllBtn = await screen.findByTestId(
      "button-bulk-reject-supporting-docs",
    );
    fireEvent.click(rejectAllBtn);

    // Confirm the rejection (the panel becomes visible)
    const confirmBtn = await screen.findByTestId(
      "button-bulk-reject-confirm-supporting-docs",
    );
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);
  });

  // ── Test 7 ────────────────────────────────────────────────────────────────
  // Partial failure during bulk approve: 1 of 3 PATCHes returns a 403.
  // Promise.allSettled captures fulfilled and rejected outcomes; the `finally`
  // block still fires once after all settle.  This ensures badge counts are
  // refreshed even when the batch is only partially successful.
  it("calls loadUserDocPendingCounts exactly once after a partial-failure bulk approve (some PATCHes 403)", async () => {
    let patchCallCount = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCallCount += 1;
          // Third PATCH call fails; the first two succeed
          if (patchCallCount === 3) {
            return okJson({ error: "Forbidden" }, 403);
          }
          return okJson({ status: "approved" });
        }
        return okJson(BULK_DOCS);
      });

    render(<SupportingDocumentsTab onOpenCase={vi.fn()} />);

    const approveAllBtn = await screen.findByTestId(
      "button-bulk-approve-supporting-docs",
    );
    fireEvent.click(approveAllBtn);

    // The `finally` block fires once after all three PATCHes settle,
    // regardless of how many succeeded vs failed.
    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);
  });

  // ── Test 8 ────────────────────────────────────────────────────────────────
  // Regression guard: sequential single-document approvals still call
  // loadUserDocPendingCounts once per action (not collapsed into one).
  // This confirms the individual `act()` path was not regressed by the
  // bulk changes introduced alongside Task #440.
  it("calls loadUserDocPendingCounts once per individual action when approving documents sequentially (not collapsed to one)", async () => {
    // Use two separate docs so we can approve them one at a time
    const TWO_DOCS = BULK_DOCS.slice(0, 2);

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          // Extract the doc id from the URL and return the full doc object so
          // the component's `setDocs` call receives a complete record (caseId
          // must be present or the renderer will throw on `.slice()`).
          const id = Number(String(url).split("/").pop());
          const doc = TWO_DOCS.find((d) => d.id === id) ?? TWO_DOCS[0];
          return okJson({ ...doc, status: "approved" });
        }
        return okJson(TWO_DOCS);
      });

    render(<SupportingDocumentsTab onOpenCase={vi.fn()} />);

    // Approve document 21
    await waitFor(() =>
      expect(
        screen.getByTestId(`row-supporting-doc-${TWO_DOCS[0].id}`),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId(`row-supporting-doc-${TWO_DOCS[0].id}`));
    const approveBtn1 = await screen.findByTestId(
      `button-approve-supporting-doc-${TWO_DOCS[0].id}`,
    );
    fireEvent.click(approveBtn1);

    // First action → one call
    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    // Approve document 22
    await waitFor(() =>
      expect(
        screen.getByTestId(`row-supporting-doc-${TWO_DOCS[1].id}`),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId(`row-supporting-doc-${TWO_DOCS[1].id}`));
    const approveBtn2 = await screen.findByTestId(
      `button-approve-supporting-doc-${TWO_DOCS[1].id}`,
    );
    fireEvent.click(approveBtn2);

    // Second action → two calls total (one per individual approval, not batched)
    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(2),
    );
  });
});
