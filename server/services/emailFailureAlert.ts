import { storage } from "../storage";
import { emailService } from "./EmailService";
import { getPublicAdminUrl } from "../lib/publicBaseUrl";
import {
  parseAdminAlertRecipients,
  ADMIN_ALERT_EMAIL_SETTING_KEY,
} from "../nda-integrity-sweep";

// ─── In-process rolling failure counter ──────────────────────────────────────
//
// Tracks timestamps of recent email send failures so the /health endpoint can
// surface a recentEmailFailures count without a DB query on every probe call.
// This is process-local — on autoscaled deployments each instance keeps its
// own tally. The /health response documents this limitation. If a cross-instance
// total is needed in the future, the storage.getRecentEmailFailures() DB query
// is the correct source of truth.

const _failureTimestamps: number[] = [];

/** Record a new email delivery failure at the current timestamp. */
export function recordEmailFailure(): void {
  _failureTimestamps.push(Date.now());
  // Prune entries older than 1 hour to keep the array small.
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (_failureTimestamps.length > 0 && _failureTimestamps[0] < cutoff) {
    _failureTimestamps.shift();
  }
}

/**
 * Count failures recorded within the last `windowMs` milliseconds.
 * Default: last 10 minutes (matching the /health spec).
 */
export function getRecentFailureCount(windowMs = 10 * 60 * 1000): number {
  const cutoff = Date.now() - windowMs;
  return _failureTimestamps.filter((t) => t >= cutoff).length;
}

/** Exposed for testing — reset the counter between test cases. */
export function _resetFailureCounter(): void {
  _failureTimestamps.length = 0;
}

// Throttled, fire-and-forget admin email alert when a transactional email
// fails to send. Task #150 — surface SMTP/credential outages within
// minutes rather than waiting for an admin to notice the per-row delivery
// badge on the Cases list.
//
// Throttle: at most one alert per cooldown window (default 60 min). The
// last-sent timestamp lives in app_settings so the throttle survives
// process restarts and is shared across autoscale instances. The cooldown
// itself is admin-tunable (Task #152) via env var or app_settings — read
// at dispatch time so changes take effect on the next failure.

export const EMAIL_FAILURE_ALERT_LAST_SENT_AT_SETTING_KEY =
  "email_failure_alert_last_sent_at";
export const EMAIL_FAILURE_ALERT_COOLDOWN_SETTING_KEY =
  "email_failure_alert_cooldown_minutes";
export const EMAIL_FAILURE_ALERT_COOLDOWN_DEFAULT_MINUTES = 60;
// Lower bound 1 minute — anything below means a sustained outage will
// page ops every minute, which is rarely useful and risks SMTP throttling.
export const EMAIL_FAILURE_ALERT_COOLDOWN_MIN_MINUTES = 1;
// Upper bound 24h — beyond that the alert stops being a useful control;
// admins should disable the recipient (clear ADMIN_ALERT_EMAIL) instead.
export const EMAIL_FAILURE_ALERT_COOLDOWN_MAX_MINUTES = 24 * 60;
export const EMAIL_FAILURE_ALERT_WINDOW_MS = 60 * 60 * 1000; // 1h lookback

// Back-compat: callers/tests that imported the old constant still get a
// sensible default value. The dispatcher itself no longer reads this —
// it resolves the cooldown dynamically from env > DB > default.
export const EMAIL_FAILURE_ALERT_COOLDOWN_MS =
  EMAIL_FAILURE_ALERT_COOLDOWN_DEFAULT_MINUTES * 60 * 1000;

function clampCooldownMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return EMAIL_FAILURE_ALERT_COOLDOWN_DEFAULT_MINUTES;
  }
  return Math.min(
    Math.max(minutes, EMAIL_FAILURE_ALERT_COOLDOWN_MIN_MINUTES),
    EMAIL_FAILURE_ALERT_COOLDOWN_MAX_MINUTES,
  );
}

function readEnvCooldownOverride(): number | null {
  const raw = Number.parseFloat(
    process.env.EMAIL_FAILURE_ALERT_COOLDOWN_MINUTES ?? "",
  );
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

async function loadCooldownFromStore(): Promise<{
  minutes: number;
  source: "env" | "db" | "default";
}> {
  const envOverride = readEnvCooldownOverride();
  if (envOverride !== null) {
    return { minutes: clampCooldownMinutes(envOverride), source: "env" };
  }
  try {
    const row = await storage.getAppSetting(
      EMAIL_FAILURE_ALERT_COOLDOWN_SETTING_KEY,
    );
    if (row) {
      const parsed = Number.parseFloat(row.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return { minutes: clampCooldownMinutes(parsed), source: "db" };
      }
    }
  } catch (err) {
    console.error(
      "Failed to read email-failure alert cooldown from DB:",
      err,
    );
  }
  return {
    minutes: EMAIL_FAILURE_ALERT_COOLDOWN_DEFAULT_MINUTES,
    source: "default",
  };
}

export interface EmailFailureAlertCooldownSetting {
  minutes: number;
  source: "env" | "db" | "default";
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: Date | null;
  updatedBy: string | null;
  lastSentAt: Date | null;
}

export async function readEmailFailureAlertCooldownSetting(): Promise<EmailFailureAlertCooldownSetting> {
  const { minutes, source } = await loadCooldownFromStore();
  let updatedAt: Date | null = null;
  let updatedBy: string | null = null;
  let lastSentAt: Date | null = null;
  try {
    const row = await storage.getAppSetting(
      EMAIL_FAILURE_ALERT_COOLDOWN_SETTING_KEY,
    );
    if (row) {
      updatedAt = row.updatedAt ?? null;
      updatedBy = row.updatedBy ?? null;
    }
  } catch (err) {
    console.error(
      "Failed to read email-failure alert cooldown metadata:",
      err,
    );
  }
  try {
    const lastRow = await storage.getAppSetting(
      EMAIL_FAILURE_ALERT_LAST_SENT_AT_SETTING_KEY,
    );
    if (lastRow?.value) {
      const parsed = new Date(lastRow.value);
      if (!Number.isNaN(parsed.getTime())) lastSentAt = parsed;
    }
  } catch {
    /* best-effort */
  }
  return {
    minutes,
    source,
    envOverride: source === "env",
    min: EMAIL_FAILURE_ALERT_COOLDOWN_MIN_MINUTES,
    max: EMAIL_FAILURE_ALERT_COOLDOWN_MAX_MINUTES,
    default: EMAIL_FAILURE_ALERT_COOLDOWN_DEFAULT_MINUTES,
    updatedAt,
    updatedBy,
    lastSentAt,
  };
}

export async function saveEmailFailureAlertCooldownMinutes(
  rawMinutes: number,
  updatedBy?: string | null,
  executor?: import("../db").DbExecutor,
): Promise<number> {
  if (!Number.isFinite(rawMinutes)) {
    throw new Error("Cooldown must be a finite number of minutes");
  }
  if (
    rawMinutes < EMAIL_FAILURE_ALERT_COOLDOWN_MIN_MINUTES ||
    rawMinutes > EMAIL_FAILURE_ALERT_COOLDOWN_MAX_MINUTES
  ) {
    throw new Error(
      `Cooldown must be between ${EMAIL_FAILURE_ALERT_COOLDOWN_MIN_MINUTES} and ${EMAIL_FAILURE_ALERT_COOLDOWN_MAX_MINUTES} minutes`,
    );
  }
  const minutes = clampCooldownMinutes(rawMinutes);
  await storage.setAppSetting(
    EMAIL_FAILURE_ALERT_COOLDOWN_SETTING_KEY,
    String(minutes),
    updatedBy ?? null,
    executor,
  );
  return minutes;
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
 * Called from sendCaseEmailWithAudit immediately after a failed send is
 * audit-logged. Never throws: a problem here must not break the original
 * caller (which already returned its own response to the user). All work
 * is wrapped in try/catch and best-effort.
 */
export async function maybeAlertOnEmailFailure(params: {
  caseId: string;
  tag: string;
  error: string | null | undefined;
}): Promise<void> {
  try {
    // Resolve the current cooldown at dispatch time so admin changes
    // take effect on the next failure without a redeploy.
    let cooldownMs = EMAIL_FAILURE_ALERT_COOLDOWN_MS;
    try {
      const { minutes } = await loadCooldownFromStore();
      cooldownMs = minutes * 60 * 1000;
    } catch {
      /* fall back to default cooldown */
    }

    // Throttle: read the last-sent timestamp and bail if we're inside
    // the cooldown window.
    let lastSentAt: Date | null = null;
    try {
      const row = await storage.getAppSetting(
        EMAIL_FAILURE_ALERT_LAST_SENT_AT_SETTING_KEY,
      );
      if (row?.value) {
        const parsed = new Date(row.value);
        if (!Number.isNaN(parsed.getTime())) lastSentAt = parsed;
      }
    } catch {
      // Reading the throttle row failed (DB blip) — proceed and try to
      // send; the worst case is one extra alert per outage which is far
      // better than silently swallowing the first failure.
    }
    if (lastSentAt && Date.now() - lastSentAt.getTime() < cooldownMs) {
      return;
    }

    const recipients = await resolveAdminAlertRecipients();
    if (recipients.length === 0) {
      // No recipient configured — leave a one-shot audit row per
      // failure so the in-dashboard banner is still actionable. We
      // don't gate this on the cooldown because there's no email
      // being sent that needs throttling.
      try {
        await storage.createAuditLog({
          action: "email_delivery_alert_skipped",
          targetType: "system",
          targetId: "email_delivery_alert",
          adminUsername: "system",
          newValue: `Email failure alert NOT sent: no admin recipient configured (set ADMIN_ALERT_EMAIL env var or app_settings.admin_alert_email). Failed tag: ${params.tag} on case ${params.caseId}.`,
        });
      } catch {
        /* best-effort */
      }
      return;
    }

    // Pull the full failure window so the email lists everything that
    // happened in the last hour, not just the single triggering failure.
    let failures: Awaited<ReturnType<typeof storage.getRecentEmailFailures>> =
      [];
    try {
      failures = await storage.getRecentEmailFailures(
        new Date(Date.now() - EMAIL_FAILURE_ALERT_WINDOW_MS),
      );
    } catch {
      // Fall back to a single-failure summary if the lookup fails so
      // the alert still goes out.
      failures = [
        {
          caseId: params.caseId,
          tag: params.tag,
          at: new Date().toISOString(),
          error: params.error ?? null,
          source: "audit",
        },
      ];
    }
    if (failures.length === 0) {
      // Triggering failure was already older than the window (extremely
      // unlikely race) — still include it so the alert is meaningful.
      failures = [
        {
          caseId: params.caseId,
          tag: params.tag,
          at: new Date().toISOString(),
          error: params.error ?? null,
          source: "audit",
        },
      ];
    }

    // Stamp the throttle BEFORE the SMTP call so concurrent failures
    // racing through this function can't all dispatch.
    try {
      await storage.setAppSetting(
        EMAIL_FAILURE_ALERT_LAST_SENT_AT_SETTING_KEY,
        new Date().toISOString(),
        "system",
      );
    } catch {
      /* best-effort */
    }

    let sendResult: { success: boolean; error?: string };
    try {
      sendResult = await emailService.sendCaseEmailFailureAlert({
        to: recipients,
        failures,
        dashboardUrl: getAdminDashboardUrl(),
      });
    } catch (err) {
      sendResult = {
        success: false,
        error: err instanceof Error ? err.message : "unexpected SMTP error",
      };
    }

    try {
      const uniqueCases = new Set(failures.map((f) => f.caseId)).size;
      await storage.createAuditLog({
        action: sendResult.success
          ? "email_delivery_alert_sent"
          : "email_delivery_alert_failed",
        targetType: "system",
        targetId: "email_delivery_alert",
        adminUsername: "system",
        newValue: sendResult.success
          ? `Email delivery failure alert sent to ${recipients.join(", ")} (${failures.length} failure(s) across ${uniqueCases} case(s) in the last hour; triggered by ${params.tag} on case ${params.caseId}).`
          : `Email delivery failure alert FAILED to ${recipients.join(", ")}: ${sendResult.error ?? "unknown"}. ${failures.length} failure(s) across ${uniqueCases} case(s); triggered by ${params.tag} on case ${params.caseId}.`,
      });
    } catch {
      /* best-effort */
    }
  } catch (err) {
    console.error("[emailFailureAlert] dispatcher crashed:", err);
  }
}
