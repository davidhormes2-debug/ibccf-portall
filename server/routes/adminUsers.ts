import { Router } from "express";
import type { Request } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { generateSecret, generateURI, verifySync as totpVerifySync } from "otplib";
import crypto from "crypto";
import { storage } from "../storage";
import { checkAdminAuth } from "./middleware";
import { requireAdminRole } from "./adminPermissions";

export const adminUsersRouter = Router();

const BCRYPT_ROUNDS = 12;

function getClientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}

const createAdminUserSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/, "Username must contain only letters, numbers, underscores, hyphens, or dots"),
  password: z.string().min(8),
  role: z.enum(["viewer", "agent", "admin"]),
  displayName: z.string().max(128).optional(),
  email: z.string().email().optional().or(z.literal("")),
});

const updateAdminUserSchema = z.object({
  role: z.enum(["viewer", "agent", "admin"]).optional(),
  displayName: z.string().max(128).optional(),
  email: z.string().email().optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

// GET /api/admin-users — list all sub-admin rows (super_admin only)
adminUsersRouter.get("/", checkAdminAuth, requireAdminRole("super_admin"), async (req, res) => {
  try {
    const users = await storage.listAdminUsers();
    const sanitized = users.map(({ passwordHash: _ph, twoFactorSecret: _ts, ...rest }) => rest);
    res.json(sanitized);
  } catch {
    res.status(500).json({ error: "Failed to list admin users" });
  }
});

// POST /api/admin-users — create a new sub-admin (super_admin only)
adminUsersRouter.post("/", checkAdminAuth, requireAdminRole("super_admin"), async (req, res) => {
  const parsed = createAdminUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }
  const { username, password, role, displayName, email } = parsed.data;

  // Block creating a sub-admin row whose username matches the canonical
  // env-var admin OR the current username-override value. Such a row would
  // allow the sub-admin login path to authenticate as the super-admin identity
  // and bypass 2FA, because resolveAdminRoleFromUsername() gives super_admin
  // to the env-var username via its early-return.
  const canonicalAdmin = (process.env.ADMIN_USERNAME ?? "").trim();
  // Also check the DB-stored username override so a super-admin cannot create
  // a sub-admin row matching the override value even if it differs from env var.
  let overrideAdmin = "";
  try {
    const overrideSetting = await storage.getAppSetting("admin_username_override");
    overrideAdmin = (overrideSetting?.value ?? "").trim();
  } catch {
    // Fail safe — proceed without override check on DB error.
  }
  if (
    (canonicalAdmin && username === canonicalAdmin) ||
    (overrideAdmin && username === overrideAdmin)
  ) {
    res.status(409).json({ error: "Username reserved; choose a different username" });
    return;
  }

  try {
    const existing = await storage.getAdminUserByUsername(username);
    if (existing) {
      res.status(409).json({ error: "Username already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await storage.createAdminUser({
      username,
      passwordHash,
      role,
      displayName: displayName ?? null,
      email: email || null,
      isActive: true,
    });

    await storage.createAuditLog({
      adminUsername: req.adminUsername ?? "unknown",
      action: "sub_admin_created",
      targetType: "admin_user",
      targetId: String(user.id),
      previousValue: null,
      newValue: JSON.stringify({ username, role }),
      ipAddress: getClientIp(req) ?? null,
      userAgent: req.headers["user-agent"]?.toString() ?? null,
    }).catch(() => {});

    const { passwordHash: _ph, twoFactorSecret: _ts, ...sanitized } = user;
    res.status(201).json(sanitized);
  } catch {
    res.status(500).json({ error: "Failed to create admin user" });
  }
});

// PATCH /api/admin-users/:id — update role, displayName, email, isActive, or password (super_admin only)
adminUsersRouter.patch("/:id", checkAdminAuth, requireAdminRole("super_admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = updateAdminUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }

  const { password, email, ...rest } = parsed.data;
  const updateData: Parameters<typeof storage.updateAdminUser>[1] = { ...rest };
  if (password) {
    updateData.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  }
  if (email !== undefined) {
    updateData.email = email || null;
  }

  try {
    const existing = await storage.getAdminUserById(id);
    if (!existing) {
      res.status(404).json({ error: "Admin user not found" });
      return;
    }

    const updated = await storage.updateAdminUser(id, updateData);
    if (!updated) {
      res.status(404).json({ error: "Admin user not found" });
      return;
    }

    // If the account is being disabled, immediately revoke all active sessions
    // so the sub-admin cannot continue using a stale bearer token.
    if (updateData.isActive === false && existing.isActive !== false) {
      storage.revokeAllAdminSessions(existing.username).catch(() => {});
    }

    await storage.createAuditLog({
      adminUsername: req.adminUsername ?? "unknown",
      action: "sub_admin_updated",
      targetType: "admin_user",
      targetId: String(id),
      previousValue: JSON.stringify({ role: existing.role, isActive: existing.isActive }),
      newValue: JSON.stringify({ role: updated.role, isActive: updated.isActive }),
      ipAddress: getClientIp(req) ?? null,
      userAgent: req.headers["user-agent"]?.toString() ?? null,
    }).catch(() => {});

    const { passwordHash: _ph, twoFactorSecret: _ts, ...sanitized } = updated;
    res.json(sanitized);
  } catch {
    res.status(500).json({ error: "Failed to update admin user" });
  }
});

// ── Sub-admin 2FA self-service ───────────────────────────────────────────────
//
// These routes allow any authenticated sub-admin to manage their own 2FA.
// The "me" segment routes are intentionally placed BEFORE the "/:id" routes
// so Express does not attempt to parse "me" as a numeric ID.
//
// Storage approach:
//   - admin_users.twoFactorSecret  → the TOTP secret (also duplicated in
//                                    admin_two_factor.secret so the backup-code
//                                    row can be kept in one table)
//   - admin_users.twoFactorEnabled → login guard flag (set to true on confirm)
//   - admin_two_factor (by username) → backup codes (JSON array of bcrypt hashes)
//                                      and lastVerifiedAt

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 5; // 10 hex chars per code

function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () =>
    crypto.randomBytes(BACKUP_CODE_BYTES).toString("hex"),
  );
}

// Helper: derive whether the current request comes from a sub-admin row
// (as opposed to the env-var super-admin). Returns the admin_users row
// or null when the caller is the env-var super-admin.
async function getSubAdminRow(adminUsername: string | undefined) {
  if (!adminUsername) return null;
  const canonicalAdmin = (process.env.ADMIN_USERNAME ?? "").trim();
  if (adminUsername === canonicalAdmin) return null;
  return storage.getAdminUserByUsername(adminUsername);
}

// GET /api/admin-users/me/2fa — own 2FA status (any sub-admin)
adminUsersRouter.get("/me/2fa", checkAdminAuth, async (req, res) => {
  try {
    const subAdmin = await getSubAdminRow(req.adminUsername);
    if (!subAdmin) {
      res.status(403).json({ error: "Only sub-admin accounts support per-account 2FA via this endpoint" });
      return;
    }
    const backupConfig = await storage.getAdminTwoFactor(subAdmin.username);
    const hasBackupCodes = !!backupConfig?.backupCodes &&
      (() => { try { return (JSON.parse(backupConfig.backupCodes!) as unknown[]).length > 0; } catch { return false; } })();
    res.json({
      twoFactorEnabled: subAdmin.twoFactorEnabled ?? false,
      hasBackupCodes,
      lastVerifiedAt: backupConfig?.lastVerifiedAt ?? null,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch 2FA status" });
  }
});

// POST /api/admin-users/me/2fa/setup — begin enrollment (generates secret + backup codes)
adminUsersRouter.post("/me/2fa/setup", checkAdminAuth, async (req, res) => {
  try {
    const subAdmin = await getSubAdminRow(req.adminUsername);
    if (!subAdmin) {
      res.status(403).json({ error: "Only sub-admin accounts support per-account 2FA via this endpoint" });
      return;
    }
    if (subAdmin.twoFactorEnabled) {
      res.status(409).json({ error: "2FA is already enabled. Disable it first before re-enrolling." });
      return;
    }

    const secret = generateSecret();
    const backupCodes = generateBackupCodes();
    const backupCodeHashes = await Promise.all(
      backupCodes.map((code) => bcrypt.hash(code, BCRYPT_ROUNDS)),
    );

    const displayName = subAdmin.displayName ?? subAdmin.username;
    const otpauth = generateURI({
      label: displayName,
      issuer: "IBCCF Admin",
      secret,
    });

    // Persist the pending secret. twoFactorEnabled stays false until
    // the sub-admin confirms with a live code.
    await storage.updateAdminUser(subAdmin.id, { twoFactorSecret: secret });

    // Store backup codes in admin_two_factor keyed by username.
    // If a pending row already exists, update it; otherwise create one.
    const existing = await storage.getAdminTwoFactor(subAdmin.username);
    if (existing) {
      await storage.updateAdminTwoFactor(subAdmin.username, {
        secret,
        backupCodes: JSON.stringify(backupCodeHashes),
        isEnabled: false,
      });
    } else {
      await storage.createAdminTwoFactor({
        adminUsername: subAdmin.username,
        secret,
        backupCodes: JSON.stringify(backupCodeHashes),
        isEnabled: false,
      });
    }

    res.json({ otpauth, backupCodes });
  } catch {
    res.status(500).json({ error: "Failed to initiate 2FA setup" });
  }
});

// POST /api/admin-users/me/2fa/confirm — verify a live TOTP code to activate 2FA
adminUsersRouter.post("/me/2fa/confirm", checkAdminAuth, async (req, res) => {
  try {
    const subAdmin = await getSubAdminRow(req.adminUsername);
    if (!subAdmin) {
      res.status(403).json({ error: "Only sub-admin accounts support per-account 2FA via this endpoint" });
      return;
    }
    if (subAdmin.twoFactorEnabled) {
      res.status(409).json({ error: "2FA is already enabled" });
      return;
    }
    if (!subAdmin.twoFactorSecret) {
      res.status(400).json({ error: "No pending 2FA setup found. Call /setup first." });
      return;
    }

    const parsed = z.object({ code: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    const valid = totpVerifySync({
      token: parsed.data.code.replace(/\s/g, ""),
      secret: subAdmin.twoFactorSecret,
    });
    if (!valid) {
      res.status(400).json({ error: "Invalid verification code" });
      return;
    }

    await storage.updateAdminUser(subAdmin.id, { twoFactorEnabled: true });
    await storage.updateAdminTwoFactor(subAdmin.username, {
      isEnabled: true,
      enabledAt: new Date(),
      lastVerifiedAt: new Date(),
    });

    await storage.createAuditLog({
      adminUsername: req.adminUsername ?? "unknown",
      action: "sub_admin_2fa_enabled",
      targetType: "admin_user",
      targetId: String(subAdmin.id),
      previousValue: null,
      newValue: JSON.stringify({ username: subAdmin.username }),
      ipAddress: getClientIp(req) ?? null,
      userAgent: req.headers["user-agent"]?.toString() ?? null,
    }).catch(() => {});

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to confirm 2FA" });
  }
});

// DELETE /api/admin-users/me/2fa — disable own 2FA
adminUsersRouter.delete("/me/2fa", checkAdminAuth, async (req, res) => {
  try {
    const subAdmin = await getSubAdminRow(req.adminUsername);
    if (!subAdmin) {
      res.status(403).json({ error: "Only sub-admin accounts support per-account 2FA via this endpoint" });
      return;
    }

    await storage.updateAdminUser(subAdmin.id, {
      twoFactorEnabled: false,
      twoFactorSecret: null,
    });

    // Remove backup codes / 2FA record for this user.
    const existing = await storage.getAdminTwoFactor(subAdmin.username);
    if (existing) {
      await storage.updateAdminTwoFactor(subAdmin.username, {
        isEnabled: false,
        backupCodes: null,
      });
    }

    await storage.createAuditLog({
      adminUsername: req.adminUsername ?? "unknown",
      action: "sub_admin_2fa_disabled",
      targetType: "admin_user",
      targetId: String(subAdmin.id),
      previousValue: null,
      newValue: JSON.stringify({ username: subAdmin.username }),
      ipAddress: getClientIp(req) ?? null,
      userAgent: req.headers["user-agent"]?.toString() ?? null,
    }).catch(() => {});

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to disable 2FA" });
  }
});

// GET /api/admin-users/:id/2fa-status — view sub-admin 2FA status (super_admin only)
adminUsersRouter.get("/:id/2fa-status", checkAdminAuth, requireAdminRole("super_admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const user = await storage.getAdminUserById(id);
    if (!user) {
      res.status(404).json({ error: "Admin user not found" });
      return;
    }
    const backupConfig = await storage.getAdminTwoFactor(user.username);
    const hasBackupCodes = !!backupConfig?.backupCodes &&
      (() => { try { return (JSON.parse(backupConfig.backupCodes!) as unknown[]).length > 0; } catch { return false; } })();
    res.json({
      twoFactorEnabled: user.twoFactorEnabled ?? false,
      hasBackupCodes,
      lastVerifiedAt: backupConfig?.lastVerifiedAt ?? null,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch 2FA status" });
  }
});

// DELETE /api/admin-users/:id/2fa — reset sub-admin 2FA (super_admin only)
adminUsersRouter.delete("/:id/2fa", checkAdminAuth, requireAdminRole("super_admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const user = await storage.getAdminUserById(id);
    if (!user) {
      res.status(404).json({ error: "Admin user not found" });
      return;
    }

    await storage.updateAdminUser(id, {
      twoFactorEnabled: false,
      twoFactorSecret: null,
    });

    const existing = await storage.getAdminTwoFactor(user.username);
    if (existing) {
      await storage.updateAdminTwoFactor(user.username, {
        isEnabled: false,
        backupCodes: null,
      });
    }

    await storage.createAuditLog({
      adminUsername: req.adminUsername ?? "unknown",
      action: "sub_admin_2fa_reset",
      targetType: "admin_user",
      targetId: String(id),
      previousValue: JSON.stringify({ username: user.username }),
      newValue: null,
      ipAddress: getClientIp(req) ?? null,
      userAgent: req.headers["user-agent"]?.toString() ?? null,
    }).catch(() => {});

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to reset 2FA" });
  }
});

// DELETE /api/admin-users/:id — permanently remove a sub-admin account (super_admin only)
adminUsersRouter.delete("/:id", checkAdminAuth, requireAdminRole("super_admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const existing = await storage.getAdminUserById(id);
    if (!existing) {
      res.status(404).json({ error: "Admin user not found" });
      return;
    }

    await storage.deleteAdminUser(id);

    // Immediately revoke all active sessions for the deleted account so the
    // bearer token cannot be reused after deletion.
    storage.revokeAllAdminSessions(existing.username).catch(() => {});

    await storage.createAuditLog({
      adminUsername: req.adminUsername ?? "unknown",
      action: "sub_admin_deleted",
      targetType: "admin_user",
      targetId: String(id),
      previousValue: JSON.stringify({ username: existing.username, role: existing.role }),
      newValue: null,
      ipAddress: getClientIp(req) ?? null,
      userAgent: req.headers["user-agent"]?.toString() ?? null,
    }).catch(() => {});

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete admin user" });
  }
});
