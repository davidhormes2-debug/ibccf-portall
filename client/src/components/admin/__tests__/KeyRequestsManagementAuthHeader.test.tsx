// @vitest-environment jsdom
//
// Verifies that KeyRequestsManagement forwards the authToken prop as an
// Authorization: Bearer <token> header when fetching /admin/list, and that
// it falls back to sessionStorage when no prop is provided.
//
// Also verifies that approve, reject, and message mutation calls include the
// Authorization header — catching a regression where auth headers were dropped.
//
// All vi.mock factories are self-contained (no outer-scope refs) to avoid
// Vitest hoisting issues.
//
// key_requests_auth_header_guard (sentinel string for CI)

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor, screen, fireEvent } from "@testing-library/react";

// ── Module stubs (all factories must be self-contained due to vi.mock hoisting) ──

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...p }: any) => React.createElement("div", p, children),
    span: ({ children, ...p }: any) => React.createElement("span", p, children),
  },
  AnimatePresence: ({ children }: any) => children,
  useReducedMotion: () => false,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => React.createElement("div", null, children),
  DialogContent: ({ children }: any) => React.createElement("div", null, children),
  DialogHeader: ({ children }: any) => React.createElement("div", null, children),
  DialogTitle: ({ children }: any) => React.createElement("div", null, children),
  DialogFooter: ({ children }: any) => React.createElement("div", null, children),
  DialogDescription: ({ children }: any) => React.createElement("div", null, children),
  DialogClose: ({ children }: any) => React.createElement("div", null, children),
}));

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: any) => React.createElement("table", null, children),
  TableHeader: ({ children }: any) => React.createElement("thead", null, children),
  TableBody: ({ children }: any) => React.createElement("tbody", null, children),
  TableHead: ({ children }: any) => React.createElement("th", null, children),
  TableRow: ({ children, ...p }: any) => React.createElement("tr", p, children),
  TableCell: ({ children }: any) => React.createElement("td", null, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => React.createElement("span", null, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...p }: any) =>
    React.createElement("button", { onClick, disabled, ...p }, children),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => React.createElement("div", null, children),
  CardContent: ({ children }: any) => React.createElement("div", null, children),
  CardHeader: ({ children }: any) => React.createElement("div", null, children),
  CardTitle: ({ children }: any) => React.createElement("div", null, children),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => React.createElement("div", null, children),
  SelectContent: ({ children }: any) => React.createElement("div", null, children),
  SelectItem: ({ children, value }: any) =>
    React.createElement("div", { "data-value": value }, children),
  SelectTrigger: ({ children }: any) => React.createElement("div", null, children),
  SelectValue: () => null,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ onChange, value, ...props }: any) =>
    React.createElement("textarea", { onChange, value, ...props }),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: any) => React.createElement("div", null, children),
  AlertDialogContent: ({ children }: any) => React.createElement("div", null, children),
  AlertDialogHeader: ({ children }: any) => React.createElement("div", null, children),
  AlertDialogTitle: ({ children }: any) => React.createElement("div", null, children),
  AlertDialogDescription: ({ children }: any) => React.createElement("div", null, children),
  AlertDialogFooter: ({ children }: any) => React.createElement("div", null, children),
  AlertDialogCancel: ({ children }: any) => React.createElement("button", null, children),
  AlertDialogAction: ({ children, onClick }: any) =>
    React.createElement("button", { onClick }, children),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => null,
}));

vi.mock("@/components/ui/separator", () => ({ Separator: () => null }));
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => React.createElement("div", null, children),
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => React.createElement("div", null, children),
  TooltipContent: ({ children }: any) => React.createElement("div", null, children),
  TooltipTrigger: ({ children }: any) => React.createElement("div", null, children),
  TooltipProvider: ({ children }: any) => React.createElement("div", null, children),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => React.createElement("input", props),
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => React.createElement("div", null, children),
  TabsList: ({ children }: any) => React.createElement("div", null, children),
  TabsTrigger: ({ children, value }: any) =>
    React.createElement("button", { "data-value": value }, children),
}));

vi.mock("lucide-react", () => ({
  Key: () => null, Check: () => null, X: () => null, Send: () => null,
  Clock: () => null, AlertTriangle: () => null, CheckCircle: () => null,
  XCircle: () => null, Mail: () => null, User: () => null, Phone: () => null,
  MessageSquare: () => null, RefreshCw: () => null, Copy: () => null,
  ClipboardCheck: () => null,
}));

// ── Minimal error boundary to swallow render crashes ─────────────────────────

class SilentBoundary extends Component<{ children: ReactNode }> {
  state = { crashed: false };
  componentDidCatch(_e: Error, _i: ErrorInfo) {}
  static getDerivedStateFromError() { return { crashed: true }; }
  render() {
    return this.state.crashed
      ? React.createElement("div", { "data-testid": "crashed" })
      : this.props.children;
  }
}

// ── shared fixture ────────────────────────────────────────────────────────────

const PENDING_REQUEST = {
  id: 1,
  requestId: "REQ-001",
  generatedKey: "KEY-AAAA",
  status: "pending" as const,
  userName: "Test User",
  userEmail: "test@example.com",
  userPhone: null,
  requestReason: null,
  adminMessages: null,
  adminUsername: null,
  caseId: null,
  caseRef: null,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  approvedAt: null,
  rejectedAt: null,
  keyViewedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ── list-fetch fetch stub (shared across list tests) ─────────────────────────

let capturedHeaders: Record<string, string> = {};
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  capturedHeaders = {};
  fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    capturedHeaders = { ...((init?.headers ?? {}) as Record<string, string>) };
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

// ── list-fetch auth tests ─────────────────────────────────────────────────────

describe("KeyRequestsManagement — Authorization header forwarding", () => {
  it("sends Authorization: Bearer <token> when authToken prop is provided", async () => {
    const { KeyRequestsManagement } = await import("../KeyRequestsManagement");
    render(
      React.createElement(SilentBoundary, null,
        React.createElement(KeyRequestsManagement, { authToken: "prop-bearer-token" }),
      ),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });

    const auth = capturedHeaders["Authorization"] ?? capturedHeaders["authorization"];
    expect(auth).toBe("Bearer prop-bearer-token");
  });

  it("prop token takes precedence over sessionStorage token", async () => {
    sessionStorage.setItem("adminToken", "storage-token");
    const { KeyRequestsManagement } = await import("../KeyRequestsManagement");
    render(
      React.createElement(SilentBoundary, null,
        React.createElement(KeyRequestsManagement, { authToken: "prop-beats-storage" }),
      ),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });

    const auth = capturedHeaders["Authorization"] ?? capturedHeaders["authorization"];
    expect(auth).toBe("Bearer prop-beats-storage");
  });

  it("falls back to sessionStorage when no authToken prop is given", async () => {
    sessionStorage.setItem("adminToken", "session-fallback-token");
    const { KeyRequestsManagement } = await import("../KeyRequestsManagement");
    render(
      React.createElement(SilentBoundary, null,
        React.createElement(KeyRequestsManagement, {}),
      ),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });

    const auth = capturedHeaders["Authorization"] ?? capturedHeaders["authorization"];
    expect(auth).toBe("Bearer session-fallback-token");
  });

  it("calls /api/access-key-requests/admin/list", async () => {
    const { KeyRequestsManagement } = await import("../KeyRequestsManagement");
    render(
      React.createElement(SilentBoundary, null,
        React.createElement(KeyRequestsManagement, { authToken: "any-token" }),
      ),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });

    const [[url]] = fetchMock.mock.calls as [[string, RequestInit?]];
    expect(url).toContain("/api/access-key-requests/admin/list");
  });
});

// ── mutation-call auth tests ──────────────────────────────────────────────────
//
// Each test sets up a URL-aware fetch mock: list calls return [PENDING_REQUEST]
// so buttons appear, mutation calls return a success response.  capturedHeaders
// is updated on every call, so the final captured value is the mutation call.

describe("KeyRequestsManagement — Authorization header on mutation calls", () => {
  // Per-describe beforeEach: replace the outer fetchMock with one that serves
  // a pending request on list requests and records the call URL + headers.
  type CallRecord = { url: string; method?: string; headers: Record<string, string> };
  let callLog: CallRecord[];

  beforeEach(() => {
    callLog = [];
    const mock = vi.fn((url: string, init?: RequestInit) => {
      const headers = { ...((init?.headers ?? {}) as Record<string, string>) };
      callLog.push({ url, method: (init as any)?.method, headers });
      const isList = (url as string).includes("/admin/list");
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(isList ? [PENDING_REQUEST] : {}),
      } as Response);
    });
    vi.stubGlobal("fetch", mock);
    fetchMock = mock;
  });

  async function renderWithPendingList(token: string) {
    const { KeyRequestsManagement } = await import("../KeyRequestsManagement");
    render(
      React.createElement(SilentBoundary, null,
        React.createElement(KeyRequestsManagement, { authToken: token }),
      ),
    );
    // Wait until the pending request's approve button appears in the table.
    // getByTestId throws when element is absent, so waitFor retries until found.
    await waitFor(
      () => screen.getByTestId("button-approve-1"),
      { timeout: 4000 },
    );
  }

  it("sends Authorization header on approve call", async () => {
    await renderWithPendingList("approve-token");

    // button-approve-1 opens the verification dialog; then click
    // button-approve-without-email to fire the actual /approve POST.
    fireEvent.click(screen.getByTestId("button-approve-1"));
    await waitFor(
      () => screen.getByTestId("button-approve-without-email"),
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByTestId("button-approve-without-email"));

    // Wait for the mutation call (index 1; index 0 is the list call)
    await waitFor(() => expect(callLog.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });

    const mutationCall = callLog.find((c) => (c.url as string).includes("/approve"));
    expect(mutationCall).toBeDefined();
    const auth = mutationCall!.headers["Authorization"] ?? mutationCall!.headers["authorization"];
    expect(auth).toBe("Bearer approve-token");
  });

  it("approve call targets the correct endpoint with POST method", async () => {
    await renderWithPendingList("approve-token");

    fireEvent.click(screen.getByTestId("button-approve-1"));
    await waitFor(
      () => screen.getByTestId("button-approve-without-email"),
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByTestId("button-approve-without-email"));

    await waitFor(() => expect(callLog.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });

    const mutationCall = callLog.find((c) => (c.url as string).includes("/approve"));
    expect(mutationCall).toBeDefined();
    expect(mutationCall!.url).toContain("/api/access-key-requests/admin/1/approve");
    expect(mutationCall!.method).toBe("POST");
  });

  it("sends Authorization header on reject call", async () => {
    await renderWithPendingList("reject-token");

    fireEvent.click(screen.getByTestId("button-reject-1"));
    // The Dialog mock always renders children so button-confirm-reject is already
    // in the DOM. The state update sets selectedRequest so handleReject can run.
    await waitFor(
      () => screen.getByTestId("button-confirm-reject"),
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByTestId("button-confirm-reject"));

    await waitFor(() => expect(callLog.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });

    const mutationCall = callLog.find((c) => (c.url as string).includes("/reject"));
    expect(mutationCall).toBeDefined();
    const auth = mutationCall!.headers["Authorization"] ?? mutationCall!.headers["authorization"];
    expect(auth).toBe("Bearer reject-token");
  });

  it("reject call targets the correct endpoint with POST method", async () => {
    await renderWithPendingList("reject-token");

    fireEvent.click(screen.getByTestId("button-reject-1"));
    await waitFor(
      () => screen.getByTestId("button-confirm-reject"),
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByTestId("button-confirm-reject"));

    await waitFor(() => expect(callLog.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });

    const mutationCall = callLog.find((c) => (c.url as string).includes("/reject"));
    expect(mutationCall).toBeDefined();
    expect(mutationCall!.url).toContain("/api/access-key-requests/admin/1/reject");
    expect(mutationCall!.method).toBe("POST");
  });

  it("sends Authorization header on message call", async () => {
    await renderWithPendingList("message-token");

    // Open the message dialog via the row action button
    fireEvent.click(screen.getByTestId("button-message-1"));

    // The Dialog mock always renders children, so the textarea is always in DOM;
    // type a message so the Send button is no longer disabled
    const textarea = screen.getByTestId("input-admin-message");
    fireEvent.change(textarea, { target: { value: "Hello user" } });

    // Wait for the button to become enabled (state update processed)
    await waitFor(
      () => {
        const btn = screen.getByTestId("button-send-message");
        expect((btn as HTMLButtonElement).disabled).toBe(false);
      },
      { timeout: 3000 },
    );

    fireEvent.click(screen.getByTestId("button-send-message"));

    await waitFor(() => expect(callLog.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });

    const mutationCall = callLog.find((c) => (c.url as string).includes("/message"));
    expect(mutationCall).toBeDefined();
    const auth = mutationCall!.headers["Authorization"] ?? mutationCall!.headers["authorization"];
    expect(auth).toBe("Bearer message-token");
  });

  it("message call targets the correct endpoint with POST method", async () => {
    await renderWithPendingList("message-token");

    fireEvent.click(screen.getByTestId("button-message-1"));

    const textarea = screen.getByTestId("input-admin-message");
    fireEvent.change(textarea, { target: { value: "Hello user" } });

    await waitFor(
      () => {
        const btn = screen.getByTestId("button-send-message");
        expect((btn as HTMLButtonElement).disabled).toBe(false);
      },
      { timeout: 3000 },
    );

    fireEvent.click(screen.getByTestId("button-send-message"));

    await waitFor(() => expect(callLog.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });

    const mutationCall = callLog.find((c) => (c.url as string).includes("/message"));
    expect(mutationCall).toBeDefined();
    expect(mutationCall!.url).toContain("/api/access-key-requests/admin/1/message");
    expect(mutationCall!.method).toBe("POST");
  });
});
