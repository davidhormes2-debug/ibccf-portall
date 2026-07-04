import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import {
  ALL_LOCALES,
  MANIFEST_PATH,
  REPO_ROOT,
  SCENE_DURATIONS_PATH,
  computeNarrationFingerprint,
  computeSourceFingerprint,
  listSourceFiles,
  recordingFileName,
  recordingPath,
} from "../recordingFingerprint.mjs";

// Guard: the recorded tutorial MP4s must not go stale relative to the live
// animation source or narration audio.
//
// The withdrawal tutorial is a live React/Framer-Motion animation, but we also
// export one MP4 per locale to video/public/recordings/ for marketing/email/
// offline use. If the animation source or narration mp3s change and nobody
// re-records, users watching the live animation see fresh content while any
// embedded MP4 is stale.
//
// We detect that by fingerprinting the shared animation source and narration
// audio by content and comparing them to the fingerprints persisted (per
// locale) when each MP4 was last recorded
// (video/public/recordings/recordings.manifest.json). We deliberately avoid
// file mtimes / git timestamps: CI checks out the repo shallow and resets
// every mtime to the checkout time, so those signals are meaningless there.
//
// When this fails, re-record the affected locale(s):
//   bash video/scripts/record-videos.sh <locale...>
// which rewrites the manifest with the current source and narration
// fingerprints.

function rel(p: string): string {
  return relative(REPO_ROOT, p);
}

interface ManifestEntry {
  file?: string;
  sourceFingerprint?: string;
  narrationFingerprint?: string;
  recordedAt?: string;
}

interface Manifest {
  locales?: Record<string, ManifestEntry>;
}

function readManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(
      `Missing recordings manifest: ${rel(MANIFEST_PATH)}\n` +
        `Re-record the tutorial videos to generate it:\n` +
        `  bash video/scripts/record-videos.sh`,
    );
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

describe("withdrawal tutorial: recorded MP4s vs animation source freshness", () => {
  const currentSourceFingerprint = computeSourceFingerprint();
  const manifest = readManifest();

  it.each(ALL_LOCALES)(
    "%s recording is up to date with the animation source",
    (locale: string) => {
      const mp4 = recordingPath(locale);
      expect(
        existsSync(mp4),
        `Missing recording: ${rel(mp4)}\n` +
          `Record it with:\n` +
          `  bash video/scripts/record-videos.sh ${locale}`,
      ).toBe(true);

      const entry = manifest.locales?.[locale];
      expect(
        entry,
        `No manifest entry for "${locale}" in ${rel(MANIFEST_PATH)}.\n` +
          `Re-record it:\n` +
          `  bash video/scripts/record-videos.sh ${locale}`,
      ).toBeTruthy();

      expect(
        entry?.sourceFingerprint,
        `Stale tutorial recording: ${recordingFileName(locale)}\n` +
          `The animation source (captions, scenes, scene durations, or lib helpers) ` +
          `has changed since this locale was last recorded.\n` +
          `Re-record it (which refreshes the manifest):\n` +
          `  bash video/scripts/record-videos.sh ${locale}`,
      ).toBe(currentSourceFingerprint);
    },
  );
});

describe("scene-durations.json is a fingerprint input", () => {
  it("listSourceFiles() includes scene-durations.json", () => {
    const files = listSourceFiles();
    expect(files).toContain(SCENE_DURATIONS_PATH);
  });

  it("mutating scene-durations.json content changes the source fingerprint", () => {
    const original = readFileSync(SCENE_DURATIONS_PATH, "utf8");
    const parsed = JSON.parse(original) as Record<string, number>;

    // Build an alternate file list where scene-durations.json has different content.
    const mutated = JSON.stringify({ ...parsed, intro: (parsed["intro"] ?? 0) + 1 });

    // Use a synthetic file list: replace the real JSON path with a Buffer-backed
    // fake by temporarily injecting a different set that includes a mutated copy.
    // Because computeSourceFingerprint hashes file content, we verify sensitivity
    // by computing two fingerprints — one with the real files, one with a file
    // list that swaps the JSON's content for the mutated version.
    const realFiles = listSourceFiles();
    const fingerprintA = computeSourceFingerprint(realFiles);

    // Write a temp copy with different content and compute a fingerprint using it.
    const tmpPath = SCENE_DURATIONS_PATH + ".tmp-test";
    writeFileSync(tmpPath, mutated, "utf8");
    try {
      const altFiles = realFiles.map((f) => (f === SCENE_DURATIONS_PATH ? tmpPath : f));
      const fingerprintB = computeSourceFingerprint(altFiles);
      expect(fingerprintB).not.toBe(fingerprintA);
    } finally {
      unlinkSync(tmpPath);
    }
  });
});

describe("withdrawal tutorial: recorded MP4s vs narration audio freshness", () => {
  const manifest = readManifest();

  it.each(ALL_LOCALES)(
    "%s recording is up to date with the narration mp3s",
    (locale: string) => {
      const entry = manifest.locales?.[locale];

      // Only enforce narration freshness once a locale has been recorded with
      // the narration-aware version of the manifest (narrationFingerprint
      // present). Pre-narration entries are covered by the source check above.
      if (entry?.narrationFingerprint === undefined) return;

      const currentNarration = computeNarrationFingerprint(locale);
      expect(
        entry.narrationFingerprint,
        `Stale narration in tutorial recording: ${recordingFileName(locale)}\n` +
          `One or more narration mp3 files under ` +
          `client/public/withdrawal-video/narration/${locale}/ have changed ` +
          `since this locale was last recorded — the MP4's audio bed is out of date.\n` +
          `Re-record it (which refreshes the manifest):\n` +
          `  bash video/scripts/record-videos.sh ${locale}`,
      ).toBe(currentNarration);
    },
  );
});
