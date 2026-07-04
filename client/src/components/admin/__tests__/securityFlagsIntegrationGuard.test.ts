// @vitest-environment node
//
// Structural guard: every describe("Security flags integration — banner-*")
// block in securityFlagsIntegration.test.tsx MUST contain an it() / test()
// whose title includes "authToken is null".
//
// This file exists so that adding a new banner describe block without the
// null-token test produces an immediate CI failure rather than relying on
// code-review discipline alone.  The guard is self-maintaining: it discovers
// banner blocks dynamically, so no manual update is required when a new
// banner is added.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = readFileSync(
  resolve(__dirname, "securityFlagsIntegration.test.tsx"),
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
 * Find every `describe("Security flags integration — banner-*", ...)` call in
 * `src` and return the name + body text of each block.
 */
function extractBannerDescribeBlocks(
  src: string,
): { name: string; body: string }[] {
  const pattern =
    /describe\("(Security flags integration \u2014 banner-[^"]+)"/g;
  const results: { name: string; body: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(src)) !== null) {
    const name = match[1];
    // Find the opening brace of the callback passed to describe(...)
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
  // Match it( or test( followed by a quoted title string.
  // Handles both double and single quoted titles.
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

describe("Structural guard — securityFlagsIntegration.test.tsx banner blocks", () => {
  const bannerBlocks = extractBannerDescribeBlocks(SRC);

  it("finds at least one banner-* describe block (parser sanity check)", () => {
    expect(bannerBlocks.length).toBeGreaterThan(0);
  });

  for (const block of bannerBlocks) {
    it(`"${block.name}" has an it() whose title includes "authToken is null"`, () => {
      const titles = extractTestTitles(block.body);
      const hasNullTokenTest = titles.some((t) => t.includes("authToken is null"));

      expect(
        hasNullTokenTest,
        [
          `describe block "${block.name}" is missing an it() / test() whose title`,
          `contains "authToken is null".`,
          ``,
          `Add a test like:`,
          `  it("does not render banners when authToken is null (no fetch is attempted)", async () => {`,
          `    await act(async () => { render(<SecurityFlagsHarness authToken={null} />); });`,
          `    expect(global.fetch).not.toHaveBeenCalled();`,
          `    expect(screen.queryByTestId("banner-<your-banner-id>")).toBeNull();`,
          `  });`,
          ``,
          `Existing test titles found in this block:`,
          titles.map((t) => `  - "${t}"`).join("\n"),
        ].join("\n"),
      ).toBe(true);
    });
  }
});
