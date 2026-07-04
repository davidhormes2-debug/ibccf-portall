// @vitest-environment jsdom
//
// Task #312 — Automated regression tests for the Withdrawal Guide banner toggle
// in the portal dashboard.
//
// These tests render the REAL DashboardView component (not a stub) with a
// mocked PortalContext so the actual conditional:
//
//   {currentCase?.withdrawalGuideVisible && <WithdrawalGuideBanner />}
//
// is exercised end-to-end inside the real component tree.  The two core
// assertions mirror the task's acceptance criteria:
//
//   1. When withdrawalGuideVisible is true  → [data-testid="banner-withdrawal-guide"] is in the DOM.
//   2. When withdrawalGuideVisible is false → [data-testid="banner-withdrawal-guide"] is absent.
//
// The server-side exposure of withdrawalGuideVisible via the portal GET
// endpoint is already covered by the supertest suite in
// server/__tests__/cases.withdrawalGuide.test.ts.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must all precede any import of DashboardView.
// Shared implementations come from dashboardMocks via async factories so they
// survive Vitest's hoisting of vi.mock() calls above static imports.
// ---------------------------------------------------------------------------

vi.mock("framer-motion", async () =>
  (await import("./dashboardMocks")).framerMotionMock,
);

vi.mock("react-i18next", async () =>
  (await import("./dashboardMocks")).reactI18nextMock,
);

vi.mock("@/i18n/useLocale", async () =>
  (await import("./dashboardMocks")).useLocaleMock,
);

vi.mock("@/i18n", async () =>
  (await import("./dashboardMocks")).i18nMock,
);

vi.mock("wouter", async () =>
  (await import("./dashboardMocks")).wouterMock,
);

vi.mock("@/hooks/use-toast", async () =>
  (await import("./dashboardMocks")).useToastMock,
);

vi.mock("@/hooks/use-chat-autoscroll", async () =>
  (await import("./dashboardMocks")).useChatAutoScrollMock,
);

vi.mock("@/lib/stageHistory", async () =>
  (await import("./dashboardMocks")).stageHistoryMock,
);

vi.mock("@/lib/payoutWalletHistory", async () =>
  (await import("./dashboardMocks")).payoutWalletHistoryMock,
);

vi.mock("@/lib/stampDutyHistory", async () =>
  (await import("./dashboardMocks")).stampDutyHistoryMock,
);

vi.mock("@/lib/withdrawalActivationHistory", async () =>
  (await import("./dashboardMocks")).withdrawalActivationHistoryMock,
);

vi.mock("@/lib/withdrawalRequestHistory", async () =>
  (await import("./dashboardMocks")).withdrawalRequestHistoryMock,
);

vi.mock("@shared/stageInstructions", async () =>
  (await import("./dashboardMocks")).stageInstructionsMock,
);

vi.mock("@/i18n/format", async () =>
  (await import("./dashboardMocks")).i18nFormatMock,
);

vi.mock("@/components/portal/LocalizedAmount", async () =>
  (await import("./dashboardMocks")).localizedAmountMock,
);

vi.mock("@/components/portal/AccountHistoryCard", async () =>
  (await import("./dashboardMocks")).accountHistoryCardMock,
);

vi.mock("@tanstack/react-query", async () =>
  (await import("./dashboardMocks")).tanstackQueryMock,
);

vi.mock("@/lib/portalSession", async () =>
  (await import("./dashboardMocks")).portalSessionMock,
);

vi.mock("../stageCta", async () =>
  (await import("./dashboardMocks")).stageCtaMock,
);

// shadcn/ui primitives — from dashboardMocks.
vi.mock("@/components/ui/button", async () =>
  (await import("./dashboardMocks")).uiButtonMock,
);

vi.mock("@/components/ui/badge", async () =>
  (await import("./dashboardMocks")).uiBadgeMock,
);

vi.mock("@/components/ui/input", async () =>
  (await import("./dashboardMocks")).uiInputMock,
);

vi.mock("@/components/ui/textarea", async () =>
  (await import("./dashboardMocks")).uiTextareaMock,
);

vi.mock("@/components/ui/dialog", async () =>
  (await import("./dashboardMocks")).uiDialogMock,
);

// Global fetch stub so no real requests are made during tests.
global.fetch = vi.fn(async () => ({
  ok: false,
  json: async () => ({}),
})) as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Portal context — the key mock.  currentCaseMock is mutated per test.
// ---------------------------------------------------------------------------
let currentCaseMock: Record<string, unknown> = {};

vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: currentCaseMock,
    adminMessages: [],
    submissions: [],
    depositReceipts: [],
    chatMessages: [],
    unreadCount: 0,
    unreadAdminMessages: 0,
    isChatOpen: false,
    setIsChatOpen: vi.fn(),
    sendMessage: vi.fn(),
    setViewState: vi.fn(),
    hasUrgentMessages: false,
    keyRequestNotification: null,
    dismissKeyRequestNotification: vi.fn(),
    declaration: null,
    documentRequests: [],
    refreshDeclaration: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Import the component under test — AFTER all vi.mock calls.
// ---------------------------------------------------------------------------
import { DashboardView } from "../DashboardView";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseCase = {
  id: "case-312",
  accessCode: "TASK-0312",
  status: "active" as const,
  userName: "Test User",
  userEmail: "test@example.com",
  vipStatus: "Standard",
  letterSent: false,
  declarationStatus: "not_requested",
  withdrawalGuideVisible: false,
};

function renderDashboard() {
  return render(<DashboardView />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  currentCaseMock = { ...baseCase };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DashboardView — Withdrawal Guide banner visible (withdrawalGuideVisible: true) (Task #312)", () => {
  it("renders [data-testid='banner-withdrawal-guide'] when withdrawalGuideVisible is true", () => {
    currentCaseMock = { ...baseCase, withdrawalGuideVisible: true };
    renderDashboard();
    expect(screen.getByTestId("banner-withdrawal-guide")).toBeTruthy();
  });

  it("banner-withdrawal-guide element is present in the document when flag is true", () => {
    currentCaseMock = { ...baseCase, withdrawalGuideVisible: true };
    renderDashboard();
    const banner = screen.queryByTestId("banner-withdrawal-guide");
    expect(banner).not.toBeNull();
  });

  it("banner contains expected heading text key when withdrawalGuideVisible is true", () => {
    currentCaseMock = { ...baseCase, withdrawalGuideVisible: true };
    renderDashboard();
    const banner = screen.getByTestId("banner-withdrawal-guide");
    // t() returns the key verbatim in our mock
    expect(banner.textContent).toMatch(/dashboard\.withdrawalGuide/);
  });
});

describe("DashboardView — Withdrawal Guide banner absent (withdrawalGuideVisible: false) (Task #312)", () => {
  it("does NOT render [data-testid='banner-withdrawal-guide'] when withdrawalGuideVisible is false", () => {
    currentCaseMock = { ...baseCase, withdrawalGuideVisible: false };
    renderDashboard();
    expect(screen.queryByTestId("banner-withdrawal-guide")).toBeNull();
  });

  it("does NOT render the banner when withdrawalGuideVisible is null", () => {
    currentCaseMock = { ...baseCase, withdrawalGuideVisible: null };
    renderDashboard();
    expect(screen.queryByTestId("banner-withdrawal-guide")).toBeNull();
  });

  it("does NOT render the banner when withdrawalGuideVisible is absent from the case", () => {
    const { withdrawalGuideVisible: _omit, ...caseWithoutFlag } = baseCase;
    currentCaseMock = caseWithoutFlag;
    renderDashboard();
    expect(screen.queryByTestId("banner-withdrawal-guide")).toBeNull();
  });

  it("dashboard root renders even when the banner is absent", () => {
    currentCaseMock = { ...baseCase, withdrawalGuideVisible: false };
    renderDashboard();
    // DashboardView always renders a containing div — confirms render didn't crash.
    expect(document.querySelector(".p-4")).toBeTruthy();
  });
});

describe("DashboardView — toggle round-trip (true then false) (Task #312)", () => {
  it("shows banner when true, hides it when false in successive renders", () => {
    currentCaseMock = { ...baseCase, withdrawalGuideVisible: true };
    const { unmount } = renderDashboard();
    expect(screen.getByTestId("banner-withdrawal-guide")).toBeTruthy();
    unmount();
    cleanup();

    currentCaseMock = { ...baseCase, withdrawalGuideVisible: false };
    renderDashboard();
    expect(screen.queryByTestId("banner-withdrawal-guide")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task #366 — custom withdrawalGuideBody copy renders, replacing default steps
// ---------------------------------------------------------------------------

describe("WithdrawalGuideBanner — custom withdrawalGuideBody (Task #366)", () => {
  it("renders the custom body and omits the default step list when withdrawalGuideBody is non-empty", () => {
    const customCopy =
      "Please upload the stamped FATCA form and re-verify your tax residency before the next review window.";
    currentCaseMock = {
      ...baseCase,
      withdrawalGuideVisible: true,
      withdrawalGuideBody: customCopy,
    };
    renderDashboard();

    const body = screen.getByTestId("withdrawal-guide-custom-body");
    expect(body).toBeTruthy();
    expect(body.textContent).toBe(customCopy);
    expect(screen.queryByTestId("withdrawal-guide-steps")).toBeNull();
  });

  it("renders the default step list when withdrawalGuideBody is null", () => {
    currentCaseMock = {
      ...baseCase,
      withdrawalGuideVisible: true,
      withdrawalGuideBody: null,
    };
    renderDashboard();

    expect(screen.getByTestId("withdrawal-guide-steps")).toBeTruthy();
    expect(screen.queryByTestId("withdrawal-guide-custom-body")).toBeNull();
  });

  it("renders the default step list when withdrawalGuideBody is absent from the case", () => {
    currentCaseMock = {
      ...baseCase,
      withdrawalGuideVisible: true,
    };
    renderDashboard();

    expect(screen.getByTestId("withdrawal-guide-steps")).toBeTruthy();
    expect(screen.queryByTestId("withdrawal-guide-custom-body")).toBeNull();
  });

  it("renders the default step list when withdrawalGuideBody is an empty string", () => {
    currentCaseMock = {
      ...baseCase,
      withdrawalGuideVisible: true,
      withdrawalGuideBody: "",
    };
    renderDashboard();

    expect(screen.getByTestId("withdrawal-guide-steps")).toBeTruthy();
    expect(screen.queryByTestId("withdrawal-guide-custom-body")).toBeNull();
  });

  it("renders the default step list when withdrawalGuideBody is whitespace only", () => {
    currentCaseMock = {
      ...baseCase,
      withdrawalGuideVisible: true,
      withdrawalGuideBody: "   \n  \t ",
    };
    renderDashboard();

    expect(screen.getByTestId("withdrawal-guide-steps")).toBeTruthy();
    expect(screen.queryByTestId("withdrawal-guide-custom-body")).toBeNull();
  });

  it("preserves newline characters in custom body (whitespace-pre-wrap)", () => {
    const multiline = "Line one.\nLine two.\nLine three.";
    currentCaseMock = {
      ...baseCase,
      withdrawalGuideVisible: true,
      withdrawalGuideBody: multiline,
    };
    renderDashboard();

    const body = screen.getByTestId("withdrawal-guide-custom-body");
    expect(body.textContent).toBe(multiline);
  });
});
