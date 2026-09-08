import { useCallback } from 'react';
import { getNotificationPrefs as getPrefs } from './useNotificationPrefs';

let _ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!_ctx) {
      const Cls = window.AudioContext || (window as any).webkitAudioContext;
      if (!Cls) return null;
      _ctx = new Cls();
    }
    return _ctx;
  } catch {
    return null;
  }
}

type OscType = 'sine' | 'square' | 'triangle' | 'sawtooth';

function scheduleBeep(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  startTime: number,
  duration: number,
  gain: number,
  oscType: OscType = 'sine',
): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = oscType;
  osc.connect(g);
  g.connect(dest);
  osc.frequency.setValueAtTime(freq, startTime);
  g.gain.setValueAtTime(gain, startTime);
  g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration);
  osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch {} };
}

export type NotificationSoundType =
  | 'visitor'   // Admin: new visitor landed — doorbell (DING DONG)
  | 'receipt'   // Admin: user uploaded a receipt needing approval — urgent triple punch
  | 'alert'     // Admin: general alert (new case / submission / document)
  | 'message'   // Admin & portal: new chat message
  | 'approval'  // Portal: admin approved something — celebratory fanfare
  | 'success'   // Portal: generic positive confirmation
  | 'error';    // Error / rejection

export async function playNotificationSound(
  type: NotificationSoundType = 'alert',
  volume = 1.0,
): Promise<void> {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') await ctx.resume();

    // Compressor: very light limiting — high threshold and low ratio let the
    // increased gain pass through almost unchanged so the sounds are noticeably
    // louder without hard clipping.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-2, ctx.currentTime);
    compressor.knee.setValueAtTime(6, ctx.currentTime);
    compressor.ratio.setValueAtTime(1.5, ctx.currentTime);
    compressor.attack.setValueAtTime(0.001, ctx.currentTime);
    compressor.release.setValueAtTime(0.12, ctx.currentTime);
    compressor.connect(ctx.destination);

    const t = ctx.currentTime;
    // Scale gain by the volume parameter (0–1). At volume=1 the original
    // loudness (G=2.4) is preserved; lower values fade proportionally.
    const G = 2.4 * Math.max(0, Math.min(1, volume));
    const DUR = 0.16;
    const GAP = 0.06;

    let totalDuration: number;

    switch (type) {

      // ──────────────────────────────────────────────
      // VISITOR — doorbell: DING (high) then DONG (low), warm sine tones,
      // long sustain so it's clearly audible across the room.
      // ──────────────────────────────────────────────
      case 'visitor': {
        const BELL_G = G * 1.05;
        for (const offset of [0,3,6,9,12]) { scheduleBeep(ctx, compressor, 1047, t+offset, 0.62, BELL_G, 'sine'); scheduleBeep(ctx, compressor, 784, t+offset+0.78, 0.90, BELL_G*0.9, 'sine'); }
        totalDuration = 15.0;
        break;
      }

      // ──────────────────────────────────────────────
      // RECEIPT — urgent triple punch: three fast ascending square blips,
      // like a cash-register / urgent alarm. Hard to ignore.
      // ──────────────────────────────────────────────
      case 'receipt': {
        for (const offset of [0,2,4,6,8]) { scheduleBeep(ctx, compressor, 880, t+offset, 0.22, G*1.15, 'square'); scheduleBeep(ctx, compressor, 1047, t+offset+0.32, 0.22, G*1.15, 'square'); scheduleBeep(ctx, compressor, 1319, t+offset+0.64, 0.36, G*1.15, 'square'); }
        totalDuration = 10.0;
        break;
      }

      // ──────────────────────────────────────────────
      // ALERT — general admin alert: three rising triangle beeps.
      // ──────────────────────────────────────────────
      case 'alert': {
        for (const offset of [0,2,4,6,8]) { scheduleBeep(ctx, compressor, 880, t+offset, 0.26, G, 'triangle'); scheduleBeep(ctx, compressor, 1047, t+offset+0.36, 0.26, G, 'triangle'); scheduleBeep(ctx, compressor, 1319, t+offset+0.72, 0.44, G, 'triangle'); }
        totalDuration = 10.0;
        break;
      }

      // ──────────────────────────────────────────────
      // MESSAGE — two-note ascending chime (existing feel, louder).
      // ──────────────────────────────────────────────
      case 'message': {
        const M = G * 0.92;
        for (const offset of [0,5,10,15,20,25]) { scheduleBeep(ctx, compressor, 659, t+offset, 0.60, M, 'sine'); scheduleBeep(ctx, compressor, 880, t+offset+0.8, 0.72, M*1.05, 'sine'); scheduleBeep(ctx, compressor, 1047, t+offset+1.8, 0.84, M, 'triangle'); scheduleBeep(ctx, compressor, 880, t+offset+3.0, 1.10, M*0.9, 'sine'); }
        totalDuration = 30.0;
        break;
      }

      // ──────────────────────────────────────────────
      // APPROVAL — celebratory four-note rising fanfare (C-E-G-C).
      // Portal users hear this when admin approves something on their case.
      // ──────────────────────────────────────────────
      case 'approval': {
        for (const offset of [0,3.2,6.4]) { scheduleBeep(ctx, compressor, 523, t+offset, 0.30, G, 'sine'); scheduleBeep(ctx, compressor, 659, t+offset+0.42, 0.30, G, 'sine'); scheduleBeep(ctx, compressor, 784, t+offset+0.84, 0.30, G, 'sine'); scheduleBeep(ctx, compressor, 1047, t+offset+1.26, 0.72, G*1.05, 'sine'); }
        totalDuration = 10.0;
        break;
      }

      // ──────────────────────────────────────────────
      // SUCCESS — quick two-note rise.
      // ──────────────────────────────────────────────
      case 'success': {
        for (const offset of [0,2,4,6,8]) { scheduleBeep(ctx, compressor, 1047, t+offset, 0.34, G, 'sine'); scheduleBeep(ctx, compressor, 1319, t+offset+0.48, 0.62, G*1.05, 'sine'); }
        totalDuration = 10.0;
        break;
      }

      // ──────────────────────────────────────────────
      // ERROR — low descending square tone.
      // ──────────────────────────────────────────────
      default: {
        for (const offset of [0,2,4,6,8]) { scheduleBeep(ctx, compressor, 440, t+offset, 0.34, G, 'square'); scheduleBeep(ctx, compressor, 330, t+offset+0.46, 0.52, G, 'square'); }
        totalDuration = 10.0;
        break;
      }
    }

    setTimeout(() => { try { compressor.disconnect(); } catch {} }, (totalDuration + 0.2) * 1000);
  } catch {
    // Audio not available in this environment
  }
}

export function useNotificationSound() {
  // Read prefs lazily at call-time so volume/tone changes take effect
  // immediately without remounting the hook.
  const playVisitorArrival  = useCallback(() => {
    const { enabled, volume, tones } = getPrefs();
    if (!enabled) return;
    void playNotificationSound(tones.visitor,  volume);
  }, []);
  const playReceiptUploaded = useCallback(() => {
    const { enabled, volume, tones } = getPrefs();
    if (!enabled) return;
    void playNotificationSound(tones.receipt,  volume);
  }, []);
  const playAdminAlert      = useCallback(() => {
    const { enabled, volume, tones } = getPrefs();
    if (!enabled) return;
    void playNotificationSound(tones.alert,    volume);
  }, []);
  const playNewMessage      = useCallback(() => {
    const { enabled, volume, tones } = getPrefs();
    if (!enabled) return;
    void playNotificationSound(tones.message,  volume);
  }, []);
  const playApproval        = useCallback(() => {
    const { enabled, volume, tones } = getPrefs();
    if (!enabled) return;
    void playNotificationSound(tones.approval, volume);
  }, []);
  const playSuccess         = useCallback(() => {
    const { enabled, volume } = getPrefs();
    if (!enabled) return;
    void playNotificationSound('success', volume);
  }, []);
  const playError           = useCallback(() => {
    const { enabled, volume } = getPrefs();
    if (!enabled) return;
    void playNotificationSound('error', volume);
  }, []);
  const playSound           = useCallback((_frequency = 800, _duration = 0.3) => {
    const { enabled, volume, tones } = getPrefs();
    if (!enabled) return;
    void playNotificationSound(tones.alert, volume);
  }, []);

  return {
    playSound,
    playVisitorArrival,
    playReceiptUploaded,
    playAdminAlert,
    playNewMessage,
    playApproval,
    playSuccess,
    playError,
  };
}
