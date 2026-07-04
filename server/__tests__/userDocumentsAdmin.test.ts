import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// checkAdminAuth validates the bearer token against getAdminSessionByToken.
// ADMIN_USERNAME must match the session's adminUsername field.
process.env.ADMIN_USERNAME = "test-admin";

// ─── Shared test state ────────────────────────────────────────────────────────

const auditLogs: any[] = [];
let currentDoc: any = null;
let lastUpdate: any = null;
let caseDocStore: any[] = [];

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 20,
    caseId: "case-abc",
    fileName: "passport.pdf",
    fileType: "application/pdf",
    fileData: "data:application/pdf;base64,JVBERi0xLjQ=",
    fileSize: "8192",
    category: "kyc",
    description: "Passport scan",
    status: "uploaded",
    adminNotes: null,
    uploadedAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

// ─── Storage mock ─────────────────────────────────────────────────────────────

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getUserDocumentById: vi.fn(async (_id: number) => currentDoc),
    updateUserDocument: vi.fn(async (id: number, data: any, _tx?: unknown) => {
      lastUpdate = { id, ...data };
      currentDoc = { ...currentDoc, ...data };
      return currentDoc;
    }),
    getUserDocumentsByCaseId: vi.fn(async (_caseId: string) =>
      caseDocStore.map(({ fileData: _stripped, ...rest }: any) => rest),
    ),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    getAdminSessionByToken: vi.fn(),
    updateAdminSessionActivity: vi.fn(async () => {}),
  }),
}));

// ─── Portal-auth mock — bypass for any portal-protected routes ────────────────

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
}));

// ─── Route imports ────────────────────────────────────────────────────────────

const { userDocumentsAdminRouter, registerCaseUserDocumentRoutes } = await import(
  "../routes/content"
);

// ─── App factories ────────────────────────────────────────────────────────────

function buildAdminApp() {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/admin/user-documents", userDocumentsAdminRouter);
  return app;
}

// Mirrors `server/routes.ts` mounting the same router on the unprefixed
// `/api/user-documents` path that the cross-case Supporting Docs tab
// (Task #309) calls with `PATCH /api/user-documents/:id`.
function buildUnprefixedApp() {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/user-documents", userDocumentsAdminRouter);
  return app;
}

function buildCasesApp() {
  const app = express();
  app.use(express.json());
  const casesRouter = Router();
  registerCaseUserDocumentRoutes(casesRouter);
  app.use("/api/cases", casesRouter);
  return app;
}

const adminApp = buildAdminApp();
const unprefixedApp = buildUnprefixedApp();
const casesApp = buildCasesApp();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ADMIN_AUTH = { Authorization: "Bearer admin-token" };

const VALID_ADMIN_SESSION = {
  id: "sess-1",
  isActive: true,
  revokedAt: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  adminUsername: "test-admin",
};

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — GET /api/cases/:id/user-documents
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/cases/:id/user-documents", () => {
  beforeEach(async () => {
    caseDocStore = [makeDoc({ id: 1 }), makeDoc({ id: 2, fileName: "id-card.png", fileType: "image/png" })];
    vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValue(
      VALID_ADMIN_SESSION as any,
    );
  });

  describe("authentication", () => {
    it("returns 401 when no bearer token is supplied", async () => {
      const res = await request(casesApp).get("/api/cases/case-abc/user-documents");
      expect(res.status).toBe(401);
    });

    it("allows requests with a valid admin bearer token", async () => {
      const res = await request(casesApp)
        .get("/api/cases/case-abc/user-documents")
        .set(ADMIN_AUTH);
      expect(res.status).toBe(200);
    });
  });

  describe("response shape", () => {
    it("returns an array of documents for the case", async () => {
      const res = await request(casesApp)
        .get("/api/cases/case-abc/user-documents")
        .set(ADMIN_AUTH);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    it("strips the fileData blob from every row", async () => {
      const res = await request(casesApp)
        .get("/api/cases/case-abc/user-documents")
        .set(ADMIN_AUTH);

      expect(res.status).toBe(200);
      for (const row of res.body) {
        expect(row).not.toHaveProperty("fileData");
      }
    });

    it("includes expected metadata fields on each row", async () => {
      caseDocStore = [makeDoc()];
      const res = await request(casesApp)
        .get("/api/cases/case-abc/user-documents")
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

    it("returns an empty array when the case has no documents", async () => {
      caseDocStore = [];
      const res = await request(casesApp)
        .get("/api/cases/case-abc/user-documents")
        .set(ADMIN_AUTH);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — PATCH /api/admin/user-documents/:id  (approve / reject + audit log)
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/user-documents/:id", () => {
  beforeEach(async () => {
    auditLogs.length = 0;
    lastUpdate = null;
    currentDoc = makeDoc();
    vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValue(
      VALID_ADMIN_SESSION as any,
    );
  });

  describe("authentication", () => {
    it("returns 401 when no bearer token is supplied", async () => {
      const res = await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .send({ status: "approved" });

      expect(res.status).toBe(401);
      expect(lastUpdate).toBeNull();
    });
  });

  describe("approve flow", () => {
    it("sets status to 'approved' and returns the updated document", async () => {
      const res = await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .set(ADMIN_AUTH)
        .send({ status: "approved" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("approved");
      expect(lastUpdate?.status).toBe("approved");
    });

    it("writes a 'user_document_approved' audit log row", async () => {
      await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .set(ADMIN_AUTH)
        .send({ status: "approved" });

      const approvedRows = auditLogs.filter((a) => a.action === "user_document_approved");
      expect(approvedRows).toHaveLength(1);
      const row = approvedRows[0];
      expect(row.targetType).toBe("case");
      expect(row.targetId).toBe("case-abc");
      expect(row.newValue).toContain("passport.pdf");
      expect(row.newValue).toContain("approved");
    });

    it("persists adminNotes alongside an approval", async () => {
      const res = await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .set(ADMIN_AUTH)
        .send({ status: "approved", adminNotes: "Documents verified" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("approved");
      expect(lastUpdate?.adminNotes).toBe("Documents verified");
    });
  });

  describe("reject flow", () => {
    it("sets status to 'rejected' and returns the updated document", async () => {
      const res = await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .set(ADMIN_AUTH)
        .send({ status: "rejected" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("rejected");
      expect(lastUpdate?.status).toBe("rejected");
    });

    it("writes a 'user_document_rejected' audit log row", async () => {
      await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .set(ADMIN_AUTH)
        .send({ status: "rejected", adminNotes: "Blurry image" });

      const rejectedRows = auditLogs.filter((a) => a.action === "user_document_rejected");
      expect(rejectedRows).toHaveLength(1);
      const row = rejectedRows[0];
      expect(row.targetType).toBe("case");
      expect(row.targetId).toBe("case-abc");
      expect(row.newValue).toContain("passport.pdf");
      expect(row.newValue).toContain("rejected");
      expect(row.newValue).toContain("Blurry image");
    });

    it("persists adminNotes alongside a rejection", async () => {
      const res = await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .set(ADMIN_AUTH)
        .send({ status: "rejected", adminNotes: "Expired document" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("rejected");
      expect(lastUpdate?.adminNotes).toBe("Expired document");
    });
  });

  describe("reviewed status writes correct audit action", () => {
    it("writes 'user_document_reviewed' audit row when status is 'reviewed'", async () => {
      await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .set(ADMIN_AUTH)
        .send({ status: "reviewed" });

      const rows = auditLogs.filter((a) => a.action === "user_document_reviewed");
      expect(rows).toHaveLength(1);
      expect(rows[0].targetType).toBe("case");
      expect(rows[0].targetId).toBe("case-abc");
    });
  });

  describe("notes-only update", () => {
    it("writes 'user_document_notes_updated' audit row when only adminNotes is changed", async () => {
      await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .set(ADMIN_AUTH)
        .send({ adminNotes: "Pending callback from compliance" });

      const rows = auditLogs.filter((a) => a.action === "user_document_notes_updated");
      expect(rows).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("returns 404 when the document does not exist", async () => {
      currentDoc = null;

      const res = await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .set(ADMIN_AUTH)
        .send({ status: "approved" });

      expect(res.status).toBe(404);
      expect(lastUpdate).toBeNull();
    });

    it("returns 400 for an unknown status value", async () => {
      const res = await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .set(ADMIN_AUTH)
        .send({ status: "pending_review" });

      expect(res.status).toBe(400);
      expect(lastUpdate).toBeNull();
    });

    it("empty body is a valid no-op and returns the document unchanged", async () => {
      currentDoc = makeDoc({ status: "reviewed", adminNotes: "Prior note" });

      const res = await request(adminApp)
        .patch("/api/admin/user-documents/20")
        .set(ADMIN_AUTH)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("reviewed");
      expect(res.body.adminNotes).toBe("Prior note");
      expect(lastUpdate).toBeNull();
      expect(auditLogs).toHaveLength(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — GET /api/admin/user-documents/:id/file
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/user-documents/:id/file", () => {
  beforeEach(async () => {
    currentDoc = makeDoc();
    vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValue(
      VALID_ADMIN_SESSION as any,
    );
  });

  describe("authentication", () => {
    it("returns 401 when no bearer token is supplied", async () => {
      const res = await request(adminApp).get("/api/admin/user-documents/20/file");
      expect(res.status).toBe(401);
    });
  });

  describe("happy path", () => {
    it("returns fileData, fileType, and fileName for a known document", async () => {
      const res = await request(adminApp)
        .get("/api/admin/user-documents/20/file")
        .set(ADMIN_AUTH);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("fileData", "data:application/pdf;base64,JVBERi0xLjQ=");
      expect(res.body).toHaveProperty("fileType", "application/pdf");
      expect(res.body).toHaveProperty("fileName", "passport.pdf");
    });

    it("returns only the three file-specific fields (no extra case data)", async () => {
      const res = await request(adminApp)
        .get("/api/admin/user-documents/20/file")
        .set(ADMIN_AUTH);

      expect(res.status).toBe(200);
      const keys = Object.keys(res.body);
      expect(keys).toContain("fileData");
      expect(keys).toContain("fileType");
      expect(keys).toContain("fileName");
      expect(keys).toHaveLength(3);
    });
  });

  describe("error cases", () => {
    it("returns 404 when the document id does not exist", async () => {
      currentDoc = null;

      const res = await request(adminApp)
        .get("/api/admin/user-documents/20/file")
        .set(ADMIN_AUTH);

      expect(res.status).toBe(404);
    });

    it("returns 400 for a non-numeric id", async () => {
      const res = await request(adminApp)
        .get("/api/admin/user-documents/not-a-number/file")
        .set(ADMIN_AUTH);

      expect(res.status).toBe(400);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — PATCH /api/user-documents/:id  (Task #371)
//
// The cross-case Supporting Docs tab (Task #309) calls the same admin router
// via the *unprefixed* `/api/user-documents` path. This suite locks in
// approve/reject behavior on that exact path so a future routing change can
// not silently break the inline optimistic-UI flow.
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/user-documents/:id (Supporting Docs tab)", () => {
  beforeEach(async () => {
    auditLogs.length = 0;
    lastUpdate = null;
    currentDoc = makeDoc();
    vi.mocked((await import("../storage")).storage.getAdminSessionByToken).mockResolvedValue(
      VALID_ADMIN_SESSION as any,
    );
  });

  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(unprefixedApp)
      .patch("/api/user-documents/20")
      .send({ status: "approved" });

    expect(res.status).toBe(401);
    expect(lastUpdate).toBeNull();
    expect(auditLogs).toHaveLength(0);
  });

  it("approve returns the updated document and writes user_document_approved audit", async () => {
    const res = await request(unprefixedApp)
      .patch("/api/user-documents/20")
      .set(ADMIN_AUTH)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(20);
    expect(res.body.status).toBe("approved");
    expect(lastUpdate?.status).toBe("approved");

    const approvedRows = auditLogs.filter((a) => a.action === "user_document_approved");
    expect(approvedRows).toHaveLength(1);
    expect(approvedRows[0].targetType).toBe("case");
    expect(approvedRows[0].targetId).toBe("case-abc");
    expect(approvedRows[0].newValue).toContain("approved");
  });

  it("reject with adminNotes persists notes and writes user_document_rejected audit", async () => {
    const res = await request(unprefixedApp)
      .patch("/api/user-documents/20")
      .set(ADMIN_AUTH)
      .send({ status: "rejected", adminNotes: "Illegible scan" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.adminNotes).toBe("Illegible scan");
    expect(lastUpdate?.status).toBe("rejected");
    expect(lastUpdate?.adminNotes).toBe("Illegible scan");

    const rejectedRows = auditLogs.filter((a) => a.action === "user_document_rejected");
    expect(rejectedRows).toHaveLength(1);
    expect(rejectedRows[0].targetType).toBe("case");
    expect(rejectedRows[0].targetId).toBe("case-abc");
    expect(rejectedRows[0].newValue).toContain("rejected");
    expect(rejectedRows[0].newValue).toContain("Illegible scan");
  });
});
