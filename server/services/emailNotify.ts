import { storage } from "../storage";
import { normalizeLocale, type ServerLocale } from "./i18n";
import { maybeAlertOnEmailFailure, recordEmailFailure } from "./emailFailureAlert";
import { warnOnce } from "../lib/warnOnce";

/**
 * Best-effort send + audit wrapper for transactional case emails.
 *
 * Centralises four rules every trigger site needs:
 *   1. If the case has no email on file we silently skip — no throw.
 *   2. Send is wrapped so an SMTP outage never breaks the user-facing flow.
 *   3. Every attempt (success OR failure) is audit-logged with a uniform
 *      `email_<tag>` / `email_<tag>_failed` action so admins can see exactly
 *      which notifications fired against which case.
 *   4. The recipient's preferred locale (persisted on `cases.preferred_locale`)
 *      is resolved here once and handed to the `send` callback so every
 *      transactional email is rendered in the recipient's language —
 *      regardless of whether the trigger came from the user's browser or
 *      from an admin acting on their behalf. The optional `localeOverride`
 *      param lets a caller force a specific locale (e.g. anonymous flows
 *      where the request itself is the source of truth).
 */
export async function sendCaseEmailWithAudit(params: {
  to: string | null | undefined;
  caseId: string;
  tag: string;
  adminUser?: string;
  localeOverride?: string | null;
  /**
   * Optional structured metadata persisted on the audit row. The
   * `email_*` retry handler (Task #158) uses these as stable foreign
   * keys to re-load the exact source record (e.g. the specific
   * declaration submission / admin message / document request /
   * deposit receipt) so a retry resends the *original* content even if
   * newer rows of the same kind have been added to the case since.
   */
  metadata?: Record<string, unknown> | null;
  /**
   * The send callback receives the resolved recipient locale. New callers
   * SHOULD accept it and forward it to `emailService.sendLocalizedCaseEmail`;
   * legacy callers that ignore the argument continue to work (they simply
   * won't honour the recipient's language preference).
   */
  send: (locale: ServerLocale) => Promise<{ success: boolean; error?: string }>;
}): Promise<{ sent: boolean; error?: string; auditFailed?: true }> {
  const { to, caseId, tag, send, metadata } = params;
  const adminUser = params.adminUser ?? "system";

  if (!to || !to.trim()) {
    return { sent: false, error: "no email on file" };
  }

  const locale = await resolveRecipientLocale(caseId, params.localeOverride);

  let result: { success: boolean; error?: string };
  try {
    result = await send(locale);
  } catch (err) {
    result = {
      success: false,
      error: err instanceof Error ? err.message : "unexpected SMTP error",
    };
  }

  let auditFailed: true | undefined;
  try {
    await storage.createAuditLog({
      action: result.success ? `email_${tag}` : `email_${tag}_failed`,
      newValue: result.success
        ? `Email sent (${tag}, ${locale}) to ${to}`
        : `Email send failed (${tag}, ${locale}) to ${to}: ${result.error ?? "unknown"}`,
      adminUsername: adminUser,
      targetType: "case",
      targetId: caseId,
      metadata: metadata ?? null,
    });
  } catch (logErr) {
    auditFailed = true;
    warnOnce(`emailNotify:audit-log-failed:${tag}`, `[emailNotify] audit log failed for ${tag}:`, logErr);
  }

  // Fire-and-forget push-style alert (Task #150): when a transactional
  // send fails, notify the configured tamper-alert recipient out-of-band
  // (throttled). Must never block or throw — the original caller has
  // already returned its response to the user.
  if (!result.success) {
    recordEmailFailure();
    void maybeAlertOnEmailFailure({
      caseId,
      tag,
      error: result.error ?? null,
    });
  }

  return { sent: result.success, error: result.error, ...(auditFailed && { auditFailed }) };
}

/**
 * Resolve the recipient's preferred locale for transactional sends:
 *   1. Explicit override wins (e.g. anonymous reactivation flow).
 *   2. Otherwise read `cases.preferred_locale` (set by the portal on
 *      access + on every language switch).
 *   3. Fall back to English so a missing column / lookup never blocks send.
 *
 * Lookup failures are swallowed — email delivery must never depend on a
 * locale row being readable.
 */
export async function resolveRecipientLocale(
  caseId: string,
  override?: string | null,
): Promise<ServerLocale> {
  if (override) return normalizeLocale(override);
  try {
    const row = await storage.getCaseById(caseId);
    return normalizeLocale(row?.preferredLocale ?? null);
  } catch {
    return normalizeLocale(null);
  }
}
