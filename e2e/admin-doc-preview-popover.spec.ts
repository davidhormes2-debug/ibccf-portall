// Task #497 — End-to-end tests for the document preview button in the
// quick-action popover (SupportingDocsQuickPopover).
// Task #623 — Extended to cover approve and reject actions in the same popover.
//
// Strategy:
//   • FMC patch (addInitScript) converts React's MessageChannel scheduler to
//     microtask-based yields, freeing the Chromium JS thread for CDP commands.
//   • page.route() intercepts /api/cases to return ONLY the test case — this
//     eliminates the per-case messages/unread polling storm (O(n) fetches per
//     tick become O(1)), prevents pagination from hiding the badge, and removes
//     any need to trigger a React search-input re-render.
//   • page.route() intercepts /api/user-documents/pending-counts to always
//     return count=1 for the test case so the badge renders immediately after
//     the first post-login poll.
//   • All remaining assertions use standard Playwright locators; page.evaluate()
//     is only used where Playwright's actionability stability checks would
//     otherwise hang due to continuous re-renders.
//
// Eight tests:
//   1. PNG upload  → preview dialog shows an <img> with data:image/png src.
//   2. PDF upload  → preview dialog shows an <iframe> with data:application/pdf src.
//   3. File-API 500 → dialog stays closed; destructive toast "Preview failed" appears.
//   4. Approve button → success toast, doc row removed, badge count decrements to 0.
//   5. Reject button  → success toast, doc row removed, badge count decrements to 0.
//   6. Bulk-reject Cancel → confirmation panel dismissed, both doc rows still present,
//      "Reject all" button re-visible and clickable.
//   7. Per-row approve button is disabled while its PATCH is in flight and
//      re-enables once the PATCH resolves (slow-route intercept).
//   8. Per-row reject button is disabled while its PATCH is in flight and
//      re-enables once the PATCH resolves (slow-route intercept).

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import {
  uniqueAccessCode,
  TINY_PNG_DATA_URL,
  TINY_PDF_DATA_URL,
  readAdminToken,
  createCase,
  issuePortalSession,
  clearAdminRateLimit,
} from "./helpers";

const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

async function uploadSupportingDoc(
  api: APIRequestContext,
  caseId: string,
  sessionToken: string,
  fileName: string,
  fileData: string,
): Promise<number> {
  const res = await api.post(`/api/cases/${caseId}/user-documents`, {
    headers: { "x-portal-session-token": sessionToken },
    data: {
      fileData,
      fileName,
      category: "general",
      description: "E2E preview test",
    },
  });
  expect(res.status(), "upload doc").toBe(201);
  const { id } = await res.json();
  return id as number;
}

/**
 * Fetches the full case object from the real API using an admin token.
 * Used to build the /api/cases mock so the dashboard renders the correct row.
 */
async function fetchCaseJson(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<Record<string, unknown>> {
  const res = await api.get(`/api/cases`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(res.status(), "fetch cases list").toBe(200);
  const cases = await res.json() as Record<string, unknown>[];
  const found = cases.find((c) => c.id === caseId);
  expect(found, `case ${caseId} in list`).toBeTruthy();
  return found!;
}

/**
 * FMC (FakeMessageChannel) init script + navigator.locks shim.
 *
 * React 18's scheduler uses MessageChannel as a cooperative yield mechanism.
 * In Playwright's headless Chromium the JS thread is shared between page
 * scripts and the CDP protocol layer — when React's scheduler is spinning,
 * its MessageChannel tasks keep the JS thread fully occupied and block CDP.
 *
 * The FMC patch converts port2.postMessage() into a microtask (Promise.resolve)
 * so React still processes its queue promptly, but the gap between macrotasks
 * is preserved, letting CDP inject events between ticks.
 *
 * The navigator.locks shim makes every Web Lock request resolve immediately
 * (rather than queuing), so useCrossTabSync's leader-election path doesn't
 * delay the initial pending-counts fetch.
 */
function installFmcPatch(page: import("@playwright/test").Page): Promise<void> {
  return page.addInitScript(() => {
    // FMC patch
    const NMC = window.MessageChannel;
    class FMC extends NMC {
      constructor() {
        super();
        const { port1, port2 } = this;
        const original = port1.postMessage.bind(port1);
        port2.postMessage = (msg: unknown) => {
          void Promise.resolve().then(() => {
            if (typeof port1.onmessage === "function") {
              port1.onmessage(new MessageEvent("message", { data: msg }));
            }
          });
        };
        port1.postMessage = original;
      }
    }
    (window as unknown as Record<string, unknown>).MessageChannel = FMC;

    // navigator.locks shim: resolve every lock request immediately.
    if (typeof navigator !== "undefined" && "locks" in navigator) {
      const orig = navigator.locks;
      Object.defineProperty(navigator, "locks", {
        get: () => ({
          ...orig,
          request: (
            _name: string,
            optionsOrCallback: unknown,
            maybeCallback?: unknown,
          ) => {
            const cb =
              typeof optionsOrCallback === "function"
                ? optionsOrCallback
                : (maybeCallback as (l: Lock) => Promise<unknown>);
            return Promise.resolve(
              cb({ name: _name, mode: "exclusive" } as Lock),
            );
          },
          query: orig.query.bind(orig),
        }),
        configurable: true,
      });
    }
  });
}

async function loginAdminUi(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await page.getByTestId("input-admin-username").fill(ADMIN_USERNAME);
  await page.getByTestId("input-admin-password").fill(ADMIN_PASSWORD);
  await page.getByTestId("button-admin-login").click();
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 25_000,
  });
}

/**
 * Installs route intercepts to keep the admin dashboard quiet during tests.
 *
 * 1. GET /api/cases — returns ONLY the test case, collapsing per-case polling
 *    from O(n) to O(1) and ensuring the badge row is always visible without
 *    any search/filter interaction.
 * 2. GET /api/user-documents/pending-counts — returns count=1 so the badge
 *    renders immediately after the first post-login poll (≤3 s cadence).
 * 3. GET /api/submissions — returns [] to suppress new-submission toast noise.
 * 4. GET *\/messages/unread — returns {count:0} so the per-case unread-messages
 *    poll (every 5 s) does not re-render the cases table for 50+ cases.
 */
async function installDashboardRoutes(
  page: import("@playwright/test").Page,
  caseId: string,
  caseJson: Record<string, unknown>,
): Promise<void> {
  // Return only the test case so there is a single row in the table.
  await page.route("**/api/cases", (route) => {
    if (route.request().method() === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([caseJson]),
      });
    } else {
      route.continue();
    }
  });

  // Freeze pending-counts at 1 for the test case.
  await page.route("**/api/user-documents/pending-counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ counts: { [caseId]: 1 } }),
    }),
  );

  // Silence submissions to suppress new-submission toasts.
  await page.route("**/api/submissions", (route) => {
    if (route.request().method() === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    } else {
      route.continue();
    }
  });

  // Silence per-case unread-messages polling ({count:0} is what the dashboard
  // reads; with only 1 case this fires just once per 5 s tick instead of 50+).
  await page.route("**/messages/unread**", (route) => {
    if (route.request().method() === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 0 }),
      });
    } else {
      route.continue();
    }
  });
}

test.describe("Admin — document preview button in quick-action popover", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test.beforeEach(async () => {
    if (!DATABASE_URL) return;
    const pg = new Client({ connectionString: DATABASE_URL });
    try {
      await pg.connect();
      await pg.query(`DELETE FROM admin_login_attempts`);
    } finally {
      await pg.end();
    }
  });

  test("preview button shows an image for a PNG upload", async ({ page, baseURL }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EPVPNG");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "246810");
    const docId = await uploadSupportingDoc(
      api, caseId, sessionToken, "preview-image-test.png", TINY_PNG_DATA_URL,
    );

    // Fetch the real case JSON so the /api/cases mock has the correct shape.
    const caseJson = await fetchCaseJson(api, adminToken, caseId);

    // Install FMC patch before page load so React uses microtask yields.
    await installFmcPatch(page);

    // Install route mocks so the dashboard shows only our test case and the
    // pending-counts badge appears immediately without search or pagination.
    await installDashboardRoutes(page, caseId, caseJson);

    await loginAdminUi(page);

    // Badge renders as soon as pending-counts polling fires post-login (≤3 s).
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // Click the badge to open the SupportingDocsQuickPopover.
    await badge.click();

    const docRow = page.getByTestId(`popover-user-doc-row-${docId}`);
    await expect(docRow).toBeVisible({ timeout: 15_000 });

    // Click the eye icon to open the preview dialog.
    const previewBtn = page.getByTestId(`popover-user-doc-preview-${docId}`);
    await expect(previewBtn).toBeVisible({ timeout: 10_000 });
    await previewBtn.click();

    // The preview dialog must appear with an <img> showing the PNG data URL.
    const dialog = page.getByTestId("sdqp-preview-dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const previewImg = dialog.locator("img");
    await expect(previewImg).toBeVisible({ timeout: 10_000 });
    const src = await previewImg.getAttribute("src");
    expect(src).toContain("data:image/png");

    // Pressing Escape closes the dialog.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });

    await api.dispose();
  });

  test("preview button shows an iframe for a PDF upload", async ({ page, baseURL }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EPVPDF");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "135791");
    const docId = await uploadSupportingDoc(
      api, caseId, sessionToken, "preview-pdf-test.pdf", TINY_PDF_DATA_URL,
    );

    const caseJson = await fetchCaseJson(api, adminToken, caseId);

    await installFmcPatch(page);
    await installDashboardRoutes(page, caseId, caseJson);

    await loginAdminUi(page);

    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    await badge.click();

    const docRow = page.getByTestId(`popover-user-doc-row-${docId}`);
    await expect(docRow).toBeVisible({ timeout: 15_000 });

    const previewBtn = page.getByTestId(`popover-user-doc-preview-${docId}`);
    await expect(previewBtn).toBeVisible({ timeout: 10_000 });
    await previewBtn.click();

    const dialog = page.getByTestId("sdqp-preview-dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const previewIframe = dialog.locator("iframe");
    await expect(previewIframe).toBeVisible({ timeout: 10_000 });
    const iframeSrc = await previewIframe.getAttribute("src");
    expect(iframeSrc).toContain("data:application/pdf");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });

    await api.dispose();
  });

  test("preview falls back gracefully when the file API returns an error", async ({ page, baseURL }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EPVERR");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "999111");
    const docId = await uploadSupportingDoc(
      api, caseId, sessionToken, "preview-error-test.png", TINY_PNG_DATA_URL,
    );

    const caseJson = await fetchCaseJson(api, adminToken, caseId);

    await installFmcPatch(page);
    await installDashboardRoutes(page, caseId, caseJson);

    // Intercept the per-doc file fetch — return 500 to trigger error fallback.
    await page.route(
      `**/api/admin/user-documents/${docId}/file`,
      (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated server error" }),
        }),
    );

    await loginAdminUi(page);

    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    await badge.click();

    const docRow = page.getByTestId(`popover-user-doc-row-${docId}`);
    await expect(docRow).toBeVisible({ timeout: 15_000 });

    const previewBtn = page.getByTestId(`popover-user-doc-preview-${docId}`);
    await expect(previewBtn).toBeVisible({ timeout: 10_000 });
    await previewBtn.click();

    // The toast fires in the catch block at the same moment setPreviewOpen(false)
    // is called.  Check for the toast FIRST — before the dialog-count assertion
    // — so we catch it while it's still alive (toasts auto-dismiss in ~5 s).
    // The dialog briefly opens (setPreviewOpen(true) fires synchronously before
    // the async fetch), then closes in the catch, so toHaveCount(0) just
    // confirms it settled to closed.
    const toastEl = page.getByRole("status").filter({ hasText: "Preview failed" });
    await expect(toastEl).toBeVisible({ timeout: 15_000 });

    const dialog = page.getByTestId("sdqp-preview-dialog");
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });

    await api.dispose();
  });

  // Task #623 — Approve action tests ----------------------------------------

  test("approve button shows success toast, removes doc row, and decrements badge", async ({ page, baseURL }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EAPPRV");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "112233");
    const docId = await uploadSupportingDoc(
      api, caseId, sessionToken, "approve-test.png", TINY_PNG_DATA_URL,
    );

    const caseJson = await fetchCaseJson(api, adminToken, caseId);

    await installFmcPatch(page);

    // Mutable flag: once the PATCH fires the pending-counts poll returns 0.
    let actionFired = false;

    // Return only the test case.
    await page.route("**/api/cases", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([caseJson]),
        });
      } else {
        route.continue();
      }
    });

    // Pending-counts: 1 until the approve PATCH fires, then 0 so the badge hides.
    await page.route("**/api/user-documents/pending-counts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ counts: actionFired ? {} : { [caseId]: 1 } }),
      }),
    );

    // Silence submissions and unread-messages polls.
    await page.route("**/api/submissions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      } else {
        route.continue();
      }
    });
    await page.route("**/messages/unread**", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) });
      } else {
        route.continue();
      }
    });

    // Intercept the per-doc PATCH: set actionFired so the next pending-counts
    // poll returns {} (count 0), then let the real request through so the
    // success toast fires.
    await page.route(`**/api/admin/user-documents/${docId}`, (route) => {
      if (route.request().method() === "PATCH") {
        actionFired = true;
        route.continue();
      } else {
        route.continue();
      }
    });

    await loginAdminUi(page);

    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    await badge.click();

    const docRow = page.getByTestId(`popover-user-doc-row-${docId}`);
    await expect(docRow).toBeVisible({ timeout: 15_000 });

    const approveBtn = page.getByTestId(`popover-user-doc-approve-${docId}`);
    await expect(approveBtn).toBeVisible({ timeout: 10_000 });
    await approveBtn.click();

    // Toast confirms the approval.
    const toastEl = page.getByRole("status").filter({ hasText: "Document approved" });
    await expect(toastEl).toBeVisible({ timeout: 15_000 });

    // Doc row is removed from the popover list after a successful approve.
    await expect(docRow).toHaveCount(0, { timeout: 10_000 });

    // Badge disappears: onActioned fires loadUserDocPendingCounts() which now
    // gets {} back (count 0), so the badge is no longer rendered.
    await expect(badge).toHaveCount(0, { timeout: 15_000 });

    await api.dispose();
  });

  // Task #623 — Reject action test -------------------------------------------

  test("reject button shows success toast, removes doc row, and decrements badge", async ({ page, baseURL }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EREJECT");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "445566");
    const docId = await uploadSupportingDoc(
      api, caseId, sessionToken, "reject-test.png", TINY_PNG_DATA_URL,
    );

    const caseJson = await fetchCaseJson(api, adminToken, caseId);

    await installFmcPatch(page);

    // Mutable flag: once the PATCH fires the pending-counts poll returns 0.
    let actionFired = false;

    await page.route("**/api/cases", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([caseJson]),
        });
      } else {
        route.continue();
      }
    });

    // Pending-counts: 1 until the reject PATCH fires, then 0 so the badge hides.
    await page.route("**/api/user-documents/pending-counts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ counts: actionFired ? {} : { [caseId]: 1 } }),
      }),
    );

    await page.route("**/api/submissions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      } else {
        route.continue();
      }
    });
    await page.route("**/messages/unread**", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) });
      } else {
        route.continue();
      }
    });

    // Intercept the per-doc PATCH: set actionFired then let the real request
    // through so the success toast fires.
    await page.route(`**/api/admin/user-documents/${docId}`, (route) => {
      if (route.request().method() === "PATCH") {
        actionFired = true;
        route.continue();
      } else {
        route.continue();
      }
    });

    await loginAdminUi(page);

    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    await badge.click();

    const docRow = page.getByTestId(`popover-user-doc-row-${docId}`);
    await expect(docRow).toBeVisible({ timeout: 15_000 });

    const rejectBtn = page.getByTestId(`popover-user-doc-reject-${docId}`);
    await expect(rejectBtn).toBeVisible({ timeout: 10_000 });
    await rejectBtn.click();

    // Toast confirms the rejection.
    const toastEl = page.getByRole("status").filter({ hasText: "Document rejected" });
    await expect(toastEl).toBeVisible({ timeout: 15_000 });

    // Doc row is removed from the popover list after a successful reject.
    await expect(docRow).toHaveCount(0, { timeout: 10_000 });

    // Badge disappears: onActioned fires loadUserDocPendingCounts() which now
    // gets {} back (count 0), so the badge is no longer rendered.
    await expect(badge).toHaveCount(0, { timeout: 15_000 });

    await api.dispose();
  });

  // Task #1437 — bulk-reject Cancel path: clicking "Cancel" on the confirmation
  // panel must reset setBulkRejectConfirming(false) and setBulkRejectNotes(""),
  // returning the popover to its normal state without stale notes or a stuck panel.
  test("bulk-reject 'Cancel' dismisses the confirmation panel and leaves both doc rows intact", async ({ page, baseURL }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EBRCAN");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "778899");

    // Upload two documents so the "Reject all" bulk button renders.
    const docId1 = await uploadSupportingDoc(
      api, caseId, sessionToken, "bulk-cancel-doc-1.png", TINY_PNG_DATA_URL,
    );
    const docId2 = await uploadSupportingDoc(
      api, caseId, sessionToken, "bulk-cancel-doc-2.png", TINY_PNG_DATA_URL,
    );

    const caseJson = await fetchCaseJson(api, adminToken, caseId);

    await installFmcPatch(page);

    // Return only the test case and freeze pending-counts at 2 for the badge.
    await page.route("**/api/cases", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([caseJson]),
        });
      } else {
        route.continue();
      }
    });
    await page.route("**/api/user-documents/pending-counts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ counts: { [caseId]: 2 } }),
      }),
    );
    await page.route("**/api/submissions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      } else {
        route.continue();
      }
    });
    await page.route("**/messages/unread**", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) });
      } else {
        route.continue();
      }
    });

    await loginAdminUi(page);

    // Badge renders as soon as the pending-counts poll fires.
    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // Open the quick-action popover.
    await badge.click();

    // Both doc rows must be visible before proceeding.
    const docRow1 = page.getByTestId(`popover-user-doc-row-${docId1}`);
    const docRow2 = page.getByTestId(`popover-user-doc-row-${docId2}`);
    await expect(docRow1).toBeVisible({ timeout: 15_000 });
    await expect(docRow2).toBeVisible({ timeout: 10_000 });

    // Click "Reject all" to open the confirmation panel.
    const bulkRejectBtn = page.getByTestId(`popover-bulk-reject-${caseId}`);
    await expect(bulkRejectBtn).toBeVisible({ timeout: 5_000 });
    await bulkRejectBtn.click();

    // The confirmation panel must now be visible.
    const confirmPanel = page.getByTestId(`popover-bulk-reject-confirm-${caseId}`);
    await expect(confirmPanel).toBeVisible({ timeout: 5_000 });

    // The notes textarea is part of the confirmation panel.
    const notesTextarea = page.getByTestId(`popover-bulk-reject-notes-${caseId}`);
    await expect(notesTextarea).toBeVisible({ timeout: 5_000 });

    // Click Cancel — this must call setBulkRejectConfirming(false) and
    // setBulkRejectNotes(""), collapsing the confirmation panel.
    const cancelBtn = page.getByTestId(`popover-bulk-reject-cancel-${caseId}`);
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });
    await cancelBtn.click();

    // Confirmation panel must be gone.
    await expect(confirmPanel).toHaveCount(0, { timeout: 5_000 });

    // Both document rows must still be present — no rejection occurred.
    await expect(docRow1).toBeVisible({ timeout: 5_000 });
    await expect(docRow2).toBeVisible({ timeout: 5_000 });

    // "Reject all" button must be visible and enabled again.
    await expect(bulkRejectBtn).toBeVisible({ timeout: 5_000 });
    await expect(bulkRejectBtn).toBeEnabled();

    await api.dispose();
  });

  // Task #1436 — Bulk button double-click protection tests -------------------

  test("'Approve all' button is disabled while a bulk approve is in flight and re-enables after it completes", async ({ page, baseURL }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EBKAPV");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "778899");

    // Upload two documents so the bulk "Approve all" button appears (requires docs.length > 1).
    const docId1 = await uploadSupportingDoc(
      api, caseId, sessionToken, "bulk-approve-a.png", TINY_PNG_DATA_URL,
    );
    const docId2 = await uploadSupportingDoc(
      api, caseId, sessionToken, "bulk-approve-b.png", TINY_PNG_DATA_URL,
    );

    const caseJson = await fetchCaseJson(api, adminToken, caseId);

    await installFmcPatch(page);

    // Pending-counts frozen at 2 for the duration of this test.
    await page.route("**/api/cases", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([caseJson]) });
      } else {
        route.continue();
      }
    });
    await page.route("**/api/user-documents/pending-counts", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: { [caseId]: 2 } }) }),
    );
    await page.route("**/api/submissions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      } else {
        route.continue();
      }
    });
    await page.route("**/messages/unread**", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) });
      } else {
        route.continue();
      }
    });

    // Intercept both PATCH requests with a 700 ms artificial delay, then
    // return a 500 error so both docs remain in the list after the operation —
    // this lets us confirm the button re-enables (still visible, not disabled).
    await page.route(`**/api/admin/user-documents/${docId1}`, async (route) => {
      if (route.request().method() === "PATCH") {
        await new Promise<void>((r) => setTimeout(r, 700));
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated delay" }) });
      } else {
        await route.continue();
      }
    });
    await page.route(`**/api/admin/user-documents/${docId2}`, async (route) => {
      if (route.request().method() === "PATCH") {
        await new Promise<void>((r) => setTimeout(r, 700));
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated delay" }) });
      } else {
        await route.continue();
      }
    });

    await loginAdminUi(page);

    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await badge.click();

    // Both doc rows must be present for the bulk button to render.
    await expect(page.getByTestId(`popover-user-doc-row-${docId1}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`popover-user-doc-row-${docId2}`)).toBeVisible({ timeout: 15_000 });

    const approveAllBtn = page.getByTestId(`popover-bulk-approve-${caseId}`);
    await expect(approveAllBtn).toBeEnabled({ timeout: 10_000 });

    // Click "Approve all" and immediately verify it becomes disabled.
    await approveAllBtn.click();
    await expect(approveAllBtn).toBeDisabled({ timeout: 5_000 });

    // Wait for the bulk operation to finish (failure toast fires when all PATCHes settle).
    const failToast = page.getByRole("status").filter({ hasText: /approved|failed/i });
    await expect(failToast).toBeVisible({ timeout: 10_000 });

    // After the operation completes, both docs are still in the list (PATCHes
    // failed), so the bulk buttons re-render and the "Approve all" button
    // must be enabled again.
    await expect(approveAllBtn).toBeEnabled({ timeout: 5_000 });

    await api.dispose();
  });

  test("'Reject all' confirm button is disabled while a bulk reject is in flight and re-enables after it completes", async ({ page, baseURL }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EBKRJT");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "334455");

    // Upload two documents so the bulk "Reject all" button appears.
    const docId1 = await uploadSupportingDoc(
      api, caseId, sessionToken, "bulk-reject-a.png", TINY_PNG_DATA_URL,
    );
    const docId2 = await uploadSupportingDoc(
      api, caseId, sessionToken, "bulk-reject-b.png", TINY_PNG_DATA_URL,
    );

    const caseJson = await fetchCaseJson(api, adminToken, caseId);

    await installFmcPatch(page);

    await page.route("**/api/cases", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([caseJson]) });
      } else {
        route.continue();
      }
    });
    await page.route("**/api/user-documents/pending-counts", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: { [caseId]: 2 } }) }),
    );
    await page.route("**/api/submissions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      } else {
        route.continue();
      }
    });
    await page.route("**/messages/unread**", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) });
      } else {
        route.continue();
      }
    });

    // Intercept both PATCH requests with a 700 ms delay then a 500 error —
    // docs remain in the list so we can verify the buttons re-enable.
    await page.route(`**/api/admin/user-documents/${docId1}`, async (route) => {
      if (route.request().method() === "PATCH") {
        await new Promise<void>((r) => setTimeout(r, 700));
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated delay" }) });
      } else {
        await route.continue();
      }
    });
    await page.route(`**/api/admin/user-documents/${docId2}`, async (route) => {
      if (route.request().method() === "PATCH") {
        await new Promise<void>((r) => setTimeout(r, 700));
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated delay" }) });
      } else {
        await route.continue();
      }
    });

    await loginAdminUi(page);

    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await badge.click();

    await expect(page.getByTestId(`popover-user-doc-row-${docId1}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`popover-user-doc-row-${docId2}`)).toBeVisible({ timeout: 15_000 });

    // Click "Reject all" — this shows the confirmation panel (not the actual operation yet).
    const rejectAllBtn = page.getByTestId(`popover-bulk-reject-${caseId}`);
    await expect(rejectAllBtn).toBeEnabled({ timeout: 10_000 });
    await rejectAllBtn.click();

    // The confirmation panel replaces the "Reject all" button.
    const confirmPanel = page.getByTestId(`popover-bulk-reject-confirm-${caseId}`);
    await expect(confirmPanel).toBeVisible({ timeout: 5_000 });

    // The "Reject all" button is hidden while the confirmation panel is open.
    await expect(rejectAllBtn).toHaveCount(0, { timeout: 5_000 });

    const confirmBtn = page.getByTestId(`popover-bulk-reject-confirm-btn-${caseId}`);
    await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });

    // Trigger the bulk reject — confirm button must become disabled immediately.
    await confirmBtn.click();
    await expect(confirmBtn).toBeDisabled({ timeout: 5_000 });

    // Wait for the operation to settle (failure toast fires when all PATCHes resolve).
    const failToast = page.getByRole("status").filter({ hasText: /rejected|failed/i });
    await expect(failToast).toBeVisible({ timeout: 10_000 });

    // After the operation, bulkRejectConfirming resets to false — the confirmation
    // panel closes and the "Reject all" button re-appears enabled.
    await expect(confirmPanel).toHaveCount(0, { timeout: 5_000 });
    await expect(rejectAllBtn).toBeVisible({ timeout: 5_000 });
    await expect(rejectAllBtn).toBeEnabled({ timeout: 5_000 });

    await api.dispose();
  });

  // Task #1903 — Per-row double-click protection tests -----------------------

  test("per-row approve button is disabled while its PATCH is in flight and re-enables after it resolves", async ({ page, baseURL }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EROWAPV");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "667788");
    const docId = await uploadSupportingDoc(
      api, caseId, sessionToken, "row-approve-inflight.png", TINY_PNG_DATA_URL,
    );

    const caseJson = await fetchCaseJson(api, adminToken, caseId);

    await installFmcPatch(page);

    // Pending-counts frozen at 1 for the duration of this test.
    await page.route("**/api/cases", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([caseJson]) });
      } else {
        route.continue();
      }
    });
    await page.route("**/api/user-documents/pending-counts", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: { [caseId]: 1 } }) }),
    );
    await page.route("**/api/submissions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      } else {
        route.continue();
      }
    });
    await page.route("**/messages/unread**", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) });
      } else {
        route.continue();
      }
    });

    // Intercept the per-doc PATCH with a 700 ms delay then a 500 error —
    // the row stays in the list so we can verify the button re-enables.
    await page.route(`**/api/admin/user-documents/${docId}`, async (route) => {
      if (route.request().method() === "PATCH") {
        await new Promise<void>((r) => setTimeout(r, 700));
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated delay" }) });
      } else {
        await route.continue();
      }
    });

    await loginAdminUi(page);

    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await badge.click();

    const docRow = page.getByTestId(`popover-user-doc-row-${docId}`);
    await expect(docRow).toBeVisible({ timeout: 15_000 });

    const approveBtn = page.getByTestId(`popover-user-doc-approve-${docId}`);
    await expect(approveBtn).toBeEnabled({ timeout: 10_000 });

    // Click approve and immediately verify the button becomes disabled.
    await approveBtn.click();
    await expect(approveBtn).toBeDisabled({ timeout: 5_000 });

    // Wait for the PATCH to resolve (error toast fires when the 500 settles).
    const errorToast = page.getByRole("status").filter({ hasText: /action failed/i });
    await expect(errorToast).toBeVisible({ timeout: 10_000 });

    // After the PATCH resolves, actingId resets to null — button must re-enable.
    await expect(approveBtn).toBeEnabled({ timeout: 5_000 });

    await api.dispose();
  });

  test("per-row reject button is disabled while its PATCH is in flight and re-enables after it resolves", async ({ page, baseURL }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EROWRJT");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "889900");
    const docId = await uploadSupportingDoc(
      api, caseId, sessionToken, "row-reject-inflight.png", TINY_PNG_DATA_URL,
    );

    const caseJson = await fetchCaseJson(api, adminToken, caseId);

    await installFmcPatch(page);

    // Pending-counts frozen at 1 for the duration of this test.
    await page.route("**/api/cases", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([caseJson]) });
      } else {
        route.continue();
      }
    });
    await page.route("**/api/user-documents/pending-counts", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: { [caseId]: 1 } }) }),
    );
    await page.route("**/api/submissions", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      } else {
        route.continue();
      }
    });
    await page.route("**/messages/unread**", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) });
      } else {
        route.continue();
      }
    });

    // Intercept the per-doc PATCH with a 700 ms delay then a 500 error —
    // the row stays in the list so we can verify the button re-enables.
    await page.route(`**/api/admin/user-documents/${docId}`, async (route) => {
      if (route.request().method() === "PATCH") {
        await new Promise<void>((r) => setTimeout(r, 700));
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated delay" }) });
      } else {
        await route.continue();
      }
    });

    await loginAdminUi(page);

    const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await badge.click();

    const docRow = page.getByTestId(`popover-user-doc-row-${docId}`);
    await expect(docRow).toBeVisible({ timeout: 15_000 });

    const rejectBtn = page.getByTestId(`popover-user-doc-reject-${docId}`);
    await expect(rejectBtn).toBeEnabled({ timeout: 10_000 });

    // Click reject and immediately verify the button becomes disabled.
    await rejectBtn.click();
    await expect(rejectBtn).toBeDisabled({ timeout: 5_000 });

    // Wait for the PATCH to resolve (error toast fires when the 500 settles).
    const errorToast = page.getByRole("status").filter({ hasText: /action failed/i });
    await expect(errorToast).toBeVisible({ timeout: 10_000 });

    // After the PATCH resolves, actingId resets to null — button must re-enable.
    await expect(rejectBtn).toBeEnabled({ timeout: 5_000 });

    await api.dispose();
  });
});
