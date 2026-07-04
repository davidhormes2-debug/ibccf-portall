// @vitest-environment jsdom
//
// Regression tests: StampDutyView must render data-testid="portal-skeleton-card"
// items while the stamp-duty fetch is pending, and no skeleton once the data
// arrives (even when the receipts list is empty).

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

let currentCaseStub: any = {
  id: "case-1",
  accessCode: "ABCD-1234",
};

vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: currentCaseStub,
    loadAllData: vi.fn(async () => {}),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const stampDutyConfigFixture = {
  enabled: true,
  status: "awaiting_upload" as const,
  amountUsdt: "500",
  amountSource: "global" as const,
  paymentAddress: "STAMP-WALLET-ADDRESS",
  paymentAsset: "USDT",
  paymentNetwork: "TRC20",
  paymentMemo: null,
};

function makeFetch(
  cfgBody: any,
  receiptsBody: any,
  { delay = 0 }: { delay?: number } = {},
) {
  return vi.fn(async (url: string) => {
    if (delay) {
      await new Promise((r) => setTimeout(r, delay));
    }
    const isReceipts = String(url).includes("/receipts");
    return {
      ok: true,
      status: 200,
      json: async () => (isReceipts ? receiptsBody : cfgBody),
    };
  });
}

let StampDutyView: typeof import("../StampDutyView").StampDutyView;

async function loadComponent() {
  vi.resetModules();
  ({ StampDutyView } = await import("../StampDutyView"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Loading skeleton ──────────────────────────────────────────────────────────

describe("StampDutyView — loading skeleton", () => {
  it("renders portal-skeleton-card items while the stamp-duty fetch is pending", async () => {
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    await loadComponent();
    render(<StampDutyView />);

    const skeletons = screen.getAllByTestId("portal-skeleton-card");
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the role=status loading wrapper while fetching", async () => {
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    await loadComponent();
    render(<StampDutyView />);

    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeTruthy();
    expect(statusEl.getAttribute("aria-label")).toBe("Loading");
  });

  it("removes the skeleton after the fetch resolves", async () => {
    (global as any).fetch = makeFetch(stampDutyConfigFixture, []);

    await loadComponent();
    render(<StampDutyView />);

    await waitFor(() => {
      expect(screen.queryAllByTestId("portal-skeleton-card")).toHaveLength(0);
    });
  });

  it("does not render the skeleton when loading is false", async () => {
    (global as any).fetch = makeFetch(stampDutyConfigFixture, [
      {
        id: 1,
        amountUsdt: "500",
        status: "pending",
        uploadedAt: new Date().toISOString(),
        fileName: "receipt.png",
      },
    ]);

    await loadComponent();
    render(<StampDutyView />);

    await waitFor(() => {
      expect(screen.queryAllByTestId("portal-skeleton-card")).toHaveLength(0);
    });
  });
});

// ── Empty receipt history (no list items shown) ───────────────────────────────

describe("StampDutyView — no receipts yet (empty history)", () => {
  it("does not render any submission history rows when receipts is empty", async () => {
    (global as any).fetch = makeFetch(stampDutyConfigFixture, []);

    await loadComponent();
    render(<StampDutyView />);

    await waitFor(() => {
      // skeleton gone means loading finished
      expect(screen.queryAllByTestId("portal-skeleton-card")).toHaveLength(0);
    });

    // No receipt rows should exist in the DOM.
    expect(
      document.querySelectorAll("[data-testid^='row-stamp-duty-receipt-']"),
    ).toHaveLength(0);
  });

  it("renders submission history rows when receipts are present", async () => {
    (global as any).fetch = makeFetch(stampDutyConfigFixture, [
      {
        id: 7,
        amountUsdt: "500",
        status: "pending",
        uploadedAt: new Date().toISOString(),
        fileName: "proof.pdf",
      },
    ]);

    await loadComponent();
    render(<StampDutyView />);

    await waitFor(() => {
      expect(screen.getByTestId("row-stamp-duty-receipt-7")).toBeTruthy();
    });
  });
});
