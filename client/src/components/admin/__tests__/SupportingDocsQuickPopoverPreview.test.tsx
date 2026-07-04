// @vitest-environment jsdom
//
// Catch regressions in SupportingDocsQuickPopover's openPreview error path.
//
// The preview flow:
//   1. Admin opens the popover via the badge and docs are loaded.
//   2. Admin clicks the Eye button — data-testid="popover-user-doc-preview-<id>"
//   3. GET /api/admin/user-documents/:id/file is fetched with the admin bearer
//      token.
//   4a. On success — the preview Dialog (data-testid="sdqp-preview-dialog")
//       opens and displays the file.
//   4b. On HTTP error — a destructive toast fires and setPreviewOpen(false) is
//       called, so the preview Dialog is NOT left open in the DOM.
//
// This suite exercises contract 4b so a future refactor of openPreview cannot
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PENDING_DOC = {
  id: 77,
  caseId: "case-popover",
  fileName: "bank-statement.png",
  fileType: "image/png",
  fileSize: "95 KB",
  category: "source_of_funds",
  description: null,
  status: "uploaded",
  uploadedAt: "2026-05-22T10:00:00.000Z",
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

  const proto = Element.prototype as unknown as {
    hasPointerCapture?: () => boolean;
    setPointerCapture?: () => void;
    releasePointerCapture?: () => void;
    scrollIntoView?: () => void;
  };

  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  toastMock.mockClear();
  setupDomStubs();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Deferred import (after mocks are hoisted) ─────────────────────────────────

import { SupportingDocsQuickPopover } from "../SupportingDocsQuickPopover";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function openPopoverAndLoadDocs(fetchMock: ReturnType<typeof vi.fn>) {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

  render(
    <SupportingDocsQuickPopover
      caseId="case-popover"
      count={1}
      authToken="admin-token-xyz"
    />,
  );

  fireEvent.click(
    screen.getByTestId("badge-user-doc-pending-case-popover"),
  );

  await waitFor(() =>
    expect(
      screen.getByTestId(`popover-user-doc-row-${PENDING_DOC.id}`),
    ).toBeTruthy(),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SupportingDocsQuickPopover – openPreview error path", () => {
  it("does not leave the preview dialog open when the file fetch returns HTTP 500", async () => {
    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes(`/user-documents/${PENDING_DOC.id}/file`)) {
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

    await openPopoverAndLoadDocs(fetchMock);

    fireEvent.click(
      screen.getByTestId(`popover-user-doc-preview-${PENDING_DOC.id}`),
    );

    // The preview dialog must NOT remain open after the error.
    await waitFor(() =>
      expect(
        screen.queryByTestId("sdqp-preview-dialog"),
      ).toBeNull(),
    );
  });

  it("fires a destructive toast when the file fetch returns HTTP 500", async () => {
    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes(`/user-documents/${PENDING_DOC.id}/file`)) {
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

    await openPopoverAndLoadDocs(fetchMock);

    fireEvent.click(
      screen.getByTestId(`popover-user-doc-preview-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      ),
    );
  });

  it("includes the HTTP status code in the toast description when the fetch returns a non-OK status", async () => {
    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
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

    await openPopoverAndLoadDocs(fetchMock);

    fireEvent.click(
      screen.getByTestId(`popover-user-doc-preview-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          description: expect.stringContaining("404"),
        }),
      ),
    );
  });

  it("fetches the file from /api/admin/user-documents/:id/file with the bearer token", async () => {
    const capturedCalls: Array<[string, RequestInit | undefined]> = [];
    const IMG_DATA = "data:image/png;base64,AAAA";

    const fetchMock = vi.fn().mockImplementation((url: unknown, opts?: RequestInit) => {
      const urlStr = String(url);
      capturedCalls.push([urlStr, opts]);
      if (urlStr.includes(`/user-documents/${PENDING_DOC.id}/file`)) {
        return Promise.resolve(
          jsonOk({
            fileName: PENDING_DOC.fileName,
            fileType: PENDING_DOC.fileType,
            fileData: IMG_DATA,
          }),
        );
      }
      return Promise.resolve(jsonOk([PENDING_DOC]));
    });

    await openPopoverAndLoadDocs(fetchMock);

    fireEvent.click(
      screen.getByTestId(`popover-user-doc-preview-${PENDING_DOC.id}`),
    );

    // Wait for the preview dialog to open (confirms the file fetch completed).
    await waitFor(() =>
      expect(screen.getByTestId("sdqp-preview-dialog")).toBeTruthy(),
    );

    const fileFetch = capturedCalls.find(
      ([u]) => u.includes("/user-documents/") && u.includes("/file"),
    );
    expect(fileFetch).toBeDefined();
    expect(fileFetch![0]).toContain(
      `/api/admin/user-documents/${PENDING_DOC.id}/file`,
    );
    expect(
      (fileFetch![1]?.headers as Record<string, string>)?.Authorization,
    ).toBe("Bearer admin-token-xyz");
  });
});

// ── Race condition: dialog closed before the file fetch resolves ──────────────
//
// openPreview() is async. The preview Dialog is opened immediately
// (setPreviewOpen(true)) before the file fetch completes. If the admin closes
// the dialog via Escape while the fetch is still in-flight, the component must:
//   • Not fire a "Preview failed" toast — the fetch may still succeed, and
//     closing the dialog is not an error condition.
//   • Not crash or emit React "state update on unmounted component" warnings
//     if the parent removes the component while the fetch is pending.

describe("SupportingDocsQuickPopover — preview dialog closed mid-load (race condition)", () => {
  // ── Test 5 ──────────────────────────────────────────────────────────────────
  // Admin opens the popover, loads docs, clicks the Eye button on a row →
  // dialog opens and shows the spinner → admin presses Escape to dismiss the
  // dialog → file fetch eventually resolves successfully.
  // Expected: no "Preview failed" toast fires (the fetch succeeded; closing
  // the dialog is not an error).
  it("does not fire a toast when the dialog is closed via Escape and the file fetch later succeeds", async () => {
    let resolveFile!: (r: Response) => void;
    const hangingFile = new Promise<Response>((res) => (resolveFile = res));

    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      if (String(url).includes("/file")) return hangingFile;
      return Promise.resolve(jsonOk([PENDING_DOC]));
    });

    await openPopoverAndLoadDocs(fetchMock);

    // Click the Eye button — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`popover-user-doc-preview-${PENDING_DOC.id}`),
    );

    // The preview Dialog should open showing the loading indicator.
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
            fileData: "data:image/png;base64,iVBOR=",
            fileType: "image/png",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // The success branch of openPreview() never calls toast(). Closing the
    // dialog before the fetch resolves must not produce an error toast.
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preview failed" }),
    );
  });

  // ── Test 5b ─────────────────────────────────────────────────────────────────
  // Admin opens the popover, loads docs, clicks the Eye button → dialog opens
  // showing the spinner → admin presses Escape to dismiss → file fetch later
  // REJECTS with a network error.
  // Expected: no "Preview failed" toast fires — the admin already intentionally
  // closed the dialog, so surfacing a toast is surprising and confusing.
  it("does not fire a toast when the dialog is closed via Escape and the file fetch later fails", async () => {
    let rejectFile!: (reason: Error) => void;
    const hangingFile = new Promise<Response>((_res, rej) => (rejectFile = rej));

    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      if (String(url).includes("/file")) return hangingFile;
      return Promise.resolve(jsonOk([PENDING_DOC]));
    });

    await openPopoverAndLoadDocs(fetchMock);

    fireEvent.click(
      screen.getByTestId(`popover-user-doc-preview-${PENDING_DOC.id}`),
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

  // ── Test 5c ─────────────────────────────────────────────────────────────────
  // Admin opens the popover, loads docs, clicks the Eye button → dialog opens
  // showing the spinner → admin presses Escape to dismiss → file fetch later
  // RESOLVES with a non-OK HTTP status (500).
  // Expected: no "Preview failed" toast fires — the admin already intentionally
  // closed the dialog, so surfacing a toast is surprising and confusing.
  it("does not fire a toast when the dialog is closed via Escape and the file fetch later resolves with HTTP 500", async () => {
    let resolveFile!: (r: Response) => void;
    const hangingFile = new Promise<Response>((res) => (resolveFile = res));

    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      if (String(url).includes("/file")) return hangingFile;
      return Promise.resolve(jsonOk([PENDING_DOC]));
    });

    await openPopoverAndLoadDocs(fetchMock);

    // Click the Eye button — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`popover-user-doc-preview-${PENDING_DOC.id}`),
    );

    // The preview Dialog should open showing the loading indicator.
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

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  // The parent component removes SupportingDocsQuickPopover from the tree
  // while the file fetch is in-flight. The async continuation still runs
  // (the JS closure keeps the promise chain alive). The component must not
  // emit React "state update on unmounted component" console.error warnings,
  // and must not fire an error toast (the fetch succeeds — nothing went wrong).
  it("does not emit React state-update warnings or an error toast when unmounted while the file fetch is in-flight", async () => {
    let resolveFile!: (r: Response) => void;
    const hangingFile = new Promise<Response>((res) => (resolveFile = res));

    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      if (String(url).includes("/file")) return hangingFile;
      return Promise.resolve(jsonOk([PENDING_DOC]));
    });

    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    (globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const { unmount } = render(
      <SupportingDocsQuickPopover
        caseId="case-popover"
        count={1}
        authToken="admin-token-xyz"
      />,
    );

    // Open the popover.
    fireEvent.click(
      screen.getByTestId("badge-user-doc-pending-case-popover"),
    );

    await waitFor(() =>
      expect(
        screen.getByTestId(`popover-user-doc-row-${PENDING_DOC.id}`),
      ).toBeTruthy(),
    );

    // Start the preview fetch (hangs).
    fireEvent.click(
      screen.getByTestId(`popover-user-doc-preview-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    // Unmount the component while the fetch is still in-flight.
    unmount();

    // Resolve the fetch after unmount.
    await act(async () => {
      resolveFile(
        new Response(
          JSON.stringify({
            fileName: PENDING_DOC.fileName,
            fileData: "data:image/png;base64,iVBOR=",
            fileType: "image/png",
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

    // The success branch of openPreview() never calls toast().
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preview failed" }),
    );

    consoleSpy.mockRestore();
  });
});
