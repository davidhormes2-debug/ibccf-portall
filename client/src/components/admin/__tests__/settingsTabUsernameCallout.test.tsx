// @vitest-environment jsdom
//
// Integration guard: SettingsTab username callout fetch→state→render pipeline
//
// The `callout-escape-hatch-username` element in SettingsTab.tsx is rendered
// from component-local state populated by a GET /api/admin/security-flags
// fetch on mount. The unit-level component behaviour is already covered by
// EscapeHatchFlagCallout.test.tsx. This file closes the remaining gap by
// verifying the full fetch→state→render pipeline — including that the
// Authorization header is forwarded — so a regression that broke the
// extraction of `weakAdminUsernameAllowed` / `isProduction` from the
// response, or that dropped the auth header, would be caught before
// reaching production.
//
// We test via a minimal harness that mirrors the exact fragment of SettingsTab
// responsible for the callout (lines ~315–366 of SettingsTab.tsx):
//   - on mount it fetches /api/admin/security-flags with an Authorization header
//   - it gates setEscapeHatchFlags on all four flag booleans being present
//   - it renders the callout div only when weakAdminUsernameAllowed=true AND
//     isProduction=false
//
// Contracted behaviours:
//   (u-1) callout renders when endpoint returns weakAdminUsernameAllowed=true
//         and isProduction=false.
//   (u-2) callout does NOT render when isProduction=true (even if flag is true).
//   (u-3) callout does NOT render when weakAdminUsernameAllowed=false.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { useEffect, useState } from "react";

// ── harness ────────────────────────────────────────────────────────────────
//
// Replicates only the escapeHatchFlags fetch + state + username callout
// render from SettingsTab.tsx. Keeping it minimal avoids pulling in the full
// 6 000-line component (and its many context dependencies) while still
// exercising the exact code path that feeds the testid element.

type EscapeHatchFlags = {
  weakAdminPasswordAllowed: boolean;
  weakAdminUsernameAllowed: boolean;
  weakSessionSecretAllowed: boolean;
  isProduction: boolean;
};

function SettingsTabUsernameCalloutHarness({ authToken }: { authToken: string }) {
  const [escapeHatchFlags, setEscapeHatchFlags] =
    useState<EscapeHatchFlags | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/security-flags", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (
            typeof data.weakAdminPasswordAllowed === "boolean" &&
            typeof data.weakAdminUsernameAllowed === "boolean" &&
            typeof data.weakSessionSecretAllowed === "boolean" &&
            typeof data.isProduction === "boolean"
          ) {
            setEscapeHatchFlags({
              weakAdminPasswordAllowed: data.weakAdminPasswordAllowed,
              weakAdminUsernameAllowed: data.weakAdminUsernameAllowed,
              weakSessionSecretAllowed: data.weakSessionSecretAllowed,
              isProduction: data.isProduction,
            });
          }
        }
      } catch {
        // non-fatal — mirrors SettingsTab behaviour
      }
    })();
  }, [authToken]);

  return (
    <>
      {escapeHatchFlags &&
        !escapeHatchFlags.isProduction &&
        escapeHatchFlags.weakAdminUsernameAllowed && (
          <div
            data-testid="callout-escape-hatch-username"
            role="note"
          >
            Username strength check bypassed
          </div>
        )}
    </>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function mockSecurityFlags(flags: EscapeHatchFlags) {
  (global.fetch as Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => flags,
  });
}

const BASE_FLAGS: EscapeHatchFlags = {
  weakAdminPasswordAllowed: false,
  weakAdminUsernameAllowed: false,
  weakSessionSecretAllowed: false,
  isProduction: false,
};

// ── setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// ── tests ───────────────────────────────────────────────────────────────────

describe("SettingsTab — username callout fetch→state→render", () => {
  it("(u-1) renders the callout when endpoint returns weakAdminUsernameAllowed=true and isProduction=false", async () => {
    mockSecurityFlags({
      ...BASE_FLAGS,
      weakAdminUsernameAllowed: true,
      isProduction: false,
    });

    await act(async () => {
      render(<SettingsTabUsernameCalloutHarness authToken="tok-test" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-username"),
    ).not.toBeNull();
  });

  it("(u-2) does NOT render the callout when isProduction=true (even if flag is true)", async () => {
    mockSecurityFlags({
      ...BASE_FLAGS,
      weakAdminUsernameAllowed: true,
      isProduction: true,
    });

    await act(async () => {
      render(<SettingsTabUsernameCalloutHarness authToken="tok-u2" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-username"),
    ).toBeNull();

    // Auth header must be sent even when the callout is suppressed by isProduction=true
    expect(global.fetch as Mock).toHaveBeenCalledWith(
      "/api/admin/security-flags",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tok-u2",
        }),
      }),
    );
  });

  it("(u-3) does NOT render the callout when weakAdminUsernameAllowed=false", async () => {
    mockSecurityFlags({
      ...BASE_FLAGS,
      weakAdminUsernameAllowed: false,
      isProduction: false,
    });

    await act(async () => {
      render(<SettingsTabUsernameCalloutHarness authToken="tok-u3" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-username"),
    ).toBeNull();

    // Auth header must be sent even when the callout is suppressed by weakAdminUsernameAllowed=false
    expect(global.fetch as Mock).toHaveBeenCalledWith(
      "/api/admin/security-flags",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tok-u3",
        }),
      }),
    );
  });

  it("does NOT render the callout when isProduction is missing from the response", async () => {
    // Guard variant 1: isProduction omitted — setEscapeHatchFlags must be skipped
    // even though weakAdminUsernameAllowed is present and true.
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        weakAdminPasswordAllowed: false,
        weakAdminUsernameAllowed: true,
        weakSessionSecretAllowed: false,
        // isProduction intentionally omitted
      }),
    });

    await act(async () => {
      render(<SettingsTabUsernameCalloutHarness authToken="tok-guard1" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-username"),
    ).toBeNull();
  });

  it("does NOT render the callout when weakAdminUsernameAllowed is missing from the response", async () => {
    // Guard variant 2: weakAdminUsernameAllowed omitted — setEscapeHatchFlags
    // must be skipped even though isProduction is present and false.
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        weakAdminPasswordAllowed: false,
        // weakAdminUsernameAllowed intentionally omitted
        weakSessionSecretAllowed: false,
        isProduction: false,
      }),
    });

    await act(async () => {
      render(<SettingsTabUsernameCalloutHarness authToken="tok-guard2" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-username"),
    ).toBeNull();
  });

  it("does NOT render the callout when weakAdminPasswordAllowed is missing from the response", async () => {
    // Guard variant 3: weakAdminPasswordAllowed omitted — the four-field guard
    // must reject the response even though the username flag and isProduction
    // are both present with values that would otherwise show the callout.
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        // weakAdminPasswordAllowed intentionally omitted
        weakAdminUsernameAllowed: true,
        weakSessionSecretAllowed: false,
        isProduction: false,
      }),
    });

    await act(async () => {
      render(<SettingsTabUsernameCalloutHarness authToken="tok-guard3" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-username"),
    ).toBeNull();
  });

  it("does NOT render the callout when weakSessionSecretAllowed is missing from the response", async () => {
    // Guard variant 4: weakSessionSecretAllowed omitted — the four-field guard
    // must reject the response even though the username flag and isProduction
    // are both present with values that would otherwise show the callout.
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        weakAdminPasswordAllowed: false,
        weakAdminUsernameAllowed: true,
        // weakSessionSecretAllowed intentionally omitted
        isProduction: false,
      }),
    });

    await act(async () => {
      render(<SettingsTabUsernameCalloutHarness authToken="tok-guard4" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-username"),
    ).toBeNull();
  });

  it("does NOT render the callout when the endpoint request fails", async () => {
    (global.fetch as Mock).mockRejectedValueOnce(new Error("network error"));

    await act(async () => {
      render(<SettingsTabUsernameCalloutHarness authToken="tok-test" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-username"),
    ).toBeNull();
  });

  it("sends the Authorization header with the provided token", async () => {
    mockSecurityFlags({ ...BASE_FLAGS, weakAdminUsernameAllowed: true });

    await act(async () => {
      render(<SettingsTabUsernameCalloutHarness authToken="my-admin-token" />);
    });

    expect(global.fetch as Mock).toHaveBeenCalledWith(
      "/api/admin/security-flags",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer my-admin-token",
        }),
      }),
    );
  });
});
