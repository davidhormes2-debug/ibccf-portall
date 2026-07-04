// @vitest-environment jsdom
//
// Task #408 — Cover the case-list "N NEW UPLOADS" quick-action popover
// introduced in Task #338. Verifies six contracts:
//   1. Clicking the badge fetches `/api/cases/:id/user-documents` with
//      the admin bearer token and renders the returned pending docs.
//   2. Approve fires PATCH `/api/admin/user-documents/:id` with
//      `{status: "approved"}` and invokes the `onActioned` refresh
//      callback (the CasesTab uses this to call `loadUserDocPendingCounts`).
//   3. Reject fires PATCH with `{status: "rejected"}` and removes the
//      row from the popover after the request resolves.
//   4. When the endpoint returns an empty list, the friendly
//      "no pending uploads" copy is rendered.
//   5. (Task #436) `onActioned` is still called when the PATCH fails with
//      a non-OK HTTP status so badge counts are refreshed after failures.
//   6. (Task #436) `onActioned` is still called when the PATCH throws a
//      network error so badge counts are refreshed after network failures.
//   7. The per-row Approve button carries `data-testid="popover-user-doc-approve-{id}"`.
//      This test is the compile/test-time guard for the e2e test in
//      admin-doc-approval-count-sync.spec.ts — a rename or removal of the
//      attribute is caught here before a full e2e run is needed.
//   8. The per-row Reject button carries `data-testid="popover-user-doc-reject-{id}"`.
//      Mirrors guard #7 for the Reject path used by the same e2e test.
//   9. The per-row Approve button is disabled while the PATCH is in-flight
//      and re-enabled once the request settles (double-click protection).
//  10. The per-row Reject button is disabled while the PATCH is in-flight
//      and re-enabled once the request settles (double-click protection).

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

import { SupportingDocsQuickPopover } from "../SupportingDocsQuickPopover";

const PENDING_DOC = {
  id: 7,
  caseId: "case-abc",
  fileName: "passport.pdf",
  fileType: "application/pdf",
  fileSize: "120 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  uploadedAt: "2026-05-22T12:00:00.000Z",
};

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

beforeEach(() => {
  // Radix Popover positioning relies on ResizeObserver / pointer
  // capture APIs that jsdom doesn't ship. Stub the minimum surface.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  if (!(Element.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
    (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture =
      () => false;
  }
  if (!(Element.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture) {
    (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture =
      () => {};
  }
  if (!(Element.prototype as unknown as { releasePointerCapture?: unknown }).releasePointerCapture) {
    (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture =
      () => {};
  }
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SupportingDocsQuickPopover", () => {
  it("opens the popover, loads pending uploads from /api/cases/:id/user-documents with the admin bearer token, and renders rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk([PENDING_DOC]));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={1}
        authToken="admin-token-xyz"
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    await waitFor(() =>
      expect(
        screen.getByTestId(`popover-user-doc-row-${PENDING_DOC.id}`),
      ).toBeTruthy(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cases/case-abc/user-documents");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer admin-token-xyz" });

    // Row shows the file name from the response.
    expect(screen.getByText("passport.pdf")).toBeTruthy();
  });

  it("approve hits PATCH /api/admin/user-documents/:id with status=approved and calls onActioned afterwards", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PENDING_DOC])) // initial load
      .mockResolvedValueOnce(jsonOk({ ok: true })); // PATCH approve
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={1}
        authToken="admin-token-xyz"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const approveBtn = await screen.findByTestId(
      `popover-user-doc-approve-${PENDING_DOC.id}`,
    );

    fireEvent.click(approveBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [patchUrl, patchInit] = fetchMock.mock.calls[1];
    expect(patchUrl).toBe(`/api/admin/user-documents/${PENDING_DOC.id}`);
    expect(patchInit?.method).toBe("PATCH");
    expect(patchInit?.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer admin-token-xyz",
    });
    expect(JSON.parse(patchInit?.body as string)).toEqual({ status: "approved" });

    // The acted-on row is removed from the popover after success — the
    // empty-state copy takes its place.
    await waitFor(() =>
      expect(
        screen.queryByTestId(`popover-user-doc-row-${PENDING_DOC.id}`),
      ).toBeNull(),
    );
  });

  it("reject hits PATCH /api/admin/user-documents/:id with status=rejected and removes the row", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PENDING_DOC]))
      .mockResolvedValueOnce(jsonOk({ ok: true }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={1}
        authToken="admin-token-xyz"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const rejectBtn = await screen.findByTestId(
      `popover-user-doc-reject-${PENDING_DOC.id}`,
    );

    fireEvent.click(rejectBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    const [patchUrl, patchInit] = fetchMock.mock.calls[1];
    expect(patchUrl).toBe(`/api/admin/user-documents/${PENDING_DOC.id}`);
    expect(patchInit?.method).toBe("PATCH");
    expect(JSON.parse(patchInit?.body as string)).toEqual({ status: "rejected" });

    await waitFor(() =>
      expect(
        screen.queryByTestId(`popover-user-doc-row-${PENDING_DOC.id}`),
      ).toBeNull(),
    );
  });

  it("renders the friendly empty-state copy when the endpoint returns no pending uploads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk([]));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-empty"
        count={0}
        authToken="admin-token-xyz"
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-empty"));

    await waitFor(() =>
      expect(
        screen.getByText(/no pending uploads/i),
      ).toBeTruthy(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/cases/case-empty/user-documents");
  });

  it("(Task #436) calls onActioned even when the PATCH returns a non-OK HTTP status", async () => {
    const onActioned = vi.fn();
    const errorResponse = new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }) as unknown as Response;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PENDING_DOC])) // initial load
      .mockResolvedValueOnce(errorResponse);          // PATCH fails
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={1}
        authToken="admin-token-xyz"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const approveBtn = await screen.findByTestId(
      `popover-user-doc-approve-${PENDING_DOC.id}`,
    );

    fireEvent.click(approveBtn);

    // onActioned must be called even though the PATCH failed (finally-block guarantee)
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // The row stays in the list because the action was not successful
    await waitFor(() =>
      expect(
        screen.getByTestId(`popover-user-doc-row-${PENDING_DOC.id}`),
      ).toBeTruthy(),
    );
  });

  it("(Task #436) calls onActioned even when the PATCH throws a network error", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PENDING_DOC])) // initial load
      .mockRejectedValueOnce(new TypeError("Failed to fetch")); // network error
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={1}
        authToken="admin-token-xyz"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const rejectBtn = await screen.findByTestId(
      `popover-user-doc-reject-${PENDING_DOC.id}`,
    );

    fireEvent.click(rejectBtn);

    // onActioned must be called even though the fetch threw (finally-block guarantee)
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // The row stays in the list because the action was not successful
    await waitFor(() =>
      expect(
        screen.getByTestId(`popover-user-doc-row-${PENDING_DOC.id}`),
      ).toBeTruthy(),
    );
  });

  it("per-row Approve button carries data-testid='popover-user-doc-approve-{id}' (compile-time guard for e2e counterpart)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk([PENDING_DOC]));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={1}
        authToken="admin-token-xyz"
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Wait for the row to appear (load completes)
    await waitFor(() =>
      expect(
        screen.getByTestId(`popover-user-doc-row-${PENDING_DOC.id}`),
      ).toBeTruthy(),
    );

    // The Approve button must carry the exact test-id used by the e2e test
    // in admin-doc-approval-count-sync.spec.ts.  If the button is renamed or
    // the attribute is removed this assertion fails at unit-test time — before
    // a full e2e run is needed.
    const approveBtn = screen.getByTestId(
      `popover-user-doc-approve-${PENDING_DOC.id}`,
    );
    expect(approveBtn).toBeTruthy();
    expect(approveBtn.getAttribute("data-testid")).toBe(
      `popover-user-doc-approve-${PENDING_DOC.id}`,
    );
  });

  it("per-row Reject button carries data-testid='popover-user-doc-reject-{id}' (compile-time guard for e2e counterpart)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk([PENDING_DOC]));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={1}
        authToken="admin-token-xyz"
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Wait for the row to appear (load completes)
    await waitFor(() =>
      expect(
        screen.getByTestId(`popover-user-doc-row-${PENDING_DOC.id}`),
      ).toBeTruthy(),
    );

    // The Reject button must carry the exact test-id used by the e2e test
    // in admin-doc-approval-count-sync.spec.ts.  If the button is renamed or
    // the attribute is removed this assertion fails at unit-test time — before
    // a full e2e run is needed.
    const rejectBtn = screen.getByTestId(
      `popover-user-doc-reject-${PENDING_DOC.id}`,
    );
    expect(rejectBtn).toBeTruthy();
    expect(rejectBtn.getAttribute("data-testid")).toBe(
      `popover-user-doc-reject-${PENDING_DOC.id}`,
    );
  });

  it("approve button is disabled while the PATCH is in-flight and re-enabled once it settles", async () => {
    // Use a manually-resolved promise so we can inspect the button state
    // while the request is still pending (actingId === doc.id → disabled).
    // The PATCH resolves with a 500 so the row remains visible and we can
    // confirm the button re-enables after the finally block clears actingId.
    let resolvePatch!: (value: Response) => void;
    const patchPromise = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PENDING_DOC])) // initial load
      .mockReturnValueOnce(patchPromise);            // delayed PATCH
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={1}
        authToken="admin-token-xyz"
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const approveBtn = await screen.findByTestId(
      `popover-user-doc-approve-${PENDING_DOC.id}`,
    );

    fireEvent.click(approveBtn);

    // While the PATCH promise is unresolved, actingId === doc.id → disabled
    await waitFor(() =>
      expect((approveBtn as HTMLButtonElement).disabled).toBe(true),
    );

    // Resolve with a server error so the row stays in place
    resolvePatch(
      new Response(JSON.stringify({ error: "Server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }) as unknown as Response,
    );

    // After the promise settles the finally block clears actingId → re-enabled
    await waitFor(() =>
      expect((approveBtn as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("reject button is disabled while the PATCH is in-flight and re-enabled once it settles", async () => {
    // Mirror of the approve test for the reject path.
    let resolvePatch!: (value: Response) => void;
    const patchPromise = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PENDING_DOC])) // initial load
      .mockReturnValueOnce(patchPromise);            // delayed PATCH
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={1}
        authToken="admin-token-xyz"
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const rejectBtn = await screen.findByTestId(
      `popover-user-doc-reject-${PENDING_DOC.id}`,
    );

    fireEvent.click(rejectBtn);

    // While the PATCH promise is unresolved, actingId === doc.id → disabled
    await waitFor(() =>
      expect((rejectBtn as HTMLButtonElement).disabled).toBe(true),
    );

    // Resolve with a server error so the row stays in place
    resolvePatch(
      new Response(JSON.stringify({ error: "Server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }) as unknown as Response,
    );

    // After the promise settles the finally block clears actingId → re-enabled
    await waitFor(() =>
      expect((rejectBtn as HTMLButtonElement).disabled).toBe(false),
    );
  });
});
