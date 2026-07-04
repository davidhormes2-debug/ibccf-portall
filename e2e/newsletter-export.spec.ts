// Playwright e2e spec — Newsletter subscriber filtered-export path.
//
// What these tests verify
// -----------------------
// 1. Typing a partial email in the search box changes the Export button label
//    to "Export matching (1)" (exactly one subscriber matches in the seeded
//    scenario).
// 2. Clicking Export when a filter is active downloads a file whose suggested
//    filename contains "-filtered-" AND whose CSV body contains only the
//    matching subscriber row — not the non-matching row.
// 3. After selecting a row manually (no filter active) the Export button label
//    changes to "Export selected (1)" and the downloaded file:
//    a. has a filename that contains "-selected-", and
//    b. CSV body contains only the selected subscriber.
//
// Seeding strategy
// ----------------
// Two subscribers are created via POST /api/public/newsletter before each
// filtered-export test.  Unique email prefixes ("nl-e2e-aaa-<hex>" and
// "nl-e2e-zzz-<hex>") ensure the filter string "nl-e2e-aaa-<hex>" matches
// exactly one subscriber.  All seeded rows are cleaned up in finally blocks
// via DELETE /api/admin/content/newsletter/:id.
//
// Auth strategy
// -------------
// readAdminToken() reads the token written by global-setup (same pattern as
// admin-analytics-kpi-cards.spec.ts).  loginAdminUi() injects the token into
// sessionStorage before navigating to /admin — no re-authentication required
// and no admin-login rate-limit slots consumed.

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
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

function hex4(): string {
  return randomBytes(4).toString("hex");
}

async function loginAdminUi(page: import("@playwright/test").Page) {
  const token = readAdminToken();
  await page.addInitScript((t) => {
    if (t) sessionStorage.setItem("adminToken", t);
  }, token);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("admin-data-ready")).toBeAttached({
    timeout: 30_000,
  });
}

async function subscribeEmail(
  api: APIRequestContext,
  email: string,
): Promise<void> {
  const res = await api.post("/api/public/newsletter", {
    data: { email },
  });
  expect(res.status(), `subscribe ${email}`).toBeGreaterThanOrEqual(200);
  expect(res.status(), `subscribe ${email}`).toBeLessThan(300);
}

async function getSubscriberIdByEmail(
  api: APIRequestContext,
  adminToken: string,
  email: string,
): Promise<number | null> {
  const res = await api.get("/api/admin/content/newsletter", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (res.status() !== 200) return null;
  const list = (await res.json()) as Array<{ id: number; email: string }>;
  return list.find((s) => s.email === email)?.id ?? null;
}

async function deleteSubscriber(
  api: APIRequestContext,
  adminToken: string,
  id: number,
): Promise<void> {
  await api
    .delete(`/api/admin/content/newsletter/${id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    .catch(() => {});
}

async function navigateToNewsletterTab(
  page: import("@playwright/test").Page,
): Promise<void> {
  const contentTab = page.getByTestId("tab-content");
  await expect(contentTab).toBeVisible({ timeout: 10_000 });
  await contentTab.click();

  const newsletterTab = page.getByTestId("content-tab-newsletter");
  await expect(newsletterTab).toBeVisible({ timeout: 10_000 });
  await newsletterTab.click();
}

/** Read and parse the CSV content from a Playwright Download. */
async function readDownloadCsv(
  download: import("@playwright/test").Download,
): Promise<string[][]> {
  const filePath = await download.path();
  if (!filePath) throw new Error("download.path() returned null");
  const raw = fs.readFileSync(filePath, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) =>
      line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()),
    );
}

test.describe("Admin — Newsletter subscriber filtered-export", () => {
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test",
  );

  test.beforeEach(() => {
    test.setTimeout(120_000);
  });

  test("search filter: label shows 'Export matching (1)', filename is -filtered-, CSV contains only matching row", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const suffix = hex4();
    const emailA = `nl-e2e-aaa-${suffix}@example.com`;
    const emailZ = `nl-e2e-zzz-${suffix}@example.com`;
    let idA: number | null = null;
    let idZ: number | null = null;

    try {
      await subscribeEmail(api, emailA);
      await subscribeEmail(api, emailZ);

      idA = await getSubscriberIdByEmail(api, adminToken, emailA);
      idZ = await getSubscriberIdByEmail(api, adminToken, emailZ);

      await loginAdminUi(page);
      await navigateToNewsletterTab(page);

      const searchInput = page.getByTestId("input-search-newsletter");
      await expect(searchInput).toBeVisible({ timeout: 10_000 });

      // Filter by the unique prefix of emailA only — emailZ must not match.
      const filterString = `nl-e2e-aaa-${suffix}`;
      await searchInput.fill(filterString);

      const exportBtn = page.getByTestId("button-export-newsletter-csv");
      await expect(exportBtn).toBeVisible({ timeout: 10_000 });

      // Exactly one subscriber matches — expect "Export matching (1)".
      await expect(exportBtn).toContainText("Export matching (1)", {
        timeout: 10_000,
      });

      // ── Capture the download and assert filename ──
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15_000 }),
        exportBtn.click(),
      ]);

      const filename = download.suggestedFilename();
      expect(
        filename,
        `filename "${filename}" should match newsletter-subscribers-filtered-YYYY-MM-DD.csv`,
      ).toMatch(/newsletter-subscribers-filtered-\d{4}-\d{2}-\d{2}\.csv/);
      expect(
        filename,
        `filename "${filename}" should NOT contain "-selected-"`,
      ).not.toContain("-selected-");

      // ── Assert CSV payload: matching row present, non-matching row absent ──
      const rows = await readDownloadCsv(download);
      // rows[0] is the header; remaining rows are data.
      const dataRows = rows.slice(1);

      const csvText = dataRows.map((r) => r.join(",")).join("\n");

      expect(
        dataRows.length,
        `CSV should have exactly 1 data row for the filtered export, got ${dataRows.length}`,
      ).toBe(1);
      expect(
        csvText,
        "CSV body should contain the matching subscriber email",
      ).toContain(emailA);
      expect(
        csvText,
        "CSV body should NOT contain the non-matching subscriber email",
      ).not.toContain(emailZ);
    } finally {
      if (idA !== null) await deleteSubscriber(api, adminToken, idA);
      if (idZ !== null) await deleteSubscriber(api, adminToken, idZ);
      await api.dispose();
    }
  });

  test("row selection: label shows 'Export selected (1)', filename is -selected-, CSV contains only the selected row", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const suffix = hex4();
    const emailSel = `nl-e2e-sel-${suffix}@example.com`;
    const emailOther = `nl-e2e-oth-${suffix}@example.com`;
    let idSel: number | null = null;
    let idOther: number | null = null;

    try {
      await subscribeEmail(api, emailSel);
      await subscribeEmail(api, emailOther);

      idSel = await getSubscriberIdByEmail(api, adminToken, emailSel);
      idOther = await getSubscriberIdByEmail(api, adminToken, emailOther);

      if (!idSel) {
        test.skip(true, "Subscriber id not found — skipping selection-export test");
        return;
      }

      await loginAdminUi(page);
      await navigateToNewsletterTab(page);

      // Select only the first seeded subscriber by its checkbox.
      const checkbox = page.getByTestId(`checkbox-newsletter-${idSel}`);
      await expect(checkbox).toBeVisible({ timeout: 15_000 });
      await checkbox.check();

      const exportBtn = page.getByTestId("button-export-newsletter-csv");
      // Label must show the selection count, not the filter count.
      await expect(exportBtn).toContainText("Export selected (1)", {
        timeout: 10_000,
      });

      // ── Capture the download and assert filename ──
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15_000 }),
        exportBtn.click(),
      ]);

      const filename = download.suggestedFilename();
      expect(
        filename,
        `filename "${filename}" should match newsletter-subscribers-selected-YYYY-MM-DD.csv`,
      ).toMatch(/newsletter-subscribers-selected-\d{4}-\d{2}-\d{2}\.csv/);
      expect(
        filename,
        `filename "${filename}" should NOT contain "-filtered-"`,
      ).not.toContain("-filtered-");

      // ── Assert CSV payload: selected row present, unselected row absent ──
      const rows = await readDownloadCsv(download);
      const dataRows = rows.slice(1);
      const csvText = dataRows.map((r) => r.join(",")).join("\n");

      expect(
        dataRows.length,
        `CSV should have exactly 1 data row for the selected export, got ${dataRows.length}`,
      ).toBe(1);
      expect(
        csvText,
        "CSV body should contain the selected subscriber email",
      ).toContain(emailSel);
      expect(
        csvText,
        "CSV body should NOT contain the unselected subscriber email",
      ).not.toContain(emailOther);
    } finally {
      if (idSel !== null) await deleteSubscriber(api, adminToken, idSel);
      if (idOther !== null) await deleteSubscriber(api, adminToken, idOther);
      await api.dispose();
    }
  });
});
