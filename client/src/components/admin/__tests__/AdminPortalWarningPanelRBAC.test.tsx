// @vitest-environment jsdom
//
// Role-based access control tests for AdminPortalWarningPanel.
//
// Contracted behaviours:
//   (rbac-viewer-idle-no-send)   viewer role: Send Warning button absent in idle state.
//   (rbac-viewer-idle-no-skip)   viewer role: Skip to Reactivation button absent in idle state.
//   (rbac-viewer-idle-notice)    viewer role: read-only notice shown in idle state.
//   (rbac-viewer-active-no-cancel)   viewer role: Cancel Warning button absent in active state.
//   (rbac-viewer-active-no-override) viewer role: Override Countdown button absent in active state.
//   (rbac-agent-idle-no-send)    agent role: Send Warning button absent in idle state.
//   (rbac-agent-active-no-cancel) agent role: Cancel Warning button absent in active state.
//   (rbac-admin-idle-has-send)   admin role: Send Warning button present in idle state.
//   (rbac-admin-active-has-cancel) admin role: Cancel Warning button present in active state.
//   (rbac-super-idle-has-send)   super_admin role: Send Warning button present in idle state.
//   (rbac-default-idle-has-send) no adminRole prop: defaults to "admin", Send Warning button present.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ── Stubs ─────────────────────────────────────────────────────────────────
vi.mock("framer-motion", () => ({
  motion: { div: ({ children, ...r }: any) => <div {...r}>{children}</div> },
  AnimatePresence: ({ children }: any) => children,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>
  ),
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ value, onChange, ...rest }: any) => (
    <textarea value={value} onChange={onChange} {...rest} />
  ),
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...rest }: any) => <label {...rest}>{children}</label>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
}));
vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, ...rest }: any) => (
    <input value={value} onChange={onChange} {...rest} />
  ),
}));
vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  Clock: () => null,
  XCircle: () => null,
  Loader2: () => null,
  Send: () => null,
  Monitor: () => null,
  Mail: () => null,
  FileText: () => null,
  Zap: () => null,
  SkipForward: () => null,
  DollarSign: () => null,
  RefreshCw: () => null,
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.stubGlobal("fetch", vi.fn());
// ── Silence ResizeObserver ─────────────────────────────────────────────────
beforeEach(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
});

import { AdminPortalWarningPanel } from "../AdminPortalWarningPanel";

const CASE_ID = "case-rbac-test-1";
const AUTH_TOKEN = "rbac-test-token";

function renderIdle(adminRole?: string) {
  return render(
    <AdminPortalWarningPanel
      caseId={CASE_ID}
      authToken={AUTH_TOKEN}
      portalWarningAt={null}
      portalWarningMinutes={null}
      portalWarningMessage={null}
      adminRole={adminRole}
    />,
  );
}

function renderActive(adminRole?: string) {
  const warningAt = new Date(Date.now() + 5 * 60_000).toISOString();
  return render(
    <AdminPortalWarningPanel
      caseId={CASE_ID}
      authToken={AUTH_TOKEN}
      portalWarningAt={warningAt}
      portalWarningMinutes={5}
      portalWarningMessage={null}
      adminRole={adminRole}
    />,
  );
}

// ── Viewer role — idle state ───────────────────────────────────────────────

describe("AdminPortalWarningPanel RBAC — viewer role, idle state", () => {
  it("(rbac-viewer-idle-no-send) does not render Send Warning button", () => {
    renderIdle("viewer");
    expect(screen.queryByTestId("button-send-portal-warning")).toBeNull();
  });

  it("(rbac-viewer-idle-no-skip) does not render Skip to Reactivation button", () => {
    renderIdle("viewer");
    expect(screen.queryByTestId("button-skip-to-reactivation")).toBeNull();
  });

  it("(rbac-viewer-idle-notice) shows read-only notice", () => {
    renderIdle("viewer");
    expect(screen.getByTestId("portal-warning-viewer-notice")).toBeTruthy();
  });
});

// ── Viewer role — active state ─────────────────────────────────────────────

describe("AdminPortalWarningPanel RBAC — viewer role, active state", () => {
  it("(rbac-viewer-active-no-cancel) does not render Cancel Warning button", () => {
    renderActive("viewer");
    expect(screen.queryByTestId("button-cancel-portal-warning")).toBeNull();
  });

  it("(rbac-viewer-active-no-override) does not render Override Countdown button", () => {
    renderActive("viewer");
    expect(screen.queryByTestId("button-override-countdown")).toBeNull();
  });
});

// ── Agent role ─────────────────────────────────────────────────────────────

describe("AdminPortalWarningPanel RBAC — agent role", () => {
  it("(rbac-agent-idle-no-send) does not render Send Warning button", () => {
    renderIdle("agent");
    expect(screen.queryByTestId("button-send-portal-warning")).toBeNull();
  });

  it("(rbac-agent-active-no-cancel) does not render Cancel Warning button", () => {
    renderActive("agent");
    expect(screen.queryByTestId("button-cancel-portal-warning")).toBeNull();
  });
});

// ── Admin role ─────────────────────────────────────────────────────────────

describe("AdminPortalWarningPanel RBAC — admin role", () => {
  it("(rbac-admin-idle-has-send) renders Send Warning button", () => {
    renderIdle("admin");
    expect(screen.getByTestId("button-send-portal-warning")).toBeTruthy();
  });

  it("(rbac-admin-active-has-cancel) renders Cancel Warning button", () => {
    renderActive("admin");
    expect(screen.getByTestId("button-cancel-portal-warning")).toBeTruthy();
  });
});

// ── super_admin role ───────────────────────────────────────────────────────

describe("AdminPortalWarningPanel RBAC — super_admin role", () => {
  it("(rbac-super-idle-has-send) renders Send Warning button", () => {
    renderIdle("super_admin");
    expect(screen.getByTestId("button-send-portal-warning")).toBeTruthy();
  });
});

// ── Default (no adminRole prop) ────────────────────────────────────────────

describe("AdminPortalWarningPanel RBAC — default (no adminRole prop)", () => {
  it("(rbac-default-idle-has-send) defaults to admin-level access, renders Send Warning button", () => {
    renderIdle(undefined);
    expect(screen.getByTestId("button-send-portal-warning")).toBeTruthy();
  });
});
