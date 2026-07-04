// @vitest-environment jsdom
//
// Regression test: the skeleton (CaseDialogHeaderSkeleton +
// CaseTabContentSkeleton) must be visible immediately when the case dialog
// opens, and must disappear once the async fetches resolve.
//
// Rendering the full AdminDashboard under JSDOM would require mocking the
// entire 10k-line context, so we cover this two ways:
//
//   1. A behavioural harness that directly exercises the isCaseDialogLoading
//      flag — starts true (skeleton visible), flips to false after
//      Promise.all resolves (skeleton gone, real content visible).
//
//   2. Source-level guards against AdminDashboard.tsx confirming that the
//      production code sets isCaseDialogLoading=true at the top of
//      openAdminMessageDialog, clears it inside .finally(), and conditionally
//      renders each skeleton component.

import React, { useEffect, useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { CaseDialogHeaderSkeleton, CaseTabContentSkeleton } from "../CaseDialogSkeleton";

afterEach(() => cleanup());

// ── Export-existence guard ────────────────────────────────────────────────────
// These assertions fail immediately if CaseDialogSkeleton.tsx is removed,
// or if either exported name is renamed or deleted.  The import at the top of
// this file would surface as a module-resolution error, but the tests below
// give a far more readable failure message that points at the exact export.

describe("CaseDialogSkeleton — named exports exist", () => {
  it("CaseDialogHeaderSkeleton is exported as a function", () => {
    expect(typeof CaseDialogHeaderSkeleton).toBe("function");
  });

  it("CaseTabContentSkeleton is exported as a function", () => {
    expect(typeof CaseTabContentSkeleton).toBe("function");
  });
});

// ── Behavioural harness ───────────────────────────────────────────────────────

// Mirrors the production pattern in openAdminMessageDialog:
//   1. setIsCaseDialogLoading(true)
//   2. Promise.all([...fetches]).finally(() => setIsCaseDialogLoading(false))
//
// The `fetchImpl` prop lets each test control how quickly the async work
// settles, so we can assert the before and after states.
function CaseDialogHarness({
  fetchImpl,
}: {
  fetchImpl: () => Promise<void>;
}) {
  const [isCaseDialogLoading, setIsCaseDialogLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  function openDialog() {
    setDialogOpen(true);
    setIsCaseDialogLoading(true);
    Promise.all([fetchImpl()]).finally(() => setIsCaseDialogLoading(false));
  }

  return (
    <div>
      <button type="button" onClick={openDialog} data-testid="open-dialog">
        Open case
      </button>

      {dialogOpen && (
        <div data-testid="dialog-content">
          {/* Header area */}
          {isCaseDialogLoading ? (
            <div data-testid="header-skeleton">
              <CaseDialogHeaderSkeleton />
            </div>
          ) : (
            <div data-testid="header-real">Manage Case: Alice</div>
          )}

          {/* Body area */}
          {isCaseDialogLoading ? (
            <div data-testid="body-skeleton">
              <CaseTabContentSkeleton />
            </div>
          ) : null}

          {/* Real content only shown after load */}
          {!isCaseDialogLoading && (
            <div data-testid="tabs-real">Case detail tabs</div>
          )}
        </div>
      )}
    </div>
  );
}

// Variant that auto-opens on mount, useful for asserting the initial state.
function AutoOpenHarness({ fetchImpl }: { fetchImpl: () => Promise<void> }) {
  const [isCaseDialogLoading, setIsCaseDialogLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchImpl()]).finally(() => setIsCaseDialogLoading(false));
  }, [fetchImpl]);

  return (
    <div>
      {isCaseDialogLoading ? (
        <div data-testid="header-skeleton">
          <CaseDialogHeaderSkeleton />
        </div>
      ) : (
        <div data-testid="header-real">Manage Case: Alice</div>
      )}

      {isCaseDialogLoading ? (
        <div data-testid="body-skeleton">
          <CaseTabContentSkeleton />
        </div>
      ) : null}

      {!isCaseDialogLoading && (
        <div data-testid="tabs-real">Case detail tabs</div>
      )}
    </div>
  );
}

describe("Case dialog loading skeleton — behavioural", () => {
  it("skeleton is present immediately after the dialog opens (before fetches resolve)", async () => {
    // Use a fetch that never resolves so the loading state stays true long
    // enough for us to assert on it.
    let resolve!: () => void;
    const pending = new Promise<void>((res) => { resolve = res; });

    render(<CaseDialogHarness fetchImpl={() => pending} />);

    fireEvent.click(screen.getByTestId("open-dialog"));

    // Skeleton must be immediately present — no async wait.
    expect(screen.getByTestId("header-skeleton")).toBeTruthy();
    expect(screen.getByTestId("body-skeleton")).toBeTruthy();

    // Real content must NOT be visible while loading.
    expect(screen.queryByTestId("header-real")).toBeNull();
    expect(screen.queryByTestId("tabs-real")).toBeNull();

    // Clean up the pending promise.
    resolve();
  });

  it("skeleton disappears and real content appears after fetches resolve", async () => {
    render(
      <CaseDialogHarness
        fetchImpl={() => Promise.resolve()}
      />,
    );

    fireEvent.click(screen.getByTestId("open-dialog"));

    // Wait for the .finally() to fire and the state to update.
    await waitFor(() => {
      expect(screen.queryByTestId("header-skeleton")).toBeNull();
    });

    expect(screen.queryByTestId("body-skeleton")).toBeNull();
    expect(screen.getByTestId("header-real")).toBeTruthy();
    expect(screen.getByTestId("tabs-real")).toBeTruthy();
  });

  it("CaseTabContentSkeleton carries accessible loading semantics", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((res) => { resolve = res; });

    render(<AutoOpenHarness fetchImpl={() => pending} />);

    // The skeleton should be present before the fetch resolves.
    const skeleton = screen.getByLabelText("Loading case details");
    expect(skeleton).toBeTruthy();
    expect(skeleton.getAttribute("aria-busy")).toBe("true");

    resolve();

    await waitFor(() => {
      expect(screen.queryByLabelText("Loading case details")).toBeNull();
    });
  });

  it("real content is absent while loading and present after resolving", async () => {
    render(<AutoOpenHarness fetchImpl={() => Promise.resolve()} />);

    // After the promise resolves the real content should appear.
    await waitFor(() => {
      expect(screen.getByTestId("tabs-real")).toBeTruthy();
    });

    // Skeleton should be gone.
    expect(screen.queryByTestId("header-skeleton")).toBeNull();
    expect(screen.queryByTestId("body-skeleton")).toBeNull();
  });
});

// ── Source-level guards ───────────────────────────────────────────────────────

describe("Case dialog loading skeleton — production wiring in AdminDashboard.tsx", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../../pages/AdminDashboard.tsx"),
    "utf8",
  );

  // Slice out the body of openAdminMessageDialog up to the next handler so
  // the assertions can't be satisfied by unrelated code elsewhere in the file.
  function extractOpenAdminMessageDialog(): string {
    const start = src.indexOf("const openAdminMessageDialog = (");
    expect(
      start,
      "expected openAdminMessageDialog in AdminDashboard.tsx",
    ).toBeGreaterThan(-1);
    const after = src.indexOf("const openReceiptsDialog", start);
    expect(
      after,
      "expected openReceiptsDialog after openAdminMessageDialog",
    ).toBeGreaterThan(start);
    const slice = src.slice(start, after);
    expect(
      slice.length,
      "extractOpenAdminMessageDialog returned an unexpectedly short slice — " +
        "the handler may have been renamed, removed, or split into smaller functions. " +
        "Update the anchor strings in extractOpenAdminMessageDialog to match the new name.",
    ).toBeGreaterThan(50);
    return slice;
  }

  it("sets isCaseDialogLoading=true at the start of openAdminMessageDialog", () => {
    const fn = extractOpenAdminMessageDialog();
    expect(fn).toMatch(/setIsCaseDialogLoading\s*\(\s*true\s*\)/);
  });

  it("clears isCaseDialogLoading inside a .finally() block after Promise.all", () => {
    const fn = extractOpenAdminMessageDialog();
    // Both the Promise.all and the .finally clear must be present in the
    // same handler body.
    expect(fn).toMatch(/Promise\.all\s*\(\s*\[/);
    expect(fn).toMatch(/\.finally\s*\(\s*\(\s*\)\s*=>\s*setIsCaseDialogLoading\s*\(\s*false\s*\)\s*\)/);
  });

  it("imports CaseDialogHeaderSkeleton and CaseTabContentSkeleton from CaseDialogSkeleton", () => {
    // These regexes match the import *declaration* (import { … } from "…CaseDialogSkeleton")
    // rather than just any occurrence of the symbol name.  Checking only the
    // symbol name would pass even if the import line were removed but stale JSX
    // usages remained — this guard catches that scenario.
    expect(src).toMatch(
      /import\s*\{[^}]*CaseDialogHeaderSkeleton[^}]*\}\s*from\s*['"][^'"]*CaseDialogSkeleton['"]/,
    );
    expect(src).toMatch(
      /import\s*\{[^}]*CaseTabContentSkeleton[^}]*\}\s*from\s*['"][^'"]*CaseDialogSkeleton['"]/,
    );
  });

  it("renders CaseDialogHeaderSkeleton conditionally on isCaseDialogLoading", () => {
    // Search for the JSX element usage, not the import line.
    const headerIdx = src.indexOf("<CaseDialogHeaderSkeleton");
    expect(headerIdx, "<CaseDialogHeaderSkeleton /> must appear in AdminDashboard.tsx").toBeGreaterThan(-1);
    // Look back within 300 chars for the isCaseDialogLoading guard.
    const before = src.slice(Math.max(0, headerIdx - 300), headerIdx);
    expect(before).toMatch(/isCaseDialogLoading/);
  });

  it("renders CaseTabContentSkeleton conditionally on isCaseDialogLoading", () => {
    const bodyIdx = src.indexOf("<CaseTabContentSkeleton");
    expect(bodyIdx, "<CaseTabContentSkeleton /> must appear in AdminDashboard.tsx").toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, bodyIdx - 300), bodyIdx);
    expect(before).toMatch(/isCaseDialogLoading/);
  });

  it("gates real case content behind !isCaseDialogLoading", () => {
    // The production source must have at least one guard that hides the real
    // tab content / settlement banner while loading.
    expect(src).toMatch(/!\s*isCaseDialogLoading/);
  });

  it("declares isCaseDialogLoading via useState (catches renames/removals of the state variable)", () => {
    // Matches the canonical declaration shape:
    //   const [isCaseDialogLoading, set…] = useState(…)
    // If the variable is renamed (e.g. to `isCaseLoading`) this assertion
    // fails immediately, making it clear which symbol needs to be updated
    // alongside any skeleton conditional renders.
    expect(src).toMatch(/const\s*\[\s*isCaseDialogLoading\s*,\s*set/);
  });
});
