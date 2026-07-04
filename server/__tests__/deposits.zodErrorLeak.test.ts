import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Zod Validation-Leak Tests — deposits routes
//
// Three admin routes (PATCH /:id, PATCH /:id/status, GET /all-receipts) and
// one portal route (POST /api/cases/:id/deposit-receipts) parse their inputs
// with Zod. These tests confirm that a malformed payload is rejected with a
// plain string error and never exposes raw ZodError internals to the caller.
// ============================================================================

const TEST_ADMIN_USERNAME = "deposits-zodleak-test-admin";
let savedAdminUsername: string | undefined;

beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});

afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
  }),
}));

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async () => true),
}));

const { depositsRouter, registerCaseDepositRoutes } = await import(
  "../routes/deposits"
);

function buildAdminApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/deposits", depositsRouter);
  return app;
}

function buildPortalApp() {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const router = Router();
  registerCaseDepositRoutes(router);
  app.use("/api/cases", router);
  return app;
}

// ── Helper ───────────────────────────────────────────────────────────────────
function assertNoZodLeak(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/ZodError/i);
  expect(text).not.toMatch(/"errors":\s*\[/);
  expect(text).not.toMatch(/"issues":\s*\[/);
  expect(text).not.toMatch(/"path":/);
  expect(text).not.toMatch(/"code":/);
  expect(text).not.toMatch(/"minimum":/);
  expect(text).not.toMatch(/"maximum":/);
  expect(text).not.toMatch(/"expected":/);
  expect(text).not.toMatch(/"received":/);
}

// ── PATCH /api/deposits/:id ───────────────────────────────────────────────────
describe("PATCH /api/deposits/:id — Zod error not leaked on invalid input", () => {
  it("returns a plain string error when status is an invalid enum value", async () => {
    const app = buildAdminApp();
    const res = await request(app)
      .patch("/api/deposits/1")
      .set("Authorization", "Bearer test-token")
      .send({ status: "not_a_valid_status" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when body contains an invalid type for adminNotes", async () => {
    const app = buildAdminApp();
    const res = await request(app)
      .patch("/api/deposits/1")
      .set("Authorization", "Bearer test-token")
      .send({ status: 123 });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── PATCH /api/deposits/:id/status ───────────────────────────────────────────
describe("PATCH /api/deposits/:id/status — Zod error not leaked on invalid input", () => {
  it("returns a plain string error when status is an invalid enum value", async () => {
    const app = buildAdminApp();
    const res = await request(app)
      .patch("/api/deposits/1/status")
      .set("Authorization", "Bearer test-token")
      .send({ status: "invalid_value" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when status is missing", async () => {
    const app = buildAdminApp();
    const res = await request(app)
      .patch("/api/deposits/1/status")
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── GET /api/deposits/all-receipts ───────────────────────────────────────────
describe("GET /api/deposits/all-receipts — Zod error not leaked on invalid query", () => {
  it("returns a plain string error when status query param is invalid", async () => {
    const app = buildAdminApp();
    const res = await request(app)
      .get("/api/deposits/all-receipts?status=NOT_VALID")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when category query param is invalid", async () => {
    const app = buildAdminApp();
    const res = await request(app)
      .get("/api/deposits/all-receipts?category=bad_category")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when limit is non-numeric", async () => {
    const app = buildAdminApp();
    const res = await request(app)
      .get("/api/deposits/all-receipts?limit=not_a_number")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});

// ── POST /api/cases/:id/deposit-receipts ──────────────────────────────────────
describe("POST /api/cases/:id/deposit-receipts — Zod error not leaked on invalid input", () => {
  it("returns a plain string error when imageData is too short", async () => {
    const app = buildPortalApp();
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({ imageData: "short" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when category is an invalid enum value", async () => {
    const app = buildPortalApp();
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        imageData: "data:image/png;base64," + "A".repeat(100),
        category: "not_valid_category",
      });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when notes exceeds max length", async () => {
    const app = buildPortalApp();
    const res = await request(app)
      .post("/api/cases/case-1/deposit-receipts")
      .send({
        imageData: "data:image/png;base64," + "A".repeat(100),
        notes: "N".repeat(2001),
      });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});
