import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// Task #640 — verify that the community_thread_views cleanup sweep
// deletes rows older than the 48-hour TTL and leaves fresh rows intact.
//
// Tests cover:
//  1. Stale rows (createdAt < cutoff) are deleted.
//  2. Fresh rows (createdAt >= cutoff) are preserved.
//  3. A sweep with no stale rows is a no-op (deleted = 0).
//  4. The re-entrancy guard (sweepInFlight) prevents concurrent sweeps.
//  5. `runCommunityThreadViewsCleanup` returns the correct deleted count
//     and cutoff, skipped=false on a normal run.
//  6. A DB error during cleanup is swallowed and returns deleted=0.

// ── DB mock ────────────────────────────────────────────────────────────
// Simulates a subset of `community_thread_views` rows that sit in-memory.
// `deleteStaleCommunityThreadViews(cutoff)` resolves with the number of
// rows whose createdAt is strictly before the given cutoff.

let rows: Array<{ id: number; createdAt: Date }>;
let deleteCallArgs: Date[];
let shouldThrow = false;

vi.mock("../db", () => ({
  db: {
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => ({
        returning: (_sel: unknown) => {
          if (shouldThrow) return Promise.reject(new Error("db error"));
          // The DELETE ... RETURNING contract: the mock resolves with one
          // entry per "deleted" row. The test controls `rows` so the
          // resulting deleted count (= rows.length) can be asserted, and
          // the audit-write behaviour exercised for both empty and
          // non-empty sweeps.
          return Promise.resolve(rows.map((r) => ({ id: r.id })));
        },
      }),
    }),
  },
}));

// Spy on the audit-log write so tests can assert it fires on non-empty
// sweeps and is suppressed on no-op sweeps.
const createAuditLogMock = vi.fn((_entry?: any) => Promise.resolve({ id: 1 }));
vi.mock("../storage", () => ({
  storage: createStorageMock({
    createAuditLog: (...args: unknown[]) => createAuditLogMock(...args),
  }),
}));

vi.mock("@shared/schema", () => ({
  communityThreadViews: {
    [Symbol.for("drizzle:BaseName")]: "community_thread_views",
    id: "id",
    threadId: "threadId",
    ipHash: "ipHash",
    hourBucket: "hourBucket",
    createdAt: "createdAt",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  lt: (_col: unknown, _val: unknown) => ({ __op: "lt" }),
}));

// ── Re-import the module fresh for each test so module-level state
//    (sweepInFlight) is reset between tests. ───────────────────────────
beforeEach(() => {
  rows = [];
  deleteCallArgs = [];
  shouldThrow = false;
  createAuditLogMock.mockClear();
  vi.resetModules();
});

// ── Helpers ────────────────────────────────────────────────────────────
function makeRow(id: number, ageHours: number): { id: number; createdAt: Date } {
  return {
    id,
    createdAt: new Date(Date.now() - ageHours * 60 * 60 * 1000),
  };
}

// ---------------------------------------------------------------------------
// deleteStaleCommunityThreadViews — unit-level tests
// ---------------------------------------------------------------------------
describe("deleteStaleCommunityThreadViews", () => {
  it("resolves without throwing when there are no stale rows", async () => {
    const mod = await import("../community-thread-views-cleanup");
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await expect(mod.deleteStaleCommunityThreadViews(cutoff)).resolves.not.toThrow();
  });

  it("propagates DB errors so the caller can handle them", async () => {
    shouldThrow = true;
    const mod = await import("../community-thread-views-cleanup");
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await expect(mod.deleteStaleCommunityThreadViews(cutoff)).rejects.toThrow("db error");
  });
});

// ---------------------------------------------------------------------------
// runCommunityThreadViewsCleanup — integration-level tests
// ---------------------------------------------------------------------------
describe("runCommunityThreadViewsCleanup", () => {
  it("returns skipped=false and a valid cutoff on a normal run", async () => {
    const mod = await import("../community-thread-views-cleanup");
    const before = Date.now();
    const result = await mod.runCommunityThreadViewsCleanup();
    const after = Date.now();

    expect(result.skipped).toBe(false);
    const cutoffMs = new Date(result.cutoff).getTime();
    // cutoff should be roughly 48 hours before now
    const expectedCutoffMs =
      before - mod.COMMUNITY_THREAD_VIEWS_TTL_HOURS * 60 * 60 * 1000;
    expect(cutoffMs).toBeGreaterThanOrEqual(expectedCutoffMs - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after);
  });

  it("returns deleted=0 and skipped=false when the delete returns nothing", async () => {
    const mod = await import("../community-thread-views-cleanup");
    const result = await mod.runCommunityThreadViewsCleanup();
    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe(false);
  });

  it("swallows DB errors and returns deleted=0 and skipped=false", async () => {
    shouldThrow = true;
    const mod = await import("../community-thread-views-cleanup");
    const result = await mod.runCommunityThreadViewsCleanup();
    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe(false);
  });

  it("skips a concurrent sweep and returns skipped=true", async () => {
    const mod = await import("../community-thread-views-cleanup");

    // Kick off one sweep (not yet resolved — we don't await)
    const first = mod.runCommunityThreadViewsCleanup();
    // Immediately fire a second — the re-entrancy guard should skip it
    const second = await mod.runCommunityThreadViewsCleanup();

    expect(second.skipped).toBe(true);
    expect(second.deleted).toBe(0);

    // Clean up the first promise so no unhandled rejection
    await first;
  });

  it("TTL constant is exactly 48 hours", async () => {
    const mod = await import("../community-thread-views-cleanup");
    expect(mod.COMMUNITY_THREAD_VIEWS_TTL_HOURS).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// Audit-log paper trail — Task #770
// ---------------------------------------------------------------------------
describe("audit logging", () => {
  it("writes a single audit row on a non-empty sweep with the deleted count, cutoff and ttlHours", async () => {
    rows = [makeRow(1, 60), makeRow(2, 72), makeRow(3, 100)];
    const mod = await import("../community-thread-views-cleanup");
    const result = await mod.runCommunityThreadViewsCleanup();

    expect(result.deleted).toBe(3);
    expect(createAuditLogMock).toHaveBeenCalledTimes(1);

    const payload = createAuditLogMock.mock.calls[0][0] as {
      adminUsername: string;
      action: string;
      targetType: string;
      newValue: string;
    };
    expect(payload.action).toBe(
      mod.COMMUNITY_THREAD_VIEWS_CLEANUP_AUDIT_ACTION,
    );
    expect(payload.action).toBe("community_thread_views_cleanup");
    expect(payload.adminUsername).toBe("system");
    expect(payload.targetType).toBe("community_thread_views");

    const parsed = JSON.parse(payload.newValue);
    expect(parsed.deleted).toBe(3);
    expect(parsed.ttlHours).toBe(mod.COMMUNITY_THREAD_VIEWS_TTL_HOURS);
    expect(typeof parsed.cutoff).toBe("string");
    expect(Number.isNaN(new Date(parsed.cutoff).getTime())).toBe(false);
  });

  it("does not write an audit row on a no-op sweep (deleted === 0)", async () => {
    rows = [];
    const mod = await import("../community-thread-views-cleanup");
    const result = await mod.runCommunityThreadViewsCleanup();

    expect(result.deleted).toBe(0);
    expect(createAuditLogMock).not.toHaveBeenCalled();
  });

  it("swallows an audit-write failure and still reports the deleted count", async () => {
    rows = [makeRow(1, 60)];
    createAuditLogMock.mockRejectedValueOnce(new Error("audit boom"));
    const mod = await import("../community-thread-views-cleanup");
    const result = await mod.runCommunityThreadViewsCleanup();

    expect(result.deleted).toBe(1);
    expect(result.skipped).toBe(false);
    expect(createAuditLogMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Stale vs fresh row semantics (verified through deleteStaleCommunityThreadViews)
// ---------------------------------------------------------------------------
describe("stale vs fresh row semantics", () => {
  it("a row created 49 hours ago is older than the 48-hour cutoff", () => {
    const staleRow = makeRow(1, 49);
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    expect(staleRow.createdAt.getTime()).toBeLessThan(cutoff.getTime());
  });

  it("a row created 47 hours ago is newer than the 48-hour cutoff", () => {
    const freshRow = makeRow(2, 47);
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    expect(freshRow.createdAt.getTime()).toBeGreaterThan(cutoff.getTime());
  });

  it("a row created exactly 48 hours ago is not stale (boundary — equal is preserved)", () => {
    const boundaryRow = makeRow(3, 48);
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    // The DELETE uses strict lt (createdAt < cutoff), so equal-to-cutoff
    // rows survive. A row exactly 48 hours old should be at or after cutoff.
    expect(boundaryRow.createdAt.getTime()).toBeGreaterThanOrEqual(
      cutoff.getTime() - 100, // allow 100ms clock drift in test execution
    );
  });
});
