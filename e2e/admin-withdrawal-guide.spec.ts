// Task #296 — Real-browser end-to-end test for the admin Withdrawal Guide
// toggle (introduced in Task #290).
//
// Flow under test:
//   1. Seed a deterministic case in the live dev database with
//      withdrawal_guide_visible = false.
//   2. Log into the admin dashboard with ADMIN_USERNAME / ADMIN_PASSWORD.
//   3. Open the case-detail dialog for the seeded case via the
//      Ctrl+K case-finder.
//   4. Switch to the "Workflow" tab where the Withdrawal Guide toggle lives
//      (the dialog defaults to the "Overview" tab).
//   5. Read the initial "Guide Banner" state pill (Hidden).
//   6. Flip the "Show Withdrawal Guide Banner" switch — this auto-saves via
//      `toggleWithdrawalGuideVisible`, firing PATCH `/api/cases/:id` with
//      `{ withdrawalGuideVisible: true }`. Intercept and assert the payload.
//   7. Re-open the dialog (after the save round-trip) and confirm the pill
//      now reads "Visible".
//   8. Verify the same change is reflected in the database row.

import { test, expect, type Request } from "@playwright/test";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to run this E2E test.");
}

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

// Deterministic per-run identifiers so the test cleans up after itself and
// never collides with seeded data the user may already have.
const runTag = randomBytes(4).toString("hex");
const accessCode = `T296-${runTag}`;
const userName = `Withdrawal Guide E2E ${runTag}`;

let pg: Client;
let caseId: string;

test.beforeAll(async () => {
  pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  // Seed a known case with the guide hidden. Most columns are nullable; we
  // only set what the admin list / case-finder needs to display the row.
  const insert = await pg.query<{ id: string }>(
    `INSERT INTO cases (access_code, user_name, user_email, status, withdrawal_guide_visible)
     VALUES ($1, $2, $3, 'active', false)
     RETURNING id`,
    [accessCode, userName, `e2e-${runTag}@example.com`],
  );
  caseId = insert.rows[0].id;
});

test.afterAll(async () => {
  if (caseId) {
    await pg.query(`DELETE FROM cases WHERE id = $1`, [caseId]);
  }
  await pg.end();
});

test("admin can toggle the Withdrawal Guide banner from the case-detail dialog", async ({
  page,
}) => {
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[t+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

  // 2. ----- Inject pre-fetched admin token and navigate ---------------------
  const adminToken = readAdminToken();
  await page.addInitScript(
    (t) => { if (t) sessionStorage.setItem("adminToken", t); },
    adminToken,
  );
  log("goto /admin");
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  log("/admin loaded");

  // The case-finder trigger is only rendered after the stored token is
  // accepted — a stable signal that we are past the login form.
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 20_000,
  });
  log("logged in (trigger visible)");

  // 3. ----- Open the case-detail dialog via the case-finder ---------------
  log("dispatching Ctrl+K keyboard shortcut");
  // Use the global Ctrl+K shortcut directly. The trigger button click was
  // hanging under load (the admin dashboard fires several large list
  // queries right after login), and the keydown listener is attached to
  // `window` so it doesn't require pointer hit-testing.
  await page.keyboard.press("Control+KeyK");
  log("Ctrl+K pressed; waiting for finder input");
  const finderInput = page.getByTestId("admin-case-finder-input");
  await expect(finderInput).toBeVisible({ timeout: 10_000 });
  log("finder input visible; filling");
  await finderInput.fill(accessCode, { force: true });
  log("filled access code; waiting for result row");

  const resultRow = page.getByTestId(`admin-case-finder-result-${caseId}`);
  await expect(resultRow).toBeVisible({ timeout: 10_000 });
  log("result row visible; pressing Enter to pick");
  // Click on the <li role="option"> doesn't always reliably dispatch through
  // Radix's overlay layering; the AdminCaseFinder's input has a keydown
  // handler that calls pick() on Enter — that path is deterministic.
  await page.getByTestId("admin-case-finder-input").press("Enter");
  log("Enter pressed (case picked)");

  // 4. ----- Switch to the "Workflow" tab -----------------------------------
  // The Withdrawal Guide controls live inside the Workflow tab of the
  // case-detail dialog; the dialog defaults to "Overview" via localStorage
  // (which is empty in a fresh Playwright browser context).
  const workflowTab = page.getByTestId("case-tab-workflow");
  await expect(workflowTab).toBeVisible({ timeout: 10_000 });
  await workflowTab.click({ force: true });
  log("workflow tab clicked");

  const guidePill = page.getByTestId("withdrawal-guide-banner-state");
  await expect(guidePill).toBeVisible({ timeout: 10_000 });

  // 5. ----- Initial state must be "Hidden" ---------------------------------
  await expect(guidePill).toHaveText("Hidden");

  // 6. ----- Intercept the PATCH that the switch auto-fires -----------------
  // The "Show Withdrawal Guide Banner" Switch is wired directly to
  // `toggleWithdrawalGuideVisible` (AdminDashboard.tsx ~L4703), which fires
  // PATCH /api/cases/:id with `{ withdrawalGuideVisible: next }` on every
  // change. There is no separate Save button for this control — the toggle
  // is the save.
  const patchRequests: Array<{ url: string; body: unknown }> = [];
  page.on("request", (req: Request) => {
    if (
      req.method() === "PATCH" &&
      req.url().includes(`/api/cases/${caseId}`)
    ) {
      let parsed: unknown = req.postData();
      try {
        parsed = JSON.parse(req.postData() ?? "");
      } catch {
        // leave raw if not JSON
      }
      patchRequests.push({ url: req.url(), body: parsed });
    }
  });

  const patchResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "PATCH" &&
      res.url().includes(`/api/cases/${caseId}`) &&
      res.status() === 200,
  );

  const toggle = page.getByTestId("switch-withdrawal-guide-visible");
  await expect(toggle).toBeVisible();
  // The toggle is a Radix Switch; reading `aria-checked` is the canonical
  // way to confirm its on/off state.
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click({ force: true });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  log("toggle flipped; waiting for PATCH response");
  await patchResponse;
  log("PATCH response received");

  // Assert the captured PATCH carried withdrawalGuideVisible: true.
  expect(patchRequests.length).toBeGreaterThan(0);
  const patched = patchRequests.find(
    (r) =>
      typeof r.body === "object" &&
      r.body !== null &&
      (r.body as Record<string, unknown>).withdrawalGuideVisible === true,
  );
  expect(
    patched,
    `expected a PATCH /api/cases/${caseId} with withdrawalGuideVisible: true, got ${JSON.stringify(patchRequests)}`,
  ).toBeTruthy();

  // 7. ----- Verify server-backed persistence in the database ----------------
  // The PATCH was confirmed above; reading the DB row directly is the
  // canonical proof that the toggle was persisted server-side (not just
  // reflected in local React state).
  const row = await pg.query<{ withdrawal_guide_visible: boolean }>(
    `SELECT withdrawal_guide_visible FROM cases WHERE id = $1`,
    [caseId],
  );
  expect(row.rows[0]?.withdrawal_guide_visible).toBe(true);

  // 8. ----- Re-open the dialog and confirm the pill reflects fresh data ----
  // Close the dialog (Escape) and re-pick the same case via the finder.
  // The save handler's `loadData()` call has already refreshed the admin
  // case list, so re-opening the dialog binds `selectedCase` to the
  // server's view — proving "reflects correctly" without a full SPA
  // reload (which would re-trigger Vite's slow dev compile).
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("withdrawal-guide-banner-state")).toBeHidden();
  log("dialog closed; re-opening via Ctrl+K");

  await page.keyboard.press("Control+KeyK");
  await expect(page.getByTestId("admin-case-finder-input")).toBeVisible({
    timeout: 10_000,
  });
  await page
    .getByTestId("admin-case-finder-input")
    .fill(accessCode, { force: true });
  await expect(
    page.getByTestId(`admin-case-finder-result-${caseId}`),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("admin-case-finder-input").press("Enter");
  log("case reopened; navigating to workflow tab");

  // The case-detail dialog persists the last-active tab in localStorage
  // (`ibccf.admin.caseDetailTab`), so after the first click above we should
  // re-land on "workflow" — but click again defensively in case the dialog
  // re-opened on a different tab.
  await page.getByTestId("case-tab-workflow").click({ force: true });

  const reopenedPill = page.getByTestId("withdrawal-guide-banner-state");
  await expect(reopenedPill).toBeVisible({ timeout: 10_000 });
  await expect(reopenedPill).toHaveText("Visible");

  // The toggle inside the reopened dialog should also reflect the new value
  // — proving the switch is rebound to fresh server-side data and the user
  // wouldn't see a stale OFF state next time they open this case.
  await expect(
    page.getByTestId("switch-withdrawal-guide-visible"),
  ).toHaveAttribute("aria-checked", "true");
});
