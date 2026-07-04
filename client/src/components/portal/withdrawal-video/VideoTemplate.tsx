import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useVideoPlayer } from "@shared/video";
import {
  NARRATION_SCENE_KEYS,
  resolveVideoCaptions,
  resolveVideoLocaleCode,
  VideoCaptionsContext,
} from "./captions";
import { SCENE_DURATIONS } from "./sceneDurations";
import { NarrationTrack } from "./NarrationTrack";
import { Scene1 } from "@shared/video/scenes/Scene1";
import { Scene2 } from "@shared/video/scenes/Scene2";
import { Scene3 } from "@shared/video/scenes/Scene3";
import { Scene4 } from "@shared/video/scenes/Scene4";
import { Scene5 } from "@shared/video/scenes/Scene5";

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });
  // The active i18n locale is kept in sync with `cases.preferred_locale`
  // by the portal's language switcher, so the video automatically renders
  // in the user's chosen language.
  const { t, i18n } = useTranslation("portal");
  const activeLocale = i18n.resolvedLanguage ?? i18n.language;
  const captions = resolveVideoCaptions(activeLocale);
  const localeCode = resolveVideoLocaleCode(activeLocale);
  const sceneKey =
    NARRATION_SCENE_KEYS[currentScene] ?? NARRATION_SCENE_KEYS[0];

  // The narration plays with sound by default: the tutorial only mounts after
  // the user clicks "Watch", which satisfies the browser autoplay gesture.
  const [muted, setMuted] = useState(false);

  return (
    <VideoCaptionsContext.Provider value={captions}>
    <div
      data-testid="withdrawal-tutorial-video-stage"
      className="wtv-surface relative w-full h-full overflow-hidden bg-bg-darker font-body text-text-primary"
    >
      <NarrationTrack localeCode={localeCode} sceneKey={sceneKey} muted={muted} />

      <button
        type="button"
        onClick={() => setMuted((prev) => !prev)}
        data-testid="button-toggle-narration"
        aria-pressed={muted}
        aria-label={
          muted
            ? t("dashboard.tutorialVideo.unmuteNarration", "Unmute narration")
            : t("dashboard.tutorialVideo.muteNarration", "Mute narration")
        }
        className="absolute right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
      >
        {muted ? (
          <VolumeX className="h-5 w-5" aria-hidden />
        ) : (
          <Volume2 className="h-5 w-5" aria-hidden />
        )}
      </button>

      {/* Persistent Background Layer */}
      <div className="absolute inset-0 z-0">
        <motion.div
          className="absolute w-[80%] h-[80%] rounded-full opacity-10 blur-[100px]"
          style={{ background: "radial-gradient(circle, var(--color-brand-gold), transparent 70%)" }}
          animate={{
            x: ["-20%", "10%", "-10%"],
            y: ["-10%", "20%", "0%"],
            scale: [1, 1.2, 0.9],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute w-[60%] h-[60%] rounded-full opacity-5 blur-[80px] right-0 bottom-0"
          style={{ background: "radial-gradient(circle, var(--color-admin-action), transparent 70%)" }}
          animate={{
            x: ["10%", "-20%", "5%"],
            y: ["10%", "-30%", "10%"],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* Persistent Midground Grid/Lines */}
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "4% 8%",
        }}
      />

      {/* Scene Content */}
      <div className="relative z-10 w-full h-full">
        <AnimatePresence mode="popLayout">
          {currentScene === 0 && <Scene1 key="intro" />}
          {currentScene === 1 && <Scene2 key="phase1" />}
          {currentScene === 2 && <Scene3 key="phase2" />}
          {currentScene === 3 && <Scene4 key="phase3" />}
          {currentScene === 4 && <Scene5 key="phase4" />}
        </AnimatePresence>
      </div>
    </div>
    </VideoCaptionsContext.Provider>
  );
}
