// @vitest-environment jsdom
//
// ReactivationDepositView — notice copy logic regression guard.
//
// Verifies that [data-testid="reactivation-notice-body"] renders the correct
// i18n string for each `lockoutReason` value, and that a non-null
// `reactivationPageMessage` from the API always takes priority over every
// i18n fallback.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must precede any import of the component under test
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
    })) as unknown as typeof window.matchMedia;
  }
});

vi.mock("framer-motion", () => {
  const passthrough = (tag: keyof React.JSX.IntrinsicElements) => {
    const C = ({ children, ...rest }: Record<string, unknown>) => {
      const clean = Object.fromEntries(
        Object.entries(rest).filter(
          ([k]) =>
            !k.startsWith("animate") &&
            !k.startsWith("initial") &&
            !k.startsWith("exit") &&
            !k.startsWith("whileHover") &&
            !k.startsWith("transition") &&
            k !== "variants" &&
            k !== "style",
        ),
      );
      return React.createElement(tag, clean as React.HTMLAttributes<HTMLElement>, children as React.ReactNode);
    };
    C.displayName = `motion.${String(tag)}`;
    return C;
  };
  return {
    motion: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => passthrough(prop as keyof React.JSX.IntrinsicElements),
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
    useMotionValue: (v: number) => ({ get: () => v, set: () => {}, on: () => () => {} }),
    useSpring: (v: unknown) => v,
    useTransform: () => ({ get: () => 0, set: () => {}, on: () => () => {} }),
    useMotionTemplate: () => "",
  };
});

vi.mock("@/components/PremiumBackground", () => ({
  PremiumBackground: () => null,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/portal", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// useTranslation returns the key as-is so assertions can match on key strings.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

// ---------------------------------------------------------------------------
// Configurable PortalContext mock
// ---------------------------------------------------------------------------

type LockoutReason = "admin_disabled" | "warning_expired" | null;

let mockLockoutReason: LockoutReason = null;
const mockSetViewState = vi.fn();

vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    accessCode: "TEST-CODE",
    setViewState: mockSetViewState,
    lockoutReason: mockLockoutReason,
  }),
}));

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------

interface ReactivationInfoStub {
  reactivationPageMessage: string | null;
  portalWarningMessage: string | null;
}

let reactivationInfoStub: ReactivationInfoStub = {
  reactivationPageMessage: null,
  portalWarningMessage: null,
};

const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/reactivation-info")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        caseId: "case-001",
        depositAddress: "0xABCDEF",
        depositAsset: "USDT",
        depositNetwork: "TRC20",
        reactivationAmount: "500",
        portalWarningMessage: reactivationInfoStub.portalWarningMessage,
        reactivationPageMessage: reactivationInfoStub.reactivationPageMessage,
      }),
    } as Response;
  }
  return { ok: false, status: 404, json: async () => ({}) } as Response;
}) as unknown as typeof fetch;
global.fetch = fetchStub;

// ---------------------------------------------------------------------------
// Import component under test (after all mocks)
// ---------------------------------------------------------------------------
import { ReactivationDepositView } from "../ReactivationDepositView";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderAndWait() {
  await act(async () => {
    render(<ReactivationDepositView />);
  });
  // Wait for the async fetch to resolve and the notice body to appear.
  await waitFor(() => {
    expect(screen.getByTestId("reactivation-notice-body")).toBeTruthy();
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSetViewState.mockClear();
  fetchStub.mockClear?.();
  reactivationInfoStub = { reactivationPageMessage: null, portalWarningMessage: null };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ============================================================================
// 1. lockoutReason = 'admin_disabled'
// ============================================================================

describe("ReactivationDepositView notice copy — lockoutReason = 'admin_disabled'", () => {
  it("renders the admin_disabled i18n key in the notice body", async () => {
    mockLockoutReason = "admin_disabled";
    await renderAndWait();

    const body = screen.getByTestId("reactivation-notice-body");
    expect(body.textContent).toBe("reactivationDeposit.notice.bodyAdminDisabled");
  });
});

// ============================================================================
// 2. lockoutReason = 'warning_expired'
// ============================================================================

describe("ReactivationDepositView notice copy — lockoutReason = 'warning_expired'", () => {
  it("renders the warning_expired i18n key in the notice body", async () => {
    mockLockoutReason = "warning_expired";
    await renderAndWait();

    const body = screen.getByTestId("reactivation-notice-body");
    expect(body.textContent).toBe("reactivationDeposit.notice.bodyWarningExpired");
  });
});

// ============================================================================
// 3. lockoutReason = null  (generic fallback)
// ============================================================================

describe("ReactivationDepositView notice copy — lockoutReason = null", () => {
  it("renders the generic fallback i18n key in the notice body", async () => {
    mockLockoutReason = null;
    await renderAndWait();

    const body = screen.getByTestId("reactivation-notice-body");
    expect(body.textContent).toBe("reactivationDeposit.notice.body");
  });
});

// ============================================================================
// 4. reactivationPageMessage from API takes priority over i18n fallbacks
// ============================================================================

describe("ReactivationDepositView notice copy — reactivationPageMessage priority", () => {
  it("shows reactivationPageMessage over admin_disabled i18n key", async () => {
    mockLockoutReason = "admin_disabled";
    reactivationInfoStub.reactivationPageMessage = "Custom admin message from API";
    await renderAndWait();

    const body = screen.getByTestId("reactivation-notice-body");
    expect(body.textContent).toBe("Custom admin message from API");
    expect(body.textContent).not.toBe("reactivationDeposit.notice.bodyAdminDisabled");
  });

  it("shows reactivationPageMessage over warning_expired i18n key", async () => {
    mockLockoutReason = "warning_expired";
    reactivationInfoStub.reactivationPageMessage = "Custom warning-expired message from API";
    await renderAndWait();

    const body = screen.getByTestId("reactivation-notice-body");
    expect(body.textContent).toBe("Custom warning-expired message from API");
    expect(body.textContent).not.toBe("reactivationDeposit.notice.bodyWarningExpired");
  });

  it("shows reactivationPageMessage over the generic fallback when lockoutReason is null", async () => {
    mockLockoutReason = null;
    reactivationInfoStub.reactivationPageMessage = "Custom generic message from API";
    await renderAndWait();

    const body = screen.getByTestId("reactivation-notice-body");
    expect(body.textContent).toBe("Custom generic message from API");
    expect(body.textContent).not.toBe("reactivationDeposit.notice.body");
  });

  it("falls back to portalWarningMessage when reactivationPageMessage is null", async () => {
    mockLockoutReason = null;
    reactivationInfoStub.reactivationPageMessage = null;
    reactivationInfoStub.portalWarningMessage = "Portal warning fallback";
    await renderAndWait();

    const body = screen.getByTestId("reactivation-notice-body");
    expect(body.textContent).toBe("Portal warning fallback");
    expect(body.textContent).not.toBe("reactivationDeposit.notice.body");
  });
});
