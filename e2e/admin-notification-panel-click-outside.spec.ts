// Regression guard for the click-outside behaviour of the admin notification panel.
//
// The panel uses a `mousedown` listener on `document` (added while the panel is
// open) to detect clicks outside both:
//   - the bell button wrapper div (notificationBellRef), and
//   - the portal-rendered panel div (notificationPanelRef).
// Any mousedown that falls outside those two nodes calls
// `setIsNotificationsOpen(false)`.  A regression (e.g. a detached ref, a
// missing useEffect dependency, or a forgotten cleanup) would keep the panel
// open when the user clicks elsewhere.
//
// Three behaviours are covered:
//   1. Clicking outside the panel (top-left of viewport) closes it.
//   2. Clicking inside the panel does NOT close it.
//   3. Clicking the bell button again (toggle) closes the panel.
//
// Pattern follows admin-notification-panel-viewport.spec.ts:
//   - readAdminToken() reads the pre-fetched bearer token produced by global-setup.
//   - page.addInitScript() seeds it into sessionStorage before navigation so the
//     dashboard mounts authenticated without consuming a login rate-limit slot.
//   - Wait for button-notifications to be visible as the "dashboard up" signal.

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

function readAdminToken(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")) as {
      token?: string;
    };
    return raw.token ?? "";
  } catch {
    return "";
  }
}

async function loginAdminUi(page: import("@playwright/test").Page) {
  const token = readAdminToken();
  await page.addInitScript(
    (t) => {
      if (t) sessionStorage.setItem("adminToken", t);
    },
    token,
  );
  await page.goto("/admin");
  // The bell button is rendered in the header as soon as the authenticated
  // dashboard mounts — use it as the "ready" signal.
  await expect(page.getByTestId("button-notifications")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("Admin dashboard — notification panel click-outside behaviour", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests");
    }
  });

  test("clicking outside the panel closes it", async ({ page }) => {
    await loginAdminUi(page);

    // Open the notification panel.
    await page.getByTestId("button-notifications").click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Click the top-left corner of the viewport — always well outside the bell
    // button (top-right header) and the panel (which opens below the bell on
    // the right side).  The mousedown listener should fire and close the panel.
    await page.mouse.click(10, 10);

    await expect(panel).toHaveCount(0, { timeout: 5_000 });
  });

  test("clicking inside the panel does NOT close it", async ({ page }) => {
    await loginAdminUi(page);

    // Open the notification panel.
    await page.getByTestId("button-notifications").click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Click somewhere inside the panel's own bounding box.  Because the target
    // is contained by notificationPanelRef, the handler returns early and the
    // panel must stay open.
    await panel.click({ position: { x: 10, y: 10 } });

    // Give React time to flush any spurious state updates.
    await page.waitForTimeout(400);
    await expect(panel).toBeVisible();
  });

  test("clicking the bell button again closes the panel (toggle)", async ({
    page,
  }) => {
    await loginAdminUi(page);

    const bell = page.getByTestId("button-notifications");

    // First click — open.
    await bell.click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Second click — the bell's onClick toggles isNotificationsOpen to false.
    // The bell is inside notificationBellRef so the mousedown handler alone
    // would not close the panel, but the onClick handler does.
    await bell.click();

    await expect(panel).toHaveCount(0, { timeout: 5_000 });
  });

  test("clicking the X (close) button inside the panel header closes the panel", async ({
    page,
  }) => {
    await loginAdminUi(page);

    // Open the notification panel.
    await page.getByTestId("button-notifications").click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Click the X button in the panel header.  Its onClick calls onClose which
    // sets isNotificationsOpen to false — a separate code path from the
    // click-outside mousedown listener and the bell-button toggle.
    await page.getByTestId("button-notifications-close").click();

    await expect(panel).toHaveCount(0, { timeout: 5_000 });
  });
});
