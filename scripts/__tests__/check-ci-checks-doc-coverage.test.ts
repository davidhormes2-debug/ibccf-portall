/**
 * Verifies that every required CI check listed in scripts/required-checks.txt
 * is mentioned by name somewhere in docs/ci-checks.md.
 *
 * WHY THIS TEST EXISTS
 * The full per-check descriptions live in docs/ci-checks.md; replit.md only
 * keeps a compact grouped list of check names. The existing "Replit.md
 * Annotation Coverage" guard only verifies replit.md, so a new required check
 * could be added to CI (and to the compact list in replit.md) without ever
 * getting a real description added to docs/ci-checks.md, and nothing would
 * catch the drift. This test closes that gap.
 *
 * WHAT THIS TEST DOES
 * 1. Reads scripts/required-checks.txt and extracts every non-blank check name.
 * 2. Reads docs/ci-checks.md verbatim.
 * 3. For each check name, asserts that it appears as a substring of docs/ci-checks.md.
 *
 * FIXING A FAILURE
 * When this test fails, find the missing check name in the output, then add
 * a bullet to docs/ci-checks.md describing what the check verifies, its
 * test/script file, and how to run or reproduce it locally (match the style
 * of adjacent entries).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKS_FILE = path.join(REPO_ROOT, "scripts", "required-checks.txt");
const CI_CHECKS_DOC = path.join(REPO_ROOT, "docs", "ci-checks.md");

const requiredChecks = fs
  .readFileSync(CHECKS_FILE, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const ciChecksDocContent = fs.readFileSync(CI_CHECKS_DOC, "utf8");

describe("docs/ci-checks.md coverage", () => {
  it("docs/ci-checks.md mentions every check listed in required-checks.txt", () => {
    const missing = requiredChecks.filter(
      (check) => !ciChecksDocContent.includes(check),
    );

    if (missing.length > 0) {
      const formatted = missing.map((c) => `  • ${c}`).join("\n");
      throw new Error(
        `${missing.length} required check(s) are not documented in docs/ci-checks.md:\n\n` +
          formatted +
          "\n\n" +
          "Fix: add a bullet to docs/ci-checks.md for each missing check name, describing\n" +
          "what it verifies, its test/script file, and how to run or reproduce it locally\n" +
          "(match the style of adjacent entries).\n" +
          "The check name must appear verbatim as a substring of docs/ci-checks.md.",
      );
    }
  });

  it("required-checks.txt is non-empty", () => {
    expect(requiredChecks.length).toBeGreaterThan(0);
  });
});
