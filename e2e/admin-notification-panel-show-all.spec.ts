// Regression guard for the "show all" affordance in the admin notification
// panel.
//
// `AdminNotificationsPanel` caps the initially-visible list at VISIBLE_LIMIT
// (10) entries. When more than 10 notifications exist a
// "Show all N notifications" button is rendered below the capped list.
// Clicking it expands the list to show every notification and removes the
// button.  A regression (e.g. a removed data-testid, a broken state update,
// or an off-by-one in the slice) would silently hide older notifications
// without any CI signal.
//
// What is tested:
//   Test 1 — button visibility and count label:
//   - Seed 12 admin notifications via POST /api/notifications.
//   - Open the panel and assert only 10 rows are initially visible.
//   - Assert the "Show all 12 notifications" button is visible (data-testid
//     "button-notifications-show-all") and carries the correct total count.
//   - Assert the panel header close button remains visible throughout.
//
//   Test 2 — expand interaction:
//   - After asserting the button is visible, click it.
//   - Assert the button disappears.
//   - Assert all 12 seeded notifications are now visible in the panel.
//   - Assert the panel header close button is still visible.
//
// Pattern follows admin-notification-panel-mark-read.spec.ts:
//   - readAdminToken() reads the pre-fetched bearer token from global-setup.
//   - page.addInitScript() seeds it into sessionStorage so the dashboard mounts
//     authenticated without consuming a login rate-limit slot.
//   - request.newContext({ baseURL }) is used for API seeding.

import { test, expect, request } from "@playwright/test";
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

async function loginAdminUi(
  page: import("@playwright/test").Page,
  token: string,
) {
  await page.addInitScript(
    (t) => {
      if (t) sessionStorage.setItem("adminToken", t);
    },
    token,
  );
  await page.goto("/admin");
  await expect(page.getByTestId("button-notifications")).toBeVisible({
    timeout: 30_000,
  });
}

/** Seed `count` distinct admin notifications and return their ids. */
async function seedNotifications(
  api: import("@playwright/test").APIRequestContext,
  token: string,
  count: number,
  tag: string,
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 1; i <= count; i++) {
    const res = await api.post("/api/notifications", {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      data: {
        recipientType: "admin",
        type: "case_update",
        title: `[${tag}] Show-all test notification #${i}`,
        body: `Seeded by the e2e test suite (${tag}, item ${i} of ${count}).`,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { id: number };
    expect(typeof body.id).toBe("number");
    ids.push(body.id);
  }
  return ids;
}

test.describe("Admin dashboard — notification panel show-all button", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests",
      );
    }
  });

  test("show-all button is visible with the correct count when more than 10 notifications exist", async ({
    page,
    baseURL,
  }) => {
    const token = readAdminToken();
    const api = await request.newContext({ baseURL });
    const SEED_COUNT = 12;
    const TAG = "show-all-visibility";

    // ---------------------------------------------------------------- seed
    await seedNotifications(api, token, SEED_COUNT, TAG);

    // --------------------------------------------------- load dashboard
    await loginAdminUi(page, token);

    // ------------------------------------------- open notification panel
    const bellButton = page.getByTestId("button-notifications");
    await bellButton.click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // ---- close button in header must be visible from the first moment
    const closeButton = page.getByTestId("button-notifications-close");
    await expect(closeButton).toBeVisible();

    // ---- the "show all" button must appear because we seeded 12 (> 10)
    const showAllButton = panel.getByTestId("button-notifications-show-all");
    await expect(showAllButton).toBeVisible({ timeout: 10_000 });

    // ---- the button label must include the total count (≥ 12)
    const buttonText = await showAllButton.textContent();
    expect(buttonText).toMatch(/Show all \d+ notifications/);
    const totalInLabel = parseInt(
      (buttonText ?? "").replace(/\D+(\d+)\D.*/, "$1"),
      10,
    );
    expect(totalInLabel).toBeGreaterThanOrEqual(SEED_COUNT);

    // ---- only 10 notification rows should be visible initially
    // Each notification is rendered as a clickable div inside the panel's
    // scrollable area; we count by the blue-500 dot (unread indicator) since
    // all seeded notifications are unread.
    const allRows = panel.locator("div.rounded-lg.cursor-pointer");
    const initialVisible = await allRows.count();
    expect(initialVisible).toBe(10);

    // ---- the header close button is still visible
    await expect(closeButton).toBeVisible();
  });

  test("clicking show-all expands the list and removes the button", async ({
    page,
    baseURL,
  }) => {
    const token = readAdminToken();
    const api = await request.newContext({ baseURL });
    const SEED_COUNT = 12;
    const TAG = "show-all-expand";

    // ---------------------------------------------------------------- seed
    await seedNotifications(api, token, SEED_COUNT, TAG);

    // --------------------------------------------------- load dashboard
    await loginAdminUi(page, token);

    // ------------------------------------------- open notification panel
    const bellButton = page.getByTestId("button-notifications");
    await bellButton.click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const closeButton = page.getByTestId("button-notifications-close");
    await expect(closeButton).toBeVisible();

    // ---- wait for the show-all button to appear
    const showAllButton = panel.getByTestId("button-notifications-show-all");
    await expect(showAllButton).toBeVisible({ timeout: 10_000 });

    // ------------------------------------------ click to expand
    await showAllButton.click();

    // ---- the show-all button must disappear after expanding
    await expect(showAllButton).toHaveCount(0, { timeout: 5_000 });

    // ---- all seeded notifications from this test run must now be in the DOM
    // We identify them by the unique tag embedded in each title.
    const taggedRows = panel.locator("div", {
      hasText: `[${TAG}] Show-all test notification`,
    });
    // There must be at least SEED_COUNT rows from this seed batch visible.
    // (Other existing notifications may also be present, so we use >=.)
    const expandedCount = await taggedRows.count();
    expect(expandedCount).toBeGreaterThanOrEqual(SEED_COUNT);

    // ---- the header close button must still be visible after expansion
    await expect(closeButton).toBeVisible();
  });
});
