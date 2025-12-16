import { useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';

const HEARTBEAT_INTERVAL = 10000; // 10 seconds
const IDLE_TIMEOUT = 60000; // 1 minute for idle detection

interface VisitorTrackingOptions {
  caseId?: number | string;
  enabled?: boolean;
}

export function useVisitorTracking({ caseId, enabled = true }: VisitorTrackingOptions = {}) {
  const [location] = useLocation();
  const visitorIdRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pagesViewedRef = useRef<string[]>([]);

  const getDeviceInfo = useCallback(() => {
    const userAgent = navigator.userAgent;
    let deviceType = 'desktop';
    if (/mobile/i.test(userAgent)) {
      deviceType = 'mobile';
    } else if (/tablet|ipad/i.test(userAgent)) {
      deviceType = 'tablet';
    }

    let browser = 'unknown';
    if (/chrome/i.test(userAgent) && !/edg/i.test(userAgent)) {
      browser = 'Chrome';
    } else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) {
      browser = 'Safari';
    } else if (/firefox/i.test(userAgent)) {
      browser = 'Firefox';
    } else if (/edg/i.test(userAgent)) {
      browser = 'Edge';
    } else if (/opera|opr/i.test(userAgent)) {
      browser = 'Opera';
    }

    let os = 'unknown';
    if (/windows/i.test(userAgent)) {
      os = 'Windows';
    } else if (/macintosh|mac os/i.test(userAgent)) {
      os = 'macOS';
    } else if (/linux/i.test(userAgent)) {
      os = 'Linux';
    } else if (/android/i.test(userAgent)) {
      os = 'Android';
    } else if (/iphone|ipad|ipod/i.test(userAgent)) {
      os = 'iOS';
    }

    return {
      deviceType,
      browser,
      os,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      language: navigator.language,
      referrer: document.referrer || undefined,
    };
  }, []);

  const getVisitorId = useCallback(() => {
    if (visitorIdRef.current) return visitorIdRef.current;
    
    let storedId = localStorage.getItem('ibccf_visitor_id');
    if (!storedId) {
      storedId = `v_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('ibccf_visitor_id', storedId);
    }
    visitorIdRef.current = storedId;
    return storedId;
  }, []);

  const sendHeartbeat = useCallback(async () => {
    if (!enabled) return;

    const visitorId = getVisitorId();
    const deviceInfo = getDeviceInfo();
    const isIdle = Date.now() - lastActivityRef.current > IDLE_TIMEOUT;

    if (!pagesViewedRef.current.includes(location)) {
      pagesViewedRef.current.push(location);
    }

    try {
      await fetch('/api/visitors/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId,
          currentPage: location,
          caseId,
          isIdle,
          pagesViewed: pagesViewedRef.current,
          ...deviceInfo,
        }),
      });
    } catch (error) {
      // Silent fail - don't interrupt user experience
    }
  }, [enabled, getVisitorId, getDeviceInfo, location, caseId]);

  const endSession = useCallback(async () => {
    const visitorId = getVisitorId();
    try {
      await fetch('/api/visitors/end-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId }),
      });
    } catch (error) {
      // Silent fail
    }
  }, [getVisitorId]);

  const updateActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Send initial heartbeat
    sendHeartbeat();

    // Set up interval for regular heartbeats
    heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    // Track user activity
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
    events.forEach(event => {
      window.addEventListener(event, updateActivity, { passive: true });
    });

    // Handle page visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden, update idle status
      } else {
        // Page is visible again, send heartbeat
        sendHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Handle page unload
    const handleUnload = () => {
      // Use sendBeacon for reliable delivery on page close
      const visitorId = getVisitorId();
      navigator.sendBeacon('/api/visitors/end-session', JSON.stringify({ visitorId }));
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      events.forEach(event => {
        window.removeEventListener(event, updateActivity);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleUnload);
      endSession();
    };
  }, [enabled, sendHeartbeat, updateActivity, endSession, getVisitorId]);

  // Track page changes
  useEffect(() => {
    if (!enabled) return;
    sendHeartbeat();
  }, [location, enabled, sendHeartbeat]);

  return {
    visitorId: getVisitorId(),
    endSession,
  };
}

export default useVisitorTracking;
