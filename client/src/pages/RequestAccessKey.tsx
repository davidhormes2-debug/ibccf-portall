import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Shield, Lock, ArrowLeft, Send, Clock, CheckCircle, XCircle, AlertTriangle, Key, User, Mail, Phone, MessageSquare, FileText, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ComplianceStrip, ComplianceFooter } from "@/components/ComplianceStrip";
import { useTranslation } from "react-i18next";
import { useFormat } from "@/i18n/format";

interface AdminMessage {
  message: string;
  adminUsername: string;
  timestamp: string;
}

interface RequestStatus {
  requestId: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
  expiresAt: string;
  adminMessages?: AdminMessage[];
  accessKey?: string;
  userMessagesReadCount?: number;
}

const DRAFT_STORAGE_KEY = 'ak_request_draft';

export default function RequestAccessKey() {
  const { t } = useTranslation("access");
  const { formatDate, formatDateTime } = useFormat();
  const [mode, setMode] = useState<'request' | 'check'>('request');
  const [isReapply, setIsReapply] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [checkEmail, setCheckEmail] = useState('');
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  
  const [formData, setFormData] = useState({
    userName: '',
    userEmail: '',
    userPhone: '',
    requestReason: ''
  });
  
  const [submittedRequestId, setSubmittedRequestId] = useState('');
  const [formErrors, setFormErrors] = useState<{ userName?: string; userEmail?: string }>({});
  const [linkCopied, setLinkCopied] = useState(false);
  const { toast } = useToast();

  const getStatusLink = (id: string) =>
    `${window.location.origin}/request-access?tab=check&requestId=${id}`;

  const handleCopyLink = (id: string) => {
    if (!navigator.clipboard) {
      toast({
        variant: "destructive",
        title: t("toast.copyTitle"),
        description: t("toast.copyDesc"),
      });
      return;
    }
    navigator.clipboard.writeText(getStatusLink(id)).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }).catch(() => {
      toast({
        variant: "destructive",
        title: t("toast.copyFailTitle"),
        description: t("toast.copyDesc"),
      });
    });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const prefilledId = params.get('requestId');
    const hasUrlPrefill = (tab === 'check') || (tab === 'apply' && !!prefilledId);

    if (!hasUrlPrefill) {
      try {
        const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft && typeof draft === 'object') {
            const restored = {
              userName: typeof draft.userName === 'string' ? draft.userName : '',
              userEmail: typeof draft.userEmail === 'string' ? draft.userEmail : '',
              userPhone: typeof draft.userPhone === 'string' ? draft.userPhone : '',
              requestReason: typeof draft.requestReason === 'string' ? draft.requestReason : '',
            };
            const hasContent = Object.values(restored).some(v => v.trim().length > 0);
            if (hasContent) {
              setFormData(restored);
              setDraftRestored(true);
            }
          }
        }
      } catch {
        // ignore corrupt draft
      }
    }
    setDraftHydrated(true);

    if (tab === 'check') {
      setMode('check');
      if (prefilledId) {
        setRequestId(prefilledId);
        // Auto-submit the status check without email — returns basic status only.
        // The user can enter their email in the form below to see staff messages.
        (async () => {
          try {
            const res = await fetch(`/api/access-key-requests/status/${prefilledId}`);
            if (res.ok) {
              const data = await res.json();
              setRequestStatus(data);
            }
          } catch {
            // silently ignore auto-check failures
          }
        })();
      }
    } else if (tab === 'apply' && prefilledId) {
      // Deep-link from expiry/rejection email — open the apply form directly.
      setIsReapply(true);
      setMode('request');
    }
  }, []);

  const clearDraft = () => {
    try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* ignore */ }
    setDraftRestored(false);
  };

  // Autosave the in-progress draft so users don't lose their input on refresh/navigation.
  useEffect(() => {
    if (!draftHydrated) return;
    if (mode !== 'request') return;
    if (submittedRequestId) return;
    const hasContent = Object.values(formData).some(v => v.trim().length > 0);
    try {
      if (hasContent) {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(formData));
      } else {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    } catch {
      // ignore quota / privacy-mode failures
    }
  }, [formData, mode, submittedRequestId, draftHydrated]);

  const validateField = (name: 'userName' | 'userEmail', value: string) => {
    if (name === 'userName' && !value.trim()) {
      setFormErrors(prev => ({ ...prev, userName: t("form.errors.nameRequired") }));
    } else if (name === 'userEmail') {
      if (!value.trim()) {
        setFormErrors(prev => ({ ...prev, userEmail: t("form.errors.emailRequired") }));
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setFormErrors(prev => ({ ...prev, userEmail: t("form.errors.emailInvalid") }));
      } else {
        setFormErrors(prev => ({ ...prev, userEmail: undefined }));
      }
    } else {
      setFormErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsReapply(false);
    
    const errors: { userName?: string; userEmail?: string } = {};
    if (!formData.userName.trim()) errors.userName = t("form.errors.nameRequired");
    if (!formData.userEmail.trim()) {
      errors.userEmail = t("form.errors.emailRequired");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.userEmail)) {
      errors.userEmail = t("form.errors.emailInvalid");
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});

    setIsLoading(true);
    try {
      const res = await fetch("/api/access-key-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      
      if (res.ok) {
        const data = await res.json();
        setSubmittedRequestId(data.requestId);
        clearDraft();
        toast({
          title: t("toast.submittedTitle"),
          description: t("toast.submittedDesc"),
        });
      } else {
        const error = await res.json();
        toast({
          variant: "destructive",
          title: t("toast.submitFailTitle"),
          description: error.error || t("toast.connectionDesc"),
        });
      }
    } catch (_e) {
      toast({
        variant: "destructive",
        title: t("toast.connectionTitle"),
        description: t("toast.connectionDesc"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!requestId.trim()) {
      toast({
        variant: "destructive",
        title: t("toast.requiredTitle"),
        description: t("toast.requiredDesc"),
      });
      return;
    }

    setIsLoading(true);
    try {
      const emailHeader: Record<string, string> = {};
      if (checkEmail.trim()) emailHeader['X-Request-Email'] = checkEmail.trim();
      const res = await fetch(`/api/access-key-requests/status/${requestId}`, {
        headers: emailHeader,
      });
      
      if (res.ok) {
        const data = await res.json();
        setRequestStatus(data);
        // Mark messages as read server-side (requires email verification).
        // Failure is silently ignored — client-side localStorage tracks the count.
        if (checkEmail.trim()) {
          try {
            const markRes = await fetch(`/api/access-key-requests/mark-read/${requestId}`, {
              method: 'PATCH',
              headers: { 'X-Request-Email': checkEmail.trim() },
            });
            if (markRes.ok) {
              const { userMessagesReadCount } = await markRes.json();
              localStorage.setItem(`ibccf_kr_seen_${requestId}`, String(userMessagesReadCount));
              if (userMessagesReadCount > 0) {
                toast({ title: t("toast.messagesReadTitle"), description: t("toast.messagesReadDesc") });
              }
              setRequestStatus(prev => prev ? { ...prev, userMessagesReadCount } : prev);
            }
          } catch { /* silently ignore */ }
        }
      } else {
        toast({
          variant: "destructive",
          title: t("toast.notFoundTitle"),
          description: t("toast.notFoundDesc"),
        });
        setRequestStatus(null);
      }
    } catch (_e) {
      toast({
        variant: "destructive",
        title: t("toast.connectionTitle"),
        description: t("toast.checkErrorDesc"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleReapply = () => {
    if (!requestStatus) return;
    setFormData({
      userName: '',
      userEmail: '',
      userPhone: '',
      requestReason: '',
    });
    setFormErrors({});
    setRequestStatus(null);
    setIsReapply(true);
    setMode('request');
    clearDraft();
  };

  const _parseMessages = (messagesJson: string | null): AdminMessage[] => {
    if (!messagesJson) return [];
    try {
      return JSON.parse(messagesJson);
    } catch {
      return [];
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-600 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" /> {t("status.underReview")}</Badge>;
      case 'approved':
        return <Badge className="bg-green-500/20 text-green-600 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" /> {t("status.approved")}</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-600 border-red-500/30"><XCircle className="w-3 h-3 mr-1" /> {t("status.rejected")}</Badge>;
      case 'expired':
        return <Badge className="bg-gray-500/20 text-gray-600 border-gray-500/30"><AlertTriangle className="w-3 h-3 mr-1" /> {t("status.expired")}</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen verification-bg font-['Public_Sans',sans-serif] relative overflow-hidden flex flex-col">
      <header className="bg-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <Link href="/" className="flex items-center gap-1 sm:gap-2 text-slate-700 dark:text-white hover:opacity-80 transition-opacity">
              <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
              <span className="font-medium text-sm sm:text-base">{t("back")}</span>
            </Link>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-white" />
              <span className="text-lg sm:text-xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif]">IBCCF</span>
            </div>
            <ThemeToggle className="text-slate-600 dark:text-white" />
          </div>
        </div>
      </header>
      <ComplianceStrip variant="light" />

      <main id="main-content" tabIndex={-1} className="flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-lg">
          {submittedRequestId ? (
            <Card className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl">
              <CardContent className="p-5 sm:p-8">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="h-8 w-8 text-green-600" />
                  </div>
                  <h1 className="text-2xl font-bold text-[#0F172B] dark:text-white font-['Merriweather',serif] mb-2">
                    {t("submitted.title")}
                  </h1>
                  <p className="text-slate-600 dark:text-slate-300">
                    {t("submitted.subtitle")}
                  </p>
                </div>
                
                <div className="bg-slate-100 dark:bg-slate-700 rounded-lg p-4 mb-6">
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">{t("submitted.yourId")}</p>
                  <p className="text-2xl font-mono font-bold text-[#004182] text-center">{submittedRequestId}</p>
                </div>
                
                <div className="space-y-3 mb-6">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("submitted.statusLink")}</p>
                  <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 rounded-lg px-3 py-2">
                    <span className="flex-1 text-xs font-mono text-slate-600 dark:text-slate-300 truncate">
                      {getStatusLink(submittedRequestId)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyLink(submittedRequestId)}
                      className="flex-shrink-0 p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                      title={t("form.copyTitle")}
                    >
                      {linkCopied
                        ? <CheckCircle className="h-4 w-4 text-green-500" />
                        : <Copy className="h-4 w-4 text-slate-500" />
                      }
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t("submitted.saveHint")}
                  </p>
                </div>

                <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
                  <div className="flex items-start gap-3">
                    <Clock className="h-5 w-5 text-[#004182] mt-0.5" />
                    <p>{t("submitted.infoSave")}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-[#004182] mt-0.5" />
                    <p>{t("submitted.infoReview")}</p>
                  </div>
                </div>
                
                <div className="flex gap-3 mt-6">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setRequestId(submittedRequestId);
                      setSubmittedRequestId('');
                      setMode('check');
                    }}
                    data-testid="button-check-submitted"
                  >
                    {t("submitted.checkBtn")}
                  </Button>
                  <Button
                    className="flex-1 bg-[#004AB3] hover:bg-[#003d99]"
                    onClick={() => {
                      setSubmittedRequestId('');
                      setFormData({ userName: '', userEmail: '', userPhone: '', requestReason: '' });
                      clearDraft();
                    }}
                    data-testid="button-new-request"
                  >
                    {t("submitted.newBtn")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-[#004182]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Key className="h-8 w-8 text-[#004182]" />
                </div>
                <h1 className="text-2xl font-bold text-[#0F172B] dark:text-white font-['Merriweather',serif] mb-2">
                  {mode === 'request' ? t("header.request") : t("header.check")}
                </h1>
                <p className="text-slate-600 dark:text-slate-300">
                  {mode === 'request'
                    ? t("header.subtitleRequest")
                    : t("header.subtitleCheck")
                  }
                </p>
              </div>

              <div className="flex mb-6 border-b border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => { setMode('request'); setRequestStatus(null); setIsReapply(false); }}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    mode === 'request' 
                      ? 'text-[#004AB3] border-b-2 border-[#004AB3]' 
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                  data-testid="tab-request"
                >
                  <Send className="w-4 h-4 inline mr-2" />
                  {t("tabs.request")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('check');
                    setFormData({ userName: '', userEmail: '', userPhone: '', requestReason: '' });
                    setFormErrors({});
                    clearDraft();
                  }}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    mode === 'check' 
                      ? 'text-[#004AB3] border-b-2 border-[#004AB3]' 
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                  data-testid="tab-check-status"
                >
                  <FileText className="w-4 h-4 inline mr-2" />
                  {t("tabs.check")}
                </button>
              </div>

              {mode === 'request' ? (
                <form onSubmit={handleSubmitRequest} className="space-y-4">
                  {draftRestored && !isReapply && (
                    <div
                      className="flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 px-4 py-3"
                      data-testid="banner-draft-restored"
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-300" />
                      <p className="flex-1 text-sm text-slate-600 dark:text-slate-300">
                        {t("form.draftRestored")}
                      </p>
                      <button
                        type="button"
                        onClick={() => setDraftRestored(false)}
                        className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        aria-label={t("form.draftDismiss")}
                        data-testid="button-dismiss-draft-notice"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {isReapply && (
                    <div
                      className="flex items-start gap-2.5 rounded-xl border border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-900/20 px-4 py-3"
                      data-testid="banner-prefill-notice"
                    >
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z" />
                      </svg>
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        {t("form.prefillNotice")}
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      <User className="w-4 h-4 inline mr-1" /> {t("form.name")} *
                    </label>
                    <Input
                      type="text"
                      value={formData.userName}
                      onChange={(e) => { setIsReapply(false); setFormData(prev => ({ ...prev, userName: e.target.value })); if (formErrors.userName) setFormErrors(prev => ({ ...prev, userName: undefined })); }}
                      onBlur={(e) => validateField('userName', e.target.value)}
                      placeholder={t("form.namePlaceholder")}
                      className={`w-full focus:border-[#004182] focus:ring-[#004182] ${formErrors.userName ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : 'border-slate-300'}`}
                      data-testid="input-user-name"
                    />
                    {formErrors.userName && (
                      <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {formErrors.userName}
                      </p>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      <Mail className="w-4 h-4 inline mr-1" /> {t("form.email")} *
                    </label>
                    <Input
                      type="email"
                      value={formData.userEmail}
                      onChange={(e) => { setIsReapply(false); setFormData(prev => ({ ...prev, userEmail: e.target.value })); if (formErrors.userEmail) setFormErrors(prev => ({ ...prev, userEmail: undefined })); }}
                      onBlur={(e) => validateField('userEmail', e.target.value)}
                      placeholder={t("form.emailPlaceholder")}
                      className={`w-full focus:border-[#004182] focus:ring-[#004182] ${formErrors.userEmail ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : 'border-slate-300'}`}
                      data-testid="input-user-email"
                    />
                    {formErrors.userEmail && (
                      <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {formErrors.userEmail}
                      </p>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      <Phone className="w-4 h-4 inline mr-1" /> {t("form.phone")}
                    </label>
                    <Input
                      type="tel"
                      value={formData.userPhone}
                      onChange={(e) => { setIsReapply(false); setFormData(prev => ({ ...prev, userPhone: e.target.value })); }}
                      placeholder={t("form.phonePlaceholder")}
                      className="w-full border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                      data-testid="input-user-phone"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      <MessageSquare className="w-4 h-4 inline mr-1" /> {t("form.reason")}
                    </label>
                    <Textarea
                      value={formData.requestReason}
                      onChange={(e) => { setIsReapply(false); setFormData(prev => ({ ...prev, requestReason: e.target.value })); }}
                      placeholder={isReapply ? t("form.reasonPlaceholderReapply") : t("form.reasonPlaceholder")}
                      className="w-full min-h-[80px] border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                      data-testid="input-request-reason"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-12 bg-[#004AB3] hover:bg-[#003d99] text-white font-semibold text-lg shadow-lg"
                    disabled={isLoading}
                    data-testid="button-submit-request"
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {t("form.submitting")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Send className="h-5 w-5" />
                        {t("form.submit")}
                      </span>
                    )}
                  </Button>
                </form>
              ) : (
                <div className="space-y-4">
                  <form onSubmit={handleCheckStatus} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        <FileText className="w-4 h-4 inline mr-1" /> {t("form.checkLabel")}
                      </label>
                      <Input
                        type="text"
                        value={requestId}
                        onChange={(e) => setRequestId(e.target.value.toUpperCase())}
                        placeholder={t("form.checkPlaceholder")}
                        className="w-full font-mono border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                        data-testid="input-request-id"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        <Mail className="w-4 h-4 inline mr-1" /> {t("form.email")}
                      </label>
                      <Input
                        type="email"
                        value={checkEmail}
                        onChange={(e) => setCheckEmail(e.target.value)}
                        placeholder={t("form.emailPlaceholder")}
                        className="w-full border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                        data-testid="input-check-email"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("form.checkEmailHint")}
                      </p>
                    </div>

                    <Button
                      type="submit"
                      className="w-full h-12 bg-[#004AB3] hover:bg-[#003d99] text-white font-semibold text-lg shadow-lg"
                      disabled={isLoading}
                      data-testid="button-check-status"
                    >
                      {isLoading ? (
                        <span className="flex items-center gap-2">
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          {t("form.checking")}
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <FileText className="h-5 w-5" />
                          {t("form.checkSubmit")}
                        </span>
                      )}
                    </Button>
                  </form>

                  {requestStatus && (
                    <Card className="border-slate-200 bg-slate-50 dark:bg-slate-800/50 dark:border-slate-700">
                      <CardContent className="p-4 space-y-5">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">{t("status.requestId")}</p>
                            <p className="font-mono font-bold text-[#004182] dark:text-blue-400">{requestStatus.requestId}</p>
                          </div>
                          {getStatusBadge(requestStatus.status)}
                        </div>

                        {/* Step-by-step progress tracker */}
                        <div className="bg-white dark:bg-slate-700/50 rounded-xl p-4 border border-slate-200 dark:border-slate-600">
                          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">{t("status.progress")}</p>
                          <div className="relative">
                            {/* Connector line */}
                            <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-slate-200 dark:bg-slate-600" />
                            <div className="space-y-4">
                              {[
                                {
                                  label: t("status.submitted"),
                                  desc: t("status.receivedOn", { date: formatDate(requestStatus.createdAt) }),
                                  done: true,
                                  active: false,
                                },
                                {
                                  label: t("status.underReview"),
                                  desc: requestStatus.status === 'pending' ? t("status.underReviewDesc") : t("status.reviewCompleted"),
                                  done: requestStatus.status !== 'pending',
                                  active: requestStatus.status === 'pending',
                                },
                                {
                                  label: requestStatus.status === 'rejected' ? t("status.rejectedStep") : requestStatus.status === 'expired' ? t("status.expiredStep") : t("status.approvedStep"),
                                  desc: requestStatus.status === 'approved'
                                    ? t("status.approvedDesc")
                                    : requestStatus.status === 'rejected'
                                      ? t("status.rejectedDesc")
                                      : requestStatus.status === 'expired'
                                        ? t("status.expiredDesc")
                                        : t("status.awaitingDecision"),
                                  done: requestStatus.status === 'approved',
                                  active: false,
                                  isFinal: true,
                                  isRejected: requestStatus.status === 'rejected' || requestStatus.status === 'expired',
                                },
                              ].map((step, i) => (
                                <div key={i} className="flex items-start gap-3 relative">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 border-2 transition-colors ${
                                    step.done 
                                      ? 'bg-green-500 border-green-500 text-white' 
                                      : step.active 
                                        ? 'bg-yellow-400 border-yellow-400 text-white animate-pulse' 
                                        : step.isRejected
                                          ? 'bg-red-400 border-red-400 text-white'
                                          : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-500 text-slate-400'
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
                                      step.done ? 'text-green-700 dark:text-green-400' 
                                        : step.active ? 'text-yellow-700 dark:text-yellow-400' 
                                        : step.isRejected ? 'text-red-600 dark:text-red-400'
                                        : 'text-slate-400 dark:text-slate-500'
                                    }`}>{step.label}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{step.desc}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-slate-500 dark:text-slate-400">{t("status.submittedOn")}</p>
                            <p className="font-medium text-slate-800 dark:text-slate-200">{formatDate(requestStatus.createdAt)}</p>
                          </div>
                        </div>

                        {requestStatus.status === 'approved' && (
                          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
                            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-2">
                              <CheckCircle className="w-5 h-5" />
                              <span className="font-semibold">{t("status.yourAccessKey")}</span>
                            </div>
                            <p className="text-sm text-green-600 dark:text-green-400 text-center mt-1">
                              {t("status.enterKeyHint")}
                            </p>
                            <Link href="/" className="block mt-3">
                              <Button className="w-full bg-green-600 hover:bg-green-700" data-testid="button-go-verify">
                                {t("status.enterPortal")}
                              </Button>
                            </Link>
                          </div>
                        )}

                        {requestStatus.status === 'rejected' && (() => {
                          const rejectionMsg = requestStatus.adminMessages
                            ?.find(m => m.message.startsWith('Request rejected: '));
                          const rejectionReason = rejectionMsg
                            ? rejectionMsg.message.replace(/^Request rejected:\s*/i, '')
                            : null;
                          return (
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 space-y-3">
                              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                                <XCircle className="w-5 h-5 shrink-0" />
                                <span className="font-semibold">{t("status.requestRejected")}</span>
                              </div>
                              <div className="bg-red-100 dark:bg-red-900/40 rounded-lg px-4 py-3">
                                <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-0.5">{t("status.reason")}</p>
                                <p className="text-sm text-red-700 dark:text-red-400">
                                  {rejectionReason || t("status.noReason")}
                                </p>
                              </div>
                              <p className="text-sm text-red-600 dark:text-red-400">
                                {t("status.rejectedHelp")}
                              </p>
                              <button
                                type="button"
                                onClick={handleReapply}
                                className="w-full py-2 rounded-lg border border-red-300 dark:border-red-700 text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                                data-testid="button-reapply-rejected"
                              >
                                {t("status.submitNew")}
                              </button>
                            </div>
                          );
                        })()}

                        {requestStatus.status === 'expired' && (
                          <div className="bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
                            <div className="flex items-center gap-2 text-gray-700 dark:text-gray-400">
                              <AlertTriangle className="w-5 h-5" />
                              <span className="font-semibold">{t("status.expiredTitle")}</span>
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {t("status.expiredHelp")}
                            </p>
                            <button
                              type="button"
                              onClick={handleReapply}
                              className="w-full py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors"
                              data-testid="button-reapply-expired"
                            >
                              {t("status.submitNew")}
                            </button>
                          </div>
                        )}

                        {requestStatus.status === 'pending' && (
                          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
                            <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400 mb-2">
                              <Clock className="w-5 h-5" />
                              <span className="font-semibold">{t("status.pendingTitle")}</span>
                            </div>
                            <p className="text-sm text-yellow-700 dark:text-yellow-400">
                              {t("status.pendingHelp")}
                            </p>
                          </div>
                        )}

                        {requestStatus.adminMessages && requestStatus.adminMessages.length > 0 && (() => {
                          const readCount = requestStatus.userMessagesReadCount ?? requestStatus.adminMessages.length;
                          const unreadCount = requestStatus.adminMessages.length - readCount;
                          return (
                            <div className="border-t border-slate-200 dark:border-slate-600 pt-4">
                              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                                <MessageSquare className="w-4 h-4" /> {t("status.messagesTitle")}
                                {unreadCount > 0 && (
                                  <Badge className="bg-blue-500 hover:bg-blue-500 text-white text-xs px-1.5 py-0 h-5">
                                    {t("status.messagesNew", { count: unreadCount })}
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
                                          ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-500/40 ring-1 ring-blue-400/30"
                                          : "bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600"
                                      }`}
                                    >
                                      {isNew && (
                                        <Badge className="mb-2 bg-blue-500 hover:bg-blue-500 text-white text-xs px-1.5 py-0 h-4">
                                          {t("status.messagesNewBadge")}
                                        </Badge>
                                      )}
                                      <p className="text-sm text-slate-800 dark:text-slate-200">{msg.message}</p>
                                      <p className="text-xs text-slate-400 mt-2">
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
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
                  <Lock className="h-4 w-4 mt-0.5 text-[#004182]" />
                  <p>
                    {t("footer.encryption")}
                  </p>
                </div>
              </div>
            </div>
          )}

          <p className="text-center text-slate-500 dark:text-white/60 text-sm mt-6">
            {t("footer.tagline")}
          </p>
        </div>
      </main>
      <ComplianceFooter variant="light" />
    </div>
  );
}
