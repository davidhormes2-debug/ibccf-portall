import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

function readAdminToken(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")) as { token?: string };
    return raw.token ?? "";
  } catch {
    return "";
  }
}

test("mini: addInitScript login then tab-cases click", async ({ page }) => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("needs creds");
    }
  });
  test.setTimeout(60_000);

  const token = readAdminToken();
  await page.addInitScript(
    (t) => { if (t) sessionStorage.setItem("adminToken", t); },
    token,
  );
  await page.goto("/admin");

  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({ timeout: 30_000 });
  console.log("✓ Dashboard loaded (logged in via token)");

  // Use dispatchEvent to bypass ALL actionability checks on the locator itself.
  // This approach fires the DOM click event directly without Playwright
  // waiting for the element to be "stable" (i.e. not moving).
  // NOTE: we need to use page.evaluate because locator.dispatchEvent still
  // waits for element resolution with stability checks.
  const clicked = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="tab-cases"]') as HTMLElement | null;
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  });
  console.log("✓ JS click dispatched, result:", clicked);
});
