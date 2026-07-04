import { Router, type Request, type Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { storage } from "../storage";
import { checkAdminAuth } from "./middleware";
import { requirePortalAccess, requireUnsealed } from "../services/portal-auth";
import { rateLimiter } from "../middleware";
import { WITHDRAWAL_SUBMIT_RATE_LIMIT_NAMESPACE } from "../middleware/security";
import { warnOnce } from "../lib/warnOnce";

// Per-IP submit limiter for the portal withdrawal-request route. 10 attempts
// per 5 minutes is the same envelope used elsewhere for sensitive portal
// mutations — generous enough for one earnest user, tight enough to blunt
// brute-force PIN guessing on this endpoint specifically. Persisted to the
// DB so the per-IP cap holds across autoscale instances (otherwise the
// PIN-guessing budget scales linearly with instance count).
const withdrawalSubmitRateLimit = rateLimiter(10, 5 * 60 * 1000, {
  persistNamespace: WITHDRAWAL_SUBMIT_RATE_LIMIT_NAMESPACE,
});

// Verify a PIN against the case's stored value. Supports both bcrypt
// hashes (modern) and legacy plaintext PINs (pre-migration). Mirrors
// the helper in routes/cases.ts but does NOT perform migration here
// since a withdrawal request is a sensitive action, not a login.
function isBcryptHash(stored: string): boolean {
  return stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$");
}
async function verifyPinOnly(pin: string, storedPin: string): Promise<boolean> {
  if (isBcryptHash(storedPin)) {
    try { return await bcrypt.compare(pin, storedPin); } catch { return false; }
  }
  // strict-equality-guard: must stay === (not ==) — loose equality would
  // coerce types (e.g. numeric 0 against empty string) and could allow a
  // plaintext-PIN bypass before the bcrypt migration completes.
  return pin === storedPin;
}

// Standalone admin-facing router mounted at /api/withdrawal-requests.
// Per-case portal + admin endpoints live on the casesRouter (registered
// via registerCaseWithdrawalRoutes) so they share `requirePortalAccess`.
export const withdrawalRequestsRouter = Router();

// Admin: per-case counts of pending withdrawal requests, keyed by caseId.
// Returns { counts: Record<string, number> }. The admin dashboard polls this
// to drive the cross-case "pending withdrawal requests" badge so new
// applications surface without opening each case. Registered BEFORE the bare
// "/" route so the exact path is matched first. Bearer-auth required.
withdrawalRequestsRouter.get(
  "/pending-counts",
  checkAdminAuth,
  async (_req: Request, res: Response) => {
    try {
      const counts = await storage.getPendingWithdrawalRequestCounts();
      res.json({ counts });
    } catch (err) {
      warnOnce("wr:pending-counts", "[withdrawalRequests] pending counts failed", err);
      res.status(500).json({ error: "Failed to load pending withdrawal counts" });
    }
  },
);

// Admin: cross-case list with simple filters. Used by future admin
// dashboards / inboxes. Bearer-auth required.
withdrawalRequestsRouter.get(
  "/",
  checkAdminAuth,
  async (req: Request, res: Response) => {
    try {
      const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
      const caseIdParam = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
      const validStatus = statusParam && ['pending', 'approved', 'rejected', 'cancelled'].includes(statusParam)
        ? statusParam as 'pending' | 'approved' | 'rejected' | 'cancelled'
        : undefined;
      const rows = await storage.listWithdrawalRequests({ status: validStatus, caseId: caseIdParam, limit });
      res.json(rows);
    } catch (err) {
      warnOnce("wr:admin-list", "[withdrawalRequests] admin cross-case list failed", err);
      res.status(500).json({ error: "Failed to load withdrawal requests" });
    }
  },
);

interface AdminAuthedRequest extends Request {
  admin?: { username?: string };
}

const HEX_OR_BASE58 = /^[A-Za-z0-9._:-]{8,200}$/;

// Strong server-side validation. The portal must collect the same fields,
// but we re-check on the wire so we never trust the client.
const createWithdrawalRequestBody = z.object({
  amount: z.string().trim().min(1).max(120),
  asset: z.string().trim().min(1).max(40),
  network: z.string().trim().min(1).max(60),
  withdrawalType: z.enum(['full', 'partial']),

  requestedWalletAddress: z.string().trim().regex(HEX_OR_BASE58, {
    message: "Wallet address contains unsupported characters",
  }),
  requestedWalletAsset: z.string().trim().max(40).optional().nullable(),
  requestedWalletNetwork: z.string().trim().max(60).optional().nullable(),

  preferredPayoutDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable(),
  confirmationChannel: z.enum(['email', 'sms', 'both']),

  // Strict 6-digit numeric stub. Optional today (admin may or may not issue
  // a code out-of-band), but when provided it must match the expected shape.
  twoFactorCode: z.string().trim().regex(/^\d{6}$/, "2FA code must be 6 digits").optional().nullable(),

  // PIN re-entry is required — sensitive action gate. Validated against the
  // stored case PIN (bcrypt-compare or legacy plaintext) below.
  pin: z.string().trim().regex(/^\d{6}$/, "PIN must be 6 digits"),

  termsAccepted: z.literal(true),

  userNote: z.string().trim().max(2000).optional().nullable(),
});

const reviewWithdrawalRequestBody = z
  .object({
    status: z.enum(['approved', 'rejected', 'cancelled']),
    adminNote: z.string().trim().max(2000).optional().nullable(),
  })
  // Reject must always include a reviewer note — the user sees this and
  // needs a reason. Approve/cancel may proceed with an empty note.
  .refine((b) => b.status !== 'rejected' || (b.adminNote && b.adminNote.length > 0), {
    message: 'A reviewer note is required when rejecting a withdrawal request.',
    path: ['adminNote'],
  });

async function fireWithdrawalEmail(
  caseId: string,
  templateKey: 'withdrawalRequestSubmitted' | 'withdrawalApproved' | 'withdrawalRejected' | 'withdrawalCancelled',
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
          ctaPath: '/portal?view=dashboard',
          logTag,
          vars,
        }),
    });
  } catch (err) {
    console.error(`[withdrawalRequests] ${logTag} email failed:`, err);
  }
}

// Task #775 — best-effort admin alert on a new withdrawal application.
// Fires both an in-app admin notification and an admin email. Every step
// is independently guarded so one failure never blocks the other (or the
// user's already-returned response).
async function fireWithdrawalAdminAlert(
  caseRow: { id: string; userName?: string | null },
  details: {
    amount: string;
    asset: string;
    network: string;
    withdrawalType?: string | null;
    requestedWalletAddress?: string | null;
    newStage?: number | null;
  },
): Promise<void> {
  const applicant = (caseRow.userName ?? '').trim() || caseRow.id;
  // In-app admin notification.
  try {
    const { notificationService } = await import('../services/NotificationService');
    await notificationService.notifyAdmin(
      'withdrawal_request_submitted',
      'New withdrawal application',
      `${applicant} requested ${details.amount} ${details.asset} on ${details.network} (case ${caseRow.id}).`,
      `/admin?tab=cases&caseId=${encodeURIComponent(caseRow.id)}`,
    );
  } catch (err) {
    console.error('[withdrawalRequests] admin notification failed:', err);
  }
  // Best-effort admin email.
  try {
    const { emailService } = await import('../services/EmailService');
    await emailService.sendWithdrawalRequestAdminAlertEmail({
      caseRef: caseRow.id,
      userName: caseRow.userName ?? null,
      amount: details.amount,
      asset: details.asset,
      network: details.network,
      withdrawalType: details.withdrawalType ?? null,
      requestedWalletAddress: details.requestedWalletAddress ?? null,
      newStage: details.newStage ?? null,
    });
  } catch (err) {
    console.error('[withdrawalRequests] admin alert email failed:', err);
  }
}

/**
 * Per-case portal + admin routes. Registered onto the casesRouter so
 * `requirePortalAccess` shares the same `req.params.id` binding the rest
 * of the case-scoped endpoints use.
 */
export function registerCaseWithdrawalRoutes(router: Router): void {
  // ------------------------------------------------------------------
  // Portal: list this case's withdrawal requests
  // ------------------------------------------------------------------
  router.get(
    "/:id/withdrawal-requests",
    requirePortalAccess,
    async (req: Request, res: Response) => {
      try {
        const rows = await storage.getWithdrawalRequestsByCaseId(req.params.id);
        // Strip officer-only fields from the portal payload.
        const sanitised = rows.map((r) => ({
          id: r.id,
          status: r.status,
          amount: r.amount,
          asset: r.asset,
          network: r.network,
          withdrawalType: r.withdrawalType,
          requestedWalletAddress: r.requestedWalletAddress,
          requestedWalletAsset: r.requestedWalletAsset,
          requestedWalletNetwork: r.requestedWalletNetwork,
          preferredPayoutDate: r.preferredPayoutDate,
          confirmationChannel: r.confirmationChannel,
          userNote: r.userNote,
          adminNote: r.status === 'rejected' || r.status === 'approved' ? r.adminNote : null,
          createdAt: r.createdAt,
          reviewedAt: r.reviewedAt,
        }));
        res.json(sanitised);
      } catch (err) {
        warnOnce("wr:portal-list", "[withdrawalRequests] portal list failed", err);
        res.status(500).json({ error: "Failed to load withdrawal requests" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Portal: submit a new withdrawal request
  // ------------------------------------------------------------------
  // Gated by (1) portal session, (2) unsealed case, (3) the admin-
  // controlled `withdrawalWindowEnabled` toggle on the case row. Without
  // (3) the dashboard CTA isn't even rendered, but we re-check here so
  // direct API calls can't bypass the gate.
  router.post(
    "/:id/withdrawal-requests",
    withdrawalSubmitRateLimit,
    requirePortalAccess,
    requireUnsealed,
    async (req: Request, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        if (!caseRow.withdrawalWindowEnabled) {
          res.status(403).json({
            error: "The withdrawal window is not currently open for this case. Please contact your case officer.",
          });
          return;
        }
        // Final-stage Withdrawal Activation gate: ONLY at stage 14 (the
        // final stage where the activation flow is exposed). For earlier
        // stages the activation status is irrelevant — it defaults to
        // `pending_address` and would otherwise block every legitimate
        // mid-flow withdrawal request.
        const stageNum = Number(caseRow.withdrawalStage ?? 0);
        if (
          Number.isFinite(stageNum) &&
          stageNum >= 14 &&
          caseRow.withdrawalActivationStatus !== 'approved'
        ) {
          res.status(403).json({
            error: "You need to deposit the minimum amount into your token wallet before withdrawal processing can run.",
          });
          return;
        }

        let body: z.infer<typeof createWithdrawalRequestBody>;
        try {
          body = createWithdrawalRequestBody.parse(req.body);
        } catch (parseErr) {
          if (parseErr instanceof z.ZodError) {
            res.status(400).json({ error: "Invalid request" });
            return;
          }
          throw parseErr;
        }

        // Sensitive-action gate: PIN re-entry against the case's stored PIN.
        if (!caseRow.userPin) {
          res.status(403).json({
            error: "Your case is missing a PIN. Please set one in your account before submitting a withdrawal request.",
          });
          return;
        }
        const pinOk = await verifyPinOnly(body.pin, caseRow.userPin);
        if (!pinOk) {
          // Contract: bad PIN on submit is a 400 (input failed validation),
          // not 401 — the portal session was already authenticated by
          // `requirePortalAccess`; the PIN is a per-action confirmation.
          res.status(400).json({ error: "Incorrect PIN. Please try again." });
          return;
        }

        // Preferred payout date (if supplied) must be at least tomorrow —
        // the earliest realistic compliance review window.
        if (body.preferredPayoutDate) {
          const requested = new Date(body.preferredPayoutDate);
          const tomorrow = new Date();
          tomorrow.setHours(0, 0, 0, 0);
          tomorrow.setDate(tomorrow.getDate() + 1);
          if (!Number.isFinite(requested.getTime()) || requested < tomorrow) {
            res.status(400).json({
              error: "Preferred payout date must be tomorrow or later.",
            });
            return;
          }
        }

        // Reject if there's already a pending request — one in flight at a
        // time. Admin must approve, reject, or cancel before a new one.
        // DB-level partial unique index (migration 0004) closes the race.
        const pending = await storage.getPendingWithdrawalRequestCountByCaseId(caseRow.id);
        if (pending > 0) {
          res.status(409).json({
            error: "You already have a withdrawal request awaiting review. Please wait for your case officer to respond before submitting another.",
          });
          return;
        }

        const reqIp = (req.ip || req.socket.remoteAddress || "").toString().slice(0, 64);
        const reqUserAgent = (req.headers['user-agent'] || "").toString().slice(0, 256);

        // Task #775 — auto-advance the withdrawal stage by one on submit.
        // Only fires for a valid in-flight stage (1–13): a null/0 stage is
        // left untouched (we never invent a stage where there wasn't one),
        // and an already-final stage (14) is the cap and never moves. The
        // stage is stored as text (`cases.withdrawal_stage`, constrained to
        // 1–14 or NULL) so we round-trip through Number/String.
        const curStage = parseInt(caseRow.withdrawalStage ?? '', 10);
        const nextStage =
          Number.isFinite(curStage) && curStage >= 1 && curStage < 14
            ? curStage + 1
            : null;

        // Task #137 — insert + audit in a single transaction so we can
        // never end up with a withdrawal request committed but its
        // audit-log entry missing. Task #775 folds the stage bump into the
        // same transaction so the request and stage change stay consistent.
        let row;
        try {
          row = await storage.runInTransaction(async (tx) => {
            const inserted = await storage.createWithdrawalRequest({
              caseId: caseRow.id,
              status: 'pending',
              amount: body.amount,
              asset: body.asset,
              network: body.network,
              withdrawalType: body.withdrawalType,
              requestedWalletAddress: body.requestedWalletAddress,
              requestedWalletAsset: body.requestedWalletAsset ?? null,
              requestedWalletNetwork: body.requestedWalletNetwork ?? null,
              preferredPayoutDate: body.preferredPayoutDate ? new Date(body.preferredPayoutDate) : null,
              confirmationChannel: body.confirmationChannel,
              twoFactorProvidedAt: body.twoFactorCode ? new Date() : null,
              termsAcceptedAt: new Date(),
              userNote: body.userNote ?? null,
              reqIp: reqIp || null,
              reqUserAgent: reqUserAgent || null,
            }, tx);
            await storage.createAuditLog({
              action: 'withdrawal_request_submitted',
              newValue: JSON.stringify({
                requestId: inserted.id,
                amount: body.amount,
                asset: body.asset,
                network: body.network,
                withdrawalType: body.withdrawalType,
                requestedWalletAddress: body.requestedWalletAddress,
              }).slice(0, 4000),
              adminUsername: 'User',
              targetType: 'case',
              targetId: caseRow.id,
            }, tx);

            // Stage auto-advance + its own typed audit row. The stage
            // change is picked up by the portal's existing stage-transition
            // observers (progress tracker, activity timeline, one-time
            // banner) on the next case poll — no extra wiring needed. We do
            // NOT touch `letterSent`, so the letter-ready email (which only
            // fires on letterSent false→true) is never re-triggered.
            if (nextStage !== null) {
              // Also advance maxStageReached here (mirrors CaseService logic)
              // because this path bypasses CaseService.updateCase directly.
              // NULL maxStageReached is treated as the current withdrawalStage,
              // not 0, so an existing untracked row is preserved correctly.
              const prevMax =
                caseRow.maxStageReached ??
                parseInt(caseRow.withdrawalStage ?? '0', 10);
              const maxStageUpdate =
                nextStage > prevMax
                  ? { withdrawalStage: String(nextStage), maxStageReached: nextStage }
                  : { withdrawalStage: String(nextStage) };
              await storage.updateCase(
                caseRow.id,
                maxStageUpdate,
                tx,
              );
              await storage.createAuditLog({
                action: 'withdrawal_stage_auto_advanced',
                previousValue: String(curStage),
                newValue: JSON.stringify({
                  from: curStage,
                  to: nextStage,
                  reason: 'withdrawal_request_submitted',
                  requestId: inserted.id,
                }).slice(0, 4000),
                adminUsername: 'User',
                targetType: 'case',
                targetId: caseRow.id,
              }, tx);
            }
            return inserted;
          });
        } catch (insertErr: any) {
          // 23505 — partial unique index caught a concurrent submit.
          if (insertErr?.code === '23505') {
            res.status(409).json({
              error: "You already have a withdrawal request awaiting review.",
            });
            return;
          }
          throw insertErr;
        }

        // Best-effort, non-blocking — never delay the user response on SMTP.
        void fireWithdrawalEmail(
          caseRow.id,
          'withdrawalRequestSubmitted',
          'withdrawal-request-submitted',
          'User',
          { amount: body.amount, asset: body.asset, network: body.network },
        );

        // Task #775 — notify the admin team a new application landed. Both
        // an in-app admin notification and a best-effort admin email. Wrapped
        // in fire-and-forget so neither a notification-store nor an SMTP
        // failure can fail the user's submission.
        void fireWithdrawalAdminAlert(caseRow, {
          amount: body.amount,
          asset: body.asset,
          network: body.network,
          withdrawalType: body.withdrawalType,
          requestedWalletAddress: body.requestedWalletAddress,
          newStage: nextStage,
        });

        res.status(201).json({ id: row.id, status: row.status });
      } catch (err) {
        console.error('[withdrawalRequests] create failed:', err);
        res.status(500).json({ error: "Failed to submit withdrawal request" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: review (approve/reject/cancel) a withdrawal request
  // ------------------------------------------------------------------
  // The platform is display-only. Approving here NEVER routes, holds, or
  // relays funds — it records the admin decision, audits it, and emails
  // the user. This admin review path does not itself move the withdrawal
  // stage; the one-step auto-advance happens on user submit (Task #775).
  router.patch(
    "/:id/withdrawal-requests/:requestId",
    checkAdminAuth,
    async (req: AdminAuthedRequest, res: Response) => {
      try {
        const requestId = Number.parseInt(req.params.requestId, 10);
        if (!Number.isFinite(requestId)) {
          res.status(400).json({ error: "Invalid request id" });
          return;
        }
        const existing = await storage.getWithdrawalRequestById(requestId);
        if (!existing || existing.caseId !== req.params.id) {
          res.status(404).json({ error: "Withdrawal request not found" });
          return;
        }
        if (existing.status !== 'pending') {
          res.status(409).json({
            error: `This request was already ${existing.status} and cannot be re-reviewed.`,
          });
          return;
        }
        // Sealed-case read-only: review must not mutate a sealed case
        // without the Override Seal flow used elsewhere.
        const parent = await storage.getCaseById(req.params.id);
        if (parent?.sealedAt) {
          res.status(423).json({
            error: "This case is sealed. Withdrawal requests cannot be reviewed without first overriding the seal.",
          });
          return;
        }

        let body: z.infer<typeof reviewWithdrawalRequestBody>;
        try {
          body = reviewWithdrawalRequestBody.parse(req.body);
        } catch (parseErr) {
          if (parseErr instanceof z.ZodError) {
            res.status(400).json({ error: "Invalid request" });
            return;
          }
          throw parseErr;
        }

        const adminUser = req.admin?.username || 'Admin';
        // Task #144 — review update + audit row commit/rollback together
        // so an audit-write failure never leaves a silent status change.
        let updated: Awaited<ReturnType<typeof storage.updateWithdrawalRequest>> | undefined;
        try {
          updated = await storage.runInTransaction(async (tx) => {
            const u = await storage.updateWithdrawalRequest(requestId, {
              status: body.status,
              reviewedAt: new Date(),
              reviewedBy: adminUser,
              adminNote: body.adminNote ?? null,
            }, tx);
            if (!u) return undefined;
            await storage.createAuditLog({
              action: `withdrawal_request_${body.status}`,
              newValue: JSON.stringify({
                requestId,
                status: body.status,
                adminNote: body.adminNote ?? null,
              }).slice(0, 4000),
              adminUsername: adminUser,
              targetType: 'case',
              targetId: req.params.id,
            }, tx);
            return u;
          });
        } catch (txErr) {
          console.error('[withdrawalRequests] review transaction failed:', txErr);
          res.status(500).json({ error: "Failed to review withdrawal request" });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: "Withdrawal request not found" });
          return;
        }

        const templateKey =
          body.status === 'approved' ? 'withdrawalApproved'
          : body.status === 'rejected' ? 'withdrawalRejected'
          : 'withdrawalCancelled';
        // Best-effort, non-blocking — never delay the admin response on SMTP.
        void fireWithdrawalEmail(
          req.params.id,
          templateKey,
          `withdrawal-request-${body.status}`,
          adminUser,
          {
            amount: existing.amount,
            asset: existing.asset,
            note: body.adminNote ?? '',
          },
        );

        res.json(updated);
      } catch (err) {
        console.error('[withdrawalRequests] review failed:', err);
        res.status(500).json({ error: "Failed to review withdrawal request" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: full per-case detail (includes admin-only fields)
  // ------------------------------------------------------------------
  router.get(
    "/:id/withdrawal-requests/admin",
    checkAdminAuth,
    async (req: Request, res: Response) => {
      try {
        const rows = await storage.getWithdrawalRequestsByCaseId(req.params.id);
        res.json(rows);
      } catch (err) {
        warnOnce("wr:admin-case-list", "[withdrawalRequests] admin case list failed", err);
        res.status(500).json({ error: "Failed to load withdrawal requests" });
      }
    },
  );
}
