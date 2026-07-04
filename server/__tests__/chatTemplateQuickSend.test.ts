/**
 * Chat Template Quick Send — end-to-end role-gate tests
 *
 * Verifies that the Quick Send flow (fetch templates by category → select
 * → create/edit → mark as used) works correctly for agent-level tokens and
 * is rejected with 403 for viewer-level tokens.
 *
 * Route guards under test:
 *   GET    /api/chat-templates                   checkAdminAuth (any role)
 *   GET    /api/chat-templates/category/:cat     checkAdminAuth (any role)
 *   POST   /api/chat-templates                   checkAdminAuth + requireAdminRole('agent')
 *   PATCH  /api/chat-templates/:id               checkAdminAuth + requireAdminRole('agent')
 *   POST   /api/chat-templates/:id/use           open (no auth required — intentional)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ── env setup ─────────────────────────────────────────────────────────────────
const ENV_ADMIN_USERNAME = "testadmin_quick_send";
const ENV_ADMIN_PASSWORD = "Str0ng!P@ssw0rd#QuickSend99";
process.env.ADMIN_USERNAME = ENV_ADMIN_USERNAME;
process.env.ADMIN_PASSWORD = ENV_ADMIN_PASSWORD;

// ── Token fixtures ────────────────────────────────────────────────────────────
const AGENT_TOKEN = "qs-tok-agent";
const VIEWER_TOKEN = "qs-tok-viewer";
const ADMIN_TOKEN = "qs-tok-admin";

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
  [AGENT_TOKEN]: makeSession(AGENT_TOKEN, "qs-agent-user"),
  [VIEWER_TOKEN]: makeSession(VIEWER_TOKEN, "qs-viewer-user"),
  [ADMIN_TOKEN]: makeSession(ADMIN_TOKEN, "qs-admin-user"),
};

const SUB_ADMIN_ROWS: Record<string, { username: string; isActive: boolean }> = {
  "qs-agent-user": { username: "qs-agent-user", isActive: true },
  "qs-viewer-user": { username: "qs-viewer-user", isActive: true },
  "qs-admin-user": { username: "qs-admin-user", isActive: true },
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const CREATED_TEMPLATE = { id: 42, name: "Greeting", content: "Hello {{name}}", category: "support" };
const UPDATED_TEMPLATE = { id: 42, name: "Greeting v2", content: "Hi {{name}}", category: "support" };
const TEMPLATE_LIST = [CREATED_TEMPLATE];

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) => SESSIONS[token] ?? null),
    getAdminUserByUsername: vi.fn(async (username: string) => SUB_ADMIN_ROWS[username] ?? null),
    updateAdminSessionActivity: vi.fn(async () => {}),
    revokeAdminSession: vi.fn(async () => {}),
    createAuditLog: vi.fn(async () => ({})),
    isIpBlocked: vi.fn(async () => false),
    listBlockedIps: vi.fn(async () => []),
    getAllChatTemplates: vi.fn(async () => TEMPLATE_LIST),
    getChatTemplatesByCategory: vi.fn(async () => TEMPLATE_LIST),
    createChatTemplate: vi.fn(async () => CREATED_TEMPLATE),
    updateChatTemplate: vi.fn(async () => UPDATED_TEMPLATE),
    deleteChatTemplate: vi.fn(async () => {}),
    incrementTemplateUsage: vi.fn(async () => {}),
  }),
}));

vi.mock("../routes/adminPermissions", async (importOriginal) => {
  const original = await importOriginal<typeof import("../routes/adminPermissions")>();
  const roleMap: Record<string, string> = {
    [ENV_ADMIN_USERNAME]: "super_admin",
    "qs-agent-user": "agent",
    "qs-viewer-user": "viewer",
    "qs-admin-user": "admin",
  };
  return {
    ...original,
    resolveAdminRoleFromUsername: vi.fn(async (username: string) => roleMap[username] ?? "viewer"),
  };
});

vi.mock("../lib/warnOnce", () => ({
  warnOnce: vi.fn(),
  __resetWarnDedupForTests: vi.fn(),
}));

// ── Import routes AFTER mocks ─────────────────────────────────────────────────
const { chatTemplatesRouter } = await import("../routes/messages");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/chat-templates", chatTemplatesRouter);
  return app;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Quick Send — GET /api/chat-templates (any authenticated role)", () => {
  it("agent can list all chat templates", async () => {
    const res = await request(buildApp())
      .get("/api/chat-templates")
      .set(auth(AGENT_TOKEN));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(TEMPLATE_LIST);
  });

  it("viewer can list all chat templates (read-only)", async () => {
    const res = await request(buildApp())
      .get("/api/chat-templates")
      .set(auth(VIEWER_TOKEN));
    expect(res.status).toBe(200);
  });

  it("returns 401 with no token", async () => {
    const res = await request(buildApp()).get("/api/chat-templates");
    expect(res.status).toBe(401);
  });
});

describe("Quick Send — GET /api/chat-templates/category/:category (any authenticated role)", () => {
  it("agent can fetch templates by category", async () => {
    const res = await request(buildApp())
      .get("/api/chat-templates/category/support")
      .set(auth(AGENT_TOKEN));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(TEMPLATE_LIST);
  });

  it("viewer can fetch templates by category", async () => {
    const res = await request(buildApp())
      .get("/api/chat-templates/category/support")
      .set(auth(VIEWER_TOKEN));
    expect(res.status).toBe(200);
  });
});

describe("Quick Send — POST /api/chat-templates (requireAdminRole agent)", () => {
  const newTemplate = { name: "Greeting", content: "Hello {{name}}", category: "support" };

  it("agent can create a chat template and receives the new record", async () => {
    const res = await request(buildApp())
      .post("/api/chat-templates")
      .set(auth(AGENT_TOKEN))
      .send(newTemplate);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 42, name: "Greeting" });
  });

  it("admin can create a chat template", async () => {
    const res = await request(buildApp())
      .post("/api/chat-templates")
      .set(auth(ADMIN_TOKEN))
      .send(newTemplate);
    expect(res.status).toBe(200);
  });

  it("viewer is rejected with 403", async () => {
    const res = await request(buildApp())
      .post("/api/chat-templates")
      .set(auth(VIEWER_TOKEN))
      .send(newTemplate);
    expect(res.status).toBe(403);
  });

  it("unauthenticated request is rejected with 401", async () => {
    const res = await request(buildApp())
      .post("/api/chat-templates")
      .send(newTemplate);
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(buildApp())
      .post("/api/chat-templates")
      .set(auth(AGENT_TOKEN))
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("Quick Send — PATCH /api/chat-templates/:id (requireAdminRole agent)", () => {
  it("agent can update a template", async () => {
    const res = await request(buildApp())
      .patch("/api/chat-templates/42")
      .set(auth(AGENT_TOKEN))
      .send({ name: "Greeting v2" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 42 });
  });

  it("admin can update a template", async () => {
    const res = await request(buildApp())
      .patch("/api/chat-templates/42")
      .set(auth(ADMIN_TOKEN))
      .send({ name: "Greeting v2" });
    expect(res.status).toBe(200);
  });

  it("viewer is rejected with 403", async () => {
    const res = await request(buildApp())
      .patch("/api/chat-templates/42")
      .set(auth(VIEWER_TOKEN))
      .send({ name: "Greeting v2" });
    expect(res.status).toBe(403);
  });
});

describe("Quick Send — POST /api/chat-templates/:id/use (open — no auth required)", () => {
  it("marks a template as used without any token", async () => {
    const res = await request(buildApp())
      .post("/api/chat-templates/42/use");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it("agent can also mark a template as used", async () => {
    const res = await request(buildApp())
      .post("/api/chat-templates/42/use")
      .set(auth(AGENT_TOKEN));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

describe("Quick Send — end-to-end agent scenario: create → fetch by category → use", () => {
  it("agent creates a template, fetches it by category, then marks it used", async () => {
    const app = buildApp();

    // Step 1: agent creates template
    const createRes = await request(app)
      .post("/api/chat-templates")
      .set(auth(AGENT_TOKEN))
      .send({ name: "Follow-up", content: "Following up on your case.", category: "general" });
    expect(createRes.status).toBe(200);
    const templateId = createRes.body.id as number;
    expect(typeof templateId).toBe("number");

    // Step 2: fetch templates in that category (simulates Quick Send panel loading)
    const listRes = await request(app)
      .get("/api/chat-templates/category/general")
      .set(auth(AGENT_TOKEN));
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);

    // Step 3: mark the selected template as used (Quick Send click)
    const useRes = await request(app)
      .post(`/api/chat-templates/${templateId}/use`);
    expect(useRes.status).toBe(200);
    expect(useRes.body).toEqual({ success: true });
  });

  it("viewer cannot create a template (Quick Send panel is read-only for viewers)", async () => {
    const res = await request(buildApp())
      .post("/api/chat-templates")
      .set(auth(VIEWER_TOKEN))
      .send({ name: "Test", content: "Test content", category: "general" });
    expect(res.status).toBe(403);
  });
});
