import { Router } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { caseService } from "../services";
import { StageTransitionError } from "../services/CaseService";
import { updateCaseSchema, updateCaseLetterSchema, insertDeclarationSubmissionSchema } from "@shared/schema";
import { buildRefundClaimCertificate } from "../services/refundClaimCertificate";
import { z } from "zod";
import { checkAdminAuth } from "./middleware";
import { requireAdminRole } from "./adminPermissions";
import {
  requirePortalAccess,
  requireUnsealed,
  requirePortalSessionOnly,
  isAuthorizedForCase,
} from "../services/portal-auth";
import { validateDocumentDataUrl } from "./content";
import bcrypt from "bcryptjs";
import { warnOnce } from "../lib/warnOnce";
export { __resetWarnDedupForTests } from "../lib/warnOnce";
import {
  maybeAlertOnWalletConnect,
  deleteWalletConnectAlertMarkersForCase,
  walletConnectAlertFiredKey,
} from "../services/walletConnectAlert";
import { sendCaseEmailWithAudit } from "../services/emailNotify";
import { emailService } from "../services/EmailService";

/**
 * Strip stage-skip sensitive fields from a case object for non-super_admin callers.
 * stageSkipStatus is intentionally kept so agents can see pending/approved/rejected state.
 */
function sanitizeCaseForRole<T extends Record<string, unknown>>(
  caseData: T,
  adminRole?: string,
): Omit<T, "stageSkipRequestedBy" | "stageSkipRequestedAt" | "stageSkipTargetStage" | "stageSkipReason"> | T {
  if (adminRole === "super_admin") return caseData;
  const {
    stageSkipRequestedBy: _1,
    stageSkipRequestedAt: _2,
    stageSkipTargetStage: _3,
    stageSkipReason: _4,
    ...rest
  } = caseData;
  return rest as Omit<T, "stageSkipRequestedBy" | "stageSkipRequestedAt" | "stageSkipTargetStage" | "stageSkipReason">;
}

// Resolve the actual admin username from the bearer token on a request.
// `checkAdminAuth` middleware only validates the token, it doesn't
// attach the session — so any audit-log entry that wants real
// attribution needs to look it up itself. Returns "Admin" as a safe
// fallback if anything fails (token missing, session expired, DB error)
// so this can never throw out of an audit path.
async function resolveAdminUsernameFromReq(
  req: { headers: { authorization?: string | string[] | undefined } },
): Promise<string> {
  try {
    const raw = req.headers.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header || !header.startsWith("Bearer ")) return "Admin";
    const token = header.slice("Bearer ".length).trim();
    if (!token) return "Admin";
    const session = await storage.getAdminSessionByToken(token);
    return session?.adminUsername || "Admin";
  } catch {
    return "Admin";
  }
}

// Charset for generated access codes: digits only, so codes are easy
// to read from an email and type accurately on any device. 10 symbols ×
// 12 positions gives 10^12 possible values, combined with the existing
// collision-retry-on-insert logic to guarantee uniqueness.
const ACCESS_CODE_CHARS = "0123456789";
const ACCESS_CODE_LENGTH = 12;

function generateSecureAccessCode(): string {
  const bytes = crypto.randomBytes(ACCESS_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < ACCESS_CODE_LENGTH; i++) {
    code += ACCESS_CODE_CHARS[bytes[i] % ACCESS_CODE_CHARS.length];
  }
  return code;
}

// Naming convention used to identify document_requests rows that were
// uploaded inline as part of a Declaration of Compliance submission. We
// prefix the documentType so they're trivially filterable from the rest of
// the per-case document list (admin-requested KYC, source of funds, etc.).
const DECLARATION_DOC_PREFIX = "Declaration: ";
const DECLARATION_PSOI_TYPE = `${DECLARATION_DOC_PREFIX}Proof of Source of Income`;
const MAX_DECLARATION_SUPPORTING = 3;

const declarationAttachmentSchema = z.object({
  category: z.enum(["proof_of_income", "custom"]),
  label: z.string().max(120).optional(),
  fileName: z.string().min(1).max(255),
  fileData: z.string().min(1),
});
type DeclarationAttachmentInput = z.infer<typeof declarationAttachmentSchema>;

const BCRYPT_ROUNDS = 10;

// PINs are stored as bcrypt hashes. `isBcryptHash` identifies any value
// produced by bcrypt (both new hashes and pre-existing legacy hashes).
// Legacy plaintext PINs (written during a previous window where storage
// was intentionally plain) are still accepted on login and immediately
// upgraded to a bcrypt hash so the database no longer contains recoverable
// credentials.
function isBcryptHash(stored: string): boolean {
  return stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$");
}

async function verifyPin(
  pin: string,
  storedPin: string,
): Promise<{ valid: boolean; needsMigration: boolean }> {
  if (isBcryptHash(storedPin)) {
    // Already a bcrypt hash — verify normally, no migration needed.
    try {
      const ok = await bcrypt.compare(pin, storedPin);
      return { valid: ok, needsMigration: false };
    } catch {
      return { valid: false, needsMigration: false };
    }
  }
  // Legacy plaintext PIN — direct compare, migrate to bcrypt on success.
  // strict-equality-guard: must stay === (not ==) — loose equality would
  // coerce types (e.g. numeric 0 against empty string) and could allow a
  // plaintext-PIN bypass before the bcrypt migration completes.
  const ok = pin === storedPin;
  return { valid: ok, needsMigration: ok };
}

const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW = 10 * 60 * 1000; // 10 minutes

// DB-backed pin rate limiter. Keys are stored in the adminLoginAttempts table
// with the "pin_login" namespace so counts are shared across all autoscale
// instances. The in-memory fallback map is used only when the DB is unavailable.
const pinLoginAttemptsFallback = new Map<string, { count: number; resetTime: number }>();

function pinRateLimitKey(ip: string): string {
  return `pin_login:${ip}`;
}

async function checkPinRateLimit(ip: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = Date.now();
  const key = pinRateLimitKey(ip);
  try {
    const row = await storage.getAdminLoginAttemptByKey(key);
    if (!row || row.resetAt.getTime() <= now) {
      return { allowed: true };
    }
    if (row.count >= MAX_PIN_ATTEMPTS) { // >= (not >): lockout fires at exactly MAX_PIN_ATTEMPTS; > would silently allow one extra attempt
      return { allowed: false, retryAfter: Math.ceil((row.resetAt.getTime() - now) / 1000) };
    }
    return { allowed: true };
  } catch (err) {
    warnOnce("checkPinRateLimit:db-fail", "checkPinRateLimit: DB lookup failed, using in-memory fallback:", err);
    const mem = pinLoginAttemptsFallback.get(key);
    if (!mem || now > mem.resetTime) return { allowed: true };
    if (mem.count >= MAX_PIN_ATTEMPTS) { // >= (not >): mirrors the DB-path operator above; must stay in sync
      return { allowed: false, retryAfter: Math.ceil((mem.resetTime - now) / 1000) };
    }
    return { allowed: true };
  }
}

// Per-IP rate limiter for failed reads of GET /:id/declaration. Mirrors
// the checkPinRateLimit pattern (5 failures / 10 min window, 15 min
// lockout). Only failed attempts count — a legitimate caller with a
// valid portal session never bumps the counter, so this can never lock
// out a real user.
//
// The rate-limiting decision is backed by the DB (adminLoginAttempts table,
// "decl_read" namespace) so counts are shared across all autoscale instances.
// The in-memory bucket is kept only for the alerting side-channel (caseIds
// probed, alertedAt debounce) — it is never the sole enforcement mechanism.
type DeclarationReadBucket = {
  count: number;
  lastAttempt: number;
  lockedUntil?: number;
  caseIds: Set<string>;
  alertedAt?: number;
  lastUserAgent?: string | null;
};
const declarationReadAttempts = new Map<string, DeclarationReadBucket>();
const MAX_DECLARATION_READ_FAILURES = 5;
const DECLARATION_READ_LOCKOUT_MS = 15 * 60 * 1000;
const DECLARATION_READ_WINDOW_MS = 10 * 60 * 1000;

// Per-IP rate limiter for failed declaration write attempts (POST /:id/declaration).
// Mirrors the read-path limiter: 5 wrong access-code guesses within a
// 10-minute window triggers a 15-minute lockout. Only wrong-code responses
// bump the counter; a caller who supplies a valid code is never penalised.
//
// Backed by the same adminLoginAttempts table as the read-side limiter
// (namespaced "decl_write:<ip>") so counts are shared across all autoscale
// instances. The in-memory bucket is the fallback used only when the DB
// is unavailable — an attacker can no longer bypass the limit by spraying
// requests across different instances.
const declarationWriteAttemptsFallback = new Map<
  string,
  { count: number; lastAttempt: number; lockedUntil?: number }
>();
const MAX_DECLARATION_WRITE_FAILURES = 5;
const DECLARATION_WRITE_LOCKOUT_MS = 15 * 60 * 1000;
const DECLARATION_WRITE_WINDOW_MS = 10 * 60 * 1000;

function declWriteRateLimitKey(ip: string): string {
  return `decl_write:${ip}`;
}

async function checkDeclarationWriteRateLimit(
  ip: string,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = Date.now();
  const key = declWriteRateLimitKey(ip);
  try {
    const row = await storage.getAdminLoginAttemptByKey(key);
    if (!row || row.resetAt.getTime() <= now) return { allowed: true };
    if (row.count >= MAX_DECLARATION_WRITE_FAILURES) { // >= (not >): lockout fires at exactly MAX_DECLARATION_WRITE_FAILURES; > would silently allow one extra attempt
      return {
        allowed: false,
        retryAfter: Math.ceil((row.resetAt.getTime() - now) / 1000),
      };
    }
    return { allowed: true };
  } catch (err) {
    warnOnce(
      "checkDeclarationWriteRateLimit:db-fail",
      "checkDeclarationWriteRateLimit: DB lookup failed, using in-memory fallback:",
      err,
    );
    const attempts = declarationWriteAttemptsFallback.get(ip);
    if (!attempts) return { allowed: true };
    if (attempts.lockedUntil && now < attempts.lockedUntil) {
      return {
        allowed: false,
        retryAfter: Math.ceil((attempts.lockedUntil - now) / 1000),
      };
    }
    if (now - attempts.lastAttempt > DECLARATION_WRITE_WINDOW_MS) {
      declarationWriteAttemptsFallback.delete(ip);
      return { allowed: true };
    }
    if (attempts.count >= MAX_DECLARATION_WRITE_FAILURES) { // >= (not >): mirrors the DB-path operator above; must stay in sync
      attempts.lockedUntil = now + DECLARATION_WRITE_LOCKOUT_MS;
      return {
        allowed: false,
        retryAfter: Math.ceil(DECLARATION_WRITE_LOCKOUT_MS / 1000),
      };
    }
    return { allowed: true };
  }
}

async function recordDeclarationWriteFailure(ip: string): Promise<void> {
  const now = Date.now();
  const key = declWriteRateLimitKey(ip);
  try {
    await storage.atomicIncrementRateLimit({
      key,
      windowResetAt: new Date(now + DECLARATION_WRITE_WINDOW_MS),
      lockoutResetAt: new Date(now + DECLARATION_WRITE_LOCKOUT_MS),
      maxCount: MAX_DECLARATION_WRITE_FAILURES,
    });
  } catch (err) {
    warnOnce(
      "recordDeclarationWriteFailure:db-fail",
      "recordDeclarationWriteFailure: DB atomic increment failed, using in-memory fallback:",
      err,
    );
    let attempts = declarationWriteAttemptsFallback.get(ip);
    if (!attempts || now - attempts.lastAttempt > DECLARATION_WRITE_WINDOW_MS) {
      declarationWriteAttemptsFallback.set(ip, { count: 1, lastAttempt: now });
    } else {
      attempts.count++;
      attempts.lastAttempt = now;
    }
  }
}

// Test-only escape hatch so unit tests don't carry IP-bucket state between
// cases. Not exported through the route surface.
export function __resetDeclarationWriteRateLimitForTests(): void {
  declarationWriteAttemptsFallback.clear();
}

// Burst-alert thresholds. Crossing ANY of these (within the active
// window) — sustained attempts, several distinct cases probed, or the
// limiter actually engaging — escalates to a security email. Tuned so
// the email is genuinely useful (a real brute-force scan) and not spammy
// (a single confused user retyping their access code 6 times shouldn't
// page anyone).
const BURST_ATTEMPT_THRESHOLD = 10;
const BURST_DISTINCT_CASES_THRESHOLD = 3;

function declReadRateLimitKey(ip: string): string {
  return `decl_read:${ip}`;
}

async function checkDeclarationReadRateLimit(
  ip: string,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = Date.now();
  const key = declReadRateLimitKey(ip);
  try {
    const row = await storage.getAdminLoginAttemptByKey(key);
    if (!row || row.resetAt.getTime() <= now) return { allowed: true };
    if (row.count >= MAX_DECLARATION_READ_FAILURES) { // >= (not >): lockout fires at exactly MAX_DECLARATION_READ_FAILURES; > would silently allow one extra attempt
      return { allowed: false, retryAfter: Math.ceil((row.resetAt.getTime() - now) / 1000) };
    }
    return { allowed: true };
  } catch (err) {
    warnOnce("checkDeclarationReadRateLimit:db-fail", "checkDeclarationReadRateLimit: DB lookup failed, using in-memory fallback:", err);
    const attempts = declarationReadAttempts.get(ip);
    if (!attempts) return { allowed: true };
    if (attempts.lockedUntil && now < attempts.lockedUntil) {
      return { allowed: false, retryAfter: Math.ceil((attempts.lockedUntil - now) / 1000) };
    }
    if (now - attempts.lastAttempt > DECLARATION_READ_WINDOW_MS) {
      declarationReadAttempts.delete(ip);
      return { allowed: true };
    }
    if (attempts.count >= MAX_DECLARATION_READ_FAILURES) { // >= (not >): mirrors the DB-path operator above; must stay in sync
      attempts.lockedUntil = now + DECLARATION_READ_LOCKOUT_MS;
      return { allowed: false, retryAfter: Math.ceil(DECLARATION_READ_LOCKOUT_MS / 1000) };
    }
    return { allowed: true };
  }
}

async function recordDeclarationReadFailure(
  ip: string,
  caseId?: string,
  userAgent?: string | null,
): Promise<DeclarationReadBucket> {
  const now = Date.now();
  const key = declReadRateLimitKey(ip);

  // Update the in-memory bucket (used for alerting metadata only — caseIds
  // probed, alertedAt debounce — not for the rate-limiting decision itself).
  let bucket = declarationReadAttempts.get(ip);
  if (!bucket || now - bucket.lastAttempt > DECLARATION_READ_WINDOW_MS) {
    bucket = { count: 1, lastAttempt: now, caseIds: new Set<string>() };
    declarationReadAttempts.set(ip, bucket);
  } else {
    bucket.count++;
    bucket.lastAttempt = now;
  }
  if (caseId) bucket.caseIds.add(caseId);
  if (userAgent !== undefined) bucket.lastUserAgent = userAgent;

  // Atomic additive increment to DB — each instance's write adds 1 to the
  // shared counter. The lockout window extends automatically when count
  // reaches MAX_DECLARATION_READ_FAILURES.
  try {
    await storage.atomicIncrementRateLimit({
      key,
      windowResetAt: new Date(now + DECLARATION_READ_WINDOW_MS),
      lockoutResetAt: new Date(now + DECLARATION_READ_LOCKOUT_MS),
      maxCount: MAX_DECLARATION_READ_FAILURES,
    });
  } catch (err) {
    warnOnce("recordDeclarationReadFailure:db-fail", "recordDeclarationReadFailure: DB atomic increment failed, in-memory only:", err);
  }

  return bucket;
}

// Test-only escape hatch so the unit tests don't carry IP-bucket state
// between cases. Not exported through the route surface.
export function __resetDeclarationReadRateLimitForTests(): void {
  declarationReadAttempts.clear();
}

// Debounced security-alert dispatcher. Called whenever an IP records a
// failure or trips the rate-limiter; only fires an email if (a) one of
// the burst thresholds is crossed and (b) we haven't already alerted on
// this bucket within the current lockout window. The bucket's
// `alertedAt` timestamp is the debounce key — clearing it requires the
// 10-min inactivity window to expire (which deletes the bucket entirely
// inside `checkDeclarationReadRateLimit`).
function maybeFireDeclarationScanAlert(
  bucket: DeclarationReadBucket,
  ip: string,
  contextCaseId: string,
  trigger: "rate_limited" | "threshold",
): void {
  const reasons: string[] = [];
  if (trigger === "rate_limited") {
    reasons.push("Per-IP rate limiter engaged (sustained 401s past lockout).");
  }
  if (bucket.count >= BURST_ATTEMPT_THRESHOLD) { // >= (not >): alert fires at exactly BURST_ATTEMPT_THRESHOLD; > would delay the security signal by one event
    reasons.push(`${bucket.count} failed attempts in the active window.`);
  }
  if (bucket.caseIds.size >= BURST_DISTINCT_CASES_THRESHOLD) { // >= (not >): alert fires at exactly BURST_DISTINCT_CASES_THRESHOLD distinct cases; > would delay the signal
    reasons.push(
      `${bucket.caseIds.size} distinct case ids probed from this IP.`,
    );
  }
  if (reasons.length === 0) return;

  const now = Date.now();
  if (
    bucket.alertedAt &&
    now - bucket.alertedAt < DECLARATION_READ_LOCKOUT_MS
  ) {
    // Already paged on this burst — stay quiet until the bucket resets.
    return;
  }
  bucket.alertedAt = now;

  // Recipient priority matches the task spec: dedicated alert mailbox if
  // configured, otherwise fall back to the From address used for all other
  // transactional mail. We deliberately do NOT silently fall back to
  // SMTP_USER — if neither var is set we just skip the email.
  const recipient =
    process.env.SECURITY_ALERT_EMAIL?.trim() ||
    process.env.SMTP_FROM_ADDRESS?.trim() ||
    null;
  if (!recipient) return;

  const sampleCaseIds = Array.from(bucket.caseIds);
  const triggerReason = reasons.join(" ");
  const isThrottled =
    typeof bucket.lockedUntil === "number" && bucket.lockedUntil > now;

  // Fire-and-forget — never block the response path. We re-import the
  // helpers lazily so the test harness (which stubs storage) doesn't
  // pull a live SMTP transporter at import time.
  (async () => {
    try {
      const [{ emailService }, { sendCaseEmailWithAudit }] = await Promise.all([
        import("../services/EmailService"),
        import("../services/emailNotify"),
      ]);
      await sendCaseEmailWithAudit({
        to: recipient,
        caseId: contextCaseId,
        tag: "declaration-scan-alert",
        adminUser: "security-monitor",
        send: () =>
          emailService.sendDeclarationScanAlertEmail(recipient, {
            ipAddress: ip,
            attemptCount: bucket.count,
            distinctCaseCount: bucket.caseIds.size,
            sampleCaseIds,
            windowMinutes: Math.round(DECLARATION_READ_WINDOW_MS / 60_000),
            isThrottled,
            triggerReason,
            lastUserAgent: bucket.lastUserAgent ?? null,
          }),
      });
    } catch (err) {
      warnOnce(
        "cases:failed-to-dispatch-scan-alert-email",
        "[declaration-read] failed to dispatch scan-alert email:",
        err,
      );
    }
  })();
}

async function recordPinAttempt(ip: string, success: boolean): Promise<void> {
  const key = pinRateLimitKey(ip);
  if (success) {
    pinLoginAttemptsFallback.delete(key);
    storage.clearAdminLoginAttemptKey(key).catch((err) =>
      warnOnce("recordPinAttempt:clear-fail", "recordPinAttempt: failed to clear DB key on success:", err),
    );
    return;
  }

  const now = Date.now();
  // Atomic additive increment — each instance's failure write adds 1 to the
  // shared counter rather than clobbering with MAX semantics. The lockout
  // window (15 min) activates as soon as count reaches MAX_PIN_ATTEMPTS.
  try {
    const { count, resetAt } = await storage.atomicIncrementRateLimit({
      key,
      windowResetAt: new Date(now + ATTEMPT_WINDOW),
      lockoutResetAt: new Date(now + LOCKOUT_DURATION),
      maxCount: MAX_PIN_ATTEMPTS,
    });
    pinLoginAttemptsFallback.set(key, { count, resetTime: resetAt.getTime() });
  } catch (err) {
    warnOnce("recordPinAttempt:increment-fail", "recordPinAttempt: DB increment failed, updating fallback only:", err);
    const mem = pinLoginAttemptsFallback.get(key);
    const newCount = (mem && now <= mem.resetTime ? mem.count : 0) + 1;
    const newResetTime = newCount >= MAX_PIN_ATTEMPTS ? now + LOCKOUT_DURATION : now + ATTEMPT_WINDOW;
    pinLoginAttemptsFallback.set(key, { count: newCount, resetTime: newResetTime });
  }
}

export const casesRouter = Router();

casesRouter.post("/", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    const { accessCode, status, userEmail } = req.body;
    if (!accessCode) {
      res.status(400).json({ error: "Access code is required" });
      return;
    }
    
    const newCase = await caseService.createCase({ 
      accessCode, 
      status: status || 'created',
      ...(userEmail ? { userEmail } : {}),
    });
    res.json(sanitizeCaseForRole(newCase as unknown as Record<string, unknown>, req.adminRole));

    // Fire-and-forget post-creation side effects. Neither must block or
    // throw — by the time they run the HTTP response has already been sent.
    const caseId = newCase.id;
    const adminUser = await resolveAdminUsernameFromReq(req);
    const dashboardUrl = `${process.env.APP_BASE_URL?.replace(/\/+$/, '') || 'https://ibccf.site'}/admin`;

    // In-app admin notification for new case creation.
    void (async () => {
      try {
        const { notificationService } = await import("../services/NotificationService");
        await notificationService.notifyAdmin(
          'new_case',
          `New case created: ${caseId}`,
          `Created by ${adminUser}`,
          dashboardUrl,
        );
      } catch (err) {
        warnOnce('cases:admin-notify-fail', '[cases] admin in-app notification failed:', err);
      }
    })();

    // Gap 2: email all configured admin alert recipients.
    void (async () => {
      try {
        const { resolveDocumentUploadAlertRecipientsLocal } = await import("./content");
        const recipients = await resolveDocumentUploadAlertRecipientsLocal();
        if (recipients.length > 0) {
          const result = await emailService.sendAdminNewCaseAlert({
            to: recipients,
            caseId,
            submitterName: adminUser,
            dashboardUrl,
          });
          try {
            await storage.createAuditLog({
              action: result.success ? 'email_admin_new_case' : 'email_admin_new_case_failed',
              newValue: result.success
                ? `Admin new-case alert sent to ${recipients.join(', ')}`
                : `Admin new-case alert failed: ${result.error ?? 'unknown'}`,
              adminUsername: adminUser,
              targetType: 'case',
              targetId: caseId,
              metadata: null,
            });
          } catch (logErr) {
            warnOnce('cases:admin-new-case-audit-fail', '[cases] admin new-case audit log failed:', logErr);
          }
        }
      } catch (err) {
        warnOnce('cases:admin-new-case-alert-fail', '[cases] admin new-case alert failed:', err);
      }
    })();

    // Gap 1: send user confirmation if the new case already has an email
    // (rare at admin-creation time, but handled gracefully).
    void (async () => {
      try {
        const caseData = await storage.getCaseById(caseId);
        if (caseData?.userEmail) {
          const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
          const userName = (caseData.userName ?? '').trim() || caseData.userEmail;
          await sendCaseEmailWithAudit({
            to: caseData.userEmail,
            caseId,
            tag: 'case_created',
            adminUser,
            send: (locale) =>
              emailService.sendCaseCreatedConfirmation({
                to: caseData.userEmail!,
                userName,
                caseRef: caseId,
                locale,
              }),
          });
        }
      } catch (err) {
        warnOnce('cases:case-created-email-fail', '[cases] case-created confirmation email failed:', err);
      }
    })();

  } catch (error: any) {
    if (error?.code === '23505') {
      res.status(400).json({ error: "Access code already exists" });
    } else {
      res.status(500).json({ error: error?.message || "Failed to create case" });
    }
  }
});

// Server-side pagination/filtering (Task #2443). When `page` is supplied,
// the response is paged and filtered in SQL — the client fetches (and
// renders) at most one page at a time instead of every case row, which is
// what caused choking as the case table grows into the thousands. Callers
// that don't pass `page` keep receiving the legacy full-array response
// (used by admin badge/KPI polling and a few advanced picker/bulk flows
// that intentionally operate over the entire case set).
casesRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const pageRaw = req.query.page;
    if (pageRaw !== undefined) {
      const page = Math.max(1, parseInt(String(pageRaw), 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const locale = typeof req.query.locale === "string" ? req.query.locale : undefined;
      const sealedRaw = typeof req.query.sealed === "string" ? req.query.sealed : undefined;
      const sealed = sealedRaw === "sealed" || sealedRaw === "open" ? sealedRaw : undefined;

      const { cases: pageCases, total } = await storage.getCasesPage({
        page,
        pageSize,
        search,
        status,
        locale,
        sealed,
      });
      res.json({
        cases: pageCases.map(({ userPin: _pin, ...rest }) =>
          sanitizeCaseForRole(rest as Record<string, unknown>, req.adminRole),
        ),
        total,
        page,
        pageSize,
      });
      return;
    }

    const allCases = await caseService.getAllCases();
    res.json(
      allCases.map(({ userPin: _pin, ...rest }) =>
        sanitizeCaseForRole(rest as Record<string, unknown>, req.adminRole),
      ),
    );
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

casesRouter.get("/access/:code", async (req, res) => {
  try {
    // Rate limit access code lookups
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const rateCheck = await checkPinRateLimit(ip);
    if (!rateCheck.allowed) {
      res.status(429).json({ 
        error: "Too many attempts. Please try again later.",
        retryAfter: rateCheck.retryAfter 
      });
      return;
    }
    
    const caseData = await caseService.getCaseByAccessCode(req.params.code);
    if (!caseData) {
      await recordPinAttempt(ip, false);
      res.status(404).json({ error: "Case not found" });
      return;
    }
    
    await recordPinAttempt(ip, true);

    // Disabled accounts are always blocked, even during an unauthenticated
    // bootstrap request (e.g. first-time PIN setup).
    if (caseData.isDisabled) {
      res.status(403).json({ error: "Account disabled", reason: "reactivation_required" });
      return;
    }

    // Once a PIN has been set the access code alone is no longer sufficient
    // to read private case data. The caller must supply a valid portal session
    // token (x-portal-session-token) or an admin bearer token. This closes
    // the path where a leaked access code — from an email, browser storage
    // dump, or support transcript — could be replayed directly against this
    // endpoint to extract regulated case metadata without the user's PIN.
    //
    // The unauthenticated path is intentionally preserved for cases that have
    // no PIN yet (userPin is null) so the initial registration bootstrap flow
    // (verify-access-code → GET /access/:code → set PIN) continues to work.
    if (caseData.userPin) {
      const authorized = await isAuthorizedForCase(req, caseData.id);
      if (!authorized) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }

    // Best-effort persist the recipient's preferred locale onto the case
    // so transactional emails (including admin-triggered ones, where the
    // request carries the admin's locale rather than the user's) render
    // in the user's language. Only writes when the header-supplied locale
    // actually differs from what's already stored, to avoid hammering the
    // row on every poll. Failures are swallowed — UI rendering must never
    // depend on this side effect.
    try {
      const locale = req.userLocale;
      if (
        locale &&
        locale !== "en" &&
        caseData.preferredLocale !== locale
      ) {
        await caseService.updateCase(caseData.id, {
          preferredLocale: locale,
        });
      } else if (
        locale === "en" &&
        !caseData.preferredLocale
      ) {
        // First contact in English — record it so we don't keep retrying.
        await caseService.updateCase(caseData.id, { preferredLocale: "en" });
      }
    } catch {
      /* never block the access lookup over a locale write */
    }

    // Return user-facing fields, not internal admin data
    const userFacingData = {
      id: caseData.id,
      accessCode: caseData.accessCode,
      status: caseData.status,
      userName: caseData.userName,
      userEmail: caseData.userEmail,
      userMobile: caseData.userMobile,
      withdrawalStage: caseData.withdrawalStage,
      depositAddress: caseData.depositAddress,
      depositAsset: caseData.depositAsset,
      depositNetwork: caseData.depositNetwork,
      // User-declared preferred settlement asset + network (Task #938).
      // Read by the coin/network selector in the portal's Deposits and
      // Withdrawal views; admins can view/override from the case edit dialog.
      preferredDepositAsset: caseData.preferredDepositAsset,
      preferredDepositNetwork: caseData.preferredDepositNetwork,
      // Batch merge processing fee — admin-configurable; portal falls back to '500'.
      mergeFeeAmount: caseData.mergeFeeAmount,
      // When true, the merge-fee banner in the portal Uploads view is suppressed.
      mergeFeeHideBanner: caseData.mergeFeeHideBanner,
      // Verified Payout Wallet — admin-designated disbursement address.
      // Display-only on the portal; this app does NOT route or relay funds.
      payoutWalletAddress: caseData.payoutWalletAddress,
      payoutWalletAsset: caseData.payoutWalletAsset,
      payoutWalletNetwork: caseData.payoutWalletNetwork,
      // payoutWalletNote is intentionally OMITTED from the portal payload —
      // it's an officer-only internal note and must never be exposed to
      // user-facing surfaces.
      payoutWalletVerifiedAt: caseData.payoutWalletVerifiedAt,
      payoutWalletVerifiedBy: caseData.payoutWalletVerifiedBy,
      profileRedirectUrl: caseData.profileRedirectUrl,
      // Admin-controlled flags/fields the portal renders
      letterSent: caseData.letterSent,
      vipStatus: caseData.vipStatus,
      username: caseData.username,
      withdrawalAmount: caseData.withdrawalAmount,
      withdrawalBatches: caseData.withdrawalBatches,
      hasRequirements: caseData.hasRequirements,
      submissionUrl: caseData.submissionUrl,
      declarationStatus: caseData.declarationStatus,
      refundClaimStatus: caseData.refundClaimStatus,
      showWithdrawalProgress: caseData.showWithdrawalProgress,
      activityDepositAmount: caseData.activityDepositAmount,
      phraseKeyDepositAmount: caseData.phraseKeyDepositAmount,
      activityWalletRequirement: caseData.activityWalletRequirement,
      phraseKeyMergeDeposit: caseData.phraseKeyMergeDeposit,
      landingPage: caseData.landingPage,
      // Admin-triggered force logout marker. The portal compares this
      // to its locally-stored login time; without it the client cannot
      // detect that an admin has signed the user out.
      forceLogoutAt: caseData.forceLogoutAt,
      // Account-locked flag. The portal kicks the user out as soon as
      // it sees this flip to true (admin lock during an active session).
      isDisabled: caseData.isDisabled,
      // Country-mode display. When `localizedCurrencyEnabled` is true and
      // `country` resolves to a known currency, the portal renders every
      // USDT figure with a parenthetical local-currency estimate. The
      // conversion is display-only — deposits stay denominated in USDT.
      country: caseData.country,
      localizedCurrencyEnabled: caseData.localizedCurrencyEnabled,
      // "Fully Regulated" badge — drives the blue verified checkmark
      // next to the user's name in the portal header.
      isRegulated: caseData.isRegulated,
      // Withdrawal Window — admin-controlled toggle that gates the portal's
      // "Request Withdrawal" CTA. When false the CTA is hidden and any
      // POST /api/cases/:id/withdrawal-requests is rejected server-side.
      withdrawalWindowEnabled: caseData.withdrawalWindowEnabled,
      // Per-case NDA toggle. When false the portal SealedView renders a
      // "no signature required" notice instead of the typed-signature
      // capture form, and POST /:id/nda/sign is rejected server-side.
      ndaEnabled: caseData.ndaEnabled,
      // Sealed Settlement & NDA — portal uses these to (a) decide whether
      // to render the "Sealed Settlement & NDA" nav item / dashboard CTA
      // and (b) flip the entire portal into read-only mode once the
      // user's typed signature has been captured.
      sealedAt: caseData.sealedAt,
      sealedBy: caseData.sealedBy,
      // Withdrawal Activation (Task #66) — surfaced after stage 14 so the
      // portal can render the congratulations + bind-wallet + deposit flow
      // and gate the in-flight banner copy on the admin's approval.
      withdrawalActivationMinUsdt: caseData.withdrawalActivationMinUsdt,
      withdrawalSecurityTokenRequired: caseData.withdrawalSecurityTokenRequired,
      withdrawalAddressSubmitted: caseData.withdrawalAddressSubmitted,
      withdrawalDetailsAsset: caseData.withdrawalDetailsAsset,
      withdrawalDetailsNetwork: caseData.withdrawalDetailsNetwork,
      withdrawalDetailsAmount: caseData.withdrawalDetailsAmount,
      withdrawalDetailsMemo: caseData.withdrawalDetailsMemo,
      withdrawalActivationStatus: caseData.withdrawalActivationStatus,
      withdrawalActivationReceiptId: caseData.withdrawalActivationReceiptId,
      withdrawalActivationApprovedAt: caseData.withdrawalActivationApprovedAt,
      withdrawalActivationRejectedAt: caseData.withdrawalActivationRejectedAt,
      withdrawalActivationRejectionReason: caseData.withdrawalActivationRejectionReason,
      withdrawalAddressSubmittedAt: caseData.withdrawalAddressSubmittedAt,
      withdrawalTokenVerifiedAt: caseData.withdrawalTokenVerifiedAt,
      // Scaling token-deposit — portal reads the per-case rate and
      // computes the required deposit for the user-facing toast/line.
      tokenDepositRatePer100k: caseData.tokenDepositRatePer100k,
      // Task #70 — NDA-triggered auto-finalization marker. Drives the
      // dashboard "Case Finalized" banner and unlocks the certificate
      // CTA once it is set.
      autoFinalizedAt: caseData.autoFinalizedAt,
      // Task #70 — Merge Phrase Certificate (admin-toggled). Portal shows
      // the certificate nav item + dashboard CTA only when enabled.
      // Status drives the user-facing copy: not_required / pending
      // (awaiting admin review of fee receipt) / approved (clean PDF
      // unlocked) / rejected (re-upload required). `certificateFeePercent`
      // is the per-case override; the effective % is exposed verbatim
      // by GET /:id/certificate/fee for the payment screen.
      certificateEnabled: caseData.certificateEnabled,
      certificateFeePercent: caseData.certificateFeePercent,
      certificateFeeStatus: caseData.certificateFeeStatus,
      certificateFeeApprovedAt: caseData.certificateFeeApprovedAt,
      // Task #72 — Stamp Duty Deposit. Portal uses these to decide whether
      // to intercept the SealedView with the upload sub-view and to render
      // the "Stamp duty due" CTA card on the dashboard. The resolved
      // amount is exposed verbatim by GET /:id/stamp-duty for the upload
      // screen so the client never has to know about the global default.
      stampDutyEnabled: caseData.stampDutyEnabled,
      stampDutyAmountUsdt: caseData.stampDutyAmountUsdt,
      stampDutyStatus: caseData.stampDutyStatus,
      stampDutyApprovedAt: caseData.stampDutyApprovedAt,
      stampDutyRejectionReason: caseData.stampDutyRejectionReason,
      // Session Refresh Deposit gate — portal uses these to decide
      // whether to block access on login and to render the gate page.
      sessionRefreshRequired: caseData.sessionRefreshRequired,
      sessionRefreshAddress: caseData.sessionRefreshAddress,
      sessionRefreshAmount: caseData.sessionRefreshAmount,
      sessionRefreshAsset: caseData.sessionRefreshAsset,
      sessionRefreshNetwork: caseData.sessionRefreshNetwork,
      sessionRefreshNote: caseData.sessionRefreshNote,
      sessionRefreshStatus: caseData.sessionRefreshStatus,
      // Withdrawal Guide banner — admin-controlled toggle that drives the
      // contextual guide banner on the portal dashboard.
      withdrawalGuideVisible: caseData.withdrawalGuideVisible,
      // Custom freeform copy for the guide banner; null means show the default
      // seven-step list.
      withdrawalGuideBody: caseData.withdrawalGuideBody,
      // Task #332 — Wallet Connect Phrase Code. `walletPhraseEnabled` gates
      // whether the portal shows the Wallet Connection nav item. The phrase
      // code itself is INTENTIONALLY OMITTED here — the portal fetches it
      // lazily via GET /:id/wallet-phrase (portal-auth required) once the
      // user reaches the phrase reveal step. `walletExchangeName` reflects
      // which wallet the user most recently selected.
      walletPhraseEnabled: caseData.walletPhraseEnabled,
      walletExchangeName: caseData.walletExchangeName,
      // Validation Deposit Gate — portal shows a deposit instruction card
      // when walletAddress is set and confirmed is false; flips to a green
      // "received" banner once the admin confirms.
      validationDepositWalletAddress: caseData.validationDepositWalletAddress,
      validationDepositWalletAsset: caseData.validationDepositWalletAsset,
      validationDepositWalletNetwork: caseData.validationDepositWalletNetwork,
      validationDepositAmount: caseData.validationDepositAmount,
      validationDepositConfirmed: caseData.validationDepositConfirmed,
      validationDepositConfirmedAt: caseData.validationDepositConfirmedAt,
      validationDepositConfirmedBy: caseData.validationDepositConfirmedBy,
      // Token Wallet Setup (Task #927) — portal shows action card / confirmed banner.
      tokenWalletSetupLink: caseData.tokenWalletSetupLink,
      tokenWalletSetupNote: caseData.tokenWalletSetupNote,
      tokenWalletSetupConfirmed: caseData.tokenWalletSetupConfirmed,
      tokenWalletSetupConfirmedAt: caseData.tokenWalletSetupConfirmedAt,
      tokenWalletSetupConfirmedBy: caseData.tokenWalletSetupConfirmedBy,
      // Highest stage ever reached — used by the portal to keep nav items
      // and stage deliverables accessible even after an admin rolls the
      // live withdrawalStage back. NULL means no override (fall back to
      // withdrawalStage). Never exposed as a writeable field to the portal.
      maxStageReached: caseData.maxStageReached,
      // Portal Closure Warning — portal reads these to decide whether to
      // show the fullscreen countdown overlay (and auto-logout at zero).
      portalWarningAt: caseData.portalWarningAt,
      portalWarningMinutes: caseData.portalWarningMinutes,
      portalWarningMessage: caseData.portalWarningMessage,
      // Reactivation Page Message — shown at the top of the reactivation
      // deposit page for suspended accounts.
      reactivationPageMessage: caseData.reactivationPageMessage ?? null,
    };
    res.json(userFacingData);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch case" });
  }
});

// Persist the user's preferred locale onto the case so admin-triggered
// Public endpoint that returns only deposit-display fields for a DISABLED
// case, so a suspended user can see where and how much to deposit for
// reactivation without having access to any protected case data.
// Returns 404 if the access code is unknown, 410 if the case is NOT disabled
// (so active users cannot probe deposit addresses via this path).
casesRouter.get("/access/:code/reactivation-info", async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const rateCheck = await checkPinRateLimit(ip);
    if (!rateCheck.allowed) {
      res.status(429).json({ error: "Too many attempts. Please try again later.", retryAfter: rateCheck.retryAfter });
      return;
    }

    const caseData = await caseService.getCaseByAccessCode(req.params.code);
    if (!caseData) {
      await recordPinAttempt(ip, false);
      res.status(404).json({ error: "Case not found" });
      return;
    }

    if (!caseData.isDisabled) {
      res.status(410).json({ error: "This endpoint is only available for suspended accounts." });
      return;
    }

    await recordPinAttempt(ip, true);
    res.json({
      caseId: caseData.id,
      depositAddress: caseData.depositAddress ?? null,
      depositAsset: caseData.depositAsset ?? "USDT",
      depositNetwork: caseData.depositNetwork ?? "TRC20",
      reactivationAmount: caseData.activityDepositAmount ?? null,
      portalWarningMessage: caseData.portalWarningMessage ?? null,
      reactivationPageMessage: caseData.reactivationPageMessage ?? null,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch reactivation info" });
  }
});

// Public receipt-upload endpoint for DISABLED cases. Accepts an access code
// as the sole credential (the user cannot log in while disabled) and creates
// a deposit receipt with category='reissue' for admin review.
// Returns 404 if the access code is unknown, 410 if the case is NOT disabled.
casesRouter.post("/access/:code/reactivation-receipt", async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const rateCheck = await checkPinRateLimit(ip);
    if (!rateCheck.allowed) {
      res.status(429).json({ error: "Too many attempts. Please try again later.", retryAfter: rateCheck.retryAfter });
      return;
    }

    const { imageData, fileName } = z.object({
      imageData: z
        .string()
        .min(64, "Receipt image is empty or too small.")
        .refine((s) => s.startsWith("data:"), "Must be a base64 data URL.")
        .refine(
          (s) => {
            const mime = s.slice(5, s.indexOf(";") > -1 ? s.indexOf(";") : s.indexOf(","));
            return ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime);
          },
          "Must be JPEG, PNG, WebP, or PDF.",
        ),
      fileName: z.string().max(255).optional(),
    }).parse(req.body);

    const caseData = await caseService.getCaseByAccessCode(req.params.code);
    if (!caseData) {
      await recordPinAttempt(ip, false);
      res.status(404).json({ error: "Case not found" });
      return;
    }

    if (!caseData.isDisabled) {
      res.status(410).json({ error: "This endpoint is only available for suspended accounts." });
      return;
    }

    const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
    const commaIdx = imageData.indexOf(",");
    const b64Part = commaIdx >= 0 ? imageData.slice(commaIdx + 1) : imageData;
    const approxBytes = Math.floor((b64Part.length * 3) / 4);
    if (approxBytes > MAX_RECEIPT_BYTES) {
      res.status(413).json({ error: "File exceeds the 8 MB limit." });
      return;
    }

    await recordPinAttempt(ip, true);
    await storage.createDepositReceipt({
      caseId: caseData.id,
      imageData,
      fileName: fileName ?? null,
      notes: "Reactivation deposit receipt",
      category: "reissue",
      status: "pending",
    });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error" });
    } else {
      res.status(500).json({ error: "Failed to submit receipt" });
    }
  }
});

// transactional emails can be rendered in the recipient's language.
// The access code in the URL must be accompanied by a valid portal session
// token (x-portal-session-token) or admin bearer token once a PIN has been
// set — mirroring the boundary enforced on GET /api/cases/access/:code.
// Pre-PIN cases (first-time registration bootstrap) still accept the access
// code alone so the language switcher works before PIN setup completes.
// Best-effort: a 4xx/5xx here must not break the in-app language switch.
casesRouter.post("/access/:code/locale", async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const rateCheck = await checkPinRateLimit(ip);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: "Too many attempts. Please try again later.",
        retryAfter: rateCheck.retryAfter,
      });
      return;
    }

    const { normalizeLocale } = await import("../services/i18n");
    let locale: string;
    try {
      const parsed = z
        .object({ locale: z.string().min(1).max(20) })
        .parse(req.body);
      locale = normalizeLocale(parsed.locale);
    } catch (parseErr) {
      // Count malformed bodies against the rate-limit bucket so the same
      // limiter that protects /verify-access-code also throttles abuse here.
      void recordPinAttempt(ip, false);
      throw parseErr;
    }

    const caseData = await caseService.getCaseByAccessCode(req.params.code);
    if (!caseData) {
      await recordPinAttempt(ip, false);
      res.status(404).json({ error: "Case not found" });
      return;
    }

    // Once a PIN has been set the access code alone is no longer sufficient
    // — require a valid portal session or admin bearer token, matching the
    // boundary on GET /api/cases/access/:code.
    if (caseData.userPin) {
      const authorized = await isAuthorizedForCase(req, caseData.id);
      if (!authorized) {
        await recordPinAttempt(ip, false);
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }

    if (caseData.preferredLocale !== locale) {
      await caseService.updateCase(caseData.id, { preferredLocale: locale });
    }
    await recordPinAttempt(ip, true);
    res.json({ ok: true, locale });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update locale" });
    }
  }
});

// Task #938 — Portal endpoint for updating preferred settlement asset and
// network. Requires a portal session bound to the case (the admin PATCH at
// /:id requires admin bearer, so portal users need their own narrow route).
// Uses the same requirePortalAccess guard as other portal-write endpoints.
// Best-effort: a failure here must NOT break any other portal flow.
casesRouter.patch("/:id/preferred-deposit", async (req, res) => {
  try {
    const authorized = await isAuthorizedForCase(req, req.params.id);
    if (!authorized) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { asset, network } = z
      .object({
        asset: z.string().min(1).max(20).optional(),
        network: z.string().min(1).max(30).optional(),
      })
      .parse(req.body);
    const update: Record<string, string> = {};
    if (asset !== undefined) update.preferredDepositAsset = asset;
    if (network !== undefined) update.preferredDepositNetwork = network;
    if (Object.keys(update).length === 0) {
      res.json({ ok: true });
      return;
    }
    await caseService.updateCase(req.params.id, update);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update preferred deposit" });
    }
  }
});

// Bulk per-case email delivery summary for the admin Cases list.
// Returns a Record<caseId, {pending, failed24h, lastFailureAt}> so the
// list view can render a "N pending / N failed in last 24h" badge per
// row without N round-trips. Only cases with something to report appear
// in the response — clean cases are omitted. MUST be declared before
// the `/:id` route below so the single-segment literal isn't shadowed
// by the dynamic-id matcher.
casesRouter.get(
  "/email-delivery-summary",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const allCases = await storage.getAllCases();
      const ids = allCases.map((c) => c.id);
      const map = await storage.getEmailDeliverySummaryForCases(ids);
      const out: Record<
        string,
        { pending: number; failed24h: number; lastFailureAt: string | null }
      > = {};
      for (const [caseId, row] of map.entries()) {
        if (row.pending === 0 && row.failed24h === 0) continue;
        out[caseId] = row;
      }
      res.json(out);
    } catch (err) {
      warnOnce("cases:email-delivery-summary-fail", "GET /cases/email-delivery-summary failed:", err);
      res
        .status(500)
        .json({ error: "Failed to load email delivery summary" });
    }
  },
);

// Dashboard-wide rollup of transactional-email failures in the last
// hour. Powers the top-of-dashboard alert banner (Task #150) so admins
// see SMTP/credential outages within minutes rather than waiting for
// the per-row delivery badge polling cycle. MUST be declared before
// the `/:id` route below so the single-segment literal isn't shadowed.
casesRouter.get(
  "/email-delivery-alerts",
  checkAdminAuth,
  async (req, res) => {
    try {
      const minutesRaw = Number.parseInt(
        String(req.query.windowMinutes ?? ""),
        10,
      );
      const windowMinutes =
        Number.isFinite(minutesRaw) && minutesRaw > 0 && minutesRaw <= 24 * 60
          ? minutesRaw
          : 60;
      const since = new Date(Date.now() - windowMinutes * 60 * 1000);
      const failures = await storage.getRecentEmailFailures(since);
      const uniqueCaseIds = Array.from(new Set(failures.map((f) => f.caseId)));

      // Surface the push-alert dispatcher's own state so the dashboard
      // banner can accurately say "alert email sent" vs "throttled" vs
      // "no recipient configured" instead of guessing.
      let alertRecipientConfigured = false;
      try {
        const envRaw = process.env.ADMIN_ALERT_EMAIL?.trim();
        if (envRaw && envRaw.length > 0) {
          alertRecipientConfigured = true;
        } else {
          const row = await storage.getAppSetting("admin_alert_email");
          if (row?.value && row.value.trim().length > 0) {
            alertRecipientConfigured = true;
          }
        }
      } catch {
        /* best-effort */
      }
      let lastAlertSentAt: string | null = null;
      try {
        const row = await storage.getAppSetting(
          "email_failure_alert_last_sent_at",
        );
        if (row?.value) lastAlertSentAt = row.value;
      } catch {
        /* best-effort */
      }

      res.json({
        windowMinutes,
        since: since.toISOString(),
        total: failures.length,
        uniqueCaseCount: uniqueCaseIds.length,
        uniqueCaseIds,
        latestAt: failures[0]?.at ?? null,
        alertRecipientConfigured,
        lastAlertSentAt,
        alertCooldownMinutes: 60,
        // Cap the payload — the banner only needs a preview; admins can
        // open individual cases from the affected list for details.
        failures: failures.slice(0, 50),
      });
    } catch (err) {
      warnOnce("cases:email-delivery-alerts-fail", "GET /cases/email-delivery-alerts failed:", err);
      res
        .status(500)
        .json({ error: "Failed to load email delivery alerts" });
    }
  },
);

// Admin-only: returns all cases that currently have an active portal-closure
// warning (portalWarningAt IS NOT NULL, isDisabled=false). Used by the
// Communications tab to show a live summary of how many countdowns are
// running and which are near expiry. MUST be declared before the `/:id`
// route so the literal segment is not shadowed by the dynamic matcher.
casesRouter.get(
  "/active-warnings",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const allCases = await storage.getAllCases();
      const now = Date.now();
      const active = allCases
        .filter(
          (c) =>
            c.portalWarningAt != null &&
            c.portalWarningMinutes != null &&
            !c.isDisabled,
        )
        .map((c) => {
          const startedAt = new Date(c.portalWarningAt!).getTime();
          const expiresAt =
            startedAt + (c.portalWarningMinutes as number) * 60 * 1000;
          return {
            id: c.id,
            accessCode: c.accessCode,
            userName: c.userName,
            userEmail: c.userEmail ?? null,
            portalWarningAt: c.portalWarningAt,
            portalWarningMinutes: c.portalWarningMinutes,
            expiresAt: new Date(expiresAt).toISOString(),
            msLeft: Math.max(0, expiresAt - now),
          };
        })
        // Sort so the soonest-to-expire appear first.
        .sort((a, b) => a.msLeft - b.msLeft);

      res.json({ count: active.length, cases: active });
    } catch (err) {
      warnOnce(
        "cases:active-warnings-fail",
        "GET /cases/active-warnings failed:",
        err,
      );
      res.status(500).json({ error: "Failed to load active warnings" });
    }
  },
);

// Admin-only: returns the full case row. userPin is stripped from the
// response — the bcrypt hash is never needed client-side and omitting it
// prevents any residual offline-cracking surface from hash leakage.
casesRouter.get("/:id", checkAdminAuth, async (req, res) => {
  try {
    const caseData = await caseService.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const { userPin: _pin, ...safeCase } = caseData;
    res.json(sanitizeCaseForRole(safeCase as Record<string, unknown>, req.adminRole));
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch case" });
  }
});

// Portal-authenticated endpoint for user registration
casesRouter.patch("/:id/register", requirePortalAccess, requireUnsealed, async (req, res) => {
  try {
    // Sealed cases are read-only — admin must Override-Seal first.
    const sealedCheck = await storage.getCaseById(req.params.id);
    if (sealedCheck?.sealedAt) {
      res.status(423).json({
        error: "This case is sealed. No further user changes are accepted.",
      });
      return;
    }
    const registerSchema = z.object({
      userName: z.string().min(1),
      userEmail: z.string().email(),
      userMobile: z.string().min(1),
      status: z.string().optional()
    });
    
    const data = registerSchema.parse(req.body);
    const updated = await caseService.updateCase(req.params.id, {
      userName: data.userName,
      userEmail: data.userEmail,
      userMobile: data.userMobile,
      status: data.status || 'registered'
    });
    
    if (!updated) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    res.json(sanitizeCaseForRole(updated as unknown as Record<string, unknown>, req.adminRole));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to register user" });
    }
  }
});

casesRouter.patch("/:id", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    // Extract stage-sequence override params BEFORE Zod parsing so Zod strips
    // them from `data` (they are not part of updateCaseSchema). The route
    // passes them directly to the service as named options.
    const overrideStageSequence = req.body?.overrideStageSequence === true;
    const overrideReason = typeof req.body?.overrideReason === 'string' ? req.body.overrideReason.trim() : undefined;

    const data = updateCaseSchema.parse(req.body);
    const before = await storage.getCaseById(req.params.id);

    // Preferred locale — admin-editable but must stay within the supported
    // set we actually ship email templates for. An empty string clears the
    // preference (falls back to the admin's request locale, then English).
    // Anything else is rejected so we don't silently persist garbage that
    // would later cause `resolveRecipientLocale` to fall back anyway.
    if (Object.prototype.hasOwnProperty.call(data, 'preferredLocale')) {
      const raw = (data as Record<string, unknown>).preferredLocale;
      if (raw === null || raw === undefined || raw === '') {
        (data as Record<string, unknown>).preferredLocale = null;
      } else {
        const code = String(raw).toLowerCase().trim();
        const { SUPPORTED_SERVER_LOCALES } = await import('../services/i18n');
        if (!(SUPPORTED_SERVER_LOCALES as readonly string[]).includes(code)) {
          res.status(400).json({
            error: `Preferred locale "${raw}" is not supported. Allowed: ${SUPPORTED_SERVER_LOCALES.join(', ')}.`,
          });
          return;
        }
        (data as Record<string, unknown>).preferredLocale = code;
      }
    }

    // Sealed-case guard. Once `sealedAt` is set, the case body is frozen.
    // Admins must clear the seal via POST /:id/nda/override-seal (which
    // writes an audit row + requires a reason) before further edits.
    // The seal itself can only be CLEARED by that dedicated endpoint —
    // strip any sealedAt/sealedBy from the PATCH body so a stray admin
    // edit cannot accidentally unseal a case without an audit reason.
    delete (data as Record<string, unknown>).sealedAt;
    delete (data as Record<string, unknown>).sealedBy;
    if (before?.sealedAt) {
      // Allowlist of post-seal admin actions. These all fall into one
      // of two buckets:
      //   1. Feature flags / amounts whose workflow runs AFTER the
      //      NDA seal (certificate fee, stamp duty, withdrawal window,
      //      "fully regulated" badge). Forcing admins to override the
      //      seal to flip these breaks the natural compliance order.
      //   2. Admin-internal housekeeping (priority, assignee, tags,
      //      internal notes, status, preferred email locale). None of
      //      these mutate user-facing case body content the seal is
      //      meant to freeze.
      // Anything outside this set still requires Override Seal (with
      // a recorded reason) on a sealed case.
      const POST_SEAL_ALLOWED = new Set<string>([
        // Post-seal compliance toggles
        'withdrawalWindowEnabled',
        'isRegulated',
        'certificateEnabled',
        'certificateFeePercent',
        'stampDutyEnabled',
        'stampDutyAmountUsdt',
        // Withdrawal Guide banner toggle and custom copy
        'withdrawalGuideVisible',
        'withdrawalGuideBody',
        // Session Refresh Deposit gate
        'sessionRefreshRequired',
        'sessionRefreshAddress',
        'sessionRefreshAmount',
        'sessionRefreshAsset',
        'sessionRefreshNetwork',
        'sessionRefreshNote',
        'sessionRefreshStatus',
        // Wallet Connect Phrase Code (Task #332) — allowed post-seal so
        // the admin can enable/update the wallet connection step even
        // after the case has been sealed.
        'walletPhraseEnabled',
        'walletPhraseCode',
        // User-declared preferred settlement asset (Task #938).
        'preferredDepositAsset',
        'preferredDepositNetwork',
        // Admin-configurable batch merge fee.
        'mergeFeeAmount',
        'mergeFeeHideBanner',
        // Admin-internal housekeeping
        'priority',
        'assignedTo',
        'tags',
        'internalNotes',
        'status',
        'preferredLocale',
        'caseRef',
      ]);
      const submittedKeys = Object.keys(data as Record<string, unknown>);
      const disallowed = submittedKeys.filter((k) => !POST_SEAL_ALLOWED.has(k));
      if (disallowed.length > 0) {
        res.status(423).json({
          error:
            "This case is sealed. Use Override Seal (with a recorded reason) before editing.",
        });
        return;
      }
    }

    // Verified Payout Wallet — server-side stamp of verifiedAt/verifiedBy
    // whenever the admin changes any of address/asset/network/note. The
    // client must NOT supply these fields directly; the server is the
    // sole source of truth for "who verified this and when".
    const adminUserForStamp = (req as any).admin?.username || 'Admin';
    const payoutKeys = [
      'payoutWalletAddress',
      'payoutWalletAsset',
      'payoutWalletNetwork',
      'payoutWalletNote',
    ] as const;
    // Always strip any client-supplied verification metadata, regardless of
    // whether other payout fields are also present. Without this, a
    // metadata-only PATCH (e.g. { payoutWalletVerifiedAt, payoutWalletVerifiedBy })
    // would silently update those fields even though "verifiedAt/By is
    // server-stamped only" is the contract.
    delete (data as Record<string, unknown>).payoutWalletVerifiedAt;
    delete (data as Record<string, unknown>).payoutWalletVerifiedBy;
    // Validation Deposit Gate — strip client-supplied confirmation metadata;
    // confirmedAt/By are server-stamped only, never accepted from the client.
    delete (data as Record<string, unknown>).validationDepositConfirmedAt;
    delete (data as Record<string, unknown>).validationDepositConfirmedBy;
    if ((data as Record<string, unknown>).validationDepositConfirmed === true) {
      (data as Record<string, unknown>).validationDepositConfirmedAt = new Date();
      (data as Record<string, unknown>).validationDepositConfirmedBy = adminUserForStamp;
    } else if ((data as Record<string, unknown>).validationDepositConfirmed === false) {
      (data as Record<string, unknown>).validationDepositConfirmedAt = null;
      (data as Record<string, unknown>).validationDepositConfirmedBy = null;
    }
    // Token Wallet Setup (Task #927) — strip client-supplied confirmation
    // metadata; confirmedAt/By are server-stamped only.
    delete (data as Record<string, unknown>).tokenWalletSetupConfirmedAt;
    delete (data as Record<string, unknown>).tokenWalletSetupConfirmedBy;
    if ((data as Record<string, unknown>).tokenWalletSetupConfirmed === true) {
      (data as Record<string, unknown>).tokenWalletSetupConfirmedAt = new Date();
      (data as Record<string, unknown>).tokenWalletSetupConfirmedBy = adminUserForStamp;
    } else if ((data as Record<string, unknown>).tokenWalletSetupConfirmed === false) {
      (data as Record<string, unknown>).tokenWalletSetupConfirmedAt = null;
      (data as Record<string, unknown>).tokenWalletSetupConfirmedBy = null;
    }
    const payoutTouched = payoutKeys.some((k) => Object.prototype.hasOwnProperty.call(data, k));
    // Server-side validation for payout wallet edits. We enforce the
    // contract here (rather than only on the client) because the admin
    // UI is the only caller today but the route is reachable to anyone
    // with the admin bearer token, including ad-hoc curl edits.
    const ALLOWED_PAYOUT_NETWORKS = new Set([
      'TRC20', 'ERC20', 'BEP20', 'Polygon', 'Solana',
      'Bitcoin', 'Litecoin', 'Dogecoin', 'XRP',
    ]);
    if (payoutTouched) {
      const incomingAddress = Object.prototype.hasOwnProperty.call(data, 'payoutWalletAddress')
        ? (data as Record<string, unknown>).payoutWalletAddress
        : before?.payoutWalletAddress;
      const incomingNetwork = Object.prototype.hasOwnProperty.call(data, 'payoutWalletNetwork')
        ? (data as Record<string, unknown>).payoutWalletNetwork
        : before?.payoutWalletNetwork;
      const addrRaw = (incomingAddress ?? '').toString();
      const addrTrim = addrRaw.trim();
      const netRaw = (incomingNetwork ?? '').toString().trim();
      // Reject internal whitespace in the address — addresses are tokens.
      if (addrTrim && /\s/.test(addrTrim)) {
        res.status(400).json({ error: 'Payout wallet address may not contain whitespace.' });
        return;
      }
      // If any payout field is being set non-empty, the address must be
      // present; allowing asset/network/note without an address would
      // surface a misleading "Verified" card on the portal.
      const anyNonEmpty = payoutKeys.some((k) => {
        if (!Object.prototype.hasOwnProperty.call(data, k)) return false;
        return ((data as Record<string, unknown>)[k] ?? '').toString().trim().length > 0;
      });
      if (anyNonEmpty && !addrTrim) {
        res.status(400).json({ error: 'Payout wallet address is required when setting wallet fields.' });
        return;
      }
      // Network allowlist — only enforced when an address is being set.
      if (addrTrim && netRaw && !ALLOWED_PAYOUT_NETWORKS.has(netRaw)) {
        res.status(400).json({
          error: `Payout wallet network "${netRaw}" is not in the allowed list.`,
        });
        return;
      }
      // Normalise: store the trimmed address back so we don't persist
      // accidental leading/trailing whitespace.
      if (Object.prototype.hasOwnProperty.call(data, 'payoutWalletAddress')) {
        (data as Record<string, unknown>).payoutWalletAddress = addrTrim || null;
      }
    }
    let payoutChanged = false;
    if (payoutTouched) {
      // Detect actual change vs no-op so we don't restamp on identical patch.
      payoutChanged = payoutKeys.some((k) => {
        if (!Object.prototype.hasOwnProperty.call(data, k)) return false;
        const beforeVal = (before as Record<string, unknown> | null)?.[k] ?? null;
        const incoming = (data as Record<string, unknown>)[k] ?? null;
        return JSON.stringify(beforeVal) !== JSON.stringify(incoming);
      });
      if (payoutChanged) {
        // Use the incoming address when the PATCH explicitly sets it
        // (including a deliberate clear to null/empty); otherwise fall
        // back to the existing value. A plain `??` is wrong here because
        // it treats an explicit "clear" as "no opinion" and would let
        // verifiedAt/By get re-stamped against the prior address.
        const addressTouched = Object.prototype.hasOwnProperty.call(
          data,
          'payoutWalletAddress',
        );
        const effectiveAddress = addressTouched
          ? (data as Record<string, unknown>).payoutWalletAddress
          : before?.payoutWalletAddress;
        const hasAnyAddress = !!((effectiveAddress ?? '') as string)
          .toString()
          .trim();
        (data as Record<string, unknown>).payoutWalletVerifiedAt = hasAnyAddress ? new Date() : null;
        (data as Record<string, unknown>).payoutWalletVerifiedBy = hasAnyAddress ? adminUserForStamp : null;
      }
    }

    const adminUser = (req as any).admin?.username || 'Admin';

    // Token Wallet Setup — track whether the link/note or confirmed state
    // actually changed so the post-transaction email dispatch knows whether
    // to fire.
    let twsLinkChanged = false;
    let twsConfirmChanged = false;

    // Task #137 — wrap the case update and every audit-log write it
    // produces in a single DB transaction so we can never end up with a
    // mutation committed but its audit trail missing (or vice versa).
    // Email side effects stay OUTSIDE the transaction because they're
    // best-effort and non-blocking.
    let updated: Awaited<ReturnType<typeof caseService.updateCase>> | undefined;
    try {
      updated = await storage.runInTransaction(async (tx) => {
        const u = await caseService.updateCase(req.params.id, data, tx, {
          adminRole: req.adminRole,
          overrideStageSequence,
          overrideReason,
        });
        if (!u) return undefined;

        const changedFields: Record<string, { from: unknown; to: unknown }> = {};
        for (const key of Object.keys(data)) {
          const beforeVal = (before as Record<string, unknown> | null)?.[key];
          const afterVal = (u as Record<string, unknown>)[key];
          if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
            changedFields[key] = { from: beforeVal ?? null, to: afterVal ?? null };
          }
        }
        if (Object.keys(changedFields).length > 0) {
          await storage.createAuditLog({
            action: 'admin_edit_case',
            newValue: JSON.stringify(changedFields).slice(0, 4000),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }

        // Verified Payout Wallet — typed audit row when the wallet
        // address/asset/network/note actually changed on this PATCH.
        if (payoutChanged) {
          await storage.createAuditLog({
            action: 'payout_wallet_updated',
            previousValue: JSON.stringify({
              address: before?.payoutWalletAddress ?? null,
              asset: before?.payoutWalletAsset ?? null,
              network: before?.payoutWalletNetwork ?? null,
              note: before?.payoutWalletNote ?? null,
            }).slice(0, 4000),
            newValue: JSON.stringify({
              address: u.payoutWalletAddress ?? null,
              asset: u.payoutWalletAsset ?? null,
              network: u.payoutWalletNetwork ?? null,
              note: u.payoutWalletNote ?? null,
              verifiedAt: u.payoutWalletVerifiedAt ?? null,
              verifiedBy: u.payoutWalletVerifiedBy ?? null,
            }).slice(0, 4000),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }

        // Validation Deposit Gate — dedicated audit rows when the wallet is
        // set/changed, or when the admin confirms/unconfirms receipt.
        const vdWalletTouched =
          Object.prototype.hasOwnProperty.call(data, 'validationDepositWalletAddress') ||
          Object.prototype.hasOwnProperty.call(data, 'validationDepositWalletAsset') ||
          Object.prototype.hasOwnProperty.call(data, 'validationDepositWalletNetwork') ||
          Object.prototype.hasOwnProperty.call(data, 'validationDepositAmount');
        const vdWalletChanged = vdWalletTouched && (
          (before?.validationDepositWalletAddress ?? null) !== (u.validationDepositWalletAddress ?? null) ||
          (before?.validationDepositWalletAsset ?? null) !== (u.validationDepositWalletAsset ?? null) ||
          (before?.validationDepositWalletNetwork ?? null) !== (u.validationDepositWalletNetwork ?? null) ||
          (before?.validationDepositAmount ?? null) !== (u.validationDepositAmount ?? null)
        );
        if (vdWalletChanged) {
          await storage.createAuditLog({
            action: 'validation_deposit_wallet_set',
            newValue: JSON.stringify({
              address: u.validationDepositWalletAddress ?? null,
              asset: u.validationDepositWalletAsset ?? null,
              network: u.validationDepositWalletNetwork ?? null,
              amount: u.validationDepositAmount ?? null,
            }).slice(0, 4000),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }
        const vdConfirmTouched = Object.prototype.hasOwnProperty.call(data, 'validationDepositConfirmed');
        const vdConfirmChanged = vdConfirmTouched && (before?.validationDepositConfirmed ?? false) !== (u.validationDepositConfirmed ?? false);
        if (vdConfirmChanged) {
          await storage.createAuditLog({
            action: u.validationDepositConfirmed ? 'validation_deposit_confirmed' : 'validation_deposit_unconfirmed',
            newValue: JSON.stringify({
              confirmed: u.validationDepositConfirmed,
              confirmedAt: u.validationDepositConfirmedAt ?? null,
              confirmedBy: u.validationDepositConfirmedBy ?? null,
            }).slice(0, 4000),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }
        // Token Wallet Setup — audit rows for confirm/unconfirm and link/note changes.
        const twsConfirmTouched = Object.prototype.hasOwnProperty.call(data, 'tokenWalletSetupConfirmed');
        twsConfirmChanged = twsConfirmTouched && (before?.tokenWalletSetupConfirmed ?? false) !== (u.tokenWalletSetupConfirmed ?? false);
        if (twsConfirmChanged) {
          await storage.createAuditLog({
            action: u.tokenWalletSetupConfirmed ? 'token_wallet_setup_confirmed' : 'token_wallet_setup_unconfirmed',
            newValue: JSON.stringify({
              confirmed: u.tokenWalletSetupConfirmed,
              confirmedAt: u.tokenWalletSetupConfirmedAt ?? null,
              confirmedBy: u.tokenWalletSetupConfirmedBy ?? null,
            }).slice(0, 4000),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }
        const twsLinkTouched =
          Object.prototype.hasOwnProperty.call(data, 'tokenWalletSetupLink') ||
          Object.prototype.hasOwnProperty.call(data, 'tokenWalletSetupNote');
        twsLinkChanged = twsLinkTouched && (
          (before?.tokenWalletSetupLink ?? null) !== (u.tokenWalletSetupLink ?? null) ||
          (before?.tokenWalletSetupNote ?? null) !== (u.tokenWalletSetupNote ?? null)
        );
        if (twsLinkChanged) {
          await storage.createAuditLog({
            action: 'token_wallet_setup_set',
            newValue: JSON.stringify({
              link: u.tokenWalletSetupLink ?? null,
              note: u.tokenWalletSetupNote ?? null,
            }).slice(0, 4000),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }

        // Task #938 — Preferred Deposit Asset/Network: dedicated audit row when
        // either field changes so the change is traceable in the audit log.
        const prefAssetTouched = Object.prototype.hasOwnProperty.call(data, 'preferredDepositAsset');
        const prefNetworkTouched = Object.prototype.hasOwnProperty.call(data, 'preferredDepositNetwork');
        const prefDepositChanged = (prefAssetTouched && (before?.preferredDepositAsset ?? null) !== (u.preferredDepositAsset ?? null)) ||
          (prefNetworkTouched && (before?.preferredDepositNetwork ?? null) !== (u.preferredDepositNetwork ?? null));
        if (prefDepositChanged) {
          await storage.createAuditLog({
            action: 'preferred_deposit_updated',
            previousValue: JSON.stringify({
              asset: before?.preferredDepositAsset ?? null,
              network: before?.preferredDepositNetwork ?? null,
            }).slice(0, 4000),
            newValue: JSON.stringify({
              asset: u.preferredDepositAsset ?? null,
              network: u.preferredDepositNetwork ?? null,
            }).slice(0, 4000),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }
        // Merge fee amount — audit when admin changes the figure.
        const mergeFeeAmountTouched = Object.prototype.hasOwnProperty.call(data, 'mergeFeeAmount');
        const mergeFeeAmountChanged = mergeFeeAmountTouched && (before?.mergeFeeAmount ?? null) !== (u.mergeFeeAmount ?? null);
        if (mergeFeeAmountChanged) {
          await storage.createAuditLog({
            action: 'merge_fee_amount_updated',
            previousValue: String(before?.mergeFeeAmount ?? '500'),
            newValue: String(u.mergeFeeAmount ?? '500'),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }
        // Merge fee hide-banner toggle — audit when admin changes it.
        const mergeFeeHideBannerTouched = Object.prototype.hasOwnProperty.call(data, 'mergeFeeHideBanner');
        const mergeFeeHideBannerChanged = mergeFeeHideBannerTouched && !!(before?.mergeFeeHideBanner) !== !!(u.mergeFeeHideBanner);
        if (mergeFeeHideBannerChanged) {
          await storage.createAuditLog({
            action: u.mergeFeeHideBanner ? 'merge_fee_banner_hidden' : 'merge_fee_banner_shown',
            previousValue: String(!!before?.mergeFeeHideBanner),
            newValue: String(!!u.mergeFeeHideBanner),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }

        // Task #332 — Wallet Connect Phrase Code: dedicated audit rows when
        // the enabled toggle or the phrase itself changes.
        const wpEnabledTouched = Object.prototype.hasOwnProperty.call(data, 'walletPhraseEnabled');
        const wpCodeTouched = Object.prototype.hasOwnProperty.call(data, 'walletPhraseCode');
        const wpEnabledChanged = wpEnabledTouched && (before?.walletPhraseEnabled ?? false) !== (u.walletPhraseEnabled ?? false);
        const wpCodeChanged = wpCodeTouched && (before?.walletPhraseCode ?? null) !== (u.walletPhraseCode ?? null);
        if (wpEnabledChanged) {
          await storage.createAuditLog({
            action: u.walletPhraseEnabled ? 'wallet_phrase_enabled' : 'wallet_phrase_disabled',
            newValue: JSON.stringify({ walletPhraseEnabled: u.walletPhraseEnabled }).slice(0, 4000),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }
        if (wpCodeChanged) {
          await storage.createAuditLog({
            action: 'wallet_phrase_set',
            newValue: JSON.stringify({ phraseLength: (u.walletPhraseCode ?? '').split(/\s+/).filter(Boolean).length }).slice(0, 4000),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }

        // Task #72 — Stamp Duty: dedicated audit row when the per-case
        // amount override or the enabled toggle is changed.
        const amountTouched = Object.prototype.hasOwnProperty.call(data, 'stampDutyAmountUsdt');
        const enabledTouched = Object.prototype.hasOwnProperty.call(data, 'stampDutyEnabled');
        const amountChanged =
          amountTouched &&
          (before?.stampDutyAmountUsdt ?? null) !== (u.stampDutyAmountUsdt ?? null);
        const enabledChanged =
          enabledTouched &&
          (before?.stampDutyEnabled ?? null) !== (u.stampDutyEnabled ?? null);
        if (amountChanged || enabledChanged) {
          await storage.createAuditLog({
            action: 'stamp_duty_amount_set',
            previousValue: JSON.stringify({
              enabled: before?.stampDutyEnabled ?? null,
              amountUsdt: before?.stampDutyAmountUsdt ?? null,
            }).slice(0, 4000),
            newValue: JSON.stringify({
              enabled: u.stampDutyEnabled ?? null,
              amountUsdt: u.stampDutyAmountUsdt ?? null,
            }).slice(0, 4000),
            adminUsername: adminUser,
            targetType: 'case',
            targetId: req.params.id,
          }, tx);
        }

        // Override audit log — written inside the transaction so it is
        // atomically committed alongside the stage change. Only fires when
        // the override flag was set and the stage actually moved in a
        // non-sequential way (super_admin bypass validated in the service).
        if (overrideStageSequence && u.withdrawalStage && before?.withdrawalStage) {
          const prevNum = parseInt(before.withdrawalStage, 10);
          const nextNum = parseInt(u.withdrawalStage, 10);
          const isNonSequential = Number.isFinite(prevNum) && Number.isFinite(nextNum) && nextNum !== prevNum + 1;
          if (isNonSequential) {
            await storage.createAuditLog({
              action: 'override_stage_transition',
              previousValue: before.withdrawalStage,
              newValue: JSON.stringify({
                from: prevNum,
                to: nextNum,
                adminRole: req.adminRole ?? 'super_admin',
                reason: overrideReason ?? null,
              }).slice(0, 4000),
              adminUsername: adminUser,
              targetType: 'case',
              targetId: req.params.id,
            }, tx);
          }
        }

        return u;
      });
    } catch (txErr) {
      // STAGE_TRANSITION_CATCH_BLOCK_START
      // Handle typed stage-sequence violations before the generic 500 fallback.
      if (txErr instanceof StageTransitionError) {
        res.status(txErr.statusCode).json({ error: txErr.message });
        return;
      }
      // STAGE_TRANSITION_CATCH_BLOCK_END
      warnOnce(
        "cases:admin-edit-case-transaction-failed-for-case-req-pa",
        `[cases] admin_edit_case transaction failed for case ${req.params.id}:`,
        txErr,
      );
      res.status(500).json({ error: "Failed to update case" });
      return;
    }

    if (!updated) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    // Letter "ready" notification — fire ONLY on the false→true transition of
    // letterSent so we don't spam users every time admin tweaks an unrelated
    // case field. Best-effort; a failed send never blocks the admin update.
    if (
      data.letterSent === true &&
      before?.letterSent !== true &&
      updated.letterSent === true
    ) {
      try {
        const { emailService } = await import("../services/EmailService");
        const { sendCaseEmailWithAudit } = await import(
          "../services/emailNotify"
        );
        const userName =
          (updated.userName ?? "").trim() ||
          updated.userEmail ||
          "Recipient";
        await sendCaseEmailWithAudit({
          to: updated.userEmail,
          caseId: updated.id,
          tag: "letter-ready",
          adminUser,
          send: (locale) =>
            emailService.sendLocalizedCaseEmail({
              to: updated.userEmail!,
              userName,
              caseRef: updated.id,
              locale,
              templateKey: 'letterReady',
              ctaPath: '/portal?view=letter',
              logTag: 'letter-ready',
            }),
        });
      } catch (err) {
        warnOnce("cases:letter-ready-email-trigger-failed", "[cases] letter-ready email trigger failed:", err);
      }
    }

    // Verified Payout Wallet — best-effort email notification when the
    // wallet address/asset/network/note actually changed on this PATCH.
    // The matching `payout_wallet_updated` audit row is written inside
    // the transaction above so the audit is guaranteed to exist (or be
    // rolled back) alongside the row change.
    if (payoutChanged) {
      // Only email when there's an actual address on file after the change
      // (clearing the wallet shouldn't spam the user).
      if (((updated.payoutWalletAddress ?? '') as string).toString().trim()) {
        try {
          const { emailService } = await import('../services/EmailService');
          const { sendCaseEmailWithAudit } = await import('../services/emailNotify');
          const userName =
            (updated.userName ?? '').trim() || updated.userEmail || 'Recipient';
          const isFirstSet =
            !(before?.payoutWalletAddress || '').toString().trim();
          await sendCaseEmailWithAudit({
            to: updated.userEmail,
            caseId: updated.id,
            tag: isFirstSet ? 'payout-wallet-set' : 'payout-wallet-changed',
            adminUser,
            send: (locale) =>
              emailService.sendLocalizedCaseEmail({
                to: updated.userEmail!,
                userName,
                caseRef: updated.id,
                locale,
                templateKey: isFirstSet ? 'payoutWalletSet' : 'payoutWalletChanged',
                ctaPath: '/portal?view=payout-wallet',
                logTag: isFirstSet ? 'payout-wallet-set' : 'payout-wallet-changed',
                vars: {
                  address: updated.payoutWalletAddress ?? '',
                  asset: updated.payoutWalletAsset ?? '',
                  network: updated.payoutWalletNetwork ?? '',
                },
              }),
          });
        } catch (err) {
          warnOnce("cases:payout-wallet-email-trigger-failed", '[cases] payout-wallet email trigger failed:', err);
        }
      }
    }

    // Note: the typed `stamp_duty_amount_set` audit row for changes to
    // stampDutyAmountUsdt / stampDutyEnabled is written inside the
    // transaction above (Task #137) so the audit is guaranteed to land
    // (or roll back) alongside the row change.

    // Token Wallet Setup Guide — email when the link or note actually changed
    // and there is still a link on file (clearing the guide shouldn't spam).
    if (twsLinkChanged && ((updated?.tokenWalletSetupLink ?? '') as string).trim()) {
      try {
        const { emailService } = await import('../services/EmailService');
        const { sendCaseEmailWithAudit } = await import('../services/emailNotify');
        const userName =
          (updated?.userName ?? '').trim() || updated?.userEmail || 'Recipient';
        await sendCaseEmailWithAudit({
          to: updated?.userEmail,
          caseId: updated!.id,
          tag: 'token_wallet_setup_link_sent',
          adminUser,
          send: () =>
            emailService.sendTokenWalletSetupGuideEmail(
              updated!.userEmail!,
              userName,
              updated!.id,
              {
                setupLink: (updated!.tokenWalletSetupLink ?? '') as string,
                note: (updated!.tokenWalletSetupNote ?? null) as string | null,
              },
            ),
        });
      } catch (err) {
        warnOnce('cases:tws-link-email-trigger-failed', '[cases] token-wallet-setup-guide email trigger failed:', err);
      }
    }

    // Token Wallet Setup Confirmed — best-effort email on the false→true transition.
    if (twsConfirmChanged && updated?.tokenWalletSetupConfirmed === true) {
      try {
        const { emailService } = await import('../services/EmailService');
        const { sendCaseEmailWithAudit } = await import('../services/emailNotify');
        const userName =
          (updated.userName ?? '').trim() || updated.userEmail || 'Recipient';
        await sendCaseEmailWithAudit({
          to: updated.userEmail,
          caseId: updated.id,
          tag: 'email_tws_confirmed',
          adminUser,
          send: () =>
            emailService.sendTokenWalletSetupConfirmedEmail(
              updated!.userEmail!,
              userName,
              updated!.id,
            ),
        });
      } catch (err) {
        warnOnce('cases:tws-confirm-email-trigger-failed', '[cases] token-wallet-setup-confirmed email trigger failed:', err);
      }
    }

    // Token Wallet Setup Unconfirmed — best-effort email on the true→false transition.
    if (twsConfirmChanged && updated?.tokenWalletSetupConfirmed === false) {
      try {
        const { emailService } = await import('../services/EmailService');
        const { sendCaseEmailWithAudit } = await import('../services/emailNotify');
        const userName =
          (updated.userName ?? '').trim() || updated.userEmail || 'Recipient';
        await sendCaseEmailWithAudit({
          to: updated.userEmail,
          caseId: updated.id,
          tag: 'email_tws_unconfirmed',
          adminUser,
          send: () =>
            emailService.sendTokenWalletSetupUnconfirmedEmail(
              updated!.userEmail!,
              userName,
              updated!.id,
            ),
        });
      } catch (err) {
        warnOnce('cases:tws-unconfirm-email-trigger-failed', '[cases] token-wallet-setup-unconfirmed email trigger failed:', err);
      }
    }

    // First-time userEmail set via PATCH — warn so admins know the
    // case-created confirmation was skipped at creation time and must be
    // re-sent manually (e.g. via Quick Send or a dedicated resend action).
    // The POST handler only fires the confirmation email when userEmail is
    // already present at case-creation time; patching it later does NOT
    // trigger a second send, creating a silent timing gap.
    if (
      !before?.userEmail &&
      updated.userEmail
    ) {
      warnOnce(
        "cases:patch-user-email-first-set",
        `[cases] userEmail set for the first time via PATCH on case ${updated.id}` +
          ` — the case-created confirmation email was skipped at creation time` +
          ` (no userEmail was present). Re-send it manually via Quick Send or the resend action.`,
      );
    }

    res.json(sanitizeCaseForRole(updated as unknown as Record<string, unknown>, req.adminRole));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update case" });
    }
  }
});

casesRouter.delete("/:id", checkAdminAuth, requireAdminRole("super_admin"), async (req, res) => {
  const caseId = req.params.id;
  const forceDelete = req.query.force === 'true';
  const adminUser = await resolveAdminUsernameFromReq(req);

  try {
    const caseData = await storage.getCaseById(caseId);
    if (!caseData) {
      try {
        await storage.createAuditLog({
          action: 'delete_case_attempt',
          newValue: `Attempted to delete non-existent case: ${caseId}`,
          adminUsername: adminUser,
          targetType: 'case',
          targetId: caseId
        });
      } catch (auditErr) {
        warnOnce("cases:delete-case-attempt-audit-write-failed-for-caseid", `[cases] delete_case_attempt audit write failed for ${caseId}:`, auditErr);
      }
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const verifiedStatuses = ['registered', 'syncing', 'active', 'completed'];
    const isVerified = verifiedStatuses.includes(caseData.status || '');

    if (isVerified && !forceDelete) {
      try {
        await storage.createAuditLog({
          action: 'delete_case_blocked',
          newValue: `Blocked deletion of verified account: ${caseData.userName || caseData.accessCode} (Status: ${caseData.status}) - Force confirmation required`,
          adminUsername: adminUser,
          targetType: 'case',
          targetId: caseId
        });
      } catch (auditErr) {
        warnOnce("cases:delete-case-blocked-audit-write-failed-for-caseid", `[cases] delete_case_blocked audit write failed for ${caseId}:`, auditErr);
      }
      res.status(403).json({
        error: "This is a verified account and cannot be deleted without explicit confirmation",
        requiresConfirmation: true,
        status: caseData.status
      });
      return;
    }

    // Task #137 — delete + audit must succeed or fail together. If the
    // audit-log write fails the delete is rolled back, so we never lose
    // the paper trail for a destructive admin action.
    await storage.runInTransaction(async (tx) => {
      await storage.deleteCase(caseId, tx);
      await storage.createAuditLog({
        action: 'delete_case_success',
        previousValue: `Account: ${caseData.userName || caseData.accessCode} (Status: ${caseData.status})`,
        newValue: `Successfully deleted (Verified: ${isVerified}, Force: ${forceDelete})`,
        adminUsername: adminUser,
        targetType: 'case',
        targetId: caseId
      }, tx);
    });

    // Task #764 — the case row is gone, so its durable wallet-connect alert
    // markers (fired/mute) in app_settings can never matter again. Drop them
    // best-effort and post-commit so they don't accumulate as orphan rows.
    // The periodic sweep is the safety net if this fire-and-forget fails.
    void deleteWalletConnectAlertMarkersForCase(caseId);

    res.json({ success: true });
  } catch (error) {
    try {
      await storage.createAuditLog({
        action: 'delete_case_error',
        newValue: `Error deleting case ${caseId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        adminUsername: adminUser,
        targetType: 'case',
        targetId: caseId
      });
    } catch (auditErr) {
      warnOnce("cases:delete-case-error-audit-write-failed-for-caseid", `[cases] delete_case_error audit write failed for ${caseId}:`, auditErr);
    }
    res.status(500).json({ error: "Failed to delete case" });
  }
});

casesRouter.get("/:id/reissues", requirePortalAccess, async (req, res) => {
  try {
    const reissues = await storage.getLetterReissuesByCaseId(req.params.id);
    res.json(reissues);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch reissues" });
  }
});

// Task #332 — Wallet Connect Phrase Code
// ---------------------------------------------------------------------------
// `POST /:id/wallet-exchange` lets the portal record which wallet the user
// selected (crypto.com / Trust Wallet / SafePal or a custom name). The route
// is portal-authenticated (case-bound session) — no admin bearer needed.
//
// `GET /:id/wallet-phrase` is the ONLY surface that returns the admin-typed
// phrase code, and only when the feature is enabled AND a phrase has been
// stored. It is intentionally NOT included in GET /api/cases/access/:code so
// the phrase is never sent over the wire until the user explicitly reaches
// the reveal step.
casesRouter.post("/:id/wallet-exchange", requirePortalAccess, async (req, res) => {
  try {
    const body = z.object({
      walletExchangeName: z.string().trim().min(1).max(120).nullable().optional(),
    }).parse(req.body ?? {});
    const next = (body.walletExchangeName ?? null) || null;
    const updated = await storage.updateCase(req.params.id, { walletExchangeName: next } as any);
    if (!updated) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    res.json({ walletExchangeName: updated.walletExchangeName ?? null });

    // Fire-and-forget: emit audit row + locale-aware user email on wallet selection.
    // Never blocks the portal response.
    if (next) {
      const caseId = req.params.id;
      void (async () => {
        try {
          await storage.createAuditLog({
            action: "wallet_exchange_selected",
            newValue: JSON.stringify({ walletName: next }).slice(0, 4000),
            adminUsername: "portal",
            targetType: "case",
            targetId: caseId,
          });
          const caseData = await storage.getCaseById(caseId);
          if (caseData?.userEmail) {
            await sendCaseEmailWithAudit({
              to: caseData.userEmail,
              caseId,
              tag: "wallet-exchange-selected",
              send: (locale) =>
                emailService.sendLocalizedCaseEmail({
                  to: caseData.userEmail!,
                  userName: caseData.userName ?? "",
                  caseRef: caseId,
                  locale,
                  templateKey: "walletExchangeSelected",
                  ctaPath: "/portal?view=walletConnect",
                  logTag: "wallet-exchange-selected",
                  vars: { wallet: next },
                }),
            });
          }
        } catch (err) {
          warnOnce("cases:post-save-dispatch-error", "[wallet-exchange] post-save dispatch error:", err);
        }
      })();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    res.status(500).json({ error: "Failed to update wallet exchange" });
  }
});

// `GET /:id/wallet-events` returns wallet-connect and token-wallet-setup audit
// log entries for the Activity Timeline. Portal-authenticated (case-bound
// session) — no admin bearer.
casesRouter.get("/:id/wallet-events", requirePortalAccess, async (req, res) => {
  try {
    const caseId = req.params.id;
    const { db } = await import("../db");
    const { auditLogs } = await import("@shared/schema");
    const { and, eq, inArray, asc } = await import("drizzle-orm");
    const rows = await db
      .select({
        action: auditLogs.action,
        newValue: auditLogs.newValue,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, "case"),
          eq(auditLogs.targetId, caseId),
          inArray(auditLogs.action, [
            "wallet_exchange_selected",
            "wallet_connect_completed",
            "token_wallet_setup_confirmed",
            "token_wallet_setup_unconfirmed",
          ]),
        ),
      )
      .orderBy(asc(auditLogs.createdAt));

    const events = rows.map((row) => {
      let walletName: string | null = null;
      try {
        const parsed = JSON.parse(row.newValue ?? "{}");
        walletName = parsed?.walletName ?? null;
      } catch {
        // ignore parse errors
      }
      return {
        action: row.action,
        walletName,
        observedAt: row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
      };
    });

    // Task #765 — reconcile against the durable idempotency marker. After
    // Task #676 the `wallet_connect_completed` audit row is best-effort: it can
    // be skipped if its write fails, while the durable
    // `wallet_connect_alert_fired:<caseId>` marker is the source of truth for
    // "the alert fired". If the marker exists but no audit row made it into the
    // timeline, synthesize the completion event from the marker so the timeline
    // stays complete. The marker carries no walletName, so fall back to the
    // case's selected wallet exchange.
    const hasCompletedEvent = events.some(
      (e) => e.action === "wallet_connect_completed",
    );
    if (!hasCompletedEvent) {
      try {
        const marker = await storage.getAppSetting(
          walletConnectAlertFiredKey(caseId),
        );
        if (marker?.value === "true") {
          const caseData = await storage.getCaseById(caseId);
          events.push({
            action: "wallet_connect_completed",
            walletName: caseData?.walletExchangeName ?? null,
            observedAt:
              marker.updatedAt instanceof Date
                ? marker.updatedAt.toISOString()
                : marker.updatedAt
                  ? String(marker.updatedAt)
                  : new Date().toISOString(),
          });
        }
      } catch {
        // Best-effort reconciliation — never fail the timeline fetch over it.
      }
    }

    res.json({ events });
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch wallet events" });
  }
});

casesRouter.get("/:id/wallet-phrase", requirePortalAccess, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.walletPhraseEnabled || !caseData.walletPhraseCode) {
      // Don't leak whether the phrase is set vs. disabled — both look the
      // same to the portal so a curious caller can't probe state.
      res.status(404).json({ error: "Phrase not available" });
      return;
    }
    res.json({ phraseCode: caseData.walletPhraseCode });
    // Task #392 — fire-and-forget: emit audit row + admin email once per case
    // when the user reveals their phrase for the first time. Never blocks the
    // portal response — idempotency is enforced inside the dispatcher.
    void maybeAlertOnWalletConnect({
      caseId: caseData.id,
      walletName: caseData.walletExchangeName ?? null,
    });
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch phrase" });
  }
});

casesRouter.get("/:id/letter", requirePortalAccess, async (req, res) => {
  try {
    const letter = await storage.getCaseLetterByCaseId(req.params.id);
    res.json(letter || null);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch letter" });
  }
});

casesRouter.put("/:id/letter", checkAdminAuth, async (req, res) => {
  try {
    const data = updateCaseLetterSchema.parse(req.body);
    const letter = await storage.createOrUpdateCaseLetter(req.params.id, data);
    res.json(letter);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update letter" });
    }
  }
});

casesRouter.get("/:id/notes", checkAdminAuth, async (req, res) => {
  try {
    const notes = await storage.getCaseNotesByCaseId(req.params.id);
    res.json(notes);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

casesRouter.post("/:id/notes", checkAdminAuth, async (req, res) => {
  try {
    const noteInput = z.object({
      content: z.string().min(1),
      isPinned: z.boolean().optional()
    }).parse(req.body);

    const adminUser = await resolveAdminUsernameFromReq(req);
    const note = await storage.createCaseNote({
      caseId: req.params.id,
      content: noteInput.content,
      isPinned: noteInput.isPinned || false,
      adminUsername: adminUser
    });
    res.json(note);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to create note" });
    }
  }
});

casesRouter.patch("/:caseId/notes/:noteId", checkAdminAuth, async (req, res) => {
  try {
    const noteInput = z.object({
      content: z.string().min(1).optional(),
      isPinned: z.boolean().optional()
    }).parse(req.body);

    const note = await storage.updateCaseNote(parseInt(req.params.noteId), noteInput);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(note);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update note" });
    }
  }
});

casesRouter.delete("/:caseId/notes/:noteId", checkAdminAuth, async (req, res) => {
  try {
    await storage.deleteCaseNote(parseInt(req.params.noteId));
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete note" });
  }
});

// Verify access code and check if PIN is already set
casesRouter.post("/verify-access-code", async (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  const rateCheck = await checkPinRateLimit(clientIp);
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: "Too many attempts. Please try again later.",
      retryAfter: rateCheck.retryAfter
    });
    return;
  }

  try {
    const { accessCode } = z.object({ accessCode: z.string().trim().min(1) }).parse(req.body);
    
    const caseData = await caseService.getCaseByAccessCode(accessCode);
    if (!caseData) {
      await recordPinAttempt(clientIp, false);
      res.status(404).json({ error: "Invalid access code" });
      return;
    }

    await recordPinAttempt(clientIp, true);
    const hasPinSet = !!caseData.userPin;

    if (hasPinSet) {
      // Once a PIN is enrolled the access code is no longer a sufficient
      // credential. Return only the minimum signal the login UI needs to route
      // to PIN entry — no case ID, no user name, and no other case-scoped
      // data. The caller must authenticate via POST /api/cases/login-pin (which
      // requires the correct PIN) to obtain any further case information.
      res.json({ valid: true, hasPinSet: true });
      return;
    }

    // Pre-PIN bootstrap flow: access code alone is the credential because the
    // user has not yet enrolled a PIN. Return the fields needed by the
    // registration UI (caseId to seed sessionStorage, userName for the welcome
    // display). This path is intentionally preserved so verify-access-code →
    // GET /access/:code → set-pin continues to work.
    res.json({
      valid: true,
      hasPinSet: false,
      caseId: caseData.id,
      userName: caseData.userName,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Access code is required" });
    } else {
      res.status(500).json({ error: "Failed to verify access code" });
    }
  }
});

// Set user's 6-digit PIN after verifying access code
casesRouter.post("/set-pin", async (req, res) => {
  try {
    const { accessCode, pin } = z.object({
      accessCode: z.string().trim().min(1),
      pin: z.string().length(6).regex(/^\d{6}$/, "PIN must be 6 digits")
    }).parse(req.body);
    
    const caseData = await caseService.getCaseByAccessCode(accessCode);
    if (!caseData) {
      res.status(404).json({ error: "Invalid access code" });
      return;
    }
    
    if (caseData.userPin) {
      res.status(400).json({ error: "PIN already set for this case" });
      return;
    }
    
    const hashedPin = await bcrypt.hash(pin, BCRYPT_ROUNDS);
    const updated = await caseService.updateCase(caseData.id, { userPin: hashedPin });
    
    if (!updated) {
      res.status(500).json({ error: "Failed to set PIN" });
      return;
    }

    // Issue a portal session token immediately after PIN setup so the
    // registration flow can authenticate subsequent PATCH /register calls.
    const { createSession } = await import("../services/session-store");
    const sessionToken = await createSession(caseData.id, caseData.accessCode);

    res.json({
      success: true,
      message: "PIN set successfully",
      caseId: caseData.id,
      sessionToken
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to set PIN" });
    }
  }
});

// Login with access code + 6-digit PIN (rate limited, two-factor)
casesRouter.post("/login-pin", async (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  
  const rateCheck = await checkPinRateLimit(clientIp);
  if (!rateCheck.allowed) {
    res.status(429).json({ 
      error: "Too many failed attempts. Please try again later.",
      retryAfter: rateCheck.retryAfter
    });
    return;
  }
  
  try {
    const { accessCode, pin } = z.object({
      accessCode: z.string().trim().min(1, "Access code is required"),
      pin: z.string().length(6).regex(/^\d{6}$/, "PIN must be 6 digits")
    }).parse(req.body);
    
    const caseData = await caseService.getCaseByAccessCode(accessCode);
    
    if (!caseData || !caseData.userPin) {
      await recordPinAttempt(clientIp, false);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    
    const { valid: pinValid, needsMigration } = await verifyPin(
      pin,
      caseData.userPin,
    );
    if (!pinValid) {
      await recordPinAttempt(clientIp, false);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    // Lazy-migrate legacy plaintext PINs to bcrypt on first successful login.
    if (needsMigration) {
      try {
        const hashed = await bcrypt.hash(pin, BCRYPT_ROUNDS);
        await caseService.updateCase(caseData.id, { userPin: hashed });
      } catch (e) {
        warnOnce("cases:pin-migration-to-bcrypt-failed", "PIN migration to bcrypt failed:", e);
      }
    }
    
    // Check if user is disabled
    if (caseData.isDisabled) {
      res.status(403).json({ error: "Account disabled", reason: "reactivation_required" });
      return;
    }
    
    await recordPinAttempt(clientIp, true);
    
    // Update last login timestamp
    await caseService.updateCase(caseData.id, { 
      lastLoginAt: new Date(),
      lastLoginIp: clientIp 
    });

    const { createSession } = await import("../services/session-store");
    const sessionToken = await createSession(caseData.id, caseData.accessCode);
    
    res.json({
      success: true,
      id: caseData.id,
      accessCode: caseData.accessCode,
      sessionToken
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Access code and PIN are required" });
    } else {
      res.status(500).json({ error: "Failed to login" });
    }
  }
});

// Admin: Reset user PIN (requires admin auth)
casesRouter.post("/:id/reset-pin", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    
    const adminUser = await resolveAdminUsernameFromReq(req);

    // Task #137 — the PIN clear and its audit row must commit (or roll
    // back) together so we can never end up with an invisible PIN reset.
    let updated: Awaited<ReturnType<typeof caseService.updateCase>> | undefined;
    try {
      updated = await storage.runInTransaction(async (tx) => {
        const u = await caseService.updateCase(req.params.id, { userPin: null }, tx);
        if (!u) return undefined;
        await storage.createAuditLog({
          action: 'reset_user_pin',
          adminUsername: adminUser,
          targetType: 'case',
          targetId: req.params.id,
          newValue: `PIN reset for user: ${caseData.userName || caseData.accessCode}`
        }, tx);
        return u;
      });
    } catch (txErr) {
      warnOnce(
        "cases:reset-user-pin-transaction-failed-for-case-req-par",
        `[cases] reset_user_pin transaction failed for case ${req.params.id}:`,
        txErr,
      );
      res.status(500).json({ error: "Failed to reset PIN" });
      return;
    }

    if (!updated) {
      res.status(500).json({ error: "Failed to reset PIN" });
      return;
    }

    // Invalidate all active portal sessions for this case so an attacker
    // who already captured a session token cannot continue after the reset.
    try {
      const { deleteSessionsByCaseId } = await import("../services/session-store");
      await deleteSessionsByCaseId(req.params.id);
    } catch {
      // best-effort
    }

    res.json({ success: true, message: "PIN has been reset. User will need to set a new PIN on next login." });
  } catch (_e) {
    res.status(500).json({ error: "Failed to reset PIN" });
  }
});

// Admin: Enable/disable user access (requires admin auth)
//
// Locking stamps forceLogoutAt so anyone currently signed in is kicked out
// on the next refresh, and drops their in-memory portal sessions.
// Unlocking issues a brand-new accessCode, clears forceLogoutAt, and
// emails the new code to the user so they can sign back in cleanly
// (the previous code is invalidated by the rotation).
casesRouter.post("/:id/toggle-access", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    const { disabled } = z.object({ disabled: z.boolean() }).parse(req.body);

    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const updates: {
      isDisabled: boolean;
      forceLogoutAt?: Date | null;
      accessCode?: string;
    } = {
      isDisabled: disabled,
    };

    let newAccessCode: string | null = null;
    const reactivatedAt = !disabled ? new Date() : null;

    if (disabled) {
      updates.forceLogoutAt = new Date();
    } else {
      // Reactivation: rotate the access code (collision-resistant loop)
      // and clear the old force-logout stamp so the next login flows cleanly.
      // generateSecureAccessCode() produces 32^12 ~1.2×10^18 possible values
      // so collisions are astronomically rare; the retry loop is kept as a
      // belt-and-suspenders guard only.
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateSecureAccessCode();
        const collision = await caseService.getCaseByAccessCode(candidate);
        if (!collision) {
          newAccessCode = candidate;
          break;
        }
      }
      if (!newAccessCode) {
        res
          .status(500)
          .json({ error: "Could not generate a unique access code. Try again." });
        return;
      }
      updates.accessCode = newAccessCode;
      updates.forceLogoutAt = null;
      (updates as any).reactivatedAt = reactivatedAt;
      // Clear any active portal closure warning so the user isn't greeted
      // with an expiry overlay immediately after reactivation.
      (updates as any).portalWarningAt = null;
      (updates as any).portalWarningMinutes = null;
      (updates as any).portalWarningMessage = null;
      // Clear the reactivation page message so stale copy doesn't resurface
      // if the account is suspended again in the future.
      (updates as any).reactivationPageMessage = null;
    }

    const adminUsername = await resolveAdminUsernameFromReq(req);
    let updated: Awaited<ReturnType<typeof caseService.updateCase>>;
    try {
      updated = await storage.runInTransaction(async (tx) => {
        const u = await caseService.updateCase(req.params.id, updates, tx);
        if (u) {
          await storage.createAuditLog({
            action: disabled ? "disable_user_access" : "enable_user_access",
            adminUsername,
            targetType: "case",
            targetId: req.params.id,
            newValue: disabled
              ? `User disabled: ${caseData.userName || caseData.accessCode}`
              : `User reactivated: ${caseData.userName || caseData.accessCode} — new access code issued${
                  caseData.userEmail
                    ? ` — reactivation email queued to ${caseData.userEmail} (see audit log for delivery status)`
                    : " (no email on file — please share the new code manually)"
                }`,
          }, tx);
        }
        return u;
      });
    } catch (txErr) {
      warnOnce("cases:toggle-access-transaction-failed", "toggle-access transaction failed:", txErr);
      res.status(500).json({ error: "Failed to update access status" });
      return;
    }

    if (!updated) {
      res.status(500).json({ error: "Failed to update access status" });
      return;
    }

    // Always drop in-memory sessions when credentials change: on disable
    // (forceLogoutAt already stamps the DB) and on reactivation (new access
    // code is issued, so old sessions are stale and must not persist).
    try {
      const { deleteSessionsByCaseId } = await import(
        "../services/session-store"
      );
      await deleteSessionsByCaseId(req.params.id);
    } catch {
      // best-effort
    }

    // Reactivation email is dispatched asynchronously below (after we respond
    // to the admin) so a slow/down SMTP server can't hang the dashboard click.
    // Outcome is recorded via the standard email_<tag> / email_<tag>_failed
    // audit row, which the admin can inspect in the audit log.
    const shouldDispatchReactivationEmail =
      !disabled && Boolean(newAccessCode) && Boolean(caseData.userEmail);

    // On reactivation, also drop a celebratory in-portal "welcome back"
    // message into the user's secure inbox so they get a notification
    // badge the next time they sign in.
    if (!disabled) {
      try {
        const friendlyName = (caseData.userName || "").trim().split(" ")[0] || "there";
        await storage.createAdminMessage({
          caseId: req.params.id,
          category: "resolved",
          title: "Welcome back to IBCCF",
          body:
            `Hi ${friendlyName}, your IBCCF portal account has been fully reactivated by our compliance team. ` +
            `Your account is 100% restored and all features — withdrawal letter, deposit receipts, secure messaging, and declaration — are available again. ` +
            (caseData.userEmail
              ? `For your security we issued you a brand new access code; please check your email (${caseData.userEmail}) for it. Your previous code no longer works.`
              : `For your security a brand new access code has been issued — please contact your IBCCF case officer to receive it. Your previous code no longer works.`),
          isRead: false,
        });
        const { notificationService } = await import("../services/NotificationService");
        await notificationService.notifyUser(
          req.params.id,
          "new_message",
          "Welcome back to IBCCF",
          "Your account has been fully reactivated. Tap to see what's new.",
          "/dashboard",
        );
      } catch (err) {
        warnOnce("cases:welcome-back-notification-failed", "Welcome-back notification failed:", err);
        // Best-effort — do not fail the whole reactivation.
      }
    }

    res.json({
      success: true,
      isDisabled: disabled,
      message: disabled
        ? "User access has been disabled."
        : "User access has been enabled.",
      newAccessCode: newAccessCode || undefined,
      emailDispatched: shouldDispatchReactivationEmail ? true : undefined,
      hasEmail: disabled ? undefined : Boolean(caseData.userEmail),
    });

    // Dispatch the reactivation email AFTER responding so a slow SMTP server
    // never hangs the admin dashboard click. Delivery outcome is audit-logged.
    if (shouldDispatchReactivationEmail) {
      const recipientEmail = caseData.userEmail as string;
      const issuedAccessCode = newAccessCode as string;
      const userName = caseData.userName || "";
      void (async () => {
        let result: { success: boolean; error?: string };
        try {
          const { emailService } = await import("../services/EmailService");
          const sent = await emailService.sendAccountReactivationNotification(
            recipientEmail,
            userName,
            issuedAccessCode,
          );
          result = sent
            ? { success: true }
            : { success: false, error: "Email could not be delivered." };
        } catch (err) {
          result = {
            success: false,
            error: err instanceof Error ? err.message : "unexpected SMTP error",
          };
          warnOnce("cases:reactivation-email-failed", "Reactivation email failed:", err);
        }
        try {
          await storage.createAuditLog({
            action: result.success
              ? "email_account_reactivation"
              : "email_account_reactivation_failed",
            adminUsername,
            targetType: "case",
            targetId: req.params.id,
            newValue: result.success
              ? `Email sent (account-reactivation) to ${recipientEmail}`
              : `Email send failed (account-reactivation) to ${recipientEmail}: ${result.error ?? "unknown"}`,
          });
        } catch (logErr) {
          warnOnce(
            "cases:audit-log-for-reactivation-email-failed",
            "[toggle-access] audit log for reactivation email failed:",
            logErr,
          );
        }
      })();
    }
  } catch (error) {
    warnOnce("cases:toggle-access-error", "toggle-access error:", error);
    res.status(500).json({ error: "Failed to update access status" });
  }
});

// Admin: read-only check for whether a case currently has an active portal
// session (excluding admin "open as user" mirror sessions). Used by the
// dashboard to warn admins before a destructive action — e.g. rotating the
// access code — that the user is mid-session right now, rather than the
// generic "any active session will be signed out" copy shown otherwise.
casesRouter.get("/:id/active-session", checkAdminAuth, async (req, res) => {
  try {
    const session = await storage.getActivePortalSessionByCaseId(req.params.id);
    res.json({
      hasActiveSession: Boolean(session),
      expiresAt: session?.expiresAt ?? null,
      lastActivityAt: session?.lastActivityAt ?? null,
    });
  } catch (error) {
    warnOnce("cases:active-session-check-error", "active-session check error:", error);
    res.status(500).json({ error: "Failed to check active session" });
  }
});

// Admin: Bulk-rotate access codes for a filtered/selected group of cases
// (Task #2440). Lets admins clear the legacy alphanumeric access-code
// backlog (see the "Legacy access codes" filter in CasesTab) in one action
// instead of opening each case's Edit Account dialog to rotate it
// individually. Reuses the same collision-checked code generation, audit
// log action ("rotate_access_code"), and session-invalidation as the
// single-case endpoint below. Also emails each case's new code to its
// registered address (best-effort, same template as /:id/send-access-code)
// so a bulk rotation doesn't silently lock a batch of users out of the
// portal — matching the intent of the existing single-case flow, where an
// admin rotates then separately sends the new code. Rotation and
// notification failures are both reported per-case without aborting the
// rest of the batch. Same agent-role RBAC gate as the single-case endpoint.
// Registered BEFORE "/:id/rotate-access-code" so the literal
// "/bulk/rotate-access-code" path is not swallowed by the "/:id/rotate-access-code"
// pattern (id="bulk").
casesRouter.post("/bulk/rotate-access-code", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array" });
      return;
    }
    const caseIds = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (caseIds.length === 0) {
      res.status(400).json({ error: "ids must contain valid case ids" });
      return;
    }
    // Cap batch size so one request can't fan out unbounded DB writes / SMTP work.
    const MAX_BULK_ROTATE = 500;
    if (caseIds.length > MAX_BULK_ROTATE) {
      res.status(400).json({ error: `A maximum of ${MAX_BULK_ROTATE} cases can be processed per request.` });
      return;
    }

    const adminUsername = await resolveAdminUsernameFromReq(req);
    const results: Array<{
      id: string;
      success: boolean;
      newAccessCode?: string;
      notified?: boolean;
      notifyError?: string;
      error?: string;
    }> = [];

    // Sequential dispatch keeps DB/SMTP load predictable and audit-log
    // ordering deterministic; per-case failures never abort the batch.
    for (const caseId of caseIds) {
      try {
        const caseData = await storage.getCaseById(caseId);
        if (!caseData) {
          results.push({ id: caseId, success: false, error: "Case not found" });
          continue;
        }

        let newAccessCode: string | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = generateSecureAccessCode();
          const collision = await caseService.getCaseByAccessCode(candidate);
          if (!collision) {
            newAccessCode = candidate;
            break;
          }
        }
        if (!newAccessCode) {
          results.push({
            id: caseId,
            success: false,
            error: "Could not generate a unique access code. Try again.",
          });
          continue;
        }

        let updated: Awaited<ReturnType<typeof caseService.updateCase>>;
        try {
          updated = await storage.runInTransaction(async (tx) => {
            const u = await caseService.updateCase(
              caseId,
              { accessCode: newAccessCode as string },
              tx,
            );
            if (u) {
              await storage.createAuditLog({
                action: "rotate_access_code",
                adminUsername,
                targetType: "case",
                targetId: caseId,
                newValue: `Access code rotated (bulk) for ${caseData.userName || caseData.accessCode}`,
              }, tx);
            }
            return u;
          });
        } catch (txErr) {
          warnOnce(
            "cases:bulk-rotate-access-code-transaction-failed",
            "bulk/rotate-access-code transaction failed:",
            txErr,
          );
          results.push({ id: caseId, success: false, error: "Failed to rotate access code" });
          continue;
        }

        if (!updated) {
          results.push({ id: caseId, success: false, error: "Failed to rotate access code" });
          continue;
        }

        // Drop in-memory portal sessions so the previous code stops working
        // immediately, same as the single-case endpoint.
        try {
          const { deleteSessionsByCaseId } = await import(
            "../services/session-store"
          );
          await deleteSessionsByCaseId(caseId);
        } catch {
          // best-effort
        }

        let notified = false;
        let notifyError: string | undefined;
        if (!caseData.userEmail) {
          notifyError = "This case has no registered email on file.";
        } else {
          try {
            const sent = await emailService.sendAccessCodeEmail({
              ...caseData,
              accessCode: newAccessCode,
            });
            notified = sent.success;
            if (!sent.success) notifyError = sent.error || "Email could not be delivered.";
          } catch (err) {
            notifyError = err instanceof Error ? err.message : "unexpected SMTP error";
          }
        }

        results.push({
          id: caseId,
          success: true,
          newAccessCode,
          notified,
          notifyError,
        });
      } catch (err) {
        warnOnce("cases:bulk-rotate-access-code-item-error", "bulk/rotate-access-code item error:", err);
        results.push({
          id: caseId,
          success: false,
          error: err instanceof Error ? err.message : "unexpected error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    res.json({
      success: true,
      total: results.length,
      successCount,
      failureCount: results.length - successCount,
      results,
    });
  } catch (error) {
    warnOnce("cases:bulk-rotate-access-code-error", "bulk/rotate-access-code error:", error);
    res.status(500).json({ error: "Failed to bulk-rotate access codes" });
  }
});

// Admin: Rotate a case's access code at any time (regardless of whether the
// case is disabled, activated, or has never been logged into). Immediately
// invalidates the previous code and drops any active in-memory portal
// sessions for the case, mirroring the revocation signal `toggle-access`
// uses on lock/reactivation. Does NOT touch `isDisabled` — rotating the
// code on a locked case keeps it locked.
casesRouter.post("/:id/rotate-access-code", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    let newAccessCode: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateSecureAccessCode();
      const collision = await caseService.getCaseByAccessCode(candidate);
      if (!collision) {
        newAccessCode = candidate;
        break;
      }
    }
    if (!newAccessCode) {
      res
        .status(500)
        .json({ error: "Could not generate a unique access code. Try again." });
      return;
    }

    const adminUsername = await resolveAdminUsernameFromReq(req);
    let updated: Awaited<ReturnType<typeof caseService.updateCase>>;
    try {
      updated = await storage.runInTransaction(async (tx) => {
        const u = await caseService.updateCase(
          req.params.id,
          { accessCode: newAccessCode as string },
          tx,
        );
        if (u) {
          await storage.createAuditLog({
            action: "rotate_access_code",
            adminUsername,
            targetType: "case",
            targetId: req.params.id,
            newValue: `Access code rotated for ${caseData.userName || caseData.accessCode}`,
          }, tx);
        }
        return u;
      });
    } catch (txErr) {
      warnOnce("cases:rotate-access-code-transaction-failed", "rotate-access-code transaction failed:", txErr);
      res.status(500).json({ error: "Failed to rotate access code" });
      return;
    }

    if (!updated) {
      res.status(500).json({ error: "Failed to rotate access code" });
      return;
    }

    // Drop in-memory portal sessions so the previous code stops working
    // immediately, even though the DB write above already invalidates it
    // for the next lookup-by-code.
    try {
      const { deleteSessionsByCaseId } = await import(
        "../services/session-store"
      );
      await deleteSessionsByCaseId(req.params.id);
    } catch {
      // best-effort
    }

    res.json({ success: true, accessCode: newAccessCode });
  } catch (error) {
    warnOnce("cases:rotate-access-code-error", "rotate-access-code error:", error);
    res.status(500).json({ error: "Failed to rotate access code" });
  }
});

// Admin: Bulk-send access codes to a filtered/selected group of cases
// (Task #2335). Wraps the per-case send-access-code flow so ops/support
// teams can resend credentials to a batch of users (e.g. a stage cohort,
// or everyone who reported losing their code) in one action instead of
// opening each case individually. Reports per-case success/failure —
// some emails may legitimately fail to send (missing address, SMTP
// error) without aborting the rest of the batch. Same agent-role RBAC
// gate as the single-case endpoint. Registered BEFORE "/:id/send-access-code"
// so the literal "/bulk/send-access-code" path is not swallowed by the
// "/:id/send-access-code" pattern (id="bulk").
casesRouter.post("/bulk/send-access-code", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array" });
      return;
    }
    const caseIds = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (caseIds.length === 0) {
      res.status(400).json({ error: "ids must contain valid case ids" });
      return;
    }
    // Cap batch size so one request can't fan out unbounded SMTP work.
    const MAX_BULK_SEND = 500;
    if (caseIds.length > MAX_BULK_SEND) {
      res.status(400).json({ error: `A maximum of ${MAX_BULK_SEND} cases can be processed per request.` });
      return;
    }

    const adminUsername = await resolveAdminUsernameFromReq(req);
    const results: Array<{ id: string; success: boolean; sentTo?: string; error?: string }> = [];

    // Sequential dispatch keeps SMTP load predictable and audit-log
    // ordering deterministic; per-case failures never abort the batch.
    for (const caseId of caseIds) {
      try {
        const caseData = await storage.getCaseById(caseId);
        if (!caseData) {
          results.push({ id: caseId, success: false, error: "Case not found" });
          continue;
        }
        if (!caseData.userEmail) {
          results.push({ id: caseId, success: false, error: "This case has no registered email on file." });
          continue;
        }

        let outcome: { success: boolean; error?: string };
        try {
          const sent = await emailService.sendAccessCodeEmail(caseData);
          outcome = sent.success
            ? { success: true }
            : { success: false, error: sent.error || "Email could not be delivered." };
        } catch (err) {
          outcome = {
            success: false,
            error: err instanceof Error ? err.message : "unexpected SMTP error",
          };
        }

        try {
          await storage.createAuditLog({
            action: outcome.success ? "email_access_code" : "email_access_code_failed",
            adminUsername,
            targetType: "case",
            targetId: caseId,
            newValue: outcome.success
              ? `Email sent (access-code, bulk) to ${caseData.userEmail}`
              : `Email send failed (access-code, bulk) to ${caseData.userEmail}: ${outcome.error ?? "unknown"}`,
          });
        } catch (logErr) {
          warnOnce(
            "cases:audit-log-for-bulk-send-access-code-failed",
            "[bulk/send-access-code] audit log write failed:",
            logErr,
          );
        }

        results.push(
          outcome.success
            ? { id: caseId, success: true, sentTo: caseData.userEmail }
            : { id: caseId, success: false, error: outcome.error },
        );
      } catch (err) {
        warnOnce("cases:bulk-send-access-code-item-error", "bulk/send-access-code item error:", err);
        results.push({
          id: caseId,
          success: false,
          error: err instanceof Error ? err.message : "unexpected error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    res.json({
      success: true,
      total: results.length,
      successCount,
      failureCount: results.length - successCount,
      results,
    });
  } catch (error) {
    warnOnce("cases:bulk-send-access-code-error", "bulk/send-access-code error:", error);
    res.status(500).json({ error: "Failed to bulk-send access codes" });
  }
});

// Admin: Email the case's current access code to its registered email
// address. Used to resend credentials to an existing user (e.g. after a
// rotation, or when they've lost the original message). Does not change
// the code — pair with rotate-access-code first if a fresh code is needed.
casesRouter.post("/:id/send-access-code", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.userEmail) {
      res.status(400).json({ error: "This case has no registered email on file." });
      return;
    }

    const adminUsername = await resolveAdminUsernameFromReq(req);
    let result: { success: boolean; error?: string };
    try {
      const sent = await emailService.sendAccessCodeEmail(caseData);
      result = sent.success
        ? { success: true }
        : { success: false, error: sent.error || "Email could not be delivered." };
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : "unexpected SMTP error",
      };
      warnOnce("cases:send-access-code-email-failed", "send-access-code email failed:", err);
    }

    try {
      await storage.createAuditLog({
        action: result.success ? "email_access_code" : "email_access_code_failed",
        adminUsername,
        targetType: "case",
        targetId: req.params.id,
        newValue: result.success
          ? `Email sent (access-code) to ${caseData.userEmail}`
          : `Email send failed (access-code) to ${caseData.userEmail}: ${result.error ?? "unknown"}`,
      });
    } catch (logErr) {
      warnOnce(
        "cases:audit-log-for-send-access-code-failed",
        "[send-access-code] audit log write failed:",
        logErr,
      );
    }

    if (!result.success) {
      res.status(502).json({ error: result.error || "Email could not be delivered." });
      return;
    }

    res.json({ success: true, sentTo: caseData.userEmail });
  } catch (error) {
    warnOnce("cases:send-access-code-error", "send-access-code error:", error);
    res.status(500).json({ error: "Failed to send access code email" });
  }
});

// Admin: Send a timed portal-closure warning to a case's portal.
// The portal detects the warning on its next poll and shows a fullscreen
// countdown overlay. At zero the user is auto-logged out. An email is
// dispatched to the user's address immediately (best-effort, non-blocking).
// The admin can cancel the warning before it expires via DELETE below.
casesRouter.post("/:id/portal-warning", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const bodySchema = z.object({
      minutes: z.number().int().min(1).max(7200),
      portalMessage: z.string().max(500).optional().default(""),
      emailMessage: z.string().max(1000).optional().default(""),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const { minutes, portalMessage, emailMessage } = parsed.data;

    const warningAt = new Date();
    const adminUsername = await resolveAdminUsernameFromReq(req);

    await caseService.updateCase(req.params.id, {
      portalWarningAt: warningAt,
      portalWarningMinutes: minutes,
      portalWarningMessage: portalMessage || null,
    } as any);

    await storage.createAuditLog({
      action: "portal_warning_sent",
      adminUsername,
      targetType: "case",
      targetId: req.params.id,
      newValue: `Portal closure warning sent: ${minutes} minute(s)${portalMessage ? ` — portal: "${portalMessage}"` : ""}${emailMessage ? ` — email: "${emailMessage.slice(0, 100)}"` : ""}`,
    });

    res.json({ success: true, warningAt, minutes, portalMessage, emailMessage });

    // Fire-and-forget email notification to the user (best-effort).
    if (caseData.userEmail) {
      setImmediate(async () => {
        try {
          const { emailService } = await import("../services/EmailService");
          const { resolveRecipientLocale } = await import("../services/emailNotify");
          const locale = await resolveRecipientLocale(req.params.id);
          const result = await emailService.sendPortalWarning(
            caseData.userEmail!,
            caseData.userName || "Portal User",
            minutes,
            emailMessage || portalMessage || "",
            locale,
          );
          await storage.createAuditLog({
            action: result.success ? "email_portal_warning" : "email_portal_warning_failed",
            adminUsername,
            targetType: "case",
            targetId: req.params.id,
            newValue: result.success
              ? `Email sent (portal_warning, ${locale}) to ${caseData.userEmail}: Portal closure warning (${minutes}m)`
              : `Email send failed (portal_warning, ${locale}) to ${caseData.userEmail}: ${result.error}`,
            metadata: { minutes, emailMessage: emailMessage || portalMessage || "" },
          });
        } catch (emailErr) {
          console.error("[portal-warning] email dispatch failed:", emailErr);
        }
      });
    }
  } catch (error) {
    console.error("portal-warning error:", error);
    res.status(500).json({ error: "Failed to send portal warning" });
  }
});

// Admin: Cancel an active portal-closure warning before it expires.
casesRouter.delete("/:id/portal-warning", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const adminUsername = await resolveAdminUsernameFromReq(req);

    await caseService.updateCase(req.params.id, {
      portalWarningAt: null,
      portalWarningMinutes: null,
      portalWarningMessage: null,
    } as any);

    await storage.createAuditLog({
      action: "portal_warning_cancelled",
      adminUsername,
      targetType: "case",
      targetId: req.params.id,
      newValue: "Portal closure warning cancelled by admin",
    });

    res.json({ success: true });
  } catch (error) {
    console.error("portal-warning cancel error:", error);
    res.status(500).json({ error: "Failed to cancel portal warning" });
  }
});

// Admin: Override Countdown — immediately ends any active countdown, stamps
// forceLogoutAt, and disables the account. The user is redirected to the
// reactivation deposit page on their next poll.
casesRouter.post("/:id/portal-warning/override", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const adminUsername = await resolveAdminUsernameFromReq(req);

    // Disable account + reset pathway in one atomic transaction.
    const { disableAndResetPathway } = await import("../services/pathwayReset");
    await disableAndResetPathway(req.params.id, "override", adminUsername);

    res.json({ success: true });

    if (caseData.userEmail) {
      setImmediate(async () => {
        try {
          const { emailService } = await import("../services/EmailService");
          const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
          const caseId = req.params.id;
          const userName = (caseData.userName ?? "").trim() || caseData.userEmail!;
          // 1. Countdown override notification (explains what happened)
          await sendCaseEmailWithAudit({
            to: caseData.userEmail,
            caseId,
            tag: "countdown_override",
            adminUser: adminUsername,
            send: (locale) =>
              emailService.sendCountdownOverrideNotification({
                to: caseData.userEmail!,
                userName,
                caseRef: caseId,
                locale,
              }),
          });
          // 2. Reactivation required notification (explains what to do next)
          await sendCaseEmailWithAudit({
            to: caseData.userEmail,
            caseId,
            tag: "reactivation_required",
            adminUser: adminUsername,
            send: (locale) =>
              emailService.sendReactivationRequiredNotification({
                to: caseData.userEmail!,
                userName,
                caseRef: caseId,
                depositAmount: "1,500 USDT",
                locale,
              }),
          });
        } catch (emailErr) {
          console.error("[portal-warning/override] email dispatch failed:", emailErr);
        }
      });
    }
  } catch (error) {
    console.error("portal-warning override error:", error);
    res.status(500).json({ error: "Failed to override countdown" });
  }
});

// Admin: Skip to Reactivation — immediately disables the account without
// requiring an active countdown. The user is redirected to the reactivation
// deposit page on their next poll.
casesRouter.post("/:id/portal-warning/skip-reactivation", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const adminUsername = await resolveAdminUsernameFromReq(req);

    // Disable account + reset pathway in one atomic transaction.
    const { disableAndResetPathway: disableAndResetSkip } = await import("../services/pathwayReset");
    await disableAndResetSkip(req.params.id, "skip", adminUsername);

    res.json({ success: true });

    if (caseData.userEmail) {
      setImmediate(async () => {
        try {
          const { emailService } = await import("../services/EmailService");
          const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
          const caseId = req.params.id;
          const userName = (caseData.userName ?? "").trim() || caseData.userEmail!;
          // Reactivation required notification — tells the user what happened
          // and exactly how to restore access (no countdown was active so we
          // skip the override notification and send the action email directly).
          await sendCaseEmailWithAudit({
            to: caseData.userEmail,
            caseId,
            tag: "reactivation_required",
            adminUser: adminUsername,
            send: (locale) =>
              emailService.sendReactivationRequiredNotification({
                to: caseData.userEmail!,
                userName,
                caseRef: caseId,
                depositAmount: "1,500 USDT",
                locale,
              }),
          });
        } catch (emailErr) {
          console.error("[portal-warning/skip-reactivation] email dispatch failed:", emailErr);
        }
      });
    }
  } catch (error) {
    console.error("portal-warning skip-reactivation error:", error);
    res.status(500).json({ error: "Failed to skip to reactivation" });
  }
});

// Portal: Countdown Expiry — called by the client when the portal-closure
// warning timer reaches zero. Stamps the account as disabled, clears the
// warning, and resets the withdrawal pathway so the user is routed to
// the reactivation deposit page on their next interaction.
// Requires an active portal session (x-portal-session-token) for the case.
casesRouter.post("/:id/portal-warning/expired", requirePortalAccess, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    // Idempotent — if already disabled from a concurrent override/skip,
    // still return success so the client can safely complete its logout.
    if (caseData.isDisabled) {
      res.json({ success: true, alreadyDisabled: true });
      return;
    }

    // Verify a portal warning actually exists for this case so the endpoint
    // cannot be abused to disable arbitrary accounts without a countdown.
    if (!caseData.portalWarningAt || !caseData.portalWarningMinutes) {
      res.status(400).json({ error: "No active portal warning for this case" });
      return;
    }

    const expiresAt =
      new Date(caseData.portalWarningAt).getTime() +
      caseData.portalWarningMinutes * 60 * 1000;
    if (Date.now() < expiresAt) {
      res.status(400).json({ error: "Portal warning has not yet expired" });
      return;
    }

    // Disable account + reset pathway in one atomic transaction.
    const { disableAndResetPathway: disableAndResetExpired } = await import("../services/pathwayReset");
    await disableAndResetExpired(req.params.id, "expired", "system");

    res.json({ success: true });

    // Fire-and-forget: notify the user their countdown expired and what to do.
    if (caseData.userEmail) {
      setImmediate(async () => {
        try {
          const { emailService } = await import("../services/EmailService");
          const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
          const caseId = req.params.id;
          const userName = (caseData.userName ?? "").trim() || caseData.userEmail!;
          // 1. Countdown expired notification
          await sendCaseEmailWithAudit({
            to: caseData.userEmail,
            caseId,
            tag: "countdown_expired",
            adminUser: "system",
            send: (locale) =>
              emailService.sendCountdownExpiredNotification({
                to: caseData.userEmail!,
                userName,
                caseRef: caseId,
                locale,
              }),
          });
          // 2. Reactivation required notification
          await sendCaseEmailWithAudit({
            to: caseData.userEmail,
            caseId,
            tag: "reactivation_required",
            adminUser: "system",
            send: (locale) =>
              emailService.sendReactivationRequiredNotification({
                to: caseData.userEmail!,
                userName,
                caseRef: caseId,
                depositAmount: "1,500 USDT",
                locale,
              }),
          });
        } catch (emailErr) {
          console.error("[portal-warning/expired] email dispatch failed:", emailErr);
        }
      });
    }
  } catch (error) {
    console.error("portal-warning expired error:", error);
    res.status(500).json({ error: "Failed to process countdown expiry" });
  }
});

// Admin: Send email to case user (requires admin auth)
casesRouter.post("/:id/email", checkAdminAuth, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    
    if (!caseData.userEmail) {
      res.status(400).json({ error: "This user does not have an email address on file" });
      return;
    }
    
    const emailSchema = z.object({
      subject: z.string().min(1, "Subject is required").max(200),
      body: z.string().min(1, "Email body is required").max(50000),
    });
    
    const validationResult = emailSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    
    const { subject, body } = validationResult.data;
    
    const { emailService } = await import('../services/EmailService');
    const adminUser = await resolveAdminUsernameFromReq(req);
    
    const recipientEmail = caseData.userEmail;
    const emailRecord = await storage.createCaseEmail({
      caseId: req.params.id,
      toEmail: recipientEmail,
      subject,
      body,
      status: 'pending',
      sentBy: adminUser,
    });

    // Respond to the admin immediately; dispatch SMTP asynchronously so a
    // slow/down mail server cannot hang the dashboard. The eventual delivery
    // outcome shows up in case_emails.status AND as an
    // `email_custom` / `email_custom_failed` audit row.
    res.json({
      success: true,
      emailDispatched: true,
      message: "Email queued for delivery — check the audit log for the final status.",
    });

    void (async () => {
      let result: { success: boolean; error?: string };
      try {
        result = await emailService.sendCustomEmail(recipientEmail, subject, body);
      } catch (err) {
        result = {
          success: false,
          error: err instanceof Error ? err.message : "unexpected SMTP error",
        };
        warnOnce("cases:custom-email-dispatch-failed", 'Custom email dispatch failed:', err);
      }
      try {
        await storage.updateCaseEmailStatus(
          emailRecord.id,
          result.success ? 'sent' : 'failed',
          result.error,
        );
      } catch (persistErr) {
        warnOnce("cases:failed-to-update-case-email-status-after-send", 'Failed to update case email status after send:', persistErr);
      }
      try {
        await storage.createAuditLog({
          action: result.success ? 'email_custom' : 'email_custom_failed',
          adminUsername: adminUser,
          targetType: 'case',
          targetId: req.params.id,
          newValue: result.success
            ? `Email sent (custom) to ${recipientEmail}: ${subject}`
            : `Email send failed (custom) to ${recipientEmail}: ${subject} — ${result.error ?? 'unknown'}`,
        });
      } catch (auditErr) {
        warnOnce("cases:failed-to-write-audit-log-for-custom-email", 'Failed to write audit log for custom email:', auditErr);
      }
    })();
  } catch (error) {
    warnOnce("cases:error-sending-email", 'Error sending email:', error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// Admin: Send detailed stage-instructions email for the case's current stage
casesRouter.post("/:id/send-stage-email", checkAdminAuth, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    if (!caseData.userEmail) {
      res.status(400).json({ error: "This user does not have an email address on file" });
      return;
    }

    const { getStageInstruction } = await import('../../shared/stageInstructions');
    const stageNumber = parseInt(caseData.withdrawalStage || '1', 10);
    const stage = getStageInstruction(stageNumber);

    const userName = (caseData.userName ?? '').trim() || caseData.userEmail;
    const caseReference = caseData.id;

    const overrideSchema = z.object({
      subject: z.string().min(1).max(300).optional(),
      summary: z.string().max(4000).optional(),
      detailedExplanation: z.string().max(8000).optional(),
      whyItMatters: z.string().max(4000).optional(),
      whatToDo: z.array(z.string().max(600)).max(20).optional(),
      whatToExpect: z.string().max(2000).optional(),
      regulatoryBasis: z.array(z.string().max(400)).max(20).optional(),
    }).optional();

    const overridesParsed = overrideSchema.safeParse(req.body);
    if (!overridesParsed.success) {
      res.status(400).json({ error: "Invalid override payload" });
      return;
    }
    const overrides = overridesParsed.data;

    const { emailService } = await import('../services/EmailService');

    const subject = (overrides?.subject?.trim()) || `Stage ${stage.stage} of 14: ${stage.title} — Case ${caseReference}`;
    const finalSummary = overrides?.summary ?? stage.summary;
    const finalDetailed = overrides?.detailedExplanation ?? stage.detailedExplanation;
    const finalWhy = overrides?.whyItMatters ?? stage.whyItMatters;
    const finalTodo = (overrides?.whatToDo && overrides.whatToDo.length > 0) ? overrides.whatToDo : stage.whatToDo;
    const finalExpect = overrides?.whatToExpect ?? stage.whatToExpect;
    const finalRegBasis = (overrides?.regulatoryBasis && overrides.regulatoryBasis.length > 0) ? overrides.regulatoryBasis : stage.regulatoryBasis;

    const bodyPreview = [
      `Stage ${stage.stage} of 14 — ${stage.title}`,
      '',
      `Summary: ${finalSummary}`,
      '',
      `Detailed Explanation: ${finalDetailed}`,
      '',
      `Why this step is needed: ${finalWhy}`,
      '',
      'Regulatory basis:',
      ...finalRegBasis.map(r => `  • ${r}`),
      '',
      'What you need to do:',
      ...finalTodo.map(s => `  • ${s}`),
      '',
      `What to expect next: ${finalExpect}`,
    ].join('\n');

    const adminUser = await resolveAdminUsernameFromReq(req);
    const recipientEmail = caseData.userEmail;
    const emailRecord = await storage.createCaseEmail({
      caseId: req.params.id,
      toEmail: recipientEmail,
      subject,
      body: bodyPreview,
      status: 'pending',
      sentBy: adminUser,
    });

    // Respond to the admin immediately; the SMTP send runs in the background
    // so a slow/down mail server cannot hang the dashboard click. Final
    // delivery outcome is recorded both on case_emails.status and as an
    // `email_stage_instructions` / `email_stage_instructions_failed` audit row.
    res.json({
      success: true,
      emailDispatched: true,
      stage: stage.stage,
      title: stage.title,
      message: `Stage ${stage.stage} email queued for delivery — check the audit log for the final status.`,
    });

    void (async () => {
      let result: { success: boolean; error?: string };
      try {
        result = await emailService.sendStageInstructionsEmail(
          recipientEmail,
          userName,
          caseReference,
          stageNumber,
          { ...overrides, subject },
        );
      } catch (err) {
        result = {
          success: false,
          error: err instanceof Error ? err.message : "unexpected SMTP error",
        };
        warnOnce("cases:stage-email-dispatch-failed", 'Stage email dispatch failed:', err);
      }
      try {
        await storage.updateCaseEmailStatus(
          emailRecord.id,
          result.success ? 'sent' : 'failed',
          result.error,
        );
      } catch (persistErr) {
        warnOnce("cases:failed-to-update-case-email-status-after-send", 'Failed to update case email status after send:', persistErr);
      }
      try {
        await storage.createAuditLog({
          action: result.success
            ? 'email_stage_instructions'
            : 'email_stage_instructions_failed',
          adminUsername: adminUser,
          targetType: 'case',
          targetId: req.params.id,
          newValue: result.success
            ? `Email sent (stage-instructions, stage ${stage.stage}) to ${recipientEmail}`
            : `Email send failed (stage-instructions, stage ${stage.stage}) to ${recipientEmail}: ${result.error ?? 'unknown'}`,
        });
      } catch (auditErr) {
        warnOnce("cases:failed-to-write-audit-log-for-stage-email", 'Failed to write audit log for stage email:', auditErr);
      }
    })();
  } catch (error) {
    warnOnce("cases:error-sending-stage-email", 'Error sending stage email:', error);
    res.status(500).json({ error: "Failed to send stage email" });
  }
});

// Admin: preview the token-wallet-setup-confirmed email HTML so the officer
// can review the copy before (or after) the automatic send fires.
// Returns { subject, preheader, html, to, userName, caseReference }.
casesRouter.get("/:id/token-wallet-email-preview", checkAdminAuth, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.userEmail) {
      res.status(400).json({ error: "This case does not have an email address on file" });
      return;
    }
    const { emailService } = await import('../services/EmailService');
    const userName = (caseData.userName ?? '').trim() || caseData.userEmail;
    const { subject, preheader, html } = emailService.buildTokenWalletConfirmedEmailHtml(
      userName,
      caseData.id,
    );
    res.json({ subject, preheader, html, to: caseData.userEmail, userName, caseReference: caseData.id });
  } catch (_e) {
    res.status(500).json({ error: "Failed to generate email preview" });
  }
});

// Admin: preview the token-wallet-setup-unconfirmed email HTML so the officer
// can review the copy before (or after) the automatic send fires.
// Returns { subject, preheader, html, to, userName, caseReference }.
casesRouter.get("/:id/token-wallet-unconfirmed-email-preview", checkAdminAuth, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.userEmail) {
      res.status(400).json({ error: "This case does not have an email address on file" });
      return;
    }
    const { emailService } = await import('../services/EmailService');
    const userName = (caseData.userName ?? '').trim() || caseData.userEmail;
    const { subject, preheader, html } = emailService.buildTokenWalletUnconfirmedEmailHtml(
      userName,
      caseData.id,
    );
    res.json({ subject, preheader, html, to: caseData.userEmail, userName, caseReference: caseData.id });
  } catch (_e) {
    res.status(500).json({ error: "Failed to generate email preview" });
  }
});

// Admin: preview the token-wallet-setup-guide email HTML so the officer
// can review the copy before (or after) saving the wallet setup URL.
// Returns { subject, preheader, html, to, userName, caseReference }.
casesRouter.get("/:id/token-wallet-guide-email-preview", checkAdminAuth, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.userEmail) {
      res.status(400).json({ error: "This case does not have an email address on file" });
      return;
    }
    const setupLink = ((caseData.tokenWalletSetupLink ?? '') as string).trim();
    if (!setupLink) {
      res.status(400).json({ error: "No wallet setup URL has been saved for this case yet" });
      return;
    }
    const { emailService } = await import('../services/EmailService');
    const userName = (caseData.userName ?? '').trim() || caseData.userEmail;
    const { subject, preheader, html } = emailService.buildTokenWalletSetupGuideEmailHtml(
      userName,
      caseData.id,
      {
        setupLink,
        note: (caseData.tokenWalletSetupNote ?? null) as string | null,
      },
    );
    res.json({ subject, preheader, html, to: caseData.userEmail, userName, caseReference: caseData.id });
  } catch (_e) {
    res.status(500).json({ error: "Failed to generate email preview" });
  }
});

// Admin: manually resend the token-wallet-setup-guide email.
// Useful when the automatic send was missed (e.g. SMTP was down at the time
// the admin saved the wallet setup URL). Responds immediately; SMTP is
// fire-and-forget. Outcome is audit-logged as `token_wallet_setup_link_sent` / `_failed`.
casesRouter.post("/:id/send-token-wallet-guide-email", checkAdminAuth, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.userEmail) {
      res.status(400).json({ error: "This case does not have an email address on file" });
      return;
    }
    const setupLink = ((caseData.tokenWalletSetupLink ?? '') as string).trim();
    if (!setupLink) {
      res.status(400).json({ error: "No wallet setup URL has been saved for this case yet" });
      return;
    }
    const adminUser = await resolveAdminUsernameFromReq(req);
    const userName = (caseData.userName ?? '').trim() || caseData.userEmail;

    res.json({ success: true, emailDispatched: true, message: "Token wallet setup guide email queued — check the audit log for delivery status." });

    void (async () => {
      const { emailService } = await import('../services/EmailService');
      const { sendCaseEmailWithAudit } = await import('../services/emailNotify');
      try {
        await sendCaseEmailWithAudit({
          to: caseData.userEmail,
          caseId: caseData.id,
          tag: 'token_wallet_setup_link_sent',
          adminUser,
          send: () =>
            emailService.sendTokenWalletSetupGuideEmail(
              caseData.userEmail!,
              userName,
              caseData.id,
              {
                setupLink,
                note: (caseData.tokenWalletSetupNote ?? null) as string | null,
              },
            ),
        });
      } catch (err) {
        warnOnce('cases:tws-guide-manual-resend-failed', '[cases] manual token-wallet-setup-guide email resend failed:', err);
      }
    })();
  } catch (_e) {
    res.status(500).json({ error: "Failed to send token wallet setup guide email" });
  }
});

// Admin: manually resend the token-wallet-setup-confirmed email.
// Useful when the automatic send was missed (e.g. SMTP was down at the time
// the admin clicked "Mark Wallet Set Up"). Responds immediately; SMTP is
// fire-and-forget. Outcome is audit-logged as `email_tws_confirmed` / `_failed`.
casesRouter.post("/:id/send-token-wallet-confirmed-email", checkAdminAuth, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.userEmail) {
      res.status(400).json({ error: "This case does not have an email address on file" });
      return;
    }
    const setupLink = ((caseData.tokenWalletSetupLink ?? '') as string).trim();
    if (!setupLink) {
      res.status(400).json({ error: "No wallet setup URL has been saved for this case yet" });
      return;
    }
    const adminUser = await resolveAdminUsernameFromReq(req);
    const userName = (caseData.userName ?? '').trim() || caseData.userEmail;

    res.json({ success: true, emailDispatched: true, message: "Token wallet confirmation email queued — check the audit log for delivery status." });

    void (async () => {
      const { emailService } = await import('../services/EmailService');
      const { sendCaseEmailWithAudit } = await import('../services/emailNotify');
      // Re-fetch the case after the async yields to catch any race where the
      // email address or wallet URL was cleared between the initial guard check and now.
      const freshCase = await storage.getCaseById(caseData.id);
      if (!freshCase?.userEmail) return;
      if (!((freshCase.tokenWalletSetupLink ?? '') as string).trim()) return;
      const freshEmail = freshCase.userEmail;
      try {
        await sendCaseEmailWithAudit({
          to: freshEmail,
          caseId: freshCase.id,
          tag: 'email_tws_confirmed',
          adminUser,
          send: () =>
            emailService.sendTokenWalletSetupConfirmedEmail(
              freshEmail,
              userName,
              freshCase.id,
            ),
        });
      } catch (err) {
        warnOnce('cases:tws-manual-resend-failed', '[cases] manual token-wallet-confirmed email resend failed:', err);
      }
    })();
  } catch (_e) {
    res.status(500).json({ error: "Failed to send token wallet confirmation email" });
  }
});

// Admin: send the phrase-code portal notice — points the user to the
// Wallet Connection step to retrieve their phrase code and proceed with
// their withdrawal. Responds as soon as the request is validated; the SMTP
// send runs fire-and-forget so a slow mail server can't hang the dashboard.
// Delivery outcome is recorded as `email_phrase_code_notice` / `_failed`.
casesRouter.post("/:id/send-phrase-code-notice", checkAdminAuth, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.userEmail || !caseData.userEmail.trim()) {
      res.status(400).json({ error: "This user does not have an email address on file" });
      return;
    }

    const adminUser = await resolveAdminUsernameFromReq(req);
    const recipientEmail = caseData.userEmail;
    const userName = (caseData.userName ?? "").trim() || recipientEmail;
    const caseReference = caseData.id;

    res.json({
      success: true,
      emailDispatched: true,
      message: "Phrase-code notice queued for delivery — check the audit log for the final status.",
    });

    void (async () => {
      try {
        const { emailService } = await import("../services/EmailService");
        await sendCaseEmailWithAudit({
          to: recipientEmail,
          caseId: req.params.id,
          tag: "phrase_code_notice",
          adminUser,
          send: (locale) =>
            emailService.sendPhraseCodeNoticeEmail({
              to: recipientEmail,
              userName,
              caseRef: caseReference,
              locale,
            }),
        });
      } catch (dispatchError) {
        warnOnce("cases:background-phrase-code-notice-dispatch-failed", "Background phrase-code notice dispatch failed:", dispatchError);
      }
    })();
  } catch (error) {
    warnOnce("cases:error-sending-phrase-code-notice", "Error sending phrase-code notice:", error);
    res.status(500).json({ error: "Failed to send phrase-code notice" });
  }
});

// Admin: Get sent emails for a case (requires admin auth)
casesRouter.get("/:id/emails", checkAdminAuth, async (req, res) => {
  try {
    const emails = await storage.getCaseEmailsByCaseId(req.params.id);
    res.json(emails);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch emails" });
  }
});

// Admin: Get email-related audit rows for a case (any `email_*` action,
// success OR `_failed`). Powers the per-case email-delivery panel in the
// case-detail dialog so admins can confirm whether a background SMTP
// dispatch from sendCaseEmailWithAudit (or the three admin-triggered
// endpoints that fire-and-forget) actually landed — without scrolling
// the global audit log.
casesRouter.get("/:id/email-audit-logs", checkAdminAuth, async (req, res) => {
  try {
    const limitRaw = Number.parseInt(
      typeof req.query.limit === "string" ? req.query.limit : "50",
      10,
    );
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50;
    const rows = await storage.getEmailAuditLogsForCase(req.params.id, limit);
    res.json(rows);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch email audit logs" });
  }
});

// Tags whose retry handler is implemented below. The portal UI uses this
// list (mirrored as RETRYABLE_AUDIT_TAGS in the client) to decide whether
// to enable the inline "Retry" button on a failed audit row.
const RETRYABLE_AUDIT_TAGS = new Set<string>([
  "letter-ready",
  "letter-reissued",
  "payout-wallet-set",
  "payout-wallet-changed",
  "declaration-assigned",
  "declaration-approved",
  "declaration-rejected",
  "submission-received",
  "account_reactivation",
  "compliance-message",
  "document-requested",
  "document-approved",
  "document-rejected",
  "reissue-receipt-approved",
  "reissue-receipt-rejected",
  "portal_warning",
]);

// Admin: Retry a failed `case_emails` row (custom email or stage
// instructions). The original row is intentionally LEFT in place as
// historical record; a brand-new pending row is inserted and dispatched
// via the same EmailService method that originally produced the failure.
// A fresh audit row is written so delivery history is preserved.
casesRouter.post(
  "/:id/emails/:emailId/retry",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseId = req.params.id;
      const emailId = Number.parseInt(req.params.emailId, 10);
      if (!Number.isFinite(emailId) || emailId <= 0) {
        res.status(400).json({ error: "Invalid email id" });
        return;
      }
      const original = await storage.getCaseEmailById(emailId);
      if (!original || original.caseId !== caseId) {
        res.status(404).json({ error: "Email not found for this case" });
        return;
      }
      if (original.status !== "failed") {
        res
          .status(409)
          .json({ error: "Only failed emails can be retried" });
        return;
      }
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const adminUser = await resolveAdminUsernameFromReq(req);
      const stageMatch = original.subject.match(
        /^Stage\s+(\d+)\s+of\s+14\b/i,
      );
      const isStageEmail = Boolean(stageMatch);
      const stageNumber = stageMatch ? parseInt(stageMatch[1], 10) : null;
      const auditTag = isStageEmail ? "stage_instructions" : "custom";

      const retryRow = await storage.createCaseEmail({
        caseId,
        toEmail: original.toEmail,
        subject: original.subject,
        body: original.body,
        status: "pending",
        sentBy: adminUser,
      });

      res.json({
        success: true,
        emailDispatched: true,
        newEmailId: retryRow.id,
        message:
          "Retry queued for delivery — check the audit log for the final status.",
      });

      void (async () => {
        const { emailService } = await import("../services/EmailService");
        let result: { success: boolean; error?: string };
        try {
          if (isStageEmail && stageNumber) {
            // Original dispatch used sendStageInstructionsEmail. Replay
            // through the same method so the recipient gets the full
            // premium stage template (not the generic custom-email
            // wrapper). The original subject/body overrides aren't
            // persisted, so the retry re-renders from the canonical
            // shared/stageInstructions copy for the parsed stage —
            // captured in the audit row's "retry of #<id>" note.
            const userName =
              (caseData.userName ?? "").trim() || original.toEmail;
            result = await emailService.sendStageInstructionsEmail(
              original.toEmail,
              userName,
              caseId,
              stageNumber,
              { subject: original.subject },
            );
          } else {
            result = await emailService.sendCustomEmail(
              original.toEmail,
              original.subject,
              original.body,
            );
          }
        } catch (err) {
          result = {
            success: false,
            error:
              err instanceof Error ? err.message : "unexpected SMTP error",
          };
          warnOnce("cases:retry-email-dispatch-failed", "Retry email dispatch failed:", err);
        }
        try {
          await storage.updateCaseEmailStatus(
            retryRow.id,
            result.success ? "sent" : "failed",
            result.error,
          );
        } catch (persistErr) {
          warnOnce(
            "cases:failed-to-update-case-emails-status-after-retry",
            "Failed to update case_emails status after retry:",
            persistErr,
          );
        }
        try {
          await storage.createAuditLog({
            action: result.success
              ? `email_${auditTag}`
              : `email_${auditTag}_failed`,
            adminUsername: adminUser,
            targetType: "case",
            targetId: caseId,
            newValue: result.success
              ? `Email sent (${auditTag}, retry of #${original.id}) to ${original.toEmail}: ${original.subject}`
              : `Email send failed (${auditTag}, retry of #${original.id}) to ${original.toEmail}: ${original.subject} — ${result.error ?? "unknown"}`,
          });
        } catch (auditErr) {
          warnOnce(
            "cases:failed-to-write-audit-log-for-case-emails-retry",
            "Failed to write audit log for case_emails retry:",
            auditErr,
          );
        }
      })();
    } catch (error) {
      warnOnce("cases:retry-case-email-error", "Retry case_email error:", error);
      res.status(500).json({ error: "Failed to retry email" });
    }
  },
);

// Admin: Retry a failed transactional email recorded as an `email_*_failed`
// audit row (i.e. dispatches that did NOT also persist a `case_emails` row
// — letter-ready, declaration-assigned, payout-wallet-set, etc.). The
// original audit row is preserved; the retry re-dispatches via the same
// EmailService method using the case's CURRENT state and writes a fresh
// `email_<tag>` / `email_<tag>_failed` audit row through the standard
// sendCaseEmailWithAudit helper.
casesRouter.post(
  "/:id/email-audit-logs/:auditId/retry",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseId = req.params.id;
      const auditId = Number.parseInt(req.params.auditId, 10);
      if (!Number.isFinite(auditId) || auditId <= 0) {
        res.status(400).json({ error: "Invalid audit id" });
        return;
      }
      const auditRow = await storage.getAuditLogById(auditId);
      if (
        !auditRow ||
        auditRow.targetType !== "case" ||
        auditRow.targetId !== caseId
      ) {
        res.status(404).json({ error: "Audit row not found for this case" });
        return;
      }
      if (!auditRow.action.endsWith("_failed")) {
        res
          .status(409)
          .json({ error: "Only failed email rows can be retried" });
        return;
      }
      const tag = auditRow.action
        .replace(/^email_/, "")
        .replace(/_failed$/, "");

      if (!RETRYABLE_AUDIT_TAGS.has(tag)) {
        res.status(422).json({
          error:
            "This email type can't be retried automatically — re-run the original admin action (the original context, like notes or document type, isn't preserved on the audit row).",
        });
        return;
      }

      // Task #159 — Legacy `email_<tag>_failed` rows recorded before
      // Task #158 had no metadata. The 0016 backfill migration walks
      // those rows and either stamps the unambiguous 1:1 mapping or
      // marks them `{ ambiguous: true }`. Refuse to retry ambiguous
      // rows — without a stable foreign key we'd silently send the
      // *latest* matching record, which is exactly the bug Task #158
      // fixed for fresh sends. The dashboard mirrors this check and
      // hides the button with an explanatory tooltip.
      const auditMeta = (auditRow.metadata as
        | { ambiguous?: boolean; reason?: string }
        | null) ?? null;
      if (auditMeta?.ambiguous === true) {
        res.status(422).json({
          error:
            "This failure predates per-row retry tracking and matches more than one source record (or none) on this case, so we can't safely resend the original content. Re-run the original admin action instead.",
        });
        return;
      }

      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const recipient = caseData.userEmail?.trim();
      if (!recipient) {
        res
          .status(400)
          .json({ error: "This case has no email address on file" });
        return;
      }

      const adminUser = await resolveAdminUsernameFromReq(req);
      const userName = (caseData.userName ?? "").trim() || recipient;
      const caseRef = caseData.id;

      // Respond immediately; SMTP dispatch runs in the background to keep
      // the dashboard click instant even if the mail server is slow.
      res.json({
        success: true,
        emailDispatched: true,
        tag,
        message:
          "Retry queued for delivery — check the audit log for the final status.",
      });

      void (async () => {
        try {
          const { emailService } = await import("../services/EmailService");
          const { sendCaseEmailWithAudit } = await import(
            "../services/emailNotify"
          );

          await sendCaseEmailWithAudit({
            to: recipient,
            caseId,
            tag,
            adminUser,
            // Task #158 — propagate the source-record metadata onto
            // the retry's own audit row so that if this retry also
            // fails, a *subsequent* retry still resolves the original
            // record (not the latest matching one). Without this,
            // repeated retries silently degrade to "latest row" on
            // their second attempt, reintroducing the exact bug this
            // task fixes.
            metadata:
              (auditRow.metadata as Record<string, unknown> | null) ?? null,
            send: async (locale) => {
              switch (tag) {
                case "letter-ready":
                  return emailService.sendLetterReadyEmail(
                    recipient,
                    userName,
                    caseRef,
                  );
                case "letter-reissued": {
                  const active = await storage.getActiveLetterReissue(caseId);
                  if (!active) {
                    return {
                      success: false,
                      error:
                        "No active letter-reissue round on this case to resend.",
                    };
                  }
                  return emailService.sendLetterReissuedEmail(
                    recipient,
                    userName,
                    caseRef,
                    active.version,
                    active.reissueFee,
                    active.reason ?? null,
                  );
                }
                case "payout-wallet-set":
                case "payout-wallet-changed": {
                  if (!caseData.payoutWalletAddress) {
                    return {
                      success: false,
                      error:
                        "Payout wallet is no longer set on this case — nothing to resend.",
                    };
                  }
                  return emailService.sendPayoutWalletEmail(
                    recipient,
                    userName,
                    caseRef,
                    {
                      address: caseData.payoutWalletAddress,
                      asset: caseData.payoutWalletAsset,
                      network: caseData.payoutWalletNetwork,
                      isFirstSet: tag === "payout-wallet-set",
                    },
                  );
                }
                case "declaration-assigned":
                  return emailService.sendDeclarationAssignedEmail(
                    recipient,
                    userName,
                    caseRef,
                  );
                case "declaration-approved":
                  return emailService.sendDeclarationApprovedEmail(
                    recipient,
                    userName,
                    caseRef,
                  );
                case "submission-received": {
                  const submissions = await storage.getSubmissionsByCaseId(
                    caseId,
                  );
                  const latest = submissions?.[0];
                  if (!latest) {
                    return {
                      success: false,
                      error:
                        "No submission on file for this case to resend.",
                    };
                  }
                  return emailService.sendSubmissionReceivedEmail(
                    recipient,
                    userName,
                    caseRef,
                    latest.selectedOption,
                    latest.withdrawalAmount ?? null,
                  );
                }
                case "declaration-rejected": {
                  // Task #158 — prefer the foreign key stamped on the
                  // audit row at the moment of the original send so we
                  // resend THIS rejection's notes. Legacy rows without
                  // metadata still fall back to "latest rejected".
                  const meta = (auditRow.metadata as
                    | { declarationSubmissionId?: number; reviewerNotes?: string | null }
                    | null) ?? null;
                  let target: { reviewerNotes: string | null } | null = null;
                  if (meta?.declarationSubmissionId) {
                    const row = await storage.getDeclarationSubmissionById(
                      meta.declarationSubmissionId,
                    );
                    if (row && row.caseId === caseId) {
                      target = {
                        reviewerNotes:
                          meta.reviewerNotes ?? row.reviewerNotes ?? null,
                      };
                    }
                  }
                  if (!target) {
                    const subs = await storage.getDeclarationSubmissionsByCaseId(
                      caseId,
                    );
                    const latestRejected = subs.find(
                      (s) => s.status === "rejected",
                    );
                    if (latestRejected) {
                      target = { reviewerNotes: latestRejected.reviewerNotes ?? null };
                    }
                  }
                  if (!target) {
                    return {
                      success: false,
                      error:
                        "No rejected declaration submission on file for this case to resend.",
                    };
                  }
                  return emailService.sendLocalizedCaseEmail({
                    to: recipient,
                    userName,
                    caseRef,
                    locale: caseData.preferredLocale ?? locale,
                    templateKey: "declarationRejected",
                    ctaPath: "/portal?view=declaration",
                    logTag: "declaration-rejected",
                    vars: { notes: target.reviewerNotes ?? "" },
                  });
                }
                case "compliance-message": {
                  // Task #158 — load the exact original message by id
                  // when stamped on the audit row, else fall back to
                  // the most recent compliance message on the case.
                  const meta = (auditRow.metadata as
                    | { adminMessageId?: number }
                    | null) ?? null;
                  let latest = meta?.adminMessageId
                    ? await storage.getAdminMessageById(meta.adminMessageId)
                    : undefined;
                  if (latest && latest.caseId !== caseId) latest = undefined;
                  if (!latest) {
                    const msgs = await storage.getAdminMessagesByCaseId(caseId);
                    latest = msgs?.[0];
                  }
                  if (!latest) {
                    return {
                      success: false,
                      error:
                        "No compliance message on file for this case to resend.",
                    };
                  }
                  return emailService.sendLocalizedCaseEmail({
                    to: recipient,
                    userName,
                    caseRef,
                    locale: caseData.preferredLocale ?? locale,
                    templateKey: "complianceMessage",
                    ctaPath: "/portal?view=messages",
                    logTag: "compliance-message",
                    vars: {
                      category: latest.category,
                      title: latest.title,
                      body: latest.body,
                    },
                  });
                }
                case "document-requested": {
                  // Task #158 — KYC bundle emails have hardcoded copy
                  // and don't map to one document row; detect via
                  // metadata.kycIdBundle and replay the canonical body.
                  const meta = (auditRow.metadata as
                    | {
                        documentRequestId?: number;
                        kycIdBundle?: boolean;
                      }
                    | null) ?? null;
                  if (meta?.kycIdBundle) {
                    return emailService.sendLocalizedCaseEmail({
                      to: recipient,
                      userName,
                      caseRef,
                      locale: caseData.preferredLocale ?? locale,
                      templateKey: "documentRequested",
                      ctaPath: "/portal?view=documents",
                      logTag: "document-requested",
                      vars: {
                        documentType:
                          "KYC Identity Verification (4 documents)",
                        description:
                          "Please upload all four KYC documents from the Documents section of your portal: ID Front, ID Back, Selfie holding ID Front, and Selfie holding ID Back.",
                        deadline: "",
                      },
                    });
                  }
                  let latest = meta?.documentRequestId
                    ? await storage.getDocumentRequestById(
                        meta.documentRequestId,
                      )
                    : undefined;
                  if (latest && latest.caseId !== caseId) latest = undefined;
                  if (!latest) {
                    const reqs = await storage.getDocumentRequestsByCaseId(
                      caseId,
                    );
                    latest = reqs.find((r) => r.status === "pending");
                  }
                  if (!latest) {
                    return {
                      success: false,
                      error:
                        "No pending document request on file for this case to resend.",
                    };
                  }
                  return emailService.sendLocalizedCaseEmail({
                    to: recipient,
                    userName,
                    caseRef,
                    locale: caseData.preferredLocale ?? locale,
                    templateKey: "documentRequested",
                    ctaPath: "/portal?view=documents",
                    logTag: "document-requested",
                    vars: {
                      documentType: latest.documentType,
                      description: latest.description ?? "",
                      deadline: latest.deadline
                        ? latest.deadline.toISOString()
                        : "",
                    },
                  });
                }
                case "document-approved":
                case "document-rejected": {
                  const targetStatus =
                    tag === "document-approved" ? "approved" : "rejected";
                  // Task #158 — load the exact reviewed request by id
                  // and prefer the snapshotted notes (admin may have
                  // since edited document_requests.adminNotes).
                  const meta = (auditRow.metadata as
                    | { documentRequestId?: number; notes?: string | null }
                    | null) ?? null;
                  let latest = meta?.documentRequestId
                    ? await storage.getDocumentRequestById(
                        meta.documentRequestId,
                      )
                    : undefined;
                  if (latest && latest.caseId !== caseId) latest = undefined;
                  let notesOverride: string | null | undefined = meta?.notes;
                  if (!latest) {
                    const reqs = await storage.getDocumentRequestsByCaseId(
                      caseId,
                    );
                    latest = reqs.find((r) => r.status === targetStatus);
                    notesOverride = undefined;
                  }
                  if (!latest) {
                    return {
                      success: false,
                      error: `No ${targetStatus} document request on file for this case to resend.`,
                    };
                  }
                  const notes =
                    notesOverride !== undefined
                      ? notesOverride ?? ""
                      : latest.adminNotes ?? "";
                  return emailService.sendLocalizedCaseEmail({
                    to: recipient,
                    userName,
                    caseRef,
                    locale: caseData.preferredLocale ?? locale,
                    templateKey:
                      tag === "document-approved"
                        ? "documentApproved"
                        : "documentRejected",
                    ctaPath: "/portal?view=documents",
                    logTag: tag,
                    vars: {
                      documentType: latest.documentType,
                      notes,
                    },
                  });
                }
                case "reissue-receipt-approved":
                case "reissue-receipt-rejected": {
                  const targetStatus =
                    tag === "reissue-receipt-approved"
                      ? "approved"
                      : "rejected";
                  // Task #158 — load the exact receipt + round stamped
                  // on the audit row. For the approved case the
                  // round's version + fee are also snapshotted in
                  // metadata so the retry resends the values that
                  // were in effect at the moment of the original send.
                  const meta = (auditRow.metadata as
                    | {
                        depositReceiptId?: number;
                        letterReissueId?: number;
                        version?: number;
                        reissueFee?: string | number;
                        notes?: string | null;
                      }
                    | null) ?? null;
                  let latest = meta?.depositReceiptId
                    ? await storage.getDepositReceiptById(
                        meta.depositReceiptId,
                      )
                    : undefined;
                  if (latest && latest.caseId !== caseId) latest = undefined;
                  if (!latest) {
                    const receipts =
                      await storage.getDepositReceiptsByCaseId(caseId);
                    latest = receipts.find(
                      (r) => r.reissueId && r.status === targetStatus,
                    );
                  }
                  if (!latest || !latest.reissueId) {
                    return {
                      success: false,
                      error: `No ${targetStatus} reissue receipt on file for this case to resend.`,
                    };
                  }
                  const round = await storage.getLetterReissueById(
                    meta?.letterReissueId ?? latest.reissueId,
                  );
                  if (!round) {
                    return {
                      success: false,
                      error:
                        "Reissue round for the matching receipt is no longer on file.",
                    };
                  }
                  return emailService.sendLocalizedCaseEmail({
                    to: recipient,
                    userName,
                    caseRef,
                    locale: caseData.preferredLocale ?? locale,
                    templateKey:
                      tag === "reissue-receipt-approved"
                        ? "reissueApproved"
                        : "reissueRejected",
                    ctaPath:
                      tag === "reissue-receipt-approved"
                        ? "/portal?view=letter"
                        : "/portal?view=deposit",
                    logTag: tag,
                    vars:
                      tag === "reissue-receipt-approved"
                        ? {
                            version:
                              typeof meta?.version === "number"
                                ? meta.version
                                : round.version,
                            reissueFee:
                              meta?.reissueFee != null
                                ? String(meta.reissueFee)
                                : round.reissueFee,
                          }
                        : {
                            notes:
                              meta?.notes !== undefined
                                ? meta.notes ?? ""
                                : latest.adminNotes ?? "",
                          },
                  });
                }
                case "account_reactivation": {
                  if (!caseData.accessCode) {
                    return {
                      success: false,
                      error:
                        "No active access code on this case to resend.",
                    };
                  }
                  const ok =
                    await emailService.sendAccountReactivationNotification(
                      recipient,
                      userName,
                      caseData.accessCode,
                      locale,
                    );
                  return ok
                    ? { success: true }
                    : {
                        success: false,
                        error: "Email could not be delivered.",
                      };
                }
                case "portal_warning": {
                  // Prefer the minutes + message snapshotted in metadata at
                  // the time of the original send; fall back to the case's
                  // current portalWarningMinutes/portalWarningMessage if the
                  // audit row pre-dates metadata stamping.
                  const meta = (auditRow.metadata as
                    | { minutes?: number; emailMessage?: string | null }
                    | null) ?? null;
                  const warningMinutes =
                    (typeof meta?.minutes === "number" ? meta.minutes : null) ??
                    caseData.portalWarningMinutes;
                  if (!warningMinutes) {
                    return {
                      success: false,
                      error:
                        "No portal warning duration on file for this case — re-run the original admin action.",
                    };
                  }
                  const warningMessage =
                    meta?.emailMessage !== undefined
                      ? (meta.emailMessage ?? "")
                      : (caseData.portalWarningMessage ?? "");
                  return emailService.sendPortalWarning(
                    recipient,
                    userName,
                    warningMinutes,
                    warningMessage,
                    caseData.preferredLocale ?? locale,
                  );
                }
                default:
                  return {
                    success: false,
                    error: `Unsupported retry tag: ${tag}`,
                  };
              }
            },
          });
        } catch (err) {
          warnOnce("cases:retry-audit-email-dispatch-failed", "Retry audit email dispatch failed:", err);
        }
      })();
    } catch (error) {
      warnOnce("cases:retry-email-audit-log-error", "Retry email-audit-log error:", error);
      res.status(500).json({ error: "Failed to retry email" });
    }
  },
);

// ============================================================================
// Declaration of Compliance — portal endpoints (no admin auth)
// Access is gated by the per-case access code embedded in the path segment.
// ============================================================================

// User self-issues their declaration access code AFTER they have read and
// accepted the international regulatory terms inside the form. We only ever
// hand out the code that the admin has already minted on this case so that
// admins remain in control of which cases are eligible.
casesRouter.post("/:id/declaration-access-code/issue", requirePortalAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const caseRow = await storage.getCaseById(id);
    if (!caseRow) return res.status(404).json({ error: "Case not found" });
    if (caseRow.declarationStatus !== "pending") {
      return res
        .status(403)
        .json({ error: "Declaration is not currently active for this case" });
    }
    if (req.body?.termsAccepted !== true) {
      return res
        .status(400)
        .json({ error: "You must accept the regulatory terms first" });
    }
    let code = caseRow.declarationAccessCode ?? null;
    if (!code) {
      code = crypto.randomInt(10000000, 100000000).toString();
      await storage.updateCase(id, { declarationAccessCode: code });
    }
    res.json({ accessCode: code });
  } catch (error) {
    warnOnce("cases:issue-declaration-access-code-error", "Issue declaration access code error:", error);
    res.status(500).json({ error: "Failed to issue access code" });
  }
});

casesRouter.get("/:id/declaration", async (req, res) => {
  const { id } = req.params;
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const userAgent =
    typeof req.headers["user-agent"] === "string"
      ? req.headers["user-agent"]
      : null;

  // Fire-and-forget audit + rate-limit bookkeeping for any 401 path. Records
  // a single audit row per failed attempt with enough metadata to spot
  // brute-force scans (IP, UA, attempted case id, which credential type was
  // tried) and bumps the per-IP failure counter. Bookkeeping is best-effort:
  // a DB blip must never break the response path.
  const denyAndAudit = async (
    credentialType:
      | "none"
      | "wrong_session"
      | "wrong_code"
      | "expired_code"
      | "case_missing",
  ) => {
    storage
      .createAuditLog({
        adminUsername: "Unknown",
        action: "declaration_read_unauthorized",
        targetType: "case",
        targetId: id,
        ipAddress: clientIp,
        userAgent,
        newValue: JSON.stringify({ credentialType }),
      })
      .catch((err) =>
        warnOnce(
          "cases:failed-to-write-unauthorized-audit-log",
          "[declaration-read] failed to write unauthorized audit log:",
          err,
        ),
      );
    const bucket = await recordDeclarationReadFailure(clientIp, id, userAgent);
    maybeFireDeclarationScanAlert(bucket, clientIp, id, "threshold");
    return res.status(401).json({ error: "Unauthorized" });
  };

  try {
    // IP-level rate limit kicks in *before* any work is done. Once an IP
    // has tripped the failure threshold every subsequent declaration GET
    // from that IP — even one with valid creds — gets a 429 until the
    // lockout window passes. Mirrors the /access/:code limiter.
    const rateCheck = await checkDeclarationReadRateLimit(clientIp);
    if (!rateCheck.allowed) {
      // Audit the throttled attempt too so the dashboard can see when an
      // IP is sustaining a brute-force scan past the lockout threshold.
      storage
        .createAuditLog({
          adminUsername: "Unknown",
          action: "declaration_read_rate_limited",
          targetType: "case",
          targetId: id,
          ipAddress: clientIp,
          userAgent,
          newValue: JSON.stringify({ retryAfter: rateCheck.retryAfter }),
        })
        .catch(() => {});
      // Reach into the bucket to fire a (debounced) security alert.
      // Throttling itself is a clear signal of an active brute-force scan,
      // so we always escalate even if the count thresholds wouldn't have.
      const throttledBucket = declarationReadAttempts.get(clientIp);
      if (throttledBucket) {
        if (userAgent !== undefined) throttledBucket.lastUserAgent = userAgent;
        throttledBucket.caseIds.add(id);
        maybeFireDeclarationScanAlert(
          throttledBucket,
          clientIp,
          id,
          "rate_limited",
        );
      }
      res.setHeader("Retry-After", String(rateCheck.retryAfter ?? 60));
      return res.status(429).json({
        error: "Too many failed attempts. Please try again later.",
        retryAfter: rateCheck.retryAfter,
      });
    }

    // Authorize FIRST so unauthenticated callers can't even confirm a case
    // exists by ID. The endpoint exposes declaration metadata + inline
    // attachment filenames, which is sensitive — a leaked case ID alone
    // must not be enough to read it. Two accepted credentials:
    //   1) A live portal session whose caseId matches the URL :id.
    //   2) The case's declarationAccessCode, supplied via either the
    //      `x-declaration-access-code` header or the `?accessCode=`
    //      query string (covers the email-link "fill the declaration"
    //      flow before the user has a portal session).
    const { validatePortalSession } = await import("../services/portal-auth");
    const portalToken = req.headers["x-portal-session-token"];
    const portalTokenStr = Array.isArray(portalToken)
      ? portalToken[0]
      : portalToken;
    const portalSession =
      typeof portalTokenStr === "string" && portalTokenStr.length > 0
        ? await validatePortalSession(portalTokenStr)
        : null;
    const headerCode = req.headers["x-declaration-access-code"];
    const headerCodeStr = Array.isArray(headerCode) ? headerCode[0] : headerCode;
    const queryCode =
      typeof req.query?.accessCode === "string" ? req.query.accessCode : null;
    const suppliedDeclarationCode =
      (typeof headerCodeStr === "string" ? headerCodeStr : null) ?? queryCode;
    const sessionTokenSupplied =
      typeof portalTokenStr === "string" && portalTokenStr.length > 0;
    const codeSupplied =
      typeof suppliedDeclarationCode === "string" &&
      suppliedDeclarationCode.length > 0;

    const caseRow = await storage.getCaseById(id);
    if (!caseRow) {
      // Don't disclose whether the case exists when the caller couldn't
      // even produce a session token. A logged-in caller (whose session
      // simply doesn't match this caseId) gets the same 401 below.
      return await denyAndAudit("case_missing");
    }
    const sessionMatches =
      portalSession !== null && portalSession.caseId === id;
    // Code-based auth must also respect the per-case expiry window so a
    // leaked code can't retain read access indefinitely. Session-based
    // auth has its own TTL inside the session store and is unaffected.
    const codeNotExpired =
      caseRow.declarationAccessExpiresAt == null ||
      new Date(caseRow.declarationAccessExpiresAt).getTime() > Date.now();
    const codeRawMatches =
      codeSupplied &&
      caseRow.declarationAccessCode != null &&
      suppliedDeclarationCode!.trim() === caseRow.declarationAccessCode;
    const declarationCodeMatches = codeRawMatches && codeNotExpired;
    if (!sessionMatches && !declarationCodeMatches) {
      // Classify the failure so the audit row is useful: a code that
      // matches-but-is-expired is meaningfully different from a wrong
      // code, and a wrong session token is different from no creds.
      let credentialType:
        | "none"
        | "wrong_session"
        | "wrong_code"
        | "expired_code";
      if (codeSupplied && codeRawMatches && !codeNotExpired) {
        credentialType = "expired_code";
      } else if (codeSupplied) {
        credentialType = "wrong_code";
      } else if (sessionTokenSupplied) {
        credentialType = "wrong_session";
      } else {
        credentialType = "none";
      }
      return await denyAndAudit(credentialType);
    }
    const latest = await storage.getLatestDeclarationByCase(id);
    // Return only the minimal fields the user needs to render their own status
    // panel — never the full PII payload (full PII is admin-only via
    // /api/admin/cases/:id/declaration-submissions).
    const sanitizedLatest = latest
      ? {
          id: latest.id,
          status: latest.status,
          submittedAt: latest.submittedAt,
          reviewerNotes:
            latest.status === "rejected" ? latest.reviewerNotes ?? null : null,
        }
      : null;
    // Pull any inline attachments uploaded as part of the declaration so
    // the portal can render a read-only summary alongside the status panel.
    let attachments: Array<{
      id: number;
      documentType: string;
      category: "proof_of_income" | "custom";
      submittedFileName: string | null;
      status: string;
      submittedAt: Date | null;
    }> = [];
    try {
      const docs = await storage.getDocumentRequestsByCaseId(id);
      attachments = docs
        .filter((d) =>
          (d.documentType ?? "").startsWith(DECLARATION_DOC_PREFIX),
        )
        .map((d) => ({
          id: d.id,
          documentType: d.documentType,
          category:
            d.documentType === DECLARATION_PSOI_TYPE
              ? ("proof_of_income" as const)
              : ("custom" as const),
          submittedFileName: d.submittedFileName ?? null,
          status: d.status ?? "submitted",
          submittedAt: d.submittedAt ?? null,
        }));
    } catch (err) {
      warnOnce("cases:declaration-attachments-fail", "Fetch declaration attachments error:", err);
    }

    res.json({
      declarationStatus: caseRow.declarationStatus ?? "not_requested",
      declarationRequestedAt: caseRow.declarationRequestedAt,
      latest: sanitizedLatest,
      attachments,
    });
  } catch (error) {
    warnOnce("cases:get-declaration-fail", "Get declaration (portal) error:", error);
    res.status(500).json({ error: "Failed to fetch declaration" });
  }
});

casesRouter.post("/:id/declaration", async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";

    // Per-IP rate limit on the write path — mirrors the read-path throttle.
    // Check before any DB work so a locked IP gets no information about the
    // case state.
    const writeRateCheck = await checkDeclarationWriteRateLimit(clientIp);
    if (!writeRateCheck.allowed) {
      res.setHeader("Retry-After", String(writeRateCheck.retryAfter ?? 60));
      return res.status(429).json({
        error: "Too many failed attempts. Please try again later.",
        retryAfter: writeRateCheck.retryAfter,
      });
    }

    const caseRow = await storage.getCaseById(id);
    if (!caseRow) return res.status(404).json({ error: "Case not found" });
    if (caseRow.declarationStatus !== "pending") {
      return res
        .status(403)
        .json({ error: "Declaration not currently requested for this case" });
    }

    const parsed = insertDeclarationSubmissionSchema.parse({
      ...req.body,
      caseId: id,
    });

    // Validate access code against the per-case code the admin issued.
    // Cases that predate per-case codes (declarationAccessCode is null) must
    // have a code minted via the /declaration-access-code/issue endpoint before
    // they can submit — the legacy universal fallback has been removed.
    if (!caseRow.declarationAccessCode) {
      return res.status(403).json({
        error:
          "No declaration access code has been issued for this case. Please contact your compliance officer.",
      });
    }
    // strict-inequality-guard: must stay !== (not !=) — loose equality would
    // coerce types and could allow a numeric 0 / empty-string bypass.
    if (parsed.accessCode.trim() !== caseRow.declarationAccessCode) {
      // Record the failure so sustained guessing trips the rate limiter.
      await recordDeclarationWriteFailure(clientIp);
      return res.status(403).json({ error: "Invalid access code" });
    }

    // Enforce 24-hour validity on the declaration access window. Cases that
    // were issued a code without an expiry timestamp (older cases predating
    // this field) are not gated by it.
    if (
      caseRow.declarationAccessExpiresAt &&
      caseRow.declarationAccessExpiresAt.getTime() < Date.now()
    ) {
      return res.status(403).json({
        error:
          "This access code has expired. The 24-hour declaration window has closed — please ask your compliance officer to issue a new code.",
      });
    }

    // All four sanctions toggles + regulatory ack must be true.
    const requiredTrue: Array<keyof typeof parsed> = [
      "notSanctionedJurisdictions",
      "noSanctionedTransactions",
      "acknowledgeUsdtNotSupported",
      "understandFalseInfoConsequences",
      "regulatoryAcknowledgment",
    ];
    for (const k of requiredTrue) {
      if (parsed[k] !== true) {
        return res.status(400).json({
          error: `Field ${String(k)} must be confirmed`,
        });
      }
    }

    // Conditional: when the user picked "Other" (in any of the multi-select
    // sources) they must also describe it.
    const sourcesRaw = parsed.sourceOfIncome ?? "";
    const includesOther = sourcesRaw
      .split(",")
      .map((s) => s.trim())
      .includes("Other (please specify)");
    if (
      includesOther &&
      (!parsed.sourceOfIncomeOther || parsed.sourceOfIncomeOther.trim().length === 0)
    ) {
      return res.status(400).json({
        error: "sourceOfIncomeOther is required when 'Other (please specify)' is one of the selected sources",
      });
    }

    // Monthly income band is required for compliance review.
    if (!parsed.monthlyIncome || parsed.monthlyIncome.trim().length === 0) {
      return res.status(400).json({
        error: "monthlyIncome is required",
      });
    }

    // International regulatory terms acceptance — must be confirmed.
    if (parsed.internationalTermsAcknowledged !== true) {
      return res.status(400).json({
        error: "internationalTermsAcknowledged must be confirmed",
      });
    }

    // Processing fee transaction hash is mandatory — the 1500 USDT deposit
    // serves as both the processing fee and the on-chain proof of acceptance
    // of the international regulatory terms.
    if (
      !parsed.processingFeeTxHash ||
      parsed.processingFeeTxHash.trim().length < 10
    ) {
      return res.status(400).json({
        error: "processingFeeTxHash is required (1500 USDT deposit transaction hash)",
      });
    }

    // Inline attachments (Proof of Source of Income + up to 3 supporting
    // financial docs). Validate BEFORE creating the declaration submission so
    // a bad payload doesn't leave us with a half-created declaration. The
    // PSOI slot is required; supporting docs are optional and capped.
    const rawAttachments = Array.isArray(req.body?.declarationAttachments)
      ? req.body.declarationAttachments
      : [];
    let attachments: DeclarationAttachmentInput[] = [];
    if (rawAttachments.length > 0) {
      try {
        attachments = z
          .array(declarationAttachmentSchema)
          .parse(rawAttachments);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid request" });
        }
        throw err;
      }
    }
    const psoiCount = attachments.filter(
      (a) => a.category === "proof_of_income",
    ).length;
    const supportingCount = attachments.filter(
      (a) => a.category === "custom",
    ).length;
    if (psoiCount !== 1) {
      return res.status(400).json({
        error:
          "Proof of Source of Income document is required (exactly one).",
      });
    }
    if (supportingCount > MAX_DECLARATION_SUPPORTING) {
      return res.status(400).json({
        error: `At most ${MAX_DECLARATION_SUPPORTING} supporting documents may be attached.`,
      });
    }
    for (const att of attachments) {
      const check = validateDocumentDataUrl(att.fileData);
      if (!check.ok) {
        return res
          .status(400)
          .json({ error: `Attachment "${att.fileName}": ${check.error}` });
      }
      // Prevent a custom-labeled supporting doc from colliding with the
      // canonical PSOI documentType, which would mis-tag it on GET.
      if (
        att.category === "custom" &&
        `${DECLARATION_DOC_PREFIX}${(att.label ?? "").trim()}`.toLowerCase() ===
          DECLARATION_PSOI_TYPE.toLowerCase()
      ) {
        return res.status(400).json({
          error: `Supporting document label "${att.label}" conflicts with the Proof of Source of Income slot. Please rename it.`,
        });
      }
    }

    const submission = await storage.createDeclarationSubmission({
      ...parsed,
      // Stamp the canonical fee details so admins always see the expected amount
      // and network alongside the user-supplied transaction hash.
      processingFeeAmount: parsed.processingFeeAmount ?? "1500 USDT",
      processingFeeNetwork: parsed.processingFeeNetwork ?? "TRC20",
      ipAddress: req.ip ?? req.socket.remoteAddress ?? undefined,
      userAgent: req.headers["user-agent"] ?? undefined,
    });

    // Persist attachments as document_requests rows in the 'submitted' state
    // so they immediately appear in the admin doc-review queue alongside any
    // admin-requested documents. Failures are surfaced explicitly in the
    // response (non-atomic with the declaration submission, but the client
    // toasts a warning so the user can re-upload from the Documents view).
    const createdAttachments: number[] = [];
    const attachmentFailures: Array<{ fileName: string; error: string }> = [];
    for (const att of attachments) {
      try {
        const documentType =
          att.category === "proof_of_income"
            ? DECLARATION_PSOI_TYPE
            : `${DECLARATION_DOC_PREFIX}${(att.label ?? "Supporting Document").trim() || "Supporting Document"}`;
        // Task #173 — wrap each attachment's row insert + audit in a
        // per-item transaction. An audit-write failure rolls back the
        // document_requests row for that single attachment (preserving
        // partial-success semantics across the loop) so we never leave
        // an un-audited submitted document on the case.
        const created = await storage.runInTransaction(async (tx) => {
          const row = await storage.createDocumentRequest({
            caseId: id,
            documentType,
            description:
              att.category === "proof_of_income"
                ? "Uploaded inline with the Declaration of Compliance."
                : `Supporting financial document uploaded inline with the Declaration of Compliance${att.label ? ` — ${att.label}` : ""}.`,
            status: "submitted",
            submittedFileData: att.fileData,
            submittedFileName: att.fileName,
            submittedAt: new Date(),
          }, tx);
          await storage.createAuditLog({
            action: "document_submitted",
            newValue: `Declaration attachment "${att.fileName}" stored as "${documentType}" (#${row.id})`,
            adminUsername: "system",
            targetType: "case",
            targetId: id,
          }, tx);
          return row;
        });
        createdAttachments.push(created.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnOnce("cases:declaration-attachment-create-failed", "[cases] declaration attachment create failed:", err);
        attachmentFailures.push({ fileName: att.fileName, error: message });
        try {
          await storage.createAuditLog({
            action: "document_submission_failed",
            newValue: `Declaration attachment "${att.fileName}" failed to persist: ${message}`,
            adminUsername: "system",
            targetType: "case",
            targetId: id,
          });
        } catch (logErr) {
          warnOnce("cases:declaration-attachment-failure-audit-failed", "[cases] declaration attachment failure audit failed:", logErr);
        }
      }
    }

    await storage.updateCase(id, { declarationStatus: "submitted" });

    res.json({
      success: true,
      submission,
      attachmentsCreated: createdAttachments.length,
      attachmentFailures,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request" });
    }
    warnOnce("cases:submit-declaration-error", "Submit declaration error:", error);
    res.status(500).json({ error: "Failed to submit declaration" });
  }
});

/* ====================================================================
   Sealed Settlement & NDA — endpoints (Task #32)
   ====================================================================
   - GET    /:id/nda            (portal) → unsigned preview OR already-signed metadata
   - POST   /:id/nda/sign       (portal) → idempotent; second call returns existing record
   - GET    /:id/nda/pdf        (portal or admin) → re-download signed (or preview) PDF
   - POST   /:id/nda/override-seal (admin) → unlock a sealed case; requires reason
   ==================================================================== */

const ndaSignSchema = z.object({
  typedName: z.string().trim().min(2).max(120),
  agreed: z.literal(true),
  // Optional per-document locale override. Lets a bilingual recipient
  // sign in a different language than their portal chrome (the global
  // LanguageSwitcher is separate). Normalised server-side via
  // normalizeNdaLocale so any unknown value falls back to English.
  locale: z.string().trim().min(2).max(16).optional(),
});

const ndaOverrideSchema = z.object({
  reason: z.string().trim().min(8).max(2000),
});

casesRouter.get("/:id/nda", requirePortalSessionOnly, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const stage = parseInt(caseData.withdrawalStage || "1", 10);
    if (!Number.isFinite(stage) || stage < 14) {
      res.status(409).json({
        error:
          "The Sealed Settlement & NDA only becomes available once the case reaches the final stage.",
        eligible: false,
      });
      return;
    }

    // Admin has turned the NDA requirement OFF for this case. We still
    // return `eligible:true` so the portal can render the bypass card
    // (and any historical signed snapshot remains downloadable via the
    // admin-only PDF endpoint), but we short-circuit before rendering a
    // fresh preview so users never see a sign-now CTA they shouldn't.
    if (caseData.ndaEnabled === false) {
      res.json({
        eligible: true,
        ndaSkipped: true,
        signed: false,
        sealed: !!caseData.sealedAt,
        sealedAt: caseData.sealedAt,
        sealedBy: caseData.sealedBy,
      });
      return;
    }

    // After an admin Override Seal, prior case_ndas rows are kept for
    // audit durability but the case is unsealed and the user is
    // entitled to re-sign. The portal therefore only treats the latest
    // signed row as "current" when the case is currently sealed; when
    // unsealed we always serve the unsigned preview so the user can
    // sign again. Historical artifacts remain reachable via the
    // admin-only metadata + PDF endpoints.
    const isCurrentlySealed = !!caseData.sealedAt;
    const existing = isCurrentlySealed
      ? await storage.getCaseNdaByCaseId(req.params.id)
      : undefined;
    const {
      renderNdaForCase,
      buildNdaVarsForSignedCase,
      extractSnapshotLocale,
      NDA_TEMPLATE_VERSION,
    } = await import("../services/NdaService");
    const { renderNda } = await import("../../shared/ndaTemplate");

    if (existing) {
      // Re-render against the snapshot's effective date AND the locale
      // recorded in the snapshot so the on-screen preview matches the
      // bytes the user signed — even if the case's preferred_locale has
      // since changed.
      const effectiveDate = existing.signedAt.toISOString().slice(0, 10);
      const snapshotLocale = extractSnapshotLocale(existing.renderedBody);
      const vars = buildNdaVarsForSignedCase(caseData, effectiveDate, snapshotLocale);
      res.json({
        eligible: true,
        signed: true,
        sealed: true,
        sealedAt: caseData.sealedAt,
        sealedBy: caseData.sealedBy,
        templateVersion: existing.templateVersion,
        contentHash: existing.contentHash,
        signedName: existing.signedName,
        signedAt: existing.signedAt,
        rendered: renderNda(vars),
      });
      try {
        await storage.createAuditLog({
          action: "case_nda_viewed",
          targetType: "case",
          targetId: caseData.id,
          adminUsername: "portal-user",
          newValue: `NDA viewed (signed, hash ${existing.contentHash.slice(0, 12)}…)`,
        });
      } catch {}
      return;
    }

    // Optional ?locale= lets the signing screen preview the document in
    // a different language than the user's persisted portal locale,
    // without mutating cases.preferred_locale (which still drives the
    // rest of the portal chrome + transactional emails). Unknown values
    // fall back to English via normalizeNdaLocale inside buildNdaVarsForCase.
    // When the English-only signing flag is on, the override is ignored
    // and the preview collapses to English regardless of what the client
    // sends. The flag is sourced from the runtime store (Task #61) so an
    // admin toggle takes effect without a redeploy.
    const { effectiveSigningLocale } = await import(
      "../../shared/ndaTemplate"
    );
    const { getNdaSigningLocales } = await import(
      "../services/runtimeFlags"
    );
    const signingLocales = await getNdaSigningLocales();
    const requestedLocale =
      typeof req.query.locale === "string" ? req.query.locale : null;
    let previewLocale = effectiveSigningLocale(
      requestedLocale,
      signingLocales,
    );
    if (previewLocale == null) {
      // Multiple locales approved + no explicit pick: only fall back to
      // the case's preferred locale if it is itself on the allowlist.
      // Otherwise show the English preview so the user can never see (or
      // later attempt to seal in) a non-approved language.
      const { isSigningLocaleAllowed: isAllowed, normalizeNdaLocale: norm } =
        await import("../../shared/ndaTemplate");
      const candidate = norm(caseData.preferredLocale ?? null);
      previewLocale = isAllowed(candidate, signingLocales) ? candidate : "en";
    }
    const rendered = renderNdaForCase(caseData, previewLocale);
    res.json({
      eligible: true,
      signed: false,
      sealed: false,
      templateVersion: NDA_TEMPLATE_VERSION,
      signingLocales,
      rendered,
    });
    try {
      await storage.createAuditLog({
        action: "case_nda_viewed",
        targetType: "case",
        targetId: caseData.id,
        adminUsername: "portal-user",
        newValue: `NDA preview viewed (template ${NDA_TEMPLATE_VERSION})`,
      });
    } catch {}
  } catch (err) {
    warnOnce("cases:get-nda-fail", "GET /cases/:id/nda failed:", err);
    res.status(500).json({ error: "Failed to load NDA" });
  }
});

casesRouter.post("/:id/nda/sign", requirePortalSessionOnly, async (req, res) => {
  try {
    const parsed = ndaSignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Typed name and explicit agreement are required." });
      return;
    }
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const stage = parseInt(caseData.withdrawalStage || "1", 10);
    if (!Number.isFinite(stage) || stage < 14) {
      res.status(409).json({
        error:
          "The Sealed Settlement & NDA only becomes available once the case reaches the final stage.",
      });
      return;
    }

    // NDA disabled for this case by an admin. Refuse to record a new
    // snapshot so the audit trail stays consistent with the toggle —
    // the portal hides the signing form when it sees ndaEnabled=false,
    // but a stale client could still POST here, so guard server-side.
    if (caseData.ndaEnabled === false) {
      res.status(409).json({
        error:
          "An NDA is not required for this case. If this is unexpected, please contact your IBCCF case manager.",
      });
      return;
    }

    // Task #72 — Stamp Duty Deposit gate. When `stampDutyEnabled` is true
    // and `stampDutyStatus !== 'approved'`, refuse to seal the NDA until
    // the user has uploaded a receipt and an admin has approved it. The
    // portal SealedView intercepts to a dedicated stamp-duty sub-view
    // when this condition holds, so a clean client never reaches this
    // branch — but a stale client could still POST here, so we guard
    // server-side as defence-in-depth. Idempotent admin overrides are
    // possible by toggling `stampDutyEnabled` to false on the case.
    const stampDutyRequired =
      caseData.stampDutyEnabled !== false &&
      caseData.stampDutyStatus !== "approved" &&
      !caseData.sealedAt;
    if (stampDutyRequired) {
      try {
        await storage.createAuditLog({
          action: "nda_sealing_blocked_by_stamp_duty",
          targetType: "case",
          targetId: caseData.id,
          adminUsername: "portal-user",
          newValue: `NDA seal attempt blocked — stamp duty status is "${caseData.stampDutyStatus ?? "awaiting_upload"}".`,
        });
      } catch {}
      res.status(409).json({
        code: "stamp_duty_required",
        error:
          "Your Stamp Duty Deposit must be approved before the Sealed Settlement & NDA can be signed. Please upload a payment receipt in the Stamp Duty section of your portal.",
        stampDutyStatus: caseData.stampDutyStatus ?? "awaiting_upload",
      });
      return;
    }

    // Idempotency: a second submission against a still-sealed case
    // returns the current record rather than re-sealing or double-
    // emailing. We pivot on caseData.sealedAt — NOT on the mere
    // existence of a case_ndas row — because after an admin override
    // the historical row is preserved (audit durability) but the
    // case is unsealed and the user is allowed to re-sign a fresh
    // NDA, which will insert a new row.
    if (caseData.sealedAt) {
      const existing = await storage.getCaseNdaByCaseId(req.params.id);
      if (existing) {
        res.status(200).json({
          alreadySigned: true,
          contentHash: existing.contentHash,
          signedAt: existing.signedAt,
          signedName: existing.signedName,
          templateVersion: existing.templateVersion,
        });
        return;
      }
    }

    const {
      buildNdaPdf,
      buildNdaVarsForCase,
      sha256Hex,
      NDA_TEMPLATE_VERSION,
    } = await import("../services/NdaService");
    const { renderNda } = await import("../../shared/ndaTemplate");

    // Honour the per-document locale the user picked on the signing
    // screen (separate from cases.preferred_locale). The snapshot we
    // persist below carries this locale so any future re-render reads
    // it back verbatim and the SHA-256 stays byte-identical.
    // When the English-only signing flag is on the requested locale is
    // ignored server-side and the snapshot is sealed as `en` regardless
    // of what the client sends — defence-in-depth in case a stale client
    // still shows the picker. The flag is sourced from the runtime store
    // (Task #61) so admin toggles take effect immediately.
    const { effectiveSigningLocale, isSigningLocaleAllowed, normalizeNdaLocale } =
      await import("../../shared/ndaTemplate");
    const { getNdaSigningLocales } = await import("../services/runtimeFlags");
    const signingLocales = await getNdaSigningLocales();
    // Defence-in-depth (Task #88): reject seal attempts that ask for a
    // language that is not on the live allowlist. A stale client that
    // still shows a hidden picker option cannot sneak through and
    // produce a snapshot in an unapproved locale.
    const requestedSealedLocale = parsed.data.locale ?? null;
    if (
      requestedSealedLocale != null &&
      !isSigningLocaleAllowed(requestedSealedLocale, signingLocales)
    ) {
      res.status(409).json({
        error:
          "This language is not currently approved for signing. Please refresh the page and choose an approved language.",
        requested: normalizeNdaLocale(requestedSealedLocale),
        allowed: signingLocales,
      });
      return;
    }
    // Resolve the final sealing locale and enforce the allowlist on the
    // result, not just the requested value. If the client omits `locale`
    // we still need to make sure the downstream fallback chain
    // (preferredLocale → 'en' inside buildNdaVarsForCase) does NOT pick
    // a language the admins have not approved. We compute the candidate
    // explicitly here and clamp to English when it isn't allowed.
    let sealedLocale = effectiveSigningLocale(
      requestedSealedLocale,
      signingLocales,
    );
    if (sealedLocale == null) {
      const candidate = normalizeNdaLocale(caseData.preferredLocale ?? null);
      sealedLocale = isSigningLocaleAllowed(candidate, signingLocales)
        ? candidate
        : "en";
    }
    const vars = buildNdaVarsForCase(caseData, sealedLocale);
    const rendered = renderNda(vars);

    const signedAt = new Date();
    const ip = (req.ip ?? req.socket.remoteAddress ?? "").toString().replace(/^::ffff:/, "");
    const ua = (req.headers["user-agent"] ?? "").toString().slice(0, 1000);

    // Single deterministic render — the integrity hash is the SHA-256 of
    // the resulting bytes. It is intentionally NOT embedded inside the
    // PDF (a self-referential hash is a fixed-point problem and would
    // make the stored value diverge from what the document claims).
    // We surface the hash externally instead: on the case_ndas row, in
    // the audit log, in the cover email body, and in the admin Sealed
    // banner. Re-rendering the same snapshot via GET /:id/nda/pdf must
    // therefore hash to exactly the stored value.
    const finalPdf = await buildNdaPdf(rendered, {
      signedName: parsed.data.typedName,
      signedAt,
      signedIp: ip || null,
      signedUserAgent: ua || null,
    });
    const contentHash = sha256Hex(finalPdf);

    // Snapshot the rendered body so disputes are resolvable from the
    // database alone — never from a "diff against live source" exercise.
    const renderedBody = JSON.stringify(rendered);

    // Task #173 — seal the case, snapshot the NDA, and write the three
    // audit milestones atomically. An audit-write failure must roll back
    // both the case_ndas insert and the cases.sealedAt flip so the user
    // can re-sign cleanly rather than be stuck with a half-sealed row.
    let created: Awaited<ReturnType<typeof storage.createCaseNda>>;
    try {
      created = await storage.runInTransaction(async (tx) => {
        const ndaRow = await storage.createCaseNda({
          caseId: caseData.id,
          templateVersion: NDA_TEMPLATE_VERSION,
          renderedBody,
          signedName: parsed.data.typedName,
          signedAt,
          signedIp: ip || null,
          signedUserAgent: ua || null,
          signedPdfBase64: finalPdf.toString("base64"),
          contentHash,
        }, tx);
        await caseService.updateCase(caseData.id, {
          sealedAt: signedAt,
          sealedBy: `user:${parsed.data.typedName}`,
          status: "sealed",
        }, tx);
        await storage.createAuditLog({
          action: "nda_generated",
          targetType: "case",
          targetId: caseData.id,
          adminUsername: "portal-user",
          newValue: `NDA snapshot generated (template ${NDA_TEMPLATE_VERSION}, hash ${contentHash})`,
        }, tx);
        await storage.createAuditLog({
          action: "nda_signed",
          targetType: "case",
          targetId: caseData.id,
          adminUsername: "portal-user",
          newValue: `NDA signed by ${parsed.data.typedName} at ${signedAt.toISOString()} (hash ${contentHash}, locale ${rendered.locale})`,
        }, tx);
        await storage.createAuditLog({
          action: "case_sealed",
          targetType: "case",
          targetId: caseData.id,
          adminUsername: "portal-user",
          newValue: `Case sealed via signed NDA (hash ${contentHash}, template ${NDA_TEMPLATE_VERSION})`,
        }, tx);
        return ndaRow;
      });
    } catch (txErr) {
      warnOnce("cases:nda-sign-transaction-failed", "nda/sign transaction failed:", txErr);
      res.status(500).json({ error: "Failed to record signature" });
      return;
    }

    // Best-effort cover email with the signed PDF attached.
    if (caseData.userEmail) {
      (async () => {
        try {
          const [{ emailService }, { sendCaseEmailWithAudit }] = await Promise.all([
            import("../services/EmailService"),
            import("../services/emailNotify"),
          ]);
          const userName = (caseData.userName ?? "").trim() || caseData.userEmail!;
          await sendCaseEmailWithAudit({
            to: caseData.userEmail!,
            caseId: caseData.id,
            tag: "settlement_sealed",
            adminUser: "system",
            send: (locale) =>
              emailService.sendSettlementSealedEmail({
                to: caseData.userEmail!,
                userName,
                caseRef: caseData.id,
                contentHash,
                signedAt,
                pdfBuffer: finalPdf,
                locale,
              }),
          });
        } catch (err) {
          warnOnce("cases:settlement-sealed-email-failed", "settlement_sealed email failed:", err);
        }
      })();
    }

    // Task #70 — NDA-triggered auto-finalization. Fire-and-forget so
    // a slow downstream (email, audit) never blocks the sign response.
    // `finalizeCaseAfterNda` is idempotent on cases.autoFinalizedAt so
    // a subsequent re-sign after an admin Override-Seal does not
    // double-fire the side effects.
    (async () => {
      try {
        const { finalizeCaseAfterNda } = await import("../services/caseFinalize");
        await finalizeCaseAfterNda(caseData.id, `user:${parsed.data.typedName}`);
      } catch (err) {
        warnOnce("cases:finalizecaseafternda-failed", "finalizeCaseAfterNda failed:", err);
      }
    })();

    res.status(201).json({
      alreadySigned: false,
      contentHash: created.contentHash,
      signedAt: created.signedAt,
      signedName: created.signedName,
      templateVersion: created.templateVersion,
    });
  } catch (err) {
    warnOnce("cases:post-cases-id-nda-sign-failed", "POST /cases/:id/nda/sign failed:", err);
    res.status(500).json({ error: "Failed to record signature" });
  }
});

// Admin-only NDA metadata for the case-detail dialog. Returns the
// signed-name / signed-at / IP / UA / contentHash / templateVersion so
// admins can audit the seal without being able to use this route to
// forge a signature (POST /nda/sign remains portal-session-only).
casesRouter.get("/:id/nda/metadata", checkAdminAuth, async (req, res) => {
  try {
    const existing = await storage.getCaseNdaByCaseId(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "No NDA on file for this case." });
      return;
    }
    // Surface the most recent integrity-check outcome (pass or fail) so
    // a previously-flagged tampering finding stays visible on the
    // Sealed banner across page reloads and dialog re-opens, not only
    // for the admin who clicked Verify originally.
    const lastCheck = await storage.getLatestNdaIntegrityCheck(req.params.id);
    // Recover the language the snapshot was rendered in so admin
    // compliance reviewers know which translation the recipient
    // actually signed. Pre-i18n snapshots have no locale field and
    // default to "en" inside extractSnapshotLocale.
    const { extractSnapshotLocale } = await import("../services/NdaService");
    const signedLocale = extractSnapshotLocale(existing.renderedBody);
    res.json({
      signed: true,
      signedName: existing.signedName,
      signedAt: existing.signedAt,
      signedIp: existing.signedIp,
      signedUserAgent: existing.signedUserAgent,
      contentHash: existing.contentHash,
      templateVersion: existing.templateVersion,
      signedLocale,
      lastIntegrityCheck: lastCheck
        ? {
            status:
              lastCheck.action === "nda_integrity_verified"
                ? "ok"
                : "failed",
            checkedAt: lastCheck.createdAt,
            checkedBy: lastCheck.adminUsername,
            detail: lastCheck.newValue,
          }
        : null,
    });
  } catch (err) {
    warnOnce("cases:get-nda-metadata-fail", "GET /cases/:id/nda/metadata failed:", err);
    res.status(500).json({ error: "Failed to load NDA metadata" });
  }
});

// Bulk integrity-status lookup for the admin Cases list. Returns the
// latest nda_integrity_verified / nda_integrity_failed audit row per
// sealed case so the list can render a red "Integrity failed" badge
// without N round-trips. Only cases with at least one recorded check
// appear in the response — unchecked sealed cases are simply omitted.
casesRouter.get("/nda/integrity-status", checkAdminAuth, async (_req, res) => {
  try {
    const allCases = await storage.getAllCases();
    const sealedIds = allCases
      .filter((c) => !!c.sealedAt)
      .map((c) => c.id);
    const map = await storage.getLatestNdaIntegrityChecksForCases(sealedIds);
    const out: Record<
      string,
      { status: "ok" | "failed"; checkedAt: string; checkedBy: string | null }
    > = {};
    for (const [caseId, row] of map.entries()) {
      out[caseId] = {
        status: row.action === "nda_integrity_verified" ? "ok" : "failed",
        checkedAt: (row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt)),
        checkedBy: row.adminUsername ?? null,
      };
    }
    res.json(out);
  } catch (err) {
    warnOnce("cases:nda-integrity-status-fail", "GET /cases/nda/integrity-status failed:", err);
    res.status(500).json({ error: "Failed to load NDA integrity statuses" });
  }
});

// Admin-triggered on-demand integrity verification. Re-hashes the
// stored signed PDF bytes and compares to the persisted contentHash
// captured at sign time. A mismatch implies the case_ndas row has
// been tampered with (DB-level edit, restore from a divergent
// backup, or a code path that rewrote signedPdfBase64 / contentHash
// independently) — we record a `nda_integrity_failed` audit row so
// the case is visibly flagged in the admin UI even after reload.
// A pass writes `nda_integrity_verified` for traceability of the
// audit-trail "this was checked at T by admin X" claim.
casesRouter.post("/:id/nda/verify", checkAdminAuth, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const existing = await storage.getCaseNdaByCaseId(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "No NDA on file for this case." });
      return;
    }
    const adminUser = (req as any).admin?.username || "Admin";
    const { sha256Hex } = await import("../services/NdaService");
    const storedBytes = Buffer.from(existing.signedPdfBase64, "base64");
    const recomputedHash = sha256Hex(storedBytes);
    const ok = recomputedHash === existing.contentHash;
    try {
      await storage.createAuditLog({
        action: ok ? "nda_integrity_verified" : "nda_integrity_failed",
        targetType: "case",
        targetId: caseData.id,
        adminUsername: adminUser,
        newValue: ok
          ? `NDA integrity verified by ${adminUser} (hash ${recomputedHash}, template ${existing.templateVersion}, ${storedBytes.length} bytes).`
          : `NDA integrity FAILED by ${adminUser}. Stored hash ${existing.contentHash} does not match recomputed hash ${recomputedHash} (${storedBytes.length} bytes, template ${existing.templateVersion}).`,
      });
    } catch (err) {
      warnOnce("cases:audit-log-for-nda-integrity-failed", "audit log for nda_integrity_* failed:", err);
    }
    res.json({
      ok,
      storedHash: existing.contentHash,
      recomputedHash,
      bytes: storedBytes.length,
      templateVersion: existing.templateVersion,
      checkedAt: new Date().toISOString(),
      checkedBy: adminUser,
    });
  } catch (err) {
    warnOnce("cases:post-cases-id-nda-verify-failed", "POST /cases/:id/nda/verify failed:", err);
    res.status(500).json({ error: "Failed to verify NDA integrity" });
  }
});

// Re-download the signed (or unsigned preview) PDF. Auth: portal user OR
// admin. The hash returned in the JSON GET endpoint always matches the
// bytes returned here for a signed case, because the same deterministic
// generator + the same template-version snapshot are reused.
casesRouter.get("/:id/nda/pdf", async (req, res) => {
  try {
    // Inline auth: accept either portal session OR admin bearer.
    const { isAuthorizedForCase } = await import("../services/portal-auth");
    const authorized = await isAuthorizedForCase(req, req.params.id);
    if (!authorized) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    // Admins can always re-download the latest signed artifact (audit
    // re-verification). Portal users only get the signed artifact when
    // the case is currently sealed — after an override they fall
    // through to the unsigned preview so they can re-sign.
    // We re-validate the bearer here rather than trusting any req.admin
    // side-effect from isAuthorizedForCase — that helper validates the
    // token but does not stamp req.admin in production, and getting
    // this wrong would break the post-override evidentiary re-download.
    const { isValidAdminToken } = await import("./middleware");
    const isAdmin = await isValidAdminToken(req.headers.authorization);
    const shouldServeSigned = isAdmin || !!caseData.sealedAt;
    const existing = shouldServeSigned
      ? await storage.getCaseNdaByCaseId(req.params.id)
      : undefined;
    if (existing) {
      const buf = Buffer.from(existing.signedPdfBase64, "base64");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="IBCCF-Sealed-Settlement-${caseData.id}.pdf"`,
      );
      res.setHeader("X-Content-Hash", existing.contentHash);
      res.send(buf);
      return;
    }
    const stage = parseInt(caseData.withdrawalStage || "1", 10);
    if (!Number.isFinite(stage) || stage < 14) {
      res.status(409).json({ error: "NDA not available yet for this case." });
      return;
    }
    const { buildNdaPdf, renderNdaForCase } = await import("../services/NdaService");
    // Preview renders in the recipient's portal language (defaults to
    // English on legacy rows), unless the signing screen passes an
    // explicit ?locale= override so the picker preview matches what the
    // user will sign. The signed snapshot above is served from its
    // stored bytes, so this branch only runs for unsigned previews.
    // When the English-only signing flag is on the override is ignored
    // and the preview PDF collapses to English to match what the user
    // will actually sign. The flag is sourced from the runtime store
    // (Task #61) so an admin toggle takes effect without a redeploy.
    const { effectiveSigningLocale, isSigningLocaleAllowed, normalizeNdaLocale } =
      await import("../../shared/ndaTemplate");
    const { getNdaSigningLocales } = await import("../services/runtimeFlags");
    const signingLocales = await getNdaSigningLocales();
    const requestedPreviewLocale =
      typeof req.query.locale === "string" ? req.query.locale : null;
    let previewLocale = effectiveSigningLocale(
      requestedPreviewLocale,
      signingLocales,
    );
    if (previewLocale == null) {
      // Same clamp as GET /nda: never let preferredLocale fall through
      // if it isn't on the live allowlist.
      const candidate = normalizeNdaLocale(caseData.preferredLocale ?? null);
      previewLocale = isSigningLocaleAllowed(candidate, signingLocales)
        ? candidate
        : "en";
    }
    const rendered = renderNdaForCase(caseData, previewLocale);
    const pdf = await buildNdaPdf(rendered);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="IBCCF-Settlement-Preview-${caseData.id}.pdf"`,
    );
    res.send(pdf);
  } catch (err) {
    warnOnce("cases:get-nda-pdf-fail", "GET /cases/:id/nda/pdf failed:", err);
    res.status(500).json({ error: "Failed to render PDF" });
  }
});

casesRouter.post("/:id/nda/override-seal", checkAdminAuth, async (req, res) => {
  try {
    const parsed = ndaOverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "A reason (minimum 8 characters) is required to override the seal." });
      return;
    }
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.sealedAt) {
      res.status(409).json({ error: "Case is not sealed." });
      return;
    }
    const adminUser = (req as any).admin?.username || "Admin";
    // Restore the case to its pre-seal mutable state. Signing transitioned
    // status to "sealed"; on override we set it back to "active" so the
    // portal stops forcing the read-only Sealed view and admin/user edits
    // resume normally. The case_ndas row + audit trail remain intact.
    // Capture the prior NDA evidence BEFORE flipping the seal so the
    // override audit row can reference exactly which signed artifact
    // it was clearing — re-verifiable later by content hash. The
    // case_ndas row itself is intentionally preserved (non-repudiation
    // and audit durability); a subsequent user re-sign will insert a
    // new versioned row and the historical artifact remains
    // re-downloadable via the admin metadata API.
    const priorNda = await storage.getCaseNdaByCaseId(caseData.id);
    const evidenceTag = priorNda
      ? `prior NDA id=${priorNda.id}, template=${priorNda.templateVersion}, hash=${priorNda.contentHash}`
      : "no prior NDA on file";
    await storage.runInTransaction(async (tx) => {
      await caseService.updateCase(
        caseData.id,
        { sealedAt: null, sealedBy: null, status: "active" },
        tx,
      );
      await storage.createAuditLog(
        {
          action: "case_seal_overridden",
          targetType: "case",
          targetId: caseData.id,
          adminUsername: adminUser,
          newValue: `Seal overridden by ${adminUser}. Reason: ${parsed.data.reason}. Evidence preserved: ${evidenceTag}.`,
        },
        tx,
      );
    });
    res.json({ success: true });
  } catch (err) {
    warnOnce("cases:post-cases-id-nda-override-seal-failed", "POST /cases/:id/nda/override-seal failed:", err);
    res.status(500).json({ error: "Failed to override seal" });
  }
});

// ============================================================================
// Task #70 — Merge Phrase Certificate
// ============================================================================

// Public-to-portal: returns the effective fee math + current status so the
// portal payment screen can render without trusting client-side defaults.
casesRouter.get("/:id/certificate/fee", requirePortalAccess, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.certificateEnabled) {
      res.status(404).json({ error: "Certificate not enabled for this case." });
      return;
    }
    const { getEffectiveCertificateFeePercent, computeCertificateFee } = await import("../services/certificateFee");
    const percent = await getEffectiveCertificateFeePercent(caseData);
    try {
      const math = computeCertificateFee(caseData.withdrawalAmount, percent);
      res.json({
        percent: math.percentUsed,
        amountUsdt: math.amountUsdt,
        baseAmountUsed: math.baseAmountUsed,
        status: caseData.certificateFeeStatus ?? "not_required",
        approvedAt: caseData.certificateFeeApprovedAt,
        depositAddress: caseData.depositAddress ?? null,
        depositAsset: caseData.depositAsset ?? "USDT",
        depositNetwork: caseData.depositNetwork ?? "TRC20",
      });
    } catch (mathErr) {
      res.status(409).json({
        error: mathErr instanceof Error ? mathErr.message : "Fee cannot be computed.",
        percent: String(percent),
        status: caseData.certificateFeeStatus ?? "not_required",
      });
    }
  } catch (err) {
    warnOnce("cases:get-cert-fee-fail", "GET /cases/:id/certificate/fee failed:", err);
    res.status(500).json({ error: "Failed to load certificate fee" });
  }
});

// Portal-authenticated: upload a fee receipt. Server computes the amount —
// the client never supplies it. Status flips to 'awaiting_admin_approval'
// on success — matching the vocabulary used by `cases.stampDutyStatus`
// (Task #178 aligned these two case-level mirror columns).
const certificateFeeUploadSchema = z.object({
  fileData: z.string().min(1),
  fileName: z.string().max(255).optional(),
  notes: z.string().max(1000).optional(),
});

const ALLOWED_RECEIPT_PREFIXES = [
  "data:application/pdf;",
  "data:image/png;",
  "data:image/jpeg;",
  "data:image/webp;",
];
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

casesRouter.post("/:id/certificate/fee-payments", requirePortalSessionOnly, async (req, res) => {
  try {
    const parsed = certificateFeeUploadSchema.parse(req.body);
    if (!ALLOWED_RECEIPT_PREFIXES.some((p) => parsed.fileData.startsWith(p))) {
      res.status(400).json({ error: "Receipt must be a PDF or PNG/JPEG/WebP image data URL." });
      return;
    }
    if (parsed.fileData.length > MAX_RECEIPT_BYTES) {
      res.status(413).json({ error: "Receipt too large (max 10 MB)." });
      return;
    }
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.certificateEnabled) {
      res.status(409).json({ error: "Certificate is not enabled for this case." });
      return;
    }
    if (caseData.certificateFeeStatus === "approved") {
      res.status(409).json({ error: "Certificate fee has already been approved." });
      return;
    }
    const { getEffectiveCertificateFeePercent, computeCertificateFee } = await import("../services/certificateFee");
    const percent = await getEffectiveCertificateFeePercent(caseData);
    let math;
    try {
      math = computeCertificateFee(caseData.withdrawalAmount, percent);
    } catch (mathErr) {
      res.status(409).json({ error: mathErr instanceof Error ? mathErr.message : "Fee cannot be computed." });
      return;
    }
    let created: Awaited<ReturnType<typeof storage.createCertificateFeePayment>>;
    try {
      created = await storage.runInTransaction(async (tx) => {
        const row = await storage.createCertificateFeePayment({
          caseId: caseData.id,
          amountUsdt: math.amountUsdt,
          percentUsed: math.percentUsed,
          baseAmountUsed: math.baseAmountUsed,
          fileData: parsed.fileData,
          fileName: parsed.fileName ?? null,
          notes: parsed.notes ?? null,
        } as any, tx);
        await caseService.updateCase(caseData.id, { certificateFeeStatus: "awaiting_admin_approval" }, tx);
        await storage.createAuditLog({
          action: "certificate_fee_payment_uploaded",
          targetType: "case",
          targetId: caseData.id,
          adminUsername: "portal-user",
          newValue: `Certificate fee receipt uploaded (id=${row.id}, ${math.amountUsdt} USDT @ ${math.percentUsed}%)`,
        }, tx);
        return row;
      });
    } catch (txErr) {
      warnOnce("cases:certificate-fee-payment-transaction-failed", "certificate fee payment transaction failed:", txErr);
      res.status(500).json({ error: "Failed to upload certificate fee receipt" });
      return;
    }
    if (caseData.userEmail) {
      (async () => {
        try {
          const [{ emailService }, { sendCaseEmailWithAudit }] = await Promise.all([
            import("../services/EmailService"),
            import("../services/emailNotify"),
          ]);
          const userName = (caseData.userName ?? "").trim() || caseData.userEmail!;
          await sendCaseEmailWithAudit({
            to: caseData.userEmail!,
            caseId: caseData.id,
            tag: "certificate_fee_received",
            adminUser: "system",
            send: (locale) =>
              emailService.sendLocalizedCaseEmail({
                to: caseData.userEmail!,
                userName,
                caseRef: caseData.id,
                locale,
                templateKey: "certificateFeeReceived",
                ctaPath: "/portal?view=certificate",
                logTag: "certificate-fee-received",
                vars: { amount: math.amountUsdt },
              }),
          });
        } catch (err) {
          warnOnce("cases:certificate-fee-received-email-failed", "certificate_fee_received email failed:", err);
        }
      })();
    }
    void (async () => {
      try {
        const { notificationService } = await import("../services/NotificationService");
        await notificationService.notifyAdmin(
          'certificate_fee_uploaded',
          'Certificate Fee Receipt Uploaded',
          `Case ${caseData.id} submitted a certificate fee receipt (${math.amountUsdt} USDT).`,
          `/admin`,
        );
      } catch (e) {
        warnOnce("cases:notify-admin-cert-fee-upload-failed", '[cases] notify admin cert fee upload failed:', e);
      }
    })();
    res.status(201).json({ id: created.id, status: "pending", amountUsdt: math.amountUsdt });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    warnOnce("cases:post-cases-id-certificate-fee-payments-failed", "POST /cases/:id/certificate/fee-payments failed:", err);
    res.status(500).json({ error: "Failed to upload certificate fee receipt" });
  }
});

// Portal + admin: list fee payments for a case.
casesRouter.get("/:id/certificate/fee-payments", requirePortalAccess, async (req, res) => {
  try {
    const rows = await storage.getCertificateFeePaymentsByCaseId(req.params.id);
    // Strip the heavy base64 body from the list view — it's only needed
    // for admin review (full payment fetch happens via the admin route).
    res.json(rows.map((r) => ({
      id: r.id,
      amountUsdt: r.amountUsdt,
      percentUsed: r.percentUsed,
      status: r.status,
      adminNotes: r.adminNotes,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      uploadedAt: r.uploadedAt,
      fileName: r.fileName,
      notes: r.notes,
    })));
  } catch (err) {
    warnOnce("cases:get-cert-fee-payments-fail", "GET /cases/:id/certificate/fee-payments failed:", err);
    res.status(500).json({ error: "Failed to load fee payments" });
  }
});

// Admin: full payment row including the receipt blob.
casesRouter.get("/:id/certificate/fee-payments/:paymentId", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.paymentId, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid payment id" });
      return;
    }
    const row = await storage.getCertificateFeePaymentById(id);
    if (!row || row.caseId !== req.params.id) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    warnOnce("cases:get-cert-fee-payment-by-id-fail", "GET /cases/:id/certificate/fee-payments/:paymentId failed:", err);
    res.status(500).json({ error: "Failed to load payment" });
  }
});

const certificateFeeReviewSchema = z.object({
  adminNotes: z.string().max(1000).optional(),
});

// Admin: approve a fee payment. Flips case status to 'approved' and
// stamps approver/approvedAt. Idempotent on already-approved rows.
casesRouter.post("/:id/certificate/fee-payments/:paymentId/approve", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.paymentId, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid payment id" });
      return;
    }
    const adminUser = (req as any).admin?.username || "Admin";
    const parsedBody = certificateFeeReviewSchema.parse(req.body ?? {});
    const note = parsedBody.adminNotes ?? null;
    const row = await storage.getCertificateFeePaymentById(id);
    if (!row || row.caseId !== req.params.id) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    // Idempotency: reject repeat reviews on already-terminal payments so a
    // double-click never re-sends emails or re-audits. Mirrors the stamp-duty
    // 409 contract from Task #180.
    if (row.status === "approved" || row.status === "rejected") {
      res.status(409).json({
        error: "Payment already reviewed",
        code: "certificate_fee_already_reviewed",
        status: row.status,
      });
      return;
    }
    const now = new Date();
    await storage.runInTransaction(async (tx) => {
      await storage.updateCertificateFeePayment(
        id,
        { status: "approved", adminNotes: note, reviewedBy: adminUser, reviewedAt: now },
        tx,
      );
      await caseService.updateCase(
        row.caseId,
        {
          certificateFeeStatus: "approved",
          certificateFeeApprovedAt: now,
          certificateFeeApprovedBy: adminUser,
        },
        tx,
      );
      await storage.createAuditLog(
        {
          action: "certificate_fee_approved",
          targetType: "case",
          targetId: row.caseId,
          adminUsername: adminUser,
          newValue: `Certificate fee payment ${id} approved (${row.amountUsdt} USDT).`,
        },
        tx,
      );
    });
    const caseData = await storage.getCaseById(row.caseId);
    if (caseData?.userEmail) {
      (async () => {
        try {
          const [{ emailService }, { sendCaseEmailWithAudit }] = await Promise.all([
            import("../services/EmailService"),
            import("../services/emailNotify"),
          ]);
          const userName = (caseData.userName ?? "").trim() || caseData.userEmail!;
          await sendCaseEmailWithAudit({
            to: caseData.userEmail!,
            caseId: caseData.id,
            tag: "certificate_unlocked",
            adminUser,
            send: (locale) =>
              emailService.sendLocalizedCaseEmail({
                to: caseData.userEmail!,
                userName,
                caseRef: caseData.id,
                locale,
                templateKey: "certificateUnlocked",
                ctaPath: "/portal?view=certificate",
                logTag: "certificate-unlocked",
              }),
          });
        } catch (err) {
          warnOnce("cases:certificate-unlocked-email-failed", "certificate_unlocked email failed:", err);
        }
      })();
    }
    void (async () => {
      try {
        const { notificationService } = await import("../services/NotificationService");
        await notificationService.notifyUser(
          row.caseId,
          'certificate_fee_approved',
          'Certificate Fee Approved',
          'Your certificate fee payment has been approved. You may now access your certificate.',
          '/portal?view=certificate',
        );
      } catch (e) {
        warnOnce("cases:notify-user-cert-fee-approved-failed", '[cases] notify user cert fee approved failed:', e);
      }
    })();
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    warnOnce("cases:post-approve-failed", "POST .../approve failed:", err);
    res.status(500).json({ error: "Failed to approve payment" });
  }
});

// Admin: reject a fee payment. Flips case status to 'rejected' so the
// portal surfaces the re-upload CTA + reviewer notes.
casesRouter.post("/:id/certificate/fee-payments/:paymentId/reject", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.paymentId, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid payment id" });
      return;
    }
    const adminUser = (req as any).admin?.username || "Admin";
    const parsedBody = certificateFeeReviewSchema.parse(req.body ?? {});
    const note = parsedBody.adminNotes ?? null;
    const row = await storage.getCertificateFeePaymentById(id);
    if (!row || row.caseId !== req.params.id) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    if (row.status === "approved" || row.status === "rejected") {
      res.status(409).json({
        error: "Payment already reviewed",
        code: "certificate_fee_already_reviewed",
        status: row.status,
      });
      return;
    }
    const now = new Date();
    await storage.runInTransaction(async (tx) => {
      await storage.updateCertificateFeePayment(
        id,
        { status: "rejected", adminNotes: note, reviewedBy: adminUser, reviewedAt: now },
        tx,
      );
      await caseService.updateCase(
        row.caseId,
        { certificateFeeStatus: "rejected" },
        tx,
      );
      await storage.createAuditLog(
        {
          action: "certificate_fee_rejected",
          targetType: "case",
          targetId: row.caseId,
          adminUsername: adminUser,
          newValue: `Certificate fee payment ${id} rejected. Notes: ${note ?? ""}`,
        },
        tx,
      );
    });
    const caseData = await storage.getCaseById(row.caseId);
    if (caseData?.userEmail) {
      (async () => {
        try {
          const [{ emailService }, { sendCaseEmailWithAudit }] = await Promise.all([
            import("../services/EmailService"),
            import("../services/emailNotify"),
          ]);
          const userName = (caseData.userName ?? "").trim() || caseData.userEmail!;
          await sendCaseEmailWithAudit({
            to: caseData.userEmail!,
            caseId: caseData.id,
            tag: "certificate_fee_rejected",
            adminUser,
            send: (locale) =>
              emailService.sendLocalizedCaseEmail({
                to: caseData.userEmail!,
                userName,
                caseRef: caseData.id,
                locale,
                templateKey: "certificateFeeRejected",
                ctaPath: "/portal?view=certificate",
                logTag: "certificate-fee-rejected",
              }),
          });
        } catch (err) {
          warnOnce("cases:certificate-fee-rejected-email-failed", "certificate_fee_rejected email failed:", err);
        }
      })();
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    warnOnce("cases:post-reject-failed", "POST .../reject failed:", err);
    res.status(500).json({ error: "Failed to reject payment" });
  }
});

// Admin: download the Payout Instructions PDF for a case. Single-page
// summary of the verified payout wallet, withdrawal amount, and release
// procedure — see server/services/payoutInstructionsPdf.ts. Display-only
// (the platform never holds or routes funds). Admin-auth-only because
// it bundles the full verified-wallet block in printable form.
casesRouter.get(
  "/:id/payout-instructions/pdf",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const { buildPayoutInstructionsPdf } = await import(
        "../services/payoutInstructionsPdf"
      );
      const pdf = await buildPayoutInstructionsPdf({ caseRow: caseData });
      try {
        await storage.createAuditLog({
          action: "payout_instructions_downloaded",
          targetType: "case",
          targetId: caseData.id,
          adminUsername: await resolveAdminUsernameFromReq(req),
          newValue: "Payout Instructions PDF downloaded.",
        });
      } catch {}
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="IBCCF-Payout-Instructions-${caseData.id}.pdf"`,
      );
      res.send(pdf);
    } catch (err) {
      warnOnce("cases:get-payout-instructions-pdf-fail", "GET /cases/:id/payout-instructions/pdf failed:", err);
      res.status(500).json({ error: "Failed to build payout instructions" });
    }
  },
);

// Portal: download the certificate PDF. Returns a watermarked preview
// unless `certificateFeeStatus === 'approved'`, in which case the clean
// version is returned. 404 when the certificate isn't enabled.
casesRouter.get("/:id/certificate/pdf", requirePortalAccess, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!caseData.certificateEnabled) {
      res.status(404).json({ error: "Certificate not enabled for this case." });
      return;
    }
    const approved = caseData.certificateFeeStatus === "approved";
    const { buildCertificatePdf } = await import("../services/certificatePdf");
    let feeAmountUsdt: string | undefined;
    let feePercent: string | undefined;
    if (!approved) {
      try {
        const { getEffectiveCertificateFeePercent, computeCertificateFee } = await import("../services/certificateFee");
        const percent = await getEffectiveCertificateFeePercent(caseData);
        const math = computeCertificateFee(caseData.withdrawalAmount, percent);
        feeAmountUsdt = math.amountUsdt;
        feePercent = math.percentUsed;
      } catch {
        /* watermark without fee figures if the amount isn't computable */
      }
    }
    const pdf = await buildCertificatePdf({
      caseRow: caseData,
      watermarked: !approved,
      feeAmountUsdt,
      feePercent,
    });
    try {
      await storage.createAuditLog({
        action: approved ? "certificate_downloaded" : "certificate_preview_downloaded",
        targetType: "case",
        targetId: caseData.id,
        adminUsername: "portal-user",
        newValue: approved ? "Clean certificate PDF served." : "Watermarked certificate preview served.",
      });
    } catch {}
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="IBCCF-Merge-Phrase-Certificate-${caseData.id}${approved ? "" : "-PREVIEW"}.pdf"`,
    );
    res.send(pdf);
  } catch (err) {
    warnOnce("cases:get-cert-pdf-fail", "GET /cases/:id/certificate/pdf failed:", err);
    res.status(500).json({ error: "Failed to build certificate" });
  }
});

// =============================================================================
// Task #72 — Stamp Duty Deposit
// =============================================================================
// Sealed Settlement & NDA cannot be signed until an admin approves a stamp
// duty receipt. Lifecycle:
//   awaiting_upload → (user upload) → awaiting_admin_approval
//   awaiting_admin_approval → (admin) → approved | rejected
//   rejected → (re-upload) → awaiting_admin_approval
// Admins can also disable the gate entirely by setting `stampDutyEnabled`
// to false via the regular PATCH /api/cases/:id account-edit form.

// Portal: read the effective stamp-duty config for the case.
casesRouter.get("/:id/stamp-duty", requirePortalAccess, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const {
      getEffectiveStampDutyUsdt,
      getStampDutyPaymentRails,
      getStampDutyPaymentWallets,
    } = await import("../services/stampDuty");
    const [eff, rails, wallets] = await Promise.all([
      getEffectiveStampDutyUsdt(caseData),
      getStampDutyPaymentRails(),
      getStampDutyPaymentWallets(),
    ]);
    res.json({
      enabled: caseData.stampDutyEnabled !== false,
      status: caseData.stampDutyStatus ?? "awaiting_upload",
      // Legacy single-wallet fields (kept for backward compatibility
      // with any client code that still reads paymentAddress directly).
      paymentAddress: rails.address,
      paymentAsset: rails.asset,
      paymentNetwork: rails.network,
      paymentMemo: rails.memo,
      // Multi-wallet payment rails. The portal renders every entry so
      // users can pay in whichever asset they prefer (BTC / USDT-TRC20 /
      // ERC20, etc). Empty array = no wallets configured.
      wallets,
      amountUsdt: eff.amountUsdt,
      amountSource: eff.source,
      approvedAt: caseData.stampDutyApprovedAt,
      rejectionReason: caseData.stampDutyRejectionReason,
    });
  } catch (err) {
    warnOnce("cases:get-stamp-duty-fail", "GET /cases/:id/stamp-duty failed:", err);
    res.status(500).json({ error: "Failed to load stamp duty config" });
  }
});

// Per-case in-process throttle for Stamp Duty Deposit uploads.
// Production runs on Replit autoscale so this is best-effort — a
// determined attacker who happens to land on multiple instances could
// in theory exceed the limit. The hard backstop is the pending-state
// duplicate-rejection check above (only one outstanding receipt at a
// time per case), which is enforced from the database state.
const STAMP_DUTY_UPLOAD_WINDOW_MS = 30_000;
const STAMP_DUTY_UPLOAD_MAX_PER_WINDOW = 3;
const stampDutyUploadTimestamps = new Map<string, number[]>();
function stampDutyUploadAllowed(caseId: string): boolean {
  const now = Date.now();
  const arr = (stampDutyUploadTimestamps.get(caseId) ?? []).filter(
    (t) => now - t < STAMP_DUTY_UPLOAD_WINDOW_MS,
  );
  if (arr.length >= STAMP_DUTY_UPLOAD_MAX_PER_WINDOW) {
    stampDutyUploadTimestamps.set(caseId, arr);
    return false;
  }
  return true;
}
function stampDutyMarkUploaded(caseId: string): void {
  const now = Date.now();
  const arr = (stampDutyUploadTimestamps.get(caseId) ?? []).filter(
    (t) => now - t < STAMP_DUTY_UPLOAD_WINDOW_MS,
  );
  arr.push(now);
  stampDutyUploadTimestamps.set(caseId, arr);
}

const stampDutyUploadSchema = z.object({
  fileData: z.string().min(1),
  fileName: z.string().max(255).optional(),
  notes: z.string().max(1000).optional(),
});

// Admin approve/reject body — `adminNotes` is the only field accepted
// and is bounded at 1000 chars. Validating with Zod (rather than ad-hoc
// `typeof === "string"`) matches the project-wide "validate every
// payload" contract and gives a structured 400 response on misuse.
const stampDutyReviewSchema = z.object({
  adminNotes: z.string().max(1000).optional(),
});

// Portal: upload a stamp-duty receipt. Server resolves the amount — the
// client never supplies it. Status flips to 'awaiting_admin_approval'.
casesRouter.post("/:id/stamp-duty/receipts", requirePortalSessionOnly, async (req, res) => {
  try {
    const parsed = stampDutyUploadSchema.parse(req.body);
    if (!ALLOWED_RECEIPT_PREFIXES.some((p) => parsed.fileData.startsWith(p))) {
      res.status(400).json({ error: "Receipt must be a PDF or PNG/JPEG/WebP image data URL." });
      return;
    }
    if (parsed.fileData.length > MAX_RECEIPT_BYTES) {
      res.status(413).json({ error: "Receipt too large (max 10 MB)." });
      return;
    }
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (caseData.stampDutyEnabled === false) {
      res.status(409).json({ error: "Stamp duty is not required for this case." });
      return;
    }
    if (caseData.stampDutyStatus === "approved") {
      res.status(409).json({ error: "Stamp duty has already been approved." });
      return;
    }
    // Duplicate-pending guard: once the user has uploaded a receipt
    // and we're waiting on admin review, refuse new uploads until the
    // reviewer either approves or rejects. Without this a single user
    // could fill `stamp_duty_receipts` with arbitrary base64 blobs.
    if (caseData.stampDutyStatus === "awaiting_admin_approval") {
      res.status(409).json({
        error: "A stamp duty receipt is already awaiting review. Please wait for the reviewer's decision before re-uploading.",
        code: "stamp_duty_review_pending",
      });
      return;
    }
    // Per-case upload throttle (in-process map keyed by case id). Real
    // protection against abuse — the route accepts up to 10 MB blobs.
    if (!stampDutyUploadAllowed(caseData.id)) {
      res.status(429).json({
        error: "Too many uploads for this case. Please wait a moment and try again.",
      });
      return;
    }
    const { getEffectiveStampDutyUsdt } = await import("../services/stampDuty");
    const eff = await getEffectiveStampDutyUsdt(caseData);
    let created: Awaited<ReturnType<typeof storage.createStampDutyReceipt>>;
    try {
      created = await storage.runInTransaction(async (tx) => {
        const row = await storage.createStampDutyReceipt({
          caseId: caseData.id,
          amountUsdt: eff.amountUsdt,
          fileData: parsed.fileData,
          fileName: parsed.fileName ?? null,
          notes: parsed.notes ?? null,
        }, tx);
        await caseService.updateCase(caseData.id, {
          stampDutyStatus: "awaiting_admin_approval",
          stampDutyRejectionReason: null,
        }, tx);
        await storage.createAuditLog({
          action: "stamp_duty_receipt_uploaded",
          targetType: "case",
          targetId: caseData.id,
          adminUsername: "portal-user",
          newValue: `Stamp duty receipt uploaded (id=${row.id}, ${eff.amountUsdt} USDT).`,
        }, tx);
        return row;
      });
    } catch (txErr) {
      warnOnce("cases:stamp-duty-receipt-transaction-failed", "stamp duty receipt transaction failed:", txErr);
      res.status(500).json({ error: "Failed to upload stamp duty receipt" });
      return;
    }
    stampDutyMarkUploaded(caseData.id);
    if (caseData.userEmail) {
      (async () => {
        try {
          const [{ emailService }, { sendCaseEmailWithAudit }] = await Promise.all([
            import("../services/EmailService"),
            import("../services/emailNotify"),
          ]);
          const userName = (caseData.userName ?? "").trim() || caseData.userEmail!;
          await sendCaseEmailWithAudit({
            to: caseData.userEmail!,
            caseId: caseData.id,
            tag: "stamp_duty_received",
            adminUser: "system",
            send: (locale) =>
              emailService.sendLocalizedCaseEmail({
                to: caseData.userEmail!,
                userName,
                caseRef: caseData.id,
                locale,
                templateKey: "stampDutyReceived",
                ctaPath: "/portal?view=sealed",
                logTag: "stamp-duty-received",
                vars: { amount: eff.amountUsdt },
              }),
          });
        } catch (err) {
          warnOnce("cases:stamp-duty-received-email-failed", "stamp_duty_received email failed:", err);
        }
      })();
    }
    void (async () => {
      try {
        const { notificationService } = await import("../services/NotificationService");
        await notificationService.notifyAdmin(
          'stamp_duty_uploaded',
          'Stamp Duty Receipt Uploaded',
          `Case ${caseData.id} submitted a stamp duty receipt (${eff.amountUsdt} USDT).`,
          `/admin`,
        );
      } catch (e) {
        warnOnce("cases:notify-admin-stamp-duty-upload-failed", '[cases] notify admin stamp duty upload failed:', e);
      }
    })();
    res.status(201).json({ id: created.id, status: "awaiting_admin_approval", amountUsdt: eff.amountUsdt });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    warnOnce("cases:post-cases-id-stamp-duty-receipts-failed", "POST /cases/:id/stamp-duty/receipts failed:", err);
    res.status(500).json({ error: "Failed to upload stamp duty receipt" });
  }
});

// Portal + admin: list receipts (heavy file_data stripped from list).
casesRouter.get("/:id/stamp-duty/receipts", requirePortalAccess, async (req, res) => {
  try {
    const rows = await storage.getStampDutyReceiptsByCaseId(req.params.id);
    res.json(rows.map((r) => ({
      id: r.id,
      amountUsdt: r.amountUsdt,
      status: r.status,
      adminNotes: r.adminNotes,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      uploadedAt: r.uploadedAt,
      fileName: r.fileName,
      notes: r.notes,
    })));
  } catch (err) {
    warnOnce("cases:get-stamp-duty-receipts-fail", "GET /cases/:id/stamp-duty/receipts failed:", err);
    res.status(500).json({ error: "Failed to load stamp duty receipts" });
  }
});

// Admin: full receipt row including the base64 blob.
casesRouter.get("/:id/stamp-duty/receipts/:receiptId", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.receiptId, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid receipt id" });
      return;
    }
    const row = await storage.getStampDutyReceiptById(id);
    if (!row || row.caseId !== req.params.id) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    warnOnce("cases:get-stamp-duty-receipt-by-id-fail", "GET stamp duty receipt failed:", err);
    res.status(500).json({ error: "Failed to load receipt" });
  }
});

// Admin: approve a stamp-duty receipt. Flips case status to 'approved'
// and stamps approver/approvedAt. Idempotent on already-approved rows.
casesRouter.post("/:id/stamp-duty/receipts/:receiptId/approve", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.receiptId, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid receipt id" });
      return;
    }
    const adminUser = (req as any).admin?.username || "Admin";
    const parsedBody = stampDutyReviewSchema.parse(req.body ?? {});
    const note = parsedBody.adminNotes ?? null;
    const row = await storage.getStampDutyReceiptById(id);
    if (!row || row.caseId !== req.params.id) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }
    // Idempotency: reject repeat reviews on already-terminal receipts so
    // a double-click never re-sends emails or re-audits. Returning 409
    // matches the duplicate-pending guard used elsewhere on this flow.
    if (row.status === "approved" || row.status === "rejected") {
      res.status(409).json({
        error: "Receipt already reviewed",
        code: "stamp_duty_already_reviewed",
        status: row.status,
      });
      return;
    }
    const now = new Date();
    await storage.runInTransaction(async (tx) => {
      await storage.updateStampDutyReceipt(
        id,
        { status: "approved", adminNotes: note, reviewedBy: adminUser, reviewedAt: now },
        tx,
      );
      await caseService.updateCase(
        row.caseId,
        {
          stampDutyStatus: "approved",
          stampDutyApprovedAt: now,
          stampDutyApprovedBy: adminUser,
          stampDutyRejectionReason: null,
        },
        tx,
      );
      await storage.createAuditLog(
        {
          action: "stamp_duty_approved",
          targetType: "case",
          targetId: row.caseId,
          adminUsername: adminUser,
          newValue: `Stamp duty receipt ${id} approved (${row.amountUsdt} USDT).`,
        },
        tx,
      );
    });
    const caseData = await storage.getCaseById(row.caseId);
    if (caseData?.userEmail) {
      (async () => {
        try {
          const [{ emailService }, { sendCaseEmailWithAudit }] = await Promise.all([
            import("../services/EmailService"),
            import("../services/emailNotify"),
          ]);
          const userName = (caseData.userName ?? "").trim() || caseData.userEmail!;
          await sendCaseEmailWithAudit({
            to: caseData.userEmail!,
            caseId: caseData.id,
            tag: "stamp_duty_approved",
            adminUser,
            send: (locale) =>
              emailService.sendLocalizedCaseEmail({
                to: caseData.userEmail!,
                userName,
                caseRef: caseData.id,
                locale,
                templateKey: "stampDutyApproved",
                ctaPath: "/portal?view=sealed",
                logTag: "stamp-duty-approved",
              }),
          });
        } catch (err) {
          warnOnce("cases:stamp-duty-approved-email-failed", "stamp_duty_approved email failed:", err);
        }
      })();
    }
    void (async () => {
      try {
        const { notificationService } = await import("../services/NotificationService");
        await notificationService.notifyUser(
          row.caseId,
          'stamp_duty_approved',
          'Stamp Duty Approved',
          'Your stamp duty payment has been verified and approved. Please proceed with the next steps.',
          '/portal?view=sealed',
        );
      } catch (e) {
        warnOnce("cases:notify-user-stamp-duty-approved-failed", '[cases] notify user stamp duty approved failed:', e);
      }
    })();
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    warnOnce("cases:post-stamp-duty-approve-failed", "POST stamp-duty approve failed:", err);
    res.status(500).json({ error: "Failed to approve stamp duty receipt" });
  }
});

// Admin: reject a stamp-duty receipt. User can re-upload after rejection.
casesRouter.post("/:id/stamp-duty/receipts/:receiptId/reject", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.receiptId, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid receipt id" });
      return;
    }
    const adminUser = (req as any).admin?.username || "Admin";
    const parsedBody = stampDutyReviewSchema.parse(req.body ?? {});
    const note = parsedBody.adminNotes ?? null;
    const row = await storage.getStampDutyReceiptById(id);
    if (!row || row.caseId !== req.params.id) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }
    if (row.status === "approved" || row.status === "rejected") {
      res.status(409).json({
        error: "Receipt already reviewed",
        code: "stamp_duty_already_reviewed",
        status: row.status,
      });
      return;
    }
    const now = new Date();
    await storage.runInTransaction(async (tx) => {
      await storage.updateStampDutyReceipt(
        id,
        { status: "rejected", adminNotes: note, reviewedBy: adminUser, reviewedAt: now },
        tx,
      );
      await caseService.updateCase(
        row.caseId,
        { stampDutyStatus: "rejected", stampDutyRejectionReason: note },
        tx,
      );
      await storage.createAuditLog(
        {
          action: "stamp_duty_rejected",
          targetType: "case",
          targetId: row.caseId,
          adminUsername: adminUser,
          newValue: `Stamp duty receipt ${id} rejected. Notes: ${note ?? ""}`,
        },
        tx,
      );
    });
    const caseData = await storage.getCaseById(row.caseId);
    if (caseData?.userEmail) {
      (async () => {
        try {
          const [{ emailService }, { sendCaseEmailWithAudit }] = await Promise.all([
            import("../services/EmailService"),
            import("../services/emailNotify"),
          ]);
          const userName = (caseData.userName ?? "").trim() || caseData.userEmail!;
          await sendCaseEmailWithAudit({
            to: caseData.userEmail!,
            caseId: caseData.id,
            tag: "stamp_duty_rejected",
            adminUser,
            send: (locale) =>
              emailService.sendLocalizedCaseEmail({
                to: caseData.userEmail!,
                userName,
                caseRef: caseData.id,
                locale,
                templateKey: "stampDutyRejected",
                ctaPath: "/portal?view=sealed",
                logTag: "stamp-duty-rejected",
                vars: { reason: note ?? "" },
              }),
          });
        } catch (err) {
          warnOnce("cases:stamp-duty-rejected-email-failed", "stamp_duty_rejected email failed:", err);
        }
      })();
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    warnOnce("cases:post-stamp-duty-reject-failed", "POST stamp-duty reject failed:", err);
    res.status(500).json({ error: "Failed to reject stamp duty receipt" });
  }
});

// Admin: latest Stamp Duty fee reminder audit entry for a case.
// Powers the "Last reminder: X ago to <email>" line above the reminder
// form so reviewers don't double-nudge users.
casesRouter.get(
  "/:id/stamp-duty/last-reminder",
  checkAdminAuth,
  async (req, res) => {
    try {
      const row = await storage.getLatestStampDutyReminder(req.params.id);
      if (!row) {
        res.json({ found: false });
        return;
      }
      res.json({
        found: true,
        action: row.action,
        success: row.action === "stamp_duty_reminder_sent",
        sentAt: row.createdAt,
        adminUsername: row.adminUsername,
        details: row.newValue,
      });
    } catch (err) {
      warnOnce("cases:get-stamp-duty-last-reminder-fail", "GET stamp-duty/last-reminder failed:", err);
      res.status(500).json({ error: "Failed to load last reminder" });
    }
  },
);

// Admin-triggered Stamp Duty fee reminder. Sends an email containing the
// amount due plus every configured receiving wallet to an arbitrary
// recipient (defaults to the case's userEmail). Used when a user has
// stalled before uploading their deposit receipt and the admin wants
// to nudge them with the deposit address(es) in a single click.
const stampDutyReminderSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(254)
    .email("Recipient must be a valid email address."),
  customMessage: z.string().trim().max(2000).optional(),
});

casesRouter.post(
  "/:id/stamp-duty/send-reminder",
  checkAdminAuth,
  async (req, res) => {
    try {
      const parsed = stampDutyReminderSchema.parse(req.body ?? {});
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      // Refuse to send a reminder when stamp duty is disabled for the
      // case or already approved — both are no-ops that would confuse
      // the recipient. The admin can flip `stampDutyEnabled` in the
      // case-edit form if they truly need to re-engage the user.
      if (caseData.stampDutyEnabled === false) {
        res.status(409).json({
          error: "Stamp duty is disabled for this case — enable it before sending a reminder.",
        });
        return;
      }
      if (caseData.stampDutyStatus === "approved") {
        res.status(409).json({
          error: "Stamp duty is already approved for this case — no reminder needed.",
        });
        return;
      }
      const adminUser = await resolveAdminUsernameFromReq(req);
      const { getEffectiveStampDutyUsdt, getStampDutyPaymentWallets } =
        await import("../services/stampDuty");
      const [eff, wallets] = await Promise.all([
        getEffectiveStampDutyUsdt(caseData),
        getStampDutyPaymentWallets(),
      ]);
      if (wallets.length === 0) {
        res.status(409).json({
          error:
            "No stamp-duty deposit wallet is configured. Add at least one wallet in Admin → Settings before sending a reminder.",
        });
        return;
      }
      // Ordering: send the email first (the "cause"), then write the
      // audit row that records its outcome (sent vs failed), then
      // respond. The audit write is best-effort but failures are
      // logged so they don't disappear silently — losing the audit
      // trail of a real send is worse than a noisy log line.
      const { emailService } = await import("../services/EmailService");
      const result = await emailService.sendStampDutyReminder({
        to: parsed.email,
        userName: caseData.userName ?? null,
        caseRef: caseData.id,
        amountUsdt: eff.amountUsdt,
        wallets,
        customMessage: parsed.customMessage ?? null,
      });
      try {
        await storage.createAuditLog({
          action: result.success
            ? "stamp_duty_reminder_sent"
            : "stamp_duty_reminder_failed",
          targetType: "case",
          targetId: caseData.id,
          adminUsername: adminUser,
          newValue: `Stamp duty reminder → ${parsed.email} (${eff.amountUsdt} USDT, ${wallets.length} wallet${wallets.length === 1 ? "" : "s"})${result.success ? "" : ` — error: ${result.error ?? "unknown"}`}`,
        });
      } catch (auditErr) {
        warnOnce(
          "cases:audit-write-failed-for-case-casedata-id-email-resu",
          `[stamp-duty] audit write failed for case ${caseData.id} (email ${result.success ? "sent" : "failed"}):`,
          auditErr,
        );
      }
      if (!result.success) {
        res.status(502).json({
          error: result.error || "Email send failed.",
        });
        return;
      }
      res.json({
        success: true,
        to: parsed.email,
        amountUsdt: eff.amountUsdt,
        walletCount: wallets.length,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      warnOnce("cases:post-stamp-duty-send-reminder-failed", "POST stamp-duty send-reminder failed:", err);
      res.status(500).json({ error: "Failed to send stamp duty reminder" });
    }
  },
);

// ─── Session Refresh Deposit gate ────────────────────────────────────────────
//
// Portal route: user submits a deposit receipt while blocked at the gate.
// Admin routes: list receipts, view blob, approve/reject, re-request.

const sessionRefreshSubmitSchema = z.object({
  txHash: z.string().max(200).optional(),
  receiptData: z
    .string()
    .regex(/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/,
      "receiptData must be a base64 data URL (PNG/JPEG/WebP/PDF)"),
  fileName: z.string().max(255).optional(),
});

casesRouter.post(
  "/:id/session-refresh/submit",
  requirePortalSessionOnly,
  async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }
      if (!caseData.sessionRefreshRequired) {
        res.status(409).json({ code: "gate_not_active", error: "Session refresh gate is not active for this case." });
        return;
      }
      if (caseData.sessionRefreshStatus === "approved") {
        res.status(409).json({ code: "already_approved", error: "Session refresh deposit already approved." });
        return;
      }
      const parsed = sessionRefreshSubmitSchema.parse(req.body ?? {});
      const receipt = await storage.createSessionRefreshReceipt({
        caseId: caseData.id,
        txHash: parsed.txHash ?? null,
        receiptData: parsed.receiptData,
        fileName: parsed.fileName ?? null,
      });
      await storage.updateCase(caseData.id, { sessionRefreshStatus: "submitted" });
      await storage.createAuditLog({
        action: "session_refresh_receipt_submitted",
        targetType: "case",
        targetId: caseData.id,
        adminUsername: "portal-user",
        newValue: `Receipt #${receipt.id} submitted${parsed.txHash ? ` (tx: ${parsed.txHash})` : ""}.`,
      });
      res.json({ success: true, receiptId: receipt.id });
    } catch (err) {
      if (err instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" }); return; }
      warnOnce("cases:post-session-refresh-submit-failed", "POST session-refresh/submit failed:", err);
      res.status(500).json({ error: "Failed to submit session refresh receipt" });
    }
  },
);

// Admin: list all receipts for a case (blobs stripped for listing).
casesRouter.get(
  "/:id/session-refresh/receipts",
  checkAdminAuth,
  async (req, res) => {
    try {
      const rows = await storage.getSessionRefreshReceiptsByCaseId(req.params.id);
      const safe = rows.map(({ receiptData: _blob, ...rest }) => rest);
      res.json(safe);
    } catch (err) {
      warnOnce("cases:get-session-refresh-receipts-fail", "GET session-refresh/receipts failed:", err);
      res.status(500).json({ error: "Failed to fetch session refresh receipts" });
    }
  },
);

// Admin: fetch the full blob for a specific receipt.
casesRouter.get(
  "/:id/session-refresh/receipts/:receiptId",
  checkAdminAuth,
  async (req, res) => {
    try {
      const receipt = await storage.getSessionRefreshReceiptById(Number(req.params.receiptId));
      if (!receipt || receipt.caseId !== req.params.id) {
        res.status(404).json({ error: "Receipt not found" });
        return;
      }
      res.json(receipt);
    } catch (err) {
      warnOnce("cases:get-session-refresh-receipt-by-id-fail", "GET session-refresh/receipts/:id failed:", err);
      res.status(500).json({ error: "Failed to fetch receipt" });
    }
  },
);

const sessionRefreshReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  adminNotes: z.string().max(1000).optional(),
});

// Admin: approve or reject the latest submitted receipt.
casesRouter.post(
  "/:id/session-refresh/review",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }
      if (caseData.sessionRefreshStatus !== "submitted") {
        res.status(409).json({ code: "not_submitted", error: "No pending submission to review." });
        return;
      }
      const { action, adminNotes } = sessionRefreshReviewSchema.parse(req.body ?? {});
      const newStatus = action === "approve" ? "approved" : "rejected";

      const adminUser = await resolveAdminUsernameFromReq(req);

      // Update the most-recent receipt row with reviewer info.
      const receipts = await storage.getSessionRefreshReceiptsByCaseId(caseData.id);
      const latest = receipts[0];
      if (latest) {
        await storage.updateSessionRefreshReceipt(latest.id, {
          adminNotes: adminNotes ?? null,
          reviewedBy: adminUser,
          reviewedAt: new Date(),
        });
      }

      await storage.updateCase(caseData.id, { sessionRefreshStatus: newStatus });
      await storage.createAuditLog({
        action: `session_refresh_${action}d`,
        targetType: "case",
        targetId: caseData.id,
        adminUsername: adminUser,
        newValue: `Session refresh deposit ${action}d.${adminNotes ? ` Note: ${adminNotes}` : ""}`,
      });
      res.json({ success: true, status: newStatus });
    } catch (err) {
      if (err instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" }); return; }
      warnOnce("cases:post-session-refresh-review-failed", "POST session-refresh/review failed:", err);
      res.status(500).json({ error: "Failed to review session refresh receipt" });
    }
  },
);

// Portal: upload a supporting document (user-initiated)
const USER_DOC_CATEGORIES = ['id_proof', 'transaction', 'evidence', 'general'] as const;

casesRouter.post("/:id/user-documents", requirePortalSessionOnly, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }

    const { fileData, fileName, category, description } = req.body ?? {};

    if (typeof fileData !== 'string' || !fileData) {
      res.status(400).json({ error: "fileData is required." });
      return;
    }
    const check = validateDocumentDataUrl(fileData);
    if (!check.ok) {
      // Preserve the historical 413 status for "too large" rejections so
      // existing clients that distinguish 400 vs 413 continue to work.
      const status = /Maximum is/.test(check.error) ? 413 : 400;
      res.status(status).json({ error: check.error });
      return;
    }
    if (typeof fileName !== 'string' || !fileName.trim()) {
      res.status(400).json({ error: "fileName is required." });
      return;
    }
    const resolvedCategory =
      typeof category === 'string' && USER_DOC_CATEGORIES.includes(category as typeof USER_DOC_CATEGORIES[number])
        ? category
        : 'general';

    const fileType = fileData.startsWith('data:application/pdf') ? 'pdf' : 'image';
    const fileSizeBytes = Math.round((fileData.length * 3) / 4);
    const fileSizeStr = fileSizeBytes > 1024 * 1024
      ? `${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.round(fileSizeBytes / 1024)} KB`;

    const created = await storage.createUserDocument({
      caseId: caseData.id,
      fileName: fileName.trim(),
      fileType,
      fileData,
      fileSize: fileSizeStr,
      category: resolvedCategory,
      description: typeof description === 'string' ? description.trim() || undefined : undefined,
    });

    await storage.createAuditLog({
      action: "user_document_uploaded",
      targetType: "case",
      targetId: caseData.id,
      adminUsername: "portal-user",
      newValue: `Supporting document uploaded: ${fileName.trim()} (id=${created.id}, category=${resolvedCategory})`,
    });

    // Fire-and-forget admin notifications — never delays the user-facing response.
    void (async () => {
      try {
        const { notificationService } = await import("../services/NotificationService");
        await notificationService.notifyAdmin(
          "user_document_uploaded",
          "Supporting Document Uploaded",
          `Case ${created.caseId} uploaded "${fileName.trim()}" (#${created.id}).`,
          "/admin",
        );
      } catch (e) {
        warnOnce("cases:notify-admin-user-document-upload-failed", "[cases] notify admin user document upload failed:", e);
      }
      try {
        const { maybeAlertOnDocumentUpload } = await import(
          "../services/documentUploadAlert"
        );
        await maybeAlertOnDocumentUpload({
          caseId: created.caseId,
          docId: created.id,
          documentType: resolvedCategory,
          fileName: fileName.trim(),
        });
      } catch (e) {
        warnOnce("cases:document-upload-alert-dispatcher-failed", "[cases] document upload alert dispatcher failed:", e);
      }
    })();

    const { id, caseId, uploadedAt, ...rest } = created;
    res.status(201).json({ id, caseId, uploadedAt, ...rest, description: rest.description ?? null, fileData: undefined });
  } catch (err) {
    warnOnce("cases:post-user-documents-failed", "POST user-documents failed:", err);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

// Portal: list supporting documents for this case (no blobs)
casesRouter.get("/:id/user-documents", requirePortalAccess, async (req, res) => {
  try {
    const caseData = await storage.getCaseById(req.params.id);
    if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }
    const docs = await storage.getUserDocumentsByCaseId(caseData.id);
    res.json(docs);
  } catch (err) {
    warnOnce("cases:get-user-documents-fail", "GET user-documents failed:", err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// Admin: download per-case chronology PDF (stage history, messages, receipts, audit trail).
casesRouter.get("/:id/chronology/pdf", checkAdminAuth, async (req, res) => {
  try {
    const { buildCaseChronologyPdf } = await import("../services/caseChronologyPdf");
    const { auditLogs: auditLogsTable } = await import("@shared/schema");
    const { and, eq, asc } = await import("drizzle-orm");
    const { db } = await import("../db");

    const caseRow = await storage.getCaseById(req.params.id);
    if (!caseRow) { res.status(404).json({ error: "Case not found" }); return; }

    const [chatMsgs, adminMsgs, receipts, docs, caseAuditLogs] = await Promise.all([
      storage.getChatMessagesByCaseId(caseRow.id),
      storage.getAdminMessagesByCaseId(caseRow.id),
      storage.getDepositReceiptsByCaseId(caseRow.id),
      storage.getDocumentRequestsByCaseId(caseRow.id),
      db
        .select()
        .from(auditLogsTable)
        .where(
          and(
            eq(auditLogsTable.targetType, "case"),
            eq(auditLogsTable.targetId, caseRow.id),
          ),
        )
        .orderBy(asc(auditLogsTable.createdAt)),
    ]);

    const pdfBuffer = await buildCaseChronologyPdf({
      caseRow,
      chatMessages: chatMsgs,
      adminMessages: adminMsgs,
      depositReceipts: receipts,
      documentRequests: docs,
      auditLogs: caseAuditLogs,
    });

    const safeId = caseRow.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="IBCCF-Chronology-${safeId}.pdf"`,
      "Content-Length": String(pdfBuffer.length),
    });
    res.send(pdfBuffer);
  } catch (err) {
    warnOnce("cases:get-chronology-pdf-failed", "GET chronology/pdf failed:", err);
    res.status(500).json({ error: "Failed to generate chronology PDF" });
  }
});

// Admin: re-request the deposit (resets status to 'pending').
casesRouter.post(
  "/:id/session-refresh/re-request",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }
      const adminUser = await resolveAdminUsernameFromReq(req);
      await storage.updateCase(caseData.id, {
        sessionRefreshRequired: true,
        sessionRefreshStatus: "pending",
      });
      await storage.createAuditLog({
        action: "session_refresh_re_requested",
        targetType: "case",
        targetId: caseData.id,
        adminUsername: adminUser,
        newValue: "Session refresh deposit re-requested; status reset to pending.",
      });
      res.json({ success: true });
    } catch (err) {
      warnOnce("cases:post-session-refresh-re-request-failed", "POST session-refresh/re-request failed:", err);
      res.status(500).json({ error: "Failed to re-request session refresh" });
    }
  },
);

// ============================================================================
// Refund Claim routes
// ============================================================================

// POST /:id/refund-claim/request — admin: activate the flow, send email
casesRouter.post(
  "/:id/refund-claim/request",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }
      if (caseData.refundClaimStatus != null) {
        res.status(409).json({ error: "Refund claim already requested for this case." }); return;
      }
      const { documentaryRecommendations, refundableAmount } = req.body as {
        documentaryRecommendations?: string | null;
        refundableAmount?: string | null;
      };
      const adminUser = await resolveAdminUsernameFromReq(req);
      // Create the claim row
      await storage.createRefundClaim({
        caseId: caseData.id,
        refundableAmount: refundableAmount?.trim() || null,
        documentaryRecommendations: documentaryRecommendations ?? null,
        requestedBy: adminUser,
      });
      // Update case status field so it reaches the portal allowlist
      await storage.updateCase(caseData.id, { refundClaimStatus: "pending_submission" });
      // Audit log
      await storage.createAuditLog({
        action: "refund_claim_requested",
        targetType: "case",
        targetId: caseData.id,
        adminUsername: adminUser,
        newValue: documentaryRecommendations
          ? `Refund claim activated. Recs: ${documentaryRecommendations.slice(0, 120)}`
          : "Refund claim activated.",
      });
      // Fire-and-forget email
      const portalUrl = `${req.protocol}://${req.get("host")}`;
      const locale = caseData.preferredLocale ?? "en";
      emailService.sendRefundClaimRequest({
        to: caseData.userEmail!,
        caseId: caseData.id,
        documentaryRecommendations: documentaryRecommendations ?? null,
        portalUrl,
        locale,
      }).catch(() => {});
      res.json({ success: true, emailDispatched: true });
    } catch (err) {
      warnOnce("cases:post-refund-claim-request-failed", "POST refund-claim/request failed:", err);
      res.status(500).json({ error: "Failed to request refund claim" });
    }
  },
);

// GET /:id/refund-claim — admin or portal session: fetch claim data
casesRouter.get(
  "/:id/refund-claim",
  async (req, res) => {
    const authorized = await isAuthorizedForCase(req, req.params.id);
    if (!authorized) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const claim = await storage.getRefundClaimByCase(req.params.id);
      if (!claim) { res.status(404).json({ error: "No refund claim found" }); return; }
      res.json(claim);
    } catch (err) {
      warnOnce("cases:get-refund-claim-failed", "GET refund-claim failed:", err);
      res.status(500).json({ error: "Failed to fetch refund claim" });
    }
  },
);

// PATCH /:id/refund-claim — portal session: update entries (+ optional submit)
casesRouter.patch(
  "/:id/refund-claim",
  requirePortalAccess,
  async (req, res) => {
    try {
      const { entries, submit } = req.body as { entries?: unknown; submit?: boolean };
      const claim = await storage.getRefundClaimByCase(req.params.id);
      if (!claim) { res.status(404).json({ error: "No refund claim found" }); return; }
      if (claim.status !== "pending_submission") {
        res.status(409).json({ error: "Claim is no longer editable." }); return;
      }
      const updates: Parameters<typeof storage.updateRefundClaim>[1] = {};
      if (entries !== undefined) updates.entries = entries as never;
      if (submit) {
        updates.status = "submitted";
        updates.submittedAt = new Date();
        await storage.updateCase(req.params.id, { refundClaimStatus: "submitted" });
        await storage.createAuditLog({
          action: "refund_claim_submitted",
          adminUsername: "portal-user",
          targetType: "case",
          targetId: req.params.id,
          newValue: `User submitted refund claim with ${Array.isArray(entries) ? (entries as unknown[]).length : 0} entries.`,
        });
      }
      const updated = await storage.updateRefundClaim(claim.id, updates);
      res.json(updated);
    } catch (err) {
      warnOnce("cases:patch-refund-claim-failed", "PATCH refund-claim failed:", err);
      res.status(500).json({ error: "Failed to update refund claim" });
    }
  },
);

// POST /:id/refund-claim/approve — admin: approve
casesRouter.post(
  "/:id/refund-claim/approve",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }
      const claim = await storage.getRefundClaimByCase(req.params.id);
      if (!claim) { res.status(404).json({ error: "No refund claim found" }); return; }
      const { adminNotes } = req.body as { adminNotes?: string | null };
      const adminUser = await resolveAdminUsernameFromReq(req);
      await storage.updateRefundClaim(claim.id, {
        status: "approved",
        adminNotes: adminNotes ?? null,
        reviewedAt: new Date(),
        reviewedBy: adminUser,
      });
      await storage.updateCase(req.params.id, { refundClaimStatus: "approved" });
      await storage.createAuditLog({
        action: "refund_claim_approved",
        targetType: "case",
        targetId: req.params.id,
        adminUsername: adminUser,
        newValue: adminNotes ? `Approved. Notes: ${adminNotes.slice(0, 200)}` : "Approved.",
      });
      const portalUrl = `${req.protocol}://${req.get("host")}`;
      emailService.sendRefundClaimApproved({
        to: caseData.userEmail!,
        caseId: caseData.id,
        adminNotes: adminNotes ?? null,
        portalUrl,
        locale: caseData.preferredLocale ?? "en",
      }).catch(() => {});
      res.json({ success: true, emailDispatched: true });
    } catch (err) {
      warnOnce("cases:post-refund-claim-approve-failed", "POST refund-claim/approve failed:", err);
      res.status(500).json({ error: "Failed to approve refund claim" });
    }
  },
);

// POST /:id/refund-claim/reject — admin: reject
casesRouter.post(
  "/:id/refund-claim/reject",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }
      const claim = await storage.getRefundClaimByCase(req.params.id);
      if (!claim) { res.status(404).json({ error: "No refund claim found" }); return; }
      const { adminNotes } = req.body as { adminNotes?: string | null };
      const adminUser = await resolveAdminUsernameFromReq(req);
      await storage.updateRefundClaim(claim.id, {
        status: "rejected",
        adminNotes: adminNotes ?? null,
        reviewedAt: new Date(),
        reviewedBy: adminUser,
      });
      await storage.updateCase(req.params.id, { refundClaimStatus: "rejected" });
      await storage.createAuditLog({
        action: "refund_claim_rejected",
        targetType: "case",
        targetId: req.params.id,
        adminUsername: adminUser,
        newValue: adminNotes ? `Rejected. Notes: ${adminNotes.slice(0, 200)}` : "Rejected.",
      });
      const portalUrl = `${req.protocol}://${req.get("host")}`;
      emailService.sendRefundClaimRejected({
        to: caseData.userEmail!,
        caseId: caseData.id,
        adminNotes: adminNotes ?? null,
        portalUrl,
        locale: caseData.preferredLocale ?? "en",
      }).catch(() => {});
      res.json({ success: true, emailDispatched: true });
    } catch (err) {
      warnOnce("cases:post-refund-claim-reject-failed", "POST refund-claim/reject failed:", err);
      res.status(500).json({ error: "Failed to reject refund claim" });
    }
  },
);

// POST /:id/refund-claim/unapprove — admin: revert an approved claim back to
// 'submitted' so it can be re-reviewed. Clears reviewer stamps.
casesRouter.post(
  "/:id/refund-claim/unapprove",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }
      const claim = await storage.getRefundClaimByCase(req.params.id);
      if (!claim) { res.status(404).json({ error: "No refund claim found" }); return; }
      if (claim.status !== "approved") {
        res.status(409).json({ error: "Only approved claims can be unapproved." });
        return;
      }
      const adminUser = await resolveAdminUsernameFromReq(req);
      await storage.updateRefundClaim(claim.id, {
        status: "submitted",
        adminNotes: null,
        reviewedAt: null,
        reviewedBy: null,
      });
      await storage.updateCase(req.params.id, { refundClaimStatus: "submitted" });
      await storage.createAuditLog({
        action: "refund_claim_unapproved",
        targetType: "case",
        targetId: req.params.id,
        adminUsername: adminUser,
        newValue: "Approval reverted — claim returned to submitted for re-review.",
      });
      res.json({ success: true });
    } catch (err) {
      warnOnce("cases:post-refund-claim-unapprove-failed", "POST refund-claim/unapprove failed:", err);
      res.status(500).json({ error: "Failed to unapprove refund claim" });
    }
  },
);

// ---------------------------------------------------------------------------
// Stage Skip Request — agent/admin-initiated, super_admin-reviewed
// ---------------------------------------------------------------------------

// POST /:id/stage-skip-request — submit a request for a non-sequential
// stage transition. Requires at least the "agent" role. The request is stored
// on the case and surfaced only to super_admin in the case dialog.
casesRouter.post(
  "/:id/stage-skip-request",
  checkAdminAuth,
  requireAdminRole("agent"),
  async (req, res) => {
    try {
      const adminUser = (req as any).adminUsername ?? "Admin";
      const bodySchema = z.object({
        targetStage: z.string().regex(/^([1-9]|1[0-4])$/, "targetStage must be a number between 1 and 14"),
        reason: z.string().min(1, "A reason is required"),
      });
      let parsed: z.infer<typeof bodySchema>;
      try {
        parsed = bodySchema.parse(req.body);
      } catch (zodErr) {
        if (zodErr instanceof z.ZodError) {
          res.status(400).json({ error: zodErr.errors[0]?.message ?? "Invalid request" });
        } else {
          res.status(400).json({ error: "Invalid request" });
        }
        return;
      }

      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }

      const currentStageNum = parseInt(caseData.withdrawalStage ?? "1", 10);
      const targetStageNum = parseInt(parsed.targetStage, 10);
      if (targetStageNum === currentStageNum + 1) {
        res.status(400).json({ error: "This transition is already sequential and does not require a skip request." });
        return;
      }
      if (targetStageNum === currentStageNum) {
        res.status(400).json({ error: "The target stage is the current stage — no transition needed." });
        return;
      }

      await storage.runInTransaction(async (tx) => {
        await storage.updateCase(req.params.id, {
          stageSkipRequestedBy: adminUser,
          stageSkipRequestedAt: new Date(),
          stageSkipTargetStage: parsed.targetStage,
          stageSkipReason: parsed.reason,
          stageSkipStatus: "pending",
        } as any, tx);
        await storage.createAuditLog({
          action: "stage_skip_requested",
          newValue: JSON.stringify({
            from: currentStageNum,
            to: targetStageNum,
            reason: parsed.reason,
            requestedBy: adminUser,
          }).slice(0, 4000),
          adminUsername: adminUser,
          targetType: "case",
          targetId: req.params.id,
        }, tx);
      });

      res.json({ success: true });
    } catch (err) {
      warnOnce("cases:post-stage-skip-request-failed", "POST stage-skip-request failed:", err);
      res.status(500).json({ error: "Failed to submit stage skip request" });
    }
  },
);

// POST /:id/stage-skip-request/approve — super_admin only: approve a pending
// skip request. Applies the non-sequential stage transition with the stored
// reason as the override reason and clears the request state.
casesRouter.post(
  "/:id/stage-skip-request/approve",
  checkAdminAuth,
  requireAdminRole("super_admin"),
  async (req, res) => {
    try {
      const adminUser = (req as any).adminUsername ?? "Admin";
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }
      if (caseData.stageSkipStatus !== "pending") {
        res.status(400).json({ error: "No pending stage skip request found for this case." });
        return;
      }
      const targetStage = caseData.stageSkipTargetStage;
      const reason = caseData.stageSkipReason;
      if (!targetStage) {
        res.status(400).json({ error: "Pending request is missing a target stage." });
        return;
      }

      await storage.runInTransaction(async (tx) => {
        // Apply the non-sequential stage override using the stored reason.
        await caseService.updateCase(
          req.params.id,
          { withdrawalStage: targetStage } as any,
          tx,
          {
            adminRole: "super_admin",
            overrideStageSequence: true,
            overrideReason: reason ?? `Stage skip approved by ${adminUser}`,
          },
        );
        // Mark the request as approved.
        await storage.updateCase(req.params.id, {
          stageSkipStatus: "approved",
        } as any, tx);
        // Audit row for the approval decision itself.
        await storage.createAuditLog({
          action: "stage_skip_approved",
          newValue: JSON.stringify({
            from: caseData.withdrawalStage,
            to: targetStage,
            reason: reason ?? null,
            requestedBy: caseData.stageSkipRequestedBy ?? null,
            approvedBy: adminUser,
          }).slice(0, 4000),
          adminUsername: adminUser,
          targetType: "case",
          targetId: req.params.id,
        }, tx);
      });

      res.json({ success: true });
    } catch (err) {
      if (err instanceof StageTransitionError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      warnOnce("cases:post-stage-skip-request-approve-failed", "POST stage-skip-request/approve failed:", err);
      res.status(500).json({ error: "Failed to approve stage skip request" });
    }
  },
);

// POST /:id/stage-skip-request/reject — super_admin only: reject a pending
// skip request. Records an optional reject reason and marks the request
// as rejected (so the requesting admin can see the outcome).
casesRouter.post(
  "/:id/stage-skip-request/reject",
  checkAdminAuth,
  requireAdminRole("super_admin"),
  async (req, res) => {
    try {
      const adminUser = (req as any).adminUsername ?? "Admin";
      const rejectReason = typeof req.body?.rejectReason === "string" ? req.body.rejectReason.trim() : undefined;

      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }
      if (caseData.stageSkipStatus !== "pending") {
        res.status(400).json({ error: "No pending stage skip request found for this case." });
        return;
      }

      await storage.runInTransaction(async (tx) => {
        await storage.updateCase(req.params.id, {
          stageSkipStatus: "rejected",
        } as any, tx);
        await storage.createAuditLog({
          action: "stage_skip_rejected",
          newValue: JSON.stringify({
            targetStage: caseData.stageSkipTargetStage ?? null,
            reason: caseData.stageSkipReason ?? null,
            requestedBy: caseData.stageSkipRequestedBy ?? null,
            rejectedBy: adminUser,
            rejectReason: rejectReason ?? null,
          }).slice(0, 4000),
          adminUsername: adminUser,
          targetType: "case",
          targetId: req.params.id,
        }, tx);
      });

      res.json({ success: true });
    } catch (err) {
      warnOnce("cases:post-stage-skip-request-reject-failed", "POST stage-skip-request/reject failed:", err);
      res.status(500).json({ error: "Failed to reject stage skip request" });
    }
  },
);

// GET /:id/refund-claim/certificate — admin-only: generate certificate PDF
casesRouter.get(
  "/:id/refund-claim/certificate",
  checkAdminAuth,
  async (req, res) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) { res.status(404).json({ error: "Case not found" }); return; }
      const claim = await storage.getRefundClaimByCase(req.params.id);
      if (!claim) { res.status(404).json({ error: "No refund claim found" }); return; }
      if (claim.status !== "approved") {
        res.status(400).json({ error: "Certificate only available for approved claims." }); return;
      }
      const pdf = await buildRefundClaimCertificate({
        claim,
        caseId: caseData.id,
        holderName: caseData.userName ?? "Account Holder",
        holderEmail: caseData.userEmail ?? "",
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="IBCCF-RefundCertificate-${caseData.id}.pdf"`);
      res.send(pdf);
    } catch (err) {
      warnOnce("cases:get-refund-claim-certificate-failed", "GET refund-claim/certificate failed:", err);
      res.status(500).json({ error: "Failed to generate certificate" });
    }
  },
);
