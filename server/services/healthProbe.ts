import { checkDatabase, checkAi, checkSmtp } from "./healthCheck";
import { emailService } from "./EmailService";
import { storage } from "../storage";
import { getPublicAdminUrl } from "../lib/publicBaseUrl";
import {
  parseAdminAlertRecipients,
  ADMIN_ALERT_EMAIL_SETTING_KEY,
} from "../nda-integrity-sweep";

// ---------------------------------------------------------------------------
// Scheduled internal health probe
//
// Runs every PROBE_INTERVAL_MS (default 5 minutes). On each probe:
//  - Checks DB, SMTP, and AI service status via the existing healthCheck probes.
//  - If any service transitions from healthy → degraded, sends an ops alert.
//  - If a previously degraded service transitions back to healthy, sends a
//    recovery alert so the team knows the outage has resolved.
//  - Both alert types are audit-logged against the "system" target.
//  - The alert is throttled: at most one failure alert per ALERT_COOLDOWN_MS
//    per service, stored in the health_probe_last_alert app_setting.
//
// Interval and alert cooldown are operator-tunable via app_settings (keys
// health_probe_interval_minutes and health_probe_alert_cooldown_minutes).
// Both are re-read on every scheduling cycle so changes take effect without
// a process restart.
//
// NOTE: state is process-local (last known statuses). On autoscaled
// deployments each instance runs its own probe — this is intentional, the
// probe is lightweight and independent per-instance checks surface problems
// faster than a single centralised poller.
// ---------------------------------------------------------------------------

const PROBE_INTERVAL_DEFAULT_MINUTES = 5;
const PROBE_INTERVAL_MIN_MINUTES = 1;
const PROBE_INTERVAL_MAX_MINUTES = 60;

const ALERT_COOLDOWN_DEFAULT_MINUTES = 10;
const ALERT_COOLDOWN_MIN_MINUTES = 1;
const ALERT_COOLDOWN_MAX_MINUTES = 120;

export const HEALTH_PROBE_INTERVAL_SETTING_KEY = "health_probe_interval_minutes";
export const HEALTH_PROBE_COOLDOWN_SETTING_KEY = "health_probe_alert_cooldown_minutes";

export const HEALTH_PROBE_LAST_ALERT_SETTING_KEY = "health_probe_last_alert_at";
export const HEALTH_PROBE_LAST_RECOVERY_SETTING_KEY = "health_probe_last_recovery_at";

// Re-export for consumers that need the limits (e.g. admin routes).
export {
  PROBE_INTERVAL_DEFAULT_MINUTES,
  PROBE_INTERVAL_MIN_MINUTES,
  PROBE_INTERVAL_MAX_MINUTES,
  ALERT_COOLDOWN_DEFAULT_MINUTES,
  ALERT_COOLDOWN_MIN_MINUTES,
  ALERT_COOLDOWN_MAX_MINUTES,
};

type ServiceStatus = "ok" | "degraded" | "unconfigured";

interface ServiceState {
  status: ServiceStatus;
  lastAlertedAt: number | null;
}

const _state: Record<string, ServiceState> = {
  db: { status: "ok", lastAlertedAt: null },
  smtp: { status: "ok", lastAlertedAt: null },
  ai: { status: "ok", lastAlertedAt: null },
};

/** Exposed for testing — reset in-process state between test cases. */
export function _resetHealthProbeStateForTests(): void {
  for (const svc of Object.keys(_state)) {
    _state[svc] = { status: "ok", lastAlertedAt: null };
  }
}

/** Exposed for testing — seed a specific service state (e.g. pre-seed as degraded). */
export function _seedServiceStatusForTest(svc: string, status: ServiceStatus): void {
  if (_state[svc]) _state[svc].status = status;
}

function getAdminDashboardUrl(): string {
  return getPublicAdminUrl();
}

async function resolveAlertRecipients(): Promise<string[]> {
  const fromEnv = process.env.ADMIN_ALERT_EMAIL?.trim();
  if (fromEnv) return parseAdminAlertRecipients(fromEnv);
  try {
    const row = await storage.getAppSetting(ADMIN_ALERT_EMAIL_SETTING_KEY);
    return parseAdminAlertRecipients(row?.value);
  } catch {
    return [];
  }
}

function log(msg: string): void {
  const ts = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${ts} [health-probe] ${msg}`);
}

// ── Setting helpers ──────────────────────────────────────────────────────────

function clampMinutes(
  minutes: number,
  min: number,
  max: number,
  defaultVal: number,
): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return defaultVal;
  return Math.min(Math.max(minutes, min), max);
}

function readEnvMinutes(envVar: string): number | null {
  const raw = Number.parseFloat(process.env[envVar] ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

async function loadMinutesSetting(
  settingKey: string,
  envVar: string,
  min: number,
  max: number,
  defaultVal: number,
): Promise<{ minutes: number; source: "env" | "db" | "default" }> {
  const envOverride = readEnvMinutes(envVar);
  if (envOverride !== null) {
    return {
      minutes: clampMinutes(envOverride, min, max, defaultVal),
      source: "env",
    };
  }
  try {
    const row = await storage.getAppSetting(settingKey);
    if (row?.value) {
      const parsed = Number.parseFloat(row.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return { minutes: clampMinutes(parsed, min, max, defaultVal), source: "db" };
      }
    }
  } catch (err) {
    console.error(`[health-probe] failed to read ${settingKey} from DB:`, err);
  }
  return { minutes: defaultVal, source: "default" };
}

export interface HealthProbeTimingSetting {
  minutes: number;
  source: "env" | "db" | "default";
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: Date | null;
  updatedBy: string | null;
}

async function readTimingSetting(
  settingKey: string,
  envVar: string,
  min: number,
  max: number,
  defaultVal: number,
): Promise<HealthProbeTimingSetting> {
  const { minutes, source } = await loadMinutesSetting(
    settingKey,
    envVar,
    min,
    max,
    defaultVal,
  );
  let updatedAt: Date | null = null;
  let updatedBy: string | null = null;
  try {
    const row = await storage.getAppSetting(settingKey);
    if (row) {
      updatedAt = row.updatedAt ?? null;
      updatedBy = row.updatedBy ?? null;
    }
  } catch (err) {
    console.error(`[health-probe] failed to read ${settingKey} metadata:`, err);
  }
  return {
    minutes,
    source,
    envOverride: source === "env",
    min,
    max,
    default: defaultVal,
    updatedAt,
    updatedBy,
  };
}

async function saveMinutesSetting(
  settingKey: string,
  min: number,
  max: number,
  rawMinutes: number,
  updatedBy?: string | null,
  executor?: import("../db").DbExecutor,
): Promise<number> {
  if (!Number.isFinite(rawMinutes)) {
    throw new Error("Value must be a finite number of minutes");
  }
  if (rawMinutes < min || rawMinutes > max) {
    throw new Error(`Value must be between ${min} and ${max} minutes`);
  }
  const minutes = Math.round(rawMinutes);
  await storage.setAppSetting(
    settingKey,
    String(minutes),
    updatedBy ?? null,
    executor,
  );
  return minutes;
}

export async function readHealthProbeIntervalSetting(): Promise<HealthProbeTimingSetting> {
  return readTimingSetting(
    HEALTH_PROBE_INTERVAL_SETTING_KEY,
    "HEALTH_PROBE_INTERVAL_MINUTES",
    PROBE_INTERVAL_MIN_MINUTES,
    PROBE_INTERVAL_MAX_MINUTES,
    PROBE_INTERVAL_DEFAULT_MINUTES,
  );
}

export async function saveHealthProbeIntervalMinutes(
  rawMinutes: number,
  updatedBy?: string | null,
  executor?: import("../db").DbExecutor,
): Promise<number> {
  return saveMinutesSetting(
    HEALTH_PROBE_INTERVAL_SETTING_KEY,
    PROBE_INTERVAL_MIN_MINUTES,
    PROBE_INTERVAL_MAX_MINUTES,
    rawMinutes,
    updatedBy,
    executor,
  );
}

export async function readHealthProbeAlertCooldownSetting(): Promise<HealthProbeTimingSetting> {
  return readTimingSetting(
    HEALTH_PROBE_COOLDOWN_SETTING_KEY,
    "HEALTH_PROBE_ALERT_COOLDOWN_MINUTES",
    ALERT_COOLDOWN_MIN_MINUTES,
    ALERT_COOLDOWN_MAX_MINUTES,
    ALERT_COOLDOWN_DEFAULT_MINUTES,
  );
}

export async function saveHealthProbeAlertCooldownMinutes(
  rawMinutes: number,
  updatedBy?: string | null,
  executor?: import("../db").DbExecutor,
): Promise<number> {
  return saveMinutesSetting(
    HEALTH_PROBE_COOLDOWN_SETTING_KEY,
    ALERT_COOLDOWN_MIN_MINUTES,
    ALERT_COOLDOWN_MAX_MINUTES,
    rawMinutes,
    updatedBy,
    executor,
  );
}

// ── Probe execution ──────────────────────────────────────────────────────────

export async function runHealthProbe(): Promise<void> {
  let dbResult: ServiceStatus;
  let smtpResult: ServiceStatus;
  let aiResult: ServiceStatus;

  try {
    const [db, smtp, ai] = await Promise.allSettled([
      checkDatabase(),
      checkSmtp(),
      checkAi(),
    ]);
    dbResult =
      db.status === "fulfilled" ? db.value.status : "degraded";
    smtpResult =
      smtp.status === "fulfilled" ? smtp.value.status : "degraded";
    aiResult =
      ai.status === "fulfilled" ? ai.value.status : "degraded";
  } catch (err) {
    console.error("[health-probe] probe failed to run:", err);
    return;
  }

  const current: Record<string, ServiceStatus> = {
    db: dbResult,
    smtp: smtpResult,
    ai: aiResult,
  };

  const newlyDegraded: string[] = [];
  const nowRecovered: string[] = [];

  for (const [svc, status] of Object.entries(current)) {
    const prev = _state[svc];
    if (!prev) continue;

    if (status === "degraded" && prev.status !== "degraded") {
      newlyDegraded.push(svc);
    } else if (status !== "degraded" && prev.status === "degraded") {
      nowRecovered.push(svc);
    }

    _state[svc].status = status;
  }

  if (newlyDegraded.length === 0 && nowRecovered.length === 0) return;

  const recipients = await resolveAlertRecipients();
  if (recipients.length === 0) {
    if (newlyDegraded.length > 0) {
      log(`degraded services detected (${newlyDegraded.join(", ")}) but no ADMIN_ALERT_EMAIL configured — skipping alert`);
    }
    return;
  }

  // Read the alert cooldown from DB at probe-time so admin changes take effect
  // without a restart.
  const { minutes: cooldownMinutes } = await loadMinutesSetting(
    HEALTH_PROBE_COOLDOWN_SETTING_KEY,
    "HEALTH_PROBE_ALERT_COOLDOWN_MINUTES",
    ALERT_COOLDOWN_MIN_MINUTES,
    ALERT_COOLDOWN_MAX_MINUTES,
    ALERT_COOLDOWN_DEFAULT_MINUTES,
  );
  const alertCooldownMs = cooldownMinutes * 60 * 1000;

  const dashboardUrl = getAdminDashboardUrl();
  const now = Date.now();

  // Send failure alerts for newly degraded services (throttled per service).
  for (const svc of newlyDegraded) {
    const last = _state[svc].lastAlertedAt;
    if (last && now - last < alertCooldownMs) continue;
    _state[svc].lastAlertedAt = now;

    log(`service "${svc}" newly degraded — sending alert`);
    try {
      const result = await emailService.sendHealthCheckAlert({
        to: recipients,
        type: "failure",
        services: [svc],
        detectedAt: new Date(now),
        dashboardUrl,
      });
      try {
        await storage.createAuditLog({
          action: result.success
            ? "email_health_check_failure_alert"
            : "email_health_check_failure_alert_failed",
          adminUsername: "system",
          targetType: "system",
          targetId: "health_probe",
          newValue: result.success
            ? `Health check failure alert sent to ${recipients.join(", ")} (degraded: ${svc})`
            : `Health check failure alert FAILED to ${recipients.join(", ")}: ${result.error ?? "unknown"} (degraded: ${svc})`,
        });
      } catch {
        /* best-effort */
      }
    } catch (err) {
      console.error(`[health-probe] failed to send failure alert for ${svc}:`, err);
    }
  }

  // Send recovery alerts for services that came back up.
  if (nowRecovered.length > 0) {
    log(`services recovered (${nowRecovered.join(", ")}) — sending recovery alert`);
    try {
      const result = await emailService.sendHealthCheckAlert({
        to: recipients,
        type: "recovery",
        services: nowRecovered,
        detectedAt: new Date(now),
        dashboardUrl,
      });
      try {
        await storage.createAuditLog({
          action: result.success
            ? "email_health_check_recovery_alert"
            : "email_health_check_recovery_alert_failed",
          adminUsername: "system",
          targetType: "system",
          targetId: "health_probe",
          newValue: result.success
            ? `Health check recovery alert sent to ${recipients.join(", ")} (recovered: ${nowRecovered.join(", ")})`
            : `Health check recovery alert FAILED to ${recipients.join(", ")}: ${result.error ?? "unknown"} (recovered: ${nowRecovered.join(", ")})`,
        });
      } catch {
        /* best-effort */
      }
    } catch (err) {
      console.error(`[health-probe] failed to send recovery alert:`, err);
    }
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────
//
// Uses a self-rescheduling setTimeout (rather than setInterval) so the
// interval setting is re-read from app_settings after every cycle. An admin
// change to health_probe_interval_minutes takes effect at the start of the
// next scheduling cycle — no restart required.

let _probeTimeout: ReturnType<typeof setTimeout> | null = null;
let _probeRunning = false;

// Self-rescheduling scheduler. Checks _probeRunning at two points:
//  1. Before the async DB read (bail out if stopped before we even read).
//  2. After the async DB read (bail out if stopped while we were awaiting).
// This prevents a stale timeout being armed after stopHealthProbe() is called
// during the async interval-setting read.
async function _scheduleNextProbe(): Promise<void> {
  if (!_probeRunning) return;                    // guard: stopped before DB read
  const { minutes } = await loadMinutesSetting(
    HEALTH_PROBE_INTERVAL_SETTING_KEY,
    "HEALTH_PROBE_INTERVAL_MINUTES",
    PROBE_INTERVAL_MIN_MINUTES,
    PROBE_INTERVAL_MAX_MINUTES,
    PROBE_INTERVAL_DEFAULT_MINUTES,
  );
  if (!_probeRunning) return;                    // guard: stopped during DB read
  const intervalMs = minutes * 60 * 1000;
  _probeTimeout = setTimeout(async () => {
    if (!_probeRunning) return;
    await runHealthProbe().catch((err) =>
      console.error("[health-probe] unhandled error in runHealthProbe:", err),
    );
    void _scheduleNextProbe();
  }, intervalMs);
}

export function startHealthProbe(): void {
  if (_probeRunning) return;
  _probeRunning = true;
  log(
    `Health probe started (default interval ${PROBE_INTERVAL_DEFAULT_MINUTES} min; reads health_probe_interval_minutes from app_settings each cycle)`,
  );
  void _scheduleNextProbe();
}

export function stopHealthProbe(): void {
  _probeRunning = false;
  if (_probeTimeout) {
    clearTimeout(_probeTimeout);
    _probeTimeout = null;
  }
}
