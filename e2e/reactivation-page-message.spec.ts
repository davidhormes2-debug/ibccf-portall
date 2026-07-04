/**
 * e2e/reactivation-page-message.spec.ts
 *
 * End-to-end tests for the reactivation page message round-trip.
 *
 * Covers four scenarios that unit tests cannot reach:
 *
 * 1. Admin panel shows seeded message
 *    Admin opens the Communications tab for a disabled case whose
 *    reactivationPageMessage was pre-seeded via the admin PATCH API.
 *    The `input-reactivation-page-message` textarea must reflect the
 *    stored value.
 *
 * 2. Portal reactivation page shows the custom message
 *    A disabled-case user logs in (access code + PIN → 403),
 *    lands on ReactivationDepositView, and the
 *    `[data-testid="reactivation-notice-body"]` element contains the
 *    custom message verbatim.
 *
 * 3. Update message via admin panel → portal shows new value
 *    Admin edits `input-reactivation-page-message` and saves.
 *    Portal user reloads: `reactivation-notice-body` shows the updated
 *    message and NOT the old one.
 *
 * 4. Clear message via admin panel → portal falls back to default
 *    Admin clears the textarea and saves (stores NULL).
 *    Portal user reloads: `reactivation-notice-body` shows the default
 *    i18n copy ("suspended by our compliance team") and NOT the custom
 *    message.
 *
 * Data lifecycle
 * ─────────────
 * One case is created in beforeAll and removed in afterAll.
 * A unique random suffix prevents collisions between parallel CI runs.
 */

import { test, expect, request, type Page } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  issuePortalSession,
  deleteCase,
  loginAdminUi,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

const TEST_PIN = "556677";
const TEST_DEPOSIT_ADDRESS = "TReactivationMsgRoundTripE2EAddr11";

const INITIAL_CUSTOM_MESSAGE =
  "E2E round-trip test — initial reactivation notice for compliance review";
const UPDATED_CUSTOM_MESSAGE =
  "E2E round-trip test — UPDATED reactivation notice after admin edit";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers local to this spec
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
 * Log into the portal using the access-code → PIN path.
 * The account is disabled so the PIN submit returns 403; the app redirects
 * to ReactivationDepositView.  We wait for the deposit-address element
 * (only present in that view) as the "ready" signal.
 */
async function loginPortalToReactivation(
  page: Page,
  accessCode: string,
  pin: string,
): Promise<void> {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByTestId("input-access-code").fill(accessCode);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("input-pin")).toBeVisible({ timeout: 12_000 });
  await page.getByTestId("input-pin").fill(pin);
  await page.getByTestId("button-login").click();
  await expect(
    page.getByTestId("reactivation-deposit-address"),
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * Open a case in the admin dashboard and navigate to the Communications tab.
 * Assumes the admin session is already injected (call loginAdminUi first).
 */
async function openCommunicationsTab(
  page: Page,
  accessCode: string,
  caseId: string,
): Promise<void> {
  await loginAdminUi(page);
  await page.getByTestId("admin-case-finder-trigger").click();
  await page.getByTestId("admin-case-finder-input").fill(accessCode);
  await page
    .getByTestId(`admin-case-finder-result-${caseId}`)
    .click();
  await page.getByTestId("case-tab-communications").click({ force: true });
  await expect(page.getByTestId("panel-portal-warning")).toBeVisible({
    timeout: 10_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Reactivation page message — admin panel and portal round-trip", () => {
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run reactivation page message e2e tests",
  );

  let accessCode: string;
  let caseId: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    accessCode = uniqueAccessCode("E2ERPM");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Reactivation Page Message E2E",
        extraPatch: {
          withdrawalStage: "1",
          depositAddress: TEST_DEPOSIT_ADDRESS,
          depositAsset: "USDT",
          depositNetwork: "TRC20",
          activityDepositAmount: "500",
          reactivationPageMessage: INITIAL_CUSTOM_MESSAGE,
        },
      });
      await issuePortalSession(api, accessCode, TEST_PIN);
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

  test.setTimeout(120_000);

  // ── Test 1: Admin panel shows the pre-seeded message ─────────────────────

  test(
    "AdminPortalWarningPanel textarea shows the pre-seeded reactivationPageMessage",
    async ({ page }) => {
      await openCommunicationsTab(page, accessCode, caseId);

      const textarea = page.getByTestId("input-reactivation-page-message");
      await expect(textarea).toBeVisible({ timeout: 8_000 });
      await expect(textarea).toHaveValue(INITIAL_CUSTOM_MESSAGE);
    },
  );

  // ── Test 2: Portal reactivation page shows the custom message ─────────────

  test(
    "ReactivationDepositView notice body shows the custom reactivationPageMessage verbatim",
    async ({ page }) => {
      await loginPortalToReactivation(page, accessCode, TEST_PIN);

      const noticeBody = page.getByTestId("reactivation-notice-body");
      await expect(noticeBody).toBeVisible();
      await expect(noticeBody).toContainText(INITIAL_CUSTOM_MESSAGE);

      // The default i18n fallback must NOT appear when a custom message is set.
      await expect(noticeBody).not.toContainText(
        "suspended by our compliance team",
      );
    },
  );

  // ── Test 3: Admin updates message → portal reflects the new value ─────────

  test(
    "updating reactivationPageMessage via admin panel is reflected on the portal reactivation page",
    async ({ page, context, baseURL }) => {
      // ── Step 1: admin updates the message ─────────────────────────────────
      await openCommunicationsTab(page, accessCode, caseId);

      const textarea = page.getByTestId("input-reactivation-page-message");
      await expect(textarea).toBeVisible({ timeout: 8_000 });
      await textarea.fill(UPDATED_CUSTOM_MESSAGE);
      await page.getByTestId("button-save-reactivation-page-message").click();

      // Wait for the save toast / button to become re-enabled before navigating
      // away, which confirms the PATCH round-trip completed.
      await expect(
        page.getByTestId("button-save-reactivation-page-message"),
      ).toBeEnabled({ timeout: 10_000 });

      // ── Step 2: portal user sees the updated message ───────────────────────
      const portalPage = await context.newPage();
      try {
        await loginPortalToReactivation(portalPage, accessCode, TEST_PIN);

        const noticeBody = portalPage.getByTestId("reactivation-notice-body");
        await expect(noticeBody).toBeVisible();
        await expect(noticeBody).toContainText(UPDATED_CUSTOM_MESSAGE);
        await expect(noticeBody).not.toContainText(INITIAL_CUSTOM_MESSAGE);
      } finally {
        await portalPage.close();
      }

      // ── Step 3: reset to initial message so later tests use the right value ─
      // (Use the API directly to avoid another full admin UI navigation.)
      const api = await request.newContext({ baseURL });
      try {
        const res = await api.patch(`/api/cases/${caseId}`, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
          data: { reactivationPageMessage: INITIAL_CUSTOM_MESSAGE },
        });
        expect(res.status(), "reset reactivationPageMessage via API").toBe(200);
      } finally {
        await api.dispose();
      }
    },
  );

  // ── Test 4: Admin clears message → portal falls back to default ───────────

  test(
    "clearing reactivationPageMessage via admin panel makes the portal show the default i18n fallback",
    async ({ page, context }) => {
      // ── Step 1: admin clears the textarea ─────────────────────────────────
      await openCommunicationsTab(page, accessCode, caseId);

      const textarea = page.getByTestId("input-reactivation-page-message");
      await expect(textarea).toBeVisible({ timeout: 8_000 });
      await textarea.fill("");
      await page.getByTestId("button-save-reactivation-page-message").click();

      await expect(
        page.getByTestId("button-save-reactivation-page-message"),
      ).toBeEnabled({ timeout: 10_000 });

      // ── Step 2: portal user sees the default fallback text ─────────────────
      const portalPage = await context.newPage();
      try {
        await loginPortalToReactivation(portalPage, accessCode, TEST_PIN);

        const noticeBody = portalPage.getByTestId("reactivation-notice-body");
        await expect(noticeBody).toBeVisible();

        // The default bodyAdminDisabled copy contains this distinctive phrase.
        await expect(noticeBody).toContainText(
          "suspended by our compliance team",
        );

        // The custom messages must not appear once the field is cleared.
        await expect(noticeBody).not.toContainText(INITIAL_CUSTOM_MESSAGE);
        await expect(noticeBody).not.toContainText(UPDATED_CUSTOM_MESSAGE);
      } finally {
        await portalPage.close();
      }
    },
  );
});
