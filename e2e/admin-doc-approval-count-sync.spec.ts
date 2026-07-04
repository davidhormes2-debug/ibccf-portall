// Task #441 / #452 / #471 / #531 / #619 / #684 — End-to-end tests for the admin document
// approval/rejection badge-refresh contract.
//
// Flow under test (approval, Task #441):
//   1. Seed a test case via the admin API and upload one pending supporting
//      document via the portal session API.
//   2. Log into the admin dashboard.
//   3. Navigate to the Supporting Documents tab and confirm the document row
//      shows "uploaded" status.
//   4. Approve the document.
//   5. Switch to the Cases tab and assert that the pending-uploads badge for
//      the test case has disappeared — confirming that the badge refresh
//      contract (loadUserDocPendingCounts) fires after approval.
//
// Flow under test (rejection, Task #452):
//   Same setup, but the document is rejected (with admin notes) instead of
//   approved. The badge must also disappear after rejection.
//
// Flow under test (popover rejection, Task #471):
//   Same setup, but the document is rejected via the quick-action popover on
//   the Cases tab (not the Supporting Documents tab). The badge for that case
//   must also disappear — confirming that onActioned → loadUserDocPendingCounts
//   fires from SupportingDocsQuickPopover's single-doc reject path.
//
// Flow under test (popover bulk-reject, Task #531):
//   Two documents are seeded on the same case. The admin opens the quick-action
//   popover, clicks "Reject all", fills the shared notes field, and clicks
//   "Confirm rejection". The badge must disappear after the bulk PATCH resolves
//   — confirming that onActioned → loadUserDocPendingCounts fires from
//   SupportingDocsQuickPopover's bulk-reject path.
//
// Flow under test (popover bulk-approve, Task #619):
//   Two documents are seeded on the same case. The admin opens the quick-action
//   popover and clicks "Approve all" (no confirmation step). The badge must
//   disappear after the bulk PATCHes resolve — confirming that
//   onActioned → loadUserDocPendingCounts fires from the bulk-approve path.
//
// Flow under test (popover per-row approve, Task #684):
//   One document is seeded on a case. The admin opens the quick-action popover
//   and clicks the per-row Approve button. The badge must disappear after the
//   PATCH resolves — confirming that onActioned → loadUserDocPendingCounts fires
//   from SupportingDocsQuickPopover's single-doc approve path.

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  TINY_PNG_DATA_URL,
  createCase,
  issuePortalSession,
  loginAdminUi,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

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
      description: "E2E doc for approval/badge-sync test",
    },
  });
  expect(res.status(), "upload supporting doc").toBe(201);
  const body = await res.json();
  expect(typeof body.id).toBe("number");
  return body.id as number;
}

test.describe("Admin — document approval removes per-case badge on Cases tab", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test("approving a document via Supporting Docs tab clears the Cases-tab badge", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ------------------------------------------------------------------ seed
    const accessCode = uniqueAccessCode("E2EBA");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "112233");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "badge-sync-test.png",
    );

    // ---------------------------------------------------- sign in to admin UI
    await loginAdminUi(page);

    // ------------------------------------------ navigate to Supporting Docs
    await page.getByTestId("tab-supporting-docs").click({ force: true });

    // Filter to this case so the row is on-screen regardless of other data.
    await page
      .getByTestId("filter-supporting-docs-case-id")
      .fill(caseId);

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("uploaded");

    // --------------------------------------------------------- approve it
    await page
      .getByTestId(`button-approve-supporting-doc-${docId}`)
      .click();

    // Optimistic UI: status flips to "approved" before the network round-trip.
    await expect(row).toContainText("approved", { timeout: 5_000 });

    // -------------------------------------------- switch to the Cases tab
    await page.getByTestId("tab-cases").click({ force: true });

    // The polling hook (3 s interval) and the post-approval callback both
    // trigger loadUserDocPendingCounts. Allow up to 10 s for the badge to
    // disappear from the Cases tab.
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toHaveCount(0, { timeout: 10_000 });

    await api.dispose();
  });

  test("rejecting a document via Supporting Docs tab clears the Cases-tab badge", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ------------------------------------------------------------------ seed
    const accessCode = uniqueAccessCode("E2EBR");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "998877");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "badge-sync-reject-test.png",
    );

    // ---------------------------------------------------- sign in to admin UI
    await loginAdminUi(page);

    // ------------------------------------------ navigate to Supporting Docs
    await page.getByTestId("tab-supporting-docs").click({ force: true });

    // Filter to this case so the row is on-screen regardless of other data.
    await page
      .getByTestId("filter-supporting-docs-case-id")
      .fill(caseId);

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("uploaded");

    // --------------------------------------------------------- reject it
    // First click reveals the notes textarea; fill it; second click confirms.
    await page
      .getByTestId(`button-reject-supporting-doc-${docId}`)
      .click();

    const notesField = page.getByTestId(
      `textarea-reject-supporting-doc-${docId}`,
    );
    await expect(notesField).toBeVisible();
    await notesField.fill("Document is unreadable — please re-upload.");

    await page
      .getByTestId(`button-confirm-reject-supporting-doc-${docId}`)
      .click();

    // Status flips to "rejected" (optimistic, then persisted).
    await expect(row).toContainText("rejected", { timeout: 10_000 });

    // -------------------------------------------- switch to the Cases tab
    await page.getByTestId("tab-cases").click({ force: true });

    // The polling hook and the post-rejection callback both trigger
    // loadUserDocPendingCounts. Allow up to 10 s for the badge to disappear.
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toHaveCount(0, { timeout: 10_000 });

    await api.dispose();
  });

  test("rejecting a document via the Cases-tab quick-action popover clears the badge (Task #471)", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ------------------------------------------------------------------ seed
    const accessCode = uniqueAccessCode("E2EQP");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "556677");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "popover-reject-badge-sync-test.png",
    );

    // ---------------------------------------------------- sign in to admin UI
    await loginAdminUi(page);

    // ---------------------------------- navigate to the Cases tab (default)
    await page.getByTestId("tab-cases").click({ force: true });

    // The badge is the popover trigger — wait for it to appear.
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // -------------------- open the quick-action popover by clicking the badge
    await badge.click();

    // Wait for the individual document row to load inside the popover.
    const docRow = page.getByTestId(`popover-user-doc-row-${docId}`);
    await expect(docRow).toBeVisible({ timeout: 10_000 });

    // -------------------- reject the document via the per-row Reject button
    await page.getByTestId(`popover-user-doc-reject-${docId}`).click();

    // After the PATCH resolves, onActioned fires → loadUserDocPendingCounts.
    // The badge element should disappear once the count drops to zero.
    await expect(badge).toHaveCount(0, { timeout: 10_000 });

    await api.dispose();
  });

  test("bulk-rejecting all documents via the popover 'Reject all' flow clears the Cases-tab badge (Task #531)", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ----------------------------------------------------------- seed
    // Two pending documents are required so the "Reject all" bulk button
    // appears (the component only renders it when docs.length > 1).
    const accessCode = uniqueAccessCode("E2EBK");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "334455");

    const [docId1, docId2] = await Promise.all([
      uploadSupportingDoc(api, caseId, sessionToken, "bulk-reject-doc-1.png"),
      uploadSupportingDoc(api, caseId, sessionToken, "bulk-reject-doc-2.png"),
    ]);

    // ------------------------------------------- sign in to admin UI
    await loginAdminUi(page);

    // ----------------------------- navigate to the Cases tab (default)
    await page.getByTestId("tab-cases").click({ force: true });

    // The badge is the popover trigger — wait for it to appear.
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // -------------- open the quick-action popover by clicking the badge
    await badge.click();

    // Wait for both document rows to load inside the popover so the
    // "Reject all" button becomes visible.
    await expect(
      page.getByTestId(`popover-user-doc-row-${docId1}`),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId(`popover-user-doc-row-${docId2}`),
    ).toBeVisible({ timeout: 10_000 });

    // --------- click "Reject all" to enter the confirmation step
    await page.getByTestId(`popover-bulk-reject-${caseId}`).click();

    // The confirmation panel should now be visible.
    const notesField = page.getByTestId(`popover-bulk-reject-notes-${caseId}`);
    await expect(notesField).toBeVisible({ timeout: 5_000 });

    // --------- fill the shared notes field
    await notesField.fill("Documents unclear — bulk-reject via e2e test.");

    // --------- click "Confirm rejection"
    await page
      .getByTestId(`popover-bulk-reject-confirm-btn-${caseId}`)
      .click();

    // After both PATCHes resolve, onActioned fires → loadUserDocPendingCounts.
    // The badge element should disappear once the count drops to zero.
    await expect(badge).toHaveCount(0, { timeout: 15_000 });

    await api.dispose();
  });

  test("bulk-approving all documents via the popover 'Approve all' button clears the Cases-tab badge (Task #619)", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ----------------------------------------------------------- seed
    // Two pending documents are required so the "Approve all" bulk button
    // appears (the component renders it only when docs.length > 1).
    const accessCode = uniqueAccessCode("E2EBA2");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "778899");

    await Promise.all([
      uploadSupportingDoc(api, caseId, sessionToken, "bulk-approve-doc-1.png"),
      uploadSupportingDoc(api, caseId, sessionToken, "bulk-approve-doc-2.png"),
    ]);

    // ------------------------------------------- sign in to admin UI
    await loginAdminUi(page);

    // ----------------------------- navigate to the Cases tab (default)
    await page.getByTestId("tab-cases").click({ force: true });

    // The badge is the popover trigger — wait for it to appear.
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // -------------- open the quick-action popover by clicking the badge
    await badge.click();

    // Wait for both document rows to load inside the popover so the
    // "Approve all" button becomes visible.
    const bulkApproveBtn = page.getByTestId(`popover-bulk-approve-${caseId}`);
    await expect(bulkApproveBtn).toBeVisible({ timeout: 10_000 });

    // --------- click "Approve all" — no confirmation step required
    await bulkApproveBtn.click();

    // After all PATCHes resolve, onActioned fires → loadUserDocPendingCounts.
    // The badge element should disappear once the count drops to zero.
    await expect(badge).toHaveCount(0, { timeout: 15_000 });

    await api.dispose();
  });

  test("approving a single document via the Cases-tab quick-action popover clears the badge (Task #684)", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ------------------------------------------------------------------ seed
    const accessCode = uniqueAccessCode("E2EPA");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "223344");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "popover-approve-badge-sync-test.png",
    );

    // ---------------------------------------------------- sign in to admin UI
    await loginAdminUi(page);

    // ---------------------------------- navigate to the Cases tab (default)
    await page.getByTestId("tab-cases").click({ force: true });

    // The badge is the popover trigger — wait for it to appear.
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // -------------------- open the quick-action popover by clicking the badge
    await badge.click();

    // Wait for the individual document row to load inside the popover.
    const docRow = page.getByTestId(`popover-user-doc-row-${docId}`);
    await expect(docRow).toBeVisible({ timeout: 10_000 });

    // -------------------- approve the document via the per-row Approve button
    await page.getByTestId(`popover-user-doc-approve-${docId}`).click();

    // After the PATCH resolves, onActioned fires → loadUserDocPendingCounts.
    // The badge element should disappear once the count drops to zero.
    await expect(badge).toHaveCount(0, { timeout: 10_000 });

    await api.dispose();
  });
});
