import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  REPO_ROOT,
  computeSourceFingerprint,
  listSourceFiles,
} from "../../../../../../video/scripts/recordingFingerprint.mjs";

// Unit coverage for listSourceFiles() and computeSourceFingerprint() in
// recordingFingerprint.mjs. The freshness guard and the manifest tests both
// rely on these two functions picking up the correct set of source files. If a
// future refactor moved or renamed a scene/caption file out of the discovered
// set, the fingerprint would silently stop reflecting that file's content and
// stale MP4s could pass the freshness guard unnoticed.
//
// These tests pin:
//   1. which files listSourceFiles() actually returns (captions, every .tsx
//      scene, shared lib helpers) so a moved file is caught immediately.
//   2. that computeSourceFingerprint() is sensitive to both path changes and
//      content changes, exercising the real exported function against a
//      controlled temp fixture tree (the function accepts an optional `files`
//      override following the same injectable-params pattern as updateManifest).

const PORTAL_DIR = join(
  REPO_ROOT,
  "client",
  "src",
  "components",
  "portal",
  "withdrawal-video",
);

const SHARED_VIDEO_DIR = join(REPO_ROOT, "shared", "video");

// ---------------------------------------------------------------------------
// Temp fixture helpers
// ---------------------------------------------------------------------------

let fixtureDir: string;

beforeEach(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "fp-sources-fixture-"));
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
// listSourceFiles
// ---------------------------------------------------------------------------

describe("listSourceFiles", () => {
  it("includes shared/videoCaptions.ts (the single captions source of truth)", () => {
    const files = listSourceFiles();
    expect(files).toContain(join(REPO_ROOT, "shared", "videoCaptions.ts"));
  });

  it("includes the shared lib helpers (animations.ts, hooks.ts, index.ts)", () => {
    const files = listSourceFiles();
    expect(files).toContain(join(SHARED_VIDEO_DIR, "animations.ts"));
    expect(files).toContain(join(SHARED_VIDEO_DIR, "hooks.ts"));
    expect(files).toContain(join(SHARED_VIDEO_DIR, "index.ts"));
  });

  it("dynamically discovers every .tsx file from the scenes directory", () => {
    const files = listSourceFiles();
    const scenesDir = join(SHARED_VIDEO_DIR, "scenes");

    const expectedScenes = walkTsFiles(scenesDir)
      .filter((f) => f.endsWith(".tsx"))
      .sort();

    // At least one scene must exist for this guard to be meaningful.
    expect(expectedScenes.length).toBeGreaterThan(0);

    for (const scene of expectedScenes) {
      expect(
        files,
        `listSourceFiles() is missing scene file: ${relative(REPO_ROOT, scene)}`,
      ).toContain(scene);
    }
  });

  it("contains no scene files beyond those in the scenes directory", () => {
    const files = listSourceFiles();
    const scenesDir = join(SHARED_VIDEO_DIR, "scenes");

    const sceneFilesInResult = files
      .filter((f: string) => !relative(scenesDir, f).startsWith(".."))
      .sort();

    const expectedScenes = walkTsFiles(scenesDir)
      .filter((f) => f.endsWith(".tsx"))
      .sort();

    expect(sceneFilesInResult).toEqual(expectedScenes);
  });

  it("does not include VideoTemplate.tsx (excluded by design — the two copies differ)", () => {
    const files = listSourceFiles();
    for (const file of files) {
      expect(
        file,
        "VideoTemplate.tsx must be excluded from the fingerprint source set",
      ).not.toContain("VideoTemplate");
    }
  });

  it("every returned path exists on disk", () => {
    for (const file of listSourceFiles()) {
      expect(
        existsSync(file),
        `listSourceFiles() returned a path that does not exist: ${relative(REPO_ROOT, file)}`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// computeSourceFingerprint (using the injectable `files` parameter so tests
// exercise the real exported function against controlled fixture content)
// ---------------------------------------------------------------------------

describe("computeSourceFingerprint", () => {
  it("returns a 64-character lowercase hex string", () => {
    const fp = computeSourceFingerprint();
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: two consecutive calls return the same value", () => {
    const first = computeSourceFingerprint();
    const second = computeSourceFingerprint();
    expect(first).toBe(second);
  });

  it("changes when the content of a file changes", () => {
    const fileA = writeFixture("captions.ts", "export const captions = { en: 'hello' };");
    const fileB = writeFixture("scene1.tsx", "export const Scene1 = () => null;");

    const fpBefore = computeSourceFingerprint([fileA, fileB]);

    // Overwrite the first file with different content.
    writeFileSync(fileA, "export const captions = { en: 'goodbye' };", "utf8");

    const fpAfter = computeSourceFingerprint([fileA, fileB]);

    expect(fpBefore).not.toBe(fpAfter);
  });

  it("changes when the relative path of a file changes (paths are folded into the hash)", () => {
    // Write two fixture files with identical content but different names.
    // Because computeSourceFingerprint folds the REPO_ROOT-relative path
    // into the hash, passing two otherwise-identical files at different paths
    // must yield different fingerprints.
    const content = "export const x = 1;";
    const fileAtPathA = writeFixture("captions.ts", content);
    const fileAtPathB = writeFixture("captions.renamed.ts", content);

    const fpA = computeSourceFingerprint([fileAtPathA]);
    const fpB = computeSourceFingerprint([fileAtPathB]);

    expect(fpA).not.toBe(fpB);
  });

  it("changes when a file is added to the set of discovered sources", () => {
    const fileA = writeFixture("captions.ts", "export const captions = {};");
    const fileB = writeFixture("scene1.tsx", "export const Scene1 = () => null;");

    const fpWithout = computeSourceFingerprint([fileA]);
    const fpWith = computeSourceFingerprint([fileA, fileB]);

    expect(fpWithout).not.toBe(fpWith);
  });

  it("reflects content from every file returned by listSourceFiles()", () => {
    // Take the real discovered file list and verify the fingerprint actually
    // reads each file: if any file is silently excluded, computing the
    // fingerprint against a subset would yield the same hash — this test
    // catches that by asserting each file contributes uniquely.
    const allFiles = listSourceFiles();
    expect(allFiles.length).toBeGreaterThan(0);

    const fpFull = computeSourceFingerprint(allFiles);

    // Drop each file in turn: the fingerprint must change every time.
    for (const excluded of allFiles) {
      const subset = allFiles.filter((f) => f !== excluded);
      const fpSubset = computeSourceFingerprint(subset);
      expect(
        fpSubset,
        `computeSourceFingerprint() fingerprint did not change when ` +
          `${relative(REPO_ROOT, excluded)} was removed from the input set — ` +
          `this file may not be contributing to the fingerprint.`,
      ).not.toBe(fpFull);
    }
  });
});

// ---------------------------------------------------------------------------
// Coverage assertion: listSourceFiles() must be exhaustive
//
// This test scans every non-test `.tsx` file in the `scenes/` directory for
// imports of the two recording-pipeline symbols (`SCENE_DURATIONS` and
// `VIDEO_CAPTIONS`). Any scene component that imports either symbol determines
// what a recorded frame looks like and therefore MUST be listed in
// listSourceFiles() so that edits to it invalidate the recording freshness
// check. Adding a new scene file without updating the list is the
// silent-drift scenario this guard is designed to prevent.
//
// Scope: all `.tsx` files recursively under `shared/video/scenes/` (including
// any subdirectories). Test files (*test.tsx, *spec.tsx) are excluded even if
// they somehow land there. Non-scene files outside the scenes directory (e.g.
// VideoTemplate.tsx, which is excluded from listSourceFiles() by design, and
// narrationFingerprint.ts, which uses VIDEO_CAPTIONS for the narration
// pipeline) are intentionally out of scope.
// ---------------------------------------------------------------------------

/** Returns true if the file's source text imports `SCENE_DURATIONS` or `VIDEO_CAPTIONS`. */
function importsRecordingSymbols(filePath: string): boolean {
  const src = readFileSync(filePath, "utf8");
  return /\bSCENE_DURATIONS\b/.test(src) || /\bVIDEO_CAPTIONS\b/.test(src);
}

/**
 * Recursively collects all `.ts` and `.tsx` files under `dir`, excluding test
 * files (`*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`).
 */
function walkTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry)
    ) {
      results.push(full);
    }
  }
  return results;
}

describe("listSourceFiles coverage — every recording-pipeline importer is listed", () => {
  const SCENES_DIR = join(SHARED_VIDEO_DIR, "scenes");
  const LIB_DIR = SHARED_VIDEO_DIR;

  it("every non-test .tsx scene file that imports SCENE_DURATIONS or VIDEO_CAPTIONS is in listSourceFiles()", () => {
    const listedFiles = listSourceFiles();

    const sceneFiles = walkTsFiles(SCENES_DIR).filter((f) =>
      f.endsWith(".tsx"),
    );

    // At least one scene must exist for this guard to be meaningful.
    expect(sceneFiles.length).toBeGreaterThan(0);

    const importers = sceneFiles.filter(importsRecordingSymbols);
    const unlisted = importers.filter((f) => !listedFiles.includes(f));

    expect(
      unlisted,
      `The following scene files import recording pipeline symbols (SCENE_DURATIONS / ` +
        `VIDEO_CAPTIONS) but are NOT listed in listSourceFiles() in ` +
        `video/scripts/recordingFingerprint.mjs. ` +
        `Add them to the list so edits to their content invalidate the recording freshness check:\n` +
        unlisted
          .map((f) => `  - ${relative(REPO_ROOT, f)}`)
          .join("\n"),
    ).toEqual([]);
  });

  it("every non-test .ts/.tsx lib helper that imports SCENE_DURATIONS or VIDEO_CAPTIONS is in listSourceFiles()", () => {
    const listedFiles = listSourceFiles();

    const libFiles = walkTsFiles(LIB_DIR);

    // At least one lib helper must exist for this guard to be meaningful.
    expect(libFiles.length).toBeGreaterThan(0);

    const importers = libFiles.filter(importsRecordingSymbols);
    const unlisted = importers.filter((f) => !listedFiles.includes(f));

    expect(
      unlisted,
      `The following lib helper files import recording pipeline symbols (SCENE_DURATIONS / ` +
        `VIDEO_CAPTIONS) but are NOT listed in listSourceFiles() in ` +
        `video/scripts/recordingFingerprint.mjs. ` +
        `Add them to the list so edits to their content invalidate the recording freshness check:\n` +
        unlisted
          .map((f) => `  - ${relative(REPO_ROOT, f)}`)
          .join("\n"),
    ).toEqual([]);
  });
});
