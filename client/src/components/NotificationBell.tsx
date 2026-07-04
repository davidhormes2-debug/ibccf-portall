import { useState, useRef, useEffect } from 'react';
import { Bell, CheckCheck, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { useFormat } from '@/i18n/format';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'wouter';

interface NotificationBellProps {
  recipientType: 'admin' | 'user';
  recipientId?: string;
  className?: string;
}

function getSoundLabel(type: string): { emoji: string; label: string; color: string } {
  switch (type) {
    case 'new_visitor':
    case 'visitor_arrived':
      return { emoji: '🚪', label: 'Doorbell — new visitor', color: 'text-amber-500 dark:text-amber-400' };
    case 'deposit_receipt':
    case 'receipt_uploaded':
    case 'deposit_status':
    case 'receipt_pending':
      return { emoji: '🧾', label: 'Urgent alert — receipt uploaded', color: 'text-orange-500 dark:text-orange-400' };
    case 'new_message':
    case 'chat_message':
      return { emoji: '💬', label: 'Message chime', color: 'text-green-600 dark:text-green-400' };
    case 'approval':
    case 'case_approved':
    case 'stamp_duty_approved':
    case 'document_approved':
      return { emoji: '🎉', label: 'Approval fanfare', color: 'text-emerald-600 dark:text-emerald-400' };
    case 'rejection':
    case 'document_rejected':
    case 'stamp_duty_rejected':
      return { emoji: '❌', label: 'Error tone', color: 'text-red-600 dark:text-red-400' };
    case 'new_submission':
      return { emoji: '📥', label: 'Alert — new submission', color: 'text-blue-600 dark:text-blue-400' };
    case 'access_request':
      return { emoji: '🔑', label: 'Alert — access key request', color: 'text-purple-600 dark:text-purple-400' };
    case 'required_action':
      return { emoji: '⚠️', label: 'Alert — action required', color: 'text-yellow-600 dark:text-yellow-400' };
    case 'case_update':
    case 'new_case':
    case 'case_registered':
      return { emoji: '📋', label: 'Alert — case update', color: 'text-blue-600 dark:text-blue-400' };
    case 'withdrawal_request':
      return { emoji: '💰', label: 'Alert — withdrawal request', color: 'text-cyan-600 dark:text-cyan-400' };
    case 'user_document_uploaded':
    case 'document_uploaded':
      return { emoji: '📄', label: 'Alert — document uploaded', color: 'text-blue-600 dark:text-blue-400' };
    default:
      return { emoji: '🔔', label: 'Alert', color: 'text-slate-500 dark:text-slate-400' };
  }
}

export function NotificationBell({ recipientType, recipientId, className = '' }: NotificationBellProps) {
  const { t } = useTranslation('portal');
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  
  const {
    notifications,
    unreadCount,
    hasNewNotification,
    markAsRead,
    markAllAsRead,
    requestNotificationPermission
  } = useNotifications({
    recipientType,
    recipientId,
    pollingInterval: 5000,
    soundEnabled: true
  });

  useEffect(() => {
    requestNotificationPermission();
  }, [requestNotificationPermission]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getNotificationColor = (type: string, isRead: boolean) => {
    if (isRead) return 'bg-slate-50 dark:bg-slate-800/50';
    switch (type) {
      case 'required_action':
        return 'bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500';
      case 'case_update':
        return 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500';
      case 'new_message':
        return 'bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500';
      case 'approval':
      case 'document_approved':
        return 'bg-emerald-50 dark:bg-emerald-900/20 border-l-4 border-emerald-500';
      case 'rejection':
      case 'document_rejected':
        return 'bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500';
      default:
        return 'bg-white dark:bg-slate-800 border-l-4 border-[#004182]';
    }
  };

  return (
    <div className={`relative ${className}`} ref={panelRef}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className="relative"
        data-testid="button-notification-bell"
      >
        <Bell className={`h-5 w-5 ${hasNewNotification ? 'animate-bounce' : ''}`} />
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center"
              data-testid="notification-badge"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden z-50 flex flex-col"
            style={{ maxHeight: 'min(32rem, calc(100vh - 6rem))' }}
            data-testid="notification-panel"
          >
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-gradient-to-r from-[#004182] to-[#004AB3] flex-shrink-0">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-white" />
                <h3 className="font-semibold text-white">{t('notificationBell.title')}</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 bg-white/20 text-white text-xs rounded-full">
                    {t('notificationBell.newCount', { count: unreadCount })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markAllAsRead()}
                    className="text-white/80 hover:text-white hover:bg-white/10 text-xs"
                    data-testid="button-mark-all-read"
                  >
                    <CheckCheck className="h-4 w-4 mr-1" />
                    {t('notificationBell.markAllRead')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(false)}
                  className="text-white/80 hover:text-white hover:bg-white/10 h-8 w-8"
                  aria-label={t('notificationBell.close')}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                  <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">{t('notificationBell.empty')}</p>
                  <p className="text-sm mt-1">{t('notificationBell.emptyHint')}</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {notifications.map((notification: Notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={() => markAsRead(notification.id)}
                      getColor={getNotificationColor}
                      getSoundLabel={getSoundLabel}
                    />
                  ))}
                </div>
              )}
            </div>

            {notifications.length > 0 && (
              <div className="p-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex-shrink-0">
                <p className="text-xs text-center text-slate-500 dark:text-slate-400">
                  {t('notificationBell.showingLatest', { count: notifications.length })}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: () => void;
  getColor: (type: string, isRead: boolean) => string;
  getSoundLabel: (type: string) => { emoji: string; label: string; color: string };
}

function NotificationItem({ notification, onMarkAsRead, getColor, getSoundLabel }: NotificationItemProps) {
  const { formatRelative } = useFormat();
  const sound = getSoundLabel(notification.type);

  const content = (
    <div
      className={`p-4 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer ${getColor(notification.type, notification.isRead)}`}
      onClick={() => {
        if (!notification.isRead) {
          onMarkAsRead();
        }
      }}
      data-testid={`notification-item-${notification.id}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0">{sound.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`font-medium text-sm truncate ${notification.isRead ? 'text-slate-600 dark:text-slate-400' : 'text-slate-900 dark:text-white'}`}>
              {notification.title}
            </p>
            {!notification.isRead && (
              <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
            )}
          </div>
          {notification.body && (
            <p className={`text-sm mt-1 line-clamp-2 ${notification.isRead ? 'text-slate-500 dark:text-slate-500' : 'text-slate-600 dark:text-slate-300'}`}>
              {notification.body}
            </p>
          )}
          <p className={`text-xs mt-1.5 font-medium ${sound.color}`}>
            {sound.label}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {formatRelative(notification.createdAt)}
          </p>
        </div>
        {notification.link && (
          <ExternalLink className="h-4 w-4 text-slate-400 flex-shrink-0" />
        )}
      </div>
    </div>
  );

  if (notification.link) {
    return (
      <Link href={notification.link}>
        {content}
      </Link>
    );
  }

  return content;
}
