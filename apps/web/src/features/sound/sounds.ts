import { useSyncExternalStore } from 'react';
import { createPersistentStore } from '../../shared/storage';

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

function parseSound(raw: string | null): SoundPrefs {
  try {
    const j = raw === null ? {} : JSON.parse(raw);
    return {
      sound:
        j.sound === 'off' ||
        (Object.keys(SOUNDS) as unknown[]).includes(j.sound)
          ? j.sound
          : DEFAULT.sound,
      volume:
        typeof j.volume === 'number'
          ? Math.min(1, Math.max(0, j.volume))
          : DEFAULT.volume,
    };
  } catch {
    return DEFAULT; // corrupt value
  }
}

const store = createPersistentStore<SoundPrefs>({
  key: () => KEY,
  parse: parseSound,
});
const read = () => store.read();

export const setSoundPrefs = (patch: Partial<SoundPrefs>) =>
  store.write('', { ...read(), ...patch });

export const useSoundPrefs = () => useSyncExternalStore(store.subscribe, read);

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
