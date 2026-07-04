import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Server tests for GET / PUT /api/admin/settings/email-templates (Task #269)
//
// checkAdminAuth is NOT bypassed here. The real middleware runs against a
// mocked storage so we can verify that unauthenticated requests are rejected
// with 401 on the actual production route, not on a stub.
// ============================================================================

const ADMIN_TOKEN = "test-admin-token";
const ADMIN_USERNAME = "test-admin";
process.env.ADMIN_USERNAME = ADMIN_USERNAME;

const auditLogs: any[] = [];

let storedSetting: { value: string; updatedAt: Date; updatedBy: string } | null =
  null;

// Do NOT mock ../routes/middleware — let the real checkAdminAuth execute so
// that the unauthenticated-401 test exercises the production code path.
// checkAdminAuth calls storage.getAdminSessionByToken, which is mocked below.

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // checkAdminAuth / isValidAdminToken depends on these two:
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? {
            id: "session-1",
            adminUsername: ADMIN_USERNAME,
            isActive: true,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    // email-templates route depends on these:
    getAppSetting: vi.fn(async (_key: string) => storedSetting),
    setAppSetting: vi.fn(
      async (_key: string, value: string, updatedBy: string) => {
        storedSetting = {
          value,
          updatedAt: new Date(),
          updatedBy,
        };
      },
    ),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({}),
    ),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    // checkIpNotBlocked (used elsewhere in the router) may call this:
    isIpBlocked: vi.fn(async () => false),
  }),
}));

vi.mock("../static", () => ({
  getBuildStamp: vi.fn(() => "test-build"),
  getBootTimeIso: vi.fn(() => new Date().toISOString()),
}));

vi.mock("../services/portal-auth", () => ({
  isAuthorizedForCase: vi.fn(async () => false),
  isPortalSessionValidForCase: vi.fn(async () => false),
}));

vi.mock("../middleware", () => ({
  loginRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../audit-retention", () => ({
  AUDIT_LOG_RETENTION_MAX_DAYS: 365,
  AUDIT_LOG_RETENTION_MIN_DAYS: 30,
  readAuditLogRetentionSetting: vi.fn(async () => 90),
  runAuditLogSweep: vi.fn(async () => 0),
  saveAuditLogRetentionDays: vi.fn(async () => {}),
}));

vi.mock("../community-cleanup", () => ({
  COMMUNITY_PARTICIPANT_RETENTION_MAX_DAYS: 365,
  COMMUNITY_PARTICIPANT_RETENTION_MIN_DAYS: 7,
  readCommunityParticipantRetentionSetting: vi.fn(async () => 30),
  runCommunityParticipantCleanup: vi.fn(async () => 0),
  saveCommunityParticipantRetentionDays: vi.fn(async () => {}),
}));

const { adminRouter } = await import("../routes/admin");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

const app = buildApp();
const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };

const validTemplate = {
  id: "tmpl-1",
  name: "Welcome",
  subject: "Welcome to IBCCF",
  body: "Hello, welcome to the platform.",
};

beforeEach(() => {
  auditLogs.length = 0;
  storedSetting = null;
});

// ---------------------------------------------------------------------------
// GET /api/admin/settings/email-templates
// ---------------------------------------------------------------------------

describe("GET /api/admin/settings/email-templates", () => {
  it("returns 401 when no Authorization header is supplied", async () => {
    const res = await request(app)
      .get("/api/admin/settings/email-templates");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 401 when an invalid bearer token is supplied", async () => {
    const res = await request(app)
      .get("/api/admin/settings/email-templates")
      .set("Authorization", "Bearer wrong-token");

    expect(res.status).toBe(401);
  });

  it("returns empty array + null updatedAt when no setting row exists", async () => {
    storedSetting = null;

    const res = await request(app)
      .get("/api/admin/settings/email-templates")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("templates");
    expect(Array.isArray(res.body.templates)).toBe(true);
    expect(res.body.templates).toHaveLength(0);
    expect(res.body.updatedAt).toBeNull();
  });

  it("returns stored templates when a setting row exists", async () => {
    storedSetting = {
      value: JSON.stringify([validTemplate]),
      updatedAt: new Date("2025-01-01T00:00:00Z"),
      updatedBy: ADMIN_USERNAME,
    };

    const res = await request(app)
      .get("/api/admin/settings/email-templates")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);
    expect(res.body.templates[0]).toMatchObject({
      id: "tmpl-1",
      name: "Welcome",
      subject: "Welcome to IBCCF",
    });
    expect(res.body.updatedBy).toBe(ADMIN_USERNAME);
  });

  it("returns empty array when the stored JSON is corrupted", async () => {
    storedSetting = {
      value: "not-valid-json{{{",
      updatedAt: new Date(),
      updatedBy: ADMIN_USERNAME,
    };

    const res = await request(app)
      .get("/api/admin/settings/email-templates")
      .set(auth);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
    expect(res.body.templates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/settings/email-templates
// ---------------------------------------------------------------------------

describe("PUT /api/admin/settings/email-templates", () => {
  it("persists a valid template array and returns 200", async () => {
    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: [validTemplate] });

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);
    expect(res.body.templates[0]).toMatchObject({ name: "Welcome" });
    expect(storedSetting).not.toBeNull();
    const stored = JSON.parse(storedSetting!.value);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Welcome");
  });

  it("emits an audit log entry with action=email_templates_changed", async () => {
    await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: [validTemplate] });

    const logEntry = auditLogs.find(
      (l) => l.action === "email_templates_changed",
    );
    expect(logEntry).toBeDefined();
    expect(logEntry.newValue).toBe("1 templates");
    expect(logEntry.targetType).toBe("app_setting");
  });

  it("accepts an empty template array and records correct previous/new counts", async () => {
    storedSetting = {
      value: JSON.stringify([validTemplate]),
      updatedAt: new Date(),
      updatedBy: ADMIN_USERNAME,
    };

    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: [] });

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(0);

    const logEntry = auditLogs.find(
      (l) => l.action === "email_templates_changed",
    );
    expect(logEntry).toBeDefined();
    expect(logEntry.previousValue).toBe("1 templates");
    expect(logEntry.newValue).toBe("0 templates");
  });

  it("returns 400 when a template is missing the name field", async () => {
    const { name: _omitted, ...noName } = validTemplate;

    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: [noName] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a template is missing the subject field", async () => {
    const { subject: _omitted, ...noSubject } = validTemplate;

    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: [noSubject] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a template is missing the body field", async () => {
    const { body: _omitted, ...noBody } = validTemplate;

    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: [noBody] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a template has an empty-string name", async () => {
    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: [{ ...validTemplate, name: "" }] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a template has an empty-string subject", async () => {
    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: [{ ...validTemplate, subject: "" }] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a template has an empty-string body", async () => {
    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: [{ ...validTemplate, body: "" }] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when more than 50 templates are submitted", async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      id: `tmpl-${i}`,
      name: `Template ${i}`,
      subject: `Subject ${i}`,
      body: `Body content for template ${i}`,
    }));

    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: tooMany });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when two templates share the same name (Task #316)", async () => {
    const duplicate = [
      { id: "tmpl-a", name: "Welcome", subject: "Subject A", body: "Body A" },
      { id: "tmpl-b", name: "Welcome", subject: "Subject B", body: "Body B" },
    ];

    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: duplicate });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    expect(storedSetting).toBeNull();
  });

  it("returns 400 when duplicate names differ only by case/whitespace (Task #316)", async () => {
    const duplicate = [
      { id: "tmpl-a", name: "Welcome", subject: "Subject A", body: "Body A" },
      { id: "tmpl-b", name: "  welcome  ", subject: "Subject B", body: "Body B" },
    ];

    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: duplicate });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(storedSetting).toBeNull();
  });

  it("succeeds with unique template names (Task #316 regression guard)", async () => {
    const unique = [
      { id: "tmpl-a", name: "Welcome", subject: "Subject A", body: "Body A" },
      { id: "tmpl-b", name: "Goodbye", subject: "Subject B", body: "Body B" },
      { id: "tmpl-c", name: "Reminder", subject: "Subject C", body: "Body C" },
    ];

    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: unique });

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(3);
    expect(storedSetting).not.toBeNull();
    const stored = JSON.parse(storedSetting!.value);
    expect(stored.map((t: { name: string }) => t.name)).toEqual([
      "Welcome",
      "Goodbye",
      "Reminder",
    ]);
  });

  it("accepts exactly 50 templates (boundary — should succeed)", async () => {
    const exactly50 = Array.from({ length: 50 }, (_, i) => ({
      id: `tmpl-${i}`,
      name: `Template ${i}`,
      subject: `Subject ${i}`,
      body: `Body content for template ${i}`,
    }));

    const res = await request(app)
      .put("/api/admin/settings/email-templates")
      .set(auth)
      .send({ templates: exactly50 });

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(50);
  });
});
