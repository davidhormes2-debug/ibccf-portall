// @vitest-environment jsdom
//
// Regression tests: DashboardView must render portal-skeleton-stat items while
// currentCase is null (data not yet loaded), and no skeleton once the case arrives.

import React from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ── Shared mocks (factories imported from dashboardMocks) ─────────────────────
// vi.mock() calls are hoisted by Vitest, so factories must use async imports to
// access dashboardMocks values — static imports would be undefined at hoist time.

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

vi.mock("@/hooks/use-toast", async () =>
  (await import("./dashboardMocks")).useToastMock,
);

vi.mock("@/hooks/use-chat-autoscroll", async () =>
  (await import("./dashboardMocks")).useChatAutoScrollMock,
);

vi.mock("@/lib/portalSession", async () =>
  (await import("./dashboardMocks")).portalSessionMock,
);

vi.mock("@/lib/withdrawalMode", () => ({
  getIsWithdrawalMode: () => false,
}));

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

vi.mock("@/i18n/format", async () =>
  (await import("./dashboardMocks")).i18nFormatMock,
);

vi.mock("wouter", async () =>
  (await import("./dashboardMocks")).wouterMock,
);

vi.mock("@tanstack/react-query", async () =>
  (await import("./dashboardMocks")).tanstackQueryMock,
);

vi.mock("@shared/stageInstructions", async () =>
  (await import("./dashboardMocks")).stageInstructionsMock,
);

vi.mock("@shared/tokenDeposit", async () =>
  (await import("./dashboardMocks")).tokenDepositMock,
);

vi.mock("@/components/portal/WithdrawalGuideBanner", () => ({
  WithdrawalGuideBanner: () => null,
}));

vi.mock("@/components/portal/withdrawal-video/WithdrawalTutorialButton", () => ({
  WithdrawalTutorialButton: () => null,
}));

vi.mock("@/components/portal/AccountHistoryCard", async () =>
  (await import("./dashboardMocks")).accountHistoryCardMock,
);

vi.mock("@/components/portal/LocalizedAmount", async () =>
  (await import("./dashboardMocks")).localizedAmountMock,
);

vi.mock("../WithdrawalRequestDialog", () => ({
  WithdrawalRequestDialog: () => null,
}));

vi.mock("../stageCta", async () =>
  (await import("./dashboardMocks")).stageCtaMock,
);

// ── Portal context stub ───────────────────────────────────────────────────────
// Kept inline so individual tests can mutate currentPortalStub before render.

let currentPortalStub: any;

vi.mock("../PortalContext", () => ({
  usePortal: () => currentPortalStub,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

let DashboardView: typeof import("../DashboardView").DashboardView;

async function loadComponent() {
  vi.resetModules();
  ({ DashboardView } = await import("../DashboardView"));
}

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  const { basePortalContextFields } = await import("./dashboardMocks");
  currentPortalStub = { ...basePortalContextFields, currentCase: null };
});

// Initialise stub before the first test runs.
beforeAll(async () => {
  const { basePortalContextFields } = await import("./dashboardMocks");
  currentPortalStub = { ...basePortalContextFields, currentCase: null };
});

// ── Loading skeleton ──────────────────────────────────────────────────────────

describe("DashboardView — loading skeleton", () => {
  it("renders portal-skeleton-stat items while currentCase is null", async () => {
    currentPortalStub = { ...currentPortalStub, currentCase: null };

    await loadComponent();
    render(<DashboardView />);

    const statSkeletons = screen.getAllByTestId("portal-skeleton-stat");
    expect(statSkeletons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the dashboard-loading wrapper while currentCase is null", async () => {
    currentPortalStub = { ...currentPortalStub, currentCase: null };

    await loadComponent();
    render(<DashboardView />);

    expect(screen.getByTestId("dashboard-loading")).toBeTruthy();
  });

  it("renders role=status loading wrappers while loading", async () => {
    currentPortalStub = { ...currentPortalStub, currentCase: null };

    await loadComponent();
    render(<DashboardView />);

    const statusEls = screen.getAllByRole("status");
    expect(statusEls.length).toBeGreaterThanOrEqual(1);
    expect(statusEls.every((el) => el.getAttribute("aria-label") === "Loading")).toBe(true);
  });

  it("does not render portal-skeleton-stat when currentCase is present", async () => {
    const { baseCaseFixture } = await import("./dashboardMocks");
    currentPortalStub = {
      ...currentPortalStub,
      currentCase: { ...baseCaseFixture },
    };

    await loadComponent();
    render(<DashboardView />);

    expect(screen.queryAllByTestId("portal-skeleton-stat")).toHaveLength(0);
  });
});
