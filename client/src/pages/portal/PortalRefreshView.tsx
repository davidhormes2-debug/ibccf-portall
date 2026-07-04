import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Clock, LogOut, Wifi } from "lucide-react";
import { usePortal } from "./PortalContext";

export function PortalRefreshView() {
  const { logout } = usePortal();
  const [dots, setDots] = useState(".");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const dotsInterval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "." : d + "."));
    }, 600);
    const elapsedInterval = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);
    return () => {
      clearInterval(dotsInterval);
      clearInterval(elapsedInterval);
    };
  }, []);

  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m ${rem}s`;
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{
        background:
          "radial-gradient(ellipse at 20% 30%, rgba(30,60,180,0.18) 0%, transparent 60%), radial-gradient(ellipse at 80% 70%, rgba(120,40,200,0.12) 0%, transparent 55%), #060d1f",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-lg"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
              <Wifi className="w-4 h-4 text-blue-400" />
            </div>
            <span className="text-sm font-semibold text-blue-400 tracking-wide uppercase">
              System Notice
            </span>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>

        <div
          className="rounded-2xl border border-white/10 p-7 space-y-6"
          style={{
            background: "rgba(10, 20, 60, 0.72)",
            backdropFilter: "blur(20px)",
            boxShadow:
              "0 4px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          <div className="flex flex-col items-center text-center space-y-4 py-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
                >
                  <RefreshCw className="w-9 h-9 text-blue-400" />
                </motion.div>
              </div>
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-amber-500/90 border-2 border-[#060d1f] flex items-center justify-center">
                <Clock className="w-2.5 h-2.5 text-white" />
              </span>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-white leading-tight">
                Portal Refresh in Progress
              </h1>
              <p className="text-sm text-slate-400 leading-relaxed max-w-sm">
                The client portal is undergoing a scheduled system refresh. This
                is a routine update and your account and case data remain fully
                intact.
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-white/5 border border-white/8 divide-y divide-white/8">
            <div className="flex items-center gap-3 p-4">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
              <p className="text-sm text-slate-300">
                Refresh in progress{dots}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 p-4">
              <p className="text-xs text-slate-500">Access will be automatically restored once complete.</p>
              <span className="text-xs font-mono text-slate-500 shrink-0">
                {formatElapsed(elapsed)}
              </span>
            </div>
          </div>

          <div className="rounded-xl bg-blue-500/8 border border-blue-500/20 p-4 space-y-2">
            <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">
              What this means
            </p>
            <ul className="space-y-1.5 text-xs text-slate-400 leading-relaxed list-none">
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">•</span>
                Your case progress and documents are unaffected.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">•</span>
                The portal will resume automatically — no action required.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">•</span>
                If this persists beyond 30 minutes, contact your case handler.
              </li>
            </ul>
          </div>
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          IBCCF Compliance Portal &mdash; Scheduled Maintenance
        </p>
      </motion.div>
    </div>
  );
}
