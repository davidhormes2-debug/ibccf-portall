// Playwright e2e tests for the EscapeHatchDevBanner.
//
// The banner (data-testid="banner-escape-hatch-dev") renders at the top
// level of the authenticated admin dashboard whenever
// GET /api/admin/security-flags returns a non-production environment
// (isProduction: false) with at least one escape-hatch flag active.
// Dismissal is client-side only (sessionStorage key) — no backend endpoint.
//
// Pattern:
//   1. page.route() mocks the security-flags endpoint BEFORE navigation so
//      the mock is in place when AdminDashboard's useEffect fires on mount.
//   2. readAdminToken() + page.addInitScript() seeds the session token without
//      consuming a login-rate-limit slot (follows established convention).
//   3. page.addInitScript() clears the sessionStorage dismissal key before
//      each test so the banner is always in its undismissed state.

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

const DISMISS_KEY = "ibccf.admin.dismissedEscapeHatchDevWarning";

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
    timeout: 30_000,
  });
}

test.describe("Admin dashboard — EscapeHatchDevBanner", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests");
    }
  });

  test.beforeEach(async ({ page }) => {
    // Clear any leftover dismissal key from a previous run so the banner
    // is always in its undismissed state at the start of each test.
    await page.addInitScript((key: string) => {
      sessionStorage.removeItem(key);
    }, DISMISS_KEY);
  });

  test("banner appears when security-flags returns a non-production active escape-hatch flag", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: true,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: false,
          isProduction: false,
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-escape-hatch-dev");
    await expect(banner).toBeVisible({ timeout: 10_000 });
  });

  test("banner is absent when isProduction is true even if flags are active", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: true,
          weakAdminUsernameAllowed: true,
          weakSessionSecretAllowed: true,
          isProduction: true,
        }),
      });
    });

    await loginAdminUi(page);

    // Allow effects to settle — the banner must never appear in production mode.
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("banner-escape-hatch-dev")).toHaveCount(0);
  });

  test("banner is absent when no escape-hatch flags are active", async ({
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

    await page.waitForTimeout(1000);
    await expect(page.getByTestId("banner-escape-hatch-dev")).toHaveCount(0);
  });

  test("dismiss button removes the banner from the page", async ({ page }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          weakAdminPasswordAllowed: true,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: false,
          isProduction: false,
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-escape-hatch-dev");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("button-dismiss-escape-hatch-dev-banner").click();

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
          weakAdminUsernameAllowed: true,
          weakSessionSecretAllowed: false,
          isProduction: false,
        }),
      });
    });

    await loginAdminUi(page);

    await expect(page.getByTestId("banner-escape-hatch-dev")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("button-dismiss-escape-hatch-dev-banner").click();
    await expect(
      page.getByTestId("banner-escape-hatch-dev"),
    ).toHaveCount(0, { timeout: 3_000 });

    const dismissValue = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      DISMISS_KEY,
    );
    expect(dismissValue).toBe("1");
  });
});
