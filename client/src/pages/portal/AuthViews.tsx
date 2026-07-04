import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion, useMotionValue, useSpring, useTransform, useMotionTemplate } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Lock, Key, User, Mail, Phone, Shield, KeyRound, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { usePortal, Case, ViewState } from "./PortalContext";
import { PremiumBackground } from "@/components/PremiumBackground";
import { setPortalToken, getPortalToken } from "@/lib/portalSession";

// Build the X-User-Locale header from the persisted i18n choice. Used on
// the access-code fetches so the server can write the user's active
// locale to `cases.preferred_locale` (which drives admin-triggered
// transactional emails). Returns an empty headers object when storage
// is unavailable or the user hasn't picked a locale yet.
function localeHeaderForFetch(): HeadersInit {
  try {
    const v = localStorage.getItem("ibccf.locale");
    return v ? { "X-User-Locale": v } : {};
  } catch {
    return {};
  }
}

const _GlassCard = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`relative rounded-2xl overflow-hidden glass-dark-premium card-depth ${className}`}>
    {children}
  </div>
);

const canHoverQuery = typeof window !== "undefined"
  ? window.matchMedia("(hover: hover) and (pointer: fine)")
  : null;

const TiltCard = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotion();
  const canHover = canHoverQuery?.matches ?? false;
  const tiltEnabled = !prefersReduced && canHover;

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const glowX = useMotionValue(50);
  const glowY = useMotionValue(50);

  const springX = useSpring(mouseX, { stiffness: 180, damping: 18 });
  const springY = useSpring(mouseY, { stiffness: 180, damping: 18 });

  const rotateY = useTransform(springX, [-0.5, 0.5], [-8, 8]);
  const rotateX = useTransform(springY, [-0.5, 0.5], [8, -8]);
  const glowBg = useMotionTemplate`radial-gradient(circle at ${glowX}% ${glowY}%, rgba(255,255,255,0.07) 0%, transparent 55%)`;

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const { left, top, width, height } = ref.current.getBoundingClientRect();
    mouseX.set((e.clientX - left) / width - 0.5);
    mouseY.set((e.clientY - top) / height - 0.5);
    glowX.set(((e.clientX - left) / width) * 100);
    glowY.set(((e.clientY - top) / height) * 100);
  };

  const onMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
    glowX.set(50);
    glowY.set(50);
  };

  return (
    <motion.div
      ref={ref}
      className={`relative rounded-2xl overflow-hidden glass-dark-premium card-depth ${className}`}
      onMouseMove={tiltEnabled ? onMouseMove : undefined}
      onMouseLeave={tiltEnabled ? onMouseLeave : undefined}
      style={tiltEnabled ? { rotateX, rotateY, transformPerspective: 1000 } : undefined}
    >
      {tiltEnabled && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 rounded-2xl"
          style={{ background: glowBg }}
        />
      )}
      {children}
    </motion.div>
  );
};

const PremiumInput = ({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <Input
    className={`bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl ${className}`}
    {...props}
  />
);

export function LoginView() {
  const { t } = useTranslation("portal");
  const { setCurrentCase, setAccessCode, setViewState } = usePortal();
  const [localAccessCode, setLocalAccessCode] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"code" | "pin">("code");
  const [isLoading, setIsLoading] = useState(false);
  const [pinLockoutSecs, setPinLockoutSecs] = useState(0);
  const directionRef = useRef<1 | -1>(1);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    if (pinLockoutSecs <= 0) return;
    const id = window.setTimeout(() => {
      setPinLockoutSecs((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [pinLockoutSecs]);

  const getRedirectParam = () => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    return params.get("redirect") || null;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (step === "code") {
        const verifyRes = await fetch("/api/cases/verify-access-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCode: localAccessCode }),
        });

        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();

          if (!verifyData.hasPinSet) {
            sessionStorage.setItem("caseAccessCode", localAccessCode);
            sessionStorage.setItem("caseId", verifyData.caseId);
            sessionStorage.setItem("requiresPinSetup", "true");

            const response = await fetch(`/api/cases/access/${localAccessCode}`, { headers: localeHeaderForFetch() });
            if (response.ok) {
              const foundCase = await response.json();
              setCurrentCase(foundCase);
              setAccessCode(localAccessCode);
              setViewState("register");
            } else if (response.status === 403) {
              setAccessCode(localAccessCode);
              setViewState("reactivationDeposit");
            }
          } else {
            directionRef.current = 1;
            setStep("pin");
            toast({ title: t("auth.login.toast.pinRequiredTitle"), description: t("auth.login.toast.pinRequiredDesc") });
          }
        } else {
          toast({ variant: "destructive", title: t("auth.login.toast.accessDeniedTitle"), description: t("auth.login.toast.accessDeniedDesc") });
        }
      } else {
        const res = await fetch("/api/cases/login-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCode: localAccessCode, pin }),
        });

        if (res.ok) {
          const data = await res.json();
          sessionStorage.setItem("caseAccessCode", data.accessCode);
          sessionStorage.setItem("caseId", data.id);
          sessionStorage.setItem("pinVerified", "true");
          const freshSessionToken = data.sessionToken ?? "";
          if (freshSessionToken) {
            setPortalToken(freshSessionToken);
          }
          // Stamp login time so we can detect admin force-logout on refresh
          try {
            localStorage.setItem("ibccf_portal_login_at", String(Date.now()));
          } catch {
            // ignore storage failure
          }

          const response = await fetch(`/api/cases/access/${localAccessCode}`, {
            headers: {
              ...localeHeaderForFetch(),
              ...(freshSessionToken ? { "x-portal-session-token": freshSessionToken } : {}),
            },
          });
          if (response.ok) {
            const foundCase: Case = await response.json();
            setCurrentCase(foundCase);
            setAccessCode(localAccessCode);

            const validViews: ViewState[] = ['dashboard', 'letter', 'messages', 'submissions', 'deposit', 'timeline', 'keyRequest', 'declaration', 'settings'];
            const requestedView = (() => {
              try {
                const v = new URLSearchParams(window.location.search).get('view');
                return v && (validViews as string[]).includes(v) ? (v as ViewState) : null;
              } catch { return null; }
            })();
            const landingPage = (requestedView ?? foundCase.landingPage ?? "dashboard") as ViewState;
            if (foundCase.status === "active") setViewState(landingPage);
            else if (foundCase.status === "syncing") setViewState("sync");
            else if (foundCase.status === "completed") setViewState(landingPage);
            else setViewState("register");

            toast({ title: t("auth.login.toast.verifiedTitle"), description: t("auth.login.toast.verifiedDesc") });

            // Redirect to the page the user came from, if any
            const redirectTo = getRedirectParam();
            if (redirectTo && foundCase.status === "active") {
              setTimeout(() => navigate(redirectTo), 100);
            }
          }
        } else if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          const retryAfter = typeof data?.retryAfter === "number" ? data.retryAfter : 60;
          setPinLockoutSecs(retryAfter);
        } else if (res.status === 403) {
          setAccessCode(localAccessCode);
          setViewState("reactivationDeposit");
        } else {
          toast({ variant: "destructive", title: t("auth.login.toast.invalidPinTitle"), description: t("auth.login.toast.invalidPinDesc") });
        }
      }
    } catch {
      toast({ variant: "destructive", title: t("auth.login.toast.connectionTitle"), description: t("auth.login.toast.connectionDesc") });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] relative font-sans how-it-works-bg overflow-hidden">
      <PremiumBackground />
      <div className="absolute inset-0 overflow-y-auto flex flex-col items-center justify-start sm:justify-center py-8 px-3 sm:px-4">
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.4 }} className="relative max-w-md w-full z-10">
        {/* Logo / brand */}
        <div className="text-center mb-5 sm:mb-8">
          <div className="relative inline-block mb-4 sm:mb-5" data-testid="img-logo">
            <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-50 rounded-full scale-150" />
            <div className="relative w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-2xl bg-gradient-to-br from-[#004182] to-[#0066cc] flex items-center justify-center shadow-2xl" style={{ boxShadow: "0 8px 32px rgba(0,65,130,0.5)" }}>
              <Shield className="h-8 w-8 sm:h-10 sm:w-10 text-white" />
            </div>
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-white tracking-wider mb-1">{t("auth.login.title")}</h1>
          <p className="text-blue-300 text-xs uppercase tracking-widest">{t("auth.login.subtitle")}</p>
          <div className="flex items-center justify-center gap-1.5 mt-3">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-[10px] text-emerald-400 uppercase tracking-widest font-medium">{t("auth.login.connectionActive")}</span>
          </div>
        </div>

        <TiltCard>
          <div
            className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2 text-center border-b border-white/10"
            style={{ background: "linear-gradient(135deg, rgba(0,65,130,0.3), rgba(0,102,204,0.1))" }}
          >
            <div className="flex items-center justify-center gap-2 text-white font-bold mb-1">
              <Lock className="w-4 h-4 text-blue-400" />
              <span>{t("auth.login.cardTitle")}</span>
            </div>
            <p className="text-slate-400 text-xs pb-3 sm:pb-4">{t("auth.login.cardSubtitle")}</p>
          </div>

          <form onSubmit={handleLogin} className="p-4 sm:p-6 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                className="space-y-4"
                initial={prefersReduced ? { opacity: 0 } : { opacity: 0, x: directionRef.current * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={prefersReduced ? { opacity: 0 } : { opacity: 0, x: directionRef.current * -24 }}
                transition={{ duration: prefersReduced ? 0 : 0.22, ease: "easeOut" }}
              >
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {step === "code" ? t("auth.login.codeLabel") : t("auth.login.accessCodeLabel")}
                  </label>
                  <div className="relative">
                    <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <PremiumInput
                      type="password"
                      placeholder={t("auth.login.codePlaceholder")}
                      className="pl-9"
                      value={localAccessCode}
                      onChange={(e) => setLocalAccessCode(e.target.value)}
                      disabled={step === "pin"}
                      data-testid="input-access-code"
                    />
                  </div>
                </div>

                {step === "pin" && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("auth.login.pinLabel")}</label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <PremiumInput
                        type="password"
                        placeholder={t("auth.login.pinPlaceholder")}
                        maxLength={6}
                        className="pl-9 text-center tracking-widest font-mono"
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        autoFocus
                        disabled={pinLockoutSecs > 0}
                        data-testid="input-pin"
                      />
                    </div>
                    {pinLockoutSecs > 0 && (
                      <p className="text-sm text-amber-400 flex items-center gap-1.5" data-testid="login-lockout-message">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {t("shell.sessionExpiry.lockedCountdown", {
                          time: pinLockoutSecs >= 60
                            ? `${Math.floor(pinLockoutSecs / 60)}m ${pinLockoutSecs % 60}s`
                            : `${pinLockoutSecs}s`,
                        })}
                      </p>
                    )}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold shadow-lg mt-2"
                  style={{ boxShadow: "0 4px 16px rgba(0,65,130,0.35)" }}
                  disabled={isLoading || pinLockoutSecs > 0}
                  data-testid="button-login"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {t("auth.login.verifying")}
                    </span>
                  ) : (
                    step === "code" ? t("auth.login.continue") : t("auth.login.verify")
                  )}
                </Button>

                {step === "pin" && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-slate-400 hover:text-white rounded-xl"
                    onClick={() => { directionRef.current = -1; setStep("code"); setPin(""); }}
                  >
                    {t("auth.login.useDifferentCode")}
                  </Button>
                )}
              </motion.div>
            </AnimatePresence>
          </form>

          <div className="px-4 sm:px-6 pb-4 sm:pb-5 flex justify-center border-t border-white/10 pt-3 sm:pt-4">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider">
              <ShieldCheck className="w-3 h-3" />
              <span>{t("auth.login.sslBadge")}</span>
            </div>
          </div>
        </TiltCard>
      </motion.div>
      </div>
    </div>
  );
}

export function RegisterView() {
  const { t } = useTranslation("portal");
  const { currentCase, setCurrentCase, setViewState, setAccessCode, accessCode: contextAccessCode } = usePortal();
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regMobile, setRegMobile] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [_syncProgress, setSyncProgress] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const prefersReduced = useReducedMotion();

  const accessCode = contextAccessCode || sessionStorage.getItem("caseAccessCode") || "";

  if (!currentCase) {
    return (
      <div className="relative min-h-screen flex items-center justify-center p-4 font-sans how-it-works-bg">
        <PremiumBackground />
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative z-10 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin" />
          <p className="text-slate-400 text-sm">{t("auth.register.loadingProfile")}</p>
        </motion.div>
      </div>
    );
  }

  const startSyncSimulation = async (caseData: { id: string; userName: string; userEmail: string; userMobile: string }) => {
    const steps = [
      { progress: 15 }, { progress: 30 }, { progress: 45 },
      { progress: 60 }, { progress: 75 }, { progress: 90 }, { progress: 100 },
    ];
    let index = 0;
    const interval = setInterval(async () => {
      if (index < steps.length) {
        setSyncProgress(steps[index].progress);
        index++;
      } else {
        clearInterval(interval);
        try {
          const portalToken = getPortalToken();
          await fetch(`/api/cases/${caseData.id}/register`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...(portalToken ? { "x-portal-session-token": portalToken } : {}) },
            body: JSON.stringify({ userName: caseData.userName, userEmail: caseData.userEmail, userMobile: caseData.userMobile, status: "active" }),
          });
        } catch {}
        setViewState("dashboard");
      }
    }, 1200);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    if (!accessCode) {
      toast({ variant: "destructive", title: t("auth.register.toast.sessionErrorTitle"), description: t("auth.register.toast.sessionErrorDesc") });
      setIsSubmitting(false);
      return;
    }

    if (!newPin || newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      toast({ variant: "destructive", title: t("auth.register.toast.invalidPinTitle"), description: t("auth.register.toast.invalidPinDesc") });
      setIsSubmitting(false);
      return;
    }

    if (newPin !== confirmPin) {
      toast({ variant: "destructive", title: t("auth.register.toast.pinMismatchTitle"), description: t("auth.register.toast.pinMismatchDesc") });
      setIsSubmitting(false);
      return;
    }

    try {
      const pinResponse = await fetch("/api/cases/set-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode, pin: newPin }),
      });

      if (!pinResponse.ok) {
        if (pinResponse.status === 403) {
          setAccessCode(accessCode);
          setViewState("reactivationDeposit");
          return;
        }
        const pinError = await pinResponse.json();
        toast({ variant: "destructive", title: t("auth.register.toast.pinSetupFailedTitle"), description: pinError.error || t("auth.register.toast.pinSetupFailedDesc") });
        setIsSubmitting(false);
        return;
      }

      sessionStorage.setItem("pinVerified", "true");
      sessionStorage.removeItem("requiresPinSetup");

      const pinData = await pinResponse.json().catch(() => ({}));
      if (pinData?.sessionToken) {
        setPortalToken(pinData.sessionToken);
      }

      const portalToken = getPortalToken();
      const response = await fetch(`/api/cases/${currentCase.id}/register`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(portalToken ? { "x-portal-session-token": portalToken } : {}) },
        body: JSON.stringify({ status: "syncing", userName: regName, userEmail: regEmail, userMobile: regMobile }),
      });

      if (response.ok) {
        const updatedCase = await response.json();
        setCurrentCase(updatedCase);
        setViewState("sync");
        startSyncSimulation({ id: updatedCase.id, userName: regName, userEmail: regEmail, userMobile: regMobile });
      } else {
        toast({ variant: "destructive", title: t("auth.register.toast.failedTitle"), description: t("auth.register.toast.failedDesc") });
        setIsSubmitting(false);
      }
    } catch {
      toast({ variant: "destructive", title: t("auth.register.toast.connectionTitle"), description: t("auth.register.toast.connectionDesc") });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="h-[100dvh] relative font-sans how-it-works-bg overflow-hidden">
      <PremiumBackground />
      <div className="absolute inset-0 overflow-y-auto flex flex-col items-center justify-start sm:justify-center py-8 px-4">
      <motion.div
        initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: prefersReduced ? 0 : 0.22, ease: "easeOut" }}
        className="relative max-w-md w-full z-10"
      >
        <div className="text-center mb-6">
          <div className="relative inline-block mb-3">
            <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-40 rounded-full scale-150" />
            <div className="relative w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-[#004182] to-[#0066cc] flex items-center justify-center shadow-2xl">
              <Shield className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-lg font-bold text-white">{t("auth.register.title")}</h1>
          <p className="text-blue-300 text-xs mt-1">{t("auth.register.subtitle")}</p>
        </div>

        <TiltCard>
          <form onSubmit={handleRegister} className="p-6 space-y-4">
            {[
              { label: t("auth.register.fullName"), Icon: User, value: regName, onChange: setRegName, type: "text", placeholder: t("auth.register.fullNamePlaceholder"), testId: "input-name" },
              { label: t("auth.register.email"), Icon: Mail, value: regEmail, onChange: setRegEmail, type: "email", placeholder: t("auth.register.emailPlaceholder"), testId: "input-email" },
              { label: t("auth.register.mobile"), Icon: Phone, value: regMobile, onChange: setRegMobile, type: "tel", placeholder: t("auth.register.mobilePlaceholder"), testId: "input-mobile" },
            ].map(({ label, Icon, value, onChange, type, placeholder, testId }) => (
              <div key={label} className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</label>
                <div className="relative">
                  <Icon className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <PremiumInput required value={value} onChange={e => onChange(e.target.value)} type={type} placeholder={placeholder} className="pl-9" data-testid={testId} />
                </div>
              </div>
            ))}

            <div className="pt-3 border-t border-white/10">
              <p className="text-xs text-slate-400 mb-4">{t("auth.register.pinIntro")}</p>
              <div className="space-y-3">
                {[
                  { label: t("auth.register.createPin"), value: newPin, onChange: setNewPin, testId: "input-new-pin" },
                  { label: t("auth.register.confirmPin"), value: confirmPin, onChange: setConfirmPin, testId: "input-confirm-pin" },
                ].map(({ label, value, onChange, testId }) => (
                  <div key={label} className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <PremiumInput
                        required
                        type="password"
                        value={value}
                        onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        className="pl-9 text-center tracking-widest font-mono"
                        placeholder={t("auth.register.pinPlaceholder")}
                        maxLength={6}
                        data-testid={testId}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button
              type="submit"
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold shadow-lg"
              style={{ boxShadow: "0 4px 16px rgba(0,65,130,0.35)" }}
              data-testid="button-register"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t("auth.register.processing")}
                </span>
              ) : (
                t("auth.register.proceed")
              )}
            </Button>
          </form>
        </TiltCard>
      </motion.div>
      </div>
    </div>
  );
}

interface SyncViewProps {
  syncProgress?: number;
  syncStatusText?: string;
}

export function SyncView({ syncProgress = 75, syncStatusText }: SyncViewProps) {
  const { t } = useTranslation("portal");
  const { setViewState, currentCase, setCurrentCase } = usePortal();
  const prefersReduced = useReducedMotion();
  const statusText = syncStatusText ?? t("auth.sync.defaultStatus");

  React.useEffect(() => {
    const timer = setTimeout(async () => {
      if (currentCase) {
        try {
          const portalToken = getPortalToken();
          await fetch(`/api/cases/${currentCase.id}/register`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...(portalToken ? { "x-portal-session-token": portalToken } : {}) },
            body: JSON.stringify({ status: "active" }),
          });
          setCurrentCase({ ...currentCase, status: "active" });
        } catch {}
      }
      setViewState("dashboard");
    }, 5000);
    return () => clearTimeout(timer);
  }, [currentCase, setViewState, setCurrentCase]);

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 font-sans how-it-works-bg">
      <PremiumBackground />
      <motion.div
        initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: prefersReduced ? 0 : 0.22, ease: "easeOut" }}
        className="relative z-10 max-w-md w-full text-center"
      >
        <div className="mb-8 relative inline-block">
          <div className="absolute inset-0 bg-blue-500 blur-3xl opacity-30 scale-150" />
          <div className="relative w-24 h-24 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin mx-auto" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Lock className="w-10 h-10 text-blue-400" />
          </div>
        </div>

        <h2 className="text-2xl font-bold text-white mb-2">{t("auth.sync.title")}</h2>
        <p className="text-slate-400 text-sm mb-8 h-6">{statusText}</p>

        <div className="bg-slate-800/60 rounded-full h-2 mb-2 overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          <motion.div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full"
            initial={{ width: "0%" }}
            animate={{ width: `${syncProgress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-500 font-mono mb-8">
          <span>{t("auth.sync.protocolLabel")}</span>
          <span>{syncProgress}%</span>
        </div>

        <AnimatePresence>
          {syncProgress >= 90 && (
            <motion.div
              initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: prefersReduced ? 0 : 0.3, ease: "easeOut" }}
              className="p-4 rounded-xl text-amber-400 text-xs animate-pulse"
              style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}
            >
              {t("auth.sync.waitClearance")}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
