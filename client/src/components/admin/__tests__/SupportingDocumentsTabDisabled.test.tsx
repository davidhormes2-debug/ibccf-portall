// @vitest-environment jsdom
//
// Task #677 — Cover the in-flight double-submit protection in SupportingDocumentsTab.
//
// SupportingDocumentsTab uses two layers of protection against double-submits:
//   1. pendingRef.current.has(doc.id) — early-return guard in act()
//   2. Optimistic UI — act() immediately sets the doc's status to the
//      decision before the PATCH resolves.  isActionable() then returns false
//      for "approved"/"rejected", which removes the Approve / Reject buttons
//      from the DOM entirely so no second click is possible.
//
// Contracts verified here:
//   1. While a PATCH approve is in-flight (promise unresolved), both the
//      Approve and Reject buttons for the acting row are absent from the DOM.
//   2. While a PATCH reject-confirm is in-flight (promise unresolved), the
//      Confirm-rejection button and the row-level Approve / Reject buttons
//      are absent from the DOM.
//   3. Once the PATCH settles with a network error the optimistic update is
//      rolled back: both buttons reappear and are re-enabled.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";

// ── Module mocks (must be hoisted before any import of the component) ─────────

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/i18n/format", () => ({
  useFormat: () => ({
    formatDateTime: (s: string) => s ?? "",
    formatDate: (s: string) => s ?? "",
    formatNumber: (n: number) => String(n),
    formatCurrency: (n: number) => String(n),
    formatRelative: (s: string) => s ?? "",
  }),
}));

const loadUserDocPendingCountsMock = vi.fn();

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => ({
      authToken: "test-token-677",
      cases: [],
      userDocPendingCounts: {},
      loadUserDocPendingCounts: loadUserDocPendingCountsMock,
    }),
  };
});

// ── Deferred import (after mocks are hoisted) ─────────────────────────────────

import { SupportingDocumentsTab } from "../tabs/SupportingDocumentsTab";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const UPLOADED_DOC = {
  id: 77,
  caseId: "case-tab-disabled-test",
  fileName: "passport.pdf",
  fileType: "application/pdf",
  fileSize: "120 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 90_000).toISOString(),
};

// A second pending doc — required for the bulk-disabled test so that after the
// optimistic update on UPLOADED_DOC (id 77), at least one actionable row
// remains visible, keeping the "Approve all" / "Reject all" buttons rendered.
const UPLOADED_DOC_2 = {
  id: 78,
  caseId: "case-tab-disabled-test",
  fileName: "bank-statement.pdf",
  fileType: "application/pdf",
  fileSize: "85 KB",
  category: "source_of_funds",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 60_000).toISOString(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

function setupDomStubs() {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const ep = Element.prototype as unknown as Record<string, unknown>;
  if (!ep.hasPointerCapture) ep.hasPointerCapture = () => false;
  if (!ep.setPointerCapture) ep.setPointerCapture = () => {};
  if (!ep.releasePointerCapture) ep.releasePointerCapture = () => {};
  if (!ep.scrollIntoView) ep.scrollIntoView = () => {};
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
}

/** Render the tab and wait for the doc row to appear. */
async function renderTabAndWaitForRow() {
  render(<SupportingDocumentsTab />);
  // The preview button is always rendered for uploaded docs — use it as
  // the anchor that proves the row has loaded.
  await waitFor(() =>
    expect(
      screen.getByTestId(`button-preview-supporting-doc-${UPLOADED_DOC.id}`),
    ).toBeTruthy(),
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  toastMock.mockClear();
  loadUserDocPendingCountsMock.mockClear();
  setupDomStubs();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SupportingDocumentsTab — in-flight double-submit protection (Task #677)", () => {
  it("removes Approve and Reject buttons from the DOM while a PATCH approve is in-flight", async () => {
    let resolvePatch!: (r: Response) => void;
    const patchPromise = new Promise<Response>((res) => (resolvePatch = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes(`/user-documents/${UPLOADED_DOC.id}`) && !u.includes("/file")) {
          return patchPromise;
        }
        return Promise.resolve(jsonOk([UPLOADED_DOC]));
      });

    await renderTabAndWaitForRow();

    const approveBtn = screen.getByTestId(
      `button-approve-supporting-doc-${UPLOADED_DOC.id}`,
    );
    const rejectBtn = screen.getByTestId(
      `button-reject-supporting-doc-${UPLOADED_DOC.id}`,
    );

    // Both buttons exist and are enabled before the action starts.
    expect((approveBtn as HTMLButtonElement).disabled).toBe(false);
    expect((rejectBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(approveBtn);

    // act() immediately applies an optimistic status update ("approved"),
    // making isActionable() return false.  The {actionable && ...} block
    // is omitted from the render, so both buttons disappear entirely.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`button-approve-supporting-doc-${UPLOADED_DOC.id}`),
      ).toBeNull();
      expect(
        screen.queryByTestId(`button-reject-supporting-doc-${UPLOADED_DOC.id}`),
      ).toBeNull();
    });

    // Settle the held PATCH so no microtasks leak.
    resolvePatch(jsonOk({ ...UPLOADED_DOC, status: "approved" }));
  });

  it("removes Confirm-rejection and row buttons from the DOM while a PATCH reject is in-flight", async () => {
    let resolvePatch!: (r: Response) => void;
    const patchPromise = new Promise<Response>((res) => (resolvePatch = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes(`/user-documents/${UPLOADED_DOC.id}`) && !u.includes("/file")) {
          return patchPromise;
        }
        return Promise.resolve(jsonOk([UPLOADED_DOC]));
      });

    await renderTabAndWaitForRow();

    // Click the Reject button to open the inline expand panel.
    fireEvent.click(
      screen.getByTestId(`button-reject-supporting-doc-${UPLOADED_DOC.id}`),
    );

    // The Confirm-rejection button appears inside the expanded panel.
    await waitFor(() =>
      expect(
        screen.getByTestId(
          `button-confirm-reject-supporting-doc-${UPLOADED_DOC.id}`,
        ),
      ).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(
        `button-confirm-reject-supporting-doc-${UPLOADED_DOC.id}`,
      ),
    );

    // act() optimistically sets status to "rejected" → isActionable() false →
    // all row-level action buttons (Approve, Reject) and the confirm panel
    // (setExpandedId(null) closes it synchronously) leave the DOM.
    await waitFor(() => {
      expect(
        screen.queryByTestId(
          `button-confirm-reject-supporting-doc-${UPLOADED_DOC.id}`,
        ),
      ).toBeNull();
      expect(
        screen.queryByTestId(`button-approve-supporting-doc-${UPLOADED_DOC.id}`),
      ).toBeNull();
      expect(
        screen.queryByTestId(`button-reject-supporting-doc-${UPLOADED_DOC.id}`),
      ).toBeNull();
    });

    resolvePatch(jsonOk({ ...UPLOADED_DOC, status: "rejected" }));
  });

  it("re-enables Approve and Reject buttons after a network error (optimistic rollback)", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes(`/user-documents/${UPLOADED_DOC.id}`) && !u.includes("/file")) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([UPLOADED_DOC]));
      });

    await renderTabAndWaitForRow();

    fireEvent.click(
      screen.getByTestId(`button-approve-supporting-doc-${UPLOADED_DOC.id}`),
    );

    // While in-flight the optimistic update removes the buttons (same guard
    // as the approve test above).
    await waitFor(() =>
      expect(
        screen.queryByTestId(`button-approve-supporting-doc-${UPLOADED_DOC.id}`),
      ).toBeNull(),
    );

    // After the PATCH rejects, the catch block calls setDocs(prevDocs) to
    // roll back the optimistic update (doc returns to "uploaded" / actionable).
    // The finally block clears actingId.  Both Approve and Reject buttons
    // must reappear and be enabled, allowing the user to retry.
    await waitFor(() => {
      const approve = screen.getByTestId(
        `button-approve-supporting-doc-${UPLOADED_DOC.id}`,
      );
      const reject = screen.getByTestId(
        `button-reject-supporting-doc-${UPLOADED_DOC.id}`,
      );
      expect((approve as HTMLButtonElement).disabled).toBe(false);
      expect((reject as HTMLButtonElement).disabled).toBe(false);
    });
  });
});

describe("SupportingDocumentsTab — bulk buttons disabled while per-row action is in-flight", () => {
  // Two docs are required here.  When only one doc is present and its per-row
  // PATCH fires, the optimistic update changes its status to "approved" which
  // makes isActionable() return false, causing the {filtered.some(isActionable)}
  // guard to hide the bulk buttons entirely — there is nothing to assert on.
  // With a second pending doc still in the list, the guard stays true (bulk
  // buttons are rendered) while actingId !== null disables them.

  /** Render with two uploaded docs and wait for both rows to appear. */
  async function renderTabWithTwoDocs() {
    render(<SupportingDocumentsTab />);
    await waitFor(() => {
      expect(
        screen.getByTestId(`button-preview-supporting-doc-${UPLOADED_DOC.id}`),
      ).toBeTruthy();
      expect(
        screen.getByTestId(`button-preview-supporting-doc-${UPLOADED_DOC_2.id}`),
      ).toBeTruthy();
    });
  }

  it("disables bulk-approve and bulk-reject while a per-row approve PATCH is in-flight", async () => {
    let resolvePatch!: (r: Response) => void;
    const patchPromise = new Promise<Response>((res) => (resolvePatch = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const u = String(url);
        // Hold only the PATCH for doc 77; let the initial list load resolve.
        if (
          u.includes(`/user-documents/${UPLOADED_DOC.id}`) &&
          !u.includes("/file")
        ) {
          return patchPromise;
        }
        // Default: return both docs so the bulk-button guard stays satisfied.
        return Promise.resolve(jsonOk([UPLOADED_DOC, UPLOADED_DOC_2]));
      });

    await renderTabWithTwoDocs();

    // Both bulk buttons must be present and enabled before any per-row action.
    const bulkApproveBeforeAct = screen.getByTestId(
      "button-bulk-approve-supporting-docs",
    );
    const bulkRejectBeforeAct = screen.getByTestId(
      "button-bulk-reject-supporting-docs",
    );
    expect((bulkApproveBeforeAct as HTMLButtonElement).disabled).toBe(false);
    expect((bulkRejectBeforeAct as HTMLButtonElement).disabled).toBe(false);

    // Trigger the per-row approve on doc 77 — this sets actingId = 77.
    fireEvent.click(
      screen.getByTestId(`button-approve-supporting-doc-${UPLOADED_DOC.id}`),
    );

    // While the PATCH for doc 77 is still pending:
    //   • actingId !== null  →  bulk buttons get disabled={true}
    //   • doc 78 is still "uploaded" (actionable)  →  bulk buttons remain rendered
    await waitFor(() => {
      const bulkApprove = screen.getByTestId(
        "button-bulk-approve-supporting-docs",
      );
      const bulkReject = screen.getByTestId(
        "button-bulk-reject-supporting-docs",
      );
      expect((bulkApprove as HTMLButtonElement).disabled).toBe(true);
      expect((bulkReject as HTMLButtonElement).disabled).toBe(true);
    });

    // Settle the held PATCH so no microtasks leak into subsequent tests.
    resolvePatch(jsonOk({ ...UPLOADED_DOC, status: "approved" }));
  });

  it("re-enables bulk buttons once the per-row PATCH settles", async () => {
    let resolvePatch!: (r: Response) => void;
    const patchPromise = new Promise<Response>((res) => (resolvePatch = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const u = String(url);
        if (
          u.includes(`/user-documents/${UPLOADED_DOC.id}`) &&
          !u.includes("/file")
        ) {
          return patchPromise;
        }
        return Promise.resolve(jsonOk([UPLOADED_DOC, UPLOADED_DOC_2]));
      });

    await renderTabWithTwoDocs();

    fireEvent.click(
      screen.getByTestId(`button-approve-supporting-doc-${UPLOADED_DOC.id}`),
    );

    // Confirm bulk buttons are disabled while in-flight.
    await waitFor(() => {
      expect(
        (
          screen.getByTestId(
            "button-bulk-approve-supporting-docs",
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });

    // Settle the PATCH — actingId returns to null.
    resolvePatch(jsonOk({ ...UPLOADED_DOC, status: "approved" }));

    // After the PATCH settles, actingId is cleared.  Doc 78 is still
    // actionable, so the bulk buttons remain rendered and must be re-enabled.
    await waitFor(() => {
      const bulkApprove = screen.getByTestId(
        "button-bulk-approve-supporting-docs",
      );
      expect((bulkApprove as HTMLButtonElement).disabled).toBe(false);
    });
  });
});

describe("SupportingDocumentsTab — selection toolbar disabled while per-row action is in-flight", () => {
  // Two docs are required: doc 78 is selected to make the selection toolbar
  // appear, while doc 77's per-row PATCH is held unresolved to keep
  // actingId !== null.  Doc 78 stays "uploaded" (actionable) so the
  // {someActionableSelected} guard keeps the toolbar rendered throughout.

  /** Render with two uploaded docs and wait for both rows to appear. */
  async function renderTabWithTwoDocs() {
    render(<SupportingDocumentsTab />);
    await waitFor(() => {
      expect(
        screen.getByTestId(`button-preview-supporting-doc-${UPLOADED_DOC.id}`),
      ).toBeTruthy();
      expect(
        screen.getByTestId(`button-preview-supporting-doc-${UPLOADED_DOC_2.id}`),
      ).toBeTruthy();
    });
  }

  it("disables approve-selected and reject-selected while a per-row approve PATCH is in-flight", async () => {
    let resolvePatch!: (r: Response) => void;
    const patchPromise = new Promise<Response>((res) => (resolvePatch = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const u = String(url);
        // Hold only the PATCH for doc 77; let the initial list load resolve.
        if (
          u.includes(`/user-documents/${UPLOADED_DOC.id}`) &&
          !u.includes("/file")
        ) {
          return patchPromise;
        }
        // Default: return both docs so the selection toolbar guard stays satisfied.
        return Promise.resolve(jsonOk([UPLOADED_DOC, UPLOADED_DOC_2]));
      });

    await renderTabWithTwoDocs();

    // Select doc 78 — this makes someActionableSelected true and renders the
    // selection toolbar (approve-selected / reject-selected buttons).
    fireEvent.click(
      screen.getByTestId(`checkbox-supporting-doc-${UPLOADED_DOC_2.id}`),
    );

    // The selection toolbar should now be visible with both buttons enabled.
    await waitFor(() => {
      const approveSelected = screen.getByTestId(
        "button-approve-selected-supporting-docs",
      );
      const rejectSelected = screen.getByTestId(
        "button-reject-selected-supporting-docs",
      );
      expect((approveSelected as HTMLButtonElement).disabled).toBe(false);
      expect((rejectSelected as HTMLButtonElement).disabled).toBe(false);
    });

    // Trigger the per-row approve on doc 77 — this sets actingId = 77.
    fireEvent.click(
      screen.getByTestId(`button-approve-supporting-doc-${UPLOADED_DOC.id}`),
    );

    // While the PATCH for doc 77 is still pending:
    //   • actingId !== null  →  selection toolbar buttons get disabled={true}
    //   • doc 78 is still "uploaded" (actionable) and selected  →  toolbar stays rendered
    await waitFor(() => {
      const approveSelected = screen.getByTestId(
        "button-approve-selected-supporting-docs",
      );
      const rejectSelected = screen.getByTestId(
        "button-reject-selected-supporting-docs",
      );
      expect((approveSelected as HTMLButtonElement).disabled).toBe(true);
      expect((rejectSelected as HTMLButtonElement).disabled).toBe(true);
    });

    // Settle the held PATCH so no microtasks leak into subsequent tests.
    resolvePatch(jsonOk({ ...UPLOADED_DOC, status: "approved" }));
  });

  it("re-enables approve-selected and reject-selected once the per-row PATCH settles", async () => {
    let resolvePatch!: (r: Response) => void;
    const patchPromise = new Promise<Response>((res) => (resolvePatch = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const u = String(url);
        if (
          u.includes(`/user-documents/${UPLOADED_DOC.id}`) &&
          !u.includes("/file")
        ) {
          return patchPromise;
        }
        return Promise.resolve(jsonOk([UPLOADED_DOC, UPLOADED_DOC_2]));
      });

    await renderTabWithTwoDocs();

    // Select doc 78 to make the selection toolbar appear.
    fireEvent.click(
      screen.getByTestId(`checkbox-supporting-doc-${UPLOADED_DOC_2.id}`),
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("button-approve-selected-supporting-docs"),
      ).toBeTruthy(),
    );

    // Fire the per-row approve on doc 77 to set actingId.
    fireEvent.click(
      screen.getByTestId(`button-approve-supporting-doc-${UPLOADED_DOC.id}`),
    );

    // Confirm selection buttons are disabled while in-flight.
    await waitFor(() => {
      expect(
        (
          screen.getByTestId(
            "button-approve-selected-supporting-docs",
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });

    // Settle the PATCH — actingId returns to null.
    resolvePatch(jsonOk({ ...UPLOADED_DOC, status: "approved" }));

    // After the PATCH settles, actingId is cleared.  Doc 78 is still
    // actionable and selected, so the toolbar remains rendered and must
    // be re-enabled.
    await waitFor(() => {
      const approveSelected = screen.getByTestId(
        "button-approve-selected-supporting-docs",
      );
      expect((approveSelected as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
