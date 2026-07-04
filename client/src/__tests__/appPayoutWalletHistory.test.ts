import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";

// ============================================================================
// Source-assertion: App.tsx triggers payout-wallet history pruning on every
// page load
//
// WHY THIS TEST EXISTS
// `prunePayoutWalletHistory` is exported from `lib/payoutWalletHistory.ts` and
// called at module scope in App.tsx so stale/oversized payout-wallet history
// entries are trimmed on every fresh page load without any user interaction.
// Nothing prevents a future refactor from silently removing the call site in
// App.tsx — or moving it inside a function/hook so it no longer runs
// unconditionally on module load.
//
// This test asserts two structural invariants via AST inspection:
//   1. App.tsx imports `prunePayoutWalletHistory` from `@/lib/payoutWalletHistory`.
//   2. App.tsx calls `prunePayoutWalletHistory()` as a top-level
//      ExpressionStatement in Program.body (not inside any function or hook),
//      so it runs on every fresh page load.
// ============================================================================

const APP_TSX = path.resolve(__dirname, "../App.tsx");

function isTopLevelCall(
  body: TSESTree.ProgramStatement[],
  fnName: string,
): boolean {
  return body.some(
    (node) =>
      node.type === "ExpressionStatement" &&
      node.expression.type === "CallExpression" &&
      node.expression.callee.type === "Identifier" &&
      node.expression.callee.name === fnName,
  );
}

describe("App.tsx payout-wallet history prune source assertion", () => {
  it("imports prunePayoutWalletHistory from @/lib/payoutWalletHistory", () => {
    const source = fs.readFileSync(APP_TSX, "utf-8");

    const hasImport =
      /import\s*\{[^}]*prunePayoutWalletHistory[^}]*\}\s*from\s*['"]@\/lib\/payoutWalletHistory['"]/.test(
        source,
      );

    expect(
      hasImport,
      "App.tsx must import prunePayoutWalletHistory from '@/lib/payoutWalletHistory'. " +
        "The call at module scope depends on this import — do not remove it.",
    ).toBe(true);
  });

  it("calls prunePayoutWalletHistory() at module scope (top-level Program.body)", () => {
    const source = fs.readFileSync(APP_TSX, "utf-8");

    const ast = parse(source, { jsx: true, range: false, loc: false });

    const hasTopLevelCall = isTopLevelCall(ast.body, "prunePayoutWalletHistory");

    expect(
      hasTopLevelCall,
      "App.tsx must call prunePayoutWalletHistory() as a top-level statement " +
        "(directly in Program.body, not inside a function or hook) so the " +
        "prune runs unconditionally on every fresh page load. " +
        "Do not move this call into a useEffect, component body, or any other function.",
    ).toBe(true);
  });
});
