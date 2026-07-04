import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ArrowUpRight, ArrowDownLeft, Shield } from "lucide-react";
import { useFormat } from "@/i18n/format";
import { getPortalToken } from "@/lib/portalSession";
import { PortalSkeleton } from "@/components/portal/PortalSkeleton";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";

interface PortalLedgerEntry {
  id: number;
  direction: "credit" | "debit";
  amount: string;
  asset: string;
  category: string | null;
  entryDate: string;
  userNote: string | null;
  createdAt: string;
}

interface Props {
  caseId: string;
}

export function AccountHistoryCard({ caseId }: Props) {
  const { t } = useTranslation("portal");
  const { formatDateTime } = useFormat();

  const { data, isLoading, isError } = useQuery<PortalLedgerEntry[]>({
    queryKey: ["case-ledger", caseId],
    enabled: Boolean(caseId),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const portalToken = getPortalToken();
      const res = await fetch(`/api/cases/${caseId}/ledger`, {
        headers: portalToken ? { "x-portal-session-token": portalToken } : {},
      });
      if (!res.ok) throw new Error("Failed to load ledger");
      return (await res.json()) as PortalLedgerEntry[];
    },
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8 rounded-2xl overflow-hidden glass-dark-premium card-depth"
      data-testid="card-account-history"
    >
      <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="gradient-icon w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-white text-sm">
              {t("accountHistory.title")}
            </h3>
            <p className="text-slate-400 text-xs">
              {(data?.length ?? 0) === 1
                ? t("accountHistory.entrySingular", { count: 1 })
                : t("accountHistory.entryPlural", { count: data?.length ?? 0 })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <Shield className="w-3 h-3" />
          <span className="uppercase tracking-wider">
            {t("accountHistory.displayOnly")}
          </span>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {isLoading ? (
          <PortalSkeleton variant="list" count={3} />
        ) : isError ? (
          <div className="text-center py-8 text-rose-300 text-sm">
            {t("accountHistory.loadError")}
          </div>
        ) : (data?.length ?? 0) === 0 ? (
          <PortalEmptyState
            icon={BookOpen}
            title={t("accountHistory.empty")}
            data-testid="account-history-empty"
          />
        ) : (
          <div className="space-y-3">
            {data!.map((e) => (
              <div
                key={e.id}
                className="p-3 sm:p-4 rounded-xl flex items-start gap-3"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                data-testid={`account-history-entry-${e.id}`}
              >
                <div className="mt-0.5">
                  {e.direction === "credit" ? (
                    <ArrowUpRight className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <ArrowDownLeft className="h-5 w-5 text-rose-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`font-mono text-base font-semibold ${
                        e.direction === "credit"
                          ? "text-emerald-300"
                          : "text-rose-300"
                      }`}
                    >
                      {e.direction === "credit" ? "+" : "−"}
                      {e.amount} {e.asset}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        e.direction === "credit"
                          ? "border-emerald-500/40 text-emerald-300"
                          : "border-rose-500/40 text-rose-300"
                      }`}
                    >
                      {e.direction === "credit"
                        ? t("accountHistory.credit")
                        : t("accountHistory.debit")}
                    </Badge>
                    {e.category && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-slate-700 text-slate-300"
                      >
                        {e.category}
                      </Badge>
                    )}
                  </div>
                  {e.userNote && (
                    <p className="text-sm text-slate-200 mt-1.5">{e.userNote}</p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    {formatDateTime(new Date(e.entryDate))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 sm:px-5 py-3 border-t border-white/10 text-[11px] text-slate-500">
        {t("accountHistory.disclaimer")}
      </div>
    </motion.div>
  );
}
