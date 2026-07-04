import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";

// ============================================================================
// Source-assertion: App.tsx triggers wallet-history cleanup on every page load
//
// WHY THIS TEST EXISTS
// `cleanupStaleWalletHistory` was extracted from an inline IIFE in App.tsx into
// the testable `lib/walletHistoryCleanup.ts` module. The unit tests for that
// module cover the cleanup logic itself, but nothing prevents a future refactor
// from silently removing the call site in App.tsx — or moving it inside a
// function/hook so it no longer runs unconditionally on module load.
//
// This test asserts two structural invariants via AST inspection:
//   1. App.tsx imports `cleanupStaleWalletHistory` from `@/lib/walletHistoryCleanup`.
//   2. App.tsx calls `cleanupStaleWalletHistory()` as a top-level
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

describe("App.tsx wallet-history cleanup source assertion", () => {
  it("imports cleanupStaleWalletHistory from @/lib/walletHistoryCleanup", () => {
    const source = fs.readFileSync(APP_TSX, "utf-8");

    const hasImport =
      /import\s*\{[^}]*cleanupStaleWalletHistory[^}]*\}\s*from\s*['"]@\/lib\/walletHistoryCleanup['"]/.test(
        source,
      );

    expect(
      hasImport,
      "App.tsx must import cleanupStaleWalletHistory from '@/lib/walletHistoryCleanup'. " +
        "The call at module scope depends on this import — do not remove it.",
    ).toBe(true);
  });

  it("calls cleanupStaleWalletHistory() at module scope (top-level Program.body)", () => {
    const source = fs.readFileSync(APP_TSX, "utf-8");

    const ast = parse(source, { jsx: true, range: false, loc: false });

    const hasTopLevelCall = isTopLevelCall(ast.body, "cleanupStaleWalletHistory");

    expect(
      hasTopLevelCall,
      "App.tsx must call cleanupStaleWalletHistory() as a top-level statement " +
        "(directly in Program.body, not inside a function or hook) so the " +
        "cleanup runs unconditionally on every fresh page load. " +
        "Do not move this call into a useEffect, component body, or any other function.",
    ).toBe(true);
  });
});
