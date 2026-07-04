// @vitest-environment jsdom
//
// Regression tests: the "Proof submitted" indicator in the Batch Merge History
// section must:
//   - appear  when entry.fileName is set and status is pending
//   - be absent when status is approved, even with a fileName
//   - be absent when status is rejected, even with a fileName
//   - be absent when fileName is null/undefined (→ "Upload proof" state)

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Shared mocks ──────────────────────────────────────────────────────────────

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
      queries: { retry: false, gcTime: 0, staleTime: 0 },
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

/** Builds a fetch mock that returns `rows` for merge-fee history calls and an
 *  empty array for withdrawal-requests calls. */
function makeFetch(rows: object[]) {
  return vi.fn(async (url: string) => {
    if (String(url).includes("withdrawal-requests")) {
      return { ok: true, status: 200, json: async () => [] };
    }
    return { ok: true, status: 200, json: async () => rows };
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  currentCaseStub = null;
});

// ── "Proof submitted" indicator ───────────────────────────────────────────────

describe("WithdrawalView — batch-history proof-submitted indicator", () => {
  it("shows the indicator when fileName is set and status is pending", async () => {
    (global as any).fetch = makeFetch([
      {
        id: 10,
        category: "merge_fee",
        status: "pending",
        notes: "Batch 1: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        fileName: "proof.png",
      },
    ]);

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("batch-history-proof-submitted-10"),
      ).toBeTruthy();
    });
  });

  it("hides the indicator when status is approved, even with a fileName", async () => {
    (global as any).fetch = makeFetch([
      {
        id: 11,
        category: "merge_fee",
        status: "approved",
        notes: "Batch 2: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        fileName: "proof-approved.png",
      },
    ]);

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    // Wait for the row to be rendered (data loaded) before asserting absence.
    await screen.findByTestId("batch-history-row-11");
    expect(screen.queryByTestId("batch-history-proof-submitted-11")).toBeNull();
  });

  it("hides the indicator when status is rejected, even with a fileName", async () => {
    (global as any).fetch = makeFetch([
      {
        id: 12,
        category: "merge_fee",
        status: "rejected",
        notes: "Batch 3: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        fileName: "proof-rejected.png",
      },
    ]);

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    // Wait for the row to be rendered (data loaded) before asserting absence.
    await screen.findByTestId("batch-history-row-12");
    expect(screen.queryByTestId("batch-history-proof-submitted-12")).toBeNull();
  });

  it("hides the indicator when fileName is null (Upload proof button state)", async () => {
    (global as any).fetch = makeFetch([
      {
        id: 13,
        category: "merge_fee",
        status: "pending",
        notes: "Batch 4: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        fileName: null,
      },
    ]);

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    // Wait for the row to be rendered (data loaded) before asserting absence.
    await screen.findByTestId("batch-history-row-13");
    expect(screen.queryByTestId("batch-history-proof-submitted-13")).toBeNull();
  });

  it("hides the indicator when fileName is undefined", async () => {
    (global as any).fetch = makeFetch([
      {
        id: 14,
        category: "merge_fee",
        status: "pending",
        notes: "Batch 5: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        // fileName intentionally omitted
      },
    ]);

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    // Wait for the row to be rendered (data loaded) before asserting absence.
    await screen.findByTestId("batch-history-row-14");
    expect(screen.queryByTestId("batch-history-proof-submitted-14")).toBeNull();
  });

  it("shows the Upload-proof button and hides the indicator when the pending+no-file row is the only entry", async () => {
    (global as any).fetch = makeFetch([
      {
        id: 40,
        category: "merge_fee",
        status: "pending",
        notes: "Batch Solo: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        fileName: null,
      },
    ]);

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    await screen.findByTestId("batch-history-row-40");
    expect(screen.getByTestId("batch-history-upload-40")).toBeTruthy();
    expect(screen.queryByTestId("batch-history-proof-submitted-40")).toBeNull();
  });

  it("shows Upload-proof button on null-file row, indicator on pending+file row, neither on approved+file row", async () => {
    (global as any).fetch = makeFetch([
      {
        id: 30,
        category: "merge_fee",
        status: "pending",
        notes: "Batch X: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        fileName: null,
      },
      {
        id: 31,
        category: "merge_fee",
        status: "pending",
        notes: "Batch Y: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        fileName: "proof-y.png",
      },
      {
        id: 32,
        category: "merge_fee",
        status: "approved",
        notes: "Batch Z: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        fileName: "proof-z.png",
      },
    ]);

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    // Wait for all three rows to be rendered.
    await screen.findByTestId("batch-history-row-30");
    await screen.findByTestId("batch-history-row-31");
    await screen.findByTestId("batch-history-row-32");

    // Row 30: pending + no file → Upload proof button present, indicator absent.
    expect(screen.getByTestId("batch-history-upload-30")).toBeTruthy();
    expect(screen.queryByTestId("batch-history-proof-submitted-30")).toBeNull();

    // Row 31: pending + file → indicator present, Upload proof button absent.
    expect(screen.getByTestId("batch-history-proof-submitted-31")).toBeTruthy();
    expect(screen.queryByTestId("batch-history-upload-31")).toBeNull();

    // Row 32: approved + file → neither upload button nor indicator.
    expect(screen.queryByTestId("batch-history-upload-32")).toBeNull();
    expect(screen.queryByTestId("batch-history-proof-submitted-32")).toBeNull();
  });

  it("shows the indicator for the pending entry but not for approved/rejected siblings", async () => {
    (global as any).fetch = makeFetch([
      {
        id: 20,
        category: "merge_fee",
        status: "pending",
        notes: "Batch A: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        fileName: "proof-a.png",
      },
      {
        id: 21,
        category: "merge_fee",
        status: "approved",
        notes: "Batch B: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        fileName: "proof-b.png",
      },
      {
        id: 22,
        category: "merge_fee",
        status: "rejected",
        notes: "Batch C: 50,000 USDT",
        uploadedAt: new Date().toISOString(),
        fileName: "proof-c.png",
      },
    ]);

    currentCaseStub = caseFixture();
    await loadComponent();

    render(
      <Wrapper>
        <WithdrawalView />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("batch-history-proof-submitted-20")).toBeTruthy();
      expect(screen.queryByTestId("batch-history-proof-submitted-21")).toBeNull();
      expect(screen.queryByTestId("batch-history-proof-submitted-22")).toBeNull();
    });
  });
});
