// Regression guard: clicking the Approved or Rejected refund-claim pill in the
// Analytics tab's Refund Claims KPI card must switch to the Cases tab and
// apply the matching filter chip.  Unit tests (jsdom) cannot detect a missing
// onClick wiring or a broken navigation side-effect; these specs close that gap
// end-to-end in a real browser.
//
// Seeding flow for each pill:
//   1. Create a case via admin API (POST /api/cases + PATCH).
//   2. Admin activates the refund-claim flow      POST /:id/refund-claim/request
//   3. Portal user submits the claim              PATCH /:id/refund-claim {submit:true}
//   4. Admin approves OR rejects                  POST /:id/refund-claim/approve|reject
//
// Assertions:
//   Approved pill → Cases tab active, filter chip reads "Refund: Approved".
//   Rejected pill → Cases tab active, filter chip reads "Refund: Rejected".

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  uniqueEmail,
  createCase,
  issuePortalSession,
  loginAdminUi as loginAdminUiBase,
  localTimeout,
} from "./helpers";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

// ── Seeding helpers ───────────────────────────────────────────────────────────

async function activateRefundClaim(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.post(`/api/cases/${caseId}/refund-claim/request`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {},
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
    data: { submit: true, entries: [] },
  });
  expect(res.status(), "submit refund claim").toBe(200);
}

async function approveRefundClaim(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.post(`/api/cases/${caseId}/refund-claim/approve`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {},
  });
  expect(res.status(), "approve refund claim").toBe(200);
}

async function rejectRefundClaim(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.post(`/api/cases/${caseId}/refund-claim/reject`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {},
  });
  expect(res.status(), "reject refund claim").toBe(200);
}

// ── UI helpers ────────────────────────────────────────────────────────────────

async function loginAdminUi(page: import("@playwright/test").Page) {
  await loginAdminUiBase(page);
  // Wait for the explicit "initial data settled" sentinel so the Analytics
  // totals reflect real data rather than racing the polling loop.
  await expect(page.getByTestId("admin-data-ready")).toBeAttached({
    timeout: 30_000,
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe("Admin — Analytics Refund Claim KPI pills click-through", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test",
      );
    }
  });

  test.beforeEach(() => {
    test.setTimeout(localTimeout(120_000));
  });

  test("Approved pill switches to Cases tab with 'Refund: Approved' filter chip", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ── seed: case with approved refund claim ────────────────────────────────
    const accessCode = uniqueAccessCode("E2ERCA");
    const pin = "135791";
    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Refund Approved",
      extraPatch: { userEmail: uniqueEmail("rca") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, pin);
    await activateRefundClaim(api, adminToken, caseId);
    await submitRefundClaim(api, sessionToken, caseId);
    await approveRefundClaim(api, adminToken, caseId);

    // ── sign in ──────────────────────────────────────────────────────────────
    await loginAdminUi(page);

    // ── open Analytics tab ───────────────────────────────────────────────────
    await page.getByTestId("tab-analytics").click({ force: true });

    // The Approved pill renders only when refundClaimCounts.approved > 0.
    await expect(
      page.getByTestId("button-refund-approved-kpi"),
    ).toBeVisible({ timeout: 30_000 });

    // ── click the pill ───────────────────────────────────────────────────────
    await page.getByTestId("button-refund-approved-kpi").click();

    // ── assert Cases tab is active and filter chip shows "Approved" ──────────
    // The filter chip is rendered only when refundClaimStatusFilter !== "all".
    // The chip clear button is the reliable anchor (unique testid in the chip).
    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    // Scope the text assertion to the span that contains the clear button,
    // avoiding false matches from any other "Refund:" text on the page.
    const chip = page.locator(
      "span:has([data-testid='button-clear-refund-claim-filter'])",
    );
    await expect(chip).toContainText("Approved");

    // The Cases tab select filter must also be visible (confirms we're on the
    // Cases tab, not still on Analytics).
    await expect(
      page.getByTestId("select-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    await api.dispose();
  });

  test("Filter chip survives mid-session tab navigation and clears correctly on return", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ── seed: case with approved refund claim ────────────────────────────────
    const accessCode = uniqueAccessCode("E2ERCN");
    const pin = "357913";
    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Refund Nav",
      extraPatch: { userEmail: uniqueEmail("rcn") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, pin);
    await activateRefundClaim(api, adminToken, caseId);
    await submitRefundClaim(api, sessionToken, caseId);
    await approveRefundClaim(api, adminToken, caseId);

    // ── sign in ──────────────────────────────────────────────────────────────
    await loginAdminUi(page);

    // ── open Analytics tab and click the Approved pill ───────────────────────
    await page.getByTestId("tab-analytics").click({ force: true });

    await expect(
      page.getByTestId("button-refund-approved-kpi"),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("button-refund-approved-kpi").click();

    // Confirm the chip appears after the pill click (filter is active).
    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    // ── navigate away to another tab (Community) ──────────────────────────────
    await page.getByTestId("tab-community").click({ force: true });

    // ── return to Cases tab ───────────────────────────────────────────────────
    await page.getByTestId("tab-cases").click({ force: true });

    // ── chip must still be present and readable ───────────────────────────────
    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    const chip = page.locator(
      "span:has([data-testid='button-clear-refund-claim-filter'])",
    );
    await expect(chip).toContainText("Approved");

    // ── click × and verify the chip disappears ────────────────────────────────
    await page.getByTestId("button-clear-refund-claim-filter").click();

    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).not.toBeVisible();

    // The select must revert to "All Refund Claims".
    const selectTrigger = page.getByTestId("select-refund-claim-filter");
    await expect(selectTrigger).toBeVisible();
    await expect(selectTrigger).toContainText("All Refund Claims");

    await api.dispose();
  });

  test("Rejected filter chip survives mid-session tab navigation and clears correctly on return", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ── seed: case with rejected refund claim ────────────────────────────────
    const accessCode = uniqueAccessCode("E2ERCJ");
    const pin = "468024";
    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Refund Rejected Nav",
      extraPatch: { userEmail: uniqueEmail("rcj") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, pin);
    await activateRefundClaim(api, adminToken, caseId);
    await submitRefundClaim(api, sessionToken, caseId);
    await rejectRefundClaim(api, adminToken, caseId);

    // ── sign in ──────────────────────────────────────────────────────────────
    await loginAdminUi(page);

    // ── open Analytics tab and click the Rejected pill ───────────────────────
    await page.getByTestId("tab-analytics").click({ force: true });

    await expect(
      page.getByTestId("button-refund-rejected-kpi"),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("button-refund-rejected-kpi").click();

    // Confirm the chip appears after the pill click (filter is active).
    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    // ── navigate away to another tab (Community) ──────────────────────────────
    await page.getByTestId("tab-community").click({ force: true });

    // ── return to Cases tab ───────────────────────────────────────────────────
    await page.getByTestId("tab-cases").click({ force: true });

    // ── chip must still be present and readable ───────────────────────────────
    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    const chip = page.locator(
      "span:has([data-testid='button-clear-refund-claim-filter'])",
    );
    await expect(chip).toContainText("Rejected");

    // ── click × and verify the chip disappears ────────────────────────────────
    await page.getByTestId("button-clear-refund-claim-filter").click();

    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).not.toBeVisible();

    // The select must revert to "All Refund Claims".
    const selectTrigger = page.getByTestId("select-refund-claim-filter");
    await expect(selectTrigger).toBeVisible();
    await expect(selectTrigger).toContainText("All Refund Claims");

    await api.dispose();
  });

  test("Rejected pill switches to Cases tab with 'Refund: Rejected' filter chip", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ── seed: case with rejected refund claim ────────────────────────────────
    const accessCode = uniqueAccessCode("E2ERCR");
    const pin = "246802";
    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Refund Rejected",
      extraPatch: { userEmail: uniqueEmail("rcr") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, pin);
    await activateRefundClaim(api, adminToken, caseId);
    await submitRefundClaim(api, sessionToken, caseId);
    await rejectRefundClaim(api, adminToken, caseId);

    // ── sign in ──────────────────────────────────────────────────────────────
    await loginAdminUi(page);

    // ── open Analytics tab ───────────────────────────────────────────────────
    await page.getByTestId("tab-analytics").click({ force: true });

    // The Rejected pill renders only when refundClaimCounts.rejected > 0.
    await expect(
      page.getByTestId("button-refund-rejected-kpi"),
    ).toBeVisible({ timeout: 30_000 });

    // ── click the pill ───────────────────────────────────────────────────────
    await page.getByTestId("button-refund-rejected-kpi").click();

    // ── assert Cases tab is active and filter chip shows "Rejected" ──────────
    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    // Scope the text assertion to the span that contains the clear button,
    // avoiding false matches from any other "Refund:" text on the page.
    const chip = page.locator(
      "span:has([data-testid='button-clear-refund-claim-filter'])",
    );
    await expect(chip).toContainText("Rejected");

    await expect(
      page.getByTestId("select-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    await api.dispose();
  });

  test("Approved filter chip survives mid-session tab navigation when set via Cases tab select dropdown", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ── seed: case with approved refund claim ────────────────────────────────
    // Uses a distinct access-code prefix / PIN so it never collides with the
    // pill-click variants above.
    const accessCode = uniqueAccessCode("E2EADS");
    const pin = "691357";
    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Refund Approved Direct Select",
      extraPatch: { userEmail: uniqueEmail("ads") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, pin);
    await activateRefundClaim(api, adminToken, caseId);
    await submitRefundClaim(api, sessionToken, caseId);
    await approveRefundClaim(api, adminToken, caseId);

    // ── sign in ──────────────────────────────────────────────────────────────
    await loginAdminUi(page);

    // ── go directly to the Cases tab (skip Analytics entirely) ───────────────
    await page.getByTestId("tab-cases").click({ force: true });

    // Wait for the select to be visible before interacting.
    const selectTrigger = page.getByTestId("select-refund-claim-filter");
    await expect(selectTrigger).toBeVisible({ timeout: 15_000 });

    // ── set the filter to "Approved" via the dropdown ─────────────────────────
    await selectTrigger.click();
    // shadcn SelectContent renders in a portal; target the option by role+name.
    await page.getByRole("option", { name: "Approved" }).click();

    // The filter chip must now appear.
    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    const chipBefore = page.locator(
      "span:has([data-testid='button-clear-refund-claim-filter'])",
    );
    await expect(chipBefore).toContainText("Approved");

    // ── navigate away to another tab (Community) ──────────────────────────────
    await page.getByTestId("tab-community").click({ force: true });

    // ── return to Cases tab ───────────────────────────────────────────────────
    await page.getByTestId("tab-cases").click({ force: true });

    // ── chip must still be present and show "Approved" ────────────────────────
    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    const chipAfter = page.locator(
      "span:has([data-testid='button-clear-refund-claim-filter'])",
    );
    await expect(chipAfter).toContainText("Approved");

    // The select trigger must also still reflect "Approved".
    await expect(selectTrigger).toBeVisible();
    await expect(selectTrigger).toContainText("Approved");

    // ── click × and verify the chip disappears ────────────────────────────────
    await page.getByTestId("button-clear-refund-claim-filter").click();

    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).not.toBeVisible();

    // The select must revert to "All Refund Claims".
    await expect(selectTrigger).toContainText("All Refund Claims");

    await api.dispose();
  });

  test("Rejected filter chip survives mid-session tab navigation when set via Cases tab select dropdown", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ── seed: case with rejected refund claim ────────────────────────────────
    // Uses a distinct access-code prefix / PIN so it never collides with the
    // pill-click variants above.
    const accessCode = uniqueAccessCode("E2ERDS");
    const pin = "579135";
    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Refund Direct Select",
      extraPatch: { userEmail: uniqueEmail("rds") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, pin);
    await activateRefundClaim(api, adminToken, caseId);
    await submitRefundClaim(api, sessionToken, caseId);
    await rejectRefundClaim(api, adminToken, caseId);

    // ── sign in ──────────────────────────────────────────────────────────────
    await loginAdminUi(page);

    // ── go directly to the Cases tab (skip Analytics entirely) ───────────────
    await page.getByTestId("tab-cases").click({ force: true });

    // Wait for the select to be visible before interacting.
    const selectTrigger = page.getByTestId("select-refund-claim-filter");
    await expect(selectTrigger).toBeVisible({ timeout: 15_000 });

    // ── set the filter to "Rejected" via the dropdown ────────────────────────
    await selectTrigger.click();
    // shadcn SelectContent renders in a portal; target the option by role+name.
    await page.getByRole("option", { name: "Rejected" }).click();

    // The filter chip must now appear.
    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    const chipBefore = page.locator(
      "span:has([data-testid='button-clear-refund-claim-filter'])",
    );
    await expect(chipBefore).toContainText("Rejected");

    // ── navigate away to another tab (Community) ──────────────────────────────
    await page.getByTestId("tab-community").click({ force: true });

    // ── return to Cases tab ───────────────────────────────────────────────────
    await page.getByTestId("tab-cases").click({ force: true });

    // ── chip must still be present and show "Rejected" ────────────────────────
    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).toBeVisible({ timeout: 15_000 });

    const chipAfter = page.locator(
      "span:has([data-testid='button-clear-refund-claim-filter'])",
    );
    await expect(chipAfter).toContainText("Rejected");

    // The select trigger must also still reflect "Rejected".
    await expect(selectTrigger).toBeVisible();
    await expect(selectTrigger).toContainText("Rejected");

    // ── click × and verify the chip disappears ────────────────────────────────
    await page.getByTestId("button-clear-refund-claim-filter").click();

    await expect(
      page.getByTestId("button-clear-refund-claim-filter"),
    ).not.toBeVisible();

    // The select must revert to "All Refund Claims".
    await expect(selectTrigger).toContainText("All Refund Claims");

    await api.dispose();
  });
});
