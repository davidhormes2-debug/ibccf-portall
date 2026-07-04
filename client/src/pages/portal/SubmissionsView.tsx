import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, FolderOpen, FileText, RefreshCw } from "lucide-react";
import { usePortal } from "./PortalContext";
import { useFormat } from "@/i18n/format";
import { useToast } from "@/hooks/use-toast";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";

export function SubmissionsView() {
  const { t } = useTranslation("portal");
  const { submissions, refreshSubmissions } = usePortal();
  const { formatDateTime } = useFormat();
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshSubmissions();
    } catch {
      toast({
        variant: "destructive",
        title: t("submissions.refreshError.title", { defaultValue: "Refresh failed" }),
        description: t("submissions.refreshError.description", {
          defaultValue: "Could not reload your submissions. Please try again.",
        }),
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Page header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 flex items-center gap-2">
              <FolderOpen className="w-6 h-6 text-blue-400 shrink-0" />
              {t("submissions.title")}
            </h2>
            <p className="text-blue-300 text-sm">{t("submissions.subtitle")}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-white hover:bg-white/10 border border-white/10"
            data-testid="button-refresh-submissions"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? t("submissions.refreshing", { defaultValue: "Refreshing…" }) : t("submissions.refresh", { defaultValue: "Refresh" })}
          </Button>
        </div>
      </motion.div>

      {/* Records container */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <div className="rounded-2xl overflow-hidden glass-dark-premium card-depth">
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="gradient-icon w-10 h-10 bg-gradient-to-br from-slate-500 to-slate-700">
                <FolderOpen className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">{t("submissions.recordsTitle")}</h3>
                <p className="text-slate-400 text-xs">
                  {submissions.length === 1
                    ? t("submissions.recordSingular", { count: submissions.length })
                    : t("submissions.recordPlural", { count: submissions.length })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <Shield className="w-3 h-3" />
              <span className="uppercase tracking-wider">{t("submissions.encrypted")}</span>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {submissions.length === 0 ? (
              <PortalEmptyState
                icon={FileText}
                title={t("submissions.empty")}
                iconClassName="text-slate-500 opacity-40"
                data-testid="submissions-empty-state"
              />
            ) : (
              <div className="space-y-3">
                {submissions.map((s, idx) => (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.06 }}
                    className="p-4 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    data-testid={`submission-${s.id}`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <Badge
                        className={`text-xs ${s.selectedOption === "A" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-slate-500/20 text-slate-400 border border-slate-500/30"}`}
                      >
                        {t("submissions.optionSelected", { option: s.selectedOption })}
                      </Badge>
                      <span className="text-xs text-slate-500">{formatDateTime(s.submittedAt)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-slate-500 block text-xs mb-1">{t("submissions.withdrawalAmount")}</span>
                        <span className="text-emerald-400 font-semibold">{s.withdrawalAmount}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-xs mb-1">{t("submissions.totalBatches")}</span>
                        <span className="text-white">{s.withdrawalBatches}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
