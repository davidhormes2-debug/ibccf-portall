import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "akr-approval-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---- Test state ----------------------------------------------------------

// Queue of results returned by db.select().from().where() in call order.
const dbSelectQueue: any[][] = [];
let dbSelectCallIdx = 0;

// Captures payloads written inside db.transaction.
const txSetCalls: any[] = [];
let txUpdateCallCount = 0;
let txInsertPayload: any = null;

const sendKeyApprovalNotification = vi.fn(async () => true);
const deleteSessionsByCaseId = vi.fn(async () => {});

// ---- Helpers -------------------------------------------------------------

function queueSelect(...rows: any[]) {
  dbSelectQueue.push(rows);
}

function resetDbState() {
  dbSelectQueue.length = 0;
  dbSelectCallIdx = 0;
  txSetCalls.length = 0;
  txUpdateCallCount = 0;
  txInsertPayload = null;
}

// ---- Module mocks --------------------------------------------------------

// The tx mock is shared across tests; state is reset in beforeEach.
const txMock = {
  update: vi.fn().mockImplementation((_table: any) => ({
    set: vi.fn().mockImplementation((data: any) => {
      txSetCalls.push(data);
      txUpdateCallCount++;
      return {
        where: vi.fn().mockReturnValue({
          // Return the payload as the updated row so the route can spread it.
          returning: vi.fn().mockResolvedValue([{ id: 999, ...data }]),
        }),
      };
    }),
  })),
  insert: vi.fn().mockImplementation((_table: any) => ({
    values: vi.fn().mockImplementation((data: any) => {
      txInsertPayload = data;
      return {
        returning: vi.fn().mockResolvedValue([{ id: "new-case-id", ...data }]),
      };
    }),
  })),
};

vi.mock("../db", () => ({
  db: {
    select: vi.fn().mockImplementation((_fields?: any) => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const result = dbSelectQueue[dbSelectCallIdx] ?? [];
          dbSelectCallIdx++;
          return Promise.resolve(result);
        }),
      }),
    })),
    transaction: vi.fn().mockImplementation(
      async (fn: (tx: any) => Promise<any>) => fn(txMock),
    ),
  },
}));

// Storage mock is needed for checkAdminAuth middleware.
vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (_token: string) => ({
      id: "session-akr-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
  }),
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({ sendKeyApprovalNotification }),
}));

vi.mock("../services/session-store", () => ({
  deleteSessionsByCaseId,
}));

// Import AFTER vi.mock calls.
const { accessKeyRequestsRouter } = await import("../routes/access-key-requests");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/access-key-requests", accessKeyRequestsRouter);
  return app;
}

const basePortalRequest = {
  id: 1,
  requestId: "REQ-TEST001",
  status: "pending",
  caseId: "case-portal-001",
  userName: "Portal User",
  userEmail: "portal@example.com",
  userPhone: null,
  generatedKey: "STALE-KEY-0001",
  adminMessages: null,
  adminUsername: null,
  approvedAt: null,
};

const baseNonPortalRequest = {
  ...basePortalRequest,
  id: 2,
  caseId: null,
  generatedKey: "STALE-KEY-0002",
};

beforeEach(() => {
  resetDbState();
  sendKeyApprovalNotification.mockClear();
  deleteSessionsByCaseId.mockClear();
  txMock.update.mockClear();
  txMock.insert.mockClear();
});

const auth = { Authorization: "Bearer test-token" };

describe("POST /api/access-key-requests/admin/:id/approve — stored-vs-emailed contract", () => {
  const app = buildApp();

  it("(a) portal path: uses a freshly-generated code, not the stale generatedKey, for both the case update and the email", async () => {
    // Queue: request lookup, collision check (no collision), email lookup.
    queueSelect(basePortalRequest);
    queueSelect(); // collision check → no collision
    queueSelect({ userEmail: "portal@example.com" }); // email lookup after tx

    const res = await request(app)
      .post("/api/access-key-requests/admin/1/approve")
      .set(auth)
      .send({ adminUsername: TEST_ADMIN_USERNAME });

    expect(res.status).toBe(200);

    // Flush the async email .then() callback.
    await new Promise((r) => setTimeout(r, 20));

    // Two tx.update calls: one for cases, one for accessKeyRequests.
    expect(txSetCalls).toHaveLength(2);
    const casesSetPayload = txSetCalls[0];
    const requestSetPayload = txSetCalls[1];

    // The case was updated with a new access code.
    expect(casesSetPayload.accessCode).toBeTruthy();
    expect(typeof casesSetPayload.accessCode).toBe("string");
    expect(casesSetPayload.accessCode).toHaveLength(12);

    // The fresh code must NOT equal the old generatedKey.
    expect(casesSetPayload.accessCode).not.toBe(basePortalRequest.generatedKey);

    // The request row was updated with the same fresh code (audit record).
    expect(requestSetPayload.generatedKey).toBe(casesSetPayload.accessCode);

    // The email was sent with the exact same fresh code.
    expect(sendKeyApprovalNotification).toHaveBeenCalledOnce();
    const emailedCode = sendKeyApprovalNotification.mock.calls[0][2];
    expect(emailedCode).toBe(casesSetPayload.accessCode);
  });

  it("(b) non-portal path: creates a new case with the fresh code and emails the same code", async () => {
    // Queue: request lookup, collision check (no collision).
    // Non-portal path does NOT do an email lookup after the tx (uses request.userEmail directly).
    queueSelect(baseNonPortalRequest);
    queueSelect(); // collision check → no collision

    const res = await request(app)
      .post("/api/access-key-requests/admin/2/approve")
      .set(auth)
      .send({ adminUsername: TEST_ADMIN_USERNAME });

    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 20));

    // One tx.insert (case creation) + one tx.update (request status).
    expect(txInsertPayload).toBeTruthy();
    expect(txInsertPayload.accessCode).toBeTruthy();
    expect(txInsertPayload.accessCode).toHaveLength(12);
    expect(txInsertPayload.accessCode).not.toBe(baseNonPortalRequest.generatedKey);

    // accessKeyRequests was updated with the same fresh code.
    const requestSetPayload = txSetCalls[0];
    expect(requestSetPayload.generatedKey).toBe(txInsertPayload.accessCode);

    // Email used the same fresh code.
    expect(sendKeyApprovalNotification).toHaveBeenCalledOnce();
    const emailedCode = sendKeyApprovalNotification.mock.calls[0][2];
    expect(emailedCode).toBe(txInsertPayload.accessCode);
  });

  it("(c) collision-retry: retries when first candidate collides and succeeds on second attempt", async () => {
    // Queue: request lookup, collision (attempt 0), no collision (attempt 1), email lookup.
    queueSelect(basePortalRequest);
    queueSelect({ id: "other-case" }); // attempt 0: collision
    queueSelect();                      // attempt 1: free
    queueSelect({ userEmail: "portal@example.com" }); // email lookup

    const res = await request(app)
      .post("/api/access-key-requests/admin/1/approve")
      .set(auth)
      .send({ adminUsername: TEST_ADMIN_USERNAME });

    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 20));

    // Three db.select calls consumed: request + 2 collision checks.
    // (Email lookup was the 4th.)
    expect(dbSelectCallIdx).toBeGreaterThanOrEqual(3);

    // A valid code was still written.
    expect(txSetCalls[0].accessCode).toMatch(/^[0-9]{12}$/);
  });

  it("(d) returns 500 when all 5 collision-retry attempts fail", async () => {
    // Queue: request lookup, then 5 consecutive collisions.
    queueSelect(basePortalRequest);
    for (let i = 0; i < 5; i++) {
      queueSelect({ id: `other-case-${i}` });
    }

    const res = await request(app)
      .post("/api/access-key-requests/admin/1/approve")
      .set(auth)
      .send({ adminUsername: TEST_ADMIN_USERNAME });

    expect(res.status).toBe(500);
    expect(sendKeyApprovalNotification).not.toHaveBeenCalled();
  });

  it("(e) returns 404 when the request does not exist", async () => {
    queueSelect(); // request lookup → not found

    const res = await request(app)
      .post("/api/access-key-requests/admin/99/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(404);
  });

  it("(f) returns 400 when the request is not pending", async () => {
    queueSelect({ ...basePortalRequest, status: "approved" });

    const res = await request(app)
      .post("/api/access-key-requests/admin/1/approve")
      .set(auth)
      .send({});

    expect(res.status).toBe(400);
  });
});
