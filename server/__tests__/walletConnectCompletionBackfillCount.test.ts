import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// Covers countMissingWalletConnectCompletions() — the read-only service
// function that compares the durable fired-alert markers against the
// wallet_connect_completed audit log and returns:
//   { scanned: N, missing: M }
//
// The function delegates the marker list to listFiredWalletConnectAlertMarkers
// (which queries appSettings) and then queries auditLogs for existing
// completion rows.  All four branches are exercised:
//   1. No markers → { scanned: 0, missing: 0 }  (early-return, no auditLogs query)
//   2. All markers have a completion row → { scanned: N, missing: 0 }
//   3. Some markers are missing a completion row → { scanned: N, missing: M }
//   4. DB error is swallowed → { scanned: 0, missing: 0 }
//
// Mirrors the mock pattern used by walletConnectAlertMarkerCount.test.ts.

interface AppSettingRow {
  key: string;
  value: string;
  updatedAt: Date | null;
}
interface AuditLogRow {
  action: string;
  targetId: string | null;
}

const appSettingsRows: AppSettingRow[] = [];
const auditLogRows: AuditLogRow[] = [];
let selectShouldThrow = false;

const APP_SETTINGS_TABLE = {
  __table: "app_settings",
  key: "app_settings.key",
  value: "app_settings.value",
  updatedAt: "app_settings.updatedAt",
};
const AUDIT_LOGS_TABLE = {
  __table: "audit_logs",
  action: "auditLogs.action",
  targetId: "auditLogs.targetId",
};

function fieldName(col: unknown): string {
  return String(col).split(".").pop() ?? "";
}

type Cond =
  | { op: "like"; col: unknown; pattern: string }
  | { op: "eq"; col: unknown; val: unknown }
  | { op: "inArray"; col: unknown; values: unknown[] }
  | { op: "and"; args: Cond[] }
  | { op: "or"; args: Cond[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  switch (cond.op) {
    case "like": {
      const v = row[fieldName(cond.col)];
      if (cond.pattern.endsWith("%")) {
        return (
          typeof v === "string" && v.startsWith(cond.pattern.slice(0, -1))
        );
      }
      return v === cond.pattern;
    }
    case "eq":
      return row[fieldName(cond.col)] === cond.val;
    case "inArray":
      return cond.values.includes(row[fieldName(cond.col)]);
    case "and":
      return cond.args.every((a) => matches(row, a));
    case "or":
      return cond.args.some((a) => matches(row, a));
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
  if (table.__table === "app_settings") {
    return appSettingsRows as unknown as Record<string, unknown>[];
  }
  return auditLogRows as unknown as Record<string, unknown>[];
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
  },
}));

vi.mock("@shared/schema", () => ({
  appSettings: APP_SETTINGS_TABLE,
  auditLogs: AUDIT_LOGS_TABLE,
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  like: (col: unknown, pattern: string) => ({ op: "like", col, pattern }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  inArray: (col: unknown, values: unknown[]) => ({ op: "inArray", col, values }),
  and: (...args: Cond[]) => ({ op: "and", args }),
  or: (...args: Cond[]) => ({ op: "or", args }),
}));

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

const FIRED_PREFIX = "wallet_connect_alert_fired:";

function firedRow(caseId: string): AppSettingRow {
  return { key: `${FIRED_PREFIX}${caseId}`, value: "true", updatedAt: null };
}

function completionRow(caseId: string): AuditLogRow {
  return { action: "wallet_connect_completed", targetId: caseId };
}

beforeEach(() => {
  appSettingsRows.length = 0;
  auditLogRows.length = 0;
  selectShouldThrow = false;
  vi.resetModules();
});

describe("countMissingWalletConnectCompletions", () => {
  it("returns { scanned: 0, missing: 0 } when there are no fired markers", async () => {
    // No markers — the early-return fires before any auditLogs query.
    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countMissingWalletConnectCompletions();

    expect(result).toEqual({ scanned: 0, missing: 0 });
  });

  it("returns { scanned: N, missing: 0 } when all markers have a completion row", async () => {
    appSettingsRows.push(firedRow("case-1"), firedRow("case-2"));
    auditLogRows.push(completionRow("case-1"), completionRow("case-2"));

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countMissingWalletConnectCompletions();

    expect(result).toEqual({ scanned: 2, missing: 0 });
  });

  it("returns { scanned: N, missing: M } when some markers are missing a completion row", async () => {
    appSettingsRows.push(
      firedRow("case-1"), // has completion
      firedRow("case-2"), // missing completion
      firedRow("case-3"), // missing completion
    );
    auditLogRows.push(completionRow("case-1"));

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countMissingWalletConnectCompletions();

    expect(result).toEqual({ scanned: 3, missing: 2 });
  });

  it("swallows a DB error and returns { scanned: 0, missing: 0 }", async () => {
    // Even with markers present, if the DB throws the function must not throw.
    appSettingsRows.push(firedRow("case-1"));
    selectShouldThrow = true;

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countMissingWalletConnectCompletions();

    expect(result).toEqual({ scanned: 0, missing: 0 });
  });

  it("uses listFiredWalletConnectAlertMarkers — only rows with value='true' count", async () => {
    // A marker row with value="false" (muted/reset) must not be counted.
    appSettingsRows.push(
      { key: `${FIRED_PREFIX}case-1`, value: "true", updatedAt: null },
      { key: `${FIRED_PREFIX}case-2`, value: "false", updatedAt: null },
    );
    // case-1 has a completion; case-2 is not even picked up as a marker.
    auditLogRows.push(completionRow("case-1"));

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countMissingWalletConnectCompletions();

    expect(result).toEqual({ scanned: 1, missing: 0 });
  });

  it("uses the supplied executor for the auditLogs query", async () => {
    appSettingsRows.push(firedRow("case-a"), firedRow("case-b"));
    auditLogRows.push(completionRow("case-a"));

    const executorCalls: string[] = [];
    const tx = {
      select: (sel: Record<string, unknown>) => ({
        from: (table: { __table: string }) => ({
          where: (cond: Cond) => {
            executorCalls.push(table.__table);
            const data = tableData(table);
            return Promise.resolve(
              data.filter((r) => matches(r, cond)).map((r) => project(r, sel)),
            );
          },
        }),
      }),
    };

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.countMissingWalletConnectCompletions({
      executor: tx as never,
    });

    expect(result).toEqual({ scanned: 2, missing: 1 });
    // The executor should have been used for the audit_logs query.
    expect(executorCalls).toContain("audit_logs");
  });
});
