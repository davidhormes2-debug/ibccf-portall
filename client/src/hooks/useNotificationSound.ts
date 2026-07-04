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
        const BELL = 0.20;
        const BELL_G = G * 1.1;
        scheduleBeep(ctx, compressor, 1047, t,            BELL * 2.5, BELL_G, 'sine'); // DING  C6
        scheduleBeep(ctx, compressor,  784, t + BELL + GAP * 1.5, BELL * 3.5, BELL_G * 0.9, 'sine'); // DONG  G5
        totalDuration = BELL + GAP * 1.5 + BELL * 3.5;
        break;
      }

      // ──────────────────────────────────────────────
      // RECEIPT — urgent triple punch: three fast ascending square blips,
      // like a cash-register / urgent alarm. Hard to ignore.
      // ──────────────────────────────────────────────
      case 'receipt': {
        const step = DUR + GAP * 0.8;
        scheduleBeep(ctx, compressor,  880, t,          DUR * 0.9, G * 1.2, 'square');
        scheduleBeep(ctx, compressor, 1047, t + step,   DUR * 0.9, G * 1.2, 'square');
        scheduleBeep(ctx, compressor, 1319, t + step*2, DUR * 1.3, G * 1.2, 'square');
        // second burst after a short pause for extra urgency
        const burst2 = step * 3 + GAP * 2;
        scheduleBeep(ctx, compressor, 1319, t + burst2, DUR * 0.9, G,       'square');
        scheduleBeep(ctx, compressor, 1047, t + burst2 + step, DUR * 0.9, G, 'square');
        totalDuration = burst2 + step + DUR;
        break;
      }

      // ──────────────────────────────────────────────
      // ALERT — general admin alert: three rising triangle beeps.
      // ──────────────────────────────────────────────
      case 'alert': {
        scheduleBeep(ctx, compressor,  880, t,                    DUR,       G, 'triangle');
        scheduleBeep(ctx, compressor, 1047, t + DUR + GAP,        DUR,       G, 'triangle');
        scheduleBeep(ctx, compressor, 1319, t + (DUR + GAP) * 2,  DUR * 1.6, G, 'triangle');
        totalDuration = (DUR + GAP) * 2 + DUR * 1.6;
        break;
      }

      // ──────────────────────────────────────────────
      // MESSAGE — two-note ascending chime (existing feel, louder).
      // ──────────────────────────────────────────────
      case 'message': {
        scheduleBeep(ctx, compressor,  880, t,           DUR,   G, 'sine');
        scheduleBeep(ctx, compressor, 1047, t + DUR + GAP, DUR * 1.4, G, 'sine');
        totalDuration = DUR + GAP + DUR * 1.4;
        break;
      }

      // ──────────────────────────────────────────────
      // APPROVAL — celebratory four-note rising fanfare (C-E-G-C).
      // Portal users hear this when admin approves something on their case.
      // ──────────────────────────────────────────────
      case 'approval': {
        const S = DUR * 0.9;
        const GS = GAP * 0.7;
        scheduleBeep(ctx, compressor,  523, t,               S,       G, 'sine'); // C5
        scheduleBeep(ctx, compressor,  659, t + S + GS,      S,       G, 'sine'); // E5
        scheduleBeep(ctx, compressor,  784, t + (S+GS)*2,    S,       G, 'sine'); // G5
        scheduleBeep(ctx, compressor, 1047, t + (S+GS)*3,    S * 2.2, G * 1.1, 'sine'); // C6
        totalDuration = (S + GS) * 3 + S * 2.2;
        break;
      }

      // ──────────────────────────────────────────────
      // SUCCESS — quick two-note rise.
      // ──────────────────────────────────────────────
      case 'success': {
        scheduleBeep(ctx, compressor, 1047, t,           DUR,       G, 'sine');
        scheduleBeep(ctx, compressor, 1319, t + DUR + GAP, DUR * 1.6, G, 'sine');
        totalDuration = DUR + GAP + DUR * 1.6;
        break;
      }

      // ──────────────────────────────────────────────
      // ERROR — low descending square tone.
      // ──────────────────────────────────────────────
      default: {
        scheduleBeep(ctx, compressor, 440, t,       0.25, G, 'square');
        scheduleBeep(ctx, compressor, 330, t + 0.28, 0.3, G, 'square');
        totalDuration = 0.58;
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
