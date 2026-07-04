// Regression guard: clicking the "Pending Refund Claims" KPI card in the
// Cases-tab strip narrows the cases table to rows with
// refundClaimStatus === 'submitted' and pre-selects the dropdown to
// "Submitted".
//
// What this spec covers:
//   Test 1 — filter applied:
//   1. Seed two cases:
//      - Case A: refund claim activated and submitted (refundClaimStatus = 'submitted')
//      - Case B: no refund claim at all (refundClaimStatus = null)
//   2. Log into the admin dashboard and wait for the initial data to settle
//      (admin-data-ready sentinel) so the KPI card reflects the seeded claim.
//   3. Click the `kpi-pending_refund_claims` card.
//   4. Assert that `select-refund-claim-filter` shows "Submitted" — filter applied.
//   5. Search for Case B (no claim) and assert its row is NOT visible — proving
//      the table is narrowed to submitted-only rows (filter exclusion works).
//   6. Search for Case A (submitted) and assert its row IS visible — proving
//      submitted rows still appear (filter inclusion works).
//
//   Test 2 — filter cleared via reset button:
//   1. Seed one case with a submitted refund claim so the KPI card appears.
//   2. Click the KPI card to apply the filter (dropdown → "Submitted").
//   3. Click the `button-clear-all-filters` "Clear filters" button.
//   4. Assert `select-refund-claim-filter` reverts to "All Refund Claims".
//
//   Test 3 — filter cleared via chip (×) button:
//   1. Seed one case with a submitted refund claim so the KPI card appears.
//   2. Click the KPI card to apply the filter (dropdown → "Submitted").
//   3. Type a search query so a second active filter is present.
//   4. Click the `button-clear-refund-claim-filter` chip (×) button.
//   5. Assert `select-refund-claim-filter` reverts to "All Refund Claims".
//   6. Assert the search box still contains its previous value (chip only
//      clears the refund-claim filter, not unrelated filters).
//
// Cleanup runs in a finally block so seeded data is removed even when an
// assertion fails mid-test.
//
// Relevant source:
//   - client/src/components/admin/CasesKpiStrip.tsx   — KPI card strip
//   - client/src/components/admin/tabs/CasesTab.tsx   — onFilter handler +
//                                                        select-refund-claim-filter +
//                                                        button-clear-all-filters

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  uniqueEmail,
  createCase,
  issuePortalSession,
  deleteCase,
  loginAdminUi as loginAdminUiBase,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const TEST_PIN = "963852";

const SAMPLE_ENTRIES = [
  {
    amount: "500",
    chargedFor: "Activation fee",
    date: "2025-01-15",
    txId: "kpi-e2e-rc-001",
    network: "TRC20",
    notes: "E2E KPI refund-claim filter test",
  },
];

// ── API helpers ───────────────────────────────────────────────────────────────

async function activateRefundClaim(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.post(`/api/cases/${caseId}/refund-claim/request`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { documentaryRecommendations: "Please provide bank statement." },
  });
  expect(res.status(), "activate refund claim").toBe(200);
}

async function submitRefundClaim(
  api: APIRequestContext,
  sessionToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.patch(`/api/cases/${caseId}/refund-claim`, {
    headers: { "x-portal-session-token": sessionToken },
    data: { entries: SAMPLE_ENTRIES, submit: true },
  });
  expect(res.status(), "submit refund claim").toBe(200);
}

// ── UI helpers ────────────────────────────────────────────────────────────────

/**
 * Log into the admin dashboard and wait for the "admin-data-ready" sentinel
 * so KPI counts and case lists reflect real data rather than racing the
 * polling loop.
 */
async function loginAdminUi(page: import("@playwright/test").Page): Promise<void> {
  await loginAdminUiBase(page);
  await expect(page.getByTestId("admin-data-ready")).toBeAttached({
    timeout: 30_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin — Cases KPI strip: Pending Refund Claims filter", () => {
  // Standard env-skip guard: silently skip the entire suite when admin
  // credentials are absent (e.g. in lightweight local runs that omit the
  // admin credential env vars). In the main e2e CI workflow these variables
  // are always present, so the suite always executes there.
  // check-e2e-skip-guards.sh verifies that ADMIN_USERNAME and ADMIN_PASSWORD
  // are declared in every Playwright workflow env: block.
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the cases-kpi-strip e2e tests",
  );

  test.beforeEach(() => {
    test.setTimeout(120_000);
  });

  test("clicking the Pending Refund Claims card narrows the table to submitted-only rows", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // Track IDs so the finally block can clean up regardless of failures.
    let caseAId = "";
    let caseBId = "";

    try {
      // ---------------------------------------------------------------- seed
      //
      // Case A — submitted refund claim (must appear after filter is applied)
      const accessCodeA = uniqueAccessCode("E2EKRCA");
      caseAId = await createCase(api, adminToken, accessCodeA, {
        userName: "E2E KPI Refund Submitted",
        extraPatch: { userEmail: uniqueEmail("e2e-krca") },
      });
      const sessionTokenA = await issuePortalSession(api, accessCodeA, TEST_PIN);
      await activateRefundClaim(api, adminToken, caseAId);
      await submitRefundClaim(api, sessionTokenA, caseAId);

      // Case B — no refund claim (must be absent after filter is applied)
      const accessCodeB = uniqueAccessCode("E2EKRCB");
      caseBId = await createCase(api, adminToken, accessCodeB, {
        userName: "E2E KPI No Refund Claim",
        extraPatch: { userEmail: uniqueEmail("e2e-krcb") },
      });

      // ------------------------------------------ sign in to admin UI
      await loginAdminUi(page);

      // The KPI card only renders when refundClaimPendingCount > 0 (satisfied
      // because Case A has a submitted claim). Poll until it appears in case
      // data settled a tick after the sentinel.
      const kpiCard = page.getByTestId("kpi-pending_refund_claims");
      await expect(kpiCard).toBeVisible({ timeout: 20_000 });

      // -------------------------------------------------- click-through
      await kpiCard.click();

      // ── Assert 1: dropdown shows "Submitted" (filter state applied) ──────
      const filterSelect = page.getByTestId("select-refund-claim-filter");
      await expect(filterSelect).toBeVisible({ timeout: 15_000 });
      await expect(filterSelect).toContainText("Submitted");

      // ── Assert 2: Case B (no claim) is absent — filter excludes non-submitted
      //
      // Search by Case B's access code so the table is narrowed to at most
      // one result. If the filter is broken and non-submitted rows appear,
      // the manage button would be visible and this assertion would catch it.
      const searchBox = page.getByTestId("input-search-cases");
      await expect(searchBox).toBeVisible({ timeout: 10_000 });
      await searchBox.fill(accessCodeB);

      const manageBtnB = page.getByTestId(`button-manage-case-${caseBId}`);
      await expect(manageBtnB).not.toBeVisible({ timeout: 10_000 });

      // ── Assert 3: Case A (submitted) is visible — filter includes matching rows
      //
      // Replace the search with Case A's access code. The refund-claim filter
      // remains applied (search and filter are independent state).
      await searchBox.fill(accessCodeA);

      const manageBtnA = page.getByTestId(`button-manage-case-${caseAId}`);
      await expect(manageBtnA).toBeVisible({ timeout: 15_000 });
    } finally {
      if (caseAId) await deleteCase(api, adminToken, caseAId).catch(() => {});
      if (caseBId) await deleteCase(api, adminToken, caseBId).catch(() => {});
      await api.dispose();
    }
  });

  test("clicking Clear filters after a KPI filter resets the dropdown to All Refund Claims", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    let caseId = "";

    try {
      // ---------------------------------------------------------------- seed
      //
      // One case with a submitted refund claim so the KPI card is visible.
      const accessCode = uniqueAccessCode("E2EKRCC");
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "E2E KPI Clear Filter",
        extraPatch: { userEmail: uniqueEmail("e2e-krcc") },
      });
      const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);
      await activateRefundClaim(api, adminToken, caseId);
      await submitRefundClaim(api, sessionToken, caseId);

      // ------------------------------------------ sign in to admin UI
      await loginAdminUi(page);

      // Wait for KPI card (requires at least one submitted claim).
      const kpiCard = page.getByTestId("kpi-pending_refund_claims");
      await expect(kpiCard).toBeVisible({ timeout: 20_000 });

      // ── Step 1: apply the filter via KPI card click ───────────────────────
      await kpiCard.click();

      const filterSelect = page.getByTestId("select-refund-claim-filter");
      await expect(filterSelect).toBeVisible({ timeout: 15_000 });
      await expect(filterSelect).toContainText("Submitted");

      // ── Step 2: click "Clear filters" ────────────────────────────────────
      const clearBtn = page.getByTestId("button-clear-all-filters");
      await expect(clearBtn).toBeVisible({ timeout: 10_000 });
      await clearBtn.click();

      // ── Assert: dropdown reverts to "All Refund Claims" ──────────────────
      await expect(filterSelect).toContainText("All Refund Claims", {
        timeout: 10_000,
      });
    } finally {
      if (caseId) await deleteCase(api, adminToken, caseId).catch(() => {});
      await api.dispose();
    }
  });

  test("clicking the chip (×) clears only the refund-claim filter while leaving other filters intact", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    let caseId = "";

    try {
      // ---------------------------------------------------------------- seed
      //
      // One case with a submitted refund claim so the KPI card is visible.
      const accessCode = uniqueAccessCode("E2EKRCD");
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "E2E KPI Chip Clear Filter",
        extraPatch: { userEmail: uniqueEmail("e2e-krcd") },
      });
      const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);
      await activateRefundClaim(api, adminToken, caseId);
      await submitRefundClaim(api, sessionToken, caseId);

      // ------------------------------------------ sign in to admin UI
      await loginAdminUi(page);

      // Wait for KPI card (requires at least one submitted claim).
      const kpiCard = page.getByTestId("kpi-pending_refund_claims");
      await expect(kpiCard).toBeVisible({ timeout: 20_000 });

      // ── Step 1: apply the filter via KPI card click ───────────────────────
      await kpiCard.click();

      const filterSelect = page.getByTestId("select-refund-claim-filter");
      await expect(filterSelect).toBeVisible({ timeout: 15_000 });
      await expect(filterSelect).toContainText("Submitted");

      // ── Step 2: add a second active filter (search query) ─────────────────
      //
      // Type a non-empty string into the search box so a second independent
      // filter is active. This ensures the chip clears only its own filter.
      const searchBox = page.getByTestId("input-search-cases");
      await expect(searchBox).toBeVisible({ timeout: 10_000 });
      const searchQuery = "chip-isolation-check";
      await searchBox.fill(searchQuery);

      // ── Step 3: click the refund-claim chip (×) ───────────────────────────
      //
      // The chip is rendered only when refundClaimStatusFilter !== "all".
      const chipBtn = page.getByTestId("button-clear-refund-claim-filter");
      await expect(chipBtn).toBeVisible({ timeout: 10_000 });
      await chipBtn.click();

      // ── Assert A: refund-claim dropdown reverts to "All Refund Claims" ─────
      await expect(filterSelect).toContainText("All Refund Claims", {
        timeout: 10_000,
      });

      // ── Assert B: chip disappears (filter is now "all") ───────────────────
      await expect(chipBtn).not.toBeVisible({ timeout: 5_000 });

      // ── Assert C: search box still holds its previous value ───────────────
      //
      // The chip must not have reset unrelated state. If a refactor changed
      // the chip's onClick to call clearAllFilters() instead of the
      // targeted setter, the search box would be empty and this fails.
      await expect(searchBox).toHaveValue(searchQuery);
    } finally {
      if (caseId) await deleteCase(api, adminToken, caseId).catch(() => {});
      await api.dispose();
    }
  });
});
