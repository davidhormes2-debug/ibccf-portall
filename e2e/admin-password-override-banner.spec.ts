import { test, expect, type Page } from "@playwright/test";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

async function loginAndOpenSettings(page: Page): Promise<void> {
  await page.goto("/admin");

  await page.getByTestId("input-admin-username").fill(ADMIN_USERNAME);
  await page.getByTestId("input-admin-password").fill(ADMIN_PASSWORD);
  await page.getByTestId("button-admin-login").click();

  // Wait until the login form is gone (dashboard rendered).
  await expect(page.getByTestId("input-admin-password")).toHaveCount(0, {
    timeout: 30_000,
  });

  // Navigate to the Settings tab.
  await page.getByTestId("tab-settings").click({ force: true });
}

test.describe("Admin settings — password override banner", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin settings e2e tests");
    }
  });

  test("banner appears when override is active, disappears after reset, and shows a success toast", async ({
    page,
  }) => {
    // Intercept the status endpoint before any navigation so the mock is in
    // place by the time SettingsTab mounts and fires its useEffect.
    await page.route("**/api/admin/password-override-status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active: true,
          changedAt: "2024-01-15T10:00:00.000Z",
          changedBy: "admin",
        }),
      });
    });

    // Track whether the DELETE endpoint is actually called.
    let deleteWasCalled = false;
    await page.route("**/api/admin/password-override", (route) => {
      if (route.request().method() === "DELETE") {
        deleteWasCalled = true;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      } else {
        route.continue();
      }
    });

    await loginAndOpenSettings(page);

    // ---------- Banner should be visible ----------
    const banner = page.getByTestId("banner-password-override");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toHaveAttribute("role", "alert");
    await expect(banner).toContainText("ADMIN_PASSWORD");

    // ---------- Click "Reset to env var" ----------
    const resetBtn = page.getByTestId("btn-reset-password-override");
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    // ---------- Banner should disappear ----------
    await expect(banner).toHaveCount(0, { timeout: 5_000 });

    // ---------- DELETE endpoint must have been called ----------
    expect(deleteWasCalled).toBe(true);

    // ---------- Success toast should appear ----------
    const notifications = page.getByRole("region", { name: "Notifications" });
    await expect(notifications).toContainText(/password override cleared/i, {
      timeout: 5_000,
    });
  });
});
