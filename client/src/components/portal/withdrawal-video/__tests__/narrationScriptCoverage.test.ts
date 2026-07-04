// @vitest-environment node
//
// Guard: NARRATION_SCENE_KEYS must stay in lockstep with buildNarrationScript().
//
// The narration freshness check (narrationFreshness.test.ts) iterates over
// NARRATION_SCENE_KEYS and uses computeScriptFingerprint() — which internally
// calls buildNarrationScript() — to detect stale audio. That guard is only
// as complete as NARRATION_SCENE_KEYS itself: if a new scene is added to
// buildNarrationScript() but not to NARRATION_SCENE_KEYS, or vice versa, the
// freshness guard silently skips those clips.
//
// This test pins the contract between the two:
//   1. buildNarrationScript(VIDEO_CAPTIONS[locale]) returns a non-empty string
//      for every key listed in NARRATION_SCENE_KEYS, for every supported locale.
//   2. buildNarrationScript() does not return extra keys that are absent from
//      NARRATION_SCENE_KEYS (which would mean the freshness guard silently
//      misses those clips).
//
// The tests use the REAL NARRATION_SCENE_KEYS and the REAL buildNarrationScript
// (no mocking), so any drift between them is caught at unit-test time rather
// than only when a developer notices the audio is wrong.

import { describe, it, expect } from "vitest";
import {
  VIDEO_CAPTIONS,
  NARRATION_SCENE_KEYS,
  buildNarrationScript,
} from "../captions";
import { ALL_LOCALES } from "../narrationFingerprint";

// ---------------------------------------------------------------------------
// Key-set coverage — NARRATION_SCENE_KEYS exactly matches buildNarrationScript
// ---------------------------------------------------------------------------

describe("NARRATION_SCENE_KEYS ↔ buildNarrationScript key-set parity", () => {
  it("buildNarrationScript returns every key listed in NARRATION_SCENE_KEYS for the default locale", () => {
    const script = buildNarrationScript(VIDEO_CAPTIONS["en"]);
    for (const key of NARRATION_SCENE_KEYS) {
      expect(
        Object.prototype.hasOwnProperty.call(script, key),
        `buildNarrationScript() did not return a key for scene "${key}". ` +
          `Add the key to buildNarrationScript() or remove it from NARRATION_SCENE_KEYS.`,
      ).toBe(true);
    }
  });

  it("buildNarrationScript returns no extra keys absent from NARRATION_SCENE_KEYS", () => {
    const script = buildNarrationScript(VIDEO_CAPTIONS["en"]);
    const returnedKeys = Object.keys(script);
    const expectedKeys = [...NARRATION_SCENE_KEYS] as string[];
    const extraKeys = returnedKeys.filter((k) => !expectedKeys.includes(k));
    expect(
      extraKeys,
      `buildNarrationScript() returned keys not listed in NARRATION_SCENE_KEYS: ` +
        `[${extraKeys.join(", ")}]. The freshness guard silently skips these scenes. ` +
        `Add the missing keys to NARRATION_SCENE_KEYS.`,
    ).toEqual([]);
  });

  it("NARRATION_SCENE_KEYS and buildNarrationScript keys are exactly equal (set equality)", () => {
    const script = buildNarrationScript(VIDEO_CAPTIONS["en"]);
    const returnedKeys = Object.keys(script).sort();
    const expectedKeys = [...NARRATION_SCENE_KEYS].sort();
    expect(returnedKeys).toEqual(expectedKeys);
  });
});

// ---------------------------------------------------------------------------
// Per-locale / per-scene completeness — every script string is non-empty
// ---------------------------------------------------------------------------

const cases = ALL_LOCALES.flatMap((locale) =>
  NARRATION_SCENE_KEYS.map((sceneKey) => ({ locale, sceneKey })),
);

describe("buildNarrationScript produces a non-empty string for every locale × scene key", () => {
  it.each(cases)(
    "$locale/$sceneKey has a non-empty narration script",
    ({ locale, sceneKey }) => {
      const captions = VIDEO_CAPTIONS[locale];
      expect(
        captions,
        `VIDEO_CAPTIONS does not contain locale "${locale}". ` +
          `Add it to VIDEO_CAPTIONS in shared/videoCaptions.ts.`,
      ).toBeTruthy();

      const script = buildNarrationScript(captions);

      expect(
        Object.prototype.hasOwnProperty.call(script, sceneKey),
        `buildNarrationScript("${locale}") did not return a key for scene "${sceneKey}".`,
      ).toBe(true);

      const text: string = script[sceneKey as keyof typeof script];

      expect(
        typeof text,
        `buildNarrationScript("${locale}")["${sceneKey}"] is not a string.`,
      ).toBe("string");

      expect(
        text.trim().length,
        `buildNarrationScript("${locale}")["${sceneKey}"] is empty or blank. ` +
          `Fill in the "${locale}" locale captions for this scene in shared/videoCaptions.ts.`,
      ).toBeGreaterThan(0);
    },
  );
});
