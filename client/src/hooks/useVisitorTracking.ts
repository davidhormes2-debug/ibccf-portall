import { useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { storeSatToken } from '@/lib/satisfactionToken';

const HEARTBEAT_INTERVAL = 20000; // 20 seconds
const IDLE_TIMEOUT = 60000; // 1 minute for idle detection

interface VisitorTrackingOptions {
  caseId?: number | string;
  enabled?: boolean;
}

// Cheap, dependency-free djb2 hash. Used to derive a stable
// fingerprintHash from environment fingerprint inputs (UA + screen
// + lang + tz + colorDepth). Same input → same hex digest, no
// cryptographic claims, just a compact identifier.
function djb2Hex(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    // (hash * 33) XOR char — classic djb2
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  // unsigned 32-bit hex
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function useVisitorTracking({ caseId, enabled = true }: VisitorTrackingOptions = {}) {
  const [location] = useLocation();
  const visitorIdRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pagesViewedRef = useRef<string[]>([]);

  // Build a forensic snapshot of the device + environment. Most fields
  // come from `navigator`/`window.screen`/`Intl`. The fingerprintHash
  // is a djb2 of the concatenated stable fields so the same browser on
  // the same device produces the same digest across visits.
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

    let timezone: string | undefined;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      timezone = undefined;
    }

    // navigator.connection is an experimental, unprefixed Network
    // Information API. Available in Chromium-based browsers; gracefully
    // omitted on Safari/Firefox.
    const conn = (navigator as unknown as {
      connection?: { effectiveType?: string };
    }).connection;
    const connectionType = conn?.effectiveType;

    const screenWidth = window.screen?.width ?? 0;
    const screenHeight = window.screen?.height ?? 0;
    const colorDepth = window.screen?.colorDepth ?? 0;
    const language = navigator.language ?? 'unknown';

    const fingerprintHash = djb2Hex(
      [userAgent, `${screenWidth}x${screenHeight}`, language, timezone ?? '', String(colorDepth)].join('|'),
    );

    return {
      deviceType,
      browser,
      os,
      screenWidth,
      screenHeight,
      screenResolution: `${screenWidth}x${screenHeight}`,
      language,
      timezone,
      connectionType,
      fingerprintHash,
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
          pageTitle: typeof document !== 'undefined' ? document.title : undefined,
          caseId,
          isIdle,
          pagesViewed: pagesViewedRef.current,
          ...deviceInfo,
        }),
      });
    } catch (_e) {
      // Silent fail - don't interrupt user experience
    }
  }, [enabled, getVisitorId, getDeviceInfo, location, caseId]);

  const endSession = useCallback(async () => {
    const visitorId = getVisitorId();
    try {
      const res = await fetch('/api/visitors/end-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId }),
      });
      // The server issues a short-lived signed `satToken` when the visitor
      // had a chat, so the satisfaction-rating submission can skip its DB
      // read. Stash it for the chat widget to pick up when it posts the
      // rating (see client/src/lib/satisfactionToken.ts).
      if (res.ok && caseId != null) {
        const data = await res.json().catch(() => null);
        if (data?.satToken) {
          storeSatToken(visitorId, String(caseId), data.satToken);
        }
      }
    } catch (_e) {
      // Silent fail
    }
  }, [getVisitorId, caseId]);

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
