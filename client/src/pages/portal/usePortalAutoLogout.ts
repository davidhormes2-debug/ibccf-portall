import { useEffect } from "react";

export interface PortalAutoLogoutWarning {
  warningAt: Date;
  minutesTotal: number;
}

/**
 * Context-level auto-logout when the portal-closure warning timer expires.
 *
 * This fires even when the user has dismissed the overlay
 * (warningDismissed = true), ensuring the force-logout cannot be escaped
 * by hiding the UI.
 *
 * @param activeWarning - Current warning state, or null when cleared.
 * @param onExpire      - Called once when the timer expires (or immediately
 *                        if the warning is already past its expiry time).
 *                        In PortalContext this shows a toast then calls logout().
 */
export function usePortalAutoLogout(
  activeWarning: PortalAutoLogoutWarning | null,
  onExpire: () => void,
): void {
  useEffect(() => {
    if (!activeWarning) return;
    const expiresAt =
      activeWarning.warningAt.getTime() + activeWarning.minutesTotal * 60 * 1000;
    const msUntilExpiry = expiresAt - Date.now();
    if (msUntilExpiry <= 0) {
      onExpire();
      return;
    }
    const id = setTimeout(onExpire, msUntilExpiry);
    return () => clearTimeout(id);
  // onExpire is intentionally omitted from deps — it is a stable inline arrow
  // constructed inside PortalContext on every render, so including it would
  // re-arm the timer on every render cycle. activeWarning is the only signal
  // that should trigger a new timer registration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWarning]);
}
