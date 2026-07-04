import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "../__tests__/helpers/storageMock";

// ── Task #826 — durable completion-backfill tests ─────────────────────────────
// backfillMissingWalletConnectCompletions durably persists a
// `wallet_connect_completed` audit row for every fired
// `wallet_connect_alert_fired:<caseId>` marker that has no completion row yet,
// so the read-time reconciliation (Task #786) becomes a safety net rather than
// the permanent source of truth. It must be idempotent (never double-write a
// case that already has a row) and stamp each row at the marker's own timestamp.

// ── In-memory state ──────────────────────────────────────────────────────────

// Rows returned by the marker query (select(key,updatedAt).from(appSettings)).
let markerRows: Array<{ key: string; updatedAt: Date | null }> = [];
// Rows returned by the existing-completion query (select(targetId).from(auditLogs)).
let existingCompletionRows: Array<{ targetId: string | null }> = [];
// Captures every row inserted by the backfill.
const insertedRows: any[] = [];
// caseId → walletExchangeName, used by the getCaseById fallback for walletName.
const caseWalletNames = new Map<string, string | null>();

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  db: {
    select: vi.fn((cols: any) => ({
      from: vi.fn(() => ({
        // The two select() chains are distinguished by their projection: the
        // existing-completion query projects `targetId`, the marker query
        // projects `key`/`updatedAt`.
        where: vi.fn(async () =>
          cols && "targetId" in cols ? existingCompletionRows : markerRows,
        ),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (vals: any) => {
        insertedRows.push(vals);
      }),
    })),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: vi.fn((...args: any[]) => ({ _type: "and", args })),
  eq: vi.fn((col: any, val: any) => ({ _type: "eq", col, val })),
  like: vi.fn((col: any, val: any) => ({ _type: "like", col, val })),
  inArray: vi.fn((col: any, vals: any) => ({ _type: "inArray", col, vals })),
}));

vi.mock("@shared/schema", () => ({
  appSettings: {
    key: "app_settings.key",
    value: "app_settings.value",
    updatedAt: "app_settings.updated_at",
  },
  auditLogs: {
    action: "audit_logs.action",
    targetId: "audit_logs.target_id",
  },
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getCaseById: vi.fn(async (id: string) => ({
      id,
      walletExchangeName: caseWalletNames.has(id)
        ? caseWalletNames.get(id)
        : null,
    })),
  }),
}));

// walletConnectAlert.ts imports these at module load; stub them so the import
// has no side effects.
vi.mock("../services/EmailService", () => ({ emailService: {} }));
vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(),
  resolveRecipientLocale: vi.fn(),
}));
vi.mock("../nda-integrity-sweep", () => ({
  ADMIN_ALERT_EMAIL_SETTING_KEY: "admin_alert_email",
  parseAdminAlertRecipients: () => [],
}));

// ── Import after mocks ───────────────────────────────────────────────────────

const {
  backfillMissingWalletConnectCompletions,
  __resetWalletConnectCompletionBackfillGuardForTests,
} = await import("../services/walletConnectAlert");

// ── Helpers ──────────────────────────────────────────────────────────────────

function firedMarker(caseId: string, updatedAt: Date | null) {
  return { key: `wallet_connect_alert_fired:${caseId}`, updatedAt };
}

beforeEach(() => {
  markerRows = [];
  existingCompletionRows = [];
  insertedRows.length = 0;
  caseWalletNames.clear();
  __resetWalletConnectCompletionBackfillGuardForTests();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("backfillMissingWalletConnectCompletions", () => {
  it("does nothing when there are no fired markers", async () => {
    markerRows = [];

    const result = await backfillMissingWalletConnectCompletions();

    expect(result).toEqual({ scanned: 0, inserted: 0, skipped: false });
    expect(insertedRows).toHaveLength(0);
  });

  it("durably inserts a completion row for a marker with no audit row", async () => {
    const at = new Date("2026-03-04T05:06:07Z");
    markerRows = [firedMarker("case-1", at)];
    caseWalletNames.set("case-1", "MetaMask");

    const result = await backfillMissingWalletConnectCompletions();

    expect(result).toEqual({ scanned: 1, inserted: 1, skipped: false });
    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0];
    expect(row.action).toBe("wallet_connect_completed");
    expect(row.targetType).toBe("case");
    expect(row.targetId).toBe("case-1");
    expect(row.adminUsername).toBe("system");
    // Stamped at the marker's own timestamp, not backfill time.
    expect(row.createdAt).toEqual(at);
    expect(JSON.parse(row.newValue)).toEqual({ walletName: "MetaMask" });
  });

  it("is idempotent — never re-writes a case that already has a completion row", async () => {
    markerRows = [firedMarker("case-1", new Date())];
    existingCompletionRows = [{ targetId: "case-1" }];

    const result = await backfillMissingWalletConnectCompletions();

    expect(result).toEqual({ scanned: 1, inserted: 0, skipped: false });
    expect(insertedRows).toHaveLength(0);
  });

  it("only backfills the markers still missing a completion row", async () => {
    markerRows = [
      firedMarker("case-1", new Date()),
      firedMarker("case-2", new Date()),
      firedMarker("case-3", new Date()),
    ];
    existingCompletionRows = [{ targetId: "case-1" }];

    const result = await backfillMissingWalletConnectCompletions();

    expect(result.scanned).toBe(3);
    expect(result.inserted).toBe(2);
    expect(insertedRows.map((r) => r.targetId).sort()).toEqual([
      "case-2",
      "case-3",
    ]);
  });

  it("falls back to a null walletName and a fresh timestamp when unavailable", async () => {
    markerRows = [firedMarker("case-1", null)];

    const before = Date.now();
    const result = await backfillMissingWalletConnectCompletions();
    const after = Date.now();

    expect(result.inserted).toBe(1);
    const row = insertedRows[0];
    expect(JSON.parse(row.newValue)).toEqual({ walletName: null });
    const ts = new Date(row.createdAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("short-circuits when a backfill is already in flight", async () => {
    markerRows = [firedMarker("case-1", new Date())];

    // First call runs to completion and releases the guard, so simulate
    // concurrency by holding the guard via a slow getCaseById.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { storage } = await import("../storage");
    (storage.getCaseById as any).mockImplementationOnce(async (id: string) => {
      await gate;
      return { id, walletExchangeName: null };
    });

    const first = backfillMissingWalletConnectCompletions();
    const second = await backfillMissingWalletConnectCompletions();

    expect(second).toEqual({ scanned: 0, inserted: 0, skipped: true });

    release();
    const firstResult = await first;
    expect(firstResult.inserted).toBe(1);
  });
});
