/**
 * e2e/admin-reactivation-badge-mobile-nav.spec.ts
 *
 * Regression guard: the reactivation nav badge (`badge-cases-reactivation` in
 * AdminGroupedNav) must remain visible to an admin on a narrow/mobile
 * viewport, not just on desktop.
 *
 * Task #2389 context / deviation note
 * ────────────────────────────────────
 * The task was framed around confirming the badge appears inside a mobile
 * "More" sheet, mirroring the portal's bottom-bar + Sheet pattern documented
 * in replit.md (Sidebar group assignment gotcha). That pattern belongs to
 * `PortalShell.tsx` (the case-holder portal) — the Admin Dashboard has no
 * such component. `AdminGroupedNav` is the ONLY navigation surface for
 * admins on every viewport: the wrapping container in `AdminDashboard.tsx`
 * is `flex flex-col lg:flex-row`, so below the `lg` breakpoint the full nav
 * (including the "All Cases" item and its reactivation badge) renders as a
 * stacked block above the tab content — it is never hidden behind a
 * collapsed "More" trigger or a `Sheet`/drawer component. There is therefore
 * no separate "mobile More sheet" surface to open for this badge.
 *
 * This spec instead directly verifies the equivalent regression the task
 * cares about: that the reactivation badge is not accidentally hidden by a
 * `lg:` (or similar) responsive class at narrow viewport widths, since a
 * wiring or CSS regression scoped to the sub-`lg` layout would not be caught
 * by the existing desktop-viewport spec
 * (`e2e/admin-reactivation-nav-badge-other-tabs.spec.ts`).
 *
 * Relevant source
 * ───────────────
 * - client/src/components/admin/AdminGroupedNav.tsx — badge-cases-reactivation
 *     testid, rendered unconditionally regardless of viewport
 * - client/src/pages/AdminDashboard.tsx — `flex flex-col lg:flex-row` layout
 *     wrapping AdminGroupedNav + tab content, and reactivationPendingTotal
 *     wiring into `reactivationPendingCount`
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

// 400x720 — narrow mobile viewport, well below the `lg` (1024px) Tailwind
// breakpoint that switches AdminGroupedNav from a stacked block to a sticky
// left rail.
const MOBILE_VIEWPORT = { width: 400, height: 720 };

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
 * directly into the database, bypassing the portal-session-gated upload
 * endpoint — mirrors admin-reactivation-nav-badge-other-tabs.spec.ts.
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
       VALUES ($1, 'reissue', 'pending', 'Reactivation receipt — mobile nav badge E2E')
       RETURNING id`,
      [caseId],
    );
    return result.rows[0].id;
  } finally {
    await pg.end();
  }
}

test.describe("Admin — reactivation nav badge is visible on a narrow mobile viewport", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

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

    accessCode = uniqueAccessCode("E2ERMOBL");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Reactivation Mobile Nav Badge E2E",
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
    "badge-cases-reactivation is visible on a 400x720 mobile viewport and clicking it opens Cases with the reactivation filter active",
    async ({ page }) => {
      // ── Step 1: log into the admin dashboard on a narrow viewport ─────────
      await loginAdminUi(page);

      // ── Step 2: the badge must be visible on mobile without any extra
      //    interaction (no hamburger / "More" trigger to open first) ────────
      //
      // AdminGroupedNav has no sub-`lg` collapsed state — a regression that
      // hid the nav (or just the badge) below the `lg` breakpoint would fail
      // here even though the desktop-viewport spec would still pass.
      const navBadge = page.getByTestId("badge-cases-reactivation");
      await expect(navBadge).toBeVisible({ timeout: 30_000 });

      // ── Step 3: click the reactivation badge ─────────────────────────────
      await navBadge.click();

      // ── Step 4: the reactivation filter triage pill must be visible ──────
      const filterPill = page.getByTestId("button-filter-reactivation-pending");
      await expect(filterPill).toBeVisible({ timeout: 10_000 });
    },
  );
});
