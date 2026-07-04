import { useCrossTabSync } from './useCrossTabSync';

const CHANNEL_NAME = 'ibccf-pending-counts';
const LOCK_NAME = 'ibccf-pending-counts-leader';

/** Default staleness window used by {@link isRecentBroadcast}. */
export const RECENT_BROADCAST_WINDOW_MS = 5000;

/**
 * Default staleness threshold multiplier for the stale-on-restore check.
 * When a tab restores from hidden after more than
 * `STALE_THRESHOLD_MULTIPLIER × intervalMs` milliseconds it force-acquires
 * the leader lock via `steal: true` instead of waiting in the queue.
 */
export const STALE_THRESHOLD_MULTIPLIER = 2;

// Module-level timestamp: updated whenever this tab receives a BroadcastChannel
// message from another tab.  Intentionally module-scoped so it persists across
// re-renders and can be queried by callers (e.g. usePendingCountsPolling) to
// decide whether a local poll is redundant.
let _lastBroadcastReceivedAt = 0;

/**
 * Returns `true` if this tab received a BroadcastChannel counts-update message
 * within the last `windowMs` milliseconds, `false` otherwise.
 *
 * Intended to be used as a `shouldSkipPoll` predicate: when fresh data has
 * just arrived from the leader tab there is no need for a local fetch.
 *
 * @param windowMs   Staleness window in ms (default {@link RECENT_BROADCAST_WINDOW_MS}).
 */
export function isRecentBroadcast(windowMs = RECENT_BROADCAST_WINDOW_MS): boolean {
  return _lastBroadcastReceivedAt > 0 && Date.now() - _lastBroadcastReceivedAt < windowMs;
}

/**
 * Exposed for tests only — resets the module-level broadcast timestamp.
 * @internal
 */
export function _resetBroadcastTimestamp(): void {
  _lastBroadcastReceivedAt = 0;
}

/**
 * Coordinates pending-counts badge state across browser tabs so that only
 * ONE tab polls the server per interval, regardless of how many admin tabs
 * are open.
 *
 * This is a thin wrapper around `useCrossTabSync` specialised for the
 * `Record<string, number>` counts map returned by
 * `GET /api/user-documents/pending-counts`.
 *
 * ## Stale-on-restore
 * If a follower tab has been hidden for longer than `staleThresholdMs`
 * (default `intervalMs × STALE_THRESHOLD_MULTIPLIER`) it force-acquires
 * the leader lock via `{ steal: true }` on visibility restore.  This prevents
 * a drifted background leader from delaying badge updates after long gaps.
 *
 * @param fetchFn          Pure async function that fetches `/api/user-documents/
 *                         pending-counts` and returns the counts map, or `null`
 *                         on any error.  Must not mutate state directly — the
 *                         hook calls `setCountsFn` and broadcasts on success.
 * @param setCountsFn      React state setter for `userDocPendingCounts`.
 * @param intervalMs       Leader polling cadence in ms (default 3000).
 * @param staleThresholdMs How long a tab must have been hidden before it
 *                         attempts to steal leadership on restore
 *                         (default `intervalMs × STALE_THRESHOLD_MULTIPLIER`).
 */
export function usePendingCountsSync(
  fetchFn: () => Promise<Record<string, number> | null>,
  setCountsFn: (counts: Record<string, number>) => void,
  intervalMs = 3000,
  staleThresholdMs = intervalMs * STALE_THRESHOLD_MULTIPLIER,
): void {
  useCrossTabSync(
    CHANNEL_NAME,
    LOCK_NAME,
    fetchFn,
    setCountsFn,
    undefined,
    () => { _lastBroadcastReceivedAt = Date.now(); },
    intervalMs,
    staleThresholdMs,
  );
}
