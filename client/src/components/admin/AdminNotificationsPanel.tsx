import { useState } from "react";
import { Bell, X, ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Notification } from "@/components/admin/shared";

// Cap the initially visible notifications so the panel fits comfortably on
// screen without requiring the admin to scroll past a wall of items on first
// open. When more notifications exist, a "show all" affordance is rendered
// below the list so older entries are never silently hidden.
const VISIBLE_LIMIT = 10;

interface AdminNotificationsPanelProps {
  notifications: Notification[];
  onClose: () => void;
  onMarkRead: (id: number) => void;
  onClearAll?: () => void;
  title: string;
  emptyLabel: string;
}

function getSoundLabel(type: string): { emoji: string; label: string; color: string } {
  switch (type) {
    case 'new_visitor':
    case 'visitor_arrived':
      return { emoji: '🚪', label: 'Doorbell — new visitor', color: 'text-amber-400' };
    case 'deposit_receipt':
    case 'receipt_uploaded':
    case 'deposit_status':
    case 'receipt_pending':
      return { emoji: '🧾', label: 'Urgent alert — receipt uploaded', color: 'text-orange-400' };
    case 'new_message':
    case 'chat_message':
      return { emoji: '💬', label: 'Message chime', color: 'text-green-400' };
    case 'approval':
    case 'case_approved':
    case 'stamp_duty_approved':
    case 'document_approved':
      return { emoji: '🎉', label: 'Approval fanfare', color: 'text-emerald-400' };
    case 'rejection':
    case 'document_rejected':
    case 'stamp_duty_rejected':
      return { emoji: '❌', label: 'Error tone', color: 'text-red-400' };
    case 'new_submission':
      return { emoji: '📥', label: 'Alert — new submission', color: 'text-blue-400' };
    case 'access_request':
      return { emoji: '🔑', label: 'Alert — access key request', color: 'text-purple-400' };
    case 'required_action':
      return { emoji: '⚠️', label: 'Alert — action required', color: 'text-yellow-400' };
    case 'case_update':
    case 'new_case':
    case 'case_registered':
      return { emoji: '📋', label: 'Alert — case update', color: 'text-blue-400' };
    case 'withdrawal_request':
      return { emoji: '💰', label: 'Alert — withdrawal request', color: 'text-cyan-400' };
    case 'user_document_uploaded':
    case 'document_uploaded':
      return { emoji: '📄', label: 'Alert — document uploaded', color: 'text-blue-400' };
    case 'nda_integrity_alert':
      return { emoji: '🛡️', label: 'Alert — integrity warning', color: 'text-red-400' };
    default:
      return { emoji: '🔔', label: 'Alert', color: 'text-slate-400' };
  }
}

export function AdminNotificationsPanel({
  notifications,
  onClose,
  onMarkRead,
  onClearAll,
  title,
  emptyLabel,
}: AdminNotificationsPanelProps) {
  const [showAll, setShowAll] = useState(false);

  const visibleNotifications = showAll ? notifications : notifications.slice(0, VISIBLE_LIMIT);
  const hiddenCount = notifications.length - VISIBLE_LIMIT;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="p-3 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
        <h3 className="text-white font-medium">{title}</h3>
        <div className="flex items-center gap-1">
          {onClearAll && notifications.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearAll}
              className="text-slate-400 hover:text-red-400 h-6 px-2 text-xs gap-1"
              data-testid="button-notifications-clear-all"
            >
              <Trash2 className="h-3 w-3" />
              Clear all
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400 h-6 w-6 p-0" data-testid="button-notifications-close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="p-6 text-center text-slate-500">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{emptyLabel}</p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {visibleNotifications.map((notification) => {
              const sound = getSoundLabel(notification.type);
              return (
                <div
                  key={notification.id}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${notification.isRead ? 'bg-slate-900/50' : 'bg-blue-900/20 border border-blue-800/50'}`}
                  onClick={() => onMarkRead(notification.id)}
                >
                  <div className="flex items-start gap-2">
                    <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${notification.isRead ? 'bg-slate-600' : 'bg-blue-500'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{notification.title}</p>
                      {notification.body && (
                        <p className="text-slate-400 text-xs mt-1">{notification.body}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-xs font-medium ${sound.color}`}>
                          {sound.emoji} {sound.label}
                        </span>
                      </div>
                      <p className="text-slate-500 text-xs mt-1">
                        {new Date(notification.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            {!showAll && hiddenCount > 0 && (
              <button
                data-testid="button-notifications-show-all"
                onClick={() => setShowAll(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-slate-400 hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-800/50"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Show all {notifications.length} notifications
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
