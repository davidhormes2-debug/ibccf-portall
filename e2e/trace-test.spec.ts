import { test, expect, request } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "node:crypto";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname2, ".auth", "admin.json");

function readAdminToken(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")) as { token?: string };
    return raw.token ?? "";
  } catch { return ""; }
}

async function loginAdminUi(page: import("@playwright/test").Page) {
  const token = readAdminToken();
  await page.addInitScript((t) => { if (t) sessionStorage.setItem("adminToken", t); }, token);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({ timeout: 30_000 });
  console.log("✓ Dashboard loaded");
}

async function clickTab(page: import("@playwright/test").Page, testId: string) {
  await page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;
    if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, testId);
  console.log("✓ clickTab dispatched:", testId);
}

test("trace: full popover reject flow", async ({ page, baseURL }) => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("needs creds");
    }
  });
  test.setTimeout(120_000);

  const api = await request.newContext({ baseURL });
  const token = (await (await api.post("/api/admin/login", { data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD } })).json()).token;
  
  // Seed case
  const accessCode = `E2ETR-${randomBytes(3).toString("hex").toUpperCase()}`;
  const caseBody = await (await api.post("/api/cases", { headers: { Authorization: `Bearer ${token}` }, data: { accessCode, status: "active" } })).json();
  const caseId = caseBody.id;
  await api.patch(`/api/cases/${caseId}`, { headers: { Authorization: `Bearer ${token}` }, data: { userName: "Trace Test", userEmail: `e2e-${randomBytes(2).toString("hex")}@example.com`, status: "active" } });
  const stBody = await (await api.post("/api/cases/set-pin", { data: { accessCode, pin: "246810" } })).json();
  const sessionToken = stBody.sessionToken;
  const docBody = await (await api.post(`/api/cases/${caseId}/user-documents`, { headers: { "x-portal-session-token": sessionToken }, data: { fileData: TINY_PNG_DATA_URL, fileName: "trace.png", category: "general", description: "Trace test" } })).json();
  const docId = docBody.id;
  console.log("✓ Seeded: caseId=", caseId, "docId=", docId);

  await loginAdminUi(page);
  await clickTab(page, "tab-cases");

  console.log("Waiting for badge...");
  const badge = page.getByTestId(`badge-user-doc-pending-${caseId}`);
  
  // Don't wait forever — use a 20s expect with detailed error
  try {
    await expect(badge).toBeVisible({ timeout: 20_000 });
    console.log("✓ Badge visible!");
  } catch (e) {
    // Check if badge is in DOM at all
    const badgeCount = await badge.count().catch(() => -1);
    console.log("Badge not visible, count:", badgeCount);
    // Check what's on screen
    const onScreen = await page.evaluate(() => {
      const testids = Array.from(document.querySelectorAll("[data-testid]")).map(e => (e as HTMLElement).dataset.testid).filter(Boolean);
      return testids.filter(id => id?.includes("badge") || id?.includes("pending") || id?.includes("tab-cases"));
    });
    console.log("On-screen testids:", onScreen.slice(0, 30));
    throw e;
  }

  console.log("Clicking badge...");
  await badge.click({ timeout: 10_000 });
  console.log("✓ Badge clicked!");
  
  await api.dispose();
});
