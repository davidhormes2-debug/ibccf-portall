// @vitest-environment jsdom
//
// Task #2406 — the admin Cases tab used to render a <TableRow> for every
// case in the filtered list at once, which froze the tab once the table grew
// into the thousands (see .agents/memory/local-devdb-case-volume.md). The
// fix paginates the rendered rows client-side (CASES_PAGE_SIZE = 50) while
// leaving search/filter/bulk-selection/export operating on the full list.
//
// This mounts the REAL CasesTab with a large in-memory case list (more than
// one page's worth) and asserts:
//   - only one page of rows is ever mounted in the DOM at a time
//   - the "Page X of Y" indicator and Previous/Next controls behave correctly
//   - a selection made on one page survives navigating to another page and back
//   - pagination controls do not render when everything fits on one page
//   - changing the search query resets back to page 1

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import type { Case } from "@/components/admin/shared";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => buildMockContext(),
  };
});

vi.mock("@/components/admin/SupportingDocsQuickPopover", () => ({
  SupportingDocsQuickPopover: ({ caseId, count }: { caseId: string; count: number }) => (
    <span data-testid={`badge-user-doc-pending-${caseId}`}>{count} NEW UPLOADS</span>
  ),
}));

const CASES_PAGE_SIZE = 50;

function buildCases(count: number, prefix = "pag"): Partial<Case>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(4, "0")}`,
    accessCode: `${prefix.toUpperCase()}-${String(i).padStart(4, "0")}`,
    status: "active" as const,
    isDisabled: false,
  }));
}

let mockCases: Partial<Case>[] = [];
let mockSearchQuery = "";

function buildMockContext(): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: mockCases as unknown as Case[],
    filteredCases: mockCases as unknown as Case[],
    searchQuery: mockSearchQuery,
    setSearchQuery: vi.fn(),
  });
}

function notFoundResponse() {
  return Promise.resolve(
    new Response(JSON.stringify({}), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }) as unknown as Response,
  );
}

// Task #2443 — CasesTab now fetches its main page of rows from
// `/api/cases?page=...` (server-side pagination) instead of slicing the
// full `filteredCases` array from context. This mock stands in for that
// endpoint so these pre-existing pagination tests (originally written for
// the client-only slicing behavior) keep exercising the same UI contract:
// it paginates `mockCases` itself, exactly like the real server route
// would, so "Page X of Y" / row counts / navigation still behave the same.
function mockCasesEndpoint(url: string) {
  const parsed = new URL(url, "http://localhost");
  if (parsed.pathname !== "/api/cases" || !parsed.searchParams.has("page")) {
    return notFoundResponse();
  }
  const page = Math.max(1, parseInt(parsed.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.max(1, parseInt(parsed.searchParams.get("pageSize") ?? "50", 10) || 50);
  const search = parsed.searchParams.get("search")?.trim().toLowerCase();
  const filtered = search
    ? mockCases.filter((c) =>
        (c.accessCode ?? "").toLowerCase().includes(search) ||
        (c.id ?? "").toLowerCase().includes(search),
      )
    : mockCases;
  const start = (page - 1) * pageSize;
  const pageCases = filtered.slice(start, start + pageSize);
  return Promise.resolve(
    new Response(JSON.stringify({ cases: pageCases, total: filtered.length, page, pageSize }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }) as unknown as Response,
  );
}

beforeEach(() => {
  mockCases = [];
  mockSearchQuery = "";

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

  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    _: new Map<string, string>(),
    getItem(k: string) {
      return (this as { _: Map<string, string> })._.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      (this as { _: Map<string, string> })._.set(k, String(v));
    },
    removeItem(k: string) {
      (this as { _: Map<string, string> })._.delete(k);
    },
    clear() {
      (this as { _: Map<string, string> })._.clear();
    },
  };
  (
    globalThis as unknown as {
      sessionStorage: { setItem: (k: string, v: string) => void };
    }
  ).sessionStorage.setItem("adminToken", "test-token");

  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
    .fn()
    .mockImplementation((url: string) => mockCasesEndpoint(url));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

import { CasesTab } from "../tabs/CasesTab";

describe("CasesTab – client-side pagination (Task #2406)", () => {
  it("mounts only one page's worth of rows when the list exceeds the page size", async () => {
    mockCases = buildCases(CASES_PAGE_SIZE * 2 + 5); // 105 cases -> 3 pages

    render(<CasesTab />);

    await waitFor(() => {
      const rows = screen.getAllByTestId(/^row-case-/);
      expect(rows.length).toBe(CASES_PAGE_SIZE);
    }, { timeout: 10000 });

    expect(screen.getByTestId("text-cases-page-info").textContent).toMatch(
      /Page 1 of 3/,
    );
  }, 15000);

  it("does not render pagination controls when everything fits on one page", async () => {
    mockCases = buildCases(10);

    render(<CasesTab />);

    await waitFor(() => {
      expect(screen.getAllByTestId(/^row-case-/).length).toBe(10);
    });

    expect(screen.queryByTestId("text-cases-page-info")).toBeNull();
    expect(screen.queryByTestId("button-cases-next-page")).toBeNull();
  });

  it("navigates between pages and unmounts the previous page's rows", async () => {
    mockCases = buildCases(CASES_PAGE_SIZE + 5); // 55 cases -> 2 pages

    render(<CasesTab />);

    await waitFor(() => {
      expect(screen.getAllByTestId(/^row-case-/).length).toBe(CASES_PAGE_SIZE);
    }, { timeout: 15000 });

    const firstPageRowId = "row-case-pag-0000";
    expect(screen.getByTestId(firstPageRowId)).toBeInTheDocument();

    const prevButton = screen.getByTestId("button-cases-prev-page");
    const nextButton = screen.getByTestId("button-cases-next-page");
    expect(prevButton).toBeDisabled();
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByTestId("text-cases-page-info").textContent).toMatch(
        /Page 2 of 2/,
      );
    }, { timeout: 15000 });
    expect(screen.queryByTestId(firstPageRowId)).toBeNull();
    expect(screen.getAllByTestId(/^row-case-/).length).toBe(5);
    expect(nextButton).toBeDisabled();

    fireEvent.click(prevButton);

    await waitFor(() => {
      expect(screen.getByTestId("text-cases-page-info").textContent).toMatch(
        /Page 1 of 2/,
      );
    }, { timeout: 15000 });
    expect(screen.getByTestId(firstPageRowId)).toBeInTheDocument();
  }, 40000);

  it("preserves a row selection made on one page after navigating away and back", async () => {
    mockCases = buildCases(CASES_PAGE_SIZE + 5); // 55 cases -> 2 pages

    render(<CasesTab />);

    await waitFor(() => {
      expect(screen.getAllByTestId(/^row-case-/).length).toBe(CASES_PAGE_SIZE);
    }, { timeout: 15000 });

    const checkbox = screen.getByTestId(
      "checkbox-select-pag-0000",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(screen.getByTestId("button-cases-next-page"));
    await waitFor(() => {
      expect(screen.getByTestId("text-cases-page-info").textContent).toMatch(
        /Page 2 of 2/,
      );
    }, { timeout: 15000 });
    expect(screen.queryByTestId("checkbox-select-pag-0000")).toBeNull();

    fireEvent.click(screen.getByTestId("button-cases-prev-page"));
    await waitFor(() => {
      expect(screen.getByTestId("text-cases-page-info").textContent).toMatch(
        /Page 1 of 2/,
      );
    }, { timeout: 15000 });

    const checkboxAgain = screen.getByTestId(
      "checkbox-select-pag-0000",
    ) as HTMLInputElement;
    expect(checkboxAgain.checked).toBe(true);
  }, 40000);

  it("resets to page 1 when the filtered case list narrows (e.g. a new search)", async () => {
    // 55 base cases (2 pages) plus 3 cases whose access code carries a
    // unique marker substring, so a search for that marker narrows the
    // server-side result set down to exactly those 3 regardless of the
    // base list's contents.
    mockCases = [
      ...buildCases(CASES_PAGE_SIZE + 5),
      ...buildCases(3, "zzzmatch"),
    ];

    const { rerender } = render(<CasesTab />);

    await waitFor(() => {
      expect(screen.getAllByTestId(/^row-case-/).length).toBe(CASES_PAGE_SIZE);
    }, { timeout: 15000 });

    fireEvent.click(screen.getByTestId("button-cases-next-page"));
    await waitFor(() => {
      expect(screen.getByTestId("text-cases-page-info").textContent).toMatch(
        /Page 2 of 2/,
      );
    }, { timeout: 15000 });

    // Simulate a search narrowing the result set on the SAME mounted
    // instance — this is the real trigger for server-side narrowing
    // (debouncedSearchQuery -> a new `/api/cases?search=...` fetch with a
    // smaller `total`), unlike the old client-only-slicing model this test
    // predates. Also exercises the casesPage clamp-back-to-1 effect.
    mockSearchQuery = "zzzmatch";
    rerender(<CasesTab />);

    await waitFor(() => {
      expect(screen.queryByTestId("text-cases-page-info")).toBeNull();
      expect(screen.getAllByTestId(/^row-case-/).length).toBe(3);
    }, { timeout: 15000 });
  }, 40000);
});
