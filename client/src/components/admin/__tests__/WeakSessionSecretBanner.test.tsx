// @vitest-environment jsdom
//
// Regression guard for the ALLOW_WEAK_SESSION_SECRET security warning banner.
// Mirrors the test contract of WeakAdminPasswordBanner.test.tsx since all
// three banners share the same flag-driven rendering and undismissable pattern.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WeakSessionSecretBanner } from "../WeakSessionSecretBanner";

describe("WeakSessionSecretBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the production variant when the flag is active in production", () => {
    render(
      <WeakSessionSecretBanner
        flags={{ weakSessionSecretAllowed: true, isProduction: true }}
      />,
    );

    const banner = screen.getByTestId("banner-weak-session-secret");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("ALLOW_WEAK_SESSION_SECRET=1");
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
      <WeakSessionSecretBanner
        flags={{ weakSessionSecretAllowed: true, isProduction: false }}
      />,
    );

    const banner = screen.getByTestId("banner-weak-session-secret");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("ALLOW_WEAK_SESSION_SECRET=1");
    expect(banner.textContent).toContain(
      "intended for local development only",
    );
    expect(banner.textContent).not.toContain("in this production deployment");
  });

  it("banner is undismissable — no dismiss button is rendered", () => {
    render(
      <WeakSessionSecretBanner
        flags={{ weakSessionSecretAllowed: true, isProduction: false }}
      />,
    );

    expect(screen.queryByTestId("banner-weak-session-secret")).not.toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-session-secret-banner"),
    ).toBeNull();
  });

  it("banner remains visible on remount within the same session (no dismiss mechanism)", () => {
    const { unmount } = render(
      <WeakSessionSecretBanner
        flags={{ weakSessionSecretAllowed: true, isProduction: false }}
      />,
    );

    expect(screen.queryByTestId("banner-weak-session-secret")).not.toBeNull();

    unmount();

    render(
      <WeakSessionSecretBanner
        flags={{ weakSessionSecretAllowed: true, isProduction: false }}
      />,
    );

    expect(screen.queryByTestId("banner-weak-session-secret")).not.toBeNull();
  });

  it("does not render when the flag is inactive or flags are unavailable", () => {
    const { rerender } = render(<WeakSessionSecretBanner flags={null} />);
    expect(
      screen.queryByTestId("banner-weak-session-secret"),
    ).toBeNull();

    rerender(
      <WeakSessionSecretBanner
        flags={{ weakSessionSecretAllowed: false, isProduction: true }}
      />,
    );
    expect(
      screen.queryByTestId("banner-weak-session-secret"),
    ).toBeNull();
  });
});
