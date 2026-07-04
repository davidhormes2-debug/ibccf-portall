/**
 * Client-side storage for the signed satisfaction-rating eligibility token
 * issued by `POST /api/visitors/end-session` (see server/lib/satisfactionToken.ts).
 *
 * Keeping this in `sessionStorage` (not `localStorage`) is intentional: the
 * token is only relevant for the current browser tab's chat session and
 * should not leak across tabs/devices or outlive the session.
 */

const STORAGE_PREFIX = "ibccf_sat_token";

function storageKey(visitorId: string, caseId: string): string {
  return `${STORAGE_PREFIX}:${visitorId}:${caseId}`;
}

/** Persist a satisfaction token for the given visitor + case. */
export function storeSatToken(visitorId: string, caseId: string, token: string): void {
  try {
    sessionStorage.setItem(storageKey(visitorId, caseId), token);
  } catch {
    // sessionStorage may be unavailable (private browsing, quota) — the
    // legacy DB-read fallback on the server still covers this case.
  }
}

/** Retrieve a previously stored satisfaction token, if any. */
export function getSatToken(visitorId: string, caseId: string): string | undefined {
  try {
    return sessionStorage.getItem(storageKey(visitorId, caseId)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Remove a stored satisfaction token (e.g. after it has been submitted). */
export function clearSatToken(visitorId: string, caseId: string): void {
  try {
    sessionStorage.removeItem(storageKey(visitorId, caseId));
  } catch {
    // no-op
  }
}
