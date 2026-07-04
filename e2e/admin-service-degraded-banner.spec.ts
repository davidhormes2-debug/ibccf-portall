// Playwright e2e tests for the ServiceDegradedBanner.
//
// The banner (data-testid="banner-service-degraded") renders at the top of the
// authenticated admin dashboard whenever GET /health reports one or more
// services as "degraded". Clicking "View Health" navigates to the Service
// Health panel (data-testid="service-health-panel"). Dismissal is client-side
// only (sessionStorage key) — no backend endpoint.
//
// Pattern:
//   1. page.route() mocks GET /health BEFORE navigation so the mock is in
//      place when ServiceDegradedBanner's useEffect fires on mount.
//   2. readAdminToken() + page.addInitScript() seeds the session token without
//      consuming a login-rate-limit slot (follows established convention).
//   3. page.addInitScript() clears the sessionStorage dismissal keys before
//      each test so the banner is always in its undismissed state.

import { test, expect } from "@playwright/test";
import { loginAdminUi as loginAdminUiBase, localTimeout} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

// sessionStorage key format used by ServiceDegradedBanner (sorted services joined by comma)
const DISMISS_KEY_DB = "svc-degraded-dismissed:db";
const DISMISS_KEY_DB_SMTP = "svc-degraded-dismissed:db,smtp";
const DISMISS_KEY_ALL = "svc-degraded-dismissed:ai,db,smtp";

/**
 * Seed the pre-fetched admin token into sessionStorage and wait for the
 * admin-data-ready sentinel so the dashboard has fully loaded before asserting.
 */
async function loginAdminUi(page: import("@playwright/test").Page) {
  await loginAdminUiBase(page);
  await expect(page.getByTestId("admin-data-ready")).toBeAttached({
    timeout: 30_000,
  });
}

test.describe("Admin dashboard — ServiceDegradedBanner", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests",
      );
    }
  });

  test.beforeEach(async ({ page }) => {
    // Clear any leftover dismissal keys from previous runs so the banner is
    // always in its undismissed state at the start of each test.
    await page.addInitScript((keys: string[]) => {
      for (const key of keys) {
        sessionStorage.removeItem(key);
      }
    }, [DISMISS_KEY_DB, DISMISS_KEY_DB_SMTP, DISMISS_KEY_ALL]);
  });

  test.setTimeout(localTimeout(120_000));

  test("banner appears and lists the correct service when DB is degraded", async ({
    page,
  }) => {
    await page.route("**/health", (route) => {
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          db: { status: "degraded" },
          smtp: { status: "ok" },
          ai: { status: "ok" },
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-service-degraded");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("banner-service-degraded-services")).toContainText(
      "Database",
    );
  });

  test("banner lists multiple degraded services when more than one is down", async ({
    page,
  }) => {
    await page.route("**/health", (route) => {
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          db: { status: "degraded" },
          smtp: { status: "degraded" },
          ai: { status: "ok" },
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-service-degraded");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    const servicesList = page.getByTestId("banner-service-degraded-services");
    await expect(servicesList).toContainText("Database");
    await expect(servicesList).toContainText("SMTP");
  });

  test("banner is absent when all services are healthy", async ({ page }) => {
    await page.route("**/health", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          db: { status: "ok" },
          smtp: { status: "ok" },
          ai: { status: "ok" },
        }),
      });
    });

    await loginAdminUi(page);

    // Allow effects to settle — the banner must never appear when all OK.
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("banner-service-degraded")).toHaveCount(0);
  });

  test("clicking View Health navigates to the Service Health panel", async ({
    page,
  }) => {
    await page.route("**/health", (route) => {
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          db: { status: "degraded" },
          smtp: { status: "ok" },
          ai: { status: "ok" },
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-service-degraded");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("button-service-degraded-view-health").click();

    await expect(page.getByTestId("service-health-panel")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("dismiss button removes the banner from the page", async ({ page }) => {
    await page.route("**/health", (route) => {
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          db: { status: "degraded" },
          smtp: { status: "ok" },
          ai: { status: "ok" },
        }),
      });
    });

    await loginAdminUi(page);

    const banner = page.getByTestId("banner-service-degraded");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("button-service-degraded-dismiss").click();

    await expect(banner).toHaveCount(0, { timeout: 3_000 });
  });

  test("dismiss persists to sessionStorage so the banner stays hidden", async ({
    page,
  }) => {
    await page.route("**/health", (route) => {
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          db: { status: "degraded" },
          smtp: { status: "ok" },
          ai: { status: "ok" },
        }),
      });
    });

    await loginAdminUi(page);

    await expect(page.getByTestId("banner-service-degraded")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("button-service-degraded-dismiss").click();
    await expect(page.getByTestId("banner-service-degraded")).toHaveCount(0, {
      timeout: 3_000,
    });

    const dismissValue = await page.evaluate(
      (key: string) => sessionStorage.getItem(key),
      DISMISS_KEY_DB,
    );
    expect(dismissValue).toBe("1");
  });
});
