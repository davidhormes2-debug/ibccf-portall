import { test, expect } from "@playwright/test";

test.describe("Public landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders without uncaught JavaScript errors", async ({ page }) => {
    const jsErrors: string[] = [];

    // pageerror fires for every uncaught exception thrown by page scripts —
    // this is what we really care about (React render crashes, unhandled
    // promise rejections propagated to window, etc.).
    page.on("pageerror", (err) => {
      jsErrors.push(err.message);
    });

    // console("error") catches both JS-thrown errors AND browser-generated
    // "Failed to load resource" messages. We only want the former.
    const appConsoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Skip browser-generated network messages: these report HTTP-level
        // error responses (4xx/5xx) from API calls that may be intentional
        // (e.g. a heartbeat endpoint responding 400 before a session exists).
        // They are not application-level JavaScript errors.
        if (text.startsWith("Failed to load resource")) return;
        // Skip browser-extension interference
        if (text.includes("extension")) return;
        // Skip missing-favicon noise
        if (text.includes("favicon")) return;
        // Skip hard network failures (no server, DNS, etc.)
        if (text.includes("net::ERR_")) return;
        appConsoleErrors.push(text);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    expect(jsErrors).toHaveLength(0);
    expect(appConsoleErrors).toHaveLength(0);
  });

  test("hero section CTAs are visible", async ({ page }) => {
    await expect(page.getByTestId("hero-button-access")).toBeVisible();
    await expect(page.getByTestId("hero-button-report")).toBeVisible();
  });

  test("desktop navigation buttons are visible", async ({ page }) => {
    await expect(page.getByTestId("nav-request-access")).toBeVisible();
    await expect(page.getByTestId("nav-verify")).toBeVisible();
  });

  test("page title is set", async ({ page }) => {
    // The title should not be empty or the Vite default
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    expect(title).not.toBe("Vite App");
  });

  test("at least one service card is rendered", async ({ page }) => {
    // Service cards have data-testid="service-card-{id}"
    const firstCard = page.locator('[data-testid^="service-card-"]').first();
    await expect(firstCard).toBeVisible();
  });

  test("newsletter subscribe button is reachable", async ({ page }) => {
    // Scroll into view so the element is in the viewport
    await page.getByTestId("button-subscribe").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("button-subscribe")).toBeVisible();
  });
});
