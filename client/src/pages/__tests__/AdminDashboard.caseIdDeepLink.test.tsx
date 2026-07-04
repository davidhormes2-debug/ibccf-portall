// @vitest-environment jsdom
//
// Behavioral (rendered) coverage for the ?caseId= deep-link and
// window.__adminOpenCase helper in AdminDashboard.tsx (Task #2361).
//
// The existing AdminTabSearchClear.test.ts only inspects the component's
// source text — it never mounts the real component, so it cannot catch a
// regression where the wiring is *textually* present but no longer actually
// opens the case detail dialog (e.g. a stale `cases` closure, an effect that
// never fires, or `openAdminMessageDialog` throwing before `setIsAdminMessageOpen`
// runs). This file renders the real AdminDashboard and asserts the dialog
// genuinely opens in one step when the case is already loaded, and that the
// fallback (case not found) pre-fills the search box instead.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import React from "react";

// ── module-level mocks ─────────────────────────────────────────────────────
// Identical set to AdminDashboard.securityFlags.test.tsx / weakReasonHint —
// required because we import the same large component.

vi.mock("@/App", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { changeLanguage: vi.fn(), language: "en" },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({ children, ...rest }: any) =>
          React.createElement(tag, rest, children),
    },
  ),
  AnimatePresence: ({ children }: any) => children,
  useAnimation: () => ({ start: vi.fn(), set: vi.fn() }),
  useReducedMotion: () => false,
}));

vi.mock("recharts", () => ({
  BarChart: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: any) => children,
  PieChart: () => null,
  Pie: () => null,
  Cell: () => null,
  LineChart: () => null,
  Line: () => null,
  Legend: () => null,
}));

vi.mock("@/components/PremiumBackground", () => ({
  SubduedSpaceBackground: () => null,
  PremiumBackground: () => null,
}));
vi.mock("@/components/admin/SessionRefreshPanel", () => ({
  SessionRefreshPanel: () => null,
}));
vi.mock("@/components/ComplianceStrip", () => ({
  ComplianceStrip: () => null,
}));
vi.mock("@/components/admin/ContentManagement", () => ({
  ContentManagement: () => null,
}));
vi.mock("@/components/DocumentPreview", () => ({
  DocumentPreview: () => null,
}));
vi.mock("@/components/admin/CommunityManagement", () => ({
  CommunityManagement: () => null,
}));
vi.mock("@/components/admin/CaseEmailDeliveryPanel", () => ({
  CaseEmailDeliveryPanel: () => null,
}));
vi.mock("@/components/admin/KeyRequestsManagement", () => ({
  KeyRequestsManagement: () => null,
}));
vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: any) => children,
}));
vi.mock("@/components/admin/AdminWithdrawalRequestsDialog", () => ({
  AdminWithdrawalRequestsDialog: () => null,
}));
vi.mock("@/components/admin/NdaAdminDialogs", () => ({
  SignedNdaDialog: () => null,
  PreviewNdaDialog: () => null,
}));
vi.mock("@/components/admin/AllReceiptsTab", () => ({
  AllReceiptsTab: () => null,
}));
vi.mock("@/components/admin/CaseMergedReceiptsPanel", () => ({
  CaseMergedReceiptsPanel: () => null,
}));
vi.mock("@/components/admin/AdminGroupedNav", () => ({
  AdminGroupedNav: () => null,
}));
vi.mock("@/components/admin/AdminCaseFinder", () => ({
  AdminCaseFinder: () => null,
}));
vi.mock("@/components/admin/CaseDetailTabsList", () => ({
  CaseDetailTabsList: () => null,
  CASE_DETAIL_TABS: [],
}));
vi.mock("@/components/admin/SupportingDocumentsPanel", () => ({
  SupportingDocumentsPanel: () => null,
}));
vi.mock("@/components/admin/tabs/SubmissionsTab", () => ({
  SubmissionsTab: () => null,
}));
vi.mock("@/components/admin/tabs/ConversationsTab", () => ({
  ConversationsTab: () => null,
}));
vi.mock("@/components/admin/tabs/AnalyticsTab", () => ({
  AnalyticsTab: () => null,
}));
vi.mock("@/components/admin/tabs/SettingsTab", () => ({
  SettingsTab: () => null,
}));
vi.mock("@/components/admin/tabs/VisitorsTab", () => ({
  VisitorsTab: () => null,
}));
vi.mock("@/components/admin/tabs/CommunicationsTab", () => ({
  default: () => null,
}));
vi.mock("@/components/admin/tabs/DocumentsTab", () => ({
  DocumentsTab: () => null,
}));
vi.mock("@/components/admin/tabs/SupportingDocumentsTab", () => ({
  SupportingDocumentsTab: () => null,
}));
vi.mock("@/components/admin/tabs/DeclarationsTab", () => ({
  DeclarationsTab: () => null,
}));
vi.mock("@/components/admin/tabs/DepositsTab", () => ({
  DepositsTab: () => null,
}));
vi.mock("@/components/portal/WithdrawalGuideBanner", () => ({
  WithdrawalGuideBanner: () => null,
}));
vi.mock("@/hooks/useCrossTabSync", () => ({
  useCrossTabSync: () => undefined,
}));
vi.mock("@/hooks/usePendingCountsSync", () => ({
  usePendingCountsSync: () => undefined,
}));
vi.mock("@/hooks/use-chat-autoscroll", () => ({
  useChatAutoScroll: () => ({ current: null }),
}));

// AdminDashboardContext — keep a real React context so the CasesTab stub
// below can read the live `searchQuery` value fed by AdminDashboard itself,
// rather than a fixed mock. This is what lets the fallback assertion verify
// the search box is genuinely pre-filled, not just that a prop was passed.
vi.mock("@/components/admin/AdminDashboardContext", () => {
  const AdminDashboardContext = React.createContext<any>(null);
  return {
    AdminDashboardContext,
    useAdminDashboard: () => ({
      loadUserDocPendingCounts: vi.fn(),
      userDocPendingCounts: {},
    }),
  };
});

// CasesTab — replaced with a minimal stub that surfaces the live
// searchQuery from AdminDashboardContext so the fallback path (case not
// found) can be asserted without rendering the real (heavy) CasesTab.
vi.mock("@/components/admin/tabs/CasesTab", async () => {
  const { AdminDashboardContext } = await import(
    "@/components/admin/AdminDashboardContext"
  );
  return {
    CasesTab: () => {
      const ctx = React.useContext(AdminDashboardContext);
      return React.createElement(
        "div",
        { "data-testid": "cases-tab-search-query" },
        ctx?.searchQuery ?? "",
      );
    },
  };
});

// ── import AdminDashboard AFTER mocks are in place ────────────────────────
const { default: AdminDashboard } = await import("../AdminDashboard");

// ── fixtures ───────────────────────────────────────────────────────────────

const SEEDED_CASE = {
  id: "case-123",
  accessCode: "ABC123",
  userName: "Jordan Rivers",
  userEmail: "jordan@example.com",
  status: "active",
  withdrawalStage: 3,
  sealedAt: null,
  preferredLocale: null,
};

/**
 * Base fetch mock for the authenticated dashboard state.
 * /api/admin/verify resolves the session, /api/cases returns the seeded
 * case list, /api/submissions returns an empty array, and everything else
 * returns a non-ok empty payload so unrelated data-loading effects bail
 * out early.
 */
function mockFetch() {
  (global.fetch as Mock).mockImplementation(async (url: string) => {
    const path = typeof url === "string" ? url : String(url);

    if (path.includes("/api/admin/verify")) {
      return { ok: true, json: async () => ({ valid: true }) };
    }
    if (path.includes("/api/cases") && !path.includes("/api/cases/")) {
      return { ok: true, json: async () => [SEEDED_CASE] };
    }
    if (path.includes("/api/submissions")) {
      return { ok: true, json: async () => [] };
    }
    return { ok: false, json: async () => ({}) };
  });
}

// ── setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  sessionStorage.clear();
  // Pre-load a fake admin token so the session-restore useEffect
  // immediately calls /api/admin/verify (no login form interaction needed).
  sessionStorage.setItem("adminToken", "test-admin-token");
  mockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  sessionStorage.clear();
  window.history.pushState({}, "", "/");
});

// ── tests ──────────────────────────────────────────────────────────────────

describe("AdminDashboard — ?caseId= deep-link opens the case dialog directly", () => {
  it("opens the case detail dialog in one step when the case is already loaded", async () => {
    window.history.pushState({}, "", `/?caseId=${SEEDED_CASE.id}`);

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(screen.queryByText(/Manage Case:/)).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(screen.getByText(/Manage Case:/).textContent).toContain(
      SEEDED_CASE.userName,
    );
    expect(screen.getByText(`Case #${SEEDED_CASE.accessCode}`)).not.toBeNull();

    // The search box must NOT be pre-filled — the case opened directly.
    expect(
      screen.getByTestId("cases-tab-search-query").textContent,
    ).toBe("");
  });

  it("falls back to pre-filling the search box when the case is not found", async () => {
    window.history.pushState({}, "", "/?caseId=does-not-exist");

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(
          screen.getByTestId("cases-tab-search-query").textContent,
        ).toBe("does-not-exist");
      },
      { timeout: 3000 },
    );

    // The dialog must never open for an unmatched id.
    expect(screen.queryByText(/Manage Case:/)).toBeNull();
  });
});

describe("AdminDashboard — window.__adminOpenCase opens the case dialog directly", () => {
  it("opens the case detail dialog in one step when the case is already loaded", async () => {
    await act(async () => {
      render(<AdminDashboard />);
    });

    // Wait for the case list to load so __adminOpenCase can find the target.
    await waitFor(() => {
      expect((window as any).__adminOpenCase).toBeTypeOf("function");
    });

    await act(async () => {
      (window as any).__adminOpenCase(SEEDED_CASE.accessCode);
    });

    await waitFor(
      () => {
        expect(screen.queryByText(/Manage Case:/)).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(screen.getByText(/Manage Case:/).textContent).toContain(
      SEEDED_CASE.userName,
    );
    expect(
      screen.getByTestId("cases-tab-search-query").textContent,
    ).toBe("");
  });

  it("falls back to pre-filling the search box when the case is not found", async () => {
    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(() => {
      expect((window as any).__adminOpenCase).toBeTypeOf("function");
    });

    await act(async () => {
      (window as any).__adminOpenCase("no-such-code");
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("cases-tab-search-query").textContent,
      ).toBe("no-such-code");
    });

    expect(screen.queryByText(/Manage Case:/)).toBeNull();
  });
});
