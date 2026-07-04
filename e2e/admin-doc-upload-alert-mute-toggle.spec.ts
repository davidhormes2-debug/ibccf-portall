// E2E — admin doc-upload-alert mute/unmute round-trip.
//
// What the unit tests (CasesTabDocUploadAlertMutedBadge.test.tsx) already
// cover: the "MUTED" badge renders / hides in the cases list based on the
// `mutedAlertCaseIds` Set in context.
//
// What this spec adds: the full end-to-end flow that the unit tests cannot
// reach — the admin clicking the mute switch inside the case-detail dialog,
// the server persisting the change, and the badge state updating in the UI.
// A silent regression in the toggle endpoint or the context update path
// would leave admins confused about which cases are actually muted.
//
// Two flows covered in a single test:
//   1. MUTE — click the switch ON; confirm:
//      a. the switch turns checked
//      b. the "MUTED" badge appears inside the case-detail Documents panel
//      c. the server persists muted=true  (GET …/doc-upload-alert-mute)
//      d. after closing the dialog, the per-row badge appears in the cases list
//
//   2. UNMUTE — re-open the dialog; click the switch OFF; confirm:
//      a. the switch turns unchecked
//      b. the "MUTED" badge disappears from the panel
//      c. the server persists muted=false
//      d. after closing the dialog, the per-row badge is gone from the cases list
//
// Relevant source:
//   - client/src/pages/AdminDashboard.tsx — toggleAlertMute, loadMutedAlertCases,
//     case-doc-upload-alert-mute-panel, switch-doc-upload-alert-mute (~line 9420)
//   - client/src/components/admin/tabs/CasesTab.tsx — badge-doc-upload-alert-muted-<id>
//   - server/routes/admin.ts — GET/PUT /api/admin/cases/:id/doc-upload-alert-mute
//   - client/src/components/admin/CaseDetailTabsList.tsx — case-tab-documents

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  deleteCase,
  loginAdminUi,
  localTimeout,
} from "./helpers";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

// ── Helper: open the tabbed case-detail dialog and navigate to Documents ──────
//
// Mirrors the pattern from admin-receipts-dialog-case-detail-entry.spec.ts:
// Manage dropdown → "Send Notification" opens the case-detail dialog →
// click "Documents" tab.
async function openCaseDetailDocumentsTab(
  page: import("@playwright/test").Page,
  caseId: string,
  accessCode: string,
): Promise<void> {
  // Pin the cases list to this case via the search box so the row is always
  // on-screen regardless of other data or page-refresh ordering.
  const search = page.getByTestId("input-search-cases");
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(accessCode);

  // Open the Manage dropdown for this case.
  const manageButton = page.getByTestId(`button-manage-case-${caseId}`);
  await expect(manageButton).toBeVisible({ timeout: 15_000 });
  await manageButton.click();

  // "Send Notification" (menu-manage-<caseId>) opens the tabbed case-detail
  // dialog and sets selectedCase so the mute panel has a target.
  const notifyItem = page.getByTestId(`menu-manage-${caseId}`);
  await expect(notifyItem).toBeVisible({ timeout: 5_000 });
  await notifyItem.click();

  // Navigate to the Documents tab where the mute switch lives.
  const docsTab = page.getByTestId("case-tab-documents");
  await expect(docsTab).toBeVisible({ timeout: 10_000 });
  await docsTab.click();
}

// ── Spec ──────────────────────────────────────────────────────────────────────

test.describe("Admin — doc-upload-alert mute toggle round-trip", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test",
      );
    }
  });

  test.beforeEach(() => {
    test.setTimeout(localTimeout(120_000));
  });

  test("muting shows the badge; unmuting clears it — dialog panel and cases list row both update", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ------------------------------------------------------------------ seed
    const accessCode = uniqueAccessCode("E2EMT");
    const caseId = await createCase(api, adminToken, accessCode);

    try {
      // ---------------------------------------- sign in to admin dashboard
      await loginAdminUi(page);

      // ──────────────────────────── STEP 1: open the mute panel ──────────
      await openCaseDetailDocumentsTab(page, caseId, accessCode);

      // The mute panel must be present before we interact with the switch.
      const mutePanel = page.getByTestId("case-doc-upload-alert-mute-panel");
      await expect(mutePanel).toBeVisible({ timeout: 10_000 });

      // The switch starts unchecked — case is not muted.
      const muteSwitch = page.getByTestId("switch-doc-upload-alert-mute");
      await expect(muteSwitch).toBeVisible({ timeout: 5_000 });
      await expect(muteSwitch).not.toBeChecked();

      // The "MUTED" badge inside the panel must not exist yet.
      await expect(
        page.getByTestId("badge-doc-upload-alert-muted"),
      ).toHaveCount(0);

      // ──────────────────────────── STEP 2: MUTE ─────────────────────────
      await muteSwitch.click();

      // The switch flips to checked (optimistic update fires immediately).
      await expect(muteSwitch).toBeChecked({ timeout: 5_000 });

      // The "MUTED" badge appears inside the Documents panel.
      await expect(
        page.getByTestId("badge-doc-upload-alert-muted"),
      ).toBeVisible({ timeout: 5_000 });

      // ── Verify server-side persistence ─────────────────────────────────
      // Poll the GET endpoint until it reflects muted=true so a race between
      // the optimistic UI update and the PUT round-trip doesn't cause a
      // false-negative.
      await expect
        .poll(
          async () => {
            const r = await api.get(
              `/api/admin/cases/${caseId}/doc-upload-alert-mute`,
              { headers: { Authorization: `Bearer ${adminToken}` } },
            );
            if (r.status() !== 200) return null;
            const body = await r.json();
            return body.muted;
          },
          { timeout: 10_000 },
        )
        .toBe(true);

      // ── Close the dialog; per-row badge must appear in the cases list ───
      await page.keyboard.press("Escape");

      const rowBadge = page.getByTestId(
        `badge-doc-upload-alert-muted-${caseId}`,
      );
      await expect(rowBadge).toBeVisible({ timeout: 10_000 });

      // ──────────────────────────── STEP 3: UNMUTE ───────────────────────
      // Re-open the case detail dialog and navigate back to Documents tab.
      await openCaseDetailDocumentsTab(page, caseId, accessCode);

      // The switch must reflect the persisted muted=true state.
      const muteSwitchAgain = page.getByTestId("switch-doc-upload-alert-mute");
      await expect(muteSwitchAgain).toBeChecked({ timeout: 10_000 });

      // Toggle off (unmute).
      await muteSwitchAgain.click();

      // Switch flips back to unchecked (optimistic).
      await expect(muteSwitchAgain).not.toBeChecked({ timeout: 5_000 });

      // The "MUTED" badge disappears from the panel.
      await expect(
        page.getByTestId("badge-doc-upload-alert-muted"),
      ).toHaveCount(0, { timeout: 5_000 });

      // ── Verify server-side persistence ─────────────────────────────────
      await expect
        .poll(
          async () => {
            const r = await api.get(
              `/api/admin/cases/${caseId}/doc-upload-alert-mute`,
              { headers: { Authorization: `Bearer ${adminToken}` } },
            );
            if (r.status() !== 200) return null;
            const body = await r.json();
            return body.muted;
          },
          { timeout: 10_000 },
        )
        .toBe(false);

      // ── Close the dialog; per-row badge must vanish from the cases list ─
      await page.keyboard.press("Escape");

      await expect(rowBadge).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await deleteCase(api, adminToken, caseId);
      await api.dispose();
    }
  });
});
