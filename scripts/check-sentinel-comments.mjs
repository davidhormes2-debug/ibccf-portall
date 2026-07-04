#!/usr/bin/env node
// scripts/check-sentinel-comments.mjs
//
// Verifies bidirectionally that every sentinel comment string used as a test
// anchor in any *.test.ts file is:
//   a) still present verbatim in the target SOURCE file, and
//   b) still referenced in the GUARD TEST file.
//
// Sentinels are AUTO-DISCOVERED by scanning test files for the pattern:
//   someVar.indexOf("// SENTINEL_NAME")
// where someVar is mapped back to its fs.readFileSync() source via variable
// declarations in the same test file.  No manual registry is required — adding
// a new sentinel to a test file is sufficient for it to be guarded here.
//
// Usage:
//   node scripts/check-sentinel-comments.mjs          # normal check
//   npm run check:sentinel-comments
//
// Exit codes:
//   0 — every discovered sentinel is present in its target source AND test file
//   1 — one or more sentinels are absent; details printed to stderr

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// File discovery — find all *.test.ts files under the repo
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".config", ".local"]);

function findTestFiles(dir, results = []) {
  if (!existsSync(dir)) return results;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      findTestFiles(full, results);
    } else if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Parse a test file and extract sentinel entries
//
// Returns an array of:
//   { sentinel, sourceFile, testFile }
//
// Strategy:
//   1. Build a map of variable name → absolute source file path by scanning
//      fs.readFileSync( path.resolve(__dirname, ...) ) declarations.
//   2. Scan for VARNAME.indexOf("// SENTINEL_NAME") usages.
//   3. Resolve each usage to its source file via the variable map.
// ---------------------------------------------------------------------------
function extractSentinels(testFilePath) {
  const src = readFileSync(testFilePath, "utf8");
  const testDir = dirname(testFilePath);

  // Flatten whitespace within parentheses for simpler regex matching of
  // multi-line readFileSync calls.  Replace any run of whitespace (including
  // newlines) between commas/parens with a single space.
  const flat = src.replace(/\(\s+/g, "( ").replace(/\s+\)/g, " )").replace(/,\s+/g, ", ");

  // --- Step 1: variable → source file ---
  // Matches: const/let/var VAR = fs.readFileSync( path.resolve( __dirname, "seg1", "seg2" ), "utf8" )
  const varFileMap = new Map(); // varName → absPath

  // Match readFileSync declarations (variable name + path.resolve segments).
  // We capture everything inside the path.resolve(...) call excluding __dirname.
  const rsfRe =
    /(?:const|let|var)\s+(\w+)\s*=\s*fs\.readFileSync\(\s*path\.resolve\(\s*__dirname\s*((?:\s*,\s*["'][^"']*["'])+)\s*\)\s*,\s*["']utf8["']\s*,?\s*\)/g;

  for (const m of flat.matchAll(rsfRe)) {
    const varName = m[1];
    const segStr = m[2]; // e.g. `, "../services/CaseService.ts"`
    // Extract individual string literals from the segment string
    const segments = [];
    const segRe = /["']([^"']*)["']/g;
    for (const s of segStr.matchAll(segRe)) {
      segments.push(s[1]);
    }
    const absPath = resolve(testDir, ...segments);
    varFileMap.set(varName, absPath);
  }

  if (varFileMap.size === 0) return [];

  // --- Step 2a: indexOf usages → sentinel entries ---
  const entries = [];
  const seenKeys = new Set();

  // Matches: someVar.indexOf("// SENTINEL_NAME") or .indexOf('// SENTINEL_NAME')
  const idxRe = /(\w+)\.indexOf\(["'](\/\/ [A-Z][A-Z0-9_]*)["']\)/g;

  for (const m of src.matchAll(idxRe)) {
    const varName = m[1];
    const sentinel = m[2];
    const sourceFile = varFileMap.get(varName);
    if (!sourceFile) continue; // not a tracked source variable

    const key = `${sentinel}|${sourceFile}|${testFilePath}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    entries.push({ sentinel, sourceFile, testFile: testFilePath });
  }

  // --- Step 2b: extractBlock / extractEffectBlock call-site pattern ---
  //
  // Some .test.tsx files define helper functions like:
  //   function extractBlock(sentinel) { const start = CONTENT_SRC.indexOf(sentinel) ... }
  // and call them with bare sentinel names (no "// " prefix):
  //   extractBlock("NEWSLETTER_SELECT_ALL_CHECKBOX_START")
  //
  // We:
  //  (i)  Detect which source variable each extract* function closes over by
  //       scanning its body for `VARNAME.indexOf(`.
  //  (ii) Scan all extractBlock/extractEffectBlock call sites for sentinel args.
  //  (iii) Emit sentinel entries pointing at the resolved source file.

  // (i) Map: fnName → source variable name (from function body)
  const extractFnSourceVar = new Map(); // "extractBlock" | "extractEffectBlock" → varName

  // Match: function extract[Effect]Block(...) { ... VARNAME.indexOf( ...
  // We use a non-greedy scan up to the first `indexOf(` inside the function.
  const fnBodyRe =
    /function\s+(extract(?:Effect)?Block)\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{[^}]*?(\w+)\.indexOf\(/gs;
  for (const m of src.matchAll(fnBodyRe)) {
    const fnName = m[1];
    const varName = m[2];
    if (varFileMap.has(varName)) {
      extractFnSourceVar.set(fnName, varName);
    }
  }

  // (ii) Scan call sites: extractBlock("SENTINEL_NAME") — sentinel has NO "// " prefix here
  const extractCallRe = /\b(extract(?:Effect)?Block)\(["']([A-Z][A-Z0-9_]*)["']\)/g;
  for (const m of src.matchAll(extractCallRe)) {
    const fnName = m[1];
    const sentinel = m[2]; // bare sentinel name, no "//" prefix

    // Determine the source file from the function's closed-over variable
    let targetPaths;
    const closedVar = extractFnSourceVar.get(fnName);
    if (closedVar && varFileMap.has(closedVar)) {
      targetPaths = [varFileMap.get(closedVar)];
    } else {
      // Fallback: attribute to every source file loaded in this test file
      targetPaths = [...varFileMap.values()];
    }

    for (const absPath of targetPaths) {
      const key = `${sentinel}|${absPath}|${testFilePath}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      entries.push({ sentinel, sourceFile: absPath, testFile: testFilePath });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const testFiles = [
  ...findTestFiles(resolve(REPO_ROOT, "server")),
  ...findTestFiles(resolve(REPO_ROOT, "client")),
];

// Collect all sentinel entries across all test files
const allEntries = [];
const globalSeen = new Set();

for (const tf of testFiles) {
  for (const entry of extractSentinels(tf)) {
    const key = `${entry.sentinel}|${entry.sourceFile}|${entry.testFile}`;
    if (globalSeen.has(key)) continue;
    globalSeen.add(key);
    allEntries.push(entry);
  }
}

// ---------------------------------------------------------------------------
// Self-check: guard against silent auto-discovery failures
//
// If the regex patterns fail to match refactored test files (e.g. a developer
// stores the source in a non-const variable, uses a different readFileSync
// pattern, or splits the call across multiple assignments), zero or fewer
// sentinels are discovered and the bidirectional check below silently passes
// even though real sentinels are no longer being guarded.
//
// SENTINEL_MIN_COUNT is the floor below which discovery is treated as broken.
// Raise it whenever a new sentinel is intentionally added; lower it (or remove
// the guard) only when sentinels are intentionally removed.
// ---------------------------------------------------------------------------
const SENTINEL_MIN_COUNT = 16;

if (allEntries.length < SENTINEL_MIN_COUNT) {
  if (allEntries.length === 0) {
    console.error("FAIL  No sentinel anchors discovered across any test file.");
  } else {
    console.error(
      `FAIL  Only ${allEntries.length} sentinel(s) auto-discovered; expected at least ${SENTINEL_MIN_COUNT}.`,
    );
  }
  console.error(
    "      This usually means a test file was refactored in a way that breaks the auto-discovery",
  );
  console.error(
    "      regex (e.g. non-const variable, different readFileSync pattern, or split assignment).",
  );
  console.error(
    "      Fix the test file so the pattern is recognised again, or update SENTINEL_MIN_COUNT in",
  );
  console.error(
    "      scripts/check-sentinel-comments.mjs if sentinels were intentionally added or removed.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Bidirectional verification
// ---------------------------------------------------------------------------
function readFile(absPath) {
  if (!existsSync(absPath)) return { ok: false, src: null };
  return { ok: true, src: readFileSync(absPath, "utf8") };
}

let failed = false;

for (const { sentinel, sourceFile, testFile } of allEntries) {
  const relSource = relative(REPO_ROOT, sourceFile);
  const relTest = relative(REPO_ROOT, testFile);

  const source = readFile(sourceFile);
  const test = readFile(testFile);

  let ok = true;

  // --- a) verify sentinel is present in the source file ---
  if (!source.ok) {
    console.error(`FAIL  ${sentinel}`);
    console.error(`      Source file not found: ${relSource}`);
    ok = false;
  } else if (!source.src.includes(sentinel)) {
    console.error(`FAIL  ${sentinel}`);
    console.error(`      Sentinel is ABSENT from source file: ${relSource}`);
    console.error(
      `      Restore the comment line exactly as shown above in ${relSource}.`,
    );
    ok = false;
  }

  // --- b) verify sentinel is referenced in the guard test file ---
  if (!test.ok) {
    console.error(`FAIL  ${sentinel}`);
    console.error(`      Guard test file not found: ${relTest}`);
    ok = false;
  } else if (!test.src.includes(sentinel)) {
    console.error(`FAIL  ${sentinel}`);
    console.error(`      Sentinel is ABSENT from guard test file: ${relTest}`);
    console.error(
      `      The test no longer declares this anchor — restore the indexOf("${sentinel}") assertion.`,
    );
    ok = false;
  }

  if (ok) {
    console.log(`  OK  ${sentinel}`);
    console.log(`      source: ${relSource}`);
    console.log(`      test:   ${relTest}`);
  } else {
    failed = true;
  }
}

console.log("");
if (failed) {
  console.error(
    "Sentinel comment check FAILED — one or more anchors are missing from their source or guard test files.",
  );
  console.error(
    "These comments are load-bearing test anchors.  Renaming or removing them — in either",
  );
  console.error(
    "the source file or the guard test — causes associated tests to fail with a cryptic",
  );
  console.error(
    "'sentinel missing' message.  Restore the exact comment string in both places.",
  );
  process.exit(1);
} else {
  console.log(
    `Sentinel comment check OK — all ${allEntries.length} auto-discovered sentinels are present in both their source files and guard tests.`,
  );
}
