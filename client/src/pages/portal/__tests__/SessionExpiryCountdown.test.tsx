// @vitest-environment jsdom
//
// Task #346 — Automated tests for the session-expiry countdown logic.
//
// Task #295 added a second-by-second countdown in the final 60 seconds.
// These tests verify:
//
//   1. While secsLeft < 60 the banner displays the messageCountdown key
//      (e.g. "42s") via data-testid="session-expiry-message".
//   2. While secsLeft >= 60 the banner displays the messageWithTime key.
//   3. The 1-second tick fires when msLeft <= 60 000 (final minute).
//   4. The 60-second tick fires when msLeft > 60 000 (outside final minute),
//      together with a switchTimeout scheduled at the 60-second boundary.
//   5. The interval is cleared when the user dismisses the banner.
//   6. The interval is cleared when the component unmounts.
//   7. The interval is cleared (banner hidden) after a successful reauth.
//   8. The countdown actually decrements over real wall-clock time.
//   9. The banner text switches from messageWithTime to messageCountdown as
//      the clock crosses the 60-second boundary in real time (Task #387).

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
// Module mocks — must come before any import of PortalShell
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
    motion: new Proxy({} as any, {
      get: (_t, prop: string) => passthrough(prop as any),
    }),
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
      id: "case-346",
      accessCode: "TASK-0346",
      userName: "Countdown User",
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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/i18n/useLocale", () => ({
  useLocale: () => ({
    locale: {
      code: "en",
      label: "English",
      nativeLabel: "English",
      bcp47: "en",
    },
  }),
}));

// Capture every t() call so tests can assert on key/opts usage.
const recordedT: Array<{ key: string; opts?: Record<string, unknown> }> = [];
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      recordedT.push({ key, opts });
      if (opts && typeof opts.seconds === "number")
        return `${key}:${opts.seconds}s`;
      if (opts && typeof opts.time === "string") return `${key}:${opts.time}`;
      return key;
    },
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

// getPortalSessionExpiresAt is the critical mock — controlled per-test.
const mockGetExpiresAt = vi.fn<() => number | null>(() => null);
vi.mock("@/lib/portalSession", () => ({
  getPortalSessionExpiresAt: () => mockGetExpiresAt(),
  setPortalToken: vi.fn(),
}));

vi.mock("@/i18n/format", () => ({
  useFormat: () => ({
    formatRelative: vi.fn(
      (v: number) => `in ${Math.round((v - Date.now()) / 60_000)} minutes`,
    ),
    formatDate: vi.fn(() => "2026-01-01"),
    formatDateTime: vi.fn(() => "2026-01-01 00:00"),
    formatTime: vi.fn(() => "00:00"),
    formatNumber: vi.fn((n: number) => String(n)),
    formatCurrency: vi.fn((n: number) => String(n)),
  }),
}));

// Stub fetch so the stale-build poller never makes a real request.
const fetchStub = vi.fn(async () => ({
  ok: false,
  status: 204,
  json: async () => ({}),
})) as unknown as typeof fetch;
global.fetch = fetchStub;

// ---------------------------------------------------------------------------
// Import component under test (after all mocks are registered)
// ---------------------------------------------------------------------------
import { PortalShell } from "../PortalShell";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderShell() {
  return render(
    <PortalShell>
      <div data-testid="portal-child">portal content</div>
    </PortalShell>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  recordedT.length = 0;
  (fetchStub as any).mockClear?.();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ===========================================================================
// 1. messageCountdown shown in final minute (secsLeft < 60)
// ===========================================================================

describe("session-expiry-message — messageCountdown key in final minute", () => {
  it("uses the messageCountdown translation key when 42 s remain", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 42 * SEC);

    renderShell();

    await waitFor(() => {
      expect(
        recordedT.some((c) => c.key === "shell.sessionExpiry.messageCountdown"),
      ).toBe(true);
    });
  });

  it("passes the correct seconds value when 42 s remain", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 42 * SEC);

    renderShell();

    await waitFor(() => {
      const call = recordedT.find(
        (c) => c.key === "shell.sessionExpiry.messageCountdown",
      );
      expect(call).toBeDefined();
      // secsLeft = Math.ceil((expiresAt - now) / 1000) ≈ 42
      expect(typeof call!.opts?.seconds).toBe("number");
      expect((call!.opts!.seconds as number)).toBeGreaterThan(0);
      expect((call!.opts!.seconds as number)).toBeLessThanOrEqual(60);
    });
  });

  it("renders the countdown string inside data-testid='session-expiry-message'", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    renderShell();

    await waitFor(() => {
      const el = screen.getByTestId("session-expiry-message");
      // The mocked t() encodes key:Xs for messageCountdown
      expect(el.textContent).toMatch(/messageCountdown/);
    });
  });

  it("does NOT use messageWithTime key when secsLeft < 60", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 20 * SEC);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    expect(
      recordedT.some((c) => c.key === "shell.sessionExpiry.messageWithTime"),
    ).toBe(false);
  });

  it("renders the banner when 1 s remains (boundary)", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 1 * SEC);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    expect(
      recordedT.some((c) => c.key === "shell.sessionExpiry.messageCountdown"),
    ).toBe(true);
  });
});

// ===========================================================================
// 2. messageWithTime shown outside final minute (secsLeft >= 60)
// ===========================================================================

describe("session-expiry-message — messageWithTime key outside final minute", () => {
  it("uses messageWithTime when 5 minutes remain", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 5 * MIN);

    renderShell();

    await waitFor(() => {
      expect(
        recordedT.some((c) => c.key === "shell.sessionExpiry.messageWithTime"),
      ).toBe(true);
    });
  });

  it("does NOT use messageCountdown key when 5 minutes remain", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 5 * MIN);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    expect(
      recordedT.some((c) => c.key === "shell.sessionExpiry.messageCountdown"),
    ).toBe(false);
  });

  it("uses messageWithTime when 2 hours remain", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 2 * HOUR);

    renderShell();

    await waitFor(() => {
      expect(
        recordedT.some((c) => c.key === "shell.sessionExpiry.messageWithTime"),
      ).toBe(true);
    });
  });

  it("renders the banner with messageWithTime text in the DOM", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 3 * MIN);

    renderShell();

    await waitFor(() => {
      const el = screen.getByTestId("session-expiry-message");
      expect(el.textContent).toMatch(/messageWithTime/);
    });
  });

  it("exactly at 60 s boundary treats secsLeft=60 as NOT in final minute", async () => {
    // secsLeft = Math.ceil(60_000 / 1000) = 60, so isInFinalMinute = false.
    mockGetExpiresAt.mockReturnValue(Date.now() + 60 * SEC);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    expect(
      recordedT.some((c) => c.key === "shell.sessionExpiry.messageWithTime"),
    ).toBe(true);
    expect(
      recordedT.some((c) => c.key === "shell.sessionExpiry.messageCountdown"),
    ).toBe(false);
  });
});

// ===========================================================================
// 3. Tick interval logic — 1-second tick inside final minute
// ===========================================================================

describe("tick interval — 1-second interval when msLeft <= 60 000", () => {
  it("calls setInterval with 1 000 ms when expiry is 30 s away", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    const intervals = setIntervalSpy.mock.calls.map((c) => c[1] as number);
    expect(intervals).toContain(1_000);
  });

  it("does NOT call setInterval with 60 000 ms when expiry is 30 s away", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    const intervals = setIntervalSpy.mock.calls.map((c) => c[1] as number);
    expect(intervals).not.toContain(60_000);
  });
});

// ===========================================================================
// 4. Tick interval logic — 60-second tick + switch-timeout outside final minute
// ===========================================================================

describe("tick interval — 60-second interval when msLeft > 60 000", () => {
  it("calls setInterval with 60 000 ms when 5 minutes remain", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    mockGetExpiresAt.mockReturnValue(Date.now() + 5 * MIN);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    const intervals = setIntervalSpy.mock.calls.map((c) => c[1] as number);
    expect(intervals).toContain(60_000);
  });

  it("schedules a setTimeout for the phase-switch when 5 minutes remain", async () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    mockGetExpiresAt.mockReturnValue(Date.now() + 5 * MIN);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    // One setTimeout should fire at (msLeft - 60_000) ≈ 4 * MIN = 240 000.
    // We look for a call whose delay is > 60_000 (the switch-timeout, not
    // the reauthLockout 1-second countdowns which have delay ≤ 1 000).
    const timeouts = setTimeoutSpy.mock.calls.map((c) => c[1] as number);
    expect(timeouts.some((d) => d > 60_000)).toBe(true);
  });

  it("does NOT call setInterval with 1 000 ms immediately when 5 minutes remain", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    mockGetExpiresAt.mockReturnValue(Date.now() + 5 * MIN);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    // The 1-second interval should NOT be present at mount time; it only
    // gets created by startSecondInterval() when the switch-timeout fires.
    const intervals = setIntervalSpy.mock.calls.map((c) => c[1] as number);
    expect(intervals).not.toContain(1_000);
  });
});

// ===========================================================================
// 5. Interval cleared on banner dismiss
// ===========================================================================

describe("interval cleared on banner dismiss", () => {
  it("clears the interval after the user clicks the dismiss button", async () => {
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("button-session-expiry-dismiss"),
      ).toBeTruthy();
    });

    const callsBefore = clearIntervalSpy.mock.calls.length;

    fireEvent.click(screen.getByTestId("button-session-expiry-dismiss"));

    // After dismiss the banner unmounts, triggering the cleanup return.
    await waitFor(() => {
      expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it("hides the banner after the user clicks dismiss", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("button-session-expiry-dismiss"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("portal-session-expiry-banner"),
      ).toBeNull();
    });
  });
});

// ===========================================================================
// 6. Interval cleared on unmount
// ===========================================================================

describe("interval cleared on component unmount", () => {
  it("calls clearInterval when the component unmounts while the banner is visible", async () => {
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    const { unmount } = renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    const callsBefore = clearIntervalSpy.mock.calls.length;

    unmount();

    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

// ===========================================================================
// 7. Banner / interval cleared after successful reauth
// ===========================================================================

describe("interval cleared after successful session extension", () => {
  it("hides the session-expiry banner after a successful PIN reauth", async () => {
    // The fetch stub for /api/cases/login-pin returns success.
    (fetchStub as any).mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/cases/login-pin")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sessionToken: "new-token-346" }),
          } as Response;
        }
        return { ok: false, status: 204, json: async () => ({}) } as Response;
      },
    );

    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    renderShell();

    // Wait for banner + reauth button.
    await waitFor(() => {
      expect(
        screen.getByTestId("button-session-expiry-reauth"),
      ).toBeTruthy();
    });

    // Open the reauth dialog.
    fireEvent.click(screen.getByTestId("button-session-expiry-reauth"));

    await waitFor(() => {
      expect(screen.getByTestId("input-session-reauth-pin")).toBeTruthy();
    });

    // Submit the form.
    fireEvent.change(screen.getByTestId("input-session-reauth-pin"), {
      target: { value: "123456" },
    });
    const form = screen
      .getByTestId("input-session-reauth-pin")
      .closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    // Banner should be gone.
    await waitFor(() => {
      expect(
        screen.queryByTestId("portal-session-expiry-banner"),
      ).toBeNull();
    });
  });

  it("calls clearInterval when the banner is hidden after a successful PIN reauth", async () => {
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    (fetchStub as any).mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/cases/login-pin")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sessionToken: "new-token-346b" }),
          } as Response;
        }
        return { ok: false, status: 204, json: async () => ({}) } as Response;
      },
    );

    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    renderShell();

    // Wait for the 1-second interval to be registered (banner visible).
    await waitFor(() => {
      expect(
        screen.getByTestId("button-session-expiry-reauth"),
      ).toBeTruthy();
    });

    const callsBefore = clearIntervalSpy.mock.calls.length;

    // Open the reauth dialog.
    fireEvent.click(screen.getByTestId("button-session-expiry-reauth"));
    await waitFor(() => {
      expect(screen.getByTestId("input-session-reauth-pin")).toBeTruthy();
    });

    // Submit the form with a valid PIN.
    fireEvent.change(screen.getByTestId("input-session-reauth-pin"), {
      target: { value: "123456" },
    });
    const form = screen
      .getByTestId("input-session-reauth-pin")
      .closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    // Banner disappears → the timer effect cleanup runs → clearInterval called.
    await waitFor(() => {
      expect(
        screen.queryByTestId("portal-session-expiry-banner"),
      ).toBeNull();
    });

    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

// ===========================================================================
// 8. Countdown decrements over real wall-clock time
// ===========================================================================

describe("countdown decrements over time (real timers)", () => {
  it("renders a lower seconds value ~1 s after initial render", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 20 * SEC);

    renderShell();

    // Capture the first seconds value rendered.
    await waitFor(() => {
      expect(
        recordedT.some((c) => c.key === "shell.sessionExpiry.messageCountdown"),
      ).toBe(true);
    });

    const firstCall = recordedT.find(
      (c) => c.key === "shell.sessionExpiry.messageCountdown",
    )!;
    const firstSeconds = firstCall.opts!.seconds as number;

    // Wait ~1.1 s real time so at least one 1-second tick fires.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1_100));
    });

    // Find any subsequent call with a lower (or equal, at minimum) seconds value.
    const allCalls = recordedT.filter(
      (c) => c.key === "shell.sessionExpiry.messageCountdown",
    );
    expect(allCalls.length).toBeGreaterThan(1);

    const latestSeconds = allCalls[allCalls.length - 1].opts!
      .seconds as number;
    expect(latestSeconds).toBeLessThan(firstSeconds);
  }, 10_000);

  it("observes at least two distinct seconds values within 2 s", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 15 * SEC);

    renderShell();

    await waitFor(() => {
      expect(
        recordedT.some((c) => c.key === "shell.sessionExpiry.messageCountdown"),
      ).toBe(true);
    });

    const seen = new Set<number>();
    const deadline = Date.now() + 3_000;

    while (Date.now() < deadline && seen.size < 2) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
      for (const c of recordedT) {
        if (c.key === "shell.sessionExpiry.messageCountdown") {
          seen.add(c.opts!.seconds as number);
        }
      }
    }

    expect(seen.size).toBeGreaterThanOrEqual(2);
  }, 15_000);
});

// ===========================================================================
// 10. Visibility change snaps the countdown to the real clock (Task #482)
// ===========================================================================

describe("visibility change — scheduler restarts from real clock (Task #482)", () => {
  // All tests in this block use real timers so that waitFor/act keep their
  // normal async semantics.  The clock-drift test additionally fakes only
  // Date (not setTimeout/setInterval) so we can advance Date.now() without
  // affecting the live intervals or breaking waitFor's internal polling.

  it("calls setInterval again when the tab becomes visible mid-countdown", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    renderShell();

    await waitFor(() => {
      expect(screen.getByTestId("portal-session-expiry-banner")).toBeTruthy();
    });

    // Begin spying AFTER the banner (and its initial interval) are set up.
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const intervalsBefore = setIntervalSpy.mock.calls.length;
    const clearsBefore = clearIntervalSpy.mock.calls.length;

    // Simulate the user switching back to this tab.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The scheduler must have been restarted — old interval cleared and a
    // new one registered.
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(intervalsBefore);
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(clearsBefore);
  });

  it("ignores visibilitychange when the tab goes hidden", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    renderShell();

    await waitFor(() => {
      expect(screen.getByTestId("portal-session-expiry-banner")).toBeTruthy();
    });

    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const intervalsBefore = setIntervalSpy.mock.calls.length;

    // Simulate the tab going into the background.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // A "hidden" event must NOT restart the scheduler.
    expect(setIntervalSpy.mock.calls.length).toBe(intervalsBefore);
  });

  it("snaps the displayed seconds to the real clock after timer drift in a background tab", async () => {
    // Fake only Date so we can control Date.now() without freezing the
    // component's live intervals or breaking waitFor.
    vi.useFakeTimers({ toFake: ["Date"] });

    const startNow = Date.now();
    const expiryAt = startNow + 30 * SEC;
    mockGetExpiresAt.mockReturnValue(expiryAt);

    renderShell();

    // waitFor works normally because setTimeout/setInterval are still real.
    await waitFor(() => {
      expect(screen.getByTestId("portal-session-expiry-banner")).toBeTruthy();
    });

    const countBefore = recordedT.filter(
      (c) => c.key === "shell.sessionExpiry.messageCountdown",
    ).length;

    // Advance the fake clock by 15 s WITHOUT firing any timers — this
    // simulates a browser that throttled the intervals while the tab was
    // hidden.
    vi.setSystemTime(startNow + 15 * SEC);

    // Simulate the user returning to the tab.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The immediate setLastCheckedAt(Date.now()) snap must have produced at
    // least one new render.
    await waitFor(() => {
      const calls = recordedT.filter(
        (c) => c.key === "shell.sessionExpiry.messageCountdown",
      );
      expect(calls.length).toBeGreaterThan(countBefore);
    });

    // The most-recent render must reflect the real clock:
    // 30 s expiry − 15 s elapsed = ~15 s remaining.
    const allCalls = recordedT.filter(
      (c) => c.key === "shell.sessionExpiry.messageCountdown",
    );
    const lastSecs = allCalls[allCalls.length - 1].opts!.seconds as number;
    expect(lastSecs).toBeGreaterThanOrEqual(14);
    expect(lastSecs).toBeLessThanOrEqual(16);
  });

  it("removes the visibilitychange listener when the banner is dismissed", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    renderShell();

    await waitFor(() => {
      expect(screen.getByTestId("button-session-expiry-dismiss")).toBeTruthy();
    });

    // Dismiss the banner — the effect cleanup must detach the listener.
    fireEvent.click(screen.getByTestId("button-session-expiry-dismiss"));

    await waitFor(() => {
      expect(screen.queryByTestId("portal-session-expiry-banner")).toBeNull();
    });

    // Begin spying after dismiss so we capture only post-dismiss calls.
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const afterDismiss = setIntervalSpy.mock.calls.length;

    // Fire a "visible" event — no new interval should be registered because
    // the listener was removed during cleanup.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(setIntervalSpy.mock.calls.length).toBe(afterDismiss);
  });
});

// ===========================================================================
// 9. Live phase transition — messageWithTime → messageCountdown at 60 s boundary
// ===========================================================================

describe("phase transition — switches from messageWithTime to messageCountdown at the 60 s boundary", () => {
  it(
    "shows messageWithTime before the boundary and messageCountdown after the switch-timeout fires",
    async () => {
      // Place expiry exactly 61 s from now.  The scheduler sets msLeft =
      // 61 000, so it opens a 60-second interval and schedules a switchTimeout
      // for (61 000 − 60 000) = 1 000 ms.  After that timeout fires the
      // 1-second interval starts; its first tick makes React re-render with
      // secsLeft = Math.ceil((61 000 − ~2 100) / 1 000) = 59 < 60, flipping
      // the banner copy to messageCountdown.
      mockGetExpiresAt.mockReturnValue(Date.now() + 61 * SEC);

      renderShell();

      // Phase 1 — 61 s remain → messageWithTime must be shown first.
      await waitFor(() => {
        expect(
          recordedT.some(
            (c) => c.key === "shell.sessionExpiry.messageWithTime",
          ),
        ).toBe(true);
      });
      expect(
        recordedT.some(
          (c) => c.key === "shell.sessionExpiry.messageCountdown",
        ),
      ).toBe(false);

      // Phase 2 — advance past the switch-timeout (1 000 ms) and wait for
      // the first 1-second tick to land (~1 000 ms more), giving a total of
      // ~2 100 ms.  At that point secsLeft ≈ 59 < 60 and the banner must
      // switch to messageCountdown.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 2_200));
      });

      await waitFor(() => {
        expect(
          recordedT.some(
            (c) => c.key === "shell.sessionExpiry.messageCountdown",
          ),
        ).toBe(true);
      });
    },
    15_000,
  );

  it(
    "confirms the seconds value in messageCountdown is less than 60 after the transition",
    async () => {
      mockGetExpiresAt.mockReturnValue(Date.now() + 61 * SEC);

      renderShell();

      // Wait for the switch-timeout + one 1-second tick.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 2_200));
      });

      await waitFor(() => {
        const call = recordedT.find(
          (c) => c.key === "shell.sessionExpiry.messageCountdown",
        );
        expect(call).toBeDefined();
        expect(typeof call!.opts?.seconds).toBe("number");
        expect(call!.opts!.seconds as number).toBeGreaterThan(0);
        expect(call!.opts!.seconds as number).toBeLessThan(60);
      });
    },
    15_000,
  );
});

// ===========================================================================
// 11. Outer checkSessionExpiry re-runs on visibilitychange / focus (Task #553)
//
// The 5-minute outer interval can be stale after device sleep or a long
// background tab. The visibilitychange + focus listeners on the outer effect
// (PortalShell.tsx lines 101-105) ensure checkSessionExpiry fires immediately
// when the device or tab wakes up — no wait for the next interval tick.
// ===========================================================================

describe("outer checkSessionExpiry fires on visibilitychange and focus (Task #553)", () => {
  // Helper: make document.visibilityState return the given value.
  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", {
      value: state,
      configurable: true,
    });
  }

  it("shows the expiry banner immediately when the tab becomes visible and the session is about to expire", async () => {
    // Mount with no imminent expiry so the banner is NOT shown on mount.
    mockGetExpiresAt.mockReturnValue(null);

    renderShell();

    // Banner must be absent right after mount.
    await act(async () => {});
    expect(screen.queryByTestId("portal-session-expiry-banner")).toBeNull();

    // The session is now approaching expiry — simulate what happens when a
    // device wakes from sleep and the stored token is close to expiry.
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    // Fire visibilitychange with state "visible" — this is what the browser
    // dispatches when the laptop lid opens or the user returns to the tab.
    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The outer effect's onVisibility handler must have called checkSessionExpiry
    // synchronously, making the banner appear without waiting for the interval.
    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });
  });

  it("does NOT show the expiry banner when visibilitychange fires with state 'hidden'", async () => {
    // Mount with no expiry.
    mockGetExpiresAt.mockReturnValue(null);

    renderShell();

    await act(async () => {});
    expect(screen.queryByTestId("portal-session-expiry-banner")).toBeNull();

    // Switch to an expiring value...
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    // ...but dispatch visibilitychange with "hidden" — the guard in onVisibility
    // (`if (document.visibilityState === "visible")`) must prevent the re-check.
    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Small wait — banner must still be absent.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.queryByTestId("portal-session-expiry-banner")).toBeNull();
  });

  it("shows the expiry banner immediately when the window receives a focus event", async () => {
    // Mount with no imminent expiry.
    mockGetExpiresAt.mockReturnValue(null);

    renderShell();

    await act(async () => {});
    expect(screen.queryByTestId("portal-session-expiry-banner")).toBeNull();

    // Session is now expiring.
    mockGetExpiresAt.mockReturnValue(Date.now() + 45 * SEC);

    // The outer effect also listens on "focus" (line 104 of PortalShell.tsx),
    // which fires when the OS restores focus to the browser window after waking
    // from sleep. It calls the same onVisibility handler (state "visible").
    setVisibility("visible");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });
  });

  it("hides the banner on visibilitychange when the session token is no longer expiring", async () => {
    // Mount with a session that is about to expire — banner visible.
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);

    renderShell();

    await waitFor(() => {
      expect(screen.getByTestId("portal-session-expiry-banner")).toBeTruthy();
    });

    // Simulate a successful background reauth that extended the session well
    // beyond SESSION_WARN_MS (24 hours). msLeft must be >= 24 h for isExpiring
    // to become false and the banner to disappear.
    mockGetExpiresAt.mockReturnValue(Date.now() + 25 * HOUR);

    // User returns to the tab — visibilitychange triggers checkSessionExpiry
    // which must clear the banner because msLeft is no longer within SESSION_WARN_MS.
    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("portal-session-expiry-banner"),
      ).toBeNull();
    });
  });

  it("removes the visibilitychange listener on unmount so it cannot fire after teardown", async () => {
    mockGetExpiresAt.mockReturnValue(null);

    const { unmount } = renderShell();

    await act(async () => {});

    unmount();

    // After unmount, switch to an expiring value and fire visibilitychange —
    // the listener must be gone (no error, no setState-after-unmount warning).
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * SEC);
    setVisibility("visible");

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Nothing to assert about the banner (component is unmounted), but the
    // dispatch must not throw.  Reaching here without an error is the pass condition.
  });
});

// ===========================================================================
// 12. Outer checkSessionExpiry fires on the 5-minute interval (Task #671)
//
// The setInterval(checkSessionExpiry, 5 * 60 * 1000) on line 105 of
// PortalShell.tsx ensures the warning surfaces even when the device never
// sleeps (so no visibilitychange or focus event fires).  These tests use
// fake timers to advance the clock by exactly 5 minutes and confirm the
// interval path — not just the event-listener path — is wired up correctly.
// ===========================================================================

describe("outer checkSessionExpiry fires on the 5-minute polling interval (Task #671)", () => {
  it("shows the session-expiry banner after a 5-minute interval fires even when the tab never loses focus", async () => {
    vi.useFakeTimers();

    // Mount with no imminent expiry — banner must be absent initially.
    mockGetExpiresAt.mockReturnValue(null);

    renderShell();

    // Flush the immediate checkSessionExpiry() call that runs on mount.
    await act(async () => {});
    expect(screen.queryByTestId("portal-session-expiry-banner")).toBeNull();

    // Session is now approaching expiry: 2 hours left, well within the
    // 24-hour SESSION_WARN_MS threshold, so isExpiring will be true once
    // checkSessionExpiry re-runs.
    mockGetExpiresAt.mockReturnValue(Date.now() + 2 * HOUR);

    // Advance fake time by exactly 5 minutes — this fires the outer
    // setInterval callback (checkSessionExpiry) without any visibilitychange
    // or focus event ever dispatching.
    await act(async () => {
      vi.advanceTimersByTime(5 * MIN);
    });

    // The interval-driven check must have set showSessionExpiry = true.
    expect(screen.getByTestId("portal-session-expiry-banner")).toBeTruthy();
  });

  it("hides the banner when the session is extended before the next 5-minute interval fires", async () => {
    vi.useFakeTimers();

    // Mount with a session that is already within the warning window so the
    // banner is visible from the very first checkSessionExpiry call on mount.
    mockGetExpiresAt.mockReturnValue(Date.now() + 2 * HOUR);

    renderShell();

    // Flush the immediate mount check — banner should be visible.
    await act(async () => {});
    expect(screen.getByTestId("portal-session-expiry-banner")).toBeTruthy();

    // Simulate a background reauth or token refresh that extended the session
    // well beyond SESSION_WARN_MS (25 h > 24 h), so isExpiring becomes false
    // on the next checkSessionExpiry call.
    mockGetExpiresAt.mockReturnValue(Date.now() + 25 * HOUR);

    // Advance fake time by 5 minutes — the outer interval fires and
    // checkSessionExpiry re-evaluates: msLeft ≈ 25 h > SESSION_WARN_MS,
    // so setShowSessionExpiry(false) is called and the banner must disappear.
    await act(async () => {
      vi.advanceTimersByTime(5 * MIN);
    });

    expect(screen.queryByTestId("portal-session-expiry-banner")).toBeNull();
  });
});

// ===========================================================================
// 13. Outer 5-minute poller is cleaned up on the logout flow (Task #763)
//
// Task #671 proves the outer setInterval (PortalShell.tsx line 105) FIRES;
// the unmount test in block 6 proves the inner banner interval is cleared.
// This block closes the remaining gap: it confirms the OUTER 5-minute poller
// is cleared when the portal is torn down via the logout flow (the user
// clicks "Log out" from the PortalContext, then PortalShell unmounts). A
// leaked outer interval would keep calling checkSessionExpiry() — i.e. fire
// setState — on an unmounted component every 5 minutes forever.
// ===========================================================================

describe("outer 5-minute poller cleaned up on logout/unmount (Task #763)", () => {
  it("clears the outer 5-minute interval and never fires checkSessionExpiry after logout + unmount", async () => {
    vi.useFakeTimers();

    // Spy before render so we capture the outer poller's interval id.
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // No imminent expiry — the banner stays hidden so the ONLY interval in
    // play is the outer 5-minute poller (the inner banner scheduler never
    // mounts). This isolates the interval under test.
    mockGetExpiresAt.mockReturnValue(null);

    const { unmount } = renderShell();

    // Flush the mount-time checkSessionExpiry() call.
    await act(async () => {});
    expect(screen.queryByTestId("portal-session-expiry-banner")).toBeNull();

    // Locate the outer poller: the setInterval call registered with a
    // 5 * 60 * 1000 ms delay. Capture its returned id so we can assert it is
    // the one that gets cleared.
    const outerIdx = setIntervalSpy.mock.calls.findIndex(
      (c) => c[1] === 5 * MIN,
    );
    expect(outerIdx).toBeGreaterThanOrEqual(0);
    const outerIntervalId = setIntervalSpy.mock.results[outerIdx].value;

    // Simulate the user clicking "Log out" — this invokes the PortalContext
    // mock's logout action. In production logout tears down the portal route,
    // which unmounts PortalShell, so we unmount immediately after.
    fireEvent.click(screen.getByTestId("button-logout"));
    unmount();

    // The outer poller must have been cleared during the effect cleanup.
    expect(clearIntervalSpy).toHaveBeenCalledWith(outerIntervalId);

    // Arm a value that WOULD make checkSessionExpiry call setState if the
    // cleared interval somehow still fired, then record the baseline number
    // of reads from the (now-stale) interval callback.
    mockGetExpiresAt.mockReturnValue(Date.now() + 2 * HOUR);
    const readsBeforeAdvance = mockGetExpiresAt.mock.calls.length;

    // Advance well past a 5-minute boundary. A leaked interval would invoke
    // checkSessionExpiry (calling getPortalSessionExpiresAt + setState) here.
    await act(async () => {
      vi.advanceTimersByTime(6 * MIN);
    });

    // The cleared interval must NOT have fired: no further reads, no banner.
    expect(mockGetExpiresAt.mock.calls.length).toBe(readsBeforeAdvance);
    expect(screen.queryByTestId("portal-session-expiry-banner")).toBeNull();

    // And no React state-update-after-unmount warning may have surfaced.
    const sawUnmountWarning = consoleErrorSpy.mock.calls.some((args) =>
      args.some(
        (a) =>
          typeof a === "string" &&
          /unmounted component|update to a component/i.test(a),
      ),
    );
    expect(sawUnmountWarning).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  it("calls clearInterval with the outer poller id when logout fires while the expiry banner is visible", async () => {
    vi.useFakeTimers();

    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    // Session already within the warning window → banner visible, so BOTH
    // the outer 5-minute poller and the inner banner scheduler are running.
    mockGetExpiresAt.mockReturnValue(Date.now() + 2 * HOUR);

    const { unmount } = renderShell();

    await act(async () => {});
    expect(screen.getByTestId("portal-session-expiry-banner")).toBeTruthy();

    const outerIdx = setIntervalSpy.mock.calls.findIndex(
      (c) => c[1] === 5 * MIN,
    );
    expect(outerIdx).toBeGreaterThanOrEqual(0);
    const outerIntervalId = setIntervalSpy.mock.results[outerIdx].value;

    // User logs out, portal unmounts.
    fireEvent.click(screen.getByTestId("button-logout"));
    unmount();

    // The outer 5-minute poller is cleaned up even when the banner scheduler
    // was also active.
    expect(clearIntervalSpy).toHaveBeenCalledWith(outerIntervalId);
  });
});
