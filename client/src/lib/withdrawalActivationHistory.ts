// Mirrors `stageHistory.ts` / `payoutWalletHistory.ts`: records the
// observed withdrawal-activation state for each case so the portal can
// (1) fire a one-time per-transition banner and (2) seed the Activity
// Timeline with first-class entries without any backend schema change.

export interface WithdrawalActivationSnapshot {
  status: string;
  /** Server-stamped `withdrawalActivationApprovedAt`; null when not yet
   *  approved (or when the caller derives it is not currently applicable). */
  approvedAt: string | null;
}

export interface WithdrawalActivationHistoryEntry {
  observedAt: string;
  snapshot: WithdrawalActivationSnapshot;
}

const KEY_PREFIX = "ibccf_wact_history_";
const SEEN_PREFIX = "ibccf_wact_seen_";
const MAX_ENTRIES = 50;

function key(caseId: string) {
  return `${KEY_PREFIX}${caseId}`;
}

function isEntry(value: unknown): value is WithdrawalActivationHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.observedAt !== "string") return false;
  const s = v.snapshot as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object") return false;
  return typeof s.status === "string";
}

function safeRead(caseId: string): WithdrawalActivationHistoryEntry[] {
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

function safeWrite(caseId: string, entries: WithdrawalActivationHistoryEntry[]) {
  try {
    localStorage.setItem(key(caseId), JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* ignore quota */
  }
}

function snapshotEqual(
  a: WithdrawalActivationSnapshot,
  b: WithdrawalActivationSnapshot,
): boolean {
  return (
    a.status === b.status && (a.approvedAt || null) === (b.approvedAt || null)
  );
}

/**
 * Returns the high-water `approvedAt` string across all history entries.
 * ISO 8601 timestamps are lexicographically sortable, so a plain string
 * comparison is sufficient. Returns null when no entry has a non-null
 * approvedAt.
 */
function localHighWater(history: WithdrawalActivationHistoryEntry[]): string | null {
  let best: string | null = null;
  for (const entry of history) {
    const v = entry.snapshot.approvedAt || null;
    if (v && (!best || v > best)) best = v;
  }
  return best;
}

/**
 * Record an observed withdrawal-activation snapshot for a case. Returns the
 * previous snapshot (or null) and a flag indicating whether this is a
 * brand-new change relative to the most recent entry. Mirrors
 * payoutWalletHistory so the dashboard can drive a one-time transition
 * banner without any schema change on the server.
 *
 * Pass `highWaterApprovedAt` (the server-side `withdrawalActivationApprovedAt`
 * for the case). The server retains this timestamp even after an admin
 * status-reset, so it acts as a persistent high-water mark. When the
 * effective high-water (max of the server-supplied value and the local
 * history maximum) exceeds the incoming snapshot's own `approvedAt`, the
 * observation is silently dropped and `isNew` is returned as `false`.
 */
export function recordActivationObservation(
  caseId: string,
  snapshot: WithdrawalActivationSnapshot,
  highWaterApprovedAt?: string | null,
): { previous: WithdrawalActivationSnapshot | null; isNew: boolean } {
  if (!caseId || !snapshot.status) return { previous: null, isNew: false };
  const history = safeRead(caseId);
  const last = history.length > 0 ? history[history.length - 1].snapshot : null;

  // High-water mark: take the maximum of the server-supplied
  // highWaterApprovedAt and whatever the local history already recorded.
  // This prevents a roll-back (admin clear/reset) from adding a backwards
  // entry or re-firing the one-time banner.
  const localHW = localHighWater(history);
  const effectiveHighWater =
    highWaterApprovedAt && localHW
      ? highWaterApprovedAt > localHW ? highWaterApprovedAt : localHW
      : highWaterApprovedAt || localHW;

  const incomingApprovedAt = snapshot.approvedAt || null;

  // Roll-back: the incoming snapshot has no approvedAt (or an earlier one)
  // while the effective high-water tells us an approval was already seen.
  // Silently ignore so the Activity Timeline stays clean.
  if (effectiveHighWater) {
    if (!incomingApprovedAt || incomingApprovedAt < effectiveHighWater) {
      return { previous: last, isNew: false };
    }
  }

  if (last && snapshotEqual(last, snapshot)) {
    return { previous: last, isNew: false };
  }
  history.push({ observedAt: new Date().toISOString(), snapshot });
  safeWrite(caseId, history);
  return { previous: last, isNew: true };
}

export function getActivationHistory(
  caseId: string,
): WithdrawalActivationHistoryEntry[] {
  return safeRead(caseId);
}

export function hasSeenActivationBanner(caseId: string, status: string): boolean {
  try {
    return localStorage.getItem(`${SEEN_PREFIX}${caseId}_${status}`) === "1";
  } catch {
    return true;
  }
}

export function markActivationBannerSeen(caseId: string, status: string): void {
  try {
    localStorage.setItem(`${SEEN_PREFIX}${caseId}_${status}`, "1");
  } catch {
    /* ignore */
  }
}
