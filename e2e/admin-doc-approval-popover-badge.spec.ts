// Task #453 — End-to-end test for the quick-action popover approval path.
//
// Flow under test:
//   1. Seed a test case via the admin API and upload one pending supporting
//      document via the portal session API.
//   2. Log into the admin dashboard.
//   3. Stay on the Cases tab (default) and locate the pulsing badge for the
//      seeded case (`badge-user-doc-pending-{caseId}`).
//   4. Click the badge to open the quick-action popover.
//   5. Approve the document inside the popover (`popover-user-doc-approve-{docId}`).
//   6. Assert the badge disappears from the Cases tab — confirming that
//      `onActioned` → `loadUserDocPendingCounts()` fires after approval.

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
      description: "E2E doc for popover badge-clear test",
    },
  });
  expect(res.status(), "upload supporting doc").toBe(201);
  const body = await res.json();
  expect(typeof body.id).toBe("number");
  return body.id as number;
}

async function loginAdminUi(page: import("@playwright/test").Page) {
  const token = readAdminToken();
  await page.addInitScript(
    (t) => {
      if (t) sessionStorage.setItem("adminToken", t);
    },
    token,
  );
  await page.goto("/admin", { waitUntil: "domcontentloaded" });

  // Register BEFORE checking visible elements so we don't miss the email-delivery-alerts call
  // that fires immediately on dashboard mount.
  const emailAlertsSettled = page
    .waitForResponse(
      (resp) => resp.url().includes("/api/cases/email-delivery-alerts"),
      { timeout: 10_000 },
    )
    .catch(() => null);

  // The case-finder trigger is only rendered after the stored token is
  // accepted — a stable "dashboard is up" signal.
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 30_000,
  });

  // Await the API response before checking banner visibility — otherwise the
  // banner can appear after the check and cover the tab nav bar.
  await emailAlertsSettled;
  const banner = page.getByTestId("banner-email-delivery-failed");
  if (await banner.isVisible()) {
    await page.getByTestId("button-dismiss-email-delivery-banner").click({ force: true });
    await expect(banner).toHaveCount(0, { timeout: 5_000 });
  }
}

test.describe("Admin — approving via popover removes per-case badge on Cases tab", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test("approving a document via the quick-action popover clears the Cases-tab badge", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ------------------------------------------------------------------ seed
    const accessCode = uniqueAccessCode("E2EPO");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "112233");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "popover-badge-test.png",
    );

    // ---------------------------------------------------- sign in to admin UI
    await loginAdminUi(page);

    // ------------------------------------------ stay on the Cases tab (default)
    // The dashboard opens on the Cases tab by default; click it explicitly in
    // case the default tab changes in the future.
    await page.getByTestId("tab-cases").click({ force: true });

    // Locate the pulsing badge for the seeded case. It may be on a later page
    // if other data is present, so scroll/wait for it.
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // ------------------------------------------ open the quick-action popover
    await badge.click();

    // The popover lists the pending document row.
    const docRow = page.getByTestId(`popover-user-doc-row-${docId}`);
    await expect(docRow).toBeVisible({ timeout: 10_000 });

    // -------------------------------------------------- approve via popover
    await page.getByTestId(`popover-user-doc-approve-${docId}`).click();

    // The row disappears from the popover once the PATCH succeeds.
    await expect(docRow).toHaveCount(0, { timeout: 10_000 });

    // -------------------------------------------- badge must now be gone
    // `onActioned` fires in the `finally` block of `act()`, which calls
    // `loadUserDocPendingCounts()` in CasesTab. Allow up to 10 s for the
    // network round-trip + re-render.
    await expect(badge).toHaveCount(0, { timeout: 10_000 });

    await api.dispose();
  });

  // Task #474 — bulk-approve path: "Approve all" button (popover-bulk-approve-{caseId})
  // must also fire onActioned → loadUserDocPendingCounts() and clear the badge.
  // The "Approve all" button only renders when docs.length > 1, so we seed two docs.
  test("bulk-approving via the 'Approve all' button clears the Cases-tab badge", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ------------------------------------------------------------------ seed
    const accessCode = uniqueAccessCode("E2EBULK");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "998877");

    // Upload two documents so the "Approve all" bulk button is rendered.
    const docId1 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "bulk-approve-doc-1.png",
    );
    const docId2 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "bulk-approve-doc-2.png",
    );

    // ---------------------------------------------------- sign in to admin UI
    await loginAdminUi(page);

    // ------------------------------------------ stay on the Cases tab (default)
    await page.getByTestId("tab-cases").click({ force: true });

    // Locate the pulsing badge for the seeded case.
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // ------------------------------------------ open the quick-action popover
    await badge.click();

    // Both document rows must be visible before we bulk-approve.
    const docRow1 = page.getByTestId(`popover-user-doc-row-${docId1}`);
    const docRow2 = page.getByTestId(`popover-user-doc-row-${docId2}`);
    await expect(docRow1).toBeVisible({ timeout: 10_000 });
    await expect(docRow2).toBeVisible({ timeout: 10_000 });

    // -------------------------------------------------- bulk approve via popover
    const bulkApproveBtn = page.getByTestId(`popover-bulk-approve-${caseId}`);
    await expect(bulkApproveBtn).toBeVisible({ timeout: 5_000 });
    await bulkApproveBtn.click();

    // Both rows disappear from the popover once all PATCHes succeed.
    await expect(docRow1).toHaveCount(0, { timeout: 15_000 });
    await expect(docRow2).toHaveCount(0, { timeout: 15_000 });

    // -------------------------------------------- badge must now be gone
    // `onActioned` fires in the `finally` block of `bulkApprove()`, which
    // calls `loadUserDocPendingCounts()` in CasesTab. Allow up to 10 s for
    // the network round-trips + re-render.
    await expect(badge).toHaveCount(0, { timeout: 10_000 });

    await api.dispose();
  });

  // Task #614 — per-doc reject path: the individual "Reject" button
  // (popover-user-doc-reject-{docId}) must also fire onActioned →
  // loadUserDocPendingCounts() and clear the badge. Unlike the bulk-reject
  // path there is no confirm step — the button calls act() directly.
  // Task #703 — also verifies that the rejection note typed into the
  // per-doc textarea reaches the server and is persisted in adminNotes.
  test("rejecting a single document via the per-doc Reject button clears the Cases-tab badge", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ------------------------------------------------------------------ seed
    const accessCode = uniqueAccessCode("E2EREJDOC");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "334455");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "per-doc-reject-test.png",
    );

    // ---------------------------------------------------- sign in to admin UI
    await loginAdminUi(page);

    // ------------------------------------------ stay on the Cases tab (default)
    await page.getByTestId("tab-cases").click({ force: true });

    // Locate the pulsing badge for the seeded case.
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // ------------------------------------------ open the quick-action popover
    await badge.click();

    // The popover lists the pending document row.
    const docRow = page.getByTestId(`popover-user-doc-row-${docId}`);
    await expect(docRow).toBeVisible({ timeout: 10_000 });

    // Enter a rejection note before clicking Reject.  We intentionally use a
    // distinctive string so a wiring regression (wrong textarea testid, notes
    // dropped from payload, etc.) is detectable.
    const REJECTION_NOTE = "Blurry image — please re-upload";
    await page
      .getByTestId(`popover-user-doc-notes-${docId}`)
      .fill(REJECTION_NOTE);

    // -------------------------------------------------- reject via per-doc button
    // Register the response-interceptor BEFORE clicking so we don't miss a
    // fast response.  The PATCH endpoint returns the full updated document,
    // giving us a direct assertion on the persisted adminNotes value without
    // needing a separate API round-trip.
    const patchResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/admin/user-documents/${docId}`) &&
        resp.request().method() === "PATCH",
      { timeout: 15_000 },
    );

    await page.getByTestId(`popover-user-doc-reject-${docId}`).click();

    // Assert that the server persisted the rejection note.
    const patchResp = await patchResponsePromise;
    expect(patchResp.status(), "PATCH status").toBe(200);
    const patchBody = (await patchResp.json()) as {
      adminNotes?: string;
      status?: string;
    };
    expect(patchBody.status, "persisted status").toBe("rejected");
    expect(patchBody.adminNotes, "persisted adminNotes").toBe(REJECTION_NOTE);

    // The row disappears from the popover once the PATCH succeeds.
    await expect(docRow).toHaveCount(0, { timeout: 10_000 });

    // -------------------------------------------- badge must now be gone
    // `onActioned` fires in the `finally` block of `act()`, which calls
    // `loadUserDocPendingCounts()` in CasesTab. Allow up to 10 s for the
    // network round-trip + re-render.
    await expect(badge).toHaveCount(0, { timeout: 10_000 });

    await api.dispose();
  });

  // Task #530 — bulk-reject path: "Reject all" button (popover-bulk-reject-{caseId})
  // must also fire onActioned → loadUserDocPendingCounts() and clear the badge.
  // The "Reject all" button only renders when docs.length > 1, so we seed two docs.
  test("bulk-rejecting via the 'Reject all' button clears the Cases-tab badge", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ------------------------------------------------------------------ seed
    const accessCode = uniqueAccessCode("E2EREJECT");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "556677");

    // Upload two documents so the "Reject all" bulk button is rendered.
    const docId1 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "bulk-reject-doc-1.png",
    );
    const docId2 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "bulk-reject-doc-2.png",
    );

    // ---------------------------------------------------- sign in to admin UI
    await loginAdminUi(page);

    // ------------------------------------------ stay on the Cases tab (default)
    await page.getByTestId("tab-cases").click({ force: true });

    // Locate the pulsing badge for the seeded case.
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // ------------------------------------------ open the quick-action popover
    await badge.click();

    // Both document rows must be visible before we bulk-reject.
    const docRow1 = page.getByTestId(`popover-user-doc-row-${docId1}`);
    const docRow2 = page.getByTestId(`popover-user-doc-row-${docId2}`);
    await expect(docRow1).toBeVisible({ timeout: 10_000 });
    await expect(docRow2).toBeVisible({ timeout: 10_000 });

    // -------------------------------------------------- bulk reject via popover
    const bulkRejectBtn = page.getByTestId(`popover-bulk-reject-${caseId}`);
    await expect(bulkRejectBtn).toBeVisible({ timeout: 5_000 });
    await bulkRejectBtn.click();

    // The confirm section expands; fill in a shared rejection note so we can
    // assert it reaches the server on every PATCH (regression guard for the
    // payload wiring in bulkReject()).
    const BULK_REJECTION_NOTE = "Bulk-rejected — documents are unreadable";
    const notesTextarea = page.getByTestId(
      `popover-bulk-reject-notes-${caseId}`,
    );
    await expect(notesTextarea).toBeVisible({ timeout: 5_000 });
    await notesTextarea.fill(BULK_REJECTION_NOTE);

    // Register response interceptors for BOTH PATCH calls BEFORE clicking
    // Confirm, so we never race a fast server response.
    const patchDoc1Promise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/admin/user-documents/${docId1}`) &&
        resp.request().method() === "PATCH",
      { timeout: 15_000 },
    );
    const patchDoc2Promise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/admin/user-documents/${docId2}`) &&
        resp.request().method() === "PATCH",
      { timeout: 15_000 },
    );

    const confirmBtn = page.getByTestId(
      `popover-bulk-reject-confirm-btn-${caseId}`,
    );
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // Assert that BOTH PATCH responses carry the correct persisted adminNotes.
    const [patchDoc1Resp, patchDoc2Resp] = await Promise.all([
      patchDoc1Promise,
      patchDoc2Promise,
    ]);

    expect(patchDoc1Resp.status(), "doc1 PATCH status").toBe(200);
    const doc1Body = (await patchDoc1Resp.json()) as {
      adminNotes?: string;
      status?: string;
    };
    expect(doc1Body.status, "doc1 persisted status").toBe("rejected");
    expect(doc1Body.adminNotes, "doc1 persisted adminNotes").toBe(
      BULK_REJECTION_NOTE,
    );

    expect(patchDoc2Resp.status(), "doc2 PATCH status").toBe(200);
    const doc2Body = (await patchDoc2Resp.json()) as {
      adminNotes?: string;
      status?: string;
    };
    expect(doc2Body.status, "doc2 persisted status").toBe("rejected");
    expect(doc2Body.adminNotes, "doc2 persisted adminNotes").toBe(
      BULK_REJECTION_NOTE,
    );

    // Both rows disappear from the popover once all PATCHes succeed.
    await expect(docRow1).toHaveCount(0, { timeout: 15_000 });
    await expect(docRow2).toHaveCount(0, { timeout: 15_000 });

    // -------------------------------------------- badge must now be gone
    // `onActioned` fires in the `finally` block of `bulkReject()`, which
    // calls `loadUserDocPendingCounts()` in CasesTab. Allow up to 10 s for
    // the network round-trips + re-render.
    await expect(badge).toHaveCount(0, { timeout: 10_000 });

    await api.dispose();
  });
});
