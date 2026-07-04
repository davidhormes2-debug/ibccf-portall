/**
 * Sub-admin login and admin-users CRUD route tests
 *
 * Covers:
 *   1. Sub-admin login — correct bcrypt password → session token minted
 *   2. Sub-admin login — disabled account (isActive=false) → 401
 *   3. Sub-admin login — wrong password → 401
 *   4. GET/POST/PATCH/DELETE /api/admin-users — require super_admin (403 for lower roles)
 *   5. POST /api/admin-users — duplicate username → 409
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createStorageMock } from "./helpers/storageMock";

// ── Env setup (must happen before any route module import) ──────────────────
// Use a distinct env-var admin so the sub-admin path is exercised.
const ENV_ADMIN_USERNAME = "env_super_admin_subtest";
const ENV_ADMIN_PASSWORD = "Str0ng!Env@Admin#SubTest2";
process.env.ADMIN_USERNAME = ENV_ADMIN_USERNAME;
process.env.ADMIN_PASSWORD = ENV_ADMIN_PASSWORD;

// ── Sub-admin fixtures ───────────────────────────────────────────────────────
const ACTIVE_SUB_ADMIN = "sub-agent-user";
const INACTIVE_SUB_ADMIN = "sub-inactive-user";
const SUB_ADMIN_PASSWORD = "SubAdm!nPass99";

// Populated by beforeAll so vi.fn() closures read the live value.
let SUB_ADMIN_HASH = "";

// ── Token / session fixtures (for CRUD role tests) ───────────────────────────
const SUPER_ADMIN_TOKEN = "tok-sub-super-admin";
const ADMIN_TOKEN = "tok-sub-admin-role";
const AGENT_TOKEN = "tok-sub-agent-role";
const VIEWER_TOKEN = "tok-sub-viewer-role";
const INVALID_TOKEN = "tok-sub-invalid";

function makeSession(token: string, adminUsername: string) {
  return {
    id: `session-${token}`,
    adminUsername,
    token,
    isActive: true,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    lastActivityAt: new Date(),
    createdAt: new Date(),
    ipAddress: null,
    userAgent: null,
    location: null,
  };
}

const SESSIONS: Record<string, ReturnType<typeof makeSession>> = {
  [SUPER_ADMIN_TOKEN]: makeSession(SUPER_ADMIN_TOKEN, ENV_ADMIN_USERNAME),
  [ADMIN_TOKEN]: makeSession(ADMIN_TOKEN, "db-admin-user-sub"),
  [AGENT_TOKEN]: makeSession(AGENT_TOKEN, "db-agent-user-sub"),
  [VIEWER_TOKEN]: makeSession(VIEWER_TOKEN, "db-viewer-user-sub"),
};

const SUB_ADMIN_ROWS: Record<string, { username: string; isActive: boolean }> = {
  "db-admin-user-sub": { username: "db-admin-user-sub", isActive: true },
  "db-agent-user-sub": { username: "db-agent-user-sub", isActive: true },
  "db-viewer-user-sub": { username: "db-viewer-user-sub", isActive: true },
};

// ── Storage mock ─────────────────────────────────────────────────────────────
const createAuditLogMock = vi.fn(async () => ({ id: 1 }));
const createAdminSessionMock = vi.fn(async () => ({ id: 1 }));
const listAdminUsersMock = vi.fn(async () => []);
const getAdminUserByIdMock = vi.fn(async () => null);
const createAdminUserMock = vi.fn(async () => ({
  id: 99,
  username: "new-sub-admin",
  role: "agent",
  displayName: null,
  email: null,
  isActive: true,
  passwordHash: "h",
  twoFactorSecret: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // Login-path methods
    getAdminUserByUsername: vi.fn(async (username: string) => {
      if (username === ACTIVE_SUB_ADMIN) {
        return {
          id: 1,
          username: ACTIVE_SUB_ADMIN,
          passwordHash: SUB_ADMIN_HASH,
          isActive: true,
          role: "agent",
          displayName: null,
          email: null,
          twoFactorSecret: null,
          twoFactorEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: null,
        };
      }
      if (username === INACTIVE_SUB_ADMIN) {
        return {
          id: 2,
          username: INACTIVE_SUB_ADMIN,
          passwordHash: SUB_ADMIN_HASH,
          isActive: false,
          role: "agent",
          displayName: null,
          email: null,
          twoFactorSecret: null,
          twoFactorEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: null,
        };
      }
      // For CRUD-role tests: sub-admin session activity lookups
      if (username in SUB_ADMIN_ROWS) {
        return SUB_ADMIN_ROWS[username];
      }
      return null;
    }),
    getAppSetting: vi.fn(async () => null),
    getAdminTwoFactor: vi.fn(async () => null),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    createAdminSession: createAdminSessionMock,
    createAuditLog: createAuditLogMock,
    updateAdminUser: vi.fn(async () => null),
    // RBAC session validation
    getAdminSessionByToken: vi.fn(async (token: string) =>
      SESSIONS[token] ?? null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    revokeAdminSession: vi.fn(async () => {}),
    revokeAllAdminSessions: vi.fn(async () => {}),
    // CRUD methods
    listAdminUsers: listAdminUsersMock,
    getAdminUserById: getAdminUserByIdMock,
    createAdminUser: createAdminUserMock,
    deleteAdminUser: vi.fn(async () => {}),
    // Rate limiter support
    atomicIncrementRateLimit: vi.fn(async () => ({
      count: 1,
      resetAt: new Date(Date.now() + 60_000),
    })),
    upsertAdminLoginAttempt: vi.fn(async () => {}),
    getActiveAdminLoginAttempts: vi.fn(async () => []),
    isIpBlocked: vi.fn(async () => false),
  }),
}));

// Stub the static helpers that admin.ts imports at module level.
vi.mock("../static", () => ({
  getBuildStamp: () => "test-build",
  getBootTimeIso: () => new Date().toISOString(),
  serveStaticAssets: vi.fn(),
}));

// Override resolveAdminRoleFromUsername so RBAC resolves predictably.
vi.mock("../routes/adminPermissions", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../routes/adminPermissions")>();
  const roleMap: Record<string, string> = {
    [ENV_ADMIN_USERNAME]: "super_admin",
    "db-admin-user-sub": "admin",
    "db-agent-user-sub": "agent",
    "db-viewer-user-sub": "viewer",
  };
  return {
    ...original,
    resolveAdminRoleFromUsername: vi.fn(async (username: string) =>
      roleMap[username] ?? "viewer",
    ),
  };
});

// Stub the DB used by adminPermissions.ts directly (fallback).
vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
  },
}));

// ── Module imports (after mocks) ─────────────────────────────────────────────
const { adminRouter } = await import("../routes/admin");
const { adminUsersRouter } = await import("../routes/adminUsers");

// ── App builders ─────────────────────────────────────────────────────────────

function buildLoginApp() {
  const app = express();
  app.use(express.json());
  app.set("trust proxy", true);
  app.use("/api/admin", adminRouter);
  return app;
}

function buildAdminUsersApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin-users", adminUsersRouter);
  return app;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── beforeAll: compute bcrypt hash (low cost, 1 round for tests) ─────────────

beforeAll(async () => {
  SUB_ADMIN_HASH = await bcrypt.hash(SUB_ADMIN_PASSWORD, 1);
});

beforeEach(() => {
  createAuditLogMock.mockClear();
  createAdminSessionMock.mockClear();
});

// ── 1. Sub-admin login tests ─────────────────────────────────────────────────

describe("POST /api/admin/login — sub-admin path", () => {
  it("correct bcrypt password → 200 with a session token", async () => {
    const res = await request(buildLoginApp())
      .post("/api/admin/login")
      .send({ username: ACTIVE_SUB_ADMIN, password: SUB_ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it("disabled sub-admin (isActive=false) → 401", async () => {
    const res = await request(buildLoginApp())
      .post("/api/admin/login")
      .send({ username: INACTIVE_SUB_ADMIN, password: SUB_ADMIN_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("wrong password for sub-admin → 401", async () => {
    const res = await request(buildLoginApp())
      .post("/api/admin/login")
      .send({ username: ACTIVE_SUB_ADMIN, password: "wrong-password!" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("env-var admin credentials still work (env-var path, not sub-admin path)", async () => {
    const res = await request(buildLoginApp())
      .post("/api/admin/login")
      .send({ username: ENV_ADMIN_USERNAME, password: ENV_ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
  });

  it("unknown username → 401", async () => {
    const res = await request(buildLoginApp())
      .post("/api/admin/login")
      .send({ username: "completely-unknown-user", password: "anything" });

    expect(res.status).toBe(401);
  });
});

// ── 2. GET /api/admin-users — super_admin only ───────────────────────────────

describe("GET /api/admin-users — requireAdminRole('super_admin')", () => {
  it("returns 401 with no token", async () => {
    const res = await request(buildAdminUsersApp()).get("/api/admin-users");
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const res = await request(buildAdminUsersApp())
      .get("/api/admin-users")
      .set(authHeader(INVALID_TOKEN));
    expect(res.status).toBe(401);
  });

  it("returns 403 for viewer token", async () => {
    const res = await request(buildAdminUsersApp())
      .get("/api/admin-users")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildAdminUsersApp())
      .get("/api/admin-users")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for admin token", async () => {
    const res = await request(buildAdminUsersApp())
      .get("/api/admin-users")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).toBe(403);
  });

  it("super_admin token is allowed and returns user list", async () => {
    listAdminUsersMock.mockResolvedValueOnce([
      {
        id: 1,
        username: "existing-sub",
        role: "agent",
        displayName: null,
        email: null,
        isActive: true,
        passwordHash: "hash",
        twoFactorSecret: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
      },
    ]);
    const res = await request(buildAdminUsersApp())
      .get("/api/admin-users")
      .set(authHeader(SUPER_ADMIN_TOKEN));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // passwordHash and twoFactorSecret must be stripped
    expect(res.body[0]).not.toHaveProperty("passwordHash");
    expect(res.body[0]).not.toHaveProperty("twoFactorSecret");
  });
});

// ── 3. POST /api/admin-users — super_admin only ──────────────────────────────

describe("POST /api/admin-users — requireAdminRole('super_admin')", () => {
  const validBody = {
    username: "new-sub-admin",
    password: "P@ssword1234",
    role: "agent",
  };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildAdminUsersApp())
      .post("/api/admin-users")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildAdminUsersApp())
      .post("/api/admin-users")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 403 for admin token", async () => {
    const res = await request(buildAdminUsersApp())
      .post("/api/admin-users")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("super_admin can create a new sub-admin account → 201", async () => {
    const res = await request(buildAdminUsersApp())
      .post("/api/admin-users")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).not.toHaveProperty("passwordHash");
    expect(res.body).not.toHaveProperty("twoFactorSecret");
  });

  it("duplicate username → 409", async () => {
    // getAdminUserByUsername returns an existing row → conflict
    const { storage } = await import("../storage");
    const spy = vi
      .spyOn(storage, "getAdminUserByUsername")
      .mockResolvedValueOnce({
        id: 5,
        username: "new-sub-admin",
        passwordHash: "h",
        isActive: true,
        role: "agent",
        displayName: null,
        email: null,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
      } as any);

    const res = await request(buildAdminUsersApp())
      .post("/api/admin-users")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");

    spy.mockRestore();
  });
});

// ── 4. PATCH /api/admin-users/:id — super_admin only ─────────────────────────

describe("PATCH /api/admin-users/:id — requireAdminRole('super_admin')", () => {
  const validBody = { role: "admin" };

  it("returns 403 for viewer token", async () => {
    const res = await request(buildAdminUsersApp())
      .patch("/api/admin-users/1")
      .set(authHeader(VIEWER_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildAdminUsersApp())
      .patch("/api/admin-users/1")
      .set(authHeader(AGENT_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 403 for admin token", async () => {
    const res = await request(buildAdminUsersApp())
      .patch("/api/admin-users/1")
      .set(authHeader(ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("super_admin token is allowed (passes RBAC; handler result depends on mock)", async () => {
    const res = await request(buildAdminUsersApp())
      .patch("/api/admin-users/1")
      .set(authHeader(SUPER_ADMIN_TOKEN))
      .send(validBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── 5. DELETE /api/admin-users/:id — super_admin only ────────────────────────

describe("DELETE /api/admin-users/:id — requireAdminRole('super_admin')", () => {
  it("returns 403 for viewer token", async () => {
    const res = await request(buildAdminUsersApp())
      .delete("/api/admin-users/1")
      .set(authHeader(VIEWER_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for agent token", async () => {
    const res = await request(buildAdminUsersApp())
      .delete("/api/admin-users/1")
      .set(authHeader(AGENT_TOKEN));
    expect(res.status).toBe(403);
  });

  it("returns 403 for admin token", async () => {
    const res = await request(buildAdminUsersApp())
      .delete("/api/admin-users/1")
      .set(authHeader(ADMIN_TOKEN));
    expect(res.status).toBe(403);
  });

  it("super_admin token is allowed (passes RBAC; handler result depends on mock)", async () => {
    const res = await request(buildAdminUsersApp())
      .delete("/api/admin-users/1")
      .set(authHeader(SUPER_ADMIN_TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
