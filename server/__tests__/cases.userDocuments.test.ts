import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// Test coverage for the portal-owned supporting-document endpoints declared
// inline on `casesRouter` in server/routes/cases.ts:
//   POST /api/cases/:id/user-documents
//   GET  /api/cases/:id/user-documents
//
// Both handlers sit behind `requirePortalAccess`. The POST handler enforces
// a data-URL prefix allow-list, a 10 MB cap, and a fileName requirement;
// the GET handler simply forwards whatever storage returns (which already
// strips the `fileData` blob). These tests pin every one of those contracts.

const storageState: {
  caseRow: any;
  createdDocs: any[];
  listRows: any[];
  auditLogs: any[];
} = {
  caseRow: { id: "case-1" },
  createdDocs: [],
  listRows: [],
  auditLogs: [],
};

let portalAccessAllowed = true;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getCaseById: vi.fn(async (id: string) =>
      storageState.caseRow && storageState.caseRow.id === id
        ? storageState.caseRow
        : undefined,
    ),
    createUserDocument: vi.fn(async (data: any) => {
      const row = {
        id: storageState.createdDocs.length + 100,
        uploadedAt: new Date("2026-05-01T00:00:00Z"),
        status: "uploaded",
        adminNotes: null,
        reviewedAt: null,
        reviewedBy: null,
        ...data,
      };
      storageState.createdDocs.push(row);
      return row;
    }),
    getUserDocumentsByCaseId: vi.fn(async (_caseId: string) => storageState.listRows),
    createAuditLog: vi.fn(async (entry: any) => {
      storageState.auditLogs.push(entry);
      return { id: storageState.auditLogs.length, ...entry };
    }),
    getAdminSessionByToken: vi.fn(async () => null),
  }),
}));

vi.mock("../services", () => ({
  caseService: {},
}));

vi.mock("../services/portal-auth", () => ({
  // POST /api/cases/:id/user-documents uses requirePortalSessionOnly;
  // GET  /api/cases/:id/user-documents uses requirePortalAccess.
  // Both guards share the portalAccessAllowed toggle so each endpoint's
  // unauthenticated-request test can observe its correct 401 path.
  requirePortalSessionOnly: (_req: any, res: any, next: any) => {
    if (!portalAccessAllowed) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  },
  requirePortalAccess: (_req: any, res: any, next: any) => {
    if (!portalAccessAllowed) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  },
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: async () => true,
}));

vi.mock("./middleware", () => ({
  checkAdminAuth: (_req: any, _res: any, next: any) => next(),
  checkIpNotBlocked: (_req: any, _res: any, next: any) => next(),
}));

const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const app = buildApp();

const TINY_PDF =
  "data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKCg==";
const TINY_PNG = "data:image/png;base64," + "A".repeat(120);
const TINY_JPEG = "data:image/jpeg;base64," + "A".repeat(120);
const TINY_WEBP = "data:image/webp;base64," + "A".repeat(120);

beforeEach(() => {
  storageState.caseRow = { id: "case-1" };
  storageState.createdDocs.length = 0;
  storageState.listRows = [];
  storageState.auditLogs.length = 0;
  portalAccessAllowed = true;
});

describe("POST /api/cases/:id/user-documents", () => {
  it("rejects unauthenticated requests with 401 (requirePortalSessionOnly)", async () => {
    portalAccessAllowed = false;

    const res = await request(app)
      .post("/api/cases/case-1/user-documents")
      .send({ fileData: TINY_PDF, fileName: "x.pdf" });

    expect(res.status).toBe(401);
    expect(storageState.createdDocs).toHaveLength(0);
    expect(storageState.auditLogs).toHaveLength(0);
  });

  it("returns 404 when the case does not exist", async () => {
    storageState.caseRow = null;

    const res = await request(app)
      .post("/api/cases/case-1/user-documents")
      .send({ fileData: TINY_PDF, fileName: "x.pdf" });

    expect(res.status).toBe(404);
    expect(storageState.createdDocs).toHaveLength(0);
  });

  it("happy path (PDF): creates the document, writes an audit row, and omits fileData from the response", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/user-documents")
      .send({
        fileData: TINY_PDF,
        fileName: "  payslip.pdf  ",
        category: "evidence",
        description: "  March payslip  ",
      });

    expect(res.status).toBe(201);
    expect(res.body.fileData).toBeUndefined();
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.caseId).toBe("case-1");
    expect(res.body.fileName).toBe("payslip.pdf");
    expect(res.body.fileType).toBe("pdf");
    expect(res.body.category).toBe("evidence");
    expect(res.body.description).toBe("March payslip");
    expect(res.body.status).toBe("uploaded");

    expect(storageState.createdDocs).toHaveLength(1);
    const persisted = storageState.createdDocs[0];
    expect(persisted.caseId).toBe("case-1");
    expect(persisted.fileData).toBe(TINY_PDF);
    expect(persisted.fileType).toBe("pdf");
    expect(persisted.category).toBe("evidence");
    expect(persisted.description).toBe("March payslip");
    expect(typeof persisted.fileSize).toBe("string");

    expect(storageState.auditLogs).toHaveLength(1);
    const audit = storageState.auditLogs[0];
    expect(audit.action).toBe("user_document_uploaded");
    expect(audit.targetType).toBe("case");
    expect(audit.targetId).toBe("case-1");
    expect(audit.adminUsername).toBe("portal-user");
    expect(audit.newValue).toContain("payslip.pdf");
    expect(audit.newValue).toContain("evidence");
  });

  it.each([
    ["png", TINY_PNG],
    ["jpeg", TINY_JPEG],
    ["webp", TINY_WEBP],
  ])("happy path (%s): accepts the image and marks fileType as 'image'", async (_label, dataUrl) => {
    const res = await request(app)
      .post("/api/cases/case-1/user-documents")
      .send({
        fileData: dataUrl,
        fileName: "snap.bin",
      });

    expect(res.status).toBe(201);
    expect(res.body.fileType).toBe("image");
    expect(res.body.category).toBe("general");
    expect(res.body.description).toBeNull();
    expect(res.body.fileData).toBeUndefined();
    expect(storageState.createdDocs).toHaveLength(1);
  });

  it("defaults an unknown category to 'general'", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/user-documents")
      .send({
        fileData: TINY_PDF,
        fileName: "doc.pdf",
        category: "totally-bogus-value",
      });

    expect(res.status).toBe(201);
    expect(res.body.category).toBe("general");
    expect(storageState.createdDocs[0].category).toBe("general");
  });

  it("rejects an unsupported MIME type with 400", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/user-documents")
      .send({
        fileData: "data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA",
        fileName: "evil.exe",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported file type/i);
    expect(storageState.createdDocs).toHaveLength(0);
    expect(storageState.auditLogs).toHaveLength(0);
  });

  it("rejects a non-data-URL string with 400", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/user-documents")
      .send({
        fileData: "just-a-plain-string",
        fileName: "x.pdf",
      });

    expect(res.status).toBe(400);
    expect(storageState.createdDocs).toHaveLength(0);
  });

  it("rejects a missing fileData with 400", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/user-documents")
      .send({ fileName: "x.pdf" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fileData is required/i);
    expect(storageState.createdDocs).toHaveLength(0);
  });

  it("rejects a missing/blank fileName with 400", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/user-documents")
      .send({ fileData: TINY_PDF, fileName: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fileName is required/i);
    expect(storageState.createdDocs).toHaveLength(0);
  });

  it("rejects oversized payloads (>10 MB) with 413", async () => {
    // The route checks *decoded* byte length. A base64 string of length N
    // decodes to floor(N * 3/4) bytes, so we need at least ceil(10MB * 4/3)
    // base64 characters to push the decoded size over the 10 MB hard cap.
    const oversized =
      "data:application/pdf;base64," + "A".repeat(Math.ceil((10 * 1024 * 1024 + 1) * 4 / 3));

    const res = await request(app)
      .post("/api/cases/case-1/user-documents")
      .send({
        fileData: oversized,
        fileName: "huge.pdf",
      });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/Maximum is 10 MB/i);
    expect(storageState.createdDocs).toHaveLength(0);
    expect(storageState.auditLogs).toHaveLength(0);
  });
});

describe("GET /api/cases/:id/user-documents", () => {
  it("rejects unauthenticated requests with 401 (requirePortalAccess)", async () => {
    portalAccessAllowed = false;

    const res = await request(app).get("/api/cases/case-1/user-documents");

    expect(res.status).toBe(401);
  });

  it("returns 404 when the case does not exist", async () => {
    storageState.caseRow = null;

    const res = await request(app).get("/api/cases/case-1/user-documents");

    expect(res.status).toBe(404);
  });

  it("returns the list as-is (storage already strips the fileData blob)", async () => {
    storageState.listRows = [
      {
        id: 1,
        caseId: "case-1",
        fileName: "a.pdf",
        fileType: "pdf",
        fileSize: "12 KB",
        category: "general",
        description: null,
        status: "uploaded",
        adminNotes: null,
        reviewedAt: null,
        reviewedBy: null,
        uploadedAt: new Date("2026-05-01T00:00:00Z").toISOString(),
      },
      {
        id: 2,
        caseId: "case-1",
        fileName: "b.png",
        fileType: "image",
        fileSize: "8 KB",
        category: "evidence",
        description: "extra",
        status: "approved",
        adminNotes: "ok",
        reviewedAt: new Date("2026-05-02T00:00:00Z").toISOString(),
        reviewedBy: "test-admin",
        uploadedAt: new Date("2026-05-02T00:00:00Z").toISOString(),
      },
    ];

    const res = await request(app).get("/api/cases/case-1/user-documents");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    for (const row of res.body) {
      expect(row.fileData).toBeUndefined();
    }
    expect(res.body[0].fileName).toBe("a.pdf");
    expect(res.body[1].status).toBe("approved");
  });

  it("returns an empty array when the case has no uploads", async () => {
    storageState.listRows = [];

    const res = await request(app).get("/api/cases/case-1/user-documents");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
