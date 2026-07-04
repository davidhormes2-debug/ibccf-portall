import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";
import type {
  cases as CasesTable,
  accessKeyRequests as AccessKeyRequestsTable,
} from "@shared/schema";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// The hand-rolled DB rows below (dbCaseRow, storage mock returns, the
// access-key-request insert mock) mimic real Drizzle table column names. These
// Pick<> declarations make `npm run check` fail if any referenced column is
// renamed in shared/schema.ts, so the mocks can never silently drift.
declare const _casesGuard: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "isDisabled"
  | "forceLogoutAt"
  | "userPin"
  | "status"
  | "userName"
  | "withdrawalStage"
>;
declare const _accessKeyRequestsGuard: Pick<
  typeof AccessKeyRequestsTable,
  | "id"
  | "requestId"
  | "generatedKey"
  | "status"
  | "userName"
  | "userEmail"
  | "userPhone"
  | "requestReason"
  | "caseId"
  | "expiresAt"
>;

// ============================================================================
// Portal Authentication Hardening Tests
//
// Covers the three high-severity authentication vulnerabilities addressed
// in this task:
//
//   1. GET /api/cases/access/:code must require a valid portal session (or
//      admin token) when the case already has a PIN set. The access code
//      alone must not be sufficient to read private case metadata.
//
//   2. POST /api/access-key-requests/portal/:caseId must require an
//      authenticated portal session. The old path that accepted a raw
//      accessCode in the body is no longer permitted.
//
//   3. Session revocation must be enforced via DB state (isDisabled,
//      forceLogoutAt, accessCode rotation) so that admin force-logout,
//      account disablement, and credential rotation take effect on every
//      app instance in an autoscaled deployment — not only the instance
//      that processed the admin action.
// ============================================================================

const ADMIN_TOKEN = "admin-token-test";

const TEST_ADMIN_USERNAME = "portal-auth-hardening-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ------------------------------------------------------------------
// Shared DB state for isCaseSessionRevoked checks.
// portal-auth.ts queries the `cases` table on every token validation.
// We provide a configurable in-memory row so each test controls what
// the server sees without touching a real database.
// ------------------------------------------------------------------
let dbCaseRow: {
  isDisabled: boolean;
  forceLogoutAt: Date | null;
  accessCode: string;
} | null = { isDisabled: false, forceLogoutAt: null, accessCode: "VALID-CODE-1" };

// Secondary DB row for access-key-requests table queries.
let dbKeyRequestRow: any | null = null;

// Drizzle table objects carry their name on a well-known Symbol.
// We use this to return different rows for the `cases` table vs the
// `access_key_requests` table so the portal key-request endpoint's
// duplicate check and case lookup both behave correctly in tests.
const DRIZZLE_NAME = Symbol.for("drizzle:BaseName");

vi.mock("../db", () => {
  const mockDb: any = {
    select: () => ({
      from: (table: any) => ({
        where: async () => {
          const tableName: string = table?.[DRIZZLE_NAME] ?? "";
          if (tableName === "access_key_requests") {
            // Return the pre-configured row (or empty = no active request).
            return dbKeyRequestRow ? [dbKeyRequestRow] : [];
          }
          // Default: return the case row (covers cases + any other table).
          return dbCaseRow ? [dbCaseRow] : [];
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: async () => [
          {
            id: 1,
            requestId: "REQ-TEST",
            generatedKey: "NEW-KEY-123",
            status: "pending",
            userName: "Test",
            userEmail: "test@example.com",
            userPhone: null,
            requestReason: null,
            caseId: "case-1",
            expiresAt: new Date(),
          },
        ],
      }),
    }),
  };
  return { db: mockDb };
});

// Shared "Postgres" stand-in for portal_sessions.
const portalSessionStore = new Map<string, any>();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? { id: 1, isActive: true, revokedAt: null, expiresAt: null, adminUsername: TEST_ADMIN_USERNAME }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    // PIN rate-limiting storage methods used by checkPinRateLimit / recordPinAttempt.
    getAdminLoginAttemptByKey: vi.fn(async () => null),
    clearAdminLoginAttemptKey: vi.fn(async () => {}),
    atomicIncrementRateLimit: vi.fn(async () => ({ count: 1, resetAt: new Date(Date.now() + 60_000) })),
    // Endpoint-specific fetchers for case-scoped reads.
    getCaseLetterByCaseId: vi.fn(async () => ({ id: 1, content: "letter" })),
    getLetterReissuesByCaseId: vi.fn(async () => []),
    // Portal session persistence (Task #123).
    createPortalSession: vi.fn(async (data: any) => {
      const row = { ...data, createdAt: new Date() };
      portalSessionStore.set(data.token, row);
      return row;
    }),
    getPortalSession: vi.fn(async (token: string) =>
      portalSessionStore.get(token),
    ),
    deletePortalSession: vi.fn(async (token: string) => {
      portalSessionStore.delete(token);
    }),
    deletePortalSessionsByCaseId: vi.fn(async (caseId: string) => {
      let n = 0;
      for (const [t, row] of Array.from(portalSessionStore.entries())) {
        if (row.caseId === caseId) {
          portalSessionStore.delete(t);
          n++;
        }
      }
      return n;
    }),
    deleteExpiredPortalSessions: vi.fn(async () => 0),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    getCaseByAccessCode: vi.fn(async (code: string) => {
      if (code === "NO-PIN-CODE") {
        return { id: "case-nopin", accessCode: "NO-PIN-CODE", userPin: null, isDisabled: false, status: "created" };
      }
      if (code === "HAS-PIN-CODE") {
        return { id: "case-haspin", accessCode: "HAS-PIN-CODE", userPin: "$2b$10$hashedpin", isDisabled: false, status: "active", userName: "Alice", withdrawalStage: 3 };
      }
      if (code === "DISABLED-CODE") {
        return { id: "case-disabled", accessCode: "DISABLED-CODE", userPin: "$2b$10$hashedpin", isDisabled: true, status: "active" };
      }
      return null;
    }),
    updateCase: vi.fn(async () => ({})),
    getAllCases: vi.fn(async () => []),
    createCase: vi.fn(),
    getCaseById: vi.fn(async () => null),
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendKeyRequestConfirmation: vi.fn(async () => {}),
    sendKeyApprovalNotification: vi.fn(async () => {}),
  }),
}));

const { casesRouter } = await import("../routes/cases");
const { accessKeyRequestsRouter } = await import("../routes/access-key-requests");
const { createSession } = await import("../services/session-store");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/cases", casesRouter);
  app.use("/api/access-key-requests", accessKeyRequestsRouter);
  return app;
}

const app = buildApp();

// ============================================================================
// Vulnerability 1: GET /api/cases/access/:code
// ============================================================================

describe("GET /api/cases/access/:code — session required when PIN is set", () => {
  beforeEach(() => {
    dbCaseRow = { isDisabled: false, forceLogoutAt: null, accessCode: "HAS-PIN-CODE" };
  });

  it("returns 401 for a PIN-protected case with no session token (access code alone is not enough)", async () => {
    const res = await request(app).get("/api/cases/access/HAS-PIN-CODE");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a PIN-protected case with an expired/invalid session token", async () => {
    const res = await request(app)
      .get("/api/cases/access/HAS-PIN-CODE")
      .set("x-portal-session-token", "not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a PIN-protected case with a session token belonging to a different case", async () => {
    const wrongCaseToken = await createSession("other-case-id", "OTHER-CODE");
    const res = await request(app)
      .get("/api/cases/access/HAS-PIN-CODE")
      .set("x-portal-session-token", wrongCaseToken);
    expect(res.status).toBe(401);
  });

  it("returns 200 with case data when a valid session token for the correct case is supplied", async () => {
    const token = await createSession("case-haspin", "HAS-PIN-CODE");
    const res = await request(app)
      .get("/api/cases/access/HAS-PIN-CODE")
      .set("x-portal-session-token", token);
    expect(res.status).toBe(200);
    expect(res.body.accessCode).toBe("HAS-PIN-CODE");
  });

  it("returns 200 for a PIN-protected case when an admin bearer token is used", async () => {
    const res = await request(app)
      .get("/api/cases/access/HAS-PIN-CODE")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("returns 404 for an unknown access code", async () => {
    const res = await request(app).get("/api/cases/access/UNKNOWN-CODE");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/cases/access/:code — bootstrap allowed when no PIN is set", () => {
  beforeEach(() => {
    dbCaseRow = { isDisabled: false, forceLogoutAt: null, accessCode: "NO-PIN-CODE" };
  });

  it("returns 200 without any session token when the case has no PIN yet (initial registration bootstrap)", async () => {
    const res = await request(app).get("/api/cases/access/NO-PIN-CODE");
    expect(res.status).toBe(200);
    expect(res.body.accessCode).toBe("NO-PIN-CODE");
  });
});

describe("GET /api/cases/access/:code — disabled cases always blocked", () => {
  beforeEach(() => {
    dbCaseRow = { isDisabled: true, forceLogoutAt: null, accessCode: "DISABLED-CODE" };
  });

  it("returns 403 for a disabled case even without a session token", async () => {
    const res = await request(app).get("/api/cases/access/DISABLED-CODE");
    expect(res.status).toBe(403);
  });

  it("returns 403 for a disabled case even with a portal session token", async () => {
    const token = await createSession("case-disabled", "DISABLED-CODE");
    const res = await request(app)
      .get("/api/cases/access/DISABLED-CODE")
      .set("x-portal-session-token", token);
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Vulnerability 2: POST /api/access-key-requests/portal/:caseId
// ============================================================================

describe("POST /api/access-key-requests/portal/:caseId — session required", () => {
  const CASE_ID = "case-1";

  beforeEach(() => {
    dbCaseRow = { isDisabled: false, forceLogoutAt: null, accessCode: "VALID-CODE-1" };
    dbKeyRequestRow = null;
  });

  it("returns 401 with no session token (access-code-only requests are rejected)", async () => {
    const res = await request(app)
      .post(`/api/access-key-requests/portal/${CASE_ID}`)
      .send({ userName: "Attacker", userEmail: "attacker@evil.com", accessCode: "VALID-CODE-1" });
    expect(res.status).toBe(401);
  });

  it("returns 401 with a session token for a different case", async () => {
    const wrongToken = await createSession("other-case", "VALID-CODE-1");
    const res = await request(app)
      .post(`/api/access-key-requests/portal/${CASE_ID}`)
      .set("x-portal-session-token", wrongToken)
      .send({ userName: "Attacker", userEmail: "attacker@evil.com" });
    expect(res.status).toBe(401);
  });

  it("returns 201 with a valid session token for the correct case", async () => {
    const token = await createSession(CASE_ID, "VALID-CODE-1");
    const res = await request(app)
      .post(`/api/access-key-requests/portal/${CASE_ID}`)
      .set("x-portal-session-token", token)
      .set("Content-Type", "application/json")
      .send({ userName: "Alice", userEmail: "alice@example.com" });
    expect(res.status).toBe(201);
    expect(res.body.requestId).toBeDefined();
  });
});

// ============================================================================
// Vulnerability 3: Cross-instance session revocation via DB state
// ============================================================================

describe("Cross-instance session revocation — requirePortalAccess enforces DB state", () => {
  // Use GET /api/cases/case-1/letter (requirePortalAccess) as the probe route.
  const PROBE_URL = "/api/cases/case-1/letter";

  beforeEach(() => {
    dbCaseRow = { isDisabled: false, forceLogoutAt: null, accessCode: "VALID-CODE-1" };
  });

  it("allows a valid session when DB shows account is healthy", async () => {
    const token = await createSession("case-1", "VALID-CODE-1");
    const res = await request(app)
      .get(PROBE_URL)
      .set("x-portal-session-token", token);
    expect(res.status).toBe(200);
  });

  it("rejects a stolen token when the DB shows the account is disabled (isDisabled=true)", async () => {
    const token = await createSession("case-1", "VALID-CODE-1");
    // Simulate admin disabling the account after the session was created.
    dbCaseRow = { isDisabled: true, forceLogoutAt: null, accessCode: "VALID-CODE-1" };
    const res = await request(app)
      .get(PROBE_URL)
      .set("x-portal-session-token", token);
    expect(res.status).toBe(401);
  });

  it("rejects a stolen token when the DB shows a force-logout was issued after session creation", async () => {
    const token = await createSession("case-1", "VALID-CODE-1");
    // Simulate admin force-logout: set forceLogoutAt to a time in the future
    // (i.e., newer than the session we just created).
    const futureLogout = new Date(Date.now() + 5_000);
    dbCaseRow = { isDisabled: false, forceLogoutAt: futureLogout, accessCode: "VALID-CODE-1" };
    const res = await request(app)
      .get(PROBE_URL)
      .set("x-portal-session-token", token);
    expect(res.status).toBe(401);
  });

  it("rejects a stolen token when the DB shows the access code was rotated (key reissue / reactivation)", async () => {
    const token = await createSession("case-1", "VALID-CODE-1");
    // Simulate an admin-approved key reissue that rotated the access code.
    dbCaseRow = { isDisabled: false, forceLogoutAt: null, accessCode: "NEW-ROTATED-CODE" };
    const res = await request(app)
      .get(PROBE_URL)
      .set("x-portal-session-token", token);
    expect(res.status).toBe(401);
  });

  it("rejects a session token that does not exist in the in-memory store at all", async () => {
    const res = await request(app)
      .get(PROBE_URL)
      .set("x-portal-session-token", "completely-fabricated-token");
    expect(res.status).toBe(401);
  });
});
