// @vitest-environment jsdom
//
// Reactivation Deposit Routing — regression guard.
//
// Verifies that LoginView routes to the `reactivationDeposit` view when:
//   1. POST /api/cases/login-pin returns 403 (disabled account with a PIN set)
//   2. GET /api/cases/access/:code returns 403 (disabled account without PIN)
//
// Mirrors the pattern established in LoginViewLockout.test.tsx.

import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must precede any import of AuthViews
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

vi.mock("framer-motion", () => {
  const passthrough = (tag: keyof React.JSX.IntrinsicElements) => {
    const C = ({ children, ...rest }: any) => {
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
      return React.createElement(tag, clean, children);
    };
    C.displayName = `motion.${String(tag)}`;
    return C;
  };
  return {
    motion: new Proxy({} as any, { get: (_t, prop: string) => passthrough(prop as any) }),
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useReducedMotion: () => true,
    useMotionValue: (v: number) => ({ get: () => v, set: () => {}, on: () => () => {} }),
    useSpring: (v: any) => v,
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

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

// Track setViewState and setAccessCode calls
const mockSetViewState = vi.fn();
const mockSetAccessCode = vi.fn();
vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    setCurrentCase: vi.fn(),
    setAccessCode: mockSetAccessCode,
    setViewState: mockSetViewState,
  }),
}));

vi.mock("@/lib/portalSession", () => ({
  setPortalToken: vi.fn(),
  getPortalToken: () => null,
}));

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------

type FetchMode = "pin_set_403" | "no_pin_403";
let fetchMode: FetchMode = "pin_set_403";

const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("/api/cases/verify-access-code")) {
    if (fetchMode === "pin_set_403") {
      return { ok: true, status: 200, json: async () => ({ hasPinSet: true, caseId: "case-1929" }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ hasPinSet: false, caseId: "case-1929" }) } as Response;
  }

  if (url.includes("/api/cases/login-pin")) {
    return { ok: false, status: 403, json: async () => ({ error: "Account disabled. Please contact support." }) } as Response;
  }

  if (url.includes("/api/cases/access/")) {
    return { ok: false, status: 403, json: async () => ({ error: "Account is disabled" }) } as Response;
  }

  return { ok: false, status: 204, json: async () => ({}) } as Response;
}) as unknown as typeof fetch;
global.fetch = fetchStub;

// ---------------------------------------------------------------------------
// Import component under test
// ---------------------------------------------------------------------------
import { LoginView } from "../AuthViews";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function advanceToPinStep() {
  const codeInput = screen.getByTestId("input-access-code");
  fireEvent.change(codeInput, { target: { value: "DISABLEDCASE" } });
  const submitBtn = screen.getByTestId("button-login");
  await act(async () => {
    fireEvent.click(submitBtn);
  });
  await waitFor(() => {
    expect(screen.getByTestId("input-pin")).toBeTruthy();
  });
}

async function submitPin(pin = "123456") {
  const input = screen.getByTestId("input-pin");
  fireEvent.change(input, { target: { value: pin } });
  const btn = screen.getByTestId("button-login");
  await act(async () => {
    fireEvent.click(btn);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSetViewState.mockClear();
  mockSetAccessCode.mockClear();
  mockToast.mockClear();
  (fetchStub as any).mockClear?.();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ============================================================================
// 1. PIN-set path: 403 from POST /api/cases/login-pin
// ============================================================================

describe("LoginView — 403 from login-pin routes to reactivationDeposit", () => {
  it("calls setViewState('reactivationDeposit') when login-pin returns 403", async () => {
    fetchMode = "pin_set_403";
    render(<LoginView />);
    await advanceToPinStep();
    await submitPin();

    await waitFor(() => {
      expect(mockSetViewState).toHaveBeenCalledWith("reactivationDeposit");
    });
  });

  it("stores the access code via setAccessCode before routing", async () => {
    fetchMode = "pin_set_403";
    render(<LoginView />);
    await advanceToPinStep();
    await submitPin();

    await waitFor(() => {
      expect(mockSetAccessCode).toHaveBeenCalledWith("DISABLEDCASE");
    });
  });

  it("does NOT show an invalid-pin toast on 403", async () => {
    fetchMode = "pin_set_403";
    render(<LoginView />);
    await advanceToPinStep();
    await submitPin();

    await waitFor(() => {
      expect(mockSetViewState).toHaveBeenCalledWith("reactivationDeposit");
    });
    const invalidPinToasts = mockToast.mock.calls.filter(
      (args) => args[0]?.title === "auth.login.toast.invalidPinTitle",
    );
    expect(invalidPinToasts).toHaveLength(0);
  });
});

// ============================================================================
// 2. No-PIN path: 403 from GET /api/cases/access/:code
// ============================================================================

describe("LoginView — 403 from access/:code (no PIN) routes to reactivationDeposit", () => {
  it("calls setViewState('reactivationDeposit') when GET /access/:code returns 403", async () => {
    fetchMode = "no_pin_403";
    render(<LoginView />);

    const codeInput = screen.getByTestId("input-access-code");
    fireEvent.change(codeInput, { target: { value: "DISABLEDCASE" } });
    const submitBtn = screen.getByTestId("button-login");
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockSetViewState).toHaveBeenCalledWith("reactivationDeposit");
    });
  });

  it("stores the access code via setAccessCode in the no-PIN path", async () => {
    fetchMode = "no_pin_403";
    render(<LoginView />);

    const codeInput = screen.getByTestId("input-access-code");
    fireEvent.change(codeInput, { target: { value: "DISABLEDCASE" } });
    const submitBtn = screen.getByTestId("button-login");
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockSetAccessCode).toHaveBeenCalledWith("DISABLEDCASE");
    });
  });
});
