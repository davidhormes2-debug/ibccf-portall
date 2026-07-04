// @vitest-environment jsdom
//
// Regression tests: CertificateView must render the payment-history skeleton
// (data-testid="certificate-payment-history-skeleton") while loading=true and
// payments=[], and must NOT render it once loading completes or payments arrive.
//
// The component also has a fee-section skeleton (`loading && !fee`) so tests
// are scoped to the payment-history container to avoid false passes from that
// sibling skeleton.

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

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

vi.mock("@/lib/withdrawalMode", () => ({
  getIsWithdrawalMode: () => false,
}));

let currentCaseStub: any = {
  id: "case-1",
  accessCode: "ABCD-1234",
  certificateEnabled: true,
  certificateFeeStatus: "awaiting_admin_approval",
};

vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: currentCaseStub,
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const feeFixture = {
  percent: "1.5",
  amountUsdt: "750",
  baseAmountUsed: "50000",
  status: "awaiting_admin_approval" as const,
  approvedAt: null,
  depositAddress: "CERT-WALLET-ADDRESS",
  depositAsset: "USDT",
  depositNetwork: "TRC20",
};

function makeFetch(feeBody: any, paymentsBody: any) {
  return vi.fn(async (url: string) => {
    const isFeePayments = String(url).includes("/fee-payments");
    return {
      ok: true,
      status: 200,
      json: async () => (isFeePayments ? paymentsBody : feeBody),
    };
  });
}

let CertificateView: typeof import("../CertificateView").CertificateView;

async function loadComponent() {
  vi.resetModules();
  ({ CertificateView } = await import("../CertificateView"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Helpers for independent-fetch resolution ─────────────────────────────────

/**
 * Returns a fetch mock where the fee endpoint resolves immediately with
 * `feeBody` and the fee-payments endpoint never resolves (stays pending).
 * Used to verify the fee skeleton clears independently of the payments fetch.
 */
function makeFeeResolvesFirst(feeBody: any) {
  return vi.fn((url: string) => {
    if (String(url).includes("/fee-payments")) {
      return new Promise(() => {});
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => feeBody,
    });
  });
}

/**
 * Returns a fetch mock where the fee-payments endpoint resolves immediately
 * with `paymentsBody` and the fee endpoint never resolves (stays pending).
 * Used to verify the payments skeleton clears independently of the fee fetch.
 */
function makePaymentsResolvesFirst(paymentsBody: any) {
  return vi.fn((url: string) => {
    if (String(url).includes("/fee-payments")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => paymentsBody,
      });
    }
    return new Promise(() => {});
  });
}

// ── Fee-section skeleton — independent from payment history ──────────────────

describe("CertificateView — fee section loading skeleton", () => {
  it("renders the fee-section skeleton while loading=true and fee is null", async () => {
    // Never resolve — keeps loading=true with no fee data for the assertion.
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    await loadComponent();
    render(<CertificateView />);

    const container = screen.getByTestId("certificate-fee-skeleton");
    expect(container).toBeTruthy();
    const skeletons = container.querySelectorAll('[data-testid="portal-skeleton-list"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  it("removes the fee-section skeleton once loading completes with fee data, even when payments list is empty", async () => {
    // Both fetches resolve: fee returns data, payments returns empty array.
    // This confirms the fee skeleton disappears independently based on the `fee`
    // state, not on the payments state.
    (global as any).fetch = makeFetch(feeFixture, []);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      expect(screen.queryByTestId("certificate-fee-skeleton")).toBeNull();
    });

    // The fee data should now be rendered in place of the skeleton.
    expect(screen.queryByTestId("certificate-payment-history-skeleton")).toBeNull();
  });
});

// ── Payment history skeleton — loading state ──────────────────────────────────

describe("CertificateView — payment history loading skeleton", () => {
  it("renders the payment-history skeleton while loading=true and payments=[]", async () => {
    // Never resolve — keeps loading=true and payments=[] for the assertion.
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    await loadComponent();
    render(<CertificateView />);

    // The payment-history container must be present with skeleton children.
    const container = screen.getByTestId("certificate-payment-history-skeleton");
    expect(container).toBeTruthy();
    const skeletons = container.querySelectorAll('[data-testid="portal-skeleton-list"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  it("removes the payment-history skeleton after loading completes with an empty payments list", async () => {
    (global as any).fetch = makeFetch(feeFixture, []);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      expect(
        screen.queryByTestId("certificate-payment-history-skeleton"),
      ).toBeNull();
    });
  });

  it("removes the payment-history skeleton once payments are populated", async () => {
    (global as any).fetch = makeFetch(feeFixture, [
      {
        id: 5,
        amountUsdt: "750",
        percentUsed: "1.5",
        status: "pending",
        adminNotes: null,
        reviewedAt: null,
        reviewedBy: null,
        uploadedAt: new Date().toISOString(),
        fileName: "cert-receipt.pdf",
        notes: null,
      },
    ]);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      expect(
        screen.queryByTestId("certificate-payment-history-skeleton"),
      ).toBeNull();
    });
  });
});

// ── Independent loading state regressions ────────────────────────────────────
//
// These tests ensure each skeleton tracks its own loading flag, not a shared
// one.  If the component reverts to a single `Promise.all`-driven `loading`
// flag, both assertions below will fail because the skeleton that "should
// already be gone" will still be present while the other fetch is pending.

describe("CertificateView — independent loading states", () => {
  it("clears the fee skeleton as soon as fee data arrives, even while the payments fetch is still pending", async () => {
    // Fee resolves immediately; payments fetch never resolves (stays pending).
    // With a shared loading flag the fee skeleton would stay visible until
    // both fetches complete.  With feeLoading tracked independently it must
    // disappear as soon as the fee response is processed.
    (global as any).fetch = makeFeeResolvesFirst(feeFixture);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      expect(screen.queryByTestId("certificate-fee-skeleton")).toBeNull();
    });

    // The payments fetch never resolved so the payment-history skeleton must
    // still be visible (paymentsLoading is still true).
    expect(
      screen.getByTestId("certificate-payment-history-skeleton"),
    ).toBeTruthy();
  });

  it("clears the payment-history skeleton as soon as payments arrive, even while the fee fetch is still pending", async () => {
    // Payments resolves immediately (empty list); fee fetch never resolves.
    // With a shared loading flag the payments skeleton would stay visible
    // until both fetches complete.  With paymentsLoading tracked independently
    // it must disappear as soon as the payments response is processed.
    (global as any).fetch = makePaymentsResolvesFirst([]);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      expect(
        screen.queryByTestId("certificate-payment-history-skeleton"),
      ).toBeNull();
    });

    // The fee fetch never resolved so the fee skeleton must still be visible
    // (feeLoading is still true).
    expect(screen.getByTestId("certificate-fee-skeleton")).toBeTruthy();
  });
});

// ── Payment history list — post-load ─────────────────────────────────────────

describe("CertificateView — payment history list", () => {
  it("does not render any payment history list items when payments is empty after loading", async () => {
    (global as any).fetch = makeFetch(feeFixture, []);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      expect(
        screen.queryByTestId("certificate-payment-history-skeleton"),
      ).toBeNull();
    });

    // No payment list items should be in the DOM.
    const list = document.querySelector("ul");
    expect(list).toBeNull();
  });

  it("renders the payment history list once payments arrive", async () => {
    (global as any).fetch = makeFetch(feeFixture, [
      {
        id: 11,
        amountUsdt: "750",
        percentUsed: "1.5",
        status: "approved",
        adminNotes: null,
        reviewedAt: new Date().toISOString(),
        reviewedBy: "admin",
        uploadedAt: new Date().toISOString(),
        fileName: "approved-receipt.pdf",
        notes: null,
      },
    ]);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      const list = document.querySelector("ul");
      expect(list).toBeTruthy();
      expect(list!.textContent).toContain("750");
    });
  });
});
