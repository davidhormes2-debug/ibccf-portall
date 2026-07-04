import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPortalToken } from '@/lib/portalSession';
import { playNotificationSound } from '@/hooks/useNotificationSound';

export interface Notification {
  id: number;
  recipientType: string;
  recipientId: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  metadata: string | null;
  createdAt: string;
}

interface UseNotificationsOptions {
  recipientType: 'admin' | 'user';
  recipientId?: string;
  pollingInterval?: number;
  soundEnabled?: boolean;
}

export function useNotifications({
  recipientType,
  recipientId,
  pollingInterval = 5000,
  soundEnabled = true
}: UseNotificationsOptions) {
  const queryClient = useQueryClient();
  const [hasNewNotification, setHasNewNotification] = useState(false);
  const prevCountRef = useRef<number>(0);

  const endpoint = recipientType === 'admin' 
    ? '/api/notifications/admin'
    : `/api/notifications/case/${recipientId}`;

  const unreadEndpoint = recipientType === 'admin'
    ? '/api/notifications/admin/unread'
    : null;

  const { data: notifications = [], isLoading, refetch } = useQuery<Notification[]>({
    queryKey: ['notifications', recipientType, recipientId],
    queryFn: async () => {
      if (recipientType === 'user' && !recipientId) return [];
      const headers: HeadersInit = {};
      if (recipientType === 'user') {
        const token = getPortalToken();
        if (token) headers['x-portal-session-token'] = token;
      }
      const res = await fetch(endpoint, { headers });
      if (!res.ok) throw new Error('Failed to fetch notifications');
      return res.json();
    },
    refetchInterval: pollingInterval,
    enabled: recipientType === 'admin' || !!recipientId,
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ['notifications-unread', recipientType],
    queryFn: async () => {
      if (!unreadEndpoint) {
        return { count: notifications.filter(n => !n.isRead).length };
      }
      const res = await fetch(unreadEndpoint);
      if (!res.ok) throw new Error('Failed to fetch unread count');
      return res.json();
    },
    refetchInterval: pollingInterval,
    enabled: recipientType === 'admin',
  });

  const unreadCount = recipientType === 'admin' 
    ? (unreadData?.count ?? 0)
    : notifications.filter(n => !n.isRead).length;

  useEffect(() => {
    if (unreadCount > prevCountRef.current) {
      setHasNewNotification(true);
      if (soundEnabled) {
        void playNotificationSound('alert');
      }
      if ('Notification' in window && Notification.permission === 'granted') {
        const latest = notifications.find(n => !n.isRead);
        if (latest) {
          new Notification(latest.title, {
            body: latest.body || undefined,
            icon: '/favicon.ico'
          });
        }
      }
      setTimeout(() => setHasNewNotification(false), 3000);
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount, notifications, soundEnabled]);

  const buildReadHeaders = (): HeadersInit => {
    if (recipientType === 'user') {
      const token = getPortalToken();
      if (token) return { 'x-portal-session-token': token };
    }
    return {};
  };

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      const res = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: buildReadHeaders(),
      });
      if (!res.ok) throw new Error('Failed to mark as read');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', recipientType, recipientId] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread', recipientType] });
    }
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const unreadNotifications = notifications.filter(n => !n.isRead);
      const headers = buildReadHeaders();
      await Promise.all(
        unreadNotifications.map(n => 
          fetch(`/api/notifications/${n.id}/read`, { method: 'POST', headers })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', recipientType, recipientId] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread', recipientType] });
    }
  });

  const requestNotificationPermission = useCallback(async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }, []);

  return {
    notifications,
    unreadCount,
    isLoading,
    hasNewNotification,
    markAsRead: markAsReadMutation.mutate,
    markAllAsRead: markAllAsReadMutation.mutate,
    refetch,
    requestNotificationPermission
  };
}
