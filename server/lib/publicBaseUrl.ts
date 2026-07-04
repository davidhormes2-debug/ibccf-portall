/**
 * Portable public-base-URL resolution.
 *
 * IBCCF originally ran only on Replit, where the live domain is injected by
 * the platform via `REPLIT_DOMAINS` (deployed) / `REPLIT_DEV_DOMAIN` (editor
 * preview). Those variables do not exist off-Replit (e.g. a Hostinger Cloud
 * VPS behind Nginx), so every consumer that built an admin/email link ended
 * up duplicating the same fallback chain. This module is the single source
 * of truth for that chain so a self-hosted deployment only needs to set one
 * env var: `PUBLIC_BASE_URL`.
 *
 * Priority:
 *   1. `PUBLIC_BASE_URL` — the portable, platform-agnostic override. This is
 *      the variable self-hosted deployments (Hostinger, Railway, bare VPS,
 *      etc.) should set to their public origin, e.g. `https://example.com`.
 *   2. `APP_BASE_URL` — legacy alias kept for backwards compatibility with
 *      existing Replit deployments that already set it. New setups should
 *      prefer `PUBLIC_BASE_URL`.
 *   3. `REPLIT_DOMAINS` — set automatically by Replit Deployments to the
 *      live public domain(s). Only relevant when running on Replit.
 *   4. `REPLIT_DEV_DOMAIN` — set automatically in the Replit editor preview
 *      (no deployment yet). Only relevant when running on Replit.
 *   5. Canonical hard-coded fallback (`https://ibccf.site`) so the app never
 *      emits a broken `localhost` link if every env var above is unset.
 */
function firstReplitDomain(): string | undefined {
  const domains = process.env.REPLIT_DOMAINS?.split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  return domains && domains.length > 0 ? domains[0] : undefined;
}

/** Canonical fallback origin used when no env var resolves a public URL. */
export const CANONICAL_FALLBACK_BASE_URL = "https://ibccf.site";

/**
 * Resolve the public base URL of this deployment (no trailing slash).
 */
export function getPublicBaseUrl(): string {
  const portable = process.env.PUBLIC_BASE_URL?.trim();
  if (portable) return portable.replace(/\/+$/, "");

  const legacyOverride = process.env.APP_BASE_URL?.trim();
  if (legacyOverride) return legacyOverride.replace(/\/+$/, "");

  const replitDeployed = firstReplitDomain();
  if (replitDeployed) return `https://${replitDeployed}`;

  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`.replace(/\/+$/, "");
  }

  return CANONICAL_FALLBACK_BASE_URL;
}

/** Resolve the public admin dashboard URL (`<base>/admin`, no trailing slash on base). */
export function getPublicAdminUrl(): string {
  return `${getPublicBaseUrl()}/admin`;
}
