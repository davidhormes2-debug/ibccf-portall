import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENE_DURATIONS } from "../sceneDurations";

// Structural guard: verify the shared JSON is well-formed and contains
// all expected scene keys with positive numeric durations.
//
// Drift between the three consumers (portal sceneDurations.ts,
// video/src/components/video/VideoTemplate.tsx, and
// video/scripts/record-videos.mjs) is now impossible — they all import/read
// the same `video/scene-durations.json` file.
//
// The second describe block explicitly compares the exported SCENE_DURATIONS
// object against the raw JSON so that any future refactor replacing the import
// with hardcoded values is caught immediately in CI.

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SHARED_JSON_PATH = join(REPO_ROOT, "video", "scene-durations.json");

const jsonDurations = JSON.parse(
  readFileSync(SHARED_JSON_PATH, "utf8"),
) as Record<string, number>;

const EXPECTED_SCENE_KEYS = Object.keys(jsonDurations);

describe("video/scene-durations.json", () => {
  const durations: unknown = jsonDurations;

  it("is a plain object", () => {
    expect(typeof durations).toBe("object");
    expect(durations).not.toBeNull();
    expect(Array.isArray(durations)).toBe(false);
  });

  // Two separate assertions so a reorder and a missing/extra key produce
  // distinct, actionable failure messages:
  //   1. Membership-only (unordered) — catches added/removed scenes clearly.
  //   2. Order check — catches key reorders that `arrayContaining` would miss,
  //      with a label that makes the intent obvious.
  it("contains exactly the expected scene keys (unordered)", () => {
    const actualKeys = Object.keys(durations as object);
    expect(actualKeys).toEqual(expect.arrayContaining(EXPECTED_SCENE_KEYS));
    expect(EXPECTED_SCENE_KEYS).toEqual(expect.arrayContaining(actualKeys));
  });

  it("scene keys are in the same order as the JSON file", () => {
    // toStrictEqual checks both membership AND insertion order — a key reorder
    // in video/scene-durations.json will surface here with a diff, not silently
    // swallow through the unordered check above.
    expect(Object.keys(durations as object)).toStrictEqual(EXPECTED_SCENE_KEYS);
  });

  it("has positive numeric duration for every scene", () => {
    for (const key of EXPECTED_SCENE_KEYS) {
      const value = (durations as Record<string, unknown>)[key];
      expect(typeof value, `${key} should be a number`).toBe("number");
      expect(value as number, `${key} duration should be positive`).toBeGreaterThan(0);
    }
  });
});

describe("SCENE_DURATIONS vs video/scene-durations.json parity", () => {

  it("exports the same keys as the JSON file", () => {
    expect(
      Object.keys(SCENE_DURATIONS).sort(),
      "SCENE_DURATIONS has different keys than video/scene-durations.json — " +
        "sceneDurations.ts must import from the JSON (the single source of truth), " +
        "not hardcode values.",
    ).toEqual(Object.keys(jsonDurations).sort());
  });

  it("exports the same numeric values as the JSON file", () => {
    for (const key of Object.keys(jsonDurations)) {
      expect(
        (SCENE_DURATIONS as Record<string, number>)[key],
        `SCENE_DURATIONS["${key}"] does not match video/scene-durations.json — ` +
          `edit the JSON file (the single source of truth); ` +
          `sceneDurations.ts must import from it, not hardcode values.`,
      ).toBe(jsonDurations[key]);
    }
  });
});
