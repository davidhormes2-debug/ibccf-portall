import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlobeWatermark } from "@/components/GlobeWatermark";
import { TawkWidget } from "@/components/TawkWidget";
import { InstallAppPrompt } from "@/components/InstallAppPrompt";
import { useVisitorTracking } from "@/hooks/useVisitorTracking";
import { useSyncHtmlLang, useSyncLangQueryParam } from "@/i18n/useLocale";
import { useHreflangTags } from "@/i18n/useHreflangTags";
import { createContext, useContext, useState, useEffect, ReactNode, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { cleanupStaleWalletHistory } from "@/lib/walletHistoryCleanup";
import { prunePayoutWalletHistory } from "@/lib/payoutWalletHistory";
import { pruneStageHistory } from "@/lib/stageHistory";

const LandingPage = lazy(() => import("@/pages/LandingPage"));
const VerifyPlatform = lazy(() => import("@/pages/VerifyPlatform"));
const SecurePortal = lazy(() => import("@/pages/SecurePortal"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const AdminMirror = lazy(() => import("@/pages/AdminMirror"));
const AdminEmergencyReset = lazy(() => import("@/pages/AdminEmergencyReset"));
const CommunityPage = lazy(() => import("@/pages/CommunityPage"));
const RequestAccessKey = lazy(() => import("@/pages/RequestAccessKey"));
const MobileAdminChat = lazy(() => import("@/pages/MobileAdminChat"));
const CustomerServiceDashboard = lazy(() => import("@/pages/CustomerServiceDashboard"));
const LegalResourcesPage = lazy(() => import("@/pages/LegalResourcesPage"));
const PrivacyPolicyPage = lazy(() => import("@/pages/PrivacyPolicyPage"));
const TermsOfUsePage = lazy(() => import("@/pages/TermsOfUsePage"));
const DivisionPage = lazy(() => import("@/pages/DivisionPage"));
const WithdrawalGuidePage = lazy(() => import("@/pages/WithdrawalGuidePage"));
const ContactAdminPage = lazy(() => import("@/pages/ContactAdminPage"));
const NotFound = lazy(() => import("@/pages/not-found"));

// One-time migration: remove orphaned wallet-connect history keys written by
// the now-deleted walletConnectHistory module. Extracted to a testable module.
cleanupStaleWalletHistory();
// Startup housekeeping: trim any over-sized payout-wallet history entries in
// localStorage so the invariant holds on every fresh page load.
prunePayoutWalletHistory();
// Startup housekeeping: trim any over-sized stage-history entries in
// localStorage so the invariant holds on every fresh page load.
pruneStageHistory();

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme') as Theme;
      if (stored) return stored;
    }
    return 'light';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState(prev => prev === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 dark:text-blue-400" />
        <p className="text-slate-600 dark:text-slate-300 text-sm">Loading...</p>
      </div>
    </div>
  );
}

function Router() {
  // Track every public visitor on every route so the admin Visitor
  // Insights tab sees activity across the entire site, not just the
  // portal dashboard. Mounted here (inside QueryClientProvider via App)
  // so the heartbeat survives route changes.
  useVisitorTracking({ enabled: true });
  // Keep `<html lang>` in sync with the active i18next locale so screen
  // readers, browser translation tooling and search engines all see the
  // correct language for every render.
  useSyncHtmlLang();
  // Mirror the active locale into the URL's `?lang=` query param (and
  // strip it for the default locale) so the address bar always matches
  // what the page renders — copy/sharing the URL reproduces the same
  // language for the recipient. No reload, no remount.
  useSyncLangQueryParam();
  // Emit per-locale <link rel="alternate" hreflang="…"> tags so search
  // engines surface the right translation for non-English searchers. Only
  // active on public marketing routes — kept in sync with sitemap.ts.
  useHreflangTags();

  return (
    <Suspense fallback={<PageLoader />}>
      <TawkWidget />
      {/* Accessibility: skip-to-main-content link.  Hidden off-screen until
          focused via Tab; lets keyboard users jump past the page header on
          every route.  Targets the `#main-content` id added to each page's
          <main> landmark. */}
      <a href="#main-content" className="skip-to-main">Skip to main content</a>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/verify" component={VerifyPlatform} />
        <Route path="/dashboard" component={SecurePortal} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/mirror" component={AdminMirror} />
        <Route path="/admin/emergency-reset" component={AdminEmergencyReset} />
        <Route path="/admin/mobile" component={MobileAdminChat} />
        <Route path="/admin/support" component={CustomerServiceDashboard} />
        <Route path="/community" component={CommunityPage} />
        <Route path="/community/:threadId" component={CommunityPage} />
        <Route path="/request-access" component={RequestAccessKey} />
        <Route path="/legal-resources" component={LegalResourcesPage} />
        <Route path="/privacy-policy" component={PrivacyPolicyPage} />
        <Route path="/terms-of-use" component={TermsOfUsePage} />
        <Route path="/divisions/:id" component={DivisionPage} />
        <Route path="/withdrawal-guide" component={WithdrawalGuidePage} />
        <Route path="/contact-admin" component={ContactAdminPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary
      showDetails={import.meta.env.DEV}
      fallback={null}
      onError={() => {
        // Silently send the user back to the safe landing page instead of
        // showing the scary "Something went wrong" card. The error has
        // already been logged (console + /api/client-errors) inside the
        // boundary itself, so we don't lose diagnostic data.
        if (typeof window !== "undefined" && window.location.pathname !== "/") {
          window.location.replace("/");
        } else if (typeof window !== "undefined") {
          window.location.reload();
        }
      }}
    >
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <GlobeWatermark />
            <Toaster />
            <InstallAppPrompt />
            <Router />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
