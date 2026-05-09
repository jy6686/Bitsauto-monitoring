import { useRef, useCallback, useState } from "react";

type Severity = "critical" | "high" | "medium" | "low";

const TONES: Record<Severity, { freq: number; duration: number; pulses: number }> = {
  critical: { freq: 880,  duration: 0.18, pulses: 3 },
  high:     { freq: 660,  duration: 0.15, pulses: 2 },
  medium:   { freq: 440,  duration: 0.12, pulses: 1 },
  low:      { freq: 330,  duration: 0.10, pulses: 1 },
};

export function useAudioAlerts() {
  const ctxRef  = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);

  function getCtx(): AudioContext {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return ctxRef.current;
  }

  const play = useCallback((severity: Severity = "medium") => {
    if (!enabled) return;
    try {
      const ctx = getCtx();
      const config = TONES[severity];
      for (let i = 0; i < config.pulses; i++) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(config.freq, ctx.currentTime + i * 0.28);
        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.28);
        gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + i * 0.28 + 0.02);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.28 + config.duration);
        osc.start(ctx.currentTime + i * 0.28);
        osc.stop(ctx.currentTime + i * 0.28 + config.duration + 0.01);
      }
    } catch { /* Audio context blocked — no-op */ }
  }, [enabled]);

  const toggle = useCallback(() => {
    setEnabled(v => {
      const next = !v;
      if (next) {
        try { getCtx(); } catch { /* no-op */ }
      }
      return next;
    });
  }, []);

  return { enabled, toggle, play };
}
