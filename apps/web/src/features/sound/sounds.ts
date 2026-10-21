import { useSyncExternalStore } from 'react';

/** Quiet, short, low sounds for "the agent has finished"; synthesized, so there are no audio files. */
type Note = {
  freq: number;
  at: number;
  len: number;
  type?: OscillatorType;
  peak: number;
  attack?: number;
  to?: number;
};

export const SOUNDS = {
  chime: {
    label: 'Soft chime',
    notes: [
      { freq: 523.25, at: 0, len: 0.7, peak: 0.6 },
      { freq: 659.25, at: 0.14, len: 0.9, peak: 0.5 },
    ],
  },
  drop: {
    label: 'Water drop',
    notes: [{ freq: 520, to: 300, at: 0, len: 0.28, peak: 0.7 }],
  },
  pluck: {
    label: 'Pluck',
    notes: [{ freq: 392, at: 0, len: 0.45, type: 'triangle', peak: 0.6 }],
  },
  hum: {
    label: 'Low hum',
    notes: [
      { freq: 196, at: 0, len: 1.1, peak: 0.6, attack: 0.25 },
      { freq: 294, at: 0, len: 1.1, peak: 0.35, attack: 0.25 },
    ],
  },
  tick: {
    label: 'Wood tick',
    notes: [
      { freq: 330, to: 250, at: 0, len: 0.12, type: 'triangle', peak: 0.6 },
    ],
  },
} as const satisfies Record<string, { label: string; notes: Note[] }>;
export type SoundName = keyof typeof SOUNDS;

export type SoundPrefs = { sound: SoundName | 'off'; volume: number };
const KEY = 'pm.sound';
const DEFAULT: SoundPrefs = { sound: 'off', volume: 0.5 };
/** Master gain at volume 1: still gentle. */
const MAX_GAIN = 0.12;

let cached: { raw: string | null; prefs: SoundPrefs } | undefined;
const listeners = new Set<() => void>();

function read(): SoundPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    if (cached) return cached.prefs; // storage blocked: keep the in-memory value
  }
  if (cached && raw === cached.raw) return cached.prefs;
  let prefs = DEFAULT;
  try {
    const j = raw === null ? {} : JSON.parse(raw);
    prefs = {
      sound: j.sound === 'off' || j.sound in SOUNDS ? j.sound : DEFAULT.sound,
      volume:
        typeof j.volume === 'number'
          ? Math.min(1, Math.max(0, j.volume))
          : DEFAULT.volume,
    };
  } catch {
    // corrupt value: defaults
  }
  cached = { raw, prefs };
  return prefs;
}

export function setSoundPrefs(patch: Partial<SoundPrefs>) {
  const prefs = { ...read(), ...patch };
  const raw = JSON.stringify(prefs);
  cached = { raw, prefs };
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    // memory only
  }
  listeners.forEach((l) => l());
}

export const useSoundPrefs = () =>
  useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, read);

let ctx: AudioContext | undefined;

/** Plays a sound at the given volume (0..1); silently does nothing without Web Audio or while the browser blocks audio. */
export function playSound(name: SoundName, volume: number) {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor || volume <= 0) return;
  try {
    ctx ??= new Ctor();
    void ctx.resume();
    const t0 = ctx.currentTime;
    for (const n of SOUNDS[name].notes as readonly Note[]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? 'sine';
      const start = t0 + n.at;
      osc.frequency.setValueAtTime(n.freq, start);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, start + n.len);
      const peak = n.peak * volume * MAX_GAIN;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + (n.attack ?? 0.02));
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + n.len + 0.05);
    }
  } catch {
    // audio unavailable
  }
}

/** The chosen finish sound, if any. */
export function playFinished() {
  const { sound, volume } = read();
  if (sound !== 'off') playSound(sound, volume);
}
