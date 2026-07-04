import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  deleteCase,
  localTimeout,
} from "./helpers";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

async function openCaseDetailDialog(
  page: import("@playwright/test").Page,
  caseId: string,
  accessCode: string,
): Promise<void> {
  const search = page.getByTestId("input-search-cases");
  await expect(search).toBeVisible();
  await search.fill("");
  await search.fill(accessCode);

  const manageButton = page.getByTestId(`button-manage-case-${caseId}`);
  await expect(manageButton).toBeVisible();
  await manageButton.click();

  const manageItem = page.getByTestId(`menu-manage-${caseId}`);
  await expect(manageItem).toBeVisible();
  await manageItem.click();

  // Pill lives inside the "workflow" tab of the case-detail dialog
  // (Withdrawal Progress section). The dialog remembers the last
  // active tab via sessionStorage, so explicitly switch to Workflow.
  const workflowTab = page.getByTestId("case-tab-workflow");
  await expect(workflowTab).toBeVisible();
  await workflowTab.click();

  const pill = page.getByTestId("withdrawal-guide-banner-state");
  await pill.scrollIntoViewIfNeeded();
  await expect(pill).toBeVisible();
}

test.describe("Admin — Withdrawal Guide banner status pill", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin e2e tests");
    }
  });

  test("pill reflects withdrawalGuideVisible from the admin list response and updates when toggled", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(localTimeout(120_000));
    const api = await request.newContext({ baseURL });
    // Re-use the bearer token pre-fetched by global-setup.ts so we never
    // hit the rate-limited /api/admin/login endpoint from the browser.
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode();
    const caseId = await createCase(api, adminToken, accessCode, {
      extraPatch: { withdrawalGuideVisible: true },
    });

    try {
      // Inject the pre-fetched bearer token into sessionStorage before the
      // page initialises so the React app skips the login form entirely.
      await page.addInitScript((token: string) => {
        if (token) sessionStorage.setItem("adminToken", token);
      }, adminToken);

      await page.goto("/admin");

      // The dashboard renders the case list once the saved token is
      // accepted. Search input is the first reliable signal that we
      // are past the login form.
      await expect(page.getByTestId("input-search-cases")).toBeVisible({
        timeout: 30_000,
      });

      // ---------- Seeded case: withdrawalGuideVisible === true ----------
      // The pill text is derived purely from the case object loaded
      // by the admin list endpoint (openAdminMessageDialog seeds
      // selectedCase from the row data — no per-case GET). So if
      // the pill reads "Visible" here, the list response correctly
      // carried withdrawalGuideVisible through to the UI.
      await openCaseDetailDialog(page, caseId, accessCode);

      const pill = page.getByTestId("withdrawal-guide-banner-state");
      const switchEl = page.getByTestId("switch-withdrawal-guide-visible");

      await expect(pill).toHaveText("Visible");
      await expect(switchEl).toHaveAttribute("data-state", "checked");

      // ---------- Toggle OFF → pill flips optimistically ----------
      await switchEl.click();
      await expect(pill).toHaveText("Hidden");
      await expect(switchEl).toHaveAttribute("data-state", "unchecked");

      // Confirm the server actually persisted the change so the next
      // list fetch will return false.
      const afterOff = await api.get(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(afterOff.status()).toBe(200);
      expect((await afterOff.json()).withdrawalGuideVisible).toBe(false);

      // ---------- Full reload → pill must come from list response ----------
      // Close the dialog, reload, re-open from a freshly fetched list.
      // If the pill were hard-coded to false (or to the local
      // withdrawalGuideVisibleEdit state) this would still read
      // "Hidden" by accident, so we follow with a toggle-back-on
      // step to also catch the inverse bug.
      await page.keyboard.press("Escape");
      await page.reload();
      await expect(page.getByTestId("input-search-cases")).toBeVisible({
        timeout: 30_000,
      });

      await openCaseDetailDialog(page, caseId, accessCode);
      await expect(pill).toHaveText("Hidden");
      await expect(switchEl).toHaveAttribute("data-state", "unchecked");

      // ---------- Toggle ON → pill flips back ----------
      await switchEl.click();
      await expect(pill).toHaveText("Visible");
      await expect(switchEl).toHaveAttribute("data-state", "checked");

      const afterOn = await api.get(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(afterOn.status()).toBe(200);
      expect((await afterOn.json()).withdrawalGuideVisible).toBe(true);

      // ---------- One more reload with the server now reporting true ----------
      // Proves the pill renders "Visible" from a fresh list response
      // (i.e. the bug where the pill always reads false would fail
      // here).
      await page.keyboard.press("Escape");
      await page.reload();
      await expect(page.getByTestId("input-search-cases")).toBeVisible({
        timeout: 30_000,
      });

      await openCaseDetailDialog(page, caseId, accessCode);
      await expect(pill).toHaveText("Visible");
      await expect(switchEl).toHaveAttribute("data-state", "checked");
    } finally {
      await deleteCase(api, adminToken, caseId);
      await api.dispose();
    }
  });
});
