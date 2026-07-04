// @vitest-environment jsdom
//
// Unit tests for PortalWarningContactChip.
//
// Contracted behaviours:
//   (a) Not rendered when activeWarning is null (no active warning).
//   (b) Not rendered when activeWarning is set but warningDismissed is false
//       (the full overlay is visible; the chip is redundant).
//   (c) Not rendered when activeWarning is set and warningDismissed is true
//       but Tawk.to is NOT configured.
//   (d) Renders when activeWarning is set, warningDismissed is true, and
//       Tawk.to IS configured — the dismissed-but-warning-active state.
//   (e) Clicking the chip calls showTawkto().

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

// ── lucide-react icons ─────────────────────────────────────────────────────
vi.mock("lucide-react", () => ({
  MessageCircle: () => null,
}));

// ── PortalContext mock — injected per-test via mockPortalValue ────────────
let mockPortalValue: {
  activeWarning: { warningAt: Date; minutesTotal: number; message: string } | null;
  warningDismissed: boolean;
};

vi.mock("@/pages/portal/PortalContext", () => ({
  usePortal: () => mockPortalValue,
}));

// ── tawkto module — control isTawktoConfigured and showTawkto ─────────────
const mockShowTawkto = vi.fn();
let tawktoConfigured = false;

vi.mock("@/lib/tawkto", () => ({
  isTawktoConfigured: () => tawktoConfigured,
  showTawkto: () => mockShowTawkto(),
}));

import { PortalWarningContactChip } from "../PortalWarningContactChip";

const ACTIVE_WARNING = {
  warningAt: new Date(Date.now() - 60_000),
  minutesTotal: 5,
  message: "",
};

beforeEach(() => {
  mockShowTawkto.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PortalWarningContactChip", () => {
  it("(a) not rendered when activeWarning is null", () => {
    tawktoConfigured = true;
    mockPortalValue = { activeWarning: null, warningDismissed: false };
    render(<PortalWarningContactChip />);
    expect(screen.queryByTestId("warning-dismissed-contact-support")).toBeNull();
  });

  it("(b) not rendered when warning is active but NOT dismissed (overlay visible)", () => {
    tawktoConfigured = true;
    mockPortalValue = { activeWarning: ACTIVE_WARNING, warningDismissed: false };
    render(<PortalWarningContactChip />);
    expect(screen.queryByTestId("warning-dismissed-contact-support")).toBeNull();
  });

  it("(c) not rendered when warning is dismissed but Tawk.to is NOT configured", () => {
    tawktoConfigured = false;
    mockPortalValue = { activeWarning: ACTIVE_WARNING, warningDismissed: true };
    render(<PortalWarningContactChip />);
    expect(screen.queryByTestId("warning-dismissed-contact-support")).toBeNull();
  });

  it("(d) renders when warning is active, dismissed, and Tawk.to IS configured", () => {
    tawktoConfigured = true;
    mockPortalValue = { activeWarning: ACTIVE_WARNING, warningDismissed: true };
    render(<PortalWarningContactChip />);
    expect(screen.getByTestId("warning-dismissed-contact-support")).toBeTruthy();
    expect(screen.getByText("Contact Support")).toBeTruthy();
  });

  it("(e) clicking the chip calls showTawkto()", () => {
    tawktoConfigured = true;
    mockPortalValue = { activeWarning: ACTIVE_WARNING, warningDismissed: true };
    render(<PortalWarningContactChip />);
    fireEvent.click(screen.getByTestId("warning-dismissed-contact-support"));
    expect(mockShowTawkto).toHaveBeenCalledTimes(1);
  });
});
