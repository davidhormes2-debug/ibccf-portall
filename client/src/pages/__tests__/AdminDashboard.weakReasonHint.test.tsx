// @vitest-environment jsdom
//
// Verifies that the admin login form renders the weak-reason hint element
// (data-testid="text-admin-login-weak-reason") when the server returns a 503
// response that includes a `weakReason` field, and that the element is absent
// when no `weakReason` is present.
//
// The test stubs `fetch` so that POST /api/admin/login returns a synthetic 503
// with each AdminPasswordWeakReason in turn, then asserts:
//   1. The hint element is visible and contains the text from
//      ADMIN_PASSWORD_WEAK_HINTS for that reason.
//   2. When the 503 body omits `weakReason`, the hint element is not rendered.
//   3. When the server returns a non-error 401, the hint element is not rendered.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, waitFor, act, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

import {
  ADMIN_PASSWORD_WEAK_HINTS,
  type AdminPasswordWeakReason,
} from "@shared/passwordStrength";

// ── module-level mocks ─────────────────────────────────────────────────────
// Identical set to AdminDashboard.passwordOverrideBanner.test.tsx — required
// because we import the same large component.

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
vi.mock("@/components/admin/tabs/CasesTab", () => ({
  CasesTab: () => null,
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

// ── import AdminDashboard AFTER mocks are in place ────────────────────────
const { default: AdminDashboard } = await import("../AdminDashboard");

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Base fetch mock for the pre-login state.
 * Returns non-ok for everything so secondary data-loading effects bail early.
 * Individual tests override the /api/admin/login response as needed.
 */
function makeLoginFetch503(
  weakReason?: AdminPasswordWeakReason | null,
  includeWeakReason = true,
) {
  (global.fetch as Mock).mockImplementation(async (url: string) => {
    const path = typeof url === "string" ? url : String(url);

    if (path.includes("/api/admin/public/password-override-active")) {
      return { ok: true, json: async () => ({ active: false }) };
    }

    if (path.includes("/api/admin/login")) {
      const body: Record<string, unknown> = {
        error:
          "Admin password is too weak — rotate ADMIN_PASSWORD before logging in",
      };
      if (includeWeakReason && weakReason !== undefined) {
        body.weakReason = weakReason;
      }
      return {
        ok: false,
        status: 503,
        json: async () => body,
      };
    }

    return { ok: false, json: async () => ({}) };
  });
}

/** Submit the login form with dummy credentials. */
async function submitLoginForm() {
  await act(async () => {
    fireEvent.change(screen.getByTestId("input-admin-username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByTestId("input-admin-password"), {
      target: { value: "password123" },
    });
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId("button-admin-login"));
  });
}

// ── setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  sessionStorage.clear();
  // No adminToken — the component renders the login form.
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  sessionStorage.clear();
});

// ── tests ──────────────────────────────────────────────────────────────────

const WEAK_REASONS: AdminPasswordWeakReason[] = [
  "missing",
  "too_short",
  "blocklisted",
  "keyboard_walk",
  "repetitive_pattern",
];

describe("AdminDashboard login form — text-admin-login-weak-reason hint element", () => {
  for (const reason of WEAK_REASONS) {
    it(`renders the hint for weakReason '${reason}' and matches ADMIN_PASSWORD_WEAK_HINTS`, async () => {
      makeLoginFetch503(reason);

      await act(async () => {
        render(<AdminDashboard />);
      });

      await submitLoginForm();

      await waitFor(
        () => {
          expect(
            screen.queryByTestId("text-admin-login-weak-reason"),
          ).not.toBeNull();
        },
        { timeout: 3000 },
      );

      const hintEl = screen.getByTestId("text-admin-login-weak-reason");
      expect(hintEl.textContent).toBe(ADMIN_PASSWORD_WEAK_HINTS[reason]);
    });
  }

  it("does NOT render text-admin-login-weak-reason when the 503 body omits weakReason", async () => {
    makeLoginFetch503(undefined, false);

    await act(async () => {
      render(<AdminDashboard />);
    });

    await submitLoginForm();

    // Wait for the main error alert to appear (confirms the 503 was processed).
    await waitFor(
      () => {
        expect(screen.queryByTestId("alert-admin-login-error")).not.toBeNull();
      },
      { timeout: 3000 },
    );

    // The per-reason hint must be absent.
    expect(screen.queryByTestId("text-admin-login-weak-reason")).toBeNull();
  });

  it("does NOT render text-admin-login-weak-reason when weakReason is null", async () => {
    makeLoginFetch503(null, true);

    await act(async () => {
      render(<AdminDashboard />);
    });

    await submitLoginForm();

    await waitFor(
      () => {
        expect(screen.queryByTestId("alert-admin-login-error")).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(screen.queryByTestId("text-admin-login-weak-reason")).toBeNull();
  });

  it("does NOT render text-admin-login-weak-reason on a 401 (wrong credentials)", async () => {
    (global.fetch as Mock).mockImplementation(async (url: string) => {
      const path = typeof url === "string" ? url : String(url);

      if (path.includes("/api/admin/public/password-override-active")) {
        return { ok: true, json: async () => ({ active: false }) };
      }
      if (path.includes("/api/admin/login")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: "Invalid credentials" }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await submitLoginForm();

    // Allow effects to settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    // 401 is handled by the toast path, not setLoginError — hint must be absent.
    expect(screen.queryByTestId("text-admin-login-weak-reason")).toBeNull();
  });
});
