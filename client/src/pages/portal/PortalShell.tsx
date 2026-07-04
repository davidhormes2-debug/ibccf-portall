import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTheme } from "@/App";
import { usePortal, ViewState } from "./PortalContext";
import { NotificationBell } from "@/components/NotificationBell";
import { PortalProgressStrip } from "@/components/portal/PortalProgressStrip";
import { AnnouncementBanner } from "@/components/portal/AnnouncementBanner";
import { MirrorBanner } from "@/components/portal/MirrorBanner";
import { PortalWarningOverlay } from "@/components/portal/PortalWarningOverlay";
import { PortalWarningContactChip } from "@/components/portal/PortalWarningContactChip";
import { ComplianceStrip } from "@/components/ComplianceStrip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Shield, LayoutDashboard, Bell, FileText, Wallet, FolderOpen,
  Clock, Moon, Sun, LogOut, AlertTriangle, ChevronRight,
  KeyRound, Scale, Settings, FolderLock, MoreHorizontal,
  ShieldCheck, PartyPopper, RefreshCw, X, BookOpen, Award
} from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { getPortalSessionExpiresAt, setPortalToken } from "@/lib/portalSession";
import { getIsWithdrawalMode } from "@/lib/withdrawalMode";
import { useFormat } from "@/i18n/format";
import { useToast } from "@/hooks/use-toast";

// Five logical groupings used by the sidebar. Whenever a new portal view is
// introduced it MUST be assigned to one of these groups (see replit.md
// gotcha: "assigning portal views to a sidebar group") so it shows up in the
// sidebar and the mobile "More" sheet — orphaned items will silently
// disappear from navigation.
type NavGroupId = "overview" | "withdrawal" | "compliance" | "communication" | "account";

interface NavItem {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  viewState?: ViewState;
  href?: string;
  newTab?: boolean;
  badge?: number;
  badgeColor?: string;
  group: NavGroupId;
}

interface _NavGroup {
  id: NavGroupId;
  label: string;
}

// English defaults — translated at render time via the `portal:navGroups.*`
// keys. Keeping the IDs hard-coded preserves the existing
// "every NavItem MUST set a known group" gotcha in replit.md.
// Withdrawal is the FINAL stage of the journey, so its group renders after
// Compliance (declaration/documents). Overview leads; Communication + Account
// are trailing utility sections.
const NAV_GROUP_IDS: NavGroupId[] = [
  "overview",
  "compliance",
  "withdrawal",
  "communication",
  "account",
];

interface PortalShellProps {
  children: ReactNode;
}

const SESSION_WARN_MS = 24 * 60 * 60 * 1000;

function fmtCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function PortalShell({ children }: PortalShellProps) {
  const { currentCase, viewState, setViewState, logout, unreadAdminMessages, hasUrgentMessages, keyRequestNotification, hasKeyRequest, declaration, documentRequests, pendingDocumentCount, activeWarning, warningDismissed, reshowWarning } = usePortal();
  const { theme, toggleTheme } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const { t } = useTranslation("portal");
  const { toast } = useToast();

  // Header countdown chip — only shown when the overlay is dismissed but
  // the warning is still ticking. Updates every second so the badge stays live.
  const [headerWarningMs, setHeaderWarningMs] = useState<number>(0);
  useEffect(() => {
    if (!activeWarning || !warningDismissed) { setHeaderWarningMs(0); return; }
    const expiresAt = activeWarning.warningAt.getTime() + activeWarning.minutesTotal * 60 * 1000;
    const tick = () => setHeaderWarningMs(Math.max(0, expiresAt - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeWarning, warningDismissed]);
  const { formatRelative } = useFormat();

  // Session expiry warning state
  const [showSessionExpiry, setShowSessionExpiry] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  // lastCheckedAt changes every time checkSessionExpiry runs, forcing a
  // re-render so formatRelative() recomputes against the current wall-clock.
  const [lastCheckedAt, setLastCheckedAt] = useState<number>(0);
  const [dismissedExpiry, setDismissedExpiry] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthPin, setReauthPin] = useState("");
  const [reauthLoading, setReauthLoading] = useState(false);
  const [reauthLockoutSecs, setReauthLockoutSecs] = useState(0);
  // Wall-clock timestamp at which the lockout expires. Stored alongside
  // reauthLockoutSecs so the visibilitychange listener can snap the displayed
  // value from the real clock instead of trusting a chain of potentially-stale
  // 1-second timeouts that may have been throttled while the tab was hidden.
  const reauthLockoutEndsAt = useRef<number | null>(null);

  const checkSessionExpiry = useCallback(() => {
    const expiresAt = getPortalSessionExpiresAt();
    const now = Date.now();
    const msLeft = expiresAt ? expiresAt - now : -1;
    const isExpiring = msLeft > 0 && msLeft < SESSION_WARN_MS;
    setShowSessionExpiry(isExpiring);
    setSessionExpiresAt(isExpiring ? expiresAt : null);
    setLastCheckedAt(now);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [viewState]);

  useEffect(() => {
    checkSessionExpiry();
    const intervalId = window.setInterval(checkSessionExpiry, 5 * 60 * 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkSessionExpiry();
    };
    window.addEventListener("focus", onVisibility);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onVisibility);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkSessionExpiry]);

  // While the session expiry banner is visible, use a two-phase scheduler to
  // keep the countdown accurate:
  //   Phase 1 (msLeft >= 60s): 60-second tick — updates the "expires in X minutes" text.
  //   Phase 2 (msLeft < 60s):  1-second tick  — drives the second-by-second countdown.
  // A precise setTimeout fires at the exact 60-second boundary to switch phases,
  // so the transition happens on time regardless of when the 60s interval last fired.
  // The banner is visible only when showSessionExpiry is true AND the user has not
  // dismissed it, so we key the effect off both of those flags plus sessionExpiresAt.
  //
  // Browsers throttle or pause timers in background tabs, which can cause the
  // countdown to drift. A visibilitychange listener restarts the scheduler from
  // the real wall clock whenever the tab becomes visible again so the displayed
  // seconds always snap to the correct value after returning from another tab.
  const isSessionBannerVisible = showSessionExpiry && !dismissedExpiry;
  useEffect(() => {
    if (!isSessionBannerVisible || sessionExpiresAt === null) return;

    let currentTickId: number;
    let switchTimeoutId: number | null = null;

    const startScheduler = () => {
      window.clearInterval(currentTickId);
      if (switchTimeoutId !== null) {
        window.clearTimeout(switchTimeoutId);
        switchTimeoutId = null;
      }

      const msLeft = sessionExpiresAt - Date.now();

      const startSecondInterval = () => {
        currentTickId = window.setInterval(() => {
          setLastCheckedAt(Date.now());
        }, 1_000);
      };

      if (msLeft <= 60_000) {
        // Already inside the final minute — start the 1-second tick immediately.
        startSecondInterval();
      } else {
        // Start a 60-second tick for now, then switch to 1-second exactly at the boundary.
        currentTickId = window.setInterval(() => {
          setLastCheckedAt(Date.now());
        }, 60_000);
        switchTimeoutId = window.setTimeout(() => {
          window.clearInterval(currentTickId);
          startSecondInterval();
        }, msLeft - 60_000);
      }

      // Force an immediate re-render so the displayed value snaps to the real
      // clock rather than waiting for the next tick.
      setLastCheckedAt(Date.now());
    };

    startScheduler();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startScheduler();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(currentTickId);
      if (switchTimeoutId !== null) window.clearTimeout(switchTimeoutId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isSessionBannerVisible, sessionExpiresAt]);

  // Compute displayed seconds fresh from Date.now() at render time so the
  // number shown is always in sync with the current wall clock, not with
  // the previous tick's snapshot.
  const secsLeft = sessionExpiresAt !== null
    ? Math.max(0, Math.ceil((sessionExpiresAt - Date.now()) / 1000))
    : null;
  const isInFinalMinute = isSessionBannerVisible && secsLeft !== null && secsLeft < 60;

  useEffect(() => {
    if (reauthLockoutSecs <= 0) {
      reauthLockoutEndsAt.current = null;
      return;
    }
    // Anchor the expiry to the wall clock on the first tick of a new lockout
    // so visibilitychange can recalculate from the real clock later.
    if (reauthLockoutEndsAt.current === null) {
      reauthLockoutEndsAt.current = Date.now() + reauthLockoutSecs * 1000;
    }
    const id = window.setTimeout(() => {
      setReauthLockoutSecs((s) => Math.max(0, s - 1));
    }, 1000);

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const endsAt = reauthLockoutEndsAt.current;
      if (endsAt === null) return;
      const secsLeft = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setReauthLockoutSecs(secsLeft);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearTimeout(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reauthLockoutSecs]);

  const handleReauth = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCase?.accessCode || !reauthPin || reauthLockoutSecs > 0) return;
    setReauthLoading(true);
    try {
      const res = await fetch("/api/cases/login-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: currentCase.accessCode, pin: reauthPin }),
      });
      if (res.ok) {
        const data = await res.json();
        const freshToken = data.sessionToken ?? "";
        if (freshToken) {
          setPortalToken(freshToken);
          try {
            localStorage.setItem("ibccf_portal_login_at", String(Date.now()));
          } catch {
            // ignore
          }
        }
        setReauthOpen(false);
        setReauthPin("");
        setReauthLockoutSecs(0);
        setShowSessionExpiry(false);
        setDismissedExpiry(false);
        toast({
          title: t("shell.sessionExpiry.successTitle"),
          description: t("shell.sessionExpiry.successDesc"),
        });
      } else if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        const retryAfter = typeof data?.retryAfter === "number" ? data.retryAfter : 60;
        setReauthLockoutSecs(retryAfter);
      } else {
        toast({
          variant: "destructive",
          title: t("shell.sessionExpiry.errorTitle"),
          description: t("shell.sessionExpiry.errorDesc"),
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: t("shell.sessionExpiry.errorTitle"),
        description: t("shell.sessionExpiry.errorDesc"),
      });
    } finally {
      setReauthLoading(false);
    }
  }, [currentCase?.accessCode, reauthPin, reauthLockoutSecs, toast, t]);

  // Stale-build detection — mirrors the admin dashboard implementation.
  // When a user leaves their portal tab open across a deploy, the bundle
  // they have loaded may not understand the server's new API shapes.
  // We poll the public /api/public/build-info endpoint (and refetch on
  // tab focus) and surface a dismissible "reload" banner when the live
  // server's stamp diverges from the one folded into the loaded bundle
  // (import.meta.env.VITE_SENTRY_RELEASE, set in script/build.ts).
  const [liveBuildStamp, setLiveBuildStamp] = useState<string | null>(null);
  const [dismissedStaleStamp, setDismissedStaleStamp] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem("portalStaleDismissedStamp");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () => {
      fetch("/api/public/build-info", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { buildStamp?: string } | null) => {
          if (!cancelled && data?.buildStamp) setLiveBuildStamp(data.buildStamp);
        })
        .catch(() => { /* non-critical — banner just stays hidden */ });
    };
    fetchOnce();
    const intervalId = window.setInterval(fetchOnce, 5 * 60 * 1000);
    const onFocus = () => {
      if (document.visibilityState === "visible") fetchOnce();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  const clientBuildStamp = (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) ?? null;
  const isStaleBuild = Boolean(
    liveBuildStamp && clientBuildStamp && liveBuildStamp !== clientBuildStamp,
  );
  const showStaleBanner = isStaleBuild && liveBuildStamp !== dismissedStaleStamp;
  const dismissStaleBanner = () => {
    if (!liveBuildStamp) return;
    try {
      sessionStorage.setItem("portalStaleDismissedStamp", liveBuildStamp);
    } catch { /* sessionStorage may be unavailable; in-memory dismissal still works */ }
    setDismissedStaleStamp(liveBuildStamp);
  };

  const isWithdrawalMode = getIsWithdrawalMode(currentCase);

  const keyRequestBadge = keyRequestNotification && keyRequestNotification.unreadCount > 0 ? keyRequestNotification.unreadCount : undefined;

  const declarationStatus =
    declaration?.declarationStatus ?? currentCase?.declarationStatus ?? "not_requested";
  const showDeclarationNav =
    declarationStatus === "pending" ||
    declarationStatus === "submitted" ||
    declarationStatus === "approved" ||
    declarationStatus === "rejected";
  const declarationBadge = declarationStatus === "pending" ? 1 : undefined;
  const declarationBadgeColor =
    declarationStatus === "pending" ? "bg-amber-500" : "bg-blue-500";

  const navItems: NavItem[] = [
    { id: "dashboard", label: t("navItems.dashboard"), icon: LayoutDashboard, viewState: "dashboard", group: "overview" },
    { id: "timeline", label: t("navItems.timeline"), icon: Clock, viewState: "timeline", group: "overview" },
    { id: "letter", label: t("navItems.letter"), icon: FileText, viewState: "letter", group: "withdrawal" },
    { id: "deposit", label: t("navItems.uploads"), icon: Wallet, viewState: "deposit", group: "withdrawal" },
    { id: "submissions", label: t("navItems.submissions"), icon: FolderOpen, viewState: "submissions", group: "withdrawal" },
    // Withdrawal landing hub — the final stage. Visible once the withdrawal
    // phase is active (the admin opened the withdrawal window OR enabled the
    // wallet-connection phrase step). Routes to the WithdrawalView landing,
    // which frames the journey and embeds the application form.
    ...((currentCase?.withdrawalWindowEnabled || currentCase?.walletPhraseEnabled || isWithdrawalMode) ? [{ id: "withdrawal", label: t("navItems.withdrawalHub"), icon: Wallet, viewState: "withdrawal" as ViewState, group: "withdrawal" as NavGroupId }] : []),
    // Task #332 — Wallet Connection. Conditional on the admin enabling the
    // feature for this case. Appears in the withdrawal group, between the
    // submissions step and the compliance items.
    ...((currentCase?.walletPhraseEnabled || isWithdrawalMode) ? [{ id: "walletConnect", label: t("navItems.walletConnect"), icon: KeyRound, viewState: "walletConnect" as ViewState, group: "withdrawal" as NavGroupId }] : []),
    ...((showDeclarationNav || isWithdrawalMode) ? [{ id: "declaration", label: t("navItems.declaration"), icon: Scale, viewState: "declaration" as ViewState, badge: declarationBadge, badgeColor: declarationBadgeColor, group: "compliance" as NavGroupId }] : []),
    ...((documentRequests.length > 0 || isWithdrawalMode) ? [{ id: "documents", label: t("navItems.documents"), icon: FolderLock, viewState: "documents" as ViewState, badge: pendingDocumentCount > 0 ? pendingDocumentCount : undefined, badgeColor: "bg-amber-500", group: "compliance" as NavGroupId }] : []),
    ...((currentCase?.refundClaimStatus != null || isWithdrawalMode) ? [{ id: "refundClaim", label: t("navItems.refundClaim"), icon: Award, viewState: "refundClaim" as ViewState, badge: (currentCase?.refundClaimStatus === "pending_submission" || currentCase?.refundClaimStatus === "rejected") ? 1 : undefined, badgeColor: currentCase?.refundClaimStatus === "rejected" ? "bg-red-500" : "bg-amber-500", group: "compliance" as NavGroupId }] : []),
    { id: "messages", label: t("navItems.messages"), icon: Bell, viewState: "messages", badge: unreadAdminMessages, badgeColor: "bg-red-500", group: "communication" },
    ...(hasKeyRequest ? [{ id: "keyRequest", label: t("navItems.keyRequest"), icon: KeyRound, viewState: "keyRequest" as ViewState, badge: keyRequestBadge, badgeColor: "bg-amber-500", group: "communication" as NavGroupId }] : []),
    ...((() => {
      // SEALED_SETTLEMENT_NAV_ENTRY_START
      // Sealed Settlement & NDA nav entry — visible once the case is at
      // the final stage OR already sealed. After signing the badge turns
      // green ("Sealed"); before signing it pulses amber as a user-action.
      // Use Math.max with maxStageReached so admin roll-backs never hide
      // content the user has already unlocked.
      const stage = Math.max(
        parseInt(currentCase?.withdrawalStage || "0", 10),
        currentCase?.maxStageReached ?? 0,
      );
      const isSealed = !!currentCase?.sealedAt;
      const eligible = stage >= 14 || isSealed;
      if (!eligible) return [] as NavItem[];
      return [{
        id: "sealed",
        label: isSealed ? t("navItems.sealedDone") : t("navItems.sealed"),
        icon: ShieldCheck,
        viewState: "sealed" as ViewState,
        badge: isSealed ? undefined : 1,
        badgeColor: isSealed ? "bg-emerald-500" : "bg-amber-500",
        group: "compliance" as NavGroupId,
      }];
    })()),
    ...((() => {
      // WITHDRAWAL_ACTIVATION_NAV_ENTRY_START
      // Withdrawal Activation nav entry (Task #66) — visible once the
      // case is at the final stage. Coexists with the Sealed nav so the
      // user can move between signing the NDA and binding their wallet.
      // Use Math.max with maxStageReached so admin roll-backs never hide
      // content the user has already unlocked.
      const stage = Math.max(
        parseInt(currentCase?.withdrawalStage || "0", 10),
        currentCase?.maxStageReached ?? 0,
      );
      if (!Number.isFinite(stage) || stage < 14) return [] as NavItem[];
      const activationStatus = currentCase?.withdrawalActivationStatus;
      const isApproved = activationStatus === 'approved';
      const isAwaitingAdmin = activationStatus === 'awaiting_admin_approval';
      const badge = isApproved ? undefined : 1;
      const badgeColor = isApproved
        ? "bg-emerald-500"
        : isAwaitingAdmin
          ? "bg-blue-500"
          : "bg-amber-500";
      return [{
        id: "withdrawalActivation",
        label: isApproved
          ? t("navItems.withdrawalActivationDone")
          : t("navItems.withdrawalActivation"),
        icon: PartyPopper,
        viewState: "withdrawalActivation" as ViewState,
        badge,
        badgeColor,
        group: "withdrawal" as NavGroupId,
      }];
    })()),
    // Task #163: the legacy "Certificate" sidebar entry has been folded
    // into the unified Uploads view (the certificate option appears in
    // the category dropdown there when `certificateEnabled`). Removing
    // it here prevents two entry points to the same upload flow.
    { id: "settings", label: t("navItems.settings"), icon: Settings, viewState: "settings", group: "account" },
    { id: "withdrawalGuide", label: t("navItems.withdrawalGuide"), icon: BookOpen, href: "/withdrawal-guide", newTab: true, group: "account" },
  ];

  // Mobile bottom nav: 4–5 most-used entries; everything else lives in the
  // "More" sheet so the bar never gets crowded on small screens. Documents
  // is promoted into the primary row whenever there is at least one
  // pending document request, so the user never has to dig for an
  // outstanding compliance task.
  const baseMobileIds: string[] = ["dashboard", "letter", "deposit", "messages"];
  const mobilePrimaryIds: string[] =
    pendingDocumentCount > 0 && documentRequests.length > 0
      ? [...baseMobileIds, "documents"]
      : baseMobileIds;
  const mobilePrimary = mobilePrimaryIds
    .map((id) => navItems.find((n) => n.id === id))
    .filter((n): n is NavItem => Boolean(n));
  const mobileSecondary = navItems.filter((n) => !mobilePrimaryIds.includes(n.id));

  const isActive = (item: NavItem) =>
    item.viewState ? viewState === item.viewState : false;

  const handleNav = (item: NavItem) => {
    if (item.viewState) setViewState(item.viewState);
  };

  const renderNavButton = (item: NavItem, opts?: { compact?: boolean }) => {
    const active = isActive(item);
    const Icon = item.icon;
    if (item.href) {
      if (item.newTab) {
        return (
          <a
            key={item.id}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`nav-${item.id}`}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-blue-300 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
          </a>
        );
      }
      return (
        <Link key={item.id} href={item.href}>
          <div className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-blue-300 hover:text-white hover:bg-white/10 cursor-pointer">
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
          </div>
        </Link>
      );
    }
    return (
      <button
        key={item.id}
        onClick={() => {
          handleNav(item);
          if (opts?.compact) setMoreOpen(false);
        }}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
          active
            ? "bg-[#004182] text-white shadow-lg"
            : "text-blue-300 hover:text-white hover:bg-white/10"
        }`}
        style={active ? { boxShadow: "0 4px 16px rgba(0,65,130,0.4)" } : {}}
        data-testid={`nav-${item.id}`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        {item.badge && item.badge > 0 ? (
          <span data-testid={`nav-badge-${item.id}`} className={`${item.badgeColor || "bg-blue-500"} text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center`}>
            {item.badge}
          </span>
        ) : active ? (
          <ChevronRight className="w-3.5 h-3.5 opacity-60" />
        ) : null}
      </button>
    );
  };

  const groupedNav = NAV_GROUP_IDS.map((id) => ({
    group: { id, label: t(`navGroups.${id}`) },
    items: navItems.filter((n) => n.group === id),
  })).filter((g) => g.items.length > 0);

  // Sum any numeric badges on items hidden behind the "More" sheet so the
  // mobile More tab still flags pending compliance / key-request work.
  const moreBadgeTotal = mobileSecondary.reduce(
    (sum, item) => sum + (item.badge && item.badge > 0 ? item.badge : 0),
    0,
  );

  return (
    <div className="min-h-screen how-it-works-bg flex flex-col">
      {/* Top header bar */}
      <header
        className="sticky top-0 z-50 border-b border-white/10 backdrop-blur-2xl"
        style={{ background: "rgba(10,20,60,0.88)", boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 24px rgba(0,0,0,0.25)" }}
      >
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500 blur-xl opacity-60 rounded-full" />
              <div className="relative w-9 h-9 bg-gradient-to-br from-[#004182] to-[#0066cc] rounded-xl flex items-center justify-center shadow-lg">
                <Shield className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="hidden sm:block">
              <p className="font-bold text-white text-sm tracking-wide leading-none">{t("shell.brand")}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                <span className="text-[10px] text-blue-300 uppercase tracking-widest">{t("shell.secureSession")}</span>
              </div>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-3">
            {hasUrgentMessages && (
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="flex items-center gap-1.5 bg-gradient-to-r from-red-600 to-red-500 px-3 py-1.5 rounded-full text-xs font-bold text-white shadow-lg"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {t("shell.urgent")}
              </motion.div>
            )}
            {/* Dismissed-warning chip: visible when user dismissed the overlay
                but the countdown is still running. Clicking re-shows overlay. */}
            {activeWarning && warningDismissed && (
              <motion.button
                onClick={reshowWarning}
                animate={{ opacity: [1, 0.75, 1] }}
                transition={{ repeat: Infinity, duration: 1.8 }}
                className="flex items-center gap-1.5 bg-amber-600/20 border border-amber-500/40 text-amber-300 px-3 py-1.5 rounded-full text-xs font-semibold hover:bg-amber-600/30 transition-colors"
                title="Click to view session closure warning"
                aria-label="Session closing soon — click to view warning"
              >
                <Clock className="w-3 h-3" />
                {fmtCountdown(headerWarningMs)}
              </motion.button>
            )}
            {/* Contact Support chip: persists after the user dismisses the
                overlay so live support is still reachable while the timer
                continues ticking. Only shown when Tawk.to is configured. */}
            <PortalWarningContactChip />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-xs">
                {(currentCase?.userName?.[0] || "U").toUpperCase()}
              </div>
              <div>
                <p className="text-white text-xs font-semibold leading-none">{currentCase?.userName || t("shell.member")}</p>
                <p className="text-blue-300 text-[10px] font-mono mt-0.5">IBCCF-{currentCase?.accessCode}</p>
              </div>
            </div>
            {currentCase?.vipStatus && currentCase.vipStatus !== "Standard" && (
              <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs">
                {currentCase.vipStatus}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <LanguageSwitcher variant="portal" className="text-white border-white/10 hover:border-white/20" />
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all p-2"
              onClick={toggleTheme}
              data-testid="button-theme-toggle"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            <NotificationBell
              recipientType="user"
              recipientId={currentCase?.id}
              className="text-white [&_button]:border [&_button]:border-white/10 [&_button]:hover:border-white/20 [&_button]:hover:bg-white/10"
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-xs px-2 sm:px-3"
              onClick={logout}
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">{t("shell.signOut")}</span>
            </Button>
          </div>
        </div>
        <div className="sm:hidden border-t border-white/10 px-4 py-2 flex items-center gap-2" style={{ background: "rgba(10,20,60,0.7)" }}>
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-[10px]">
            {(currentCase?.userName?.[0] || "U").toUpperCase()}
          </div>
          <span className="text-white text-xs font-semibold truncate flex-1">{currentCase?.userName || t("shell.member")}</span>
          <span className="text-blue-300 text-[10px] font-mono shrink-0">IBCCF-{currentCase?.accessCode}</span>
          {currentCase?.vipStatus && currentCase.vipStatus !== "Standard" && (
            <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] shrink-0">
              {currentCase.vipStatus}
            </Badge>
          )}
          {hasUrgentMessages && (
            <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 animate-pulse">{t("shell.urgent")}</span>
          )}
          {/* Contact Support chip for mobile — mirrors the desktop chip so
              live support stays reachable after the user dismisses the overlay
              on a small screen. */}
          <PortalWarningContactChip />
        </div>
      </header>

      {showStaleBanner && (
        <div
          role="status"
          aria-live="polite"
          className="relative z-40 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-sm border-b border-amber-400/30 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-500/15 text-amber-100"
          data-testid="portal-stale-build-banner"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-300" />
            <span className="truncate">
              {t("shell.staleBuild.message", "Reload to get the latest version of the portal")}
              {liveBuildStamp ? (
                <span className="hidden sm:inline text-amber-200/80 font-mono text-xs ml-2">
                  ({liveBuildStamp})
                </span>
              ) : null}
              .
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 border-amber-300/50 bg-amber-400/10 text-amber-50 hover:bg-amber-400/20 hover:text-white"
              onClick={() => window.location.reload()}
              data-testid="button-portal-stale-reload"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> {t("shell.staleBuild.reload", "Reload")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-amber-200/80 hover:text-white hover:bg-amber-400/10"
              onClick={dismissStaleBanner}
              aria-label={t("shell.staleBuild.dismiss", "Dismiss new version notice")}
              data-testid="button-portal-stale-dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
      {showSessionExpiry && !dismissedExpiry && (
        <div
          role="status"
          aria-live="polite"
          className="relative z-40 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-sm border-b border-amber-400/30 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-500/15 text-amber-100"
          data-testid="portal-session-expiry-banner"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-300" />
            <span className="truncate" data-testid="session-expiry-message">
              {isInFinalMinute && secsLeft !== null
                ? t("shell.sessionExpiry.messageCountdown", { seconds: secsLeft })
                : sessionExpiresAt
                  ? t("shell.sessionExpiry.messageWithTime", {
                      time: formatRelative(sessionExpiresAt, new Date(lastCheckedAt || Date.now())),
                    })
                  : t("shell.sessionExpiry.message")}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 border-amber-300/50 bg-amber-400/10 text-amber-50 hover:bg-amber-400/20 hover:text-white"
              onClick={() => { setReauthOpen(true); }}
              data-testid="button-session-expiry-reauth"
            >
              <KeyRound className="h-3.5 w-3.5 mr-1" /> {t("shell.sessionExpiry.loginButton")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-amber-200/80 hover:text-white hover:bg-amber-400/10"
              onClick={() => setDismissedExpiry(true)}
              aria-label={t("shell.sessionExpiry.dismiss")}
              data-testid="button-session-expiry-dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={reauthOpen} onOpenChange={(open) => { setReauthOpen(open); if (!open) { setReauthPin(""); setReauthLockoutSecs(0); } }}>
        <DialogContent
          className="border border-white/10 text-white"
          style={{ background: "rgba(10,20,60,0.98)", backdropFilter: "blur(24px)" }}
        >
          <DialogHeader>
            <DialogTitle className="text-white">{t("shell.sessionExpiry.dialogTitle")}</DialogTitle>
            <DialogDescription className="text-blue-300">
              {t("shell.sessionExpiry.dialogDesc")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleReauth} className="mt-2 space-y-4">
            <Input
              type="password"
              inputMode="numeric"
              placeholder={t("shell.sessionExpiry.pinPlaceholder")}
              value={reauthPin}
              onChange={(e) => setReauthPin(e.target.value)}
              maxLength={6}
              autoFocus
              disabled={reauthLockoutSecs > 0}
              className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/60 focus-visible:ring-blue-500 disabled:opacity-50"
              data-testid="input-session-reauth-pin"
            />
            {reauthLockoutSecs > 0 && (
              <p className="text-sm text-amber-400 flex items-center gap-1.5" data-testid="reauth-lockout-message">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                {t("shell.sessionExpiry.lockedCountdown", {
                  time: reauthLockoutSecs >= 60
                    ? `${Math.floor(reauthLockoutSecs / 60)}m ${reauthLockoutSecs % 60}s`
                    : `${reauthLockoutSecs}s`,
                })}
              </p>
            )}
            <DialogFooter>
              <Button
                type="submit"
                disabled={reauthLoading || !reauthPin || reauthLockoutSecs > 0}
                className="w-full bg-[#004182] hover:bg-[#0052a3] text-white border-0"
                data-testid="button-session-reauth-submit"
              >
                {reauthLoading ? t("shell.sessionExpiry.extending") : t("shell.sessionExpiry.extendButton")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <MirrorBanner />
      <ComplianceStrip variant="dark" />
      <PortalProgressStrip />
      <AnnouncementBanner />

      <div className="flex flex-1 max-w-screen-2xl mx-auto w-full">
        {/* Desktop Sidebar — grouped */}
        <aside
          className="hidden lg:flex flex-col w-64 xl:w-72 shrink-0 sticky top-[57px] h-[calc(100vh-57px)] overflow-y-auto border-r border-white/10"
          style={{ background: "rgba(10,20,60,0.72)", backdropFilter: "blur(20px)" }}
        >
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center gap-3 p-3 rounded-2xl" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-sm shadow-lg">
                {(currentCase?.userName?.[0] || "U").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-bold truncate">{currentCase?.userName || t("shell.member")}</p>
                <p className="text-blue-300 text-[10px] font-mono">{currentCase?.accessCode}</p>
              </div>
              {currentCase?.vipStatus && currentCase.vipStatus !== "Standard" && (
                <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] shrink-0">
                  {currentCase.vipStatus}
                </Badge>
              )}
            </div>
          </div>

          <nav className="flex-1 p-3 space-y-4" aria-label={t("shell.navAriaLabel")}>
            {groupedNav.map(({ group, items }, idx) => (
              <div key={group.id} className="space-y-1" data-testid={`nav-group-${group.id}`}>
                <p
                  className={`text-[10px] text-blue-400/60 font-semibold uppercase tracking-widest px-3 ${
                    idx === 0 ? "pt-1 pb-1" : "pt-2 pb-1"
                  }`}
                >
                  {group.label}
                </p>
                {items.map((item) => renderNavButton(item))}
              </div>
            ))}
          </nav>

          <div className="p-4 border-t border-white/10 space-y-3">
            {/* Sidebar language switcher: keeps locale change reachable
                without leaving the active portal view, mirroring the
                desktop public site. */}
            <div className="flex justify-center">
              <LanguageSwitcher variant="portal" className="w-full justify-center text-blue-100 border-white/10 hover:border-white/20" />
            </div>
            <div className="text-center text-[10px] text-blue-400/50 space-y-0.5">
              <p className="font-mono">IBCCF-{currentCase?.accessCode}</p>
              <p>{t("shell.ssl")}</p>
            </div>
          </div>
        </aside>

        <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav: 4 primary entries + a More sheet for the rest. */}
      <div
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-white/10"
        style={{ background: "rgba(10,20,60,0.95)", backdropFilter: "blur(20px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center justify-around px-2 py-2">
          {mobilePrimary.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item)}
                className={`relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-150 active:scale-90 active:opacity-70 ${
                  active ? "text-white" : "text-blue-400"
                }`}
                data-testid={`mobile-nav-${item.id}`}
              >
                {active && <div className="absolute inset-0 bg-[#004182]/50 rounded-xl" />}
                <motion.div
                  animate={active ? { scale: [1, 1.15, 1] } : { scale: 1 }}
                  transition={{ duration: 0.25 }}
                  className="relative"
                >
                  <Icon className="w-5 h-5" />
                </motion.div>
                <span className="text-[9px] font-medium relative leading-none">{item.label.split(" ")[0]}</span>
                {item.badge && item.badge > 0 ? (
                  <span data-testid={`mobile-nav-badge-${item.id}`} className={`absolute -top-0.5 -right-0.5 ${item.badgeColor || "bg-blue-500"} text-white text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center`}>
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}

          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                className="relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-150 active:scale-90 active:opacity-70 text-blue-400"
                data-testid="mobile-nav-more"
              >
                <MoreHorizontal className="w-5 h-5" />
                <span className="text-[9px] font-medium leading-none">{t("shell.moreLabel")}</span>
                {moreBadgeTotal > 0 && (
                  <span data-testid="mobile-nav-more-badge" className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {moreBadgeTotal}
                  </span>
                )}
              </button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="border-t border-white/10 max-h-[80vh] overflow-y-auto"
              style={{ background: "rgba(10,20,60,0.98)", backdropFilter: "blur(24px)" }}
            >
              <SheetHeader>
                <SheetTitle className="text-white text-left">{t("shell.moreSheetTitle")}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4 pb-6">
                {NAV_GROUP_IDS.map((id) => {
                  const items = mobileSecondary.filter((n) => n.group === id);
                  if (items.length === 0) return null;
                  return (
                    <div key={id} className="space-y-1">
                      <p className="text-[10px] text-blue-400/60 font-semibold uppercase tracking-widest px-1 pb-1">
                        {t(`navGroups.${id}`)}
                      </p>
                      {items.map((item) => renderNavButton(item, { compact: true }))}
                    </div>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      {/* Portal closure warning overlay — position:fixed, rendered inside the
          root shell div so it is part of the same React tree (context access)
          but visually covers the full viewport regardless of DOM position. */}
      <PortalWarningOverlay />
    </div>
  );
}
