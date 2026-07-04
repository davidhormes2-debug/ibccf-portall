// @vitest-environment jsdom
//
// Task #389 — AdminDashboard-level integration test for escape-hatch banners
//
// This test renders the REAL AdminDashboard component (not a harness wrapper)
// and verifies the full pipeline:
//
//   sessionStorage token → /api/admin/verify ok → isLoggedIn=true
//     → /api/admin/security-flags fetch → securityFlags state
//       → <WeakAdminPasswordBanner> / <WeakAdminUsernameBanner> rendered
//
// AdminDashboard's early return at !isLoggedIn ensures the banners are only
// visible after the session-restore flow completes — so the test genuinely
// exercises the useEffect wiring, setSecurityFlags, and the banner placement
// inside the real component.
//
// Heavy dependencies (recharts, framer-motion, i18next, complex sub-panels)
// are mocked so the 11 000-line component can render without a real DOM
// paint, browser canvas, or running server.

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

// ── module-level mocks  ────────────────────────────────────────────────────
// These are hoisted by Vitest's vi.mock so they run before the import below.

// useTheme throws if consumed outside ThemeContext — mock the whole module.
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
  const forward = ({ children, ...rest }: any) =>
    React.createElement("div", rest, children);
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

// Heavy admin sub-components — none are relevant to the banner wiring test.
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

// AdminDashboardContext — keep real banner components but stub out the
// context so sub-components that call useAdminDashboard don't blow up.
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

// ── helpers ────────────────────────────────────────────────────────────────

type FetchFlags = {
  weakAdminPasswordAllowed: boolean;
  weakAdminUsernameAllowed: boolean;
  weakSessionSecretAllowed?: boolean;
  isProduction?: boolean;
};

/**
 * Install a global fetch mock that handles the three key endpoints:
 *  - /api/admin/verify     → 200 ok, pretends the stored session is valid
 *  - /api/admin/security-flags → 200 with the supplied flags payload
 *  - everything else       → 200 with an empty array / object so the many
 *    other useEffect fetches in AdminDashboard don't throw
 */
function mockFetch(flags: FetchFlags) {
  (global.fetch as Mock).mockImplementation(async (url: string) => {
    const path = typeof url === "string" ? url : String(url);

    if (path.includes("/api/admin/verify")) {
      return { ok: true, json: async () => ({ valid: true }) };
    }
    if (path.includes("/api/admin/security-flags")) {
      return {
        ok: true,
        json: async () => ({
          weakAdminPasswordAllowed: flags.weakAdminPasswordAllowed,
          weakAdminUsernameAllowed: flags.weakAdminUsernameAllowed,
          weakSessionSecretAllowed: flags.weakSessionSecretAllowed ?? false,
          isProduction: flags.isProduction ?? false,
        }),
      };
    }
    // Catch-all: return non-ok so every other data-loading useEffect in
    // AdminDashboard bails out early (they all guard on !res.ok).
    // This keeps all secondary state at its null/[] initial value,
    // which prevents shape-mismatch crashes from unrelated render paths.
    return { ok: false, json: async () => ({}) };
  });
}

// ── setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  sessionStorage.clear();
  // Pre-load a fake admin token so the session-restore useEffect
  // immediately calls /api/admin/verify (no login form interaction needed).
  sessionStorage.setItem("adminToken", "test-admin-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  sessionStorage.clear();
});

// ── tests ─────────────────────────────────────────────────────────────────

describe("AdminDashboard — escape-hatch banner rendering from /api/admin/security-flags", () => {
  it("renders banner-weak-admin-password when the endpoint returns weakAdminPasswordAllowed: true", async () => {
    mockFetch({ weakAdminPasswordAllowed: true, weakAdminUsernameAllowed: false });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("banner-weak-admin-password"),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(
      screen.getByTestId("banner-weak-admin-password").textContent,
    ).toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
  });

  it("does NOT render banner-weak-admin-password when the endpoint returns weakAdminPasswordAllowed: false", async () => {
    mockFetch({ weakAdminPasswordAllowed: false, weakAdminUsernameAllowed: false });

    await act(async () => {
      render(<AdminDashboard />);
    });

    // Allow async effects to settle; banner must NOT appear.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).toBeNull();
  });

  it("renders banner-weak-admin-username when the endpoint returns weakAdminUsernameAllowed: true", async () => {
    mockFetch({ weakAdminPasswordAllowed: false, weakAdminUsernameAllowed: true });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("banner-weak-admin-username"),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(
      screen.getByTestId("banner-weak-admin-username").textContent,
    ).toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
  });

  it("does NOT render banner-weak-admin-username when the endpoint returns weakAdminUsernameAllowed: false", async () => {
    mockFetch({ weakAdminPasswordAllowed: false, weakAdminUsernameAllowed: false });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(screen.queryByTestId("banner-weak-admin-username")).toBeNull();
  });

  it("renders both banners simultaneously when both flags are true", async () => {
    mockFetch({ weakAdminPasswordAllowed: true, weakAdminUsernameAllowed: true });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
        expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
      },
      { timeout: 3000 },
    );
  });
});

describe("AdminDashboard — banners are undismissable", () => {
  it("banner-weak-admin-password has no dismiss button", async () => {
    mockFetch({ weakAdminPasswordAllowed: true, weakAdminUsernameAllowed: false });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(
      screen.queryByTestId("button-dismiss-weak-admin-password-banner"),
    ).toBeNull();
  });

  it("banner-weak-admin-username has no dismiss button", async () => {
    mockFetch({ weakAdminPasswordAllowed: false, weakAdminUsernameAllowed: true });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(
      screen.queryByTestId("button-dismiss-weak-admin-username-banner"),
    ).toBeNull();
  });

  it("both banners are shown and neither has a dismiss button when both flags are true", async () => {
    mockFetch({ weakAdminPasswordAllowed: true, weakAdminUsernameAllowed: true });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
        expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(
      screen.queryByTestId("button-dismiss-weak-admin-password-banner"),
    ).toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-admin-username-banner"),
    ).toBeNull();
  });
});

describe("AdminDashboard — WeakSessionSecretBanner rendering from /api/admin/security-flags", () => {
  it("renders banner-weak-session-secret when the endpoint returns weakSessionSecretAllowed: true", async () => {
    mockFetch({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: true,
      isProduction: false,
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("banner-weak-session-secret"),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(
      screen.getByTestId("banner-weak-session-secret").textContent,
    ).toContain("ALLOW_WEAK_SESSION_SECRET=1");
  });

  it("does NOT render banner-weak-session-secret when the endpoint returns weakSessionSecretAllowed: false", async () => {
    mockFetch({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
      isProduction: false,
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(screen.queryByTestId("banner-weak-session-secret")).toBeNull();
  });

  it("banner-weak-session-secret contains 'production' when isProduction: true", async () => {
    mockFetch({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: true,
      isProduction: true,
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("banner-weak-session-secret"),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(
      screen.getByTestId("banner-weak-session-secret").textContent,
    ).toContain("production");
  });

  it("banner-weak-session-secret has no dismiss button", async () => {
    mockFetch({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: true,
      isProduction: false,
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("banner-weak-session-secret"),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(
      screen.queryByTestId("button-dismiss-weak-session-secret-banner"),
    ).toBeNull();
  });

  it("banner-weak-session-secret remains visible on remount within the same session (no dismiss mechanism)", async () => {
    mockFetch({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: true,
      isProduction: true,
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("banner-weak-session-secret"),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    cleanup();

    mockFetch({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: true,
      isProduction: true,
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("banner-weak-session-secret"),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(
      screen.getByTestId("banner-weak-session-secret").textContent,
    ).toContain("production");
  });
});

// ---------------------------------------------------------------------------
// was-hidden guard: a bare focus / visibilitychange event that never
// transitioned the tab through "hidden" must NOT trigger a second
// security-flags fetch.
// ---------------------------------------------------------------------------

describe("AdminDashboard — security-flags was-hidden guard", () => {
  it("does not re-fetch on a focus event when the tab was never hidden", async () => {
    let callCount = 0;
    (global.fetch as Mock).mockImplementation(async (url: string) => {
      const path = typeof url === "string" ? url : String(url);
      if (path.includes("/api/admin/verify")) {
        return { ok: true, json: async () => ({ valid: true }) };
      }
      if (path.includes("/api/admin/security-flags")) {
        callCount += 1;
        return {
          ok: true,
          json: async () => ({
            weakAdminPasswordAllowed: callCount >= 2,
            weakAdminUsernameAllowed: false,
            weakSessionSecretAllowed: false,
            isProduction: false,
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    // Wait for the initial fetch to settle; banner should be absent (callCount=1 → false).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(screen.queryByTestId("banner-weak-admin-password")).toBeNull();

    // Dispatch a bare focus event — tab was never marked hidden, so wasHidden=false.
    // The guard must suppress the fetch entirely.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((r) => setTimeout(r, 200));
    });

    // Banner must still be absent: if a second fetch had fired it would now
    // return callCount>=2 → true and render the banner.
    expect(screen.queryByTestId("banner-weak-admin-password")).toBeNull();
    expect(callCount).toBe(1);
  });

  it("does re-fetch when the tab transitions hidden → visible via visibilitychange", async () => {
    let callCount = 0;
    (global.fetch as Mock).mockImplementation(async (url: string) => {
      const path = typeof url === "string" ? url : String(url);
      if (path.includes("/api/admin/verify")) {
        return { ok: true, json: async () => ({ valid: true }) };
      }
      if (path.includes("/api/admin/security-flags")) {
        callCount += 1;
        return {
          ok: true,
          json: async () => ({
            weakAdminPasswordAllowed: callCount >= 2,
            weakAdminUsernameAllowed: false,
            weakSessionSecretAllowed: false,
            isProduction: false,
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    await act(async () => {
      render(<AdminDashboard />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(screen.queryByTestId("banner-weak-admin-password")).toBeNull();

    // Simulate tab going hidden → sets wasHidden=true.
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Simulate tab becoming visible → guard fires, fetch #2 happens.
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((r) => setTimeout(r, 200));
    });

    // Second fetch returned weakAdminPasswordAllowed: true → banner must appear.
    await waitFor(
      () => {
        expect(
          screen.queryByTestId("banner-weak-admin-password"),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );
    expect(callCount).toBe(2);
  });
});
