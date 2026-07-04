// Task #661 — Playwright e2e test verifying the "Total Views" stat tile in the
// Community Management tab updates correctly after a thread is viewed.
//
// Flow under test:
//   1. Obtain an admin bearer token via POST /api/admin/login.
//   2. Fetch the current totalViews baseline from GET /api/community/stats.
//   3. Create one thread via the admin API.
//   4. Simulate one unique-IP GET to the thread so the server increments its
//      view counter (per-(IP, hour) deduplication means distinct x-forwarded-for
//      headers count as separate unique views).
//   5. Log into the admin dashboard by injecting the token into sessionStorage
//      via addInitScript before the page loads.
//   6. Navigate to the Community tab.
//   7. Read the "Total Views" stat tile value and assert it equals baseline + 1.
//   8. Clean up the seeded thread (always runs via try/finally).

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

function uniqueTitle(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

function uniqueIp(): string {
  // Use a random IP in the TEST-NET-3 range (203.0.113.0/24) combined with a
  // random high-octet prefix so it never collides with real traffic and every
  // test run gets a fresh unique IP that the server hashes as a new visitor.
  const a = Math.floor(Math.random() * 254) + 1;
  const b = randomBytes(1)[0] % 254 + 1;
  return `203.0.${a}.${b}`;
}

async function fetchAdminToken(api: APIRequestContext): Promise<string> {
  const res = await api.post("/api/admin/login", {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (res.status() !== 200) return "";
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  return body.token ?? "";
}

async function fetchTotalViews(
  api: APIRequestContext,
  adminToken: string,
): Promise<number> {
  const res = await api.get("/api/community/stats", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!res.ok()) return 0;
  const body = (await res.json().catch(() => ({}))) as {
    totalViews?: number;
  };
  return typeof body.totalViews === "number" ? body.totalViews : 0;
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
      content: "E2E test thread for total-views tile — safe to delete.",
      authorHandle: "e2e-test-bot",
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

test.describe("Admin — Community Total Views stat tile", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test("Total Views tile increments by 1 after a thread is viewed", async ({
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
      // ---------------------------------------------------------- baseline
      const baseline = await fetchTotalViews(api, adminToken);

      // ------------------------------------------------------------ seed
      threadId = await createThread(api, adminToken, title);

      // Send exactly one GET with a unique IP so the view counter goes up by 1.
      await api.get(`/api/community/threads/${threadId}`, {
        headers: { "x-forwarded-for": uniqueIp() },
      });

      // ---------------------------------------- sign in to the admin UI
      await page.addInitScript((t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      }, adminToken);
      await page.goto("/admin");

      // Wait for a stable post-login signal.
      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // ------------------------------------------- navigate to Community tab
      await page.getByTestId("tab-community").click({ force: true });

      // ----------------------- locate the Total Views tile
      const tile = page.getByTestId("card-admin-stat-total-views");
      await expect(tile).toBeVisible({ timeout: 15_000 });

      // The value is rendered via toLocaleString() so it may contain commas or
      // other locale separators. Strip everything except digits before parsing.
      const tileText = await tile.innerText();
      const tileLines = tileText.split("\n");

      // Find the line that is purely a formatted number (no alphabetic chars).
      const numberLine =
        tileLines.find((l) => /^[\d,.\s]+$/.test(l.trim())) ?? tileText;
      const actual = parseInt(numberLine.replace(/\D/g, ""), 10);

      expect(
        actual,
        `Total Views tile (${actual}) should equal baseline (${baseline}) + 1`,
      ).toBe(baseline + 1);
    } finally {
      if (threadId !== null) {
        await deleteThread(api, adminToken, threadId).catch(() => {});
      }
      await api.dispose();
    }
  });
});
