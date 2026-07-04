import { storage } from "./storage";

// Task #126 — periodic prune of community_participants rows whose owning
// case has been sealed, completed, or otherwise dormant past the
// retention window. Mirrors the structure of audit-retention.ts /
// document-archive.ts: env > app_settings > hard-coded default, hourly
// cadence, re-entrancy guard, audit row per non-empty batch.
//
// Why this exists: getOrCreateParticipantForSession inserts one row the
// first time a portal user posts in the forum and never removes it,
// even after the case is deleted, sealed, or completed. Over time that
// inflates community_participants and leaks anonymous handles tied to
// long-finished cases. The DB-level FK ON DELETE CASCADE (migration
// 0013) handles the synchronous "case row is deleted" path; this sweep
// handles the softer "case is sealed/completed and has been idle for N
// days" path, where the case itself stays for compliance reasons but
// the community footprint should drop off.

function log(message: string): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [express] ${message}`);
}

export const COMMUNITY_PARTICIPANT_RETENTION_SETTING_KEY =
  "community_participant_retention_days";

// Keep a sealed/completed case's community handle for this long after
// the case last changed before pruning. 90 days lines up with the
// audit-log default and gives operators a comfortable window to
// investigate any post-resolution community activity before the row
// disappears.
export const COMMUNITY_PARTICIPANT_RETENTION_DEFAULT_DAYS = 90;
// Lower bound — anything under 1 day would prune the moment a case is
// sealed, which is too aggressive for ops review.
export const COMMUNITY_PARTICIPANT_RETENTION_MIN_DAYS = 1;
// Upper bound — beyond ~10 years the sweep stops being meaningful.
export const COMMUNITY_PARTICIPANT_RETENTION_MAX_DAYS = 3650;

const COMMUNITY_PARTICIPANT_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

export const COMMUNITY_PARTICIPANT_CLEANUP_AUDIT_ACTION =
  "community_participant_cleanup";

function readEnvRetentionOverride(): number | null {
  const raw = Number.parseFloat(
    process.env.COMMUNITY_PARTICIPANT_RETENTION_DAYS ?? "",
  );
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

function clampRetention(days: number): number {
  if (!Number.isFinite(days) || days <= 0) {
    return COMMUNITY_PARTICIPANT_RETENTION_DEFAULT_DAYS;
  }
  return Math.min(
    Math.max(days, COMMUNITY_PARTICIPANT_RETENTION_MIN_DAYS),
    COMMUNITY_PARTICIPANT_RETENTION_MAX_DAYS,
  );
}

// Cached effective retention so the sweep doesn't have to round-trip
// the DB on every tick. Refreshed on save and at the top of every sweep.
let cachedRetentionDays: number = COMMUNITY_PARTICIPANT_RETENTION_DEFAULT_DAYS;

async function loadRetentionDaysFromStore(): Promise<{
  days: number;
  source: "env" | "db" | "default";
}> {
  const envOverride = readEnvRetentionOverride();
  if (envOverride !== null) {
    return { days: clampRetention(envOverride), source: "env" };
  }
  try {
    const row = await storage.getAppSetting(
      COMMUNITY_PARTICIPANT_RETENTION_SETTING_KEY,
    );
    if (row) {
      const parsed = Number.parseFloat(row.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return { days: clampRetention(parsed), source: "db" };
      }
    }
  } catch (err) {
    console.error(
      "Failed to read community-participant retention setting:",
      err,
    );
  }
  return { days: COMMUNITY_PARTICIPANT_RETENTION_DEFAULT_DAYS, source: "default" };
}

async function refreshRetentionCache(): Promise<void> {
  const { days } = await loadRetentionDaysFromStore();
  cachedRetentionDays = days;
}

export function getCachedCommunityParticipantRetentionDays(): number {
  return cachedRetentionDays;
}

export interface CommunityParticipantRetentionSetting {
  days: number;
  source: "env" | "db" | "default";
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: Date | null;
  updatedBy: string | null;
  // Task #130 — live count of community_participants rows that the next
  // sweep would remove at the *currently effective* retention window.
  // Lets admins gauge the impact of a window change before they save.
  // `eligibleAsOf` is the cutoff timestamp the count was computed at so
  // the UI can disclose the exact reference point.
  // `eligibleCount` is null when the count query failed — the UI should
  // surface "unavailable" rather than misleadingly rendering 0.
  eligibleCount: number | null;
  eligibleAsOf: string;
  // Same count, but evaluated against the cutoff implied by a hypothetical
  // retention window. Populated only when readCommunityParticipantRetentionSetting
  // is asked to preview a draft value (see `previewDays`). Null when the
  // caller didn't request a preview.
  // Null when no preview was requested OR when the preview query failed.
  // `previewDays` disambiguates: non-null `previewDays` + null
  // `previewEligibleCount` => preview requested but unavailable.
  previewEligibleCount: number | null;
  previewDays: number | null;
}

// Compute "how many rows would the sweep remove at this many days" without
// touching the persisted setting. Used by both the standard GET (with the
// effective window) and the preview endpoint (with an admin-supplied draft).
async function countEligibleParticipants(
  days: number,
): Promise<{ count: number | null; cutoff: Date }> {
  const clamped = clampRetention(days);
  const cutoff = new Date(Date.now() - clamped * 24 * 60 * 60 * 1000);
  try {
    const count = await storage.countCommunityParticipantsForInactiveCases(
      cutoff,
    );
    return { count, cutoff };
  } catch (err) {
    // Surface the failure to the caller as a null count so the UI can
    // render "unavailable" instead of misleadingly showing 0 (which an
    // admin could read as "nothing to clean up").
    console.error(
      "Failed to count community participants eligible for cleanup:",
      err,
    );
    return { count: null, cutoff };
  }
}

export async function previewCommunityParticipantCleanupCount(
  days: number,
): Promise<{ count: number | null; retentionDays: number; cutoff: string }> {
  const clamped = clampRetention(days);
  const { count, cutoff } = await countEligibleParticipants(clamped);
  return { count, retentionDays: clamped, cutoff: cutoff.toISOString() };
}

// Read the current setting in the shape the admin dashboard wants. We
// always return the live, refreshed value (not the cached one) so a save
// on a different process is reflected immediately.
export async function readCommunityParticipantRetentionSetting(
  options: { previewDays?: number } = {},
): Promise<CommunityParticipantRetentionSetting> {
  const { days, source } = await loadRetentionDaysFromStore();
  cachedRetentionDays = days;
  let updatedAt: Date | null = null;
  let updatedBy: string | null = null;
  try {
    const row = await storage.getAppSetting(
      COMMUNITY_PARTICIPANT_RETENTION_SETTING_KEY,
    );
    if (row) {
      updatedAt = row.updatedAt ?? null;
      updatedBy = row.updatedBy ?? null;
    }
  } catch (err) {
    console.error(
      "Failed to read community-participant retention metadata:",
      err,
    );
  }
  const effective = await countEligibleParticipants(days);
  let previewEligibleCount: number | null = null;
  let previewDays: number | null = null;
  if (
    typeof options.previewDays === "number" &&
    Number.isFinite(options.previewDays)
  ) {
    const clamped = clampRetention(options.previewDays);
    previewDays = clamped;
    if (clamped === days) {
      // Same window as the effective value — no extra query needed.
      previewEligibleCount = effective.count;
    } else {
      const preview = await countEligibleParticipants(clamped);
      previewEligibleCount = preview.count;
    }
  }
  return {
    days,
    source,
    envOverride: source === "env",
    min: COMMUNITY_PARTICIPANT_RETENTION_MIN_DAYS,
    max: COMMUNITY_PARTICIPANT_RETENTION_MAX_DAYS,
    default: COMMUNITY_PARTICIPANT_RETENTION_DEFAULT_DAYS,
    updatedAt,
    updatedBy,
    eligibleCount: effective.count,
    eligibleAsOf: effective.cutoff.toISOString(),
    previewEligibleCount,
    previewDays,
  };
}

// Persist a new retention window. Refuses values outside the supported
// range so the DB can never end up storing "0" (delete everything) or a
// silly number of days. Returns the value actually applied.
export async function saveCommunityParticipantRetentionDays(
  rawDays: number,
  updatedBy?: string | null,
  executor?: import("./db").DbExecutor,
): Promise<number> {
  if (!Number.isFinite(rawDays)) {
    throw new Error("Retention must be a finite number of days");
  }
  if (
    rawDays < COMMUNITY_PARTICIPANT_RETENTION_MIN_DAYS ||
    rawDays > COMMUNITY_PARTICIPANT_RETENTION_MAX_DAYS
  ) {
    throw new Error(
      `Retention must be between ${COMMUNITY_PARTICIPANT_RETENTION_MIN_DAYS} and ${COMMUNITY_PARTICIPANT_RETENTION_MAX_DAYS} days`,
    );
  }
  const days = clampRetention(rawDays);
  await storage.setAppSetting(
    COMMUNITY_PARTICIPANT_RETENTION_SETTING_KEY,
    String(days),
    updatedBy ?? null,
    executor,
  );
  // Task #157 — when called inside a transaction the cache refresh
  // happens after the commit succeeds (see refreshCommunityParticipantRetentionCache).
  if (!executor) {
    await refreshRetentionCache();
  }
  return executor ? days : cachedRetentionDays;
}

/** Post-commit cache refresh helper for callers that wrote inside a tx. */
export async function refreshCommunityParticipantRetentionCache(): Promise<void> {
  await refreshRetentionCache();
}

async function loadRetentionDays(): Promise<number> {
  const { days } = await loadRetentionDaysFromStore();
  return days;
}

let sweepInFlight = false;

export interface CommunityParticipantCleanupResult {
  removed: number;
  retentionDays: number;
  cutoff: string;
  skipped: boolean;
}

export async function runCommunityParticipantCleanup(
  options: {
    triggeredBy?: string | null;
    executor?: import("./db").DbExecutor;
  } = {},
): Promise<CommunityParticipantCleanupResult> {
  if (sweepInFlight) {
    return {
      removed: 0,
      retentionDays: cachedRetentionDays,
      cutoff: new Date().toISOString(),
      skipped: true,
    };
  }
  sweepInFlight = true;
  try {
    const days = await loadRetentionDays();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { removed, caseIds } =
      await storage.pruneCommunityParticipantsForInactiveCases(
        cutoff,
        undefined,
        options.executor,
      );
    if (removed > 0) {
      // Cap the audit payload so a large first-run prune doesn't write a
      // multi-megabyte newValue. The full count is still authoritative;
      // the case_id list is a sample for traceability.
      const sample = caseIds.slice(0, 50);
      // When the caller passed a transaction executor we MUST write the
      // in-sweep audit row through it too — otherwise an audit failure
      // (or a wrapping-tx rollback) would still leave the audit row
      // committed on the base connection. Re-throw so the outer
      // transaction rolls back the deletion as well; the caller wraps
      // the whole sweep in a try/catch that converts this into a 500.
      if (options.executor) {
        await storage.createAuditLog(
          {
            adminUsername: options.triggeredBy ?? "system",
            action: COMMUNITY_PARTICIPANT_CLEANUP_AUDIT_ACTION,
            targetType: "community_participants",
            targetId: null,
            previousValue: null,
            newValue: JSON.stringify({
              removed,
              retentionDays: days,
              cutoff: cutoff.toISOString(),
              sampleCaseIds: sample,
              sampleTruncated: caseIds.length > sample.length,
            }),
            ipAddress: null,
            userAgent: null,
          },
          options.executor,
        );
      } else {
        try {
          await storage.createAuditLog({
            adminUsername: options.triggeredBy ?? "system",
            action: COMMUNITY_PARTICIPANT_CLEANUP_AUDIT_ACTION,
            targetType: "community_participants",
            targetId: null,
            previousValue: null,
            newValue: JSON.stringify({
              removed,
              retentionDays: days,
              cutoff: cutoff.toISOString(),
              sampleCaseIds: sample,
              sampleTruncated: caseIds.length > sample.length,
            }),
            ipAddress: null,
            userAgent: null,
          });
        } catch (err) {
          console.error(
            "Failed to write community-participant cleanup audit log:",
            err,
          );
        }
      }
      log(
        `Pruned ${removed} community participant row(s) for case(s) sealed/completed > ${days} day(s) ago`,
      );
    }
    return {
      removed,
      retentionDays: days,
      cutoff: cutoff.toISOString(),
      skipped: false,
    };
  } catch (err) {
    // When running inside a caller-supplied transaction, propagate the
    // error so the wrapping runInTransaction rolls back the deletion +
    // audit row together. The background sweep (no executor) keeps the
    // old swallow-and-log behavior so a transient failure doesn't kill
    // the hourly timer.
    if (options.executor) {
      throw err;
    }
    console.error("Error during community-participant cleanup sweep:", err);
    return {
      removed: 0,
      retentionDays: cachedRetentionDays,
      cutoff: new Date().toISOString(),
      skipped: false,
    };
  } finally {
    sweepInFlight = false;
  }
}

export function startCommunityParticipantCleanupSweep(): void {
  // Run once on boot so a restart after a long downtime catches up
  // immediately rather than waiting an hour for the first tick.
  void refreshRetentionCache().then(() => runCommunityParticipantCleanup());
  setInterval(() => {
    void runCommunityParticipantCleanup();
  }, COMMUNITY_PARTICIPANT_SWEEP_INTERVAL_MS);
  log(
    `Community participant cleanup sweep started (every hour, keeping ${COMMUNITY_PARTICIPANT_RETENTION_DEFAULT_DAYS} day(s) by default)`,
  );
}
