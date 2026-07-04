import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// Task #403 — the /api/client-errors report endpoint used to keep its
// per-IP bucket in a local `Map`, which lets a flood from a single IP
// be multiplied by the autoscale instance count. It now uses the
// DB-backed `storage.atomicIncrementRateLimit` under the
// `client_error_report` namespace, with the local map preserved as an
// emergency fallback for DB outages. These tests lock the new wiring.

const atomicIncrementRateLimit = vi.fn(async (_opts?: unknown) => ({
  count: 1,
  resetAt: new Date(Date.now() + 60_000),
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    atomicIncrementRateLimit,
  }),
}));

const express = (await import("express")).default;
const request = (await import("supertest")).default;
const { default: clientErrorsRouter, __resetClientErrorRateLimitForTests } =
  await import("../routes/clientErrors");
const { __resetWarnDedupForTests } = await import("../lib/warnOnce");

function buildApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/client-errors", clientErrorsRouter);
  return app;
}

beforeEach(() => {
  atomicIncrementRateLimit.mockClear();
  atomicIncrementRateLimit.mockImplementation(async () => ({
    count: 1,
    resetAt: new Date(Date.now() + 60_000),
  }));
  __resetClientErrorRateLimitForTests();
  __resetWarnDedupForTests();
  // The successful 200 path logs the report via console.error; quiet
  // it so the vitest output stays clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/api/client-errors rate limiter (Task #403)", () => {
  it("calls atomicIncrementRateLimit with the client_error_report namespace prefix", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/client-errors")
      .set("x-forwarded-for", "203.0.113.7")
      .send({ message: "boom", stack: "Error: boom\n  at a.js:1" });
    expect(res.status).toBe(200);

    expect(atomicIncrementRateLimit).toHaveBeenCalledTimes(1);
    const arg = atomicIncrementRateLimit.mock.calls[0][0] as { key: string };
    expect(arg.key.startsWith("client_error_report:")).toBe(true);
    expect(arg.key).toContain("203.0.113.7");
  });

  it("returns 429 once the DB-reported count exceeds the per-IP ceiling", async () => {
    // The route's per-window ceiling is 20.
    atomicIncrementRateLimit.mockResolvedValueOnce({
      count: 21,
      resetAt: new Date(Date.now() + 60_000),
    });
    const app = buildApp();
    const res = await request(app)
      .post("/api/client-errors")
      .set("x-forwarded-for", "203.0.113.8")
      .send({ message: "flood" });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ ok: false });
  });

  it("falls back to in-memory bucket (no throw) when the DB increment fails", async () => {
    atomicIncrementRateLimit.mockRejectedValueOnce(new Error("simulated DB outage"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = buildApp();
    const res = await request(app)
      .post("/api/client-errors")
      .set("x-forwarded-for", "203.0.113.9")
      .send({ message: "boom" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    warnSpy.mockRestore();
  });
});
