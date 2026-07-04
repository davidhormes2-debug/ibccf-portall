import { Router, type Request, type RequestHandler } from "express";
import crypto from "crypto";
import { verifySync as totpVerifySync } from "otplib";
import bcrypt from "bcryptjs";
import { storage } from "../storage";
import { z } from "zod";
import { checkAdminAuth, isValidAdminToken } from "./middleware";
import { requireAdminRole } from "./adminPermissions";
import { getBuildStamp, getBootTimeIso } from "../static";
import { isAuthorizedForCase, isPortalSessionValidForCase } from "../services/portal-auth";
import { loginRateLimiter } from "../middleware";
import { rateLimiter, ADMIN_EMERGENCY_RESET_RATE_LIMIT_NAMESPACE } from "../middleware/security";
import { updateCaseLetterSchema } from "@shared/schema";
import {
  AUDIT_LOG_RETENTION_MAX_DAYS,
  AUDIT_LOG_RETENTION_MIN_DAYS,
  readAuditLogRetentionSetting,
  runAuditLogSweep,
  saveAuditLogRetentionDays,
} from "../audit-retention";
import {
  getPasswordStrength,
  isAdminPasswordWeak,
  isAdminUsernameTrivial,
  getAdminPasswordWeakReason,
} from "@shared/passwordStrength";
import { warnOnce } from "../lib/warnOnce";
import { getPublicAdminUrl } from "../lib/publicBaseUrl";
import {
  COMMUNITY_PARTICIPANT_RETENTION_MAX_DAYS,
  COMMUNITY_PARTICIPANT_RETENTION_MIN_DAYS,
  readCommunityParticipantRetentionSetting,
  runCommunityParticipantCleanup,
  saveCommunityParticipantRetentionDays,
} from "../community-cleanup";

export const adminRouter = Router();

// Admin credentials from environment variables. No production-friendly default
// is provided so a missing secret fails closed instead of silently allowing a
// weak well-known password.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";


const SESSION_TTL_HOURS = 12;

function newSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// Use Express's proxy-aware req.ip (configured via app.set("trust proxy", 1)
// in server/index.ts) so audit/session IP fields can't be spoofed via a raw
// x-forwarded-for header. Falls back to the direct socket address.
function getClientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

// Truncate the attempted username before persisting to the audit log so a
// pathological client can't fill the table with megabyte-sized rows. We never
// log the password — even on failure, only the username is recorded.
function safeAttemptedUsername(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "unknown";
  return raw.slice(0, 100);
}

async function recordLoginAudit(
  req: Request,
  action: "admin_login_success" | "admin_login_failed",
  attemptedUsername: string,
): Promise<void> {
  try {
    await storage.createAuditLog({
      adminUsername: attemptedUsername,
      action,
      targetType: "admin_session",
      targetId: null,
      previousValue: null,
      newValue: null,
      ipAddress: getClientIp(req) ?? null,
      userAgent: req.headers["user-agent"]?.toString() ?? null,
    });
  } catch (err) {
    // Never let an audit-log write fail the login response.
    warnOnce("admin:failed-to-write-admin-login-audit-log", "Failed to write admin login audit log:", err);
  }
}

// Login limiter that also writes an `admin_login_throttled` audit row each
// time a request is rejected with 429. Keeping the wiring here (rather than in
// server/index.ts) keeps the audit-log glue alongside the other login audit
// helpers above.
export function adminLoginLimiter(): RequestHandler {
  return loginRateLimiter({
    onThrottled: async (req: Request) => {
      const username =
        typeof req.body?.username === "string" && req.body.username.length > 0
          ? (req.body.username as string).slice(0, 100)
          : "unknown";
      try {
        await storage.createAuditLog({
          adminUsername: username,
          action: "admin_login_throttled",
          targetType: "admin_session",
          targetId: null,
          previousValue: null,
          newValue: null,
          ipAddress: getClientIp(req) ?? null,
          userAgent: req.headers["user-agent"]?.toString() ?? null,
        });
      } catch (err) {
        warnOnce("admin:failed-to-write-throttled-login-audit-log", "Failed to write throttled login audit log:", err);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Emergency admin-credential reset (Task #2398)
//
// Recovers a locked-out admin (forgotten password, stale username override,
// or an ADMIN_PASSWORD secret that drifted from what a redeployed instance
// accepts) WITHOUT a database console and without requiring a full
// republish. Deliberately unauthenticated (the whole point is that the admin
// cannot log in) — safety comes from three layers instead of a session:
//   1. It only does anything if ADMIN_RECOVERY_EMAIL is configured (an env
//      var only an operator with deployment/secrets access can set).
//   2. The reset token is only ever delivered to that fixed recovery
//      address — never echoed in the API response.
//   3. The token is single-use, short-lived (30 min), and rate-limited.
// See replit.md → "Admin login recovery" for the full runbook.
// ---------------------------------------------------------------------------

const ADMIN_RECOVERY_EMAIL = process.env.ADMIN_RECOVERY_EMAIL ?? "";
const EMERGENCY_RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const EMERGENCY_RESET_TOKEN_HASH_KEY = "admin_emergency_reset_token_hash";
const EMERGENCY_RESET_TOKEN_EXPIRES_KEY = "admin_emergency_reset_token_expires_at";

// Strict, DB-backed limiter — this is an unauthenticated credential-reset
// surface, so it must be throttled at least as tightly as admin login itself.
// Both the request and confirm steps use this same limiter factory (3
// requests/hour/IP each) so a bug that exempted one step wouldn't quietly
// weaken the whole surface. Note: rateLimiter() keys on the request's own
// route path, so /request and /confirm get their own 3/hour/IP bucket apiece
// rather than sharing a single combined budget — an intentionally stricter
// outcome, not a gap.
const emergencyResetRequestLimiter = rateLimiter(3, 60 * 60 * 1000, {
  persistNamespace: ADMIN_EMERGENCY_RESET_RATE_LIMIT_NAMESPACE,
});

// Import-free helper kept local to this section: strips the emergency-reset
// app_settings rows once a token is consumed or superseded.
async function clearEmergencyResetToken(): Promise<void> {
  await storage.setAppSetting(EMERGENCY_RESET_TOKEN_HASH_KEY, "", "system");
  await storage.setAppSetting(EMERGENCY_RESET_TOKEN_EXPIRES_KEY, "", "system");
}

// Step 1: request a reset. No request body — there is exactly one admin
// recovery address, configured server-side. Always responds with the same
// generic message regardless of whether ADMIN_RECOVERY_EMAIL is set, EXCEPT
// when it isn't configured at all, in which case we fail closed with a
// clear operator-facing error (there is no email to leak here — the address
// is a deployment secret, not user input).
adminRouter.post("/emergency-reset/request", emergencyResetRequestLimiter, async (req, res) => {
  try {
    if (!ADMIN_RECOVERY_EMAIL) {
      res.status(503).json({
        error:
          "Emergency reset is not configured. Set the ADMIN_RECOVERY_EMAIL secret to enable this recovery path.",
      });
      return;
    }

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date(Date.now() + EMERGENCY_RESET_TOKEN_TTL_MS);

    await storage.setAppSetting(EMERGENCY_RESET_TOKEN_HASH_KEY, tokenHash, "system");
    await storage.setAppSetting(EMERGENCY_RESET_TOKEN_EXPIRES_KEY, expiresAt.toISOString(), "system");

    const resetLink = `${getPublicAdminUrl()}/emergency-reset?token=${encodeURIComponent(rawToken)}`;
    const { emailService } = await import("../services/EmailService");
    const emailResult = await emailService.sendAdminEmergencyResetEmail({
      to: ADMIN_RECOVERY_EMAIL,
      resetLink,
      expiresAt,
      requestIp: getClientIp(req) ?? null,
    });

    try {
      await storage.createAuditLog({
        adminUsername: "unauthenticated",
        action: "admin_emergency_reset_requested",
        targetType: "admin_account",
        targetId: null,
        previousValue: null,
        newValue: null,
        ipAddress: getClientIp(req) ?? null,
        userAgent: req.headers["user-agent"]?.toString() ?? null,
      });
    } catch (auditErr) {
      warnOnce("admin:emergency-reset-request-audit-fail", "[admin] Failed to write emergency_reset_requested audit log:", auditErr);
    }

    if (!emailResult.success) {
      // The token is already persisted, but nobody can retrieve it — clear
      // it so a subsequent legitimate request isn't blocked by a dangling
      // unusable token, and tell the caller plainly (this is an ops-facing
      // failure, not a user enumeration risk).
      await clearEmergencyResetToken();
      res.status(502).json({ error: "Failed to send the emergency reset email. Check SMTP configuration." });
      return;
    }

    res.json({ success: true, message: "If emergency reset is configured, a reset link has been emailed." });
  } catch (err) {
    warnOnce("admin:emergency-reset-request-error", "[admin] emergency-reset/request error:", err);
    res.status(500).json({ error: "Failed to process emergency reset request" });
  }
});

// Step 2: confirm the reset with the emailed token, setting new admin
// credentials in place of whatever ADMIN_USERNAME/ADMIN_PASSWORD/overrides
// were previously in effect. Reuses the same weak-password/trivial-username
// guards as change-password/change-username so an emergency reset can't
// land on weak credentials.
adminRouter.post("/emergency-reset/confirm", emergencyResetRequestLimiter, async (req, res) => {
  try {
    const { token, newUsername, newPassword } = req.body ?? {};
    if (!token || typeof token !== "string" || !newPassword) {
      res.status(400).json({ error: "token and newPassword are required" });
      return;
    }

    const tokenHashSetting = await storage.getAppSetting(EMERGENCY_RESET_TOKEN_HASH_KEY);
    const tokenExpiresSetting = await storage.getAppSetting(EMERGENCY_RESET_TOKEN_EXPIRES_KEY);
    const storedHash = tokenHashSetting?.value;
    const storedExpiresRaw = tokenExpiresSetting?.value;

    if (!storedHash || !storedExpiresRaw) {
      res.status(401).json({ error: "No emergency reset is pending. Request a new one." });
      return;
    }

    const expiresAt = new Date(storedExpiresRaw);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      await clearEmergencyResetToken();
      res.status(401).json({ error: "This emergency reset link has expired. Request a new one." });
      return;
    }

    const tokenValid = await bcrypt.compare(token, storedHash);
    if (!tokenValid) {
      res.status(401).json({ error: "Invalid or already-used emergency reset link." });
      return;
    }

    if (isAdminPasswordWeak(String(newPassword))) {
      res.status(422).json({ error: "New password is too weak. Choose a Strong password." });
      return;
    }
    // Trim before validating/storing — an accidental leading/trailing space
    // (e.g. from copy-paste) would otherwise get saved verbatim and silently
    // brick login, since the login route compares usernames with strict
    // equality and has no way to know the "real" intended value.
    const trimmedNewUsername =
      newUsername !== undefined && newUsername !== null ? String(newUsername).trim() : newUsername;
    if (trimmedNewUsername !== undefined && trimmedNewUsername !== null && String(trimmedNewUsername).length > 0) {
      const { isAdminUsernameTrivial } = await import("@shared/passwordStrength");
      if (isAdminUsernameTrivial(String(trimmedNewUsername))) {
        res.status(422).json({
          error:
            "New username is trivial — choose a unique username at least 4 characters long " +
            "that is not purely numeric, a common default, a repeated character, or a keyboard walk.",
        });
        return;
      }
    }

    // Consume the token before making any changes so a retry after a partial
    // failure can't replay it, and set the new credentials the same way the
    // authenticated change-password/change-username routes do.
    await clearEmergencyResetToken();

    const newHash = await bcrypt.hash(String(newPassword), 12);
    const newStrength = getPasswordStrength(String(newPassword));
    await storage.setAppSetting("admin_password_override", newHash, "system");
    await storage.setAppSetting("admin_password_override_strength", newStrength, "system");
    if (trimmedNewUsername !== undefined && trimmedNewUsername !== null && String(trimmedNewUsername).length > 0) {
      await storage.setAppSetting("admin_username_override", String(trimmedNewUsername), "system");
    }

    try {
      await storage.createAuditLog({
        adminUsername: "unauthenticated",
        action: "admin_emergency_reset_used",
        targetType: "admin_account",
        targetId: null,
        previousValue: null,
        newValue: null,
        ipAddress: getClientIp(req) ?? null,
        userAgent: req.headers["user-agent"]?.toString() ?? null,
      });
    } catch (auditErr) {
      warnOnce("admin:emergency-reset-confirm-audit-fail", "[admin] Failed to write emergency_reset_used audit log:", auditErr);
    }

    res.json({ success: true });
  } catch (err) {
    warnOnce("admin:emergency-reset-confirm-error", "[admin] emergency-reset/confirm error:", err);
    res.status(500).json({ error: "Failed to confirm emergency reset" });
  }
});

// Public (no auth required) — returns only a boolean so the login page can
// surface an informational notice before credentials are submitted. Exposes
// no sensitive data (no timestamp, no actor).
adminRouter.get("/public/password-override-active", async (_req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const setting = await storage.getAppSetting("admin_password_override");
    res.json({ active: !!(setting?.value) });
  } catch {
    // Fail silently — this is advisory only; the login flow must not break
    // if this endpoint errors.
    res.json({ active: false });
  }
});

adminRouter.post("/login", async (req, res) => {
  try {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      res.status(503).json({ error: "Admin credentials not configured" });
      return;
    }
    const weakReason = getAdminPasswordWeakReason(process.env.ADMIN_PASSWORD);
    if (weakReason) {
      res.status(503).json({
        error:
          "Admin password is too weak — rotate ADMIN_PASSWORD before logging in",
        // Machine-readable reason so the login page can surface a targeted
        // hint (see ADMIN_PASSWORD_WEAK_HINTS) instead of the generic message.
        weakReason,
      });
      return;
    }
    const { username, password, totpCode } = req.body ?? {};

    // Check for a DB-stored password override (set via the dashboard change-password flow).
    // Falls back to the ADMIN_PASSWORD env var when no override is stored.
    // Also check for a DB-stored username override (set via change-username flow).
    const overrideSetting = await storage.getAppSetting("admin_password_override");
    const usernameOverrideSetting = await storage.getAppSetting("admin_username_override");
    const effectiveUsername = usernameOverrideSetting?.value || ADMIN_USERNAME;

    let passwordValid = false;
    // Track which account authenticated so the session is minted with the
    // correct username (env-var super_admin vs. admin_users row).
    //
    // NOTE: env-admin sessions always store ADMIN_USERNAME (the env var
    // constant), NOT effectiveUsername (which may be a cosmetic override).
    // This keeps a single canonical identity that checkAdminAuth can compare
    // against process.env.ADMIN_USERNAME without needing an extra DB lookup
    // for the override setting on every request.
    let authenticatedUsername = ADMIN_USERNAME;
    // Whether this login is for a sub-admin from the admin_users table.
    let isSubAdmin = false;

    if (overrideSetting?.value) {
      passwordValid = username === effectiveUsername && await bcrypt.compare(String(password ?? ""), overrideSetting.value);
    } else {
      // strict-equality-guard: must stay === (not ==) — loose equality would
      // coerce types and could allow a numeric-coercible or empty-string
      // password to match the configured ADMIN_PASSWORD env var.
      passwordValid = username === effectiveUsername && password === ADMIN_PASSWORD;
    }

    // If the env-var credentials didn't match, try the admin_users table.
    // This allows sub-admins (created via the dashboard) to sign in.
    // SECURITY: explicitly reject attempts to use the sub-admin path for the
    // canonical env-var admin username — that account must only be reachable
    // via the env-var credential path above to prevent 2FA bypass.
    //
    // Keep a reference to the fetched sub-admin row so the 2FA check below
    // can use it without a second DB round-trip.
    let subAdminUser: import("@shared/schema").AdminUser | null = null;
    if (!passwordValid && typeof username === "string" && username.length > 0
        && username !== ADMIN_USERNAME && username !== effectiveUsername) {
      const dbUser = await storage.getAdminUserByUsername(username);
      if (dbUser && dbUser.isActive && dbUser.passwordHash) {
        const dbPasswordValid = await bcrypt.compare(String(password ?? ""), dbUser.passwordHash);
        if (dbPasswordValid) {
          passwordValid = true;
          authenticatedUsername = dbUser.username;
          isSubAdmin = true;
          subAdminUser = dbUser;
        }
      }
    }

    if (!passwordValid) {
      await recordLoginAudit(
        req,
        "admin_login_failed",
        safeAttemptedUsername(username),
      );
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // Enforce 2FA when it is configured and enabled.
    // Super-admin: uses the shared admin_two_factor row keyed by ADMIN_USERNAME.
    // Sub-admins:  each row in admin_users carries its own twoFactorEnabled /
    //              twoFactorSecret; backup codes are stored in admin_two_factor
    //              keyed by the sub-admin's username (same table, different key).
    if (!isSubAdmin) {
      const twoFactorConfig = await storage.getAdminTwoFactor(ADMIN_USERNAME);
      if (twoFactorConfig?.isEnabled) {
        if (!totpCode) {
          // Credentials are correct but the second factor is still needed.
          // Return a distinct response so the client can prompt for the code
          // without revealing that only the password check has passed.
          res.status(401).json({ requiresTwoFactor: true });
          return;
        }

        // Verify TOTP code using the stored secret.
        const totpValid = totpVerifySync({
          token: String(totpCode).replace(/\s/g, ""),
          secret: twoFactorConfig.secret,
        });

        if (!totpValid) {
          // Also try backup codes (stored as a JSON array of bcrypt hashes).
          let backupCodeMatched = false;
          if (twoFactorConfig.backupCodes) {
            let hashes: string[] = [];
            try {
              hashes = JSON.parse(twoFactorConfig.backupCodes) as string[];
            } catch {
              hashes = [];
            }
            for (const hash of hashes) {
              if (await bcrypt.compare(String(totpCode).replace(/\s/g, ""), hash)) {
                backupCodeMatched = true;
                // Burn the used backup code so it cannot be replayed.
                const remaining = hashes.filter((h) => h !== hash);
                await storage.updateAdminTwoFactor(ADMIN_USERNAME, {
                  backupCodes: JSON.stringify(remaining),
                });
                break;
              }
            }
          }

          if (!backupCodeMatched) {
            await recordLoginAudit(
              req,
              "admin_login_failed",
              safeAttemptedUsername(username),
            );
            res.status(401).json({ error: "Invalid verification code" });
            return;
          }
        }

        // Record that 2FA was successfully used.
        await storage.updateAdminTwoFactor(ADMIN_USERNAME, {
          lastVerifiedAt: new Date(),
        });
      }
    } else if (isSubAdmin && subAdminUser?.twoFactorEnabled && subAdminUser.twoFactorSecret) {
      // Sub-admin has per-account 2FA enabled.
      if (!totpCode) {
        res.status(401).json({ requiresTwoFactor: true });
        return;
      }

      const totpValid = totpVerifySync({
        token: String(totpCode).replace(/\s/g, ""),
        secret: subAdminUser.twoFactorSecret,
      });

      if (!totpValid) {
        // Try backup codes stored in admin_two_factor keyed by sub-admin username.
        let backupCodeMatched = false;
        const subAdminTwoFactorConfig = await storage.getAdminTwoFactor(authenticatedUsername);
        if (subAdminTwoFactorConfig?.backupCodes) {
          let hashes: string[] = [];
          try {
            hashes = JSON.parse(subAdminTwoFactorConfig.backupCodes) as string[];
          } catch {
            hashes = [];
          }
          for (const hash of hashes) {
            if (await bcrypt.compare(String(totpCode).replace(/\s/g, ""), hash)) {
              backupCodeMatched = true;
              const remaining = hashes.filter((h) => h !== hash);
              await storage.updateAdminTwoFactor(authenticatedUsername, {
                backupCodes: JSON.stringify(remaining),
              });
              break;
            }
          }
        }

        if (!backupCodeMatched) {
          await recordLoginAudit(
            req,
            "admin_login_failed",
            safeAttemptedUsername(username),
          );
          res.status(401).json({ error: "Invalid verification code" });
          return;
        }
      }

      // Record that sub-admin 2FA was successfully used.
      await storage.updateAdminTwoFactor(authenticatedUsername, {
        lastVerifiedAt: new Date(),
      }).catch(() => {});
    }

    const token = newSessionToken();
    const expiresAt = new Date(
      Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000,
    );
    // Bind admin-session creation and its `admin_login_success` audit row to a
    // single transaction so an audit-log failure can never leave behind a
    // session we never recorded.
    try {
      await storage.runInTransaction(async (tx) => {
        await storage.createAdminSession(
          {
            adminUsername: authenticatedUsername,
            token,
            ipAddress: getClientIp(req),
            userAgent: req.headers["user-agent"]?.toString() ?? "",
            expiresAt,
          },
          tx,
        );
        await storage.createAuditLog(
          {
            adminUsername: authenticatedUsername,
            action: "admin_login_success",
            targetType: "admin_session",
            targetId: null,
            previousValue: null,
            newValue: null,
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          },
          tx,
        );
      });
      // Update lastLoginAt for sub-admin rows (best-effort, non-blocking).
      if (isSubAdmin) {
        const dbUser = await storage.getAdminUserByUsername(authenticatedUsername);
        if (dbUser) {
          storage.updateAdminUser(dbUser.id, { lastLoginAt: new Date() }).catch(() => {});
        }
      }
    } catch (txErr) {
      warnOnce("admin:login-transaction-failed", "[admin] login transaction failed:", txErr);
      res.status(500).json({ error: "Login failed" });
      return;
    }
    res.json({ success: true, token });
  } catch (_e) {
    res.status(500).json({ error: "Login failed" });
  }
});

adminRouter.post("/logout", checkAdminAuth, async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (token !== null) {
      const session = await storage.getAdminSessionByToken(token);
      if (session) {
        await storage.revokeAdminSession(session.id, "Logout");
      }
    }
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Logout failed" });
  }
});

adminRouter.get("/verify", checkAdminAuth, (req, res) => {
  res.json({ valid: true, role: req.adminRole ?? "super_admin" });
});

// Recent emergency-reset ("Locked out?") activity, for the Settings/security
// awareness surface — this flow can rewrite the admin's own credentials, so
// it gets a dedicated, always-visible view instead of being buried in the
// general audit trail. Read-only, available to any authenticated admin.
adminRouter.get("/emergency-reset-activity", checkAdminAuth, async (_req, res) => {
  try {
    const events = await storage.getEmergencyResetAuditLogs(20);
    const lastUsed = events.find((e) => e.action === "admin_emergency_reset_used") ?? null;
    res.json({
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        createdAt: e.createdAt,
        ipAddress: e.ipAddress,
      })),
      lastUsedAt: lastUsed?.createdAt ?? null,
    });
  } catch (err) {
    warnOnce("admin:emergency-reset-activity-error", "[admin] emergency-reset-activity error:", err);
    res.status(500).json({ error: "Failed to load emergency reset activity" });
  }
});

// Change the admin password. Verifies the current password (checking the
// DB override first, then the env var), rejects weak new passwords, then
// bcrypt-hashes and stores the new password in app_settings so future logins
// use it instead of the env var. Audit-logged as `admin_password_changed`.
adminRouter.post("/change-password", checkAdminAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "currentPassword and newPassword are required" });
      return;
    }

    // Verify current password (same logic as login).
    let currentValid = false;
    const overrideSetting = await storage.getAppSetting("admin_password_override");
    if (overrideSetting?.value) {
      currentValid = await bcrypt.compare(String(currentPassword), overrideSetting.value);
    } else {
      currentValid = String(currentPassword) === ADMIN_PASSWORD;
    }

    if (!currentValid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    // Reject weak new passwords.
    if (isAdminPasswordWeak(String(newPassword))) {
      res.status(422).json({ error: "New password is too weak. Choose a Strong password." });
      return;
    }

    // Hash and persist. Also store the strength rating alongside the hash so
    // the security-flags endpoint can report the effective password strength
    // without needing the plaintext again (the hash is one-way).
    const hash = await bcrypt.hash(String(newPassword), 12);
    const newStrength = getPasswordStrength(String(newPassword));
    await storage.setAppSetting("admin_password_override", hash, ADMIN_USERNAME);
    await storage.setAppSetting("admin_password_override_strength", newStrength, ADMIN_USERNAME);

    // Audit log.
    try {
      await storage.createAuditLog({
        adminUsername: ADMIN_USERNAME,
        action: "admin_password_changed",
        targetType: "admin_account",
        targetId: null,
        previousValue: null,
        newValue: null,
        ipAddress: String(req.ip ?? ""),
        userAgent: String(req.headers["user-agent"] ?? ""),
      });
    } catch (auditErr) {
      warnOnce("admin:failed-to-write-password-changed-audit-log", "[admin] Failed to write password_changed audit log:", auditErr);
    }

    res.json({ success: true });
  } catch (err) {
    warnOnce("admin:change-password-error", "[admin] change-password error:", err);
    res.status(500).json({ error: "Failed to change password" });
  }
});

// Returns whether the admin password has been overridden via the dashboard
// (i.e. an `admin_password_override` row exists in app_settings). Exposed so
// the Settings page can surface an informational banner reminding operators
// that the env var is currently bypassed and a server restart with a fresh DB
// would revert to it.
adminRouter.get("/password-override-status", checkAdminAuth, async (_req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const setting = await storage.getAppSetting("admin_password_override");
    if (setting?.value) {
      res.json({
        active: true,
        changedAt: setting.updatedAt ?? null,
        changedBy: setting.updatedBy ?? null,
      });
    } else {
      res.json({ active: false, changedAt: null, changedBy: null });
    }
  } catch (err) {
    warnOnce("admin:password-override-status-fail", "[admin] password-override-status error:", err);
    res.status(500).json({ error: "Failed to retrieve password override status" });
  }
});

// Clears the dashboard-set password override so authentication falls back to
// the ADMIN_PASSWORD env var. Audit-logged as `admin_password_override_cleared`.
adminRouter.delete("/password-override", checkAdminAuth, async (req, res) => {
  try {
    const setting = await storage.getAppSetting("admin_password_override");
    if (!setting?.value) {
      res.json({ success: true, message: "No override was active" });
      return;
    }
    // Overwrite with an empty string — the login and change-password routes
    // treat a falsy value as "no override". A true DB delete would work too
    // but this approach keeps the row for audit traceability via updatedAt/updatedBy.
    // Also clear the companion strength setting so security-flags falls back to
    // evaluating the env var once the override is no longer active.
    await storage.setAppSetting("admin_password_override", "", ADMIN_USERNAME);
    await storage.setAppSetting("admin_password_override_strength", "", ADMIN_USERNAME);
    try {
      await storage.createAuditLog({
        adminUsername: ADMIN_USERNAME,
        action: "admin_password_override_cleared",
        targetType: "admin_account",
        targetId: null,
        previousValue: null,
        newValue: null,
        ipAddress: String(req.ip ?? ""),
        userAgent: String(req.headers["user-agent"] ?? ""),
      });
    } catch (auditErr) {
      warnOnce("admin:failed-to-write-password-override-cleared-audit-lo", "[admin] Failed to write password_override_cleared audit log:", auditErr);
    }
    res.json({ success: true });
  } catch (err) {
    warnOnce("admin:password-override-delete-error", "[admin] password-override delete error:", err);
    res.status(500).json({ error: "Failed to clear password override" });
  }
});

// Changes the admin username by storing a DB override (same pattern as the
// change-password flow). The new username must pass `isAdminUsernameTrivial`
// from the shared helper so the server and the client strength meter agree.
adminRouter.post("/change-username", checkAdminAuth, async (req, res) => {
  try {
    const { currentPassword, newUsername } = req.body ?? {};
    if (!currentPassword || !newUsername) {
      res.status(400).json({ error: "currentPassword and newUsername are required" });
      return;
    }

    // Verify current password (same logic as login and change-password).
    let currentValid = false;
    const overrideSetting = await storage.getAppSetting("admin_password_override");
    if (overrideSetting?.value) {
      currentValid = await bcrypt.compare(String(currentPassword), overrideSetting.value);
    } else {
      currentValid = String(currentPassword) === ADMIN_PASSWORD;
    }

    if (!currentValid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    // Trim before validating/storing — an accidental leading/trailing space
    // (e.g. from copy-paste) would otherwise get saved verbatim and silently
    // brick login, since the login route compares usernames with strict
    // equality and has no way to know the "real" intended value.
    const trimmedNewUsername = String(newUsername).trim();

    // Reject trivial usernames using the shared helper so client meter and
    // server always agree.
    const { isAdminUsernameTrivial } = await import("@shared/passwordStrength");
    if (isAdminUsernameTrivial(trimmedNewUsername)) {
      res.status(422).json({
        error:
          "New username is trivial — choose a unique username at least 4 characters long " +
          "that is not purely numeric, a common default, a repeated character, or a keyboard walk.",
      });
      return;
    }

    // Persist the override so future logins accept the new username.
    await storage.setAppSetting("admin_username_override", trimmedNewUsername, ADMIN_USERNAME);

    // Audit log.
    try {
      await storage.createAuditLog({
        adminUsername: ADMIN_USERNAME,
        action: "admin_username_changed",
        targetType: "admin_account",
        targetId: null,
        previousValue: null,
        newValue: null,
        ipAddress: String(req.ip ?? ""),
        userAgent: String(req.headers["user-agent"] ?? ""),
      });
    } catch (auditErr) {
      warnOnce("admin:failed-to-write-username-changed-audit-log", "[admin] Failed to write username_changed audit log:", auditErr);
    }

    res.json({ success: true });
  } catch (err) {
    warnOnce("admin:change-username-error", "[admin] change-username error:", err);
    res.status(500).json({ error: "Failed to change username" });
  }
});

// Currently-deployed build identifier, surfaced in the admin dashboard so
// support can confirm "is my hotfix actually live for this admin?" without
// curling the X-Build-Stamp header from a shell. The value is the exact
// same string folded into every marketing ETag and emitted as the
// `X-Build-Stamp` response header — see server/static.ts for the
// resolution order (BUILD_STAMP → SENTRY_RELEASE → boot-<epoch>).
adminRouter.get("/build-info", checkAdminAuth, (_req, res) => {
  // Never cache: the value is fixed for the lifetime of the process, but
  // a new deploy replaces the process, so each admin poll must reach
  // the live instance rather than a stale shared cache.
  res.setHeader("Cache-Control", "no-store");
  res.json({
    buildStamp: getBuildStamp(),
    bootTime: getBootTimeIso(),
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
});

// Server-side security flag status. Allows the admin dashboard to surface
// warnings when dangerous development escape hatches are active so operators
// can catch misconfigured production deployments without inspecting raw env
// vars. Currently exposes:
//   - weakAdminPasswordAllowed:  ALLOW_WEAK_ADMIN_PASSWORD=1 is set
//   - weakAdminUsernameAllowed:  ALLOW_WEAK_ADMIN_USERNAME=1 is set
//   - weakSessionSecretAllowed:  ALLOW_WEAK_SESSION_SECRET=1 is set
//   - isProduction:              NODE_ENV === 'production'
//   - adminUsernameTrivial:      effective username (DB override or env var)
//                                fails the isAdminUsernameTrivial check
//   - weakPassword:              the ADMIN_PASSWORD env var itself is rated
//                                Weak by the shared checker (catches admins
//                                whose password pre-dates the walk checker)
adminRouter.get("/security-flags", checkAdminAuth, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  // Resolve the effective admin username the same way the login route does:
  // prefer the DB override when set, fall back to the env var.
  let adminUsernameTrivial = false;
  try {
    const usernameOverrideSetting = await storage.getAppSetting("admin_username_override");
    const effectiveUsername = usernameOverrideSetting?.value || ADMIN_USERNAME;
    adminUsernameTrivial = isAdminUsernameTrivial(effectiveUsername);
  } catch {
    // Non-fatal — omit the flag rather than breaking the whole endpoint.
  }
  // Resolve the effective password strength.  When a DB override is active the
  // plaintext is unavailable (only the bcrypt hash is stored), so the strength
  // rating is persisted as a companion app_setting at change time.  Fall back
  // to evaluating the env var when no override is active.
  let adminPasswordStrength: import("@shared/passwordStrength").PasswordStrength = getPasswordStrength(
    process.env.ADMIN_PASSWORD ?? "",
  );
  try {
    const overrideSetting = await storage.getAppSetting("admin_password_override");
    if (overrideSetting?.value) {
      // Override is active — use the stored strength rating.
      const storedStrength = (await storage.getAppSetting("admin_password_override_strength"))?.value;
      if (storedStrength === "Weak" || storedStrength === "Medium" || storedStrength === "Strong") {
        adminPasswordStrength = storedStrength;
      }
      // If the companion setting is missing (e.g. password was set before this
      // feature was introduced) fall back to the env var strength — which is
      // already the default value assigned above.
    }
  } catch {
    // Non-fatal — fall back to env var strength.
  }
  res.json({
    weakAdminPasswordAllowed: process.env.ALLOW_WEAK_ADMIN_PASSWORD === "1",
    weakAdminUsernameAllowed: process.env.ALLOW_WEAK_ADMIN_USERNAME === "1",
    weakSessionSecretAllowed: process.env.ALLOW_WEAK_SESSION_SECRET === "1",
    isProduction: process.env.NODE_ENV === "production",
    adminUsernameTrivial,
    weakPassword: isAdminPasswordWeak(process.env.ADMIN_PASSWORD ?? ""),
    adminPasswordStrength,
  });
});

// Latest nightly NDA integrity sweep result. Drives the global dashboard
// banner that warns admins when at-rest tampering has been detected on
// one or more sealed cases. Returns null until the first sweep finishes
// after boot.
adminRouter.get(
  "/nda-integrity-sweep",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { getLastNdaIntegritySweepSummary, runNdaIntegritySweep } =
        await import("../nda-integrity-sweep");
      let summary = getLastNdaIntegritySweepSummary();
      if (!summary) {
        // First poll after a fresh boot — synthesise the missing sweep
        // result inline so the dashboard banner is correct without
        // having to wait for the daily tick.
        summary = await runNdaIntegritySweep();
      }
      res.json(summary);
    } catch (error) {
      warnOnce("admin:nda-sweep-summary-fail", "Failed to fetch NDA integrity sweep summary:", error);
      res.status(500).json({ error: "Failed to fetch sweep summary" });
    }
  },
);

// Manual trigger for the nightly NDA integrity sweep. Lets an admin
// re-run the check on demand (e.g. after restoring from backup) without
// waiting for the next daily tick.
adminRouter.post(
  "/nda-integrity-sweep/run",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { runNdaIntegritySweep } = await import("../nda-integrity-sweep");
      const summary = await runNdaIntegritySweep();
      res.json(summary);
    } catch (error) {
      warnOnce("admin:failed-to-run-nda-integrity-sweep", "Failed to run NDA integrity sweep:", error);
      res.status(500).json({ error: "Failed to run sweep" });
    }
  },
);

// Stale-sweep watchdog status. Powers the "Tamper Alert Recipient" panel
// indicator that warns when the nightly NDA integrity sweep itself has
// stopped running (cron not firing, worker crashed, DB unreachable),
// independently of the in-dashboard banner driven by the per-sweep
// failure summary. The endpoint never triggers an email — that's done
// by the background watchdog tick — it only surfaces the current state.
adminRouter.get(
  "/nda-integrity-sweep/staleness",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { computeNdaIntegritySweepStaleness } = await import(
        "../nda-integrity-sweep"
      );
      const staleness = await computeNdaIntegritySweepStaleness();
      res.json(staleness);
    } catch (error) {
      warnOnce("admin:nda-sweep-staleness-fail", "Failed to compute NDA integrity sweep staleness:", error);
      res
        .status(500)
        .json({ error: "Failed to compute sweep staleness" });
    }
  },
);

// ---------------------------------------------------------------------
// NDA signing-locale allowlist (Task #88, supersedes the boolean
// english-only flag from Task #61). Lets legal/ops open up signing
// one language at a time instead of all-or-nothing. Reads/writes go
// through the `app_settings` row keyed `nda_signing_locales`; the
// value is cached in-process for 10s by the runtimeFlags service.
// Every write emits an `nda_signing_locales_changed` audit-log entry
// with the prior + new values and the optional reason the admin typed
// into the confirmation modal.
// ---------------------------------------------------------------------
adminRouter.get(
  "/nda-signing-locales",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const {
        getNdaSigningLocales,
        NDA_SIGNING_LOCALES_KEY,
      } = await import("../services/runtimeFlags");
      const { NDA_SUPPORTED_LOCALES, NDA_DEFAULT_LOCALE } = await import(
        "../../shared/ndaTemplate"
      );
      const value = await getNdaSigningLocales();
      const row = await storage.getAppSetting(NDA_SIGNING_LOCALES_KEY);
      res.json({
        value,
        supported: [...NDA_SUPPORTED_LOCALES],
        required: [NDA_DEFAULT_LOCALE],
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      });
    } catch (err) {
      warnOnce("admin:nda-signing-locales-fail", "Failed to load nda-signing-locales:", err);
      res.status(500).json({ error: "Failed to load setting" });
    }
  },
);

adminRouter.put(
  "/nda-signing-locales",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { NDA_SUPPORTED_LOCALES, NDA_DEFAULT_LOCALE } = await import(
        "../../shared/ndaTemplate"
      );
      const supported = NDA_SUPPORTED_LOCALES as readonly string[];
      const body = z
        .object({
          value: z
            .array(z.enum(supported as [string, ...string[]]))
            .max(NDA_SUPPORTED_LOCALES.length),
          reason: z.string().trim().max(500).optional(),
        })
        .parse(req.body);
      const {
        getNdaSigningLocales,
        setNdaSigningLocales,
        NDA_SIGNING_LOCALES_KEY,
      } = await import("../services/runtimeFlags");
      const previous = await getNdaSigningLocales();
      const adminUser =
        ((req as Request & { admin?: { username?: string } }).admin?.username) ||
        "Admin";
      // English is always required (the resolver enforces it too, but
      // we reject explicitly here so admins see an actionable error).
      if (!body.value.includes(NDA_DEFAULT_LOCALE)) {
        res.status(400).json({
          error:
            "English must remain in the signing allowlist; it is the authoritative version of the document.",
        });
        return;
      }
      // Task #157 — write the row + the audit row in a single
      // transaction so an audit failure rolls the setting change back
      // (replacing the older "audit-first, fail-closed" pattern that
      // could still leave a successful audit row pointing at a save
      // that subsequently errored).
      const prevStr = previous.join(",");
      const nextStr = body.value.slice().sort().join(",");
      let value: Awaited<ReturnType<typeof setNdaSigningLocales>>;
      try {
        value = await storage.runInTransaction(async (tx) => {
          const v = await setNdaSigningLocales(body.value, adminUser, tx);
          await storage.createAuditLog({
            action: "nda_signing_locales_changed",
            targetType: "app_setting",
            targetId: NDA_SIGNING_LOCALES_KEY,
            adminUsername: adminUser,
            previousValue: prevStr,
            newValue: body.reason
              ? `${nextStr} (reason: ${body.reason})`
              : nextStr,
          }, tx);
          return v;
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-nda-signing-locales-transaction",
          "Refusing to change nda-signing-locales: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }
      const { primeNdaSigningLocalesCache } = await import(
        "../services/runtimeFlags"
      );
      primeNdaSigningLocalesCache(value);
      const row = await storage.getAppSetting(NDA_SIGNING_LOCALES_KEY);
      res.json({
        value,
        supported: [...NDA_SUPPORTED_LOCALES],
        required: [NDA_DEFAULT_LOCALE],
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid request" });
        return;
      }
      warnOnce("admin:failed-to-update-nda-signing-locales", "Failed to update nda-signing-locales:", err);
      res.status(500).json({ error: "Failed to save setting" });
    }
  },
);

// ---------------------------------------------------------------------
// Admin custom email templates (Task #247). Stored as a JSON array
// under the single app_settings key `admin_email_templates`. Admins
// create/edit/delete templates in Settings; the composer dropdowns in
// DepositsTab and CasesTab append them alongside the built-in ones.
// ---------------------------------------------------------------------
const ADMIN_EMAIL_TEMPLATES_KEY = 'admin_email_templates';

const adminEmailTemplateSchema = z.object({
  id: z.string().trim().max(64),
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(10000),
});

adminRouter.get(
  '/settings/email-templates',
  checkAdminAuth,
  async (_req, res) => {
    try {
      const row = await storage.getAppSetting(ADMIN_EMAIL_TEMPLATES_KEY);
      let templates: unknown[] = [];
      if (row?.value) {
        try { templates = JSON.parse(row.value); } catch { templates = []; }
      }
      res.json({
        templates: Array.isArray(templates) ? templates : [],
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      });
    } catch (err) {
      warnOnce("admin:email-templates-fail", "Failed to load email-templates:", err);
      res.status(500).json({ error: 'Failed to load setting' });
    }
  },
);

adminRouter.put(
  '/settings/email-templates',
  checkAdminAuth,
  async (req, res) => {
    try {
      const body = z
        .object({ templates: z.array(adminEmailTemplateSchema).max(50) })
        .refine(
          (v) => {
            const names = v.templates.map((t) => t.name.trim().toLowerCase());
            return names.length === new Set(names).size;
          },
          { message: 'Template names must be unique — duplicate names are not allowed.' },
        )
        .parse(req.body);
      const adminUser =
        ((req as Request & { admin?: { username?: string } }).admin?.username) ||
        'Admin';
      const prev = await storage.getAppSetting(ADMIN_EMAIL_TEMPLATES_KEY);
      const nextJson = JSON.stringify(body.templates);
      try {
        await storage.runInTransaction(async (tx) => {
          await storage.setAppSetting(
            ADMIN_EMAIL_TEMPLATES_KEY,
            nextJson,
            adminUser,
            tx,
          );
          await storage.createAuditLog({
            action: 'email_templates_changed',
            targetType: 'app_setting',
            targetId: ADMIN_EMAIL_TEMPLATES_KEY,
            adminUsername: adminUser,
            previousValue: prev?.value
              ? String(JSON.parse(prev.value).length) + ' templates'
              : '0 templates',
            newValue: String(body.templates.length) + ' templates',
          }, tx);
        });
      } catch (txErr) {
        warnOnce("admin:refusing-to-change-email-templates-transaction-fai", 'Refusing to change email-templates: transaction failed:', txErr);
        res.status(503).json({
          error:
            'Could not record the change in the audit log. The setting was NOT updated. Please try again.',
        });
        return;
      }
      const row = await storage.getAppSetting(ADMIN_EMAIL_TEMPLATES_KEY);
      res.json({
        templates: body.templates,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      warnOnce("admin:failed-to-update-email-templates", 'Failed to update email-templates:', err);
      res.status(500).json({ error: 'Failed to save setting' });
    }
  },
);

// ---------------------------------------------------------------------
// Stamp Duty payment wallets (Task #136). Multi-wallet editor backing
// the Settings tab card. Stored as a JSON array under the single
// app_settings key `stamp_duty_payment_wallets` so admins can offer
// multiple receiving wallets (BTC / USDT-TRC20 / ERC20, etc) and users
// pick which asset to pay with.
// ---------------------------------------------------------------------
const stampDutyWalletSchema = z.object({
  id: z.string().trim().max(64).optional(),
  label: z.string().trim().max(120).nullish(),
  address: z.string().trim().min(1).max(256),
  asset: z.string().trim().min(1).max(32),
  network: z.string().trim().max(64).nullish(),
  memo: z.string().trim().max(256).nullish(),
});

adminRouter.get(
  "/settings/stamp-duty-wallets",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { getStampDutyPaymentWallets, STAMP_DUTY_PAYMENT_WALLETS_KEY } =
        await import("../services/stampDuty");
      const wallets = await getStampDutyPaymentWallets();
      const row = await storage.getAppSetting(STAMP_DUTY_PAYMENT_WALLETS_KEY);
      res.json({
        wallets,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      });
    } catch (err) {
      warnOnce("admin:stamp-duty-wallets-fail", "Failed to load stamp-duty-wallets:", err);
      res.status(500).json({ error: "Failed to load setting" });
    }
  },
);

adminRouter.put(
  "/settings/stamp-duty-wallets",
  checkAdminAuth,
  async (req, res) => {
    try {
      const body = z
        .object({
          wallets: z.array(stampDutyWalletSchema).max(20),
        })
        .parse(req.body);
      const {
        getStampDutyPaymentWallets,
        setStampDutyPaymentWallets,
        STAMP_DUTY_PAYMENT_WALLETS_KEY,
      } = await import("../services/stampDuty");
      const adminUser =
        ((req as Request & { admin?: { username?: string } }).admin
          ?.username) || "Admin";
      const previous = await getStampDutyPaymentWallets();
      // Task #157 — single transaction for the row write + audit log so
      // an audit failure rolls back the wallet change.
      let saved: Awaited<ReturnType<typeof setStampDutyPaymentWallets>>;
      try {
        saved = await storage.runInTransaction(async (tx) => {
          const result = await setStampDutyPaymentWallets(
            body.wallets.map((w) => ({
              id: w.id ?? "",
              label: w.label ?? null,
              address: w.address,
              asset: w.asset,
              network: w.network ?? null,
              memo: w.memo ?? null,
            })),
            adminUser,
            tx,
          );
          await storage.createAuditLog({
            action: "stamp_duty_wallets_changed",
            targetType: "app_setting",
            targetId: STAMP_DUTY_PAYMENT_WALLETS_KEY,
            adminUsername: adminUser,
            previousValue: JSON.stringify(
              previous.map((w) => `${w.asset}:${w.address}`),
            ),
            newValue: JSON.stringify(
              body.wallets.map((w) => `${w.asset}:${w.address}`),
            ),
          }, tx);
          return result;
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-stamp-duty-wallets-transaction",
          "Refusing to change stamp-duty-wallets: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }
      const row = await storage.getAppSetting(STAMP_DUTY_PAYMENT_WALLETS_KEY);
      res.json({
        wallets: saved,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid request" });
        return;
      }
      warnOnce("admin:failed-to-update-stamp-duty-wallets", "Failed to update stamp-duty-wallets:", err);
      res.status(500).json({ error: "Failed to save setting" });
    }
  },
);

export const auditLogsRouter = Router();

auditLogsRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const logs = await storage.getAllAuditLogs();
    // Task #786 — reconcile against the durable wallet-connect fired markers,
    // mirroring the per-case Activity Timeline (GET /api/cases/:id/wallet-events).
    // The `wallet_connect_completed` audit row is best-effort (Task #676): when
    // its write fails the completion would silently vanish from this global view
    // even though the alert fired. Reconstruct the missing rows from the markers
    // so the audit log stays complete. Best-effort — never fail the fetch over it.
    let merged: typeof logs = logs;
    try {
      const { synthesizeMissingWalletConnectCompletions } = await import(
        "../services/walletConnectAlert"
      );
      const synthetic = await synthesizeMissingWalletConnectCompletions(logs);
      if (synthetic.length > 0) {
        merged = [...logs, ...synthetic].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      }
    } catch (reconcileErr) {
      warnOnce(
        "admin:failed-to-reconcile-wallet-connect-completions-for",
        "Failed to reconcile wallet-connect completions for audit log:",
        reconcileErr,
      );
    }
    // Stage-skip request details (reason, requester, target stage) are
    // super_admin-only. Redact the sensitive fields from newValue for all
    // lower roles — keep the action/timestamp so the log is still auditable.
    const isSuperAdmin = req.adminRole === "super_admin";
    const redacted = isSuperAdmin
      ? merged
      : merged.map((entry) => {
          const isStageSkipEntry =
            entry.action?.startsWith("stage_skip_") ||
            entry.action === "override_stage_transition";
          if (!isStageSkipEntry) return entry;
          const newValue = (() => {
            try {
              const parsed =
                entry.newValue && typeof entry.newValue === "string"
                  ? JSON.parse(entry.newValue)
                  : {};
              const {
                reason: _r,
                requestedBy: _rb,
                targetStage: _ts,
                rejectReason: _rr,
                ...rest
              } = parsed;
              return JSON.stringify(rest);
            } catch {
              return null;
            }
          })();
          return { ...entry, newValue };
        });
    res.json(redacted);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

// Recent failed admin sign-in attempts (credential failures + rate-limit
// throttles), plus a 24h count for the dashboard summary. Returned in a
// compact shape tailored to the Settings panel so the UI doesn't need to
// re-filter the whole audit log.
auditLogsRouter.get("/failed-logins", checkAdminAuth, async (req, res) => {
  try {
    const limitRaw = Number.parseInt(
      typeof req.query.limit === "string" ? req.query.limit : "20",
      10,
    );
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [items, count24h] = await Promise.all([
      storage.getRecentFailedAdminLogins(limit),
      storage.getFailedAdminLoginCountSince(since),
    ]);

    res.json({
      items: items.map((row) => ({
        id: row.id,
        action: row.action,
        attemptedUsername: row.adminUsername,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
      })),
      count24h,
    });
  } catch (error) {
    warnOnce("admin:failed-logins-fail", "Failed to fetch failed-login audit rows:", error);
    res.status(500).json({ error: "Failed to fetch failed login attempts" });
  }
});

// Failed sign-ins grouped by source IP. Same audit data the per-attempt
// endpoint surfaces, but rolled up so admins can spot a single IP hammering
// the login (e.g. "203.0.113.42 — 47 attempts, 6 distinct usernames"). The
// `windowHours` query param controls the aggregation window; defaults to 24h
// and is clamped to a sane max so a curious caller can't ask for a year.
auditLogsRouter.get(
  "/failed-logins/by-ip",
  checkAdminAuth,
  async (req, res) => {
    try {
      const windowHoursRaw = Number.parseFloat(
        typeof req.query.windowHours === "string"
          ? req.query.windowHours
          : "24",
      );
      const windowHours =
        Number.isFinite(windowHoursRaw) && windowHoursRaw > 0
          ? Math.min(windowHoursRaw, 24 * 30) // hard cap at 30 days
          : 24;
      const limitRaw = Number.parseInt(
        typeof req.query.limit === "string" ? req.query.limit : "200",
        10,
      );
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200;
      const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
      // Match the rate limiter window so "isThrottled" reflects whether the
      // IP is plausibly still locked out by the in-memory limiter.
      const throttleSince = new Date(Date.now() - 15 * 60 * 1000);

      const rows = await storage.getFailedAdminLoginsByIp(
        since,
        throttleSince,
        limit,
      );

      res.json({
        windowHours,
        items: rows.map((row) => ({
          ipAddress: row.ipAddress,
          attemptCount: row.attemptCount,
          badPasswordCount: row.badPasswordCount,
          throttledCount: row.throttledCount,
          distinctUsernameCount: row.distinctUsernames.length,
          distinctUsernames: row.distinctUsernames.slice(0, 10),
          firstAttemptAt: row.firstAttemptAt,
          lastAttemptAt: row.lastAttemptAt,
          isThrottled: row.isThrottled,
        })),
      });
    } catch (error) {
      warnOnce("admin:failed-logins-by-ip-fail", "Failed to fetch failed-login by-IP rollup:", error);
      res.status(500).json({ error: "Failed to fetch grouped attempts" });
    }
  },
);

// Recent unauthorized declaration-read attempts (Task #109 audit feed),
// shaped to match the failed-logins endpoint so the dashboard can mirror
// the same UI pattern. Includes a 24h count for the Settings tile badge.
auditLogsRouter.get(
  "/declaration-read-attempts",
  checkAdminAuth,
  async (req, res) => {
    try {
      const limitRaw = Number.parseInt(
        typeof req.query.limit === "string" ? req.query.limit : "20",
        10,
      );
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
      // Optional `?ip=` filter — used by the by-IP drilldown to load just
      // that IP's attempts on demand instead of paging the whole feed.
      const ipFilter =
        typeof req.query.ip === "string" && req.query.ip.trim().length > 0
          ? req.query.ip.trim()
          : undefined;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [items, count24h] = await Promise.all([
        storage.getRecentDeclarationReadAttempts(limit, ipFilter),
        storage.getDeclarationReadAttemptCountSince(since),
      ]);

      res.json({
        items: items.map((row) => {
          // Surface the credentialType on the per-attempt row so the
          // forensic view can show "wrong_code" / "expired_code" / etc.
          // without each client having to JSON-parse new_value itself.
          let credentialType: string | null = null;
          try {
            const parsed =
              row.newValue && typeof row.newValue === "string"
                ? JSON.parse(row.newValue)
                : null;
            if (parsed && typeof parsed.credentialType === "string") {
              credentialType = parsed.credentialType;
            }
          } catch {
            credentialType = null;
          }
          return {
            id: row.id,
            action: row.action,
            caseId: row.targetId,
            ipAddress: row.ipAddress,
            userAgent: row.userAgent,
            credentialType,
            createdAt: row.createdAt,
          };
        }),
        count24h,
      });
    } catch (error) {
      warnOnce("admin:decl-read-attempts-fail", "Failed to fetch declaration-read audit rows:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch declaration-read attempts" });
    }
  },
);

// Same data rolled up per source IP so a brute-force scan collapses into
// a single row with a credential-type breakdown ("203.0.113.42 — 47
// attempts across 6 cases, 38 wrong_code + 9 case_missing").
auditLogsRouter.get(
  "/declaration-read-attempts/by-ip",
  checkAdminAuth,
  async (req, res) => {
    try {
      const windowHoursRaw = Number.parseFloat(
        typeof req.query.windowHours === "string"
          ? req.query.windowHours
          : "24",
      );
      const windowHours =
        Number.isFinite(windowHoursRaw) && windowHoursRaw > 0
          ? Math.min(windowHoursRaw, 24 * 30)
          : 24;
      const limitRaw = Number.parseInt(
        typeof req.query.limit === "string" ? req.query.limit : "200",
        10,
      );
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200;
      const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
      // Match the in-memory declaration-read limiter's 15min lockout.
      const throttleSince = new Date(Date.now() - 15 * 60 * 1000);

      const rows = await storage.getDeclarationReadAttemptsByIp(
        since,
        throttleSince,
        limit,
      );

      res.json({
        windowHours,
        items: rows.map((row) => ({
          ipAddress: row.ipAddress,
          attemptCount: row.attemptCount,
          unauthorizedCount: row.unauthorizedCount,
          rateLimitedCount: row.rateLimitedCount,
          distinctCaseCount: row.distinctCaseCount,
          distinctCaseIds: row.distinctCaseIds,
          credentialTypeCounts: row.credentialTypeCounts,
          firstAttemptAt: row.firstAttemptAt,
          lastAttemptAt: row.lastAttemptAt,
          isThrottled: row.isThrottled,
        })),
      });
    } catch (error) {
      warnOnce("admin:decl-read-by-ip-fail", "Failed to fetch declaration-read by-IP rollup:", error);
      res.status(500).json({ error: "Failed to fetch grouped attempts" });
    }
  },
);

export const adminSessionsRouter = Router();

adminSessionsRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const sessions = await storage.getActiveAdminSessions(ADMIN_USERNAME);
    const currentToken = getBearerToken(req);
    // Annotate the row matching the caller's bearer token. Strip the raw token
    // from every row in the response so the UI never has to handle it.
    const safe = sessions.map(({ token, ...rest }) => ({
      ...rest,
      isCurrent: !!currentToken && token === currentToken, // strict-equality-guard
    }));
    res.json(safe);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch admin sessions" });
  }
});

adminSessionsRouter.post("/", checkAdminAuth, async (req, res) => {
  try {
    const sessionInput = z.object({
      ipAddress: z.string().optional(),
      userAgent: z.string().optional(),
      location: z.string().optional(),
    }).parse(req.body);

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

    const session = await storage.runInTransaction(async (tx) => {
      const s = await storage.createAdminSession({
        adminUsername: ADMIN_USERNAME,
        token,
        ...sessionInput,
        expiresAt,
      }, tx);
      await storage.createAuditLog(
        {
          adminUsername: ADMIN_USERNAME,
          action: "admin_session_created",
          targetType: "admin_session",
          targetId: s.id,
          newValue: `expires ${expiresAt.toISOString()}`,
          ipAddress: getClientIp(req) ?? null,
          userAgent: req.headers["user-agent"]?.toString() ?? null,
        },
        tx,
      );
      return s;
    });
    res.json(session);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to create admin session" });
    }
  }
});

adminSessionsRouter.post("/revoke-others", checkAdminAuth, async (req, res) => {
  try {
    const currentToken = getBearerToken(req);
    if (!currentToken) {
      res.status(400).json({ error: "Missing bearer token" });
      return;
    }
    const current = await storage.getAdminSessionByToken(currentToken);
    if (!current) {
      res.status(401).json({ error: "Current session not found" });
      return;
    }

    const activeBefore = await storage.getActiveAdminSessions(ADMIN_USERNAME);
    const revoked = await storage.runInTransaction(async (tx) => {
      const count = await storage.revokeAllAdminSessions(
        ADMIN_USERNAME,
        current.id,
        tx,
      );
      await storage.createAuditLog(
        {
          adminUsername: ADMIN_USERNAME,
          action: "admin_sessions_revoke_others",
          targetType: "admin_session",
          targetId: current.id,
          previousValue: `${activeBefore.length} active`,
          newValue: `revoked ${count} (kept current)`,
          ipAddress: getClientIp(req) ?? null,
          userAgent: req.headers["user-agent"]?.toString() ?? null,
        },
        tx,
      );
      return count;
    });

    res.json({ success: true, revoked });
  } catch (error) {
    warnOnce("admin:revoke-others-failed", "revoke-others failed:", error);
    res.status(500).json({ error: "Failed to revoke other sessions" });
  }
});

adminSessionsRouter.post("/:id/revoke", checkAdminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const currentToken = getBearerToken(req);
    const current = currentToken
      ? await storage.getAdminSessionByToken(currentToken)
      : null;
    if (current && current.id === req.params.id) {
      // Don't let an admin lock themselves out of the very tab they're using —
      // the dedicated /api/admin/logout endpoint exists for that.
      res.status(400).json({ error: "Use logout to end the current session" });
      return;
    }
    await storage.runInTransaction(async (tx) => {
      await storage.revokeAdminSession(
        req.params.id,
        reason || "Manual revocation",
        tx,
      );
      await storage.createAuditLog(
        {
          adminUsername: ADMIN_USERNAME,
          action: "admin_session_revoked",
          targetType: "admin_session",
          targetId: req.params.id,
          previousValue: null,
          newValue: reason || "Manual revocation",
          ipAddress: getClientIp(req) ?? null,
          userAgent: req.headers["user-agent"]?.toString() ?? null,
        },
        tx,
      );
    });
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to revoke session" });
  }
});

export const notificationsRouter = Router();

notificationsRouter.get("/admin", checkAdminAuth, async (req, res) => {
  try {
    const notifications = await storage.getNotificationsByRecipient('admin', 'admin');
    res.json(notifications);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

notificationsRouter.get("/case/:caseId", async (req, res) => {
  try {
    const authorized = await isAuthorizedForCase(req, req.params.caseId);
    if (!authorized) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const notifs = await storage.getNotificationsByRecipient('user', req.params.caseId);
    res.json(notifs);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

notificationsRouter.post("/", checkAdminAuth, async (req, res) => {
  try {
    const notificationInput = z.object({
      recipientType: z.enum(['admin', 'user']),
      recipientId: z.string().optional(),
      type: z.string().min(1),
      title: z.string().min(1),
      body: z.string().optional(),
      link: z.string().optional(),
      metadata: z.string().optional()
    }).parse(req.body);

    const notification = await storage.createNotification(notificationInput);
    res.json(notification);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to create notification" });
    }
  }
});

notificationsRouter.post("/:id/read", async (req, res) => {
  try {
    const notifId = parseInt(req.params.id);
    if (!Number.isFinite(notifId)) {
      res.status(400).json({ error: "Invalid notification id" });
      return;
    }
    const notif = await storage.getNotificationById(notifId);
    if (!notif) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    if (notif.recipientType === 'admin') {
      const ok = await isValidAdminToken(req.headers.authorization);
      if (!ok) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    } else {
      // User notification read state belongs to the portal user only.
      // Admin tokens must not be able to silently clear user-facing action indicators.
      const caseId = notif.recipientId ?? '';
      const authorized = await isPortalSessionValidForCase(req, caseId);
      if (!authorized) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }
    await storage.markNotificationAsRead(notifId);
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

notificationsRouter.get("/admin/unread", checkAdminAuth, async (req, res) => {
  try {
    const count = await storage.getUnreadNotificationCount('admin', 'admin');
    res.json({ count });
  } catch (_e) {
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

notificationsRouter.delete("/admin/all", checkAdminAuth, async (req, res) => {
  try {
    await storage.clearAllAdminNotifications();
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to clear notifications" });
  }
});

export const userSessionsRouter = Router();

userSessionsRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const allSessions = await storage.getAllUserSessions();
    res.json(allSessions);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch user sessions" });
  }
});

userSessionsRouter.post("/:id/deactivate", checkAdminAuth, async (req, res) => {
  try {
    const session = await storage.deactivateUserSession(parseInt(req.params.id));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  } catch (_e) {
    res.status(500).json({ error: "Failed to deactivate session" });
  }
});

export function registerCaseSessionRoutes(router: Router) {
  router.get("/:id/sessions", checkAdminAuth, async (req, res) => {
    try {
      const sessions = await storage.getUserSessionsByCaseId(req.params.id);
      res.json(sessions);
    } catch (_e) {
      res.status(500).json({ error: "Failed to fetch user sessions" });
    }
  });

  router.post("/:id/sessions", checkAdminAuth, async (req, res) => {
    try {
      const sessionInput = z.object({
        sessionToken: z.string().min(1),
        ipAddress: z.string().optional(),
        userAgent: z.string().optional(),
        location: z.string().optional(),
        expiresAt: z.string().optional()
      }).parse(req.body);

      const session = await storage.createUserSession({
        caseId: req.params.id,
        ...sessionInput,
        expiresAt: sessionInput.expiresAt ? new Date(sessionInput.expiresAt) : undefined
      });
      res.json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
      } else {
        res.status(500).json({ error: "Failed to create user session" });
      }
    }
  });
}

export const twoFactorRouter = Router();

twoFactorRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const config = await storage.getAdminTwoFactor('Admin2025');
    res.json(config || { isEnabled: false });
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch 2FA config" });
  }
});

twoFactorRouter.post("/", checkAdminAuth, async (req, res) => {
  try {
    const configInput = z.object({
      adminUsername: z.string().min(1),
      secret: z.string().min(1),
      backupCodes: z.string().optional()
    }).parse(req.body);

    const config = await storage.createAdminTwoFactor(configInput);
    res.json(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to create 2FA config" });
    }
  }
});

twoFactorRouter.patch("/", checkAdminAuth, async (req, res) => {
  try {
    const configInput = z.object({
      isEnabled: z.boolean().optional(),
      backupCodes: z.string().optional()
    }).parse(req.body);

    const config = await storage.updateAdminTwoFactor('Admin2025', configInput);
    if (!config) {
      res.status(404).json({ error: "2FA config not found" });
      return;
    }
    res.json(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update 2FA config" });
    }
  }
});

// Admin-tunable runtime settings. Currently exposes the audit-log
// retention window so admins can lengthen it during a forensics
// investigation or shrink it to reclaim DB space without redeploying
// the server. The hourly sweep refreshes its cached value at the top of
// every tick, and we also kick a sweep on save so the new window takes
// effect immediately rather than after the next interval.
adminRouter.get(
  "/settings/audit-log-retention",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const setting = await readAuditLogRetentionSetting();
      res.json(setting);
    } catch (error) {
      warnOnce("admin:audit-log-retention-fail", "Failed to read audit-log retention setting:", error);
      res
        .status(500)
        .json({ error: "Failed to read audit-log retention setting" });
    }
  },
);

adminRouter.put(
  "/settings/audit-log-retention",
  checkAdminAuth,
  async (req, res) => {
    try {
      const body = z
        .object({
          days: z
            .number()
            .min(AUDIT_LOG_RETENTION_MIN_DAYS)
            .max(AUDIT_LOG_RETENTION_MAX_DAYS),
        })
        .parse(req.body);

      const previous = await readAuditLogRetentionSetting();
      // Task #157 — single transaction so an audit-write failure rolls
      // back the retention change. The post-commit cache refresh +
      // immediate sweep happen below.
      let applied: number;
      try {
        applied = await storage.runInTransaction(async (tx) => {
          const v = await saveAuditLogRetentionDays(
            body.days,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog({
            adminUsername: ADMIN_USERNAME || "unknown",
            action: "audit_log_retention_updated",
            targetType: "app_setting",
            targetId: "audit_log_retention_days",
            previousValue: JSON.stringify({ days: previous.days, source: previous.source }),
            newValue: JSON.stringify({ days: v }),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          }, tx);
          return v;
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-audit-log-retention-transaction",
          "Refusing to change audit-log retention: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      const { refreshAuditLogRetentionCache } = await import(
        "../audit-retention"
      );
      await refreshAuditLogRetentionCache();

      // Kick off an immediate sweep so the new window takes effect right
      // away rather than waiting up to an hour for the next tick. Don't
      // block the response on it — the sweep can run for a while when
      // the new window is much shorter than the old one.
      void runAuditLogSweep();
      void applied;

      const setting = await readAuditLogRetentionSetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

// Admin-tunable retention window for the community-participant cleanup
// sweep. Mirrors the audit-log retention pattern above: env var
// override wins for incident response, otherwise the DB-stored value
// is used (falling back to the hard-coded 90-day default). Saving
// refreshes the cached value immediately; the hourly sweep also
// re-reads it at the top of every tick. A companion POST runs the
// sweep on demand so admins can verify the new window without waiting
// up to an hour.
adminRouter.get(
  "/settings/community-participant-retention",
  checkAdminAuth,
  async (req, res) => {
    try {
      // Optional `?previewDays=` lets the SettingsTab preview "how many
      // rows would be removed at this draft window" before the admin
      // commits the change. Out-of-range values are silently clamped to
      // the min/max by readCommunityParticipantRetentionSetting; missing
      // or non-numeric values disable the preview.
      const previewRaw =
        typeof req.query.previewDays === "string"
          ? Number.parseFloat(req.query.previewDays)
          : NaN;
      const setting = await readCommunityParticipantRetentionSetting(
        Number.isFinite(previewRaw) ? { previewDays: previewRaw } : undefined,
      );
      res.json(setting);
    } catch (error) {
      warnOnce("admin:community-retention-fail", "Failed to read community-participant retention setting:", error);
      res
        .status(500)
        .json({ error: "Failed to read community-participant retention setting" });
    }
  },
);

adminRouter.put(
  "/settings/community-participant-retention",
  checkAdminAuth,
  async (req, res) => {
    try {
      const body = z
        .object({
          days: z
            .number()
            .min(COMMUNITY_PARTICIPANT_RETENTION_MIN_DAYS)
            .max(COMMUNITY_PARTICIPANT_RETENTION_MAX_DAYS),
        })
        .parse(req.body);

      const previous = await readCommunityParticipantRetentionSetting();
      // Task #157 — wrap save + audit in a single transaction.
      let applied: number;
      try {
        applied = await storage.runInTransaction(async (tx) => {
          const v = await saveCommunityParticipantRetentionDays(
            body.days,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog({
            adminUsername: ADMIN_USERNAME || "unknown",
            action: "community_participant_retention_updated",
            targetType: "app_setting",
            targetId: "community_participant_retention_days",
            previousValue: JSON.stringify({
              days: previous.days,
              source: previous.source,
            }),
            newValue: JSON.stringify({ days: v }),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          }, tx);
          return v;
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-community-participant-retention",
          "Refusing to change community-participant retention: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      const { refreshCommunityParticipantRetentionCache } = await import(
        "../community-cleanup"
      );
      await refreshCommunityParticipantRetentionCache();
      void applied;

      const setting = await readCommunityParticipantRetentionSetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

// On-demand trigger for the cleanup sweep. The hourly background sweep
// already runs unattended; this lets an admin verify the configured
// window or reclaim space immediately after a retention change. The
// sweep itself writes its own audit row when it removes anything; we
// additionally log the manual trigger here so the dashboard action is
// traceable even on a no-op sweep.
adminRouter.post(
  "/settings/community-participant-retention/run",
  checkAdminAuth,
  async (req, res) => {
    try {
      const triggeredBy = ADMIN_USERNAME || "unknown";
      // Task #161 — wrap the sweep + the manual-trigger audit row in a
      // single transaction so an audit-log failure rolls back the
      // deletion. The sweep's own in-batch audit row is now written
      // through the same executor (see runCommunityParticipantCleanup),
      // so all three writes (delete, in-sweep audit, trigger audit)
      // commit or rollback together.
      const result = await storage.runInTransaction(async (tx) => {
        const sweep = await runCommunityParticipantCleanup({
          triggeredBy,
          executor: tx,
        });
        await storage.createAuditLog(
          {
            adminUsername: triggeredBy,
            action: "community_participant_cleanup_run",
            targetType: "community_participants",
            targetId: null,
            previousValue: null,
            newValue: JSON.stringify(sweep),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          },
          tx,
        );
        return sweep;
      });
      res.json(result);
    } catch (error) {
      warnOnce(
        "admin:failed-to-run-community-participant-cleanup-on-dem",
        "Failed to run community-participant cleanup on demand:",
        error,
      );
      const message =
        error instanceof Error ? error.message : "Failed to run cleanup";
      res.status(500).json({ error: message });
    }
  },
);

// Admin-tunable cadence for the sealed-NDA integrity sweep. Mirrors the
// audit-log retention pattern above: env var override wins for incident
// response, otherwise the DB-stored value is used (falling back to the
// hard-coded 24h default). Saving reschedules the timer immediately.
adminRouter.get(
  "/settings/nda-integrity-sweep-interval",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { readNdaIntegritySweepIntervalSetting } = await import(
        "../nda-integrity-sweep"
      );
      const setting = await readNdaIntegritySweepIntervalSetting();
      res.json(setting);
    } catch (error) {
      warnOnce("admin:nda-sweep-interval-fail", "Failed to read NDA integrity sweep interval setting:", error);
      res
        .status(500)
        .json({ error: "Failed to read NDA integrity sweep interval setting" });
    }
  },
);

adminRouter.put(
  "/settings/nda-integrity-sweep-interval",
  checkAdminAuth,
  async (req, res) => {
    try {
      const {
        NDA_INTEGRITY_SWEEP_INTERVAL_MAX_HOURS,
        NDA_INTEGRITY_SWEEP_INTERVAL_MIN_HOURS,
        readNdaIntegritySweepIntervalSetting,
        saveNdaIntegritySweepIntervalHours,
      } = await import("../nda-integrity-sweep");

      const body = z
        .object({
          hours: z
            .number()
            .min(NDA_INTEGRITY_SWEEP_INTERVAL_MIN_HOURS)
            .max(NDA_INTEGRITY_SWEEP_INTERVAL_MAX_HOURS),
        })
        .parse(req.body);

      const previous = await readNdaIntegritySweepIntervalSetting();
      // Task #157 — wrap save + audit in a transaction; reschedule the
      // sweep timer after the commit succeeds.
      let applied: number;
      try {
        applied = await storage.runInTransaction(async (tx) => {
          const v = await saveNdaIntegritySweepIntervalHours(
            body.hours,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog({
            adminUsername: ADMIN_USERNAME || "unknown",
            action: "nda_integrity_sweep_interval_updated",
            targetType: "app_setting",
            targetId: "nda_integrity_sweep_interval_hours",
            previousValue: JSON.stringify({
              hours: previous.hours,
              source: previous.source,
            }),
            newValue: JSON.stringify({ hours: v }),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          }, tx);
          return v;
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-nda-sweep-interval-transaction",
          "Refusing to change NDA sweep interval: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      const { applyNdaIntegritySweepIntervalChange } = await import(
        "../nda-integrity-sweep"
      );
      await applyNdaIntegritySweepIntervalChange();
      void applied;

      const setting = await readNdaIntegritySweepIntervalSetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

// "All clear" heartbeat cadence for the integrity sweep. Same env-then-DB
// resolution as the interval setting above. Saving takes effect on the
// next sweep tick — no timer to reschedule.
adminRouter.get(
  "/settings/nda-integrity-sweep-summary-frequency",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { readNdaIntegritySweepSummaryFrequencySetting } = await import(
        "../nda-integrity-sweep"
      );
      const setting = await readNdaIntegritySweepSummaryFrequencySetting();
      res.json(setting);
    } catch (error) {
      warnOnce("admin:nda-sweep-summary-freq-fail", "Failed to read NDA integrity sweep summary frequency setting:", error);
      res.status(500).json({
        error: "Failed to read NDA integrity sweep summary frequency setting",
      });
    }
  },
);

adminRouter.put(
  "/settings/nda-integrity-sweep-summary-frequency",
  checkAdminAuth,
  async (req, res) => {
    try {
      const {
        NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_VALUES,
        readNdaIntegritySweepSummaryFrequencySetting,
        saveNdaIntegritySweepSummaryFrequency,
      } = await import("../nda-integrity-sweep");

      const body = z
        .object({
          frequency: z.enum(
            NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY_VALUES as unknown as [
              string,
              ...string[],
            ],
          ),
        })
        .parse(req.body);

      const previous = await readNdaIntegritySweepSummaryFrequencySetting();
      // Task #157 — wrap save + audit in a single transaction.
      try {
        await storage.runInTransaction(async (tx) => {
          const v = await saveNdaIntegritySweepSummaryFrequency(
            body.frequency,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog({
            adminUsername: ADMIN_USERNAME || "unknown",
            action: "nda_integrity_sweep_summary_frequency_updated",
            targetType: "app_setting",
            targetId: "nda_integrity_sweep_summary_frequency",
            previousValue: JSON.stringify({
              frequency: previous.frequency,
              source: previous.source,
            }),
            newValue: JSON.stringify({ frequency: v }),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          }, tx);
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-nda-sweep-summary-frequency-tra",
          "Refusing to change NDA sweep summary frequency: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      const setting = await readNdaIntegritySweepSummaryFrequencySetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

// Admin-tunable cooldown for the email-failure alert (Task #152). The
// dispatcher reads the value at send time, so changes take effect on
// the next failure without redeploying. Same env > DB > default
// precedence as the NDA sweep cadence above.
adminRouter.get(
  "/settings/email-failure-alert-cooldown",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { readEmailFailureAlertCooldownSetting } = await import(
        "../services/emailFailureAlert"
      );
      const setting = await readEmailFailureAlertCooldownSetting();
      res.json(setting);
    } catch (error) {
      warnOnce("admin:email-failure-cooldown-fail", "Failed to read email-failure alert cooldown setting:", error);
      res
        .status(500)
        .json({ error: "Failed to read email-failure alert cooldown setting" });
    }
  },
);

adminRouter.put(
  "/settings/email-failure-alert-cooldown",
  checkAdminAuth,
  async (req, res) => {
    try {
      const {
        EMAIL_FAILURE_ALERT_COOLDOWN_MAX_MINUTES,
        EMAIL_FAILURE_ALERT_COOLDOWN_MIN_MINUTES,
        readEmailFailureAlertCooldownSetting,
        saveEmailFailureAlertCooldownMinutes,
      } = await import("../services/emailFailureAlert");

      const body = z
        .object({
          minutes: z
            .number()
            .min(EMAIL_FAILURE_ALERT_COOLDOWN_MIN_MINUTES)
            .max(EMAIL_FAILURE_ALERT_COOLDOWN_MAX_MINUTES),
        })
        .parse(req.body);

      const previous = await readEmailFailureAlertCooldownSetting();
      try {
        await storage.runInTransaction(async (tx) => {
          const v = await saveEmailFailureAlertCooldownMinutes(
            body.minutes,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog({
            adminUsername: ADMIN_USERNAME || "unknown",
            action: "email_failure_alert_cooldown_updated",
            targetType: "app_setting",
            targetId: "email_failure_alert_cooldown_minutes",
            previousValue: JSON.stringify({
              minutes: previous.minutes,
              source: previous.source,
            }),
            newValue: JSON.stringify({ minutes: v }),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          }, tx);
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-email-failure-alert-cooldown-tr",
          "Refusing to change email-failure alert cooldown: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      const setting = await readEmailFailureAlertCooldownSetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

// Admin-tunable cooldown for the per-case document upload alert (Task #324).
// Mirrors the email-failure alert cooldown above: env > DB > default
// precedence, value is read at send time so changes apply immediately,
// audit-logged inside the same transaction as the setting write.
adminRouter.get(
  "/settings/doc-upload-alert-cooldown",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { readDocUploadAlertCooldownSetting } = await import(
        "../services/documentUploadAlert"
      );
      const setting = await readDocUploadAlertCooldownSetting();
      res.json(setting);
    } catch (error) {
      warnOnce("admin:doc-upload-alert-cooldown-fail", "Failed to read document upload alert cooldown setting:", error);
      res
        .status(500)
        .json({ error: "Failed to read document upload alert cooldown setting" });
    }
  },
);

adminRouter.put(
  "/settings/doc-upload-alert-cooldown",
  checkAdminAuth,
  async (req, res) => {
    try {
      const {
        DOC_UPLOAD_ALERT_COOLDOWN_MAX_MINUTES,
        DOC_UPLOAD_ALERT_COOLDOWN_MIN_MINUTES,
        readDocUploadAlertCooldownSetting,
        saveDocUploadAlertCooldownMinutes,
      } = await import("../services/documentUploadAlert");

      const body = z
        .object({
          minutes: z
            .number()
            .min(DOC_UPLOAD_ALERT_COOLDOWN_MIN_MINUTES)
            .max(DOC_UPLOAD_ALERT_COOLDOWN_MAX_MINUTES),
        })
        .parse(req.body);

      const previous = await readDocUploadAlertCooldownSetting();
      try {
        await storage.runInTransaction(async (tx) => {
          const v = await saveDocUploadAlertCooldownMinutes(
            body.minutes,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog({
            adminUsername: ADMIN_USERNAME || "unknown",
            action: "doc_upload_alert_cooldown_updated",
            targetType: "app_setting",
            targetId: "doc_upload_alert_cooldown_minutes",
            previousValue: JSON.stringify({
              minutes: previous.minutes,
              source: previous.source,
            }),
            newValue: JSON.stringify({ minutes: v }),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          }, tx);
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-document-upload-alert-cooldown",
          "Refusing to change document upload alert cooldown: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      const setting = await readDocUploadAlertCooldownSetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

// Admin-tunable health probe interval and alert cooldown.
// Both settings follow the same env > DB > default precedence pattern as
// the doc-upload and email-failure cooldowns above. Values are re-read on
// every probe scheduling cycle / every probe run, so changes take effect
// without a restart.

adminRouter.get(
  "/settings/health-probe-interval",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { readHealthProbeIntervalSetting } = await import(
        "../services/healthProbe"
      );
      const setting = await readHealthProbeIntervalSetting();
      res.json(setting);
    } catch (error) {
      warnOnce(
        "admin:health-probe-interval-read-fail",
        "Failed to read health probe interval setting:",
        error,
      );
      res
        .status(500)
        .json({ error: "Failed to read health probe interval setting" });
    }
  },
);

adminRouter.put(
  "/settings/health-probe-interval",
  checkAdminAuth,
  async (req, res) => {
    try {
      const {
        PROBE_INTERVAL_MIN_MINUTES,
        PROBE_INTERVAL_MAX_MINUTES,
        readHealthProbeIntervalSetting,
        saveHealthProbeIntervalMinutes,
        HEALTH_PROBE_INTERVAL_SETTING_KEY,
      } = await import("../services/healthProbe");

      const body = z
        .object({
          minutes: z
            .number()
            .min(PROBE_INTERVAL_MIN_MINUTES)
            .max(PROBE_INTERVAL_MAX_MINUTES),
        })
        .parse(req.body);

      const previous = await readHealthProbeIntervalSetting();
      try {
        await storage.runInTransaction(async (tx) => {
          const v = await saveHealthProbeIntervalMinutes(
            body.minutes,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog(
            {
              adminUsername: ADMIN_USERNAME || "unknown",
              action: "health_probe_interval_updated",
              targetType: "app_setting",
              targetId: HEALTH_PROBE_INTERVAL_SETTING_KEY,
              previousValue: JSON.stringify({
                minutes: previous.minutes,
                source: previous.source,
              }),
              newValue: JSON.stringify({ minutes: v }),
              ipAddress: getClientIp(req) ?? null,
              userAgent: req.headers["user-agent"]?.toString() ?? null,
            },
            tx,
          );
        });
      } catch (txErr) {
        warnOnce(
          "admin:health-probe-interval-tx-fail",
          "Refusing to change health probe interval: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      const setting = await readHealthProbeIntervalSetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

adminRouter.get(
  "/settings/health-probe-alert-cooldown",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { readHealthProbeAlertCooldownSetting } = await import(
        "../services/healthProbe"
      );
      const setting = await readHealthProbeAlertCooldownSetting();
      res.json(setting);
    } catch (error) {
      warnOnce(
        "admin:health-probe-cooldown-read-fail",
        "Failed to read health probe alert cooldown setting:",
        error,
      );
      res
        .status(500)
        .json({ error: "Failed to read health probe alert cooldown setting" });
    }
  },
);

adminRouter.put(
  "/settings/health-probe-alert-cooldown",
  checkAdminAuth,
  async (req, res) => {
    try {
      const {
        ALERT_COOLDOWN_MIN_MINUTES,
        ALERT_COOLDOWN_MAX_MINUTES,
        readHealthProbeAlertCooldownSetting,
        saveHealthProbeAlertCooldownMinutes,
        HEALTH_PROBE_COOLDOWN_SETTING_KEY,
      } = await import("../services/healthProbe");

      const body = z
        .object({
          minutes: z
            .number()
            .min(ALERT_COOLDOWN_MIN_MINUTES)
            .max(ALERT_COOLDOWN_MAX_MINUTES),
        })
        .parse(req.body);

      const previous = await readHealthProbeAlertCooldownSetting();
      try {
        await storage.runInTransaction(async (tx) => {
          const v = await saveHealthProbeAlertCooldownMinutes(
            body.minutes,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog(
            {
              adminUsername: ADMIN_USERNAME || "unknown",
              action: "health_probe_alert_cooldown_updated",
              targetType: "app_setting",
              targetId: HEALTH_PROBE_COOLDOWN_SETTING_KEY,
              previousValue: JSON.stringify({
                minutes: previous.minutes,
                source: previous.source,
              }),
              newValue: JSON.stringify({ minutes: v }),
              ipAddress: getClientIp(req) ?? null,
              userAgent: req.headers["user-agent"]?.toString() ?? null,
            },
            tx,
          );
        });
      } catch (txErr) {
        warnOnce(
          "admin:health-probe-cooldown-tx-fail",
          "Refusing to change health probe alert cooldown: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      const setting = await readHealthProbeAlertCooldownSetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

// Task #379 — Per-case mute toggle for the document upload alert. Builds
// on the global cooldown above: muting silently suppresses ALL alerts for
// the given case until unmuted, without raising the global cooldown for
// other cases. Both transitions are audit-logged inside the same
// transaction as the setting write so the audit trail can never drift
// from the live mute flag.
adminRouter.get(
  "/doc-upload-alert-muted",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { listMutedDocUploadAlertCaseIds } = await import(
        "../services/documentUploadAlert"
      );
      const caseIds = await listMutedDocUploadAlertCaseIds();
      res.json({ caseIds });
    } catch (error) {
      warnOnce("admin:doc-upload-muted-list-fail", "Failed to list muted doc upload alert cases:", error);
      res.status(500).json({ error: "Failed to list muted cases" });
    }
  },
);

adminRouter.get(
  "/cases/:id/doc-upload-alert-mute",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { getDocUploadAlertMuteState } = await import(
        "../services/documentUploadAlert"
      );
      const state = await getDocUploadAlertMuteState(req.params.id);
      res.json(state);
    } catch (error) {
      warnOnce("admin:doc-upload-mute-state-fail", "Failed to read doc upload alert mute state:", error);
      res.status(500).json({ error: "Failed to read mute state" });
    }
  },
);

adminRouter.put(
  "/cases/:id/doc-upload-alert-mute",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseId = req.params.id;
      const body = z.object({ muted: z.boolean() }).parse(req.body);

      const existing = await storage.getCaseById(caseId);
      if (!existing) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const {
        getDocUploadAlertMuteState,
        setDocUploadAlertMuted,
      } = await import("../services/documentUploadAlert");

      const previous = await getDocUploadAlertMuteState(caseId);
      let next = previous;
      try {
        await storage.runInTransaction(async (tx) => {
          next = await setDocUploadAlertMuted(
            caseId,
            body.muted,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog(
            {
              adminUsername: ADMIN_USERNAME || "unknown",
              action: body.muted
                ? "doc_upload_alert_muted"
                : "doc_upload_alert_unmuted",
              targetType: "case",
              targetId: caseId,
              previousValue: JSON.stringify({ muted: previous.muted }),
              newValue: JSON.stringify({ muted: next.muted }),
              ipAddress: getClientIp(req) ?? null,
              userAgent: req.headers["user-agent"]?.toString() ?? null,
            },
            tx,
          );
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-doc-upload-alert-mute-transacti",
          "Refusing to change doc upload alert mute: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The mute was NOT updated. Please try again.",
        });
        return;
      }

      res.json(next);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update mute";
      res.status(400).json({ error: message });
    }
  },
);

// Task #492 — per-case mute for the wallet-connect alert.
// Mirrors the doc-upload alert mute endpoints above. The audit row is
// written inside the same DB transaction as the setting write so the
// audit trail can never drift from the live mute flag.
adminRouter.get(
  "/wallet-connect-alert-muted",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { listMutedWalletConnectAlertCaseIds } = await import(
        "../services/walletConnectAlert"
      );
      const caseIds = await listMutedWalletConnectAlertCaseIds();
      res.json({ caseIds });
    } catch (error) {
      warnOnce("admin:wallet-connect-muted-list-fail", "Failed to list muted wallet connect alert cases:", error);
      res.status(500).json({ error: "Failed to list muted cases" });
    }
  },
);

adminRouter.get(
  "/cases/:id/wallet-connect-alert-mute",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { getWalletConnectAlertMuteState } = await import(
        "../services/walletConnectAlert"
      );
      const state = await getWalletConnectAlertMuteState(req.params.id);
      res.json(state);
    } catch (error) {
      warnOnce("admin:wallet-connect-mute-state-fail", "Failed to read wallet connect alert mute state:", error);
      res.status(500).json({ error: "Failed to read mute state" });
    }
  },
);

adminRouter.put(
  "/cases/:id/wallet-connect-alert-mute",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseId = req.params.id;
      const body = z.object({ muted: z.boolean() }).parse(req.body);

      const existing = await storage.getCaseById(caseId);
      if (!existing) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const {
        getWalletConnectAlertMuteState,
        setWalletConnectAlertMuted,
      } = await import("../services/walletConnectAlert");

      const previous = await getWalletConnectAlertMuteState(caseId);
      let next = previous;
      try {
        await storage.runInTransaction(async (tx) => {
          next = await setWalletConnectAlertMuted(
            caseId,
            body.muted,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog(
            {
              adminUsername: ADMIN_USERNAME || "unknown",
              action: body.muted
                ? "wallet_connect_alert_muted"
                : "wallet_connect_alert_unmuted",
              targetType: "case",
              targetId: caseId,
              previousValue: JSON.stringify({ muted: previous.muted }),
              newValue: JSON.stringify({ muted: next.muted }),
              ipAddress: getClientIp(req) ?? null,
              userAgent: req.headers["user-agent"]?.toString() ?? null,
            },
            tx,
          );
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-wallet-connect-alert-mute-trans",
          "Refusing to change wallet connect alert mute: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The mute was NOT updated. Please try again.",
        });
        return;
      }

      res.json(next);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update mute";
      res.status(400).json({ error: message });
    }
  },
);

// Read-only count of wallet-connect alert markers and how many are currently
// orphaned (owning case no longer exists). Lets the admin see whether a cleanup
// is even needed before clicking "Run cleanup now", and confirm the post-sweep
// state — mutates nothing. Mirrors the community-participant "currently
// eligible" count.
adminRouter.get(
  "/wallet-connect-alert-marker-cleanup",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { countOrphanedWalletConnectAlertMarkers } = await import(
        "../services/walletConnectAlert"
      );
      const result = await countOrphanedWalletConnectAlertMarkers();
      res.json(result);
    } catch (error) {
      warnOnce(
        "admin:failed-to-count-orphaned-wallet-connect-alert-mark",
        "Failed to count orphaned wallet-connect alert markers:",
        error,
      );
      const message =
        error instanceof Error ? error.message : "Failed to count markers";
      res.status(500).json({ error: message });
    }
  },
);

// Task #791 — on-demand trigger for the wallet-connect alert marker cleanup
// sweep. The hourly background sweep already runs unattended; this lets an
// admin reclaim orphaned fired/mute markers immediately and confirm the sweep
// is working. Mirrors the community-participant cleanup trigger: the sweep +
// the manual-trigger audit row are wrapped in one transaction so an audit
// failure rolls back the deletion, and the sweep's own in-batch audit row is
// written through the same executor.
adminRouter.post(
  "/wallet-connect-alert-marker-cleanup/run",
  checkAdminAuth,
  async (req, res) => {
    try {
      const triggeredBy = ADMIN_USERNAME || "unknown";
      const { cleanupOrphanedWalletConnectAlertMarkers } = await import(
        "../services/walletConnectAlert"
      );
      const result = await storage.runInTransaction(async (tx) => {
        const sweep = await cleanupOrphanedWalletConnectAlertMarkers({
          triggeredBy,
          executor: tx,
        });
        await storage.createAuditLog(
          {
            adminUsername: triggeredBy,
            action: "wallet_connect_alert_marker_cleanup_run",
            targetType: "app_settings",
            targetId: null,
            previousValue: null,
            newValue: JSON.stringify(sweep),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          },
          tx,
        );
        return sweep;
      });
      res.json(result);
    } catch (error) {
      warnOnce(
        "admin:failed-to-run-wallet-connect-alert-marker-cleanup",
        "Failed to run wallet-connect alert marker cleanup on demand:",
        error,
      );
      const message =
        error instanceof Error ? error.message : "Failed to run cleanup";
      res.status(500).json({ error: message });
    }
  },
);

// Read-only count of fired markers currently missing a
// `wallet_connect_completed` audit row — i.e. how many rows a backfill would
// insert if it ran right now. Mirrors the marker-cleanup count route so admins
// can gauge whether a backfill is needed before clicking the button.
adminRouter.get(
  "/wallet-connect-completion-backfill",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { countMissingWalletConnectCompletions } = await import(
        "../services/walletConnectAlert"
      );
      const result = await countMissingWalletConnectCompletions();
      res.json(result);
    } catch (error) {
      warnOnce(
        "admin:failed-to-count-missing-wallet-connect-completions",
        "Failed to count missing wallet-connect completions:",
        error,
      );
      const message =
        error instanceof Error ? error.message : "Failed to count completions";
      res.status(500).json({ error: message });
    }
  },
);

// Task #842 — on-demand trigger for the durable wallet-connect completion
// backfill. The backfill normally runs once at boot to reconstruct any missing
// `wallet_connect_completed` audit rows from the fired markers; this lets an
// admin force it without a restart and see how many rows were inserted. Mirrors
// the marker-cleanup trigger: the backfill (which inserts the completion rows
// through the passed executor) plus the manual-trigger audit row are wrapped in
// one transaction so an audit failure rolls back the inserts.
adminRouter.post(
  "/wallet-connect-completion-backfill/run",
  checkAdminAuth,
  async (req, res) => {
    try {
      const triggeredBy = ADMIN_USERNAME || "unknown";
      const { backfillMissingWalletConnectCompletions } = await import(
        "../services/walletConnectAlert"
      );
      const result = await storage.runInTransaction(async (tx) => {
        const backfill = await backfillMissingWalletConnectCompletions({
          executor: tx,
        });
        await storage.createAuditLog(
          {
            adminUsername: triggeredBy,
            action: "wallet_connect_completion_backfill_run",
            targetType: "app_settings",
            targetId: null,
            previousValue: null,
            newValue: JSON.stringify(backfill),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          },
          tx,
        );
        return backfill;
      });
      res.json(result);
    } catch (error) {
      warnOnce(
        "admin:failed-to-run-wallet-connect-completion-backfill-o",
        "Failed to run wallet-connect completion backfill on demand:",
        error,
      );
      const message =
        error instanceof Error ? error.message : "Failed to run backfill";
      res.status(500).json({ error: message });
    }
  },
);

// Task #800 — admin-tunable cadence for the wallet-connect alert marker
// cleanup sweep. Mirrors the NDA integrity sweep cadence pattern: env var
// override wins for incident response, otherwise the DB-stored value is used
// (falling back to the hard-coded hourly default). The stored value is in
// milliseconds to match the WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS env
// override; saving reschedules the sweep timer immediately.
adminRouter.get(
  "/settings/wallet-connect-alert-cleanup-interval",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { readWalletConnectAlertCleanupIntervalSetting } = await import(
        "../services/walletConnectAlert"
      );
      const setting = await readWalletConnectAlertCleanupIntervalSetting();
      res.json(setting);
    } catch (error) {
      warnOnce(
        "admin:wallet-connect-cleanup-interval-fail",
        "Failed to read wallet-connect alert cleanup interval setting:",
        error,
      );
      res.status(500).json({
        error: "Failed to read wallet-connect alert cleanup interval setting",
      });
    }
  },
);

adminRouter.put(
  "/settings/wallet-connect-alert-cleanup-interval",
  checkAdminAuth,
  async (req, res) => {
    try {
      const {
        WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS,
        WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS,
        readWalletConnectAlertCleanupIntervalSetting,
        saveWalletConnectAlertCleanupIntervalMs,
        applyCleanupIntervalChange,
      } = await import("../services/walletConnectAlert");

      const body = z
        .object({
          ms: z
            .number()
            .min(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MIN_MS)
            .max(WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MAX_MS),
        })
        .parse(req.body);

      const previous = await readWalletConnectAlertCleanupIntervalSetting();
      // Task #157 pattern — wrap save + audit in a single transaction; the
      // timer reschedule runs after the commit succeeds.
      try {
        await storage.runInTransaction(async (tx) => {
          const v = await saveWalletConnectAlertCleanupIntervalMs(
            body.ms,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog(
            {
              adminUsername: ADMIN_USERNAME || "unknown",
              action: "wallet_connect_alert_cleanup_interval_updated",
              targetType: "app_setting",
              targetId: "wallet_connect_alert_cleanup_interval_ms",
              previousValue: JSON.stringify({
                ms: previous.ms,
                source: previous.source,
              }),
              newValue: JSON.stringify({ ms: v }),
              ipAddress: getClientIp(req) ?? null,
              userAgent: req.headers["user-agent"]?.toString() ?? null,
            },
            tx,
          );
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-wallet-connect-alert-cleanup-in",
          "Refusing to change wallet-connect alert cleanup interval: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      await applyCleanupIntervalChange();

      const setting = await readWalletConnectAlertCleanupIntervalSetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

// Read-only count of stale community_thread_views rows (older than the
// fixed 48h TTL) so admins can gauge the pending cleanup volume before
// triggering the sweep. Mirrors the eligible-count preview on the
// community-participant card; null staleCount means the query failed.
adminRouter.get(
  "/community-thread-views-cleanup/count",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { countStaleCommunityThreadViews, COMMUNITY_THREAD_VIEWS_TTL_HOURS } =
        await import("../community-thread-views-cleanup");
      const staleCount = await countStaleCommunityThreadViews();
      const cutoff = new Date(
        Date.now() - COMMUNITY_THREAD_VIEWS_TTL_HOURS * 60 * 60 * 1000,
      );
      res.json({
        staleCount,
        cutoff: cutoff.toISOString(),
        ttlHours: COMMUNITY_THREAD_VIEWS_TTL_HOURS,
      });
    } catch (error) {
      warnOnce(
        "admin:failed-to-count-stale-community-thread-views",
        "Failed to count stale community thread-views rows:",
        error,
      );
      const message =
        error instanceof Error ? error.message : "Failed to count stale rows";
      res.status(500).json({ error: message });
    }
  },
);

// Task #802 — on-demand trigger for the community thread-views cleanup
// sweep (Task #640). The hourly background sweep already runs unattended;
// this lets an admin reclaim stale dedup rows immediately and confirm the
// sweep is working, mirroring the community-participant / wallet-connect
// triggers. We wrap the sweep in one transaction so its own
// `community_thread_views_cleanup` audit row (now attributed to the acting
// admin instead of "system", per Task #770) commits or rolls back together
// with the deletion. No separate "_run" audit action is needed — the sweep
// already records the canonical row.
adminRouter.post(
  "/community-thread-views-cleanup/run",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const triggeredBy = ADMIN_USERNAME || "unknown";
      const { runCommunityThreadViewsCleanup } = await import(
        "../community-thread-views-cleanup"
      );
      const result = await storage.runInTransaction(async (tx) =>
        runCommunityThreadViewsCleanup({ triggeredBy, executor: tx }),
      );
      res.json(result);
    } catch (error) {
      warnOnce(
        "admin:failed-to-run-community-thread-views-cleanup-on-de",
        "Failed to run community thread-views cleanup on demand:",
        error,
      );
      const message =
        error instanceof Error ? error.message : "Failed to run cleanup";
      res.status(500).json({ error: message });
    }
  },
);

// Admin-tunable grace window for the stale-sweep watchdog. Same env >
// DB > default precedence as the sweep interval above. The watchdog
// declares the nightly sweep "stale" once now - last_success_at
// exceeds intervalHours + graceHours, so loosening this absorbs
// scheduler drift and tightening it speeds up alerting after a
// suspected incident. Saving refreshes the cached value immediately;
// the watchdog reads it on its next tick (within ~1h).
adminRouter.get(
  "/settings/nda-integrity-sweep-stale-grace",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { readNdaIntegritySweepStaleGraceSetting } = await import(
        "../nda-integrity-sweep"
      );
      const setting = await readNdaIntegritySweepStaleGraceSetting();
      res.json(setting);
    } catch (error) {
      warnOnce("admin:nda-sweep-stale-grace-fail", "Failed to read NDA integrity sweep stale-grace setting:", error);
      res.status(500).json({
        error: "Failed to read NDA integrity sweep stale-grace setting",
      });
    }
  },
);

adminRouter.put(
  "/settings/nda-integrity-sweep-stale-grace",
  checkAdminAuth,
  async (req, res) => {
    try {
      const {
        NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MAX,
        NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MIN,
        readNdaIntegritySweepStaleGraceSetting,
        saveNdaIntegritySweepStaleGraceHours,
      } = await import("../nda-integrity-sweep");

      const body = z
        .object({
          hours: z
            .number()
            .min(NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MIN)
            .max(NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS_MAX),
        })
        .parse(req.body);

      const previous = await readNdaIntegritySweepStaleGraceSetting();
      // Task #157 — wrap save + audit in a single transaction; refresh
      // the watchdog cache after commit.
      try {
        await storage.runInTransaction(async (tx) => {
          const v = await saveNdaIntegritySweepStaleGraceHours(
            body.hours,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog({
            adminUsername: ADMIN_USERNAME || "unknown",
            action: "nda_integrity_sweep_stale_grace_updated",
            targetType: "app_setting",
            targetId: "nda_integrity_sweep_stale_grace_hours",
            previousValue: JSON.stringify({
              hours: previous.hours,
              source: previous.source,
            }),
            newValue: JSON.stringify({ hours: v }),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          }, tx);
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-nda-sweep-stale-grace-transacti",
          "Refusing to change NDA sweep stale-grace: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      const { refreshNdaIntegritySweepStaleGraceCache } = await import(
        "../nda-integrity-sweep"
      );
      await refreshNdaIntegritySweepStaleGraceCache();

      const setting = await readNdaIntegritySweepStaleGraceSetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

// Operator-initiated deliverability test for the document upload alert
// email. Renders the alert in "TEST" mode with dummy data and dispatches
// it to whatever recipient list is currently in force — env override wins,
// otherwise the DB-stored value, with fallback to ADMIN_ALERT_EMAIL.
// Audit-logged as `email_document_upload_alert_test` /
// `email_document_upload_alert_test_failed`.
adminRouter.post(
  "/settings/document-upload-alert-email/test",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { readDocumentUploadAlertEmailSetting } = await import(
        "../routes/content"
      );
      const setting = await readDocumentUploadAlertEmailSetting();
      const recipients = setting.recipients;
      if (recipients.length === 0) {
        try {
          await storage.createAuditLog({
            adminUsername: ADMIN_USERNAME || "unknown",
            action: "email_document_upload_alert_test_failed",
            targetType: "app_setting",
            targetId: "document_upload_alert_email",
            newValue:
              "Document upload alert test NOT sent: no recipient configured (set DOCUMENT_UPLOAD_ALERT_EMAIL / ADMIN_ALERT_EMAIL env var or app_settings.document_upload_alert_email).",
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          });
        } catch (logErr) {
          warnOnce(
            "admin:failed-to-write-document-upload-alert-test-missing",
            "Failed to write document-upload-alert-test missing-recipient audit log:",
            logErr,
          );
        }
        res.status(400).json({
          success: false,
          error:
            "No recipient configured. Save a recipient address before sending a test.",
        });
        return;
      }

      const { emailService } = await import("../services/EmailService");
      const dashboardUrl = getPublicAdminUrl();

      let sendResult: { success: boolean; error?: string };
      try {
        sendResult = await emailService.sendUserDocumentUploadedAlert({
          to: recipients,
          caseId: "CASE-0000",
          documentType: "Identity Verification (KYC)",
          fileName: "example-document.pdf",
          dashboardUrl,
          testMode: true,
        });
      } catch (err) {
        sendResult = {
          success: false,
          error:
            err instanceof Error ? err.message : "unexpected SMTP error",
        };
      }

      const recipientLabel = recipients.join(", ");
      try {
        await storage.createAuditLog({
          adminUsername: ADMIN_USERNAME || "unknown",
          action: sendResult.success
            ? "email_document_upload_alert_test"
            : "email_document_upload_alert_test_failed",
          targetType: "app_setting",
          targetId: "document_upload_alert_email",
          newValue: sendResult.success
            ? `Document upload alert test email sent to ${recipientLabel} (source: ${setting.source}).`
            : `Document upload alert test email FAILED to ${recipientLabel}: ${sendResult.error ?? "unknown error"} (source: ${setting.source}).`,
          ipAddress: getClientIp(req) ?? null,
          userAgent: req.headers["user-agent"]?.toString() ?? null,
        });
      } catch (logErr) {
        warnOnce(
          "admin:failed-to-write-document-upload-alert-test-audit-l",
          "Failed to write document-upload-alert-test audit log:",
          logErr,
        );
      }

      if (!sendResult.success) {
        res.status(502).json({
          success: false,
          error: sendResult.error ?? "Failed to send test alert email",
          recipients,
          source: setting.source,
        });
        return;
      }
      res.json({ success: true, recipients, source: setting.source });
    } catch (error) {
      warnOnce("admin:document-upload-alert-email-test-failed", "Document upload alert email test failed:", error);
      const msg =
        error instanceof Error ? error.message : "Failed to send test alert";
      res.status(500).json({ success: false, error: msg });
    }
  },
);

// Admin-editable recipient for document upload alert emails.
// Resolution order: DOCUMENT_UPLOAD_ALERT_EMAIL env var → DB setting →
// ADMIN_ALERT_EMAIL fallback. An empty stored value means the admin
// has not configured a dedicated inbox and the shared tamper-alert
// recipient will continue to receive upload notifications as before.
adminRouter.get(
  "/settings/document-upload-alert-email",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { readDocumentUploadAlertEmailSetting } = await import(
        "../routes/content"
      );
      const setting = await readDocumentUploadAlertEmailSetting();
      res.json(setting);
    } catch (error) {
      warnOnce("admin:doc-upload-alert-email-fail", "Failed to read document upload alert email setting:", error);
      res
        .status(500)
        .json({ error: "Failed to read document upload alert email setting" });
    }
  },
);

adminRouter.patch(
  "/settings/document-upload-alert-email",
  checkAdminAuth,
  async (req, res) => {
    try {
      const {
        readDocumentUploadAlertEmailSetting,
        saveDocumentUploadAlertEmailRecipients,
        validateDocumentUploadAlertEmailRecipients,
        InvalidDocumentUploadAlertEmailError,
      } = await import("../routes/content");

      const body = z
        .object({ value: z.string().max(2000) })
        .parse(req.body);

      try {
        validateDocumentUploadAlertEmailRecipients(body.value);
      } catch (validationErr) {
        if (validationErr instanceof InvalidDocumentUploadAlertEmailError) {
          res.status(400).json({ error: validationErr.message });
          return;
        }
        throw validationErr;
      }

      const previous = await readDocumentUploadAlertEmailSetting();
      try {
        await storage.runInTransaction(async (tx) => {
          const next = await saveDocumentUploadAlertEmailRecipients(
            body.value,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog({
            adminUsername: ADMIN_USERNAME || "unknown",
            action: "document_upload_alert_email_updated",
            targetType: "app_setting",
            targetId: "document_upload_alert_email",
            previousValue: JSON.stringify({
              storedValue: previous.storedValue,
              recipients: previous.recipients,
            }),
            newValue: JSON.stringify({
              storedValue: next.storedValue,
              recipients: next.recipients,
            }),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          }, tx);
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-document-upload-alert-email-tra",
          "Refusing to change document upload alert email: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      const setting = await readDocumentUploadAlertEmailSetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

// Admin-editable recipient (or comma-separated distribution list) for
// the sealed-NDA tamper alert email. Mirrors the sweep-interval pattern
// above: env var override wins for operator-level pinning, otherwise
// the DB-stored value is used. An empty value clears the override and
// the sweep silently no-ops (the in-dashboard notification + audit log
// still fire).
adminRouter.get(
  "/settings/tamper-alert-email",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { readAdminAlertEmailSetting } = await import(
        "../nda-integrity-sweep"
      );
      const setting = await readAdminAlertEmailSetting();
      res.json(setting);
    } catch (error) {
      warnOnce("admin:tamper-alert-email-fail", "Failed to read tamper alert email setting:", error);
      res
        .status(500)
        .json({ error: "Failed to read tamper alert email setting" });
    }
  },
);

adminRouter.patch(
  "/settings/tamper-alert-email",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { readAdminAlertEmailSetting, saveAdminAlertEmailRecipients } =
        await import("../nda-integrity-sweep");

      const body = z
        .object({
          // Empty string is a valid input — it clears the override.
          value: z.string().max(2000),
        })
        .parse(req.body);

      const previous = await readAdminAlertEmailSetting();
      // Task #157 — wrap save + audit in a transaction. We re-read the
      // setting after commit so the response carries the fully-resolved
      // shape (source/envOverride/updatedAt fields the in-tx return can't
      // see).
      try {
        await storage.runInTransaction(async (tx) => {
          const next = await saveAdminAlertEmailRecipients(
            body.value,
            ADMIN_USERNAME || null,
            tx,
          );
          await storage.createAuditLog({
            adminUsername: ADMIN_USERNAME || "unknown",
            action: "tamper_alert_email_updated",
            targetType: "app_setting",
            targetId: "admin_alert_email",
            previousValue: JSON.stringify({
              storedValue: previous.storedValue,
              recipients: previous.recipients,
            }),
            newValue: JSON.stringify({
              storedValue: next.storedValue,
              recipients: next.recipients,
            }),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          }, tx);
        });
      } catch (txErr) {
        warnOnce(
          "admin:refusing-to-change-tamper-alert-email-transaction",
          "Refusing to change tamper alert email: transaction failed:",
          txErr,
        );
        res.status(503).json({
          error:
            "Could not record the change in the audit log. The setting was NOT updated. Please try again.",
        });
        return;
      }

      const setting = await readAdminAlertEmailSetting();
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to update setting";
      res.status(400).json({ error: message });
    }
  },
);

// Operator-initiated deliverability test for the sealed-NDA tamper
// alert email. Renders the alert in "TEST" mode (zero failed rows,
// "[TEST]" in the subject/preheader) and dispatches it to whatever
// recipient list is currently in force — env override wins, otherwise
// the DB-stored value. Lets ops verify SMTP without waiting for a real
// tamper event. Audit-logged as `email_nda_integrity_test` /
// `email_nda_integrity_test_failed`.
adminRouter.post(
  "/settings/tamper-alert-email/test",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { readAdminAlertEmailSetting } = await import(
        "../nda-integrity-sweep"
      );
      const setting = await readAdminAlertEmailSetting();
      const recipients = setting.recipients;
      if (recipients.length === 0) {
        try {
          await storage.createAuditLog({
            adminUsername: ADMIN_USERNAME || "unknown",
            action: "email_nda_integrity_test_failed",
            targetType: "app_setting",
            targetId: "admin_alert_email",
            newValue:
              "Tamper alert test NOT sent: no recipient configured (set ADMIN_ALERT_EMAIL env var or app_settings.admin_alert_email).",
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          });
        } catch (logErr) {
          warnOnce(
            "admin:failed-to-write-tamper-alert-test-missing-recipien",
            "Failed to write tamper-alert-test missing-recipient audit log:",
            logErr,
          );
        }
        res.status(400).json({
          success: false,
          error:
            "No recipient configured. Save a recipient address before sending a test.",
        });
        return;
      }

      const { emailService } = await import("../services/EmailService");
      const dashboardUrl = getPublicAdminUrl();

      const now = new Date();
      let sendResult: { success: boolean; error?: string };
      try {
        sendResult = await emailService.sendNdaIntegrityFailureAlert({
          to: recipients,
          sweepFinishedAt: now.toISOString(),
          totalChecked: 0,
          failedRows: 0,
          failedCaseIds: [],
          dashboardUrl,
          testMode: true,
        });
      } catch (err) {
        sendResult = {
          success: false,
          error:
            err instanceof Error ? err.message : "unexpected SMTP error",
        };
      }

      const recipientLabel = recipients.join(", ");
      try {
        await storage.createAuditLog({
          adminUsername: ADMIN_USERNAME || "unknown",
          action: sendResult.success
            ? "email_nda_integrity_test"
            : "email_nda_integrity_test_failed",
          targetType: "app_setting",
          targetId: "admin_alert_email",
          newValue: sendResult.success
            ? `Tamper alert test email sent to ${recipientLabel} (source: ${setting.source}).`
            : `Tamper alert test email FAILED to ${recipientLabel}: ${sendResult.error ?? "unknown error"} (source: ${setting.source}).`,
          ipAddress: getClientIp(req) ?? null,
          userAgent: req.headers["user-agent"]?.toString() ?? null,
        });
      } catch (logErr) {
        warnOnce(
          "admin:failed-to-write-tamper-alert-test-audit-log",
          "Failed to write tamper-alert-test audit log:",
          logErr,
        );
      }

      if (!sendResult.success) {
        res.status(502).json({
          success: false,
          error: sendResult.error ?? "Failed to send test alert email",
          recipients,
          source: setting.source,
        });
        return;
      }
      res.json({ success: true, recipients, source: setting.source });
    } catch (error) {
      warnOnce("admin:tamper-alert-email-test-failed", "Tamper alert email test failed:", error);
      const msg =
        error instanceof Error ? error.message : "Failed to send test alert";
      res.status(500).json({ success: false, error: msg });
    }
  },
);

adminRouter.post("/seed-community", checkAdminAuth, async (req, res) => {
  try {
    const { seedCommunityData } = await import("../seed-community");
    const result = await seedCommunityData();
    res.json(result);
  } catch (error) {
    warnOnce("admin:seed-error", "Seed error:", error);
    res.status(500).json({ error: "Failed to seed community data" });
  }
});

// ============================================================
// Visit History — admin-only forensic browsing of past sessions
// ============================================================
//
// This router is mounted at `/api/admin/visit-history` and surfaces the
// rows that `end-session` writes into `visitor_history`. The list
// endpoint is paginated + filterable so the table can scale; stats and
// detail endpoints back the dashboard tiles and the per-session drawer.
// All endpoints are auth-gated.
export const visitHistoryRouter = Router();

visitHistoryRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const limitRaw = Number.parseInt(
      typeof req.query.limit === "string" ? req.query.limit : "50",
      10,
    );
    const offsetRaw = Number.parseInt(
      typeof req.query.offset === "string" ? req.query.offset : "0",
      10,
    );
    const minRiskRaw = Number.parseInt(
      typeof req.query.minRisk === "string" ? req.query.minRisk : "0",
      10,
    );

    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const offset =
      Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
    const minRisk =
      Number.isFinite(minRiskRaw) && minRiskRaw > 0 ? minRiskRaw : 0;
    const search =
      typeof req.query.search === "string" ? req.query.search : undefined;
    const country =
      typeof req.query.country === "string" && req.query.country.length > 0
        ? req.query.country
        : undefined;
    const persona =
      typeof req.query.persona === "string" && req.query.persona.length > 0
        ? req.query.persona
        : undefined;

    const result = await storage.listVisitorHistory({
      limit,
      offset,
      search,
      country,
      persona,
      minRisk,
    });

    res.json({ ...result, limit, offset });
  } catch (error) {
    warnOnce("admin:visit-history-list-fail", "List visit history error:", error);
    res.status(500).json({ error: "Failed to list visit history" });
  }
});

visitHistoryRouter.get("/stats", checkAdminAuth, async (req, res) => {
  try {
    const daysRaw = Number.parseInt(
      typeof req.query.days === "string" ? req.query.days : "7",
      10,
    );
    const days =
      Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 7;
    const stats = await storage.getVisitorHistoryStats(days);
    res.json({ days, ...stats });
  } catch (error) {
    warnOnce("admin:visit-history-stats-fail", "Visit history stats error:", error);
    res.status(500).json({ error: "Failed to fetch visit history stats" });
  }
});

visitHistoryRouter.get("/:id", checkAdminAuth, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const row = await storage.getVisitorHistoryById(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (error) {
    warnOnce("admin:visit-history-get-fail", "Get visit history error:", error);
    res.status(500).json({ error: "Failed to fetch visit history" });
  }
});

// ============================================================================
// Declaration of Compliance — admin endpoints
// ============================================================================

// Mark a case as "needs declaration" so the user sees the form in their portal.
// Also mints (or accepts) a per-case access code that the admin will share
// with the user. The code is valid for 24 hours from the moment of issue.
// When the optional `sendEmail` flag is true and the case has a userEmail
// on file, an email is delivered with the access code, the portal link and
// the 24-hour expiry. The body of that email can be edited per-send via the
// `emailOverrides` payload (subject + intro + whatToDo bullets + closing note).
const requestDeclarationOverridesSchema = z.object({
  accessCode: z.string().trim().min(4).max(64).optional(),
  sendEmail: z.boolean().optional(),
  emailOverrides: z
    .object({
      subject: z.string().min(1).max(300).optional(),
      intro: z.string().max(4000).optional(),
      whatToDo: z.array(z.string().max(600)).max(20).optional(),
      closingNote: z.string().max(2000).optional(),
    })
    .optional(),
});

const DECLARATION_ACCESS_TTL_MS = 24 * 60 * 60 * 1000;

adminRouter.post(
  "/cases/:id/request-declaration",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminUser =
        (req as Request & { adminUsername?: string }).adminUsername ?? "admin";

      const parsed = requestDeclarationOverridesSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request payload" });
        return;
      }
      const { accessCode: bodyCodeRaw, sendEmail, emailOverrides } = parsed.data;
      const bodyCode = (bodyCodeRaw ?? "").trim();
      const declarationAccessCode =
        bodyCode.length >= 4
          ? bodyCode
          : crypto.randomInt(10000000, 100000000).toString();

      const declarationAccessExpiresAt = new Date(
        Date.now() + DECLARATION_ACCESS_TTL_MS,
      );

      // Task #156 — bind the declaration-request case mutation to a
      // matching `request_declaration` audit row so a failed audit write
      // rolls the case back. (Mirrors Task #144's pattern.)
      let updated: Awaited<ReturnType<typeof storage.updateCase>>;
      try {
        updated = await storage.runInTransaction(async (tx) => {
          const u = await storage.updateCase(
            id,
            {
              declarationStatus: "pending",
              declarationRequestedAt: new Date(),
              declarationRequestedBy: adminUser,
              declarationAccessCode,
              declarationAccessExpiresAt,
            },
            tx,
          );
          if (!u) return undefined;
          await storage.createAuditLog(
            {
              adminUsername: adminUser,
              action: "request_declaration",
              targetType: "case",
              targetId: id,
              newValue: JSON.stringify({
                declarationAccessExpiresAt:
                  declarationAccessExpiresAt.toISOString(),
              }).slice(0, 4000),
            },
            tx,
          );
          return u;
        });
      } catch (txErr) {
        warnOnce("admin:request-declaration-transaction-failed", "[admin] request-declaration transaction failed:", txErr);
        return res
          .status(500)
          .json({ error: "Failed to request declaration" });
      }
      if (!updated) return res.status(404).json({ error: "Case not found" });

      let emailResult: { sent: boolean; error?: string } = { sent: false };

      if (sendEmail) {
        if (!updated.userEmail) {
          emailResult = {
            sent: false,
            error: "No email address on file for this user",
          };
        } else {
          const { emailService } = await import("../services/EmailService");
          const userName =
            (updated.userName ?? "").trim() || updated.userEmail;
          const caseReference = updated.id;

          const subject =
            emailOverrides?.subject?.trim() ||
            `Your Declaration Portal Has Been Opened — Case ${caseReference}`;

          const bodyPreview = [
            `Declaration access code: ${declarationAccessCode}`,
            `Valid until: ${declarationAccessExpiresAt.toUTCString()} (24h)`,
            "",
            emailOverrides?.intro ?? "",
            "",
            "What you need to do:",
            ...((emailOverrides?.whatToDo && emailOverrides.whatToDo.length > 0
              ? emailOverrides.whatToDo
              : [
                  "Open the secure portal using the link in this email.",
                  "Enter the access code shown above.",
                  "Complete and submit the Declaration of Compliance before expiry.",
                ]
            ).map((s) => `  • ${s}`)),
            "",
            emailOverrides?.closingNote ?? "",
          ].join("\n");

          let emailRecord: Awaited<
            ReturnType<typeof storage.createCaseEmail>
          > | null = null;
          try {
            emailRecord = await storage.createCaseEmail({
              caseId: id,
              toEmail: updated.userEmail,
              subject,
              body: bodyPreview,
              status: "pending",
              sentBy: adminUser,
            });
          } catch (logErr) {
            warnOnce("admin:createcaseemail-failed", "createCaseEmail failed:", logErr);
          }

          const result = await emailService.sendDeclarationAccessEmail(
            updated.userEmail,
            userName,
            caseReference,
            declarationAccessCode,
            declarationAccessExpiresAt,
            emailOverrides,
          );

          if (emailRecord) {
            try {
              await storage.updateCaseEmailStatus(
                emailRecord.id,
                result.success ? "sent" : "failed",
                result.success ? undefined : result.error,
              );
            } catch (logErr) {
              warnOnce("admin:updatecaseemailstatus-failed", "updateCaseEmailStatus failed:", logErr);
            }
          }
          try {
            await storage.createAuditLog({
              action: result.success
                ? "send_declaration_access_email"
                : "send_declaration_access_email_failed",
              newValue: result.success
                ? `Declaration access email sent to ${updated.userEmail}`
                : `Failed to send declaration access email to ${updated.userEmail}: ${result.error ?? "unknown"}`,
              adminUsername: adminUser,
              targetType: "case",
              targetId: id,
            });
          } catch (logErr) {
            warnOnce("admin:createauditlog-failed", "createAuditLog failed:", logErr);
          }

          emailResult = result.success
            ? { sent: true }
            : { sent: false, error: result.error ?? "Unknown email error" };
        }
      }

      // Always send a brief "a declaration has been assigned to your case"
      // notification so the user has a touchpoint regardless of whether the
      // rich access-code email was also dispatched. Best-effort; failures
      // never block the admin response. Skip silently when no email on file.
      if (updated.userEmail) {
        try {
          const { emailService } = await import(
            "../services/EmailService"
          );
          const { sendCaseEmailWithAudit } = await import(
            "../services/emailNotify"
          );
          const userName =
            (updated.userName ?? "").trim() || updated.userEmail;
          await sendCaseEmailWithAudit({
            to: updated.userEmail,
            caseId: id,
            tag: "declaration-assigned",
            adminUser,
            send: () =>
              emailService.sendLocalizedCaseEmail({
                to: updated.userEmail!,
                userName,
                caseRef: id,
                locale: updated.preferredLocale ?? req.userLocale,
                templateKey: 'declarationAssigned',
                ctaPath: '/portal?view=declaration',
                logTag: 'declaration-assigned',
              }),
          });
        } catch (err) {
          warnOnce(
            "admin:declaration-assigned-email-trigger-failed",
            "[admin] declaration-assigned email trigger failed:",
            err,
          );
        }
      }

      res.json({
        success: true,
        case: updated,
        declarationAccessCode,
        declarationAccessExpiresAt,
        email: emailResult,
      });
    } catch (error) {
      warnOnce("admin:request-declaration-error", "Request declaration error:", error);
      res.status(500).json({ error: "Failed to request declaration" });
    }
  },
);

// ============================================================================
// Letter reissue — admin re-opens the option selector for a user who has
// already submitted, attaching a new charge. The user is informed of the
// already-deposited credit and the balance they must deposit before
// resubmitting the reissued letter.
// ============================================================================

// The reissue dialog now lets the admin tweak the letter content alongside
// the fee + reason. We accept any subset of the editable letter fields and
// patch them into case_letters together with the version bump, so the new
// round goes out with the (possibly edited) content. If `letter` is omitted
// or empty the existing content is preserved unchanged (legacy behavior).
const reissueLetterSchema = z.object({
  reissueFee: z.string().trim().min(1).max(120),
  reason: z.string().max(2000).optional(),
  letter: updateCaseLetterSchema.optional(),
});

adminRouter.post(
  "/cases/:id/reissue-letter",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminUser =
        (req as Request & { adminUsername?: string }).adminUsername ?? "admin";

      const parsed = reissueLetterSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "Reissue fee is required." });
        return;
      }

      const caseRow = await storage.getCaseById(id);
      if (!caseRow) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      // Cancel any prior active round before opening a new one — this keeps
      // a clean "one active round at a time" invariant while preserving the
      // older row in history.
      const existing = await storage.getActiveLetterReissue(id);
      const letter = await storage.getCaseLetterByCaseId(id);
      const currentVersion = letter?.letterVersion ?? 1;
      const nextVersion = currentVersion + 1;

      // Merge any admin-supplied letter edits with the version bump in a
      // single write. Drop the caseId/letterVersion keys from the incoming
      // payload defensively — version is server-controlled and caseId
      // comes from the URL. Types flow through naturally because
      // updateCaseLetterSchema.partial() is the same shape the storage
      // layer accepts.
      const {
        caseId: _ignoredCaseId,
        letterVersion: _ignoredVersion,
        ...letterEdits
      } = parsed.data.letter ?? {};

      const { updatedLetter, round } = await storage.runInTransaction(
        async (tx) => {
          // Cancel any prior active round before opening a new one — this
          // keeps a clean "one active round at a time" invariant while
          // preserving the older row in history.
          if (existing && existing.status !== 'paid') {
            await storage.updateLetterReissue(
              existing.id,
              { status: 'cancelled', cancelledAt: new Date() },
              tx,
            );
          }
          const ul = await storage.createOrUpdateCaseLetter(
            id,
            { ...letterEdits, letterVersion: nextVersion },
            tx,
          );
          const r = await storage.createLetterReissue(
            {
              caseId: id,
              version: nextVersion,
              reissueFee: parsed.data.reissueFee,
              reason: parsed.data.reason ?? null,
              status: 'awaiting_deposit',
              receiptId: null,
              createdBy: adminUser,
              paidAt: null,
              cancelledAt: null,
            },
            tx,
          );
          await storage.createAuditLog(
            {
              action: "reissue_letter",
              newValue: `Letter reissued v${nextVersion} for case ${id}: fee=${parsed.data.reissueFee}${parsed.data.reason ? `; reason=${parsed.data.reason}` : ''}`,
              adminUsername: adminUser,
              targetType: "case",
              targetId: id,
            },
            tx,
          );
          return { updatedLetter: ul, round: r };
        },
      );

      // Notify the user that a new round has been opened. Best-effort; never
      // blocks the admin response. The user must pay the reissue fee before
      // they can resubmit, so giving them an out-of-portal heads-up matters.
      try {
        const { emailService } = await import("../services/EmailService");
        const { sendCaseEmailWithAudit } = await import(
          "../services/emailNotify"
        );
        const userName =
          (caseRow.userName ?? "").trim() ||
          caseRow.userEmail ||
          "Recipient";
        await sendCaseEmailWithAudit({
          to: caseRow.userEmail,
          caseId: id,
          tag: "letter-reissued",
          adminUser,
          send: () =>
            emailService.sendLocalizedCaseEmail({
              to: caseRow.userEmail!,
              userName,
              caseRef: id,
              locale: caseRow.preferredLocale ?? req.userLocale,
              templateKey: 'letterReissued',
              ctaPath: '/portal?view=letter',
              logTag: 'letter-reissued',
              vars: {
                version: nextVersion,
                fee: parsed.data.reissueFee,
                reason: parsed.data.reason ?? '',
              },
            }),
        });
      } catch (err) {
        warnOnce("admin:letter-reissued-email-trigger-failed", "[admin] letter-reissued email trigger failed:", err);
      }

      res.json({ success: true, letter: updatedLetter, reissue: round });
    } catch (error) {
      warnOnce("admin:reissue-letter-error", "Reissue letter error:", error);
      res.status(500).json({ error: "Failed to reissue letter" });
    }
  },
);

adminRouter.post(
  "/cases/:id/clear-reissue",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminUser =
        (req as Request & { adminUsername?: string }).adminUsername ?? "admin";

      const caseRow = await storage.getCaseById(id);
      if (!caseRow) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const existing = await storage.getActiveLetterReissue(id);
      if (!existing) {
        res.status(400).json({ error: "No active reissue round to clear." });
        return;
      }

      const cleared = await storage.runInTransaction(async (tx) => {
        const updated = await storage.updateLetterReissue(
          existing.id,
          { status: 'cancelled', cancelledAt: new Date() },
          tx,
        );
        await storage.createAuditLog(
          {
            action: "clear_reissue_letter",
            newValue: `Reissue v${existing.version} cleared for case ${id}`,
            adminUsername: adminUser,
            targetType: "case",
            targetId: id,
          },
          tx,
        );
        return updated;
      });

      res.json({ success: true, reissue: cleared });
    } catch (error) {
      warnOnce("admin:clear-reissue-error", "Clear reissue error:", error);
      res.status(500).json({ error: "Failed to clear reissue" });
    }
  },
);

// Regenerate the per-case declaration access code (e.g. user lost it, or
// admin wants to invalidate the old one before re-sharing).
adminRouter.post(
  "/cases/:id/regenerate-declaration-access-code",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const declarationAccessCode = crypto.randomInt(10000000, 100000000).toString();
      const adminUser =
        (req as Request & { adminUsername?: string }).adminUsername ?? "admin";
      // Task #156 — pair the access-code regeneration with its audit row
      // inside a single transaction so an audit failure rolls back the new
      // code (otherwise the user could be left with a code that has no
      // accompanying trail).
      let updated: Awaited<ReturnType<typeof storage.updateCase>>;
      try {
        updated = await storage.runInTransaction(async (tx) => {
          const u = await storage.updateCase(
            id,
            { declarationAccessCode },
            tx,
          );
          if (!u) return undefined;
          await storage.createAuditLog(
            {
              adminUsername: adminUser,
              action: "regenerate_declaration_access_code",
              targetType: "case",
              targetId: id,
            },
            tx,
          );
          return u;
        });
      } catch (txErr) {
        warnOnce(
          "admin:regenerate-declaration-access-code-transaction-fai",
          "[admin] regenerate-declaration-access-code transaction failed:",
          txErr,
        );
        return res
          .status(500)
          .json({ error: "Failed to regenerate declaration access code" });
      }
      if (!updated) return res.status(404).json({ error: "Case not found" });

      // Email the user the new code so they can act on it without the admin
      // having to copy-paste it out of band. Don't fail the request if SMTP
      // is unavailable — surface the status in the response so the admin
      // toast can fall back to "share the code manually".
      let emailSent = false;
      let emailSkippedReason: string | undefined;
      try {
        if (updated.userEmail && updated.userEmail.trim().length > 0) {
          const { emailService } = await import("../services/EmailService");
          emailSent = await emailService.sendNewDeclarationCodeNotification(
            updated.userEmail,
            updated.userName || "",
            declarationAccessCode,
          );
          if (!emailSent) emailSkippedReason = "send-failed";
        } else {
          emailSkippedReason = "no-email-on-file";
        }
      } catch (e) {
        emailSkippedReason = "exception";
        warnOnce("admin:new-declaration-code-email-error", "New declaration code email error:", e);
      }

      res.json({
        success: true,
        case: updated,
        declarationAccessCode,
        emailSent,
        emailSkippedReason,
      });
    } catch (error) {
      warnOnce("admin:regenerate-declaration-access-code-error", "Regenerate declaration access code error:", error);
      res
        .status(500)
        .json({ error: "Failed to regenerate declaration access code" });
    }
  },
);

// ============================================================================
// Account mirror (impersonation) — admin "view as user" flow
// ============================================================================
//
// The admin clicks "Open as User", which mints a one-shot mirror token. A new
// browser tab navigates to /admin/mirror?token=XXX, redeems the token, and
// boots the user portal as if the user had logged in (PIN bypass included).
// Tokens are single-use, expire in 2 minutes, and live in process memory only.

// Mirror tokens were previously held in a per-process Map, which broke under
// Replit autoscale: a mint request served by instance A and a redeem request
// served by instance B produced a confusing 404 on the redeem side. They now
// live in Postgres (`admin_mirror_tokens`) so any instance can find them, with
// `consumeMirrorToken` performing an atomic delete-returning to preserve the
// single-use guarantee across both cross-instance and same-instance races.

// Tightened expiry: 2 minutes is enough to switch tabs and be inside the
// user's portal. Anything longer turns this into a parking-lot credential.
const MIRROR_TOKEN_TTL_MS = 2 * 60 * 1000;
const MIRROR_REASON_MIN_LENGTH = 10;
const MIRROR_REASON_MAX_LENGTH = 500;

async function pruneMirrorTokens() {
  try {
    await storage.deleteExpiredMirrorTokens();
  } catch {
    // Pruning is best-effort; the redeem path also rechecks expiry against
    // the row's `expiresAt` so a stale row can never be redeemed.
  }
}

adminRouter.post(
  "/cases/:id/mirror-token",
  checkAdminAuth,
  requireAdminRole("super_admin"),
  async (req, res) => {
    try {
      await pruneMirrorTokens();
      const { id } = req.params;
      const adminUser =
        (req as Request & { adminUsername?: string }).adminUsername ?? "admin";

      // Mandatory reason — captured in the audit log and shown to the user
      // via a portal banner. Forces the admin to articulate WHY they need to
      // see the user's session before the token is even minted.
      const rawReason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (rawReason.length < MIRROR_REASON_MIN_LENGTH) {
        return res.status(400).json({
          error: `A reason of at least ${MIRROR_REASON_MIN_LENGTH} characters is required to open a user mirror.`,
        });
      }
      const reason = rawReason.slice(0, MIRROR_REASON_MAX_LENGTH);

      const caseRow = await storage.getCaseById(id);
      if (!caseRow) return res.status(404).json({ error: "Case not found" });

      const issuerIp = getClientIp(req) ?? null;
      const issuerUserAgent = req.headers["user-agent"]?.toString() ?? null;

      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + MIRROR_TOKEN_TTL_MS);
      await storage.runInTransaction(async (tx) => {
        await storage.createMirrorToken(
          {
            token,
            caseId: caseRow.id,
            accessCode: caseRow.accessCode,
            issuedBy: adminUser,
            reason,
            expiresAt,
            issuerIp,
            issuerUserAgent,
          },
          tx,
        );
        // Audit so we have a record of every impersonation event, including
        // the stated reason and where it was issued from.
        await storage.createAuditLog(
          {
            adminUsername: adminUser,
            action: "admin_mirror_token_issued",
            targetType: "case",
            targetId: caseRow.id,
            previousValue: null,
            newValue: JSON.stringify({ reason, expiresAt: expiresAt.getTime() }),
            ipAddress: issuerIp,
            userAgent: issuerUserAgent,
          },
          tx,
        );
      });
      res.json({
        mirrorToken: token,
        expiresInSeconds: Math.floor(MIRROR_TOKEN_TTL_MS / 1000),
      });
    } catch (error) {
      warnOnce("admin:mirror-token-error", "Mirror token error:", error);
      res.status(500).json({ error: "Failed to issue mirror token" });
    }
  },
);

// Public redemption — no admin auth needed because possession of the (short
// lived, single use) token is itself the credential. We delete it on use.
adminRouter.post("/cases/redeem-mirror-token", async (req, res) => {
  try {
    await pruneMirrorTokens();
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!token) return res.status(400).json({ error: "Missing token" });
    // Atomic single-use consume + audit row commit/rollback together
    // (Task #156). Previously the audit failure was swallowed, meaning a
    // dropped audit-log insert silently consumed the single-use token
    // with no trace of the redemption. Wrapping both writes in one
    // transaction means an audit failure rolls the delete back, so the
    // token either redeems-with-audit or doesn't redeem at all. The
    // delete-returning still races safely with a concurrent redeem on
    // another instance — only one transaction gets the row.
    let entry: Awaited<ReturnType<typeof storage.consumeMirrorToken>>;
    try {
      entry = await storage.runInTransaction(async (tx) => {
        const row = await storage.consumeMirrorToken(token, tx);
        if (!row) return undefined;
        // Audit the redemption too — pairing the issuer's IP with the
        // redeemer's IP makes it easy to spot a token that left the
        // building before being used. Expired-token rejection happens
        // post-commit so the row is still consumed (single-use).
        await storage.createAuditLog(
          {
            adminUsername: row.issuedBy,
            action: "admin_mirror_token_redeemed",
            targetType: "case",
            targetId: row.caseId,
            previousValue: null,
            newValue: JSON.stringify({
              reason: row.reason,
              issuerIp: row.issuerIp,
              issuerUserAgent: row.issuerUserAgent,
              expired: row.expiresAt.getTime() < Date.now(),
            }),
            ipAddress: getClientIp(req) ?? null,
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          },
          tx,
        );
        return row;
      });
    } catch (txErr) {
      warnOnce("admin:redeem-mirror-token-transaction-failed", "Redeem mirror token transaction failed:", txErr);
      return res.status(500).json({ error: "Failed to redeem mirror token" });
    }
    if (!entry) return res.status(404).json({ error: "Token invalid or expired" });
    if (entry.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ error: "Token expired" });
    }
    // Mint a short-lived mirror portal session — TTL is pinned to the mirror
    // token's own expiry so the session cannot outlive the stated mirror window.
    // Using createMirrorSession (not createSession) ensures the server-side row
    // expires in ~2 minutes rather than the normal 7-day portal TTL. The client
    // additionally stores the token in sessionStorage (not localStorage) so it
    // dies with the browser tab and cannot be reused after the tab closes.
    const { createMirrorSession } = await import("../services/session-store");
    const portalSessionToken = await createMirrorSession(entry.caseId, entry.accessCode, entry.expiresAt);
    res.json({
      caseId: entry.caseId,
      accessCode: entry.accessCode,
      issuedBy: entry.issuedBy,
      reason: entry.reason,
      // Hand the expiry back to the client so the portal banner can show a
      // "session ends in N min" countdown rather than guessing.
      expiresAt: entry.expiresAt.getTime(),
      portalSessionToken,
    });
  } catch (error) {
    warnOnce("admin:redeem-mirror-token-error", "Redeem mirror token error:", error);
    res.status(500).json({ error: "Failed to redeem mirror token" });
  }
});

// Cancel an outstanding declaration request before the user submits it.
adminRouter.post(
  "/cases/:id/clear-declaration-request",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminUser =
        (req as Request & { adminUsername?: string }).adminUsername ?? "admin";
      // Task #156 — pair the clear-declaration mutation with its audit row
      // inside a single transaction so the case can never silently drop
      // back to "not_requested" without a matching audit entry.
      let updated: Awaited<ReturnType<typeof storage.updateCase>>;
      try {
        updated = await storage.runInTransaction(async (tx) => {
          const u = await storage.updateCase(
            id,
            {
              declarationStatus: "not_requested",
              declarationRequestedAt: null,
              declarationRequestedBy: null,
            },
            tx,
          );
          if (!u) return undefined;
          await storage.createAuditLog(
            {
              adminUsername: adminUser,
              action: "clear_declaration_request",
              targetType: "case",
              targetId: id,
            },
            tx,
          );
          return u;
        });
      } catch (txErr) {
        warnOnce(
          "admin:clear-declaration-request-transaction-failed",
          "[admin] clear-declaration-request transaction failed:",
          txErr,
        );
        return res
          .status(500)
          .json({ error: "Failed to clear declaration request" });
      }
      if (!updated) return res.status(404).json({ error: "Case not found" });
      res.json({ success: true, case: updated });
    } catch (error) {
      warnOnce("admin:clear-declaration-request-error", "Clear declaration request error:", error);
      res.status(500).json({ error: "Failed to clear declaration request" });
    }
  },
);

// Force-logout the currently signed-in portal user for this case.
// Stamps cases.forceLogoutAt = now() (the portal compares this to its
// stored loginAt and signs out on the next refresh) and drops any
// matching in-memory session tokens for belt-and-suspenders cleanup.
adminRouter.post(
  "/cases/:id/force-logout",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminUser =
        (req as Request & { adminUsername?: string }).adminUsername ?? "admin";

      const existingCase = await storage.getCaseById(id);
      if (!existingCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const { deleteSessionsByCaseId } = await import(
        "../services/session-store"
      );
      const dropped = await deleteSessionsByCaseId(id);

      const updated = await storage.runInTransaction(async (tx) => {
        const u = await storage.updateCase(
          id,
          { forceLogoutAt: new Date() },
          tx,
        );
        await storage.invalidateAllUserSessions(id, tx);
        await storage.createAuditLog(
          {
            adminUsername: adminUser,
            action: "admin_force_logout_case",
            targetType: "case",
            targetId: id,
            newValue: `Force-logged-out user (${dropped} in-memory session(s) dropped)`,
          },
          tx,
        );
        return u;
      });

      res.json({ success: true, droppedSessions: dropped, case: updated });
    } catch (error) {
      warnOnce("admin:force-logout-error", "Force logout error:", error);
      res.status(500).json({ error: "Failed to force logout user" });
    }
  },
);

// Generate and stream a PDF of the latest declaration submission for a case.
adminRouter.get(
  "/cases/:id/declaration-pdf",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const caseRow = await storage.getCaseById(id);
      if (!caseRow) return res.status(404).json({ error: "Case not found" });

      const submission = await storage.getLatestDeclarationByCase(id);
      if (!submission) {
        return res.status(404).json({ error: "No declaration submission found for this case" });
      }

      const { buildDeclarationPdf } = await import("../services/declarationPdf");
      const buf = await buildDeclarationPdf({ caseRow, submission });

      const filename = `declaration-${caseRow.id}-${submission.id}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", buf.length);
      res.end(buf);
    } catch (error) {
      warnOnce("admin:decl-pdf-fail", "Declaration PDF generation error:", error);
      res.status(500).json({ error: "Failed to generate declaration PDF" });
    }
  },
);

// Read all declaration submissions for a single case (history).
adminRouter.get(
  "/cases/:id/declaration-submissions",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const rows = await storage.getDeclarationSubmissionsByCaseId(id);
      res.json(rows);
    } catch (error) {
      warnOnce("admin:case-decl-submissions-fail", "List case declarations error:", error);
      res.status(500).json({ error: "Failed to list declarations" });
    }
  },
);

// Global list (paginated, optional status filter).
adminRouter.get(
  "/declaration-submissions",
  checkAdminAuth,
  async (req, res) => {
    try {
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
      const offset = Number.parseInt(String(req.query.offset ?? "0"), 10);
      const result = await storage.listDeclarationSubmissions({
        status,
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
      });
      res.json(result);
    } catch (error) {
      warnOnce("admin:decl-submissions-list-fail", "List declarations error:", error);
      res.status(500).json({ error: "Failed to list declarations" });
    }
  },
);

adminRouter.get(
  "/declaration-submissions/:id",
  checkAdminAuth,
  async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await storage.getDeclarationSubmissionById(id);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (error) {
      warnOnce("admin:decl-submission-get-fail", "Get declaration error:", error);
      res.status(500).json({ error: "Failed to fetch declaration" });
    }
  },
);

// Generate and stream a PDF for a specific declaration submission by its own ID.
adminRouter.get(
  "/declaration-submissions/:id/pdf",
  checkAdminAuth,
  async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

      const submission = await storage.getDeclarationSubmissionById(id);
      if (!submission) return res.status(404).json({ error: "Submission not found" });

      const caseRow = await storage.getCaseById(submission.caseId);
      if (!caseRow) return res.status(404).json({ error: "Case not found" });

      const { buildDeclarationPdf } = await import("../services/declarationPdf");
      const buf = await buildDeclarationPdf({ caseRow, submission });

      const filename = `declaration-${caseRow.id}-${submission.id}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", buf.length);
      res.end(buf);
    } catch (error) {
      warnOnce("admin:decl-submission-pdf-fail", "Declaration submission PDF error:", error);
      res.status(500).json({ error: "Failed to generate PDF" });
    }
  },
);

adminRouter.patch(
  "/declaration-submissions/:id/status",
  checkAdminAuth,
  async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      // Reviewers may only approve or reject. Re-opening to "submitted" is
      // intentionally not allowed via this endpoint to keep the audit trail
      // monotonic and the workflow predictable.
      const schema = z.object({
        status: z.enum(["approved", "rejected"]),
        reviewerNotes: z.string().max(2000).optional(),
      });
      const body = schema.parse(req.body);
      const adminUser =
        (req as Request & { adminUsername?: string }).adminUsername ?? "admin";
      // No-op guard: if the submission is already at the requested final
      // status, skip the email + email-tag audit so re-clicks (or replays
      // of an admin action) don't spam the user. Mirrors the same idea
      // as the verified payout-wallet PATCH guard in cases.ts.
      const existing = await storage.getDeclarationSubmissionById(id);
      const isNoOpStatusChange = !!existing && existing.status === body.status;

      // Task #144 — submission status update, the mirrored case-row
      // update, and the typed audit row commit/rollback together. An
      // audit-write failure rolls the whole review back so we can never
      // ship a status change with no audit trail.
      let row: Awaited<ReturnType<typeof storage.updateDeclarationSubmissionStatus>> | undefined;
      try {
        row = await storage.runInTransaction(async (tx) => {
          const r = await storage.updateDeclarationSubmissionStatus(
            id,
            body.status,
            adminUser,
            body.reviewerNotes,
            tx,
          );
          if (!r) return undefined;
          await storage.updateCase(r.caseId, {
            declarationStatus: body.status,
          }, tx);
          if (!isNoOpStatusChange) {
            await storage.createAuditLog({
              action: body.status === 'approved'
                ? 'declaration_approved'
                : 'declaration_rejected',
              newValue: JSON.stringify({
                submissionId: r.id,
                status: body.status,
                reviewerNotes: body.reviewerNotes ?? null,
              }).slice(0, 4000),
              adminUsername: adminUser,
              targetType: 'case',
              targetId: r.caseId,
            }, tx);
          }
          return r;
        });
      } catch (txErr) {
        warnOnce("admin:declaration-review-transaction-failed", '[admin] declaration review transaction failed:', txErr);
        return res
          .status(500)
          .json({ error: "Failed to update declaration status" });
      }
      if (!row) return res.status(404).json({ error: "Not found" });

      // Notify the user of the review outcome. Best-effort; never blocks the
      // admin response. Pull the case for the recipient email + display name.
      try {
        if (isNoOpStatusChange) {
          // Intentionally skip the notification — nothing changed.
          // (Fall through to res.json(row) below.)
        } else {
        const caseRow = await storage.getCaseById(row.caseId);
        if (caseRow?.userEmail) {
          const { emailService } = await import("../services/EmailService");
          const { sendCaseEmailWithAudit } = await import(
            "../services/emailNotify"
          );
          const userName =
            (caseRow.userName ?? "").trim() || caseRow.userEmail;
          if (body.status === "approved") {
            await sendCaseEmailWithAudit({
              to: caseRow.userEmail,
              caseId: row.caseId,
              tag: "declaration-approved",
              adminUser,
              send: () =>
                emailService.sendLocalizedCaseEmail({
                  to: caseRow.userEmail!,
                  userName,
                  caseRef: row.caseId,
                  locale: caseRow.preferredLocale ?? req.userLocale,
                  templateKey: 'declarationApproved',
                  ctaPath: '/portal?view=declaration',
                  logTag: 'declaration-approved',
                }),
            });
          } else {
            await sendCaseEmailWithAudit({
              to: caseRow.userEmail,
              caseId: row.caseId,
              tag: "declaration-rejected",
              adminUser,
              // Task #158 — stamp the source submission id so a later
              // retry resends THIS rejection's notes, not whatever the
              // newest rejected submission happens to be.
              metadata: {
                declarationSubmissionId: row.id,
                reviewerNotes: body.reviewerNotes ?? null,
              },
              send: () =>
                emailService.sendLocalizedCaseEmail({
                  to: caseRow.userEmail!,
                  userName,
                  caseRef: row.caseId,
                  locale: caseRow.preferredLocale ?? req.userLocale,
                  templateKey: 'declarationRejected',
                  ctaPath: '/portal?view=declaration',
                  logTag: 'declaration-rejected',
                  vars: { notes: body.reviewerNotes ?? '' },
                }),
            });
          }
        }
        }
      } catch (err) {
        warnOnce(
          "admin:declaration-review-email-trigger-failed",
          "[admin] declaration-review email trigger failed:",
          err,
        );
      }

      res.json(row);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request" });
      }
      warnOnce("admin:update-declaration-status-error", "Update declaration status error:", error);
      res.status(500).json({ error: "Failed to update declaration status" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// Portal Refresh Mode — platform-wide hold screen that locks all
// authenticated portal users into a styled informational waiting page.
// Stored as app_settings key `portal_refresh_mode` ("true"/"false").
// GET returns current state; POST toggles it and emits an audit row.
// ─────────────────────────────────────────────────────────────────────
const PORTAL_REFRESH_MODE_KEY = 'portal_refresh_mode';

adminRouter.get(
  "/portal-refresh-mode",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const row = await storage.getAppSetting(PORTAL_REFRESH_MODE_KEY);
      res.json({ enabled: row?.value === 'true' });
    } catch (err) {
      warnOnce("admin:portal-refresh-mode-fail", "Failed to load portal-refresh-mode:", err);
      res.status(500).json({ error: "Failed to load portal refresh mode" });
    }
  },
);

adminRouter.post(
  "/portal-refresh-mode",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
      const adminUser = (req as any).admin?.username || "admin";
      const previous = await storage.getAppSetting(PORTAL_REFRESH_MODE_KEY);
      await storage.runInTransaction(async (tx) => {
        await storage.setAppSetting(
          PORTAL_REFRESH_MODE_KEY,
          enabled ? 'true' : 'false',
          adminUser,
          tx,
        );
        await storage.createAuditLog(
          {
            action: 'portal_refresh_mode_changed',
            adminUsername: adminUser,
            previousValue: previous?.value ?? 'false',
            newValue: enabled ? 'true' : 'false',
          },
          tx,
        );
      });
      res.json({ enabled });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      warnOnce("admin:failed-to-update-portal-refresh-mode", "Failed to update portal-refresh-mode:", err);
      res.status(500).json({ error: "Failed to update portal refresh mode" });
    }
  },
);

// Community view-count trend (Task #549)
// GET /api/admin/community/views-over-time
// Returns hourly view counts from community_thread_views for the last 1-48 h.
// Optional query params: hours (1-48, default 48), threadId (integer).
adminRouter.get("/community/views-over-time", checkAdminAuth, async (req, res) => {
  try {
    const rawHours = Number(req.query.hours);
    // Default to 48 when param is absent or non-numeric; clamp to [1, 48] otherwise.
    const hours = Number.isFinite(rawHours) ? Math.min(Math.max(rawHours, 1), 48) : 48;
    const rawThread = req.query.threadId ? Number(req.query.threadId) : undefined;
    const threadId = rawThread != null && Number.isFinite(rawThread) ? rawThread : undefined;
    const data = await storage.getCommunityViewsOverTime({ hours, threadId });
    res.json({ data, windowHours: hours });
  } catch (err) {
    warnOnce("admin:community-views-over-time-fail", "Failed to load community views-over-time:", err);
    res.status(500).json({ error: "Failed to load view-count trend" });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Blocked IPs (Task #113) — admin-managed denylist surfaced from the
// Declaration Scans "By IP" panel. The portal-facing enforcement
// middleware lives in server/routes/middleware.ts; this router only
// exposes the read/write CRUD for the dashboard. Every mutation is
// audit-logged and busts the in-memory cache so the change takes
// effect on the next request.
// ─────────────────────────────────────────────────────────────────────
import { invalidateBlockedIpsCache, normalizeIp } from "./middleware";

export const blockedIpsRouter = Router();

const blockIpBodySchema = z.object({
  ipAddress: z
    .string()
    .trim()
    .min(1)
    .max(64)
    // Permissive shape check — we don't try to fully validate IPv4/IPv6
    // here, just reject obviously bogus input. The middleware compares
    // by exact string match against req.ip, so anything that round-trips
    // through Postgres is fine.
    .regex(/^[0-9a-fA-F:.]+$/, "Invalid IP address"),
  reason: z.string().trim().max(500).optional(),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
});

blockedIpsRouter.get("/", checkAdminAuth, requireAdminRole("viewer"), async (_req, res) => {
  try {
    const rows = await storage.listBlockedIps();
    res.json({ items: rows });
  } catch (err) {
    warnOnce("admin:list-blocked-ips-fail", "listBlockedIps failed:", err);
    res.status(500).json({ error: "Failed to load blocked IPs" });
  }
});

blockedIpsRouter.post("/", checkAdminAuth, requireAdminRole("super_admin"), async (req, res) => {
  try {
    const parsed = blockIpBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid request" });
    }
    const ipAddress = normalizeIp(parsed.data.ipAddress) ?? parsed.data.ipAddress;
    const adminUser =
      (req as Request & { adminUsername?: string }).adminUsername ??
      (ADMIN_USERNAME || "admin");

    // Task #144 — block + audit row commit/rollback together so an
    // audit-write failure never leaves a silent block in place.
    let row: Awaited<ReturnType<typeof storage.blockIp>>;
    try {
      row = await storage.runInTransaction(async (tx) => {
        const inserted = await storage.blockIp({
          ipAddress,
          reason: parsed.data.reason ?? null,
          blockedBy: adminUser,
          expiresAt: parsed.data.expiresAt ?? null,
        }, tx);
        await storage.createAuditLog({
          action: "ip_blocked",
          adminUsername: adminUser,
          targetType: "ip",
          targetId: ipAddress,
          newValue: JSON.stringify({
            reason: parsed.data.reason ?? null,
            expiresAt: parsed.data.expiresAt ?? null,
          }),
          ipAddress: getClientIp(req),
          userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
        }, tx);
        return inserted;
      });
    } catch (txErr) {
      warnOnce("admin:blockip-transaction-failed", "blockIp transaction failed:", txErr);
      return res.status(500).json({ error: "Failed to block IP" });
    }
    invalidateBlockedIpsCache();

    res.status(201).json(row);
  } catch (err) {
    warnOnce("admin:blockip-failed", "blockIp failed:", err);
    res.status(500).json({ error: "Failed to block IP" });
  }
});

blockedIpsRouter.delete("/:ip", checkAdminAuth, requireAdminRole("super_admin"), async (req, res) => {
  try {
    const ipAddress = normalizeIp(req.params.ip) ?? req.params.ip;
    const adminUser =
      (req as Request & { adminUsername?: string }).adminUsername ??
      (ADMIN_USERNAME || "admin");

    // Task #144 — unblock + audit row commit/rollback together so an
    // audit-write failure never silently drops an IP from the blocklist.
    let removed: Awaited<ReturnType<typeof storage.unblockIp>>;
    try {
      removed = await storage.runInTransaction(async (tx) => {
        const r = await storage.unblockIp(ipAddress, tx);
        if (!r) return undefined;
        await storage.createAuditLog({
          action: "ip_unblocked",
          adminUsername: adminUser,
          targetType: "ip",
          targetId: ipAddress,
          previousValue: JSON.stringify({
            reason: r.reason,
            expiresAt: r.expiresAt,
            blockedBy: r.blockedBy,
            blockedAt: r.blockedAt,
          }),
          ipAddress: getClientIp(req),
          userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
        }, tx);
        return r;
      });
    } catch (txErr) {
      warnOnce("admin:unblockip-transaction-failed", "unblockIp transaction failed:", txErr);
      return res.status(500).json({ error: "Failed to unblock IP" });
    }

    if (!removed) {
      return res.status(404).json({ error: "IP not in blocklist" });
    }
    invalidateBlockedIpsCache();

    res.json({ ok: true });
  } catch (err) {
    warnOnce("admin:unblockip-failed", "unblockIp failed:", err);
    res.status(500).json({ error: "Failed to unblock IP" });
  }
});

// On-demand trigger for the portal-warning expiry sweep. Lets an admin (or an
// E2E test) run the sweep immediately without waiting for the next 5-minute
// tick.  Mirrors the NDA integrity sweep trigger above.
adminRouter.post(
  "/portal-warning-expiry-sweep/run",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const { runPortalWarningExpirySweep } = await import(
        "../portal-warning-expiry-sweep"
      );
      const result = await runPortalWarningExpirySweep();
      res.json(result);
    } catch (error) {
      warnOnce(
        "admin:portal-warning-expiry-sweep-run-failed",
        "Failed to run portal-warning expiry sweep:",
        error,
      );
      res.status(500).json({ error: "Failed to run sweep" });
    }
  },
);
