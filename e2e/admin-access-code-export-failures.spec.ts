// Playwright e2e spec — Task #2392.
//
// Task #2359 added an "Export failed cases as CSV" button on the Cases tab's
// bulk "Access code" panel, plus a unit test that exercises it directly
// against a rendered `<CasesTab />` with a mocked fetch. There was no
// end-to-end (browser) test confirming the button is actually reachable in
// the live admin dashboard and triggers a real file download — a future
// refactor of the bulk access-code panel could silently drop the button (or
// rename its `data-testid`) without any CI signal beyond the unit test.
//
// What this spec verifies
// ------------------------
// 1. Two real cases are seeded via the admin API: one with a valid email on
//    file, one with NO email on file. `POST /api/cases/bulk/send-access-code`
//    (server/routes/cases.ts) short-circuits any case with no registered
//    email straight to a per-case failure ("This case has no registered
//    email on file.") *before* it ever touches the SMTP transport — so this
//    produces a genuine, deterministic partial failure (one success, one
//    failure) without stubbing the network response or depending on SMTP
//    being configured/reachable in this environment.
// 2. In the live dashboard, both cases are selected via their row checkboxes
//    and the "Access code" function panel is opened, then "Send" is clicked
//    for real — exercising the full client → server → response round trip.
// 3. The inline failure list appears, and clicking "Export … as CSV"
//    (`access-code-export-failures`) fires a real browser download event
//    whose filename matches `access-code-failures-YYYY-MM-DD.csv` and whose
//    CSV body contains the failed case's name/access code/email/error and
//    omits the successful case's details.
//
// Auth strategy
// -------------
// readAdminToken() reads the token written by global-setup (same pattern as
// admin-analytics-kpi-cards.spec.ts / newsletter-export.spec.ts).
// loginAdminUi() injects the token into sessionStorage before navigating to
// /admin — no re-authentication required and no admin-login rate-limit
// slots consumed.

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { localTimeout } from "./helpers";
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

function uniqueAccessCode(prefix: string): string {
  return `${prefix}${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function createCase(
  api: APIRequestContext,
  adminToken: string,
  accessCode: string,
  userName: string,
  userEmail: string | null,
): Promise<string> {
  const created = await api.post("/api/cases", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { accessCode, status: "active" },
  });
  expect(created.status(), "create case").toBe(200);
  const body = (await created.json()) as { id: string };
  const caseId = body.id;

  const patched = await api.patch(`/api/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { userName, userEmail, status: "active" },
  });
  expect(patched.status(), "patch case").toBe(200);
  return caseId;
}

async function deleteCase(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  await api
    .delete(`/api/cases/${caseId}?force=true`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    .catch(() => {});
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

test.describe("Admin — Cases tab bulk access-code failure export", () => {
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test",
  );

  test.beforeEach(() => {
    test.setTimeout(localTimeout(120_000));
  });

  test("clicking 'Export … as CSV' after a partial bulk-send failure downloads a CSV of only the failed case", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const suffix = hex4();
    const accessCodeOk = uniqueAccessCode("EXPOK");
    const accessCodeFail = uniqueAccessCode("EXPFL");
    const emailOk = `e2e-exp-ok-${suffix}@example.com`;
    // The bulk endpoint fails any case with no registered email BEFORE it
    // ever attempts an SMTP send (server/routes/cases.ts), so leaving this
    // case's email unset produces a genuine, deterministic failure.
    const errorReason = "This case has no registered email on file.";

    let caseIdOk: string | undefined;
    let caseIdFail: string | undefined;

    try {
      caseIdOk = await createCase(
        api,
        adminToken,
        accessCodeOk,
        `Export E2E OK Case ${suffix}`,
        emailOk,
      );
      caseIdFail = await createCase(
        api,
        adminToken,
        accessCodeFail,
        `Export E2E Fail Case ${suffix}`,
        null,
      );

      await loginAdminUi(page);

      // Search narrows the table so both seeded cases are visible together
      // (their access codes share no common substring, so search by the
      // shared e2e suffix embedded in the email instead — fall back to no
      // filter and just select by testid directly).
      // The Cases panel is lazy-loaded (React.lazy + Suspense, fallback
      // "Loading panel…" — see AdminDashboard.tsx). On a cold/slow dev
      // server the chunk fetch + first render can take noticeably longer
      // than a typical widget wait, so this uses the same generous timeout
      // as the admin-data-ready check in loginAdminUi rather than the usual
      // 15s used for already-mounted widgets below.
      const searchInput = page.getByTestId("input-search-cases");
      await expect(searchInput).toBeVisible({ timeout: 30_000 });
      await searchInput.fill(suffix);

      const checkboxOk = page.getByTestId(`checkbox-select-${caseIdOk}`);
      const checkboxFail = page.getByTestId(`checkbox-select-${caseIdFail}`);
      await expect(checkboxOk).toBeVisible({ timeout: 15_000 });
      await expect(checkboxFail).toBeVisible({ timeout: 15_000 });
      await checkboxOk.check();
      await checkboxFail.check();

      const accessCodePanelTrigger = page.getByTestId("sidebar-fn-access-code");
      await expect(accessCodePanelTrigger).toBeVisible({ timeout: 10_000 });
      await accessCodePanelTrigger.click();

      const sendBtn = page.getByTestId("panel-access-code-send");
      await expect(sendBtn).toBeVisible({ timeout: 10_000 });
      await expect(sendBtn).toBeEnabled({ timeout: 10_000 });
      await sendBtn.click();

      const failureList = page.getByTestId("access-code-failure-list");
      await expect(failureList).toBeVisible({ timeout: 15_000 });

      const exportBtn = page.getByTestId("access-code-export-failures");
      await expect(exportBtn).toBeVisible({ timeout: 10_000 });

      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15_000 }),
        exportBtn.click(),
      ]);

      const filename = download.suggestedFilename();
      expect(
        filename,
        `filename "${filename}" should match access-code-failures-YYYY-MM-DD.csv`,
      ).toMatch(/access-code-failures-\d{4}-\d{2}-\d{2}\.csv/);

      const rows = await readDownloadCsv(download);
      expect(rows.length, "CSV should have a header row + 1 failure row").toBe(2);

      const header = rows[0];
      expect(header).toEqual(["Name", "Access Code", "Email", "Error Reason"]);

      const csvText = rows.slice(1).map((r) => r.join(",")).join("\n");
      expect(csvText, "CSV should contain the failed case's access code").toContain(
        accessCodeFail,
      );
      expect(
        csvText,
        "CSV should contain the failed case's name",
      ).toContain(`Export E2E Fail Case ${suffix}`);
      expect(csvText, "CSV should contain the real error reason").toContain(
        errorReason,
      );
      expect(
        csvText,
        "CSV should NOT contain the successful case's access code",
      ).not.toContain(accessCodeOk);
      expect(
        csvText,
        "CSV should NOT contain the successful case's email",
      ).not.toContain(emailOk);
    } finally {
      if (caseIdOk) await deleteCase(api, adminToken, caseIdOk);
      if (caseIdFail) await deleteCase(api, adminToken, caseIdFail);
      await api.dispose();
    }
  });
});
