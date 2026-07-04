// Regression guard: Quick Send pre-fills the Send Email dialog correctly.
//
// What this spec covers:
//
//   1. When an admin clicks a Quick Send template from the Manage dropdown
//      in the Cases tab, the Send Email dialog opens with the subject line
//      pre-filled to the value produced by that template's getSubject()
//      function for the case's current withdrawal stage.
//
//   2. A case with no withdrawal stage falls back to the generic
//      "Your current stage" string in the subject.
//
// Relevant source:
//   - client/src/components/admin/tabs/CasesTab.tsx — Quick Send submenu
//   - client/src/lib/adminEmailTemplates.ts          — QUICK_SEND_TEMPLATES
//   - client/src/components/admin/SendEmailDialog.tsx — email dialog

import { test, expect, request, type APIRequestContext } from "@playwright/test";
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

function uniqueAccessCode(prefix: string): string {
  return `${prefix}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function uniqueEmail(tag: string): string {
  return `e2e-qs-${tag}-${randomBytes(3).toString("hex")}@example.com`;
}

async function createCase(
  api: APIRequestContext,
  adminToken: string,
  accessCode: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const created = await api.post("/api/cases", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { accessCode, status: "active" },
  });
  expect(created.status(), "create case").toBe(200);
  const body = await created.json() as { id: string };
  const caseId = body.id;

  const patched = await api.patch(`/api/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      userName: "Quick Send E2E User",
      userEmail: uniqueEmail(accessCode.slice(-6).toLowerCase()),
      status: "active",
      ...extra,
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

/**
 * Opens the Manage dropdown for a case row.  Returns after the dropdown is
 * visible (but before any submenu item is clicked).
 */
async function openManageDropdown(
  page: import("@playwright/test").Page,
  caseId: string,
  accessCode: string,
): Promise<void> {
  const search = page.getByTestId("input-search-cases");
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(accessCode);

  const manageButton = page.getByTestId(`button-manage-case-${caseId}`);
  await expect(manageButton).toBeVisible({ timeout: 15_000 });
  await manageButton.click();
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Cases tab — Quick Send pre-fill", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test.beforeEach(() => {
    test.setTimeout(120_000);
  });

  // ── Case WITH a withdrawal stage ────────────────────────────────────────

  test("clicking 'Send Stage Instructions' pre-fills the subject with the stage name", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const accessCode = uniqueAccessCode("QSSEND");
    const caseId = await createCase(api, adminToken, accessCode, {
      withdrawalStage: "3",
    });

    await loginAdminUi(page);
    await openManageDropdown(page, caseId, accessCode);

    // Hover the Quick Send submenu trigger to reveal template items.
    const quickSendTrigger = page.getByTestId(`menu-email-${caseId}`);
    await expect(quickSendTrigger).toBeVisible({ timeout: 5_000 });
    await quickSendTrigger.hover();

    // Click the "Send Stage Instructions" template item.
    const templateItem = page.getByTestId(`menu-email-${caseId}-stage_instructions`);
    await expect(templateItem).toBeVisible({ timeout: 5_000 });
    await templateItem.click();

    // The Send Email dialog must open with the subject pre-filled.
    // Stage 3 title is "Phrase Key Approved & Available", so:
    //   getSubject(stageName) → "Your Case Update — Phrase Key Approved & Available"
    const subjectInput = page.getByTestId("input-email-subject");
    await expect(subjectInput).toBeVisible({ timeout: 10_000 });
    await expect(subjectInput).toHaveValue(
      "Your Case Update — Phrase Key Approved & Available",
    );

    await api.dispose();
  });

  test("clicking 'Withdrawal Reminder' pre-fills the subject with the stage name", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const accessCode = uniqueAccessCode("QSREM");
    const caseId = await createCase(api, adminToken, accessCode, {
      withdrawalStage: "3",
    });

    await loginAdminUi(page);
    await openManageDropdown(page, caseId, accessCode);

    const quickSendTrigger = page.getByTestId(`menu-email-${caseId}`);
    await expect(quickSendTrigger).toBeVisible({ timeout: 5_000 });
    await quickSendTrigger.hover();

    const templateItem = page.getByTestId(`menu-email-${caseId}-withdrawal_reminder`);
    await expect(templateItem).toBeVisible({ timeout: 5_000 });
    await templateItem.click();

    // getSubject → "Reminder: Action Required — Phrase Key Approved & Available"
    const subjectInput = page.getByTestId("input-email-subject");
    await expect(subjectInput).toBeVisible({ timeout: 10_000 });
    await expect(subjectInput).toHaveValue(
      "Reminder: Action Required — Phrase Key Approved & Available",
    );

    await api.dispose();
  });

  test("clicking 'Deposit Received' pre-fills the fixed subject regardless of stage", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const accessCode = uniqueAccessCode("QSDEP");
    const caseId = await createCase(api, adminToken, accessCode, {
      withdrawalStage: "3",
    });

    await loginAdminUi(page);
    await openManageDropdown(page, caseId, accessCode);

    const quickSendTrigger = page.getByTestId(`menu-email-${caseId}`);
    await expect(quickSendTrigger).toBeVisible({ timeout: 5_000 });
    await quickSendTrigger.hover();

    const templateItem = page.getByTestId(`menu-email-${caseId}-deposit_received`);
    await expect(templateItem).toBeVisible({ timeout: 5_000 });
    await templateItem.click();

    // getSubject ignores stageName → "Deposit Received — Your Case Is Being Reviewed"
    const subjectInput = page.getByTestId("input-email-subject");
    await expect(subjectInput).toBeVisible({ timeout: 10_000 });
    await expect(subjectInput).toHaveValue(
      "Deposit Received — Your Case Is Being Reviewed",
    );

    await api.dispose();
  });

  // ── Case WITHOUT a withdrawal stage — subject must use fallback ─────────

  test("template subject falls back to 'Your current stage' when no stage is set", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // No withdrawalStage extra field — case is created without one.
    const accessCode = uniqueAccessCode("QSNOS");
    const caseId = await createCase(api, adminToken, accessCode);

    await loginAdminUi(page);
    await openManageDropdown(page, caseId, accessCode);

    const quickSendTrigger = page.getByTestId(`menu-email-${caseId}`);
    await expect(quickSendTrigger).toBeVisible({ timeout: 5_000 });
    await quickSendTrigger.hover();

    const templateItem = page.getByTestId(`menu-email-${caseId}-stage_instructions`);
    await expect(templateItem).toBeVisible({ timeout: 5_000 });
    await templateItem.click();

    // CasesTab fallback: stageName = "Your current stage" (capital Y)
    // getSubject("Your current stage") → "Your Case Update — Your current stage"
    const subjectInput = page.getByTestId("input-email-subject");
    await expect(subjectInput).toBeVisible({ timeout: 10_000 });
    await expect(subjectInput).toHaveValue(
      "Your Case Update — Your current stage",
    );

    await api.dispose();
  });
});
