import type { SharedStampDutyStatus } from "@shared/constants";

export type StampDutyStatus = SharedStampDutyStatus;

export interface StampDutySnapshot {
  enabled: boolean;
  status: StampDutyStatus;
  amount: string | null;
  approvedAt: string | null;
}

export interface StampDutyHistoryEntry {
  observedAt: string;
  snapshot: StampDutySnapshot;
}

const KEY_PREFIX = "ibccf_stamp_duty_history_";
const SEEN_PREFIX = "ibccf_stamp_duty_seen_";
const MAX_ENTRIES = 30;

function key(caseId: string) {
  return `${KEY_PREFIX}${caseId}`;
}

function isEntry(value: unknown): value is StampDutyHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.observedAt !== "string") return false;
  const s = v.snapshot as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object") return false;
  return typeof s.status === "string";
}

function safeRead(caseId: string): StampDutyHistoryEntry[] {
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

function safeWrite(caseId: string, entries: StampDutyHistoryEntry[]) {
  try {
    localStorage.setItem(
      key(caseId),
      JSON.stringify(entries.slice(-MAX_ENTRIES)),
    );
  } catch {
    // ignore quota errors
  }
}

function snapshotEqual(a: StampDutySnapshot, b: StampDutySnapshot): boolean {
  return (
    a.enabled === b.enabled &&
    a.status === b.status &&
    (a.amount || null) === (b.amount || null) &&
    (a.approvedAt || null) === (b.approvedAt || null)
  );
}

/**
 * Returns the high-water `approvedAt` string across all history entries.
 * ISO 8601 timestamps are lexicographically sortable, so a plain string
 * comparison is sufficient. Returns null when no entry has a non-null
 * approvedAt.
 */
function localHighWater(history: StampDutyHistoryEntry[]): string | null {
  let best: string | null = null;
  for (const entry of history) {
    const v = entry.snapshot.approvedAt || null;
    if (v && (!best || v > best)) best = v;
  }
  return best;
}

/**
 * Record an observed stamp-duty snapshot for a case. Returns the
 * previous snapshot (or null) and whether this is a brand-new change
 * relative to the most recent entry. Mirrors stageHistory /
 * payoutWalletHistory so the dashboard can drive a one-time transition
 * highlight without any schema change on the server.
 *
 * Pass `highWaterApprovedAt` (the server-side `stampDutyApprovedAt` for
 * the case) so that an admin clear/reset never records a backwards entry or
 * re-fires the one-time banner. When the incoming snapshot's `approvedAt`
 * is absent while the effective high-water tells us an approval was already
 * seen, the observation is silently dropped and `isNew` is returned as
 * `false`.
 */
export function recordStampDutyObservation(
  caseId: string,
  snapshot: StampDutySnapshot,
  highWaterApprovedAt?: string | null,
): { previous: StampDutySnapshot | null; isNew: boolean } {
  if (!caseId) return { previous: null, isNew: false };
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

export function getStampDutyHistory(caseId: string): StampDutyHistoryEntry[] {
  return safeRead(caseId);
}

export function hasSeenStampDutyBanner(
  caseId: string,
  status: StampDutyStatus,
): boolean {
  try {
    return localStorage.getItem(`${SEEN_PREFIX}${caseId}_${status}`) === "1";
  } catch {
    return true;
  }
}

export function markStampDutyBannerSeen(
  caseId: string,
  status: StampDutyStatus,
) {
  try {
    localStorage.setItem(`${SEEN_PREFIX}${caseId}_${status}`, "1");
  } catch {
    // ignore
  }
}
