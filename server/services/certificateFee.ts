import type { Case } from "@shared/schema";
import { storage } from "../storage";

export const CERTIFICATE_FEE_DEFAULT_PERCENT_KEY = "certificate_fee_default_percent";
export const DEFAULT_CERTIFICATE_FEE_PERCENT = 5;

function parseNumeric(value: string | null | undefined): number {
  if (value == null) return NaN;
  const cleaned = String(value).replace(/[,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export async function getGlobalDefaultCertificateFeePercent(): Promise<number> {
  try {
    const row = await storage.getAppSetting(CERTIFICATE_FEE_DEFAULT_PERCENT_KEY);
    const n = parseNumeric(row?.value ?? null);
    if (Number.isFinite(n) && n > 0 && n <= 100) return n;
  } catch {
    /* fall through to default */
  }
  return DEFAULT_CERTIFICATE_FEE_PERCENT;
}

export async function getEffectiveCertificateFeePercent(caseRow: Pick<Case, "certificateFeePercent">): Promise<number> {
  const perCase = parseNumeric(caseRow.certificateFeePercent);
  if (Number.isFinite(perCase) && perCase > 0 && perCase <= 100) return perCase;
  return await getGlobalDefaultCertificateFeePercent();
}

/**
 * Compute the certification fee from the withdrawal amount and a percent.
 * Returns an object with the numeric fields needed to persist a payment
 * row (`amountUsdt`, `percentUsed`, `baseAmountUsed`) plus the parsed
 * base for downstream UI. Throws if the case has no usable withdrawal
 * amount — fee gating is meaningless without a base.
 */
export function computeCertificateFee(
  withdrawalAmount: string | null | undefined,
  percent: number,
): { amountUsdt: string; percentUsed: string; baseAmountUsed: string; base: number; fee: number } {
  const base = parseNumeric(withdrawalAmount);
  if (!Number.isFinite(base) || base <= 0) {
    throw new Error("Withdrawal amount is not set on this case — fee cannot be computed.");
  }
  const fee = Math.round(base * percent) / 100;
  return {
    amountUsdt: fee.toFixed(2),
    percentUsed: String(percent),
    baseAmountUsed: base.toFixed(2),
    base,
    fee,
  };
}
