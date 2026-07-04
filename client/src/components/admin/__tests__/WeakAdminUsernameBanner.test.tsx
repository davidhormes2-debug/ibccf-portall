// @vitest-environment jsdom
//
// Regression guard for the ALLOW_WEAK_ADMIN_USERNAME security warning banner.
// Mirrors the test contract of WeakAdminPasswordBanner.test.tsx since both
// banners share the same flag-driven rendering and undismissable pattern.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WeakAdminUsernameBanner } from "../WeakAdminUsernameBanner";

describe("WeakAdminUsernameBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the production variant when the flag is active in production", () => {
    render(
      <WeakAdminUsernameBanner
        flags={{ weakAdminUsernameAllowed: true, isProduction: true }}
      />,
    );

    const banner = screen.getByTestId("banner-weak-admin-username");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
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
      <WeakAdminUsernameBanner
        flags={{ weakAdminUsernameAllowed: true, isProduction: false }}
      />,
    );

    const banner = screen.getByTestId("banner-weak-admin-username");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
    expect(banner.textContent).toContain(
      "intended for local development only",
    );
    expect(banner.textContent).not.toContain("in this production deployment");
  });

  it("banner is undismissable — no dismiss button is rendered", () => {
    render(
      <WeakAdminUsernameBanner
        flags={{ weakAdminUsernameAllowed: true, isProduction: false }}
      />,
    );

    expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-admin-username-banner"),
    ).toBeNull();
  });

  it("banner remains visible on remount within the same session (no dismiss mechanism)", () => {
    const { unmount } = render(
      <WeakAdminUsernameBanner
        flags={{ weakAdminUsernameAllowed: true, isProduction: false }}
      />,
    );

    expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();

    unmount();

    render(
      <WeakAdminUsernameBanner
        flags={{ weakAdminUsernameAllowed: true, isProduction: false }}
      />,
    );

    expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
  });

  it("does not render when the flag is inactive or flags are unavailable", () => {
    const { rerender } = render(<WeakAdminUsernameBanner flags={null} />);
    expect(
      screen.queryByTestId("banner-weak-admin-username"),
    ).toBeNull();

    rerender(
      <WeakAdminUsernameBanner
        flags={{ weakAdminUsernameAllowed: false, isProduction: true }}
      />,
    );
    expect(
      screen.queryByTestId("banner-weak-admin-username"),
    ).toBeNull();
  });
});
