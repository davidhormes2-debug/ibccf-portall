import type { RefundClaimStatus } from "@shared/types";

export interface RefundClaimCase {
  refundClaimStatus?: RefundClaimStatus | null;
}

export function countRefundClaimSubmitted(cases: RefundClaimCase[]): number {
  return cases.filter((c) => c.refundClaimStatus === "submitted").length;
}
