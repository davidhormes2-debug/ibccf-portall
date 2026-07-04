// @vitest-environment jsdom
//
// Tests for the stage badge column in CasesTab.
//
// Contracts verified:
//   1. A case with withdrawalStage="3" renders a badge showing "Stage 3" and
//      the short label "Phrase Key Approved & Available".
//   2. A case with no withdrawalStage renders the em-dash placeholder "—"
//      (i.e. the stage-badge-<caseId> testid is absent).
//   3. Both rows remain visible in the table regardless of stage presence.
//   4. Edge-case stage values ("0", "15", "abc", "3.5") all render "—" and
//      must never produce a stage-badge testid — guards the numeric-detection
//      regex against accidental broadening.

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

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const STAGED_CASE_ID = "case-stage-badge-yes";
const UNSTAGED_CASE_ID = "case-stage-badge-none";

// Stage 3 → "Phrase Key Approved & Available"
const CASE_WITH_STAGE = {
  id: STAGED_CASE_ID,
  accessCode: "STGBDG1",
  status: "active" as const,
  withdrawalStage: "3",
} as unknown as Case;

const CASE_NO_STAGE = {
  id: UNSTAGED_CASE_ID,
  accessCode: "STGBDG2",
  status: "active" as const,
  withdrawalStage: null,
} as unknown as Case;

// Edge-case stage values that must all render "—" with no badge testid.
const CASE_STAGE_ZERO = {
  id: "case-stage-badge-zero",
  accessCode: "STGBDG3",
  status: "active" as const,
  withdrawalStage: "0",
} as unknown as Case;

const CASE_STAGE_OVERFLOW = {
  id: "case-stage-badge-overflow",
  accessCode: "STGBDG4",
  status: "active" as const,
  withdrawalStage: "15",
} as unknown as Case;

const CASE_STAGE_ALPHA = {
  id: "case-stage-badge-alpha",
  accessCode: "STGBDG5",
  status: "active" as const,
  withdrawalStage: "abc",
} as unknown as Case;

const CASE_STAGE_DECIMAL = {
  id: "case-stage-badge-decimal",
  accessCode: "STGBDG6",
  status: "active" as const,
  withdrawalStage: "3.5",
} as unknown as Case;

// ─────────────────────────────────────────────────────────────────────────────
// Mock context
// ─────────────────────────────────────────────────────────────────────────────

const ALL_CASES = [
  CASE_WITH_STAGE,
  CASE_NO_STAGE,
  CASE_STAGE_ZERO,
  CASE_STAGE_OVERFLOW,
  CASE_STAGE_ALPHA,
  CASE_STAGE_DECIMAL,
];

function buildMockContext(): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: ALL_CASES,
    filteredCases: ALL_CASES,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch stub — silences on-mount effects that call admin APIs
// ─────────────────────────────────────────────────────────────────────────────

function notFoundResponse() {
  return Promise.resolve(
    new Response(JSON.stringify({}), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }) as unknown as Response,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

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
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("CasesTab — stage badge column", () => {
  it("renders the stage-badge testid for a case with withdrawalStage set", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`stage-badge-${STAGED_CASE_ID}`),
      ).toBeTruthy(),
    );
  });

  it("badge shows 'Stage 3' for a case with withdrawalStage='3'", async () => {
    render(<CasesTab />);

    const badge = await screen.findByTestId(`stage-badge-${STAGED_CASE_ID}`);
    expect(badge.textContent).toContain("Stage 3");
  });

  it("badge shows the short label 'Phrase Key Approved & Available' for stage 3", async () => {
    render(<CasesTab />);

    const badge = await screen.findByTestId(`stage-badge-${STAGED_CASE_ID}`);
    expect(badge.textContent).toContain("Phrase Key Approved & Available");
  });

  it("does NOT render the stage-badge testid for a case with no withdrawalStage", async () => {
    render(<CasesTab />);

    // Wait for the staged-case row to confirm the table has mounted.
    await waitFor(() =>
      expect(
        screen.getByTestId(`stage-badge-${STAGED_CASE_ID}`),
      ).toBeTruthy(),
    );

    // The un-staged case must not carry the badge testid.
    expect(
      screen.queryByTestId(`stage-badge-${UNSTAGED_CASE_ID}`),
    ).toBeNull();
  });

  it("renders both case rows regardless of stage presence", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(screen.getByTestId(`row-case-${STAGED_CASE_ID}`)).toBeTruthy(),
    );

    expect(screen.getByTestId(`row-case-${STAGED_CASE_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`row-case-${UNSTAGED_CASE_ID}`)).toBeTruthy();
  });

  it("shows the em-dash placeholder in the row for a case with no stage", async () => {
    render(<CasesTab />);

    // Wait for rows to mount.
    await waitFor(() =>
      expect(screen.getByTestId(`row-case-${UNSTAGED_CASE_ID}`)).toBeTruthy(),
    );

    const noStageRow = screen.getByTestId(`row-case-${UNSTAGED_CASE_ID}`);
    // The "—" dash is rendered inside the stage column of this row.
    expect(noStageRow.textContent).toContain("—");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge-case stage values — must never produce a badge testid
// ─────────────────────────────────────────────────────────────────────────────

describe("CasesTab — stage badge edge cases (no badge rendered)", () => {
  // Shared anchor: wait for the valid stage-3 badge to confirm the table has
  // fully mounted before asserting that invalid-stage badges are absent.
  async function waitForTableMount() {
    await waitFor(() =>
      expect(
        screen.getByTestId(`stage-badge-${STAGED_CASE_ID}`),
      ).toBeTruthy(),
    );
  }

  it("renders '—' and no badge testid for withdrawalStage='0' (zero is falsy after parseInt)", async () => {
    render(<CasesTab />);
    await waitForTableMount();

    expect(
      screen.queryByTestId(`stage-badge-${CASE_STAGE_ZERO.id}`),
    ).toBeNull();

    const row = screen.getByTestId(`row-case-${CASE_STAGE_ZERO.id}`);
    expect(row.textContent).toContain("—");
  });

  it("renders '—' and no badge testid for withdrawalStage='15' (out-of-range, no label)", async () => {
    render(<CasesTab />);
    await waitForTableMount();

    expect(
      screen.queryByTestId(`stage-badge-${CASE_STAGE_OVERFLOW.id}`),
    ).toBeNull();

    const row = screen.getByTestId(`row-case-${CASE_STAGE_OVERFLOW.id}`);
    expect(row.textContent).toContain("—");
  });

  it("renders '—' and no badge testid for withdrawalStage='abc' (non-numeric string)", async () => {
    render(<CasesTab />);
    await waitForTableMount();

    expect(
      screen.queryByTestId(`stage-badge-${CASE_STAGE_ALPHA.id}`),
    ).toBeNull();

    const row = screen.getByTestId(`row-case-${CASE_STAGE_ALPHA.id}`);
    expect(row.textContent).toContain("—");
  });

  it("renders '—' and no badge testid for withdrawalStage='3.5' (decimal string fails regex)", async () => {
    render(<CasesTab />);
    await waitForTableMount();

    expect(
      screen.queryByTestId(`stage-badge-${CASE_STAGE_DECIMAL.id}`),
    ).toBeNull();

    const row = screen.getByTestId(`row-case-${CASE_STAGE_DECIMAL.id}`);
    expect(row.textContent).toContain("—");
  });
});
