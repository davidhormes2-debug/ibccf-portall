// Task #2336 — Warn admins before rotating a code for a case with an active
// portal session. Extracted out of AdminDashboard.tsx to stay under the
// file's byte budget (see .agents/memory/admin-dashboard-size-budget.md).

export interface ActiveSessionInfo {
  hasActiveSession: boolean;
  lastActivityAt: string | null;
}

export async function checkHasActiveSession(
  caseId: string,
  authToken: string | null,
): Promise<ActiveSessionInfo> {
  try {
    const res = await fetch(`/api/cases/${caseId}/active-session`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return { hasActiveSession: false, lastActivityAt: null };
    const data = await res.json().catch(() => null);
    return {
      hasActiveSession: Boolean(data?.hasActiveSession),
      lastActivityAt: typeof data?.lastActivityAt === "string" ? data.lastActivityAt : null,
    };
  } catch {
    return { hasActiveSession: false, lastActivityAt: null };
  }
}

// Coarse "time ago" phrase for the admin-only rotate-code confirm dialog.
// Deliberately simple (English-only, admin surfaces stay English per
// replit.md) rather than pulling in the full i18n useFormat() machinery for
// a single plain-text window.confirm() string.
export function formatLastActiveAgo(lastActivityAt: string | null): string | null {
  if (!lastActivityAt) return null;
  const then = new Date(lastActivityAt).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function buildRotateAccessCodeConfirmMessage(
  userLabel: string,
  session: ActiveSessionInfo,
): string {
  if (!session.hasActiveSession) {
    return `Rotate code for ${userLabel}? Old code stops working; sessions signed out.`;
  }
  const lastActiveAgo = formatLastActiveAgo(session.lastActivityAt);
  const activitySuffix = lastActiveAgo ? ` (last active ${lastActiveAgo})` : "";
  return `Rotate code for ${userLabel}? This user is currently active in the portal${activitySuffix} — rotating will log them out immediately and the old code will stop working.`;
}

// Task #2354 — same warn-before-disrupting pattern as rotate-access-code,
// reused for the other admin actions that force-drop a case's active
// portal session (toggle-access lock, reset-pin).
// Task #2383 — also surface the "(last active X ago)" detail here, matching
// buildRotateAccessCodeConfirmMessage, since locking is at least as
// disruptive (it acts immediately rather than on next request).
export function buildLockAccountConfirmMessage(
  userLabel: string,
  session: ActiveSessionInfo,
): string {
  if (!session.hasActiveSession) {
    return `Lock portal access for ${userLabel}? They will not be able to log in until you unlock them.`;
  }
  const lastActiveAgo = formatLastActiveAgo(session.lastActivityAt);
  const activitySuffix = lastActiveAgo ? ` (last active ${lastActiveAgo})` : "";
  return `Lock portal access for ${userLabel}? This user is currently active in the portal${activitySuffix} — locking will sign them out immediately and they will not be able to log in until you unlock them.`;
}

// Task #2383 — force-logout is the most immediately disruptive of these
// actions (it drops the session with no further user action required), so
// it gets the same "(last active X ago)" detail as rotate-code and lock.
export function buildForceLogoutConfirmMessage(
  userLabel: string,
  session: ActiveSessionInfo,
): string {
  if (!session.hasActiveSession) {
    return `Sign out ${userLabel} from the user portal? They will need to log in again.`;
  }
  const lastActiveAgo = formatLastActiveAgo(session.lastActivityAt);
  const activitySuffix = lastActiveAgo ? ` (last active ${lastActiveAgo})` : "";
  return `Sign out ${userLabel} from the user portal? This user is currently active in the portal${activitySuffix} — they will need to log in again.`;
}

// Task #2410 — same "(last active X ago)" detail as rotate-code/lock/
// force-logout, since resetting a PIN also force-drops an active session.
export function buildResetPinConfirmMessage(
  userLabel: string,
  session: ActiveSessionInfo,
): string {
  if (!session.hasActiveSession) {
    return `Reset PIN for ${userLabel}? They will need to set a new PIN on next login.`;
  }
  const lastActiveAgo = formatLastActiveAgo(session.lastActivityAt);
  const activitySuffix = lastActiveAgo ? ` (last active ${lastActiveAgo})` : "";
  return `Reset PIN for ${userLabel}? This user is currently active in the portal${activitySuffix} — resetting will log them out immediately and they will need to set a new PIN on next login.`;
}

// Task #2387 — pathway reset via the Portal Closure Warning panel
// (Override Countdown / Skip to Reactivation) disables the account and
// force-drops sessions just like lock/reset-pin/force-logout, so it gets
// the same "currently active" warning with the "(last active X ago)" detail.
export function buildOverrideCountdownConfirmMessage(
  userLabel: string,
  session: ActiveSessionInfo,
): string {
  if (!session.hasActiveSession) {
    return `Override the countdown for ${userLabel}? This ends the countdown immediately, locks the account, and resets their withdrawal pathway.`;
  }
  const lastActiveAgo = formatLastActiveAgo(session.lastActivityAt);
  const activitySuffix = lastActiveAgo ? ` (last active ${lastActiveAgo})` : "";
  return `Override the countdown for ${userLabel}? This user is currently active in the portal${activitySuffix} — overriding will end the countdown immediately, sign them out, lock the account, and reset their withdrawal pathway.`;
}

export function buildSkipToReactivationConfirmMessage(
  userLabel: string,
  session: ActiveSessionInfo,
): string {
  if (!session.hasActiveSession) {
    return `Skip ${userLabel} straight to reactivation? This immediately locks the account and resets their withdrawal pathway — no countdown required.`;
  }
  const lastActiveAgo = formatLastActiveAgo(session.lastActivityAt);
  const activitySuffix = lastActiveAgo ? ` (last active ${lastActiveAgo})` : "";
  return `Skip ${userLabel} straight to reactivation? This user is currently active in the portal${activitySuffix} — this will sign them out immediately, lock the account, and reset their withdrawal pathway.`;
}

export async function postAccessCodeAction(
  caseId: string,
  authToken: string | null,
  path: string,
  failTitle: string,
  onFail: (title: string, description: string) => void,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`/api/cases/${caseId}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data: Record<string, unknown> = await res.json().catch(() => ({}));
  if (!res.ok) {
    onFail(failTitle, typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
    return null;
  }
  return data;
}
