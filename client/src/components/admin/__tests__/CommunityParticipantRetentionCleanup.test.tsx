// @vitest-environment jsdom
//
// Tests for the on-demand community participant retention cleanup admin control.
//
// The handler `runCommunityParticipantRetention` lives inline in
// AdminDashboard.tsx and the card that drives it is a non-exported component
// inside the ~5.5k-line SettingsTab.tsx.  Coverage comes in three layers:
//
//   1. A self-contained functional harness that replicates the handler's
//      branch logic (removed>0, skipped, HTTP error) so we can assert the
//      per-branch toast feedback, the bearer-auth header wiring, the
//      running-state toggle, and the persisted last-run result.
//   2. A context-wired component test that renders the last-run text through a
//      real AdminDashboardContext.Provider (via buildMockAdminDashboardContext),
//      so a misnamed context field fails here rather than silently at runtime.
//   3. Static source assertions that tie the harness to the REAL source — the
//      handler in AdminDashboard.tsx and the last-run text branches in
//      SettingsTab.tsx — so the harness cannot silently drift from production.
//
// Note: CommunityParticipantRetentionCard has TWO last-run branches (skipped
// vs. non-skipped template) rather than three.  The non-skipped branch shows
// the removed count regardless of whether it is 0 or >0 (there is no separate
// "no-op" message), so only the skipped and non-skipped paths need assertion.

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
// Functional harness — replicates runCommunityParticipantRetention
// ---------------------------------------------------------------------------

interface RunResult {
  removed: number;
  retentionDays: number;
  cutoff: string;
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
  onLoadRetention?: () => void;
}

function RetentionHarness({ authToken, onFetch, onToast, onLoadRetention }: HarnessProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);

  const run = async () => {
    setIsRunning(true);
    try {
      const res = await onFetch(
        "/api/admin/settings/community-participant-retention/run",
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
        title: result.skipped ? "Cleanup already running" : "Cleanup complete",
        description: result.skipped
          ? "A sweep was already in progress — try again in a moment."
          : `Removed ${result.removed} participant row(s) past the ${result.retentionDays}-day window.`,
      });
      if (!result.skipped) {
        onLoadRetention?.();
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
        data-testid="button-community-participant-retention-run"
      >
        {isRunning ? "Running…" : "Run cleanup now"}
      </button>
      {lastRun && (
        <p data-testid="text-community-participant-retention-last-run">
          {lastRun.skipped
            ? "Last manual run was skipped — a sweep was already in progress."
            : `Last manual run removed ${lastRun.removed} participant row(s) past the ${lastRun.retentionDays}-day window.`}
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

describe("runCommunityParticipantRetention harness — branches", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends the POST with the admin bearer token", async () => {
    const user = userEvent.setup();
    const captured: Array<{ url: string; opts: RequestInit }> = [];
    const onFetch = vi.fn(async (url: string, opts: RequestInit) => {
      captured.push({ url, opts });
      return jsonResponse({
        removed: 0,
        retentionDays: 30,
        cutoff: "",
        skipped: false,
      });
    });

    render(
      <RetentionHarness authToken="abc123" onFetch={onFetch} onToast={vi.fn()} />,
    );
    await user.click(
      screen.getByTestId("button-community-participant-retention-run"),
    );

    await waitFor(() => expect(onFetch).toHaveBeenCalledTimes(1));
    expect(captured[0].url).toBe(
      "/api/admin/settings/community-participant-retention/run",
    );
    expect(captured[0].opts.method).toBe("POST");
    expect(
      (captured[0].opts.headers as Record<string, string>).Authorization,
    ).toBe("Bearer abc123");
  });

  it("removed>0 → 'Cleanup complete' toast and last-run shows the removed count", async () => {
    const user = userEvent.setup();
    const toasts: ToastCall[] = [];
    const onFetch = vi.fn(async () =>
      jsonResponse({
        removed: 12,
        retentionDays: 30,
        cutoff: "2025-01-01T00:00:00Z",
        skipped: false,
      }),
    );

    render(
      <RetentionHarness
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-participant-retention-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].title).toBe("Cleanup complete");
    expect(toasts[0].description).toBe(
      "Removed 12 participant row(s) past the 30-day window.",
    );
    expect(toasts[0].variant).toBeUndefined();

    expect(
      screen.getByTestId("text-community-participant-retention-last-run")
        .textContent,
    ).toBe(
      "Last manual run removed 12 participant row(s) past the 30-day window.",
    );
  });

  it("removed===0 → 'Cleanup complete' toast and last-run shows zero count", async () => {
    const user = userEvent.setup();
    const toasts: ToastCall[] = [];
    const onFetch = vi.fn(async () =>
      jsonResponse({
        removed: 0,
        retentionDays: 90,
        cutoff: "2025-01-01T00:00:00Z",
        skipped: false,
      }),
    );

    render(
      <RetentionHarness
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-participant-retention-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].title).toBe("Cleanup complete");
    expect(toasts[0].description).toBe(
      "Removed 0 participant row(s) past the 90-day window.",
    );
    expect(toasts[0].variant).toBeUndefined();

    expect(
      screen.getByTestId("text-community-participant-retention-last-run")
        .textContent,
    ).toBe(
      "Last manual run removed 0 participant row(s) past the 90-day window.",
    );
  });

  it("skipped → 'Cleanup already running' toast and skipped last-run text", async () => {
    const user = userEvent.setup();
    const toasts: ToastCall[] = [];
    const onFetch = vi.fn(async () =>
      jsonResponse({
        removed: 0,
        retentionDays: 30,
        cutoff: "",
        skipped: true,
      }),
    );

    render(
      <RetentionHarness
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-participant-retention-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].title).toBe("Cleanup already running");
    expect(toasts[0].description).toBe(
      "A sweep was already in progress — try again in a moment.",
    );

    expect(
      screen.getByTestId("text-community-participant-retention-last-run")
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
      <RetentionHarness
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-participant-retention-run"),
    );

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].variant).toBe("destructive");
    expect(toasts[0].title).toBe("Error");
    expect(toasts[0].description).toBe("boom from server");

    expect(
      screen.queryByTestId("text-community-participant-retention-last-run"),
    ).toBeNull();
  });

  it("disables the button while the request is in flight and re-enables it after", async () => {
    const user = userEvent.setup();
    let resolveReq!: (r: Response) => void;
    const pending = new Promise<Response>((r) => (resolveReq = r));
    const onFetch = vi.fn(() => pending);

    render(
      <RetentionHarness authToken="t" onFetch={onFetch} onToast={vi.fn()} />,
    );
    const btn = screen.getByTestId(
      "button-community-participant-retention-run",
    ) as HTMLButtonElement;

    await user.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(btn.textContent).toBe("Running…");

    resolveReq(
      jsonResponse({
        removed: 0,
        retentionDays: 30,
        cutoff: "",
        skipped: false,
      }),
    );

    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(btn.textContent).toBe("Run cleanup now");
  });

  it("calls onLoadRetention after a successful non-skipped run", async () => {
    const user = userEvent.setup();
    const onLoadRetention = vi.fn();
    const onFetch = vi.fn(async () =>
      jsonResponse({
        removed: 3,
        retentionDays: 30,
        cutoff: "2025-01-01T00:00:00Z",
        skipped: false,
      }),
    );

    render(
      <RetentionHarness
        authToken="t"
        onFetch={onFetch}
        onToast={vi.fn()}
        onLoadRetention={onLoadRetention}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-participant-retention-run"),
    );

    await waitFor(() => expect(onLoadRetention).toHaveBeenCalledTimes(1));
  });

  it("does NOT call onLoadRetention when the run is skipped", async () => {
    const user = userEvent.setup();
    const onLoadRetention = vi.fn();
    const onFetch = vi.fn(async () =>
      jsonResponse({
        removed: 0,
        retentionDays: 30,
        cutoff: "",
        skipped: true,
      }),
    );

    render(
      <RetentionHarness
        authToken="t"
        onFetch={onFetch}
        onToast={vi.fn()}
        onLoadRetention={onLoadRetention}
      />,
    );
    await user.click(
      screen.getByTestId("button-community-participant-retention-run"),
    );

    // Wait for the fetch to complete (button re-enables in finally block)
    await waitFor(() => expect(onFetch).toHaveBeenCalledTimes(1));
    const btn = screen.getByTestId(
      "button-community-participant-retention-run",
    ) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(onLoadRetention).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Context-wired card component tests
//
// A minimal ContextCard consumes the same context fields as
// CommunityParticipantRetentionCard's last-run section and renders them with
// the production data-testid.  Wrapping it in a real Provider verifies that
// the context bindings are correct.
// ---------------------------------------------------------------------------

function ContextCard() {
  const {
    isCommunityParticipantRetentionRunning,
    lastCommunityParticipantRetentionRun,
    runCommunityParticipantRetention,
  } = useAdminDashboard();

  return (
    <div>
      <button
        onClick={() => runCommunityParticipantRetention()}
        disabled={isCommunityParticipantRetentionRunning}
        data-testid="button-community-participant-retention-run"
      >
        {isCommunityParticipantRetentionRunning ? "Running…" : "Run cleanup now"}
      </button>
      {lastCommunityParticipantRetentionRun && (
        <p data-testid="text-community-participant-retention-last-run">
          {lastCommunityParticipantRetentionRun.skipped
            ? "Last manual run was skipped — a sweep was already in progress."
            : `Last manual run removed ${lastCommunityParticipantRetentionRun.removed} participant row(s) past the ${lastCommunityParticipantRetentionRun.retentionDays}-day window.`}
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

describe("CommunityParticipantRetentionCard — context-wired last-run text", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("last-run text is absent when lastCommunityParticipantRetentionRun is null", () => {
    renderWithContext({ lastCommunityParticipantRetentionRun: null });
    expect(
      screen.queryByTestId("text-community-participant-retention-last-run"),
    ).toBeNull();
  });

  it("last-run text shows skipped branch when skipped is true", () => {
    renderWithContext({
      lastCommunityParticipantRetentionRun: {
        skipped: true,
        removed: 0,
        retentionDays: 30,
        cutoff: "",
      },
    });
    expect(
      screen.getByTestId("text-community-participant-retention-last-run")
        .textContent,
    ).toBe("Last manual run was skipped — a sweep was already in progress.");
  });

  it("last-run text shows removed count when skipped is false and removed > 0", () => {
    renderWithContext({
      lastCommunityParticipantRetentionRun: {
        skipped: false,
        removed: 5,
        retentionDays: 60,
        cutoff: "",
      },
    });
    expect(
      screen.getByTestId("text-community-participant-retention-last-run")
        .textContent,
    ).toBe(
      "Last manual run removed 5 participant row(s) past the 60-day window.",
    );
  });

  it("last-run text shows zero removed when skipped is false and removed === 0", () => {
    renderWithContext({
      lastCommunityParticipantRetentionRun: {
        skipped: false,
        removed: 0,
        retentionDays: 30,
        cutoff: "",
      },
    });
    expect(
      screen.getByTestId("text-community-participant-retention-last-run")
        .textContent,
    ).toBe(
      "Last manual run removed 0 participant row(s) past the 30-day window.",
    );
  });

  it("button is disabled and shows 'Running…' when isCommunityParticipantRetentionRunning is true", () => {
    renderWithContext({ isCommunityParticipantRetentionRunning: true });
    const btn = screen.getByTestId(
      "button-community-participant-retention-run",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Running…");
  });

  it("button is enabled and shows 'Run cleanup now' by default", () => {
    renderWithContext({ isCommunityParticipantRetentionRunning: false });
    const btn = screen.getByTestId(
      "button-community-participant-retention-run",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Run cleanup now");
  });

  it("clicking the button calls runCommunityParticipantRetention from context", async () => {
    const user = userEvent.setup();
    const runFn = vi.fn();
    renderWithContext({
      isCommunityParticipantRetentionRunning: false,
      runCommunityParticipantRetention: runFn,
    });
    await user.click(
      screen.getByTestId("button-community-participant-retention-run"),
    );
    expect(runFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Static source assertions — handler in AdminDashboard.tsx
// ---------------------------------------------------------------------------

describe("AdminDashboard.tsx — runCommunityParticipantRetention source", () => {
  const body = extractFnBody("const runCommunityParticipantRetention = async");

  it("defines the handler", () => {
    expect(body).not.toBe("");
  });

  it("POSTs to the retention run endpoint with the admin bearer token", () => {
    expect(body).toContain(
      "'/api/admin/settings/community-participant-retention/run'",
    );
    expect(body).toContain("method: 'POST'");
    expect(body).toContain("'Authorization': `Bearer ${authToken}`");
  });

  it("throws on a non-ok response so the catch branch shows the destructive toast", () => {
    expect(body).toContain("if (!res.ok)");
    expect(body).toContain("variant: 'destructive'");
    expect(body).toContain("title: 'Error'");
  });

  it("branches the success toast on skipped / non-skipped", () => {
    expect(body).toContain("'Cleanup already running'");
    expect(body).toContain("'Cleanup complete'");
  });

  it("persists the result via setLastCommunityParticipantRetentionRun", () => {
    expect(body).toContain("setLastCommunityParticipantRetentionRun(result)");
  });

  it("toggles the running flag and always clears it in finally", () => {
    expect(body).toContain("setIsCommunityParticipantRetentionRunning(true)");
    expect(body).toContain("} finally {");
    expect(body).toContain("setIsCommunityParticipantRetentionRunning(false)");
  });

  it("calls loadCommunityParticipantRetention() only when !result.skipped", () => {
    expect(body).toContain("if (!result.skipped)");
    expect(body).toContain("loadCommunityParticipantRetention()");
  });
});

// ---------------------------------------------------------------------------
// Static source assertions — card last-run text in SettingsTab.tsx
// ---------------------------------------------------------------------------

describe("SettingsTab.tsx — CommunityParticipantRetentionCard source", () => {
  const card = extractSettingsCard("function CommunityParticipantRetentionCard(");

  it("defines the card component", () => {
    expect(card).not.toBe("");
  });

  it("renders the run button and last-run text with the expected data-testids", () => {
    expect(card).toContain(
      'data-testid="button-community-participant-retention-run"',
    );
    expect(card).toContain(
      'data-testid="text-community-participant-retention-last-run"',
    );
  });

  it("disables the button while a sweep is in flight", () => {
    expect(card).toContain("isCommunityParticipantRetentionRunning");
    expect(card).toContain('"Running…"');
    expect(card).toContain("runCommunityParticipantRetention()");
  });

  it("renders the skipped last-run text that exactly matches the harness constant", () => {
    expect(card).toContain(
      "Last manual run was skipped — a sweep was already in progress.",
    );
  });

  it("renders the non-skipped last-run text whose static parts match the template literal", () => {
    expect(card).toMatch(
      /Last manual run removed \$\{[^}]+\} participant row\(s\) past the \$\{[^}]+\}-day window\./,
    );
  });

  it("only renders the last-run line once a result exists", () => {
    expect(card).toContain("{lastCommunityParticipantRetentionRun && (");
  });
});
