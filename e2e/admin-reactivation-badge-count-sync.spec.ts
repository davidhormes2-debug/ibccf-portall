// End-to-end coverage for the Cases-tab reactivation pending badge
// (`badge-cases-reactivation` in AdminGroupedNav, driven by
// `loadReactivationPendingCounts` in AdminDashboard).
//
// The component-level unit tests (ReactivationPillSync.test.tsx and
// CasesTabReactivationPendingBadge.test.tsx) only prove the badge renders and
// clears in response to prop changes. They do NOT prove that the live count
// actually decrements after an admin acts on a real reactivation receipt.
// These specs close that gap end-to-end:
//
//   1. Seed a disabled case with a pending reactivation receipt directly via
//      the database (bypassing the portal-session guard on the upload
//      endpoint — matching the pattern in admin-reactivation-receipt.spec.ts).
//   2. Log into the admin dashboard and confirm the cross-case nav badge
//      (`badge-cases-reactivation`) reflects the pending count, and the
//      per-case badge (`badge-reactivation-pending-<caseId>`) is shown.
//   3. Open the per-case receipts dialog and approve / reject the receipt.
//   4. Assert the nav badge total decrements by exactly one (the contract that
//      `onActioned → loadReactivationPendingCounts` actually fires and
//      re-fetches), and the per-case badge disappears.

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
       VALUES ($1, 'reissue', 'pending', 'Reactivation deposit — badge sync E2E')
       RETURNING id`,
      [caseId],
    );
    return result.rows[0].id;
  } finally {
    await pg.end();
  }
}

/**
 * Reads the cross-case reactivation nav badge total. Returns 0 when the badge
 * is not rendered (the component hides it when the total is 0).
 */
async function readNavReactivationBadge(
  page: import("@playwright/test").Page,
): Promise<number> {
  const badge = page.getByTestId("badge-cases-reactivation");
  if ((await badge.count()) === 0) return 0;
  const txt = (await badge.first().textContent()) ?? "";
  const n = parseInt(txt.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Open the receipts dialog for a case via the Cases-tab search + manage
 * dropdown ("View Receipts" menu item).
 */
async function openReceiptsDialog(
  page: import("@playwright/test").Page,
  caseId: string,
  accessCode: string,
): Promise<void> {
  const search = page.getByTestId("input-search-cases");
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(accessCode);

  const manageButton = page.getByTestId(`button-manage-case-${caseId}`);
  await expect(manageButton).toBeVisible({ timeout: 15_000 });
  await manageButton.click();

  const receiptsItem = page.getByTestId(`menu-receipts-${caseId}`);
  await expect(receiptsItem).toBeVisible({ timeout: 5_000 });
  await receiptsItem.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// Approve path
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin — approving a reactivation receipt decrements the Cases-tab reactivation badge", () => {
  let accessCode: string;
  let caseId: string;
  let receiptId: number;
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

    accessCode = uniqueAccessCode("E2ERBAP");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Reactivation Badge Approve E2E",
      });
      receiptId = await insertReactivationReceipt(DATABASE_URL, caseId);
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
    "approving a reactivation receipt decrements the nav badge and clears the per-case badge",
    async ({ page }) => {
      // ── Step 1: log into the admin dashboard ──────────────────────────────
      await loginAdminUi(page);

      // ── Step 2: pin the cases list to this case ───────────────────────────
      await page.getByTestId("input-search-cases").fill(accessCode);

      // ── Step 3: the per-case badge must appear ────────────────────────────
      //
      // CasesTab renders badge-reactivation-pending-<id> when a case is
      // disabled and its reactivationPendingCounts entry is > 0.
      const caseBadge = page.getByTestId(
        `badge-reactivation-pending-${caseId}`,
      );
      await expect(caseBadge).toBeVisible({ timeout: 30_000 });

      // ── Step 4: record the nav badge total before acting ──────────────────
      const before = await readNavReactivationBadge(page);
      expect(
        before,
        "nav badge total must include the seeded receipt",
      ).toBeGreaterThanOrEqual(1);

      // ── Step 5: open the receipts dialog ──────────────────────────────────
      await openReceiptsDialog(page, caseId, accessCode);

      // ── Step 6: approve the reactivation receipt ──────────────────────────
      const approveButton = page.getByTestId(
        `button-approve-receipt-${receiptId}`,
      );
      await expect(approveButton).toBeVisible({ timeout: 10_000 });
      await expect(approveButton).toContainText("Approve & Reactivate");
      await approveButton.click();

      // ── Step 7: nav badge total must decrement by exactly one ─────────────
      //
      // onActioned → loadReactivationPendingCounts re-fetches; the total drops
      // by exactly one.
      await expect
        .poll(() => readNavReactivationBadge(page), { timeout: 15_000 })
        .toBe(before - 1);

      // ── Step 8: the per-case badge must disappear ─────────────────────────
      await page.keyboard.press("Escape");
      await expect(
        page.getByTestId(`badge-reactivation-pending-${caseId}`),
      ).toHaveCount(0, { timeout: 15_000 });
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Reject path
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin — rejecting a reactivation receipt decrements the Cases-tab reactivation badge", () => {
  let accessCode: string;
  let caseId: string;
  let receiptId: number;
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

    accessCode = uniqueAccessCode("E2ERBRJ");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Reactivation Badge Reject E2E",
      });
      receiptId = await insertReactivationReceipt(DATABASE_URL, caseId);
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
    "rejecting a reactivation receipt decrements the nav badge and clears the per-case badge",
    async ({ page }) => {
      // ── Step 1: log into the admin dashboard ──────────────────────────────
      await loginAdminUi(page);

      // ── Step 2: pin the cases list to this case ───────────────────────────
      await page.getByTestId("input-search-cases").fill(accessCode);

      // ── Step 3: the per-case badge must appear ────────────────────────────
      const caseBadge = page.getByTestId(
        `badge-reactivation-pending-${caseId}`,
      );
      await expect(caseBadge).toBeVisible({ timeout: 30_000 });

      // ── Step 4: record the nav badge total before acting ──────────────────
      const before = await readNavReactivationBadge(page);
      expect(
        before,
        "nav badge total must include the seeded receipt",
      ).toBeGreaterThanOrEqual(1);

      // ── Step 5: open the receipts dialog ──────────────────────────────────
      await openReceiptsDialog(page, caseId, accessCode);

      // ── Step 6: reject the reactivation receipt ───────────────────────────
      //
      // Race the button click against the PATCH round-trip so the
      // poll below starts only after the server has responded.
      const rejectButton = page.getByTestId(
        `button-reject-receipt-${receiptId}`,
      );
      await expect(rejectButton).toBeVisible({ timeout: 10_000 });
      const [patchResponse] = await Promise.all([
        page.waitForResponse(
          (resp) =>
            /\/api\/deposit-receipts\//.test(resp.url()) &&
            resp.request().method() === "PATCH",
          { timeout: 15_000 },
        ),
        rejectButton.click(),
      ]);
      expect(
        patchResponse.status(),
        "PATCH /api/deposit-receipts/:id must return 200 on rejection",
      ).toBe(200);

      // ── Step 7: nav badge total must decrement by exactly one ─────────────
      //
      // loadReactivationPendingCounts fires on every successful receipt action
      // (approve or reject), not only on approval, so the nav badge must drop
      // on the reject path too.
      await expect
        .poll(() => readNavReactivationBadge(page), { timeout: 15_000 })
        .toBe(before - 1);

      // ── Step 8: the per-case badge must disappear ─────────────────────────
      await page.keyboard.press("Escape");
      await expect(
        page.getByTestId(`badge-reactivation-pending-${caseId}`),
      ).toHaveCount(0, { timeout: 15_000 });
    },
  );
});
