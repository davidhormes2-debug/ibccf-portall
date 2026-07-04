import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Copy, Check, Upload, Loader2, CheckCircle2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";
import { PremiumBackground } from "@/components/PremiumBackground";

interface ReactivationInfo {
  caseId: string;
  depositAddress: string | null;
  depositAsset: string;
  depositNetwork: string;
  reactivationAmount: string | null;
  portalWarningMessage: string | null;
  reactivationPageMessage: string | null;
}

function CopyButton({ text, "data-testid": testId }: { text: string; "data-testid"?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={copy}
      data-testid={testId}
      className="ml-1.5 p-1 rounded text-blue-300 hover:text-white transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function ReactivationDepositView() {
  const { t } = useTranslation("portal");
  const { accessCode, setViewState, lockoutReason } = usePortal();
  const { toast } = useToast();

  const [info, setInfo] = useState<ReactivationInfo | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const reactivationPageMessage = info?.reactivationPageMessage ?? info?.portalWarningMessage ?? null;

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const code = accessCode || sessionStorage.getItem("caseAccessCode") || "";

  useEffect(() => {
    if (!code) {
      setLoading(false);
      setLoadError(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/cases/access/${encodeURIComponent(code)}/reactivation-info`);
        if (res.status === 410) {
          // 410 means the account is NOT disabled (server-side guard against
          // probing deposit addresses on working accounts). Reaching this
          // view for an enabled account is a client-side routing bug, not a
          // load failure — never surface the generic error panel here.
          // Send the user back to login (or their dashboard, if a session
          // is already restored) instead of a dead-end error state.
          if (!cancelled) {
            setLoading(false);
            setViewState("login");
          }
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setInfo(data as ReactivationInfo);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code, setViewState]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      toast({ title: t("reactivationDeposit.upload.tooLargeTitle"), description: t("reactivationDeposit.upload.tooLargeDesc"), variant: "destructive" });
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
    if (!allowed.includes(f.type)) {
      toast({ title: t("reactivationDeposit.upload.badFormatTitle"), description: t("reactivationDeposit.upload.badFormatDesc"), variant: "destructive" });
      return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  const handleSubmit = async () => {
    if (!file || !preview || !code) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/cases/access/${encodeURIComponent(code)}/reactivation-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: preview, fileName: file.name }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        const data = await res.json().catch(() => ({}));
        toast({ title: t("reactivationDeposit.upload.failedTitle"), description: data.error ?? t("reactivationDeposit.upload.failedDesc"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("reactivationDeposit.upload.networkTitle"), description: t("reactivationDeposit.upload.networkDesc"), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative font-sans how-it-works-bg overflow-hidden">
      <PremiumBackground />
      <div className="relative z-10 flex flex-col items-center justify-start sm:justify-center py-10 px-4 min-h-screen">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="w-full max-w-lg"
        >
          {/* Header */}
          <div className="text-center mb-6">
            <div className="relative inline-block mb-4">
              <div className="absolute inset-0 bg-amber-500 blur-2xl opacity-30 rounded-full scale-150" />
              <div className="relative w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-600 to-amber-800 flex items-center justify-center shadow-2xl">
                <AlertTriangle className="h-8 w-8 text-white" />
              </div>
            </div>
            <h1 className="text-xl font-bold text-white tracking-wide mb-1">
              {t("reactivationDeposit.title")}
            </h1>
            <p className="text-amber-300 text-xs uppercase tracking-widest">
              {t("reactivationDeposit.subtitle")}
            </p>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          )}

          {!loading && loadError && (
            <div className="rounded-2xl glass-dark-premium card-depth p-6 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
              <p className="text-white font-semibold mb-1">{t("reactivationDeposit.loadError.title")}</p>
              <p className="text-slate-400 text-sm mb-4">{t("reactivationDeposit.loadError.body")}</p>
              <Button
                variant="ghost"
                className="text-blue-400 hover:text-white"
                onClick={() => setViewState("login")}
              >
                {t("reactivationDeposit.backToLogin")}
              </Button>
            </div>
          )}

          {!loading && !loadError && info && (
            <div className="space-y-4">
              {/* Suspension notice */}
              <div className="rounded-2xl glass-dark-premium card-depth p-5 border border-amber-500/20">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-white font-semibold text-sm mb-1">{t("reactivationDeposit.notice.title")}</p>
                    <p className="text-slate-300 text-sm leading-relaxed" data-testid="reactivation-notice-body">
                      {reactivationPageMessage || (
                        lockoutReason === 'warning_expired'
                          ? t("reactivationDeposit.notice.bodyWarningExpired")
                          : lockoutReason === 'admin_disabled'
                            ? t("reactivationDeposit.notice.bodyAdminDisabled")
                            : t("reactivationDeposit.notice.body")
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Deposit address card */}
              {info.depositAddress && (
                <div className="rounded-2xl glass-dark-premium card-depth p-5 space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-4 h-4 text-blue-400" />
                    <h2 className="text-white font-semibold text-sm">{t("reactivationDeposit.deposit.title")}</h2>
                  </div>

                  {info.reactivationAmount && (
                    <div className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/10">
                      <span className="text-slate-400 text-xs uppercase tracking-wider">{t("reactivationDeposit.deposit.amountLabel")}</span>
                      <span className="text-white font-bold text-base">
                        {info.reactivationAmount} {info.depositAsset}
                      </span>
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-xs uppercase tracking-wider">{t("reactivationDeposit.deposit.addressLabel")}</span>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-300">
                          {info.depositAsset}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
                          {info.depositNetwork}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-white/5 rounded-xl px-4 py-3 border border-white/10">
                      <p
                        className="text-white text-xs font-mono break-all flex-1"
                        data-testid="reactivation-deposit-address"
                      >
                        {info.depositAddress}
                      </p>
                      <CopyButton text={info.depositAddress} data-testid="button-copy-deposit-address" />
                    </div>
                  </div>

                  <p className="text-slate-500 text-xs">{t("reactivationDeposit.deposit.hint")}</p>
                </div>
              )}

              {!info.depositAddress && (
                <div className="rounded-2xl glass-dark-premium card-depth p-5 text-center">
                  <p className="text-slate-400 text-sm">{t("reactivationDeposit.deposit.noAddress")}</p>
                </div>
              )}

              {/* Upload section */}
              {!submitted ? (
                <div className="rounded-2xl glass-dark-premium card-depth p-5 space-y-4">
                  <h2 className="text-white font-semibold text-sm">{t("reactivationDeposit.upload.title")}</h2>
                  <p className="text-slate-400 text-xs leading-relaxed">{t("reactivationDeposit.upload.body")}</p>

                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    className="sr-only"
                    onChange={handleFile}
                    data-testid="input-reactivation-file"
                  />

                  {file ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/10">
                        <Upload className="w-4 h-4 text-blue-400 shrink-0" />
                        <span className="text-white text-sm truncate flex-1">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => { setFile(null); setPreview(null); }}
                          className="text-slate-400 hover:text-white text-xs"
                        >
                          {t("reactivationDeposit.upload.change")}
                        </button>
                      </div>
                      <Button
                        className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold"
                        onClick={handleSubmit}
                        disabled={submitting}
                        data-testid="button-submit-reactivation-receipt"
                      >
                        {submitting ? (
                          <span className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t("reactivationDeposit.upload.submitting")}
                          </span>
                        ) : t("reactivationDeposit.upload.submit")}
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-white/20 hover:border-blue-500/50 hover:bg-white/5 transition-all text-slate-400 hover:text-white"
                      data-testid="button-select-reactivation-file"
                    >
                      <Upload className="w-6 h-6" />
                      <span className="text-sm font-medium">{t("reactivationDeposit.upload.cta")}</span>
                      <span className="text-xs text-slate-500">{t("reactivationDeposit.upload.hint")}</span>
                    </button>
                  )}
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="rounded-2xl glass-dark-premium card-depth p-6 text-center border border-emerald-500/20"
                  data-testid="reactivation-submitted-confirmation"
                >
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                  <p className="text-white font-semibold mb-1">{t("reactivationDeposit.confirmation.title")}</p>
                  <p className="text-slate-300 text-sm leading-relaxed">{t("reactivationDeposit.confirmation.body")}</p>
                </motion.div>
              )}

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setViewState("login")}
                  className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
                  data-testid="button-back-to-login"
                >
                  {t("reactivationDeposit.backToLogin")}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
