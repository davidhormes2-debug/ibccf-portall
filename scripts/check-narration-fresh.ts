#!/usr/bin/env tsx
// check-narration-fresh.ts — guard that exits non-zero when any committed
// narration MP3 is stale relative to the caption strings it was generated from.
//
// "Stale" means the scriptFingerprint stored in narration.manifest.json at
// generation time no longer matches the hash of the spoken script that
// buildNarrationScript() would compose today from the current captions.ts.
//
// Why this matters: captions.ts is the single source of truth for both the
// visible on-screen text and the audio voiceover. Editing a caption that feeds
// the narration script (e.g. a phase title or step label) without regenerating
// the audio leaves users hearing stale audio over fresh on-screen text, and a
// longer re-generated clip may overrun its SCENE_DURATIONS window.
//
// Why content-based fingerprints instead of mtimes: CI checks out a shallow
// clone and resets all mtimes to the checkout timestamp, making mtime
// comparisons meaningless. The scriptFingerprint is a sha256 of the composed
// spoken text (locale + sceneKey + script), which is stable and repo-portable.
//
// Usage:
//   npx tsx scripts/check-narration-fresh.ts          # all locales
//   npx tsx scripts/check-narration-fresh.ts en de    # subset
//   npm run check:narration
//
// When this fails, regenerate audio and re-stamp the manifest:
//   ELEVENLABS_API_KEY=sk_... npx tsx scripts/generate-narration.ts <locale...>
//   # or, if you have already replaced the MP3s manually:
//   npx tsx scripts/update-narration-manifest.ts <locale...>

import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";

import {
  ALL_LOCALES,
  NARRATION_MANIFEST_PATH,
  NARRATION_SCENE_KEYS,
  computeScriptFingerprint,
  narrationPath,
} from "../client/src/components/portal/withdrawal-video/narrationFingerprint";
import type { VideoLocaleCode } from "../client/src/components/portal/withdrawal-video/captions";

const REPO_ROOT = process.cwd();
const rel = (p: string) => relative(REPO_ROOT, p);

// Parse locale arguments (optional subset).
const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const unknown = requested.filter(
  (l) => !ALL_LOCALES.includes(l as VideoLocaleCode),
);
if (unknown.length) {
  console.error(`Unknown locale(s): ${unknown.join(", ")}`);
  console.error(`Supported: ${ALL_LOCALES.join(", ")}`);
  process.exit(1);
}
const locales = (requested.length ? requested : ALL_LOCALES) as VideoLocaleCode[];

// Load the narration manifest.
interface SceneEntry {
  file?: string;
  scriptFingerprint?: string;
  generatedAt?: string;
}
interface Manifest {
  locales?: Record<string, { scenes?: Record<string, SceneEntry> }>;
}

let manifest: Manifest = { locales: {} };
if (!existsSync(NARRATION_MANIFEST_PATH)) {
  console.error(
    `Missing narration manifest: ${rel(NARRATION_MANIFEST_PATH)}\n` +
      `Generate it: npx tsx scripts/update-narration-manifest.ts`,
  );
  process.exit(1);
}
try {
  const parsed = JSON.parse(readFileSync(NARRATION_MANIFEST_PATH, "utf8")) as Manifest;
  if (parsed && typeof parsed === "object" && parsed.locales) {
    manifest = parsed;
  }
} catch {
  console.error(
    `Failed to parse ${rel(NARRATION_MANIFEST_PATH)} — treating all locales as stale.`,
  );
}

// Check each locale/scene.
type StaleEntry = { locale: string; sceneKey: string; reason: string };
const stale: StaleEntry[] = [];
const ok: string[] = [];
const missing: { locale: string; sceneKey: string; reason: string }[] = [];

for (const locale of locales) {
  for (const sceneKey of NARRATION_SCENE_KEYS) {
    const mp3 = narrationPath(locale, sceneKey);

    if (!existsSync(mp3)) {
      missing.push({ locale, sceneKey, reason: "MP3 not found" });
      continue;
    }

    const entry = manifest.locales?.[locale]?.scenes?.[sceneKey];
    if (!entry) {
      stale.push({
        locale,
        sceneKey,
        reason: "not in manifest (never stamped with this tool)",
      });
      continue;
    }

    const current = computeScriptFingerprint(locale, sceneKey);
    if (entry.scriptFingerprint !== current) {
      stale.push({
        locale,
        sceneKey,
        reason: "caption script changed — audio no longer matches on-screen text",
      });
    } else {
      ok.push(`${locale}/${sceneKey}`);
    }
  }
}

// Report.
if (ok.length) {
  console.log(`✓ Fresh (${ok.length} clips): ${ok.join(", ")}`);
}

if (stale.length || missing.length) {
  console.error("");
  for (const { locale, sceneKey, reason } of stale) {
    console.error(`✗ Stale   [${locale}/${sceneKey}] ${reason}`);
  }
  for (const { locale, sceneKey, reason } of missing) {
    console.error(`✗ Missing [${locale}/${sceneKey}] ${reason}`);
  }
  console.error("");

  const affectedLocales = [
    ...new Set([
      ...stale.map((s) => s.locale),
      ...missing.map((m) => m.locale),
    ]),
  ].join(" ");

  console.error(
    `Caption script(s) have changed since the narration audio was last generated.\n` +
      `Regenerate the affected clips, then re-stamp the manifest:\n` +
      `  ELEVENLABS_API_KEY=sk_... npx tsx scripts/generate-narration.ts ${affectedLocales}\n` +
      `\n` +
      `If you have already replaced the MP3 files manually, re-stamp only:\n` +
      `  npx tsx scripts/update-narration-manifest.ts ${affectedLocales}`,
  );
  process.exit(1);
}

console.log(
  `All ${locales.length * NARRATION_SCENE_KEYS.length} checked narration clips match their caption scripts.`,
);
