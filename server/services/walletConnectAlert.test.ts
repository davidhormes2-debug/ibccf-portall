import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { auditLogs as AuditLogsTable } from "@shared/schema";
import { createStorageMock } from "../__tests__/helpers/storageMock";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// The mock below hand-rolls the three auditLogs columns that hasAlreadyFired()
// references. This `Pick<>` declaration ensures that if any of those column
// names are renamed in shared/schema.ts, TypeScript reports an error in this
// file at `npm run check` time — exactly the same signal it would give in
// walletConnectAlert.ts itself — so the mock can never silently drift.
//
// Columns asserted:
//   "id"       → db.select({ id: auditLogs.id })
//   "action"   → eq(auditLogs.action, "wallet_connect_completed")
//   "targetId" → eq(auditLogs.targetId, caseId)
declare const _auditLogColumnsGuard: Pick<
  typeof AuditLogsTable,
  "id" | "action" | "targetId"
>;

// ── In-memory state ──────────────────────────────────────────────────────────

const auditLogs: any[] = [];
const sentAdminEmails: any[] = [];
const sentUserEmails: any[] = [];
const appSettings = new Map<string, { value: string }>();

// Controls what the DB query inside hasAlreadyFired returns.
// Set to [] to simulate "no prior audit row" (first call); set to [{ id: 1 }]
// to simulate "row already exists" (subsequent calls).
let dbQueryResult: any[] = [];

// ── Module mocks ─────────────────────────────────────────────────────────────

// hasAlreadyFired uses dynamic import("../db") — vi.mock still intercepts it.
vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => dbQueryResult),
        })),
      })),
    })),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: vi.fn((...args: any[]) => ({ _type: "and", args })),
  eq: vi.fn((col: any, val: any) => ({ _type: "eq", col, val })),
}));

vi.mock("@shared/schema", () => ({
  auditLogs: {
    id: "auditLogs.id",
    action: "auditLogs.action",
    targetId: "auditLogs.targetId",
  },
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    getAppSetting: vi.fn(async (key: string) => {
      const row = appSettings.get(key);
      if (!row) return undefined;
      return { key, ...row };
    }),
    setAppSetting: vi.fn(
      async (key: string, value: string, updatedBy?: string | null) => {
        appSettings.set(key, {
          value,
          updatedBy: updatedBy ?? null,
          updatedAt: new Date(),
        } as any);
        return { key, value };
      },
    ),
    getCaseById: vi.fn(async (id: string) => ({
      id,
      userEmail: "user@example.com",
      userName: "Test User",
    })),
  }),
}));

vi.mock("../nda-integrity-sweep", () => ({
  ADMIN_ALERT_EMAIL_SETTING_KEY: "admin_alert_email",
  parseAdminAlertRecipients: (raw: string | null | undefined) => {
    if (!raw) return [];
    return raw
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
  },
}));

vi.mock("../services/EmailService", () => ({
  emailService: {
    sendWalletConnectAlert: vi.fn(async (params: any) => {
      sentAdminEmails.push(params);
      return { success: true };
    }),
    sendLocalizedCaseEmail: vi.fn(async (params: any) => {
      sentUserEmails.push(params);
      return { success: true };
    }),
    sendWalletPhraseRevealedNotification: vi.fn(async (_params: any) => ({
      success: true,
    })),
  },
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async (params: any) => {
    sentUserEmails.push({ tag: params.tag, caseId: params.caseId });
  }),
  resolveRecipientLocale: vi.fn(async (_caseId: string) => "en"),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

const {
  maybeAlertOnWalletConnect,
  __resetFiredCaseIdsForTests,
  clampCleanupInterval,
  loadCleanupIntervalMs,
  readWalletConnectAlertCleanupIntervalSetting,
  saveWalletConnectAlertCleanupIntervalMs,
  getWalletConnectAlertCleanupScheduleState,
  __resetWalletConnectAlertCleanupScheduleForTests,
  WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY,
  WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS,
  WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS,
  WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS,
} = await import("../services/walletConnectAlert");
const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
const { emailService } = await import("../services/EmailService");
const { storage } = await import("../storage");

// ── Helpers ──────────────────────────────────────────────────────────────────

function resetState() {
  auditLogs.length = 0;
  sentAdminEmails.length = 0;
  sentUserEmails.length = 0;
  appSettings.clear();
  dbQueryResult = [];
  delete process.env.ADMIN_ALERT_EMAIL;
  // Task #559 — clear the process-local short-circuit so each test starts
  // from a clean "nothing has fired in this process" state.
  __resetFiredCaseIdsForTests();
  // Task #832 — clear the in-process sweep schedule snapshot.
  __resetWalletConnectAlertCleanupScheduleForTests();
}

const TEST_CASE_ID = "case-abc-123";
const TEST_WALLET_NAME = "MetaMask";

// ── Tests: audit row idempotency ─────────────────────────────────────────────

describe("maybeAlertOnWalletConnect — audit row fires exactly once", () => {
  beforeEach(() => resetState());

  it("creates a wallet_connect_completed audit row on the first call", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const walletAudit = auditLogs.filter(
      (a) => a.action === "wallet_connect_completed",
    );
    expect(walletAudit).toHaveLength(1);
    expect(walletAudit[0].targetId).toBe(TEST_CASE_ID);
    expect(walletAudit[0].targetType).toBe("case");
    expect(walletAudit[0].adminUsername).toBe("system");
  });

  it("does not create a second audit row when called again after the first", async () => {
    // First call — no prior row exists.
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const afterFirst = auditLogs.filter(
      (a) => a.action === "wallet_connect_completed",
    );
    expect(afterFirst).toHaveLength(1);

    // Simulate the row now existing in the DB (idempotency guard triggers).
    dbQueryResult = [{ id: 1 }];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const afterSecond = auditLogs.filter(
      (a) => a.action === "wallet_connect_completed",
    );
    expect(afterSecond).toHaveLength(1);
  });

  it("creates at most one audit row regardless of how many times it is called", async () => {
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    // Simulate persistent row for all subsequent calls.
    dbQueryResult = [{ id: 1 }];
    for (let i = 0; i < 5; i++) {
      await maybeAlertOnWalletConnect({
        caseId: TEST_CASE_ID,
        walletName: TEST_WALLET_NAME,
      });
    }

    const walletAudit = auditLogs.filter(
      (a) => a.action === "wallet_connect_completed",
    );
    expect(walletAudit).toHaveLength(1);
  });

  it("records the walletName inside the audit row's newValue", async () => {
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const row = auditLogs.find((a) => a.action === "wallet_connect_completed");
    expect(row).toBeDefined();
    const parsed = JSON.parse(row.newValue);
    expect(parsed.walletName).toBe(TEST_WALLET_NAME);
  });

  it("records null walletName when none is supplied", async () => {
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({ caseId: TEST_CASE_ID, walletName: null });

    const row = auditLogs.find((a) => a.action === "wallet_connect_completed");
    expect(row).toBeDefined();
    const parsed = JSON.parse(row.newValue);
    expect(parsed.walletName).toBeNull();
  });
});

// ── Tests: admin email idempotency ───────────────────────────────────────────

describe("maybeAlertOnWalletConnect — admin alert email fires on first call only", () => {
  beforeEach(() => {
    resetState();
    // Configure an admin alert recipient so the email path is exercised.
    process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
  });

  it("sends the admin alert email on the first call", async () => {
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(sentAdminEmails).toHaveLength(1);
    expect(sentAdminEmails[0].to).toContain("admin@example.com");
    expect(sentAdminEmails[0].caseId).toBe(TEST_CASE_ID);
  });

  it("does not send the admin alert email on a subsequent call", async () => {
    // First call.
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(sentAdminEmails).toHaveLength(1);

    // Subsequent call — row already exists.
    dbQueryResult = [{ id: 1 }];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(sentAdminEmails).toHaveLength(1);
  });

  it("skips the admin email entirely when no recipients are configured", async () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(sentAdminEmails).toHaveLength(0);
  });

  it("records an email_wallet_connect_alert audit row when the admin email succeeds", async () => {
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const emailAudit = auditLogs.filter(
      (a) => a.action === "email_wallet_connect_alert",
    );
    expect(emailAudit).toHaveLength(1);
    expect(emailAudit[0].targetId).toBe(TEST_CASE_ID);
  });

  it("is idempotent across many calls — admin email is sent exactly once", async () => {
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    dbQueryResult = [{ id: 1 }];
    for (let i = 0; i < 4; i++) {
      await maybeAlertOnWalletConnect({
        caseId: TEST_CASE_ID,
        walletName: TEST_WALLET_NAME,
      });
    }

    expect(sentAdminEmails).toHaveLength(1);
  });
});

// ── Tests: isolation between cases ───────────────────────────────────────────

describe("maybeAlertOnWalletConnect — each case is tracked independently", () => {
  beforeEach(() => {
    resetState();
    process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
  });

  it("fires the audit row separately for two different cases", async () => {
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: "case-111",
      walletName: "MetaMask",
    });
    await maybeAlertOnWalletConnect({
      caseId: "case-222",
      walletName: "Ledger",
    });

    const walletAudits = auditLogs.filter(
      (a) => a.action === "wallet_connect_completed",
    );
    expect(walletAudits).toHaveLength(2);
    expect(walletAudits.map((a) => a.targetId)).toContain("case-111");
    expect(walletAudits.map((a) => a.targetId)).toContain("case-222");
  });
});

// ── Tests: per-case mute (Task #492) ─────────────────────────────────────────
// The mute key is `wallet_connect_alert_muted:<caseId>` in app_settings.
// When its value is "true", maybeAlertOnWalletConnect must return early:
//   • no wallet_connect_completed audit row
//   • no admin email
//   • no user email
// The mute does NOT interact with the hasAlreadyFired idempotency guard —
// unmuting and re-revealing should still be blocked by a pre-existing audit row.

describe("maybeAlertOnWalletConnect — per-case mute suppresses audit row and emails", () => {
  const MUTE_KEY = `wallet_connect_alert_muted:${TEST_CASE_ID}`;

  beforeEach(() => {
    resetState();
    process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
  });

  it("skips the wallet_connect_completed audit row when the case is muted", async () => {
    appSettings.set(MUTE_KEY, { value: "true" });
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const walletAudit = auditLogs.filter(
      (a) => a.action === "wallet_connect_completed",
    );
    expect(walletAudit).toHaveLength(0);
  });

  it("skips the admin alert email when the case is muted", async () => {
    appSettings.set(MUTE_KEY, { value: "true" });
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(sentAdminEmails).toHaveLength(0);
  });

  it("skips the user notification email when the case is muted", async () => {
    appSettings.set(MUTE_KEY, { value: "true" });
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(sentUserEmails).toHaveLength(0);
  });

  it("emits no audit rows at all when the case is muted", async () => {
    appSettings.set(MUTE_KEY, { value: "true" });
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(auditLogs).toHaveLength(0);
  });

  it('treats mute value "false" as not muted — fires normally', async () => {
    appSettings.set(MUTE_KEY, { value: "false" });
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const walletAudit = auditLogs.filter(
      (a) => a.action === "wallet_connect_completed",
    );
    expect(walletAudit).toHaveLength(1);
    expect(sentAdminEmails).toHaveLength(1);
  });

  it("fires normally when the mute key is absent", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const walletAudit = auditLogs.filter(
      (a) => a.action === "wallet_connect_completed",
    );
    expect(walletAudit).toHaveLength(1);
    expect(sentAdminEmails).toHaveLength(1);
  });

  it("muting one case does not suppress alerts for a different case", async () => {
    appSettings.set(MUTE_KEY, { value: "true" });
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: "case-other-999",
      walletName: TEST_WALLET_NAME,
    });

    const walletAudit = auditLogs.filter(
      (a) => a.action === "wallet_connect_completed",
    );
    expect(walletAudit).toHaveLength(1);
    expect(walletAudit[0].targetId).toBe("case-other-999");
    expect(sentAdminEmails).toHaveLength(1);
  });
});

// ── Tests: unmute + re-reveal respects the hasAlreadyFired guard ──────────────
// Muting suppresses the audit stamp. After unmuting, if the user reveals the
// phrase again, the function must NOT fire again because some earlier (pre-mute)
// audit row still exists in the DB. Conversely, if no prior row exists, unmuting
// allows a fresh fire on the next reveal.

describe("maybeAlertOnWalletConnect — unmute + re-reveal and hasAlreadyFired interaction", () => {
  const MUTE_KEY = `wallet_connect_alert_muted:${TEST_CASE_ID}`;

  beforeEach(() => {
    resetState();
    process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
  });

  it("after unmute, does NOT fire again when a prior audit row already exists", async () => {
    // Simulate: case was revealed before muting, leaving a DB audit row.
    // Then admin mutes, then unmutes. Re-reveal must be blocked.
    appSettings.set(MUTE_KEY, { value: "false" });
    dbQueryResult = [{ id: 42 }]; // hasAlreadyFired returns true

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(auditLogs).toHaveLength(0);
    expect(sentAdminEmails).toHaveLength(0);
  });

  it("after unmute with no prior audit row, fires normally on re-reveal", async () => {
    // Simulate: case was muted before the first reveal (no audit row was ever
    // written). Admin unmutes. The next reveal should fire the full pipeline.
    appSettings.set(MUTE_KEY, { value: "false" });
    dbQueryResult = []; // hasAlreadyFired returns false

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const walletAudit = auditLogs.filter(
      (a) => a.action === "wallet_connect_completed",
    );
    expect(walletAudit).toHaveLength(1);
    expect(sentAdminEmails).toHaveLength(1);
  });

  it("muting mid-sequence does not duplicate the audit row from a previous fire", async () => {
    // First reveal (unmuted) — writes audit row.
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(
      auditLogs.filter((a) => a.action === "wallet_connect_completed"),
    ).toHaveLength(1);

    // Admin mutes the case.
    appSettings.set(MUTE_KEY, { value: "true" });

    // Subsequent reveals while muted — no new rows.
    dbQueryResult = [{ id: 1 }]; // row exists from first call
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    // Still only 1 wallet_connect_completed row.
    expect(
      auditLogs.filter((a) => a.action === "wallet_connect_completed"),
    ).toHaveLength(1);

    // Admin unmutes.
    appSettings.set(MUTE_KEY, { value: "false" });

    // Re-reveal after unmute — hasAlreadyFired blocks it.
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(
      auditLogs.filter((a) => a.action === "wallet_connect_completed"),
    ).toHaveLength(1);
    // Admin email only sent once (the first time).
    expect(sentAdminEmails).toHaveLength(1);
  });
});

// ── Tests: sendWalletPhraseRevealedNotification fires exactly once ────────────
// These tests override sendCaseEmailWithAudit so it actually invokes
// params.send() — confirming the inner emailService method is exercised.

describe("maybeAlertOnWalletConnect — sendWalletPhraseRevealedNotification fires exactly once", () => {
  beforeEach(() => {
    resetState();
    // Make sendCaseEmailWithAudit call through to params.send() so the
    // emailService.sendWalletPhraseRevealedNotification spy is exercised.
    (vi.mocked(sendCaseEmailWithAudit) as any).mockImplementation(
      async (params: any) => {
        sentUserEmails.push({ tag: params.tag, caseId: params.caseId });
        await params.send("en");
        return { sent: true };
      },
    );
    vi.mocked(emailService.sendWalletPhraseRevealedNotification).mockClear();
  });

  afterEach(() => {
    // Restore the default passthrough mock used by all other test suites.
    (vi.mocked(sendCaseEmailWithAudit) as any).mockImplementation(
      async (params: any) => {
        sentUserEmails.push({ tag: params.tag, caseId: params.caseId });
      },
    );
  });

  it("calls sendWalletPhraseRevealedNotification exactly once on first reveal", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(
      vi.mocked(emailService.sendWalletPhraseRevealedNotification),
    ).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(emailService.sendWalletPhraseRevealedNotification),
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        caseRef: TEST_CASE_ID,
      }),
    );
  });

  it("does not call sendWalletPhraseRevealedNotification when the audit row already exists", async () => {
    // Simulate second reveal — hasAlreadyFired returns true.
    dbQueryResult = [{ id: 1 }];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(
      vi.mocked(emailService.sendWalletPhraseRevealedNotification),
    ).not.toHaveBeenCalled();
  });

  it("invokes sendWalletPhraseRevealedNotification with the correct tag wallet_phrase_user_notification", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const entry = sentUserEmails.find(
      (e) => e.tag === "wallet_phrase_user_notification",
    );
    expect(entry).toBeDefined();
    expect(entry?.caseId).toBe(TEST_CASE_ID);
  });
});

// ── Tests: user email audit log tags (Task #506) ──────────────────────────────
// sendCaseEmailWithAudit is responsible for writing email_<tag> /
// email_<tag>_failed rows. These tests replace the mock with a minimal
// call-through that mirrors the real function's audit behaviour so we can
// assert the exact action strings the task requires.

describe("maybeAlertOnWalletConnect — user email audit log tags", () => {
  beforeEach(() => {
    resetState();
    // Simulate sendCaseEmailWithAudit: call send(), then write the audit row.
    (vi.mocked(sendCaseEmailWithAudit) as any).mockImplementation(
      async (params: any) => {
        let result: { success: boolean; error?: string } = { success: true };
        try {
          result = await params.send("en");
        } catch (err) {
          result = {
            success: false,
            error: err instanceof Error ? err.message : "SMTP error",
          };
        }
        auditLogs.push({
          action: result.success
            ? `email_${params.tag}`
            : `email_${params.tag}_failed`,
          targetId: params.caseId,
          targetType: "case",
          adminUsername: "system",
        });
        return { sent: result.success };
      },
    );
    vi.mocked(emailService.sendWalletPhraseRevealedNotification).mockClear();
  });

  afterEach(() => {
    (vi.mocked(sendCaseEmailWithAudit) as any).mockImplementation(
      async (params: any) => {
        sentUserEmails.push({ tag: params.tag, caseId: params.caseId });
      },
    );
  });

  it("records email_wallet_phrase_user_notification when SMTP succeeds", async () => {
    dbQueryResult = [];
    vi.mocked(
      emailService.sendWalletPhraseRevealedNotification,
    ).mockResolvedValueOnce({ success: true });

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const successTag = auditLogs.find(
      (a) => a.action === "email_wallet_phrase_user_notification",
    );
    expect(successTag).toBeDefined();
    expect(successTag?.targetId).toBe(TEST_CASE_ID);
    expect(
      auditLogs.some(
        (a) => a.action === "email_wallet_phrase_user_notification_failed",
      ),
    ).toBe(false);
  });

  it("records email_wallet_phrase_user_notification_failed when SMTP returns success:false", async () => {
    dbQueryResult = [];
    vi.mocked(
      emailService.sendWalletPhraseRevealedNotification,
    ).mockResolvedValueOnce({ success: false, error: "connection refused" });

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const failureTag = auditLogs.find(
      (a) => a.action === "email_wallet_phrase_user_notification_failed",
    );
    expect(failureTag).toBeDefined();
    expect(failureTag?.targetId).toBe(TEST_CASE_ID);
    expect(
      auditLogs.some(
        (a) => a.action === "email_wallet_phrase_user_notification",
      ),
    ).toBe(false);
  });

  it("records email_wallet_phrase_user_notification_failed when SMTP throws", async () => {
    dbQueryResult = [];
    vi.mocked(
      emailService.sendWalletPhraseRevealedNotification,
    ).mockRejectedValueOnce(new Error("SMTP timeout"));

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const failureTag = auditLogs.find(
      (a) => a.action === "email_wallet_phrase_user_notification_failed",
    );
    expect(failureTag).toBeDefined();
    expect(failureTag?.targetId).toBe(TEST_CASE_ID);
  });
});

// ── Tests: durable marker write-failure gate (Task #676) ─────────────────────
// The durable, cross-instance idempotency stamp is the
// `wallet_connect_alert_fired:<caseId>` row in app_settings, written via an
// upsert (storage.setAppSetting) BEFORE any email is dispatched. If THAT write
// fails (transient DB error), the function MUST bail out before sending any
// email. Nothing durable persisted, so a later reveal simply retries cleanly —
// the alert is deferred, never lost.
//
// Contract under marker-write failure:
//   1. No admin alert email is sent.
//   2. No user notification email is sent.
//   3. No audit rows are written (we bail before the audit-row write).
//   4. The in-memory short-circuit (firedCaseIdsThisProcess) is still set so
//      re-reveals within THIS process lifetime are suppressed.
//   5. After a restart, if the marker write succeeds the email fires exactly
//      once; if it fails again the same bail-out applies — still no email.

describe("maybeAlertOnWalletConnect — durable marker write-failure gate (Task #676)", () => {
  beforeEach(() => {
    resetState();
    process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
    // Make the durable idempotency-marker write throw, simulating a transient
    // DB error. The function must bail before dispatching any email.
    vi.mocked(storage.setAppSetting).mockImplementation(async () => {
      throw new Error("transient DB error: connection reset");
    });
  });

  afterEach(() => {
    // Restore the default passthrough mock for all other suites.
    vi.mocked(storage.setAppSetting).mockImplementation(
      async (key: string, value: string, updatedBy?: string | null) => {
        appSettings.set(key, {
          value,
          updatedBy: updatedBy ?? null,
          updatedAt: new Date(),
        } as any);
        return { key, value } as any;
      },
    );
  });

  it("does NOT send the admin alert email when the durable marker write throws", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(sentAdminEmails).toHaveLength(0);
  });

  it("does NOT send the user notification email when the durable marker write throws", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(sentUserEmails).toHaveLength(0);
  });

  it("emits no audit rows at all when the durable marker write throws", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    // We bail before the audit-row write, so nothing is recorded.
    expect(auditLogs).toHaveLength(0);
  });

  it("in-memory short-circuit still prevents re-fires within the same process after a marker-write failure", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(sentAdminEmails).toHaveLength(0);

    // Second reveal in the SAME process: the marker still isn't persisted but
    // the in-memory flag short-circuits, so no email is attempted again.
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(sentAdminEmails).toHaveLength(0);
  });

  it("after a process restart, if the marker write now succeeds the email fires exactly once", async () => {
    dbQueryResult = [];

    // First attempt: marker write throws → no email, in-memory flag set.
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(sentAdminEmails).toHaveLength(0);

    // Simulate process restart — in-memory flag lost.
    __resetFiredCaseIdsForTests();

    // The marker write now succeeds (DB recovered). Restore default mock.
    vi.mocked(storage.setAppSetting).mockImplementation(
      async (key: string, value: string, updatedBy?: string | null) => {
        appSettings.set(key, {
          value,
          updatedBy: updatedBy ?? null,
          updatedAt: new Date(),
        } as any);
        return { key, value } as any;
      },
    );

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    // This time the marker persists and the email fires once.
    expect(sentAdminEmails).toHaveLength(1);

    // A third reveal (even after another restart) — durable marker now exists
    // → blocked.
    __resetFiredCaseIdsForTests();
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(sentAdminEmails).toHaveLength(1);
  });

  it("after a process restart, if the marker write still fails the email is still suppressed", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(sentAdminEmails).toHaveLength(0);

    // Simulate process restart — marker write still throws (DB still down).
    __resetFiredCaseIdsForTests();

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    // Still no email — the gate held.
    expect(sentAdminEmails).toHaveLength(0);
  });
});

// ── Tests: missing userEmail edge cases (Task #670) ───────────────────────────
// When getCaseById returns a case with userEmail: null, or returns null itself,
// sendWalletPhraseRevealedNotification must NOT be called and no
// email_wallet_phrase_user_notification audit row may appear.
// The admin alert path must still fire normally when recipients are configured.

describe("maybeAlertOnWalletConnect — user email skipped when userEmail is absent", () => {
  beforeEach(() => {
    resetState();
    process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
  });

  afterEach(() => {
    // Restore the default getCaseById mock (returns a case with userEmail set).
    vi.mocked(storage.getCaseById).mockImplementation(async (id: string) => ({
      id,
      userEmail: "user@example.com",
      userName: "Test User",
    } as unknown as Awaited<ReturnType<typeof storage.getCaseById>>));
  });

  it("does not call sendWalletPhraseRevealedNotification when userEmail is null", async () => {
    vi.mocked(storage.getCaseById).mockResolvedValueOnce({
      id: TEST_CASE_ID,
      userEmail: null,
      userName: "Test User",
    } as any);
    vi.mocked(emailService.sendWalletPhraseRevealedNotification).mockClear();
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(
      vi.mocked(emailService.sendWalletPhraseRevealedNotification),
    ).not.toHaveBeenCalled();
    expect(sentUserEmails).toHaveLength(0);
  });

  it("does not write an email_wallet_phrase_user_notification audit row when userEmail is null", async () => {
    vi.mocked(storage.getCaseById).mockResolvedValueOnce({
      id: TEST_CASE_ID,
      userEmail: null,
      userName: "Test User",
    } as any);
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(
      auditLogs.some(
        (a) =>
          a.action === "email_wallet_phrase_user_notification" ||
          a.action === "email_wallet_phrase_user_notification_failed",
      ),
    ).toBe(false);
  });

  it("still fires the admin alert when userEmail is null", async () => {
    vi.mocked(storage.getCaseById).mockResolvedValueOnce({
      id: TEST_CASE_ID,
      userEmail: null,
      userName: "Test User",
    } as any);
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(sentAdminEmails).toHaveLength(1);
    expect(sentAdminEmails[0].to).toContain("admin@example.com");
  });

  it("does not call sendWalletPhraseRevealedNotification when getCaseById returns null", async () => {
    vi.mocked(storage.getCaseById).mockResolvedValueOnce(null as any);
    vi.mocked(emailService.sendWalletPhraseRevealedNotification).mockClear();
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(
      vi.mocked(emailService.sendWalletPhraseRevealedNotification),
    ).not.toHaveBeenCalled();
    expect(sentUserEmails).toHaveLength(0);
  });

  it("does not write an email_wallet_phrase_user_notification audit row when getCaseById returns null", async () => {
    vi.mocked(storage.getCaseById).mockResolvedValueOnce(null as any);
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(
      auditLogs.some(
        (a) =>
          a.action === "email_wallet_phrase_user_notification" ||
          a.action === "email_wallet_phrase_user_notification_failed",
      ),
    ).toBe(false);
  });

  it("still fires the admin alert when getCaseById returns null", async () => {
    vi.mocked(storage.getCaseById).mockResolvedValueOnce(null as any);
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(sentAdminEmails).toHaveLength(1);
    expect(sentAdminEmails[0].to).toContain("admin@example.com");
  });
});

// ── Tests: getCaseById throws (Task #759) ────────────────────────────────────
// When storage.getCaseById rejects (e.g. transient DB error), the user-email
// block's inner try/catch absorbs the exception and the outer dispatcher
// continues. Verified:
//   1. sendWalletPhraseRevealedNotification is NOT called.
//   2. No email_wallet_phrase_user_notification audit row is written.
//   3. The admin alert still fires normally.

describe("maybeAlertOnWalletConnect — getCaseById throws is handled gracefully", () => {
  beforeEach(() => {
    resetState();
    process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
  });

  afterEach(() => {
    // Restore the default getCaseById mock (returns a case with userEmail set).
    vi.mocked(storage.getCaseById).mockImplementation(async (id: string) => ({
      id,
      userEmail: "user@example.com",
      userName: "Test User",
    } as unknown as Awaited<ReturnType<typeof storage.getCaseById>>));
    vi.mocked(emailService.sendWalletPhraseRevealedNotification).mockClear();
  });

  it("does not call sendWalletPhraseRevealedNotification when getCaseById throws", async () => {
    vi.mocked(storage.getCaseById).mockRejectedValueOnce(
      new Error("transient DB error: connection reset"),
    );
    vi.mocked(emailService.sendWalletPhraseRevealedNotification).mockClear();
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(
      vi.mocked(emailService.sendWalletPhraseRevealedNotification),
    ).not.toHaveBeenCalled();
    expect(sentUserEmails).toHaveLength(0);
  });

  it("does not write a user notification audit row when getCaseById throws", async () => {
    vi.mocked(storage.getCaseById).mockRejectedValueOnce(
      new Error("transient DB error: connection reset"),
    );
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(
      auditLogs.some(
        (a) =>
          a.action === "email_wallet_phrase_user_notification" ||
          a.action === "email_wallet_phrase_user_notification_failed" ||
          a.action === "email_wallet_phrase_user_notification_queued",
      ),
    ).toBe(false);
  });

  it("still fires the admin alert when getCaseById throws", async () => {
    vi.mocked(storage.getCaseById).mockRejectedValueOnce(
      new Error("transient DB error: connection reset"),
    );
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(sentAdminEmails).toHaveLength(1);
    expect(sentAdminEmails[0].to).toContain("admin@example.com");
    expect(sentAdminEmails[0].caseId).toBe(TEST_CASE_ID);
  });
});

// ── Tests: audit-row failure tolerated; durable marker stays idempotent (#676)
// The audit-row write (`wallet_connect_completed`) is now best-effort: the
// durable app_settings marker is the real idempotency stamp. So even if the
// audit-row write fails, the alert fires EXACTLY ONCE and never re-fires across
// a restart or on another autoscale instance — the durable marker suppresses it.

describe("maybeAlertOnWalletConnect — audit-row failure tolerated, durable marker keeps it idempotent (Task #676)", () => {
  const FIRED_KEY = `wallet_connect_alert_fired:${TEST_CASE_ID}`;

  beforeEach(() => {
    resetState();
    process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
    // Make ONLY the wallet_connect_completed audit-row write throw. The durable
    // marker (setAppSetting) still succeeds.
    vi.mocked(storage.createAuditLog).mockImplementation(async (entry: any) => {
      if (entry.action === "wallet_connect_completed") {
        throw new Error("transient DB error: connection reset");
      }
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    });
  });

  afterEach(() => {
    vi.mocked(storage.createAuditLog).mockImplementation(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    });
  });

  it("still sends the admin alert email exactly once when the audit-row write throws", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    // The audit row never persisted...
    expect(
      auditLogs.some((a) => a.action === "wallet_connect_completed"),
    ).toBe(false);
    // ...but the durable marker did, so the email still fires once.
    expect(sentAdminEmails).toHaveLength(1);
  });

  it("persists the durable marker even when the audit-row write throws", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(appSettings.get(FIRED_KEY)?.value).toBe("true");
  });

  // THE Task #676 headline test: previously, across a restart a failed audit
  // write let the alert RE-FIRE. The durable marker now suppresses that.
  it("across a process restart, a failed audit-row write does NOT let the alert re-fire", async () => {
    dbQueryResult = [];

    // First reveal: audit-row write throws, but the marker persists and the
    // email fires once.
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(sentAdminEmails).toHaveLength(1);

    // Simulate a process restart — the in-memory short-circuit is gone, and the
    // legacy audit-row query still finds nothing (the row never persisted)...
    __resetFiredCaseIdsForTests();
    dbQueryResult = [];

    // ...but the durable marker from the first reveal suppresses the re-fire.
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(sentAdminEmails).toHaveLength(1);
  });

  it("suppresses re-fires on another autoscale instance via the shared durable marker", async () => {
    dbQueryResult = [];

    // Instance A: audit-row write throws, marker persists, email fires once.
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(sentAdminEmails).toHaveLength(1);

    // Instance B: fresh in-memory state (empty short-circuit set) but the same
    // shared DB-backed marker. It must see the marker and skip.
    __resetFiredCaseIdsForTests();
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(sentAdminEmails).toHaveLength(1);
  });
});

// ── Tests: user notification pre-send audit gate (Task #740) ─────────────────
// sendCaseEmailWithAudit writes its outcome audit row AFTER the SMTP send, so
// if that inner write fails there is no durable stamp and a retry could re-fire
// the email. The fix: write email_wallet_phrase_user_notification_queued BEFORE
// calling sendCaseEmailWithAudit. Only proceed with the SMTP send when that
// write succeeds.
//
// Contract:
//   • When the pre-send audit write throws → sendCaseEmailWithAudit is NOT
//     called (SMTP send never happens).
//   • The admin alert path still fires normally when the pre-send write fails.
//   • When the pre-send write succeeds → sendCaseEmailWithAudit IS called.
//   • The queued row is written before sendCaseEmailWithAudit is invoked (order
//     guarantee).

describe("maybeAlertOnWalletConnect — user notification pre-send audit gate (Task #740)", () => {
  beforeEach(() => {
    resetState();
    process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
    // Clear the sendCaseEmailWithAudit call count so each test in this suite
    // starts from zero — prior suites accumulate calls on the shared mock.
    vi.mocked(sendCaseEmailWithAudit).mockClear();
    // Default: createAuditLog succeeds for all actions.
  });

  afterEach(() => {
    // Restore storage.createAuditLog to the default passthrough.
    vi.mocked(storage.createAuditLog).mockImplementation(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    });
  });

  it("does NOT call sendCaseEmailWithAudit when the pre-send audit write throws", async () => {
    dbQueryResult = [];
    vi.mocked(storage.createAuditLog).mockImplementation(async (entry: any) => {
      if (entry.action === "email_wallet_phrase_user_notification_queued") {
        throw new Error("DB write failed");
      }
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    });

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(vi.mocked(sendCaseEmailWithAudit)).not.toHaveBeenCalled();
    expect(sentUserEmails).toHaveLength(0);
  });

  it("still sends the admin alert when the pre-send user-notification audit write throws", async () => {
    dbQueryResult = [];
    vi.mocked(storage.createAuditLog).mockImplementation(async (entry: any) => {
      if (entry.action === "email_wallet_phrase_user_notification_queued") {
        throw new Error("DB write failed");
      }
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    });

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(sentAdminEmails).toHaveLength(1);
    expect(sentAdminEmails[0].to).toContain("admin@example.com");
  });

  it("calls sendCaseEmailWithAudit when the pre-send audit write succeeds", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(vi.mocked(sendCaseEmailWithAudit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendCaseEmailWithAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "wallet_phrase_user_notification",
        caseId: TEST_CASE_ID,
      }),
    );
  });

  it("writes the queued audit row with the expected fields before invoking sendCaseEmailWithAudit", async () => {
    dbQueryResult = [];
    const callOrder: string[] = [];
    vi.mocked(storage.createAuditLog).mockImplementation(async (entry: any) => {
      callOrder.push(entry.action);
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    });
    (vi.mocked(sendCaseEmailWithAudit) as any).mockImplementation(async (params: any) => {
      callOrder.push(`sendCaseEmailWithAudit:${params.tag}`);
      sentUserEmails.push({ tag: params.tag, caseId: params.caseId });
      return { sent: true };
    });

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const queuedIdx = callOrder.indexOf(
      "email_wallet_phrase_user_notification_queued",
    );
    const sendIdx = callOrder.indexOf(
      "sendCaseEmailWithAudit:wallet_phrase_user_notification",
    );
    expect(queuedIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThanOrEqual(0);
    expect(queuedIdx).toBeLessThan(sendIdx);

    // Restore default sendCaseEmailWithAudit mock.
    (vi.mocked(sendCaseEmailWithAudit) as any).mockImplementation(async (params: any) => {
      sentUserEmails.push({ tag: params.tag, caseId: params.caseId });
    });
  });

  it("queued row carries the expected action, targetId, targetType, and adminUsername", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const queued = auditLogs.find(
      (a) => a.action === "email_wallet_phrase_user_notification_queued",
    );
    expect(queued).toBeDefined();
    expect(queued?.targetId).toBe(TEST_CASE_ID);
    expect(queued?.targetType).toBe("case");
    expect(queued?.adminUsername).toBe("system");
  });

  it("does not write the queued audit row when userEmail is absent", async () => {
    vi.mocked(storage.getCaseById).mockResolvedValueOnce({
      id: TEST_CASE_ID,
      userEmail: null,
      userName: "Test User",
    } as any);
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(
      auditLogs.some(
        (a) => a.action === "email_wallet_phrase_user_notification_queued",
      ),
    ).toBe(false);

    // Restore getCaseById.
    vi.mocked(storage.getCaseById).mockImplementation(async (id: string) => ({
      id,
      userEmail: "user@example.com",
      userName: "Test User",
    } as unknown as Awaited<ReturnType<typeof storage.getCaseById>>));
  });
});

// ── Tests: admin alert pre-send audit gate ────────────────────────────────────
// Mirrors the user-notification pre-send gate (Task #740). Write
// email_wallet_connect_alert_queued BEFORE the SMTP send. Only dispatch the
// admin SMTP when that write succeeds. If it fails, bail out so the outer
// wallet_connect_alert_fired marker ensures the next reveal retries cleanly.
//
// Contract:
//   • When the pre-send audit write throws → sendWalletConnectAlert is NOT
//     called (SMTP send never happens).
//   • The user notification path still fires normally when the admin pre-send
//     write fails (the two paths are independent).
//   • When the pre-send write succeeds → sendWalletConnectAlert IS called.
//   • The queued row is written before sendWalletConnectAlert is invoked (order
//     guarantee).
//   • The queued row carries the expected action, targetId, targetType, and
//     adminUsername.

describe("maybeAlertOnWalletConnect — admin alert pre-send audit gate", () => {
  beforeEach(() => {
    resetState();
    process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
    vi.mocked(emailService.sendWalletConnectAlert).mockClear();
    vi.mocked(sendCaseEmailWithAudit).mockClear();
  });

  afterEach(() => {
    vi.mocked(storage.createAuditLog).mockImplementation(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    });
  });

  it("does NOT call sendWalletConnectAlert when the admin pre-send audit write throws", async () => {
    dbQueryResult = [];
    vi.mocked(storage.createAuditLog).mockImplementation(async (entry: any) => {
      if (entry.action === "email_wallet_connect_alert_queued") {
        throw new Error("DB write failed");
      }
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    });

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(vi.mocked(emailService.sendWalletConnectAlert)).not.toHaveBeenCalled();
    expect(sentAdminEmails).toHaveLength(0);
  });

  it("still calls sendCaseEmailWithAudit for the user notification when the admin pre-send audit write throws", async () => {
    dbQueryResult = [];
    vi.mocked(storage.createAuditLog).mockImplementation(async (entry: any) => {
      if (entry.action === "email_wallet_connect_alert_queued") {
        throw new Error("DB write failed");
      }
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    });

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(vi.mocked(sendCaseEmailWithAudit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendCaseEmailWithAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "wallet_phrase_user_notification",
        caseId: TEST_CASE_ID,
      }),
    );
  });

  it("calls sendWalletConnectAlert when the admin pre-send audit write succeeds", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(vi.mocked(emailService.sendWalletConnectAlert)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emailService.sendWalletConnectAlert)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: expect.arrayContaining(["admin@example.com"]),
        caseId: TEST_CASE_ID,
      }),
    );
  });

  it("writes the queued audit row before invoking sendWalletConnectAlert (order guarantee)", async () => {
    dbQueryResult = [];
    const callOrder: string[] = [];
    vi.mocked(storage.createAuditLog).mockImplementation(async (entry: any) => {
      callOrder.push(entry.action);
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    });
    vi.mocked(emailService.sendWalletConnectAlert).mockImplementation(
      async (params: any) => {
        callOrder.push("sendWalletConnectAlert");
        sentAdminEmails.push(params);
        return { success: true };
      },
    );

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const queuedIdx = callOrder.indexOf("email_wallet_connect_alert_queued");
    const sendIdx = callOrder.indexOf("sendWalletConnectAlert");
    expect(queuedIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThanOrEqual(0);
    expect(queuedIdx).toBeLessThan(sendIdx);

    vi.mocked(emailService.sendWalletConnectAlert).mockImplementation(
      async (params: any) => {
        sentAdminEmails.push(params);
        return { success: true };
      },
    );
  });

  it("queued row carries the expected action, targetId, targetType, and adminUsername", async () => {
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    const queued = auditLogs.find(
      (a) => a.action === "email_wallet_connect_alert_queued",
    );
    expect(queued).toBeDefined();
    expect(queued?.targetId).toBe(TEST_CASE_ID);
    expect(queued?.targetType).toBe("case");
    expect(queued?.adminUsername).toBe("system");
  });

  it("does not write the queued audit row when no admin recipients are configured", async () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    dbQueryResult = [];

    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });

    expect(
      auditLogs.some((a) => a.action === "email_wallet_connect_alert_queued"),
    ).toBe(false);
  });
});

// ── Tests: configurable cleanup cadence (Task #792) ──────────────────────────

describe("wallet-connect cleanup cadence — clampCleanupInterval", () => {
  it("returns the value unchanged when inside the supported bounds", () => {
    const tenMinutes = 10 * 60 * 1000;
    expect(clampCleanupInterval(tenMinutes)).toBe(tenMinutes);
  });

  it("clamps values below the floor up to the minimum", () => {
    expect(clampCleanupInterval(1)).toBe(
      WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS,
    );
  });

  it("clamps values above the ceiling down to the maximum", () => {
    expect(clampCleanupInterval(Number.MAX_SAFE_INTEGER)).toBe(
      WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS,
    );
  });

  it("falls back to the default for non-finite or non-positive input", () => {
    expect(clampCleanupInterval(NaN)).toBe(
      WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS,
    );
    expect(clampCleanupInterval(0)).toBe(
      WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS,
    );
    expect(clampCleanupInterval(-5)).toBe(
      WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS,
    );
  });
});

describe("wallet-connect cleanup cadence — loadCleanupIntervalMs", () => {
  beforeEach(() => {
    resetState();
    delete process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS;
  });

  afterEach(() => {
    delete process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS;
  });

  it("returns the default when no env or app_settings override exists", async () => {
    const { ms, source } = await loadCleanupIntervalMs();
    expect(ms).toBe(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS);
    expect(source).toBe("default");
  });

  it("prefers the env override and clamps it", async () => {
    process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS = "1"; // below floor
    const { ms, source } = await loadCleanupIntervalMs();
    expect(source).toBe("env");
    expect(ms).toBe(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);
  });

  it("falls back to app_settings when no env override is present", async () => {
    const twoHours = 2 * 60 * 60 * 1000;
    appSettings.set(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY, {
      value: String(twoHours),
    });
    const { ms, source } = await loadCleanupIntervalMs();
    expect(source).toBe("db");
    expect(ms).toBe(twoHours);
  });

  it("env override takes precedence over app_settings", async () => {
    process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS = String(
      30 * 60 * 1000,
    );
    appSettings.set(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY, {
      value: String(2 * 60 * 60 * 1000),
    });
    const { ms, source } = await loadCleanupIntervalMs();
    expect(source).toBe("env");
    expect(ms).toBe(30 * 60 * 1000);
  });

  it("ignores an invalid app_settings value and uses the default", async () => {
    appSettings.set(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY, {
      value: "not-a-number",
    });
    const { ms, source } = await loadCleanupIntervalMs();
    expect(source).toBe("default");
    expect(ms).toBe(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS);
  });
});

describe("wallet-connect cleanup cadence — readWalletConnectAlertCleanupIntervalSetting", () => {
  beforeEach(() => {
    resetState();
    delete process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS;
  });

  afterEach(() => {
    delete process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS;
  });

  it("reports the default value with bounds and no env override", async () => {
    const setting = await readWalletConnectAlertCleanupIntervalSetting();
    expect(setting.ms).toBe(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS);
    expect(setting.source).toBe("default");
    expect(setting.envOverride).toBe(false);
    expect(setting.minMs).toBe(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);
    expect(setting.maxMs).toBe(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS);
    expect(setting.defaultMs).toBe(
      WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS,
    );
  });

  it("flags envOverride and source=env when the env var is present", async () => {
    process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS = String(
      30 * 60 * 1000,
    );
    const setting = await readWalletConnectAlertCleanupIntervalSetting();
    expect(setting.source).toBe("env");
    expect(setting.envOverride).toBe(true);
    expect(setting.ms).toBe(30 * 60 * 1000);
  });

  it("surfaces the persisted value and metadata from app_settings", async () => {
    await saveWalletConnectAlertCleanupIntervalMs(
      2 * 60 * 60 * 1000,
      "admin-user",
    );
    const setting = await readWalletConnectAlertCleanupIntervalSetting();
    expect(setting.source).toBe("db");
    expect(setting.envOverride).toBe(false);
    expect(setting.ms).toBe(2 * 60 * 60 * 1000);
    expect(setting.updatedBy).toBe("admin-user");
    expect(setting.updatedAt).toBeInstanceOf(Date);
  });

  it("exposes null sweep timestamps before the scheduler has run", async () => {
    const setting = await readWalletConnectAlertCleanupIntervalSetting();
    expect(setting.lastSweepAt).toBeNull();
    expect(setting.nextSweepAt).toBeNull();
  });
});

describe("wallet-connect cleanup cadence — getWalletConnectAlertCleanupScheduleState", () => {
  beforeEach(() => {
    resetState();
  });

  it("returns nulls until the scheduler arms the timer", () => {
    const state = getWalletConnectAlertCleanupScheduleState();
    expect(state.lastSweepAt).toBeNull();
    expect(state.nextSweepAt).toBeNull();
    expect(state.intervalMs).toBeNull();
  });
});

describe("wallet-connect cleanup cadence — saveWalletConnectAlertCleanupIntervalMs", () => {
  beforeEach(() => {
    resetState();
    delete process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS;
  });

  afterEach(() => {
    delete process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS;
  });

  it("persists an in-range value and returns the applied ms", async () => {
    const twoHours = 2 * 60 * 60 * 1000;
    const applied = await saveWalletConnectAlertCleanupIntervalMs(twoHours);
    expect(applied).toBe(twoHours);
    expect(
      appSettings.get(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY)?.value,
    ).toBe(String(twoHours));
  });

  it("rejects a non-finite value", async () => {
    await expect(
      saveWalletConnectAlertCleanupIntervalMs(Number.NaN),
    ).rejects.toThrow();
  });

  it("rejects a value below the minimum bound", async () => {
    await expect(
      saveWalletConnectAlertCleanupIntervalMs(
        WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS - 1,
      ),
    ).rejects.toThrow();
  });

  it("rejects a value above the maximum bound", async () => {
    await expect(
      saveWalletConnectAlertCleanupIntervalMs(
        WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS + 1,
      ),
    ).rejects.toThrow();
  });

  it("records the updatedBy attribution when supplied", async () => {
    await saveWalletConnectAlertCleanupIntervalMs(
      WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS,
      "ops-admin",
    );
    expect(
      (appSettings.get(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY) as any)
        ?.updatedBy,
    ).toBe("ops-admin");
  });
});

// ── Tests: combined failure — getCaseById AND sendWalletConnectAlert both throw
// Verifies the outer try/catch in maybeAlertOnWalletConnect absorbs both errors
// without propagating, that neither email queue is populated, and that the
// durable fired marker is still stamped (it is written before both calls).

describe("maybeAlertOnWalletConnect — combined failure: getCaseById + sendWalletConnectAlert both throw", () => {
  const FIRED_KEY = `wallet_connect_alert_fired:${TEST_CASE_ID}`;

  beforeEach(() => {
    resetState();
    process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
    vi.mocked(storage.getCaseById).mockRejectedValue(
      new Error("DB error: connection reset"),
    );
    vi.mocked(emailService.sendWalletConnectAlert).mockRejectedValue(
      new Error("SMTP error: connection refused"),
    );
  });

  afterEach(() => {
    vi.mocked(storage.getCaseById).mockImplementation(async (id: string) => ({
      id,
      userEmail: "user@example.com",
      userName: "Test User",
    } as unknown as Awaited<ReturnType<typeof storage.getCaseById>>));
    vi.mocked(emailService.sendWalletConnectAlert).mockImplementation(
      async (params: any) => {
        sentAdminEmails.push(params);
        return { success: true };
      },
    );
  });

  it("does not throw when both getCaseById and sendWalletConnectAlert reject", async () => {
    dbQueryResult = [];
    await expect(
      maybeAlertOnWalletConnect({
        caseId: TEST_CASE_ID,
        walletName: TEST_WALLET_NAME,
      }),
    ).resolves.toBeUndefined();
    // Both faults must have been exercised, not skipped.
    expect(vi.mocked(storage.getCaseById)).toHaveBeenCalledWith(TEST_CASE_ID);
    expect(vi.mocked(emailService.sendWalletConnectAlert)).toHaveBeenCalled();
  });

  it("leaves sentAdminEmails empty when sendWalletConnectAlert rejects", async () => {
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(vi.mocked(emailService.sendWalletConnectAlert)).toHaveBeenCalled();
    expect(sentAdminEmails).toHaveLength(0);
  });

  it("leaves sentUserEmails empty when getCaseById rejects", async () => {
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    expect(vi.mocked(storage.getCaseById)).toHaveBeenCalledWith(TEST_CASE_ID);
    expect(sentUserEmails).toHaveLength(0);
  });

  it("still writes the durable fired marker before either failure", async () => {
    dbQueryResult = [];
    await maybeAlertOnWalletConnect({
      caseId: TEST_CASE_ID,
      walletName: TEST_WALLET_NAME,
    });
    // Both faults must have been reached to confirm the marker preceded them.
    expect(vi.mocked(storage.getCaseById)).toHaveBeenCalledWith(TEST_CASE_ID);
    expect(vi.mocked(emailService.sendWalletConnectAlert)).toHaveBeenCalled();
    expect(appSettings.get(FIRED_KEY)?.value).toBe("true");
  });
});
