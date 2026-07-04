/**
 * e2e/admin-all-receipts-reactivation-filter.spec.ts
 *
 * Regression guard for the "Reactivation" category filter in the admin
 * All Receipts tab (AllReceiptsTab.tsx).
 *
 * Flow under test:
 *   1. Log into the admin dashboard via the token-injection shortcut.
 *   2. Intercept GET /api/deposits/all-receipts via page.route() so the test
 *      returns a synthetic reactivation receipt (category='reissue',
 *      reissueId=null) without touching the database.
 *   3. Navigate to the "All Receipts" tab.
 *   4. Assert the amber "Reactivation" badge renders on the row.
 *   5. Open the category filter dropdown and select "Reactivation".
 *   6. Assert the row and the amber "Reactivation" badge are still visible
 *      after the filtered fetch resolves.
 *   7. Assert that non-reactivation receipts (e.g. activation) are NOT
 *      visible after the filter is applied (narrowing-behaviour guard).
 *
 * Why route interception?
 * ───────────────────────
 * The feature under test is purely client-side: AllReceiptsTab.tsx calls
 * isReactivationReceipt() on each row returned by the API and renders the
 * amber badge whenever category==='reissue' && reissueId===null.  The
 * category dropdown changes the ?category= query parameter and re-fetches.
 * There is no need to seed real database state — mocking the API response
 * is simpler, faster, and decoupled from server-side filtering logic.
 *
 * Relevant source
 * ───────────────
 * - client/src/components/admin/AllReceiptsTab.tsx — isReactivationReceipt(),
 *     filter-all-receipts-category SelectTrigger, badge-all-receipts-reactivation-*
 * - client/src/components/admin/AdminGroupedNav.tsx — tab-receipts trigger
 */

import { test, expect } from "@playwright/test";
import { loginAdminUi, localTimeout} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

/** Synthetic receipt that satisfies isReactivationReceipt(): category=reissue, reissueId=null */
const MOCK_RECEIPT_ID = 77_777;
const MOCK_REACTIVATION_RECEIPT = {
  source: "deposit",
  id: MOCK_RECEIPT_ID,
  caseId: "e2e-mock-reactivation-case",
  accessCode: "E2ERACT",
  category: "reissue",
  status: "pending",
  fileName: null,
  notes: "Mock reactivation deposit for E2E",
  adminNotes: null,
  amountUsdt: null,
  reissueId: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date().toISOString(),
  alertMuted: false,
};

/** Synthetic activation receipt — must NOT appear when "Reactivation" filter is active */
const MOCK_ACTIVATION_ID = 88_888;
const MOCK_ACTIVATION_RECEIPT = {
  source: "deposit",
  id: MOCK_ACTIVATION_ID,
  caseId: "e2e-mock-activation-case",
  accessCode: "E2EACTV",
  category: "activation",
  status: "pending",
  fileName: null,
  notes: "Mock activation deposit for E2E",
  adminNotes: null,
  amountUsdt: null,
  reissueId: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date().toISOString(),
  alertMuted: false,
};

test.describe("All Receipts tab — Reactivation category filter", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run this e2e test",
      );
    }
  });

  test.setTimeout(localTimeout(120_000));

  test(
    "selecting 'Reactivation' in the category filter shows the row with the amber Reactivation badge",
    async ({ page }) => {
      // ── Step 1: Intercept all-receipts BEFORE navigation so the dashboard's
      //            background poll is also captured ─────────────────────────
      //
      // AllReceiptsTab calls GET /api/deposits/all-receipts (optionally with
      // ?category=reactivation after the filter changes).  When no category
      // filter is active both receipts are returned; when the Reactivation
      // filter is applied (?category=reactivation) only the reactivation
      // receipt is returned, mirroring what the real server would do.
      await page.route("**/api/deposits/all-receipts**", async (route) => {
        const url = route.request().url();
        const isFiltered = url.includes("category=reactivation");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            isFiltered
              ? [MOCK_REACTIVATION_RECEIPT]
              : [MOCK_REACTIVATION_RECEIPT, MOCK_ACTIVATION_RECEIPT],
          ),
        });
      });

      // ── Step 2: Log into the admin dashboard ──────────────────────────────
      await loginAdminUi(page);

      // ── Step 3: Click the "All Receipts" tab in the sidebar nav ───────────
      //
      // AdminGroupedNav renders each nav item as a TabsTrigger with
      // data-testid=`tab-${item.id}`.  The All Receipts item has id="receipts".
      const receiptsTab = page.getByTestId("tab-receipts");
      await expect(receiptsTab).toBeVisible({ timeout: 15_000 });
      await receiptsTab.click();

      // ── Step 4: Both rows must appear in the unfiltered ("all categories")
      //            default view ───────────────────────────────────────────────
      //
      // AllReceiptsTab renders each row as:
      //   data-testid={`all-receipt-row-${r.source}-${r.id}`}
      // And the amber Reactivation badge as:
      //   data-testid={`badge-all-receipts-reactivation-${r.source}-${r.id}`}
      const reactivationBadge = page.getByTestId(
        `badge-all-receipts-reactivation-deposit-${MOCK_RECEIPT_ID}`,
      );
      await expect(reactivationBadge).toBeVisible({ timeout: 15_000 });
      await expect(reactivationBadge).toContainText("Reactivation");

      const activationRow = page.getByTestId(
        `all-receipt-row-deposit-${MOCK_ACTIVATION_ID}`,
      );
      await expect(activationRow).toBeVisible({ timeout: 10_000 });

      // ── Step 5: Open the category filter and select "Reactivation" ────────
      //
      // The SelectTrigger has data-testid="filter-all-receipts-category".
      // Clicking it opens a Radix Select portal; the option can be located
      // by role and name regardless of portal attachment point.
      const categoryTrigger = page.getByTestId("filter-all-receipts-category");
      await expect(categoryTrigger).toBeVisible({ timeout: 5_000 });
      await categoryTrigger.click();

      const reactivationOption = page.getByRole("option", {
        name: "Reactivation",
      });
      await expect(reactivationOption).toBeVisible({ timeout: 5_000 });
      await reactivationOption.click();

      // ── Step 6: After the filtered fetch resolves, the reactivation row and
      //            badge must still be visible ──────────────────────────────
      //
      // AllReceiptsTab sets categoryFilter='reactivation', re-fetches with
      // ?category=reactivation (intercepted above → reactivation receipt only),
      // then renders the result.  The row testid is:
      //   data-testid={`all-receipt-row-${r.source}-${r.id}`}
      const reactivationRow = page.getByTestId(
        `all-receipt-row-deposit-${MOCK_RECEIPT_ID}`,
      );
      await expect(reactivationRow).toBeVisible({ timeout: 10_000 });
      await expect(reactivationBadge).toBeVisible({ timeout: 5_000 });

      // ── Step 7: The activation row must NOT be visible after filtering ─────
      //
      // This guards against a regression where the filter has no effect and
      // the component renders all receipts regardless of the selected category.
      await expect(activationRow).not.toBeVisible({ timeout: 5_000 });
    },
  );
});
