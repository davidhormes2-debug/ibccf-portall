import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must precede any import of the module under test
// ---------------------------------------------------------------------------

// Minimal drizzle-transaction simulation: capture every .set({...}) payload
// so assertions can verify which columns were cleared.
const caseUpdates: any[] = [];
const declarationUpdates: any[] = [];

vi.mock("../db", () => {
  const makeQueryBuilder = (store: any[]) => {
    const builder = {
      set: (data: any) => {
        store.push(data);
        return builder;
      },
      where: (_cond: unknown) => Promise.resolve([]),
    };
    return builder;
  };

  let callCount = 0;
  const mockTx = {
    update: (_table: unknown) => {
      // First update() call targets `cases`, second targets `declarationSubmissions`.
      callCount += 1;
      return makeQueryBuilder(callCount === 1 ? caseUpdates : declarationUpdates);
    },
  };

  return {
    db: {
      transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<void>) => {
        callCount = 0;
        return fn(mockTx);
      }),
    },
  };
});

const auditLogs: any[] = [];
vi.mock("../storage", () => ({
  storage: {
    createAuditLog: vi.fn(async (entry: any, _tx?: unknown) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { resetWithdrawalPathway, disableAndResetPathway } from "../services/pathwayReset";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  caseUpdates.length = 0;
  declarationUpdates.length = 0;
  auditLogs.length = 0;
  vi.clearAllMocks();
});

describe("resetWithdrawalPathway", () => {
  it("clears withdrawalStage on the case row", async () => {
    await resetWithdrawalPathway("case-abc", "override", "admin-1");
    expect(caseUpdates).toHaveLength(1);
    expect(caseUpdates[0]).toMatchObject({ withdrawalStage: null });
  });

  it("clears sealedAt and sealedBy on the case row", async () => {
    await resetWithdrawalPathway("case-abc", "override", "admin-1");
    expect(caseUpdates[0]).toMatchObject({ sealedAt: null, sealedBy: null });
  });

  it("resets declarationStatus to 'not_requested'", async () => {
    await resetWithdrawalPathway("case-abc", "override", "admin-1");
    expect(caseUpdates[0]).toMatchObject({ declarationStatus: "not_requested" });
  });

  it("voids active declaration submissions", async () => {
    await resetWithdrawalPathway("case-abc", "skip", "admin-2");
    expect(declarationUpdates).toHaveLength(1);
    expect(declarationUpdates[0]).toMatchObject({ status: "voided" });
  });

  it("writes a pathway_reset audit log entry", async () => {
    await resetWithdrawalPathway("case-xyz", "override", "admin-1");
    const log = auditLogs.find((l) => l.action === "pathway_reset");
    expect(log).toBeDefined();
    expect(log).toMatchObject({
      action: "pathway_reset",
      adminUsername: "admin-1",
      targetType: "case",
      targetId: "case-xyz",
    });
  });

  it("records the reason in the audit log value", async () => {
    await resetWithdrawalPathway("case-xyz", "skip", "admin-2");
    const log = auditLogs.find((l) => l.action === "pathway_reset");
    expect(log?.newValue).toContain("skip");
  });

  it("records 'override' reason correctly", async () => {
    await resetWithdrawalPathway("case-xyz", "override", "admin-3");
    const log = auditLogs.find((l) => l.action === "pathway_reset");
    expect(log?.newValue).toContain("override");
  });

  it("records 'expired' reason correctly", async () => {
    await resetWithdrawalPathway("case-xyz", "expired", "system");
    const log = auditLogs.find((l) => l.action === "pathway_reset");
    expect(log?.newValue).toContain("expired");
  });
});

describe("disableAndResetPathway", () => {
  it("clears withdrawalStage in the same transaction as isDisabled", async () => {
    await disableAndResetPathway("case-abc", "override", "admin-1");
    expect(caseUpdates).toHaveLength(1);
    expect(caseUpdates[0]).toMatchObject({ withdrawalStage: null, isDisabled: true });
  });

  it("stamps isDisabled=true and clears portalWarning fields", async () => {
    await disableAndResetPathway("case-abc", "skip", "admin-2");
    expect(caseUpdates[0]).toMatchObject({
      isDisabled: true,
      portalWarningAt: null,
      portalWarningMinutes: null,
      portalWarningMessage: null,
    });
  });

  it("clears sealedAt, sealedBy, and declarationStatus atomically", async () => {
    await disableAndResetPathway("case-abc", "expired", "system");
    expect(caseUpdates[0]).toMatchObject({
      sealedAt: null,
      sealedBy: null,
      declarationStatus: "not_requested",
    });
  });

  it("voids active declaration submissions", async () => {
    await disableAndResetPathway("case-abc", "override", "admin-1");
    expect(declarationUpdates).toHaveLength(1);
    expect(declarationUpdates[0]).toMatchObject({ status: "voided" });
  });

  it("writes the disable-specific audit log for 'override'", async () => {
    await disableAndResetPathway("case-xyz", "override", "admin-1");
    const log = auditLogs.find((l) => l.action === "override_countdown");
    expect(log).toBeDefined();
    expect(log).toMatchObject({ adminUsername: "admin-1", targetId: "case-xyz" });
  });

  it("writes the disable-specific audit log for 'skip'", async () => {
    await disableAndResetPathway("case-xyz", "skip", "admin-2");
    const log = auditLogs.find((l) => l.action === "skip_to_reactivation");
    expect(log).toBeDefined();
  });

  it("writes the disable-specific audit log for 'expired'", async () => {
    await disableAndResetPathway("case-xyz", "expired", "system");
    const log = auditLogs.find((l) => l.action === "portal_warning_expired");
    expect(log).toBeDefined();
  });

  it("writes a pathway_reset audit log in addition to the disable log", async () => {
    await disableAndResetPathway("case-xyz", "override", "admin-1");
    const resetLog = auditLogs.find((l) => l.action === "pathway_reset");
    expect(resetLog).toBeDefined();
    expect(resetLog?.newValue).toContain("override");
  });
});
