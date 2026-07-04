// Playwright e2e tests for the password-strength badge on the Change Password
// card in the admin Settings tab.
//
// The badge (data-testid="badge-password-strength-{weak|medium|strong}") is
// driven by the `adminPasswordStrength` field returned by
// GET /api/admin/security-flags and renders directly on the card overview —
// no click into the Change Password form is required.
//
// Pattern:
//   1. page.route() mocks the security-flags endpoint BEFORE navigation so the
//      mock is in place when AdminDashboard's useEffect fires on mount.
//   2. readAdminToken() + page.addInitScript() seeds the session token without
//      consuming a login-rate-limit slot (established convention).
//   3. After the dashboard is up we click tab-settings; the badge is then
//      visible on the card without opening the change-password sub-view.

import { test, expect } from "@playwright/test";
import { localTimeout } from "./helpers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

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

/** Base security-flags payload — all flags off, strength overridden per test. */
const BASE_FLAGS = {
  weakAdminPasswordAllowed: false,
  weakAdminUsernameAllowed: false,
  weakSessionSecretAllowed: false,
  isProduction: false,
  adminUsernameTrivial: false,
  weakPassword: false,
};

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

test.describe("Admin Settings — Change Password card strength badge", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin settings e2e tests");
    }
  });

  test.setTimeout(localTimeout(120_000));

  test('shows the red "Weak — change now" badge when adminPasswordStrength is Weak', async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...BASE_FLAGS, adminPasswordStrength: "Weak" }),
      });
    });

    await loginAdminUi(page);
    await page.getByTestId("tab-settings").click({ force: true });

    const badge = page.getByTestId("badge-password-strength-weak");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveText("Weak — change now");

    await expect(
      page.getByTestId("badge-password-strength-medium"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("badge-password-strength-strong"),
    ).toHaveCount(0);
  });

  test('shows the amber "Medium" badge when adminPasswordStrength is Medium', async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...BASE_FLAGS,
          adminPasswordStrength: "Medium",
        }),
      });
    });

    await loginAdminUi(page);
    await page.getByTestId("tab-settings").click({ force: true });

    const badge = page.getByTestId("badge-password-strength-medium");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveText("Medium");

    await expect(
      page.getByTestId("badge-password-strength-weak"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("badge-password-strength-strong"),
    ).toHaveCount(0);
  });

  test('shows the green "Strong" badge when adminPasswordStrength is Strong', async ({
    page,
  }) => {
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...BASE_FLAGS,
          adminPasswordStrength: "Strong",
        }),
      });
    });

    await loginAdminUi(page);
    await page.getByTestId("tab-settings").click({ force: true });

    const badge = page.getByTestId("badge-password-strength-strong");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveText("Strong");

    await expect(
      page.getByTestId("badge-password-strength-weak"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("badge-password-strength-medium"),
    ).toHaveCount(0);
  });

  test("badge updates from Weak to Strong immediately after a successful password change (no reload required)", async ({
    page,
  }) => {
    // First call returns Weak (initial mount fetch); every subsequent call
    // returns Strong (the re-fetch triggered by handleChangePassword on save).
    let callCount = 0;
    await page.route("**/api/admin/security-flags", (route) => {
      const strength = callCount === 0 ? "Weak" : "Strong";
      callCount++;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...BASE_FLAGS, adminPasswordStrength: strength }),
      });
    });

    // Stub the change-password POST so no real DB write is needed.
    await page.route("**/api/admin/change-password", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await loginAdminUi(page);
    await page.getByTestId("tab-settings").click({ force: true });

    // Initial state: weak badge visible, strong badge absent.
    await expect(
      page.getByTestId("badge-password-strength-weak"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId("badge-password-strength-strong"),
    ).toHaveCount(0);

    // Open the Change Password form.
    await page.getByTestId("card-change-password").click();
    await expect(page.getByTestId("input-cp-new")).toBeVisible();

    // Fill in a strong password.
    await page.getByTestId("input-cp-current").fill("CurrentPass1!");
    await page.getByTestId("input-cp-new").fill("Str0ng!Pass#2024");
    await page.getByTestId("input-cp-confirm").fill("Str0ng!Pass#2024");

    // Submit — the component POSTs, then re-fetches security-flags.
    await page.getByTestId("button-cp-submit").click();

    // After save the view returns to main and the badge must reflect the new
    // strength without a page reload.
    await expect(
      page.getByTestId("badge-password-strength-strong"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId("badge-password-strength-weak"),
    ).toHaveCount(0);
  });
});
