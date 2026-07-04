// @vitest-environment jsdom
//
// Unit tests for the EscapeHatchFlagCallout component used inline in the
// Settings tab credential cards. This satisfies requirement (c) from the
// task spec: "each inline Settings badge appears when its flag is true".
//
// Contracted behaviours:
//   (c-1) Password callout renders when active=true and isProduction=false.
//   (c-2) Username callout renders when active=true and isProduction=false.
//   (c-3) Session-secret callout renders when active=true and isProduction=false.
//   (c-4) No callout renders when active=false (flag not set).
//   (c-5) No callout renders when isProduction=true (production-critical
//         banners handle that case; the inline callout is for dev/staging only).
//   (c-6) The ENV var name appears in the callout text so the operator knows
//         exactly which flag to remove.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EscapeHatchFlagCallout } from "../EscapeHatchFlagCallout";

afterEach(() => {
  cleanup();
});

describe("EscapeHatchFlagCallout — password", () => {
  it("(c-1) renders when password flag is active and not production", () => {
    render(
      <EscapeHatchFlagCallout flag="password" active={true} isProduction={false} />,
    );
    expect(screen.queryByTestId("callout-escape-hatch-password")).not.toBeNull();
  });

  it("(c-4) does not render when flag is inactive", () => {
    render(
      <EscapeHatchFlagCallout flag="password" active={false} isProduction={false} />,
    );
    expect(screen.queryByTestId("callout-escape-hatch-password")).toBeNull();
  });

  it("(c-5) does not render when isProduction=true", () => {
    render(
      <EscapeHatchFlagCallout flag="password" active={true} isProduction={true} />,
    );
    expect(screen.queryByTestId("callout-escape-hatch-password")).toBeNull();
  });

  it("(c-6) includes the env var name in the callout text", () => {
    render(
      <EscapeHatchFlagCallout flag="password" active={true} isProduction={false} />,
    );
    const callout = screen.getByTestId("callout-escape-hatch-password");
    expect(callout.textContent).toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
  });
});

describe("EscapeHatchFlagCallout — username", () => {
  it("(c-2) renders when username flag is active and not production", () => {
    render(
      <EscapeHatchFlagCallout flag="username" active={true} isProduction={false} />,
    );
    expect(screen.queryByTestId("callout-escape-hatch-username")).not.toBeNull();
  });

  it("(c-4) does not render when flag is inactive", () => {
    render(
      <EscapeHatchFlagCallout flag="username" active={false} isProduction={false} />,
    );
    expect(screen.queryByTestId("callout-escape-hatch-username")).toBeNull();
  });

  it("(c-5) does not render when isProduction=true", () => {
    render(
      <EscapeHatchFlagCallout flag="username" active={true} isProduction={true} />,
    );
    expect(screen.queryByTestId("callout-escape-hatch-username")).toBeNull();
  });

  it("(c-6) includes the env var name in the callout text", () => {
    render(
      <EscapeHatchFlagCallout flag="username" active={true} isProduction={false} />,
    );
    const callout = screen.getByTestId("callout-escape-hatch-username");
    expect(callout.textContent).toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
  });
});

describe("EscapeHatchFlagCallout — sessionSecret", () => {
  it("(c-3) renders when sessionSecret flag is active and not production", () => {
    render(
      <EscapeHatchFlagCallout flag="sessionSecret" active={true} isProduction={false} />,
    );
    expect(screen.queryByTestId("callout-escape-hatch-session-secret")).not.toBeNull();
  });

  it("(c-4) does not render when flag is inactive", () => {
    render(
      <EscapeHatchFlagCallout flag="sessionSecret" active={false} isProduction={false} />,
    );
    expect(screen.queryByTestId("callout-escape-hatch-session-secret")).toBeNull();
  });

  it("(c-5) does not render when isProduction=true", () => {
    render(
      <EscapeHatchFlagCallout flag="sessionSecret" active={true} isProduction={true} />,
    );
    expect(screen.queryByTestId("callout-escape-hatch-session-secret")).toBeNull();
  });

  it("(c-6) includes the env var name in the callout text", () => {
    render(
      <EscapeHatchFlagCallout flag="sessionSecret" active={true} isProduction={false} />,
    );
    const callout = screen.getByTestId("callout-escape-hatch-session-secret");
    expect(callout.textContent).toContain("ALLOW_WEAK_SESSION_SECRET=1");
  });
});
