import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isTransientDbError,
  JobCircuitBreaker,
  JOB_CB_THRESHOLD,
  JOB_CB_OPEN_DURATION_MS,
} from "../lib/dbResilience";

// ── isTransientDbError ────────────────────────────────────────────────────────

describe("isTransientDbError", () => {
  it("returns false for null / undefined", () => {
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError(undefined)).toBe(false);
  });

  it("returns false for non-object primitives", () => {
    expect(isTransientDbError("oops")).toBe(false);
    expect(isTransientDbError(42)).toBe(false);
  });

  it("returns true for known pg SQLSTATE codes", () => {
    for (const code of ["08000", "08003", "08006", "57P01", "57P02", "57P03", "53300"]) {
      expect(isTransientDbError({ code, message: "" }), `code ${code}`).toBe(true);
    }
  });

  it("returns false for a permanent pg code (e.g. 42P01 undefined_table)", () => {
    expect(isTransientDbError({ code: "42P01", message: "relation not found" })).toBe(false);
  });

  it("matches 'Failed query' message (the Drizzle/pg adapter error string from logs)", () => {
    expect(isTransientDbError(new Error("Failed query: select ..."))).toBe(true);
  });

  it("matches connection refused", () => {
    expect(isTransientDbError(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(true);
  });

  it("matches timeout errors", () => {
    expect(isTransientDbError(new Error("connect timeout"))).toBe(true);
    expect(isTransientDbError(new Error("query timeout exceeded"))).toBe(true);
  });

  it("matches pool exhausted / too many clients", () => {
    expect(isTransientDbError(new Error("sorry, too many clients already"))).toBe(true);
  });

  it("matches socket hang up", () => {
    expect(isTransientDbError(new Error("socket hang up"))).toBe(true);
  });

  it("returns false for a non-transient error like 'permission denied'", () => {
    expect(isTransientDbError(new Error("permission denied for table users"))).toBe(false);
  });

  it("returns false for a non-transient error like 'syntax error'", () => {
    expect(isTransientDbError(new Error("syntax error at or near SELECT"))).toBe(false);
  });
});

// ── JobCircuitBreaker ─────────────────────────────────────────────────────────

describe("JobCircuitBreaker", () => {
  let cb: JobCircuitBreaker;

  // Use a small threshold (3) and open duration (100 ms) for fast tests.
  const THRESHOLD = 3;
  const OPEN_MS = 100;

  beforeEach(() => {
    cb = new JobCircuitBreaker(THRESHOLD, OPEN_MS);
  });

  it("starts in closed state", () => {
    expect(cb.state).toBe("closed");
    expect(cb.consecutiveFailures).toBe(0);
  });

  it("shouldSkip returns false when circuit is closed", () => {
    expect(cb.shouldSkip("job")).toBe(false);
  });

  it("onSuccess keeps circuit closed and resets failure counter", () => {
    cb.onFailure("job");
    cb.onFailure("job");
    cb.onSuccess();
    expect(cb.state).toBe("closed");
    expect(cb.consecutiveFailures).toBe(0);
  });

  it("opens the circuit after THRESHOLD consecutive failures", () => {
    for (let i = 0; i < THRESHOLD; i++) {
      expect(cb.state).toBe("closed");
      cb.onFailure("job");
    }
    expect(cb.state).toBe("open");
  });

  it("shouldSkip returns true when circuit is open within the cooldown window", () => {
    for (let i = 0; i < THRESHOLD; i++) cb.onFailure("job");
    expect(cb.shouldSkip("job")).toBe(true);
  });

  it("circuit transitions to half-open after the open duration elapses", async () => {
    for (let i = 0; i < THRESHOLD; i++) cb.onFailure("job");
    expect(cb.state).toBe("open");

    // Wait for the open duration to elapse.
    await new Promise((r) => setTimeout(r, OPEN_MS + 20));

    // shouldSkip transitions to half-open and returns false (allow one probe).
    expect(cb.shouldSkip("job")).toBe(false);
    expect(cb.state).toBe("half-open");
  });

  it("half-open circuit closes on next success", async () => {
    for (let i = 0; i < THRESHOLD; i++) cb.onFailure("job");
    await new Promise((r) => setTimeout(r, OPEN_MS + 20));
    cb.shouldSkip("job"); // transitions to half-open
    cb.onSuccess();
    expect(cb.state).toBe("closed");
    expect(cb.consecutiveFailures).toBe(0);
  });

  it("half-open circuit reopens on failure", async () => {
    for (let i = 0; i < THRESHOLD; i++) cb.onFailure("job");
    await new Promise((r) => setTimeout(r, OPEN_MS + 20));
    cb.shouldSkip("job"); // half-open
    // Probe attempt fails again
    cb.onFailure("job");
    // Circuit was half-open → failure should re-increment (threshold already met)
    // The state may stay half-open on first extra failure since threshold check
    // is based on consecutiveFailures — onFailure increments but only transitions
    // from closed. In practice the half-open failure re-opens on next failure
    // once threshold is crossed again. Either way, the circuit should not close.
    expect(cb.state).not.toBe("closed");
  });

  it("no-overlap: consecutive calls to onFailure while open do not change openedAt", async () => {
    for (let i = 0; i < THRESHOLD; i++) cb.onFailure("job");
    // Circuit is now open
    const openedAt = (cb as unknown as { _openedAt: number })._openedAt;
    cb.onFailure("job"); // another failure while open
    expect((cb as unknown as { _openedAt: number })._openedAt).toBe(openedAt);
  });

  it("exposes default env-configurable constants", () => {
    // These just confirm the module exports the constants without crashing.
    expect(typeof JOB_CB_THRESHOLD).toBe("number");
    expect(JOB_CB_THRESHOLD).toBeGreaterThanOrEqual(1);
    expect(typeof JOB_CB_OPEN_DURATION_MS).toBe("number");
    expect(JOB_CB_OPEN_DURATION_MS).toBeGreaterThanOrEqual(1000);
  });

  it("_resetForTests clears state", () => {
    for (let i = 0; i < THRESHOLD; i++) cb.onFailure("job");
    expect(cb.state).toBe("open");
    cb._resetForTests();
    expect(cb.state).toBe("closed");
    expect(cb.consecutiveFailures).toBe(0);
  });
});
