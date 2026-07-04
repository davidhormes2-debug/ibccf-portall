import type { TFunction } from "i18next";
import { ViewState } from "./PortalContext";
import { getStageInstruction } from "@shared/stageInstructions";

export type StageBlocker = "user_action" | "admin_action" | "system_processing";

export interface StageCta {
  stage: number;
  blocker: StageBlocker;
  ctaLabelKey: string;
  ctaView: ViewState;
  shortHeadlineKey: string;
}

const STAGE_CTAS: Record<number, Omit<StageCta, "stage">> = {
  1:  { blocker: "system_processing", ctaLabelKey: "stageCta.1.label",  ctaView: "messages",              shortHeadlineKey: "stageCta.1.headline" },
  2:  { blocker: "system_processing", ctaLabelKey: "stageCta.2.label",  ctaView: "messages",              shortHeadlineKey: "stageCta.2.headline" },
  3:  { blocker: "user_action",       ctaLabelKey: "stageCta.3.label",  ctaView: "messages",              shortHeadlineKey: "stageCta.3.headline" },
  4:  { blocker: "user_action",       ctaLabelKey: "stageCta.4.label",  ctaView: "letter",                shortHeadlineKey: "stageCta.4.headline" },
  5:  { blocker: "admin_action",      ctaLabelKey: "stageCta.5.label",  ctaView: "submissions",           shortHeadlineKey: "stageCta.5.headline" },
  6:  { blocker: "admin_action",      ctaLabelKey: "stageCta.6.label",  ctaView: "messages",              shortHeadlineKey: "stageCta.6.headline" },
  7:  { blocker: "user_action",       ctaLabelKey: "stageCta.7.label",  ctaView: "deposit",               shortHeadlineKey: "stageCta.7.headline" },
  8:  { blocker: "admin_action",      ctaLabelKey: "stageCta.8.label",  ctaView: "deposit",               shortHeadlineKey: "stageCta.8.headline" },
  9:  { blocker: "system_processing", ctaLabelKey: "stageCta.9.label",  ctaView: "dashboard",             shortHeadlineKey: "stageCta.9.headline" },
  10: { blocker: "user_action",       ctaLabelKey: "stageCta.10.label", ctaView: "deposit",               shortHeadlineKey: "stageCta.10.headline" },
  11: { blocker: "user_action",       ctaLabelKey: "stageCta.11.label", ctaView: "declaration",           shortHeadlineKey: "stageCta.11.headline" },
  12: { blocker: "admin_action",      ctaLabelKey: "stageCta.12.label", ctaView: "messages",              shortHeadlineKey: "stageCta.12.headline" },
  13: { blocker: "user_action",       ctaLabelKey: "stageCta.13.label", ctaView: "messages",              shortHeadlineKey: "stageCta.13.headline" },
  14: { blocker: "user_action",       ctaLabelKey: "stageCta.14.label", ctaView: "withdrawalActivation",  shortHeadlineKey: "stageCta.14.headline" },
};

export function getStageCta(stage: number): StageCta {
  const safe = Math.min(Math.max(stage || 1, 1), 14);
  const meta = STAGE_CTAS[safe];
  return { stage: safe, ...meta };
}

export function getStageTitle(stage: number): string {
  return getStageInstruction(stage).title;
}

export function getStageWhatsNext(stage: number): string {
  const i = getStageInstruction(stage);
  return i.whatToExpect || i.summary;
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
