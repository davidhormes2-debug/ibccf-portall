// Task #545 — Playwright e2e tests for the WeakSessionSecretBanner.
//
// The banner (data-testid="banner-weak-session-secret") renders at the top
// level of the authenticated admin dashboard whenever
// GET /api/admin/security-flags returns { weakSessionSecretAllowed: true }.
// Dismissal is client-side only (sessionStorage key) — no backend endpoint.
//
// Pattern:
//   1. page.route() mocks the security-flags endpoint BEFORE navigation so
//      the mock is in place when AdminDashboard's useEffect fires on mount.
//   2. readAdminToken() + page.addInitScript() seeds the session token without
//      consuming a login-rate-limit slot (follows Task #541 convention).
//   3. page.evaluate() clears the sessionStorage dismissal key between tests.

import { test, expect } from "@playwright/test";
import { loginAdminUi } from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const DISMISS_KEY = "ibccf.admin.dismissedWeakSessionSecretWarning";

test.describe("Admin dashboard — WeakSessionSecretBanner (Task #545)", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests");
    }
  });

  test.beforeEach(async ({ page }) => {
    // Clear any leftover dismissal key from a previous run so the banner
    // is always in its undismissed state at the start of each test.
    await page.addInitScript(() => {
      sessionStorage.removeItem("ibccf.admin.dismissedWeakSessionSecretWarning");
    });
  });

  test("banner appears when security-flags returns weakSessionSecretAllowed: true", async ({
    page,
  }) => {
    // Mock the endpoint BEFORE navigating so the flag is in place when
    // AdminDashboard's useEffect fires on mount.
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: false,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: true,
          isProduction: false,
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-weak-session-secret");
    await expect(banner).toBeVisible({ timeout: 10_000 });
  });

  test("banner is absent when security-flags returns weakSessionSecretAllowed: false", async ({
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
        }),
      });
    });

    await loginAdminUi(page);

    // Allow effects to settle — the banner must never appear.
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("banner-weak-session-secret")).toHaveCount(0);
  });

  test("dismiss button removes the banner from the page", async ({ page }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: false,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: true,
          isProduction: false,
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-weak-session-secret");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("button-dismiss-weak-session-secret-banner").click();

    await expect(banner).toHaveCount(0, { timeout: 3_000 });
  });

  test("dismiss persists to sessionStorage so the banner stays hidden on re-render", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: false,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: true,
          isProduction: false,
        }),
      });
    });

    await loginAdminUi(page);

    await expect(
      page.getByTestId("banner-weak-session-secret"),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("button-dismiss-weak-session-secret-banner").click();
    await expect(
      page.getByTestId("banner-weak-session-secret"),
    ).toHaveCount(0, { timeout: 3_000 });

    const dismissValue = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      DISMISS_KEY,
    );
    expect(dismissValue).toBe("1");
  });
});
