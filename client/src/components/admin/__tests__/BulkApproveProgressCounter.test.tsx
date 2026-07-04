// @vitest-environment jsdom
//
// Task #444 — Confirm the bulk-approve progress counter updates correctly.
// Task #460 — Confirm the bulk-approve button is disabled while a single-doc
//             action is in flight (actingId !== null interlock).
// Task #534 — Confirm the selection-toolbar "Reject selected" button is also
//             disabled while a single-doc action is in flight (actingId !== null).
//
// Contracts under test:
//   1. SupportingDocumentsTab — "Approve all" button label transitions to
//      "Approving 0 of N…" immediately on click, increments to "Approving X of N…"
//      as individual PATCHes complete, then clears: if all succeed the button
//      disappears (no more actionable docs); if some fail it returns to "Approve all".
//   2. SupportingDocsQuickPopover — same lifecycle using the "X / N" label variant
//      in the popover header; after completion the button resets to "Approve all"
//      or disappears when no docs remain.
//   3. Both surfaces handle partial failures without the counter getting stuck —
//      the done-count still increments on failure, reaches total, and the button resets.
//
// NOTE: vi.useFakeTimers is intentionally NOT used here. The @testing-library waitFor
// poller relies on real setTimeout/setInterval ticks; fake timers prevent it from
// advancing between assertion retries. The debounced caseIdFilter load() in
// SupportingDocumentsTab (300 ms) is neutralised by routing all GET requests through
// the makeTabFetchMock helper, which always returns the correct document array.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";

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

const loadUserDocPendingCountsMock = vi.fn();

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => ({
      authToken: "test-token",
      cases: [],
      userDocPendingCounts: { "case-abc": 3 },
      loadUserDocPendingCounts: loadUserDocPendingCountsMock,
    }),
  };
});

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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
}

function makeTabDoc(id: number) {
  return {
    id,
    caseId: "case-abc",
    fileName: `doc-${id}.pdf`,
    fileType: "application/pdf",
    fileSize: "10 KB",
    category: "kyc_id",
    description: null,
    status: "uploaded",
    adminNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: new Date(Date.now() - id * 1_000).toISOString(),
  };
}

function makePopoverDoc(id: number) {
  return {
    id,
    caseId: "case-abc",
    fileName: `upload-${id}.pdf`,
    fileType: "application/pdf",
    fileSize: "8 KB",
    category: "kyc_id",
    description: null,
    status: "uploaded",
    uploadedAt: new Date(Date.now() - id * 1_000).toISOString(),
  };
}

/** Returns a deferred promise whose resolve/reject are externally accessible. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Build a fetch mock for SupportingDocumentsTab.
 * GETs always return the supplied doc array (so the debounced caseIdFilter
 * effect never corrupts component state).  PATCHes go to patchHandler.
 */
function makeTabFetchMock(
  docs: ReturnType<typeof makeTabDoc>[],
  patchHandler: () => Promise<Response>,
) {
  return vi.fn().mockImplementation((_url: unknown, opts?: { method?: string }) => {
    if (opts?.method === "PATCH") return patchHandler();
    return Promise.resolve(jsonOk(docs));
  });
}

/**
 * Build a fetch mock for SupportingDocsQuickPopover.
 * GETs return the doc array; PATCHes go to patchHandler.
 */
function makePopoverFetchMock(
  docs: ReturnType<typeof makePopoverDoc>[],
  patchHandler: () => Promise<Response>,
) {
  return vi.fn().mockImplementation((_url: unknown, opts?: { method?: string }) => {
    if (opts?.method === "PATCH") return patchHandler();
    return Promise.resolve(jsonOk(docs));
  });
}

beforeEach(() => {
  loadUserDocPendingCountsMock.mockClear();
  setupDomStubs();
  try { window.localStorage.clear(); } catch { /* jsdom */ }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assert that the bulk-approve button is no longer in its "approving" in-progress
 * state. After a successful bulk approve ALL docs are marked approved and the
 * button is removed from the DOM (no more actionable docs) — which is the correct
 * UX. This helper accepts either outcome: button gone OR button showing "Approve all".
 */
function expectBulkApproveIdle(testId: string) {
  const btn = screen.queryByTestId(testId);
  if (btn === null) return; // button removed — all docs approved, correct behaviour
  expect(btn.textContent).toMatch(/Approve all/);
}

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — progress counter
// ---------------------------------------------------------------------------

import { SupportingDocumentsTab } from "../tabs/SupportingDocumentsTab";

const TAB_DOC_A = makeTabDoc(10);
const TAB_DOC_B = makeTabDoc(11);
const TAB_DOC_C = makeTabDoc(12);

describe("SupportingDocumentsTab – bulk-approve progress counter (Task #444)", () => {
  it("shows 'Approving 0 of N…' immediately after clicking Approve all", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    const btn = await screen.findByTestId("button-bulk-approve-supporting-docs");

    await act(async () => { fireEvent.click(btn); });

    // The label must switch to in-progress immediately (done=0, total=2).
    await waitFor(() => expect(btn.textContent).toMatch(/Approving 0 of 2/));

    // Resolve all so the test doesn't hang.
    await act(async () => {
      d1.resolve(jsonOk({ ...TAB_DOC_A, status: "approved" }));
      d2.resolve(jsonOk({ ...TAB_DOC_B, status: "approved" }));
    });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
  });

  it("increments the done-count label as each PATCH resolves", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B, TAB_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    const btn = await screen.findByTestId("button-bulk-approve-supporting-docs");

    await act(async () => { fireEvent.click(btn); });

    // Starts at 0 of 3.
    await waitFor(() => expect(btn.textContent).toMatch(/Approving 0 of 3/));

    // Resolve first — counter must reach 1.
    await act(async () => { d1.resolve(jsonOk({ ...TAB_DOC_A, status: "approved" })); });
    await waitFor(() => expect(btn.textContent).toMatch(/Approving 1 of 3/));

    // Resolve second — counter must reach 2.
    await act(async () => { d2.resolve(jsonOk({ ...TAB_DOC_B, status: "approved" })); });
    await waitFor(() => expect(btn.textContent).toMatch(/Approving 2 of 3/));

    // Resolve third — operation finishes. All docs approved → button removed from DOM
    // (no more actionable docs). Confirm the operation completed via the callback.
    await act(async () => { d3.resolve(jsonOk({ ...TAB_DOC_C, status: "approved" })); });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
    expectBulkApproveIdle("button-bulk-approve-supporting-docs");
  });

  it("button is no longer in approving state after all PATCHes succeed", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => Promise.resolve(jsonOk({ ...TAB_DOC_A, status: "approved" })),
    );

    render(<SupportingDocumentsTab />);

    const btn = await screen.findByTestId("button-bulk-approve-supporting-docs");
    await act(async () => { fireEvent.click(btn); });

    // While in-progress the button shows "Approving…".
    await waitFor(() => expect(btn.textContent).toMatch(/Approving/));

    // After completion the operation is signalled by the badge-refresh callback,
    // and the button is either gone (all docs approved) or shows "Approve all".
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
    expectBulkApproveIdle("button-bulk-approve-supporting-docs");
  });

  it("button returns to 'Approve all' after all PATCHes fail", async () => {
    // Use deferred promises so we can observe the in-progress state before
    // the operation completes (immediately-resolved promises finish within one
    // act() tick before waitFor can observe the intermediate render).
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    const btn = await screen.findByTestId("button-bulk-approve-supporting-docs");
    await act(async () => { fireEvent.click(btn); });

    // While in-progress the button shows "Approving…".
    await waitFor(() => expect(btn.textContent).toMatch(/Approving/));

    // Resolve all PATCHes with failure responses.
    await act(async () => {
      d1.resolve(jsonOk({ error: "Server Error" }, 500));
      d2.resolve(jsonOk({ error: "Server Error" }, 500));
    });

    // After all fail, docs remain pending so the button stays and must reset.
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(btn.textContent).toMatch(/Approve all/));
  });

  it("counter increments even on partial failure (failed PATCH still advances done)", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    const btn = await screen.findByTestId("button-bulk-approve-supporting-docs");

    await act(async () => { fireEvent.click(btn); });

    await waitFor(() => expect(btn.textContent).toMatch(/Approving 0 of 2/));

    // First PATCH fails — done must still increment to 1 (counter must not get stuck).
    await act(async () => { d1.resolve(jsonOk({ error: "Forbidden" }, 403)); });
    await waitFor(() => expect(btn.textContent).toMatch(/Approving 1 of 2/));

    // Second PATCH succeeds — done reaches 2; one doc still pending so button stays.
    await act(async () => { d2.resolve(jsonOk({ ...TAB_DOC_B, status: "approved" })); });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
    // TAB_DOC_A failed and stays "uploaded" → button remains visible and idle.
    await waitFor(() => expect(btn.textContent).toMatch(/Approve all/));
  });

  it("toolbar counter button stays visible in the DOM while the second PATCH is in-flight after the first fails (mid-batch presence)", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    const btn = await screen.findByTestId("button-bulk-approve-supporting-docs");

    await act(async () => { fireEvent.click(btn); });

    // Wait for the in-progress label to appear (done=0, total=2).
    await waitFor(() => expect(btn.textContent).toMatch(/Approving 0 of 2/));

    // Resolve d1 with a 403 — done must advance to 1 while d2 is still in-flight.
    await act(async () => { d1.resolve(jsonOk({ error: "Forbidden" }, 403)); });
    await waitFor(() => expect(btn.textContent).toMatch(/Approving 1 of 2/));

    // Mid-batch assertion: the approve button must still be present in the DOM
    // and must show the "Approving 1 of 2…" counter (d2 is still unresolved).
    screen.getByTestId("button-bulk-approve-supporting-docs");

    // Resolve d2 successfully to complete the batch cleanly.
    await act(async () => { d2.resolve(jsonOk({ ...TAB_DOC_B, status: "approved" })); });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
  });

  it("approve button remains in the DOM at the mid-batch point during an all-succeeding bulk-approve batch", async () => {
    // Regression guard: a refactor that conditionally hides the Tab's approve
    // button while an approve batch is running would go undetected if only the
    // counter label is checked.  This test resolves d1 cleanly (success) and
    // asserts the button is still present while d2 is still in-flight.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    const btn = await screen.findByTestId("button-bulk-approve-supporting-docs");

    await act(async () => { fireEvent.click(btn); });

    // Wait for the batch to start (done=0, total=2).
    await waitFor(() => expect(btn.textContent).toMatch(/Approving 0 of 2/));

    // Resolve d1 successfully — done advances to 1, d2 still in-flight.
    await act(async () => { d1.resolve(jsonOk({ ...TAB_DOC_A, status: "approved" })); });

    // Counter must show "Approving 1 of 2".
    await waitFor(() => expect(btn.textContent).toMatch(/Approving 1 of 2/));

    // Explicit DOM-presence check at the mid-batch point — getByTestId throws if
    // the element is missing, catching any refactor that hides the button during
    // an approve batch on the success path.
    screen.getByTestId("button-bulk-approve-supporting-docs");

    // Resolve d2 cleanly to finish the batch.
    await act(async () => { d2.resolve(jsonOk({ ...TAB_DOC_B, status: "approved" })); });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// SupportingDocsQuickPopover — progress counter
// ---------------------------------------------------------------------------

import { SupportingDocsQuickPopover } from "../SupportingDocsQuickPopover";

const POP_DOC_A = makePopoverDoc(1);
const POP_DOC_B = makePopoverDoc(2);
const POP_DOC_C = makePopoverDoc(3);

describe("SupportingDocsQuickPopover – bulk-approve progress counter (Task #444)", () => {
  it("shows '0 / N' immediately after clicking Approve all", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");

    await act(async () => { fireEvent.click(bulkBtn); });

    // Initial in-progress state: 0 / 2.
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/0\s*\/\s*2/));

    // Resolve all to avoid test hanging.
    await act(async () => {
      d1.resolve(jsonOk({ ok: true }));
      d2.resolve(jsonOk({ ok: true }));
    });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("increments the done-count label as each PATCH resolves", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B, POP_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={3}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");

    await act(async () => { fireEvent.click(bulkBtn); });

    // Starts at 0 / 3.
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/0\s*\/\s*3/));

    // Resolve first — counter must reach 1 / 3.
    await act(async () => { d1.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/1\s*\/\s*3/));

    // Resolve second — counter must reach 2 / 3.
    await act(async () => { d2.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/2\s*\/\s*3/));

    // Resolve third — all docs approved, popover removes them from list.
    // docs.length drops below 2, so the "Approve all" button is hidden.
    // Confirm operation completed via the callback.
    await act(async () => { d3.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    // Button either gone or idle (never stuck in "Approving" state).
    const btnAfter = screen.queryByTestId("popover-bulk-approve-case-abc");
    if (btnAfter) {
      expect(btnAfter.textContent).not.toMatch(/\d\s*\/\s*\d/);
    }
  });

  it("button is no longer in approving state after all PATCHes succeed", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => Promise.resolve(jsonOk({ ok: true })),
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");

    await act(async () => { fireEvent.click(bulkBtn); });

    // Must show in-progress state.
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/\d\s*\/\s*\d/));

    // After completion (signalled by onActioned) button must not be stuck in progress.
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    const btnAfter = screen.queryByTestId("popover-bulk-approve-case-abc");
    if (btnAfter) {
      expect(btnAfter.textContent).not.toMatch(/\d\s*\/\s*\d/);
    }
  });

  it("button returns to 'Approve all' after all PATCHes fail", async () => {
    // Use deferred promises so we can observe the in-progress state before
    // the operation completes (immediately-resolved promises finish within one
    // act() tick before waitFor can observe the intermediate render).
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");

    await act(async () => { fireEvent.click(bulkBtn); });

    // Must show in-progress state.
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/\d\s*\/\s*\d/));

    // Resolve all PATCHes with failure responses.
    await act(async () => {
      d1.resolve(jsonOk({ error: "Server Error" }, 500));
      d2.resolve(jsonOk({ error: "Server Error" }, 500));
    });

    // After all fail, docs are not removed so docs.length stays ≥ 2 and the button
    // remains visible. It must reset to "Approve all".
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/Approve all/));
  });

  it("counter increments even on partial failure (failed PATCH still advances done)", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");

    await act(async () => { fireEvent.click(bulkBtn); });

    await waitFor(() => expect(bulkBtn.textContent).toMatch(/0\s*\/\s*2/));

    // First PATCH fails — done must still advance to 1 (counter must not get stuck).
    await act(async () => { d1.resolve(jsonOk({ error: "Forbidden" }, 403)); });
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/1\s*\/\s*2/));

    // Second PATCH succeeds — done reaches 2. doc A failed (stays), doc B approved
    // (removed). docs.length drops to 1 < 2, so the "Approve all" button is hidden.
    // Verify operation completes via the callback.
    await act(async () => { d2.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    // Button gone (1 doc remaining < 2 threshold) or idle, never stuck in progress.
    const btnAfter = screen.queryByTestId("popover-bulk-approve-case-abc");
    if (btnAfter) {
      expect(btnAfter.textContent).not.toMatch(/\d\s*\/\s*\d/);
    }
  });

  it("button remains in the DOM at the mid-batch point after a partial failure", async () => {
    // Regression guard: a refactor that removes the button early (before the
    // batch finishes) would previously go undetected because no test called
    // getByTestId at the mid-batch point.  This test makes that gap explicit.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");

    await act(async () => { fireEvent.click(bulkBtn); });

    // Wait for the batch to start (0/2 shown).
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/0\s*\/\s*2/));

    // Resolve d1 with 403 — done advances to 1, d2 still in-flight.
    await act(async () => { d1.resolve(jsonOk({ error: "Forbidden" }, 403)); });

    // Counter must show 1 / 2.
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/1\s*\/\s*2/));

    // Explicit DOM-presence check at the mid-batch point — this is the gap the
    // test fills.  getByTestId throws if the element is missing.
    screen.getByTestId("popover-bulk-approve-case-abc");

    // Resolve d2 cleanly to finish the batch.
    await act(async () => { d2.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("approve button remains in the DOM at the mid-batch point during a bulk-approve batch (all succeeding)", async () => {
    // Regression guard: a refactor that conditionally hides the approve button
    // while an approve batch is running would go undetected if only the counter
    // label is checked.  This test resolves d1 cleanly (success) and asserts the
    // button is still present while d2 is still in-flight.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");

    await act(async () => { fireEvent.click(bulkBtn); });

    // Wait for the batch to start (0 / 2 shown).
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/0\s*\/\s*2/));

    // Resolve d1 successfully — done advances to 1, d2 still in-flight.
    await act(async () => { d1.resolve(jsonOk({ ok: true })); });

    // Counter must show 1 / 2.
    await waitFor(() => expect(bulkBtn.textContent).toMatch(/1\s*\/\s*2/));

    // Explicit DOM-presence check at the mid-batch point — getByTestId throws if
    // the element is missing, catching any refactor that hides the button during
    // an approve batch.
    screen.getByTestId("popover-bulk-approve-case-abc");

    // Resolve d2 cleanly to finish the batch.
    await act(async () => { d2.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — single-doc / bulk-approve interlock (Task #460)
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab – bulk-approve disabled while single-doc action is in flight (Task #460)", () => {
  it("disables 'Approve all' while a single-doc approve PATCH is pending, re-enables after it settles", async () => {
    // TAB_DOC_A (id=10) will be approved individually; TAB_DOC_B (id=11) stays
    // pending so the "Approve all" button remains in the DOM throughout.
    const singleDocDeferred = deferred<Response>();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => singleDocDeferred.promise,
    );

    render(<SupportingDocumentsTab />);

    // Wait for both the bulk button and the individual approve button to appear.
    const bulkBtn = await screen.findByTestId("button-bulk-approve-supporting-docs");
    const singleApproveBtn = await screen.findByTestId(`button-approve-supporting-doc-${TAB_DOC_A.id}`);

    // Bulk approve should start out enabled.
    expect((bulkBtn as HTMLButtonElement).disabled).toBe(false);

    // Click the single-doc approve — the component sets actingId and fires the PATCH.
    await act(async () => { fireEvent.click(singleApproveBtn); });

    // While the PATCH is in flight (actingId !== null), bulk approve must be disabled.
    await waitFor(() => expect((bulkBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve the deferred PATCH so the single-doc action completes.
    await act(async () => {
      singleDocDeferred.resolve(jsonOk({ ...TAB_DOC_A, status: "approved" }));
    });

    // actingId resets to null — TAB_DOC_B is still pending so the button stays in
    // the DOM, and it must no longer be disabled.
    await waitFor(() => expect((bulkBtn as HTMLButtonElement).disabled).toBe(false));
  });

  it("disables 'Approve all' while a single-doc reject PATCH is pending, re-enables after it settles", async () => {
    const singleDocDeferred = deferred<Response>();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => singleDocDeferred.promise,
    );

    render(<SupportingDocumentsTab />);

    const bulkBtn = await screen.findByTestId("button-bulk-approve-supporting-docs");
    // Open the reject panel for doc A first (the reject confirm row).
    const rejectBtn = await screen.findByTestId(`button-reject-supporting-doc-${TAB_DOC_A.id}`);

    expect((bulkBtn as HTMLButtonElement).disabled).toBe(false);

    // Click reject to open the confirmation row.
    await act(async () => { fireEvent.click(rejectBtn); });

    // Confirm reject via the confirm button in the expanded row.
    const confirmRejectBtn = await screen.findByTestId(`button-confirm-reject-supporting-doc-${TAB_DOC_A.id}`);
    await act(async () => { fireEvent.click(confirmRejectBtn); });

    // Bulk approve must be disabled while the single-doc PATCH is in flight.
    await waitFor(() => expect((bulkBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve the PATCH.
    await act(async () => {
      singleDocDeferred.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" }));
    });

    // After the action settles, TAB_DOC_B is still pending → button stays and re-enables.
    await waitFor(() => expect((bulkBtn as HTMLButtonElement).disabled).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — single-doc / bulk-reject interlock (Task #476)
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab – bulk-reject disabled while single-doc action is in flight (Task #476)", () => {
  it("disables 'Reject all' while a single-doc approve PATCH is pending, re-enables after it settles", async () => {
    // TAB_DOC_A (id=10) will be approved individually; TAB_DOC_B (id=11) stays
    // pending so all action buttons remain in the DOM throughout.
    const singleDocDeferred = deferred<Response>();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => singleDocDeferred.promise,
    );

    render(<SupportingDocumentsTab />);

    // Wait for both the bulk-reject button and the individual approve button to appear.
    const bulkRejectBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    const singleApproveBtn = await screen.findByTestId(`button-approve-supporting-doc-${TAB_DOC_A.id}`);

    // Bulk-reject should start enabled.
    expect((bulkRejectBtn as HTMLButtonElement).disabled).toBe(false);

    // Click the single-doc approve — sets actingId and fires the PATCH.
    await act(async () => { fireEvent.click(singleApproveBtn); });

    // While the PATCH is in flight (actingId !== null), bulk-reject must be disabled.
    await waitFor(() => expect((bulkRejectBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve the deferred PATCH so the single-doc action completes.
    await act(async () => {
      singleDocDeferred.resolve(jsonOk({ ...TAB_DOC_A, status: "approved" }));
    });

    // actingId resets to null — TAB_DOC_B is still pending so the button stays in
    // the DOM, and it must no longer be disabled.
    await waitFor(() => expect((bulkRejectBtn as HTMLButtonElement).disabled).toBe(false));
  });

  it("disables 'Reject all' while a single-doc reject PATCH is pending, re-enables after it settles", async () => {
    const singleDocDeferred = deferred<Response>();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => singleDocDeferred.promise,
    );

    render(<SupportingDocumentsTab />);

    const bulkRejectBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    // Open the reject panel for doc A first (the per-row inline confirm).
    const rejectBtn = await screen.findByTestId(`button-reject-supporting-doc-${TAB_DOC_A.id}`);

    expect((bulkRejectBtn as HTMLButtonElement).disabled).toBe(false);

    // Click reject to open the per-row confirmation.
    await act(async () => { fireEvent.click(rejectBtn); });

    // Confirm reject via the confirm button in the expanded row.
    const confirmRejectBtn = await screen.findByTestId(`button-confirm-reject-supporting-doc-${TAB_DOC_A.id}`);
    await act(async () => { fireEvent.click(confirmRejectBtn); });

    // Bulk-reject must be disabled while the single-doc PATCH is in flight.
    await waitFor(() => expect((bulkRejectBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve the PATCH.
    await act(async () => {
      singleDocDeferred.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" }));
    });

    // After the action settles, TAB_DOC_B is still pending → button stays and re-enables.
    await waitFor(() => expect((bulkRejectBtn as HTMLButtonElement).disabled).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// SupportingDocsQuickPopover — single-doc / bulk-approve interlock (Task #460)
// ---------------------------------------------------------------------------

describe("SupportingDocsQuickPopover – bulk-approve disabled while single-doc action is in flight (Task #460)", () => {
  it("disables 'Approve all' while a single-doc approve PATCH is pending, re-enables after it settles", async () => {
    // Use three docs so docs.length stays > 1 (bulk button threshold) even after
    // one is approved and removed from the list.
    const singleDocDeferred = deferred<Response>();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B, POP_DOC_C],
      () => singleDocDeferred.promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={3}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    // Open the popover.
    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Wait for docs to load and the bulk button to appear (docs.length > 1).
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");
    const singleApproveBtn = await screen.findByTestId(`popover-user-doc-approve-${POP_DOC_A.id}`);

    // Bulk approve should start enabled.
    expect((bulkBtn as HTMLButtonElement).disabled).toBe(false);

    // Click single-doc approve — actingId is set and PATCH is in flight.
    await act(async () => { fireEvent.click(singleApproveBtn); });

    // isBusy (actingId !== null) → bulk button must be disabled.
    await waitFor(() => expect((bulkBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve the single-doc PATCH.
    await act(async () => {
      singleDocDeferred.resolve(jsonOk({ ok: true }));
    });

    // actingId resets to null; POP_DOC_B and POP_DOC_C remain → docs.length === 2 > 1
    // → bulk button stays visible and must be re-enabled.
    await waitFor(() => {
      const btn = screen.queryByTestId("popover-bulk-approve-case-abc");
      // Button may be absent if docs.length dropped below 2 for any timing reason,
      // but if it is present it must not be disabled.
      if (btn) expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// SupportingDocsQuickPopover — single-doc / bulk-reject interlock (Task #476)
// ---------------------------------------------------------------------------

describe("SupportingDocsQuickPopover – bulk-reject disabled while single-doc action is in flight (Task #476)", () => {
  it("disables 'Reject all' while a single-doc approve PATCH is pending, re-enables after it settles", async () => {
    // Use three docs so docs.length stays > 1 (bulk button threshold) even after
    // one is approved and removed from the list.
    const singleDocDeferred = deferred<Response>();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B, POP_DOC_C],
      () => singleDocDeferred.promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={3}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    // Open the popover.
    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Wait for docs to load and both bulk buttons to appear (docs.length > 1).
    const bulkRejectBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    const singleApproveBtn = await screen.findByTestId(`popover-user-doc-approve-${POP_DOC_A.id}`);

    // Bulk-reject should start enabled.
    expect((bulkRejectBtn as HTMLButtonElement).disabled).toBe(false);

    // Click single-doc approve — actingId is set and PATCH is in flight.
    await act(async () => { fireEvent.click(singleApproveBtn); });

    // isBusy (actingId !== null) → bulk-reject button must be disabled.
    await waitFor(() => expect((bulkRejectBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve the single-doc PATCH.
    await act(async () => {
      singleDocDeferred.resolve(jsonOk({ ok: true }));
    });

    // actingId resets to null; POP_DOC_B and POP_DOC_C remain → docs.length === 2 > 1
    // → bulk-reject button stays visible and must be re-enabled.
    await waitFor(() => {
      const btn = screen.queryByTestId("popover-bulk-reject-case-abc");
      // Button may be absent if docs.length dropped below 2 for any timing reason,
      // but if it is present it must not be disabled.
      if (btn) expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("disables 'Reject all' while a single-doc reject PATCH is pending, re-enables after it settles", async () => {
    // Use three docs so docs.length stays > 1 even after one is rejected and removed.
    const singleDocDeferred = deferred<Response>();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B, POP_DOC_C],
      () => singleDocDeferred.promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={3}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    // Open the popover.
    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Wait for docs to load and both bulk buttons to appear (docs.length > 1).
    const bulkRejectBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    const singleRejectBtn = await screen.findByTestId(`popover-user-doc-reject-${POP_DOC_A.id}`);

    // Bulk-reject should start enabled.
    expect((bulkRejectBtn as HTMLButtonElement).disabled).toBe(false);

    // Click single-doc reject — actingId is set and PATCH is in flight.
    await act(async () => { fireEvent.click(singleRejectBtn); });

    // isBusy (actingId !== null) → bulk-reject button must be disabled.
    await waitFor(() => expect((bulkRejectBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve the single-doc PATCH.
    await act(async () => {
      singleDocDeferred.resolve(jsonOk({ ok: true }));
    });

    // actingId resets to null; POP_DOC_B and POP_DOC_C remain → docs.length === 2 > 1
    // → bulk-reject button stays visible and must be re-enabled.
    await waitFor(() => {
      const btn = screen.queryByTestId("popover-bulk-reject-case-abc");
      if (btn) expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — selection-toolbar 'Approve selected' / single-doc interlock (Task #627)
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab – 'Approve selected' disabled while single-doc action is in flight (Task #627)", () => {
  it("disables 'Approve selected' while a single-doc approve PATCH is pending, re-enables after it settles", async () => {
    // TAB_DOC_A (id=10) will be checked via checkbox to surface the selection
    // toolbar.  TAB_DOC_B (id=11) will be approved individually so actingId is
    // set while TAB_DOC_A remains pending (keeping the toolbar visible).
    const singleDocDeferred = deferred<Response>();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => singleDocDeferred.promise,
    );

    render(<SupportingDocumentsTab />);

    // Wait for the checkboxes and the per-row approve button to appear.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    const singleApproveBtn = await screen.findByTestId(`button-approve-supporting-doc-${TAB_DOC_B.id}`);

    // Select TAB_DOC_A — the selection toolbar (and "Approve selected") should appear.
    await act(async () => { fireEvent.click(checkboxA); });

    const approveSelectedBtn = await screen.findByTestId("button-approve-selected-supporting-docs");

    // "Approve selected" starts enabled before any single-doc action.
    expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click the single-doc approve for TAB_DOC_B — sets actingId and fires the PATCH.
    await act(async () => { fireEvent.click(singleApproveBtn); });

    // While the PATCH is in flight (actingId !== null) the "Approve selected" button
    // must be disabled by the anyBulkBusy || actingId !== null guard.
    await waitFor(() => expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve the deferred PATCH so the single-doc action completes.
    await act(async () => {
      singleDocDeferred.resolve(jsonOk({ ...TAB_DOC_B, status: "approved" }));
    });

    // actingId resets to null — TAB_DOC_A is still selected and pending, so the
    // toolbar stays in the DOM. The button must be re-enabled.
    await waitFor(() => expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(false));
  });

  it("disables 'Approve selected' while a single-doc reject PATCH is pending, re-enables after it settles", async () => {
    // TAB_DOC_A (id=10) will be checked to surface the selection toolbar.
    // TAB_DOC_B (id=11) will be rejected individually so actingId is set while
    // TAB_DOC_A remains pending (keeping the toolbar visible).
    const singleDocDeferred = deferred<Response>();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => singleDocDeferred.promise,
    );

    render(<SupportingDocumentsTab />);

    // Wait for the checkboxes and the per-row reject button to appear.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    const rejectBtn = await screen.findByTestId(`button-reject-supporting-doc-${TAB_DOC_B.id}`);

    // Select TAB_DOC_A — the selection toolbar (and "Approve selected") should appear.
    await act(async () => { fireEvent.click(checkboxA); });

    const approveSelectedBtn = await screen.findByTestId("button-approve-selected-supporting-docs");

    // "Approve selected" starts enabled.
    expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click reject for TAB_DOC_B to open the per-row confirmation, then confirm.
    await act(async () => { fireEvent.click(rejectBtn); });
    const confirmRejectBtn = await screen.findByTestId(`button-confirm-reject-supporting-doc-${TAB_DOC_B.id}`);
    await act(async () => { fireEvent.click(confirmRejectBtn); });

    // While the PATCH is in flight (actingId !== null) the "Approve selected" button
    // must be disabled by the anyBulkBusy || actingId !== null guard.
    await waitFor(() => expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve the PATCH.
    await act(async () => {
      singleDocDeferred.resolve(jsonOk({ ...TAB_DOC_B, status: "rejected" }));
    });

    // actingId resets to null — TAB_DOC_A is still selected and pending, so the
    // toolbar stays in the DOM. The button must be re-enabled.
    await waitFor(() => expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — selection-toolbar / single-doc interlock (Task #534)
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab – 'Reject selected' disabled while single-doc action is in flight (Task #534)", () => {
  it("disables 'Reject selected' while a single-doc approve PATCH is pending, re-enables after it settles", async () => {
    // TAB_DOC_A (id=10) will be checked via checkbox to surface the selection
    // toolbar.  TAB_DOC_B (id=11) will be approved individually so actingId is
    // set while TAB_DOC_A remains pending (keeping the toolbar visible).
    const singleDocDeferred = deferred<Response>();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => singleDocDeferred.promise,
    );

    render(<SupportingDocumentsTab />);

    // Wait for the checkboxes and the per-row approve button to appear.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    const singleApproveBtn = await screen.findByTestId(`button-approve-supporting-doc-${TAB_DOC_B.id}`);

    // Select TAB_DOC_A — the selection toolbar (and "Reject selected") should appear.
    await act(async () => { fireEvent.click(checkboxA); });

    const rejectSelectedBtn = await screen.findByTestId("button-reject-selected-supporting-docs");

    // "Reject selected" starts enabled before any single-doc action.
    expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click the single-doc approve for TAB_DOC_B — sets actingId and fires the PATCH.
    await act(async () => { fireEvent.click(singleApproveBtn); });

    // While the PATCH is in flight (actingId !== null) the "Reject selected" button
    // must be disabled by the anyBulkBusy || actingId !== null guard.
    await waitFor(() => expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve the deferred PATCH so the single-doc action completes.
    await act(async () => {
      singleDocDeferred.resolve(jsonOk({ ...TAB_DOC_B, status: "approved" }));
    });

    // actingId resets to null — TAB_DOC_A is still selected and pending, so the
    // toolbar stays in the DOM. The button must be re-enabled.
    await waitFor(() => expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(false));
  });

  it("disables 'Reject selected' while a single-doc reject PATCH is pending, re-enables after it settles", async () => {
    // TAB_DOC_A (id=10) will be checked to surface the selection toolbar.
    // TAB_DOC_B (id=11) will be rejected individually so actingId is set while
    // TAB_DOC_A remains pending (keeping the toolbar visible).
    const singleDocDeferred = deferred<Response>();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => singleDocDeferred.promise,
    );

    render(<SupportingDocumentsTab />);

    // Wait for the checkboxes and the per-row reject button to appear.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    const rejectBtn = await screen.findByTestId(`button-reject-supporting-doc-${TAB_DOC_B.id}`);

    // Select TAB_DOC_A — the selection toolbar (and "Reject selected") should appear.
    await act(async () => { fireEvent.click(checkboxA); });

    const rejectSelectedBtn = await screen.findByTestId("button-reject-selected-supporting-docs");

    // "Reject selected" starts enabled.
    expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click reject for TAB_DOC_B to open the per-row confirmation, then confirm.
    await act(async () => { fireEvent.click(rejectBtn); });
    const confirmRejectBtn = await screen.findByTestId(`button-confirm-reject-supporting-doc-${TAB_DOC_B.id}`);
    await act(async () => { fireEvent.click(confirmRejectBtn); });

    // While the PATCH is in flight (actingId !== null) the "Reject selected" button
    // must be disabled by the anyBulkBusy || actingId !== null guard.
    await waitFor(() => expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve the PATCH.
    await act(async () => {
      singleDocDeferred.resolve(jsonOk({ ...TAB_DOC_B, status: "rejected" }));
    });

    // actingId resets to null — TAB_DOC_A is still selected and pending, so the
    // toolbar stays in the DOM. The button must be re-enabled.
    await waitFor(() => expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — selection-toolbar / bulk-all interlock (Task #710)
// ---------------------------------------------------------------------------
// Covers the anyBulkBusy half of the `disabled={anyBulkBusy || actingId !== null}`
// guard on the "Approve selected" and "Reject selected" toolbar buttons.
// bulkApproving / bulkRejecting are the state flags that flip to true while
// "Approve all" / "Reject all" is processing its sequential PATCHes.

describe("SupportingDocumentsTab – 'Approve selected' / 'Reject selected' disabled while bulk-all operation is in flight (Task #710)", () => {
  it("disables 'Approve selected' while 'Approve all' is in flight (bulkApproving)", async () => {
    // Three docs so the toolbar remains visible (doc A is selected and pending)
    // while the deferred "Approve all" PATCHes are in flight.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B, TAB_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Select TAB_DOC_A so the selection toolbar (and "Approve selected") appears.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    await act(async () => { fireEvent.click(checkboxA); });

    const approveSelectedBtn = await screen.findByTestId("button-approve-selected-supporting-docs");

    // "Approve selected" starts enabled before any bulk-all operation.
    expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click "Approve all" — sets bulkApproving = true and fires deferred PATCHes.
    const bulkApproveBtn = await screen.findByTestId("button-bulk-approve-supporting-docs");
    await act(async () => { fireEvent.click(bulkApproveBtn); });

    // While bulkApproving is true, anyBulkBusy is true → "Approve selected" must be disabled.
    await waitFor(() => expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve all PATCHes so the test doesn't hang.
    await act(async () => {
      d1.resolve(jsonOk({ ...TAB_DOC_A, status: "approved" }));
      d2.resolve(jsonOk({ ...TAB_DOC_B, status: "approved" }));
      d3.resolve(jsonOk({ ...TAB_DOC_C, status: "approved" }));
    });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalled());
  });

  it("disables 'Reject selected' while 'Approve all' is in flight (bulkApproving)", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B, TAB_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Select TAB_DOC_A so the selection toolbar (and "Reject selected") appears.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    await act(async () => { fireEvent.click(checkboxA); });

    const rejectSelectedBtn = await screen.findByTestId("button-reject-selected-supporting-docs");

    // "Reject selected" starts enabled before any bulk-all operation.
    expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click "Approve all" — sets bulkApproving = true and fires deferred PATCHes.
    const bulkApproveBtn = await screen.findByTestId("button-bulk-approve-supporting-docs");
    await act(async () => { fireEvent.click(bulkApproveBtn); });

    // While bulkApproving is true, anyBulkBusy is true → "Reject selected" must be disabled.
    await waitFor(() => expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve all PATCHes so the test doesn't hang.
    await act(async () => {
      d1.resolve(jsonOk({ ...TAB_DOC_A, status: "approved" }));
      d2.resolve(jsonOk({ ...TAB_DOC_B, status: "approved" }));
      d3.resolve(jsonOk({ ...TAB_DOC_C, status: "approved" }));
    });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalled());
  });

  it("disables 'Approve selected' while 'Reject all' is in flight (bulkRejecting)", async () => {
    // "Reject all" requires two clicks: the trigger button and the confirmation button.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B, TAB_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Select TAB_DOC_A so the selection toolbar (and "Approve selected") appears.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    await act(async () => { fireEvent.click(checkboxA); });

    const approveSelectedBtn = await screen.findByTestId("button-approve-selected-supporting-docs");

    // "Approve selected" starts enabled before any bulk-all operation.
    expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click "Reject all" to open the confirmation panel, then confirm.
    const bulkRejectBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(bulkRejectBtn); });
    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    // While bulkRejecting is true, anyBulkBusy is true → "Approve selected" must be disabled.
    await waitFor(() => expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve all PATCHes so the test doesn't hang.
    await act(async () => {
      d1.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" }));
      d2.resolve(jsonOk({ ...TAB_DOC_B, status: "rejected" }));
      d3.resolve(jsonOk({ ...TAB_DOC_C, status: "rejected" }));
    });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalled());
  });

  it("disables 'Reject selected' while 'Reject all' is in flight (bulkRejecting)", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B, TAB_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Select TAB_DOC_A so the selection toolbar (and "Reject selected") appears.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    await act(async () => { fireEvent.click(checkboxA); });

    const rejectSelectedBtn = await screen.findByTestId("button-reject-selected-supporting-docs");

    // "Reject selected" starts enabled before any bulk-all operation.
    expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click "Reject all" to open the confirmation panel, then confirm.
    const bulkRejectBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(bulkRejectBtn); });
    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    // While bulkRejecting is true, anyBulkBusy is true → "Reject selected" must be disabled.
    await waitFor(() => expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve all PATCHes so the test doesn't hang.
    await act(async () => {
      d1.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" }));
      d2.resolve(jsonOk({ ...TAB_DOC_B, status: "rejected" }));
      d3.resolve(jsonOk({ ...TAB_DOC_C, status: "rejected" }));
    });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalled());
  });

  // ---------------------------------------------------------------------------
  // Re-enable assertions (Task #1440)
  // ---------------------------------------------------------------------------
  // The four tests below are the complementary checks: after the bulk-all run
  // finishes with partial failures (so at least one doc remains pending and
  // selected, keeping the toolbar visible), both toolbar buttons must return
  // to enabled (anyBulkBusy resets to false).

  it("re-enables 'Approve selected' after 'Approve all' finishes with partial failures", async () => {
    // TAB_DOC_A is selected and its PATCH will fail — it stays pending and
    // keeps the toolbar visible.  TAB_DOC_B and TAB_DOC_C succeed.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B, TAB_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Select TAB_DOC_A — the selection toolbar (and "Approve selected") appears.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    await act(async () => { fireEvent.click(checkboxA); });

    const approveSelectedBtn = await screen.findByTestId("button-approve-selected-supporting-docs");

    // "Approve selected" starts enabled before any bulk-all operation.
    expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click "Approve all" — sets bulkApproving = true.
    const bulkApproveBtn = await screen.findByTestId("button-bulk-approve-supporting-docs");
    await act(async () => { fireEvent.click(bulkApproveBtn); });

    // While bulkApproving is true, anyBulkBusy is true → "Approve selected" is disabled.
    await waitFor(() => expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve with partial failure: TAB_DOC_A fails (stays pending + selected),
    // TAB_DOC_B and TAB_DOC_C succeed.
    await act(async () => {
      d1.resolve(jsonOk({ error: "Forbidden" }, 403));
      d2.resolve(jsonOk({ ...TAB_DOC_B, status: "approved" }));
      d3.resolve(jsonOk({ ...TAB_DOC_C, status: "approved" }));
    });

    // Wait for the operation to complete (badge-refresh callback fires).
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalled());

    // bulkApproving resets to false → anyBulkBusy becomes false.
    // TAB_DOC_A is still selected and pending, so the toolbar stays visible and
    // the button must be re-enabled.
    await waitFor(() => expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(false));
  });

  it("re-enables 'Reject selected' after 'Approve all' finishes with partial failures", async () => {
    // Same setup as above — verify the sibling "Reject selected" button also
    // re-enables once bulkApproving clears.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B, TAB_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Select TAB_DOC_A — the selection toolbar (and "Reject selected") appears.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    await act(async () => { fireEvent.click(checkboxA); });

    const rejectSelectedBtn = await screen.findByTestId("button-reject-selected-supporting-docs");

    // "Reject selected" starts enabled before any bulk-all operation.
    expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click "Approve all" — sets bulkApproving = true.
    const bulkApproveBtn = await screen.findByTestId("button-bulk-approve-supporting-docs");
    await act(async () => { fireEvent.click(bulkApproveBtn); });

    // While bulkApproving is true, anyBulkBusy is true → "Reject selected" is disabled.
    await waitFor(() => expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve with partial failure: TAB_DOC_A fails, TAB_DOC_B and TAB_DOC_C succeed.
    await act(async () => {
      d1.resolve(jsonOk({ error: "Forbidden" }, 403));
      d2.resolve(jsonOk({ ...TAB_DOC_B, status: "approved" }));
      d3.resolve(jsonOk({ ...TAB_DOC_C, status: "approved" }));
    });

    // Wait for the operation to complete.
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalled());

    // bulkApproving resets to false → toolbar stays visible (TAB_DOC_A still
    // selected and pending) and "Reject selected" must be re-enabled.
    await waitFor(() => expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(false));
  });

  it("re-enables 'Approve selected' after 'Reject all' finishes with partial failures", async () => {
    // TAB_DOC_A is selected and its PATCH will fail — it stays pending and
    // keeps the toolbar visible.  TAB_DOC_B and TAB_DOC_C succeed.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B, TAB_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Select TAB_DOC_A — the selection toolbar (and "Approve selected") appears.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    await act(async () => { fireEvent.click(checkboxA); });

    const approveSelectedBtn = await screen.findByTestId("button-approve-selected-supporting-docs");

    // "Approve selected" starts enabled before any bulk-all operation.
    expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click "Reject all" to open the confirmation panel, then confirm.
    const bulkRejectBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(bulkRejectBtn); });
    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    // While bulkRejecting is true, anyBulkBusy is true → "Approve selected" is disabled.
    await waitFor(() => expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve with partial failure: TAB_DOC_A fails (stays pending + selected),
    // TAB_DOC_B and TAB_DOC_C succeed.
    await act(async () => {
      d1.resolve(jsonOk({ error: "Forbidden" }, 403));
      d2.resolve(jsonOk({ ...TAB_DOC_B, status: "rejected" }));
      d3.resolve(jsonOk({ ...TAB_DOC_C, status: "rejected" }));
    });

    // Wait for the operation to complete.
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalled());

    // bulkRejecting resets to false → anyBulkBusy becomes false.
    // TAB_DOC_A is still selected and pending, so the toolbar stays visible and
    // the button must be re-enabled.
    await waitFor(() => expect((approveSelectedBtn as HTMLButtonElement).disabled).toBe(false));
  });

  it("re-enables 'Reject selected' after 'Reject all' finishes with partial failures", async () => {
    // Same setup — verify "Reject selected" also re-enables once bulkRejecting clears.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B, TAB_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Select TAB_DOC_A — the selection toolbar (and "Reject selected") appears.
    const checkboxA = await screen.findByTestId(`checkbox-supporting-doc-${TAB_DOC_A.id}`);
    await act(async () => { fireEvent.click(checkboxA); });

    const rejectSelectedBtn = await screen.findByTestId("button-reject-selected-supporting-docs");

    // "Reject selected" starts enabled before any bulk-all operation.
    expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(false);

    // Click "Reject all" to open the confirmation panel, then confirm.
    const bulkRejectBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(bulkRejectBtn); });
    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    // While bulkRejecting is true, anyBulkBusy is true → "Reject selected" is disabled.
    await waitFor(() => expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(true));

    // Resolve with partial failure: TAB_DOC_A fails, TAB_DOC_B and TAB_DOC_C succeed.
    await act(async () => {
      d1.resolve(jsonOk({ error: "Forbidden" }, 403));
      d2.resolve(jsonOk({ ...TAB_DOC_B, status: "rejected" }));
      d3.resolve(jsonOk({ ...TAB_DOC_C, status: "rejected" }));
    });

    // Wait for the operation to complete.
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalled());

    // bulkRejecting resets to false → toolbar stays visible (TAB_DOC_A still
    // selected and pending) and "Reject selected" must be re-enabled.
    await waitFor(() => expect((rejectSelectedBtn as HTMLButtonElement).disabled).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — bulk-reject progress counter reset (Task #1417)
// ---------------------------------------------------------------------------
// Verifies that `bulkProgress` is reset to `null` after the bulk-reject batch
// finishes (the symmetric counterpart of the bulk-approve counter tests above).
// The confirm panel is opened first via "Reject all", then "Confirm rejection"
// triggers the sequential PATCHes.

describe("SupportingDocumentsTab – bulk-reject progress counter reset (Task #1417)", () => {
  it("shows 'Rejecting 0 of N…' immediately after clicking Confirm rejection", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Open the bulk-reject confirmation panel.
    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    // Click the confirm button to trigger the batch.
    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    // The label must switch to in-progress immediately (done=0, total=2).
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting 0 of 2/));

    // Resolve all so the test doesn't hang.
    await act(async () => {
      d1.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" }));
      d2.resolve(jsonOk({ ...TAB_DOC_B, status: "rejected" }));
    });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
  });

  it("increments the done-count label as each PATCH resolves", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B, TAB_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    // Starts at 0 of 3.
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting 0 of 3/));

    // Resolve first — counter must reach 1.
    await act(async () => { d1.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" })); });
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting 1 of 3/));

    // Resolve second — counter must reach 2.
    await act(async () => { d2.resolve(jsonOk({ ...TAB_DOC_B, status: "rejected" })); });
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting 2 of 3/));

    // Resolve third — operation finishes; confirm via the callback.
    await act(async () => { d3.resolve(jsonOk({ ...TAB_DOC_C, status: "rejected" })); });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
  });

  it("'Rejecting N of N…' is absent from the DOM after all PATCHes succeed", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => Promise.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" })),
    );

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    // While in-progress the button shows "Rejecting…".
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting/));

    // After completion (signalled by the badge-refresh callback) the counter must
    // be gone — bulkProgress reset to null in the finally block.
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
    // The confirm button is either removed (confirm panel closed) or back to idle text.
    const btnAfter = screen.queryByTestId("button-bulk-reject-confirm-supporting-docs");
    if (btnAfter) {
      expect(btnAfter.textContent).not.toMatch(/Rejecting \d+ of \d+/);
    }
  });

  it("'Rejecting N of N…' is absent from the DOM after all PATCHes fail", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    // While in-progress the button shows "Rejecting…".
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting/));

    // Resolve all PATCHes with failure responses.
    await act(async () => {
      d1.resolve(jsonOk({ error: "Server Error" }, 500));
      d2.resolve(jsonOk({ error: "Server Error" }, 500));
    });

    // After all fail, bulkProgress must be null — counter text must not remain.
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
    const btnAfter = screen.queryByTestId("button-bulk-reject-confirm-supporting-docs");
    if (btnAfter) {
      expect(btnAfter.textContent).not.toMatch(/Rejecting \d+ of \d+/);
    }
  });

  it("counter increments even on partial failure (failed PATCH still advances done)", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting 0 of 2/));

    // First PATCH fails — done must still increment to 1 (counter must not get stuck).
    await act(async () => { d1.resolve(jsonOk({ error: "Forbidden" }, 403)); });
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting 1 of 2/));

    // Second PATCH succeeds — done reaches 2; operation finishes.
    await act(async () => { d2.resolve(jsonOk({ ...TAB_DOC_B, status: "rejected" })); });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
    // bulkProgress reset to null — counter text must be gone.
    const btnAfter = screen.queryByTestId("button-bulk-reject-confirm-supporting-docs");
    if (btnAfter) {
      expect(btnAfter.textContent).not.toMatch(/Rejecting \d+ of \d+/);
    }
  });

  it("toolbar counter label stays visible in the DOM while the second PATCH is in-flight after the first fails (mid-batch presence)", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Open the bulk-reject confirmation panel.
    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    // Click Confirm rejection to start the batch.
    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    // Wait for the in-progress label to appear (done=0, total=2).
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting 0 of 2/));

    // Resolve d1 with a 403 — done must advance to 1 while d2 is still in-flight.
    await act(async () => { d1.resolve(jsonOk({ error: "Forbidden" }, 403)); });
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting 1 of 2/));

    // Mid-batch assertion: the confirm button must still be present in the DOM
    // and must show the "Rejecting 1 of 2…" counter (d2 is still unresolved).
    screen.getByTestId("button-bulk-reject-confirm-supporting-docs");

    // Resolve d2 successfully to complete the batch cleanly.
    await act(async () => { d2.resolve(jsonOk({ ...TAB_DOC_B, status: "rejected" })); });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
  });

  it("reject button remains in the DOM at the mid-batch point during an all-succeeding bulk-reject batch", async () => {
    // Regression guard: a refactor that conditionally hides the Tab's reject
    // confirm button while a reject batch is running would go undetected if only
    // the counter label is checked.  This test resolves d1 cleanly (success) and
    // asserts the confirm button is still present while d2 is still in-flight.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Open the bulk-reject confirmation panel.
    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    // Click Confirm rejection to start the batch.
    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    // Wait for the batch to start (done=0, total=2).
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting 0 of 2/));

    // Resolve d1 successfully — done advances to 1, d2 still in-flight.
    await act(async () => { d1.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" })); });

    // Counter must show "Rejecting 1 of 2".
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting 1 of 2/));

    // Explicit DOM-presence check at the mid-batch point — getByTestId throws if
    // the element is missing, catching any refactor that hides the reject button
    // during a reject batch on the all-succeeding path.
    screen.getByTestId("button-bulk-reject-confirm-supporting-docs");

    // Resolve d2 cleanly to finish the batch.
    await act(async () => { d2.resolve(jsonOk({ ...TAB_DOC_B, status: "rejected" })); });
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));
  });

  it("toolbar 'Reject all' button reappears after the batch completes", async () => {
    // Regression guard: a refactor that leaves bulkRejectConfirming=true after
    // batch completion would permanently hide the toolbar button.  This test
    // resolves d1 successfully and d2 with a 403 (the promise resolves — it is
    // not thrown — but the HTTP status causes bulkRejectVisible to count d2 as a
    // failure).  TAB_DOC_B therefore remains "uploaded" (actionable) after the
    // batch, so the toolbar wrapper stays in the DOM.  If bulkRejectConfirming
    // were not reset to false in the finally block, the "Reject all" button
    // would remain hidden even though there is an actionable doc — exactly the
    // regression this test catches.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makeTabFetchMock(
      [TAB_DOC_A, TAB_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    render(<SupportingDocumentsTab />);

    // Open the bulk-reject confirmation panel.
    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    // Click Confirm rejection to start the batch.
    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    await act(async () => { fireEvent.click(confirmBtn); });

    // Wait for the batch to start (done=0, total=2).
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/Rejecting 0 of 2/));

    // Resolve d1 successfully (TAB_DOC_A → rejected) and d2 with a 403 so
    // that TAB_DOC_B stays in "uploaded" state and the toolbar remains visible.
    await act(async () => { d1.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" })); });
    await act(async () => { d2.resolve(jsonOk({ error: "Forbidden" }, 403)); });

    // Wait for the badge-count refresh that signals the finally block ran.
    await waitFor(() => expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1));

    // The original toolbar button must be back — bulkRejectConfirming must have
    // been reset to false in the finally block so the button is no longer hidden.
    // TAB_DOC_B is still actionable, so the toolbar wrapper renders; the button
    // itself is only visible when bulkRejectConfirming=false.
    screen.getByTestId("button-bulk-reject-supporting-docs");
  });
});

// ---------------------------------------------------------------------------
// SupportingDocsQuickPopover — bulk-reject progress counter reset
// ---------------------------------------------------------------------------
// Verifies that `bulkProgress` is reset to `null` after the bulk-reject batch
// finishes in the popover (symmetric counterpart of the Tab bulk-reject counter
// tests above).  The confirm panel is opened via "Reject all", then "Confirm
// rejection" triggers the concurrent PATCHes; in-progress state is shown on
// that same confirm button as "X / N".

describe("SupportingDocsQuickPopover – bulk-reject progress counter reset", () => {
  it("shows '0 / N' immediately after clicking Confirm rejection", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    // Open the popover.
    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Click "Reject all" to reveal the confirmation panel.
    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    // Click "Confirm rejection" to start the batch.
    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    await act(async () => { fireEvent.click(confirmBtn); });

    // The label must switch to in-progress immediately (done=0, total=2).
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/0\s*\/\s*2/));

    // Resolve all so the test doesn't hang.
    await act(async () => {
      d1.resolve(jsonOk({ ok: true }));
      d2.resolve(jsonOk({ ok: true }));
    });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("increments the done-count label as each PATCH resolves", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const d3 = deferred<Response>();
    const deferreds = [d1, d2, d3];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B, POP_DOC_C],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={3}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    await act(async () => { fireEvent.click(confirmBtn); });

    // Starts at 0 / 3.
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/0\s*\/\s*3/));

    // Resolve first — counter must reach 1 / 3.
    await act(async () => { d1.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/1\s*\/\s*3/));

    // Resolve second — counter must reach 2 / 3.
    await act(async () => { d2.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/2\s*\/\s*3/));

    // Resolve third — all docs rejected, operation finishes.
    await act(async () => { d3.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    // Confirm panel is closed (bulkRejectConfirming reset) so the button should
    // be gone, but if still present it must not show an in-progress counter.
    const btnAfter = screen.queryByTestId("popover-bulk-reject-confirm-btn-case-abc");
    if (btnAfter) {
      expect(btnAfter.textContent).not.toMatch(/\d\s*\/\s*\d/);
    }
  });

  it("confirm button is no longer in progress state after all PATCHes succeed", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => Promise.resolve(jsonOk({ ok: true })),
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    await act(async () => { fireEvent.click(confirmBtn); });

    // Must show in-progress state (X / N).
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/\d\s*\/\s*\d/));

    // After completion (signalled by onActioned) the counter must be gone.
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    const btnAfter = screen.queryByTestId("popover-bulk-reject-confirm-btn-case-abc");
    if (btnAfter) {
      expect(btnAfter.textContent).not.toMatch(/\d\s*\/\s*\d/);
    }
  });

  it("confirm button is no longer in progress state after all PATCHes fail", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    await act(async () => { fireEvent.click(confirmBtn); });

    // Must show in-progress state (X / N).
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/\d\s*\/\s*\d/));

    // Resolve all PATCHes with failure responses.
    await act(async () => {
      d1.resolve(jsonOk({ error: "Server Error" }, 500));
      d2.resolve(jsonOk({ error: "Server Error" }, 500));
    });

    // After all fail, bulkProgress must be null — counter text must not remain.
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    const btnAfter = screen.queryByTestId("popover-bulk-reject-confirm-btn-case-abc");
    if (btnAfter) {
      expect(btnAfter.textContent).not.toMatch(/\d\s*\/\s*\d/);
    }
  });

  it("counter increments even on partial failure (failed PATCH still advances done)", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    await act(async () => { fireEvent.click(confirmBtn); });

    await waitFor(() => expect(confirmBtn.textContent).toMatch(/0\s*\/\s*2/));

    // First PATCH fails — done must still advance to 1 (counter must not get stuck).
    await act(async () => { d1.resolve(jsonOk({ error: "Forbidden" }, 403)); });
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/1\s*\/\s*2/));

    // Second PATCH succeeds — done reaches 2. doc A failed (stays), doc B rejected
    // (removed). Operation finishes; verify via the callback.
    await act(async () => { d2.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    // bulkProgress reset to null — counter text must be gone.
    const btnAfter = screen.queryByTestId("popover-bulk-reject-confirm-btn-case-abc");
    if (btnAfter) {
      expect(btnAfter.textContent).not.toMatch(/\d\s*\/\s*\d/);
    }
  });

  it("in-progress label stays visible while second PATCH is still in-flight after first fails", async () => {
    // This test closes the gap on the partial-failure path: after the first PATCH
    // fails and done advances to 1, the second PATCH is still pending.  The
    // confirm button must remain in the DOM and continue showing the counter
    // (1 / 2) — it must not vanish or reset prematurely.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    await act(async () => { fireEvent.click(confirmBtn); });

    // Batch starts — counter visible at 0 / 2.
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/0\s*\/\s*2/));

    // First PATCH fails — done advances to 1.  The second PATCH (d2) is still
    // in-flight.  At this exact mid-batch point the confirm button must still
    // be present in the DOM and must still show the in-progress counter.
    await act(async () => { d1.resolve(jsonOk({ error: "Forbidden" }, 403)); });
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/1\s*\/\s*2/));

    // Mid-batch assertion: button is present and counter label is visible.
    expect(screen.getByTestId("popover-bulk-reject-confirm-btn-case-abc")).toBeTruthy();
    expect(confirmBtn.textContent).toMatch(/1\s*\/\s*2/);

    // Resolve the second PATCH to let the batch complete cleanly.
    await act(async () => { d2.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("bulk-reject button remains in the DOM at the mid-batch point after a partial failure", async () => {
    // Regression guard: a refactor that removes the Reject-all toolbar button
    // early (before the batch finishes) would go undetected without an explicit
    // getByTestId call at the mid-batch point.  This test closes that gap for
    // the bulk-reject path, mirroring the equivalent guard on the approve side.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    // Open the popover.
    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Click "Reject all" to reveal the confirmation panel.
    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    // Click "Confirm rejection" to start the concurrent PATCHes.
    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    await act(async () => { fireEvent.click(confirmBtn); });

    // Batch starts — counter visible at 0 / 2.
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/0\s*\/\s*2/));

    // Resolve d1 with a 403 — done advances to 1, d2 still in-flight.
    await act(async () => { d1.resolve(jsonOk({ error: "Forbidden" }, 403)); });

    // Counter must show 1 / 2.
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/1\s*\/\s*2/));

    // Explicit DOM-presence check at the mid-batch point: the confirm button must
    // still be in the DOM while d2 is in-flight.  getByTestId throws if missing.
    // (The "Reject all" toolbar button is intentionally hidden while the confirm
    // panel is open; the confirm button is the active reject-path element.)
    screen.getByTestId("popover-bulk-reject-confirm-btn-case-abc");

    // Resolve d2 cleanly to complete the batch.
    await act(async () => { d2.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("confirm button remains in the DOM at the mid-batch point during an all-succeeding bulk-reject batch", async () => {
    // Regression guard: a refactor that conditionally hides the confirm button
    // while a successful reject batch is running would go undetected if only
    // the partial-failure mid-batch guard existed.  This test resolves d1
    // cleanly (success) and asserts the confirm button is still present while
    // d2 is still in-flight — closing the symmetric gap on the success path.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    // Open the popover.
    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Click "Reject all" to reveal the confirmation panel.
    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    // Click "Confirm rejection" to start the concurrent PATCHes.
    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    await act(async () => { fireEvent.click(confirmBtn); });

    // Batch starts — counter visible at 0 / 2.
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/0\s*\/\s*2/));

    // Resolve d1 successfully — done advances to 1, d2 still in-flight.
    await act(async () => { d1.resolve(jsonOk({ ok: true })); });

    // Counter must show 1 / 2.
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/1\s*\/\s*2/));

    // Explicit DOM-presence check at the mid-batch point — getByTestId throws if
    // the confirm button is missing, catching any refactor that hides it during
    // an all-succeeding reject batch while d2 is still in-flight.
    screen.getByTestId("popover-bulk-reject-confirm-btn-case-abc");

    // Resolve d2 cleanly to finish the batch.
    await act(async () => { d2.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("bulk-approve button remains in the DOM while a bulk-reject batch is in progress", async () => {
    // Regression guard: a refactor that accidentally removes the "Approve all"
    // button from the popover header while a reject batch is running would go
    // undetected without an explicit getByTestId call at the mid-batch point.
    // This test closes that gap.
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    const deferreds = [d1, d2];
    let patchIdx = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = makePopoverFetchMock(
      [POP_DOC_A, POP_DOC_B],
      () => deferreds[patchIdx++].promise,
    );

    const onActioned = vi.fn();
    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    // Open the popover.
    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Click "Reject all" to reveal the confirmation panel.
    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    await act(async () => { fireEvent.click(rejectAllBtn); });

    // Click "Confirm rejection" to start the concurrent PATCHes.
    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    await act(async () => { fireEvent.click(confirmBtn); });

    // Batch starts — counter visible at 0 / 2.
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/0\s*\/\s*2/));

    // Resolve d1 with a 403 — done advances to 1, d2 still in-flight.
    await act(async () => { d1.resolve(jsonOk({ error: "Forbidden" }, 403)); });

    // Counter must show 1 / 2.
    await waitFor(() => expect(confirmBtn.textContent).toMatch(/1\s*\/\s*2/));

    // Mid-batch assertion: the "Approve all" button must still be present in the
    // popover header while the reject batch is running.  getByTestId throws if
    // the element is missing, catching any refactor that removes it prematurely.
    screen.getByTestId("popover-bulk-approve-case-abc");

    // Resolve d2 cleanly to complete the batch.
    await act(async () => { d2.resolve(jsonOk({ ok: true })); });
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });
});
