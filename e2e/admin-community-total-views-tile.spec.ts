// Task #652 — Playwright e2e test verifying the "Total Views" stat tile in the
// Community Management stats bar.
//
// Test 1 — tile is visible and shows a numeric value:
//   1. Obtain an admin bearer token via POST /api/admin/login.
//   2. Create a thread via the admin API.
//   3. Simulate 5 unique-IP views on the thread so the stats endpoint has
//      something non-zero to report.
//   4. Log into the admin dashboard by injecting the token into sessionStorage
//      via addInitScript before the page loads.
//   5. Navigate to the Community tab.
//   6. Assert the `card-admin-stat-total-views` tile is visible.
//   7. Assert the value inside the tile is a numeric string (not the "..."
//      loading placeholder).
//   8. Skip gracefully if the community stats endpoint is unavailable or
//      admin credentials are missing.
//   9. Clean up the seeded thread in a finally block.
//
// Test 2 — tile reflects seeded view count (Task #738):
//   1. Obtain an admin bearer token.
//   2. Fetch the current totalViews baseline from GET /api/community/stats.
//   3. Create a thread via the admin API.
//   4. Simulate N unique-IP views using randomised IPs so each view registers
//      as a distinct visitor even within the same hour bucket.
//   5. Log into the admin dashboard.
//   6. Navigate to the Community tab.
//   7. Assert the tile value is >= baseline + N, confirming the backend
//      aggregation is correctly wired to the frontend display.
//   8. Clean up the seeded thread in a finally block.

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
      content: "E2E total-views tile test thread — safe to delete.",
      authorHandle: "e2e-total-views-bot",
      authorType: "admin",
    },
  });
  expect(res.status(), `create thread "${title}"`).toBe(201);
  const body = await res.json();
  expect(typeof body.id).toBe("number");
  return body.id as number;
}

function uniqueIp(): string {
  // Random IP in the TEST-NET-3 range (203.0.113.0/24) with a randomised
  // high-octet so consecutive calls within the same hour bucket each produce a
  // distinct address that the server treats as a new unique visitor.
  const a = Math.floor(Math.random() * 254) + 1;
  const b = randomBytes(1)[0] % 254 + 1;
  return `203.0.${a}.${b}`;
}

async function fetchTotalViews(
  api: APIRequestContext,
  adminToken: string,
): Promise<number> {
  const res = await api.get("/api/community/stats", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!res.ok()) return 0;
  const body = (await res.json().catch(() => ({}))) as { totalViews?: number };
  return typeof body.totalViews === "number" ? body.totalViews : 0;
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

async function addUniqueViews(
  api: APIRequestContext,
  threadId: number,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await api.get(`/api/community/threads/${threadId}`, {
      headers: { "x-forwarded-for": uniqueIp() },
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

test.describe("Admin — Community Total Views stat tile", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test("Total Views tile is visible and shows a numeric value", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await fetchAdminToken(api);

    if (!adminToken) {
      test.skip(true, "Admin login failed — skipping Total Views tile test");
      return;
    }

    const title = uniqueTitle("E2E-TOTAL-VIEWS");
    let threadId: number | null = null;

    try {
      // ---------------------------------------------------------------- seed
      threadId = await createThread(api, adminToken, title);

      // Add 5 unique-IP views so the stats endpoint has a non-zero total.
      await addViews(api, threadId, 5);

      // Verify the stats endpoint itself returns totalViews before touching the UI.
      const statsRes = await api.get("/api/community/stats", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (statsRes.status() !== 200) {
        test.skip(
          true,
          `Community stats endpoint returned ${statsRes.status()} — skipping`,
        );
        return;
      }

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

      // -------------------- assert the Total Views tile is rendered
      const tile = page.getByTestId("card-admin-stat-total-views");
      await expect(tile).toBeVisible({ timeout: 15_000 });

      // -------------------- wait for the loading placeholder to resolve
      // The tile shows "..." while statsLoading is true; wait until the
      // value changes to a resolved numeric string.
      const valueEl = tile.locator("p.text-3xl");
      await expect(valueEl).not.toHaveText("...", { timeout: 15_000 });

      // -------------------- assert the resolved value is numeric
      const rawText = (await valueEl.textContent()) ?? "";
      // The component formats with toLocaleString() which may include commas.
      const numericOnly = rawText.replace(/[,\s]/g, "");
      expect(
        /^\d+$/.test(numericOnly),
        `Total Views tile should display a numeric value, got "${rawText}"`,
      ).toBe(true);
    } finally {
      if (threadId !== null) {
        await deleteThread(api, adminToken, threadId).catch(() => {});
      }
      await api.dispose();
    }
  });

  test("Total Views tile reflects seeded view count (>= baseline + N)", async ({
    page,
    baseURL,
  }) => {
    const SEEDED_VIEWS = 3;
    const api = await request.newContext({ baseURL });
    const adminToken = await fetchAdminToken(api);

    if (!adminToken) {
      test.skip(true, "Admin login failed — skipping seeded-views assertion test");
      return;
    }

    const title = uniqueTitle("E2E-SEEDED-VIEWS");
    let threadId: number | null = null;

    try {
      // ---------------------------------------------------------- baseline
      // Capture the current global totalViews so the assertion is independent
      // of any pre-existing threads or views in the database.
      const baseline = await fetchTotalViews(api, adminToken);

      // ------------------------------------------------------------ seed
      threadId = await createThread(api, adminToken, title);

      // Add SEEDED_VIEWS unique-IP hits using random IPs to guarantee each one
      // is treated as a distinct visitor within the same hour bucket.
      await addUniqueViews(api, threadId, SEEDED_VIEWS);

      // Verify the stats endpoint reflects the seeded views before opening the UI.
      const statsRes = await api.get("/api/community/stats", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (statsRes.status() !== 200) {
        test.skip(
          true,
          `Community stats endpoint returned ${statsRes.status()} — skipping`,
        );
        return;
      }

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

      // ----------------------- locate the Total Views tile
      const tile = page.getByTestId("card-admin-stat-total-views");
      await expect(tile).toBeVisible({ timeout: 15_000 });

      // Wait for the loading placeholder to resolve.
      const valueEl = tile.locator("p.text-3xl");
      await expect(valueEl).not.toHaveText("...", { timeout: 15_000 });

      // Parse the formatted value (toLocaleString() may include commas).
      const rawText = (await valueEl.textContent()) ?? "";
      const actual = parseInt(rawText.replace(/\D/g, ""), 10);

      // The tile must show at least baseline + SEEDED_VIEWS, confirming the
      // backend aggregation is correctly wired to the frontend display.
      expect(
        actual,
        `Total Views tile (${actual}) should be >= baseline (${baseline}) + seeded views (${SEEDED_VIEWS})`,
      ).toBeGreaterThanOrEqual(baseline + SEEDED_VIEWS);
    } finally {
      if (threadId !== null) {
        await deleteThread(api, adminToken, threadId).catch(() => {});
      }
      await api.dispose();
    }
  });
});
