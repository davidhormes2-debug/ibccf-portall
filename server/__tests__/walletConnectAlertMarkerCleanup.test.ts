import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// Task #764 — verify the wallet-connect alert marker cleanup:
//  • cleanupOrphanedWalletConnectAlertMarkers() drops fired/mute markers whose
//    owning case no longer exists, and NEVER touches a marker for a case that
//    still exists in `cases`.
//  • deleteWalletConnectAlertMarkersForCase() removes both markers for one case.
//  • The re-entrancy guard prevents concurrent sweeps.
//  • DB errors are swallowed (deleted=0) rather than crashing the scheduler.

// ── In-memory fake tables ──────────────────────────────────────────────────
interface AppSettingRow {
  key: string;
}
interface CaseRow {
  id: string;
}

const appSettingsRows: AppSettingRow[] = [];
const casesRows: CaseRow[] = [];
let selectShouldThrow = false;

// Table sentinels — `from()` / `delete()` receive these so the mock can route
// to the correct in-memory array.
const APP_SETTINGS_TABLE = { __table: "app_settings", key: "app_settings.key" };
const CASES_TABLE = { __table: "cases", id: "cases.id" };

function fieldName(col: unknown): string {
  return String(col).split(".").pop() ?? "";
}

type Cond =
  | { op: "like"; col: unknown; pattern: string }
  | { op: "or"; args: Cond[] }
  | { op: "inArray"; col: unknown; values: unknown[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  switch (cond.op) {
    case "like": {
      const v = row[fieldName(cond.col)];
      if (cond.pattern.endsWith("%")) {
        return typeof v === "string" && v.startsWith(cond.pattern.slice(0, -1));
      }
      return v === cond.pattern;
    }
    case "or":
      return cond.args.some((a) => matches(row, a));
    case "inArray":
      return cond.values.includes(row[fieldName(cond.col)]);
    default:
      return false;
  }
}

function project(
  row: Record<string, unknown>,
  sel: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const alias of Object.keys(sel)) {
    out[alias] = row[fieldName(sel[alias])];
  }
  return out;
}

function tableData(table: { __table: string }): Record<string, unknown>[] {
  return (table.__table === "app_settings"
    ? appSettingsRows
    : casesRows) as unknown as Record<string, unknown>[];
}

vi.mock("../db", () => ({
  db: {
    select: (sel: Record<string, unknown>) => ({
      from: (table: { __table: string }) => ({
        where: (cond: Cond) => {
          if (selectShouldThrow) return Promise.reject(new Error("db error"));
          const data = tableData(table);
          return Promise.resolve(
            data.filter((r) => matches(r, cond)).map((r) => project(r, sel)),
          );
        },
      }),
    }),
    delete: (table: { __table: string }) => ({
      where: (cond: Cond) => ({
        returning: (sel: Record<string, unknown>) => {
          const data = tableData(table);
          const toDelete = data.filter((r) => matches(r, cond));
          for (const r of toDelete) {
            const idx = data.indexOf(r);
            if (idx >= 0) data.splice(idx, 1);
          }
          return Promise.resolve(toDelete.map((r) => project(r, sel)));
        },
      }),
    }),
  },
}));

vi.mock("@shared/schema", () => ({
  appSettings: APP_SETTINGS_TABLE,
  cases: CASES_TABLE,
  auditLogs: { id: "auditLogs.id", action: "auditLogs.action", targetId: "auditLogs.targetId" },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  like: (col: unknown, pattern: string) => ({ op: "like", col, pattern }),
  or: (...args: Cond[]) => ({ op: "or", args }),
  inArray: (col: unknown, values: unknown[]) => ({ op: "inArray", col, values }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
}));

// walletConnectAlert imports these at module top; stub them so the import graph
// resolves without real SMTP/storage wiring.
interface AuditLogCall {
  payload: Record<string, unknown>;
  executor: unknown;
}
const auditLogCalls: AuditLogCall[] = [];
vi.mock("../storage", () => ({
  storage: createStorageMock({
    createAuditLog: vi.fn(
      async (payload: Record<string, unknown>, executor?: unknown) => {
        auditLogCalls.push({ payload, executor });
      },
    ),
  }),
}));
import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({ emailService: createEmailServiceMock({}) }));
vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(),
  resolveRecipientLocale: vi.fn(),
}));
vi.mock("../nda-integrity-sweep", () => ({
  ADMIN_ALERT_EMAIL_SETTING_KEY: "admin_alert_email",
  parseAdminAlertRecipients: () => [],
}));

const FIRED = "wallet_connect_alert_fired:";
const MUTE = "wallet_connect_alert_muted:";

beforeEach(() => {
  appSettingsRows.length = 0;
  casesRows.length = 0;
  auditLogCalls.length = 0;
  selectShouldThrow = false;
  vi.resetModules();
});

describe("cleanupOrphanedWalletConnectAlertMarkers", () => {
  it("deletes fired+mute markers for cases that no longer exist", async () => {
    casesRows.push({ id: "live-1" });
    appSettingsRows.push(
      { key: `${FIRED}live-1` }, // keep — case exists
      { key: `${MUTE}live-1` }, // keep — case exists
      { key: `${FIRED}gone-1` }, // orphan
      { key: `${MUTE}gone-1` }, // orphan
      { key: `${FIRED}gone-2` }, // orphan
      { key: "admin_alert_email" }, // unrelated — never matched
    );

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.cleanupOrphanedWalletConnectAlertMarkers();

    expect(result.skipped).toBe(false);
    expect(result.scanned).toBe(5); // five wallet_connect_alert_* markers
    expect(result.deleted).toBe(3); // the three orphan markers

    const remaining = appSettingsRows.map((r) => r.key).sort();
    expect(remaining).toEqual(
      [`${FIRED}live-1`, `${MUTE}live-1`, "admin_alert_email"].sort(),
    );
  });

  it("writes a single cleanup audit row on a non-empty batch", async () => {
    casesRows.push({ id: "live-1" });
    appSettingsRows.push(
      { key: `${FIRED}live-1` },
      { key: `${FIRED}gone-1` },
      { key: `${MUTE}gone-1` },
      { key: `${FIRED}gone-2` },
    );

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.cleanupOrphanedWalletConnectAlertMarkers();

    expect(result.deleted).toBe(3);
    expect(auditLogCalls).toHaveLength(1);
    const { payload } = auditLogCalls[0];
    expect(payload.action).toBe(
      mod.WALLET_CONNECT_ALERT_MARKER_CLEANUP_AUDIT_ACTION,
    );
    expect(payload.adminUsername).toBe("system");
    const parsed = JSON.parse(payload.newValue as string);
    expect(parsed.removed).toBe(3);
    expect(parsed.sampleCaseIds.sort()).toEqual(["gone-1", "gone-2"]);
    expect(parsed.sampleTruncated).toBe(false);
  });

  it("records the triggering admin when one is supplied", async () => {
    appSettingsRows.push({ key: `${FIRED}gone` });

    const mod = await import("../services/walletConnectAlert");
    await mod.cleanupOrphanedWalletConnectAlertMarkers({
      triggeredBy: "alice",
    });

    expect(auditLogCalls).toHaveLength(1);
    expect(auditLogCalls[0].payload.adminUsername).toBe("alice");
  });

  it("writes the audit row through the supplied executor", async () => {
    // A functional fake executor that drives the same in-memory tables as the
    // mocked top-level `db`, so the sweep's select/delete run against it.
    const tx = {
      select: (sel: Record<string, unknown>) => ({
        from: (table: { __table: string }) => ({
          where: (cond: Cond) => {
            const data = tableData(table);
            return Promise.resolve(
              data.filter((r) => matches(r, cond)).map((r) => project(r, sel)),
            );
          },
        }),
      }),
      delete: (table: { __table: string }) => ({
        where: (cond: Cond) => ({
          returning: (sel: Record<string, unknown>) => {
            const data = tableData(table);
            const toDelete = data.filter((r) => matches(r, cond));
            for (const r of toDelete) {
              const idx = data.indexOf(r);
              if (idx >= 0) data.splice(idx, 1);
            }
            return Promise.resolve(toDelete.map((r) => project(r, sel)));
          },
        }),
      }),
    };
    appSettingsRows.push({ key: `${FIRED}gone` });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.cleanupOrphanedWalletConnectAlertMarkers({
      executor: tx as never,
    });

    expect(result.deleted).toBe(1);
    expect(auditLogCalls).toHaveLength(1);
    expect(auditLogCalls[0].executor).toBe(tx);
  });

  it("does not write an audit row when nothing is removed", async () => {
    casesRows.push({ id: "active" });
    appSettingsRows.push({ key: `${FIRED}active` });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.cleanupOrphanedWalletConnectAlertMarkers();

    expect(result.deleted).toBe(0);
    expect(auditLogCalls).toHaveLength(0);
  });

  it("never removes a marker for a still-existing case", async () => {
    casesRows.push({ id: "active" });
    appSettingsRows.push({ key: `${FIRED}active` }, { key: `${MUTE}active` });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.cleanupOrphanedWalletConnectAlertMarkers();

    expect(result.deleted).toBe(0);
    expect(result.scanned).toBe(2);
    expect(appSettingsRows).toHaveLength(2);
  });

  it("is a no-op when there are no markers at all", async () => {
    appSettingsRows.push({ key: "admin_alert_email" });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.cleanupOrphanedWalletConnectAlertMarkers();

    expect(result).toEqual({ deleted: 0, scanned: 0, skipped: false });
    expect(appSettingsRows).toHaveLength(1);
  });

  it("swallows DB errors and returns deleted=0", async () => {
    selectShouldThrow = true;
    appSettingsRows.push({ key: `${FIRED}gone` });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.cleanupOrphanedWalletConnectAlertMarkers();

    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe(false);
  });

  it("skips a concurrent sweep via the re-entrancy guard", async () => {
    const mod = await import("../services/walletConnectAlert");
    const first = mod.cleanupOrphanedWalletConnectAlertMarkers();
    const second = await mod.cleanupOrphanedWalletConnectAlertMarkers();

    expect(second.skipped).toBe(true);
    expect(second.deleted).toBe(0);
    await first;
  });

  it("does not treat a whitespace-only key suffix as an orphan to delete", async () => {
    // Keys like `wallet_connect_alert_fired:   ` (spaces after the prefix)
    // have no valid caseId once the prefix is stripped. The trim guard must
    // prevent them from being queried against `cases` and must not include them
    // in the orphanKeys set — so they are never deleted by a cleanup sweep.
    appSettingsRows.push(
      { key: `${FIRED}real-case` }, // real marker — case exists
      { key: `${FIRED}   ` },       // whitespace-only suffix
      { key: `${MUTE}\t` },         // tab-only suffix
    );
    casesRows.push({ id: "real-case" });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.cleanupOrphanedWalletConnectAlertMarkers();

    // All three rows match the prefix pattern and are counted as scanned…
    expect(result.scanned).toBe(3);
    // …but the whitespace-only ones are NOT classified as orphans and NOT deleted.
    expect(result.deleted).toBe(0);
    // All three rows must still be present (none were removed).
    expect(appSettingsRows).toHaveLength(3);
  });
});

describe("deleteWalletConnectAlertMarkersForCase", () => {
  it("removes both markers for a single case and leaves others intact", async () => {
    appSettingsRows.push(
      { key: `${FIRED}target` },
      { key: `${MUTE}target` },
      { key: `${FIRED}other` },
      { key: "admin_alert_email" },
    );

    const mod = await import("../services/walletConnectAlert");
    const removed = await mod.deleteWalletConnectAlertMarkersForCase("target");

    expect(removed).toBe(2);
    const remaining = appSettingsRows.map((r) => r.key).sort();
    expect(remaining).toEqual([`${FIRED}other`, "admin_alert_email"].sort());
  });

  it("returns 0 when the case has no markers", async () => {
    appSettingsRows.push({ key: `${FIRED}someone-else` });

    const mod = await import("../services/walletConnectAlert");
    const removed = await mod.deleteWalletConnectAlertMarkersForCase("nobody");

    expect(removed).toBe(0);
    expect(appSettingsRows).toHaveLength(1);
  });
});
