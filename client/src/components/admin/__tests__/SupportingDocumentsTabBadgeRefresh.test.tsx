// @vitest-environment jsdom
//
// Task #427 — Verify that SupportingDocumentsTab calls loadUserDocPendingCounts
// after an admin approves or rejects a document from the cross-case inbox.
//
// Task #435 — Protect badge counts from going stale on transient network
// failures / retries. loadUserDocPendingCounts() is now called in the finally
// block of act(), so counts are refreshed regardless of PATCH outcome.
//
// Contract under test:
//   When the admin clicks Approve (or Reject → Confirm rejection),
//   SupportingDocumentsTab must call loadUserDocPendingCounts() via
//   useAdminDashboard() unconditionally (success AND failure) so the per-case
//   badge counts never go stale due to a retry that silently succeeded on the
//   server while the client had already rolled back the optimistic update.

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
      userDocPendingCounts: { "case-abc": 1 },
      loadUserDocPendingCounts: loadUserDocPendingCountsMock,
    }),
  };
});

const PENDING_DOC = {
  id: 42,
  caseId: "case-abc",
  fileName: "kyc-scan.pdf",
  fileType: "application/pdf",
  fileSize: "12 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 60_000).toISOString(),
};

function okJson(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  loadUserDocPendingCountsMock.mockClear();

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
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

import { SupportingDocumentsTab } from "../tabs/SupportingDocumentsTab";

describe("SupportingDocumentsTab – badge-refresh contract (Tasks #427, #435)", () => {
  it("calls loadUserDocPendingCounts after an admin approves a document", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ ...PENDING_DOC, status: "approved" });
        }
        return okJson([PENDING_DOC]);
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("kyc-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-approve-supporting-doc-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  it("calls loadUserDocPendingCounts after an admin confirms rejection of a document", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ ...PENDING_DOC, status: "rejected" });
        }
        return okJson([PENDING_DOC]);
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("kyc-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-reject-supporting-doc-${PENDING_DOC.id}`),
    );

    const confirmBtn = await screen.findByTestId(
      `button-confirm-reject-supporting-doc-${PENDING_DOC.id}`,
    );
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  it("calls loadUserDocPendingCounts even when the PATCH request fails (finally-block guard)", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ error: "Forbidden" }, 403);
        }
        return okJson([PENDING_DOC]);
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("kyc-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-approve-supporting-doc-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  it("rolls back the optimistic UI update and calls loadUserDocPendingCounts exactly once when PATCH returns 500", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ error: "Internal Server Error" }, 500);
        }
        return okJson([PENDING_DOC]);
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("kyc-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-approve-supporting-doc-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);

    const statusBadges = screen
      .getAllByText(/^uploaded$/)
      .filter((el) => el.className.includes("capitalize"));
    expect(statusBadges.length).toBeGreaterThan(0);
  });

  it("refreshes badge counts after a transient failure followed by a successful retry", async () => {
    let callCount = 0;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          callCount += 1;
          if (callCount === 1) {
            return Promise.reject(new Error("Network error"));
          }
          return okJson({ ...PENDING_DOC, status: "approved" });
        }
        return okJson([PENDING_DOC]);
      });

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByText("kyc-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId(`button-approve-supporting-doc-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    loadUserDocPendingCountsMock.mockClear();

    fireEvent.click(
      screen.getByTestId(`button-approve-supporting-doc-${PENDING_DOC.id}`),
    );

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });
});
