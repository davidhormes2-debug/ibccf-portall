// @vitest-environment jsdom
//
// Task #837 — Tests for the on-demand community thread-view tracking cleanup
// admin control.
//
// The handler `runCommunityThreadViewsCleanup` lives inline in AdminDashboard.tsx
// and the card that drives it is a non-exported component inside SettingsTab.tsx.
// Coverage comes in three layers:
//
//   1. A self-contained functional harness that replicates the handler's branch
//      logic (deleted>0, deleted===0, skipped, HTTP error) so we can assert the
//      per-branch toast feedback, bearer-auth header wiring, running-state toggle,
//      and persisted last-run result.
//   2. A context-wired component test that renders the card UI through a real
//      AdminDashboardContext.Provider (via buildMockAdminDashboardContext), so
//      broken context bindings (wrong field name, missing prop) fail here.
//   3. Static source assertions that tie the harness to the REAL source — the
//      handler in AdminDashboard.tsx and last-run text branches in SettingsTab.tsx
//      — so the harness can't silently drift from production.

import React, { useState, useEffect } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminDashboardContext } from "@/components/admin/AdminDashboardContext";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";

// ---------------------------------------------------------------------------
// Static source under analysis
// ---------------------------------------------------------------------------

const ADMIN_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../pages/AdminDashboard.tsx"),
  "utf8",
);
const SETTINGS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../tabs/SettingsTab.tsx"),
  "utf8",
);

/**
 * Extracts a function body from its declaration string to the next
 * `\n  const ` declaration.  Returns `""` when the declaration is absent.
 */
function extractFnBody(fnDecl: string): string {
  const start = ADMIN_SRC.indexOf(fnDecl);
  if (start === -1) return "";
  const end = ADMIN_SRC.indexOf("\n  const ", start + 1);
  return end === -1 ? ADMIN_SRC.slice(start) : ADMIN_SRC.slice(start, end);
}

/**
 * Extracts a settings-card component body from its function declaration to
 * the next top-level `\nfunction ` boundary.  Returns `""` when absent.
 */
function extractSettingsCard(fnDecl: string): string {
  const start = SETTINGS_SRC.indexOf(fnDecl);
  if (start === -1) return "";
  const end = SETTINGS_SRC.indexOf("\nfunction ", start + 1);
  return end === -1 ? SETTINGS_SRC.slice(start) : SETTINGS_SRC.slice(start, end);
}

// ---------------------------------------------------------------------------
// Functional harness — replicates runCommunityThreadViewsCleanup
// ---------------------------------------------------------------------------

interface RunResult {
  deleted: number;
  skipped: boolean;
}

interface ToastCall {
  variant?: string;
  title: string;
  description: string;
}

interface HarnessProps {
  authToken: string | null;
  onFetch: (url: string, opts: RequestInit) => Promise<Response>;
  onToast: (t: ToastCall) => void;
  onLoadCount?: () => void;
}

function CleanupHarness({ authToken, onFetch, onToast, onLoadCount }: HarnessProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);

  const run = async () => {
    setIsRunning(true);
    try {
      const res = await onFetch(
        "/api/admin/community-thread-views-cleanup/run",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || "Failed to run cleanup");
      }
      const result = data as RunResult;
      setLastRun(result);
      onToast({
        title: result.skipped
          ? "Cleanup already running"
          : result.deleted > 0
            ? "Cleanup complete"
            : "Nothing to clean up",
        description: result.skipped
          ? "A sweep was already in progress — try again in a moment."
          : result.deleted > 0
            ? `Removed ${result.deleted} stale thread-view row(s).`
            : "No stale thread-view rows found.",
      });
      if (!result.skipped) {
        onLoadCount?.();
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to run cleanup";
      onToast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => run()}
        disabled={isRunning}
        data-testid="button-community-thread-views-cleanup-run"
      >
        {isRunning ? "Running…" : "Run cleanup now"}
      </button>
      {lastRun && (
        <p data-testid="text-community-thread-views-cleanup-last-run">
          {lastRun.skipped
            ? "Last manual run was skipped — a sweep was already in progress."
            : lastRun.deleted > 0
              ? `Last manual run removed ${lastRun.deleted} stale thread-view row(s).`
              : "Last manual run found no stale thread-view rows."}
        </p>
      )}
    </div>
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Functional harness tests
// ---------------------------------------------------------------------------

describe("runCommunityThreadViewsCleanup harness — branches", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends the POST with the admin bearer token", async () => {
    const user = userEvent.setup();
    const captured: Array<{ url: string; opts: RequestInit }> = [];
    const onFetch = vi.fn(async (url: string, opts: RequestInit) => {
      captured.push({ url, opts });
      return jsonResponse({ deleted: 0, skipped: false });
    });

    render(
      <CleanupHarness authToken="abc123" onFetch={onFetch} onToast={vi.fn()} />,
    );
    await user.click(
      screen.getByTestId("button-community-thread-views-cleanup-run"),
    );

    await waitFor(() => expect(onFetch).toHaveBeenCalledTimes(1));
    expect(captured[0].url).toBe(
      "/api/admin/community-thread-views-cleanup/run",
    );
    expect(captured[0].opts.method).toBe("POST");
    expect(
      (captured[0].opts.headers as Record<string, string>).Authorization,
    ).toBe("Bearer abc123");
  });

  it("deleted>0 → 'Cleanup complete' toast and last-run shows the removed count", async () => {
    const user = userEvent.setup();
    const toasts: ToastCall[] = [];
    const onFetch = vi.fn(async () =>
      jsonResponse({ deleted: 7, skipped: false }),
    );

    render(
      <CleanupHarness
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-thread-views-cleanup-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].title).toBe("Cleanup complete");
    expect(toasts[0].description).toBe("Removed 7 stale thread-view row(s).");
    expect(toasts[0].variant).toBeUndefined();

    expect(
      screen.getByTestId("text-community-thread-views-cleanup-last-run")
        .textContent,
    ).toBe("Last manual run removed 7 stale thread-view row(s).");
  });

  it("deleted===0 → 'Nothing to clean up' toast and no-op last-run text", async () => {
    const user = userEvent.setup();
    const toasts: ToastCall[] = [];
    const onFetch = vi.fn(async () =>
      jsonResponse({ deleted: 0, skipped: false }),
    );

    render(
      <CleanupHarness
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-thread-views-cleanup-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].title).toBe("Nothing to clean up");
    expect(toasts[0].description).toBe("No stale thread-view rows found.");
    expect(toasts[0].variant).toBeUndefined();

    expect(
      screen.getByTestId("text-community-thread-views-cleanup-last-run")
        .textContent,
    ).toBe("Last manual run found no stale thread-view rows.");
  });

  it("skipped → 'Cleanup already running' toast and skipped last-run text", async () => {
    const user = userEvent.setup();
    const toasts: ToastCall[] = [];
    const onFetch = vi.fn(async () =>
      jsonResponse({ deleted: 0, skipped: true }),
    );

    render(
      <CleanupHarness
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-thread-views-cleanup-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].title).toBe("Cleanup already running");
    expect(toasts[0].description).toBe(
      "A sweep was already in progress — try again in a moment.",
    );

    expect(
      screen.getByTestId("text-community-thread-views-cleanup-last-run")
        .textContent,
    ).toBe("Last manual run was skipped — a sweep was already in progress.");
  });

  it("HTTP error → destructive 'Error' toast carrying the server message, no last-run text", async () => {
    const user = userEvent.setup();
    const toasts: ToastCall[] = [];
    const onFetch = vi.fn(async () =>
      jsonResponse({ error: "boom from server" }, 500),
    );

    render(
      <CleanupHarness
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-thread-views-cleanup-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].variant).toBe("destructive");
    expect(toasts[0].title).toBe("Error");
    expect(toasts[0].description).toBe("boom from server");

    expect(
      screen.queryByTestId("text-community-thread-views-cleanup-last-run"),
    ).toBeNull();
  });

  it("calls onLoadCount after a successful non-skipped run (deleted > 0)", async () => {
    const user = userEvent.setup();
    const onLoadCount = vi.fn();
    const onFetch = vi.fn(async () =>
      jsonResponse({ deleted: 5, skipped: false }),
    );

    render(
      <CleanupHarness
        authToken="t"
        onFetch={onFetch}
        onToast={vi.fn()}
        onLoadCount={onLoadCount}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-thread-views-cleanup-run"),
    );

    await waitFor(() => expect(onLoadCount).toHaveBeenCalledTimes(1));
  });

  it("calls onLoadCount after a successful no-op run (deleted === 0, not skipped)", async () => {
    const user = userEvent.setup();
    const onLoadCount = vi.fn();
    const onFetch = vi.fn(async () =>
      jsonResponse({ deleted: 0, skipped: false }),
    );

    render(
      <CleanupHarness
        authToken="t"
        onFetch={onFetch}
        onToast={vi.fn()}
        onLoadCount={onLoadCount}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-thread-views-cleanup-run"),
    );

    await waitFor(() => expect(onLoadCount).toHaveBeenCalledTimes(1));
  });

  it("does NOT call onLoadCount when the run is skipped", async () => {
    const user = userEvent.setup();
    const onLoadCount = vi.fn();
    const onFetch = vi.fn(async () =>
      jsonResponse({ deleted: 0, skipped: true }),
    );

    render(
      <CleanupHarness
        authToken="t"
        onFetch={onFetch}
        onToast={vi.fn()}
        onLoadCount={onLoadCount}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-thread-views-cleanup-run"),
    );

    // Wait for the fetch to complete (button re-enables in finally block)
    await waitFor(() => expect(onFetch).toHaveBeenCalledTimes(1));
    const btn = screen.getByTestId(
      "button-community-thread-views-cleanup-run",
    ) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(onLoadCount).not.toHaveBeenCalled();
  });

  it("does NOT call onLoadCount when the request returns an HTTP error", async () => {
    const user = userEvent.setup();
    const onLoadCount = vi.fn();
    const onFetch = vi.fn(async () =>
      jsonResponse({ error: "server boom" }, 500),
    );

    render(
      <CleanupHarness
        authToken="t"
        onFetch={onFetch}
        onToast={vi.fn()}
        onLoadCount={onLoadCount}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-thread-views-cleanup-run"),
    );

    await waitFor(() => expect(onFetch).toHaveBeenCalledTimes(1));
    expect(onLoadCount).not.toHaveBeenCalled();
  });

  it("disables the button while the request is in flight and re-enables it after", async () => {
    const user = userEvent.setup();
    let resolveReq!: (r: Response) => void;
    const pending = new Promise<Response>((r) => (resolveReq = r));
    const onFetch = vi.fn(() => pending);

    render(
      <CleanupHarness authToken="t" onFetch={onFetch} onToast={vi.fn()} />,
    );
    const btn = screen.getByTestId(
      "button-community-thread-views-cleanup-run",
    ) as HTMLButtonElement;

    await user.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(btn.textContent).toBe("Running…");

    resolveReq(jsonResponse({ deleted: 0, skipped: false }));

    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(btn.textContent).toBe("Run cleanup now");
  });
});

// ---------------------------------------------------------------------------
// Context-wired card component tests
//
// A minimal ContextCard component consumes the three fields from
// AdminDashboardContext exactly as CommunityThreadViewsCleanupCard does, then
// renders them with the production data-testids. Wrapping it in a real
// AdminDashboardContext.Provider (via buildMockAdminDashboardContext) verifies
// that the context bindings are correct — a misnamed field or missing provider
// would cause useAdminDashboard() to throw, failing these tests immediately.
// ---------------------------------------------------------------------------

import { useAdminDashboard } from "@/components/admin/AdminDashboardContext";

/** Mirrors the context consumption and JSX of CommunityThreadViewsCleanupCard */
function ContextCard() {
  const {
    isCommunityThreadViewsCleanupRunning,
    lastCommunityThreadViewsCleanupRun,
    runCommunityThreadViewsCleanup,
  } = useAdminDashboard();

  return (
    <div>
      <button
        onClick={() => runCommunityThreadViewsCleanup()}
        disabled={isCommunityThreadViewsCleanupRunning}
        data-testid="button-community-thread-views-cleanup-run"
      >
        {isCommunityThreadViewsCleanupRunning ? "Running…" : "Run cleanup now"}
      </button>
      {lastCommunityThreadViewsCleanupRun && (
        <p data-testid="text-community-thread-views-cleanup-last-run">
          {lastCommunityThreadViewsCleanupRun.skipped
            ? "Last manual run was skipped — a sweep was already in progress."
            : lastCommunityThreadViewsCleanupRun.deleted > 0
              ? `Last manual run removed ${lastCommunityThreadViewsCleanupRun.deleted} stale thread-view row(s).`
              : "Last manual run found no stale thread-view rows."}
        </p>
      )}
    </div>
  );
}

function renderWithContext(
  overrides: Parameters<typeof buildMockAdminDashboardContext>[0] = {},
) {
  const ctx = buildMockAdminDashboardContext(overrides);
  return {
    ctx,
    ...render(
      <AdminDashboardContext.Provider value={ctx}>
        <ContextCard />
      </AdminDashboardContext.Provider>,
    ),
  };
}

describe("CommunityThreadViewsCleanupCard — context-wired", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("button is enabled and shows 'Run cleanup now' by default", () => {
    renderWithContext({ isCommunityThreadViewsCleanupRunning: false });
    const btn = screen.getByTestId(
      "button-community-thread-views-cleanup-run",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Run cleanup now");
  });

  it("button is disabled and shows 'Running…' when isCommunityThreadViewsCleanupRunning is true", () => {
    renderWithContext({ isCommunityThreadViewsCleanupRunning: true });
    const btn = screen.getByTestId(
      "button-community-thread-views-cleanup-run",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Running…");
  });

  it("clicking the button calls runCommunityThreadViewsCleanup from context", async () => {
    const user = userEvent.setup();
    const runFn = vi.fn();
    renderWithContext({
      isCommunityThreadViewsCleanupRunning: false,
      runCommunityThreadViewsCleanup: runFn,
    });
    await user.click(
      screen.getByTestId("button-community-thread-views-cleanup-run"),
    );
    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it("last-run text is absent when lastCommunityThreadViewsCleanupRun is null", () => {
    renderWithContext({ lastCommunityThreadViewsCleanupRun: null });
    expect(
      screen.queryByTestId("text-community-thread-views-cleanup-last-run"),
    ).toBeNull();
  });

  it("last-run text shows skipped branch when skipped is true", () => {
    renderWithContext({
      lastCommunityThreadViewsCleanupRun: {
        skipped: true,
        deleted: 0,
        cutoff: "",
      },
    });
    expect(
      screen.getByTestId("text-community-thread-views-cleanup-last-run")
        .textContent,
    ).toBe("Last manual run was skipped — a sweep was already in progress.");
  });

  it("last-run text shows deleted count when deleted > 0", () => {
    renderWithContext({
      lastCommunityThreadViewsCleanupRun: {
        skipped: false,
        deleted: 3,
        cutoff: "",
      },
    });
    expect(
      screen.getByTestId("text-community-thread-views-cleanup-last-run")
        .textContent,
    ).toBe("Last manual run removed 3 stale thread-view row(s).");
  });

  it("last-run text shows no-op message when deleted === 0 and not skipped", () => {
    renderWithContext({
      lastCommunityThreadViewsCleanupRun: {
        skipped: false,
        deleted: 0,
        cutoff: "",
      },
    });
    expect(
      screen.getByTestId("text-community-thread-views-cleanup-last-run")
        .textContent,
    ).toBe("Last manual run found no stale thread-view rows.");
  });
});

// ---------------------------------------------------------------------------
// Static source assertions — handler in AdminDashboard.tsx
// ---------------------------------------------------------------------------

describe("AdminDashboard.tsx — runCommunityThreadViewsCleanup source", () => {
  const body = extractFnBody("const runCommunityThreadViewsCleanup = async");

  it("defines the handler", () => {
    expect(body).not.toBe("");
  });

  it("POSTs to the cleanup endpoint with the admin bearer token", () => {
    expect(body).toContain(
      "'/api/admin/community-thread-views-cleanup/run'",
    );
    expect(body).toContain("method: 'POST'");
    expect(body).toContain("'Authorization': `Bearer ${authToken}`");
  });

  it("throws on a non-ok response so the catch branch shows the destructive toast", () => {
    expect(body).toContain("if (!res.ok)");
    expect(body).toContain("variant: 'destructive'");
    expect(body).toContain("title: 'Error'");
  });

  it("branches the success toast on skipped / deleted>0 / no-op", () => {
    expect(body).toContain("'Cleanup already running'");
    expect(body).toContain("'Cleanup complete'");
    expect(body).toContain("'Nothing to clean up'");
  });

  it("persists the result via setLastCommunityThreadViewsCleanupRun", () => {
    expect(body).toContain("setLastCommunityThreadViewsCleanupRun(result)");
  });

  it("toggles the running flag and always clears it in finally", () => {
    expect(body).toContain("setIsCommunityThreadViewsCleanupRunning(true)");
    expect(body).toContain("} finally {");
    expect(body).toContain("setIsCommunityThreadViewsCleanupRunning(false)");
  });

  it("calls loadCommunityThreadViewsStaleCount only when !result.skipped", () => {
    expect(body).toContain("if (!result.skipped)");
    expect(body).toContain("loadCommunityThreadViewsStaleCount()");
  });
});

// ---------------------------------------------------------------------------
// Static source assertions — card last-run text in SettingsTab.tsx
// ---------------------------------------------------------------------------

describe("SettingsTab.tsx — CommunityThreadViewsCleanupCard source", () => {
  const card = extractSettingsCard("function CommunityThreadViewsCleanupCard(");

  it("defines the card component", () => {
    expect(card).not.toBe("");
  });

  it("renders the run button and last-run text with the expected data-testids", () => {
    expect(card).toContain(
      'data-testid="button-community-thread-views-cleanup-run"',
    );
    expect(card).toContain(
      'data-testid="text-community-thread-views-cleanup-last-run"',
    );
  });

  it("disables the button and shows 'Running…' while a sweep is in flight", () => {
    expect(card).toContain("disabled={isCommunityThreadViewsCleanupRunning}");
    expect(card).toContain('"Running…"');
    expect(card).toContain('"Run cleanup now"');
    expect(card).toContain("runCommunityThreadViewsCleanup()");
  });

  it("renders all three last-run text branches (skipped / removed / no-op)", () => {
    expect(card).toContain(
      "Last manual run was skipped — a sweep was already in progress.",
    );
    expect(card).toContain("Last manual run removed ");
    expect(card).toContain("Last manual run found no stale thread-view rows.");
  });

  it("only renders the last-run line once a result exists", () => {
    expect(card).toContain("{lastCommunityThreadViewsCleanupRun && (");
  });

  it("sets up a periodic refresh interval while mounted", () => {
    expect(card).toContain("setInterval(");
    expect(card).toContain("clearInterval(");
    expect(card).toContain("60_000");
  });

  it("pauses the interval while a sweep is in flight", () => {
    expect(card).toContain("if (isCommunityThreadViewsCleanupRunning) return;");
  });

  it("interval cleanup function calls clearInterval(id) — catches removal or rename of the return", () => {
    expect(card).toContain("return () => clearInterval(id);");
  });

  it("interval effect dependency array is [isCommunityThreadViewsCleanupRunning]", () => {
    expect(card).toContain("}, [isCommunityThreadViewsCleanupRunning]);");
  });

  it("calls loadCommunityThreadViewsStaleCount() inside a useEffect with an empty dependency array on mount", () => {
    const mountEffectIdx = card.indexOf("loadCommunityThreadViewsStaleCount()");
    expect(mountEffectIdx).toBeGreaterThan(-1);
    const surroundingSlice = card.slice(
      Math.max(0, mountEffectIdx - 120),
      mountEffectIdx + 130,
    );
    expect(surroundingSlice).toContain("useEffect(");
    expect(surroundingSlice).toContain("}, []);");
  });
});

// ---------------------------------------------------------------------------
// Interval-timing tests — periodic stale-count refresh every 60 s
//
// A minimal IntervalHarness mirrors the interval useEffect from
// CommunityThreadViewsCleanupCard verbatim. Using vi.useFakeTimers() lets us
// advance time without real waits and verify both the "fires" path (cleanup not
// running) and the "suppressed" path (cleanup running → interval never set).
// ---------------------------------------------------------------------------

/** Mirrors the interval useEffect inside CommunityThreadViewsCleanupCard */
function IntervalHarness() {
  const {
    isCommunityThreadViewsCleanupRunning,
    loadCommunityThreadViewsStaleCount,
  } = useAdminDashboard();

  useEffect(() => {
    if (isCommunityThreadViewsCleanupRunning) return;
    const id = setInterval(() => {
      loadCommunityThreadViewsStaleCount();
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCommunityThreadViewsCleanupRunning]);

  return null;
}

describe("CommunityThreadViewsCleanupCard — periodic stale-count refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("calls loadCommunityThreadViewsStaleCount after 60 s when cleanup is not running", () => {
    const loadStaleCount = vi.fn();
    const ctx = buildMockAdminDashboardContext({
      isCommunityThreadViewsCleanupRunning: false,
      loadCommunityThreadViewsStaleCount: loadStaleCount,
    });

    render(
      <AdminDashboardContext.Provider value={ctx}>
        <IntervalHarness />
      </AdminDashboardContext.Provider>,
    );

    const callsBefore = loadStaleCount.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(loadStaleCount.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("does NOT call loadCommunityThreadViewsStaleCount after 60 s when isCommunityThreadViewsCleanupRunning is true", () => {
    const loadStaleCount = vi.fn();
    const ctx = buildMockAdminDashboardContext({
      isCommunityThreadViewsCleanupRunning: true,
      loadCommunityThreadViewsStaleCount: loadStaleCount,
    });

    render(
      <AdminDashboardContext.Provider value={ctx}>
        <IntervalHarness />
      </AdminDashboardContext.Provider>,
    );

    const callsBefore = loadStaleCount.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(loadStaleCount.mock.calls.length).toBe(callsBefore);
  });
});
