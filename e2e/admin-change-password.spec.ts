import { test, expect, type Page } from "@playwright/test";
import { readAdminToken } from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const STRONG_PASSWORD = "Str0ng!Pass#2024";

async function loginAndOpenChangePassword(page: Page): Promise<void> {
  // Inject the pre-fetched bearer token into sessionStorage before the page
  // initialises so the React app skips the login form entirely.
  const token = readAdminToken();
  await page.addInitScript(
    (t) => { if (t) sessionStorage.setItem("adminToken", t); },
    token,
  );
  await page.goto("/admin");
  await page.getByTestId("tab-settings").click({ force: true });
  await page.getByTestId("card-change-password").click();
  await expect(page.getByTestId("input-cp-new")).toBeVisible();
}

test.describe("Admin settings — change password form", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin change-password e2e tests");
    }
  });

  test.beforeEach(async ({ page }) => {
    await loginAndOpenChangePassword(page);
  });

  test("inline mismatch indicator appears when confirm password differs", async ({
    page,
  }) => {
    await page.getByTestId("input-cp-new").fill(STRONG_PASSWORD);
    await page.getByTestId("input-cp-confirm").fill("DifferentPass!1");

    const mismatch = page.getByTestId("cp-mismatch");
    await expect(mismatch).toBeVisible();
    await expect(mismatch).toHaveText("Passwords do not match");
  });

  test("inline mismatch indicator disappears when confirm password is corrected", async ({
    page,
  }) => {
    await page.getByTestId("input-cp-new").fill(STRONG_PASSWORD);
    await page.getByTestId("input-cp-confirm").fill("DifferentPass!1");
    await expect(page.getByTestId("cp-mismatch")).toBeVisible();

    await page.getByTestId("input-cp-confirm").fill(STRONG_PASSWORD);
    await expect(page.getByTestId("cp-mismatch")).toHaveCount(0);
  });

  test("submit shows an error banner when fields are empty", async ({
    page,
  }) => {
    await page.getByTestId("button-cp-submit").click();

    const error = page.getByTestId("cp-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("required");
  });

  test("submit shows an error banner when passwords do not match", async ({
    page,
  }) => {
    await page.getByTestId("input-cp-current").fill(ADMIN_PASSWORD);
    await page.getByTestId("input-cp-new").fill(STRONG_PASSWORD);
    await page.getByTestId("input-cp-confirm").fill("DifferentPass!1");
    await page.getByTestId("button-cp-submit").click();

    const error = page.getByTestId("cp-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("do not match");
  });

  test("submit shows an error banner when new password is weak", async ({
    page,
  }) => {
    await page.getByTestId("input-cp-current").fill(ADMIN_PASSWORD);
    await page.getByTestId("input-cp-new").fill("abc");
    await page.getByTestId("input-cp-confirm").fill("abc");
    await page.getByTestId("button-cp-submit").click();

    const error = page.getByTestId("cp-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("too weak");
  });

  test("successful password change navigates back to the settings main view", async ({
    page,
  }) => {
    await page.route("**/api/admin/change-password", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.getByTestId("input-cp-current").fill(ADMIN_PASSWORD);
    await page.getByTestId("input-cp-new").fill(STRONG_PASSWORD);
    await page.getByTestId("input-cp-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("button-cp-submit").click();

    await expect(page.getByTestId("input-cp-new")).toHaveCount(0);
    await expect(page.getByTestId("card-change-password")).toBeVisible();
  });

  test("server-side rejection surfaces the error message in the error banner", async ({
    page,
  }) => {
    await page.route("**/api/admin/change-password", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Current password is incorrect" }),
      });
    });

    await page.getByTestId("input-cp-current").fill("wrong-current");
    await page.getByTestId("input-cp-new").fill(STRONG_PASSWORD);
    await page.getByTestId("input-cp-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("button-cp-submit").click();

    const error = page.getByTestId("cp-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("Current password is incorrect");
  });
});
