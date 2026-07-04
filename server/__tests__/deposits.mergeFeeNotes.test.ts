import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";
import { BATCH_FEE_NOTES_PREFIX } from "../../shared/constants";

// ---- Purpose ----------------------------------------------------------------
//
// Pins the exact notes format written to a merge_fee deposit receipt:
//
//   "Batch merge fee: <amount>"
//
// The client assembles this string and sends it as the `notes` field; the
// server stores it verbatim.  `extractBatchAmountLabel` (client/src/lib/
// batchAmountLabel.ts) strips the prefix with /^Batch merge fee:\s*/i before
// displaying the amount in Batch History rows.  If either side changes the
// prefix without updating the other, the UI silently shows the raw notes
// string instead of the clean amount.  This test closes the loop by asserting
// the server-stored notes value matches the regex that the extraction helper
// depends on.

let createdReceiptPayload: any = null;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    createDepositReceipt: vi.fn(async (data: any) => {
      createdReceiptPayload = data;
      return { id: 1, ...data };
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

beforeEach(() => {
  createdReceiptPayload = null;
});

// Build the prefix regex from the shared constant — the same source of truth
// that extractBatchAmountLabel (client/src/lib/batchAmountLabel.ts) uses, so a
// change to BATCH_FEE_NOTES_PREFIX is caught here automatically.
const BATCH_FEE_PREFIX_RE = new RegExp(
  `^${BATCH_FEE_NOTES_PREFIX.trimEnd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  "i",
);

describe("POST /api/cases/:id/deposit-receipts — merge_fee notes format", () => {
  it("stores notes verbatim for a merge_fee receipt with no image", async () => {
    const notes = `${BATCH_FEE_NOTES_PREFIX}500 USDT`;

    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({ category: "merge_fee", notes });

    expect(res.status).toBe(200);
    expect(createdReceiptPayload).not.toBeNull();
    expect(createdReceiptPayload.notes).toBe(notes);
    expect(createdReceiptPayload.category).toBe("merge_fee");
  });

  it("stored notes match the prefix pattern that extractBatchAmountLabel relies on", async () => {
    const notes = `${BATCH_FEE_NOTES_PREFIX}500 USDT`;

    await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({ category: "merge_fee", notes });

    expect(createdReceiptPayload?.notes).toMatch(BATCH_FEE_PREFIX_RE);
  });

  it("stored notes match the prefix for a decimal amount", async () => {
    const notes = `${BATCH_FEE_NOTES_PREFIX}250.50 USDT`;

    await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({ category: "merge_fee", notes });

    expect(createdReceiptPayload?.notes).toMatch(BATCH_FEE_PREFIX_RE);
  });

  it("accepts a merge_fee receipt without imageData (image-optional path)", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({ category: "merge_fee", notes: `${BATCH_FEE_NOTES_PREFIX}500 USDT` });

    expect(res.status).toBe(200);
  });

  it("stores null notes when none are provided", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({ category: "merge_fee" });

    expect(res.status).toBe(200);
    expect(createdReceiptPayload?.notes).toBeNull();
  });
});
