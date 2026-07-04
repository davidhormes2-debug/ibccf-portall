// Verify that clicking "Run backfill now" when the server returns
// { skipped: false, inserted: 2 } DOES trigger a re-fetch of the count
// endpoint, and that the count <p> updates to reflect the new value.
//
// This is the positive-branch counterpart to
// admin-backfill-skip-no-refetch.spec.ts, which verifies the negative path.
// The unit harness (WalletConnectCompletionBackfill.test.tsx) already covers
// this branch in jsdom; this Playwright spec closes the E2E ring and would
// catch any wiring divergence between the unit harness and the live
// handler/card pair.
//
// How it works:
//   1. Route-stub both API endpoints before the page loads so no real DB calls
//      are needed.
//   2. Count endpoint (GET /api/admin/wallet-connect-completion-backfill)
//      returns { scanned: 5, missing: 2 } on the first call, then
//      { scanned: 5, missing: 0 } on every subsequent call, simulating the
//      state after the backfill completes.
//   3. Run endpoint (POST /api/admin/wallet-connect-completion-backfill/run)
//      returns { skipped: false, inserted: 2, scanned: 5 }.
//   4. Navigate to admin → Settings, wait for the initial count to render,
//      click "Run backfill now", wait for the success last-run text to appear.
//   5. Assert the count <p> text has updated to the post-run value, proving
//      that loadWalletConnectCompletionBackfillCount was called again.
//   6. Assert the count endpoint was called at least twice (mount + post-run).

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

const PRE_RUN_COUNT_BODY = { scanned: 5, missing: 2 };
const POST_RUN_COUNT_BODY = { scanned: 5, missing: 0 };

const INITIAL_COUNT_TEXT =
  "2 of 5 marker(s) are missing a completion row and can be backfilled.";
const REFRESHED_COUNT_TEXT =
  "All completion rows are present (5 marker(s) scanned).";
const SUCCESS_RUN_BODY = { skipped: false, inserted: 2, scanned: 5 };
const SUCCESS_LAST_RUN_TEXT =
  "Last manual run inserted 2 missing completion row(s) out of 5 marker(s) scanned.";

test.describe("Admin Settings — successful backfill run re-fetches count", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin settings e2e tests");
    }
  });

  test("count <p> updates and count endpoint called at least twice after a successful run", async ({
    page,
  }) => {
    test.setTimeout(localTimeout(60_000));

    let countGetCalls = 0;

    // Stub the count endpoint — first call returns the pre-run body,
    // every subsequent call returns the post-run body.
    await page.route(COUNT_URL, async (route) => {
      if (route.request().method() === "GET") {
        countGetCalls++;
        const body =
          countGetCalls === 1 ? PRE_RUN_COUNT_BODY : POST_RUN_COUNT_BODY;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      } else {
        await route.continue();
      }
    });

    // Stub the run endpoint — returns skipped: false, inserted: 2.
    await page.route(RUN_URL, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(SUCCESS_RUN_BODY),
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

    // Click the run button — the stub returns { skipped: false, inserted: 2 }.
    await page.getByTestId("button-wallet-connect-completion-backfill-run").click();

    // Wait for the success last-run text to confirm the run response was processed.
    await expect(
      page.getByTestId("text-wallet-connect-completion-backfill-last-run"),
    ).toHaveText(SUCCESS_LAST_RUN_TEXT, { timeout: 10_000 });

    // The count <p> must have updated to the post-run value — the successful
    // (inserted > 0) branch MUST call loadWalletConnectCompletionBackfillCount.
    await expect(countEl).toHaveText(REFRESHED_COUNT_TEXT, {
      timeout: 10_000,
    });

    // The count endpoint must have been called at least once more after the run.
    expect(
      countGetCalls,
      "count endpoint must be called again after a successful run",
    ).toBeGreaterThan(countGetCallsAfterMount);
  });
});
