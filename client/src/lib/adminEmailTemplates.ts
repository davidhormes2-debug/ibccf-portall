import { STAGE_INSTRUCTIONS, getStageInstruction } from "@shared/stageInstructions";

export const STAGE_SHORT_LABELS: Record<number, string> = Object.fromEntries(
  STAGE_INSTRUCTIONS.map((s) => [s.stage, s.title]),
) as Record<number, string>;

export interface QuickSendTemplate {
  id: string;
  label: string;
  getSubject: (stageName: string) => string;
  getBody: (userName: string, stageName: string, stageNum: number | null) => string;
}

function buildStageInstructionsBody(userName: string, stageName: string, stageNum: number | null): string {
  const name = userName || "Valued Client";
  if (!stageNum) {
    return `Dear ${name},\n\nPlease log in to your secure portal to review the instructions for your current step in the withdrawal process.\n\nIf you have any questions, please contact us via the secure messaging feature in your portal.\n\nWarm regards,\nIBCCF Compliance Management Team`;
  }
  const instruction = getStageInstruction(stageNum);
  const whatToDo = instruction.whatToDo.map((item, i) => `${i + 1}. ${item}`).join("\n");
  return `Dear ${name},\n\nPlease review the instructions for your current withdrawal stage:\n\n${instruction.icon} Stage ${stageNum} — ${instruction.title}\n\n${instruction.summary}\n\nWHAT TO DO\n\n${whatToDo}\n\nWHAT TO EXPECT\n\n${instruction.whatToExpect}\n\nPlease log in to your secure portal to review your full stage details and complete any required actions.\n\nIf you have any questions, please contact us via the secure messaging feature in your portal.\n\nWarm regards,\nIBCCF Compliance Management Team`;
}

export const QUICK_SEND_TEMPLATES: QuickSendTemplate[] = [
  {
    id: "stage_instructions",
    label: "Send Stage Instructions",
    getSubject: (stageName) => `Your Case Update — ${stageName}`,
    getBody: (userName, stageName, stageNum) =>
      buildStageInstructionsBody(userName, stageName, stageNum),
  },
  {
    id: "withdrawal_reminder",
    label: "Withdrawal Reminder",
    getSubject: (stageName) => `Reminder: Action Required — ${stageName}`,
    getBody: (userName, stageName, _stageNum) =>
      `Dear ${userName || "Valued Client"},\n\nThis is a friendly reminder that your ${stageName} step is still pending action from you.\n\nPlease log in to your secure portal at your earliest convenience to review the required action and continue your withdrawal process.\n\nIf you have already completed this step, please disregard this message — our team will update your status shortly.\n\nWarm regards,\nIBCCF Compliance Management Team`,
  },
  {
    id: "deposit_received",
    label: "Deposit Received",
    getSubject: (_stageName) => `Deposit Received — Your Case Is Being Reviewed`,
    getBody: (userName, _stageName, _stageNum) =>
      `Dear ${userName || "Valued Client"},\n\nWe have received your deposit and your case is currently being reviewed by our compliance team.\n\nNo further action is required from you at this time. You will be notified as soon as your case advances to the next stage.\n\nThank you for your prompt action.\n\nWarm regards,\nIBCCF Compliance Management Team`,
  },
  {
    id: "processing_update",
    label: "Processing Update",
    getSubject: (_stageName) => `Processing Update — Your Withdrawal Is Being Processed`,
    getBody: (userName, _stageName, _stageNum) =>
      `Dear ${userName || "Valued Client"},\n\nWe wanted to provide you with a brief update: your withdrawal is currently being processed by our compliance and settlement team.\n\nWe will notify you of any updates or when further action is required from you. Please log in to your portal to monitor your case progress.\n\nThank you for your patience.\n\nWarm regards,\nIBCCF Compliance Management Team`,
  },
  {
    id: "clarification_followup",
    label: "Clarification / Follow-up",
    getSubject: (_stageName) => `Important: Please Review and Follow Up`,
    getBody: (userName, _stageName, _stageNum) =>
      `Dear ${userName || "Valued Client"},\n\nPlease review the information below and contact us if you have any questions.\n\n[Add your message here]\n\nIf you need any clarification, please do not hesitate to reach out via the secure messaging feature in your portal.\n\nWarm regards,\nIBCCF Compliance Management Team`,
  },
];
