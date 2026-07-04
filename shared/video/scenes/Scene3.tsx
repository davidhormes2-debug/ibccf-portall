import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { User, ShieldCheck } from 'lucide-react';
import { useVideoCaptions } from '../../videoCaptions';

export function Scene3() {
  const { phase2, roles } = useVideoCaptions();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 4500),
      setTimeout(() => setPhase(5), 6000),
      setTimeout(() => setPhase(6), 7500),
      setTimeout(() => setPhase(7), 10500), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const stages = [
    { num: 4, by: "user", icon: <User className="w-[1.5vw] h-[1.5vw]" /> },
    { num: 5, by: "admin", icon: <ShieldCheck className="w-[1.5vw] h-[1.5vw]" /> },
    { num: 6, by: "admin", icon: <ShieldCheck className="w-[1.5vw] h-[1.5vw]" /> },
    { num: 7, by: "user", icon: <User className="w-[1.5vw] h-[1.5vw]" /> }
  ].map((stage, idx) => ({ ...stage, title: phase2.stages[idx] }));

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center p-[5vw]"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="w-full max-w-[80vw] grid grid-cols-2 gap-[5vw]">
        {/* Left Col: Phase Intro */}
        <div className="flex flex-col justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            className="text-brand-gold text-[1.5vw] font-bold tracking-widest uppercase mb-4"
          >
            {phase2.label}
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            className="text-[4vw] font-display font-bold leading-tight mb-6"
          >
            {phase2.titleLines.map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
            className="text-[1.5vw] text-text-secondary"
          >
            {phase2.description}
          </motion.p>
        </div>

        {/* Right Col: Stages */}
        <div className="flex flex-col justify-center gap-4">
          {stages.map((stage, idx) => (
            <motion.div
              key={stage.num}
              initial={{ opacity: 0, x: 50 }}
              animate={phase >= 3 + idx ? { opacity: 1, x: 0 } : { opacity: 0, x: 50 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="glass-panel p-5 rounded-2xl flex items-center gap-6 relative overflow-hidden"
            >
              <div className={`absolute left-0 top-0 bottom-0 w-2 ${
                stage.by === 'user' ? 'bg-user-action' :
                stage.by === 'admin' ? 'bg-admin-action' : 'bg-system'
              }`} />
              
              <div className="w-[3vw] h-[3vw] flex items-center justify-center rounded-full bg-white/5 text-text-muted font-mono text-[1.2vw]">
                {stage.num}
              </div>
              
              <div className="flex-1">
                <h3 className="text-[1.4vw] font-semibold">{stage.title}</h3>
                <div className={`flex items-center gap-2 mt-1 text-[1vw] uppercase tracking-wider font-bold ${
                  stage.by === 'user' ? 'text-user-action' :
                  stage.by === 'admin' ? 'text-admin-action' : 'text-system'
                }`}>
                  {stage.icon}
                  {stage.by === 'user' ? roles.user :
                   stage.by === 'admin' ? roles.admin : roles.system}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
