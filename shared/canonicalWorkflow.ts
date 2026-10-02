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
