import { caseService } from "./CaseService";
import { storage } from "../storage";

/**
 * Task #70 — NDA-triggered auto-finalization.
 *
 * Idempotent: once `autoFinalizedAt` is stamped we bail out so a
 * subsequent re-sign (after an admin override) cannot double-fire
 * side effects (email, audit, stage flip).
 *
 * On first run we:
 *   • flip the case to stage 14, status='completed'
 *   • stamp `autoFinalizedAt` / `autoFinalizedBy`
 *   • write an audit row
 *   • send the localized "case finalized" email (best-effort)
 */
export async function finalizeCaseAfterNda(caseId: string, actor: string): Promise<void> {
  const caseData = await storage.getCaseById(caseId);
  if (!caseData) return;
  if (caseData.autoFinalizedAt) return; // idempotent

  const now = new Date();
  await caseService.updateCase(caseId, {
    withdrawalStage: "14",
    status: "completed",
    autoFinalizedAt: now,
    autoFinalizedBy: actor,
    showWithdrawalProgress: true,
  });

  try {
    await storage.createAuditLog({
      action: "case_auto_finalized_after_nda",
      targetType: "case",
      targetId: caseId,
      adminUsername: actor,
      newValue: `Case auto-finalized (stage 14, status completed) after NDA signing at ${now.toISOString()}`,
    });
  } catch (err) {
    console.error("audit log for case_auto_finalized_after_nda failed:", err);
  }

  if (caseData.userEmail) {
    try {
      const [{ emailService }, { sendCaseEmailWithAudit }] = await Promise.all([
        import("./EmailService"),
        import("./emailNotify"),
      ]);
      const userName = (caseData.userName ?? "").trim() || caseData.userEmail;
      await sendCaseEmailWithAudit({
        to: caseData.userEmail,
        caseId,
        tag: "case_finalized",
        adminUser: actor,
        send: (locale) =>
          emailService.sendLocalizedCaseEmail({
            to: caseData.userEmail!,
            userName,
            caseRef: caseId,
            locale,
            templateKey: "caseFinalized",
            ctaPath: "/portal?view=dashboard",
            logTag: "case-finalized",
          }),
      });
    } catch (err) {
      console.error("case_finalized email failed:", err);
    }
  }
}
