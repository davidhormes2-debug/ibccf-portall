import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { cases as CasesTable } from "@shared/schema";
import { createStorageMock } from "./helpers/storageMock";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// `baseCase` below hand-rolls `cases` columns. This Pick<> declaration fails
// `npm run check` if any referenced column is renamed in shared/schema.ts,
// preventing silent mock drift.
declare const _casesGuard: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "userName"
  | "userEmail"
  | "userMobile"
  | "userPin"
  | "status"
  | "letterSent"
  | "isDisabled"
  | "withdrawalGuideVisible"
  | "payoutWalletAddress"
  | "payoutWalletAsset"
  | "payoutWalletNetwork"
  | "payoutWalletNote"
  | "payoutWalletVerifiedAt"
  | "payoutWalletVerifiedBy"
  | "sealedAt"
  | "sealedBy"
  | "preferredLocale"
>;

// ---- Mocks ----------------------------------------------------------------

const auditLogs: any[] = [];

let storedCase: any = null;
let lastUpdatePayload: any = null;

// Bypass checkAdminAuth — all requests that supply any bearer token are
// treated as a valid admin session, matching the pattern used by other
// admin-mutation test suites in this directory. casesRouter PATCH /:id is
// also gated by requireAdminRole("admin") (see
// .agents/memory/admin-rbac-design.md), which reads req.adminRole — the real
// checkAdminAuth sets that from resolveAdminRoleFromUsername, so this stub
// must set it too or requireAdminRole falls back to "viewer" and every admin
// PATCH in this file 403s.
vi.mock("../routes/middleware", () => ({
  checkAdminAuth: (req: any, _res: any, next: any) => {
    req.adminRole = "admin";
    req.adminUsername = "admin";
    next();
  },
  isValidAdminToken: vi.fn(async () => true),
  checkIpNotBlocked: (_req: any, _res: any, next: any) => next(),
  normalizeIp: (ip: string) => ip,
  invalidateBlockedIpsCache: () => {},
}));

vi.mock("../db", () => ({ db: {} }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: "admin",
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getCaseById: vi.fn(async () => storedCase),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({})
    ),
    // Rate-limit helpers used by checkPinRateLimit / recordPinAttempt.
    getAdminLoginAttemptByKey: vi.fn(async () => null),
    clearAdminLoginAttemptKey: vi.fn(async () => {}),
    atomicIncrementRateLimit: vi.fn(async () => ({
      count: 1,
      resetAt: new Date(Date.now() + 60_000),
    })),
    isIpBlocked: vi.fn(async () => false),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async (_id: string, data: any) => {
      lastUpdatePayload = data;
      storedCase = { ...(storedCase ?? {}), ...data };
      return storedCase;
    }),
    createCase: vi.fn(),
    getAllCases: vi.fn(),
    getCaseByAccessCode: vi.fn(async () => storedCase),
    getCaseById: vi.fn(async () => storedCase),
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendLetterReadyEmail: vi.fn(async () => ({ success: true })),
    sendPayoutWalletEmail: vi.fn(async () => ({ success: true })),
  }),
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async () => ({ sent: true })),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

// Import AFTER vi.mock calls.
const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const baseCase = {
  id: "case-1",
  accessCode: "TEST-0001",
  userName: "Test User",
  userEmail: "user@example.com",
  userMobile: null,
  userPin: "123456",
  status: "active",
  letterSent: false,
  isDisabled: false,
  withdrawalGuideVisible: false,
  payoutWalletAddress: null,
  payoutWalletAsset: null,
  payoutWalletNetwork: null,
  payoutWalletNote: null,
  payoutWalletVerifiedAt: null,
  payoutWalletVerifiedBy: null,
  sealedAt: null,
  sealedBy: null,
  preferredLocale: "en",
};

beforeEach(() => {
  auditLogs.length = 0;
  lastUpdatePayload = null;
  storedCase = { ...baseCase };
});

// ---------------------------------------------------------------------------
// Admin PATCH — toggle withdrawalGuideVisible
// ---------------------------------------------------------------------------

describe("PATCH /api/cases/:id — withdrawalGuideVisible", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it("persists withdrawalGuideVisible: true when toggled on", async () => {
    storedCase = { ...baseCase, withdrawalGuideVisible: false };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ withdrawalGuideVisible: true });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload).toBeTruthy();
    expect(lastUpdatePayload).toHaveProperty("withdrawalGuideVisible", true);
  });

  it("persists withdrawalGuideVisible: false when toggled off", async () => {
    storedCase = { ...baseCase, withdrawalGuideVisible: true };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ withdrawalGuideVisible: false });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload).toHaveProperty("withdrawalGuideVisible", false);
  });

  it("allows the toggle on a sealed case (post-seal allowlist)", async () => {
    storedCase = {
      ...baseCase,
      sealedAt: new Date("2024-01-01T00:00:00Z"),
      sealedBy: "Admin",
      withdrawalGuideVisible: false,
    };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ withdrawalGuideVisible: true });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload).toHaveProperty("withdrawalGuideVisible", true);
  });

  it("rejects a sealed case PATCH that combines withdrawalGuideVisible with a disallowed field", async () => {
    storedCase = {
      ...baseCase,
      sealedAt: new Date("2024-01-01T00:00:00Z"),
      sealedBy: "Admin",
    };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ withdrawalGuideVisible: true, userName: "Hacker" });

    expect(res.status).toBe(423);
  });
});

// ---------------------------------------------------------------------------
// Admin GET /api/cases list — withdrawalGuideVisible present on every row
// ---------------------------------------------------------------------------

describe("GET /api/cases — withdrawalGuideVisible in admin list response", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it("includes withdrawalGuideVisible: false on rows where the banner is off", async () => {
    const { caseService } = await import("../services");
    vi.mocked(caseService.getAllCases).mockResolvedValueOnce([
      { ...baseCase, withdrawalGuideVisible: false },
    ] as any);

    const res = await request(app).get("/api/cases").set(auth);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toHaveProperty("withdrawalGuideVisible", false);
  });

  it("includes withdrawalGuideVisible: true on rows where the banner is on", async () => {
    const { caseService } = await import("../services");
    vi.mocked(caseService.getAllCases).mockResolvedValueOnce([
      { ...baseCase, withdrawalGuideVisible: true },
    ] as any);

    const res = await request(app).get("/api/cases").set(auth);

    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty("withdrawalGuideVisible", true);
  });

  it("includes withdrawalGuideVisible on every row in a multi-case list", async () => {
    const { caseService } = await import("../services");
    vi.mocked(caseService.getAllCases).mockResolvedValueOnce([
      { ...baseCase, id: "case-1", withdrawalGuideVisible: false },
      { ...baseCase, id: "case-2", withdrawalGuideVisible: true },
      { ...baseCase, id: "case-3", withdrawalGuideVisible: false },
    ] as any);

    const res = await request(app).get("/api/cases").set(auth);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    for (const row of res.body) {
      expect(row).toHaveProperty("withdrawalGuideVisible");
    }
    expect(res.body[1]).toHaveProperty("withdrawalGuideVisible", true);
  });

  it("does not include userPin in the list response", async () => {
    const { caseService } = await import("../services");
    vi.mocked(caseService.getAllCases).mockResolvedValueOnce([
      { ...baseCase, userPin: "hashed-secret", withdrawalGuideVisible: false },
    ] as any);

    const res = await request(app).get("/api/cases").set(auth);

    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty("userPin");
    expect(res.body[0]).toHaveProperty("withdrawalGuideVisible", false);
  });
});

// ---------------------------------------------------------------------------
// Portal GET — withdrawalGuideVisible in the allowlist
// ---------------------------------------------------------------------------

describe("GET /api/cases/access/:code — withdrawalGuideVisible in portal payload", () => {
  const app = buildApp();

  it("includes withdrawalGuideVisible: false in the portal response by default", async () => {
    storedCase = { ...baseCase, userPin: null, withdrawalGuideVisible: false };

    const res = await request(app).get("/api/cases/access/TEST-0001");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("withdrawalGuideVisible", false);
  });

  it("includes withdrawalGuideVisible: true once admin toggles it on", async () => {
    storedCase = { ...baseCase, userPin: null, withdrawalGuideVisible: true };

    const res = await request(app).get("/api/cases/access/TEST-0001");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("withdrawalGuideVisible", true);
  });

  it("round-trips: PATCH sets true, GET reflects the updated value", async () => {
    storedCase = { ...baseCase, userPin: null, withdrawalGuideVisible: false };

    const patchRes = await request(app)
      .patch("/api/cases/case-1")
      .set({ Authorization: "Bearer test-token" })
      .send({ withdrawalGuideVisible: true });
    expect(patchRes.status).toBe(200);

    const getRes = await request(app).get("/api/cases/access/TEST-0001");
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveProperty("withdrawalGuideVisible", true);
  });
});

// ---------------------------------------------------------------------------
// Task #366 — withdrawalGuideBody custom copy round-trip + post-seal + clear
// ---------------------------------------------------------------------------

describe("PATCH /api/cases/:id — withdrawalGuideBody (Task #366)", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it("persists a custom withdrawalGuideBody and the portal GET returns it", async () => {
    storedCase = { ...baseCase, userPin: null, withdrawalGuideBody: null };

    const customCopy =
      "Please re-verify your tax residency and upload a stamped FATCA form before the next review window.";

    const patchRes = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ withdrawalGuideBody: customCopy });

    expect(patchRes.status).toBe(200);
    expect(lastUpdatePayload).toHaveProperty("withdrawalGuideBody", customCopy);

    const getRes = await request(app).get("/api/cases/access/TEST-0001");
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveProperty("withdrawalGuideBody", customCopy);
  });

  it("allows withdrawalGuideBody on a sealed case (in POST_SEAL_ALLOWED set)", async () => {
    storedCase = {
      ...baseCase,
      sealedAt: new Date("2024-01-01T00:00:00Z"),
      sealedBy: "Admin",
      withdrawalGuideBody: null,
    };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ withdrawalGuideBody: "Sealed-case custom guidance copy." });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload).toHaveProperty(
      "withdrawalGuideBody",
      "Sealed-case custom guidance copy.",
    );
  });

  it("rejects a sealed case PATCH that combines withdrawalGuideBody with a disallowed field", async () => {
    storedCase = {
      ...baseCase,
      sealedAt: new Date("2024-01-01T00:00:00Z"),
      sealedBy: "Admin",
    };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ withdrawalGuideBody: "Custom copy.", userName: "Hacker" });

    expect(res.status).toBe(423);
  });

  it("clearing withdrawalGuideBody to null is persisted and reflected by the portal GET", async () => {
    storedCase = {
      ...baseCase,
      userPin: null,
      withdrawalGuideBody: "Some previously-set custom copy.",
    };

    const patchRes = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ withdrawalGuideBody: null });

    expect(patchRes.status).toBe(200);
    expect(lastUpdatePayload).toHaveProperty("withdrawalGuideBody", null);

    const getRes = await request(app).get("/api/cases/access/TEST-0001");
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveProperty("withdrawalGuideBody", null);
  });

  it("round-trips: PATCH sets custom body, GET returns the same string verbatim", async () => {
    storedCase = { ...baseCase, userPin: null, withdrawalGuideBody: null };

    const copy =
      "Line one of guidance.\nLine two with details.\nLine three with a final reminder.";

    const patchRes = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ withdrawalGuideBody: copy });
    expect(patchRes.status).toBe(200);

    const getRes = await request(app).get("/api/cases/access/TEST-0001");
    expect(getRes.status).toBe(200);
    expect(getRes.body.withdrawalGuideBody).toBe(copy);
  });
});
