// @vitest-environment jsdom
//
// Role-based access control tests for BulkBroadcastPanel (inside CommunicationsTab).
//
// Contracted behaviours:
//   (rbac-bulk-viewer-no-form)    viewer role: bulk send form (subject input) is not rendered.
//   (rbac-bulk-viewer-no-send)    viewer role: Send button is not rendered.
//   (rbac-bulk-viewer-notice)     viewer role: read-only notice shown.
//   (rbac-bulk-agent-no-form)     agent role: bulk send form is not rendered.
//   (rbac-bulk-admin-has-form)    admin role: bulk send form (subject input) is rendered.
//   (rbac-bulk-admin-has-send)    admin role: Send button is rendered.
//   (rbac-bulk-super-has-form)    super_admin role: bulk send form is rendered.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mock useAdminDashboard ─────────────────────────────────────────────────
let mockAdminRole = "admin";

vi.mock("../AdminDashboardContext", () => ({
  useAdminDashboard: () => ({ adminRole: mockAdminRole }),
}));

// ── Stub lucide icons ──────────────────────────────────────────────────────
vi.mock("lucide-react", () => ({
  Mail: () => null,
  Megaphone: () => null,
  Send: () => null,
  Users: () => null,
  AlertCircle: () => null,
  CheckCircle: () => null,
  Info: () => null,
  AlertTriangle: () => null,
  Trash2: () => null,
  Loader2: () => null,
  Search: () => null,
  Clock: () => null,
  RefreshCw: () => null,
  ExternalLink: () => null,
}));

// ── Stub shadcn/ui ─────────────────────────────────────────────────────────
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, ...rest }: any) => (
    <input value={value} onChange={onChange} {...rest} />
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
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value, ...rest }: any) => (
    <button data-value={value} {...rest}>{children}</button>
  ),
  TabsContent: ({ children, value }: any) => (
    <div data-value={value}>{children}</div>
  ),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...rest }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...rest}
    />
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Stub fetch to return an empty recipients list so BulkBroadcastPanel renders fully
vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ),
);

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

import CommunicationsTab from "../tabs/CommunicationsTab";

function renderTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <CommunicationsTab />
    </QueryClientProvider>,
  );
}

// ── Viewer role ────────────────────────────────────────────────────────────

describe("BulkBroadcastPanel RBAC — viewer role", () => {
  beforeEach(() => {
    mockAdminRole = "viewer";
  });

  it("(rbac-bulk-viewer-no-form) does not render the subject input", () => {
    renderTab();
    expect(screen.queryByTestId("input-bulk-subject")).toBeNull();
  });

  it("(rbac-bulk-viewer-no-send) does not render the Send button", () => {
    renderTab();
    expect(screen.queryByTestId("button-bulk-send")).toBeNull();
  });

  it("(rbac-bulk-viewer-notice) shows read-only notice", () => {
    renderTab();
    expect(screen.getByTestId("bulk-email-viewer-notice")).toBeTruthy();
  });
});

// ── Agent role ─────────────────────────────────────────────────────────────

describe("BulkBroadcastPanel RBAC — agent role", () => {
  beforeEach(() => {
    mockAdminRole = "agent";
  });

  it("(rbac-bulk-agent-no-form) does not render the subject input", () => {
    renderTab();
    expect(screen.queryByTestId("input-bulk-subject")).toBeNull();
  });
});

// ── Admin role ─────────────────────────────────────────────────────────────

describe("BulkBroadcastPanel RBAC — admin role", () => {
  beforeEach(() => {
    mockAdminRole = "admin";
  });

  it("(rbac-bulk-admin-has-form) renders the subject input", () => {
    renderTab();
    expect(screen.getByTestId("input-bulk-subject")).toBeTruthy();
  });

  it("(rbac-bulk-admin-has-send) renders the Send button", () => {
    renderTab();
    expect(screen.getByTestId("button-bulk-send")).toBeTruthy();
  });
});

// ── super_admin role ───────────────────────────────────────────────────────

describe("BulkBroadcastPanel RBAC — super_admin role", () => {
  beforeEach(() => {
    mockAdminRole = "super_admin";
  });

  it("(rbac-bulk-super-has-form) renders the subject input", () => {
    renderTab();
    expect(screen.getByTestId("input-bulk-subject")).toBeTruthy();
  });
});
