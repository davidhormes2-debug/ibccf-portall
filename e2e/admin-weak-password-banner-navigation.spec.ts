// Playwright e2e tests for WeakPasswordBanner navigation behaviour.
//
// Tests in this file cover:
//   1. Clicking the "Go to Settings → Change Password" CTA link inside the
//      banner switches the dashboard to the Settings tab and opens the
//      Change Password form directly.
//   2. After successfully changing the password through that form, the
//      sessionStorage dismissal key is removed so the banner would re-arm on
//      the next load (if the server still reports weakPassword: true).
//
// Pattern:
//   • page.route() mocks security-flags BEFORE navigation so the mock is
//     in place when AdminDashboard's useEffect fires on mount.
//   • readAdminToken() + page.addInitScript() seeds the bearer token without
//     consuming a login-rate-limit slot.
//   • page.addInitScript() clears the dismissal key in beforeEach so every
//     test starts with the banner in its undismissed state.

import { test, expect, type Page } from "@playwright/test";
import { localTimeout } from "./helpers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

const DISMISS_KEY = "ibccf.admin.dismissedWeakPasswordWarning";
const STRONG_PASSWORD = "Str0ng!Pass#2024";

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

async function loginAdminUi(page: Page): Promise<void> {
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

function mockWeakPasswordFlags(page: Page): void {
  page.route("**/api/admin/security-flags", (route) => {
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
}

test.describe("Admin dashboard — WeakPasswordBanner navigation", () => {
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests",
  );

  test.setTimeout(localTimeout(120_000));

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.removeItem("ibccf.admin.dismissedWeakPasswordWarning");
    });
  });

  test("clicking the banner CTA switches to the Settings tab and shows the Change Password form", async ({
    page,
  }) => {
    mockWeakPasswordFlags(page);
    await loginAdminUi(page);

    const banner = page.getByTestId("banner-weak-password");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("link-go-to-change-password").click();

    await expect(page.getByTestId("input-cp-new")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("successful password change clears the sessionStorage dismissal key so the banner re-arms", async ({
    page,
  }) => {
    mockWeakPasswordFlags(page);

    await page.addInitScript(() => {
      sessionStorage.setItem(
        "ibccf.admin.dismissedWeakPasswordWarning",
        "1",
      );
    });

    await loginAdminUi(page);

    await page.route("**/api/admin/change-password", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.getByTestId("tab-settings").click({ force: true });
    await page.getByTestId("card-change-password").click();
    await expect(page.getByTestId("input-cp-new")).toBeVisible({
      timeout: 5_000,
    });

    await page.getByTestId("input-cp-current").fill(ADMIN_PASSWORD);
    await page.getByTestId("input-cp-new").fill(STRONG_PASSWORD);
    await page.getByTestId("input-cp-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("button-cp-submit").click();

    await expect(page.getByTestId("input-cp-new")).toHaveCount(0, {
      timeout: 5_000,
    });

    const dismissValue = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      DISMISS_KEY,
    );
    expect(dismissValue).toBeNull();
  });
});
