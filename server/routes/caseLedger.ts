import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import type { DbExecutor } from "../db";
import { checkAdminAuth } from "./middleware";
import { requirePortalAccess } from "../services/portal-auth";
import type { InsertCase } from "@shared/schema";
import { warnOnce } from "../lib/warnOnce";

type LedgerEntryPatch = Partial<{
  direction: 'credit' | 'debit';
  amount: string;
  asset: string;
  category: string | null;
  entryDate: Date;
  userVisible: boolean;
  userNote: string | null;
  adminNote: string | null;
}>;

/**
 * Task #55 — Admin per-case ledger.
 *
 * Two kinds of routes, both mounted under the casesRouter so the
 * `:id` binding lines up with the rest of the case-scoped surface:
 *
 *   • Portal:  GET /api/cases/:id/ledger
 *              Requires `requirePortalAccess`. Returns only entries the
 *              admin marked `userVisible`, with the officer-only
 *              `adminNote` stripped. Do NOT add ledger data to the
 *              generic `GET /api/cases/access/:code` allowlist — keep
 *              visibility-filtering in one place.
 *
 *   • Admin:   GET    /api/cases/:id/ledger/admin
 *              POST   /api/cases/:id/ledger
 *              PATCH  /api/cases/:id/ledger/:entryId
 *              DELETE /api/cases/:id/ledger/:entryId
 *              POST   /api/cases/:id/ledger/sync
 *              All gated by `checkAdminAuth`. The platform is display-
 *              only — these routes record the admin's accounting view;
 *              they never route, hold, or relay funds.
 */

interface AdminAuthedRequest extends Request {
  admin?: { username?: string };
}

const NUMERIC_AMOUNT = /^\d{1,12}(?:[.,]\d{1,4})?$/;

const createLedgerEntryBody = z.object({
  direction: z.enum(['credit', 'debit']),
  amount: z.string().trim().regex(NUMERIC_AMOUNT, {
    message: "Amount must be a number (e.g. 250.00) with no currency suffix.",
  }),
  asset: z.string().trim().min(1).max(40).default('USDT'),
  category: z.string().trim().max(60).optional().nullable(),
  entryDate: z.string().datetime({ offset: true }).optional().nullable(),
  userVisible: z.boolean().default(false),
  userNote: z.string().trim().max(2000).optional().nullable(),
  adminNote: z.string().trim().max(2000).optional().nullable(),
  notifyByEmail: z.boolean().default(false),
});

const updateLedgerEntryBody = z.object({
  direction: z.enum(['credit', 'debit']).optional(),
  amount: z.string().trim().regex(NUMERIC_AMOUNT).optional(),
  asset: z.string().trim().min(1).max(40).optional(),
  category: z.string().trim().max(60).optional().nullable(),
  entryDate: z.string().datetime({ offset: true }).optional().nullable(),
  userVisible: z.boolean().optional(),
  userNote: z.string().trim().max(2000).optional().nullable(),
  adminNote: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Best-effort, non-blocking email triggered when the admin ticks
 * "Notify by email" on an entry. Mirrors the withdrawal-request email
 * helper — never throws into the request path, and uses the generic
 * announcement-style email so we don't need a new template just for
 * the ledger surface.
 */
async function fireLedgerEntryEmail(
  caseId: string,
  entry: { direction: 'credit' | 'debit'; amount: string; asset: string; userNote?: string | null },
  adminUser: string,
): Promise<void> {
  try {
    const caseRow = await storage.getCaseById(caseId);
    if (!caseRow?.userEmail) return;
    const [{ emailService }, { sendCaseEmailWithAudit }] = await Promise.all([
      import('../services/EmailService'),
      import('../services/emailNotify'),
    ]);
    const directionLabel = entry.direction === 'credit' ? 'Credit' : 'Deduction';
    const subject = `Account update — ${directionLabel} of ${entry.amount} ${entry.asset}`;
    const userName = (caseRow.userName ?? '').trim() || caseRow.userEmail;
    const note = entry.userNote?.trim() ?? '';
    const body =
      `Hello ${userName},\n\n` +
      `A new entry has been recorded on your account ledger:\n\n` +
      `  • Type: ${directionLabel}\n` +
      `  • Amount: ${entry.amount} ${entry.asset}\n` +
      (note ? `  • Note: ${note}\n` : '') +
      `\nYou can review your full account history from your IBCCF portal dashboard.\n\n` +
      `This message is for your records — IBCCF is display-only and does not route, hold, or relay funds.\n`;
    await sendCaseEmailWithAudit({
      to: caseRow.userEmail,
      caseId,
      tag: 'ledger-entry-added',
      adminUser,
      send: async () =>
        emailService.sendCustomCaseEmail({
          to: caseRow.userEmail!,
          subject,
          html: `<p>${body.replace(/\n/g, '<br/>')}</p>`,
          logTag: 'ledger-entry-added',
        }),
    });
  } catch (err) {
    console.error('[caseLedger] notify email failed:', err);
  }
}

/**
 * Audit-log helper. When called WITHOUT a transaction executor the
 * failure is swallowed (best-effort, preserves prior behaviour for
 * sync-only callers). When called WITH a transaction executor the
 * failure is allowed to propagate so the surrounding
 * `runInTransaction` aborts and Postgres rolls back the paired row
 * mutation (Task #173).
 */
async function safeAudit(
  action: string,
  adminUser: string,
  caseId: string,
  value: unknown,
  executor?: DbExecutor,
) {
  const payload = {
    action,
    newValue: typeof value === 'string' ? value : JSON.stringify(value).slice(0, 4000),
    adminUsername: adminUser,
    targetType: 'case' as const,
    targetId: caseId,
  };
  if (executor) {
    await storage.createAuditLog(payload, executor);
    return;
  }
  try {
    await storage.createAuditLog(payload);
  } catch (err) {
    console.error(`[caseLedger] audit ${action} failed:`, err);
  }
}

/**
 * Auto-adjust the displayed balance after a ledger mutation.
 *
 * Override-detection rule: we only overwrite `cases.userBalance` when
 * it currently equals `userBalanceLastSyncedTotal` (i.e. the admin has
 * NOT manually edited the balance since the last ledger sync). In
 * either case we always update `userBalanceLastSyncedTotal` to the
 * fresh total so the divergence baseline stays meaningful.
 *
 * Returns the resolved {newTotal, didSync} so the route can echo this
 * back to the admin UI without a second round-trip.
 */
async function autoAdjustBalance(
  caseId: string,
  adminUser: string,
  executor?: DbExecutor,
): Promise<{
  newTotal: string;
  didSync: boolean;
  manualOverrideActive: boolean;
}> {
  const newTotal = await storage.computeCaseLedgerTotal(caseId, executor);
  const caseRow = await storage.getCaseById(caseId);
  if (!caseRow) return { newTotal, didSync: false, manualOverrideActive: false };

  const prevSynced = (caseRow.userBalanceLastSyncedTotal ?? '').trim();
  const prevBalance = (caseRow.userBalance ?? '').trim();
  // Manual-override is "active" when the admin has typed a balance that
  // differs from the last ledger-synced value. The very first ledger
  // entry on a case (prevSynced is empty AND prevBalance is empty)
  // counts as in-sync — we adopt the computed total.
  const inSync = prevBalance === prevSynced;

  const patch: Partial<InsertCase> = {
    userBalanceLastSyncedTotal: newTotal,
  };
  let didSync = false;
  if (inSync) {
    patch.userBalance = newTotal || null;
    didSync = true;
  }
  await storage.updateCase(caseId, patch, executor);

  if (didSync) {
    await safeAudit('case_balance_auto_synced', adminUser, caseId, {
      from: prevBalance,
      to: newTotal,
    }, executor);
  }
  return { newTotal, didSync, manualOverrideActive: !inSync };
}

/**
 * Sanitise a ledger row for portal exposure: drops `adminNote` and any
 * provenance the user shouldn't see. Mirrors the allowlist pattern used
 * by other portal-scoped endpoints.
 */
function toPortalRow(r: {
  id: number;
  direction: string;
  amount: string;
  asset: string;
  category: string | null;
  entryDate: Date;
  userNote: string | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    direction: r.direction,
    amount: r.amount,
    asset: r.asset,
    category: r.category,
    entryDate: r.entryDate,
    userNote: r.userNote,
    createdAt: r.createdAt,
  };
}

export function registerCaseLedgerRoutes(router: Router): void {
  // ------------------------------------------------------------------
  // Portal: list this case's user-visible ledger entries
  // ------------------------------------------------------------------
  router.get(
    "/:id/ledger",
    requirePortalAccess,
    async (req: Request, res: Response) => {
      try {
        const rows = await storage.getCaseLedgerEntriesByCaseId(req.params.id);
        const visible = rows.filter((r) => r.userVisible).map(toPortalRow);
        res.json(visible);
      } catch (err) {
        warnOnce("caseLedger:portal-list-fail", "[caseLedger] portal list failed:", err);
        res.status(500).json({ error: "Failed to load account history" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: full list with admin-only fields + current sync state
  // ------------------------------------------------------------------
  router.get(
    "/:id/ledger/admin",
    checkAdminAuth,
    async (req: Request, res: Response) => {
      try {
        const [rows, caseRow] = await Promise.all([
          storage.getCaseLedgerEntriesByCaseId(req.params.id),
          storage.getCaseById(req.params.id),
        ]);
        const computedTotal = await storage.computeCaseLedgerTotal(req.params.id);
        const lastSynced = (caseRow?.userBalanceLastSyncedTotal ?? '').trim();
        const balance = (caseRow?.userBalance ?? '').trim();
        res.json({
          entries: rows,
          computedTotal,
          currentBalance: caseRow?.userBalance ?? null,
          lastSyncedTotal: caseRow?.userBalanceLastSyncedTotal ?? null,
          manualOverrideActive: balance !== lastSynced,
        });
      } catch (err) {
        warnOnce("caseLedger:admin-list-fail", "[caseLedger] admin list failed:", err);
        res.status(500).json({ error: "Failed to load ledger" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: create a new ledger entry
  // ------------------------------------------------------------------
  router.post(
    "/:id/ledger",
    checkAdminAuth,
    async (req: AdminAuthedRequest, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }

        let body: z.infer<typeof createLedgerEntryBody>;
        try {
          body = createLedgerEntryBody.parse(req.body);
        } catch (parseErr) {
          if (parseErr instanceof z.ZodError) {
            res.status(400).json({ error: "Invalid request" });
            return;
          }
          throw parseErr;
        }

        const adminUser = req.admin?.username || 'Admin';
        // Ordering is deliberate so the audit timeline reads cause→effect:
        //   1. write the row that the cause of every downstream change
        //   2. audit the cause (`ledger_entry_created`)
        //   3. recompute the balance — `autoAdjustBalance` writes its own
        //      `case_balance_auto_synced` row, which now appears AFTER the
        //      causing entry in the log
        //   4. schedule the best-effort notification email (non-blocking)
        //   5. respond to the admin
        let row: Awaited<ReturnType<typeof storage.createCaseLedgerEntry>>;
        let sync: Awaited<ReturnType<typeof autoAdjustBalance>>;
        try {
          const result = await storage.runInTransaction(async (tx) => {
            const r = await storage.createCaseLedgerEntry({
              caseId: req.params.id,
              direction: body.direction,
              amount: body.amount,
              asset: body.asset,
              category: body.category ?? null,
              entryDate: body.entryDate ? new Date(body.entryDate) : new Date(),
              userVisible: body.userVisible,
              userNote: body.userNote ?? null,
              adminNote: body.adminNote ?? null,
              createdBy: adminUser,
            }, tx);
            await safeAudit('ledger_entry_created', adminUser, req.params.id, {
              entryId: r.id,
              direction: r.direction,
              amount: r.amount,
              asset: r.asset,
              userVisible: r.userVisible,
              notifyByEmail: body.notifyByEmail,
            }, tx);
            const s = await autoAdjustBalance(req.params.id, adminUser, tx);
            return { r, s };
          });
          row = result.r;
          sync = result.s;
        } catch (txErr) {
          console.error('[caseLedger] create transaction failed:', txErr);
          res.status(500).json({ error: "Failed to create ledger entry" });
          return;
        }

        if (body.notifyByEmail) {
          void fireLedgerEntryEmail(
            req.params.id,
            {
              direction: row.direction as 'credit' | 'debit',
              amount: row.amount,
              asset: row.asset,
              userNote: row.userNote,
            },
            adminUser,
          );
        }

        res.status(201).json({ entry: row, ...sync });
      } catch (err) {
        console.error('[caseLedger] create failed:', err);
        res.status(500).json({ error: "Failed to create ledger entry" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: edit an existing ledger entry
  // ------------------------------------------------------------------
  router.patch(
    "/:id/ledger/:entryId",
    checkAdminAuth,
    async (req: AdminAuthedRequest, res: Response) => {
      try {
        const entryId = Number.parseInt(req.params.entryId, 10);
        if (!Number.isFinite(entryId)) {
          res.status(400).json({ error: "Invalid entry id" });
          return;
        }
        const existing = await storage.getCaseLedgerEntryById(entryId);
        if (!existing || existing.caseId !== req.params.id) {
          res.status(404).json({ error: "Ledger entry not found" });
          return;
        }

        let body: z.infer<typeof updateLedgerEntryBody>;
        try {
          body = updateLedgerEntryBody.parse(req.body);
        } catch (parseErr) {
          if (parseErr instanceof z.ZodError) {
            res.status(400).json({ error: "Invalid request" });
            return;
          }
          throw parseErr;
        }

        const adminUser = req.admin?.username || 'Admin';
        const patch: LedgerEntryPatch = {};
        if (body.direction !== undefined) patch.direction = body.direction;
        if (body.amount !== undefined) patch.amount = body.amount;
        if (body.asset !== undefined) patch.asset = body.asset;
        if (body.category !== undefined) patch.category = body.category ?? null;
        if (body.entryDate !== undefined) patch.entryDate = body.entryDate ? new Date(body.entryDate) : new Date();
        if (body.userVisible !== undefined) patch.userVisible = body.userVisible;
        if (body.userNote !== undefined) patch.userNote = body.userNote ?? null;
        if (body.adminNote !== undefined) patch.adminNote = body.adminNote ?? null;

        // Cause→effect ordering (mirrors the create path): write the
        // row, audit the cause, then run the balance recompute which
        // emits its own `case_balance_auto_synced` audit row.
        let updated: Awaited<ReturnType<typeof storage.updateCaseLedgerEntry>>;
        let sync: Awaited<ReturnType<typeof autoAdjustBalance>>;
        try {
          const result = await storage.runInTransaction(async (tx) => {
            const u = await storage.updateCaseLedgerEntry(entryId, patch, tx);
            await safeAudit('ledger_entry_updated', adminUser, req.params.id, {
              entryId,
              patch,
            }, tx);
            const s = await autoAdjustBalance(req.params.id, adminUser, tx);
            return { u, s };
          });
          updated = result.u;
          sync = result.s;
        } catch (txErr) {
          console.error('[caseLedger] update transaction failed:', txErr);
          res.status(500).json({ error: "Failed to update ledger entry" });
          return;
        }

        res.json({ entry: updated, ...sync });
      } catch (err) {
        console.error('[caseLedger] update failed:', err);
        res.status(500).json({ error: "Failed to update ledger entry" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: delete a ledger entry
  // ------------------------------------------------------------------
  router.delete(
    "/:id/ledger/:entryId",
    checkAdminAuth,
    async (req: AdminAuthedRequest, res: Response) => {
      try {
        const entryId = Number.parseInt(req.params.entryId, 10);
        if (!Number.isFinite(entryId)) {
          res.status(400).json({ error: "Invalid entry id" });
          return;
        }
        const existing = await storage.getCaseLedgerEntryById(entryId);
        if (!existing || existing.caseId !== req.params.id) {
          res.status(404).json({ error: "Ledger entry not found" });
          return;
        }
        const adminUser = req.admin?.username || 'Admin';
        // Cause→effect ordering (mirrors create/update).
        let sync: Awaited<ReturnType<typeof autoAdjustBalance>>;
        try {
          sync = await storage.runInTransaction(async (tx) => {
            await storage.deleteCaseLedgerEntry(entryId, tx);
            await safeAudit('ledger_entry_deleted', adminUser, req.params.id, {
              entryId,
              direction: existing.direction,
              amount: existing.amount,
              asset: existing.asset,
            }, tx);
            return autoAdjustBalance(req.params.id, adminUser, tx);
          });
        } catch (txErr) {
          console.error('[caseLedger] delete transaction failed:', txErr);
          res.status(500).json({ error: "Failed to delete ledger entry" });
          return;
        }

        res.json({ ok: true, ...sync });
      } catch (err) {
        console.error('[caseLedger] delete failed:', err);
        res.status(500).json({ error: "Failed to delete ledger entry" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Admin: explicitly sync the displayed balance to the ledger total
  // (used after a manual override to re-enable auto-sync).
  // ------------------------------------------------------------------
  router.post(
    "/:id/ledger/sync",
    checkAdminAuth,
    async (req: AdminAuthedRequest, res: Response) => {
      try {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        const adminUser = req.admin?.username || 'Admin';
        const newTotal = await storage.computeCaseLedgerTotal(req.params.id);
        const prevBalance = (caseRow.userBalance ?? '').trim();
        const syncPatch: Partial<InsertCase> = {
          userBalance: newTotal || null,
          userBalanceLastSyncedTotal: newTotal,
        };
        try {
          await storage.runInTransaction(async (tx) => {
            await storage.updateCase(req.params.id, syncPatch, tx);
            await safeAudit('case_balance_manual_sync', adminUser, req.params.id, {
              from: prevBalance,
              to: newTotal,
            }, tx);
          });
        } catch (txErr) {
          console.error('[caseLedger] sync transaction failed:', txErr);
          res.status(500).json({ error: "Failed to sync balance" });
          return;
        }
        res.json({
          newTotal,
          didSync: true,
          manualOverrideActive: false,
        });
      } catch (err) {
        console.error('[caseLedger] sync failed:', err);
        res.status(500).json({ error: "Failed to sync balance" });
      }
    },
  );
}
