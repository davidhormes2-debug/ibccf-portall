#!/usr/bin/env tsx
// update-narration-manifest.ts — stamp the narration manifest with the current
// per-locale/scene script fingerprints.
//
// Run this AFTER (re)generating the narration MP3s in
// client/public/withdrawal-video/narration/<locale>/<sceneKey>.mp3 so the
// freshness guard (narrationFreshness.test.ts) knows the audio matches the
// caption strings it was generated from. The fingerprint is a content hash of
// the spoken script composed by buildNarrationScript() — see
// client/src/components/portal/withdrawal-video/narrationFingerprint.ts.
//
// Usage:
//   npx tsx scripts/update-narration-manifest.ts            # all locales
//   npx tsx scripts/update-narration-manifest.ts en de      # a subset
//
// Mirrors the recordings manifest written by video/scripts/record-videos.mjs.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  ALL_LOCALES,
  NARRATION_MANIFEST_PATH,
  NARRATION_SCENE_KEYS,
  computeScriptFingerprint,
  narrationPath,
  narrationRelFile,
} from "../client/src/components/portal/withdrawal-video/narrationFingerprint";
import type { VideoLocaleCode } from "../client/src/components/portal/withdrawal-video/captions";

interface SceneEntry {
  file: string;
  scriptFingerprint: string;
  generatedAt: string;
}

interface LocaleEntry {
  scenes: Record<string, SceneEntry>;
}

interface Manifest {
  locales: Record<string, LocaleEntry>;
}

const REPO_ROOT = process.cwd();
const rel = (p: string) => relative(REPO_ROOT, p);

// After narration mp3s are stamped, check whether the committed tutorial MP4
// recordings are now stale (their narrationFingerprint no longer matches the
// freshly-generated audio). Prints a boxed warning naming each stale locale
// and the exact re-record command. Never exits non-zero — this is advisory.
function warnIfRecordingsStale(locales: string[]): void {
  const checkScript = join(REPO_ROOT, "video", "scripts", "check-recordings-fresh.mjs");
  if (!existsSync(checkScript)) return;

  const result = spawnSync("node", [checkScript, ...locales], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  if (result.status === 0) return;

  const output = (result.stderr ?? "") + (result.stdout ?? "");
  const staleLines = output
    .split("\n")
    .filter((l) => l.startsWith("✗"))
    .map((l) => l.trim());
  const staleLocales = staleLines
    .map((l) => {
      const m = l.match(/\[([a-z]{2})\]/);
      return m ? m[1] : null;
    })
    .filter(Boolean) as string[];

  console.warn("\n┌─────────────────────────────────────────────────────────────┐");
  console.warn("│  ⚠  Tutorial MP4 recordings are now STALE                   │");
  console.warn("│     The narration audio changed — re-record the MP4s.        │");
  console.warn("└─────────────────────────────────────────────────────────────┘");

  if (staleLocales.length) {
    console.warn(`\nStale locale(s): ${staleLocales.join(", ")}`);
    console.warn(`\nRe-record with:`);
    console.warn(`  bash video/scripts/record-videos.sh ${staleLocales.join(" ")}`);
  } else {
    console.warn("\nRun 'npm run check:recordings' to see which locales need re-recording.");
    console.warn("Re-record with:");
    console.warn(`  bash video/scripts/record-videos.sh ${locales.join(" ")}`);
  }

  console.warn("\nThen commit the updated MP4s and recordings.manifest.json.\n");
}

const args = process.argv.slice(2);
const dryRun = args.includes("--check") || args.includes("--dry-run");
const requested = args.filter((a) => !a.startsWith("--"));
const unknown = requested.filter(
  (l) => !ALL_LOCALES.includes(l as VideoLocaleCode),
);
if (unknown.length) {
  console.error(`Unknown locale(s): ${unknown.join(", ")}`);
  console.error(`Supported locales: ${ALL_LOCALES.join(", ")}`);
  process.exit(1);
}
const locales = (requested.length ? requested : ALL_LOCALES) as VideoLocaleCode[];

let manifest: Manifest = { locales: {} };
if (existsSync(NARRATION_MANIFEST_PATH)) {
  try {
    const parsed = JSON.parse(readFileSync(NARRATION_MANIFEST_PATH, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.locales) {
      manifest = parsed as Manifest;
    }
  } catch {
    // Corrupt/legacy manifest — start fresh rather than abort.
  }
}

// --check / --dry-run: compare current caption fingerprints against the
// committed manifest and exit non-zero if any locale/scene is stale.
// Nothing is written; this is safe to run in CI without side effects.
if (dryRun) {
  const stale: string[] = [];
  const missingEntry: string[] = [];

  for (const locale of locales) {
    for (const sceneKey of NARRATION_SCENE_KEYS) {
      const expected = computeScriptFingerprint(locale, sceneKey);
      const entry = manifest.locales?.[locale]?.scenes?.[sceneKey];
      if (!entry) {
        missingEntry.push(`${locale}/${sceneKey}`);
      } else if (entry.scriptFingerprint !== expected) {
        stale.push(`${locale}/${sceneKey}`);
      }
    }
  }

  if (stale.length === 0 && missingEntry.length === 0) {
    console.log(
      `✓ Narration manifest is up to date for: ${locales.join(", ")}`,
    );
    process.exit(0);
  }

  if (stale.length) {
    console.error(
      `✗ Stale narration manifest entries (caption script changed):\n` +
        stale.map((s) => `  ${s}`).join("\n"),
    );
  }
  if (missingEntry.length) {
    console.error(
      `✗ Missing manifest entries (never stamped):\n` +
        missingEntry.map((s) => `  ${s}`).join("\n"),
    );
  }
  console.error(
    `\nRegenerate the narration audio, then re-stamp the manifest:\n` +
      `  npm run narration:generate\n` +
      `  npm run narration:stamp`,
  );
  process.exit(1);
}

const generatedAt = new Date().toISOString();
const missing: string[] = [];

for (const locale of locales) {
  const scenes: Record<string, SceneEntry> = {};
  for (const sceneKey of NARRATION_SCENE_KEYS) {
    const mp3 = narrationPath(locale, sceneKey);
    if (!existsSync(mp3)) {
      missing.push(rel(mp3));
    }
    scenes[sceneKey] = {
      file: narrationRelFile(locale, sceneKey),
      scriptFingerprint: computeScriptFingerprint(locale, sceneKey),
      generatedAt,
    };
  }
  manifest.locales[locale] = { scenes };
}

if (missing.length) {
  console.warn(
    `! Stamping manifest but these MP3s are missing on disk:\n  ${missing.join("\n  ")}`,
  );
}

writeFileSync(
  NARRATION_MANIFEST_PATH,
  JSON.stringify(manifest, null, 2) + "\n",
);

console.log(
  `Updated ${rel(NARRATION_MANIFEST_PATH)} for: ${locales.join(", ")}`,
);

// New audio means the committed MP4 recordings are potentially stale.
// Run the freshness check and surface a clear warning if re-recording is needed.
warnIfRecordingsStale(locales.map(String));
