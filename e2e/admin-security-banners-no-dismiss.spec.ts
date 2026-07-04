// Playwright e2e regression guard: WeakAdminPasswordBanner,
// WeakAdminUsernameBanner, and WeakSessionSecretBanner must NOT expose a
// dismiss button.
//
// These three banners are intentionally undismissable — they represent active
// environment-level security misconfigurations that the operator must fix, not
// snooze.  Unit tests verify the absence of a dismiss button at the component
// level, but this spec guards the real AdminDashboard in a full browser render
// so a future developer cannot silently reintroduce dismiss logic without a
// failing E2E check.
//
// Pattern:
//   1. page.route() mocks GET /api/admin/security-flags BEFORE navigation so
//      all three flags are active when AdminDashboard's useEffect fires.
//   2. readAdminToken() + page.addInitScript() seeds the session token without
//      consuming a login-rate-limit slot (established convention).
//   3. Each test waits for the banner to be visible, then asserts that no
//      dismiss button is present in the DOM.

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

/** All three undismissable flags forced on. */
const ALL_FLAGS_ON = {
  weakAdminPasswordAllowed: true,
  weakAdminUsernameAllowed: true,
  weakSessionSecretAllowed: true,
  isProduction: false,
};

function readAdminToken(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")) as {
      token?: string;
    };
    return raw.token ?? "";
  } catch {
    return "";
  }
}

/**
 * Seed the pre-fetched admin token into sessionStorage so the dashboard
 * authenticates without filling the login form (zero rate-limit slots used).
 * Waits for admin-case-finder-trigger as the "dashboard is fully up" signal.
 */
async function loginAdminUi(page: Page): Promise<void> {
  const token = readAdminToken();
  await page.addInitScript(
    (t: string) => {
      if (t) sessionStorage.setItem("adminToken", t);
    },
    token,
  );
  await page.goto("/admin");
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("Admin dashboard — security banners must not expose a dismiss button", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests",
      );
    }
  });

  test.beforeEach(async ({ page }) => {
    // Mock all three flags as active before any navigation so the mocked
    // response is in place when AdminDashboard's useEffect fires on mount.
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ALL_FLAGS_ON),
      });
    });
  });

  test("WeakAdminPasswordBanner has no dismiss button", async ({ page }) => {
    await loginAdminUi(page);

    await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
      timeout: 10_000,
    });

    await expect(
      page.getByTestId("button-dismiss-weak-admin-password-banner"),
    ).toHaveCount(0);
  });

  test("WeakAdminUsernameBanner has no dismiss button", async ({ page }) => {
    await loginAdminUi(page);

    await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
      timeout: 10_000,
    });

    await expect(
      page.getByTestId("button-dismiss-weak-admin-username-banner"),
    ).toHaveCount(0);
  });

  test("WeakSessionSecretBanner has no dismiss button", async ({ page }) => {
    await loginAdminUi(page);

    await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
      timeout: 10_000,
    });

    await expect(
      page.getByTestId("button-dismiss-weak-session-secret-banner"),
    ).toHaveCount(0);
  });

  test("all three banners are present but none expose a dismiss button simultaneously", async ({
    page,
  }) => {
    await loginAdminUi(page);

    // Confirm all three banners are visible.
    await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
      timeout: 10_000,
    });

    // Assert that no dismiss button exists for any of the three banners.
    await expect(
      page.getByTestId("button-dismiss-weak-admin-password-banner"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("button-dismiss-weak-admin-username-banner"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("button-dismiss-weak-session-secret-banner"),
    ).toHaveCount(0);
  });
});
