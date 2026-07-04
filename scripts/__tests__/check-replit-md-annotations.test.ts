/**
 * Verifies that every required CI check listed in scripts/required-checks.txt
 * is mentioned by name somewhere in replit.md.
 *
 * WHY THIS TEST EXISTS
 * When a developer adds a new entry to required-checks.txt they must also
 * document it in replit.md so that the project README stays accurate.
 * Without this guard the two files can silently drift: the check is enforced
 * in CI but no documentation explains what it does or how to run it.
 *
 * WHAT THIS TEST DOES
 * 1. Reads scripts/required-checks.txt and extracts every non-blank check name.
 * 2. Reads replit.md verbatim.
 * 3. For each check name, asserts that it appears as a substring of replit.md.
 *
 * FIXING A FAILURE
 * When this test fails, find the missing check name in the output, then add
 * a bullet to the appropriate section of replit.md describing what the check
 * does and how to trigger or suppress it (match the style of adjacent entries).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKS_FILE = path.join(REPO_ROOT, "scripts", "required-checks.txt");
const REPLIT_MD = path.join(REPO_ROOT, "replit.md");

const requiredChecks = fs
  .readFileSync(CHECKS_FILE, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const replitMdContent = fs.readFileSync(REPLIT_MD, "utf8");

describe("replit.md annotation coverage", () => {
  it("replit.md mentions every check listed in required-checks.txt", () => {
    const missing = requiredChecks.filter(
      (check) => !replitMdContent.includes(check),
    );

    if (missing.length > 0) {
      const formatted = missing.map((c) => `  • ${c}`).join("\n");
      throw new Error(
        `${missing.length} required check(s) are not documented in replit.md:\n\n` +
          formatted +
          "\n\n" +
          "Fix: add a bullet to replit.md for each missing check name, describing\n" +
          "what it does and how to run it (match the style of adjacent entries).\n" +
          "The check name must appear verbatim as a substring of replit.md.",
      );
    }
  });

  it("required-checks.txt is non-empty", () => {
    expect(requiredChecks.length).toBeGreaterThan(0);
  });
});
