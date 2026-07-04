/**
 * useCrossTabSync — generic cross-tab polling coordinator.
 *
 * Coordinates polling and state distribution across browser tabs so that only
 * ONE tab polls the server per interval, regardless of how many admin tabs are
 * open.
 *
 * ## Leader election
 * When Web Locks (`navigator.locks`) AND BroadcastChannel are both available
 * the hook uses an exclusive Web Lock named `lockName` for deterministic
 * single-poller coordination:
 *   - The first tab to call the hook acquires the lock and becomes the LEADER.
 *   - The lock is held for the lifetime of the component (released on unmount).
 *   - The browser automatically releases the lock when the tab/page closes, so
 *     the next waiting tab immediately acquires it and becomes the new leader.
 *   - The leader polls `fetchFn` every `intervalMs` ms, calls `onLeaderFetch`
 *     (if provided) for leader-only side effects, and broadcasts the result
 *     over BroadcastChannel so sibling tabs update without fetching.
 *
 * ## Non-leader tabs
 *   - Receive BroadcastChannel messages → call `setFn`.
 *   - Do NOT poll on the interval.
 *   - Still fetch once on mount (initial state before the leader's first
 *     broadcast arrives) and on visibility restore (safety net for edge cases
 *     where the leader is transiently unavailable).
 *
 * ## Stale-on-restore
 * If a follower tab has been hidden for longer than `staleThresholdMs`
 * (default `intervalMs × 2`) it force-acquires the leader lock via
 * `{ steal: true }` on visibility restore.  This prevents a drifted
 * background leader from delaying updates after long gaps.
 *
 * ## Fallback
 * When either Web Locks or BroadcastChannel is unavailable every tab behaves
 * as its own leader (the pre-existing per-tab polling cadence is preserved).
 *
 * @param channelName        BroadcastChannel name (must be unique per data stream).
 * @param lockName           Web Lock name (must be unique per data stream).
 * @param fetchFn            Pure async function that fetches the resource and
 *                           returns the data or `null` on any error.  Must not
 *                           mutate state directly — the hook calls `setFn` and
 *                           broadcasts on success.
 * @param setFn              State setter called on EVERY tab (leader and followers)
 *                           whenever fresh data arrives (either from the server or
 *                           from a BroadcastChannel message).
 * @param onLeaderFetch      Optional callback invoked ONLY on the leader tab,
 *                           immediately after a successful fetch, before
 *                           broadcasting.  Use for side effects that must fire
 *                           exactly once per fetch cycle (e.g. toasts).
 * @param onBroadcastReceive Optional callback invoked on ANY tab (including
 *                           the leader) when a BroadcastChannel message is
 *                           received from another tab.  Because the browser
 *                           never delivers a channel message back to the tab
 *                           that sent it, this fires only on follower tabs in
 *                           practice.  Use for staleness-window tracking
 *                           (e.g. `isRecentBroadcast` in
 *                           `usePendingCountsSync`).
 * @param intervalMs         Leader polling cadence in ms (default 3000).
 * @param staleThresholdMs   How long a tab must have been hidden before it
 *                           attempts to steal leadership on restore
 *                           (default `intervalMs × 2`).
 */

import { useEffect, useRef } from 'react';

interface SyncMessage<T> {
  type: 'sync-update';
  data: T;
}

export function useCrossTabSync<T>(
  channelName: string,
  lockName: string,
  fetchFn: () => Promise<T | null>,
  setFn: (data: T) => void,
  onLeaderFetch?: (data: T) => void,
  onBroadcastReceive?: (data: T) => void,
  intervalMs = 3000,
  staleThresholdMs = intervalMs * 2,
): void {
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const setFnRef = useRef(setFn);
  setFnRef.current = setFn;

  const onLeaderFetchRef = useRef(onLeaderFetch);
  onLeaderFetchRef.current = onLeaderFetch;

  const onBroadcastReceiveRef = useRef(onBroadcastReceive);
  onBroadcastReceiveRef.current = onBroadcastReceive;

  const intervalMsRef = useRef(intervalMs);
  intervalMsRef.current = intervalMs;

  const staleThresholdMsRef = useRef(staleThresholdMs);
  staleThresholdMsRef.current = staleThresholdMs;

  const isLeaderRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(channelName);
      channelRef.current = channel;
      channel.onmessage = (event: MessageEvent<SyncMessage<T>>) => {
        if (event.data?.type === 'sync-update') {
          onBroadcastReceiveRef.current?.(event.data.data);
          setFnRef.current(event.data.data);
        }
      };
    }

    const broadcast = (data: T) => {
      channelRef.current?.postMessage({
        type: 'sync-update',
        data,
      } satisfies SyncMessage<T>);
    };

    const leaderPoll = async () => {
      const data = await fetchFnRef.current();
      if (data !== null) {
        onLeaderFetchRef.current?.(data);
        setFnRef.current(data);
        broadcast(data);
      }
    };

    const loadAndMaybeShare = async () => {
      const data = await fetchFnRef.current();
      if (data !== null) {
        setFnRef.current(data);
        if (isLeaderRef.current) broadcast(data);
      }
    };

    const useCoordination =
      typeof navigator !== 'undefined' &&
      'locks' in navigator &&
      typeof BroadcastChannel !== 'undefined';

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let lockReleaseResolve: (() => void) | null = null;

    const startLeaderInterval = () => {
      isLeaderRef.current = true;
      leaderPoll();
      intervalId = setInterval(() => leaderPoll(), intervalMsRef.current);
    };

    if (!useCoordination) {
      startLeaderInterval();
    } else {
      void navigator.locks.request(
        lockName,
        { mode: 'exclusive' },
        () =>
          new Promise<void>((resolve) => {
            lockReleaseResolve = resolve;
            startLeaderInterval();
          }),
      );
    }

    void loadAndMaybeShare();

    // Track when the tab goes hidden so we can detect long absences.
    let hiddenAt = 0;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }

      // Tab became visible — always do a safety fetch.
      void loadAndMaybeShare();

      // Leader tab: clear and restart the interval to eliminate timer drift
      // caused by browser throttling in background/hidden tabs.  The
      // loadAndMaybeShare() call above already serves as the "immediate"
      // fetch, so the new interval starts a fresh full cadence from now.
      if (isLeaderRef.current && intervalId !== null) {
        clearInterval(intervalId);
        intervalId = setInterval(() => leaderPoll(), intervalMsRef.current);
      }

      // Stale-on-restore: if the tab was hidden for longer than the threshold
      // and is currently a follower, steal the leader lock so data is
      // refreshed promptly without waiting for the (potentially drifted)
      // current leader to release.
      if (useCoordination && !isLeaderRef.current && hiddenAt > 0) {
        const elapsed = Date.now() - hiddenAt;
        if (elapsed > staleThresholdMsRef.current) {
          void navigator.locks.request(
            lockName,
            { mode: 'exclusive', steal: true },
            () =>
              new Promise<void>((resolve) => {
                // Clear any existing interval (should be none since we were a
                // follower, but guard for safety).
                if (intervalId !== null) clearInterval(intervalId);
                // Release our previous lock slot (no-op if null).
                lockReleaseResolve?.();
                lockReleaseResolve = resolve;
                startLeaderInterval();
                // Apply the same drift-elimination guarantee as the leader
                // tab's visibility-restore interval reset (Task #465).
                // startLeaderInterval() already set isLeaderRef and fired an
                // immediate leaderPoll(), but the interval's reference point
                // may be slightly off if the steal callback itself was delayed
                // by background throttling.  Clearing and restarting the
                // interval here anchors the next tick to exactly the steal
                // moment, matching the behaviour of the leader-restore path.
                if (intervalId !== null) clearInterval(intervalId);
                intervalId = setInterval(() => leaderPoll(), intervalMsRef.current);
              }),
          );
        }
      }

      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (intervalId !== null) clearInterval(intervalId);
      isLeaderRef.current = false;
      lockReleaseResolve?.();
      lockReleaseResolve = null;
      channelRef.current?.close();
      channelRef.current = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
