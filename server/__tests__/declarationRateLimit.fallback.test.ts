import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Declaration-read rate-limiter — in-memory fallback when DB is unavailable
//
// Verifies that when the DB-backed rate-limit helpers throw:
//  1. checkDeclarationReadRateLimit falls back to the in-memory bucket
//     and correctly blocks after MAX_DECLARATION_READ_FAILURES (5) failures.
//  2. recordDeclarationReadFailure silently updates the in-memory bucket
//     when atomicIncrementRateLimit throws.
//  3. warnOnce (console.warn) is called on the first DB error, not
//     console.error, and is deduplicated (not re-fired on every request).
// ============================================================================

// ---------------------------------------------------------------------------
// Control variables for the storage mock
// ---------------------------------------------------------------------------
let dbShouldThrow = false;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminLoginAttemptByKey: vi.fn(async (_key: string) => {
      if (dbShouldThrow) throw new Error("simulated DB outage");
      return null;
    }),
    atomicIncrementRateLimit: vi.fn(async () => {
      if (dbShouldThrow) throw new Error("simulated DB outage");
      return { count: 1, resetAt: new Date(Date.now() + 10 * 60 * 1000) };
    }),
    clearAdminLoginAttemptKey: vi.fn(async () => {}),
    getCaseById: vi.fn(async (id: string) => ({
      id,
      accessCode: "TEST-CODE",
      declarationAccessCode: "VALID-DECL-CODE",
      declarationAccessExpiresAt: null,
      isDisabled: false,
      status: "active",
      userName: "Test User",
    })),
    createAuditLog: vi.fn(async () => ({})),
    getPortalSession: vi.fn(async () => null),
    createPortalSession: vi.fn(async () => ({})),
    deletePortalSession: vi.fn(async () => {}),
    deletePortalSessionsByCaseId: vi.fn(async () => 0),
    deleteExpiredPortalSessions: vi.fn(async () => 0),
    getAdminSessionByToken: vi.fn(async () => null),
    updateAdminSessionActivity: vi.fn(async () => {}),
  }),
}));

vi.mock("../services/portal-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/portal-auth")>();
  return {
    ...actual,
    validatePortalSession: vi.fn(async () => null),
  };
});

// ---------------------------------------------------------------------------
// Import the router AFTER mocks are established
// ---------------------------------------------------------------------------
const {
  casesRouter,
  __resetDeclarationReadRateLimitForTests,
  __resetWarnDedupForTests,
} = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const app = buildApp();
const CASE_ID = "test-case-fallback-001";

// ---------------------------------------------------------------------------
// Reset state between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  dbShouldThrow = false;
  __resetDeclarationReadRateLimitForTests();
  __resetWarnDedupForTests();
  vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe("declaration-read rate limiter — in-memory fallback", () => {
  it("allows requests when the DB throws (clean in-memory state)", async () => {
    dbShouldThrow = true;
    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/declaration`)
      .set("x-forwarded-for", "10.0.0.1");

    // Auth fails (no creds supplied) → 401, NOT blocked by rate-limiter yet
    expect(res.status).toBe(401);
  });

  it("blocks after 5 failed attempts using in-memory fallback when DB is unavailable", async () => {
    dbShouldThrow = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 5 failed auth attempts accumulate in the in-memory bucket
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .get(`/api/cases/${CASE_ID}/declaration`)
        .set("x-forwarded-for", "10.0.0.2");
      expect(res.status).toBe(401);
    }

    // 6th attempt — rate limiter should engage from in-memory bucket
    const blockedRes = await request(app)
      .get(`/api/cases/${CASE_ID}/declaration`)
      .set("x-forwarded-for", "10.0.0.2");

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toMatch(/too many/i);
    expect(blockedRes.headers["retry-after"]).toBeDefined();

    warnSpy.mockRestore();
  });

  it("logs via console.warn (not console.error) when DB throws", async () => {
    dbShouldThrow = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await request(app)
      .get(`/api/cases/${CASE_ID}/declaration`)
      .set("x-forwarded-for", "10.0.0.3");

    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("deduplicates the DB-error warning (warnOnce suppresses repeats within 1 min)", async () => {
    dbShouldThrow = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Fire two back-to-back requests — both trigger the DB catch block
    await request(app)
      .get(`/api/cases/${CASE_ID}/declaration`)
      .set("x-forwarded-for", "10.0.0.4");
    await request(app)
      .get(`/api/cases/${CASE_ID}/declaration`)
      .set("x-forwarded-for", "10.0.0.4");

    // warnOnce should have suppressed the second warning
    const dbFallbackWarnings = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === "string" && msg.includes("DB lookup failed"),
    );
    expect(dbFallbackWarnings.length).toBe(1);

    warnSpy.mockRestore();
  });

  it("falls back gracefully when atomicIncrementRateLimit throws", async () => {
    dbShouldThrow = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 5 requests — each recordDeclarationReadFailure call hits the DB throw
    // but still updates in-memory. The 6th should be blocked in-memory.
    for (let i = 0; i < 5; i++) {
      await request(app)
        .get(`/api/cases/${CASE_ID}/declaration`)
        .set("x-forwarded-for", "10.0.0.5");
    }

    const res = await request(app)
      .get(`/api/cases/${CASE_ID}/declaration`)
      .set("x-forwarded-for", "10.0.0.5");

    expect(res.status).toBe(429);

    // Confirm the increment-failure warning was emitted at least once
    const incrementWarnings = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === "string" && msg.includes("DB atomic increment failed"),
    );
    expect(incrementWarnings.length).toBeGreaterThanOrEqual(1);

    warnSpy.mockRestore();
  });
});

// ── Source-string operator guards ─────────────────────────────────────────────
// Assert that the declaration read rate-limiter and burst-alert dispatcher each
// use >= (not >) for their threshold checks. A one-character change to > would
// silently allow one extra attempt before a lockout fires, or delay a security
// alert by one event. Mirrored by inline comments at each guarded site in
// server/routes/cases.ts.
describe("source-string operator guards — declaration read rate limiter + burst alerts (cases.ts)", () => {
  it("DB-backed path uses >= MAX_DECLARATION_READ_FAILURES (not >)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("server/routes/cases.ts"), "utf8");
    expect(
      src,
      "cases.ts DB-backed read-limiter must use >= (not >) for MAX_DECLARATION_READ_FAILURES",
    ).toMatch(/row\.count >= MAX_DECLARATION_READ_FAILURES/);
  });

  it("in-memory fallback path uses >= MAX_DECLARATION_READ_FAILURES (not >)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("server/routes/cases.ts"), "utf8");
    expect(
      src,
      "cases.ts in-memory read-limiter must use >= (not >) for MAX_DECLARATION_READ_FAILURES",
    ).toMatch(/attempts\.count >= MAX_DECLARATION_READ_FAILURES/);
  });

  it("burst-attempt threshold uses >= BURST_ATTEMPT_THRESHOLD (not >)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("server/routes/cases.ts"), "utf8");
    expect(
      src,
      "cases.ts burst-alert dispatcher must use >= (not >) for BURST_ATTEMPT_THRESHOLD",
    ).toMatch(/bucket\.count >= BURST_ATTEMPT_THRESHOLD/);
  });

  it("distinct-cases threshold uses >= BURST_DISTINCT_CASES_THRESHOLD (not >)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("server/routes/cases.ts"), "utf8");
    expect(
      src,
      "cases.ts burst-alert dispatcher must use >= (not >) for BURST_DISTINCT_CASES_THRESHOLD",
    ).toMatch(/bucket\.caseIds\.size >= BURST_DISTINCT_CASES_THRESHOLD/);
  });
});
