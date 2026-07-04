import { useEffect } from 'react';

/**
 * Polls `loadUserDocPendingCounts` every `intervalMs` milliseconds and also
 * re-fetches immediately whenever the browser tab becomes visible again.
 *
 * Extracted from AdminDashboard.tsx so it can be tested in isolation without
 * mounting the full dashboard.
 */
export function usePendingCountsPolling(
  loadUserDocPendingCounts: () => void,
  intervalMs = 3000,
) {
  useEffect(() => {
    loadUserDocPendingCounts();

    const intervalId = setInterval(loadUserDocPendingCounts, intervalMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadUserDocPendingCounts();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadUserDocPendingCounts, intervalMs]);
}
