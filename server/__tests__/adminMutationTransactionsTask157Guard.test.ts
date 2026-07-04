// @vitest-environment node
//
// Structural guard: every describe("Task #157 — *") block in
// adminMutationTransactionsTask157.test.ts MUST contain:
//   1. An it() / test() whose title includes "rolls back"
//   2. An it() / test() whose title includes "commits"
//
// This ensures each transaction block exercises both the rollback path
// (audit-write failure) and the happy path (mutation + audit committed
// together).  Adding a new describe block without both tests produces an
// immediate CI failure instead of relying on code-review discipline alone.
// The guard is self-maintaining: it discovers blocks dynamically, so no
// manual update is required when a new transaction block is added.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = readFileSync(
  resolve(__dirname, "adminMutationTransactionsTask157.test.ts"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk `src` starting at `openBraceIdx` (the index of an opening `{`) and
 * return the index of the corresponding closing `}`, accounting for nesting.
 */
function matchingCloseBrace(src: string, openBraceIdx: number): number {
  let depth = 1;
  let i = openBraceIdx + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  return i - 1;
}

/**
 * Find every `describe("Task #157 — *", ...)` call in `src` and return the
 * name + body text of each block.
 */
function extractTask157DescribeBlocks(
  src: string,
): { name: string; body: string }[] {
  const pattern = /describe\("(Task #157 \u2014 [^"]+)"/g;
  const results: { name: string; body: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(src)) !== null) {
    const name = match[1];
    const openBrace = src.indexOf("{", match.index + match[0].length);
    if (openBrace === -1) continue;

    const closeBrace = matchingCloseBrace(src, openBrace);
    const body = src.slice(openBrace + 1, closeBrace);
    results.push({ name, body });
  }

  return results;
}

/**
 * Extract every it() / test() title string from a describe block body.
 * Matches: it("...", or it('...', — single-line titles in double or single quotes.
 */
function extractTestTitles(blockBody: string): string[] {
  const titles: string[] = [];
  const pattern = /\b(?:it|test)\(\s*(?:"([^"\\]*)"|'([^'\\]*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(blockBody)) !== null) {
    titles.push(match[1] ?? match[2]);
  }
  return titles;
}

// ---------------------------------------------------------------------------
// Guard tests
// ---------------------------------------------------------------------------

describe("Structural guard — adminMutationTransactionsTask157.test.ts blocks", () => {
  const blocks = extractTask157DescribeBlocks(SRC);

  it("finds at least one Task #157 describe block (parser sanity check)", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  for (const block of blocks) {
    it(`"${block.name}" has an it() whose title includes "rolls back"`, () => {
      const titles = extractTestTitles(block.body);
      const hasRollbackTest = titles.some((t) => t.includes("rolls back"));

      expect(
        hasRollbackTest,
        [
          `describe block "${block.name}" is missing an it() / test() whose title`,
          `contains "rolls back".`,
          ``,
          `Add a test like:`,
          `  it("rolls back the <setting> change when the audit write fails", async () => {`,
          `    auditShouldThrow = true;`,
          `    const res = await request(buildApp()).put("...").set("Authorization", "Bearer t").send({...});`,
          `    expect(res.status).toBe(503);`,
          `    expect(committed.<field>).toBeUndefined();`,
          `  });`,
          ``,
          `Existing test titles found in this block:`,
          titles.map((t) => `  - "${t}"`).join("\n"),
        ].join("\n"),
      ).toBe(true);
    });

    it(`"${block.name}" has an it() whose title includes "commits"`, () => {
      const titles = extractTestTitles(block.body);
      const hasCommitTest = titles.some((t) => t.includes("commits"));

      expect(
        hasCommitTest,
        [
          `describe block "${block.name}" is missing an it() / test() whose title`,
          `contains "commits".`,
          ``,
          `Add a test like:`,
          `  it("commits the <setting> change and audit on the happy path", async () => {`,
          `    const res = await request(buildApp()).put("...").set("Authorization", "Bearer t").send({...});`,
          `    expect(res.status).toBe(200);`,
          `    expect(committed.<field>).toBeDefined();`,
          `    expect(auditLogs.some((a) => a.action === "<action>")).toBe(true);`,
          `  });`,
          ``,
          `Existing test titles found in this block:`,
          titles.map((t) => `  - "${t}"`).join("\n"),
        ].join("\n"),
      ).toBe(true);
    });
  }
});
