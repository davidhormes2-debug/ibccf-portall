import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// checkAdminAuth validates session.adminUsername === ADMIN_USERNAME.
// Set a known value so PATCH-suite tests can authenticate.
process.env.ADMIN_USERNAME = "test-admin";
delete process.env.ADMIN_ALERT_EMAIL;

// ─── Shared test state ────────────────────────────────────────────────────────

const auditLogs: any[] = [];

// POST suite (Task #220 upload alert)
let createdDoc: any = null;
let adminAlertRecipients: string[] = ["ops@example.com"];
const sendAlertCalls: any[] = [];
let sendAlertResult: { success: boolean; error?: string } = { success: true };
let sendAlertShouldThrow: Error | null = null;

// Throttle suite (Task #274) — in-memory app_settings store
const appSettingsStore = new Map<string, { value: string; updatedBy: string | null; updatedAt: Date }>();

// PATCH suite (Task #217 status transitions)
let currentDoc: any = null;
let lastUpdate: any = null;

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    caseId: "case-1",
    fileName: "kyc.pdf",
    fileType: "pdf",
    fileData: null,
    fileSize: "12345",
    category: "general",
    description: "KYC document",
    status: "uploaded",
    adminNotes: null,
    uploadedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// GET suite (Task #277 cross-case list)
let allDocsStore: any[] = [];

// pending-counts suite (Task #273)
let pendingCountsStore: Record<string, number> = {};

// ─── Storage mock ──────────────────────────────────────────────────────────────
// Contains all methods used by either suite. getAdminSessionByToken is
// configured per-suite in beforeEach (null for portal POST, valid session for admin PATCH).

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // POST portal upload route — cases.ts handler (Task #378)
    getCaseById: vi.fn(async (id: string) => ({ id, userEmail: "u@x.com" })),
    createUserDocument: vi.fn(async (data: any) => {
      createdDoc = {
        id: 77,
        uploadedAt: new Date("2026-01-01T00:00:00Z"),
        ...data,
      };
      return createdDoc;
    }),
    getUserDocumentsByCaseId: vi.fn(async () => []),
    // Legacy createDocumentRequest kept for any other call sites; the
    // portal POST no longer touches it after Task #378.
    createDocumentRequest: vi.fn(async (data: any) => ({ id: 77, ...data })),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    getAppSetting: vi.fn(async (key: string) => {
      if (key === "admin_alert_email") {
        return adminAlertRecipients.length > 0
          ? { key, value: adminAlertRecipients.join(","), updatedBy: null, updatedAt: new Date() }
          : undefined;
      }
      // Throttle keys (Task #274) — backed by appSettingsStore
      const stored = appSettingsStore.get(key);
      if (stored) return { key, ...stored };
      return undefined;
    }),
    setAppSetting: vi.fn(async (key: string, value: string, updatedBy?: string | null) => {
      const row = { value, updatedBy: updatedBy ?? null, updatedAt: new Date() };
      appSettingsStore.set(key, row);
      return { key, ...row };
    }),
    // PATCH admin status route
    getUserDocumentById: vi.fn(async (_id: number) => currentDoc),
    updateUserDocument: vi.fn(async (id: number, data: any, _tx?: unknown) => {
      lastUpdate = { id, ...data };
      currentDoc = { ...currentDoc, ...data };
      return currentDoc;
    }),
    // GET all user documents (Task #277)
    // Mirrors the real implementation: strips fileData blob before returning.
    getAllUserDocuments: vi.fn(async (filters?: { status?: string; caseId?: string }) => {
      let rows = allDocsStore;
      if (filters?.caseId) rows = rows.filter((d: any) => d.caseId === filters.caseId);
      if (filters?.status) rows = rows.filter((d: any) => d.status === filters.status);
      return rows.map(({ fileData: _stripped, ...rest }: any) => rest);
    }),
    // GET pending counts (Task #273)
    getPendingUserDocumentCounts: vi.fn(async () => pendingCountsStore),
    // Shared
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    getAdminSessionByToken: vi.fn(),   // configured per-suite in beforeEach
    updateAdminSessionActivity: vi.fn(async () => {}),
  }),
}));

// ─── portal-auth mock — bypass for POST tests ─────────────────────────────────

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: async () => true,
}));

// ─── nda-integrity-sweep mock ─────────────────────────────────────────────────

vi.mock("../nda-integrity-sweep", () => ({
  ADMIN_ALERT_EMAIL_SETTING_KEY: "admin_alert_email",
  parseAdminAlertRecipients: (raw: string | null | undefined) => {
    if (!raw) return [];
    return adminAlertRecipients;
  },
}));

// ─── NotificationService mock ─────────────────────────────────────────────────

vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyAdmin: vi.fn(async () => ({ id: 1, type: "user_document_uploaded" })),
  },
}));

// ─── EmailService mock ────────────────────────────────────────────────────────

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendUserDocumentUploadedAlert: vi.fn(async (opts: any) => {
      sendAlertCalls.push(opts);
      if (sendAlertShouldThrow) throw sendAlertShouldThrow;
      return sendAlertResult;
    }),
  }),
}));

// ─── App factories ────────────────────────────────────────────────────────────

const { userDocumentsAdminRouter } = await import("../routes/content");

const { casesRouter } = await import("../routes/cases");

const {
  maybeAlertOnDocumentUpload,
  docUploadAlertLastSentKey,
  DOC_UPLOAD_ALERT_COOLDOWN_DEFAULT_MINUTES,
  docUploadAlertMuteKey,
} = await import("../services/documentUploadAlert");

function buildPortalApp() {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

function buildAdminApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/user-documents", userDocumentsAdminRouter);
  return app;
}

function buildCanonicalAdminApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/admin/user-documents", userDocumentsAdminRouter);
  return app;
}

const portalApp = buildPortalApp();
const adminApp = buildAdminApp();
const canonicalAdminApp = buildCanonicalAdminApp();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TINY_PDF = "data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKCg==";
const TINY_PNG = "data:image/png;base64," + "A".repeat(80);
const ADMIN_AUTH = { Authorization: "Bearer test-admin-token" };
const VALID_ADMIN_SESSION = {
  id: "session-1",
  isActive: true,
  revokedAt: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  adminUsername: "test-admin",
};

// ─── Audit helpers ────────────────────────────────────────────────────────────

function alertAudits() {
  return auditLogs.filter((a) => a.action === "email_user_document_uploaded_alert");
}
function submitAudits() {
  return auditLogs.filter((a) => a.action === "user_document_uploaded");
}

async function waitForAlertAudit(timeoutMs = 5000) {
  const start = Date.now();
  while (alertAudits().length === 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — POST /api/cases/:id/user-documents  (Task #220 admin alert)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/cases/:id/user-documents (Task #220 admin alert)", () => {
  beforeEach(async () => {
    auditLogs.length = 0;
    sendAlertCalls.length = 0;
    createdDoc = null;
    adminAlertRecipients = ["ops@example.com"];
    sendAlertResult = { success: true };
    sendAlertShouldThrow = null;
    appSettingsStore.clear();
    delete process.env.ADMIN_ALERT_EMAIL;
    // Portal uploads use portal auth (mocked out), not admin auth.
    vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValue(null as any);
  });

  it("happy path: creates document, returns immediately, triggers alert, writes audit row", async () => {
    const res = await request(portalApp)
      .post("/api/cases/case-1/user-documents")
      .send({
        fileData: TINY_PDF,
        fileName: "payslip.pdf",
        category: "transaction",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(77);
    expect(res.body.category).toBe("transaction");

    await waitForAlertAudit();

    expect(sendAlertCalls).toHaveLength(1);
    expect(sendAlertCalls[0].to).toEqual(["ops@example.com"]);
    expect(sendAlertCalls[0].caseId).toBe("case-1");
    expect(sendAlertCalls[0].documentType).toBe("transaction");
    expect(sendAlertCalls[0].fileName).toBe("payslip.pdf");

    expect(submitAudits()).toHaveLength(1);
    expect(submitAudits()[0].targetId).toBe("case-1");
    expect(submitAudits()[0].adminUsername).toBe("portal-user");

    expect(alertAudits()).toHaveLength(1);
    const alertRow = alertAudits()[0];
    expect(alertRow.action).toBe("email_user_document_uploaded_alert");
    expect(alertRow.targetType).toBe("case");
    expect(alertRow.targetId).toBe("case-1");
    expect(alertRow.newValue).toContain("ops@example.com");
    expect(alertRow.newValue).toContain("transaction");
  });

  it("sends alert to every configured recipient", async () => {
    adminAlertRecipients = ["ops@example.com", "compliance@example.com"];

    const res = await request(portalApp)
      .post("/api/cases/case-2/user-documents")
      .send({
        fileData: TINY_PNG,
        fileName: "id-front.png",
        category: "id_proof",
      });

    expect(res.status).toBe(201);
    await waitForAlertAudit();

    expect(sendAlertCalls).toHaveLength(1);
    expect(sendAlertCalls[0].to).toEqual([
      "ops@example.com",
      "compliance@example.com",
    ]);
    expect(alertAudits()[0].newValue).toContain("ops@example.com");
    expect(alertAudits()[0].newValue).toContain("compliance@example.com");
  });

  it("fires no alert and throws no error when ADMIN_ALERT_EMAIL is unset and no DB setting exists", async () => {
    adminAlertRecipients = [];

    const res = await request(portalApp)
      .post("/api/cases/case-3/user-documents")
      .send({
        fileData: TINY_PDF,
        fileName: "bank-statement.pdf",
        category: "evidence",
      });

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 100));

    expect(sendAlertCalls).toHaveLength(0);
    expect(alertAudits()).toHaveLength(0);
    expect(submitAudits()).toHaveLength(1);
  });

  it("uses ADMIN_ALERT_EMAIL env var when set (env takes priority over DB setting)", async () => {
    process.env.ADMIN_ALERT_EMAIL = "envrecipient@example.com";
    adminAlertRecipients = ["envrecipient@example.com"];

    const res = await request(portalApp)
      .post("/api/cases/case-4/user-documents")
      .send({
        fileData: TINY_PDF,
        fileName: "source.pdf",
        category: "evidence",
      });

    expect(res.status).toBe(201);
    await waitForAlertAudit();

    expect(sendAlertCalls).toHaveLength(1);
    expect(sendAlertCalls[0].to).toEqual(["envrecipient@example.com"]);
    expect(alertAudits()).toHaveLength(1);
  });

  it("does NOT delay res.json when the alert dispatch is slow", async () => {
    let resolveAlert!: () => void;
    const slow = new Promise<{ success: boolean }>((resolve) => {
      resolveAlert = () => resolve({ success: true });
    });
    const { emailService } = await import("../services/EmailService");
    (emailService.sendUserDocumentUploadedAlert as any).mockImplementationOnce(
      async (opts: any) => {
        sendAlertCalls.push(opts);
        return slow;
      },
    );

    const start = Date.now();
    const res = await request(portalApp)
      .post("/api/cases/case-5/user-documents")
      .send({
        fileData: TINY_PDF,
        fileName: "slow.pdf",
        category: "general",
      });
    const elapsed = Date.now() - start;

    expect(res.status).toBe(201);
    expect(elapsed).toBeLessThan(500);

    resolveAlert();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("does not throw and still returns 201 when the alert email itself fails", async () => {
    sendAlertShouldThrow = new Error("SMTP unavailable");

    const res = await request(portalApp)
      .post("/api/cases/case-6/user-documents")
      .send({
        fileData: TINY_PDF,
        fileName: "contract.pdf",
        category: "general",
      });

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 100));

    expect(alertAudits()).toHaveLength(0);
    expect(submitAudits()).toHaveLength(1);
  });

  it("rejects an invalid (non-data-URL) file payload with 400, no alert fires", async () => {
    const res = await request(portalApp)
      .post("/api/cases/case-7/user-documents")
      .send({
        fileData: "not-a-data-url",
        fileName: "bad.pdf",
        category: "evidence",
      });

    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 50));
    expect(sendAlertCalls).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
  });

  it("rejects an unsupported MIME type with 400, no alert fires", async () => {
    const res = await request(portalApp)
      .post("/api/cases/case-8/user-documents")
      .send({
        fileData: "data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA",
        fileName: "evil.exe",
        category: "evidence",
      });

    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 50));
    expect(sendAlertCalls).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
  });

  it("rejects a missing fileName with 400", async () => {
    const res = await request(portalApp)
      .post("/api/cases/case-9/user-documents")
      .send({
        fileData: TINY_PDF,
      });

    expect(res.status).toBe(400);
    expect(sendAlertCalls).toHaveLength(0);
  });

  it("defaults to category='general' when no category is supplied (legacy payload shape)", async () => {
    const res = await request(portalApp)
      .post("/api/cases/case-10/user-documents")
      .send({
        fileData: TINY_PDF,
        fileName: "legacy.pdf",
      });

    expect(res.status).toBe(201);
    expect(res.body.category).toBe("general");
    await waitForAlertAudit();
    expect(sendAlertCalls[0].documentType).toBe("general");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — PATCH /api/user-documents/:id  (Task #217 admin status transitions)
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/user-documents/:id — admin status transitions", () => {
  beforeEach(async () => {
    auditLogs.length = 0;
    lastUpdate = null;
    currentDoc = makeDoc();
    // PATCH route requires a valid admin bearer token.
    vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValue(
      VALID_ADMIN_SESSION as any,
    );
  });

  describe("authentication", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .send({ status: "reviewed" });

      expect(res.status).toBe(401);
      expect(lastUpdate).toBeNull();
    });
  });

  describe("status transitions — every valid value is accepted", () => {
    const VALID_STATUSES = ["uploaded", "reviewed", "approved", "rejected"] as const;

    for (const status of VALID_STATUSES) {
      it(`accepts status='${status}' and reflects it back`, async () => {
        const res = await request(adminApp)
          .patch("/api/user-documents/10")
          .set(ADMIN_AUTH)
          .send({ status });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(status);
        expect(lastUpdate?.status).toBe(status);
      });
    }
  });

  describe("transition matrix — from every starting state", () => {
    it("uploaded → reviewed", async () => {
      currentDoc = makeDoc({ status: "uploaded" });

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: "reviewed" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("reviewed");
    });

    it("reviewed → approved", async () => {
      currentDoc = makeDoc({ status: "reviewed" });

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: "approved" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("approved");
    });

    it("reviewed → rejected", async () => {
      currentDoc = makeDoc({ status: "reviewed" });

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: "rejected" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("rejected");
    });

    it("approved → reviewed (admin can walk back a decision)", async () => {
      currentDoc = makeDoc({ status: "approved" });

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: "reviewed" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("reviewed");
    });

    it("rejected → reviewed (admin can reconsider a rejection)", async () => {
      currentDoc = makeDoc({ status: "rejected" });

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: "reviewed" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("reviewed");
    });

    it("rejected → uploaded (admin can reset back to initial state)", async () => {
      currentDoc = makeDoc({ status: "rejected" });

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: "uploaded" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("uploaded");
    });

    it("approved → rejected (admin can reverse an approval)", async () => {
      currentDoc = makeDoc({ status: "approved" });

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: "rejected", adminNotes: "Expired document" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("rejected");
      expect(lastUpdate?.adminNotes).toBe("Expired document");
    });
  });

  describe("adminNotes field", () => {
    it("persists adminNotes independently of status", async () => {
      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ adminNotes: "Awaiting second page" });

      expect(res.status).toBe(200);
      expect(lastUpdate?.adminNotes).toBe("Awaiting second page");
      // status was not sent, so the update payload should not include it
      expect(lastUpdate?.status).toBeUndefined();
    });

    it("persists adminNotes alongside a status change", async () => {
      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: "approved", adminNotes: "All good" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("approved");
      expect(lastUpdate?.adminNotes).toBe("All good");
    });
  });

  describe("edge cases", () => {
    it("empty body (no fields) succeeds and leaves the document unchanged", async () => {
      currentDoc = makeDoc({ status: "reviewed", adminNotes: "Already noted" });

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({});

      expect(res.status).toBe(200);
      // Route returns existing doc without calling updateUserDocument
      expect(lastUpdate).toBeNull();
      expect(res.body.status).toBe("reviewed");
      expect(res.body.adminNotes).toBe("Already noted");
    });

    it("returns 404 when the document does not exist", async () => {
      currentDoc = null;

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: "approved" });

      expect(res.status).toBe(404);
      expect(lastUpdate).toBeNull();
    });

    it("rejects an unknown status value with 400", async () => {
      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: "pending_review" });

      expect(res.status).toBe(400);
      expect(lastUpdate).toBeNull();
    });

    it("rejects a numeric status value with 400", async () => {
      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: 1 });

      expect(res.status).toBe(400);
      expect(lastUpdate).toBeNull();
    });

    it("same-status re-patch is accepted and stored (no transition guard in the route)", async () => {
      currentDoc = makeDoc({ status: "approved" });

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status: "approved" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("approved");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — GET /api/user-documents  (Task #277 cross-case list)
// ─────────────────────────────────────────────────────────────────────────────

const DOC_A = makeDoc({ id: 1, caseId: "case-a", status: "uploaded", fileName: "a.pdf" });
const DOC_B = makeDoc({ id: 2, caseId: "case-b", status: "approved", fileName: "b.pdf" });
const DOC_C = makeDoc({ id: 3, caseId: "case-a", status: "rejected", fileName: "c.pdf" });

describe("GET /api/user-documents — cross-case list (Task #277)", () => {
  beforeEach(async () => {
    allDocsStore = [DOC_A, DOC_B, DOC_C];
    vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValue(
      VALID_ADMIN_SESSION as any,
    );
  });

  describe("authentication", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(adminApp).get("/api/user-documents");
      expect(res.status).toBe(401);
    });

    it("allows requests with a valid admin bearer token", async () => {
      const res = await request(adminApp)
        .get("/api/user-documents")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
    });
  });

  describe("unfiltered list", () => {
    it("returns all documents when no filters are supplied", async () => {
      const res = await request(adminApp)
        .get("/api/user-documents")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });

    it("strips the fileData blob — fileData must not appear in any row", async () => {
      allDocsStore = [makeDoc({ id: 99, fileData: "data:application/pdf;base64,SECRET" })];
      const res = await request(adminApp)
        .get("/api/user-documents")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body[0]).not.toHaveProperty("fileData");
    });

    it("includes expected metadata fields on each row", async () => {
      allDocsStore = [DOC_A];
      const res = await request(adminApp)
        .get("/api/user-documents")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      const row = res.body[0];
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("caseId");
      expect(row).toHaveProperty("fileName");
      expect(row).toHaveProperty("fileType");
      expect(row).toHaveProperty("fileSize");
      expect(row).toHaveProperty("category");
      expect(row).toHaveProperty("status");
      expect(row).toHaveProperty("uploadedAt");
    });
  });

  describe("?status filter", () => {
    it("filters to only documents with the given status", async () => {
      const res = await request(adminApp)
        .get("/api/user-documents?status=approved")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].fileName).toBe("b.pdf");
    });

    it("returns an empty array when no documents match the status filter", async () => {
      const res = await request(adminApp)
        .get("/api/user-documents?status=reviewed")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it("rejects an unrecognised status value with 400", async () => {
      const res = await request(adminApp)
        .get("/api/user-documents?status=pending_review")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(400);
    });
  });

  describe("?caseId filter", () => {
    it("filters to only documents belonging to the given case", async () => {
      const res = await request(adminApp)
        .get("/api/user-documents?caseId=case-a")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((d: any) => d.fileName).sort()).toEqual(["a.pdf", "c.pdf"]);
    });

    it("returns an empty array when no documents match the caseId filter", async () => {
      const res = await request(adminApp)
        .get("/api/user-documents?caseId=unknown-case")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });

  describe("combined ?status + ?caseId filters", () => {
    it("applies both filters together", async () => {
      const res = await request(adminApp)
        .get("/api/user-documents?caseId=case-a&status=rejected")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].fileName).toBe("c.pdf");
    });

    it("returns empty array when the combined filter has no matches", async () => {
      const res = await request(adminApp)
        .get("/api/user-documents?caseId=case-b&status=uploaded")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — maybeAlertOnDocumentUpload throttle  (Task #274)
// ─────────────────────────────────────────────────────────────────────────────

describe("maybeAlertOnDocumentUpload — per-case cooldown throttle (Task #274)", () => {
  const CASE_ID = "throttle-case-1";
  const PARAMS = {
    caseId: CASE_ID,
    docId: 42,
    documentType: "Proof of Income",
    fileName: "payslip.pdf",
  };

  beforeEach(async () => {
    auditLogs.length = 0;
    sendAlertCalls.length = 0;
    appSettingsStore.clear();
    adminAlertRecipients = ["ops@example.com"];
    sendAlertResult = { success: true };
    sendAlertShouldThrow = null;
    delete process.env.ADMIN_ALERT_EMAIL;
    vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValue(null as any);
  });

  it("sends an alert on the first upload when no throttle state exists", async () => {
    await maybeAlertOnDocumentUpload(PARAMS);

    expect(sendAlertCalls).toHaveLength(1);
    expect(sendAlertCalls[0].caseId).toBe(CASE_ID);
    expect(sendAlertCalls[0].documentType).toBe("Proof of Income");
    expect(auditLogs.some((a) => a.action === "email_user_document_uploaded_alert")).toBe(true);
  });

  it("stamps a per-case last-sent-at key in app_settings after sending", async () => {
    await maybeAlertOnDocumentUpload(PARAMS);

    const key = docUploadAlertLastSentKey(CASE_ID);
    const stored = appSettingsStore.get(key);
    expect(stored).toBeDefined();
    const ts = new Date(stored!.value);
    expect(Number.isNaN(ts.getTime())).toBe(false);
    expect(Date.now() - ts.getTime()).toBeLessThan(5000);
  });

  it("suppresses the second alert when called again within the cooldown window", async () => {
    // Simulate a recent send (1 second ago) — well inside the default 30-min window.
    const recentTimestamp = new Date(Date.now() - 1_000).toISOString();
    appSettingsStore.set(docUploadAlertLastSentKey(CASE_ID), {
      value: recentTimestamp,
      updatedBy: "system",
      updatedAt: new Date(),
    });

    await maybeAlertOnDocumentUpload(PARAMS);

    expect(sendAlertCalls).toHaveLength(0);
    expect(auditLogs.filter((a) => a.action === "email_user_document_uploaded_alert")).toHaveLength(0);
  });

  it("fires again after the cooldown window has expired", async () => {
    // Simulate a send that happened (cooldown + 1 minute) ago — outside the window.
    const expiredTimestamp = new Date(
      Date.now() - (DOC_UPLOAD_ALERT_COOLDOWN_DEFAULT_MINUTES + 1) * 60 * 1000,
    ).toISOString();
    appSettingsStore.set(docUploadAlertLastSentKey(CASE_ID), {
      value: expiredTimestamp,
      updatedBy: "system",
      updatedAt: new Date(),
    });

    await maybeAlertOnDocumentUpload(PARAMS);

    expect(sendAlertCalls).toHaveLength(1);
    expect(sendAlertCalls[0].caseId).toBe(CASE_ID);
    expect(auditLogs.filter((a) => a.action === "email_user_document_uploaded_alert")).toHaveLength(1);
  });

  it("throttle is per-case: suppressed case does not block alert for a different case", async () => {
    // Suppress CASE_ID (recent send)
    appSettingsStore.set(docUploadAlertLastSentKey(CASE_ID), {
      value: new Date(Date.now() - 1_000).toISOString(),
      updatedBy: "system",
      updatedAt: new Date(),
    });

    const otherCase = "throttle-case-2";
    await maybeAlertOnDocumentUpload({ ...PARAMS, caseId: otherCase });

    expect(sendAlertCalls).toHaveLength(1);
    expect(sendAlertCalls[0].caseId).toBe(otherCase);
  });

  it("respects a custom cooldown stored in app_settings", async () => {
    // Set a very short custom cooldown of 1 minute.
    appSettingsStore.set("doc_upload_alert_cooldown_minutes", {
      value: "1",
      updatedBy: "admin",
      updatedAt: new Date(),
    });
    // Simulate a send that happened 90 seconds ago — inside 1-min window.
    appSettingsStore.set(docUploadAlertLastSentKey(CASE_ID), {
      value: new Date(Date.now() - 90_000).toISOString(),
      updatedBy: "system",
      updatedAt: new Date(),
    });

    await maybeAlertOnDocumentUpload(PARAMS);

    // 90s > 1min cooldown, so alert fires again.
    expect(sendAlertCalls).toHaveLength(1);
  });

  it("does not send when no recipients are configured", async () => {
    adminAlertRecipients = [];

    await maybeAlertOnDocumentUpload(PARAMS);

    expect(sendAlertCalls).toHaveLength(0);
    expect(auditLogs.filter((a) => a.action === "email_user_document_uploaded_alert")).toHaveLength(0);
  });

  it("never throws when the email send fails", async () => {
    sendAlertShouldThrow = new Error("SMTP error");

    await expect(maybeAlertOnDocumentUpload(PARAMS)).resolves.toBeUndefined();
    expect(sendAlertCalls).toHaveLength(1);
  });

  it("writes an email_user_document_uploaded_alert_failed audit row when the SMTP send throws (Task #325)", async () => {
    sendAlertShouldThrow = new Error("SMTP boom");

    await maybeAlertOnDocumentUpload(PARAMS);

    const failed = auditLogs.filter(
      (a) => a.action === "email_user_document_uploaded_alert_failed",
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].targetType).toBe("case");
    expect(failed[0].targetId).toBe(CASE_ID);
    expect(failed[0].newValue).toContain("SMTP boom");
    expect(failed[0].newValue).toContain("ops@example.com");
    // The success-tagged audit row must NOT be written on failure.
    expect(
      auditLogs.filter((a) => a.action === "email_user_document_uploaded_alert"),
    ).toHaveLength(0);
  });

  it("writes the _failed audit row when the SMTP send returns { success: false } without throwing (Task #325)", async () => {
    // emailService.send() catches transport errors and returns
    // { success: false, error } rather than throwing — this is the
    // typical production failure mode.
    sendAlertResult = { success: false, error: "EAUTH bad credentials" };

    await maybeAlertOnDocumentUpload(PARAMS);

    const failed = auditLogs.filter(
      (a) => a.action === "email_user_document_uploaded_alert_failed",
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].newValue).toContain("EAUTH bad credentials");
    expect(failed[0].newValue).toContain("ops@example.com");
    expect(
      auditLogs.filter((a) => a.action === "email_user_document_uploaded_alert"),
    ).toHaveLength(0);
  });

  it("skips alert silently when the case is muted (Task #379)", async () => {
    appSettingsStore.set(docUploadAlertMuteKey(CASE_ID), {
      value: "true",
      updatedBy: "admin",
      updatedAt: new Date(),
    });

    await maybeAlertOnDocumentUpload(PARAMS);

    expect(sendAlertCalls).toHaveLength(0);
    expect(
      auditLogs.filter((a) => a.action === "email_user_document_uploaded_alert"),
    ).toHaveLength(0);
    expect(
      auditLogs.filter((a) => a.action === "email_user_document_uploaded_alert_failed"),
    ).toHaveLength(0);
    // Throttle key must NOT be stamped — muting must not interfere with the
    // cooldown bookkeeping for when the admin unmutes later.
    expect(appSettingsStore.get(docUploadAlertLastSentKey(CASE_ID))).toBeUndefined();
  });

  it("mute is per-case: another case still alerts normally (Task #379)", async () => {
    appSettingsStore.set(docUploadAlertMuteKey(CASE_ID), {
      value: "true",
      updatedBy: "admin",
      updatedAt: new Date(),
    });

    await maybeAlertOnDocumentUpload({ ...PARAMS, caseId: "other-case-379" });

    expect(sendAlertCalls).toHaveLength(1);
    expect(sendAlertCalls[0].caseId).toBe("other-case-379");
  });

  it("retains the throttle key after a non-throwing send failure so concurrent uploads stay suppressed (Task #325)", async () => {
    sendAlertResult = { success: false, error: "EAUTH bad credentials" };

    await maybeAlertOnDocumentUpload(PARAMS);

    // Throttle key was stamped BEFORE the SMTP call and must remain even
    // though the send failed — the failure is surfaced via the dedicated
    // _failed audit row instead.
    const stored = appSettingsStore.get(docUploadAlertLastSentKey(CASE_ID));
    expect(stored).toBeDefined();

    // A second upload within the cooldown window must still be suppressed.
    sendAlertResult = { success: true };
    sendAlertCalls.length = 0;
    await maybeAlertOnDocumentUpload(PARAMS);
    expect(sendAlertCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — PATCH stamp: reviewedAt / reviewedBy (Task #278)
// Verifies that a status-change response includes the reviewer identity and
// timestamp, and that a notes-only update does NOT stamp these fields.
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/user-documents/:id — reviewedAt / reviewedBy stamp (Task #278)", () => {
  beforeEach(async () => {
    auditLogs.length = 0;
    lastUpdate = null;
    currentDoc = makeDoc();
    vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValue(
      VALID_ADMIN_SESSION as any,
    );
  });

  it("stamps reviewedAt and reviewedBy when a status is written", async () => {
    const before = new Date();

    const res = await request(adminApp)
      .patch("/api/user-documents/10")
      .set(ADMIN_AUTH)
      .send({ status: "reviewed" });

    const after = new Date();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("reviewed");

    // reviewedBy must equal the admin username from the session
    expect(res.body.reviewedBy).toBe("test-admin");

    // reviewedAt must be a valid ISO timestamp within the test window
    expect(res.body.reviewedAt).toBeDefined();
    const reviewedAt = new Date(res.body.reviewedAt);
    expect(reviewedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(reviewedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);

    // The storage call must have received the stamp fields
    expect(lastUpdate?.reviewedBy).toBe("test-admin");
    expect(lastUpdate?.reviewedAt).toBeInstanceOf(Date);
  });

  it("stamps reviewedAt/reviewedBy for every non-uploaded status value", async () => {
    const STAMPED_STATUSES = ["reviewed", "approved", "rejected"] as const;

    for (const status of STAMPED_STATUSES) {
      lastUpdate = null;
      currentDoc = makeDoc();

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status });

      expect(res.status).toBe(200);
      expect(res.body.reviewedBy).toBe("test-admin");
      expect(res.body.reviewedAt).toBeDefined();
      expect(lastUpdate?.reviewedAt).toBeInstanceOf(Date);
    }
  });

  // Task #335 — resetting to 'uploaded' clears any prior reviewer stamp
  it("clears reviewedAt/reviewedBy when status is reset to 'uploaded'", async () => {
    currentDoc = makeDoc({
      status: "approved",
      reviewedBy: "previous-admin",
      reviewedAt: new Date("2026-01-01"),
    });

    const res = await request(adminApp)
      .patch("/api/user-documents/10")
      .set(ADMIN_AUTH)
      .send({ status: "uploaded" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("uploaded");
    expect(res.body.reviewedAt).toBeNull();
    expect(res.body.reviewedBy).toBeNull();

    // The storage call must have received explicit nulls to clear the stamp.
    expect(lastUpdate).not.toBeNull();
    expect(lastUpdate).toHaveProperty("reviewedAt", null);
    expect(lastUpdate).toHaveProperty("reviewedBy", null);
  });

  // Task #335 — transitioning FROM 'uploaded' to any other status still stamps.
  it("stamps reviewedAt/reviewedBy when transitioning from 'uploaded' to another status", async () => {
    const NON_UPLOADED = ["reviewed", "approved", "rejected"] as const;

    for (const status of NON_UPLOADED) {
      lastUpdate = null;
      currentDoc = makeDoc({ status: "uploaded", reviewedAt: null, reviewedBy: null });

      const res = await request(adminApp)
        .patch("/api/user-documents/10")
        .set(ADMIN_AUTH)
        .send({ status });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
      expect(res.body.reviewedBy).toBe("test-admin");
      expect(res.body.reviewedAt).toBeDefined();
      expect(res.body.reviewedAt).not.toBeNull();
      expect(lastUpdate?.reviewedBy).toBe("test-admin");
      expect(lastUpdate?.reviewedAt).toBeInstanceOf(Date);
    }
  });

  it("does NOT stamp reviewedAt/reviewedBy when only adminNotes is updated", async () => {
    const res = await request(adminApp)
      .patch("/api/user-documents/10")
      .set(ADMIN_AUTH)
      .send({ adminNotes: "Just a note, no status change" });

    expect(res.status).toBe(200);

    // reviewedAt / reviewedBy should not be present in the update payload
    expect(lastUpdate?.reviewedAt).toBeUndefined();
    expect(lastUpdate?.reviewedBy).toBeUndefined();
  });

  it("does not call updateUserDocument for an empty body (no-op path)", async () => {
    currentDoc = makeDoc({ status: "reviewed", reviewedBy: "previous-admin", reviewedAt: new Date("2026-01-01") });

    const res = await request(adminApp)
      .patch("/api/user-documents/10")
      .set(ADMIN_AUTH)
      .send({});

    expect(res.status).toBe(200);
    expect(lastUpdate).toBeNull();
    // The returned doc still has the previously-stamped values
    expect(res.body.reviewedBy).toBe("previous-admin");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — GET /api/user-documents/pending-counts  (Task #273 badge counts)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/user-documents/pending-counts — badge counts (Task #273)", () => {
  beforeEach(async () => {
    pendingCountsStore = {};
    vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValue(
      VALID_ADMIN_SESSION as any,
    );
  });

  describe("authentication", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(adminApp).get("/api/user-documents/pending-counts");
      expect(res.status).toBe(401);
    });

    it("allows requests with a valid admin bearer token", async () => {
      const res = await request(adminApp)
        .get("/api/user-documents/pending-counts")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
    });
  });

  describe("response shape", () => {
    it("returns an object with a 'counts' key", async () => {
      pendingCountsStore = { "case-x": 2 };
      const res = await request(adminApp)
        .get("/api/user-documents/pending-counts")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("counts");
    });

    it("returns an empty counts object when there are no pending uploads", async () => {
      pendingCountsStore = {};
      const res = await request(adminApp)
        .get("/api/user-documents/pending-counts")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body.counts).toEqual({});
    });

    it("returns the correct per-case counts", async () => {
      pendingCountsStore = { "case-a": 3, "case-b": 1 };
      const res = await request(adminApp)
        .get("/api/user-documents/pending-counts")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body.counts).toEqual({ "case-a": 3, "case-b": 1 });
    });

    it("only includes cases that have at least one pending upload", async () => {
      pendingCountsStore = { "case-a": 2 };
      const res = await request(adminApp)
        .get("/api/user-documents/pending-counts")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      const keys = Object.keys(res.body.counts);
      expect(keys).toEqual(["case-a"]);
    });
  });

  describe("badge lifecycle", () => {
    it("reflects a count of 1 for a newly-uploaded document", async () => {
      pendingCountsStore = { "case-new": 1 };
      const res = await request(adminApp)
        .get("/api/user-documents/pending-counts")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body.counts["case-new"]).toBe(1);
    });

    it("reflects count of 0 (case absent) after all uploads are approved", async () => {
      // After approving, the storage returns no entry for that case.
      pendingCountsStore = {};
      const res = await request(adminApp)
        .get("/api/user-documents/pending-counts")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body.counts["case-new"]).toBeUndefined();
    });

    it("accumulates counts when a case has multiple pending uploads", async () => {
      pendingCountsStore = { "case-multi": 5 };
      const res = await request(adminApp)
        .get("/api/user-documents/pending-counts")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body.counts["case-multi"]).toBe(5);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — GET /api/admin/user-documents  (Task #320 canonical admin mount)
// Mirrors Suite 3 but exercises the canonical `/api/admin/user-documents`
// mount path that the production app uses (see server/routes.ts line 89).
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_DOC_A = makeDoc({ id: 11, caseId: "case-a", status: "uploaded", fileName: "a.pdf" });
const ADMIN_DOC_B = makeDoc({ id: 12, caseId: "case-b", status: "approved", fileName: "b.pdf" });
const ADMIN_DOC_C = makeDoc({ id: 13, caseId: "case-a", status: "rejected", fileName: "c.pdf" });

describe("GET /api/admin/user-documents — cross-case list at canonical admin mount (Task #320)", () => {
  beforeEach(async () => {
    allDocsStore = [ADMIN_DOC_A, ADMIN_DOC_B, ADMIN_DOC_C];
    vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValue(
      VALID_ADMIN_SESSION as any,
    );
  });

  describe("authentication", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(canonicalAdminApp).get("/api/admin/user-documents");
      expect(res.status).toBe(401);
    });

    it("rejects requests with an invalid bearer token with 401", async () => {
      vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValueOnce(
        null as any,
      );
      const res = await request(canonicalAdminApp)
        .get("/api/admin/user-documents")
        .set({ Authorization: "Bearer bogus-token" });
      expect(res.status).toBe(401);
    });

    it("allows requests with a valid admin bearer token", async () => {
      const res = await request(canonicalAdminApp)
        .get("/api/admin/user-documents")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
    });
  });

  describe("unfiltered list", () => {
    it("returns all documents when no filters are supplied", async () => {
      const res = await request(canonicalAdminApp)
        .get("/api/admin/user-documents")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.map((d: any) => d.fileName).sort()).toEqual([
        "a.pdf",
        "b.pdf",
        "c.pdf",
      ]);
    });

    it("strips the fileData blob — fileData must not appear in any row", async () => {
      allDocsStore = [
        makeDoc({ id: 101, fileData: "data:application/pdf;base64,SECRET1" }),
        makeDoc({ id: 102, fileData: "data:application/pdf;base64,SECRET2" }),
      ];
      const res = await request(canonicalAdminApp)
        .get("/api/admin/user-documents")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      for (const row of res.body) {
        expect(row).not.toHaveProperty("fileData");
      }
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("SECRET1");
      expect(serialized).not.toContain("SECRET2");
    });
  });

  describe("?status filter", () => {
    it("filters to only documents with the given status", async () => {
      const res = await request(canonicalAdminApp)
        .get("/api/admin/user-documents?status=approved")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].fileName).toBe("b.pdf");
      expect(res.body[0].status).toBe("approved");
    });

    it("returns an empty array when no documents match the status filter", async () => {
      const res = await request(canonicalAdminApp)
        .get("/api/admin/user-documents?status=reviewed")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("rejects an unrecognised status value with 400", async () => {
      const res = await request(canonicalAdminApp)
        .get("/api/admin/user-documents?status=pending_review")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(400);
    });
  });

  describe("?caseId filter", () => {
    it("filters to only documents belonging to the given case", async () => {
      const res = await request(canonicalAdminApp)
        .get("/api/admin/user-documents?caseId=case-a")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((d: any) => d.fileName).sort()).toEqual(["a.pdf", "c.pdf"]);
      for (const row of res.body) {
        expect(row.caseId).toBe("case-a");
      }
    });

    it("returns an empty array when no documents match the caseId filter", async () => {
      const res = await request(canonicalAdminApp)
        .get("/api/admin/user-documents?caseId=unknown-case")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("combined ?status + ?caseId filters", () => {
    it("applies both filters together", async () => {
      const res = await request(canonicalAdminApp)
        .get("/api/admin/user-documents?caseId=case-a&status=rejected")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].fileName).toBe("c.pdf");
      expect(res.body[0].caseId).toBe("case-a");
      expect(res.body[0].status).toBe("rejected");
    });

    it("returns an empty array when the combined filter has no matches", async () => {
      const res = await request(canonicalAdminApp)
        .get("/api/admin/user-documents?caseId=case-b&status=uploaded")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
