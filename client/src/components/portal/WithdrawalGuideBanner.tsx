import React from "react";
import { motion } from "framer-motion";
import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

interface WithdrawalGuideBannerProps {
  customBody: string | null;
  emptyBodyFallback?: React.ReactNode;
  animated?: boolean;
}

export function WithdrawalGuideBanner({
  customBody,
  emptyBodyFallback,
  animated = true,
}: WithdrawalGuideBannerProps) {
  const { t } = useTranslation("portal");

  const steps: Array<{ titleKey: string; bodyKey: string }> = [
    { titleKey: "dashboard.withdrawalGuide.step1Title", bodyKey: "dashboard.withdrawalGuide.step1Body" },
    { titleKey: "dashboard.withdrawalGuide.step2Title", bodyKey: "dashboard.withdrawalGuide.step2Body" },
    { titleKey: "dashboard.withdrawalGuide.step3Title", bodyKey: "dashboard.withdrawalGuide.step3Body" },
    { titleKey: "dashboard.withdrawalGuide.step4Title", bodyKey: "dashboard.withdrawalGuide.step4Body" },
    { titleKey: "dashboard.withdrawalGuide.step5Title", bodyKey: "dashboard.withdrawalGuide.step5Body" },
    { titleKey: "dashboard.withdrawalGuide.step6Title", bodyKey: "dashboard.withdrawalGuide.step6Body" },
    { titleKey: "dashboard.withdrawalGuide.step7Title", bodyKey: "dashboard.withdrawalGuide.step7Body" },
  ];

  const hasCustomBody = typeof customBody === "string" && customBody.trim().length > 0;

  const containerStyle: React.CSSProperties = {
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(99,102,241,0.10), rgba(255,255,255,0.02))",
    border: "1px solid rgba(99,102,241,0.40)",
    boxShadow: "0 4px 28px rgba(59,130,246,0.15)",
  };

  const inner = (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-white/10">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(99,102,241,0.22)", border: "1px solid rgba(99,102,241,0.40)" }}
        >
          <BookOpen className="w-5 h-5 text-indigo-300" />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold text-indigo-300/80">
            {t("dashboard.withdrawalGuide.label")}
          </p>
          <h3 className="text-white font-bold text-base leading-tight">
            {t("dashboard.withdrawalGuide.title")}
          </h3>
        </div>
      </div>

      {/* Body — custom compliance copy when set, otherwise the fallback (default = step list) */}
      <div className="px-5 pt-4 pb-5">
        {hasCustomBody ? (
          <p
            className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap"
            data-testid="withdrawal-guide-custom-body"
          >
            {customBody}
          </p>
        ) : emptyBodyFallback !== undefined ? (
          emptyBodyFallback
        ) : (
          <>
            <p className="text-slate-300/80 text-sm mb-4">
              {t("dashboard.withdrawalGuide.body")}
            </p>
            <ol className="space-y-3" data-testid="withdrawal-guide-steps">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className="mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 text-indigo-200"
                    style={{ background: "rgba(99,102,241,0.25)", border: "1px solid rgba(99,102,241,0.40)" }}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm leading-tight">
                      {t(step.titleKey)}
                    </p>
                    <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">
                      {t(step.bodyKey)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </>
  );

  if (animated) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden"
        style={containerStyle}
        data-testid="banner-withdrawal-guide"
      >
        {inner}
      </motion.div>
    );
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={containerStyle}
      data-testid="banner-withdrawal-guide"
    >
      {inner}
    </div>
  );
}
