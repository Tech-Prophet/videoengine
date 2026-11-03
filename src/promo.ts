// Promo Short: a 30 to 45 second vertical teaser cut from the finished video.
// The app cannot watch the video, so an AI reads the numbered sentences of the script and names the most suspenseful passage.
// Passages are always whole sentences, so the voice is never cut in the middle of a word.

export const PROMO_MIN = 28; // seconds of story (the end screen adds CARD_SECONDS, so the finished Short lands between about 31 and 45)
export const PROMO_MAX = 41;
export const PROMO_FLOOR = 15; // below this the clip is too short to make
export const CARD_SECONDS = 3.5;

export type Beat = { n: number; t0: number; t1: number; text: string }; // one spoken sentence, with its place in the whole video
export type Passage = { start: number; end: number; a: number; b: number; secs: number; text: string; note: string };

// Scenes in, numbered sentences out. `start` is when the scene begins in the video; cue times are relative to that.
export function promoBeats(scenes: { start: number; cues: { t0: number; t1: number; ws: string[] }[] }[]): Beat[] {
  const out: Beat[] = [];
  for (const sc of scenes) {
    for (const c of sc.cues) {
      const text = c.ws.join(" ").trim();
      if (!text) continue;
      out.push({ n: out.length + 1, t0: sc.start + c.t0, t1: sc.start + c.t1, text });
    }
  }
  return out;
}

export function promoRequest(o: { title: string; beats: Beat[] }): string {
  const lines = o.beats.map((b) => `[${b.n}] (${Math.max(1, Math.round(b.t1 - b.t0))}s) ${b.text}`);
  return [
    `I am making a vertical teaser clip (a YouTube Short) from the video script below, so that people want to watch the full video.`,
    `Choose ONE passage of consecutive numbered sentences. The number in brackets after each sentence is how long it takes to say.`,
    ``,
    `RULES:`,
    `- The passage must run between ${PROMO_MIN} and ${PROMO_MAX} seconds in total. Add up the seconds.`,
    `- Pick the most suspenseful or important moment of the story: the point where a viewer most wants to know what happens next.`,
    `- End on a moment of tension or an unanswered question. Do not include the resolution or the ending of the story, and do not include a closing call to action.`,
    `- Start where someone who has not seen the rest can still follow. Avoid a first sentence that leans on earlier ones, for example one that begins with "He", "They" or "That" with no clear subject. Do not pick the opening line of the video.`,
    `- Use only sentences from the script, exactly as numbered. Do not rewrite anything.`,
    ``,
    `Reply in exactly this format and nothing else:`,
    ``,
    `START: (number of the first sentence)`,
    `END: (number of the last sentence)`,
    `WHY: (one short sentence)`,
    ``,
    o.title.trim() ? `Video: ${o.title.trim()}` : "",
    ``,
    `Script:`,
    ...lines,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

export type PromoReply = { start?: number; end?: number; why?: string };

// Reads the AI's answer. Bold marks, brackets and the word "sentence" are tolerated.
export function parsePromoReply(reply: string): PromoReply {
  const t = reply.replace(/\*\*|__/g, "");
  const num = (name: string) => {
    const m = t.match(new RegExp(`(?:^|\\n)[\\s#>*_•-]*${name}\\b[^\\n\\d]{0,30}(\\d+)`, "i"));
    return m ? parseInt(m[1], 10) : undefined;
  };
  let start = num("START"), end = num("END");
  if (start === undefined || end === undefined) {
    const r = t.match(/(\d+)\s*(?:-|–|—|to)\s*(\d+)/i); // "sentences 41 to 52"
    if (r) { start ??= parseInt(r[1], 10); end ??= parseInt(r[2], 10); }
  }
  const w = t.match(/(?:^|\n)[\s#>*_•-]*WHY\b[\s*_]*:?[\s*_]*([^\n]+)/i);
  const out: PromoReply = {};
  if (start !== undefined) out.start = start;
  if (end !== undefined) out.end = end;
  if (w && w[1].trim()) out.why = w[1].trim();
  return out;
}

const LEAD_IN = 0.1; // a breath of room before the first word and after the last
const LEAD_OUT = 0.3;

// Times and text for sentences start..end. Nothing is moved: this only measures.
export function passageOf(beats: Beat[], start: number, end: number): Passage | null {
  if (!beats.length) return null;
  const s = Math.max(1, Math.min(beats.length, Math.round(start || 1)));
  const e = Math.max(s, Math.min(beats.length, Math.round(end || s)));
  const a = Math.max(0, beats[s - 1].t0 - LEAD_IN), b = beats[e - 1].t1 + LEAD_OUT;
  return { start: s, end: e, a, b, secs: b - a, text: beats.slice(s - 1, e).map((x) => x.text).join(" "), note: "" };
}

// The AI's pick, trimmed to the allowed length. A passage that is too long loses sentences from the front, so the
// suspenseful ending stays; one that is too short gains sentences before it.
export function fitPassage(beats: Beat[], start: number, end: number): Passage | null {
  let p = passageOf(beats, start, end);
  if (!p) return null;
  let note = "";
  while (p.secs > PROMO_MAX && p.start < p.end) { p = passageOf(beats, p.start + 1, p.end)!; note = `The AI's pick ran longer than ${PROMO_MAX} seconds, so the first sentences were left out.`; }
  while (p.secs < PROMO_MIN && p.start > 1) { p = passageOf(beats, p.start - 1, p.end)!; note = `The AI's pick was shorter than ${PROMO_MIN} seconds, so earlier sentences were added.`; }
  return { ...p, note };
}

export type PromoState = "ok" | "short" | "long" | "tiny";
export const promoState = (secs: number): PromoState => (secs > PROMO_MAX + 0.5 ? "long" : secs < PROMO_FLOOR ? "tiny" : secs < PROMO_MIN ? "short" : "ok");
