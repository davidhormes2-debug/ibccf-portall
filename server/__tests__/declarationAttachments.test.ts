import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";
import type {
  cases as CasesTable,
  documentRequests as DocumentRequestsTable,
} from "@shared/schema";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// `baseCase`, the case-row mock, and the document_requests seed data below
// hand-roll real Drizzle table columns. These Pick<> declarations fail
// `npm run check` if any referenced column is renamed in shared/schema.ts,
// preventing silent mock drift.
declare const _casesGuard: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "userName"
  | "userEmail"
  | "status"
  | "declarationStatus"
  | "declarationAccessCode"
  | "declarationAccessExpiresAt"
  | "isDisabled"
  | "forceLogoutAt"
>;
declare const _documentRequestsGuard: Pick<
  typeof DocumentRequestsTable,
  "id" | "caseId" | "documentType" | "status" | "submittedFileName" | "submittedAt"
>;

// End-to-end coverage for inline declaration attachments. The portal
// posts a Proof of Source of Income (required) plus up to 3 supporting
// financial documents alongside the Declaration of Compliance; the
// server persists them as document_requests rows in the 'submitted'
// state and writes a `document_submitted` audit row per file.

const auditLogs: any[] = [];
let beforeCase: any = null;
let createdSubmission: any = null;
const createdDocs: any[] = [];

// Shared "Postgres" stand-in for portal_sessions (Task #123).
const portalSessionStore = new Map<string, any>();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // The declaration-read limiter (checkDeclarationReadRateLimit /
    // recordDeclarationReadFailure in routes/cases.ts) first tries the
    // persistent DB-backed counter and only falls back to the in-memory
    // bucket when those storage calls throw. These tests assert on the
    // in-memory fallback path, so we force it by making both persistent
    // methods throw. (Before the createStorageMock migration these methods
    // were simply absent on the mock, which threw the same way; the
    // auto-stub now resolves to undefined, so we restore the throw here.)
    getAdminLoginAttemptByKey: vi.fn(async () => {
      throw new Error("test: force in-memory declaration-read rate-limit fallback");
    }),
    atomicIncrementRateLimit: vi.fn(async () => {
      throw new Error("test: force in-memory declaration-read rate-limit fallback");
    }),
    // Task #173 wraps the per-attachment row insert + audit in
    // storage.runInTransaction; this passthrough keeps the existing
    // mocked write paths working without a real DB.
    runInTransaction: vi.fn(async (fn: any) => fn({})),
    getCaseById: vi.fn(async () => beforeCase),
    updateCase: vi.fn(async (_id: string, data: any) => ({ ...(beforeCase ?? {}), ...data })),
    createDeclarationSubmission: vi.fn(async (data: any) => {
      createdSubmission = { id: 1, ...data };
      return createdSubmission;
    }),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    createDocumentRequest: vi.fn(async (data: any) => {
      const row = { id: createdDocs.length + 100, ...data };
      createdDocs.push(row);
      return row;
    }),
    getDocumentRequestsByCaseId: vi.fn(async () => createdDocs),
    getLatestDeclarationByCase: vi.fn(async () => null),
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

// Mock the db module so that portal-auth's isCaseSessionRevoked (which queries
// the cases table directly via drizzle) sees a non-revoked case. Without this
// mock the db call fails closed (returns true = revoked) and every portal-session
// auth check returns 401 even with a valid token.
vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => [
          {
            isDisabled: false,
            forceLogoutAt: null,
            accessCode: "ABCD-1234",
          },
        ],
      }),
    }),
  },
}));

const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const baseCase = {
  id: "case-1",
  accessCode: "ABCD-1234",
  userName: "Test User",
  userEmail: "user@example.com",
  status: "active",
  declarationStatus: "pending",
  declarationAccessCode: "12345678",
  declarationAccessExpiresAt: new Date(Date.now() + 60_000),
};

const TINY_PDF_DATA_URL =
  "data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKCg==";

function basePayload(extras: Record<string, unknown> = {}) {
  return {
    fullName: "Test User",
    email: "user@example.com",
    accessCode: "12345678",
    countryOfResidence: "Germany",
    dateOfBirth: "1990-01-01",
    notSanctionedJurisdictions: true,
    noSanctionedTransactions: true,
    acknowledgeUsdtNotSupported: true,
    understandFalseInfoConsequences: true,
    regulatoryAcknowledgment: true,
    internationalTermsAcknowledged: true,
    preferredAsset: "USDC (Polygon)",
    sourceOfIncome: "Salary / Employment Income",
    monthlyIncome: "7500",
    processingFeeTxHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef",
    signatureFullName: "Test User",
    signatureDate: "2026-05-08",
    ...extras,
  };
}

function actionAudits(action: string) {
  return auditLogs.filter((a) => a.action === action);
}

beforeEach(async () => {
  auditLogs.length = 0;
  createdDocs.length = 0;
  createdSubmission = null;
  beforeCase = { ...baseCase };
  // Wipe the per-IP failure counter for the declaration-read rate limiter
  // so 5 failed assertions in one block don't 429 the next test.
  const { __resetDeclarationReadRateLimitForTests } = await import(
    "../routes/cases"
  );
  __resetDeclarationReadRateLimitForTests();
});

describe("Declaration inline attachments", () => {
  const app = buildApp();

  it("happy path: persists PSOI + 2 supporting docs as document_requests + writes one audit per file", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/declaration")
      .send(basePayload({
        declarationAttachments: [
          {
            category: "proof_of_income",
            label: "Proof of Source of Income",
            fileName: "payslip.pdf",
            fileData: TINY_PDF_DATA_URL,
          },
          {
            category: "custom",
            label: "Bank Statement Q1",
            fileName: "bank.pdf",
            fileData: TINY_PDF_DATA_URL,
          },
          {
            category: "custom",
            label: "Tax Return 2024",
            fileName: "tax.pdf",
            fileData: TINY_PDF_DATA_URL,
          },
        ],
      }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.attachmentsCreated).toBe(3);

    expect(createdDocs).toHaveLength(3);
    const psoi = createdDocs.find((d) => d.documentType === "Declaration: Proof of Source of Income");
    expect(psoi).toBeTruthy();
    expect(psoi.status).toBe("submitted");
    expect(psoi.submittedFileName).toBe("payslip.pdf");
    expect(psoi.submittedFileData).toBe(TINY_PDF_DATA_URL);
    expect(psoi.submittedAt).toBeInstanceOf(Date);

    const supporting = createdDocs.filter((d) =>
      d.documentType.startsWith("Declaration: ") &&
      d.documentType !== "Declaration: Proof of Source of Income",
    );
    expect(supporting).toHaveLength(2);
    expect(supporting.map((s) => s.documentType).sort()).toEqual([
      "Declaration: Bank Statement Q1",
      "Declaration: Tax Return 2024",
    ]);

    // One audit row per attachment.
    expect(actionAudits("document_submitted")).toHaveLength(3);
  });

  it("rejects submission missing the required Proof of Source of Income with 400", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/declaration")
      .send(basePayload({ declarationAttachments: [] }));

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Proof of Source of Income/);
    // No declaration submission, no doc rows, no audits.
    expect(createdSubmission).toBeNull();
    expect(createdDocs).toHaveLength(0);
    expect(actionAudits("document_submitted")).toHaveLength(0);
  });

  it("rejects more than 3 supporting documents with 400", async () => {
    const oneOf = (label: string) => ({
      category: "custom" as const,
      label,
      fileName: `${label}.pdf`,
      fileData: TINY_PDF_DATA_URL,
    });
    const res = await request(app)
      .post("/api/cases/case-1/declaration")
      .send(basePayload({
        declarationAttachments: [
          {
            category: "proof_of_income",
            label: "PSOI",
            fileName: "psoi.pdf",
            fileData: TINY_PDF_DATA_URL,
          },
          oneOf("a"),
          oneOf("b"),
          oneOf("c"),
          oneOf("d"),
        ],
      }));

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/At most 3/);
    expect(createdSubmission).toBeNull();
    expect(createdDocs).toHaveLength(0);
  });

  it("rejects a non-PDF/image data URL with 400 and creates nothing", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/declaration")
      .send(basePayload({
        declarationAttachments: [
          {
            category: "proof_of_income",
            label: "PSOI",
            fileName: "evil.exe",
            fileData: "data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA",
          },
        ],
      }));

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Unsupported file type/);
    expect(createdSubmission).toBeNull();
    expect(createdDocs).toHaveLength(0);
    expect(actionAudits("document_submitted")).toHaveLength(0);
  });

  it("rejects oversize attachment (>10 MB) with 400", async () => {
    // ~11 MB of base64 — sufficiently over the 10 MB decoded cap.
    const oversize =
      "data:application/pdf;base64," + "A".repeat(11 * 1024 * 1024 * 4 / 3);
    const res = await request(app)
      .post("/api/cases/case-1/declaration")
      .send(basePayload({
        declarationAttachments: [
          {
            category: "proof_of_income",
            label: "PSOI",
            fileName: "huge.pdf",
            fileData: oversize,
          },
        ],
      }));

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Maximum is 10 MB/);
    expect(createdDocs).toHaveLength(0);
  });

  it("rejects a custom supporting doc whose label collides with the PSOI documentType", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/declaration")
      .send(basePayload({
        declarationAttachments: [
          {
            category: "proof_of_income",
            label: "Proof of Source of Income",
            fileName: "psoi.pdf",
            fileData: TINY_PDF_DATA_URL,
          },
          {
            category: "custom",
            label: "Proof of Source of Income",
            fileName: "dupe.pdf",
            fileData: TINY_PDF_DATA_URL,
          },
        ],
      }));

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/conflicts with the Proof of Source of Income/);
    expect(createdSubmission).toBeNull();
    expect(createdDocs).toHaveLength(0);
  });

  it("surfaces partial-failure when an attachment insert throws (declaration still recorded)", async () => {
    const { storage } = await import("../storage");
    // Fail on the second attachment (a supporting doc) only.
    let calls = 0;
    (storage.createDocumentRequest as any).mockImplementationOnce(async (data: any) => {
      calls += 1;
      const row = { id: 999, ...data };
      createdDocs.push(row);
      return row;
    });
    (storage.createDocumentRequest as any).mockImplementationOnce(async () => {
      throw new Error("simulated DB write failure");
    });

    const res = await request(app)
      .post("/api/cases/case-1/declaration")
      .send(basePayload({
        declarationAttachments: [
          {
            category: "proof_of_income",
            label: "PSOI",
            fileName: "psoi.pdf",
            fileData: TINY_PDF_DATA_URL,
          },
          {
            category: "custom",
            label: "Bank Statement",
            fileName: "bank.pdf",
            fileData: TINY_PDF_DATA_URL,
          },
        ],
      }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.attachmentsCreated).toBe(1);
    expect(res.body.attachmentFailures).toHaveLength(1);
    expect(res.body.attachmentFailures[0].fileName).toBe("bank.pdf");
    expect(res.body.attachmentFailures[0].error).toMatch(/simulated DB write failure/);
    expect(actionAudits("document_submitted")).toHaveLength(1);
    expect(actionAudits("document_submission_failed")).toHaveLength(1);
  });

  it("GET /declaration returns attachments summary tagged by category", async () => {
    // Pre-seed the doc list as if a previous submit had stored two rows.
    createdDocs.push(
      {
        id: 100,
        caseId: "case-1",
        documentType: "Declaration: Proof of Source of Income",
        status: "submitted",
        submittedFileName: "payslip.pdf",
        submittedAt: new Date(),
      },
      {
        id: 101,
        caseId: "case-1",
        documentType: "Declaration: Bank Statement Q1",
        status: "approved",
        submittedFileName: "bank.pdf",
        submittedAt: new Date(),
      },
      // Unrelated row from the regular admin doc-request flow — must NOT
      // appear in the declaration attachments list.
      {
        id: 102,
        caseId: "case-1",
        documentType: "KYC ID",
        status: "submitted",
        submittedFileName: "id.pdf",
        submittedAt: new Date(),
      },
    );
    beforeCase = { ...baseCase, declarationStatus: "submitted" };

    // Authorized via the per-case declarationAccessCode header — covers
    // the email-link flow before the user has a portal session.
    const res = await request(app)
      .get("/api/cases/case-1/declaration")
      .set("x-declaration-access-code", "12345678");

    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(2);
    const categories = res.body.attachments.map((a: any) => a.category).sort();
    expect(categories).toEqual(["custom", "proof_of_income"]);
    const psoi = res.body.attachments.find((a: any) => a.category === "proof_of_income");
    expect(psoi.documentType).toBe("Declaration: Proof of Source of Income");
    expect(psoi.submittedFileName).toBe("payslip.pdf");
  });

  describe("GET /declaration access control", () => {
    beforeEach(() => {
      beforeCase = { ...baseCase, declarationStatus: "submitted" };
    });

    it("rejects an unauthenticated request with 401 (no creds at all)", async () => {
      const res = await request(app).get("/api/cases/case-1/declaration");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("rejects a request with the wrong declarationAccessCode with 401", async () => {
      const res = await request(app)
        .get("/api/cases/case-1/declaration")
        .set("x-declaration-access-code", "99999999");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("rejects an unknown case with 401 (does not leak existence)", async () => {
      beforeCase = null;
      const res = await request(app)
        .get("/api/cases/does-not-exist/declaration")
        .set("x-declaration-access-code", "12345678");
      expect(res.status).toBe(401);
      // Same shape as the other rejected paths — no "Case not found" leak.
      expect(res.body.error).toBe("Unauthorized");
    });

    it("rejects a portal session whose caseId does not match the URL :id with 401", async () => {
      const { createSession } = await import("../services/session-store");
      // Session for a different case — must not unlock case-1.
      const otherToken = await createSession("other-case-id", "OTHER-9999");
      const res = await request(app)
        .get("/api/cases/case-1/declaration")
        .set("x-portal-session-token", otherToken);
      expect(res.status).toBe(401);
    });

    it("allows a valid portal session whose caseId matches the URL :id with 200", async () => {
      const { createSession } = await import("../services/session-store");
      const token = await createSession("case-1", "ABCD-1234");
      const res = await request(app)
        .get("/api/cases/case-1/declaration")
        .set("x-portal-session-token", token);
      expect(res.status).toBe(200);
      expect(res.body.declarationStatus).toBe("submitted");
    });

    it("allows the declarationAccessCode via ?accessCode= query string with 200", async () => {
      const res = await request(app).get(
        "/api/cases/case-1/declaration?accessCode=12345678",
      );
      expect(res.status).toBe(200);
      expect(res.body.declarationStatus).toBe("submitted");
    });

    it("rejects an expired declarationAccessCode with 401", async () => {
      beforeCase = {
        ...baseCase,
        declarationStatus: "submitted",
        declarationAccessExpiresAt: new Date(Date.now() - 60_000),
      };
      const res = await request(app)
        .get("/api/cases/case-1/declaration")
        .set("x-declaration-access-code", "12345678");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("still allows a session-authenticated request after the code has expired", async () => {
      beforeCase = {
        ...baseCase,
        declarationStatus: "submitted",
        declarationAccessExpiresAt: new Date(Date.now() - 60_000),
      };
      const { createSession } = await import("../services/session-store");
      const token = await createSession("case-1", "ABCD-1234");
      const res = await request(app)
        .get("/api/cases/case-1/declaration")
        .set("x-portal-session-token", token);
      expect(res.status).toBe(200);
      expect(res.body.declarationStatus).toBe("submitted");
    });
  });

  describe("GET /declaration audit logging + rate limiting", () => {
    beforeEach(async () => {
      beforeCase = { ...baseCase, declarationStatus: "submitted" };
      // Wipe the in-process IP bucket so failure counters don't bleed
      // across tests (5 failures in any single test would otherwise lock
      // out '::ffff:127.0.0.1' for every subsequent assertion).
      const { __resetDeclarationReadRateLimitForTests } = await import(
        "../routes/cases"
      );
      __resetDeclarationReadRateLimitForTests();
    });

    it("writes a declaration_read_unauthorized audit row on a no-creds 401", async () => {
      const res = await request(app).get("/api/cases/case-1/declaration");
      expect(res.status).toBe(401);
      const audits = actionAudits("declaration_read_unauthorized");
      expect(audits).toHaveLength(1);
      expect(audits[0].targetType).toBe("case");
      expect(audits[0].targetId).toBe("case-1");
      expect(typeof audits[0].ipAddress).toBe("string");
      expect(JSON.parse(audits[0].newValue)).toEqual({ credentialType: "none" });
    });

    it("classifies a wrong access code as credentialType=wrong_code", async () => {
      await request(app)
        .get("/api/cases/case-1/declaration")
        .set("x-declaration-access-code", "99999999");
      const audits = actionAudits("declaration_read_unauthorized");
      expect(audits).toHaveLength(1);
      expect(JSON.parse(audits[0].newValue).credentialType).toBe("wrong_code");
    });

    it("classifies a wrong portal session as credentialType=wrong_session", async () => {
      const { createSession } = await import("../services/session-store");
      const otherToken = await createSession("other-case-id", "OTHER-9999");
      await request(app)
        .get("/api/cases/case-1/declaration")
        .set("x-portal-session-token", otherToken);
      const audits = actionAudits("declaration_read_unauthorized");
      expect(audits).toHaveLength(1);
      expect(JSON.parse(audits[0].newValue).credentialType).toBe("wrong_session");
    });

    it("classifies a matching-but-expired code as credentialType=expired_code", async () => {
      beforeCase = {
        ...baseCase,
        declarationStatus: "submitted",
        declarationAccessExpiresAt: new Date(Date.now() - 60_000),
      };
      await request(app)
        .get("/api/cases/case-1/declaration")
        .set("x-declaration-access-code", "12345678");
      const audits = actionAudits("declaration_read_unauthorized");
      expect(audits).toHaveLength(1);
      expect(JSON.parse(audits[0].newValue).credentialType).toBe("expired_code");
    });

    it("classifies an unknown case as credentialType=case_missing (no existence leak)", async () => {
      beforeCase = null;
      const res = await request(app)
        .get("/api/cases/nope/declaration")
        .set("x-declaration-access-code", "12345678");
      expect(res.status).toBe(401);
      const audits = actionAudits("declaration_read_unauthorized");
      expect(audits).toHaveLength(1);
      expect(audits[0].targetId).toBe("nope");
      expect(JSON.parse(audits[0].newValue).credentialType).toBe("case_missing");
    });

    it("does NOT write an unauthorized audit row on a successful read", async () => {
      const res = await request(app)
        .get("/api/cases/case-1/declaration")
        .set("x-declaration-access-code", "12345678");
      expect(res.status).toBe(200);
      expect(actionAudits("declaration_read_unauthorized")).toHaveLength(0);
    });

    it("returns 429 once the per-IP failure threshold is exceeded", async () => {
      // Five failures under the 10-minute window puts the IP into lockout
      // mode; the sixth attempt — even with a valid code — must come back
      // as 429 with a Retry-After header.
      for (let i = 0; i < 5; i++) {
        const res = await request(app).get("/api/cases/case-1/declaration");
        expect(res.status).toBe(401);
      }
      const sixth = await request(app)
        .get("/api/cases/case-1/declaration")
        .set("x-declaration-access-code", "12345678");
      expect(sixth.status).toBe(429);
      expect(sixth.headers["retry-after"]).toBeDefined();
      expect(sixth.body.error).toMatch(/too many/i);
      // The throttled attempt also shows up in the audit feed under its
      // own action so the admin dashboard can spot sustained scans.
      const throttleAudits = actionAudits("declaration_read_rate_limited");
      expect(throttleAudits.length).toBeGreaterThanOrEqual(1);
      expect(throttleAudits[0].targetId).toBe("case-1");
    });
  });
});
