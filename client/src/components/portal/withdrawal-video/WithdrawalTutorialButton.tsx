import { useState } from "react";
import { PlayCircle, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLocale } from "@/i18n/useLocale";
import { WithdrawalTutorialVideo } from "./WithdrawalTutorialVideo";

/**
 * A dismissible entry point that surfaces the animated withdrawal tutorial
 * video. The video only mounts (and starts playing) once the dialog opens,
 * and unmounts when it closes, so nothing plays unexpectedly behind the portal.
 */
export function WithdrawalTutorialButton() {
  const { t } = useTranslation("portal");
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);

  const title = t("dashboard.tutorialVideo.title", "How withdrawals work");
  const subtitle = t(
    "dashboard.tutorialVideo.subtitle",
    "A one-minute animated walkthrough of all 14 withdrawal stages.",
  );
  const cta = t("dashboard.tutorialVideo.watch", "Watch the tutorial");
  const downloadLabel = t(
    "dashboard.tutorialVideo.download",
    "Download this video",
  );

  // Auto-select the recording matching the user's active locale; the server
  // route falls back to English if that locale's file is missing. `download=1`
  // forces a Save-As so users (and support) can keep an offline copy.
  const downloadHref = `/tutorial-videos/${locale.code}?download=1`;
  const downloadFilename = `withdrawal-tutorial-${locale.code}.mp4`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="button-watch-withdrawal-tutorial"
          className="group flex w-full items-center gap-4 rounded-2xl p-5 text-left transition-colors"
          style={{
            background:
              "linear-gradient(135deg, rgba(200,169,81,0.14), rgba(200,169,81,0.06), rgba(255,255,255,0.02))",
            border: "1px solid rgba(200,169,81,0.40)",
            boxShadow: "0 4px 28px rgba(200,169,81,0.12)",
          }}
        >
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "rgba(200,169,81,0.22)", border: "1px solid rgba(200,169,81,0.40)" }}
          >
            <PlayCircle className="h-6 w-6 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-amber-300/80">
              {title}
            </p>
            <p className="text-white font-bold text-base leading-tight">{cta}</p>
            <p className="text-slate-300/80 text-sm mt-0.5 leading-relaxed">{subtitle}</p>
          </div>
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-[100vw] w-screen h-[100dvh] border-0 bg-black/95 p-0 sm:rounded-none">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{subtitle}</DialogDescription>
        {open && <WithdrawalTutorialVideo />}
        <a
          href={downloadHref}
          download={downloadFilename}
          data-testid="link-download-withdrawal-tutorial"
          className="absolute left-4 bottom-4 z-10 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          style={{
            background: "rgba(200,169,81,0.18)",
            border: "1px solid rgba(200,169,81,0.45)",
            backdropFilter: "blur(6px)",
          }}
        >
          <Download className="h-4 w-4 text-amber-300" />
          {downloadLabel}
        </a>
      </DialogContent>
    </Dialog>
  );
}
