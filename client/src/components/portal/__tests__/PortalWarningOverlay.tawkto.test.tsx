// @vitest-environment jsdom
//
// Unit tests for the Tawk.to "Contact Support" integration in PortalWarningOverlay.
//
// Contracted behaviours:
//   (a) When VITE_TAWKTO_PROPERTY_ID and VITE_TAWKTO_WIDGET_ID are set, the
//       "Contact Support" section is rendered inside the overlay.
//   (b) When either env var is absent, the "Contact Support" section is hidden.
//   (c) Clicking "Contact Support" calls showTawkto() (i.e. Tawk_API.showWidget).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// ── framer-motion stub ────────────────────────────────────────────────────
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...r }: any) => <div {...r}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

// ── lucide-react icons ─────────────────────────────────────────────────────
vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  LogOut: () => null,
  Clock: () => null,
  MessageCircle: () => null,
}));

// ── shadcn/ui button ──────────────────────────────────────────────────────
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

// ── i18n ──────────────────────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// ── PortalContext mock ─────────────────────────────────────────────────────
const mockLogout = vi.fn();
const mockDismissWarning = vi.fn();

const ACTIVE_WARNING = {
  warningAt: new Date(Date.now() - 60_000),
  minutesTotal: 10,
  message: "Test lockout message",
};

vi.mock("@/pages/portal/PortalContext", () => ({
  usePortal: () => ({
    activeWarning: ACTIVE_WARNING,
    warningDismissed: false,
    dismissWarning: mockDismissWarning,
    logout: mockLogout,
  }),
}));

// ── tawkto module — we control isTawktoConfigured and showTawkto ──────────
const mockShowTawkto = vi.fn();
let tawktoConfigured = false;

vi.mock("@/lib/tawkto", () => ({
  isTawktoConfigured: () => tawktoConfigured,
  showTawkto: () => mockShowTawkto(),
  hideTawkto: vi.fn(),
}));

import { PortalWarningOverlay } from "../PortalWarningOverlay";

beforeEach(() => {
  mockLogout.mockReset();
  mockDismissWarning.mockReset();
  mockShowTawkto.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PortalWarningOverlay — Tawk.to Contact Support", () => {
  it("(a) renders Contact Support section when Tawk.to is configured", () => {
    tawktoConfigured = true;
    render(<PortalWarningOverlay />);
    expect(screen.getByTestId("contact-support-section")).toBeTruthy();
    expect(screen.getByTestId("button-contact-support")).toBeTruthy();
  });

  it("(b) hides Contact Support section when Tawk.to is NOT configured", () => {
    tawktoConfigured = false;
    render(<PortalWarningOverlay />);
    expect(screen.queryByTestId("contact-support-section")).toBeNull();
    expect(screen.queryByTestId("button-contact-support")).toBeNull();
  });

  it("(c) clicking Contact Support calls showTawkto()", () => {
    tawktoConfigured = true;
    render(<PortalWarningOverlay />);
    fireEvent.click(screen.getByTestId("button-contact-support"));
    expect(mockShowTawkto).toHaveBeenCalledTimes(1);
  });
});
