// @vitest-environment jsdom
//
// Regression guard for the weak-password security banner.
//
// The banner is rendered by <WeakPasswordBanner /> based on a `flags` prop
// that mirrors the JSON shape of `GET /api/admin/security-flags`. These tests
// assert the core contracted behaviours:
//
//   1. Banner is visible when weakPassword is true.
//   2. Banner is hidden when weakPassword is false or flags are null.
//   3. Dismissal removes the banner and persists the flag to sessionStorage.
//   4. Starts dismissed if sessionStorage already records a prior dismissal.
//   5. Clicking the CTA link calls onGoToSettings when provided.
//   6. Clearing the sessionStorage dismissed key re-arms the banner.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  WeakPasswordBanner,
  WEAK_PASSWORD_DISMISSED_KEY,
} from "../WeakPasswordBanner";

describe("WeakPasswordBanner", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it("renders the banner when weakPassword is true", () => {
    render(<WeakPasswordBanner flags={{ weakPassword: true }} />);

    const banner = screen.getByTestId("banner-weak-password");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("Weak");
    expect(banner.textContent).toContain("Settings");
    expect(banner.textContent).toContain("Change Password");
  });

  it("renders a security warning label", () => {
    render(<WeakPasswordBanner flags={{ weakPassword: true }} />);

    const banner = screen.getByTestId("banner-weak-password");
    expect(banner.textContent).toContain("Security warning");
  });

  it("mentions keyboard sequence or common pattern in the banner copy", () => {
    render(<WeakPasswordBanner flags={{ weakPassword: true }} />);

    const banner = screen.getByTestId("banner-weak-password");
    expect(banner.textContent).toContain("keyboard sequence");
  });

  it("hides the banner when weakPassword is false", () => {
    render(<WeakPasswordBanner flags={{ weakPassword: false }} />);

    expect(screen.queryByTestId("banner-weak-password")).toBeNull();
  });

  it("does not render when flags is null", () => {
    render(<WeakPasswordBanner flags={null} />);

    expect(screen.queryByTestId("banner-weak-password")).toBeNull();
  });

  it("hides the banner after the dismiss button is clicked", () => {
    render(<WeakPasswordBanner flags={{ weakPassword: true }} />);

    expect(screen.queryByTestId("banner-weak-password")).not.toBeNull();

    fireEvent.click(
      screen.getByTestId("button-dismiss-weak-password-banner"),
    );

    expect(screen.queryByTestId("banner-weak-password")).toBeNull();
    expect(sessionStorage.getItem(WEAK_PASSWORD_DISMISSED_KEY)).toBe("1");
  });

  it("starts dismissed if sessionStorage already records a prior dismissal", () => {
    sessionStorage.setItem(WEAK_PASSWORD_DISMISSED_KEY, "1");

    render(<WeakPasswordBanner flags={{ weakPassword: true }} />);

    expect(screen.queryByTestId("banner-weak-password")).toBeNull();
  });

  it("calls onGoToSettings when the CTA link is clicked", () => {
    const onGoToSettings = vi.fn();
    render(
      <WeakPasswordBanner
        flags={{ weakPassword: true }}
        onGoToSettings={onGoToSettings}
      />,
    );

    const ctaLink = screen.getByTestId("link-go-to-change-password");
    expect(ctaLink).toBeTruthy();
    fireEvent.click(ctaLink);
    expect(onGoToSettings).toHaveBeenCalledTimes(1);
  });

  it("renders a non-interactive span when onGoToSettings is not provided", () => {
    render(<WeakPasswordBanner flags={{ weakPassword: true }} />);

    expect(screen.queryByTestId("link-go-to-change-password")).toBeNull();
    const banner = screen.getByTestId("banner-weak-password");
    expect(banner.textContent).toContain("Go to Settings");
  });

  it("re-arms the banner when the sessionStorage dismissed key is cleared", () => {
    sessionStorage.setItem(WEAK_PASSWORD_DISMISSED_KEY, "1");

    render(<WeakPasswordBanner flags={{ weakPassword: true }} />);
    expect(screen.queryByTestId("banner-weak-password")).toBeNull();

    cleanup();
    sessionStorage.removeItem(WEAK_PASSWORD_DISMISSED_KEY);

    render(<WeakPasswordBanner flags={{ weakPassword: true }} />);
    expect(screen.getByTestId("banner-weak-password")).toBeTruthy();
  });
});
