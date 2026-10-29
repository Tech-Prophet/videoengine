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

// Captions file (SRT): a number, a time range, the words, a blank line.
const stamp = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000)), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), x = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(x, 3)}`;
};
export function srtFile(cues: { t0: number; t1: number; text: string }[]): string {
  return cues.filter((c) => c.text.trim() && c.t1 > c.t0).map((c, i) => `${i + 1}\n${stamp(c.t0)} --> ${stamp(c.t1)}\n${c.text.trim()}\n`).join("\n");
}

// ---- Prompt for any AI (ChatGPT, Claude, Gemini...) and a reader for its answer ----
export type PromptIn = {
  wide: boolean; tone: string; topic: string; notes: string; length: string; credits: string;
  scenes: { start: string; title: string; text: string }[]; chapters: string[];
};

export function publishPrompt(i: PromptIn): string {
  const script = i.scenes.map((x) => `[${x.start}] ${x.title}\n${x.text.trim()}`).join("\n\n");
  const lines: (string | false)[] = [
    "You are an experienced YouTube editor and copywriter. Below is the finished script of my video. Write everything I need to publish it on YouTube.",
    "",
    "ABOUT THE VIDEO",
    `- Format: ${i.wide ? "normal wide video (16:9)" : "YouTube Short (vertical 9:16)"}`,
    `- Length: ${i.length}`,
    `- Tone: ${i.tone}`,
    i.topic.trim() && `- Topic: ${i.topic.trim()}`,
    i.notes.trim() && `- Extra notes from me (follow these): ${i.notes.trim()}`,
    "",
    "SCRIPT, SCENE BY SCENE (start time, scene name, narration)",
    script,
    "",
    i.wide && i.chapters.length ? `CHAPTER TIMESTAMPS (use these exactly, do not change the times)\n${i.chapters.join("\n")}\n` : "",
    "WRITE YOUR ANSWER IN THIS EXACT LAYOUT. Use plain text only (no bold, no tables). Start each part with its heading on its own line, written exactly like this:",
    "",
    "### TITLE",
    "One best title, under 100 characters. Honest and curiosity-driven, with the main keyword near the start. No false promises.",
    "",
    "### TITLE IDEAS",
    "Three other title options, one per line.",
    "",
    "### DESCRIPTION",
    `Under 5,000 characters. The first two lines are the hook, because that is all people see before \"Show more\". Use the main keywords naturally. Then a short summary of the story${i.wide && i.chapters.length ? ', then the heading \"Chapters:\" followed by the chapter timestamps exactly as given above' : ""}, then one short line asking people to subscribe and comment. End with 3 hashtags.${i.credits.trim() ? ` Keep these credit lines at the very end, exactly as written:\n${i.credits.trim()}` : ""}`,
    "",
    "### TAGS",
    "10 to 15 tags separated by commas, under 500 characters in total, most important first.",
    "",
    "### THUMBNAIL TEXT",
    "3 to 5 words in capital letters that make people curious. Different from the title.",
    "",
    "### PINNED COMMENT",
    "One short comment that asks viewers a question to start a discussion.",
    "",
    "RULES: use only facts that are in my script; do not invent numbers, names or claims; plain, clear language; no emojis unless my notes ask for them.",
  ];
  return lines.filter((l): l is string => typeof l === "string").join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type Answer = { title?: string; description?: string; tags?: string; thumb?: string; pinned?: string };

// Reads the AI's answer. Headings can be "### TITLE", "TITLE:", "**Title**" and so on; "TITLE IDEAS" is ignored.
export function parseAnswer(text: string): Answer {
  const names: Record<string, keyof Answer | "skip"> = { "TITLE": "title", "DESCRIPTION": "description", "TAGS": "tags", "THUMBNAIL TEXT": "thumb", "PINNED COMMENT": "pinned", "TITLE IDEAS": "skip", "HASHTAGS": "skip" };
  const out: Answer = {};
  let key: keyof Answer | "skip" | null = null, buf: string[] = [];
  const flush = () => {
    if (key && key !== "skip") {
      const v = buf.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      if (v && !out[key]) out[key] = v;
    }
    buf = [];
  };
  const HEAD = /^[\s#>*_-]*(THUMBNAIL TEXT|PINNED COMMENT|TITLE IDEAS|DESCRIPTION|HASHTAGS|TITLE|TAGS)[\s*_]*(?::[\s*_]*(.*))?$/i;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\*\*|__/g, "");
    const m = line.match(HEAD);
    if (m) {
      flush(); key = names[m[1].toUpperCase()];
      if (m[2]?.trim()) buf.push(m[2].trim());
    } else buf.push(line);
  }
  flush();
  if (out.title) out.title = out.title.split("\n")[0].replace(/^["'“”\s-]+|["'“”\s]+$/g, "").slice(0, 100);
  if (out.thumb) out.thumb = out.thumb.split("\n")[0].replace(/^["'“”\s-]+|["'“”\s]+$/g, "");
  if (out.tags) {
    const parts = out.tags.split(/[\n,]/).map((t) => t.replace(/^[\s#•*-]+|\s+$/g, "")).filter(Boolean);
    let joined = "";
    for (const t of parts) { const next = joined ? `${joined}, ${t}` : t; if (next.length > 500) break; joined = next; }
    out.tags = joined;
  }
  return out;
}
