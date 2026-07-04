// @vitest-environment jsdom
//
// Behavioral (rendered) coverage for AdminDashboard's resetUserPin handler
// (Task #2388), wired to CasesTab's "Reset PIN" menu item via
// AdminDashboardContext. This renders the real AdminDashboard so a
// regression like the one this task is guarding against — an active-session
// check result object (`{hasActiveSession, lastActivityAt}`) being passed
// straight into buildResetPinConfirmMessage() where a boolean is expected —
// is caught by asserting on the literal confirm() copy shown to the admin,
// not just on the shape of an internal helper's return value.
//
// The heavy per-module mocks below mirror
// AdminDashboard.caseIdDeepLink.test.tsx, which mounts the same real
// (large) AdminDashboard component.

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

// ── module-level mocks (identical set to AdminDashboard.caseIdDeepLink.test.tsx) ──

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

// AdminDashboardContext — keep a real React context. AdminDashboard renders
// <AdminDashboardContext.Provider value={...}> directly (not via a
// useAdminDashboard() call internally), so overriding useAdminDashboard()
// here only affects our CasesTab stub below, not AdminDashboard's own logic.
vi.mock("@/components/admin/AdminDashboardContext", () => {
  const AdminDashboardContext = React.createContext<any>(null);
  return {
    AdminDashboardContext,
    useAdminDashboard: () => {
      const ctx = React.useContext(AdminDashboardContext);
      return ctx ?? { loadUserDocPendingCounts: vi.fn(), userDocPendingCounts: {} };
    },
  };
});

// CasesTab — replaced with a minimal stub exposing a "Reset PIN" trigger
// button wired to the *real* resetUserPin function supplied via context by
// AdminDashboard, so this test exercises the actual handler. The dynamic
// import inside the factory (mirroring AdminDashboard.caseIdDeepLink.test.tsx)
// reaches into the same mocked AdminDashboardContext module graph.
vi.mock("@/components/admin/tabs/CasesTab", async () => {
  const { AdminDashboardContext } = await import(
    "@/components/admin/AdminDashboardContext"
  );
  return {
    CasesTab: () => {
      const ctx = React.useContext(AdminDashboardContext);
      const targetCase = ctx?.cases?.[0];
      return React.createElement(
        "button",
        {
          "data-testid": "trigger-reset-pin",
          onClick: () => targetCase && ctx.resetUserPin(targetCase),
        },
        "Reset PIN",
      );
    },
  };
});

// ── import AdminDashboard AFTER mocks are in place ────────────────────────
const { default: AdminDashboard } = await import("../AdminDashboard");

// ── fixtures ───────────────────────────────────────────────────────────────

const SEEDED_CASE = {
  id: "case-reset-pin-1",
  accessCode: "RPWARN01",
  userName: "Jamie Reset",
  userEmail: "jamie@example.com",
  status: "active",
  withdrawalStage: 3,
  sealedAt: null,
  preferredLocale: null,
};

let activeSessionResponse: { hasActiveSession: boolean; lastActivityAt: string | null } = {
  hasActiveSession: false,
  lastActivityAt: null,
};
let resetPinResponseOk = true;
const resetPinCalls: string[] = [];

function mockFetch() {
  (global.fetch as Mock).mockImplementation(async (url: string) => {
    const path = typeof url === "string" ? url : String(url);

    if (path.includes("/api/admin/verify")) {
      return { ok: true, json: async () => ({ valid: true }) };
    }
    if (path.includes("/api/cases") && !path.includes("/api/cases/")) {
      return { ok: true, json: async () => [SEEDED_CASE] };
    }
    if (path.includes(`/api/cases/${SEEDED_CASE.id}/active-session`)) {
      return { ok: true, json: async () => activeSessionResponse };
    }
    if (path.includes(`/api/cases/${SEEDED_CASE.id}/reset-pin`)) {
      resetPinCalls.push(path);
      return resetPinResponseOk
        ? { ok: true, json: async () => ({ success: true }) }
        : { ok: false, json: async () => ({ error: "boom" }) };
    }
    if (path.includes("/api/submissions")) {
      return { ok: true, json: async () => [] };
    }
    return { ok: false, json: async () => ({}) };
  });
}

// ── setup / teardown ───────────────────────────────────────────────────────

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  sessionStorage.clear();
  sessionStorage.setItem("adminToken", "test-admin-token");
  activeSessionResponse = { hasActiveSession: false, lastActivityAt: null };
  resetPinResponseOk = true;
  resetPinCalls.length = 0;
  mockFetch();
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  sessionStorage.clear();
  confirmSpy.mockRestore();
});

// ── tests ──────────────────────────────────────────────────────────────────

describe("AdminDashboard — Reset PIN menu action", () => {
  it("checks for an active session, shows the no-session confirm copy, then resets the PIN", async () => {
    activeSessionResponse = { hasActiveSession: false, lastActivityAt: null };

    await act(async () => {
      render(<AdminDashboard />);
    });

    const trigger = await screen.findByTestId("trigger-reset-pin");

    await act(async () => {
      trigger.click();
    });

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(confirmSpy.mock.calls[0][0]).toBe(
      `Reset PIN for ${SEEDED_CASE.userName}? They will need to set a new PIN on next login.`,
    );

    await waitFor(() => expect(resetPinCalls).toHaveLength(1));
  });

  it("shows the active-session warning copy when the user is currently logged in", async () => {
    activeSessionResponse = {
      hasActiveSession: true,
      lastActivityAt: new Date().toISOString(),
    };

    await act(async () => {
      render(<AdminDashboard />);
    });

    const trigger = await screen.findByTestId("trigger-reset-pin");

    await act(async () => {
      trigger.click();
    });

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(confirmSpy.mock.calls[0][0]).toBe(
      `Reset PIN for ${SEEDED_CASE.userName}? This user is currently active in the portal (last active just now) — resetting will log them out immediately and they will need to set a new PIN on next login.`,
    );

    await waitFor(() => expect(resetPinCalls).toHaveLength(1));
  });

  it("does not call reset-pin when the admin cancels the confirm dialog", async () => {
    confirmSpy.mockReturnValue(false);

    await act(async () => {
      render(<AdminDashboard />);
    });

    const trigger = await screen.findByTestId("trigger-reset-pin");

    await act(async () => {
      trigger.click();
    });

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(resetPinCalls).toHaveLength(0);
  });
});
