import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  REPO_ROOT,
  computeNarrationSourceFingerprint,
  listNarrationSourceFiles,
} from "../narrationFingerprint";

// Unit coverage for listNarrationSourceFiles() and
// computeNarrationSourceFingerprint() in narrationFingerprint.ts. The
// narration freshness test (narrationFreshness.test.ts) relies on
// computeScriptFingerprint(), which is derived entirely from the content of the
// files listed by listNarrationSourceFiles(). If a future refactor moved or
// renamed a caption/algorithm source file out of the discovered set, the script
// fingerprints would silently stop reflecting that file's content and stale
// narration audio could pass the freshness guard unnoticed.
//
// These tests pin:
//   1. which files listNarrationSourceFiles() actually returns (captions.ts
//      and narrationFingerprint.ts), so a moved or missing file is caught
//      immediately.
//   2. that computeNarrationSourceFingerprint() is sensitive to both path
//      changes and content changes, exercising the real exported function
//      against a controlled temp fixture tree (the function accepts an
//      optional `files` override following the same injectable-params pattern
//      as computeSourceFingerprint() in recordingFingerprint.mjs).

const PORTAL_DIR = join(
  REPO_ROOT,
  "client",
  "src",
  "components",
  "portal",
  "withdrawal-video",
);

// ---------------------------------------------------------------------------
// Temp fixture helpers
// ---------------------------------------------------------------------------

let fixtureDir: string;

beforeEach(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "narration-fp-sources-fixture-"));
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

/** Write a fixture file and return its absolute path. */
function writeFixture(name: string, content: string): string {
  const path = join(fixtureDir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

// ---------------------------------------------------------------------------
// listNarrationSourceFiles
// ---------------------------------------------------------------------------

describe("listNarrationSourceFiles", () => {
  it("includes shared/videoCaptions.ts (the single captions source of truth)", () => {
    const files = listNarrationSourceFiles();
    expect(files).toContain(join(REPO_ROOT, "shared", "videoCaptions.ts"));
  });

  it("includes narrationFingerprint.ts (the algorithm file)", () => {
    const files = listNarrationSourceFiles();
    expect(files).toContain(join(PORTAL_DIR, "narrationFingerprint.ts"));
  });

  it("every returned path exists on disk", () => {
    for (const file of listNarrationSourceFiles()) {
      expect(
        existsSync(file),
        `listNarrationSourceFiles() returned a path that does not exist: ${relative(REPO_ROOT, file)}`,
      ).toBe(true);
    }
  });

  it("returns at least the two core source files", () => {
    const files = listNarrationSourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// computeNarrationSourceFingerprint (using the injectable `files` parameter so
// tests exercise the real exported function against controlled fixture content)
// ---------------------------------------------------------------------------

describe("computeNarrationSourceFingerprint", () => {
  it("returns a 64-character lowercase hex string", () => {
    const fp = computeNarrationSourceFingerprint();
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: two consecutive calls return the same value", () => {
    const first = computeNarrationSourceFingerprint();
    const second = computeNarrationSourceFingerprint();
    expect(first).toBe(second);
  });

  it("changes when the content of a file changes", () => {
    const fileA = writeFixture(
      "captions.ts",
      "export const captions = { en: 'hello' };",
    );
    const fileB = writeFixture(
      "narrationFingerprint.ts",
      "export const x = 1;",
    );

    const fpBefore = computeNarrationSourceFingerprint([fileA, fileB]);

    writeFileSync(fileA, "export const captions = { en: 'goodbye' };", "utf8");

    const fpAfter = computeNarrationSourceFingerprint([fileA, fileB]);

    expect(fpBefore).not.toBe(fpAfter);
  });

  it("changes when the relative path of a file changes (paths are folded into the hash)", () => {
    // Two fixture files with identical content but different names. Because
    // computeNarrationSourceFingerprint folds the REPO_ROOT-relative path into
    // the hash, passing otherwise-identical files at different paths must yield
    // different fingerprints.
    const content = "export const captions = {};";
    const fileAtPathA = writeFixture("captions.ts", content);
    const fileAtPathB = writeFixture("captions.renamed.ts", content);

    const fpA = computeNarrationSourceFingerprint([fileAtPathA]);
    const fpB = computeNarrationSourceFingerprint([fileAtPathB]);

    expect(fpA).not.toBe(fpB);
  });

  it("changes when a file is added to the set of sources", () => {
    const fileA = writeFixture(
      "captions.ts",
      "export const captions = {};",
    );
    const fileB = writeFixture(
      "narrationFingerprint.ts",
      "export const x = 1;",
    );

    const fpWithout = computeNarrationSourceFingerprint([fileA]);
    const fpWith = computeNarrationSourceFingerprint([fileA, fileB]);

    expect(fpWithout).not.toBe(fpWith);
  });

  it("reflects content from every file returned by listNarrationSourceFiles()", () => {
    // Take the real discovered file list and verify the fingerprint actually
    // reads each file: if any file is silently excluded, computing the
    // fingerprint against a subset would yield the same hash — this test
    // catches that by asserting each file contributes uniquely.
    const allFiles = listNarrationSourceFiles();
    expect(allFiles.length).toBeGreaterThan(0);

    const fpFull = computeNarrationSourceFingerprint(allFiles);

    for (const excluded of allFiles) {
      const subset = allFiles.filter((f) => f !== excluded);
      const fpSubset = computeNarrationSourceFingerprint(subset);
      expect(
        fpSubset,
        `computeNarrationSourceFingerprint() did not change when ` +
          `${relative(REPO_ROOT, excluded)} was removed from the input set — ` +
          `this file may not be contributing to the fingerprint.`,
      ).not.toBe(fpFull);
    }
  });
});

// ---------------------------------------------------------------------------
// Coverage assertion: listNarrationSourceFiles() must be exhaustive
//
// This test scans every non-test TypeScript/TSX source file in the
// withdrawal-video component directory for imports of the two narration-
// pipeline symbols (`buildNarrationScript` and `VIDEO_CAPTIONS`). Any file
// that imports either symbol contributes to the spoken narration text and
// therefore MUST be listed in listNarrationSourceFiles() so that edits to it
// invalidate the cached audio. Adding a new source file without updating the
// list is the silent-drift scenario this guard is designed to prevent.
//
// Scope: only files directly inside the `withdrawal-video/` directory tree.
// Test files (*test.ts, *test.tsx, *spec.ts) and the `__tests__/` subdirectory
// are excluded — they import the symbols for assertion purposes, not because
// they define narration content.
// ---------------------------------------------------------------------------

/** Recursively collect .ts/.tsx files under `dir`, skipping `__tests__` subdirs. */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") {
        results.push(...collectSourceFiles(full));
      }
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

/** Returns true if the file's source text imports `buildNarrationScript` or `VIDEO_CAPTIONS`. */
function importsNarrationSymbols(filePath: string): boolean {
  const src = readFileSync(filePath, "utf8");
  return /\bVIDEO_CAPTIONS\b/.test(src) || /\bbuildNarrationScript\b/.test(src);
}

describe("listNarrationSourceFiles coverage — every narration-pipeline importer is listed", () => {
  const WITHDRAWAL_VIDEO_DIR = join(
    REPO_ROOT,
    "client",
    "src",
    "components",
    "portal",
    "withdrawal-video",
  );

  it("every non-test file that imports VIDEO_CAPTIONS or buildNarrationScript is in listNarrationSourceFiles()", () => {
    const listedFiles = listNarrationSourceFiles();
    const sourceFiles = collectSourceFiles(WITHDRAWAL_VIDEO_DIR);

    const importers = sourceFiles.filter(importsNarrationSymbols);

    const unlisted = importers.filter((f) => !listedFiles.includes(f));

    expect(
      unlisted,
      `The following files import narration pipeline symbols (VIDEO_CAPTIONS / ` +
        `buildNarrationScript) but are NOT listed in listNarrationSourceFiles(). ` +
        `Add them to the list so edits to their narration content invalidate cached audio:\n` +
        unlisted
          .map((f) => `  - ${relative(REPO_ROOT, f)}`)
          .join("\n"),
    ).toEqual([]);
  });
});

