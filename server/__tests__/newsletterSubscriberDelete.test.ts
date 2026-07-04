import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { newsletterSubscribers as NewsletterSubscribersTable } from "@shared/schema";
import { createStorageMock } from "./helpers/storageMock";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// The deleteNewsletterSubscriber mock returns a hand-rolled
// `newsletter_subscribers` row. This Pick<> declaration fails `npm run check`
// if either referenced column is renamed in shared/schema.ts.
declare const _newsletterSubscribersGuard: Pick<
  typeof NewsletterSubscribersTable,
  "id" | "email"
>;

const ADMIN_TOKEN = "test-admin-token";
const ADMIN_USERNAME = "test-admin-nl-delete";
process.env.ADMIN_USERNAME = ADMIN_USERNAME;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? {
            id: "session-nl-delete",
            adminUsername: ADMIN_USERNAME,
            isActive: true,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    deleteNewsletterSubscriber: vi.fn(async (id: number) => {
      if (id === 999) return null;
      return { id, email: "sub@example.com" };
    }),
    createAuditLog: vi.fn(async () => {}),
  }),
}));

const { adminPublicContentRouter } = await import("../routes/public");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/content", adminPublicContentRouter);
  return app;
}

describe("DELETE /api/admin/content/newsletter/:id — unit tests", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it("returns 200 { success: true } for a valid numeric id", async () => {
    const res = await request(app)
      .delete("/api/admin/content/newsletter/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it("returns 400 with an error mentioning 'id' for a non-numeric id (letters)", async () => {
    const res = await request(app)
      .delete("/api/admin/content/newsletter/abc")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/id/i);
  });

  it("returns 400 with an error mentioning 'id' for a pure NaN param", async () => {
    const res = await request(app)
      .delete("/api/admin/content/newsletter/NaN")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/id/i);
  });

  it("returns 400 for a blank / space-only id", async () => {
    const res = await request(app)
      .delete("/api/admin/content/newsletter/%20")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/id/i);
  });

  it("returns 404 when storage returns null (subscriber not found)", async () => {
    const res = await request(app)
      .delete("/api/admin/content/newsletter/999")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 500 when storage throws an unexpected error", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.deleteNewsletterSubscriber).mockRejectedValueOnce(
      new Error("Simulated DB error"),
    );

    const res = await request(app)
      .delete("/api/admin/content/newsletter/7")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });

  it("creates an audit log entry on successful deletion", async () => {
    const { storage } = await import("../storage");

    await request(app)
      .delete("/api/admin/content/newsletter/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    await vi.waitFor(() => {
      expect(vi.mocked(storage.createAuditLog)).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "newsletter_subscriber_deleted",
          targetType: "newsletter_subscriber",
          targetId: "42",
        }),
      );
    });
  });

  it("requires a valid admin bearer token (returns 401 without one)", async () => {
    const res = await request(app)
      .delete("/api/admin/content/newsletter/42");
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// Auth-hardening suite — mirrors the pattern in portalAuthHardening.test.ts
// Covers every rejection path inside checkAdminAuth for this endpoint.
// ============================================================================

describe("DELETE /api/admin/content/newsletter/:id — auth hardening", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it("returns 401 when the Authorization header is missing entirely", async () => {
    const res = await request(app)
      .delete("/api/admin/content/newsletter/42");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is random / not recognised by the session store", async () => {
    const res = await request(app)
      .delete("/api/admin/content/newsletter/42")
      .set("Authorization", "Bearer totally-random-unknown-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session has been revoked (revokedAt is set)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminSessionByToken).mockResolvedValueOnce({
      id: "session-revoked",
      adminUsername: ADMIN_USERNAME,
      isActive: true,
      revokedAt: new Date(Date.now() - 5_000),
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    const res = await request(app)
      .delete("/api/admin/content/newsletter/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session has expired (expiresAt is in the past)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminSessionByToken).mockResolvedValueOnce({
      id: "session-expired",
      adminUsername: ADMIN_USERNAME,
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 10_000),
    } as any);

    const res = await request(app)
      .delete("/api/admin/content/newsletter/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(401);
  });
});
