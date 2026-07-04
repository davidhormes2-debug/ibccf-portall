import { Router, type Request } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { z } from "zod";
import { checkAdminAuth, isValidAdminToken } from "./middleware";
import { requireAdminRole } from "./adminPermissions";
import { requirePortalAccess, requirePortalSessionOnly, requireUnsealed } from "../services/portal-auth";
import { warnOnce } from "../lib/warnOnce";
import { RECEIPT_STATUSES } from "../../shared/constants";

export const depositsRouter = Router();

interface AdminAuthedRequest extends Request {
  admin?: { username?: string };
}

async function writeReceiptAudit(
  req: AdminAuthedRequest,
  action: string,
  receiptId: number,
  caseId: string | null,
  changes: Record<string, unknown>,
  tx?: Parameters<Parameters<typeof storage.runInTransaction>[0]>[0],
): Promise<void> {
  await storage.createAuditLog({
    action,
    newValue: JSON.stringify({ receiptId, ...changes }).slice(0, 4000),
    adminUsername: req.admin?.username || 'Admin',
    targetType: 'deposit_receipt',
    targetId: caseId || String(receiptId),
  }, tx);
}

// When an admin approves a receipt that was uploaded for a reissue round,
// flip the round to 'paid'. When they revoke approval, walk it back. This is
// the single source of truth for the unlock — no separate ack checkbox.
type Tx = Parameters<Parameters<typeof storage.runInTransaction>[0]>[0];

async function syncReissueFromReceipt(
  receiptId: number,
  newStatus: string | undefined,
  adminUser: string,
  adminNotes?: string | null,
  tx?: Tx,
  suppressEmail?: boolean,
): Promise<void> {
  if (newStatus !== 'approved' && newStatus !== 'rejected' && newStatus !== 'pending' && newStatus !== 'reviewed') return;
  const receipt = await storage.getDepositReceiptById(receiptId);
  if (!receipt?.reissueId) return;
  const round = await storage.getLetterReissueById(receipt.reissueId);
  if (!round || round.status === 'cancelled') return;

  if (newStatus === 'approved' && round.status !== 'paid') {
    await storage.updateLetterReissue(round.id, { status: 'paid', paidAt: new Date() }, tx);
    await storage.createAuditLog({
      action: 'reissue_marked_paid',
      newValue: `Reissue v${round.version} (case ${round.caseId}) marked paid via receipt ${receiptId}`,
      adminUsername: adminUser,
      targetType: 'case',
      targetId: round.caseId,
    }, tx);
    // Notify the user — they can now resubmit. Fire-and-forget so a slow
    // SMTP server doesn't block the admin's receipt-approval click.
    // suppressEmail=true lets the admin skip the email for this approval.
    void (async () => {
      try {
        const caseRow = await storage.getCaseById(round.caseId);
        if (caseRow?.userEmail && !suppressEmail) {
          const { emailService } = await import('../services/EmailService');
          const { sendCaseEmailWithAudit } = await import(
            '../services/emailNotify'
          );
          const userName =
            (caseRow.userName ?? '').trim() || caseRow.userEmail;
          await sendCaseEmailWithAudit({
            to: caseRow.userEmail,
            caseId: round.caseId,
            tag: 'reissue-receipt-approved',
            adminUser,
            // Task #158 — pin the source receipt + round so a retry
            // resends the email tied to THIS approval (with the
            // round's version + fee captured at the moment of the
            // original send) even if a newer round/receipt exists.
            metadata: {
              depositReceiptId: receiptId,
              letterReissueId: round.id,
              version: round.version,
              reissueFee: round.reissueFee,
            },
            send: (locale) =>
              emailService.sendLocalizedCaseEmail({
                to: caseRow.userEmail!,
                userName,
                caseRef: round.caseId,
                locale,
                templateKey: 'reissueApproved',
                ctaPath: '/portal?view=letter',
                logTag: 'reissue-receipt-approved',
                vars: {
                  version: round.version,
                  reissueFee: round.reissueFee,
                },
              }),
          });
        }
      } catch (err) {
        warnOnce('deposits:reissue-approved-email-fail', '[deposits] reissue-receipt-approved email failed:', err);
      }
    })();
  } else if (newStatus === 'rejected' && receipt.reissueId) {
    // User's reissue receipt was rejected — let them know with the admin
    // notes (if any) so they can upload a corrected receipt. Fire-and-forget
    // so SMTP latency doesn't block the admin's rejection click.
    void (async () => {
      try {
        const caseRow = await storage.getCaseById(round.caseId);
        if (caseRow?.userEmail) {
          const { emailService } = await import('../services/EmailService');
          const { sendCaseEmailWithAudit } = await import(
            '../services/emailNotify'
          );
          const userName =
            (caseRow.userName ?? '').trim() || caseRow.userEmail;
          await sendCaseEmailWithAudit({
            to: caseRow.userEmail,
            caseId: round.caseId,
            tag: 'reissue-receipt-rejected',
            adminUser,
            // Task #158 — pin the source receipt so a retry resends
            // THIS rejection's notes (snapshotted here in case the
            // admin later edits them on the receipt row).
            metadata: {
              depositReceiptId: receiptId,
              letterReissueId: round.id,
              notes: adminNotes ?? receipt.adminNotes ?? null,
            },
            send: (locale) =>
              emailService.sendLocalizedCaseEmail({
                to: caseRow.userEmail!,
                userName,
                caseRef: round.caseId,
                locale,
                templateKey: 'reissueRejected',
                ctaPath: '/portal?view=deposit',
                logTag: 'reissue-receipt-rejected',
                vars: {
                  notes: adminNotes ?? receipt.adminNotes ?? '',
                },
              }),
          });
        }
      } catch (err) {
        warnOnce('deposits:reissue-rejected-email-fail', '[deposits] reissue-receipt-rejected email failed:', err);
      }
    })();
  }

  if (newStatus !== 'approved' && round.status === 'paid' && round.receiptId === receiptId) {
    // Admin walked back an approval — revert the round to awaiting_review so
    // the user is gated again until the next approval.
    await storage.updateLetterReissue(round.id, { status: 'awaiting_review', paidAt: null }, tx);
    await storage.createAuditLog({
      action: 'reissue_paid_reverted',
      newValue: `Reissue v${round.version} (case ${round.caseId}) reverted from paid (receipt ${receiptId} no longer approved)`,
      adminUsername: adminUser,
      targetType: 'case',
      targetId: round.caseId,
    }, tx);
  }
}

// Charset mirrors the one in cases.ts so generated codes are consistently
// numeric-only and cryptographically unpredictable.
const REACTIVATION_ACCESS_CODE_CHARS = "0123456789";
const REACTIVATION_ACCESS_CODE_LENGTH = 12;

function generateReactivationCode(): string {
  const bytes = crypto.randomBytes(REACTIVATION_ACCESS_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < REACTIVATION_ACCESS_CODE_LENGTH; i++) {
    code += REACTIVATION_ACCESS_CODE_CHARS[bytes[i] % REACTIVATION_ACCESS_CODE_CHARS.length];
  }
  return code;
}

/**
 * When an admin approves a deposit receipt that was uploaded as a reactivation
 * payment (category='reissue', no reissueId, case is currently disabled), this
 * function atomically re-enables the account inside the same transaction as the
 * receipt update — ensuring the approval and the unlock are always in sync.
 *
 * Returns a result object when reactivation was triggered (so the caller can
 * fire async side-effects after the tx commits), or null when the receipt does
 * not qualify.
 */
async function syncAccountReactivationFromReceipt(
  receiptId: number,
  newStatus: string | undefined,
  adminUser: string,
  tx?: Tx,
): Promise<{
  newAccessCode: string;
  userEmail: string | null;
  userName: string;
  caseId: string;
} | null> {
  if (newStatus !== "approved") return null;

  const receipt = await storage.getDepositReceiptById(receiptId);
  // Only act on reissue-category receipts that are NOT linked to a letter
  // reissue round (those are handled by syncReissueFromReceipt). A receipt
  // with category='reissue' and no reissueId was uploaded via the
  // /reactivation-receipt endpoint while the account was suspended.
  if (!receipt || receipt.category !== "reissue" || receipt.reissueId) return null;

  const caseData = await storage.getCaseById(receipt.caseId);
  if (!caseData || !caseData.isDisabled) return null;

  // Rotate the access code so the user gets a fresh credential and the old
  // suspended-account code is invalidated — mirrors the toggle-access logic.
  // Collision-retry loop mirrors the toggle-access guard in cases.ts: up to 5
  // attempts, fail with an error if no unique code is found.
  let newAccessCode: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateReactivationCode();
    const collision = await storage.getCaseByAccessCode(candidate);
    if (!collision) {
      newAccessCode = candidate;
      break;
    }
  }
  if (!newAccessCode) {
    throw new Error("Could not generate a unique access code after 5 attempts");
  }

  await storage.updateCase(
    receipt.caseId,
    {
      isDisabled: false,
      forceLogoutAt: null,
      accessCode: newAccessCode,
      // reactivatedAt and portal-warning fields are not in strict InsertCase;
      // cast to any following the same pattern as the toggle-access route.
      reactivatedAt: new Date(),
      portalWarningAt: null,
      portalWarningMinutes: null,
      portalWarningMessage: null,
    } as any,
    tx,
  );

  await storage.createAuditLog(
    {
      action: "enable_user_access",
      adminUsername: adminUser,
      targetType: "case",
      targetId: receipt.caseId,
      newValue:
        `Account reactivated via deposit receipt ${receiptId}` +
        ` (${caseData.userName || caseData.accessCode}) — new access code issued` +
        (caseData.userEmail
          ? ` — reactivation email queued to ${caseData.userEmail} (see audit log for delivery status)`
          : " (no email on file — please share the new code manually)"),
    },
    tx,
  );

  return {
    newAccessCode,
    userEmail: caseData.userEmail ?? null,
    userName: caseData.userName ?? "",
    caseId: receipt.caseId,
  };
}

depositsRouter.patch("/:id", checkAdminAuth, requireAdminRole("admin"), async (req: AdminAuthedRequest, res) => {
  try {
    const data = z.object({
      status: z.enum(['pending', 'reviewed', 'approved', 'rejected']).optional(),
      adminNotes: z.string().optional(),
      // When true, the reissue-receipt-approved notification email is skipped.
      // The admin can toggle this off from the deposit-receipts dialog (Task #405+).
      suppressEmail: z.boolean().optional(),
    }).parse(req.body);

    const receiptId = parseInt(req.params.id);
    if (Number.isNaN(receiptId)) {
      res.status(400).json({ error: "Invalid receipt id" });
      return;
    }

    // Task #144 — receipt update, its audit row, and the reissue-round
    // sync (which writes its own row + audit) all commit or roll back
    // together. Email side effects fire from inside syncReissueFromReceipt
    // as fire-and-forget so they're outside the transaction by design.
    // syncAccountReactivationFromReceipt runs in the same tx so the
    // account unlock is atomic with the receipt approval.
    const adminUser = req.admin?.username || 'Admin';
    type TxResult = {
      receipt: Exclude<Awaited<ReturnType<typeof storage.updateDepositReceipt>>, undefined>;
      reactivation: Awaited<ReturnType<typeof syncAccountReactivationFromReceipt>>;
    };
    let txResult: TxResult | undefined;
    try {
      txResult = await storage.runInTransaction(async (tx) => {
        const u = await storage.updateDepositReceipt(receiptId, data, tx);
        if (!u) return undefined as unknown as TxResult;
        await writeReceiptAudit(req, 'admin_update_deposit_receipt', receiptId, u.caseId ?? null, data, tx);
        let reactivation: Awaited<ReturnType<typeof syncAccountReactivationFromReceipt>> = null;
        if (data.status) {
          await syncReissueFromReceipt(receiptId, data.status, adminUser, data.adminNotes ?? null, tx, data.suppressEmail);
          reactivation = await syncAccountReactivationFromReceipt(receiptId, data.status, adminUser, tx);
        }
        return { receipt: u, reactivation };
      });
    } catch (txErr) {
      warnOnce('deposits:patch-tx-fail', '[deposits] receipt PATCH transaction failed:', txErr);
      res.status(500).json({ error: "Failed to update receipt" });
      return;
    }
    if (!txResult || !txResult.receipt) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }
    const { receipt: updated, reactivation } = txResult;
    res.json({
      ...updated,
      ...(reactivation
        ? {
            accountReactivated: true,
            newAccessCode: reactivation.newAccessCode,
            hasEmail: Boolean(reactivation.userEmail),
          }
        : {}),
    });

    // Fire post-reactivation async work AFTER responding so SMTP latency
    // never hangs the admin dashboard click.
    if (reactivation) {
      const { newAccessCode, userEmail, userName, caseId } = reactivation;
      void (async () => {
        // 1. Purge in-memory portal sessions so the old suspended-account
        //    session token cannot be replayed.
        try {
          const { deleteSessionsByCaseId } = await import('../services/session-store');
          await deleteSessionsByCaseId(caseId);
        } catch {
          // best-effort
        }

        // 2. Drop a "welcome back" message into the user's secure inbox so
        //    they get a notification badge the next time they sign in.
        try {
          const friendlyName = userName.trim().split(' ')[0] || 'there';
          await storage.createAdminMessage({
            caseId,
            category: 'resolved',
            title: 'Welcome back to IBCCF',
            body:
              `Hi ${friendlyName}, your IBCCF portal account has been fully reactivated by our compliance team. ` +
              `Your account is 100% restored and all features — withdrawal letter, deposit receipts, secure messaging, and declaration — are available again. ` +
              (userEmail
                ? `For your security we issued you a brand new access code; please check your email (${userEmail}) for it. Your previous code no longer works.`
                : `For your security a brand new access code has been issued — please contact your IBCCF case officer to receive it. Your previous code no longer works.`),
            isRead: false,
          });
          const { notificationService } = await import('../services/NotificationService');
          await notificationService.notifyUser(
            caseId,
            'new_message',
            'Welcome back to IBCCF',
            'Your account has been fully reactivated. Tap to see what\'s new.',
            '/dashboard',
          );
        } catch (err) {
          warnOnce('deposits:reactivation-welcome-fail', '[deposits] welcome-back message failed:', err);
        }

        // 3. Send the reactivation email (new access code) fire-and-forget.
        if (userEmail) {
          let result: { success: boolean; error?: string };
          try {
            const { emailService } = await import('../services/EmailService');
            const sent = await emailService.sendAccountReactivationNotification(
              userEmail,
              userName,
              newAccessCode,
            );
            result = sent ? { success: true } : { success: false, error: 'Email could not be delivered.' };
          } catch (err) {
            result = { success: false, error: err instanceof Error ? err.message : 'unexpected SMTP error' };
            warnOnce('deposits:reactivation-email-fail', '[deposits] reactivation email failed:', err);
          }
          try {
            await storage.createAuditLog({
              action: result.success ? 'email_account_reactivation' : 'email_account_reactivation_failed',
              adminUsername: adminUser,
              targetType: 'case',
              targetId: caseId,
              newValue: result.success
                ? `Email sent (account-reactivation) to ${userEmail} (triggered by receipt approval)`
                : `Email send failed (account-reactivation) to ${userEmail}: ${result.error ?? 'unknown'}`,
            });
          } catch (logErr) {
            warnOnce('deposits:reactivation-email-audit-fail', '[deposits] reactivation email audit failed:', logErr);
          }
        }
      })();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update receipt" });
    }
  }
});

depositsRouter.patch("/:id/status", checkAdminAuth, requireAdminRole("admin"), async (req: AdminAuthedRequest, res) => {
  try {
    const { status } = z.object({
      status: z.enum(['pending', 'reviewed', 'approved', 'rejected'])
    }).parse(req.body);

    const receiptId = parseInt(req.params.id);
    if (Number.isNaN(receiptId)) {
      res.status(400).json({ error: "Invalid receipt id" });
      return;
    }

    // Task #144 — see PATCH /:id above; same transactional guarantees.
    const adminUser = req.admin?.username || 'Admin';
    type TxStatusResult = {
      receipt: Exclude<Awaited<ReturnType<typeof storage.updateDepositReceiptStatus>>, undefined>;
      reactivation: Awaited<ReturnType<typeof syncAccountReactivationFromReceipt>>;
    };
    let txResult: TxStatusResult | undefined;
    try {
      txResult = await storage.runInTransaction(async (tx) => {
        const u = await storage.updateDepositReceiptStatus(receiptId, status, tx);
        if (!u) return undefined as unknown as TxStatusResult;
        await writeReceiptAudit(req, 'admin_update_deposit_receipt_status', receiptId, u.caseId ?? null, { status }, tx);
        await syncReissueFromReceipt(receiptId, status, adminUser, undefined, tx);
        const reactivation = await syncAccountReactivationFromReceipt(receiptId, status, adminUser, tx);
        return { receipt: u, reactivation };
      });
    } catch (txErr) {
      warnOnce('deposits:status-patch-tx-fail', '[deposits] receipt status PATCH transaction failed:', txErr);
      res.status(500).json({ error: "Failed to update receipt status" });
      return;
    }
    if (!txResult || !txResult.receipt) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }
    const { receipt: updated, reactivation } = txResult;
    res.json({
      ...updated,
      ...(reactivation
        ? {
            accountReactivated: true,
            newAccessCode: reactivation.newAccessCode,
            hasEmail: Boolean(reactivation.userEmail),
          }
        : {}),
    });

    // Fire post-reactivation async work AFTER responding — see PATCH /:id for
    // the full explanation of each step.
    if (reactivation) {
      const { newAccessCode, userEmail, userName, caseId } = reactivation;
      void (async () => {
        try {
          const { deleteSessionsByCaseId } = await import('../services/session-store');
          await deleteSessionsByCaseId(caseId);
        } catch { /* best-effort */ }

        try {
          const friendlyName = userName.trim().split(' ')[0] || 'there';
          await storage.createAdminMessage({
            caseId,
            category: 'resolved',
            title: 'Welcome back to IBCCF',
            body:
              `Hi ${friendlyName}, your IBCCF portal account has been fully reactivated by our compliance team. ` +
              `Your account is 100% restored and all features — withdrawal letter, deposit receipts, secure messaging, and declaration — are available again. ` +
              (userEmail
                ? `For your security we issued you a brand new access code; please check your email (${userEmail}) for it. Your previous code no longer works.`
                : `For your security a brand new access code has been issued — please contact your IBCCF case officer to receive it. Your previous code no longer works.`),
            isRead: false,
          });
          const { notificationService } = await import('../services/NotificationService');
          await notificationService.notifyUser(caseId, 'new_message', 'Welcome back to IBCCF', 'Your account has been fully reactivated. Tap to see what\'s new.', '/dashboard');
        } catch (err) {
          warnOnce('deposits:reactivation-status-welcome-fail', '[deposits] welcome-back message failed (status route):', err);
        }

        if (userEmail) {
          let result: { success: boolean; error?: string };
          try {
            const { emailService } = await import('../services/EmailService');
            const sent = await emailService.sendAccountReactivationNotification(userEmail, userName, newAccessCode);
            result = sent ? { success: true } : { success: false, error: 'Email could not be delivered.' };
          } catch (err) {
            result = { success: false, error: err instanceof Error ? err.message : 'unexpected SMTP error' };
            warnOnce('deposits:reactivation-status-email-fail', '[deposits] reactivation email failed (status route):', err);
          }
          try {
            await storage.createAuditLog({
              action: result.success ? 'email_account_reactivation' : 'email_account_reactivation_failed',
              adminUsername: adminUser,
              targetType: 'case',
              targetId: caseId,
              newValue: result.success
                ? `Email sent (account-reactivation) to ${userEmail} (triggered by receipt approval)`
                : `Email send failed (account-reactivation) to ${userEmail}: ${result.error ?? 'unknown'}`,
            });
          } catch (logErr) {
            warnOnce('deposits:reactivation-status-email-audit-fail', '[deposits] reactivation email audit failed (status route):', logErr);
          }
        }
      })();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update receipt status" });
    }
  }
});


/**
 * Task #163 — Unified admin "All Receipts" inbox. Returns every receipt
 * across every case (deposit + certificate + stamp duty), newest first,
 * with optional filters. The heavy base64 blob is stripped — admins fetch
 * the full row via the existing per-table detail endpoints when they
 * actually want to view the image.
 */
/**
 * Categories that belong to the `deposit_receipts` table fan-out branch.
 * Exported so tests can assert that every deposit-type category is listed here
 * and will be routed to the deposit branch (not silently dropped or mis-routed
 * to a dedicated table).  Adding a new deposit-receipt category MUST update
 * this list; adding a new dedicated-table category (like `certificate` or
 * `stamp_duty`) must NOT appear here — it gets its own `wantXxx` branch below.
 */
export const DEPOSIT_RECEIPT_CATEGORIES = [
  'activation',
  'reissue',
  'other',
  'merge_fee',
  'token_deposit',
  'refund_claim',
  'refund_claim_doc',
] as const;

/**
 * Categories backed by their own dedicated tables (not `deposit_receipts`).
 * Combined with DEPOSIT_RECEIPT_CATEGORIES they form the full set of accepted
 * `?category=` values for the merged inbox, so any future addition to either
 * list automatically expands the Zod enum without a separate manual edit.
 */
const DEDICATED_TABLE_RECEIPT_CATEGORIES = ['certificate', 'stamp_duty'] as const;

/**
 * Virtual filter categories that are not stored in the DB but are derived
 * from a combination of DB fields. These are accepted by the `?category=`
 * query parameter and translated to a compound DB filter inside
 * `collectMergedReceipts`.
 *
 * `reactivation` — deposit_receipts rows where `category='reissue'` AND
 * `reissueId IS NULL`, i.e. payments uploaded via the reactivation-receipt
 * endpoint for a suspended account (distinct from letter-reissue payments
 * which always carry a `reissueId`).
 */
export const VIRTUAL_RECEIPT_CATEGORIES = ['reactivation'] as const;

// GET /reactivation-pending-counts — per-case count of deposit receipts that
// are pending reactivation review (category='reissue', no reissueId, status='pending').
// Returns { counts: Record<string, number> }. Must be registered BEFORE the
// /:id routes so Express doesn't interpret "reactivation-pending-counts" as an id.
depositsRouter.get("/reactivation-pending-counts", checkAdminAuth, async (_req, res) => {
  try {
    const counts = await storage.getReactivationPendingCounts();
    res.json({ counts });
  } catch (err) {
    warnOnce("deposits:reactivation-pending-counts-fail", "[deposits] reactivation pending counts failed", err);
    res.status(500).json({ error: "Failed to load reactivation pending counts" });
  }
});

depositsRouter.get("/all-receipts", checkAdminAuth, requireAdminRole("agent"), async (req, res) => {
  try {
    const filter = z.object({
      status: z.enum(RECEIPT_STATUSES).optional(),
      category: z.enum([
        ...DEPOSIT_RECEIPT_CATEGORIES,
        ...DEDICATED_TABLE_RECEIPT_CATEGORIES,
        ...VIRTUAL_RECEIPT_CATEGORIES,
      ] as const).optional(),
      caseId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(500).optional(),
    }).parse(req.query);

    const limit = filter.limit ?? 200;

    const merged = await collectMergedReceipts({
      caseId: filter.caseId,
      status: filter.status,
      category: filter.category,
    });
    merged.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    res.json(merged.slice(0, limit));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request" });
    } else {
      warnOnce("deposits:all-receipts-fail", "GET /api/deposits/all-receipts failed:", error);
      res.status(500).json({ error: "Failed to load receipts inbox" });
    }
  }
});

/**
 * Unified receipt shape returned by the merged endpoints. `source` tells
 * the client which detail/approve/reject endpoint to call.
 */
export type MergedReceipt = {
  source: 'deposit' | 'certificate' | 'stamp_duty';
  id: number;
  caseId: string;
  accessCode: string | null;
  category: 'activation' | 'reissue' | 'other' | 'certificate' | 'stamp_duty' | 'merge_fee' | 'token_deposit';
  status: string;
  fileName: string | null;
  notes: string | null;
  adminNotes: string | null;
  amountUsdt: string | null;
  reissueId: number | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  uploadedAt: string;
  // Task #379 — per-case mute flag for the document upload alert. Surfaced
  // here so the cross-case All Receipts inbox can show a "Muted" badge
  // without an extra round-trip per row.
  alertMuted: boolean;
};

/**
 * Task #176 — Normalize the per-row status returned by the merged
 * endpoints so the admin UIs (status dropdown in AllReceiptsTab, the
 * "awaiting review" badges in CasesKpiStrip and CaseMergedReceiptsPanel)
 * speak one vocabulary across all three receipt sources.
 *
 * Task #177 follow-up: the source-of-truth normalization for
 * `stamp_duty_receipts` and `certificate_fee_payments` now lives in
 * `server/storage.ts` (`normalizeReceiptStatus`), so any direct read of
 * those tables sees `'awaiting_admin_approval'` instead of the raw
 * DB-default `'pending'`. This helper remains as a defensive identity
 * for cert/stamp rows (pre-normalized) and a hard pass-through for the
 * deposit lifecycle (`pending` / `reviewed` / `approved` / `rejected`),
 * which has its own state machine.
 */
function normalizeMergedReceiptStatus(
  source: 'deposit' | 'certificate' | 'stamp_duty',
  raw: string,
): string {
  if (source === 'deposit') return raw;
  return raw === 'pending' ? 'awaiting_admin_approval' : raw;
}

async function collectMergedReceipts(opts: {
  caseId?: string;
  status?: string;
  category?: string;
}): Promise<MergedReceipt[]> {
  // `reactivation` is a virtual category: deposit rows with category='reissue'
  // and no reissueId (uploaded via the reactivation-receipt endpoint for a
  // suspended account). It routes to the deposits fan-out but uses a compound
  // filter rather than a direct category match.
  const isVirtualReactivation = opts.category === 'reactivation';
  const effectiveDepositCategory = isVirtualReactivation ? 'reissue' : opts.category;

  const wantDeposits =
    !opts.category ||
    isVirtualReactivation ||
    (DEPOSIT_RECEIPT_CATEGORIES as readonly string[]).includes(opts.category);
  const wantCert = !opts.category || opts.category === 'certificate';
  const wantStamp = !opts.category || opts.category === 'stamp_duty';

  // Compare incoming ?status= against the *normalized* row status so
  // ?status=awaiting_admin_approval matches stamp-duty / certificate
  // rows whose raw DB status is 'pending'.
  const matchesStatus = (
    source: 'deposit' | 'certificate' | 'stamp_duty',
    raw: string,
  ): boolean => {
    if (!opts.status) return true;
    return normalizeMergedReceiptStatus(source, raw) === opts.status;
  };

  const tasks: Promise<MergedReceipt[]>[] = [];

  if (wantDeposits) {
    tasks.push((async () => {
      const rows = opts.caseId
        ? await storage.getDepositReceiptsByCaseId(opts.caseId)
        : await storage.getAllDepositReceipts?.() ?? [];
      return rows
        .filter((r) => {
          if (!matchesStatus('deposit', r.status ?? 'pending')) return false;
          const rowCategory = r.category ?? (r.reissueId ? 'reissue' : 'activation');
          if (effectiveDepositCategory && effectiveDepositCategory !== rowCategory) return false;
          // Virtual reactivation filter: reissue rows without a linked
          // letter-reissue round are account-reactivation payments.
          if (isVirtualReactivation && r.reissueId) return false;
          return true;
        })
        .map((r) => ({
          source: 'deposit' as const,
          id: r.id,
          caseId: r.caseId,
          accessCode: null,
          category: (r.category as MergedReceipt['category']) ?? (r.reissueId ? 'reissue' : 'activation'),
          status: normalizeMergedReceiptStatus('deposit', r.status ?? 'pending'),
          fileName: r.fileName ?? null,
          notes: r.notes ?? null,
          adminNotes: r.adminNotes ?? null,
          amountUsdt: null,
          reissueId: r.reissueId ?? null,
          reviewedAt: null,
          reviewedBy: null,
          uploadedAt: (r.uploadedAt instanceof Date ? r.uploadedAt : new Date(r.uploadedAt as any)).toISOString(),
          alertMuted: false,
        }));
    })());
  }

  if (wantCert) {
    tasks.push((async () => {
      const rows = opts.caseId
        ? await storage.getCertificateFeePaymentsByCaseId(opts.caseId)
        : await storage.getAllCertificateFeePayments?.() ?? [];
      return rows
        .filter((r) => matchesStatus('certificate', r.status))
        .map((r) => ({
          source: 'certificate' as const,
          id: r.id,
          caseId: r.caseId,
          accessCode: null,
          category: 'certificate' as const,
          status: normalizeMergedReceiptStatus('certificate', r.status),
          fileName: r.fileName ?? null,
          notes: r.notes ?? null,
          adminNotes: r.adminNotes ?? null,
          amountUsdt: r.amountUsdt,
          reissueId: null,
          reviewedAt: r.reviewedAt ? (r.reviewedAt instanceof Date ? r.reviewedAt.toISOString() : new Date(r.reviewedAt as any).toISOString()) : null,
          reviewedBy: r.reviewedBy ?? null,
          uploadedAt: (r.uploadedAt instanceof Date ? r.uploadedAt : new Date(r.uploadedAt as any)).toISOString(),
          alertMuted: false,
        }));
    })());
  }

  if (wantStamp) {
    tasks.push((async () => {
      const rows = opts.caseId
        ? await storage.getStampDutyReceiptsByCaseId(opts.caseId)
        : await storage.getAllStampDutyReceipts?.() ?? [];
      return rows
        .filter((r) => matchesStatus('stamp_duty', r.status))
        .map((r) => ({
          source: 'stamp_duty' as const,
          id: r.id,
          caseId: r.caseId,
          accessCode: null,
          category: 'stamp_duty' as const,
          status: normalizeMergedReceiptStatus('stamp_duty', r.status),
          fileName: r.fileName ?? null,
          notes: r.notes ?? null,
          adminNotes: r.adminNotes ?? null,
          amountUsdt: r.amountUsdt,
          reissueId: null,
          reviewedAt: r.reviewedAt ? (r.reviewedAt instanceof Date ? r.reviewedAt.toISOString() : new Date(r.reviewedAt as any).toISOString()) : null,
          reviewedBy: r.reviewedBy ?? null,
          uploadedAt: (r.uploadedAt instanceof Date ? r.uploadedAt : new Date(r.uploadedAt as any)).toISOString(),
          alertMuted: false,
        }));
    })());
  }

  const results = await Promise.all(tasks);
  const flat = results.flat();

  // Task #379 — enrich rows with the per-case alert mute flag so the
  // admin All Receipts / per-case Uploads panels can render a "Muted"
  // badge inline. Best-effort: a DB blip leaves alertMuted=false.
  try {
    const { listMutedDocUploadAlertCaseIds } = await import(
      "../services/documentUploadAlert"
    );
    const mutedSet = new Set(await listMutedDocUploadAlertCaseIds());
    for (const row of flat) {
      if (mutedSet.has(row.caseId)) row.alertMuted = true;
    }
  } catch (err) {
    warnOnce("deposits:enrich-mute-state-fail", "Failed to enrich merged receipts with mute state:", err);
  }

  // Task #183 — Enrich each row with the owning case's human-friendly
  // access code so admin UIs can show `IBCCF-XXXXXX` instead of a
  // truncated UUID. Lookup is best-effort: rows whose case can't be
  // resolved keep `accessCode: null` and the client falls back to the
  // legacy UUID display.
  const uniqueCaseIds = Array.from(new Set(flat.map((r) => r.caseId)));
  const accessCodeByCaseId = new Map<string, string>();
  if (uniqueCaseIds.length === 1) {
    const c = await storage.getCaseById(uniqueCaseIds[0]);
    if (c?.accessCode) accessCodeByCaseId.set(c.id, c.accessCode);
  } else if (uniqueCaseIds.length > 1) {
    const allCases = await storage.getAllCases();
    for (const c of allCases) {
      if (c.accessCode) accessCodeByCaseId.set(c.id, c.accessCode);
    }
  }
  for (const row of flat) {
    row.accessCode = accessCodeByCaseId.get(row.caseId) ?? null;
  }
  return flat;
}

export function registerCaseDepositRoutes(router: Router) {
  // Task #163 — Per-case merged receipts timeline. Used by BOTH the
  // admin case-detail "Uploads" panel AND the portal Uploads view so
  // the user sees a single unified list across all 5 categories.
  // Accepts admin bearer OR portal session bound to this case — mirrors
  // the dual-auth pattern used by /document-templates.
  router.get("/:id/all-receipts", async (req, res) => {
    try {
      const caseId = req.params.id;
      const { isValidAdminToken } = await import("./middleware");
      const isAdmin = await isValidAdminToken(req.headers.authorization);
      if (!isAdmin) {
        const { isAuthorizedForCase } = await import("../services/portal-auth");
        const ok = await isAuthorizedForCase(req, caseId);
        if (!ok) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }
      }
      const merged = await collectMergedReceipts({ caseId });
      merged.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
      res.json(merged);
    } catch (err) {
      warnOnce("deposits:case-all-receipts-fail", "GET /api/cases/:id/all-receipts failed:", err);
      res.status(500).json({ error: "Failed to load merged receipts" });
    }
  });

  router.get("/:id/deposit-receipts", requirePortalAccess, async (req, res) => {
    try {
      const receipts = await storage.getDepositReceiptsByCaseId(req.params.id);
      // Admins get full rows (imageData needed for inline preview). Portal
      // users only need status/metadata — omit the blob to keep responses small.
      const isAdmin = await isValidAdminToken(req.headers.authorization);
      if (isAdmin) {
        res.json(receipts);
      } else {
        res.json(receipts.map(({ imageData: _omit, ...rest }) => rest));
      }
    } catch (_e) {
      res.status(500).json({ error: "Failed to fetch deposit receipts" });
    }
  });

  // Maximum number of deposit receipts a single case may accumulate.
  // Prevents unbounded DB growth from a malicious or misbehaving portal user.
  const MAX_RECEIPTS_PER_CASE = 30;
  // Maximum decoded file size for a deposit receipt image/PDF (8 MB).
  const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

  router.post("/:id/deposit-receipts", requirePortalSessionOnly, requireUnsealed, async (req, res) => {
    try {
      const receiptInput = z.object({
        // Must look like a data URL (data:<mime>;base64,<payload>) so we
        // never persist an empty string or a stray plain-text upload that
        // the <img src> tag in the admin tab couldn't render.
        // Optional for category='merge_fee' — the merge confirmation records
        // the intent (amount/notes) before the user uploads the actual proof.
        imageData: z
          .string()
          .min(64, "Receipt image is empty or too small to be a valid file.")
          .refine(
            (s) => s.startsWith("data:"),
            "Receipt image must be a base64 data URL (data:image/...;base64,...).",
          )
          .refine(
            (s) => {
              const mime = s.slice(5, s.indexOf(';') > -1 ? s.indexOf(';') : s.indexOf(','));
              return ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime);
            },
            "Receipt must be a JPEG, PNG, WebP image or PDF document.",
          )
          .optional(),
        fileName: z.string().max(255).optional(),
        notes: z.string().max(2000).optional(),
        // Optional — when the user is paying a reissue fee they tag the
        // receipt with the round id. The server validates the round still
        // belongs to this case and is not already paid/cancelled.
        reissueId: z.number().int().positive().optional(),
        // Task #163 — Unified uploader category. App-layer enum.
        // 'reissue' MUST be paired with reissueId; reissueId MUST be
        // accompanied by 'reissue'. Default 'activation' preserves
        // backwards-compat for legacy clients.
        // Task #938 — 'merge_fee' (withdrawal batch merge processing fee)
        // and 'token_deposit' (token wallet deposit in withdrawal stage)
        // are new no-reissueId categories.
        category: z.enum(['activation', 'reissue', 'other', 'merge_fee', 'token_deposit', 'refund_claim', 'refund_claim_doc']).optional(),
      // When the user clicks "Upload proof" on a specific pending merge_fee row
      // in WithdrawalView's Batch History, the row's receipt ID is stored in
      // sessionStorage and forwarded here so the existing placeholder receipt
      // (created by the admin without imageData) is updated instead of creating
      // a duplicate new receipt.  Only honoured when category='merge_fee' and
      // imageData is present.
      receiptId: z.number().int().positive().optional(),
      }).parse(req.body);

      // imageData is required for all categories except merge_fee (which may
      // record the merge intent without a file; the user uploads proof later).
      const category = receiptInput.category
        ?? (receiptInput.reissueId ? 'reissue' : 'activation');
      if (!receiptInput.imageData && category !== 'merge_fee') {
        res.status(400).json({ error: "Receipt image is required." });
        return;
      }

      // Enforce decoded file-size cap before any DB work. The base64 body
      // parser already limits the raw request to 12 MB, but the data URL
      // prefix overhead means a well-formed 12 MB body could contain a blob
      // slightly above our intended ceiling — check explicitly here.
      if (receiptInput.imageData) {
        const commaIdx = receiptInput.imageData.indexOf(',');
        const b64Part = commaIdx >= 0 ? receiptInput.imageData.slice(commaIdx + 1) : receiptInput.imageData;
        const approxBytes = Math.floor((b64Part.length * 3) / 4);
        if (approxBytes > MAX_RECEIPT_BYTES) {
          res.status(413).json({ error: `Receipt file exceeds the ${MAX_RECEIPT_BYTES / (1024 * 1024)} MB limit.` });
          return;
        }
      }

      // "Upload proof" fast-path — when the user clicks "Upload proof" on a
      // specific pending merge_fee history row, WithdrawalView stores that
      // row's receipt ID in sessionStorage and forwards it here so we PATCH
      // the placeholder receipt (created by admin without imageData) instead of
      // creating a duplicate new one.  Security checks: category must be
      // merge_fee, imageData must be present, and the target receipt must belong
      // to this case and currently have no imageData (i.e. it really is a
      // placeholder waiting for the user's proof).
      if (receiptInput.receiptId && category === 'merge_fee' && receiptInput.imageData) {
        const target = await storage.getDepositReceiptById(receiptInput.receiptId);
        if (target && target.caseId === req.params.id && !target.imageData) {
          const updated = await storage.updateDepositReceipt(target.id, {
            imageData: receiptInput.imageData,
            fileName: receiptInput.fileName ?? null,
          });
          if (updated) {
            void (async () => {
              try {
                const { notificationService } = await import("../services/NotificationService");
                await notificationService.notifyAdmin(
                  'receipt_uploaded',
                  'New Receipt Uploaded',
                  `Case ${req.params.id} submitted a merge fee deposit receipt.`,
                  `/admin`,
                );
              } catch (e) {
                warnOnce('deposits:notify-admin-upload-fail', '[deposits] notify admin receipt upload failed:', e);
              }
            })();
            res.json(updated);
            return;
          }
        }
        // If the target receipt is not found or already has a file, fall through
        // to the normal creation path so the upload still succeeds.
      }

      // Enforce per-case receipt count cap to bound DB storage growth.
      const existingCount = await storage.countDepositReceiptsByCaseId(req.params.id);
      if (existingCount >= MAX_RECEIPTS_PER_CASE) {
        res.status(429).json({
          error: `This case has reached the maximum of ${MAX_RECEIPTS_PER_CASE} deposit receipts. Please contact support.`,
        });
        return;
      }

      // Cross-validate category ⟺ reissueId binding.
      if (category === 'reissue' && !receiptInput.reissueId) {
        res.status(400).json({ error: "Reissue category requires a reissueId." });
        return;
      }
      if (category !== 'reissue' && receiptInput.reissueId) {
        res.status(400).json({ error: "reissueId is only valid with category='reissue'." });
        return;
      }
      // merge_fee and token_deposit behave like 'other' — no reissueId, no
      // special validation beyond the reissueId exclusion already enforced above.

      let resolvedReissueId: number | null = null;
      if (receiptInput.reissueId) {
        const round = await storage.getLetterReissueById(receiptInput.reissueId);
        if (!round || round.caseId !== req.params.id) {
          res.status(400).json({ error: "Reissue round does not belong to this case." });
          return;
        }
        if (round.status === 'cancelled' || round.status === 'paid') {
          res.status(400).json({ error: "This reissue round is no longer awaiting payment." });
          return;
        }
        resolvedReissueId = round.id;
      }

      const receipt = await storage.createDepositReceipt({
        caseId: req.params.id,
        imageData: receiptInput.imageData,
        fileName: receiptInput.fileName || null,
        notes: receiptInput.notes || null,
        status: 'pending',
        reissueId: resolvedReissueId,
        category,
      });

      // Tag the round with this receipt and move it to awaiting_review so the
      // admin sees a clear "this receipt is for a reissue payment" signal.
      if (resolvedReissueId) {
        await storage.updateLetterReissue(resolvedReissueId, {
          receiptId: receipt.id,
          status: 'awaiting_review',
        });
      }

      void (async () => {
        try {
          const { notificationService } = await import("../services/NotificationService");
          const label = category === 'reissue' ? 'reissue fee' : category === 'other' ? 'other' : category === 'merge_fee' ? 'merge fee' : category === 'token_deposit' ? 'token deposit' : 'activation';
          await notificationService.notifyAdmin(
            'receipt_uploaded',
            'New Receipt Uploaded',
            `Case ${req.params.id} submitted a ${label} deposit receipt.`,
            `/admin`,
          );
        } catch (e) {
          warnOnce('deposits:notify-admin-upload-fail', '[deposits] notify admin receipt upload failed:', e);
        }
      })();
      res.json(receipt);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
      } else {
        res.status(500).json({ error: "Failed to upload deposit receipt" });
      }
    }
  });
}
