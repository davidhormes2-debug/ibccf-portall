// @vitest-environment jsdom
//
// Task #361 — Login screen rate-limit countdown tests.
//
// Task #305 added a rate-limit countdown to the main portal login screen
// (LoginView in `client/src/pages/portal/AuthViews.tsx`), mirroring the
// PIN re-auth dialog in PortalShell. This file is a dedicated regression
// guard for the LoginView variant. It verifies:
//
//   1. After a 429 + retryAfter response from POST /api/cases/login-pin,
//      the `login-lockout-message` element appears with the correctly
//      formatted time string (Xs for <60s, Xm Ys for >=60s).
//   2. The PIN input (`input-pin`) and the submit button (`button-login`)
//      are both disabled while the lockout is active.
//   3. The countdown decrements over time and re-enables both controls
//      when it reaches zero.
//
// We drive the component through the "code" step first (POST
// /api/cases/verify-access-code → hasPinSet: true) to expose the PIN
// input, then submit a PIN to trigger the 429 path.

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

// jsdom doesn't ship matchMedia; AuthViews calls it at module load.
// Use vi.hoisted so this runs before the (also-hoisted) `import` of AuthViews.
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

// Capture t() calls so tests can assert on i18n key usage / interpolation.
const recordedT: Array<{ key: string; opts?: Record<string, unknown> }> = [];
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      recordedT.push({ key, opts });
      if (opts && typeof (opts as any).time === "string") {
        return `${key}:${(opts as any).time}`;
      }
      return key;
    },
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

// Stub portal context: LoginView only calls the setters.
vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    setCurrentCase: vi.fn(),
    setAccessCode: vi.fn(),
    setViewState: vi.fn(),
  }),
}));

vi.mock("@/lib/portalSession", () => ({
  setPortalToken: vi.fn(),
  getPortalToken: () => null,
}));

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------

let loginPinResponse: { ok: boolean; status: number; body: any } = {
  ok: false,
  status: 401,
  body: {},
};
function setLoginPinResponse(resp: { ok: boolean; status: number; body: any }) {
  loginPinResponse = resp;
}

const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/api/cases/verify-access-code")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ hasPinSet: true, caseId: "case-361" }),
    } as Response;
  }
  if (url.includes("/api/cases/login-pin")) {
    return {
      ok: loginPinResponse.ok,
      status: loginPinResponse.status,
      json: async () => loginPinResponse.body,
    } as Response;
  }
  // Default no-op (e.g. /api/cases/access/:code shouldn't be reached on 429).
  return {
    ok: false,
    status: 204,
    json: async () => ({}),
  } as Response;
}) as unknown as typeof fetch;
global.fetch = fetchStub;

// ---------------------------------------------------------------------------
// Import the component under test (after all mocks are registered)
// ---------------------------------------------------------------------------
import { LoginView } from "../AuthViews";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Advance LoginView from the access-code step to the PIN step. */
async function advanceToPinStep() {
  const codeInput = screen.getByTestId("input-access-code");
  fireEvent.change(codeInput, { target: { value: "TASK-0361" } });
  const submitBtn = screen.getByTestId("button-login");
  await act(async () => {
    fireEvent.click(submitBtn);
  });
  await waitFor(() => {
    expect(screen.getByTestId("input-pin")).toBeTruthy();
  });
}

/** Submit the PIN form, triggering the /api/cases/login-pin call. */
async function submitPin(pin = "123456") {
  const input = screen.getByTestId("input-pin");
  fireEvent.change(input, { target: { value: pin } });
  const btn = screen.getByTestId("button-login");
  await act(async () => {
    fireEvent.click(btn);
  });
  // Flush any trailing microtasks from the async handleLogin call.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  recordedT.length = 0;
  mockToast.mockClear();
  (fetchStub as any).mockClear?.();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ============================================================================
// 1. Lockout message appears after 429 with retryAfter
// ============================================================================

describe("LoginView — lockout message on 429", () => {
  it("renders the login-lockout-message element after a 429 response", async () => {
    setLoginPinResponse({ ok: false, status: 429, body: { retryAfter: 90 } });

    render(<LoginView />);
    await advanceToPinStep();
    await submitPin();

    await waitFor(() => {
      expect(screen.getByTestId("login-lockout-message")).toBeTruthy();
    });
  });

  it("formats retryAfter < 60 as 'Xs' (e.g. '45s')", async () => {
    setLoginPinResponse({ ok: false, status: 429, body: { retryAfter: 45 } });

    render(<LoginView />);
    await advanceToPinStep();
    await submitPin();

    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call).toBeDefined();
      expect(call!.opts!.time).toBe("45s");
    });
  });

  it("formats retryAfter >= 60 as 'Xm Ys' (e.g. retryAfter=90 → '1m 30s')", async () => {
    setLoginPinResponse({ ok: false, status: 429, body: { retryAfter: 90 } });

    render(<LoginView />);
    await advanceToPinStep();
    await submitPin();

    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call).toBeDefined();
      expect(call!.opts!.time).toBe("1m 30s");
    });
  });

  it("falls back to retryAfter=60 when the server omits the field ('1m 0s')", async () => {
    setLoginPinResponse({ ok: false, status: 429, body: {} });

    render(<LoginView />);
    await advanceToPinStep();
    await submitPin();

    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call).toBeDefined();
      expect(call!.opts!.time).toBe("1m 0s");
    });
  });

  it("does NOT render the lockout message before any submission", async () => {
    setLoginPinResponse({ ok: false, status: 401, body: {} });

    render(<LoginView />);
    await advanceToPinStep();

    expect(screen.queryByTestId("login-lockout-message")).toBeNull();
  });
});

// ============================================================================
// 2. PIN input and submit button are disabled during lockout
// ============================================================================

describe("LoginView — inputs disabled during lockout", () => {
  it("disables the PIN input after a 429 response", async () => {
    setLoginPinResponse({ ok: false, status: 429, body: { retryAfter: 60 } });

    render(<LoginView />);
    await advanceToPinStep();
    await submitPin();

    await waitFor(() => {
      const input = screen.getByTestId("input-pin") as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });
  });

  it("disables the submit button after a 429 response", async () => {
    setLoginPinResponse({ ok: false, status: 429, body: { retryAfter: 60 } });

    render(<LoginView />);
    await advanceToPinStep();
    await submitPin();

    await waitFor(() => {
      const btn = screen.getByTestId("button-login") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it("submit button is NOT disabled before any 429 is received (with PIN entered)", async () => {
    setLoginPinResponse({ ok: false, status: 401, body: {} });

    render(<LoginView />);
    await advanceToPinStep();

    fireEvent.change(screen.getByTestId("input-pin"), { target: { value: "123456" } });

    const btn = screen.getByTestId("button-login") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

// ============================================================================
// 3. Countdown ticks down over time and re-enables controls at zero
// ============================================================================

describe("LoginView — countdown ticks down and re-enables controls", () => {
  // We intentionally use real timers here. The countdown effect schedules
  // window.setTimeout inside React's render cycle; mixing fake timers with
  // @testing-library/react's waitFor (which itself relies on setTimeout)
  // produces flaky behavior because pending real timers and fake timers
  // live in separate queues. Real-time waits keep the tests deterministic
  // at the cost of a few seconds.

  it("decrements the countdown over real time", async () => {
    setLoginPinResponse({ ok: false, status: 429, body: { retryAfter: 10 } });

    render(<LoginView />);
    await advanceToPinStep();
    await submitPin();

    // Initial render: 10s.
    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call).toBeDefined();
      expect(call!.opts!.time).toBe("10s");
    });

    const seen = new Set<string>(["10s"]);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && seen.size < 3) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });
      for (const call of recordedT) {
        if (call.key === "shell.sessionExpiry.lockedCountdown") {
          seen.add(call.opts!.time as string);
        }
      }
    }
    // We expect at least 3 distinct values across the first few seconds:
    // "10s", "9s", "8s" — proves the countdown decrements rather than
    // firing once.
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(seen.has("9s")).toBe(true);
    expect(seen.has("8s")).toBe(true);
  }, 15_000);

  it("re-enables the PIN input and submit button when the countdown reaches zero", async () => {
    // Use a tiny retryAfter so we don't spend forever waiting in real time.
    setLoginPinResponse({ ok: false, status: 429, body: { retryAfter: 2 } });

    render(<LoginView />);
    await advanceToPinStep();
    await submitPin();

    // Confirm controls become disabled first.
    await waitFor(() => {
      const input = screen.getByTestId("input-pin") as HTMLInputElement;
      const btn = screen.getByTestId("button-login") as HTMLButtonElement;
      expect(input.disabled).toBe(true);
      expect(btn.disabled).toBe(true);
    });

    // Wait for the countdown to drain past 2 seconds.
    await waitFor(
      () => {
        const input = screen.getByTestId("input-pin") as HTMLInputElement;
        const btn = screen.getByTestId("button-login") as HTMLButtonElement;
        expect(input.disabled).toBe(false);
        expect(btn.disabled).toBe(false);
        // Lockout message should also be gone once the timer hits zero.
        expect(screen.queryByTestId("login-lockout-message")).toBeNull();
      },
      { timeout: 6_000, interval: 200 },
    );
  }, 15_000);
});
