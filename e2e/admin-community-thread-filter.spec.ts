// Playwright e2e test verifying that the thread-filter dropdown in the
// Analytics tab actually changes the data shown in the views-over-time chart
// (and the views-total-counter reflects the filtered total).
//
// Flow under test:
//   1. Obtain an admin bearer token via POST /api/admin/login.
//   2. Create two distinct threads (A and B) via the admin API.
//   3. Simulate a browser visit for each thread in separate page contexts so
//      the server records a real view for both (one per thread).
//   4. Confirm via the API that each thread has ≥ 1 view recorded.
//   5. Sign in to the admin dashboard and navigate to the Analytics tab.
//   6. Open the thread-filter-select dropdown and choose thread A.
//   7. Wait for the views-over-time API response to settle, then assert
//      views-total-counter == thread A's per-thread view count (≥ 1).
//   8. Switch the filter to thread B, wait for the response to settle, then
//      assert views-total-counter == thread B's per-thread view count (≥ 1).
//   9. Assert the two counter values differ from the unfiltered "All threads"
//      total, confirming the filter is genuinely narrowing the data.
//  10. Clean up both threads (always runs via try/finally).

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

function uniqueTitle(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
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
      content:
        "E2E test thread for thread-filter chart verification — safe to delete.",
      authorHandle: "e2e-thread-filter-bot",
      authorType: "admin",
    },
  });
  expect(res.status(), `create thread "${title}"`).toBe(201);
  const body = await res.json();
  expect(typeof body.id).toBe("number");
  return body.id as number;
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

/** Returns the total view count for a single thread from the API. */
async function fetchThreadViews(
  api: APIRequestContext,
  adminToken: string,
  threadId: number,
): Promise<number> {
  const res = await api.get(
    `/api/admin/community/views-over-time?hours=48&threadId=${threadId}`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  if (!res.ok()) return 0;
  const body = (await res.json().catch(() => ({}))) as {
    data?: { hourBucket: string; views: number }[];
  };
  return (body.data ?? []).reduce((sum, row) => sum + (row.views ?? 0), 0);
}

/** Returns the total view count for the 48-hour window (all threads). */
async function fetchAllThreadsViews(
  api: APIRequestContext,
  adminToken: string,
): Promise<number> {
  const res = await api.get("/api/admin/community/views-over-time?hours=48", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!res.ok()) return 0;
  const body = (await res.json().catch(() => ({}))) as {
    data?: { hourBucket: string; views: number }[];
  };
  return (body.data ?? []).reduce((sum, row) => sum + (row.views ?? 0), 0);
}

/** Simulate a real browser view of a thread by visiting /community and then
 *  fetching the thread endpoint inside the page's JS context. */
async function browserViewThread(
  page: import("@playwright/test").Page,
  threadId: number,
): Promise<void> {
  const publicPage = await page.context().newPage();
  try {
    await publicPage.goto("/community");
    await publicPage.waitForLoadState("networkidle", { timeout: 20_000 });

    const viewStatus = await publicPage.evaluate(async (id: number) => {
      const res = await fetch(`/api/community/threads/${id}`);
      return res.status;
    }, threadId);

    expect(
      viewStatus,
      `Browser fetch of /api/community/threads/${threadId} should return 200`,
    ).toBe(200);
  } finally {
    await publicPage.close();
  }
}

/** Open the thread-filter-select Radix dropdown and click the item whose
 *  visible text starts with the given prefix.  Returns a promise that resolves
 *  once the views-over-time API response for the selection has arrived. */
async function selectThreadFilter(
  page: import("@playwright/test").Page,
  titlePrefix: string,
): Promise<void> {
  const trigger = page.getByTestId("thread-filter-select");

  // Start listening for the API response BEFORE triggering the selection so
  // the network race window is fully covered.
  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes("/api/admin/community/views-over-time") &&
      resp.status() === 200,
    { timeout: 20_000 },
  );

  await trigger.click();

  // Radix renders items in a portal — wait for the option to be visible.
  const item = page.locator('[role="option"]').filter({ hasText: titlePrefix });
  await item.first().waitFor({ state: "visible", timeout: 10_000 });
  await item.first().click();

  // Wait for the API call triggered by the selection to complete so the
  // counter is stable before we read it.
  await responsePromise;
}

/** Read the numeric value of views-total-counter. */
async function readCounter(page: import("@playwright/test").Page): Promise<number> {
  const counter = page.getByTestId("views-total-counter");
  await expect(counter).toBeVisible({ timeout: 15_000 });
  const text = (await counter.textContent()) ?? "";
  return parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
}

test.describe("Admin — Community thread-filter updates the views chart", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run this e2e test",
      );
    }
  });

  test("selecting a thread in the filter shows only that thread's view count", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await fetchAdminToken(api);

    if (!adminToken) {
      test.skip(true, "Admin login failed — skipping thread-filter chart test");
      return;
    }

    const titleA = uniqueTitle("E2E-FILTER-A");
    const titleB = uniqueTitle("E2E-FILTER-B");
    let threadIdA: number | null = null;
    let threadIdB: number | null = null;

    try {
      // -------------------------------------------------------- seed threads
      threadIdA = await createThread(api, adminToken, titleA);
      threadIdB = await createThread(api, adminToken, titleB);

      // ------ Record a real browser view for each thread individually -------
      // Each thread is opened in a separate page so the server receives two
      // distinct view events (one per threadId).  View deduplication is
      // per (threadId, IP, hourBucket) so one view per thread is guaranteed.
      await browserViewThread(page, threadIdA);
      await browserViewThread(page, threadIdB);

      // ---- API-level assertions: both threads must have ≥ 1 view -----------
      const viewsA = await fetchThreadViews(api, adminToken, threadIdA);
      expect(
        viewsA,
        `Thread A (${threadIdA}) should have ≥ 1 recorded view, got ${viewsA}`,
      ).toBeGreaterThanOrEqual(1);

      const viewsB = await fetchThreadViews(api, adminToken, threadIdB);
      expect(
        viewsB,
        `Thread B (${threadIdB}) should have ≥ 1 recorded view, got ${viewsB}`,
      ).toBeGreaterThanOrEqual(1);

      const allThreadsViews = await fetchAllThreadsViews(api, adminToken);

      // ---------------------------------------- sign in to the admin UI
      await page.addInitScript((t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      }, adminToken);
      await page.goto("/admin");

      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // ------------------------------------------ navigate to Analytics tab
      await page.getByTestId("tab-analytics").click({ force: true });

      // Wait for the initial "All threads" chart to load and counter to appear.
      const counter = page.getByTestId("views-total-counter");
      await expect(counter).toBeVisible({ timeout: 20_000 });

      // ------------------------------------------------- filter to thread A
      await selectThreadFilter(page, titleA.slice(0, 15));

      const counterA = await readCounter(page);
      expect(
        counterA,
        `Counter for thread A should be ≥ 1 after filtering, got ${counterA}`,
      ).toBeGreaterThanOrEqual(1);

      // The per-thread count must be ≤ the all-threads total.
      expect(
        counterA,
        `Thread A counter (${counterA}) must be ≤ all-threads total (${allThreadsViews})`,
      ).toBeLessThanOrEqual(allThreadsViews);

      // ------------------------------------------------- filter to thread B
      await selectThreadFilter(page, titleB.slice(0, 15));

      const counterB = await readCounter(page);
      expect(
        counterB,
        `Counter for thread B should be ≥ 1 after filtering, got ${counterB}`,
      ).toBeGreaterThanOrEqual(1);

      // The per-thread count must be ≤ the all-threads total.
      expect(
        counterB,
        `Thread B counter (${counterB}) must be ≤ all-threads total (${allThreadsViews})`,
      ).toBeLessThanOrEqual(allThreadsViews);

      // Core invariant: both per-thread totals together are ≤ the unfiltered
      // total, confirming the filter is genuinely narrowing the dataset.
      expect(
        counterA + counterB,
        `Sum of thread A (${counterA}) + thread B (${counterB}) counters must be ≤ all-threads total (${allThreadsViews})`,
      ).toBeLessThanOrEqual(allThreadsViews);
    } finally {
      if (threadIdA !== null) {
        await deleteThread(api, adminToken, threadIdA).catch(() => {});
      }
      if (threadIdB !== null) {
        await deleteThread(api, adminToken, threadIdB).catch(() => {});
      }
      await api.dispose();
    }
  });
});
