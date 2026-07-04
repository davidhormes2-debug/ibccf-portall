/**
 * e2e/admin-emergency-reset.spec.ts
 *
 * End-to-end coverage of the full admin lockout-recovery journey described in
 * replit.md → "Admin login recovery" (self-service path):
 *
 *   1. On the /admin login screen, click "Locked out? Request emergency
 *      access recovery" and submit the request
 *      (POST /api/admin/emergency-reset/request).
 *   2. The server emails a single-use reset link to ADMIN_RECOVERY_EMAIL.
 *   3. Open that link at /admin/emergency-reset?token=... and set a new
 *      admin password (POST /api/admin/emergency-reset/confirm).
 *   4. Log in at /admin with the new password and confirm the dashboard
 *      loads.
 *
 * A backend-only unit-test suite (server/__tests__/adminEmergencyReset.test.ts)
 * already covers the request/confirm route logic in isolation. This spec
 * exists to catch UI wiring bugs a backend suite cannot see: a broken
 * "Locked out?" link, a dialog that never fires the request, a reset form
 * that submits the wrong field name, or a stale success/error message.
 *
 * SMTP sink
 * ─────────
 * Same Mailhog pattern as e2e/case-creation-emails.spec.ts: a dedicated CI
 * job runs Mailhog (mailhog/mailhog Docker image) as a service that captures
 * outgoing SMTP at localhost:1025, and the test reads the captured message
 * via Mailhog's HTTP API at http://SMTP_SINK_HOST:8025 to recover the
 * single-use reset token (never exposed via the HTTP response — see
 * server/routes/admin.ts emergency-reset/request).
 *
 * Environment variables required by the dedicated CI job
 * ──────────────────────────────────────────────────────
 *   SMTP_SINK_HOST       hostname of the Mailhog HTTP API (e.g. "localhost")
 *   SMTP_HOST            same hostname used for nodemailer transport
 *   SMTP_PORT            "1025" — Mailhog SMTP port
 *   SMTP_PASSWORD        any non-empty value (Mailhog ignores auth)
 *   ADMIN_RECOVERY_EMAIL recovery-address the server emails the link to
 *   ADMIN_USERNAME / ADMIN_PASSWORD  standard admin credentials
 *   DATABASE_URL         PostgreSQL connection string for rate-limit reset
 *                         and post-test cleanup
 */

import { test, expect, request, type Page } from "@playwright/test";
import { Client } from "pg";
import { clearAdminRateLimit } from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const ADMIN_RECOVERY_EMAIL = process.env.ADMIN_RECOVERY_EMAIL ?? "";
const SMTP_SINK_HOST = process.env.SMTP_SINK_HOST ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";
const MAILHOG_API = `http://${SMTP_SINK_HOST}:8025`;

const NEW_PASSWORD = "Em3rgency!Reset#Pass2024";

// ── Mailhog helpers ─────────────────────────────────────────────────────────

async function clearMailhog(): Promise<void> {
  const api = await request.newContext({ baseURL: MAILHOG_API });
  try {
    await api.delete("/api/v1/messages");
  } finally {
    await api.dispose();
  }
}

interface MailhogMessage {
  Content: {
    Headers: Record<string, string[]>;
    Body: string;
  };
}

interface MailhogResponse {
  total: number;
  items: MailhogMessage[];
}

async function waitForEmail(
  subjectSubstring: string,
  { timeoutMs = 15_000, intervalMs = 500 } = {},
): Promise<MailhogMessage[]> {
  const deadline = Date.now() + timeoutMs;
  const api = await request.newContext({ baseURL: MAILHOG_API });
  try {
    while (Date.now() < deadline) {
      const res = await api.get("/api/v2/messages");
      if (res.ok()) {
        const body = (await res.json()) as MailhogResponse;
        const matched = (body.items ?? []).filter((msg) => {
          const subjects = msg.Content?.Headers?.Subject ?? [];
          return subjects.some((s) => s.includes(subjectSubstring));
        });
        if (matched.length > 0) return matched;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  } finally {
    await api.dispose();
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for email with subject containing "${subjectSubstring}"`,
  );
}

/** Undo nodemailer's quoted-printable body encoding (soft breaks + =XX escapes). */
function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

/** Extract the single-use reset token from the emailed link body. */
function extractResetToken(mailhogBody: string): string {
  const decoded = decodeQuotedPrintable(mailhogBody);
  const match = decoded.match(/[?&]token=([A-Za-z0-9_-]+)/);
  if (!match) {
    throw new Error(
      "Could not find a token= query param in the emergency reset email body",
    );
  }
  return match[1];
}

// ── DB cleanup ───────────────────────────────────────────────────────────────

/**
 * Clear admin_password_override / admin_password_override_strength directly
 * so a successful run of this spec doesn't leave later specs unable to log
 * in with ADMIN_USERNAME/ADMIN_PASSWORD. Mirrors the manual-recovery runbook
 * in replit.md ("UPDATE app_settings SET value = '' WHERE key IN (...)").
 */
async function clearPasswordOverride(databaseUrl: string): Promise<void> {
  if (!databaseUrl) return;
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    await pg.query(
      `UPDATE app_settings SET value = '' WHERE key IN ('admin_password_override', 'admin_password_override_strength', 'admin_username_override')`,
    );
  } finally {
    await pg.end();
  }
}

// ── UI helpers ───────────────────────────────────────────────────────────────

async function loginAsAdmin(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto("/admin");
  await page.getByTestId("input-admin-username").fill(username);
  await page.getByTestId("input-admin-password").fill(password);
  await page.getByTestId("button-admin-login").click();
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe("Admin lockout recovery — full E2E journey", () => {
  test.beforeAll(async () => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin emergency-reset e2e test",
      );
    }
    if (!ADMIN_RECOVERY_EMAIL) {
      throw new Error(
        "ADMIN_RECOVERY_EMAIL must be set to run the admin emergency-reset e2e test",
      );
    }
    if (!SMTP_SINK_HOST) {
      throw new Error(
        "SMTP_SINK_HOST must be set to run the admin emergency-reset e2e test (Mailhog sink)",
      );
    }
    if (DATABASE_URL) await clearAdminRateLimit(DATABASE_URL);
  });

  test.afterAll(async () => {
    // Restore the environment-var admin credentials regardless of whether
    // the test succeeded, so later specs that log in with ADMIN_USERNAME /
    // ADMIN_PASSWORD are not left locked out by this spec's own reset.
    await clearPasswordOverride(DATABASE_URL);
  });

  test("locked-out admin can request, confirm, and log in with a new password via the emailed link", async ({
    page,
  }) => {
    await clearMailhog();

    // ---------- Step 1: request emergency reset from the login screen ----------
    await page.goto("/admin");
    await expect(page.getByTestId("input-admin-password")).toBeVisible();

    await page.getByTestId("button-emergency-reset-link").click();
    await expect(page.getByTestId("button-emergency-reset-submit")).toBeVisible();
    await page.getByTestId("button-emergency-reset-submit").click();

    const requestResult = page.getByTestId("text-emergency-reset-result");
    await expect(requestResult).toBeVisible({ timeout: 10_000 });
    await expect(requestResult).toContainText(/emailed/i);

    // ---------- Step 2: recover the single-use token from the Mailhog sink ----------
    const msgs = await waitForEmail("Emergency admin login reset");
    expect(msgs.length, "at least one emergency reset email").toBeGreaterThan(0);

    const toHeaders = msgs[0].Content.Headers.To ?? [];
    expect(
      toHeaders.join(", "),
      "reset email addressed to ADMIN_RECOVERY_EMAIL",
    ).toContain(ADMIN_RECOVERY_EMAIL);

    const token = extractResetToken(msgs[0].Content.Body);
    expect(token.length, "extracted a non-trivial token").toBeGreaterThan(10);

    // ---------- Step 3: open the emailed link and set a new password ----------
    await page.goto(`/admin/emergency-reset?token=${encodeURIComponent(token)}`);
    await expect(page.getByLabel(/new password/i, { exact: false }).first()).toBeVisible();

    await page.locator("#newPassword").fill(NEW_PASSWORD);
    await page.locator("#confirmPassword").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /reset admin credentials/i }).click();

    await expect(
      page.getByText(/admin credentials have been updated/i),
    ).toBeVisible({ timeout: 10_000 });

    // ---------- Step 4: log in with the new password ----------
    await page.getByRole("button", { name: /go to admin login/i }).click();
    await expect(page.getByTestId("input-admin-username")).toBeVisible();

    await loginAsAdmin(page, ADMIN_USERNAME, NEW_PASSWORD);
    await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
      timeout: 30_000,
    });

    // ---------- Sanity check: the old password no longer works ----------
    await page.evaluate(() => sessionStorage.clear());
    await page.goto("/admin");
    await loginAsAdmin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await expect(page.getByTestId("alert-admin-login-error")).toBeVisible({
      timeout: 10_000,
    });
  });
});
