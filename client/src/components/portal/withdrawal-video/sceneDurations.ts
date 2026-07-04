import { NARRATION_SCENE_KEYS, type NarrationSceneKey } from "./captions";
import rawDurations from "../../../../../video/scene-durations.json";

/**
 * Scene lengths (ms) for the withdrawal tutorial video, keyed 1:1 to
 * `NARRATION_SCENE_KEYS`. Sized so the longest localized voiceover clip for each
 * scene finishes comfortably before the next scene begins (see the generated
 * tracks in `public/withdrawal-video/narration`).
 *
 * Single source of truth lives in `video/scene-durations.json` and is imported
 * here, by `video/src/components/video/VideoTemplate.tsx`, and read at runtime
 * by `video/scripts/record-videos.mjs` — edit that one file to change durations.
 */
export const SCENE_DURATIONS = rawDurations as Record<NarrationSceneKey, number>;

export { NARRATION_SCENE_KEYS };
