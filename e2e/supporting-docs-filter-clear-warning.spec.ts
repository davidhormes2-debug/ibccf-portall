/**
 * Task #579 — Filter-change selection-clear warning (Task #508)
 *
 * What these tests verify
 * -----------------------
 * When an admin has ≥1 documents selected in the Supporting Docs tab and
 * switches the status filter to a view with no overlap with the current
 * selection, an amber confirmation banner appears asking them to confirm
 * before the filter is applied and the selection is wiped.
 *
 *   1. Banner appears  — select an "uploaded" doc, switch to "approved" filter
 *      (no overlap) → amber panel `panel-filter-clear-confirm-supporting-docs`
 *      must be visible.
 *
 *   2. Cancel — clicking "Cancel" dismisses the banner, keeps the old filter
 *      results visible (the selected doc row is still in the table), and
 *      preserves the selection (the toolbar remains visible).
 *
 *   3. Continue — clicking "Continue" applies the new filter, clears the
 *      selection, and the selection toolbar disappears.
 *
 *   4. Partial overlap skips the banner — select an "uploaded" doc then switch
 *      to "All statuses" (which includes "uploaded"): there IS overlap, so the
 *      banner must NOT appear.
 *
 * Auth / rate-limit strategy
 * --------------------------
 * beforeAll clears admin_login_attempts in the DB (same pattern as
 * supporting-docs-approve-reject.spec.ts) to guard against the 5-per-15-min
 * rate limit from repeated local runs.  A single API login in beforeAll
 * produces sharedAdminToken used for all API-layer case/doc setup.  Each
 * test then logs into the admin UI via the form (loginAdminUi) — this is the
 * proven approach from supporting-docs-approve-reject.spec.ts because it
 * requires only one page navigation (no sessionStorage-injection reload).
 *
 * Timeout
 * -------
 * Each test calls test.setTimeout(90_000).  The full flow (API setup + form
 * login + filter interactions) reliably fits within 90 s on Replit's dev
 * environment.
 */

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import {
  readAdminToken,
  uniqueAccessCode,
  TINY_PNG_DATA_URL,
  createCase,
  issuePortalSession,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";

let sharedAdminToken = "";

// ─── API helpers ──────────────────────────────────────────────────────────────

async function uploadSupportingDoc(
  api: APIRequestContext,
  caseId: string,
  sessionToken: string,
  fileName: string,
): Promise<number> {
  const res = await api.post(`/api/cases/${caseId}/user-documents`, {
    headers: { "x-portal-session-token": sessionToken },
    data: {
      fileData: TINY_PNG_DATA_URL,
      fileName,
      category: "general",
      description: "E2E filter-warning test upload",
    },
  });
  expect(res.status(), "upload supporting doc").toBe(201);
  return (await res.json()).id as number;
}

// ─── Browser helpers ──────────────────────────────────────────────────────────

/**
 * Log into the admin UI via the form and wait for the dashboard to be fully
 * interactive.  Uses waitUntil:"domcontentloaded" to avoid stalling on slow
 * network requests, then waits for the case-finder trigger as the stable
 * "logged-in" signal.  Same approach used by supporting-docs-approve-reject.spec.ts.
 */
async function loginAdminUi(page: import("@playwright/test").Page) {
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await page.getByTestId("input-admin-username").fill(ADMIN_USERNAME);
  await page.getByTestId("input-admin-password").fill(ADMIN_PASSWORD);
  await page.getByTestId("button-admin-login").click();
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 25_000,
  });
}

/**
 * Navigate to the Supporting Docs tab and filter by caseId so only the test
 * case's rows are visible.  Waits explicitly for the tab and filter input to
 * be visible before interacting.  After filling, presses Tab to immediately
 * fire the 300 ms debounce.
 */
async function navigateToSupportingDocsAndFilter(
  page: import("@playwright/test").Page,
  caseId: string,
) {
  const tabTrigger = page.getByTestId("tab-supporting-docs");
  await expect(tabTrigger).toBeVisible({ timeout: 10_000 });
  // Use force:true to bypass Playwright's stability wait.  The Radix tab
  // trigger has CSS transitions that can keep the element "animating" in the
  // Replit dev environment while the dashboard loads many documents.
  await tabTrigger.click({ force: true });
  const filterInput = page.getByTestId("filter-supporting-docs-case-id");
  await expect(filterInput).toBeVisible({ timeout: 15_000 });
  await filterInput.fill(caseId);
  // Pressing Tab immediately fires the 300 ms debounce.
  await filterInput.press("Tab");
}

/**
 * Switch the status filter dropdown to the given option label.
 */
async function setStatusFilter(
  page: import("@playwright/test").Page,
  optionLabel: string | RegExp,
) {
  await page.getByTestId("select-filter-supporting-status").click();
  await page.getByRole("option", { name: optionLabel }).click();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Admin — Supporting Docs filter-change warning", () => {
  // Clear the rate-limit table before the suite runs so repeated local
  // invocations during development don't trigger a 429.  Mirrors the
  // strategy used in supporting-docs-approve-reject.spec.ts.
  test.beforeAll(async () => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the supporting-docs filter-warning e2e tests",
      );
    }
    if (DATABASE_URL) {
      const pg = new Client({ connectionString: DATABASE_URL });
      try {
        await pg.connect();
        await pg.query(`DELETE FROM admin_login_attempts`);
      } finally {
        await pg.end();
      }
    }

    sharedAdminToken = readAdminToken();
  });

  test("banner appears when switching to a filter with no overlap with current selection", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode("E2EFW-A");
    const caseId = await createCase(api, sharedAdminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "111222");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "filter-warn-banner.png",
    );
    await api.dispose();

    await loginAdminUi(page);

    // Navigate to Supporting Docs tab (default filter: "uploaded").
    await navigateToSupportingDocsAndFilter(page, caseId);

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Select the document via its checkbox.
    await page.getByTestId(`checkbox-supporting-doc-${docId}`).click();

    // Toolbar should now be visible (selection is active).
    await expect(
      page.getByTestId("toolbar-selection-supporting-docs"),
    ).toBeVisible({ timeout: 5_000 });

    // Switch to "Approved" — zero overlap with the "uploaded" doc we selected.
    await setStatusFilter(page, /Approved/i);

    // The amber warning banner must appear.
    await expect(
      page.getByTestId("panel-filter-clear-confirm-supporting-docs"),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Cancel dismisses the banner, keeps docs visible, and preserves the selection", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode("E2EFW-C");
    const caseId = await createCase(api, sharedAdminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "333444");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "filter-warn-cancel.png",
    );
    await api.dispose();

    await loginAdminUi(page);
    await navigateToSupportingDocsAndFilter(page, caseId);

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Select the document.
    await page.getByTestId(`checkbox-supporting-doc-${docId}`).click();
    await expect(
      page.getByTestId("toolbar-selection-supporting-docs"),
    ).toBeVisible({ timeout: 5_000 });

    // Trigger the warning by switching to a non-overlapping filter.
    await setStatusFilter(page, /Approved/i);

    const banner = page.getByTestId(
      "panel-filter-clear-confirm-supporting-docs",
    );
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Click "Cancel".
    await page.getByTestId("button-filter-clear-cancel-supporting-docs").click();

    // Banner must be gone.
    await expect(banner).not.toBeVisible();

    // The original doc row must still be visible (old filter data preserved).
    await expect(row).toBeVisible({ timeout: 5_000 });

    // The selection toolbar must still be visible (selection preserved).
    await expect(
      page.getByTestId("toolbar-selection-supporting-docs"),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Continue applies the new filter and clears the selection (toolbar disappears)", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode("E2EFW-K");
    const caseId = await createCase(api, sharedAdminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "555666");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "filter-warn-continue.png",
    );
    await api.dispose();

    await loginAdminUi(page);
    await navigateToSupportingDocsAndFilter(page, caseId);

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Select the document.
    await page.getByTestId(`checkbox-supporting-doc-${docId}`).click();
    await expect(
      page.getByTestId("toolbar-selection-supporting-docs"),
    ).toBeVisible({ timeout: 5_000 });

    // Trigger the warning.
    await setStatusFilter(page, /Approved/i);

    const banner = page.getByTestId(
      "panel-filter-clear-confirm-supporting-docs",
    );
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Click "Continue" to apply the new filter and clear selections.
    await page
      .getByTestId("button-filter-clear-continue-supporting-docs")
      .click();

    // Banner must disappear.
    await expect(banner).not.toBeVisible();

    // Selection toolbar must disappear (selection was cleared).
    await expect(
      page.getByTestId("toolbar-selection-supporting-docs"),
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("switching to a filter with overlap skips the banner entirely", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode("E2EFW-P");
    const caseId = await createCase(api, sharedAdminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "777888");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "filter-warn-overlap.png",
    );
    await api.dispose();

    await loginAdminUi(page);
    await navigateToSupportingDocsAndFilter(page, caseId);

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Select the "uploaded" document.
    await page.getByTestId(`checkbox-supporting-doc-${docId}`).click();
    await expect(
      page.getByTestId("toolbar-selection-supporting-docs"),
    ).toBeVisible({ timeout: 5_000 });

    // Switch to "All statuses" — "uploaded" docs are included, so there IS
    // overlap with the current selection. No confirmation banner should appear.
    await setStatusFilter(page, /All statuses/i);

    // Wait to confirm the banner never appears (not just not yet loaded).
    await page.waitForTimeout(800);

    await expect(
      page.getByTestId("panel-filter-clear-confirm-supporting-docs"),
    ).not.toBeVisible();

    // The selected row must still be visible (filter applied immediately).
    await expect(row).toBeVisible({ timeout: 10_000 });

    // The toolbar must still be visible (selection preserved across overlap).
    await expect(
      page.getByTestId("toolbar-selection-supporting-docs"),
    ).toBeVisible({ timeout: 5_000 });
  });
});
