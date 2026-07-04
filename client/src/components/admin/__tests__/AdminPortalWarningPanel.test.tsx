// @vitest-environment jsdom
//
// Unit tests for AdminPortalWarningPanel.
//
// Contracted behaviours:
//   (a) When no active warning exists, the "Send Warning" button is rendered.
//   (b) When an active warning exists, the "Cancel Warning" button is rendered.
//   (c) Clicking "Send Warning" calls POST /api/cases/:id/portal-warning with
//       the correct Authorization header, minutes, and message.
//   (d) Clicking "Cancel Warning" calls DELETE /api/cases/:id/portal-warning
//       with the correct Authorization header.
//   (e) onChanged is called after a successful send.
//   (f) onChanged is called after a successful cancel.
//   (g) A failed POST shows a destructive toast (does NOT call onChanged).
//   (h) A failed DELETE shows a destructive toast (does NOT call onChanged).
//   (i) The send button is disabled while the request is in-flight.
//   (j) The cancel button is disabled while the request is in-flight.
//   (s) The reactivation page message textarea is rendered in the active state.
//   (t) Saving the message in the active state calls PATCH /api/cases/:id with
//       reactivationPageMessage and the correct Authorization header.
//   (u) onChanged is called after a successful reactivation message save (active).
//   (v) Destructive toast shown on reactivation message save failure (active);
//       onChanged is NOT called.
//   (w) The character counter below the textarea in the active state reflects
//       the current character count and updates as the user types.
//   (w) The reactivation page message textarea is rendered in the idle state.
//   (w-idle-counter) The character counter below the textarea in the idle state
//       reflects the current character count and updates as the user types.
//   (x) Saving the message in the idle state calls PATCH /api/cases/:id with
//       reactivationPageMessage and the correct Authorization header.
//   (y) onChanged is called after a successful reactivation message save (idle).
//   (z) Destructive toast shown on reactivation message save failure (idle);
//       onChanged is NOT called.
//   (sweep-render) The "Run now" sweep button is always rendered (both active and inactive states).
//   (sweep-call) Clicking "Run now" calls POST /api/admin/portal-warning-expiry-sweep/run
//       with the correct Authorization header. [tested in both inactive AND active states]
//   (sweep-success-processed) A successful sweep with processed > 0 shows "Sweep complete"
//       toast with the case count and calls onChanged. [tested in both inactive AND active states]
//   (sweep-success-zero) A successful sweep with processed = 0 shows "No expired warnings found."
//       [tested in both inactive AND active states]
//   (sweep-skipped) A successful sweep with skipped = true shows "Sweep skipped" toast.
//       [tested in both inactive AND active states]
//   (sweep-error) A failed sweep shows a destructive toast and does NOT call onChanged.
//       [tested in both inactive AND active states]
//   (sweep-loading) The sweep button is disabled while the request is in-flight.
//       [tested in both inactive AND active states]
//   (k-idle) The Override Countdown button is NOT rendered in the idle state
//       (cross-state symmetry check, mirrors the sweep button pattern).
//   (o-active) The Skip to Reactivation button is NOT rendered in the active
//       state (cross-state symmetry check, mirrors the sweep button pattern).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";

// ── Silence framer-motion (not used here, but transitive deps may import it)
vi.mock("framer-motion", () => ({
  motion: { div: ({ children, ...r }: any) => <div {...r}>{children}</div> },
  AnimatePresence: ({ children }: any) => children,
}));

// ── shadcn/ui stubs ───────────────────────────────────────────────────────
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
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
  Select: ({ children, value, onValueChange }: any) => (
    <div data-value={value} data-testid="select-root">
      {children}
      <button
        data-testid="select-trigger-inner"
        onClick={() => onValueChange?.("10")}
      />
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div data-value={value}>{children}</div>
  ),
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
}));

// ── shadcn/ui Input stub ──────────────────────────────────────────────────
vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, ...rest }: any) => (
    <input value={value} onChange={onChange} {...rest} />
  ),
}));

// ── lucide-react icons ────────────────────────────────────────────────────
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

// ── Toast capture ─────────────────────────────────────────────────────────
const toasts: any[] = [];
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: (t: any) => {
      toasts.push(t);
    },
  }),
}));

// ── fetch mock ────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function okResponse(body: unknown = { success: true }) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function errResponse(body: unknown = { error: "Server error" }, status = 500) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// Task #2387 — Override Countdown / Skip to Reactivation now check for an
// active portal session before confirming, just like rotate-code/lock/reset-pin.
function activeSessionResponse(hasActiveSession = false) {
  return okResponse({ hasActiveSession, lastActivityAt: null });
}

import { AdminPortalWarningPanel } from "../AdminPortalWarningPanel";

// ── Test setup ────────────────────────────────────────────────────────────

const CASE_ID = "case-pw-panel-1";
const AUTH_TOKEN = "admin-panel-test-token";

beforeEach(() => {
  toasts.length = 0;
  fetchMock.mockReset();
  // Override Countdown / Skip to Reactivation confirm via window.confirm;
  // default to "confirmed" so pre-existing tests keep exercising the POST.
  vi.spyOn(window, "confirm").mockReturnValue(true);
  // Silence ResizeObserver used by Radix UI primitives.
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────

function renderInactive(overrides: Partial<Parameters<typeof AdminPortalWarningPanel>[0]> = {}) {
  return render(
    <AdminPortalWarningPanel
      caseId={CASE_ID}
      authToken={AUTH_TOKEN}
      portalWarningAt={null}
      portalWarningMinutes={null}
      portalWarningMessage={null}
      {...overrides}
    />,
  );
}

function renderActive(overrides: Partial<Parameters<typeof AdminPortalWarningPanel>[0]> = {}) {
  // Active = warningAt is in the future.
  const warningAt = new Date(Date.now() + 5 * 60_000).toISOString();
  return render(
    <AdminPortalWarningPanel
      caseId={CASE_ID}
      authToken={AUTH_TOKEN}
      portalWarningAt={warningAt}
      portalWarningMinutes={5}
      portalWarningMessage={null}
      {...overrides}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("AdminPortalWarningPanel — idle state (no active warning)", () => {
  it("(a) renders the Send Warning button when no active warning exists", () => {
    renderInactive();
    expect(screen.getByTestId("button-send-portal-warning")).toBeTruthy();
    expect(screen.queryByTestId("button-cancel-portal-warning")).toBeNull();
  });
});

describe("AdminPortalWarningPanel — active state", () => {
  it("(b) renders the Cancel Warning button when an active warning exists", () => {
    renderActive();
    expect(screen.getByTestId("button-cancel-portal-warning")).toBeTruthy();
    expect(screen.queryByTestId("button-send-portal-warning")).toBeNull();
  });
});

describe("AdminPortalWarningPanel — send warning", () => {
  it("(c) POST is called with correct endpoint, auth header, and body", async () => {
    fetchMock.mockReturnValueOnce(okResponse());
    renderInactive();

    fireEvent.click(screen.getByTestId("button-send-portal-warning"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/cases/${CASE_ID}/portal-warning`);
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${AUTH_TOKEN}`,
    );
    const body = JSON.parse(opts.body as string);
    expect(body.minutes).toBe(5); // default duration
  });

  it("(e) onChanged is called after a successful send", async () => {
    fetchMock.mockReturnValueOnce(okResponse());
    const onChanged = vi.fn();
    renderInactive({ onChanged });

    fireEvent.click(screen.getByTestId("button-send-portal-warning"));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("(g) destructive toast is shown on a failed POST; onChanged is NOT called", async () => {
    fetchMock.mockReturnValueOnce(errResponse({ error: "Forbidden" }, 403));
    const onChanged = vi.fn();
    renderInactive({ onChanged });

    fireEvent.click(screen.getByTestId("button-send-portal-warning"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));

    const errorToast = toasts.find((t) => t.variant === "destructive");
    expect(errorToast).toBeTruthy();
    expect(errorToast.title).toBe("Failed to send warning");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("(i) send button is disabled while the request is in-flight", async () => {
    let resolveResponse!: (v: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((r) => { resolveResponse = r; }),
    );
    renderInactive();

    fireEvent.click(screen.getByTestId("button-send-portal-warning"));

    // The button should be disabled while the fetch is pending.
    expect(
      (screen.getByTestId("button-send-portal-warning") as HTMLButtonElement).disabled,
    ).toBe(true);

    // Resolve and clean up.
    resolveResponse(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await waitFor(() =>
      expect(
        (screen.getByTestId("button-send-portal-warning") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });
});

describe("AdminPortalWarningPanel — cancel warning", () => {
  it("(d) DELETE is called with correct endpoint and auth header", async () => {
    fetchMock.mockReturnValueOnce(okResponse());
    renderActive();

    fireEvent.click(screen.getByTestId("button-cancel-portal-warning"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/cases/${CASE_ID}/portal-warning`);
    expect(opts.method).toBe("DELETE");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${AUTH_TOKEN}`,
    );
  });

  it("(f) onChanged is called after a successful cancel", async () => {
    fetchMock.mockReturnValueOnce(okResponse());
    const onChanged = vi.fn();
    renderActive({ onChanged });

    fireEvent.click(screen.getByTestId("button-cancel-portal-warning"));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("(h) destructive toast is shown on a failed DELETE; onChanged is NOT called", async () => {
    fetchMock.mockReturnValueOnce(errResponse({ error: "Internal error" }, 500));
    const onChanged = vi.fn();
    renderActive({ onChanged });

    fireEvent.click(screen.getByTestId("button-cancel-portal-warning"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));

    const errorToast = toasts.find((t) => t.variant === "destructive");
    expect(errorToast).toBeTruthy();
    expect(errorToast.title).toBe("Failed to cancel warning");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("(j) cancel button is disabled while the request is in-flight", async () => {
    let resolveResponse!: (v: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((r) => { resolveResponse = r; }),
    );
    renderActive();

    fireEvent.click(screen.getByTestId("button-cancel-portal-warning"));

    expect(
      (screen.getByTestId("button-cancel-portal-warning") as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveResponse(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await waitFor(() =>
      expect(
        (screen.getByTestId("button-cancel-portal-warning") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });
});

describe("AdminPortalWarningPanel — no authToken", () => {
  it("does not call fetch when authToken is null", async () => {
    fetchMock.mockReturnValueOnce(okResponse());
    render(
      <AdminPortalWarningPanel
        caseId={CASE_ID}
        authToken={null}
        portalWarningAt={null}
        portalWarningMinutes={null}
        portalWarningMessage={null}
      />,
    );

    fireEvent.click(screen.getByTestId("button-send-portal-warning"));

    // Small delay to confirm nothing fired.
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AdminPortalWarningPanel — override countdown (active state)", () => {
  it("(k) Override Countdown button is rendered when a warning is active", () => {
    renderActive();
    expect(screen.getByTestId("button-override-countdown")).toBeTruthy();
  });

  it("(k-idle) Override Countdown button is NOT rendered when no warning is active", () => {
    renderInactive();
    expect(screen.queryByTestId("button-override-countdown")).toBeNull();
  });

  it("(l) Override Countdown calls POST .../portal-warning/override with correct auth", async () => {
    fetchMock.mockReturnValueOnce(activeSessionResponse());
    fetchMock.mockReturnValueOnce(okResponse());
    renderActive();

    fireEvent.click(screen.getByTestId("button-override-countdown"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [sessionUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sessionUrl).toBe(`/api/cases/${CASE_ID}/active-session`);

    const [url, opts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/cases/${CASE_ID}/portal-warning/override`);
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${AUTH_TOKEN}`,
    );
  });

  it("(l-confirm-cancel) declining the confirm dialog does not call the override endpoint", async () => {
    (window.confirm as any).mockReturnValue(false);
    fetchMock.mockReturnValueOnce(activeSessionResponse());
    renderActive();

    fireEvent.click(screen.getByTestId("button-override-countdown"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/cases/${CASE_ID}/active-session`);
  });

  it("(m) onChanged is called after a successful override", async () => {
    fetchMock.mockReturnValueOnce(activeSessionResponse());
    fetchMock.mockReturnValueOnce(okResponse());
    const onChanged = vi.fn();
    renderActive({ onChanged });

    fireEvent.click(screen.getByTestId("button-override-countdown"));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("(n) destructive toast shown on override failure; onChanged not called", async () => {
    fetchMock.mockReturnValueOnce(activeSessionResponse());
    fetchMock.mockReturnValueOnce(errResponse({ error: "Server error" }, 500));
    const onChanged = vi.fn();
    renderActive({ onChanged });

    fireEvent.click(screen.getByTestId("button-override-countdown"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const errorToast = toasts.find((t) => t.variant === "destructive");
    expect(errorToast).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("AdminPortalWarningPanel — skip to reactivation (idle state)", () => {
  it("(o) Skip to Reactivation button is rendered when no warning is active", () => {
    renderInactive();
    expect(screen.getByTestId("button-skip-to-reactivation")).toBeTruthy();
  });

  it("(o-active) Skip to Reactivation button is NOT rendered when a warning is active", () => {
    renderActive();
    expect(screen.queryByTestId("button-skip-to-reactivation")).toBeNull();
  });

  it("(p) Skip to Reactivation calls POST .../portal-warning/skip-reactivation with correct auth", async () => {
    fetchMock.mockReturnValueOnce(activeSessionResponse());
    fetchMock.mockReturnValueOnce(okResponse());
    renderInactive();

    fireEvent.click(screen.getByTestId("button-skip-to-reactivation"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [sessionUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sessionUrl).toBe(`/api/cases/${CASE_ID}/active-session`);

    const [url, opts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/cases/${CASE_ID}/portal-warning/skip-reactivation`);
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${AUTH_TOKEN}`,
    );
  });

  it("(p-confirm-cancel) declining the confirm dialog does not call the skip endpoint", async () => {
    (window.confirm as any).mockReturnValue(false);
    fetchMock.mockReturnValueOnce(activeSessionResponse());
    renderInactive();

    fireEvent.click(screen.getByTestId("button-skip-to-reactivation"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/cases/${CASE_ID}/active-session`);
  });

  it("(q) onChanged is called after a successful skip", async () => {
    fetchMock.mockReturnValueOnce(activeSessionResponse());
    fetchMock.mockReturnValueOnce(okResponse());
    const onChanged = vi.fn();
    renderInactive({ onChanged });

    fireEvent.click(screen.getByTestId("button-skip-to-reactivation"));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("(r) destructive toast shown on skip failure; onChanged not called", async () => {
    fetchMock.mockReturnValueOnce(activeSessionResponse());
    fetchMock.mockReturnValueOnce(errResponse({ error: "Server error" }, 500));
    const onChanged = vi.fn();
    renderInactive({ onChanged });

    fireEvent.click(screen.getByTestId("button-skip-to-reactivation"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const errorToast = toasts.find((t) => t.variant === "destructive");
    expect(errorToast).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("AdminPortalWarningPanel — reactivation page message in active state", () => {
  it("(s) reactivation page message textarea is rendered when a warning is active", () => {
    renderActive({ reactivationPageMessage: "Existing message" });
    expect(screen.getByTestId("input-reactivation-page-message")).toBeTruthy();
    expect(screen.getByTestId("button-save-reactivation-page-message")).toBeTruthy();
  });

  it("(t) saving message in active state calls PATCH /api/cases/:id with reactivationPageMessage and auth header", async () => {
    fetchMock.mockReturnValueOnce(okResponse());
    renderActive({ reactivationPageMessage: "Initial message" });

    const textarea = screen.getByTestId("input-reactivation-page-message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Updated compliance message" } });
    fireEvent.click(screen.getByTestId("button-save-reactivation-page-message"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/cases/${CASE_ID}`);
    expect(opts.method).toBe("PATCH");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${AUTH_TOKEN}`,
    );
    const body = JSON.parse(opts.body as string);
    expect(body.reactivationPageMessage).toBe("Updated compliance message");
  });

  it("(u) onChanged is called after a successful reactivation message save in active state", async () => {
    fetchMock.mockReturnValueOnce(okResponse());
    const onChanged = vi.fn();
    renderActive({ onChanged });

    fireEvent.click(screen.getByTestId("button-save-reactivation-page-message"));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("(v) destructive toast shown on reactivation message save failure (active); onChanged not called", async () => {
    fetchMock.mockReturnValueOnce(errResponse({ error: "Save failed" }, 500));
    const onChanged = vi.fn();
    renderActive({ onChanged });

    fireEvent.click(screen.getByTestId("button-save-reactivation-page-message"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const errorToast = toasts.find((t) => t.variant === "destructive");
    expect(errorToast).toBeTruthy();
    expect(errorToast.title).toBe("Failed to save message");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("(w) character counter reflects the current length and updates as the user types", () => {
    renderActive({ reactivationPageMessage: "Hello" });

    const counter = screen.getByTestId("char-count-reactivation-page-message");
    expect(counter.textContent).toBe("5/600");

    const textarea = screen.getByTestId("input-reactivation-page-message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Hello, world!" } });

    expect(counter.textContent).toBe("13/600");
  });
});

describe("AdminPortalWarningPanel — reactivation page message in idle state (no active warning)", () => {
  it("(w) reactivation page message textarea is rendered when no warning is active", () => {
    renderInactive({ reactivationPageMessage: "Existing idle message" });
    expect(screen.getByTestId("input-reactivation-page-message")).toBeTruthy();
    expect(screen.getByTestId("button-save-reactivation-page-message")).toBeTruthy();
  });

  it("(w-idle-counter) character counter reflects the current length and updates as the user types in the idle state", () => {
    renderInactive({ reactivationPageMessage: "Hi" });

    const counter = screen.getByTestId("char-count-reactivation-page-message");
    expect(counter.textContent).toBe("2/600");

    const textarea = screen.getByTestId("input-reactivation-page-message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Hi there!" } });

    expect(counter.textContent).toBe("9/600");
  });

  it("(x) saving message in idle state calls PATCH /api/cases/:id with reactivationPageMessage and auth header", async () => {
    fetchMock.mockReturnValueOnce(okResponse());
    renderInactive({ reactivationPageMessage: "" });

    const textarea = screen.getByTestId("input-reactivation-page-message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Idle compliance notice" } });
    fireEvent.click(screen.getByTestId("button-save-reactivation-page-message"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/cases/${CASE_ID}`);
    expect(opts.method).toBe("PATCH");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${AUTH_TOKEN}`,
    );
    const body = JSON.parse(opts.body as string);
    expect(body.reactivationPageMessage).toBe("Idle compliance notice");
  });

  it("(x2) saving an empty message sends null to clear the field", async () => {
    fetchMock.mockReturnValueOnce(okResponse());
    renderInactive({ reactivationPageMessage: "Old message" });

    const textarea = screen.getByTestId("input-reactivation-page-message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("button-save-reactivation-page-message"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.reactivationPageMessage).toBeNull();
  });

  it("(y) onChanged is called after a successful reactivation message save in idle state", async () => {
    fetchMock.mockReturnValueOnce(okResponse());
    const onChanged = vi.fn();
    renderInactive({ onChanged });

    fireEvent.click(screen.getByTestId("button-save-reactivation-page-message"));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("(z) destructive toast shown on reactivation message save failure (idle); onChanged not called", async () => {
    fetchMock.mockReturnValueOnce(errResponse({ error: "Save failed" }, 500));
    const onChanged = vi.fn();
    renderInactive({ onChanged });

    fireEvent.click(screen.getByTestId("button-save-reactivation-page-message"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const errorToast = toasts.find((t) => t.variant === "destructive");
    expect(errorToast).toBeTruthy();
    expect(errorToast.title).toBe("Failed to save message");
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("AdminPortalWarningPanel — run expiry sweep", () => {
  it("(sweep-render-inactive) sweep button is rendered in the inactive state", () => {
    renderInactive();
    expect(screen.getByTestId("button-run-expiry-sweep")).toBeTruthy();
  });

  it("(sweep-render-active) sweep button is rendered in the active state", () => {
    renderActive();
    expect(screen.getByTestId("button-run-expiry-sweep")).toBeTruthy();
  });

  it("(sweep-call) clicking the button calls POST /api/admin/portal-warning-expiry-sweep/run with auth header", async () => {
    fetchMock.mockReturnValueOnce(okResponse({ processed: 0, skipped: false }));
    renderInactive();

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/portal-warning-expiry-sweep/run");
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${AUTH_TOKEN}`,
    );
  });

  it("(sweep-success-processed) shows 'Sweep complete' toast with case count and calls onChanged", async () => {
    fetchMock.mockReturnValueOnce(okResponse({ processed: 3, skipped: false }));
    const onChanged = vi.fn();
    renderInactive({ onChanged });

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const t = toasts[0];
    expect(t.title).toBe("Sweep complete");
    expect(t.description).toMatch(/3 cases? force-disabled/);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("(sweep-success-zero) shows 'No expired warnings found.' when processed = 0", async () => {
    fetchMock.mockReturnValueOnce(okResponse({ processed: 0, skipped: false }));
    const onChanged = vi.fn();
    renderInactive({ onChanged });

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const t = toasts[0];
    expect(t.title).toBe("Sweep complete");
    expect(t.description).toBe("No expired warnings found.");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("(sweep-skipped) shows 'Sweep skipped' toast when skipped = true", async () => {
    fetchMock.mockReturnValueOnce(okResponse({ processed: 0, skipped: true }));
    const onChanged = vi.fn();
    renderInactive({ onChanged });

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const t = toasts[0];
    expect(t.title).toBe("Sweep skipped");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("(sweep-error) failed sweep shows destructive toast and does NOT call onChanged", async () => {
    fetchMock.mockReturnValueOnce(errResponse({ error: "DB timeout" }, 500));
    const onChanged = vi.fn();
    renderInactive({ onChanged });

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const errorToast = toasts.find((t) => t.variant === "destructive");
    expect(errorToast).toBeTruthy();
    expect(errorToast.title).toBe("Sweep failed");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("(sweep-loading) sweep button is disabled while the request is in-flight", async () => {
    let resolve!: (v: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    renderInactive();

    const btn = screen.getByTestId("button-run-expiry-sweep") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));

    resolve(new Response(JSON.stringify({ processed: 0, skipped: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  it("(sweep-case-id-inapp-nav) clicking a closed case-id badge calls onOpenCase (not a full-page link)", async () => {
    fetchMock.mockReturnValueOnce(
      okResponse({ processed: 1, skipped: false, closedCaseIds: ["case-abc-123"] }),
    );
    const onOpenCase = vi.fn();
    renderInactive({ onOpenCase });

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    const badge = await screen.findByTestId("sweep-result-case-id-case-abc-123");
    expect(badge.tagName).toBe("BUTTON");
    expect(badge.getAttribute("href")).toBeNull();

    fireEvent.click(badge);
    expect(onOpenCase).toHaveBeenCalledTimes(1);
    expect(onOpenCase).toHaveBeenCalledWith("case-abc-123");
  });

  it("(sweep-case-id-no-handler) clicking a closed case-id badge without onOpenCase does not throw", async () => {
    fetchMock.mockReturnValueOnce(
      okResponse({ processed: 1, skipped: false, closedCaseIds: ["case-abc-456"] }),
    );
    renderInactive();

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    const badge = await screen.findByTestId("sweep-result-case-id-case-abc-456");
    expect(() => fireEvent.click(badge)).not.toThrow();
  });
});

describe("AdminPortalWarningPanel — sweep result panel reused across multiple cases", () => {
  it("(sweep-panel-closed-ids) renders the result panel with both closed case ID links after a sweep that closes cases", async () => {
    fetchMock.mockReturnValueOnce(
      okResponse({ processed: 2, skipped: false, closedCaseIds: [42, 99] }),
    );
    renderInactive();

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    const panel = await screen.findByTestId("sweep-result-panel");
    expect(panel).toBeTruthy();
    expect(screen.getByTestId("sweep-result-case-id-42").textContent).toBe("#42");
    expect(screen.getByTestId("sweep-result-case-id-99").textContent).toBe("#99");
    // Case-id badges are in-app navigation buttons (not anchors) — clicking
    // them calls onOpenCase rather than performing a full-page navigation.
    expect(screen.getByTestId("sweep-result-case-id-42").tagName).toBe("BUTTON");
    expect(screen.getByTestId("sweep-result-case-id-99").tagName).toBe("BUTTON");
    expect(screen.getByTestId("sweep-result-case-id-42").getAttribute("href")).toBeNull();
    expect(screen.getByTestId("sweep-result-case-id-99").getAttribute("href")).toBeNull();
  });

  it("(sweep-panel-no-expired) shows the 'no expired warnings' message when the sweep closes nothing", async () => {
    fetchMock.mockReturnValueOnce(
      okResponse({ processed: 0, skipped: false, closedCaseIds: [] }),
    );
    renderInactive();

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    const panel = await screen.findByTestId("sweep-result-panel");
    expect(panel.textContent).toMatch(/No expired warnings/i);
    expect(screen.queryByTestId("sweep-result-case-ids")).toBeNull();
  });

  it("(sweep-panel-cleared-inflight) clears the result panel when 'Run now' is clicked again while a new sweep is in-flight", async () => {
    fetchMock.mockReturnValueOnce(
      okResponse({ processed: 2, skipped: false, closedCaseIds: [42, 99] }),
    );
    renderInactive();

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));
    await screen.findByTestId("sweep-result-panel");

    let resolveSecond!: (v: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((r) => { resolveSecond = r; }),
    );

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    await waitFor(() =>
      expect(screen.queryByTestId("sweep-result-panel")).toBeNull(),
    );

    resolveSecond(
      new Response(
        JSON.stringify({ processed: 0, skipped: false, closedCaseIds: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await screen.findByTestId("sweep-result-panel");
  });

  it("(sweep-panel-reused-across-cases) renders correctly when the panel is remounted for a different case", async () => {
    fetchMock.mockReturnValueOnce(
      okResponse({ processed: 1, skipped: false, closedCaseIds: [7] }),
    );
    const { unmount } = renderInactive({ caseId: "case-A" });

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));
    await screen.findByTestId("sweep-result-panel");
    expect(screen.getByTestId("sweep-result-case-id-7")).toBeTruthy();

    unmount();

    fetchMock.mockReturnValueOnce(
      okResponse({ processed: 0, skipped: false, closedCaseIds: [] }),
    );
    renderInactive({ caseId: "case-B" });

    // Fresh mount for a different case must not carry over the previous
    // case's sweep result.
    expect(screen.queryByTestId("sweep-result-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));
    const panel = await screen.findByTestId("sweep-result-panel");
    expect(panel.textContent).toMatch(/No expired warnings/i);
    expect(screen.queryByTestId("sweep-result-case-id-7")).toBeNull();
  });
});

describe("AdminPortalWarningPanel — run expiry sweep (active state)", () => {
  it("(sweep-call-active) clicking the button calls POST /api/admin/portal-warning-expiry-sweep/run with auth header", async () => {
    fetchMock.mockReturnValueOnce(okResponse({ processed: 0, skipped: false }));
    renderActive();

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/portal-warning-expiry-sweep/run");
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${AUTH_TOKEN}`,
    );
  });

  it("(sweep-success-processed-active) shows 'Sweep complete' toast with case count and calls onChanged", async () => {
    fetchMock.mockReturnValueOnce(okResponse({ processed: 3, skipped: false }));
    const onChanged = vi.fn();
    renderActive({ onChanged });

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const t = toasts[0];
    expect(t.title).toBe("Sweep complete");
    expect(t.description).toMatch(/3 cases? force-disabled/);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("(sweep-success-zero-active) shows 'No expired warnings found.' when processed = 0", async () => {
    fetchMock.mockReturnValueOnce(okResponse({ processed: 0, skipped: false }));
    const onChanged = vi.fn();
    renderActive({ onChanged });

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const t = toasts[0];
    expect(t.title).toBe("Sweep complete");
    expect(t.description).toBe("No expired warnings found.");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("(sweep-skipped-active) shows 'Sweep skipped' toast when skipped = true", async () => {
    fetchMock.mockReturnValueOnce(okResponse({ processed: 0, skipped: true }));
    const onChanged = vi.fn();
    renderActive({ onChanged });

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const t = toasts[0];
    expect(t.title).toBe("Sweep skipped");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("(sweep-error-active) failed sweep shows destructive toast and does NOT call onChanged", async () => {
    fetchMock.mockReturnValueOnce(errResponse({ error: "DB timeout" }, 500));
    const onChanged = vi.fn();
    renderActive({ onChanged });

    fireEvent.click(screen.getByTestId("button-run-expiry-sweep"));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const errorToast = toasts.find((t) => t.variant === "destructive");
    expect(errorToast).toBeTruthy();
    expect(errorToast.title).toBe("Sweep failed");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("(sweep-loading-active) sweep button is disabled while the request is in-flight", async () => {
    let resolve!: (v: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    renderActive();

    const btn = screen.getByTestId("button-run-expiry-sweep") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));

    resolve(new Response(JSON.stringify({ processed: 0, skipped: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await waitFor(() => expect(btn.disabled).toBe(false));
  });
});
