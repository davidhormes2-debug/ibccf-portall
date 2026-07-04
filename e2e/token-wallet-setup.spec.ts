// e2e/token-wallet-setup.spec.ts
//
// End-to-end tests for the Token Wallet Setup feature (admin Step 5 and
// the corresponding portal card).
//
// ADMIN FLOW (TokenDepositPaidTab → Step 5)
// ─────────────────────────────────────────
// Prerequisites: validation deposit must be confirmed (Step 4) before Step 5
// becomes interactive.  The test seeds a case with that state, then:
//   1. Opens the "Paid" tab in the case-detail dialog.
//   2. Enters a wallet-setup URL + note → clicks "Send Setup Guide".
//      Badge stays "PENDING" (link saved, not yet confirmed).
//   3. Clicks "Mark Wallet Set Up" → re-opens dialog → badge reads "SET UP".
//   4. Clicks "Unconfirm" → badge reverts to "PENDING".
//   5. Clicks "Unset" → link + note cleared from the database.
//
// PORTAL FLOW (TokenWalletSetupCard  data-testid="card-token-wallet-setup")
// ──────────────────────────────────────────────────────────────────────────
// The card only renders when validationDepositConfirmed=true AND
// tokenWalletSetupLink is set (DashboardView.tsx line ~551).
//   6. Violet "Action Required" card appears when link is set but not confirmed.
//   7. Emerald "Verified" banner appears once tokenWalletSetupConfirmed=true.

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import {
  readAdminToken,
  uniqueAccessCode as _uniqueCode,
  uniqueEmail,
  loginAdminApi,
  deleteCase,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

function uniqueCode(prefix: string): string {
  return _uniqueCode(prefix);
}

// ─── Helper: inject admin token and open the case-detail dialog ──────────────

async function openCaseDialog(
  page: import("@playwright/test").Page,
  adminToken: string,
  accessCode: string,
  caseId: string,
): Promise<void> {
  await page.addInitScript(
    (t) => {
      if (t) sessionStorage.setItem("adminToken", t);
    },
    adminToken,
  );
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 20_000,
  });

  await page.keyboard.press("Control+KeyK");
  const finderInput = page.getByTestId("admin-case-finder-input");
  await expect(finderInput).toBeVisible({ timeout: 10_000 });
  await finderInput.fill(accessCode, { force: true });
  await expect(
    page.getByTestId(`admin-case-finder-result-${caseId}`),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("admin-case-finder-input").press("Enter");
}

// ─── Helper: drive the two-step portal login ─────────────────────────────────

async function loginPortalUi(
  page: import("@playwright/test").Page,
  accessCode: string,
  pin: string,
): Promise<void> {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByTestId("input-access-code").fill(accessCode);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("input-pin")).toBeVisible({ timeout: 12_000 });
  await page.getByTestId("input-pin").fill(pin);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("button-logout")).toBeVisible({
    timeout: 20_000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Admin — Token Wallet Setup Step 5", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !DATABASE_URL) {
      throw new Error("ADMIN_USERNAME, ADMIN_PASSWORD, and DATABASE_URL must be set");
    }
  });

  let pg: Client;
  let caseId: string;
  let accessCode: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    pg = new Client({ connectionString: DATABASE_URL });
    await pg.connect();

    // Clear stale admin-login-attempt rows to avoid hitting the rate limiter.
    await pg.query("DELETE FROM admin_login_attempts");

    accessCode = uniqueCode("TWS-ADM");
    const email = uniqueEmail();

    // Seed the case via pg so we can set validationDepositConfirmed=true
    // directly — the server stamps confirmedAt/By on PATCH, but direct insert
    // lets us skip Steps 1–4 UI interactions for this spec.
    const res = await pg.query<{ id: string }>(
      `INSERT INTO cases (access_code, user_name, user_email, status, validation_deposit_confirmed)
       VALUES ($1, $2, $3, 'active', true)
       RETURNING id`,
      [accessCode, "TWS Admin E2E", email],
    );
    caseId = res.rows[0].id;

    // Obtain a fresh admin token for API calls in the portal tests block.
    const api = await request.newContext({ baseURL });
    try {
      adminToken = await loginAdminApi(api);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (caseId) {
      const api = await request.newContext({ baseURL });
      try {
        const tok = adminToken || (await loginAdminApi(api));
        await deleteCase(api, tok, caseId);
      } finally {
        await api.dispose();
      }
    }
    await pg.end();
  });

  // ── Test 1: full Step 5 lifecycle ──────────────────────────────────────────

  test("admin can save URL+note, confirm, unconfirm, and unset the token wallet setup", async ({
    page,
  }) => {
    test.slow(); // allow extra time for admin dashboard compile + data load
    const t0 = Date.now();
    const log = (msg: string) =>
      console.log(`[t+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

    const adminToken = readAdminToken();

    // ── Open the case-detail dialog ──────────────────────────────────────────
    log("opening case dialog");
    await openCaseDialog(page, adminToken, accessCode, caseId);

    // ── Navigate to the "Paid" tab ───────────────────────────────────────────
    const paidTab = page.getByTestId("case-tab-paid");
    await expect(paidTab).toBeVisible({ timeout: 10_000 });
    await paidTab.click({ force: true });
    log("paid tab clicked");

    // Step 5 badge must start as "PENDING" (no link set yet).
    const badge = page.getByTestId("tws-status-badge");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveText("PENDING");
    log("initial badge confirmed PENDING");

    // ── STEP A: Enter URL + note, click "Send Setup Guide" ───────────────────
    const setupUrl = "https://example.com/wallet-setup-guide";
    const setupNote = "Follow these steps carefully.";

    await page.getByTestId("tws-link-input").fill(setupUrl);
    await page.getByTestId("tws-note-textarea").fill(setupNote);
    log("filled URL and note");

    // Intercept the PATCH so we can assert the payload.
    const patchSave = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res.url().includes(`/api/cases/${caseId}`) &&
        res.status() === 200,
    );

    await page.getByTestId("tws-save-button").click();
    log("Send Setup Guide clicked; waiting for PATCH");
    await patchSave;
    log("PATCH (save) complete");

    // Badge must remain PENDING — link saved, not yet confirmed.
    await expect(badge).toHaveText("PENDING");

    // DB must reflect the saved link and note.
    const savedRow = await pg.query<{
      token_wallet_setup_link: string;
      token_wallet_setup_note: string;
      token_wallet_setup_confirmed: boolean;
    }>(
      `SELECT token_wallet_setup_link, token_wallet_setup_note, token_wallet_setup_confirmed
       FROM cases WHERE id = $1`,
      [caseId],
    );
    expect(savedRow.rows[0].token_wallet_setup_link).toBe(setupUrl);
    expect(savedRow.rows[0].token_wallet_setup_note).toBe(setupNote);
    expect(savedRow.rows[0].token_wallet_setup_confirmed).toBe(false);
    log("DB link + note confirmed, confirmed=false");

    // ── STEP B: Click "Mark Wallet Set Up" ──────────────────────────────────
    const patchConfirm = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res.url().includes(`/api/cases/${caseId}`) &&
        res.status() === 200,
    );

    await expect(page.getByTestId("tws-confirm-button")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("tws-confirm-button").click();
    log("Mark Wallet Set Up clicked; waiting for PATCH");
    await patchConfirm;
    log("PATCH (confirm) complete");

    // Re-open the dialog to see the refreshed state from the server.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tws-status-badge")).toHaveCount(0, {
      timeout: 5_000,
    });
    log("dialog closed; re-opening");

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
    await page.getByTestId("case-tab-paid").click({ force: true });
    log("dialog re-opened on Paid tab");

    // Badge must now read "SET UP".
    await expect(page.getByTestId("tws-status-badge")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("tws-status-badge")).toHaveText("SET UP");
    log("badge confirmed SET UP");

    // ── STEP C: Unconfirm ────────────────────────────────────────────────────
    const patchUnconfirm = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res.url().includes(`/api/cases/${caseId}`) &&
        res.status() === 200,
    );

    await expect(page.getByTestId("tws-unconfirm-button")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("tws-unconfirm-button").click();
    log("Unconfirm clicked");
    await patchUnconfirm;
    log("PATCH (unconfirm) complete");

    // The badge should revert to PENDING after the data refresh.
    await expect(page.getByTestId("tws-status-badge")).toHaveText("PENDING", {
      timeout: 10_000,
    });
    log("badge confirmed PENDING after unconfirm");

    // ── STEP D: Unset ────────────────────────────────────────────────────────
    const patchUnset = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res.url().includes(`/api/cases/${caseId}`) &&
        res.status() === 200,
    );

    await expect(page.getByTestId("tws-unset-button")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("tws-unset-button").click();
    log("Unset clicked");
    await patchUnset;
    log("PATCH (unset) complete");

    // DB must show the link cleared.
    const unsetRow = await pg.query<{
      token_wallet_setup_link: string | null;
      token_wallet_setup_confirmed: boolean;
    }>(
      `SELECT token_wallet_setup_link, token_wallet_setup_confirmed FROM cases WHERE id = $1`,
      [caseId],
    );
    expect(unsetRow.rows[0].token_wallet_setup_link).toBeNull();
    expect(unsetRow.rows[0].token_wallet_setup_confirmed).toBe(false);
    log("DB confirmed link=null, confirmed=false after unset");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PORTAL TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Portal — Token Wallet Setup Card", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !DATABASE_URL) {
      throw new Error("ADMIN_USERNAME, ADMIN_PASSWORD, and DATABASE_URL must be set");
    }
  });

  const TEST_PIN = "482910";

  let pg: Client;
  let caseId: string;
  let accessCode: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    pg = new Client({ connectionString: DATABASE_URL });
    await pg.connect();

    await pg.query("DELETE FROM admin_login_attempts");

    accessCode = uniqueCode("TWS-PRT");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = await loginAdminApi(api);

      // Create the case.
      const created = await api.post("/api/cases", {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { accessCode, status: "active" },
      });
      expect(created.status(), "create portal test case").toBe(200);
      caseId = (await created.json()).id as string;

      // Set user metadata + validation deposit confirmed (server stamps At/By)
      // + the wallet setup link in one PATCH.
      const patched = await api.patch(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          userName: "TWS Portal E2E",
          userEmail: uniqueEmail(),
          status: "active",
          validationDepositConfirmed: true,
          tokenWalletSetupLink: "https://example.com/wallet-setup",
          tokenWalletSetupNote: "Portal E2E setup note",
        },
      });
      expect(patched.status(), "patch portal test case").toBe(200);

      // Enroll the test PIN.
      const pinRes = await api.post("/api/cases/set-pin", {
        data: { accessCode, pin: TEST_PIN },
      });
      expect(pinRes.status(), "enroll portal PIN").toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (caseId) {
      const api = await request.newContext({ baseURL });
      try {
        const tok = adminToken || (await loginAdminApi(api));
        await deleteCase(api, tok, caseId);
      } finally {
        await api.dispose();
      }
    }
    await pg.end();
  });

  // ── Test 5: violet "Action Required" card when link set, not yet confirmed ──

  test("card shows violet Action Required state when link is set but not confirmed", async ({
    page,
  }) => {
    // Ensure the case is in the unconfirmed state for this test.
    await pg.query(
      `UPDATE cases SET token_wallet_setup_confirmed = false WHERE id = $1`,
      [caseId],
    );

    await loginPortalUi(page, accessCode, TEST_PIN);

    // The card must be present (card renders when validationDepositConfirmed &&
    // tokenWalletSetupLink — both are true from beforeAll).
    const card = page.getByTestId("card-token-wallet-setup");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Violet "Action Required" header text must be visible.
    await expect(card.getByText("Action Required")).toBeVisible();
    await expect(card.getByText("Set Up Your Token Wallet")).toBeVisible();

    // The wallet setup guide link must point to our seeded URL.
    const setupLink = page.getByTestId("tws-card-setup-link");
    await expect(setupLink).toBeVisible();
    await expect(setupLink).toHaveAttribute(
      "href",
      "https://example.com/wallet-setup",
    );
  });

  // ── Test 6: emerald "Verified" banner once confirmed ─────────────────────

  test("card shows emerald Verified state when tokenWalletSetupConfirmed is true", async ({
    page,
    baseURL,
  }) => {
    // Confirm via the admin API so the server stamps confirmedAt/By.
    const api = await request.newContext({ baseURL });
    try {
      const res = await api.patch(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { tokenWalletSetupConfirmed: true },
      });
      expect(res.status(), "confirm tws via API").toBe(200);
    } finally {
      await api.dispose();
    }

    await loginPortalUi(page, accessCode, TEST_PIN);

    const card = page.getByTestId("card-token-wallet-setup");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Emerald "Verified" header must be present; the setup guide link must not.
    await expect(card.getByText("Verified")).toBeVisible();
    await expect(
      card.getByText("Token Wallet Set Up — Verified"),
    ).toBeVisible();
    await expect(page.getByTestId("tws-card-setup-link")).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITY TIMELINE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Portal — Activity Timeline — Token Wallet Setup Events", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !DATABASE_URL) {
      throw new Error("ADMIN_USERNAME, ADMIN_PASSWORD, and DATABASE_URL must be set");
    }
  });

  const TEST_PIN = "837461";

  let pg: Client;
  let caseId: string;
  let accessCode: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    pg = new Client({ connectionString: DATABASE_URL });
    await pg.connect();

    await pg.query("DELETE FROM admin_login_attempts");

    accessCode = uniqueCode("TWS-TL");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = await loginAdminApi(api);

      // Create a case and set validationDepositConfirmed + wallet setup link.
      const created = await api.post("/api/cases", {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { accessCode, status: "active" },
      });
      expect(created.status(), "create timeline test case").toBe(200);
      caseId = (await created.json()).id as string;

      const patched = await api.patch(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          userName: "TWS Timeline E2E",
          userEmail: uniqueEmail(),
          status: "active",
          validationDepositConfirmed: true,
          tokenWalletSetupLink: "https://example.com/wallet-setup-tl",
          tokenWalletSetupNote: "Timeline E2E setup note",
        },
      });
      expect(patched.status(), "patch timeline test case").toBe(200);

      // Enroll the test PIN.
      const pinRes = await api.post("/api/cases/set-pin", {
        data: { accessCode, pin: TEST_PIN },
      });
      expect(pinRes.status(), "enroll timeline PIN").toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (caseId) {
      const api = await request.newContext({ baseURL });
      try {
        const tok = adminToken || (await loginAdminApi(api));
        await deleteCase(api, tok, caseId);
      } finally {
        await api.dispose();
      }
    }
    await pg.end();
  });

  // ── Test: "confirmed" entry appears in the Activity Timeline ───────────────

  test("Activity Timeline shows token_wallet_setup_confirmed entry after admin confirms", async ({
    page,
    baseURL,
  }) => {
    // Confirm the token wallet setup via admin API. The server writes a
    // token_wallet_setup_confirmed audit log row which the wallet-events
    // endpoint surfaces to the portal timeline.
    const api = await request.newContext({ baseURL });
    try {
      const res = await api.patch(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { tokenWalletSetupConfirmed: true },
      });
      expect(res.status(), "confirm TWS via API").toBe(200);
    } finally {
      await api.dispose();
    }

    await loginPortalUi(page, accessCode, TEST_PIN);

    // Navigate to the Activity Timeline via the sidebar nav item.
    const timelineNav = page.getByTestId("nav-timeline");
    await expect(timelineNav).toBeVisible({ timeout: 15_000 });
    await timelineNav.click();

    // The "Token wallet setup confirmed" entry must be visible.
    await expect(
      page.getByText("Token wallet setup confirmed"),
    ).toBeVisible({ timeout: 15_000 });

    // The description line must also be visible.
    await expect(
      page.getByText("Your token wallet setup has been verified by compliance."),
    ).toBeVisible();
  });

  // ── Test: "unconfirmed" entry also appears after admin unconfirms ──────────

  test("Activity Timeline shows token_wallet_setup_unconfirmed entry after admin unconfirms", async ({
    page,
    baseURL,
  }) => {
    // This test is fully independent: it drives both the confirm and
    // unconfirm transitions via the admin API so the server writes both
    // audit rows. Direct DB mutations are deliberately avoided here because
    // they bypass the route that creates the audit log entries.
    const api = await request.newContext({ baseURL });
    try {
      // First, ensure the case is in the unconfirmed state at the DB level
      // so the confirm PATCH actually triggers a state transition (and thus
      // an audit row). We do this with a direct SQL reset because the case
      // may already be confirmed from a previous test run.
      await pg.query(
        `UPDATE cases SET token_wallet_setup_confirmed = false WHERE id = $1`,
        [caseId],
      );

      // Confirm via admin API → writes token_wallet_setup_confirmed audit row.
      const confirmRes = await api.patch(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { tokenWalletSetupConfirmed: true },
      });
      expect(confirmRes.status(), "confirm TWS via API").toBe(200);

      // Unconfirm via admin API → writes token_wallet_setup_unconfirmed audit row.
      const unconfirmRes = await api.patch(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { tokenWalletSetupConfirmed: false },
      });
      expect(unconfirmRes.status(), "unconfirm TWS via API").toBe(200);
    } finally {
      await api.dispose();
    }

    await loginPortalUi(page, accessCode, TEST_PIN);

    const timelineNav = page.getByTestId("nav-timeline");
    await expect(timelineNav).toBeVisible({ timeout: 15_000 });
    await timelineNav.click();

    // Both entries must be present: the confirmed row written above and the
    // unconfirmed row written immediately after.
    await expect(
      page.getByText("Token wallet setup confirmed"),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText("Token wallet setup unconfirmed"),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText("Your token wallet setup verification has been reversed."),
    ).toBeVisible();
  });
});
