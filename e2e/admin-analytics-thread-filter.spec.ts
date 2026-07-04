// Playwright e2e test verifying that the thread-picker dropdown in the
// Community Thread Views chart on the Analytics tab re-fetches with the correct
// query parameters and updates the total-views counter accordingly.
//
// Flow under test:
//   1. Obtain an admin bearer token via POST /api/admin/login.
//   2. Create a thread via the admin API.
//   3. Simulate 3 unique-IP views on the thread so the views-over-time window
//      has non-zero data for that thread.
//   4. Log into the admin dashboard by injecting the token into sessionStorage.
//   5. Navigate to the Analytics tab.
//   6. Wait for the views-total-counter to appear (initial "all threads" fetch done).
//   7. Record network requests to /api/admin/community/views-over-time.
//   8. Open the thread-filter-select and select the seeded thread.
//   9. Assert a request with ?threadId=<id> was fired.
//  10. Assert the views-total-counter re-renders (loading completes again).
//  11. Switch back to "All threads" and assert a request WITHOUT threadId is fired.
//  12. Clean up the seeded thread in a finally block.

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

function uniqueTitle(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

function uniqueIp(index: number): string {
  const a = (index % 254) + 1;
  return `203.0.113.${a}`;
}

async function fetchAdminToken(api: APIRequestContext): Promise<string> {
  const res = await api.post("/api/admin/login", {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (res.status() !== 200) return "";
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  return body.token ?? "";
}

async function createThread(
  api: APIRequestContext,
  adminToken: string,
  title: string,
): Promise<number> {
  const res = await api.post("/api/community/threads", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      title,
      content: "E2E thread-filter chart test — safe to delete.",
      authorHandle: "e2e-thread-filter-bot",
      authorType: "admin",
    },
  });
  expect(res.status(), `create thread "${title}"`).toBe(201);
  const body = await res.json();
  expect(typeof body.id).toBe("number");
  return body.id as number;
}

async function addViews(
  api: APIRequestContext,
  threadId: number,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await api.get(`/api/community/threads/${threadId}`, {
      headers: { "x-forwarded-for": uniqueIp(i) },
    });
  }
}

async function deleteThread(
  api: APIRequestContext,
  adminToken: string,
  threadId: number,
): Promise<void> {
  await api.delete(`/api/community/threads/${threadId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

test.describe("Admin Analytics — thread filter updates chart", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test("selecting a thread fires ?threadId=N and counter updates; switching to All threads re-fetches without threadId", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await fetchAdminToken(api);

    if (!adminToken) {
      test.skip(true, "Admin login failed — skipping thread-filter chart test");
      return;
    }

    const title = uniqueTitle("E2E-THREAD-FILTER");
    let threadId: number | null = null;

    try {
      // ---------------------------------------------------------------- seed
      threadId = await createThread(api, adminToken, title);

      // Add 3 unique-IP views so the views-over-time endpoint returns non-zero
      // data when this thread is selected.
      await addViews(api, threadId, 3);

      // ---------------------------------------- sign in to the admin UI
      await page.addInitScript((t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      }, adminToken);
      await page.goto("/admin");

      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // ----------------------------------------- navigate to Analytics tab
      await page.getByTestId("tab-analytics").click({ force: true });

      // Wait for the initial "all threads" fetch to complete: the counter
      // appears only when viewsLoading is false.
      const counter = page.getByTestId("views-total-counter");
      await expect(counter).toBeVisible({ timeout: 20_000 });

      // Capture the baseline counter value (all threads) before filtering.
      // The format is "{n} total views" where n may contain locale separators.
      const baselineText = (await counter.textContent()) ?? "";
      const baselineViews = parseInt(baselineText.replace(/\D/g, ""), 10);

      // Record all requests to the views-over-time endpoint from here on.
      const viewsRequests: string[] = [];
      page.on("request", (req) => {
        const url = req.url();
        if (url.includes("/api/admin/community/views-over-time")) {
          viewsRequests.push(url);
        }
      });

      // ----------------------------------------- open the thread-filter-select
      const filterTrigger = page.getByTestId("thread-filter-select");
      await expect(filterTrigger).toBeVisible({ timeout: 10_000 });
      await filterTrigger.click();

      // The seeded thread's title appears as a SelectItem option.
      // Use a partial text match since the title may be truncated at 48 chars.
      const threadOption = page.getByRole("option", {
        name: new RegExp(title.slice(0, 30), "i"),
      });
      await expect(threadOption).toBeVisible({ timeout: 10_000 });
      await threadOption.click();

      // -------------------- assert a request with ?threadId=N was fired
      await expect
        .poll(
          () =>
            viewsRequests.some((u) =>
              u.includes(`threadId=${threadId}`),
            ),
          {
            message: `Expected a request to views-over-time with threadId=${threadId}`,
            timeout: 10_000,
          },
        )
        .toBe(true);

      // -------------------- counter must reappear after the filtered fetch
      // and show the seeded thread's view count (exactly 3 unique-IP views).
      // The component renders "{n} total views" where n = sum of all hourly
      // view buckets for the selected thread over the 48-hour window.
      await expect(counter).toBeVisible({ timeout: 15_000 });
      const filteredText = (await counter.textContent()) ?? "";
      const filteredViews = parseInt(filteredText.replace(/\D/g, ""), 10);

      expect(
        filteredViews,
        `Filtered counter should show 3 views for the seeded thread (got "${filteredText}")`,
      ).toBe(3);

      // The filtered count must also differ from the all-threads baseline
      // (unless the baseline happened to be 3, which is an unlikely collision).
      // We only assert this when the baseline is unambiguously different.
      if (!Number.isNaN(baselineViews) && baselineViews !== 3) {
        expect(
          filteredViews,
          `Filtered counter (${filteredViews}) should differ from all-threads baseline (${baselineViews})`,
        ).not.toBe(baselineViews);
      }

      // -------------------- edge case: switch back to "All threads"
      const requestsBefore = viewsRequests.length;
      await filterTrigger.click();
      await page.getByRole("option", { name: /All threads/i }).click();

      // At least one new request without threadId must have been fired
      await expect
        .poll(
          () => {
            const newReqs = viewsRequests.slice(requestsBefore);
            return newReqs.some((u) => !u.includes("threadId="));
          },
          {
            message:
              'Expected a request to views-over-time WITHOUT threadId after selecting "All threads"',
            timeout: 10_000,
          },
        )
        .toBe(true);

      // Counter is visible again once the all-threads fetch completes.
      await expect(counter).toBeVisible({ timeout: 15_000 });
    } finally {
      if (threadId !== null) {
        await deleteThread(api, adminToken, threadId).catch(() => {});
      }
      await api.dispose();
    }
  });

  test("switching from 48 h to 24 h fires hours=24 and updates the chart title", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await fetchAdminToken(api);

    if (!adminToken) {
      test.skip(true, "Admin login failed — skipping hours-filter chart test");
      return;
    }

    try {
      // ---------------------------------------- sign in to the admin UI
      await page.addInitScript((t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      }, adminToken);
      await page.goto("/admin");

      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // ----------------------------------------- navigate to Analytics tab
      await page.getByTestId("tab-analytics").click({ force: true });

      // Wait for the initial 48 h fetch to finish — the counter appears only
      // when viewsLoading is false.
      const counter = page.getByTestId("views-total-counter");
      await expect(counter).toBeVisible({ timeout: 20_000 });

      // Start recording requests only after the initial fetch completes so we
      // don't conflate the 48 h baseline request with the 24 h one.
      const viewsRequests: string[] = [];
      page.on("request", (req) => {
        const url = req.url();
        if (url.includes("/api/admin/community/views-over-time")) {
          viewsRequests.push(url);
        }
      });

      // ----------------------------------------- open the hours-filter-select
      const hoursTrigger = page.getByTestId("hours-filter-select");
      await expect(hoursTrigger).toBeVisible({ timeout: 10_000 });
      await hoursTrigger.click();

      // Pick the "24 h" option from the dropdown.
      const option24h = page.getByRole("option", { name: /^24 h$/i });
      await expect(option24h).toBeVisible({ timeout: 10_000 });
      await option24h.click();

      // -------------------- assert a request with hours=24 was fired
      await expect
        .poll(
          () => viewsRequests.some((u) => u.includes("hours=24")),
          {
            message: "Expected a request to views-over-time with hours=24",
            timeout: 10_000,
          },
        )
        .toBe(true);

      // -------------------- assert the chart title updated to 24 h
      const chartTitle = page.getByTestId("views-chart-title");
      await expect(chartTitle).toHaveText("Community Thread Views (24 h)", {
        timeout: 10_000,
      });

      // -------------------- counter reappears once the 24 h fetch completes
      await expect(counter).toBeVisible({ timeout: 15_000 });
    } finally {
      await api.dispose();
    }
  });

  test("selecting a thread with zero recent views shows the empty-state placeholder and hides the counter", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await fetchAdminToken(api);

    if (!adminToken) {
      test.skip(true, "Admin login failed — skipping empty-state chart test");
      return;
    }

    const title = uniqueTitle("E2E-THREAD-EMPTY");
    let threadId: number | null = null;

    try {
      // Seed a thread with NO views so the views-over-time endpoint returns an
      // empty array when this thread is selected.
      threadId = await createThread(api, adminToken, title);

      // ---------------------------------------- sign in to the admin UI
      await page.addInitScript((t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      }, adminToken);
      await page.goto("/admin");

      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // ----------------------------------------- navigate to Analytics tab
      await page.getByTestId("tab-analytics").click({ force: true });

      // Wait for the initial "all threads" fetch to complete: the counter
      // appears only when viewsLoading is false AND viewsData is non-empty.
      // If the DB has zero total views the counter may never appear — so we
      // wait for the chart title instead as a reliable settled-UI signal.
      await expect(page.getByTestId("views-chart-title")).toBeVisible({
        timeout: 20_000,
      });

      // Record all requests to the views-over-time endpoint from here on.
      const viewsRequests: string[] = [];
      page.on("request", (req) => {
        const url = req.url();
        if (url.includes("/api/admin/community/views-over-time")) {
          viewsRequests.push(url);
        }
      });

      // ----------------------------------------- open the thread-filter-select
      const filterTrigger = page.getByTestId("thread-filter-select");
      await expect(filterTrigger).toBeVisible({ timeout: 10_000 });
      await filterTrigger.click();

      // The seeded (zero-views) thread must appear as a SelectItem option.
      const threadOption = page.getByRole("option", {
        name: new RegExp(title.slice(0, 30), "i"),
      });
      await expect(threadOption).toBeVisible({ timeout: 10_000 });
      await threadOption.click();

      // -------------------- a request with ?threadId=N must be fired
      await expect
        .poll(
          () =>
            viewsRequests.some((u) => u.includes(`threadId=${threadId}`)),
          {
            message: `Expected a request to views-over-time with threadId=${threadId}`,
            timeout: 10_000,
          },
        )
        .toBe(true);

      // -------------------- empty-state placeholder must be visible
      // The component renders this branch when viewsLoading is false and
      // viewsData.length === 0.
      const emptyPlaceholder = page.getByText(
        /No thread views recorded in the last 48 hours\./i,
      );
      await expect(emptyPlaceholder).toBeVisible({ timeout: 15_000 });

      // -------------------- views-total-counter must NOT be rendered
      // The component suppresses the counter for zero-view results so as not
      // to show a misleading "0 total views" badge alongside the empty state.
      const counter = page.getByTestId("views-total-counter");
      await expect(counter).not.toBeVisible();
    } finally {
      if (threadId !== null) {
        await deleteThread(api, adminToken, threadId).catch(() => {});
      }
      await api.dispose();
    }
  });
});
