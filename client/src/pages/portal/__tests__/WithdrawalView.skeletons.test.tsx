// @vitest-environment jsdom
//
// Regression tests: WithdrawalView must render data-testid="portal-skeleton-list"
// items inside the Batch Merge History card while the merge-fee history fetch
// is pending (isMergeFeeLoading = true), and no skeleton once data settles.

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Shared mocks ─────────────────────────────────────────────────────────────

vi.mock("framer-motion", () => {
  const passthrough = (Tag: keyof React.JSX.IntrinsicElements) => {
    const C = ({ children, ...rest }: any) =>
      React.createElement(Tag, rest, children);
    C.displayName = `motion.${String(Tag)}`;
    return C;
  };
  return {
    motion: new Proxy(
      {},
      { get: (_t, prop: string) => passthrough(prop as any) },
    ),
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) =>
      (opts && typeof opts === "object" && "defaultValue" in opts
        ? opts.defaultValue
        : key) as string,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => "test-portal-token",
}));

vi.mock("@/lib/batchAmountLabel", () => ({
  extractBatchAmountLabel: (notes: string | null) => notes ?? "",
}));

// WithdrawalRequestForm — heavy sub-component; stub it out entirely.
vi.mock("../WithdrawalRequestForm", () => ({
  WithdrawalRequestForm: () => null,
}));

let currentCaseStub: any = null;
vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: currentCaseStub,
    setViewState: vi.fn(),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function caseFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-1",
    accessCode: "ABCD-1234",
    withdrawalWindowEnabled: true,
    walletPhraseEnabled: false,
    walletExchangeName: null,
    preferredDepositAsset: "USDT",
    preferredDepositNetwork: "TRC20",
    ...overrides,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

let WithdrawalView: typeof import("../WithdrawalView").WithdrawalView;

async function loadComponent() {
  vi.resetModules();
  ({ WithdrawalView } = await import("../WithdrawalView"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  currentCaseStub = null;
});

// ── Batch merge history — loading skeleton ────────────────────────────────────

describe("WithdrawalView — batch merge history loading skeleton", () => {
  it("renders portal-skeleton-list items while the merge-fee history fetch is pending", async () => {
    // Freeze fetch so isMergeFeeLoading stays true.
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    const skeletons = screen.getAllByTestId("portal-skeleton-list");
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the role=status loading wrapper while fetching", async () => {
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeTruthy();
    expect(statusEl.getAttribute("aria-label")).toBe("Loading");
  });

  it("removes the skeleton after the fetch resolves with an empty array", async () => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.queryAllByTestId("portal-skeleton-list")).toHaveLength(0);
    });
  });

  it("removes the skeleton after the fetch resolves with merge-fee rows", async () => {
    (global as any).fetch = vi.fn(async (url: string) => {
      const isWithdrawalReqs = String(url).includes("withdrawal-requests");
      if (isWithdrawalReqs) {
        return { ok: true, status: 200, json: async () => [] };
      }
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 3,
            category: "merge_fee",
            status: "pending",
            notes: "Batch 1: 50,000 USDT",
            uploadedAt: new Date().toISOString(),
            fileName: "merge-proof.png",
          },
        ],
      };
    });

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.queryAllByTestId("portal-skeleton-list")).toHaveLength(0);
    });
  });
});
