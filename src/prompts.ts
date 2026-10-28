// Picture-prompt writer (rule-based, runs in the browser, no AI call and nothing to download).
// For each scene it works out how many visuals the narration needs, splits the narration into that many
// story moments, and writes one prompt per moment. These are first drafts: the person can edit any of them.

export type PromptOpts = { style: string; notes: string; wide: boolean; sceneIndex: number };
type SceneIn = { title: string; text: string; visual: string; duration: number };

const sentences = (t: string) => (t.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [t]).map((x) => x.trim()).filter(Boolean);
const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;

// How many visuals a scene needs: about one for every 7 seconds of narration (1 to 5), and never more than the
// story has moments (a one-sentence scene needs 1, or 2 when that sentence is long).
export function visualCount(text: string, duration: number): number {
  const ss = sentences(text), w = wc(text);
  const byTime = Math.max(1, Math.min(5, Math.round(duration / 7)));
  const moments = Math.max(1, ss.length === 1 && w > 30 ? 2 : ss.length);
  return Math.max(1, Math.min(byTime, moments));
}

// Split the sentences into n groups in story order, balanced by number of words.
export function beats(text: string, n: number): string[] {
  const ss = sentences(text);
  if (n <= 1 || ss.length <= 1) return [ss.join(" ")];
  const total = wc(text), out: string[] = [];
  let cur: string[] = [], curW = 0;
  ss.forEach((s, i) => {
    cur.push(s); curW += wc(s);
    const sentencesLeft = ss.length - i - 1, groupsLeft = n - out.length - 1;
    if (groupsLeft > 0 && sentencesLeft >= groupsLeft && (curW >= total / n || sentencesLeft === groupsLeft)) { out.push(cur.join(" ")); cur = []; curW = 0; }
  });
  if (cur.length) out.push(cur.join(" "));
  return out;
}

const SHOTS = ["wide establishing shot", "medium shot", "close-up detail shot", "low-angle shot", "overhead view", "over-the-shoulder shot"];
const HAS_SHOT = /\b(close[- ]?up|macro|wide|aerial|overhead|drone|low[- ]angle|portrait|silhouette|panorama)\b/i;

function mood(t: string): string {
  const s = t.toLowerCase();
  if (/\b(sunrise|dawn|morning)\b/.test(s)) return "golden morning light";
  if (/\b(sunset|dusk|evening)\b/.test(s)) return "warm sunset glow";
  if (/\b(night|dark|midnight)\b/.test(s)) return "moody low-key lighting";
  if (/\b(danger|trouble|dry|dead|empty|lost|disappear|harm|crisis|war|fear|threat|decline|hurt|drought)\b/.test(s)) return "muted desaturated colours, somber mood";
  if (/\b(hope|help|plant|grow|bloom|beautiful|joy|celebrate|together|protect|safe)\b/.test(s)) return "bright warm hopeful light";
  return "soft natural light";
}

// The story moment, cut at a sentence end (never in the middle of one) unless a single sentence is itself very long.
const gistOf = (t: string, max = 26) => {
  let out = "", n = 0;
  for (const sent of sentences(t)) {
    const w = wc(sent);
    if (n && n + w > max) break;
    out += (out ? " " : "") + sent; n += w;
  }
  const w = out.split(/\s+/);
  return (w.length > max ? w.slice(0, max).join(" ") : out).replace(/[.,;:!?]+$/, "");
};

export function writePrompts(sc: SceneIn, n: number, o: PromptOpts): string[] {
  const hints = sc.visual.split("|").map((x) => x.trim()).filter(Boolean);
  const bs = beats(sc.text, n);
  const lighting = mood(`${sc.title} ${sc.text}`);
  const aspect = o.wide ? "16:9 widescreen" : "9:16 vertical";
  return Array.from({ length: n }, (_, i) => {
    const gist = gistOf(bs[Math.min(i, bs.length - 1)] ?? sc.text);
    const hint = hints.length ? hints[i % hints.length] : "";
    // The first visual of a scene is a wide establishing shot; the rest vary, so a scene is not five copies of one shot.
    const shot = hint && HAS_SHOT.test(hint) ? "" : SHOTS[i === 0 ? 0 : 1 + ((o.sceneIndex + i - 1) % (SHOTS.length - 1))];
    const lead = hint ? `${shot ? `${shot} of ` : ""}${hint}. Story moment: ${gist}` : `${shot} illustrating: ${gist}`;
    const parts = [
      lead.replace(/^./, (c) => c.toUpperCase()),
      lighting,
      o.notes.trim() && `keep these consistent: ${o.notes.trim().replace(/\s+/g, " ")}`,
      o.style.trim(),
      aspect,
      "no text or watermarks",
    ].filter(Boolean);
    return parts.join(", ").slice(0, 900);
  });
}
