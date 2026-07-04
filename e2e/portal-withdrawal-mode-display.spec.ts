/**
 * e2e/portal-withdrawal-mode-display.spec.ts
 *
 * Verifies the withdrawal-mode display overrides on the portal dashboard and
 * navigation views.  Two independent scenarios are covered:
 *
 *   1. withdrawalWindowEnabled=true (admin master switch, stage=1)
 *   2. withdrawalStage=12 (natural ≥12 threshold, no explicit flag)
 *
 * In both scenarios the spec asserts:
 *   • stage-cta-card-withdrawal replaces the normal per-stage CTA card
 *   • tracker-progress-percent shows "100%" (progressPercent forced to 100 in
 *     withdrawal mode regardless of the numeric stage value)
 *   • The stepper current-stage-highlight switches to the "All Stages Cleared /
 *     Withdrawal Phase Active" variant
 *   • Stepper cells carry expected data-stage-state values for the current
 *     stage (scenario 1: stage 1 → "current"; scenario 2: stages 1-11 →
 *     "completed", stage 12 → "current")
 *   • Withdrawal Hub and Wallet-Connect nav items are visible
 *   • Letter view renders past the pending gate (button-back-dashboard-pending
 *     absent)
 *   • Wallet-Connect view shows the withdrawal-done banner (short-circuits when
 *     walletPhraseEnabled is unset and the case is in withdrawal mode)
 *   • Certificate view renders past the "not enabled" gate (withdrawal mode
 *     bypasses the certificateEnabled guard in CertificateView)
 *
 * Data lifecycle
 * ─────────────
 * Each describe block seeds one case via the admin API, enrolls a PIN, runs
 * all its tests against that case, then deletes the row in afterAll.  A random
 * suffix on every access code prevents collisions across parallel CI runs.
 */

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import {
  uniqueAccessCode as uniqueCode,
  loginAdminApi,
  createCase,
  deleteCase,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

const TEST_PIN = "246810";

async function enrollPin(
  api: APIRequestContext,
  accessCode: string,
): Promise<void> {
  const res = await api.post("/api/cases/set-pin", {
    data: { accessCode, pin: TEST_PIN },
  });
  expect(res.status(), "enroll PIN").toBe(200);
}

/**
 * Drive the two-step portal login form and land on a specific view.
 *
 * The PortalContext reads the `?view` URL search param at authentication time
 * and uses it as the landing viewState, so passing an initialView here allows
 * landing directly on views that have no dedicated nav link (e.g. certificate).
 *
 * Waits for the portal shell's logout button as the "fully authenticated"
 * signal before returning.
 */
async function loginPortalUi(
  page: import("@playwright/test").Page,
  accessCode: string,
  initialView = "dashboard",
): Promise<void> {
  const search = initialView !== "dashboard" ? `?view=${initialView}` : "";
  await page.goto(`/dashboard${search}`, { waitUntil: "domcontentloaded" });

  await page.getByTestId("input-access-code").fill(accessCode);
  await page.getByTestId("button-login").click();

  await expect(page.getByTestId("input-pin")).toBeVisible({ timeout: 12_000 });
  await page.getByTestId("input-pin").fill(TEST_PIN);
  await page.getByTestId("button-login").click();

  await expect(page.getByTestId("button-logout")).toBeVisible({
    timeout: 20_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — withdrawalWindowEnabled=true (stage=1, flag is the trigger)
// ─────────────────────────────────────────────────────────────────────────────

test.describe(
  "Portal — withdrawal mode display: withdrawalWindowEnabled=true",
  () => {
    test.beforeAll(() => {
      if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run withdrawal mode display e2e tests");
      }
    });

    let accessCode: string;
    let caseId: string;
    let adminToken: string;

    test.beforeAll(async ({ baseURL }) => {
      // Clear admin-login rate-limit rows so stale attempts don't cause 429s.
      if (DATABASE_URL) {
        const pg = new Client({ connectionString: DATABASE_URL });
        try {
          await pg.connect();
          await pg.query("DELETE FROM admin_login_attempts");
        } finally {
          await pg.end();
        }
      }

      accessCode = uniqueCode("E2E-WMW");
      const api = await request.newContext({ baseURL });
      try {
        adminToken = await loginAdminApi(api);
        // Stage 1 — well below the natural ≥12 threshold; withdrawal mode is
        // triggered exclusively by the withdrawalWindowEnabled flag.
        caseId = await createCase(api, adminToken, accessCode, {
          extraPatch: { withdrawalStage: "1", withdrawalWindowEnabled: true },
        });
        await enrollPin(api, accessCode);
      } finally {
        await api.dispose();
      }
    });

    test.afterAll(async ({ baseURL }) => {
      if (!caseId) return;
      const api = await request.newContext({ baseURL });
      try {
        const token = adminToken ?? (await loginAdminApi(api));
        await deleteCase(api, token, caseId);
      } finally {
        await api.dispose();
      }
    });

    // ── Dashboard assertions ─────────────────────────────────────────────────

    test("dashboard shows stage-cta-card-withdrawal instead of per-stage card", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode);

      // Withdrawal-mode CTA replaces the normal stage-1 card
      await expect(
        page.getByTestId("stage-cta-card-withdrawal"),
      ).toBeVisible({ timeout: 12_000 });
      await expect(page.getByTestId("stage-cta-card-1")).toHaveCount(0);
    });

    test("progress tracker shows 100% and All Stages Cleared highlight", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode);

      // The numeric percentage label carries data-testid="tracker-progress-percent"
      // so we can assert the exact value without relying on CSS computed styles.
      await expect(page.getByTestId("tracker-progress-percent")).toHaveText(
        "100%",
        { timeout: 12_000 },
      );

      // The stepper always renders; in withdrawal mode the current-stage-highlight
      // switches to the "All Stages Cleared / Withdrawal Phase Active" variant.
      await expect(page.getByTestId("stages-stepper")).toBeVisible();
      const highlight = page.getByTestId("current-stage-highlight");
      await expect(highlight).toBeVisible();
      // Kicker text is unique to the withdrawal-mode variant of the card.
      await expect(highlight).toContainText("All Stages Cleared");
    });

    test("stepper shows stage 1 as current (green treatment) with all 14 cells rendered", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode);

      await expect(page.getByTestId("stages-stepper")).toBeVisible();

      // Stage 1 is the current stage (isCurrent=true); in withdrawal mode it
      // receives the emerald background treatment but its data-stage-state is
      // still "current" (not "completed"), because isCompleted = s.id < currentStage
      // has no stages before stage 1.
      await expect(page.getByTestId("stage-step-1")).toHaveAttribute(
        "data-stage-state",
        "current",
      );

      // All 14 stepper cells must be rendered in the DOM.
      for (let s = 1; s <= 14; s++) {
        await expect(page.getByTestId(`stage-step-${s}`)).toHaveCount(1);
      }
    });

    test("withdrawal hub and wallet-connect nav items are visible", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode);

      await expect(page.getByTestId("nav-withdrawal")).toBeVisible();
      await expect(page.getByTestId("nav-walletConnect")).toBeVisible();
    });

    // ── View-navigation assertions ────────────────────────────────────────────

    test("letter view renders past the pending gate", async ({ page }) => {
      await loginPortalUi(page, accessCode);
      await page.getByTestId("nav-letter").click();

      // In withdrawal mode the letterSent guard is bypassed: the pending-gate
      // back button must NOT appear.
      await expect(
        page.getByTestId("button-back-dashboard-pending"),
      ).toHaveCount(0, { timeout: 12_000 });
    });

    test("wallet-connect view shows the withdrawal-done banner", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode);
      await page.getByTestId("nav-walletConnect").click();

      // walletPhraseEnabled is not set; the view short-circuits to the
      // withdrawal-done notice confirming the bypass is active.
      await expect(
        page.getByTestId("wallet-connect-withdrawal-done"),
      ).toBeVisible({ timeout: 12_000 });
    });

    test("certificate view renders past the not-enabled gate", async ({
      page,
    }) => {
      // The PortalContext reads ?view from the URL at login time and uses it as
      // the landing viewState — navigate directly to the certificate view so we
      // can verify the withdrawal-mode bypass without needing a nav link.
      await loginPortalUi(page, accessCode, "certificate");

      // CertificateView bypasses the !certificateEnabled guard when
      // isWithdrawalMode is true.  The download button is always rendered once
      // the guard is cleared, and the "not enabled" placeholder must be absent.
      await expect(page.getByTestId("button-certificate-download")).toBeVisible(
        { timeout: 12_000 },
      );
      await expect(
        page.getByTestId("certificate-not-enabled"),
      ).toHaveCount(0);
    });

    test("certificate download endpoint failure shows a destructive toast", async ({
      page,
    }) => {
      // Intercept the PDF endpoint before login so the route is in place when
      // the button is clicked.
      await page.route("**/api/cases/*/certificate/pdf", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        }),
      );

      await loginPortalUi(page, accessCode, "certificate");

      // Wait for the download button to be enabled (loading spinner gone).
      const downloadBtn = page.getByTestId("button-certificate-download");
      await expect(downloadBtn).toBeVisible({ timeout: 12_000 });
      await expect(downloadBtn).toBeEnabled({ timeout: 8_000 });

      await downloadBtn.click();

      // The catch block in downloadPdf() calls toast({ variant: "destructive",
      // title: "Download failed", … }).  Toasts are rendered into a region with
      // role="status" (ToastViewport label="Notifications").
      const errorToast = page
        .getByRole("status")
        .filter({ hasText: "Download failed" });
      await expect(errorToast).toBeVisible({ timeout: 10_000 });
    });

    test("certificate fee endpoint failure shows amber error banner and disables upload", async ({
      page,
    }) => {
      // Intercept the fee endpoint before login so the error state is set when
      // CertificateView mounts and calls its useFee hook.
      await page.route("**/api/cases/*/certificate/fee", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Fee service unavailable" }),
        }),
      );

      await loginPortalUi(page, accessCode, "certificate");

      // The fee panel renders an amber AlertTriangle banner when fee.error is
      // set.  Wait for the download button to confirm the view is past the
      // certificateEnabled guard (withdrawal mode bypass is active), then check
      // the error block — it lives in the fee panel below the PDF section.
      await expect(page.getByTestId("button-certificate-download")).toBeVisible(
        { timeout: 12_000 },
      );

      // CertificateView sets fee.error = (json.error ?? "…") and renders the
      // amber AlertTriangle banner in the fee panel (fee?.error branch).  The
      // error text forwarded from the 500 body must appear in the DOM.
      const errorBanner = page.getByTestId("certificate-fee-error");
      await expect(errorBanner).toBeVisible({ timeout: 10_000 });
      await expect(errorBanner).toContainText("Fee service unavailable");

      // The upload button must be disabled when fee.error is set
      // (disabled={uploading || !!fee?.error} in CertificateView).
      const uploadBtn = page.getByTestId("button-certificate-upload");
      await expect(uploadBtn).toBeDisabled({ timeout: 8_000 });
    });

    test("certificate fee-payments endpoint failure leaves main view intact and hides payment history", async ({
      page,
    }) => {
      // Intercept only the fee-payments list endpoint — the fee endpoint is
      // left intact so the fee panel renders normally.
      await page.route("**/api/cases/*/certificate/fee-payments", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Payments service unavailable" }),
        }),
      );

      await loginPortalUi(page, accessCode, "certificate");

      // Main view must render: the download button confirms the component is
      // past the certificateEnabled guard (withdrawal mode bypass is active).
      await expect(page.getByTestId("button-certificate-download")).toBeVisible(
        { timeout: 12_000 },
      );

      // The fee panel renders normally (fee endpoint succeeded): the upload
      // button is present and not disabled.
      const uploadBtn = page.getByTestId("button-certificate-upload");
      await expect(uploadBtn).toBeVisible({ timeout: 8_000 });
      await expect(uploadBtn).not.toBeDisabled();

      // The payment history section must be absent — CertificateView silently
      // keeps payments=[] when paymentsRes is not ok, so the section is never
      // rendered (payments.length > 0 guard).
      await expect(
        page.getByTestId("certificate-payment-history"),
      ).toHaveCount(0);
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — withdrawalStage=12 (natural ≥12 threshold, no explicit flag)
// ─────────────────────────────────────────────────────────────────────────────

test.describe(
  "Portal — withdrawal mode display: withdrawalStage=12 (natural threshold)",
  () => {
    test.beforeAll(() => {
      if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run withdrawal mode display e2e tests");
      }
    });

    let accessCode: string;
    let caseId: string;
    let adminToken: string;

    test.beforeAll(async ({ baseURL }) => {
      accessCode = uniqueCode("E2E-WMS");
      const api = await request.newContext({ baseURL });
      try {
        adminToken = await loginAdminApi(api);
        // Stage 12 — meets the ≥12 threshold in getIsWithdrawalMode; no flag.
        caseId = await createCase(api, adminToken, accessCode, {
          extraPatch: { withdrawalStage: "12" },
        });
        await enrollPin(api, accessCode);
      } finally {
        await api.dispose();
      }
    });

    test.afterAll(async ({ baseURL }) => {
      if (!caseId) return;
      const api = await request.newContext({ baseURL });
      try {
        const token = adminToken ?? (await loginAdminApi(api));
        await deleteCase(api, token, caseId);
      } finally {
        await api.dispose();
      }
    });

    // ── Dashboard assertions ─────────────────────────────────────────────────

    test("dashboard shows stage-cta-card-withdrawal for stage=12", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode);

      await expect(
        page.getByTestId("stage-cta-card-withdrawal"),
      ).toBeVisible({ timeout: 12_000 });
      // Normal per-stage card for stage 12 must be gone
      await expect(page.getByTestId("stage-cta-card-12")).toHaveCount(0);
    });

    test("progress tracker shows 100% and All Stages Cleared highlight for stage=12", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode);

      await expect(page.getByTestId("tracker-progress-percent")).toHaveText(
        "100%",
        { timeout: 12_000 },
      );

      await expect(page.getByTestId("stages-stepper")).toBeVisible();
      const highlight = page.getByTestId("current-stage-highlight");
      await expect(highlight).toBeVisible();
      await expect(highlight).toContainText("All Stages Cleared");
    });

    test("stages 1-11 show data-stage-state=completed and stage 12 is current", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode);

      // Ensure the stepper is rendered before checking individual cells.
      await expect(page.getByTestId("stages-stepper")).toBeVisible();

      // Stages before the current stage (12) are isCompleted → emerald
      // CheckCircle icons and data-stage-state="completed".
      for (let s = 1; s <= 11; s++) {
        await expect(page.getByTestId(`stage-step-${s}`)).toHaveAttribute(
          "data-stage-state",
          "completed",
        );
      }

      // Stage 12 is isCurrent → receives emerald treatment in withdrawal mode
      // but its data-stage-state attribute remains "current".
      await expect(page.getByTestId("stage-step-12")).toHaveAttribute(
        "data-stage-state",
        "current",
      );
    });

    test("withdrawal hub and wallet-connect nav items are visible for stage=12", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode);

      await expect(page.getByTestId("nav-withdrawal")).toBeVisible();
      await expect(page.getByTestId("nav-walletConnect")).toBeVisible();
    });

    // ── View-navigation assertions ────────────────────────────────────────────

    test("letter view renders past the pending gate for stage=12", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode);
      await page.getByTestId("nav-letter").click();

      await expect(
        page.getByTestId("button-back-dashboard-pending"),
      ).toHaveCount(0, { timeout: 12_000 });
    });

    test("wallet-connect view shows the withdrawal-done banner for stage=12", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode);
      await page.getByTestId("nav-walletConnect").click();

      await expect(
        page.getByTestId("wallet-connect-withdrawal-done"),
      ).toBeVisible({ timeout: 12_000 });
    });

    test("certificate view renders past the not-enabled gate for stage=12", async ({
      page,
    }) => {
      await loginPortalUi(page, accessCode, "certificate");

      // CertificateView bypasses the !certificateEnabled guard when in
      // withdrawal mode (stage ≥ 12 satisfies getIsWithdrawalMode).
      // The download button must be visible and the "not enabled" placeholder
      // must be absent — confirming the guard branch was not taken.
      await expect(page.getByTestId("button-certificate-download")).toBeVisible(
        { timeout: 12_000 },
      );
      await expect(
        page.getByTestId("certificate-not-enabled"),
      ).toHaveCount(0);
    });

    test("certificate download endpoint failure shows a destructive toast for stage=12", async ({
      page,
    }) => {
      // Intercept the PDF endpoint before login so the route is in place when
      // the button is clicked.
      await page.route("**/api/cases/*/certificate/pdf", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        }),
      );

      await loginPortalUi(page, accessCode, "certificate");

      // Wait for the download button to be enabled (loading spinner gone).
      const downloadBtn = page.getByTestId("button-certificate-download");
      await expect(downloadBtn).toBeVisible({ timeout: 12_000 });
      await expect(downloadBtn).toBeEnabled({ timeout: 8_000 });

      await downloadBtn.click();

      // The catch block in downloadPdf() calls toast({ variant: "destructive",
      // title: "Download failed", … }).  Toasts are rendered into a region with
      // role="status" (ToastViewport label="Notifications").
      const errorToast = page
        .getByRole("status")
        .filter({ hasText: "Download failed" });
      await expect(errorToast).toBeVisible({ timeout: 10_000 });
    });

    test("certificate fee endpoint failure shows amber error banner and disables upload for stage=12", async ({
      page,
    }) => {
      // Intercept the fee endpoint before login so the error state is set when
      // CertificateView mounts and calls its useFee hook.
      await page.route("**/api/cases/*/certificate/fee", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Fee service unavailable" }),
        }),
      );

      await loginPortalUi(page, accessCode, "certificate");

      // Confirm the view has passed the certificateEnabled guard (withdrawal
      // mode bypass active for stage ≥ 12).
      await expect(page.getByTestId("button-certificate-download")).toBeVisible(
        { timeout: 12_000 },
      );

      // CertificateView sets fee.error = (json.error ?? "…") and renders the
      // amber AlertTriangle banner in the fee panel (fee?.error branch).  The
      // error text forwarded from the 500 body must appear in the DOM.
      const errorBanner = page.getByTestId("certificate-fee-error");
      await expect(errorBanner).toBeVisible({ timeout: 10_000 });
      await expect(errorBanner).toContainText("Fee service unavailable");

      // The upload button must be disabled when fee.error is set
      // (disabled={uploading || !!fee?.error} in CertificateView).
      const uploadBtn = page.getByTestId("button-certificate-upload");
      await expect(uploadBtn).toBeDisabled({ timeout: 8_000 });
    });

    test("certificate fee-payments endpoint failure leaves main view intact and hides payment history for stage=12", async ({
      page,
    }) => {
      // Intercept only the fee-payments list endpoint — the fee endpoint is
      // left intact so the fee panel renders normally.
      await page.route("**/api/cases/*/certificate/fee-payments", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Payments service unavailable" }),
        }),
      );

      await loginPortalUi(page, accessCode, "certificate");

      // Main view must render: the download button confirms the component is
      // past the certificateEnabled guard (withdrawal mode bypass active for
      // stage ≥ 12).
      await expect(page.getByTestId("button-certificate-download")).toBeVisible(
        { timeout: 12_000 },
      );

      // The fee panel renders normally (fee endpoint succeeded): the upload
      // button is present and not disabled.
      const uploadBtn = page.getByTestId("button-certificate-upload");
      await expect(uploadBtn).toBeVisible({ timeout: 8_000 });
      await expect(uploadBtn).not.toBeDisabled();

      // The payment history section must be absent — CertificateView silently
      // keeps payments=[] when paymentsRes is not ok, so the section is never
      // rendered (payments.length > 0 guard).
      await expect(
        page.getByTestId("certificate-payment-history"),
      ).toHaveCount(0);
    });
  },
);
