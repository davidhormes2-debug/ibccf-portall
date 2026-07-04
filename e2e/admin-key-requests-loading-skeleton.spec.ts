// Regression guard: the loading skeleton in KeyRequestsManagement must appear
// while the /api/access-key-requests/admin/list fetch is in flight and must
// be replaced by real content once the fetch resolves.
//
// What this spec covers:
//
//   1. While the list fetch is delayed, the skeleton
//      (aria-label="Loading key requests…") must be visible and neither the
//      data table nor the empty-state card must be present.
//
//   2. Once the fetch resolves, the skeleton must disappear and either the
//      data table or the "No Requests Found" empty-state heading must be
//      visible — never both at the same time as the skeleton.
//
//   3. Switching filter tabs (e.g. Pending → Approved) triggers a new fetch
//      cycle: the skeleton must reappear during the second fetch and then
//      vanish once it settles.
//
//   4. When the list endpoint returns a non-OK status (e.g. 500), the skeleton
//      must disappear and the component must render a visible error notice
//      ("Failed to load requests") rather than the blank empty-state.
//
//   5. When the user switches filter tabs and *that* subsequent fetch returns a
//      non-OK status (e.g. 500), the same error banner must appear and the
//      blank empty-state must not be visible — locking in that the shared
//      fetchRequests path surfaces errors on tab-switch fetches too.
//
// To make the in-flight state reliably observable we intercept the list
// endpoint and delay its response by 600 ms — long enough for Playwright to
// snapshot the DOM while the skeleton is still mounted.  We also fulfill the
// response with a static empty-array payload so the test outcome is
// deterministic regardless of real database contents.
//
// Relevant source:
//   - client/src/components/admin/KeyRequestsManagement.tsx

import { test, expect } from "@playwright/test";
import { localTimeout } from "./helpers";
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

async function loginAdminUi(page: import("@playwright/test").Page) {
  const token = readAdminToken();
  await page.addInitScript(
    (t) => { if (t) sessionStorage.setItem("adminToken", t); },
    token,
  );
  await page.goto("/admin");
  await expect(page.getByTestId("admin-data-ready")).toBeAttached({
    timeout: 60_000,
  });
}

test.describe("KeyRequestsManagement — loading skeleton regression", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test.beforeEach(() => {
    test.setTimeout(localTimeout(120_000));
  });

  test("skeleton is visible while the list fetch is in flight and disappears once it resolves", async ({
    page,
  }) => {
    await loginAdminUi(page);

    // Intercept the list endpoint BEFORE clicking the tab so the delay is
    // already active when the component mounts and fires its first fetch.
    await page.route(
      "**/api/access-key-requests/admin/list*",
      async (route) => {
        await new Promise((r) => setTimeout(r, 600));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    // Navigate to the key-requests tab.
    const tabTrigger = page.getByTestId("tab-key-requests");
    await expect(tabTrigger).toBeVisible({ timeout: 15_000 });
    await tabTrigger.click();

    // ── Assert skeleton is visible WHILE the fetch is still in flight ────
    const skeleton = page.getByLabel("Loading key requests…");
    await expect(skeleton).toBeVisible({ timeout: 3_000 });

    // Neither the data table nor the empty-state heading must exist yet.
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "No Requests Found" }),
    ).toHaveCount(0);

    // ── Wait for the fetch to settle then assert steady-state ────────────
    await expect(
      page.getByRole("heading", { name: "No Requests Found" }),
    ).toBeVisible({ timeout: 10_000 });

    // Skeleton must be gone once real content is shown.
    await expect(skeleton).toHaveCount(0);

    // Verify skeleton and the empty-state content are not simultaneously visible.
    const skeletonCount = await skeleton.count();
    const emptyHeadingCount = await page
      .getByRole("heading", { name: "No Requests Found" })
      .count();
    expect(
      skeletonCount === 0 && emptyHeadingCount === 1,
      "skeleton and empty-state heading must not be visible at the same time",
    ).toBe(true);
  });

  test("switching filter tabs re-shows the skeleton then the real content", async ({
    page,
  }) => {
    await loginAdminUi(page);

    // First tab click — no artificial delay, just confirm the component loads.
    await page.route(
      "**/api/access-key-requests/admin/list*",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    const tabTrigger = page.getByTestId("tab-key-requests");
    await expect(tabTrigger).toBeVisible({ timeout: 15_000 });
    await tabTrigger.click();

    await expect(
      page.getByRole("heading", { name: "No Requests Found" }),
    ).toBeVisible({ timeout: 10_000 });

    // Remove the fast handler; install a slow one for the second fetch.
    await page.unroute("**/api/access-key-requests/admin/list*");
    await page.route(
      "**/api/access-key-requests/admin/list*",
      async (route) => {
        await new Promise((r) => setTimeout(r, 600));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    // Switch to the "Approved" filter tab — this should trigger a new fetch.
    await page.getByTestId("filter-approved").click();

    // Skeleton must reappear during the new in-flight fetch.
    const skeleton = page.getByLabel("Loading key requests…");
    await expect(skeleton).toBeVisible({ timeout: 3_000 });
    await expect(
      page.getByRole("heading", { name: "No Requests Found" }),
    ).toHaveCount(0);

    // After the fetch settles, skeleton disappears and empty-state returns.
    await expect(
      page.getByRole("heading", { name: "No Requests Found" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(skeleton).toHaveCount(0);
  });

  test("switching filter tabs then 500: error banner appears and empty-state is absent", async ({
    page,
  }) => {
    await loginAdminUi(page);

    // First fetch — succeed so the component settles into a normal idle state.
    await page.route(
      "**/api/access-key-requests/admin/list*",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    const tabTrigger = page.getByTestId("tab-key-requests");
    await expect(tabTrigger).toBeVisible({ timeout: 15_000 });
    await tabTrigger.click();

    // Confirm the component has settled (empty-state visible, no error).
    await expect(
      page.getByRole("heading", { name: "No Requests Found" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("key-requests-error")).toHaveCount(0);

    // Replace the handler with one that returns 500 for the next fetch.
    await page.unroute("**/api/access-key-requests/admin/list*");
    await page.route(
      "**/api/access-key-requests/admin/list*",
      async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal Server Error" }),
        });
      },
    );

    // Switch to the "Approved" filter tab — triggers a new fetch that will 500.
    await page.getByTestId("filter-approved").click();

    // Skeleton must disappear once the failed response arrives.
    const skeleton = page.getByLabel("Loading key requests…");
    await expect(skeleton).toHaveCount(0, { timeout: 10_000 });

    // The error banner must be visible.
    await expect(
      page.getByTestId("key-requests-error"),
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByRole("heading", { name: "Failed to load requests" }),
    ).toBeVisible();

    // The blank empty-state must NOT be shown when the fetch failed.
    await expect(
      page.getByRole("heading", { name: "No Requests Found" }),
    ).toHaveCount(0);
  });

  test("error on tab A → switch to tab B → switch back to tab A → fresh fetch succeeds", async ({
    page,
  }) => {
    await loginAdminUi(page);

    // First: make the Approved tab fetch return a 500.
    await page.route(
      "**/api/access-key-requests/admin/list*",
      async (route) => {
        const url = route.request().url();
        if (url.includes("status=approved")) {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Internal Server Error" }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([]),
          });
        }
      },
    );

    // Navigate to the key-requests tab.
    const tabTrigger = page.getByTestId("tab-key-requests");
    await expect(tabTrigger).toBeVisible({ timeout: 15_000 });
    await tabTrigger.click();

    // Confirm the initial (Pending) tab has settled successfully.
    await expect(
      page.getByRole("heading", { name: "No Requests Found" }),
    ).toBeVisible({ timeout: 10_000 });

    // Switch to the Approved tab — this fetch will 500.
    await page.getByTestId("filter-approved").click();

    // The error banner must appear.
    await expect(
      page.getByTestId("key-requests-error"),
    ).toBeVisible({ timeout: 10_000 });

    // Switch to Pending (tab B) — fetch succeeds.
    await page.getByTestId("filter-pending").click();
    await expect(
      page.getByRole("heading", { name: "No Requests Found" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("key-requests-error")).toHaveCount(0);

    // Now update the route handler so that the Approved tab fetch succeeds this time.
    await page.unroute("**/api/access-key-requests/admin/list*");
    await page.route(
      "**/api/access-key-requests/admin/list*",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    // Switch BACK to Approved (tab A) — the previously-failed tab.
    // This should trigger a fresh fetch and clear the error banner.
    await page.getByTestId("filter-approved").click();

    // Skeleton must appear while the fetch is in flight (or resolve quickly).
    // Error banner must NOT appear — the fresh fetch succeeds.
    await expect(
      page.getByRole("heading", { name: "No Requests Found" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("key-requests-error")).toHaveCount(0);
  });

  test("API error response: skeleton disappears and component does not crash", async ({
    page,
  }) => {
    await loginAdminUi(page);

    // Intercept the list endpoint and return a server error before clicking the
    // tab, so the very first fetch from the component mount is the failing one.
    await page.route(
      "**/api/access-key-requests/admin/list*",
      async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal Server Error" }),
        });
      },
    );

    // Navigate to the key-requests tab.
    const tabTrigger = page.getByTestId("tab-key-requests");
    await expect(tabTrigger).toBeVisible({ timeout: 15_000 });
    await tabTrigger.click();

    const skeleton = page.getByLabel("Loading key requests…");

    // Skeleton must eventually disappear — the component must not hang with an
    // infinite spinner after a non-OK response.
    await expect(skeleton).toHaveCount(0, { timeout: 10_000 });

    // The component must render a visible error notice — not the blank
    // empty-state heading and not a missing subtree.
    await expect(
      page.getByTestId("key-requests-error"),
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByRole("heading", { name: "Failed to load requests" }),
    ).toBeVisible();

    // The blank empty-state must NOT be shown when the fetch failed.
    await expect(
      page.getByRole("heading", { name: "No Requests Found" }),
    ).toHaveCount(0);
  });
});
