import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  computeNarrationFingerprint,
  computeSourceFingerprint,
  listSourceFiles,
  recordedLocalesFromResults,
  recordingFileName,
  updateManifest,
  REPO_ROOT,
} from "../recordingFingerprint.mjs";

// Unit tests for computeNarrationFingerprint.
//
// These prove the narration-only drift case: if only narration mp3 files
// change (no video/** source file is touched), the fingerprint changes and
// the recordingsFreshness test will catch the stale MP4 — regardless of
// whether the animation source fingerprint also changed.
//
// CI path note: narration mp3 files live under
//   client/public/withdrawal-video/narration/<locale>/
// which matches the `client/**` path filter in unit-tests.yml, so a push that
// touches only mp3 files WILL trigger the tutorial-recordings-freshness job.
// These unit tests confirm that the freshness check would then flag the
// recording as stale.

function makeTmpNarrationDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "narration-test-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe("computeNarrationFingerprint", () => {
  it("returns empty string when locale directory does not exist", () => {
    const result = computeNarrationFingerprint("en", "/nonexistent/path/en");
    expect(result).toBe("");
  });

  it("returns empty string when locale directory has no mp3 files", () => {
    const dir = mkdtempSync(join(tmpdir(), "narration-empty-"));
    writeFileSync(join(dir, "readme.txt"), "not an mp3");
    const result = computeNarrationFingerprint("en", dir);
    expect(result).toBe("");
  });

  it("returns a non-empty hex string when mp3 files are present", () => {
    const dir = makeTmpNarrationDir({ "scene1.mp3": "audio-bytes-a" });
    const result = computeNarrationFingerprint("en", dir);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same fingerprint for identical mp3 content (stable)", () => {
    const dir1 = makeTmpNarrationDir({ "scene1.mp3": "audio-bytes-a" });
    const dir2 = makeTmpNarrationDir({ "scene1.mp3": "audio-bytes-a" });
    expect(computeNarrationFingerprint("en", dir1)).toBe(
      computeNarrationFingerprint("en", dir2),
    );
  });

  it("returns a different fingerprint when mp3 file content changes", () => {
    const before = makeTmpNarrationDir({ "scene1.mp3": "original-audio" });
    const after = makeTmpNarrationDir({ "scene1.mp3": "updated-audio" });
    expect(computeNarrationFingerprint("en", before)).not.toBe(
      computeNarrationFingerprint("en", after),
    );
  });

  it("returns a different fingerprint when an mp3 file is added", () => {
    const before = makeTmpNarrationDir({ "scene1.mp3": "audio-a" });
    const after = makeTmpNarrationDir({
      "scene1.mp3": "audio-a",
      "scene2.mp3": "audio-b",
    });
    expect(computeNarrationFingerprint("en", before)).not.toBe(
      computeNarrationFingerprint("en", after),
    );
  });

  it("returns a different fingerprint when an mp3 file is removed", () => {
    const before = makeTmpNarrationDir({
      "scene1.mp3": "audio-a",
      "scene2.mp3": "audio-b",
    });
    const after = makeTmpNarrationDir({ "scene1.mp3": "audio-a" });
    expect(computeNarrationFingerprint("en", before)).not.toBe(
      computeNarrationFingerprint("en", after),
    );
  });

  it("returns a different fingerprint when an mp3 file is renamed", () => {
    const before = makeTmpNarrationDir({ "scene1.mp3": "audio-content" });
    const after = makeTmpNarrationDir({ "scene2.mp3": "audio-content" });
    expect(computeNarrationFingerprint("en", before)).not.toBe(
      computeNarrationFingerprint("en", after),
    );
  });

  it("is stable regardless of filesystem readdir order (sorted)", () => {
    const dir = makeTmpNarrationDir({
      "scene3.mp3": "c",
      "scene1.mp3": "a",
      "scene2.mp3": "b",
    });
    const fp1 = computeNarrationFingerprint("en", dir);
    const fp2 = computeNarrationFingerprint("en", dir);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── computeSourceFingerprint ─────────────────────────────────────────────────
//
// Tests use fixture files written to a single tmpdir and pass them as the
// injectable `files` list so the real animation source tree is never touched.
//
// Key constraint: computeSourceFingerprint folds relative(REPO_ROOT, file)
// into the hash, so two files at different absolute paths will produce
// different fingerprints even when their contents match. All tests that need
// to compare fingerprints therefore operate within a single tmpdir so that
// only the intended dimension (content / name / set membership) varies.

describe("computeSourceFingerprint", () => {
  it("returns a 64-char lowercase hex string", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-fp-test-"));
    const p = join(dir, "Scene1.tsx");
    writeFileSync(p, "const a = 1;");
    expect(computeSourceFingerprint([p])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for identical inputs (same output on two calls)", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-fp-test-"));
    const p = join(dir, "Scene1.tsx");
    writeFileSync(p, "hello");
    const paths = [p];
    expect(computeSourceFingerprint(paths)).toBe(computeSourceFingerprint(paths));
  });

  it("changes when a file's content changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-fp-test-"));
    const p = join(dir, "Scene1.tsx");
    writeFileSync(p, "original");
    const fp1 = computeSourceFingerprint([p]);
    writeFileSync(p, "updated");
    const fp2 = computeSourceFingerprint([p]);
    expect(fp1).not.toBe(fp2);
  });

  it("changes when a file is renamed (relative path is part of the hash)", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-fp-rename-"));
    const content = "const x = 42;";
    const pathA = join(dir, "SceneA.tsx");
    const pathB = join(dir, "SceneB.tsx");
    writeFileSync(pathA, content);
    writeFileSync(pathB, content);
    expect(computeSourceFingerprint([pathA])).not.toBe(
      computeSourceFingerprint([pathB]),
    );
  });

  it("changes when a file is added to the set", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-fp-test-"));
    const p1 = join(dir, "Scene1.tsx");
    const p2 = join(dir, "Scene2.tsx");
    writeFileSync(p1, "aaa");
    writeFileSync(p2, "bbb");
    const fpBefore = computeSourceFingerprint([p1]);
    const fpAfter = computeSourceFingerprint([p1, p2]);
    expect(fpBefore).not.toBe(fpAfter);
  });

  it("changes when a file is removed from the set", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-fp-test-"));
    const p1 = join(dir, "Scene1.tsx");
    const p2 = join(dir, "Scene2.tsx");
    writeFileSync(p1, "aaa");
    writeFileSync(p2, "bbb");
    const fpBefore = computeSourceFingerprint([p1, p2]);
    const fpAfter = computeSourceFingerprint([p1]);
    expect(fpBefore).not.toBe(fpAfter);
  });
});

// ── recordedLocalesFromResults ───────────────────────────────────────────────

describe("recordedLocalesFromResults", () => {
  it("returns all locales when none timed out", () => {
    const results = [
      { locale: "en", timedOut: false },
      { locale: "fr", timedOut: false },
    ];
    expect(recordedLocalesFromResults(results)).toEqual(["en", "fr"]);
  });

  it("excludes locales that timed out", () => {
    const results = [
      { locale: "en", timedOut: false },
      { locale: "fr", timedOut: true },
      { locale: "de", timedOut: false },
    ];
    expect(recordedLocalesFromResults(results)).toEqual(["en", "de"]);
  });

  it("returns an empty array when every locale timed out", () => {
    const results = [
      { locale: "en", timedOut: true },
      { locale: "zh", timedOut: true },
    ];
    expect(recordedLocalesFromResults(results)).toEqual([]);
  });

  it("returns an empty array for an empty results list", () => {
    expect(recordedLocalesFromResults([])).toEqual([]);
  });
});

// ── updateManifest ───────────────────────────────────────────────────────────
//
// Tests use an injected tmp manifestPath and fixed fingerprint / narration /
// recordedAt values so the real file system and computeSourceFingerprint() are
// never touched.

function makeTmpManifestDir(): string {
  return mkdtempSync(join(tmpdir(), "manifest-test-"));
}

describe("updateManifest", () => {
  it("writes a new locale entry with correct sourceFingerprint, narrationFingerprint, and file fields", async () => {
    const tmpDir = makeTmpManifestDir();
    const manifestPath = join(tmpDir, "recordings.manifest.json");

    await updateManifest(["en"], {
      manifestPath,
      fingerprint: "src-fp-aaa111",
      narrationFingerprints: { en: "nar-fp-bbb222" },
      recordedAt: "2024-01-15T12:00:00.000Z",
    });

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.locales.en).toEqual({
      file: recordingFileName("en"),
      sourceFingerprint: "src-fp-aaa111",
      narrationFingerprint: "nar-fp-bbb222",
      recordedAt: "2024-01-15T12:00:00.000Z",
    });
  });

  it("writes the correct file name for each locale", async () => {
    const tmpDir = makeTmpManifestDir();
    const manifestPath = join(tmpDir, "recordings.manifest.json");

    await updateManifest(["fr"], {
      manifestPath,
      fingerprint: "src-fp",
      narrationFingerprints: { fr: "nar-fp" },
      recordedAt: "2024-01-15T12:00:00.000Z",
    });

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.locales.fr.file).toBe("withdrawal-tutorial-fr.mp4");
  });

  it("stamps multiple locales in a single call", async () => {
    const tmpDir = makeTmpManifestDir();
    const manifestPath = join(tmpDir, "recordings.manifest.json");

    await updateManifest(["en", "es"], {
      manifestPath,
      fingerprint: "src-fp-multi",
      narrationFingerprints: { en: "nar-en", es: "nar-es" },
      recordedAt: "2024-02-01T00:00:00.000Z",
    });

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.locales.en.sourceFingerprint).toBe("src-fp-multi");
    expect(manifest.locales.es.sourceFingerprint).toBe("src-fp-multi");
    expect(manifest.locales.en.narrationFingerprint).toBe("nar-en");
    expect(manifest.locales.es.narrationFingerprint).toBe("nar-es");
  });

  it("overwrites an existing locale entry on re-record", async () => {
    const tmpDir = makeTmpManifestDir();
    const manifestPath = join(tmpDir, "recordings.manifest.json");

    await updateManifest(["en"], {
      manifestPath,
      fingerprint: "src-fp-old",
      narrationFingerprints: { en: "nar-fp-old" },
      recordedAt: "2024-01-01T00:00:00.000Z",
    });

    await updateManifest(["en"], {
      manifestPath,
      fingerprint: "src-fp-new",
      narrationFingerprints: { en: "nar-fp-new" },
      recordedAt: "2024-06-01T00:00:00.000Z",
    });

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.locales.en.sourceFingerprint).toBe("src-fp-new");
    expect(manifest.locales.en.narrationFingerprint).toBe("nar-fp-new");
    expect(manifest.locales.en.recordedAt).toBe("2024-06-01T00:00:00.000Z");
  });

  it("preserves untouched locales when re-recording a subset", async () => {
    const tmpDir = makeTmpManifestDir();
    const manifestPath = join(tmpDir, "recordings.manifest.json");

    await updateManifest(["en", "fr"], {
      manifestPath,
      fingerprint: "src-fp-v1",
      narrationFingerprints: { en: "nar-en-v1", fr: "nar-fr-v1" },
      recordedAt: "2024-01-01T00:00:00.000Z",
    });

    await updateManifest(["en"], {
      manifestPath,
      fingerprint: "src-fp-v2",
      narrationFingerprints: { en: "nar-en-v2" },
      recordedAt: "2024-06-01T00:00:00.000Z",
    });

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.locales.en.sourceFingerprint).toBe("src-fp-v2");
    // fr was NOT re-recorded and must retain the original fingerprint
    expect(manifest.locales.fr.sourceFingerprint).toBe("src-fp-v1");
    expect(manifest.locales.fr.recordedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("does NOT stamp a timed-out locale (via recordedLocalesFromResults)", async () => {
    const tmpDir = makeTmpManifestDir();
    const manifestPath = join(tmpDir, "recordings.manifest.json");

    const results = [
      { locale: "en", timedOut: false },
      { locale: "fr", timedOut: true },
    ];
    const safeLocales = recordedLocalesFromResults(results);

    await updateManifest(safeLocales, {
      manifestPath,
      fingerprint: "src-fp-xyz",
      narrationFingerprints: { en: "nar-en" },
      recordedAt: "2024-03-01T00:00:00.000Z",
    });

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.locales.en).toBeDefined();
    expect(manifest.locales.fr).toBeUndefined();
  });

  it("starts fresh when the manifest file does not exist", async () => {
    const tmpDir = makeTmpManifestDir();
    const manifestPath = join(tmpDir, "no-such-file.json");

    await updateManifest(["de"], {
      manifestPath,
      fingerprint: "src-fp-fresh",
      narrationFingerprints: { de: "nar-de" },
      recordedAt: "2024-04-01T00:00:00.000Z",
    });

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.locales.de.sourceFingerprint).toBe("src-fp-fresh");
  });

  it("starts fresh when the manifest contains corrupt JSON", async () => {
    const tmpDir = makeTmpManifestDir();
    const manifestPath = join(tmpDir, "recordings.manifest.json");
    writeFileSync(manifestPath, "{ this is not valid json !!!");

    await updateManifest(["pt"], {
      manifestPath,
      fingerprint: "src-fp-recover",
      narrationFingerprints: { pt: "nar-pt" },
      recordedAt: "2024-05-01T00:00:00.000Z",
    });

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.locales.pt.sourceFingerprint).toBe("src-fp-recover");
    // No other locales should survive a corrupt-manifest fresh start
    expect(Object.keys(manifest.locales)).toEqual(["pt"]);
  });

  it("starts fresh when the manifest has no locales object", async () => {
    const tmpDir = makeTmpManifestDir();
    const manifestPath = join(tmpDir, "recordings.manifest.json");
    writeFileSync(manifestPath, JSON.stringify({ version: 1 }));

    await updateManifest(["zh"], {
      manifestPath,
      fingerprint: "src-fp-nolocales",
      narrationFingerprints: { zh: "nar-zh" },
      recordedAt: "2024-05-15T00:00:00.000Z",
    });

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.locales.zh.sourceFingerprint).toBe("src-fp-nolocales");
  });

  it("uses empty string for narrationFingerprint when locale is missing from narrationMap", async () => {
    const tmpDir = makeTmpManifestDir();
    const manifestPath = join(tmpDir, "recordings.manifest.json");

    await updateManifest(["en"], {
      manifestPath,
      fingerprint: "src-fp",
      narrationFingerprints: {},
      recordedAt: "2024-01-01T00:00:00.000Z",
    });

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.locales.en.narrationFingerprint).toBe("");
  });

  it("returns the updated manifest object", async () => {
    const tmpDir = makeTmpManifestDir();
    const manifestPath = join(tmpDir, "recordings.manifest.json");

    const result = await updateManifest(["en"], {
      manifestPath,
      fingerprint: "src-fp-ret",
      narrationFingerprints: { en: "nar-ret" },
      recordedAt: "2024-01-01T00:00:00.000Z",
    });

    expect(result.locales.en.sourceFingerprint).toBe("src-fp-ret");
  });
});

// ── computeSourceFingerprint order-sensitivity ───────────────────────────────
//
// computeSourceFingerprint processes files in input order, so passing the same
// two files in different order produces different fingerprints. This is
// intentional: listSourceFiles() always returns a sorted list, guaranteeing a
// stable fingerprint in production. These tests document that contract so a
// future change that drops the .sort() call from listSourceFiles() is caught.

describe("computeSourceFingerprint — order sensitivity", () => {
  it("produces different fingerprints when the same files are passed in different order", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-fp-order-"));
    const pA = join(dir, "SceneA.tsx");
    const pB = join(dir, "SceneB.tsx");
    writeFileSync(pA, "content-a");
    writeFileSync(pB, "content-b");

    const fpAB = computeSourceFingerprint([pA, pB]);
    const fpBA = computeSourceFingerprint([pB, pA]);

    expect(fpAB).not.toBe(fpBA);
  });
});

// ── listSourceFiles — sort contract ─────────────────────────────────────────
//
// listSourceFiles() discovers animation source files dynamically from the real
// FS. These tests verify the three invariants that guard against silent
// staleness:
//   1. The list is non-empty (the source tree exists and was found).
//   2. Every path in the list exists on disk (no phantom entries).
//   3. The list is already sorted (same order as .sort() produces), so
//      computeSourceFingerprint() produces a stable fingerprint regardless
//      of filesystem readdir order.

describe("listSourceFiles — sort contract", () => {
  it("returns a non-empty list", () => {
    const files = listSourceFiles();
    expect(files.length).toBeGreaterThan(0);
  });

  it("every path in the list exists on disk", () => {
    const files = listSourceFiles();
    for (const file of files) {
      expect(existsSync(file), `expected file to exist: ${file}`).toBe(true);
    }
  });

  it("the returned list is already sorted (equals its own .sort() copy)", () => {
    const files = listSourceFiles();
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  // Pins the exact set of relative paths so that a rename or accidental
  // deletion fails loudly. Update this list whenever a source file is
  // intentionally added, removed, or renamed.
  it("returns exactly the expected set of source file paths (relative to REPO_ROOT)", () => {
    const EXPECTED_RELATIVE_PATHS = [
      "client/src/components/portal/withdrawal-video/sceneDurations.ts",
      "shared/video/animations.ts",
      "shared/video/hooks.ts",
      "shared/video/index.ts",
      "shared/video/scenes/Scene1.tsx",
      "shared/video/scenes/Scene2.tsx",
      "shared/video/scenes/Scene3.tsx",
      "shared/video/scenes/Scene4.tsx",
      "shared/video/scenes/Scene5.tsx",
      "shared/videoCaptions.ts",
      "video/scene-durations.json",
    ].sort();

    const actual = listSourceFiles()
      .map((f) => relative(REPO_ROOT, f).split("\\").join("/"))
      .sort();

    expect(actual).toEqual(EXPECTED_RELATIVE_PATHS);
  });
});
