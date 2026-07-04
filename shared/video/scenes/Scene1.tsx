import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useVideoCaptions } from '../../videoCaptions';

export function Scene1() {
  const { intro } = useVideoCaptions();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 4500), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -50, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="text-center z-10 max-w-4xl px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6 }}
          className="mb-6 inline-block px-4 py-1.5 rounded-full border border-brand-gold/30 bg-brand-gold/10 text-brand-gold text-[1.2vw] font-medium tracking-wide uppercase"
        >
          {intro.badge}
        </motion.div>

        <h1 className="text-[5vw] font-display font-bold leading-tight mb-6">
          {intro.titleLines.map((line, i) => (
            <motion.span
              key={i}
              className={`block ${i === 0 ? 'text-text-primary' : 'text-brand-gold'}`}
              initial={{ opacity: 0, y: 40 }}
              animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: i * 0.1 }}
            >
              {line}
            </motion.span>
          ))}
        </h1>

        <motion.p 
          className="text-[1.8vw] text-text-secondary max-w-3xl mx-auto"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.8 }}
        >
          {intro.subtitleLines.map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {line}
            </span>
          ))}
        </motion.p>
      </div>
      
      {/* Decorative elements */}
      {phase >= 1 && (
        <motion.div 
          className="absolute top-[30%] left-[20%] w-[1px] bg-gradient-to-b from-transparent via-brand-gold/50 to-transparent"
          initial={{ height: 0 }}
          animate={{ height: '40%' }}
          transition={{ duration: 1.5, ease: 'easeInOut' }}
        />
      )}
      {phase >= 1 && (
        <motion.div 
          className="absolute top-[30%] right-[20%] w-[1px] bg-gradient-to-b from-transparent via-brand-gold/50 to-transparent"
          initial={{ height: 0 }}
          animate={{ height: '40%' }}
          transition={{ duration: 1.5, ease: 'easeInOut', delay: 0.2 }}
        />
      )}
    </motion.div>
  );
}
