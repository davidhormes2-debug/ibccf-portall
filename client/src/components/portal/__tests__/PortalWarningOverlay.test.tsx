// @vitest-environment jsdom
//
// Unit tests for PortalWarningOverlay.
//
// Contracted behaviours:
//   (a) Not rendered when activeWarning is null.
//   (b) Not rendered when warningDismissed is true (even with an active warning).
//   (c) Renders the alertdialog landmark when a warning is active.
//   (d) Displays the correct countdown string (mm:ss) for time remaining.
//   (e) Shows 00:00 when the warning has already expired (no negative display).
//   (f) "Log Out Now" button calls the logout function from usePortal.
//   (g) "Dismiss" button calls the dismissWarning function from usePortal.
//   (h) The countdown ticks toward zero as fake time advances.
//   (h2) Fires logout once when the countdown timer reaches zero (onExpire).

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

// ── framer-motion: passthrough stub so motion.div is a plain div ──────────
vi.mock("framer-motion", () => {
  const passthrough = (tag: keyof React.JSX.IntrinsicElements) => {
    const C = ({ children, ...rest }: Record<string, unknown>) => {
      const {
        initial, animate, exit, transition, whileHover, whileTap,
        layoutId, layout, variants, custom, onAnimationComplete,
        ...domRest
      } = rest as any;
      void initial; void animate; void exit; void transition;
      void whileHover; void whileTap; void layoutId; void layout;
      void variants; void custom; void onAnimationComplete;
      return React.createElement(tag as string, domRest, children as React.ReactNode);
    };
    C.displayName = `motion.${String(tag)}`;
    return C;
  };
  return {
    motion: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => passthrough(prop as keyof React.JSX.IntrinsicElements),
    }),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

// ── react-i18next: return actual English strings for closureWarning keys ──
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "closureWarning.heading": "Portal Session Closing",
        "closureWarning.fallbackMessage":
          "Your portal session has been automatically scheduled for closure by the IBCCF compliance system.",
        "closureWarning.timeRemainingLabel": "Time Remaining",
        "closureWarning.autoLogoutNote":
          "You will be logged out automatically when the timer reaches zero",
        "closureWarning.logOutNow": "Log Out Now",
        "closureWarning.dismiss": "Dismiss",
        "closureWarning.dismissNote":
          "Dismissing hides this overlay but does not cancel the closure.",
        "closureWarning.ariaLabel": "Portal closure warning",
      };
      return map[key] ?? key;
    },
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

// ── Silence lucide-react icons ────────────────────────────────────────────
vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  LogOut: () => null,
  Clock: () => null,
}));

// ── PortalContext mock — injected per-test via mockPortalValue ────────────
let mockPortalValue: {
  activeWarning: { warningAt: Date; minutesTotal: number; message: string } | null;
  warningDismissed: boolean;
  dismissWarning: () => void;
  logout: () => void;
};

vi.mock("@/pages/portal/PortalContext", () => ({
  usePortal: () => mockPortalValue,
}));

// ── Button stub (shadcn) ──────────────────────────────────────────────────
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...rest }: any) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));

import { PortalWarningOverlay } from "../PortalWarningOverlay";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeWarning(
  minutesFromNow: number,
  minutesTotal: number,
  message = "",
): { warningAt: Date; minutesTotal: number; message: string } {
  const warningAt = new Date(Date.now() - (minutesTotal - minutesFromNow) * 60_000);
  return { warningAt, minutesTotal, message };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("PortalWarningOverlay — visibility", () => {
  it("(a) does not render when activeWarning is null", () => {
    mockPortalValue = {
      activeWarning: null,
      warningDismissed: false,
      dismissWarning: vi.fn(),
      logout: vi.fn(),
    };

    render(<PortalWarningOverlay />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("(b) does not render when warningDismissed is true", () => {
    mockPortalValue = {
      activeWarning: makeWarning(4, 5),
      warningDismissed: true,
      dismissWarning: vi.fn(),
      logout: vi.fn(),
    };

    render(<PortalWarningOverlay />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("(c) renders the alertdialog when a warning is active and not dismissed", () => {
    mockPortalValue = {
      activeWarning: makeWarning(4, 5),
      warningDismissed: false,
      dismissWarning: vi.fn(),
      logout: vi.fn(),
    };

    render(<PortalWarningOverlay />);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Portal Session Closing")).toBeTruthy();
  });
});

describe("PortalWarningOverlay — countdown display", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  it("(d) displays the correct mm:ss countdown for time remaining", () => {
    const minutesTotal = 5;
    const warningAt = new Date(Date.now() - 30_000);
    mockPortalValue = {
      activeWarning: { warningAt, minutesTotal, message: "" },
      warningDismissed: false,
      dismissWarning: vi.fn(),
      logout: vi.fn(),
    };

    render(<PortalWarningOverlay />);
    expect(screen.getByText("04:30")).toBeTruthy();
  });

  it("(e) shows 00:00 when the warning has already expired (no negative display)", () => {
    const minutesTotal = 3;
    const warningAt = new Date(Date.now() - 5 * 60_000);
    mockPortalValue = {
      activeWarning: { warningAt, minutesTotal, message: "" },
      warningDismissed: false,
      dismissWarning: vi.fn(),
      logout: vi.fn(),
    };

    render(<PortalWarningOverlay />);
    expect(screen.getByText("00:00")).toBeTruthy();
  });

  it("(h) countdown ticks toward zero as time advances", () => {
    const minutesTotal = 2;
    const warningAt = new Date(Date.now());
    mockPortalValue = {
      activeWarning: { warningAt, minutesTotal, message: "" },
      warningDismissed: false,
      dismissWarning: vi.fn(),
      logout: vi.fn(),
    };

    render(<PortalWarningOverlay />);

    const initial = screen.getByText(/^\d{2}:\d{2}$/);
    expect(initial.textContent).toBe("02:00");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    const after30 = screen.getByText(/^\d{2}:\d{2}$/);
    expect(after30.textContent).toBe("01:30");
  });

  it("(h2) fires logout when the countdown timer reaches zero (onExpire)", () => {
    const logout = vi.fn();
    const minutesTotal = 1;
    const warningAt = new Date(Date.now());
    mockPortalValue = {
      activeWarning: { warningAt, minutesTotal, message: "" },
      warningDismissed: false,
      dismissWarning: vi.fn(),
      logout,
    };

    render(<PortalWarningOverlay />);

    expect(screen.getByText(/^\d{2}:\d{2}$/).textContent).toBe("01:00");

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(screen.getByText(/^\d{2}:\d{2}$/).textContent).toBe("00:00");
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe("PortalWarningOverlay — button actions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  it("(f) Log Out Now button calls logout from usePortal", () => {
    const logout = vi.fn();
    mockPortalValue = {
      activeWarning: makeWarning(4, 5),
      warningDismissed: false,
      dismissWarning: vi.fn(),
      logout,
    };

    render(<PortalWarningOverlay />);
    fireEvent.click(screen.getByText(/Log Out Now/i));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("(g) Dismiss button calls dismissWarning from usePortal", () => {
    const dismissWarning = vi.fn();
    mockPortalValue = {
      activeWarning: makeWarning(4, 5),
      warningDismissed: false,
      dismissWarning,
      logout: vi.fn(),
    };

    render(<PortalWarningOverlay />);
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss$/i }));
    expect(dismissWarning).toHaveBeenCalledTimes(1);
  });
});

describe("PortalWarningOverlay — custom message", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  it("renders the custom message from activeWarning when provided", () => {
    mockPortalValue = {
      activeWarning: makeWarning(4, 5, "Please re-login after the session closes."),
      warningDismissed: false,
      dismissWarning: vi.fn(),
      logout: vi.fn(),
    };

    render(<PortalWarningOverlay />);
    expect(screen.getByText("Please re-login after the session closes.")).toBeTruthy();
  });

  it("renders the default message when no custom message is provided", () => {
    mockPortalValue = {
      activeWarning: makeWarning(4, 5, ""),
      warningDismissed: false,
      dismissWarning: vi.fn(),
      logout: vi.fn(),
    };

    render(<PortalWarningOverlay />);
    expect(
      screen.getByText(/Your portal session has been automatically scheduled/i),
    ).toBeTruthy();
  });
});
