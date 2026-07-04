// @vitest-environment node
//
// Source-assertion: AdminDashboard.tsx search-query clear behaviour
//
// WHY THIS TEST EXISTS
// The Cases tab search box is cleared automatically when the admin manually
// switches sections via nav click or Tabs trigger (handleManualTabChange).
// Programmatic setActiveTab calls (badge clicks, CasesTab navigation) do NOT
// clear the search, and the ?caseId= deep-link on page load pre-fills it
// without clearing any existing query.
//
// Nothing prevents a future refactor from:
//   - removing the setSearchQuery("") call from handleManualTabChange
//   - wiring a badge callback to handleManualTabChange instead of setActiveTab
//   - rewiring the Tabs/AdminGroupedNav away from handleManualTabChange
//
// This test asserts the structural invariants via source inspection so any of
// the above regressions will be caught before they ship.
//
// Contracts verified:
//   1. handleManualTabChange calls setSearchQuery("") — manual nav clears search.
//   2. Tabs onValueChange is wired to handleManualTabChange — Tabs trigger clears.
//   3. AdminGroupedNav setActiveTab prop is wired to handleManualTabChange — nav
//      item clicks go through the manual handler and therefore clear the search.
//   4. Badge-click callbacks (stamp-duty, pending-doc, supporting-doc,
//      withdrawal, refund-claim, reactivation) call setActiveTab directly and
//      do NOT call handleManualTabChange, so search is NOT cleared.
//   5. The ?caseId= deep-link useEffect sets searchQuery to the caseId value
//      (pre-fills) rather than clearing it.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const DASHBOARD_SRC = path.resolve(
  __dirname,
  "../../../pages/AdminDashboard.tsx",
);

function readSource(): string {
  return fs.readFileSync(DASHBOARD_SRC, "utf-8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the body of a named const arrow function declared at the top level
 * of the component (a single `useCallback` or inline arrow, ending at the
 * closing `}, [...]` or `}` brace of the declaration).
 *
 * Returns the slice of source from the function declaration up to and
 * including the first `}, [` or `};\n` that closes the declaration — enough
 * to inspect the function body without leaking into unrelated code.
 */
function extractFunctionBody(source: string, name: string): string {
  const declarationPattern = new RegExp(
    `const\\s+${name}\\s*=\\s*useCallback\\s*\\(`,
  );
  const idx = source.search(declarationPattern);
  if (idx === -1) {
    // Also try plain arrow (not wrapped in useCallback)
    const arrowPattern = new RegExp(`const\\s+${name}\\s*=\\s*\\(`);
    const idx2 = source.search(arrowPattern);
    if (idx2 === -1) return "";
    return source.slice(idx2, idx2 + 600);
  }
  return source.slice(idx, idx + 600);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AdminDashboard.tsx — search-query clear behaviour", () => {
  it("handleManualTabChange calls setSearchQuery(\"\") before switching tab", () => {
    const src = readSource();
    const body = extractFunctionBody(src, "handleManualTabChange");

    expect(
      body,
      "handleManualTabChange must exist in AdminDashboard.tsx. " +
        "The function is responsible for clearing the case search box " +
        "whenever the admin manually switches sections.",
    ).not.toBe("");

    expect(
      body,
      'handleManualTabChange must call setSearchQuery("") to clear the ' +
        "Cases tab search box when the admin manually switches sections. " +
        "Without this call a stale deep-link query persists across unrelated tabs.",
    ).toMatch(/setSearchQuery\s*\(\s*["']{2}\s*\)/);

    expect(
      body,
      "handleManualTabChange must call setActiveTab(next) to complete the " +
        "tab switch after clearing the search.",
    ).toMatch(/setActiveTab\s*\(\s*next\s*\)/);
  });

  it("Tabs onValueChange is wired to handleManualTabChange", () => {
    const src = readSource();

    expect(
      src,
      "The Tabs component must use onValueChange={handleManualTabChange} so " +
        "every tab-trigger click goes through the manual handler and clears " +
        "the search. Wiring to setActiveTab directly would bypass the clear.",
    ).toMatch(/onValueChange\s*=\s*\{handleManualTabChange\}/);
  });

  it("AdminGroupedNav setActiveTab prop is wired to handleManualTabChange", () => {
    const src = readSource();

    expect(
      src,
      "AdminGroupedNav must receive setActiveTab={handleManualTabChange} so " +
        "nav-item clicks go through the manual handler and clear the search. " +
        "Wiring to setActiveTab directly would bypass the clear.",
    ).toMatch(/setActiveTab\s*=\s*\{handleManualTabChange\}/);
  });

  it("badge-click callbacks call setActiveTab directly (not handleManualTabChange)", () => {
    const src = readSource();

    // The six badge callbacks use setActiveTab directly so they do NOT clear
    // the search. Verify each one by checking its prop name appears alongside
    // setActiveTab but not handleManualTabChange within the same JSX block.
    const badgeProps = [
      "onStampDutyBadgeClick",
      "onPendingDocBadgeClick",
      "onSupportingDocBadgeClick",
      "onWithdrawalBadgeClick",
      "onRefundClaimBadgeClick",
      "onReactivationBadgeClick",
    ];

    for (const prop of badgeProps) {
      const propIdx = src.indexOf(prop);
      expect(
        propIdx,
        `${prop} prop must exist in AdminDashboard.tsx — badge-click callbacks ` +
          "must be wired so they navigate without clearing the search.",
      ).toBeGreaterThan(-1);

      // Inspect the 300 chars following the prop declaration — enough to see
      // the callback body without leaking into unrelated JSX.
      const vicinity = src.slice(propIdx, propIdx + 300);

      expect(
        vicinity,
        `${prop} callback must call setActiveTab (directly) to navigate ` +
          "without clearing the search. The badge click should not go through " +
          "handleManualTabChange which would clear the Cases tab search box.",
      ).toMatch(/setActiveTab\s*\(/);

      expect(
        vicinity,
        `${prop} callback must NOT call handleManualTabChange. Badge-click ` +
          "navigation should never clear the search box. Route the call through " +
          "setActiveTab directly instead of the manual handler.",
      ).not.toMatch(/handleManualTabChange/);
    }
  });

  it("?caseId= deep-link useEffect opens the case directly when loaded, else pre-fills searchQuery", () => {
    const src = readSource();

    // Find the useEffect that reads the ?caseId= query param. When the case
    // is already loaded in memory it opens the detail dialog directly; only
    // when it is not found (once the case list has loaded) does it fall back
    // to pre-filling the search box (never to an empty-string clear).
    const deepLinkIdx = src.indexOf("caseId");
    expect(deepLinkIdx, "?caseId= handling must exist in AdminDashboard.tsx").toBeGreaterThan(-1);

    const paramReadIdx = src.indexOf('params.get("caseId")');
    expect(
      paramReadIdx,
      'The ?caseId= deep-link useEffect must read the param with params.get("caseId"). ' +
        "If the parameter name changed, update this assertion and replit.md.",
    ).toBeGreaterThan(-1);

    // Inspect enough source to cover the complete useEffect body
    const effectBlock = src.slice(paramReadIdx, paramReadIdx + 700);

    expect(
      effectBlock,
      "The ?caseId= deep-link useEffect must look up the case in the in-memory " +
        "`cases` array and call openAdminMessageDialog directly when found, for " +
        "a true one-click open (Task #2361).",
    ).toMatch(/openAdminMessageDialog\s*\(\s*target\s*\)/);

    expect(
      effectBlock,
      "The ?caseId= deep-link useEffect must fall back to setSearchQuery(caseId) " +
        "(pre-fill) only when the case isn't found in memory. It must NOT call " +
        'setSearchQuery("") which would clear the pre-fill.',
    ).toMatch(/setSearchQuery\s*\(\s*caseId\s*\)/);

    // The pre-fill must not be an empty-string clear
    const emptyStringClear = effectBlock.match(/setSearchQuery\s*\(\s*["']{2}\s*\)/);
    expect(
      emptyStringClear,
      'The ?caseId= deep-link useEffect must not call setSearchQuery(""). ' +
        "The effect is meant to pre-fill the search box, not clear it.",
    ).toBeNull();
  });

  it("window.__adminOpenCase opens the case directly when loaded, else pre-fills searchQuery (not handleManualTabChange)", () => {
    const src = readSource();

    const helperIdx = src.indexOf("__adminOpenCase = (accessCode");
    expect(
      helperIdx,
      "window.__adminOpenCase must exist in AdminDashboard.tsx — it is used by " +
        "CommunicationsTab and other sibling tabs to jump directly to a case.",
    ).toBeGreaterThan(-1);

    // Inspect enough source to cover the complete helper body (up to its
    // closing `};`).
    const helperBlock = src.slice(helperIdx, helperIdx + 400);

    expect(
      helperBlock,
      "__adminOpenCase must call setActiveTab(\"cases\") directly to switch to " +
        "the Cases tab. It must NOT go through handleManualTabChange, which " +
        "would clear the search box it is about to pre-fill.",
    ).toMatch(/setActiveTab\s*\(\s*["']cases["']\s*\)/);

    expect(
      helperBlock,
      "__adminOpenCase must NOT call handleManualTabChange. Routing through " +
        "the manual handler would clear searchQuery immediately after this " +
        "helper sets it, silently breaking the cross-tab deep-link.",
    ).not.toMatch(/handleManualTabChange/);

    expect(
      helperBlock,
      "__adminOpenCase must look up the case in the in-memory `cases` array " +
        "and call openAdminMessageDialog directly when found, for a true " +
        "one-click open (Task #2361).",
    ).toMatch(/openAdminMessageDialog\s*\(\s*target\s*\)/);

    expect(
      helperBlock,
      "__adminOpenCase must fall back to setSearchQuery(accessCode) to " +
        "pre-fill the Cases tab search box only when the case isn't found " +
        "in memory.",
    ).toMatch(/setSearchQuery\s*\(\s*accessCode\s*\)/);

    const emptyStringClear = helperBlock.match(/setSearchQuery\s*\(\s*["']{2}\s*\)/);
    expect(
      emptyStringClear,
      'window.__adminOpenCase must not call setSearchQuery(""). It is meant ' +
        "to pre-fill the search box with accessCode, not clear it.",
    ).toBeNull();
  });
});
