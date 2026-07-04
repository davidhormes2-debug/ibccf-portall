// Playwright e2e regression guard: security banners must respond correctly
// when the security-flags endpoint returns different values on a second fetch
// (i.e., when the first response is stale).
//
// Scenario A — hidden then shown (reload path):
//   1. First fetch returns all flags false → no banner visible.
//   2. Page reload triggers a second fetch that returns the flag true → banner
//      must appear.
//
// Scenario B — shown then hidden (reload path):
//   1. First fetch returns the flag true → banner is visible.
//   2. Page reload triggers a second fetch that returns the flag false → banner
//      must disappear.
//
// Scenario C — tab-focus path (visibilitychange / focus):
//   1. First fetch returns all flags false → no banner visible.
//   2. A synthetic visibilitychange event (page.evaluate) fires mid-session,
//      triggering a second fetch that returns the flag true → banner appears.
//
// Using a per-test call counter inside page.route() lets us return different
// payloads on the first vs second intercept without polling or real env vars.
//
// Pattern matches the sibling spec e2e/admin-security-banners-render.spec.ts:
//   - page.route() is registered BEFORE navigation.
//   - readAdminToken() + page.addInitScript() seeds the session token.
//   - loginAdminUi() waits for admin-case-finder-trigger as the ready signal.

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

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

test.describe("Admin dashboard — security-flags stale-cache guard", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests",
      );
    }
  });

  test(
    "WeakAdminPasswordBanner appears after a reload that returns true on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakAdminPasswordAllowed: callCount >= 2,
          }),
        });
      });

      await loginAdminUi(page);

      // First fetch returned false — banner must not be present yet.
      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-admin-password")).toHaveCount(0);

      // Reload triggers a second security-flags fetch (callCount becomes 2).
      await page.reload();
      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // Second fetch returned true — banner must now be visible.
      await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
        timeout: 10_000,
      });
    },
  );

  test(
    "WeakAdminPasswordBanner disappears after a reload that returns false on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakAdminPasswordAllowed: callCount === 1,
          }),
        });
      });

      await loginAdminUi(page);

      // First fetch returned true — banner must be visible.
      await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
        timeout: 10_000,
      });

      // Reload triggers a second security-flags fetch (callCount becomes 2).
      await page.reload();
      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // Second fetch returned false — banner must no longer be present.
      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-admin-password")).toHaveCount(0);
    },
  );

  test(
    "WeakAdminUsernameBanner appears after a reload that returns true on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakAdminUsernameAllowed: callCount >= 2,
          }),
        });
      });

      await loginAdminUi(page);

      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-admin-username")).toHaveCount(0);

      await page.reload();
      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
        timeout: 10_000,
      });
    },
  );

  test(
    "WeakSessionSecretBanner appears after a reload that returns true on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakSessionSecretAllowed: callCount >= 2,
          }),
        });
      });

      await loginAdminUi(page);

      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-session-secret")).toHaveCount(0);

      await page.reload();
      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
        timeout: 10_000,
      });
    },
  );

  test(
    "WeakAdminUsernameBanner disappears after a reload that returns false on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakAdminUsernameAllowed: callCount === 1,
          }),
        });
      });

      await loginAdminUi(page);

      // First fetch returned true — banner must be visible.
      await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
        timeout: 10_000,
      });

      // Reload triggers a second security-flags fetch (callCount becomes 2).
      await page.reload();
      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // Second fetch returned false — banner must no longer be present.
      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-admin-username")).toHaveCount(0);
    },
  );

  test(
    "WeakSessionSecretBanner disappears after a reload that returns false on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakSessionSecretAllowed: callCount === 1,
          }),
        });
      });

      await loginAdminUi(page);

      // First fetch returned true — banner must be visible.
      await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
        timeout: 10_000,
      });

      // Reload triggers a second security-flags fetch (callCount becomes 2).
      await page.reload();
      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // Second fetch returned false — banner must no longer be present.
      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-session-secret")).toHaveCount(0);
    },
  );
});

// ---------------------------------------------------------------------------
// Scenario C — tab-focus path (visibilitychange / focus event mid-session)
// ---------------------------------------------------------------------------
// These tests guard the visibilitychange/focus listener added to the
// security-flags useEffect.  Instead of triggering a page.reload() they fire
// synthetic browser events via page.evaluate() and assert the banner reacts
// to the updated flag value returned on the second intercepted fetch.
// ---------------------------------------------------------------------------

test.describe("Admin dashboard — security-flags tab-focus refetch guard", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests",
      );
    }
  });

  /**
   * Simulate a full hidden → visible tab transition so the was-hidden guard
   * inside the security-flags useEffect is correctly tripped.
   *
   * Steps:
   *   1. Set visibilityState to "hidden" and fire visibilitychange → listener
   *      sets wasHidden=true.
   *   2. Set visibilityState back to "visible" and fire visibilitychange +
   *      focus → listener sees wasHidden=true, resets it, and calls fetchFlags().
   */
  async function simulateTabFocus(page: Page): Promise<void> {
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
  }

  test(
    "WeakAdminPasswordBanner appears after a tab-focus event that returns true on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakAdminPasswordAllowed: callCount >= 2,
          }),
        });
      });

      await loginAdminUi(page);

      // First fetch returned false — banner must not be present yet.
      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-admin-password")).toHaveCount(0);

      // Simulate the tab regaining focus (triggers second security-flags fetch).
      await simulateTabFocus(page);

      // Second fetch returned true — banner must now be visible without a reload.
      await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
        timeout: 10_000,
      });
    },
  );

  test(
    "WeakAdminUsernameBanner appears after a tab-focus event that returns true on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakAdminUsernameAllowed: callCount >= 2,
          }),
        });
      });

      await loginAdminUi(page);

      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-admin-username")).toHaveCount(0);

      await simulateTabFocus(page);

      await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
        timeout: 10_000,
      });
    },
  );

  test(
    "WeakSessionSecretBanner appears after a tab-focus event that returns true on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakSessionSecretAllowed: callCount >= 2,
          }),
        });
      });

      await loginAdminUi(page);

      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-session-secret")).toHaveCount(0);

      await simulateTabFocus(page);

      await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
        timeout: 10_000,
      });
    },
  );

  test(
    "WeakAdminPasswordBanner disappears after a tab-focus event that returns false on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakAdminPasswordAllowed: callCount === 1,
          }),
        });
      });

      await loginAdminUi(page);

      // First fetch returned true — banner must be visible.
      await expect(page.getByTestId("banner-weak-admin-password")).toBeVisible({
        timeout: 10_000,
      });

      // Simulate the tab regaining focus (triggers second security-flags fetch).
      await simulateTabFocus(page);

      // Second fetch returned false — banner must no longer be present.
      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-admin-password")).toHaveCount(0);
    },
  );

  test(
    "WeakAdminUsernameBanner disappears after a tab-focus event that returns false on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakAdminUsernameAllowed: callCount === 1,
          }),
        });
      });

      await loginAdminUi(page);

      // First fetch returned true — banner must be visible.
      await expect(page.getByTestId("banner-weak-admin-username")).toBeVisible({
        timeout: 10_000,
      });

      // Simulate the tab regaining focus (triggers second security-flags fetch).
      await simulateTabFocus(page);

      // Second fetch returned false — banner must no longer be present.
      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-admin-username")).toHaveCount(0);
    },
  );

  test(
    "WeakSessionSecretBanner disappears after a tab-focus event that returns false on the second fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            weakSessionSecretAllowed: callCount === 1,
          }),
        });
      });

      await loginAdminUi(page);

      // First fetch returned true — banner must be visible.
      await expect(page.getByTestId("banner-weak-session-secret")).toBeVisible({
        timeout: 10_000,
      });

      // Simulate the tab regaining focus (triggers second security-flags fetch).
      await simulateTabFocus(page);

      // Second fetch returned false — banner must no longer be present.
      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-session-secret")).toHaveCount(0);
    },
  );

  // -------------------------------------------------------------------------
  // was-hidden guard: a bare focus event (tab was never hidden) must NOT
  // trigger a second security-flags fetch, avoiding a spurious network
  // round-trip on every alt-tab into the browser.
  // -------------------------------------------------------------------------
  test(
    "focus event without a prior hidden state does NOT trigger a second security-flags fetch",
    async ({ page }) => {
      let callCount = 0;
      await page.route("**/api/admin/security-flags", (route) => {
        callCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...BASE_FLAGS,
            // If a spurious second fetch fires, the banner would appear.
            weakAdminPasswordAllowed: callCount >= 2,
          }),
        });
      });

      await loginAdminUi(page);

      // First fetch returned false — banner must not be present.
      await page.waitForTimeout(500);
      await expect(page.getByTestId("banner-weak-admin-password")).toHaveCount(0);

      // Fire a bare focus event without any prior visibilitychange to "hidden".
      // The was-hidden guard must suppress the re-fetch entirely.
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
      });

      // After a generous wait, the banner must still be absent (no second fetch).
      await page.waitForTimeout(1_000);
      await expect(page.getByTestId("banner-weak-admin-password")).toHaveCount(0);
    },
  );
});
