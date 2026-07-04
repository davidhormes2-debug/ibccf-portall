import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { cases as CasesTable } from "@shared/schema";
import { createStorageMock } from "./helpers/storageMock";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// The getCaseByAccessCode mock below hand-rolls `cases` columns. This Pick<>
// declaration fails `npm run check` if any referenced column is renamed in
// shared/schema.ts, preventing silent mock drift.
declare const _casesGuard: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "userPin"
  | "isDisabled"
  | "status"
  | "userName"
  | "withdrawalStage"
>;

// ============================================================================
// Session re-authentication (PIN extend) — POST /api/cases/login-pin
//
// Covers the re-auth scenario introduced in Task #253:
//   1. Correct PIN with a near-expiry existing session → fresh sessionToken
//      with a reset 7-day TTL is returned.
//   2. Wrong PIN → 401, no sessionToken issued.
//   3. Rate-limit threshold (5 failed attempts) still fires on the re-auth
//      path → 429 returned.
//   4. Case not found / no PIN set → 401.
//   5. Correct PIN but account disabled → 403.
// ============================================================================

// ---------------------------------------------------------------------------
// DB-backed rate-limit state:
//   Each test controls what storage.getAdminLoginAttemptByKey returns so we
//   can simulate "clean slate", "approaching limit", and "locked out" without
//   needing a real database.
// ---------------------------------------------------------------------------
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

type RateLimitRow = { count: number; resetAt: Date } | null;
let rateLimitRow: RateLimitRow = null;

// In-memory portal session store (mirrors the mock in portalAuthHardening).
const portalSessionStore = new Map<string, any>();

// Track calls to createPortalSession so tests can inspect issued tokens.
const createdSessions: Array<{ token: string; caseId: string; expiresAt: Date }> = [];

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // Rate-limit helpers
    getAdminLoginAttemptByKey: vi.fn(async (_key: string) => rateLimitRow),
    atomicIncrementRateLimit: vi.fn(async ({ maxCount }: { maxCount: number }) => {
      // Simulate an atomic increment: bump the in-memory row so the
      // checkPinRateLimit's DB-fallback path also sees the updated count.
      const now = Date.now();
      const ATTEMPT_WINDOW = 10 * 60 * 1000;
      const LOCKOUT = 15 * 60 * 1000;
      const prev = rateLimitRow ?? { count: 0, resetAt: new Date(now + ATTEMPT_WINDOW) };
      const newCount = prev.count + 1;
      const newResetAt =
        newCount >= maxCount
          ? new Date(now + LOCKOUT)
          : new Date(now + ATTEMPT_WINDOW);
      rateLimitRow = { count: newCount, resetAt: newResetAt };
      return { count: newCount, resetAt: newResetAt };
    }),
    clearAdminLoginAttemptKey: vi.fn(async (_key: string) => {
      rateLimitRow = null;
    }),
    // Portal session persistence
    createPortalSession: vi.fn(async (data: any) => {
      const row = { ...data, createdAt: new Date() };
      portalSessionStore.set(data.token, row);
      createdSessions.push({ token: data.token, caseId: data.caseId, expiresAt: data.expiresAt });
      return row;
    }),
    getPortalSession: vi.fn(async (token: string) => portalSessionStore.get(token) ?? null),
    deletePortalSession: vi.fn(async (token: string) => { portalSessionStore.delete(token); }),
    deletePortalSessionsByCaseId: vi.fn(async (caseId: string) => {
      let n = 0;
      for (const [t, row] of Array.from(portalSessionStore.entries())) {
        if (row.caseId === caseId) { portalSessionStore.delete(t); n++; }
      }
      return n;
    }),
    deleteExpiredPortalSessions: vi.fn(async () => 0),
    // Admin session (not needed here — defined to prevent undefined errors)
    getAdminSessionByToken: vi.fn(async () => null),
    updateAdminSessionActivity: vi.fn(async () => {}),
  }),
}));

// ---------------------------------------------------------------------------
// Case data: four fixed cases used across tests.
//   CORRECT_CODE  — active case with a plaintext PIN "123456" (legacy path,
//                   avoids bcrypt hashing overhead in tests).
//   WRONG_PIN     — same shape, used to confirm wrong PIN = 401.
//   NO_PIN_CODE   — case exists but userPin is null (no PIN set yet).
//   DISABLED_CODE — case with correct PIN but isDisabled = true.
// ---------------------------------------------------------------------------
const CASE_ID = "case-reauth-1";
const ACCESS_CODE = "REAUTH-CODE-1";
const CORRECT_PIN = "123456";
const WRONG_PIN_VALUE = "999999";

vi.mock("../services", () => ({
  caseService: {
    getCaseByAccessCode: vi.fn(async (code: string) => {
      if (code === ACCESS_CODE) {
        return {
          id: CASE_ID,
          accessCode: ACCESS_CODE,
          userPin: CORRECT_PIN, // plaintext — exercises the legacy fallback in verifyPin
          isDisabled: false,
          status: "active",
          userName: "Test User",
          withdrawalStage: 5,
        };
      }
      if (code === "DISABLED-CODE") {
        return {
          id: "case-disabled",
          accessCode: "DISABLED-CODE",
          userPin: CORRECT_PIN,
          isDisabled: true,
          status: "active",
        };
      }
      if (code === "NO-PIN-CODE") {
        return {
          id: "case-nopin",
          accessCode: "NO-PIN-CODE",
          userPin: null,
          isDisabled: false,
          status: "created",
        };
      }
      return null; // unknown access code
    }),
    updateCase: vi.fn(async () => ({})),
  },
}));

// Mount only the casesRouter — no admin auth middleware needed for this endpoint.
const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const app = buildApp();

// ---------------------------------------------------------------------------
// Helper: simulate a near-expiry session already in the store (2 minutes TTL).
// ---------------------------------------------------------------------------
async function seedNearExpirySession(): Promise<string> {
  const { createSession } = await import("../services/session-store");
  // Override the expiresAt after creation so the stored row is near-expiry.
  const token = await createSession(CASE_ID, ACCESS_CODE);
  const row = portalSessionStore.get(token);
  if (row) {
    row.expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes left
    portalSessionStore.set(token, row);
  }
  return token;
}

// ============================================================================
// Setup: reset shared state before every test.
// ============================================================================
beforeEach(() => {
  rateLimitRow = null;
  portalSessionStore.clear();
  createdSessions.length = 0;
  vi.clearAllMocks();
});

// ============================================================================
// 1. Correct PIN — fresh session issued; TTL reset to 7 days
// ============================================================================

describe("POST /api/cases/login-pin — correct PIN issues a fresh session", () => {
  it("returns 200 with a sessionToken when credentials are valid", async () => {
    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: CORRECT_PIN });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.sessionToken).toBe("string");
    expect(res.body.sessionToken.length).toBeGreaterThan(0);
  });

  it("returns the case id and access code alongside the session token", async () => {
    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: CORRECT_PIN });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(CASE_ID);
    expect(res.body.accessCode).toBe(ACCESS_CODE);
  });

  it("issues a session with a ~7-day TTL (re-auth resets the expiry clock)", async () => {
    // Seed an existing near-expiry session to simulate the re-auth scenario.
    const oldToken = await seedNearExpirySession();

    const before = Date.now();
    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: CORRECT_PIN });

    expect(res.status).toBe(200);
    const newToken = res.body.sessionToken as string;
    expect(newToken).not.toBe(oldToken); // a brand-new token must be issued

    // Verify the new session's TTL is close to 7 days.
    const newRow = portalSessionStore.get(newToken);
    expect(newRow).toBeDefined();
    const ttlMs = newRow.expiresAt.getTime() - before;
    const sevenDaysMs = SESSION_TTL_MS;
    // TTL must be within ±5 seconds of exactly 7 days.
    expect(ttlMs).toBeGreaterThanOrEqual(sevenDaysMs - 5_000);
    expect(ttlMs).toBeLessThanOrEqual(sevenDaysMs + 5_000);
  });

  it("stores the new session in the session store so subsequent portal requests succeed", async () => {
    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: CORRECT_PIN });

    expect(res.status).toBe(200);
    const token = res.body.sessionToken as string;
    expect(portalSessionStore.has(token)).toBe(true);
  });
});

// ============================================================================
// 2. Wrong PIN — 401, no session issued
// ============================================================================

describe("POST /api/cases/login-pin — wrong PIN returns 401 and no token", () => {
  it("returns 401 when the PIN does not match", async () => {
    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: WRONG_PIN_VALUE });

    expect(res.status).toBe(401);
    expect(res.body.sessionToken).toBeUndefined();
  });

  it("does not create a portal session on a wrong-PIN attempt", async () => {
    await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: WRONG_PIN_VALUE });

    expect(createdSessions.length).toBe(0);
    expect(portalSessionStore.size).toBe(0);
  });

  it("returns 401 for an unknown access code (case not found)", async () => {
    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: "NONEXISTENT-CODE", pin: CORRECT_PIN });

    expect(res.status).toBe(401);
    expect(res.body.sessionToken).toBeUndefined();
  });

  it("returns 401 when the case has no PIN set", async () => {
    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: "NO-PIN-CODE", pin: CORRECT_PIN });

    expect(res.status).toBe(401);
    expect(res.body.sessionToken).toBeUndefined();
  });

  it("returns 400 when the PIN field is missing", async () => {
    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE });

    expect(res.status).toBe(400);
  });

  it("returns 400 when the PIN is fewer than 6 digits", async () => {
    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: "123" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when the PIN contains non-digit characters", async () => {
    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: "12345a" });

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// 3. Disabled account — 403 even with correct PIN
// ============================================================================

describe("POST /api/cases/login-pin — disabled account returns 403", () => {
  it("returns 403 when the account is disabled, even if the PIN is correct", async () => {
    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: "DISABLED-CODE", pin: CORRECT_PIN });

    expect(res.status).toBe(403);
    expect(res.body.sessionToken).toBeUndefined();
  });
});

// ============================================================================
// 4. Rate limiting — threshold still fires on the re-auth path
// ============================================================================

describe("POST /api/cases/login-pin — rate limiting", () => {
  it("returns 429 immediately when the IP is already locked out (DB-backed)", async () => {
    // Pre-populate the rate-limit row to simulate MAX_PIN_ATTEMPTS (5) failures.
    rateLimitRow = {
      count: 5,
      resetAt: new Date(Date.now() + 15 * 60 * 1000), // 15-min lockout window
    };

    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: CORRECT_PIN });

    expect(res.status).toBe(429);
    expect(res.body.sessionToken).toBeUndefined();
    expect(typeof res.body.retryAfter).toBe("number");
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });

  it("does not issue a session when the rate limit blocks the request", async () => {
    rateLimitRow = {
      count: 5,
      resetAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: CORRECT_PIN });

    expect(createdSessions.length).toBe(0);
  });

  it("accumulates failures across sequential wrong-PIN attempts and locks out at threshold", async () => {
    const MAX = 5;
    // Send MAX wrong-PIN attempts. Each one calls recordPinAttempt(ip, false)
    // which updates the shared rateLimitRow via atomicIncrementRateLimit.
    for (let i = 0; i < MAX; i++) {
      const res = await request(app)
        .post("/api/cases/login-pin")
        .send({ accessCode: ACCESS_CODE, pin: WRONG_PIN_VALUE });
      expect(res.status).toBe(401);
    }

    // After MAX failures the DB row has count = MAX; the next request
    // reads that row via checkPinRateLimit and must return 429.
    const lockedRes = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: CORRECT_PIN });

    expect(lockedRes.status).toBe(429);
    expect(lockedRes.body.retryAfter).toBeGreaterThan(0);
  });

  it("clears the rate-limit counter on a successful re-auth so subsequent correct-PIN logins succeed", async () => {
    // Simulate 4 prior failures (one under the threshold) so the counter is
    // non-zero, then succeed — the counter must be cleared.
    rateLimitRow = {
      count: 4,
      resetAt: new Date(Date.now() + 10 * 60 * 1000),
    };

    const successRes = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: CORRECT_PIN });

    expect(successRes.status).toBe(200);
    expect(successRes.body.sessionToken).toBeDefined();

    // clearAdminLoginAttemptKey must have been called to reset the counter.
    const { storage } = await import("../storage");
    expect(storage.clearAdminLoginAttemptKey).toHaveBeenCalledWith(
      expect.stringContaining("pin_login:"),
    );
    // The in-memory row must also be gone.
    expect(rateLimitRow).toBeNull();
  });
});

// ============================================================================
// 5. In-memory fallback — DB throws, enforcement falls back to process-local map
// ============================================================================

describe("POST /api/cases/login-pin — in-memory fallback when DB is unavailable", () => {
  it("allows a valid login when the DB lookup throws and the fallback map is clean", async () => {
    // Make the DB lookup throw so checkPinRateLimit falls back to the empty map.
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminLoginAttemptByKey).mockRejectedValueOnce(
      new Error("DB connection lost"),
    );

    const res = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: CORRECT_PIN });

    // Should succeed — clean fallback map means no lockout.
    expect(res.status).toBe(200);
    expect(typeof res.body.sessionToken).toBe("string");
  });

  it("enforces lockout via the in-memory map when the DB increment throws on failed attempts", async () => {
    const { storage } = await import("../storage");

    // Make getAdminLoginAttemptByKey always return null (clean slate) and
    // atomicIncrementRateLimit always throw, so each failure is recorded only
    // in the in-memory fallback map.
    vi.mocked(storage.getAdminLoginAttemptByKey).mockResolvedValue(undefined);
    vi.mocked(storage.atomicIncrementRateLimit).mockRejectedValue(
      new Error("DB increment unavailable"),
    );

    const MAX = 5;
    for (let i = 0; i < MAX; i++) {
      const res = await request(app)
        .post("/api/cases/login-pin")
        .send({ accessCode: ACCESS_CODE, pin: WRONG_PIN_VALUE });
      expect(res.status).toBe(401);
    }

    // After MAX failures the in-memory map should have reached the threshold.
    // checkPinRateLimit now also falls back to the map (DB still throws) and
    // must return 429.
    vi.mocked(storage.getAdminLoginAttemptByKey).mockRejectedValue(
      new Error("DB still down"),
    );

    const lockedRes = await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: CORRECT_PIN });

    expect(lockedRes.status).toBe(429);
    expect(lockedRes.body.retryAfter).toBeGreaterThan(0);
  });

  it("emits console.warn (not console.error) when the DB throws during rate-limit lookup", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminLoginAttemptByKey).mockRejectedValueOnce(
      new Error("transient DB error"),
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await request(app)
      .post("/api/cases/login-pin")
      .send({ accessCode: ACCESS_CODE, pin: CORRECT_PIN });

    // The fallback must warn, never error.
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("checkPinRateLimit"),
      expect.anything(),
    );

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

// ── Source-string operator guards ─────────────────────────────────────────────
// Assert that the PIN rate-limiter uses >= (not >) for its threshold checks on
// both the DB-backed path and the in-memory fallback. A one-character change to
// > would silently allow one extra brute-force attempt before the lockout fires.
// Mirrored by inline comments at each guarded site in server/routes/cases.ts.
describe("source-string operator guards — PIN rate limiter (cases.ts)", () => {
  it("DB-backed path uses >= MAX_PIN_ATTEMPTS (not >)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("server/routes/cases.ts"), "utf8");
    expect(
      src,
      "cases.ts DB-backed PIN rate-limiter must use >= (not >) for MAX_PIN_ATTEMPTS",
    ).toMatch(/row\.count >= MAX_PIN_ATTEMPTS/);
  });

  it("in-memory fallback path uses >= MAX_PIN_ATTEMPTS (not >)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("server/routes/cases.ts"), "utf8");
    expect(
      src,
      "cases.ts in-memory PIN rate-limiter must use >= (not >) for MAX_PIN_ATTEMPTS",
    ).toMatch(/mem\.count >= MAX_PIN_ATTEMPTS/);
  });
});
