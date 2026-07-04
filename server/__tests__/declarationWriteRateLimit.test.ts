import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Declaration-write rate-limiter — DB-backed (happy path) + in-memory fallback
//
// Verifies that the write-side limiter for POST /api/cases/:id/declaration:
//  1. Reads its counter from the DB so multiple instances share state
//     (happy path — `getAdminLoginAttemptByKey` returns a row at/over the
//     threshold and the request is blocked even though this instance has
//     never seen that IP before).
//  2. Falls back to an in-memory bucket when the DB is unavailable and
//     correctly blocks after MAX_DECLARATION_WRITE_FAILURES (5) failures.
// ============================================================================

let dbShouldThrow = false;
let writeRateLimitRow: { count: number; resetAt: Date } | null = null;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminLoginAttemptByKey: vi.fn(async (key: string) => {
      if (dbShouldThrow) throw new Error("simulated DB outage");
      if (key.startsWith("decl_write:")) return writeRateLimitRow;
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
      declarationStatus: "pending",
      isDisabled: false,
      status: "active",
      userName: "Test User",
    })),
    createAuditLog: vi.fn(async () => ({})),
    getPortalSession: vi.fn(async () => null),
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

const {
  casesRouter,
  __resetDeclarationWriteRateLimitForTests,
  __resetWarnDedupForTests,
} = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const app = buildApp();
const CASE_ID = "test-case-write-001";

// Minimal body that passes the Zod schema; uses a deliberately WRONG
// accessCode so each request bumps the failure counter.
function declarationPayload(accessCode = "WRONG-CODE") {
  return {
    fullName: "Test User",
    email: "test@example.com",
    countryOfResidence: "US",
    dateOfBirth: "1990-01-01",
    accessCode,
    notSanctionedJurisdictions: true,
    noSanctionedTransactions: true,
    acknowledgeUsdtNotSupported: true,
    understandFalseInfoConsequences: true,
    preferredAsset: "USDC (Polygon)",
    sourceOfIncome: "Employment",
    regulatoryAcknowledgment: true,
    signatureFullName: "Test User",
    signatureDate: "2025-01-01",
  };
}

beforeEach(() => {
  dbShouldThrow = false;
  writeRateLimitRow = null;
  __resetDeclarationWriteRateLimitForTests();
  __resetWarnDedupForTests();
  vi.clearAllMocks();
});

describe("declaration-write rate limiter — DB-backed (multi-instance safe)", () => {
  it("blocks when the shared DB counter is already at/over the threshold, even on a fresh instance", async () => {
    // Simulate another instance having already recorded 5 failures for this IP.
    writeRateLimitRow = {
      count: 5,
      resetAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/declaration`)
      .set("x-forwarded-for", "10.1.0.1")
      .send(declarationPayload());

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many/i);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("allows the request when the DB counter is under the threshold", async () => {
    writeRateLimitRow = {
      count: 2,
      resetAt: new Date(Date.now() + 10 * 60 * 1000),
    };

    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/declaration`)
      .set("x-forwarded-for", "10.1.0.2")
      .send(declarationPayload());

    // Not blocked by the limiter; falls through to the 403 invalid-access-code path.
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid access code/i);
  });
});

describe("declaration-write rate limiter — in-memory fallback", () => {
  it("blocks after 5 failed attempts using in-memory fallback when DB is unavailable", async () => {
    dbShouldThrow = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 5 wrong-code submissions accumulate in the in-memory fallback bucket
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post(`/api/cases/${CASE_ID}/declaration`)
        .set("x-forwarded-for", "10.2.0.1")
        .send(declarationPayload());
      expect(res.status).toBe(403);
    }

    // 6th attempt — limiter should engage from the in-memory bucket
    const blockedRes = await request(app)
      .post(`/api/cases/${CASE_ID}/declaration`)
      .set("x-forwarded-for", "10.2.0.1")
      .send(declarationPayload());

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toMatch(/too many/i);
    expect(blockedRes.headers["retry-after"]).toBeDefined();

    // Confirm we logged via warn (not error) and dedup is in effect.
    const checkWarnings = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === "string" && msg.includes("checkDeclarationWriteRateLimit"),
    );
    expect(checkWarnings.length).toBe(1);

    warnSpy.mockRestore();
  });

  it("logs the increment-failure path via warnOnce when atomicIncrementRateLimit throws", async () => {
    dbShouldThrow = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await request(app)
      .post(`/api/cases/${CASE_ID}/declaration`)
      .set("x-forwarded-for", "10.2.0.2")
      .send(declarationPayload());

    const incrementWarnings = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === "string" && msg.includes("recordDeclarationWriteFailure"),
    );
    expect(incrementWarnings.length).toBeGreaterThanOrEqual(1);
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

// ── Source-string operator guards ─────────────────────────────────────────────
// Assert that the declaration write rate-limiter uses >= (not >) for its
// threshold checks on both the DB-backed path and the in-memory fallback. A
// one-character change to > would silently allow one extra wrong-code submission
// before the lockout fires. Mirrored by inline comments at each guarded site in
// server/routes/cases.ts.
//
// Also asserts that the declaration access-code equality check uses !==
// (not !=). Loose equality could coerce types and allow a bypass.
describe("source-string operator guards — declaration write rate limiter (cases.ts)", () => {
  it("DB-backed path uses >= MAX_DECLARATION_WRITE_FAILURES (not >)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("server/routes/cases.ts"), "utf8");
    expect(
      src,
      "cases.ts DB-backed write-limiter must use >= (not >) for MAX_DECLARATION_WRITE_FAILURES",
    ).toMatch(/row\.count >= MAX_DECLARATION_WRITE_FAILURES/);
  });

  it("in-memory fallback path uses >= MAX_DECLARATION_WRITE_FAILURES (not >)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("server/routes/cases.ts"), "utf8");
    expect(
      src,
      "cases.ts in-memory write-limiter must use >= (not >) for MAX_DECLARATION_WRITE_FAILURES",
    ).toMatch(/attempts\.count >= MAX_DECLARATION_WRITE_FAILURES/);
  });

  it("declaration access-code equality check uses !== (not !=)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("server/routes/cases.ts"), "utf8");
    // Must find the strict !== form adjacent to declarationAccessCode.
    expect(
      src,
      "cases.ts declaration access-code check must use !== (strict inequality, not !=)",
    ).toMatch(/parsed\.accessCode\.trim\(\) !== caseRow\.declarationAccessCode/);
    // Confirm the loose != form is NOT used for this check.
    expect(
      src,
      "cases.ts declaration access-code check must NOT use loose != inequality",
    ).not.toMatch(/parsed\.accessCode\.trim\(\) != caseRow\.declarationAccessCode[^=]/);
  });
});
