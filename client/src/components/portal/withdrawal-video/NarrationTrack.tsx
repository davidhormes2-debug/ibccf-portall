import { useEffect, useRef } from "react";
import type { NarrationSceneKey, VideoLocaleCode } from "./captions";

interface NarrationTrackProps {
  /** Active locale code; selects which localized voiceover folder to play. */
  localeCode: VideoLocaleCode;
  /** Scene key for the currently visible scene; selects the clip to play. */
  sceneKey: NarrationSceneKey;
  /** When true, narration is silenced (and paused). */
  muted: boolean;
}

const NARRATION_BASE = "/withdrawal-video/narration";

/**
 * Plays the per-scene voiceover track that matches the active scene and locale.
 *
 * The audio files are pre-generated (one MP3 per locale per scene) and served
 * statically from `public/withdrawal-video/narration/<locale>/<sceneKey>.mp3`.
 * A single `<audio>` element is reused; whenever the scene or locale changes we
 * swap its source and restart from the top, so the narration stays in lockstep
 * with `SCENE_DURATIONS` and re-narrates when the looping video restarts.
 */
export function NarrationTrack({ localeCode, sceneKey, muted }: NarrationTrackProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Swap and (re)start the clip when the scene or locale changes.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = `${NARRATION_BASE}/${localeCode}/${sceneKey}.mp3`;
    audio.currentTime = 0;
    if (!mutedRef.current) {
      // Autoplay can reject until the first user gesture; the tutorial only
      // mounts after the user clicks "Watch", so this normally resolves.
      void audio.play().catch(() => undefined);
    }
  }, [localeCode, sceneKey]);

  // React to mute toggles without restarting the current clip.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = muted;
    if (muted) {
      audio.pause();
    } else if (audio.src) {
      void audio.play().catch(() => undefined);
    }
  }, [muted]);

  return <audio ref={audioRef} aria-hidden preload="auto" />;
}
