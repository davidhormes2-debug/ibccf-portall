import type { TFunction } from "i18next";
import { ViewState } from "./PortalContext";
import {
  CANONICAL_CASE_WORKFLOW,
  CANONICAL_CASE_STAGE_COUNT,
  getCanonicalWorkflowStep,
  toCanonicalCaseStage,
} from "@shared/canonicalWorkflow";

export type StageBlocker = "user_action" | "admin_action" | "system_processing";

export interface StageCta {
  stage: number;
  blocker: StageBlocker;
  ctaLabelKey: string;
  ctaView: ViewState;
  shortHeadlineKey: string;
}

const STAGE_CTAS: Record<number, Omit<StageCta, "stage">> = {
  1:  { blocker: "user_action",       ctaLabelKey: "stageCta.1.label",  ctaView: "dashboard",   shortHeadlineKey: "stageCta.1.headline" },
  2:  { blocker: "user_action",       ctaLabelKey: "stageCta.2.label",  ctaView: "submissions", shortHeadlineKey: "stageCta.2.headline" },
  3:  { blocker: "user_action",       ctaLabelKey: "stageCta.3.label",  ctaView: "letter",      shortHeadlineKey: "stageCta.3.headline" },
  4:  { blocker: "system_processing", ctaLabelKey: "stageCta.4.label",  ctaView: "dashboard",   shortHeadlineKey: "stageCta.4.headline" },
  5:  { blocker: "user_action",       ctaLabelKey: "stageCta.5.label",  ctaView: "documents",   shortHeadlineKey: "stageCta.5.headline" },
  6:  { blocker: "user_action",       ctaLabelKey: "stageCta.6.label",  ctaView: "declaration", shortHeadlineKey: "stageCta.6.headline" },
  7:  { blocker: "user_action",       ctaLabelKey: "stageCta.7.label",  ctaView: "walletConnect", shortHeadlineKey: "stageCta.7.headline" },
  8:  { blocker: "system_processing", ctaLabelKey: "stageCta.8.label",  ctaView: "dashboard",   shortHeadlineKey: "stageCta.8.headline" },
  9:  { blocker: "admin_action",      ctaLabelKey: "stageCta.9.label",  ctaView: "messages",    shortHeadlineKey: "stageCta.9.headline" },
  10: { blocker: "system_processing", ctaLabelKey: "stageCta.10.label", ctaView: "withdrawal",  shortHeadlineKey: "stageCta.10.headline" },
};

export function getStageCta(stage: number): StageCta {
  const safe = toCanonicalCaseStage(stage);
  const meta = STAGE_CTAS[safe];
  return { stage: safe, ...meta };
}

export function getStageTitle(stage: number): string {
  return getCanonicalWorkflowStep(stage).label;
}

export function getStageWhatsNext(stage: number): string {
  const safe = toCanonicalCaseStage(stage);
  if (safe >= CANONICAL_CASE_STAGE_COUNT) {
    return getCanonicalWorkflowStep(safe).description;
  }
  const next = CANONICAL_CASE_WORKFLOW[safe];
  return `Next: ${next.label}. ${next.description}`;
}

export function blockerLabel(b: StageBlocker, t: TFunction): string {
  switch (b) {
    case "user_action":
      return t("stageBlocker.userAction");
    case "admin_action":
      return t("stageBlocker.adminAction");
    case "system_processing":
      return t("stageBlocker.systemProcessing");
  }
}

export function blockerColors(b: StageBlocker): {
  badgeBg: string;
  badgeText: string;
  ring: string;
  glow: string;
  dot: string;
  stripe: string;
} {
  switch (b) {
    case "user_action":
      return {
        badgeBg: "bg-amber-500/20",
        badgeText: "text-amber-300",
        ring: "border-amber-400/50",
        glow: "rgba(245,158,11,0.30)",
        dot: "bg-amber-400",
        stripe: "from-amber-500 to-orange-600",
      };
    case "admin_action":
      return {
        badgeBg: "bg-blue-500/20",
        badgeText: "text-blue-300",
        ring: "border-blue-400/50",
        glow: "rgba(59,130,246,0.30)",
        dot: "bg-blue-400",
        stripe: "from-blue-500 to-blue-700",
      };
    case "system_processing":
      return {
        badgeBg: "bg-slate-500/20",
        badgeText: "text-slate-300",
        ring: "border-slate-400/40",
        glow: "rgba(148,163,184,0.25)",
        dot: "bg-slate-400",
        stripe: "from-slate-500 to-slate-700",
      };
  }
}
