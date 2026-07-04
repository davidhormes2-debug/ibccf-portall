import { test as setup } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Two auth artifacts are produced here:
//
//  1. STORAGE_STATE_FILE — a proper Playwright storageState file (cookies +
//     localStorage) consumed by the "admin-auth" project via `use.storageState`
//     (currently `admin-login.spec.ts`).
//
//  2. TOKEN_FILE — a tiny `{ "token": "…" }` JSON consumed by the ~12
//     API-seeding specs that call `readAdminToken()` (e.g.
//     supporting-docs-popover-panel.spec.ts).  Those specs seed cases over the
//     REST API with `Authorization: Bearer <token>` and inject the same token
//     into sessionStorage via addInitScript, so the dashboard mounts already
//     authenticated.  Without this file every such spec 401s on its first
//     `POST /api/cases`.
const STORAGE_STATE_FILE = path.join(
  __dirname,
  "..",
  "playwright",
  ".auth",
  "admin.json",
);
const TOKEN_FILE = path.join(__dirname, ".auth", "admin.json");

// Warm the lazily-compiled admin dashboard chunk once, here in global setup,
// so the first real admin spec runs against an already-compiled dashboard
// instead of paying the one-time dev-mode browser compile itself.
//
// A bare `page.goto("/admin")` only warms the document load: without the admin
// token the dashboard never mounts its authenticated chunk, so the heavy
// Babel/Vite transform is deferred to whichever admin spec navigates first.
// Injecting the token into sessionStorage (where the React app reads it) BEFORE
// navigating mounts the authenticated dashboard, and blocking on the
// `admin-data-ready` sentinel (rendered once cases + pending-counts have
// settled) guarantees the admin chunk has finished compiling before any test
// runs. The 120s ceiling is a safety net for a cold dev server — in practice
// this returns in a few seconds.
async function warmAdminDashboard(
  page: import("@playwright/test").Page,
  token: string,
) {
  await page.addInitScript((t) => {
    if (t) sessionStorage.setItem("adminToken", t);
  }, token);
  await page.goto("/admin");
  // localStorage copy is what Playwright persists in storageState (consumed by
  // the admin-auth project); sessionStorage is not saved to disk.
  await page.evaluate((t) => localStorage.setItem("adminToken", t), token);
  await page.getByTestId("admin-data-ready").waitFor({
    state: "attached",
    timeout: 120_000,
  });
}

setup("authenticate admin and persist storage state", async ({ request, page }) => {
  // Override the global 60 s test timeout: warmAdminDashboard already has a
  // 120 s inner waitFor, and a cold dev server can take 30+ s just to answer
  // /api/cases, so we need headroom beyond the default. 180 s covers the
  // 120 s ceiling plus browser-launch / API-call overhead.
  setup.setTimeout(180_000);

  fs.mkdirSync(path.dirname(STORAGE_STATE_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    // No credentials configured — write an empty (but valid) Playwright storage
    // state plus an empty token file so dependent projects/specs start cleanly
    // and skip (rather than crash on a missing file).
    await page.context().storageState({ path: STORAGE_STATE_FILE });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: "" }));
    return;
  }

  // Reuse the cached token if it is still valid — avoids consuming an
  // admin-login rate-limit slot on every `npx playwright test` invocation.  The
  // limiter allows only 5 attempts per 15 minutes, so repeated dev runs would
  // exhaust the budget quickly without this check.  We validate against the
  // server so an expired/invalidated token forces a fresh login instead of
  // being silently reused.
  try {
    const stored = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as {
      token?: string;
    };
    if (stored.token) {
      const verify = await request.get("/api/admin/verify", {
        headers: { Authorization: `Bearer ${stored.token}` },
      });
      if (verify.status() === 200) {
        // Cached token is good — warm the dashboard (which also refreshes the
        // storageState file so the admin-auth project stays in sync), then
        // return without re-logging in.
        await warmAdminDashboard(page, stored.token);
        await page.context().storageState({ path: STORAGE_STATE_FILE });
        return;
      }
    }
  } catch {
    // File missing or malformed — fall through to a fresh login.
  }

  // Cached token missing/expired — drop the stale artifacts before re-auth so a
  // failed login leaves no usable-but-invalid token behind.
  for (const f of [STORAGE_STATE_FILE, TOKEN_FILE]) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }

  const resp = await request.post("/api/admin/login", {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });

  if (resp.status() === 429) {
    throw new Error(
      "\n\n" +
        "⚠️  Admin login rate-limit reached (5 attempts / 15 minutes).\n" +
        "   global-setup cannot authenticate and every dashboard test will\n" +
        "   be skipped until the window expires.\n\n" +
        "   Wait ~15 minutes before running the suite again, or restart the\n" +
        "   dev server (which resets the in-memory counter) if you are running\n" +
        "   locally and the DB-persisted window is not active.\n",
    );
  }

  if (!resp.ok()) {
    throw new Error(
      "\n\n" +
        `⚠️  Admin login failed with HTTP ${resp.status()}.\n` +
        "   global-setup cannot authenticate and every dashboard test will\n" +
        "   be skipped.\n\n" +
        "   Verify that ADMIN_USERNAME and ADMIN_PASSWORD are set correctly\n" +
        "   in your environment secrets and match the credentials the server\n" +
        "   was started with.\n",
    );
  }

  const body = (await resp.json().catch(() => ({}))) as { token?: string };
  const token: string = body.token ?? "";

  // Persist the bearer token for the API-seeding specs.
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token }));

  if (token) {
    // Warm the admin dashboard (compile the admin chunk once) and seed the
    // token into localStorage so it is captured by storageState. Admin tests
    // read it from localStorage and promote it to sessionStorage (where the
    // React app looks) before reloading — one page visit per test, zero extra
    // API calls for the lifetime of the suite.
    await warmAdminDashboard(page, token);
  }

  // Save the browser context's storage state (cookies + localStorage) to disk.
  // The "admin-auth" Playwright project loads this file via `use.storageState`
  // before each test, making the token available without re-authenticating.
  await page.context().storageState({ path: STORAGE_STATE_FILE });
});
