/**
 * Task #418 / #620 — Admin audit trail: supporting document approve / reject
 *
 * What these tests verify
 * -----------------------
 * The bulk-approve-progress-reset test (Task #620) verifies that the
 * "Approving N of N…" counter in the toolbar disappears once the batch
 * finishes.  Shared API helpers and beforeAll token re-used from Task #418.
 *
 * The audit-trail tests share the same five-step structure:
 *
 *   1. (API setup) Create a fresh case + portal session + uploaded doc via API.
 *   2. (UI)  Admin approves / rejects the doc via the Supporting Docs tab.
 *   3. (UI)  Row status flips to "approved" / "rejected" (optimistic update).
 *   4. (UI)  Click the ExternalLink button in the same Supporting Docs row to
 *            open the per-case detail dialog.  Switch to the Audit tab and
 *            confirm a `user_document_approved` / `user_document_rejected`
 *            entry is visible with the acting admin's username.
 *   5. (API) Hit GET /api/audit-logs and assert:
 *            - targetId === caseId
 *            - adminUsername === ADMIN_USERNAME
 *            - (reject only) newValue contains the admin notes
 *
 * Rate-limit strategy
 * -------------------
 * /api/admin/login is rate-limited to 5 calls per 15 minutes.  A single API
 * login is performed in test.beforeAll and the token is shared for the whole
 * file.  Browser-side auth is bootstrapped by injecting the token into
 * sessionStorage before a reload; React calls /api/admin/verify (not
 * rate-limited) and skips the login form.  The whole file costs exactly ONE
 * rate-limited login call.
 *
 * Click strategy
 * --------------
 * All interactions use standard Playwright `.click()` and `.fill()` — the
 * same pattern used by the passing admin-doc-approval-count-sync tests.
 * Playwright's `.click()` sends the full pointer-event sequence (pointerdown →
 * mousedown → pointerup → mouseup → click) so both plain React buttons and
 * Radix UI components (TabsTrigger, DropdownMenu) respond correctly.
 *
 * We navigate to the Audit tab via the "open case" ExternalLink button
 * (`btn-open-supporting-doc-case-{docId}`) that lives in every Supporting Docs
 * row.  This button calls `onOpenCase(caseId)` which fetches the case and
 * opens the case-detail dialog — no Cases-tab search or dropdown needed.
 *
 * Accessibility note
 * ------------------
 * `btn-open-supporting-doc-case-{docId}` is always rendered (not gated on doc
 * status), so it is present and clickable even after the doc has been approved
 * or rejected.
 */

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

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";

// Shared across both tests — set once in beforeAll.
let sharedAdminToken = "";

// ─── API helpers ─────────────────────────────────────────────────────────────

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
      description: "E2E audit trail test upload",
    },
  });
  expect(res.status(), "upload supporting doc").toBe(201);
  return (await res.json()).id as number;
}

async function fetchAuditLogs(api: APIRequestContext, token: string) {
  const res = await api.get("/api/audit-logs", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status(), "fetch audit logs").toBe(200);
  return res.json() as Promise<
    Array<{
      id: number;
      action: string;
      adminUsername?: string | null;
      targetType?: string | null;
      targetId?: string | null;
      newValue?: string | null;
    }>
  >;
}

// ─── Browser helpers ──────────────────────────────────────────────────────────

/**
 * Inject the admin token into sessionStorage then reload /admin.
 * React reads the token on mount, calls /api/admin/verify (not rate-limited),
 * and renders the dashboard — bypassing the rate-limited login form.
 *
 * We wait for the login form password field to disappear (count = 0) which
 * signals that isLoggedIn = true and the dashboard is fully rendered with
 * authToken set in React state.
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

/**
 * Navigate to the Supporting Docs tab and apply a per-case filter.
 *
 * Uses standard Playwright `.click()` and `.fill()` — identical to the
 * approach used by the passing admin-doc-approval-count-sync tests.
 */
async function navigateToSupportingDocsAndFilter(
  page: import("@playwright/test").Page,
  caseId: string,
) {
  await page.getByTestId("tab-supporting-docs").click({ force: true });
  const filterInput = page.getByTestId("filter-supporting-docs-case-id");
  await expect(filterInput).toBeVisible({ timeout: 10_000 });
  await filterInput.fill(caseId);
  // Tab-out fires the 300 ms debounce immediately.
  await filterInput.press("Tab");
}

/**
 * Open the case-detail dialog and navigate to its Audit tab.
 *
 * Flow (all steps stay within the Supporting Docs tab — no tab switching):
 *   1. Click the ExternalLink "open case" button for the doc row.
 *      `btn-open-supporting-doc-case-{docId}` is always rendered (not gated on
 *      doc status) and calls `onOpenCase(caseId)`.  The handler fetches the
 *      case via an authenticated GET and calls `openAdminMessageDialog`.
 *   2. Wait for the case-detail dialog to appear (the fetch + render takes
 *      up to a few seconds).
 *   3. Switch to the Audit tab (Radix TabsTrigger — Playwright's `.click()`
 *      sends the full pointer-event sequence including pointerdown, which is
 *      what Radix needs to activate the tab).
 *   4. Click the Refresh button to force-load the audit log for this case.
 */
async function openCaseAuditTab(
  page: import("@playwright/test").Page,
  docId: number,
) {
  // 1. Open the case-detail dialog via the ExternalLink button in the row.
  await page.getByTestId(`btn-open-supporting-doc-case-${docId}`).click();

  // 2. Wait for the Audit tab trigger to appear in the dialog tab strip.
  await expect(page.getByTestId("case-tab-audit")).toBeVisible({
    timeout: 10_000,
  });

  // 3. Switch to the Audit tab.
  await page.getByTestId("case-tab-audit").click({ force: true });

  // 4. Wait for the Refresh button, then load the latest audit entries.
  await expect(page.getByTestId("case-audit-refresh")).toBeVisible({
    timeout: 5_000,
  });
  await page.getByTestId("case-audit-refresh").click();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Admin — Supporting Docs audit trail", () => {
  // One rate-limited login for the whole file.
  test.beforeAll(async () => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the admin audit-trail e2e tests",
      );
    }
    sharedAdminToken = readAdminToken();
  });

  test("bulk-approving all visible docs writes a user_document_approved audit row for each document", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode("E2EAT-BA");
    const caseId = await createCase(api, sharedAdminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "112233");

    // Upload three documents so we can verify every one gets its own audit row.
    const docId1 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "bulk-approve-1.png",
    );
    const docId2 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "bulk-approve-2.png",
    );
    const docId3 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "bulk-approve-3.png",
    );
    const uploadedDocIds = [docId1, docId2, docId3];

    await mountAdminSession(page, sharedAdminToken);

    // ── Step 1 (UI): Filter to this case and bulk-approve ─────────────────
    await navigateToSupportingDocsAndFilter(page, caseId);

    // Wait until all three rows are visible before triggering bulk approve.
    for (const docId of uploadedDocIds) {
      await expect(page.getByTestId(`row-supporting-doc-${docId}`)).toBeVisible(
        { timeout: 15_000 },
      );
    }

    await page.getByTestId("button-bulk-approve-supporting-docs").click();

    // ── Step 2 (UI): Wait for all rows to flip to "approved" ──────────────
    for (const docId of uploadedDocIds) {
      await expect(
        page.getByTestId(`row-supporting-doc-${docId}`),
      ).toContainText("approved", { timeout: 15_000 });
    }

    // Allow the server to commit all audit rows before querying.
    await page.waitForTimeout(800);

    // ── Step 3 (API): Every document must have its own audit row ──────────
    const logs = await fetchAuditLogs(api, sharedAdminToken);

    const approvalLogs = logs.filter(
      (l) =>
        l.action === "user_document_approved" &&
        l.targetType === "case" &&
        l.targetId === caseId,
    );

    expect(
      approvalLogs.length,
      `Expected 3 user_document_approved audit rows for case ${caseId}, got ${approvalLogs.length}`,
    ).toBeGreaterThanOrEqual(3);

    for (const log of approvalLogs) {
      expect(log.adminUsername).toBe(ADMIN_USERNAME);
    }

    await api.dispose();
  });

  test("bulk-rejecting all visible docs writes a user_document_rejected audit row for each document", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode("E2EAT-BR");
    const caseId = await createCase(api, sharedAdminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "445566");

    // Upload two documents.
    const docId1 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "bulk-reject-1.png",
    );
    const docId2 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "bulk-reject-2.png",
    );
    const uploadedDocIds = [docId1, docId2];

    const BULK_REJECT_NOTE = "E2E bulk rejection — insufficient quality";

    await mountAdminSession(page, sharedAdminToken);

    // ── Step 1 (UI): Filter to this case, open bulk-reject confirmation ───
    await navigateToSupportingDocsAndFilter(page, caseId);

    for (const docId of uploadedDocIds) {
      await expect(page.getByTestId(`row-supporting-doc-${docId}`)).toBeVisible(
        { timeout: 15_000 },
      );
    }

    // Click "Bulk reject" to reveal the confirmation panel.
    await page.getByTestId("button-bulk-reject-supporting-docs").click();

    const notesField = page.getByTestId(
      "textarea-bulk-reject-notes-supporting-docs",
    );
    await expect(notesField).toBeVisible({ timeout: 10_000 });
    await notesField.fill(BULK_REJECT_NOTE);

    // Confirm the bulk rejection.
    await page
      .getByTestId("button-bulk-reject-confirm-supporting-docs")
      .click();

    // ── Step 2 (UI): Wait for all rows to flip to "rejected" ──────────────
    for (const docId of uploadedDocIds) {
      await expect(
        page.getByTestId(`row-supporting-doc-${docId}`),
      ).toContainText("rejected", { timeout: 15_000 });
    }

    // Allow the server to commit all audit rows before querying.
    await page.waitForTimeout(800);

    // ── Step 3 (API): Every document must have its own audit row ──────────
    const logs = await fetchAuditLogs(api, sharedAdminToken);

    const rejectionLogs = logs.filter(
      (l) =>
        l.action === "user_document_rejected" &&
        l.targetType === "case" &&
        l.targetId === caseId,
    );

    expect(
      rejectionLogs.length,
      `Expected 2 user_document_rejected audit rows for case ${caseId}, got ${rejectionLogs.length}`,
    ).toBeGreaterThanOrEqual(2);

    for (const log of rejectionLogs) {
      expect(log.adminUsername).toBe(ADMIN_USERNAME);
      expect(log.newValue).toContain(BULK_REJECT_NOTE);
    }

    await api.dispose();
  });

  test("approving a doc writes user_document_approved audit row with admin username and case id", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode("E2EAT-A");
    const caseId = await createCase(api, sharedAdminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "246810");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "audit-approve.png",
    );

    await mountAdminSession(page, sharedAdminToken);

    // ── Step 1 (UI): Approve via the Supporting Docs tab ─────────────────
    await navigateToSupportingDocsAndFilter(page, caseId);

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("uploaded");

    await page.getByTestId(`button-approve-supporting-doc-${docId}`).click();

    // ── Step 2 (UI): Optimistic status flip ──────────────────────────────
    await expect(row).toContainText("approved", { timeout: 10_000 });

    // ── Step 3 (UI): Audit tab in case detail dialog ──────────────────────
    // Allow the server to commit the audit row before we open the dialog.
    await page.waitForTimeout(500);

    await openCaseAuditTab(page, docId);

    // The case-audit-list shows action names and adminUsername for this case.
    const auditList = page.getByTestId("case-audit-list");
    await expect(auditList).toBeVisible({ timeout: 15_000 });
    await expect(auditList).toContainText("user_document_approved", {
      timeout: 10_000,
    });
    await expect(auditList).toContainText(ADMIN_USERNAME);

    // ── Step 4 (API): targetId and adminUsername ──────────────────────────
    const logs = await fetchAuditLogs(api, sharedAdminToken);

    const approvalLog = logs.find(
      (l) =>
        l.action === "user_document_approved" &&
        l.targetType === "case" &&
        l.targetId === caseId,
    );

    expect(
      approvalLog,
      `Expected a user_document_approved audit row targeting case ${caseId}`,
    ).toBeDefined();
    expect(approvalLog?.adminUsername).toBe(ADMIN_USERNAME);

    await api.dispose();
  });

  test("rejecting a doc writes user_document_rejected audit row with admin notes in newValue", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode("E2EAT-R");
    const caseId = await createCase(api, sharedAdminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "135791");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "audit-reject.png",
    );

    const REJECT_NOTE = "E2E rejection reason — document is illegible";

    await mountAdminSession(page, sharedAdminToken);

    // ── Step 1 (UI): Reject via the Supporting Docs tab ──────────────────
    await navigateToSupportingDocsAndFilter(page, caseId);

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("uploaded");

    // Click Reject to expand the inline notes panel.
    await page.getByTestId(`button-reject-supporting-doc-${docId}`).click();

    const notesField = page.getByTestId(
      `textarea-reject-supporting-doc-${docId}`,
    );
    await expect(notesField).toBeVisible({ timeout: 10_000 });
    await notesField.fill(REJECT_NOTE);

    // Submit the rejection.
    await page
      .getByTestId(`button-confirm-reject-supporting-doc-${docId}`)
      .click();

    // ── Step 2 (UI): Optimistic status flip ──────────────────────────────
    await expect(row).toContainText("rejected", { timeout: 10_000 });

    // ── Step 3 (UI): Audit tab in case detail dialog ──────────────────────
    await page.waitForTimeout(500);

    await openCaseAuditTab(page, docId);

    const auditList = page.getByTestId("case-audit-list");
    await expect(auditList).toBeVisible({ timeout: 15_000 });
    await expect(auditList).toContainText("user_document_rejected", {
      timeout: 10_000,
    });
    await expect(auditList).toContainText(ADMIN_USERNAME);

    // ── Step 4 (API): adminUsername, targetId, and newValue ───────────────
    // The in-dialog audit list renders action and adminUsername; it does not
    // render newValue.  The API assertion covers the newValue field so a
    // silent drop in the audit INSERT is caught even if it passes the UI check.
    const logs = await fetchAuditLogs(api, sharedAdminToken);

    const rejectionLog = logs.find(
      (l) =>
        l.action === "user_document_rejected" &&
        l.targetType === "case" &&
        l.targetId === caseId,
    );

    expect(
      rejectionLog,
      `Expected a user_document_rejected audit row targeting case ${caseId}`,
    ).toBeDefined();
    expect(rejectionLog?.adminUsername).toBe(ADMIN_USERNAME);
    expect(rejectionLog?.newValue).toContain(REJECT_NOTE);

    await api.dispose();
  });

  test("bulk-approve progress counter ('Approving N of N…') disappears from the toolbar after the batch finishes (Task #620)", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });

    // ── Seed: two pending documents on a fresh case ───────────────────────
    const accessCode = uniqueAccessCode("E2EAT-BP");
    const caseId = await createCase(api, sharedAdminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "203040");

    const docId1 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "progress-reset-1.png",
    );
    const docId2 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "progress-reset-2.png",
    );

    await mountAdminSession(page, sharedAdminToken);

    // ── Navigate and filter ───────────────────────────────────────────────
    await navigateToSupportingDocsAndFilter(page, caseId);

    for (const docId of [docId1, docId2]) {
      await expect(page.getByTestId(`row-supporting-doc-${docId}`)).toBeVisible(
        { timeout: 15_000 },
      );
    }

    // ── Trigger bulk approve ──────────────────────────────────────────────
    await page.getByTestId("button-bulk-approve-supporting-docs").click();

    // ── Wait for all rows to flip to "approved" ───────────────────────────
    for (const docId of [docId1, docId2]) {
      await expect(
        page.getByTestId(`row-supporting-doc-${docId}`),
      ).toContainText("approved", { timeout: 15_000 });
    }

    // ── Assert: progress counter is gone ─────────────────────────────────
    //
    // When the finally block of bulkApproveVisible() runs it calls both
    // setBulkApproving(false) and setBulkProgress(null), causing the
    // "Approving N of N…" label to disappear.  Because all documents are
    // now approved (not actionable), the bulk-approve button itself also
    // unmounts — so we assert on the counter text directly to make the
    // intent of this test explicit.
    await expect(
      page.getByText(/Approving \d+ of \d+/),
    ).toHaveCount(0, { timeout: 10_000 });

    // Belt-and-suspenders: the button itself should also be gone since there
    // are no more actionable docs.
    await expect(
      page.getByTestId("button-bulk-approve-supporting-docs"),
    ).toHaveCount(0, { timeout: 5_000 });

    await api.dispose();
  });

  test("bulk-reject progress counter ('Rejecting N of N…') disappears from the toolbar after the batch finishes", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });

    // ── Seed: two pending documents on a fresh case ───────────────────────
    const accessCode = uniqueAccessCode("E2EAT-BRP");
    const caseId = await createCase(api, sharedAdminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "506070");

    const docId1 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "reject-progress-reset-1.png",
    );
    const docId2 = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "reject-progress-reset-2.png",
    );

    await mountAdminSession(page, sharedAdminToken);

    // ── Navigate and filter ───────────────────────────────────────────────
    await navigateToSupportingDocsAndFilter(page, caseId);

    for (const docId of [docId1, docId2]) {
      await expect(page.getByTestId(`row-supporting-doc-${docId}`)).toBeVisible(
        { timeout: 15_000 },
      );
    }

    // ── Open bulk-reject confirmation panel ──────────────────────────────
    await page.getByTestId("button-bulk-reject-supporting-docs").click();

    const notesField = page.getByTestId(
      "textarea-bulk-reject-notes-supporting-docs",
    );
    await expect(notesField).toBeVisible({ timeout: 10_000 });
    await notesField.fill("E2E progress-counter reset test — bulk rejection");

    // ── Confirm the bulk rejection ────────────────────────────────────────
    await page
      .getByTestId("button-bulk-reject-confirm-supporting-docs")
      .click();

    // ── Wait for all rows to flip to "rejected" ───────────────────────────
    for (const docId of [docId1, docId2]) {
      await expect(
        page.getByTestId(`row-supporting-doc-${docId}`),
      ).toContainText("rejected", { timeout: 15_000 });
    }

    // ── Assert: progress counter is gone ─────────────────────────────────
    //
    // When the finally block of bulkRejectVisible() runs it calls both
    // setBulkRejecting(false) and setBulkProgress(null), causing the
    // "Rejecting N of N…" label to disappear.  Because all documents are
    // now rejected (not actionable), the bulk-reject button itself also
    // unmounts — so we assert on the counter text directly to make the
    // intent of this test explicit.
    await expect(
      page.getByText(/Rejecting \d+ of \d+/),
    ).toHaveCount(0, { timeout: 10_000 });

    // Belt-and-suspenders: the button itself should also be gone since there
    // are no more actionable docs.
    await expect(
      page.getByTestId("button-bulk-reject-supporting-docs"),
    ).toHaveCount(0, { timeout: 5_000 });

    await api.dispose();
  });
});
