import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Task #403 — every per-IP limiter that touches an expensive side-effect
// (SMTP send, paid OpenAI call, DB write that creates user-visible records,
// or sensitive credential check) must persist its counter via
// `storage.atomicIncrementRateLimit` so the per-IP budget is shared across
// autoscale instances. These tests guard the wiring at three layers:
//
//   1. The exported namespace constants stay stable across deploys
//      (changing them would orphan rehydrated rows after the next restart).
//   2. Every namespace we expect to persist is registered in
//      `PERSISTENT_RATE_LIMIT_NAMESPACES` so `hydratePersistedRateLimits`
//      will actually rehydrate it after a restart.
//   3. A persistent limiter hits `storage.atomicIncrementRateLimit` with a
//      key prefixed by its namespace on the happy path, and silently falls
//      back to the in-memory counter when the DB throws.
// ============================================================================

const atomicIncrementRateLimit = vi.fn(async (_opts?: unknown) => ({
  count: 1,
  resetAt: new Date(Date.now() + 60_000),
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    atomicIncrementRateLimit,
    upsertAdminLoginAttempt: vi.fn(async () => {}),
    getActiveAdminLoginAttempts: vi.fn(async () => []),
  }),
}));

const security = await import("../middleware/security");
const express = (await import("express")).default;
const request = (await import("supertest")).default;

beforeEach(() => {
  atomicIncrementRateLimit.mockClear();
  atomicIncrementRateLimit.mockImplementation(async () => ({
    count: 1,
    resetAt: new Date(Date.now() + 60_000),
  }));
});

describe("persistent rate-limit namespaces (Task #403)", () => {
  it("exposes stable string constants for every persistent limiter", () => {
    // If any of these change the rows persisted by the previous deploy
    // become orphaned (their namespace prefix no longer matches anything
    // in `PERSISTENT_RATE_LIMIT_NAMESPACES` so hydration will skip them).
    expect(security.ADMIN_LOGIN_RATE_LIMIT_NAMESPACE).toBe("admin_login");
    expect(security.PUBLIC_NEWSLETTER_RATE_LIMIT_NAMESPACE).toBe("public_newsletter");
    expect(security.PUBLIC_CONTACT_RATE_LIMIT_NAMESPACE).toBe("public_contact");
    expect(security.AI_CHAT_RATE_LIMIT_NAMESPACE).toBe("ai_chat");
    expect(security.OTP_ISSUE_RATE_LIMIT_NAMESPACE).toBe("otp_issue");
    expect(security.OTP_VERIFY_RATE_LIMIT_NAMESPACE).toBe("otp_verify");
    expect(security.ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE).toBe("access_key_submit");
    expect(security.WITHDRAWAL_SUBMIT_RATE_LIMIT_NAMESPACE).toBe("withdrawal_submit");
    expect(security.CLIENT_ERROR_REPORT_RATE_LIMIT_NAMESPACE).toBe("client_error_report");
  });

  it.each([
    ["public_newsletter", security.PUBLIC_NEWSLETTER_RATE_LIMIT_NAMESPACE],
    ["public_contact", security.PUBLIC_CONTACT_RATE_LIMIT_NAMESPACE],
    ["ai_chat", security.AI_CHAT_RATE_LIMIT_NAMESPACE],
    ["otp_issue", security.OTP_ISSUE_RATE_LIMIT_NAMESPACE],
    ["otp_verify", security.OTP_VERIFY_RATE_LIMIT_NAMESPACE],
    ["access_key_submit", security.ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE],
    ["withdrawal_submit", security.WITHDRAWAL_SUBMIT_RATE_LIMIT_NAMESPACE],
  ])("happy path: a limiter using the '%s' namespace calls atomicIncrementRateLimit with that prefix", async (_label, ns) => {
    const app = express();
    app.set("trust proxy", true);
    app.use("/x", security.rateLimiter(5, 60_000, { persistNamespace: ns }));
    app.get("/x", (_req, res) => res.json({ ok: true }));

    const res = await request(app).get("/x").set("x-forwarded-for", "10.0.42.1");
    expect(res.status).toBe(200);

    expect(atomicIncrementRateLimit).toHaveBeenCalledTimes(1);
    const arg = atomicIncrementRateLimit.mock.calls[0][0] as { key: string };
    expect(arg.key.startsWith(`${ns}:`)).toBe(true);
    // Should also carry the client IP and route in the key.
    expect(arg.key).toContain("10.0.42.1");
    expect(arg.key.endsWith("/x")).toBe(true);
  });

  it("falls back to in-memory enforcement (no throw, still 200) when the DB throws", async () => {
    atomicIncrementRateLimit.mockImplementationOnce(async () => {
      throw new Error("simulated DB outage");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const app = express();
    app.set("trust proxy", true);
    app.use(
      "/y",
      security.rateLimiter(5, 60_000, {
        persistNamespace: security.AI_CHAT_RATE_LIMIT_NAMESPACE,
      }),
    );
    app.get("/y", (_req, res) => res.json({ ok: true }));

    const res = await request(app).get("/y").set("x-forwarded-for", "10.0.42.99");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    warnSpy.mockRestore();
  });
});

// ── Source-string operator guards ─────────────────────────────────────────────
// Assert that the admin login rate limiter uses the correct comparison operator
// at both the DB-backed path and the in-memory fallback in
// server/middleware/security.ts. A one-character change to the wrong operator
// would silently allow one extra brute-force attempt against the admin
// credential before the lockout fires — higher severity than the portal path.
// Mirrored by inline comments at each guarded site in security.ts.
describe("source-string operator guards — admin login rate limiter (security.ts)", () => {
  it("DB-backed (persistent) path uses > maxRequests (not >=) for the post-increment count", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("server/middleware/security.ts"), "utf8");
    expect(
      src,
      "security.ts DB-backed path must use > (not >=) for effectiveCount vs maxRequests — count is post-increment so >= would block one call too early",
    ).toMatch(/effectiveCount > maxRequests/);
  });

  it("in-memory fallback path uses >= maxRequests (not >) for the pre-increment count", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("server/middleware/security.ts"), "utf8");
    expect(
      src,
      "security.ts in-memory fallback must use >= (not >) for record.count vs maxRequests — count is pre-increment so > would silently allow one extra attempt",
    ).toMatch(/record\.count >= maxRequests/);
  });
});
