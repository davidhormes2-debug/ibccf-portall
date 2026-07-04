// E2E smoke: verifies that GET /api/visitors/typing/:caseId enforces its
// per-IP rate limit at the live server level, not just at the unit-test
// (mock) level.  If the rateLimiter() middleware is ever accidentally
// dropped from the mount chain in server/routes/visitors.ts — wrong router,
// re-ordering, or skipped middleware — the unit test in
// server/__tests__/publicPostRateLimit.test.ts would still pass while this
// spec would fail, catching the regression immediately.
//
// Design notes
// ─────────────
// • Uses Playwright's built-in `request` APIRequestContext to GET directly
//   from the server API without loading any page.
// • Sets X-Forwarded-For on every request.  `app.set("trust proxy", 1)` in
//   server/index.ts makes Express resolve req.ip from the single trusted
//   upstream hop, so the rate-limiter key becomes the forged IP.  This is
//   the same approach used by the unit-test suite and the heartbeat /
//   satisfaction / POST-typing rate-limit IP-isolation specs.
// • Requests 1–120 from a given IP reach the route handler (TYPING_RATE_MAX
//   = 120).  They may return 200 or a non-429 status.  We assert on !429
//   rather than 200 to avoid a dependency on business-logic preconditions
//   (e.g. a seeded case).
// • The 121st request from the same IP is intercepted by the rate limiter
//   before the handler runs → 429 + Retry-After.
// • A fresh IP gets 1 counter entry and is not blocked → !429.
// • Each test draws fresh IPs from the module-level counter so counter rows
//   never overlap, even on test retry.
// • Skip guard: the test is gated on CI being set because it requires the
//   live server boot that Playwright provides in CI and fires 120+ requests,
//   making it unsuitable for quick local development without a running server.

import { test, expect } from "@playwright/test";

const CI = process.env.CI ?? "";

let ipSuffix = 1;
function freshIp(): string {
  const n = ipSuffix++;
  return `10.215.${Math.floor(n / 256)}.${n % 256}`;
}

const TYPING_RATE_MAX = 120;

test.describe("GET /api/visitors/typing/:caseId — IP-isolated rate limit (live server)", () => {
  test.skip(!CI, "rate-limit isolation test requires the live server; set CI=1 to run");
  test.setTimeout(180_000);

  test("120 GETs from the same IP pass the rate limiter; the 121st gets 429", async ({
    request,
  }) => {
    const ipA = freshIp();
    const caseId = `e2e-ty-get-rl-${ipA.replace(/\./g, "-")}`;

    for (let i = 0; i < TYPING_RATE_MAX; i++) {
      const res = await request.get(`/api/visitors/typing/${caseId}`, {
        headers: { "X-Forwarded-For": ipA },
      });
      expect(
        res.status(),
        `request ${i + 1} from ${ipA} must not be rate-limited (got ${res.status()})`,
      ).not.toBe(429);
    }

    const blocked = await request.get(`/api/visitors/typing/${caseId}`, {
      headers: { "X-Forwarded-For": ipA },
    });
    expect(
      blocked.status(),
      `request ${TYPING_RATE_MAX + 1} from ${ipA} must be rate-limited`,
    ).toBe(429);

    const retryAfter = blocked.headers()["retry-after"];
    expect(
      retryAfter,
      "429 response must include a Retry-After header",
    ).toBeDefined();
  });

  test("a different IP is not blocked after another IP exhausts its quota", async ({
    request,
  }) => {
    const ipA = freshIp();
    const ipB = freshIp();
    const caseIdA = `e2e-ty-get-rl-${ipA.replace(/\./g, "-")}`;
    const caseIdB = `e2e-ty-get-rl-${ipB.replace(/\./g, "-")}`;

    for (let i = 0; i < TYPING_RATE_MAX; i++) {
      await request.get(`/api/visitors/typing/${caseIdA}`, {
        headers: { "X-Forwarded-For": ipA },
      });
    }

    const blockedA = await request.get(`/api/visitors/typing/${caseIdA}`, {
      headers: { "X-Forwarded-For": ipA },
    });
    expect(
      blockedA.status(),
      `request ${TYPING_RATE_MAX + 1} from ${ipA} must be 429`,
    ).toBe(429);

    const allowedB = await request.get(`/api/visitors/typing/${caseIdB}`, {
      headers: { "X-Forwarded-For": ipB },
    });
    expect(
      allowedB.status(),
      `first request from ${ipB} must not be rate-limited after ${ipA} is blocked`,
    ).not.toBe(429);
  });
});
