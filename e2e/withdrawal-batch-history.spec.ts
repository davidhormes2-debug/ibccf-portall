// e2e/withdrawal-batch-history.spec.ts
//
// Regression guard for the Batch Merge History card in WithdrawalView.
//
// WHAT THIS TESTS
// ───────────────
// WithdrawalView fetches GET /api/cases/:id/all-receipts and renders a
// "Batch Merge History" card (data-testid="card-batch-history") only when
// at least one entry with category="merge_fee" is returned.  Each row shows:
//
//   • A date/time string derived from entry.uploadedAt
//   • An amount label extracted from entry.notes by stripping the
//     BATCH_FEE_NOTES_PREFIX — e.g. notes "${BATCH_FEE_NOTES_PREFIX}500 USDT"
//     renders as "Merge fee — 500 USDT"
//   • A status badge — "Approved", "Rejected", or "Pending review"
//
// The tests use page.route() to intercept the all-receipts endpoint and
// return controlled mock payloads, avoiding the need to upload actual files.

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { BATCH_FEE_NOTES_PREFIX } from "../shared/constants";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

function uniqueAccessCode(): string {
  return "E2EBH-" + randomBytes(5).toString("hex").toUpperCase();
}

function uniqueEmail(): string {
  return `e2e-bh-${randomBytes(3).toString("hex")}@example.com`;
}

async function loginAdmin(api: APIRequestContext): Promise<string> {
  const res = await api.post("/api/admin/login", {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  expect(res.status(), "admin login").toBe(200);
  const body = await res.json();
  expect(body.success, "admin login success").toBe(true);
  return body.token as string;
}

async function createHistoryCase(
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
      userName: "Batch History E2E",
      userEmail: uniqueEmail(),
      status: "active",
      withdrawalWindowEnabled: true,
    },
  });
  expect(patched.status(), "patch case").toBe(200);

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

// ---------------------------------------------------------------------------
// Shared mock receipt shape (mirrors MergedReceipt from server/routes/deposits.ts)
// ---------------------------------------------------------------------------
function makeMergeFeeEntry(overrides: {
  id: number;
  status: "pending" | "approved" | "rejected" | "reviewed";
  notes?: string | null;
  uploadedAt?: string;
}) {
  return {
    source: "deposit",
    id: overrides.id,
    caseId: "mock-case",
    accessCode: null,
    category: "merge_fee",
    status: overrides.status,
    fileName: "receipt.pdf",
    notes: overrides.notes ?? `${BATCH_FEE_NOTES_PREFIX}500 USDT`,
    adminNotes: null,
    amountUsdt: null,
    reissueId: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: overrides.uploadedAt ?? "2025-06-01T10:00:00.000Z",
    alertMuted: false,
  };
}

// ---------------------------------------------------------------------------

test.describe("Portal — Withdrawal Batch History card", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run portal e2e tests");
    }
  });

  const TEST_PIN = "135791";

  // ── Card hidden when no merge_fee receipts ─────────────────────────────
  test("card-batch-history is not rendered when no merge_fee receipts exist", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const caseId = await createHistoryCase(api, adminToken, accessCode);
    await setPin(api, accessCode, TEST_PIN);

    // Mock all-receipts to return only a non-merge_fee entry (activation).
    // WithdrawalView filters by category === 'merge_fee', so this resolves
    // to an empty list from the component's perspective.
    await page.route(`**/api/cases/${caseId}/all-receipts`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            source: "deposit",
            id: 1,
            caseId,
            accessCode: null,
            category: "activation",
            status: "pending",
            fileName: "activation.pdf",
            notes: null,
            adminNotes: null,
            amountUsdt: null,
            reissueId: null,
            reviewedAt: null,
            reviewedBy: null,
            uploadedAt: "2025-05-01T10:00:00.000Z",
            alertMuted: false,
          },
        ]),
      });
    });

    await loginPortal(page, accessCode, TEST_PIN);
    await goToWithdrawalView(page);

    // The batch history card must not appear.
    await expect(page.getByTestId("card-batch-history")).toHaveCount(0);

    await api.dispose();
  });

  // ── Card appears with a pending entry ─────────────────────────────────
  test("card-batch-history renders with 'Pending review' badge and amount label", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const caseId = await createHistoryCase(api, adminToken, accessCode);
    await setPin(api, accessCode, TEST_PIN);

    const mockEntry = makeMergeFeeEntry({
      id: 42,
      status: "pending",
      notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`,
      uploadedAt: "2025-06-01T14:30:00.000Z",
    });

    await page.route(`**/api/cases/${caseId}/all-receipts`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockEntry]),
      });
    });

    await loginPortal(page, accessCode, TEST_PIN);
    await goToWithdrawalView(page);

    const card = page.getByTestId("card-batch-history");
    await expect(card).toBeVisible({ timeout: 10_000 });

    const row = page.getByTestId("batch-history-row-42");
    await expect(row).toBeVisible();

    // ── Amount label — prefix stripping ───────────────────────────────────
    // notes "${BATCH_FEE_NOTES_PREFIX}500 USDT" → amountLabel "500 USDT"
    // The component strips BATCH_FEE_NOTES_PREFIX (case-insensitive) and formats as
    // "Merge fee — <amount>".  We assert the full final label AND confirm
    // the raw prefix is absent so a regression that skips stripping is
    // caught immediately.
    await expect(row).toContainText("Merge fee — 500 USDT");
    await expect(row).not.toContainText("Batch merge fee:");

    // ── Date rendered ─────────────────────────────────────────────────────
    // The exact locale-formatted string varies by environment; verify the
    // date element (second <p> inside the row) renders a year substring to
    // confirm the date is formatted at all, not left empty.
    const dateEl = row.locator("p.text-xs");
    await expect(dateEl).toContainText("2025");

    // ── Status badge ──────────────────────────────────────────────────────
    await expect(row.getByTestId("receipt-status-badge")).toContainText("Pending review");

    await api.dispose();
  });

  // ── Card renders 'Approved' badge ─────────────────────────────────────
  test("card-batch-history renders 'Approved' badge for an approved entry", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const caseId = await createHistoryCase(api, adminToken, accessCode);
    await setPin(api, accessCode, TEST_PIN);

    const mockEntry = makeMergeFeeEntry({
      id: 101,
      status: "approved",
      notes: `${BATCH_FEE_NOTES_PREFIX}1000 USDT`,
      uploadedAt: "2025-06-02T09:00:00.000Z",
    });

    await page.route(`**/api/cases/${caseId}/all-receipts`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockEntry]),
      });
    });

    await loginPortal(page, accessCode, TEST_PIN);
    await goToWithdrawalView(page);

    const row = page.getByTestId("batch-history-row-101");
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Verify full extracted label and absence of raw prefix.
    await expect(row).toContainText("Merge fee — 1000 USDT");
    await expect(row).not.toContainText("Batch merge fee:");
    await expect(row.getByTestId("receipt-status-badge")).toContainText("Approved");

    await api.dispose();
  });

  // ── Card renders 'Rejected' badge ─────────────────────────────────────
  test("card-batch-history renders 'Rejected' badge for a rejected entry", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const caseId = await createHistoryCase(api, adminToken, accessCode);
    await setPin(api, accessCode, TEST_PIN);

    const mockEntry = makeMergeFeeEntry({
      id: 202,
      status: "rejected",
      notes: `${BATCH_FEE_NOTES_PREFIX}250 USDT`,
      uploadedAt: "2025-06-03T16:45:00.000Z",
    });

    await page.route(`**/api/cases/${caseId}/all-receipts`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockEntry]),
      });
    });

    await loginPortal(page, accessCode, TEST_PIN);
    await goToWithdrawalView(page);

    const row = page.getByTestId("batch-history-row-202");
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Verify full extracted label and absence of raw prefix.
    await expect(row).toContainText("Merge fee — 250 USDT");
    await expect(row).not.toContainText("Batch merge fee:");
    await expect(row.getByTestId("receipt-status-badge")).toContainText("Rejected");

    await api.dispose();
  });

  // ── Amount label falls back to em-dash when notes is null ─────────────
  test("card-batch-history shows em-dash amount label when notes is null", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const caseId = await createHistoryCase(api, adminToken, accessCode);
    await setPin(api, accessCode, TEST_PIN);

    const mockEntry = makeMergeFeeEntry({
      id: 303,
      status: "pending",
      notes: null,
      uploadedAt: "2025-06-04T08:00:00.000Z",
    });

    await page.route(`**/api/cases/${caseId}/all-receipts`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockEntry]),
      });
    });

    await loginPortal(page, accessCode, TEST_PIN);
    await goToWithdrawalView(page);

    const row = page.getByTestId("batch-history-row-303");
    await expect(row).toBeVisible({ timeout: 10_000 });

    // null notes → amountLabel "—" → rendered full label: "Merge fee — —"
    // Assert the complete formatted string so a regression that changes the
    // fallback (e.g. empty string instead of em-dash) is caught.
    await expect(row).toContainText("Merge fee — —");

    await api.dispose();
  });

  // ── Card renders 'Pending review' badge for a 'reviewed' status entry ──
  test("card-batch-history renders 'Pending review' badge for a reviewed entry", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const caseId = await createHistoryCase(api, adminToken, accessCode);
    await setPin(api, accessCode, TEST_PIN);

    const mockEntry = makeMergeFeeEntry({
      id: 404,
      status: "reviewed",
      notes: `${BATCH_FEE_NOTES_PREFIX}750 USDT`,
      uploadedAt: "2025-06-05T11:00:00.000Z",
    });

    await page.route(`**/api/cases/${caseId}/all-receipts`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockEntry]),
      });
    });

    await loginPortal(page, accessCode, TEST_PIN);
    await goToWithdrawalView(page);

    const row = page.getByTestId("batch-history-row-404");
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 'reviewed' falls through the statusVariant chain (not 'approved' or
    // 'rejected'), so it must render the same amber "Pending review" badge
    // as a plain 'pending' entry.  If the fallthrough is accidentally broken
    // (e.g. someone adds a guard that swallows 'reviewed' silently), this
    // assertion catches the regression.
    await expect(row.getByTestId("receipt-status-badge")).toContainText("Pending review");
    await expect(row).toContainText("Merge fee — 750 USDT");
    await expect(row).not.toContainText("Batch merge fee:");

    // ── Badge variant — amber class ────────────────────────────────────────
    // The statusVariant.cls for the fallthrough path is the amber set:
    //   "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
    // Locate the badge by its testid and assert the amber token is present,
    // then confirm the approved (emerald) and rejected (red) classes are absent.
    const badge = row.getByTestId("receipt-status-badge");
    await expect(badge).toHaveClass(/bg-amber-500\/10/);
    await expect(badge).not.toHaveClass(/bg-emerald-500\/10/);
    await expect(badge).not.toHaveClass(/bg-red-500\/10/);

    await api.dispose();
  });

  // ── Multiple entries all render ────────────────────────────────────────
  test("card-batch-history renders all merge_fee rows when multiple entries exist", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const caseId = await createHistoryCase(api, adminToken, accessCode);
    await setPin(api, accessCode, TEST_PIN);

    const entries = [
      makeMergeFeeEntry({ id: 11, status: "pending", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-01T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 12, status: "approved", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-02T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 13, status: "rejected", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-03T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 14, status: "reviewed", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-04T10:00:00.000Z" }),
    ];

    await page.route(`**/api/cases/${caseId}/all-receipts`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(entries),
      });
    });

    await loginPortal(page, accessCode, TEST_PIN);
    await goToWithdrawalView(page);

    const card = page.getByTestId("card-batch-history");
    await expect(card).toBeVisible({ timeout: 10_000 });

    const row11 = page.getByTestId("batch-history-row-11");
    const row12 = page.getByTestId("batch-history-row-12");
    const row13 = page.getByTestId("batch-history-row-13");
    const row14 = page.getByTestId("batch-history-row-14");

    await expect(row11).toBeVisible();
    await expect(row12).toBeVisible();
    await expect(row13).toBeVisible();
    await expect(row14).toBeVisible();

    // Each row: verify full extracted label (not raw notes) + status badge.
    await expect(row11).toContainText("Merge fee — 500 USDT");
    await expect(row11).not.toContainText("Batch merge fee:");
    await expect(row11.getByTestId("receipt-status-badge")).toContainText("Pending review");

    // ── Badge variant — amber class (row11 / plain 'pending') ────────────────
    // Guard against a regression where the badge text is correct but the
    // colour variant is wrong.  The 'pending' path must use the amber set:
    //   "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
    const badge11 = row11.getByTestId("receipt-status-badge");
    await expect(badge11).toHaveClass(/bg-amber-500\/10/);
    await expect(badge11).not.toHaveClass(/bg-emerald-500\/10/);
    await expect(badge11).not.toHaveClass(/bg-red-500\/10/);

    await expect(row12).toContainText("Merge fee — 500 USDT");
    await expect(row12).not.toContainText("Batch merge fee:");
    await expect(row12.getByTestId("receipt-status-badge")).toContainText("Approved");

    // ── Badge variant — emerald class (row12 / 'approved') ───────────────────
    // Guard against a regression where the badge text is correct but the
    // colour variant is wrong.  The 'approved' path must use the emerald set:
    //   "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
    const badge12 = row12.getByTestId("receipt-status-badge");
    await expect(badge12).toHaveClass(/bg-emerald-500\/10/);
    await expect(badge12).not.toHaveClass(/bg-amber-500\/10/);
    await expect(badge12).not.toHaveClass(/bg-red-500\/10/);

    await expect(row13).toContainText("Merge fee — 500 USDT");
    await expect(row13).not.toContainText("Batch merge fee:");
    await expect(row13.getByTestId("receipt-status-badge")).toContainText("Rejected");

    // ── Badge variant — red class (row13 / 'rejected') ───────────────────────
    // Guard against a regression where the badge text is correct but the
    // colour variant is wrong.  The 'rejected' path must use the red set:
    //   "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
    const badge13 = row13.getByTestId("receipt-status-badge");
    await expect(badge13).toHaveClass(/bg-red-500\/10/);
    await expect(badge13).not.toHaveClass(/bg-amber-500\/10/);
    await expect(badge13).not.toHaveClass(/bg-emerald-500\/10/);

    // 'reviewed' falls through to the "Pending review" badge (same as 'pending').
    await expect(row14).toContainText("Merge fee — 500 USDT");
    await expect(row14).not.toContainText("Batch merge fee:");
    await expect(row14.getByTestId("receipt-status-badge")).toContainText("Pending review");

    // ── Badge variant — amber class (multi-row context) ───────────────────
    // Guard against a regression where the badge text is correct but the
    // colour variant is wrong.  The fallthrough path must use the amber set:
    //   "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
    const badge14 = row14.getByTestId("receipt-status-badge");
    await expect(badge14).toHaveClass(/bg-amber-500\/10/);
    await expect(badge14).not.toHaveClass(/bg-emerald-500\/10/);
    await expect(badge14).not.toHaveClass(/bg-red-500\/10/);

    await api.dispose();
  });

  // ── Badge colours hold at a narrow (mobile) viewport ──────────────────
  // The badge component uses Tailwind utility classes that have no
  // responsive variants, but this test guards against a future breakpoint
  // regression (e.g. a responsive class that overwrites the colour token at
  // a small viewport).  It mirrors the four badge assertions from the
  // multi-row test above, run at an iPhone-sized viewport (390 × 844).
  test("card-batch-history badge colours are correct at mobile viewport (390×844)", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const caseId = await createHistoryCase(api, adminToken, accessCode);
    await setPin(api, accessCode, TEST_PIN);

    const entries = [
      makeMergeFeeEntry({ id: 21, status: "pending",  notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-01T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 22, status: "approved", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-02T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 23, status: "rejected", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-03T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 24, status: "reviewed", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-04T10:00:00.000Z" }),
    ];

    await page.route(`**/api/cases/${caseId}/all-receipts`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(entries),
      });
    });

    // Set the viewport to a narrow mobile size before loading the page so
    // any responsive CSS branches are active when the component renders.
    await page.setViewportSize({ width: 390, height: 844 });

    await loginPortal(page, accessCode, TEST_PIN);
    await goToWithdrawalView(page);

    const card = page.getByTestId("card-batch-history");
    await expect(card).toBeVisible({ timeout: 10_000 });

    const row21 = page.getByTestId("batch-history-row-21");
    const row22 = page.getByTestId("batch-history-row-22");
    const row23 = page.getByTestId("batch-history-row-23");
    const row24 = page.getByTestId("batch-history-row-24");

    await expect(row21).toBeVisible();
    await expect(row22).toBeVisible();
    await expect(row23).toBeVisible();
    await expect(row24).toBeVisible();

    // ── amber (pending) ────────────────────────────────────────────────────
    const badge21 = row21.getByTestId("receipt-status-badge");
    await expect(badge21).toHaveClass(/bg-amber-500\/10/);
    await expect(badge21).not.toHaveClass(/bg-emerald-500\/10/);
    await expect(badge21).not.toHaveClass(/bg-red-500\/10/);

    // ── emerald (approved) ────────────────────────────────────────────────
    const badge22 = row22.getByTestId("receipt-status-badge");
    await expect(badge22).toHaveClass(/bg-emerald-500\/10/);
    await expect(badge22).not.toHaveClass(/bg-amber-500\/10/);
    await expect(badge22).not.toHaveClass(/bg-red-500\/10/);

    // ── red (rejected) ────────────────────────────────────────────────────
    const badge23 = row23.getByTestId("receipt-status-badge");
    await expect(badge23).toHaveClass(/bg-red-500\/10/);
    await expect(badge23).not.toHaveClass(/bg-amber-500\/10/);
    await expect(badge23).not.toHaveClass(/bg-emerald-500\/10/);

    // ── amber (reviewed fallthrough) ──────────────────────────────────────
    const badge24 = row24.getByTestId("receipt-status-badge");
    await expect(badge24).toHaveClass(/bg-amber-500\/10/);
    await expect(badge24).not.toHaveClass(/bg-emerald-500\/10/);
    await expect(badge24).not.toHaveClass(/bg-red-500\/10/);

    await api.dispose();
  });

  // ── Badge colours hold at a tablet (md) viewport ──────────────────────
  // The md breakpoint (768 px) is where Tailwind responsive variants can
  // diverge.  This test guards against any sm→md transition regressions in
  // badge colour by mirroring the four badge assertions at 768 × 1024.
  test("card-batch-history badge colours are correct at tablet viewport (768×1024)", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const caseId = await createHistoryCase(api, adminToken, accessCode);
    await setPin(api, accessCode, TEST_PIN);

    const entries = [
      makeMergeFeeEntry({ id: 31, status: "pending",  notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-01T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 32, status: "approved", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-02T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 33, status: "rejected", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-03T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 34, status: "reviewed", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-04T10:00:00.000Z" }),
    ];

    await page.route(`**/api/cases/${caseId}/all-receipts`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(entries),
      });
    });

    // Set the viewport to the Tailwind md breakpoint (768 × 1024) before
    // loading the page so any responsive CSS branches are active when the
    // component renders.
    await page.setViewportSize({ width: 768, height: 1024 });

    await loginPortal(page, accessCode, TEST_PIN);
    await goToWithdrawalView(page);

    const card = page.getByTestId("card-batch-history");
    await expect(card).toBeVisible({ timeout: 10_000 });

    const row31 = page.getByTestId("batch-history-row-31");
    const row32 = page.getByTestId("batch-history-row-32");
    const row33 = page.getByTestId("batch-history-row-33");
    const row34 = page.getByTestId("batch-history-row-34");

    await expect(row31).toBeVisible();
    await expect(row32).toBeVisible();
    await expect(row33).toBeVisible();
    await expect(row34).toBeVisible();

    // ── amber (pending) ────────────────────────────────────────────────────
    const badge31 = row31.getByTestId("receipt-status-badge");
    await expect(badge31).toHaveClass(/bg-amber-500\/10/);
    await expect(badge31).not.toHaveClass(/bg-emerald-500\/10/);
    await expect(badge31).not.toHaveClass(/bg-red-500\/10/);

    // ── emerald (approved) ────────────────────────────────────────────────
    const badge32 = row32.getByTestId("receipt-status-badge");
    await expect(badge32).toHaveClass(/bg-emerald-500\/10/);
    await expect(badge32).not.toHaveClass(/bg-amber-500\/10/);
    await expect(badge32).not.toHaveClass(/bg-red-500\/10/);

    // ── red (rejected) ────────────────────────────────────────────────────
    const badge33 = row33.getByTestId("receipt-status-badge");
    await expect(badge33).toHaveClass(/bg-red-500\/10/);
    await expect(badge33).not.toHaveClass(/bg-amber-500\/10/);
    await expect(badge33).not.toHaveClass(/bg-emerald-500\/10/);

    // ── amber (reviewed fallthrough) ──────────────────────────────────────
    const badge34 = row34.getByTestId("receipt-status-badge");
    await expect(badge34).toHaveClass(/bg-amber-500\/10/);
    await expect(badge34).not.toHaveClass(/bg-emerald-500\/10/);
    await expect(badge34).not.toHaveClass(/bg-red-500\/10/);

    await api.dispose();
  });

  // ── Badge colours hold at a landscape-mobile viewport ─────────────────
  // Landscape mobile (e.g. iPhone SE landscape: 667 × 375) can expose
  // horizontal-layout responsive variants not caught by portrait widths.
  // This test completes four-tier coverage: desktop → portrait mobile →
  // tablet → landscape mobile.
  test("card-batch-history badge colours are correct at landscape-mobile viewport (667×375)", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);

    const accessCode = uniqueAccessCode();
    const caseId = await createHistoryCase(api, adminToken, accessCode);
    await setPin(api, accessCode, TEST_PIN);

    const entries = [
      makeMergeFeeEntry({ id: 51, status: "pending",  notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-01T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 52, status: "approved", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-02T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 53, status: "rejected", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-03T10:00:00.000Z" }),
      makeMergeFeeEntry({ id: 54, status: "reviewed", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT`, uploadedAt: "2025-06-04T10:00:00.000Z" }),
    ];

    await page.route(`**/api/cases/${caseId}/all-receipts`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(entries),
      });
    });

    // Set the viewport to landscape-mobile (667 × 375) before loading the
    // page so any responsive CSS branches active at this width are exercised
    // when the component renders.
    await page.setViewportSize({ width: 667, height: 375 });

    await loginPortal(page, accessCode, TEST_PIN);
    await goToWithdrawalView(page);

    const card = page.getByTestId("card-batch-history");
    await expect(card).toBeVisible({ timeout: 10_000 });

    const row51 = page.getByTestId("batch-history-row-51");
    const row52 = page.getByTestId("batch-history-row-52");
    const row53 = page.getByTestId("batch-history-row-53");
    const row54 = page.getByTestId("batch-history-row-54");

    await expect(row51).toBeVisible();
    await expect(row52).toBeVisible();
    await expect(row53).toBeVisible();
    await expect(row54).toBeVisible();

    // ── amber (pending) ────────────────────────────────────────────────────
    const badge51 = row51.getByTestId("receipt-status-badge");
    await expect(badge51).toHaveClass(/bg-amber-500\/10/);
    await expect(badge51).not.toHaveClass(/bg-emerald-500\/10/);
    await expect(badge51).not.toHaveClass(/bg-red-500\/10/);

    // ── emerald (approved) ────────────────────────────────────────────────
    const badge52 = row52.getByTestId("receipt-status-badge");
    await expect(badge52).toHaveClass(/bg-emerald-500\/10/);
    await expect(badge52).not.toHaveClass(/bg-amber-500\/10/);
    await expect(badge52).not.toHaveClass(/bg-red-500\/10/);

    // ── red (rejected) ────────────────────────────────────────────────────
    const badge53 = row53.getByTestId("receipt-status-badge");
    await expect(badge53).toHaveClass(/bg-red-500\/10/);
    await expect(badge53).not.toHaveClass(/bg-amber-500\/10/);
    await expect(badge53).not.toHaveClass(/bg-emerald-500\/10/);

    // ── amber (reviewed fallthrough) ──────────────────────────────────────
    const badge54 = row54.getByTestId("receipt-status-badge");
    await expect(badge54).toHaveClass(/bg-amber-500\/10/);
    await expect(badge54).not.toHaveClass(/bg-emerald-500\/10/);
    await expect(badge54).not.toHaveClass(/bg-red-500\/10/);

    await api.dispose();
  });
});
