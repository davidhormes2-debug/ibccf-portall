// @vitest-environment node
//
// Guard: the recorded narration MP3s must not go stale relative to the caption
// strings they were generated from.
//
// The withdrawal tutorial's voiceover clips at
// `client/public/withdrawal-video/narration/<locale>/<sceneKey>.mp3` are static
// TTS audio whose spoken wording is composed from the on-screen captions via
// `buildNarrationScript()`. The sibling narrationSync.test.ts checks that a clip
// EXISTS and FITS its scene window — but it cannot tell whether the audio still
// matches the current caption text. If a caption that feeds the script changes
// and nobody regenerates the audio, users hear stale narration over fresh
// on-screen text.
//
// We detect that by fingerprinting the spoken script per locale/scene by content
// and comparing it to the fingerprint persisted when the audio was last
// generated (narration.manifest.json). We deliberately avoid file mtimes / git
// timestamps: CI checks out the repo shallow and resets every mtime to the
// checkout time, so those signals are meaningless there.
//
// When this fails, regenerate the affected narration audio, then re-stamp the
// manifest:
//   npx tsx scripts/update-narration-manifest.ts <locale...>

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";

import {
  ALL_LOCALES,
  NARRATION_MANIFEST_PATH,
  NARRATION_SCENE_KEYS,
  computeScriptFingerprint,
  narrationPath,
} from "./narrationFingerprint";

const REPO_ROOT = process.cwd();
const rel = (p: string) => relative(REPO_ROOT, p);

interface SceneEntry {
  file?: string;
  scriptFingerprint?: string;
  generatedAt?: string;
}

interface Manifest {
  locales?: Record<string, { scenes?: Record<string, SceneEntry> }>;
}

function readManifest(): Manifest {
  if (!existsSync(NARRATION_MANIFEST_PATH)) {
    throw new Error(
      `Missing narration manifest: ${rel(NARRATION_MANIFEST_PATH)}\n` +
        `Generate it: npx tsx scripts/update-narration-manifest.ts`,
    );
  }
  return JSON.parse(readFileSync(NARRATION_MANIFEST_PATH, "utf8")) as Manifest;
}

describe("withdrawal tutorial: narration audio vs caption-script freshness", () => {
  const manifest = readManifest();

  const cases = ALL_LOCALES.flatMap((locale) =>
    NARRATION_SCENE_KEYS.map((sceneKey) => ({ locale, sceneKey })),
  );

  it.each(cases)(
    "$locale/$sceneKey narration is up to date with its caption script",
    ({ locale, sceneKey }) => {
      const mp3 = narrationPath(locale, sceneKey);
      expect(
        existsSync(mp3),
        `Missing narration MP3: ${rel(mp3)} — regenerate it and re-stamp ` +
          `the manifest: \`npx tsx scripts/update-narration-manifest.ts ${locale}\`.`,
      ).toBe(true);

      const entry = manifest.locales?.[locale]?.scenes?.[sceneKey];
      expect(
        entry,
        `No manifest entry for "${locale}/${sceneKey}" in ` +
          `${rel(NARRATION_MANIFEST_PATH)}. Re-stamp it: ` +
          `\`npx tsx scripts/update-narration-manifest.ts ${locale}\`.`,
      ).toBeTruthy();

      expect(
        entry?.scriptFingerprint,
        `Stale narration audio: ${locale}/${sceneKey}.mp3\n` +
          `The caption script for this scene has changed since the audio was ` +
          `last generated, so the voiceover no longer matches the on-screen ` +
          `copy (and may overrun its scene window).\n` +
          `Regenerate the audio, then re-stamp the manifest:\n` +
          `  npx tsx scripts/update-narration-manifest.ts ${locale}`,
      ).toBe(computeScriptFingerprint(locale, sceneKey));
    },
  );
});
