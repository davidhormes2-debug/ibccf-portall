// @vitest-environment jsdom
//
// Task #455 — Remember the admin's document selections when switching between
// filter views.
//
// Contracts under test:
//   1. Selections survive client-side search / text filter changes (no reload).
//   2. On server-reload (statusFilter or caseIdFilter change), selected IDs
//      that are still present in the new result set are preserved.
//   3. Selected IDs absent from the new result set are silently dropped.

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
      userDocPendingCounts: {},
      loadUserDocPendingCounts: loadUserDocPendingCountsMock,
    }),
  };
});

function makeDoc(
  id: number,
  fileName: string,
  caseId = "case-abc",
  status = "uploaded",
) {
  return {
    id,
    caseId,
    fileName,
    fileType: "application/pdf",
    fileSize: "10 KB",
    category: "kyc_id",
    description: null,
    status,
    adminNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: new Date(Date.now() - id * 1000).toISOString(),
  };
}

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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  loadUserDocPendingCountsMock.mockClear();
  setupDomStubs();
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom */
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

import { SupportingDocumentsTab } from "../tabs/SupportingDocumentsTab";

const DOC_A = makeDoc(10, "passport.pdf");
const DOC_B = makeDoc(11, "bank-statement.pdf");
const DOC_C = makeDoc(12, "utility-bill.pdf");

describe("SupportingDocumentsTab – selection persistence (Task #455)", () => {
  it("selections survive a client-side search filter change (no server reload)", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([DOC_A, DOC_B, DOC_C]));

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-10")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("checkbox-select-all-supporting-docs"));

    await waitFor(() =>
      expect(screen.getByTestId("toolbar-selection-supporting-docs")).toBeTruthy(),
    );

    const searchInput = screen.getByTestId("input-filter-supporting-search");
    fireEvent.change(searchInput, { target: { value: "passport" } });

    await waitFor(() =>
      expect(screen.queryByTestId("row-supporting-doc-11")).toBeNull(),
    );

    expect(screen.getByTestId("toolbar-selection-supporting-docs")).toBeTruthy();
  });

  it("selections that survive a status-filter reload are preserved (IDs still returned)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([DOC_A, DOC_B]))
      .mockResolvedValue(jsonOk([DOC_A, DOC_B, DOC_C]));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-10")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`row-supporting-doc-10`));
    const checkbox10 = screen
      .getByTestId("row-supporting-doc-10")
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox10);

    await waitFor(() =>
      expect(
        screen.getByTestId("toolbar-selection-supporting-docs"),
      ).toBeTruthy(),
    );

    const statusSelect = screen.getByTestId("select-filter-supporting-status");
    fireEvent.click(statusSelect);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const allOption = await screen.findByText("All statuses");
    fireEvent.click(allOption);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-12")).toBeTruthy(),
    );

    expect(
      screen.getByTestId("toolbar-selection-supporting-docs"),
    ).toBeTruthy();
  });

  it("selected IDs absent from the new result set are dropped after server reload", async () => {
    // Mount fires a single GET (combined statusFilter+caseIdFilter effect,
    // Task #882); guard it with [DOC_A, DOC_B] so both docs are visible after
    // mount, then return the reloaded set on the subsequent filter-triggered
    // reload.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([DOC_A, DOC_B]))
      .mockResolvedValue(jsonOk([DOC_B, DOC_C]));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-10")).toBeTruthy(),
    );

    const checkbox10 = screen
      .getByTestId("row-supporting-doc-10")
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox10);

    await waitFor(() =>
      expect(
        screen.getByTestId("toolbar-selection-supporting-docs"),
      ).toBeTruthy(),
    );

    // Use a caseId value that matches the selected doc ("case-abc") so the
    // debounce's hasOverlap check passes and the reload fires immediately
    // instead of showing the zero-overlap confirmation dialog (Task #508).
    const caseIdInput = screen.getByTestId("filter-supporting-docs-case-id");
    fireEvent.change(caseIdInput, { target: { value: "case-abc" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    await waitFor(() =>
      expect(screen.queryByTestId("row-supporting-doc-10")).toBeNull(),
    );

    expect(
      screen.queryByTestId("toolbar-selection-supporting-docs"),
    ).toBeNull();
  });

  it("selections that overlap with the new result set are kept; others are dropped", async () => {
    // Absorb the single mount fetch (combined filter effect, Task #882), then
    // return the reloaded set on the subsequent filter-triggered reload.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([DOC_A, DOC_B]))
      .mockResolvedValue(jsonOk([DOC_A, DOC_C]));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-10")).toBeTruthy(),
    );

    fireEvent.click(
      screen
        .getByTestId("row-supporting-doc-10")
        .querySelector('input[type="checkbox"]') as HTMLInputElement,
    );
    fireEvent.click(
      screen
        .getByTestId("row-supporting-doc-11")
        .querySelector('input[type="checkbox"]') as HTMLInputElement,
    );

    await waitFor(() => {
      const toolbar = screen.getByTestId("toolbar-selection-supporting-docs");
      expect(toolbar.textContent).toContain("2 documents selected");
    });

    // "case-abc" matches the selected docs' caseId so the reload fires
    // immediately (overlap check passes — no zero-overlap confirmation dialog).
    const caseIdInput = screen.getByTestId("filter-supporting-docs-case-id");
    fireEvent.change(caseIdInput, { target: { value: "case-abc" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-12")).toBeTruthy(),
    );

    const toolbar = screen.getByTestId("toolbar-selection-supporting-docs");
    expect(toolbar.textContent).toContain("1 document selected");
  });
});
