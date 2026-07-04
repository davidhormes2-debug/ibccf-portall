import { defineConfig, devices } from "@playwright/test";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

// Task #296 — Playwright config for admin E2E tests. We deliberately point
// at a system-provided Chromium binary (nix store) because Replit's sandbox
// blocks the standard `npx playwright install` download path. The path is
// overridable via PLAYWRIGHT_CHROMIUM_EXECUTABLE so CI / other environments
// can point at their own browser.
//
// Resolution order for the Chromium executable (Task #526 — automatic, no
// hard-coded Nix-store hashes):
//   1. PLAYWRIGHT_CHROMIUM_EXECUTABLE env var (explicit override — takes
//      precedence everywhere, including CI).
//   2. On GitHub Actions / any CI environment (CI=true) with no explicit
//      override: leave executablePath undefined so Playwright uses the browser
//      it installed via `npx playwright install chromium`.
//   3. REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE — set automatically by Replit's
//      runtime and updated whenever the browsers package hash changes, so this
//      never needs a manual update after a Replit upgrade.
//   4. scripts/find-nix-chromium.sh — fast shell fallback for other Nix-based
//      environments (checks PATH, then the same env var above).

function resolveNixChromium(): string | undefined {
  // Fast path: Replit sets this env var automatically and updates it on upgrade.
  const replitPath = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (replitPath) return replitPath;

  // Slow-ish path: delegate to the helper script for other nix environments.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const helperScript = path.join(__dirname, "scripts", "find-nix-chromium.sh");
  try {
    return (
      execSync(`bash "${helperScript}"`, { encoding: "utf8", timeout: 10_000 }).trim() ||
      undefined
    );
  } catch {
    return undefined;
  }
}

const RESOLVED_CHROMIUM: string | undefined =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE !== undefined
    ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined
    : process.env.CI
      ? undefined
      : resolveNixChromium();

// Non-CI only: launch Chromium through a `nice`d wrapper so it yields CPU to
// the dev server / Postgres under contention in this sandbox's 2-vCPU
// allocation. See scripts/niced-chromium.sh and
// `.agents/memory/local-devdb-case-volume.md` for why this matters — a real
// headless Chromium instance competing for CPU has been observed to stall
// `GET /api/cases` 70-100+ seconds even though the query itself takes well
// under a second. Disable via PLAYWRIGHT_DISABLE_NICE=1 if it ever interferes
// with local debugging. Never applied in CI (no such contention there, and CI
// uses Playwright's own managed browser install, not a system binary).
const NICE_WRAPPER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "scripts",
  "niced-chromium.sh",
);
const SYSTEM_CHROMIUM: string | undefined =
  RESOLVED_CHROMIUM && !process.env.CI && process.env.PLAYWRIGHT_DISABLE_NICE !== "1"
    ? NICE_WRAPPER
    : RESOLVED_CHROMIUM;
if (RESOLVED_CHROMIUM && SYSTEM_CHROMIUM === NICE_WRAPPER) {
  process.env.REAL_CHROMIUM_BIN = RESOLVED_CHROMIUM;
}

// In non-CI environments, warn early if no Chromium path could be resolved so
// the user gets an actionable message instead of a cryptic Playwright error.
if (!SYSTEM_CHROMIUM && !process.env.CI) {
  process.stderr.write(
    [
      "",
      "WARNING: playwright.config.ts — no Chromium executable found.",
      "  Playwright will try its own managed browser, which may not be installed.",
      "  On Replit: ensure the playwright-browsers package is in replit.nix so",
      "  REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE is set automatically, then open a",
      "  fresh shell session so the env var is injected.",
      "  Anywhere else: set PLAYWRIGHT_CHROMIUM_EXECUTABLE or add chromium to PATH.",
      "  Run `bash scripts/check-chromium.sh` for a detailed diagnostic.",
      "",
    ].join("\n"),
  );
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";
const disableManagedServer = process.env.PLAYWRIGHT_NO_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  // Local (non-CI) runs in this Replit sandbox share 2 vCPUs between a real
  // headless Chromium instance, the Vite/tsx dev server, and Postgres, and
  // the shared dev DB has accumulated thousands of case rows over time. That
  // contention has been observed to stall individual admin-dashboard
  // requests (most often `GET /api/cases`) 70-100+ seconds even though the
  // same query takes well under a second in isolation — see
  // `.agents/memory/local-devdb-case-volume.md`. Doubling the default local
  // timeout absorbs that observed worst case; CI (fresh/near-empty DB,
  // dedicated CPU) keeps the tighter 60s budget unchanged. Specs with an
  // explicit `test.setTimeout(...)` override this via `localTimeout()` in
  // `e2e/helpers.ts` instead.
  timeout: process.env.CI ? 60_000 : 120_000,
  expect: { timeout: process.env.CI ? 10_000 : 20_000 },
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: SYSTEM_CHROMIUM,
      // Replit's sandbox blocks setuid sandbox helpers; --no-sandbox is the
      // standard escape hatch used by every CI runner that ships Chromium
      // without root privileges. This is a test-only setting.
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: /global-setup\.ts/,
    },
    {
      // All tests EXCEPT those that require a pre-seeded admin session.
      name: "chromium",
      testIgnore: /admin-login\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      // Admin-authenticated tests.  global-setup (the "setup" project) runs
      // first and writes playwright/.auth/admin.json as a proper Playwright
      // storageState file; that state is loaded here before each test so the
      // admin bearer token is available in localStorage without any further
      // API calls.
      name: "admin-auth",
      testMatch: /admin-login\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/admin.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: disableManagedServer
    ? undefined
    : {
        command: process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
