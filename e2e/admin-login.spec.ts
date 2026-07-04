import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Group 1: Login-form UI — no real credentials needed
// ---------------------------------------------------------------------------

test.describe("Admin login — form rendering", () => {
  test("shows the login form on /admin", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.getByTestId("input-admin-username")).toBeVisible();
    await expect(page.getByTestId("input-admin-password")).toBeVisible();
    await expect(page.getByTestId("button-admin-login")).toBeVisible();
  });

  test("logo is visible on the login screen", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("img-admin-logo")).toBeVisible();
  });

  test("stays on the login view when wrong credentials are submitted", async ({
    page,
  }) => {
    await page.goto("/admin");

    await page.getByTestId("input-admin-username").fill("totally-wrong-user");
    await page.getByTestId("input-admin-password").fill("wrongpassword!");
    await page.getByTestId("button-admin-login").click();

    // A failed login shows a destructive toast and leaves the form in place.
    // The logout button (only present after a successful login) must NOT appear.
    await expect(page.getByTestId("button-admin-login")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("button-logout")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Group 2: Post-login dashboard — relies on the admin bearer token that
// global-setup.ts pre-fetched and stored in localStorage via Playwright's
// storageState mechanism.  The "admin-auth" Playwright project loads
// playwright/.auth/admin.json before each test, so no API call is made here.
//
// global-setup.ts always deletes any previously cached admin.json before
// logging in, ensuring a stale token from a prior run can never cause these
// tests to silently skip.  One fresh login call is made per suite run
// (counts against the 5-attempts/15-minute rate-limit window).
// ---------------------------------------------------------------------------

test.describe("Admin login — dashboard access", () => {
  /**
   * Read the admin bearer token from localStorage (seeded by global-setup.ts
   * and loaded via the project's `use.storageState` config), inject it into
   * sessionStorage so the React app picks it up, then reload the page.
   *
   * Returns false (and marks the test as skipped) when no token is present —
   * e.g. credentials were not configured or the rate-limiter was busy at suite
   * start.
   */
  async function injectTokenAndNavigate(
    page: Parameters<Parameters<typeof test>[1]>[0]["page"],
  ): Promise<boolean> {
    // Navigate first so the page's localStorage context is in scope.
    await page.goto("/admin");

    // The storageState loaded by the "admin-auth" project seeds adminToken
    // into localStorage before the test starts.
    const token = await page.evaluate(() =>
      localStorage.getItem("adminToken"),
    );

    if (!token) {
      test.skip(
        true,
        "No admin token in storage state — global-setup.ts always clears the " +
          "cache before login, so this means the setup login itself failed. " +
          "Check that ADMIN_USERNAME / ADMIN_PASSWORD are set correctly and that " +
          "the server is reachable.",
      );
      return false;
    }

    // Promote to sessionStorage where the React app looks for it.
    await page.evaluate((t) => sessionStorage.setItem("adminToken", t), token);
    await page.reload();
    return true;
  }

  test("authenticated admin sees the dashboard after login", async ({
    page,
  }) => {
    const ok = await injectTokenAndNavigate(page);
    if (!ok) return;

    // The logout button is only rendered once the session token is accepted.
    await expect(page.getByTestId("button-logout")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("dashboard header controls are present after authentication", async ({
    page,
  }) => {
    const ok = await injectTokenAndNavigate(page);
    if (!ok) return;

    await expect(page.getByTestId("button-logout")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("button-theme-toggle-admin")).toBeVisible();
    await expect(page.getByTestId("button-notifications")).toBeVisible();
  });
});
