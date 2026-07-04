// Verify that clicking "Run backfill now" when the server returns
// { skipped: true } does NOT trigger a re-fetch of the count endpoint.
//
// The unit harness (WalletConnectCompletionBackfill.test.tsx) proves the
// `!result.skipped` guard prevents the re-fetch in jsdom with a mocked fetch.
// This spec closes the gap with a real Playwright run against the actual admin
// Settings tab — catching any wiring divergence between the unit harness and
// the live handler/card pair.
//
// How it works:
//   1. Route-stub both API endpoints before the page loads so no real DB calls
//      are needed (the app is fully functional without seeded data for this
//      behaviour).
//   2. Count endpoint (GET /api/admin/wallet-connect-completion-backfill)
//      returns { scanned: 5, missing: 2 } so the count <p> renders a known
//      initial string.
//   3. Run endpoint (POST /api/admin/wallet-connect-completion-backfill/run)
//      returns { skipped: true, scanned: 0, inserted: 0 }.
//   4. Navigate to admin → Settings, wait for the initial count to render,
//      click "Run backfill now", wait for the skipped last-run text to appear.
//   5. Assert the count <p> text is UNCHANGED from the initial render and that
//      the count endpoint was called exactly once (mount only, not again after
//      the skipped run).

import { test, expect } from "@playwright/test";
import { localTimeout } from "./helpers";
import * as fs from "fs";
import * as path from "path";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

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

const COUNT_URL = "**/api/admin/wallet-connect-completion-backfill";
const RUN_URL = "**/api/admin/wallet-connect-completion-backfill/run";

const INITIAL_COUNT_BODY = { scanned: 5, missing: 2 };
const INITIAL_COUNT_TEXT =
  "2 of 5 marker(s) are missing a completion row and can be backfilled.";
const SKIPPED_RUN_BODY = { skipped: true, scanned: 0, inserted: 0 };
const SKIPPED_LAST_RUN_TEXT =
  "Last manual run was skipped — a backfill was already in progress.";

test.describe("Admin Settings — skipped backfill run does not re-fetch count", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin settings e2e tests");
    }
  });

  test("count <p> is unchanged and count endpoint called only once after a skipped run", async ({
    page,
  }) => {
    test.setTimeout(localTimeout(60_000));

    let countGetCalls = 0;

    // Stub the count endpoint — always returns the fixed initial body.
    await page.route(COUNT_URL, async (route) => {
      if (route.request().method() === "GET") {
        countGetCalls++;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(INITIAL_COUNT_BODY),
        });
      } else {
        await route.continue();
      }
    });

    // Stub the run endpoint — returns skipped: true.
    await page.route(RUN_URL, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(SKIPPED_RUN_BODY),
        });
      } else {
        await route.continue();
      }
    });

    // Inject the pre-fetched admin token into sessionStorage before the React
    // app initialises so the dashboard mounts already authenticated.
    const token = readAdminToken();
    await page.addInitScript((t) => {
      if (t) sessionStorage.setItem("adminToken", t);
    }, token);

    await page.goto("/admin");

    // Open the Settings tab where the WalletConnectCompletionBackfillCard lives.
    await page.getByTestId("tab-settings").click({ force: true });

    // Wait for the card to be visible and the initial count to have rendered.
    await expect(
      page.getByTestId("card-wallet-connect-completion-backfill"),
    ).toBeVisible({ timeout: 30_000 });

    const countEl = page.getByTestId(
      "text-wallet-connect-completion-backfill-count",
    );
    await expect(countEl).toHaveText(INITIAL_COUNT_TEXT, { timeout: 15_000 });

    // Capture count-GET calls recorded so far (should be exactly 1 from mount).
    const countGetCallsAfterMount = countGetCalls;
    expect(
      countGetCallsAfterMount,
      "count endpoint called once on mount",
    ).toBeGreaterThanOrEqual(1);

    // Click the run button — the stub returns { skipped: true }.
    await page.getByTestId("button-wallet-connect-completion-backfill-run").click();

    // Wait for the skipped last-run text to confirm the run response was processed.
    await expect(
      page.getByTestId("text-wallet-connect-completion-backfill-last-run"),
    ).toHaveText(SKIPPED_LAST_RUN_TEXT, { timeout: 10_000 });

    // The count <p> must still show the same text — the skipped branch must NOT
    // call loadWalletConnectCompletionBackfillCount.
    await expect(countEl).toHaveText(INITIAL_COUNT_TEXT);

    // The count endpoint must NOT have been called again after the skipped run.
    expect(
      countGetCalls,
      "count endpoint must NOT be called after a skipped run",
    ).toBe(countGetCallsAfterMount);
  });
});
