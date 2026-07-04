import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { AlertTriangle, MessageCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PremiumBackground } from "@/components/PremiumBackground";
import { showTawkto, isTawktoConfigured } from "@/lib/tawkto";
import { getPortalToken } from "@/lib/portalSession";

export default function ContactAdminPage() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"checking" | "active" | "inactive">("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const code =
      sessionStorage.getItem("caseAccessCode") ||
      new URLSearchParams(window.location.search).get("code") ||
      "";

    if (!code) {
      setStatus("inactive");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const portalToken = getPortalToken();
        const headers: Record<string, string> = {};
        if (portalToken) {
          headers["x-portal-session-token"] = portalToken;
        }

        const res = await fetch(`/api/cases/access/${encodeURIComponent(code)}`, { headers });
        if (!res.ok) {
          if (!cancelled) setStatus("inactive");
          return;
        }
        const data = await res.json();
        const { portalWarningAt, portalWarningMinutes, portalWarningMessage } = data;
        if (portalWarningAt && portalWarningMinutes) {
          const expiresAt =
            new Date(portalWarningAt).getTime() + portalWarningMinutes * 60 * 1000;
          if (Date.now() < expiresAt) {
            if (!cancelled) {
              setMessage(portalWarningMessage ?? null);
              setStatus("active");
            }
            return;
          }
        }
        if (!cancelled) setStatus("inactive");
      } catch {
        if (!cancelled) setStatus("inactive");
      }
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status === "inactive") {
      navigate("/dashboard");
    }
  }, [status, navigate]);

  useEffect(() => {
    if (status === "active" && isTawktoConfigured()) {
      showTawkto();
    }
  }, [status]);

  if (status === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (status === "inactive") {
    return null;
  }

  return (
    <div className="min-h-screen relative font-sans overflow-hidden">
      <PremiumBackground />
      <div className="relative z-10 flex flex-col items-center justify-center py-10 px-4 min-h-screen">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="w-full max-w-lg text-center"
        >
          <div className="relative inline-block mb-6">
            <div className="absolute inset-0 bg-amber-500 blur-2xl opacity-30 rounded-full scale-150" />
            <div className="relative w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-amber-600 to-amber-800 flex items-center justify-center shadow-2xl">
              <AlertTriangle className="h-10 w-10 text-white" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">Contact Support</h1>
          <p className="text-amber-300 text-xs uppercase tracking-widest mb-6">
            Portal Closure Warning — Live Assistance
          </p>

          {message && (
            <div
              className="rounded-2xl border border-amber-500/30 p-5 mb-6 text-left"
              style={{ background: "rgba(120,53,15,0.18)" }}
            >
              <p className="text-slate-200 text-sm leading-relaxed">{message}</p>
            </div>
          )}

          {isTawktoConfigured() ? (
            <div className="space-y-4">
              <p className="text-slate-300 text-sm leading-relaxed">
                Our support team is available to assist you before your session ends.
                Use the live chat below to speak with a representative.
              </p>
              <Button
                onClick={showTawkto}
                className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl py-3"
                data-testid="button-open-live-chat"
              >
                <MessageCircle className="h-5 w-5 mr-2" />
                Open Live Chat
              </Button>
            </div>
          ) : (
            <p className="text-slate-400 text-sm leading-relaxed">
              Please return to the portal and use the contact options available there,
              or check your email for support contact details.
            </p>
          )}

          <div className="mt-8">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
              data-testid="button-back-to-portal"
            >
              ← Return to Portal
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
