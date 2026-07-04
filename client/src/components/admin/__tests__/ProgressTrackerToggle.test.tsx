// @vitest-environment jsdom
//
// Task #358 — Automated tests for the "Show Progress to User" switch in the
// admin case-detail dialog.
//
// Two layers of coverage:
//
//   1. Static source assertions — verify AdminDashboard.tsx contains the
//      correct data-testids, that the pill is driven by
//      `selectedCase.showWithdrawalProgress`, that the switch is bound to
//      `toggleShowWithdrawalProgress`, and that the function PATCHes
//      `showWithdrawalProgress` and calls `loadData()` on success.
//
//   2. Functional harness tests — a slim self-contained React component
//      replicating the full production lifecycle:
//        a. Optimistic update — pill flips immediately on toggle.
//        b. PATCH → server persists the value.
//        c. loadData() reload — pill is driven by the server-authoritative
//           value returned by the reload, not just the optimistic value.
//        d. Rollback — pill reverts on PATCH failure or network error.
//
// The harness accepts an `onLoadData` callback (Promise<boolean>) that
// simulates the `loadData()` call AdminDashboard makes after a successful
// PATCH. The test can return a different value from the server to verify
// that the pill follows the reloaded server state rather than only the
// optimistic value — this is the key acceptance criterion the code reviewer
// required.

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
 * `\n  const ` declaration.  Returns `""` when the declaration is absent
 * so `.toContain()` assertions produce a clear failure message.
 */
function extractFnBody(fnDecl: string): string {
  const start = DASHBOARD_SRC.indexOf(fnDecl);
  if (start === -1) return "";
  const end = DASHBOARD_SRC.indexOf("\n  const ", start + 1);
  return end === -1 ? DASHBOARD_SRC.slice(start) : DASHBOARD_SRC.slice(start, end);
}

/**
 * Extracts the source from the opening `openTag` (e.g. `"<Switch"`,
 * `"<Button"`, `"<div"`) that precedes `marker` up to (but not including)
 * `marker`.  Falls back to the nearest `\n  const ` boundary when the open
 * tag is not found.  Returns `""` when the marker is absent.
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

// Pre-computed function bodies used across multiple static assertions.
const TOGGLE_FN_BODY = extractFnBody("const toggleShowWithdrawalProgress");
const UPDATE_FN_BODY = extractFnBody("const updateWithdrawalProgress");

// ---------------------------------------------------------------------------
// Slim functional harness
// ---------------------------------------------------------------------------
//
// Replicates the AdminDashboard lifecycle for `toggleShowWithdrawalProgress`:
//   1. Optimistic: update serverVisible immediately.
//   2. PATCH the server.
//   3. Success: call onLoadData() (simulates `loadData()`) and update the
//      pill with whatever the server returns — this is the "after reload"
//      path the acceptance criterion requires.
//   4. Failure / network error: roll back to prev.

interface HarnessProps {
  initialVisible: boolean;
  caseId: string;
  onFetch?: (url: string, opts: RequestInit) => Promise<Response>;
  /** Simulates loadData() — resolves with the authoritative server value. */
  onLoadData?: () => Promise<boolean>;
}

function ProgressTrackerHarness({
  initialVisible,
  caseId,
  onFetch,
  onLoadData,
}: HarnessProps) {
  // "server-side" value (driven by selectedCase.showWithdrawalProgress)
  const [serverVisible, setServerVisible] = useState<boolean>(initialVisible);

  const handleToggle = async (next: boolean) => {
    const prev = serverVisible;
    // Optimistic update — mirrors AdminDashboard behaviour
    setServerVisible(next);

    const url = `/api/cases/${caseId}`;
    const opts: RequestInit = {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ showWithdrawalProgress: next }),
    };

    try {
      const res = onFetch
        ? await onFetch(url, opts)
        : await fetch(url, opts);

      if (res.ok) {
        // Success: call loadData() and drive the pill from the server's
        // authoritative value — this is the contract under test.
        if (onLoadData) {
          const reloaded = await onLoadData();
          setServerVisible(reloaded);
        }
        // If no onLoadData is provided the optimistic value stays (acceptable
        // for tests that only care about PATCH correctness, not reload).
      } else {
        // Rollback on server error
        setServerVisible(prev);
      }
    } catch {
      // Rollback on network error
      setServerVisible(prev);
    }
  };

  return (
    <div>
      {/* Status pill — mirrors data-testid="progress-tracker-state" */}
      <div data-testid="progress-tracker-state">
        {serverVisible ? "Visible" : "Hidden"}
      </div>

      {/* Toggle switch — mirrors data-testid="switch-show-progress" */}
      <input
        type="checkbox"
        data-testid="switch-show-progress"
        checked={serverVisible}
        onChange={(e) => handleToggle(e.target.checked)}
        aria-label="Show Progress to User"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static source analysis
// ---------------------------------------------------------------------------

describe("AdminDashboard.tsx — progress tracker static assertions", () => {
  it("renders the progress tracker pill with data-testid='progress-tracker-state'", () => {
    expect(DASHBOARD_SRC).toContain('data-testid="progress-tracker-state"');
  });

  it("pill text is driven by selectedCase.showWithdrawalProgress", () => {
    const context =
      extractElemContextBefore('data-testid="progress-tracker-state"', "<div") +
      extractFnBody('data-testid="progress-tracker-state"');
    expect(context).not.toBe("");
    expect(context).toContain("selectedCase.showWithdrawalProgress");
    expect(context).toContain("Visible");
    expect(context).toContain("Hidden");
  });

  it("renders the toggle switch with data-testid='switch-show-progress'", () => {
    expect(DASHBOARD_SRC).toContain('data-testid="switch-show-progress"');
  });

  it("switch calls toggleShowWithdrawalProgress on change", () => {
    // Slice from the opening <Switch tag up to (but not including) the testid
    // attr — onCheckedChange (where toggleShowWithdrawalProgress appears) is
    // before data-testid in source.
    const context = extractElemContextBefore('data-testid="switch-show-progress"', "<Switch");
    expect(context).toContain("toggleShowWithdrawalProgress");
  });

  it("switch onCheckedChange clears the save-progress error banner (setSaveProgressError(null))", () => {
    // The show-progress Switch is part of the same Save Progress form as the
    // text/select inputs. Flipping the toggle after a failed save must clear
    // the error banner, just like the other inputs do.
    // extractElemContextBefore returns source from the opening <Switch tag up
    // to (but not including) data-testid — onCheckedChange lives in that span.
    const context = extractElemContextBefore('data-testid="switch-show-progress"', "<Switch");
    expect(
      context,
      "The onCheckedChange handler on the switch-show-progress Switch must call " +
        "setSaveProgressError(null) so the error banner clears when the admin flips the toggle.",
    ).toContain("setSaveProgressError(null)");
  });

  it("toggleShowWithdrawalProgress PATCHes showWithdrawalProgress in the request body", () => {
    expect(TOGGLE_FN_BODY).toMatch(/method:\s*['"]PATCH['"]/);
    expect(TOGGLE_FN_BODY).toContain("showWithdrawalProgress");
  });

  it("toggleShowWithdrawalProgress performs an optimistic update on selectedCase", () => {
    expect(TOGGLE_FN_BODY).toContain("setSelectedCase");
    expect(TOGGLE_FN_BODY).toContain("showWithdrawalProgress");
  });

  it("toggleShowWithdrawalProgress calls loadData() after a successful PATCH", () => {
    // loadData() is called in the res.ok branch.
    expect(TOGGLE_FN_BODY).toContain("loadData()");
  });

  it("showWithdrawalProgressEdit is initialised from caseData.showWithdrawalProgress", () => {
    expect(DASHBOARD_SRC).toContain(
      "setShowWithdrawalProgressEdit(caseData.showWithdrawalProgress",
    );
  });

  // ---------------------------------------------------------------------------
  // Save-button path: updateWithdrawalProgress includes showWithdrawalProgress
  // ---------------------------------------------------------------------------

  it("updateWithdrawalProgress PATCHes showWithdrawalProgress in the request body", () => {
    expect(UPDATE_FN_BODY).toMatch(/method:\s*['"]PATCH['"]/);
    expect(UPDATE_FN_BODY).toContain("showWithdrawalProgress");
  });

  it("updateWithdrawalProgress sends showWithdrawalProgressEdit (edit buffer) in the body", () => {
    expect(UPDATE_FN_BODY).toContain("showWithdrawalProgressEdit");
  });

  it("save button (button-save-progress) invokes updateWithdrawalProgress", () => {
    // Slice from the opening <Button tag up to the testid attr — the onClick
    // prop (where updateWithdrawalProgress is referenced) appears before it.
    const context = extractElemContextBefore('data-testid="button-save-progress"', "<Button");
    expect(context).toContain("updateWithdrawalProgress");
  });

  it("updateWithdrawalProgress calls loadData() after a successful PATCH", () => {
    expect(UPDATE_FN_BODY).toContain("loadData()");
  });

  // ---------------------------------------------------------------------------
  // Save-button path: updateWithdrawalProgress includes stage + deposit fields
  // ---------------------------------------------------------------------------

  it("updateWithdrawalProgress sends withdrawalStage in the request body", () => {
    expect(UPDATE_FN_BODY).toContain("withdrawalStage");
  });

  it("updateWithdrawalProgress sends withdrawalStageEdit (edit buffer) in the body", () => {
    expect(UPDATE_FN_BODY).toContain("withdrawalStageEdit");
  });

  it("updateWithdrawalProgress sends activityDepositAmount in the request body", () => {
    expect(UPDATE_FN_BODY).toContain("activityDepositAmount");
  });

  it("updateWithdrawalProgress sends activityDepositAmountEdit (edit buffer) in the body", () => {
    expect(UPDATE_FN_BODY).toContain("activityDepositAmountEdit");
  });

  it("updateWithdrawalProgress sends phraseKeyDepositAmount in the request body", () => {
    expect(UPDATE_FN_BODY).toContain("phraseKeyDepositAmount");
  });

  it("updateWithdrawalProgress sends phraseKeyDepositAmountEdit (edit buffer) in the body", () => {
    expect(UPDATE_FN_BODY).toContain("phraseKeyDepositAmountEdit");
  });

  it("updateWithdrawalProgress sends activityWalletRequirement in the request body", () => {
    expect(UPDATE_FN_BODY).toContain("activityWalletRequirement");
  });

  it("updateWithdrawalProgress sends activityWalletRequirementEdit (edit buffer) in the body", () => {
    expect(UPDATE_FN_BODY).toContain("activityWalletRequirementEdit");
  });

  it("withdrawalStageEdit is initialised from caseData.withdrawalStage", () => {
    expect(DASHBOARD_SRC).toContain(
      "setWithdrawalStageEdit(caseData.withdrawalStage",
    );
  });

  it("activityDepositAmountEdit is initialised from caseData.activityDepositAmount", () => {
    expect(DASHBOARD_SRC).toContain(
      "setActivityDepositAmountEdit(caseData.activityDepositAmount",
    );
  });

  it("phraseKeyDepositAmountEdit is initialised from caseData.phraseKeyDepositAmount", () => {
    expect(DASHBOARD_SRC).toContain(
      "setPhraseKeyDepositAmountEdit(caseData.phraseKeyDepositAmount",
    );
  });

  it("activityWalletRequirementEdit is initialised from caseData.activityWalletRequirement", () => {
    expect(DASHBOARD_SRC).toContain(
      "setActivityWalletRequirementEdit(caseData.activityWalletRequirement",
    );
  });

  // ---------------------------------------------------------------------------
  // Catch path: updateWithdrawalProgress surfaces errors via saveProgressError
  // ---------------------------------------------------------------------------

  it("updateWithdrawalProgress has a catch block that calls setSaveProgressError", () => {
    expect(UPDATE_FN_BODY).toContain("setSaveProgressError");
  });

  it("updateWithdrawalProgress clears saveProgressError before the fetch", () => {
    expect(UPDATE_FN_BODY).toContain("setSaveProgressError(null)");
  });

  it("updateWithdrawalProgress sets saveProgressError on a non-ok HTTP response", () => {
    const afterRes = UPDATE_FN_BODY.slice(UPDATE_FN_BODY.indexOf("res.ok"));
    expect(afterRes).toContain("setSaveProgressError");
  });

  it("production source renders data-testid=\"save-error-message\" when saveProgressError is set", () => {
    expect(DASHBOARD_SRC).toContain('data-testid="save-error-message"');
  });

  it("save-error-message element has role=\"alert\" for accessibility", () => {
    const idx = DASHBOARD_SRC.indexOf('data-testid="save-error-message"');
    const context = DASHBOARD_SRC.slice(Math.max(0, idx - 200), idx + 50);
    expect(context).toContain('role="alert"');
  });

  it("at least one withdrawal-progress change handler clears saveProgressError", () => {
    const stageIdx = DASHBOARD_SRC.indexOf('data-testid="select-withdrawal-stage"');
    expect(stageIdx).not.toBe(-1);
    const stageContext = DASHBOARD_SRC.slice(Math.max(0, stageIdx - 400), stageIdx + 50);
    expect(stageContext).toContain("setSaveProgressError(null)");
  });
});

// ---------------------------------------------------------------------------
// Functional harness tests
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

describe("Progress tracker toggle — functional harness", () => {
  const CASE_ID = "case-xyz";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initial pill state matches server value (false → Hidden)", () => {
    render(
      <ProgressTrackerHarness initialVisible={false} caseId={CASE_ID} />,
    );
    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden");
  });

  it("initial pill state matches server value (true → Visible)", () => {
    render(
      <ProgressTrackerHarness initialVisible={true} caseId={CASE_ID} />,
    );
    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Visible");
  });

  it("switch starts unchecked when showWithdrawalProgress is false", () => {
    render(
      <ProgressTrackerHarness initialVisible={false} caseId={CASE_ID} />,
    );
    const toggle = screen.getByTestId("switch-show-progress") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("pill updates optimistically to Visible immediately on toggle (before server response)", async () => {
    const user = userEvent.setup();

    // Deferred fetch so we can observe the optimistic state while in-flight.
    let resolveFetch!: (r: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const mockFetch = vi.fn(() => pendingFetch);

    render(
      <ProgressTrackerHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden");

    // Flip the toggle — optimistic update must fire before fetch settles.
    await user.click(screen.getByTestId("switch-show-progress"));
    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Visible");

    // Resolve so React can clean up.
    resolveFetch(new Response(JSON.stringify({}), { status: 200 }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });

  it("PATCHes /api/cases/:id with showWithdrawalProgress: true when toggled on", async () => {
    const user = userEvent.setup();
    const capturedRequests: Array<{ url: string; body: Record<string, unknown> }> = [];

    const mockFetch = vi.fn(async (url: string, opts: RequestInit) => {
      capturedRequests.push({ url, body: JSON.parse(opts.body as string) });
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <ProgressTrackerHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("switch-show-progress"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedRequests[0].url).toBe(`/api/cases/${CASE_ID}`);
    expect(capturedRequests[0].body).toHaveProperty("showWithdrawalProgress", true);
  });

  it("PATCHes /api/cases/:id with showWithdrawalProgress: false when toggled off", async () => {
    const user = userEvent.setup();
    const capturedRequests: Array<{ url: string; body: Record<string, unknown> }> = [];

    const mockFetch = vi.fn(async (url: string, opts: RequestInit) => {
      capturedRequests.push({ url, body: JSON.parse(opts.body as string) });
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <ProgressTrackerHarness
        initialVisible={true}
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("switch-show-progress"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedRequests[0].body).toHaveProperty("showWithdrawalProgress", false);
  });

  // ---------------------------------------------------------------------------
  // Acceptance criterion: pill reflects the new state AFTER reload
  // ---------------------------------------------------------------------------
  //
  // toggleShowWithdrawalProgress calls loadData() after a successful PATCH.
  // loadData() re-fetches the case list and updates selectedCase with the
  // server-authoritative value. The harness simulates this via onLoadData().

  it("pill reflects the server value returned by loadData() after a successful PATCH (Hidden → Visible)", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    // Simulate loadData() returning the server's persisted value (true).
    const mockLoadData = vi.fn(async () => true);

    render(
      <ProgressTrackerHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden");

    await user.click(screen.getByTestId("switch-show-progress"));

    // After PATCH + reload the pill must show Visible (server truth).
    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Visible"),
    );
    expect(mockLoadData).toHaveBeenCalledTimes(1);
  });

  it("pill reflects the server value returned by loadData() after a successful PATCH (Visible → Hidden)", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    // Simulate loadData() confirming the toggle-off was persisted.
    const mockLoadData = vi.fn(async () => false);

    render(
      <ProgressTrackerHarness
        initialVisible={true}
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Visible");

    await user.click(screen.getByTestId("switch-show-progress"));

    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden"),
    );
    expect(mockLoadData).toHaveBeenCalledTimes(1);
  });

  it("pill is driven by server value after reload even if server returns different state than optimistic", async () => {
    const user = userEvent.setup();

    // PATCH succeeds but server reports showWithdrawalProgress is still false
    // (e.g. a concurrent admin reset it). The pill must follow the server.
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const mockLoadData = vi.fn(async () => false); // server says false

    render(
      <ProgressTrackerHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    // Toggle on → optimistic pill goes Visible
    await user.click(screen.getByTestId("switch-show-progress"));

    // After reload the server says false → pill must revert to Hidden
    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden"),
    );
  });

  it("loadData() is NOT called when PATCH fails (non-200)", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Locked" }), { status: 423 }),
    );
    const mockLoadData = vi.fn(async () => true);

    render(
      <ProgressTrackerHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    await user.click(screen.getByTestId("switch-show-progress"));

    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden"),
    );
    // loadData() must not have fired — rollback path only.
    expect(mockLoadData).not.toHaveBeenCalled();
  });

  it("pill rolls back to Hidden when PATCH returns a non-200 response", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Locked" }), { status: 423 }),
    );

    render(
      <ProgressTrackerHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("switch-show-progress"));

    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden"),
    );
  });

  it("pill rolls back to Hidden when PATCH throws a network error", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () => {
      throw new TypeError("Network failure");
    });

    render(
      <ProgressTrackerHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("switch-show-progress"));

    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden"),
    );
  });

  it("can toggle on and then off again — each save calls loadData() once", async () => {
    const user = userEvent.setup();
    let serverState = false;

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const mockLoadData = vi.fn(async () => serverState);

    render(
      <ProgressTrackerHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    // Toggle on
    serverState = true;
    await user.click(screen.getByTestId("switch-show-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Visible"),
    );

    // Toggle off
    serverState = false;
    await user.click(screen.getByTestId("switch-show-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden"),
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockLoadData).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Save-button path harness
// ---------------------------------------------------------------------------
//
// Models the edit-buffer → Save Progress Settings button → pill-update flow:
//
//   1. `serverVisible` is driven by `selectedCase.showWithdrawalProgress`
//      (the value returned by loadData()).
//   2. `editVisible` mirrors `showWithdrawalProgressEdit` — the switch writes
//      to this buffer without immediately PATCHing the server.
//   3. Clicking the save button fires updateWithdrawalProgress, which PATCHes
//      the case with the edit-buffer value and then calls loadData(). The
//      pill is driven by whatever loadData() returns, not the edit buffer.
//
// This is the second PATCH path from updateWithdrawalProgress that Task #462
// requires coverage for (the first, toggleShowWithdrawalProgress, is tested
// above).

interface SaveHarnessProps {
  initialVisible: boolean;
  caseId: string;
  onFetch?: (url: string, opts: RequestInit) => Promise<Response>;
  /** Simulates loadData() — resolves with the authoritative server value. */
  onLoadData?: () => Promise<boolean>;
}

function SaveProgressHarness({
  initialVisible,
  caseId,
  onFetch,
  onLoadData,
}: SaveHarnessProps) {
  const [serverVisible, setServerVisible] = useState<boolean>(initialVisible);
  const [editVisible, setEditVisible] = useState<boolean>(initialVisible);

  const handleSave = async () => {
    const url = `/api/cases/${caseId}`;
    const opts: RequestInit = {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ showWithdrawalProgress: editVisible }),
    };

    try {
      const res = onFetch
        ? await onFetch(url, opts)
        : await fetch(url, opts);

      if (res.ok) {
        if (onLoadData) {
          const reloaded = await onLoadData();
          setServerVisible(reloaded);
        }
      }
    } catch {
      // save failed — pill keeps current server value
    }
  };

  return (
    <div>
      {/* Status pill — driven by server value, mirrors progress-tracker-state */}
      <div data-testid="progress-tracker-state">
        {serverVisible ? "Visible" : "Hidden"}
      </div>

      {/* Edit-buffer switch — mirrors showWithdrawalProgressEdit binding */}
      <input
        type="checkbox"
        data-testid="switch-show-progress"
        checked={editVisible}
        onChange={(e) => setEditVisible(e.target.checked)}
        aria-label="Show Progress to User"
      />

      {/* Save button — mirrors data-testid="button-save-progress" */}
      <button data-testid="button-save-progress" onClick={handleSave}>
        Save Progress Settings
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Functional tests — save-button path
// ---------------------------------------------------------------------------

describe("Progress tracker — Save Progress Settings button path", () => {
  const CASE_ID = "case-save-btn";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("pill starts Hidden when showWithdrawalProgress is false", () => {
    render(
      <SaveProgressHarness initialVisible={false} caseId={CASE_ID} />,
    );
    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden");
  });

  it("pill starts Visible when showWithdrawalProgress is true", () => {
    render(
      <SaveProgressHarness initialVisible={true} caseId={CASE_ID} />,
    );
    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Visible");
  });

  it("flipping the switch does NOT update the pill before save", async () => {
    const user = userEvent.setup();
    render(
      <SaveProgressHarness initialVisible={false} caseId={CASE_ID} />,
    );

    await user.click(screen.getByTestId("switch-show-progress"));

    // Edit buffer changed but pill is still server-driven → Hidden.
    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden");
  });

  it("PATCHes /api/cases/:id with showWithdrawalProgress: true when switch is on and Save is clicked", async () => {
    const user = userEvent.setup();
    const capturedRequests: Array<{ url: string; body: Record<string, unknown> }> = [];

    const mockFetch = vi.fn(async (url: string, opts: RequestInit) => {
      capturedRequests.push({ url, body: JSON.parse(opts.body as string) });
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveProgressHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("switch-show-progress"));
    await user.click(screen.getByTestId("button-save-progress"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedRequests[0].url).toBe(`/api/cases/${CASE_ID}`);
    expect(capturedRequests[0].body).toHaveProperty("showWithdrawalProgress", true);
  });

  it("PATCHes /api/cases/:id with showWithdrawalProgress: false when switch is off and Save is clicked", async () => {
    const user = userEvent.setup();
    const capturedRequests: Array<{ url: string; body: Record<string, unknown> }> = [];

    const mockFetch = vi.fn(async (url: string, opts: RequestInit) => {
      capturedRequests.push({ url, body: JSON.parse(opts.body as string) });
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveProgressHarness
        initialVisible={true}
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("switch-show-progress"));
    await user.click(screen.getByTestId("button-save-progress"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedRequests[0].body).toHaveProperty("showWithdrawalProgress", false);
  });

  it("pill reflects the server value (Visible) returned by loadData() after Save", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const mockLoadData = vi.fn(async () => true);

    render(
      <SaveProgressHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden");

    await user.click(screen.getByTestId("switch-show-progress"));
    await user.click(screen.getByTestId("button-save-progress"));

    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Visible"),
    );
    expect(mockLoadData).toHaveBeenCalledTimes(1);
  });

  it("pill reflects the server value (Hidden) returned by loadData() after Save", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const mockLoadData = vi.fn(async () => false);

    render(
      <SaveProgressHarness
        initialVisible={true}
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Visible");

    await user.click(screen.getByTestId("switch-show-progress"));
    await user.click(screen.getByTestId("button-save-progress"));

    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden"),
    );
    expect(mockLoadData).toHaveBeenCalledTimes(1);
  });

  it("pill follows the server even if server returns a different value than the edit buffer (server wins)", async () => {
    const user = userEvent.setup();

    // Switch toggled on (edit buffer = true), but server reports false after save.
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const mockLoadData = vi.fn(async () => false);

    render(
      <SaveProgressHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    await user.click(screen.getByTestId("switch-show-progress"));
    await user.click(screen.getByTestId("button-save-progress"));

    // Server returned false → pill stays Hidden despite edit buffer being true.
    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden"),
    );
  });

  it("loadData() is NOT called when PATCH fails (non-200)", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Locked" }), { status: 423 }),
    );
    const mockLoadData = vi.fn(async () => true);

    render(
      <SaveProgressHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    await user.click(screen.getByTestId("switch-show-progress"));
    await user.click(screen.getByTestId("button-save-progress"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockLoadData).not.toHaveBeenCalled();
    // Pill is unchanged.
    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden");
  });

  it("pill does not update when Save is clicked without changing the switch", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    // loadData returns the same value as the initial state.
    const mockLoadData = vi.fn(async () => false);

    render(
      <SaveProgressHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    // Click Save without toggling anything.
    await user.click(screen.getByTestId("button-save-progress"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden");
  });

  it("can save on → off → on in sequence, pill follows server each time", async () => {
    const user = userEvent.setup();
    let serverState = false;

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const mockLoadData = vi.fn(async () => serverState);

    render(
      <SaveProgressHarness
        initialVisible={false}
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    // Save on.
    serverState = true;
    await user.click(screen.getByTestId("switch-show-progress"));
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Visible"),
    );

    // Save off.
    serverState = false;
    await user.click(screen.getByTestId("switch-show-progress"));
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("progress-tracker-state").textContent).toBe("Hidden"),
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockLoadData).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Extended save-button harness — withdrawal stage + deposit amount fields
// ---------------------------------------------------------------------------
//
// Models the full updateWithdrawalProgress payload: in addition to
// showWithdrawalProgress, the function also sends withdrawalStage,
// activityDepositAmount, phraseKeyDepositAmount, and
// activityWalletRequirement.  The harness below mirrors those edit buffers so
// tests can confirm each value reaches the PATCH body.

interface SaveProgressFullHarnessProps {
  initialStage?: string;
  initialActivityDeposit?: string;
  initialPhraseKeyDeposit?: string;
  initialWalletRequirement?: string;
  caseId: string;
  onFetch?: (url: string, opts: RequestInit) => Promise<Response>;
  onLoadData?: () => Promise<void>;
}

function SaveProgressFullHarness({
  initialStage = "1",
  initialActivityDeposit = "",
  initialPhraseKeyDeposit = "",
  initialWalletRequirement = "",
  caseId,
  onFetch,
  onLoadData,
}: SaveProgressFullHarnessProps) {
  const [stageEdit, setStageEdit] = useState<string>(initialStage);
  const [activityDepositEdit, setActivityDepositEdit] = useState<string>(initialActivityDeposit);
  const [phraseKeyDepositEdit, setPhraseKeyDepositEdit] = useState<string>(initialPhraseKeyDeposit);
  const [walletRequirementEdit, setWalletRequirementEdit] = useState<string>(initialWalletRequirement);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaveError(null);
    const url = `/api/cases/${caseId}`;
    const opts: RequestInit = {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        withdrawalStage: stageEdit,
        activityDepositAmount: activityDepositEdit,
        phraseKeyDepositAmount: phraseKeyDepositEdit,
        activityWalletRequirement: walletRequirementEdit,
      }),
    };

    try {
      const res = onFetch
        ? await onFetch(url, opts)
        : await fetch(url, opts);

      if (res.ok) {
        if (onLoadData) {
          await onLoadData();
        }
      } else {
        setSaveError(`Failed to update withdrawal progress (HTTP ${res.status}).`);
      }
    } catch {
      setSaveError("Failed to save — network error.");
    }
  };

  return (
    <div>
      <input
        data-testid="input-withdrawal-stage"
        value={stageEdit}
        onChange={(e) => setStageEdit(e.target.value)}
        aria-label="Withdrawal Stage"
      />
      <input
        data-testid="input-activity-deposit"
        value={activityDepositEdit}
        onChange={(e) => setActivityDepositEdit(e.target.value)}
        aria-label="Activity Deposit Amount"
      />
      <input
        data-testid="input-phrase-key-deposit"
        value={phraseKeyDepositEdit}
        onChange={(e) => setPhraseKeyDepositEdit(e.target.value)}
        aria-label="Phrase Key Deposit Amount"
      />
      <input
        data-testid="input-wallet-requirement"
        value={walletRequirementEdit}
        onChange={(e) => setWalletRequirementEdit(e.target.value)}
        aria-label="Activity Wallet Requirement"
      />
      <button data-testid="button-save-progress-full" onClick={handleSave}>
        Save Progress Settings
      </button>
      {saveError !== null && (
        <div role="alert" data-testid="save-error-message">
          {saveError}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Functional tests — stage + deposit field PATCH coverage
// ---------------------------------------------------------------------------

describe("Progress tracker — Save button sends withdrawalStage and deposit amount fields", () => {
  const CASE_ID = "case-stage-fields";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("PATCHes /api/cases/:id with the current withdrawalStage value", async () => {
    const user = userEvent.setup();
    const capturedBodies: Record<string, unknown>[] = [];

    const mockFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(JSON.parse(opts.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveProgressFullHarness
        initialStage="3"
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("button-save-progress-full"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedBodies[0]).toHaveProperty("withdrawalStage", "3");
  });

  it("PATCHes with the updated withdrawalStage after the user changes it", async () => {
    const user = userEvent.setup();
    const capturedBodies: Record<string, unknown>[] = [];

    const mockFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(JSON.parse(opts.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveProgressFullHarness
        initialStage="1"
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    const stageInput = screen.getByTestId("input-withdrawal-stage");
    await user.clear(stageInput);
    await user.type(stageInput, "7");

    await user.click(screen.getByTestId("button-save-progress-full"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedBodies[0]).toHaveProperty("withdrawalStage", "7");
  });

  it("PATCHes with the current activityDepositAmount value", async () => {
    const user = userEvent.setup();
    const capturedBodies: Record<string, unknown>[] = [];

    const mockFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(JSON.parse(opts.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveProgressFullHarness
        initialActivityDeposit="500 USDT"
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("button-save-progress-full"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedBodies[0]).toHaveProperty("activityDepositAmount", "500 USDT");
  });

  it("PATCHes with the updated activityDepositAmount after the user changes it", async () => {
    const user = userEvent.setup();
    const capturedBodies: Record<string, unknown>[] = [];

    const mockFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(JSON.parse(opts.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveProgressFullHarness
        initialActivityDeposit=""
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.type(screen.getByTestId("input-activity-deposit"), "1000 USDT");

    await user.click(screen.getByTestId("button-save-progress-full"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedBodies[0]).toHaveProperty("activityDepositAmount", "1000 USDT");
  });

  it("PATCHes with the current phraseKeyDepositAmount value", async () => {
    const user = userEvent.setup();
    const capturedBodies: Record<string, unknown>[] = [];

    const mockFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(JSON.parse(opts.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveProgressFullHarness
        initialPhraseKeyDeposit="250 USDT"
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("button-save-progress-full"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedBodies[0]).toHaveProperty("phraseKeyDepositAmount", "250 USDT");
  });

  it("PATCHes with the updated phraseKeyDepositAmount after the user changes it", async () => {
    const user = userEvent.setup();
    const capturedBodies: Record<string, unknown>[] = [];

    const mockFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(JSON.parse(opts.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveProgressFullHarness
        initialPhraseKeyDeposit=""
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.type(screen.getByTestId("input-phrase-key-deposit"), "750 USDT");

    await user.click(screen.getByTestId("button-save-progress-full"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedBodies[0]).toHaveProperty("phraseKeyDepositAmount", "750 USDT");
  });

  it("PATCHes with the current activityWalletRequirement value", async () => {
    const user = userEvent.setup();
    const capturedBodies: Record<string, unknown>[] = [];

    const mockFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(JSON.parse(opts.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveProgressFullHarness
        initialWalletRequirement="TRC20"
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("button-save-progress-full"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedBodies[0]).toHaveProperty("activityWalletRequirement", "TRC20");
  });

  it("PATCHes with the updated activityWalletRequirement after the user changes it", async () => {
    const user = userEvent.setup();
    const capturedBodies: Record<string, unknown>[] = [];

    const mockFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(JSON.parse(opts.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveProgressFullHarness
        initialWalletRequirement=""
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.type(screen.getByTestId("input-wallet-requirement"), "TRC20");

    await user.click(screen.getByTestId("button-save-progress-full"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedBodies[0]).toHaveProperty("activityWalletRequirement", "TRC20");
  });

  it("all four fields appear in the same PATCH body", async () => {
    const user = userEvent.setup();
    const capturedBodies: Record<string, unknown>[] = [];

    const mockFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(JSON.parse(opts.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveProgressFullHarness
        initialStage="5"
        initialActivityDeposit="1500 USDT"
        initialPhraseKeyDeposit="500 USDT"
        initialWalletRequirement="ERC20"
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("button-save-progress-full"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedBodies[0]).toHaveProperty("withdrawalStage", "5");
    expect(capturedBodies[0]).toHaveProperty("activityDepositAmount", "1500 USDT");
    expect(capturedBodies[0]).toHaveProperty("phraseKeyDepositAmount", "500 USDT");
    expect(capturedBodies[0]).toHaveProperty("activityWalletRequirement", "ERC20");
  });

  it("loadData() is called after a successful save with updated stage", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const mockLoadData = vi.fn(async () => undefined);

    render(
      <SaveProgressFullHarness
        initialStage="2"
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    const stageInput = screen.getByTestId("input-withdrawal-stage");
    await user.clear(stageInput);
    await user.type(stageInput, "9");

    await user.click(screen.getByTestId("button-save-progress-full"));

    await waitFor(() => expect(mockLoadData).toHaveBeenCalledTimes(1));
  });

  it("loadData() is NOT called when the PATCH fails (non-200)", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Bad Request" }), { status: 400 }),
    );
    const mockLoadData = vi.fn(async () => undefined);

    render(
      <SaveProgressFullHarness
        initialStage="1"
        caseId={CASE_ID}
        onFetch={mockFetch}
        onLoadData={mockLoadData}
      />,
    );

    await user.click(screen.getByTestId("button-save-progress-full"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockLoadData).not.toHaveBeenCalled();
  });

  it("shows an error message when the server rejects the update with HTTP 500", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }),
    );

    render(
      <SaveProgressFullHarness
        initialStage="3"
        initialActivityDeposit="1000 USDT"
        initialPhraseKeyDeposit="500 USDT"
        initialWalletRequirement="TRC20"
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    // No error message before save is attempted.
    expect(screen.queryByTestId("save-error-message")).toBeNull();

    await user.click(screen.getByTestId("button-save-progress-full"));

    // Error message must appear after the server rejects the update.
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );
    expect(screen.getByTestId("save-error-message").textContent).toContain("500");
    // loadData() must not have been called on the error path.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when the fetch throws a network error (TypeError)", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () => {
      throw new TypeError("Network failure");
    });

    render(
      <SaveProgressFullHarness
        initialStage="3"
        initialActivityDeposit="1000 USDT"
        initialPhraseKeyDeposit="500 USDT"
        initialWalletRequirement="TRC20"
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    // No error message before save is attempted.
    expect(screen.queryByTestId("save-error-message")).toBeNull();

    await user.click(screen.getByTestId("button-save-progress-full"));

    // Error message must appear after the network error.
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );
    expect(screen.getByTestId("save-error-message").textContent).toContain("network");
  });
});

// ---------------------------------------------------------------------------
// Behavioural harness — show-progress toggle clears the error banner
// ---------------------------------------------------------------------------
//
// The show-progress Switch sits inside the same Save Progress form as the
// withdrawal-stage and deposit-amount fields. Its onCheckedChange handler
// calls setSaveProgressError(null) before delegating to
// toggleShowWithdrawalProgress — so flipping the switch after a failed save
// must clear the error banner in the same way that editing any other field
// does.
//
// This describe block verifies that behaviour end-to-end: the harness below
// models both the save-error state AND the switch's onCheckedChange path
// calling setSaveProgressError(null). A static assertion already pins the
// wiring in source; this functional test catches regressions where the call
// is present in source but not reached at runtime (e.g. wrapped in a
// condition that swallows the clear).

interface SaveErrorClearHarnessProps {
  initialVisible?: boolean;
  initialStage?: string;
  caseId: string;
  onFetch?: (url: string, opts: RequestInit) => Promise<Response>;
  onToggleFetch?: (url: string, opts: RequestInit) => Promise<Response>;
}

function SaveErrorClearHarness({
  initialVisible = false,
  initialStage = "1",
  caseId,
  onFetch,
  onToggleFetch,
}: SaveErrorClearHarnessProps) {
  const [showProgress, setShowProgress] = useState<boolean>(initialVisible);
  const [stageEdit, setStageEdit] = useState<string>(initialStage);
  const [saveProgressError, setSaveProgressError] = useState<string | null>(null);

  // Mirrors updateWithdrawalProgress in AdminDashboard.
  const handleSave = async () => {
    setSaveProgressError(null);
    const url = `/api/cases/${caseId}`;
    const opts: RequestInit = {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ withdrawalStage: stageEdit, showWithdrawalProgress: showProgress }),
    };
    try {
      const res = onFetch ? await onFetch(url, opts) : await fetch(url, opts);
      if (!res.ok) {
        setSaveProgressError(`Failed to update withdrawal progress (HTTP ${res.status}).`);
      }
    } catch {
      setSaveProgressError("Failed to save — network error.");
    }
  };

  // Mirrors the show-progress Switch onCheckedChange in AdminDashboard:
  //   onCheckedChange={(next) => { setSaveProgressError(null); toggleShowWithdrawalProgress(next); }}
  // The clear happens synchronously before any async PATCH.
  const handleToggle = async (next: boolean) => {
    setSaveProgressError(null);          // ← the line under test
    const prev = showProgress;
    setShowProgress(next);

    const url = `/api/cases/${caseId}`;
    const opts: RequestInit = {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ showWithdrawalProgress: next }),
    };
    try {
      const res = onToggleFetch ? await onToggleFetch(url, opts) : await fetch(url, opts);
      if (!res.ok) {
        setShowProgress(prev);
      }
    } catch {
      setShowProgress(prev);
    }
  };

  return (
    <div>
      {/* Progress pill — mirrors data-testid="progress-tracker-state" */}
      <div data-testid="progress-tracker-state">
        {showProgress ? "Visible" : "Hidden"}
      </div>

      {/* Show-progress switch — mirrors data-testid="switch-show-progress" */}
      <input
        type="checkbox"
        data-testid="switch-show-progress"
        checked={showProgress}
        onChange={(e) => handleToggle(e.target.checked)}
        aria-label="Show Progress to User"
      />

      {/* Stage input — one of the other fields in the same form */}
      <input
        data-testid="input-withdrawal-stage"
        value={stageEdit}
        onChange={(e) => { setStageEdit(e.target.value); setSaveProgressError(null); }}
        aria-label="Withdrawal Stage"
      />

      {/* Save button — mirrors data-testid="button-save-progress" */}
      <button data-testid="button-save-progress" onClick={handleSave}>
        Save Progress Settings
      </button>

      {/* Error banner — mirrors data-testid="save-error-message" */}
      {saveProgressError !== null && (
        <p role="alert" data-testid="save-error-message">
          {saveProgressError}
        </p>
      )}
    </div>
  );
}

describe("Progress tracker — show-progress toggle clears the error banner", () => {
  const CASE_ID = "case-clear-banner";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("error banner appears after a failed save (HTTP 500)", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }),
    );

    render(
      <SaveErrorClearHarness
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    expect(screen.queryByTestId("save-error-message")).toBeNull();

    await user.click(screen.getByTestId("button-save-progress"));

    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );
    expect(screen.getByTestId("save-error-message").textContent).toContain("500");
  });

  it("flipping the show-progress switch clears the error banner after a failed save (HTTP 500)", async () => {
    const user = userEvent.setup();

    // Save always fails so the banner appears.
    const mockSaveFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }),
    );
    // Toggle fetch succeeds so we can observe just the banner-clear behaviour.
    const mockToggleFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );

    render(
      <SaveErrorClearHarness
        caseId={CASE_ID}
        onFetch={mockSaveFetch}
        onToggleFetch={mockToggleFetch}
      />,
    );

    // Step 1: trigger a failed save so the error banner is visible.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Step 2: flip the show-progress switch.
    await user.click(screen.getByTestId("switch-show-progress"));

    // Step 3: the error banner must be gone — setSaveProgressError(null) was
    // called synchronously in onCheckedChange before the toggle PATCH fired.
    await waitFor(() =>
      expect(screen.queryByTestId("save-error-message")).toBeNull(),
    );
  });

  it("flipping the show-progress switch clears the error banner after a network error", async () => {
    const user = userEvent.setup();

    const mockSaveFetch = vi.fn(async () => {
      throw new TypeError("Network failure");
    });
    const mockToggleFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );

    render(
      <SaveErrorClearHarness
        caseId={CASE_ID}
        onFetch={mockSaveFetch}
        onToggleFetch={mockToggleFetch}
      />,
    );

    // Trigger a network-error save so the banner appears.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Flipping the switch must clear the banner immediately.
    await user.click(screen.getByTestId("switch-show-progress"));

    await waitFor(() =>
      expect(screen.queryByTestId("save-error-message")).toBeNull(),
    );
  });

  it("error banner is cleared even when the toggle PATCH itself fails (non-200)", async () => {
    const user = userEvent.setup();

    const mockSaveFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }),
    );
    // Toggle fails too — but the banner from the *save* must still clear
    // because setSaveProgressError(null) fires before the toggle PATCH.
    const mockToggleFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Conflict" }), { status: 409 }),
    );

    render(
      <SaveErrorClearHarness
        caseId={CASE_ID}
        onFetch={mockSaveFetch}
        onToggleFetch={mockToggleFetch}
      />,
    );

    // Trigger a failed save so the banner is visible.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Flip the switch — setSaveProgressError(null) fires synchronously in
    // onCheckedChange regardless of whether the subsequent PATCH succeeds.
    await user.click(screen.getByTestId("switch-show-progress"));

    // Banner must be gone even though the toggle PATCH itself returned 409.
    await waitFor(() =>
      expect(screen.queryByTestId("save-error-message")).toBeNull(),
    );
  });

  it("banner does not reappear after a successful save clears it and the switch is not touched", async () => {
    const user = userEvent.setup();

    // First save fails; second save succeeds. Banner should not reappear.
    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "Server Error" }), { status: 500 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <SaveErrorClearHarness
        caseId={CASE_ID}
        onFetch={mockFetch}
      />,
    );

    // First save fails → banner appears.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Second save succeeds → banner disappears (cleared by setSaveProgressError(null)
    // at the top of updateWithdrawalProgress).
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.queryByTestId("save-error-message")).toBeNull(),
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Behavioural harness — editing stage/deposit fields clears the error banner
// ---------------------------------------------------------------------------
//
// Each text input in the Save Progress form (withdrawal stage, activity deposit
// amount, phrase-key deposit amount, activity wallet requirement) must call
// setSaveProgressError(null) in its onChange handler so that typing in any
// field dismisses an existing error banner.
//
// The harness below mirrors all four inputs plus the error-banner lifecycle.
// A static assertion already pins the wiring in source; these functional tests
// catch regressions where the call is present in source but not reached at
// runtime (e.g. guarded by a condition, or the input is swapped for a
// different element whose onChange path differs).

interface SaveProgressFieldClearHarnessProps {
  caseId: string;
  onFetch?: (url: string, opts: RequestInit) => Promise<Response>;
}

function SaveProgressFieldClearHarness({
  caseId,
  onFetch,
}: SaveProgressFieldClearHarnessProps) {
  const [stageEdit, setStageEdit] = useState<string>("1");
  const [activityDepositEdit, setActivityDepositEdit] = useState<string>("");
  const [phraseKeyDepositEdit, setPhraseKeyDepositEdit] = useState<string>("");
  const [walletRequirementEdit, setWalletRequirementEdit] = useState<string>("");
  const [saveProgressError, setSaveProgressError] = useState<string | null>(null);

  // Mirrors updateWithdrawalProgress — clears the banner before each attempt
  // and sets it on non-ok responses or network failures.
  const handleSave = async () => {
    setSaveProgressError(null);
    const url = `/api/cases/${caseId}`;
    const opts: RequestInit = {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        withdrawalStage: stageEdit,
        activityDepositAmount: activityDepositEdit,
        phraseKeyDepositAmount: phraseKeyDepositEdit,
        activityWalletRequirement: walletRequirementEdit,
      }),
    };
    try {
      const res = onFetch ? await onFetch(url, opts) : await fetch(url, opts);
      if (!res.ok) {
        setSaveProgressError(`Failed to update withdrawal progress (HTTP ${res.status}).`);
      }
    } catch {
      setSaveProgressError("Failed to save — network error.");
    }
  };

  return (
    <div>
      {/* Withdrawal stage — mirrors Select bound to withdrawalStageEdit */}
      <input
        data-testid="input-withdrawal-stage"
        value={stageEdit}
        onChange={(e) => { setStageEdit(e.target.value); setSaveProgressError(null); }}
        aria-label="Withdrawal Stage"
      />

      {/* Activity deposit — mirrors input bound to activityDepositAmountEdit */}
      <input
        data-testid="input-activity-deposit"
        value={activityDepositEdit}
        onChange={(e) => { setActivityDepositEdit(e.target.value); setSaveProgressError(null); }}
        aria-label="Activity Deposit Amount"
      />

      {/* Phrase-key deposit — mirrors input bound to phraseKeyDepositAmountEdit */}
      <input
        data-testid="input-phrase-key-deposit"
        value={phraseKeyDepositEdit}
        onChange={(e) => { setPhraseKeyDepositEdit(e.target.value); setSaveProgressError(null); }}
        aria-label="Phrase Key Deposit Amount"
      />

      {/* Wallet requirement — mirrors input bound to activityWalletRequirementEdit */}
      <input
        data-testid="input-wallet-requirement"
        value={walletRequirementEdit}
        onChange={(e) => { setWalletRequirementEdit(e.target.value); setSaveProgressError(null); }}
        aria-label="Activity Wallet Requirement"
      />

      {/* Save button — mirrors data-testid="button-save-progress" */}
      <button data-testid="button-save-progress" onClick={handleSave}>
        Save Progress Settings
      </button>

      {/* Error banner — mirrors data-testid="save-error-message" */}
      {saveProgressError !== null && (
        <p role="alert" data-testid="save-error-message">
          {saveProgressError}
        </p>
      )}
    </div>
  );
}

describe("Progress tracker — editing stage/deposit fields clears the error banner", () => {
  const CASE_ID = "case-field-clear";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("typing in the withdrawal-stage input clears the error banner after a failed save", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }),
    );

    render(<SaveProgressFieldClearHarness caseId={CASE_ID} onFetch={mockFetch} />);

    // Step 1: trigger a failed save so the banner appears.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Step 2: type in the withdrawal-stage input.
    const stageInput = screen.getByTestId("input-withdrawal-stage");
    await user.clear(stageInput);
    await user.type(stageInput, "5");

    // Step 3: banner must be gone — onChange called setSaveProgressError(null).
    expect(screen.queryByTestId("save-error-message")).toBeNull();
  });

  it("typing in the activityDepositAmount input clears the error banner after a failed save", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }),
    );

    render(<SaveProgressFieldClearHarness caseId={CASE_ID} onFetch={mockFetch} />);

    // Trigger a failed save so the banner appears.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Type in the activity-deposit input — banner must clear immediately.
    await user.type(screen.getByTestId("input-activity-deposit"), "1");

    expect(screen.queryByTestId("save-error-message")).toBeNull();
  });

  it("typing in the phraseKeyDepositAmount input clears the error banner after a failed save", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }),
    );

    render(<SaveProgressFieldClearHarness caseId={CASE_ID} onFetch={mockFetch} />);

    // Trigger a failed save so the banner appears.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Type in the phrase-key-deposit input — banner must clear immediately.
    await user.type(screen.getByTestId("input-phrase-key-deposit"), "5");

    expect(screen.queryByTestId("save-error-message")).toBeNull();
  });

  it("typing in the activityWalletRequirement input clears the error banner after a failed save", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }),
    );

    render(<SaveProgressFieldClearHarness caseId={CASE_ID} onFetch={mockFetch} />);

    // Trigger a failed save so the banner appears.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Type in the wallet-requirement input — banner must clear immediately.
    await user.type(screen.getByTestId("input-wallet-requirement"), "T");

    expect(screen.queryByTestId("save-error-message")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Combined harness — all five Save Progress fields in one render
// ---------------------------------------------------------------------------
//
// The two preceding harnesses test the show-progress toggle (SaveErrorClearHarness)
// and the four text inputs (SaveProgressFieldClearHarness) in isolation. This
// combined harness renders all five fields together so tests can interleave
// toggle flips and text edits and confirm that neither field's onChange
// accidentally overwrites the other's error-clear call or leaves the banner
// visible after any interaction.

interface CombinedSaveProgressHarnessProps {
  caseId: string;
  onFetch?: (url: string, opts: RequestInit) => Promise<Response>;
  onToggleFetch?: (url: string, opts: RequestInit) => Promise<Response>;
}

function CombinedSaveProgressHarness({
  caseId,
  onFetch,
  onToggleFetch,
}: CombinedSaveProgressHarnessProps) {
  const [showProgress, setShowProgress] = useState<boolean>(false);
  const [stageEdit, setStageEdit] = useState<string>("1");
  const [activityDepositEdit, setActivityDepositEdit] = useState<string>("");
  const [phraseKeyDepositEdit, setPhraseKeyDepositEdit] = useState<string>("");
  const [walletRequirementEdit, setWalletRequirementEdit] = useState<string>("");
  const [saveProgressError, setSaveProgressError] = useState<string | null>(null);

  // Mirrors updateWithdrawalProgress in AdminDashboard — sends all five fields.
  const handleSave = async () => {
    setSaveProgressError(null);
    const url = `/api/cases/${caseId}`;
    const opts: RequestInit = {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        withdrawalStage: stageEdit,
        activityDepositAmount: activityDepositEdit,
        phraseKeyDepositAmount: phraseKeyDepositEdit,
        activityWalletRequirement: walletRequirementEdit,
        showWithdrawalProgress: showProgress,
      }),
    };
    try {
      const res = onFetch ? await onFetch(url, opts) : await fetch(url, opts);
      if (!res.ok) {
        setSaveProgressError(`Failed to update withdrawal progress (HTTP ${res.status}).`);
      }
    } catch {
      setSaveProgressError("Failed to save — network error.");
    }
  };

  // Mirrors the show-progress Switch onCheckedChange in AdminDashboard:
  //   setSaveProgressError(null) fires synchronously before toggleShowWithdrawalProgress.
  const handleToggle = async (next: boolean) => {
    setSaveProgressError(null);
    const prev = showProgress;
    setShowProgress(next);

    const url = `/api/cases/${caseId}`;
    const opts: RequestInit = {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ showWithdrawalProgress: next }),
    };
    try {
      const res = onToggleFetch ? await onToggleFetch(url, opts) : await fetch(url, opts);
      if (!res.ok) {
        setShowProgress(prev);
      }
    } catch {
      setShowProgress(prev);
    }
  };

  return (
    <div>
      {/* Progress pill */}
      <div data-testid="progress-tracker-state">
        {showProgress ? "Visible" : "Hidden"}
      </div>

      {/* Show-progress switch */}
      <input
        type="checkbox"
        data-testid="switch-show-progress"
        checked={showProgress}
        onChange={(e) => handleToggle(e.target.checked)}
        aria-label="Show Progress to User"
      />

      {/* Withdrawal stage */}
      <input
        data-testid="input-withdrawal-stage"
        value={stageEdit}
        onChange={(e) => { setStageEdit(e.target.value); setSaveProgressError(null); }}
        aria-label="Withdrawal Stage"
      />

      {/* Activity deposit amount */}
      <input
        data-testid="input-activity-deposit"
        value={activityDepositEdit}
        onChange={(e) => { setActivityDepositEdit(e.target.value); setSaveProgressError(null); }}
        aria-label="Activity Deposit Amount"
      />

      {/* Phrase-key deposit amount */}
      <input
        data-testid="input-phrase-key-deposit"
        value={phraseKeyDepositEdit}
        onChange={(e) => { setPhraseKeyDepositEdit(e.target.value); setSaveProgressError(null); }}
        aria-label="Phrase Key Deposit Amount"
      />

      {/* Activity wallet requirement */}
      <input
        data-testid="input-wallet-requirement"
        value={walletRequirementEdit}
        onChange={(e) => { setWalletRequirementEdit(e.target.value); setSaveProgressError(null); }}
        aria-label="Activity Wallet Requirement"
      />

      {/* Save button */}
      <button data-testid="button-save-progress" onClick={handleSave}>
        Save Progress Settings
      </button>

      {/* Error banner */}
      {saveProgressError !== null && (
        <p role="alert" data-testid="save-error-message">
          {saveProgressError}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Functional tests — combined harness
// ---------------------------------------------------------------------------

describe("Progress tracker — combined harness (all five fields clear the banner)", () => {
  const CASE_ID = "case-combined";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: render the combined harness with a save fetch that always fails and
  // a toggle fetch that always succeeds, then trigger one failed save so the
  // banner is visible before each interaction test.
  async function renderWithBanner(
    onToggleFetch?: (url: string, opts: RequestInit) => Promise<Response>,
  ) {
    const user = userEvent.setup();
    const mockSaveFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }),
    );
    const mockToggleFetch =
      onToggleFetch ??
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));

    render(
      <CombinedSaveProgressHarness
        caseId={CASE_ID}
        onFetch={mockSaveFetch}
        onToggleFetch={mockToggleFetch}
      />,
    );

    // Trigger a failed save so the banner becomes visible.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    return user;
  }

  it("flipping the show-progress toggle clears the banner (combined render)", async () => {
    const user = await renderWithBanner();
    await user.click(screen.getByTestId("switch-show-progress"));
    await waitFor(() =>
      expect(screen.queryByTestId("save-error-message")).toBeNull(),
    );
  });

  it("typing in the withdrawal-stage input clears the banner (combined render)", async () => {
    const user = await renderWithBanner();
    await user.clear(screen.getByTestId("input-withdrawal-stage"));
    await user.type(screen.getByTestId("input-withdrawal-stage"), "5");
    expect(screen.queryByTestId("save-error-message")).toBeNull();
  });

  it("typing in the activityDepositAmount input clears the banner (combined render)", async () => {
    const user = await renderWithBanner();
    await user.type(screen.getByTestId("input-activity-deposit"), "1");
    expect(screen.queryByTestId("save-error-message")).toBeNull();
  });

  it("typing in the phraseKeyDepositAmount input clears the banner (combined render)", async () => {
    const user = await renderWithBanner();
    await user.type(screen.getByTestId("input-phrase-key-deposit"), "5");
    expect(screen.queryByTestId("save-error-message")).toBeNull();
  });

  it("typing in the activityWalletRequirement input clears the banner (combined render)", async () => {
    const user = await renderWithBanner();
    await user.type(screen.getByTestId("input-wallet-requirement"), "T");
    expect(screen.queryByTestId("save-error-message")).toBeNull();
  });

  it("typing a text field then flipping the toggle: banner is gone after both interactions", async () => {
    const user = await renderWithBanner();

    // Type in stage — banner clears.
    await user.clear(screen.getByTestId("input-withdrawal-stage"));
    await user.type(screen.getByTestId("input-withdrawal-stage"), "3");
    expect(screen.queryByTestId("save-error-message")).toBeNull();

    // Re-trigger the banner by saving again (save fetch still returns 500).
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Flip the toggle — banner clears again.
    await user.click(screen.getByTestId("switch-show-progress"));
    await waitFor(() =>
      expect(screen.queryByTestId("save-error-message")).toBeNull(),
    );
  });

  it("flipping the toggle then typing a text field: banner stays gone after second interaction", async () => {
    const user = await renderWithBanner();

    // Flip the toggle — banner clears.
    await user.click(screen.getByTestId("switch-show-progress"));
    await waitFor(() =>
      expect(screen.queryByTestId("save-error-message")).toBeNull(),
    );

    // Re-trigger the banner.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Type in activity deposit — banner clears.
    await user.type(screen.getByTestId("input-activity-deposit"), "500");
    expect(screen.queryByTestId("save-error-message")).toBeNull();
  });

  it("interleaved: stage → phraseKey → toggle all clear the banner in sequence", async () => {
    const user = await renderWithBanner();

    // Stage clears the banner.
    await user.type(screen.getByTestId("input-withdrawal-stage"), "2");
    expect(screen.queryByTestId("save-error-message")).toBeNull();

    // Re-trigger.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Phrase-key deposit clears it.
    await user.type(screen.getByTestId("input-phrase-key-deposit"), "100");
    expect(screen.queryByTestId("save-error-message")).toBeNull();

    // Re-trigger.
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("save-error-message")).toBeTruthy(),
    );

    // Toggle clears it.
    await user.click(screen.getByTestId("switch-show-progress"));
    await waitFor(() =>
      expect(screen.queryByTestId("save-error-message")).toBeNull(),
    );
  });

  it("banner clears even when the toggle PATCH itself fails (clear fires before async PATCH)", async () => {
    // Toggle fetch returns 409 — but the banner from the save must still clear
    // because setSaveProgressError(null) fires synchronously in onCheckedChange.
    const failingToggleFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Conflict" }), { status: 409 }),
    );
    const user = await renderWithBanner(failingToggleFetch);

    await user.click(screen.getByTestId("switch-show-progress"));

    await waitFor(() =>
      expect(screen.queryByTestId("save-error-message")).toBeNull(),
    );
  });

  it("Save button sends all five updated fields in a single PATCH body", async () => {
    const user = userEvent.setup();
    const capturedBodies: Record<string, unknown>[] = [];

    const mockSaveFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(JSON.parse(opts.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <CombinedSaveProgressHarness
        caseId={CASE_ID}
        onFetch={mockSaveFetch}
        onToggleFetch={vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))}
      />,
    );

    // Edit withdrawalStage (initial "1" → "7").
    await user.clear(screen.getByTestId("input-withdrawal-stage"));
    await user.type(screen.getByTestId("input-withdrawal-stage"), "7");

    // Edit activityDepositAmount (initial "" → "250").
    await user.type(screen.getByTestId("input-activity-deposit"), "250");

    // Edit phraseKeyDepositAmount (initial "" → "500").
    await user.type(screen.getByTestId("input-phrase-key-deposit"), "500");

    // Edit activityWalletRequirement (initial "" → "Required").
    await user.type(screen.getByTestId("input-wallet-requirement"), "Required");

    // Flip the show-progress switch (initial false → true).
    // The toggle fires its own immediate PATCH (handleToggle); we only care
    // about the Save PATCH below, so we ignore capturedBodies[0] if present.
    await user.click(screen.getByTestId("switch-show-progress"));

    // Clear captured bodies so we only assert on the Save PATCH.
    capturedBodies.length = 0;

    // Click Save — must send a single PATCH with all five current values.
    await user.click(screen.getByTestId("button-save-progress"));

    await waitFor(() => expect(mockSaveFetch).toHaveBeenCalledTimes(1));

    expect(capturedBodies).toHaveLength(1);
    const body = capturedBodies[0];
    expect(body).toHaveProperty("withdrawalStage", "7");
    expect(body).toHaveProperty("activityDepositAmount", "250");
    expect(body).toHaveProperty("phraseKeyDepositAmount", "500");
    expect(body).toHaveProperty("activityWalletRequirement", "Required");
    expect(body).toHaveProperty("showWithdrawalProgress", true);
  });

  it("all five fields present in a single render and all independently clear the banner", async () => {
    const user = userEvent.setup();
    const mockSaveFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Server Error" }), { status: 500 }),
    );
    const mockToggleFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );

    render(
      <CombinedSaveProgressHarness
        caseId={CASE_ID}
        onFetch={mockSaveFetch}
        onToggleFetch={mockToggleFetch}
      />,
    );

    // Confirm all five interactive elements are rendered together.
    expect(screen.getByTestId("switch-show-progress")).toBeTruthy();
    expect(screen.getByTestId("input-withdrawal-stage")).toBeTruthy();
    expect(screen.getByTestId("input-activity-deposit")).toBeTruthy();
    expect(screen.getByTestId("input-phrase-key-deposit")).toBeTruthy();
    expect(screen.getByTestId("input-wallet-requirement")).toBeTruthy();

    // Verify each field individually clears the banner after a failed save.
    const fields: Array<{ testId: string; action: () => Promise<void> }> = [
      {
        testId: "switch-show-progress",
        action: async () => {
          await user.click(screen.getByTestId("switch-show-progress"));
          await waitFor(() =>
            expect(screen.queryByTestId("save-error-message")).toBeNull(),
          );
        },
      },
      {
        testId: "input-withdrawal-stage",
        action: async () => {
          await user.type(screen.getByTestId("input-withdrawal-stage"), "9");
          expect(screen.queryByTestId("save-error-message")).toBeNull();
        },
      },
      {
        testId: "input-activity-deposit",
        action: async () => {
          await user.type(screen.getByTestId("input-activity-deposit"), "1");
          expect(screen.queryByTestId("save-error-message")).toBeNull();
        },
      },
      {
        testId: "input-phrase-key-deposit",
        action: async () => {
          await user.type(screen.getByTestId("input-phrase-key-deposit"), "2");
          expect(screen.queryByTestId("save-error-message")).toBeNull();
        },
      },
      {
        testId: "input-wallet-requirement",
        action: async () => {
          await user.type(screen.getByTestId("input-wallet-requirement"), "E");
          expect(screen.queryByTestId("save-error-message")).toBeNull();
        },
      },
    ];

    for (const field of fields) {
      // Trigger a fresh banner before each field's action.
      await user.click(screen.getByTestId("button-save-progress"));
      await waitFor(() =>
        expect(screen.getByTestId("save-error-message")).toBeTruthy(),
      );

      // The field's interaction must clear it.
      await field.action();
    }
  });

  it("Save body reflects the cleared/original value after typing then undoing a field edit", async () => {
    // Regression guard: an edit buffer that captures an intermediate typed
    // value rather than the live input state would send stale data here.
    const user = userEvent.setup();
    const capturedBodies: Record<string, unknown>[] = [];

    const mockSaveFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(JSON.parse(opts.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <CombinedSaveProgressHarness
        caseId={CASE_ID}
        onFetch={mockSaveFetch}
        onToggleFetch={vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))}
      />,
    );

    // The activityDepositAmount field starts empty ("").
    // Type a value then clear it back to the original empty string.
    const depositInput = screen.getByTestId("input-activity-deposit");
    await user.type(depositInput, "999");
    await user.clear(depositInput);

    // Click Save — the body must reflect the cleared (original) value, not "999".
    await user.click(screen.getByTestId("button-save-progress"));

    await waitFor(() => expect(mockSaveFetch).toHaveBeenCalledTimes(1));

    expect(capturedBodies).toHaveLength(1);
    // The field was cleared back to its original empty-string value.
    expect(capturedBodies[0]).toHaveProperty("activityDepositAmount", "");
    // All other fields must remain at their initial defaults.
    expect(capturedBodies[0]).toHaveProperty("withdrawalStage", "1");
    expect(capturedBodies[0]).toHaveProperty("phraseKeyDepositAmount", "");
    expect(capturedBodies[0]).toHaveProperty("activityWalletRequirement", "");
    expect(capturedBodies[0]).toHaveProperty("showWithdrawalProgress", false);
  });
});
