// @vitest-environment jsdom
//
// Task #451 — Verify that the per-case SupportingDocsQuickPopover bulk
// approve/reject flows call `onActioned` exactly ONCE per batch, not once
// per document.
//
// Task #469 — Verify that the per-document act() path (individual approve/
// reject buttons per row) also calls `onActioned` exactly once — including
// on the failure path where the PATCH returns a non-2xx status.
//
// Guarantee under test (badge-refresh contract documented in Task #425 /
// Task #439 / Task #442):
//   bulkApprove() and bulkReject() each call `onActioned?.()` in their
//   `finally` block exactly once after ALL individual PATCHes have settled —
//   regardless of how many documents were in the batch and whether some (or
//   all) individual PATCHes failed.
//   act() calls `onActioned?.()` in its own `finally` block exactly once
//   after the single PATCH settles — regardless of success or failure.
//
// Tests in this file:
//   Bulk (Task #451):
//   1. Bulk approve N docs → onActioned called exactly once
//   2. Bulk reject N docs  → onActioned called exactly once
//   3. Partial-failure batch (1-of-3 PATCHes 403) → onActioned still fires once
//      (the `finally` block always fires, keeping badge counts consistent)
//   Single-doc (Task #469):
//   4. Single-doc approve → onActioned called exactly once
//   5. Single-doc reject  → onActioned called exactly once
//   6. Single-doc PATCH 403 (failure) → onActioned still fires once

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";

// ── silence side-effect modules ──────────────────────────────────────────────
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── fixture ──────────────────────────────────────────────────────────────────
const CASE_ID = "popover-bulk-test-case";
const AUTH_TOKEN = "test-token";

const BULK_DOCS = [
  {
    id: 31,
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
    id: 32,
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
    id: 33,
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

  // Default: GET returns all three docs; PATCH succeeds with "approved"
  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
    .fn()
    .mockImplementation((_url: unknown, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") {
        return okJson({ status: "approved" });
      }
      return okJson(BULK_DOCS);
    });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── component under test ──────────────────────────────────────────────────────
import { SupportingDocsQuickPopover } from "../SupportingDocsQuickPopover";

// ── helper: open the popover (click the badge trigger) ───────────────────────
async function openPopover(caseId: string) {
  const trigger = await screen.findByTestId(`badge-user-doc-pending-${caseId}`);
  fireEvent.click(trigger);
  // Wait for docs to load (the GET resolves and the bulk-approve button appears)
  await waitFor(() =>
    expect(
      screen.getByTestId(`popover-bulk-approve-${caseId}`),
    ).toBeTruthy(),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe("SupportingDocsQuickPopover — bulk approve/reject onActioned contract (Task #451)", () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  // Bulk-approving 3 docs triggers exactly ONE onActioned call.
  // The batch issues 3 parallel PATCHes via Promise.allSettled; the `finally`
  // block fires once after all settle — not once per resolved PATCH.
  it("calls onActioned exactly once after bulk-approving multiple documents (not once per document)", async () => {
    const onActioned = vi.fn();

    render(
      <SupportingDocsQuickPopover
        caseId={CASE_ID}
        count={3}
        authToken={AUTH_TOKEN}
        onActioned={onActioned}
      />,
    );

    await openPopover(CASE_ID);

    fireEvent.click(screen.getByTestId(`popover-bulk-approve-${CASE_ID}`));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // Critically: fetch received 3 PATCH calls (one per doc) but only a
    // single onActioned call.  Ensuring it is not called per-document.
    expect(onActioned).toHaveBeenCalledTimes(1);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  // Bulk-rejecting 3 docs triggers exactly ONE onActioned call.
  // The user must confirm the rejection via the confirm button before the
  // batch fires.
  it("calls onActioned exactly once after bulk-rejecting multiple documents (not once per document)", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ status: "rejected" });
        }
        return okJson(BULK_DOCS);
      });

    const onActioned = vi.fn();

    render(
      <SupportingDocsQuickPopover
        caseId={CASE_ID}
        count={3}
        authToken={AUTH_TOKEN}
        onActioned={onActioned}
      />,
    );

    await openPopover(CASE_ID);

    // Click "Reject all" to open the confirmation panel
    fireEvent.click(screen.getByTestId(`popover-bulk-reject-${CASE_ID}`));

    // Confirm the rejection
    const confirmBtn = await screen.findByTestId(
      `popover-bulk-reject-confirm-btn-${CASE_ID}`,
    );
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    expect(onActioned).toHaveBeenCalledTimes(1);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  // Partial failure during bulk approve: 1 of 3 PATCHes returns a 403.
  // Promise.allSettled captures fulfilled and rejected outcomes; the `finally`
  // block still fires once after all settle.  This ensures badge counts are
  // refreshed even when the batch is only partially successful.
  it("calls onActioned exactly once after a partial-failure bulk approve (1-of-3 PATCHes 403)", async () => {
    let patchCallCount = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
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

    const onActioned = vi.fn();

    render(
      <SupportingDocsQuickPopover
        caseId={CASE_ID}
        count={3}
        authToken={AUTH_TOKEN}
        onActioned={onActioned}
      />,
    );

    await openPopover(CASE_ID);

    fireEvent.click(screen.getByTestId(`popover-bulk-approve-${CASE_ID}`));

    // The `finally` block fires once after all three PATCHes settle,
    // regardless of how many succeeded vs failed.
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    expect(onActioned).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("SupportingDocsQuickPopover — single-doc approve/reject onActioned contract (Task #469)", () => {
  // The first doc in the fixture; its per-row buttons carry this id suffix.
  const DOC_ID = BULK_DOCS[0].id; // 31

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  // Clicking the individual "Approve" button for a single doc fires `act()`
  // which calls `onActioned?.()` in its `finally` block exactly once after
  // the single PATCH resolves successfully.
  it("calls onActioned exactly once after approving a single document", async () => {
    const onActioned = vi.fn();

    render(
      <SupportingDocsQuickPopover
        caseId={CASE_ID}
        count={3}
        authToken={AUTH_TOKEN}
        onActioned={onActioned}
      />,
    );

    await openPopover(CASE_ID);

    fireEvent.click(screen.getByTestId(`popover-user-doc-approve-${DOC_ID}`));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    expect(onActioned).toHaveBeenCalledTimes(1);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  // Clicking the individual "Reject" button for a single doc fires `act()`
  // which calls `onActioned?.()` in its `finally` block exactly once after
  // the single PATCH resolves (there is no confirmation step for per-row
  // rejection, unlike bulk reject).
  it("calls onActioned exactly once after rejecting a single document", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ status: "rejected" });
        }
        return okJson(BULK_DOCS);
      });

    const onActioned = vi.fn();

    render(
      <SupportingDocsQuickPopover
        caseId={CASE_ID}
        count={3}
        authToken={AUTH_TOKEN}
        onActioned={onActioned}
      />,
    );

    await openPopover(CASE_ID);

    fireEvent.click(screen.getByTestId(`popover-user-doc-reject-${DOC_ID}`));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    expect(onActioned).toHaveBeenCalledTimes(1);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  // When the single-doc PATCH returns a non-2xx status (403), `act()` throws
  // inside the try block and lands in the `finally` block — `onActioned?.()` is
  // still called exactly once, keeping badge counts consistent even on failure.
  it("calls onActioned exactly once when the single-doc PATCH returns 403 (failure path)", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ error: "Forbidden" }, 403);
        }
        return okJson(BULK_DOCS);
      });

    const onActioned = vi.fn();

    render(
      <SupportingDocsQuickPopover
        caseId={CASE_ID}
        count={3}
        authToken={AUTH_TOKEN}
        onActioned={onActioned}
      />,
    );

    await openPopover(CASE_ID);

    fireEvent.click(screen.getByTestId(`popover-user-doc-approve-${DOC_ID}`));

    // `finally` fires even on the error path — badge counts must refresh.
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    expect(onActioned).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("SupportingDocsQuickPopover — bulk button disabled-while-in-flight (Task #2034)", () => {
  // ── Test 9 ──────────────────────────────────────────────────────────────────
  // While the bulk-approve batch (Promise.allSettled over all PATCHes) is still
  // pending, the "Approve all" button must be disabled (bulkApproving=true →
  // isBusy=true).  Once the batch settles — even with all-failure responses so
  // the docs stay visible — the finally block sets bulkApproving=false and the
  // button must become re-enabled.
  it("disables the Approve-all button while the bulk PATCH batch is in flight, then re-enables it after the batch settles with an error", async () => {
    let resolvePatch!: (r: Response) => void;
    const hangingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return hangingPatch;
        }
        return okJson(BULK_DOCS);
      });

    render(
      <SupportingDocsQuickPopover
        caseId={CASE_ID}
        count={3}
        authToken={AUTH_TOKEN}
        onActioned={vi.fn()}
      />,
    );

    await openPopover(CASE_ID);

    const bulkApproveBtn = screen.getByTestId(`popover-bulk-approve-${CASE_ID}`);
    expect((bulkApproveBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(bulkApproveBtn);

    // While all PATCHes are unresolved, bulkApproving=true → isBusy=true →
    // the button must be disabled.
    await waitFor(() => {
      expect(
        (screen.getByTestId(`popover-bulk-approve-${CASE_ID}`) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // Resolve with a server error so no docs are removed from the list and
    // the button remains visible after the finally block fires.
    resolvePatch(
      new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // After the finally block: bulkApproving=false → isBusy=false → re-enabled.
    await waitFor(() => {
      expect(
        (screen.getByTestId(`popover-bulk-approve-${CASE_ID}`) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  // While the bulk-reject batch is pending, the "Confirm rejection" button must
  // be disabled (bulkRejecting=true).  After the batch settles — even on all-
  // failure responses — the finally block sets bulkRejecting=false and
  // bulkRejectConfirming=false, so the confirm panel disappears and the
  // "Reject all" button returns enabled.
  it("disables the Reject-all confirm button while the bulk PATCH batch is in flight, then re-enables the Reject-all button after the batch settles with an error", async () => {
    let resolvePatch!: (r: Response) => void;
    const hangingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return hangingPatch;
        }
        return okJson(BULK_DOCS);
      });

    render(
      <SupportingDocsQuickPopover
        caseId={CASE_ID}
        count={3}
        authToken={AUTH_TOKEN}
        onActioned={vi.fn()}
      />,
    );

    await openPopover(CASE_ID);

    // Open the reject confirmation panel.
    fireEvent.click(screen.getByTestId(`popover-bulk-reject-${CASE_ID}`));

    const confirmBtn = await screen.findByTestId(
      `popover-bulk-reject-confirm-btn-${CASE_ID}`,
    );
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);

    // Click confirm — starts the bulk PATCH batch (still hanging).
    fireEvent.click(confirmBtn);

    // While PATCHes are unresolved, bulkRejecting=true → confirm button
    // must be disabled.
    await waitFor(() => {
      expect(
        (screen.getByTestId(`popover-bulk-reject-confirm-btn-${CASE_ID}`) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // Resolve with a server error so the docs stay in the list.
    resolvePatch(
      new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // After the finally block: bulkRejecting=false + bulkRejectConfirming=false
    // → the confirm panel is gone and the "Reject all" button reappears enabled.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`popover-bulk-reject-confirm-btn-${CASE_ID}`),
      ).toBeNull();
    });
    expect(
      (screen.getByTestId(`popover-bulk-reject-${CASE_ID}`) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("SupportingDocsQuickPopover — per-row button disabled-while-in-flight (Task #521)", () => {
  // The first doc in the fixture — its per-row buttons carry this id suffix.
  const DOC_ID = BULK_DOCS[0].id; // 31

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  // While a PATCH for a specific doc is unresolved the approve AND reject
  // buttons for that row must be disabled.  Once the PATCH settles (success)
  // the row is removed from the list and both buttons disappear entirely.
  it("disables the approve and reject buttons for the acting row while the PATCH is in flight, then removes the row on success", async () => {
    let resolvePatch!: (r: Response) => void;
    const hangingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return hangingPatch;
        }
        return okJson(BULK_DOCS);
      });

    const onActioned = vi.fn();

    render(
      <SupportingDocsQuickPopover
        caseId={CASE_ID}
        count={3}
        authToken={AUTH_TOKEN}
        onActioned={onActioned}
      />,
    );

    await openPopover(CASE_ID);

    // Both buttons should be enabled before any action.
    const approveBtn = screen.getByTestId(`popover-user-doc-approve-${DOC_ID}`);
    const rejectBtn = screen.getByTestId(`popover-user-doc-reject-${DOC_ID}`);
    expect((approveBtn as HTMLButtonElement).disabled).toBe(false);
    expect((rejectBtn as HTMLButtonElement).disabled).toBe(false);

    // Click approve — starts the PATCH (which is still hanging).
    fireEvent.click(approveBtn);

    // While the PATCH is unresolved, actingId === DOC_ID so both buttons
    // for this row must be disabled.
    await waitFor(() => {
      expect(
        (screen.getByTestId(`popover-user-doc-approve-${DOC_ID}`) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByTestId(`popover-user-doc-reject-${DOC_ID}`) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // Settle the PATCH with a success response.
    resolvePatch(
      new Response(JSON.stringify({ status: "approved" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // On success the component filters the doc out of the list, so the
    // row and its buttons disappear entirely.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`popover-user-doc-row-${DOC_ID}`),
      ).toBeNull();
    });

    expect(onActioned).toHaveBeenCalledTimes(1);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  // When the PATCH fails (non-2xx), the row stays in the list and the buttons
  // must become re-enabled so the admin can retry.
  it("re-enables the approve and reject buttons after the PATCH fails (non-2xx)", async () => {
    let resolvePatch!: (r: Response) => void;
    const hangingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return hangingPatch;
        }
        return okJson(BULK_DOCS);
      });

    const onActioned = vi.fn();

    render(
      <SupportingDocsQuickPopover
        caseId={CASE_ID}
        count={3}
        authToken={AUTH_TOKEN}
        onActioned={onActioned}
      />,
    );

    await openPopover(CASE_ID);

    fireEvent.click(screen.getByTestId(`popover-user-doc-approve-${DOC_ID}`));

    // While the PATCH is in flight, buttons must be disabled.
    await waitFor(() => {
      expect(
        (screen.getByTestId(`popover-user-doc-approve-${DOC_ID}`) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByTestId(`popover-user-doc-reject-${DOC_ID}`) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // Settle the PATCH with a failure response.
    resolvePatch(
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // On failure the row stays; both buttons must become re-enabled so the
    // admin can retry.
    await waitFor(() => {
      expect(
        (screen.getByTestId(`popover-user-doc-approve-${DOC_ID}`) as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(
        (screen.getByTestId(`popover-user-doc-reject-${DOC_ID}`) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    // `finally` still fires — badge counts refresh even on failure.
    expect(onActioned).toHaveBeenCalledTimes(1);
  });
});
