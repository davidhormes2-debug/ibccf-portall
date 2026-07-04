import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createStorageMock } from "../__tests__/helpers/storageMock";

// ── Task #855 — recurring timer test ──────────────────────────────────────────
// Verifies that the cleanup-sweep interval (armed by
// startWalletConnectAlertMarkerCleanupSweep / scheduleCleanupSweep) invokes
// BOTH cleanupOrphanedWalletConnectAlertMarkers AND
// backfillMissingWalletConnectCompletions on each tick. Task #841 folded the
// backfill into the recurring timer so the wallet-connect audit trail
// self-heals continuously; this test catches a regression where the backfill
// is accidentally dropped from the interval callback.
//
// Detection strategy: both functions set their re-entrancy guard synchronously
// (before any `await`) the moment they are invoked. By advancing the fake clock
// synchronously (vi.advanceTimersByTime) and then immediately calling each
// function again, we detect whether the interval tick held their guards — a
// `skipped: true` result means the timer DID invoke that function. This avoids
// relying on deep microtask flushing of fire-and-forget async chains.

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async () => {}),
    })),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and:     vi.fn((...args: any[]) => ({ _type: "and", args })),
  eq:      vi.fn((col: any, val: any) => ({ _type: "eq", col, val })),
  like:    vi.fn((col: any, pat: any) => ({ _type: "like", col, pat })),
  or:      vi.fn((...args: any[]) => ({ _type: "or", args })),
  inArray: vi.fn((col: any, vals: any) => ({ _type: "inArray", col, vals })),
}));

vi.mock("@shared/schema", () => ({
  appSettings: {
    key:       "app_settings.key",
    value:     "app_settings.value",
    updatedAt: "app_settings.updated_at",
  },
  auditLogs: {
    action:   "audit_logs.action",
    targetId: "audit_logs.target_id",
  },
  cases: {
    id: "cases.id",
  },
}));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAppSetting:  vi.fn(async () => null),
    setAppSetting:  vi.fn(async (key: string, value: string) => ({ key, value })),
    createAuditLog: vi.fn(async () => ({})),
    getCaseById:    vi.fn(async (id: string) => ({ id, walletExchangeName: null })),
  }),
}));

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
  startWalletConnectAlertMarkerCleanupSweep,
  cleanupOrphanedWalletConnectAlertMarkers,
  backfillMissingWalletConnectCompletions,
  applyCleanupIntervalChange,
  readWalletConnectAlertCleanupIntervalSetting,
  getWalletConnectAlertCleanupScheduleState,
  WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS,
  WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS,
  WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY,
  WALLET_CONNECT_ALERT_CLEANUP_LAST_SWEEP_AT_SETTING_KEY,
  __resetWalletConnectAlertCleanupScheduleForTests,
  __resetWalletConnectAlertCleanupGuardForTests,
  __resetWalletConnectCompletionBackfillGuardForTests,
} = await import("../services/walletConnectAlert");

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Force the env-override path in loadCleanupIntervalMs so the interval is
  // the minimum clamped value (60 s) without touching the DB mock.
  process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS = String(
    WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS,
  );

  __resetWalletConnectAlertCleanupScheduleForTests();
  __resetWalletConnectAlertCleanupGuardForTests();
  __resetWalletConnectCompletionBackfillGuardForTests();

  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllTimers();
  delete process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Flush Promise microtasks for a given number of rounds. Used to let the async
 * `loadCleanupIntervalMs().then(scheduleCleanupSweep)` chain complete after
 * startWalletConnectAlertMarkerCleanupSweep() is called.
 */
async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("wallet-connect alert cleanup sweep — recurring timer", () => {
  it("triggers both cleanupOrphanedWalletConnectAlertMarkers and backfillMissingWalletConnectCompletions on each tick", async () => {
    // Arm the scheduler (boot kick-off runs immediately; setInterval is
    // registered once loadCleanupIntervalMs resolves).
    startWalletConnectAlertMarkerCleanupSweep();
    // Let loadCleanupIntervalMs().then(scheduleCleanupSweep) complete.
    await flushMicrotasks();

    // Explicitly reset both re-entrancy guards so we start from a known state,
    // independent of whether the boot sweep has fully unwound yet.
    __resetWalletConnectAlertCleanupGuardForTests();
    __resetWalletConnectCompletionBackfillGuardForTests();

    // ── Fire one interval tick (synchronous) ─────────────────────────────────
    // Both cleanupOrphanedWalletConnectAlertMarkers and
    // backfillMissingWalletConnectCompletions set their re-entrancy guards
    // SYNCHRONOUSLY at the very start of the function, before any `await`.
    // Advancing the clock synchronously fires the setInterval callback
    // (runScheduledCleanupTick) and returns before any async work runs — so
    // the guards are guaranteed to be held the moment we inspect them.
    vi.advanceTimersByTime(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);

    // ── Detect cleanupOrphanedWalletConnectAlertMarkers was invoked ──────────
    // A concurrent direct call returns skipped:true if the guard is held.
    const cleanupProbe = await cleanupOrphanedWalletConnectAlertMarkers();
    expect(
      cleanupProbe.skipped,
      "cleanupOrphanedWalletConnectAlertMarkers must be invoked by the interval callback",
    ).toBe(true);

    // ── Detect backfillMissingWalletConnectCompletions was invoked ───────────
    const backfillProbe = await backfillMissingWalletConnectCompletions();
    expect(
      backfillProbe.skipped,
      "backfillMissingWalletConnectCompletions must be invoked by the interval callback (Task #841)",
    ).toBe(true);
  });

  it("re-invokes both sweeps on the second tick", async () => {
    startWalletConnectAlertMarkerCleanupSweep();
    await flushMicrotasks();

    __resetWalletConnectAlertCleanupGuardForTests();
    __resetWalletConnectCompletionBackfillGuardForTests();

    // ── Tick 1 ───────────────────────────────────────────────────────────────
    vi.advanceTimersByTime(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);

    // Confirm tick 1 invoked both (guards held).
    const t1cleanup = await cleanupOrphanedWalletConnectAlertMarkers();
    const t1backfill = await backfillMissingWalletConnectCompletions();
    expect(t1cleanup.skipped).toBe(true);
    expect(t1backfill.skipped).toBe(true);

    // Allow tick 1's fire-and-forget async chains to complete so the guards
    // reset (both functions call `finally { guard = false }`).
    await flushMicrotasks(50);
    __resetWalletConnectAlertCleanupGuardForTests();
    __resetWalletConnectCompletionBackfillGuardForTests();

    // ── Tick 2 ───────────────────────────────────────────────────────────────
    vi.advanceTimersByTime(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);

    const t2cleanup = await cleanupOrphanedWalletConnectAlertMarkers();
    const t2backfill = await backfillMissingWalletConnectCompletions();
    expect(
      t2cleanup.skipped,
      "cleanup must fire again on the second tick",
    ).toBe(true);
    expect(
      t2backfill.skipped,
      "backfill must fire again on the second tick",
    ).toBe(true);
  });

  it("applyCleanupIntervalChange reschedules the timer to the new cadence without a restart", async () => {
    // ── Arm at MIN_MS (60 s) ─────────────────────────────────────────────────
    // beforeEach already sets the env to MIN_MS; start the scheduler.
    startWalletConnectAlertMarkerCleanupSweep();
    await flushMicrotasks();

    __resetWalletConnectAlertCleanupGuardForTests();
    __resetWalletConnectCompletionBackfillGuardForTests();

    // ── Switch to 2× MIN_MS (120 s) via env + applyCleanupIntervalChange ────
    const newInterval = 2 * WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS;
    process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS = String(newInterval);
    // applyCleanupIntervalChange is async (calls loadCleanupIntervalMs) and
    // returns the newly applied cadence; it clears the old timer and arms a new
    // one at the new cadence.
    await applyCleanupIntervalChange();
    await flushMicrotasks();

    // Reset guards to a clean baseline after the reschedule.
    __resetWalletConnectAlertCleanupGuardForTests();
    __resetWalletConnectCompletionBackfillGuardForTests();

    // ── Advance by the OLD cadence (MIN_MS) — old timer must be gone ─────────
    // scheduleCleanupSweep calls clearInterval before arming the new timer, so
    // advancing by MIN_MS alone must NOT fire either sweep.
    vi.advanceTimersByTime(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);

    const afterOldCleanup = await cleanupOrphanedWalletConnectAlertMarkers();
    const afterOldBackfill = await backfillMissingWalletConnectCompletions();
    expect(
      afterOldCleanup.skipped,
      "cleanup must NOT fire at the old cadence after reschedule",
    ).toBe(false);
    expect(
      afterOldBackfill.skipped,
      "backfill must NOT fire at the old cadence after reschedule",
    ).toBe(false);

    // The probes above ran without the guard held (skipped: false), so each
    // function completed and released its guard via `finally`. Reset explicitly
    // for clarity before we detect the new-cadence tick.
    await flushMicrotasks(20);
    __resetWalletConnectAlertCleanupGuardForTests();
    __resetWalletConnectCompletionBackfillGuardForTests();

    // ── Advance the remaining MIN_MS to reach the new cadence ────────────────
    // Total elapsed = 2× MIN_MS = new cadence; the rescheduled timer fires now.
    vi.advanceTimersByTime(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);

    const afterNewCleanup = await cleanupOrphanedWalletConnectAlertMarkers();
    const afterNewBackfill = await backfillMissingWalletConnectCompletions();
    expect(
      afterNewCleanup.skipped,
      "cleanup must fire at the new cadence",
    ).toBe(true);
    expect(
      afterNewBackfill.skipped,
      "backfill must fire at the new cadence",
    ).toBe(true);
  });

  it("readWalletConnectAlertCleanupIntervalSetting returns nextSweepAt null when the scheduler has never started", async () => {
    // beforeEach calls __resetWalletConnectAlertCleanupScheduleForTests() and
    // does NOT start the scheduler, so this test represents a freshly-deployed
    // instance before the first boot sweep.

    const setting = await readWalletConnectAlertCleanupIntervalSetting();

    // The effective cadence must still be readable (env override is set in
    // beforeEach), but schedule timestamps must be null because no timer has
    // been armed in this process lifetime.
    expect(
      setting.nextSweepAt,
      "nextSweepAt must be null before the scheduler is started",
    ).toBeNull();
    expect(
      setting.lastSweepAt,
      "lastSweepAt must be null before the scheduler is started",
    ).toBeNull();

    // Cross-check the raw schedule state accessor that the setting reader
    // delegates to — both surfaces must agree.
    const scheduleState = getWalletConnectAlertCleanupScheduleState();
    expect(
      scheduleState.intervalMs,
      "intervalMs must be null before the scheduler is started",
    ).toBeNull();
    expect(
      scheduleState.nextSweepAt,
      "scheduleState.nextSweepAt must be null before the scheduler is started",
    ).toBeNull();
    expect(
      scheduleState.lastSweepAt,
      "scheduleState.lastSweepAt must be null before the scheduler is started",
    ).toBeNull();
  });

  it("readWalletConnectAlertCleanupIntervalSetting reflects the new cadence immediately after applyCleanupIntervalChange", async () => {
    // Arm the scheduler at MIN_MS so cleanupTimer is set (applyCleanupIntervalChange
    // only reschedules when the timer is armed).
    startWalletConnectAlertMarkerCleanupSweep();
    await flushMicrotasks();

    // Switch to 2× MIN_MS via env override, then apply the change.
    const newInterval = 2 * WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS;
    process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS = String(newInterval);
    await applyCleanupIntervalChange();
    await flushMicrotasks();

    // Capture the frozen fake-clock baseline. No timers are advanced, so
    // Date.now() is the same value scheduleCleanupSweep saw when it stamped
    // nextSweepAt — the subtraction below should be exactly 0.
    const now = Date.now();

    const setting = await readWalletConnectAlertCleanupIntervalSetting();

    // The effective cadence must reflect the new value immediately (no restart
    // required). The env override drives loadCleanupIntervalMs so source==="env".
    expect(
      setting.ms,
      "setting.ms must equal the new cadence immediately after applyCleanupIntervalChange",
    ).toBe(newInterval);

    // nextSweepAt must be set (scheduler is armed) and projected at now + newInterval.
    expect(
      setting.nextSweepAt,
      "nextSweepAt must not be null after a cadence change with the scheduler armed",
    ).not.toBeNull();
    const expectedNextSweep = now + newInterval;
    // Fake timers freeze Date.now(), so the delta should be 0. Allow ≤1 s for
    // any internal microtask ordering that could introduce a clock step.
    expect(
      Math.abs(setting.nextSweepAt!.getTime() - expectedNextSweep),
      "nextSweepAt must be within 1 s of Date.now() + newInterval",
    ).toBeLessThanOrEqual(1000);

    // Cross-check via getWalletConnectAlertCleanupScheduleState so we confirm
    // the same in-process state that readWalletConnectAlertCleanupIntervalSetting
    // reads from is also updated correctly.
    const scheduleState = getWalletConnectAlertCleanupScheduleState();
    expect(
      scheduleState.intervalMs,
      "scheduleState.intervalMs must equal the new cadence",
    ).toBe(newInterval);
    expect(
      scheduleState.nextSweepAt,
      "scheduleState.nextSweepAt must not be null",
    ).not.toBeNull();
    expect(
      Math.abs(scheduleState.nextSweepAt!.getTime() - expectedNextSweep),
      "scheduleState.nextSweepAt must be within 1 s of Date.now() + newInterval",
    ).toBeLessThanOrEqual(1000);
  });

  it("lastSweepAt transitions null → set → null after one tick and reset", async () => {
    // beforeEach calls __resetWalletConnectAlertCleanupScheduleForTests() and
    // does NOT start the scheduler, so lastSweepAt starts null.
    const before = getWalletConnectAlertCleanupScheduleState();
    expect(
      before.lastSweepAt,
      "lastSweepAt must be null before the scheduler starts",
    ).toBeNull();

    // Start the scheduler — the boot kick-off stamps lastSweepAt immediately.
    // Let loadCleanupIntervalMs().then(scheduleCleanupSweep) complete so the
    // interval timer is armed before we advance the clock.
    startWalletConnectAlertMarkerCleanupSweep();
    await flushMicrotasks();

    // ── Advance one interval tick ─────────────────────────────────────────────
    // runScheduledCleanupTick sets lastSweepAt synchronously (before any
    // `await`), so advancing the fake clock is sufficient — no microtask
    // flushing is needed to observe the stamp.
    vi.advanceTimersByTime(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);

    const afterTick = getWalletConnectAlertCleanupScheduleState();
    expect(
      afterTick.lastSweepAt,
      "lastSweepAt must be non-null after the scheduler fires one tick",
    ).not.toBeNull();

    // ── Reset the schedule state ──────────────────────────────────────────────
    __resetWalletConnectAlertCleanupScheduleForTests();

    const afterReset = getWalletConnectAlertCleanupScheduleState();
    expect(
      afterReset.lastSweepAt,
      "lastSweepAt must be null again after __resetWalletConnectAlertCleanupScheduleForTests",
    ).toBeNull();
  });

  // ── Task #987 — sweep timestamp persistence and restart durability ───────────

  it("runScheduledCleanupTick persists the last-sweep timestamp to storage.setAppSetting with the correct key and an ISO string value", async () => {
    // Obtain the storage mock so we can inspect calls after the tick fires.
    const { storage } = await import("../storage");
    const setAppSettingMock = storage.setAppSetting as ReturnType<typeof vi.fn>;
    setAppSettingMock.mockClear();

    // Arm the scheduler and flush so the interval timer is registered.
    startWalletConnectAlertMarkerCleanupSweep();
    await flushMicrotasks();

    // Reset the call record that the boot kick-off may have produced so we
    // only observe the one tick we deliberately fire below.
    setAppSettingMock.mockClear();

    // Capture the fake-clock baseline so we can verify the ISO string matches.
    const beforeTick = Date.now();

    // ── Fire one interval tick synchronously ──────────────────────────────────
    // runScheduledCleanupTick stamps lastSweepAt and calls
    // storage.setAppSetting(...) synchronously before any `await`.
    vi.advanceTimersByTime(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);

    // The setAppSetting call is fire-and-forget via .catch(), but its
    // initiating call (storage.setAppSetting(...)) is made synchronously
    // inside the tick function — so it must have been invoked by now.
    expect(
      setAppSettingMock,
      "storage.setAppSetting must be called by the tick",
    ).toHaveBeenCalled();

    // Find the call that wrote the last-sweep timestamp key.
    const sweepCall = setAppSettingMock.mock.calls.find(
      ([key]) => key === WALLET_CONNECT_ALERT_CLEANUP_LAST_SWEEP_AT_SETTING_KEY,
    );
    expect(
      sweepCall,
      `storage.setAppSetting must be called with key "${WALLET_CONNECT_ALERT_CLEANUP_LAST_SWEEP_AT_SETTING_KEY}"`,
    ).toBeDefined();

    const [_key, value] = sweepCall!;

    // The value must be a valid ISO 8601 string.
    const parsed = new Date(value);
    expect(
      Number.isNaN(parsed.getTime()),
      "the persisted value must be a parseable ISO date string",
    ).toBe(false);

    // The timestamp must be >= the baseline we captured (fake timers are
    // frozen so it should equal beforeTick exactly, but we use >= for safety).
    expect(
      parsed.getTime(),
      "the persisted timestamp must be >= the time just before the tick fired",
    ).toBeGreaterThanOrEqual(beforeTick);
  });

  it("readWalletConnectAlertCleanupIntervalSetting reflects a durable timestamp from storage when in-process state is reset", async () => {
    // ── Simulate a process restart ────────────────────────────────────────────
    // __resetWalletConnectAlertCleanupScheduleForTests() is already called in
    // beforeEach, so the in-process lastSweepAt / nextSweepAt start as null.
    // We do NOT start the scheduler, representing an instance that just booted
    // and has not yet fired its first tick.

    const knownSweepTime = new Date("2025-11-01T08:30:00.000Z");
    const knownSweepIso = knownSweepTime.toISOString();

    // Stub getAppSetting to return the durable timestamp for the sweep key.
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    getAppSettingMock.mockImplementation(async (key: string) => {
      if (key === WALLET_CONNECT_ALERT_CLEANUP_LAST_SWEEP_AT_SETTING_KEY) {
        return { key, value: knownSweepIso, updatedAt: knownSweepTime, updatedBy: "system" };
      }
      return null;
    });

    const setting = await readWalletConnectAlertCleanupIntervalSetting();

    // lastSweepAt must reflect the durable value — not null — even though the
    // in-process state was reset (simulating a fresh restart that reads from DB).
    expect(
      setting.lastSweepAt,
      "lastSweepAt must equal the durable timestamp read from storage",
    ).not.toBeNull();
    expect(
      setting.lastSweepAt!.getTime(),
      "lastSweepAt must equal the known durable sweep time",
    ).toBe(knownSweepTime.getTime());

    // nextSweepAt must be derived from the durable lastSweepAt + effective cadence.
    expect(
      setting.nextSweepAt,
      "nextSweepAt must not be null when a durable lastSweepAt is available",
    ).not.toBeNull();
    expect(
      setting.nextSweepAt!.getTime(),
      "nextSweepAt must equal lastSweepAt + effective interval",
    ).toBe(knownSweepTime.getTime() + setting.ms);

    // Restore the mock to the default so subsequent tests are unaffected.
    getAppSettingMock.mockImplementation(async () => null);
  });

  // ── Multi-instance timestamp resolution (max(local, durable)) ────────────────
  // These two tests verify the merge logic in readWalletConnectAlertCleanupIntervalSetting
  // that handles concurrent autoscale instances each writing their own sweep time.

  it("durable timestamp wins when another instance swept more recently than this process (T2 > T1)", async () => {
    // Arm the scheduler and fire one tick so the in-process lastSweepAt (T1) is set.
    startWalletConnectAlertMarkerCleanupSweep();
    await flushMicrotasks();

    // Fire a tick so in-process lastSweepAt = T1 (current fake-clock time).
    vi.advanceTimersByTime(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);

    // Capture T1 from the live schedule state (set synchronously by the tick).
    const T1 = getWalletConnectAlertCleanupScheduleState().lastSweepAt!;
    expect(T1, "T1 must be set after the first tick").not.toBeNull();

    // T2 is a newer durable timestamp — as if another instance swept 5 minutes later.
    const T2 = new Date(T1.getTime() + 5 * 60 * 1000);
    const T2iso = T2.toISOString();

    // Stub getAppSetting so the sweep-at key returns T2.
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    getAppSettingMock.mockImplementation(async (key: string) => {
      if (key === WALLET_CONNECT_ALERT_CLEANUP_LAST_SWEEP_AT_SETTING_KEY) {
        return { key, value: T2iso, updatedAt: T2, updatedBy: "system" };
      }
      return null;
    });

    const setting = await readWalletConnectAlertCleanupIntervalSetting();

    // The durable T2 is newer, so it must win.
    expect(
      setting.lastSweepAt,
      "lastSweepAt must not be null",
    ).not.toBeNull();
    expect(
      setting.lastSweepAt!.getTime(),
      "durable T2 must win over in-process T1 when T2 > T1",
    ).toBe(T2.getTime());

    // nextSweepAt must be derived from the winning T2.
    expect(
      setting.nextSweepAt!.getTime(),
      "nextSweepAt must be T2 + effective interval",
    ).toBe(T2.getTime() + setting.ms);

    // Restore default mock.
    getAppSettingMock.mockImplementation(async () => null);
  });

  it("in-process timestamp wins when this instance swept more recently than the durable value (T1 > T2)", async () => {
    // Arm the scheduler and fire one tick so the in-process lastSweepAt (T1) is set.
    startWalletConnectAlertMarkerCleanupSweep();
    await flushMicrotasks();

    // Fire a tick so in-process lastSweepAt = T1.
    vi.advanceTimersByTime(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);

    // Capture T1 from the live schedule state.
    const T1 = getWalletConnectAlertCleanupScheduleState().lastSweepAt!;
    expect(T1, "T1 must be set after the first tick").not.toBeNull();

    // T2 is an older durable timestamp — as if the DB row was written by an
    // instance that swept 5 minutes before this one (e.g. a slower autoscale
    // replica that hasn't ticked as recently as this process).
    const T2 = new Date(T1.getTime() - 5 * 60 * 1000);
    const T2iso = T2.toISOString();

    // Stub getAppSetting so the sweep-at key returns the older T2.
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    getAppSettingMock.mockImplementation(async (key: string) => {
      if (key === WALLET_CONNECT_ALERT_CLEANUP_LAST_SWEEP_AT_SETTING_KEY) {
        return { key, value: T2iso, updatedAt: T2, updatedBy: "system" };
      }
      return null;
    });

    const setting = await readWalletConnectAlertCleanupIntervalSetting();

    // The in-process T1 is newer, so it must be preserved — the older durable
    // value must not overwrite a fresher local sweep.
    expect(
      setting.lastSweepAt,
      "lastSweepAt must not be null",
    ).not.toBeNull();
    expect(
      setting.lastSweepAt!.getTime(),
      "in-process T1 must win over durable T2 when T1 > T2",
    ).toBe(T1.getTime());

    // nextSweepAt must be derived from the winning T1.
    expect(
      setting.nextSweepAt!.getTime(),
      "nextSweepAt must be T1 + effective interval",
    ).toBe(T1.getTime() + setting.ms);

    // Restore default mock.
    getAppSettingMock.mockImplementation(async () => null);
  });

  it("in-process timestamp is preserved when durable and local timestamps are equal (T1 === T2)", async () => {
    // Arm the scheduler and fire one tick so the in-process lastSweepAt (T1) is set.
    startWalletConnectAlertMarkerCleanupSweep();
    await flushMicrotasks();

    // Fire a tick so in-process lastSweepAt = T1.
    vi.advanceTimersByTime(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS);

    // Capture T1 from the live schedule state.
    const T1 = getWalletConnectAlertCleanupScheduleState().lastSweepAt!;
    expect(T1, "T1 must be set after the first tick").not.toBeNull();

    // T2 equals T1 exactly — the tie case the strict > guard is meant to handle.
    const T2 = new Date(T1.getTime());
    const T2iso = T2.toISOString();

    // Stub getAppSetting so the sweep-at key returns the identical timestamp T2.
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    getAppSettingMock.mockImplementation(async (key: string) => {
      if (key === WALLET_CONNECT_ALERT_CLEANUP_LAST_SWEEP_AT_SETTING_KEY) {
        return { key, value: T2iso, updatedAt: T2, updatedBy: "system" };
      }
      return null;
    });

    const setting = await readWalletConnectAlertCleanupIntervalSetting();

    // With a strict > guard, equal timestamps must not replace the local value;
    // the result must still be T1 (=== T2 numerically).
    expect(
      setting.lastSweepAt,
      "lastSweepAt must not be null",
    ).not.toBeNull();
    expect(
      setting.lastSweepAt!.getTime(),
      "local T1 must be preserved when T1 === T2 (strict > guard, tie goes to local)",
    ).toBe(T1.getTime());

    // nextSweepAt must be derived from T1 (which equals T2).
    expect(
      setting.nextSweepAt!.getTime(),
      "nextSweepAt must be T1 + effective interval",
    ).toBe(T1.getTime() + setting.ms);

    // Source-string guard: assert the comparison operator is strict >, not >=.
    // If this fails, someone changed the operator and the tie-break semantics
    // (ties preserve the local in-process value) may have been silently broken.
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve("server/services/walletConnectAlert.ts"),
      "utf8",
    );
    expect(
      src,
      "walletConnectAlert.ts must use strict > (not >=) for the sweep tie-break comparison",
    ).toMatch(
      /parsed\.getTime\(\) > resolvedLastSweepAt\.getTime\(\)/,
    );

    // Restore default mock.
    getAppSettingMock.mockImplementation(async () => null);
  });

  // ── Task #1126 — cold-start: timer re-arms from the DB-persisted value ───────
  // Verifies that when the server restarts and loadCleanupIntervalMs reads the
  // saved value from app_settings, startWalletConnectAlertMarkerCleanupSweep
  // arms the timer with that persisted ms instead of silently falling back to
  // the hardcoded 1-hour default.

  it("cold-start: scheduler arms the timer with the DB-persisted cadence, not the hardcoded default", async () => {
    // Clear the env override set by beforeEach so loadCleanupIntervalMs takes
    // the "env → db → default" path all the way to the DB read.
    delete process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS;

    // Choose a non-default, non-minimum value that is clearly distinguishable
    // from both the 1-hour default (3,600,000 ms) and the 1-minute minimum.
    const persistedMs = 2 * WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS; // 120,000 ms

    // Stub getAppSetting to return the persisted interval for the cadence key.
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    getAppSettingMock.mockImplementation(async (key: string) => {
      if (key === WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY) {
        return { key, value: String(persistedMs), updatedAt: new Date(), updatedBy: "admin" };
      }
      return null;
    });

    // Cold-start: boot the scheduler exactly as the server does on restart.
    startWalletConnectAlertMarkerCleanupSweep();
    // Let loadCleanupIntervalMs().then(scheduleCleanupSweep) complete.
    await flushMicrotasks();

    const scheduleState = getWalletConnectAlertCleanupScheduleState();

    // The timer must be armed with the DB-persisted value.
    expect(
      scheduleState.intervalMs,
      "intervalMs must equal the DB-persisted value after a cold start",
    ).toBe(persistedMs);

    // And must NOT silently revert to the hardcoded 1-hour default.
    expect(
      scheduleState.intervalMs,
      "intervalMs must not be the hardcoded default after a cold start with a saved value",
    ).not.toBe(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS);

    // nextSweepAt must be projected at now + persistedMs.
    const now = Date.now();
    expect(
      scheduleState.nextSweepAt,
      "nextSweepAt must not be null after the scheduler boots with a DB-persisted cadence",
    ).not.toBeNull();
    expect(
      Math.abs(scheduleState.nextSweepAt!.getTime() - (now + persistedMs)),
      "nextSweepAt must be within 1 s of Date.now() + persistedMs",
    ).toBeLessThanOrEqual(1000);

    // Restore mock so subsequent tests are unaffected.
    getAppSettingMock.mockImplementation(async () => null);
  });

  // ── Task #1193 — env override silences a saved DB cadence ────────────────────
  // Verifies the "env > db > default" priority chain in loadCleanupIntervalMs:
  // when BOTH a non-zero env var AND a different DB-persisted value exist, the
  // scheduler must arm the timer with the env value only, never the DB value.
  // Without this test, swapping the priority order (e.g. db checked first) would
  // silently let a stale DB setting shadow the env override at cold start.

  it("cold-start: env override takes precedence over a different DB-persisted cadence", async () => {
    // beforeEach already sets WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS to
    // MIN_MS. Choose a DB-persisted value that is clearly different so that if
    // the priority order is wrong and the DB wins, the assertion will catch it.
    const envMs = WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS; // 60,000 ms
    const dbMs = 2 * WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS; // 120,000 ms

    // Stub getAppSetting to return the DB-persisted cadence. Both env AND DB
    // are set; loadCleanupIntervalMs must short-circuit at the env override and
    // never reach the DB read (but even if it did, the assertion below catches it).
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    getAppSettingMock.mockImplementation(async (key: string) => {
      if (key === WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY) {
        return {
          key,
          value: String(dbMs),
          updatedAt: new Date(),
          updatedBy: "admin",
        };
      }
      return null;
    });

    // Cold-start: boot the scheduler exactly as the server does on restart,
    // with both env override and DB value present.
    startWalletConnectAlertMarkerCleanupSweep();
    // Let loadCleanupIntervalMs().then(scheduleCleanupSweep) complete.
    await flushMicrotasks();

    const scheduleState = getWalletConnectAlertCleanupScheduleState();

    // The timer must be armed with the env value, not the DB value.
    expect(
      scheduleState.intervalMs,
      "intervalMs must equal the env-override value when both env and DB cadences are set",
    ).toBe(envMs);

    // Explicitly confirm the DB value did not shadow the env override.
    expect(
      scheduleState.intervalMs,
      "intervalMs must NOT equal the DB-persisted value when the env override is active",
    ).not.toBe(dbMs);

    // nextSweepAt must be projected at now + envMs (not now + dbMs).
    const now = Date.now();
    expect(
      scheduleState.nextSweepAt,
      "nextSweepAt must not be null after the scheduler boots with an env override",
    ).not.toBeNull();
    expect(
      Math.abs(scheduleState.nextSweepAt!.getTime() - (now + envMs)),
      "nextSweepAt must be within 1 s of Date.now() + envMs, confirming env wins over DB",
    ).toBeLessThanOrEqual(1000);

    // Restore mock so subsequent tests are unaffected.
    getAppSettingMock.mockImplementation(async () => null);
  });

  // ── Task #1511 — non-numeric env override falls through to DB value ───────────
  // Verifies the "env > db > default" priority chain when the env var is set but
  // unparseable (e.g. "abc"). `readEnvCleanupIntervalOverride` returns null for
  // any non-finite result, so `loadCleanupIntervalMs` must fall through to the DB
  // read and arm the scheduler with the persisted cadence — not the hardcoded
  // default. Without this test, swapping the NaN guard to a truthy check would
  // silently let a garbage env value skip the DB read entirely and use the default.

  it("cold-start: non-numeric env override falls through to the DB-persisted cadence, not the default", async () => {
    // Replace the numeric env override set by beforeEach with a garbage value.
    // Number.parseFloat("abc") === NaN, which is not finite, so
    // readEnvCleanupIntervalOverride must return null and loadCleanupIntervalMs
    // must proceed to the DB read.
    process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS = "abc";

    // Choose a DB-persisted value that is clearly distinguishable from both the
    // 1-hour default (3,600,000 ms) and the 1-minute minimum (60,000 ms).
    const persistedMs = 2 * WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS; // 120,000 ms

    // Stub getAppSetting to return the persisted interval for the cadence key.
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    getAppSettingMock.mockImplementation(async (key: string) => {
      if (key === WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY) {
        return {
          key,
          value: String(persistedMs),
          updatedAt: new Date(),
          updatedBy: "admin",
        };
      }
      return null;
    });

    // Cold-start: boot the scheduler exactly as the server does on restart.
    startWalletConnectAlertMarkerCleanupSweep();
    // Let loadCleanupIntervalMs().then(scheduleCleanupSweep) complete.
    await flushMicrotasks();

    const scheduleState = getWalletConnectAlertCleanupScheduleState();

    // The timer must be armed with the DB-persisted value — the garbage env
    // string must have fallen through to the DB path.
    expect(
      scheduleState.intervalMs,
      "intervalMs must equal the DB-persisted value when the env override is non-numeric",
    ).toBe(persistedMs);

    // Explicitly confirm neither the default nor the env-parse artifact won.
    expect(
      scheduleState.intervalMs,
      "intervalMs must NOT be the hardcoded default when a DB-persisted cadence is available",
    ).not.toBe(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS);

    // nextSweepAt must be projected at now + persistedMs.
    const now = Date.now();
    expect(
      scheduleState.nextSweepAt,
      "nextSweepAt must not be null after the scheduler boots with a DB-persisted cadence",
    ).not.toBeNull();
    expect(
      Math.abs(scheduleState.nextSweepAt!.getTime() - (now + persistedMs)),
      "nextSweepAt must be within 1 s of Date.now() + persistedMs",
    ).toBeLessThanOrEqual(1000);

    // Restore mock so subsequent tests are unaffected.
    getAppSettingMock.mockImplementation(async () => null);
  });
});
