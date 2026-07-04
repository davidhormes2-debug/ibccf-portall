#!/usr/bin/env node
// update-expected-paths.mjs — patches EXPECTED_RELATIVE_PATHS in the pinned
// source-file test to match what listSourceFiles() currently returns.
//
// Run via:  npm run fingerprint:update-expected
//
// When to run:
//   - After adding a new scene file (e.g. Scene6.tsx) to shared/video/scenes/
//   - After renaming or removing an existing source file tracked by listSourceFiles()
//   - The unit-test suite will fail with a path-set mismatch until you run this
//
// What it does:
//   1. Calls listSourceFiles() to get the current live set of paths.
//   2. Converts each path to a REPO_ROOT-relative forward-slash string.
//   3. Finds the EXPECTED_RELATIVE_PATHS array literal in the test file and
//      replaces it with the fresh set (sorted, one entry per line).
//   4. Writes the patched test file back to disk and prints a summary.

import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEST_FILE = join(
  SCRIPT_DIR,
  "__tests__",
  "recordingFingerprint.test.ts",
);

// Dynamic import so this script always uses the live implementation.
const { listSourceFiles, REPO_ROOT } = await import(
  join(SCRIPT_DIR, "recordingFingerprint.mjs")
);

const currentPaths = listSourceFiles()
  .map((f) => relative(REPO_ROOT, f).split("\\").join("/"))
  .sort();

const source = readFileSync(TEST_FILE, "utf8");

// Match the EXPECTED_RELATIVE_PATHS array literal. The regex captures:
//   group 1 — everything up to and including the opening [
//   group 2 — the array body (existing entries, possibly multiline)
//   group 3 — the closing ].sort()
const ARRAY_RE =
  /(const EXPECTED_RELATIVE_PATHS\s*=\s*\[)([\s\S]*?)(\]\.sort\(\))/;

const match = ARRAY_RE.exec(source);
if (!match) {
  console.error(
    "❌  Could not find EXPECTED_RELATIVE_PATHS array in:\n   " + TEST_FILE,
  );
  console.error(
    "   The script expects the constant to look like:\n" +
      '   const EXPECTED_RELATIVE_PATHS = [\n     "...",\n   ].sort();',
  );
  process.exit(1);
}

const indent = "      ";
const newBody =
  "\n" + currentPaths.map((p) => `${indent}"${p}",`).join("\n") + "\n    ";

const patched = source.replace(ARRAY_RE, `$1${newBody}$3`);

if (patched === source) {
  console.log("✅  EXPECTED_RELATIVE_PATHS is already up to date — no changes written.");
  process.exit(0);
}

writeFileSync(TEST_FILE, patched, "utf8");

console.log(`✅  Patched EXPECTED_RELATIVE_PATHS in:\n   ${TEST_FILE}`);
console.log(`\n   New set (${currentPaths.length} paths):`);
for (const p of currentPaths) {
  console.log(`     ${p}`);
}
console.log(
  "\n   Commit both the source-file change AND the updated test together.",
);
