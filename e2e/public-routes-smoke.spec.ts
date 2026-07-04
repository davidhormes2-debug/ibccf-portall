import { test, expect } from "@playwright/test";

const PUBLIC_ROUTES = [
  { path: "/", label: "Home" },
  { path: "/verify", label: "Verify" },
  { path: "/request-access", label: "Request Access" },
  { path: "/community", label: "Community" },
  { path: "/legal-resources", label: "Legal Resources" },
  { path: "/divisions/aml", label: "Division (AML)" },
];

test.describe("Public routes smoke test", () => {
  for (const { path, label } of PUBLIC_ROUTES) {
    test(`${label} (${path}) — HTTP 200, main landmark, no JS errors`, async ({
      page,
    }) => {
      const jsErrors: string[] = [];
      page.on("pageerror", (err) => {
        jsErrors.push(err.message);
      });

      let status: number | null = null;
      page.on("response", (response) => {
        if (response.url().endsWith(path) || response.url().includes(`${path}?`)) {
          status = response.status();
        }
      });

      const response = await page.goto(path);
      expect(response?.status(), `${label}: expected HTTP 200`).toBe(200);

      await page.waitForLoadState("domcontentloaded");

      const main = page.locator("main#main-content");
      await expect(main, `${label}: <main id="main-content"> must be present`).toBeAttached();

      expect(jsErrors, `${label}: no uncaught JS errors`).toHaveLength(0);
    });
  }
});

test.describe("Division not-found fallback smoke test", () => {
  test("/divisions/nonexistent-slug — renders fallback UI without JS errors", async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => {
      jsErrors.push(err.message);
    });

    // The SPA always serves HTTP 200; the not-found branch is rendered
    // client-side by DivisionPage when the slug isn't in the static divisions record.
    const response = await page.goto("/divisions/nonexistent-slug");
    expect(response?.status(), "Division not-found: expected HTTP 200 from SPA shell").toBe(200);

    await page.waitForLoadState("domcontentloaded");

    // The fallback must expose a <main id="main-content"> landmark so the
    // skip-to-main link has a target and screen readers can announce the page.
    const main = page.locator("main#main-content");
    await expect(main, "Division not-found: <main id=\"main-content\"> must be present").toBeAttached();

    // Confirm the "Division not found" heading is visible (no blank-page crash).
    await expect(
      page.getByText("Division not found"),
      "Division not-found: heading must be visible"
    ).toBeVisible();

    // Confirm the "Back to home" link is present so the user can escape.
    await expect(
      page.getByRole("link", { name: /back to home/i }),
      "Division not-found: back-to-home link must be visible"
    ).toBeVisible();

    expect(jsErrors, "Division not-found: no uncaught JS errors").toHaveLength(0);
  });
});

test.describe("404 / NotFound page smoke test", () => {
  test("/this-route-does-not-exist — renders NotFound without JS errors", async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => {
      jsErrors.push(err.message);
    });

    // The SPA shell is always served with HTTP 200; the wildcard route renders
    // the NotFound component client-side via wouter.
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status(), "NotFound: expected HTTP 200 from SPA shell").toBe(200);

    await page.waitForLoadState("domcontentloaded");

    const main = page.locator("main#main-content");
    await expect(main, "NotFound: <main id=\"main-content\"> must be present").toBeAttached();

    // Confirm the NotFound component actually rendered (not a blank page crash).
    await expect(
      page.getByText("Page not found"),
      "NotFound: heading text must be visible"
    ).toBeVisible();

    expect(jsErrors, "NotFound: no uncaught JS errors").toHaveLength(0);
  });
});
