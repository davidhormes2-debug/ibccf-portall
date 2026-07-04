#!/usr/bin/env node
// scripts/check-recordings-path-filters.mjs
//
// Verifies that the path-filter PATTERN in the `recordings-fresh` job of
// .github/workflows/narration-fresh.yml covers every source file that
// video/scripts/check-recordings-fresh.mjs and
// video/scripts/recordingFingerprint.mjs actually depend on.
//
// The canonical file list is derived from listSourceFiles() and the narration
// directory constants in recordingFingerprint.mjs, so the check stays accurate
// automatically when new scene files are added — without requiring a manual
// edit to this script.
//
// Usage:
//   node scripts/check-recordings-path-filters.mjs          # normal check
//   node scripts/check-recordings-path-filters.mjs --self-test
//   npm run check:recordings-path-filters
//
// Exit codes:
//   0 — all canonical source files are covered by the path-filter PATTERN
//   1 — one or more source files are missing from the PATTERN
//
// When this fails:
//   Add the missing file (or its parent directory prefix) to PATTERN in the
//   `recordings-fresh` job in .github/workflows/narration-fresh.yml.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  REPO_ROOT,
  MANIFEST_PATH,
  listSourceFiles,
} from "../video/scripts/recordingFingerprint.mjs";

const SELF_TEST = process.argv.includes("--self-test");

const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "narration-fresh.yml");

// ---------------------------------------------------------------------------
// 1. Verify the workflow file exists
// ---------------------------------------------------------------------------
if (!existsSync(WORKFLOW)) {
  console.error(`FAIL: ${WORKFLOW} does not exist.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Extract the PATTERN from the `recordings-fresh` job.
//    The file contains two PATTERN= lines (one per job); we want the one
//    inside the `recordings-fresh` job specifically.
// ---------------------------------------------------------------------------
const workflowLines = readFileSync(WORKFLOW, "utf8").split("\n");

let inRecordingsFreshJob = false;
let pattern = null;

for (const line of workflowLines) {
  // Top-level job keys are indented with exactly two spaces.
  if (/^  recordings-fresh:/.test(line)) {
    inRecordingsFreshJob = true;
  } else if (/^  [a-zA-Z]/.test(line) && !/^  recordings-fresh:/.test(line)) {
    inRecordingsFreshJob = false;
  }

  if (inRecordingsFreshJob) {
    const m = line.match(/PATTERN='([^']+)'/);
    if (m) {
      pattern = m[1];
      break;
    }
  }
}

if (!pattern) {
  console.error(
    `FAIL: Could not extract PATTERN from the recordings-fresh job in\n` +
      `      ${WORKFLOW}\n` +
      `      Expected a line matching:  PATTERN='...'  inside the recordings-fresh job.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Build the canonical file list from authoritative sources.
//
//    a) listSourceFiles() — the machine-readable source of truth for files
//       whose content determines the recorded tutorial MP4s.  A new scene
//       added to shared/video/scenes/ is covered automatically.
//
//    b) A small set of fixed files that are always relevant to the check but
//       not returned by listSourceFiles():
//         - the checker script itself
//         - the fingerprint helper
//         - the manifest that stores committed fingerprints
//         - the narration directory (mp3s affect the narration fingerprint)
// ---------------------------------------------------------------------------
const sourcesFromFingerprint = listSourceFiles();

// The narration base lives at client/public/withdrawal-video/narration/.
// We don't enumerate individual mp3 files — we just verify the directory
// prefix is present in PATTERN so any narration change triggers the job.
const NARRATION_SENTINEL = join(
  REPO_ROOT,
  "client",
  "public",
  "withdrawal-video",
  "narration",
  "_sentinel",
);

const fixedFiles = [
  join(REPO_ROOT, "video", "scripts", "check-recordings-fresh.mjs"),
  join(REPO_ROOT, "video", "scripts", "recordingFingerprint.mjs"),
  MANIFEST_PATH,
  NARRATION_SENTINEL,
];

// Deduplicate by resolved path.
const allAbsPaths = [...new Set([...sourcesFromFingerprint, ...fixedFiles])];

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
  const narrowPattern = "^video/scripts/check-recordings-fresh\\.mjs$";
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
console.log("Extracted recordings-fresh PATTERN:");
console.log(`  ${pattern}`);
console.log("");

const re = new RegExp(pattern);
let failed = false;

for (const relPath of allRelPaths) {
  if (re.test(relPath)) {
    console.log(`  OK    ${relPath}`);
  } else {
    console.error(`  FAIL  ${relPath}`);
    console.error(`        → Not matched by the recordings-fresh PATTERN.`);
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
  console.error("Recordings path-filter sync FAILED — see errors above.");
  console.error("");
  console.error(
    "When a source file is absent from PATTERN, the 'Tutorial Recording\n" +
      "Clips Freshness' CI job silently skips on PRs that only touch that\n" +
      "file, creating a false-green that lets stale MP4s ship undetected.",
  );
  process.exit(1);
} else {
  console.log(
    `Recordings path-filter sync OK — all ${allRelPaths.length} canonical source files are covered.`,
  );
}
