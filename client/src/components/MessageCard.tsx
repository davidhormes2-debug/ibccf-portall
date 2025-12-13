import { motion } from "framer-motion";
import { format } from "date-fns";
import { AlertTriangle, Clock, CheckCircle, ChevronRight, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type MessageCategory = 'urgent' | 'processing' | 'resolved';

export interface AdminMessageData {
  id: number;
  caseId: string;
  category: MessageCategory;
  title: string;
  body: string;
  sender?: string;
  isRead?: boolean;
  createdAt?: Date | string;
}

interface MessageCardProps {
  message: AdminMessageData;
  onMarkRead?: (id: number) => void;
  onView?: (message: AdminMessageData) => void;
  showReadToggle?: boolean;
  variant?: 'compact' | 'full';
}

const categoryConfig = {
  urgent: {
    icon: AlertTriangle,
    bgClass: 'bg-gradient-to-r from-red-50 to-orange-50',
    borderClass: 'border-red-200',
    iconBgClass: 'bg-red-500',
    titleClass: 'text-red-800',
    bodyClass: 'text-red-700',
    badgeVariant: 'destructive' as const,
    label: 'Urgent Action Required',
  },
  processing: {
    icon: Clock,
    bgClass: 'bg-gradient-to-r from-amber-50 to-yellow-50',
    borderClass: 'border-amber-200',
    iconBgClass: 'bg-amber-500',
    titleClass: 'text-amber-800',
    bodyClass: 'text-amber-700',
    badgeVariant: 'secondary' as const,
    label: 'Processing',
  },
  resolved: {
    icon: CheckCircle,
    bgClass: 'bg-gradient-to-r from-green-50 to-emerald-50',
    borderClass: 'border-green-200',
    iconBgClass: 'bg-green-500',
    titleClass: 'text-green-800',
    bodyClass: 'text-green-700',
    badgeVariant: 'default' as const,
    label: 'Resolved',
  },
};

export function MessageCard({
  message,
  onMarkRead,
  onView,
  showReadToggle = true,
  variant = 'full',
}: MessageCardProps) {
  const config = categoryConfig[message.category];
  const Icon = config.icon;
  const isUnread = message.isRead === false;

  const formattedDate = message.createdAt
    ? format(new Date(message.createdAt), 'MMM dd, yyyy HH:mm')
    : '';

  if (variant === 'compact') {
    return (
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className={`p-3 rounded-lg border ${config.borderClass} ${config.bgClass} ${isUnread ? 'ring-2 ring-offset-1 ring-blue-400' : ''}`}
        data-testid={`message-card-${message.id}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={`w-8 h-8 ${config.iconBgClass} rounded-full flex items-center justify-center flex-shrink-0`}>
              <Icon className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className={`font-semibold ${config.titleClass} text-sm truncate`}>{message.title}</h4>
              {formattedDate && (
                <p className="text-xs text-slate-500">{formattedDate}</p>
              )}
            </div>
          </div>
          {onView && (
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => onView(message)}
              data-testid={`view-message-${message.id}`}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid={`message-card-${message.id}`}
    >
      <Card className={`${config.borderClass} border-2 shadow-md overflow-hidden ${isUnread ? 'ring-2 ring-offset-2 ring-blue-400' : ''}`}>
        <CardHeader className={`${config.bgClass} py-3`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 ${config.iconBgClass} rounded-full flex items-center justify-center`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className={`${config.titleClass} text-base`}>{message.title}</CardTitle>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant={config.badgeVariant} className="text-xs">
                    {config.label}
                  </Badge>
                  {formattedDate && (
                    <span className="text-xs text-slate-500">{formattedDate}</span>
                  )}
                </div>
              </div>
            </div>
            {showReadToggle && onMarkRead && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onMarkRead(message.id)}
                className="flex items-center gap-1"
                data-testid={`mark-read-${message.id}`}
              >
                {isUnread ? (
                  <>
                    <Eye className="w-4 h-4" />
                    <span className="text-xs">Mark Read</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-4 h-4" />
                    <span className="text-xs">Read</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="py-4">
          <p className={`${config.bodyClass} text-sm whitespace-pre-wrap`}>{message.body}</p>
          {message.sender && (
            <p className="text-xs text-slate-500 mt-3">From: {message.sender}</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface MessageListProps {
  messages: AdminMessageData[];
  category?: MessageCategory;
  title?: string;
  emptyMessage?: string;
  onMarkRead?: (id: number) => void;
  onView?: (message: AdminMessageData) => void;
  variant?: 'compact' | 'full';
  showBlink?: boolean;
}

export function MessageList({
  messages,
  category,
  title,
  emptyMessage = 'No messages',
  onMarkRead,
  onView,
  variant = 'full',
  showBlink = false,
}: MessageListProps) {
  const filteredMessages = category 
    ? messages.filter(m => m.category === category)
    : messages;
  
  const hasUnread = filteredMessages.some(m => m.isRead === false);
  const config = category ? categoryConfig[category] : null;

  if (filteredMessages.length === 0) {
    return (
      <div className="text-center py-6 text-slate-500" data-testid="empty-message-list">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {title && (
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          {showBlink && hasUnread && config && (
            <span className={`w-2.5 h-2.5 ${config.iconBgClass} rounded-full animate-pulse`} />
          )}
          <Badge variant="outline" className="ml-auto">
            {filteredMessages.length}
          </Badge>
        </div>
      )}
      {filteredMessages.map(message => (
        <MessageCard
          key={message.id}
          message={message}
          onMarkRead={onMarkRead}
          onView={onView}
          variant={variant}
        />
      ))}
    </div>
  );
}

export default MessageCard;
