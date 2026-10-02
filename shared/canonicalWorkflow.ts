export type CanonicalWorkflowStep = {
  id: number;
  key:
    | "signup"
    | "questionnaire"
    | "agreement"
    | "restricted_portal"
    | "kyc"
    | "declaration_of_funds"
    | "wallet_linking"
    | "tracking_recovery"
    | "crypto_escrow"
    | "sequence_recovery";
  label: string;
  description: string;
  icon: string;
};

export const CANONICAL_CASE_WORKFLOW: CanonicalWorkflowStep[] = [
  { id: 1, key: "signup", label: "Signup", description: "Account created and case identity established.", icon: "👤" },
  { id: 2, key: "questionnaire", label: "Questionnaire", description: "Case intake information submitted for review.", icon: "📝" },
  { id: 3, key: "agreement", label: "Agreement", description: "Required case agreement reviewed and accepted.", icon: "✍️" },
  { id: 4, key: "restricted_portal", label: "Restricted Portal", description: "Secure case workspace activated.", icon: "🔐" },
  { id: 5, key: "kyc", label: "KYC", description: "Identity and verification documents reviewed.", icon: "🪪" },
  { id: 6, key: "declaration_of_funds", label: "Declaration of Funds", description: "Declaration and supporting compliance information reviewed.", icon: "📄" },
  { id: 7, key: "wallet_linking", label: "Wallet Linking & Calibration", description: "Approved payout method linked and calibrated.", icon: "🔗" },
  { id: 8, key: "tracking_recovery", label: "Tracking & Recovery", description: "Case tracking and recovery activity in progress.", icon: "📡" },
  { id: 9, key: "crypto_escrow", label: "Crypto Escrow Wallet Creation", description: "Escrow wallet and final clearance controls prepared.", icon: "🛡️" },
  { id: 10, key: "sequence_recovery", label: "Sequence Recovery", description: "Final recovery sequence and case completion.", icon: "✅" },
];

export const CANONICAL_CASE_STAGE_COUNT = CANONICAL_CASE_WORKFLOW.length;

export function toCanonicalCaseStage(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value || "1", 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(Math.trunc(parsed), 1), CANONICAL_CASE_STAGE_COUNT);
}

export function getCanonicalWorkflowStep(value: string | number | null | undefined): CanonicalWorkflowStep {
  return CANONICAL_CASE_WORKFLOW[toCanonicalCaseStage(value) - 1];
}


export type CanonicalWorkflowEmailDetail = {
  stage: number;
  icon: string;
  title: string;
  summary: string;
  detailedExplanation: string;
  whyItMatters: string;
  whatToDo: string[];
  whatToExpect: string;
  regulatoryBasis: string[];
};

const CANONICAL_STEP_ACTIONS: Record<number, string[]> = {
  1: ["Confirm your profile and contact details are correct."],
  2: ["Complete any outstanding questionnaire fields.", "Submit accurate supporting information where requested."],
  3: ["Review the agreement carefully.", "Accept or sign it only when the details are correct."],
  4: ["Use the secure portal for case activity and messages.", "Keep your access credentials private."],
  5: ["Upload the requested identity documents.", "Check that each file is clear and complete before submitting."],
  6: ["Complete the Declaration of Funds.", "Upload any supporting financial documents requested for your case."],
  7: ["Confirm the approved payout method.", "Complete wallet linking and calibration only through the secure portal."],
  8: ["Monitor the case timeline for verified updates.", "Respond to case-officer requests when action is required."],
  9: ["Review any final clearance requests in the secure portal.", "Confirm escrow-related details shown on your case record."],
  10: ["Review the final case summary.", "Confirm any remaining completion action shown in the portal."],
};

export function getCanonicalWorkflowEmailDetail(
  value: string | number | null | undefined,
): CanonicalWorkflowEmailDetail {
  const step = getCanonicalWorkflowStep(value);
  const next =
    step.id < CANONICAL_CASE_STAGE_COUNT
      ? CANONICAL_CASE_WORKFLOW[step.id]
      : null;

  return {
    stage: step.id,
    icon: step.icon,
    title: step.label,
    summary: step.description,
    detailedExplanation:
      `This workflow step records and coordinates ${step.label.toLowerCase()} activity for the case. Use the secure case workspace as the source of truth for status, documents, messages and required actions.`,
    whyItMatters:
      "Keeping this workflow step current keeps the case record, supporting documents, communications and next actions aligned for review.",
    whatToDo: CANONICAL_STEP_ACTIONS[step.id] ?? ["Review the secure portal for the action required on your case."],
    whatToExpect: next
      ? `After this step is completed, the case moves to ${next.label}.`
      : "After the final checks are completed, the case remains available as a completed record with its audit history.",
    regulatoryBasis: [],
  };
}
