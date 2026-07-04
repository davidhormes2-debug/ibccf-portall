/**
 * Per-case withdrawal-request observation log. Mirrors `stageHistory.ts`
 * and `payoutWalletHistory.ts` so the dashboard can render a one-time
 * banner the first time the user sees their request transition from
 * pending → approved / rejected / cancelled — without any schema change.
 */
export interface WithdrawalRequestHistoryEntry {
  requestId: number;
  status: string;
  observedAt: string;
  /** Server-stamped `reviewedAt`; null/absent when not yet reviewed (or
   *  when the admin rolled back to an earlier status). Optional so that
   *  entries written by older code (without this field) remain valid. */
  statusChangedAt?: string | null;
}

const KEY_PREFIX = "ibccf_withdrawal_request_history_";
const SEEN_PREFIX = "ibccf_withdrawal_request_seen_";
const MAX_ENTRIES = 50;

function key(caseId: string) {
  return `${KEY_PREFIX}${caseId}`;
}

function isEntry(value: unknown): value is WithdrawalRequestHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.requestId === "number" &&
    typeof v.status === "string" &&
    typeof v.observedAt === "string"
  );
}

function safeRead(caseId: string): WithdrawalRequestHistoryEntry[] {
  try {
    const raw = localStorage.getItem(key(caseId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

function safeWrite(caseId: string, entries: WithdrawalRequestHistoryEntry[]) {
  try {
    localStorage.setItem(
      key(caseId),
      JSON.stringify(entries.slice(-MAX_ENTRIES)),
    );
  } catch {
    // ignore quota errors
  }
}

/**
 * Returns the high-water `statusChangedAt` string across all history entries
 * for the given requestId. ISO 8601 timestamps are lexicographically
 * sortable, so a plain string comparison is sufficient. Returns null when no
 * matching entry has a non-null statusChangedAt.
 */
function localHighWater(
  history: WithdrawalRequestHistoryEntry[],
  requestId: number,
): string | null {
  let best: string | null = null;
  for (const entry of history) {
    if (entry.requestId !== requestId) continue;
    const v = entry.statusChangedAt || null;
    if (v && (!best || v > best)) best = v;
  }
  return best;
}

/**
 * Record an observed withdrawal-request status for a case. Returns the
 * previous status (or null) and whether this is a brand-new change relative
 * to the most recent entry for that request.
 *
 * Pass `highWaterStatusChangedAt` (the server-side `reviewedAt` for the
 * request). The server retains this timestamp even when an admin resets the
 * status, so it acts as a persistent high-water mark. When the effective
 * high-water (max of the server-supplied value and the local history maximum)
 * exceeds the incoming `highWaterStatusChangedAt`, the observation is
 * silently dropped and `isNew` is returned as `false`, preventing duplicate
 * or backwards entries in the Activity Timeline.
 */
export function recordWithdrawalRequestObservation(
  caseId: string,
  requestId: number,
  status: string,
  highWaterStatusChangedAt?: string | null,
): { previousStatus: string | null; isNew: boolean } {
  if (!caseId || !Number.isFinite(requestId) || !status) {
    return { previousStatus: null, isNew: false };
  }
  const history = safeRead(caseId);
  const last = [...history].reverse().find((e) => e.requestId === requestId);

  // High-water mark: take the maximum of the server-supplied
  // highWaterStatusChangedAt and whatever the local history already recorded
  // for this requestId. This prevents a roll-back (admin reset) from adding
  // a backwards entry or re-firing the one-time banner.
  const localHW = localHighWater(history, requestId);
  const effectiveHighWater =
    highWaterStatusChangedAt && localHW
      ? highWaterStatusChangedAt > localHW
        ? highWaterStatusChangedAt
        : localHW
      : highWaterStatusChangedAt || localHW;

  // The "incoming" timestamp is the server-reviewed-at that belongs to THIS
  // observation. A "pending" status has no reviewedAt by definition (the
  // request hasn't been reviewed yet, or the admin rolled it back), so we
  // treat it as null regardless of what hint the server supplies. For
  // terminal statuses (approved / rejected / cancelled) the hint IS the
  // observation's own timestamp.
  const incomingChangedAt =
    status === "pending" ? null : (highWaterStatusChangedAt || null);

  // Roll-back: the incoming observation has no statusChangedAt (or an earlier
  // one) while the effective high-water tells us a reviewed state was already
  // seen. Silently ignore so the Activity Timeline stays clean.
  if (effectiveHighWater) {
    if (!incomingChangedAt || incomingChangedAt < effectiveHighWater) {
      return { previousStatus: last?.status ?? null, isNew: false };
    }
  }

  // Idempotency: same status AND same statusChangedAt — nothing new to record.
  const lastChangedAt = last?.statusChangedAt ?? null;
  if (last && last.status === status && lastChangedAt === incomingChangedAt) {
    return { previousStatus: last.status, isNew: false };
  }
  const previousStatus = last?.status ?? null;
  history.push({
    requestId,
    status,
    observedAt: new Date().toISOString(),
    statusChangedAt: highWaterStatusChangedAt ?? null,
  });
  safeWrite(caseId, history);
  return { previousStatus, isNew: true };
}

export function getWithdrawalRequestHistory(
  caseId: string,
): WithdrawalRequestHistoryEntry[] {
  return safeRead(caseId);
}

export function hasSeenWithdrawalRequestBanner(
  caseId: string,
  requestId: number,
  status: string,
): boolean {
  try {
    return (
      localStorage.getItem(
        `${SEEN_PREFIX}${caseId}_${requestId}_${status}`,
      ) === "1"
    );
  } catch {
    return true;
  }
}

export function markWithdrawalRequestBannerSeen(
  caseId: string,
  requestId: number,
  status: string,
) {
  try {
    localStorage.setItem(
      `${SEEN_PREFIX}${caseId}_${requestId}_${status}`,
      "1",
    );
  } catch {
    // ignore
  }
}
