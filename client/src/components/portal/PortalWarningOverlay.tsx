import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, LogOut, Clock, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePortal } from "@/pages/portal/PortalContext";
import { useTranslation } from "react-i18next";
import { showTawkto, isTawktoConfigured } from "@/lib/tawkto";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatCountdown(msLeft: number): { display: string; hasdays: boolean } {
  const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return { display: `${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`, hasdays: true };
  }
  if (hours > 0) {
    return { display: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`, hasdays: false };
  }
  return { display: `${pad(minutes)}:${pad(seconds)}`, hasdays: false };
}

export function PortalWarningOverlay() {
  const { t } = useTranslation("portal");
  const { activeWarning, warningDismissed, dismissWarning, logout } = usePortal();
  const [msLeft, setMsLeft] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track whether the countdown has ever been positive so we don't fire the
  // expiry callback immediately on mount if the warning is already expired.
  const hasSeenPositiveRef = useRef(false);
  // Once-guard: ensures the expiry logout fires at most once per warning so
  // that multiple interval ticks landing at 0 cannot call logout repeatedly.
  const logoutFiredRef = useRef(false);

  const tawktoReady = isTawktoConfigured();

  useEffect(() => {
    if (!activeWarning) {
      setMsLeft(0);
      hasSeenPositiveRef.current = false;
      logoutFiredRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Reset the once-guard whenever the warning object changes (new warning).
    hasSeenPositiveRef.current = false;
    logoutFiredRef.current = false;

    const expiresAt =
      activeWarning.warningAt.getTime() + activeWarning.minutesTotal * 60 * 1000;

    function tick() {
      const remaining = expiresAt - Date.now();
      setMsLeft(Math.max(0, remaining));
    }

    tick();
    intervalRef.current = setInterval(tick, 500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeWarning]);

  // UI-layer expiry callback: call logout once when the countdown reaches zero
  // after having been positive. Tracking hasSeenPositiveRef here (based on
  // the rendered msLeft) avoids the race where tick() sets the ref but the
  // state update hasn't been flushed yet, so the expiry check fires at mount
  // with msLeft still at its initial value of 0. PortalContext also handles
  // the canonical auto-logout via its own setTimeout; this effect is a
  // defensive safety net that also makes the expiry path unit-testable.
  useEffect(() => {
    if (msLeft > 0) {
      hasSeenPositiveRef.current = true;
    }
    if (
      activeWarning &&
      msLeft === 0 &&
      hasSeenPositiveRef.current &&
      !logoutFiredRef.current
    ) {
      logoutFiredRef.current = true;
      logout();
    }
  }, [msLeft, activeWarning, logout]);

  // Overlay is hidden (but warning still active) when user dismissed.
  if (!activeWarning || warningDismissed) return null;

  const isExpiring = msLeft <= 60_000;

  return (
    <AnimatePresence>
      <motion.div
        key="portal-warning-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-[9000] flex items-center justify-center"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(15,10,40,0.97) 0%, rgba(5,5,20,0.99) 100%)",
          backdropFilter: "blur(12px)",
        }}
        role="alertdialog"
        aria-modal="true"
        aria-label={t("closureWarning.ariaLabel")}
      >
        {/* Animated background orbs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-20"
            style={{
              background: isExpiring
                ? "radial-gradient(circle, #ef4444 0%, transparent 70%)"
                : "radial-gradient(circle, #f59e0b 0%, transparent 70%)",
            }}
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-20"
            style={{
              background: isExpiring
                ? "radial-gradient(circle, #ef4444 0%, transparent 70%)"
                : "radial-gradient(circle, #c8a951 0%, transparent 70%)",
            }}
            animate={{ scale: [1, 1.15, 1] }}
            transition={{
              repeat: Infinity,
              duration: 3,
              ease: "easeInOut",
              delay: 0.5,
            }}
          />
        </div>

        <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-lg w-full">
          {/* Icon */}
          <motion.div
            animate={
              isExpiring
                ? { scale: [1, 1.15, 1] }
                : { scale: 1 }
            }
            transition={{
              repeat: isExpiring ? Infinity : 0,
              duration: 0.8,
              ease: "easeInOut",
            }}
            className="mb-6"
          >
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-2xl"
              style={{
                background: isExpiring
                  ? "linear-gradient(135deg, #7f1d1d, #991b1b)"
                  : "linear-gradient(135deg, #78350f, #92400e)",
                boxShadow: isExpiring
                  ? "0 0 40px rgba(239,68,68,0.5)"
                  : "0 0 40px rgba(245,158,11,0.4)",
              }}
            >
              <AlertTriangle className="h-10 w-10 text-white" />
            </div>
          </motion.div>

          {/* Title */}
          <h1
            className="text-2xl font-bold mb-2"
            style={{ color: isExpiring ? "#fca5a5" : "#fbbf24" }}
          >
            {t("closureWarning.heading")}
          </h1>
          <p className="text-slate-300 text-sm mb-6 leading-relaxed">
            {activeWarning.message
              ? activeWarning.message
              : t("closureWarning.fallbackMessage")}
          </p>

          {/* Countdown */}
          <div
            className="rounded-2xl border px-12 py-6 mb-6"
            style={{
              background: isExpiring
                ? "rgba(127,29,29,0.25)"
                : "rgba(120,53,15,0.25)",
              borderColor: isExpiring
                ? "rgba(239,68,68,0.4)"
                : "rgba(245,158,11,0.3)",
            }}
          >
            <div className="flex items-center gap-3 mb-2 justify-center">
              <Clock
                className="h-4 w-4"
                style={{ color: isExpiring ? "#f87171" : "#fbbf24" }}
              />
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                {t("closureWarning.timeRemainingLabel")}
              </span>
            </div>
            <motion.div
              key={Math.floor(msLeft / 1000)}
              initial={{ scale: 1.05 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.15 }}
              className="text-6xl font-mono font-bold tabular-nums"
              style={{
                color: isExpiring ? "#f87171" : "#ffffff",
                textShadow: isExpiring
                  ? "0 0 30px rgba(239,68,68,0.6)"
                  : "0 0 20px rgba(255,255,255,0.2)",
              }}
            >
              {formatCountdown(msLeft).display}
            </motion.div>
            {formatCountdown(msLeft).hasdays && (
              <div className="flex gap-6 mt-1 text-[10px] text-slate-500 uppercase tracking-widest font-medium select-none justify-center">
                <span className="w-8 text-center">DD</span>
                <span className="w-8 text-center">HH</span>
                <span className="w-8 text-center">MM</span>
                <span className="w-8 text-center">SS</span>
              </div>
            )}
            <p className="text-slate-500 text-xs mt-2">
              {t("closureWarning.autoLogoutNote")}
            </p>
          </div>

          {/* Contact Support — shown only when Tawk.to is configured */}
          {tawktoReady && (
            <div
              className="rounded-2xl border border-blue-500/20 w-full mb-6 px-5 py-4"
              style={{ background: "rgba(30,58,138,0.15)" }}
              data-testid="contact-support-section"
            >
              <p className="text-slate-300 text-xs mb-3 leading-relaxed">
                Need help before time runs out? Connect with our support team now.
              </p>
              <Button
                onClick={showTawkto}
                className="w-full bg-blue-700 hover:bg-blue-600 text-white border-blue-600 font-medium"
                variant="outline"
                data-testid="button-contact-support"
              >
                <MessageCircle className="h-4 w-4 mr-2" />
                Contact Support
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
            <Button
              onClick={logout}
              className="flex-1 bg-red-700 hover:bg-red-600 text-white border-red-600"
              variant="outline"
            >
              <LogOut className="h-4 w-4 mr-2" />
              {t("closureWarning.logOutNow")}
            </Button>
            <Button
              onClick={dismissWarning}
              variant="outline"
              className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-800 bg-transparent"
              data-testid="button-dismiss-portal-warning"
            >
              {t("closureWarning.dismiss")}
            </Button>
          </div>
          <p className="text-slate-600 text-xs mt-4">
            {t("closureWarning.dismissNote")}
            <br />
            {t("closureWarning.autoLogoutNote")}
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
