#!/usr/bin/env node
// check-recordings-fresh.mjs — guard that exits non-zero when any committed
// tutorial MP4 is stale relative to the animation source or narration audio.
//
// "Stale" means the fingerprint stored in recordings.manifest.json at record
// time no longer matches the current on-disk content:
//   • sourceFingerprint — sha256 of captions.ts, scene *.tsx files, lib
//     helpers, and video/scene-durations.json (the shared animation source;
//     see recordingFingerprint.mjs).
//   • narrationFingerprint — sha256 of the locale's per-scene mp3 files.
//
// Why content-based instead of mtime-based: CI checks out a shallow clone and
// resets all mtimes to the checkout timestamp, making mtime comparisons
// meaningless. Content hashes are stable and repo-portable.
//
// Usage:
//   node video/scripts/check-recordings-fresh.mjs          # all locales
//   node video/scripts/check-recordings-fresh.mjs en de    # subset
//   npm run check:recordings

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_LOCALES,
  MANIFEST_PATH,
  RECORDINGS_DIR,
  computeSourceFingerprint,
  computeNarrationFingerprint,
  recordingFileName,
} from "./recordingFingerprint.mjs";

const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const locales = requested.length
  ? requested.filter((l) => ALL_LOCALES.includes(l))
  : ALL_LOCALES;

if (requested.length && locales.length !== requested.length) {
  const unknown = requested.filter((l) => !ALL_LOCALES.includes(l));
  console.error(`Unknown locale(s): ${unknown.join(", ")}`);
  console.error(`Supported: ${ALL_LOCALES.join(", ")}`);
  process.exit(1);
}

// Load the manifest written by record-videos.mjs.
let manifest = { locales: {} };
if (existsSync(MANIFEST_PATH)) {
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    if (parsed?.locales) manifest = parsed;
  } catch {
    console.error(`Failed to parse ${MANIFEST_PATH} — treating all locales as stale.`);
  }
}

const currentSource = computeSourceFingerprint();

const stale = [];
const ok = [];
const missing = [];

for (const locale of locales) {
  const mp4Path = join(RECORDINGS_DIR, recordingFileName(locale));

  if (!existsSync(mp4Path)) {
    missing.push({ locale, reason: "MP4 not found" });
    continue;
  }

  const entry = manifest.locales?.[locale];

  if (!entry) {
    stale.push({ locale, reason: "not in manifest (never recorded with this tool)" });
    continue;
  }

  const reasons = [];

  // 1. Animation source check (captions, scenes, lib helpers).
  if (entry.sourceFingerprint !== currentSource) {
    reasons.push("animation source changed (captions / scenes / lib helpers)");
  }

  // 2. Narration audio check (mp3 file contents).
  //    Skip if the manifest pre-dates narration tracking (entry has no field).
  if (entry.narrationFingerprint !== undefined) {
    const currentNarration = computeNarrationFingerprint(locale);
    if (entry.narrationFingerprint !== currentNarration) {
      reasons.push("narration audio changed (mp3 files)");
    }
  }

  if (reasons.length) {
    stale.push({ locale, reason: reasons.join("; ") });
  } else {
    ok.push(locale);
  }
}

// Report.
if (ok.length) {
  console.log(`✓ Fresh (${ok.length}): ${ok.join(", ")}`);
}

if (stale.length || missing.length) {
  console.error("");
  for (const { locale, reason } of stale) {
    console.error(`✗ Stale    [${locale}] ${reason}`);
  }
  for (const { locale, reason } of missing) {
    console.error(`✗ Missing  [${locale}] ${reason}`);
  }
  console.error("");
  const toRecord = [
    ...stale.map((s) => s.locale),
    ...missing.map((m) => m.locale),
  ].join(" ");
  console.error(
    `Re-record the stale/missing locales:\n` +
    `  bash video/scripts/record-videos.sh ${toRecord}\n` +
    `Then commit the updated MP4s and recordings.manifest.json.`,
  );
  process.exit(1);
}

console.log("All checked tutorial MP4s are up to date.");
