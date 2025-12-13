import React from "react";
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
} from "./portal";

function PortalContent() {
  const { viewState } = usePortal();

  switch (viewState) {
    case 'login':
      return <LoginView />;
    case 'register':
      return <RegisterView />;
    case 'sync':
      return <SyncView />;
    case 'dashboard':
      return <DashboardView />;
    case 'letter':
      return <LetterView />;
    case 'messages':
      return <MessagesView />;
    case 'deposit':
      return <DepositView />;
    case 'submissions':
      return <SubmissionsView />;
    case 'success':
      return <SuccessView />;
    case 'timeline':
      return <TimelineView />;
    default:
      return <LoginView />;
  }
}

export default function SecurePortal() {
  return (
    <PortalProvider>
      <PortalContent />
    </PortalProvider>
  );
}
