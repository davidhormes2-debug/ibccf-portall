// Shared pure helpers for the scaling withdrawal token-deposit.
//
// The required token deposit scales with the case's withdrawal balance at a
// per-case rate (default 600 USDT per 100,000 USDT). Both server (invoice /
// endpoint logic) and client (portal toast + admin hint) import from here so
// the math can never drift between the two.

export const DEFAULT_TOKEN_DEPOSIT_RATE_PER_100K = 600;
export const TOKEN_DEPOSIT_UNIT = 100_000;

/**
 * Parse the leading numeric value out of a free-form withdrawal-amount string
 * such as "500,000 USDT" → 500000. Strips thousands separators and currency
 * labels. Returns 0 when no parseable number is found.
 */
export function parseAmountNumber(raw: string | null | undefined): number {
  if (!raw) return 0;
  // Keep digits and a single decimal point; drop commas, spaces, currency labels.
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Parse a per-case rate string into a number, falling back to the default. */
export function parseRatePer100k(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return DEFAULT_TOKEN_DEPOSIT_RATE_PER_100K;
  }
  const n = Number.parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TOKEN_DEPOSIT_RATE_PER_100K;
}

/**
 * Compute the required token deposit (a plain number, USDT) from a free-form
 * withdrawal amount string and a per-case rate. Result is rounded to 2 decimal
 * places. Returns 0 when the amount or rate cannot be parsed.
 */
export function computeTokenDepositRequired(
  withdrawalAmount: string | null | undefined,
  ratePer100k: string | number | null | undefined,
): number {
  const amount = parseAmountNumber(withdrawalAmount);
  const rate =
    typeof ratePer100k === "number"
      ? ratePer100k
      : parseRatePer100k(String(ratePer100k ?? ""));
  if (amount <= 0 || rate <= 0) return 0;
  const required = (amount / TOKEN_DEPOSIT_UNIT) * rate;
  return Math.round(required * 100) / 100;
}

/** Format a USDT number for display, e.g. 3000 → "3,000". */
export function formatUsdt(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  const hasFraction = rounded % 1 !== 0;
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });
}

/**
 * Convenience: the required token deposit as a display string with the USDT
 * suffix, e.g. "3,000 USDT". Returns null when the amount cannot be computed.
 */
export function formatTokenDepositRequired(
  withdrawalAmount: string | null | undefined,
  ratePer100k: string | number | null | undefined,
): string | null {
  const required = computeTokenDepositRequired(withdrawalAmount, ratePer100k);
  if (required <= 0) return null;
  return `${formatUsdt(required)} USDT`;
}
