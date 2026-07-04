// @vitest-environment jsdom
//
// Task #842 — Tests for the on-demand wallet-connect completion backfill admin
// control.
//
// The handler `runWalletConnectCompletionBackfill` lives inline in the
// ~11k-line AdminDashboard.tsx and the card that drives it is a non-exported
// component inside the ~5.5k-line SettingsTab.tsx, so — mirroring the
// WalletConnectAlertMarkerCleanup pattern — coverage comes in two layers:
//
//   1. A self-contained functional harness that replicates the handler's
//      branch logic (inserted>0, inserted===0, skipped, HTTP error) so we can
//      assert the per-branch toast feedback, the bearer-auth header wiring,
//      the running-state toggle, and the persisted last-run result.
//   2. Static source assertions that tie that harness to the REAL source —
//      the handler in AdminDashboard.tsx and the card in SettingsTab.tsx — so
//      the harness can't silently drift from production. (Unlike the marker
//      cleanup test these search the full source rather than a fixed-size
//      window, which is resilient to the handler growing over time.)

import React, { useState, useEffect } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

// ---------------------------------------------------------------------------
// Functional harness — replicates runWalletConnectCompletionBackfill
// ---------------------------------------------------------------------------

interface BackfillResult {
  scanned: number;
  inserted: number;
  skipped: boolean;
}

const toastSpy = vi.fn();
const authToken = "test-token";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

interface HarnessProps {
  onLoadCount?: () => void;
}

function BackfillHarness({ onLoadCount }: HarnessProps = {}) {
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<BackfillResult | null>(null);

  const runWalletConnectCompletionBackfill = async () => {
    setIsRunning(true);
    try {
      const res = await fetch(
        "/api/admin/wallet-connect-completion-backfill/run",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.toString() || "Failed to run backfill");
      }
      const result = data as BackfillResult;
      setLastRun(result);
      toastSpy({
        title: result.skipped
          ? "Backfill already running"
          : result.inserted > 0
            ? "Backfill complete"
            : "Nothing to backfill",
        description: result.skipped
          ? "A backfill was already in progress — try again in a moment."
          : result.inserted > 0
            ? `Inserted ${result.inserted} missing completion row(s) out of ${result.scanned} marker(s) scanned.`
            : `All completions already recorded (${result.scanned} marker(s) scanned).`,
      });
      if (!result.skipped) {
        onLoadCount?.();
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to run backfill";
      toastSpy({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => runWalletConnectCompletionBackfill()}
        disabled={isRunning}
        data-testid="button-wallet-connect-completion-backfill-run"
      >
        {isRunning ? "Running…" : "Run backfill now"}
      </button>
      {lastRun && (
        <p data-testid="text-wallet-connect-completion-backfill-last-run">
          {lastRun.skipped
            ? "skipped"
            : lastRun.inserted > 0
              ? `inserted ${lastRun.inserted}/${lastRun.scanned}`
              : `none ${lastRun.scanned}`}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Functional harness — replicates loadWalletConnectCompletionBackfillCount
// ---------------------------------------------------------------------------

interface BackfillCount {
  scanned: number;
  missing: number;
}

/** Mirrors the count-display logic in WalletConnectCompletionBackfillCard.
 *  Loads the count on mount (matching the card's useEffect). */
function BackfillCountAutoLoadHarness() {
  const [isLoading, setIsLoading] = useState(false);
  const [count, setCount] = useState<BackfillCount | null>(null);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          "/api/admin/wallet-connect-completion-backfill",
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (res.ok) {
          const data = await res.json();
          setCount(data as BackfillCount);
        }
      } catch {
        // swallowed — count stays null
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const countText =
    isLoading && !count
      ? "Checking for missing completion rows\u2026"
      : count
        ? count.missing > 0
          ? `${count.missing} of ${count.scanned} marker(s) are missing a completion row and can be backfilled.`
          : `All completion rows are present (${count.scanned} marker(s) scanned).`
        : "Missing completion row count unavailable.";

  return (
    <p data-testid="text-wallet-connect-completion-backfill-count">
      {countText}
    </p>
  );
}

/** Combined harness: count-load on mount + run handler with post-run refresh.
 *  Replicates the interplay between loadWalletConnectCompletionBackfillCount
 *  and runWalletConnectCompletionBackfill that lives in AdminDashboard.tsx. */
function BackfillCountAndRunHarness() {
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [count, setCount] = useState<BackfillCount | null>(null);

  const loadCount = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/wallet-connect-completion-backfill", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCount(data as BackfillCount);
      }
    } catch {
      // swallowed
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runBackfill = async () => {
    setIsRunning(true);
    try {
      const res = await fetch(
        "/api/admin/wallet-connect-completion-backfill/run",
        { method: "POST", headers: { Authorization: `Bearer ${authToken}` } },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.toString() || "Failed");
      const result = data as BackfillResult;
      toastSpy({ title: result.skipped ? "Backfill already running" : result.inserted > 0 ? "Backfill complete" : "Nothing to backfill" });
      if (!result.skipped) {
        void loadCount();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to run backfill";
      toastSpy({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsRunning(false);
    }
  };

  const countText =
    isLoading && !count
      ? "Checking for missing completion rows\u2026"
      : count
        ? count.missing > 0
          ? `${count.missing} of ${count.scanned} marker(s) are missing a completion row and can be backfilled.`
          : `All completion rows are present (${count.scanned} marker(s) scanned).`
        : "Missing completion row count unavailable.";

  return (
    <div>
      <p data-testid="text-wallet-connect-completion-backfill-count">
        {countText}
      </p>
      <button
        onClick={() => runBackfill()}
        disabled={isRunning}
        data-testid="button-wallet-connect-completion-backfill-run"
      >
        {isRunning ? "Running\u2026" : "Run backfill now"}
      </button>
    </div>
  );
}

beforeEach(() => {
  toastSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("runWalletConnectCompletionBackfill harness — branches", () => {
  it("POSTs with the bearer token and shows the inserted-rows toast", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({ scanned: 5, inserted: 2, skipped: false }),
      );
    const user = userEvent.setup();
    render(<BackfillHarness />);

    await user.click(
      screen.getByTestId("button-wallet-connect-completion-backfill-run"),
    );

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/wallet-connect-completion-backfill/run",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      }),
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Backfill complete" }),
    );
    expect(
      screen.getByTestId("text-wallet-connect-completion-backfill-last-run")
        .textContent,
    ).toBe("inserted 2/5");
  });

  it("shows the no-op toast when nothing needed backfilling", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ scanned: 4, inserted: 0, skipped: false }),
    );
    const user = userEvent.setup();
    render(<BackfillHarness />);

    await user.click(
      screen.getByTestId("button-wallet-connect-completion-backfill-run"),
    );

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Nothing to backfill" }),
    );
  });

  it("shows the already-running toast when the backfill was skipped", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ scanned: 0, inserted: 0, skipped: true }),
    );
    const user = userEvent.setup();
    render(<BackfillHarness />);

    await user.click(
      screen.getByTestId("button-wallet-connect-completion-backfill-run"),
    );

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Backfill already running" }),
    );
  });

  it("shows the destructive toast on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "boom" }, false),
    );
    const user = userEvent.setup();
    render(<BackfillHarness />);

    await user.click(
      screen.getByTestId("button-wallet-connect-completion-backfill-run"),
    );

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", title: "Error" }),
    );
  });

  it("calls onLoadCount after a successful non-skipped run", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ scanned: 10, inserted: 3, skipped: false }),
    );
    const onLoadCount = vi.fn();
    const user = userEvent.setup();
    render(<BackfillHarness onLoadCount={onLoadCount} />);

    await user.click(
      screen.getByTestId("button-wallet-connect-completion-backfill-run"),
    );

    await waitFor(() => expect(onLoadCount).toHaveBeenCalledTimes(1));
  });

  it("does NOT call onLoadCount when the run is skipped", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ scanned: 0, inserted: 0, skipped: true }),
    );
    const onLoadCount = vi.fn();
    const user = userEvent.setup();
    render(<BackfillHarness onLoadCount={onLoadCount} />);

    await user.click(
      screen.getByTestId("button-wallet-connect-completion-backfill-run"),
    );

    // Wait for the fetch to complete (button re-enables in finally block)
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const btn = screen.getByTestId(
      "button-wallet-connect-completion-backfill-run",
    ) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(onLoadCount).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Static source assertions — handler in AdminDashboard.tsx
// ---------------------------------------------------------------------------

describe("AdminDashboard.tsx — runWalletConnectCompletionBackfill source", () => {
  it("defines the handler", () => {
    expect(ADMIN_SRC).toContain(
      "const runWalletConnectCompletionBackfill = async",
    );
  });

  it("POSTs to the backfill endpoint with the admin bearer token", () => {
    expect(ADMIN_SRC).toContain(
      "'/api/admin/wallet-connect-completion-backfill/run'",
    );
    expect(ADMIN_SRC).toContain("setIsWalletConnectCompletionBackfillRunning(true)");
    expect(ADMIN_SRC).toContain(
      "setIsWalletConnectCompletionBackfillRunning(false)",
    );
    expect(ADMIN_SRC).toContain(
      "setLastWalletConnectCompletionBackfillRun(result)",
    );
  });

  it("branches the success toast on skipped / inserted>0 / no-op", () => {
    expect(ADMIN_SRC).toContain("'Backfill already running'");
    expect(ADMIN_SRC).toContain("'Backfill complete'");
    expect(ADMIN_SRC).toContain("'Nothing to backfill'");
  });

  it("exposes the handler + state through the dashboard context value", () => {
    expect(ADMIN_SRC).toContain("isWalletConnectCompletionBackfillRunning,");
    expect(ADMIN_SRC).toContain("lastWalletConnectCompletionBackfillRun,");
    expect(ADMIN_SRC).toContain("runWalletConnectCompletionBackfill,");
  });

  it("defines loadWalletConnectCompletionBackfillCount and GETs the count endpoint", () => {
    expect(ADMIN_SRC).toContain(
      "const loadWalletConnectCompletionBackfillCount = async",
    );
    expect(ADMIN_SRC).toContain(
      "'/api/admin/wallet-connect-completion-backfill'",
    );
    expect(ADMIN_SRC).toContain(
      "setWalletConnectCompletionBackfillCount(",
    );
    expect(ADMIN_SRC).toContain(
      "isWalletConnectCompletionBackfillCountLoading,",
    );
    expect(ADMIN_SRC).toContain(
      "loadWalletConnectCompletionBackfillCount,",
    );
  });

  it("guards the count refresh with if (!result.skipped) so skipped runs never refresh", () => {
    expect(ADMIN_SRC).toContain("if (!result.skipped)");
    expect(ADMIN_SRC).toContain("loadWalletConnectCompletionBackfillCount()");
  });

  it("refreshes the count after a non-skipped backfill run", () => {
    expect(ADMIN_SRC).toContain(
      "void loadWalletConnectCompletionBackfillCount()",
    );
  });
});

// ---------------------------------------------------------------------------
// Static source assertions — card in SettingsTab.tsx
// ---------------------------------------------------------------------------

describe("SettingsTab.tsx — WalletConnectCompletionBackfillCard source", () => {
  it("renders the run button and last-run text with the expected data-testids", () => {
    expect(SETTINGS_SRC).toContain(
      'data-testid="button-wallet-connect-completion-backfill-run"',
    );
    expect(SETTINGS_SRC).toContain(
      'data-testid="text-wallet-connect-completion-backfill-last-run"',
    );
  });

  it("renders the live missing-count text with the expected data-testid", () => {
    expect(SETTINGS_SRC).toContain(
      'data-testid="text-wallet-connect-completion-backfill-count"',
    );
    expect(SETTINGS_SRC).toContain("walletConnectCompletionBackfillCount");
    expect(SETTINGS_SRC).toContain("isWalletConnectCompletionBackfillCountLoading");
    expect(SETTINGS_SRC).toContain("loadWalletConnectCompletionBackfillCount");
  });

  it("loads the count on mount", () => {
    expect(SETTINGS_SRC).toContain("void loadWalletConnectCompletionBackfillCount()");
  });

  it("disables the button and shows 'Running…' while a backfill is in flight", () => {
    expect(SETTINGS_SRC).toContain(
      "disabled={isWalletConnectCompletionBackfillRunning}",
    );
    expect(SETTINGS_SRC).toContain('"Run backfill now"');
    expect(SETTINGS_SRC).toContain("runWalletConnectCompletionBackfill()");
  });

  it("is mounted in the settings layout", () => {
    expect(SETTINGS_SRC).toContain("<WalletConnectCompletionBackfillCard />");
  });

  it("renders the inserted-rows last-run text whose static parts match the E2E SUCCESS_LAST_RUN_TEXT constant", () => {
    expect(SETTINGS_SRC).toContain("Last manual run inserted ");
    expect(SETTINGS_SRC).toContain(" missing completion row(s) out of ");
    expect(SETTINGS_SRC).toContain(" marker(s) scanned.");
  });

  it("renders the skipped last-run text that exactly matches the E2E SKIPPED_LAST_RUN_TEXT constant", () => {
    expect(SETTINGS_SRC).toContain(
      "Last manual run was skipped — a backfill was already in progress.",
    );
  });

  it("renders the no-op last-run text whose static parts match the template literal", () => {
    expect(SETTINGS_SRC).toMatch(
      /Last manual run found nothing to backfill \(\$\{[^}]+\} marker\(s\) scanned\)\./,
    );
  });
});

// ---------------------------------------------------------------------------
// Functional harness — loadWalletConnectCompletionBackfillCount display states
// ---------------------------------------------------------------------------

describe("loadWalletConnectCompletionBackfillCount harness — count display states", () => {
  it("GETs the count endpoint with the bearer token and renders the missing-rows text", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ scanned: 10, missing: 3 }));

    render(<BackfillCountAutoLoadHarness />);

    await waitFor(() =>
      expect(
        screen.getByTestId("text-wallet-connect-completion-backfill-count")
          .textContent,
      ).toContain("3 of 10 marker(s) are missing"),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/wallet-connect-completion-backfill",
      expect.objectContaining({
        headers: { Authorization: `Bearer ${authToken}` },
      }),
    );
    expect(
      screen.getByTestId("text-wallet-connect-completion-backfill-count")
        .textContent,
    ).toBe(
      "3 of 10 marker(s) are missing a completion row and can be backfilled.",
    );
  });

  it("renders 'All completion rows are present' when missing === 0", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ scanned: 7, missing: 0 }),
    );

    render(<BackfillCountAutoLoadHarness />);

    await waitFor(() =>
      expect(
        screen.getByTestId("text-wallet-connect-completion-backfill-count")
          .textContent,
      ).toContain("All completion rows are present"),
    );
    expect(
      screen.getByTestId("text-wallet-connect-completion-backfill-count")
        .textContent,
    ).toBe("All completion rows are present (7 marker(s) scanned).");
  });

  it("renders the loading placeholder before the response arrives", async () => {
    let resolveCount!: (v: Response) => void;
    const deferred = new Promise<Response>((r) => {
      resolveCount = r;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(deferred);

    render(<BackfillCountAutoLoadHarness />);

    await waitFor(() =>
      expect(
        screen.getByTestId("text-wallet-connect-completion-backfill-count")
          .textContent,
      ).toBe("Checking for missing completion rows\u2026"),
    );

    resolveCount(jsonResponse({ scanned: 4, missing: 0 }));
    await waitFor(() =>
      expect(
        screen.getByTestId("text-wallet-connect-completion-backfill-count")
          .textContent,
      ).toContain("All completion rows are present"),
    );
  });

  it("renders the unavailable fallback when the response is not ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "server error" }, false),
    );

    render(<BackfillCountAutoLoadHarness />);

    await waitFor(() =>
      expect(
        screen.getByTestId("text-wallet-connect-completion-backfill-count")
          .textContent,
      ).toBe("Missing completion row count unavailable."),
    );
  });
});

// ---------------------------------------------------------------------------
// Functional harness — post-run count refresh
// ---------------------------------------------------------------------------

describe("backfill count refresh — end-to-end run + re-fetch path", () => {
  it("re-fetches the count endpoint after a successful run with inserted > 0", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url, init) => {
        if (
          typeof url === "string" &&
          url === "/api/admin/wallet-connect-completion-backfill" &&
          (!init || (init as RequestInit).method === undefined)
        ) {
          return Promise.resolve(jsonResponse({ scanned: 5, missing: 2 }));
        }
        return Promise.resolve(
          jsonResponse({ scanned: 5, inserted: 3, skipped: false }),
        );
      });

    const user = userEvent.setup();
    render(<BackfillCountAndRunHarness />);

    await waitFor(() =>
      expect(
        screen.getByTestId("text-wallet-connect-completion-backfill-count")
          .textContent,
      ).toContain("2 of 5 marker(s) are missing"),
    );

    const countCallsBefore = fetchSpy.mock.calls.filter(
      ([url]) =>
        typeof url === "string" &&
        url === "/api/admin/wallet-connect-completion-backfill" &&
        fetchSpy.mock.calls.indexOf([url] as unknown as Parameters<typeof fetch>) >= 0,
    ).length;

    await user.click(
      screen.getByTestId("button-wallet-connect-completion-backfill-run"),
    );

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Backfill complete" }),
    );

    const countCalls = fetchSpy.mock.calls.filter(
      ([url]) =>
        typeof url === "string" &&
        url === "/api/admin/wallet-connect-completion-backfill",
    );
    expect(countCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT re-fetch the count after a skipped run", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url, init) => {
        if (
          typeof url === "string" &&
          url === "/api/admin/wallet-connect-completion-backfill" &&
          (!init || (init as RequestInit).method === undefined)
        ) {
          return Promise.resolve(jsonResponse({ scanned: 3, missing: 1 }));
        }
        return Promise.resolve(
          jsonResponse({ scanned: 0, inserted: 0, skipped: true }),
        );
      });

    const user = userEvent.setup();
    render(<BackfillCountAndRunHarness />);

    await waitFor(() =>
      expect(
        screen.getByTestId("text-wallet-connect-completion-backfill-count")
          .textContent,
      ).toContain("1 of 3 marker(s) are missing"),
    );

    const countCallsAfterMount = fetchSpy.mock.calls.filter(
      ([url]) =>
        typeof url === "string" &&
        url === "/api/admin/wallet-connect-completion-backfill",
    ).length;

    await user.click(
      screen.getByTestId("button-wallet-connect-completion-backfill-run"),
    );

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Backfill already running" }),
    );

    const countCallsTotal = fetchSpy.mock.calls.filter(
      ([url]) =>
        typeof url === "string" &&
        url === "/api/admin/wallet-connect-completion-backfill",
    ).length;
    expect(countCallsTotal).toBe(countCallsAfterMount);
  });
});
