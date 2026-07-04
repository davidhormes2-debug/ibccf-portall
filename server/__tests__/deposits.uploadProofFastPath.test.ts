import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ── Mock wiring ───────────────────────────────────────────────────────────────
//
// We exercise the "Upload proof" fast-path inside
// POST /api/cases/:id/deposit-receipts:
//
//   if (receiptId && category === 'merge_fee' && imageData) {
//     const target = await storage.getDepositReceiptById(receiptId);
//     if (target && target.caseId === req.params.id && !target.imageData) {
//       // PATCH the placeholder; respond; return early
//     }
//     // else fall through to normal creation
//   }
//
// Covered scenarios:
//   1. Happy path — placeholder patched, fileName set, admin notification fired.
//   2. Case-mismatch — target.caseId !== :id → falls through, creates new receipt.
//   3. Already-has-imageData — target.imageData is truthy → falls through.
//   4. Invalid receiptId — getDepositReceiptById returns null → falls through.
//   5. Wrong category — receiptId present but category != 'merge_fee' → falls through.

let targetReceipt: any = null;
let updatedReceiptPayload: any = null;
let createdReceiptPayload: any = null;

const UPDATED_ROW = {
  id: 42,
  caseId: "case-1",
  imageData: null as string | null,
  fileName: null as string | null,
  category: "merge_fee",
  status: "pending",
  uploadedAt: new Date().toISOString(),
};

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getDepositReceiptById: vi.fn(async () => targetReceipt),
    updateDepositReceipt: vi.fn(async (_id: number, data: any) => {
      updatedReceiptPayload = data;
      return { ...UPDATED_ROW, ...data };
    }),
    createDepositReceipt: vi.fn(async (data: any) => {
      createdReceiptPayload = data;
      return { id: 99, ...data };
    }),
    countDepositReceiptsByCaseId: vi.fn(async () => 0),
    getDepositReceiptsByCaseId: vi.fn(async () => []),
  }),
}));

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyAdmin: vi.fn(async () => undefined),
  },
}));

const { registerCaseDepositRoutes } = await import("../routes/deposits");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const router = Router();
  registerCaseDepositRoutes(router);
  app.use("/api/cases", router);
  return app;
}

const app = buildApp();

const VALID_DATA_URL = "data:image/png;base64," + "A".repeat(80);

const BASE_PLACEHOLDER = {
  id: 42,
  caseId: "case-1",
  imageData: null,
  fileName: null,
  category: "merge_fee",
  status: "pending",
};

beforeEach(async () => {
  targetReceipt = { ...BASE_PLACEHOLDER };
  updatedReceiptPayload = null;
  createdReceiptPayload = null;
  const { storage } = await import("../storage");
  vi.mocked(storage.updateDepositReceipt).mockClear();
  vi.mocked(storage.createDepositReceipt).mockClear();
  vi.mocked(storage.getDepositReceiptById).mockClear();
  const { notificationService } = await import("../services/NotificationService");
  vi.mocked(notificationService.notifyAdmin).mockClear();
});

describe("POST /api/cases/:id/deposit-receipts — 'Upload proof' receiptId fast-path", () => {
  // ── 1. Happy path ─────────────────────────────────────────────────────────
  it("happy path: patches the placeholder receipt with imageData and fileName, notifies admin", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        receiptId: 42,
        category: "merge_fee",
        imageData: VALID_DATA_URL,
        fileName: "proof.png",
      });

    expect(res.status).toBe(200);
    expect(updatedReceiptPayload).toMatchObject({
      imageData: VALID_DATA_URL,
      fileName: "proof.png",
    });
    expect(createdReceiptPayload).toBeNull();
    expect(res.body).toMatchObject({ id: 42, category: "merge_fee" });
  });

  it("happy path: fileName defaults to null when omitted", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        receiptId: 42,
        category: "merge_fee",
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);
    expect(updatedReceiptPayload).toMatchObject({
      imageData: VALID_DATA_URL,
      fileName: null,
    });
    expect(createdReceiptPayload).toBeNull();
  });

  it("happy path: fires admin notification on successful patch", async () => {
    await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        receiptId: 42,
        category: "merge_fee",
        imageData: VALID_DATA_URL,
      });

    const { notificationService } = await import("../services/NotificationService");
    // The notify call is fire-and-forget; give the microtask queue a tick
    await new Promise((r) => setTimeout(r, 20));
    expect(notificationService.notifyAdmin).toHaveBeenCalledWith(
      "receipt_uploaded",
      expect.any(String),
      expect.stringContaining("merge fee"),
      expect.any(String),
    );
  });

  // ── 2. Case-mismatch — falls through to create new receipt ─────────────────
  it("falls through to create a new receipt when target receipt belongs to a different case", async () => {
    targetReceipt = { ...BASE_PLACEHOLDER, caseId: "case-OTHER" };

    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        receiptId: 42,
        category: "merge_fee",
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);
    expect(updatedReceiptPayload).toBeNull();
    expect(createdReceiptPayload).toMatchObject({
      caseId: "case-1",
      category: "merge_fee",
    });
  });

  // ── 3. Already has imageData — falls through ────────────────────────────────
  it("falls through to create a new receipt when the target already has imageData", async () => {
    targetReceipt = {
      ...BASE_PLACEHOLDER,
      imageData: "data:image/png;base64," + "Z".repeat(80),
    };

    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        receiptId: 42,
        category: "merge_fee",
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);
    expect(updatedReceiptPayload).toBeNull();
    expect(createdReceiptPayload).toMatchObject({
      caseId: "case-1",
      category: "merge_fee",
    });
  });

  // ── 4. Invalid receiptId (row not found) — falls through ───────────────────
  it("falls through to create a new receipt when getDepositReceiptById returns null", async () => {
    targetReceipt = null;

    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        receiptId: 9999,
        category: "merge_fee",
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);
    expect(updatedReceiptPayload).toBeNull();
    expect(createdReceiptPayload).toMatchObject({
      caseId: "case-1",
      category: "merge_fee",
    });
  });

  // ── 5. Wrong category — fast-path is not entered ───────────────────────────
  it("does not enter the fast-path when category is not merge_fee", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        receiptId: 42,
        category: "activation",
        imageData: VALID_DATA_URL,
      });

    // getDepositReceiptById must NOT have been called (fast-path skipped)
    const { storage } = await import("../storage");
    expect(storage.getDepositReceiptById).not.toHaveBeenCalled();

    expect(res.status).toBe(200);
    expect(updatedReceiptPayload).toBeNull();
    expect(createdReceiptPayload).toMatchObject({
      caseId: "case-1",
      category: "activation",
    });
  });

  // ── 6. receiptId omitted — fast-path is not entered ───────────────────────
  it("does not enter the fast-path when receiptId is absent", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        category: "merge_fee",
        imageData: VALID_DATA_URL,
      });

    const { storage } = await import("../storage");
    expect(storage.getDepositReceiptById).not.toHaveBeenCalled();

    expect(res.status).toBe(200);
    expect(updatedReceiptPayload).toBeNull();
    expect(createdReceiptPayload).toMatchObject({
      caseId: "case-1",
      category: "merge_fee",
    });
  });
});
