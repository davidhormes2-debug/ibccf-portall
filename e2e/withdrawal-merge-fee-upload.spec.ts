// e2e/withdrawal-merge-fee-upload.spec.ts
//
// Regression guard for the merge-fee upload flow in the Withdrawal Batches
// panel (WithdrawalView → DepositView).
//
// WHAT THIS TESTS
// ───────────────
// When a user clicks "Merge Withdrawal" → "Confirm & Upload":
//
//   1. No POST to /api/cases/:id/deposit-receipts is fired before a file is
//      chosen.  Before the current implementation, the merge confirmation
//      created a placeholder receipt server-side immediately on confirmation;
//      the current flow navigates straight to DepositView and lets the user
//      attach their own file, so no premature POST should occur.
//
//   2. DepositView becomes visible with the upload-category dropdown
//      pre-selected to "Batch merge fee" (the 'merge_fee' category).  This is
//      driven by the sessionStorage signal
//      `ibccf.pending_upload_category = 'merge_fee'` that submitMergeFee()
//      writes before calling setViewState('deposit').

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { BATCH_FEE_NOTES_PREFIX } from "../shared/constants";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

function uniqueAccessCode(): string {
  return "E2EMF-" + randomBytes(5).toString("hex").toUpperCase();
}

function uniqueEmail(): string {
  return `e2e-${randomBytes(3).toString("hex")}@example.com`;
}

async function loginAdmin(api: APIRequestContext): Promise<string> {
  const res = await api.post("/api/admin/login", {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  expect(res.status(), "admin login").toBe(200);
  const body = await res.json();
  expect(body.success, "admin login success").toBe(true);
  expect(typeof body.token, "admin token type").toBe("string");
  return body.token as string;
}

async function createMergeCase(
  api: APIRequestContext,
  token: string,
  accessCode: string,
): Promise<string> {
  const created = await api.post("/api/cases", {
    headers: { Authorization: `Bearer ${token}` },
    data: { accessCode, status: "active" },
  });
  expect(created.status(), "create case").toBe(200);
  const caseId = (await created.json()).id as string;

  const patched = await api.patch(`/api/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      userName: "Merge Fee E2E User",
      userEmail: uniqueEmail(),
      status: "active",
      // Enables the Withdrawal Batches panel in WithdrawalView and also
      // exposes the "Withdrawal" nav item in the portal sidebar.
      withdrawalWindowEnabled: true,
    },
  });
  expect(patched.status(), "patch case").toBe(200);
  const patchedBody = await patched.json();
  expect(patchedBody.withdrawalWindowEnabled, "withdrawal window enabled").toBe(
    true,
  );

  return caseId;
}

async function setPin(
  api: APIRequestContext,
  accessCode: string,
  pin: string,
): Promise<void> {
  const res = await api.post("/api/cases/set-pin", {
    data: { accessCode, pin },
  });
  expect(res.status(), "set pin").toBe(200);
}

test.describe("Portal — Withdrawal merge-fee upload flow", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the portal e2e tests");
    }
  });

  test("Confirm & Upload navigates to DepositView with merge_fee pre-selected and fires no premature POST", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Track any POST to the deposit-receipts endpoint ──────────────────────
    // Before the fix, "Confirm & Upload" created a placeholder receipt
    // immediately.  With the current implementation, no POST should be
    // triggered until the user actually picks a file.
    let depositReceiptPostFired = false;
    await page.route(`**/api/cases/${caseId}/deposit-receipts`, (route) => {
      if (route.request().method() === "POST") {
        depositReceiptPostFired = true;
      }
      void route.continue();
    });

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    // Wait until the portal is authenticated (login form disappears).
    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    // The "Withdrawal" nav item is conditionally rendered when
    // withdrawalWindowEnabled is true.
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── Withdrawal Batches panel is visible ──────────────────────────────────
    const batchesCard = page.getByTestId("card-withdrawal-batches");
    await expect(batchesCard).toBeVisible();

    // ── Click "Merge Withdrawal" to reveal the confirmation dialog ───────────
    await page.getByTestId("button-merge-withdrawal").click();
    await expect(page.getByTestId("card-merge-confirm")).toBeVisible();

    // No POST should have fired yet.
    expect(depositReceiptPostFired, "no POST before confirmation").toBe(false);

    // ── Click "Confirm & Upload" ─────────────────────────────────────────────
    await page.getByTestId("button-merge-confirm").click();

    // ── DepositView is now shown ─────────────────────────────────────────────
    // The upload-category dropdown is the definitive landmark for the Uploads
    // (DepositView) screen.
    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // ── Upload category is pre-selected to "Batch merge fee" ─────────────────
    // WithdrawalView.submitMergeFee() writes
    //   sessionStorage.setItem('ibccf.pending_upload_category', 'merge_fee')
    // before calling setViewState('deposit').  DepositView reads and clears
    // that signal on mount and selects the matching dropdown option.
    await expect(categorySelect).toContainText("Batch merge fee", {
      timeout: 5_000,
    });

    // ── Still no POST to deposit-receipts ────────────────────────────────────
    // Confirming the merge intent must not create a server-side placeholder;
    // the actual upload only happens when the user attaches a file.
    expect(
      depositReceiptPostFired,
      "no POST to deposit-receipts before file chosen",
    ).toBe(false);

    await api.dispose();
  });

  test("clicking Cancel on the merge-confirm dialog closes it and keeps the user on WithdrawalView with no POST fired", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Track any POST to the deposit-receipts endpoint ──────────────────────
    // Cancelling the confirmation must not trigger any server call.
    let depositReceiptPostFired = false;
    await page.route(`**/api/cases/${caseId}/deposit-receipts`, (route) => {
      if (route.request().method() === "POST") {
        depositReceiptPostFired = true;
      }
      void route.continue();
    });

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── Click "Merge Withdrawal" to open the confirmation dialog ─────────────
    await page.getByTestId("button-merge-withdrawal").click();
    await expect(page.getByTestId("card-merge-confirm")).toBeVisible();

    // No POST should have fired just from opening the dialog.
    expect(depositReceiptPostFired, "no POST before cancel").toBe(false);

    // ── Click "Cancel" ───────────────────────────────────────────────────────
    await page.getByTestId("button-merge-cancel").click();

    // ── Confirmation dialog must disappear ───────────────────────────────────
    await expect(page.getByTestId("card-merge-confirm")).toHaveCount(0, {
      timeout: 5_000,
    });

    // ── User must still be on WithdrawalView ─────────────────────────────────
    await expect(page.getByTestId("view-withdrawal")).toBeVisible();

    // ── No POST to deposit-receipts must have been fired ─────────────────────
    expect(depositReceiptPostFired, "no POST after cancel").toBe(false);

    await api.dispose();
  });

  test("clicking Cancel then clicking Merge Withdrawal again re-opens the confirmation dialog", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Track any POST to the deposit-receipts endpoint ──────────────────────
    let depositReceiptPostFired = false;
    await page.route(`**/api/cases/${caseId}/deposit-receipts`, (route) => {
      if (route.request().method() === "POST") {
        depositReceiptPostFired = true;
      }
      void route.continue();
    });

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── First open: click "Merge Withdrawal" ─────────────────────────────────
    await page.getByTestId("button-merge-withdrawal").click();
    await expect(page.getByTestId("card-merge-confirm")).toBeVisible();

    // WithdrawalView must still be mounted.
    await expect(page.getByTestId("view-withdrawal")).toBeVisible();

    // ── Cancel: dialog must disappear ────────────────────────────────────────
    await page.getByTestId("button-merge-cancel").click();
    await expect(page.getByTestId("card-merge-confirm")).toHaveCount(0, {
      timeout: 5_000,
    });

    // WithdrawalView must still be visible after cancel.
    await expect(page.getByTestId("view-withdrawal")).toBeVisible();

    // ── Second open: click "Merge Withdrawal" again ───────────────────────────
    // A broken showMergeConfirm toggle could leave the state stuck or
    // incorrectly flipped, preventing the dialog from re-opening.
    await page.getByTestId("button-merge-withdrawal").click();
    await expect(page.getByTestId("card-merge-confirm")).toBeVisible({
      timeout: 5_000,
    });

    // WithdrawalView must still be visible throughout the re-open.
    await expect(page.getByTestId("view-withdrawal")).toBeVisible();

    // No server call must have been triggered by any of these UI interactions.
    expect(depositReceiptPostFired, "no POST fired during open-cancel-open").toBe(false);

    await api.dispose();
  });

  test("open-cancel-reopen-confirm: 'Confirm & Upload' after re-opening navigates to DepositView with merge_fee pre-selected and fires no premature POST", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Track any POST to the deposit-receipts endpoint ──────────────────────
    // A regression in submitMergeFee() (e.g. a stale closure capturing a reset
    // handler) could either fire a premature POST or navigate to the wrong view.
    let depositReceiptPostFired = false;
    await page.route(`**/api/cases/${caseId}/deposit-receipts`, (route) => {
      if (route.request().method() === "POST") {
        depositReceiptPostFired = true;
      }
      void route.continue();
    });

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── First open: click "Merge Withdrawal" ─────────────────────────────────
    await page.getByTestId("button-merge-withdrawal").click();
    await expect(page.getByTestId("card-merge-confirm")).toBeVisible();

    expect(depositReceiptPostFired, "no POST after first open").toBe(false);

    // ── Cancel: dialog must disappear, user stays on WithdrawalView ──────────
    await page.getByTestId("button-merge-cancel").click();
    await expect(page.getByTestId("card-merge-confirm")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page.getByTestId("view-withdrawal")).toBeVisible();

    expect(depositReceiptPostFired, "no POST after cancel").toBe(false);

    // ── Second open: click "Merge Withdrawal" again ───────────────────────────
    // A stale closure over a reset handler could leave showMergeConfirm stuck
    // or prevent submitMergeFee() from being wired to the button correctly.
    await page.getByTestId("button-merge-withdrawal").click();
    await expect(page.getByTestId("card-merge-confirm")).toBeVisible({
      timeout: 5_000,
    });

    expect(depositReceiptPostFired, "no POST after re-open").toBe(false);

    // ── Click "Confirm & Upload" after re-opening ─────────────────────────────
    // This is the regression-prone step: submitMergeFee() must still fire
    // correctly even though the dialog was previously cancelled and re-opened.
    await page.getByTestId("button-merge-confirm").click();

    // ── DepositView must become visible ───────────────────────────────────────
    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // ── Upload category must be pre-selected to "Batch merge fee" ────────────
    // submitMergeFee() writes ibccf.pending_upload_category='merge_fee' to
    // sessionStorage before calling setViewState('deposit'); DepositView reads
    // and clears that signal on mount.
    await expect(categorySelect).toContainText("Batch merge fee", {
      timeout: 5_000,
    });

    // ── No POST to deposit-receipts must have fired at any point ─────────────
    expect(
      depositReceiptPostFired,
      "no POST to deposit-receipts before file chosen",
    ).toBe(false);

    await api.dispose();
  });

  test("dismissing the merge-fee banner also hides the inline reminder inside the upload card", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Inject the sessionStorage signal before navigating to the Uploads view ─
    await page.evaluate(() => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    });

    const depositNavItem = page.getByTestId("nav-deposit");
    await expect(depositNavItem).toBeVisible({ timeout: 10_000 });
    await depositNavItem.click();

    // ── Both the banner and the inline reminder should be visible initially ───
    const banner = page.getByTestId("banner-merge-fee-notice");
    const inlineReminder = page.getByTestId("reminder-merge-fee-inline");

    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Click the dismiss button on the top banner ────────────────────────────
    await page.getByTestId("button-dismiss-merge-fee-banner").click();

    // ── Both the banner and the inline reminder must now be gone ─────────────
    // The dismiss button sets mergeFeeBannerDismissed=true, which is the same
    // flag that gates both the top banner and the inline reminder inside the
    // upload card — so dismissing the banner must also hide the inline reminder.
    await expect(banner).not.toBeVisible({ timeout: 5_000 });
    await expect(inlineReminder).not.toBeVisible();

    await api.dispose();
  });

  test("dismissed merge-fee banner does not reappear after navigating away and back", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Inject the sessionStorage signal and navigate to the Uploads view ────
    // DepositView reads and clears `ibccf.pending_upload_category` on mount,
    // so the signal is one-time-use — it activates the banner on this visit.
    await page.evaluate(() => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    });

    const depositNavItem = page.getByTestId("nav-deposit");
    await expect(depositNavItem).toBeVisible({ timeout: 10_000 });
    await depositNavItem.click();

    // ── Banner and inline reminder should be visible ─────────────────────────
    const banner = page.getByTestId("banner-merge-fee-notice");
    const inlineReminder = page.getByTestId("reminder-merge-fee-inline");

    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Dismiss the banner ───────────────────────────────────────────────────
    await page.getByTestId("button-dismiss-merge-fee-banner").click();

    await expect(banner).not.toBeVisible({ timeout: 5_000 });
    await expect(inlineReminder).not.toBeVisible();

    // ── Navigate to the Dashboard view ───────────────────────────────────────
    // Clicking nav-dashboard unmounts DepositView; wait for the upload-category
    // selector to disappear to confirm the view has actually changed.
    const dashboardNavItem = page.getByTestId("nav-dashboard");
    await expect(dashboardNavItem).toBeVisible({ timeout: 5_000 });
    await dashboardNavItem.click();

    const categorySelectAfterNav = page.getByTestId("select-upload-category");
    await expect(categorySelectAfterNav).toHaveCount(0, { timeout: 10_000 });

    // ── Navigate back to the Uploads view ────────────────────────────────────
    await depositNavItem.click();

    // Give the view time to mount fully.
    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // ── Neither the banner nor the inline reminder should reappear ────────────
    // The sessionStorage signal was consumed (removed) on the first visit, so
    // DepositView remounts with showMergeFeeBanner=false and no pending signal
    // to re-activate it.  The dismissed state therefore holds across navigation.
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    await api.dispose();
  });

  test("re-injecting the sessionStorage signal after dismissal does not reactivate the banner", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── First visit: inject the signal and navigate to Uploads ───────────────
    await page.evaluate(() => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    });

    const depositNavItem = page.getByTestId("nav-deposit");
    await expect(depositNavItem).toBeVisible({ timeout: 10_000 });
    await depositNavItem.click();

    const banner = page.getByTestId("banner-merge-fee-notice");
    const inlineReminder = page.getByTestId("reminder-merge-fee-inline");

    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Dismiss the banner ───────────────────────────────────────────────────
    // This writes `ibccf.merge_fee_banner_dismissed=true` to sessionStorage
    // in addition to setting the React state.
    await page.getByTestId("button-dismiss-merge-fee-banner").click();
    await expect(banner).not.toBeVisible({ timeout: 5_000 });
    await expect(inlineReminder).not.toBeVisible();

    // ── Navigate away ────────────────────────────────────────────────────────
    const dashboardNavItem = page.getByTestId("nav-dashboard");
    await expect(dashboardNavItem).toBeVisible({ timeout: 5_000 });
    await dashboardNavItem.click();

    const categorySelectGone = page.getByTestId("select-upload-category");
    await expect(categorySelectGone).toHaveCount(0, { timeout: 10_000 });

    // ── Re-inject the pending signal ─────────────────────────────────────────
    // This simulates another tab, a future code path, or a manual injection
    // re-writing the one-time signal after the user already dismissed the banner.
    await page.evaluate(() => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    });

    // ── Navigate back to Uploads ─────────────────────────────────────────────
    await depositNavItem.click();

    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // ── Banner must NOT reappear ──────────────────────────────────────────────
    // DepositView reads `ibccf.merge_fee_banner_dismissed` from sessionStorage
    // on mount and initialises mergeFeeBannerDismissed=true, so even though
    // the pending signal was re-injected, the render condition
    // `showMergeFeeBanner && !mergeFeeBannerDismissed` stays false.
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    await api.dispose();
  });

  test("Batch Merge History card appears with a Pending review badge after a merge fee receipt is recorded", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Seed a merge_fee receipt directly via the admin API ───────────────────
    // merge_fee receipts do not require imageData (the upload proof is attached
    // separately by the user), so this is a lightweight server-side seed.
    const seedRes = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}250 USDT` },
    });
    expect(seedRes.status(), "seed merge_fee receipt").toBe(200);
    const seedBody = await seedRes.json();
    expect(seedBody.id, "seeded receipt has an id").toBeTruthy();

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── The Batch Merge History card must be visible ───────────────────────
    // The card renders only when mergeFeeHistory.length > 0, which is driven by
    // GET /api/cases/:id/all-receipts filtered to category === 'merge_fee'.
    const historyCard = page.getByTestId("card-batch-history");
    await expect(historyCard).toBeVisible({ timeout: 10_000 });

    // ── At least one history row must show a "Pending review" badge ───────────
    // A freshly seeded receipt has status 'pending', which maps to the
    // "Pending review" label in WithdrawalView's statusVariant logic.
    const pendingBadge = historyCard.getByTestId("receipt-status-badge").first();
    await expect(pendingBadge).toContainText("Pending review");

    await api.dispose();
  });

  test("Batch Merge History card shows an Approved badge (green) after the receipt is approved by an admin", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Seed a merge_fee receipt ───────────────────────────────────────────────
    const seedRes = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}250 USDT` },
    });
    expect(seedRes.status(), "seed merge_fee receipt").toBe(200);
    const receiptId = (await seedRes.json()).id as number;
    expect(receiptId, "seeded receipt has an id").toBeTruthy();

    // ── Admin-approve the receipt ─────────────────────────────────────────────
    // statusVariant maps 'approved' → "Approved" label + emerald colour classes.
    const approveRes = await api.patch(`/api/deposit-receipts/${receiptId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: "approved" },
    });
    expect(approveRes.status(), "approve receipt").toBe(200);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── The Batch Merge History card must be visible ───────────────────────
    const historyCard = page.getByTestId("card-batch-history");
    await expect(historyCard).toBeVisible({ timeout: 10_000 });

    // ── The badge must say "Approved" with emerald colour class ───────────────
    // statusVariant for 'approved' → label "Approved",
    // cls "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
    const approvedBadge = historyCard.getByTestId("receipt-status-badge").first();
    await expect(approvedBadge).toContainText("Approved");
    await expect(approvedBadge).toHaveClass(/text-emerald-600/);

    await api.dispose();
  });

  test("Batch Merge History card shows a Rejected badge (red) after the receipt is rejected by an admin", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Seed a merge_fee receipt ───────────────────────────────────────────────
    const seedRes = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}250 USDT` },
    });
    expect(seedRes.status(), "seed merge_fee receipt").toBe(200);
    const receiptId = (await seedRes.json()).id as number;
    expect(receiptId, "seeded receipt has an id").toBeTruthy();

    // ── Admin-reject the receipt ──────────────────────────────────────────────
    // statusVariant maps 'rejected' → "Rejected" label + red colour classes.
    const rejectRes = await api.patch(`/api/deposit-receipts/${receiptId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: "rejected" },
    });
    expect(rejectRes.status(), "reject receipt").toBe(200);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── The Batch Merge History card must be visible ───────────────────────
    const historyCard = page.getByTestId("card-batch-history");
    await expect(historyCard).toBeVisible({ timeout: 10_000 });

    // ── The badge must say "Rejected" with red colour class ───────────────────
    // statusVariant for 'rejected' → label "Rejected",
    // cls "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
    const rejectedBadge = historyCard.getByTestId("receipt-status-badge").first();
    await expect(rejectedBadge).toContainText("Rejected");
    await expect(rejectedBadge).toHaveClass(/text-red-600/);

    await api.dispose();
  });

  test("Batch Merge History card shows a Pending review badge (amber) when the receipt status is 'reviewed'", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Seed a merge_fee receipt ───────────────────────────────────────────────
    const seedRes = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}250 USDT` },
    });
    expect(seedRes.status(), "seed merge_fee receipt").toBe(200);
    const receiptId = (await seedRes.json()).id as number;
    expect(receiptId, "seeded receipt has an id").toBeTruthy();

    // ── Admin-set the receipt to 'reviewed' ───────────────────────────────────
    // 'reviewed' is a valid ReceiptStatus but is neither 'approved' nor
    // 'rejected', so the statusVariant fallthrough in WithdrawalView maps it
    // to the same amber "Pending review" label/colour as 'pending'.
    const reviewRes = await api.patch(`/api/deposit-receipts/${receiptId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: "reviewed" },
    });
    expect(reviewRes.status(), "set receipt to reviewed").toBe(200);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── The Batch Merge History card must be visible ───────────────────────
    const historyCard = page.getByTestId("card-batch-history");
    await expect(historyCard).toBeVisible({ timeout: 10_000 });

    // ── The badge must say "Pending review" with amber colour class ───────────
    // statusVariant for 'reviewed' falls through to the else branch:
    // label "Pending review",
    // cls "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
    const pendingBadge = historyCard.getByTestId("receipt-status-badge").first();
    await expect(pendingBadge).toContainText("Pending review");
    await expect(pendingBadge).toHaveClass(/text-amber-600/);

    await api.dispose();
  });

  test("merge-fee banner does not reappear after navigating away and back following a successful upload", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── First visit: inject the signal and navigate to Uploads ───────────────
    // DepositView reads and clears `ibccf.pending_upload_category` on mount —
    // the signal is one-time-use, so a subsequent remount cannot reactivate it.
    await page.evaluate(() => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    });

    const depositNavItem = page.getByTestId("nav-deposit");
    await expect(depositNavItem).toBeVisible({ timeout: 10_000 });
    await depositNavItem.click();

    // Banner and inline reminder must be visible before the upload.
    const banner = page.getByTestId("banner-merge-fee-notice");
    const inlineReminder = page.getByTestId("reminder-merge-fee-inline");

    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Upload a file successfully ────────────────────────────────────────────
    // handleFileUpload calls setMergeFeeBannerDismissed(true) on success and
    // removes the batch-scoped sessionStorage key (Task #967).  Both the banner
    // and inline reminder collapse immediately after the upload completes.
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    // Wait for the upload to complete — the uploading badge appears then
    // disappears once the server responds.
    const uploadingBadge = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge).not.toBeVisible({ timeout: 15_000 });

    // Both merge-fee elements must be gone after the successful upload.
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // ── Navigate away to the Dashboard ───────────────────────────────────────
    // Clicking the dashboard nav unmounts DepositView, resetting all local
    // React state (showMergeFeeBanner, showMergeFeeOption, mergeFeeBannerDismissed).
    const dashboardNavItem = page.getByTestId("nav-dashboard");
    await expect(dashboardNavItem).toBeVisible({ timeout: 5_000 });
    await dashboardNavItem.click();

    // Confirm the upload-category selector has disappeared (view unmounted).
    const categorySelectGone = page.getByTestId("select-upload-category");
    await expect(categorySelectGone).toHaveCount(0, { timeout: 10_000 });

    // ── Navigate back to the Uploads view ────────────────────────────────────
    await depositNavItem.click();

    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // ── Neither the banner nor the inline reminder must reappear ─────────────
    // The pending signal was consumed on the first visit so DepositView remounts
    // with showMergeFeeBanner=false — there is no mechanism to reactivate it
    // without a fresh sessionStorage signal.  The batch-scoped dismissed key was
    // removed by the successful upload (Task #967), but that key is not needed
    // because showMergeFeeBanner never becomes true in the first place.
    await expect(page.getByTestId("banner-merge-fee-notice")).toHaveCount(0);
    await expect(page.getByTestId("reminder-merge-fee-inline")).toHaveCount(0);

    await api.dispose();
  });

  test("upload-then-navigate round-trip does not reactivate the banner when a batch ID was also set", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Inject BOTH sessionStorage signals before navigating to the Uploads view ─
    // This is the path exercised by the real WithdrawalView → DepositView flow:
    // submitMergeFee() writes both the category and a batch-scoped ID, which
    // causes DepositView to use the scoped key
    // `ibccf.merge_fee_banner_dismissed_<batchId>` for the dismissed state.
    const batchId = "test-batch-" + randomBytes(4).toString("hex");
    await page.evaluate((id) => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
      sessionStorage.setItem("ibccf.pending_merge_batch_id", id);
    }, batchId);

    const depositNavItem = page.getByTestId("nav-deposit");
    await expect(depositNavItem).toBeVisible({ timeout: 10_000 });
    await depositNavItem.click();

    // ── Banner and inline reminder must be visible before the upload ──────────
    const banner = page.getByTestId("banner-merge-fee-notice");
    const inlineReminder = page.getByTestId("reminder-merge-fee-inline");

    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Upload a file successfully ────────────────────────────────────────────
    // handleFileUpload calls setMergeFeeBannerDismissed(true) on success and —
    // because mergeBatchId was captured from sessionStorage on mount — also
    // removes `ibccf.merge_fee_banner_dismissed_<batchId>` (Task #967).
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof-batch.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    // Wait for the upload to complete — uploading badge appears then disappears.
    const uploadingBadge = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge).not.toBeVisible({ timeout: 15_000 });

    // Both merge-fee elements must be gone after the successful upload.
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // ── Confirm the batch-scoped dismissed key was removed from sessionStorage ─
    // handleFileUpload removes `ibccf.merge_fee_banner_dismissed_<batchId>` on
    // success so a future visit with the same batch ID cannot be pre-dismissed.
    const dismissedKey = await page.evaluate(
      (id) =>
        sessionStorage.getItem(`ibccf.merge_fee_banner_dismissed_${id}`),
      batchId,
    );
    expect(dismissedKey, "batch-scoped dismissed key removed after upload").toBeNull();

    // ── Navigate away to the Dashboard ───────────────────────────────────────
    const dashboardNavItem = page.getByTestId("nav-dashboard");
    await expect(dashboardNavItem).toBeVisible({ timeout: 5_000 });
    await dashboardNavItem.click();

    // Confirm the upload-category selector has disappeared (view unmounted).
    const categorySelectGone = page.getByTestId("select-upload-category");
    await expect(categorySelectGone).toHaveCount(0, { timeout: 10_000 });

    // ── Navigate back to the Uploads view ────────────────────────────────────
    await depositNavItem.click();

    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // ── Neither the banner nor the inline reminder must reappear ─────────────
    // The pending signal (`ibccf.pending_upload_category`) was consumed on the
    // first mount, so DepositView remounts with showMergeFeeBanner=false.
    // The batch-scoped dismissed key was removed by the upload, but that is
    // irrelevant because showMergeFeeBanner never becomes true without the
    // pending signal — confirming both cleanup paths co-operate correctly.
    await expect(page.getByTestId("banner-merge-fee-notice")).toHaveCount(0);
    await expect(page.getByTestId("reminder-merge-fee-inline")).toHaveCount(0);

    await api.dispose();
  });

  test("Upload proof button is visible on pending history rows and absent on approved and rejected rows", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Seed a pending receipt ─────────────────────────────────────────────────
    // A freshly created merge_fee receipt starts in 'pending' status — the
    // "Upload proof" button should be visible on this row.
    const pendingRes = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}250 USDT` },
    });
    expect(pendingRes.status(), "seed pending receipt").toBe(200);
    const pendingId = (await pendingRes.json()).id as number;

    // ── Seed an approved receipt ───────────────────────────────────────────────
    // Approve it immediately via the admin status endpoint so we can assert the
    // "Upload proof" button is absent on approved rows.
    const approvedRes = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}300 USDT` },
    });
    expect(approvedRes.status(), "seed receipt to approve").toBe(200);
    const approvedId = (await approvedRes.json()).id as number;

    const approveRes = await api.patch(
      `/api/deposit-receipts/${approvedId}/status`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { status: "approved" },
      },
    );
    expect(approveRes.status(), "approve receipt").toBe(200);

    // ── Seed a rejected receipt ────────────────────────────────────────────────
    const rejectedRes = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}200 USDT` },
    });
    expect(rejectedRes.status(), "seed receipt to reject").toBe(200);
    const rejectedId = (await rejectedRes.json()).id as number;

    const rejectRes = await api.patch(
      `/api/deposit-receipts/${rejectedId}/status`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { status: "rejected" },
      },
    );
    expect(rejectRes.status(), "reject receipt").toBe(200);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── Batch Merge History card must be visible ───────────────────────────────
    const historyCard = page.getByTestId("card-batch-history");
    await expect(historyCard).toBeVisible({ timeout: 10_000 });

    // ── Pending row: "Upload proof" button must be present ────────────────────
    // data-testid="batch-history-upload-{id}" is rendered only when isPending is
    // true (status !== 'approved' && status !== 'rejected').
    const pendingRow = page.getByTestId(`batch-history-row-${pendingId}`);
    await expect(pendingRow).toBeVisible();
    await expect(
      pendingRow.getByTestId(`batch-history-upload-${pendingId}`),
    ).toBeVisible();

    // ── Approved row: "Upload proof" button must NOT be present ──────────────
    const approvedRow = page.getByTestId(`batch-history-row-${approvedId}`);
    await expect(approvedRow).toBeVisible();
    await expect(
      approvedRow.getByTestId(`batch-history-upload-${approvedId}`),
    ).toHaveCount(0);

    // ── Rejected row: "Upload proof" button must NOT be present ──────────────
    const rejectedRow = page.getByTestId(`batch-history-row-${rejectedId}`);
    await expect(rejectedRow).toBeVisible();
    await expect(
      rejectedRow.getByTestId(`batch-history-upload-${rejectedId}`),
    ).toHaveCount(0);

    await api.dispose();
  });

  test("clicking Upload proof on a pending history row sets ibccf.pending_upload_category='merge_fee' and navigates to DepositView", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Seed a pending merge_fee receipt ──────────────────────────────────────
    // This creates a history row with an "Upload proof" button because the
    // receipt starts in 'pending' status.
    const seedRes = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}250 USDT` },
    });
    expect(seedRes.status(), "seed pending receipt").toBe(200);
    const receiptId = (await seedRes.json()).id as number;

    // ── Track any POST to the deposit-receipts endpoint ──────────────────────
    // Clicking "Upload proof" must NOT fire a premature POST — it should only
    // set a sessionStorage signal and navigate; the actual upload happens when
    // the user picks a file in DepositView.
    let depositReceiptPostFired = false;
    await page.route(`**/api/cases/${caseId}/deposit-receipts`, (route) => {
      if (route.request().method() === "POST") {
        depositReceiptPostFired = true;
      }
      void route.continue();
    });

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── Batch Merge History card must be visible with the pending row ─────────
    const historyCard = page.getByTestId("card-batch-history");
    await expect(historyCard).toBeVisible({ timeout: 10_000 });

    const uploadBtn = page.getByTestId(`batch-history-upload-${receiptId}`);
    await expect(uploadBtn).toBeVisible();

    // No premature POST before the button is clicked.
    expect(depositReceiptPostFired, "no POST before button click").toBe(false);

    // ── Click the "Upload proof" button ──────────────────────────────────────
    await uploadBtn.click();

    // ── DepositView is now shown ─────────────────────────────────────────────
    // submitMergeFee() calls setViewState('deposit') which unmounts WithdrawalView
    // and mounts DepositView.  The upload-category dropdown is the definitive
    // landmark for that view.
    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // ── Upload category is pre-selected to "Batch merge fee" ─────────────────
    // submitMergeFee() writes ibccf.pending_upload_category='merge_fee' to
    // sessionStorage before calling setViewState; DepositView reads and clears
    // that signal on mount and pre-selects the matching dropdown option.
    await expect(categorySelect).toContainText("Batch merge fee", {
      timeout: 5_000,
    });

    // ── Verify the sessionStorage key was consumed (cleared) by DepositView ──
    // DepositView removes ibccf.pending_upload_category on mount so a subsequent
    // remount cannot accidentally re-activate the merge-fee flow.
    const remainingKey = await page.evaluate(() =>
      sessionStorage.getItem("ibccf.pending_upload_category"),
    );
    expect(remainingKey, "ibccf.pending_upload_category cleared by DepositView").toBeNull();

    // ── Still no POST to deposit-receipts ────────────────────────────────────
    expect(
      depositReceiptPostFired,
      "no POST to deposit-receipts from Upload proof button",
    ).toBe(false);

    await api.dispose();
  });

  test("merge-fee inline reminder stays visible while uploading and disappears after a successful upload", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Gate the deposit-receipts POST so we can inspect the UI mid-flight ───
    // Resolving uploadGate lets the intercepted POST proceed to the server.
    let resolveUploadGate!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      resolveUploadGate = resolve;
    });

    await page.route(
      `**/api/cases/${caseId}/deposit-receipts`,
      async (route) => {
        if (route.request().method() === "POST") {
          await uploadGate;
        }
        await route.continue();
      },
    );

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Inject the sessionStorage signal before navigating to the Uploads view ─
    // DepositView reads and clears `ibccf.pending_upload_category` on mount,
    // activating the merge-fee banner and pre-selecting the dropdown.
    await page.evaluate(() => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    });

    const depositNavItem = page.getByTestId("nav-deposit");
    await expect(depositNavItem).toBeVisible({ timeout: 10_000 });
    await depositNavItem.click();

    // ── Inline reminder is visible before any upload begins ───────────────────
    const inlineReminder = page.getByTestId("reminder-merge-fee-inline");
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // Sanity: the uploading badge should not yet be present.
    await expect(page.getByTestId("badge-merge-fee-uploading")).toHaveCount(0);

    // ── Trigger a file upload ─────────────────────────────────────────────────
    // The hidden <input type="file"> dispatches onChange → handleFileUpload,
    // which immediately sets uploadingReceipt=true (before any await), causing
    // the inline reminder to swap to the compact uploading badge.
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({ name: "merge-fee-proof.png", mimeType: "image/png", buffer: minimalPng });

    // ── While the POST is gated, the uploading badge is visible ───────────────
    // React re-renders synchronously after setUploadingReceipt(true), so the
    // badge should appear well before the network response arrives.
    const uploadingBadge = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge).toBeVisible({ timeout: 5_000 });

    // The inline reminder must not be shown at the same time as the badge —
    // they are mutually exclusive (uploadingReceipt toggles between them).
    await expect(inlineReminder).not.toBeVisible();

    // ── Release the gated POST so the server can respond with 200 ────────────
    resolveUploadGate();

    // ── After a successful upload both elements disappear ─────────────────────
    // handleFileUpload calls setMergeFeeBannerDismissed(true) on success, which
    // collapses the entire merge-fee block (banner condition becomes false).
    await expect(uploadingBadge).not.toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).not.toBeVisible();

    await api.dispose();
  });

  test("re-setting the batch-scoped dismissed key after a successful upload does not reactivate the banner on remount", async ({
    page,
    baseURL,
  }) => {
    // This test closes the test triangle for the scoped-key path:
    //
    //   (a) plain dismissed key → already covered (banner stays hidden after
    //       re-injecting ibccf.pending_upload_category when dismissed=true)
    //   (b) batch-scoped key cleanup → already covered (key removed on upload)
    //   (c) [THIS TEST] batch-scoped key re-set after upload → banner must still
    //       stay hidden because showMergeFeeBanner=false once the pending signal
    //       is consumed, regardless of what the dismissed key says.
    //
    // Concretely: if a future code path re-writes
    //   ibccf.merge_fee_banner_dismissed_<batchId>
    // after the upload succeeded, a subsequent remount with the same batch ID
    // must not show the banner.  The pending signal
    //   ibccf.pending_upload_category
    // was already consumed on the first mount, so showMergeFeeBanner is false
    // and the dismissed key is irrelevant.
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Inject BOTH sessionStorage signals before navigating to the Uploads view
    // This mirrors the real WithdrawalView → DepositView path: submitMergeFee()
    // writes both keys, causing DepositView to track dismissed state under the
    // batch-scoped key `ibccf.merge_fee_banner_dismissed_<batchId>`.
    const batchId = "test-batch-" + randomBytes(4).toString("hex");
    await page.evaluate((id) => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
      sessionStorage.setItem("ibccf.pending_merge_batch_id", id);
    }, batchId);

    const depositNavItem = page.getByTestId("nav-deposit");
    await expect(depositNavItem).toBeVisible({ timeout: 10_000 });
    await depositNavItem.click();

    // ── Banner and inline reminder must be visible before the upload ──────────
    const banner = page.getByTestId("banner-merge-fee-notice");
    const inlineReminder = page.getByTestId("reminder-merge-fee-inline");

    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Upload a file successfully ────────────────────────────────────────────
    // handleFileUpload: sets mergeFeeBannerDismissed=true (React state) and
    // removes the batch-scoped sessionStorage key on success (Task #967).
    // After the upload both the banner and inline reminder collapse.
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof-rekey.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    // Wait for the upload to complete (uploading badge appears, then disappears).
    const uploadingBadge = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge).not.toBeVisible({ timeout: 15_000 });

    // Both merge-fee elements must be gone after the successful upload.
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // ── Manually re-set the batch-scoped dismissed key ────────────────────────
    // This simulates a future code path (or another tab) re-writing the key
    // after the upload has already succeeded and the pending signal was consumed.
    // Even with the scoped key present, the banner must not reappear on remount
    // because showMergeFeeBanner=false (pending signal was consumed on mount).
    await page.evaluate((id) => {
      sessionStorage.setItem(
        `ibccf.merge_fee_banner_dismissed_${id}`,
        "true",
      );
    }, batchId);

    // ── Navigate away to the Dashboard ───────────────────────────────────────
    // This unmounts DepositView, resetting all local React state
    // (showMergeFeeBanner, showMergeFeeOption, mergeFeeBannerDismissed).
    const dashboardNavItem = page.getByTestId("nav-dashboard");
    await expect(dashboardNavItem).toBeVisible({ timeout: 5_000 });
    await dashboardNavItem.click();

    // Confirm the upload-category selector has disappeared (view unmounted).
    const categorySelectGone = page.getByTestId("select-upload-category");
    await expect(categorySelectGone).toHaveCount(0, { timeout: 10_000 });

    // ── Navigate back to the Uploads view ────────────────────────────────────
    await depositNavItem.click();

    // Wait for the view to mount fully before asserting absence.
    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // ── Neither the banner nor the inline reminder must reappear ─────────────
    // On remount DepositView reads ibccf.pending_upload_category — it is absent
    // (consumed on the first mount), so showMergeFeeBanner initialises to false.
    // The render condition `showMergeFeeBanner && !mergeFeeBannerDismissed` is
    // false regardless of the batch-scoped dismissed key that was re-set above,
    // because showMergeFeeBanner is already false.  The dismissed key only
    // matters when showMergeFeeBanner is true; re-setting it cannot reactivate
    // the banner by itself.
    await expect(page.getByTestId("banner-merge-fee-notice")).toHaveCount(0);
    await expect(page.getByTestId("reminder-merge-fee-inline")).toHaveCount(0);

    await api.dispose();
  });

  test("re-injecting the pending signal after a batch-scoped upload (with the dismissed key absent) reactivates the banner — correct behaviour for a second merge-fee flow", async ({
    page,
    baseURL,
  }) => {
    // This test closes the final gap in the dismissed-key triangle:
    //
    //   (a) plain dismissed key blocks re-injected signal → covered
    //       (`ibccf.merge_fee_banner_dismissed=true` survives re-inject)
    //   (b) batch-scoped dismissed key removed on upload → covered
    //       (key is absent after successful upload)
    //   (c) batch-scoped dismissed key re-set after upload → covered
    //       (showMergeFeeBanner=false because pending signal was consumed,
    //        so re-setting the dismissed key cannot reactivate the banner)
    //   (d) [THIS TEST] pending signal re-injected after upload, dismissed key
    //       absent → banner SHOULD reappear.
    //
    // Why the banner reappears here:
    //   A successful batch-scoped upload removes the batch-scoped dismissed key
    //   (`ibccf.merge_fee_banner_dismissed_<batchId>`) as cleanup so that a
    //   *future* merge-fee request for the same batch ID still shows the banner.
    //   If the pending signal (`ibccf.pending_upload_category='merge_fee'`) is
    //   then re-injected (e.g. a second merge-fee flow for the same batch), the
    //   mount effect finds:
    //     - pending signal present → would activate banner
    //     - dismissed key absent  → alreadyDismissed=false
    //   so it sets showMergeFeeBanner=true and the banner appears.
    //
    // This is the intended product behaviour: the batch-scoped key cleanup is
    // precisely what allows a second merge-fee flow on the same batch to show
    // the banner again rather than being silently suppressed.

    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── First visit: inject BOTH signals and navigate to Uploads ─────────────
    // This mirrors the real WithdrawalView → DepositView path.  Using a
    // batch-scoped ID means DepositView tracks dismissed state under the key
    // `ibccf.merge_fee_banner_dismissed_<batchId>` rather than the generic key.
    const batchId = "test-batch-" + randomBytes(4).toString("hex");
    await page.evaluate((id) => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
      sessionStorage.setItem("ibccf.pending_merge_batch_id", id);
    }, batchId);

    const depositNavItem = page.getByTestId("nav-deposit");
    await expect(depositNavItem).toBeVisible({ timeout: 10_000 });
    await depositNavItem.click();

    // ── Banner and inline reminder are visible before the upload ─────────────
    const banner = page.getByTestId("banner-merge-fee-notice");
    const inlineReminder = page.getByTestId("reminder-merge-fee-inline");

    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Upload a file successfully ────────────────────────────────────────────
    // On success handleFileUpload:
    //   1. Sets mergeFeeBannerDismissed=true (React state).
    //   2. Sets dismissedByUploadRef=true, causing the persistence effect to
    //      *remove* `ibccf.merge_fee_banner_dismissed_<batchId>` from
    //      sessionStorage (cleanup for future merge-fee flows on this batch).
    // Both the banner and inline reminder collapse immediately after the upload.
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof-reinject.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    const uploadingBadge = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge).not.toBeVisible({ timeout: 15_000 });

    // Both elements must be gone immediately after the upload.
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // ── Confirm the batch-scoped dismissed key was removed ────────────────────
    // The upload cleanup path removes the key so a subsequent mount with the
    // same batchId is not pre-suppressed — this is what makes the banner
    // reappear correctly for a second merge-fee flow.
    const dismissedKeyAfterUpload = await page.evaluate(
      (id) =>
        sessionStorage.getItem(`ibccf.merge_fee_banner_dismissed_${id}`),
      batchId,
    );
    expect(
      dismissedKeyAfterUpload,
      "batch-scoped dismissed key removed by successful upload",
    ).toBeNull();

    // ── Navigate away to the Dashboard ───────────────────────────────────────
    // Unmounting DepositView resets all local React state
    // (showMergeFeeBanner, showMergeFeeOption, mergeFeeBannerDismissed).
    const dashboardNavItem = page.getByTestId("nav-dashboard");
    await expect(dashboardNavItem).toBeVisible({ timeout: 5_000 });
    await dashboardNavItem.click();

    const categorySelectGone = page.getByTestId("select-upload-category");
    await expect(categorySelectGone).toHaveCount(0, { timeout: 10_000 });

    // ── Re-inject the pending signal WITH the same batch ID ───────────────────
    // This simulates a second merge-fee flow on the same batch — e.g. the
    // admin created another placeholder receipt and the user clicks "Upload
    // proof" again.  The dismissed key is absent (removed by the first upload)
    // so the banner should reappear.
    await page.evaluate((id) => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
      sessionStorage.setItem("ibccf.pending_merge_batch_id", id);
    }, batchId);

    // ── Navigate back to the Uploads view ────────────────────────────────────
    await depositNavItem.click();

    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // ── Banner and inline reminder MUST reappear ──────────────────────────────
    // On remount DepositView evaluates:
    //   - ibccf.pending_upload_category='merge_fee'   → pending signal present
    //   - ibccf.merge_fee_banner_dismissed_<batchId>  → absent (key was removed
    //     by the successful upload)  → alreadyDismissed=false
    //   → setShowMergeFeeBanner(true)
    //
    // The render condition `showMergeFeeBanner && !mergeFeeBannerDismissed &&
    // uploadCategory === 'merge_fee'` is therefore satisfied and the banner
    // is shown.  This is the correct product behaviour: the cleanup of the
    // batch-scoped key after an upload intentionally allows a second merge-fee
    // flow for the same batch to surface the guidance banner again.
    await expect(page.getByTestId("banner-merge-fee-notice")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("reminder-merge-fee-inline")).toBeVisible();

    await api.dispose();
  });

  test("second merge-fee flow: uploading in the reactivated banner flow hides the banner and removes the dismissed key again", async ({
    page,
    baseURL,
  }) => {
    // Companion to the "re-injecting the pending signal after a batch-scoped
    // upload … reactivates the banner" test above.
    //
    // That test confirms step (d): the banner reappears when the pending signal
    // is re-injected and the dismissed key is absent (after a first upload).
    //
    // THIS TEST confirms the natural follow-on: once the banner is showing for
    // the second merge-fee flow, the user uploads a file, and:
    //   1. The banner + inline reminder collapse immediately after the upload.
    //   2. The batch-scoped dismissed key is removed again (cleanup for any
    //      potential third flow on the same batch).

    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── First visit: inject BOTH signals and navigate to Uploads ─────────────
    const batchId = "test-batch-" + randomBytes(4).toString("hex");
    await page.evaluate((id) => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
      sessionStorage.setItem("ibccf.pending_merge_batch_id", id);
    }, batchId);

    const depositNavItem = page.getByTestId("nav-deposit");
    await expect(depositNavItem).toBeVisible({ timeout: 10_000 });
    await depositNavItem.click();

    // ── Banner and inline reminder are visible before the first upload ────────
    const banner = page.getByTestId("banner-merge-fee-notice");
    const inlineReminder = page.getByTestId("reminder-merge-fee-inline");

    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── First upload ──────────────────────────────────────────────────────────
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof-second-flow-1.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    const uploadingBadge = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge).not.toBeVisible({ timeout: 15_000 });

    // Banner and inline reminder must be gone after the first upload.
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // Batch-scoped dismissed key must have been removed by the first upload.
    const dismissedKeyAfterFirstUpload = await page.evaluate(
      (id) => sessionStorage.getItem(`ibccf.merge_fee_banner_dismissed_${id}`),
      batchId,
    );
    expect(
      dismissedKeyAfterFirstUpload,
      "batch-scoped dismissed key removed after first upload",
    ).toBeNull();

    // ── Navigate away to the Dashboard ───────────────────────────────────────
    const dashboardNavItem = page.getByTestId("nav-dashboard");
    await expect(dashboardNavItem).toBeVisible({ timeout: 5_000 });
    await dashboardNavItem.click();

    const categorySelectGone = page.getByTestId("select-upload-category");
    await expect(categorySelectGone).toHaveCount(0, { timeout: 10_000 });

    // ── Re-inject BOTH signals to simulate the second merge-fee flow ──────────
    // Because the dismissed key was removed by the first upload, the banner
    // will reappear on this second visit (confirmed by the companion test above).
    await page.evaluate((id) => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
      sessionStorage.setItem("ibccf.pending_merge_batch_id", id);
    }, batchId);

    // ── Navigate back to the Uploads view (second visit) ─────────────────────
    await depositNavItem.click();

    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // ── Banner and inline reminder MUST reappear (second flow) ───────────────
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Second upload ─────────────────────────────────────────────────────────
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof-second-flow-2.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    const uploadingBadge2 = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge2).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge2).not.toBeVisible({ timeout: 15_000 });

    // ── Banner + inline reminder must collapse after the second upload ────────
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // ── Batch-scoped dismissed key must again be removed after the second upload
    // The same cleanup path fires on every successful merge-fee upload so that
    // any further (third, fourth …) flow for the same batch can still reactivate
    // the banner if needed.
    const dismissedKeyAfterSecondUpload = await page.evaluate(
      (id) => sessionStorage.getItem(`ibccf.merge_fee_banner_dismissed_${id}`),
      batchId,
    );
    expect(
      dismissedKeyAfterSecondUpload,
      "batch-scoped dismissed key removed after second upload",
    ).toBeNull();

    await api.dispose();
  });

  test("third merge-fee flow: re-injecting signals after the second upload reactivates the banner and a third upload hides it and removes the dismissed key again", async ({
    page,
    baseURL,
  }) => {
    // Verifies that the dismissed-key cleanup loop is truly idempotent for any
    // number of sequential merge-fee flows on the same batch.
    //
    // The "second merge-fee flow" test (task-1114) confirmed:
    //   Upload 1 → banner collapses, dismissed key absent
    //   Re-inject signals → banner reappears
    //   Upload 2 → banner collapses, dismissed key absent
    //
    // THIS TEST extends the sequence by one more cycle:
    //   … (two uploads above, both verified) …
    //   Re-inject signals a THIRD time → banner reappears again
    //   Upload 3 → banner collapses, dismissed key absent again
    //
    // The key invariant: every successful upload removes the batch-scoped
    // dismissed key so the *next* injection of the pending signal can
    // reactivate the banner — regardless of how many uploads have already
    // occurred.

    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    const batchId = "test-batch-" + randomBytes(4).toString("hex");
    const banner = page.getByTestId("banner-merge-fee-notice");
    const inlineReminder = page.getByTestId("reminder-merge-fee-inline");
    const depositNavItem = page.getByTestId("nav-deposit");
    const dashboardNavItem = page.getByTestId("nav-dashboard");

    // ════════════════════════════════════════════════════════════════════════
    // FIRST UPLOAD
    // ════════════════════════════════════════════════════════════════════════

    // ── Inject BOTH signals and navigate to Uploads ───────────────────────
    await page.evaluate((id) => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
      sessionStorage.setItem("ibccf.pending_merge_batch_id", id);
    }, batchId);

    await expect(depositNavItem).toBeVisible({ timeout: 10_000 });
    await depositNavItem.click();

    // Banner and inline reminder are visible before the first upload.
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Upload a file (first time) ────────────────────────────────────────
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof-third-flow-1.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    const uploadingBadge1 = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge1).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge1).not.toBeVisible({ timeout: 15_000 });

    // Banner and inline reminder must be gone after the first upload.
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // Batch-scoped dismissed key must be absent after the first upload.
    const dismissedKeyAfterUpload1 = await page.evaluate(
      (id) => sessionStorage.getItem(`ibccf.merge_fee_banner_dismissed_${id}`),
      batchId,
    );
    expect(
      dismissedKeyAfterUpload1,
      "batch-scoped dismissed key removed after first upload",
    ).toBeNull();

    // ── Navigate away to Dashboard ────────────────────────────────────────
    await expect(dashboardNavItem).toBeVisible({ timeout: 5_000 });
    await dashboardNavItem.click();

    await expect(page.getByTestId("select-upload-category")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ════════════════════════════════════════════════════════════════════════
    // SECOND UPLOAD
    // ════════════════════════════════════════════════════════════════════════

    // ── Re-inject BOTH signals to simulate the second merge-fee flow ──────
    // Because the dismissed key was removed by the first upload, the banner
    // will reappear on this visit.
    await page.evaluate((id) => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
      sessionStorage.setItem("ibccf.pending_merge_batch_id", id);
    }, batchId);

    await depositNavItem.click();

    await expect(page.getByTestId("select-upload-category")).toBeVisible({
      timeout: 10_000,
    });

    // Banner and inline reminder MUST reappear (second flow).
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Upload a file (second time) ───────────────────────────────────────
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof-third-flow-2.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    const uploadingBadge2 = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge2).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge2).not.toBeVisible({ timeout: 15_000 });

    // Banner and inline reminder must be gone after the second upload.
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // Batch-scoped dismissed key must again be absent after the second upload.
    const dismissedKeyAfterUpload2 = await page.evaluate(
      (id) => sessionStorage.getItem(`ibccf.merge_fee_banner_dismissed_${id}`),
      batchId,
    );
    expect(
      dismissedKeyAfterUpload2,
      "batch-scoped dismissed key removed after second upload",
    ).toBeNull();

    // ── Navigate away to Dashboard ────────────────────────────────────────
    await dashboardNavItem.click();

    await expect(page.getByTestId("select-upload-category")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ════════════════════════════════════════════════════════════════════════
    // THIRD UPLOAD  ← the idempotency check
    // ════════════════════════════════════════════════════════════════════════

    // ── Re-inject BOTH signals a THIRD time ───────────────────────────────
    // The dismissed key was removed again by the second upload, so the banner
    // must reappear exactly as it did for the second flow.  This confirms
    // the cleanup is correct for any number of sequential merge-fee flows.
    await page.evaluate((id) => {
      sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
      sessionStorage.setItem("ibccf.pending_merge_batch_id", id);
    }, batchId);

    await depositNavItem.click();

    await expect(page.getByTestId("select-upload-category")).toBeVisible({
      timeout: 10_000,
    });

    // ── Banner and inline reminder MUST reappear (third flow) ─────────────
    // On mount DepositView evaluates:
    //   - ibccf.pending_upload_category='merge_fee'  → pending signal present
    //   - ibccf.merge_fee_banner_dismissed_<batchId> → absent (removed by
    //     the second upload)  → alreadyDismissed=false
    //   → setShowMergeFeeBanner(true)
    // This is the same evaluation as for the second flow, confirming that
    // the cleanup path is stateless and repeatable for any N-th flow.
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Upload a file (third time) ────────────────────────────────────────
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof-third-flow-3.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    const uploadingBadge3 = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge3).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge3).not.toBeVisible({ timeout: 15_000 });

    // ── Banner + inline reminder must collapse after the third upload ──────
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // ── Batch-scoped dismissed key must again be absent after the third upload
    // Every successful merge-fee upload runs the same cleanup path, removing
    // the batch-scoped dismissed key so that any further (fourth, fifth …)
    // flow on the same batch can still reactivate the banner.
    const dismissedKeyAfterUpload3 = await page.evaluate(
      (id) => sessionStorage.getItem(`ibccf.merge_fee_banner_dismissed_${id}`),
      batchId,
    );
    expect(
      dismissedKeyAfterUpload3,
      "batch-scoped dismissed key removed after third upload",
    ).toBeNull();

    await api.dispose();
  });

  test("Upload proof button links to the specific pending row: button disappears and badge stays after uploading proof for that row", async ({
    page,
    baseURL,
  }) => {
    // Regression guard for the full end-to-end flow:
    //
    //   1. Admin creates a pending merge_fee placeholder receipt (no imageData).
    //   2. User sees the "Upload proof" button on that specific history row.
    //   3. User clicks "Upload proof" → DepositView opens with merge_fee selected.
    //   4. User uploads a file → server PATCHes the placeholder receipt, adding
    //      imageData/fileName (no new receipt is created).
    //   5. User navigates back to WithdrawalView.
    //   6. The history row now has a fileName, so isPending=false → "Upload
    //      proof" button is gone.
    //   7. The "Pending review" badge (status='pending') is still shown because
    //      an admin has not yet approved/rejected the receipt.
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Seed a pending merge_fee placeholder receipt (no image) ───────────────
    // This is what the admin creates to signal "we need your merge fee proof".
    // The row starts with fileName=null, status='pending'.
    const seedRes = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}250 USDT` },
    });
    expect(seedRes.status(), "seed placeholder receipt").toBe(200);
    const receiptId = (await seedRes.json()).id as number;
    expect(receiptId, "placeholder receipt has an id").toBeTruthy();

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── The Batch Merge History card is visible with the pending row ───────────
    const historyCard = page.getByTestId("card-batch-history");
    await expect(historyCard).toBeVisible({ timeout: 10_000 });

    const pendingRow = page.getByTestId(`batch-history-row-${receiptId}`);
    await expect(pendingRow).toBeVisible();

    // The "Upload proof" button is visible on the pending row (no file yet).
    const uploadBtn = pendingRow.getByTestId(`batch-history-upload-${receiptId}`);
    await expect(uploadBtn).toBeVisible();

    // "Pending review" badge is visible.
    await expect(pendingRow.getByTestId("receipt-status-badge")).toContainText("Pending review");

    // ── Click "Upload proof" on the specific pending row ──────────────────────
    // handleUploadProof() stores ibccf.pending_upload_category='merge_fee',
    // ibccf.pending_merge_batch_id=receiptId, and
    // ibccf.pending_merge_receipt_id=receiptId in sessionStorage, then calls
    // setViewState('deposit') to navigate to DepositView.
    await uploadBtn.click();

    // ── DepositView is now shown ─────────────────────────────────────────────
    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // Category is pre-selected to "Batch merge fee".
    await expect(categorySelect).toContainText("Batch merge fee", {
      timeout: 5_000,
    });

    // ── Upload a file ─────────────────────────────────────────────────────────
    // DepositView reads ibccf.pending_merge_receipt_id and forwards it in the
    // POST body as receiptId, so the server PATCHes the placeholder receipt
    // (adding imageData + fileName) instead of creating a new receipt.
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    // Wait for the upload to complete — the uploading badge appears then
    // disappears once the server responds.
    const uploadingBadge = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge).not.toBeVisible({ timeout: 15_000 });

    // ── Navigate back to the Withdrawal view ─────────────────────────────────
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // Wait for the history card to (re-)appear and the data to be refetched.
    const historyCardAfter = page.getByTestId("card-batch-history");
    await expect(historyCardAfter).toBeVisible({ timeout: 10_000 });

    // ── "Upload proof" button must be GONE on the specific row ────────────────
    // The server PATCHed the placeholder receipt with imageData and fileName,
    // so the row now has fileName≠null.  WithdrawalView's isPending check
    // (status !== approved/rejected && !fileName) evaluates to false, hiding
    // the button.
    const rowAfter = page.getByTestId(`batch-history-row-${receiptId}`);
    await expect(rowAfter).toBeVisible();
    await expect(
      rowAfter.getByTestId(`batch-history-upload-${receiptId}`),
    ).toHaveCount(0, { timeout: 10_000 });

    // ── "Pending review" badge is still shown ─────────────────────────────────
    // The receipt status is still 'pending' (admin has not yet approved it);
    // the badge label "Pending review" must remain visible so the user knows
    // their proof is under review.
    await expect(rowAfter.getByTestId("receipt-status-badge")).toContainText("Pending review");

    await api.dispose();
  });

  test("keyboard cancel: pressing Enter on the focused Cancel button closes the merge-confirm dialog and keeps the user on WithdrawalView with no POST fired", async ({
    page,
    baseURL,
  }) => {
    // Regression guard for keyboard accessibility (WCAG 2.1 AA).
    //
    // A Cancel button that responds to mouse clicks but silently swallows
    // keyboard Enter would be inaccessible to keyboard-only users.  This test
    // exercises the keyboard-Enter path directly, independently of any mouse
    // interaction, to ensure they cannot regress separately.
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Track any POST to the deposit-receipts endpoint ──────────────────────
    // Cancelling via keyboard must not trigger any server call.
    let depositReceiptPostFired = false;
    await page.route(`**/api/cases/${caseId}/deposit-receipts`, (route) => {
      if (route.request().method() === "POST") {
        depositReceiptPostFired = true;
      }
      void route.continue();
    });

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── Click "Merge Withdrawal" to open the confirmation dialog ─────────────
    await page.getByTestId("button-merge-withdrawal").click();
    await expect(page.getByTestId("card-merge-confirm")).toBeVisible();

    expect(depositReceiptPostFired, "no POST before keyboard cancel").toBe(false);

    // ── Focus the Cancel button and press Enter ───────────────────────────────
    // This exercises the button's keyboard activation path.  A regression that
    // wires only onClick (pointer) and not the native button keyboard handler
    // would fail here while mouse clicks continued to work.
    const cancelBtn = page.getByTestId("button-merge-cancel");
    await cancelBtn.focus();
    await expect(cancelBtn).toBeFocused();
    await page.keyboard.press("Enter");

    // ── Confirmation dialog must disappear ───────────────────────────────────
    await expect(page.getByTestId("card-merge-confirm")).toHaveCount(0, {
      timeout: 5_000,
    });

    // ── User must still be on WithdrawalView, not DepositView ────────────────
    await expect(page.getByTestId("view-withdrawal")).toBeVisible();
    await expect(page.getByTestId("select-upload-category")).toHaveCount(0);

    // ── No POST to deposit-receipts must have been fired ─────────────────────
    expect(depositReceiptPostFired, "no POST after keyboard cancel").toBe(false);

    await api.dispose();
  });

  test("keyboard cancel: pressing Escape from within the merge-confirm dialog closes it and keeps the user on WithdrawalView with no POST fired", async ({
    page,
    baseURL,
  }) => {
    // Regression guard for keyboard accessibility (WCAG 2.1 AA).
    //
    // Escape is the conventional keyboard shortcut for dismissing a confirmation
    // prompt.  If the onKeyDown handler is dropped from card-merge-confirm (or
    // Escape is swallowed somewhere in the event chain), keyboard-only users lose
    // an expected exit path.  This test exercises the Escape-key path from both
    // the Cancel button and the Confirm button to ensure either focus position
    // works.
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Track any POST to the deposit-receipts endpoint ──────────────────────
    let depositReceiptPostFired = false;
    await page.route(`**/api/cases/${caseId}/deposit-receipts`, (route) => {
      if (route.request().method() === "POST") {
        depositReceiptPostFired = true;
      }
      void route.continue();
    });

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── First open: Escape with focus on the Cancel button ───────────────────
    await page.getByTestId("button-merge-withdrawal").click();
    await expect(page.getByTestId("card-merge-confirm")).toBeVisible();

    expect(depositReceiptPostFired, "no POST before first Escape").toBe(false);

    // Focus the Cancel button and press Escape.  The keydown event bubbles from
    // the button up to the card-merge-confirm div, where the onKeyDown handler
    // catches it and calls setShowMergeConfirm(false).
    const cancelBtn = page.getByTestId("button-merge-cancel");
    await cancelBtn.focus();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("card-merge-confirm")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page.getByTestId("view-withdrawal")).toBeVisible();
    await expect(page.getByTestId("select-upload-category")).toHaveCount(0);

    expect(depositReceiptPostFired, "no POST after first Escape").toBe(false);

    // ── Second open: Escape with focus on the Confirm & Upload button ─────────
    // Confirms the Escape handler works regardless of which button has focus,
    // not just when Cancel is focused.
    await page.getByTestId("button-merge-withdrawal").click();
    await expect(page.getByTestId("card-merge-confirm")).toBeVisible({
      timeout: 5_000,
    });

    const confirmBtn = page.getByTestId("button-merge-confirm");
    await confirmBtn.focus();
    await expect(confirmBtn).toBeFocused();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("card-merge-confirm")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page.getByTestId("view-withdrawal")).toBeVisible();
    await expect(page.getByTestId("select-upload-category")).toHaveCount(0);

    expect(depositReceiptPostFired, "no POST after second Escape").toBe(false);

    await api.dispose();
  });

  test("open-cancel-reopen: 'Confirm & Upload' triggered via keyboard (Tab → Enter) navigates to DepositView with merge_fee pre-selected and fires no premature POST", async ({
    page,
    baseURL,
  }) => {
    // Regression guard for keyboard accessibility (WCAG 2.1 AA).
    //
    // A stale closure or event-handler regression introduced by the
    // open-cancel-reopen cycle could silently break keyboard navigation
    // while mouse clicks continue to work — keyboard-only users would
    // experience the regression first.  This test exercises the same
    // scenario as "open-cancel-reopen-confirm" but activates "Confirm &
    // Upload" via Tab focus + Enter instead of a pointer click.
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Track any POST to the deposit-receipts endpoint ──────────────────────
    // No placeholder receipt must be created before the user attaches a file.
    let depositReceiptPostFired = false;
    await page.route(`**/api/cases/${caseId}/deposit-receipts`, (route) => {
      if (route.request().method() === "POST") {
        depositReceiptPostFired = true;
      }
      void route.continue();
    });

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    // ── Navigate to the Withdrawal view ──────────────────────────────────────
    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── First open: click "Merge Withdrawal" ─────────────────────────────────
    await page.getByTestId("button-merge-withdrawal").click();
    await expect(page.getByTestId("card-merge-confirm")).toBeVisible();

    expect(depositReceiptPostFired, "no POST after first open").toBe(false);

    // ── Cancel: dialog must disappear, user stays on WithdrawalView ──────────
    await page.getByTestId("button-merge-cancel").click();
    await expect(page.getByTestId("card-merge-confirm")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page.getByTestId("view-withdrawal")).toBeVisible();

    expect(depositReceiptPostFired, "no POST after cancel").toBe(false);

    // ── Second open: click "Merge Withdrawal" again ───────────────────────────
    await page.getByTestId("button-merge-withdrawal").click();
    await expect(page.getByTestId("card-merge-confirm")).toBeVisible({
      timeout: 5_000,
    });

    expect(depositReceiptPostFired, "no POST after re-open").toBe(false);

    // ── Keyboard activation: Tab from Cancel → Enter on Confirm & Upload ─────
    // The confirm card has exactly two buttons in DOM order: "Cancel" then
    // "Confirm & Upload".  Focusing "Cancel" and pressing Tab once moves
    // focus to "Confirm & Upload"; pressing Enter activates it.  This
    // exercises the button's keyboard event path, catching any regression
    // where a stale closure's handler fires (or fails to fire) differently
    // from a pointer-click handler.
    const cancelBtn = page.getByTestId("button-merge-cancel");
    await cancelBtn.focus();
    await page.keyboard.press("Tab");

    // Confirm the "Confirm & Upload" button now has keyboard focus.
    const confirmBtn = page.getByTestId("button-merge-confirm");
    await expect(confirmBtn).toBeFocused();

    // Activate via Enter — the keyboard equivalent of a mouse click.
    await page.keyboard.press("Enter");

    // ── DepositView must become visible ───────────────────────────────────────
    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });

    // ── Upload category must be pre-selected to "Batch merge fee" ────────────
    // submitMergeFee() writes ibccf.pending_upload_category='merge_fee' to
    // sessionStorage before calling setViewState('deposit'); DepositView reads
    // and clears that signal on mount, selecting the "Batch merge fee" option.
    await expect(categorySelect).toContainText("Batch merge fee", {
      timeout: 5_000,
    });

    // ── No POST to deposit-receipts must have fired at any point ─────────────
    expect(
      depositReceiptPostFired,
      "no POST to deposit-receipts before file chosen",
    ).toBe(false);

    await api.dispose();
  });

  test("third merge-fee flow via Upload proof button path: three sequential button clicks each show the banner, complete the upload, and leave the dismissed key absent", async ({
    page,
    baseURL,
  }) => {
    // This test mirrors the "third merge-fee flow" idempotency test (task-1176),
    // which verified the dismissed-key cleanup loop using sessionStorage injection
    // only.  The `batch-history-upload-{id}` button path is a distinct entry
    // point: handleUploadProof() sets both ibccf.pending_upload_category and
    // ibccf.pending_merge_batch_id (to the specific receiptId) before navigating
    // to DepositView.  The idempotency guarantee should hold for three sequential
    // flows through this button path.
    //
    // Flow:
    //   Seed 3 admin-created placeholder receipts (no file, status='pending').
    //   Flow 1: click Upload proof on receipt 1 → banner shows → upload completes
    //           → banner gone → dismissed key for receipt 1 absent.
    //   Flow 2: click Upload proof on receipt 2 → banner shows → upload completes
    //           → banner gone → dismissed key for receipt 2 absent.
    //   Flow 3: click Upload proof on receipt 3 → banner shows → upload completes
    //           → banner gone → dismissed key for receipt 3 absent.
    //
    // Each flow uses a different receiptId as the batch-scoped key, so the test
    // exercises handleUploadProof's key-setting and DepositView's cleanup path
    // independently for all three flows.

    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const pin = "246810";

    const caseId = await createMergeCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // ── Seed three pending merge_fee placeholder receipts ─────────────────────
    // Each placeholder starts with status='pending' and no file, so each row
    // in WithdrawalView's Batch Merge History shows an "Upload proof" button.
    // Each upload will PATCH the targeted placeholder, setting its fileName and
    // making its row's isPending check evaluate to false (hiding the button).
    const seed1 = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}250 USDT` },
    });
    expect(seed1.status(), "seed receipt 1").toBe(200);
    const receiptId1 = (await seed1.json()).id as number;

    const seed2 = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}260 USDT` },
    });
    expect(seed2.status(), "seed receipt 2").toBe(200);
    const receiptId2 = (await seed2.json()).id as number;

    const seed3 = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}270 USDT` },
    });
    expect(seed3.status(), "seed receipt 3").toBe(200);
    const receiptId3 = (await seed3.json()).id as number;

    // ── Log in to the portal ─────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    const withdrawalNavItem = page.getByTestId("nav-withdrawal");
    const banner = page.getByTestId("banner-merge-fee-notice");
    const inlineReminder = page.getByTestId("reminder-merge-fee-inline");

    // ════════════════════════════════════════════════════════════════════════
    // FIRST UPLOAD via Upload proof button (receipt 1)
    // ════════════════════════════════════════════════════════════════════════

    // ── Navigate to WithdrawalView ────────────────────────────────────────
    await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // ── Batch Merge History card is visible with the pending row ──────────
    const historyCard = page.getByTestId("card-batch-history");
    await expect(historyCard).toBeVisible({ timeout: 10_000 });

    const uploadBtn1 = page.getByTestId(`batch-history-upload-${receiptId1}`);
    await expect(uploadBtn1).toBeVisible();

    // ── Click "Upload proof" for receipt 1 ───────────────────────────────
    // handleUploadProof() sets:
    //   ibccf.pending_upload_category   = 'merge_fee'
    //   ibccf.pending_merge_batch_id    = String(receiptId1)
    //   ibccf.pending_merge_receipt_id  = String(receiptId1)
    // then calls setViewState('deposit').
    await uploadBtn1.click();

    // ── DepositView is now shown with merge_fee pre-selected ──────────────
    const categorySelect = page.getByTestId("select-upload-category");
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });
    await expect(categorySelect).toContainText("Batch merge fee", {
      timeout: 5_000,
    });

    // ── Banner and inline reminder must be visible ────────────────────────
    // DepositView reads ibccf.pending_upload_category='merge_fee' on mount,
    // clears the key, and evaluates the batch-scoped dismissed key
    // (ibccf.merge_fee_banner_dismissed_<receiptId1>) — absent on first flow.
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Upload a file (first time) ────────────────────────────────────────
    // DepositView reads ibccf.pending_merge_receipt_id and passes it in the
    // POST body so the server PATCHes the placeholder receipt (no new row).
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof-button-path-1.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    const uploadingBadge1 = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge1).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge1).not.toBeVisible({ timeout: 15_000 });

    // Banner and inline reminder must be gone after the first upload.
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // ── Batch-scoped dismissed key must be absent after the first upload ──
    // handleFileUpload removes ibccf.merge_fee_banner_dismissed_<receiptId1>
    // on success so any future flow on this batch starts fresh.
    const dismissedKey1 = await page.evaluate(
      (id) =>
        sessionStorage.getItem(`ibccf.merge_fee_banner_dismissed_${id}`),
      String(receiptId1),
    );
    expect(
      dismissedKey1,
      "batch-scoped dismissed key removed after first upload",
    ).toBeNull();

    // ════════════════════════════════════════════════════════════════════════
    // SECOND UPLOAD via Upload proof button (receipt 2)
    // ════════════════════════════════════════════════════════════════════════

    // ── Return to WithdrawalView ──────────────────────────────────────────
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // Receipt 1's row no longer shows the Upload proof button (fileName set).
    // Receipt 2's row must still have its button (no file yet).
    await expect(historyCard).toBeVisible({ timeout: 10_000 });

    // Confirm receipt 1's Upload proof button is gone (PATCH succeeded: fileName set).
    await expect(
      page.getByTestId(`batch-history-upload-${receiptId1}`),
    ).toHaveCount(0, { timeout: 10_000 });

    const uploadBtn2 = page.getByTestId(`batch-history-upload-${receiptId2}`);
    await expect(uploadBtn2).toBeVisible({ timeout: 10_000 });

    // ── Click "Upload proof" for receipt 2 ───────────────────────────────
    // handleUploadProof() now keys the batch-scoped state to receiptId2,
    // which is a fresh key — the banner must reappear without any prior
    // dismissal state.
    await uploadBtn2.click();

    // ── DepositView is now shown with merge_fee pre-selected ──────────────
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });
    await expect(categorySelect).toContainText("Batch merge fee", {
      timeout: 5_000,
    });

    // ── Banner and inline reminder must be visible (second flow) ─────────
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Upload a file (second time) ───────────────────────────────────────
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof-button-path-2.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    const uploadingBadge2 = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge2).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge2).not.toBeVisible({ timeout: 15_000 });

    // Banner and inline reminder must be gone after the second upload.
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // ── Batch-scoped dismissed key must be absent after the second upload ─
    const dismissedKey2 = await page.evaluate(
      (id) =>
        sessionStorage.getItem(`ibccf.merge_fee_banner_dismissed_${id}`),
      String(receiptId2),
    );
    expect(
      dismissedKey2,
      "batch-scoped dismissed key removed after second upload",
    ).toBeNull();

    // ════════════════════════════════════════════════════════════════════════
    // THIRD UPLOAD via Upload proof button (receipt 3)  ← idempotency check
    // ════════════════════════════════════════════════════════════════════════

    // ── Return to WithdrawalView ──────────────────────────────────────────
    await withdrawalNavItem.click();

    await expect(page.getByTestId("view-withdrawal")).toBeVisible({
      timeout: 10_000,
    });

    // Receipt 3's row must still show the Upload proof button.
    await expect(historyCard).toBeVisible({ timeout: 10_000 });

    // Confirm receipt 2's Upload proof button is gone (PATCH succeeded: fileName set).
    await expect(
      page.getByTestId(`batch-history-upload-${receiptId2}`),
    ).toHaveCount(0, { timeout: 10_000 });

    const uploadBtn3 = page.getByTestId(`batch-history-upload-${receiptId3}`);
    await expect(uploadBtn3).toBeVisible({ timeout: 10_000 });

    // ── Click "Upload proof" for receipt 3 (third flow) ──────────────────
    // This is the idempotency check: the cleanup path must still work
    // correctly on a third sequential flow through the button entry point.
    await uploadBtn3.click();

    // ── DepositView is now shown with merge_fee pre-selected ──────────────
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });
    await expect(categorySelect).toContainText("Batch merge fee", {
      timeout: 5_000,
    });

    // ── Banner and inline reminder MUST be visible (third flow) ──────────
    // On mount DepositView evaluates:
    //   - ibccf.pending_upload_category='merge_fee'          → pending signal
    //   - ibccf.merge_fee_banner_dismissed_<receiptId3>      → absent (fresh)
    //   → setShowMergeFeeBanner(true)
    // Both cleanup paths from the prior two uploads are independent (different
    // receiptId keys), so this third flow starts with a clean dismissed state.
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(inlineReminder).toBeVisible({ timeout: 10_000 });

    // ── Upload a file (third time) ────────────────────────────────────────
    await page
      .getByTestId("input-file-upload")
      .setInputFiles({
        name: "merge-fee-proof-button-path-3.png",
        mimeType: "image/png",
        buffer: minimalPng,
      });

    const uploadingBadge3 = page.getByTestId("badge-merge-fee-uploading");
    await expect(uploadingBadge3).toBeVisible({ timeout: 5_000 });
    await expect(uploadingBadge3).not.toBeVisible({ timeout: 15_000 });

    // ── Banner + inline reminder must collapse after the third upload ──────
    await expect(banner).toHaveCount(0);
    await expect(inlineReminder).toHaveCount(0);

    // ── Batch-scoped dismissed key must be absent after the third upload ───
    // Every successful merge-fee upload runs the same cleanup path, removing
    // the batch-scoped dismissed key so that any further flow on the same
    // batch can still reactivate the banner — confirming the cleanup is
    // stateless and repeatable for any N-th flow via either entry point.
    const dismissedKey3 = await page.evaluate(
      (id) =>
        sessionStorage.getItem(`ibccf.merge_fee_banner_dismissed_${id}`),
      String(receiptId3),
    );
    expect(
      dismissedKey3,
      "batch-scoped dismissed key removed after third upload",
    ).toBeNull();

    // ── All three Upload proof buttons must be simultaneously absent ───────
    // After completing all three upload flows the batch-history rows for
    // every receipt must show no Upload proof button — confirming that no
    // row silently regressed to re-showing the button once the final flow
    // finished.
    await expect(
      page.getByTestId(`batch-history-upload-${receiptId1}`),
    ).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.getByTestId(`batch-history-upload-${receiptId2}`),
    ).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.getByTestId(`batch-history-upload-${receiptId3}`),
    ).toHaveCount(0, { timeout: 10_000 });

    await api.dispose();
  });
});
