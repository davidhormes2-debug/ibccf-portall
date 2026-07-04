import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import type { cases as CasesTable } from "@shared/schema";
import { createStorageMock } from "./helpers/storageMock";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// `dbCaseRow` and `baseCase` below hand-roll `cases` columns. This Pick<>
// declaration fails `npm run check` if any of these column names are renamed in
// shared/schema.ts, preventing silent mock drift.
declare const _casesGuard: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "isDisabled"
  | "forceLogoutAt"
  | "userName"
  | "userEmail"
  | "status"
  | "sealedAt"
  | "preferredLocale"
>;

// ============================================================================
// Financial Signatory flow (Task #140) coverage:
//
//   1. GET /api/cases/:id/document-templates/:category — returns a PDF for
//      an admin bearer, returns a PDF for a portal session bound to the
//      case, and rejects other portal sessions / anonymous callers with
//      401.
//   2. POST /api/cases/:id/document-requests — `category` is a routing
//      hint only: it MUST be stripped from the insert payload, and the
//      audit log action MUST become `document_requested:<category>`. A
//      call without `category` still records the bare `document_requested`
//      action.
//   3. Each of the seven canonical FINANCIAL_SIGNATORY_CATEGORIES round-
//      trips through `buildFinancialSignatoryTemplate` and produces a
//      buffer with a valid PDF signature.
// ============================================================================

const ADMIN_TOKEN = "admin-token-test";
const ADMIN_USERNAME = "test-admin";

// `checkAdminAuth` validates session.adminUsername === process.env.ADMIN_USERNAME.
// Pin the env var for the duration of this file so admin-bearer requests pass.
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// Shared "DB" row returned by the portal-auth revocation check. The
// `accessCode` here must match whatever we register through
// `createSession()` for that session to validate.
let dbCaseRow: {
  isDisabled: boolean;
  forceLogoutAt: Date | null;
  accessCode: string;
} | null = { isDisabled: false, forceLogoutAt: null, accessCode: "VALID-CODE-1" };

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

// In-memory portal_sessions stand-in (mirrors portalAuthHardening.test.ts).
const portalSessionStore = new Map<string, any>();

// Per-test capture buckets.
const auditLogs: any[] = [];
let lastDocInsert: any = null;
let caseRow: any = null;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? { id: 1, isActive: true, revokedAt: null, expiresAt: null, adminUsername: ADMIN_USERNAME }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    runInTransaction: vi.fn(async (fn: any) => fn({})),
    getCaseById: vi.fn(async () => caseRow),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    createDocumentRequest: vi.fn(async (data: any) => {
      lastDocInsert = { id: 42, ...data };
      return lastDocInsert;
    }),
    getDocumentRequestsByCaseId: vi.fn(async () => []),
    // Portal session persistence used by services/session-store.ts.
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
    deletePortalSessionsByCaseId: vi.fn(async () => 0),
    deleteExpiredPortalSessions: vi.fn(async () => 0),
  }),
}));

// Email service mock — kept minimal. Doc-request emails are fire-and-
// forget so we never await them in assertions.
import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendLocalizedCaseEmail: vi.fn(async () => ({ success: true })),
  }),
}));

const { Router } = await import("express");
const { registerCaseDocumentRoutes, FINANCIAL_SIGNATORY_CATEGORIES } =
  await import("../routes/content");
const { createSession } = await import("../services/session-store");
const { buildFinancialSignatoryTemplate } = await import(
  "../services/financialSignatoryPdf"
);

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const casesRouter = Router();
  registerCaseDocumentRoutes(casesRouter);
  app.use("/api/cases", casesRouter);
  return app;
}

const baseCase = {
  id: "case-1",
  accessCode: "VALID-CODE-1",
  userName: "Test User",
  userEmail: "user@example.com",
  status: "active",
  sealedAt: new Date("2025-01-01T00:00:00Z"), // NDA-signed precondition met
  preferredLocale: "en",
};

function actionAudits(action: string) {
  return auditLogs.filter((a) => a.action === action);
}

beforeEach(() => {
  auditLogs.length = 0;
  lastDocInsert = null;
  caseRow = { ...baseCase };
  portalSessionStore.clear();
  dbCaseRow = {
    isDisabled: false,
    forceLogoutAt: null,
    accessCode: baseCase.accessCode,
  };
});

// ============================================================================
// 1. GET /api/cases/:id/document-templates/:category
// ============================================================================

describe("GET /api/cases/:id/document-templates/:category", () => {
  const app = buildApp();
  const URL = "/api/cases/case-1/document-templates/source_of_funds";

  it("returns a PDF for an admin bearer token", async () => {
    const res = await request(app)
      .get(URL)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toMatch(/attachment;/);
    // PDF magic header "%PDF" — confirms we actually generated a PDF.
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");
  });

  it("returns a PDF for a portal session bound to the same case", async () => {
    const token = await createSession("case-1", baseCase.accessCode);
    const res = await request(app)
      .get(URL)
      .set("x-portal-session-token", token);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");
  });

  it("returns 401 for a portal session bound to a DIFFERENT case", async () => {
    const otherToken = await createSession("other-case", "OTHER-CODE");
    const res = await request(app)
      .get(URL)
      .set("x-portal-session-token", otherToken);

    expect(res.status).toBe(401);
  });

  it("returns 401 for an anonymous caller (no admin token, no portal session)", async () => {
    const res = await request(app).get(URL);
    expect(res.status).toBe(401);
  });

  it("returns 400 for an unknown template category", async () => {
    const res = await request(app)
      .get("/api/cases/case-1/document-templates/totally_bogus")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// 2. POST /api/cases/:id/document-requests — category routing-hint contract
// ============================================================================

describe("POST /api/cases/:id/document-requests — category audit-log contract", () => {
  const app = buildApp();
  const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };

  it("with `category`: strips it from the insert AND records 'document_requested:<category>'", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/document-requests")
      .set(auth)
      .send({
        documentType: "Source of Funds Declaration",
        category: "source_of_funds",
        description: "Please complete and sign.",
      });

    expect(res.status).toBe(200);
    // `category` is a routing hint only — it must NOT reach the storage
    // layer (document_requests has no `category` column).
    expect(lastDocInsert).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(lastDocInsert, "category")).toBe(
      false,
    );
    expect(lastDocInsert.documentType).toBe("Source of Funds Declaration");
    expect(lastDocInsert.description).toBe("Please complete and sign.");

    // Audit row uses the prefixed action (replaces the old bare action).
    expect(actionAudits("document_requested:source_of_funds")).toHaveLength(1);
    expect(actionAudits("document_requested")).toHaveLength(0);
  });

  it("without `category`: still records the bare 'document_requested' action", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/document-requests")
      .set(auth)
      .send({ documentType: "Proof of Income" });

    expect(res.status).toBe(200);
    expect(lastDocInsert).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(lastDocInsert, "category")).toBe(
      false,
    );
    expect(actionAudits("document_requested")).toHaveLength(1);
    // No prefixed variant when no category was supplied.
    expect(
      auditLogs.filter((a) => a.action.startsWith("document_requested:")),
    ).toHaveLength(0);
  });
});

// ============================================================================
// 2b. NDA-signed precondition (Task #140)
// ============================================================================

describe("POST /api/cases/:id/document-requests — NDA-signed precondition", () => {
  const app = buildApp();
  const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };

  it("blocks every financial-signatory category with 409 when sealedAt is null", async () => {
    caseRow = { ...baseCase, sealedAt: null };

    for (const category of FINANCIAL_SIGNATORY_CATEGORIES) {
      auditLogs.length = 0;
      lastDocInsert = null;

      const res = await request(app)
        .post("/api/cases/case-1/document-requests")
        .set(auth)
        .send({
          documentType: DOCUMENT_CATEGORY_LABELS_FOR_TEST[category],
          category,
        });

      expect(res.status).toBe(409);
      // Storage must not be touched and no document_requested* audit row
      // may be written. (Filtering to document_requested* ignores any
      // fire-and-forget `email_*` audits still draining from prior tests'
      // SMTP dispatchers — those are unrelated to the precondition guard.)
      expect(lastDocInsert).toBeNull();
      expect(
        auditLogs.filter((a) => a.action.startsWith("document_requested")),
      ).toHaveLength(0);
    }
  });

  it("allows a financial-signatory category once sealedAt is set", async () => {
    caseRow = { ...baseCase, sealedAt: new Date("2025-06-01T00:00:00Z") };

    const res = await request(app)
      .post("/api/cases/case-1/document-requests")
      .set(auth)
      .send({
        documentType: "Source of Funds Declaration",
        category: "source_of_funds",
      });

    expect(res.status).toBe(200);
    expect(lastDocInsert).toBeTruthy();
    expect(actionAudits("document_requested:source_of_funds")).toHaveLength(1);
  });

  it("allows non-financial-signatory categories even when sealedAt is null", async () => {
    caseRow = { ...baseCase, sealedAt: null };

    // proof_of_income is in DOCUMENT_CATEGORIES but NOT in FINANCIAL_SIGNATORY_CATEGORIES.
    const res1 = await request(app)
      .post("/api/cases/case-1/document-requests")
      .set(auth)
      .send({
        documentType: "Proof of Income",
        category: "proof_of_income",
      });
    expect(res1.status).toBe(200);
    expect(lastDocInsert).toBeTruthy();
    expect(actionAudits("document_requested:proof_of_income")).toHaveLength(1);

    // custom is similarly non-financial-signatory.
    lastDocInsert = null;
    const res2 = await request(app)
      .post("/api/cases/case-1/document-requests")
      .set(auth)
      .send({
        documentType: "Some custom document",
        category: "custom",
      });
    expect(res2.status).toBe(200);
    expect(lastDocInsert).toBeTruthy();
    expect(actionAudits("document_requested:custom")).toHaveLength(1);

    // No category at all is also allowed pre-NDA.
    lastDocInsert = null;
    const res3 = await request(app)
      .post("/api/cases/case-1/document-requests")
      .set(auth)
      .send({ documentType: "Ad-hoc request" });
    expect(res3.status).toBe(200);
    expect(lastDocInsert).toBeTruthy();
  });
});

// Local copy of the labels used to populate `documentType` in the negative
// test above. Imported lazily here so we don't widen the top-of-file
// imports just for one assertion helper.
const DOCUMENT_CATEGORY_LABELS_FOR_TEST: Record<string, string> = {
  source_of_funds: "Source of Funds Declaration",
  beneficial_ownership: "Beneficial Ownership / KYC Attestation",
  fatca_crs: "FATCA / CRS Self-Certification",
  aml_screening: "AML Acknowledgement",
  tax_residency_declaration: "Tax Residency Declaration",
  settlement_authorization: "Settlement / Disbursement Authorization",
  power_of_attorney: "Power of Attorney for Disbursement",
};

// ============================================================================
// 3. Round-trip every canonical FINANCIAL_SIGNATORY_CATEGORIES slug
// ============================================================================

describe("FINANCIAL_SIGNATORY_CATEGORIES round-trip", () => {
  it("exposes exactly the seven canonical category slugs", () => {
    expect([...FINANCIAL_SIGNATORY_CATEGORIES].sort()).toEqual(
      [
        "aml_screening",
        "beneficial_ownership",
        "fatca_crs",
        "power_of_attorney",
        "settlement_authorization",
        "source_of_funds",
        "tax_residency_declaration",
      ].sort(),
    );
  });

  for (const category of FINANCIAL_SIGNATORY_CATEGORIES) {
    it(`builds a valid PDF buffer for "${category}"`, async () => {
      const pdf = await buildFinancialSignatoryTemplate({
        caseRow: baseCase as any,
        category,
      });
      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(500);
      // PDF magic header.
      expect(pdf.slice(0, 4).toString()).toBe("%PDF");
      // PDF EOF marker (pdfkit always emits `%%EOF` followed by newline).
      expect(pdf.slice(-6).toString()).toMatch(/%%EOF/);
    });
  }
});
