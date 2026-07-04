// @vitest-environment jsdom
//
// Unit tests for the non-production escape-hatch flag banner
// (EscapeHatchDevBanner). The banner renders in amber/yellow and is shown
// whenever any of the three escape-hatch flags is active AND the server is
// NOT in production mode. This is additive and distinct from the existing
// orange production-critical banners (WeakAdminPasswordBanner etc.).
//
// Contracted behaviours:
//   (a) Banner renders when a flag is active and isProduction=false.
//   (b) Banner does NOT render when all flags are inactive.
//   (c) Banner does NOT render when isProduction=true (production banners
//       handle that case).
//   (d) Banner is undismissable — no dismiss button is rendered.
//   (e) Each active flag name appears in the banner text.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  EscapeHatchDevBanner,
  type EscapeHatchDevBannerFlags,
} from "../EscapeHatchDevBanner";

const BASE_FLAGS: EscapeHatchDevBannerFlags = {
  weakAdminPasswordAllowed: false,
  weakAdminUsernameAllowed: false,
  weakSessionSecretAllowed: false,
  isProduction: false,
};

describe("EscapeHatchDevBanner", () => {
  afterEach(() => {
    cleanup();
  });

  // ── (a) renders when a flag is active and isProduction=false ─────────────

  it("renders when weakAdminPasswordAllowed is true and not production", () => {
    render(
      <EscapeHatchDevBanner
        flags={{ ...BASE_FLAGS, weakAdminPasswordAllowed: true }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-dev")).not.toBeNull();
  });

  it("renders when weakAdminUsernameAllowed is true and not production", () => {
    render(
      <EscapeHatchDevBanner
        flags={{ ...BASE_FLAGS, weakAdminUsernameAllowed: true }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-dev")).not.toBeNull();
  });

  it("renders when weakSessionSecretAllowed is true and not production", () => {
    render(
      <EscapeHatchDevBanner
        flags={{ ...BASE_FLAGS, weakSessionSecretAllowed: true }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-dev")).not.toBeNull();
  });

  it("renders when all three flags are active and not production", () => {
    render(
      <EscapeHatchDevBanner
        flags={{
          weakAdminPasswordAllowed: true,
          weakAdminUsernameAllowed: true,
          weakSessionSecretAllowed: true,
          isProduction: false,
        }}
      />,
    );
    const banner = screen.getByTestId("banner-escape-hatch-dev");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
    expect(banner.textContent).toContain("ALLOW_WEAK_SESSION_SECRET=1");
  });

  // ── (b) does NOT render when all flags are inactive ──────────────────────

  it("does not render when all flags are false (not production)", () => {
    render(<EscapeHatchDevBanner flags={BASE_FLAGS} />);
    expect(screen.queryByTestId("banner-escape-hatch-dev")).toBeNull();
  });

  it("does not render when flags prop is null", () => {
    render(<EscapeHatchDevBanner flags={null} />);
    expect(screen.queryByTestId("banner-escape-hatch-dev")).toBeNull();
  });

  // ── (c) does NOT render when isProduction=true ───────────────────────────

  it("does not render when isProduction is true even if a flag is active", () => {
    render(
      <EscapeHatchDevBanner
        flags={{
          weakAdminPasswordAllowed: true,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: false,
          isProduction: true,
        }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-dev")).toBeNull();
  });

  it("does not render when isProduction is true and all three flags active", () => {
    render(
      <EscapeHatchDevBanner
        flags={{
          weakAdminPasswordAllowed: true,
          weakAdminUsernameAllowed: true,
          weakSessionSecretAllowed: true,
          isProduction: true,
        }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-dev")).toBeNull();
  });

  // ── (d) banner is undismissable ───────────────────────────────────────────

  it("does not render a dismiss button", () => {
    render(
      <EscapeHatchDevBanner
        flags={{ ...BASE_FLAGS, weakAdminPasswordAllowed: true }}
      />,
    );
    expect(
      screen.queryByTestId("button-dismiss-escape-hatch-dev-banner"),
    ).toBeNull();
  });

  it("remains visible on remount within the same session (no dismiss mechanism)", () => {
    render(
      <EscapeHatchDevBanner
        flags={{ ...BASE_FLAGS, weakAdminPasswordAllowed: true }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-dev")).not.toBeNull();

    cleanup();

    render(
      <EscapeHatchDevBanner
        flags={{ ...BASE_FLAGS, weakAdminPasswordAllowed: true }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-dev")).not.toBeNull();
  });

  // ── (e) flag names appear in the banner text ──────────────────────────────

  it("shows ALLOW_WEAK_ADMIN_PASSWORD=1 when only that flag is active", () => {
    render(
      <EscapeHatchDevBanner
        flags={{ ...BASE_FLAGS, weakAdminPasswordAllowed: true }}
      />,
    );
    const banner = screen.getByTestId("banner-escape-hatch-dev");
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    expect(banner.textContent).not.toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
    expect(banner.textContent).not.toContain("ALLOW_WEAK_SESSION_SECRET=1");
  });

  it("shows ALLOW_WEAK_SESSION_SECRET=1 when only that flag is active", () => {
    render(
      <EscapeHatchDevBanner
        flags={{ ...BASE_FLAGS, weakSessionSecretAllowed: true }}
      />,
    );
    const banner = screen.getByTestId("banner-escape-hatch-dev");
    expect(banner.textContent).toContain("ALLOW_WEAK_SESSION_SECRET=1");
    expect(banner.textContent).not.toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    expect(banner.textContent).not.toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
  });
});
