/**
 * Admin Role-Based Access Control (RBAC)
 *
 * Defines the role hierarchy, role resolution from a bearer token, and the
 * `requireAdminRole` middleware factory used to gate individual routes.
 *
 * Role hierarchy (lowest → highest privilege):
 *   viewer < agent < admin < super_admin
 *
 * `requireAdminRole('admin')` means: the caller must have at least the `admin`
 * role — i.e. `admin` OR `super_admin`. Because permission checks are
 * hierarchical, explicitly listing both "admin" and "super_admin" or just
 * "admin" produces the same result.
 *
 * Backward compatibility: the legacy env-var admin (ADMIN_USERNAME) is always
 * treated as `super_admin`, so existing single-admin deployments are unaffected.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { AdminRole } from "@shared/types";
import { db } from "../db";
import { adminUsers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { warnOnce } from "../lib/warnOnce";

// Augment the Express Request interface so downstream handlers can read
// `req.adminRole` as a typed value after `checkAdminAuth` runs.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminRole?: AdminRole;
      adminUsername?: string;
    }
  }
}

// Ordered from lowest to highest privilege. A user at position N is also
// considered to satisfy any check that requires positions 0..N-1.
export const ROLE_HIERARCHY: readonly AdminRole[] = [
  "viewer",
  "agent",
  "admin",
  "super_admin",
];

/**
 * Resolve the AdminRole for a given admin username.
 *
 * Resolution order:
 *  1. If the username matches the legacy env-var admin (ADMIN_USERNAME) →
 *     always `super_admin` for backward compat.
 *  2. Look up the `admin_users` table and return the stored `role`.
 *  3. Fall back to `super_admin` if the user exists but has an unrecognised
 *     role string, or if the DB lookup fails (fail-open to preserve access
 *     for a misconfigured installation — the real defence is auth, not RBAC).
 */
export async function resolveAdminRoleFromUsername(
  username: string,
): Promise<AdminRole> {
  const canonicalUsername = (process.env.ADMIN_USERNAME ?? "").trim();
  if (canonicalUsername && username === canonicalUsername) {
    return "super_admin";
  }
  try {
    const rows = await db
      .select({ role: adminUsers.role })
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1);
    const role = rows[0]?.role as AdminRole | undefined;
    if (role && ROLE_HIERARCHY.includes(role)) {
      return role;
    }
    // Row was found but has an unrecognised role string — fail to least
    // privilege so a misconfigured row cannot silently become super_admin.
    if (rows.length > 0) {
      return "viewer";
    }
    // No row found for this username and it is not the env-var admin.
    // Returning "viewer" (least privilege) rather than "super_admin" prevents
    // a deleted sub-admin's session from escalating to full admin rights.
    return "viewer";
  } catch (err) {
    warnOnce(
      "adminPermissions:role-lookup-failed",
      "[adminPermissions] Failed to look up role for sub-admin, defaulting to viewer:",
      err,
    );
    // Fail to least privilege on DB error for unknown sub-admin accounts.
    return "viewer";
  }
}

/**
 * Returns true when `userRole` meets or exceeds the privilege level of
 * `minimumRole` in the hierarchy.
 */
export function roleAtLeast(userRole: AdminRole, minimumRole: AdminRole): boolean {
  const userIdx = ROLE_HIERARCHY.indexOf(userRole);
  const minIdx = ROLE_HIERARCHY.indexOf(minimumRole);
  if (userIdx === -1 || minIdx === -1) return false;
  return userIdx >= minIdx;
}

/**
 * Middleware factory.  Place **after** `checkAdminAuth` in the middleware chain.
 *
 * `requireAdminRole('admin')` → admin or super_admin may proceed; viewer and
 * agent receive 403.
 *
 * When multiple roles are supplied the effective minimum is the lowest-ranked
 * role in the list (i.e. a viewer can call a route gated with
 * `requireAdminRole('viewer', 'agent')` because viewer is lower-ranked than
 * agent — effectively any authenticated admin passes). Prefer the single-arg
 * form for clarity: `requireAdminRole('viewer')` === "any authenticated admin".
 */
export function requireAdminRole(...allowedRoles: [AdminRole, ...AdminRole[]]): RequestHandler {
  const minIdx = Math.min(
    ...allowedRoles.map((r) => ROLE_HIERARCHY.indexOf(r)),
  );
  const minimumRole = ROLE_HIERARCHY[minIdx] ?? "super_admin";

  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole: AdminRole = req.adminRole ?? "viewer";
    if (roleAtLeast(userRole, minimumRole as AdminRole)) {
      next();
      return;
    }
    res.status(403).json({
      error: `Forbidden: requires at least '${minimumRole}' role`,
    });
  };
}
