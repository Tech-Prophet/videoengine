// Built-in background music. Tracks are synthesised in the browser from simple instruments, so there is
// nothing to download, no licence to worry about and no server call. Each track is a short loop that joins
// up seamlessly (notes that ring past the end wrap round to the start), because the app loops the music.

export type MusicStyle = "calm" | "cinematic" | "upbeat" | "lofi";
export const MUSIC_STYLES: { id: MusicStyle; label: string; note: string }[] = [
  { id: "calm", label: "Calm and gentle", note: "soft pads and a slow, light melody" },
  { id: "cinematic", label: "Cinematic and deep", note: "low drone, slow swells, soft pulse" },
  { id: "upbeat", label: "Upbeat and bright", note: "steady beat, plucky melody" },
  { id: "lofi", label: "Lo-fi relaxed", note: "mellow chords, soft drums, light crackle" },
];

type Chord = number[]; // MIDI note numbers
type Plan = { bpm: number; chords: Chord[]; seconds: number };
const PLANS: Record<MusicStyle, Plan> = {
  calm: { bpm: 60, seconds: 48, chords: [[48, 55, 59, 64], [45, 55, 60, 64], [41, 53, 57, 64], [43, 55, 59, 62]] },
  cinematic: { bpm: 64, seconds: 45, chords: [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64], [43, 50, 55, 59]] },
  upbeat: { bpm: 112, seconds: 51, chords: [[48, 52, 55, 60], [43, 50, 55, 59], [45, 52, 57, 60], [41, 48, 53, 57]] },
  lofi: { bpm: 80, seconds: 48, chords: [[50, 53, 57, 60], [43, 53, 59, 62], [48, 52, 55, 59], [45, 52, 55, 60]] },
};

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
// Small fixed-seed random numbers, so the same style always makes the same track.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function makeMusic(style: MusicStyle, sr = 22050): Float32Array {
  const plan = PLANS[style];
  const beat = 60 / plan.bpm, bar = beat * 4, cycle = bar * plan.chords.length;
  const reps = Math.max(1, Math.round(plan.seconds / cycle));
  const n = Math.round(reps * cycle * sr);
  const out = new Float32Array(n);
  const rand = rng(style.length * 7919 + plan.bpm);
  const wrap = (i: number) => ((i % n) + n) % n; // wraps tails round to the start so the loop is seamless

  // A pitched note: a few sine harmonics with an attack and an exponential release.
  const note = (t0: number, dur: number, f: number, amp: number, o: { attack?: number; release?: number; harm?: number[]; detune?: number } = {}) => {
    const attack = o.attack ?? 0.01, release = o.release ?? 0.3, harm = o.harm ?? [1];
    const total = dur + release, a = Math.round(t0 * sr), len = Math.round(total * sr);
    const dets = o.detune ? [1 - o.detune, 1 + o.detune] : [1];
    const w = (2 * Math.PI * f) / sr;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = (t < attack ? t / attack : 1) * (t > dur ? Math.exp(-(t - dur) * (5 / release)) : 1);
      let s = 0;
      for (const d of dets) for (let k = 0; k < harm.length; k++) s += harm[k] * Math.sin(w * d * (k + 1) * i);
      out[wrap(a + i)] += (s / dets.length) * env * amp;
    }
  };
  // A plucked note: decays by itself.
  const pluck = (t0: number, f: number, amp: number, decay = 1) => note(t0, 0.005, f, amp, { attack: 0.004, release: decay, harm: [1, 0.35, 0.12] });
  const kick = (t0: number, amp: number) => {
    const a = Math.round(t0 * sr), len = Math.round(0.28 * sr);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * (45 + 90 * Math.exp(-t * 28))) / sr;
      out[wrap(a + i)] += Math.sin(ph) * Math.exp(-t * 11) * amp;
    }
  };
  const noise = (t0: number, secs: number, amp: number, decay: number, bright = true) => {
    const a = Math.round(t0 * sr), len = Math.round(secs * sr);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = rand() * 2 - 1;
      const s = bright ? r - last : r; // taking the difference removes the low rumble, leaving a bright hiss
      last = r;
      out[wrap(a + i)] += s * Math.exp(-(i / sr) * decay) * amp;
    }
  };

  for (let rep = 0; rep < reps; rep++) {
    plan.chords.forEach((ch, ci) => {
      const t0 = (rep * plan.chords.length + ci) * bar;
      const root = ch[0];
      if (style === "calm") {
        ch.forEach((m) => note(t0, bar - 0.4, hz(m), 0.1, { attack: 1.2, release: 1.6, harm: [1, 0.25], detune: 0.003 }));
        note(t0, bar - 0.3, hz(root - 12), 0.14, { attack: 0.3, release: 1 });
        for (let s = 0; s < 8; s++) pluck(t0 + s * beat * 0.5, hz(ch[[1, 2, 3, 2, 1, 3, 2, 1][s] % ch.length] + 12), 0.06, 1.4);
      } else if (style === "cinematic") {
        ch.forEach((m) => note(t0, bar - 0.2, hz(m), 0.085, { attack: 1.6, release: 1.8, harm: [1, 0.5, 0.33, 0.25], detune: 0.004 }));
        note(t0, bar, hz(root - 12), 0.2, { attack: 0.6, release: 1.4, harm: [1, 0.3] });
        kick(t0, 0.3); kick(t0 + beat * 2, 0.22);
        pluck(t0 + beat * 1.5, hz(ch[2] + 24), 0.035, 2.2);
        pluck(t0 + beat * 3, hz(ch[ch.length - 1] + 24), 0.03, 2.2);
      } else if (style === "upbeat") {
        for (let s = 0; s < 8; s++) {
          const t = t0 + s * beat * 0.5;
          if (s % 2 === 1) ch.slice(1).forEach((m) => note(t, 0.12, hz(m + 12), 0.04, { attack: 0.005, release: 0.18, harm: [1, 0.4] }));
          pluck(t, hz(ch[[0, 2, 3, 2, 1, 3, 2, 3][s] % ch.length] + 12), 0.07, 0.35);
          if (s % 2 === 1) noise(t, 0.05, 0.05, 90);
        }
        for (let b = 0; b < 4; b++) kick(t0 + b * beat, 0.4);
        pluck(t0, hz(root - 12), 0.22, 0.6); pluck(t0 + beat * 2, hz(root - 12), 0.2, 0.6);
      } else {
        const sw = beat * 0.16; // swing: the off-beats land a little late
        [0, beat * 1.5 + sw, beat * 2.5 + sw].forEach((dt, k) =>
          ch.forEach((m, mi) => note(t0 + dt + mi * 0.012, 0.35, hz(m + (k === 0 ? 12 : 0)), 0.05, { attack: 0.008, release: 1.4, harm: [1, 0.5, 0.1] })));
        pluck(t0, hz(root - 12), 0.2, 0.9); pluck(t0 + beat * 2, hz(root - 12), 0.16, 0.9);
        kick(t0, 0.28); kick(t0 + beat * 2 + sw, 0.22);
        noise(t0 + beat, 0.16, 0.12, 22, false); noise(t0 + beat * 3, 0.16, 0.12, 22, false);
        for (let s = 0; s < 8; s++) noise(t0 + s * beat * 0.5 + (s % 2 ? sw : 0), 0.04, 0.035, 110);
        for (let c = 0; c < 6; c++) noise(t0 + rand() * bar, 0.004, 0.05, 400, false); // vinyl crackle
      }
    });
  }

  // Scale to a safe level (the app's music volume slider sets how loud it is in the video).
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0 ? 0.8 / peak : 1;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}
