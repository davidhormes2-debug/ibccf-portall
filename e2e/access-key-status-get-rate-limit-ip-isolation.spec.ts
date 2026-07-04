// E2E smoke: verifies that the two public-facing GET endpoints in
// server/routes/access-key-requests.ts enforce their per-IP rate limit at the
// live server level, not just at the unit-test (mock) level.
//
//   GET /api/access-key-requests/status/:requestId   — keyRequestStatusLimiter (20/min)
//   GET /api/access-key-requests/case/:caseId        — keyRequestStatusLimiter (20/min)
//
// If the keyRequestStatusLimiter middleware is ever accidentally dropped from
// either mount chain — wrong router, re-ordering, or skipped middleware — the
// unit tests in server/__tests__/publicPostRateLimit.test.ts would still pass
// while this spec would fail, catching the regression immediately.
//
// Design notes
// ─────────────
// • Uses Playwright's built-in `request` APIRequestContext to GET directly
//   from the server API without loading any page.
// • Sets X-Forwarded-For on every request.  `app.set("trust proxy", 1)` in
//   server/index.ts makes Express resolve req.ip from the single trusted
//   upstream hop, so the rate-limiter key becomes the forged IP.  This is
//   the same approach used by the unit-test suite and the other IP-isolation
//   specs.
// • keyRequestStatusLimiter allows 20 req/min per IP.  Requests 1–20 from a
//   given IP reach the route handler and may return any non-429 status (404
//   for unknown IDs/cases, 401 for the case-scoped endpoint with no session,
//   etc.).  We assert on !429 rather than 200 to avoid a dependency on
//   business-logic preconditions.
// • The 21st request from the same IP is intercepted by the rate limiter
//   before the handler runs → 429 + Retry-After.
// • A fresh IP gets 1 counter entry and is not blocked → !429.
// • Each test draws fresh IPs from the module-level counter so counter rows
//   never overlap, even on test retry.
// • Subnet 10.217.x.y is reserved for this spec to avoid counter overlap
//   with other rate-limit IP-isolation specs using different subnets.
// • Skip guard: the test is gated on CI being set because it requires the
//   live server boot that Playwright provides in CI and fires 20+ requests,
//   making it unsuitable for quick local development without a running server.

import { test, expect } from "@playwright/test";

const CI = process.env.CI ?? "";

let ipSuffix = 1;
function freshIp(): string {
  const n = ipSuffix++;
  return `10.217.${Math.floor(n / 256)}.${n % 256}`;
}

const KEY_REQUEST_STATUS_RATE_MAX = 20;

test.describe("GET /api/access-key-requests/status/:requestId — IP-isolated rate limit (live server)", () => {
  test.skip(!CI, "rate-limit isolation test requires the live server; set CI=1 to run");
  test.setTimeout(120_000);

  test("20 GETs from the same IP pass the rate limiter; the 21st gets 429", async ({
    request,
  }) => {
    const ipA = freshIp();
    const requestId = `REQ-E2ETEST-STATUSRL-${ipA.replace(/\./g, "-")}`;

    for (let i = 0; i < KEY_REQUEST_STATUS_RATE_MAX; i++) {
      const res = await request.get(
        `/api/access-key-requests/status/${requestId}`,
        { headers: { "X-Forwarded-For": ipA } },
      );
      expect(
        res.status(),
        `request ${i + 1} from ${ipA} must not be rate-limited (got ${res.status()})`,
      ).not.toBe(429);
    }

    const blocked = await request.get(
      `/api/access-key-requests/status/${requestId}`,
      { headers: { "X-Forwarded-For": ipA } },
    );
    expect(
      blocked.status(),
      `request ${KEY_REQUEST_STATUS_RATE_MAX + 1} from ${ipA} must be rate-limited`,
    ).toBe(429);

    const retryAfter = blocked.headers()["retry-after"];
    expect(
      retryAfter,
      "429 response must include a Retry-After header",
    ).toBeDefined();
  });

  test("a different IP is not blocked after another IP exhausts its quota on /status/:requestId", async ({
    request,
  }) => {
    const ipA = freshIp();
    const ipB = freshIp();
    const requestIdA = `REQ-E2ETEST-STATUSRL-A-${ipA.replace(/\./g, "-")}`;
    const requestIdB = `REQ-E2ETEST-STATUSRL-B-${ipB.replace(/\./g, "-")}`;

    for (let i = 0; i < KEY_REQUEST_STATUS_RATE_MAX; i++) {
      await request.get(`/api/access-key-requests/status/${requestIdA}`, {
        headers: { "X-Forwarded-For": ipA },
      });
    }

    const blockedA = await request.get(
      `/api/access-key-requests/status/${requestIdA}`,
      { headers: { "X-Forwarded-For": ipA } },
    );
    expect(
      blockedA.status(),
      `request ${KEY_REQUEST_STATUS_RATE_MAX + 1} from ${ipA} must be 429`,
    ).toBe(429);

    const allowedB = await request.get(
      `/api/access-key-requests/status/${requestIdB}`,
      { headers: { "X-Forwarded-For": ipB } },
    );
    expect(
      allowedB.status(),
      `first request from ${ipB} must not be rate-limited after ${ipA} is blocked`,
    ).not.toBe(429);
  });
});

test.describe("GET /api/access-key-requests/case/:caseId — IP-isolated rate limit (live server)", () => {
  test.skip(!CI, "rate-limit isolation test requires the live server; set CI=1 to run");
  test.setTimeout(120_000);

  test("20 GETs from the same IP pass the rate limiter; the 21st gets 429", async ({
    request,
  }) => {
    const ipA = freshIp();
    const caseId = `e2e-akr-case-rl-${ipA.replace(/\./g, "-")}`;

    for (let i = 0; i < KEY_REQUEST_STATUS_RATE_MAX; i++) {
      const res = await request.get(
        `/api/access-key-requests/case/${caseId}`,
        { headers: { "X-Forwarded-For": ipA } },
      );
      expect(
        res.status(),
        `request ${i + 1} from ${ipA} must not be rate-limited (got ${res.status()})`,
      ).not.toBe(429);
    }

    const blocked = await request.get(
      `/api/access-key-requests/case/${caseId}`,
      { headers: { "X-Forwarded-For": ipA } },
    );
    expect(
      blocked.status(),
      `request ${KEY_REQUEST_STATUS_RATE_MAX + 1} from ${ipA} must be rate-limited`,
    ).toBe(429);

    const retryAfter = blocked.headers()["retry-after"];
    expect(
      retryAfter,
      "429 response must include a Retry-After header",
    ).toBeDefined();
  });

  test("a different IP is not blocked after another IP exhausts its quota on /case/:caseId", async ({
    request,
  }) => {
    const ipA = freshIp();
    const ipB = freshIp();
    const caseIdA = `e2e-akr-case-rl-a-${ipA.replace(/\./g, "-")}`;
    const caseIdB = `e2e-akr-case-rl-b-${ipB.replace(/\./g, "-")}`;

    for (let i = 0; i < KEY_REQUEST_STATUS_RATE_MAX; i++) {
      await request.get(`/api/access-key-requests/case/${caseIdA}`, {
        headers: { "X-Forwarded-For": ipA },
      });
    }

    const blockedA = await request.get(
      `/api/access-key-requests/case/${caseIdA}`,
      { headers: { "X-Forwarded-For": ipA } },
    );
    expect(
      blockedA.status(),
      `request ${KEY_REQUEST_STATUS_RATE_MAX + 1} from ${ipA} must be 429`,
    ).toBe(429);

    const allowedB = await request.get(
      `/api/access-key-requests/case/${caseIdB}`,
      { headers: { "X-Forwarded-For": ipB } },
    );
    expect(
      allowedB.status(),
      `first request from ${ipB} must not be rate-limited after ${ipA} is blocked`,
    ).not.toBe(429);
  });
});
