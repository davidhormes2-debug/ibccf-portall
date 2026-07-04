// @vitest-environment jsdom
//
// Regression guard for the ALLOW_WEAK_ADMIN_PASSWORD security warning banner.
//
// The banner is rendered by <WeakAdminPasswordBanner /> based on a `flags`
// prop that mirrors the JSON shape of `GET /api/admin/security-flags`. These
// tests assert the contracted behaviors:
//
//   1. Production variant — banner is visible and copy calls out that the
//      escape hatch is active in a production deployment.
//   2. Non-production variant — banner is visible with the milder
//      "intended for local development only" copy.
//   3. Undismissable — no dismiss button is rendered; the banner stays
//      visible on remount within the same session.
//   4. Inactive / unavailable — banner is hidden when the flag is off or
//      flags are null.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WeakAdminPasswordBanner } from "../WeakAdminPasswordBanner";

describe("WeakAdminPasswordBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the production variant when the flag is active in production", () => {
    render(
      <WeakAdminPasswordBanner
        flags={{ weakAdminPasswordAllowed: true, isProduction: true }}
      />,
    );

    const banner = screen.getByTestId("banner-weak-admin-password");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    expect(banner.textContent).toContain("production");
    expect(banner.textContent).toContain(
      "Remove it from your environment variables.",
    );
    expect(banner.textContent).not.toContain(
      "intended for local development only",
    );
  });

  it("renders the non-production variant with the milder copy", () => {
    render(
      <WeakAdminPasswordBanner
        flags={{ weakAdminPasswordAllowed: true, isProduction: false }}
      />,
    );

    const banner = screen.getByTestId("banner-weak-admin-password");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    expect(banner.textContent).toContain(
      "intended for local development only",
    );
    expect(banner.textContent).not.toContain("in this production deployment");
  });

  it("banner is undismissable — no dismiss button is rendered", () => {
    render(
      <WeakAdminPasswordBanner
        flags={{ weakAdminPasswordAllowed: true, isProduction: false }}
      />,
    );

    expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-admin-password-banner"),
    ).toBeNull();
  });

  it("banner remains visible on remount within the same session (no dismiss mechanism)", () => {
    const { unmount } = render(
      <WeakAdminPasswordBanner
        flags={{ weakAdminPasswordAllowed: true, isProduction: false }}
      />,
    );

    expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();

    unmount();

    render(
      <WeakAdminPasswordBanner
        flags={{ weakAdminPasswordAllowed: true, isProduction: false }}
      />,
    );

    expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
  });

  it("does not render when the flag is inactive or flags are unavailable", () => {
    const { rerender } = render(
      <WeakAdminPasswordBanner flags={null} />,
    );
    expect(
      screen.queryByTestId("banner-weak-admin-password"),
    ).toBeNull();

    rerender(
      <WeakAdminPasswordBanner
        flags={{ weakAdminPasswordAllowed: false, isProduction: true }}
      />,
    );
    expect(
      screen.queryByTestId("banner-weak-admin-password"),
    ).toBeNull();
  });
});
