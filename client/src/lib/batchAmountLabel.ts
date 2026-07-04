import { BATCH_FEE_NOTES_PREFIX } from "../../../shared/constants";

/**
 * Extracts the display amount from a batch-history receipt's notes field.
 *
 * Notes are stored as `"${BATCH_FEE_NOTES_PREFIX}<amount>"` by the server.
 * This helper strips that prefix (case-insensitively) so only the amount
 * portion is shown in the UI.  The regex is built from the shared constant so
 * the producer and consumer can never silently drift apart.  If the prefix is
 * absent the raw notes string is returned as-is so unexpected formats are still
 * surfaced rather than silently discarded.  A null / undefined input falls back
 * to an em-dash.
 */
export function extractBatchAmountLabel(notes: string | null | undefined): string {
  if (!notes) return "—";
  // Build the pattern from the shared constant.  trimEnd() removes the
  // trailing space so the regex can match any run of whitespace after the
  // colon (e.g. "Batch merge fee:   500 USDT" → "500 USDT").
  const escaped = BATCH_FEE_NOTES_PREFIX.trimEnd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return notes.replace(new RegExp(`^${escaped}\\s*`, "i"), "").trim();
}
