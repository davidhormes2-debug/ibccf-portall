import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ── Purpose ───────────────────────────────────────────────────────────────────
//
// These tests exercise the admin notification fired by the NORMAL receipt
// creation path (storage.createDepositReceipt, lines 707-714 in
// server/routes/deposits.ts) WITHOUT a global NotificationService stub.  The
// real NotificationService class runs end-to-end; only storage.createNotification
// is captured.  This catches regressions where:
//
//   • The dynamic `import("../services/NotificationService")` path drifts
//     (wrong module path, renamed export, etc.).
//   • The label interpolation logic (reissue/other/merge_fee/token_deposit/
//     activation) produces the wrong string for a given category.
//   • The `notifyAdmin` call-site signature changes (wrong argument order,
//     missing arg, wrong type literal, etc.).
//   • `notifyAdmin` forgets to delegate through `createNotification`.
//   • The fire-and-forget block stops swallowing errors in the normal path.
//
// Contrast with deposits.uploadProofNotification.test.ts which covers the
// merge-fee fast-path (update of an existing placeholder receipt).

// ── Storage mock ──────────────────────────────────────────────────────────────

let createNotificationPayload: any = null;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    createDepositReceipt: vi.fn(async (data: any) => ({
      id: 101,
      status: "pending",
      uploadedAt: new Date().toISOString(),
      ...data,
    })),
    countDepositReceiptsByCaseId: vi.fn(async () => 0),
    // Needed by the reissue category path — returns a valid, unpaid round.
    getLetterReissueById: vi.fn(async (id: number) => ({
      id,
      caseId: "case-1",
      status: "pending",
    })),
    // Real NotificationService.notifyAdmin delegates to storage.createNotification.
    // Capture the exact payload so we can assert on the full shape.
    createNotification: vi.fn(async (data: any) => {
      createNotificationPayload = data;
      return { id: 1, ...data, createdAt: new Date().toISOString(), readAt: null };
    }),
  }),
}));

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
}));

// ── NOTE: NotificationService is intentionally NOT mocked here ────────────────
// The real class is imported dynamically by the route's fire-and-forget block.
// Its notifyAdmin() method calls storage.createNotification(), which IS mocked
// above.  This lets the full code path execute so import-path or label-string
// drift is caught at test time.

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

beforeEach(async () => {
  createNotificationPayload = null;
  const { storage } = await import("../storage");
  vi.mocked(storage.createDepositReceipt).mockClear();
  vi.mocked(storage.countDepositReceiptsByCaseId).mockClear();
  vi.mocked(storage.createNotification).mockClear();
  vi.mocked(storage.getLetterReissueById).mockClear();
});

// Helper: give the fire-and-forget microtask queue enough time to settle.
const flushAsync = () => new Promise((r) => setTimeout(r, 30));

describe("POST /api/cases/:id/deposit-receipts (normal creation path) — notification payload (real NotificationService)", () => {
  // ── 1. activation category — exact createNotification payload ───────────
  it("calls storage.createNotification with the exact payload for activation category", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        category: "activation",
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);

    await flushAsync();

    const { storage } = await import("../storage");
    expect(storage.createNotification).toHaveBeenCalledOnce();
    expect(createNotificationPayload).toEqual({
      recipientType: "admin",
      recipientId: "admin",
      type: "receipt_uploaded",
      title: "New Receipt Uploaded",
      body: "Case case-1 submitted a activation deposit receipt.",
      link: "/admin",
    });
  });

  // ── 2. reissue category — label must read "reissue fee" ──────────────────
  it("calls storage.createNotification with the 'reissue fee' label for reissue category", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        category: "reissue",
        reissueId: 7,
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);

    await flushAsync();

    const { storage } = await import("../storage");
    expect(storage.createNotification).toHaveBeenCalledOnce();
    expect(createNotificationPayload).toMatchObject({
      body: "Case case-1 submitted a reissue fee deposit receipt.",
    });
  });

  // ── 3. Case ID is correctly interpolated from req.params.id ─────────────
  it("interpolates the correct case ID into the notification body", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getLetterReissueById).mockImplementationOnce(
      async (id: number) => ({ id, caseId: "case-77", status: "pending" } as unknown as Awaited<ReturnType<typeof storage.getLetterReissueById>>),
    );

    const res = await request(app)
      .post("/api/cases/case-77/deposit-receipts")
      .send({
        category: "activation",
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);

    await flushAsync();

    expect(storage.createNotification).toHaveBeenCalledOnce();
    expect(createNotificationPayload).toMatchObject({
      body: "Case case-77 submitted a activation deposit receipt.",
    });
  });

  // ── 4. other category — label must read "other" ──────────────────────────
  it("calls storage.createNotification with the 'other' label for other category", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        category: "other",
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);

    await flushAsync();

    const { storage } = await import("../storage");
    expect(storage.createNotification).toHaveBeenCalledOnce();
    expect(createNotificationPayload).toMatchObject({
      body: "Case case-1 submitted a other deposit receipt.",
    });
  });

  // ── 5. token_deposit category — label must read "token deposit" ───────────
  it("calls storage.createNotification with the 'token deposit' label for token_deposit category", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        category: "token_deposit",
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);

    await flushAsync();

    const { storage } = await import("../storage");
    expect(storage.createNotification).toHaveBeenCalledOnce();
    expect(createNotificationPayload).toMatchObject({
      body: "Case case-1 submitted a token deposit deposit receipt.",
    });
  });

  // ── 6. notifyAdmin throws — must not bubble up to the HTTP response ──────
  it("returns HTTP 200 even when storage.createNotification rejects (fire-and-forget error suppression)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.createNotification).mockRejectedValueOnce(
      new Error("DB connection lost"),
    );

    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        category: "activation",
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 101, category: "activation" });

    // Let the background task finish (and throw) without crashing the test.
    await flushAsync();

    // Confirm the notification was attempted despite the eventual rejection.
    expect(storage.createNotification).toHaveBeenCalledOnce();
  });
});
