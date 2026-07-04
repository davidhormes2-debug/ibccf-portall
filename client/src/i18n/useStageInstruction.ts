// Locale-aware stage instruction lookup. Pulls the canonical English
// definition from `shared/stageInstructions.ts` and overlays the user-
// visible fields (title / summary / whatToExpect) from the active
// locale's `stages.json`. Keeps the deposit-messaging gotcha verbatim
// per replit.md (stage 7 carries the 1,000 USDT refundable + 500 USDT
// non-refundable wording in every locale).

import { useTranslation } from "react-i18next";
import {
  getStageInstructionLocalized,
  type StageInstruction,
} from "@shared/stageInstructions";

export function useStageInstruction(stageNumber: number): StageInstruction {
  const { t } = useTranslation("stages");
  return getStageInstructionLocalized(stageNumber, (_ns, key) => t(key));
}
