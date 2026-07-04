import { storage } from "../storage";
import { emailService } from "./EmailService";
import { sendCaseEmailWithAudit, resolveRecipientLocale } from "./emailNotify";
import { getPublicAdminUrl } from "../lib/publicBaseUrl";
import {
  parseAdminAlertRecipients,
  ADMIN_ALERT_EMAIL_SETTING_KEY,
} from "../nda-integrity-sweep";

// Fire-and-forget admin email alert when a user completes the wallet
// connection step (i.e. reveals their phrase code for the first time).
// Task #392 — only fires once per case; subsequent reveals are silently
// skipped so admins aren't spammed if the user re-opens the view.

// Task #492 — per-case mute. When the value of this app_settings key is
// the string "true", the dispatcher silently skips the SMTP send and audit
// stamp for that case entirely. Unmuting writes "false" so the key always
// tells the truth at a glance without a delete.
export const WALLET_CONNECT_ALERT_MUTE_KEY_PREFIX =
  "wallet_connect_alert_muted:";

// Task #676 — durable, cross-instance idempotency marker. The wallet-connect
// alert must fire exactly once per case, even across a process restart or when
// the app runs as multiple autoscale instances. The marker is a row in
// `app_settings` keyed by `wallet_connect_alert_fired:<caseId>`, written via an
// idempotent single-statement upsert (storage.setAppSetting) BEFORE any email
// is dispatched. Because it is a separate write from the `wallet_connect_completed`
// audit row, it keeps the alert idempotent even when the audit-row write fails:
// the marker is the source of truth for "has this already fired?", and the audit
// row is best-effort trail only.
export const WALLET_CONNECT_ALERT_FIRED_KEY_PREFIX =
  "wallet_connect_alert_fired:";

export function walletConnectAlertFiredKey(caseId: string): string {
  return `${WALLET_CONNECT_ALERT_FIRED_KEY_PREFIX}${caseId}`;
}

// Task #559 — in-memory short-circuit. A best-effort fast path layered on top
// of the durable marker above: once a case has fired (or attempted to fire) in
// this process, it is short-circuited without re-querying the DB. It does not
// survive a restart and is not shared across instances — the durable marker is
// the cross-restart / cross-instance source of truth. It only narrows the blast
// radius to one DB round-trip per instance when the marker write itself fails.
const firedCaseIdsThisProcess = new Set<string>();

/**
 * Test-only helper: clears the in-memory fired-case short-circuit set so each
 * test starts from a clean process state. Not used by production code.
 */
export function __resetFiredCaseIdsForTests(): void {
  firedCaseIdsThisProcess.clear();
}

export function walletConnectAlertMuteKey(caseId: string): string {
  return `${WALLET_CONNECT_ALERT_MUTE_KEY_PREFIX}${caseId}`;
}

// ── Task #786 — global audit-log reconciliation ───────────────────────────────
// After Task #676 the `wallet_connect_completed` audit row is best-effort: it can
// be skipped when its write fails, while the durable
// `wallet_connect_alert_fired:<caseId>` marker is the source of truth for "the
// alert fired". The per-case Activity Timeline already reconciles against the
// marker (see GET /:id/wallet-events). Any admin surface that lists wallet-connect
// completions by reading the audit log directly — e.g. the global audit-log view —
// has the same gap: it silently omits completions whose audit row never persisted.
// `listFiredWalletConnectAlertMarkers` + `synthesizeMissingWalletConnectCompletions`
// let those surfaces stay complete by reconstructing the missing completion rows
// from the durable markers.

export interface WalletConnectFiredMarker {
  caseId: string;
  updatedAt: Date | null;
}

/**
 * Return every fired-alert marker (`wallet_connect_alert_fired:<caseId>` = "true")
 * with its caseId and last-updated timestamp. Best-effort: a read failure yields
 * an empty list so callers can degrade gracefully.
 */
export async function listFiredWalletConnectAlertMarkers(): Promise<
  WalletConnectFiredMarker[]
> {
  try {
    const { db } = await import("../db");
    const { appSettings } = await import("@shared/schema");
    const { like, eq, and } = await import("drizzle-orm");
    const rows = await db
      .select({
        key: appSettings.key,
        updatedAt: appSettings.updatedAt,
      })
      .from(appSettings)
      .where(
        and(
          like(appSettings.key, `${WALLET_CONNECT_ALERT_FIRED_KEY_PREFIX}%`),
          eq(appSettings.value, "true"),
        ),
      );
    return rows
      .map((r) => ({
        caseId: r.key.slice(WALLET_CONNECT_ALERT_FIRED_KEY_PREFIX.length),
        updatedAt: r.updatedAt ?? null,
      }))
      .filter((m) => m.caseId.trim().length > 0);
  } catch (err) {
    console.error("Failed to list fired wallet connect alert markers:", err);
    return [];
  }
}

/**
 * Given the audit rows an admin surface is about to display, synthesize the
 * `wallet_connect_completed` rows that are missing because their best-effort
 * audit write failed but the durable fired-marker exists. The synthetic rows
 * carry a negative `id` (so they never collide with real serial ids and stay
 * unique as React keys), `targetType: "case"`, the marker's caseId, and the
 * case's selected wallet exchange as `walletName` (the marker itself carries no
 * wallet name). Best-effort: any failure yields an empty list so the caller's
 * audit-log fetch is never broken by reconciliation.
 */
export async function synthesizeMissingWalletConnectCompletions(
  existingLogs: ReadonlyArray<{
    action: string;
    targetId: string | null;
  }>,
): Promise<import("@shared/schema").AuditLog[]> {
  try {
    const markers = await listFiredWalletConnectAlertMarkers();
    if (markers.length === 0) return [];

    const completedCaseIds = new Set(
      existingLogs
        .filter(
          (l) => l.action === "wallet_connect_completed" && l.targetId,
        )
        .map((l) => l.targetId as string),
    );

    const missing = markers.filter((m) => !completedCaseIds.has(m.caseId));
    if (missing.length === 0) return [];

    const synthetic: import("@shared/schema").AuditLog[] = [];
    let syntheticId = -1;
    for (const marker of missing) {
      let walletName: string | null = null;
      try {
        const caseData = await storage.getCaseById(marker.caseId);
        walletName = caseData?.walletExchangeName ?? null;
      } catch {
        walletName = null;
      }
      synthetic.push({
        id: syntheticId,
        adminUsername: "system",
        action: "wallet_connect_completed",
        targetType: "case",
        targetId: marker.caseId,
        previousValue: null,
        newValue: JSON.stringify({ walletName }),
        ipAddress: null,
        userAgent: null,
        metadata: null,
        createdAt: marker.updatedAt ?? new Date(),
      });
      syntheticId -= 1;
    }
    return synthetic;
  } catch (err) {
    console.error(
      "Failed to synthesize missing wallet-connect completions:",
      err,
    );
    return [];
  }
}

export interface WalletConnectAlertMuteState {
  caseId: string;
  muted: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function getWalletConnectAlertMuteState(
  caseId: string,
): Promise<WalletConnectAlertMuteState> {
  try {
    const row = await storage.getAppSetting(walletConnectAlertMuteKey(caseId));
    return {
      caseId,
      muted: row?.value === "true",
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  } catch (err) {
    console.error("Failed to read wallet connect alert mute state:", err);
    return { caseId, muted: false, updatedAt: null, updatedBy: null };
  }
}

export async function isWalletConnectAlertMuted(
  caseId: string,
): Promise<boolean> {
  const state = await getWalletConnectAlertMuteState(caseId);
  return state.muted;
}

export async function setWalletConnectAlertMuted(
  caseId: string,
  muted: boolean,
  updatedBy?: string | null,
  executor?: import("../db").DbExecutor,
): Promise<WalletConnectAlertMuteState> {
  const row = await storage.setAppSetting(
    walletConnectAlertMuteKey(caseId),
    muted ? "true" : "false",
    updatedBy ?? null,
    executor,
  );
  return {
    caseId,
    muted: row.value === "true",
    updatedAt: row.updatedAt ?? null,
    updatedBy: row.updatedBy ?? null,
  };
}

export async function listMutedWalletConnectAlertCaseIds(): Promise<string[]> {
  try {
    const { db } = await import("../db");
    const { appSettings } = await import("@shared/schema");
    const { like, eq, and } = await import("drizzle-orm");
    const rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(
        and(
          like(appSettings.key, `${WALLET_CONNECT_ALERT_MUTE_KEY_PREFIX}%`),
          eq(appSettings.value, "true"),
        ),
      );
    return rows
      .map((r) => r.key.slice(WALLET_CONNECT_ALERT_MUTE_KEY_PREFIX.length))
      .filter((id) => id.trim().length > 0);
  } catch (err) {
    console.error("Failed to list muted wallet connect alert cases:", err);
    return [];
  }
}

// ── Task #764 — marker cleanup ────────────────────────────────────────────────
// The fired/mute markers above are one app_settings row per case that ever
// completed wallet connection (or was muted). They are only meaningful while a
// case exists, but nothing ever removed them — so over a long-lived deployment
// app_settings accumulates a permanent row per case. These two helpers prune
// the dead markers:
//   • deleteWalletConnectAlertMarkersForCase — synchronous, best-effort cleanup
//     fired right after a case is hard-deleted (its markers can never matter
//     again because the case row is gone).
//   • cleanupOrphanedWalletConnectAlertMarkers — periodic safety net that drops
//     any fired/mute marker whose caseId no longer exists in `cases` (covers
//     pre-existing orphans and any delete path that didn't call the helper).
//
// Safety: both paths only ever remove a marker when the owning case row is
// ABSENT from `cases`. A marker for a still-existing case is never touched, so
// the alert can never be wrongly re-armed for a live case.

function cleanupLog(message: string): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [express] ${message}`);
}

function caseIdFromMarkerKey(key: string): string {
  if (key.startsWith(WALLET_CONNECT_ALERT_FIRED_KEY_PREFIX)) {
    return key.slice(WALLET_CONNECT_ALERT_FIRED_KEY_PREFIX.length);
  }
  if (key.startsWith(WALLET_CONNECT_ALERT_MUTE_KEY_PREFIX)) {
    return key.slice(WALLET_CONNECT_ALERT_MUTE_KEY_PREFIX.length);
  }
  return "";
}

/**
 * Remove both the fired and mute markers for a single case. Best-effort and
 * never throws — called from the case-delete path so a freshly hard-deleted
 * case doesn't leave orphan rows behind. Returns the number of rows removed.
 */
export async function deleteWalletConnectAlertMarkersForCase(
  caseId: string,
): Promise<number> {
  try {
    const { db } = await import("../db");
    const { appSettings } = await import("@shared/schema");
    const { inArray } = await import("drizzle-orm");
    const removed = await db
      .delete(appSettings)
      .where(
        inArray(appSettings.key, [
          walletConnectAlertFiredKey(caseId),
          walletConnectAlertMuteKey(caseId),
        ]),
      )
      .returning({ key: appSettings.key });
    // Drop the in-memory short-circuit too so process-local state stays
    // consistent with the now-deleted marker (harmless for uuid case ids,
    // which are never reused, but keeps the set from leaking entries).
    firedCaseIdsThisProcess.delete(caseId);
    return removed.length;
  } catch (err) {
    console.error(
      "[walletConnectAlert] per-case marker cleanup failed:",
      err,
    );
    return 0;
  }
}

// ── Configurable sweep cadence ────────────────────────────────────────────────
// The cleanup sweep interval follows the same "env override > app_settings >
// hard-coded default" pattern as the other periodic sweeps (see
// community-cleanup.ts) so operators can slow the sweep down on large
// deployments without a code change. The value is read once when the scheduler
// is armed at boot; changing it takes effect on the next process start.
export const WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY =
  "wallet_connect_alert_cleanup_interval_ms";

// Default cadence — hourly, matching the original hard-coded behavior.
export const WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS = 60 * 60 * 1000;
// Lower bound — anything under a minute would hammer the DB with sweeps for no
// benefit (orphan markers don't accumulate that fast).
export const WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS = 60 * 1000;
// Upper bound — beyond a week the sweep stops being a meaningful safety net.
export const WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS = 7 * 24 * 60 * 60 * 1000;

function readEnvCleanupIntervalOverride(): number | null {
  const raw = Number.parseFloat(
    process.env.WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS ?? "",
  );
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

export function clampCleanupInterval(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS;
  }
  return Math.min(
    Math.max(ms, WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS),
    WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS,
  );
}

export async function loadCleanupIntervalMs(): Promise<{
  ms: number;
  source: "env" | "db" | "default";
}> {
  const envOverride = readEnvCleanupIntervalOverride();
  if (envOverride !== null) {
    return { ms: clampCleanupInterval(envOverride), source: "env" };
  }
  try {
    const row = await storage.getAppSetting(
      WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY,
    );
    if (row) {
      const parsed = Number.parseFloat(row.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return { ms: clampCleanupInterval(parsed), source: "db" };
      }
    }
  } catch (err) {
    console.error(
      "Failed to read wallet-connect alert cleanup interval setting:",
      err,
    );
  }
  return {
    ms: WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS,
    source: "default",
  };
}

function describeInterval(ms: number): string {
  const minutes = ms / 60000;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "hour" : `${hours} hours`;
  }
  return minutes === 1 ? "minute" : `${minutes} minutes`;
}

// ── Admin-tunable cadence (read / save / reschedule) ──────────────────────────
// The admin dashboard reads the effective interval (env > db > default) plus the
// safe bounds, and can persist a new value to app_settings. The value is stored
// in milliseconds to match the env override + loadCleanupIntervalMs contract; the
// admin UI presents it in minutes. Saving reschedules the live timer immediately
// (see applyCleanupIntervalChange) and survives a restart.

export interface WalletConnectAlertCleanupIntervalSetting {
  ms: number;
  source: "env" | "db" | "default";
  envOverride: boolean;
  minMs: number;
  maxMs: number;
  defaultMs: number;
  updatedAt: Date | null;
  updatedBy: string | null;
  // Task #832 — best-effort, process-local sweep schedule observability. Null
  // until the scheduler has armed the timer at boot (e.g. in test envs that
  // never start it). lastSweepAt is when the most recent sweep tick ran;
  // nextSweepAt is when the next tick is projected to fire on the current
  // cadence.
  lastSweepAt: Date | null;
  nextSweepAt: Date | null;
}

export async function readWalletConnectAlertCleanupIntervalSetting(): Promise<WalletConnectAlertCleanupIntervalSetting> {
  const { ms, source } = await loadCleanupIntervalMs();
  let updatedAt: Date | null = null;
  let updatedBy: string | null = null;
  try {
    const row = await storage.getAppSetting(
      WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY,
    );
    if (row) {
      updatedAt = row.updatedAt ?? null;
      updatedBy = row.updatedBy ?? null;
    }
  } catch (err) {
    console.error(
      "Failed to read wallet-connect alert cleanup interval metadata:",
      err,
    );
  }

  // Task #863 — always read the durable app_settings timestamp so the card
  // reflects whichever instance most recently ran the sweep (not just this
  // process). Resolve the effective lastSweepAt as max(local, durable) so a
  // freshly-swept local value is never hidden by a stale DB read, and a newer
  // durable value from another instance is never hidden by an older local one.
  // nextSweepAt is always derived from resolvedLastSweepAt + effective cadence
  // so it is consistent across instances regardless of which timer fired.
  const schedule = getWalletConnectAlertCleanupScheduleState();
  let resolvedLastSweepAt: Date | null = schedule.lastSweepAt;

  try {
    const row = await storage.getAppSetting(
      WALLET_CONNECT_ALERT_CLEANUP_LAST_SWEEP_AT_SETTING_KEY,
    );
    if (row?.value) {
      const parsed = new Date(row.value);
      if (!Number.isNaN(parsed.getTime())) {
        // Take the later of local and durable: local wins when this instance
        // just swept (DB write may not have committed yet); durable wins when
        // another instance swept more recently than this one.
        if (
          resolvedLastSweepAt === null ||
          parsed.getTime() > resolvedLastSweepAt.getTime() // strict >, NOT >=: ties preserve the local (in-process) value
        ) {
          resolvedLastSweepAt = parsed;
        }
      }
    }
  } catch (err) {
    console.error(
      "Failed to read wallet-connect alert cleanup last-sweep timestamp:",
      err,
    );
  }

  const resolvedNextSweepAt =
    resolvedLastSweepAt !== null
      ? new Date(resolvedLastSweepAt.getTime() + ms)
      : null;

  return {
    ms,
    source,
    envOverride: source === "env",
    minMs: WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS,
    maxMs: WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS,
    defaultMs: WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_DEFAULT_MS,
    updatedAt,
    updatedBy,
    lastSweepAt: resolvedLastSweepAt,
    nextSweepAt: resolvedNextSweepAt,
  };
}

/**
 * Persist a new cleanup-sweep cadence (in milliseconds). Refuses non-finite or
 * out-of-range values so the DB can never store "0" (a tight loop) or an absurd
 * cadence. Returns the value actually applied (clamped). When called inside a
 * transaction the timer reschedule is deferred to applyCleanupIntervalChange,
 * which the route runs after the commit succeeds.
 */
export async function saveWalletConnectAlertCleanupIntervalMs(
  rawMs: number,
  updatedBy?: string | null,
  executor?: import("../db").DbExecutor,
): Promise<number> {
  if (!Number.isFinite(rawMs)) {
    throw new Error("Interval must be a finite number of milliseconds");
  }
  if (
    rawMs < WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS ||
    rawMs > WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS
  ) {
    throw new Error(
      `Interval must be between ${WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS} and ${WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS} milliseconds`,
    );
  }
  const ms = clampCleanupInterval(rawMs);
  await storage.setAppSetting(
    WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_SETTING_KEY,
    String(ms),
    updatedBy ?? null,
    executor,
  );
  if (!executor) {
    await applyCleanupIntervalChange();
  }
  return ms;
}

/** Post-commit hook: re-read the effective cadence and reschedule the timer. */
export async function applyCleanupIntervalChange(): Promise<number> {
  const { ms } = await loadCleanupIntervalMs();
  if (cleanupTimer) {
    scheduleCleanupSweep(ms);
  }
  return ms;
}

let cleanupInFlight = false;

// Live handle for the periodic sweep timer. Kept at module scope so an admin
// cadence change (applyCleanupIntervalChange) can clear and re-arm it without a
// restart. Null until the scheduler is started at boot.
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// ── Task #832 / Task #863 — observable and durable schedule state ────────────
// Process-local timestamps act as a fast-path cache; the durable
// `app_settings` row (key below) survives restarts and is shared across
// autoscale instances so every server reports the true last-sweep time.
// `lastSweepAt` is stamped at the start of each tick (and at boot); the same
// ISO value is persisted to app_settings best-effort. `nextSweepAt` is
// recomputed whenever the timer is (re)armed and after each tick.
export const WALLET_CONNECT_ALERT_CLEANUP_LAST_SWEEP_AT_SETTING_KEY =
  "wallet_connect_alert_cleanup_last_sweep_at";

let lastSweepAt: Date | null = null;
let nextSweepAt: Date | null = null;
let currentCleanupIntervalMs: number | null = null;

export interface WalletConnectAlertCleanupScheduleState {
  lastSweepAt: Date | null;
  nextSweepAt: Date | null;
  intervalMs: number | null;
}

/** Snapshot of the in-process sweep schedule (best-effort, not durable). */
export function getWalletConnectAlertCleanupScheduleState(): WalletConnectAlertCleanupScheduleState {
  return {
    lastSweepAt,
    nextSweepAt,
    intervalMs: currentCleanupIntervalMs,
  };
}

/**
 * Test-only helper: clears the in-process schedule snapshot so each test starts
 * from a clean state. Not used by production code.
 */
export function __resetWalletConnectAlertCleanupScheduleForTests(): void {
  lastSweepAt = null;
  nextSweepAt = null;
  currentCleanupIntervalMs = null;
}

// Run one scheduled tick: stamp the schedule observability state, then kick off
// both best-effort sweeps. Extracted so the boot kick-off and the interval tick
// share identical bookkeeping.
// Task #863 — after stamping the in-process lastSweepAt, persist it durably to
// app_settings so the value survives a restart and is shared across autoscale
// instances. The write is best-effort: a failure is logged but never blocks the
// sweeps from running.
function runScheduledCleanupTick(): void {
  const tickTime = new Date();
  lastSweepAt = tickTime;
  if (currentCleanupIntervalMs !== null) {
    nextSweepAt = new Date(tickTime.getTime() + currentCleanupIntervalMs);
  }
  // Persist durable last-sweep timestamp best-effort.
  storage
    .setAppSetting(
      WALLET_CONNECT_ALERT_CLEANUP_LAST_SWEEP_AT_SETTING_KEY,
      tickTime.toISOString(),
      "system",
    )
    .catch((err) => {
      console.error(
        "[walletConnectAlert] failed to persist last-sweep timestamp:",
        err,
      );
    });
  void cleanupOrphanedWalletConnectAlertMarkers();
  void backfillMissingWalletConnectCompletions();
}

// (Re)arm the periodic sweep timer at the given cadence, clearing any existing
// timer first so a reschedule never leaves two timers running.
//
// Task #841 — each tick runs two best-effort, idempotent sweeps on the same
// cadence: the orphan-marker cleanup AND the durable completion backfill. The
// backfill (Task #826) only ran once at boot, so a `wallet_connect_completed`
// audit row that failed to persist *after* boot stayed covered only by read-time
// reconciliation until the next restart. Running it on the recurring timer makes
// the trail self-heal continuously. Both are idempotent and swallow their own
// errors, so neither can crash the timer or duplicate rows.
function scheduleCleanupSweep(ms: number): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  // Task #832 — record the armed cadence + projected next tick so the admin
  // card reflects a cadence change immediately (the reschedule sets a fresh
  // next-sweep timestamp without waiting for the first tick to fire).
  currentCleanupIntervalMs = ms;
  nextSweepAt = new Date(Date.now() + ms);
  cleanupTimer = setInterval(runScheduledCleanupTick, ms);
}

// Task #791 — audit action stamped once per non-empty cleanup batch so the
// sweep is auditable/visible to admins (parity with the community-participant
// cleanup sweep, which writes COMMUNITY_PARTICIPANT_CLEANUP_AUDIT_ACTION).
export const WALLET_CONNECT_ALERT_MARKER_CLEANUP_AUDIT_ACTION =
  "wallet_connect_alert_marker_cleanup";

export interface WalletConnectAlertCleanupResult {
  deleted: number;
  scanned: number;
  skipped: boolean;
}

export interface WalletConnectAlertMarkerCountResult {
  scanned: number;
  orphaned: number;
}

export interface WalletConnectCompletionBackfillCountResult {
  /** Number of fired markers scanned. */
  scanned: number;
  /** Number of those markers that currently lack a wallet_connect_completed audit row. */
  missing: number;
}

// Task #824 — single source of truth for the marker scan/diff. Both the
// read-only count helper and the destructive cleanup sweep run the exact same
// "fetch all fired/mute markers, resolve which owning cases still exist, diff to
// find orphans" logic. Keeping it in one place means a future change (e.g. a new
// marker key prefix, or a tweak to orphan detection) can never make the count an
// admin sees disagree with what the sweep actually deletes. Read-only: it never
// mutates — the caller (cleanup) performs the delete using the returned
// `orphanKeys`.
interface WalletConnectAlertMarkerScan {
  /** Every fired/mute marker row found (used for `scanned` and audit sampling). */
  markerRows: { key: string }[];
  /** Marker keys whose owning case no longer exists in `cases`. */
  orphanKeys: string[];
  /** Total number of fired/mute markers scanned. */
  scanned: number;
}

async function scanWalletConnectAlertMarkers(
  exec: import("../db").DbExecutor,
): Promise<WalletConnectAlertMarkerScan> {
  const { appSettings, cases } = await import("@shared/schema");
  const { like, or, inArray } = await import("drizzle-orm");

  const markerRows = await exec
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(
      or(
        like(appSettings.key, `${WALLET_CONNECT_ALERT_FIRED_KEY_PREFIX}%`),
        like(appSettings.key, `${WALLET_CONNECT_ALERT_MUTE_KEY_PREFIX}%`),
      ),
    );

  const scanned = markerRows.length;
  if (scanned === 0) {
    return { markerRows, orphanKeys: [], scanned: 0 };
  }

  const candidateCaseIds = Array.from(
    new Set(
      markerRows
        .map((r) => caseIdFromMarkerKey(r.key))
        .filter((id) => id.trim().length > 0),
    ),
  );

  const existingRows = candidateCaseIds.length
    ? await exec
        .select({ id: cases.id })
        .from(cases)
        .where(inArray(cases.id, candidateCaseIds))
    : [];
  const existing = new Set(existingRows.map((r) => r.id));

  const orphanKeys = markerRows
    .map((r) => r.key)
    .filter((key) => {
      const caseId = caseIdFromMarkerKey(key);
      return caseId.trim().length > 0 && !existing.has(caseId);
    });

  return { markerRows, orphanKeys, scanned };
}

/**
 * Read-only count of fired/mute markers and how many of them are currently
 * orphaned (their owning case no longer exists in `cases`). Mutates nothing —
 * it runs the exact same scan/diff as the cleanup sweep (via the shared
 * `scanWalletConnectAlertMarkers`) but stops before the delete, so an admin can
 * see whether a cleanup is even needed and confirm the post-sweep state.
 * Swallows DB errors (returns zeros) so a transient failure can't crash the
 * caller.
 */
export async function countOrphanedWalletConnectAlertMarkers(
  options: { executor?: import("../db").DbExecutor } = {},
): Promise<WalletConnectAlertMarkerCountResult> {
  try {
    const { db } = await import("../db");
    const exec = options.executor ?? db;
    const { scanned, orphanKeys } = await scanWalletConnectAlertMarkers(exec);
    return { scanned, orphaned: orphanKeys.length };
  } catch (err) {
    console.error(
      "Error counting orphaned wallet-connect alert markers:",
      err,
    );
    return { scanned: 0, orphaned: 0 };
  }
}

/**
 * Read-only count of fired markers that currently lack a
 * `wallet_connect_completed` audit row — i.e. the rows a backfill would
 * insert if it ran right now. Mutates nothing. Swallows DB errors (returns
 * zeros) so a transient failure cannot crash the caller.
 */
export async function countMissingWalletConnectCompletions(
  options: { executor?: import("../db").DbExecutor } = {},
): Promise<WalletConnectCompletionBackfillCountResult> {
  try {
    const markers = await listFiredWalletConnectAlertMarkers();
    const scanned = markers.length;
    if (scanned === 0) {
      return { scanned: 0, missing: 0 };
    }
    const { db } = await import("../db");
    const exec = options.executor ?? db;
    const { auditLogs } = await import("@shared/schema");
    const { and, eq, inArray } = await import("drizzle-orm");
    const markerCaseIds = markers.map((m) => m.caseId);
    const existingRows = await exec
      .select({ targetId: auditLogs.targetId })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "wallet_connect_completed"),
          inArray(auditLogs.targetId, markerCaseIds),
        ),
      );
    const completed = new Set(
      existingRows
        .map((r) => r.targetId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    const missing = markers.filter((m) => !completed.has(m.caseId)).length;
    return { scanned, missing };
  } catch (err) {
    console.error("Error counting missing wallet-connect completions:", err);
    return { scanned: 0, missing: 0 };
  }
}

/**
 * Test-only helper: clears the re-entrancy guard so each test starts fresh.
 */
export function __resetWalletConnectAlertCleanupGuardForTests(): void {
  cleanupInFlight = false;
}

/**
 * Periodic sweep — delete every fired/mute marker whose caseId is no longer
 * present in the `cases` table. Never removes a marker for a still-existing
 * case. Swallows DB errors (returns deleted=0) so a transient failure can't
 * crash the scheduler; the next tick simply retries.
 */
export async function cleanupOrphanedWalletConnectAlertMarkers(
  options: {
    triggeredBy?: string | null;
    executor?: import("../db").DbExecutor;
  } = {},
): Promise<WalletConnectAlertCleanupResult> {
  if (cleanupInFlight) {
    return { deleted: 0, scanned: 0, skipped: true };
  }
  cleanupInFlight = true;
  try {
    const { db } = await import("../db");
    const exec = options.executor ?? db;
    const { appSettings } = await import("@shared/schema");
    const { inArray } = await import("drizzle-orm");

    // Task #824 — same scan/diff the read-only count uses, so the number an
    // admin sees can never disagree with what this sweep actually deletes.
    const { orphanKeys, scanned } = await scanWalletConnectAlertMarkers(exec);

    if (scanned === 0) {
      return { deleted: 0, scanned: 0, skipped: false };
    }

    if (orphanKeys.length === 0) {
      return { deleted: 0, scanned, skipped: false };
    }

    const removed = await exec
      .delete(appSettings)
      .where(inArray(appSettings.key, orphanKeys))
      .returning({ key: appSettings.key });

    for (const key of orphanKeys) {
      firedCaseIdsThisProcess.delete(caseIdFromMarkerKey(key));
    }

    if (removed.length > 0) {
      // Task #791 — stamp an audit row per non-empty batch so the sweep is
      // visible/auditable to admins (parity with the community-participant
      // cleanup). Cap the case_id sample so a large prune doesn't write a
      // multi-megabyte newValue; the `removed` count stays authoritative.
      const removedCaseIds = Array.from(
        new Set(
          removed
            .map((r) => caseIdFromMarkerKey(r.key))
            .filter((id) => id.trim().length > 0),
        ),
      );
      const sample = removedCaseIds.slice(0, 50);
      const auditPayload = {
        adminUsername: options.triggeredBy ?? "system",
        action: WALLET_CONNECT_ALERT_MARKER_CLEANUP_AUDIT_ACTION,
        targetType: "app_settings",
        targetId: null,
        previousValue: null,
        newValue: JSON.stringify({
          removed: removed.length,
          scanned,
          sampleCaseIds: sample,
          sampleTruncated: removedCaseIds.length > sample.length,
        }),
        ipAddress: null,
        userAgent: null,
      } as const;
      // When the caller passed a transaction executor we MUST write the audit
      // row through it too — otherwise an audit failure (or a wrapping-tx
      // rollback) would leave the audit row committed while the deletion rolls
      // back. Re-throw in that case so the outer transaction unwinds both.
      // The background sweep (no executor) keeps the best-effort behavior so a
      // transient audit failure doesn't crash the hourly timer.
      if (options.executor) {
        await storage.createAuditLog(auditPayload, options.executor);
      } else {
        try {
          await storage.createAuditLog(auditPayload);
        } catch (auditErr) {
          console.error(
            "Failed to write wallet-connect alert marker cleanup audit log:",
            auditErr,
          );
        }
      }
      cleanupLog(
        `Pruned ${removed.length} orphaned wallet-connect alert marker(s) for deleted case(s)`,
      );
    }

    return { deleted: removed.length, scanned, skipped: false };
  } catch (err) {
    console.error(
      "Error during wallet-connect alert marker cleanup sweep:",
      err,
    );
    return { deleted: 0, scanned: 0, skipped: false };
  } finally {
    cleanupInFlight = false;
  }
}

/**
 * Kick off the marker cleanup sweep: once at boot, then on the configured
 * cadence (env override > app_settings > hourly default, clamped to safe
 * bounds). The cadence is resolved asynchronously so a transient DB read can't
 * block boot; the timer is armed once the value is known.
 */
export function startWalletConnectAlertMarkerCleanupSweep(): void {
  // Task #832 — stamp the boot kick-off sweep so the admin card shows a "last
  // swept" time immediately, before the first interval tick fires.
  lastSweepAt = new Date();
  void cleanupOrphanedWalletConnectAlertMarkers();
  void loadCleanupIntervalMs().then(({ ms, source }) => {
    scheduleCleanupSweep(ms);
    cleanupLog(
      `Wallet-connect alert marker cleanup sweep started (every ${describeInterval(ms)}${
        source === "default" ? "" : `, ${source} override`
      })`,
    );
  });
}

// ── Task #826 — durable completion backfill ───────────────────────────────────
// After Task #676 the `wallet_connect_completed` audit row is best-effort: when
// its write fails the durable `wallet_connect_alert_fired:<caseId>` marker still
// records that the alert fired, and both the per-case Activity Timeline and the
// global admin audit-log view reconstruct the missing completion at read time
// (synthesizeMissingWalletConnectCompletions). That read-time reconciliation runs
// on every read forever and never persists a real row. This backfill closes the
// gap durably: for every fired marker that has no `wallet_connect_completed`
// audit row, it writes ONE real audit row, stamped at the marker's own timestamp
// so it sorts into the trail where the completion actually happened. It is
// idempotent — it diffs the markers against the existing completion rows and only
// inserts the ones that are genuinely missing, so re-running it is a no-op. After
// it runs the read-time reconciliation becomes a safety net (covering gaps created
// after the sweep, until the next backfill) rather than the source of truth.

let completionBackfillInFlight = false;

/**
 * Test-only helper: clears the backfill re-entrancy guard so each test starts
 * from a clean process state. Not used by production code.
 */
export function __resetWalletConnectCompletionBackfillGuardForTests(): void {
  completionBackfillInFlight = false;
}

export interface WalletConnectCompletionBackfillResult {
  /** Number of fired markers scanned. */
  scanned: number;
  /** Number of durable `wallet_connect_completed` audit rows written. */
  inserted: number;
  /** True when a concurrent backfill was already running and this call was a no-op. */
  skipped: boolean;
}

/**
 * Durably persist a `wallet_connect_completed` audit row for every fired marker
 * that is missing one. Idempotent: it first reads which marker case ids already
 * have a completion row and inserts only the rest. Each inserted row carries the
 * case's selected wallet exchange as `walletName` (the marker itself has none)
 * and is stamped with the marker's `updatedAt` so it lands in the trail at the
 * original completion time. Best-effort: a top-level failure returns zeros and a
 * per-row insert failure is logged and skipped, so the next run simply retries.
 */
export async function backfillMissingWalletConnectCompletions(
  options: { executor?: import("../db").DbExecutor } = {},
): Promise<WalletConnectCompletionBackfillResult> {
  if (completionBackfillInFlight) {
    return { scanned: 0, inserted: 0, skipped: true };
  }
  completionBackfillInFlight = true;
  try {
    const markers = await listFiredWalletConnectAlertMarkers();
    const scanned = markers.length;
    if (scanned === 0) {
      return { scanned: 0, inserted: 0, skipped: false };
    }

    const { db } = await import("../db");
    const exec = options.executor ?? db;
    const { auditLogs } = await import("@shared/schema");
    const { and, eq, inArray } = await import("drizzle-orm");

    const markerCaseIds = markers.map((m) => m.caseId);
    const existingRows = await exec
      .select({ targetId: auditLogs.targetId })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "wallet_connect_completed"),
          inArray(auditLogs.targetId, markerCaseIds),
        ),
      );
    const completed = new Set(
      existingRows
        .map((r) => r.targetId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );

    const missing = markers.filter((m) => !completed.has(m.caseId));
    if (missing.length === 0) {
      return { scanned, inserted: 0, skipped: false };
    }

    let inserted = 0;
    for (const marker of missing) {
      let walletName: string | null = null;
      try {
        const caseData = await storage.getCaseById(marker.caseId);
        walletName = caseData?.walletExchangeName ?? null;
      } catch {
        walletName = null;
      }
      try {
        await exec.insert(auditLogs).values({
          adminUsername: "system",
          action: "wallet_connect_completed",
          targetType: "case",
          targetId: marker.caseId,
          newValue: JSON.stringify({ walletName }).slice(0, 4000),
          // Preserve the original completion time recorded by the marker so the
          // backfilled row sorts into the trail where it actually happened,
          // not at backfill time. Fall back to now() only if the marker has no
          // timestamp (it always should — app_settings stamps updatedAt).
          createdAt: marker.updatedAt ?? new Date(),
        });
        inserted += 1;
      } catch (err) {
        console.error(
          `[walletConnectAlert] completion backfill insert failed for case ${marker.caseId}:`,
          err,
        );
      }
    }

    if (inserted > 0) {
      cleanupLog(
        `Backfilled ${inserted} durable wallet_connect_completed audit row(s) from fired marker(s)`,
      );
    }

    return { scanned, inserted, skipped: false };
  } catch (err) {
    console.error("Error during wallet-connect completion backfill:", err);
    return { scanned: 0, inserted: 0, skipped: false };
  } finally {
    completionBackfillInFlight = false;
  }
}

/**
 * Kick off the one-time durable completion backfill at boot. Fire-and-forget so
 * a transient DB issue can't block startup; the read-time reconciliation keeps
 * surfaces complete in the meantime and the next boot retries.
 */
export function startWalletConnectCompletionBackfill(): void {
  void backfillMissingWalletConnectCompletions();
}

async function resolveAdminAlertRecipients(): Promise<string[]> {
  const fromEnv = process.env.ADMIN_ALERT_EMAIL?.trim();
  if (fromEnv) return parseAdminAlertRecipients(fromEnv);
  try {
    const row = await storage.getAppSetting(ADMIN_ALERT_EMAIL_SETTING_KEY);
    return parseAdminAlertRecipients(row?.value);
  } catch {
    return [];
  }
}

function getAdminDashboardUrl(): string {
  return getPublicAdminUrl();
}

/**
 * Check whether the alert has already fired for this case.
 *
 * Task #676 — the durable, cross-instance idempotency stamp is the
 * `wallet_connect_alert_fired:<caseId>` row in app_settings. We check it first.
 * For backward compatibility with cases that fired BEFORE this marker existed
 * (whose only stamp is the legacy `wallet_connect_completed` audit row), we
 * also fall back to the audit-row query. Either signal means "already fired".
 */
async function hasAlreadyFired(caseId: string): Promise<boolean> {
  try {
    const row = await storage.getAppSetting(walletConnectAlertFiredKey(caseId));
    if (row?.value === "true") return true;
  } catch {
    // Fall through to the legacy audit-row check below.
  }
  try {
    const { db } = await import("../db");
    const { auditLogs } = await import("@shared/schema");
    const { and, eq } = await import("drizzle-orm");
    const rows = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "wallet_connect_completed"),
          eq(auditLogs.targetId, caseId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Called from the fire-and-forget block in GET /api/cases/:id/wallet-phrase.
 * Never throws — a problem here must not affect the portal response.
 *
 * On first call per case (when not muted):
 *   1. Emits a `wallet_connect_completed` audit row.
 *   2. Sends an admin alert email to the configured recipient(s).
 * Subsequent calls are silently skipped.
 * When the per-case mute is active (Task #492), the SMTP send and audit
 * stamp are both skipped — the muted case produces no noise.
 */
export async function maybeAlertOnWalletConnect(params: {
  caseId: string;
  walletName: string | null;
}): Promise<void> {
  try {
    if (await hasAlreadyFired(params.caseId)) {
      return;
    }

    // Task #559 — in-memory short-circuit. If this case already fired in the
    // current process, skip even when the durable audit row never persisted
    // (e.g. a prior audit write threw). This stops the admin email re-firing
    // on every reveal within this instance's lifetime.
    if (firedCaseIdsThisProcess.has(params.caseId)) {
      return;
    }

    // Task #492 — per-case mute check. When muted, skip both the audit
    // stamp and the SMTP send entirely so no noise is produced for this
    // case. The mute state itself is managed by the admin and persists in
    // app_settings across restarts.
    if (await isWalletConnectAlertMuted(params.caseId)) {
      return;
    }

    // Task #559 — mark the case as fired in-memory BEFORE attempting any
    // durable write. This short-circuits re-reveals within this same process
    // even if the durable marker write below throws.
    firedCaseIdsThisProcess.add(params.caseId);

    // Task #676 — write the durable, cross-instance idempotency marker FIRST,
    // before any email is dispatched. storage.setAppSetting is an idempotent
    // single-statement upsert keyed on `wallet_connect_alert_fired:<caseId>`,
    // so it is safe under concurrent writers and survives restarts / spans
    // autoscale instances. If this write fails we MUST bail out rather than
    // continuing: sending an email without a durable stamp means a subsequent
    // reveal (after a restart or on another instance) would see hasAlreadyFired
    // === false and re-fire. Nothing durable persisted on failure, so the next
    // reveal simply retries the whole pipeline — the alert is never lost, only
    // deferred until a write succeeds.
    try {
      await storage.setAppSetting(
        walletConnectAlertFiredKey(params.caseId),
        "true",
        "system",
      );
    } catch (err) {
      console.error(
        "[walletConnectAlert] durable idempotency marker write failed — " +
          "aborting email dispatch; the next reveal will retry:",
        err,
      );
      return;
    }

    // Emit the audit row for the activity trail. Task #676 — this is now
    // best-effort: the durable marker above is the idempotency stamp, so even
    // if this write fails the alert stays idempotent (it won't re-fire across
    // restarts or instances) and the email can still be dispatched exactly once.
    try {
      await storage.createAuditLog({
        action: "wallet_connect_completed",
        newValue: JSON.stringify({
          walletName: params.walletName ?? null,
        }).slice(0, 4000),
        adminUsername: "system",
        targetType: "case",
        targetId: params.caseId,
      });
    } catch (err) {
      console.error(
        "[walletConnectAlert] audit log write failed — continuing because the " +
          "durable marker already persisted (idempotency is preserved):",
        err,
      );
    }

    // Locale-aware user notification email — best-effort, never blocks.
    // Task #740 — gate the SMTP send on a successful pre-send audit write.
    // sendCaseEmailWithAudit writes its outcome audit row AFTER the SMTP send,
    // so if that inner write fails there is no durable stamp and a future call
    // to sendCaseEmailWithAudit for this case could re-fire the email. Closing
    // the gap: write email_wallet_phrase_user_notification_queued FIRST; only
    // proceed with the SMTP send when that write succeeds. If it fails we bail
    // here — the outer wallet_connect_alert_fired marker is already set, so the
    // next reveal retries the full pipeline rather than silently re-firing or
    // permanently dropping the notification.
    try {
      const caseData = await storage.getCaseById(params.caseId);
      if (caseData?.userEmail) {
        let preSendAuditOk = false;
        try {
          await storage.createAuditLog({
            action: "email_wallet_phrase_user_notification_queued",
            newValue: `User wallet notification queued for case ${params.caseId}`,
            adminUsername: "system",
            targetType: "case",
            targetId: params.caseId,
          });
          preSendAuditOk = true;
        } catch (auditErr) {
          console.error(
            "[walletConnectAlert] user notification pre-send audit write failed — " +
              "skipping SMTP send; the next reveal will retry:",
            auditErr,
          );
        }
        if (preSendAuditOk) {
          await sendCaseEmailWithAudit({
            to: caseData.userEmail,
            caseId: params.caseId,
            tag: "wallet_phrase_user_notification",
            send: (locale) =>
              emailService.sendWalletPhraseRevealedNotification({
                to: caseData.userEmail!,
                userName: caseData.userName ?? "",
                caseRef: params.caseId,
                locale,
              }),
          });
        }
      }
    } catch (err) {
      console.error("[walletConnectAlert] user email dispatch error:", err);
    }

    const recipients = await resolveAdminAlertRecipients();
    if (recipients.length === 0) return;

    // Resolve the case's preferred locale so the admin alert renders in the
    // same language as the case owner (mirrors the sendCaseEmailWithAudit
    // pattern used for every other transactional case email).
    const locale = await resolveRecipientLocale(params.caseId);

    // Gate the SMTP send on a successful pre-send audit write — mirrors the
    // user-notification fix. Write email_wallet_connect_alert_queued FIRST;
    // only proceed with the SMTP send when that write succeeds. If it fails we
    // bail here — the outer wallet_connect_alert_fired marker is already set, so
    // the next reveal retries the full pipeline rather than silently re-firing
    // or permanently dropping the notification.
    let adminPreSendAuditOk = false;
    try {
      await storage.createAuditLog({
        action: "email_wallet_connect_alert_queued",
        newValue: `Admin alert queued to ${recipients.join(", ")} for wallet connection on case ${params.caseId}`,
        adminUsername: "system",
        targetType: "case",
        targetId: params.caseId,
      });
      adminPreSendAuditOk = true;
    } catch (auditErr) {
      console.error(
        "[walletConnectAlert] admin alert pre-send audit write failed — " +
          "skipping SMTP send; the next reveal will retry:",
        auditErr,
      );
    }

    if (!adminPreSendAuditOk) return;

    let sendError: string | null = null;
    try {
      const result = await emailService.sendWalletConnectAlert({
        to: recipients,
        caseId: params.caseId,
        walletName: params.walletName,
        dashboardUrl: getAdminDashboardUrl(),
        locale,
      });
      if (result && (result as { success?: boolean }).success === false) {
        sendError = (result as { error?: string }).error ?? "unknown SMTP error";
        console.error("[walletConnectAlert] SMTP send failed:", sendError);
      }
    } catch (e) {
      sendError = e instanceof Error ? e.message : "unexpected SMTP error";
      console.error("[walletConnectAlert] SMTP send threw:", e);
    }

    try {
      await storage.createAuditLog({
        action: sendError
          ? "email_wallet_connect_alert_failed"
          : "email_wallet_connect_alert",
        newValue: sendError
          ? `Admin alert FAILED to ${recipients.join(", ")} for wallet connection on case ${params.caseId}: ${sendError}`
          : `Admin alert sent to ${recipients.join(", ")} for wallet connection on case ${params.caseId}`,
        adminUsername: "system",
        targetType: "case",
        targetId: params.caseId,
      });
    } catch {
      /* best-effort */
    }
  } catch (err) {
    console.error("[walletConnectAlert] dispatcher crashed:", err);
  }
}
