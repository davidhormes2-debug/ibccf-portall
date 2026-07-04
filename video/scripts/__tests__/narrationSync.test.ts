// @vitest-environment node
//
// Guard against the standalone recorder's narration drifting out of sync with
// the video. Mirrors the portal guard at
// `client/src/components/portal/withdrawal-video/narrationSync.test.ts` but
// sources its data from the standalone recorder's own copies:
//
//   • SCENE_DURATIONS  — video/scene-durations.json (the shared JSON that both
//     VideoTemplate.tsx copies and record-videos.mjs all import)
//   • NARRATION_SCENE_KEYS / VIDEO_CAPTIONS — video/src/components/video/captions.ts
//     (the recorder's own copy, which can drift from the portal copy)
//   • narration MP3s — client/public/withdrawal-video/narration/<locale>/<key>.mp3
//     (shared between both copies; the recorder reads them at record time)
//
// Two invariants are verified:
//
//   1. A narration MP3 exists for every locale × scene-key combination. A
//      missing file silently 404s at runtime (the audio just never plays).
//   2. Each clip finishes at least BUFFER_MS before its scene cuts to the
//      next one. A clip longer than its scene gets truncated in the recording.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

import {
  VIDEO_CAPTIONS,
  NARRATION_SCENE_KEYS,
  type VideoLocaleCode,
} from "../../src/components/video/captions";
import SCENE_DURATIONS_RAW from "../../scene-durations.json";

// Cast to the keyed type expected by the assertions below.
const SCENE_DURATIONS = SCENE_DURATIONS_RAW as Record<string, number>;

// Narration MP3s are shared between the portal and the standalone recorder.
// The recorder reads them from this path at record time (confirmed by
// video/scripts/recordingFingerprint.mjs → NARRATION_BASE).
const NARRATION_DIR = path.resolve(
  __dirname,
  "../../../client/public/withdrawal-video/narration",
);

// A clip must finish at least this long before its scene cuts, leaving headroom
// for playback-start latency and a clean tail. Matches the portal guard's margin.
const BUFFER_MS = 500;

const LOCALES = Object.keys(VIDEO_CAPTIONS) as VideoLocaleCode[];

function ffprobeDurationMs(filePath: string): number {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf8" },
  );
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) {
    throw new Error(`ffprobe returned no duration for ${filePath}: "${out}"`);
  }
  return seconds * 1000;
}

beforeAll(() => {
  // ffprobe ships with the Replit runtime and CI runs in that environment. The
  // duration check is the whole point of this guard, so fail loudly rather than
  // silently skip if it is ever unavailable.
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "ffprobe is required to measure narration durations but was not found on PATH",
    );
  }
});

describe("standalone recorder narration sync", () => {
  it("scene-durations.json covers exactly the narration scene keys", () => {
    expect(Object.keys(SCENE_DURATIONS).sort()).toEqual(
      [...NARRATION_SCENE_KEYS].sort(),
    );
  });

  for (const locale of LOCALES) {
    for (const sceneKey of NARRATION_SCENE_KEYS) {
      const filePath = path.join(NARRATION_DIR, locale, `${sceneKey}.mp3`);

      it(`has a narration file for ${locale}/${sceneKey}`, () => {
        expect(
          fs.existsSync(filePath),
          `Missing narration MP3: ${filePath}`,
        ).toBe(true);
      });

      it(`narration for ${locale}/${sceneKey} fits within its scene`, () => {
        const durationMs = ffprobeDurationMs(filePath);
        const sceneMs = SCENE_DURATIONS[sceneKey];
        const limitMs = sceneMs - BUFFER_MS;
        expect(
          durationMs,
          `${locale}/${sceneKey}.mp3 is ${durationMs.toFixed(0)}ms but must be ` +
            `<= ${limitMs}ms (scene ${sceneMs}ms - ${BUFFER_MS}ms buffer)`,
        ).toBeLessThanOrEqual(limitMs);
      });
    }
  }
});
