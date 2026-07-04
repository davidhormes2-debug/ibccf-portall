// recordingFingerprint.mjs — single source of truth for deciding whether the
// recorded tutorial MP4s are stale relative to the live animation source.
//
// The withdrawal tutorial is a live React/Framer-Motion animation, but we also
// export one MP4 per locale (video/public/recordings/withdrawal-tutorial-<locale>.mp4)
// for marketing/email/offline use. Those MP4s are a snapshot: if the animation
// source changes and nobody re-records, users watching the live animation see
// fresh captions/scenes while any embedded MP4 is stale.
//
// We can't rely on file mtimes or git timestamps to detect this: CI checks out
// the repo shallow (actions/checkout default depth 1) and resets every file's
// mtime to the checkout time, so both signals are meaningless there. Instead we
// fingerprint the shared animation source by content (sha256) and persist that
// fingerprint per locale into a manifest committed next to the MP4s. Re-recording
// rewrites the manifest; a later source edit changes the fingerprint, so the
// freshness test can name exactly which locale recording is out of date.
//
// The fingerprinted file set covers only the files that actually determine what
// a recorded frame looks like: captions, scene components, and the shared
// animation/hook helpers. All of these now live under shared/video/ (the single
// source of truth). VideoTemplate.tsx is intentionally excluded — the portal
// and recorder versions differ by design and neither changes recorded output.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const NARRATION_BASE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "client",
  "public",
  "withdrawal-video",
  "narration",
);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// video/scripts -> repo root
export const REPO_ROOT = join(SCRIPT_DIR, "..", "..");

// Shared JSON that drives per-scene recording durations. Lives one level above
// SCRIPT_DIR (i.e. video/scene-durations.json).
export const SCENE_DURATIONS_PATH = join(SCRIPT_DIR, "..", "scene-durations.json");

export const ALL_LOCALES = ["en", "es", "fr", "de", "pt", "zh"];

export const RECORDINGS_DIR = join(REPO_ROOT, "video", "public", "recordings");
export const MANIFEST_PATH = join(RECORDINGS_DIR, "recordings.manifest.json");

const PORTAL_DIR = join(
  REPO_ROOT,
  "client",
  "src",
  "components",
  "portal",
  "withdrawal-video",
);

const SHARED_VIDEO_DIR = join(REPO_ROOT, "shared", "video");

export function recordingFileName(locale) {
  return `withdrawal-tutorial-${locale}.mp4`;
}

export function recordingPath(locale) {
  return join(RECORDINGS_DIR, recordingFileName(locale));
}

/**
 * Discover the shared source files. Scenes now live in shared/video/scenes/
 * and lib helpers in shared/video/. Scenes are discovered dynamically so a
 * future Scene6 / renamed scene is covered without editing this list.
 *
 * sceneDurations.ts is the authoritative TypeScript source of SCENE_DURATIONS
 * consumed by the recorder (via hardcoded copies that the sceneDurationsParity
 * test keeps in sync). video/scene-durations.json is the shared JSON version of
 * the same values, used by recorder scripts. Both are included so a change to
 * either file marks all recordings stale — they must be re-recorded with the
 * new timing.
 *
 * ⚠️  If you add, remove, or rename any file returned here, you must also update
 * EXPECTED_RELATIVE_PATHS in `video/scripts/__tests__/recordingFingerprint.test.ts`
 * or CI will fail with a path-set mismatch.
 * Run `npm run fingerprint:update-expected` to patch that constant automatically.
 */
export function listSourceFiles() {
  const scenesDir = join(SHARED_VIDEO_DIR, "scenes");
  const scenes = readdirSync(scenesDir)
    .filter((name) => name.endsWith(".tsx"))
    .sort()
    .map((name) => join(scenesDir, name));

  return [
    join(REPO_ROOT, "shared", "videoCaptions.ts"),
    join(PORTAL_DIR, "sceneDurations.ts"),
    SCENE_DURATIONS_PATH,
    ...scenes,
    join(SHARED_VIDEO_DIR, "animations.ts"),
    join(SHARED_VIDEO_DIR, "hooks.ts"),
    join(SHARED_VIDEO_DIR, "index.ts"),
  ].sort();
}

// Content fingerprint (sha256) of the per-locale narration mp3 files. Scene
// keys are sorted so the hash is stable regardless of readdir order. Missing
// locale directories produce an empty-string fingerprint (no narration yet).
//
// `localeDir` is injectable for tests: pass an absolute path to a controlled
// fixture directory to assert fingerprint sensitivity without touching the real
// narration assets. Defaults to `NARRATION_BASE/<locale>` (the real files).
export function computeNarrationFingerprint(locale, localeDir) {
  const dir = localeDir ?? join(NARRATION_BASE, locale);
  if (!existsSync(dir)) return "";
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".mp3"))
    .sort()
    .map((f) => join(dir, f));
  if (!files.length) return "";
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.split(/[\\/]/).pop()); // filename only — locale already in path
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

// Content fingerprint (sha256) of the shared animation source. The relative
// path is folded into the hash so a rename alone changes the fingerprint.
//
// `files` is injectable for tests: pass a list of absolute paths from a
// controlled fixture tree to assert fingerprint sensitivity without touching
// the real source. Defaults to `listSourceFiles()` (the real discovered set).
export function computeSourceFingerprint(files = listSourceFiles()) {
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

// Given the per-locale results from a record run, return the locales we can
// safely vouch for. A locale that hit the MAX_RECORD_MS ceiling (`timedOut`) is
// suspect — its capture may be truncated — so we skip stamping it rather than
// claim it matches the current source.
export function recordedLocalesFromResults(results) {
  return results.filter((r) => !r.timedOut).map((r) => r.locale);
}

// Read-modify-write the recordings manifest, merging in fresh entries for the
// locales we just recorded. Sequential by design (the shell wrapper records one
// locale per process), so a plain read/merge/write is safe.
//
// Parameterized for testability: `manifestPath`, `fingerprint`,
// `narrationFingerprints`, and `recordedAt` can be injected; in production
// they default to the real manifest path, a freshly computed source
// fingerprint, per-locale narration fingerprints, and the current time.
export async function updateManifest(
  recordedLocales,
  {
    manifestPath = MANIFEST_PATH,
    fingerprint = computeSourceFingerprint(),
    narrationFingerprints = null,
    recordedAt = new Date().toISOString(),
  } = {},
) {
  let manifest = { locales: {} };
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.locales) {
        manifest = parsed;
      }
    } catch {
      // Corrupt/legacy manifest — start fresh rather than abort the record run.
    }
  }

  // Resolve per-locale narration fingerprints. If the caller didn't supply
  // them, compute them now so every record run stamps both dimensions.
  const narrationMap =
    narrationFingerprints ??
    Object.fromEntries(
      recordedLocales.map((l) => [l, computeNarrationFingerprint(l)]),
    );

  for (const locale of recordedLocales) {
    manifest.locales[locale] = {
      file: recordingFileName(locale),
      sourceFingerprint: fingerprint,
      narrationFingerprint: narrationMap[locale] ?? "",
      recordedAt,
    };
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
