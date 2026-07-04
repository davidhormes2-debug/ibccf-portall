import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ── Purpose ───────────────────────────────────────────────────────────────────
//
// These tests exercise the admin notification fired by the merge-fee
// fast-path WITHOUT a global NotificationService stub.  The real
// NotificationService class runs end-to-end; only storage.createNotification
// is captured.  This catches regressions where:
//
//   • The dynamic `import("../services/NotificationService")` path drifts
//     (wrong module path, renamed export, etc.).
//   • The `notifyAdmin` call-site signature changes (wrong argument order,
//     missing arg, wrong type literal, etc.).
//   • `notifyAdmin` forgets to delegate through `createNotification`.
//
// If any of those invariants break the test will fail with a clear assertion
// message rather than the "notifyAdmin was called N times" check that the
// module-level-stub tests provide.

// ── Storage mock ──────────────────────────────────────────────────────────────

let targetReceipt: any = null;
let createNotificationPayload: any = null;

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
    updateDepositReceipt: vi.fn(async (_id: number, data: any) => ({
      ...UPDATED_ROW,
      ...data,
    })),
    createDepositReceipt: vi.fn(async (data: any) => ({ id: 99, ...data })),
    countDepositReceiptsByCaseId: vi.fn(async () => 0),
    getDepositReceiptsByCaseId: vi.fn(async () => []),
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
// above.  This lets the full code path execute so import-path or signature drift
// is caught at test time.

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
  createNotificationPayload = null;
  const { storage } = await import("../storage");
  vi.mocked(storage.getDepositReceiptById).mockClear();
  vi.mocked(storage.updateDepositReceipt).mockClear();
  vi.mocked(storage.createNotification).mockClear();
});

// Helper: give the fire-and-forget microtask queue enough time to settle.
const flushAsync = () => new Promise((r) => setTimeout(r, 30));

describe("POST /api/cases/:id/deposit-receipts — notification payload (real NotificationService)", () => {
  // ── 1. Exact createNotification payload ──────────────────────────────────
  it("calls storage.createNotification with the exact admin notification payload", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        receiptId: 42,
        category: "merge_fee",
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);

    // Allow the fire-and-forget async block to complete.
    await flushAsync();

    const { storage } = await import("../storage");
    expect(storage.createNotification).toHaveBeenCalledOnce();
    expect(createNotificationPayload).toEqual({
      recipientType: "admin",
      recipientId: "admin",
      type: "receipt_uploaded",
      title: "New Receipt Uploaded",
      body: "Case case-1 submitted a merge fee deposit receipt.",
      link: "/admin",
    });
  });

  // ── 2. Case ID is correctly interpolated in the notification body ────────
  it("interpolates the correct case ID into the notification body", async () => {
    // Use a different case ID to confirm the variable is read from req.params.id,
    // not hard-coded.  Adjust targetReceipt to match.
    const { storage } = await import("../storage");
    vi.mocked(storage.getDepositReceiptById).mockImplementationOnce(async () => ({
      ...BASE_PLACEHOLDER,
      caseId: "case-99",
    }) as any);

    const res = await request(app)
      .post("/api/cases/case-99/deposit-receipts")
      .send({
        receiptId: 42,
        category: "merge_fee",
        imageData: VALID_DATA_URL,
      });

    expect(res.status).toBe(200);
    await flushAsync();

    expect(storage.createNotification).toHaveBeenCalledOnce();
    expect(createNotificationPayload).toMatchObject({
      body: "Case case-99 submitted a merge fee deposit receipt.",
    });
  });

  // ── 3. notifyAdmin throws — must not bubble up to the HTTP response ───────
  it("returns HTTP 200 even when storage.createNotification rejects (fire-and-forget error suppression)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.createNotification).mockRejectedValueOnce(
      new Error("DB connection lost"),
    );

    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        receiptId: 42,
        category: "merge_fee",
        imageData: VALID_DATA_URL,
      });

    // The response must be sent before the notification resolves/rejects.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 42, category: "merge_fee" });

    // Let the background task finish (and throw) without crashing the test.
    await flushAsync();

    // Confirm the notification was attempted despite the eventual rejection.
    expect(storage.createNotification).toHaveBeenCalledOnce();
  });
});
