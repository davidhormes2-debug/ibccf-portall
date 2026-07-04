// Task #734 — Playwright e2e test verifying the views-over-time chart in the
// Analytics tab reflects real data after a community thread is viewed.
//
// Flow under test:
//   1. Obtain an admin bearer token via POST /api/admin/login.
//   2. Record the baseline total-view count for the 48-hour window via
//      GET /api/admin/community/views-over-time.
//   3. Create one thread via the admin API.
//   4. Simulate a browser visit: navigate to /community as a public visitor,
//      then call GET /api/community/threads/:id from within the browser's JS
//      context via page.evaluate() so the server records a view with the
//      browser's real request origin (not a synthetic x-forwarded-for).
//   5. Verify the /api/admin/community/views-over-time endpoint now returns
//      rows for the seeded thread's hour bucket.
//   6. Log into the admin dashboard by injecting the token into sessionStorage
//      via addInitScript before the page loads.
//   7. Navigate to the Analytics tab where the "Community Thread Views (48 h)"
//      chart and views-total-counter live.
//   8. Assert the `views-total-counter` element is visible and shows a
//      positive numeric value (chart received real view data, not an empty
//      state).
//   9. Clean up the seeded thread (always runs via try/finally).

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

async function fetchBaselineViews(
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
  if (!Array.isArray(body.data)) return 0;
  return body.data.reduce((sum, row) => sum + (row.views ?? 0), 0);
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
      content: "E2E test thread for views-over-time chart — safe to delete.",
      authorHandle: "e2e-views-over-time-bot",
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

test.describe("Admin — Community views-over-time chart", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test("chart reflects real view data after a thread is viewed in the browser", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await fetchAdminToken(api);

    if (!adminToken) {
      test.skip(
        true,
        "Admin login failed — skipping views-over-time chart test",
      );
      return;
    }

    const title = uniqueTitle("E2E-VIEWS-OVER-TIME");
    let threadId: number | null = null;

    try {
      // -------------------------------------------------------- baseline
      const baseline = await fetchBaselineViews(api, adminToken);

      // ------------------------------------------------------------ seed
      threadId = await createThread(api, adminToken, title);

      // ---- Browser visit — trigger the view via the browser's JS context ---
      // Open a fresh page (public visitor, no auth) within the same browser
      // context so it inherits baseURL. Navigate to the community listing to
      // establish a real page context, then call GET /api/community/threads/:id
      // from within the page's JS environment: this is what the server's
      // view-deduplication logic sees as the real browser request, exercising
      // the full view-recording path.
      const publicPage = await page.context().newPage();
      try {
        await publicPage.goto("/community");

        // Wait for the page to load (thread list renders after data fetch).
        await publicPage.waitForLoadState("networkidle", { timeout: 20_000 });

        // Trigger a view from within the browser context: evaluate() runs in
        // the page's JS environment, so the server receives the request with
        // the browser's actual origin/IP rather than a synthetic header.
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

      // ---- API-level assertion: views-over-time must reflect the new view ---
      const afterRes = await api.get(
        `/api/admin/community/views-over-time?hours=48&threadId=${threadId}`,
        { headers: { Authorization: `Bearer ${adminToken}` } },
      );
      expect(
        afterRes.status(),
        "views-over-time endpoint should return 200",
      ).toBe(200);

      const afterBody = (await afterRes.json()) as {
        data?: { hourBucket: string; views: number }[];
        windowHours?: number;
      };
      expect(
        Array.isArray(afterBody.data),
        "response.data should be an array",
      ).toBe(true);

      const threadTotal = (afterBody.data ?? []).reduce(
        (sum, row) => sum + (row.views ?? 0),
        0,
      );
      expect(
        threadTotal,
        `views-over-time should report ≥ 1 view for thread ${threadId}, got ${threadTotal}`,
      ).toBeGreaterThanOrEqual(1);

      // Global 48-hour window total should have grown.
      const newTotal = await fetchBaselineViews(api, adminToken);
      expect(
        newTotal,
        `Global 48-hour total (${newTotal}) should exceed baseline (${baseline})`,
      ).toBeGreaterThan(baseline);

      // ---------------------------------------- sign in to the admin UI
      // Inject the token into sessionStorage before the page boots so the
      // React app authenticates without a login-form interaction.
      await page.addInitScript((t) => {
        if (t) sessionStorage.setItem("adminToken", t);
      }, adminToken);
      await page.goto("/admin");

      // Wait for a stable post-login signal.
      await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // ------------------------------------------ navigate to Analytics tab
      // The views-over-time chart lives in the Analytics tab, not Community.
      await page.getByTestId("tab-analytics").click({ force: true });

      // ---- UI assertion: views-total-counter must appear and be > 0 ---------
      // The counter element (`views-total-counter`) is hidden while the
      // /api/admin/community/views-over-time fetch is in-flight and only
      // rendered once the response resolves with data.
      const counter = page.getByTestId("views-total-counter");
      await expect(counter).toBeVisible({ timeout: 20_000 });

      // Parse the counter value — it may be locale-formatted (e.g. "1,234").
      const counterText = (await counter.textContent()) ?? "";
      const counterValue = parseInt(counterText.replace(/[^\d]/g, ""), 10);
      expect(
        counterValue,
        `views-total-counter ("${counterText}") should be > 0 after a browser view`,
      ).toBeGreaterThan(0);
    } finally {
      if (threadId !== null) {
        await deleteThread(api, adminToken, threadId).catch(() => {});
      }
      await api.dispose();
    }
  });
});
