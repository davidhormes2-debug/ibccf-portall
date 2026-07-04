import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";
import type {
  cases as CasesTable,
  letterReissues as LetterReissuesTable,
  depositReceipts as DepositReceiptsTable,
  certificateFeePayments as CertificateFeePaymentsTable,
  stampDutyReceipts as StampDutyReceiptsTable,
} from "@shared/schema";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// The hand-rolled mock rows below (getCaseById return, baseReissue, depositRows,
// certRows, stampRows) mimic real Drizzle table columns across five tables.
// These Pick<> declarations fail `npm run check` if any referenced column is
// renamed in shared/schema.ts, preventing silent mock drift.
declare const _casesGuard: Pick<typeof CasesTable, "id" | "accessCode">;
declare const _letterReissuesGuard: Pick<
  typeof LetterReissuesTable,
  "id" | "caseId" | "version" | "reissueFee" | "status" | "receiptId" | "paidAt"
>;
declare const _depositReceiptsGuard: Pick<
  typeof DepositReceiptsTable,
  | "id"
  | "caseId"
  | "status"
  | "category"
  | "reissueId"
  | "fileName"
  | "notes"
  | "adminNotes"
  | "uploadedAt"
>;
declare const _certificateFeePaymentsGuard: Pick<
  typeof CertificateFeePaymentsTable,
  | "id"
  | "caseId"
  | "status"
  | "amountUsdt"
  | "fileName"
  | "notes"
  | "adminNotes"
  | "reviewedAt"
  | "reviewedBy"
  | "uploadedAt"
>;
declare const _stampDutyReceiptsGuard: Pick<
  typeof StampDutyReceiptsTable,
  | "id"
  | "caseId"
  | "status"
  | "amountUsdt"
  | "fileName"
  | "notes"
  | "adminNotes"
  | "reviewedAt"
  | "reviewedBy"
  | "uploadedAt"
>;

const TEST_ADMIN_USERNAME = "unified-upload-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// Task #165 — Cover the Task #163 unified-upload contract end-to-end.
//
// Two surfaces are exercised here:
//   1. POST /api/cases/:id/deposit-receipts — the category ⟺ reissueId
//      cross-rule that the portal Uploads view depends on.
//   2. GET  /api/deposits/all-receipts — the cross-case admin inbox,
//      specifically the status + category filters that fan out across
//      deposit_receipts + certificate_fee_payments + stamp_duty_receipts.
//
// Every storage method the routes touch is mocked so the handlers run
// without a real DB. Admin auth is satisfied by a stub session row that
// looks active.

// ---- Mutable test fixtures (reset in beforeEach) --------------------------

let reissueRow: any = null;
let createdReceiptPayload: any = null;

let depositRows: any[] = [];
let certRows: any[] = [];
let stampRows: any[] = [];

// ---- Mocks ----------------------------------------------------------------

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // Admin auth — checkAdminAuth -> isValidAdminToken needs an active session.
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),

    // Upload route deps.
    getLetterReissueById: vi.fn(async () => reissueRow),
    createDepositReceipt: vi.fn(async (data: any) => {
      createdReceiptPayload = data;
      return { id: 999, ...data };
    }),
    updateLetterReissue: vi.fn(async () => reissueRow),

    // Per-case count used by the POST handler before inserting.
    countDepositReceiptsByCaseId: vi.fn(async () => 0),

    // Per-case reads (not exercised by these tests but harmless to stub).
    getDepositReceiptsByCaseId: vi.fn(async () => []),
    getCertificateFeePaymentsByCaseId: vi.fn(async () => []),
    getStampDutyReceiptsByCaseId: vi.fn(async () => []),

    // Cross-case reads driving the admin inbox.
    getAllDepositReceipts: vi.fn(async () => depositRows),
    getAllCertificateFeePayments: vi.fn(async () => certRows),
    getAllStampDutyReceipts: vi.fn(async () => stampRows),

    // Used by collectMergedReceipts to enrich rows with the human-friendly
    // access code (best-effort; single-case path vs. multi-case path).
    getCaseById: vi.fn(async (id: string) => ({ id, accessCode: "IBCCF-TEST" })),
    getAllCases: vi.fn(async () => []),
  }),
}));

// Bypass portal-session machinery for the upload tests — the
// validation contract is what we care about here, not the cookie/header
// session plumbing (exercised in portalAuthHardening.test.ts).
vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async () => true),
}));

// Imports AFTER vi.mock calls.
const { registerCaseDepositRoutes, depositsRouter } = await import(
  "../routes/deposits"
);

function buildPortalApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const router = Router();
  registerCaseDepositRoutes(router);
  app.use("/api/cases", router);
  return app;
}

function buildAdminApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/deposits", depositsRouter);
  return app;
}

const VALID_DATA_URL = "data:image/png;base64," + "A".repeat(80);

const baseReissue = {
  id: 7,
  caseId: "case-1",
  version: 2,
  reissueFee: "1500 USDT",
  status: "pending",
  receiptId: null,
  paidAt: null,
};

beforeEach(() => {
  createdReceiptPayload = null;
  reissueRow = { ...baseReissue };
  depositRows = [];
  certRows = [];
  stampRows = [];
});

// ---- Upload route: category ⟺ reissueId binding --------------------------

describe("POST /api/cases/:id/deposit-receipts — unified category contract", () => {
  const app = buildPortalApp();

  it("rejects category='reissue' without a reissueId (400)", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({ imageData: VALID_DATA_URL, category: "reissue" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reissue category requires a reissueId/i);
    expect(createdReceiptPayload).toBeNull();
  });

  it("rejects a reissueId when category is explicitly non-reissue (400)", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        imageData: VALID_DATA_URL,
        reissueId: 7,
        category: "activation",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reissueId is only valid with category='reissue'/i);
    expect(createdReceiptPayload).toBeNull();
  });

  it("accepts category='activation' with no reissueId and persists the category", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({ imageData: VALID_DATA_URL, category: "activation" });

    expect(res.status).toBe(200);
    expect(createdReceiptPayload).toMatchObject({
      caseId: "case-1",
      category: "activation",
      reissueId: null,
      status: "pending",
    });
  });

  it("accepts category='other' with no reissueId", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({ imageData: VALID_DATA_URL, category: "other" });

    expect(res.status).toBe(200);
    expect(createdReceiptPayload).toMatchObject({
      caseId: "case-1",
      category: "other",
      reissueId: null,
    });
  });

  it("legacy client without a category but with reissueId still works (defaults to 'reissue')", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({ imageData: VALID_DATA_URL, reissueId: 7 });

    expect(res.status).toBe(200);
    expect(createdReceiptPayload).toMatchObject({
      category: "reissue",
      reissueId: 7,
    });
  });

  it("legacy client without category or reissueId still works (defaults to 'activation')", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({ imageData: VALID_DATA_URL });

    expect(res.status).toBe(200);
    expect(createdReceiptPayload).toMatchObject({
      category: "activation",
      reissueId: null,
    });
  });
});

// ---- Admin inbox: cross-case status + category filters -------------------

describe("GET /api/deposits/all-receipts — admin inbox filters", () => {
  const app = buildAdminApp();
  const auth = { Authorization: "Bearer test-token" };

  beforeEach(() => {
    depositRows = [
      {
        id: 1,
        caseId: "case-A",
        status: "pending",
        category: "activation",
        reissueId: null,
        fileName: "a.png",
        notes: null,
        adminNotes: null,
        uploadedAt: new Date("2026-05-01T00:00:00Z"),
      },
      {
        id: 2,
        caseId: "case-A",
        status: "approved",
        category: "reissue",
        reissueId: 7,
        fileName: "r.png",
        notes: null,
        adminNotes: null,
        uploadedAt: new Date("2026-05-02T00:00:00Z"),
      },
      {
        id: 3,
        caseId: "case-B",
        status: "rejected",
        // legacy row with no category — category is inferred from reissueId.
        category: null,
        reissueId: null,
        fileName: "legacy.png",
        notes: null,
        adminNotes: null,
        uploadedAt: new Date("2026-05-03T00:00:00Z"),
      },
      {
        id: 4,
        caseId: "case-B",
        status: "pending",
        // Reactivation receipt: category='reissue' with no linked reissue round.
        category: "reissue",
        reissueId: null,
        fileName: "reactivation.png",
        notes: null,
        adminNotes: null,
        uploadedAt: new Date("2026-05-04T12:00:00Z"),
      },
    ];
    certRows = [
      {
        id: 10,
        caseId: "case-A",
        status: "approved",
        amountUsdt: "300",
        fileName: "cert.png",
        notes: null,
        adminNotes: null,
        reviewedAt: null,
        reviewedBy: null,
        uploadedAt: new Date("2026-05-04T00:00:00Z"),
      },
      {
        id: 11,
        caseId: "case-B",
        status: "pending",
        amountUsdt: "300",
        fileName: "cert2.png",
        notes: null,
        adminNotes: null,
        reviewedAt: null,
        reviewedBy: null,
        uploadedAt: new Date("2026-05-05T00:00:00Z"),
      },
    ];
    stampRows = [
      {
        id: 20,
        caseId: "case-A",
        status: "pending",
        amountUsdt: "250",
        fileName: "stamp.png",
        notes: null,
        adminNotes: null,
        reviewedAt: null,
        reviewedBy: null,
        uploadedAt: new Date("2026-05-06T00:00:00Z"),
      },
    ];
  });

  it("returns 401 without an admin bearer token", async () => {
    const res = await request(app).get("/api/deposits/all-receipts");
    expect(res.status).toBe(401);
  });

  it("returns every row across all three tables, newest first", async () => {
    const res = await request(app).get("/api/deposits/all-receipts").set(auth);

    expect(res.status).toBe(200);
    // 4 deposit rows + 2 cert rows + 1 stamp row = 7 total.
    expect(res.body).toHaveLength(7);
    // Sorted desc by uploadedAt — stamp (May 6) first, deposit row 1 (May 1) last.
    expect(res.body[0]).toMatchObject({ source: "stamp_duty", id: 20 });
    expect(res.body.at(-1)).toMatchObject({ source: "deposit", id: 1 });

    // Sources span all three tables.
    const sources = new Set(res.body.map((r: any) => r.source));
    expect(sources).toEqual(new Set(["deposit", "certificate", "stamp_duty"]));
  });

  it("category='reissue' returns ALL reissue deposit rows (letter reissue + reactivation, no cert/stamp)", async () => {
    const res = await request(app)
      .get("/api/deposits/all-receipts?category=reissue")
      .set(auth);

    expect(res.status).toBe(200);
    // Row 2 (letter reissue, reissueId=7) + Row 4 (reactivation, reissueId=null).
    expect(res.body).toHaveLength(2);
    const ids = res.body.map((r: any) => r.id).sort((a: number, b: number) => a - b);
    expect(ids).toEqual([2, 4]);
    expect(res.body.every((r: any) => r.source === "deposit" && r.category === "reissue")).toBe(true);
  });

  it("category='reactivation' (virtual) returns only reissue deposit rows with no reissueId", async () => {
    const res = await request(app)
      .get("/api/deposits/all-receipts?category=reactivation")
      .set(auth);

    expect(res.status).toBe(200);
    // Only row 4: category='reissue', reissueId=null.
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      source: "deposit",
      id: 4,
      category: "reissue",
      reissueId: null,
    });
  });

  it("category='certificate' returns ONLY certificate rows (no deposits/stamp)", async () => {
    const res = await request(app)
      .get("/api/deposits/all-receipts?category=certificate")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.source)).toEqual([
      "certificate",
      "certificate",
    ]);
    expect(res.body.every((r: any) => r.category === "certificate")).toBe(true);
  });

  it("category='stamp_duty' returns ONLY stamp-duty rows", async () => {
    const res = await request(app)
      .get("/api/deposits/all-receipts?category=stamp_duty")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ source: "stamp_duty", id: 20 });
  });

  it("category='activation' returns ONLY activation deposits (legacy null-category row counts as activation)", async () => {
    const res = await request(app)
      .get("/api/deposits/all-receipts?category=activation")
      .set(auth);

    expect(res.status).toBe(200);
    // Row 1 has category='activation'; row 3 has category=null + reissueId=null
    // so its inferred category is 'activation' too.
    const ids = res.body.map((r: any) => r.id).sort();
    expect(ids).toEqual([1, 3]);
    expect(res.body.every((r: any) => r.source === "deposit")).toBe(true);
  });

  it("status='approved' filters across ALL three sources", async () => {
    const res = await request(app)
      .get("/api/deposits/all-receipts?status=approved")
      .set(auth);

    expect(res.status).toBe(200);
    // deposit row 2 (approved reissue) + certificate row 10 (approved).
    expect(res.body).toHaveLength(2);
    const keys = res.body.map((r: any) => `${r.source}:${r.id}`).sort();
    expect(keys).toEqual(["certificate:10", "deposit:2"]);
  });

  it("combines status + category filters", async () => {
    // Task #176 — stamp-duty + certificate rows whose raw DB status is
    // 'pending' are surfaced as 'awaiting_admin_approval' so the admin
    // status dropdown speaks one vocabulary across all sources.
    const res = await request(app)
      .get("/api/deposits/all-receipts?status=awaiting_admin_approval&category=stamp_duty")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      source: "stamp_duty",
      status: "awaiting_admin_approval",
    });
  });

  it("Task #176 — normalizes stamp-duty + certificate 'pending' to 'awaiting_admin_approval' so admin filters find the row", async () => {
    // Unfiltered: every stamp/cert row whose DB status is 'pending' should
    // be reported as 'awaiting_admin_approval'; deposit rows keep 'pending'.
    const all = await request(app).get("/api/deposits/all-receipts").set(auth);
    expect(all.status).toBe(200);
    const stamp = all.body.find((r: any) => r.source === "stamp_duty" && r.id === 20);
    const certPending = all.body.find((r: any) => r.source === "certificate" && r.id === 11);
    const depositPending = all.body.find((r: any) => r.source === "deposit" && r.id === 1);
    expect(stamp.status).toBe("awaiting_admin_approval");
    expect(certPending.status).toBe("awaiting_admin_approval");
    // Deposit vocabulary is unchanged — it has its own 'reviewed' state.
    expect(depositPending.status).toBe("pending");

    // Filtering by the normalized value finds the stamp + cert rows.
    const awaiting = await request(app)
      .get("/api/deposits/all-receipts?status=awaiting_admin_approval")
      .set(auth);
    expect(awaiting.status).toBe(200);
    const keys = awaiting.body.map((r: any) => `${r.source}:${r.id}`).sort();
    expect(keys).toEqual(["certificate:11", "stamp_duty:20"]);

    // Filtering by raw 'pending' must NOT return stamp/cert rows (they
    // are no longer pending in the merged vocabulary) — only deposits.
    const pending = await request(app)
      .get("/api/deposits/all-receipts?status=pending")
      .set(auth);
    expect(pending.status).toBe(200);
    expect(pending.body.every((r: any) => r.source === "deposit")).toBe(true);
  });

  it("rejects an invalid category with 400", async () => {
    const res = await request(app)
      .get("/api/deposits/all-receipts?category=bogus")
      .set(auth);

    expect(res.status).toBe(400);
  });
});
