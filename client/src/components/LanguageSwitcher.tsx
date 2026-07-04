import { useTranslation } from "react-i18next";
import { Globe, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/i18n/useLocale";
import { useToast } from "@/hooks/use-toast";
import type { LocaleCode } from "@/i18n";
import { getPortalToken } from "@/lib/portalSession";

/**
 * Best-effort persist the recipient's locale onto the case row so that
 * server-triggered transactional emails (which carry the admin's locale,
 * not the user's) render in the user's chosen language. Reads the access
 * code from sessionStorage (set by the portal verify-access-code flow in
 * VerifyPlatform.tsx + portal/AuthViews.tsx under the key `caseAccessCode`).
 * Failures are silently swallowed — a missing case, an offline browser, or
 * a 4xx response must never break the in-app language switch.
 */
function persistLocaleToCase(locale: LocaleCode): boolean {
  let accessCode: string | null;
  try {
    // The portal verify-flow stores the access code in sessionStorage as
    // `caseAccessCode` (see VerifyPlatform.tsx + portal/AuthViews.tsx).
    accessCode = sessionStorage.getItem("caseAccessCode");
  } catch {
    return false;
  }
  if (!accessCode) return false;
  try {
    // Include the portal session token so the server can authorise the
    // request for cases that have already completed PIN enrollment. Without
    // this header the endpoint returns 401 for post-PIN cases (intentional —
    // the access code alone is no longer a valid bearer credential once a
    // PIN exists). The header is simply omitted when no session is active
    // (pre-PIN bootstrap flow), which is the only case where the access code
    // alone is still accepted.
    const portalToken = getPortalToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-User-Locale": locale,
    };
    if (portalToken) {
      headers["x-portal-session-token"] = portalToken;
    }
    void fetch(`/api/cases/access/${encodeURIComponent(accessCode)}/locale`, {
      method: "POST",
      headers,
      body: JSON.stringify({ locale }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
  return true;
}

interface LanguageSwitcherProps {
  /** "header" mirrors the public marketing nav buttons (gold-on-navy);
   *  "portal" mirrors the muted slate buttons used inside the portal shell;
   *  "compact" hides the label and shows only the globe icon (mobile).
   */
  variant?: "header" | "portal" | "compact";
  className?: string;
}

/**
 * Single source of truth for the language switcher UI. Mounted in the
 * public marketing header AND inside the portal sidebar so users can
 * switch language at any point. The choice is persisted by `useLocale`
 * and reactively syncs `<html lang>` via `useSyncHtmlLang`.
 *
 * Switching does NOT remount the route — react-i18next re-renders only
 * the subtree of the components reading translations, so unsaved form
 * state is preserved (acceptance criterion of Task #4).
 */
export function LanguageSwitcher({ variant = "header", className }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation("common");
  const { locale, setLocale, supported } = useLocale();
  const { toast } = useToast();

  const triggerClasses =
    variant === "header"
      ? "h-9 px-3 gap-2 bg-transparent hover:bg-white/10 text-slate-200 border border-slate-700/60"
      : variant === "portal"
        ? "h-9 px-3 gap-2 bg-transparent hover:bg-slate-800/50 text-slate-300 border border-slate-700/40"
        : "h-9 w-9 p-0 bg-transparent hover:bg-white/10 text-slate-200";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`${triggerClasses} ${className ?? ""}`}
          aria-label={t("language.switcherAriaLabel")}
          data-testid="button-language-switcher"
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
          {variant !== "compact" && (
            <span className="text-xs font-medium uppercase tracking-wide">{locale.code}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {supported.map((opt) => {
          const isActive = opt.code === locale.code;
          return (
            <DropdownMenuItem
              key={opt.code}
              onSelect={() => {
                const code = opt.code as LocaleCode;
                if (code === locale.code) return;
                setLocale(code);
                // The switcher is mounted in BOTH the public marketing
                // header (`header`/`compact` variants) and the portal shell
                // (`portal` variant). Only attempt the email-locale POST
                // and surface the confirmation toast inside the portal,
                // where there is a case to update — `sessionStorage` may
                // still hold a stale `caseAccessCode` from an earlier
                // portal visit even when the user is now on the marketing
                // site, so variant is the authoritative signal.
                if (variant !== "portal") return;
                const persisted = persistLocaleToCase(code);
                if (persisted) {
                  // Render the toast in the freshly-selected language so the
                  // confirmation itself demonstrates the switch took effect.
                  const tNext = i18n.getFixedT(code, "common");
                  toast({
                    title: tNext("language.emailNoticeTitle"),
                    description: tNext("language.emailNoticeDescription", {
                      language: opt.nativeLabel,
                    }),
                  });
                }
              }}
              data-testid={`menu-language-${opt.code}`}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex flex-col">
                <span className="text-sm">{opt.nativeLabel}</span>
                <span className="text-[11px] text-muted-foreground">{opt.label}</span>
              </span>
              {isActive && <Check className="h-4 w-4 text-emerald-500" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
