import { useCallback, useRef, useEffect } from 'react';

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioContext) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return null;
      sharedAudioContext = new AudioContextClass();
    }
    if (sharedAudioContext.state === 'suspended') {
      sharedAudioContext.resume();
    }
    return sharedAudioContext;
  } catch {
    return null;
  }
}

export function useNotificationSound() {
  const playSound = useCallback((frequency = 800, duration = 0.3) => {
    try {
      const audioContext = getAudioContext();
      if (!audioContext) return;
      
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(frequency * 0.75, audioContext.currentTime + 0.1);
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime + 0.2);
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + duration);
      
      oscillator.onended = () => {
        oscillator.disconnect();
        gainNode.disconnect();
      };
    } catch (error) {
      console.warn('Could not play notification sound:', error);
    }
  }, []);

  const playNewMessage = useCallback(() => playSound(800, 0.3), [playSound]);
  const playAdminAlert = useCallback(() => playSound(600, 0.3), [playSound]);
  const playSuccess = useCallback(() => playSound(1000, 0.2), [playSound]);
  const playError = useCallback(() => playSound(400, 0.4), [playSound]);

  return {
    playSound,
    playNewMessage,
    playAdminAlert,
    playSuccess,
    playError,
  };
}
