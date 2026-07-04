import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import {
  uniqueAccessCode,
  uniqueEmail,
  clearAdminRateLimit,
  issuePortalSession,
  loginAdminApi,
} from "./helpers";

async function setPin(
  api: APIRequestContext,
  accessCode: string,
  pin: string,
): Promise<void> {
  await issuePortalSession(api, accessCode, pin);
}

// Task #505 — Verify that wallet-exchange selection and phrase-reveal events
// written to the audit log by the server appear in the portal Activity Timeline.
//
// HOW EVENTS FLOW TO THE TIMELINE
// ─────────────────────────────────────────────────────────────────────────────
// 1. User completes Step 1 (wallet picker) → POST /api/cases/:id/wallet-exchange
//    → server writes audit row with action = "wallet_exchange_selected"
//
// 2. User completes Step 2 (phrase reveal) → GET /api/cases/:id/wallet-phrase
//    → fire-and-forget maybeAlertOnWalletConnect() writes audit row with
//    action = "wallet_connect_completed"
//
// 3. TimelineView fetches GET /api/cases/:id/wallet-events which returns those
//    two actions from the audit log.  Each event is rendered as:
//      data-testid="timeline-item-wallet-{action}-{observedAt}"
//
// NOTE ON NAMING
// ─────────────────────────────────────────────────────────────────────────────
// The task description refers to "wallet_phrase_revealed" as the Step-2 event,
// but the server's audit action (and therefore the rendered test-id) is
// "wallet_connect_completed".  These tests assert the IDs that the live code
// produces: wallet_exchange_selected and wallet_connect_completed.
//
// TESTID MATCHING STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// The full testid includes an ISO timestamp that is not known in advance, so
// tests use the CSS attribute prefix selector:
//   [data-testid^="timeline-item-wallet-wallet_exchange_selected-"]
//   [data-testid^="timeline-item-wallet-wallet_connect_completed-"]

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

// A short 10-word mnemonic phrase — server only checks it is non-empty.
const TEST_PHRASE =
  "abandon ability able about above absent absorb abstract absurd abuse";

async function createWalletCase(
  api: APIRequestContext,
  adminToken: string,
  accessCode: string,
): Promise<string> {
  const created = await api.post("/api/cases", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { accessCode, status: "active" },
  });
  expect(created.status(), "create case").toBe(200);
  const caseId = (await created.json()).id as string;

  const patched = await api.patch(`/api/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      userName: "Wallet Timeline E2E",
      userEmail: uniqueEmail(),
      status: "active",
      walletPhraseEnabled: true,
      walletPhraseCode: TEST_PHRASE,
    },
  });
  expect(patched.status(), "patch case with wallet").toBe(200);
  return caseId;
}

/** Log into the portal via the UI access-code + PIN flow. */
async function loginPortalUi(
  page: import("@playwright/test").Page,
  accessCode: string,
  pin: string,
): Promise<void> {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByTestId("input-access-code").fill(accessCode);
  await page.getByTestId("button-login").click();

  const pinInput = page.getByTestId("input-pin");
  await expect(pinInput).toBeVisible({ timeout: 10_000 });
  await pinInput.fill(pin);
  await page.getByTestId("button-login").click();

  // Login form must be gone before proceeding.
  await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
    timeout: 15_000,
  });
  // walletConnect nav item only appears when walletPhraseEnabled is true.
  await expect(page.getByTestId("nav-walletConnect")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("Portal — Wallet events appear in Activity Timeline", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the wallet timeline e2e tests");
    }
  });

  // Shared admin token — obtained once before all tests to avoid exhausting
  // the persistent admin login rate limiter (5 attempts per 15-minute window).
  let sharedAdminToken = "";

  test.beforeAll(async () => {
    // Clear any leftover admin-login-attempt rows from previous runs so the
    // rate limiter doesn't block the single login we issue below.
    await clearAdminRateLimit(DATABASE_URL);

    const api = await request.newContext();
    sharedAdminToken = await loginAdminApi(api);
    await api.dispose();
  });

  // -------------------------------------------------------------------------
  // Test 1: Step 1 (wallet selection) creates a wallet_exchange_selected entry
  // -------------------------------------------------------------------------
  test("wallet_exchange_selected entry is visible in the timeline after Step 1", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode();
    const pin = "246810";
    await createWalletCase(api, sharedAdminToken, accessCode);
    await setPin(api, accessCode, pin);

    await loginPortalUi(page, accessCode, pin);

    // ---- Step 1: select a wallet and submit ----
    await page.getByTestId("nav-walletConnect").click();
    await expect(page.getByTestId("step-indicator-1")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("wallet-option-trust").click();
    await page.getByTestId("button-wallet-continue").click();

    // Step 2 becomes active after a successful wallet selection.
    await expect(page.getByTestId("button-reveal-phrase")).toBeVisible({
      timeout: 10_000,
    });

    // ---- Activity Timeline ----
    await page.getByTestId("nav-timeline").click();

    // The full testid includes the ISO timestamp so we match by prefix.
    // The Step-1 audit action is "wallet_exchange_selected".
    const exchangeEntry = page.locator(
      '[data-testid^="timeline-item-wallet-wallet_exchange_selected-"]',
    );
    await expect(exchangeEntry).toBeVisible({ timeout: 15_000 });

    await api.dispose();
  });

  // -------------------------------------------------------------------------
  // Test 2: Step 2 (phrase reveal) creates a wallet_connect_completed entry
  //
  // The server records the phrase-reveal event as "wallet_connect_completed"
  // (emitted by maybeAlertOnWalletConnect inside GET /wallet-phrase).
  // TimelineView maps this action to the "phrase revealed" label in the UI,
  // and the data-testid reflects the raw audit action name.
  // -------------------------------------------------------------------------
  test("wallet_connect_completed (phrase reveal) entry is visible in the timeline after Step 2", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode();
    const pin = "135791";
    await createWalletCase(api, sharedAdminToken, accessCode);
    await setPin(api, accessCode, pin);

    await loginPortalUi(page, accessCode, pin);

    // ---- Step 1 ----
    await page.getByTestId("nav-walletConnect").click();
    await expect(page.getByTestId("step-indicator-1")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("wallet-option-cryptocom").click();
    await page.getByTestId("button-wallet-continue").click();

    // ---- Step 2: reveal the recovery phrase ----
    // Clicking Reveal triggers GET /api/cases/:id/wallet-phrase, which fires
    // maybeAlertOnWalletConnect() to write the "wallet_connect_completed" audit row.
    await expect(page.getByTestId("button-reveal-phrase")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("button-reveal-phrase").click();

    // Phrase grid must appear to confirm the fetch succeeded.
    await expect(page.getByTestId("phrase-grid")).toBeVisible({
      timeout: 15_000,
    });

    // ---- Activity Timeline ----
    await page.getByTestId("nav-timeline").click();

    // Step-2 event: "wallet_connect_completed" audit action (phrase reveal).
    const phraseEntry = page.locator(
      '[data-testid^="timeline-item-wallet-wallet_connect_completed-"]',
    );
    await expect(phraseEntry).toBeVisible({ timeout: 15_000 });

    // Step-1 event must also be present.
    const exchangeEntry = page.locator(
      '[data-testid^="timeline-item-wallet-wallet_exchange_selected-"]',
    );
    await expect(exchangeEntry).toBeVisible({ timeout: 10_000 });

    await api.dispose();
  });

  // -------------------------------------------------------------------------
  // Test 3: Non-English locale (Spanish) — i18n strings from the portal
  // namespace must render in Spanish AND both timeline entries must appear.
  //
  // Spanish translations verified here:
  //   • Timeline heading: "Cronología de Actividades"
  //     (portal:status.timeline.title)
  //   • Wallet exchange entry title: "Billetera seleccionada: SafePal Wallet"
  //     (portal:status.timeline.walletExchangeSelected)
  //   • Phrase reveal entry title:   "Frase de billetera revelada"
  //     (portal:status.timeline.walletPhraseRevealed)
  // -------------------------------------------------------------------------
  test("both wallet timeline entries render in Spanish when the portal locale is Spanish", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });

    const accessCode = uniqueAccessCode();
    const pin = "998877";
    await createWalletCase(api, sharedAdminToken, accessCode);
    await setPin(api, accessCode, pin);

    // Inject the Spanish locale then reload so i18n picks it up before login.
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("ibccf.locale", "es");
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    // Log in with the Spanish locale active.
    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();
    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible({ timeout: 10_000 });
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();
    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("nav-walletConnect")).toBeVisible({
      timeout: 15_000,
    });

    // ---- Step 1: pick SafePal wallet ----
    await page.getByTestId("nav-walletConnect").click();
    await expect(page.getByTestId("step-indicator-1")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("wallet-option-safepal").click();
    await page.getByTestId("button-wallet-continue").click();

    // ---- Step 2: reveal phrase ----
    await expect(page.getByTestId("button-reveal-phrase")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("button-reveal-phrase").click();
    await expect(page.getByTestId("phrase-grid")).toBeVisible({
      timeout: 15_000,
    });

    // ---- Activity Timeline ----
    await page.getByTestId("nav-timeline").click();

    // Confirm the Timeline page heading renders in Spanish from the portal namespace.
    // portal:status.timeline.title → "Cronología de Actividades"
    // Use getByRole to disambiguate from the nav item that shows the same string.
    await expect(
      page.getByRole("heading", { name: "Cronología de Actividades" }),
    ).toBeVisible({ timeout: 10_000 });

    // Timeline entries must be present by data-testid.
    const exchangeEntry = page.locator(
      '[data-testid^="timeline-item-wallet-wallet_exchange_selected-"]',
    );
    await expect(exchangeEntry).toBeVisible({ timeout: 15_000 });

    const phraseEntry = page.locator(
      '[data-testid^="timeline-item-wallet-wallet_connect_completed-"]',
    );
    await expect(phraseEntry).toBeVisible({ timeout: 15_000 });

    // Entry titles must render in Spanish from the portal namespace.
    // wallet_exchange_selected → portal:status.timeline.walletExchangeSelected
    //   = "Billetera seleccionada: {{wallet}}" → "Billetera seleccionada: SafePal Wallet"
    await expect(
      page.getByText("Billetera seleccionada: SafePal Wallet"),
    ).toBeVisible({ timeout: 10_000 });

    // wallet_connect_completed  → portal:status.timeline.walletPhraseRevealed
    //   = "Frase de billetera revelada"
    await expect(
      page.getByText("Frase de billetera revelada"),
    ).toBeVisible({ timeout: 10_000 });

    // Confirm the locale persisted across the session.
    const storedLocale = await page.evaluate(() =>
      localStorage.getItem("ibccf.locale"),
    );
    expect(storedLocale).toBe("es");

    await api.dispose();
  });
});
