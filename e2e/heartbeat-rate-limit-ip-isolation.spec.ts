// E2E smoke: verifies that POST /api/visitors/heartbeat enforces its
// per-IP rate limit at the live server level, not just at the unit-test
// (mock) level.  If the rateLimiter() middleware is ever accidentally
// dropped from the mount chain in server/routes/visitors.ts — wrong router,
// re-ordering, or skipped middleware — the unit test in
// server/__tests__/publicPostRateLimit.test.ts would still pass while this
// spec would fail, catching the regression immediately.
//
// Design notes
// ─────────────
// • Uses Playwright's built-in `request` APIRequestContext to POST directly
//   to the server API without loading any page.
// • Sets X-Forwarded-For on every request.  `app.set("trust proxy", 1)` in
//   server/index.ts makes Express resolve req.ip from the single trusted
//   upstream hop, so the rate-limiter key becomes the forged IP.  This is
//   the same approach used by the unit-test suite and the satisfaction
//   rate-limit IP-isolation spec.
// • Requests 1–60 from a given IP reach the route handler (HEARTBEAT_RATE_MAX
//   = 60).  They may return 200 (visitor upserted) or a non-429 status.  We
//   assert on !429 rather than 200 to avoid a dependency on seeded visitor
//   data.
// • The 61st request from the same IP is intercepted by the rate limiter
//   before the handler runs → 429 + Retry-After.
// • A fresh IP gets 1 counter entry and is not blocked → !429.
// • Each test draws fresh IPs from the module-level counter so DB counter
//   rows never overlap, even on test retry.

import { test, expect } from "@playwright/test";

let ipSuffix = 1;
function freshIp(): string {
  const n = ipSuffix++;
  return `10.211.${Math.floor(n / 256)}.${n % 256}`;
}

const HEARTBEAT_RATE_MAX = 60;

function heartbeatBody(visitorId: string) {
  return {
    visitorId,
    currentPage: "/e2e-rl-test",
    isIdle: false,
  };
}

test.describe("POST /api/visitors/heartbeat — IP-isolated rate limit (live server)", () => {
  test.setTimeout(120_000);

  test("60 POSTs from the same IP pass the rate limiter; the 61st gets 429", async ({
    request,
  }) => {
    const ipA = freshIp();
    const visitorId = `e2e-hb-rl-${ipA.replace(/\./g, "-")}`;

    for (let i = 0; i < HEARTBEAT_RATE_MAX; i++) {
      const res = await request.post("/api/visitors/heartbeat", {
        headers: { "X-Forwarded-For": ipA },
        data: heartbeatBody(visitorId),
      });
      expect(
        res.status(),
        `request ${i + 1} from ${ipA} must not be rate-limited (got ${res.status()})`,
      ).not.toBe(429);
    }

    const blocked = await request.post("/api/visitors/heartbeat", {
      headers: { "X-Forwarded-For": ipA },
      data: heartbeatBody(visitorId),
    });
    expect(
      blocked.status(),
      `request ${HEARTBEAT_RATE_MAX + 1} from ${ipA} must be rate-limited`,
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
    const visitorIdA = `e2e-hb-rl-${ipA.replace(/\./g, "-")}`;
    const visitorIdB = `e2e-hb-rl-${ipB.replace(/\./g, "-")}`;

    for (let i = 0; i < HEARTBEAT_RATE_MAX; i++) {
      await request.post("/api/visitors/heartbeat", {
        headers: { "X-Forwarded-For": ipA },
        data: heartbeatBody(visitorIdA),
      });
    }

    const blockedA = await request.post("/api/visitors/heartbeat", {
      headers: { "X-Forwarded-For": ipA },
      data: heartbeatBody(visitorIdA),
    });
    expect(
      blockedA.status(),
      `request ${HEARTBEAT_RATE_MAX + 1} from ${ipA} must be 429`,
    ).toBe(429);

    const allowedB = await request.post("/api/visitors/heartbeat", {
      headers: { "X-Forwarded-For": ipB },
      data: heartbeatBody(visitorIdB),
    });
    expect(
      allowedB.status(),
      `first request from ${ipB} must not be rate-limited after ${ipA} is blocked`,
    ).not.toBe(429);
  });
});
