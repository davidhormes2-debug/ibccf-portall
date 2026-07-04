import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Admin "Open as User" mirror — portal-session handoff
//
// Regression coverage for Task #116: POST /api/admin/cases/redeem-mirror-token
// must mint a real portal session token so the mirrored tab can call
// GET /api/cases/access/:code (which requires a session once a PIN is set).
// Without it, "Open as User" used to bounce the admin back to the public
// access-code login screen.
//
// This file guards:
//   1. A freshly minted, single-use mirror token redeems for a
//      `portalSessionToken` that `validateSession()` accepts for the same
//      case + access code.
//   2. Invalid / unknown / already-redeemed tokens 404 and do NOT mint a
//      portal session.
//   3. Both `admin_mirror_token_issued` (mint) and
//      `admin_mirror_token_redeemed` (redeem) audit rows are still written.
// ============================================================================

const ADMIN_TOKEN = "admin-token-test";
const CASE_ID = "case-mirror-1";
const ACCESS_CODE = "MIRROR-CODE-1";

const TEST_ADMIN_USERNAME = "admin-mirror-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

const auditLogs: any[] = [];
// Shared "Postgres" stand-in for admin_mirror_tokens. Both the in-process
// router and the cross-instance test read/write through this map, which
// mirrors how the real DatabaseStorage methods share a Postgres table
// across autoscale instances.
const mirrorTokenStore = new Map<string, any>();
// Same shared-state pattern for portal_sessions (Task #123).
const portalSessionStore = new Map<string, any>();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? {
            id: "session-1",
            isActive: true,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            adminUsername: TEST_ADMIN_USERNAME,
          }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    runInTransaction: vi.fn(async (fn: any) => fn({})),
    getCaseById: vi.fn(async (id: string) =>
      id === CASE_ID
        ? { id: CASE_ID, accessCode: ACCESS_CODE }
        : null,
    ),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    createMirrorToken: vi.fn(async (data: any) => {
      const row = { ...data };
      mirrorTokenStore.set(data.token, row);
      return row;
    }),
    consumeMirrorToken: vi.fn(async (token: string) => {
      const row = mirrorTokenStore.get(token);
      if (!row) return undefined;
      mirrorTokenStore.delete(token);
      return row;
    }),
    deleteExpiredMirrorTokens: vi.fn(async (now: Date = new Date()) => {
      let removed = 0;
      for (const [token, row] of mirrorTokenStore.entries()) {
        if (row.expiresAt instanceof Date && row.expiresAt.getTime() < now.getTime()) {
          mirrorTokenStore.delete(token);
          removed++;
        }
      }
      return removed;
    }),
    createPortalSession: vi.fn(async (data: any) => {
      const row = { ...data, createdAt: new Date() };
      portalSessionStore.set(data.token, row);
      return row;
    }),
    getPortalSession: vi.fn(async (token: string) =>
      portalSessionStore.get(token),
    ),
    deletePortalSession: vi.fn(async (token: string) => {
      portalSessionStore.delete(token);
    }),
    deletePortalSessionsByCaseId: vi.fn(async (caseId: string) => {
      let n = 0;
      for (const [t, row] of Array.from(portalSessionStore.entries())) {
        if (row.caseId === caseId) {
          portalSessionStore.delete(t);
          n++;
        }
      }
      return n;
    }),
    deleteExpiredPortalSessions: vi.fn(async () => 0),
  }),
}));

const { adminRouter } = await import("../routes/admin");
const { validateSession } = await import("../services/session-store");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

async function mintMirrorToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post(`/api/admin/cases/${CASE_ID}/mirror-token`)
    .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
    .send({ reason: "Investigating a user-reported issue with stage 3." });
  expect(res.status).toBe(200);
  expect(typeof res.body.mirrorToken).toBe("string");
  return res.body.mirrorToken as string;
}

describe("POST /api/admin/cases/redeem-mirror-token — portal-session handoff", () => {
  let app: express.Express;

  beforeEach(() => {
    auditLogs.length = 0;
    mirrorTokenStore.clear();
    portalSessionStore.clear();
    app = buildApp();
  });

  it("returns a portalSessionToken that validateSession() accepts for the same case + access code", async () => {
    const mirrorToken = await mintMirrorToken(app);

    const res = await request(app)
      .post("/api/admin/cases/redeem-mirror-token")
      .send({ token: mirrorToken });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      caseId: CASE_ID,
      accessCode: ACCESS_CODE,
    });
    expect(typeof res.body.portalSessionToken).toBe("string");
    expect(res.body.portalSessionToken.length).toBeGreaterThan(16);

    const session = await validateSession(res.body.portalSessionToken);
    expect(session).not.toBeNull();
    expect(session!.caseId).toBe(CASE_ID);
    expect(session!.accessCode).toBe(ACCESS_CODE);

    // Both audit rows must still fire.
    const issued = auditLogs.filter(
      (a) => a.action === "admin_mirror_token_issued",
    );
    const redeemed = auditLogs.filter(
      (a) => a.action === "admin_mirror_token_redeemed",
    );
    expect(issued).toHaveLength(1);
    expect(issued[0].targetType).toBe("case");
    expect(issued[0].targetId).toBe(CASE_ID);
    expect(redeemed).toHaveLength(1);
    expect(redeemed[0].targetType).toBe("case");
    expect(redeemed[0].targetId).toBe(CASE_ID);
  });

  it("rejects an unknown token with 404 and does not mint a portal session", async () => {
    const res = await request(app)
      .post("/api/admin/cases/redeem-mirror-token")
      .send({ token: "totally-fabricated-token" });

    expect(res.status).toBe(404);
    expect(res.body.portalSessionToken).toBeUndefined();
    expect(
      auditLogs.some((a) => a.action === "admin_mirror_token_redeemed"),
    ).toBe(false);
  });

  it("rejects a missing token with 400 and does not mint a portal session", async () => {
    const res = await request(app)
      .post("/api/admin/cases/redeem-mirror-token")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.portalSessionToken).toBeUndefined();
    expect(
      auditLogs.some((a) => a.action === "admin_mirror_token_redeemed"),
    ).toBe(false);
  });

  it("single-use: a token cannot be redeemed twice (second redeem 404s and mints nothing)", async () => {
    const mirrorToken = await mintMirrorToken(app);

    const first = await request(app)
      .post("/api/admin/cases/redeem-mirror-token")
      .send({ token: mirrorToken });
    expect(first.status).toBe(200);
    const firstSessionToken = first.body.portalSessionToken as string;
    expect(await validateSession(firstSessionToken)).not.toBeNull();

    const second = await request(app)
      .post("/api/admin/cases/redeem-mirror-token")
      .send({ token: mirrorToken });
    expect(second.status).toBe(404);
    expect(second.body.portalSessionToken).toBeUndefined();

    // Only one redeem audit should exist despite two attempts.
    expect(
      auditLogs.filter((a) => a.action === "admin_mirror_token_redeemed"),
    ).toHaveLength(1);
  });

  // ----------------------------------------------------------------
  // Task #119 — Cross-instance redeem
  //
  // Under Replit autoscale the mint and redeem requests can land on
  // different app instances. Mirror tokens used to live in a per-process
  // Map, so the redeem instance never saw the token and 404'd.
  //
  // We simulate the two-instance setup by re-importing the route module
  // with a fresh module cache, which yields a second `adminRouter` that
  // would have had its own private in-memory Map. Both routers go through
  // the same mocked `storage`, mirroring how real instances share Postgres.
  // The mint hits instance A, the redeem hits instance B, and it still
  // succeeds — which is exactly the autoscale behaviour we need.
  // ----------------------------------------------------------------
  it("cross-instance: token minted on instance A can still be redeemed on instance B", async () => {
    const appA = buildApp();

    vi.resetModules();
    const { adminRouter: adminRouterB } = await import("../routes/admin");
    expect(adminRouterB).not.toBe(adminRouter);
    const appB = express();
    appB.use(express.json());
    appB.use("/api/admin", adminRouterB);

    const mirrorToken = await mintMirrorToken(appA);

    const res = await request(appB)
      .post("/api/admin/cases/redeem-mirror-token")
      .send({ token: mirrorToken });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      caseId: CASE_ID,
      accessCode: ACCESS_CODE,
    });
    expect(typeof res.body.portalSessionToken).toBe("string");

    // And it's still single-use across instances — instance A can't redeem
    // the same token a second time once instance B consumed it.
    const replay = await request(appA)
      .post("/api/admin/cases/redeem-mirror-token")
      .send({ token: mirrorToken });
    expect(replay.status).toBe(404);

    expect(
      auditLogs.filter((a) => a.action === "admin_mirror_token_redeemed"),
    ).toHaveLength(1);
  });

  it("expired token: a token past its TTL is rejected (404/410) and does not mint a portal session", async () => {
    const mirrorToken = await mintMirrorToken(app);

    // Fast-forward past the 2-minute TTL using fake timers, then redeem.
    // The handler prunes first (yielding 404) and otherwise returns 410 on
    // an expiry race — either response is an acceptable "expired" outcome.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() + 5 * 60 * 1000));
      const res = await request(app)
        .post("/api/admin/cases/redeem-mirror-token")
        .send({ token: mirrorToken });
      expect([404, 410]).toContain(res.status);
      expect(res.body.portalSessionToken).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    expect(
      auditLogs.some((a) => a.action === "admin_mirror_token_redeemed"),
    ).toBe(false);
  });
});
