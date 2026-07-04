import { Mail, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EmailDeliveryAlerts {
  windowMinutes: number;
  since: string;
  total: number;
  uniqueCaseCount: number;
  uniqueCaseIds: string[];
  latestAt: string | null;
  alertRecipientConfigured: boolean;
  lastAlertSentAt: string | null;
  alertCooldownMinutes: number;
  failures: Array<{
    caseId: string;
    tag: string;
    at: string;
    error: string | null;
    source: "audit" | "case_emails";
  }>;
}

// Transactional email delivery failure alert (Task #150). Surfaces as soon
// as any case has an email_*_failed audit row or a case_emails row with
// status='failed' in the last hour. Dismissal is keyed to the latest
// failure timestamp so a NEWER failure re-shows the banner automatically —
// operators can't permanently silence the warning by hitting X.
export function EmailDeliveryAlertBanner({
  emailDeliveryAlerts,
  dismissedEmailDeliveryAlertAt,
  setDismissedEmailDeliveryAlertAt,
  onRefresh,
  onOpenCase,
}: {
  emailDeliveryAlerts: EmailDeliveryAlerts | null;
  dismissedEmailDeliveryAlertAt: string | null;
  setDismissedEmailDeliveryAlertAt: (value: string | null) => void;
  onRefresh: () => void;
  onOpenCase: (caseId: string) => void;
}) {
  if (!emailDeliveryAlerts) return null;
  if (emailDeliveryAlerts.total === 0) return null;
  if (dismissedEmailDeliveryAlertAt === emailDeliveryAlerts.latestAt) return null;

  const ids = emailDeliveryAlerts.uniqueCaseIds;
  const previewIds = ids.slice(0, 5);
  const overflow = ids.length - previewIds.length;

  // Build an accurate "did the push-alert email actually fire?" line. Three
  // real states: (1) no recipient configured, (2) last alert inside the
  // cooldown -> "throttled", (3) last alert sent outside cooldown -> "sent".
  // Anything else reads as "alert email queued".
  let alertStatusText: string;
  if (!emailDeliveryAlerts.alertRecipientConfigured) {
    alertStatusText =
      "No tamper-alert recipient configured — set ADMIN_ALERT_EMAIL or app_settings.admin_alert_email so admins are emailed when this happens. The dashboard banner remains the only signal until then.";
  } else if (emailDeliveryAlerts.lastAlertSentAt) {
    const lastSent = new Date(emailDeliveryAlerts.lastAlertSentAt);
    const cooldownMs = emailDeliveryAlerts.alertCooldownMinutes * 60 * 1000;
    const insideCooldown = Date.now() - lastSent.getTime() < cooldownMs;
    alertStatusText = insideCooldown
      ? `Out-of-band alert email already sent at ${lastSent.toLocaleString()} (throttled to once per ${emailDeliveryAlerts.alertCooldownMinutes} minutes — new failures inside the cooldown stay on this banner).`
      : `Out-of-band alert email last sent at ${lastSent.toLocaleString()}; a new alert will be dispatched on the next failure.`;
  } else {
    alertStatusText =
      "An out-of-band alert email is dispatched (fire-and-forget) to the configured tamper-alert recipient on the first failure in each cooldown window.";
  }

  return (
    <div
      className="relative z-10 border-y border-amber-500/40 bg-amber-950/60 px-6 py-3 text-amber-100"
      data-testid="banner-email-delivery-failed"
    >
      <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3">
        <Mail className="h-5 w-5 text-amber-300 shrink-0" />
        <div className="flex-1 min-w-[240px] text-sm">
          <div className="font-semibold">
            {emailDeliveryAlerts.total} transactional email{emailDeliveryAlerts.total === 1 ? "" : "s"} failed in the last hour
            {" "}({emailDeliveryAlerts.uniqueCaseCount} case{emailDeliveryAlerts.uniqueCaseCount === 1 ? "" : "s"})
          </div>
          <div className="mt-1 text-amber-200/80 text-xs flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>Latest {emailDeliveryAlerts.latestAt ? new Date(emailDeliveryAlerts.latestAt).toLocaleString() : "—"} •</span>
            <span>Affected:</span>
            {previewIds.map((id, idx) => (
              <span key={id} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => onOpenCase(id)}
                  className="font-mono underline underline-offset-2 decoration-amber-300/60 hover:text-white hover:decoration-amber-100"
                  data-testid={`link-email-failed-case-${id}`}
                >
                  {id}
                </button>
                {idx < previewIds.length - 1 && <span>,</span>}
              </span>
            ))}
            {overflow > 0 && <span>+ {overflow} more</span>}
          </div>
          <div className="mt-1 text-amber-200/80 text-xs">{alertStatusText}</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="bg-transparent border-amber-400/50 text-amber-100 hover:bg-amber-900/50"
          onClick={onRefresh}
          data-testid="button-refresh-email-delivery-alerts"
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-amber-200 hover:text-white hover:bg-amber-900/40"
          onClick={() => setDismissedEmailDeliveryAlertAt(emailDeliveryAlerts.latestAt)}
          data-testid="button-dismiss-email-delivery-banner"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
