import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import type { cases as CasesTable } from "@shared/schema";
import { createStorageMock } from "./helpers/storageMock";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// `dbCaseRow` below hand-rolls `cases` columns read by isCaseSessionRevoked().
// This Pick<> declaration fails `npm run check` if any referenced column is
// renamed in shared/schema.ts, preventing silent mock drift.
declare const _casesGuard: Pick<
  typeof CasesTable,
  "isDisabled" | "forceLogoutAt" | "accessCode" | "sealedAt"
>;

// ============================================================================
// Session revocation after access-code rotation — deposit receipt upload
//
// isCaseSessionRevoked() in portal-auth.ts compares the accessCode stored in
// the portal session against cases.accessCode in the DB. When an admin
// reissues a key (rotating the access code) the old session token must be
// rejected immediately on any subsequent request. These tests verify that
// POST /api/cases/:id/deposit-receipts enforces this via requirePortalAccess.
//
// The real portal-auth middleware is used (not mocked) so the full revocation
// path — createSession → validateSession → isCaseSessionRevoked — is exercised.
// ============================================================================

// Configurable DB case row shared by both isCaseSessionRevoked (reads
// isDisabled / forceLogoutAt / accessCode) and requireUnsealed (reads sealedAt).
let dbCaseRow: {
  isDisabled: boolean;
  forceLogoutAt: Date | null;
  accessCode: string;
  sealedAt: Date | null;
} = {
  isDisabled: false,
  forceLogoutAt: null,
  accessCode: "ORIGINAL-CODE",
  sealedAt: null,
};

vi.mock("../db", () => {
  const mockDb: any = {
    select: () => ({
      from: () => ({
        where: async () => (dbCaseRow ? [dbCaseRow] : []),
      }),
    }),
  };
  return { db: mockDb };
});

// In-memory stand-in for the portal_sessions Postgres table.
const portalSessionStore = new Map<string, any>();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // Admin session look-up — always returns null so no request is treated as admin.
    getAdminSessionByToken: vi.fn(async () => null),
    updateAdminSessionActivity: vi.fn(async () => {}),
    // Portal session CRUD — backed by the in-memory store above.
    createPortalSession: vi.fn(async (data: any) => {
      const row = { ...data, createdAt: new Date() };
      portalSessionStore.set(data.token, row);
      return row;
    }),
    getPortalSession: vi.fn(async (token: string) =>
      portalSessionStore.get(token) ?? null,
    ),
    deletePortalSession: vi.fn(async (token: string) => {
      portalSessionStore.delete(token);
    }),
    deletePortalSessionsByCaseId: vi.fn(async () => 0),
    deleteExpiredPortalSessions: vi.fn(async () => 0),
    // Deposit receipt storage — minimal stubs so the happy-path handler succeeds.
    getDepositReceiptsByCaseId: vi.fn(async () => []),
    countDepositReceiptsByCaseId: vi.fn(async () => 0),
    createDepositReceipt: vi.fn(async (data: any) => ({
      id: 1,
      ...data,
      status: "pending",
    })),
    // Required by the upload route when a reissueId is supplied (not used here).
    getLetterReissueById: vi.fn(async () => null),
  }),
}));

const { registerCaseDepositRoutes } = await import("../routes/deposits");
const { createSession } = await import("../services/session-store");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const router = Router();
  registerCaseDepositRoutes(router);
  app.use("/api/cases", router);
  return app;
}

const app = buildApp();

const CASE_ID = "case-rotation-test";
const ORIGINAL_CODE = "ORIGINAL-CODE";
const NEW_CODE = "ROTATED-CODE";
// Minimal valid data URL that satisfies the server-side input guards.
const VALID_DATA_URL = "data:image/png;base64," + "A".repeat(80);

beforeEach(() => {
  // Reset DB state to a healthy, unrotated account before each test.
  dbCaseRow = {
    isDisabled: false,
    forceLogoutAt: null,
    accessCode: ORIGINAL_CODE,
    sealedAt: null,
  };
  portalSessionStore.clear();
});

describe("POST /api/cases/:id/deposit-receipts — session revocation after access-code rotation", () => {
  it("returns 401 when a session minted before code rotation is used after the code is rotated", async () => {
    // User logs in and receives a session bound to the original access code.
    const staleToken = await createSession(CASE_ID, ORIGINAL_CODE);

    // Admin reissues the key — the DB access code is now different.
    dbCaseRow = { ...dbCaseRow, accessCode: NEW_CODE };

    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/deposit-receipts`)
      .set("x-portal-session-token", staleToken)
      .send({ imageData: VALID_DATA_URL });

    expect(res.status).toBe(401);
  });

  it("returns 200 when a freshly-minted session (with the new code) is used after code rotation", async () => {
    // Admin has already rotated the access code.
    dbCaseRow = { ...dbCaseRow, accessCode: NEW_CODE };

    // User re-authenticates and receives a session bound to the new code.
    const freshToken = await createSession(CASE_ID, NEW_CODE);

    const res = await request(app)
      .post(`/api/cases/${CASE_ID}/deposit-receipts`)
      .set("x-portal-session-token", freshToken)
      .send({ imageData: VALID_DATA_URL });

    expect(res.status).toBe(200);
  });
});
