import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@shared/video';
import { resolveVideoCaptions, VideoCaptionsContext } from './captions';
import { Scene1 } from '@shared/video/scenes/Scene1';
import { Scene2 } from '@shared/video/scenes/Scene2';
import { Scene3 } from '@shared/video/scenes/Scene3';
import { Scene4 } from '@shared/video/scenes/Scene4';
import { Scene5 } from '@shared/video/scenes/Scene5';

// Scene lengths — single source of truth lives in `video/scene-durations.json`.
// Edit that file to change durations; the portal and record-videos.mjs both
// read the same JSON so they stay in lockstep automatically.
import SCENE_DURATIONS from '../../../scene-durations.json';

// The standalone recorder picks the caption language from the URL, e.g.
// `?lang=de`, so each localized variant can be rendered/recorded headlessly
// without code changes. Defaults to English.
function getRecorderLocale(): string {
  if (typeof window === 'undefined') return 'en';
  return new URLSearchParams(window.location.search).get('lang') ?? 'en';
}

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });
  const captions = resolveVideoCaptions(getRecorderLocale());

  return (
    <VideoCaptionsContext.Provider value={captions}>
    <div className="relative w-full h-screen overflow-hidden bg-bg-darker font-body text-text-primary">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 z-0">
        <motion.div 
          className="absolute w-[80vw] h-[80vw] rounded-full opacity-10 blur-[100px]"
          style={{ background: 'radial-gradient(circle, var(--color-brand-gold), transparent 70%)' }}
          animate={{ 
            x: ['-20%', '10%', '-10%'], 
            y: ['-10%', '20%', '0%'],
            scale: [1, 1.2, 0.9]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="absolute w-[60vw] h-[60vw] rounded-full opacity-5 blur-[80px] right-0 bottom-0"
          style={{ background: 'radial-gradient(circle, var(--color-admin-action), transparent 70%)' }}
          animate={{ 
            x: ['10%', '-20%', '5%'], 
            y: ['10%', '-30%', '10%'],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Persistent Midground Grid/Lines */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20"
           style={{
             backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
             backgroundSize: '4vw 4vw'
           }}>
      </div>

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
