// Regression guard for the viewport-clamp fix on the admin notification panel.
//
// The panel is rendered via createPortal into document.body with `position:
// fixed` and its position is computed from the bell button's bounding rect.
// The clamping logic in AdminDashboard ensures the panel never overflows the
// left or right viewport edge, even on narrow screens (< 320 px), and never
// overflows the bottom viewport edge, even on very short screens.
//
// Test 1: opens the dashboard at a 320 px wide viewport, clicks the
// notification bell, then asserts that the panel's bounding box stays
// entirely within [0, viewportWidth].
//
// Test 2: opens the dashboard at a 400 px tall viewport, clicks the
// notification bell, then asserts that panelBottom <= viewportHeight.
//
// Pattern follows Task #545 (admin-weak-session-secret-banner.spec.ts):
//   - readAdminToken() reads the pre-fetched bearer token from global-setup
//   - page.addInitScript() seeds it into sessionStorage before navigation so
//     the dashboard mounts without hitting the login form (zero rate-limit
//     slots used).

import { test, expect } from "@playwright/test";
import { readAdminToken } from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const NARROW_VIEWPORT_WIDTH = 320;
const NARROW_VIEWPORT_HEIGHT = 700;

const SHORT_VIEWPORT_WIDTH = 800;
const SHORT_VIEWPORT_HEIGHT = 400;

test.describe("Admin dashboard — notification panel stays within viewport on narrow screens", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests");
    }
  });

  test("notification panel bounding box does not overflow the viewport at 320 px width", async ({
    page,
  }) => {
    await page.setViewportSize({
      width: NARROW_VIEWPORT_WIDTH,
      height: NARROW_VIEWPORT_HEIGHT,
    });

    const token = readAdminToken();
    await page.addInitScript(
      (t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      },
      token,
    );

    await page.goto("/admin");

    // Wait until the dashboard is fully mounted and the notification bell is
    // interactive.  The bell button is rendered in the header alongside
    // admin-case-finder-trigger.
    await expect(page.getByTestId("button-notifications")).toBeVisible({
      timeout: 30_000,
    });

    // Open the notification panel.
    await page.getByTestId("button-notifications").click();

    // Wait for the portal-rendered panel to appear in the DOM.
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Assert the panel stays within the viewport horizontally.
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      const panelLeft = box.x;
      const panelRight = box.x + box.width;

      expect(panelLeft).toBeGreaterThanOrEqual(0);
      expect(panelRight).toBeLessThanOrEqual(NARROW_VIEWPORT_WIDTH);
    }
  });

  test("notification panel bottom edge does not overflow the viewport at 400 px height", async ({
    page,
  }) => {
    await page.setViewportSize({
      width: SHORT_VIEWPORT_WIDTH,
      height: SHORT_VIEWPORT_HEIGHT,
    });

    const token = readAdminToken();
    await page.addInitScript(
      (t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      },
      token,
    );

    await page.goto("/admin");

    // Wait until the dashboard is fully mounted and the notification bell is
    // interactive.
    await expect(page.getByTestId("button-notifications")).toBeVisible({
      timeout: 30_000,
    });

    // Open the notification panel.
    await page.getByTestId("button-notifications").click();

    // Wait for the portal-rendered panel to appear in the DOM.
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Assert the panel's bottom edge stays within the viewport vertically.
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      const panelBottom = box.y + box.height;
      expect(panelBottom).toBeLessThanOrEqual(SHORT_VIEWPORT_HEIGHT);
    }
  });

  test("close button and panel header remain accessible on a 400 px tall viewport", async ({
    page,
  }) => {
    // This test guards against the double-scroll regression: the outer portal
    // div must have overflow:hidden (delegating scroll inward) so the
    // sticky panel header — and its close button — are never pushed off screen
    // by its own container's scroll position.
    await page.setViewportSize({
      width: SHORT_VIEWPORT_WIDTH,
      height: SHORT_VIEWPORT_HEIGHT,
    });

    const token = readAdminToken();
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

    await page.getByTestId("button-notifications").click();

    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // The outer portal div must delegate scrolling inward (overflow:hidden),
    // not scroll itself, so the header is always at the top of the panel.
    const outerOverflow = await panel.evaluate(
      (el) => getComputedStyle(el).overflow,
    );
    expect(outerOverflow).toBe("hidden");

    // The close button lives in the sticky header — it must be visible and its
    // bounding box must be within the viewport even on a 400 px tall screen.
    const closeBtn = page.getByTestId("button-notifications-close");
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });

    const closeBtnBox = await closeBtn.boundingBox();
    expect(closeBtnBox).not.toBeNull();
    if (closeBtnBox) {
      // Top of the close button is above the viewport bottom.
      expect(closeBtnBox.y).toBeLessThan(SHORT_VIEWPORT_HEIGHT);
      // Close button bottom is within the viewport.
      expect(closeBtnBox.y + closeBtnBox.height).toBeLessThanOrEqual(
        SHORT_VIEWPORT_HEIGHT,
      );
    }

    // Clicking the close button must still work (i.e. it is not obscured).
    await closeBtn.click();
    await expect(panel).toHaveCount(0, { timeout: 5_000 });
  });
});
