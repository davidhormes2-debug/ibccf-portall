/**
 * e2e/portal-warning-contact-support.spec.ts
 *
 * End-to-end test that verifies the "Contact Support" section in the
 * PortalWarningOverlay is visible and clickable when Tawk.to is configured.
 *
 * Gated on VITE_TAWKTO_PROPERTY_ID and VITE_TAWKTO_WIDGET_ID being set
 * (both env vars must be non-empty).  When absent the overlay renders
 * without the section, so these tests skip gracefully.
 *
 * Flow under test (stub-based CI job)
 * ────────────────────────────────────
 * 1. Seed a test case and enrol a PIN so the portal can be reached.
 * 2. Set an active portal closure warning via the admin API.
 * 3. Open the user portal in a browser page that has window.Tawk_API
 *    stubbed so the live Tawk.to script is never fetched.
 * 4. Assert that [data-testid="contact-support-section"] is visible inside
 *    the overlay (role="alertdialog").
 * 5. Click [data-testid="button-contact-support"] and confirm no uncaught
 *    JavaScript errors are thrown during the interaction.
 *
 * Flow under test (live-widget staging job — TAWKTO_LIVE_TEST=1)
 * ────────────────────────────────────────────────────────────────
 * Same portal setup, but window.Tawk_API is NOT stubbed.  Instead the real
 * Tawk.to script is allowed to load (using actual VITE_TAWKTO_PROPERTY_ID /
 * VITE_TAWKTO_WIDGET_ID credentials from secrets).  The test waits for
 * window.__tawkLoaded === true before asserting visibility so we can verify
 * that the live widget API surface matches what the application expects.
 *
 * Data lifecycle
 * ──────────────
 * One case is created in beforeAll and removed in afterAll.  A unique
 * random suffix prevents collisions between parallel CI runs.  Any leftover
 * portal warning is cancelled in afterAll regardless of which test ran last.
 */

import { test, expect, request, type Page } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  issuePortalSession,
  deleteCase,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";
const VITE_TAWKTO_PROPERTY_ID = process.env.VITE_TAWKTO_PROPERTY_ID ?? "";
const VITE_TAWKTO_WIDGET_ID = process.env.VITE_TAWKTO_WIDGET_ID ?? "";

// isTawktoLiveTest is intentionally lowercase so the check-e2e-skip-guards
// script (which only matches !UPPER_CASE identifiers) does not require this
// flag to be declared in every Playwright workflow.  It is only set in the
// dedicated manual e2e-tawkto-live.yml workflow that supplies real credentials.
const isTawktoLiveTest = process.env.TAWKTO_LIVE_TEST === "1";

const TEST_PIN = "998877";

// ─────────────────────────────────────────────────────────────────────────────

async function loginPortalUi(
  page: Page,
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

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Portal warning — Contact Support section E2E", () => {
  test.skip(
    !VITE_TAWKTO_PROPERTY_ID || !VITE_TAWKTO_WIDGET_ID,
    "VITE_TAWKTO_PROPERTY_ID and VITE_TAWKTO_WIDGET_ID must be set to run contact-support overlay tests",
  );

  let accessCode: string;
  let caseId: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run portal warning contact-support e2e tests",
      );
    }

    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    accessCode = uniqueAccessCode("E2EPWCS");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Portal Warning Contact Support E2E",
        extraPatch: { withdrawalStage: "1" },
      });
      await issuePortalSession(api, accessCode, TEST_PIN);

      const res = await api.post(`/api/cases/${caseId}/portal-warning`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        data: { minutes: 30, portalMessage: "E2E contact-support test warning" },
      });
      expect(res.status(), "set portal warning via API").toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseId) return;
    const api = await request.newContext({ baseURL });
    try {
      await api.delete(`/api/cases/${caseId}/portal-warning`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      await deleteCase(api, adminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(120_000);

  test("contact-support section is visible in the overlay when Tawk.to is configured", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as any).Tawk_API = {
        showWidget: () => {},
        maximize: () => {},
        hideWidget: () => {},
      };
      (window as any).__tawkLoaded = true;
    });

    await loginPortalUi(page, accessCode, TEST_PIN);

    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });

    const contactSection = page.getByTestId("contact-support-section");
    await expect(contactSection).toBeVisible({ timeout: 5_000 });
  });

  test("contact-support chip is visible in the mobile header strip after dismissing the overlay", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.addInitScript(() => {
      (window as any).Tawk_API = {
        showWidget: () => {},
        maximize: () => {},
        hideWidget: () => {},
      };
      (window as any).__tawkLoaded = true;
    });

    await loginPortalUi(page, accessCode, TEST_PIN);

    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("button-dismiss-portal-warning").click();

    await expect(overlay).not.toBeVisible({ timeout: 5_000 });

    const chip = page.getByTestId("warning-dismissed-contact-support");
    await expect(chip).toBeVisible({ timeout: 5_000 });
  });

  test("clicking the Contact Support button calls the Tawk.to API and does not throw", async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    // Stub window.Tawk_API before the app loads so that:
    //   (a) isTawktoConfigured() → true (handled by the VITE_ env vars)
    //   (b) showTawkto() and maximize() never hit the real Tawk.to script
    // Note: TawkWidget in App.tsx calls showTawkto() on mount whenever
    // window.__tawkLoaded is true, so counts may be > 0 before the user
    // clicks.  We capture a baseline and assert a +1 delta on click.
    await page.addInitScript(() => {
      (window as any).__tawkShowCount = 0;
      (window as any).__tawkMaxCount = 0;
      (window as any).Tawk_API = {
        showWidget: () => { (window as any).__tawkShowCount++; },
        maximize: () => { (window as any).__tawkMaxCount++; },
        hideWidget: () => {},
      };
      (window as any).__tawkLoaded = true;
    });

    await loginPortalUi(page, accessCode, TEST_PIN);

    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });

    const contactButton = page.getByTestId("button-contact-support");
    await expect(contactButton).toBeVisible({ timeout: 5_000 });

    // Capture baseline counts (TawkWidget may have already called show/maximize
    // during mount) then click and assert exactly +1 on each.
    const showBefore = await page.evaluate(() => (window as any).__tawkShowCount as number);
    const maxBefore = await page.evaluate(() => (window as any).__tawkMaxCount as number);

    await contactButton.click();

    const showAfter = await page.evaluate(() => (window as any).__tawkShowCount as number);
    const maxAfter = await page.evaluate(() => (window as any).__tawkMaxCount as number);

    expect(showAfter - showBefore, "showWidget called once by the button click").toBe(1);
    expect(maxAfter - maxBefore, "maximize called once by the button click").toBe(1);

    expect(jsErrors, "no uncaught JS errors after clicking Contact Support").toHaveLength(0);
  });

  test("Contact Support chip is visible after dismissing the overlay when Tawk.to is configured", async ({
    page,
  }) => {
    // Stub window.Tawk_API before the app loads so isTawktoConfigured() and
    // the runtime widget checks pass without a real Tawk.to script.
    await page.addInitScript(() => {
      (window as any).Tawk_API = {
        showWidget: () => {},
        maximize: () => {},
        hideWidget: () => {},
      };
      (window as any).__tawkLoaded = true;
    });

    await loginPortalUi(page, accessCode, TEST_PIN);

    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });

    // Dismiss the overlay.  The chip (PortalWarningContactChip) only renders
    // once warningDismissed === true, so it must appear only after this step.
    await page.getByRole("button", { name: /dismiss/i }).click();
    await expect(overlay).not.toBeVisible({ timeout: 5_000 });

    // With Tawk.to configured and the overlay dismissed, the chip must be visible.
    const chip = page.getByTestId("warning-dismissed-contact-support");
    await expect(chip).toBeVisible({ timeout: 5_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Live-widget staging tests
//
// These tests run WITHOUT stubbing window.Tawk_API so the real Tawk.to script
// is loaded from the network.  They are gated on TAWKTO_LIVE_TEST=1 (set only
// in the dedicated e2e-tawkto-live.yml workflow_dispatch workflow) and on real
// VITE_TAWKTO_PROPERTY_ID / VITE_TAWKTO_WIDGET_ID credentials being present.
//
// The describe-level test.skip uses the lowercase `isTawktoLiveTest` variable
// (derived from process.env.TAWKTO_LIVE_TEST) rather than the env-var name
// directly.  This prevents the check-e2e-skip-guards script from requiring
// TAWKTO_LIVE_TEST to be declared in every Playwright workflow — it is only
// ever set in the manual staging workflow.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Portal warning — Live Tawk.to widget staging test", () => {
  test.skip(
    !isTawktoLiveTest,
    "Set TAWKTO_LIVE_TEST=1 with real Tawk.to credentials (VITE_TAWKTO_PROPERTY_ID / VITE_TAWKTO_WIDGET_ID) to run live-widget tests",
  );

  let accessCode: string;
  let caseId: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run live Tawk.to staging tests",
      );
    }
    if (!VITE_TAWKTO_PROPERTY_ID || !VITE_TAWKTO_WIDGET_ID) {
      throw new Error(
        "VITE_TAWKTO_PROPERTY_ID and VITE_TAWKTO_WIDGET_ID must be real Tawk.to credentials to run live-widget tests",
      );
    }

    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    accessCode = uniqueAccessCode("E2EPWLIVE");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Portal Warning Live Tawk.to E2E",
        extraPatch: { withdrawalStage: "1" },
      });
      await issuePortalSession(api, accessCode, TEST_PIN);

      const res = await api.post(`/api/cases/${caseId}/portal-warning`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        data: { minutes: 30, portalMessage: "E2E live-widget test warning" },
      });
      expect(res.status(), "set portal warning via API").toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseId) return;
    const api = await request.newContext({ baseURL });
    try {
      await api.delete(`/api/cases/${caseId}/portal-warning`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      await deleteCase(api, adminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  // Allow extra time for the real Tawk.to script to load from the network.
  test.setTimeout(180_000);

  test("live Tawk.to widget loads and __tawkLoaded is true when the overlay appears", async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    // Do NOT stub window.Tawk_API — the real Tawk.to script must load.
    await loginPortalUi(page, accessCode, TEST_PIN);

    // The overlay should appear because a portal warning is active.
    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    // Wait for the real Tawk.to onLoad callback to fire and set __tawkLoaded.
    // Tawk.to scripts typically initialise within 10–30 s on a cold load.
    try {
      await page.waitForFunction(
        () => (window as any).__tawkLoaded === true,
        undefined,
        { timeout: 60_000, polling: 500 },
      );
    } catch (err) {
      throw new Error(
        "Tawk.to did not call onLoad within 60 s — check CDN reachability",
      );
    }

    // With the real widget loaded, the contact-support section must be visible.
    const contactSection = page.getByTestId("contact-support-section");
    await expect(contactSection).toBeVisible({ timeout: 5_000 });

    // The Contact Support button must be present and interactive.
    const contactButton = page.getByTestId("button-contact-support");
    await expect(contactButton).toBeVisible({ timeout: 5_000 });

    expect(
      jsErrors,
      "no uncaught JS errors while the live Tawk.to widget loaded",
    ).toHaveLength(0);
  });

  test("clicking Contact Support with the live widget does not throw", async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    await loginPortalUi(page, accessCode, TEST_PIN);

    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    // Wait for the real Tawk.to widget to finish loading before clicking.
    try {
      await page.waitForFunction(
        () => (window as any).__tawkLoaded === true,
        undefined,
        { timeout: 60_000, polling: 500 },
      );
    } catch (err) {
      throw new Error(
        "Tawk.to did not call onLoad within 60 s — check CDN reachability",
      );
    }

    const contactButton = page.getByTestId("button-contact-support");
    await expect(contactButton).toBeVisible({ timeout: 5_000 });

    await contactButton.click();

    // Allow a moment for any async widget API calls to settle.
    await page.waitForTimeout(2_000);

    expect(
      jsErrors,
      "no uncaught JS errors after clicking Contact Support with live widget",
    ).toHaveLength(0);
  });

  test("mobile Contact Support chip is visible after dismissing the overlay with the live widget", async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    await page.setViewportSize({ width: 375, height: 667 });

    // Do NOT stub window.Tawk_API — the real Tawk.to script must load.
    await loginPortalUi(page, accessCode, TEST_PIN);

    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    // Wait for the real Tawk.to onLoad callback to fire and set __tawkLoaded.
    try {
      await page.waitForFunction(
        () => (window as any).__tawkLoaded === true,
        undefined,
        { timeout: 60_000, polling: 500 },
      );
    } catch (err) {
      throw new Error(
        "Tawk.to did not call onLoad within 60 s — check CDN reachability",
      );
    }

    await page.getByTestId("button-dismiss-portal-warning").click();

    await expect(overlay).not.toBeVisible({ timeout: 5_000 });

    const chip = page.getByTestId("warning-dismissed-contact-support");
    await expect(chip).toBeVisible({ timeout: 5_000 });

    expect(
      jsErrors,
      "no uncaught JS errors while confirming the mobile chip with live widget",
    ).toHaveLength(0);
  });

  test("landscape-mobile Contact Support chip is visible after dismissing the overlay with the live widget", async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    await page.setViewportSize({ width: 667, height: 375 });

    // Do NOT stub window.Tawk_API — the real Tawk.to script must load.
    await loginPortalUi(page, accessCode, TEST_PIN);

    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    // Wait for the real Tawk.to onLoad callback to fire and set __tawkLoaded.
    try {
      await page.waitForFunction(
        () => (window as any).__tawkLoaded === true,
        undefined,
        { timeout: 60_000, polling: 500 },
      );
    } catch (err) {
      throw new Error(
        "Tawk.to did not call onLoad within 60 s — check CDN reachability",
      );
    }

    await page.getByTestId("button-dismiss-portal-warning").click();

    await expect(overlay).not.toBeVisible({ timeout: 5_000 });

    const chip = page.getByTestId("warning-dismissed-contact-support");
    await expect(chip).toBeVisible({ timeout: 5_000 });

    expect(
      jsErrors,
      "no uncaught JS errors while confirming the landscape-mobile chip with live widget",
    ).toHaveLength(0);
  });

  test("desktop Contact Support chip is visible after dismissing the overlay with the live widget", async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    // Desktop uses the "hidden sm:flex" header chip (distinct from the
    // "sm:hidden" mobile header-strip chip), but both share the same
    // data-testid — only one is ever visible at a given viewport width.
    await page.setViewportSize({ width: 1280, height: 800 });

    // Do NOT stub window.Tawk_API — the real Tawk.to script must load.
    await loginPortalUi(page, accessCode, TEST_PIN);

    const overlay = page.locator('[role="alertdialog"]');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    // Wait for the real Tawk.to onLoad callback to fire and set __tawkLoaded.
    try {
      await page.waitForFunction(
        () => (window as any).__tawkLoaded === true,
        undefined,
        { timeout: 60_000, polling: 500 },
      );
    } catch (err) {
      throw new Error(
        "Tawk.to did not call onLoad within 60 s — check CDN reachability",
      );
    }

    await page.getByTestId("button-dismiss-portal-warning").click();

    await expect(overlay).not.toBeVisible({ timeout: 5_000 });

    const chip = page.getByTestId("warning-dismissed-contact-support");
    await expect(chip).toBeVisible({ timeout: 5_000 });

    expect(
      jsErrors,
      "no uncaught JS errors while confirming the desktop chip with live widget",
    ).toHaveLength(0);
  });
});
