// @vitest-environment jsdom
//
// SecurePortal deep-link lockout guard — regression tests.
//
// Verifies that when `currentCase.isDisabled === true` the portal renders the
// `reactivationDeposit` auth view regardless of the current `viewState`, and
// that enabled accounts continue to render portal content normally.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// vi.hoisted — runs before ANY vi.mock factory, so make stubs here
// ---------------------------------------------------------------------------
const { mockState, makeStub } = vi.hoisted(() => {
  const mockState = { viewState: "dashboard", currentCase: null as any };

  function makeStub(testId: string) {
    return function Stub() {
      return React.createElement("div", { "data-testid": testId });
    };
  }

  return { mockState, makeStub };
});

// ---------------------------------------------------------------------------
// Minimal environment polyfills
// ---------------------------------------------------------------------------
vi.hoisted(() => {
  if (typeof window !== "undefined" && !window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as any;
  }
});

// ---------------------------------------------------------------------------
// Third-party mocks
// ---------------------------------------------------------------------------
vi.mock("framer-motion", () => {
  function passthrough(tag: string) {
    function C({ children, ...rest }: any) {
      const clean = Object.fromEntries(
        Object.entries(rest).filter(
          ([k]) =>
            !k.startsWith("animate") &&
            !k.startsWith("initial") &&
            !k.startsWith("exit") &&
            !k.startsWith("transition") &&
            k !== "variants" &&
            k !== "style",
        ),
      );
      return React.createElement(tag as any, clean, children);
    }
    return C;
  }
  return {
    motion: new Proxy({} as any, {
      get: (_t: any, prop: string) => passthrough(prop),
    }),
    AnimatePresence: ({ children }: any) =>
      React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

vi.mock("@/components/PremiumBackground", () => ({
  PremiumBackground: () => null,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/portal", () => {}],
  useRoute: () => [false, {}],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {}, dismiss: () => {}, toasts: [] }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  Trans: ({ i18nKey }: any) => React.createElement(React.Fragment, null, i18nKey),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// ---------------------------------------------------------------------------
// Portal mocks
//
// SecurePortal imports views from the barrel ("./portal/index.tsx"). The barrel
// re-exports each view from its own file. Mocking the individual source files
// (not the barrel) is the reliable way to stub the components that SecurePortal
// renders — vitest resolves both the direct and barrel-mediated paths to the
// same absolute file ID, so the stubs win.
// ---------------------------------------------------------------------------

// PortalContext — provides PortalProvider + usePortal
vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    viewState: mockState.viewState,
    currentCase: mockState.currentCase,
    accessCode: "TEST-CODE",
    setViewState: () => {},
    setAccessCode: () => {},
    setCurrentCase: () => {},
    logout: () => {},
  }),
  PortalProvider: ({ children }: any) =>
    React.createElement(React.Fragment, null, children),
}));

// Auth views (LoginView, RegisterView, SyncView come from AuthViews)
vi.mock("../AuthViews", () => ({
  LoginView: makeStub("view-login"),
  RegisterView: makeStub("view-register"),
  SyncView: makeStub("view-sync"),
}));

vi.mock("../SessionRefreshView", () => ({
  SessionRefreshView: makeStub("view-session-refresh"),
}));

vi.mock("../PortalRefreshView", () => ({
  PortalRefreshView: makeStub("view-portal-refresh"),
}));

vi.mock("../ReactivationDepositView", () => ({
  ReactivationDepositView: makeStub("view-reactivation-deposit"),
}));

// Portal views
vi.mock("../DashboardView", () => ({
  DashboardView: makeStub("view-dashboard"),
}));

vi.mock("../MessagesView", () => ({
  MessagesView: makeStub("view-messages"),
}));

vi.mock("../DepositView", () => ({
  DepositView: makeStub("view-deposit"),
}));

vi.mock("../StatusViews", () => ({
  SuccessView: makeStub("view-success"),
  TimelineView: makeStub("view-timeline"),
}));

vi.mock("../SubmissionsView", () => ({
  SubmissionsView: makeStub("view-submissions"),
}));

vi.mock("../LetterView", () => ({
  LetterView: makeStub("view-letter"),
}));

vi.mock("../KeyRequestView", () => ({
  KeyRequestView: makeStub("view-key-request"),
}));

vi.mock("../DeclarationView", () => ({
  DeclarationView: makeStub("view-declaration"),
}));

vi.mock("../DocumentsView", () => ({
  DocumentsView: makeStub("view-documents"),
}));

vi.mock("../SettingsView", () => ({
  SettingsView: makeStub("view-settings"),
}));

vi.mock("../SealedView", () => ({
  SealedView: makeStub("view-sealed"),
}));

vi.mock("../WithdrawalActivationView", () => ({
  WithdrawalActivationView: makeStub("view-withdrawal-activation"),
}));

vi.mock("../CertificateView", () => ({
  CertificateView: makeStub("view-certificate"),
}));

vi.mock("../WalletConnectView", () => ({
  WalletConnectView: makeStub("view-wallet-connect"),
}));

vi.mock("../WithdrawalView", () => ({
  WithdrawalView: makeStub("view-withdrawal"),
}));

vi.mock("../RefundClaimView", () => ({
  RefundClaimView: makeStub("view-refund-claim"),
}));

// PortalShell — imported directly (not through the barrel)
vi.mock("../PortalShell", () => ({
  PortalShell: ({ children }: any) =>
    React.createElement("div", { "data-testid": "portal-shell" }, children),
}));

// ---------------------------------------------------------------------------
// Component under test — imported AFTER all mocks are registered
// ---------------------------------------------------------------------------
import SecurePortal from "../../SecurePortal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeCase(isDisabled: boolean): any {
  return {
    id: "case-1",
    accessCode: "TEST-CODE",
    isDisabled,
    withdrawalStage: 3,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockState.viewState = "dashboard";
  mockState.currentCase = null;
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SecurePortal deep-link lockout guard", () => {
  it("renders reactivationDeposit when case is disabled and viewState is 'dashboard'", () => {
    mockState.currentCase = makeCase(true);
    mockState.viewState = "dashboard";
    render(<SecurePortal />);
    expect(screen.getByTestId("view-reactivation-deposit")).toBeTruthy();
    expect(screen.queryByTestId("view-dashboard")).toBeNull();
  });

  it("renders reactivationDeposit when case is disabled and viewState is 'messages'", () => {
    mockState.currentCase = makeCase(true);
    mockState.viewState = "messages";
    render(<SecurePortal />);
    expect(screen.getByTestId("view-reactivation-deposit")).toBeTruthy();
    expect(screen.queryByTestId("view-messages")).toBeNull();
  });

  it("renders reactivationDeposit when case is disabled and viewState is 'deposit'", () => {
    mockState.currentCase = makeCase(true);
    mockState.viewState = "deposit";
    render(<SecurePortal />);
    expect(screen.getByTestId("view-reactivation-deposit")).toBeTruthy();
    expect(screen.queryByTestId("view-deposit")).toBeNull();
  });

  it("does NOT override when the case is enabled — portal renders normally", () => {
    mockState.currentCase = makeCase(false);
    mockState.viewState = "dashboard";
    render(<SecurePortal />);
    expect(screen.getByTestId("portal-shell")).toBeTruthy();
    expect(screen.getByTestId("view-dashboard")).toBeTruthy();
    expect(screen.queryByTestId("view-reactivation-deposit")).toBeNull();
  });

  it("renders login when currentCase is null (unauthenticated)", () => {
    mockState.currentCase = null;
    mockState.viewState = "login";
    render(<SecurePortal />);
    expect(screen.getByTestId("view-login")).toBeTruthy();
    expect(screen.queryByTestId("view-reactivation-deposit")).toBeNull();
  });

  it("passes through to reactivationDeposit auth view when case is disabled and already on that view", () => {
    mockState.currentCase = makeCase(true);
    mockState.viewState = "reactivationDeposit";
    render(<SecurePortal />);
    expect(screen.getByTestId("view-reactivation-deposit")).toBeTruthy();
  });

  // Task #2319 — reverse guard: an enabled account with a valid, loaded
  // session must never be stranded on the reactivationDeposit auth view
  // (e.g. from a stale redirect or a race with a reactivation completing
  // elsewhere). It must be routed back into the portal instead.
  it("redirects an enabled account with a loaded session away from reactivationDeposit back to the dashboard", () => {
    mockState.currentCase = makeCase(false);
    mockState.viewState = "reactivationDeposit";
    render(<SecurePortal />);
    expect(screen.getByTestId("portal-shell")).toBeTruthy();
    expect(screen.getByTestId("view-dashboard")).toBeTruthy();
    expect(screen.queryByTestId("view-reactivation-deposit")).toBeNull();
  });

  it("still renders reactivationDeposit when on that view and there is no loaded session yet (currentCase is null)", () => {
    mockState.currentCase = null;
    mockState.viewState = "reactivationDeposit";
    render(<SecurePortal />);
    expect(screen.getByTestId("view-reactivation-deposit")).toBeTruthy();
    expect(screen.queryByTestId("view-dashboard")).toBeNull();
  });
});
