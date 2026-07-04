// @vitest-environment jsdom
//
// Tests for the wallet-connect alert marker cleanup cadence settings card.
//
// Coverage comes in two layers (mirroring the WalletConnectAlertMarkerCleanup
// pattern):
//
//   1. A self-contained functional harness that replicates the card's key
//      logic (ms→minutes rendering, envOverride input-lock, bounds gate on the
//      Save button, and the PUT fetch flow) so we can assert on all branches
//      without pulling in the full ~5k-line SettingsTab or the AdminDashboard
//      context tree.
//
//   2. Static source assertions that tie the harness to the REAL source in
//      AdminDashboard.tsx (saveWalletConnectAlertCleanupInterval) and
//      SettingsTab.tsx (WalletConnectAlertCleanupIntervalCard) so the harness
//      cannot silently drift from production.

import React, { useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
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

/**
 * Extracts the full `<Button …>…</Button>` block enclosing a test-id.
 * Searches `source` for `testId`, walks back to the nearest `<Button` and
 * forward to `</Button>`.  Returns `""` when any anchor is missing.
 */
function extractElemContextBefore(testId: string, source: string): string {
  const idx = source.indexOf(testId);
  if (idx === -1) return "";
  const start = source.lastIndexOf("<Button", idx);
  if (start === -1) return "";
  const end = source.indexOf("</Button>", idx);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

// ---------------------------------------------------------------------------
// Constants (must match the service layer)
// ---------------------------------------------------------------------------

const MIN_MS = 60 * 1000;
const MAX_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MS = 60 * 60 * 1000;
const MIN_MINUTES = 1;
const MAX_MINUTES = Math.round(MAX_MS / 60000); // 10080

// ---------------------------------------------------------------------------
// Harness types
// ---------------------------------------------------------------------------

interface IntervalSetting {
  ms: number;
  source: "env" | "db" | "default";
  envOverride: boolean;
  minMs: number;
  maxMs: number;
  defaultMs: number;
  updatedAt: string | null;
  updatedBy: string | null;
  lastSweepAt: string | null;
  nextSweepAt: string | null;
}

interface ToastCall {
  variant?: string;
  title: string;
  description: string;
}

interface HarnessProps {
  initialSetting: IntervalSetting | null;
  authToken: string;
  onFetch: (url: string, opts: RequestInit) => Promise<Response>;
  onToast: (t: ToastCall) => void;
}

// ---------------------------------------------------------------------------
// Functional harness — replicates WalletConnectAlertCleanupIntervalCard +
// saveWalletConnectAlertCleanupInterval
// ---------------------------------------------------------------------------

function CleanupIntervalHarness({
  initialSetting,
  authToken,
  onFetch,
  onToast,
}: HarnessProps) {
  const [setting, setSetting] = useState<IntervalSetting | null>(
    initialSetting,
  );
  const [draftMinutes, setDraftMinutes] = useState<string>(() =>
    initialSetting ? String(Math.round(initialSetting.ms / 60000)) : "",
  );
  const [isSaving, setIsSaving] = useState(false);

  const minMinutes = setting ? Math.round(setting.minMs / 60000) : MIN_MINUTES;
  const maxMinutes = setting ? Math.round(setting.maxMs / 60000) : MAX_MINUTES;
  const currentMinutes = setting ? Math.round(setting.ms / 60000) : null;
  const parsed = Number.parseFloat(draftMinutes);
  const isValid =
    Number.isFinite(parsed) && parsed >= minMinutes && parsed <= maxMinutes;
  const isDirty =
    !!setting &&
    isValid &&
    currentMinutes !== null &&
    parsed !== currentMinutes;
  const envLocked = setting?.envOverride === true;

  const handleSave = async () => {
    if (!isValid) return;
    setIsSaving(true);
    try {
      const res = await onFetch(
        "/api/admin/settings/wallet-connect-alert-cleanup-interval",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ ms: Math.round(parsed * 60 * 1000) }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.error?.toString() || "Failed to update cleanup cadence",
        );
      }
      const newSetting = data as IntervalSetting;
      setSetting(newSetting);
      onToast({
        title: "Cleanup cadence updated",
        description: `Marker cleanup will now run every ${Math.round(newSetting.ms / 60000)} minute(s).`,
      });
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Failed to update cleanup cadence";
      onToast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div data-testid="card-wallet-connect-alert-cleanup-interval">
      <input
        data-testid="input-wallet-connect-alert-cleanup-minutes"
        type="number"
        min={minMinutes}
        max={maxMinutes}
        step={1}
        value={draftMinutes}
        disabled={isSaving || envLocked}
        onChange={(e) => setDraftMinutes(e.target.value)}
      />
      <button
        data-testid="button-wallet-connect-alert-cleanup-save"
        onClick={handleSave}
        disabled={!isDirty || isSaving || envLocked}
      >
        {isSaving ? "Saving…" : "Save"}
      </button>
      {!isValid && draftMinutes !== "" && (
        <p data-testid="text-wallet-connect-alert-cleanup-error">
          Enter a number between {minMinutes} and {maxMinutes}.
        </p>
      )}
      {setting && currentMinutes !== null && (
        <span data-testid="text-wallet-connect-alert-cleanup-current">
          Currently sweeping every {currentMinutes} minute(s)
        </span>
      )}
      {envLocked && (
        <p data-testid="text-wallet-connect-alert-cleanup-env-lock">
          Locked by env var
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

function makeSetting(overrides: Partial<IntervalSetting> = {}): IntervalSetting {
  return {
    ms: DEFAULT_MS,
    source: "default",
    envOverride: false,
    minMs: MIN_MS,
    maxMs: MAX_MS,
    defaultMs: DEFAULT_MS,
    updatedAt: null,
    updatedBy: null,
    lastSweepAt: null,
    nextSweepAt: null,
    ...overrides,
  };
}

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Harness tests — ms→minutes rendering
// ---------------------------------------------------------------------------

describe("WalletConnectAlertCleanupIntervalCard harness — ms→minutes rendering", () => {
  it("converts ms to minutes and shows the current interval", () => {
    render(
      <CleanupIntervalHarness
        initialSetting={makeSetting({ ms: 120 * 60 * 1000 })}
        authToken="t"
        onFetch={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    const input = screen.getByTestId(
      "input-wallet-connect-alert-cleanup-minutes",
    ) as HTMLInputElement;
    expect(input.value).toBe("120");

    expect(
      screen.getByTestId("text-wallet-connect-alert-cleanup-current")
        .textContent,
    ).toContain("120 minute(s)");
  });

  it("renders 60 minutes from the default 1-hour ms value", () => {
    render(
      <CleanupIntervalHarness
        initialSetting={makeSetting()}
        authToken="t"
        onFetch={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    const input = screen.getByTestId(
      "input-wallet-connect-alert-cleanup-minutes",
    ) as HTMLInputElement;
    expect(input.value).toBe("60");
    expect(
      screen.getByTestId("text-wallet-connect-alert-cleanup-current")
        .textContent,
    ).toContain("60 minute(s)");
  });
});

// ---------------------------------------------------------------------------
// Harness tests — envOverride input-lock
// ---------------------------------------------------------------------------

describe("WalletConnectAlertCleanupIntervalCard harness — envOverride lock", () => {
  it("disables the input and the Save button when envOverride is true", () => {
    render(
      <CleanupIntervalHarness
        initialSetting={makeSetting({ envOverride: true, source: "env" })}
        authToken="t"
        onFetch={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    const input = screen.getByTestId(
      "input-wallet-connect-alert-cleanup-minutes",
    ) as HTMLInputElement;
    const saveBtn = screen.getByTestId(
      "button-wallet-connect-alert-cleanup-save",
    ) as HTMLButtonElement;

    expect(input.disabled).toBe(true);
    expect(saveBtn.disabled).toBe(true);
    expect(
      screen.getByTestId("text-wallet-connect-alert-cleanup-env-lock"),
    ).toBeTruthy();
  });

  it("enables the input and Save button when envOverride is false", async () => {
    const user = userEvent.setup();
    render(
      <CleanupIntervalHarness
        initialSetting={makeSetting({ ms: 60 * 60 * 1000 })}
        authToken="t"
        onFetch={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    const input = screen.getByTestId(
      "input-wallet-connect-alert-cleanup-minutes",
    ) as HTMLInputElement;
    expect(input.disabled).toBe(false);

    // Change the value to make Save active.
    await user.clear(input);
    await user.type(input, "90");

    const saveBtn = screen.getByTestId(
      "button-wallet-connect-alert-cleanup-save",
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Harness tests — bounds validation gates the Save button
// ---------------------------------------------------------------------------

describe("WalletConnectAlertCleanupIntervalCard harness — bounds validation", () => {
  it("Save button is disabled (and error shown) when the value is below the minimum (0)", async () => {
    const user = userEvent.setup();
    render(
      <CleanupIntervalHarness
        initialSetting={makeSetting({ ms: 60 * 60 * 1000 })}
        authToken="t"
        onFetch={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    const input = screen.getByTestId(
      "input-wallet-connect-alert-cleanup-minutes",
    ) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "0");

    expect(
      (
        screen.getByTestId(
          "button-wallet-connect-alert-cleanup-save",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByTestId("text-wallet-connect-alert-cleanup-error").textContent,
    ).toContain("1");
  });

  it("Save button is disabled when the value exceeds the maximum", async () => {
    const user = userEvent.setup();
    render(
      <CleanupIntervalHarness
        initialSetting={makeSetting({ ms: 60 * 60 * 1000 })}
        authToken="t"
        onFetch={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    const input = screen.getByTestId(
      "input-wallet-connect-alert-cleanup-minutes",
    ) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "99999");

    expect(
      (
        screen.getByTestId(
          "button-wallet-connect-alert-cleanup-save",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByTestId("text-wallet-connect-alert-cleanup-error").textContent,
    ).toContain(String(MAX_MINUTES));
  });

  it("Save button is disabled when the draft equals the current value (not dirty)", async () => {
    const user = userEvent.setup();
    render(
      <CleanupIntervalHarness
        initialSetting={makeSetting({ ms: 60 * 60 * 1000 })}
        authToken="t"
        onFetch={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    const input = screen.getByTestId(
      "input-wallet-connect-alert-cleanup-minutes",
    ) as HTMLInputElement;
    // The current value is 60. Clear and re-type the same value.
    await user.clear(input);
    await user.type(input, "60");

    expect(
      (
        screen.getByTestId(
          "button-wallet-connect-alert-cleanup-save",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("Save is enabled and sends the correct ms when a valid, changed value is entered", async () => {
    const user = userEvent.setup();
    const captured: Array<{ url: string; opts: RequestInit }> = [];
    const onFetch = vi.fn(async (url: string, opts: RequestInit) => {
      captured.push({ url, opts });
      return jsonResponse(makeSetting({ ms: 90 * 60 * 1000, source: "db" }));
    });
    const toasts: ToastCall[] = [];

    render(
      <CleanupIntervalHarness
        initialSetting={makeSetting({ ms: 60 * 60 * 1000 })}
        authToken="tok-abc"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );

    const input = screen.getByTestId(
      "input-wallet-connect-alert-cleanup-minutes",
    ) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "90");

    const saveBtn = screen.getByTestId("button-wallet-connect-alert-cleanup-save");
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
    await user.click(saveBtn);

    await waitFor(() => expect(onFetch).toHaveBeenCalledTimes(1));
    expect(captured[0].url).toBe(
      "/api/admin/settings/wallet-connect-alert-cleanup-interval",
    );
    expect(captured[0].opts.method).toBe("PUT");
    expect(
      (captured[0].opts.headers as Record<string, string>).Authorization,
    ).toBe("Bearer tok-abc");
    const body = JSON.parse(captured[0].opts.body as string);
    expect(body.ms).toBe(90 * 60 * 1000);

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].title).toBe("Cleanup cadence updated");
    expect(toasts[0].description).toContain("90 minute(s)");
    expect(toasts[0].variant).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Harness tests — save handler branches
// ---------------------------------------------------------------------------

describe("WalletConnectAlertCleanupIntervalCard harness — save handler", () => {
  it("shows a destructive toast when the server returns an error", async () => {
    const user = userEvent.setup();
    const onFetch = vi.fn(async () =>
      jsonResponse({ error: "server refused" }, 503),
    );
    const toasts: ToastCall[] = [];

    render(
      <CleanupIntervalHarness
        initialSetting={makeSetting({ ms: 60 * 60 * 1000 })}
        authToken="t"
        onFetch={onFetch}
        onToast={(t) => toasts.push(t)}
      />,
    );

    const input = screen.getByTestId("input-wallet-connect-alert-cleanup-minutes");
    await user.clear(input);
    await user.type(input, "120");
    await user.click(screen.getByTestId("button-wallet-connect-alert-cleanup-save"));

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].variant).toBe("destructive");
    expect(toasts[0].title).toBe("Error");
    expect(toasts[0].description).toBe("server refused");
  });

  it("disables the Save button and shows 'Saving…' while the request is in-flight, then shows 'Save' once done", async () => {
    const user = userEvent.setup();
    let resolveReq!: (r: Response) => void;
    const pending = new Promise<Response>((r) => (resolveReq = r));
    const onFetch = vi.fn(() => pending);

    render(
      <CleanupIntervalHarness
        initialSetting={makeSetting({ ms: 60 * 60 * 1000 })}
        authToken="t"
        onFetch={onFetch}
        onToast={vi.fn()}
      />,
    );

    const input = screen.getByTestId("input-wallet-connect-alert-cleanup-minutes");
    await user.clear(input);
    await user.type(input, "90");

    const saveBtn = screen.getByTestId(
      "button-wallet-connect-alert-cleanup-save",
    ) as HTMLButtonElement;
    await user.click(saveBtn);

    // While the fetch is pending the button must be disabled and show "Saving…".
    await waitFor(() => expect(saveBtn.disabled).toBe(true));
    expect(saveBtn.textContent).toBe("Saving…");

    // After the fetch resolves isSaving clears; the draft now matches the
    // persisted value so isDirty is false — the button stays disabled but
    // the label reverts to "Save" confirming the saving state was cleared.
    resolveReq(
      jsonResponse(makeSetting({ ms: 90 * 60 * 1000, source: "db" })),
    );
    await waitFor(() => expect(saveBtn.textContent).toBe("Save"));
    // isDirty is false because draft (90) equals the newly-saved value.
    expect(saveBtn.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Static source assertions — AdminDashboard.tsx saveWalletConnectAlertCleanupInterval
// ---------------------------------------------------------------------------

describe("AdminDashboard.tsx — saveWalletConnectAlertCleanupInterval source", () => {
  const body = extractFnBody("const saveWalletConnectAlertCleanupInterval = async");

  it("defines the handler", () => {
    expect(body).not.toBe("");
  });

  it("PUTs to the cleanup interval endpoint", () => {
    expect(body).toContain(
      "'/api/admin/settings/wallet-connect-alert-cleanup-interval'",
    );
    expect(body).toContain("method: 'PUT'");
  });

  it("sends the admin bearer token", () => {
    expect(body).toContain("'Authorization': `Bearer ${authToken}`");
  });

  it("converts minutes to ms before sending (minutes * 60 * 1000)", () => {
    expect(body).toContain("ms: Math.round(minutes * 60 * 1000)");
  });

  it("throws on a non-ok response so the catch branch shows the destructive toast", () => {
    expect(body).toContain("if (!res.ok)");
    expect(body).toContain("variant: 'destructive'");
    expect(body).toContain("title: 'Error'");
  });

  it("shows the 'Cleanup cadence updated' success toast", () => {
    expect(body).toContain("'Cleanup cadence updated'");
  });

  it("persists the returned setting via setWalletConnectAlertCleanupInterval", () => {
    expect(body).toContain("setWalletConnectAlertCleanupInterval(");
  });

  it("always clears the saving flag in finally", () => {
    expect(body).toContain("} finally {");
    expect(body).toContain("setIsWalletConnectAlertCleanupIntervalSaving(false)");
  });
});

// ---------------------------------------------------------------------------
// Static source assertions — SettingsTab.tsx WalletConnectAlertCleanupIntervalCard
// ---------------------------------------------------------------------------

describe("SettingsTab.tsx — WalletConnectAlertCleanupIntervalCard source", () => {
  const card = extractSettingsCard("function WalletConnectAlertCleanupIntervalCard(");

  it("defines the card component", () => {
    expect(card).not.toBe("");
  });

  it("renders the input and Save button with the expected data-testids", () => {
    expect(card).toContain(
      'data-testid="input-wallet-connect-alert-cleanup-minutes"',
    );
    expect(card).toContain(
      'data-testid="button-wallet-connect-alert-cleanup-save"',
    );
  });

  it("disables the input when envLocked (envOverride=true)", () => {
    expect(card).toContain("envLocked");
    // Input disabled prop references envLocked
    expect(card).toMatch(/disabled=\{[^}]*envLocked/);
  });

  it("disables Save when !isDirty or envLocked", () => {
    expect(card).toContain("!isDirty");
    const btnBlock = extractElemContextBefore(
      'data-testid="button-wallet-connect-alert-cleanup-save"',
      card,
    );
    expect(btnBlock, "expected button-wallet-connect-alert-cleanup-save in the settings card").not.toBe("");
    expect(btnBlock).toContain("envLocked");
  });

  it("calls saveWalletConnectAlertCleanupInterval(parsed) on Save click", () => {
    expect(card).toContain("saveWalletConnectAlertCleanupInterval(parsed)");
  });

  it("derives minutes from ms (ms / 60000)", () => {
    expect(card).toContain("60000");
    expect(card).toContain("Math.round");
  });

  it("shows a bounds error when the draft is out of range", () => {
    expect(card).toContain(
      'data-testid="text-wallet-connect-alert-cleanup-error"',
    );
    expect(card).toContain("Enter a number between");
  });

  it("renders the 'Currently sweeping every N minute(s)' status line", () => {
    expect(card).toContain(
      'data-testid="text-wallet-connect-alert-cleanup-current"',
    );
    expect(card).toContain("minute(s)");
  });
});
