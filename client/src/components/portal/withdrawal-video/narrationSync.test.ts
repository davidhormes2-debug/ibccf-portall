// @vitest-environment node
//
// Guard against the withdrawal-tutorial narration drifting out of sync with the
// video. The voiceover relies on two invariants staying true:
//
//   1. A narration MP3 exists for every locale x scene-key combination, served
//      from `client/public/withdrawal-video/narration/<locale>/<sceneKey>.mp3`.
//      A missing file silently 404s at runtime (the audio just never plays).
//   2. Each clip is short enough to finish before its scene cuts to the next
//      one. The scene lengths live in `SCENE_DURATIONS` (VideoTemplate.tsx); a
//      clip longer than its scene gets cut off mid-sentence.
//
// We measure each clip's real duration with ffprobe and assert it finishes at
// least `BUFFER_MS` before the scene ends, so re-generated TTS that grows past
// its window fails CI instead of shipping truncated audio.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

import {
  VIDEO_CAPTIONS,
  NARRATION_SCENE_KEYS,
  type VideoLocaleCode,
} from "./captions";
// Import the SAME SCENE_DURATIONS that VideoTemplate uses for runtime playback,
// so this guard can never drift from the durations the video actually runs at.
import { SCENE_DURATIONS } from "./sceneDurations";

const NARRATION_DIR = path.resolve(
  __dirname,
  "../../../../public/withdrawal-video/narration",
);

// A clip must finish at least this long before its scene cuts, leaving headroom
// for playback start latency and a clean tail. Current clips all clear this with
// room to spare; tightening narration past this margin should fail the test.
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

describe("withdrawal-video narration sync", () => {
  it("SCENE_DURATIONS covers exactly the narration scene keys", () => {
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
