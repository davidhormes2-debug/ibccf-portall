// E2E smoke: verifies that POST /api/visitors/offline-messages enforces its
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
//   the same approach used by the unit-test suite and the heartbeat /
//   satisfaction / typing rate-limit IP-isolation specs.
// • Requests 1–5 from a given IP reach the route handler (PUBLIC_WRITE_MAX
//   = 5).  They may return 201 (message created) or another non-429 status
//   (e.g. 400 if the handler rejects, 500 on DB error).  We assert on !429
//   rather than 201 to avoid a dependency on a live database being seeded.
// • The 6th request from the same IP is intercepted by the rate limiter
//   before the handler runs → 429 + Retry-After.
// • A fresh IP gets 1 counter entry and is not blocked → !429.
// • Each test draws fresh IPs from the module-level counter so counter rows
//   never overlap, even on test retry.

import { test, expect } from "@playwright/test";

let ipSuffix = 1;
function freshIp(): string {
  const n = ipSuffix++;
  return `10.214.${Math.floor(n / 256)}.${n % 256}`;
}

const PUBLIC_WRITE_MAX = 5;

function offlineMessageBody() {
  return {
    name: "E2E Test User",
    email: "e2e-test@example.com",
    phone: "+1-555-000-0000",
    subject: "Rate limit isolation test",
    message: "This message is sent by the E2E rate-limit isolation spec.",
  };
}

test.describe("POST /api/visitors/offline-messages — IP-isolated rate limit (live server)", () => {
  test.setTimeout(60_000);

  test("5 POSTs from the same IP pass the rate limiter; the 6th gets 429", async ({
    request,
  }) => {
    const ipA = freshIp();

    for (let i = 0; i < PUBLIC_WRITE_MAX; i++) {
      const res = await request.post("/api/visitors/offline-messages", {
        headers: { "X-Forwarded-For": ipA },
        data: offlineMessageBody(),
      });
      expect(
        res.status(),
        `request ${i + 1} from ${ipA} must not be rate-limited (got ${res.status()})`,
      ).not.toBe(429);
    }

    const blocked = await request.post("/api/visitors/offline-messages", {
      headers: { "X-Forwarded-For": ipA },
      data: offlineMessageBody(),
    });
    expect(
      blocked.status(),
      `request ${PUBLIC_WRITE_MAX + 1} from ${ipA} must be rate-limited`,
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

    for (let i = 0; i < PUBLIC_WRITE_MAX; i++) {
      await request.post("/api/visitors/offline-messages", {
        headers: { "X-Forwarded-For": ipA },
        data: offlineMessageBody(),
      });
    }

    const blockedA = await request.post("/api/visitors/offline-messages", {
      headers: { "X-Forwarded-For": ipA },
      data: offlineMessageBody(),
    });
    expect(
      blockedA.status(),
      `request ${PUBLIC_WRITE_MAX + 1} from ${ipA} must be 429`,
    ).toBe(429);

    const allowedB = await request.post("/api/visitors/offline-messages", {
      headers: { "X-Forwarded-For": ipB },
      data: offlineMessageBody(),
    });
    expect(
      allowedB.status(),
      `first request from ${ipB} must not be rate-limited after ${ipA} is blocked`,
    ).not.toBe(429);
  });
});
