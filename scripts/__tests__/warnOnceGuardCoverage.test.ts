import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ============================================================================
// Source-assertion: every Vitest include root has a warnOnce teardown guard
//
// WHY THIS TEST EXISTS
// There are three warnOnce teardown guard files, each covering one cluster of
// Vitest include roots declared in vitest.config.ts:
//
//   server/__tests__/warnOnceTeardown.test.ts      → server/**
//   client/src/__tests__/warnOnceTeardown.test.ts  → client/**
//   scripts/__tests__/warnOnceTeardown.test.ts     → scripts/**, video/scripts/**
//
// If vitest.config.ts ever gains a new include glob (e.g. `shared/**/*.test.ts`),
// the new test files would silently fall outside all three guards, and the
// 60-second warnOnce dedup bleed problem could resurface undetected.
//
// This test reads vitest.config.ts at test time, extracts the include globs,
// derives the distinct directory roots, and asserts that every root is listed
// in KNOWN_ROOTS below. CI fails immediately when a new root is added to the
// config without updating this registry — the failure message tells the author
// exactly what to do.
//
// ADDING A NEW ROOT
// 1. Create (or extend) a warnOnce teardown guard for the new root.
// 2. Add an entry to KNOWN_ROOTS below mapping the root path to that guard file.
// ============================================================================

const REPO_ROOT = path.resolve(__dirname, "../..");

/**
 * Map from include directory root (relative to repo root, as it appears in the
 * glob before the first `**` or `*`) → the guard file that covers it.
 *
 * Update this map whenever vitest.config.ts gains a new include root.
 */
const KNOWN_ROOTS: Record<string, string> = {
  server: "server/__tests__/warnOnceTeardown.test.ts",
  client: "client/src/__tests__/warnOnceTeardown.test.ts",
  scripts: "scripts/__tests__/warnOnceTeardown.test.ts",
  "video/scripts": "scripts/__tests__/warnOnceTeardown.test.ts",
  shared: "scripts/__tests__/warnOnceTeardown.test.ts",
};

/**
 * Derive the directory roots (relative to REPO_ROOT) that a guard file
 * actually scans at runtime.  Recognises two patterns used in the guard files:
 *
 *   Pattern A — SCAN_ROOTS array (multi-root guard, e.g. scripts guard):
 *     const SCAN_ROOTS = [
 *       path.join(REPO_ROOT, "scripts"),
 *       path.join(REPO_ROOT, "video", "scripts"),
 *     ];
 *     → ["scripts", "video/scripts"]
 *
 *   Pattern B — single *_ROOT variable (single-root guard, e.g. server/client):
 *     const SERVER_ROOT = path.resolve(__dirname, "..")
 *     Resolved relative to the guard file's own directory.
 *     e.g. guard at server/__tests__/ + ".." → "server"
 */
function extractGuardScanRoots(source: string, guardAbsPath: string): string[] {
  const guardDir = path.dirname(guardAbsPath);
  const roots: string[] = [];

  // Pattern A: SCAN_ROOTS = [ path.join(REPO_ROOT, ...), ... ]
  // Use the 's' flag so '.' matches newlines across the multi-line array literal.
  const scanRootsMatch = source.match(/SCAN_ROOTS\s*=\s*\[([^\]]+)\]/s);
  if (scanRootsMatch) {
    const body = scanRootsMatch[1];
    // Each element looks like: path.join(REPO_ROOT, "seg1") or
    //   path.join(REPO_ROOT, "seg1", "seg2")
    const joinRe = /path\.join\(\s*REPO_ROOT\s*,\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = joinRe.exec(body)) !== null) {
      const argsText = m[1];
      const segments: string[] = [];
      const segRe = /['"]([^'"]+)['"]/g;
      let seg: RegExpExecArray | null;
      while ((seg = segRe.exec(argsText)) !== null) {
        segments.push(seg[1]);
      }
      if (segments.length > 0) {
        roots.push(segments.join("/"));
      }
    }
    return roots;
  }

  // Pattern B: const <NAME> = path.resolve(__dirname, "seg1") or
  //             const <NAME> = path.resolve(__dirname, "seg1", "seg2", ...)
  //
  // The variable name can be anything (\w+ matches any identifier such as
  // SERVER_ROOT, CLIENT_ROOT, ROOT_DIR, BASE, …).  Multi-segment paths like
  // path.resolve(__dirname, "..", "src") are handled by collecting all quoted
  // string arguments and resolving them together.  A global exec loop handles
  // guard files that declare more than one root constant.
  const singleRootRe =
    /const\s+\w+\s*=\s*path\.resolve\(\s*__dirname\s*,\s*((?:['"][^'"]*['"]\s*,?\s*)+)\)/g;
  let rm: RegExpExecArray | null;
  while ((rm = singleRootRe.exec(source)) !== null) {
    const argsText = rm[1];
    const segments: string[] = [];
    const segRe = /['"]([^'"]*)['"]/g;
    let seg: RegExpExecArray | null;
    while ((seg = segRe.exec(argsText)) !== null) {
      segments.push(seg[1]);
    }
    if (segments.length > 0) {
      const absRoot = path.resolve(guardDir, ...segments);
      const repoRel = path.relative(REPO_ROOT, absRoot).replace(/\\/g, "/");
      if (!roots.includes(repoRel)) {
        roots.push(repoRel);
      }
    }
  }

  if (roots.length === 0) {
    throw new Error(
      `extractGuardScanRoots: could not detect any scan roots in ` +
        `${path.relative(REPO_ROOT, guardAbsPath)}.\n` +
        "Expected a SCAN_ROOTS array (Pattern A) or one or more\n" +
        "`const NAME = path.resolve(__dirname, ...)` declarations (Pattern B).\n" +
        "Update extractGuardScanRoots() in " +
        "scripts/__tests__/warnOnceGuardCoverage.test.ts to recognise " +
        "the pattern used by this guard file.",
    );
  }

  return roots;
}

/**
 * Extract the top-level directory root from a glob string.
 * e.g. "server/**\/*.test.ts"      → "server"
 *      "client/**\/*.test.{ts,tsx}" → "client"
 *      "video/scripts/**\/*.test.ts" → "video/scripts"
 */
function extractRoot(glob: string): string {
  // Strip leading/trailing whitespace and quotes left over from parsing
  const trimmed = glob.trim().replace(/^['"]|['"]$/g, "");
  // The root is everything before the first path segment containing a wildcard.
  const segments = trimmed.split("/");
  const wildcardIdx = segments.findIndex((s) => s.includes("*") || s.includes("{"));
  if (wildcardIdx <= 0) {
    throw new Error(`Cannot determine root from glob: ${glob}`);
  }
  return segments.slice(0, wildcardIdx).join("/");
}

/**
 * Parse the `include` array from vitest.config.ts by reading the source file
 * as plain text and extracting the quoted strings inside the include array.
 * This avoids executing or importing the config (which would require resolving
 * Vite/Vitest dependencies at test time).
 */
function parseIncludeGlobs(configSource: string): string[] {
  // Match: include: ["...", "...", ...]
  const arrayMatch = configSource.match(/include\s*:\s*\[([^\]]+)\]/);
  if (!arrayMatch) {
    throw new Error('Could not find `include` array in vitest.config.ts');
  }
  const arrayBody = arrayMatch[1];
  // Extract every quoted string within the array.
  const globs: string[] = [];
  const quotedRe = /["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = quotedRe.exec(arrayBody)) !== null) {
    globs.push(m[1]);
  }
  return globs;
}

describe("extractGuardScanRoots unit tests", () => {
  // Use a synthetic guard path inside server/__tests__/ so that ".." resolves
  // to the "server" directory (a real path we can reason about relative to
  // REPO_ROOT without touching the filesystem).
  const fakeGuardAbs = path.join(
    REPO_ROOT,
    "server/__tests__/warnOnceTeardown.test.ts",
  );

  it("single-segment Pattern B: returns the correct repo-relative root", () => {
    const source = `const SERVER_ROOT = path.resolve(__dirname, "..")`;
    const roots = extractGuardScanRoots(source, fakeGuardAbs);
    expect(roots).toEqual(["server"]);
  });

  it("multi-segment Pattern B: joins all segments before resolving", () => {
    // path.resolve(__dirname, "..", "src") relative to server/__tests__/ → server/src
    const source = `const ROOT = path.resolve(__dirname, "..", "src")`;
    const roots = extractGuardScanRoots(source, fakeGuardAbs);
    expect(roots).toEqual(["server/src"]);
  });

  it("throws when no recognisable pattern is found, with the guard path in the message", () => {
    const noPatternSource = `// just a comment, no SCAN_ROOTS and no path.resolve`;
    const fakePath = path.join(REPO_ROOT, "fake/guard.test.ts");
    expect(() => extractGuardScanRoots(noPatternSource, fakePath)).toThrow(
      "fake/guard.test.ts",
    );
  });

  it("Pattern A: SCAN_ROOTS array with two entries returns the correct repo-relative roots", () => {
    const source = `const SCAN_ROOTS = [path.join(REPO_ROOT, "scripts"), path.join(REPO_ROOT, "video", "scripts")]`;
    const roots = extractGuardScanRoots(source, fakeGuardAbs);
    expect(roots).toEqual(["scripts", "video/scripts"]);
  });
});

describe("warnOnce guard coverage", () => {
  const configPath = path.join(REPO_ROOT, "vitest.config.ts");
  const configSource = fs.readFileSync(configPath, "utf-8");
  const globs = parseIncludeGlobs(configSource);

  it("vitest.config.ts include array is non-empty (sanity check)", () => {
    expect(globs.length).toBeGreaterThan(0);
  });

  it("every include root in vitest.config.ts maps to a known warnOnce teardown guard", () => {
    const roots = [...new Set(globs.map(extractRoot))];
    const unguarded: string[] = [];

    for (const root of roots) {
      if (!(root in KNOWN_ROOTS)) {
        unguarded.push(root);
      }
    }

    expect(
      unguarded,
      [
        "The following Vitest include roots have no warnOnce teardown guard:",
        ...unguarded.map((r) => `  ${r}`),
        "",
        "For each new root:",
        "  1. Create (or extend) a warnOnce teardown guard test file covering it.",
        "  2. Add an entry to KNOWN_ROOTS in scripts/__tests__/warnOnceGuardCoverage.test.ts.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("every guard file listed in KNOWN_ROOTS actually exists on disk", () => {
    const missing: string[] = [];

    const uniqueGuards = [...new Set(Object.values(KNOWN_ROOTS))];
    for (const rel of uniqueGuards) {
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) {
        missing.push(rel);
      }
    }

    expect(
      missing,
      [
        "The following guard files listed in KNOWN_ROOTS do not exist:",
        ...missing.map((f) => `  ${f}`),
        "",
        "Either create the missing guard file or remove the stale entry from KNOWN_ROOTS.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("every KNOWN_ROOTS entry's guard file actually scans the root it is mapped to", () => {
    // Group KNOWN_ROOTS entries by guard file so we only parse each file once.
    const guardToExpectedRoots = new Map<string, string[]>();
    for (const [root, guardRel] of Object.entries(KNOWN_ROOTS)) {
      const list = guardToExpectedRoots.get(guardRel) ?? [];
      list.push(root);
      guardToExpectedRoots.set(guardRel, list);
    }

    const staleMappings: string[] = [];

    for (const [guardRel, expectedRoots] of guardToExpectedRoots) {
      const guardAbs = path.join(REPO_ROOT, guardRel);
      if (!fs.existsSync(guardAbs)) {
        // Already caught by the "exists on disk" test; skip here to avoid
        // a misleading secondary failure.
        continue;
      }

      const source = fs.readFileSync(guardAbs, "utf-8");
      const scannedRoots = extractGuardScanRoots(source, guardAbs);

      for (const expected of expectedRoots) {
        if (!scannedRoots.includes(expected)) {
          staleMappings.push(
            `  KNOWN_ROOTS["${expected}"] → ${guardRel}` +
              ` (guard scans: [${scannedRoots.length > 0 ? scannedRoots.join(", ") : "<none detected>"}])`,
          );
        }
      }
    }

    expect(
      staleMappings,
      [
        "The following KNOWN_ROOTS entries are stale — the mapped guard file does",
        "not scan the root it is supposed to cover:",
        ...staleMappings,
        "",
        "To fix: update the guard file's SCAN_ROOTS array or *_ROOT constant to",
        "include the missing root, or point KNOWN_ROOTS to the correct guard file.",
      ].join("\n"),
    ).toEqual([]);
  });
});
