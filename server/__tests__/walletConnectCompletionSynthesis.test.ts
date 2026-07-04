import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// Covers synthesizeMissingWalletConnectCompletions() — the companion to
// countMissingWalletConnectCompletions that builds fake AuditLog rows for
// completions whose best-effort audit write failed, so the global audit-log
// view never shows gaps.
//
// Branches under test:
//   1. No fired markers → returns []
//   2. All markers already represented in existingLogs → returns []
//   3. Some markers missing → returns synthetic rows (negative IDs, correct
//      caseId, walletName from storage.getCaseById)
//   4. DB error in listFiredWalletConnectAlertMarkers is swallowed → returns []
//   5. storage.getCaseById failure falls back to walletName: null gracefully
//
// Mirrors the mock pattern used by walletConnectCompletionBackfillCount.test.ts.

interface AppSettingRow {
  key: string;
  value: string;
  updatedAt: Date | null;
}

const appSettingsRows: AppSettingRow[] = [];
let selectShouldThrow = false;

const APP_SETTINGS_TABLE = {
  __table: "app_settings",
  key: "app_settings.key",
  value: "app_settings.value",
  updatedAt: "app_settings.updatedAt",
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

// Storage mock — getCaseById is a vi.fn() so tests can override it.
const mockGetCaseById = vi.fn();

vi.mock("../db", () => ({
  db: {
    select: (sel: Record<string, unknown>) => ({
      from: (table: { __table: string }) => ({
        where: (cond: Cond) => {
          if (selectShouldThrow) return Promise.reject(new Error("db error"));
          const data =
            appSettingsRows as unknown as Record<string, unknown>[];
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
  auditLogs: {
    __table: "audit_logs",
    action: "auditLogs.action",
    targetId: "auditLogs.targetId",
  },
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
  storage: createStorageMock({
    createAuditLog: vi.fn(async () => {}),
    getCaseById: (...args: unknown[]) => mockGetCaseById(...args),
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

const FIRED_PREFIX = "wallet_connect_alert_fired:";

function firedRow(
  caseId: string,
  updatedAt: Date | null = null,
): AppSettingRow {
  return { key: `${FIRED_PREFIX}${caseId}`, value: "true", updatedAt };
}

function existingLog(caseId: string) {
  return { action: "wallet_connect_completed", targetId: caseId };
}

beforeEach(() => {
  appSettingsRows.length = 0;
  selectShouldThrow = false;
  mockGetCaseById.mockReset();
  vi.resetModules();
});

describe("synthesizeMissingWalletConnectCompletions", () => {
  it("returns [] when there are no fired markers", async () => {
    // No markers at all — the early-return fires before any getCaseById call.
    const mod = await import("../services/walletConnectAlert");
    const result = await mod.synthesizeMissingWalletConnectCompletions([]);

    expect(result).toEqual([]);
  });

  it("returns [] when all markers are already represented in existingLogs", async () => {
    appSettingsRows.push(firedRow("case-1"), firedRow("case-2"));
    mockGetCaseById.mockResolvedValue(null);

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.synthesizeMissingWalletConnectCompletions([
      existingLog("case-1"),
      existingLog("case-2"),
    ]);

    expect(result).toEqual([]);
    expect(mockGetCaseById).not.toHaveBeenCalled();
  });

  it("synthesizes rows for markers missing from existingLogs", async () => {
    const ts = new Date("2024-06-01T00:00:00Z");
    appSettingsRows.push(
      firedRow("case-1", ts), // already in existingLogs
      firedRow("case-2", ts), // missing
      firedRow("case-3", ts), // missing
    );
    mockGetCaseById.mockImplementation(async (id: string) => ({
      id,
      walletExchangeName: id === "case-2" ? "Binance" : "Coinbase",
    }));

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.synthesizeMissingWalletConnectCompletions([
      existingLog("case-1"),
    ]);

    expect(result).toHaveLength(2);

    // All synthetic rows must have negative IDs and be unique.
    const ids = result.map((r) => r.id);
    expect(ids.every((id) => id < 0)).toBe(true);
    expect(new Set(ids).size).toBe(2);

    // Rows carry the correct action, targetType, and caseId.
    for (const row of result) {
      expect(row.action).toBe("wallet_connect_completed");
      expect(row.targetType).toBe("case");
      expect(row.adminUsername).toBe("system");
    }

    const byCase = Object.fromEntries(
      result.map((r) => [r.targetId, r]),
    );
    expect(byCase["case-2"]).toBeDefined();
    expect(JSON.parse(byCase["case-2"].newValue as string)).toEqual({
      walletName: "Binance",
    });
    expect(byCase["case-3"]).toBeDefined();
    expect(JSON.parse(byCase["case-3"].newValue as string)).toEqual({
      walletName: "Coinbase",
    });

    // createdAt falls back to the marker's updatedAt.
    expect(byCase["case-2"].createdAt).toEqual(ts);
  });

  it("uses marker.updatedAt as createdAt, falling back to a Date when null", async () => {
    appSettingsRows.push(firedRow("case-x", null));
    mockGetCaseById.mockResolvedValue(null);

    const before = new Date();
    const mod = await import("../services/walletConnectAlert");
    const result = await mod.synthesizeMissingWalletConnectCompletions([]);
    const after = new Date();

    expect(result).toHaveLength(1);
    const row = result[0];
    // createdAt must be a valid Date in the range [before, after].
    expect(row.createdAt instanceof Date).toBe(true);
    expect((row.createdAt as Date).getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 100,
    );
    expect((row.createdAt as Date).getTime()).toBeLessThanOrEqual(
      after.getTime() + 100,
    );
  });

  it("swallows a DB error from listFiredWalletConnectAlertMarkers and returns []", async () => {
    appSettingsRows.push(firedRow("case-1"));
    selectShouldThrow = true;

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.synthesizeMissingWalletConnectCompletions([]);

    expect(result).toEqual([]);
    expect(mockGetCaseById).not.toHaveBeenCalled();
  });

  it("falls back to walletName: null when getCaseById throws", async () => {
    appSettingsRows.push(firedRow("case-err"));
    mockGetCaseById.mockRejectedValue(new Error("storage failure"));

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.synthesizeMissingWalletConnectCompletions([]);

    expect(result).toHaveLength(1);
    expect(JSON.parse(result[0].newValue as string)).toEqual({
      walletName: null,
    });
  });

  it("falls back to walletName: null when getCaseById returns null", async () => {
    appSettingsRows.push(firedRow("case-gone"));
    mockGetCaseById.mockResolvedValue(null);

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.synthesizeMissingWalletConnectCompletions([]);

    expect(result).toHaveLength(1);
    expect(JSON.parse(result[0].newValue as string)).toEqual({
      walletName: null,
    });
  });

  it("only synthesizes for markers with value='true'", async () => {
    appSettingsRows.push(
      { key: `${FIRED_PREFIX}case-active`, value: "true", updatedAt: null },
      { key: `${FIRED_PREFIX}case-reset`, value: "false", updatedAt: null },
    );
    mockGetCaseById.mockResolvedValue({
      id: "case-active",
      walletExchangeName: "Kraken",
    });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.synthesizeMissingWalletConnectCompletions([]);

    // Only the "true" marker is synthesized; the "false" one is ignored.
    expect(result).toHaveLength(1);
    expect(result[0].targetId).toBe("case-active");
  });

  it("excludes a marker row whose key suffix is whitespace-only", async () => {
    // Key is the prefix followed by spaces only — slicing yields caseId="   ".
    // The filter must trim before checking length so this is dropped silently.
    appSettingsRows.push({
      key: `${FIRED_PREFIX}   `,
      value: "true",
      updatedAt: null,
    });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.synthesizeMissingWalletConnectCompletions([]);

    expect(result).toEqual([]);
    expect(mockGetCaseById).not.toHaveBeenCalled();
  });

  it("excludes a marker row whose key equals the bare prefix (empty caseId)", async () => {
    // Key is exactly the prefix with no suffix — slicing yields caseId="".
    // The .filter((m) => m.caseId.length > 0) guard must drop it silently.
    appSettingsRows.push({ key: FIRED_PREFIX, value: "true", updatedAt: null });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.synthesizeMissingWalletConnectCompletions([]);

    expect(result).toEqual([]);
    expect(mockGetCaseById).not.toHaveBeenCalled();
  });

  it("only synthesizes valid-caseId rows when mixed with empty-caseId rows", async () => {
    const ts = new Date("2024-09-01T00:00:00Z");
    // One row with no suffix (empty caseId) and two with valid caseIds.
    appSettingsRows.push(
      { key: FIRED_PREFIX, value: "true", updatedAt: ts }, // empty caseId → excluded
      firedRow("case-a", ts),
      firedRow("case-b", ts),
    );
    mockGetCaseById.mockImplementation(async (id: string) => ({
      id,
      walletExchangeName: id === "case-a" ? "Gemini" : "Kraken",
    }));

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.synthesizeMissingWalletConnectCompletions([]);

    // Only the two valid-caseId rows must produce synthetic entries.
    expect(result).toHaveLength(2);
    const targetIds = result.map((r) => r.targetId).sort();
    expect(targetIds).toEqual(["case-a", "case-b"]);

    const byCase = Object.fromEntries(result.map((r) => [r.targetId, r]));
    expect(JSON.parse(byCase["case-a"].newValue as string)).toEqual({
      walletName: "Gemini",
    });
    expect(JSON.parse(byCase["case-b"].newValue as string)).toEqual({
      walletName: "Kraken",
    });
    // The empty-caseId row must never reach getCaseById.
    expect(mockGetCaseById).toHaveBeenCalledTimes(2);
  });

  it("ignores existingLog entries where targetId is null", async () => {
    appSettingsRows.push(firedRow("case-x"));
    mockGetCaseById.mockResolvedValue({
      id: "case-x",
      walletExchangeName: "OKX",
    });

    const mod = await import("../services/walletConnectAlert");
    // Passing a log with action=wallet_connect_completed but targetId=null
    // must not suppress the synthetic row for case-x.
    const result = await mod.synthesizeMissingWalletConnectCompletions([
      { action: "wallet_connect_completed", targetId: null },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].targetId).toBe("case-x");
  });
});
