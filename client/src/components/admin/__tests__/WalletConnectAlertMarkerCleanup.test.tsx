// @vitest-environment jsdom
//
// Tests for the on-demand wallet-connect alert marker cleanup admin control.
//
// The handler `runWalletConnectAlertMarkerCleanup` lives inline in
// AdminDashboard.tsx and the card that drives it is a non-exported component
// inside SettingsTab.tsx.  Coverage comes in three layers:
//
//   1. A self-contained functional harness that replicates the handler's
//      branch logic (deleted>0, deleted===0, skipped, HTTP error) so we can
//      assert the per-branch toast feedback, the bearer-auth header wiring,
//      the running-state toggle, the persisted last-run result, and the
//      count-refresh call on non-skipped runs.
//   2. A context-wired component test that renders the last-run text through a
//      real AdminDashboardContext.Provider (via buildMockAdminDashboardContext),
//      so a misnamed context field fails here rather than silently at runtime.
//   3. Static source assertions that tie that harness to the REAL source —
//      the handler in AdminDashboard.tsx and the last-run text branches in
//      SettingsTab.tsx — so the harness can't silently drift from production.

import React, { useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminDashboardContext } from "@/components/admin/AdminDashboardContext";
import { useAdminDashboard } from "@/components/admin/AdminDashboardContext";
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
// Functional harness — replicates runWalletConnectAlertMarkerCleanup
// ---------------------------------------------------------------------------

interface RunResult {
  deleted: number;
  scanned: number;
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
        "/api/admin/wallet-connect-alert-marker-cleanup/run",
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
            ? `Removed ${result.deleted} orphaned marker(s) out of ${result.scanned} scanned.`
            : `No orphaned markers found (${result.scanned} scanned).`,
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
        data-testid="button-wallet-connect-alert-marker-cleanup-run"
      >
        {isRunning ? "Running…" : "Run cleanup now"}
      </button>
      {lastRun && (
        <p data-testid="text-wallet-connect-alert-marker-cleanup-last-run">
          {lastRun.skipped
            ? "Last manual run was skipped — a sweep was already in progress."
            : lastRun.deleted > 0
              ? `Last manual run removed ${lastRun.deleted} orphaned marker(s) out of ${lastRun.scanned} scanned.`
              : `Last manual run found no orphaned markers (${lastRun.scanned} scanned).`}
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

describe("runWalletConnectAlertMarkerCleanup harness — branches", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends the POST with the admin bearer token", async () => {
    const user = userEvent.setup();
    const captured: Array<{ url: string; opts: RequestInit }> = [];
    const onFetch = vi.fn(async (url: string, opts: RequestInit) => {
      captured.push({ url, opts });
      return jsonResponse({ deleted: 0, scanned: 0, skipped: false });
    });

    render(
      <CleanupHarness authToken="abc123" onFetch={onFetch} onToast={vi.fn()} />,
    );
    await user.click(
      screen.getByTestId("button-wallet-connect-alert-marker-cleanup-run"),
    );

    await waitFor(() => expect(onFetch).toHaveBeenCalledTimes(1));
    expect(captured[0].url).toBe(
      "/api/admin/wallet-connect-alert-marker-cleanup/run",
    );
    expect(captured[0].opts.method).toBe("POST");
    expect((captured[0].opts.headers as Record<string, string>).Authorization).toBe(
      "Bearer abc123",
    );
  });

  it("deleted>0 → 'Cleanup complete' toast and last-run shows the removed count", async () => {
    const user = userEvent.setup();
    const toasts: ToastCall[] = [];
    const onFetch = vi.fn(async () =>
      jsonResponse({ deleted: 4, scanned: 9, skipped: false }),
    );

    render(
      <CleanupHarness
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );
    await user.click(
      screen.getByTestId("button-wallet-connect-alert-marker-cleanup-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].title).toBe("Cleanup complete");
    expect(toasts[0].description).toBe(
      "Removed 4 orphaned marker(s) out of 9 scanned.",
    );
    expect(toasts[0].variant).toBeUndefined();

    expect(
      screen.getByTestId(
        "text-wallet-connect-alert-marker-cleanup-last-run",
      ).textContent,
    ).toBe("Last manual run removed 4 orphaned marker(s) out of 9 scanned.");
  });

  it("deleted===0 → 'Nothing to clean up' toast and no-op last-run text", async () => {
    const user = userEvent.setup();
    const toasts: ToastCall[] = [];
    const onFetch = vi.fn(async () =>
      jsonResponse({ deleted: 0, scanned: 5, skipped: false }),
    );

    render(
      <CleanupHarness
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );
    await user.click(
      screen.getByTestId("button-wallet-connect-alert-marker-cleanup-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].title).toBe("Nothing to clean up");
    expect(toasts[0].description).toBe("No orphaned markers found (5 scanned).");
    expect(toasts[0].variant).toBeUndefined();

    expect(
      screen.getByTestId(
        "text-wallet-connect-alert-marker-cleanup-last-run",
      ).textContent,
    ).toBe("Last manual run found no orphaned markers (5 scanned).");
  });

  it("skipped → 'Cleanup already running' toast and skipped last-run text", async () => {
    const user = userEvent.setup();
    const toasts: ToastCall[] = [];
    const onFetch = vi.fn(async () =>
      jsonResponse({ deleted: 0, scanned: 0, skipped: true }),
    );

    render(
      <CleanupHarness
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );
    await user.click(
      screen.getByTestId("button-wallet-connect-alert-marker-cleanup-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].title).toBe("Cleanup already running");
    expect(toasts[0].description).toBe(
      "A sweep was already in progress — try again in a moment.",
    );

    expect(
      screen.getByTestId(
        "text-wallet-connect-alert-marker-cleanup-last-run",
      ).textContent,
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
      screen.getByTestId("button-wallet-connect-alert-marker-cleanup-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].variant).toBe("destructive");
    expect(toasts[0].title).toBe("Error");
    expect(toasts[0].description).toBe("boom from server");

    // A failed run must NOT render a stale last-run line.
    expect(
      screen.queryByTestId(
        "text-wallet-connect-alert-marker-cleanup-last-run",
      ),
    ).toBeNull();
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
      "button-wallet-connect-alert-marker-cleanup-run",
    ) as HTMLButtonElement;

    await user.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(btn.textContent).toBe("Running…");

    resolveReq(jsonResponse({ deleted: 0, scanned: 0, skipped: false }));

    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(btn.textContent).toBe("Run cleanup now");
  });

  it("calls onLoadCount after a successful non-skipped run", async () => {
    const user = userEvent.setup();
    const onLoadCount = vi.fn();
    const onFetch = vi.fn(async () =>
      jsonResponse({ deleted: 3, scanned: 10, skipped: false }),
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
      screen.getByTestId("button-wallet-connect-alert-marker-cleanup-run"),
    );

    await waitFor(() => expect(onLoadCount).toHaveBeenCalledTimes(1));
  });

  it("does NOT call onLoadCount when the run is skipped", async () => {
    const user = userEvent.setup();
    const onLoadCount = vi.fn();
    const onFetch = vi.fn(async () =>
      jsonResponse({ deleted: 0, scanned: 0, skipped: true }),
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
      screen.getByTestId("button-wallet-connect-alert-marker-cleanup-run"),
    );

    // Wait for the fetch to complete (button re-enables in finally block)
    await waitFor(() => expect(onFetch).toHaveBeenCalledTimes(1));
    const btn = screen.getByTestId(
      "button-wallet-connect-alert-marker-cleanup-run",
    ) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(onLoadCount).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Context-wired card component tests
//
// A minimal ContextCard consumes the same context fields as
// WalletConnectAlertMarkerCleanupCard's last-run section and renders them with
// the production data-testid.  Wrapping it in a real Provider verifies that
// the context bindings are correct.
// ---------------------------------------------------------------------------

function ContextCard() {
  const {
    isWalletConnectAlertMarkerCleanupRunning,
    lastWalletConnectAlertMarkerCleanupRun,
    runWalletConnectAlertMarkerCleanup,
  } = useAdminDashboard();

  return (
    <div>
      <button
        onClick={() => runWalletConnectAlertMarkerCleanup()}
        disabled={isWalletConnectAlertMarkerCleanupRunning}
        data-testid="button-wallet-connect-alert-marker-cleanup-run"
      >
        {isWalletConnectAlertMarkerCleanupRunning ? "Running…" : "Run cleanup now"}
      </button>
      {lastWalletConnectAlertMarkerCleanupRun && (
        <p data-testid="text-wallet-connect-alert-marker-cleanup-last-run">
          {lastWalletConnectAlertMarkerCleanupRun.skipped
            ? "Last manual run was skipped — a sweep was already in progress."
            : lastWalletConnectAlertMarkerCleanupRun.deleted > 0
              ? `Last manual run removed ${lastWalletConnectAlertMarkerCleanupRun.deleted} orphaned marker(s) out of ${lastWalletConnectAlertMarkerCleanupRun.scanned} scanned.`
              : `Last manual run found no orphaned markers (${lastWalletConnectAlertMarkerCleanupRun.scanned} scanned).`}
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

describe("WalletConnectAlertMarkerCleanupCard — context-wired last-run text", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("last-run text is absent when lastWalletConnectAlertMarkerCleanupRun is null", () => {
    renderWithContext({ lastWalletConnectAlertMarkerCleanupRun: null });
    expect(
      screen.queryByTestId("text-wallet-connect-alert-marker-cleanup-last-run"),
    ).toBeNull();
  });

  it("last-run text shows skipped branch when skipped is true", () => {
    renderWithContext({
      lastWalletConnectAlertMarkerCleanupRun: {
        skipped: true,
        deleted: 0,
        scanned: 0,
      },
    });
    expect(
      screen.getByTestId("text-wallet-connect-alert-marker-cleanup-last-run")
        .textContent,
    ).toBe("Last manual run was skipped — a sweep was already in progress.");
  });

  it("last-run text shows deleted count when skipped is false and deleted > 0", () => {
    renderWithContext({
      lastWalletConnectAlertMarkerCleanupRun: {
        skipped: false,
        deleted: 4,
        scanned: 30,
      },
    });
    expect(
      screen.getByTestId("text-wallet-connect-alert-marker-cleanup-last-run")
        .textContent,
    ).toBe("Last manual run removed 4 orphaned marker(s) out of 30 scanned.");
  });

  it("last-run text shows zero-deleted branch when skipped is false and deleted === 0", () => {
    renderWithContext({
      lastWalletConnectAlertMarkerCleanupRun: {
        skipped: false,
        deleted: 0,
        scanned: 15,
      },
    });
    expect(
      screen.getByTestId("text-wallet-connect-alert-marker-cleanup-last-run")
        .textContent,
    ).toBe("Last manual run found no orphaned markers (15 scanned).");
  });

  it("button is disabled and shows 'Running…' when isWalletConnectAlertMarkerCleanupRunning is true", () => {
    renderWithContext({ isWalletConnectAlertMarkerCleanupRunning: true });
    const btn = screen.getByTestId(
      "button-wallet-connect-alert-marker-cleanup-run",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Running…");
  });

  it("button is enabled and shows 'Run cleanup now' by default", () => {
    renderWithContext({ isWalletConnectAlertMarkerCleanupRunning: false });
    const btn = screen.getByTestId(
      "button-wallet-connect-alert-marker-cleanup-run",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Run cleanup now");
  });

  it("clicking the button calls runWalletConnectAlertMarkerCleanup from context", async () => {
    const user = userEvent.setup();
    const runFn = vi.fn();
    renderWithContext({
      isWalletConnectAlertMarkerCleanupRunning: false,
      runWalletConnectAlertMarkerCleanup: runFn,
    });
    await user.click(
      screen.getByTestId("button-wallet-connect-alert-marker-cleanup-run"),
    );
    expect(runFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Static source assertions — handler in AdminDashboard.tsx
// ---------------------------------------------------------------------------

describe("AdminDashboard.tsx — runWalletConnectAlertMarkerCleanup source", () => {
  const body = extractFnBody("const runWalletConnectAlertMarkerCleanup = async");

  it("defines the handler", () => {
    expect(body).not.toBe("");
  });

  it("POSTs to the cleanup endpoint with the admin bearer token", () => {
    expect(body).toContain(
      "'/api/admin/wallet-connect-alert-marker-cleanup/run'",
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

  it("persists the result via setLastWalletConnectAlertMarkerCleanupRun", () => {
    expect(body).toContain("setLastWalletConnectAlertMarkerCleanupRun(result)");
  });

  it("toggles the running flag and always clears it in finally", () => {
    expect(body).toContain("setIsWalletConnectAlertMarkerCleanupRunning(true)");
    expect(body).toContain("} finally {");
    expect(body).toContain(
      "setIsWalletConnectAlertMarkerCleanupRunning(false)",
    );
  });

  it("calls loadWalletConnectAlertMarkerCount() only when !result.skipped", () => {
    expect(body).toContain("if (!result.skipped)");
    expect(body).toContain("loadWalletConnectAlertMarkerCount()");
  });
});

// ---------------------------------------------------------------------------
// Static source assertions — card last-run text in SettingsTab.tsx
// ---------------------------------------------------------------------------

describe("SettingsTab.tsx — WalletConnectAlertMarkerCleanupCard source", () => {
  const card = extractSettingsCard("function WalletConnectAlertMarkerCleanupCard(");

  it("defines the card component", () => {
    expect(card).not.toBe("");
  });

  it("renders the run button and last-run text with the expected data-testids", () => {
    expect(card).toContain(
      'data-testid="button-wallet-connect-alert-marker-cleanup-run"',
    );
    expect(card).toContain(
      'data-testid="text-wallet-connect-alert-marker-cleanup-last-run"',
    );
  });

  it("disables the button and shows 'Running…' while a sweep is in flight", () => {
    expect(card).toContain(
      "disabled={isWalletConnectAlertMarkerCleanupRunning}",
    );
    expect(card).toContain('"Running…"');
    expect(card).toContain('"Run cleanup now"');
    expect(card).toContain("runWalletConnectAlertMarkerCleanup()");
  });

  it("renders all three last-run text branches (skipped / removed / no-op)", () => {
    expect(card).toContain(
      "Last manual run was skipped — a sweep was already in progress.",
    );
    expect(card).toContain("Last manual run removed ");
    expect(card).toContain("Last manual run found no orphaned markers");
  });

  it("only renders the last-run line once a result exists", () => {
    expect(card).toContain("{lastWalletConnectAlertMarkerCleanupRun && (");
  });
});
