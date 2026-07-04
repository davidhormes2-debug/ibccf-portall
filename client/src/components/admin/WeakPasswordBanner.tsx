import { useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type WeakPasswordBannerFlags = {
  weakPassword: boolean;
} | null;

export const WEAK_PASSWORD_DISMISSED_KEY =
  "ibccf.admin.dismissedWeakPasswordWarning";

interface Props {
  flags: WeakPasswordBannerFlags;
  onGoToSettings?: () => void;
}

export function WeakPasswordBanner({ flags, onGoToSettings }: Props) {
  const [dismissed, setDismissedState] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(WEAK_PASSWORD_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const setDismissed = (value: boolean) => {
    setDismissedState(value);
    try {
      if (value) sessionStorage.setItem(WEAK_PASSWORD_DISMISSED_KEY, "1");
      else sessionStorage.removeItem(WEAK_PASSWORD_DISMISSED_KEY);
    } catch {
      /* sessionStorage may be unavailable; in-memory dismissal still works */
    }
  };

  if (!flags?.weakPassword || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="relative z-20 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-sm border-b border-amber-500/40 bg-gradient-to-r from-amber-900/60 via-amber-900/50 to-amber-900/60 text-amber-100"
      data-testid="banner-weak-password"
    >
      <div className="flex items-center gap-2 min-w-0">
        <ShieldAlert className="h-4 w-4 flex-shrink-0 text-amber-300" />
        <span className="truncate">
          <span className="font-semibold">Security warning:</span>{" "}
          your current admin password is rated{" "}
          <span className="font-semibold">Weak</span> — it contains a common
          keyboard sequence, blocklisted pattern, or is too short.{" "}
          {onGoToSettings ? (
            <button
              type="button"
              onClick={onGoToSettings}
              className="font-semibold underline underline-offset-2 decoration-amber-300/60 hover:decoration-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-300 cursor-pointer"
              data-testid="link-go-to-change-password"
            >
              Go to Settings → Change Password
            </button>
          ) : (
            <span className="font-semibold">Go to Settings → Change Password</span>
          )}{" "}
          to update it.
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 flex-shrink-0 text-amber-200/80 hover:text-white hover:bg-amber-400/10"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss weak password warning"
        data-testid="button-dismiss-weak-password-banner"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
