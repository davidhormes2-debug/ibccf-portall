import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "../__tests__/helpers/storageMock";

// ── Task #786 — global audit-log reconciliation tests ─────────────────────────
// synthesizeMissingWalletConnectCompletions reconstructs the best-effort
// `wallet_connect_completed` audit rows that never persisted (Task #676) from
// the durable `wallet_connect_alert_fired:<caseId>` markers, so the global
// audit-log view stays complete the same way the per-case Activity Timeline does.

// ── In-memory state ──────────────────────────────────────────────────────────

// Rows returned by the marker query (db.select(...).from(appSettings).where(...)).
let markerRows: Array<{ key: string; updatedAt: Date | null }> = [];
// caseId → walletExchangeName, used by the getCaseById fallback for walletName.
const caseWalletNames = new Map<string, string | null>();

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => markerRows),
      })),
    })),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: vi.fn((...args: any[]) => ({ _type: "and", args })),
  eq: vi.fn((col: any, val: any) => ({ _type: "eq", col, val })),
  like: vi.fn((col: any, val: any) => ({ _type: "like", col, val })),
  or: vi.fn((...args: any[]) => ({ _type: "or", args })),
  inArray: vi.fn((col: any, vals: any[]) => ({ _type: "inArray", col, vals })),
}));

vi.mock("@shared/schema", () => ({
  appSettings: {
    key: "app_settings.key",
    value: "app_settings.value",
    updatedAt: "app_settings.updated_at",
  },
  cases: {
    id: "cases.id",
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
  synthesizeMissingWalletConnectCompletions,
  backfillMissingWalletConnectCompletions,
  listFiredWalletConnectAlertMarkers,
  listMutedWalletConnectAlertCaseIds,
  countOrphanedWalletConnectAlertMarkers,
  cleanupOrphanedWalletConnectAlertMarkers,
  __resetWalletConnectAlertCleanupGuardForTests,
} = await import("../services/walletConnectAlert");

// ── Helpers ──────────────────────────────────────────────────────────────────

function firedMarker(caseId: string, updatedAt: Date | null) {
  return { key: `wallet_connect_alert_fired:${caseId}`, updatedAt };
}

beforeEach(() => {
  markerRows = [];
  caseWalletNames.clear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("listFiredWalletConnectAlertMarkers", () => {
  it("maps marker rows to {caseId, updatedAt}, stripping the prefix", async () => {
    const at = new Date("2026-01-02T03:04:05Z");
    markerRows = [firedMarker("case-1", at)];

    const markers = await listFiredWalletConnectAlertMarkers();

    expect(markers).toEqual([{ caseId: "case-1", updatedAt: at }]);
  });

  it("drops rows whose key has no caseId suffix", async () => {
    markerRows = [
      { key: "wallet_connect_alert_fired:", updatedAt: new Date() },
      firedMarker("case-2", null),
    ];

    const markers = await listFiredWalletConnectAlertMarkers();

    expect(markers).toEqual([{ caseId: "case-2", updatedAt: null }]);
  });

  it("excludes a whitespace-only suffix from the returned list", async () => {
    // A key like `wallet_connect_alert_fired:   ` (spaces after the prefix)
    // must not produce a spurious fired-marker entry — the same trim guard
    // applied to the mute-marker list reader.
    markerRows = [
      firedMarker("real-case", new Date("2026-01-01T00:00:00Z")),
      { key: "wallet_connect_alert_fired:   ", updatedAt: null },
      { key: "wallet_connect_alert_fired:\t", updatedAt: null },
    ];

    const markers = await listFiredWalletConnectAlertMarkers();

    expect(markers.map((m) => m.caseId)).toEqual(["real-case"]);
    expect(markers.some((m) => m.caseId.trim() === "")).toBe(false);
  });
});

describe("synthesizeMissingWalletConnectCompletions", () => {
  it("returns nothing when there are no fired markers", async () => {
    markerRows = [];

    const synthetic = await synthesizeMissingWalletConnectCompletions([]);

    expect(synthetic).toEqual([]);
  });

  it("does not duplicate a completion that already has an audit row", async () => {
    markerRows = [firedMarker("case-1", new Date())];

    const synthetic = await synthesizeMissingWalletConnectCompletions([
      { action: "wallet_connect_completed", targetId: "case-1" },
    ]);

    expect(synthetic).toEqual([]);
  });

  it("synthesizes a completion row when the marker fired but the audit row is missing", async () => {
    const at = new Date("2026-03-04T05:06:07Z");
    markerRows = [firedMarker("case-1", at)];
    caseWalletNames.set("case-1", "MetaMask");

    const synthetic = await synthesizeMissingWalletConnectCompletions([
      // An unrelated row for the same case must not count as a completion.
      { action: "wallet_exchange_selected", targetId: "case-1" },
    ]);

    expect(synthetic).toHaveLength(1);
    const row = synthetic[0];
    expect(row.action).toBe("wallet_connect_completed");
    expect(row.targetType).toBe("case");
    expect(row.targetId).toBe("case-1");
    expect(row.adminUsername).toBe("system");
    expect(row.createdAt).toEqual(at);
    expect(row.id).toBeLessThan(0);
    expect(JSON.parse(row.newValue ?? "{}")).toEqual({ walletName: "MetaMask" });
  });

  it("falls back to a null walletName and a fresh timestamp when unavailable", async () => {
    markerRows = [firedMarker("case-1", null)];

    const before = Date.now();
    const synthetic = await synthesizeMissingWalletConnectCompletions([]);
    const after = Date.now();

    expect(synthetic).toHaveLength(1);
    expect(JSON.parse(synthetic[0].newValue ?? "{}")).toEqual({
      walletName: null,
    });
    const ts = new Date(synthetic[0].createdAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("assigns distinct negative ids across multiple missing markers", async () => {
    markerRows = [
      firedMarker("case-1", new Date()),
      firedMarker("case-2", new Date()),
      firedMarker("case-3", new Date()),
    ];

    const synthetic = await synthesizeMissingWalletConnectCompletions([]);

    const ids = synthetic.map((r) => r.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id < 0)).toBe(true);
  });

  it("only synthesizes for the cases still missing an audit row", async () => {
    markerRows = [
      firedMarker("case-1", new Date()),
      firedMarker("case-2", new Date()),
    ];

    const synthetic = await synthesizeMissingWalletConnectCompletions([
      { action: "wallet_connect_completed", targetId: "case-1" },
    ]);

    expect(synthetic.map((r) => r.targetId)).toEqual(["case-2"]);
  });
});

describe("synthesizeMissingWalletConnectCompletions — whitespace-key guard (end-to-end through listFiredWalletConnectAlertMarkers)", () => {
  it("produces no completions when all marker keys have whitespace-only caseId suffixes", async () => {
    // Seed rows whose suffix is entirely whitespace.  listFiredWalletConnectAlertMarkers
    // trims and drops them, so the higher-level helper must also see nothing to
    // synthesize even though the DB returned non-empty rows.
    markerRows = [
      { key: "wallet_connect_alert_fired:   ", updatedAt: new Date() },
      { key: "wallet_connect_alert_fired:\t", updatedAt: new Date() },
      { key: "wallet_connect_alert_fired:\n", updatedAt: new Date() },
    ];

    const synthetic = await synthesizeMissingWalletConnectCompletions([]);

    expect(synthetic).toEqual([]);
  });

  it("only synthesizes real caseIds when mixed with whitespace-only keys", async () => {
    const at = new Date("2026-04-01T00:00:00Z");
    markerRows = [
      { key: "wallet_connect_alert_fired:   ", updatedAt: new Date() },
      { key: `wallet_connect_alert_fired:real-case`, updatedAt: at },
      { key: "wallet_connect_alert_fired:\t", updatedAt: new Date() },
    ];
    caseWalletNames.set("real-case", "Trust Wallet");

    const synthetic = await synthesizeMissingWalletConnectCompletions([]);

    expect(synthetic).toHaveLength(1);
    expect(synthetic[0].targetId).toBe("real-case");
    expect(JSON.parse(synthetic[0].newValue ?? "{}")).toEqual({
      walletName: "Trust Wallet",
    });
  });
});

describe("backfillMissingWalletConnectCompletions — whitespace-key guard (end-to-end through listFiredWalletConnectAlertMarkers)", () => {
  it("scans zero markers and inserts nothing when all keys have whitespace-only suffixes", async () => {
    // listFiredWalletConnectAlertMarkers strips these before backfill sees them,
    // so the function must return scanned=0 / inserted=0 without touching the
    // audit-log table.
    markerRows = [
      { key: "wallet_connect_alert_fired:   ", updatedAt: new Date() },
      { key: "wallet_connect_alert_fired:\t", updatedAt: new Date() },
    ];

    const result = await backfillMissingWalletConnectCompletions();

    expect(result.scanned).toBe(0);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(false);
  });
});

describe("listMutedWalletConnectAlertCaseIds — whitespace-key guard (end-to-end through the real list function)", () => {
  it("returns an empty list when all mute-marker keys have whitespace-only caseId suffixes", async () => {
    // Keys like `wallet_connect_alert_muted:   ` (spaces/tabs/newlines after the
    // prefix) must be stripped and discarded by the trim guard, so no spurious
    // caseIds appear in the returned list even though the DB returned non-empty rows.
    markerRows = [
      { key: "wallet_connect_alert_muted:   ", updatedAt: null },
      { key: "wallet_connect_alert_muted:\t", updatedAt: null },
      { key: "wallet_connect_alert_muted:\n", updatedAt: null },
    ];

    const result = await listMutedWalletConnectAlertCaseIds();

    expect(result).toEqual([]);
  });

  it("only returns real caseIds when mute rows are mixed with whitespace-only keys", async () => {
    markerRows = [
      { key: "wallet_connect_alert_muted:   ", updatedAt: null },
      { key: "wallet_connect_alert_muted:real-case", updatedAt: null },
      { key: "wallet_connect_alert_muted:\t", updatedAt: null },
    ];

    const result = await listMutedWalletConnectAlertCaseIds();

    expect(result).toEqual(["real-case"]);
    expect(result.every((id) => id.trim().length > 0)).toBe(true);
  });
});

describe("countOrphanedWalletConnectAlertMarkers — whitespace-key guard (cleanup sweep ignores whitespace-only caseId suffixes)", () => {
  it("reports scanned rows but zero orphans when all marker keys have whitespace-only caseId suffixes", async () => {
    // The cleanup sweep uses scanWalletConnectAlertMarkers internally, which
    // applies a `.trim().length > 0` filter before building the `inArray` DB
    // query and before populating orphanKeys.  A row whose suffix is entirely
    // whitespace must therefore count toward `scanned` (we saw the row) but
    // must NOT appear in `orphaned` (it is not a valid candidate for deletion).
    markerRows = [
      { key: "wallet_connect_alert_fired:   ", updatedAt: null },
      { key: "wallet_connect_alert_fired:\t", updatedAt: null },
      { key: "wallet_connect_alert_muted:\n", updatedAt: null },
    ];

    const result = await countOrphanedWalletConnectAlertMarkers();

    expect(result.scanned).toBe(3);
    expect(result.orphaned).toBe(0);
  });

  it("counts real orphans but does not count whitespace-only keys as orphans when mixed together", async () => {
    // When a real caseId key is mixed with whitespace-only keys, only the real
    // caseId contributes to `orphaned`.  The mock returns `markerRows` for every
    // DB query; the existence-check query against `cases` therefore returns the
    // same rows (which have `key` but no `id`), so `existing` resolves to
    // Set{undefined}.  "missing-case" is not in that set → it is an orphan.
    // The two whitespace-only keys are filtered out before `candidateCaseIds`
    // is built and again when `orphanKeys` is assembled, so they never
    // contribute to `orphaned` regardless of what `existing` contains.
    markerRows = [
      { key: "wallet_connect_alert_fired:   ", updatedAt: null },
      { key: "wallet_connect_alert_fired:\t", updatedAt: null },
      { key: "wallet_connect_alert_fired:missing-case", updatedAt: null },
    ];

    const result = await countOrphanedWalletConnectAlertMarkers();

    expect(result.scanned).toBe(3);
    expect(result.orphaned).toBe(1);
  });
});

describe("cleanupOrphanedWalletConnectAlertMarkers — whitespace-key guard (delete path)", () => {
  // Reset the re-entrancy guard before each test so the function runs fresh.
  beforeEach(() => {
    __resetWalletConnectAlertCleanupGuardForTests();
  });

  it("reports scanned rows but deleted=0 and issues no DB delete when all marker keys have whitespace-only caseId suffixes", async () => {
    // scanWalletConnectAlertMarkers filters out keys whose caseId suffix trims
    // to "".  When every marker row has a whitespace-only suffix, orphanKeys
    // is empty and the function returns before ever calling exec.delete.
    const wsMarkerRows = [
      { key: "wallet_connect_alert_fired:   " },
      { key: "wallet_connect_alert_fired:\t" },
      { key: "wallet_connect_alert_muted:\n" },
    ];

    const deleteFn = vi.fn();
    const executor = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => wsMarkerRows),
        })),
      })),
      delete: deleteFn,
    };

    const result = await cleanupOrphanedWalletConnectAlertMarkers({
      executor: executor as any,
    });

    expect(result.scanned).toBe(3);
    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe(false);
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("deletes only the real orphan key and never includes whitespace-only keys in the delete call when mixed", async () => {
    // "missing-case" is a real caseId suffix that resolves to an orphan (no
    // matching row in `cases`).  The two whitespace-only keys must be absent
    // from orphanKeys and therefore absent from the inArray argument passed to
    // the delete, even though the DB returned them in the initial marker scan.
    const mixedMarkerRows = [
      { key: "wallet_connect_alert_fired:   " },
      { key: "wallet_connect_alert_fired:\t" },
      { key: "wallet_connect_alert_fired:missing-case" },
    ];

    let selectCallCount = 0;
    const deletedKeys: string[][] = [];

    const executor = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => {
            selectCallCount += 1;
            // First call: marker scan. Second call: cases existence check.
            return selectCallCount === 1 ? mixedMarkerRows : [];
          }),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn((condition: any) => {
          // Capture the key list the inArray predicate was built with.
          if (condition?._type === "inArray") {
            deletedKeys.push(condition.vals as string[]);
          }
          return {
            returning: vi.fn(async () => [
              { key: "wallet_connect_alert_fired:missing-case" },
            ]),
          };
        }),
      })),
    };

    const result = await cleanupOrphanedWalletConnectAlertMarkers({
      executor: executor as any,
    });

    expect(result.scanned).toBe(3);
    expect(result.deleted).toBe(1);
    expect(result.skipped).toBe(false);

    // Exactly one delete batch was issued.
    expect(deletedKeys).toHaveLength(1);
    const keysDeleted = deletedKeys[0];

    // The real orphan key must be present.
    expect(keysDeleted).toContain("wallet_connect_alert_fired:missing-case");

    // Whitespace-only keys must NOT be present in the delete call.
    expect(keysDeleted.every((k) => k.split(":")[1]?.trim().length > 0)).toBe(
      true,
    );
  });
});
