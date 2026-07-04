import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// =============================================================================
// Sub-admin session revocation tests
//
// Verifies three security guarantees:
//
//  1. PATCH /api/admin-users/:id with isActive=false immediately revokes all
//     active sessions for that username so a disabled sub-admin cannot continue
//     using a stale bearer token (up to the 12-hour natural TTL).
//
//  2. DELETE /api/admin-users/:id revokes all active sessions for the deleted
//     username before (logically) removing the account row.
//
//  3. checkAdminAuth re-validates isActive on every request for sub-admin
//     accounts, so a disabled or deleted sub-admin is blocked even if their
//     session row was not yet explicitly revoked (belt-and-suspenders guard).
// =============================================================================

const SUPER_ADMIN = "test-super-admin";
const SUB_ADMIN = "test-sub-admin";
const SUPER_TOKEN = "super-token";
const SUB_TOKEN = "sub-token";

process.env.ADMIN_USERNAME = SUPER_ADMIN;

// Mutable sub-admin state that tests can override between runs.
let subAdminRow: {
  id: number;
  username: string;
  role: string;
  isActive: boolean;
  passwordHash: string;
  twoFactorSecret: string | null;
} | null = {
  id: 42,
  username: SUB_ADMIN,
  role: "agent",
  isActive: true,
  passwordHash: "hash",
  twoFactorSecret: null,
};

const revokeAllAdminSessions = vi.fn(async () => 1);
const revokeAdminSession = vi.fn(async () => {});
const updateAdminUser = vi.fn(async (_id: number, data: any) => ({
  ...(subAdminRow ?? {}),
  ...data,
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // Super-admin session (used for PATCH / DELETE actor)
    getAdminSessionByToken: vi.fn(async (token: string) => {
      if (token === SUPER_TOKEN) {
        return {
          id: "session-super",
          adminUsername: SUPER_ADMIN,
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        };
      }
      if (token === SUB_TOKEN) {
        return {
          id: "session-sub",
          adminUsername: SUB_ADMIN,
          isActive: true,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        };
      }
      return null;
    }),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getAdminUserById: vi.fn(async (id: number) =>
      subAdminRow && subAdminRow.id === id ? subAdminRow : null,
    ),
    getAdminUserByUsername: vi.fn(async (username: string) =>
      subAdminRow && subAdminRow.username === username ? subAdminRow : null,
    ),
    updateAdminUser,
    deleteAdminUser: vi.fn(async () => {}),
    revokeAllAdminSessions,
    revokeAdminSession,
    createAuditLog: vi.fn(async () => ({})),
    getAppSetting: vi.fn(async () => null),
  }),
}));

const { adminUsersRouter } = await import("../routes/adminUsers");
const { checkAdminAuth } = await import("../routes/middleware");

function buildAdminUsersApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin-users", adminUsersRouter);
  return app;
}

function buildMiddlewareApp() {
  const app = express();
  app.use(express.json());
  app.get("/protected", checkAdminAuth, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

// ---------------------------------------------------------------------------
// 1. PATCH — disabling a sub-admin revokes all their sessions
// ---------------------------------------------------------------------------
describe("PATCH /api/admin-users/:id — isActive=false revokes sessions", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildAdminUsersApp();
    subAdminRow = {
      id: 42,
      username: SUB_ADMIN,
      role: "agent",
      isActive: true,
      passwordHash: "hash",
      twoFactorSecret: null,
    };
    vi.clearAllMocks();
  });

  it("calls revokeAllAdminSessions with the sub-admin username when isActive transitions true→false", async () => {
    const res = await request(app)
      .patch("/api/admin-users/42")
      .set("Authorization", `Bearer ${SUPER_TOKEN}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(revokeAllAdminSessions).toHaveBeenCalledWith(SUB_ADMIN);
  });

  it("does NOT call revokeAllAdminSessions when isActive is already false (no-op transition)", async () => {
    subAdminRow = { ...subAdminRow!, isActive: false };

    const res = await request(app)
      .patch("/api/admin-users/42")
      .set("Authorization", `Bearer ${SUPER_TOKEN}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(revokeAllAdminSessions).not.toHaveBeenCalled();
  });

  it("does NOT call revokeAllAdminSessions when isActive is not part of the update payload", async () => {
    const res = await request(app)
      .patch("/api/admin-users/42")
      .set("Authorization", `Bearer ${SUPER_TOKEN}`)
      .send({ role: "admin" });

    expect(res.status).toBe(200);
    expect(revokeAllAdminSessions).not.toHaveBeenCalled();
  });

  it("does NOT call revokeAllAdminSessions when isActive is set to true (re-enabling)", async () => {
    subAdminRow = { ...subAdminRow!, isActive: false };

    const res = await request(app)
      .patch("/api/admin-users/42")
      .set("Authorization", `Bearer ${SUPER_TOKEN}`)
      .send({ isActive: true });

    expect(res.status).toBe(200);
    expect(revokeAllAdminSessions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. DELETE — removing a sub-admin revokes all their sessions
// ---------------------------------------------------------------------------
describe("DELETE /api/admin-users/:id — deletion revokes sessions", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildAdminUsersApp();
    subAdminRow = {
      id: 42,
      username: SUB_ADMIN,
      role: "agent",
      isActive: true,
      passwordHash: "hash",
      twoFactorSecret: null,
    };
    vi.clearAllMocks();
  });

  it("calls revokeAllAdminSessions with the sub-admin username on successful deletion", async () => {
    const res = await request(app)
      .delete("/api/admin-users/42")
      .set("Authorization", `Bearer ${SUPER_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(revokeAllAdminSessions).toHaveBeenCalledWith(SUB_ADMIN);
  });

  it("calls revokeAllAdminSessions even when the sub-admin account was already inactive", async () => {
    subAdminRow = { ...subAdminRow!, isActive: false };

    const res = await request(app)
      .delete("/api/admin-users/42")
      .set("Authorization", `Bearer ${SUPER_TOKEN}`);

    expect(res.status).toBe(200);
    expect(revokeAllAdminSessions).toHaveBeenCalledWith(SUB_ADMIN);
  });

  it("returns 404 and does NOT call revokeAllAdminSessions when the user does not exist", async () => {
    subAdminRow = null;

    const res = await request(app)
      .delete("/api/admin-users/42")
      .set("Authorization", `Bearer ${SUPER_TOKEN}`);

    expect(res.status).toBe(404);
    expect(revokeAllAdminSessions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. checkAdminAuth — re-validates isActive on every request
// ---------------------------------------------------------------------------
describe("checkAdminAuth — sub-admin isActive re-validation", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildMiddlewareApp();
    subAdminRow = {
      id: 42,
      username: SUB_ADMIN,
      role: "agent",
      isActive: true,
      passwordHash: "hash",
      twoFactorSecret: null,
    };
    vi.clearAllMocks();
  });

  it("returns 401 when the sub-admin account row has isActive=false", async () => {
    subAdminRow = { ...subAdminRow!, isActive: false };

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${SUB_TOKEN}`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("revokes the specific session token when the sub-admin account is disabled", async () => {
    subAdminRow = { ...subAdminRow!, isActive: false };

    await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${SUB_TOKEN}`);

    expect(revokeAdminSession).toHaveBeenCalledWith(
      "session-sub",
      "Account disabled or deleted",
    );
  });

  it("returns 401 when the sub-admin account row is absent (deleted)", async () => {
    subAdminRow = null;

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${SUB_TOKEN}`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("revokes the specific session token when the sub-admin account row is absent", async () => {
    subAdminRow = null;

    await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${SUB_TOKEN}`);

    expect(revokeAdminSession).toHaveBeenCalledWith(
      "session-sub",
      "Account disabled or deleted",
    );
  });

  it("does NOT check isActive for the env-var super-admin — proceeds normally", async () => {
    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${SUPER_TOKEN}`);

    // The env-var admin bypasses the isActive DB check entirely.
    // We can't assert on req.adminRole here (no express body sets it), but
    // we can assert the request proceeds (200) rather than being blocked.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });
});
