// narrationFingerprint.ts — single source of truth for deciding whether the
// per-scene narration MP3s are stale relative to the caption strings they were
// generated from.
//
// The withdrawal tutorial's voiceover is a set of static TTS clips at
// `client/public/withdrawal-video/narration/<locale>/<sceneKey>.mp3`. Their
// spoken wording is NOT free-form: it is composed from the on-screen caption
// strings via `buildNarrationScript()` (captions.ts), which is the single
// source of truth for both the visible copy and the audio. If a caption that
// feeds the narration script changes and nobody regenerates the audio, users
// hear stale narration over fresh on-screen text — and a longer re-generated
// clip may no longer fit its `SCENE_DURATIONS` window.
//
// We can't rely on file mtimes or git timestamps to detect this: CI checks out
// the repo shallow (actions/checkout default depth 1) and resets every file's
// mtime to the checkout time, so both signals are meaningless there. Instead we
// fingerprint the *spoken script text* per locale/scene by content (sha256) and
// persist that fingerprint into a manifest committed next to the MP3s
// (narration.manifest.json). Regenerating the audio rewrites the manifest; a
// later caption edit that changes a script changes its fingerprint, so the
// freshness test can name exactly which locale/scene narration is out of date.
//
// This deliberately fingerprints the composed script (not the whole captions
// table): editing a caption field that does NOT feed the narration — e.g. a
// per-stage title or a role label — leaves the audio correct and must not be
// flagged. Only changes to what is actually spoken count.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  VIDEO_CAPTIONS,
  NARRATION_SCENE_KEYS,
  buildNarrationScript,
  type VideoLocaleCode,
  type NarrationSceneKey,
} from "./captions";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

// client/src/components/portal/withdrawal-video -> repo root (5 levels up)
export const REPO_ROOT = join(MODULE_DIR, "..", "..", "..", "..", "..");

// client/src/components/portal/withdrawal-video -> client/public/withdrawal-video/narration
export const NARRATION_DIR = join(
  MODULE_DIR,
  "..",
  "..",
  "..",
  "..",
  "public",
  "withdrawal-video",
  "narration",
);

export const NARRATION_MANIFEST_PATH = join(
  NARRATION_DIR,
  "narration.manifest.json",
);

export const ALL_LOCALES = Object.keys(VIDEO_CAPTIONS) as VideoLocaleCode[];

export { NARRATION_SCENE_KEYS };

/** Relative file path (POSIX) stored in the manifest for a locale/scene clip. */
export function narrationRelFile(
  locale: VideoLocaleCode,
  sceneKey: NarrationSceneKey,
): string {
  return `${locale}/${sceneKey}.mp3`;
}

/** Absolute path to the narration MP3 for a locale/scene. */
export function narrationPath(
  locale: VideoLocaleCode,
  sceneKey: NarrationSceneKey,
): string {
  return join(NARRATION_DIR, locale, `${sceneKey}.mp3`);
}

/** The exact spoken script for a locale/scene (single source of truth). */
export function narrationScript(
  locale: VideoLocaleCode,
  sceneKey: NarrationSceneKey,
): string {
  return buildNarrationScript(VIDEO_CAPTIONS[locale])[sceneKey];
}

// Content fingerprint (sha256) of the spoken script for one locale/scene. The
// locale and scene key are folded into the hash so an accidental file/key mixup
// can never collide with another scene's fingerprint.
export function computeScriptFingerprint(
  locale: VideoLocaleCode,
  sceneKey: NarrationSceneKey,
): string {
  const hash = createHash("sha256");
  hash.update(locale);
  hash.update("\0");
  hash.update(sceneKey);
  hash.update("\0");
  hash.update(narrationScript(locale, sceneKey));
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Source-file fingerprint — narration-side parallel to listSourceFiles() /
// computeSourceFingerprint() in video/scripts/recordingFingerprint.mjs.
//
// The per-scene script fingerprints (computeScriptFingerprint) are derived
// entirely from the TEXT in captions.ts via buildNarrationScript(). If
// captions.ts were silently renamed or moved, the import would break at
// load-time — but a future refactor could introduce additional source files
// that feed the script without being listed here.  Pinning the discovered
// source set in a unit test catches that before a stale freshness guard ships.
// ---------------------------------------------------------------------------

/**
 * The TypeScript source files whose content fully determines what each
 * per-locale narration script says. Any edit to these files can alter the
 * spoken wording and therefore invalidate cached audio.
 *
 * This is intentionally a static list (not a glob) so that adding a new
 * source file without updating the list is caught by the coverage test.
 */
export function listNarrationSourceFiles(): string[] {
  return [
    join(REPO_ROOT, "shared", "videoCaptions.ts"),
    join(MODULE_DIR, "narrationFingerprint.ts"),
  ];
}

/**
 * Content fingerprint (sha256) of the narration source files. The
 * REPO_ROOT-relative path is folded into the hash alongside the file content
 * so a rename alone changes the fingerprint — matching the fold-in algorithm
 * used by computeSourceFingerprint() in recordingFingerprint.mjs.
 *
 * `files` is injectable for tests: pass a controlled fixture list to assert
 * fingerprint sensitivity without touching the real source files.
 */
export function computeNarrationSourceFingerprint(
  files: string[] = listNarrationSourceFiles(),
): string {
  const hash = createHash("sha256");
  for (const file of files) {
    const rel = relative(REPO_ROOT, file).split("\\").join("/");
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}
