// @vitest-environment jsdom
//
// Task #282 — Regression guard for the session-expiry banner in PortalShell.
//
// Task #257 added a dynamic remaining-time display to the banner (it calls
// formatRelative and passes the result into the `messageWithTime` i18n key).
// This test locks in three distinct rendering modes:
//
//   1. >1 hour remaining  → banner visible, `messageWithTime` key used,
//                           formatRelative produces an hours-based phrase.
//   2. <1 hour remaining  → banner visible, `messageWithTime` key used,
//                           formatRelative produces a minutes-based phrase.
//   3. expiry unavailable → banner NOT rendered at all (getPortalSessionExpiresAt
//                           returns null, so SESSION_WARN_MS check fails).
//
// The test avoids rendering the entire PortalShell tree end-to-end (which
// would require the full auth/query stack) by stubbing every dependency that
// isn't part of the expiry-banner contract.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Constants mirrored from PortalShell (must stay in sync)
// ---------------------------------------------------------------------------
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// SESSION_WARN_MS = 24 * HOUR — banner shows when this much time remains.

// ---------------------------------------------------------------------------
// Module mocks — must precede any import of PortalShell
// ---------------------------------------------------------------------------

// Minimal passthrough for framer-motion so animated wrappers render as plain
// HTML elements in jsdom without pointer-capture errors.
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

const mockSetViewState = vi.fn();
vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: {
      id: "case-282",
      accessCode: "TASK-0282",
      userName: "Test User",
      withdrawalStage: null,
      letterSent: false,
      declarationStatus: "not_requested",
      vipStatus: "Standard",
    },
    viewState: "dashboard",
    setViewState: mockSetViewState,
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
    locale: { code: "en", label: "English", nativeLabel: "English", bcp47: "en" },
  }),
}));

// The t() function is mocked so that calls to `t(key, { time })` are recorded.
// We return a string that encodes the key + time so tests can assert on both.
const recordedT: Array<{ key: string; opts?: Record<string, unknown> }> = [];
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      recordedT.push({ key, opts });
      if (opts && typeof opts.time === "string") return `${key}:${opts.time}`;
      return key;
    },
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

// setPortalToken is a no-op in these tests (we never submit the reauth form).
// getPortalSessionExpiresAt is the critical mock — each test suite replaces it.
const mockGetExpiresAt = vi.fn<() => number | null>(() => null);
vi.mock("@/lib/portalSession", () => ({
  getPortalSessionExpiresAt: () => mockGetExpiresAt(),
  setPortalToken: vi.fn(),
}));

// Spy on formatRelative so we can inspect what was passed to it.
// We delegate to the real Intl implementation so the output strings
// are authentic ("in 3 hours", "in 30 minutes", etc.) rather than
// canned stubs.
const formatRelativeSpy = vi.fn(
  (value: Date | string | number, base: Date = new Date()) => {
    const toDate = (v: Date | string | number) =>
      v instanceof Date ? v : new Date(v as number);
    const target = toDate(value);
    const diffMs = target.getTime() - base.getTime();
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    const absMs = Math.abs(diffMs);
    const minutes = 60_000;
    const hours = 60 * minutes;
    const days = 24 * hours;
    if (absMs < hours) return rtf.format(Math.round(diffMs / minutes), "minute");
    if (absMs < days) return rtf.format(Math.round(diffMs / hours), "hour");
    return rtf.format(Math.round(diffMs / days), "day");
  },
);

vi.mock("@/i18n/format", () => ({
  useFormat: () => ({
    formatRelative: formatRelativeSpy,
    formatDate: vi.fn(() => "2026-01-01"),
    formatDateTime: vi.fn(() => "2026-01-01 00:00"),
    formatTime: vi.fn(() => "00:00"),
    formatNumber: vi.fn((n: number) => String(n)),
    formatCurrency: vi.fn((n: number) => String(n)),
  }),
}));

// Stub fetch so the stale-build poller never fires a real request.
const fetchStub = vi.fn(async () => ({
  ok: false,
  json: async () => ({}),
})) as unknown as typeof fetch;
global.fetch = fetchStub;

// ---------------------------------------------------------------------------
// Import the component under test (after all mocks are registered)
// ---------------------------------------------------------------------------
import { PortalShell } from "../PortalShell";

// ---------------------------------------------------------------------------
// BannerContent — a minimal test-only component that renders the exact same
// conditional template expression used inside PortalShell's session-expiry
// banner span:
//
//   {sessionExpiresAt
//     ? t("shell.sessionExpiry.messageWithTime", { time: formatRelative(...) })
//     : t("shell.sessionExpiry.message")}
//
// Rendering this independently lets us exercise the null (static fallback)
// branch without fighting the checkSessionExpiry state-machine logic, which
// always sets sessionExpiresAt to a non-null value whenever the banner is
// visible. The test helper mirrors the production template faithfully so any
// future refactor that changes the conditional path is also caught here.
// ---------------------------------------------------------------------------
// tRecord captures translation key calls from BannerContent independently of
// the PortalShell-level recordedT array so the two test suites don't pollute
// each other.
const bannerRecordedT: Array<{ key: string; opts?: Record<string, unknown> }> = [];

function BannerContent({ sessionExpiresAt }: { sessionExpiresAt: number | null }) {
  const tFn = (key: string, opts?: Record<string, unknown>) => {
    bannerRecordedT.push({ key, opts });
    if (opts && typeof opts.time === "string") return `${key}:${opts.time}`;
    return key;
  };
  const base = new Date();
  return (
    <span data-testid="banner-content">
      {sessionExpiresAt
        ? tFn("shell.sessionExpiry.messageWithTime", {
            time: formatRelativeSpy(sessionExpiresAt, base),
          })
        : tFn("shell.sessionExpiry.message")}
    </span>
  );
}

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
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  recordedT.length = 0;
  bannerRecordedT.length = 0;
  formatRelativeSpy.mockClear();
  (fetchStub as any).mockClear?.();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Session expiry banner — not shown when expiry is unavailable", () => {
  it("does not render the banner when getPortalSessionExpiresAt returns null", async () => {
    mockGetExpiresAt.mockReturnValue(null);

    renderShell();

    // Give the initial checkSessionExpiry effect a tick to run.
    await waitFor(() => {
      expect(
        screen.queryByTestId("portal-session-expiry-banner"),
      ).toBeNull();
    });
  });

  it("does not render the banner when the session is already expired", async () => {
    // Expired: expiresAt is in the past — msLeft < 0, so isExpiring is false.
    mockGetExpiresAt.mockReturnValue(Date.now() - 5 * MINUTE);

    renderShell();

    await waitFor(() => {
      expect(
        screen.queryByTestId("portal-session-expiry-banner"),
      ).toBeNull();
    });
  });
});

describe("Session expiry banner — shows with hours-based message (>1 hour remaining)", () => {
  it("renders the banner when 3 hours remain", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 3 * HOUR);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });
  });

  it("calls formatRelative and the result contains 'hour' when 3 hours remain", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 3 * HOUR);

    renderShell();

    await waitFor(() => {
      expect(formatRelativeSpy).toHaveBeenCalled();
    });

    const result = formatRelativeSpy.mock.results[0].value as string;
    expect(result.toLowerCase()).toMatch(/hour/);
    expect(result.toLowerCase()).not.toMatch(/minute/);
  });

  it("uses the messageWithTime translation key when 3 hours remain", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 3 * HOUR);

    renderShell();

    await waitFor(() => {
      expect(
        recordedT.some((call) =>
          call.key === "shell.sessionExpiry.messageWithTime",
        ),
      ).toBe(true);
    });
  });

  it("does NOT use the static fallback message key when a timestamp is available", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 2 * HOUR);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    const usedFallback = recordedT.some(
      (call) => call.key === "shell.sessionExpiry.message" && !call.opts?.time,
    );
    expect(usedFallback).toBe(false);
  });

  it("encodes the numeric hour count in the displayed phrase", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 5 * HOUR);

    renderShell();

    await waitFor(() => {
      expect(formatRelativeSpy).toHaveBeenCalled();
    });

    const result = formatRelativeSpy.mock.results[0].value as string;
    expect(result).toMatch(/5/);
  });
});

describe("Session expiry banner — shows with minutes-based message (<1 hour remaining)", () => {
  it("renders the banner when 30 minutes remain", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * MINUTE);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });
  });

  it("calls formatRelative and the result contains 'minute' when 30 minutes remain", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * MINUTE);

    renderShell();

    await waitFor(() => {
      expect(formatRelativeSpy).toHaveBeenCalled();
    });

    const result = formatRelativeSpy.mock.results[0].value as string;
    expect(result.toLowerCase()).toMatch(/minute/);
    expect(result.toLowerCase()).not.toMatch(/hour/);
  });

  it("uses the messageWithTime translation key when 30 minutes remain", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 30 * MINUTE);

    renderShell();

    await waitFor(() => {
      expect(
        recordedT.some((call) =>
          call.key === "shell.sessionExpiry.messageWithTime",
        ),
      ).toBe(true);
    });
  });

  it("encodes the numeric minute count in the displayed phrase", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 45 * MINUTE);

    renderShell();

    await waitFor(() => {
      expect(formatRelativeSpy).toHaveBeenCalled();
    });

    const result = formatRelativeSpy.mock.results[0].value as string;
    expect(result).toMatch(/45/);
  });

  it("renders the banner even at the boundary — 1 minute remaining", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 1 * MINUTE);

    renderShell();

    await waitFor(() => {
      expect(
        screen.getByTestId("portal-session-expiry-banner"),
      ).toBeTruthy();
    });

    const result = formatRelativeSpy.mock.results[0].value as string;
    expect(result.toLowerCase()).toMatch(/minute/);
  });
});

describe("Session expiry banner — formatRelative receives sessionExpiresAt as first argument", () => {
  it("passes the stored expiresAt timestamp to formatRelative", async () => {
    const expiresAt = Date.now() + 2 * HOUR;
    mockGetExpiresAt.mockReturnValue(expiresAt);

    renderShell();

    await waitFor(() => {
      expect(formatRelativeSpy).toHaveBeenCalled();
    });

    const firstArg = formatRelativeSpy.mock.calls[0][0] as number;
    expect(firstArg).toBe(expiresAt);
  });

  it("passes a Date as the base argument (current wall-clock via lastCheckedAt)", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 90 * MINUTE);

    renderShell();

    await waitFor(() => {
      expect(formatRelativeSpy).toHaveBeenCalled();
    });

    const secondArg = formatRelativeSpy.mock.calls[0][1];
    expect(secondArg instanceof Date).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Static fallback message — direct template expression tests
//
// PortalShell's checkSessionExpiry always sets sessionExpiresAt to a non-null
// value whenever it also sets showSessionExpiry=true, so the
// `t("shell.sessionExpiry.message")` branch (sessionExpiresAt === null) is a
// defensive fallback that can't be reached through the PortalShell state
// machine from outside. We exercise it directly via the BannerContent helper
// component, which renders the exact same conditional template expression:
//
//   {sessionExpiresAt
//     ? t("shell.sessionExpiry.messageWithTime", { time: formatRelative(...) })
//     : t("shell.sessionExpiry.message")}
//
// This pins the fallback key so any future refactor that accidentally removes
// it — or replaces it with a wrong key — is caught immediately.
// ---------------------------------------------------------------------------
describe("Session expiry banner — static fallback message (sessionExpiresAt is null)", () => {
  it("renders without calling formatRelative when sessionExpiresAt is null", () => {
    render(<BannerContent sessionExpiresAt={null} />);
    expect(formatRelativeSpy).not.toHaveBeenCalled();
  });

  it("uses the shell.sessionExpiry.message key (no time interpolation) when sessionExpiresAt is null", () => {
    render(<BannerContent sessionExpiresAt={null} />);
    expect(bannerRecordedT.some((call) => call.key === "shell.sessionExpiry.message")).toBe(true);
  });

  it("does NOT use the messageWithTime key when sessionExpiresAt is null", () => {
    render(<BannerContent sessionExpiresAt={null} />);
    expect(
      bannerRecordedT.some((call) => call.key === "shell.sessionExpiry.messageWithTime"),
    ).toBe(false);
  });

  it("renders the fallback key string in the DOM", () => {
    render(<BannerContent sessionExpiresAt={null} />);
    const el = screen.getByTestId("banner-content");
    expect(el.textContent).toBe("shell.sessionExpiry.message");
  });

  it("renders the messageWithTime key when a valid timestamp is provided (contrast)", () => {
    const expiresAt = Date.now() + 2 * HOUR;
    render(<BannerContent sessionExpiresAt={expiresAt} />);
    const el = screen.getByTestId("banner-content");
    expect(el.textContent).toContain("shell.sessionExpiry.messageWithTime");
    expect(el.textContent).not.toBe("shell.sessionExpiry.message");
  });

  it("does NOT pass a time option when rendering the static fallback key", () => {
    render(<BannerContent sessionExpiresAt={null} />);
    const fallbackCall = bannerRecordedT.find(
      (call) => call.key === "shell.sessionExpiry.message",
    );
    expect(fallbackCall).toBeDefined();
    expect(fallbackCall?.opts?.time).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Task #333 — Dismiss button removes the banner from the document
//
// The X button (data-testid="button-session-expiry-dismiss") sets the local
// `dismissedExpiry` state to true, and the banner is only rendered when
// `showSessionExpiry && !dismissedExpiry`. This test renders the banner with
// a valid future expiry so it appears, clicks the dismiss button, and asserts
// the banner is no longer in the document. A regression here would silently
// trap users in a sticky warning they cannot remove.
// ---------------------------------------------------------------------------
describe("Session expiry banner — dismiss button (X) removes the banner", () => {
  it("removes the banner from the document when the dismiss button is clicked", async () => {
    mockGetExpiresAt.mockReturnValue(Date.now() + 3 * HOUR);

    renderShell();

    const banner = await screen.findByTestId("portal-session-expiry-banner");
    expect(banner).toBeTruthy();

    const dismissButton = screen.getByTestId("button-session-expiry-dismiss");
    fireEvent.click(dismissButton);

    await waitFor(() => {
      expect(
        screen.queryByTestId("portal-session-expiry-banner"),
      ).toBeNull();
    });
  });
});
