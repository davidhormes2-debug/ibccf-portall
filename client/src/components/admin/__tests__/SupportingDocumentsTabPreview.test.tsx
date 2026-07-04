// @vitest-environment jsdom
//
// Task #562 — Verify that SupportingDocumentsTab renders a preview button on
// every row and that clicking it opens the preview dialog with the correct
// element for images (<img>) and PDFs (<iframe>).
//
// The preview flow (Task #496):
//   1. Admin clicks the Eye button — data-testid="button-preview-supporting-doc-<id>"
//   2. GET /api/admin/user-documents/:id/file is fetched with the auth header
//   3. Dialog opens; fileType determines whether an <iframe> or <img> is shown

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
      userDocPendingCounts: {},
      loadUserDocPendingCounts: loadUserDocPendingCountsMock,
    }),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PDF_DOC = {
  id: 101,
  caseId: "case-pdf",
  fileName: "identity.pdf",
  fileType: "application/pdf",
  fileSize: "25 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 30_000).toISOString(),
};

const IMAGE_DOC = {
  id: 202,
  caseId: "case-img",
  fileName: "bank-statement.png",
  fileType: "image/png",
  fileSize: "88 KB",
  category: "source_of_funds",
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
  loadUserDocPendingCountsMock.mockClear();
  setupDomStubs();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Deferred import (after mocks are hoisted) ─────────────────────────────────

import { SupportingDocumentsTab } from "../tabs/SupportingDocumentsTab";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SupportingDocumentsTab – preview button (Task #562)", () => {
  it("renders a preview button for each row", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PDF_DOC, IMAGE_DOC]));

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    expect(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`button-preview-supporting-doc-${IMAGE_DOC.id}`),
    ).toBeTruthy();
  });

  it("opens the preview dialog when the preview button is clicked", async () => {
    const PDF_DATA = "data:application/pdf;base64,AAAA";

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes(`/user-documents/${PDF_DOC.id}/file`)) {
          return Promise.resolve(
            jsonOk({
              fileName: PDF_DOC.fileName,
              fileType: PDF_DOC.fileType,
              fileData: PDF_DATA,
            }),
          );
        }
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    );

    // The dialog opens — a <dialog> / [role="dialog"] element must appear.
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeTruthy(),
    );
  });

  it("renders an <iframe> for PDF file types inside the preview dialog", async () => {
    const PDF_DATA = "data:application/pdf;base64,BBBB";

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes(`/user-documents/${PDF_DOC.id}/file`)) {
          return Promise.resolve(
            jsonOk({
              fileName: PDF_DOC.fileName,
              fileType: PDF_DOC.fileType,
              fileData: PDF_DATA,
            }),
          );
        }
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    );

    // An <iframe> must be present (not an <img>) for PDFs.
    // NOTE: the table row also has a <p title={doc.fileName}>, so we cannot
    // use findByTitle here — query the DOM directly for the iframe element.
    const iframe = await waitFor(() => {
      const el = document.querySelector("iframe");
      if (!el) throw new Error("iframe not found");
      return el;
    });
    expect(iframe.tagName.toLowerCase()).toBe("iframe");
    expect(iframe.src).toContain("application/pdf");
  });

  it("renders an <img> for image file types inside the preview dialog", async () => {
    const IMG_DATA = "data:image/png;base64,CCCC";

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes(`/user-documents/${IMAGE_DOC.id}/file`)) {
          return Promise.resolve(
            jsonOk({
              fileName: IMAGE_DOC.fileName,
              fileType: IMAGE_DOC.fileType,
              fileData: IMG_DATA,
            }),
          );
        }
        return Promise.resolve(jsonOk([IMAGE_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("bank-statement.png")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${IMAGE_DOC.id}`),
    );

    // An <img> must be present (not an <iframe>) for image types.
    const img = await screen.findByAltText(IMAGE_DOC.fileName);
    expect(img.tagName.toLowerCase()).toBe("img");
    expect((img as HTMLImageElement).src).toContain("image/png");
  });

  it("fetches from /api/admin/user-documents/:id/file (not /api/user-documents)", async () => {
    const capturedUrls: string[] = [];
    const PDF_DATA = "data:application/pdf;base64,DDDD";

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        capturedUrls.push(String(url));
        const urlStr = String(url);
        if (urlStr.includes("/user-documents/") && urlStr.includes("/file")) {
          return Promise.resolve(
            jsonOk({
              fileName: PDF_DOC.fileName,
              fileType: PDF_DOC.fileType,
              fileData: PDF_DATA,
            }),
          );
        }
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    );

    // Wait for the iframe to appear (confirms the file fetch completed).
    await waitFor(() => {
      if (!document.querySelector("iframe")) throw new Error("iframe not found");
    });

    // Confirm the correct admin-prefixed URL was used (Task #496 fix).
    const fileUrl = capturedUrls.find(
      (u) => u.includes("/user-documents/") && u.includes("/file"),
    );
    expect(fileUrl).toBeDefined();
    expect(fileUrl).toContain(`/api/admin/user-documents/${PDF_DOC.id}/file`);
    expect(fileUrl).not.toContain("/api/user-documents/");
  });

  it("shows the null-fileData fallback and renders no iframe or img", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes(`/user-documents/${PDF_DOC.id}/file`)) {
          return Promise.resolve(
            jsonOk({
              fileName: PDF_DOC.fileName,
              fileType: PDF_DOC.fileType,
              fileData: null,
            }),
          );
        }
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    );

    // The dialog must open and show the fallback message.
    await waitFor(() =>
      expect(
        screen.getByText("No file data available for preview."),
      ).toBeTruthy(),
    );

    // Neither an <iframe> nor an <img> should be present in this case.
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("sends the Authorization header with the auth token when fetching the file", async () => {
    const capturedHeaders: Record<string, string>[] = [];
    const PDF_DATA = "data:application/pdf;base64,EEEE";

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown, opts?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes("/user-documents/") && urlStr.includes("/file")) {
          capturedHeaders.push(
            (opts?.headers as Record<string, string>) ?? {},
          );
          return Promise.resolve(
            jsonOk({
              fileName: PDF_DOC.fileName,
              fileType: PDF_DOC.fileType,
              fileData: PDF_DATA,
            }),
          );
        }
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    );

    // Wait for the iframe to appear (confirms the file fetch completed).
    await waitFor(() => {
      if (!document.querySelector("iframe")) throw new Error("iframe not found");
    });

    expect(capturedHeaders.length).toBeGreaterThan(0);
    const authHeader = capturedHeaders[0]["Authorization"];
    expect(authHeader).toBe("Bearer test-token");
  });

  it("closes the dialog and fires a destructive toast when the file fetch rejects (network error)", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes(`/user-documents/${PDF_DOC.id}/file`)) {
          return Promise.reject(new Error("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    );

    // The dialog must NOT remain open after the network error.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );

    // A destructive toast must have been fired.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );

    // Neither an <iframe> nor an <img> should be rendered.
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("fires a destructive toast and renders no iframe or img when the 200 response has a non-JSON body", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes(`/user-documents/${PDF_DOC.id}/file`)) {
          // HTTP 200 but body is plain text — res.json() will throw a SyntaxError
          return Promise.resolve(
            new Response("<html><body>Bad Gateway</body></html>", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            }) as unknown as Response,
          );
        }
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    );

    // A destructive toast must be fired because res.json() threw.
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      ),
    );

    // The dialog must be closed and no preview element rendered.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("closes the dialog and fires a destructive toast when the file fetch returns HTTP 500", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes(`/user-documents/${PDF_DOC.id}/file`)) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "Internal Server Error" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }) as unknown as Response,
          );
        }
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    );

    // The dialog must NOT remain open after the error.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );

    // A destructive toast must have been fired.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  // ── Dismissed-dialog + deferred HTTP error ────────────────────────────────
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
        if (String(url).includes("/user-documents/") && String(url).includes("/file"))
          return hangingFile;
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    // Open the preview — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
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

  // ── Dismissed-dialog + deferred network rejection ─────────────────────────
  // Admin opens preview → file fetch hangs → admin closes dialog via Escape →
  // fetch later REJECTS with a network error.
  // Expected: no "Preview failed" toast fires — the admin already dismissed the
  // dialog intentionally, so surfacing a toast is surprising and confusing.
  it("does not fire a toast when the dialog is closed via Escape and the file fetch later rejects with a network error", async () => {
    let rejectFile!: (reason: Error) => void;
    const hangingFile = new Promise<Response>((_res, rej) => (rejectFile = rej));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/user-documents/") && String(url).includes("/file"))
          return hangingFile;
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    // Open the preview — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
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

    // Reject the file fetch with a network error after the dialog is dismissed.
    await act(async () => {
      rejectFile(new Error("Network error"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The admin already closed the dialog — the network rejection arriving after
    // dismiss must not surface a toast.
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preview failed" }),
    );
  });
});

// ── Race condition: parent unmounts Tab while file fetch is in-flight ─────────
//
// openPreview() is async. If the parent component unmounts SupportingDocumentsTab
// while a file fetch is still in-flight, the async continuation still executes
// (JS closures keep the promise chain alive). The component must not:
//   • Emit React "state update on unmounted component" console.error messages.
//   • Fire a "Preview failed" toast — the fetch succeeds; there is nothing to
//     report as an error.

describe("SupportingDocumentsTab — parent unmounts while file fetch is in-flight (race condition)", () => {
  // ── Test 5 ──────────────────────────────────────────────────────────────────
  // Parent unmounts SupportingDocumentsTab while the file fetch is in-flight.
  // The async continuation still executes after unmount. It must not emit React
  // "state update on unmounted component" console.error messages, and it must
  // not fire an error toast (the fetch succeeds — there is nothing to report).
  it("does not emit React state-update warnings or an error toast when the component is unmounted while the file fetch is in-flight", async () => {
    let resolveFile!: (r: Response) => void;
    const hangingFile = new Promise<Response>((res) => (resolveFile = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/user-documents/") && String(url).includes("/file"))
          return hangingFile;
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { unmount } = render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    // Click preview — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    );

    // Confirm the dialog opened and is showing the loading state.
    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    // Unmount the tab while the fetch is still in-flight.
    unmount();

    // Resolve the fetch after unmount with a successful response.
    await act(async () => {
      resolveFile(
        new Response(
          JSON.stringify({
            fileName: PDF_DOC.fileName,
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

  // ── Test 5b ─────────────────────────────────────────────────────────────────
  // Parent unmounts SupportingDocumentsTab while the file fetch is in-flight.
  // The fetch later RESOLVES with a non-OK HTTP status (500).
  // Expected: no "Preview failed" toast fires — the component is gone; surfacing
  // a toast after unmount is surprising and confusing for the admin.
  it("does not fire a toast when the component is unmounted and the file fetch later resolves with HTTP 500", async () => {
    let resolveFile!: (r: Response) => void;
    const hangingFile = new Promise<Response>((res) => (resolveFile = res));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/user-documents/") && String(url).includes("/file"))
          return hangingFile;
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    const { unmount } = render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    // Click preview — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    );

    // Confirm the dialog opened and is showing the loading state.
    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    // Unmount the tab while the fetch is still in-flight.
    unmount();

    // Resolve the fetch after unmount with a non-OK HTTP 500 response.
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

    // The component is already gone — the HTTP error arriving after unmount
    // must not surface a toast.
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preview failed" }),
    );
  });

  // ── Test 5c ─────────────────────────────────────────────────────────────────
  // Parent unmounts SupportingDocumentsTab while the file fetch is in-flight.
  // The fetch later REJECTS with a network error.
  // Expected: no "Preview failed" toast fires — the component is gone; surfacing
  // a toast after unmount is surprising and confusing for the admin.
  it("does not fire a toast when the component is unmounted and the file fetch later rejects with a network error", async () => {
    let rejectFile!: (reason: Error) => void;
    const hangingFile = new Promise<Response>((_res, rej) => (rejectFile = rej));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown) => {
        if (String(url).includes("/user-documents/") && String(url).includes("/file"))
          return hangingFile;
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    const { unmount } = render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    // Click preview — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
    );

    // Confirm the dialog opened and is showing the loading state.
    await waitFor(() =>
      expect(screen.queryByText("Loading file…")).toBeTruthy(),
    );

    // Unmount the tab while the fetch is still in-flight.
    unmount();

    // Reject the fetch with a network error after unmount.
    await act(async () => {
      rejectFile(new Error("Network error"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The component is already gone — the network rejection arriving after
    // unmount must not surface a toast.
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
        const urlStr = String(url);
        if (urlStr.includes("/user-documents/") && urlStr.includes("/file")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                fileName: PDF_DOC.fileName,
                fileData: PDF_DATA,
                fileType: "application/pdf",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
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
        if (String(url).includes("/user-documents/") && String(url).includes("/file"))
          return hangingFile;
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    const { unmount } = render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    // Start the preview — sets previewLoading = true.
    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
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
            fileName: PDF_DOC.fileName,
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
      .mockResolvedValue(jsonOk([PDF_DOC]));

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    // The fresh mount must show no loading spinner — previewLoading starts false.
    expect(screen.queryByText("Loading file…")).toBeNull();
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
        if (String(url).includes("/user-documents/") && String(url).includes("/file")) {
          fileFetchCount += 1;
          if (fileFetchCount === 1) return hangingFirstFile;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                fileName: PDF_DOC.fileName,
                fileData: PDF_DATA,
                fileType: "application/pdf",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(jsonOk([PDF_DOC]));
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("identity.pdf")).toBeTruthy(),
    );

    // Open the preview — starts the hanging file fetch.
    fireEvent.click(
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
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
            fileName: PDF_DOC.fileName,
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
      screen.getByTestId(`button-preview-supporting-doc-${PDF_DOC.id}`),
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
