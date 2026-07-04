import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---- Admin auth env setup --------------------------------------------------

const TEST_ADMIN_USERNAME = "active-warnings-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---- Mocks -----------------------------------------------------------------

let allCases: any[] = [];

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (_token: string) => ({
      id: "session-aw-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getAllCases: vi.fn(async () => allCases),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(),
    createCase: vi.fn(),
    getAllCases: vi.fn(),
    getCaseByAccessCode: vi.fn(),
    getCaseById: vi.fn(),
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({ sendPortalWarning: vi.fn() }),
}));
vi.mock("../services/emailNotify", () => ({
  resolveRecipientLocale: vi.fn(async () => "en"),
  sendCaseEmailWithAudit: vi.fn(async () => ({ sent: true })),
}));
vi.mock("../services/pathwayReset", () => ({
  disableAndResetPathway: vi.fn(async () => {}),
  resetWithdrawalPathway: vi.fn(async () => {}),
}));

// ---- App setup -------------------------------------------------------------

const { casesRouter } = await import("../routes/cases");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use("/api/cases", casesRouter);

const auth = { Authorization: "Bearer test-token" };

// ---- Fixtures --------------------------------------------------------------

const NOW = Date.now();

function makeCase(overrides: Record<string, any> = {}) {
  return {
    id: "case-aw-default",
    accessCode: "AWRN-0001",
    userName: "Test User",
    userEmail: "test@example.com",
    status: "active",
    isDisabled: false,
    portalWarningAt: null,
    portalWarningMinutes: null,
    portalWarningMessage: null,
    ...overrides,
  };
}

beforeEach(() => {
  allCases = [];
});

// ---- GET /active-warnings tests --------------------------------------------

describe("GET /api/cases/active-warnings", () => {
  it("(a) returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get("/api/cases/active-warnings");
    expect(res.status).toBe(401);
  });

  it("(b) returns empty state when there are no cases at all", async () => {
    allCases = [];
    const res = await request(app).get("/api/cases/active-warnings").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.cases).toEqual([]);
  });

  it("(c) returns empty state when no cases have portalWarningAt set", async () => {
    allCases = [
      makeCase({ id: "case-1", portalWarningAt: null }),
      makeCase({ id: "case-2", portalWarningAt: null }),
    ];
    const res = await request(app).get("/api/cases/active-warnings").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.cases).toEqual([]);
  });

  it("(d) excludes disabled cases even when they have portalWarningAt set", async () => {
    allCases = [
      makeCase({
        id: "case-disabled",
        isDisabled: true,
        portalWarningAt: new Date(NOW - 60_000),
        portalWarningMinutes: 30,
      }),
    ];
    const res = await request(app).get("/api/cases/active-warnings").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.cases).toEqual([]);
  });

  it("(e) returns only non-disabled cases that have portalWarningAt set", async () => {
    const warningAt = new Date(NOW - 60_000);
    allCases = [
      makeCase({
        id: "case-active-warning",
        portalWarningAt: warningAt,
        portalWarningMinutes: 30,
      }),
      makeCase({ id: "case-no-warning", portalWarningAt: null }),
      makeCase({
        id: "case-disabled-warning",
        isDisabled: true,
        portalWarningAt: warningAt,
        portalWarningMinutes: 30,
      }),
    ];
    const res = await request(app).get("/api/cases/active-warnings").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.cases).toHaveLength(1);
    expect(res.body.cases[0].id).toBe("case-active-warning");
  });

  it("(f) calculates expiresAt correctly as portalWarningAt + minutes", async () => {
    const startedAt = new Date(NOW - 2 * 60 * 1000);
    const minutes = 10;
    const expectedExpiresAt = new Date(
      startedAt.getTime() + minutes * 60 * 1000,
    ).toISOString();

    allCases = [
      makeCase({
        id: "case-expiry",
        portalWarningAt: startedAt,
        portalWarningMinutes: minutes,
      }),
    ];

    const res = await request(app).get("/api/cases/active-warnings").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.cases[0].expiresAt).toBe(expectedExpiresAt);
  });

  it("(g) calculates msLeft as positive time remaining when warning is not yet expired", async () => {
    const minutesRemaining = 10;
    const startedAt = new Date(NOW - 5 * 60 * 1000);
    const totalMinutes = 15;

    allCases = [
      makeCase({
        id: "case-ms-left",
        portalWarningAt: startedAt,
        portalWarningMinutes: totalMinutes,
      }),
    ];

    const before = Date.now();
    const res = await request(app).get("/api/cases/active-warnings").set(auth);
    const after = Date.now();

    expect(res.status).toBe(200);
    const { msLeft } = res.body.cases[0];
    expect(msLeft).toBeGreaterThan(0);
    const expectedMs =
      startedAt.getTime() + totalMinutes * 60 * 1000 - before;
    expect(msLeft).toBeLessThanOrEqual(expectedMs + (after - before) + 50);
    expect(msLeft).toBeGreaterThan(minutesRemaining * 60 * 1000 - 5000);
  });

  it("(h) clamps msLeft to 0 when the warning has already expired", async () => {
    const startedAt = new Date(NOW - 60 * 60 * 1000);
    allCases = [
      makeCase({
        id: "case-expired",
        portalWarningAt: startedAt,
        portalWarningMinutes: 5,
      }),
    ];

    const res = await request(app).get("/api/cases/active-warnings").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.cases[0].msLeft).toBe(0);
  });

  it("(i) sorts cases by msLeft ascending (soonest-to-expire first)", async () => {
    const soon = new Date(NOW - 9 * 60 * 1000);
    const later = new Date(NOW - 1 * 60 * 1000);
    allCases = [
      makeCase({
        id: "case-later",
        portalWarningAt: later,
        portalWarningMinutes: 20,
      }),
      makeCase({
        id: "case-soon",
        portalWarningAt: soon,
        portalWarningMinutes: 10,
      }),
    ];

    const res = await request(app).get("/api/cases/active-warnings").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.cases[0].id).toBe("case-soon");
    expect(res.body.cases[1].id).toBe("case-later");
    expect(res.body.cases[0].msLeft).toBeLessThanOrEqual(
      res.body.cases[1].msLeft,
    );
  });

  it("(j) includes the expected fields in each returned case", async () => {
    const warningAt = new Date(NOW - 60_000);
    allCases = [
      makeCase({
        id: "case-fields",
        accessCode: "AWRN-0042",
        userName: "Field User",
        userEmail: "field@example.com",
        portalWarningAt: warningAt,
        portalWarningMinutes: 30,
      }),
    ];

    const res = await request(app).get("/api/cases/active-warnings").set(auth);
    expect(res.status).toBe(200);
    const c = res.body.cases[0];
    expect(c).toHaveProperty("id", "case-fields");
    expect(c).toHaveProperty("accessCode", "AWRN-0042");
    expect(c).toHaveProperty("userName", "Field User");
    expect(c).toHaveProperty("userEmail", "field@example.com");
    expect(c).toHaveProperty("portalWarningMinutes", 30);
    expect(c).toHaveProperty("expiresAt");
    expect(c).toHaveProperty("msLeft");
  });

  it("(k) handles userEmail being null gracefully", async () => {
    const warningAt = new Date(NOW - 60_000);
    allCases = [
      makeCase({
        id: "case-no-email",
        userEmail: null,
        portalWarningAt: warningAt,
        portalWarningMinutes: 10,
      }),
    ];

    const res = await request(app).get("/api/cases/active-warnings").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.cases[0].userEmail).toBeNull();
  });

  it("(l) sorts three cases in correct msLeft ascending order", async () => {
    const t1 = new Date(NOW - 18 * 60 * 1000);
    const t2 = new Date(NOW - 5 * 60 * 1000);
    const t3 = new Date(NOW - 1 * 60 * 1000);
    allCases = [
      makeCase({ id: "case-mid", portalWarningAt: t2, portalWarningMinutes: 10 }),
      makeCase({ id: "case-last", portalWarningAt: t3, portalWarningMinutes: 60 }),
      makeCase({ id: "case-first", portalWarningAt: t1, portalWarningMinutes: 20 }),
    ];

    const res = await request(app).get("/api/cases/active-warnings").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    const ids = res.body.cases.map((c: any) => c.id);
    expect(ids[0]).toBe("case-first");
    expect(ids[1]).toBe("case-mid");
    expect(ids[2]).toBe("case-last");
  });
});
