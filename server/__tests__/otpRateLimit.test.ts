import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// OTP rate-limiter DB-persistence cap guards
//
// Two per-IP limiters protect the OTP issuance and verification routes:
//
//   otpIssueRateLimit  — 5 req / 10 min per IP
//     Prevents SMTP flooding: each accepted POST triggers an outbound email
//     carrying the 6-digit security code. Cap chosen to make mail-bombing
//     impractical while remaining comfortable for legitimate users who miss
//     their email. Persisted to the DB so the budget holds across autoscale
//     instances.
//
//   otpVerifyRateLimit — 20 req / 10 min per IP
//     Limits brute-force guessing of the 6-digit code space. 20 is the
//     secondary axis; the per-token attempts cap is the primary defence.
//     Persisted so cross-instance brute-force is bounded at the per-IP budget
//     rather than (per-IP × instance-count).
//
// The tests below assert that each limiter allows EXACTLY N requests and
// blocks the (N+1)th. Quietly raising either cap degrades the abuse
// prevention without any code-review signal — an assertion here fails
// immediately, catching the regression before it ships.
// ============================================================================

const atomicCounters = new Map<string, number>();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    atomicIncrementRateLimit: vi.fn(
      async ({ key, windowResetAt }: { key: string; windowResetAt: Date }) => {
        const prev = atomicCounters.get(key) ?? 0;
        const next = prev + 1;
        atomicCounters.set(key, next);
        return { count: next, resetAt: windowResetAt };
      },
    ),
    // Explicit override so per-case tests can configure a real case row via
    // mockResolvedValue without disturbing the per-IP limiter tests (which
    // never reach getCaseById because the IP window is always fresh there,
    // and the default undefined → 404 is fine for those tests).
    getCaseById: vi.fn(async () => undefined),
  }),
}));

// Allow all portal sessions through so the rate limiter — not the auth guard
// — is the first mechanism to fire a 429. Any non-429 response (200, 401,
// 404, 409, …) from the handler body confirms the rate-limiter window is open.
vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async () => true),
}));

// Admin auth guard used by withdrawalActivation.ts via "./middleware".
vi.mock("../routes/middleware", () => ({
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
}));

// warnOnce: silence noisy console output in tests.
vi.mock("../lib/warnOnce", () => ({
  warnOnce: vi.fn(),
}));

const { registerCaseWithdrawalActivationRoutes } = await import(
  "../routes/withdrawalActivation"
);
const { storage } = await import("../storage");

let nextIp = 1;
function freshIp(): string {
  return `10.66.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`;
}

function buildOtpApp(): express.Application {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  // registerCaseWithdrawalActivationRoutes mounts routes at "/:id/..."
  // so we create a sub-router and mount it at /api/cases.
  const casesRouter = express.Router();
  registerCaseWithdrawalActivationRoutes(casesRouter as unknown as Router);
  app.use("/api/cases", casesRouter);
  return app;
}

// ── OTP issuance limiter ──────────────────────────────────────────────────────

describe("POST /api/cases/:id/withdrawal-activation/token/request rate limiting (DB-persistent: otpIssueRateLimit)", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 on the 6th rapid POST from the same IP", async () => {
    const app = buildOtpApp();
    const ip = freshIp();

    const allowed = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/cases/case-otp-rl-1/withdrawal-activation/token/request")
          .set("x-forwarded-for", ip)
          .send({}),
      ),
    );
    // Any non-429 status confirms the rate-limit window is still open.
    // Handler will return 404/400/409 because the mocked storage returns no
    // case row, but none of these is 429.
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    const blocked = await request(app)
      .post("/api/cases/case-otp-rl-1/withdrawal-activation/token/request")
      .set("x-forwarded-for", ip)
      .send({});

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("allowed-window cap is exactly 5 — SMTP-flood snapshot guard", async () => {
    // Rationale: each accepted POST triggers an outbound email carrying the
    // 6-digit activation code. The cap of 5 per IP per 10-minute window was
    // deliberately chosen to make mail-bombing impractical while remaining
    // comfortable for legitimate users (see otpIssueRateLimit in
    // server/routes/withdrawalActivation.ts).
    //
    // This test is a self-contained snapshot: it independently verifies that
    // EXACTLY 5 requests are allowed and the 6th is blocked. Quietly raising
    // the cap degrades the SMTP flood ceiling without any code-review signal —
    // this assertion fails immediately, catching that regression before it
    // ships. If you intentionally change the cap, update the literal 5 in the
    // assertions AND the comment above in the same commit.
    const app = buildOtpApp();
    const ip = freshIp();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/cases/case-otp-snap/withdrawal-activation/token/request")
          .set("x-forwarded-for", ip)
          .send({}),
      ),
    );

    // All 5 requests in the allowed window must be non-429.
    responses.forEach((r, i) =>
      expect(r.status, `otp/request ${i + 1} of 5 must be inside the allowed window (non-429)`).not.toBe(429),
    );

    // Each of the 5 allowed requests must have incremented the DB counter
    // exactly once (DB-persistent path is active).
    const callsAfterAllowed = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ip),
    ).length;
    expect(
      callsAfterAllowed,
      "otpIssueRateLimit cap must be exactly 5 per IP per window — raise this assertion if the cap is intentionally changed",
    ).toBe(5);

    // The 6th request must be blocked — window is exhausted.
    const blocked = await request(app)
      .post("/api/cases/case-otp-snap/withdrawal-activation/token/request")
      .set("x-forwarded-for", ip)
      .send({});
    expect(blocked.status, "6th otp/request must be rate-limited (429)").toBe(429);
  });

  it("calls storage.atomicIncrementRateLimit on every allowed request — DB-persistence guard", async () => {
    const app = buildOtpApp();
    const ip = freshIp();

    for (let i = 1; i <= 5; i++) {
      const callsBefore = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
        (c) => c[0].key.includes(ip),
      ).length;

      await request(app)
        .post("/api/cases/case-otp-db/withdrawal-activation/token/request")
        .set("x-forwarded-for", ip)
        .send({});

      const callsAfter = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
        (c) => c[0].key.includes(ip),
      ).length;

      expect(
        callsAfter,
        `otp/request ${i}: atomicIncrementRateLimit must be called (DB-persistence guard — SMTP flood prevention)`,
      ).toBeGreaterThan(callsBefore);
    }
  });

  it("uses a key containing the canonical namespace — stable across restarts", async () => {
    const app = buildOtpApp();
    const ip = freshIp();

    await request(app)
      .post("/api/cases/case-otp-ns/withdrawal-activation/token/request")
      .set("x-forwarded-for", ip)
      .send({});

    const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ip),
    );
    expect(calls.length).toBeGreaterThan(0);
    // "otp_issue" is OTP_ISSUE_RATE_LIMIT_NAMESPACE.
    expect(calls[0][0].key).toContain("otp_issue");
  });

  it("window duration is exactly 600 000 ms (10 minutes) — snapshot guard against a quietly shortened window", async () => {
    // Rationale: otpIssueRateLimit (see server/routes/withdrawalActivation.ts)
    // caps requests at 5 per IP per 10-minute window. Each accepted request
    // triggers an SMTP send, so the window bounds worst-case mail-bombing
    // throughput. Quietly shortening the window multiplies the effective
    // attack rate the same way raising the cap would, without any
    // code-review signal. Time is frozen so `windowResetAt` can be asserted
    // for EXACT equality. If you intentionally change the window, update the
    // literal 600_000 here in the same commit.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildOtpApp();
      const ip = freshIp();

      await request(app)
        .post("/api/cases/case-otp-window/withdrawal-activation/token/request")
        .set("x-forwarded-for", ip)
        .send({});

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "otpIssueRateLimit window must be exactly 600 000 ms (10 minutes) — raise this assertion if the window is intentionally changed",
      ).toBe(600_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── OTP verification limiter ──────────────────────────────────────────────────

describe("POST /api/cases/:id/withdrawal-activation/token/verify rate limiting (DB-persistent: otpVerifyRateLimit)", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns 429 on the 21st rapid POST from the same IP", async () => {
    const app = buildOtpApp();
    const ip = freshIp();

    const allowed = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app)
          .post("/api/cases/case-otp-verify-rl/withdrawal-activation/token/verify")
          .set("x-forwarded-for", ip)
          .send({ code: "000000" }),
      ),
    );
    // Any non-429 status (200, 400, 404, 409, …) confirms the window is open.
    allowed.forEach((r) => expect(r.status).not.toBe(429));

    const blocked = await request(app)
      .post("/api/cases/case-otp-verify-rl/withdrawal-activation/token/verify")
      .set("x-forwarded-for", ip)
      .send({ code: "000000" });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("allowed-window cap is exactly 20 — OTP brute-force snapshot guard", async () => {
    // Rationale: the OTP verify endpoint accepts a 6-digit code. 20 attempts
    // per IP per 10-minute window means an attacker can test at most 20/1,000,000
    // of the code space before being locked out — making brute-force impractical.
    // The per-token attempts cap (TOKEN_MAX_ATTEMPTS in withdrawalActivation.ts)
    // is the primary defence; this per-IP cap is the secondary rate-limit axis.
    // Persisted so cross-instance brute-force is bounded at 20, not
    // (20 × instance-count) (see otpVerifyRateLimit in
    // server/routes/withdrawalActivation.ts).
    //
    // This test is a self-contained snapshot: it independently verifies that
    // EXACTLY 20 requests are allowed and the 21st is blocked. Quietly raising
    // the cap (e.g. to 100) expands the brute-force budget by 5× without any
    // code-review signal — this assertion fails immediately, catching that
    // regression before it ships. If you intentionally change the cap, update
    // the literal 20 in the assertions AND the comment above in the same commit.
    const app = buildOtpApp();
    const ip = freshIp();

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app)
          .post("/api/cases/case-otp-verify-snap/withdrawal-activation/token/verify")
          .set("x-forwarded-for", ip)
          .send({ code: "000000" }),
      ),
    );

    // All 20 requests in the allowed window must be non-429.
    responses.forEach((r, i) =>
      expect(r.status, `otp/verify ${i + 1} of 20 must be inside the allowed window (non-429)`).not.toBe(429),
    );

    // Each of the 20 allowed requests must have incremented the DB counter
    // exactly once (DB-persistent path is active).
    const callsAfterAllowed = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ip),
    ).length;
    expect(
      callsAfterAllowed,
      "otpVerifyRateLimit cap must be exactly 20 per IP per window — raise this assertion if the cap is intentionally changed",
    ).toBe(20);

    // The 21st request must be blocked — window is exhausted.
    const blocked = await request(app)
      .post("/api/cases/case-otp-verify-snap/withdrawal-activation/token/verify")
      .set("x-forwarded-for", ip)
      .send({ code: "000000" });
    expect(blocked.status, "21st otp/verify request must be rate-limited (429)").toBe(429);
  }, 30_000);

  it("uses a key containing the canonical namespace — stable across restarts", async () => {
    const app = buildOtpApp();
    const ip = freshIp();

    await request(app)
      .post("/api/cases/case-otp-verify-ns/withdrawal-activation/token/verify")
      .set("x-forwarded-for", ip)
      .send({ code: "000000" });

    const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ip),
    );
    expect(calls.length).toBeGreaterThan(0);
    // "otp_verify" is OTP_VERIFY_RATE_LIMIT_NAMESPACE.
    expect(calls[0][0].key).toContain("otp_verify");
  });

  it("window duration is exactly 600 000 ms (10 minutes) — snapshot guard against a quietly shortened window", async () => {
    // Rationale: otpVerifyRateLimit (see server/routes/withdrawalActivation.ts)
    // caps requests at 20 per IP per 10-minute window, the secondary
    // per-IP brute-force defence alongside the per-token attempts cap.
    // Quietly shortening the window multiplies the effective brute-force
    // rate the same way raising the cap would, without any code-review
    // signal. Time is frozen so `windowResetAt` can be asserted for EXACT
    // equality. If you intentionally change the window, update the literal
    // 600_000 here in the same commit.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildOtpApp();
      const ip = freshIp();

      await request(app)
        .post("/api/cases/case-otp-verify-window/withdrawal-activation/token/verify")
        .set("x-forwarded-for", ip)
        .send({ code: "000000" });

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter((c) =>
        c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);
      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "otpVerifyRateLimit window must be exactly 600 000 ms (10 minutes) — raise this assertion if the window is intentionally changed",
      ).toBe(600_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 60s resend cooldown enforcement (behavioral, not just a constant snapshot) ──
//
// Task #2368 added a source-level snapshot guard proving
// TOKEN_RESEND_COOLDOWN_MS stays at 60 seconds, but nothing exercised the
// actual enforcement branch in the route handler:
//
//   if (last && Date.now() - last.createdAt.getTime() < TOKEN_RESEND_COOLDOWN_MS)
//
// If that branch were ever removed, inverted, or short-circuited, the
// constant-value guard alone would not catch it — this test mocks
// getActiveWithdrawalSecurityToken to return a just-issued token and asserts
// the resend route actually rejects it, then asserts a token issued more
// than 60s ago is allowed through.

describe("POST /api/cases/:id/withdrawal-activation/token/request 60s resend cooldown enforcement", () => {
  const CASE_ID = "resend-cooldown-case";
  const minimalCaseRow = {
    id: CASE_ID,
    withdrawalSecurityTokenRequired: true,
    withdrawalActivationStatus: "awaiting_token",
    userEmail: "user@example.com",
    isDisabled: false,
  };

  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
    vi.mocked(storage.getCaseById).mockResolvedValue(minimalCaseRow as any);
    vi.mocked(storage.runInTransaction).mockImplementation(
      (async (fn: (tx: unknown) => Promise<unknown>) => fn({})) as any,
    );
    vi.mocked(storage.createWithdrawalSecurityToken).mockClear();
  });

  it("rejects an immediate resend with 429 + retryAfter when the last token was issued <60s ago", async () => {
    vi.mocked(storage.getActiveWithdrawalSecurityToken).mockResolvedValue({
      id: 1,
      caseId: CASE_ID,
      codeHash: "hash",
      createdAt: new Date(Date.now() - 5_000), // issued 5s ago — well inside the 60s cooldown
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      consumedAt: null,
    } as any);

    const app = buildOtpApp();
    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/withdrawal-activation/token/request`)
      .set("x-forwarded-for", freshIp())
      .send({});

    expect(res.status, "resend within the 60s cooldown must be rejected (429)").toBe(429);
    expect(res.body.error).toMatch(/wait \d+s before requesting another code/);
    expect(typeof res.body.retryAfter).toBe("number");
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(res.body.retryAfter).toBeLessThanOrEqual(60);

    // A blocked resend must NOT issue a new token.
    expect(storage.createWithdrawalSecurityToken).not.toHaveBeenCalled();
  });

  it("allows a resend once the last token is more than 60s old", async () => {
    vi.mocked(storage.getActiveWithdrawalSecurityToken).mockResolvedValue({
      id: 2,
      caseId: CASE_ID,
      codeHash: "hash",
      createdAt: new Date(Date.now() - 61_000), // issued 61s ago — just past the cooldown
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      consumedAt: null,
    } as any);
    vi.mocked(storage.createWithdrawalSecurityToken).mockResolvedValue({} as any);

    const app = buildOtpApp();
    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/withdrawal-activation/token/request`)
      .set("x-forwarded-for", freshIp())
      .send({});

    expect(res.status, "resend after the 60s cooldown must be allowed").toBe(200);
    expect(res.body.ok).toBe(true);
    expect(storage.createWithdrawalSecurityToken).toHaveBeenCalledTimes(1);
  });

  it("allows the very first send when no prior token exists (no cooldown to check)", async () => {
    vi.mocked(storage.getActiveWithdrawalSecurityToken).mockResolvedValue(undefined);
    vi.mocked(storage.createWithdrawalSecurityToken).mockResolvedValue({} as any);

    const app = buildOtpApp();
    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/withdrawal-activation/token/request`)
      .set("x-forwarded-for", freshIp())
      .send({});

    expect(res.status).toBe(200);
    expect(storage.createWithdrawalSecurityToken).toHaveBeenCalledTimes(1);
  });
});

// ── Per-case OTP issuance sub-limit ──────────────────────────────────────────

describe("POST /api/cases/:id/withdrawal-activation/token/request per-case OTP sub-limit (PER_CASE_OTP_LIMIT)", () => {
  // A minimal case row that satisfies getCaseById without short-circuiting
  // before perCaseOtpAllowed is reached. The concrete values (enabled, pending
  // status) ensure the handler inspects the per-case map rather than bailing
  // on a missing-case 404 or an already-approved 409.
  const CASE_ID = "per-case-otp-limit-snap";
  const minimalCaseRow = {
    id: CASE_ID,
    withdrawalSecurityTokenRequired: true,
    withdrawalActivationStatus: "pending",
    isDisabled: false,
  };

  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
    vi.mocked(storage.getCaseById).mockResolvedValue(minimalCaseRow as any);
  });

  it("PER_CASE_OTP_LIMIT is exactly 5 — SMTP abuse-prevention snapshot guard", async () => {
    // Rationale: per-case OTP issuance is capped at 5 sends per 10-minute
    // window as a defence-in-depth axis on top of the per-IP DB-persisted
    // `otpIssueRateLimit`. Without this cap, an attacker who rotates IPs
    // (or a buggy retry loop) could still email-flood the case holder.
    // The literal 5 matches PER_CASE_OTP_LIMIT in
    // server/routes/withdrawalActivation.ts.
    //
    // This snapshot guard fails immediately if PER_CASE_OTP_LIMIT is quietly
    // raised, catching the SMTP flood surface expansion before it ships.
    // If the cap is intentionally changed, update the literal 5 in the
    // assertions AND this comment in the same commit.
    const app = buildOtpApp();

    // Use a fresh IP per request so the per-IP `otpIssueRateLimit` (capped at
    // 5/10 min per IP) does NOT fire before perCaseOtpAllowed is reached.
    // This isolates the per-case throttle as the first mechanism to return 429.
    const allowedResponses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post(`/api/cases/${CASE_ID}/withdrawal-activation/token/request`)
          .set("x-forwarded-for", freshIp())
          .send({}),
      ),
    );

    // All 5 requests must be inside the per-case window (non-429).
    allowedResponses.forEach((r, i) =>
      expect(
        r.status,
        `per-case OTP request ${i + 1} of 5 must be inside the allowed window (non-429) — PER_CASE_OTP_LIMIT snapshot guard`,
      ).not.toBe(429),
    );

    // The 6th request, from yet another fresh IP (so the per-IP limiter still
    // has a clean window), must be rejected by the per-case map with exactly
    // the per-case 429 message — not the per-IP 429.
    const blocked = await request(app)
      .post(`/api/cases/${CASE_ID}/withdrawal-activation/token/request`)
      .set("x-forwarded-for", freshIp())
      .send({});

    expect(
      blocked.status,
      "6th per-case OTP request must be blocked (429) — PER_CASE_OTP_LIMIT is exactly 5",
    ).toBe(429);

    // Verify the 429 is from the per-case throttle (not the per-IP limiter)
    // by checking the message text, which is unique to perCaseOtpAllowed.
    expect(
      blocked.body.error,
      "per-case 429 must carry the per-case error message (not the per-IP message)",
    ).toMatch(/Too many security-code requests for this case/);
  });

  it("PER_CASE_OTP_WINDOW_MS is exactly 10 minutes — SMTP abuse-prevention window snapshot guard", () => {
    // Rationale: the per-case OTP window of 10 minutes was chosen to make
    // mail-bombing a case holder impractical for any single attacker, even one
    // rotating IPs. Shrinking the window (e.g. from 10 min to 1 min) makes the
    // 5-sends budget reset faster, amplifying the per-case SMTP flood surface
    // just as surely as raising PER_CASE_OTP_LIMIT itself. This guard ensures
    // the window cannot be quietly shortened below 10 minutes without a failing
    // assertion in CI.
    //
    // Implementation: source-level assertion. The constant PER_CASE_OTP_WINDOW_MS
    // is internal to the module (not exported), so we inspect the source directly.
    // This is the same pattern used by appStageHistory.test.ts and similar guards
    // in this codebase. Any edit to the literal — whether to "5 * 60 * 1000" or
    // the bare number "600000" — causes a mismatch and surfaces in CI before merge.
    //
    // If you intentionally change the window, update EXPECTED_WINDOW_MS below AND
    // the comment in PER_CASE_OTP_WINDOW_MS (server/routes/withdrawalActivation.ts)
    // in the same commit.
    const EXPECTED_WINDOW_MS = 10 * 60 * 1000; // 600_000 ms — do not lower without review

    const { readFileSync } = require("fs");
    const { resolve } = require("path");
    const source: string = readFileSync(
      resolve(__dirname, "../routes/withdrawalActivation.ts"),
      "utf-8",
    );

    // Locate the PER_CASE_OTP_WINDOW_MS declaration line.
    const declarationLine = source
      .split("\n")
      .find((line) => /^\s*const\s+PER_CASE_OTP_WINDOW_MS\s*=/.test(line));

    expect(
      declarationLine,
      "PER_CASE_OTP_WINDOW_MS declaration must exist in server/routes/withdrawalActivation.ts",
    ).toBeTruthy();

    // Evaluate the right-hand side as a numeric expression and compare to the
    // expected value. We extract only the numeric literal / arithmetic portion
    // so comments and semicolons don't interfere.
    const rhs = declarationLine!
      .replace(/^\s*const\s+PER_CASE_OTP_WINDOW_MS\s*=\s*/, "")
      .replace(/[;\/].*$/, "") // strip trailing semicolon and any inline comment
      .trim();

    // Safely evaluate simple arithmetic (e.g. "10 * 60 * 1000" → 600000).
    // Only digits, spaces, and * are expected; anything else means the source
    // has changed shape and the assertion should be updated.
    expect(
      /^[\d\s*]+$/.test(rhs),
      `PER_CASE_OTP_WINDOW_MS RHS "${rhs}" must be a simple numeric/arithmetic literal — update this test if the expression form changed`,
    ).toBe(true);

    // eslint-disable-next-line no-new-func
    const actualWindowMs: number = new Function(`return ${rhs}`)() as number;

    expect(
      actualWindowMs,
      `PER_CASE_OTP_WINDOW_MS must be exactly ${EXPECTED_WINDOW_MS} ms (10 minutes). ` +
        "Shrinking the window makes the 5-sends budget reset faster, amplifying the per-case SMTP flood surface. " +
        "If you intentionally change the window, update EXPECTED_WINDOW_MS in this test AND the comment " +
        "above PER_CASE_OTP_WINDOW_MS in server/routes/withdrawalActivation.ts in the same commit.",
    ).toBe(EXPECTED_WINDOW_MS);
  });

  it("TOKEN_TTL_MS is exactly 10 minutes — OTP token validity snapshot guard", () => {
    // Rationale: the issued OTP token's validity window (TOKEN_TTL_MS) is
    // deliberately aligned with PER_CASE_OTP_WINDOW_MS above. If TOKEN_TTL_MS
    // is quietly shortened below the per-case/per-IP rate-limit windows, the
    // token lifecycle becomes misaligned with the abuse-prevention budget
    // (e.g. users would be forced to restart the flow more often than the
    // rate limiter intends, or worse, the two constants could drift apart in
    // ways that mask a future accidental change to either one). This guard
    // ensures TOKEN_TTL_MS cannot be quietly shortened without a failing
    // assertion in CI.
    //
    // Implementation: source-level assertion, same pattern as the
    // PER_CASE_OTP_WINDOW_MS guard above. TOKEN_TTL_MS is internal to the
    // module (not exported), so we inspect the source directly.
    //
    // If you intentionally change the TTL, update EXPECTED_TOKEN_TTL_MS below
    // AND the comment above TOKEN_TTL_MS (server/routes/withdrawalActivation.ts)
    // in the same commit.
    const EXPECTED_TOKEN_TTL_MS = 10 * 60 * 1000; // 600_000 ms — do not lower without review

    const { readFileSync } = require("fs");
    const { resolve } = require("path");
    const source: string = readFileSync(
      resolve(__dirname, "../routes/withdrawalActivation.ts"),
      "utf-8",
    );

    // Locate the TOKEN_TTL_MS declaration line.
    const declarationLine = source
      .split("\n")
      .find((line) => /^\s*const\s+TOKEN_TTL_MS\s*=/.test(line));

    expect(
      declarationLine,
      "TOKEN_TTL_MS declaration must exist in server/routes/withdrawalActivation.ts",
    ).toBeTruthy();

    // Evaluate the right-hand side as a numeric expression and compare to the
    // expected value. We extract only the numeric literal / arithmetic portion
    // so comments and semicolons don't interfere.
    const rhs = declarationLine!
      .replace(/^\s*const\s+TOKEN_TTL_MS\s*=\s*/, "")
      .replace(/[;\/].*$/, "") // strip trailing semicolon and any inline comment
      .trim();

    // Safely evaluate simple arithmetic (e.g. "10 * 60 * 1000" → 600000).
    // Only digits, spaces, and * are expected; anything else means the source
    // has changed shape and the assertion should be updated.
    expect(
      /^[\d\s*]+$/.test(rhs),
      `TOKEN_TTL_MS RHS "${rhs}" must be a simple numeric/arithmetic literal — update this test if the expression form changed`,
    ).toBe(true);

    // eslint-disable-next-line no-new-func
    const actualTokenTtlMs: number = new Function(`return ${rhs}`)() as number;

    expect(
      actualTokenTtlMs,
      `TOKEN_TTL_MS must be exactly ${EXPECTED_TOKEN_TTL_MS} ms (10 minutes). ` +
        "Shrinking the TTL misaligns the token lifecycle with the OTP rate-limit " +
        "windows (PER_CASE_OTP_WINDOW_MS / otpIssueRateLimit / otpVerifyRateLimit). " +
        "If you intentionally change the TTL, update EXPECTED_TOKEN_TTL_MS in this test AND " +
        "the comment above TOKEN_TTL_MS in server/routes/withdrawalActivation.ts in the same commit.",
    ).toBe(EXPECTED_TOKEN_TTL_MS);
  });

  it("TOKEN_MAX_ATTEMPTS is exactly 5 — OTP brute-force attempts snapshot guard", () => {
    // Rationale: TOKEN_MAX_ATTEMPTS is the primary brute-force defence for the
    // 6-digit OTP code against a single issued token (the per-IP
    // otpVerifyRateLimit above is the secondary axis). Quietly raising this
    // value widens the guess budget per token, weakening brute-force
    // resistance; quietly lowering it locks legitimate users out after fewer
    // typos. This guard ensures the cap cannot drift in either direction
    // without a failing assertion in CI.
    //
    // Implementation: source-level assertion, same pattern as the
    // PER_CASE_OTP_WINDOW_MS / TOKEN_TTL_MS guards above. TOKEN_MAX_ATTEMPTS
    // is internal to the module (not exported), so we inspect the source
    // directly.
    //
    // If you intentionally change the cap, update EXPECTED_TOKEN_MAX_ATTEMPTS
    // below AND the comment above TOKEN_MAX_ATTEMPTS
    // (server/routes/withdrawalActivation.ts) in the same commit.
    const EXPECTED_TOKEN_MAX_ATTEMPTS = 5;

    const { readFileSync } = require("fs");
    const { resolve } = require("path");
    const source: string = readFileSync(
      resolve(__dirname, "../routes/withdrawalActivation.ts"),
      "utf-8",
    );

    // Locate the TOKEN_MAX_ATTEMPTS declaration line.
    const declarationLine = source
      .split("\n")
      .find((line) => /^\s*const\s+TOKEN_MAX_ATTEMPTS\s*=/.test(line));

    expect(
      declarationLine,
      "TOKEN_MAX_ATTEMPTS declaration must exist in server/routes/withdrawalActivation.ts",
    ).toBeTruthy();

    // Evaluate the right-hand side as a numeric expression and compare to the
    // expected value. We extract only the numeric literal / arithmetic portion
    // so comments and semicolons don't interfere.
    const rhs = declarationLine!
      .replace(/^\s*const\s+TOKEN_MAX_ATTEMPTS\s*=\s*/, "")
      .replace(/[;\/].*$/, "") // strip trailing semicolon and any inline comment
      .trim();

    // Safely evaluate simple arithmetic (e.g. "5" → 5). Only digits, spaces,
    // and * are expected; anything else means the source has changed shape
    // and the assertion should be updated.
    expect(
      /^[\d\s*]+$/.test(rhs),
      `TOKEN_MAX_ATTEMPTS RHS "${rhs}" must be a simple numeric/arithmetic literal — update this test if the expression form changed`,
    ).toBe(true);

    // eslint-disable-next-line no-new-func
    const actualTokenMaxAttempts: number = new Function(`return ${rhs}`)() as number;

    expect(
      actualTokenMaxAttempts,
      `TOKEN_MAX_ATTEMPTS must be exactly ${EXPECTED_TOKEN_MAX_ATTEMPTS}. ` +
        "Raising it weakens brute-force defence against the 6-digit OTP code; " +
        "lowering it locks legitimate users out after fewer typos. " +
        "If you intentionally change the cap, update EXPECTED_TOKEN_MAX_ATTEMPTS in this test AND " +
        "the comment above TOKEN_MAX_ATTEMPTS in server/routes/withdrawalActivation.ts in the same commit.",
    ).toBe(EXPECTED_TOKEN_MAX_ATTEMPTS);
  });

  it("TOKEN_RESEND_COOLDOWN_MS is exactly 60 seconds — OTP resend cooldown snapshot guard", () => {
    // Rationale: TOKEN_RESEND_COOLDOWN_MS is the minimum time a user must wait
    // between OTP resend requests, preventing mail-bombing the case holder's
    // inbox via rapid resend clicks (independent of the per-IP/per-case send
    // caps, which only bound the total count over a longer window). Quietly
    // shortening this cooldown increases the achievable resend/mail-bombing
    // rate without any code-review signal. This guard ensures the cooldown
    // cannot be quietly shortened (or lengthened, degrading UX) without a
    // failing assertion in CI.
    //
    // Implementation: source-level assertion, same pattern as the
    // PER_CASE_OTP_WINDOW_MS / TOKEN_TTL_MS / TOKEN_MAX_ATTEMPTS guards above.
    // TOKEN_RESEND_COOLDOWN_MS is internal to the module (not exported), so we
    // inspect the source directly.
    //
    // If you intentionally change the cooldown, update
    // EXPECTED_TOKEN_RESEND_COOLDOWN_MS below AND the comment above
    // TOKEN_RESEND_COOLDOWN_MS (server/routes/withdrawalActivation.ts) in the
    // same commit.
    const EXPECTED_TOKEN_RESEND_COOLDOWN_MS = 60 * 1000; // 60_000 ms

    const { readFileSync } = require("fs");
    const { resolve } = require("path");
    const source: string = readFileSync(
      resolve(__dirname, "../routes/withdrawalActivation.ts"),
      "utf-8",
    );

    // Locate the TOKEN_RESEND_COOLDOWN_MS declaration line.
    const declarationLine = source
      .split("\n")
      .find((line) => /^\s*const\s+TOKEN_RESEND_COOLDOWN_MS\s*=/.test(line));

    expect(
      declarationLine,
      "TOKEN_RESEND_COOLDOWN_MS declaration must exist in server/routes/withdrawalActivation.ts",
    ).toBeTruthy();

    // Evaluate the right-hand side as a numeric expression and compare to the
    // expected value. We extract only the numeric literal / arithmetic portion
    // so comments and semicolons don't interfere.
    const rhs = declarationLine!
      .replace(/^\s*const\s+TOKEN_RESEND_COOLDOWN_MS\s*=\s*/, "")
      .replace(/[;\/].*$/, "") // strip trailing semicolon and any inline comment
      .trim();

    // Safely evaluate simple arithmetic (e.g. "60 * 1000" → 60000). Only
    // digits, spaces, and * are expected; anything else means the source has
    // changed shape and the assertion should be updated.
    expect(
      /^[\d\s*]+$/.test(rhs),
      `TOKEN_RESEND_COOLDOWN_MS RHS "${rhs}" must be a simple numeric/arithmetic literal — update this test if the expression form changed`,
    ).toBe(true);

    // eslint-disable-next-line no-new-func
    const actualCooldownMs: number = new Function(`return ${rhs}`)() as number;

    expect(
      actualCooldownMs,
      `TOKEN_RESEND_COOLDOWN_MS must be exactly ${EXPECTED_TOKEN_RESEND_COOLDOWN_MS} ms (60 seconds). ` +
        "Shortening it increases the achievable resend/mail-bombing rate. " +
        "If you intentionally change the cooldown, update EXPECTED_TOKEN_RESEND_COOLDOWN_MS in this test AND " +
        "the comment above TOKEN_RESEND_COOLDOWN_MS in server/routes/withdrawalActivation.ts in the same commit.",
    ).toBe(EXPECTED_TOKEN_RESEND_COOLDOWN_MS);
  });
});
