import { storage } from "../storage";
import { emailService } from "./EmailService";
import { getPublicAdminUrl } from "../lib/publicBaseUrl";
import {
  parseAdminAlertRecipients,
  ADMIN_ALERT_EMAIL_SETTING_KEY,
} from "../nda-integrity-sweep";

// Throttled, fire-and-forget admin email alert when a user uploads a supporting
// document. Task #274 — prevent alert fatigue when a user uploads several
// documents in quick succession.
//
// Throttle: at most one alert per case per cooldown window (default 30 min).
// The last-sent timestamp lives in app_settings keyed by case id so the
// throttle survives process restarts and is shared across autoscale instances.
// The global cooldown is tunable via the doc_upload_alert_cooldown_minutes
// app_settings key.

export const DOC_UPLOAD_ALERT_COOLDOWN_SETTING_KEY =
  "doc_upload_alert_cooldown_minutes";
export const DOC_UPLOAD_ALERT_COOLDOWN_DEFAULT_MINUTES = 30;
export const DOC_UPLOAD_ALERT_COOLDOWN_MIN_MINUTES = 1;
export const DOC_UPLOAD_ALERT_COOLDOWN_MAX_MINUTES = 24 * 60;

/** Returns the app_settings key for the per-case last-sent timestamp. */
export function docUploadAlertLastSentKey(caseId: string): string {
  return `doc_upload_alert_last_sent_at:${caseId}`;
}

// Task #379 — per-case mute. When the value of this app_settings key is the
// string "true", the dispatcher silently skips alerts for that case entirely
// (no SMTP send, no audit row, no throttle stamp change). Unmuting writes
// "false" so the key always tells the truth at a glance without a delete.
export const DOC_UPLOAD_ALERT_MUTE_KEY_PREFIX = "doc_upload_alert_muted:";

export function docUploadAlertMuteKey(caseId: string): string {
  return `${DOC_UPLOAD_ALERT_MUTE_KEY_PREFIX}${caseId}`;
}

export interface DocUploadAlertMuteState {
  caseId: string;
  muted: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function getDocUploadAlertMuteState(
  caseId: string,
): Promise<DocUploadAlertMuteState> {
  try {
    const row = await storage.getAppSetting(docUploadAlertMuteKey(caseId));
    return {
      caseId,
      muted: row?.value === "true",
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  } catch (err) {
    console.error("Failed to read doc upload alert mute state:", err);
    return { caseId, muted: false, updatedAt: null, updatedBy: null };
  }
}

export async function isDocUploadAlertMuted(caseId: string): Promise<boolean> {
  const state = await getDocUploadAlertMuteState(caseId);
  return state.muted;
}

export async function setDocUploadAlertMuted(
  caseId: string,
  muted: boolean,
  updatedBy?: string | null,
  executor?: import("../db").DbExecutor,
): Promise<DocUploadAlertMuteState> {
  const row = await storage.setAppSetting(
    docUploadAlertMuteKey(caseId),
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

export async function listMutedDocUploadAlertCaseIds(): Promise<string[]> {
  try {
    const { db } = await import("../db");
    const { appSettings } = await import("@shared/schema");
    const { like, eq, and } = await import("drizzle-orm");
    const rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(
        and(
          like(appSettings.key, `${DOC_UPLOAD_ALERT_MUTE_KEY_PREFIX}%`),
          eq(appSettings.value, "true"),
        ),
      );
    return rows
      .map((r) => r.key.slice(DOC_UPLOAD_ALERT_MUTE_KEY_PREFIX.length))
      .filter((id) => id.length > 0);
  } catch (err) {
    console.error("Failed to list muted doc upload alert cases:", err);
    return [];
  }
}

function clampCooldownMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return DOC_UPLOAD_ALERT_COOLDOWN_DEFAULT_MINUTES;
  }
  return Math.min(
    Math.max(minutes, DOC_UPLOAD_ALERT_COOLDOWN_MIN_MINUTES),
    DOC_UPLOAD_ALERT_COOLDOWN_MAX_MINUTES,
  );
}

function readEnvCooldownOverride(): number | null {
  const raw = Number.parseFloat(
    process.env.DOC_UPLOAD_ALERT_COOLDOWN_MINUTES ?? "",
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
      DOC_UPLOAD_ALERT_COOLDOWN_SETTING_KEY,
    );
    if (row?.value) {
      const parsed = Number.parseFloat(row.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return { minutes: clampCooldownMinutes(parsed), source: "db" };
      }
    }
  } catch (err) {
    console.error(
      "Failed to read document upload alert cooldown from DB:",
      err,
    );
  }
  return {
    minutes: DOC_UPLOAD_ALERT_COOLDOWN_DEFAULT_MINUTES,
    source: "default",
  };
}

async function loadCooldownMinutes(): Promise<number> {
  const { minutes } = await loadCooldownFromStore();
  return minutes;
}

export interface DocUploadAlertCooldownSetting {
  minutes: number;
  source: "env" | "db" | "default";
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function readDocUploadAlertCooldownSetting(): Promise<DocUploadAlertCooldownSetting> {
  const { minutes, source } = await loadCooldownFromStore();
  let updatedAt: Date | null = null;
  let updatedBy: string | null = null;
  try {
    const row = await storage.getAppSetting(
      DOC_UPLOAD_ALERT_COOLDOWN_SETTING_KEY,
    );
    if (row) {
      updatedAt = row.updatedAt ?? null;
      updatedBy = row.updatedBy ?? null;
    }
  } catch (err) {
    console.error(
      "Failed to read document upload alert cooldown metadata:",
      err,
    );
  }
  return {
    minutes,
    source,
    envOverride: source === "env",
    min: DOC_UPLOAD_ALERT_COOLDOWN_MIN_MINUTES,
    max: DOC_UPLOAD_ALERT_COOLDOWN_MAX_MINUTES,
    default: DOC_UPLOAD_ALERT_COOLDOWN_DEFAULT_MINUTES,
    updatedAt,
    updatedBy,
  };
}

export async function saveDocUploadAlertCooldownMinutes(
  rawMinutes: number,
  updatedBy?: string | null,
  executor?: import("../db").DbExecutor,
): Promise<number> {
  if (!Number.isFinite(rawMinutes)) {
    throw new Error("Cooldown must be a finite number of minutes");
  }
  if (
    rawMinutes < DOC_UPLOAD_ALERT_COOLDOWN_MIN_MINUTES ||
    rawMinutes > DOC_UPLOAD_ALERT_COOLDOWN_MAX_MINUTES
  ) {
    throw new Error(
      `Cooldown must be between ${DOC_UPLOAD_ALERT_COOLDOWN_MIN_MINUTES} and ${DOC_UPLOAD_ALERT_COOLDOWN_MAX_MINUTES} minutes`,
    );
  }
  const minutes = clampCooldownMinutes(rawMinutes);
  await storage.setAppSetting(
    DOC_UPLOAD_ALERT_COOLDOWN_SETTING_KEY,
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
 * Called from the fire-and-forget block in POST /api/cases/:id/user-documents.
 * Never throws: a problem here must not break the original caller. All work
 * is wrapped in try/catch and best-effort.
 *
 * Throttle: if an alert was already sent for this case within the configured
 * cooldown window, the send is silently skipped. The cooldown is global
 * (doc_upload_alert_cooldown_minutes in app_settings, default 30 min) and the
 * per-case last-sent timestamp is stored at doc_upload_alert_last_sent_at:<caseId>.
 */
export async function maybeAlertOnDocumentUpload(params: {
  caseId: string;
  docId: number;
  documentType: string;
  fileName: string;
}): Promise<void> {
  try {
    // Task #379 — per-case mute. Silently skip the entire pipeline (no SMTP,
    // no audit row, no throttle stamp update) so a noisy KYC remediation
    // round doesn't bury admins until they unmute it.
    if (await isDocUploadAlertMuted(params.caseId)) {
      return;
    }

    const cooldownMinutes = await loadCooldownMinutes();
    const cooldownMs = cooldownMinutes * 60 * 1000;

    const lastSentKey = docUploadAlertLastSentKey(params.caseId);

    let lastSentAt: Date | null = null;
    try {
      const row = await storage.getAppSetting(lastSentKey);
      if (row?.value) {
        const parsed = new Date(row.value);
        if (!Number.isNaN(parsed.getTime())) lastSentAt = parsed;
      }
    } catch {
      // DB blip — proceed; worst case is one extra alert per case, far better
      // than swallowing the alert entirely.
    }

    if (lastSentAt && Date.now() - lastSentAt.getTime() < cooldownMs) {
      return;
    }

    const recipients = await resolveAdminAlertRecipients();
    if (recipients.length === 0) return;

    // Stamp the throttle BEFORE the SMTP call so concurrent uploads racing
    // through this function cannot all dispatch.
    try {
      await storage.setAppSetting(lastSentKey, new Date().toISOString(), "system");
    } catch {
      /* best-effort */
    }

    let sendError: string | null = null;
    try {
      const result = await emailService.sendUserDocumentUploadedAlert({
        to: recipients,
        caseId: params.caseId,
        documentType: params.documentType,
        fileName: params.fileName,
        dashboardUrl: getAdminDashboardUrl(),
      });
      // emailService.send() catches SMTP errors and returns
      // { success: false, error } rather than throwing, so we must inspect
      // the returned result — not just rely on a thrown exception.
      if (result && (result as { success?: boolean }).success === false) {
        sendError =
          (result as { error?: string }).error ?? "unknown SMTP error";
        console.error(
          "[documentUploadAlert] SMTP send failed:",
          sendError,
        );
      }
    } catch (e) {
      sendError = e instanceof Error ? e.message : "unexpected SMTP error";
      console.error("[documentUploadAlert] SMTP send threw:", e);
    }

    try {
      await storage.createAuditLog({
        action: sendError
          ? "email_user_document_uploaded_alert_failed"
          : "email_user_document_uploaded_alert",
        newValue: sendError
          ? `Admin alert FAILED to ${recipients.join(", ")} for document upload "${params.documentType}" (#${params.docId}): ${sendError}. Throttle key retained — next upload within the cooldown window will remain suppressed.`
          : `Admin alert sent to ${recipients.join(", ")} for document upload "${params.documentType}" (#${params.docId})`,
        adminUsername: "system",
        targetType: "case",
        targetId: params.caseId,
      });
    } catch {
      /* best-effort */
    }
  } catch (err) {
    console.error("[documentUploadAlert] dispatcher crashed:", err);
  }
}
