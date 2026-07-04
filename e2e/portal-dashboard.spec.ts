/**
 * e2e/portal-dashboard.spec.ts
 *
 * Happy-path portal tests: a real case logs in via the two-step access-code +
 * PIN form, the dashboard renders correctly, and the user can navigate to the
 * Letter and Uploads secondary views.
 *
 * Data lifecycle
 * ─────────────
 * A minimal case is created in beforeAll via the admin API and a PIN is
 * enrolled via POST /api/cases/set-pin.  The case is deleted in afterAll via
 * DELETE /api/cases/:id (admin bearer auth) so no stale rows accumulate across
 * runs.  A unique random suffix on the access code prevents collisions between
 * parallel CI runs.
 */

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import {
  readAdminToken,
  uniqueAccessCode as _uniqueCode,
  createCase,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

const TEST_PIN = "357913";

function uniqueCode(prefix: string): string {
  return _uniqueCode(prefix);
}

async function createTestCase(
  api: APIRequestContext,
  adminToken: string,
  accessCode: string,
): Promise<string> {
  return createCase(api, adminToken, accessCode, {
    userName: "Portal Dashboard E2E",
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
  // Active cases require ?force=true to bypass the verified-account guard.
  const res = await api.delete(`/api/cases/${caseId}?force=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  // 200 = deleted, 404 = already gone — both are acceptable for cleanup
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

  // Step 1 — submit access code
  await page.getByTestId("input-access-code").fill(accessCode);
  await page.getByTestId("button-login").click();

  // Step 2 — PIN input appears because the PIN is already enrolled
  await expect(page.getByTestId("input-pin")).toBeVisible({ timeout: 12_000 });
  await page.getByTestId("input-pin").fill(pin);
  await page.getByTestId("button-login").click();

  // Wait until the portal shell has loaded (logout button is the stable signal)
  await expect(page.getByTestId("button-logout")).toBeVisible({
    timeout: 20_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Portal dashboard — happy-path login and navigation", () => {
  let accessCode: string;
  let seededCaseId: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the portal dashboard e2e tests",
      );
    }
    // Clear admin-login rate-limit rows so stale attempts from previous
    // test runs don't cause a 429 on the first login call below.
    if (DATABASE_URL) {
      const pg = new Client({ connectionString: DATABASE_URL });
      try {
        await pg.connect();
        await pg.query("DELETE FROM admin_login_attempts");
      } finally {
        await pg.end();
      }
    }

    accessCode = uniqueCode("E2E-DASH");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
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
      const token = adminToken || readAdminToken();
      await deleteTestCase(api, token, seededCaseId);
    } finally {
      await api.dispose();
    }
  });

  // ── Test 1: login and verify the dashboard view ──────────────────────────

  test("logs in with a valid access code and PIN and renders the dashboard", async ({
    page,
  }) => {
    await loginPortalUi(page, accessCode, TEST_PIN);

    // Portal shell navigation links are visible
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();
    await expect(page.getByTestId("nav-letter")).toBeVisible();
    await expect(page.getByTestId("nav-deposit")).toBeVisible();

    // The 14-stage progress tracker always renders in the dashboard view
    await expect(page.getByTestId("stages-stepper")).toBeVisible();

    // The per-stage CTA card renders for stage 1 (set during case creation)
    await expect(page.getByTestId("stage-cta-card-1")).toBeVisible();
  });

  // ── Test 2: navigate to the Letter view ──────────────────────────────────

  test("navigates to the Letter view from the dashboard", async ({ page }) => {
    await loginPortalUi(page, accessCode, TEST_PIN);

    await page.getByTestId("nav-letter").click();

    // For a new case without a letter, the view shows a "pending" state
    // indicated by the back-to-dashboard button.  Either that button or the
    // download button (when a letter exists) confirms the Letter view loaded.
    const letterViewLoaded = page
      .getByTestId("button-back-dashboard-pending")
      .or(page.getByTestId("button-download-pdf"));
    await expect(letterViewLoaded).toBeVisible({ timeout: 12_000 });
  });

  // ── Test 3: navigate to the Uploads view ─────────────────────────────────

  test("navigates to the Uploads view from the dashboard", async ({ page }) => {
    await loginPortalUi(page, accessCode, TEST_PIN);

    await page.getByTestId("nav-deposit").click();

    // The unified upload view always renders a category-selector wrapper
    await expect(
      page.getByTestId("select-upload-category-wrapper"),
    ).toBeVisible({ timeout: 12_000 });
  });
});
