import { useEffect, useState } from "react";
import { Download, Smartphone, X, Share2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "ibccf_install_prompt_dismissed_at";
const DISMISS_DAYS = 7;
const DAY_MS = 86_400_000;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari
  if ((window.navigator as { standalone?: boolean }).standalone) return true;
  return false;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as { MSStream?: unknown }).MSStream
  );
}

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = parseInt(raw, 10);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_DAYS * DAY_MS;
  } catch {
    return false;
  }
}

export function InstallAppPrompt() {
  const { t } = useTranslation("portal");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [iosSheet, setIosSheet] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }
    if (recentlyDismissed()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setShow(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS does not fire beforeinstallprompt — show our own sheet hint after a beat.
    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (isIOS()) {
      iosTimer = setTimeout(() => setShow(true), 4_000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShow(false);
    setIosSheet(false);
  };

  const install = async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === "accepted") {
          setShow(false);
        } else {
          dismiss();
        }
      } catch {
        dismiss();
      }
      setDeferred(null);
    } else if (isIOS()) {
      setIosSheet(true);
    }
  };

  if (installed || !show) return null;

  return (
    <>
      <div
        className="fixed inset-x-3 bottom-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-sm z-[60] rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(10,24,64,0.96) 0%, rgba(21,41,107,0.96) 100%)",
          backdropFilter: "blur(16px)",
        }}
        role="dialog"
        aria-label={t("installApp.ariaLabel")}
        data-testid="install-app-prompt"
      >
        <div className="p-4 flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-lg">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">{t("installApp.title")}</p>
            <p className="text-blue-200/80 text-xs mt-0.5 leading-snug">
              {t("installApp.body")}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <Button
                size="sm"
                onClick={install}
                className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400 text-white text-xs h-8"
                data-testid="button-install-app"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                {t("installApp.install")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={dismiss}
                className="text-blue-200/80 hover:text-white hover:bg-white/10 text-xs h-8"
                data-testid="button-install-dismiss"
              >
                {t("installApp.notNow")}
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="p-1 -m-1 rounded text-blue-200/60 hover:text-white hover:bg-white/10"
            aria-label={t("installApp.dismiss")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <Dialog open={iosSheet} onOpenChange={setIosSheet}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">{t("installApp.iosTitle")}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {t("installApp.iosDescription")}
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-4 mt-2 text-sm text-slate-200">
            <li className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                1
              </span>
              <span>
                {t("installApp.iosStep1Prefix")} <Share2 className="inline w-4 h-4 mx-1 text-blue-300" />{" "}
                <strong>{t("installApp.iosStep1Share")}</strong> {t("installApp.iosStep1Suffix")}
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                2
              </span>
              <span>
                {t("installApp.iosStep2Prefix")} <Plus className="inline w-4 h-4 mx-1 text-blue-300" />{" "}
                <strong>{t("installApp.iosStep2Add")}</strong>{t("installApp.iosStep2Suffix")} <strong>{t("installApp.iosStep2Confirm")}</strong>.
              </span>
            </li>
          </ol>
          <p className="text-xs text-slate-500 mt-4">
            {t("installApp.iosFootnote")}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default InstallAppPrompt;
