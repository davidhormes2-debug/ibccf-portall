// Regression guard for the "mark as read" interaction in the admin
// notification panel.
//
// The `AdminNotificationsPanel` renders each notification as a clickable row.
// Clicking a row calls `onMarkRead(notification.id)` in AdminDashboard, which:
//   1. POSTs to /api/notifications/:id/read (sets isRead = true in the DB).
//   2. Calls loadNotifications() to re-fetch both the notification list and
//      the unread count badge.
//
// A regression (e.g. a broken API call, a detached callback, or a lost
// re-fetch) would leave the blue "unread" dot and the badge count unchanged
// after the click.
//
// What is tested:
//   Test 1 — single open-click-assert cycle:
//   - An unread notification seeded via POST /api/notifications appears in the
//     panel with the "unread" visual treatment (blue border + blue dot).
//   - Clicking that notification row fires onMarkRead and the panel re-renders:
//       • The number of unread rows in the panel decreases.
//       • The seeded notification no longer appears as unread.
//       • The bell badge either disappears or decrements.
//
//   Test 2 — close-and-reopen via X button:
//   - After marking a notification read in the first open, the panel is closed
//     via the X button and then reopened.
//   - The re-fetched list must still show the notification as read (no blue
//     border / blue dot) — a regression in loadNotifications or the read-state
//     persistence would only surface in this two-cycle flow.
//
//   Test 3 — close-and-reopen via click-outside:
//   - Same two-cycle flow as Test 2, but the panel is dismissed by clicking
//     the dashboard backdrop (outside the panel) rather than the X button.
//   - A bug in the click-outside dismiss path (e.g. not triggering a re-fetch
//     on close, or leaving stale state) would go undetected by Test 2 alone.
//
// Pattern follows admin-notification-panel-click-outside.spec.ts:
//   - readAdminToken() reads the pre-fetched bearer token from global-setup.
//   - page.addInitScript() seeds it into sessionStorage so the dashboard mounts
//     authenticated without consuming a login rate-limit slot.
//   - request.newContext({ baseURL }) is used for API seeding, following the
//     same approach used in admin-analytics-kpi-cards.spec.ts.

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

test.describe("Admin dashboard — notification panel mark-read", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests");
    }
  });

  test("clicking a notification row marks it as read and clears its unread indicator", async ({
    page,
    baseURL,
  }) => {
    const token = readAdminToken();

    // ---------------------------------------------------------------- seed
    // Create a fresh unread admin notification before loading the dashboard so
    // we have at least one item with the "unread" visual treatment to click.
    const api = await request.newContext({ baseURL });
    const seedRes = await api.post("/api/notifications", {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      data: {
        recipientType: "admin",
        type: "e2e_mark_read_test",
        title: "E2E mark-read regression test",
        body: "Seeded by the e2e test suite — clicking this row should mark it read.",
      },
    });
    expect(seedRes.ok()).toBeTruthy();
    const seeded = (await seedRes.json()) as { id: number };
    expect(typeof seeded.id).toBe("number");

    // --------------------------------------------------- load dashboard
    await loginAdminUi(page, token);

    // The bell button shows a badge (red dot with count) when there are unread
    // notifications.  We just seeded one, so the badge must be visible.
    const bellButton = page.getByTestId("button-notifications");
    const badge = bellButton.locator("span.bg-red-500");
    await expect(badge).toBeVisible({ timeout: 10_000 });

    // Capture the initial unread count so we can assert it decrements.
    const initialCountText = (await badge.textContent()) ?? "1";
    const initialCount = parseInt(initialCountText, 10) || 1;

    // ------------------------------------------- open notification panel
    await bellButton.click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Unread rows carry the blue border class.  Locate the seeded notification
    // by its title; it must appear with the unread treatment.
    const seededRow = panel.locator("div", {
      hasText: "E2E mark-read regression test",
    });
    await expect(seededRow.first()).toBeVisible({ timeout: 5_000 });

    // Assert the seeded row is currently styled as unread (has the blue border).
    // The unread class combo is: bg-blue-900/20 border border-blue-800/50.
    // We check for the blue dot (bg-blue-500) present inside the row.
    const blueDotInRow = seededRow.first().locator("div.bg-blue-500");
    await expect(blueDotInRow).toBeVisible();

    // Capture total unread row count before clicking so we can assert it shrank.
    const unreadSelector = "div.border.border-blue-800\\/50";
    const countBefore = await panel.locator(unreadSelector).count();
    expect(countBefore).toBeGreaterThanOrEqual(1);

    // -------------------------------------------- click to mark as read
    await seededRow.first().click();

    // The dashboard POSTs to /api/notifications/:id/read then calls
    // loadNotifications() which re-fetches the list + unread count.
    // After the re-fetch the seeded notification must no longer carry the
    // unread blue border.
    await expect
      .poll(
        () => panel.locator(unreadSelector).count(),
        { timeout: 10_000, intervals: [500] },
      )
      .toBeLessThan(countBefore);

    // Stronger: none of the remaining unread rows should contain our title.
    const remainingUnread = panel.locator(unreadSelector);
    const remainingCount = await remainingUnread.count();
    for (let i = 0; i < remainingCount; i++) {
      const text = await remainingUnread.nth(i).textContent();
      expect(text).not.toContain("E2E mark-read regression test");
    }

    // ------------------------------------------- badge decrements
    // The bell badge must now reflect a lower unread count (or be gone
    // entirely if this was the last unread notification).
    if (initialCount <= 1) {
      // Only one unread existed — the badge should disappear entirely.
      await expect(badge).toHaveCount(0, { timeout: 10_000 });
    } else {
      // Multiple unread existed — badge must show initialCount - 1.
      await expect
        .poll(
          async () => {
            const txt = await badge.textContent().catch(() => null);
            return txt !== null ? parseInt(txt, 10) : null;
          },
          { timeout: 10_000, intervals: [500] },
        )
        .toBeLessThan(initialCount);
    }
  });

  test("read status persists after the panel is closed and reopened", async ({
    page,
    baseURL,
  }) => {
    const token = readAdminToken();

    // ---------------------------------------------------------------- seed
    const api = await request.newContext({ baseURL });
    const seedRes = await api.post("/api/notifications", {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      data: {
        recipientType: "admin",
        type: "e2e_reopen_read_test",
        title: "E2E reopen-read regression test",
        body: "Seeded by the e2e suite — read state must survive a close+reopen.",
      },
    });
    expect(seedRes.ok()).toBeTruthy();
    const seeded = (await seedRes.json()) as { id: number };
    expect(typeof seeded.id).toBe("number");

    // --------------------------------------------------- load dashboard
    await loginAdminUi(page, token);

    const bellButton = page.getByTestId("button-notifications");
    const badge = bellButton.locator("span.bg-red-500");
    await expect(badge).toBeVisible({ timeout: 10_000 });

    // ---------------------------------------- first open: mark as read
    await bellButton.click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const seededRow = panel.locator("div", {
      hasText: "E2E reopen-read regression test",
    });
    await expect(seededRow.first()).toBeVisible({ timeout: 5_000 });

    // Confirm unread indicator is present before clicking.
    const blueDot = seededRow.first().locator("div.bg-blue-500");
    await expect(blueDot).toBeVisible();

    const unreadSelector = "div.border.border-blue-800\\/50";
    const countBefore = await panel.locator(unreadSelector).count();
    expect(countBefore).toBeGreaterThanOrEqual(1);

    // Click the row to mark it read; wait for re-fetch.
    await seededRow.first().click();
    await expect
      .poll(
        () => panel.locator(unreadSelector).count(),
        { timeout: 10_000, intervals: [500] },
      )
      .toBeLessThan(countBefore);

    // ----------------------------------------- close the panel via X
    await page.getByTestId("button-notifications-close").click();
    await expect(panel).toBeHidden({ timeout: 5_000 });

    // ----------------------------------------- reopen the panel
    await bellButton.click();
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // The previously-read notification must not appear with the blue dot.
    const reopenedRow = panel.locator("div", {
      hasText: "E2E reopen-read regression test",
    });
    await expect(reopenedRow.first()).toBeVisible({ timeout: 5_000 });

    // No blue dot should exist inside the row after reopen.
    const blueDotAfterReopen = reopenedRow.first().locator("div.bg-blue-500");
    await expect(blueDotAfterReopen).toHaveCount(0, { timeout: 5_000 });

    // The row element itself must not carry the unread border class.
    // Query within the panel for a div that both has the unread-border class
    // AND contains the notification title — if none exist the row is read.
    const unreadRowWithTitle = panel.locator("div.border.border-blue-800\\/50", {
      hasText: "E2E reopen-read regression test",
    });
    await expect(unreadRowWithTitle).toHaveCount(0, { timeout: 5_000 });
  });

  test("read status persists after the panel is dismissed by clicking outside it", async ({
    page,
    baseURL,
  }) => {
    const token = readAdminToken();

    // ---------------------------------------------------------------- seed
    const api = await request.newContext({ baseURL });
    const seedRes = await api.post("/api/notifications", {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      data: {
        recipientType: "admin",
        type: "e2e_clickoutside_read_test",
        title: "E2E click-outside-read regression test",
        body: "Seeded by the e2e suite — read state must survive a click-outside dismiss.",
      },
    });
    expect(seedRes.ok()).toBeTruthy();
    const seeded = (await seedRes.json()) as { id: number };
    expect(typeof seeded.id).toBe("number");

    // --------------------------------------------------- load dashboard
    await loginAdminUi(page, token);

    const bellButton = page.getByTestId("button-notifications");
    const badge = bellButton.locator("span.bg-red-500");
    await expect(badge).toBeVisible({ timeout: 10_000 });

    // ---------------------------------------- first open: mark as read
    await bellButton.click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const seededRow = panel.locator("div", {
      hasText: "E2E click-outside-read regression test",
    });
    await expect(seededRow.first()).toBeVisible({ timeout: 5_000 });

    // Confirm unread indicator is present before clicking.
    const blueDot = seededRow.first().locator("div.bg-blue-500");
    await expect(blueDot).toBeVisible();

    const unreadSelector = "div.border.border-blue-800\\/50";
    const countBefore = await panel.locator(unreadSelector).count();
    expect(countBefore).toBeGreaterThanOrEqual(1);

    // Click the row to mark it read; wait for re-fetch.
    await seededRow.first().click();
    await expect
      .poll(
        () => panel.locator(unreadSelector).count(),
        { timeout: 10_000, intervals: [500] },
      )
      .toBeLessThan(countBefore);

    // ----------------------------------------- dismiss via click-outside
    // The AdminDashboard attaches a `mousedown` listener on `document` that
    // closes the panel when the click target is outside both the bell ref and
    // the panel ref.  Clicking at (50, 500) — far left, mid-page — reliably
    // lands outside the panel, which is always anchored near the top-right
    // corner of the viewport.
    await page.mouse.click(50, 500);
    await expect(panel).toBeHidden({ timeout: 5_000 });

    // ----------------------------------------- reopen the panel
    await bellButton.click();
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // The previously-read notification must not appear with the blue dot.
    const reopenedRow = panel.locator("div", {
      hasText: "E2E click-outside-read regression test",
    });
    await expect(reopenedRow.first()).toBeVisible({ timeout: 5_000 });

    // No blue dot should exist inside the row after reopen.
    const blueDotAfterReopen = reopenedRow.first().locator("div.bg-blue-500");
    await expect(blueDotAfterReopen).toHaveCount(0, { timeout: 5_000 });

    // The row must not carry the unread border class.
    const unreadRowWithTitle = panel.locator("div.border.border-blue-800\\/50", {
      hasText: "E2E click-outside-read regression test",
    });
    await expect(unreadRowWithTitle).toHaveCount(0, { timeout: 5_000 });
  });
});
