/**
 * e2e/admin-portal-warning.spec.ts
 *
 * End-to-end tests for the admin portal closure warning feature.
 *
 * Flow under test (set warning):
 *   1. Seed a test case and enrol a PIN so the portal can be reached.
 *   2. Log into the admin dashboard via the token-injection shortcut.
 *   3. Use AdminCaseFinder to open the case, navigate to the Communications
 *      tab, and send a portal closure warning via AdminPortalWarningPanel.
 *   4. Open the user portal in a second page and assert that the
 *      PortalWarningOverlay (role="alertdialog") is visible and contains the
 *      custom message.
 *
 * Flow under test (clear warning):
 *   1. Seed the same test case (shared beforeAll).
 *   2. Set a warning via the admin API so the portal is already showing the
 *      overlay when the test starts.
 *   3. Log into the portal and confirm the overlay is present.
 *   4. Switch to the admin dashboard, open the Communications tab, and click
 *      "Cancel Warning".
 *   5. Reload the portal page and assert the overlay is gone.
 *
 * Data lifecycle
 * ─────────────
 * One case is created in beforeAll and removed in afterAll.  A unique random
 * suffix prevents collisions between parallel CI runs.  Any leftover portal
 * warning is cancelled in afterAll so teardown is clean regardless of which
 * test ran last.
 */

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  issuePortalSession,
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

const TEST_PIN = "112233";

// ─────────────────────────────────────────────────────────────────────────────

async function loginPortalUi(
  page: import("@playwright/test").Page,
  accessCode: string,
  pin: string,
): Promise<void> {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

  await page.getByTestId("input-access-code").fill(accessCode);
  await page.getByTestId("button-login").click();

  await expect(page.getByTestId("input-pin")).toBeVisible({ timeout: 12_000 });
  await page.getByTestId("input-pin").fill(pin);
  await page.getByTestId("button-login").click();

  await expect(page.getByTestId("button-logout")).toBeVisible({
    timeout: 20_000,
  });
}

async function openCaseInAdmin(
  page: import("@playwright/test").Page,
  accessCode: string,
  caseId: string,
): Promise<void> {
  await loginAdminUi(page);

  await page.getByTestId("admin-case-finder-trigger").click();
  await page.getByTestId("admin-case-finder-input").fill(accessCode);
  await page
    .getByTestId(`admin-case-finder-result-${caseId}`)
    .click();
}

async function setWarningViaApi(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
  message: string,
  minutes = 10,
): Promise<void> {
  const res = await api.post(`/api/cases/${caseId}/portal-warning`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    data: { minutes, portalMessage: message },
  });
  expect(res.status(), "set warning via API").toBe(200);
}

async function cancelWarningViaApi(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  await api.delete(`/api/cases/${caseId}/portal-warning`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin portal closure warning — E2E", () => {
  let accessCode: string;
  let caseId: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run portal warning e2e tests",
      );
    }

    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    accessCode = uniqueAccessCode("E2EPWARN");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Portal Warning E2E",
        extraPatch: { withdrawalStage: "1" },
      });
      await issuePortalSession(api, accessCode, TEST_PIN);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseId) return;
    const api = await request.newContext({ baseURL });
    try {
      await cancelWarningViaApi(api, adminToken, caseId);
      await deleteCase(api, adminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(localTimeout(120_000));

  // ── Test 1: admin sets a warning → overlay appears in portal ─────────────

  test("setting a portal warning via admin UI shows the closure overlay in the user portal", async ({
    page,
    baseURL,
  }) => {
    await openCaseInAdmin(page, accessCode, caseId);

    await page.getByTestId("case-tab-communications").click({ force: true });

    await expect(page.getByTestId("panel-portal-warning")).toBeVisible({
      timeout: 10_000,
    });

    const warningMessage = "E2E test closure warning — please log out";
    await page
      .getByTestId("input-portal-warning-message")
      .fill(warningMessage);
    await page.getByTestId("button-send-portal-warning").click();

    await expect(
      page.getByTestId("button-cancel-portal-warning"),
    ).toBeVisible({ timeout: 10_000 });

    const portalPage = await page.context().newPage();
    try {
      await loginPortalUi(portalPage, accessCode, TEST_PIN);

      const overlay = portalPage.locator('[role="alertdialog"]');
      await expect(overlay).toBeVisible({ timeout: 10_000 });
      await expect(overlay).toContainText(warningMessage);
    } finally {
      await portalPage.close();
    }

    const api = await request.newContext({ baseURL });
    try {
      await cancelWarningViaApi(api, adminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  // ── Test 3: email audit log entry appears after warning is sent ───────────

  test("sending a portal warning via admin UI records an email dispatch entry in the per-case email audit log", async ({
    page,
    baseURL,
  }) => {
    // Capture a time reference before the action so polling only inspects
    // entries created by this specific send (not historical ones).
    const beforeSend = Date.now();

    await openCaseInAdmin(page, accessCode, caseId);
    await page.getByTestId("case-tab-communications").click({ force: true });

    await expect(page.getByTestId("panel-portal-warning")).toBeVisible({
      timeout: 10_000,
    });

    await page
      .getByTestId("input-portal-warning-message")
      .fill("E2E email audit log test — portal closing soon");
    await page.getByTestId("button-send-portal-warning").click();

    // Wait for the server round-trip to complete: the cancel button only
    // appears once the POST /portal-warning response returns 200.
    await expect(
      page.getByTestId("button-cancel-portal-warning"),
    ).toBeVisible({ timeout: 10_000 });

    // The email is dispatched via setImmediate (fire-and-forget). Poll the
    // per-case email audit log until an entry created after `beforeSend`
    // appears (up to ~10 s / 20 attempts at 500 ms intervals).
    const api = await request.newContext({ baseURL });
    try {
      let found = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await api.get(`/api/cases/${caseId}/email-audit-logs`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(res.status(), "fetch per-case email audit logs").toBe(200);
        const logs = (await res.json()) as Array<{
          action: string;
          createdAt: string;
        }>;
        found = logs.some(
          (entry) =>
            (entry.action === "email_portal_warning" ||
              entry.action === "email_portal_warning_failed") &&
            new Date(entry.createdAt).getTime() >= beforeSend,
        );
        if (found) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }

      expect(
        found,
        "an email_portal_warning (or _failed) audit entry must appear in the per-case email audit log for an entry created after the admin UI send",
      ).toBe(true);
    } finally {
      await cancelWarningViaApi(api, adminToken, caseId);
      await api.dispose();
    }
  });

  // ── Test 2: admin clears warning → overlay disappears from portal ─────────

  test("clearing a portal warning via admin UI removes the closure overlay from the user portal", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    try {
      await setWarningViaApi(
        api,
        adminToken,
        caseId,
        "E2E cancel test — this warning will be cleared",
      );
    } finally {
      await api.dispose();
    }

    const portalPage = await page.context().newPage();
    try {
      await loginPortalUi(portalPage, accessCode, TEST_PIN);

      const overlay = portalPage.locator('[role="alertdialog"]');
      await expect(overlay).toBeVisible({ timeout: 10_000 });

      await openCaseInAdmin(page, accessCode, caseId);

      await page.getByTestId("case-tab-communications").click({ force: true });

      await expect(
        page.getByTestId("button-cancel-portal-warning"),
      ).toBeVisible({ timeout: 10_000 });
      await page.getByTestId("button-cancel-portal-warning").click();

      await expect(
        page.getByTestId("button-send-portal-warning"),
      ).toBeVisible({ timeout: 10_000 });

      // The portal polls every 5 s when a warning is active; after cancellation
      // it will detect the change on the next poll cycle.  Reload to guarantee
      // fresh data rather than waiting for the polling interval.
      await portalPage.reload({ waitUntil: "domcontentloaded" });
      await expect(portalPage.getByTestId("button-logout")).toBeVisible({
        timeout: 20_000,
      });

      await expect(overlay).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await portalPage.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-logout after warning timer expires
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Backdating strategy: the admin API always sets portalWarningAt = NOW(), so a
 * 1-minute warning would require a real 60-second wait.  Instead we rewind
 * portalWarningAt in the DB directly (same technique as clearAdminRateLimit)
 * to make the warning expire in ~25 seconds from the moment of setup.  This
 * keeps the test fast while exercising the real production code path:
 *
 *   usePortalAutoLogout (setTimeout) → PortalContext.logout() → navigate("/")
 *
 * The auto-logout fires even when the user has already dismissed the overlay,
 * which is the regression scenario this test guards against.
 */
test.describe("Portal closure warning — auto-logout on timer expiry", () => {
  let accessCode: string;
  let caseId: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run portal warning auto-logout e2e tests",
      );
    }

    // backdatePortalWarning is a no-op when DATABASE_URL is absent, which
    // would leave the warning with a full 60-second countdown and cause the
    // waitForURL assertion to time out. Fail fast so the issue is obvious.
    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL must be set to run the portal warning auto-logout e2e test " +
          "(required for backdatePortalWarning)",
      );
    }

    await clearAdminRateLimit(DATABASE_URL);

    accessCode = uniqueAccessCode("E2EPWAL");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Portal Auto-Logout E2E",
        extraPatch: { withdrawalStage: "1" },
      });
      await issuePortalSession(api, accessCode, TEST_PIN);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseId) return;
    const api = await request.newContext({ baseURL });
    try {
      await cancelWarningViaApi(api, adminToken, caseId);
      await deleteCase(api, adminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(localTimeout(120_000));

  test("auto-logout fires when the countdown expires even after the overlay is dismissed", async ({
    page,
    baseURL,
  }) => {
    // Step 1: set a 1-minute warning via the admin API.
    const api = await request.newContext({ baseURL });
    try {
      await setWarningViaApi(
        api,
        adminToken,
        caseId,
        "E2E auto-logout test — portal closing soon",
        1,
      );
    } finally {
      await api.dispose();
    }

    // Step 2: rewind portalWarningAt so the warning expires ~25 s from now
    // instead of the full 60 s.  Login takes up to ~20 s in CI, leaving at
    // least 5 s of countdown visible after the portal renders, then the
    // auto-logout fires within the 30 s waitForURL budget.
    await backdatePortalWarning(DATABASE_URL, caseId, 35);

    // Step 3: log into the portal.  The overlay appears because the warning is
    // still active (expiry is ~25 s in the future).
    await loginPortalUi(page, accessCode, TEST_PIN);

    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });

    // Step 4: dismiss the overlay — this hides the UI but does NOT cancel the
    // auto-logout timer inside usePortalAutoLogout.
    await page.getByRole("button", { name: /dismiss/i }).click();
    await expect(overlay).not.toBeVisible({ timeout: 5_000 });

    // After dismissal the PortalWarningContactChip renders when Tawk.to is
    // configured.  In this CI job VITE_TAWKTO_PROPERTY_ID / VITE_TAWKTO_WIDGET_ID
    // are empty, so isTawktoConfigured() returns false and the chip must be absent.
    await expect(
      page.getByTestId("warning-dismissed-contact-support"),
    ).not.toBeVisible();

    // Confirm the user is still authenticated (not yet logged out).
    await expect(page.getByTestId("button-logout")).toBeVisible();

    // Step 5: wait for the auto-logout to fire.  usePortalAutoLogout sets a
    // setTimeout for the remaining milliseconds and calls PortalContext.logout()
    // when it fires, which calls navigate("/").  Allow 30 s for this to happen.
    await page.waitForURL("/", { timeout: 30_000 });

    // Step 6: verify the user is fully logged out — the portal controls are gone.
    await expect(page.getByTestId("button-logout")).not.toBeVisible({
      timeout: 5_000,
    });
  });

  // ── Test: warning set while user is already in the portal (null → active → expired) ──

  /**
   * Exercises the null → active → expired transition in a single session.
   * The two sibling tests set the warning *before* the user logs in; this test
   * sets it *while* the user is already viewing the portal, so the portal must
   * detect the change through its normal polling cycle (every 30 s when no
   * warning is active).  The overlay then appears, is left visible, and the
   * auto-logout fires when the countdown reaches zero.
   */
  test("auto-logout fires when a warning is set while the user is already viewing the portal (null → active → expired)", async ({
    page,
    baseURL,
  }) => {
    // Step 1: log into the portal — no warning is active at this point.
    await loginPortalUi(page, accessCode, TEST_PIN);

    // Confirm the user is authenticated and no overlay is shown.
    await expect(page.getByTestId("button-logout")).toBeVisible();
    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toHaveCount(0);

    // Step 2: set a 5-minute warning via the admin API while the user is
    // already in the portal, then immediately backdate it so only ~70 s remain.
    // The portal polls every 30 s when no warning is active, so the transition
    // from null → active will be detected within the next poll cycle.
    //
    //   5 min = 300 s total.  Backdate 230 s → 70 s remaining.
    const api = await request.newContext({ baseURL });
    try {
      await setWarningViaApi(
        api,
        adminToken,
        caseId,
        "E2E mid-session warning — portal closing soon",
        5,
      );
    } finally {
      await api.dispose();
    }

    await backdatePortalWarning(DATABASE_URL, caseId, 230);

    // Step 3: wait for the portal polling to detect the newly-set warning and
    // render the overlay.  The 30-second poll interval means the overlay may
    // take up to ~30 s to appear after the backdate.
    await expect(overlay).toBeVisible({ timeout: 40_000 });

    // Step 4: do NOT dismiss the overlay — leave it visible.  Confirm the
    // user is still authenticated (logout button is still present).
    await expect(page.getByTestId("button-logout")).toBeVisible();

    // Step 5: wait for auto-logout to fire.  The warning expires ~70 s after
    // the backdate; the overlay appears within ≤35 s of that, leaving ≥35 s
    // of countdown.  Both usePortalAutoLogout (setTimeout) and the overlay's
    // own useEffect will call logout() — allow 50 s for the navigation to "/".
    await page.waitForURL("/", { timeout: 50_000 });

    // Step 6: confirm the user is fully logged out.
    await expect(page.getByTestId("button-logout")).not.toBeVisible({
      timeout: 5_000,
    });
  });

  // ── Test: overlay stays visible → UI-layer expiry effect fires logout ──────

  /**
   * Exercises the PortalWarningOverlay.tsx useEffect safety net (the
   * `msLeft === 0` branch at line ~77) rather than the dismissed-overlay path.
   *
   * When the user leaves the overlay open and the countdown ticks to zero, the
   * component's own useEffect calls logout() — independently of the
   * usePortalAutoLogout setTimeout in PortalContext.  Both mechanisms fire in
   * production; this test ensures the UI-layer path is not silently broken.
   */
  test("auto-logout fires when the countdown expires while the overlay is still visible (not dismissed)", async ({
    page,
    baseURL,
  }) => {
    // Step 1: set a 1-minute warning via the admin API.
    const api = await request.newContext({ baseURL });
    try {
      await setWarningViaApi(
        api,
        adminToken,
        caseId,
        "E2E active-overlay auto-logout test — do not dismiss",
        1,
      );
    } finally {
      await api.dispose();
    }

    // Step 2: rewind portalWarningAt so the warning expires ~25 s from now.
    // Same budget as the dismissed-overlay test: login uses up to ~20 s in CI,
    // leaving ≥5 s of countdown before expiry triggers logout.
    await backdatePortalWarning(DATABASE_URL, caseId, 35);

    // Step 3: log in.  The overlay renders because the warning is still active.
    await loginPortalUi(page, accessCode, TEST_PIN);

    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });

    // Step 4: do NOT dismiss the overlay.  Confirm the user is authenticated
    // and the overlay is showing — this is the distinguishing condition.
    await expect(page.getByTestId("button-logout")).toBeVisible();

    // Step 5: wait for the UI-layer expiry effect to fire logout.
    // PortalWarningOverlay's useEffect calls logout() once msLeft reaches 0
    // after having been positive, which navigates to "/".  Allow 30 s.
    await page.waitForURL("/", { timeout: 30_000 });

    // Step 6: verify the portal controls are gone — user is fully logged out.
    await expect(page.getByTestId("button-logout")).not.toBeVisible({
      timeout: 5_000,
    });
  });
});
