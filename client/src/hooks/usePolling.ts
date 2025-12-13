import { useEffect, useRef, useCallback } from 'react';

interface UsePollingOptions<T> {
  fn: () => Promise<T>;
  interval: number;
  enabled?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

export function usePolling<T>({
  fn,
  interval,
  enabled = true,
  onSuccess,
  onError,
}: UsePollingOptions<T>) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const fnRef = useRef(fn);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    fnRef.current = fn;
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  });

  const poll = useCallback(async () => {
    try {
      const data = await fnRef.current();
      onSuccessRef.current?.(data);
    } catch (error) {
      onErrorRef.current?.(error as Error);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    poll();
    intervalRef.current = setInterval(poll, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, interval, poll]);

  return { poll };
}
