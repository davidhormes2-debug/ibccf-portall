// Playwright e2e tests for the WeakPasswordBanner.
//
// The banner (data-testid="banner-weak-password") renders at the top of the
// authenticated admin dashboard whenever GET /api/admin/security-flags returns
// { weakPassword: true }.  Dismissal is client-side only (sessionStorage key)
// — no backend endpoint.
//
// Pattern:
//   1. page.route() mocks the security-flags endpoint BEFORE navigation so the
//      mock is in place when AdminDashboard's useEffect fires on mount.
//   2. readAdminToken() + page.addInitScript() seeds the session token without
//      consuming a login-rate-limit slot (follows the established convention).
//   3. page.addInitScript() clears the sessionStorage dismissal key in
//      beforeEach so the banner is always in its undismissed state.

import { test, expect } from "@playwright/test";
import { localTimeout } from "./helpers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const STRONG_PASSWORD = "Str0ng!Pass#2024";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

const DISMISS_KEY = "ibccf.admin.dismissedWeakPasswordWarning";

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
async function loginAdminUi(page: import("@playwright/test").Page) {
  const token = readAdminToken();
  await page.addInitScript(
    (t) => {
      if (t) sessionStorage.setItem("adminToken", t);
    },
    token,
  );
  await page.goto("/admin");
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 90_000,
  });
}

test.describe("Admin dashboard — WeakPasswordBanner", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests");
    }
  });

  // loginAdminUi waits up to 90 s for the admin-case-finder-trigger (cold Vite
  // compile on the first run without global-setup warm-up).  Give each test
  // 120 s total so the assertions still run after the dashboard loads.
  test.setTimeout(localTimeout(120_000));

  test.beforeEach(async ({ page }) => {
    // Clear any leftover dismissal key from a previous run so the banner
    // is always in its undismissed state at the start of each test.
    await page.addInitScript(() => {
      sessionStorage.removeItem("ibccf.admin.dismissedWeakPasswordWarning");
    });
  });

  test("banner appears when security-flags returns weakPassword: true", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: false,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: false,
          isProduction: false,
          weakPassword: true,
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-weak-password");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Security warning:", { timeout: 5_000 });
    await expect(banner).toContainText("Weak", { timeout: 5_000 });
    await expect(banner).toContainText("Change Password", { timeout: 5_000 });
  });

  test("banner is absent when security-flags returns weakPassword: false", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: false,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: false,
          isProduction: false,
          weakPassword: false,
        }),
      });
    });

    await loginAdminUi(page);

    // Allow effects to settle — the banner must never appear.
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("banner-weak-password")).toHaveCount(0);
  });

  test("dismiss button removes the banner from the page", async ({ page }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: false,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: false,
          isProduction: false,
          weakPassword: true,
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-weak-password");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("button-dismiss-weak-password-banner").click();

    await expect(banner).toHaveCount(0, { timeout: 3_000 });
  });

  test("dismiss persists to sessionStorage so the banner stays hidden after dismissal", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: false,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: false,
          isProduction: false,
          weakPassword: true,
        }),
      });
    });

    await loginAdminUi(page);

    await expect(page.getByTestId("banner-weak-password")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("button-dismiss-weak-password-banner").click();
    await expect(page.getByTestId("banner-weak-password")).toHaveCount(0, {
      timeout: 3_000,
    });

    const dismissValue = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      DISMISS_KEY,
    );
    expect(dismissValue).toBe("1");
  });

  test("banner reappears in a fresh session after dismissal without changing the password", async ({
    page,
  }) => {
    // The password was never changed so the server always reports weakPassword: true.
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: false,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: false,
          isProduction: false,
          weakPassword: true,
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-weak-password");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // Dismiss the banner — it vanishes for the rest of this session.
    await page.getByTestId("button-dismiss-weak-password-banner").click();
    await expect(banner).toHaveCount(0, { timeout: 3_000 });

    // Simulate a new browser session: clear sessionStorage so the dismissal
    // key is gone, then reload.  The mock still returns weakPassword: true
    // so the banner must re-arm and appear again.
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();

    await expect(
      page.getByTestId("banner-weak-password"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("banner does not reappear after a successful password change to a strong value", async ({
    page,
  }) => {
    // Track whether the password has been changed so the mock can switch
    // from weakPassword: true → false after the successful change.
    let passwordChanged = false;

    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: false,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: false,
          isProduction: false,
          weakPassword: !passwordChanged,
        }),
      });
    });

    await page.route("**/api/admin/change-password", (route) => {
      passwordChanged = true;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await loginAdminUi(page);

    // Banner is visible while the password is still weak.
    await expect(
      page.getByTestId("banner-weak-password"),
    ).toBeVisible({ timeout: 10_000 });

    // Navigate to Settings → Change Password and submit a strong password.
    await page.getByTestId("tab-settings").click({ force: true });
    await page.getByTestId("card-change-password").click();
    await expect(page.getByTestId("input-cp-new")).toBeVisible({
      timeout: 5_000,
    });

    await page.getByTestId("input-cp-current").fill(ADMIN_PASSWORD);
    await page.getByTestId("input-cp-new").fill(STRONG_PASSWORD);
    await page.getByTestId("input-cp-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("button-cp-submit").click();

    // Wait for the form to close (change succeeded).
    await expect(page.getByTestId("input-cp-new")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Simulate a fresh session: clear sessionStorage (the password-change flow
    // already removed the dismissal key, but clear everything for certainty)
    // then reload.  The mock now returns weakPassword: false so the banner
    // must stay hidden.
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();

    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("banner-weak-password")).toHaveCount(0);
  });
});
