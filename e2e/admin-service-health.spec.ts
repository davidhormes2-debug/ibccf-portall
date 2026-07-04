// End-to-end coverage for the Service Health panel in the admin dashboard
// Settings tab (client/src/components/admin/ServiceHealthPanel.tsx).
//
// The panel fetches /health, renders per-service badges, and auto-refreshes
// every 60 seconds. No automated tests covered this flow. This spec closes
// that gap by:
//
//   1. Logging in as admin using the pre-warmed global-setup session.
//   2. Navigating to the Settings tab and clicking the "Service Health" card.
//   3. Asserting the three service cards (db, smtp, ai) are visible.
//   4. Asserting the overall status banner is visible.
//   5. Asserting the Refresh button triggers a new /health fetch and the
//      banner remains visible after the refresh cycle completes.

import { test, expect } from "@playwright/test";
import { loginAdminUi as loginAdminUiBase, localTimeout} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

async function loginAdminUi(page: import("@playwright/test").Page) {
  await loginAdminUiBase(page);
  await expect(page.getByTestId("admin-data-ready")).toBeAttached({
    timeout: 30_000,
  });
}

test.describe("Admin — Service Health panel", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test",
      );
    }
  });

  test.beforeEach(() => {
    test.setTimeout(localTimeout(120_000));
  });

  test("Settings tab → Service Health card opens the panel with all three service cards and the overall banner", async ({
    page,
  }) => {
    await loginAdminUi(page);

    // Navigate to the Settings tab.
    await page.getByTestId("tab-settings").click({ force: true });

    // Click the Service Health card to open the panel.
    await page.getByTestId("card-service-health").click();

    // The panel should render the per-service cards.
    await expect(page.getByTestId("health-card-db")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("health-card-smtp")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("health-card-ai")).toBeVisible({
      timeout: 15_000,
    });

    // The overall status banner must be visible (appears once /health responds).
    await expect(page.getByTestId("health-overall-banner")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Service Health panel shows fetch-error banner and hides service cards when /health is unreachable", async ({
    page,
  }) => {
    // Abort all requests to /health so the panel cannot load health data.
    await page.route("**/health", (route) => route.abort());

    await loginAdminUi(page);

    // Navigate to the Settings tab.
    await page.getByTestId("tab-settings").click({ force: true });

    // Click the Service Health card to open the panel.
    await page.getByTestId("card-service-health").click();

    // The error banner must appear once the failed fetch resolves.
    await expect(page.getByTestId("health-fetch-error")).toBeVisible({
      timeout: 30_000,
    });

    // Service cards must not be rendered — no stale data should be shown.
    await expect(page.getByTestId("health-card-db")).not.toBeVisible();
    await expect(page.getByTestId("health-card-smtp")).not.toBeVisible();
    await expect(page.getByTestId("health-card-ai")).not.toBeVisible();
  });

  test("Refresh button triggers a new /health fetch and the overall banner stays visible", async ({
    page,
  }) => {
    // Count how many times /health is requested so we can assert the button
    // triggers an additional fetch beyond the initial panel-open load.
    let healthCallCount = 0;
    await page.route("**/health", async (route) => {
      healthCallCount++;
      await route.continue();
    });

    await loginAdminUi(page);

    // Navigate to the Settings tab and open the panel.
    await page.getByTestId("tab-settings").click({ force: true });
    await page.getByTestId("card-service-health").click();

    // Wait for the initial load to complete so healthCallCount is stable.
    await expect(page.getByTestId("health-overall-banner")).toBeVisible({
      timeout: 30_000,
    });

    const countAfterInitialLoad = healthCallCount;

    // Click the Refresh button and wait for the subsequent /health response.
    const healthResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/health") && res.status() === 200,
      { timeout: 30_000 },
    );
    await page.getByTestId("btn-health-refresh").click({ force: true });
    await healthResponsePromise;

    // The button must have triggered at least one more /health request.
    expect(healthCallCount).toBeGreaterThan(countAfterInitialLoad);

    // The overall banner must remain visible — confirming the refresh cycle
    // completed without crashing the panel.
    await expect(page.getByTestId("health-overall-banner")).toBeVisible({
      timeout: 15_000,
    });
  });
});
