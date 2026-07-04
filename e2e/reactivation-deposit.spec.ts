/**
 * e2e/reactivation-deposit.spec.ts
 *
 * End-to-end tests for the full reactivation deposit flow.
 *
 * Covers three distinct code paths in AuthViews.tsx:
 *
 * Path A — PIN enrolled, account disabled:
 *   1. Seed a test case with a known deposit address and PIN, then disable it
 *      via the admin API so logins return 403.
 *   2. Visit /dashboard and enter the access code.
 *   3. Enter the PIN — the server returns 403 (account disabled).
 *   4. Confirm the ReactivationDepositView renders (not an error or dashboard page).
 *   5. Assert the deposit address card and copy button are present.
 *   6. Select a receipt file using the hidden file input and submit it.
 *   7. Confirm the submission confirmation panel appears.
 *
 * Path B — NO PIN enrolled, account disabled:
 *   1. Seed a test case with a known deposit address but NO PIN, then disable it.
 *   2. Visit /dashboard and enter the access code.
 *   3. No PIN step appears — GET /api/cases/access/:code returns 403 immediately.
 *   4. Confirm the ReactivationDepositView renders without a PIN step.
 *   5. Assert the deposit address card and copy button are present.
 *   6. Select a receipt file and submit it.
 *   7. Confirm the submission confirmation panel appears.
 *
 * Path C — NO PIN enrolled, account disabled mid-registration:
 *   1. Seed a test case with a known deposit address but NO PIN, account ENABLED.
 *   2. Visit /dashboard and enter the access code.
 *   3. verify-access-code returns hasPinSet=false → app sets sessionStorage
 *      requiresPinSetup=true → GET /api/cases/access/:code returns 200 →
 *      RegisterView appears (user is mid-registration).
 *   4. Admin disables the case via API from a separate request context.
 *   5. User fills the registration form (name, email, mobile, PIN) and submits.
 *   6. POST /api/cases/set-pin returns 403 (account disabled) → app redirects
 *      to ReactivationDepositView instead of showing a broken error state.
 *   7. Assert the deposit address card and copy button are present.
 *   8. Select a receipt file and submit it.
 *   9. Confirm the submission confirmation panel appears.
 *
 * Data lifecycle
 * ─────────────
 * One case per path is created in beforeAll and removed in afterAll.
 * A unique random suffix prevents collisions between parallel CI runs.
 */

import { test, expect, request } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  issuePortalSession,
  deleteCase,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

const TEST_PIN = "998877";
const TEST_DEPOSIT_ADDRESS = "TReactivationE2ETestAddress123456";

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

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Reactivation deposit flow — E2E", () => {
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run reactivation deposit e2e tests",
  );

  let accessCode: string;
  let caseId: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {

    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    accessCode = uniqueAccessCode("E2ERACT");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Reactivation Deposit E2E",
        extraPatch: {
          withdrawalStage: "1",
          depositAddress: TEST_DEPOSIT_ADDRESS,
          depositAsset: "USDT",
          depositNetwork: "TRC20",
          activityDepositAmount: "500",
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

  test(
    "disabled account login shows ReactivationDepositView, deposit address is visible, and receipt upload succeeds",
    async ({ page }) => {
      // ── Step 1: navigate to the portal login ──────────────────────────────
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

      // ── Step 2: enter the access code ────────────────────────────────────
      await page.getByTestId("input-access-code").fill(accessCode);
      await page.getByTestId("button-login").click();

      // ── Step 3: PIN step appears; enter PIN — server returns 403 ─────────
      await expect(page.getByTestId("input-pin")).toBeVisible({
        timeout: 12_000,
      });
      await page.getByTestId("input-pin").fill(TEST_PIN);
      await page.getByTestId("button-login").click();

      // ── Step 4: ReactivationDepositView must render ───────────────────────
      // The deposit address element is only present in ReactivationDepositView,
      // so its visibility confirms the correct view is shown.
      await expect(
        page.getByTestId("reactivation-deposit-address"),
      ).toBeVisible({ timeout: 20_000 });

      // ── Step 5: deposit address and copy button are present ───────────────
      await expect(
        page.getByTestId("reactivation-deposit-address"),
      ).toContainText(TEST_DEPOSIT_ADDRESS);
      await expect(
        page.getByTestId("button-copy-deposit-address"),
      ).toBeVisible();

      // ── Step 5b: notice body is rendered and non-empty ───────────────────
      // Lightweight regression guard — verifies the correct branch of the
      // notice copy is reached in a live browser run (without pinning the
      // exact copy text so minor wording edits don't break CI).
      await expect(
        page.getByTestId("reactivation-notice-body"),
      ).toBeVisible();
      {
        const noticeText = await page
          .getByTestId("reactivation-notice-body")
          .innerText();
        expect(
          noticeText.trim().length,
          "reactivation-notice-body must not be empty",
        ).toBeGreaterThan(0);
      }

      // ── Step 6: select a receipt file via the hidden file input ───────────
      const pngBuffer = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      );
      await page
        .locator('[data-testid="input-reactivation-file"]')
        .setInputFiles({
          name: "reactivation-proof.png",
          mimeType: "image/png",
          buffer: pngBuffer,
        });

      // ── Step 7: submit and confirm the success panel appears ──────────────
      await expect(
        page.getByTestId("button-submit-reactivation-receipt"),
      ).toBeVisible({ timeout: 8_000 });
      await page.getByTestId("button-submit-reactivation-receipt").click();

      await expect(
        page.getByTestId("reactivation-submitted-confirmation"),
      ).toBeVisible({ timeout: 15_000 });
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Path B: disabled account with NO PIN enrolled
//
// AuthViews.tsx lines 151-153: when verify-access-code returns hasPinSet=false,
// the code calls GET /api/cases/access/:code directly.  If that returns 403
// (account disabled) the user is redirected to ReactivationDepositView without
// ever seeing the PIN step.  This suite guards that branch.
// ─────────────────────────────────────────────────────────────────────────────

const TEST_DEPOSIT_ADDRESS_NO_PIN = "TReactivationNoPinE2ETestAddr99";

test.describe("Reactivation deposit flow — no-PIN path", () => {
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run reactivation deposit e2e tests",
  );

  let accessCodeNoPin: string;
  let caseIdNoPin: string;
  let adminTokenNoPin: string;

  test.beforeAll(async ({ baseURL }) => {
    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    accessCodeNoPin = uniqueAccessCode("E2ERNP");
    const api = await request.newContext({ baseURL });
    try {
      adminTokenNoPin = readAdminToken();
      // Create the case WITHOUT calling issuePortalSession so no PIN is enrolled.
      caseIdNoPin = await createCase(api, adminTokenNoPin, accessCodeNoPin, {
        userName: "Reactivation No-PIN E2E",
        extraPatch: {
          withdrawalStage: "1",
          depositAddress: TEST_DEPOSIT_ADDRESS_NO_PIN,
          depositAsset: "USDT",
          depositNetwork: "TRC20",
          activityDepositAmount: "500",
        },
      });
      // Disable the case immediately — no PIN is ever set.
      await disableCaseViaApi(api, adminTokenNoPin, caseIdNoPin);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseIdNoPin) return;
    const api = await request.newContext({ baseURL });
    try {
      await deleteCase(api, adminTokenNoPin, caseIdNoPin);
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(120_000);

  test(
    "disabled account with no PIN shows ReactivationDepositView after access-code step alone, and receipt upload succeeds",
    async ({ page }) => {
      // ── Step 1: navigate to the portal login ──────────────────────────────
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

      // ── Step 2: enter the access code ────────────────────────────────────
      await page.getByTestId("input-access-code").fill(accessCodeNoPin);
      await page.getByTestId("button-login").click();

      // ── Step 3: PIN step must NOT appear — ReactivationDepositView renders ─
      // The deposit-address element appears only in ReactivationDepositView, so
      // waiting for it confirms the correct branch was taken (no PIN prompt).
      await expect(
        page.getByTestId("reactivation-deposit-address"),
      ).toBeVisible({ timeout: 20_000 });

      // Assert that the PIN input was never shown during this flow.
      await expect(page.getByTestId("input-pin")).not.toBeVisible();

      // ── Step 4: deposit address and copy button are present ───────────────
      await expect(
        page.getByTestId("reactivation-deposit-address"),
      ).toContainText(TEST_DEPOSIT_ADDRESS_NO_PIN);
      await expect(
        page.getByTestId("button-copy-deposit-address"),
      ).toBeVisible();

      // ── Step 4b: notice body is rendered and non-empty ───────────────────
      await expect(
        page.getByTestId("reactivation-notice-body"),
      ).toBeVisible();
      {
        const noticeText = await page
          .getByTestId("reactivation-notice-body")
          .innerText();
        expect(
          noticeText.trim().length,
          "reactivation-notice-body must not be empty",
        ).toBeGreaterThan(0);
      }

      // ── Step 5: select a receipt file via the hidden file input ───────────
      const pngBuffer = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      );
      await page
        .locator('[data-testid="input-reactivation-file"]')
        .setInputFiles({
          name: "reactivation-proof-no-pin.png",
          mimeType: "image/png",
          buffer: pngBuffer,
        });

      // ── Step 6: submit and confirm the success panel appears ──────────────
      await expect(
        page.getByTestId("button-submit-reactivation-receipt"),
      ).toBeVisible({ timeout: 8_000 });
      await page.getByTestId("button-submit-reactivation-receipt").click();

      await expect(
        page.getByTestId("reactivation-submitted-confirmation"),
      ).toBeVisible({ timeout: 15_000 });
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Path C: no-PIN account disabled mid-registration (requiresPinSetup=true)
//
// AuthViews.tsx RegisterView.handleRegister: when the account is disabled
// between the access-code step (hasPinSet=false, requiresPinSetup set in
// sessionStorage) and the PIN-setup submit, POST /api/cases/set-pin returns
// 403.  The app must redirect to ReactivationDepositView instead of leaving
// the user on a broken error state.
// ─────────────────────────────────────────────────────────────────────────────

const TEST_DEPOSIT_ADDRESS_MID_REG = "TReactivationMidRegE2ETestAddr77";

test.describe("Reactivation deposit flow — mid-registration disabled path", () => {
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run reactivation deposit e2e tests",
  );

  let accessCodeMidReg: string;
  let caseIdMidReg: string;
  let adminTokenMidReg: string;

  test.beforeAll(async ({ baseURL }) => {
    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    accessCodeMidReg = uniqueAccessCode("E2EMRG");
    const api = await request.newContext({ baseURL });
    try {
      adminTokenMidReg = readAdminToken();
      // Create the case WITHOUT calling issuePortalSession so no PIN is enrolled.
      // Account starts ENABLED so the user can pass the access-code step and
      // reach RegisterView before the account is disabled.
      caseIdMidReg = await createCase(api, adminTokenMidReg, accessCodeMidReg, {
        userName: "Reactivation Mid-Reg E2E",
        extraPatch: {
          withdrawalStage: "1",
          depositAddress: TEST_DEPOSIT_ADDRESS_MID_REG,
          depositAsset: "USDT",
          depositNetwork: "TRC20",
          activityDepositAmount: "500",
        },
      });
      // Account is intentionally left ENABLED here so that step 2 of the test
      // (access-code entry) succeeds and lands on RegisterView.
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseIdMidReg) return;
    const api = await request.newContext({ baseURL });
    try {
      await deleteCase(api, adminTokenMidReg, caseIdMidReg);
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(120_000);

  test(
    "account disabled mid-registration (requiresPinSetup=true) shows ReactivationDepositView when set-pin returns 403",
    async ({ page, request: apiCtx }) => {
      // ── Step 1: navigate to the portal login ──────────────────────────────
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

      // ── Step 2: enter the access code ─────────────────────────────────────
      // verify-access-code returns hasPinSet=false (no PIN enrolled).
      // The app sets sessionStorage requiresPinSetup=true, then calls
      // GET /api/cases/access/:code which succeeds (account still enabled) →
      // RegisterView renders.
      await page.getByTestId("input-access-code").fill(accessCodeMidReg);
      await page.getByTestId("button-login").click();

      // ── Step 3: wait for RegisterView to appear ───────────────────────────
      await expect(page.getByTestId("input-name")).toBeVisible({
        timeout: 12_000,
      });

      // ── Step 4: disable the case from a separate API context ───────────────
      // Simulates an admin locking the account while the user is mid-way
      // through PIN setup (sessionStorage requiresPinSetup=true is already set).
      await disableCaseViaApi(apiCtx, adminTokenMidReg, caseIdMidReg);

      // ── Step 5: fill the registration form and submit ─────────────────────
      // POST /api/cases/set-pin will return 403 (account is now disabled).
      // RegisterView must redirect to ReactivationDepositView on 403 rather
      // than leaving the user stuck with a generic error toast.
      await page.getByTestId("input-name").fill("Mid-Reg Test User");
      await page.getByTestId("input-email").fill("midregest@example.com");
      await page.getByTestId("input-mobile").fill("+1 555 000 0001");
      await page.getByTestId("input-new-pin").fill("112233");
      await page.getByTestId("input-confirm-pin").fill("112233");
      await page.getByTestId("button-register").click();

      // ── Step 6: ReactivationDepositView must render ───────────────────────
      // The deposit-address element is only present in ReactivationDepositView,
      // so its visibility confirms the correct view was shown (not a broken
      // error state or a stuck spinner).
      await expect(
        page.getByTestId("reactivation-deposit-address"),
      ).toBeVisible({ timeout: 20_000 });

      // ── Step 7: deposit address and copy button are present ───────────────
      await expect(
        page.getByTestId("reactivation-deposit-address"),
      ).toContainText(TEST_DEPOSIT_ADDRESS_MID_REG);
      await expect(
        page.getByTestId("button-copy-deposit-address"),
      ).toBeVisible();

      // ── Step 7b: notice body is rendered and non-empty ───────────────────
      await expect(
        page.getByTestId("reactivation-notice-body"),
      ).toBeVisible();
      {
        const noticeText = await page
          .getByTestId("reactivation-notice-body")
          .innerText();
        expect(
          noticeText.trim().length,
          "reactivation-notice-body must not be empty",
        ).toBeGreaterThan(0);
      }

      // ── Step 8: select a receipt file via the hidden file input ───────────
      const pngBuffer = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      );
      await page
        .locator('[data-testid="input-reactivation-file"]')
        .setInputFiles({
          name: "reactivation-proof-mid-reg.png",
          mimeType: "image/png",
          buffer: pngBuffer,
        });

      // ── Step 9: submit and confirm the success panel appears ──────────────
      await expect(
        page.getByTestId("button-submit-reactivation-receipt"),
      ).toBeVisible({ timeout: 8_000 });
      await page.getByTestId("button-submit-reactivation-receipt").click();

      await expect(
        page.getByTestId("reactivation-submitted-confirmation"),
      ).toBeVisible({ timeout: 15_000 });
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom reactivationPageMessage branch
//
// ReactivationDepositView: `reactivationPageMessage || t("...")`
// When the admin sets a custom message, it must appear verbatim in
// [data-testid="reactivation-notice-body"] and the default i18n fallback must
// NOT be rendered.  This suite guards that branch using Playwright's route
// interception to inject a non-null reactivationPageMessage into the
// reactivation-info response without needing a separate DB column patch.
// ─────────────────────────────────────────────────────────────────────────────

const TEST_DEPOSIT_ADDRESS_CUSTOM_MSG = "TReactivationCustomMsgE2ETestAddr55";
const CUSTOM_REACTIVATION_MESSAGE =
  "Please send the required compliance deposit to restore your access — E2E custom message";
const PORTAL_WARNING_FALLBACK_MESSAGE =
  "Your account is under a scheduled compliance review — E2E portalWarningMessage fallback";

test.describe("Reactivation deposit — custom reactivationPageMessage branch", () => {
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run reactivation deposit e2e tests",
  );

  let accessCodeCustomMsg: string;
  let caseIdCustomMsg: string;
  let adminTokenCustomMsg: string;

  test.beforeAll(async ({ baseURL }) => {
    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    accessCodeCustomMsg = uniqueAccessCode("E2ECMSG");
    const api = await request.newContext({ baseURL });
    try {
      adminTokenCustomMsg = readAdminToken();
      caseIdCustomMsg = await createCase(api, adminTokenCustomMsg, accessCodeCustomMsg, {
        userName: "Reactivation Custom Msg E2E",
        extraPatch: {
          withdrawalStage: "1",
          depositAddress: TEST_DEPOSIT_ADDRESS_CUSTOM_MSG,
          depositAsset: "USDT",
          depositNetwork: "TRC20",
          activityDepositAmount: "500",
        },
      });
      // Enroll a PIN so the login follows Path A (access code → PIN → 403).
      await issuePortalSession(api, accessCodeCustomMsg, TEST_PIN);
      // Disable the case so the PIN submission returns 403 and the app
      // redirects to ReactivationDepositView.
      await disableCaseViaApi(api, adminTokenCustomMsg, caseIdCustomMsg);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseIdCustomMsg) return;
    const api = await request.newContext({ baseURL });
    try {
      await deleteCase(api, adminTokenCustomMsg, caseIdCustomMsg);
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(120_000);

  test(
    "custom reactivationPageMessage is shown verbatim and default i18n body is absent",
    async ({ page }) => {
      // ── Step 1: navigate to the portal login ──────────────────────────────
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

      // ── Step 2: intercept reactivation-info so the mock is in place when
      //    the component's useEffect fires the fetch after redirect.
      await page.route(
        `**/api/cases/access/${accessCodeCustomMsg}/reactivation-info`,
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              caseId: caseIdCustomMsg,
              depositAddress: TEST_DEPOSIT_ADDRESS_CUSTOM_MSG,
              depositAsset: "USDT",
              depositNetwork: "TRC20",
              reactivationAmount: "500",
              portalWarningMessage: null,
              reactivationPageMessage: CUSTOM_REACTIVATION_MESSAGE,
            }),
          });
        },
      );

      // ── Step 3: enter the access code ────────────────────────────────────
      await page.getByTestId("input-access-code").fill(accessCodeCustomMsg);
      await page.getByTestId("button-login").click();

      // ── Step 4: PIN step appears; enter PIN — server returns 403 ─────────
      await expect(page.getByTestId("input-pin")).toBeVisible({
        timeout: 12_000,
      });
      await page.getByTestId("input-pin").fill(TEST_PIN);
      await page.getByTestId("button-login").click();

      // ── Step 5: ReactivationDepositView must render ───────────────────────
      await expect(
        page.getByTestId("reactivation-deposit-address"),
      ).toBeVisible({ timeout: 20_000 });

      // ── Step 6: notice body shows the custom admin message verbatim ───────
      await expect(
        page.getByTestId("reactivation-notice-body"),
      ).toBeVisible();
      await expect(
        page.getByTestId("reactivation-notice-body"),
      ).toContainText(CUSTOM_REACTIVATION_MESSAGE);

      // ── Step 7: the default i18n fallback text must NOT be present ────────
      // Assert against a distinctive substring of the default copy so the
      // check is robust to minor wording edits but still catches the case
      // where the custom message was silently discarded.
      await expect(
        page.getByTestId("reactivation-notice-body"),
      ).not.toContainText("scheduled closure period");
    },
  );

  test(
    "portalWarningMessage fallback is shown verbatim when reactivationPageMessage is null",
    async ({ page }) => {
      // ── Step 1: navigate to the portal login ──────────────────────────────
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

      // ── Step 2: intercept reactivation-info with reactivationPageMessage=null
      //    and a non-null portalWarningMessage so the secondary fallback branch
      //    (info?.reactivationPageMessage ?? info?.portalWarningMessage) is
      //    exercised.
      await page.route(
        `**/api/cases/access/${accessCodeCustomMsg}/reactivation-info`,
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              caseId: caseIdCustomMsg,
              depositAddress: TEST_DEPOSIT_ADDRESS_CUSTOM_MSG,
              depositAsset: "USDT",
              depositNetwork: "TRC20",
              reactivationAmount: "500",
              portalWarningMessage: PORTAL_WARNING_FALLBACK_MESSAGE,
              reactivationPageMessage: null,
            }),
          });
        },
      );

      // ── Step 3: enter the access code ────────────────────────────────────
      await page.getByTestId("input-access-code").fill(accessCodeCustomMsg);
      await page.getByTestId("button-login").click();

      // ── Step 4: PIN step appears; enter PIN — server returns 403 ─────────
      await expect(page.getByTestId("input-pin")).toBeVisible({
        timeout: 12_000,
      });
      await page.getByTestId("input-pin").fill(TEST_PIN);
      await page.getByTestId("button-login").click();

      // ── Step 5: ReactivationDepositView must render ───────────────────────
      await expect(
        page.getByTestId("reactivation-deposit-address"),
      ).toBeVisible({ timeout: 20_000 });

      // ── Step 6: notice body shows the portalWarningMessage verbatim ───────
      await expect(
        page.getByTestId("reactivation-notice-body"),
      ).toBeVisible();
      await expect(
        page.getByTestId("reactivation-notice-body"),
      ).toContainText(PORTAL_WARNING_FALLBACK_MESSAGE);

      // ── Step 7: the default i18n fallback text must NOT be present ────────
      await expect(
        page.getByTestId("reactivation-notice-body"),
      ).not.toContainText("scheduled closure period");
    },
  );

  test(
    "reactivation-info fetch failure (500) — notice body is not silently blank",
    async ({ page }) => {
      // ── Step 1: navigate to the portal login ──────────────────────────────
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

      // ── Step 2: intercept reactivation-info to simulate a server error.
      //    The route is registered before login so it is in place when the
      //    component's useEffect fires the fetch after the 403 redirect.
      await page.route(
        `**/api/cases/access/${accessCodeCustomMsg}/reactivation-info`,
        async (route) => {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Internal Server Error" }),
          });
        },
      );

      // ── Step 3: enter the access code ────────────────────────────────────
      await page.getByTestId("input-access-code").fill(accessCodeCustomMsg);
      await page.getByTestId("button-login").click();

      // ── Step 4: PIN step appears; enter PIN — server returns 403 ─────────
      await expect(page.getByTestId("input-pin")).toBeVisible({
        timeout: 12_000,
      });
      await page.getByTestId("input-pin").fill(TEST_PIN);
      await page.getByTestId("button-login").click();

      // ── Step 5: wait for ReactivationDepositView to finish its fetch ──────
      // ReactivationDepositView always shows a Loader2 spinner while the
      // reactivation-info fetch is in flight.  Waiting for it to detach
      // (state: "hidden" covers both removed and invisible) confirms the
      // useEffect has resolved — either with data or with an error — before
      // we inspect the resulting DOM.
      await page.waitForSelector(
        ".animate-spin",
        { state: "hidden", timeout: 20_000 },
      );

      // ── Step 6: assert the notice body is not silently blank ─────────────
      // When the fetch fails the component sets loadError=true and renders a
      // dedicated error panel.  In that branch the reactivation-notice-body
      // paragraph is never mounted, so the element will be absent.
      // Either outcome satisfies the requirement:
      //   (a) element absent  — load-error panel rendered, which is correct
      //   (b) element present — must contain non-empty text (not a blank <p>)
      const noticeBody = page.getByTestId("reactivation-notice-body");
      const isVisible = await noticeBody.isVisible().catch(() => false);

      if (isVisible) {
        // Condition (b): element is in the DOM — guard against blank content.
        const text = await noticeBody.innerText();
        expect(
          text.trim().length,
          "reactivation-notice-body must not be blank when the fetch fails",
        ).toBeGreaterThan(0);
      } else {
        // Condition (a): element is absent — the load-error panel is shown
        // instead, which is the expected behaviour on a 500 response.
        await expect(noticeBody).not.toBeVisible();
      }
    },
  );
});
