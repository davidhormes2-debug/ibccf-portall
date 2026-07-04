// @vitest-environment jsdom
//
// Integration-style test: verify the nav badge and the CasesTab triage pill
// always derive their reactivation count from the SAME source in AdminDashboard.
//
// The divergence this test guards against:
//   AdminDashboard could be refactored to pass `reactivationPendingTotal` to
//   AdminGroupedNav from a *different* computed source (e.g. a separate state
//   variable or a differently-keyed field) while the context still exposes the
//   original `reactivationPendingCounts` object to CasesTab.  The existing
//   ReactivationPillSync test does not catch that because it controls the nav
//   badge's prop directly rather than verifying it flows from the same source
//   as the context field.
//
// Coverage comes in three layers:
//
//   1. Static source assertions on AdminDashboard.tsx that tie the prop passed
//      to AdminGroupedNav back to the same state variable exposed in context:
//        a) `reactivationPendingTotal` is computed from `reactivationPendingCounts`
//           (the memoisation expression must reference exactly that field).
//        b) AdminGroupedNav receives `reactivationPendingCount={reactivationPendingTotal}`
//           (not a differently-named variable).
//        c) The context value fed to AdminDashboardContext.Provider includes
//           `reactivationPendingCounts` (the very same state variable).
//
//   2. A context-wired render test that mounts AdminGroupedNav and CasesTab
//      inside a REAL AdminDashboardContext.Provider (not a mocked
//      `useAdminDashboard`) with a seeded `reactivationPendingCounts` object.
//      The nav badge's `reactivationPendingCount` prop is computed from the
//      same counts object so the two surfaces are driven from one source —
//      the same contract AdminDashboard itself fulfils.  If either component
//      reads a different context field the counts diverge and the assertion
//      fails.
//
//   3. A full AdminDashboard integration test that renders the real
//      AdminDashboard component under stubbed API responses so the data flows
//      from a single network response through AdminDashboard's own state
//      machinery (fetchReactivationPendingCounts → setReactivationPendingCounts
//      → reactivationPendingTotal useMemo → AdminGroupedNav prop) AND into
//      the context provider (reactivationPendingCounts → CasesTab).  If
//      AdminDashboard is refactored to pass a differently-computed value to the
//      nav badge than what it puts in context, one surface will show a
//      different count and this test fails.

import React, { useMemo, useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AdminDashboardContext } from "@/components/admin/AdminDashboardContext";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";

// ── static source ─────────────────────────────────────────────────────────────

const ADMIN_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../pages/AdminDashboard.tsx"),
  "utf8",
);

const CASES_TAB_SRC = fs.readFileSync(
  path.resolve(__dirname, "../tabs/CasesTab.tsx"),
  "utf8",
);

const CONTEXT_SRC = fs.readFileSync(
  path.resolve(__dirname, "../AdminDashboardContext.tsx"),
  "utf8",
);

// ── silence shadcn toasts ─────────────────────────────────────────────────────

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── stub SupportingDocsQuickPopover – avoids Radix + fetch side-effects ───────

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

// ── stub useTheme so AdminDashboard can mount without a ThemeProvider ─────────

vi.mock("@/App", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/App")>();
  return {
    ...actual,
    useTheme: () => ({
      theme: "dark" as const,
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
    }),
  };
});

// ── stub heavy background / compliance components ─────────────────────────────

vi.mock("@/components/PremiumBackground", () => ({
  SubduedSpaceBackground: () => null,
}));

vi.mock("@/components/ComplianceStrip", () => ({
  ComplianceStrip: () => null,
}));

// ── stub DepositReceiptsDialog — it receives `adminRole` as a prop (it is
//    mounted *outside* the AdminDashboardContext.Provider in AdminDashboard),
//    but it's heavy and irrelevant to this test's scope, so we stub it out.

vi.mock("@/components/admin/DepositReceiptsDialog", () => ({
  DepositReceiptsDialog: () => null,
}));

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
    .mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }) as unknown as Response,
      ),
    );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── imports under test (after mocks) ─────────────────────────────────────────

import { CasesTab } from "../tabs/CasesTab";
import { AdminGroupedNav } from "../AdminGroupedNav";
import AdminDashboard from "@/pages/AdminDashboard";

// ── helpers ───────────────────────────────────────────────────────────────────

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/**
 * Harness that wires AdminGroupedNav and CasesTab from a SINGLE
 * AdminDashboardContext.Provider value — no mocked `useAdminDashboard`.
 * The `reactivationPendingCount` prop for AdminGroupedNav is computed from
 * the same `reactivationPendingCounts` object that lives in context, matching
 * exactly what AdminDashboard does with its useMemo.
 */
function IntegrationHarness({
  counts,
}: {
  counts: Record<string, number>;
}) {
  const [tab, setTab] = useState("cases");

  const total = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + n, 0),
    [counts],
  );

  const ctx = buildMockAdminDashboardContext({
    reactivationPendingCounts: counts,
    reactivationPendingOnly: false,
    setReactivationPendingOnly: vi.fn(),
  });

  return (
    <AdminDashboardContext.Provider value={ctx}>
      <Tabs value={tab} onValueChange={setTab}>
        <AdminGroupedNav
          activeTab={tab}
          setActiveTab={setTab}
          totalUnread={0}
          stampDutyPendingCount={0}
          onStampDutyBadgeClick={() => {}}
          pendingDocCount={0}
          onPendingDocBadgeClick={() => {}}
          supportingDocPendingCount={0}
          onSupportingDocBadgeClick={() => {}}
          withdrawalPendingCount={0}
          onWithdrawalBadgeClick={() => {}}
          refundClaimPendingCount={0}
          onRefundClaimBadgeClick={() => {}}
          reactivationPendingCount={total}
          onReactivationBadgeClick={() => {}}
          activeWarningsCount={0}
        />
        <TabsContent value="cases">
          <CasesTab />
        </TabsContent>
      </Tabs>
    </AdminDashboardContext.Provider>
  );
}

/** Builds a per-test fetch mock that handles the two endpoints AdminDashboard
 *  needs to show the dashboard and the reactivation counts. */
function makeAdminFetch(reactivationCounts: Record<string, number>) {
  return (url: unknown): Promise<Response> => {
    const urlStr = String(url);
    if (urlStr.includes("/api/admin/verify")) {
      return Promise.resolve(
        new Response(JSON.stringify({ role: "super_admin" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }) as unknown as Response,
      );
    }
    if (urlStr.includes("/api/deposits/reactivation-pending-counts")) {
      return Promise.resolve(
        new Response(JSON.stringify({ counts: reactivationCounts }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }) as unknown as Response,
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({}), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }) as unknown as Response,
    );
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("ReactivationPillSync — integration (AdminDashboard source + shared context)", () => {
  // ── Layer 1: static source assertions ──────────────────────────────────────

  it("reactivationPendingTotal is memoised from reactivationPendingCounts", () => {
    const memoIdx = ADMIN_SRC.indexOf("reactivationPendingTotal = useMemo(");
    expect(memoIdx, "reactivationPendingTotal useMemo not found in AdminDashboard.tsx").toBeGreaterThan(-1);

    const endIdx = ADMIN_SRC.indexOf("\n  const ", memoIdx + 1);
    const memoBody =
      endIdx === -1 ? ADMIN_SRC.slice(memoIdx) : ADMIN_SRC.slice(memoIdx, endIdx);

    expect(
      memoBody,
      "reactivationPendingTotal memo must reference reactivationPendingCounts",
    ).toContain("reactivationPendingCounts");
  });

  it("AdminGroupedNav receives reactivationPendingCount={reactivationPendingTotal} from AdminDashboard", () => {
    expect(
      ADMIN_SRC,
      "AdminGroupedNav must receive reactivationPendingCount={reactivationPendingTotal}",
    ).toContain("reactivationPendingCount={reactivationPendingTotal}");
  });

  it("AdminDashboardContext.Provider value includes reactivationPendingCounts from the same state", () => {
    const providerIdx = ADMIN_SRC.indexOf("AdminDashboardContext.Provider");
    expect(providerIdx, "AdminDashboardContext.Provider not found in AdminDashboard.tsx").toBeGreaterThan(-1);

    const providerEnd = ADMIN_SRC.indexOf("</AdminDashboardContext.Provider>", providerIdx);
    expect(providerEnd, "AdminDashboardContext.Provider closing tag not found").toBeGreaterThan(-1);

    const providerBlock = ADMIN_SRC.slice(providerIdx, providerEnd);
    expect(
      providerBlock,
      "AdminDashboardContext.Provider value must include reactivationPendingCounts",
    ).toContain("reactivationPendingCounts,");
  });

  it("CasesTab destructures reactivationPendingCounts from context (not a differently-named field)", () => {
    expect(
      CASES_TAB_SRC,
      "CasesTab must destructure reactivationPendingCounts from useAdminDashboard()",
    ).toMatch(/reactivationPendingCounts\s*=\s*\{\}/);

    // Guard the actual read sites: the count-lookup usages must key into the
    // reactivationPendingCounts map by caseId, not read a pre-computed total
    // off a differently-named field.
    expect(
      CASES_TAB_SRC,
      "CasesTab must read per-case pending counts via reactivationPendingCounts[<id>]",
    ).toMatch(/reactivationPendingCounts\[[^\]]+\]/);
  });

  it("AdminDashboardContext type exposes reactivationPendingCounts (not renamed to reactivationPendingTotal)", () => {
    expect(
      CONTEXT_SRC,
      "AdminDashboardContext must declare reactivationPendingCounts: Record<string, number>",
    ).toContain("reactivationPendingCounts: Record<string, number>;");

    expect(
      CONTEXT_SRC,
      "AdminDashboardContext must not expose a pre-computed reactivationPendingTotal field",
    ).not.toContain("reactivationPendingTotal");
  });

  // ── Layer 2: context-wired render tests ────────────────────────────────────

  it("non-zero count — nav badge and triage pill both show the same total from shared context", async () => {
    const counts: Record<string, number> = {
      "case-alpha": 2,
      "case-beta": 1,
    };
    const expected = sumCounts(counts); // 3

    render(<IntegrationHarness counts={counts} />);

    const pill = await screen.findByTestId("button-filter-reactivation-pending");
    const pillCount = pill.querySelector("span")?.textContent?.trim();
    expect(pillCount).toBe(String(expected));

    const badge = screen.getByTestId("badge-cases-reactivation");
    expect(badge.textContent).toContain(String(expected));

    expect(pillCount).toBe(badge.textContent?.trim() ?? "");
  });

  it("zero count — nav badge and triage pill are both absent when shared counts are empty", async () => {
    render(<IntegrationHarness counts={{}} />);

    await waitFor(() =>
      expect(
        screen.queryByTestId("button-filter-reactivation-pending"),
      ).toBeNull(),
    );

    expect(screen.queryByTestId("badge-cases-reactivation")).toBeNull();
  });

  // ── Layer 3: full AdminDashboard integration ──────────────────────────────
  //
  // Mounts the real AdminDashboard component under stubbed API responses.
  // Data flows from the network response through AdminDashboard's own state
  // machinery (fetchReactivationPendingCounts → setReactivationPendingCounts
  // → reactivationPendingTotal useMemo → AdminGroupedNav prop) AND from the
  // same state into context (reactivationPendingCounts → CasesTab).
  //
  // If AdminDashboard is refactored to feed the nav badge from a different
  // source than it puts in context, one surface will show a different count
  // and this assertion fails.

  it("AdminDashboard routes API reactivation data identically to both nav badge and triage pill", async () => {
    // Allow extra time for the verify API response, React re-render, and
    // cross-tab sync to propagate the counts through AdminDashboard's state.
    // The test timeout is raised to 15 s to accommodate this multi-step flow.
    vi.setConfig({ testTimeout: 15000 });
    const COUNTS = { "case-alpha": 2, "case-beta": 1 };
    const TOTAL = sumCounts(COUNTS); // 3

    // Override the default 404-everything fetch with one that services the
    // two endpoints AdminDashboard needs to transition to logged-in state and
    // receive seeded reactivation counts.
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation(makeAdminFetch(COUNTS));

    render(<AdminDashboard />);

    // Both surfaces flow from the same AdminDashboard state — wait for them
    // to appear and assert they agree.
    const badge = await screen.findByTestId(
      "badge-cases-reactivation",
      {},
      { timeout: 10000 },
    );
    const pill = await screen.findByTestId(
      "button-filter-reactivation-pending",
      {},
      { timeout: 10000 },
    );

    expect(badge.textContent).toContain(String(TOTAL));
    expect(pill.querySelector("span")?.textContent?.trim()).toBe(String(TOTAL));
  });
});
