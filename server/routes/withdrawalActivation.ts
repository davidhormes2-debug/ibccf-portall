import { Router, type Request, type Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { storage } from "../storage";
import { checkAdminAuth } from "./middleware";
import { requirePortalAccess, requirePortalSessionOnly } from "../services/portal-auth";
import { rateLimiter } from "../middleware";
import {
  OTP_ISSUE_RATE_LIMIT_NAMESPACE,
  OTP_VERIFY_RATE_LIMIT_NAMESPACE,
} from "../middleware/security";
import {
  computeTokenDepositRequired,
  formatUsdt,
} from "@shared/tokenDeposit";
import { warnOnce } from "../lib/warnOnce";

// Tight rate limit on OTP issuance — 5 sends per 10 min per IP — to prevent
// abuse of SMTP and email-flood the user. Persisted to the DB so the cap
// holds across autoscale instances (otherwise an attacker could rotate
// across instances to multiply the per-IP send budget).
const otpIssueRateLimit = rateLimiter(5, 10 * 60 * 1000, {
  persistNamespace: OTP_ISSUE_RATE_LIMIT_NAMESPACE,
});
// Verification is also rate-limited so an attacker cannot brute-force the
// 6-digit space (the per-token attempts cap is the second line of defence).
// Persisted so cross-instance brute-force is bounded at the per-IP budget
// rather than (per-IP × instance-count).
const otpVerifyRateLimit = rateLimiter(20, 10 * 60 * 1000, {
  persistNamespace: OTP_VERIFY_RATE_LIMIT_NAMESPACE,
});

// Per-case OTP issuance throttle — an additional axis on top of the per-IP
// limiter so a single attacker rotating IPs (or a buggy client) still can't
// email-flood the user. 5 sends / 10 min per case.
//
// Intentionally in-memory only: this is a defence-in-depth axis on top of
// `otpIssueRateLimit` (DB-backed per-IP) and the DB-persisted
// `withdrawal_activation_token` row that records `lastResendAt` /
// `resendCount` per token. A cross-instance bypass of THIS map alone
// still hits the per-token resend cooldown + the per-IP cap, so the
// abuse impact is bounded. A DB-backed per-case counter would add a
// write to every OTP issuance for marginal real-world benefit.
const PER_CASE_OTP_LIMIT = 5;
// 10 minutes — matches the per-IP `otpIssueRateLimit` window and the OTP
// token TTL. Shrinking this makes the 5-sends budget reset faster, amplifying
// the per-case SMTP flood surface just as surely as raising PER_CASE_OTP_LIMIT.
// Snapshot-guarded in server/__tests__/otpRateLimit.test.ts
// (PER_CASE_OTP_WINDOW_MS window snapshot guard).
const PER_CASE_OTP_WINDOW_MS = 10 * 60 * 1000;
const perCaseOtpHits = new Map<string, number[]>();
function perCaseOtpAllowed(caseId: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const arr = (perCaseOtpHits.get(caseId) ?? []).filter(
    (ts) => now - ts < PER_CASE_OTP_WINDOW_MS,
  );
  if (arr.length >= PER_CASE_OTP_LIMIT) {
    const retryAfter = Math.ceil((PER_CASE_OTP_WINDOW_MS - (now - arr[0])) / 1000);
    perCaseOtpHits.set(caseId, arr);
    return { allowed: false, retryAfter };
  }
  arr.push(now);
  perCaseOtpHits.set(caseId, arr);
  return { allowed: true, retryAfter: 0 };
}

// 10 minutes — matches PER_CASE_OTP_WINDOW_MS (the per-case OTP send budget
// resets on the same cadence the issued token is valid for) and gives users a
// comfortable window to retrieve and enter the code before it expires.
// Snapshot-guarded in server/__tests__/otpRateLimit.test.ts (TOKEN_TTL_MS
// window snapshot guard). If you intentionally change this, update the
// EXPECTED_TOKEN_TTL_MS literal in that test AND this comment in the same
// commit.
const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Cap on wrong-code guesses against a single issued token before it is
// invalidated. This is the primary brute-force defence for the 6-digit code
// space (the per-IP otpVerifyRateLimit is the secondary axis). Raising this
// value widens the guess budget per token; lowering it locks legitimate users
// out after fewer typos.
// Snapshot-guarded in server/__tests__/otpRateLimit.test.ts (TOKEN_MAX_ATTEMPTS
// snapshot guard). If you intentionally change this, update the
// EXPECTED_TOKEN_MAX_ATTEMPTS literal in that test AND this comment in the
// same commit.
const TOKEN_MAX_ATTEMPTS = 5;

// Minimum time a user must wait between OTP resend requests. Prevents
// mail-bombing the case holder's inbox via rapid resend clicks (independent
// of the per-IP/per-case send caps, which reset on a longer window).
// Shortening this increases the achievable resend/mail-bombing rate; the
// per-IP and per-case caps above only bound the total count, not the cadence.
// Snapshot-guarded in server/__tests__/otpRateLimit.test.ts
// (TOKEN_RESEND_COOLDOWN_MS snapshot guard). If you intentionally change
// this, update the EXPECTED_TOKEN_RESEND_COOLDOWN_MS literal in that test AND
// this comment in the same commit.
const TOKEN_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

const GLOBAL_MIN_USDT_KEY = "withdrawal_activation_min_usdt_default";

const HEX_OR_BASE58 = /^[A-Za-z0-9._:-]{8,200}$/;

const submitAddressBody = z.object({
  withdrawalAddressSubmitted: z.string().trim().regex(HEX_OR_BASE58, {
    message: "Wallet address contains unsupported characters",
  }),
  withdrawalDetailsAsset: z.string().trim().min(1).max(40),
  withdrawalDetailsNetwork: z.string().trim().min(1).max(60),
  withdrawalDetailsAmount: z.string().trim().min(1).max(120),
  withdrawalDetailsMemo: z.string().trim().max(500).optional().nullable(),
});

const verifyTokenBody = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Code must be 6 digits"),
});

// Numeric-validated min USDT — accepts up to 2 decimal places, 0 to 10 million.
const MIN_USDT_RE = /^\d{1,8}(\.\d{1,2})?$/;
const adminActivationBody = z.object({
  withdrawalActivationMinUsdt: z
    .string()
    .trim()
    .max(40)
    .refine(
      (v) => v === '' || (MIN_USDT_RE.test(v) && Number(v) >= 0 && Number(v) <= 10_000_000),
      { message: "Minimum USDT must be a non-negative number with up to 2 decimals (max 10,000,000)." },
    )
    .nullable()
    .optional(),
  withdrawalSecurityTokenRequired: z.boolean().optional(),
  tokenDepositRatePer100k: z
    .string()
    .trim()
    .max(40)
    .refine(
      (v) => v === '' || (/^\d{1,8}(\.\d{1,2})?$/.test(v) && Number(v) >= 0 && Number(v) <= 10_000_000),
      { message: "Rate must be a non-negative number with up to 2 decimals (max 10,000,000)." },
    )
    .nullable()
    .optional(),
});

const adminReviewBody = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(2000).optional().nullable(),
});

interface AdminAuthedRequest extends Request {
  admin?: { username?: string };
}

function generateSixDigitCode(): string {
  // Cryptographically random 6-digit (000000-999999) code.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, '0');
}

async function fireActivationEmail(
  caseId: string,
  templateKey:
    | 'withdrawalActivationCode'
    | 'withdrawalActivationReceiptReceived'
    | 'withdrawalActivationApproved'
    | 'withdrawalActivationRejected'
    | 'withdrawalActivationAddressSubmitted'
    | 'withdrawalActivationTokenVerified',
  logTag: string,
  adminUser: string,
  vars: Record<string, string | number> = {},
): Promise<void> {
  try {
    const caseRow = await storage.getCaseById(caseId);
    if (!caseRow?.userEmail) return;
    const [{ emailService }, { sendCaseEmailWithAudit }] = await Promise.all([
      import('../services/EmailService'),
      import('../services/emailNotify'),
    ]);
    const userName = (caseRow.userName ?? '').trim() || caseRow.userEmail;
    await sendCaseEmailWithAudit({
      to: caseRow.userEmail,
      caseId,
      tag: logTag,
      adminUser,
      send: (locale) =>
        emailService.sendLocalizedCaseEmail({
          to: caseRow.userEmail!,
          userName,
          caseRef: caseRow.id,
          locale,
          templateKey,
          ctaPath: '/portal?view=withdrawalActivation',
          logTag,
          vars,
        }),
    });
  } catch (err) {
    console.error(`[withdrawalActivation] ${logTag} email failed:`, err);
  }
}

async function resolveActivationMinUsdt(caseRow: { withdrawalActivationMinUsdt: string | null }): Promise<string> {
  const perCase = (caseRow.withdrawalActivationMinUsdt ?? '').trim();
  if (perCase) return perCase;
  try {
    const row = await storage.getAppSetting(GLOBAL_MIN_USDT_KEY);
    return (row?.value ?? '').trim() || '0';
  } catch {
    return '0';
  }
}

export function registerCaseWithdrawalActivationRoutes(router: Router): void {
  // ------------------------------------------------------------------
  // Portal: read activation status (includes resolved min USDT)
  // ------------------------------------------------------------------
  router.get(
    "/:id/withdrawal-activation",
    requirePortalAccess,
    async (req: Request, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        const minUsdt = await resolveActivationMinUsdt(caseRow);
        const activeToken = await storage.getActiveWithdrawalSecurityToken(caseRow.id);
        const tokenLive =
          activeToken &&
          !activeToken.consumedAt &&
          activeToken.expiresAt.getTime() > Date.now() &&
          activeToken.attempts < TOKEN_MAX_ATTEMPTS;
        res.json({
          status: caseRow.withdrawalActivationStatus ?? 'pending_address',
          withdrawalAddressSubmitted: caseRow.withdrawalAddressSubmitted,
          withdrawalDetailsAsset: caseRow.withdrawalDetailsAsset,
          withdrawalDetailsNetwork: caseRow.withdrawalDetailsNetwork,
          withdrawalDetailsAmount: caseRow.withdrawalDetailsAmount,
          withdrawalDetailsMemo: caseRow.withdrawalDetailsMemo,
          minUsdt,
          securityTokenRequired: caseRow.withdrawalSecurityTokenRequired !== false,
          receiptId: caseRow.withdrawalActivationReceiptId,
          approvedAt: caseRow.withdrawalActivationApprovedAt,
          rejectedAt: caseRow.withdrawalActivationRejectedAt,
          rejectionReason: caseRow.withdrawalActivationRejectionReason,
          addressSubmittedAt: caseRow.withdrawalAddressSubmittedAt,
          tokenVerifiedAt: caseRow.withdrawalTokenVerifiedAt,
          tokenLive: Boolean(tokenLive),
          tokenIssuedAt: activeToken?.createdAt ?? null,
          tokenExpiresAt: activeToken?.expiresAt ?? null,
          tokenAttempts: activeToken?.attempts ?? 0,
          tokenMaxAttempts: TOKEN_MAX_ATTEMPTS,
          depositAddress: caseRow.depositAddress,
          depositAsset: caseRow.depositAsset,
          depositNetwork: caseRow.depositNetwork,
          // Scaling token-deposit fields for the portal
          tokenDepositRatePer100k: caseRow.tokenDepositRatePer100k ?? '600',
          tokenDepositRequiredUsdt: computeTokenDepositRequired(
            caseRow.withdrawalAmount,
            caseRow.tokenDepositRatePer100k,
          ),
          tokenDepositPaidAmount: caseRow.tokenDepositPaidAmount,
          tokenDepositPermitCount: caseRow.tokenDepositPermitCount ?? 0,
          tokenDepositLastPermittedAt: caseRow.tokenDepositLastPermittedAt,
        });
      } catch (err) {
        warnOnce("withdrawalActivation:get", "[withdrawalActivation] get failed", err);
        res.status(500).json({ error: "Failed to load activation status" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Portal: submit withdrawal address + details (step 1 → step 2/3)
  // ------------------------------------------------------------------
  router.post(
    "/:id/withdrawal-activation/address",
    requirePortalSessionOnly,
    async (req: Request, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        const stage = parseInt(caseRow.withdrawalStage || '0', 10);
        if (!Number.isFinite(stage) || stage < 14) {
          res.status(403).json({
            error: "Withdrawal activation is only available at the final stage.",
          });
          return;
        }
        if (caseRow.withdrawalActivationStatus === 'approved') {
          res.status(409).json({ error: "Activation has already been approved." });
          return;
        }
        let body: z.infer<typeof submitAddressBody>;
        try {
          body = submitAddressBody.parse(req.body);
        } catch (parseErr) {
          if (parseErr instanceof z.ZodError) {
            res.status(400).json({ error: "Invalid request" });
            return;
          }
          throw parseErr;
        }

        // If a security token is required, move to awaiting_token; otherwise
        // skip straight to awaiting_deposit so the user can upload a receipt.
        const tokenRequired = caseRow.withdrawalSecurityTokenRequired !== false;
        const nextStatus = tokenRequired ? 'awaiting_token' : 'awaiting_deposit';

        try {
          await storage.runInTransaction(async (tx) => {
            await storage.updateCase(caseRow.id, {
              withdrawalAddressSubmitted: body.withdrawalAddressSubmitted,
              withdrawalDetailsAsset: body.withdrawalDetailsAsset,
              withdrawalDetailsNetwork: body.withdrawalDetailsNetwork,
              withdrawalDetailsAmount: body.withdrawalDetailsAmount,
              withdrawalDetailsMemo: body.withdrawalDetailsMemo ?? null,
              withdrawalActivationStatus: nextStatus,
              withdrawalAddressSubmittedAt: new Date(),
            }, tx);
            await storage.createAuditLog({
              action: 'withdrawal_address_submitted',
              newValue: JSON.stringify({
                address: body.withdrawalAddressSubmitted,
                asset: body.withdrawalDetailsAsset,
                network: body.withdrawalDetailsNetwork,
                amount: body.withdrawalDetailsAmount,
                nextStatus,
              }).slice(0, 4000),
              adminUsername: 'User',
              targetType: 'case',
              targetId: caseRow.id,
            }, tx);
          });
        } catch (txErr) {
          console.error('[withdrawalActivation] submit address transaction failed:', txErr);
          res.status(500).json({ error: "Failed to submit withdrawal details" });
          return;
        }

        // Best-effort transition email so the user has an out-of-band trail.
        void fireActivationEmail(
          caseRow.id,
          'withdrawalActivationAddressSubmitted',
          'withdrawal-activation-address-submitted',
          'User',
          {
            asset: body.withdrawalDetailsAsset,
            network: body.withdrawalDetailsNetwork,
          },
        );

        res.json({ status: nextStatus });
      } catch (err) {
        console.error('[withdrawalActivation] submit address failed:', err);
        res.status(500).json({ error: "Failed to submit withdrawal details" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Portal: request a fresh OTP (rate-limited + 60s cooldown)
  // ------------------------------------------------------------------
  router.post(
    "/:id/withdrawal-activation/token/request",
    otpIssueRateLimit,
    requirePortalSessionOnly,
    async (req: Request, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        const perCase = perCaseOtpAllowed(caseRow.id);
        if (!perCase.allowed) {
          res.status(429).json({
            error: `Too many security-code requests for this case. Please wait ${perCase.retryAfter}s.`,
            retryAfter: perCase.retryAfter,
          });
          return;
        }
        if (caseRow.withdrawalSecurityTokenRequired === false) {
          res.status(400).json({ error: "Security code is not required for this case." });
          return;
        }
        if (caseRow.withdrawalActivationStatus === 'approved') {
          res.status(409).json({ error: "Activation has already been approved." });
          return;
        }
        // Tight state machine: OTP issuance is only meaningful during the
        // token step. Allowing later statuses (awaiting_deposit /
        // awaiting_admin_approval / rejected) would let a user issue codes
        // after the token phase is already complete.
        if (caseRow.withdrawalActivationStatus !== 'awaiting_token') { // strict-inequality-guard
          res.status(409).json({
            error: "Security code is not required at this step.",
          });
          return;
        }
        if (!caseRow.userEmail) {
          res.status(400).json({ error: "No email on file for this case. Contact your case officer." });
          return;
        }

        // 60s resend cooldown — measured against the most recent token.
        const last = await storage.getActiveWithdrawalSecurityToken(caseRow.id);
        if (last && Date.now() - last.createdAt.getTime() < TOKEN_RESEND_COOLDOWN_MS) {
          const retryAfter = Math.ceil(
            (TOKEN_RESEND_COOLDOWN_MS - (Date.now() - last.createdAt.getTime())) / 1000,
          );
          res.status(429).json({
            error: `Please wait ${retryAfter}s before requesting another code.`,
            retryAfter,
          });
          return;
        }

        const code = generateSixDigitCode();
        const codeHash = await bcrypt.hash(code, 10);
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
        try {
          await storage.runInTransaction(async (tx) => {
            await storage.createWithdrawalSecurityToken({
              caseId: caseRow.id,
              codeHash,
              expiresAt,
            }, tx);
            await storage.createAuditLog({
              action: 'withdrawal_token_issued',
              newValue: `Withdrawal activation security code issued (expires ${expiresAt.toISOString()})`,
              adminUsername: 'User',
              targetType: 'case',
              targetId: caseRow.id,
            }, tx);
          });
        } catch (txErr) {
          console.error('[withdrawalActivation] token issued transaction failed:', txErr);
          res.status(500).json({ error: "Failed to issue security code" });
          return;
        }

        // Best-effort, non-blocking — the code is in the email body only.
        void fireActivationEmail(
          caseRow.id,
          'withdrawalActivationCode',
          'withdrawal-activation-code',
          'User',
          { code, expiresInMinutes: TOKEN_TTL_MS / 60_000 },
        );

        res.json({
          ok: true,
          expiresAt,
          maxAttempts: TOKEN_MAX_ATTEMPTS,
        });
      } catch (err) {
        console.error('[withdrawalActivation] token request failed:', err);
        res.status(500).json({ error: "Failed to issue security code" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Portal: verify an OTP — advances awaiting_token → awaiting_deposit
  // ------------------------------------------------------------------
  router.post(
    "/:id/withdrawal-activation/token/verify",
    otpVerifyRateLimit,
    requirePortalSessionOnly,
    async (req: Request, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        let body: z.infer<typeof verifyTokenBody>;
        try {
          body = verifyTokenBody.parse(req.body);
        } catch (parseErr) {
          if (parseErr instanceof z.ZodError) {
            res.status(400).json({ error: "Invalid request" });
            return;
          }
          throw parseErr;
        }
        const token = await storage.getActiveWithdrawalSecurityToken(caseRow.id);
        if (!token) {
          res.status(400).json({ error: "No security code on file. Please request a new one." });
          return;
        }
        if (token.consumedAt) {
          res.status(400).json({ error: "This code was already used. Please request a new one." });
          return;
        }
        if (token.expiresAt.getTime() <= Date.now()) {
          res.status(400).json({ error: "This code has expired. Please request a new one." });
          return;
        }
        if (token.attempts >= TOKEN_MAX_ATTEMPTS) {
          res.status(429).json({ error: "Too many failed attempts. Please request a new code." });
          return;
        }
        const ok = await bcrypt.compare(body.code, token.codeHash);
        if (!ok) {
          await storage.incrementWithdrawalSecurityTokenAttempts(token.id);
          const remaining = Math.max(0, TOKEN_MAX_ATTEMPTS - (token.attempts + 1));
          res.status(400).json({
            error: `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
            remaining,
          });
          return;
        }

        try {
          await storage.runInTransaction(async (tx) => {
            await storage.markWithdrawalSecurityTokenConsumed(token.id, tx);
            await storage.updateCase(caseRow.id, {
              withdrawalActivationStatus: 'awaiting_deposit',
              withdrawalTokenVerifiedAt: new Date(),
            }, tx);
            await storage.createAuditLog({
              action: 'withdrawal_token_verified',
              newValue: `Withdrawal activation security code verified`,
              adminUsername: 'User',
              targetType: 'case',
              targetId: caseRow.id,
            }, tx);
          });
        } catch (txErr) {
          console.error('[withdrawalActivation] token verified transaction failed:', txErr);
          res.status(500).json({ error: "Failed to verify security code" });
          return;
        }

        void fireActivationEmail(
          caseRow.id,
          'withdrawalActivationTokenVerified',
          'withdrawal-activation-token-verified',
          'User',
        );

        res.json({ ok: true, status: 'awaiting_deposit' });
      } catch (err) {
        console.error('[withdrawalActivation] token verify failed:', err);
        res.status(500).json({ error: "Failed to verify security code" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Portal: link an uploaded deposit receipt to this activation flow
  // ------------------------------------------------------------------
  // The user uploads the receipt via the existing
  // POST /api/cases/:id/deposit-receipts endpoint; then this endpoint
  // tags it as the activation receipt and moves the flow forward.
  router.post(
    "/:id/withdrawal-activation/receipt",
    requirePortalSessionOnly,
    async (req: Request, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        const body = z.object({
          receiptId: z.number().int().positive(),
        }).parse(req.body);
        const receipt = await storage.getDepositReceiptById(body.receiptId);
        if (!receipt || receipt.caseId !== caseRow.id) {
          res.status(404).json({ error: "Receipt not found for this case." });
          return;
        }
        if (caseRow.withdrawalActivationStatus !== 'awaiting_deposit' && // strict-inequality-guard
            caseRow.withdrawalActivationStatus !== 'rejected' && // strict-inequality-guard
            caseRow.withdrawalActivationStatus !== 'awaiting_admin_approval') { // strict-inequality-guard
          res.status(409).json({
            error: "Activation flow is not awaiting a deposit receipt right now.",
          });
          return;
        }
        try {
          await storage.runInTransaction(async (tx) => {
            await storage.updateCase(caseRow.id, {
              withdrawalActivationReceiptId: receipt.id,
              withdrawalActivationStatus: 'awaiting_admin_approval',
              // Clear any prior rejection so the user-facing banner reflects the
              // fresh upload, not the previous reject reason.
              withdrawalActivationRejectedAt: null,
              withdrawalActivationRejectionReason: null,
            }, tx);
            await storage.createAuditLog({
              action: 'withdrawal_activation_receipt_uploaded',
              newValue: JSON.stringify({ receiptId: receipt.id }).slice(0, 4000),
              adminUsername: 'User',
              targetType: 'case',
              targetId: caseRow.id,
            }, tx);
          });
        } catch (txErr) {
          console.error('[withdrawalActivation] link receipt transaction failed:', txErr);
          res.status(500).json({ error: "Failed to attach receipt" });
          return;
        }
        void fireActivationEmail(
          caseRow.id,
          'withdrawalActivationReceiptReceived',
          'withdrawal-activation-receipt',
          'User',
        );
        res.json({ ok: true, status: 'awaiting_admin_approval' });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(400).json({ error: "Invalid request" });
          return;
        }
        console.error('[withdrawalActivation] link receipt failed:', err);
        res.status(500).json({ error: "Failed to attach receipt" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Portal: upload activation receipt directly (sealed-safe)
  // ------------------------------------------------------------------
  // The standard /:id/deposit-receipts endpoint is guarded by
  // requireUnsealed — but the activation flow is gated to stage 14
  // (i.e. after the case may already be sealed). This endpoint accepts
  // the receipt directly so a sealed case can still complete activation.
  // Reuses the same constraints expected of the standard uploader:
  // base64 data URL, ≤10MB, PDF/PNG/JPEG/WEBP only.
  router.post(
    "/:id/withdrawal-activation/receipt-upload",
    requirePortalSessionOnly,
    async (req: Request, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        if (caseRow.withdrawalActivationStatus !== 'awaiting_deposit' && // strict-inequality-guard
            caseRow.withdrawalActivationStatus !== 'rejected' && // strict-inequality-guard
            caseRow.withdrawalActivationStatus !== 'awaiting_admin_approval') { // strict-inequality-guard
          res.status(409).json({
            error: "Activation flow is not awaiting a deposit receipt right now.",
          });
          return;
        }
        const body = z.object({
          imageData: z
            .string()
            .min(64, "Receipt is empty or too small to be a valid file."),
          fileName: z.string().max(255).optional(),
          notes: z.string().max(2000).optional(),
        }).parse(req.body);

        const ALLOWED = /^data:(application\/pdf|image\/(png|jpeg|webp));base64,/;
        const match = ALLOWED.exec(body.imageData);
        if (!match) {
          res.status(400).json({
            error: "Receipt must be a base64 data URL of PDF, PNG, JPEG, or WEBP.",
          });
          return;
        }
        // Approximate decoded byte length from the base64 payload size.
        const b64 = body.imageData.slice(body.imageData.indexOf(',') + 1);
        const approxBytes = Math.floor((b64.length * 3) / 4);
        const MAX_BYTES = 10 * 1024 * 1024; // 10MB — parity with existing uploader.
        if (approxBytes > MAX_BYTES) {
          res.status(413).json({ error: "Receipt exceeds the 10MB size limit." });
          return;
        }

        let receipt: Awaited<ReturnType<typeof storage.createDepositReceipt>>;
        try {
          receipt = await storage.runInTransaction(async (tx) => {
            const r = await storage.createDepositReceipt({
              caseId: caseRow.id,
              imageData: body.imageData,
              fileName: body.fileName || null,
              notes: body.notes || 'Withdrawal activation deposit',
              status: 'pending',
              reissueId: null,
            }, tx);
            await storage.updateCase(caseRow.id, {
              withdrawalActivationReceiptId: r.id,
              withdrawalActivationStatus: 'awaiting_admin_approval',
              withdrawalActivationRejectedAt: null,
              withdrawalActivationRejectionReason: null,
            }, tx);
            await storage.createAuditLog({
              action: 'withdrawal_activation_receipt_uploaded',
              newValue: JSON.stringify({ receiptId: r.id }).slice(0, 4000),
              adminUsername: 'User',
              targetType: 'case',
              targetId: caseRow.id,
            }, tx);
            return r;
          });
        } catch (txErr) {
          console.error('[withdrawalActivation] receipt-upload transaction failed:', txErr);
          res.status(500).json({ error: "Failed to upload receipt" });
          return;
        }
        void fireActivationEmail(
          caseRow.id,
          'withdrawalActivationReceiptReceived',
          'withdrawal-activation-receipt',
          'User',
        );
        res.json({ ok: true, status: 'awaiting_admin_approval', receiptId: receipt.id });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(400).json({ error: "Invalid request" });
          return;
        }
        console.error('[withdrawalActivation] receipt-upload failed:', err);
        res.status(500).json({ error: "Failed to upload receipt" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: update per-case settings (min USDT + token toggle)
  // ------------------------------------------------------------------
  router.patch(
    "/:id/withdrawal-activation/admin",
    checkAdminAuth,
    async (req: AdminAuthedRequest, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        let body: z.infer<typeof adminActivationBody>;
        try {
          body = adminActivationBody.parse(req.body);
        } catch (parseErr) {
          if (parseErr instanceof z.ZodError) {
            res.status(400).json({ error: "Invalid request" });
            return;
          }
          throw parseErr;
        }
        const patch: Record<string, unknown> = {};
        if (body.withdrawalActivationMinUsdt !== undefined) {
          patch.withdrawalActivationMinUsdt =
            body.withdrawalActivationMinUsdt && body.withdrawalActivationMinUsdt.trim()
              ? body.withdrawalActivationMinUsdt.trim()
              : null;
        }
        if (body.withdrawalSecurityTokenRequired !== undefined) {
          patch.withdrawalSecurityTokenRequired = body.withdrawalSecurityTokenRequired;
          // Auto-advance: if the case was stuck in `awaiting_token` because
          // the OTP was previously required, turning the requirement off
          // must release the user into the deposit step — otherwise the UI
          // hides the OTP step yet still gates on `awaiting_token`, leaving
          // the user with no actionable next step.
          if (
            body.withdrawalSecurityTokenRequired === false &&
            caseRow.withdrawalActivationStatus === 'awaiting_token' // strict-equality-guard
          ) {
            patch.withdrawalActivationStatus = 'awaiting_deposit';
          }
          // Symmetric handling: re-enabling the requirement while the user
          // is already in the deposit step (but hasn't uploaded a receipt
          // yet) bounces them back to obtain a code first.
          if (
            body.withdrawalSecurityTokenRequired === true &&
            caseRow.withdrawalActivationStatus === 'awaiting_deposit' && // strict-equality-guard
            !caseRow.withdrawalActivationReceiptId &&
            !caseRow.withdrawalTokenVerifiedAt
          ) {
            patch.withdrawalActivationStatus = 'awaiting_token';
          }
        }
        if (body.tokenDepositRatePer100k !== undefined) {
          patch.tokenDepositRatePer100k =
            body.tokenDepositRatePer100k && body.tokenDepositRatePer100k.trim()
              ? body.tokenDepositRatePer100k.trim()
              : null;
        }
        if (Object.keys(patch).length === 0) {
          res.json({ ok: true });
          return;
        }
        const updated = await storage.runInTransaction(async (tx) => {
          const u = await storage.updateCase(caseRow.id, patch, tx);
          await storage.createAuditLog(
            {
              action: 'withdrawal_activation_admin_update',
              newValue: JSON.stringify(patch).slice(0, 4000),
              adminUsername: req.admin?.username || 'Admin',
              targetType: 'case',
              targetId: caseRow.id,
            },
            tx,
          );
          return u;
        });
        res.json({ ok: true, case: updated });
      } catch (err) {
        console.error('[withdrawalActivation] admin update failed:', err);
        res.status(500).json({ error: "Failed to update activation settings" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: approve or reject the activation receipt
  // ------------------------------------------------------------------
  router.post(
    "/:id/withdrawal-activation/admin/review",
    checkAdminAuth,
    async (req: AdminAuthedRequest, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        // Sealed cases CAN be reviewed for activation — the activation
        // flow is gated to stage 14 (post-sealing) by design, so blocking
        // on sealedAt here would create an irrecoverable dead-end.
        let body: z.infer<typeof adminReviewBody>;
        try {
          body = adminReviewBody.parse(req.body);
        } catch (parseErr) {
          if (parseErr instanceof z.ZodError) {
            res.status(400).json({ error: "Invalid request" });
            return;
          }
          throw parseErr;
        }
        if (body.decision === 'reject' && !(body.reason && body.reason.trim())) {
          res.status(400).json({ error: "A reason is required when rejecting activation." });
          return;
        }
        const adminUser = req.admin?.username || 'Admin';

        if (caseRow.withdrawalActivationStatus !== 'awaiting_admin_approval') { // strict-inequality-guard
          res.status(409).json({
            error: "Activation receipt is not currently pending admin review.",
          });
          return;
        }

        if (body.decision === 'approve') {
          await storage.runInTransaction(async (tx) => {
            // Approve the linked receipt too so the dashboard ledger is consistent.
            if (caseRow.withdrawalActivationReceiptId) {
              await storage.updateDepositReceipt(
                caseRow.withdrawalActivationReceiptId,
                { status: 'approved' },
                tx,
              );
            }
            await storage.updateCase(
              caseRow.id,
              {
                withdrawalActivationStatus: 'approved',
                withdrawalActivationApprovedAt: new Date(),
                withdrawalActivationApprovedBy: adminUser,
                withdrawalActivationRejectedAt: null,
                withdrawalActivationRejectionReason: null,
              },
              tx,
            );
            await storage.createAuditLog(
              {
                action: 'withdrawal_activation_approved',
                newValue: `Activation approved by ${adminUser}`,
                adminUsername: adminUser,
                targetType: 'case',
                targetId: caseRow.id,
              },
              tx,
            );
          });
          void fireActivationEmail(
            caseRow.id,
            'withdrawalActivationApproved',
            'withdrawal-activation-approved',
            adminUser,
          );
        } else {
          await storage.runInTransaction(async (tx) => {
            if (caseRow.withdrawalActivationReceiptId) {
              await storage.updateDepositReceipt(
                caseRow.withdrawalActivationReceiptId,
                {
                  status: 'rejected',
                  ...(body.reason ? { adminNotes: body.reason } : {}),
                },
                tx,
              );
            }
            await storage.updateCase(
              caseRow.id,
              {
                withdrawalActivationStatus: 'rejected',
                withdrawalActivationRejectedAt: new Date(),
                withdrawalActivationRejectionReason: body.reason ?? null,
                // Drop the link so the user is prompted to re-upload.
                withdrawalActivationReceiptId: null,
              },
              tx,
            );
            await storage.createAuditLog(
              {
                action: 'withdrawal_activation_rejected',
                newValue: JSON.stringify({ reason: body.reason ?? '' }).slice(0, 4000),
                adminUsername: adminUser,
                targetType: 'case',
                targetId: caseRow.id,
              },
              tx,
            );
          });
          void fireActivationEmail(
            caseRow.id,
            'withdrawalActivationRejected',
            'withdrawal-activation-rejected',
            adminUser,
            { reason: body.reason ?? '' },
          );
        }

        res.json({ ok: true });
      } catch (err) {
        console.error('[withdrawalActivation] admin review failed:', err);
        res.status(500).json({ error: "Failed to record review" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: override-request — forces the token-deposit step regardless
  // of where the activation flow currently sits.
  // ------------------------------------------------------------------
  router.post(
    "/:id/withdrawal-activation/admin/request",
    checkAdminAuth,
    async (req: AdminAuthedRequest, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        const adminUser = req.admin?.username || 'Admin';
        await storage.runInTransaction(async (tx) => {
          await storage.updateCase(
            caseRow.id,
            { withdrawalActivationStatus: 'awaiting_deposit' },
            tx,
          );
          await storage.createAuditLog(
            {
              action: 'withdrawal_token_deposit_requested',
              newValue: `Token deposit step requested by ${adminUser}`,
              adminUsername: adminUser,
              targetType: 'case',
              targetId: caseRow.id,
            },
            tx,
          );
        });
        res.json({ ok: true });
      } catch (err) {
        console.error('[withdrawalActivation] admin request failed:', err);
        res.status(500).json({ error: "Failed to update activation status" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: permit withdrawal — records the paid amount, unlocks the
  // case (sets withdrawalActivationStatus='approved'), and emails the
  // user a token-deposit invoice with a PDF attachment.
  // ------------------------------------------------------------------
  const permitBody = z.object({
    paidAmount: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .refine(
        (v) => /^\d{1,8}(\.\d{1,2})?$/.test(v) && Number(v) > 0,
        { message: "Paid amount must be a positive number with up to 2 decimal places." },
      ),
  });

  router.post(
    "/:id/withdrawal-activation/admin/permit",
    checkAdminAuth,
    async (req: AdminAuthedRequest, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        let body: z.infer<typeof permitBody>;
        try {
          body = permitBody.parse(req.body);
        } catch (parseErr) {
          if (parseErr instanceof z.ZodError) {
            res.status(400).json({ error: "Invalid request" });
            return;
          }
          throw parseErr;
        }
        const adminUser = req.admin?.username || 'Admin';
        const newPermitCount = (caseRow.tokenDepositPermitCount ?? 0) + 1;
        const requiredUsdt = computeTokenDepositRequired(
          caseRow.withdrawalAmount,
          caseRow.tokenDepositRatePer100k,
        );

        await storage.runInTransaction(async (tx) => {
          await storage.updateCase(
            caseRow.id,
            {
              withdrawalActivationStatus: 'approved',
              withdrawalActivationApprovedAt: new Date(),
              withdrawalActivationApprovedBy: adminUser,
              withdrawalActivationRejectedAt: null,
              withdrawalActivationRejectionReason: null,
              tokenDepositPaidAmount: body.paidAmount,
              tokenDepositPermitCount: newPermitCount,
              tokenDepositLastPermittedAt: new Date(),
              tokenDepositLastPermittedBy: adminUser,
            },
            tx,
          );
          await storage.createAuditLog(
            {
              action: 'withdrawal_token_deposit_permitted',
              newValue: JSON.stringify({
                paidAmount: body.paidAmount,
                requiredAmount: formatUsdt(requiredUsdt),
                permitCount: newPermitCount,
                permittedBy: adminUser,
              }).slice(0, 4000),
              adminUsername: adminUser,
              targetType: 'case',
              targetId: caseRow.id,
            },
            tx,
          );
        });

        // Fire-and-forget invoice email with PDF attachment.
        void (async () => {
          try {
            const freshCase = await storage.getCaseById(caseRow.id);
            if (!freshCase?.userEmail) return;
            const [{ emailService }, { sendCaseEmailWithAudit }, { buildTokenDepositInvoicePdf }] =
              await Promise.all([
                import('../services/EmailService'),
                import('../services/emailNotify'),
                import('../services/tokenDepositInvoicePdf'),
              ]);
            const userName = (freshCase.userName ?? '').trim() || freshCase.userEmail;
            const pdfBuffer = await buildTokenDepositInvoicePdf({
              caseRow: freshCase,
              paidAmount: body.paidAmount,
              permitCount: newPermitCount,
              adminUser,
            });
            await sendCaseEmailWithAudit({
              to: freshCase.userEmail,
              caseId: caseRow.id,
              tag: 'token_deposit_invoice',
              adminUser,
              send: (locale) =>
                emailService.sendTokenDepositInvoiceEmail({
                  to: freshCase.userEmail!,
                  userName,
                  caseRef: freshCase.id,
                  locale,
                  paidAmount: body.paidAmount,
                  requiredAmount: formatUsdt(requiredUsdt),
                  permitCount: newPermitCount,
                  pdfBuffer,
                }),
            });
          } catch (emailErr) {
            console.error('[withdrawalActivation] permit invoice email failed:', emailErr);
          }
        })();

        res.json({ ok: true, permitCount: newPermitCount });
      } catch (err) {
        console.error('[withdrawalActivation] admin permit failed:', err);
        res.status(500).json({ error: "Failed to permit withdrawal" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: mark done — relocks the token-deposit gate so the next
  // disbursement cycle requires a fresh Paid → Permit.
  // ------------------------------------------------------------------
  router.post(
    "/:id/withdrawal-activation/admin/mark-done",
    checkAdminAuth,
    async (req: AdminAuthedRequest, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        const adminUser = req.admin?.username || 'Admin';
        await storage.runInTransaction(async (tx) => {
          await storage.updateCase(
            caseRow.id,
            { withdrawalActivationStatus: 'awaiting_deposit' },
            tx,
          );
          await storage.createAuditLog(
            {
              action: 'withdrawal_token_deposit_done',
              newValue: `Withdrawal token deposit cycle marked done by ${adminUser} (permit #${caseRow.tokenDepositPermitCount ?? 0})`,
              adminUsername: adminUser,
              targetType: 'case',
              targetId: caseRow.id,
            },
            tx,
          );
        });
        res.json({ ok: true });
      } catch (err) {
        console.error('[withdrawalActivation] admin mark-done failed:', err);
        res.status(500).json({ error: "Failed to mark withdrawal done" });
      }
    },
  );
}

// ----------------------------------------------------------------------
// Global default min USDT setting (admin-only)
// ----------------------------------------------------------------------
export const withdrawalActivationSettingsRouter = Router();

withdrawalActivationSettingsRouter.get(
  "/withdrawal-activation/default-min",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const row = await storage.getAppSetting(GLOBAL_MIN_USDT_KEY);
      res.json({ value: row?.value ?? null, updatedAt: row?.updatedAt ?? null });
    } catch (err) {
      warnOnce("withdrawalActivation:get-default-min", "[withdrawalActivation] get default min failed", err);
      res.status(500).json({ error: "Failed to load default" });
    }
  },
);

withdrawalActivationSettingsRouter.put(
  "/withdrawal-activation/default-min",
  checkAdminAuth,
  async (req: AdminAuthedRequest, res) => {
    try {
      const body = z.object({
        value: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .refine(
            (v) => MIN_USDT_RE.test(v) && Number(v) >= 0 && Number(v) <= 10_000_000,
            { message: "Default must be a non-negative number with up to 2 decimals (max 10,000,000)." },
          ),
      }).parse(req.body);
      const row = await storage.setAppSetting(
        GLOBAL_MIN_USDT_KEY,
        body.value,
        req.admin?.username || 'Admin',
      );
      res.json({ value: row.value, updatedAt: row.updatedAt });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      console.error('[withdrawalActivation] set default min failed:', err);
      res.status(500).json({ error: "Failed to save default" });
    }
  },
);
