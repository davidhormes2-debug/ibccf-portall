// @vitest-environment jsdom
//
// Task #424 — Verify that SupportingDocumentsPanel calls onActioned after an
// admin approves or rejects a document from inside the case-detail dialog.
//
// Contract under test:
//   When the admin clicks Approve (or Reject), SupportingDocumentsPanel must
//   invoke its onActioned prop so the caller (AdminDashboard) can refresh the
//   badge count without waiting for the 5-second poll interval.
//
//   Per the finally-block badge-refresh contract (Task #439), the single-doc
//   act() path fires onActioned in its `finally` block — so it runs after both
//   a successful AND a failed PATCH. The earlier "must not fire on failure"
//   expectation was superseded by that contract; the failure case below now
//   pins the finally-block behaviour (it is also covered by
//   BulkDocumentActions.test.tsx's Task #439 suite).

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

const PENDING_DOC = {
  id: 42,
  caseId: "case-abc",
  fileName: "id-scan.pdf",
  fileType: "application/pdf",
  fileSize: "8 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 120_000).toISOString(),
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

import { SupportingDocumentsPanel } from "../SupportingDocumentsPanel";

describe("SupportingDocumentsPanel – onActioned wiring", () => {
  it("calls onActioned after an admin approves a document from the detail dialog", async () => {
    const onActioned = vi.fn();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ ...PENDING_DOC, status: "approved" });
        }
        return okJson([PENDING_DOC]);
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("id-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTitle("Review"));

    const approveBtn = await screen.findByRole("button", { name: /approve/i });
    fireEvent.click(approveBtn);

    await waitFor(() =>
      expect(onActioned).toHaveBeenCalledTimes(1),
    );
  });

  it("calls onActioned after an admin rejects a document from the detail dialog", async () => {
    const onActioned = vi.fn();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ ...PENDING_DOC, status: "rejected" });
        }
        return okJson([PENDING_DOC]);
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("id-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTitle("Review"));

    const rejectBtn = await screen.findByRole("button", { name: /reject/i });
    fireEvent.click(rejectBtn);

    await waitFor(() =>
      expect(onActioned).toHaveBeenCalledTimes(1),
    );
  });

  it("still calls onActioned when the PATCH request fails (finally-block contract)", async () => {
    const onActioned = vi.fn();

    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return okJson({ error: "Forbidden" }, 403);
        }
        return okJson([PENDING_DOC]);
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("id-scan.pdf")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTitle("Review"));

    const approveBtn = await screen.findByRole("button", { name: /approve/i });
    fireEvent.click(approveBtn);

    // act() fires onActioned in its `finally` block, so the badge count is
    // refreshed even when the PATCH is rejected by the server (Task #439).
    await waitFor(() =>
      expect(onActioned).toHaveBeenCalledTimes(1),
    );
  });
});
