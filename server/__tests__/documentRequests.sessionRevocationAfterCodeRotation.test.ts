import { describe, it, expect, beforeEach, vi } from "vitest";
import type { cases as CasesTable } from "@shared/schema";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// The mock below hand-rolls the cases columns that portal-auth.ts references
// inside isCaseSessionRevoked(). This Pick<> declaration ensures that if any
// of those column names are renamed in shared/schema.ts, TypeScript reports an
// error here at `npm run check` time so the mock can never silently drift.
//
// Columns asserted: id, isDisabled, forceLogoutAt, accessCode
declare const _casesGuard: Pick<
  typeof CasesTable,
  "id" | "isDisabled" | "forceLogoutAt" | "accessCode"
>;

// ============================================================================
// Session revocation after access-code rotation — document request submission
//
// isCaseSessionRevoked() in portal-auth.ts compares the accessCode stored in
// the portal session against cases.accessCode in the DB. When an admin
// reissues a key (rotating the access code) the old session token must be
// rejected immediately on any subsequent request. These tests verify that
// PATCH /api/document-requests/:id enforces this via isAuthorizedForCase
// (which is called inside the route handler and internally invokes
// isCaseSessionRevoked).
//
// The real portal-auth middleware is used (not mocked) so the full revocation
// path — createSession → validateSession → isCaseSessionRevoked — is
// exercised.
// ============================================================================

// Symbol used by the Drizzle DB mock to dispatch table-specific selects.
const DRIZZLE_NAME = Symbol.for("drizzle:BaseName");

// Configurable DB case row shared by isCaseSessionRevoked (reads
// isDisabled / forceLogoutAt / accessCode).
let dbCaseRow: {
  isDisabled: boolean;
  forceLogoutAt: Date | null;
  accessCode: string;
} = {
  isDisabled: false,
  forceLogoutAt: null,
  accessCode: "ORIGINAL-CODE",
};

// Mock @shared/schema — only the cases table fields that portal-auth.ts
// references. The document-requests route does not import from @shared/schema
// directly, so no additional tables are needed here.
vi.mock("@shared/schema", () => ({
  cases: {
    [DRIZZLE_NAME]: "cases",
    id: "id",
    isDisabled: "isDisabled",
    forceLogoutAt: "forceLogoutAt",
    accessCode: "accessCode",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (_col: unknown, value: unknown) => ({ __eq: value }),
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: async () => {
          const name: string = table?.[DRIZZLE_NAME] ?? "";
          if (name === "cases") return dbCaseRow ? [dbCaseRow] : [];
          return [];
        },
      }),
    }),
  },
}));

// In-memory stand-in for the portal_sessions Postgres table.
const portalSessionStore = new Map<string, any>();

// A mock document request owned by the case under test.
const CASE_ID = "case-doc-rotation-test";
const MOCK_DOC_REQUEST = {
  id: 42,
  caseId: CASE_ID,
  documentType: "Proof of Funds",
  status: "pending",
  uploadsEnabled: true,
  submittedFileData: null,
  submittedFileName: null,
  submittedAt: null,
};

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
    // Document request stubs — the happy-path handler needs these.
    getDocumentRequestById: vi.fn(async (id: number) =>
      id === MOCK_DOC_REQUEST.id ? { ...MOCK_DOC_REQUEST } : null,
    ),
    runInTransaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(null)),
    updateDocumentRequest: vi.fn(async (_id: number, data: any) => ({
      ...MOCK_DOC_REQUEST,
      ...data,
    })),
    createAuditLog: vi.fn(async () => ({ id: 1 })),
  }),
}));

// Stub out the admin-auth middleware so the portal-session branch is exercised.
vi.mock("./middleware", () => ({
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
  isValidAdminToken: vi.fn(async () => false),
}));

// Stub out fire-and-forget side effects that would try to import live services.
vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyAdmin: vi.fn(async () => {}),
  },
}));

const { documentRequestsRouter } = await import("../routes/content");
const { createSession } = await import("../services/session-store");
const { storage } = await import("../storage");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const router = Router();
  router.use("/", documentRequestsRouter);
  app.use("/api/document-requests", router);
  return app;
}

const app = buildApp();

const ORIGINAL_CODE = "ORIGINAL-CODE";
const NEW_CODE = "ROTATED-CODE";
// Minimal valid PNG data URL accepted by validateDocumentDataUrl.
const VALID_DATA_URL = "data:image/png;base64," + "A".repeat(80);
const VALID_FILENAME = "proof.png";

beforeEach(() => {
  dbCaseRow = { isDisabled: false, forceLogoutAt: null, accessCode: ORIGINAL_CODE };
  portalSessionStore.clear();
  vi.mocked(storage.getDocumentRequestById).mockResolvedValue({ ...MOCK_DOC_REQUEST } as any);
});

describe(
  "PATCH /api/document-requests/:id — session revocation after access-code rotation",
  () => {
    it(
      "returns 401 when a session minted before code rotation is used after the code is rotated",
      async () => {
        const staleToken = await createSession(CASE_ID, ORIGINAL_CODE);

        // Admin rotates the access code.
        dbCaseRow = { ...dbCaseRow, accessCode: NEW_CODE };

        const res = await request(app)
          .patch(`/api/document-requests/${MOCK_DOC_REQUEST.id}`)
          .set("x-portal-session-token", staleToken)
          .send({ submittedFileData: VALID_DATA_URL, submittedFileName: VALID_FILENAME });

        expect(res.status).toBe(401);
      },
    );

    it(
      "returns 200 when a freshly-minted session (with the new code) is used after code rotation",
      async () => {
        // Admin has already rotated the access code.
        dbCaseRow = { ...dbCaseRow, accessCode: NEW_CODE };

        const freshToken = await createSession(CASE_ID, NEW_CODE);

        const res = await request(app)
          .patch(`/api/document-requests/${MOCK_DOC_REQUEST.id}`)
          .set("x-portal-session-token", freshToken)
          .send({ submittedFileData: VALID_DATA_URL, submittedFileName: VALID_FILENAME });

        expect(res.status).toBe(200);
      },
    );
  },
);
