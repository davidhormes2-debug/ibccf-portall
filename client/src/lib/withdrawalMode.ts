import type { Case } from "@/pages/portal/PortalContext";

export function getIsWithdrawalMode(currentCase: Case | null | undefined): boolean {
  if (!currentCase) return false;
  if (currentCase.withdrawalWindowEnabled === true) return true;
  const stage = parseInt(currentCase.withdrawalStage || "0", 10);
  return Number.isFinite(stage) && stage >= 12;
}
