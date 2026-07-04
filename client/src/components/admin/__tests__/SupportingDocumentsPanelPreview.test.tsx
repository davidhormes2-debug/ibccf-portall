// @vitest-environment jsdom
//
// Catch regressions in SupportingDocumentsPanel's openPreview error path.
//
// The preview flow:
//   1. Admin clicks the Eye button — data-testid="button-panel-preview-<id>"
//   2. GET /api/admin/user-documents/:id/file is fetched with the admin bearer
//      token.
//   3a. On success — Dialog opens and shows the file.
//   3b. On HTTP error — a destructive toast fires and the dialog is closed
//      (setPreviewOpen(false)), so no dialog remains in the DOM.
//
// This file exercises contract 3b so a future refactor of openPreview cannot
// silently drop the toast+close behaviour without a failing test.

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

const toastMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PENDING_DOC = {
  id: 55,
  caseId: "case-panel",
  fileName: "passport-scan.pdf",
  fileType: "application/pdf",
  fileSize: "40 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 60_000).toISOString(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

  if (
    !(Element.prototype as unknown as { hasPointerCapture?: unknown })
      .hasPointerCapture
  ) {
    (
      Element.prototype as unknown as { hasPointerCapture: () => boolean }
    ).hasPointerCapture = () => false;
  }

  if (
    !(Element.prototype as unknown as { setPointerCapture?: unknown })
      .setPointerCapture
  ) {
    (
      Element.prototype as unknown as { setPointerCapture: () => void }
    ).setPointerCapture = () => {};
  }

  if (
    !(Element.prototype as unknown as { releasePointerCapture?: unknown })
      .releasePointerCapture
  ) {
    (
      Element.prototype as unknown as { releasePointerCapture: () => void }
    ).releasePointerCapture = () => {};
  }

  try {
    window.localStorage.clear();
  } catch {
    /* jsdom may not support all localStorage ops */
  }
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  toastMock.mockClear();
  setupDomStubs();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Deferred import (after mocks are hoisted) ─────────────────────────────────

import { SupportingDocumentsPanel } from "../SupportingDocumentsPanel";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SupportingDocumentsPanel – openPreview error path", () => {
  it("closes the preview dialog and fires a destructive toast when the file fetch returns HTTP 500", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (
          urlStr.includes(`/user-documents/${PENDING_DOC.id}/file`)
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: "Internal Server Error" }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              },
            ) as unknown as Response,
          );
        }
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    // The preview dialog must NOT remain open after the HTTP error.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );

    // A destructive toast must have been fired.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("includes the HTTP status in the destructive toast description when the file fetch returns a non-OK status", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes(`/user-documents/${PENDING_DOC.id}/file`)) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "Not Found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }) as unknown as Response,
          );
        }
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );

    // The description should contain the HTTP status code.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        description: expect.stringContaining("404"),
      }),
    );
  });

  it("fetches the file from /api/admin/user-documents/:id/file with the bearer token", async () => {
    const capturedCalls: Array<[string, RequestInit | undefined]> = [];
    const PDF_DATA = "data:application/pdf;base64,AAAA";

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown, opts?: RequestInit) => {
        const urlStr = String(url);
        capturedCalls.push([urlStr, opts]);
        if (urlStr.includes(`/user-documents/${PENDING_DOC.id}/file`)) {
          return Promise.resolve(
            jsonOk({
              fileName: PENDING_DOC.fileName,
              fileType: PENDING_DOC.fileType,
              fileData: PDF_DATA,
            }),
          );
        }
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    // Wait for the preview dialog to open (confirms fetch completed).
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeTruthy(),
    );

    const fileFetch = capturedCalls.find(
      ([u]) =>
        u.includes("/user-documents/") && u.includes("/file"),
    );
    expect(fileFetch).toBeDefined();
    expect(fileFetch![0]).toContain(
      `/api/admin/user-documents/${PENDING_DOC.id}/file`,
    );
    expect(
      (fileFetch![1]?.headers as Record<string, string>)?.Authorization,
    ).toBe("Bearer test-token");
  });
});

// ── Race condition: dialog closed before the file fetch resolves ──────────────
//
// openPreview() is async. The dialog is opened immediately (setPreviewOpen(true))
// but the file data arrives only after the fetch completes. If the admin closes
// the dialog (Escape key) before the fetch resolves, the async continuation
// still runs — the component must not:
//   • Fire a "Preview failed" toast (the fetch may succeed; closing ≠ failure).
//   • Crash or emit React "state update on unmounted component" errors when the
//     parent unmounts the panel while a file fetch is still in-flight.

describe("SupportingDocumentsPanel — preview dialog closed mid-load (race condition)", () => {
  // ── Test 4 ──────────────────────────────────────────────────────────────────
  // Admin opens preview → file fetch hangs → admin closes dialog via Escape →
  // fetch later resolves successfully.
  // Expected: no "Preview failed" toast fires — the fetch succeeded; closing the
  // dialog is not an error condition.
  it("does not fire a toast when the dialog is closed via Escape and the file fetch later succeeds", async () => {
    let resolveFile!: (r: Response) => void;
    const hangingFile = new Promise<Response>((res) => (resolveFile = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/file")) return hangingFile;
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    // Open the preview — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    // Confirm the dialog opened and is showing the loading state.
    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    // Admin dismisses the dialog via Escape before the fetch resolves.
    fireEvent.keyDown(document.body, {
      key: "Escape",
      keyCode: 27,
      code: "Escape",
    });

    // Resolve the file fetch with a successful response.
    await act(async () => {
      resolveFile(
        new Response(
          JSON.stringify({
            fileName: PENDING_DOC.fileName,
            fileData: "data:application/pdf;base64,JVBERi0=",
            fileType: "application/pdf",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // The success branch of openPreview() never calls toast(). Closing the
    // dialog before a successful fetch must not produce an error toast.
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preview failed" }),
    );
  });

  // ── Test 4b ─────────────────────────────────────────────────────────────────
  // Admin opens preview → file fetch hangs → admin closes dialog via Escape →
  // fetch later REJECTS with a network error.
  // Expected: no "Preview failed" toast fires — the admin already dismissed the
  // dialog intentionally so surfacing a toast is surprising and confusing.
  it("does not fire a toast when the dialog is closed via Escape and the file fetch later fails", async () => {
    let rejectFile!: (reason: Error) => void;
    const hangingFile = new Promise<Response>((_res, rej) => (rejectFile = rej));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/file")) return hangingFile;
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    fireEvent.keyDown(document.body, {
      key: "Escape",
      keyCode: 27,
      code: "Escape",
    });

    await act(async () => {
      rejectFile(new Error("Network error"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preview failed" }),
    );
  });

  // ── Test 4c ─────────────────────────────────────────────────────────────────
  // Admin opens preview → file fetch hangs → admin closes dialog via Escape →
  // fetch later RESOLVES with a non-OK HTTP status (500).
  // Expected: no "Preview failed" toast fires — the admin already dismissed the
  // dialog intentionally, so surfacing a toast is surprising and confusing.
  it("does not fire a toast when the dialog is closed via Escape and the file fetch later resolves with HTTP 500", async () => {
    let resolveFile!: (r: Response) => void;
    const hangingFile = new Promise<Response>((res) => (resolveFile = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/file")) return hangingFile;
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    // Open the preview — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    // Confirm the dialog opened and is showing the loading state.
    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    // Admin dismisses the dialog via Escape before the fetch resolves.
    fireEvent.keyDown(document.body, {
      key: "Escape",
      keyCode: 27,
      code: "Escape",
    });

    // Resolve the file fetch with a non-OK HTTP 500 response.
    await act(async () => {
      resolveFile(
        new Response(
          JSON.stringify({ error: "Internal Server Error" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // The admin already closed the dialog — the HTTP error arriving after
    // dismiss must not surface a toast.
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preview failed" }),
    );
  });

  // ── Test 5a ─────────────────────────────────────────────────────────────────
  // Parent unmounts SupportingDocumentsPanel while the file fetch is in-flight.
  // Fetch later resolves with HTTP 500. Must not fire a "Preview failed" toast
  // because the component is already gone.
  it("does not fire a 'Preview failed' toast when the component unmounts and the file fetch later resolves with HTTP 500", async () => {
    let resolveFile!: (r: Response) => void;
    const hangingFile = new Promise<Response>((res) => (resolveFile = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/file")) return hangingFile;
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    const { unmount } = render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    // Unmount the panel while the fetch is still in-flight.
    unmount();

    // Resolve the fetch with an HTTP 500 after unmount.
    await act(async () => {
      resolveFile(
        new Response(
          JSON.stringify({ error: "Internal Server Error" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // The panel is unmounted — no "Preview failed" toast should fire.
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preview failed" }),
    );
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  // Normal success path: fetch resolves while the component is still mounted.
  // The finally-block guard (mountedRef.current === true) must run
  // setPreviewLoading(false), clearing the loading spinner before the dialog
  // settles.
  it("clears the loading spinner after a successful openPreview completes normally", async () => {
    const PDF_DATA = "data:application/pdf;base64,JVBERi0=";

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/file")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                fileName: PENDING_DOC.fileName,
                fileData: PDF_DATA,
                fileType: "application/pdf",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    // Wait for the dialog to open — confirms the fetch completed.
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeTruthy(),
    );

    // The loading spinner must be gone — setPreviewLoading(false) ran in finally.
    expect(screen.queryByText("Loading file…")).toBeNull();
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  // Re-mount after unmount-during-fetch: when the component unmounts while a
  // fetch is in-flight, the finally-block guard skips setPreviewLoading(false).
  // This is intentional — skipping the setter on an unmounted component avoids
  // React state-update warnings. The fresh re-mount must start with
  // previewLoading = false (its initial value), so there is no stuck spinner.
  it("starts with no loading spinner after re-mounting following an in-flight unmount", async () => {
    let resolveFile!: (r: Response) => void;
    const hangingFile = new Promise<Response>((res) => (resolveFile = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/file")) return hangingFile;
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    const { unmount } = render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    // Start the preview — sets previewLoading = true.
    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    // Unmount while the fetch is still in-flight — finally skips setPreviewLoading(false).
    unmount();

    // Resolve the hanging fetch after unmount.
    await act(async () => {
      resolveFile(
        new Response(
          JSON.stringify({
            fileName: PENDING_DOC.fileName,
            fileData: "data:application/pdf;base64,JVBERi0=",
            fileType: "application/pdf",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Re-mount a fresh instance — previewLoading starts as false, no spinner.
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PENDING_DOC]));

    render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    // The fresh mount must show no loading spinner — previewLoading starts false.
    expect(screen.queryByText("Loading file…")).toBeNull();
  });

  // ── Test 5b ─────────────────────────────────────────────────────────────────
  // Parent unmounts SupportingDocumentsPanel while the file fetch is in-flight.
  // Fetch later network-rejects. Must not fire a "Preview failed" toast because
  // the component is already gone.
  it("does not fire a 'Preview failed' toast when the component unmounts and the file fetch later network-rejects", async () => {
    let rejectFile!: (reason: Error) => void;
    const hangingFile = new Promise<Response>((_res, rej) => (rejectFile = rej));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/file")) return hangingFile;
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    const { unmount } = render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    // Unmount the panel while the fetch is still in-flight.
    unmount();

    // Network-reject the fetch after unmount.
    await act(async () => {
      rejectFile(new Error("Network error"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The panel is unmounted — no "Preview failed" toast should fire.
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preview failed" }),
    );
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  // Parent unmounts SupportingDocumentsPanel while the file fetch is in-flight.
  // The async continuation still executes (the JS closure keeps the promise
  // chain alive). It must not emit React "state update on unmounted component"
  // console.error messages, and it must not fire an error toast (the fetch
  // succeeds — there is nothing to report as failed).
  it("does not emit React state-update warnings or an error toast when the component is unmounted while the file fetch is in-flight", async () => {
    let resolveFile!: (r: Response) => void;
    const hangingFile = new Promise<Response>((res) => (resolveFile = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/file")) return hangingFile;
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { unmount } = render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    // Click preview — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    // Unmount the panel while the fetch is still in-flight.
    unmount();

    // Resolve the fetch after unmount.
    await act(async () => {
      resolveFile(
        new Response(
          JSON.stringify({
            fileName: PENDING_DOC.fileName,
            fileData: "data:application/pdf;base64,JVBERi0=",
            fileType: "application/pdf",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // No React "state update on unmounted component" errors should appear.
    const stateUpdateWarnings = consoleSpy.mock.calls.filter((args) =>
      String(args[0]).toLowerCase().includes("state update"),
    );
    expect(stateUpdateWarnings).toHaveLength(0);

    // The success branch of openPreview() never calls toast() — no error toast.
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preview failed" }),
    );

    consoleSpy.mockRestore();
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  // Close-mid-load then reopen: admin opens preview → fetch hangs → admin
  // closes the dialog via Escape (previewClosedRef = true) → fetch resolves
  // (the finally-block guard runs because mountedRef.current is still true,
  // so setPreviewLoading(false) fires) → admin reopens the preview.
  // The loading spinner from the first load must not leak into the reopened
  // dialog, and the second open must load cleanly.
  it("clears the loading spinner after being closed mid-load, and loads cleanly on reopen", async () => {
    let resolveFirstFile!: (r: Response) => void;
    const hangingFirstFile = new Promise<Response>(
      (res) => (resolveFirstFile = res),
    );
    const PDF_DATA = "data:application/pdf;base64,JVBERi0=";
    let fileFetchCount = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/file")) {
          fileFetchCount += 1;
          if (fileFetchCount === 1) return hangingFirstFile;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                fileName: PENDING_DOC.fileName,
                fileData: PDF_DATA,
                fileType: "application/pdf",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(jsonOk([PENDING_DOC]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-panel"
        authToken="test-token"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("passport-scan.pdf")).toBeTruthy(),
    );

    // Open the preview — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    // Admin dismisses the dialog via Escape before the fetch resolves.
    fireEvent.keyDown(document.body, {
      key: "Escape",
      keyCode: 27,
      code: "Escape",
    });

    // The first fetch resolves after the dialog has been closed. The
    // finally-block guard still runs (mountedRef.current is true), clearing
    // previewLoading even though the dialog is now closed.
    await act(async () => {
      resolveFirstFile(
        new Response(
          JSON.stringify({
            fileName: PENDING_DOC.fileName,
            fileData: PDF_DATA,
            fileType: "application/pdf",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // No stale spinner should linger while the dialog is closed.
    expect(screen.queryByText("Loading file…")).toBeNull();

    // Admin reopens the preview — the second fetch resolves immediately.
    fireEvent.click(
      screen.getByTestId(`button-panel-preview-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeTruthy(),
    );

    // The spinner must not leak across the open/close/reopen cycle — it
    // must be gone once the second preview has finished loading.
    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeNull(),
    );
    expect(fileFetchCount).toBe(2);
  });
});
