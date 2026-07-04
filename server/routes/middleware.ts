import type { Request, Response, NextFunction } from "express";
import type { AdminSession } from "@shared/types";
import { storage } from "../storage";
import { warnOnce } from "../lib/warnOnce";
import { resolveAdminRoleFromUsername } from "./adminPermissions";

// Normalize req.ip to the same shape we store in blocked_ips: strip the
// IPv6 "::ffff:" prefix so a v4 address blocked from the dashboard
// (where the rollup also strips it) actually matches incoming traffic.
export function normalizeIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  return ip.replace(/^::ffff:/, "");
}

// No-op kept for backward compat — admin.ts still calls this after block/
// unblock mutations. The cache was removed in favour of direct per-request
// DB lookups (see checkIpNotBlocked below), so there is no local state to
// clear.
export function invalidateBlockedIpsCache(): void {
  // intentional no-op
}

// Mounted in front of the case + declaration routers in server/routes.ts.
// Queries the DB directly on every request so all autoscale instances see
// the same denylist immediately after an admin blocks an IP — no per-process
// cache TTL window that a blocked attacker could exploit on other workers.
//
// Fail-CLOSED: if the blocklist lookup throws (DB outage, connection timeout,
// etc.) the middleware returns 403. Losing access to protected case routes
// for the duration of a DB blip is an acceptable, conservative trade-off
// compared to letting a blocked IP continue probing those endpoints.
export async function checkIpNotBlocked(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const ip = normalizeIp(req.ip ?? req.socket.remoteAddress ?? undefined);
  if (!ip) return next();
  try {
    const blocked = await storage.isIpBlocked(ip);
    if (blocked) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  } catch (err) {
    warnOnce(
      "checkIpNotBlocked:db-fail",
      "checkIpNotBlocked: blocklist lookup failed, failing closed:",
      err,
    );
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Internal helper: validates the bearer token and returns the session row if
 * it is active and unexpired.
 * Returns null on any failure. Callers are responsible for updating activity.
 *
 * Note on username validation: sessions are only ever created by the
 * server-side login handler, so any active/unexpired row in admin_sessions
 * belongs to a legitimately authenticated admin. We do NOT reject sessions
 * whose adminUsername differs from the env-var ADMIN_USERNAME because that
 * would prevent future sub-admin accounts (whose sessions carry their own
 * username) from being accepted. Role-based authorization is enforced
 * separately via `resolveAdminRoleFromUsername` + `requireAdminRole`.
 *
 * Legacy single-admin installs are unaffected: the env-var admin always
 * resolves to super_admin regardless of admin_users table content.
 */
async function getValidAdminSession(
  authHeader: string | undefined,
): Promise<AdminSession | null> {
  const token = extractBearer(authHeader);
  if (!token) return null;
  const session = await storage.getAdminSessionByToken(token);
  if (!session || !session.isActive || session.revokedAt) return null;
  if (session.expiresAt && session.expiresAt.getTime() < Date.now()) return null;
  return session;
}

export async function isValidAdminToken(
  authHeader: string | undefined,
): Promise<boolean> {
  const session = await getValidAdminSession(authHeader);
  if (!session) return false;
  storage.updateAdminSessionActivity(session.id).catch(() => {});
  return true;
}

export async function checkAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let session: AdminSession | null = null;
  try {
    session = await getValidAdminSession(req.headers.authorization);
  } catch {
    // Treat any unexpected error the same as an invalid token.
  }

  if (session) {
    // For sub-admin accounts (not the env-var admin), verify the account row
    // still exists and is active. A deleted or disabled sub-admin's bearer
    // token must not continue to grant access — this is the primary guard
    // against stale sessions after an account is revoked.
    const canonicalAdmin = (process.env.ADMIN_USERNAME ?? "").trim();
    if (canonicalAdmin && session.adminUsername !== canonicalAdmin) {
      try {
        const dbUser = await storage.getAdminUserByUsername(session.adminUsername);
        if (!dbUser || !dbUser.isActive) {
          // Revoke the stale session so it can't be reused and return 401.
          storage.revokeAdminSession(session.id, "Account disabled or deleted").catch(() => {});
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
      } catch {
        // On DB error, fail closed (deny) for sub-admin accounts.
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }
    // Attach the authenticated username so downstream handlers can use it
    // for audit logging without re-reading the session.
    req.adminUsername = session.adminUsername;
    // Resolve and attach the admin's role so downstream route handlers and
    // `requireAdminRole` middleware can read it without a second DB round-trip.
    try {
      req.adminRole = await resolveAdminRoleFromUsername(session.adminUsername);
    } catch {
      // Fail-safe: if role resolution throws, fall to least privilege so the
      // env-var admin can still reach the dashboard (their role is resolved
      // early-return in resolveAdminRoleFromUsername).
      req.adminRole = "viewer";
    }
    storage.updateAdminSessionActivity(session.id).catch(() => {});
    next();
    return;
  }

  if (req.method === "DELETE" && req.path.startsWith("/api/cases/")) {
    const caseId = req.path.split("/").pop();
    storage
      .createAuditLog({
        action: "delete_case_unauthorized",
        newValue: `Unauthorized deletion attempt for case: ${caseId}`,
        adminUsername: "Unknown",
        targetType: "case",
        targetId: caseId || undefined,
      })
      .catch(() => {});
  }
  res.status(401).json({ error: "Unauthorized" });
}
