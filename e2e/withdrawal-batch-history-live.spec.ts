// e2e/withdrawal-batch-history-live.spec.ts
//
// Integration guard for the Batch Merge History card in WithdrawalView.
//
// WHAT THIS TESTS
// ───────────────
// Complements withdrawal-batch-history.spec.ts (which mocks the API) by
// performing a full end-to-end round-trip:
//
//   1. Create a real case via the admin API.
//   2. Set a portal PIN — extracting the session token from the response.
//   3. POST a real merge_fee receipt (small base64 PNG) to
//      /api/cases/:id/deposit-receipts using the portal session token.
//   4. Log in through the browser UI and navigate to WithdrawalView.
//   5. Assert the Batch History card and the uploaded row are visible
//      WITHOUT any page.route() interception — the data comes from the DB.
//
// This catches server-side regressions in collectMergedReceipts (e.g. if the
// category filter stops returning merge_fee rows from deposit_receipts).

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { BATCH_FEE_NOTES_PREFIX } from "../shared/constants";
import {
  uniqueAccessCode,
  uniqueEmail,
  loginAdminApi,
  createCase,
  issuePortalSession,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

// Minimal 1×1 transparent PNG expressed as a base64 data URL.
// Small enough to be well within the 12 MB request cap; large enough to
// satisfy the ≥64-char imageData minimum check on the server.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA" +
  "DUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const MERGE_FEE_NOTES = `${BATCH_FEE_NOTES_PREFIX}500 USDT`;
const TEST_PIN = "246802";

async function uploadMergeFeeReceipt(
  api: APIRequestContext,
  caseId: string,
  portalToken: string,
): Promise<number> {
  const res = await api.post(`/api/cases/${caseId}/deposit-receipts`, {
    headers: { "x-portal-session-token": portalToken },
    data: {
      category: "merge_fee",
      imageData: TINY_PNG,
      fileName: "merge-fee-proof.png",
      notes: MERGE_FEE_NOTES,
    },
  });
  expect(res.status(), "upload merge_fee receipt").toBe(200);
  const body = await res.json();
  expect(body.id, "receipt id present").toBeTruthy();
  return body.id as number;
}

async function loginPortal(
  page: import("@playwright/test").Page,
  accessCode: string,
  pin: string,
): Promise<void> {
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
}

async function goToWithdrawalView(
  page: import("@playwright/test").Page,
): Promise<void> {
  const withdrawalNavItem = page.getByTestId("nav-withdrawal");
  await expect(withdrawalNavItem).toBeVisible({ timeout: 10_000 });
  await withdrawalNavItem.click();
  await expect(page.getByTestId("view-withdrawal")).toBeVisible({
    timeout: 10_000,
  });
}

async function patchReceiptStatus(
  api: APIRequestContext,
  receiptId: number,
  status: "pending" | "approved" | "rejected",
  token: string,
  adminNotes?: string,
): Promise<void> {
  const res = await api.patch(`/api/deposit-receipts/${receiptId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: adminNotes ? { status, adminNotes } : { status },
  });
  expect(res.status(), `patch receipt to ${status}`).toBe(200);
  const body = await res.json();
  expect(body.status, `receipt status in response`).toBe(status);
}

// ---------------------------------------------------------------------------

test.describe("Portal — Withdrawal Batch History card (live data, no mocking)", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run portal e2e tests");
    }
  });

  let adminToken = "";
  let caseId = "";

  test.afterAll(async ({ baseURL }) => {
    if (!caseId || !adminToken) return;
    const api = await request.newContext({ baseURL });
    await api.delete(`/api/cases/${caseId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await api.dispose();
  });

  test(
    "card-batch-history row appears after a real merge_fee receipt upload (no route interception)",
    async ({ page, baseURL }) => {
      const api = await request.newContext({ baseURL });

      adminToken = await loginAdminApi(api);

      const accessCode = uniqueAccessCode();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Batch History Live E2E",
        extraPatch: { withdrawalWindowEnabled: true },
      });

      // Set a PIN and capture the session token so we can call portal-auth'd
      // endpoints directly without going through the browser flow first.
      const portalToken = await issuePortalSession(api, accessCode, TEST_PIN);

      // Upload the merge_fee receipt via the real API — no page.route() mock.
      const receiptId = await uploadMergeFeeReceipt(api, caseId, portalToken);

      await api.dispose();

      // Log in through the browser UI and navigate to WithdrawalView.
      await loginPortal(page, accessCode, TEST_PIN);
      await goToWithdrawalView(page);

      // The Batch History card must be visible — it only renders when the
      // filtered merge_fee list is non-empty.
      const card = page.getByTestId("card-batch-history");
      await expect(card).toBeVisible({ timeout: 15_000 });

      // The row for the uploaded receipt must be present.
      const row = page.getByTestId(`batch-history-row-${receiptId}`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Amount label — notes "${BATCH_FEE_NOTES_PREFIX}500 USDT" → "Merge fee — 500 USDT"
      await expect(row).toContainText("Merge fee — 500 USDT");
      await expect(row).not.toContainText("Batch merge fee:");

      // New uploads are always pending on creation.
      await expect(row.getByTestId("receipt-status-badge")).toContainText("Pending review");

      // Date element must render a year substring (locale-formatted, env-variable).
      const dateEl = row.locator("p.text-xs");
      await expect(dateEl).toContainText("202");
    },
  );
});

// ---------------------------------------------------------------------------
// Admin approve / reject flow — verifies the portal badge updates correctly
// when the admin patches a receipt status and the user reloads the view.
// ---------------------------------------------------------------------------

test.describe("Portal — Batch History badge reflects admin approve / reject (live, no mocking)", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run portal e2e tests");
    }
  });

  let adminToken = "";
  let caseId = "";
  let accessCode = "";
  let portalToken = "";

  test.beforeAll(async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });
    adminToken = await loginAdminApi(api);
    accessCode = uniqueAccessCode();
    caseId = await createCase(api, adminToken, accessCode, {
      userName: "Batch History Live E2E",
      extraPatch: { withdrawalWindowEnabled: true },
    });
    portalToken = await issuePortalSession(api, accessCode, TEST_PIN);
    await api.dispose();
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseId || !adminToken) return;
    const api = await request.newContext({ baseURL });
    await api.delete(`/api/cases/${caseId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await api.dispose();
  });

  test(
    "badge shows Approved after admin approves the receipt via PATCH /api/deposit-receipts/:id",
    async ({ page, baseURL }) => {
      const api = await request.newContext({ baseURL });

      // Upload a real merge_fee receipt, then immediately approve it via the
      // admin API — no page.route() interception at any point.
      const receiptId = await uploadMergeFeeReceipt(api, caseId, portalToken);
      await patchReceiptStatus(api, receiptId, "approved", adminToken);
      await api.dispose();

      // Load the portal and navigate to WithdrawalView; the row must reflect
      // the updated status without any client-side mock.
      await loginPortal(page, accessCode, TEST_PIN);
      await goToWithdrawalView(page);

      const row = page.getByTestId(`batch-history-row-${receiptId}`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Status badge must read "Approved", never "Pending review".
      await expect(row.getByTestId("receipt-status-badge")).toContainText("Approved");
      await expect(row.getByTestId("receipt-status-badge")).not.toContainText("Pending review");
      await expect(row.getByTestId("receipt-status-badge")).not.toContainText("Rejected");
    },
  );

  test(
    "badge shows Rejected after admin rejects the receipt via PATCH /api/deposit-receipts/:id",
    async ({ page, baseURL }) => {
      const api = await request.newContext({ baseURL });

      // Upload a fresh receipt so this test is independent of the approve test.
      const receiptId = await uploadMergeFeeReceipt(api, caseId, portalToken);
      await patchReceiptStatus(
        api,
        receiptId,
        "rejected",
        adminToken,
        "Proof does not match the expected amount.",
      );
      await api.dispose();

      await loginPortal(page, accessCode, TEST_PIN);
      await goToWithdrawalView(page);

      const row = page.getByTestId(`batch-history-row-${receiptId}`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Status badge must read "Rejected", never "Pending review".
      await expect(row.getByTestId("receipt-status-badge")).toContainText("Rejected");
      await expect(row.getByTestId("receipt-status-badge")).not.toContainText("Pending review");
      await expect(row.getByTestId("receipt-status-badge")).not.toContainText("Approved");
    },
  );

  test(
    "badge returns to Pending review after admin walks back an approval via PATCH /api/deposit-receipts/:id",
    async ({ page, baseURL }) => {
      const api = await request.newContext({ baseURL });

      // Upload a fresh receipt and approve it, then immediately revert to
      // pending — this exercises the syncReissueFromReceipt revert branch.
      const receiptId = await uploadMergeFeeReceipt(api, caseId, portalToken);
      await patchReceiptStatus(api, receiptId, "approved", adminToken);
      await patchReceiptStatus(api, receiptId, "pending", adminToken);
      await api.dispose();

      // Load the portal; the badge must reflect the reverted status.
      await loginPortal(page, accessCode, TEST_PIN);
      await goToWithdrawalView(page);

      const row = page.getByTestId(`batch-history-row-${receiptId}`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // After the walk-back, the badge must show "Pending review" again.
      await expect(row.getByTestId("receipt-status-badge")).toContainText("Pending review");
      await expect(row.getByTestId("receipt-status-badge")).not.toContainText("Approved");
      await expect(row.getByTestId("receipt-status-badge")).not.toContainText("Rejected");
    },
  );

  test(
    "badge returns to Pending review after admin walks back a rejection via PATCH /api/deposit-receipts/:id",
    async ({ page, baseURL }) => {
      const api = await request.newContext({ baseURL });

      // Upload a fresh receipt, reject it, then revert to pending — this
      // exercises the rejected→pending branch of syncReissueFromReceipt,
      // which is distinct from the approved→pending path above.
      const receiptId = await uploadMergeFeeReceipt(api, caseId, portalToken);
      await patchReceiptStatus(
        api,
        receiptId,
        "rejected",
        adminToken,
        "Insufficient proof provided.",
      );
      await patchReceiptStatus(api, receiptId, "pending", adminToken);
      await api.dispose();

      // Load the portal; the badge must reflect the reverted status.
      await loginPortal(page, accessCode, TEST_PIN);
      await goToWithdrawalView(page);

      const row = page.getByTestId(`batch-history-row-${receiptId}`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // After the walk-back from rejected, the badge must show "Pending review".
      await expect(row.getByTestId("receipt-status-badge")).toContainText("Pending review");
      await expect(row.getByTestId("receipt-status-badge")).not.toContainText("Rejected");
      await expect(row.getByTestId("receipt-status-badge")).not.toContainText("Approved");
    },
  );
});
