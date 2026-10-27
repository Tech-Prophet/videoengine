// Voice and music balance. Rules used (common practice for narrated videos):
//  - The voice is brought to a steady loudness, so a quiet voice and a loud voice end up equally clear.
//  - Music sits about 10 dB below the voice in pauses, and "ducks" about 8 dB further while someone is speaking,
//    so the voice is always on top. Music slides down quickly when speech starts and rises slowly afterwards (no pumping).
//  - A video with music and no voice plays the music at a moderate level.

type Span = { at: number; len: number }; // one narrated sentence: start and length in seconds, relative to the start of its scene

export const VOICE_RMS = 0.16; // about -16 dBFS; loudness every voiceover is brought to (root-mean-square of the speaking parts)
export const GAP_RATIO = 0.3; // music level in pauses, relative to the voice (about -10.5 dB)
export const DUCK = 0.4; // extra music reduction while speaking (about -8 dB)
export const MUSIC_ALONE_RMS = 0.14;
export const DUCK_FLAT = 0.6; // when a voice has no sentence timings (an uploaded recording), music stays a little lower throughout

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// Loudness of the parts that actually contain speech (very quiet samples are ignored, so pauses do not count).
export function rmsActive(data: Float32Array, floor = 0.01): number {
  let s = 0, n = 0;
  for (let i = 0; i < data.length; i++) { const x = data[i]; if (Math.abs(x) > floor) { s += x * x; n++; } }
  return n ? Math.sqrt(s / n) : 0;
}
export function rmsAll(data: Float32Array): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return data.length ? Math.sqrt(s / data.length) : 0;
}

// The volume to give the voice and the music (both are multipliers on the files as they are).
export function levels(voiceRms: number | null, musicRms: number | null) {
  const voice = voiceRms && voiceRms > 0 ? clamp(VOICE_RMS / voiceRms, 0.5, 1.5) : 1;
  const heard = voiceRms && voiceRms > 0 ? VOICE_RMS : 0; // loudness of the voice after the gain above (capped gain may fall short)
  const target = heard ? Math.min(VOICE_RMS, voiceRms! * voice) * GAP_RATIO : MUSIC_ALONE_RMS;
  const music = musicRms && musicRms > 0 ? clamp(target / musicRms, 0.02, 1.5) : 0.15;
  return { voice, music };
}

// Is a sentence being spoken at this moment of the scene? (marks come from the recorded narration)
export function isSpeaking(marks: Span[] | undefined, local: number): boolean {
  if (!marks || !marks.length) return false;
  return marks.some((m) => local >= m.at - 0.15 && local <= m.at + m.len + 0.35);
}

// Music multiplier for this moment: 1 in pauses, DUCK while speaking.
export function duckFactor(hasVoice: boolean, marks: Span[] | undefined, local: number): number {
  if (!hasVoice) return 1;
  if (!marks || !marks.length) return DUCK_FLAT;
  return isSpeaking(marks, local) ? DUCK : 1;
}
