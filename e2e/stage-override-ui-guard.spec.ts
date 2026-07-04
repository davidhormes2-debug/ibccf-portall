/**
 * e2e/stage-override-ui-guard.spec.ts
 *
 * End-to-end regression guards for the RBAC-based stage-override UI controls.
 *
 * Test suite 1 — sub-admin ("admin" role) UI guards:
 *   1. Create a case as super_admin and set its stage to "1".
 *   2. Create a sub-admin with the "admin" role via POST /api/admin-users.
 *   3. Inject the sub-admin bearer token into sessionStorage and navigate to
 *      /admin — AdminDashboard resolves the role via GET /api/admin/verify,
 *      setting currentAdminRole to "admin".
 *   4. Open the case detail panel by clicking the "Letter" button (which calls
 *      openLetterEditor → setSelectedCase + opens a letter-editor Dialog).
 *   5. Dismiss the letter-editor Dialog with Escape so the case-detail panel
 *      stays visible (selectedCase remains set).
 *   6. Switch to the "Workflow" tab inside the case-detail panel.
 *   7. Assert the sequential-stage hint text is visible (proves the role guard
 *      rendered for a non-super_admin).
 *   8. Assert data-testid="stage-override-section" is NOT in the DOM (the
 *      override section is gated to super_admin only).
 *
 * Test suite 2 — super_admin override section:
 *   1. Create a fresh case at stage 1, inject the super_admin token.
 *   2. Open the case detail and switch to the Workflow tab (same flow as above).
 *   3. Open the stage select and choose Stage 3 (non-sequential from stage 1).
 *   4. Assert data-testid="stage-override-section" IS visible.
 *
 * Relevant source
 * ───────────────
 * - client/src/pages/AdminDashboard.tsx       — STAGE_SEQUENCE_SELECT_BLOCK_START/END,
 *                                               stage-override-section, select-withdrawal-stage
 * - client/src/components/admin/CaseDetailTabsList.tsx — case-tab-workflow testid
 * - server/routes/adminUsers.ts               — POST /api/admin-users
 * - server/__tests__/stageTransitionValidation.test.ts — companion static tests
 */

import { test, expect, request, type Page } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  deleteCase,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

// ─────────────────────────────────────────────────────────────────────────────
// Local helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Create a sub-admin account via POST /api/admin-users. Returns the new user id. */
async function createSubAdmin(
  api: import("@playwright/test").APIRequestContext,
  superAdminToken: string,
  username: string,
  password: string,
  role: "admin" | "agent" | "viewer",
): Promise<number> {
  const res = await api.post("/api/admin-users", {
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      "Content-Type": "application/json",
    },
    data: { username, password, role },
  });
  expect(res.status(), `create sub-admin '${username}'`).toBe(201);
  const body = (await res.json()) as { id: number };
  return body.id;
}

/** Delete a sub-admin account via DELETE /api/admin-users/:id. */
async function deleteSubAdmin(
  api: import("@playwright/test").APIRequestContext,
  superAdminToken: string,
  userId: number,
): Promise<void> {
  await api.delete(`/api/admin-users/${userId}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
}

/** Log in via POST /api/admin/login and return the bearer token. */
async function loginAsAdmin(
  api: import("@playwright/test").APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const res = await api.post("/api/admin/login", {
    data: { username, password },
  });
  expect(res.status(), `login as '${username}'`).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

/**
 * Inject an admin bearer token into sessionStorage before the page loads,
 * then navigate to /admin.  Waits for admin-case-finder-trigger as the
 * stable "dashboard is fully mounted" signal.
 */
async function injectTokenAndNavigate(
  page: Page,
  token: string,
  baseURL: string,
): Promise<void> {
  await page.addInitScript(
    (t) => {
      if (t) sessionStorage.setItem("adminToken", t);
    },
    token,
  );
  await page.goto(`${baseURL}/admin`);
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * PATCH /api/cases/:id to set the initial stage to "1".
 * The initial-assignment exemption means the sequential guard does not fire.
 */
async function setStageOne(
  api: import("@playwright/test").APIRequestContext,
  superAdminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.patch(`/api/cases/${caseId}`, {
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      "Content-Type": "application/json",
    },
    data: { stage: "1" },
  });
  expect(res.status(), "set initial stage to 1").toBe(200);
}

/**
 * Open the case detail panel for the given case by clicking its "Letter"
 * button, then dismiss the letter-editor Dialog with Escape so the case-detail
 * panel stays visible (selectedCase remains set).
 *
 * Flow:
 *   button-edit-letter-{id} → openLetterEditor(c)
 *     → setSelectedCase(c)       (case-detail panel becomes visible)
 *     → setIsLetterEditorOpen(true) (letter-editor Dialog opens on top)
 *   Escape → Dialog closes, selectedCase still set
 */
async function openCaseDetail(page: Page, caseId: string): Promise<void> {
  // Ensure we are on the Cases tab.
  await page.getByTestId("tab-cases").click();

  // Find and click the "Letter" button for the specific case.
  const letterBtn = page.getByTestId(`button-edit-letter-${caseId}`);
  await expect(letterBtn).toBeVisible({ timeout: 15_000 });
  await letterBtn.click();

  // Wait for the case-detail panel to mount (setSelectedCase is called before
  // the async letter fetch, so case-detail-tabs should attach quickly).
  await expect(page.getByTestId("case-detail-tabs")).toBeAttached({
    timeout: 10_000,
  });

  // Wait for the letter-editor Dialog to open (it fires after the async fetch).
  // We wait for the role="dialog" overlay to appear before dismissing it.
  await page.waitForSelector('[role="dialog"]', { state: "visible", timeout: 10_000 });

  // Dismiss the Dialog — Radix Dialog handles Escape at the document level
  // regardless of which element has focus.  selectedCase stays set.
  await page.keyboard.press("Escape");

  // Give React time to finish unmounting the Dialog overlay.
  await page.waitForTimeout(300);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — sub-admin ("admin" role): sequential hint visible, no override
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Stage-override UI guard — sub-admin role (no override section)", () => {
  let caseId: string;
  let superAdminToken: string;
  let subAdminId: number;
  let subAdminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the stage-override UI guard E2E tests",
      );
    }

    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    const api = await request.newContext({ baseURL });
    try {
      superAdminToken = readAdminToken();

      // Create a case at stage 1.
      const accessCode = uniqueAccessCode("E2ESUBGUARD");
      caseId = await createCase(api, superAdminToken, accessCode, {
        userName: "Stage Override UI Guard — Sub Admin",
      });
      await setStageOne(api, superAdminToken, caseId);

      // Create a sub-admin with the "admin" role and obtain its bearer token.
      const username = `e2e-subguard-${uniqueAccessCode("sb").toLowerCase()}`;
      const password = "SubGuardPass1!";
      subAdminId = await createSubAdmin(
        api,
        superAdminToken,
        username,
        password,
        "admin",
      );
      subAdminToken = await loginAsAdmin(api, username, password);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });
    try {
      if (subAdminId) await deleteSubAdmin(api, superAdminToken, subAdminId);
      if (caseId) await deleteCase(api, superAdminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(120_000);

  test(
    "sub-admin sees the sequential-stage hint and no override section in the Workflow tab",
    async ({ page, baseURL }) => {
      // ── Step 1: navigate to /admin as the sub-admin ───────────────────
      await injectTokenAndNavigate(page, subAdminToken, baseURL!);

      // ── Step 2: open the case detail and switch to the Workflow tab ───
      await openCaseDetail(page, caseId);
      await page.getByTestId("case-tab-workflow").click();

      // ── Step 3: sequential-stage hint must be visible ─────────────────
      //
      // This paragraph renders only when currentAdminRole !== 'super_admin'.
      // Seeing it proves the AdminDashboard correctly resolved "admin" from
      // the sub-admin bearer token via GET /api/admin/verify.
      await expect(
        page.getByText(
          "Only the next sequential stage is available for your role.",
        ),
      ).toBeVisible({ timeout: 10_000 });

      // ── Step 4: open the stage select and verify disabled items ───────
      //
      // For a sub-admin at stage 1:
      //   - Stage 2 (next sequential) must be ENABLED   (aria-disabled absent)
      //   - Stage 3 (skip-forward)    must be DISABLED  (aria-disabled="true")
      //
      // Source guard:
      //   disabled = currentAdminRole !== 'super_admin' && !isNextStage && !isCurrent
      const selectTrigger = page.getByTestId("select-withdrawal-stage");
      await expect(selectTrigger).toBeVisible({ timeout: 10_000 });
      await selectTrigger.click();

      // Wait for the Radix Select portal to render.
      const stage3Option = page.getByRole("option", { name: /Stage 3/ });
      const stage2Option = page.getByRole("option", { name: /Stage 2/ });
      await expect(stage3Option).toBeVisible({ timeout: 5_000 });

      // Stage 2 (next sequential from stage 1) must be selectable — not disabled.
      await expect(stage2Option).not.toHaveAttribute("aria-disabled", "true");

      // Stage 3 (skip-forward) must be disabled for a sub-admin.
      await expect(stage3Option).toHaveAttribute("aria-disabled", "true");

      // ── Step 5: interaction guard — disabled option must not change stage
      //
      // Force-click stage 3 (bypasses pointer-events: none) and confirm that
      // the Radix SelectItem's onSelect handler still refuses the selection —
      // the trigger must continue to display the current stage (Stage 1).
      await stage3Option.click({ force: true });

      // After attempting to select a disabled item, the trigger label must
      // still reflect Stage 1 ("💰 Stage 1: Phrase Key Deposit Received").
      await expect(selectTrigger).toContainText("Stage 1");

      // Close the select (it may or may not have closed after the force-click).
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);

      // ── Step 6: stage-override-section must NOT be present ────────────
      //
      // The override div is rendered only when:
      //   currentAdminRole === 'super_admin' && isNonSequential
      // For a sub-admin the outer condition is always false, so the element
      // must be absent from the DOM entirely, not merely hidden.
      await expect(
        page.getByTestId("stage-override-section"),
      ).not.toBeAttached();
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — super_admin: override section appears for a non-sequential stage
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Stage-override UI guard — super_admin override section visible", () => {
  let caseId: string;
  let superAdminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the stage-override UI guard E2E tests",
      );
    }

    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    const api = await request.newContext({ baseURL });
    try {
      superAdminToken = readAdminToken();

      // Create a fresh case at stage 1.
      const accessCode = uniqueAccessCode("E2ESUPGUARD");
      caseId = await createCase(api, superAdminToken, accessCode, {
        userName: "Stage Override UI Guard — Super Admin",
      });
      await setStageOne(api, superAdminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseId) return;
    const api = await request.newContext({ baseURL });
    try {
      await deleteCase(api, superAdminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(120_000);

  test(
    "super_admin sees the override section when a non-sequential stage is selected",
    async ({ page, baseURL }) => {
      // ── Step 1: navigate to /admin as super_admin ─────────────────────
      await injectTokenAndNavigate(page, superAdminToken, baseURL!);

      // ── Step 2: open the case detail and switch to the Workflow tab ───
      await openCaseDetail(page, caseId);
      await page.getByTestId("case-tab-workflow").click();

      // ── Step 3: sequential hint must NOT be shown for super_admin ─────
      await expect(
        page.getByText(
          "Only the next sequential stage is available for your role.",
        ),
      ).not.toBeVisible();

      // ── Step 4: override section absent before a non-sequential pick ──
      //
      // With the select still showing stage 1, isNonSequential is false and
      // the override section must not be in the DOM.
      await expect(
        page.getByTestId("stage-override-section"),
      ).not.toBeAttached();

      // ── Step 5: open the stage select and choose Stage 3 ─────────────
      //
      // Stage 3 is non-sequential from stage 1 (next sequential = stage 2).
      // For super_admin all options are enabled, so clicking stage 3 is valid.
      //
      // Stage 3 label: "🔐 Stage 3: Phrase Key Approved & Available"
      const selectTrigger = page.getByTestId("select-withdrawal-stage");
      await expect(selectTrigger).toBeVisible({ timeout: 10_000 });
      await selectTrigger.click();

      // Radix Select renders options in a document-level portal.
      const stage3Option = page.getByRole("option", { name: /Stage 3/ });
      await expect(stage3Option).toBeVisible({ timeout: 5_000 });
      await stage3Option.click();

      // ── Step 6: override section must now be visible ──────────────────
      //
      // isNonSequential = (3 !== 1) && (3 !== 1 + 1) = true
      // → the override div renders with data-testid="stage-override-section"
      await expect(
        page.getByTestId("stage-override-section"),
      ).toBeVisible({ timeout: 5_000 });
    },
  );
});
