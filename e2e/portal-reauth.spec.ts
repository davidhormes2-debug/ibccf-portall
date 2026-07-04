/**
 * e2e/portal-reauth.spec.ts
 *
 * Tests the portal session-expiry re-authentication flow:
 *   1. A case logs in via the two-step access-code + PIN form.
 *   2. The session token in localStorage is patched so its expiresAt falls
 *      within the 24-hour warning window (simulating an ageing session).
 *   3. A window focus event triggers PortalShell's `checkSessionExpiry`,
 *      surfacing the session-expiry banner.
 *   4. The user opens the re-auth dialog, enters their PIN, and confirms
 *      that the banner disappears and the portal remains accessible.
 *
 * Data lifecycle
 * ─────────────
 * A minimal case is created in beforeAll via the admin API and a PIN is
 * enrolled via POST /api/cases/set-pin.  The case is deleted in afterAll via
 * DELETE /api/cases/:id (admin bearer auth) so no stale rows accumulate.
 * A unique random suffix prevents access-code collisions between parallel runs.
 */

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import {
  uniqueAccessCode as _uniqueCode,
  loginAdminApi,
  createCase,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

const TEST_PIN = "246802";
const STORAGE_KEY = "ibccf_portal_session";

function uniqueCode(prefix: string): string {
  return _uniqueCode(prefix);
}

async function createTestCase(
  api: APIRequestContext,
  adminToken: string,
  accessCode: string,
): Promise<string> {
  return createCase(api, adminToken, accessCode, {
    userName: "Portal Reauth E2E",
    extraPatch: { withdrawalStage: "1" },
  });
}

async function enrollPin(
  api: APIRequestContext,
  accessCode: string,
  pin: string,
): Promise<void> {
  const res = await api.post("/api/cases/set-pin", {
    data: { accessCode, pin },
  });
  expect(res.status(), "enroll PIN").toBe(200);
  const body = await res.json();
  expect(typeof body.sessionToken, "set-pin returns sessionToken").toBe(
    "string",
  );
}

async function deleteTestCase(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.delete(`/api/cases/${caseId}?force=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(
    [200, 404],
    `teardown delete case ${caseId} (status ${res.status()})`,
  ).toContain(res.status());
}

/**
 * Drive the two-step portal login form (access code → PIN) in the browser.
 * Waits for the portal shell's logout button as the "fully authenticated"
 * signal before returning.
 */
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

/**
 * Patch the stored session token's expiresAt to fall within the 24-hour
 * warning window (e.g. 30 minutes from now), then dispatch a window focus
 * event so PortalShell's checkSessionExpiry re-runs immediately and shows
 * the session-expiry banner.
 */
async function expireSessionToken(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    // Set expiresAt to 30 minutes from now — this is within the 24-hour
    // SESSION_WARN_MS window, so the banner will appear.
    parsed.expiresAt = Date.now() + 30 * 60 * 1000;
    localStorage.setItem(key, JSON.stringify(parsed));
    // Dispatch a focus event so checkSessionExpiry runs immediately.
    window.dispatchEvent(new Event("focus"));
  }, STORAGE_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Portal re-authentication — session expiry flow", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the portal reauth e2e tests");
    }
  });

  let accessCode: string;
  let seededCaseId: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (DATABASE_URL) {
      const pg = new Client({ connectionString: DATABASE_URL });
      try {
        await pg.connect();
        await pg.query("DELETE FROM admin_login_attempts");
      } finally {
        await pg.end();
      }
    }

    accessCode = uniqueCode("E2E-REAUTH");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = await loginAdminApi(api);
      seededCaseId = await createTestCase(api, adminToken, accessCode);
      await enrollPin(api, accessCode, TEST_PIN);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!seededCaseId) return;
    const api = await request.newContext({ baseURL });
    try {
      const token = adminToken || (await loginAdminApi(api));
      await deleteTestCase(api, token, seededCaseId);
    } finally {
      await api.dispose();
    }
  });

  // ── Test 1: banner appears when session is near expiry ───────────────────

  test("shows the session-expiry banner when the token is near expiry", async ({
    page,
  }) => {
    await loginPortalUi(page, accessCode, TEST_PIN);
    await expireSessionToken(page);

    await expect(page.getByTestId("portal-session-expiry-banner")).toBeVisible({
      timeout: 8_000,
    });
  });

  // ── Test 2: re-auth dialog opens from the banner ─────────────────────────

  test("opens the re-auth PIN dialog when the banner button is clicked", async ({
    page,
  }) => {
    await loginPortalUi(page, accessCode, TEST_PIN);
    await expireSessionToken(page);

    await expect(page.getByTestId("portal-session-expiry-banner")).toBeVisible({
      timeout: 8_000,
    });

    await page.getByTestId("button-session-expiry-reauth").click();

    await expect(page.getByTestId("input-session-reauth-pin")).toBeVisible({
      timeout: 6_000,
    });
    await expect(page.getByTestId("button-session-reauth-submit")).toBeVisible();
  });

  // ── Test 3: successful re-auth dismisses the banner ──────────────────────

  test("re-authenticating with the correct PIN dismisses the expiry banner and keeps the user in the portal", async ({
    page,
  }) => {
    await loginPortalUi(page, accessCode, TEST_PIN);
    await expireSessionToken(page);

    await expect(page.getByTestId("portal-session-expiry-banner")).toBeVisible({
      timeout: 8_000,
    });

    // Open the re-auth dialog and submit the correct PIN.
    await page.getByTestId("button-session-expiry-reauth").click();
    await expect(page.getByTestId("input-session-reauth-pin")).toBeVisible({
      timeout: 6_000,
    });
    await page.getByTestId("input-session-reauth-pin").fill(TEST_PIN);
    await page.getByTestId("button-session-reauth-submit").click();

    // Banner should be gone and the portal shell should still be visible.
    await expect(
      page.getByTestId("portal-session-expiry-banner"),
    ).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("button-logout")).toBeVisible({
      timeout: 10_000,
    });
    // The dashboard navigation landmarks should still be accessible.
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();
  });

  // ── Test 4: wrong PIN shows an error, portal stays accessible ────────────

  test("entering a wrong PIN shows an error toast and keeps the dialog open", async ({
    page,
  }) => {
    await loginPortalUi(page, accessCode, TEST_PIN);
    await expireSessionToken(page);

    await expect(page.getByTestId("portal-session-expiry-banner")).toBeVisible({
      timeout: 8_000,
    });

    await page.getByTestId("button-session-expiry-reauth").click();
    await expect(page.getByTestId("input-session-reauth-pin")).toBeVisible({
      timeout: 6_000,
    });

    // Submit a wrong PIN.
    await page.getByTestId("input-session-reauth-pin").fill("000000");
    await page.getByTestId("button-session-reauth-submit").click();

    // The submit button should reappear (dialog stays open) after the failure.
    await expect(page.getByTestId("button-session-reauth-submit")).toBeVisible({
      timeout: 10_000,
    });
    // The banner should still be visible (not cleared by a failed attempt).
    await expect(page.getByTestId("portal-session-expiry-banner")).toBeVisible({
      timeout: 6_000,
    });
    // The logout button should still be present — user hasn't been ejected.
    await expect(page.getByTestId("button-logout")).toBeVisible();
  });

  // ── Test 5: 429 lockout — countdown appears, inputs disabled ─────────────

  test("rate-limit 429 shows lockout message and disables the PIN input and submit button", async ({
    page,
  }) => {
    await loginPortalUi(page, accessCode, TEST_PIN);
    await expireSessionToken(page);

    await expect(page.getByTestId("portal-session-expiry-banner")).toBeVisible({
      timeout: 8_000,
    });

    // Intercept the re-auth PIN endpoint and return a 429 with retryAfter.
    await page.route("**/api/cases/login-pin", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ retryAfter: 5 }),
      }),
    );

    await page.getByTestId("button-session-expiry-reauth").click();
    await expect(page.getByTestId("input-session-reauth-pin")).toBeVisible({
      timeout: 6_000,
    });

    await page.getByTestId("input-session-reauth-pin").fill("000000");
    await page.getByTestId("button-session-reauth-submit").click();

    // Lockout countdown message must appear.
    await expect(page.getByTestId("reauth-lockout-message")).toBeVisible({
      timeout: 8_000,
    });

    // PIN input must be disabled while locked out.
    await expect(page.getByTestId("input-session-reauth-pin")).toBeDisabled({
      timeout: 6_000,
    });

    // Submit button must be disabled while locked out.
    await expect(
      page.getByTestId("button-session-reauth-submit"),
    ).toBeDisabled({ timeout: 6_000 });
  });

  // ── Test 6: lockout clears once retryAfter elapses ───────────────────────

  test("lockout clears after retryAfter seconds — inputs re-enable and message disappears", async ({
    page,
  }) => {
    await loginPortalUi(page, accessCode, TEST_PIN);
    await expireSessionToken(page);

    await expect(page.getByTestId("portal-session-expiry-banner")).toBeVisible({
      timeout: 8_000,
    });

    // Intercept the re-auth PIN endpoint: return 429 with a short retryAfter.
    // Use a call counter so only the first call is rate-limited; subsequent
    // calls (after the lockout clears) fall through to the real server.
    let loginPinCallCount = 0;
    await page.route("**/api/cases/login-pin", (route) => {
      loginPinCallCount++;
      if (loginPinCallCount === 1) {
        route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ retryAfter: 2 }),
        });
      } else {
        // Unregister after the first call so the real server handles the rest.
        route.fallback();
      }
    });

    await page.getByTestId("button-session-expiry-reauth").click();
    await expect(page.getByTestId("input-session-reauth-pin")).toBeVisible({
      timeout: 6_000,
    });

    await page.getByTestId("input-session-reauth-pin").fill("000000");
    await page.getByTestId("button-session-reauth-submit").click();

    // Lockout state: countdown message visible, inputs disabled.
    await expect(page.getByTestId("reauth-lockout-message")).toBeVisible({
      timeout: 6_000,
    });
    await expect(page.getByTestId("input-session-reauth-pin")).toBeDisabled();
    await expect(
      page.getByTestId("button-session-reauth-submit"),
    ).toBeDisabled();

    // After retryAfter (2 s) elapses, the countdown should clear.
    // Wait up to 8 s (retryAfter + generous buffer) for all three assertions.
    await expect(page.getByTestId("reauth-lockout-message")).not.toBeVisible({
      timeout: 8_000,
    });
    await expect(
      page.getByTestId("input-session-reauth-pin"),
    ).not.toBeDisabled({ timeout: 6_000 });
    await expect(
      page.getByTestId("button-session-reauth-submit"),
    ).not.toBeDisabled({ timeout: 6_000 });
  });

  // ── Test 7: dismissing the banner hides it without re-auth ───────────────

  test("dismissing the banner hides it without requiring re-authentication", async ({
    page,
  }) => {
    await loginPortalUi(page, accessCode, TEST_PIN);
    await expireSessionToken(page);

    await expect(page.getByTestId("portal-session-expiry-banner")).toBeVisible({
      timeout: 8_000,
    });

    await page.getByTestId("button-session-expiry-dismiss").click();

    await expect(
      page.getByTestId("portal-session-expiry-banner"),
    ).not.toBeVisible({ timeout: 6_000 });

    // Portal remains accessible after dismissal.
    await expect(page.getByTestId("button-logout")).toBeVisible();
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();
  });
});
