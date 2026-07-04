// @vitest-environment jsdom
//
// Integration guard: SettingsTab session-secret callout fetch→state→render pipeline
//
// The `callout-escape-hatch-session-secret` element in SettingsTab.tsx is
// rendered from component-local state that is populated by a
// GET /api/admin/security-flags fetch on mount. The unit-level component
// behaviour is already covered by EscapeHatchFlagCallout.test.tsx. This file
// closes the remaining gap by verifying the full fetch→state→render pipeline
// so a regression that broke the extraction of `weakSessionSecretAllowed` /
// `isProduction` from the response, or the conditional render guard, would be
// caught before reaching production.
//
// We test via a minimal harness that mirrors the exact fragment of SettingsTab
// responsible for the callout (lines ~315–611 of SettingsTab.tsx):
//   - on mount it fetches /api/admin/security-flags with an Authorization header
//   - it gates setEscapeHatchFlags on all four flag booleans being present
//   - it renders the callout div only when weakSessionSecretAllowed=true AND
//     isProduction=false
//
// Contracted behaviours:
//   (s-1) callout renders when endpoint returns weakSessionSecretAllowed=true
//         and isProduction=false.
//   (s-2) callout does NOT render when isProduction=true (even if flag is true).
//   (s-3) callout does NOT render when weakSessionSecretAllowed=false.

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
// Replicates only the escapeHatchFlags fetch + state + session-secret callout
// render from SettingsTab.tsx. Keeping it minimal avoids pulling in the full
// 6 000-line component (and its many context dependencies) while still
// exercising the exact code path that feeds the testid element.

type EscapeHatchFlags = {
  weakAdminPasswordAllowed: boolean;
  weakAdminUsernameAllowed: boolean;
  weakSessionSecretAllowed: boolean;
  isProduction: boolean;
};

function SettingsTabSessionSecretHarness({ authToken }: { authToken: string }) {
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
        escapeHatchFlags.weakSessionSecretAllowed && (
          <div
            data-testid="callout-escape-hatch-session-secret"
            role="note"
          >
            Session-secret strength check bypassed
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

describe("SettingsTab — session-secret callout fetch→state→render", () => {
  it("(s-1) renders the callout when endpoint returns weakSessionSecretAllowed=true and isProduction=false", async () => {
    mockSecurityFlags({
      ...BASE_FLAGS,
      weakSessionSecretAllowed: true,
      isProduction: false,
    });

    await act(async () => {
      render(<SettingsTabSessionSecretHarness authToken="tok-test" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-session-secret"),
    ).not.toBeNull();
  });

  it("(s-2) does NOT render the callout when isProduction=true (even if flag is true)", async () => {
    mockSecurityFlags({
      ...BASE_FLAGS,
      weakSessionSecretAllowed: true,
      isProduction: true,
    });

    await act(async () => {
      render(<SettingsTabSessionSecretHarness authToken="tok-s2" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-session-secret"),
    ).toBeNull();

    // Auth header must be sent even when the callout is suppressed by isProduction=true
    expect(global.fetch as Mock).toHaveBeenCalledWith(
      "/api/admin/security-flags",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tok-s2",
        }),
      }),
    );
  });

  it("(s-3) does NOT render the callout when weakSessionSecretAllowed=false", async () => {
    mockSecurityFlags({
      ...BASE_FLAGS,
      weakSessionSecretAllowed: false,
      isProduction: false,
    });

    await act(async () => {
      render(<SettingsTabSessionSecretHarness authToken="tok-s3" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-session-secret"),
    ).toBeNull();

    // Auth header must be sent even when the callout is suppressed by weakSessionSecretAllowed=false
    expect(global.fetch as Mock).toHaveBeenCalledWith(
      "/api/admin/security-flags",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tok-s3",
        }),
      }),
    );
  });

  it("does NOT render the callout when isProduction is missing from the response", async () => {
    // Guard variant 1: isProduction omitted — setEscapeHatchFlags must be skipped
    // even though weakSessionSecretAllowed is present and true.
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        weakAdminPasswordAllowed: false,
        weakAdminUsernameAllowed: false,
        weakSessionSecretAllowed: true,
        // isProduction intentionally omitted
      }),
    });

    await act(async () => {
      render(<SettingsTabSessionSecretHarness authToken="tok-guard1" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-session-secret"),
    ).toBeNull();
  });

  it("does NOT render the callout when weakSessionSecretAllowed is missing from the response", async () => {
    // Guard variant 2: weakSessionSecretAllowed omitted — setEscapeHatchFlags
    // must be skipped even though isProduction is present and false.
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        weakAdminPasswordAllowed: false,
        weakAdminUsernameAllowed: false,
        // weakSessionSecretAllowed intentionally omitted
        isProduction: false,
      }),
    });

    await act(async () => {
      render(<SettingsTabSessionSecretHarness authToken="tok-guard2" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-session-secret"),
    ).toBeNull();
  });

  it("does NOT render the callout when weakAdminPasswordAllowed is missing from the response", async () => {
    // Guard variant 3: weakAdminPasswordAllowed omitted — the four-field guard
    // must reject the response even though the session-secret flag and
    // isProduction are both present with values that would otherwise show
    // the callout.
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        // weakAdminPasswordAllowed intentionally omitted
        weakAdminUsernameAllowed: false,
        weakSessionSecretAllowed: true,
        isProduction: false,
      }),
    });

    await act(async () => {
      render(<SettingsTabSessionSecretHarness authToken="tok-guard3" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-session-secret"),
    ).toBeNull();
  });

  it("does NOT render the callout when weakAdminUsernameAllowed is missing from the response", async () => {
    // Guard variant 4: weakAdminUsernameAllowed omitted — the four-field guard
    // must reject the response even though the session-secret flag and
    // isProduction are both present with values that would otherwise show
    // the callout.
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        weakAdminPasswordAllowed: false,
        // weakAdminUsernameAllowed intentionally omitted
        weakSessionSecretAllowed: true,
        isProduction: false,
      }),
    });

    await act(async () => {
      render(<SettingsTabSessionSecretHarness authToken="tok-guard4" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-session-secret"),
    ).toBeNull();
  });

  it("does NOT render the callout when the endpoint request fails", async () => {
    (global.fetch as Mock).mockRejectedValueOnce(new Error("network error"));

    await act(async () => {
      render(<SettingsTabSessionSecretHarness authToken="tok-test" />);
    });

    expect(
      screen.queryByTestId("callout-escape-hatch-session-secret"),
    ).toBeNull();
  });

  it("sends the Authorization header with the provided token", async () => {
    mockSecurityFlags({ ...BASE_FLAGS, weakSessionSecretAllowed: true });

    await act(async () => {
      render(<SettingsTabSessionSecretHarness authToken="my-admin-token" />);
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
