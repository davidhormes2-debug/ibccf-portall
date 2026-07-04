/**
 * e2e/admin-reactivation-receipt.spec.ts
 *
 * End-to-end regression guards for the reactivation-receipt admin flow.
 *
 * Test 1 — Approval path:
 *   1. Seed a disabled case with a pending reactivation receipt (category=
 *      'reissue', reissue_id=NULL) directly via the database so the test
 *      bypasses the portal-session guard on the upload endpoint.
 *   2. Log into the admin dashboard via the token-injection shortcut.
 *   3. Find the case in the Cases tab and open the "View Receipts" menu item.
 *   4. Assert the amber "Reactivation" badge is visible on the receipt row.
 *   5. Click "Approve & Reactivate".
 *   6. Assert the "Account Reactivated" toast appears in the UI.
 *
 * Test 2 — Rejection path:
 *   1. Seed a separate disabled case with a pending reactivation receipt.
 *   2. Log into the admin dashboard.
 *   3. Open the Receipts dialog for that case.
 *   4. Click "Reject".
 *   5. Assert the "Account Reactivated" toast does NOT appear.
 *   6. Assert the receipt status badge updates to "rejected".
 *   7. Assert the case remains locked (isDisabled=true).
 *
 * Test 3 — Rejection with admin note path:
 *   1. Seed a separate disabled case with a pending reactivation receipt.
 *   2. Log into the admin dashboard.
 *   3. Open the Receipts dialog for that case.
 *   4. Fill in the admin notes textarea with a reason.
 *   5. Click "Reject".
 *   6. Assert the receipt status badge updates to "rejected".
 *   7. Assert the admin notes text is rendered in the receipt row.
 *   8. Assert the note is persisted server-side (re-fetch via admin API).
 *
 * Data lifecycle
 * ─────────────
 * Each describe block owns one disabled case (with one pending reactivation
 * receipt).  Cases are created in beforeAll and removed in afterAll.  A
 * unique random suffix prevents collisions between parallel CI runs.
 *
 * Relevant source
 * ───────────────
 * - client/src/components/admin/DepositReceiptsDialog.tsx — "Reactivation"
 *     badge, "Approve & Reactivate" button, admin notes textarea
 *     (textarea-admin-notes-<id>), "Reject" button (isReactivation guard),
 *     badge-receipt-status-<id> data-testid, and text-admin-notes-<id>
 * - client/src/pages/AdminDashboard.tsx — updateReceiptStatus handler that
 *     fires the "Account Reactivated" toast when accountReactivated===true
 * - server/routes/deposits.ts — PATCH /api/deposits/:id — adminNotes param
 * - server/__tests__/deposits.reactivationReceipt.test.ts — unit coverage
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
 * directly into the database.  The server-side upload endpoint requires a live
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
       VALUES ($1, 'reissue', 'pending', 'Reactivation deposit receipt')
       RETURNING id`,
      [caseId],
    );
    return result.rows[0].id;
  } finally {
    await pg.end();
  }
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
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin reactivation-receipt approval — E2E", () => {
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

    accessCode = uniqueAccessCode("E2ERCPT");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Reactivation Receipt E2E",
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
    '"Reactivation" badge is visible and approving the receipt shows "Account Reactivated" toast',
    async ({ page }) => {
      // ── Step 1: log into the admin dashboard ──────────────────────────────
      await loginAdminUi(page);

      // ── Step 2: open the receipts dialog for the disabled case ────────────
      await openReceiptsDialog(page, caseId, accessCode);

      // ── Step 3: "Reactivation" badge must be visible ──────────────────────
      //
      // DepositReceiptsDialog renders the badge when
      //   receipt.category === 'reissue' && !receipt.reissueId
      // which is exactly the condition that also gates the "Approve &
      // Reactivate" button and the server-side reactivation path.
      const reactivationBadge = page.getByText("Reactivation", { exact: true });
      await expect(reactivationBadge).toBeVisible({ timeout: 10_000 });

      // ── Step 3b: confirm isDisabled=true before approval via the admin API ──
      //
      // This proves the seeded case is actually locked and makes the
      // post-approval UI assertion meaningful.  page.request is a
      // Playwright APIRequestContext that can issue requests directly.
      const adminToken = readAdminToken();
      const caseResp = await page.request.get(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const caseBody = await caseResp.json() as { isDisabled?: boolean };
      expect(caseBody.isDisabled, "case must be disabled before approval").toBe(true);

      // ── Step 4: click "Approve & Reactivate" ─────────────────────────────
      const approveButton = page.getByTestId(
        `button-approve-receipt-${receiptId}`,
      );
      await expect(approveButton).toBeVisible({ timeout: 5_000 });
      await expect(approveButton).toContainText("Approve & Reactivate");
      await approveButton.click();

      // ── Step 5: "Account Reactivated" toast must appear ───────────────────
      //
      // AdminDashboard fires toast({ title: "Account Reactivated", … }) when
      // the PATCH /api/deposits/:id response includes accountReactivated:true.
      // The Radix Toast viewport is labelled "Notifications" in the DOM so
      // Playwright can locate the visible toast by its title text.
      await expect(
        page.getByText("Account Reactivated"),
      ).toBeVisible({ timeout: 15_000 });

      // ── Step 6: LOCKED badge must disappear from the Cases tab ────────────
      //
      // After the toast the dashboard calls loadData(false) to refresh the
      // case list.  Once the refresh completes, the badge-locked-<id> element
      // (rendered in CasesTab when c.isDisabled===true) must no longer exist.
      // This proves that the isDisabled flag actually flipped in the UI —
      // the primary regression this spec is designed to catch.
      //
      // Close the receipts dialog first so the Cases tab row is interactable.
      await page.keyboard.press("Escape");
      await expect(
        page.getByTestId(`badge-locked-${caseId}`),
      ).toHaveCount(0, { timeout: 15_000 });
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Rejection path
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin reactivation-receipt rejection — E2E", () => {
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

    accessCode = uniqueAccessCode("E2ERCPTREJ");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Reactivation Rejection E2E",
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
    'Rejecting a reactivation receipt leaves the account locked and shows no "Account Reactivated" toast',
    async ({ page }) => {
      // ── Step 1: log into the admin dashboard ──────────────────────────────
      await loginAdminUi(page);

      // ── Step 2: open the receipts dialog for the disabled case ────────────
      await openReceiptsDialog(page, caseId, accessCode);

      // ── Step 3: "Reactivation" badge must be visible ──────────────────────
      const reactivationBadge = page.getByText("Reactivation", { exact: true });
      await expect(reactivationBadge).toBeVisible({ timeout: 10_000 });

      // ── Step 4: click "Reject" and wait for the PATCH to settle ─────────
      //
      // We race the button click against the network round-trip so the
      // assertion window below starts only after the server has responded.
      // This avoids the false-green "not yet present" window that exists
      // between the click and the fetch completing.
      const rejectButton = page.getByTestId(
        `button-reject-receipt-${receiptId}`,
      );
      await expect(rejectButton).toBeVisible({ timeout: 5_000 });
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

      // ── Step 5: "Account Reactivated" toast must NOT appear ───────────────
      //
      // The server only sets accountReactivated:true on the approval path.
      // Now that the full PATCH round-trip has completed and the React
      // updateReceiptStatus handler has run (it fires the toast synchronously
      // inside the same microtask tick as the fetch), any reactivation toast
      // would already be in the DOM.  A count of 0 here is reliable.
      await expect(
        page.getByText("Account Reactivated"),
      ).toHaveCount(0);

      // ── Step 6: receipt badge must update to "rejected" ───────────────────
      //
      // updateReceiptStatus does an optimistic status flip so the badge
      // transitions without waiting for the next poll cycle.
      const statusBadge = page.getByTestId(
        `badge-receipt-status-${receiptId}`,
      );
      await expect(statusBadge).toBeVisible({ timeout: 10_000 });
      await expect(statusBadge).toContainText("rejected", { timeout: 10_000 });

      // ── Step 7: case must remain locked ───────────────────────────────────
      //
      // Rejection must never reactivate the account.  Confirm server-side
      // truth via the admin API (isDisabled must still be true).
      const freshToken = readAdminToken();
      const caseResp = await page.request.get(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      const caseBody = await caseResp.json() as { isDisabled?: boolean };
      expect(
        caseBody.isDisabled,
        "account must remain locked after receipt rejection",
      ).toBe(true);

      // ── Step 8: LOCKED badge must still be present in the Cases tab ───────
      //
      // Close the receipts dialog then verify the locked badge is still
      // rendered for this case — confirming the UI did not optimistically
      // unlock the account.
      await page.keyboard.press("Escape");
      await expect(
        page.getByTestId(`badge-locked-${caseId}`),
      ).toBeVisible({ timeout: 15_000 });
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Rejection with admin note path
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin reactivation-receipt rejection with admin note — E2E", () => {
  let accessCode: string;
  let caseId: string;
  let receiptId: number;
  let adminToken: string;

  const ADMIN_NOTE = "Receipt does not match the required deposit amount — please resubmit.";

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

    accessCode = uniqueAccessCode("E2ERCPTNOTE");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Reactivation Note Rejection E2E",
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
    "Rejecting a reactivation receipt with an admin note persists the note in the UI and server-side",
    async ({ page }) => {
      // ── Step 1: log into the admin dashboard ──────────────────────────────
      await loginAdminUi(page);

      // ── Step 2: open the receipts dialog for the disabled case ────────────
      await openReceiptsDialog(page, caseId, accessCode);

      // ── Step 3: "Reactivation" badge must be visible ──────────────────────
      const reactivationBadge = page.getByText("Reactivation", { exact: true });
      await expect(reactivationBadge).toBeVisible({ timeout: 10_000 });

      // ── Step 4: fill in the admin notes textarea ───────────────────────────
      //
      // DepositReceiptsDialog renders a per-receipt admin notes textarea
      // (data-testid="textarea-admin-notes-<id>") in the pending-receipt action
      // section. The value is passed as the third argument to updateReceiptStatus
      // when Reject is clicked, and forwarded to PATCH /api/deposit-receipts/:id
      // as the adminNotes body field.
      const notesTextarea = page.getByTestId(
        `textarea-admin-notes-${receiptId}`,
      );
      await expect(notesTextarea).toBeVisible({ timeout: 10_000 });
      await notesTextarea.fill(ADMIN_NOTE);

      // ── Step 5: click "Reject" and wait for the PATCH to settle ──────────
      const rejectButton = page.getByTestId(
        `button-reject-receipt-${receiptId}`,
      );
      await expect(rejectButton).toBeVisible({ timeout: 5_000 });
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
        "PATCH /api/deposit-receipts/:id must return 200 on rejection with admin note",
      ).toBe(200);

      // ── Step 6: receipt badge must update to "rejected" ───────────────────
      const statusBadge = page.getByTestId(
        `badge-receipt-status-${receiptId}`,
      );
      await expect(statusBadge).toBeVisible({ timeout: 10_000 });
      await expect(statusBadge).toContainText("rejected", { timeout: 10_000 });

      // ── Step 7: admin notes must be rendered in the receipt row ───────────
      //
      // After rejection the pending-action section is hidden and the receipt
      // row shows receipt.adminNotes in a <p data-testid="text-admin-notes-<id>">.
      // updateReceiptStatus does an optimistic UI update that also sets the
      // adminNotes field so the note appears immediately without a full refresh.
      const adminNotesEl = page.getByTestId(`text-admin-notes-${receiptId}`);
      await expect(adminNotesEl).toBeVisible({ timeout: 10_000 });
      await expect(adminNotesEl).toContainText(ADMIN_NOTE, { timeout: 10_000 });

      // ── Step 8: note must be persisted server-side ────────────────────────
      //
      // Re-fetch the receipt list via the admin API and confirm the adminNotes
      // field on the matching receipt equals the note we typed. This catches a
      // regression where the optimistic UI update succeeds but the PATCH body
      // omits adminNotes (e.g. the textarea value is not wired to the handler).
      const freshToken = readAdminToken();
      const receiptsResp = await page.request.get(
        `/api/cases/${caseId}/deposit-receipts`,
        { headers: { Authorization: `Bearer ${freshToken}` } },
      );
      expect(
        receiptsResp.status(),
        "GET /api/cases/:id/deposit-receipts must return 200",
      ).toBe(200);
      const receiptsBody = await receiptsResp.json() as Array<{
        id: number;
        adminNotes: string | null;
      }>;
      const seededReceipt = receiptsBody.find((r) => r.id === receiptId);
      expect(seededReceipt, "seeded receipt must appear in the response").toBeDefined();
      expect(
        seededReceipt?.adminNotes,
        "adminNotes must be persisted server-side",
      ).toBe(ADMIN_NOTE);
    },
  );
});
