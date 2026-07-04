/**
 * e2e/portal-submission-error.spec.ts
 *
 * Verifies that the portal's letter-view submission form surfaces a clear,
 * user-facing error when POST /api/cases/:id/submissions returns 500 instead
 * of silently swallowing the failure.
 *
 * Approach
 * ────────
 * The spec registers a Playwright route intercept for the submissions endpoint
 * before the user logs in, so the mock is active when the confirm button is
 * clicked.  No real DB write happens; the test exercises the client-side error
 * branch (response.ok === false) and asserts that a destructive toast appears.
 *
 * Data lifecycle
 * ─────────────
 * A case is created in beforeAll via the admin API and deleted in afterAll.
 * withdrawalWindowEnabled=true is set so the letter view renders past its
 * "pending" gate without needing to set letterSent.  A unique random suffix
 * prevents access-code collisions across parallel CI runs.
 */

import { test, expect, request, type APIRequestContext } from "@playwright/test";
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

const TEST_PIN = "135791";

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
 * Drive the two-step portal login form (access code → PIN).
 * Waits for the portal shell's logout button as the "fully authenticated"
 * signal.  Accepts an optional initialView so we can land directly on the
 * letter view via the ?view= search param that PortalContext reads.
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

test.describe("Portal letter view — submission 500 shows a destructive error toast", () => {
  let accessCode: string;
  let caseId: string;
  let adminToken: string;

  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run portal-submission-error e2e tests",
      );
    }
  });

  test.beforeAll(async ({ baseURL }) => {
    await clearAdminRateLimit(DATABASE_URL);

    accessCode = uniqueCode("E2E-SUBE");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = await loginAdminApi(api);
      // withdrawalWindowEnabled=true bypasses the letterSent pending gate so
      // the letter view renders and exposes the option-selection form without
      // needing a real letter record.
      caseId = await createCase(api, adminToken, accessCode, {
        extraPatch: { withdrawalWindowEnabled: true },
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

  test("shows a destructive error toast and keeps the form visible when the save fails", async ({
    page,
  }) => {
    // Register the intercept before login so the route is in place when the
    // confirm button fires the fetch.
    await page.route("**/api/cases/*/submissions", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        });
      }
      return route.continue();
    });

    // Log in and land directly on the letter view.
    await loginPortalUi(page, accessCode, "letter");

    // The pending-gate placeholder must NOT be present — we are in
    // withdrawal mode so the full letter UI renders.
    await expect(
      page.getByTestId("button-back-dashboard-pending"),
    ).toHaveCount(0, { timeout: 12_000 });

    // Select Option A (the fallback letter always populates both options).
    await page.getByTestId("button-select-option-a").click();

    // The "Continue with Option A" button becomes enabled after a selection.
    const continueBtn = page.getByTestId("button-continue-selection");
    await expect(continueBtn).toBeEnabled({ timeout: 6_000 });
    await continueBtn.click();

    // The confirmation dialog opens — wait for the confirm-submit button.
    const confirmBtn = page.getByTestId("button-confirm-submit");
    await expect(confirmBtn).toBeVisible({ timeout: 8_000 });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // The error branch in handleSubmit calls:
    //   toast({ variant: "destructive", title: t("letter.toast.submissionFailedTitle"), … })
    // which renders into the ToastViewport (role="status", label="Notifications").
    const errorToast = page
      .getByRole("status")
      .filter({ hasText: "Submission Failed" });
    await expect(errorToast).toBeVisible({ timeout: 10_000 });

    // On a save failure, handleSubmit sets isSubmitting=false but does NOT
    // dismiss the confirm dialog (setIsConfirming stays true).  This leaves
    // the confirm button re-enabled so the user can retry without losing their
    // selection — assert it is still present and enabled in the DOM.
    await expect(confirmBtn).toBeVisible();
    await expect(confirmBtn).toBeEnabled();
  });
});
