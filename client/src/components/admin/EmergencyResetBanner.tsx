import { ShieldCheck, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EmergencyResetActivity } from "./AdminDashboardContext";

// One-time "emergency reset was used" banner (Task #2403). Since this flow
// can rewrite the admin's own credentials, surface it prominently the next
// time any admin logs in after a reset — not just buried in the audit
// trail. Dismissal is keyed to the event timestamp, same pattern as the
// email-delivery alert, so a NEWER reset re-shows the banner even after a
// previous one is acknowledged.
export function EmergencyResetBanner({
  emergencyResetActivity,
  dismissedEmergencyResetUsedAt,
  setDismissedEmergencyResetUsedAt,
  onViewDetails,
}: {
  emergencyResetActivity: EmergencyResetActivity;
  dismissedEmergencyResetUsedAt: string | null;
  setDismissedEmergencyResetUsedAt: (value: string) => void;
  onViewDetails: () => void;
}) {
  const lastUsedAt = emergencyResetActivity.lastUsedAt;
  if (!lastUsedAt) return null;
  if (dismissedEmergencyResetUsedAt === lastUsedAt) return null;
  const lastEvent = emergencyResetActivity.events.find(
    (e) => e.action === "admin_emergency_reset_used" && e.createdAt === lastUsedAt,
  );
  return (
    <div
      className="relative z-10 border-y border-red-500/40 bg-red-950/60 px-6 py-3 text-red-100"
      data-testid="banner-emergency-reset-used"
    >
      <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-red-300 shrink-0" />
        <div className="flex-1 min-w-[240px] text-sm">
          <div className="font-semibold">
            Admin credentials were reset via the emergency recovery link
          </div>
          <div className="mt-1 text-red-200/80 text-xs">
            {new Date(lastUsedAt).toLocaleString()}
            {lastEvent?.ipAddress ? ` from IP ${lastEvent.ipAddress}` : ""}
            {" "}— if this wasn't you, rotate the admin password immediately and review the recovery inbox.
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="bg-transparent border-red-400/50 text-red-100 hover:bg-red-900/50"
          onClick={onViewDetails}
          data-testid="button-view-emergency-reset-activity"
        >
          <Eye className="h-3.5 w-3.5 mr-1" />
          View details
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-red-200 hover:text-white hover:bg-red-900/40"
          onClick={() => setDismissedEmergencyResetUsedAt(lastUsedAt)}
          data-testid="button-dismiss-emergency-reset-banner"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
