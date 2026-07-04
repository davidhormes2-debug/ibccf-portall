import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Lock, Shield, AlertTriangle, Clock, CheckCircle, MessageCircle, RefreshCw
} from "lucide-react";
import { usePortal, AdminMessage } from "./PortalContext";
import { useFormat } from "@/i18n/format";
import { useToast } from "@/hooks/use-toast";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";

export function MessagesView() {
  const { t } = useTranslation("portal");
  const { adminMessages, markAdminMessageRead, refreshAdminMessages } = usePortal();
  const { formatDate, formatDateTime } = useFormat();
  const { toast } = useToast();
  const [selectedMessage, setSelectedMessage] = useState<AdminMessage | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const urgentMessages = adminMessages.filter(m => m.category === "urgent");
  const processingMessages = adminMessages.filter(m => m.category === "processing");
  const resolvedMessages = adminMessages.filter(m => m.category === "resolved");
  const unreadTotal = adminMessages.filter(m => !m.isRead).length;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshAdminMessages();
    } catch {
      toast({
        variant: "destructive",
        title: t("messages.refreshError.title", { defaultValue: "Refresh failed" }),
        description: t("messages.refreshError.description", {
          defaultValue: "Could not reload your messages. Please try again.",
        }),
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleMessageClick = (msg: AdminMessage) => {
    setSelectedMessage(msg);
    if (!msg.isRead) markAdminMessageRead(msg.id);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Page header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 flex items-center gap-2">
              <MessageCircle className="w-6 h-6 text-blue-400 shrink-0" />
              {t("messages.title")}
            </h2>
            <p className="text-blue-300 text-sm">{t("messages.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {unreadTotal > 0 && (
              <Badge className="bg-red-500/20 text-red-400 border border-red-500/30 text-xs animate-pulse">
                {t("messages.unreadBadge", { count: unreadTotal })}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="text-white hover:bg-white/10 border border-white/10"
              data-testid="button-refresh-messages"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? t("messages.refreshing", { defaultValue: "Refreshing…" }) : t("messages.refresh", { defaultValue: "Refresh" })}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Encryption notice */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 p-3.5 rounded-xl flex items-center gap-3 bg-blue-500/10 border border-blue-500/20"
      >
        <Shield className="w-5 h-5 text-blue-400 shrink-0" />
        <div>
          <p className="text-sm text-blue-200 font-medium">{t("messages.encryption.title")}</p>
          <p className="text-xs text-blue-400">{t("messages.encryption.subtitle")}</p>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-8">
        {[
          { label: t("messages.stats.actionRequired"), count: urgentMessages.length, Icon: AlertTriangle, bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-400", sub: "text-red-300/70" },
          { label: t("messages.stats.processing"), count: processingMessages.length, Icon: Clock, bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400", sub: "text-amber-300/70" },
          { label: t("messages.stats.completed"), count: resolvedMessages.length, Icon: CheckCircle, bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", sub: "text-emerald-300/70" },
        ].map(({ label, count, Icon, bg, border, text, sub }) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`p-3 sm:p-4 rounded-xl text-center ${bg} border ${border}`}
          >
            <Icon className={`w-5 h-5 mx-auto mb-1.5 ${text}`} />
            <p className={`text-2xl font-bold ${text}`}>{count}</p>
            <p className={`text-[10px] ${sub} uppercase tracking-wider`}>{label}</p>
          </motion.div>
        ))}
      </div>

      {/* Urgent messages */}
      {urgentMessages.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h2 className="text-base font-bold text-red-400 flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 animate-pulse" />{t("messages.sections.urgent")}
          </h2>
          <div className="space-y-3">
            {urgentMessages.map((msg, idx) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.08 }}
                onClick={() => handleMessageClick(msg)}
                className={`p-4 rounded-xl cursor-pointer transition-all hover:-translate-y-0.5 glass-dark border ${msg.isRead ? "border-red-500/20 bg-red-500/5" : "border-red-500/40 bg-red-500/10"}`}
                data-testid={`message-urgent-${msg.id}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-red-300 font-semibold text-sm">
                    {!msg.isRead && <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />}
                    <Lock className="w-4 h-4 shrink-0" />
                    {msg.title}
                  </div>
                  <span className="text-xs text-red-400/60">{formatDate(msg.createdAt)}</span>
                </div>
                <p className="text-sm text-slate-400 line-clamp-2">{msg.body}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Processing messages */}
      {processingMessages.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-8">
          <h2 className="text-base font-bold text-amber-400 flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4" />{t("messages.sections.processing")}
          </h2>
          <div className="space-y-3">
            {processingMessages.map((msg, idx) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.08 }}
                onClick={() => handleMessageClick(msg)}
                className={`p-4 rounded-xl cursor-pointer transition-all hover:-translate-y-0.5 glass-dark border ${msg.isRead ? "border-amber-500/20 bg-amber-500/5" : "border-amber-500/40 bg-amber-500/10"}`}
                data-testid={`message-processing-${msg.id}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
                    {!msg.isRead && <div className="w-2 h-2 bg-amber-500 rounded-full shrink-0" />}
                    <Lock className="w-4 h-4 shrink-0" />
                    {msg.title}
                  </div>
                  <span className="text-xs text-amber-400/60">{formatDate(msg.createdAt)}</span>
                </div>
                <p className="text-sm text-slate-400 line-clamp-2">{msg.body}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Resolved messages */}
      {resolvedMessages.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mb-8">
          <h2 className="text-base font-bold text-emerald-400 flex items-center gap-2 mb-4">
            <CheckCircle className="w-4 h-4" />{t("messages.sections.completed")}
          </h2>
          <div className="space-y-3">
            {resolvedMessages.map((msg, idx) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.08 }}
                onClick={() => handleMessageClick(msg)}
                className="p-4 rounded-xl cursor-pointer transition-all hover:-translate-y-0.5 glass-dark border border-emerald-500/20 bg-emerald-500/5"
                data-testid={`message-resolved-${msg.id}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
                    <Lock className="w-4 h-4 shrink-0" />
                    {msg.title}
                  </div>
                  <span className="text-xs text-emerald-400/60">{formatDate(msg.createdAt)}</span>
                </div>
                <p className="text-sm text-slate-400 line-clamp-2">{msg.body}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Empty state */}
      {adminMessages.length === 0 && (
        <PortalEmptyState
          icon={Lock}
          title={t("messages.empty.title")}
          description={t("messages.empty.subtitle")}
          hint={t("messages.empty.hint")}
          iconClassName="text-slate-600"
          data-testid="messages-empty-state"
        />
      )}

      {/* Message detail dialog */}
      <Dialog open={!!selectedMessage} onOpenChange={() => setSelectedMessage(null)}>
        <DialogContent className="max-w-lg" style={{ background: "rgba(15,23,42,0.98)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(20px)" }}>
          <DialogHeader>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
              <Shield className="w-3 h-3" />
              <span>{t("messages.dialog.encryptedLabel")}</span>
            </div>
            <DialogTitle className="flex items-center gap-2 text-white">
              {selectedMessage?.category === "urgent" && <AlertTriangle className="w-5 h-5 text-red-400" />}
              {selectedMessage?.category === "processing" && <Clock className="w-5 h-5 text-amber-400" />}
              {selectedMessage?.category === "resolved" && <CheckCircle className="w-5 h-5 text-emerald-400" />}
              {selectedMessage?.title}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {selectedMessage && formatDateTime(selectedMessage.createdAt)}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 px-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-slate-300 whitespace-pre-line leading-relaxed text-sm">{selectedMessage?.body}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedMessage(null)} className="border-slate-700 text-slate-300 hover:bg-slate-800">{t("messages.dialog.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
