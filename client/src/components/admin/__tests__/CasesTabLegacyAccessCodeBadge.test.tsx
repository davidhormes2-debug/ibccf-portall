// @vitest-environment jsdom
//
// Task #2346 — Cover the "Legacy" access-code badge in CasesTab.
//
// Contracts verified:
//   1. The `badge-legacy-access-code-<caseId>` badge renders for a case
//      whose accessCode contains a letter (doesn't match /^[0-9]+$/).
//   2. The badge is absent for a case whose accessCode is digits-only.
//   3. The badge exposes a `title` explaining the legacy format and the
//      regenerate flow.

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
  SupportingDocsQuickPopover: () => null,
}));

const LEGACY_CASE_ID = "case-legacy-code";
const MODERN_CASE_ID = "case-modern-code";

const CASE_LEGACY = {
  id: LEGACY_CASE_ID,
  accessCode: "ABC123DEF456",
  status: "active" as const,
};

const CASE_MODERN = {
  id: MODERN_CASE_ID,
  accessCode: "123456789012",
  status: "active" as const,
};

function buildMockContext(): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: [CASE_LEGACY, CASE_MODERN] as unknown as Case[],
    filteredCases: [CASE_LEGACY, CASE_MODERN] as unknown as Case[],
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

import { CasesTab } from "../tabs/CasesTab";

describe("CasesTab – legacy access-code badge", () => {
  it("renders the badge for a case whose access code contains letters", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-legacy-access-code-${LEGACY_CASE_ID}`),
      ).toBeTruthy(),
    );

    const badge = screen.getByTestId(`badge-legacy-access-code-${LEGACY_CASE_ID}`);
    expect(badge.textContent).toContain("Legacy");
    expect(badge.getAttribute("title")).toMatch(/legacy-format access code/i);
    expect(badge.getAttribute("title")).toMatch(/rotate access code/i);
  });

  it("does NOT render the badge for a case with a digits-only access code", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-legacy-access-code-${LEGACY_CASE_ID}`),
      ).toBeTruthy(),
    );

    expect(
      screen.queryByTestId(`badge-legacy-access-code-${MODERN_CASE_ID}`),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #2380 — Let admins filter/count cases still using legacy access codes.
describe("CasesTab – legacy access-code KPI + filter", () => {
  it("shows a legacy-access-code KPI card with the correct count", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(screen.getByTestId("kpi-legacy_access_codes")).toBeTruthy(),
    );
    expect(screen.getByTestId("kpi-legacy_access_codes").textContent).toContain("1");
  });

  it("renders the legacy-access-code triage pill when at least one case is legacy", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId("button-filter-legacy-access-code"),
      ).toBeTruthy(),
    );
    expect(
      screen.getByTestId("button-filter-legacy-access-code").textContent,
    ).toContain("1");
  });

  it("clicking the KPI card narrows the table to only legacy-access-code cases", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-legacy-access-code-${LEGACY_CASE_ID}`),
      ).toBeTruthy(),
    );
    // Both rows are visible before filtering.
    expect(
      screen.getByTestId(`button-copy-access-code-${MODERN_CASE_ID}`),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("kpi-legacy_access_codes"));

    await waitFor(() =>
      expect(
        screen.queryByTestId(`button-copy-access-code-${MODERN_CASE_ID}`),
      ).toBeNull(),
    );
    expect(
      screen.getByTestId(`button-copy-access-code-${LEGACY_CASE_ID}`),
    ).toBeTruthy();
  });

  it("toggling the triage pill off restores the modern-code case to the table", async () => {
    render(<CasesTab />);

    const pill = await screen.findByTestId("button-filter-legacy-access-code");
    fireEvent.click(pill);

    await waitFor(() =>
      expect(
        screen.queryByTestId(`button-copy-access-code-${MODERN_CASE_ID}`),
      ).toBeNull(),
    );

    fireEvent.click(screen.getByTestId("button-filter-legacy-access-code"));

    await waitFor(() =>
      expect(
        screen.getByTestId(`button-copy-access-code-${MODERN_CASE_ID}`),
      ).toBeTruthy(),
    );
  });

  it("clicking an unrelated KPI clears the legacy-access-code filter instead of intersecting with it", async () => {
    render(<CasesTab />);

    fireEvent.click(await screen.findByTestId("kpi-legacy_access_codes"));

    await waitFor(() =>
      expect(
        screen.queryByTestId(`button-copy-access-code-${MODERN_CASE_ID}`),
      ).toBeNull(),
    );

    fireEvent.click(screen.getByTestId("kpi-pending_withdrawals"));

    await waitFor(() =>
      expect(
        screen.getByTestId(`button-copy-access-code-${MODERN_CASE_ID}`),
      ).toBeTruthy(),
    );
    expect(
      screen.getByTestId(`button-copy-access-code-${LEGACY_CASE_ID}`),
    ).toBeTruthy();
  });
});
