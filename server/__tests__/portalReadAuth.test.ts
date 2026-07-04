import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { cases as CasesTable } from "@shared/schema";
import { createStorageMock } from "./helpers/storageMock";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// `dbCaseRow` below hand-rolls `cases` columns read by the session-revocation
// check. This Pick<> declaration fails `npm run check` if any referenced column
// is renamed in shared/schema.ts, preventing silent mock drift.
declare const _casesGuard: Pick<
  typeof CasesTable,
  "isDisabled" | "forceLogoutAt" | "accessCode"
>;

// Confirms that the case-scoped read endpoints loaded by the portal's
// `loadAllData` (letter, submissions, admin-messages, deposit-receipts,
// reissues, document-requests) require either an admin bearer token or
// a portal session whose caseId matches the URL :id. A leaked case ID
// alone must no longer be enough to read any of them.

const ADMIN_TOKEN = "admin-token-abc";

const TEST_ADMIN_USERNAME = "portal-read-auth-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// The portal auth layer calls isCaseSessionRevoked() on every token
// validation. That function queries the DB; we stub it here so tests
// can run without a real database. The default row represents a healthy,
// non-revoked case whose accessCode matches what createSession() below
// will stamp into the in-memory session store.
let dbCaseRow: { isDisabled: boolean; forceLogoutAt: Date | null; accessCode: string } | null = {
  isDisabled: false,
  forceLogoutAt: null,
  accessCode: "ABCD-1234",
};

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => (dbCaseRow ? [dbCaseRow] : []),
      }),
    }),
  },
}));

// Shared "Postgres" stand-in for portal_sessions — mirrors how the real
// DatabaseStorage methods share state across autoscale instances.
const portalSessionStore = new Map<string, any>();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? { id: 1, isActive: true, revokedAt: null, expiresAt: null, adminUsername: TEST_ADMIN_USERNAME }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    // Per-endpoint fetchers — return cheap, valid shapes.
    getCaseLetterByCaseId: vi.fn(async () => ({ id: 1, content: "letter" })),
    getLetterReissuesByCaseId: vi.fn(async () => []),
    getSubmissionsByCaseId: vi.fn(async () => []),
    getAdminMessagesByCaseId: vi.fn(async () => []),
    getDepositReceiptsByCaseId: vi.fn(async () => []),
    getDocumentRequestsByCaseId: vi.fn(async () => []),
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

const { casesRouter } = await import("../routes/cases");
const { registerCaseSubmissionRoutes } = await import("../routes/submissions");
const { registerCaseMessageRoutes } = await import("../routes/messages");
const { registerCaseDepositRoutes } = await import("../routes/deposits");
const { registerCaseDocumentRoutes } = await import("../routes/content");
const { createSession } = await import("../services/session-store");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  // Match production registration order (registerCaseXxxRoutes attaches
  // each sub-router onto casesRouter under /api/cases).
  registerCaseSubmissionRoutes(casesRouter);
  registerCaseMessageRoutes(casesRouter);
  registerCaseDepositRoutes(casesRouter);
  registerCaseDocumentRoutes(casesRouter);
  app.use("/api/cases", casesRouter);
  return app;
}

const app = buildApp();

const ENDPOINTS = [
  "/api/cases/case-1/letter",
  "/api/cases/case-1/reissues",
  "/api/cases/case-1/submissions",
  "/api/cases/case-1/admin-messages",
  "/api/cases/case-1/deposit-receipts",
  "/api/cases/case-1/document-requests",
];

describe("Case-scoped read endpoints require portal/admin auth", () => {
  beforeEach(() => {
    // Restore the default healthy row before each test so tests that
    // mutate dbCaseRow (e.g. revocation tests) don't bleed into others.
    dbCaseRow = { isDisabled: false, forceLogoutAt: null, accessCode: "ABCD-1234" };
  });

  for (const url of ENDPOINTS) {
    describe(`GET ${url}`, () => {
      it("rejects an unauthenticated request with 401", async () => {
        const res = await request(app).get(url);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe("Unauthorized");
      });

      it("rejects a portal session whose caseId does not match :id", async () => {
        const otherToken = await createSession("other-case-id", "OTHER-9999");
        const res = await request(app)
          .get(url)
          .set("x-portal-session-token", otherToken);
        expect(res.status).toBe(401);
      });

      it("allows a portal session whose caseId matches :id", async () => {
        const token = await createSession("case-1", "ABCD-1234");
        const res = await request(app)
          .get(url)
          .set("x-portal-session-token", token);
        expect(res.status).toBe(200);
      });

      it("allows a valid admin bearer token (admin dashboard path)", async () => {
        const res = await request(app)
          .get(url)
          .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
        expect(res.status).toBe(200);
      });

      it("rejects an unknown bearer token", async () => {
        const res = await request(app)
          .get(url)
          .set("Authorization", "Bearer not-a-real-token");
        expect(res.status).toBe(401);
      });
    });
  }
});
