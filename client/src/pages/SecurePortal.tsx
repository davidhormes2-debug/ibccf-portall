import React, { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  PortalProvider,
  usePortal,
  LoginView,
  RegisterView,
  SyncView,
  DashboardView,
  MessagesView,
  DepositView,
  SuccessView,
  TimelineView,
  SubmissionsView,
  LetterView,
  KeyRequestView,
  DeclarationView,
  DocumentsView,
  SettingsView,
  SealedView,
  WithdrawalActivationView,
  CertificateView,
  SessionRefreshView,
  PortalRefreshView,
  WalletConnectView,
  WithdrawalView,
  RefundClaimView,
  ReactivationDepositView,
} from "./portal";
import { PortalShell } from "./portal/PortalShell";

const AUTH_VIEWS: string[] = ["login", "register", "sync", "sessionRefresh", "portalRefresh", "reactivationDeposit"];

const viewVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -6 },
};

const reducedVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
};

function AnimatedView({ children, instant }: { children: React.ReactNode; instant?: boolean }) {
  const prefersReduced = useReducedMotion();
  const skip = instant || prefersReduced;
  const variants = skip ? reducedVariants : viewVariants;

  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: skip ? 0 : 0.22, ease: "easeOut" }}
      style={{ willChange: "opacity, transform" }}
    >
      {children}
    </motion.div>
  );
}

const AUTH_VIEW_MAP: Record<string, React.ReactNode> = {
  login:               <LoginView />,
  register:            <RegisterView />,
  sync:                <SyncView />,
  sessionRefresh:      <SessionRefreshView />,
  portalRefresh:       <PortalRefreshView />,
  reactivationDeposit: <ReactivationDepositView />,
};

const PORTAL_VIEW_MAP: Record<string, React.ReactNode> = {
  dashboard:   <DashboardView />,
  letter:      <LetterView />,
  messages:    <MessagesView />,
  deposit:     <DepositView />,
  submissions: <SubmissionsView />,
  success:     <SuccessView />,
  timeline:    <TimelineView />,
  keyRequest:  <KeyRequestView />,
  declaration: <DeclarationView />,
  documents:   <DocumentsView />,
  settings:    <SettingsView />,
  sealed:      <SealedView />,
  withdrawalActivation: <WithdrawalActivationView />,
  certificate: <CertificateView />,
  walletConnect: <WalletConnectView />,
  withdrawal:    <WithdrawalView />,
  refundClaim:   <RefundClaimView />,
};

function PortalContent() {
  const { viewState, currentCase } = usePortal();
  const prefersReduced = useReducedMotion();
  const portalEnteredRef = useRef(false);

  // A portal view (dashboard / messages / deposit / …) must never render
  // against a null `currentCase` — virtually every view derefs fields like
  // `currentCase.id` without a null guard. When `logout()` runs (user
  // click, 3-minute idle timeout, or admin force-logout), it clears
  // `currentCase` AND switches `viewState` back to `login` in the same
  // render, but `<AnimatePresence mode="wait">` keeps the outgoing portal
  // view mounted for the exit animation — with the now-null case it
  // throws synchronously, bubbles to the top-level ErrorBoundary, and the
  // user sees the generic "Something went wrong" card. Treat a missing
  // case as an auth view so the portal tree is never rendered without
  // its data.
  //
  // Deep-link lockout guard: if the case is disabled and the user somehow
  // lands on a portal view (e.g. via browser back/forward or a stale deep
  // link), force the reactivationDeposit auth view. This prevents any
  // portal content from rendering while the account is suspended.
  //
  // Reverse guard: if the user has a valid session on an ENABLED account
  // (currentCase is loaded and currentCase.isDisabled is false) but
  // viewState is somehow still "reactivationDeposit" (e.g. a stale
  // redirect, a race with a reactivation that completed elsewhere, or a
  // stuck client-side state from a previous session), never show the
  // reactivation error/deposit panel to a working account — send the user
  // back to their dashboard instead.
  const effectiveViewState =
    currentCase?.isDisabled && !AUTH_VIEWS.includes(viewState)
      ? "reactivationDeposit"
      : currentCase && !currentCase.isDisabled && viewState === "reactivationDeposit"
        ? "dashboard"
        : viewState;

  const isAuthView = AUTH_VIEWS.includes(effectiveViewState) || !currentCase;

  // Reset the "already entered" flag whenever we return to an auth view
  if (isAuthView) portalEnteredRef.current = false;

  // isFirstEnter is true only on the very first portal render after auth,
  // so we skip the inner AnimatedView animation (the portal wrapper handles it)
  const isFirstEnter = !portalEnteredRef.current;
  if (!isAuthView && !portalEnteredRef.current) portalEnteredRef.current = true;

  return (
    // Single AnimatePresence that owns every auth↔portal boundary transition.
    // Auth views use their own viewState as the key so login↔register↔sync
    // transitions play out naturally.  The portal always has key="portal" so
    // navigating within it (dashboard→messages etc.) doesn't trigger this
    // outer animation — only the inner AnimatedView does.
    <AnimatePresence mode="wait">
      {isAuthView ? (
        <AnimatedView key={effectiveViewState}>
          {AUTH_VIEW_MAP[effectiveViewState] ?? <LoginView />}
        </AnimatedView>
      ) : (
        <motion.div
          key="portal"
          initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
          transition={{
            duration: prefersReduced ? 0 : 0.3,
            ease: [0.16, 1, 0.3, 1],
          }}
          style={{ willChange: "opacity, transform" }}
        >
          <PortalShell>
            <AnimatePresence mode="wait">
              <AnimatedView key={effectiveViewState} instant={isFirstEnter}>
                {PORTAL_VIEW_MAP[effectiveViewState] ?? <DashboardView />}
              </AnimatedView>
            </AnimatePresence>
          </PortalShell>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function SecurePortal() {
  return (
    <PortalProvider>
      <PortalContent />
    </PortalProvider>
  );
}
