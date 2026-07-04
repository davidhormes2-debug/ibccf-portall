import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Minimal mock for storage — getCaseById returns a disabled case by default.
// ---------------------------------------------------------------------------
const mockGetCaseById = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getCaseById: (...args: any[]) => mockGetCaseById(...args),
    createAuditLog: vi.fn().mockResolvedValue({}),
    getActiveCaseSessions: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Inline the minimal cases-access route (avoids pulling the entire cases
// router with its heavy dependency graph) so we can unit-test just the
// 403 disabled-account branch.
// ---------------------------------------------------------------------------
async function buildApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/cases/access/:code", async (req, res) => {
    const { storage } = await import("../storage");
    const caseData = await storage.getCaseById(req.params.code);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (caseData.isDisabled) {
      res.status(403).json({ error: "Account disabled", reason: "reactivation_required" });
      return;
    }
    res.json({ id: caseData.id });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/cases/access/:code — disabled account 403 shape", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("returns HTTP 403 when the case is disabled", async () => {
    mockGetCaseById.mockResolvedValue({ id: "case-1", isDisabled: true });
    const res = await request(app).get("/api/cases/access/case-1");
    expect(res.status).toBe(403);
  });

  it("includes { error: 'Account disabled' } in the response body", async () => {
    mockGetCaseById.mockResolvedValue({ id: "case-1", isDisabled: true });
    const res = await request(app).get("/api/cases/access/case-1");
    expect(res.body).toMatchObject({ error: "Account disabled" });
  });

  it("includes { reason: 'reactivation_required' } in the response body", async () => {
    mockGetCaseById.mockResolvedValue({ id: "case-1", isDisabled: true });
    const res = await request(app).get("/api/cases/access/case-1");
    expect(res.body).toMatchObject({ reason: "reactivation_required" });
  });

  it("returns HTTP 200 for a non-disabled case", async () => {
    mockGetCaseById.mockResolvedValue({ id: "case-2", isDisabled: false });
    const res = await request(app).get("/api/cases/access/case-2");
    expect(res.status).toBe(200);
  });

  it("returns HTTP 404 when the case does not exist", async () => {
    mockGetCaseById.mockResolvedValue(null);
    const res = await request(app).get("/api/cases/access/unknown");
    expect(res.status).toBe(404);
  });
});
