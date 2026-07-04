import type { Request, Response, NextFunction } from "express";
import { isValidAdminToken } from "../routes/middleware";
import { validateSession } from "./session-store";
import { db } from "../db";
import { cases } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * After the in-memory session lookup succeeds, perform a lightweight DB check
 * to enforce revocation signals that must be respected across all instances:
 *
 *   - cases.isDisabled      → account locked by admin
 *   - cases.forceLogoutAt   → admin forced a logout after the session was created
 *   - cases.accessCode      → credential was rotated (key-reissue or reactivation);
 *                             the session's stored code no longer matches
 *
 * Without this check, revocation is only effective on the single instance that
 * received the admin action (deleteSessionsByCaseId clears only local memory).
 * Any other instance in an autoscaled deployment would continue to honour the
 * old session token until the 24-hour TTL expired.
 *
 * Returns true when the case record confirms the session is still valid.
 */
async function isCaseSessionRevoked(
  caseId: string,
  sessionAccessCode: string,
  sessionCreatedAt: Date,
): Promise<boolean> {
  try {
    const [row] = await db
      .select({
        isDisabled: cases.isDisabled,
        forceLogoutAt: cases.forceLogoutAt,
        accessCode: cases.accessCode,
      })
      .from(cases)
      .where(eq(cases.id, caseId));

    if (!row) return true; // case deleted — treat as revoked

    // Account locked
    if (row.isDisabled) return true;

    // Admin forced logout after this session was issued
    // strict-equality-guard: must stay > (strictly after) — using >= would
    // revoke sessions created in the exact same millisecond as forceLogoutAt;
    // any loose or widened comparison could silently invalidate sessions that
    // pre-date the admin action or fail to revoke those that should be rejected.
    if (row.forceLogoutAt && new Date(row.forceLogoutAt) > sessionCreatedAt) {
      return true;
    }

    // Access code was rotated (key-reissue approved, reactivation, etc.)
    // strict-inequality-guard: must stay !== (not !=) — loose inequality would
    // coerce types and could let a rotated code still satisfy the revocation
    // check, allowing a stale session to remain valid after key rotation.
    if (row.accessCode !== sessionAccessCode) return true;

    return false;
  } catch {
    // On DB error, fail closed: treat as revoked rather than granting access.
    return true;
  }
}

/**
 * Validate a portal session token and enforce DB-backed revocation signals.
 *
 * Combines `validateSession` (TTL check) with `isCaseSessionRevoked`
 * (account lock, force-logout, and credential rotation). Returns the session
 * object when it is fully valid, or null when the token is missing, expired,
 * or has been administratively revoked.
 *
 * Use this instead of calling `validateSession` directly from any route that
 * should respect admin-initiated revocation (force-logout, account lock, key
 * rotation). Community routes, for example, must call this so that a revoked
 * portal session cannot continue to read or publish community content.
 */
export async function validatePortalSession(
  token: string,
): Promise<{ caseId: string; accessCode: string; createdAt: Date; expiresAt: Date } | null> {
  const session = await validateSession(token);
  if (!session) return null;
  const revoked = await isCaseSessionRevoked(
    session.caseId,
    session.accessCode,
    session.createdAt,
  );
  if (revoked) return null;
  return session;
}

export async function isAuthorizedForCase(
  req: Request,
  caseId: string,
): Promise<boolean> {
  if (await isValidAdminToken(req.headers.authorization)) return true;
  const portalToken = req.headers["x-portal-session-token"];
  const tokenStr = Array.isArray(portalToken) ? portalToken[0] : portalToken;
  if (typeof tokenStr !== "string" || tokenStr.length === 0) return false;
  const session = await validateSession(tokenStr);
  if (session === null || session.caseId !== caseId) return false;

  // DB-level revocation check — ensures admin force-logout, account lock, and
  // credential rotation are enforced on every instance, not just the one that
  // received the admin action.
  const revoked = await isCaseSessionRevoked(
    caseId,
    session.accessCode,
    session.createdAt,
  );
  return !revoked;
}

/**
 * Sealed-case mutation guard. Once `cases.sealedAt` is set the case is
 * permanently frozen for the user: no new submissions, deposit receipts,
 * messages, feedback, declaration-access-code requests, or registration
 * edits. Admins can still administratively unfreeze a case via the
 * dedicated Override Seal endpoint (which writes an audit reason).
 *
 * Mount AFTER `requirePortalAccess` (or any other case-id-bound auth
 * middleware) so the 423 only fires for callers who already proved they
 * belong to this case — unauthenticated probes still get 401.
 */
export async function requireUnsealed(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const caseId = req.params.id;
  if (typeof caseId !== "string" || caseId.length === 0) {
    next();
    return;
  }
  try {
    const [row] = await db
      .select({ sealedAt: cases.sealedAt })
      .from(cases)
      .where(eq(cases.id, caseId));
    if (row?.sealedAt) {
      res.status(423).json({
        error:
          "This case is sealed. No further changes can be made by the case holder.",
      });
      return;
    }
    next();
  } catch {
    // Fail closed so a transient DB blip cannot let a mutation slip
    // through on a case that may already be sealed.
    res.status(423).json({ error: "Case state could not be verified." });
  }
}

/**
 * Strictly portal-session-only access — rejects admin bearer tokens and
 * mirror (impersonation) sessions.
 *
 * Used on the NDA preview + signing endpoints so that an admin token or a
 * mirror session can never be used to forge a "user" acknowledgement. The
 * signed snapshot records the typed name, IP and User-Agent of the signer
 * as non-repudiation evidence; allowing admin auth or an admin-minted mirror
 * session here would let an operator seal a case on the user's behalf and
 * break that guarantee.
 *
 * Mirror sessions carry isMirror=true in the portal_sessions row. That flag
 * is set at mint time by createMirrorSession and is checked here so that
 * even a short-lived mirror session cannot reach consent-bearing endpoints.
 */
export async function requirePortalSessionOnly(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const caseId = req.params.id;
  if (typeof caseId !== "string" || caseId.length === 0) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const portalToken = req.headers["x-portal-session-token"];
  const tokenStr = Array.isArray(portalToken) ? portalToken[0] : portalToken;
  if (typeof tokenStr !== "string" || tokenStr.length === 0) {
    res.status(401).json({ error: "Portal session required" });
    return;
  }
  const session = await validateSession(tokenStr);
  if (session === null || session.caseId !== caseId) {
    res.status(401).json({ error: "Portal session required" });
    return;
  }
  // Mirror (admin-impersonation) sessions must never satisfy this middleware.
  // Consent-bearing actions like NDA signing require genuine user participation;
  // a mirrored session would let an admin silently act on the user's behalf.
  if (session.isMirror) {
    res.status(403).json({ error: "This action requires a genuine user session and cannot be performed during an admin mirror session." });
    return;
  }
  const revoked = await isCaseSessionRevoked(
    caseId,
    session.accessCode,
    session.createdAt,
  );
  if (revoked) {
    res.status(401).json({ error: "Portal session required" });
    return;
  }
  next();
}

/**
 * Portal-session-only authorization check (no admin token fallback).
 *
 * Returns true only when the request carries a valid, non-revoked portal
 * session that is bound to the given caseId. Use this on routes whose
 * action semantics belong exclusively to the case holder (e.g. marking
 * their own notifications as read) so that admin bearer tokens cannot
 * perform those actions on their behalf.
 */
export async function isPortalSessionValidForCase(
  req: Request,
  caseId: string,
): Promise<boolean> {
  const portalToken = req.headers["x-portal-session-token"];
  const tokenStr = Array.isArray(portalToken) ? portalToken[0] : portalToken;
  if (typeof tokenStr !== "string" || tokenStr.length === 0) return false;
  const session = await validatePortalSession(tokenStr);
  return session !== null && session.caseId === caseId;
}

export async function requirePortalAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const caseId = req.params.id;
  if (typeof caseId !== "string" || caseId.length === 0) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (await isAuthorizedForCase(req, caseId)) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}
