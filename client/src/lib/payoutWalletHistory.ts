export interface PayoutWalletSnapshot {
  address: string | null;
  asset: string | null;
  network: string | null;
  note: string | null;
  verifiedAt: string | null;
}

export interface PayoutWalletHistoryEntry {
  observedAt: string;
  snapshot: PayoutWalletSnapshot;
}

export const PAYOUT_WALLET_HISTORY_PREFIX = "ibccf_payout_wallet_history_";
export const PAYOUT_WALLET_SEEN_PREFIX = "ibccf_payout_wallet_seen_";
const KEY_PREFIX = PAYOUT_WALLET_HISTORY_PREFIX;
const SEEN_PREFIX = PAYOUT_WALLET_SEEN_PREFIX;
const MAX_ENTRIES = 30;

/**
 * Startup housekeeping: scan localStorage for any payout-wallet history keys
 * and trim each one to MAX_ENTRIES. Guards against entries that grew beyond
 * the cap in earlier versions before the per-write limit was introduced, and
 * ensures the invariant holds even when localStorage is written outside the
 * normal safeWrite path. Safe to call on every page load — it is a no-op when
 * all keys are already within bounds or localStorage is unavailable.
 */
export function prunePayoutWalletHistory(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(KEY_PREFIX))
      .forEach((k) => {
        try {
          const raw = localStorage.getItem(k);
          if (!raw) return;
          const parsed: unknown = JSON.parse(raw);
          if (!Array.isArray(parsed)) return;
          if (parsed.length > MAX_ENTRIES) {
            localStorage.setItem(
              k,
              JSON.stringify(parsed.slice(-MAX_ENTRIES)),
            );
          }
        } catch {
          // ignore malformed entries
        }
      });
  } catch {
    // localStorage may be unavailable (private browsing, storage quota, etc.)
  }
}

function key(caseId: string) {
  return `${KEY_PREFIX}${caseId}`;
}

function isEntry(value: unknown): value is PayoutWalletHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.observedAt !== "string") return false;
  const s = v.snapshot as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object") return false;
  return true;
}

function safeRead(caseId: string): PayoutWalletHistoryEntry[] {
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

function safeWrite(caseId: string, entries: PayoutWalletHistoryEntry[]) {
  try {
    localStorage.setItem(
      key(caseId),
      JSON.stringify(entries.slice(-MAX_ENTRIES)),
    );
  } catch {
    // ignore quota errors
  }
}

function snapshotEqual(a: PayoutWalletSnapshot, b: PayoutWalletSnapshot): boolean {
  return (
    (a.address || null) === (b.address || null) &&
    (a.asset || null) === (b.asset || null) &&
    (a.network || null) === (b.network || null) &&
    (a.note || null) === (b.note || null)
  );
}

/**
 * Returns the high-water `verifiedAt` string across all history entries.
 * ISO 8601 timestamps are lexicographically sortable, so a plain string
 * comparison is sufficient. Returns null when history is empty or no
 * entry has a non-null verifiedAt.
 */
function localHighWater(history: PayoutWalletHistoryEntry[]): string | null {
  let best: string | null = null;
  for (const entry of history) {
    const v = entry.snapshot.verifiedAt || null;
    if (v && (!best || v > best)) best = v;
  }
  return best;
}

/**
 * Record an observed payout wallet for a case. Returns the previous
 * snapshot (or null) and a flag indicating whether this is a brand-new
 * change relative to the most recent entry. Mirrors stageHistory so the
 * dashboard can drive a one-time transition banner without any schema
 * change on the server.
 *
 * Pass `highWaterVerifiedAt` (the server-side `payoutWalletVerifiedAt` for
 * the case) so that an admin clear/reset never records a backwards entry or
 * re-fires the one-time banner. When the incoming snapshot's `verifiedAt`
 * is earlier than the effective high-water mark (max of the server-supplied
 * value and the local history maximum) the observation is silently dropped
 * and `isNew` is returned as `false`.
 */
export function recordPayoutWalletObservation(
  caseId: string,
  snapshot: PayoutWalletSnapshot,
  highWaterVerifiedAt?: string | null,
): { previous: PayoutWalletSnapshot | null; isNew: boolean } {
  if (!caseId) return { previous: null, isNew: false };
  // Skip empty observations entirely until the first real verification —
  // we don't want to seed a "wallet cleared" entry just because the user
  // logged into a case that never had a payout wallet.
  const isEmpty =
    !(snapshot.address || "").trim() &&
    !(snapshot.asset || "").trim() &&
    !(snapshot.network || "").trim() &&
    !(snapshot.note || "").trim();
  const history = safeRead(caseId);
  const last = history.length > 0 ? history[history.length - 1].snapshot : null;
  if (isEmpty && !last) return { previous: null, isNew: false };

  // High-water mark: take the maximum of the server-supplied
  // highWaterVerifiedAt and whatever the local history already recorded.
  // This prevents a roll-back (admin clear/reset) from adding a backwards
  // entry or re-firing the one-time banner.
  const localHW = localHighWater(history);
  const effectiveHighWater =
    highWaterVerifiedAt && localHW
      ? highWaterVerifiedAt > localHW ? highWaterVerifiedAt : localHW
      : highWaterVerifiedAt || localHW;

  const incomingVerifiedAt = snapshot.verifiedAt || null;

  // Roll-back: the incoming snapshot has no verifiedAt (or an earlier one)
  // while the effective high-water tells us a later wallet was already seen.
  // Silently ignore so the Activity Timeline stays clean.
  if (effectiveHighWater) {
    if (!incomingVerifiedAt || incomingVerifiedAt < effectiveHighWater) {
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

export function getPayoutWalletHistory(caseId: string): PayoutWalletHistoryEntry[] {
  return safeRead(caseId);
}

export function hasSeenPayoutWalletBanner(caseId: string, observedAt: string): boolean {
  try {
    return localStorage.getItem(`${SEEN_PREFIX}${caseId}_${observedAt}`) === "1";
  } catch {
    return true;
  }
}

export function markPayoutWalletBannerSeen(caseId: string, observedAt: string) {
  try {
    localStorage.setItem(`${SEEN_PREFIX}${caseId}_${observedAt}`, "1");
  } catch {
    // ignore
  }
}
