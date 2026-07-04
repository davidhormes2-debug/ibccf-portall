import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// Verifies that listMutedWalletConnectAlertCaseIds returns only well-formed
// case IDs. In particular, a key whose suffix is pure whitespace (e.g. from a
// mistaken write that left trailing spaces after the prefix) must NOT appear in
// the returned list — the same trim guard applied to the fired-marker list.

interface AppSettingRow {
  key: string;
  value: string;
}

const appSettingsRows: AppSettingRow[] = [];
let selectShouldThrow = false;

const APP_SETTINGS_TABLE = {
  __table: "app_settings",
  key: "app_settings.key",
  value: "app_settings.value",
};
const CASES_TABLE = { __table: "cases", id: "cases.id" };

function fieldName(col: unknown): string {
  return String(col).split(".").pop() ?? "";
}

type Cond =
  | { op: "like"; col: unknown; pattern: string }
  | { op: "eq"; col: unknown; val: unknown }
  | { op: "and"; args: Cond[] }
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
    case "eq":
      return row[fieldName(cond.col)] === cond.val;
    case "and":
      return cond.args.every((a) => matches(row, a));
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

vi.mock("../db", () => ({
  db: {
    select: (sel: Record<string, unknown>) => ({
      from: (table: { __table: string }) => ({
        where: (cond: Cond) => {
          if (selectShouldThrow) return Promise.reject(new Error("db error"));
          const data =
            table.__table === "app_settings"
              ? (appSettingsRows as unknown as Record<string, unknown>[])
              : [];
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
  cases: CASES_TABLE,
  auditLogs: {
    id: "auditLogs.id",
    action: "auditLogs.action",
    targetId: "auditLogs.targetId",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  like: (col: unknown, pattern: string) => ({ op: "like", col, pattern }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...args: Cond[]) => ({ op: "and", args }),
  or: (...args: Cond[]) => ({ op: "or", args }),
  inArray: (col: unknown, values: unknown[]) => ({ op: "inArray", col, values }),
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

const MUTE = "wallet_connect_alert_muted:";

beforeEach(() => {
  appSettingsRows.length = 0;
  selectShouldThrow = false;
  vi.resetModules();
});

describe("listMutedWalletConnectAlertCaseIds", () => {
  it("returns IDs for muted cases", async () => {
    appSettingsRows.push(
      { key: `${MUTE}case-1`, value: "true" },
      { key: `${MUTE}case-2`, value: "true" },
    );

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.listMutedWalletConnectAlertCaseIds();

    expect(result).toEqual(["case-1", "case-2"]);
  });

  it("excludes a whitespace-only suffix from the returned list", async () => {
    // A key like `wallet_connect_alert_muted:   ` (spaces after the prefix)
    // must not produce a spurious muted case ID.
    appSettingsRows.push(
      { key: `${MUTE}real-case`, value: "true" },
      { key: `${MUTE}   `, value: "true" },
      { key: `${MUTE}\t`, value: "true" },
    );

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.listMutedWalletConnectAlertCaseIds();

    expect(result).toEqual(["real-case"]);
    expect(result).not.toContain("   ");
    expect(result).not.toContain("\t");
    expect(result).not.toContain("");
  });

  it("returns an empty array when no cases are muted", async () => {
    appSettingsRows.push({ key: "admin_alert_email", value: "ops@example.com" });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.listMutedWalletConnectAlertCaseIds();

    expect(result).toEqual([]);
  });

  it("returns an empty array when the db query fails", async () => {
    selectShouldThrow = true;
    appSettingsRows.push({ key: `${MUTE}case-1`, value: "true" });

    const mod = await import("../services/walletConnectAlert");
    const result = await mod.listMutedWalletConnectAlertCaseIds();

    expect(result).toEqual([]);
  });
});
