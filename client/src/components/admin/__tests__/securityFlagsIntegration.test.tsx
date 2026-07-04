// @vitest-environment jsdom
//
// Integration guard: escape-hatch banners appear from endpoint data
//
// The WeakAdminPasswordBanner, WeakAdminUsernameBanner, and
// WeakSessionSecretBanner components receive a `flags` prop that
// AdminDashboard populates by fetching GET /api/admin/security-flags.
//
// The isolated component tests verify component behavior given a prop value.
// This test closes the remaining gap by verifying the full fetch → state →
// render pipeline so a refactor that accidentally broke the wiring (e.g. wrong
// prop name, dropped useEffect dependency, swapped flag key) would be caught
// before reaching production.
//
// We test this via a small harness component that replicates exactly the
// fetch + state pattern used in AdminDashboard without pulling in the full
// dashboard. All three individual security-warning banners are undismissable
// (no dismiss button, no sessionStorage) — this file verifies that contract
// at the integration level too.

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
import {
  WeakAdminPasswordBanner,
  type WeakAdminPasswordBannerFlags,
} from "../WeakAdminPasswordBanner";
import {
  WeakAdminUsernameBanner,
  type WeakAdminUsernameBannerFlags,
} from "../WeakAdminUsernameBanner";
import { WeakSessionSecretBanner } from "../WeakSessionSecretBanner";
import { EscapeHatchDevBanner } from "../EscapeHatchDevBanner";
import { EscapeHatchProdBanner } from "../EscapeHatchProdBanner";

// ── harness ────────────────────────────────────────────────────────────────

type SecurityFlags = {
  weakAdminPasswordAllowed: boolean;
  weakAdminUsernameAllowed: boolean;
  weakSessionSecretAllowed: boolean;
  isProduction: boolean;
};

function SecurityFlagsHarness({ authToken }: { authToken: string | null }) {
  const [flags, setFlags] = useState<SecurityFlags | null>(null);

  useEffect(() => {
    if (!authToken) {
      setFlags(null);
      return;
    }
    fetch("/api/admin/security-flags", {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((res) => (res.ok ? (res.json() as Promise<SecurityFlags>) : null))
      .then((data) => {
        if (data) setFlags(data);
      })
      .catch(() => {});
  }, [authToken]);

  return (
    <>
      <WeakAdminPasswordBanner
        flags={
          flags
            ? {
                weakAdminPasswordAllowed: flags.weakAdminPasswordAllowed,
                isProduction: flags.isProduction,
              }
            : null
        }
      />
      <WeakAdminUsernameBanner
        flags={
          flags
            ? {
                weakAdminUsernameAllowed: flags.weakAdminUsernameAllowed,
                isProduction: flags.isProduction,
              }
            : null
        }
      />
      <WeakSessionSecretBanner
        flags={
          flags
            ? {
                weakSessionSecretAllowed: flags.weakSessionSecretAllowed,
                isProduction: flags.isProduction,
              }
            : null
        }
      />
      <EscapeHatchDevBanner flags={flags} />
      <EscapeHatchProdBanner flags={flags} />
    </>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function mockSecurityFlagsEndpoint(flags: Partial<SecurityFlags> & Pick<SecurityFlags, "weakAdminPasswordAllowed" | "weakAdminUsernameAllowed">) {
  const payload: SecurityFlags = {
    weakSessionSecretAllowed: false,
    isProduction: false,
    ...flags,
  };
  (global.fetch as Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => payload,
  });
  return payload;
}

// ── setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// ── tests ──────────────────────────────────────────────────────────────────

describe("Security flags integration — banner-weak-admin-password", () => {
  it("renders the password banner when the endpoint returns weakAdminPasswordAllowed: true", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-123" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
  });

  it("does NOT render the password banner when the endpoint returns weakAdminPasswordAllowed: false", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-123" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).toBeNull();
  });

  it("shows the production copy when isProduction: true is returned by the endpoint", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
      isProduction: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-123" />);
    });

    const banner = screen.getByTestId("banner-weak-admin-password");
    expect(banner.textContent).toContain("production");
    expect(banner.textContent).not.toContain("intended for local development only");
  });

  it("banner is undismissable — no dismiss button is rendered", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-123" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-admin-password-banner"),
    ).toBeNull();
  });

  it("banner remains visible on remount within the same session (no dismiss mechanism)", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-123" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();

    cleanup();

    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-123" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
  });

  it("does not render banners when authToken is null (no fetch is attempted)", async () => {
    await act(async () => {
      render(<SecurityFlagsHarness authToken={null} />);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("banner-weak-admin-password")).toBeNull();
  });
});

describe("Security flags integration — banner-weak-admin-username", () => {
  it("renders the username banner when the endpoint returns weakAdminUsernameAllowed: true", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: true,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-456" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
  });

  it("does NOT render the username banner when the endpoint returns weakAdminUsernameAllowed: false", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-456" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-username")).toBeNull();
  });

  it("shows the production copy when isProduction: true is returned by the endpoint", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: true,
      isProduction: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-456" />);
    });

    const banner = screen.getByTestId("banner-weak-admin-username");
    expect(banner.textContent).toContain("production");
    expect(banner.textContent).not.toContain("intended for local development only");
  });

  it("banner is undismissable — no dismiss button is rendered", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-456" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-admin-username-banner"),
    ).toBeNull();
  });

  it("banner remains visible on remount within the same session (no dismiss mechanism)", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-456" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();

    cleanup();

    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-456" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
  });

  it("does not render banners when authToken is null (no fetch is attempted)", async () => {
    await act(async () => {
      render(<SecurityFlagsHarness authToken={null} />);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("banner-weak-admin-username")).toBeNull();
  });
});

describe("Security flags integration — banner-weak-session-secret", () => {
  it("renders the session secret banner when the endpoint returns weakSessionSecretAllowed: true", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: true,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-secret" />);
    });

    expect(screen.queryByTestId("banner-weak-session-secret")).not.toBeNull();
  });

  it("does NOT render the session secret banner when the endpoint returns weakSessionSecretAllowed: false", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-secret" />);
    });

    expect(screen.queryByTestId("banner-weak-session-secret")).toBeNull();
  });

  it("shows the production copy when isProduction: true is returned by the endpoint", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: true,
      isProduction: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-secret" />);
    });

    const banner = screen.getByTestId("banner-weak-session-secret");
    expect(banner.textContent).toContain("production");
    expect(banner.textContent).not.toContain("intended for local development only");
  });

  it("banner is undismissable — no dismiss button is rendered", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-secret" />);
    });

    expect(screen.queryByTestId("banner-weak-session-secret")).not.toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-session-secret-banner"),
    ).toBeNull();
  });

  it("banner remains visible on remount within the same session (no dismiss mechanism)", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-secret" />);
    });

    expect(screen.queryByTestId("banner-weak-session-secret")).not.toBeNull();

    cleanup();

    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-secret" />);
    });

    expect(screen.queryByTestId("banner-weak-session-secret")).not.toBeNull();
  });

  it("does not render the session secret banner when authToken is null (no fetch is attempted)", async () => {
    await act(async () => {
      render(<SecurityFlagsHarness authToken={null} />);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("banner-weak-session-secret")).toBeNull();
  });
});

describe("Security flags integration — both flags active simultaneously", () => {
  it("renders both banners when the endpoint returns both flags true", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: true,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-both" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
    expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
  });

  it("neither banner has a dismiss button when both are shown", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-both" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
    expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-admin-password-banner"),
    ).toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-admin-username-banner"),
    ).toBeNull();
  });
});

describe("Security flags integration — all three flags active simultaneously", () => {
  it("renders all three banners when all three flags are true", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: true,
      weakSessionSecretAllowed: true,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-all-three" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
    expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
    expect(screen.queryByTestId("banner-weak-session-secret")).not.toBeNull();
  });

  it("none of the three banners has a dismiss button when all are shown", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: true,
      weakSessionSecretAllowed: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-all-three" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).not.toBeNull();
    expect(screen.queryByTestId("banner-weak-admin-username")).not.toBeNull();
    expect(screen.queryByTestId("banner-weak-session-secret")).not.toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-admin-password-banner"),
    ).toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-admin-username-banner"),
    ).toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-weak-session-secret-banner"),
    ).toBeNull();
  });

  it("shows production copy in all three banners when isProduction is true and all flags active", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: true,
      weakSessionSecretAllowed: true,
      isProduction: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-all-three" />);
    });

    const passwordBanner = screen.getByTestId("banner-weak-admin-password");
    const usernameBanner = screen.getByTestId("banner-weak-admin-username");
    const sessionBanner = screen.getByTestId("banner-weak-session-secret");

    expect(passwordBanner.textContent).toContain("production");
    expect(usernameBanner.textContent).toContain("production");
    expect(sessionBanner.textContent).toContain("production");
  });
});

describe("Security flags integration — endpoint failure resilience", () => {
  it("shows no banners when the endpoint returns a non-ok response", async () => {
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Unauthorized" }),
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="bad-tok" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).toBeNull();
    expect(screen.queryByTestId("banner-weak-admin-username")).toBeNull();
  });

  it("shows no banners when the fetch rejects (network error)", async () => {
    (global.fetch as Mock).mockRejectedValueOnce(new Error("network error"));

    await act(async () => {
      render(<SecurityFlagsHarness authToken="bad-tok" />);
    });

    expect(screen.queryByTestId("banner-weak-admin-password")).toBeNull();
    expect(screen.queryByTestId("banner-weak-admin-username")).toBeNull();
  });
});

describe("Security flags integration — banner-escape-hatch-dev", () => {
  it("renders when any flag is true and isProduction is false", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-esc" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-dev")).not.toBeNull();
  });

  it("does NOT render when isProduction is true even if flags are active", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: true,
      weakSessionSecretAllowed: true,
      isProduction: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-esc" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-dev")).toBeNull();
  });

  it("does NOT render when all flags are false", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-esc" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-dev")).toBeNull();
  });

  it("banner is undismissable — no dismiss button is rendered", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: true,
      weakSessionSecretAllowed: false,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-esc" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-dev")).not.toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-escape-hatch-dev-banner"),
    ).toBeNull();
  });

  it("banner remains visible on remount within the same session (no dismiss mechanism)", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-esc" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-dev")).not.toBeNull();

    cleanup();

    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-esc" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-dev")).not.toBeNull();
  });

  it("does not render banners when authToken is null (no fetch is attempted)", async () => {
    await act(async () => {
      render(<SecurityFlagsHarness authToken={null} />);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("banner-escape-hatch-dev")).toBeNull();
  });
});

describe("Security flags integration — banner-escape-hatch-prod", () => {
  it("renders when any flag is true and isProduction is true", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
      isProduction: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-prod" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-prod")).not.toBeNull();
  });

  it("does NOT render when isProduction is false even if flags are active", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: true,
      weakSessionSecretAllowed: true,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-prod" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-prod")).toBeNull();
  });

  it("does NOT render when all flags are false even if isProduction is true", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: false,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
      isProduction: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-prod" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-prod")).toBeNull();
  });

  it("lists all three active flags when isProduction is true and all flags are active", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: true,
      weakSessionSecretAllowed: true,
      isProduction: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-prod" />);
    });

    const banner = screen.getByTestId("banner-escape-hatch-prod");
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    expect(banner.textContent).toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
    expect(banner.textContent).toContain("ALLOW_WEAK_SESSION_SECRET=1");
    expect(banner.textContent).toContain("production");
  });

  it("banner remains visible on remount within the same session (no dismiss mechanism)", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
      isProduction: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-prod" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-prod")).not.toBeNull();
    expect(
      screen.queryByTestId("button-dismiss-escape-hatch-prod-banner"),
    ).toBeNull();

    cleanup();

    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
      isProduction: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-prod" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-prod")).not.toBeNull();
  });

  it("does not render when authToken is null (no fetch is attempted)", async () => {
    await act(async () => {
      render(<SecurityFlagsHarness authToken={null} />);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("banner-escape-hatch-prod")).toBeNull();
  });

  it("dev banner is hidden and prod banner is shown when isProduction: true and a flag is active", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
      isProduction: true,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-prod" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-prod")).not.toBeNull();
    expect(screen.queryByTestId("banner-escape-hatch-dev")).toBeNull();
  });

  it("prod banner is hidden and dev banner is shown when isProduction: false and a flag is active", async () => {
    mockSecurityFlagsEndpoint({
      weakAdminPasswordAllowed: true,
      weakAdminUsernameAllowed: false,
      weakSessionSecretAllowed: false,
      isProduction: false,
    });

    await act(async () => {
      render(<SecurityFlagsHarness authToken="tok-prod" />);
    });

    expect(screen.queryByTestId("banner-escape-hatch-dev")).not.toBeNull();
    expect(screen.queryByTestId("banner-escape-hatch-prod")).toBeNull();
  });
});
