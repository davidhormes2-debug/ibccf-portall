// @vitest-environment jsdom
//
// Task #776 — Cover the generation-style phrase reveal and the device-aware
// App Store / Play Store wallet download buttons (including Crypto.com
// Onchain). We assert:
//   - prefers-reduced-motion skips the "generating" animation and reveals
//     the real admin-entered words instantly.
//   - the store step renders BOTH the App Store and Play Store links, with
//     the one matching the simulated user agent highlighted as recommended.
//   - the Crypto.com Onchain option carries its correct store links.
//   - the lazy phrase fetch is still made against the portal-auth endpoint.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---- Mocks (must precede the WalletConnectView import) -------------------

// framer-motion: passthrough motion.* + a controllable useReducedMotion.
let reducedMotion = false;
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
    useReducedMotion: () => reducedMotion,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => "test-portal-token",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) =>
      (opts && typeof opts === "object" && "defaultValue" in opts
        ? opts.defaultValue
        : key) as string,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}));

let currentCaseStub: any = null;
const setViewStateMock = vi.fn();
vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: currentCaseStub,
    setViewState: setViewStateMock,
  }),
}));

// ---- Helpers ---------------------------------------------------------------

let WalletConnectView: typeof import("../WalletConnectView").WalletConnectView;

async function loadComponent() {
  vi.resetModules();
  ({ WalletConnectView } = await import("../WalletConnectView"));
}

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

const PHRASE = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";

function caseFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-1",
    accessCode: "ABCD-1234",
    status: "active",
    walletPhraseEnabled: true,
    walletExchangeName: "Crypto.com Onchain",
    ...overrides,
  };
}

function mockPhraseFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ phraseCode: PHRASE }),
  })) as unknown as typeof fetch;
  global.fetch = fetchMock;
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  currentCaseStub = null;
  reducedMotion = false;
  setUserAgent("Mozilla/5.0 (desktop)");
});

describe("WalletConnectView — generation-style reveal", () => {
  it("reveals the real phrase instantly under prefers-reduced-motion", async () => {
    reducedMotion = true;
    currentCaseStub = caseFixture();
    const fetchMock = mockPhraseFetch();
    await loadComponent();

    const user = userEvent.setup();
    render(<WalletConnectView />);

    await user.click(screen.getByTestId("button-reveal-phrase"));

    await waitFor(() => {
      expect(screen.getByTestId("phrase-grid")).toBeTruthy();
    });

    // No generating animation indicator should ever appear.
    expect(screen.queryByTestId("phrase-generating")).toBeNull();
    // The first word shows the actual admin-entered value immediately.
    expect(screen.getByTestId("phrase-word-0").textContent).toContain("alpha");

    // Lazy fetch still hits the portal-auth'd endpoint exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock as any).mock.calls[0][0]).toBe(
      "/api/cases/case-1/wallet-phrase",
    );
  });

  it("shows the generating animation when motion is allowed", async () => {
    reducedMotion = false;
    currentCaseStub = caseFixture();
    mockPhraseFetch();
    await loadComponent();

    const user = userEvent.setup();
    render(<WalletConnectView />);

    await user.click(screen.getByTestId("button-reveal-phrase"));

    await waitFor(() => {
      expect(screen.getByTestId("phrase-generating")).toBeTruthy();
    });
  });
});

describe("WalletConnectView — device-aware store buttons", () => {
  async function revealAndGoToStep3(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId("button-reveal-phrase"));
    await waitFor(() => {
      expect(screen.getByTestId("button-next-import-guide")).toBeTruthy();
    });
    await user.click(screen.getByTestId("button-next-import-guide"));
    await waitFor(() => {
      expect(screen.getByTestId("link-appstore")).toBeTruthy();
    });
  }

  it("renders both store links and prioritizes App Store on iOS", async () => {
    reducedMotion = true;
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    );
    currentCaseStub = caseFixture();
    mockPhraseFetch();
    await loadComponent();

    const user = userEvent.setup();
    render(<WalletConnectView />);
    await revealAndGoToStep3(user);

    const appStore = screen.getByTestId("link-appstore");
    const playStore = screen.getByTestId("link-playstore");
    expect(appStore).toBeTruthy();
    expect(playStore).toBeTruthy();
    expect(appStore.getAttribute("href")).toContain("apps.apple.com");
    expect(playStore.getAttribute("href")).toContain("play.google.com");
    // iOS → App Store recommended badge present, Play Store not.
    expect(screen.getByTestId("badge-store-recommended-ios")).toBeTruthy();
    expect(screen.queryByTestId("badge-store-recommended-android")).toBeNull();
  });

  it("prioritizes Google Play on Android", async () => {
    reducedMotion = true;
    setUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36",
    );
    currentCaseStub = caseFixture();
    mockPhraseFetch();
    await loadComponent();

    const user = userEvent.setup();
    render(<WalletConnectView />);
    await revealAndGoToStep3(user);

    expect(screen.getByTestId("badge-store-recommended-android")).toBeTruthy();
    expect(screen.queryByTestId("badge-store-recommended-ios")).toBeNull();
  });

  it("shows both stores without a recommendation on desktop", async () => {
    reducedMotion = true;
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari");
    currentCaseStub = caseFixture();
    mockPhraseFetch();
    await loadComponent();

    const user = userEvent.setup();
    render(<WalletConnectView />);
    await revealAndGoToStep3(user);

    expect(screen.getByTestId("link-appstore")).toBeTruthy();
    expect(screen.getByTestId("link-playstore")).toBeTruthy();
    expect(screen.queryByTestId("badge-store-recommended-ios")).toBeNull();
    expect(screen.queryByTestId("badge-store-recommended-android")).toBeNull();
  });

  it("exposes Crypto.com Onchain with its correct store links", async () => {
    reducedMotion = true;
    setUserAgent("Mozilla/5.0 (desktop)");
    currentCaseStub = caseFixture({ walletExchangeName: "Crypto.com Onchain" });
    mockPhraseFetch();
    await loadComponent();

    const user = userEvent.setup();
    render(<WalletConnectView />);
    await revealAndGoToStep3(user);

    expect(screen.getByTestId("link-appstore").getAttribute("href")).toBe(
      "https://apps.apple.com/us/app/crypto-com-onchain-wallet/id1512048310",
    );
    expect(screen.getByTestId("link-playstore").getAttribute("href")).toBe(
      "https://play.google.com/store/apps/details?id=com.defi.wallet",
    );
  });

  it("matches a legacy 'Crypto.com DeFi Wallet' name back to the Onchain preset", async () => {
    reducedMotion = true;
    currentCaseStub = caseFixture({ walletExchangeName: "Crypto.com DeFi Wallet" });
    mockPhraseFetch();
    await loadComponent();

    const user = userEvent.setup();
    render(<WalletConnectView />);
    await revealAndGoToStep3(user);

    // Resolved to the cryptocom preset → Onchain store links rendered.
    expect(screen.getByTestId("link-playstore").getAttribute("href")).toBe(
      "https://play.google.com/store/apps/details?id=com.defi.wallet",
    );
  });
});
