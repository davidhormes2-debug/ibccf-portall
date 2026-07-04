#!/usr/bin/env tsx
// generate-narration.ts — regenerate per-scene narration MP3s from the caption
// strings and re-stamp the freshness manifest in one step.
//
// Replaces the manual two-step process:
//   1. Generate audio via ElevenLabs externally
//   2. npx tsx scripts/update-narration-manifest.ts
//
// This script calls the ElevenLabs TTS API for each locale/scene using
// `buildNarrationScript()` as the single source of truth for spoken text, then
// stamps `narration.manifest.json` with the current fingerprints so
// narrationFreshness.test.ts and narrationSync.test.ts pass without any extra
// step.
//
// Settings (as documented):
//   model : eleven_multilingual_v2
//   voice : George  (default voice ID: JBFqnCBsd6RMkjVDRZzb)
//   speed : 1.1
//
// Usage:
//   ELEVENLABS_API_KEY=sk_... npx tsx scripts/generate-narration.ts
//   npx tsx scripts/generate-narration.ts en de          # subset of locales
//   npx tsx scripts/generate-narration.ts --dry-run      # print scripts, skip API
//   npx tsx scripts/generate-narration.ts --voice-id <id>  # override voice
//
// Environment:
//   ELEVENLABS_API_KEY  — required (unless --dry-run)

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { relative, join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  ALL_LOCALES,
  NARRATION_DIR,
  NARRATION_MANIFEST_PATH,
  NARRATION_SCENE_KEYS,
  computeScriptFingerprint,
  narrationPath,
  narrationRelFile,
  narrationScript,
} from "../client/src/components/portal/withdrawal-video/narrationFingerprint";
import type { VideoLocaleCode } from "../client/src/components/portal/withdrawal-video/captions";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George
const EXPECTED_VOICE_NAME = "George";
const MODEL_ID = "eleven_multilingual_v2";
const SPEED = 1.1;

const REPO_ROOT = process.cwd();
const rel = (p: string) => relative(REPO_ROOT, p);

// After narration mp3s are written, check whether the committed tutorial MP4
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

function parseArgs(): {
  locales: VideoLocaleCode[];
  dryRun: boolean;
  voiceId: string;
} {
  const raw = process.argv.slice(2);
  const dryRun = raw.includes("--dry-run");

  let voiceId = DEFAULT_VOICE_ID;
  const voiceIdIdx = raw.indexOf("--voice-id");
  if (voiceIdIdx !== -1) {
    const next = raw[voiceIdIdx + 1];
    if (!next || next.startsWith("--")) {
      console.error("--voice-id requires a value");
      process.exit(1);
    }
    voiceId = next;
  }

  const requested = raw.filter(
    (a) => !a.startsWith("--") && raw[raw.indexOf(a) - 1] !== "--voice-id",
  );
  const unknown = requested.filter(
    (l) => !ALL_LOCALES.includes(l as VideoLocaleCode),
  );
  if (unknown.length) {
    console.error(`Unknown locale(s): ${unknown.join(", ")}`);
    console.error(`Supported: ${ALL_LOCALES.join(", ")}`);
    process.exit(1);
  }
  const locales = (
    requested.length ? requested : ALL_LOCALES
  ) as VideoLocaleCode[];
  return { locales, dryRun, voiceId };
}

/**
 * Verifies that `voiceId` still resolves to the expected voice name.
 *
 * When `expectedName` is a string the function enforces it: a mismatch or a
 * 404 prints a loud "!!! VOICE ID MISMATCH !!!" banner and exits non-zero so
 * the default "George" voice can never silently drift to a different voice.
 *
 * When `expectedName` is null (custom --voice-id override) the function is
 * purely informational: it logs whatever name the API returns and never aborts.
 *
 * A transient network error or non-200 (other than 404) is always a soft warn
 * so connectivity blips don't block legitimate generation runs.
 */
async function verifyVoiceName(
  apiKey: string,
  voiceId: string,
  expectedName: string | null,
): Promise<void> {
  const url = `${ELEVENLABS_API_BASE}/voices/${voiceId}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "xi-api-key": apiKey },
    });
  } catch (networkErr) {
    console.warn(
      `[voice-check] Network error verifying voice ID — skipping check.`,
    );
    console.warn(`  ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`);
    return;
  }

  if (res.status === 404) {
    if (expectedName === null) {
      console.warn(`[voice-check] Voice ID "${voiceId}" not found (404) — proceeding anyway.`);
      return;
    }
    console.error(`\n!!! VOICE ID MISMATCH !!!`);
    console.error(`  Voice ID "${voiceId}" was NOT FOUND in the ElevenLabs voice library.`);
    console.error(`  The "${expectedName}" voice may have been retired or the ID may have changed.`);
    console.error(`  Update DEFAULT_VOICE_ID in scripts/generate-narration.ts before regenerating audio.`);
    console.error();
    process.exit(1);
  }

  if (!res.ok) {
    console.warn(
      `[voice-check] Could not verify voice ID (HTTP ${res.status}) — skipping check.`,
    );
    return;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    console.warn(`[voice-check] Could not parse voice metadata — skipping check.`);
    return;
  }

  const actualName: unknown =
    body && typeof body === "object" && "name" in body
      ? (body as Record<string, unknown>).name
      : undefined;

  if (typeof actualName !== "string") {
    console.warn(`[voice-check] Voice metadata missing "name" field — skipping check.`);
    return;
  }

  // Custom --voice-id override: informational only, never enforced.
  if (expectedName === null) {
    console.log(`[voice-check] Using custom voice "${actualName}" (${voiceId})`);
    return;
  }

  if (actualName.toLowerCase() !== expectedName.toLowerCase()) {
    console.error(`\n!!! VOICE ID MISMATCH !!!`);
    console.error(`  Voice ID "${voiceId}" resolves to "${actualName}", not "${expectedName}".`);
    console.error(`  ElevenLabs may have remapped or retired the "${expectedName}" voice.`);
    console.error(`  Update DEFAULT_VOICE_ID (and EXPECTED_VOICE_NAME if needed) in`);
    console.error(`  scripts/generate-narration.ts before regenerating audio.`);
    console.error();
    process.exit(1);
  }

  console.log(`[voice-check] Voice ID "${voiceId}" confirmed as "${actualName}" ✓`);
}

async function callElevenLabs(
  apiKey: string,
  voiceId: string,
  text: string,
): Promise<Uint8Array> {
  const url = `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`;
  const body = JSON.stringify({
    text,
    model_id: MODEL_ID,
    voice_settings: {
      speed: SPEED,
    },
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "<unreadable>");
    throw new Error(
      `ElevenLabs API error ${res.status} for voice ${voiceId}: ${errText}`,
    );
  }

  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function loadManifest(): Manifest {
  if (existsSync(NARRATION_MANIFEST_PATH)) {
    try {
      const parsed = JSON.parse(
        readFileSync(NARRATION_MANIFEST_PATH, "utf8"),
      );
      if (parsed && typeof parsed === "object" && parsed.locales) {
        return parsed as Manifest;
      }
    } catch {
      // Corrupt/legacy manifest — start fresh.
    }
  }
  return { locales: {} };
}

function stampManifest(
  manifest: Manifest,
  locales: VideoLocaleCode[],
  generatedAt: string,
): void {
  for (const locale of locales) {
    const scenes: Record<string, SceneEntry> = {};
    for (const sceneKey of NARRATION_SCENE_KEYS) {
      scenes[sceneKey] = {
        file: narrationRelFile(locale, sceneKey),
        scriptFingerprint: computeScriptFingerprint(locale, sceneKey),
        generatedAt,
      };
    }
    manifest.locales[locale] = { scenes };
  }
  writeFileSync(
    NARRATION_MANIFEST_PATH,
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

async function main(): Promise<void> {
  const { locales, dryRun, voiceId } = parseArgs();

  const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
  if (!dryRun && !apiKey) {
    console.error(
      "ELEVENLABS_API_KEY is not set. Export it or pass --dry-run to preview scripts.",
    );
    process.exit(1);
  }

  console.log(`Locales  : ${locales.join(", ")}`);
  console.log(`Model    : ${MODEL_ID}`);
  console.log(`Voice ID : ${voiceId}`);
  console.log(`Speed    : ${SPEED}`);
  console.log(`Dry run  : ${dryRun}`);
  console.log();

  if (dryRun) {
    for (const locale of locales) {
      for (const sceneKey of NARRATION_SCENE_KEYS) {
        const script = narrationScript(locale, sceneKey);
        console.log(`[${locale}/${sceneKey}] ${script}`);
        console.log();
      }
    }
    console.log(
      "Dry run complete — no audio generated and manifest not updated.",
    );
    return;
  }

  // Verify that the default voice ID still maps to "George" before spending
  // API credits on potentially wrong audio. Custom --voice-id overrides are
  // user-controlled so we only log the resolved name without enforcing it.
  await verifyVoiceName(
    apiKey,
    voiceId,
    voiceId === DEFAULT_VOICE_ID ? EXPECTED_VOICE_NAME : null,
  );

  const generatedAt = new Date().toISOString();
  const manifest = loadManifest();
  let failed = 0;

  for (const locale of locales) {
    const localeDir = `${NARRATION_DIR}/${locale}`;
    if (!existsSync(localeDir)) {
      mkdirSync(localeDir, { recursive: true });
    }

    for (const sceneKey of NARRATION_SCENE_KEYS) {
      const script = narrationScript(locale, sceneKey);
      const outPath = narrationPath(locale, sceneKey);
      process.stdout.write(
        `  generating ${locale}/${sceneKey}.mp3 … `,
      );

      try {
        const audio = await callElevenLabs(apiKey, voiceId, script);
        writeFileSync(outPath, audio);
        console.log(`done (${audio.byteLength} bytes)`);
      } catch (err) {
        console.error(`FAILED`);
        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }
  }

  if (failed > 0) {
    console.warn(
      `\n! ${failed} clip(s) failed. Manifest will not be updated for failed clips.`,
    );
    console.warn(
      "  Fix the errors above, then re-run to regenerate the missing clips.",
    );
    process.exit(1);
  }

  // All clips written — stamp the manifest so freshness tests pass.
  stampManifest(manifest, locales, generatedAt);
  console.log(
    `\nUpdated ${rel(NARRATION_MANIFEST_PATH)} for: ${locales.join(", ")}`,
  );

  // New audio means the committed MP4 recordings are potentially stale.
  // Run the freshness check and surface a clear warning if re-recording is needed.
  warnIfRecordingsStale(locales.map(String));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
