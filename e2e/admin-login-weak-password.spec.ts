import { test, expect } from "@playwright/test";

test.describe("Admin login — weak password 503 message", () => {
  test("shows the rotate-ADMIN_PASSWORD alert on the form and clears it on a subsequent 401", async ({
    page,
  }) => {
    let nextResponse: "weak" | "unauthorized" = "weak";

    await page.route("**/api/admin/login", async (route) => {
      if (nextResponse === "weak") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error:
              "Admin password is too weak — rotate ADMIN_PASSWORD before logging in",
          }),
        });
      } else {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "Invalid credentials" }),
        });
      }
    });

    await page.goto("/admin");

    await page.getByTestId("input-admin-username").fill("admin");
    await page.getByTestId("input-admin-password").fill("anything");

    // ---------- First submit: server returns 503 weak-password ----------
    await page.getByTestId("button-admin-login").click();

    const alert = page.getByTestId("alert-admin-login-error");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("rotate ADMIN_PASSWORD");
    await expect(alert).toContainText("Login blocked: weak admin password");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveAttribute("aria-live", "assertive");

    // ---------- Second submit: server returns 401 → slot clears, toast fires ----------
    nextResponse = "unauthorized";
    await page.getByTestId("button-admin-login").click();

    await expect(page.getByTestId("alert-admin-login-error")).toHaveCount(0);

    // The fallback "access denied" toast announces via the Notifications region.
    const notifications = page.getByRole("region", { name: "Notifications" });
    await expect(notifications).toContainText(/access denied/i);
  });
});
