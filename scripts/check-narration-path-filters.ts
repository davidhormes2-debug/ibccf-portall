#!/usr/bin/env tsx
// scripts/check-narration-path-filters.ts
//
// Verifies that the path-filter PATTERN in the `narration-fresh` job of
// .github/workflows/narration-fresh.yml covers every source file that
// scripts/check-narration-fresh.ts actually depends on.
//
// The canonical file list is derived from listNarrationSourceFiles()
// (narrationFingerprint.ts) so the check stays accurate automatically when
// new files are added to the narration pipeline — without requiring a manual
// edit to this script.
//
// Usage:
//   npx tsx scripts/check-narration-path-filters.ts          # normal check
//   npx tsx scripts/check-narration-path-filters.ts --self-test
//   npm run check:narration-path-filters
//
// Exit codes:
//   0 — all canonical source files are covered by the path-filter PATTERN
//   1 — one or more source files are missing from the PATTERN
//
// When this fails:
//   Add the missing file (or its parent directory prefix) to PATTERN in the
//   `narration-fresh` job in .github/workflows/narration-fresh.yml.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  REPO_ROOT,
  listNarrationSourceFiles,
} from "../client/src/components/portal/withdrawal-video/narrationFingerprint";

const SELF_TEST = process.argv.includes("--self-test");

const WORKFLOW = join(REPO_ROOT, ".github/workflows/narration-fresh.yml");

// ---------------------------------------------------------------------------
// 1. Verify the workflow file exists
// ---------------------------------------------------------------------------
if (!existsSync(WORKFLOW)) {
  console.error(`FAIL: ${WORKFLOW} does not exist.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Extract the PATTERN from the `narration-fresh` job.
//    The file contains two PATTERN= lines (one per job); we want the one
//    inside the `narration-fresh` job specifically.
// ---------------------------------------------------------------------------
const workflowLines = readFileSync(WORKFLOW, "utf8").split("\n");

let inNarrationFreshJob = false;
let pattern: string | null = null;

for (const line of workflowLines) {
  // Top-level job keys are indented with exactly two spaces.
  if (/^  narration-fresh:/.test(line)) {
    inNarrationFreshJob = true;
  } else if (/^  [a-zA-Z]/.test(line) && !/^  narration-fresh:/.test(line)) {
    inNarrationFreshJob = false;
  }

  if (inNarrationFreshJob) {
    const m = line.match(/PATTERN='([^']+)'/);
    if (m) {
      pattern = m[1];
      break;
    }
  }
}

if (!pattern) {
  console.error(
    `FAIL: Could not extract PATTERN from the narration-fresh job in\n` +
      `      ${WORKFLOW}\n` +
      `      Expected a line matching:  PATTERN='...'  inside the narration-fresh job.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Build the canonical file list from authoritative sources.
//
//    a) listNarrationSourceFiles() — the machine-readable source of truth for
//       files whose content determines the spoken narration scripts.  If a new
//       source file is added there without a corresponding PATTERN entry, this
//       check automatically fails.
//
//    b) A small set of fixed files that are always relevant to the check but
//       not returned by listNarrationSourceFiles():
//         - the checker script itself
//         - the manifest that stores committed fingerprints
// ---------------------------------------------------------------------------
const narrationSources = listNarrationSourceFiles();

const fixedFiles = [
  join(REPO_ROOT, "scripts", "check-narration-fresh.ts"),
  join(
    REPO_ROOT,
    "client",
    "public",
    "withdrawal-video",
    "narration",
    "narration.manifest.json",
  ),
];

// Deduplicate by resolved path.
const allAbsPaths = [...new Set([...narrationSources, ...fixedFiles])];

// Convert to POSIX-relative paths (what the PATTERN is matched against).
const allRelPaths = allAbsPaths.map((p) =>
  relative(REPO_ROOT, p).split("\\").join("/"),
);

// ---------------------------------------------------------------------------
// 4. Self-test mode — prove the check can detect a missing file.
//    Uses a deliberately narrow pattern that covers only the checker script
//    itself; every other canonical file should be flagged as uncovered.
// ---------------------------------------------------------------------------
if (SELF_TEST) {
  const narrowPattern = "^scripts/check-narration-fresh\\.ts$";
  const narrowRe = new RegExp(narrowPattern);
  const uncovered = allRelPaths.filter((p) => !narrowRe.test(p));

  if (uncovered.length === 0) {
    console.error(
      "FAIL: Self-test expected some files to be uncovered by the narrow pattern,\n" +
        "      but all files matched.  The check logic may not be working correctly.",
    );
    process.exit(1);
  }

  console.log(
    `Self-test OK — narrow pattern correctly left ${uncovered.length} file(s) uncovered:`,
  );
  for (const f of uncovered) {
    console.log(`  ${f}`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 5. Test each canonical file against the extracted PATTERN.
// ---------------------------------------------------------------------------
console.log("Extracted narration-fresh PATTERN:");
console.log(`  ${pattern}`);
console.log("");

const re = new RegExp(pattern);
let failed = false;

for (const relPath of allRelPaths) {
  if (re.test(relPath)) {
    console.log(`  OK    ${relPath}`);
  } else {
    console.error(`  FAIL  ${relPath}`);
    console.error(`        → Not matched by the narration-fresh PATTERN.`);
    console.error(`          Add it (or its parent directory) to PATTERN in:`);
    console.error(`          .github/workflows/narration-fresh.yml`);
    failed = true;
  }
}

// ---------------------------------------------------------------------------
// 6. Report
// ---------------------------------------------------------------------------
console.log("");
if (failed) {
  console.error("Narration path-filter sync FAILED — see errors above.");
  console.error("");
  console.error(
    "When a source file is absent from PATTERN, the 'Narration Freshness'\n" +
      "CI job silently skips on PRs that only touch that file, creating a\n" +
      "false-green that lets stale audio ship undetected.",
  );
  process.exit(1);
} else {
  console.log(
    `Narration path-filter sync OK — all ${allRelPaths.length} canonical source files are covered.`,
  );
}
