import { test, expect } from "@playwright/test";

test.describe("Portal access-code flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("renders the access-code login form", async ({ page }) => {
    await expect(page.getByTestId("input-access-code")).toBeVisible();
    await expect(page.getByTestId("button-login")).toBeVisible();
  });

  test("rejects a completely bogus access code and stays on the login view", async ({
    page,
  }) => {
    await page.getByTestId("input-access-code").fill("INVALID-CODE-00000");
    await page.getByTestId("button-login").click();

    // After a rejected code the user should remain on the auth view —
    // the access-code input must still be present (no redirect to the portal).
    await expect(page.getByTestId("input-access-code")).toBeVisible({
      timeout: 10_000,
    });

    // A destructive toast or error is shown; confirm the portal shell never
    // renders by verifying the logout button is NOT present.
    await expect(page.getByTestId("button-logout")).not.toBeVisible();
  });

  test("rejects a syntactically plausible but non-existent access code", async ({
    page,
  }) => {
    // Use a code that looks like a real access code (uppercase alphanumeric)
    // but is guaranteed not to exist in the e2e database.
    await page.getByTestId("input-access-code").fill("AAAA-BBBB-CCCC-0000");
    await page.getByTestId("button-login").click();

    // Must stay on the auth view
    await expect(page.getByTestId("input-access-code")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("does not advance to PIN step for a non-existent code", async ({
    page,
  }) => {
    await page.getByTestId("input-access-code").fill("NONEXISTENT-CODE-9999");
    await page.getByTestId("button-login").click();

    // The PIN input only appears after the access code is verified;
    // it must NOT appear for a bogus code.
    await expect(page.getByTestId("input-pin")).not.toBeVisible({
      timeout: 10_000,
    });
  });
});
