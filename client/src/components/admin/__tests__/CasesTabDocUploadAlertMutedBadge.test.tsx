// @vitest-environment jsdom
//
// Task #746 — Cover the "MUTED" (doc-upload-alert) badge in CasesTab.
//
// Two contracts verified:
//   1. The `badge-doc-upload-alert-muted-<caseId>` badge renders only for cases
//      whose id is present in `mutedAlertCaseIds`.
//   2. The badge is absent for cases whose id is NOT in that set.

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
  SupportingDocsQuickPopover: ({
    caseId,
    count,
  }: {
    caseId: string;
    count: number;
    authToken: string | null;
    onActioned?: () => void;
  }) => (
    <span data-testid={`badge-user-doc-pending-${caseId}`}>
      {count} NEW UPLOADS
    </span>
  ),
}));

// ── case fixtures ─────────────────────────────────────────────────────────────
const MUTED_CASE_ID = "case-doc-alert-muted";
const UNMUTED_CASE_ID = "case-doc-alert-active";

const CASE_MUTED = {
  id: MUTED_CASE_ID,
  accessCode: "DMUTED1",
  status: "active" as const,
};

const CASE_UNMUTED = {
  id: UNMUTED_CASE_ID,
  accessCode: "DACTIVE2",
  status: "active" as const,
};

// ── mock context builder ──────────────────────────────────────────────────────
// Built from the shared, type-checked factory so adding a new required field to
// AdminDashboardContextValue surfaces a COMPILE error here instead of crashing
// this test at runtime. We only override the handful of values these tests
// actually exercise.
function buildMockContext(): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: [CASE_MUTED, CASE_UNMUTED] as unknown as Case[],
    filteredCases: [CASE_MUTED, CASE_UNMUTED] as unknown as Case[],
    // ← the value under test: only the muted case id is in the set
    mutedAlertCaseIds: new Set<string>([MUTED_CASE_ID]),
  });
}

// ── fetch stub – silences on-mount effects that call admin APIs ───────────────
function notFoundResponse() {
  return Promise.resolve(
    new Response(JSON.stringify({}), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }) as unknown as Response,
  );
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
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
describe("CasesTab – doc-upload-alert muted badge", () => {
  it("renders badge-doc-upload-alert-muted only for the case whose id is in mutedAlertCaseIds", async () => {
    render(<CasesTab />);

    // The muted case must show the badge.
    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-doc-upload-alert-muted-${MUTED_CASE_ID}`),
      ).toBeTruthy(),
    );

    // Confirm the badge text is correct.
    expect(
      screen.getByTestId(`badge-doc-upload-alert-muted-${MUTED_CASE_ID}`)
        .textContent,
    ).toContain("MUTED");
  });

  it("does NOT render badge-doc-upload-alert-muted for a case that is NOT in mutedAlertCaseIds", async () => {
    render(<CasesTab />);

    // Wait for the muted-case row to appear so we know the table has rendered.
    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-doc-upload-alert-muted-${MUTED_CASE_ID}`),
      ).toBeTruthy(),
    );

    // The unmuted case must NOT have the badge.
    expect(
      screen.queryByTestId(`badge-doc-upload-alert-muted-${UNMUTED_CASE_ID}`),
    ).toBeNull();
  });

  it("renders both the row for the muted case and the row for the unmuted case", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(screen.getByTestId(`row-case-${MUTED_CASE_ID}`)).toBeTruthy(),
    );

    // Both rows are present — badge presence differs only by mute state.
    expect(screen.getByTestId(`row-case-${MUTED_CASE_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`row-case-${UNMUTED_CASE_ID}`)).toBeTruthy();

    // Doc-upload-alert muted badge present only for the muted case.
    expect(
      screen.queryByTestId(`badge-doc-upload-alert-muted-${MUTED_CASE_ID}`),
    ).not.toBeNull();
    expect(
      screen.queryByTestId(`badge-doc-upload-alert-muted-${UNMUTED_CASE_ID}`),
    ).toBeNull();
  });
});
