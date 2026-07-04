/**
 * e2e/admin-portal-warning-expiry-notification.spec.ts
 *
 * Regression guard: when the portal-warning expiry sweep auto-disables a case,
 * it must create a `portal_warning_expired` admin notification that appears in
 * the AdminNotificationsPanel.
 *
 * Unit tests in server/__tests__/portalWarningExpirySweep.test.ts verify the
 * sweep logic in isolation (mocked DB + NotificationService).  This spec
 * catches integration-level regressions — e.g. a DB schema mismatch or missing
 * NotificationService wiring — by booting the real server, seeding real data,
 * and asserting the notification is visible in the dashboard UI.
 *
 * Flow:
 *   1. Create a case and set a 1-minute portal-closure warning via the admin API.
 *   2. Rewind `portal_warning_at` in the DB so the warning is already expired
 *      (same backdating technique as the portal auto-logout E2E test).
 *   3. POST /api/admin/portal-warning-expiry-sweep/run to trigger the sweep
 *      on demand (no 5-minute wait needed).
 *   4. Log into the admin dashboard via the token-injection shortcut.
 *   5. Open the notifications panel and assert a "Case Disabled: Portal Warning
 *      Expired" notification is visible.
 *
 * Data lifecycle:
 *   One case is created in beforeAll and deleted in afterAll.  The sweep
 *   disables the case; teardown deletes it regardless.  DATABASE_URL is
 *   required (same as portal auto-logout E2E); throws in beforeAll when absent.
 */

import { test, expect, request } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  deleteCase,
  loginAdminUi,
  clearAdminRateLimit,
  backdatePortalWarning,
  localTimeout,
} from "./helpers";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Portal-warning expiry sweep — admin notification E2E", () => {
  let accessCode: string;
  let caseId: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the portal-warning expiry notification e2e test",
      );
    }
    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL must be set to run the portal-warning expiry notification e2e test " +
          "(required for backdatePortalWarning so the sweep finds an already-expired warning)",
      );
    }

    await clearAdminRateLimit(DATABASE_URL);

    accessCode = uniqueAccessCode("E2EEXPIRY");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Portal Expiry Notification E2E",
        extraPatch: { withdrawalStage: "1" },
      });

      // Set a 1-minute portal-closure warning on the case.
      const warningRes = await api.post(
        `/api/cases/${caseId}/portal-warning`,
        {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
          data: { minutes: 1, portalMessage: "E2E expiry sweep test — auto-closing" },
        },
      );
      expect(warningRes.status(), "set portal warning").toBe(200);

      // Rewind portal_warning_at by 90 seconds so the 1-minute warning is
      // definitively in the past — the sweep's SQL condition evaluates as:
      //   portalWarningAt + 1 minute <= now
      // With 90 s of backdating: (now - 90s) + 60s = now - 30s <= now  ✓
      await backdatePortalWarning(DATABASE_URL, caseId, 90);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseId) return;
    const api = await request.newContext({ baseURL });
    try {
      await deleteCase(api, adminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(localTimeout(120_000));

  test(
    "sweep auto-disables the case and the portal_warning_expired notification appears in the admin panel",
    async ({ page, baseURL }) => {
      const api = await request.newContext({ baseURL });
      try {
        // ── Step 1: trigger the sweep on demand ──────────────────────────────
        // POST /api/admin/portal-warning-expiry-sweep/run runs the sweep
        // synchronously and returns { processed, skipped }.  We assert processed
        // >= 1 to catch a regression where the sweep finds no expired rows (e.g.
        // schema mismatch, SQL condition drift, or backdating failure).
        const sweepRes = await api.post(
          "/api/admin/portal-warning-expiry-sweep/run",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        );
        expect(sweepRes.status(), "sweep trigger").toBe(200);
        const sweepBody = (await sweepRes.json()) as {
          processed: number;
          skipped: boolean;
        };
        expect(
          sweepBody.processed,
          "sweep must have processed at least one expired case",
        ).toBeGreaterThanOrEqual(1);
        expect(sweepBody.skipped, "sweep must not have been skipped").toBe(
          false,
        );
      } finally {
        await api.dispose();
      }

      // ── Step 2: load the admin dashboard ─────────────────────────────────
      // Token-injection shortcut: zero rate-limit slots consumed.
      await loginAdminUi(page);

      // ── Step 3: open the notifications panel ──────────────────────────────
      const bellButton = page.getByTestId("button-notifications");
      await expect(bellButton).toBeVisible({ timeout: 15_000 });

      // The sweep creates a notification synchronously before returning, so
      // the bell badge should be visible immediately after the dashboard loads.
      const badge = bellButton.locator("span.bg-red-500");
      await expect(badge).toBeVisible({ timeout: 10_000 });

      await bellButton.click();
      const panel = page.getByTestId("notification-panel");
      await expect(panel).toBeVisible({ timeout: 10_000 });

      // ── Step 4: assert the expiry notification is present ─────────────────
      // The sweep calls notificationService.notifyAdmin with:
      //   title = "Case Disabled: Portal Warning Expired"
      //   body  = "Case <id> was automatically disabled …"
      // We match on the title text which is always present in the panel row.
      const expiryRow = panel.locator("div", {
        hasText: "Case Disabled: Portal Warning Expired",
      });
      await expect(expiryRow.first()).toBeVisible({ timeout: 10_000 });

      // Stronger: the body should mention the specific case id.
      const rowText = await expiryRow.first().textContent();
      expect(rowText).toContain(caseId);
    },
  );
});
