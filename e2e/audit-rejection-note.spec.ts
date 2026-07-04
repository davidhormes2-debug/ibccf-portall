/**
 * Task #617 — Rejection note appears in the case audit tab
 *
 * What this test verifies
 * -----------------------
 * After an admin rejects a supporting document with notes, the rejection note
 * text must be visible in [data-testid="case-audit-list"] on the case Audit tab.
 *
 * Flow
 * ----
 *   1. (API)  Create a fresh case, portal session, and uploaded supporting doc.
 *   2. (UI)   Reject the doc via the Supporting Docs tab with a unique note.
 *   3. (UI)   Open the case-detail dialog via the ExternalLink button in the row.
 *   4. (UI)   Switch to the Audit tab, click Refresh to load entries.
 *   5. (UI)   Assert the rejection note text appears in case-audit-list.
 *
 * Auth strategy
 * -------------
 * One rate-limited /api/admin/login call is made in beforeAll; the token is
 * injected into sessionStorage for each UI test so the login form is bypassed.
 */

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  TINY_PNG_DATA_URL,
  createCase,
  issuePortalSession,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";

let sharedAdminToken = "";

async function uploadSupportingDoc(
  api: APIRequestContext,
  caseId: string,
  sessionToken: string,
  fileName: string,
): Promise<number> {
  const res = await api.post(`/api/cases/${caseId}/user-documents`, {
    headers: { "x-portal-session-token": sessionToken },
    data: {
      fileData: TINY_PNG_DATA_URL,
      fileName,
      category: "general",
      description: "E2E audit-rejection-note test document",
    },
  });
  expect(res.status(), "upload supporting doc").toBe(201);
  return (await res.json()).id as number;
}

/**
 * Inject the admin token into sessionStorage then reload /admin.
 * React reads the token on mount, calls /api/admin/verify (not rate-limited),
 * and renders the dashboard — bypassing the rate-limited login form.
 */
async function mountAdminSession(
  page: import("@playwright/test").Page,
  token: string,
) {
  await page.goto("/admin");
  await page.evaluate((t) => sessionStorage.setItem("adminToken", t), token);
  await page.reload();
  await expect(page.getByTestId("input-admin-password")).toHaveCount(0, {
    timeout: 15_000,
  });
}

test.describe("Admin — rejection note appears in case audit tab", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin audit-rejection-note e2e tests");
    }
  });

  test.beforeAll(async () => {
    sharedAdminToken = readAdminToken();
  });

  test("rejection note text appears in case-audit-list after rejecting a supporting doc", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode("E2EARN");
    const caseId = await createCase(api, sharedAdminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "246810");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "audit-note-target.png",
    );

    const rejectionNote = `Blurry scan — please re-upload ${randomBytes(3).toString("hex")}`;

    await mountAdminSession(page, sharedAdminToken);

    // ── Step 1: Navigate to Supporting Docs tab and reject with notes ─────
    await page.getByTestId("tab-supporting-docs").click({ force: true });

    const filterInput = page.getByTestId("filter-supporting-docs-case-id");
    await expect(filterInput).toBeVisible({ timeout: 10_000 });
    await filterInput.fill(caseId);
    await filterInput.press("Tab");

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    await page
      .getByTestId(`button-reject-supporting-doc-${docId}`)
      .click();

    const notesField = page.getByTestId(
      `textarea-reject-supporting-doc-${docId}`,
    );
    await expect(notesField).toBeVisible();
    await notesField.fill(rejectionNote);

    await page
      .getByTestId(`button-confirm-reject-supporting-doc-${docId}`)
      .click();

    await expect(row).toContainText("rejected", { timeout: 10_000 });

    // ── Step 2: Open the case-detail dialog via the ExternalLink button ───
    // btn-open-supporting-doc-case-{docId} is always rendered in the row and
    // calls onOpenCase(caseId) → openAdminMessageDialog, so no tab switch needed.
    await page.getByTestId(`btn-open-supporting-doc-case-${docId}`).click();

    // ── Step 3: Navigate to the Audit tab inside the case-detail dialog ───
    await expect(page.getByTestId("case-tab-audit")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("case-tab-audit").click({ force: true });

    // Audit entries are loaded on demand — trigger the fetch explicitly.
    await expect(page.getByTestId("case-audit-refresh")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByTestId("case-audit-refresh").click();

    // ── Step 4: Assert the rejection note text is in the audit list ───────
    const auditList = page.getByTestId("case-audit-list");
    await expect(auditList).toBeVisible({ timeout: 15_000 });
    await expect(auditList).toContainText(rejectionNote, { timeout: 10_000 });

    await api.dispose();
  });
});
