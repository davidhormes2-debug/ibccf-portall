import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useChatAutoScroll } from "@/hooks/use-chat-autoscroll";
import { usePortal, ViewState, Case } from "./PortalContext";
import { PortalSkeleton } from "@/components/portal/PortalSkeleton";
import {
  Shield, ShieldCheck, CheckCircle, AlertTriangle, Clock,
  Bell, FileText, MessageCircle, Send, X, Wallet, ExternalLink, User, History,
  TrendingUp, Key, Star, Sparkles, PartyPopper, ArrowRight, Hourglass, Cog, UserCheck, Stamp, Copy
} from "lucide-react";
import { WithdrawalGuideBanner } from "@/components/portal/WithdrawalGuideBanner";
import { WithdrawalTutorialButton } from "@/components/portal/withdrawal-video/WithdrawalTutorialButton";

import {
  getStageCta,
  getStageTitle,
  getStageWhatsNext,
  blockerLabel,
  blockerColors,
  StageBlocker,
} from "./stageCta";
import {
  getStageInstructionLocalized,
  getRecommendedDocumentsForStage,
  DOCUMENT_CATEGORY_LABELS,
} from "@shared/stageInstructions";
import { formatTokenDepositRequired } from "@shared/tokenDeposit";
import { useTranslation, Trans } from "react-i18next";
import { useFormat } from "@/i18n/format";
import { LocalizedAmount } from "@/components/portal/LocalizedAmount";
import {
  recordStageObservation,
  hasSeenStageBanner,
  markStageBannerSeen,
} from "@/lib/stageHistory";
import {
  recordPayoutWalletObservation,
  hasSeenPayoutWalletBanner,
  markPayoutWalletBannerSeen,
} from "@/lib/payoutWalletHistory";
import {
  recordStampDutyObservation,
  hasSeenStampDutyBanner,
  markStampDutyBannerSeen,
  type StampDutyStatus,
} from "@/lib/stampDutyHistory";
import {
  recordActivationObservation,
  hasSeenActivationBanner,
  markActivationBannerSeen,
} from "@/lib/withdrawalActivationHistory";
import { WithdrawalRequestDialog } from "./WithdrawalRequestDialog";
import { AccountHistoryCard } from "@/components/portal/AccountHistoryCard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPortalToken } from "@/lib/portalSession";
import {
  recordWithdrawalRequestObservation,
  hasSeenWithdrawalRequestBanner,
  markWithdrawalRequestBannerSeen,
} from "@/lib/withdrawalRequestHistory";
import { getIsWithdrawalMode } from "@/lib/withdrawalMode";

interface CardConfig {
  id: string;
  icon: React.ElementType;
  color: string;
  glow: string;
  viewState: ViewState | null;
  testId: string;
}

const cardConfigs: CardConfig[] = [
  {
    id: "messages",
    icon: Bell,
    color: "from-blue-500 to-blue-700",
    glow: "rgba(59,130,246,0.35)",
    viewState: "messages",
    testId: "card-required-actions",
  },
  {
    id: "letter",
    icon: FileText,
    color: "from-emerald-500 to-emerald-700",
    glow: "rgba(16,185,129,0.35)",
    viewState: "letter",
    testId: "card-withdrawal-letter",
  },
  {
    id: "profile",
    icon: User,
    color: "from-purple-500 to-purple-700",
    glow: "rgba(168,85,247,0.35)",
    viewState: null,
    testId: "card-profile",
  },
  {
    id: "deposit",
    icon: Wallet,
    color: "from-amber-500 to-orange-600",
    glow: "rgba(245,158,11,0.35)",
    viewState: "deposit",
    testId: "card-deposit",
  },
  {
    id: "submissions",
    icon: History,
    color: "from-slate-500 to-slate-700",
    glow: "rgba(100,116,139,0.35)",
    viewState: "submissions",
    testId: "card-history",
  },
  {
    id: "timeline",
    icon: Clock,
    color: "from-indigo-500 to-indigo-700",
    glow: "rgba(99,102,241,0.35)",
    viewState: "timeline",
    testId: "card-timeline",
  },
  {
    id: "support",
    icon: MessageCircle,
    color: "from-cyan-500 to-cyan-700",
    glow: "rgba(6,182,212,0.35)",
    viewState: null,
    testId: "card-support",
  },
  {
    id: "feedback",
    icon: Star,
    color: "from-pink-500 to-rose-600",
    glow: "rgba(236,72,153,0.35)",
    viewState: null,
    testId: "card-feedback",
  },
];

export function DashboardView() {
  const { t } = useTranslation("portal");
  const {
    currentCase, adminMessages, submissions, depositReceipts,
    chatMessages, unreadCount, unreadAdminMessages, isChatOpen, setIsChatOpen,
    sendMessage, setViewState, hasUrgentMessages, keyRequestNotification, dismissKeyRequestNotification
  } = usePortal();

  const isWithdrawalMode = getIsWithdrawalMode(currentCase);

  const [newMessage, setNewMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [hasSubmittedFeedback, setHasSubmittedFeedback] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const urgentMessages = adminMessages.filter(m => m.category === "urgent");
  const processingMessages = adminMessages.filter(m => m.category === "processing");
  const resolvedMessages = adminMessages.filter(m => m.category === "resolved");

  // Sticky-bottom: auto-scroll on new messages only when the user
  // is already near the bottom. Reading older messages is preserved.
  const { onScroll: handleChatScroll } = useChatAutoScroll(chatScrollRef, [chatMessages, isChatOpen]);

  useEffect(() => {
    if (isChatOpen && currentCase && unreadCount > 0) {
      import("@/lib/portalSession").then(({ getPortalToken }) => {
        const portalToken = getPortalToken();
        fetch(`/api/cases/${currentCase.id}/messages/read`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(portalToken ? { "x-portal-session-token": portalToken } : {}),
          },
          body: JSON.stringify({ sender: "admin" }),
        });
      });
    }
  }, [isChatOpen, currentCase, unreadCount]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || isSendingMessage) return;
    setIsSendingMessage(true);
    await sendMessage(newMessage.trim());
    setNewMessage("");
    setIsSendingMessage(false);
  };

  const submitFeedback = async () => {
    if (!currentCase || feedbackRating === 0) return;
    setIsSubmittingFeedback(true);
    try {
      const res = await fetch("/api/user-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: currentCase.id,
          rating: feedbackRating,
          comment: feedbackComment.trim() || null,
          category: "general",
        }),
      });
      if (res.ok) {
        setHasSubmittedFeedback(true);
        setIsFeedbackOpen(false);
        setFeedbackRating(0);
        setFeedbackComment("");
        toast({ title: t("dashboard.feedback.toastSuccessTitle"), description: t("dashboard.feedback.toastSuccessDesc") });
      }
    } catch {
      toast({ variant: "destructive", title: t("dashboard.feedback.toastErrorTitle"), description: t("dashboard.feedback.toastErrorDesc") });
    }
    setIsSubmittingFeedback(false);
  };

  const handleCardClick = (cfg: typeof cardConfigs[0]) => {
    if (cfg.id === "support") { setIsChatOpen(true); return; }
    if (cfg.id === "feedback") { if (!hasSubmittedFeedback) setIsFeedbackOpen(true); return; }
    if (cfg.viewState) setViewState(cfg.viewState);
  };

  const getCardContent = (cfg: typeof cardConfigs[0]) => {
    switch (cfg.id) {
      case "messages":
        return (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-red-400"><AlertTriangle className="w-3.5 h-3.5" /> {t("dashboard.messages.urgent")}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${urgentMessages.length > 0 ? "bg-red-500/20 text-red-400" : "bg-slate-700/50 text-slate-400"}`}>{urgentMessages.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-amber-400"><Clock className="w-3.5 h-3.5" /> {t("dashboard.messages.processing")}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400">{processingMessages.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-emerald-400"><CheckCircle className="w-3.5 h-3.5" /> {t("dashboard.messages.resolved")}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400">{resolvedMessages.length}</span>
            </div>
          </div>
        );
      case "letter":
        return (currentCase?.letterSent || isWithdrawalMode) ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>{t("dashboard.letter.status")}</span>
              <span className={`font-semibold ${submissions.length > 0 ? "text-emerald-400" : "text-blue-400"}`}>{submissions.length > 0 ? t("dashboard.letter.submitted") : t("dashboard.letter.ready")}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>{t("dashboard.letter.submissions")}</span>
              <span className="font-semibold text-white">{submissions.length}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 text-amber-400 bg-amber-900/20 rounded-xl p-3 text-sm">
            <Clock className="w-4 h-4 shrink-0" />
            <p>{t("dashboard.letter.preparing")}</p>
          </div>
        );
      case "profile":
        return (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">{t("dashboard.profile.name")}</span>
              <span className="text-white font-semibold truncate max-w-[120px]">{currentCase?.userName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{t("dashboard.profile.email")}</span>
              <span className="text-white text-xs truncate max-w-[120px]">{currentCase?.userEmail}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{t("dashboard.profile.vipStatus")}</span>
              <span className="text-amber-400 font-semibold">{currentCase?.vipStatus || t("dashboard.header.standard")}</span>
            </div>
          </div>
        );
      case "deposit":
        return (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">{t("dashboard.deposit.receiptsUploaded")}</span>
              <span className="text-white font-semibold">{depositReceipts.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{t("dashboard.deposit.pendingReview")}</span>
              <span className="text-amber-400 font-semibold">{depositReceipts.filter(r => r.status === "pending").length}</span>
            </div>
          </div>
        );
      case "submissions":
        return (
          <div className="text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">{t("dashboard.submissions.total")}</span>
              <span className="text-white font-semibold">{submissions.length}</span>
            </div>
          </div>
        );
      case "timeline":
        return (
          <div className="text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">{t("dashboard.timeline.recent")}</span>
              <span className="text-white font-semibold">{submissions.length + depositReceipts.length + adminMessages.length}</span>
            </div>
          </div>
        );
      case "support":
        return (
          <p className="text-slate-400 text-sm">{t("dashboard.support.body")}</p>
        );
      case "feedback":
        return hasSubmittedFeedback ? (
          <div className="text-center text-emerald-400">
            <CheckCircle className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm font-medium">{t("dashboard.feedback.thankYou")}</p>
          </div>
        ) : (
          <p className="text-slate-400 text-sm">{t("dashboard.feedback.body")}</p>
        );
      default:
        return null;
    }
  };

  if (!currentCase) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-6" data-testid="dashboard-loading">
        <PortalSkeleton variant="stat" count={3} />
        <PortalSkeleton variant="card" count={2} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Page header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">
              {t("dashboard.header.welcomeBack")} <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">{currentCase?.userName || t("dashboard.header.memberFallback")}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-blue-300">
              {currentCase?.isRegulated ? (
                <span
                  className="flex items-center gap-1.5"
                  data-testid="badge-fully-regulated"
                  title={t("dashboard.header.fullyRegulatedTooltip")}
                >
                  <ShieldCheck className="w-4 h-4 text-sky-400" />
                  <span className="text-sky-300 font-medium">{t("dashboard.header.fullyRegulated")}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" /> {t("dashboard.header.verified")}
                </span>
              )}
              <span className="font-mono text-xs">IBCCF-{currentCase?.accessCode}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="px-4 py-2 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <p className="text-[10px] text-blue-300 uppercase tracking-widest">{t("dashboard.header.vipStatus")}</p>
              <p className="font-bold text-blue-400 text-sm">{currentCase?.vipStatus || t("dashboard.header.standard")}</p>
            </div>
            <div className="px-4 py-2 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <p className="text-[10px] text-blue-300 uppercase tracking-widest">{t("dashboard.header.account")}</p>
              <p className="font-bold text-emerald-400 text-sm">{t("dashboard.header.active")}</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Welcome-back banner — shown once per reactivation event */}
      {currentCase && (
        <ReactivationWelcomeBanner currentCase={currentCase} />
      )}

      {/* NDA-triggered auto-finalization banner — non-dismissible terminal state */}
      {currentCase?.autoFinalizedAt && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-5 rounded-2xl"
          style={{
            background:
              "linear-gradient(135deg, rgba(16,185,129,0.18), rgba(34,197,94,0.10), rgba(59,130,246,0.14))",
            border: "1px solid rgba(74,222,128,0.45)",
            boxShadow: "0 8px 32px rgba(16,185,129,0.18)",
          }}
          data-testid="banner-case-finalized"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-emerald-200 text-xs uppercase tracking-widest font-semibold">
                {t("dashboard.finalized.label")}
              </p>
              <h3 className="text-white text-base sm:text-lg font-bold mt-0.5">
                {t("dashboard.finalized.title")}
              </h3>
              <p className="text-emerald-100/80 text-sm mt-1">
                {t("dashboard.finalized.body", {
                  date: new Date(currentCase.autoFinalizedAt).toLocaleString(),
                  tail: currentCase.certificateEnabled
                    ? t("dashboard.finalized.tailCertificate")
                    : t("dashboard.finalized.tailEmail"),
                })}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Per-stage CTA card — visually dominant; colour-coded by blocker type */}
      {currentCase && (
        <StageCtaCard currentCase={currentCase} />
      )}

      {/* 14-Stage Progress Tracker — placed directly below CTA */}
      {currentCase && (
        <WithdrawalProgressTracker currentCase={currentCase} />
      )}

      {/* Urgent alert banner — surfaces below stage CTA/tracker so the dominant flow is always CTA-first */}
      {(currentCase?.hasRequirements || hasUrgentMessages) && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-6 p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center gap-4"
          style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(249,115,22,0.12))", border: "1px solid rgba(239,68,68,0.4)", boxShadow: "0 4px 24px rgba(239,68,68,0.15)" }}
        >
          <motion.div
            animate={{ rotate: [0, -10, 10, -10, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-red-500 to-orange-500 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg"
          >
            <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </motion.div>
          <div className="flex-1">
            <h3 className="font-bold text-red-300 text-base sm:text-lg">{t("dashboard.urgentBanner.title")}</h3>
            <p className="text-red-400/80 text-sm">{t("dashboard.urgentBanner.body")}</p>
          </div>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white shadow-lg w-full sm:w-auto rounded-xl"
            size="sm"
            onClick={() => setViewState("messages")}
          >
            {t("dashboard.urgentBanner.viewNow")}
          </Button>
        </motion.div>
      )}

      {/* Key request notification — below stage CTA/tracker for CTA-first UX */}
      {keyRequestNotification && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="mb-6 p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center gap-4"
          style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(168,85,247,0.12))", border: "1px solid rgba(99,102,241,0.4)", boxShadow: "0 4px 24px rgba(99,102,241,0.15)" }}
        >
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg">
            <MessageCircle className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-indigo-300 text-base sm:text-lg">
              {t("dashboard.keyRequestBanner.title")}
            </h3>
            <p className="text-indigo-400/80 text-sm">
              {keyRequestNotification.unreadCount === 1
                ? t("dashboard.keyRequestBanner.single")
                : t("dashboard.keyRequestBanner.multiple", { count: keyRequestNotification.unreadCount })}
            </p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg rounded-xl flex-1 sm:flex-none"
              size="sm"
              onClick={() => setViewState("keyRequest")}
            >
              {t("dashboard.keyRequestBanner.viewMessage")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/30 rounded-xl"
              onClick={dismissKeyRequestNotification}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </motion.div>
      )}

      {/* Withdrawal Guide banner — admin-toggled compliance guide */}
      {currentCase?.withdrawalGuideVisible && (
        <div className="mb-6">
          <WithdrawalGuideBanner customBody={currentCase.withdrawalGuideBody ?? null} />
        </div>
      )}

      {/* Account balance — admin-controlled. Hidden if no balance set. */}
      {currentCase?.userBalance && currentCase.userBalance.trim().length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 p-4 sm:p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10"
          data-testid="card-user-balance"
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-emerald-300/90 font-semibold">
                {t("dashboard.balance.label")}
              </p>
              <p
                className="text-3xl sm:text-4xl font-bold text-emerald-300 mt-1.5 font-mono tracking-tight"
                data-testid="text-user-balance"
              >
                <LocalizedAmount
                  value={currentCase.userBalance}
                  estimateClassName="text-base font-normal text-emerald-200/80 ml-2"
                />
              </p>
              <p className="text-xs text-emerald-400/70 mt-1.5">
                {t("dashboard.balance.footnote")}
              </p>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center shrink-0 border border-emerald-500/30">
              <Wallet className="w-7 h-7 text-emerald-300" />
            </div>
          </div>
        </motion.div>
      )}

      {/* Account history — credits/debits the admin has recorded */}
      {currentCase?.id && <AccountHistoryCard caseId={currentCase.id} />}

      {/* Stamp Duty Deposit reminder */}
      {currentCase?.stampDutyEnabled === true &&
        currentCase.stampDutyStatus !== "approved" && (
          <StampDutyReminderCard currentCase={currentCase} />
        )}

      {/* Validation Deposit Gate */}
      {currentCase?.validationDepositWalletAddress && (
        <ValidationDepositCard currentCase={currentCase} />
      )}

      {/* Token Wallet Setup Guide — shown after validation deposit confirmed and link is set */}
      {currentCase?.validationDepositConfirmed && currentCase?.tokenWalletSetupLink && (
        <TokenWalletSetupCard currentCase={currentCase} />
      )}

      {/* Verified Payout Wallet — display-only disbursement address */}
      {currentCase && (
        <PayoutWalletCard currentCase={currentCase} />
      )}

      {/* Withdrawal Window CTA — admin-toggled */}
      {currentCase?.withdrawalWindowEnabled && (
        <WithdrawalWindowCard currentCase={currentCase} />
      )}

      {/* Withdrawal request history */}
      {currentCase && (
        <WithdrawalRequestsHistoryCard currentCase={currentCase} />
      )}

      {/* Quick-navigation grid */}
      <div className="grid grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
        {cardConfigs.map((cfg, i) => {
          const Icon = cfg.icon;
          const cardEl = (
            <motion.div
              key={cfg.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              data-testid={cfg.testId}
              onClick={() => handleCardClick(cfg)}
              className={`group relative rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1 glass-dark-premium card-depth ${cfg.viewState || cfg.id === "support" || cfg.id === "feedback" ? "cursor-pointer" : ""}`}
            >
              {/* Hover glow overlay */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl"
                style={{ background: `radial-gradient(circle at 30% 30%, ${cfg.glow}, transparent 70%)` }}
              />

              {/* Card header */}
              <div className="relative p-4 sm:p-5 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div
                    className={`gradient-icon w-10 h-10 bg-gradient-to-br ${cfg.color}`}
                    style={{ boxShadow: `0 4px 14px ${cfg.glow}` }}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white text-sm">{t(`dashboard.cards.${cfg.id}`)}</h3>
                    {cfg.id === "messages" && unreadAdminMessages > 0 && (
                      <Badge className="mt-0.5 bg-red-500/20 text-red-400 border border-red-500/30 text-[10px]">
                        {t("dashboard.cards.unread", { count: unreadAdminMessages })}
                      </Badge>
                    )}
                    {cfg.id === "support" && unreadCount > 0 && (
                      <Badge className="mt-0.5 bg-red-500/20 text-red-400 border border-red-500/30 text-[10px]">
                        {t("dashboard.cards.unread", { count: unreadCount })}
                      </Badge>
                    )}
                    {cfg.id === "letter" && !currentCase?.letterSent && !isWithdrawalMode && (
                      <Badge className="mt-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px]">
                        {t("dashboard.cards.pending")}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Card body */}
              <div className="relative p-4 sm:p-5">
                {getCardContent(cfg)}

                {/* Profile redirect */}
                {cfg.id === "profile" && currentCase?.profileRedirectUrl && (
                  <Button
                    className="w-full mt-4 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10 text-sm"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); window.open(currentCase.profileRedirectUrl, "_blank", "noopener,noreferrer"); }}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    {t("dashboard.cards.accessAccount")}
                  </Button>
                )}
              </div>
            </motion.div>
          );

          return cardEl;
        })}
      </div>

      {/* Tutorial video — entry point at the bottom of the dashboard */}
      <div className="mb-6 mt-2">
        <WithdrawalTutorialButton />
      </div>

      {/* Floating chat button */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.1 }}
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 right-4 sm:right-6 w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-700 text-white rounded-full shadow-2xl flex items-center justify-center z-50"
        style={{ boxShadow: "0 4px 20px rgba(59,130,246,0.5)" }}
        onClick={() => setIsChatOpen(true)}
        data-testid="button-chat-float"
      >
        <MessageCircle className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[10px] flex items-center justify-center font-bold">
            {unreadCount}
          </span>
        )}
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {isChatOpen && currentCase && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] max-w-sm sm:max-w-sm sm:w-96 h-[460px] sm:h-[500px] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ background: "rgba(15,23,42,0.97)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(20px)" }}
            data-testid="chat-panel"
          >
            <div className="bg-gradient-to-r from-[#004182] to-[#0066cc] text-white px-4 py-3 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                    <Shield className="h-4 w-4" />
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-[#004182]" />
                </div>
                <div>
                  <span className="font-bold text-sm block">{t("dashboard.chat.title")}</span>
                  <span className="text-[10px] text-blue-200">{t("dashboard.chat.online")}</span>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-white hover:bg-white/10 rounded-lg" onClick={() => setIsChatOpen(false)} data-testid="button-close-chat">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto p-4 space-y-3" style={{ background: "rgba(15,23,42,0.98)" }}>
              {chatMessages.length === 0 ? (
                <div className="text-center text-slate-500 mt-8">
                  <div className="w-14 h-14 bg-blue-900/50 rounded-full mx-auto flex items-center justify-center mb-3">
                    <MessageCircle className="h-7 w-7 text-blue-400" />
                  </div>
                  <p className="font-medium text-slate-300 mb-1 text-sm">{t("dashboard.chat.welcomeTitle")}</p>
                  <p className="text-xs text-slate-500">{t("dashboard.chat.welcomeBody")}</p>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.sender === "admin" && (
                      <div className="w-7 h-7 bg-[#004182] rounded-full flex items-center justify-center mr-2 flex-shrink-0 mt-1">
                        <Shield className="text-white w-3.5 h-3.5" />
                      </div>
                    )}
                    <div className={`max-w-[76%] px-3 py-2 rounded-2xl text-sm ${msg.sender === "user" ? "bg-[#004182] text-white rounded-br-md" : "bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-md"}`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t border-white/10" style={{ background: "rgba(15,23,42,0.98)" }}>
              <div className="flex gap-2 items-end">
                <Input
                  placeholder={t("dashboard.chat.placeholder")}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                  disabled={isSendingMessage}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 rounded-xl focus:border-blue-500"
                  data-testid="input-chat-message"
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim() || isSendingMessage}
                  size="sm"
                  className="h-10 w-10 p-0 bg-[#004182] hover:bg-[#003366] rounded-full shrink-0"
                  style={{ boxShadow: "0 2px 8px rgba(0,65,130,0.4)" }}
                  data-testid="button-send-message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feedback dialog */}
      <Dialog open={isFeedbackOpen} onOpenChange={setIsFeedbackOpen}>
        <DialogContent className="sm:max-w-md bg-slate-900 border border-slate-700" data-testid="dialog-feedback">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white"><Star className="w-5 h-5 text-amber-400" />{t("dashboard.feedback.title")}</DialogTitle>
            <DialogDescription className="text-slate-400">{t("dashboard.feedback.description")}</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-5">
            <div>
              <label className="text-sm font-medium mb-3 block text-slate-300">{t("dashboard.feedback.rateLabel")}</label>
              <div className="flex gap-2 justify-center">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button key={star} type="button" className={`text-4xl transition-transform hover:scale-110 ${feedbackRating >= star ? "text-yellow-400" : "text-slate-600"}`} onClick={() => setFeedbackRating(star)} data-testid={`button-star-${star}`}>★</button>
                ))}
              </div>
              {feedbackRating > 0 && (
                <p className="text-center text-sm text-slate-400 mt-2">
                  {t(`dashboard.feedback.ratings.${feedbackRating}`)}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block text-slate-300">{t("dashboard.feedback.commentsLabel")}</label>
              <Textarea placeholder={t("dashboard.feedback.commentsPlaceholder")} value={feedbackComment} onChange={(e) => setFeedbackComment(e.target.value)} rows={4} className="resize-none bg-slate-800 border-slate-700 text-white" data-testid="input-feedback-comment" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFeedbackOpen(false)} className="border-slate-600 text-slate-300">{t("dashboard.feedback.cancel")}</Button>
            <Button onClick={submitFeedback} disabled={feedbackRating === 0 || isSubmittingFeedback} className="bg-gradient-to-r from-pink-500 to-rose-500" data-testid="button-submit-feedback">
              {isSubmittingFeedback ? t("dashboard.feedback.submitting") : t("dashboard.feedback.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReactivationWelcomeBanner({ currentCase }: { currentCase: Case }) {
  const { t } = useTranslation("portal");
  const reactivatedAt = (currentCase as any).reactivatedAt as string | null | undefined;
  const dismissKey = reactivatedAt
    ? `ibccf_reactivation_seen_${currentCase.id}_${reactivatedAt}`
    : null;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!dismissKey) return true;
    try {
      return localStorage.getItem(dismissKey) === "1";
    } catch {
      return false;
    }
  });
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!reactivatedAt || dismissed) return;
    const start = performance.now();
    const duration = 1400;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(Math.round(eased * 100));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reactivatedAt, dismissed]);

  if (!reactivatedAt || dismissed || !dismissKey) return null;

  // Auto-expire after 14 days so old reactivations don't linger forever.
  const ageMs = Date.now() - new Date(reactivatedAt).getTime();
  if (ageMs > 14 * 24 * 60 * 60 * 1000) return null;

  const onDismiss = () => {
    try {
      localStorage.setItem(dismissKey, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  const friendlyName =
    (currentCase.userName || "").trim().split(" ")[0] || t("dashboard.reactivation.fallbackName");

  return (
    <motion.div
      initial={{ opacity: 0, y: -16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}
      className="relative mb-6 overflow-hidden rounded-2xl"
      style={{
        background:
          "linear-gradient(135deg, rgba(16,185,129,0.22) 0%, rgba(34,197,94,0.14) 50%, rgba(59,130,246,0.18) 100%)",
        border: "1px solid rgba(74,222,128,0.45)",
        boxShadow:
          "0 10px 40px rgba(16,185,129,0.25), 0 0 0 1px rgba(255,255,255,0.04) inset",
      }}
      data-testid="banner-reactivation-welcome"
    >
      {/* sparkle confetti accents */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-6 -right-6 text-emerald-300/40"
        animate={{ rotate: [0, 12, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      >
        <Sparkles className="w-28 h-28" />
      </motion.div>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -bottom-4 left-10 text-blue-300/30"
        animate={{ rotate: [0, -10, 0], scale: [1, 1.08, 1] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
      >
        <Sparkles className="w-20 h-20" />
      </motion.div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("dashboard.reactivation.dismissAria")}
        className="absolute top-3 right-3 z-10 p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition"
        data-testid="button-dismiss-welcome"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="relative z-[1] p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.15 }}
          className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center shadow-xl"
          style={{
            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            boxShadow: "0 10px 30px rgba(16,185,129,0.45)",
          }}
        >
          <PartyPopper className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
        </motion.div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-emerald-300/90">
              {t("dashboard.reactivation.label")}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-[10px] font-bold">
              {t("dashboard.reactivation.newPill")}
            </span>
          </div>
          <h3 className="mt-1 font-bold text-white text-lg sm:text-xl">
            {t("dashboard.reactivation.headline", { name: friendlyName })}
          </h3>
          <p className="mt-1 text-sm text-emerald-100/85 leading-relaxed">
            {currentCase.userEmail
              ? t("dashboard.reactivation.bodyWithEmail")
              : t("dashboard.reactivation.bodyNoEmail")}
          </p>

          {/* 100% restored progress visual */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] uppercase tracking-wider text-emerald-200/80 font-semibold">
                {t("dashboard.reactivation.restoration")}
              </span>
              <span className="text-sm font-bold text-emerald-200 tabular-nums">
                {progress}%
              </span>
            </div>
            <div
              className="relative h-2.5 rounded-full overflow-hidden"
              style={{ background: "rgba(255,255,255,0.08)" }}
            >
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${progress}%`,
                  background:
                    "linear-gradient(90deg, #10b981 0%, #34d399 50%, #60a5fa 100%)",
                  boxShadow: "0 0 12px rgba(52,211,153,0.6)",
                }}
              />
              {progress >= 100 && (
                <motion.div
                  initial={{ x: "-100%" }}
                  animate={{ x: "100%" }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-y-0 w-1/3"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)",
                  }}
                />
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-200/70">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>{t("dashboard.reactivation.allOnline")}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function WithdrawalProgressTracker({ currentCase }: { currentCase: Case }) {
  const { t } = useTranslation("portal");
  const stages = [
    { id: 1, label: t("dashboard.tracker.stages.1.label"), icon: "💰", description: t("dashboard.tracker.stages.1.description") },
    { id: 2, label: t("dashboard.tracker.stages.2.label"), icon: "⚙️", description: t("dashboard.tracker.stages.2.description") },
    { id: 3, label: t("dashboard.tracker.stages.3.label"), icon: "🔐", description: t("dashboard.tracker.stages.3.description") },
    { id: 4, label: t("dashboard.tracker.stages.4.label"), icon: "🚀", description: t("dashboard.tracker.stages.4.description") },
    { id: 5, label: t("dashboard.tracker.stages.5.label"), icon: "✅", description: t("dashboard.tracker.stages.5.description") },
    { id: 6, label: t("dashboard.tracker.stages.6.label"), icon: "🔑", description: t("dashboard.tracker.stages.6.description") },
    { id: 7, label: t("dashboard.tracker.stages.7.label"), icon: "📊", description: currentCase?.phraseKeyMergeDeposit ? t("dashboard.tracker.stages.7.descriptionWithAmount", { amount: currentCase.phraseKeyMergeDeposit }) : t("dashboard.tracker.stages.7.descriptionAwaiting") },
    { id: 8, label: t("dashboard.tracker.stages.8.label"), icon: "🏦", description: t("dashboard.tracker.stages.8.description") },
    { id: 9, label: t("dashboard.tracker.stages.9.label"), icon: "⛏️", description: t("dashboard.tracker.stages.9.description") },
    { id: 10, label: t("dashboard.tracker.stages.10.label"), icon: "🔗", description: currentCase?.activityWalletRequirement ? t("dashboard.tracker.stages.10.descriptionWithAmount", { amount: currentCase.activityWalletRequirement }) : t("dashboard.tracker.stages.10.descriptionAwaiting") },
    { id: 11, label: t("dashboard.tracker.stages.11.label"), icon: "🏛️", description: t("dashboard.tracker.stages.11.description") },
    { id: 12, label: t("dashboard.tracker.stages.12.label"), icon: "📋", description: t("dashboard.tracker.stages.12.description") },
    { id: 13, label: t("dashboard.tracker.stages.13.label"), icon: "🎉", description: t("dashboard.tracker.stages.13.description") },
    { id: 14, label: t("dashboard.tracker.stages.14.label"), icon: "⏰", description: t("dashboard.tracker.stages.14.description") },
  ];

  const isWithdrawalMode = getIsWithdrawalMode(currentCase);
  const TOTAL_STAGES = stages.length;
  const parsedStage = parseInt(currentCase?.withdrawalStage || "1", 10);
  const currentStage = Number.isFinite(parsedStage)
    ? Math.min(Math.max(parsedStage, 1), TOTAL_STAGES)
    : 1;
  const progressPercent = isWithdrawalMode
    ? 100
    : Math.min(100, Math.round((currentStage / TOTAL_STAGES) * 100));
  const currentStageData = stages.find(s => s.id === currentStage);
  const currentBlocker = getStageCta(currentStage).blocker;
  const currentColors = blockerColors(currentBlocker);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "rgba(10,20,60,0.55)", border: "1px solid rgba(59,130,246,0.3)", boxShadow: "0 4px 24px rgba(0,0,0,0.25)" }}
      >
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base">{t("dashboard.tracker.title")}</h3>
            <p className="text-blue-300 text-xs">{t("dashboard.tracker.subtitle")}</p>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-5">
          <div>
            <div className="flex justify-between mb-2 text-sm">
              <span className="text-slate-400">{t("dashboard.tracker.progress")}</span>
              <span className="font-bold text-blue-400" data-testid="tracker-progress-percent">{progressPercent}%</span>
            </div>
            <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 1.2, ease: "easeOut" }}
              />
            </div>
          </div>

          {/* Per-stage step row — every one of the 14 stages renders with a
              visual state: completed (emerald check), current (classification
              colour matching whether the stage is blocked on the user, the
              compliance team, or system processing), or upcoming (muted). */}
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}
            role="list"
            aria-label={t("dashboard.tracker.ariaLabel", { stage: currentStage })}
            data-testid="stages-stepper"
          >
            {stages.map((s) => {
              const isCompleted = s.id < currentStage;
              const isCurrent = s.id === currentStage;
              const stageBlocker = getStageCta(s.id).blocker;
              const stageColors = blockerColors(stageBlocker);
              let bg = "bg-slate-700/40";
              let border = "border-white/5";
              let label = t("dashboard.tracker.states.upcoming");
              let pulse = "";
              if (isCompleted) {
                bg = "bg-emerald-500/30";
                border = "border-emerald-400/40";
                label = t("dashboard.tracker.states.completed");
              } else if (isCurrent) {
                if (isWithdrawalMode) {
                  bg = "bg-emerald-600/40";
                  border = "border-emerald-400/50";
                  label = t("dashboard.tracker.states.completed");
                } else {
                  bg = stageColors.badgeBg;
                  border = stageColors.ring;
                  label = blockerLabel(stageBlocker, t);
                  pulse = "animate-pulse";
                }
              }
              return (
                <div
                  key={s.id}
                  role="listitem"
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={t("dashboard.tracker.stageLabel", { stage: s.id, label: s.label, state: label })}
                  title={t("dashboard.tracker.stageTooltip", { stage: s.id, label: s.label, state: label })}
                  data-testid={`stage-step-${s.id}`}
                  data-stage-state={
                    isCompleted ? "completed" : isCurrent ? "current" : "upcoming"
                  }
                  data-stage-blocker={isCurrent ? stageBlocker : undefined}
                  className={`relative h-9 rounded-md flex items-center justify-center border ${bg} ${border} ${pulse}`}
                >
                  {isCompleted ? (
                    <CheckCircle className="w-4 h-4 text-emerald-300" />
                  ) : (
                    <span
                      className={`text-[10px] font-bold ${
                        isCurrent ? stageColors.badgeText : "text-slate-500"
                      }`}
                    >
                      {s.id}
                    </span>
                  )}
                  {isCurrent && (
                    <span
                      className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${stageColors.dot} ring-2 ring-[#0a143c]`}
                      aria-hidden
                    />
                  )}
                </div>
              );
            })}
          </div>
          {/* Legend — keys the four states the row can take so the user
              can decode the colour coding at a glance. */}
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400"
            data-testid="stages-stepper-legend"
          >
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              {t("dashboard.tracker.legend.completed")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              {t("dashboard.tracker.legend.userAction")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              {t("dashboard.tracker.legend.adminAction")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              {t("dashboard.tracker.legend.system")}
            </span>
          </div>

          {isWithdrawalMode ? (
            <div
              className="p-4 rounded-xl flex items-center gap-3 border border-emerald-500/40"
              style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(255,255,255,0.02))" }}
              data-testid="current-stage-highlight"
            >
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                <CheckCircle className="w-6 h-6 text-emerald-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-widest font-semibold text-emerald-300">
                  {t("dashboard.tracker.withdrawalMode.kicker")}
                </p>
                <h4 className="font-bold text-white text-base mt-0.5">
                  {t("dashboard.tracker.withdrawalMode.title")}
                </h4>
                <p className="text-emerald-100/80 text-sm">
                  {t("dashboard.tracker.withdrawalMode.body")}
                </p>
              </div>
            </div>
          ) : currentStageData && (
            <div
              className={`p-4 rounded-xl flex items-center gap-3 border ${currentColors.ring}`}
              style={{ background: `linear-gradient(135deg, ${currentColors.glow}, rgba(255,255,255,0.02))` }}
              data-testid="current-stage-highlight"
              data-stage-blocker={currentBlocker}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-2xl animate-pulse"
                style={{ background: currentColors.glow }}
              >
                {currentStageData.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-[10px] uppercase tracking-widest font-semibold ${currentColors.badgeText}`}>
                    {t("dashboard.tracker.stageOf", { stage: currentStage })}
                  </p>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${currentColors.badgeBg} ${currentColors.badgeText}`}>
                    {blockerLabel(currentBlocker, t)}
                  </span>
                </div>
                <h4 className="font-bold text-white text-base mt-0.5">{currentStageData.label}</h4>
                <p className="text-slate-300 text-sm">{currentStageData.description}</p>
              </div>
            </div>
          )}

          {/* Recommended Paperwork — surfaces document categories likely to be
              requested at the current stage so users can prepare files ahead
              of the admin's formal request. Data sourced from
              STAGE_RECOMMENDED_DOCUMENTS in shared/stageInstructions.ts.
              The card hides itself when no recommendations exist for the
              current stage (so most stages remain visually unchanged). */}
          {(() => {
            const recs = getRecommendedDocumentsForStage(currentStage);
            if (recs.length === 0) return null;
            return (
              <div
                className="p-4 rounded-xl border border-amber-500/30"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(200,169,81,0.12), rgba(255,255,255,0.02))",
                }}
                data-testid="recommended-paperwork-card"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-amber-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-amber-200 text-sm">
                      Recommended paperwork to prepare
                    </h4>
                    <p className="text-amber-100/80 text-xs mt-0.5">
                      At your current stage, compliance often requests the
                      following documents. Preparing them in advance can
                      shorten review time. Your compliance officer will send
                      a formal request when one is needed.
                    </p>
                    <ul
                      className="mt-2 flex flex-wrap gap-2"
                      data-testid="recommended-paperwork-list"
                    >
                      {recs.map((key) => (
                        <li
                          key={key}
                          className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-200 border border-amber-500/30"
                          data-testid={`recommended-paperwork-${key}`}
                        >
                          {DOCUMENT_CATEGORY_LABELS[key] ?? key}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })()}

          {!isWithdrawalMode && currentStage === 7 && currentCase?.phraseKeyMergeDeposit && (
            <div className="p-4 rounded-xl flex items-start gap-3" style={{ background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.3)" }}>
              <div className="w-12 h-12 bg-purple-600/30 rounded-full flex items-center justify-center shrink-0"><Key className="w-6 h-6 text-purple-400" /></div>
              <div>
                <h4 className="font-bold text-purple-300">{t("dashboard.tracker.stage7Notice.title")}</h4>
                <p className="text-purple-400/80 text-sm mt-1">{t("dashboard.tracker.stage7Notice.body")}</p>
                <p className="text-2xl font-bold text-purple-300 mt-2">
                  {currentCase.phraseKeyMergeDeposit} <span className="text-base font-normal">{currentCase.depositAsset?.trim() || "USDT"}</span>
                  <LocalizedAmount value={currentCase.phraseKeyMergeDeposit} estimateClassName="text-sm font-normal text-purple-200/80 ml-2" showEstimate={true} estimateOnly={true} />
                </p>
              </div>
            </div>
          )}

          {!isWithdrawalMode && currentStage === 12 && (
            <div
              className="p-4 rounded-xl flex items-start gap-3"
              style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.35)" }}
              data-testid="stage-12-payout-wallet-confirmation"
            >
              <div className="w-12 h-12 bg-emerald-600/25 rounded-full flex items-center justify-center shrink-0">
                <ShieldCheck className="w-6 h-6 text-emerald-300" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-emerald-200">{t("dashboard.tracker.stage12Notice.title")}</h4>
                <p className="text-emerald-100/80 text-sm mt-1">
                  {t("dashboard.tracker.stage12Notice.body")}
                </p>
                {(currentCase?.payoutWalletAddress || "").trim() ? (
                  <code
                    className="mt-2 block text-emerald-200 text-xs font-mono break-all"
                    data-testid="stage-12-payout-wallet-address"
                  >
                    {currentCase.payoutWalletAddress}
                  </code>
                ) : (
                  <p className="mt-2 text-amber-300 text-xs font-semibold">
                    {t("dashboard.tracker.stage12Notice.awaiting")}
                  </p>
                )}
              </div>
            </div>
          )}

          {!isWithdrawalMode && currentStage === 10 && currentCase?.activityWalletRequirement && (
            <div className="p-4 rounded-xl flex items-start gap-3" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}>
              <div className="w-12 h-12 bg-amber-600/30 rounded-full flex items-center justify-center shrink-0"><Wallet className="w-6 h-6 text-amber-400" /></div>
              <div>
                <h4 className="font-bold text-amber-300">{t("dashboard.tracker.stage10Notice.title")}</h4>
                <p className="text-amber-400/80 text-sm mt-1">{t("dashboard.tracker.stage10Notice.body", { asset: currentCase.depositAsset?.trim() || "USDT" })}</p>
                <p className="text-2xl font-bold text-amber-300 mt-2">
                  {currentCase.activityWalletRequirement} <span className="text-base font-normal">{currentCase.depositAsset?.trim() || "USDT"}</span>
                  <LocalizedAmount value={currentCase.activityWalletRequirement} estimateClassName="text-sm font-normal text-amber-200/80 ml-2" showEstimate={true} estimateOnly={true} />
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function WithdrawalWindowCard({ currentCase }: { currentCase: Case }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { t } = useTranslation("portal");
  const { toast } = useToast();
  const requiredDeposit = formatTokenDepositRequired(
    (currentCase as any).withdrawalAmount ?? null,
    (currentCase as any).tokenDepositRatePer100k ?? null,
  );

  // One-shot toast so the user notices the token-deposit requirement.
  const toastShownRef = useRef(false);
  useEffect(() => {
    if (requiredDeposit && !toastShownRef.current) {
      toastShownRef.current = true;
      toast({
        title: t("withdrawalWindow.toastDepositTitle"),
        description: t("withdrawalWindow.toastDepositDescription", { amount: requiredDeposit }),
      });
    }
  }, [requiredDeposit]); // eslint-disable-line react-hooks/exhaustive-deps

  type PortalWithdrawalRequest = {
    id: number;
    status: 'pending' | 'approved' | 'rejected' | 'cancelled';
    amount: string;
    asset: string;
    createdAt: string;
  };

  const { data: requests = [] } = useQuery<PortalWithdrawalRequest[]>({
    queryKey: ["/api/cases", currentCase.id, "withdrawal-requests"],
    queryFn: async () => {
      const token = getPortalToken();
      const res = await fetch(`/api/cases/${currentCase.id}/withdrawal-requests`, {
        headers: { "x-portal-session-token": token },
      });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });
  const pending = requests.find((r) => r.status === 'pending');

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-6 p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center gap-4"
        style={{
          background:
            "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(217,119,6,0.10))",
          border: "1px solid rgba(245,158,11,0.45)",
          boxShadow: "0 4px 24px rgba(245,158,11,0.15)",
        }}
        data-testid="card-withdrawal-window"
      >
        <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">
          <Wallet className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-amber-200 text-base sm:text-lg">
            {t("withdrawalWindow.title")}
          </h3>
          <p className="text-sm text-amber-100/80 mt-0.5">
            {t("withdrawalWindow.description")}
          </p>
          {requiredDeposit && (
            <p className="text-xs text-amber-300 mt-1 font-semibold">
              {t("withdrawalWindow.requiredDeposit", { amount: requiredDeposit })}
            </p>
          )}
        </div>
        {pending ? (
          <div
            className="shrink-0 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-200 text-xs font-semibold"
            data-testid="chip-withdrawal-request-pending"
          >
            {t("withdrawalWindow.pendingChip")}
            <div className="text-[10px] font-normal text-amber-100/70 mt-0.5">
              {pending.amount} {pending.asset}
            </div>
          </div>
        ) : (
          <Button
            onClick={() => setOpen(true)}
            className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold shrink-0"
            data-testid="button-open-withdrawal-request"
          >
            {t("withdrawalWindow.cta")}
          </Button>
        )}
      </motion.div>
      <WithdrawalRequestDialog
        open={open}
        onOpenChange={setOpen}
        currentCase={currentCase}
        onSubmitted={() => {
          queryClient.invalidateQueries({
            queryKey: ["/api/cases", currentCase.id, "withdrawal-requests"],
          });
        }}
      />
    </>
  );
}

type PortalWithdrawalRequestFull = {
  id: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  amount: string;
  asset: string;
  network: string;
  withdrawalType: 'full' | 'partial';
  requestedWalletAddress: string;
  requestedWalletAsset: string | null;
  requestedWalletNetwork: string | null;
  preferredPayoutDate: string | null;
  confirmationChannel: 'email' | 'sms' | 'both';
  userNote: string | null;
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

function WithdrawalRequestsHistoryCard({ currentCase }: { currentCase: Case }) {
  const { t } = useTranslation("portal");
  const { formatDateTime } = useFormat();

  const { data: requests = [] } = useQuery<PortalWithdrawalRequestFull[]>({
    queryKey: ["/api/cases", currentCase.id, "withdrawal-requests"],
    queryFn: async () => {
      const token = getPortalToken();
      const res = await fetch(`/api/cases/${currentCase.id}/withdrawal-requests`, {
        headers: { "x-portal-session-token": token },
      });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  // One-time per-case+request+status transition banner — fires only the
  // first time the user sees a resolution (approved/rejected/cancelled)
  // on this device. Mirrors stageHistory / payoutWalletHistory: purely
  // client-side, no schema change.
  const [transition, setTransition] = useState<
    | { requestId: number; status: 'approved' | 'rejected' | 'cancelled' }
    | null
  >(null);
  useEffect(() => {
    if (!currentCase.id) return;
    for (const r of requests) {
      const { previousStatus, isNew } = recordWithdrawalRequestObservation(
        currentCase.id,
        r.id,
        r.status,
        r.reviewedAt,
      );
      if (
        isNew &&
        previousStatus &&
        previousStatus !== r.status &&
        (r.status === 'approved' || r.status === 'rejected' || r.status === 'cancelled') &&
        !hasSeenWithdrawalRequestBanner(currentCase.id, r.id, r.status)
      ) {
        setTransition({ requestId: r.id, status: r.status });
        break;
      }
    }
  }, [currentCase.id, requests]);

  const dismissTransition = () => {
    if (transition && currentCase.id) {
      markWithdrawalRequestBannerSeen(currentCase.id, transition.requestId, transition.status);
    }
    setTransition(null);
  };

  if (!requests.length) return null;

  const recent = [...requests]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const transitionPalette: Record<'approved' | 'rejected' | 'cancelled', { bg: string; ring: string; label: string }> = {
    approved: {
      bg: "linear-gradient(135deg, rgba(16,185,129,0.18), rgba(16,185,129,0.06))",
      ring: "border-emerald-500/40",
      label: t("withdrawalWindow.transition.approved"),
    },
    rejected: {
      bg: "linear-gradient(135deg, rgba(244,63,94,0.18), rgba(244,63,94,0.06))",
      ring: "border-red-500/40",
      label: t("withdrawalWindow.transition.rejected"),
    },
    cancelled: {
      bg: "linear-gradient(135deg, rgba(100,116,139,0.18), rgba(100,116,139,0.06))",
      ring: "border-slate-500/40",
      label: t("withdrawalWindow.transition.cancelled"),
    },
  };

  const statusStyles: Record<PortalWithdrawalRequestFull['status'], { pill: string; label: string }> = {
    pending: {
      pill: "bg-amber-500/20 text-amber-300 border border-amber-400/40",
      label: t("withdrawalRequest.history.status.pending"),
    },
    approved: {
      pill: "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40",
      label: t("withdrawalRequest.history.status.approved"),
    },
    rejected: {
      pill: "bg-red-500/20 text-red-300 border border-red-400/40",
      label: t("withdrawalRequest.history.status.rejected"),
    },
    cancelled: {
      pill: "bg-slate-500/20 text-slate-300 border border-slate-400/30",
      label: t("withdrawalRequest.history.status.cancelled"),
    },
  };

  const formatTail = (addr: string) =>
    addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;

  return (
    <>
      <AnimatePresence>
        {transition && (
          <motion.div
            key={`wr-transition-${transition.requestId}-${transition.status}`}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            className={`mb-4 rounded-2xl p-4 sm:p-5 flex items-start gap-3 border ${transitionPalette[transition.status].ring}`}
            style={{ background: transitionPalette[transition.status].bg }}
            data-testid={`banner-withdrawal-request-${transition.status}`}
          >
            <Wallet className="w-5 h-5 text-amber-300 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-widest font-semibold text-amber-200/90">
                {t("withdrawalWindow.transition.label")}
              </p>
              <h3 className="text-white font-bold text-sm sm:text-base mt-0.5">
                {transitionPalette[transition.status].label}
              </h3>
            </div>
            <button
              type="button"
              onClick={dismissTransition}
              aria-label={t("withdrawalWindow.transition.dismiss")}
              className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 shrink-0"
              data-testid="button-dismiss-withdrawal-request-banner"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-2xl overflow-hidden glass-dark-premium card-depth"
        style={{
          border: "1px solid rgba(148,163,184,0.25)",
        }}
        data-testid="card-withdrawal-requests-history"
      >
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center gap-3">
          <div className="gradient-icon w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600">
            <History className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-white text-sm sm:text-base">
              {t("withdrawalRequest.history.title")}
            </h3>
            <p className="text-slate-400 text-xs mt-0.5">
              {t("withdrawalRequest.history.subtitle")}
            </p>
          </div>
        </div>
        <ul className="divide-y divide-white/5">
          {recent.map((r) => {
            const styles = statusStyles[r.status];
            const showAdminNote = (r.status === 'rejected' || r.status === 'approved') && r.adminNote?.trim();
            const walletAsset = r.requestedWalletAsset?.trim() || r.asset;
            const walletNetwork = r.requestedWalletNetwork?.trim() || r.network;
            return (
              <li
                key={r.id}
                className="p-4 sm:p-5"
                data-testid={`row-withdrawal-request-${r.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles.pill}`}
                        data-testid={`status-withdrawal-request-${r.id}`}
                      >
                        {styles.label}
                      </span>
                      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                        {r.withdrawalType === 'full'
                          ? t("withdrawalRequest.fields.typeFull")
                          : t("withdrawalRequest.fields.typePartial")}
                      </span>
                    </div>
                    <div className="mt-1.5 text-white font-bold text-base sm:text-lg font-mono">
                      {r.amount} <span className="text-sm font-normal text-slate-300">{r.asset}</span>
                      <span className="text-xs font-normal text-slate-500"> · {r.network}</span>
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-slate-400">
                    <div>
                      {t("withdrawalRequest.history.submittedOn")}{" "}
                      <span className="text-slate-300">{formatDateTime(r.createdAt)}</span>
                    </div>
                    {r.reviewedAt && (
                      <div className="mt-0.5">
                        {t("withdrawalRequest.history.reviewedOn")}{" "}
                        <span className="text-slate-300">{formatDateTime(r.reviewedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 rounded-lg bg-slate-950/60 border border-white/10 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                    {t("withdrawalRequest.history.destinationWallet")}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                    <code
                      className="text-amber-200 text-xs sm:text-sm font-mono break-all"
                      data-testid={`wallet-withdrawal-request-${r.id}`}
                    >
                      {formatTail(r.requestedWalletAddress)}
                    </code>
                    <span className="text-[10px] text-slate-500">
                      {walletAsset} · {walletNetwork}
                    </span>
                  </div>
                </div>
                {showAdminNote && (
                  <div
                    className={`mt-2 rounded-lg px-3 py-2 border text-xs ${
                      r.status === 'rejected'
                        ? "bg-red-950/30 border-red-500/30 text-red-200"
                        : "bg-emerald-950/30 border-emerald-500/30 text-emerald-200"
                    }`}
                    data-testid={`admin-note-withdrawal-request-${r.id}`}
                  >
                    <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">
                      {t("withdrawalRequest.history.officerNote")}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap">{r.adminNote}</p>
                  </div>
                )}
                {r.userNote?.trim() && (
                  <div className="mt-2 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-300">
                      {t("withdrawalRequest.history.yourNote")}:
                    </span>{" "}
                    <span className="whitespace-pre-wrap">{r.userNote}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </motion.div>
    </>
  );
}

function PayoutWalletCard({ currentCase }: { currentCase: Case }) {
  const { t } = useTranslation("portal");
  const { formatDateTime } = useFormat();
  const { toast } = useToast();
  const address = (currentCase.payoutWalletAddress || "").trim();
  const asset = (currentCase.payoutWalletAsset || "").trim();
  const network = (currentCase.payoutWalletNetwork || "").trim();
  // payoutWalletNote is INTERNAL — admin-only. Intentionally not read
  // here so it can never leak into the portal card.
  const verifiedAt = currentCase.payoutWalletVerifiedAt || null;
  const verifiedBy = (currentCase.payoutWalletVerifiedBy || "").trim();

  // Mirror stageHistory: record an observation each time we render so we
  // can drive a one-time per-change "wallet updated" banner without any
  // schema/backend change. Observation runs even when address is empty
  // — the helper short-circuits on the first empty observation so we
  // don't seed history for cases that never had a wallet.
  const [showChangeBanner, setShowChangeBanner] = useState(false);
  const [bannerObservedAt, setBannerObservedAt] = useState<string | null>(null);
  // Skip the very first effect run for this case so opening the
  // dashboard for an existing wallet doesn't masquerade as a "wallet
  // updated" event. Subsequent runs (real in-session changes, including
  // empty → verified mid-session) still fire normally.
  const initialPayoutWalletRunRef = useRef(true);
  useEffect(() => {
    if (!currentCase.id) return;
    const { isNew } = recordPayoutWalletObservation(
      currentCase.id,
      {
        address: address || null,
        asset: asset || null,
        network: network || null,
        note: null,
        verifiedAt: verifiedAt,
      },
      verifiedAt,
    );
    if (initialPayoutWalletRunRef.current) {
      initialPayoutWalletRunRef.current = false;
      return;
    }
    // Trigger the reconfirm signal on any in-session wallet change that
    // resolves to a verified address — including a first-set that
    // happens while the user is on this device (empty → verified).
    if (isNew && address) {
      // Find the observation timestamp we just wrote so we can per-event
      // mark it seen and never re-show after dismissal.
      const stamp = new Date().toISOString();
      if (!hasSeenPayoutWalletBanner(currentCase.id, stamp)) {
        setBannerObservedAt(stamp);
        setShowChangeBanner(true);
        // Also surface a transient toast — mirrors the existing per-stage
        // session-change pattern so the user is asked to reconfirm before
        // continuing on Letter / Declaration / final-confirmation surfaces.
        toast({
          title: t("dashboard.payoutWallet.toastUpdatedTitle"),
          description: t("dashboard.payoutWallet.toastUpdatedDesc"),
        });
      }
    }
  }, [currentCase.id, address, asset, network, verifiedAt]);

  const dismissChangeBanner = () => {
    if (currentCase.id && bannerObservedAt) {
      markPayoutWalletBannerSeen(currentCase.id, bannerObservedAt);
    }
    setShowChangeBanner(false);
  };

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast({ title: t("dashboard.payoutWallet.toastCopiedTitle"), description: t("dashboard.payoutWallet.toastCopiedDesc") });
    } catch {
      toast({ variant: "destructive", title: t("dashboard.payoutWallet.toastFailTitle"), description: t("dashboard.payoutWallet.toastFailDesc") });
    }
  };

  // Awaiting state — admin hasn't designated the wallet yet. We still
  // render a card so the user understands this is a step that happens.
  if (!address) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-2xl overflow-hidden glass-dark-premium"
        style={{ border: "1px solid rgba(148,163,184,0.2)" }}
        data-testid="payout-wallet-card-empty"
      >
        <div className="p-4 sm:p-5 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-700/40 border border-white/10 flex items-center justify-center shrink-0">
            <Wallet className="w-6 h-6 text-slate-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-700/60 text-slate-300 uppercase tracking-wide">
                {t("dashboard.payoutWallet.awaitingPill")}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                {t("dashboard.payoutWallet.label")}
              </span>
            </div>
            <h3 className="text-white font-bold text-base mt-1.5">
              {t("dashboard.payoutWallet.awaitingTitle")}
            </h3>
            <p className="text-slate-400 text-xs sm:text-sm mt-1 leading-relaxed">
              {t("dashboard.payoutWallet.awaitingBody")}
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  const verifiedLabel = verifiedAt
    ? formatDateTime(verifiedAt)
    : null;

  return (
    <>
      <AnimatePresence>
        {showChangeBanner && (
          <motion.div
            key="payout-wallet-change-banner"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            className="mb-4 rounded-2xl overflow-hidden border border-emerald-400/40"
            style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.18), rgba(255,255,255,0.03))" }}
            data-testid="banner-payout-wallet-changed"
          >
            <div className="p-4 sm:p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0 shadow-lg">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-widest font-semibold text-emerald-300">
                  {t("dashboard.payoutWallet.updatedLabel")}
                </p>
                <h3 className="text-white font-bold text-base mt-0.5">
                  {t("dashboard.payoutWallet.updatedTitle")}
                </h3>
                <p className="text-emerald-100/80 text-xs mt-1">
                  {t("dashboard.payoutWallet.updatedBody")}
                </p>
              </div>
              <button
                type="button"
                onClick={dismissChangeBanner}
                aria-label={t("dashboard.payoutWallet.dismissAria")}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 shrink-0"
                data-testid="button-dismiss-payout-wallet-banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-2xl overflow-hidden glass-dark-premium card-depth"
        style={{
          border: "1px solid rgba(16,185,129,0.35)",
          boxShadow: "0 4px 28px rgba(16,185,129,0.18)",
        }}
        data-testid="payout-wallet-card"
      >
        <div className="p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <div
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0 shadow-lg"
              style={{ boxShadow: "0 6px 18px rgba(16,185,129,0.4)" }}
            >
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 uppercase tracking-wide">
                  {t("dashboard.payoutWallet.verifiedPill")}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                  {t("dashboard.payoutWallet.label2")}
                </span>
              </div>
              <h3 className="text-white font-bold text-base sm:text-lg mt-1">
                {t("dashboard.payoutWallet.verifiedTitle")}
              </h3>
              <p className="text-slate-300/85 text-xs sm:text-sm mt-0.5">
                <Trans i18nKey="dashboard.payoutWallet.verifiedBody" ns="portal" components={[<span key="0" className="font-semibold" />]} />
              </p>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">{t("dashboard.payoutWallet.asset")}</div>
                  <div className="text-white font-semibold text-sm mt-0.5" data-testid="text-payout-wallet-asset">
                    {asset || "—"}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">{t("dashboard.payoutWallet.network")}</div>
                  <div className="text-white font-semibold text-sm mt-0.5" data-testid="text-payout-wallet-network">
                    {network || "—"}
                  </div>
                </div>
              </div>

              <div className="mt-2 rounded-lg bg-slate-950/60 border border-emerald-500/20 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">{t("dashboard.payoutWallet.walletAddress")}</div>
                <div className="flex items-start gap-2 mt-1">
                  <code
                    className="text-emerald-200 text-xs sm:text-sm font-mono break-all flex-1"
                    data-testid="text-payout-wallet-address"
                  >
                    {address}
                  </code>
                  <Button
                    type="button"
                    onClick={copyAddress}
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-emerald-300 hover:bg-emerald-500/10 shrink-0"
                    data-testid="button-copy-payout-wallet"
                  >
                    {t("dashboard.payoutWallet.copy")}
                  </Button>
                </div>
              </div>

              {(verifiedLabel || verifiedBy) && (
                <div className="mt-2 text-[11px] text-slate-400">
                  {t("dashboard.payoutWallet.verified")}
                  {verifiedBy ? (
                    <> {t("dashboard.payoutWallet.verifiedBy")} <span className="text-slate-200 font-semibold">{verifiedBy}</span></>
                  ) : null}
                  {verifiedLabel ? (
                    <> {t("dashboard.payoutWallet.verifiedOn")} <span className="text-slate-200 font-mono">{verifiedLabel}</span></>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}

function StampDutyReminderCard({ currentCase }: { currentCase: Case }) {
  const { t } = useTranslation("portal");
  const { setViewState } = usePortal();
  const KNOWN_STATUSES: ReadonlyArray<StampDutyStatus> = [
    "awaiting_upload",
    "awaiting_admin_approval",
    "approved",
    "rejected",
  ];
  const rawStatus = currentCase.stampDutyStatus ?? "awaiting_upload";
  const status: StampDutyStatus = KNOWN_STATUSES.includes(rawStatus as StampDutyStatus)
    ? (rawStatus as StampDutyStatus)
    : "awaiting_upload";
  const amount = (currentCase.stampDutyAmountUsdt || "").trim();

  // Mirror payoutWalletHistory: observe each render so we can flag
  // brand-new transitions (e.g. admin just rejected a receipt) with a
  // subtle "updated" pill until the user has seen this status once.
  const [isFreshTransition, setIsFreshTransition] = useState(false);
  useEffect(() => {
    if (!currentCase.id) return;
    const { previous, isNew } = recordStampDutyObservation(
      currentCase.id,
      {
        enabled: currentCase.stampDutyEnabled === true,
        status,
        amount: amount || null,
        approvedAt: currentCase.stampDutyApprovedAt || null,
      },
      currentCase.stampDutyApprovedAt,
    );
    if (
      isNew &&
      previous &&
      previous.status !== status &&
      !hasSeenStampDutyBanner(currentCase.id, status)
    ) {
      setIsFreshTransition(true);
    }
  }, [currentCase.id, currentCase.stampDutyEnabled, status, amount, currentCase.stampDutyApprovedAt]);

  const dismissFreshFlag = () => {
    if (currentCase.id) markStampDutyBannerSeen(currentCase.id, status);
    setIsFreshTransition(false);
  };

  const isWithdrawalMode = getIsWithdrawalMode(currentCase);
  if (isWithdrawalMode) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-slate-600/30 bg-slate-800/30 p-4 flex items-center gap-3"
        data-testid="stamp-duty-withdrawal-done"
      >
        <div className="w-9 h-9 rounded-lg bg-slate-600/40 border border-slate-500/30 flex items-center justify-center shrink-0">
          <CheckCircle className="w-4 h-4 text-slate-400" />
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            {t("dashboard.stampDuty.doneKicker")}
          </p>
          <p className="text-sm text-slate-300 font-medium">
            {t("dashboard.stampDuty.doneTitle")}
          </p>
        </div>
      </motion.div>
    );
  }

  const statusPalette: Record<
    StampDutyStatus,
    { pill: string; pillLabel: string; bodyKey: string; cta: string }
  > = {
    awaiting_upload: {
      pill: "bg-amber-500/20 text-amber-300 border border-amber-400/40",
      pillLabel: t("dashboard.stampDuty.statusAwaitingUpload"),
      bodyKey: "dashboard.stampDuty.bodyAwaitingUpload",
      cta: t("dashboard.stampDuty.ctaUpload"),
    },
    awaiting_admin_approval: {
      pill: "bg-blue-500/20 text-blue-300 border border-blue-400/40",
      pillLabel: t("dashboard.stampDuty.statusAwaitingApproval"),
      bodyKey: "dashboard.stampDuty.bodyAwaitingApproval",
      cta: t("dashboard.stampDuty.ctaView"),
    },
    rejected: {
      pill: "bg-red-500/20 text-red-300 border border-red-400/40",
      pillLabel: t("dashboard.stampDuty.statusRejected"),
      bodyKey: "dashboard.stampDuty.bodyRejected",
      cta: t("dashboard.stampDuty.ctaResubmit"),
    },
    approved: {
      // Card is hidden when approved; this entry is unused but kept for
      // type completeness.
      pill: "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40",
      pillLabel: "",
      bodyKey: "",
      cta: "",
    },
  };

  const palette = statusPalette[status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 rounded-2xl overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, rgba(245,158,11,0.14), rgba(217,119,6,0.08))",
        border: "1px solid rgba(245,158,11,0.4)",
        boxShadow: "0 4px 24px rgba(245,158,11,0.15)",
      }}
      data-testid="card-stamp-duty-reminder"
      data-stamp-duty-status={status}
    >
      <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0 shadow-lg">
          <Stamp className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${palette.pill}`}
              data-testid="badge-stamp-duty-status"
            >
              {palette.pillLabel}
            </span>
            {isFreshTransition && (
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/30 text-amber-100 uppercase tracking-wide"
                data-testid="badge-stamp-duty-updated"
              >
                {t("dashboard.stampDuty.updated")}
              </span>
            )}
          </div>
          <h3 className="font-bold text-amber-100 text-base sm:text-lg mt-1.5">
            {t("dashboard.stampDuty.title")}
          </h3>
          <p className="text-amber-100/80 text-xs sm:text-sm mt-1">
            {t(palette.bodyKey)}
          </p>
          {amount && (
            <div
              className="mt-3 inline-flex items-baseline gap-1.5 rounded-lg bg-slate-950/40 border border-amber-400/30 px-3 py-1.5"
              data-testid="text-stamp-duty-amount"
            >
              <span className="text-[10px] uppercase tracking-widest text-amber-200/80 font-semibold">
                {t("dashboard.stampDuty.amountLabel")}
              </span>
              <span className="text-amber-100 font-mono font-bold text-base">
                {amount}
              </span>
              <span className="text-amber-200/80 text-xs">USDT</span>
            </div>
          )}
        </div>
        <Button
          onClick={() => {
            dismissFreshFlag();
            setViewState("sealed");
          }}
          className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold shrink-0 w-full sm:w-auto"
          data-testid="button-stamp-duty-open"
        >
          {palette.cta}
          <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </div>
    </motion.div>
  );
}

function StageCtaCard({ currentCase }: { currentCase: Case }) {
  const { t: tStages } = useTranslation("stages");
  const { t } = useTranslation("portal");
  const { setViewState } = usePortal();
  const isWithdrawalMode = getIsWithdrawalMode(currentCase);
  const parsed = parseInt(currentCase.withdrawalStage || "1", 10);
  const stage = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 14) : 1;
  const cta = getStageCta(stage);
  const colors = blockerColors(cta.blocker);
  const title = getStageTitle(stage);
  const whatsNext = getStageWhatsNext(stage);
  const instruction = getStageInstructionLocalized(stage, (_ns, key) => tStages(key));

  // Stage 7 and Stage 10 carry case-specific amounts that the user must
  // actually act on. Surface them directly inside the CTA card so the user
  // never has to scroll down to the tracker notices to find the number.
  const dynamicAmount: { label: string; value: string; amount: string } | null = (() => {
    const asset = currentCase.depositAsset?.trim() || "USDT";
    if (stage === 7 && currentCase.phraseKeyMergeDeposit) {
      return {
        label: t("dashboard.stageCta.stage7AmountLabel"),
        value: `${currentCase.phraseKeyMergeDeposit} ${asset}`,
        amount: currentCase.phraseKeyMergeDeposit,
      };
    }
    if (stage === 10 && currentCase.activityWalletRequirement) {
      return {
        label: t("dashboard.stageCta.stage10AmountLabel"),
        value: `${currentCase.activityWalletRequirement} ${asset}`,
        amount: currentCase.activityWalletRequirement,
      };
    }
    return null;
  })();
  const dynamicHeadline =
    stage === 7 && currentCase.phraseKeyMergeDeposit
      ? t("dashboard.stageCta.stage7Headline", { amount: currentCase.phraseKeyMergeDeposit, asset: currentCase.depositAsset?.trim() || "USDT" })
      : stage === 10 && currentCase.activityWalletRequirement
        ? t("dashboard.stageCta.stage10Headline", { amount: currentCase.activityWalletRequirement, asset: currentCase.depositAsset?.trim() || "USDT" })
        : t(cta.shortHeadlineKey);
  const blockerIcon = (b: StageBlocker) => {
    if (b === "user_action") return <UserCheck className="w-5 h-5 text-white" />;
    if (b === "admin_action") return <Hourglass className="w-5 h-5 text-white" />;
    return <Cog className="w-5 h-5 text-white animate-spin-slow" />;
  };

  // One-time stage transition banner — fires only the first time the user
  // sees a new stage on this device (per-case+stage localStorage flag).
  const [showTransition, setShowTransition] = useState(false);
  const [previousStage, setPreviousStage] = useState<number | null>(null);
  useEffect(() => {
    if (!currentCase.id) return;
    const { previousStage: prev, isNew } = recordStageObservation(
      currentCase.id,
      stage,
      currentCase.maxStageReached
    );
    if (isNew && prev !== null && prev !== stage && !hasSeenStageBanner(currentCase.id, stage)) {
      setPreviousStage(prev);
      setShowTransition(true);
    }
  }, [currentCase.id, stage]);

  const dismissTransition = () => {
    if (currentCase.id) markStageBannerSeen(currentCase.id, stage);
    setShowTransition(false);
  };

  // Withdrawal-activation transition banner — fires once per status change
  // (per case + status), mirroring the stage and payout-wallet patterns so
  // the user has a clear "address received → code verified → receipt
  // uploaded → approved" trail without any backend schema change.
  const activationStatus = currentCase.withdrawalActivationStatus || null;
  const [showActivationBanner, setShowActivationBanner] = useState(false);
  const [previousActivationStatus, setPreviousActivationStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!currentCase.id || !activationStatus) return;
    const { previous, isNew } = recordActivationObservation(
      currentCase.id,
      {
        status: activationStatus,
        approvedAt: currentCase.withdrawalActivationApprovedAt || null,
      },
      currentCase.withdrawalActivationApprovedAt,
    );
    if (
      isNew &&
      previous !== null &&
      previous.status !== activationStatus &&
      !hasSeenActivationBanner(currentCase.id, activationStatus)
    ) {
      setPreviousActivationStatus(previous.status);
      setShowActivationBanner(true);
    }
  }, [currentCase.id, activationStatus, currentCase.withdrawalActivationApprovedAt]);
  const dismissActivationBanner = () => {
    if (currentCase.id && activationStatus) {
      markActivationBannerSeen(currentCase.id, activationStatus);
    }
    setShowActivationBanner(false);
  };

  const isUserBlocked = cta.blocker === "user_action";

  return (
    <>
      <AnimatePresence>
        {showTransition && previousStage !== null && (
          <motion.div
            key={`transition-${stage}`}
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            className="mb-4 rounded-2xl overflow-hidden relative"
            style={{
              background: `linear-gradient(135deg, ${colors.glow}, rgba(255,255,255,0.04))`,
              border: `1px solid`,
            }}
            data-testid={`stage-transition-banner-${stage}`}
          >
            <div className={`absolute inset-0 pointer-events-none border ${colors.ring} rounded-2xl`} />
            <div className="relative p-4 sm:p-5 flex items-center gap-4">
              <motion.div
                initial={{ scale: 0, rotate: -90 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 240, damping: 16 }}
                className={`w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${colors.stripe} shadow-lg shrink-0`}
              >
                <ArrowRight className="w-6 h-6 text-white" />
              </motion.div>
              <div className="flex-1 min-w-0">
                <p className={`text-[10px] uppercase tracking-widest font-semibold ${colors.badgeText}`}>
                  {t("dashboard.stageCta.advanced", { from: previousStage, to: stage })}
                </p>
                <h3 className="text-white font-bold text-base sm:text-lg leading-tight mt-0.5 truncate">
                  {title}
                </h3>
                <p className="text-slate-300/85 text-xs sm:text-sm mt-0.5">
                  {instruction.summary}
                </p>
              </div>
              <button
                type="button"
                onClick={dismissTransition}
                aria-label={t("dashboard.stageCta.dismissAria")}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 shrink-0"
                data-testid={`button-dismiss-stage-transition-${stage}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
        {showActivationBanner && previousActivationStatus !== null && activationStatus && (
          <motion.div
            key={`activation-transition-${activationStatus}`}
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            className="mb-4 rounded-2xl overflow-hidden relative border border-emerald-400/40 bg-gradient-to-br from-emerald-500/15 to-emerald-700/10"
            data-testid={`activation-transition-banner-${activationStatus}`}
          >
            <div className="relative p-4 sm:p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shrink-0">
                <ArrowRight className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-widest font-semibold text-emerald-200">
                  {t("dashboard.activationBanner.kicker")}
                </p>
                <h3 className="text-white font-bold text-base sm:text-lg leading-tight mt-0.5 truncate">
                  {t("dashboard.activationBanner.transition", {
                    from: t(`dashboard.activationBanner.status.${previousActivationStatus}`, { defaultValue: t('dashboard.activationBanner.status.unknown') }),
                    to: t(`dashboard.activationBanner.status.${activationStatus}`, { defaultValue: t('dashboard.activationBanner.status.unknown') }),
                  })}
                </h3>
                <p className="text-slate-300/85 text-xs sm:text-sm mt-0.5">
                  {t("dashboard.activationBanner.body")}
                </p>
              </div>
              <button
                type="button"
                onClick={dismissActivationBanner}
                aria-label={t("dashboard.activationBanner.dismiss")}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 shrink-0"
                data-testid={`button-dismiss-activation-transition-${activationStatus}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isWithdrawalMode ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center gap-4"
          style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(34,197,94,0.10))",
            border: "1px solid rgba(74,222,128,0.40)",
            boxShadow: "0 4px 28px rgba(16,185,129,0.18)",
          }}
          data-testid="stage-cta-card-withdrawal"
        >
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl flex items-center justify-center shrink-0 shadow-lg">
            <PartyPopper className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-emerald-300">
              {t("dashboard.stageCta.withdrawalMode.kicker")}
            </p>
            <h3 className="text-white font-bold text-base sm:text-lg mt-0.5">
              {t("dashboard.stageCta.withdrawalMode.title")}
            </h3>
            <p className="text-emerald-100/80 text-sm mt-1">
              {t("dashboard.stageCta.withdrawalMode.body")}
            </p>
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 rounded-2xl overflow-hidden glass-dark-premium card-depth"
          style={{ border: `1px solid`, boxShadow: `0 4px 28px ${colors.glow}` }}
          data-testid={`stage-cta-card-${stage}`}
        >
          <div className={`absolute inset-0 pointer-events-none border ${colors.ring} rounded-2xl`} aria-hidden />
          <div className="relative p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div
                className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center bg-gradient-to-br ${colors.stripe} shrink-0 shadow-lg`}
                style={{ boxShadow: `0 6px 18px ${colors.glow}` }}
              >
                {blockerIcon(cta.blocker)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${colors.badgeBg} ${colors.badgeText}`}>
                    {blockerLabel(cta.blocker, t)}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                    {t("dashboard.stageCta.stageOf", { stage })}
                  </span>
                </div>
                <h3 className="text-white font-bold text-base sm:text-lg mt-1">{title}</h3>
                <p className="text-slate-300/85 text-sm mt-0.5" data-testid="stage-cta-headline">
                  {dynamicHeadline}
                </p>
                {dynamicAmount && (
                  <div
                    className={`mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${colors.badgeBg} ${colors.ring} border`}
                    data-testid="stage-cta-amount"
                  >
                    <span className={`text-[10px] uppercase tracking-widest font-semibold ${colors.badgeText}`}>
                      {dynamicAmount.label}
                    </span>
                    <span className="text-white font-bold text-sm">
                      {dynamicAmount.value}
                      <LocalizedAmount value={dynamicAmount.amount} estimateClassName="text-xs font-normal text-white/70 ml-1" estimateOnly={true} />
                    </span>
                  </div>
                )}
                <p className="text-slate-400 text-xs sm:text-sm mt-2 leading-relaxed">
                  {whatsNext}
                </p>
              </div>
              <Button
                size="lg"
                onClick={() => setViewState(cta.ctaView)}
                className={`rounded-xl text-white shadow-lg w-full sm:w-auto shrink-0 ${
                  isUserBlocked
                    ? "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
                    : "bg-white/10 hover:bg-white/20 border border-white/15"
                }`}
                data-testid={`button-stage-cta-${stage}`}
              >
                {t(cta.ctaLabelKey)}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>

            {instruction.whatToDo && instruction.whatToDo.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
                  {t("dashboard.stageCta.whatYouCanDo")}
                </p>
                <ul className="space-y-1.5">
                  {instruction.whatToDo.slice(0, 3).map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs sm:text-sm text-slate-300">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full ${colors.dot} shrink-0`} />
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </>
  );
}

function ValidationDepositCard({ currentCase }: { currentCase: Case }) {
  const [copied, setCopied] = useState(false);
  const { setViewState } = usePortal();

  const address = currentCase.validationDepositWalletAddress ?? '';
  const asset = (currentCase.validationDepositWalletAsset ?? 'USDT').trim();
  const network = (currentCase.validationDepositWalletNetwork ?? '').trim();
  const amount = (currentCase.validationDepositAmount ?? '550').trim();
  const confirmed = currentCase.validationDepositConfirmed;

  const copyAddress = () => {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isWithdrawalMode = getIsWithdrawalMode(currentCase);
  if (isWithdrawalMode && !confirmed) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-slate-600/30 bg-slate-800/30 p-4 flex items-center gap-3"
        data-testid="validation-deposit-withdrawal-done"
      >
        <div className="w-9 h-9 rounded-lg bg-slate-600/40 border border-slate-500/30 flex items-center justify-center shrink-0">
          <CheckCircle className="w-4 h-4 text-slate-400" />
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Step Completed</p>
          <p className="text-sm text-slate-300 font-medium">Validation Deposit — Cleared</p>
        </div>
      </motion.div>
    );
  }

  if (confirmed) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-emerald-700/40 bg-emerald-950/20 p-5"
      >
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
            Validation Deposit Received
          </span>
        </div>
        <p className="text-sm text-emerald-200/80 leading-relaxed">
          Your {amount} {asset} validation deposit has been confirmed by our compliance team.
          Your case is now proceeding to the final disbursement stage.
        </p>
        {currentCase.validationDepositConfirmedBy && (
          <p className="text-xs text-emerald-600 mt-2">
            Confirmed by {currentCase.validationDepositConfirmedBy}
            {currentCase.validationDepositConfirmedAt &&
              ` · ${new Date(currentCase.validationDepositConfirmedAt).toLocaleDateString()}`}
          </p>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-amber-600/40 bg-amber-950/20 p-5 space-y-4"
    >
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
            Action Required — Validation Deposit
          </span>
        </div>
        <p className="text-sm text-amber-100/90 leading-relaxed">
          To proceed to the final disbursement stage, a one-time validation deposit of{' '}
          <span className="font-bold text-amber-200">{amount} USDT</span>{' '}
          (or equivalent in any supported coin) is required. Transfer the exact amount
          to the wallet designated below, then notify your Case Support Officer.
        </p>
      </div>

      {/* Wallet details card */}
      <div className="rounded-xl bg-slate-900/60 border border-amber-700/30 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
            Amount Required
          </span>
          <span className="font-bold text-amber-200 font-mono text-sm">
            {amount} {asset}
          </span>
        </div>
        {network && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
              Network
            </span>
            <span className="text-slate-200 text-sm font-medium">{network}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
            Asset / Coin
          </span>
          <span className="text-slate-200 text-sm font-medium">{asset}</span>
        </div>
        <div className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
            Wallet Address
          </span>
          <div className="flex items-center gap-2 bg-slate-800/70 rounded-lg px-3 py-2.5 border border-slate-700/60">
            <span className="font-mono text-xs text-slate-100 break-all flex-1 select-all">
              {address}
            </span>
            <button
              onClick={copyAddress}
              className="text-slate-400 hover:text-amber-300 transition-colors shrink-0 p-0.5"
              aria-label="Copy wallet address"
            >
              {copied
                ? <CheckCircle className="h-4 w-4 text-emerald-400" />
                : <Copy className="h-4 w-4" />}
            </button>
          </div>
          {copied && (
            <p className="text-xs text-emerald-400">Address copied to clipboard</p>
          )}
        </div>
      </div>

      {/* Next step instruction */}
      <div className="rounded-lg bg-slate-800/40 border border-slate-700/40 px-4 py-3 flex items-start gap-3">
        <MessageCircle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-300 leading-relaxed">
          Once your deposit is sent, please inform your Case Support Officer immediately via the{' '}
          <button
            onClick={() => setViewState('messages')}
            className="text-amber-300 underline underline-offset-2 hover:text-amber-200 transition-colors"
          >
            Secure Messaging panel
          </button>
          . Your officer will verify the deposit and confirm receipt within 24 hours.
        </p>
      </div>
    </motion.div>
  );
}

function TokenWalletSetupCard({ currentCase }: { currentCase: Case }) {
  const confirmed = !!currentCase.tokenWalletSetupConfirmed;
  const isWithdrawalMode = getIsWithdrawalMode(currentCase);

  if (isWithdrawalMode && !confirmed) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-2xl border border-slate-600/30 bg-slate-800/30 p-4 flex items-center gap-3"
        data-testid="token-wallet-withdrawal-done"
      >
        <div className="w-9 h-9 rounded-lg bg-slate-600/40 border border-slate-500/30 flex items-center justify-center shrink-0">
          <CheckCircle className="w-5 h-5 text-slate-400" />
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Step Completed</p>
          <p className="text-sm text-slate-300 font-medium">Token Wallet Setup — Cleared</p>
        </div>
      </motion.div>
    );
  }

  if (confirmed) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-2xl p-4 sm:p-5"
        style={{
          background: "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(34,197,94,0.10))",
          border: "1px solid rgba(74,222,128,0.35)",
          boxShadow: "0 4px 24px rgba(16,185,129,0.12)",
        }}
        data-testid="card-token-wallet-setup"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5 text-emerald-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-emerald-200 text-xs uppercase tracking-widest font-semibold">Verified</p>
            <h3 className="text-white text-base font-bold mt-0.5">Token Wallet Set Up — Verified</h3>
            {(currentCase.tokenWalletSetupConfirmedBy || currentCase.tokenWalletSetupConfirmedAt) && (
              <p className="text-emerald-300/70 text-xs mt-0.5">
                Confirmed
                {currentCase.tokenWalletSetupConfirmedBy && ` by ${currentCase.tokenWalletSetupConfirmedBy}`}
                {currentCase.tokenWalletSetupConfirmedAt &&
                  ` · ${new Date(currentCase.tokenWalletSetupConfirmedAt).toLocaleDateString()}`}
              </p>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(109,40,217,0.15), rgba(99,102,241,0.12))",
        border: "1px solid rgba(139,92,246,0.40)",
        boxShadow: "0 8px 32px rgba(109,40,217,0.18)",
      }}
      data-testid="card-token-wallet-setup"
    >
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-violet-700/30">
        <div className="w-9 h-9 rounded-xl bg-violet-600/30 border border-violet-500/40 flex items-center justify-center shrink-0">
          <Wallet className="w-4 h-4 text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-violet-200 text-xs uppercase tracking-widest font-semibold">Action Required</p>
          <h3 className="text-white text-sm font-bold">Set Up Your Token Wallet</h3>
        </div>
      </div>
      <div className="px-4 sm:px-5 py-4 space-y-3">
        {currentCase.tokenWalletSetupNote && (
          <p className="text-violet-100/80 text-sm leading-relaxed">{currentCase.tokenWalletSetupNote}</p>
        )}
        <p className="text-violet-300/70 text-xs">
          Follow the guide to configure your token wallet, then notify your Support Officer when complete.
        </p>
        <a
          data-testid="tws-card-setup-link"
          href={currentCase.tokenWalletSetupLink!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-violet-700 hover:bg-violet-600 text-white text-sm font-semibold rounded-xl transition-colors duration-200 shadow-lg"
        >
          <ExternalLink className="w-4 h-4" />
          Open Wallet Setup Guide
        </a>
      </div>
    </motion.div>
  );
}
