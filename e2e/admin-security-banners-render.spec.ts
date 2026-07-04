// Playwright e2e regression guard: WeakAdminPasswordBanner,
// WeakAdminUsernameBanner, and WeakSessionSecretBanner must render when their
// respective flag is returned as active by the security-flags endpoint.
//
// Each test isolates a single flag so a regression in any one banner is
// surfaced immediately and precisely — a combined-spec failure could otherwise
// obscure which banner broke.
//
// Pattern:
//   1. page.route() mocks GET /api/admin/security-flags BEFORE navigation so
//      only the banner under test has its flag set to true.
//   2. readAdminToken() + page.addInitScript() seeds the session token without
//      consuming a login-rate-limit slot (established convention).
//   3. Each test waits for the banner to be visible — no real ALLOW_WEAK_*
//      env vars required.

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

/** Base flags shape with all three undismissable flags off. */
const BASE_FLAGS = {
  weakAdminPasswordAllowed: false,
  weakAdminUsernameAllowed: false,
  weakSessionSecretAllowed: false,
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

test.describe("Admin dashboard — per-banner positive render guard", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests",
      );
    }
  });

  test("WeakAdminPasswordBanner renders when weakAdminPasswordAllowed is true", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...BASE_FLAGS,
          weakAdminPasswordAllowed: true,
        }),
      });
    });

    await loginAdminUi(page);

    await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("WeakAdminPasswordBanner does not render when weakAdminPasswordAllowed is false", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(BASE_FLAGS),
      });
    });

    await loginAdminUi(page);

    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("banner-weak-admin-password")).toHaveCount(0);
  });

  test("WeakAdminUsernameBanner renders when weakAdminUsernameAllowed is true", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...BASE_FLAGS,
          weakAdminUsernameAllowed: true,
        }),
      });
    });

    await loginAdminUi(page);

    await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("WeakAdminUsernameBanner does not render when weakAdminUsernameAllowed is false", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(BASE_FLAGS),
      });
    });

    await loginAdminUi(page);

    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("banner-weak-admin-username")).toHaveCount(0);
  });

  test("WeakSessionSecretBanner renders when weakSessionSecretAllowed is true", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...BASE_FLAGS,
          weakSessionSecretAllowed: true,
        }),
      });
    });

    await loginAdminUi(page);

    await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("WeakSessionSecretBanner does not render when weakSessionSecretAllowed is false", async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(BASE_FLAGS),
      });
    });

    await loginAdminUi(page);

    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("banner-weak-session-secret")).toHaveCount(0);
  });
});
