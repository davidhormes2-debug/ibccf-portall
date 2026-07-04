// @vitest-environment jsdom
//
// Task #543 — AdminDashboard pre-login password-override banner
//
// Verifies that the amber "alert-password-override-active" notice on the
// admin login form appears when GET /api/admin/public/password-override-active
// returns { active: true }, and is absent when it returns { active: false }.
//
// Key difference from AdminDashboard.securityFlags.test.tsx: these tests do
// NOT pre-load an adminToken, so AdminDashboard renders the login form rather
// than the authenticated dashboard. The password-override useEffect guards on
// !isLoggedIn and fires only in the pre-login state.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, waitFor, act, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

// ── module-level mocks ─────────────────────────────────────────────────────
// Identical set to AdminDashboard.securityFlags.test.tsx — required because
// we import the same 11 000-line component.

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

vi.mock("framer-motion", () => {
  return {
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
  };
});

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

// ── import the real AdminDashboard AFTER mocks are in place ────────────────
const { default: AdminDashboard } = await import("../AdminDashboard");

// ── fetch mock helper ──────────────────────────────────────────────────────
/**
 * Install a fetch mock for the pre-login state.
 *
 * The password-override useEffect fires when isLoggedIn is false (no stored
 * adminToken). We mock the one public endpoint it calls and return a non-ok
 * response for everything else so secondary data-loading effects bail early.
 */
function mockFetchPreLogin(active: boolean) {
  (global.fetch as Mock).mockImplementation(async (url: string) => {
    const path = typeof url === "string" ? url : String(url);

    if (path.includes("/api/admin/public/password-override-active")) {
      return {
        ok: true,
        json: async () => ({ active }),
      };
    }

    // Non-ok catch-all: every other fetch in AdminDashboard guards on !res.ok
    // and bails out early, keeping secondary state at its initial null/[]
    // values to prevent shape-mismatch crashes.
    return { ok: false, json: async () => ({}) };
  });
}

// ── setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  sessionStorage.clear();
  // Intentionally do NOT set "adminToken" — the component must render the
  // login form (isLoggedIn === false) for the password-override notice to fire.
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  sessionStorage.clear();
});

// ── tests ─────────────────────────────────────────────────────────────────

describe("AdminDashboard login form — password-override-active banner (Task #543)", () => {
  it("renders alert-password-override-active when the endpoint returns active: true", async () => {
    mockFetchPreLogin(true);

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("alert-password-override-active"),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    // Confirm the banner text mentions the env var being bypassed.
    expect(
      screen.getByTestId("alert-password-override-active").textContent,
    ).toContain("ADMIN_PASSWORD");
  });

  it("does NOT render alert-password-override-active when the endpoint returns active: false", async () => {
    mockFetchPreLogin(false);

    await act(async () => {
      render(<AdminDashboard />);
    });

    // Allow all async effects to settle; the banner must remain absent.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(screen.queryByTestId("alert-password-override-active")).toBeNull();
  });

  it("does NOT render alert-password-override-active when the endpoint is unavailable", async () => {
    // Simulate a network error — the catch block discards it silently.
    (global.fetch as Mock).mockImplementation(async (url: string) => {
      const path = typeof url === "string" ? url : String(url);
      if (path.includes("/api/admin/public/password-override-active")) {
        throw new Error("Network error");
      }
      return { ok: false, json: async () => ({}) };
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(screen.queryByTestId("alert-password-override-active")).toBeNull();
  });
});

// ── Task #719 — banner never shows when session is restored from storage ───

describe("AdminDashboard — password-override-active banner absent when session-restore path succeeds (Task #719)", () => {
  it("banner never appears when adminToken is already in sessionStorage and /api/admin/verify returns 200", async () => {
    // Pre-seed a token so the session-restore useEffect fires on mount.
    sessionStorage.setItem("adminToken", "pre-stored-test-token");

    // Both the verify call and the override-status call happen concurrently on
    // mount.  Verify resolves ok → isLoggedIn flips to true → the !isLoggedIn
    // branch (which hosts the banner) is never rendered.  The password-override
    // effect re-runs with isLoggedIn=true and returns early, so even if the
    // override-status response arrives later it cannot show the banner.
    (global.fetch as Mock).mockImplementation(async (url: string) => {
      const path = typeof url === "string" ? url : String(url);

      if (path.includes("/api/admin/verify")) {
        return { ok: true, json: async () => ({}) };
      }
      if (path.includes("/api/admin/public/password-override-active")) {
        return { ok: true, json: async () => ({ active: true }) };
      }
      // All authenticated data-loading calls bail early so secondary state
      // stays at null/[] and no shape-mismatch crashes occur.
      return { ok: false, json: async () => ({}) };
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    // Allow all concurrent async effects (verify + override-status) to settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    // The banner lives inside the !isLoggedIn early-return branch.  Once
    // isLoggedIn=true that entire branch is unmounted, so the banner must be
    // absent regardless of what password-override-active returned.
    expect(screen.queryByTestId("alert-password-override-active")).toBeNull();
  });
});

// ── Task #1448 — banner visible when session-restore fails with a network error ──

describe("AdminDashboard — password-override-active banner when session-restore throws a network error (Task #1448)", () => {
  it("banner IS visible when adminToken is pre-seeded but /api/admin/verify throws a network error", async () => {
    // Pre-seed a token so the session-restore useEffect fires on mount.
    sessionStorage.setItem("adminToken", "pre-stored-test-token");

    // Verify throws a network error → the catch block removes the token but
    // isLoggedIn stays false.  The password-override effect then runs with
    // isLoggedIn=false, calls the public endpoint, gets active:true, and
    // sets passwordOverrideActive=true → banner must be rendered.
    (global.fetch as Mock).mockImplementation(async (url: string) => {
      const path = typeof url === "string" ? url : String(url);

      if (path.includes("/api/admin/verify")) {
        throw new Error("Network error");
      }
      if (path.includes("/api/admin/public/password-override-active")) {
        return { ok: true, json: async () => ({ active: true }) };
      }
      return { ok: false, json: async () => ({}) };
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    // Allow both the rejected verify promise and the override-status fetch to settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    // isLoggedIn never flipped to true, so the login form (and banner) remain
    // in the DOM.  The banner must be present because override-status returned
    // active:true.
    await waitFor(
      () => {
        expect(
          screen.queryByTestId("alert-password-override-active"),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(
      screen.getByTestId("alert-password-override-active").textContent,
    ).toContain("ADMIN_PASSWORD");
  });
});

// ── Task #635 — banner clears after successful login ───────────────────────

describe("AdminDashboard — password-override-active banner clears after login (Task #635)", () => {
  it("banner is visible pre-login and disappears once the admin authenticates successfully", async () => {
    // Step 1: Mock fetch to surface the override banner AND handle the login
    // POST. All post-login data-loading calls return non-ok so they bail
    // early, keeping secondary state at null/[] without shape-mismatch crashes.
    (global.fetch as Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      const path = typeof url === "string" ? url : String(url);

      if (path.includes("/api/admin/public/password-override-active")) {
        return { ok: true, json: async () => ({ active: true }) };
      }
      if (path.includes("/api/admin/login")) {
        return { ok: true, json: async () => ({ token: "test-admin-token" }) };
      }
      // All authenticated data-loading calls — return non-ok so effects bail.
      return { ok: false, json: async () => ({}) };
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    // Step 2: Banner must be present on the login form before any interaction.
    await waitFor(
      () => {
        expect(
          screen.queryByTestId("alert-password-override-active"),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    // Step 3: Fill credentials and submit — triggers handleLogin which calls
    // /api/admin/login, stores the token, and sets isLoggedIn=true.
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

    // Step 4: isLoggedIn flips to true → the login form unmounts entirely →
    // the banner (which lives inside the !isLoggedIn early-return branch) must
    // no longer be in the DOM.
    await waitFor(
      () => {
        expect(
          screen.queryByTestId("alert-password-override-active"),
        ).toBeNull();
      },
      { timeout: 3000 },
    );
  });
});
