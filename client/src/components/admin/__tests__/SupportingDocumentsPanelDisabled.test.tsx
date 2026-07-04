// @vitest-environment jsdom
//
// Task #594 — Cover the in-flight disabled-button guard in SupportingDocumentsPanel.
//
// SupportingDocumentsPanel has the same actingId / pendingRef guard as
// SupportingDocsQuickPopover (covered by Task #521), but the panel's
// per-row approve/reject buttons had no parallel tests. A regression in
// the panel would allow double-submits without any test catching it.
//
// Contracts verified here:
//   1. While a PATCH is in-flight (promise unresolved), both the Approve
//      and Reject buttons for the acting row are disabled.
//   2. Once the PATCH settles successfully the row disappears from the list
//      (load() re-fetches and returns the doc as approved/rejected so it is
//      no longer actionable), which implicitly proves the buttons re-enable
//      by confirming normal post-success flow.
//   3. Once the PATCH settles with a network error, both buttons re-enable
//      (the row stays because the action failed).

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/i18n/format", () => ({
  useFormat: () => ({
    formatDateTime: (s: string) => s ?? "",
    formatDate: (s: string) => s ?? "",
  }),
}));

import { SupportingDocumentsPanel } from "../SupportingDocumentsPanel";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const UPLOADED_DOC = {
  id: 42,
  caseId: "case-panel-test",
  fileName: "id_scan.pdf",
  fileType: "application/pdf",
  fileSize: "88 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 60_000).toISOString(),
};

const APPROVED_DOC = { ...UPLOADED_DOC, status: "approved" };

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

/** Render panel and wait for the row to appear. */
async function renderPanel(fetchMock: ReturnType<typeof vi.fn>, onActioned?: () => void) {
  render(
    <SupportingDocumentsPanel
      caseId="case-panel-test"
      authToken="admin-token-panel"
      onActioned={onActioned}
    />,
  );

  // Wait for the initial load to finish and the doc row to appear.
  await waitFor(() =>
    expect(
      screen.getByTestId(`button-panel-expand-${UPLOADED_DOC.id}`),
    ).toBeTruthy(),
  );
}

/** Click the expand chevron to reveal the Approve / Reject buttons. */
async function expandRow(docId: number) {
  fireEvent.click(screen.getByTestId(`button-panel-expand-${docId}`));
  // Both buttons appear inside the expanded section.
  await waitFor(() =>
    expect(
      screen.getByTestId(`button-panel-approve-${docId}`),
    ).toBeTruthy(),
  );
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // jsdom doesn't ship ResizeObserver or pointer-capture APIs used by Radix.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  const ep = Element.prototype as unknown as Record<string, unknown>;
  if (!ep.hasPointerCapture) ep.hasPointerCapture = () => false;
  if (!ep.setPointerCapture) ep.setPointerCapture = () => {};
  if (!ep.releasePointerCapture) ep.releasePointerCapture = () => {};
  if (!ep.scrollIntoView) ep.scrollIntoView = () => {};

  // Silence localStorage errors in jsdom (localStorage is available in jsdom
  // but we want a clean slate per test).
  try {
    window.localStorage.clear();
  } catch { /* ignore */ }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SupportingDocumentsPanel — in-flight disabled-button guard (Task #594)", () => {
  it("disables Approve and Reject buttons while a PATCH approve is in-flight", async () => {
    let resolveApprove!: (r: Response) => void;
    const patchPromise = new Promise<Response>(
      (res) => (resolveApprove = res),
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([UPLOADED_DOC])) // initial load
      .mockReturnValueOnce(patchPromise);             // PATCH — held unresolved
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    await renderPanel(fetchMock);
    await expandRow(UPLOADED_DOC.id);

    const approveBtn = screen.getByTestId(`button-panel-approve-${UPLOADED_DOC.id}`);
    const rejectBtn = screen.getByTestId(`button-panel-reject-${UPLOADED_DOC.id}`);

    // Both buttons should be enabled before the action starts.
    expect((approveBtn as HTMLButtonElement).disabled).toBe(false);
    expect((rejectBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(approveBtn);

    // While the PATCH promise is unresolved, actingId === doc.id → both
    // buttons must be disabled.
    await waitFor(() => {
      expect((screen.getByTestId(`button-panel-approve-${UPLOADED_DOC.id}`) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId(`button-panel-reject-${UPLOADED_DOC.id}`) as HTMLButtonElement).disabled).toBe(true);
    });

    // Let the PATCH resolve so the test doesn't leak pending microtasks.
    resolveApprove(jsonOk(APPROVED_DOC));
  });

  it("disables Approve and Reject buttons while a PATCH reject is in-flight", async () => {
    let resolveReject!: (r: Response) => void;
    const patchPromise = new Promise<Response>(
      (res) => (resolveReject = res),
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([UPLOADED_DOC])) // initial load
      .mockReturnValueOnce(patchPromise);             // PATCH — held unresolved
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    await renderPanel(fetchMock);
    await expandRow(UPLOADED_DOC.id);

    const rejectBtn = screen.getByTestId(`button-panel-reject-${UPLOADED_DOC.id}`);
    const approveBtn = screen.getByTestId(`button-panel-approve-${UPLOADED_DOC.id}`);

    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect((screen.getByTestId(`button-panel-reject-${UPLOADED_DOC.id}`) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId(`button-panel-approve-${UPLOADED_DOC.id}`) as HTMLButtonElement).disabled).toBe(true);
    });

    resolveReject(jsonOk({ ...UPLOADED_DOC, status: "rejected" }));
  });

  it("row disappears after a successful approve (buttons implicitly re-enable via normal post-success flow)", async () => {
    // After act() succeeds it calls load(), which re-fetches. We return the
    // doc as approved on the second GET so isActionable() returns false and
    // the expand button — and the action buttons — are gone.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([UPLOADED_DOC]))   // initial GET
      .mockResolvedValueOnce(jsonOk(APPROVED_DOC))     // PATCH approve
      .mockResolvedValueOnce(jsonOk([APPROVED_DOC]));  // reload GET
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    const onActioned = vi.fn();
    await renderPanel(fetchMock, onActioned);
    await expandRow(UPLOADED_DOC.id);

    fireEvent.click(screen.getByTestId(`button-panel-approve-${UPLOADED_DOC.id}`));

    // After success the expand button disappears (doc is no longer actionable).
    await waitFor(() =>
      expect(
        screen.queryByTestId(`button-panel-expand-${UPLOADED_DOC.id}`),
      ).toBeNull(),
    );
    // onActioned must have been called.
    expect(onActioned).toHaveBeenCalledTimes(1);
  });

  it("re-enables Approve and Reject buttons after a network error (row stays expanded)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([UPLOADED_DOC]))             // initial GET
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));  // PATCH network error
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    await renderPanel(fetchMock);
    await expandRow(UPLOADED_DOC.id);

    fireEvent.click(screen.getByTestId(`button-panel-approve-${UPLOADED_DOC.id}`));

    // While in-flight the buttons are disabled (same guard as other tests).
    await waitFor(() => {
      expect(
        (screen.getByTestId(`button-panel-approve-${UPLOADED_DOC.id}`) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // After the promise rejects, act()'s finally block resets actingId to null.
    // Note: load() is NOT called on error (it lives inside the try block, after
    // the ok check), so the row stays expanded (setExpandedId(null) is also
    // only called on success). The approve/reject buttons remain in the DOM
    // and must be re-enabled.
    await waitFor(() => {
      expect(
        (screen.getByTestId(`button-panel-approve-${UPLOADED_DOC.id}`) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    expect(
      (screen.getByTestId(`button-panel-reject-${UPLOADED_DOC.id}`) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
