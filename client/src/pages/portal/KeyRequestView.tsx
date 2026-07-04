import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";
import { useFormat } from "@/i18n/format";
import { getPortalToken } from "@/lib/portalSession";
import {
  ArrowLeft, Clock, CheckCircle, XCircle, AlertTriangle,
  MessageSquare, Key, Send, Loader2, PartyPopper, Copy
} from "lucide-react";

interface AdminMessage {
  message: string;
  adminUsername: string;
  timestamp: string;
}

interface RequestStatus {
  requestId: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  expiresAt: string;
  adminMessages?: AdminMessage[];
  accessKey?: string;
  userMessagesReadCount?: number;
}

export function KeyRequestView() {
  const { t } = useTranslation("portal");
  const { currentCase, keyRequestNotification, markKeyRequestRead, setViewState } = usePortal();
  const { formatDate, formatDateTime } = useFormat();
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResubmitForm, setShowResubmitForm] = useState(false);
  const [confirmationData, setConfirmationData] = useState<{
    requestId: string;
    userName: string;
    userEmail: string;
  } | null>(null);

  // Form state – pre-filled from case data
  const [formName, setFormName] = useState(currentCase?.userName ?? "");
  const [formEmail, setFormEmail] = useState(currentCase?.userEmail ?? "");
  const [formPhone, setFormPhone] = useState(currentCase?.userMobile ?? "");
  const [formReason, setFormReason] = useState("");
  const [copiedRequestId, setCopiedRequestId] = useState(false);

  // Keep form pre-fills in sync if case data arrives after mount
  useEffect(() => {
    if (currentCase) {
      setFormName((prev) => prev || currentCase.userName || "");
      setFormEmail((prev) => prev || currentCase.userEmail || "");
      setFormPhone((prev) => prev || currentCase.userMobile || "");
    }
  }, [currentCase?.id]);

  const { toast } = useToast();

  const copyRequestId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedRequestId(true);
    setTimeout(() => setCopiedRequestId(false), 2500);
    toast({ title: t("keyRequest.toast.copiedTitle"), description: t("keyRequest.toast.copiedDescription") });
  };

  // forceLatest=true skips the stale notification requestId and always resolves
  // via the case endpoint, used after a resubmission to get the newest request.
  const load = async (forceLatest = false) => {
    setIsLoading(true);
    try {
      let requestId = (!forceLatest && keyRequestNotification?.requestId) ? keyRequestNotification.requestId : null;

      if (!requestId && currentCase) {
        const _krToken = getPortalToken();
        const caseRes = await fetch(`/api/access-key-requests/case/${currentCase.id}`, {
          headers: _krToken ? { "x-portal-session-token": _krToken } : {},
        });
        if (caseRes.ok) {
          const caseData = await caseRes.json();
          requestId = caseData.requestId ?? null;
        }
      }

      if (!requestId) {
        setRequestStatus(null);
        setIsLoading(false);
        return;
      }

      const portalEmail = currentCase?.userEmail ?? formEmail;
      const statusHeaders: Record<string, string> = {};
      if (portalEmail) statusHeaders['X-Request-Email'] = portalEmail;
      const res = await fetch(`/api/access-key-requests/status/${requestId}`, {
        headers: statusHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setRequestStatus(data);
      } else {
        toast({ variant: "destructive", title: t("keyRequest.toast.notFoundTitle"), description: t("keyRequest.toast.notFoundDescription") });
      }
    } catch {
      toast({ variant: "destructive", title: t("keyRequest.toast.connectionTitle"), description: t("keyRequest.toast.statusError") });
    } finally {
      setIsLoading(false);
    }
  };

  // Run on mount and whenever the case becomes available (handles late-arriving case data)
  useEffect(() => {
    if (!currentCase) return;
    markKeyRequestRead(keyRequestNotification?.requestId);
    load();
  }, [currentCase?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formName.trim() || !formEmail.trim()) {
      toast({ variant: "destructive", title: t("keyRequest.toast.requiredFieldsTitle"), description: t("keyRequest.toast.requiredFieldsDescription") });
      return;
    }

    if (!currentCase) return;

    setIsSubmitting(true);
    try {
      const portalToken = getPortalToken();
      const res = await fetch(`/api/access-key-requests/portal/${currentCase.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(portalToken ? { "x-portal-session-token": portalToken } : {}),
        },
        body: JSON.stringify({
          userName: formName.trim(),
          userEmail: formEmail.trim(),
          userPhone: formPhone.trim() || undefined,
          requestReason: formReason.trim() || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setShowResubmitForm(false);
        setFormReason("");
        setConfirmationData({
          requestId: data.requestId ?? "",
          userName: formName.trim(),
          userEmail: formEmail.trim(),
        });
      } else {
        const data = await res.json().catch(() => ({}));
        toast({
          variant: "destructive",
          title: t("keyRequest.toast.submissionFailedTitle"),
          description: data.error ?? t("keyRequest.toast.submissionFailedDefault"),
        });
      }
    } catch {
      toast({ variant: "destructive", title: t("keyRequest.toast.connectionTitle"), description: t("keyRequest.toast.submitConnectionError") });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" /> {t("keyRequest.status.underReview")}</Badge>;
      case "approved":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" /> {t("keyRequest.status.approved")}</Badge>;
      case "rejected":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" /> {t("keyRequest.status.rejected")}</Badge>;
      case "expired":
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30"><AlertTriangle className="w-3 h-3 mr-1" /> {t("keyRequest.status.expired")}</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto" data-testid="view-keyRequest">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
      >
        {/* Back button */}
        <button
          onClick={() => setViewState("dashboard")}
          className="flex items-center gap-2 text-blue-300 hover:text-white transition-colors mb-6 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("keyRequest.back")}
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
            <Key className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{t("keyRequest.header.title")}</h1>
            <p className="text-blue-300 text-sm">{t("keyRequest.header.subtitle")}</p>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
          </div>
        )}

        {/* Confirmation panel – shown immediately after successful submission */}
        {!isLoading && confirmationData && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="space-y-5"
            data-testid="submission-confirmation"
          >
            <Card className="bg-white/5 border-white/10 overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500" />
              <CardContent className="p-6 space-y-5">
                {/* Icon + heading */}
                <div className="flex flex-col items-center text-center gap-3 pt-2">
                  <div className="w-14 h-14 bg-gradient-to-br from-indigo-500/30 to-purple-500/30 border border-indigo-400/30 rounded-2xl flex items-center justify-center shadow-lg">
                    <PartyPopper className="w-7 h-7 text-indigo-300" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">{t("keyRequest.confirm.title")}</h2>
                    <p className="text-sm text-blue-300/80 mt-1">
                      {t("keyRequest.confirm.subtitle")}
                    </p>
                  </div>
                </div>

                {/* Request ID */}
                {confirmationData.requestId && (
                  <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3 text-center">
                    <p className="text-xs text-blue-400/60 uppercase tracking-widest mb-1 font-medium">{t("keyRequest.confirm.requestIdLabel")}</p>
                    <div className="flex items-center justify-center gap-2">
                      <p className="font-mono text-indigo-300 font-semibold tracking-wider text-sm break-all">
                        {confirmationData.requestId}
                      </p>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => copyRequestId(confirmationData.requestId)}
                        className={`h-7 w-7 shrink-0 rounded-lg transition-all ${copiedRequestId ? "text-emerald-400 bg-emerald-500/10" : "text-indigo-300 hover:bg-indigo-500/15"}`}
                        aria-label={t("keyRequest.confirm.copyAria")}
                        data-testid="button-copy-request-id-confirm"
                      >
                        {copiedRequestId ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                    <p className="text-xs text-blue-400/50 mt-1">{t("keyRequest.confirm.keepHint")}</p>
                  </div>
                )}

                {/* Submitted details */}
                <div className="bg-white/[0.03] border border-white/10 rounded-xl divide-y divide-white/5">
                  <div className="flex items-center justify-between px-4 py-2.5 gap-3">
                    <span className="text-xs text-blue-400/60 font-medium shrink-0">{t("keyRequest.confirm.nameLabel")}</span>
                    <span className="text-sm text-white font-medium text-right truncate">{confirmationData.userName}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5 gap-3">
                    <span className="text-xs text-blue-400/60 font-medium shrink-0">{t("keyRequest.confirm.emailLabel")}</span>
                    <span className="text-sm text-white font-medium text-right truncate">{confirmationData.userEmail}</span>
                  </div>
                </div>

                {/* What happens next */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-blue-400/60 uppercase tracking-wide">{t("keyRequest.confirm.nextHeading")}</p>
                  <ul className="space-y-2">
                    <li className="flex items-start gap-3 text-sm text-blue-300/80">
                      <Clock className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                      {t("keyRequest.confirm.nextReview")} <span className="text-white font-medium">&nbsp;{t("keyRequest.confirm.nextReviewDays")}</span>
                    </li>
                    <li className="flex items-start gap-3 text-sm text-blue-300/80">
                      <Key className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                      {t("keyRequest.confirm.nextKey")}
                    </li>
                    <li className="flex items-start gap-3 text-sm text-blue-300/80">
                      <CheckCircle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                      {t("keyRequest.confirm.nextNotify")}
                    </li>
                  </ul>
                </div>

                {/* CTAs */}
                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  <Button
                    className="flex-1 bg-[#004AB3] hover:bg-[#003d99] gap-2"
                    onClick={async () => {
                      setConfirmationData(null);
                      await load(true);
                    }}
                  >
                    <Key className="w-4 h-4" />
                    {t("keyRequest.confirm.viewStatus")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 border-white/10 text-blue-300 hover:bg-white/5 hover:text-white"
                    onClick={() => setViewState("dashboard")}
                  >
                    {t("keyRequest.back")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Empty state – inline request form */}
        {!isLoading && !requestStatus && !confirmationData && (
          <div className="space-y-5">
            <Card className="bg-white/5 border-white/10">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-indigo-500/20 border border-indigo-500/20 rounded-xl flex items-center justify-center shrink-0">
                    <Key className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-white">{t("keyRequest.form.heading")}</h2>
                    <p className="text-sm text-blue-300/80 mt-0.5 leading-relaxed">
                      {t("keyRequest.form.intro")}
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="kr-name" className="text-blue-300 text-xs font-medium">
                        {t("keyRequest.form.fullName")} <span className="text-red-400">*</span>
                      </Label>
                      <Input
                        id="kr-name"
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder={t("keyRequest.form.fullNamePlaceholder")}
                        required
                        className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus:border-indigo-500/50"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="kr-email" className="text-blue-300 text-xs font-medium">
                        {t("keyRequest.form.email")} <span className="text-red-400">*</span>
                      </Label>
                      <Input
                        id="kr-email"
                        type="email"
                        value={formEmail}
                        onChange={(e) => setFormEmail(e.target.value)}
                        placeholder={t("keyRequest.form.emailPlaceholder")}
                        required
                        className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus:border-indigo-500/50"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="kr-phone" className="text-blue-300 text-xs font-medium">
                      {t("keyRequest.form.phone")} <span className="text-blue-400/50">{t("keyRequest.form.optional")}</span>
                    </Label>
                    <Input
                      id="kr-phone"
                      type="tel"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder={t("keyRequest.form.phonePlaceholder")}
                      className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus:border-indigo-500/50"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="kr-reason" className="text-blue-300 text-xs font-medium">
                      {t("keyRequest.form.reason")} <span className="text-blue-400/50">{t("keyRequest.form.optional")}</span>
                    </Label>
                    <Textarea
                      id="kr-reason"
                      value={formReason}
                      onChange={(e) => setFormReason(e.target.value)}
                      placeholder={t("keyRequest.form.reasonPlaceholder")}
                      rows={3}
                      className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus:border-indigo-500/50 resize-none"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-1">
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex-1 bg-[#004AB3] hover:bg-[#003d99] gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {t("keyRequest.form.submitting")}
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          {t("keyRequest.form.submit")}
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 border-white/10 text-blue-300 hover:bg-white/5 hover:text-white"
                      onClick={() => setViewState("dashboard")}
                    >
                      {t("keyRequest.back")}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* How it works info */}
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wide">{t("keyRequest.howItWorks.heading")}</p>
              <ul className="space-y-1.5 text-sm text-blue-300/80">
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" /> {t("keyRequest.howItWorks.step1")}</li>
                <li className="flex items-start gap-2"><Clock className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" /> {t("keyRequest.howItWorks.step2")}</li>
                <li className="flex items-start gap-2"><Key className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" /> {t("keyRequest.howItWorks.step3")}</li>
              </ul>
            </div>
          </div>
        )}

        {!isLoading && requestStatus && !confirmationData && (
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-5 space-y-5">
              {/* Request ID + Status */}
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-blue-400">{t("keyRequest.statusCard.requestId")}</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono font-bold text-blue-300">{requestStatus.requestId}</p>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => copyRequestId(requestStatus.requestId)}
                      className={`h-7 w-7 shrink-0 rounded-lg transition-all ${copiedRequestId ? "text-emerald-400 bg-emerald-500/10" : "text-blue-300 hover:bg-blue-500/15"}`}
                      aria-label={t("keyRequest.statusCard.copyAria")}
                      data-testid="button-copy-request-id-status"
                    >
                      {copiedRequestId ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
                {getStatusBadge(requestStatus.status)}
              </div>

              {/* Progress tracker */}
              <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                <p className="text-[10px] font-semibold text-blue-400/60 uppercase tracking-wider mb-4">{t("keyRequest.statusCard.progressHeading")}</p>
                <div className="relative">
                  <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-white/10" />
                  <div className="space-y-4">
                    {[
                      {
                        label: t("keyRequest.statusCard.stepSubmitted"),
                        desc: t("keyRequest.statusCard.stepSubmittedDesc", { date: formatDate(requestStatus.createdAt) }),
                        done: true,
                        active: false,
                        isRejected: false,
                      },
                      {
                        label: t("keyRequest.statusCard.stepUnderReview"),
                        desc: requestStatus.status === "pending" ? t("keyRequest.statusCard.stepReviewing") : t("keyRequest.statusCard.stepReviewCompleted"),
                        done: requestStatus.status !== "pending",
                        active: requestStatus.status === "pending",
                        isRejected: false,
                      },
                      {
                        label: requestStatus.status === "rejected"
                          ? t("keyRequest.statusCard.stepRejected")
                          : requestStatus.status === "expired"
                            ? t("keyRequest.statusCard.stepExpired")
                            : t("keyRequest.statusCard.stepApproved"),
                        desc: requestStatus.status === "approved"
                          ? t("keyRequest.statusCard.stepApprovedDesc")
                          : requestStatus.status === "rejected"
                            ? t("keyRequest.statusCard.stepRejectedDesc")
                            : requestStatus.status === "expired"
                              ? t("keyRequest.statusCard.stepExpiredDesc")
                              : t("keyRequest.statusCard.stepAwaiting"),
                        done: requestStatus.status === "approved",
                        active: false,
                        isRejected: requestStatus.status === "rejected" || requestStatus.status === "expired",
                      },
                    ].map((step, i) => (
                      <div key={i} className="flex items-start gap-3 relative">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 border-2 transition-colors ${
                          step.done
                            ? "bg-green-500 border-green-500 text-white"
                            : step.active
                              ? "bg-yellow-400 border-yellow-400 text-white animate-pulse"
                              : step.isRejected
                                ? "bg-red-400 border-red-400 text-white"
                                : "bg-white/5 border-white/20 text-blue-400"
                        }`}>
                          {step.done ? (
                            <CheckCircle className="w-4 h-4" />
                          ) : step.active ? (
                            <Clock className="w-4 h-4" />
                          ) : step.isRejected ? (
                            <XCircle className="w-4 h-4" />
                          ) : (
                            <span className="text-xs font-bold">{i + 1}</span>
                          )}
                        </div>
                        <div className="pt-0.5">
                          <p className={`text-sm font-semibold ${
                            step.done ? "text-green-400"
                              : step.active ? "text-yellow-400"
                              : step.isRejected ? "text-red-400"
                              : "text-blue-400/50"
                          }`}>{step.label}</p>
                          <p className="text-xs text-blue-300/60">{step.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Submission date */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-blue-400/60 text-xs">{t("keyRequest.statusCard.submittedLabel")}</p>
                  <p className="font-medium text-white">{formatDate(requestStatus.createdAt)}</p>
                </div>
              </div>

              {/* Approved */}
              {requestStatus.status === "approved" && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-green-400 mb-2">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-semibold">{t("keyRequest.approved.title")}</span>
                  </div>
                  <p className="text-sm text-green-400/80 text-center mt-1">
                    {t("keyRequest.approved.hint")}
                  </p>
                </div>
              )}

              {/* Rejected */}
              {requestStatus.status === "rejected" && (() => {
                const rejectionMsg = requestStatus.adminMessages?.find((m) =>
                  m.message.startsWith("Request rejected: ")
                );
                const rejectionReason = rejectionMsg
                  ? rejectionMsg.message.replace(/^Request rejected:\s*/i, "")
                  : null;
                return (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-red-400">
                      <XCircle className="w-5 h-5 shrink-0" />
                      <span className="font-semibold">{t("keyRequest.rejected.title")}</span>
                    </div>
                    <div className="bg-red-500/10 rounded-lg px-4 py-3">
                      <p className="text-sm font-medium text-red-300 mb-0.5">{t("keyRequest.rejected.reasonLabel")}</p>
                      <p className="text-sm text-red-400">
                        {rejectionReason || t("keyRequest.rejected.noReason")}
                      </p>
                    </div>
                    {!showResubmitForm && (
                      <Button
                        size="sm"
                        className="w-full bg-[#004AB3] hover:bg-[#003d99] gap-2"
                        onClick={() => setShowResubmitForm(true)}
                        data-testid="button-open-resubmit-form"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {t("keyRequest.rejected.submitNew")}
                      </Button>
                    )}
                  </div>
                );
              })()}

              {/* Expired */}
              {requestStatus.status === "expired" && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-blue-300">
                    <AlertTriangle className="w-5 h-5" />
                    <span className="font-semibold">{t("keyRequest.expired.title")}</span>
                  </div>
                  <p className="text-sm text-blue-300/70">
                    {t("keyRequest.expired.body")}
                  </p>
                  {!showResubmitForm && (
                    <Button
                      size="sm"
                      className="w-full bg-[#004AB3] hover:bg-[#003d99] gap-2"
                      onClick={() => setShowResubmitForm(true)}
                      data-testid="button-open-resubmit-form"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {t("keyRequest.rejected.submitNew")}
                    </Button>
                  )}
                </div>
              )}

              {/* Inline resubmit form for rejected / expired requests */}
              {showResubmitForm && (requestStatus.status === "rejected" || requestStatus.status === "expired") && (
                <div
                  className="border border-indigo-500/20 rounded-xl p-4 bg-indigo-500/5 space-y-4"
                  data-testid="card-resubmit-form"
                  onKeyDown={(e) => { if (e.key === "Escape") setShowResubmitForm(false); }}
                >
                  <p className="text-sm font-semibold text-indigo-300">{t("keyRequest.resubmit.title")}</p>
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="kr-re-name" className="text-blue-300 text-xs font-medium">
                          {t("keyRequest.resubmit.fullName")} <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          id="kr-re-name"
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          placeholder={t("keyRequest.form.fullNamePlaceholder")}
                          required
                          className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus:border-indigo-500/50"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="kr-re-email" className="text-blue-300 text-xs font-medium">
                          {t("keyRequest.resubmit.email")} <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          id="kr-re-email"
                          type="email"
                          value={formEmail}
                          onChange={(e) => setFormEmail(e.target.value)}
                          placeholder={t("keyRequest.form.emailPlaceholder")}
                          required
                          className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus:border-indigo-500/50"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="kr-re-reason" className="text-blue-300 text-xs font-medium">
                        {t("keyRequest.resubmit.reason")} <span className="text-blue-400/50">{t("keyRequest.form.optional")}</span>
                      </Label>
                      <Textarea
                        id="kr-re-reason"
                        value={formReason}
                        onChange={(e) => setFormReason(e.target.value)}
                        placeholder={t("keyRequest.resubmit.reasonPlaceholder")}
                        rows={2}
                        className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus:border-indigo-500/50 resize-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        disabled={isSubmitting}
                        size="sm"
                        className="flex-1 bg-[#004AB3] hover:bg-[#003d99] gap-2"
                        data-testid="button-resubmit-submit"
                      >
                        {isSubmitting ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("keyRequest.form.submitting")}</>
                        ) : (
                          <><Send className="w-3.5 h-3.5" /> {t("keyRequest.resubmit.submit")}</>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-white/10 text-blue-300 hover:bg-white/5 hover:text-white"
                        onClick={() => setShowResubmitForm(false)}
                        data-testid="button-resubmit-cancel"
                      >
                        {t("keyRequest.resubmit.cancel")}
                      </Button>
                    </div>
                  </form>
                </div>
              )}

              {/* Pending */}
              {requestStatus.status === "pending" && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-yellow-400 mb-2">
                    <Clock className="w-5 h-5" />
                    <span className="font-semibold">{t("keyRequest.pending.title")}</span>
                  </div>
                  <p className="text-sm text-yellow-400/80">
                    {t("keyRequest.pending.body")}
                  </p>
                </div>
              )}

              {/* Admin messages */}
              {requestStatus.adminMessages && requestStatus.adminMessages.length > 0 && (() => {
                const readCount = requestStatus.userMessagesReadCount ?? requestStatus.adminMessages.length;
                const unread = requestStatus.adminMessages.length - readCount;
                return (
                  <div className="border-t border-white/10 pt-4">
                    <p className="text-sm font-medium text-blue-300 mb-3 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" /> {t("keyRequest.adminMsgs.heading")}
                      {unread > 0 && (
                        <Badge className="bg-blue-500 hover:bg-blue-500 text-white text-xs px-1.5 py-0 h-5">
                          {t("keyRequest.adminMsgs.newBadge", { count: unread })}
                        </Badge>
                      )}
                    </p>
                    <div className="space-y-2">
                      {requestStatus.adminMessages.map((msg, i) => {
                        const isNew = i >= readCount;
                        return (
                          <div
                            key={i}
                            className={`rounded-lg p-3 border transition-colors ${
                              isNew
                                ? "bg-blue-500/10 border-blue-500/30 ring-1 ring-blue-400/20"
                                : "bg-white/5 border-white/10"
                            }`}
                          >
                            {isNew && (
                              <Badge className="mb-2 bg-blue-500 hover:bg-blue-500 text-white text-xs px-1.5 py-0 h-4">
                                {t("keyRequest.adminMsgs.newPill")}
                              </Badge>
                            )}
                            <p className="text-sm text-blue-100">{msg.message}</p>
                            <p className="text-xs text-blue-400/50 mt-2">
                              {formatDateTime(msg.timestamp)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}
      </motion.div>
    </div>
  );
}
