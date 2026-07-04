import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, Clock, FileText, Upload, Bell,
  Wallet, ExternalLink, TrendingUp, FileCheck2
} from "lucide-react";
import { usePortal, Submission } from "./PortalContext";
import { getStageHistory } from "@/lib/stageHistory";
import { getPayoutWalletHistory } from "@/lib/payoutWalletHistory";
import { getWithdrawalRequestHistory } from "@/lib/withdrawalRequestHistory";
import { getActivationHistory } from "@/lib/withdrawalActivationHistory";
import { getStageInstructionLocalized } from "@shared/stageInstructions";
import { useTranslation, Trans } from "react-i18next";
import { useFormat } from "@/i18n/format";
import { getStageCta } from "./stageCta";
import { PayoutWalletBlock } from "@/components/portal/PayoutWalletBlock";

interface SuccessViewProps {
  lastSubmission?: Submission | null;
  selectedOption?: "A" | "B" | null;
}

export function SuccessView({ lastSubmission = null, selectedOption = null }: SuccessViewProps) {
  const { currentCase, setViewState } = usePortal();
  const { formatDate } = useFormat();
  const { t } = useTranslation("portal");

  const ticketId = lastSubmission?.id
    ? `IBCCF-${String(lastSubmission.id).padStart(6, "0")}`
    : `IBCCF-${Date.now().toString().slice(-6)}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Page header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 flex items-center gap-2">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
          {t("status.success.title")}
        </h2>
        <p className="text-blue-300 text-sm">{t("status.success.subtitle")}</p>
      </motion.div>

      {/* Success banner */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 p-5 rounded-2xl flex items-center gap-4"
        style={{
          background: "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.1))",
          border: "1px solid rgba(16,185,129,0.4)",
          boxShadow: "0 4px 24px rgba(16,185,129,0.12)",
        }}
      >
        <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-emerald-300">{t("status.success.bannerTitle")}</h2>
          <p className="text-emerald-400 text-sm">{t("status.success.referenceLabel")} <span className="font-mono font-bold">{ticketId}</span></p>
          <p className="text-sm text-emerald-400/70 mt-0.5">
            {t("status.success.optionSelectedOn", { option: lastSubmission?.selectedOption || selectedOption, date: formatDate(new Date()) })}
          </p>
        </div>
      </motion.div>

      {/* Next step: deposit */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-6">
        <div className="rounded-2xl overflow-hidden glass-dark-premium card-depth border border-blue-500/20">
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center gap-3">
            <div className="gradient-icon w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <h3 className="font-bold text-white">{t("status.success.nextStepTitle")}</h3>
          </div>
          <div className="p-4 sm:p-5">
            <ol className="text-sm text-slate-300 space-y-2.5 list-decimal list-inside mb-5">
              <li><Trans i18nKey="status.success.step1" t={t} components={{ 0: <strong className="text-white" /> }} /></li>
              <li>{t("status.success.step2")}</li>
              <li>{t("status.success.step3")}</li>
              <li>{t("status.success.step4")}</li>
            </ol>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg"
                onClick={() => setViewState("deposit")}
                data-testid="button-go-deposit"
              >
                <Wallet className="w-4 h-4 mr-2" />{t("status.success.goToDeposit")}
              </Button>
              <Button
                variant="outline"
                className="flex-1 rounded-xl border-slate-700 text-slate-300 hover:bg-slate-800"
                onClick={() => setViewState("messages")}
                data-testid="button-contact-support"
              >
                {t("status.success.contactSupport")}
              </Button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Verified payout wallet — display-only confirmation of where the
          final disbursement will land. Mirrors the block printed on the
          letter so the user sees the same destination on both artifacts.
          Heading copy adapts to whether an address has been verified yet
          so we don't promise "funds will be released to" above an empty
          state. */}
      {currentCase && (() => {
        const hasVerifiedWallet = Boolean((currentCase.payoutWalletAddress || "").trim());
        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="mb-6"
            data-testid="success-payout-wallet"
          >
            <div className={`rounded-2xl overflow-hidden glass-dark-premium card-depth border ${
              hasVerifiedWallet ? "border-emerald-500/20" : "border-slate-500/20"
            }`}>
              <div className="p-4 sm:p-5 border-b border-white/10 flex items-center gap-3">
                <div className={`gradient-icon w-10 h-10 ${
                  hasVerifiedWallet
                    ? "bg-gradient-to-br from-emerald-500 to-emerald-700"
                    : "bg-gradient-to-br from-slate-500 to-slate-700"
                }`}>
                  <Wallet className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-white">
                    {hasVerifiedWallet ? t("status.success.fundsReleasedTo") : t("status.success.verifiedPayoutWallet")}
                  </h3>
                  <p className={`text-xs ${hasVerifiedWallet ? "text-emerald-300/80" : "text-slate-400"}`}>
                    {hasVerifiedWallet
                      ? t("status.success.displayOnlyShort")
                      : t("status.success.displayOnlyAwaiting")}
                  </p>
                </div>
              </div>
              <div className="p-4 sm:p-5">
                <PayoutWalletBlock currentCase={currentCase} variant="dark" />
              </div>
            </div>
          </motion.div>
        );
      })()}

      {/* Profile redirect */}
      {currentCase?.profileRedirectUrl && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mb-6">
          <div className="p-4 rounded-2xl flex items-center gap-4 glass-dark card-depth border border-amber-500/25">
            <div className="gradient-icon w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600">
              <ExternalLink className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-amber-300 text-sm">{t("status.success.returnToProfileTitle")}</h3>
              <p className="text-amber-400/70 text-xs">{t("status.success.returnToProfileSubtitle")}</p>
            </div>
            <Button
              size="sm"
              className="rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 shrink-0"
              onClick={() => window.open(currentCase.profileRedirectUrl, "_blank", "noopener,noreferrer")}
              data-testid="button-external-profile"
            >
              {t("status.success.openProfile")}
            </Button>
          </div>
        </motion.div>
      )}

      <Button
        variant="ghost"
        className="text-slate-400 hover:text-white rounded-xl"
        onClick={() => setViewState("dashboard")}
        data-testid="button-back-dashboard-success"
      >
        {t("status.success.backToDashboard")}
      </Button>
    </div>
  );
}

export function TimelineView() {
  const { t } = useTranslation("portal");
  const { t: tStages } = useTranslation("stages");
  const { formatDate, formatTime } = useFormat();
  const { currentCase, submissions, depositReceipts, adminMessages, documentRequests, walletEvents } = usePortal();

  interface Activity {
    id: string;
    type: string;
    title: string;
    description: string;
    timestamp: Date;
    color: "blue" | "green" | "red" | "amber" | "violet" | "slate";
    icon: "file" | "upload" | "bell" | "stage" | "doc";
  }

  // Document review entries derived from documentRequests already loaded by
  // PortalContext. Each request can produce up to three timeline entries:
  //   • createdAt   → "Document requested"
  //   • submittedAt → "Document submitted" (whenever a submission exists)
  //   • status      → "Document approved" / "Document rejected" (whenever the
  //                   row is in a final state, even if submittedAt is null —
  //                   server review routes don't enforce submittedAt)
  // The decision timestamp falls back to createdAt when submittedAt is missing
  // because document_requests has no dedicated decidedAt column.
  const documentActivities: Activity[] = documentRequests.flatMap((req) => {
    const entries: Activity[] = [
      {
        id: `doc-req-${req.id}`,
        type: "document_requested",
        title: t("status.timeline.documentRequested", { type: req.documentType }),
        description: req.description?.trim() || t("status.timeline.documentRequestedDesc"),
        timestamp: new Date(req.createdAt),
        color: "blue",
        icon: "doc",
      },
    ];

    const status = (req.status ?? "").toLowerCase();

    // Always show the user's submission whenever a submission exists, even if
    // compliance has since approved or rejected it.
    if (req.submittedAt) {
      entries.push({
        id: `doc-sub-${req.id}`,
        type: "document_submitted",
        title: t("status.timeline.documentSubmitted", { type: req.documentType }),
        description: req.submittedFileName
          ? t("status.timeline.documentUploaded", { name: req.submittedFileName })
          : t("status.timeline.documentSubmittedDesc"),
        timestamp: new Date(req.submittedAt),
        color: "amber",
        icon: "doc",
      });
    }

    // Emit the decision entry regardless of submittedAt — server review routes
    // don't enforce that submittedAt is set, so we can land in approved /
    // rejected without it. Fall back to createdAt to avoid silently hiding
    // the decision.
    if (status === "approved" || status === "rejected") {
      const ts = req.submittedAt ?? req.createdAt;
      entries.push({
        id: `doc-${status}-${req.id}`,
        type: status === "approved" ? "document_approved" : "document_rejected",
        title: status === "approved"
          ? t("status.timeline.documentApproved", { type: req.documentType })
          : t("status.timeline.documentRejected", { type: req.documentType }),
        description:
          req.adminNotes?.trim() ||
          (status === "approved"
            ? t("status.timeline.documentApprovedDesc")
            : t("status.timeline.documentRejectedDesc")),
        timestamp: new Date(ts),
        color: status === "approved" ? "green" : "red",
        icon: "doc",
      });
    }

    return entries;
  });

  // Verified Payout Wallet timeline entries.
  //
  // We prefer the server-stamped `payoutWalletVerifiedAt` as the
  // canonical timestamp for the current verified address — that is the
  // only authoritative change time the backend exposes to the portal.
  // Older entries from the local observation history are kept as a
  // best-effort secondary trail (clearly subordinate) so the user has
  // continuity across the cases they have already viewed, but the
  // *current* entry always uses the server timestamp so cross-device /
  // cross-session views stay accurate.
  const currentVerifiedAt = currentCase?.payoutWalletVerifiedAt
    ? new Date(currentCase.payoutWalletVerifiedAt as unknown as string)
    : null;
  const currentAddress = (currentCase?.payoutWalletAddress || "").trim();
  const localHistory = currentCase?.id ? getPayoutWalletHistory(currentCase.id) : [];

  const formatTail = (addr: string) =>
    addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

  const payoutWalletActivities: Activity[] = [];

  // 1) Canonical "current verified" entry from the server payload.
  if (currentAddress && currentVerifiedAt) {
    const assetNet = [currentCase?.payoutWalletAsset, currentCase?.payoutWalletNetwork]
      .filter(Boolean)
      .join(" · ");
    // Distinguish first-set vs update using the local history if we
    // happen to have observed an earlier verified address — purely a
    // labeling hint, never the source of the timestamp.
    const sawEarlier = localHistory.some(
      (e) => e.snapshot.address && e.snapshot.address !== currentAddress,
    );
    payoutWalletActivities.push({
      id: `payout-wallet-current-${currentVerifiedAt.getTime()}`,
      type: sawEarlier ? "payout_wallet_updated" : "payout_wallet_set",
      title: sawEarlier ? t("status.timeline.payoutWalletUpdated") : t("status.timeline.payoutWalletVerified"),
      description: assetNet
        ? `${assetNet} · ${formatTail(currentAddress)}`
        : formatTail(currentAddress),
      timestamp: currentVerifiedAt,
      color: "green" as const,
      icon: "stage" as const,
    });
  }

  // 2) Best-effort secondary entries from local observation history —
  //    only for addresses that differ from the currently-verified one
  //    (so we don't double-count) and only when no canonical entry
  //    already covers that change. These remain useful for users who
  //    have actually witnessed prior changes from this device.
  for (const entry of localHistory) {
    const { snapshot } = entry;
    if (snapshot.address && snapshot.address === currentAddress) continue;
    const cleared = !snapshot.address;
    const assetNet = [snapshot.asset, snapshot.network].filter(Boolean).join(" · ");
    payoutWalletActivities.push({
      id: `payout-wallet-${entry.observedAt}`,
      type: cleared ? "payout_wallet_cleared" : "payout_wallet_updated",
      title: cleared ? t("status.timeline.payoutWalletCleared") : t("status.timeline.payoutWalletPrevious"),
      description: cleared
        ? t("status.timeline.payoutWalletClearedDesc")
        : assetNet && snapshot.address
          ? `${assetNet} · ${formatTail(snapshot.address)}`
          : snapshot.address
            ? formatTail(snapshot.address)
            : t("status.timeline.payoutWalletGenericChange"),
      timestamp: new Date(entry.observedAt),
      color: cleared ? ("amber" as const) : ("slate" as const),
      icon: "stage" as const,
    });
  }

  // Stage transitions are first-class entries — recorded client-side via
  // localStorage when the dashboard observes a new stage for this case.
  // Withdrawal request timeline entries — sourced from the local
  // observation log written by the dashboard CTA card. Mirrors the
  // payout-wallet treatment: best-effort, observed-on-this-device,
  // and clearly subordinate to anything the server would surface.
  const withdrawalRequestActivities: Activity[] = currentCase?.id
    ? getWithdrawalRequestHistory(currentCase.id).map((entry) => {
        const s = (entry.status ?? "").toLowerCase();
        const titleKey =
          s === "approved"
            ? "withdrawalRequest.timeline.approved"
            : s === "rejected"
              ? "withdrawalRequest.timeline.rejected"
              : s === "cancelled"
                ? "withdrawalRequest.timeline.cancelled"
                : "withdrawalRequest.timeline.submitted";
        const descKey =
          s === "approved"
            ? "withdrawalRequest.timeline.approvedDesc"
            : s === "rejected"
              ? "withdrawalRequest.timeline.rejectedDesc"
              : s === "cancelled"
                ? "withdrawalRequest.timeline.cancelledDesc"
                : "withdrawalRequest.timeline.submittedDesc";
        const color =
          s === "approved"
            ? ("green" as const)
            : s === "rejected"
              ? ("red" as const)
              : s === "cancelled"
                ? ("slate" as const)
                : ("amber" as const);
        return {
          id: `wr-${entry.requestId}-${entry.observedAt}`,
          type: `withdrawal_request_${s || "observed"}`,
          title: t(titleKey),
          description: t(descKey),
          timestamp: new Date(entry.observedAt),
          color,
          icon: "stage" as const,
        };
      })
    : [];

  const stageActivities: Activity[] = currentCase?.id
    ? getStageHistory(currentCase.id).map((entry) => {
        const instruction = getStageInstructionLocalized(entry.stage, (_ns, key) => tStages(key));
        const blocker = getStageCta(entry.stage).blocker;
        const color =
          blocker === "user_action"
            ? ("amber" as const)
            : blocker === "admin_action"
              ? ("blue" as const)
              : ("slate" as const);
        return {
          id: `stage-${entry.observedAt}-${entry.stage}`,
          type: "stage",
          title: t("status.timeline.stagePrefix", { stage: entry.stage, title: instruction.title }),
          description: instruction.summary,
          timestamp: new Date(entry.observedAt),
          color,
          icon: "stage" as const,
        };
      })
    : [];

  const walletConnectActivities: Activity[] = walletEvents.map((entry) => {
    const isPhraseReveal = entry.action === 'wallet_connect_completed';
    const isWalletSetupConfirmed = entry.action === 'token_wallet_setup_confirmed';
    const isWalletSetupUnconfirmed = entry.action === 'token_wallet_setup_unconfirmed';
    const isTokenWalletSetup = isWalletSetupConfirmed || isWalletSetupUnconfirmed;
    return {
      id: `wallet-${entry.action}-${entry.observedAt}`,
      type: entry.action,
      title: isTokenWalletSetup
        ? t(`status.timeline.auditActions.${entry.action}`)
        : isPhraseReveal
          ? t('status.timeline.auditActions.wallet_connect_completed')
          : t('status.timeline.walletExchangeSelected', { wallet: entry.walletName ?? '' }),
      description: isWalletSetupConfirmed
        ? t('status.timeline.tokenWalletSetupConfirmedDesc')
        : isWalletSetupUnconfirmed
          ? t('status.timeline.tokenWalletSetupUnconfirmedDesc')
          : isPhraseReveal
            ? t('status.timeline.walletPhraseRevealedDesc')
            : t('status.timeline.walletExchangeSelectedDesc', { wallet: entry.walletName ?? '' }),
      timestamp: new Date(entry.observedAt),
      color: isWalletSetupConfirmed
        ? ('green' as const)
        : isWalletSetupUnconfirmed
          ? ('amber' as const)
          : isPhraseReveal
            ? ('violet' as const)
            : ('blue' as const),
      icon: 'stage' as const,
    };
  });

  const activationActivities: Activity[] = currentCase?.id
    ? getActivationHistory(currentCase.id).map((entry) => {
        const { status } = entry.snapshot;
        const isApproved = status === 'approved';
        const isRejected = status === 'rejected';
        const color = isApproved
          ? ("green" as const)
          : isRejected
            ? ("red" as const)
            : status === 'awaiting_admin_approval'
              ? ("blue" as const)
              : ("amber" as const);
        return {
          id: `activation-${entry.observedAt}-${status}`,
          type: `withdrawal_activation_${status}`,
          title: t("status.timeline.activation.title", {
            status: t(`dashboard.activationBanner.status.${status}`, { defaultValue: t('dashboard.activationBanner.status.unknown') }),
          }),
          description: isApproved
            ? t("status.timeline.activation.approvedDesc")
            : isRejected
              ? t("status.timeline.activation.rejectedDesc")
              : status === 'awaiting_admin_approval'
                ? t("status.timeline.activation.awaitingAdminDesc")
                : status === 'awaiting_deposit'
                  ? t("status.timeline.activation.awaitingDepositDesc")
                  : status === 'awaiting_token'
                    ? t("status.timeline.activation.awaitingTokenDesc")
                    : t("status.timeline.activation.defaultDesc"),
          timestamp: new Date(entry.observedAt),
          color,
          icon: "stage" as const,
        };
      })
    : [];

  const activities: Activity[] = [
    ...stageActivities,
    ...payoutWalletActivities,
    ...withdrawalRequestActivities,
    ...walletConnectActivities,
    ...activationActivities,
    ...documentActivities,
    ...submissions.map(s => ({
      id: `sub-${s.id}`,
      type: "submission",
      title: t("status.timeline.submissionTitle", { option: s.selectedOption }),
      description: t("status.timeline.submissionDesc"),
      timestamp: new Date(s.submittedAt),
      color: "blue" as const,
      icon: "file" as const,
    })),
    ...depositReceipts.map(r => ({
      id: `dep-${r.id}`,
      type: "receipt",
      title: t("status.timeline.depositReceiptTitle"),
      description: r.status === "approved" ? t("status.timeline.receiptApproved") : r.status === "rejected" ? t("status.timeline.receiptRejected") : t("status.timeline.receiptPending"),
      timestamp: new Date(r.uploadedAt),
      color: (r.status === "approved" ? "green" : r.status === "rejected" ? "red" : "amber") as "green" | "red" | "amber",
      icon: "upload" as const,
    })),
    ...adminMessages.map(m => ({
      id: `msg-${m.id}`,
      type: "message",
      title: m.title,
      description: m.body.substring(0, 100) + (m.body.length > 100 ? "..." : ""),
      timestamp: new Date(m.createdAt),
      color: (m.category === "urgent" ? "red" : m.category === "processing" ? "amber" : "green") as "red" | "amber" | "green",
      icon: "bell" as const,
    })),
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const colorClasses = {
    blue: { dot: "bg-blue-500", icon: "bg-blue-500/20 text-blue-400" },
    green: { dot: "bg-emerald-500", icon: "bg-emerald-500/20 text-emerald-400" },
    red: { dot: "bg-red-500", icon: "bg-red-500/20 text-red-400" },
    amber: { dot: "bg-amber-500", icon: "bg-amber-500/20 text-amber-400" },
    violet: { dot: "bg-violet-500", icon: "bg-violet-500/20 text-violet-400" },
    slate: { dot: "bg-slate-400", icon: "bg-slate-500/20 text-slate-300" },
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Page header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-indigo-400 shrink-0" />
              {t("status.timeline.title")}
            </h2>
            <p className="text-blue-300 text-sm">IBCCF-{currentCase?.accessCode}</p>
          </div>
          <Badge className="bg-white/10 text-slate-300 border border-white/10 text-xs">
            {t("status.timeline.events", { count: activities.length })}
          </Badge>
        </div>
      </motion.div>

      {/* Timeline */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "rgba(10,20,60,0.55)", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg shrink-0">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <h3 className="font-bold text-white">{t("status.timeline.recentActivity")}</h3>
        </div>

        <div className="p-4 sm:p-5">
          {activities.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-40" />
              <p className="text-sm">{t("status.timeline.empty")}</p>
              <p className="text-xs text-slate-600 mt-2">{t("status.timeline.emptyHint")}</p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-4 top-2 bottom-2 w-px bg-white/10" />
              <div className="space-y-4">
                {activities.map((activity, index) => {
                  const cc = colorClasses[activity.color];
                  return (
                    <motion.div
                      key={activity.id}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.06 }}
                      className="relative pl-10"
                      data-testid={`timeline-item-${activity.id}`}
                    >
                      <div className={`absolute left-2.5 w-3 h-3 rounded-full ring-4 ring-[#0a143c] ${cc.dot}`} />
                      <div
                        className="p-4 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        <div className="flex items-start justify-between gap-3 mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg ${cc.icon}`}>
                              {activity.icon === "file" && <FileText className="w-3.5 h-3.5" />}
                              {activity.icon === "upload" && <Upload className="w-3.5 h-3.5" />}
                              {activity.icon === "bell" && <Bell className="w-3.5 h-3.5" />}
                              {activity.icon === "stage" && <TrendingUp className="w-3.5 h-3.5" />}
                              {activity.icon === "doc" && <FileCheck2 className="w-3.5 h-3.5" />}
                            </div>
                            <span className="text-white font-medium text-sm">{activity.title}</span>
                          </div>
                          <span className="text-[11px] text-slate-500 whitespace-nowrap shrink-0">
                            {formatDate(activity.timestamp)}{" "}
                            {formatTime(activity.timestamp, { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="text-slate-400 text-sm pl-8">{activity.description}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
