import { useState, useEffect, useCallback } from 'react';
import type { NotificationSoundType } from './useNotificationSound';

export type AdminNotificationEvent = 'visitor' | 'receipt' | 'alert' | 'message' | 'approval';

export interface NotificationPrefs {
  enabled: boolean;
  volume: number;
  tones: Record<AdminNotificationEvent, NotificationSoundType>;
}

const STORAGE_KEY = 'ibccf.adminNotificationPrefs';

export const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  volume: 0.8,
  tones: {
    visitor:  'visitor',
    receipt:  'receipt',
    alert:    'alert',
    message:  'message',
    approval: 'approval',
  },
};

export function getNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      enabled: parsed.enabled ?? DEFAULT_PREFS.enabled,
      volume:  typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULT_PREFS.volume,
      tones: {
        ...DEFAULT_PREFS.tones,
        ...(parsed.tones ?? {}),
      },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent('ibccf:notificationPrefsChanged'));
  } catch {
    // localStorage unavailable
  }
}

export function useNotificationPrefs() {
  const [prefs, setPrefsState] = useState<NotificationPrefs>(getNotificationPrefs);

  useEffect(() => {
    const handler = () => setPrefsState(getNotificationPrefs());
    window.addEventListener('ibccf:notificationPrefsChanged', handler);
    return () => window.removeEventListener('ibccf:notificationPrefsChanged', handler);
  }, []);

  const setPrefs = useCallback((next: NotificationPrefs) => {
    saveNotificationPrefs(next);
    setPrefsState(next);
  }, []);

  const resetPrefs = useCallback(() => {
    saveNotificationPrefs(DEFAULT_PREFS);
    setPrefsState(DEFAULT_PREFS);
  }, []);

  return { prefs, setPrefs, resetPrefs };
}
