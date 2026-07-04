/**
 * e2e/admin-reactivation-nav-badge-other-tabs.spec.ts
 *
 * Regression guard: the reactivation nav badge (`badge-cases-reactivation` in
 * AdminGroupedNav) must be visible from non-Cases tabs, and clicking it must
 * switch to the Cases tab with the reactivation filter active.
 *
 * Unit tests (ReactivationPillSync, CasesTabReactivationPendingBadge, and
 * AdminGroupedNav.test) only prove the badge renders from props in isolation.
 * They do NOT prove the badge is visible to an admin who is on the Analytics
 * or Communications tab, or that clicking it wires up the filter correctly
 * end-to-end.
 *
 * What this spec covers
 * ─────────────────────
 * 1. Seed a disabled case with a pending reactivation receipt (category=
 *    'reissue', reissue_id=NULL) directly via the database so the test
 *    bypasses the portal-session guard on the upload endpoint.
 * 2. Log into the admin dashboard via the token-injection shortcut.
 * 3. Navigate to the Analytics tab using `data-testid="tab-analytics"`.
 * 4. Assert `data-testid="badge-cases-reactivation"` is visible in the sidebar
 *    while the admin is on the Analytics tab — the core regression this spec
 *    is designed to catch.
 * 5. Click the badge.
 * 6. Assert the Cases tab is now active (the reactivation filter triage pill
 *    `data-testid="button-filter-reactivation-pending"` becomes visible),
 *    confirming the click handler wired the correct tab-switch + filter-set
 *    flow end-to-end.
 * 7. A second test repeats steps 3-6 against the Communications tab
 *    (`data-testid="tab-communications"`, the "Broadcast" nav item), which
 *    sits in a different sidebar group with a longer item list than
 *    Analytics. This guards against a wiring regression that only hides the
 *    badge at specific sidebar scroll positions / group layouts.
 *
 * Data lifecycle
 * ──────────────
 * One disabled case with one pending reactivation receipt is created in
 * beforeAll and removed in afterAll. A unique random suffix prevents
 * collisions between parallel CI runs.
 *
 * Relevant source
 * ───────────────
 * - client/src/components/admin/AdminGroupedNav.tsx — badge-cases-reactivation
 *     testid and onReactivationBadgeClick prop
 * - client/src/pages/AdminDashboard.tsx — reactivationPendingTotal computation
 *     and the handler passed as onReactivationBadgeClick (navigates to "cases"
 *     tab and sets the reactivation filter)
 * - client/src/components/admin/tabs/CasesTab.tsx — button-filter-reactivation-
 *     pending triage pill (visible only when the reactivation filter is active)
 */

import { test, expect, request } from "@playwright/test";
import { Client } from "pg";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  deleteCase,
  loginAdminUi,
  clearAdminRateLimit,
  localTimeout,
} from "./helpers";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function disableCaseViaApi(
  api: import("@playwright/test").APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.post(`/api/cases/${caseId}/toggle-access`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    data: { disabled: true },
  });
  expect(res.status(), "disable case via API").toBe(200);
}

/**
 * Insert a pending reactivation receipt (category='reissue', reissue_id=NULL)
 * directly into the database. The server-side upload endpoint requires a live
 * portal session, so bypassing it via direct SQL is the cleanest approach for
 * admin-side E2E tests that only care about what the admin sees.
 */
async function insertReactivationReceipt(
  databaseUrl: string,
  caseId: string,
): Promise<number> {
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    const result = await pg.query<{ id: number }>(
      `INSERT INTO deposit_receipts (case_id, category, status, notes)
       VALUES ($1, 'reissue', 'pending', 'Reactivation receipt — nav badge other-tabs E2E')
       RETURNING id`,
      [caseId],
    );
    return result.rows[0].id;
  } finally {
    await pg.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin — reactivation nav badge is visible from the Analytics tab and click opens the Cases filter", () => {
  let accessCode: string;
  let caseId: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run this e2e test",
      );
    }
    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL (or NEON_DATABASE_URL) must be set to seed the reactivation receipt",
      );
    }

    await clearAdminRateLimit(DATABASE_URL);

    accessCode = uniqueAccessCode("E2ERNBOT");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Reactivation Nav Badge Other Tabs E2E",
      });
      await insertReactivationReceipt(DATABASE_URL, caseId);
      await disableCaseViaApi(api, adminToken, caseId);
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
    "badge-cases-reactivation is visible on the Analytics tab and clicking it opens Cases with the reactivation filter active",
    async ({ page }) => {
      // ── Step 1: log into the admin dashboard ──────────────────────────────
      await loginAdminUi(page);

      // ── Step 2: wait for the dashboard polling loop to load counts ─────────
      //
      // The reactivationPendingTotal is populated by loadReactivationPendingCounts
      // inside AdminDashboard. We wait for the nav badge to appear here first
      // (while still on the Cases tab) so we know the count is loaded before
      // navigating away.
      const navBadge = page.getByTestId("badge-cases-reactivation");
      await expect(navBadge).toBeVisible({ timeout: 30_000 });

      // ── Step 3: navigate to the Analytics tab ────────────────────────────
      //
      // This simulates an admin who is reviewing charts when a reactivation
      // receipt arrives — they should be able to see and act on the badge
      // without returning to Cases first.
      await page.getByTestId("tab-analytics").click({ force: true });

      // ── Step 4: badge must still be visible on the Analytics tab ──────────
      //
      // AdminGroupedNav is rendered globally in the sidebar, not per-tab, so
      // the badge must persist across tab switches. A regression in the
      // wiring (e.g. reactivationPendingCounts not passed to the nav) would
      // cause the badge to disappear here.
      await expect(navBadge).toBeVisible({ timeout: 10_000 });

      // ── Step 5: click the reactivation badge ─────────────────────────────
      //
      // onReactivationBadgeClick in AdminDashboard navigates to the "cases"
      // tab and activates the reactivation-pending filter. Both effects are
      // verified in the next step.
      await navBadge.click();

      // ── Step 6: the reactivation filter triage pill must be visible ────────
      //
      // CasesTab renders button-filter-reactivation-pending only when the
      // reactivation filter is active. If the badge click handler is wired
      // correctly this pill is visible immediately after the click. If the
      // tab switch or filter-set call is missing, this assertion fails.
      const filterPill = page.getByTestId("button-filter-reactivation-pending");
      await expect(filterPill).toBeVisible({ timeout: 10_000 });
    },
  );

  test(
    "badge-cases-reactivation is visible on the Communications tab and clicking it opens Cases with the reactivation filter active",
    async ({ page }) => {
      // ── Step 1: log into the admin dashboard ──────────────────────────────
      await loginAdminUi(page);

      // ── Step 2: wait for the dashboard polling loop to load counts ─────────
      const navBadge = page.getByTestId("badge-cases-reactivation");
      await expect(navBadge).toBeVisible({ timeout: 30_000 });

      // ── Step 3: navigate to the Communications tab ───────────────────────
      //
      // The Communications sidebar group has more items than Analytics
      // (Conversations, Broadcast, Content, Community), so it exercises a
      // different sidebar layout / scroll position than the Analytics-tab
      // test above.
      await page.getByTestId("tab-communications").click({ force: true });

      // ── Step 4: badge must still be visible on the Communications tab ────
      await expect(navBadge).toBeVisible({ timeout: 10_000 });

      // ── Step 5: click the reactivation badge ─────────────────────────────
      await navBadge.click();

      // ── Step 6: the reactivation filter triage pill must be visible ──────
      const filterPill = page.getByTestId("button-filter-reactivation-pending");
      await expect(filterPill).toBeVisible({ timeout: 10_000 });
    },
  );
});
