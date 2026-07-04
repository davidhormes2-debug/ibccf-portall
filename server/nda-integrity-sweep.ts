import { storage } from "./storage";
import { sha256Hex } from "./services/NdaService";
import { notificationService } from "./services/NotificationService";
import { emailService } from "./services/EmailService";
import { getPublicAdminUrl } from "./lib/publicBaseUrl";

// Resolution order for the admin alert recipient:
//   1. ADMIN_ALERT_EMAIL env var (operator-level override, baked into deploy).
//   2. app_settings.admin_alert_email (admin-editable without redeploy).
// Both sources support a comma-separated list so a distribution list can
// receive the alert. Returns an empty array when neither is set so the
// sweep silently no-ops rather than crashing — the in-dashboard
// notification + audit log still fire.
export const ADMIN_ALERT_EMAIL_SETTING_KEY = "admin_alert_email";

// Lightweight RFC-5322-ish check; the SMTP transport will do the
// authoritative validation. We just want to reject obviously bad input
// (whitespace, missing '@', double commas) at the API layer so the
// distribution list stays clean.
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export function parseAdminAlertRecipients(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function resolveAdminAlertRecipients(): Promise<string[]> {
  const fromEnv = process.env.ADMIN_ALERT_EMAIL?.trim();
  if (fromEnv) return parseAdminAlertRecipients(fromEnv);
  try {
    const row = await storage.getAppSetting(ADMIN_ALERT_EMAIL_SETTING_KEY);
    return parseAdminAlertRecipients(row?.value);
  } catch (err) {
    console.error(
      "[nda-integrity-sweep] failed to read admin_alert_email setting:",
      err,
    );
    return [];
  }
}

export interface AdminAlertEmailSetting {
  // Effective recipient list (env override wins over DB).
  recipients: string[];
  // Raw value that's actually in force right now — handy for the UI to
  // surface what the env var contains when an override is locking the
  // DB value.
  value: string;
  source: "env" | "db" | "default";
  envOverride: boolean;
  // The DB-stored value (or "" if unset). The UI edits this even when
  // an env override is locking the effective recipient list, so saved
  // values are preserved for when the override is removed.
  storedValue: string;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function readAdminAlertEmailSetting(): Promise<AdminAlertEmailSetting> {
  const envRaw = process.env.ADMIN_ALERT_EMAIL?.trim() ?? "";
  let storedValue = "";
  let updatedAt: Date | null = null;
  let updatedBy: string | null = null;
  try {
    const row = await storage.getAppSetting(ADMIN_ALERT_EMAIL_SETTING_KEY);
    if (row) {
      storedValue = (row.value ?? "").trim();
      updatedAt = row.updatedAt ?? null;
      updatedBy = row.updatedBy ?? null;
    }
  } catch (err) {
    console.error(
      "[nda-integrity-sweep] failed to read admin_alert_email metadata:",
      err,
    );
  }
  if (envRaw) {
    return {
      recipients: parseAdminAlertRecipients(envRaw),
      value: envRaw,
      source: "env",
      envOverride: true,
      storedValue,
      updatedAt,
      updatedBy,
    };
  }
  if (storedValue) {
    return {
      recipients: parseAdminAlertRecipients(storedValue),
      value: storedValue,
      source: "db",
      envOverride: false,
      storedValue,
      updatedAt,
      updatedBy,
    };
  }
  return {
    recipients: [],
    value: "",
    source: "default",
    envOverride: false,
    storedValue,
    updatedAt,
    updatedBy,
  };
}

export async function saveAdminAlertEmailRecipients(
  rawValue: string,
  updatedBy?: string | null,
  executor?: import("./db").DbExecutor,
): Promise<AdminAlertEmailSetting> {
  const trimmed = (rawValue ?? "").trim();
  // Empty value clears the override — the sweep then silently no-ops
  // (matching the prior behaviour when neither env nor DB was set).
  if (trimmed.length === 0) {
    await storage.setAppSetting(
      ADMIN_ALERT_EMAIL_SETTING_KEY,
      "",
      updatedBy ?? null,
      executor,
    );
    // Inside a transaction we can't read the row back through the main
    // db (the upsert isn't visible yet); synthesise the empty setting
    // shape and let the route handler re-read after commit if needed.
    if (executor) {
      return {
        recipients: [],
        value: "",
        source: "default",
        envOverride: false,
        storedValue: "",
        updatedAt: null,
        updatedBy: updatedBy ?? null,
      };
    }
    return readAdminAlertEmailSetting();
  }
  const recipients = parseAdminAlertRecipients(trimmed);
  if (recipients.length === 0) {
    throw new Error("Recipient list must contain at least one address");
  }
  for (const r of recipients) {
    if (!EMAIL_RE.test(r)) {
      throw new Error(`Invalid email address: ${r}`);
    }
  }
  // Re-serialise from the parsed list so we store a normalised "a, b, c"
  // value regardless of how the admin formatted their input.
  const normalised = recipients.join(", ");
  await storage.setAppSetting(
    ADMIN_ALERT_EMAIL_SETTING_KEY,
    normalised,
    updatedBy ?? null,
    executor,
  );
  if (executor) {
    return {
      recipients,
      value: normalised,
      source: "db",
      envOverride: false,
      storedValue: normalised,
      updatedAt: null,
      updatedBy: updatedBy ?? null,
    };
  }
  return readAdminAlertEmailSetting();
}

function getAdminDashboardUrl(): string {
  return getPublicAdminUrl();
}

function log(message: string): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [express] ${message}`);
}

// The sweep runs once on boot (catches tampering that happened while
// the app was down) and then on a recurring cadence. The cadence
// defaults to a daily rhythm — that balances early detection against
// the cost of re-hashing every sealed PDF — but admins can tighten it
// (e.g. to hourly) after a tampering incident or restore from backup
// without redeploying. The per-case verify endpoint remains for
// on-demand spot checks regardless of the cadence.
export const NDA_INTEGRITY_SWEEP_INTERVAL_SETTING_KEY =
  "nda_integrity_sweep_interval_hours";

export const NDA_INTEGRITY_SWEEP_INTERVAL_DEFAULT_HOURS = 24;
// Lower bound is 1 hour — anything below that risks the sweep
// overlapping itself on large datasets and adds little forensic value.
export const NDA_INTEGRITY_SWEEP_INTERVAL_MIN_HOURS = 1;
// Upper bound is 1 week — beyond that the sweep effectively stops
// being a control, and operators should use the per-case verify
// endpoint instead.
export const NDA_INTEGRITY_SWEEP_INTERVAL_MAX_HOURS = 24 * 7;

export const NDA_INTEGRITY_SWEEP_AUDIT_ACTION = "nda_integrity_sweep";

// "All clear" heartbeat email cadence. Default is `daily` so operators
// get one positive confirmation per day even when nothing changed —
// silence stops being ambiguous (sweep alive vs SMTP/cron broken).
// `every` is intended for tiny / low-volume deployments that want one
// summary per sweep; `off` opts out entirely for noisy deployments that
// would rather rely on the per-sweep audit row alone.
export const NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_SETTING_KEY =
  "nda_integrity_sweep_summary_frequency";
export const NDA_INTEGRITY_SWEEP_SUMMARY_LAST_SENT_AT_SETTING_KEY =
  "nda_integrity_sweep_summary_last_sent_at";

// Watchdog state for the "stale sweep" alarm. `last_success_at` is
// stamped at the end of every sweep that completed end-to-end (status
// === "ok"); the watchdog compares now vs that timestamp against
// `intervalHours + graceHours` to decide if the sweep has effectively
// stopped running (cron not firing, worker crashed, DB unreachable).
// `stale_alert_last_sent_at` throttles the out-of-band email so a
// long-running outage doesn't spam the ops distro every hour.
export const NDA_INTEGRITY_SWEEP_LAST_SUCCESS_AT_SETTING_KEY =
  "nda_integrity_sweep_last_success_at";
export const NDA_INTEGRITY_SWEEP_STALE_ALERT_LAST_SENT_AT_SETTING_KEY =
  "nda_integrity_sweep_stale_alert_last_sent_at";
// How long to wait past the configured interval before declaring the
// sweep "stale". Default 6h gives a daily sweep a generous safety
// margin (server reboots, scheduler drift) but still flags a missed
// 24h sweep within a single working day. Env-overrideable via
// NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS, and admin-tunable via
// app_settings.nda_integrity_sweep_stale_grace_hours (same env > DB >
// default precedence as the sweep interval itself).
export const NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_DEFAULT = 6;
export const NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_SETTING_KEY =
  "nda_integrity_sweep_stale_grace_hours";
// Lower bound is 0 — operators may want zero grace right after a
// tampering incident so any missed sweep alerts immediately.
export const NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MIN = 0;
// Upper bound is 1 week — beyond that the watchdog is no longer a
// useful control (it would silently absorb a multi-day outage).
export const NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MAX = 24 * 7;
// Cadence the watchdog itself runs at. Hourly is cheap (single
// app_settings read + clock compare) and gives a stale sweep at most
// ~1h of additional latency before the alert fires.
export const NDA_INTEGRITY_SWEEP_WATCHDOG_INTERVAL_MS = 60 * 60 * 1000;

export type NdaIntegritySweepSummaryFrequency =
  | "every"
  | "daily"
  | "weekly"
  | "off";

export const NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_VALUES: NdaIntegritySweepSummaryFrequency[] =
  ["every", "daily", "weekly", "off"];

export const NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_DEFAULT: NdaIntegritySweepSummaryFrequency =
  "daily";

function isFrequency(v: string): v is NdaIntegritySweepSummaryFrequency {
  return (NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_VALUES as string[]).includes(v);
}

function frequencyLabel(f: NdaIntegritySweepSummaryFrequency): string {
  switch (f) {
    case "every":
      return "Every sweep";
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "off":
      return "Off";
  }
}

export type NdaIntegritySweepFailure = {
  caseId: string;
  ndaId: number;
  storedHash: string;
  // Empty string when the failure was an exception rather than a hash mismatch
  // (e.g. malformed base64 / unreadable row). The `reason` field disambiguates.
  recomputedHash: string;
  bytes: number;
  templateVersion: string;
  reason: "hash_mismatch" | "verify_error";
  error?: string;
};

export type NdaIntegritySweepSummary = {
  startedAt: string;
  finishedAt: string;
  total: number;
  verified: number;
  failed: number;
  failures: NdaIntegritySweepFailure[];
  // `ok` means the sweep completed end-to-end (every sealed NDA row was
  // reachable and re-hashed); `error` means the sweep itself blew up
  // (e.g. DB unavailable) so the verified/failed counts are not a
  // reliable assertion of integrity. The UI surfaces a distinct warning
  // for the `error` case so a control failure isn't read as "all clean".
  status: "ok" | "error";
  errorMessage?: string;
};

let sweepInFlight = false;
let lastSummary: NdaIntegritySweepSummary | null = null;

export function getLastNdaIntegritySweepSummary(): NdaIntegritySweepSummary | null {
  return lastSummary;
}

// ---------------------------------------------------------------------------
// Cadence settings (env override > DB-stored value > hard-coded default)
// ---------------------------------------------------------------------------

function readEnvIntervalOverride(): number | null {
  const raw = Number.parseFloat(
    process.env.NDA_INTEGRITY_SWEEP_INTERVAL_HOURS ?? "",
  );
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

function clampIntervalHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) {
    return NDA_INTEGRITY_SWEEP_INTERVAL_DEFAULT_HOURS;
  }
  return Math.min(
    Math.max(hours, NDA_INTEGRITY_SWEEP_INTERVAL_MIN_HOURS),
    NDA_INTEGRITY_SWEEP_INTERVAL_MAX_HOURS,
  );
}

let cachedIntervalHours: number = NDA_INTEGRITY_SWEEP_INTERVAL_DEFAULT_HOURS;
let cachedSource: "env" | "db" | "default" = "default";
let sweepTimer: ReturnType<typeof setInterval> | null = null;

async function loadIntervalFromStore(): Promise<{
  hours: number;
  source: "env" | "db" | "default";
}> {
  const envOverride = readEnvIntervalOverride();
  if (envOverride !== null) {
    return { hours: clampIntervalHours(envOverride), source: "env" };
  }
  try {
    const row = await storage.getAppSetting(
      NDA_INTEGRITY_SWEEP_INTERVAL_SETTING_KEY,
    );
    if (row) {
      const parsed = Number.parseFloat(row.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return { hours: clampIntervalHours(parsed), source: "db" };
      }
    }
  } catch (err) {
    console.error(
      "Failed to read NDA integrity sweep interval from DB:",
      err,
    );
  }
  return {
    hours: NDA_INTEGRITY_SWEEP_INTERVAL_DEFAULT_HOURS,
    source: "default",
  };
}

async function refreshIntervalCache(): Promise<void> {
  const { hours, source } = await loadIntervalFromStore();
  cachedIntervalHours = hours;
  cachedSource = source;
}

export function getCachedNdaIntegritySweepIntervalHours(): number {
  return cachedIntervalHours;
}

export interface NdaIntegritySweepIntervalSetting {
  hours: number;
  source: "env" | "db" | "default";
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function readNdaIntegritySweepIntervalSetting(): Promise<NdaIntegritySweepIntervalSetting> {
  const { hours, source } = await loadIntervalFromStore();
  cachedIntervalHours = hours;
  cachedSource = source;
  let updatedAt: Date | null = null;
  let updatedBy: string | null = null;
  try {
    const row = await storage.getAppSetting(
      NDA_INTEGRITY_SWEEP_INTERVAL_SETTING_KEY,
    );
    if (row) {
      updatedAt = row.updatedAt ?? null;
      updatedBy = row.updatedBy ?? null;
    }
  } catch (err) {
    console.error(
      "Failed to read NDA integrity sweep interval metadata:",
      err,
    );
  }
  return {
    hours,
    source,
    envOverride: source === "env",
    min: NDA_INTEGRITY_SWEEP_INTERVAL_MIN_HOURS,
    max: NDA_INTEGRITY_SWEEP_INTERVAL_MAX_HOURS,
    default: NDA_INTEGRITY_SWEEP_INTERVAL_DEFAULT_HOURS,
    updatedAt,
    updatedBy,
  };
}

// ---------------------------------------------------------------------------
// Summary-email cadence settings (env override > DB-stored value > default)
// ---------------------------------------------------------------------------

function readEnvFrequencyOverride(): NdaIntegritySweepSummaryFrequency | null {
  const raw = process.env.NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY?.trim().toLowerCase();
  if (!raw) return null;
  return isFrequency(raw) ? raw : null;
}

async function loadSummaryFrequencyFromStore(): Promise<{
  frequency: NdaIntegritySweepSummaryFrequency;
  source: "env" | "db" | "default";
}> {
  const envOverride = readEnvFrequencyOverride();
  if (envOverride) return { frequency: envOverride, source: "env" };
  try {
    const row = await storage.getAppSetting(
      NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_SETTING_KEY,
    );
    if (row) {
      const v = row.value?.trim().toLowerCase();
      if (v && isFrequency(v)) return { frequency: v, source: "db" };
    }
  } catch (err) {
    console.error(
      "Failed to read NDA integrity sweep summary frequency from DB:",
      err,
    );
  }
  return {
    frequency: NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_DEFAULT,
    source: "default",
  };
}

export interface NdaIntegritySweepSummaryFrequencySetting {
  frequency: NdaIntegritySweepSummaryFrequency;
  source: "env" | "db" | "default";
  envOverride: boolean;
  default: NdaIntegritySweepSummaryFrequency;
  options: NdaIntegritySweepSummaryFrequency[];
  updatedAt: Date | null;
  updatedBy: string | null;
  lastSummarySentAt: Date | null;
}

export async function readNdaIntegritySweepSummaryFrequencySetting(): Promise<NdaIntegritySweepSummaryFrequencySetting> {
  const { frequency, source } = await loadSummaryFrequencyFromStore();
  let updatedAt: Date | null = null;
  let updatedBy: string | null = null;
  let lastSummarySentAt: Date | null = null;
  try {
    const row = await storage.getAppSetting(
      NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_SETTING_KEY,
    );
    if (row) {
      updatedAt = row.updatedAt ?? null;
      updatedBy = row.updatedBy ?? null;
    }
  } catch (err) {
    console.error(
      "Failed to read NDA integrity sweep summary frequency metadata:",
      err,
    );
  }
  try {
    const lastRow = await storage.getAppSetting(
      NDA_INTEGRITY_SWEEP_SUMMARY_LAST_SENT_AT_SETTING_KEY,
    );
    if (lastRow?.value) {
      const parsed = new Date(lastRow.value);
      if (!Number.isNaN(parsed.getTime())) lastSummarySentAt = parsed;
    }
  } catch (err) {
    console.error(
      "Failed to read NDA integrity sweep last-summary timestamp:",
      err,
    );
  }
  return {
    frequency,
    source,
    envOverride: source === "env",
    default: NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_DEFAULT,
    options: NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_VALUES,
    updatedAt,
    updatedBy,
    lastSummarySentAt,
  };
}

export async function saveNdaIntegritySweepSummaryFrequency(
  raw: string,
  updatedBy?: string | null,
  executor?: import("./db").DbExecutor,
): Promise<NdaIntegritySweepSummaryFrequency> {
  const v = raw?.trim().toLowerCase();
  if (!v || !isFrequency(v)) {
    throw new Error(
      `Frequency must be one of: ${NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_VALUES.join(", ")}`,
    );
  }
  await storage.setAppSetting(
    NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_SETTING_KEY,
    v,
    updatedBy ?? null,
    executor,
  );
  return v;
}

function shouldSendSummaryNow(
  frequency: NdaIntegritySweepSummaryFrequency,
  lastSentAt: Date | null,
  now: Date,
): boolean {
  if (frequency === "off") return false;
  if (frequency === "every") return true;
  if (!lastSentAt) return true;
  const elapsedMs = now.getTime() - lastSentAt.getTime();
  // Subtract a small fudge so a sweep that runs slightly under 24h after
  // the previous one (e.g. boot-time sweep at 23h59m) still emits the
  // heartbeat instead of skipping a day. 5 minutes is well under any
  // sensible cadence and won't accidentally double-send.
  const fudgeMs = 5 * 60 * 1000;
  if (frequency === "daily") return elapsedMs >= 24 * 60 * 60 * 1000 - fudgeMs;
  if (frequency === "weekly")
    return elapsedMs >= 7 * 24 * 60 * 60 * 1000 - fudgeMs;
  return false;
}

function scheduleSweep(hours: number): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  const intervalMs = Math.max(1, hours) * 60 * 60 * 1000;
  sweepTimer = setInterval(() => {
    void runNdaIntegritySweep();
  }, intervalMs);
}

export async function saveNdaIntegritySweepIntervalHours(
  rawHours: number,
  updatedBy?: string | null,
  executor?: import("./db").DbExecutor,
): Promise<number> {
  if (!Number.isFinite(rawHours)) {
    throw new Error("Interval must be a finite number of hours");
  }
  if (
    rawHours < NDA_INTEGRITY_SWEEP_INTERVAL_MIN_HOURS ||
    rawHours > NDA_INTEGRITY_SWEEP_INTERVAL_MAX_HOURS
  ) {
    throw new Error(
      `Interval must be between ${NDA_INTEGRITY_SWEEP_INTERVAL_MIN_HOURS} and ${NDA_INTEGRITY_SWEEP_INTERVAL_MAX_HOURS} hours`,
    );
  }
  const hours = clampIntervalHours(rawHours);
  await storage.setAppSetting(
    NDA_INTEGRITY_SWEEP_INTERVAL_SETTING_KEY,
    String(hours),
    updatedBy ?? null,
    executor,
  );
  // Task #157 — inside a transaction the cache refresh + reschedule run
  // after commit (see applyNdaIntegritySweepIntervalChange).
  if (!executor) {
    await refreshIntervalCache();
    if (sweepTimer) {
      scheduleSweep(cachedIntervalHours);
    }
    return cachedIntervalHours;
  }
  return hours;
}

/** Post-commit hook: refresh the interval cache + reschedule the timer. */
export async function applyNdaIntegritySweepIntervalChange(): Promise<number> {
  await refreshIntervalCache();
  if (sweepTimer) {
    scheduleSweep(cachedIntervalHours);
  }
  return cachedIntervalHours;
}

export async function runNdaIntegritySweep(): Promise<NdaIntegritySweepSummary | null> {
  if (sweepInFlight) {
    // Never synthesise an all-zero summary while a sweep is in flight —
    // that would briefly tell the dashboard "no failures" mid-sweep and
    // mask a real tamper finding until the next poll. Returning the
    // previous completed summary (or null on first boot) lets callers
    // distinguish "pending" from "clean".
    return lastSummary;
  }
  sweepInFlight = true;
  const startedAt = new Date();
  const failures: NdaIntegritySweepFailure[] = [];
  let verified = 0;
  let total = 0;
  let sweepError: Error | null = null;
  try {
    const sealedNdas = await storage.getAllSealedCaseNdas();
    total = sealedNdas.length;
    for (const nda of sealedNdas) {
      let ok = false;
      let recomputedHash = "";
      let bytesLen = 0;
      let verifyError: Error | null = null;
      try {
        const storedBytes = Buffer.from(nda.signedPdfBase64, "base64");
        bytesLen = storedBytes.length;
        recomputedHash = sha256Hex(storedBytes);
        ok = recomputedHash === nda.contentHash;
      } catch (caseErr) {
        // A thrown exception during re-hashing (e.g. corrupted base64,
        // unreadable column) MUST be treated as a failed verification —
        // a silent log-and-continue would let at-rest tampering or
        // poisoning of the signedPdfBase64 column evade the alert.
        verifyError = caseErr instanceof Error ? caseErr : new Error(String(caseErr));
        console.error(
          "[nda-integrity-sweep] verify error for case",
          nda.caseId,
          "nda",
          nda.id,
          verifyError,
        );
      }

      if (ok) {
        verified += 1;
      } else {
        failures.push({
          caseId: nda.caseId,
          ndaId: nda.id,
          storedHash: nda.contentHash,
          recomputedHash,
          bytes: bytesLen,
          templateVersion: nda.templateVersion,
          reason: verifyError ? "verify_error" : "hash_mismatch",
          error: verifyError?.message,
        });
      }

      try {
        await storage.createAuditLog({
          action: ok ? "nda_integrity_verified" : "nda_integrity_failed",
          targetType: "case",
          targetId: nda.caseId,
          adminUsername: "system",
          newValue: ok
            ? `Nightly sweep: NDA integrity verified (row ${nda.id}, hash ${recomputedHash}, template ${nda.templateVersion}, ${bytesLen} bytes).`
            : verifyError
              ? `Nightly sweep: NDA integrity FAILED (row ${nda.id}, template ${nda.templateVersion}). Re-hash threw: ${verifyError.message}. Stored hash ${nda.contentHash}.`
              : `Nightly sweep: NDA integrity FAILED (row ${nda.id}). Stored hash ${nda.contentHash} does not match recomputed hash ${recomputedHash} (${bytesLen} bytes, template ${nda.templateVersion}).`,
        });
      } catch (logErr) {
        console.error(
          "[nda-integrity-sweep] audit log failed for case",
          nda.caseId,
          logErr,
        );
      }
    }
  } catch (err) {
    sweepError = err instanceof Error ? err : new Error(String(err));
    console.error("[nda-integrity-sweep] sweep failed:", err);
  } finally {
    sweepInFlight = false;
  }

  const finishedAt = new Date();
  const summary: NdaIntegritySweepSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    total,
    verified,
    failed: failures.length,
    failures,
    status: sweepError ? "error" : "ok",
    errorMessage: sweepError?.message,
  };
  lastSummary = summary;

  // One rollup audit row per sweep so an operator can scan the audit log
  // and see "the sweep ran at T, N sealed cases checked, M failed" without
  // having to count individual per-case rows. The per-case rows above
  // still drive the persistent badge on each case's Sealed banner.
  try {
    await storage.createAuditLog({
      action: NDA_INTEGRITY_SWEEP_AUDIT_ACTION,
      targetType: "system",
      targetId: "nda_integrity_sweep",
      adminUsername: "system",
      newValue:
        summary.status === "error"
          ? `Nightly NDA integrity sweep ERRORED before completing: ${summary.errorMessage ?? "unknown error"}. Verified/failed counts (${summary.verified}/${summary.failed} of ${summary.total}) are partial and must not be read as a clean bill of health.`
          : summary.failed > 0
            ? `Nightly NDA integrity sweep: ${summary.failed} of ${summary.total} sealed NDA row(s) FAILED verification across ${new Set(summary.failures.map((f) => f.caseId)).size} case(s). Failed cases: ${Array.from(new Set(summary.failures.map((f) => f.caseId))).join(", ")}.`
            : `Nightly NDA integrity sweep: ${summary.verified} of ${summary.total} sealed NDA row(s) verified clean.`,
    });
  } catch (logErr) {
    console.error("[nda-integrity-sweep] rollup audit log failed:", logErr);
  }

  // In-dashboard notification is raised only on failure so admins are not
  // spammed with a daily "all clean" entry — the rollup audit row above
  // is the green-path evidence trail. The dashboard banner also polls the
  // summary endpoint so the failure is visible even if the bell is missed.
  if (summary.status === "error") {
    try {
      await notificationService.notifyAdmin(
        "nda_integrity_sweep_error",
        "Sealed NDA integrity sweep failed to complete",
        `The nightly sweep errored at ${finishedAt.toISOString()} before finishing: ${summary.errorMessage ?? "unknown error"}. The reported verified/failed counts are partial — re-run the sweep once the underlying issue is resolved.`,
        "/admin?tab=cases",
      );
    } catch (notifyErr) {
      console.error(
        "[nda-integrity-sweep] error notification failed:",
        notifyErr,
      );
    }
  } else if (summary.failed > 0) {
    const failedCaseIds = Array.from(
      new Set(summary.failures.map((f) => f.caseId)),
    );
    const uniqueFailedCases = failedCaseIds.length;
    for (const caseId of failedCaseIds) {
      try {
        await notificationService.notifyAdmin(
          "nda_integrity_failed",
          `Sealed NDA tampering detected on case ${caseId}`,
          `The nightly sweep re-hashed ${summary.total} sealed NDA row(s) at ${finishedAt.toISOString()} and ${summary.failed} did not match the hash captured at signing (across ${uniqueFailedCases} case(s)). Open the affected case(s) to review and re-verify.`,
          `/admin?tab=cases&caseId=${encodeURIComponent(caseId)}`,
        );
      } catch (notifyErr) {
        console.error(
          "[nda-integrity-sweep] admin notification failed:",
          notifyErr,
        );
      }
    }

    // Out-of-band admin email so operators are alerted within minutes
    // instead of whenever they next open the dashboard. Best-effort: a
    // missing recipient / SMTP outage is audit-logged but never thrown,
    // because the in-dashboard notification + per-case audit rows above
    // remain the canonical evidence trail.
    const adminRecipients = await resolveAdminAlertRecipients();
    if (adminRecipients.length === 0) {
      try {
        await storage.createAuditLog({
          action: "email_nda_integrity_failed_failed",
          targetType: "system",
          targetId: "nda_integrity_sweep",
          adminUsername: "system",
          newValue: `Sealed NDA tamper alert email NOT sent: no admin recipient configured (set ADMIN_ALERT_EMAIL env var or app_settings.admin_alert_email). ${summary.failed} failure(s) across ${uniqueFailedCases} case(s).`,
        });
      } catch (logErr) {
        console.error(
          "[nda-integrity-sweep] missing-recipient audit log failed:",
          logErr,
        );
      }
    } else {
      let sendResult: { success: boolean; error?: string };
      const recipientLabel = adminRecipients.join(", ");
      const adminBaseUrl = getAdminDashboardUrl();
      const caseDeepLinks = failedCaseIds.map((caseId) => ({
        caseId,
        url: `${adminBaseUrl}?tab=cases&caseId=${encodeURIComponent(caseId)}`,
      }));
      try {
        sendResult = await emailService.sendNdaIntegrityFailureAlert({
          to: adminRecipients,
          sweepFinishedAt: finishedAt.toISOString(),
          totalChecked: summary.total,
          failedRows: summary.failed,
          failedCaseIds,
          caseDeepLinks,
          dashboardUrl: adminBaseUrl,
        });
      } catch (err) {
        sendResult = {
          success: false,
          error: err instanceof Error ? err.message : "unexpected SMTP error",
        };
      }

      try {
        await storage.createAuditLog({
          action: sendResult.success
            ? "email_nda_integrity_failed"
            : "email_nda_integrity_failed_failed",
          targetType: "system",
          targetId: "nda_integrity_sweep",
          adminUsername: "system",
          newValue: sendResult.success
            ? `Sealed NDA tamper alert email sent to ${recipientLabel} (${summary.failed} failure(s) across ${uniqueFailedCases} case(s): ${failedCaseIds.join(", ")}).`
            : `Sealed NDA tamper alert email FAILED to ${recipientLabel}: ${sendResult.error ?? "unknown error"}. ${summary.failed} failure(s) across ${uniqueFailedCases} case(s).`,
        });
      } catch (logErr) {
        console.error(
          "[nda-integrity-sweep] alert email audit log failed:",
          logErr,
        );
      }
    }
  } else {
    // Sweep completed end-to-end with zero failures — this is the
    // positive-confirmation path. Send the configured heartbeat email so
    // operators can tell "all clean" apart from "sweep / SMTP broken".
    // Cadence (every / daily / weekly / off) is admin-tunable and
    // throttled against the last-sent timestamp persisted in app_settings.
    await maybeSendSweepSummaryEmail(summary, finishedAt);
  }

  // Stamp the last-successful-completion timestamp so the watchdog
  // (see runNdaIntegritySweepStaleCheck) can distinguish "sweep ran
  // clean" from "sweep didn't run at all". We deliberately stamp on
  // every status === "ok" sweep regardless of failure count: a sweep
  // that finds tampering still proves the worker + DB + scheduler are
  // alive. status === "error" sweeps DON'T stamp — that's the case
  // the watchdog needs to surface.
  if (summary.status === "ok") {
    try {
      await storage.setAppSetting(
        NDA_INTEGRITY_SWEEP_LAST_SUCCESS_AT_SETTING_KEY,
        finishedAt.toISOString(),
        "system",
      );
    } catch (err) {
      console.error(
        "[nda-integrity-sweep] failed to persist last-success timestamp:",
        err,
      );
    }
    // Clear any previous stale-alert throttle so a recovery-then-relapse
    // cycle re-alerts immediately instead of being silenced by the
    // throttle window. Best-effort — failure here is logged but never
    // throws, since the watchdog can still operate without it (it just
    // means a stale alert that fired during the outage might be
    // suppressed for up to one throttle window).
    try {
      const row = await storage.getAppSetting(
        NDA_INTEGRITY_SWEEP_STALE_ALERT_LAST_SENT_AT_SETTING_KEY,
      );
      if (row?.value) {
        await storage.setAppSetting(
          NDA_INTEGRITY_SWEEP_STALE_ALERT_LAST_SENT_AT_SETTING_KEY,
          "",
          "system",
        );
      }
    } catch (err) {
      console.error(
        "[nda-integrity-sweep] failed to clear stale-alert throttle:",
        err,
      );
    }
  }

  log(
    `NDA integrity sweep finished: ${summary.verified}/${summary.total} verified, ${summary.failed} failed`,
  );
  return summary;
}

// ---------------------------------------------------------------------------
// Stale-sweep watchdog
// ---------------------------------------------------------------------------

export interface NdaIntegritySweepStaleness {
  isStale: boolean;
  lastSuccessAt: string | null;
  intervalHours: number;
  graceHours: number;
  thresholdHours: number;
  // Milliseconds the sweep is overdue by, computed against
  // `lastSuccessAt` when one exists; otherwise against
  // `processStartedAt` so "never ran past threshold" still trips.
  overdueMs: number;
  // ISO timestamp of the most recent stale-alert email send (used for
  // throttling). Null if no stale alert has ever been sent (or if
  // reading the throttle row failed — see `readError`).
  lastStaleAlertSentAt: string | null;
  // Whether the watchdog has ever seen a successful sweep. When true,
  // staleness is judged from the process start time (not from null),
  // so a boot-time sweep that keeps failing eventually trips the
  // alarm instead of being permanently exempt.
  neverRan: boolean;
  // ISO timestamp the watchdog was first armed (process boot). Used
  // as the staleness baseline when no successful sweep has ever been
  // recorded — see `neverRan`.
  processStartedAt: string;
  // True when reading the underlying app_settings rows failed (e.g.
  // DB unreachable, which is exactly the kind of outage this watchdog
  // is supposed to surface). When true, `isStale` is forced to true
  // so the alert fires fail-closed instead of silently reporting
  // "looks fine" against a stale in-memory default.
  readError: boolean;
  // Human-readable detail of the read failure, when `readError` is true.
  readErrorMessage?: string;
}

// Captured at module load so the watchdog has a stable "armed at"
// reference even if it ticks before the boot sweep stamps last_success.
// Exported for tests.
export const PROCESS_STARTED_AT = new Date();

function readEnvStaleGraceHoursOverride(): number | null {
  const raw = Number.parseFloat(
    process.env.NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS ?? "",
  );
  if (!Number.isFinite(raw) || raw < 0) return null;
  return raw;
}

function clampStaleGraceHours(hours: number): number {
  if (!Number.isFinite(hours) || hours < 0) {
    return NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_DEFAULT;
  }
  return Math.min(
    Math.max(hours, NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MIN),
    NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MAX,
  );
}

let cachedStaleGraceHours: number =
  NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_DEFAULT;
let cachedStaleGraceSource: "env" | "db" | "default" = "default";

async function loadStaleGraceFromStore(): Promise<{
  hours: number;
  source: "env" | "db" | "default";
}> {
  const envOverride = readEnvStaleGraceHoursOverride();
  if (envOverride !== null) {
    return { hours: clampStaleGraceHours(envOverride), source: "env" };
  }
  try {
    const row = await storage.getAppSetting(
      NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_SETTING_KEY,
    );
    if (row) {
      const parsed = Number.parseFloat(row.value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return { hours: clampStaleGraceHours(parsed), source: "db" };
      }
    }
  } catch (err) {
    console.error(
      "Failed to read NDA integrity sweep stale-grace from DB:",
      err,
    );
  }
  return {
    hours: NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_DEFAULT,
    source: "default",
  };
}

async function refreshStaleGraceCache(): Promise<void> {
  const { hours, source } = await loadStaleGraceFromStore();
  cachedStaleGraceHours = hours;
  cachedStaleGraceSource = source;
}

// Synchronous accessor used by the watchdog and the boot-time log
// line. The cache is primed once on boot (refreshStaleGraceCache) and
// refreshed on every save, mirroring the sweep-interval pattern. Env
// overrides re-resolve on every read so a redeploy that flips the env
// var takes effect even if the cache hasn't refreshed yet.
function resolveStaleGraceHours(): number {
  const env = readEnvStaleGraceHoursOverride();
  if (env !== null) return clampStaleGraceHours(env);
  return cachedStaleGraceHours;
}

export function getCachedNdaIntegritySweepStaleGraceHours(): number {
  return cachedStaleGraceHours;
}

export interface NdaIntegritySweepStaleGraceSetting {
  hours: number;
  source: "env" | "db" | "default";
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function readNdaIntegritySweepStaleGraceSetting(): Promise<NdaIntegritySweepStaleGraceSetting> {
  const { hours, source } = await loadStaleGraceFromStore();
  cachedStaleGraceHours = hours;
  cachedStaleGraceSource = source;
  let updatedAt: Date | null = null;
  let updatedBy: string | null = null;
  try {
    const row = await storage.getAppSetting(
      NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_SETTING_KEY,
    );
    if (row) {
      updatedAt = row.updatedAt ?? null;
      updatedBy = row.updatedBy ?? null;
    }
  } catch (err) {
    console.error(
      "Failed to read NDA integrity sweep stale-grace metadata:",
      err,
    );
  }
  return {
    hours,
    source,
    envOverride: source === "env",
    min: NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MIN,
    max: NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MAX,
    default: NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_DEFAULT,
    updatedAt,
    updatedBy,
  };
}

export async function saveNdaIntegritySweepStaleGraceHours(
  rawHours: number,
  updatedBy?: string | null,
  executor?: import("./db").DbExecutor,
): Promise<number> {
  if (!Number.isFinite(rawHours)) {
    throw new Error("Grace must be a finite number of hours");
  }
  if (
    rawHours < NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MIN ||
    rawHours > NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MAX
  ) {
    throw new Error(
      `Grace must be between ${NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MIN} and ${NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MAX} hours`,
    );
  }
  const hours = clampStaleGraceHours(rawHours);
  await storage.setAppSetting(
    NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_SETTING_KEY,
    String(hours),
    updatedBy ?? null,
    executor,
  );
  if (!executor) {
    await refreshStaleGraceCache();
  }
  return hours;
}

/** Post-commit hook for transactional callers. */
export async function refreshNdaIntegritySweepStaleGraceCache(): Promise<void> {
  await refreshStaleGraceCache();
}

export async function computeNdaIntegritySweepStaleness(
  now: Date = new Date(),
): Promise<NdaIntegritySweepStaleness> {
  // Use the cached interval (refreshed at boot + on save) so this is a
  // pure clock+settings read with no DB hit beyond app_settings.
  const intervalHours = cachedIntervalHours;
  const graceHours = resolveStaleGraceHours();
  const thresholdHours = intervalHours + graceHours;
  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  const processStartedAtIso = PROCESS_STARTED_AT.toISOString();

  // Fail-CLOSED: an exception while reading the last-success row is
  // treated as evidence the underlying store (DB) is sick — which is
  // precisely one of the failure modes this watchdog exists to catch
  // (per task: "cron not firing, worker crashed, DB unreachable").
  // Returning isStale=false on a read failure would silently mask the
  // exact outage we're supposed to alert on.
  let lastSuccessAt: Date | null = null;
  let lastStaleAlertSentAt: Date | null = null;
  let readError = false;
  let readErrorMessage: string | undefined;

  try {
    const row = await storage.getAppSetting(
      NDA_INTEGRITY_SWEEP_LAST_SUCCESS_AT_SETTING_KEY,
    );
    if (row?.value) {
      const parsed = new Date(row.value);
      if (!Number.isNaN(parsed.getTime())) lastSuccessAt = parsed;
    }
  } catch (err) {
    readError = true;
    readErrorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      "[nda-integrity-sweep] failed to read last-success timestamp (fail-closed: treating as stale):",
      err,
    );
  }

  try {
    const row = await storage.getAppSetting(
      NDA_INTEGRITY_SWEEP_STALE_ALERT_LAST_SENT_AT_SETTING_KEY,
    );
    if (row?.value) {
      const parsed = new Date(row.value);
      if (!Number.isNaN(parsed.getTime())) lastStaleAlertSentAt = parsed;
    }
  } catch (err) {
    // The throttle row missing is not itself a fail-closed condition
    // (worst case we re-alert), but it's still evidence of store
    // trouble — record it so the watchdog escalates rather than
    // suppressing the alert behind a stale "we already sent" memory.
    readError = true;
    readErrorMessage = readErrorMessage
      ?? (err instanceof Error ? err.message : String(err));
    console.error(
      "[nda-integrity-sweep] failed to read stale-alert timestamp:",
      err,
    );
  }

  if (readError) {
    // We don't know how long ago last_success was — but we know the
    // store can't be read, which means new sweeps can't possibly be
    // succeeding either. Force-alert.
    const elapsedFromBoot = now.getTime() - PROCESS_STARTED_AT.getTime();
    return {
      isStale: true,
      lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
      intervalHours,
      graceHours,
      thresholdHours,
      overdueMs: Math.max(0, elapsedFromBoot),
      lastStaleAlertSentAt: lastStaleAlertSentAt?.toISOString() ?? null,
      neverRan: lastSuccessAt === null,
      processStartedAt: processStartedAtIso,
      readError: true,
      readErrorMessage,
    };
  }

  if (!lastSuccessAt) {
    // No successful sweep on record. We don't treat this as
    // permanently exempt — if the boot-time sweep keeps failing, the
    // watchdog needs to alert eventually. Baseline against the
    // process start so a freshly-booted instance has a fair grace
    // window, but anything past threshold trips the alarm.
    const elapsedFromBoot = now.getTime() - PROCESS_STARTED_AT.getTime();
    const overdueMs = Math.max(0, elapsedFromBoot - thresholdMs);
    return {
      isStale: overdueMs > 0,
      lastSuccessAt: null,
      intervalHours,
      graceHours,
      thresholdHours,
      overdueMs,
      lastStaleAlertSentAt: lastStaleAlertSentAt?.toISOString() ?? null,
      neverRan: true,
      processStartedAt: processStartedAtIso,
      readError: false,
    };
  }

  const elapsedMs = now.getTime() - lastSuccessAt.getTime();
  const overdueMs = Math.max(0, elapsedMs - thresholdMs);
  return {
    isStale: overdueMs > 0,
    lastSuccessAt: lastSuccessAt.toISOString(),
    intervalHours,
    graceHours,
    thresholdHours,
    overdueMs,
    lastStaleAlertSentAt: lastStaleAlertSentAt?.toISOString() ?? null,
    neverRan: false,
    processStartedAt: processStartedAtIso,
    readError: false,
  };
}

export const NDA_INTEGRITY_SWEEP_STALE_AUDIT_ACTION =
  "nda_integrity_sweep_stale";
export const NDA_INTEGRITY_SWEEP_STALE_EMAIL_AUDIT_ACTION =
  "email_nda_integrity_stale";

// Watchdog tick. Runs hourly via setInterval (see startNdaIntegritySweep).
// Best-effort: any exception inside is caught + logged so the timer
// never dies. Throttled so a long outage produces at most one alert per
// `thresholdHours` (matching the cadence of "sweep should have run by
// now") — that way the alert restarts each time the sweep would have
// run successfully if it were alive.
export async function runNdaIntegritySweepStaleCheck(
  now: Date = new Date(),
): Promise<{
  evaluated: boolean;
  staleness: NdaIntegritySweepStaleness;
  alerted: boolean;
  reason?: string;
}> {
  let staleness: NdaIntegritySweepStaleness;
  try {
    staleness = await computeNdaIntegritySweepStaleness(now);
  } catch (err) {
    // Fail-CLOSED: a compute-level exception (above and beyond the
    // settings-read failures already handled inside compute()) is
    // still evidence the watchdog can't see the world clearly.
    // Synthesise a stale state so the alert path below runs.
    console.error(
      "[nda-integrity-sweep] staleness compute failed (fail-closed: treating as stale):",
      err,
    );
    const graceHours = resolveStaleGraceHours();
    staleness = {
      isStale: true,
      lastSuccessAt: null,
      intervalHours: cachedIntervalHours,
      graceHours,
      thresholdHours: cachedIntervalHours + graceHours,
      overdueMs: Math.max(
        0,
        now.getTime() - PROCESS_STARTED_AT.getTime(),
      ),
      lastStaleAlertSentAt: null,
      neverRan: true,
      processStartedAt: PROCESS_STARTED_AT.toISOString(),
      readError: true,
      readErrorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (!staleness.isStale) {
    return { evaluated: true, staleness, alerted: false };
  }

  // Throttle: only re-fire once per threshold window. A 24h sweep with
  // a 6h grace produces at most one alert per 30h while broken.
  const throttleMs = staleness.thresholdHours * 60 * 60 * 1000;
  const lastSent = staleness.lastStaleAlertSentAt
    ? new Date(staleness.lastStaleAlertSentAt)
    : null;
  if (lastSent && now.getTime() - lastSent.getTime() < throttleMs) {
    return {
      evaluated: true,
      staleness,
      alerted: false,
      reason: "throttled",
    };
  }

  const overdueHours = staleness.overdueMs / (60 * 60 * 1000);
  const recipients = await resolveAdminAlertRecipients();
  const recipientLabel = recipients.join(", ");

  // Audit row first (independent of email outcome) so the stale event
  // is always recorded even when SMTP is down — which is precisely
  // when this watchdog is most valuable.
  try {
    await storage.createAuditLog({
      action: NDA_INTEGRITY_SWEEP_STALE_AUDIT_ACTION,
      targetType: "system",
      targetId: "nda_integrity_sweep",
      adminUsername: "system",
      newValue: `Nightly NDA integrity sweep is STALE: last successful run ${staleness.lastSuccessAt ?? "never"}; configured cadence ${staleness.intervalHours}h + grace ${staleness.graceHours}h (threshold ${staleness.thresholdHours}h); overdue by ${overdueHours.toFixed(1)}h. ${recipients.length === 0 ? "No admin recipient configured — alert email skipped." : `Alerting ${recipientLabel}.`}`,
    });
  } catch (logErr) {
    console.error(
      "[nda-integrity-sweep] stale audit log failed:",
      logErr,
    );
  }

  // In-dashboard notification so the banner appears even if SMTP fails.
  try {
    await notificationService.notifyAdmin(
      "nda_integrity_sweep_stale",
      "Sealed NDA integrity sweep has stopped running",
      `The nightly sweep has not completed successfully since ${staleness.lastSuccessAt ?? "boot"}. Expected cadence: every ${staleness.intervalHours}h (plus ${staleness.graceHours}h grace). It is overdue by ${overdueHours.toFixed(1)}h — investigate the scheduler / worker / database connection before a real tamper goes undetected.`,
      "/admin?tab=cases",
    );
  } catch (notifyErr) {
    console.error(
      "[nda-integrity-sweep] stale notification failed:",
      notifyErr,
    );
  }

  if (recipients.length === 0) {
    try {
      await storage.createAuditLog({
        action: `${NDA_INTEGRITY_SWEEP_STALE_EMAIL_AUDIT_ACTION}_failed`,
        targetType: "system",
        targetId: "nda_integrity_sweep",
        adminUsername: "system",
        newValue: `Stale-sweep watchdog email NOT sent: no admin recipient configured (set ADMIN_ALERT_EMAIL env var or app_settings.admin_alert_email). Last success ${staleness.lastSuccessAt ?? "never"}, overdue ${overdueHours.toFixed(1)}h.`,
      });
    } catch (logErr) {
      console.error(
        "[nda-integrity-sweep] stale missing-recipient audit log failed:",
        logErr,
      );
    }
    // Still stamp the throttle so the audit log + notification aren't
    // re-emitted every hour when a recipient is missing.
    await stampStaleAlertSent(now);
    return { evaluated: true, staleness, alerted: false, reason: "no-recipient" };
  }

  let sendResult: { success: boolean; error?: string };
  try {
    sendResult = await emailService.sendNdaIntegritySweepStaleAlert({
      to: recipients,
      lastSuccessAt: staleness.lastSuccessAt,
      intervalHours: staleness.intervalHours,
      graceHours: staleness.graceHours,
      overdueHours,
      dashboardUrl: getAdminDashboardUrl(),
    });
  } catch (err) {
    sendResult = {
      success: false,
      error: err instanceof Error ? err.message : "unexpected SMTP error",
    };
  }

  try {
    await storage.createAuditLog({
      action: sendResult.success
        ? NDA_INTEGRITY_SWEEP_STALE_EMAIL_AUDIT_ACTION
        : `${NDA_INTEGRITY_SWEEP_STALE_EMAIL_AUDIT_ACTION}_failed`,
      targetType: "system",
      targetId: "nda_integrity_sweep",
      adminUsername: "system",
      newValue: sendResult.success
        ? `Stale-sweep watchdog alert email sent to ${recipientLabel} (last success ${staleness.lastSuccessAt ?? "never"}, overdue ${overdueHours.toFixed(1)}h, threshold ${staleness.thresholdHours}h).`
        : `Stale-sweep watchdog alert email FAILED to ${recipientLabel}: ${sendResult.error ?? "unknown error"}. Last success ${staleness.lastSuccessAt ?? "never"}, overdue ${overdueHours.toFixed(1)}h.`,
    });
  } catch (logErr) {
    console.error(
      "[nda-integrity-sweep] stale email audit log failed:",
      logErr,
    );
  }

  // Stamp the throttle even on send failure — otherwise a persistent
  // SMTP outage would re-issue the audit row every hour. The audit
  // failure row above already preserves the evidence trail.
  await stampStaleAlertSent(now);

  return { evaluated: true, staleness, alerted: sendResult.success };
}

async function stampStaleAlertSent(now: Date): Promise<void> {
  try {
    await storage.setAppSetting(
      NDA_INTEGRITY_SWEEP_STALE_ALERT_LAST_SENT_AT_SETTING_KEY,
      now.toISOString(),
      "system",
    );
  } catch (err) {
    console.error(
      "[nda-integrity-sweep] failed to persist stale-alert timestamp:",
      err,
    );
  }
}

let staleWatchdogTimer: ReturnType<typeof setInterval> | null = null;

function scheduleStaleWatchdog(): void {
  if (staleWatchdogTimer) {
    clearInterval(staleWatchdogTimer);
    staleWatchdogTimer = null;
  }
  staleWatchdogTimer = setInterval(() => {
    void runNdaIntegritySweepStaleCheck().catch((err) => {
      console.error(
        "[nda-integrity-sweep] watchdog tick failed:",
        err,
      );
    });
  }, NDA_INTEGRITY_SWEEP_WATCHDOG_INTERVAL_MS);
}

async function maybeSendSweepSummaryEmail(
  summary: NdaIntegritySweepSummary,
  finishedAt: Date,
): Promise<void> {
  let frequency: NdaIntegritySweepSummaryFrequency;
  try {
    ({ frequency } = await loadSummaryFrequencyFromStore());
  } catch (err) {
    console.error(
      "[nda-integrity-sweep] failed to load summary frequency:",
      err,
    );
    return;
  }

  if (frequency === "off") return;

  let lastSentAt: Date | null = null;
  try {
    const row = await storage.getAppSetting(
      NDA_INTEGRITY_SWEEP_SUMMARY_LAST_SENT_AT_SETTING_KEY,
    );
    if (row?.value) {
      const parsed = new Date(row.value);
      if (!Number.isNaN(parsed.getTime())) lastSentAt = parsed;
    }
  } catch (err) {
    console.error(
      "[nda-integrity-sweep] failed to read last-summary timestamp:",
      err,
    );
  }

  if (!shouldSendSummaryNow(frequency, lastSentAt, finishedAt)) return;

  const adminRecipients = await resolveAdminAlertRecipients();
  const adminRecipientLabel = adminRecipients.join(", ");
  if (adminRecipients.length === 0) {
    // Mirror the failure-path behaviour: audit-log the miss so operators
    // can see the heartbeat would have been sent if a recipient were
    // configured. Never throw — heartbeat is best-effort.
    try {
      await storage.createAuditLog({
        action: "email_nda_integrity_summary_failed",
        targetType: "system",
        targetId: "nda_integrity_sweep",
        adminUsername: "system",
        newValue: `Sealed NDA integrity 'all clear' summary NOT sent: no admin recipient configured (set ADMIN_ALERT_EMAIL env var or app_settings.admin_alert_email). Cadence: ${frequency}. Verified ${summary.verified}/${summary.total}.`,
      });
    } catch (logErr) {
      console.error(
        "[nda-integrity-sweep] summary missing-recipient audit log failed:",
        logErr,
      );
    }
    return;
  }

  let sendResult: { success: boolean; error?: string };
  try {
    sendResult = await emailService.sendNdaIntegritySweepSummary({
      to: adminRecipients,
      sweepFinishedAt: finishedAt.toISOString(),
      totalChecked: summary.total,
      verified: summary.verified,
      cadenceLabel: frequencyLabel(frequency),
      dashboardUrl: getAdminDashboardUrl(),
    });
  } catch (err) {
    sendResult = {
      success: false,
      error: err instanceof Error ? err.message : "unexpected SMTP error",
    };
  }

  if (sendResult.success) {
    // Persist the send timestamp so the next sweep can throttle against
    // it. We only stamp on success — a failed send shouldn't push the
    // next heartbeat out by a day/week. updatedBy is `system` to make
    // the row distinguishable from operator-driven changes in audits.
    try {
      await storage.setAppSetting(
        NDA_INTEGRITY_SWEEP_SUMMARY_LAST_SENT_AT_SETTING_KEY,
        finishedAt.toISOString(),
        "system",
      );
    } catch (err) {
      console.error(
        "[nda-integrity-sweep] failed to persist last-summary timestamp:",
        err,
      );
    }
  }

  try {
    await storage.createAuditLog({
      action: sendResult.success
        ? "email_nda_integrity_summary"
        : "email_nda_integrity_summary_failed",
      targetType: "system",
      targetId: "nda_integrity_sweep",
      adminUsername: "system",
      newValue: sendResult.success
        ? `Sealed NDA integrity 'all clear' summary sent to ${adminRecipientLabel} (cadence: ${frequency}, verified ${summary.verified}/${summary.total} at ${finishedAt.toISOString()}).`
        : `Sealed NDA integrity 'all clear' summary FAILED to ${adminRecipientLabel}: ${sendResult.error ?? "unknown error"}. Cadence: ${frequency}. Verified ${summary.verified}/${summary.total}.`,
    });
  } catch (logErr) {
    console.error(
      "[nda-integrity-sweep] summary email audit log failed:",
      logErr,
    );
  }
}

export function startNdaIntegritySweep(): void {
  // Kick the boot-time sweep + cache refresh in parallel, then schedule
  // the recurring timer against whatever cadence is currently in force
  // (env override > DB-stored > default). The stale-sweep watchdog is
  // scheduled alongside so an outage that takes the sweep timer itself
  // down is still detectable (the watchdog runs on its own setInterval
  // and only reads app_settings).
  void runNdaIntegritySweep();
  void Promise.all([refreshIntervalCache(), refreshStaleGraceCache()]).then(
    () => {
      scheduleSweep(cachedIntervalHours);
      scheduleStaleWatchdog();
      const graceSourceSuffix =
        cachedStaleGraceSource === "env"
          ? ", env override"
          : cachedStaleGraceSource === "db"
            ? ", admin-set"
            : "";
      log(
        `NDA integrity sweep started (every ${cachedIntervalHours} hour(s)${cachedSource === "env" ? ", env override" : ""}, re-hashing every sealed NDA PDF and alerting on tamper detection; stale-sweep watchdog active with ${resolveStaleGraceHours()}h grace${graceSourceSuffix})`,
      );
    },
  );
}
