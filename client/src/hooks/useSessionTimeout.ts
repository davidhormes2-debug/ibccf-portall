import { useEffect, useRef, useCallback } from 'react';
import { APP_CONFIG } from '@shared/constants';

interface UseSessionTimeoutOptions {
  timeout?: number;
  onTimeout: () => void;
  enabled?: boolean;
}

export function useSessionTimeout({
  timeout = APP_CONFIG.sessionTimeout,
  onTimeout,
  enabled = true,
}: UseSessionTimeoutOptions) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    if (enabled) {
      timeoutRef.current = setTimeout(onTimeout, timeout);
    }
  }, [timeout, onTimeout, enabled]);

  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      return;
    }

    const events = ['mousemove', 'keypress', 'click', 'scroll', 'touchstart'];
    
    events.forEach((event) => {
      window.addEventListener(event, resetTimeout);
    });

    resetTimeout();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, resetTimeout);
      });
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, resetTimeout]);

  return { resetTimeout };
}
