import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---- Mocks ----------------------------------------------------------------
//
// Mirrors deposits.reissueReceipt.test.ts: the storage methods the upload
// handler touches are mocked so the route runs without a real DB. We capture
// the create/update payloads so each assertion can verify the exact server
// behavior (data-URL guard, reissue ownership, paid/cancelled rounds, and the
// happy path that flips the round to awaiting_review tagged with the new
// receipt id).
//
// The mock is built with `createStorageMock`, which auto-stubs any storage
// method the route reaches for that we did NOT explicitly list below. That way
// when `deposits.ts` starts calling a new storage method, the test keeps
// running (and fails on a clear assertion) instead of crashing with a 500.

let reissueRow: any = null;
let createdReceiptPayload: any = null;
let createdReceipt: any = null;
const updatedReissuePayloads: any[] = [];

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getLetterReissueById: vi.fn(async () => reissueRow),
    createDepositReceipt: vi.fn(async (data: any) => {
      createdReceiptPayload = data;
      createdReceipt = { id: 999, ...data };
      return createdReceipt;
    }),
    updateLetterReissue: vi.fn(async (_id: number, data: any) => {
      updatedReissuePayloads.push(data);
      reissueRow = { ...(reissueRow ?? {}), ...data };
      return reissueRow;
    }),
    getDepositReceiptsByCaseId: vi.fn(async () => []),
    countDepositReceiptsByCaseId: vi.fn(async () => 0),
  }),
}));

// The upload route now sits behind requirePortalAccess + requireUnsealed
// (see server/routes/deposits.ts). For this unit test we bypass both —
// the focus here is the input-validation contract (data-URL guard,
// reissue ownership, paid/cancelled rounds, happy path), not the
// portal-session machinery exercised elsewhere.
vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
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

const VALID_DATA_URL =
  "data:image/png;base64," + "A".repeat(80);

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
  createdReceipt = null;
  updatedReissuePayloads.length = 0;
  reissueRow = { ...baseReissue };
});

describe("POST /api/cases/:id/deposit-receipts — user upload guards", () => {
  const app = buildApp();

  it("rejects an imageData that is not a base64 data URL with 400", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        imageData: "x".repeat(128), // long enough but missing the data: prefix
      });

    expect(res.status).toBe(400);
    expect(createdReceiptPayload).toBeNull();
    expect(updatedReissuePayloads).toHaveLength(0);
  });

  it("rejects a reissueId belonging to a different case with 400", async () => {
    reissueRow = { ...baseReissue, caseId: "case-OTHER" };

    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        imageData: VALID_DATA_URL,
        reissueId: 7,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not belong/i);
    expect(createdReceiptPayload).toBeNull();
    expect(updatedReissuePayloads).toHaveLength(0);
  });

  it("rejects a reissueId on an already-paid round with 400", async () => {
    reissueRow = { ...baseReissue, status: "paid" };

    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        imageData: VALID_DATA_URL,
        reissueId: 7,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no longer awaiting/i);
    expect(createdReceiptPayload).toBeNull();
    expect(updatedReissuePayloads).toHaveLength(0);
  });

  it("rejects a reissueId on a cancelled round with 400", async () => {
    reissueRow = { ...baseReissue, status: "cancelled" };

    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        imageData: VALID_DATA_URL,
        reissueId: 7,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no longer awaiting/i);
    expect(createdReceiptPayload).toBeNull();
    expect(updatedReissuePayloads).toHaveLength(0);
  });

  it("happy path: a valid reissue upload tags the round as awaiting_review with the new receipt id", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        imageData: VALID_DATA_URL,
        fileName: "receipt.png",
        reissueId: 7,
      });

    expect(res.status).toBe(200);
    expect(createdReceiptPayload).toMatchObject({
      caseId: "case-1",
      imageData: VALID_DATA_URL,
      fileName: "receipt.png",
      status: "pending",
      reissueId: 7,
    });

    expect(updatedReissuePayloads).toHaveLength(1);
    expect(updatedReissuePayloads[0]).toEqual({
      receiptId: createdReceipt.id,
      status: "awaiting_review",
    });

    expect(res.body).toMatchObject({
      id: createdReceipt.id,
      reissueId: 7,
      status: "pending",
    });
  });
});
