// Everything YouTube asks for besides the video itself, prepared from the story. Plain rules, no AI call.

const clockOf = (s: number) => {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(Math.floor(s % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
};

// YouTube chapters: the list must start at 0:00, have at least 3 entries, and every chapter must be at least
// 10 seconds long. A scene shorter than 10 seconds is folded into the chapter before it.
export function chapterList(items: { title: string; start: number }[], total: number): string[] {
  const keep: { title: string; start: number }[] = [];
  items.forEach((it, i) => {
    const prev = keep[keep.length - 1];
    const end = i + 1 < items.length ? items[i + 1].start : total;
    if (prev && end - it.start < 10) return; // too short on its own: stays inside the previous chapter
    keep.push({ title: it.title.trim() || `Part ${keep.length + 1}`, start: i === 0 ? 0 : it.start });
  });
  // a short chapter can also be left behind by a merge: check each kept chapter again
  const ok = keep.filter((c, i) => (i + 1 < keep.length ? keep[i + 1].start : total) - c.start >= 10);
  if (ok.length < 3) return [];
  ok[0] = { ...ok[0], start: 0 };
  return ok.map((c) => `${clockOf(c.start)} ${c.title}`);
}

// "#honeybee #nature #pollination": YouTube shows the first three hashtags above the title.
export function hashtagLine(tags: string, max = 3): string {
  const out: string[] = [];
  for (const raw of tags.split(",")) {
    const w = raw.replace(/^#/, "").replace(/[^\p{L}\p{N}]+/gu, "");
    if (w && !out.includes(`#${w.toLowerCase()}`)) out.push(`#${w.toLowerCase()}`);
    if (out.length >= max) break;
  }
  return out.join(" ");
}

const looksLikeChapter = (l: string) => /^\s*\d{1,2}:\d{2}(?::\d{2})?\s+\S/.test(l);
const looksLikeHashtags = (l: string) => /^\s*(#[\p{L}\p{N}]+\s*)+$/u.test(l);

// The complete description to paste into YouTube: your text, then chapters, then credits, then hashtags.
// Lines in your own text that look like chapters or a hashtag line are left out, so nothing appears twice.
export function fullDescription(desc: string, chapters: string[], credits: string, hashtags: string): string {
  const head = desc.split("\n").filter((l) => !looksLikeChapter(l) && !looksLikeHashtags(l) && !/^\s*chapters:?\s*$/i.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return [head, chapters.length ? `Chapters:\n${chapters.join("\n")}` : "", credits.trim(), hashtags].filter(Boolean).join("\n\n");
}

// Captions file (SRT): a number, a time range, the words, a blank line.
const stamp = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000)), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), x = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(x, 3)}`;
};
export function srtFile(cues: { t0: number; t1: number; text: string }[]): string {
  return cues.filter((c) => c.text.trim() && c.t1 > c.t0).map((c, i) => `${i + 1}\n${stamp(c.t0)} --> ${stamp(c.t1)}\n${c.text.trim()}\n`).join("\n");
}
