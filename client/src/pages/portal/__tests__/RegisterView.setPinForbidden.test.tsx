// @vitest-environment jsdom
//
// Unit test: RegisterView — mid-registration 403 redirect guard.
//
// Contracted behaviours:
//   (a) When POST /api/cases/set-pin returns 403, setViewState is called
//       with "reactivationDeposit" and setAccessCode is called first with
//       the active access code.
//   (b) No "pin setup failed" toast is shown on a 403 (it is a silent
//       redirect, not an error the user can act on).
//   (c) The redirect fires even when the 403 body is missing an error field.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    motion: new Proxy({} as any, {
      get: (_t, prop: string) => passthrough(prop as any),
    }),
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

const mockSetViewState = vi.fn();
const mockSetAccessCode = vi.fn();
const mockSetCurrentCase = vi.fn();

const STUB_CASE = {
  id: "case-reg-001",
  accessCode: "REGTEST",
  status: "created" as const,
  userName: undefined,
  userEmail: undefined,
  userMobile: undefined,
};

vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: STUB_CASE,
    setCurrentCase: mockSetCurrentCase,
    accessCode: "REGTEST",
    setAccessCode: mockSetAccessCode,
    setViewState: mockSetViewState,
  }),
}));

vi.mock("@/lib/portalSession", () => ({
  setPortalToken: vi.fn(),
  getPortalToken: () => null,
}));

// ---------------------------------------------------------------------------
// fetch stub — set-pin always returns 403
// ---------------------------------------------------------------------------

const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("/api/cases/set-pin")) {
    return {
      ok: false,
      status: 403,
      json: async () => ({ error: "Account disabled." }),
    } as Response;
  }

  return { ok: true, status: 200, json: async () => ({}) } as Response;
}) as unknown as typeof fetch;

global.fetch = fetchStub;

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------
import { RegisterView } from "../AuthViews";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fillAndSubmitRegisterForm(pin = "123456") {
  fireEvent.change(screen.getByTestId("input-name"), {
    target: { value: "Jane Doe" },
  });
  fireEvent.change(screen.getByTestId("input-email"), {
    target: { value: "jane@example.com" },
  });
  fireEvent.change(screen.getByTestId("input-mobile"), {
    target: { value: "+1234567890" },
  });
  fireEvent.change(screen.getByTestId("input-new-pin"), {
    target: { value: pin },
  });
  fireEvent.change(screen.getByTestId("input-confirm-pin"), {
    target: { value: pin },
  });

  const btn = screen.getByTestId("button-register");
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
  mockSetCurrentCase.mockClear();
  mockToast.mockClear();
  (fetchStub as ReturnType<typeof vi.fn>).mockClear();
  vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RegisterView — set-pin 403 redirects to reactivationDeposit", () => {
  it(
    "(a) calls setViewState('reactivationDeposit') when set-pin returns 403",
    async () => {
      render(<RegisterView />);
      await fillAndSubmitRegisterForm();

      await waitFor(() => {
        expect(mockSetViewState).toHaveBeenCalledWith("reactivationDeposit");
      });
    },
  );

  it(
    "(a) calls setAccessCode with the active access code before routing",
    async () => {
      render(<RegisterView />);
      await fillAndSubmitRegisterForm();

      await waitFor(() => {
        expect(mockSetAccessCode).toHaveBeenCalledWith("REGTEST");
      });

      const setAccessOrder = mockSetAccessCode.mock.invocationCallOrder[0];
      const setViewOrder = mockSetViewState.mock.invocationCallOrder[0];
      expect(setAccessOrder).toBeLessThan(setViewOrder);
    },
  );

  it(
    "(b) does NOT show a 'pin setup failed' toast on 403",
    async () => {
      render(<RegisterView />);
      await fillAndSubmitRegisterForm();

      await waitFor(() => {
        expect(mockSetViewState).toHaveBeenCalledWith("reactivationDeposit");
      });

      const pinFailedToasts = mockToast.mock.calls.filter(
        (args) =>
          args[0]?.title === "auth.register.toast.pinSetupFailedTitle",
      );
      expect(pinFailedToasts).toHaveLength(0);
    },
  );

  it(
    "(c) redirects even when the 403 body has no error field",
    async () => {
      (fetchStub as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/api/cases/set-pin")) {
            return {
              ok: false,
              status: 403,
              json: async () => ({}),
            } as Response;
          }
          return { ok: true, status: 200, json: async () => ({}) } as Response;
        },
      );

      render(<RegisterView />);
      await fillAndSubmitRegisterForm();

      await waitFor(() => {
        expect(mockSetViewState).toHaveBeenCalledWith("reactivationDeposit");
      });
    },
  );
});
