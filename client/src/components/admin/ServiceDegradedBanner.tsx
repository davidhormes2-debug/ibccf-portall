import { useEffect, useState } from "react";
import { AlertTriangle, Activity, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServiceHealth, SERVICE_LABELS } from "@/hooks/useServiceHealth";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A session-scoped dismiss key so the banner re-appears if the set of
 * degraded services changes (e.g. a new service goes down after a dismiss).
 */
function dismissKey(services: string[]): string {
  return `svc-degraded-dismissed:${[...services].sort().join(",")}`;
}

function isDismissed(services: string[]): boolean {
  try {
    return sessionStorage.getItem(dismissKey(services)) === "1";
  } catch {
    return false;
  }
}

function setDismissed(services: string[]): void {
  try {
    sessionStorage.setItem(dismissKey(services), "1");
  } catch {
    /* ignore */
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  onViewHealth: () => void;
}

/**
 * Sticky banner shown at the top of the admin dashboard when any service
 * (DB / SMTP / AI) is currently degraded. Polls /health every 60 s so the
 * banner reflects the latest probe result without requiring a page reload.
 * Dismissible per session per set of degraded services.
 */
export function ServiceDegradedBanner({ onViewHealth }: Props) {
  const degraded = useServiceHealth();
  const [dismissed, setDismissedState] = useState(false);

  // Re-evaluate dismissed state whenever the degraded service set changes so
  // a new degradation after a dismiss causes the banner to reappear.
  useEffect(() => {
    if (degraded.length > 0) {
      setDismissedState(isDismissed(degraded));
    }
  }, [degraded]);

  if (degraded.length === 0 || dismissed) return null;

  const labels = degraded.map((k) => SERVICE_LABELS[k] ?? k).join(", ");

  const handleDismiss = () => {
    setDismissed(degraded);
    setDismissedState(true);
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-20 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-sm border-b border-red-500/40 bg-gradient-to-r from-red-900/70 via-red-900/60 to-red-900/70 text-red-100"
      data-testid="banner-service-degraded"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle
          className="h-4 w-4 flex-shrink-0 text-red-300 mt-0.5"
          aria-hidden
        />
        <span className="min-w-0">
          <span className="font-semibold">Service degradation detected: </span>
          <span data-testid="banner-service-degraded-services">{labels}</span>
          {degraded.length === 1 ? " is" : " are"} currently reporting errors.
          Check the Service Health panel for details.
        </span>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 border-red-300/50 bg-red-400/10 text-red-50 hover:bg-red-400/20 hover:text-white"
          onClick={onViewHealth}
          data-testid="button-service-degraded-view-health"
        >
          <Activity className="h-3.5 w-3.5 mr-1" />
          View Health
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-red-200/80 hover:text-white hover:bg-red-400/10"
          onClick={handleDismiss}
          aria-label="Dismiss service degradation notice"
          data-testid="button-service-degraded-dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
