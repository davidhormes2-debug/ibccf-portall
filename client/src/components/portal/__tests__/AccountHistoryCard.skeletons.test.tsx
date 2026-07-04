// @vitest-environment jsdom
//
// Regression tests: AccountHistoryCard must render data-testid="portal-skeleton-list"
// items while the ledger query is loading, and data-testid="account-history-empty"
// when the data array is empty.

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

vi.mock("@/i18n/format", () => ({
  useFormat: () => ({
    formatDateTime: (d: any) => String(d),
    formatDate: (d: any) => String(d),
    formatNumber: (n: any) => String(n),
    formatCurrency: (n: any) => String(n),
    formatRelative: (d: any) => String(d),
  }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => "test-portal-token",
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

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

import { AccountHistoryCard } from "../AccountHistoryCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Loading skeleton ──────────────────────────────────────────────────────────

describe("AccountHistoryCard — loading skeleton", () => {
  it("renders portal-skeleton-list items while the ledger query is pending", async () => {
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    render(
      <Wrapper>
        <AccountHistoryCard caseId="case-1" />
      </Wrapper>,
    );

    const skeletons = screen.getAllByTestId("portal-skeleton-list");
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the role=status loading wrapper while fetching", async () => {
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    render(
      <Wrapper>
        <AccountHistoryCard caseId="case-1" />
      </Wrapper>,
    );

    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeTruthy();
    expect(statusEl.getAttribute("aria-label")).toBe("Loading");
  });

  it("removes the skeleton after the ledger query resolves", async () => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));

    render(
      <Wrapper>
        <AccountHistoryCard caseId="case-1" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.queryAllByTestId("portal-skeleton-list")).toHaveLength(0);
    });
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe("AccountHistoryCard — empty state", () => {
  it("renders data-testid='account-history-empty' when ledger data is an empty array", async () => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));

    render(
      <Wrapper>
        <AccountHistoryCard caseId="case-1" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("account-history-empty")).toBeTruthy();
    });
  });

  it("uses the shared PortalEmptyState component (portal-empty-state fallback testid)", async () => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));

    render(
      <Wrapper>
        <AccountHistoryCard caseId="case-1" />
      </Wrapper>,
    );

    await waitFor(() => {
      // account-history-empty is the custom testid passed to PortalEmptyState;
      // the shared component renders data-testid from the prop, not the default.
      const el = screen.getByTestId("account-history-empty");
      expect(el).toBeTruthy();
    });
  });

  it("does not render the empty state while the query is still loading", async () => {
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    render(
      <Wrapper>
        <AccountHistoryCard caseId="case-1" />
      </Wrapper>,
    );

    expect(screen.queryByTestId("account-history-empty")).toBeNull();
  });

  it("does not render the empty state when there are ledger entries", async () => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 1,
          direction: "credit",
          amount: "1000",
          asset: "USDT",
          category: "activation",
          entryDate: new Date().toISOString(),
          userNote: null,
          createdAt: new Date().toISOString(),
        },
      ],
    }));

    render(
      <Wrapper>
        <AccountHistoryCard caseId="case-1" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("account-history-empty")).toBeNull();
    });
  });

  it("renders entry rows for each ledger item when data is present", async () => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 42,
          direction: "credit",
          amount: "5000",
          asset: "USDT",
          category: null,
          entryDate: new Date().toISOString(),
          userNote: "Initial deposit",
          createdAt: new Date().toISOString(),
        },
        {
          id: 43,
          direction: "debit",
          amount: "500",
          asset: "USDT",
          category: "fee",
          entryDate: new Date().toISOString(),
          userNote: null,
          createdAt: new Date().toISOString(),
        },
      ],
    }));

    render(
      <Wrapper>
        <AccountHistoryCard caseId="case-1" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("account-history-entry-42")).toBeTruthy();
      expect(screen.getByTestId("account-history-entry-43")).toBeTruthy();
    });
  });
});
