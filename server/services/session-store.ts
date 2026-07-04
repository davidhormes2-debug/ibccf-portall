import crypto from "crypto";
import { storage } from "../storage";

// Portal session tokens — persisted in Postgres (see Task #123) so that
// every instance in an autoscaled deployment honours the same set of
// tokens. The shape returned here matches the legacy in-memory Session
// type so callers don't have to change.
interface Session {
  caseId: string;
  accessCode: string;
  createdAt: Date;
  expiresAt: Date;
  isMirror: boolean;
}

// 7 days — matches the client-side localStorage TTL in client/src/lib/portalSession.ts
// so a session never expires on the server while the client still considers it valid.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession(
  caseId: string,
  accessCode: string,
): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  await storage.createPortalSession({
    token,
    caseId,
    accessCode,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    isMirror: false,
  });
  return token;
}

// Mirror sessions are short-lived: the server-side expiry is pinned to the
// mirror token's own TTL so a captured or abandoned mirror URL cannot be
// used as a long-lived credential. The client stores the returned token in
// sessionStorage (not localStorage) so it also dies with the browser tab.
// isMirror=true is recorded in the DB so requirePortalSessionOnly can reject
// these sessions on consent-bearing routes (NDA sign, etc.) — an admin
// impersonation session must never be able to forge a user acknowledgement.
export async function createMirrorSession(
  caseId: string,
  accessCode: string,
  mirrorExpiresAt: Date,
): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await storage.createPortalSession({
    token,
    caseId,
    accessCode,
    expiresAt: mirrorExpiresAt,
    isMirror: true,
  });
  return token;
}

export async function validateSession(token: string): Promise<Session | null> {
  const row = await storage.getPortalSession(token);
  if (!row) return null;
  if (new Date() > row.expiresAt) {
    // Best-effort cleanup of the expired row. Don't await failures here:
    // the validation result is what matters to the caller.
    storage.deletePortalSession(token).catch(() => {});
    return null;
  }
  // Fire-and-forget: record that the token was actually used just now, so
  // admins can see "last active 2 minutes ago" instead of only "session
  // exists" (mirrors updateAdminSessionActivity for admin bearer tokens).
  // Never awaited/blocking and never allowed to fail the request.
  storage.updatePortalSessionActivity(token).catch(() => {});
  return {
    caseId: row.caseId,
    accessCode: row.accessCode,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    isMirror: row.isMirror ?? false,
  };
}

export async function deleteSession(token: string): Promise<void> {
  await storage.deletePortalSession(token);
}

// Force-logout: drop every portal session that belongs to a given case.
// Because the rows live in Postgres, this is effective on every instance,
// not just the one that processed the admin click. The portal also checks
// `cases.forceLogoutAt` on each data refresh as a belt-and-suspenders
// guard against any future endpoint that begins enforcing
// `validateSession` directly.
export async function deleteSessionsByCaseId(caseId: string): Promise<number> {
  return await storage.deletePortalSessionsByCaseId(caseId);
}

// Periodic cleanup of expired portal_sessions rows. Scheduled from
// server/index.ts at boot (see startPortalSessionCleanupSweep) so the
// cadence is predictable and does not depend on request traffic on any
// single autoscale instance. The previous in-process setInterval was
// removed in favour of this explicit boot-time scheduler; validate()
// still prunes individual expired rows on the fly as a safety net.
const PORTAL_SESSION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

let portalSessionSweepInFlight = false;
let portalSessionSweepStarted = false;

export async function runPortalSessionCleanup(): Promise<number> {
  if (portalSessionSweepInFlight) return 0;
  portalSessionSweepInFlight = true;
  try {
    return await storage.deleteExpiredPortalSessions();
  } catch (err) {
    console.error("Error sweeping expired portal sessions:", err);
    return 0;
  } finally {
    portalSessionSweepInFlight = false;
  }
}

export function startPortalSessionCleanupSweep(
  log: (message: string) => void = () => {},
): void {
  // Guard against accidental double scheduling (e.g. if startup logic
  // is re-entered in a dev/hot-reload-like flow). Without this an extra
  // setInterval would be registered each time, multiplying the sweep.
  if (portalSessionSweepStarted) return;
  portalSessionSweepStarted = true;

  const tick = () => {
    void runPortalSessionCleanup().then((removed) => {
      if (removed > 0) {
        log(`Deleted ${removed} expired portal session(s)`);
      }
    });
  };
  tick();
  // unref() so the timer never blocks process shutdown / test runners.
  setInterval(tick, PORTAL_SESSION_SWEEP_INTERVAL_MS).unref?.();
  log("Portal session cleanup started (checking every 24 hours)");
}
