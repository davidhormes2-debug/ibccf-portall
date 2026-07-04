import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// Task #823 — verify the read-only orphaned-marker count powering the admin
// "currently orphaned" line on the wallet-connect cleanup card:
//   • countOrphanedWalletConnectAlertMarkers() counts fired AND mute markers,
//     identifies the orphans whose owning case no longer exists in `cases`,
//     leaves live-case markers in the orphan-free count, and MUTATES NOTHING
//     (it stops before the delete the cleanup sweep would run).
//   • DB errors are swallowed (returns { scanned: 0, orphaned: 0 }) so a
//     transient failure can't crash the admin dashboard fetch.
//
// Mirrors the in-memory db/schema/drizzle mock used by
// walletConnectAlertMarkerCleanup.test.ts so the scan/diff runs against fake
// tables without real DB wiring.

interface AppSettingRow {
  key: string;
}
interface CaseRow {
  id: string;
}

const appSettingsRows: AppSettingRow[] = [];
const casesRows: CaseRow[] = [];
let selectShouldThrow = false;

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

// The count function only ever reads. We still expose delete() on the mock so
// that, if the implementation ever regresses into mutating, the test's
// "mutates nothing" assertions catch it instead of throwing on a missing method.
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
vi.mock("../storage", () => ({
  storage: createStorageMock({ createAuditLog: vi.fn(async () => {}) }),
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
  selectShouldThrow = false;
  vi.resetModules();
});

describe("countOrphanedWalletConnectAlertMarkers", () => {
  it("counts fired+mute markers and flags the orphans whose case is gone", async () => {
    casesRows.push({ id: "live-1" });
    appSettingsRows.push(
      { key: `${FIRED}live-1` }, // live — counted, not orphaned
      { key: `${MUTE}live-1` }, // live — counted, not orphaned
      { key: `${FIRED}gone-1` }, // orphan
      { key: `${MUTE}gone-1` }, // orphan
      { key: `${FIRED}gone-2` }, // orphan
      { key: "admin_alert_email" }, // unrelated — never matched/counted
    );

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countOrphanedWalletConnectAlertMarkers();

    expect(result).toEqual({ scanned: 5, orphaned: 3 });
  });

  it("mutates nothing — the markers and cases are untouched after counting", async () => {
    casesRows.push({ id: "live-1" });
    appSettingsRows.push(
      { key: `${FIRED}live-1` },
      { key: `${FIRED}gone-1` },
      { key: `${MUTE}gone-1` },
      { key: `${FIRED}gone-2` },
    );
    const before = appSettingsRows.map((r) => r.key).sort();

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countOrphanedWalletConnectAlertMarkers();

    expect(result).toEqual({ scanned: 4, orphaned: 3 });
    // Nothing deleted: the same rows remain after the count.
    expect(appSettingsRows.map((r) => r.key).sort()).toEqual(before);
    expect(casesRows).toHaveLength(1);
  });

  it("reports zero orphans when every marker's case still exists", async () => {
    casesRows.push({ id: "active" });
    appSettingsRows.push({ key: `${FIRED}active` }, { key: `${MUTE}active` });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countOrphanedWalletConnectAlertMarkers();

    expect(result).toEqual({ scanned: 2, orphaned: 0 });
  });

  it("returns { scanned: 0, orphaned: 0 } when there are no markers at all", async () => {
    appSettingsRows.push({ key: "admin_alert_email" });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countOrphanedWalletConnectAlertMarkers();

    expect(result).toEqual({ scanned: 0, orphaned: 0 });
  });

  it("counts every marker as orphaned when the cases table is empty", async () => {
    appSettingsRows.push(
      { key: `${FIRED}gone-1` },
      { key: `${MUTE}gone-2` },
    );

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countOrphanedWalletConnectAlertMarkers();

    expect(result).toEqual({ scanned: 2, orphaned: 2 });
  });

  it("runs the scan through a supplied executor when given one", async () => {
    casesRows.push({ id: "live" });
    appSettingsRows.push({ key: `${FIRED}live` }, { key: `${FIRED}gone` });

    const calls: string[] = [];
    const tx = {
      select: (sel: Record<string, unknown>) => ({
        from: (table: { __table: string }) => ({
          where: (cond: Cond) => {
            calls.push(table.__table);
            const data = tableData(table);
            return Promise.resolve(
              data.filter((r) => matches(r, cond)).map((r) => project(r, sel)),
            );
          },
        }),
      }),
    };

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countOrphanedWalletConnectAlertMarkers({
      executor: tx as never,
    });

    expect(result).toEqual({ scanned: 2, orphaned: 1 });
    // The scan ran against the executor (app_settings then cases), not `db`.
    expect(calls).toEqual(["app_settings", "cases"]);
  });

  it("swallows DB errors and returns zeros", async () => {
    selectShouldThrow = true;
    appSettingsRows.push({ key: `${FIRED}gone` });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countOrphanedWalletConnectAlertMarkers();

    expect(result).toEqual({ scanned: 0, orphaned: 0 });
  });
});
