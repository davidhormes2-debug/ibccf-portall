import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must precede any import of the module under test
// ---------------------------------------------------------------------------

// In-memory store of "active warning, not yet disabled" case rows.
// Each entry represents a DB row; the sweep should query by the SQL
// condition (portalWarningAt + portalWarningMinutes minutes <= now, isDisabled=false).
// We model that condition at the mock level by controlling what the select returns.
let expiredRows: Array<{ id: string }> = [];
let shouldSelectThrow = false;
let shouldSelectHang = false;
let hangResolve: (() => void) | null = null;

vi.mock("../db", () => ({
  db: {
    select: (_fields: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          if (shouldSelectThrow) return Promise.reject(new Error("db select error"));
          if (shouldSelectHang) {
            return new Promise<{ id: string }[]>((resolve) => {
              hangResolve = () => resolve([]);
            });
          }
          return Promise.resolve(expiredRows);
        },
      }),
    }),
  },
}));

// Track disableAndResetPathway calls so assertions can verify the exact
// caseId, reason, and actor without exercising the real DB.
const disableCalls: Array<{ caseId: string; reason: string; actor: string }> = [];
let shouldDisableThrow = false;

vi.mock("../services/pathwayReset", () => ({
  disableAndResetPathway: vi.fn(async (caseId: string, reason: string, actor: string) => {
    if (shouldDisableThrow) throw new Error("disable error");
    disableCalls.push({ caseId, reason, actor });
  }),
}));

// Track notifyAdmin calls for notification-behavior assertions.
const notifyAdminCalls: Array<{ type: string; title: string; body?: string; link?: string }> = [];

vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyAdmin: vi.fn(async (type: string, title: string, body?: string, link?: string) => {
      notifyAdminCalls.push({ type, title, body, link });
      return { id: notifyAdminCalls.length, type, title, body, link };
    }),
  },
}));

// Stub schema symbols so drizzle-orm helpers don't crash without a real DB.
vi.mock("@shared/schema", () => ({
  cases: {
    [Symbol.for("drizzle:BaseName")]: "cases",
    id: "id",
    isDisabled: "is_disabled",
    portalWarningAt: "portal_warning_at",
    portalWarningMinutes: "portal_warning_minutes",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: (..._args: unknown[]) => ({ __op: "and" }),
  isNotNull: (_col: unknown) => ({ __op: "isNotNull" }),
  eq: (_col: unknown, _val: unknown) => ({ __op: "eq" }),
  lte: (_col: unknown, _val: unknown) => ({ __op: "lte" }),
  sql: Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => ({ __op: "sql" }),
    { raw: (_s: string) => ({ __op: "sql.raw" }) },
  ),
}));

// ---------------------------------------------------------------------------
// Reset per-test state
// ---------------------------------------------------------------------------

beforeEach(() => {
  expiredRows = [];
  disableCalls.length = 0;
  notifyAdminCalls.length = 0;
  shouldSelectThrow = false;
  shouldSelectHang = false;
  hangResolve = null;
  shouldDisableThrow = false;
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// runPortalWarningExpirySweep — core behavior
// ---------------------------------------------------------------------------

describe("runPortalWarningExpirySweep", () => {
  it("returns processed=0, skipped=false, and empty closedCaseIds when there are no expired warnings", async () => {
    expiredRows = [];
    const mod = await import("../portal-warning-expiry-sweep");
    const result = await mod.runPortalWarningExpirySweep();
    expect(result).toEqual({ processed: 0, skipped: false, closedCaseIds: [] });
  });

  it("calls disableAndResetPathway for each expired case with reason='expired' and actor='system'", async () => {
    expiredRows = [{ id: "case-aaa" }, { id: "case-bbb" }];
    const mod = await import("../portal-warning-expiry-sweep");
    const result = await mod.runPortalWarningExpirySweep();

    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(false);
    expect(result.closedCaseIds).toEqual(["case-aaa", "case-bbb"]);
    expect(disableCalls).toHaveLength(2);
    expect(disableCalls[0]).toEqual({ caseId: "case-aaa", reason: "expired", actor: "system" });
    expect(disableCalls[1]).toEqual({ caseId: "case-bbb", reason: "expired", actor: "system" });
  });

  it("continues processing remaining cases when one disableAndResetPathway call fails", async () => {
    expiredRows = [{ id: "case-fail" }, { id: "case-ok" }];
    let callCount = 0;
    const { disableAndResetPathway } = await import("../services/pathwayReset");
    vi.mocked(disableAndResetPathway).mockImplementation(async (caseId, reason, actor) => {
      callCount++;
      if (callCount === 1) throw new Error("transient error");
      disableCalls.push({ caseId, reason, actor });
    });

    const mod = await import("../portal-warning-expiry-sweep");
    const result = await mod.runPortalWarningExpirySweep();

    // Only case-ok was successfully processed; case-fail must not appear in closedCaseIds
    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(false);
    expect(result.closedCaseIds).toEqual(["case-ok"]);
    expect(disableCalls).toHaveLength(1);
    expect(disableCalls[0].caseId).toBe("case-ok");
  });

  it("swallows a DB select error and returns processed=0, skipped=false, and empty closedCaseIds", async () => {
    shouldSelectThrow = true;
    const mod = await import("../portal-warning-expiry-sweep");
    const result = await mod.runPortalWarningExpirySweep();
    expect(result).toEqual({ processed: 0, skipped: false, closedCaseIds: [] });
  });

  it("creates one portal_warning_expired admin notification per disabled case", async () => {
    expiredRows = [{ id: "case-aaa" }, { id: "case-bbb" }];
    const mod = await import("../portal-warning-expiry-sweep");
    await mod.runPortalWarningExpirySweep();

    // Wait a tick so the fire-and-forget notification promises resolve
    await new Promise((r) => setImmediate(r));

    expect(notifyAdminCalls).toHaveLength(2);
    for (const call of notifyAdminCalls) {
      expect(call.type).toBe("portal_warning_expired");
    }
    const links = notifyAdminCalls.map((c) => c.link ?? "");
    expect(links.some((l) => l === "/admin?tab=cases&caseId=case-aaa")).toBe(true);
    expect(links.some((l) => l === "/admin?tab=cases&caseId=case-bbb")).toBe(true);
    const bodies = notifyAdminCalls.map((c) => c.body ?? "");
    expect(bodies.some((b) => b.includes("case-aaa"))).toBe(true);
    expect(bodies.some((b) => b.includes("case-bbb"))).toBe(true);
  });

  it("does not create a notification when disableAndResetPathway throws", async () => {
    expiredRows = [{ id: "case-fail" }];
    const { disableAndResetPathway } = await import("../services/pathwayReset");
    vi.mocked(disableAndResetPathway).mockRejectedValueOnce(new Error("disable error"));
    const mod = await import("../portal-warning-expiry-sweep");
    await mod.runPortalWarningExpirySweep();
    await new Promise((r) => setImmediate(r));
    expect(notifyAdminCalls).toHaveLength(0);
  });

  it("still reports the case as processed when notifyAdmin rejects", async () => {
    expiredRows = [{ id: "case-x" }];
    const { notificationService } = await import("../services/NotificationService");
    vi.mocked(notificationService.notifyAdmin).mockRejectedValueOnce(
      new Error("notification store error"),
    );
    const mod = await import("../portal-warning-expiry-sweep");
    const result = await mod.runPortalWarningExpirySweep();
    await new Promise((r) => setImmediate(r));
    // processed count must not be affected by a notification failure
    expect(result.processed).toBe(1);
  });

  it("does not create notifications when there are no expired cases", async () => {
    expiredRows = [];
    const mod = await import("../portal-warning-expiry-sweep");
    await mod.runPortalWarningExpirySweep();
    await new Promise((r) => setImmediate(r));
    expect(notifyAdminCalls).toHaveLength(0);
  });

  it("returns skipped=true when a sweep is already in-flight (re-entrancy guard)", async () => {
    // Make the DB select hang so the first sweep stays in-flight
    shouldSelectHang = true;

    const mod = await import("../portal-warning-expiry-sweep");
    const first = mod.runPortalWarningExpirySweep(); // starts but hangs on DB select
    const second = await mod.runPortalWarningExpirySweep(); // should be skipped immediately

    expect(second.skipped).toBe(true);
    expect(second.processed).toBe(0);

    // Unblock the first sweep so no unhandled promise rejection
    hangResolve?.();
    await first;
  });
});

// ---------------------------------------------------------------------------
// SWEEP_INTERVAL_MS — constant guard
// ---------------------------------------------------------------------------

describe("SWEEP_INTERVAL_MS", () => {
  it("equals exactly 5 minutes (300,000 ms)", async () => {
    const mod = await import("../portal-warning-expiry-sweep");
    expect(mod.SWEEP_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// startPortalWarningExpirySweep — setInterval wiring guard
// ---------------------------------------------------------------------------

describe("startPortalWarningExpirySweep", () => {
  it("passes exactly 300,000 ms as the interval to setInterval", async () => {
    // Stub setInterval so no live timer handle is left open after the test.
    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation((_fn: TimerHandler, _ms?: number) => 0 as unknown as ReturnType<typeof setInterval>);
    try {
      const mod = await import("../portal-warning-expiry-sweep");
      mod.startPortalWarningExpirySweep();

      // startPortalWarningExpirySweep fires one boot run via runPortalWarningExpirySweep
      // and then calls setInterval exactly once for the recurring sweep.
      expect(setIntervalSpy).toHaveBeenCalledOnce();
      const [callbackArg, intervalArg] = setIntervalSpy.mock.calls[0];
      expect(typeof callbackArg).toBe("function");
      expect(intervalArg).toBe(300_000);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Expiry logic — unit-level date math
// ---------------------------------------------------------------------------

describe("expiry date-math semantics", () => {
  it("a warning set 61 minutes ago with 60 minute duration has expired", () => {
    const portalWarningAt = new Date(Date.now() - 61 * 60 * 1000);
    const portalWarningMinutes = 60;
    const expiresAt = new Date(portalWarningAt.getTime() + portalWarningMinutes * 60 * 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("a warning set 59 minutes ago with 60 minute duration has NOT expired", () => {
    const portalWarningAt = new Date(Date.now() - 59 * 60 * 1000);
    const portalWarningMinutes = 60;
    const expiresAt = new Date(portalWarningAt.getTime() + portalWarningMinutes * 60 * 1000);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
