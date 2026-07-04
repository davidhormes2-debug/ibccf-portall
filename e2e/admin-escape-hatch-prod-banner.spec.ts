// Playwright e2e test confirming the EscapeHatchProdBanner renders in the
// admin dashboard when the security-flags endpoint reports isProduction: true
// with at least one active escape-hatch flag.
//
// Pattern:
//   1. page.route() mocks GET /api/admin/security-flags BEFORE navigation so
//      the mock is in place when AdminDashboard's useEffect fires on mount.
//   2. readAdminToken() + page.addInitScript() seeds the session token without
//      consuming a login-rate-limit slot (established convention).
//   3. page.addInitScript() clears the sessionStorage dismissal key in
//      beforeEach so the banner is always in its undismissed state.
//
// A second describe block (below) performs a real form-fill login without any
// page.route() mock, so it exercises the full server→component wiring using
// the live GET /api/admin/security-flags response.  It guards on
// ALLOW_WEAK_ADMIN_PASSWORD being set (which CI always provides via the e2e
// env: block) and throws in beforeAll when the guard is absent so developers
// get a hard failure instead of a silent skip.

import { test, expect, type Page } from "@playwright/test";
import { localTimeout } from "./helpers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const ALLOW_WEAK_ADMIN_PASSWORD = process.env.ALLOW_WEAK_ADMIN_PASSWORD ?? "";
// Set to "1" only in the dedicated e2e-prod-escape-hatch CI job (NODE_ENV=production).
// Empty in the standard e2e job so the prod-live describe block skips cleanly there.
const NODE_ENV_PROD_E2E = process.env.NODE_ENV_PROD_E2E ?? "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

const DISMISS_KEY = "ibccf.admin.dismissedEscapeHatchProdWarning";

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

async function loginAdminUi(page: import("@playwright/test").Page) {
  const token = readAdminToken();
  await page.addInitScript(
    (t: string) => {
      if (t) sessionStorage.setItem("adminToken", t);
    },
    token,
  );
  await page.goto("/admin");
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 90_000,
  });
}

test.describe("Admin dashboard — EscapeHatchProdBanner", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests");
    }
  });

  test.setTimeout(localTimeout(120_000));

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((key: string) => {
      sessionStorage.removeItem(key);
    }, DISMISS_KEY);
  });

  test("banner appears when isProduction is true and one escape-hatch flag is active", async ({
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
          isProduction: true,
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-escape-hatch-prod");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Production security alert:");
    await expect(banner).toContainText("ALLOW_WEAK_ADMIN_PASSWORD=1");
  });

  test("banner appears when isProduction is true and multiple flags are active", async ({
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

    const banner = page.getByTestId("banner-escape-hatch-prod");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Production security alert:");
    await expect(banner).toContainText("ALLOW_WEAK_ADMIN_PASSWORD=1");
    await expect(banner).toContainText("ALLOW_WEAK_ADMIN_USERNAME=1");
    await expect(banner).toContainText("ALLOW_WEAK_SESSION_SECRET=1");
  });

  test("banner is absent when isProduction is false even if flags are active", async ({
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
          isProduction: false,
        }),
      });
    });

    await loginAdminUi(page);

    await page.waitForTimeout(1000);
    await expect(page.getByTestId("banner-escape-hatch-prod")).toHaveCount(0);
  });

  test("banner is absent when isProduction is true but no flags are active", async ({
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
          isProduction: true,
        }),
      });
    });

    await loginAdminUi(page);

    await page.waitForTimeout(1000);
    await expect(page.getByTestId("banner-escape-hatch-prod")).toHaveCount(0);
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
          isProduction: true,
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-escape-hatch-prod");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("button-dismiss-escape-hatch-prod-banner").click();

    await expect(banner).toHaveCount(0, { timeout: 3_000 });
  });

  test("dismiss persists to sessionStorage so the banner stays hidden", async ({
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
          isProduction: true,
        }),
      });
    });

    await loginAdminUi(page);

    await expect(page.getByTestId("banner-escape-hatch-prod")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("button-dismiss-escape-hatch-prod-banner").click();
    await expect(page.getByTestId("banner-escape-hatch-prod")).toHaveCount(0, {
      timeout: 3_000,
    });

    const dismissValue = await page.evaluate(
      (key: string) => sessionStorage.getItem(key),
      DISMISS_KEY,
    );
    expect(dismissValue).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Real server wiring — no page.route() mock
//
// Performs a genuine form-fill admin login so the browser receives the live
// GET /api/admin/security-flags response.  When ALLOW_WEAK_ADMIN_PASSWORD is
// set the server returns weakAdminPasswordAllowed: true.
//
// In CI NODE_ENV=development, so the server returns isProduction: false.
// That means EscapeHatchDevBanner (banner-escape-hatch-dev) is rendered, not
// the production-alert variant.  This describe block therefore asserts on the
// dev banner testids and its dedicated sessionStorage dismiss key, exercising
// the end-to-end server→component wiring path just the same.
//
// Guard: beforeAll throws when ADMIN_USERNAME, ADMIN_PASSWORD, or
// ALLOW_WEAK_ADMIN_PASSWORD is absent so developers get a hard failure rather
// than a silent skip.  All three are declared in the e2e-tests.yml env: block
// so this describe block always runs in CI.
// ---------------------------------------------------------------------------

const DEV_DISMISS_KEY = "ibccf.admin.dismissedEscapeHatchDevWarning";

/**
 * Form-fill admin login that clears both escape-hatch dismissal keys from
 * sessionStorage before the page loads.  Uses addInitScript so the clear
 * happens before React mounts — the same safe ordering used by loginAdminUi
 * above but via the real login form instead of a token seed.
 */
async function loginAdminViaForm(page: Page): Promise<void> {
  await page.addInitScript((keys: string[]) => {
    for (const key of keys) {
      sessionStorage.removeItem(key);
    }
  }, [DISMISS_KEY, DEV_DISMISS_KEY]);

  await page.goto("/admin");

  await page.getByTestId("input-admin-username").fill(ADMIN_USERNAME);
  await page.getByTestId("input-admin-password").fill(ADMIN_PASSWORD);
  await page.getByTestId("button-admin-login").click();

  await expect(page.getByTestId("input-admin-password")).toHaveCount(0, {
    timeout: 30_000,
  });
}

test.describe("Admin dashboard — escape-hatch banner (live server flags, real login)", () => {
  // Skip this describe block in the prod-mode CI job — the server returns
  // isProduction: true there, so the dev banner never appears.  This avoids a
  // hard conflict with the prod-live describe block below while keeping the two
  // jobs self-contained.  NODE_ENV_PROD_E2E="" in the standard e2e job keeps
  // the condition false so these tests run normally in development mode.
  test.skip(!!NODE_ENV_PROD_E2E, "dev banner is absent when NODE_ENV=production; use the prod-live describe block instead");

  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ALLOW_WEAK_ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME, ADMIN_PASSWORD, and ALLOW_WEAK_ADMIN_PASSWORD must all be set to run the live-server escape-hatch banner tests",
      );
    }
  });

  test.setTimeout(localTimeout(120_000));

  test("dev escape-hatch banner appears from live security-flags response when ALLOW_WEAK_ADMIN_PASSWORD is set", async ({
    page,
  }) => {
    await loginAdminViaForm(page);

    // NODE_ENV=development in CI → isProduction: false → EscapeHatchDevBanner
    const banner = page.getByTestId("banner-escape-hatch-dev");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("ALLOW_WEAK_ADMIN_PASSWORD=1");
  });

  test("dismiss button removes the dev escape-hatch banner rendered from live server flags", async ({
    page,
  }) => {
    await loginAdminViaForm(page);

    const banner = page.getByTestId("banner-escape-hatch-dev");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("button-dismiss-escape-hatch-dev-banner").click();

    await expect(banner).toHaveCount(0, { timeout: 3_000 });

    const dismissValue = await page.evaluate(
      (key: string) => sessionStorage.getItem(key),
      DEV_DISMISS_KEY,
    );
    expect(dismissValue).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Production-environment live-server wiring — NODE_ENV=production
//
// This describe block requires NODE_ENV_PROD_E2E=1 in the environment, which
// is set exclusively by the dedicated "e2e-prod-escape-hatch" CI job in
// e2e-tests.yml.  That job boots the server with NODE_ENV=production so the
// GET /api/admin/security-flags endpoint returns isProduction: true.
//
// With ALLOW_WEAK_ADMIN_PASSWORD=1 also set (same CI job), the server
// reports weakAdminPasswordAllowed: true, which means EscapeHatchProdBanner
// (data-testid="banner-escape-hatch-prod") is rendered, not the dev variant.
//
// Guard: test.skip(!NODE_ENV_PROD_E2E, ...) inside the describe callback
// ensures this block is skipped gracefully in the standard e2e job where
// NODE_ENV_PROD_E2E is empty.  The complementary skip in the dev-live describe
// above prevents that block from running in the prod job.
// ---------------------------------------------------------------------------

test.describe("Admin dashboard — EscapeHatchProdBanner (live server, NODE_ENV=production)", () => {
  // Only run in the dedicated prod-mode CI job (NODE_ENV_PROD_E2E=1).  The
  // standard e2e job sets NODE_ENV_PROD_E2E="" so this block skips gracefully
  // there — the server runs in development mode and would render the dev banner
  // instead, which would cause these assertions to fail.
  test.skip(!NODE_ENV_PROD_E2E, "prod banner only appears when NODE_ENV=production; run with NODE_ENV_PROD_E2E=1 (e2e-prod-escape-hatch CI job)");

  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ALLOW_WEAK_ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME, ADMIN_PASSWORD, and ALLOW_WEAK_ADMIN_PASSWORD must all be set to run the production escape-hatch banner tests",
      );
    }
  });

  test.setTimeout(localTimeout(120_000));

  test("prod escape-hatch banner appears from live security-flags response when NODE_ENV is production", async ({
    page,
  }) => {
    await loginAdminViaForm(page);

    // NODE_ENV=production on the server → isProduction: true → EscapeHatchProdBanner
    const banner = page.getByTestId("banner-escape-hatch-prod");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Production security alert:");
    await expect(banner).toContainText("ALLOW_WEAK_ADMIN_PASSWORD=1");
  });

  test("dismiss button removes the prod escape-hatch banner rendered from live server flags", async ({
    page,
  }) => {
    await loginAdminViaForm(page);

    const banner = page.getByTestId("banner-escape-hatch-prod");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("button-dismiss-escape-hatch-prod-banner").click();

    await expect(banner).toHaveCount(0, { timeout: 3_000 });

    const dismissValue = await page.evaluate(
      (key: string) => sessionStorage.getItem(key),
      DISMISS_KEY,
    );
    expect(dismissValue).toBe("1");
  });
});
