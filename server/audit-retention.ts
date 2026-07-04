import { storage } from "./storage";

// Lightweight log helper that mirrors the format used by server/index.ts's
// `log()` without importing it (circular: index.ts imports this module).
function log(message: string): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [express] ${message}`);
}

// Key used in the app_settings table for the audit-log retention window.
export const AUDIT_LOG_RETENTION_SETTING_KEY = "audit_log_retention_days";

// Hard-coded default + sane bounds. The bounds keep an admin from
// either disabling retention entirely (foot-gun) or storing absurdly
// long windows that would defeat the point of the sweep. Match these
// values in the dashboard input so the UI rejects bad values up front.
export const AUDIT_LOG_RETENTION_DEFAULT_DAYS = 90;
export const AUDIT_LOG_RETENTION_MIN_DAYS = 1;
export const AUDIT_LOG_RETENTION_MAX_DAYS = 3650; // ~10 years

const AUDIT_LOG_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

// Read the env-var override the same way server/index.ts used to. Treats
// non-finite or non-positive values as "unset" so callers fall through to
// the DB-stored value (and ultimately the default). A value of 0 is
// rejected as a foot-gun, matching the original behavior.
function readEnvRetentionOverride(): number | null {
  const raw = Number.parseFloat(process.env.AUDIT_LOG_RETENTION_DAYS ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

function clampRetention(days: number): number {
  if (!Number.isFinite(days) || days <= 0) {
    return AUDIT_LOG_RETENTION_DEFAULT_DAYS;
  }
  return Math.min(
    Math.max(days, AUDIT_LOG_RETENTION_MIN_DAYS),
    AUDIT_LOG_RETENTION_MAX_DAYS,
  );
}

// Cached effective retention used by the periodic sweep so it doesn't
// have to round-trip the DB every tick. Refreshed at startup, after a
// save, and (defensively) at the top of every sweep.
let cachedRetentionDays: number = AUDIT_LOG_RETENTION_DEFAULT_DAYS;
// Track which "source" the cached value came from so the API can tell
// the dashboard whether the env var is currently overriding the
// admin-editable value.
let cachedSource: "env" | "db" | "default" = "default";

async function loadRetentionDaysFromStore(): Promise<{ days: number; source: "env" | "db" | "default" }> {
  const envOverride = readEnvRetentionOverride();
  if (envOverride !== null) {
    return { days: clampRetention(envOverride), source: "env" };
  }
  try {
    const row = await storage.getAppSetting(AUDIT_LOG_RETENTION_SETTING_KEY);
    if (row) {
      const parsed = Number.parseFloat(row.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return { days: clampRetention(parsed), source: "db" };
      }
    }
  } catch (err) {
    console.error("Failed to read audit-log retention setting from DB:", err);
  }
  return { days: AUDIT_LOG_RETENTION_DEFAULT_DAYS, source: "default" };
}

async function refreshRetentionCache(): Promise<void> {
  const { days, source } = await loadRetentionDaysFromStore();
  cachedRetentionDays = days;
  cachedSource = source;
}

export function getCachedAuditLogRetentionDays(): number {
  return cachedRetentionDays;
}

export interface AuditLogRetentionSetting {
  days: number;
  source: "env" | "db" | "default";
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: Date | null;
  updatedBy: string | null;
}

// Read the current setting in the shape the admin dashboard wants. We
// always return the live, refreshed value (not the cached one) so a save
// on a different process is reflected immediately.
export async function readAuditLogRetentionSetting(): Promise<AuditLogRetentionSetting> {
  const { days, source } = await loadRetentionDaysFromStore();
  cachedRetentionDays = days;
  cachedSource = source;
  let updatedAt: Date | null = null;
  let updatedBy: string | null = null;
  try {
    const row = await storage.getAppSetting(AUDIT_LOG_RETENTION_SETTING_KEY);
    if (row) {
      updatedAt = row.updatedAt ?? null;
      updatedBy = row.updatedBy ?? null;
    }
  } catch (err) {
    console.error("Failed to read audit-log retention metadata:", err);
  }
  return {
    days,
    source,
    envOverride: source === "env",
    min: AUDIT_LOG_RETENTION_MIN_DAYS,
    max: AUDIT_LOG_RETENTION_MAX_DAYS,
    default: AUDIT_LOG_RETENTION_DEFAULT_DAYS,
    updatedAt,
    updatedBy,
  };
}

// Persist a new retention window. Refuses values outside the supported
// range so the DB can never end up storing "0" (delete everything) or a
// silly number of days that the sweep would treat as "keep nothing"
// after rounding. Returns the value actually applied.
export async function saveAuditLogRetentionDays(
  rawDays: number,
  updatedBy?: string | null,
  executor?: import("./db").DbExecutor,
): Promise<number> {
  if (!Number.isFinite(rawDays)) {
    throw new Error("Retention must be a finite number of days");
  }
  if (rawDays < AUDIT_LOG_RETENTION_MIN_DAYS || rawDays > AUDIT_LOG_RETENTION_MAX_DAYS) {
    throw new Error(
      `Retention must be between ${AUDIT_LOG_RETENTION_MIN_DAYS} and ${AUDIT_LOG_RETENTION_MAX_DAYS} days`,
    );
  }
  const days = clampRetention(rawDays);
  await storage.setAppSetting(
    AUDIT_LOG_RETENTION_SETTING_KEY,
    String(days),
    updatedBy ?? null,
    executor,
  );
  // If the env var override is set we keep using it for the actual sweep
  // value, but we still persist the admin's choice so removing the
  // override later picks it up. When called inside a transaction, the
  // route handler refreshes the cache after the commit succeeds — see
  // refreshAuditLogRetentionCache below.
  if (!executor) {
    await refreshRetentionCache();
  }
  return executor ? days : cachedRetentionDays;
}

/** Post-commit cache refresh helper for callers that wrote inside a tx. */
export async function refreshAuditLogRetentionCache(): Promise<void> {
  await refreshRetentionCache();
}

// Re-entrancy guard: a large first-run prune can in principle take longer
// than the sweep interval. Skipping the next tick instead of letting two
// sweeps overlap avoids extra DB contention and double-counted log lines.
let auditSweepInFlight = false;

export async function runAuditLogSweep(): Promise<number> {
  if (auditSweepInFlight) return 0;
  auditSweepInFlight = true;
  try {
    // Refresh the cache at the top of every sweep so a value saved
    // after the last refresh (e.g. via the admin dashboard on another
    // process) is picked up within at most one cycle.
    await refreshRetentionCache();
    const days = cachedRetentionDays;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const removed = await storage.pruneAuditLogsOlderThan(cutoff);
    if (removed > 0) {
      log(`Pruned ${removed} audit log row(s) older than ${days} day(s)`);
    }
    return removed;
  } catch (err) {
    console.error("Error pruning old audit log rows:", err);
    return 0;
  } finally {
    auditSweepInFlight = false;
  }
}

export async function startAuditLogRetentionSweep(): Promise<void> {
  await refreshRetentionCache();
  void runAuditLogSweep();
  setInterval(() => {
    void runAuditLogSweep();
  }, AUDIT_LOG_SWEEP_INTERVAL_MS);
  log(
    `Audit log retention sweep started (every hour, keeping ${cachedRetentionDays} day(s)${cachedSource === "env" ? ", env override" : ""})`,
  );
}
