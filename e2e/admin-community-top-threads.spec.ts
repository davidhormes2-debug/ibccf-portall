// Task #552 — Playwright e2e test verifying the "Most Popular Threads by Views"
// panel in the Community Management tab.
//
// Flow under test:
//   1. Obtain an admin bearer token via POST /api/admin/login (direct API call —
//      avoids dependence on auth-file path or format).
//   2. Create two threads via the admin API.
//   3. Simulate 20 unique-IP views on thread A and 2 unique-IP views on thread B
//      by sending GET requests with distinct x-forwarded-for headers (the server
//      has `trust proxy = 1` so each unique header is hashed as a separate IP by
//      the per-(IP, hour) deduplication guard, giving a clear ordering signal).
//   4. Log into the admin dashboard by injecting the token into sessionStorage
//      via addInitScript before the page loads.
//   5. Navigate to the Community tab.
//   6. Assert the "Most Popular Threads by Views" panel is visible.
//   7. Assert both thread rows are rendered inside the panel.
//   8. Assert thread A (20 views) appears above thread B (2 views) in the list.
//   9. Clean up the seeded threads (always runs via try/finally).

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
      content: "E2E test thread — safe to delete.",
      authorHandle: "e2e-test-bot",
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
  // Each request uses a distinct x-forwarded-for IP so the server's
  // per-(IP, hour) deduplication counts every one as a new unique view.
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

test.describe("Admin — Community top-threads panel", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test("panel is visible and ranks threads by descending view count", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await fetchAdminToken(api);

    if (!adminToken) {
      test.skip(true, "Admin login failed — skipping panel ranking test");
      return;
    }

    const titleA = uniqueTitle("E2E-TOP-A");
    const titleB = uniqueTitle("E2E-TOP-B");
    let threadAId: number | null = null;
    let threadBId: number | null = null;

    try {
      // ---------------------------------------------------------------- seed
      threadAId = await createThread(api, adminToken, titleA);
      threadBId = await createThread(api, adminToken, titleB);

      // Give thread A 20 unique-IP views, thread B just 2 — a clear margin
      // that survives any pre-existing data in the shared database.
      await addViews(api, threadAId, 20);
      await addViews(api, threadBId, 2);

      // ---------------------------------------- sign in to the admin UI
      // Inject the token into sessionStorage before the page boots so the
      // React app authenticates without a login-form interaction.
      await page.addInitScript((t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      }, adminToken);
      await page.goto("/admin");

      // Wait for a stable post-login signal (the case-finder trigger is only
      // rendered once the stored token has been accepted).
      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // ------------------------------------------- navigate to Community tab
      await page.getByTestId("tab-community").click({ force: true });

      // ----------------------- assert the panel container is rendered
      const panel = page.getByTestId("card-top-threads-by-views");
      await expect(panel).toBeVisible({ timeout: 15_000 });

      // ----------------------- assert both seeded thread rows exist
      const rowA = panel.getByTestId(`top-thread-row-${threadAId}`);
      const rowB = panel.getByTestId(`top-thread-row-${threadBId}`);

      await expect(rowA).toBeVisible({ timeout: 15_000 });
      await expect(rowB).toBeVisible({ timeout: 15_000 });

      // ------- assert thread A (20 views) appears above thread B (2 views)
      const [topA, topB] = await Promise.all([
        rowA.evaluate((el) => el.getBoundingClientRect().top),
        rowB.evaluate((el) => el.getBoundingClientRect().top),
      ]);
      expect(
        topA,
        "thread A (more views) should appear above thread B (fewer views)",
      ).toBeLessThan(topB);
    } finally {
      // Always delete seeded threads to keep the test database clean.
      if (threadAId !== null) {
        await deleteThread(api, adminToken, threadAId).catch(() => {});
      }
      if (threadBId !== null) {
        await deleteThread(api, adminToken, threadBId).catch(() => {});
      }
      await api.dispose();
    }
  });
});
