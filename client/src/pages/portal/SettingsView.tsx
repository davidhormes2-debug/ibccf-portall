import { useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { User, Wallet, Mail, Phone, Shield, Calculator, Sparkles } from "lucide-react";
import { usePortal } from "./PortalContext";
import { useFormat } from "@/i18n/format";

function parseUsdtAmount(raw?: string | null): number {
  if (!raw) return 0;
  const match = String(raw).match(/[\d,.]+/);
  if (!match) return 0;
  const n = parseFloat(match[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function SettingsView() {
  const { t } = useTranslation("portal");
  const { currentCase } = usePortal();
  const { formatNumber } = useFormat();
  const formatUsdt = (n: number) =>
    formatNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  const balance = useMemo(() => {
    const activity = parseUsdtAmount(currentCase?.activityDepositAmount);
    const phraseKey = parseUsdtAmount(currentCase?.phraseKeyDepositAmount);
    const merge = parseUsdtAmount(currentCase?.phraseKeyMergeDeposit);
    const wallet = parseUsdtAmount(currentCase?.activityWalletRequirement);
    const withdrawal = parseUsdtAmount(currentCase?.withdrawalAmount);
    const compiledDeposit = activity + phraseKey + merge;
    return { activity, phraseKey, merge, wallet, withdrawal, compiledDeposit };
  }, [currentCase]);

  const rows: { label: string; value: number; tone: string; helper: string }[] = [
    {
      label: t("settings.balance.activityLabel"),
      value: balance.activity,
      tone: "from-emerald-500/15 to-emerald-500/5 border-emerald-500/30 text-emerald-200",
      helper: t("settings.balance.activityHelper"),
    },
    {
      label: t("settings.balance.phraseKeyLabel"),
      value: balance.phraseKey,
      tone: "from-blue-500/15 to-blue-500/5 border-blue-500/30 text-blue-200",
      helper: t("settings.balance.phraseKeyHelper"),
    },
    {
      label: t("settings.balance.mergeLabel"),
      value: balance.merge,
      tone: "from-purple-500/15 to-purple-500/5 border-purple-500/30 text-purple-200",
      helper: t("settings.balance.mergeHelper"),
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="max-w-screen-lg mx-auto px-4 py-6 space-y-6"
      data-testid="view-settings"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/30 to-cyan-500/20 border border-blue-400/30 flex items-center justify-center">
          <User className="w-5 h-5 text-blue-300" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{t("settings.title")}</h1>
          <p className="text-sm text-slate-400">
            {t("settings.subtitle")}
          </p>
        </div>
      </div>

      {/* Profile card */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/70 to-slate-950/60 backdrop-blur-xl p-5 shadow-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-blue-300" />
          <h2 className="text-sm font-semibold text-blue-200 uppercase tracking-wider">
            {t("settings.profile.section")}
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <ProfileRow
            icon={<User className="w-4 h-4 text-slate-400" />}
            label={t("settings.profile.fullName")}
            value={currentCase?.userName ?? "—"}
            testId="profile-name"
          />
          <ProfileRow
            icon={<Mail className="w-4 h-4 text-slate-400" />}
            label={t("settings.profile.email")}
            value={currentCase?.userEmail ?? "—"}
            testId="profile-email"
          />
          <ProfileRow
            icon={<Phone className="w-4 h-4 text-slate-400" />}
            label={t("settings.profile.mobile")}
            value={currentCase?.userMobile ?? "—"}
            testId="profile-mobile"
          />
          <ProfileRow
            icon={<Shield className="w-4 h-4 text-slate-400" />}
            label={t("settings.profile.accessCode")}
            value={currentCase?.accessCode ?? "—"}
            testId="profile-access-code"
            mono
          />
        </div>
      </div>

      {/* Balance preview card */}
      <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/10 via-slate-900/60 to-slate-950/70 backdrop-blur-xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-300" />
            <h2 className="text-sm font-semibold text-emerald-200 uppercase tracking-wider">
              {t("settings.balance.section")}
            </h2>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-emerald-300/70 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
            {t("settings.balance.liveBadge")}
          </span>
        </div>

        {/* Compiled deposit total */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="rounded-xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/20 to-teal-500/10 p-5 mb-4"
          data-testid="balance-compiled-total"
        >
          <div className="flex items-center gap-2 mb-1">
            <Calculator className="w-3.5 h-3.5 text-emerald-300" />
            <p className="text-[11px] uppercase tracking-widest text-emerald-200/80">
              {t("settings.balance.compiledLabel")}
            </p>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className="text-4xl font-extrabold text-white tabular-nums"
              data-testid="text-compiled-amount"
            >
              {formatUsdt(balance.compiledDeposit)}
            </span>
            <span className="text-emerald-200 font-semibold">USDT</span>
          </div>
          <p className="text-xs text-emerald-200/70 mt-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            {t("settings.balance.compiledHint")}
          </p>
        </motion.div>

        {/* Component breakdown */}
        <div className="grid sm:grid-cols-3 gap-2 mb-4">
          {rows.map((r) => (
            <div
              key={r.label}
              className={`rounded-lg border bg-gradient-to-br ${r.tone} p-3`}
              data-testid={`balance-row-${r.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <p className="text-[10px] uppercase tracking-wider text-slate-300/70">
                {r.label}
              </p>
              <p className="text-xl font-bold text-white tabular-nums mt-1">
                {formatUsdt(r.value)} <span className="text-xs text-slate-300/70">USDT</span>
              </p>
              <p className="text-[10px] text-slate-400/80 mt-1">{r.helper}</p>
            </div>
          ))}
        </div>

        {/* Secondary fields */}
        <div className="grid sm:grid-cols-2 gap-2">
          <div
            className="rounded-lg border border-white/10 bg-slate-900/40 p-3"
            data-testid="balance-row-wallet-requirement"
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-400">
              {t("settings.balance.walletRequirement")}
            </p>
            <p className="text-base font-semibold text-white tabular-nums mt-1">
              {formatUsdt(balance.wallet)}{" "}
              <span className="text-xs text-slate-400">USDT</span>
            </p>
          </div>
          <div
            className="rounded-lg border border-white/10 bg-slate-900/40 p-3"
            data-testid="balance-row-withdrawal"
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-400">
              {t("settings.balance.withdrawalTotal")}
            </p>
            <p className="text-base font-semibold text-white tabular-nums mt-1">
              {formatUsdt(balance.withdrawal)}{" "}
              <span className="text-xs text-slate-400">USDT</span>
            </p>
          </div>
        </div>

        <p className="text-[11px] text-slate-400/80 mt-4 leading-relaxed">
          {t("settings.balance.footnote")}
        </p>
      </div>
    </motion.div>
  );
}

function ProfileRow({
  icon,
  label,
  value,
  testId,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  testId: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/40 p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      </div>
      <p
        className={`text-sm text-white ${mono ? "font-mono tracking-wider" : "font-medium"}`}
        data-testid={`text-${testId}`}
      >
        {value}
      </p>
    </div>
  );
}
