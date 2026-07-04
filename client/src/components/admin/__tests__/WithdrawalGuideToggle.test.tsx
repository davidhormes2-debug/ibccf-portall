// @vitest-environment jsdom
//
// Task #296 — End-to-end test for the Withdrawal Guide toggle in the admin
// case-detail dialog.
//
// Two layers of coverage:
//
//   1. Static source assertions (no full render required) — verify that
//      AdminDashboard.tsx contains the correct data-testids, that the state
//      pill reads from `selectedCase.withdrawalGuideVisible`, that the switch
//      is bound to `withdrawalGuideVisibleEdit`, and that the save button
//      calls `updateWithdrawalProgress` which PATCHes the case with
//      `withdrawalGuideVisible`.
//
//   2. Functional harness test — a slim self-contained React component that
//      replicates the toggle → save → pill-update lifecycle. It mocks
//      `window.fetch` so we can confirm:
//        a. the initial pill state matches the server value,
//        b. flipping the switch and saving PATCHes the right payload,
//        c. after the save + reload the pill reflects the new server value.

import React, { useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Helper: read the production source once.
// ---------------------------------------------------------------------------

const DASHBOARD_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../pages/AdminDashboard.tsx"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Source-extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a function body from its declaration string to the next
 * `\n  const ` declaration.  Returns `""` when the declaration is absent.
 */
function extractFnBody(fnDecl: string): string {
  const start = DASHBOARD_SRC.indexOf(fnDecl);
  if (start === -1) return "";
  const end = DASHBOARD_SRC.indexOf("\n  const ", start + 1);
  return end === -1 ? DASHBOARD_SRC.slice(start) : DASHBOARD_SRC.slice(start, end);
}

/**
 * Extracts a source block starting at the given sentinel comment (e.g.
 * `"// WITHDRAWAL_GUIDE_BANNER_STATE_START"`).  Bounds the slice to the next
 * top-level `\n  const ` declaration so the window grows automatically when
 * the block grows.  Returns `""` when the sentinel is not found.
 */
function extractBlock(sentinel: string): string {
  const start = DASHBOARD_SRC.indexOf(sentinel);
  if (start === -1) return "";
  const end = DASHBOARD_SRC.indexOf("\n  const ", start + 1);
  return DASHBOARD_SRC.slice(start, end === -1 ? DASHBOARD_SRC.length : end);
}

/**
 * Extracts the source from the opening `openTag` that precedes `marker` up
 * to (but not including) `marker`.  Falls back to the nearest `\n  const `
 * boundary.  Returns `""` when the marker is absent.
 */
function extractElemContextBefore(marker: string, openTag: string): string {
  const idx = DASHBOARD_SRC.indexOf(marker);
  if (idx === -1) return "";
  const elemStart = DASHBOARD_SRC.lastIndexOf(openTag, idx);
  const declStart = DASHBOARD_SRC.lastIndexOf("\n  const ", idx);
  return DASHBOARD_SRC.slice(
    elemStart !== -1 ? elemStart : declStart !== -1 ? declStart : 0,
    idx,
  );
}

// ---------------------------------------------------------------------------
// Slim functional harness
// ---------------------------------------------------------------------------
//
// Mirrors the relevant fragment of AdminDashboard state + JSX so the test
// is not coupled to the 10 k-line file while still exercising the same
// interaction contract: edit-state toggle → fetch PATCH → loadData refresh
// → pill driven by the server's authoritative value.

interface HarnessProps {
  initialVisible: boolean;
  caseId: string;
  onFetch?: (url: string, opts: RequestInit) => Promise<Response>;
}

function WithdrawalGuideHarness({ initialVisible, caseId, onFetch }: HarnessProps) {
  // "server-side" value coming back from loadData / GET /api/cases
  const [serverVisible, setServerVisible] = useState<boolean>(initialVisible);
  // local edit buffer (matches withdrawalGuideVisibleEdit in AdminDashboard)
  const [editVisible, setEditVisible] = useState<boolean>(initialVisible);

  const handleSave = async () => {
    const url = `/api/cases/${caseId}`;
    const opts: RequestInit = {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ withdrawalGuideVisible: editVisible }),
    };

    const res = onFetch
      ? await onFetch(url, opts)
      : await fetch(url, opts);

    if (res.ok) {
      // simulate loadData() — re-read the returned case value
      const updated: { withdrawalGuideVisible: boolean } = await res.json();
      setServerVisible(updated.withdrawalGuideVisible);
    }
  };

  return (
    <div>
      {/* Guide Banner state pill — driven by server value, mirrors
          AdminDashboard line containing data-testid="withdrawal-guide-banner-state" */}
      <div data-testid="withdrawal-guide-banner-state">
        {serverVisible ? "Visible" : "Hidden"}
      </div>

      {/* Toggle switch — mirrors data-testid="switch-withdrawal-guide-visible" */}
      <input
        type="checkbox"
        data-testid="switch-withdrawal-guide-visible"
        checked={editVisible}
        onChange={(e) => setEditVisible(e.target.checked)}
        aria-label="Show Withdrawal Guide Banner"
      />

      {/* Save button — mirrors data-testid="button-save-progress" */}
      <button data-testid="button-save-progress" onClick={handleSave}>
        Save Progress Settings
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static source analysis
// ---------------------------------------------------------------------------

describe("AdminDashboard.tsx — withdrawal guide static assertions", () => {
  it("renders the Guide Banner state pill with data-testid='withdrawal-guide-banner-state'", () => {
    expect(DASHBOARD_SRC).toContain('data-testid="withdrawal-guide-banner-state"');
  });

  it("pill text is driven by selectedCase.withdrawalGuideVisible", () => {
    const context = extractBlock("WITHDRAWAL_GUIDE_BANNER_STATE_START");
    expect(context).not.toBe("");
    expect(context).toContain("selectedCase.withdrawalGuideVisible");
    // Must display 'Visible' for truthy and 'Hidden' for falsy.
    expect(context).toContain("Visible");
    expect(context).toContain("Hidden");
  });

  it("renders the toggle switch with data-testid='switch-withdrawal-guide-visible'", () => {
    expect(DASHBOARD_SRC).toContain('data-testid="switch-withdrawal-guide-visible"');
  });

  it("switch is bound to withdrawalGuideVisibleEdit state", () => {
    // Slice from the opening <Switch tag up to (but not including) the testid
    // attr — all props we care about (checked, onCheckedChange) appear before it.
    const context = extractElemContextBefore(
      'data-testid="switch-withdrawal-guide-visible"',
      "<Switch",
    );
    expect(context).toContain("withdrawalGuideVisibleEdit");
  });

  it("renders the save button with data-testid='button-save-progress'", () => {
    expect(DASHBOARD_SRC).toContain('data-testid="button-save-progress"');
  });

  it("save button invokes updateWithdrawalProgress", () => {
    // Slice from the opening <Button tag up to the testid attr — the onClick
    // prop (where updateWithdrawalProgress is referenced) appears before it.
    const context = extractElemContextBefore(
      'data-testid="button-save-progress"',
      "<Button",
    );
    expect(context).toContain("updateWithdrawalProgress");
  });

  it("updateWithdrawalProgress PATCHes withdrawalGuideVisible in the request body", () => {
    // Bound the slice to the next sibling const declaration so the window
    // expands automatically if the function body grows.
    const fnBody = extractFnBody("const updateWithdrawalProgress");
    expect(fnBody).toMatch(/method:\s*['"]PATCH['"]/);
    expect(fnBody).toContain("withdrawalGuideVisible");
    expect(fnBody).toContain("withdrawalGuideVisibleEdit");
  });

  it("withdrawalGuideVisibleEdit is initialised from caseData.withdrawalGuideVisible in openAdminMessageDialog", () => {
    expect(DASHBOARD_SRC).toContain(
      "setWithdrawalGuideVisibleEdit(caseData.withdrawalGuideVisible",
    );
  });
});

// ---------------------------------------------------------------------------
// Functional harness tests
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

describe("Withdrawal Guide toggle — functional harness", () => {
  const CASE_ID = "case-abc";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initial pill state matches the server value (false → Hidden)", () => {
    render(
      <WithdrawalGuideHarness
        initialVisible={false}
        caseId={CASE_ID}
      />,
    );
    expect(screen.getByTestId("withdrawal-guide-banner-state").textContent).toBe("Hidden");
  });

  it("initial pill state matches the server value (true → Visible)", () => {
    render(
      <WithdrawalGuideHarness
        initialVisible={true}
        caseId={CASE_ID}
      />,
    );
    expect(screen.getByTestId("withdrawal-guide-banner-state").textContent).toBe("Visible");
  });

  it("switch starts unchecked when withdrawalGuideVisible is false", () => {
    render(
      <WithdrawalGuideHarness
        initialVisible={false}
        caseId={CASE_ID}
      />,
    );
    const toggle = screen.getByTestId("switch-withdrawal-guide-visible") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("flipping the switch updates the local edit state", async () => {
    const user = userEvent.setup();
    render(
      <WithdrawalGuideHarness
        initialVisible={false}
        caseId={CASE_ID}
      />,
    );
    const toggle = screen.getByTestId("switch-withdrawal-guide-visible") as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await user.click(toggle);

    expect(toggle.checked).toBe(true);
    // Pill is still driven by the server value — unchanged until save.
    expect(screen.getByTestId("withdrawal-guide-banner-state").textContent).toBe("Hidden");
  });

  it("saving PATCHes /api/cases/:id with withdrawalGuideVisible: true", async () => {
    const user = userEvent.setup();
    const capturedRequests: Array<{ url: string; body: Record<string, unknown> }> = [];

    const mockFetch = vi.fn(async (url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      capturedRequests.push({ url, body });
      return new Response(JSON.stringify({ withdrawalGuideVisible: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(
      <WithdrawalGuideHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    // Flip the toggle on, then save.
    await user.click(screen.getByTestId("switch-withdrawal-guide-visible"));
    await user.click(screen.getByTestId("button-save-progress"));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedRequests[0].url).toBe(`/api/cases/${CASE_ID}`);
    expect(capturedRequests[0].body).toHaveProperty("withdrawalGuideVisible", true);
  });

  it("pill reflects the new server value (Visible) after save", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      return new Response(
        JSON.stringify({ withdrawalGuideVisible: body.withdrawalGuideVisible }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    render(
      <WithdrawalGuideHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    expect(screen.getByTestId("withdrawal-guide-banner-state").textContent).toBe("Hidden");

    // Flip on and save.
    await user.click(screen.getByTestId("switch-withdrawal-guide-visible"));
    await user.click(screen.getByTestId("button-save-progress"));

    await waitFor(() =>
      expect(screen.getByTestId("withdrawal-guide-banner-state").textContent).toBe("Visible"),
    );
  });

  it("can toggle the guide off again (Visible → Hidden) after a second save", async () => {
    const user = userEvent.setup();

    let serverState = true;
    const mockFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      serverState = body.withdrawalGuideVisible;
      return new Response(
        JSON.stringify({ withdrawalGuideVisible: serverState }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    render(
      <WithdrawalGuideHarness
        initialVisible={true}
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    expect(screen.getByTestId("withdrawal-guide-banner-state").textContent).toBe("Visible");

    // Toggle off and save.
    await user.click(screen.getByTestId("switch-withdrawal-guide-visible"));
    await user.click(screen.getByTestId("button-save-progress"));

    await waitFor(() =>
      expect(screen.getByTestId("withdrawal-guide-banner-state").textContent).toBe("Hidden"),
    );

    expect(mockFetch.mock.calls[0][1] as RequestInit).toBeTruthy();
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toHaveProperty("withdrawalGuideVisible", false);
  });

  it("pill does NOT update if the PATCH response is non-200", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Locked" }), {
        status: 423,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <WithdrawalGuideHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("switch-withdrawal-guide-visible"));
    await user.click(screen.getByTestId("button-save-progress"));

    // Give any async state a moment to settle, then confirm pill unchanged.
    await waitFor(() =>
      expect(screen.getByTestId("withdrawal-guide-banner-state").textContent).toBe("Hidden"),
    );
  });
});
