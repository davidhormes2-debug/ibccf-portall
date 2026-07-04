import { MotionConfig } from "framer-motion";
import VideoTemplate from "./VideoTemplate";

/**
 * Renders the animated withdrawal tutorial inside a fixed 16:9 stage.
 *
 * The scenes are authored with viewport-relative (`vw`) units against a full
 * 16:9 frame, so the stage is sized to the viewport (letterboxed) to preserve
 * the intended proportions. `MotionConfig reducedMotion="user"` makes Framer
 * Motion honor the visitor's `prefers-reduced-motion` setting.
 */
export function WithdrawalTutorialVideo() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full w-full items-center justify-center">
        <div
          className="relative overflow-hidden rounded-xl shadow-2xl"
          style={{
            width: "min(100vw, calc(100dvh * 16 / 9))",
            aspectRatio: "16 / 9",
          }}
        >
          <VideoTemplate />
        </div>
      </div>
    </MotionConfig>
  );
}
