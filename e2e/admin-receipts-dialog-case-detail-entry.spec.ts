// Regression guard: the admin receipts dialog skeleton-to-content transition
// must work correctly when "Open receipts panel" is triggered from *inside*
// the case-detail dialog (the second entry point for openReceiptsDialog).
//
// What this spec covers:
//
//   1. Opening the case-detail dialog via the Cases-tab "Manage" dropdown
//      (menu-manage-<id>) and navigating to the Documents tab.
//
//   2. Clicking the "Open receipts panel" button (data-testid=
//      "case-documents-open-receipts") that lives in the Documents tab.
//
//   3. While the deposit-receipts fetch is in flight, the loading skeleton
//      (aria-label="Loading receipts…") must be visible and the resolved
//      content must be absent.
//
//   4. Once the fetch settles, the skeleton must disappear and the receipt
//      list or empty state ("No receipts uploaded yet") must appear — i.e.
//      the skeleton and real content are never simultaneously visible at
//      steady state.
//
// This is a companion to admin-receipts-dialog-loading-skeleton.spec.ts
// which covers the same assertions via the row-level dropdown entry point
// (menu-receipts-<id>).  A regression that breaks either code path would
// only be caught by the corresponding spec.
//
// Relevant source:
//   - client/src/components/admin/DepositReceiptsDialog.tsx — ReceiptsLoadingSkeleton
//   - client/src/pages/AdminDashboard.tsx — openReceiptsDialog handler,
//     case-documents-open-receipts button (~line 9460)
//   - client/src/components/admin/CaseDetailTabsList.tsx — case-tab-documents

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { localTimeout } from "./helpers";
import { randomBytes } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

function readAdminToken(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")) as {
      token?: string;
    };
    return raw.token ?? "";
  } catch {
    return "";
  }
}

function uniqueAccessCode(): string {
  return `RCPTDET-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function uniqueEmail(): string {
  return `e2e-rcptdet-${randomBytes(3).toString("hex")}@example.com`;
}

async function createCase(
  api: APIRequestContext,
  adminToken: string,
  accessCode: string,
): Promise<string> {
  const created = await api.post("/api/cases", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { accessCode, status: "active" },
  });
  expect(created.status(), "create case").toBe(200);
  const body = await created.json();
  const caseId = body.id as string;

  const patched = await api.patch(`/api/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      userName: "Receipts Detail Dialog E2E",
      userEmail: uniqueEmail(),
      status: "active",
    },
  });
  expect(patched.status(), "patch case").toBe(200);
  return caseId;
}

async function loginAdminUi(page: import("@playwright/test").Page) {
  const token = readAdminToken();
  await page.addInitScript(
    (t) => { if (t) sessionStorage.setItem("adminToken", t); },
    token,
  );
  await page.goto("/admin");
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 30_000,
  });
}

// Opens the case-detail dialog via the Cases-tab manage dropdown, navigates
// to the Documents tab, and clicks the "Open receipts panel" button.
// Returns once the button has been clicked.
async function openReceiptsViaDetailDialog(
  page: import("@playwright/test").Page,
  caseId: string,
  accessCode: string,
): Promise<void> {
  // Locate and fill the Cases-tab search box.
  const search = page.getByTestId("input-search-cases");
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(accessCode);

  // Click "Manage" to open the dropdown.
  const manageButton = page.getByTestId(`button-manage-case-${caseId}`);
  await expect(manageButton).toBeVisible({ timeout: 15_000 });
  await manageButton.click();

  // "Send Notification" (menu-manage-<id>) opens the tabbed case-detail dialog.
  const notifyItem = page.getByTestId(`menu-manage-${caseId}`);
  await expect(notifyItem).toBeVisible({ timeout: 5_000 });
  await notifyItem.click();

  // The case-detail dialog must be open; navigate to the Documents tab.
  const docsTab = page.getByTestId("case-tab-documents");
  await expect(docsTab).toBeVisible({ timeout: 10_000 });
  await docsTab.click();

  // Click the "Open receipts panel" button that is the second entry point.
  const openReceiptsButton = page.getByTestId("case-documents-open-receipts");
  await expect(openReceiptsButton).toBeVisible({ timeout: 5_000 });
  await openReceiptsButton.click();
}

test.describe("Admin receipts dialog — skeleton loading via case-detail dialog entry point", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test.beforeEach(() => {
    test.setTimeout(localTimeout(120_000));
  });

  test("skeleton is visible while the deposit-receipts fetch is in flight and disappears once it resolves (case-detail entry point)", async ({
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

    // --------------------------------- open the receipts dialog via the
    // case-detail dialog Documents tab (second entry point)
    await openReceiptsViaDetailDialog(page, caseId, accessCode);

    // ── Assert the skeleton is visible WHILE the fetch is still in flight ──
    //
    // ReceiptsLoadingSkeleton renders an element with aria-label="Loading receipts…".
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

  test("closing the receipts dialog and re-opening via the same case-detail button re-shows the skeleton", async ({
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

    // First open — no delay, confirm the dialog works end-to-end.
    await openReceiptsViaDetailDialog(page, caseId, accessCode);
    await expect(page.getByText("No receipts uploaded yet")).toBeVisible({
      timeout: 10_000,
    });

    // Close the receipts dialog with Escape.
    await page.keyboard.press("Escape");
    await expect(page.getByText("No receipts uploaded yet")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Add a delay for the second open so we can catch the skeleton mid-flight.
    await page.route(`**/api/cases/${caseId}/deposit-receipts*`, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });

    // Re-open via the same case-documents-open-receipts button — the
    // case-detail dialog should still be open after pressing Escape on the
    // receipts overlay.
    const openReceiptsButton = page.getByTestId("case-documents-open-receipts");
    await expect(openReceiptsButton).toBeVisible({ timeout: 10_000 });
    await openReceiptsButton.click();

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
