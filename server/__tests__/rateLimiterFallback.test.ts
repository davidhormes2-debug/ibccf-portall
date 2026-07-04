import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Global rateLimiter (server/middleware/security.ts) — DB-fallback noise
// reduction. When the persistent atomic-increment call throws, the limiter
// must fall back to in-memory enforcement AND log via warnOnce (deduped
// console.warn) instead of console.error per request.
// ============================================================================

let dbShouldThrow = false;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    atomicIncrementRateLimit: vi.fn(async () => {
      if (dbShouldThrow) throw new Error("simulated DB outage");
      return { count: 1, resetAt: new Date(Date.now() + 60_000) };
    }),
    upsertAdminLoginAttempt: vi.fn(async () => {}),
    getActiveAdminLoginAttempts: vi.fn(async () => []),
  }),
}));

const { rateLimiter } = await import("../middleware/security");
const { __resetWarnDedupForTests } = await import("../lib/warnOnce");

function buildApp() {
  const app = express();
  // Persistent limiter (DB-backed) — same code path the admin login uses.
  app.use(
    "/test",
    rateLimiter(5, 60_000, { persistNamespace: "test_fallback_ns" }),
  );
  app.get("/test", (_req, res) => res.json({ ok: true }));
  return app;
}

const app = buildApp();

beforeEach(() => {
  dbShouldThrow = false;
  __resetWarnDedupForTests();
  vi.clearAllMocks();
});

describe("rateLimiter DB fallback — noise reduction", () => {
  it("falls back to in-memory and serves requests when DB throws", async () => {
    dbShouldThrow = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await request(app).get("/test").set("x-forwarded-for", "10.0.1.1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    warnSpy.mockRestore();
  });

  it("logs via console.warn (not console.error) on DB failure", async () => {
    dbShouldThrow = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await request(app).get("/test").set("x-forwarded-for", "10.0.1.2");

    expect(warnSpy).toHaveBeenCalled();
    const matched = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === "string" && msg.includes("atomic DB increment failed"),
    );
    expect(matched.length).toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("deduplicates the DB-fallback warning across repeated requests", async () => {
    dbShouldThrow = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let i = 0; i < 4; i++) {
      await request(app).get("/test").set("x-forwarded-for", "10.0.1.3");
    }

    const matched = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === "string" && msg.includes("atomic DB increment failed"),
    );
    // warnOnce should suppress all but the first occurrence within 1 min.
    expect(matched.length).toBe(1);

    warnSpy.mockRestore();
  });
});
