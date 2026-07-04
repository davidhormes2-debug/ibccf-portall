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
      description: "E2E supporting document upload",
    },
  });
  expect(res.status(), "upload supporting doc").toBe(201);
  const body = await res.json();
  expect(typeof body.id).toBe("number");
  return body.id as number;
}

async function fetchDocStatus(
  api: APIRequestContext,
  adminToken: string,
  docId: number,
): Promise<string | null> {
  const res = await api.get("/api/user-documents", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(res.status(), "list user-documents").toBe(200);
  const docs = (await res.json()) as Array<{ id: number; status: string | null }>;
  const match = docs.find((d) => d.id === docId);
  return match?.status ?? null;
}

/**
 * Navigate to the admin dashboard using the pre-fetched bearer token from
 * global-setup.ts, injecting it into sessionStorage so the React app skips
 * the login form entirely.
 */
async function loginAdminUi(page: import("@playwright/test").Page) {
  const token = readAdminToken();
  await page.addInitScript(
    (t) => { if (t) sessionStorage.setItem("adminToken", t); },
    token,
  );

  // Register BEFORE goto so we don't miss the email-delivery-alerts call
  // that fires immediately on dashboard mount.
  const emailAlertsSettled = page
    .waitForResponse(
      (resp) => resp.url().includes("/api/cases/email-delivery-alerts"),
      { timeout: 10_000 },
    )
    .catch(() => null);

  await page.goto("/admin", { waitUntil: "domcontentloaded" });

  // The case-finder trigger is only rendered after the stored token is
  // accepted — a stable "dashboard is up" signal.
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 25_000,
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

test.describe("Admin — Supporting Docs tab approve/reject", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the admin supporting-docs e2e tests",
      );
    }
  });

  test("approve updates status optimistically and persists after reload", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const accessCode = uniqueAccessCode("E2ESD-A");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "246810");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "approve-target.png",
    );

    await loginAdminUi(page);

    // Navigate to Supporting Docs tab.
    await page.getByTestId("tab-supporting-docs").click({ force: true });

    // Filter by this case id so the row is guaranteed to be on screen
    // regardless of how many other e2e cases coexist in the DB.
    await page
      .getByTestId("filter-supporting-docs-case-id")
      .fill(caseId);

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("uploaded");

    await page
      .getByTestId(`button-approve-supporting-doc-${docId}`)
      .click();

    // Optimistic UI: badge flips to "approved" immediately, before the
    // server response — assert that without waiting on network idle.
    await expect(row).toContainText("approved", { timeout: 5_000 });

    // NOTE — success toast intentionally NOT asserted here.
    // The "Document approved" toast is short-lived; asserting it in E2E
    // risks flaky timeouts if the animation completes before Playwright
    // observes it.  The unit-test guard in
    //   shared/__tests__/adminDocActionI18nSync.test.ts
    // (constants DOC_APPROVED_TITLE / DOC_REJECTED_TITLE) already catches
    // copy drift in all three admin components at unit-test time.
    // If you add a toast assertion here in the future, use those constants
    // as the `.filter({ hasText: ... })` value and add a dedicated
    // E2E_DOC_APPROVED_TITLE export to that unit-test file so drift is
    // caught before any silent E2E timeout can occur.

    // Persistence: reload, re-filter, and verify the status survived.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId("tab-supporting-docs").click({ force: true });
    await page
      .getByTestId("select-filter-supporting-status")
      .click();
    await page.getByRole("option", { name: /All statuses/i }).click();
    await page
      .getByTestId("filter-supporting-docs-case-id")
      .fill(caseId);

    const rowAfterReload = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(rowAfterReload).toBeVisible({ timeout: 15_000 });
    await expect(rowAfterReload).toContainText("approved");

    // Belt-and-braces: confirm the API also reports the persisted state.
    expect(await fetchDocStatus(api, adminToken, docId)).toBe("approved");

    await api.dispose();
  });

  test("optimistic badge rolls back and a destructive toast appears when the server returns 500", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const accessCode = uniqueAccessCode("E2ESD-F");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "112233");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "fail-target.png",
    );

    await loginAdminUi(page);
    await page.getByTestId("tab-supporting-docs").click({ force: true });
    await page.getByTestId("filter-supporting-docs-case-id").fill(caseId);

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("uploaded");

    // Intercept the PATCH and return a 500 so the optimistic update is forced
    // to roll back.
    await page.route(`**/api/user-documents/${docId}`, async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated server error" }),
        });
      } else {
        await route.continue();
      }
    });

    await page.getByTestId(`button-approve-supporting-doc-${docId}`).click();

    // After the server rejects, the badge must revert to "uploaded".
    await expect(row).toContainText("uploaded", { timeout: 10_000 });
    await expect(row).not.toContainText("approved");

    // A destructive toast titled "Action failed" must appear.
    const toast = page.getByRole("status").filter({ hasText: "Action failed" });
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // The server-side record must remain in the original "uploaded" state.
    expect(await fetchDocStatus(api, adminToken, docId)).toBe("uploaded");

    await api.dispose();
  });

  test("reject with admin notes shows the textarea and updates status", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const accessCode = uniqueAccessCode("E2ESD-R");
    const caseId = await createCase(api, adminToken, accessCode);
    const sessionToken = await issuePortalSession(api, accessCode, "135791");
    const docId = await uploadSupportingDoc(
      api,
      caseId,
      sessionToken,
      "reject-target.png",
    );

    await loginAdminUi(page);
    await page.getByTestId("tab-supporting-docs").click({ force: true });
    await page
      .getByTestId("filter-supporting-docs-case-id")
      .fill(caseId);

    const row = page.getByTestId(`row-supporting-doc-${docId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Open the reject panel — the textarea is only mounted after the
    // first click on the Reject button.
    await page
      .getByTestId(`button-reject-supporting-doc-${docId}`)
      .click();

    const notesField = page.getByTestId(
      `textarea-reject-supporting-doc-${docId}`,
    );
    await expect(notesField).toBeVisible();
    await notesField.fill("Document is blurry — please re-upload.");

    await page
      .getByTestId(`button-confirm-reject-supporting-doc-${docId}`)
      .click();

    // Status flips to "rejected" (optimistic, then persisted).
    await expect(row).toContainText("rejected", { timeout: 10_000 });

    // NOTE — success toast intentionally NOT asserted here.
    // See the equivalent note in the "approve" test above for the full
    // rationale and instructions for adding toast assertions in the future.

    // Server side confirms the persisted status.
    expect(await fetchDocStatus(api, adminToken, docId)).toBe("rejected");

    await api.dispose();
  });
});
