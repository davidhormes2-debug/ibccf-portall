// @vitest-environment jsdom
//
// Task #306 — PIN re-auth rate-limit countdown tests.
//
// The reauth dialog in PortalShell shows a live countdown message and
// disables the submit/PIN inputs when the server returns 429.  These
// tests verify:
//
//   1. After a 429 response the lockout message appears, including the
//      correct time string derived from retryAfter.
//   2. The submit button and PIN input are disabled while locked out.
//   3. The `shell.sessionExpiry.lockedCountdown` i18n key is used.
//   4. retryAfter < 60 s   →  time string rendered as "Xs"
//      retryAfter ≥ 60 s   →  time string rendered as "Xm Ys"
//   5. Countdown ticks down by 1 each second (fake timers).
//
// The test opens the dialog by:
//   (a) mocking getPortalSessionExpiresAt to return a near-expiry time,
//       which makes PortalShell render the session-expiry banner, and
//   (b) clicking the "Log in again" button in that banner.

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
// Module mocks — must precede any import of PortalShell
// ---------------------------------------------------------------------------

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
            k !== "variants",
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
    useReducedMotion: () => false,
  };
});

vi.mock("@/App", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: {
      id: "case-306",
      accessCode: "TASK-0306",
      userName: "Rate Limit User",
      withdrawalStage: null,
      letterSent: false,
      declarationStatus: "not_requested",
      vipStatus: "Standard",
    },
    viewState: "dashboard",
    setViewState: vi.fn(),
    logout: vi.fn(),
    unreadAdminMessages: 0,
    unreadCount: 0,
    hasUrgentMessages: false,
    keyRequestNotification: null,
    hasKeyRequest: false,
    declaration: null,
    documentRequests: [],
    pendingDocumentCount: 0,
    refreshDeclaration: vi.fn(),
  }),
}));

vi.mock("@/components/NotificationBell", () => ({
  NotificationBell: () => null,
}));

vi.mock("@/components/portal/PortalProgressStrip", () => ({
  PortalProgressStrip: () => null,
}));

vi.mock("@/components/portal/AnnouncementBanner", () => ({
  AnnouncementBanner: () => null,
}));

vi.mock("@/components/portal/MirrorBanner", () => ({
  MirrorBanner: () => null,
}));

vi.mock("@/components/ComplianceStrip", () => ({
  ComplianceStrip: () => null,
}));

vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => null,
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/portal", vi.fn()],
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/i18n/useLocale", () => ({
  useLocale: () => ({
    locale: { code: "en", label: "English", nativeLabel: "English", bcp47: "en" },
  }),
}));

// Capture t() calls so tests can assert on i18n key usage.
const recordedT: Array<{ key: string; opts?: Record<string, unknown> }> = [];
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      recordedT.push({ key, opts });
      // Interpolate {{time}} so the rendered text is inspectable.
      if (opts && typeof opts.time === "string") return `${key}:${opts.time}`;
      return key;
    },
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

// getPortalSessionExpiresAt is controlled per test to open/close the banner.
const mockGetExpiresAt = vi.fn<() => number | null>(() => null);
vi.mock("@/lib/portalSession", () => ({
  getPortalSessionExpiresAt: () => mockGetExpiresAt(),
  setPortalToken: vi.fn(),
}));

vi.mock("@/i18n/format", () => ({
  useFormat: () => ({
    formatRelative: vi.fn((v: number) => `in ${Math.round((v - Date.now()) / 3_600_000)} hours`),
    formatDate: vi.fn(() => "2026-01-01"),
    formatDateTime: vi.fn(() => "2026-01-01 00:00"),
    formatTime: vi.fn(() => "00:00"),
    formatNumber: vi.fn((n: number) => String(n)),
    formatCurrency: vi.fn((n: number) => String(n)),
  }),
}));

// ---------------------------------------------------------------------------
// fetch stub.
//
// PortalShell makes two kinds of fetch calls we have to handle:
//   • /api/public/build-info — the stale-build poller, irrelevant here.
//   • /api/cases/login-pin    — the call under test.
//
// We route the build-info call to a benign "no new build" response so its
// timing never consumes the reauth-specific mock value. Tests can override
// the login-pin response via `setLoginPinResponse(...)` below.
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
  if (url.includes("/api/cases/login-pin")) {
    return {
      ok: loginPinResponse.ok,
      status: loginPinResponse.status,
      json: async () => loginPinResponse.body,
    } as Response;
  }
  // Default: pretend every other endpoint (build-info, etc.) is "no-op".
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
import { PortalShell } from "../PortalShell";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;

/** Render PortalShell with the session-expiry banner visible (3 h remaining). */
function renderShell() {
  // Ensure the banner is rendered so the "Log in again" button is accessible.
  mockGetExpiresAt.mockReturnValue(Date.now() + 3 * HOUR);
  return render(
    <PortalShell>
      <div data-testid="portal-child">portal content</div>
    </PortalShell>,
  );
}

/**
 * Open the reauth dialog by waiting for the banner's "Log in again" button
 * and clicking it, then return the dialog's submit button for convenience.
 */
async function openReauthDialog() {
  await waitFor(() => {
    expect(screen.getByTestId("button-session-expiry-reauth")).toBeTruthy();
  });
  fireEvent.click(screen.getByTestId("button-session-expiry-reauth"));
  await waitFor(() => {
    expect(screen.getByTestId("input-session-reauth-pin")).toBeTruthy();
  });
}

/**
 * Fill in the PIN and submit the reauth form, waiting for fetch to be called.
 */
async function submitReauthForm(pin = "123456") {
  const input = screen.getByTestId("input-session-reauth-pin");
  fireEvent.change(input, { target: { value: pin } });
  const form = input.closest("form")!;
  await act(async () => {
    fireEvent.submit(form);
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

describe("PIN reauth dialog — lockout message on 429", () => {
  it("renders the lockout message element after a 429 response", async () => {
    setLoginPinResponse({
      ok: false,
      status: 429,
      body: { retryAfter: 90 },
    });

    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    await waitFor(() => {
      expect(screen.getByTestId("reauth-lockout-message")).toBeTruthy();
    });
  });

  it("uses the shell.sessionExpiry.lockedCountdown i18n key for the lockout message", async () => {
    setLoginPinResponse({
      ok: false,
      status: 429,
      body: { retryAfter: 45 },
    });

    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    await waitFor(() => {
      expect(
        recordedT.some((c) => c.key === "shell.sessionExpiry.lockedCountdown"),
      ).toBe(true);
    });
  });

  it("does NOT render the lockout message before any submission", async () => {
    // No fetch call yet — dialog is just open.
    setLoginPinResponse({ ok: false, status: 401, body: {} });

    renderShell();
    await openReauthDialog();

    expect(screen.queryByTestId("reauth-lockout-message")).toBeNull();
  });
});

// ============================================================================
// 2. Submit button and PIN input are disabled during lockout
// ============================================================================

describe("PIN reauth dialog — inputs disabled during lockout", () => {
  it("disables the submit button after a 429 response", async () => {
    setLoginPinResponse({
      ok: false,
      status: 429,
      body: { retryAfter: 60 },
    });

    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    await waitFor(() => {
      const btn = screen.getByTestId("button-session-reauth-submit");
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it("disables the PIN input field after a 429 response", async () => {
    setLoginPinResponse({
      ok: false,
      status: 429,
      body: { retryAfter: 60 },
    });

    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    await waitFor(() => {
      const input = screen.getByTestId("input-session-reauth-pin");
      expect((input as HTMLInputElement).disabled).toBe(true);
    });
  });

  it("submit button is NOT disabled before any 429 is received (with PIN entered)", async () => {
    setLoginPinResponse({ ok: false, status: 401, body: {} });

    renderShell();
    await openReauthDialog();

    // Fill in the PIN but don't submit yet.
    fireEvent.change(screen.getByTestId("input-session-reauth-pin"), {
      target: { value: "123456" },
    });

    const btn = screen.getByTestId("button-session-reauth-submit");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});

// ============================================================================
// 3. Time string format  (< 60 s  →  "Xs";  ≥ 60 s  →  "Xm Ys")
// ============================================================================

describe("PIN reauth dialog — lockout time string format", () => {
  it("renders retryAfter < 60 as 'Xs' (e.g. '45s')", async () => {
    setLoginPinResponse({
      ok: false,
      status: 429,
      body: { retryAfter: 45 },
    });

    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call).toBeDefined();
      expect(call!.opts!.time).toBe("45s");
    });
  });

  it("renders retryAfter exactly 60 as '1m 0s'", async () => {
    setLoginPinResponse({
      ok: false,
      status: 429,
      body: { retryAfter: 60 },
    });

    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call).toBeDefined();
      expect(call!.opts!.time).toBe("1m 0s");
    });
  });

  it("renders retryAfter = 90 as '1m 30s'", async () => {
    setLoginPinResponse({
      ok: false,
      status: 429,
      body: { retryAfter: 90 },
    });

    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call).toBeDefined();
      expect(call!.opts!.time).toBe("1m 30s");
    });
  });

  it("renders retryAfter = 900 (15 min) as '15m 0s'", async () => {
    setLoginPinResponse({
      ok: false,
      status: 429,
      body: { retryAfter: 900 },
    });

    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call).toBeDefined();
      expect(call!.opts!.time).toBe("15m 0s");
    });
  });

  it("falls back to retryAfter=60 when the server omits the field", async () => {
    setLoginPinResponse({
      ok: false,
      status: 429,
      body: {}, // no retryAfter field
    });

    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call).toBeDefined();
      // fallback is 60 → "1m 0s"
      expect(call!.opts!.time).toBe("1m 0s");
    });
  });
});

// ============================================================================
// 4. Countdown decrements in real time (fake timers)
// ============================================================================

describe("PIN reauth dialog — countdown ticks down", () => {
  // We intentionally avoid vi.useFakeTimers() here. The countdown effect
  // schedules window.setTimeout inside React's render cycle; mixing fake
  // timers with @testing-library/react's waitFor (which itself relies on
  // setTimeout/setInterval) produces flaky behavior because pending real
  // timers and fake timers live in separate queues. Real-time waits keep
  // the test simple and deterministic at the cost of a few seconds.
  //
  // Helper: wait `ms` real wall-clock milliseconds, then read the latest
  // `time` value passed to the lockedCountdown translation key.
  async function waitAndReadLatestTime(ms: number): Promise<string | undefined> {
    const before = recordedT.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
    // Scan the calls recorded since `before` for the most recent one.
    for (let i = recordedT.length - 1; i >= before; i--) {
      if (recordedT[i].key === "shell.sessionExpiry.lockedCountdown") {
        return recordedT[i].opts?.time as string | undefined;
      }
    }
    return undefined;
  }

  it("decrements the countdown by 1 after one real second", async () => {
    setLoginPinResponse({ ok: false, status: 429, body: { retryAfter: 30 } });
    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    // Initial render: 30s.
    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call).toBeDefined();
      expect(call!.opts!.time).toBe("30s");
    });

    // After ~1.1 s wall-clock, the effect's setTimeout(1000) has fired
    // and the displayed value must be 29s.
    const next = await waitAndReadLatestTime(1100);
    expect(next).toBe("29s");
  }, 10_000);

  it("snaps the displayed countdown to the real clock after tab-hidden drift", async () => {
    // Use vi.useFakeTimers only for Date — real setTimeout/setInterval remain
    // active so waitFor and act keep their normal async semantics.
    vi.useFakeTimers({ toFake: ["Date"] });

    const startNow = Date.now();
    setLoginPinResponse({ ok: false, status: 429, body: { retryAfter: 60 } });
    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    // Wait for the initial "60s" lockout message to appear.
    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call?.opts?.time).toBe("1m 0s");
    });

    // Simulate 30 s of sleep — advance Date.now() without firing any timers
    // (just like a browser would freeze intervals in a background tab).
    vi.setSystemTime(startNow + 30_000);

    // User returns to the tab — dispatch visibilitychange to trigger the snap.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The displayed value must reflect the real clock: 60 s − 30 s = ~30 s.
    await waitFor(() => {
      const calls = recordedT.filter(
        (c) => c.key === "shell.sessionExpiry.lockedCountdown",
      );
      const latestTime = calls[calls.length - 1]?.opts?.time as string | undefined;
      // 30s remaining — the snap must produce a value in the range 28–32s.
      expect(latestTime).toMatch(/^(2[89]|3[012])s$/);
    });
  }, 10_000);

  it("decrements the countdown twice after two real seconds", async () => {
    setLoginPinResponse({ ok: false, status: 429, body: { retryAfter: 10 } });
    renderShell();
    await openReauthDialog();
    await submitReauthForm();

    await waitFor(() => {
      const call = recordedT.find((c) => c.key === "shell.sessionExpiry.lockedCountdown");
      expect(call).toBeDefined();
      expect(call!.opts!.time).toBe("10s");
    });

    // Poll for up to 5 real seconds, looking for at least two distinct
    // lockedCountdown values after the initial "10s" — proves the
    // countdown decrements over time rather than firing once.
    const seen = new Set<string>();
    seen.add("10s");
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
    // We expect to have observed at least 3 distinct values: "10s", "9s", "8s"
    // (the initial render plus two decrement ticks).
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(seen.has("9s")).toBe(true);
    expect(seen.has("8s")).toBe(true);
  }, 15_000);
});
