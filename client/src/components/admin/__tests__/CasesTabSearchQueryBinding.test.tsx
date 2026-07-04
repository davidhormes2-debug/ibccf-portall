// @vitest-environment jsdom
//
// Behavioral coverage for the real Cases search box actually rendering the
// context-supplied `searchQuery` value (Task #2399).
//
// AdminDashboard.caseIdDeepLink.test.tsx (Task #2391) proves AdminDashboard
// computes and passes the right fallback searchQuery value into context, but
// it replaces CasesTab with a stub that reads `ctx.searchQuery` directly —
// it never touches the real search `<input>` in CasesTab.tsx. That means a
// regression where CasesTab stops binding its `<input>`'s `value` to
// `context.searchQuery` (e.g. a refactor that switches to local component
// state) would silently stop showing the pre-filled deep-link value on
// screen, while every existing test still passes.
//
// This test mounts the REAL CasesTab under a real AdminDashboardContext
// value (not a stubbed CasesTab) and asserts the actual
// `input-search-cases` element's value reflects a pre-filled `searchQuery`.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import type { Case } from "@/components/admin/shared";

// ── mock use-toast so shadcn toasts don't throw ──────────────────────────────
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── mock AdminDashboardContext – we control the values under test ─────────────
vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => buildMockContext(),
  };
});

// ── stub SupportingDocsQuickPopover – the real one opens Radix + fetch ────────
vi.mock("@/components/admin/SupportingDocsQuickPopover", () => ({
  SupportingDocsQuickPopover: ({ caseId, count }: { caseId: string; count: number }) => (
    <span data-testid={`badge-user-doc-pending-${caseId}`}>{count} NEW UPLOADS</span>
  ),
}));

// ── case fixture — a single case is enough to mount the real table ───────────
const SEEDED_CASE: Partial<Case> = {
  id: "case-search-binding",
  accessCode: "SEARCH1",
  status: "active" as const,
  isDisabled: false,
};

let mockSearchQuery = "";

function buildMockContext(): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: [SEEDED_CASE] as unknown as Case[],
    filteredCases: [SEEDED_CASE] as unknown as Case[],
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

beforeEach(() => {
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
    .mockImplementation(notFoundResponse);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── import under test (after all mocks are declared) ─────────────────────────
import { CasesTab } from "../tabs/CasesTab";

// ─────────────────────────────────────────────────────────────────────────────
describe("CasesTab – real search input reflects context searchQuery", () => {
  it("renders the pre-filled deep-link value in the actual search input", async () => {
    mockSearchQuery = "does-not-exist";

    render(<CasesTab />);

    await waitFor(() => {
      const input = screen.getByTestId(
        "input-search-cases",
      ) as HTMLInputElement;
      expect(input.value).toBe("does-not-exist");
    });
  });

  it("renders an empty search input when context searchQuery is empty", async () => {
    mockSearchQuery = "";

    render(<CasesTab />);

    await waitFor(() => {
      const input = screen.getByTestId(
        "input-search-cases",
      ) as HTMLInputElement;
      expect(input.value).toBe("");
    });
  });

  it("reflects an updated context searchQuery after a rerender (e.g. a new deep-link fallback)", async () => {
    mockSearchQuery = "ABC123";
    const { rerender } = render(<CasesTab />);

    await waitFor(() => {
      const input = screen.getByTestId(
        "input-search-cases",
      ) as HTMLInputElement;
      expect(input.value).toBe("ABC123");
    });

    mockSearchQuery = "XYZ789";
    rerender(<CasesTab />);

    await waitFor(() => {
      const input = screen.getByTestId(
        "input-search-cases",
      ) as HTMLInputElement;
      expect(input.value).toBe("XYZ789");
    });
  });
});
