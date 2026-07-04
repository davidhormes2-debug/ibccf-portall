/**
 * Shared e2e test helpers.
 *
 * Centralises utilities that were copy-pasted across many spec files:
 *   - readAdminToken / AUTH_FILE
 *   - uniqueAccessCode / uniqueEmail
 *   - TINY_PNG_DATA_URL / TINY_PDF_DATA_URL
 *   - createCase / issuePortalSession / deleteCase
 *   - loginAdminUi (token-injection variant)
 *   - loginAdminApi (POST /api/admin/login)
 *   - clearAdminRateLimit (DELETE FROM admin_login_attempts)
 */

import { randomBytes } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Timeouts ────────────────────────────────────────────────────────────────

/**
 * Scale a per-test timeout for local (non-CI) runs.
 *
 * CI runs against a freshly-seeded/near-empty database with dedicated CPU
 * and consistently completes the admin-dashboard fan-out (login + ~19
 * concurrent GETs, including `GET /api/cases`) in a few seconds. In this
 * Replit dev sandbox the same fan-out competes for 2 vCPUs with a real
 * headless Chromium instance, the Vite/tsx dev server, and already-running
 * TS language servers, while the shared local dev DB has accumulated
 * thousands of case rows from repeated manual/e2e runs over time. Under that
 * combined contention, individual requests (most often `GET /api/cases`)
 * have been observed to stall 70-100+ seconds even though the query itself
 * takes well under a second in isolation — a sandbox resource-contention
 * effect, not an application bug (see `.agents/memory/local-devdb-case-volume.md`).
 *
 * Doubling the CI budget for local runs gives headroom to absorb that
 * observed worst case without masking real regressions in CI, where this
 * function is a no-op.
 */
export function localTimeout(ciTimeoutMs: number): number {
  return process.env.CI ? ciTimeoutMs : ciTimeoutMs * 2;
}

// ─── Auth file ───────────────────────────────────────────────────────────────

/** Path to the pre-fetched admin bearer token written by global-setup.ts. */
export const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

/**
 * Read the pre-fetched admin bearer token from the global-setup auth file.
 * Returns an empty string when the file is absent (e.g. CI without setup).
 */
export function readAdminToken(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")) as {
      token?: string;
    };
    return raw.token ?? "";
  } catch {
    return "";
  }
}

// ─── Unique value generators ──────────────────────────────────────────────────

/**
 * Generate a collision-resistant access code for test cases.
 * @param prefix - Short label prepended before the random hex suffix (default "E2E").
 */
export function uniqueAccessCode(prefix = "E2E"): string {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/**
 * Generate a unique e-mail address for test users.
 * @param prefix - Local-part prefix before the random hex segment (default "e2e").
 */
export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${randomBytes(3).toString("hex")}@example.com`;
}

// ─── Reusable asset constants ─────────────────────────────────────────────────

/** Minimal 1×1 transparent PNG expressed as a base64 data URL. */
export const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** Minimal valid PDF expressed as a base64 data URL. */
export const TINY_PDF_DATA_URL =
  "data:application/pdf;base64,JVBERi0xLjAKMSAwIG9iago8PC9UeXBlIC9DYXRhbG9nIC9QYWdlcyAyIDAgUj4+CmVuZG9iagoyIDAgb2JqCjw8L1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlIC9QYWdlIC9QYXJlbnQgMiAwIFIgL01lZGlhQm94IFswIDAgMzYwIDM2MF0+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNCAvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoxOTgKJSVFT0YK";

// ─── API helpers ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/login using ADMIN_USERNAME / ADMIN_PASSWORD from env.
 * Returns the bearer token on success.
 */
export async function loginAdminApi(api: APIRequestContext): Promise<string> {
  const username = process.env.ADMIN_USERNAME ?? "";
  const password = process.env.ADMIN_PASSWORD ?? "";
  const res = await api.post("/api/admin/login", {
    data: { username, password },
  });
  expect(res.status(), "admin login").toBe(200);
  const body = await res.json();
  expect(body.success, "admin login success").toBe(true);
  return body.token as string;
}

/**
 * Create a minimal active case via the admin API.
 * Returns the numeric case ID as a string.
 *
 * @param options.userName   Display name stored on the case (default "E2E Test Case").
 * @param options.extraPatch Additional fields merged into the PATCH body.
 */
export async function createCase(
  api: APIRequestContext,
  adminToken: string,
  accessCode: string,
  options?: { userName?: string; extraPatch?: Record<string, unknown> },
): Promise<string> {
  const { userName = "E2E Test Case", extraPatch = {} } = options ?? {};

  const created = await api.post("/api/cases", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { accessCode, status: "active" },
  });
  expect(created.status(), "create case").toBe(200);
  const body = await created.json();
  const caseId = body.id as string;

  const patched = await api.patch(`/api/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      userName,
      userEmail: uniqueEmail(),
      status: "active",
      ...extraPatch,
    },
  });
  expect(patched.status(), "patch case").toBe(200);
  return caseId;
}

/**
 * Enrol a PIN for a case via POST /api/cases/set-pin.
 * Returns the portal session token issued by the server.
 */
export async function issuePortalSession(
  api: APIRequestContext,
  accessCode: string,
  pin: string,
): Promise<string> {
  const res = await api.post("/api/cases/set-pin", {
    data: { accessCode, pin },
  });
  expect(res.status(), "set pin").toBe(200);
  const body = await res.json();
  expect(typeof body.sessionToken).toBe("string");
  return body.sessionToken as string;
}

/**
 * Delete a case via DELETE /api/cases/:id?force=true.
 * Accepts 200 (deleted) or 404 (already gone) — both are safe for teardown.
 */
export async function deleteCase(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.delete(`/api/cases/${caseId}?force=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(
    [200, 404],
    `teardown delete case ${caseId} (status ${res.status()})`,
  ).toContain(res.status());
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

/**
 * Inject the pre-fetched admin bearer token into sessionStorage then navigate
 * to /admin.  Waits for `button-notifications` as the stable "dashboard is
 * fully mounted" signal.  Zero rate-limit slots consumed.
 *
 * Deliberately NOT `admin-case-finder-trigger`: that button is
 * `hidden md:inline-flex` (desktop-only), so waiting on it hangs forever on
 * any narrow/mobile viewport (`test.use({ viewport: ... })` below the `md`
 * breakpoint) — confirmed while validating admin-reactivation-badge-mobile-nav
 * under real local timing. `button-notifications` has no responsive-hide
 * class and mounts at the same time, so it works at every viewport width.
 */
export async function loginAdminUi(page: Page): Promise<void> {
  const token = readAdminToken();
  await page.addInitScript(
    (t) => { if (t) sessionStorage.setItem("adminToken", t); },
    token,
  );
  await page.goto("/admin");
  await expect(page.getByTestId("button-notifications")).toBeVisible({
    timeout: 30_000,
  });
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Clear the admin_login_attempts table so prior test runs or other specs
 * don't exhaust the 5-per-15-minute login rate limit.
 *
 * @param databaseUrl  Connection string.  No-ops when empty.
 */
export async function clearAdminRateLimit(databaseUrl: string): Promise<void> {
  if (!databaseUrl) return;
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    await pg.query("DELETE FROM admin_login_attempts");
  } finally {
    await pg.end();
  }
}

/**
 * Rewind portal_warning_at for a case to a point `secondsAgo` seconds in the
 * past.  Used in auto-logout E2E tests to make a 1-minute warning nearly
 * expired so the timer fires within a few seconds of page load rather than
 * forcing a real 60-second wait.
 *
 * @param databaseUrl  PostgreSQL connection string.  No-ops when empty.
 * @param caseId       Numeric case ID as a string.
 * @param secondsAgo   How many seconds to subtract from NOW().
 */
export async function backdatePortalWarning(
  databaseUrl: string,
  caseId: string,
  secondsAgo: number,
): Promise<void> {
  if (!databaseUrl) return;
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    await pg.query(
      `UPDATE cases
         SET portal_warning_at = NOW() - ($1 || ' seconds')::INTERVAL
       WHERE id = $2`,
      [String(secondsAgo), caseId],
    );
  } finally {
    await pg.end();
  }
}
