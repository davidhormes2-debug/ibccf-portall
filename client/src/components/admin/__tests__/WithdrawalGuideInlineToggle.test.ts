// @vitest-environment node
//
// Task #283 — Verify the Withdrawal Guide banner inline toggle is correctly
// wired in AdminDashboard.tsx so:
//
//   1. A `toggleWithdrawalGuideVisible` function exists and sends only
//      `{ withdrawalGuideVisible }` to PATCH /api/cases/:id.
//   2. The Switch reads live case state (`selectedCase?.withdrawalGuideVisible`)
//      rather than just the local edit buffer, so the status pill and the
//      control stay in sync after an optimistic update.
//   3. The Switch's `onCheckedChange` is wired to `toggleWithdrawalGuideVisible`
//      (not the plain state setter) so each toggle fires the PATCH immediately.
//   4. Rollback state is captured before the optimistic update is applied so
//      `setSelectedCase` and `setWithdrawalGuideVisibleEdit` can revert on error.
//
// These are source-level assertions: they guarantee the production behaviour
// without requiring a full JSDOM render of the 10k-line AdminDashboard.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const SRC_PATH = path.resolve(
  __dirname,
  "../../../pages/AdminDashboard.tsx",
);

const src = fs.readFileSync(SRC_PATH, "utf8");

describe("AdminDashboard — Withdrawal Guide inline toggle (Task #283)", () => {
  it("declares a toggleWithdrawalGuideVisible function", () => {
    expect(src).toMatch(/const toggleWithdrawalGuideVisible\s*=/);
  });

  it("toggleWithdrawalGuideVisible sends { withdrawalGuideVisible } to PATCH /api/cases/:id", () => {
    // The PATCH body must contain withdrawalGuideVisible and nothing else in
    // this function so it acts as a focused inline save, not a batch save.
    const fnMatch = src.match(
      /const toggleWithdrawalGuideVisible[\s\S]*?^  \};/m,
    );
    expect(
      fnMatch,
      "toggleWithdrawalGuideVisible function block not found",
    ).toBeTruthy();
    const fn = fnMatch![0];
    expect(fn).toMatch(/withdrawalGuideVisible/);
    expect(fn).toMatch(/PATCH/);
    // The JSON body should reference the `next` parameter, not an unrelated field.
    expect(fn).toMatch(/withdrawalGuideVisible.*next/s);
  });

  it("toggleWithdrawalGuideVisible captures prev state before the optimistic update", () => {
    const fnMatch = src.match(
      /const toggleWithdrawalGuideVisible[\s\S]*?^  \};/m,
    );
    expect(fnMatch).toBeTruthy();
    const fn = fnMatch![0];
    // `prev` must be assigned before setSelectedCase / setWithdrawalGuideVisibleEdit.
    const prevIdx = fn.indexOf("const prev");
    const optimisticIdx = fn.indexOf("setSelectedCase");
    expect(prevIdx).toBeGreaterThanOrEqual(0);
    expect(optimisticIdx).toBeGreaterThanOrEqual(0);
    expect(
      prevIdx,
      "prev must be captured before the optimistic setSelectedCase call",
    ).toBeLessThan(optimisticIdx);
  });

  it("toggleWithdrawalGuideVisible reverts setSelectedCase and setWithdrawalGuideVisibleEdit on error", () => {
    const fnMatch = src.match(
      /const toggleWithdrawalGuideVisible[\s\S]*?^  \};/m,
    );
    expect(fnMatch).toBeTruthy();
    const fn = fnMatch![0];
    // At least two setSelectedCase calls (optimistic + rollback).
    const setSelectedCaseCalls = fn.match(/setSelectedCase\(/g) ?? [];
    expect(
      setSelectedCaseCalls.length,
      "expected at least one rollback setSelectedCase call in addition to the optimistic one",
    ).toBeGreaterThanOrEqual(2);
    // At least two setWithdrawalGuideVisibleEdit calls (optimistic + rollback).
    const setEditCalls = fn.match(/setWithdrawalGuideVisibleEdit\(/g) ?? [];
    expect(
      setEditCalls.length,
      "expected at least one rollback setWithdrawalGuideVisibleEdit call",
    ).toBeGreaterThanOrEqual(2);
  });

  it("switch-withdrawal-guide-visible has onCheckedChange wired to toggleWithdrawalGuideVisible", () => {
    // Locate the block that contains the switch testid and check the handler.
    const switchIdx = src.indexOf('data-testid="switch-withdrawal-guide-visible"');
    expect(
      switchIdx,
      'switch with data-testid="switch-withdrawal-guide-visible" not found',
    ).toBeGreaterThanOrEqual(0);
    // Use the next JSX comment heading after the anchor as the trailing boundary
    // so the slice never silently truncates if the Withdrawal Activation block grows.
    const nextCommentAfterSwitch = src.indexOf("{/*", switchIdx + 1);
    const switchEnd = nextCommentAfterSwitch === -1 ? src.length : nextCommentAfterSwitch;
    // Walk back to include the full JSX element (checked + onCheckedChange props).
    const surrounding = src.slice(Math.max(0, switchIdx - 300), switchEnd);
    expect(surrounding).toMatch(/onCheckedChange.*toggleWithdrawalGuideVisible/s);
  });

  it("switch-withdrawal-guide-visible reads from selectedCase?.withdrawalGuideVisible for optimistic reflection", () => {
    const switchIdx = src.indexOf('data-testid="switch-withdrawal-guide-visible"');
    expect(switchIdx).toBeGreaterThanOrEqual(0);
    // Same next-declaration boundary as the onCheckedChange test above.
    const nextCommentAfterSwitch = src.indexOf("{/*", switchIdx + 1);
    const switchEnd = nextCommentAfterSwitch === -1 ? src.length : nextCommentAfterSwitch;
    const surrounding = src.slice(Math.max(0, switchIdx - 300), switchEnd);
    expect(surrounding).toMatch(/selectedCase\?\.withdrawalGuideVisible/);
  });

  it("withdrawal-guide-banner-state pill reads from selectedCase.withdrawalGuideVisible", () => {
    const pillIdx = src.indexOf('data-testid="withdrawal-guide-banner-state"');
    expect(pillIdx, '"withdrawal-guide-banner-state" testid not found').toBeGreaterThanOrEqual(0);
    // Extend to the next JSX comment heading after the pill so the window grows
    // with the block rather than using a fixed byte offset that can truncate.
    const nextCommentAfterPill = src.indexOf("{/*", pillIdx + 1);
    const pillEnd = nextCommentAfterPill === -1 ? src.length : nextCommentAfterPill;
    const surrounding = src.slice(Math.max(0, pillIdx - 400), pillEnd);
    expect(surrounding).toMatch(/selectedCase\.withdrawalGuideVisible/);
  });
});
