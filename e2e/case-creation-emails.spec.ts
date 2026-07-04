/**
 * e2e/case-creation-emails.spec.ts
 *
 * End-to-end tests for route-level email wiring.
 *
 * Verifies three fire-and-forget email paths that unit tests cannot reach:
 *
 *   1. Admin creates a new case (POST /api/cases)
 *      → server fires sendAdminNewCaseAlert to the configured alert recipient(s).
 *
 *   2. Authenticated portal user sends a message (POST /api/cases/:id/messages)
 *      → server fires sendAdminNewMessageAlert to the configured alert recipient(s).
 *
 *   3. Admin creates a case that already has userEmail set (POST /api/cases with userEmail)
 *      → server fires sendCaseCreatedConfirmation to the case's userEmail.
 *
 * SMTP sink
 * ─────────
 * The dedicated CI job runs Mailhog (mailhog/mailhog Docker image) as a service
 * that captures outgoing SMTP at localhost:1025.  The test queries Mailhog's
 * HTTP API at http://SMTP_SINK_HOST:8025 to assert that the expected emails
 * arrived.  The spec is guarded with test.skip() so it is a no-op in all other
 * CI jobs and in local dev environments that have not configured the sink.
 *
 * Environment variables required by the dedicated CI job
 * ──────────────────────────────────────────────────────
 *   SMTP_SINK_HOST              hostname of the Mailhog HTTP API (e.g. "localhost")
 *   SMTP_HOST                   same hostname used for nodemailer transport
 *   SMTP_PORT                   "1025" — Mailhog SMTP port
 *   SMTP_PASSWORD               any non-empty value (Mailhog ignores auth)
 *   DOCUMENT_UPLOAD_ALERT_EMAIL alert recipient seeded in the server env
 *   ADMIN_USERNAME / ADMIN_PASSWORD  standard admin credentials
 *   DATABASE_URL                PostgreSQL connection string for data teardown
 */

import { test, expect, request } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  uniqueEmail,
  createCase,
  issuePortalSession,
  deleteCase,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const SMTP_SINK_HOST = process.env.SMTP_SINK_HOST ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";
const MAILHOG_API = `http://${SMTP_SINK_HOST}:8025`;

const TEST_PIN = "556677";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** DELETE /api/v1/messages — wipe every message currently in Mailhog. */
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

/**
 * Poll Mailhog until at least one message whose Subject header matches
 * `subjectSubstring` arrives, or until `timeoutMs` elapses.
 *
 * Returns the matching messages.  Throws if the timeout is reached.
 */
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

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe("Email alert wiring — E2E", () => {
  test.skip(
    !SMTP_SINK_HOST || !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "SMTP_SINK_HOST, ADMIN_USERNAME and ADMIN_PASSWORD must be set to run email alert e2e tests",
  );

  let adminToken: string;

  // Case used for portal-message test
  let messageCaseId: string;
  let messageCaseCode: string;
  let portalSessionToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (DATABASE_URL) await clearAdminRateLimit(DATABASE_URL);

    const api = await request.newContext({ baseURL: baseURL ?? "" });
    adminToken = readAdminToken();
    if (!adminToken) {
      const res = await api.post("/api/admin/login", {
        data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
      });
      expect(res.status(), "admin login").toBe(200);
      const body = await res.json();
      adminToken = body.token as string;
    }

    // Seed a case for the portal-message test.
    messageCaseCode = uniqueAccessCode("EMAIL-MSG");
    messageCaseId = await createCase(api, adminToken, messageCaseCode, {
      userName: "E2E Email Test User",
      extraPatch: { userEmail: uniqueEmail("email-msg") },
    });

    // Enrol a PIN so we can obtain a portal session.
    portalSessionToken = await issuePortalSession(
      api,
      messageCaseCode,
      TEST_PIN,
    );

    await api.dispose();
  });

  test.afterAll(async ({ baseURL }) => {
    const api = await request.newContext({ baseURL: baseURL ?? "" });
    try {
      await deleteCase(api, adminToken, messageCaseId);
    } finally {
      await api.dispose();
    }
  });

  // ── Test 1: admin new-case alert ────────────────────────────────────────────

  test("admin creates a case → sendAdminNewCaseAlert email arrives in SMTP sink", async ({
    baseURL,
  }) => {
    await clearMailhog();

    const api = await request.newContext({ baseURL: baseURL ?? "" });
    const newCode = uniqueAccessCode("EMAIL-CASE");
    let newCaseId: string | undefined;
    try {
      const created = await api.post("/api/cases", {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { accessCode: newCode, status: "active" },
      });
      expect(created.status(), "create case").toBe(200);
      const body = await created.json();
      newCaseId = body.id as string;

      // The email is fire-and-forget; poll until it arrives.
      const msgs = await waitForEmail("[IBCCF] New case submitted");
      expect(msgs.length, "at least one admin new-case alert email").toBeGreaterThan(0);

      const first = msgs[0];
      const subjects = first.Content.Headers.Subject ?? [];
      // The email uses caseId (the numeric DB id returned by POST /api/cases),
      // not the access code.  See server/routes/cases.ts sendAdminNewCaseAlert call.
      expect(subjects[0] ?? "", "subject contains numeric case ID").toContain(String(newCaseId));
    } finally {
      if (newCaseId) await deleteCase(api, adminToken, newCaseId);
      await api.dispose();
    }
  });

  // ── Test 2: portal-message alert ───────────────────────────────────────────

  test("portal user sends a message → sendAdminNewMessageAlert email arrives in SMTP sink", async ({
    baseURL,
  }) => {
    await clearMailhog();

    const api = await request.newContext({ baseURL: baseURL ?? "" });
    try {
      const msgRes = await api.post(
        `/api/cases/${messageCaseId}/messages`,
        {
          headers: {
            "x-portal-session-token": portalSessionToken,
            "Content-Type": "application/json",
          },
          data: { sender: "user", message: "E2E test message — please ignore" },
        },
      );
      expect(
        [200, 201],
        `send message (status ${msgRes.status()})`,
      ).toContain(msgRes.status());

      // The email is fire-and-forget; poll until it arrives.
      const msgs = await waitForEmail("[IBCCF] New message from portal user");
      expect(msgs.length, "at least one admin new-message alert email").toBeGreaterThan(0);

      const first = msgs[0];
      const subjects = first.Content.Headers.Subject ?? [];
      expect(
        subjects[0] ?? "",
        "subject contains case ID",
      ).toContain(messageCaseId);
    } finally {
      await api.dispose();
    }
  });

  // ── Test 3: user-facing case-created confirmation ───────────────────────────

  test("admin creates a case with userEmail set → sendCaseCreatedConfirmation email arrives in SMTP sink", async ({
    baseURL,
  }) => {
    await clearMailhog();

    const api = await request.newContext({ baseURL: baseURL ?? "" });
    const newCode = uniqueAccessCode("EMAIL-CONF");
    const caseUserEmail = uniqueEmail("case-created");
    let newCaseId: string | undefined;
    try {
      // Pass userEmail at creation time so the fire-and-forget block in
      // POST /api/cases finds it immediately when it calls getCaseById.
      const created = await api.post("/api/cases", {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { accessCode: newCode, status: "active", userEmail: caseUserEmail },
      });
      expect(created.status(), "create case with userEmail").toBe(200);
      const body = await created.json();
      newCaseId = body.id as string;

      // The email is fire-and-forget; poll until it arrives.
      const msgs = await waitForEmail("Your Case Has Been Registered");
      expect(msgs.length, "at least one case-created confirmation email").toBeGreaterThan(0);

      // Verify the email was addressed to the case's userEmail.
      const toHeaders = msgs[0].Content.Headers.To ?? [];
      expect(
        toHeaders.join(", "),
        "To: header contains the case userEmail",
      ).toContain(caseUserEmail);

      // Verify the subject contains the case reference (numeric DB id).
      const subjects = msgs[0].Content.Headers.Subject ?? [];
      expect(
        subjects[0] ?? "",
        "subject contains the numeric case ID",
      ).toContain(String(newCaseId));
    } finally {
      if (newCaseId) await deleteCase(api, adminToken, newCaseId);
      await api.dispose();
    }
  });
});
