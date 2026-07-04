// Regression guard: the admin receipts dialog skeleton-to-content transition
// must work correctly whenever "View Receipts" is opened on a case row.
//
// What this spec covers:
//
//   1. While the deposit-receipts fetch is in flight, the loading skeleton
//      (aria-label="Loading receipts…") must be visible and the resolved
//      content must be absent.
//
//   2. Once the fetch settles, the skeleton must disappear and the receipt
//      list or empty state ("No receipts uploaded yet") must appear — i.e.
//      the skeleton and real content are never simultaneously visible at
//      steady state.
//
// The "loading while in flight" assertion requires us to observe the browser
// mid-request.  To guarantee the window is wide enough for Playwright to catch
// the intermediate state, we intercept the deposit-receipts API call and delay
// it by 600 ms.
//
// Relevant source:
//   - client/src/components/admin/DepositReceiptsDialog.tsx — ReceiptsLoadingSkeleton
//   - client/src/pages/AdminDashboard.tsx — openReceiptsDialog / loadDepositReceipts
//   - client/src/components/admin/tabs/CasesTab.tsx — menu-receipts-<id> button

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  loginAdminUi,
  localTimeout,
} from "./helpers";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

// Opens the receipts dialog for a given case via the Cases tab search +
// manage dropdown. Returns once the "View Receipts" menu item has been clicked.
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

test.describe("Admin receipts dialog — skeleton-to-content loading animation", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test.beforeEach(() => {
    test.setTimeout(localTimeout(120_000));
  });

  test("skeleton is visible while the deposit-receipts fetch is in flight and disappears once it resolves", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ----------------------------------------------------------------- seed
    const accessCode = uniqueAccessCode();
    const caseId = await createCase(api, adminToken, accessCode);

    // ------------------------------------------ sign in to admin dashboard
    await loginAdminUi(page);

    // Intercept the deposit-receipts call and delay it by 600 ms so
    // Playwright has a comfortable window to observe the skeleton.
    await page.route(`**/api/cases/${caseId}/deposit-receipts*`, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });

    // --------------------------------- open the receipts dialog
    await openReceiptsDialog(page, caseId, accessCode);

    // ── Assert the skeleton is visible WHILE the fetch is still in flight ──
    //
    // ReceiptsLoadingSkeleton renders an element with aria-label="Loading receipts…".
    // We use the accessible label as the selector so the assertion is tied to
    // semantic intent rather than an internal CSS class name.
    const skeleton = page.getByLabel("Loading receipts…");
    await expect(skeleton).toBeVisible({ timeout: 3_000 });

    // Real content must be absent while the skeleton is shown.
    await expect(page.getByText("No receipts uploaded yet")).toHaveCount(0);

    // ── Wait for the fetch to settle, then assert steady state ─────────────
    //
    // A newly-created case has no receipts, so the empty state is the
    // expected resolved content.
    await expect(page.getByText("No receipts uploaded yet")).toBeVisible({
      timeout: 10_000,
    });

    // The skeleton must be gone once real content is shown.
    await expect(skeleton).toHaveCount(0);

    // Verify skeleton and resolved content are never simultaneously visible.
    const skeletonCount = await skeleton.count();
    const emptyStateCount = await page.getByText("No receipts uploaded yet").count();
    expect(
      skeletonCount === 0 && emptyStateCount === 1,
      "receipts skeleton and resolved content must not be simultaneously visible",
    ).toBe(true);

    await api.dispose();
  });

  test("closing and re-opening the dialog re-shows the skeleton before content", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ----------------------------------------------------------------- seed
    const accessCode = uniqueAccessCode();
    const caseId = await createCase(api, adminToken, accessCode);

    // ------------------------------------------ sign in to admin dashboard
    await loginAdminUi(page);

    // First open — no delay, just confirm the dialog works end-to-end.
    await openReceiptsDialog(page, caseId, accessCode);
    await expect(page.getByText("No receipts uploaded yet")).toBeVisible({
      timeout: 10_000,
    });

    // Close the dialog.
    await page.keyboard.press("Escape");
    await expect(page.getByText("No receipts uploaded yet")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Add a delay for the second open to catch the skeleton mid-flight.
    await page.route(`**/api/cases/${caseId}/deposit-receipts*`, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });

    // Re-open via the same manage dropdown (search is still populated).
    const manageButton = page.getByTestId(`button-manage-case-${caseId}`);
    await expect(manageButton).toBeVisible({ timeout: 10_000 });
    await manageButton.click();

    const receiptsItem = page.getByTestId(`menu-receipts-${caseId}`);
    await expect(receiptsItem).toBeVisible({ timeout: 5_000 });
    await receiptsItem.click();

    // Skeleton must reappear on the second open.
    const skeleton = page.getByLabel("Loading receipts…");
    await expect(skeleton).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("No receipts uploaded yet")).toHaveCount(0);

    // Skeleton disappears and resolved content appears after load.
    await expect(page.getByText("No receipts uploaded yet")).toBeVisible({
      timeout: 10_000,
    });
    await expect(skeleton).toHaveCount(0);

    await api.dispose();
  });
});
