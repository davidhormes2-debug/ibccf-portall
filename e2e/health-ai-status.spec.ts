// Playwright E2E smoke test confirming GET /health reports a non-degraded
// ai.status after the server boots, and that the DB and SMTP probe fields are
// also correctly serialised in the response.
//
// The unit tests in server/__tests__/health.test.ts mock checkAi() entirely.
// This spec exercises the real route plumbing — serialisation, status-code
// logic, and the checkAi() → healthRouter wiring — by hitting the live server.
//
// In the CI environment OPENAI_API_KEY is not set, so checkAi() returns
// { status: "unconfigured" } and the endpoint returns HTTP 200.  If a real
// key is present and the probe succeeds, ai.status will be "ok".  Either
// outcome is acceptable; the only invalid value is "degraded".
//
// The CI database is always up, so db.status must be "ok".
// SMTP vars are not set in CI, so smtp.status is "ok" or "unconfigured".
//
// The test uses Playwright's `request` fixture so no browser window is
// launched — it is a pure HTTP assertion against the booted Express server.

import { test, expect } from "@playwright/test";

test("GET /health returns 200 and ai.status is ok or unconfigured (never degraded)", async ({
  request,
}) => {
  const res = await request.get("/health");

  expect(res.status()).toBe(200);

  const body = await res.json() as {
    ai?: { status: string };
    db?: { status: string };
    smtp?: { status: string };
    recentEmailFailures?: number;
    uptime?: number;
    version?: string;
  };

  expect(body).toHaveProperty("ai");
  expect(body).toHaveProperty("db");
  expect(body).toHaveProperty("smtp");
  expect(typeof body.uptime).toBe("number");
  expect(typeof body.version).toBe("string");

  const aiStatus = body.ai?.status;
  expect(["ok", "unconfigured"]).toContain(aiStatus);
  expect(aiStatus).not.toBe("degraded");
});

test("GET /health db.status is ok and smtp.status is ok or unconfigured", async ({
  request,
}) => {
  const res = await request.get("/health");

  expect(res.status()).toBe(200);

  const body = await res.json() as {
    db?: { status: string };
    smtp?: { status: string; error?: string };
    recentEmailFailures?: number;
  };

  // The CI database is always reachable — any value other than "ok" indicates
  // a real infrastructure problem or a serialisation regression in the DB probe.
  expect(body.db?.status).toBe("ok");

  // SMTP may not be configured in CI (no SMTP_HOST env var), so both "ok" and
  // "unconfigured" are valid. "degraded" is never acceptable.
  const smtpStatus = body.smtp?.status;
  expect(["ok", "unconfigured"]).toContain(smtpStatus);
  expect(smtpStatus).not.toBe("degraded");

  // recentEmailFailures must always be present and be a non-negative integer.
  expect(typeof body.recentEmailFailures).toBe("number");
  expect(body.recentEmailFailures).toBeGreaterThanOrEqual(0);
});
