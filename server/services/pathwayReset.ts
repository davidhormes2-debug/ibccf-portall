import { db } from "../db";
import { storage } from "../storage";
import { declarationSubmissions, cases } from "../../shared/schema";
import { eq, and, inArray } from "drizzle-orm";

export type PathwayResetReason = "expired" | "override" | "skip";

/**
 * resetWithdrawalPathway — atomically voids a case's active withdrawal progress.
 *
 * Runs in a single DB transaction:
 *  1. Clears withdrawalStage (→ null), sealedAt/sealedBy (→ null), and
 *     declarationStatus (→ 'not_requested') on the cases row.
 *  2. Soft-voids any submitted declarationSubmissions rows for the case
 *     (status → 'voided' so the audit trail is preserved).
 *  3. Writes a `pathway_reset` audit log entry.
 *
 * Called by the portal-warning override, skip-to-reactivation, and (in the
 * future) any countdown-expiry auto-lock path.
 */
export async function resetWithdrawalPathway(
  caseId: string,
  reason: PathwayResetReason,
  adminUsername: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(cases)
      .set({
        withdrawalStage: null,
        sealedAt: null,
        sealedBy: null,
        declarationStatus: "not_requested",
      })
      .where(eq(cases.id, caseId));

    await tx
      .update(declarationSubmissions)
      .set({ status: "voided" })
      .where(
        and(
          eq(declarationSubmissions.caseId, caseId),
          inArray(declarationSubmissions.status, ["submitted"]),
        ),
      );

    await storage.createAuditLog(
      {
        action: "pathway_reset",
        adminUsername,
        targetType: "case",
        targetId: caseId,
        newValue: `Withdrawal pathway reset — reason: ${reason}`,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Audit-log metadata per disable reason
// ---------------------------------------------------------------------------

const DISABLE_AUDIT_ACTION: Record<PathwayResetReason, string> = {
  override: "override_countdown",
  skip: "skip_to_reactivation",
  expired: "portal_warning_expired",
};

const DISABLE_AUDIT_MESSAGE: Record<PathwayResetReason, string> = {
  override:
    "Admin overrode countdown — account disabled and user force-logged out",
  skip: "Admin skipped directly to reactivation — account disabled and user force-logged out",
  expired:
    "Portal closure countdown expired — account disabled automatically",
};

/**
 * disableAndResetPathway — atomically disables a case account AND resets its
 * withdrawal pathway in a single DB transaction.
 *
 * All writes happen inside one transaction so partial updates are impossible:
 *  1. Stamps isDisabled=true, forceLogoutAt=now, clears portal-warning fields,
 *     clears withdrawalStage, sealedAt/sealedBy, and declarationStatus.
 *  2. Soft-voids any submitted declarationSubmissions rows for the case.
 *  3. Writes the disable-specific audit log entry (action varies by reason).
 *  4. Writes the `pathway_reset` audit log entry.
 *
 * Called by the override, skip-to-reactivation, and portal-warning/expired
 * endpoints — replacing the previous split `updateCase` + separate
 * `resetWithdrawalPathway` calls that could leave the account half-disabled
 * if the reset step failed.
 */
export async function disableAndResetPathway(
  caseId: string,
  reason: PathwayResetReason,
  adminUsername: string,
): Promise<void> {
  const now = new Date();

  await db.transaction(async (tx) => {
    // 1. Disable the account, clear portal-warning, and reset pathway fields
    //    in a single UPDATE so there is no intermediate state where the
    //    account is disabled but the pathway is still live.
    await tx
      .update(cases)
      .set({
        isDisabled: true,
        forceLogoutAt: now,
        portalWarningAt: null,
        portalWarningMinutes: null,
        portalWarningMessage: null,
        withdrawalStage: null,
        sealedAt: null,
        sealedBy: null,
        declarationStatus: "not_requested",
        updatedAt: now,
      })
      .where(eq(cases.id, caseId));

    // 2. Soft-void any submitted declaration rows so the audit trail is kept.
    await tx
      .update(declarationSubmissions)
      .set({ status: "voided" })
      .where(
        and(
          eq(declarationSubmissions.caseId, caseId),
          inArray(declarationSubmissions.status, ["submitted"]),
        ),
      );

    // 3. Disable-specific audit log entry.
    await storage.createAuditLog(
      {
        action: DISABLE_AUDIT_ACTION[reason],
        adminUsername,
        targetType: "case",
        targetId: caseId,
        newValue: DISABLE_AUDIT_MESSAGE[reason],
      },
      tx,
    );

    // 4. Pathway-reset audit log entry.
    await storage.createAuditLog(
      {
        action: "pathway_reset",
        adminUsername,
        targetType: "case",
        targetId: caseId,
        newValue: `Withdrawal pathway reset — reason: ${reason}`,
      },
      tx,
    );
  });
}
