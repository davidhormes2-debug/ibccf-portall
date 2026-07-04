// @vitest-environment jsdom
//
// Unit tests for the production escape-hatch flag banner
// (EscapeHatchProdBanner). The banner renders in red and is shown whenever
// any of the three escape-hatch flags is active AND the server IS in
// production mode. This is the production counterpart of EscapeHatchDevBanner
// (which shows only when NOT in production).
//
// The banner is intentionally undismissable — it must remain visible for the
// entire session until the operator removes the flag from the environment.
//
// Contracted behaviours:
//   (a) Banner renders when a flag is active and isProduction=true.
//   (b) Banner does NOT render when all flags are inactive.
//   (c) Banner does NOT render when isProduction=false (dev banner handles
//       that case).
//   (d) Each active flag name appears in the banner text.
//   (e) Banner does NOT render when flags prop is null.
//   (f) Banner has no dismiss button.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  EscapeHatchProdBanner,
  type EscapeHatchProdBannerFlags,
} from "../EscapeHatchProdBanner";

const BASE_FLAGS: EscapeHatchProdBannerFlags = {
  weakAdminPasswordAllowed: false,
  weakAdminUsernameAllowed: false,
  weakSessionSecretAllowed: false,
  isProduction: true,
};

describe("EscapeHatchProdBanner", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  // ── (a) renders when a flag is active and isProduction=true ──────────────

  it("renders when weakAdminPasswordAllowed is true and isProduction=true", () => {
    render(
      <EscapeHatchProdBanner
        flags={{ ...BASE_FLAGS, weakAdminPasswordAllowed: true }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-prod")).not.toBeNull();
  });

  it("renders when weakAdminUsernameAllowed is true and isProduction=true", () => {
    render(
      <EscapeHatchProdBanner
        flags={{ ...BASE_FLAGS, weakAdminUsernameAllowed: true }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-prod")).not.toBeNull();
  });

  it("renders when weakSessionSecretAllowed is true and isProduction=true", () => {
    render(
      <EscapeHatchProdBanner
        flags={{ ...BASE_FLAGS, weakSessionSecretAllowed: true }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-prod")).not.toBeNull();
  });

  it("renders when all three flags are active and isProduction=true", () => {
    render(
      <EscapeHatchProdBanner
        flags={{
          weakAdminPasswordAllowed: true,
          weakAdminUsernameAllowed: true,
          weakSessionSecretAllowed: true,
          isProduction: true,
        }}
      />,
    );
    const banner = screen.getByTestId("banner-escape-hatch-prod");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
    expect(banner.textContent).toContain("ALLOW_WEAK_SESSION_SECRET=1");
  });

  // ── (b) does NOT render when all flags are inactive ──────────────────────

  it("does not render when all flags are false (production)", () => {
    render(<EscapeHatchProdBanner flags={BASE_FLAGS} />);
    expect(screen.queryByTestId("banner-escape-hatch-prod")).toBeNull();
  });

  // ── (c) does NOT render when isProduction=false ───────────────────────────

  it("does not render when isProduction is false even if a flag is active", () => {
    render(
      <EscapeHatchProdBanner
        flags={{
          weakAdminPasswordAllowed: true,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: false,
          isProduction: false,
        }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-prod")).toBeNull();
  });

  it("does not render when isProduction is false and all three flags are active", () => {
    render(
      <EscapeHatchProdBanner
        flags={{
          weakAdminPasswordAllowed: true,
          weakAdminUsernameAllowed: true,
          weakSessionSecretAllowed: true,
          isProduction: false,
        }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-prod")).toBeNull();
  });

  // ── (d) flag names appear in the banner text ─────────────────────────────

  it("shows ALLOW_WEAK_ADMIN_PASSWORD=1 when only that flag is active", () => {
    render(
      <EscapeHatchProdBanner
        flags={{ ...BASE_FLAGS, weakAdminPasswordAllowed: true }}
      />,
    );
    const banner = screen.getByTestId("banner-escape-hatch-prod");
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    expect(banner.textContent).not.toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
    expect(banner.textContent).not.toContain("ALLOW_WEAK_SESSION_SECRET=1");
  });

  it("shows ALLOW_WEAK_ADMIN_USERNAME=1 when only that flag is active", () => {
    render(
      <EscapeHatchProdBanner
        flags={{ ...BASE_FLAGS, weakAdminUsernameAllowed: true }}
      />,
    );
    const banner = screen.getByTestId("banner-escape-hatch-prod");
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
    expect(banner.textContent).not.toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    expect(banner.textContent).not.toContain("ALLOW_WEAK_SESSION_SECRET=1");
  });

  it("shows ALLOW_WEAK_SESSION_SECRET=1 when only that flag is active", () => {
    render(
      <EscapeHatchProdBanner
        flags={{ ...BASE_FLAGS, weakSessionSecretAllowed: true }}
      />,
    );
    const banner = screen.getByTestId("banner-escape-hatch-prod");
    expect(banner.textContent).toContain("ALLOW_WEAK_SESSION_SECRET=1");
    expect(banner.textContent).not.toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    expect(banner.textContent).not.toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
  });

  it("banner text contains 'production' to distinguish it from the dev warning", () => {
    render(
      <EscapeHatchProdBanner
        flags={{ ...BASE_FLAGS, weakAdminPasswordAllowed: true }}
      />,
    );
    const banner = screen.getByTestId("banner-escape-hatch-prod");
    expect(banner.textContent).toContain("production");
  });

  // ── (e) does NOT render when flags prop is null ───────────────────────────

  it("does not render when flags prop is null", () => {
    render(<EscapeHatchProdBanner flags={null} />);
    expect(screen.queryByTestId("banner-escape-hatch-prod")).toBeNull();
  });

  // ── (f) banner has no dismiss button ─────────────────────────────────────

  it("does not render a dismiss button", () => {
    render(
      <EscapeHatchProdBanner
        flags={{ ...BASE_FLAGS, weakAdminPasswordAllowed: true }}
      />,
    );
    expect(
      screen.queryByTestId("button-dismiss-escape-hatch-prod-banner"),
    ).toBeNull();
  });

  it("remains visible after sessionStorage is pre-populated with a dismissal key", () => {
    sessionStorage.setItem("ibccf.admin.dismissedEscapeHatchProdWarning", "1");
    render(
      <EscapeHatchProdBanner
        flags={{ ...BASE_FLAGS, weakAdminPasswordAllowed: true }}
      />,
    );
    expect(screen.queryByTestId("banner-escape-hatch-prod")).not.toBeNull();
  });
});
