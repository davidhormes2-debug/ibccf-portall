// Task #636 — Playwright e2e test confirming all three security banners appear
// simultaneously after a real admin login when all three ALLOW_WEAK_* server-side
// flags are active.
//
// Unlike the individual banner unit/harness tests (Tasks #542, #545) this test:
//  - Performs a real UI form-fill login (no page.route() mock for security-flags)
//  - Relies on the actual GET /api/admin/security-flags server response
//  - Requires ALLOW_WEAK_ADMIN_PASSWORD, ALLOW_WEAK_ADMIN_USERNAME, and
//    ALLOW_WEAK_SESSION_SECRET to be set in the server process environment
//    (all three are declared in .github/workflows/e2e-tests.yml env: block so CI
//    always exercises this test with real server behaviour)
//
// Guard: beforeAll throws when any required variable is absent so
// developers without the full flag set get a hard failure rather than a
// silent skip.
//
// The three banner dismissal sessionStorage keys are cleared in addInitScript
// before each test so banners are always in their initial undismissed state.
//
// Individual dismiss isolation tests (Task #720) live in the second describe
// block below. They use page.route() to mock all three flags as true, so they
// run deterministically without the ALLOW_WEAK_* env vars.

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const ALLOW_WEAK_ADMIN_PASSWORD = process.env.ALLOW_WEAK_ADMIN_PASSWORD ?? "";
const ALLOW_WEAK_ADMIN_USERNAME = process.env.ALLOW_WEAK_ADMIN_USERNAME ?? "";
const ALLOW_WEAK_SESSION_SECRET = process.env.ALLOW_WEAK_SESSION_SECRET ?? "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

const DISMISS_KEYS = [
  "ibccf.admin.dismissedWeakAdminPasswordWarning",
  "ibccf.admin.dismissedWeakAdminUsernameWarning",
  "ibccf.admin.dismissedWeakSessionSecretWarning",
];

/** All three security flags forced on — used by the mocked dismiss tests. */
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

async function loginAdmin(page: Page): Promise<void> {
  await page.addInitScript((keys: string[]) => {
    for (const key of keys) {
      sessionStorage.removeItem(key);
    }
  }, DISMISS_KEYS);

  await page.goto("/admin");

  await page.getByTestId("input-admin-username").fill(ADMIN_USERNAME);
  await page.getByTestId("input-admin-password").fill(ADMIN_PASSWORD);
  await page.getByTestId("button-admin-login").click();

  await expect(page.getByTestId("input-admin-password")).toHaveCount(0, {
    timeout: 30_000,
  });
}

test.describe("Admin dashboard — all three security banners visible together (Task #636)", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME ||
      !ADMIN_PASSWORD ||
      !ALLOW_WEAK_ADMIN_PASSWORD ||
      !ALLOW_WEAK_ADMIN_USERNAME ||
      !ALLOW_WEAK_SESSION_SECRET) {
      throw new Error("ADMIN_USERNAME, ADMIN_PASSWORD, ALLOW_WEAK_ADMIN_PASSWORD, ALLOW_WEAK_ADMIN_USERNAME, and ALLOW_WEAK_SESSION_SECRET must all be set");
    }
  });

  test("all three banners appear simultaneously when server returns all three flags active", async ({
    page,
  }) => {
    await loginAdmin(page);

    await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Reload-persistence isolation test
//
// Dismisses one banner, reloads the page within the same browser tab, and
// verifies that:
//   • the dismissed banner remains hidden (sessionStorage survives a reload)
//   • the other two banners re-appear (each key is truly independent)
//
// Uses page.route() to mock GET /api/admin/security-flags so the test is
// deterministic without ALLOW_WEAK_* env vars.
// ---------------------------------------------------------------------------
test.describe("Admin dashboard — banner dismiss state survives reload but does not bleed across keys", () => {
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests",
  );

  // NOTE: No addInitScript key-clearing here. Each Playwright test gets a
  // fresh browser context, so sessionStorage is already empty at test start.
  // Using addInitScript to clear keys would be wrong for this test because
  // addInitScript re-runs on every navigation including page.reload(), which
  // would erase the dismissed key after reload and invalidate the assertion.

  test("dismissed password banner stays hidden after reload; username and session-secret banners re-appear", async ({
    page,
  }) => {
    // Mock all three flags on before any navigation so the component sees them.
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ALL_FLAGS_ON),
      });
    });

    await loginAdminUi(page);

    // Confirm all three are visible before acting.
    await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
      timeout: 10_000,
    });

    // Dismiss only the password banner.
    await page
      .getByTestId("button-dismiss-weak-admin-password-banner")
      .click();
    await expect(
      page.getByTestId("banner-weak-admin-password"),
    ).toHaveCount(0, { timeout: 3_000 });

    // Reload within the same tab — sessionStorage persists across a reload,
    // so the dismissed key survives and the other two keys remain unset.
    await page.reload();
    await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
      timeout: 30_000,
    });

    // The dismissed banner must still be gone (its sessionStorage key survived
    // the reload).
    await expect(
      page.getByTestId("banner-weak-admin-password"),
    ).toHaveCount(0, { timeout: 5_000 });

    // The other two dismiss keys were never set, so their banners must
    // re-appear — confirming each key is truly independent.
    await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Task #720 — Individual dismiss isolation tests
//
// Each test starts fresh with all three flags mocked on and all three
// sessionStorage dismiss-keys cleared. The test then dismisses exactly ONE
// banner and asserts that only that banner disappears while the remaining two
// stay visible — catching any shared-state or wrong-wiring regression.
//
// These tests use page.route() to mock GET /api/admin/security-flags, so
// they run without ALLOW_WEAK_* env vars and are always deterministic.
// ---------------------------------------------------------------------------
test.describe("Admin dashboard — individual banner dismiss isolation (Task #720)", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests");
    }
  });

  test.beforeEach(async ({ page }) => {
    // Clear every dismiss key so each test starts with all banners undismissed.
    await page.addInitScript((keys: string[]) => {
      for (const key of keys) {
        sessionStorage.removeItem(key);
      }
    }, DISMISS_KEYS);

    // Mock all three flags as true before any navigation so the response is
    // in place when AdminDashboard's useEffect fires on mount.
    await page.route("**/api/admin/security-flags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ALL_FLAGS_ON),
      });
    });
  });

  test("dismissing the password banner hides only that banner; username and session-secret banners remain", async ({
    page,
  }) => {
    await loginAdminUi(page);

    // Confirm all three are visible before acting.
    await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
      timeout: 10_000,
    });

    await page
      .getByTestId("button-dismiss-weak-admin-password-banner")
      .click();

    await expect(
      page.getByTestId("banner-weak-admin-password"),
    ).toHaveCount(0, { timeout: 3_000 });
    await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible();
    await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible();
  });

  test("dismissing the username banner hides only that banner; password and session-secret banners remain", async ({
    page,
  }) => {
    await loginAdminUi(page);

    await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
      timeout: 10_000,
    });

    await page
      .getByTestId("button-dismiss-weak-admin-username-banner")
      .click();

    await expect(
      page.getByTestId("banner-weak-admin-username"),
    ).toHaveCount(0, { timeout: 3_000 });
    await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible();
    await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible();
  });

  test("dismissing the session-secret banner hides only that banner; password and username banners remain", async ({
    page,
  }) => {
    await loginAdminUi(page);

    await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
      timeout: 10_000,
    });

    await page
      .getByTestId("button-dismiss-weak-session-secret-banner")
      .click();

    await expect(
      page.getByTestId("banner-weak-session-secret"),
    ).toHaveCount(0, { timeout: 3_000 });
    await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible();
    await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible();
  });
});
