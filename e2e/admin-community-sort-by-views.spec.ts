// Task #638 — Playwright e2e test verifying the sort-by-views dropdown in the
// Community Management thread list correctly re-orders threads by descending
// view count.
//
// Flow under test:
//   1. Obtain an admin bearer token via POST /api/admin/login.
//   2. Create two threads via the admin API.
//   3. Simulate 25 unique-IP views on thread A and 3 unique-IP views on thread B
//      using distinct x-forwarded-for headers so the per-(IP, hour) dedup guard
//      counts each as a separate view — giving a clear ordering signal.
//   4. Log into the admin dashboard by injecting the token into sessionStorage.
//   5. Navigate to the Community tab.
//   6. Select "Most Viewed" from the sort dropdown (data-testid="select-sort-threads").
//   7. Assert thread A (25 views) appears above thread B (3 views) in the list.
//   8. Switch back to "Recent Activity" and confirm the request URL no longer
//      carries sortBy=views (verified via network interception).
//   9. Clean up seeded threads in a finally block.

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
  departmentId?: number,
): Promise<number> {
  const res = await api.post("/api/community/threads", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      title,
      content: "E2E sort-by-views test thread — safe to delete.",
      authorHandle: "e2e-sort-test-bot",
      authorType: "admin",
      ...(departmentId !== undefined ? { departmentId } : {}),
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
      headers: { "x-forwarded-for": `198.51.100.${i + 1}` },
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

interface DeptInfo { id: number; name: string }

async function fetchFirstTwoDepartments(
  api: APIRequestContext,
): Promise<[DeptInfo, DeptInfo] | null> {
  const res = await api.get("/api/departments");
  if (res.status() !== 200) return null;
  const body = (await res.json().catch(() => [])) as DeptInfo[];
  if (body.length < 2) return null;
  return [body[0], body[1]];
}

test.describe("Admin — Community sort-by-views dropdown", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test("selecting Most Viewed re-orders thread list by descending view count", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await fetchAdminToken(api);

    if (!adminToken) {
      test.skip(true, "Admin login failed — skipping sort-by-views test");
      return;
    }

    const titleA = uniqueTitle("E2E-SORT-A");
    const titleB = uniqueTitle("E2E-SORT-B");
    let threadAId: number | null = null;
    let threadBId: number | null = null;

    try {
      // ---------------------------------------------------------------- seed
      threadAId = await createThread(api, adminToken, titleA);
      threadBId = await createThread(api, adminToken, titleB);

      // Thread A gets 25 unique-IP views, thread B gets 3 — a clear margin.
      await addViews(api, threadAId, 25);
      await addViews(api, threadBId, 3);

      // ---------------------------------------- sign in to the admin UI
      await page.addInitScript((t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      }, adminToken);
      await page.goto("/admin");

      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // ------------------------------------------- navigate to Community tab
      await page.getByTestId("tab-community").click({ force: true });

      // Wait for the thread list to be visible before interacting with the sort
      // dropdown — the ScrollArea container holds the thread rows.
      await expect(page.getByTestId(`admin-thread-row-${threadAId}`)).toBeVisible({
        timeout: 15_000,
      });

      // -------------------- intercept threads requests to verify query params
      const viewsRequests: string[] = [];
      const recentRequests: string[] = [];

      page.on("request", (req) => {
        const url = req.url();
        if (!url.includes("/api/community/threads")) return;
        // Ignore sub-resource requests (thread detail fetches use /<id>)
        if (/\/api\/community\/threads\/\d+/.test(url)) return;
        if (url.includes("sortBy=views")) {
          viewsRequests.push(url);
        } else {
          recentRequests.push(url);
        }
      });

      // ---------------------------------------- select "Most Viewed"
      await page.getByTestId("select-sort-threads").click();
      await page.getByRole("option", { name: /Most Viewed/i }).click();

      // Wait for both seeded rows to be visible in the re-fetched list
      const rowA = page.getByTestId(`admin-thread-row-${threadAId}`);
      const rowB = page.getByTestId(`admin-thread-row-${threadBId}`);
      await expect(rowA).toBeVisible({ timeout: 15_000 });
      await expect(rowB).toBeVisible({ timeout: 15_000 });

      // At least one request with sortBy=views must have been made
      expect(
        viewsRequests.length,
        "selecting Most Viewed should fire a request with sortBy=views",
      ).toBeGreaterThan(0);

      // Assert thread A (25 views) appears above thread B (3 views)
      const [topA, topB] = await Promise.all([
        rowA.evaluate((el) => el.getBoundingClientRect().top),
        rowB.evaluate((el) => el.getBoundingClientRect().top),
      ]);
      expect(
        topA,
        "thread A (more views) should appear above thread B (fewer views) when sorted by Most Viewed",
      ).toBeLessThan(topB);

      // ---------------------------------------- switch back to "Recent Activity"
      const recentCountBefore = recentRequests.length;

      await page.getByTestId("select-sort-threads").click();
      await page.getByRole("option", { name: /Recent Activity/i }).click();

      // Wait for the list to re-render (rows still present)
      await expect(rowA).toBeVisible({ timeout: 15_000 });

      // A new request without sortBy=views must have been fired
      expect(
        recentRequests.length,
        "switching back to Recent Activity should fire a request without sortBy=views",
      ).toBeGreaterThan(recentCountBefore);
    } finally {
      if (threadAId !== null) {
        await deleteThread(api, adminToken, threadAId).catch(() => {});
      }
      if (threadBId !== null) {
        await deleteThread(api, adminToken, threadBId).catch(() => {});
      }
      await api.dispose();
    }
  });

  test("department filter + Most Viewed together show only that department's threads in view-count order", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await fetchAdminToken(api);

    if (!adminToken) {
      test.skip(true, "Admin login failed — skipping department-filter + sort-by-views test");
      return;
    }

    // We need at least two departments to run this test
    const depts = await fetchFirstTwoDepartments(api);
    if (!depts) {
      test.skip(true, "Fewer than two departments found — skipping department-filter + sort-by-views test");
      return;
    }

    const [deptA, deptB] = depts;

    // deptA threads: high-view (20) and low-view (2) — both must appear when filtering to deptA
    // deptB thread: medium-view (10) — must NOT appear when filtering to deptA
    const titleHigh  = uniqueTitle("E2E-DEPTFILTER-HIGH");
    const titleLow   = uniqueTitle("E2E-DEPTFILTER-LOW");
    const titleOther = uniqueTitle("E2E-DEPTFILTER-OTHER");

    let threadHighId:  number | null = null;
    let threadLowId:   number | null = null;
    let threadOtherId: number | null = null;

    try {
      // -------------------------------------------------------------- seed
      threadHighId  = await createThread(api, adminToken, titleHigh,  deptA.id);
      threadLowId   = await createThread(api, adminToken, titleLow,   deptA.id);
      threadOtherId = await createThread(api, adminToken, titleOther, deptB.id);

      await addViews(api, threadHighId,  20);
      await addViews(api, threadLowId,    2);
      await addViews(api, threadOtherId, 10); // intentionally between the two deptA counts

      // -------------------------------------------------- sign in to admin UI
      await page.addInitScript((t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      }, adminToken);
      await page.goto("/admin");

      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // ----------------------------------------------- navigate to Community
      await page.getByTestId("tab-community").click({ force: true });

      await expect(page.getByTestId(`admin-thread-row-${threadHighId}`)).toBeVisible({
        timeout: 15_000,
      });

      // -------------------------------------- select deptA from the dept filter
      const deptFilterTrigger = page.getByTestId("select-department-filter");
      await deptFilterTrigger.click();
      // Options render department names as text (SelectItem value is the ID string,
      // but the visible label is dept.name).
      await page.getByRole("option", { name: deptA.name }).click();

      // Wait for the list to update — the high-view deptA thread should still be visible
      await expect(page.getByTestId(`admin-thread-row-${threadHighId}`)).toBeVisible({
        timeout: 15_000,
      });

      // ----------------------------------------- select "Most Viewed" sort order
      await page.getByTestId("select-sort-threads").click();
      await page.getByRole("option", { name: /Most Viewed/i }).click();

      const rowHigh  = page.getByTestId(`admin-thread-row-${threadHighId}`);
      const rowLow   = page.getByTestId(`admin-thread-row-${threadLowId}`);
      const rowOther = page.getByTestId(`admin-thread-row-${threadOtherId}`);

      await expect(rowHigh).toBeVisible({ timeout: 15_000 });
      await expect(rowLow).toBeVisible({ timeout: 15_000 });

      // The deptB thread must NOT be visible when deptA is selected
      await expect(rowOther).not.toBeVisible();

      // deptA high-view thread must appear above deptA low-view thread
      const [topHigh, topLow] = await Promise.all([
        rowHigh.evaluate((el) => el.getBoundingClientRect().top),
        rowLow.evaluate((el) => el.getBoundingClientRect().top),
      ]);
      expect(
        topHigh,
        "high-view deptA thread should appear above low-view deptA thread when sorted by Most Viewed",
      ).toBeLessThan(topLow);
    } finally {
      if (threadHighId  !== null) await deleteThread(api, adminToken, threadHighId).catch(() => {});
      if (threadLowId   !== null) await deleteThread(api, adminToken, threadLowId).catch(() => {});
      if (threadOtherId !== null) await deleteThread(api, adminToken, threadOtherId).catch(() => {});
      await api.dispose();
    }
  });

  test("switching from a specific department back to All Departments re-shows threads from every department", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await fetchAdminToken(api);

    if (!adminToken) {
      test.skip(true, "Admin login failed — skipping department-filter reset test");
      return;
    }

    // We need at least two departments to verify cross-department visibility
    const depts = await fetchFirstTwoDepartments(api);
    if (!depts) {
      test.skip(true, "Fewer than two departments found — skipping department-filter reset test");
      return;
    }

    const [deptA, deptB] = depts;

    const titleA = uniqueTitle("E2E-DEPTRESET-A");
    const titleB = uniqueTitle("E2E-DEPTRESET-B");

    let threadAId: number | null = null;
    let threadBId: number | null = null;

    try {
      // ------------------------------------------------------------ seed
      // One thread in each of the two departments
      threadAId = await createThread(api, adminToken, titleA, deptA.id);
      threadBId = await createThread(api, adminToken, titleB, deptB.id);

      // ------------------------------------------ sign in to the admin UI
      await page.addInitScript((t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      }, adminToken);
      await page.goto("/admin");

      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // ----------------------------------------------- navigate to Community
      await page.getByTestId("tab-community").click({ force: true });

      // Wait until both seeded threads are visible in the unfiltered list
      await expect(page.getByTestId(`admin-thread-row-${threadAId}`)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId(`admin-thread-row-${threadBId}`)).toBeVisible({
        timeout: 15_000,
      });

      // --------------------------------- select deptA from the department filter
      const deptFilterTrigger = page.getByTestId("select-department-filter");
      await deptFilterTrigger.click();
      await page.getByRole("option", { name: deptA.name }).click();

      // After filtering to deptA, thread A should be visible and thread B should not
      await expect(page.getByTestId(`admin-thread-row-${threadAId}`)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId(`admin-thread-row-${threadBId}`)).not.toBeVisible();

      // --------------------------------- reset to "All Departments"
      await deptFilterTrigger.click();
      await page.getByRole("option", { name: /All Departments/i }).click();

      // After resetting, threads from both departments must reappear
      await expect(page.getByTestId(`admin-thread-row-${threadAId}`)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId(`admin-thread-row-${threadBId}`)).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      if (threadAId !== null) await deleteThread(api, adminToken, threadAId).catch(() => {});
      if (threadBId !== null) await deleteThread(api, adminToken, threadBId).catch(() => {});
      await api.dispose();
    }
  });
});
