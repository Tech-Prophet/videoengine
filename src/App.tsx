import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { makeMusic, MUSIC_STYLES } from "./music.ts";
import type { MusicStyle } from "./music.ts";
import { XFD, fillsFrame, moveFor, motionP, pose } from "./motion.ts";
import type { Move } from "./motion.ts";
import { drawCaption } from "./captions.ts";
import { duckFactor, levels, rmsActive, rmsAll } from "./mix.ts";

type Fmt = "long" | "short";
type Fit = "blur" | "fill" | "plain"; // what to do with a picture whose shape does not match the video
type Tab = "create" | "scenes" | "audio" | "camera" | "publish";
type Media = HTMLImageElement | HTMLVideoElement;
type Clip = { url: string; kind: "image" | "video"; src?: "upload" | "ai" | "pexels" | "pixabay" }; // src = where the visual came from (no src = recorded on camera)
// onCam = a person speaks on camera in this scene (their own voice, real lip movement). Otherwise it is narration only.
type Draft = { title: string; text: string; onScreen: string; visual: string; onCam?: boolean };
type Mark = { at: number; len: number; text: string }; // one narrated sentence: start and length in seconds, relative to the start of its scene
type Scene = Draft & { id: string; duration: number; palette: number; clips: Clip[]; marks?: Mark[] };
type Meta = { title?: string; description?: string; tags?: string[]; thumb?: string; intro?: string };
type Parsed = { meta: Meta; scenes: Draft[] };
type Live = { scenes: Scene[]; starts: number[]; total: number; fit: Fit; caps: boolean; W: number; H: number; intro: string; voiceVol: number; musicVol: number; duck: boolean; lead: number; tail: number; outro: string };

const PALETTES = [["#1b1442", "#6d3df0"], ["#0b1f33", "#13a8c9"], ["#0f2a22", "#2fb67c"], ["#3a1212", "#e8643a"], ["#1d1d3a", "#d6458f"]];
const FONT = "Inter, system-ui, sans-serif";
const NO_PROVIDERS = { pixabay: false, pexels: false, voice: false, voiceProvider: "" };
const SHOT_SECONDS = 4; // A picture stays about 4 seconds: long enough to read, short enough to keep moving
const uid = () => Math.random().toString(36).slice(2, 9);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const clock = (s: number) => {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(Math.floor(s % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
};
const dims = (f: Fmt, res: number): [number, number] => {
  const l = Math.round((res * 16) / 9 / 2) * 2;
  return f === "long" ? [l, res] : [res, l];
};
const paceOf = (text: string, wpm: number) => Math.max(3, Math.round((words(text).length / wpm) * 600) / 10);
const mkScene = (d: Draft, i: number, wpm: number): Scene => ({ id: uid(), ...d, palette: i % PALETTES.length, duration: paceOf(d.text, wpm), clips: [] });
const shotsOf = (sc: Scene) => (sc.onCam ? sc.clips.slice(0, 1) : sc.clips);
const SHOT_SECONDS_VIDEO = 5;
const shotCount = (dur: number, vid = false) => (vid ? Math.max(2, Math.min(8, Math.ceil(dur / SHOT_SECONDS_VIDEO))) : Math.max(3, Math.min(12, Math.ceil(dur / SHOT_SECONDS))));

// MP4 first: it plays and uploads almost everywhere (WhatsApp, Messenger, Instagram, TikTok, YouTube).
// WebM is only the fallback for browsers that cannot record MP4.
const kindOf = (f: File): "image" | "video" | null =>
  f.type.startsWith("image") ? "image" : f.type.startsWith("video") ? "video"
    : /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name) ? "image" // some phones report no file type at all
    : /\.(mp4|m4v|mov|webm|mkv|3gp|avi)$/i.test(f.name) ? "video" : null;
// Brings one picked file into the app. Photos are shrunk once to a size the video needs (a 12 MP phone photo is far bigger),
// and every file is checked to be readable now, so a problem shows up as a message instead of a silently empty scene.
async function importFile(f: File): Promise<Clip> {
  const kind = kindOf(f);
  if (!kind) throw new Error("not a picture or video");
  if (kind === "image") {
    const url = URL.createObjectURL(f);
    try {
      // Read only the size first (no full decode), then let the browser decode straight to the size the video needs.
      const im = new Image();
      await new Promise<void>((ok, bad) => { im.onload = () => ok(); im.onerror = () => bad(new Error("this browser cannot open that photo format")); im.src = url; });
      const nw = im.naturalWidth, nh = im.naturalHeight;
      if (!nw || !nh) throw new Error("the photo has no readable size");
      const sc = Math.min(1, 1920 / Math.max(nw, nh));
      if (sc === 1) return { url, kind: "image", src: "upload" }; // already small: use it as it is
      const w = Math.max(1, Math.round(nw * sc)), h = Math.max(1, Math.round(nh * sc));
      let bmp: ImageBitmap;
      try { bmp = await createImageBitmap(im, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" }); } catch { throw new Error("not enough memory to open that photo"); }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      if (!x) { bmp.close(); throw new Error("not enough memory to open that photo"); }
      x.drawImage(bmp, 0, 0); bmp.close();
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.9));
      if (!blob) throw new Error("could not prepare the photo");
      URL.revokeObjectURL(url);
      return { url: URL.createObjectURL(blob), kind: "image", src: "upload" };
    } catch (e) { URL.revokeObjectURL(url); throw e; }
  }
  if (f.size > 300e6) throw new Error("video is over 300 MB, too big for a phone browser. Trim or compress it first");
  const url = URL.createObjectURL(f);
  try {
    await new Promise<void>((ok, bad) => {
      const v = document.createElement("video");
      const t = window.setTimeout(() => bad(new Error("the video took too long to open")), 20000);
      v.preload = "metadata"; v.muted = true;
      v.onloadedmetadata = () => { clearTimeout(t); ok(); };
      v.onerror = () => { clearTimeout(t); bad(new Error("this browser cannot play that video")); };
      v.src = url;
    });
  } catch (e) { URL.revokeObjectURL(url); throw e; }
  return { url, kind: "video", src: "upload" };
}

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=h264,aac",
  "video/mp4;codecs=avc1.42E01E,opus",
  "video/mp4",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm",
];

/* ---------- SCRIPT PARSER ---------- */
const GENERIC = /^(scene|part|section|segment|hook|intro|introduction|outro|conclusion|cta|call to action)\s*\d*$/i;
const TS = /[(\[]?\s*\d{1,2}:\d{2}(?:\s*(?:-|–|—|to)\s*\d{1,2}:\d{2})?\s*[)\]]?/gi;
const SCENE_RE = /^(?:scene|section|part|segment)\s*(?:\d+\s*[:.\-–—)]?|[:\-–—])\s*(.*)$/i;
const ON_RE = /^(?:on[- ]?screen(?: text)?|screen text|text on screen)\s*:\s*(.+)$/i;
const VIS_RE = /^(?:visual|b-?roll|image|stock (?:photo|image))\s*:\s*(.+)$/i;
const DEL_RE = /^(?:delivery|speaker)\s*:\s*(.+)$/i;
const NARR_RE = /^(?:narration|voice-?over|narrator|vo)\s*:\s*/i;
const META_RE = /^(video title|title|description|tags|thumbnail(?: text)?|intro(?: text)?)\s*:\s*(.*)$/i;
const strip = (s: string) => s.replace(/^\s*#{1,6}\s*/, "").replace(/^\s*[-•*]\s+/, "").replace(/\*+|__|`/g, "").trim();
const unwrap = (s: string) => (/^\[[^\]]*\]$/.test(s) ? s.slice(1, -1).trim() : s);
const firstWords = (s: string, n: number) => words(s).slice(0, n).join(" ").replace(/[.,;:!?]+$/, "");
const str = (v: unknown) => (typeof v === "string" ? v : "");
const isOnCam = (s: string) => /camera|lip|presenter|talking|on-?screen speaker/i.test(s);

function isHeader(raw: string, line: string) {
  if (/^\s*#{1,6}\s/.test(raw)) return true;
  if (!line || line.length > 90) return false;
  return SCENE_RE.test(line) || /^\[[^\]]+\]$/.test(line);
}
function headerTitle(line: string, n: number) {
  let t = unwrap(line).replace(TS, "").trim();
  const m = t.match(SCENE_RE);
  if (m) t = m[1];
  t = t.replace(/^[\s:.\-–—|]+|[\s:.\-–—|]+$/g, "").trim();
  return t ? t.slice(0, 60) : `Scene ${n}`;
}
function chunk(text: string, base: string, target = 45): Draft[] {
  const sents = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sents) { cur += s; if (words(cur).length >= target) { out.push(cur.trim()); cur = ""; } }
  if (cur.trim()) { if (out.length && words(cur).length < 15) out[out.length - 1] += ` ${cur.trim()}`; else out.push(cur.trim()); }
  return out.map((t, i) => ({ title: `${base} ${i + 1}`, text: t, onScreen: "", visual: "" }));
}
function finish(list: Draft[]): Draft[] {
  return list.filter((d) => d.text.trim()).map((d) => {
    const title = d.title.trim() || "Scene";
    const visual = d.visual.trim() || (GENERIC.test(title) ? firstWords(d.text, 4) : title);
    return { title, text: d.text.trim(), onScreen: d.onScreen.trim(), visual, onCam: !!d.onCam };
  });
}
function fromJson(src: string): Parsed | null {
  try {
    const a = src.search(/[{[]/), b = Math.max(src.lastIndexOf("}"), src.lastIndexOf("]"));
    const d = JSON.parse(src.slice(a, b + 1));
    const o = (Array.isArray(d) ? {} : d) as Record<string, unknown>;
    const arr = (Array.isArray(d) ? d : o.scenes) as Record<string, unknown>[];
    if (!Array.isArray(arr)) return null;
    const scenes = arr.map((s) => ({
      title: str(s.title) || "Scene",
      text: str(s.text) || str(s.narration) || str(s.voiceover),
      onScreen: str(s.onScreen) || str(s.on_screen),
      visual: str(s.visual),
      onCam: s.onCam === true || isOnCam(str(s.delivery)),
    }));
    return { meta: { title: str(o.title), description: str(o.description), tags: Array.isArray(o.tags) ? o.tags.map(String) : undefined, thumb: str(o.thumb) || str(o.thumbnail), intro: str(o.intro) }, scenes: finish(scenes) };
  } catch { return null; }
}
function parseScript(src: string): Parsed {
  const body = src.trim();
  if (/^(?:```(?:json)?\s*)?(\{|\[\s*\{)/.test(body)) { const j = fromJson(body); if (j && j.scenes.length) return j; }
  const meta: Meta = {};
  const lines = body.split(/\r?\n/);
  const firstHeader = lines.findIndex((l) => isHeader(l, strip(l)));
  const limit = firstHeader < 0 ? lines.length : firstHeader;
  const rest: string[] = [];
  lines.forEach((raw, i) => {
    if (i < limit) {
      const m = strip(raw).match(META_RE);
      if (m) {
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k.startsWith("intro")) meta.intro = v;
        else if (k.includes("title")) meta.title = v;
        else if (k === "description") meta.description = v;
        else if (k === "tags") meta.tags = v.split(",").map((x) => x.replace(/^#/, "").trim()).filter(Boolean);
        else meta.thumb = v;
        return;
      }
      if (firstHeader >= 0) return;
    }
    rest.push(raw);
  });
  const out: Draft[] = [];
  if (firstHeader >= 0) {
    const open = (title: string): Draft => { const d: Draft = { title, text: "", onScreen: "", visual: "" }; out.push(d); return d; };
    const cur = () => out[out.length - 1] ?? open(`Scene ${out.length + 1}`);
    for (const raw of rest) {
      const line = strip(raw);
      if (!line) continue;
      const inner = unwrap(line);
      let m: RegExpMatchArray | null;
      if ((m = inner.match(ON_RE))) { cur().onScreen = m[1].trim(); continue; }
      if ((m = inner.match(VIS_RE))) { cur().visual = m[1].trim(); continue; }
      if ((m = inner.match(DEL_RE))) { cur().onCam = isOnCam(m[1]); continue; }
      if (isHeader(raw, line)) { open(headerTitle(line, out.length + 1)); continue; }
      const t = line.replace(/\[[^\]]*\]/g, "").replace(NARR_RE, "").trim();
      if (t) { const c = cur(); c.text += (c.text ? " " : "") + t; }
    }
    return { meta, scenes: finish(out) };
  }
  const blocks = rest.join("\n").split(/\n\s*\n/).map((b) => b.split("\n").map(strip).filter(Boolean)).filter((b) => b.length);
  blocks.forEach((ls) => {
    let title = "", on = "", vis = "", cam = false;
    const parts: string[] = [];
    ls.forEach((l, i) => {
      const inn = unwrap(l);
      let m: RegExpMatchArray | null;
      if ((m = inn.match(ON_RE))) on = m[1];
      else if ((m = inn.match(VIS_RE))) vis = m[1];
      else if ((m = inn.match(DEL_RE))) cam = isOnCam(m[1]);
      else if (i === 0 && ls.length > 1 && l.length <= 50 && !/[.!?,;]$/.test(l)) title = l.replace(/:$/, "");
      else parts.push(l.replace(/\[[^\]]*\]/g, "").replace(NARR_RE, ""));
    });
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    if (!text) return;
    if (words(text).length > 110) chunk(text, title || "Part").forEach((d) => out.push({ ...d, onScreen: on, visual: vis, onCam: cam }));
    else out.push({ title: title || `Part ${out.length + 1}`, text, onScreen: on, visual: vis, onCam: cam });
  });
  return { meta, scenes: finish(out) };
}

/* ---------- PHOTOS & RICH VISUAL FALLBACK ---------- */
async function fetchPhoto(url: string): Promise<string | null> {
  for (let a = 0; a < 2; a++) {
    try { const r = await fetch(url); if (r.ok) return URL.createObjectURL(await r.blob()); } catch { /* retry once, then fall through */ }
  }
  try {
    await new Promise<void>((ok, bad) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(); im.onerror = () => bad(new Error("blocked")); im.src = url; });
    return url;
  } catch { return null; }
}

// In the stock and voice helpers below, "key" is the access code for our own server functions
// (or "" when that provider has no key on the server). Real provider keys never reach the browser.
const apiStock = (qs: string, code: string) => fetch(`/api/stock?${qs}`, { headers: { "x-access-code": code } });
const orient = (f: Fmt) => (f === "long" ? "landscape" : "portrait");

async function stockImages(key: string, groups: { q: string; cap: number }[], f: Fmt, n: number, page = 1): Promise<string[]> {
  const seen = new Set<number>(), urls: string[] = [];
  if (key) {
    for (const g of groups) {
      if (!g.q || urls.length >= n) continue;
      try {
        const r = await apiStock(`provider=pixabay&kind=photos&q=${encodeURIComponent(g.q)}&orientation=${orient(f)}&per_page=${Math.min(50, n + 6)}&page=${page}`, key);
        if (!r.ok) throw new Error("Pixabay request failed. Check the access code and the server keys.");
        let taken = 0;
        for (const p of (await r.json()).hits ?? []) {
          if (urls.length >= n || taken >= g.cap) break;
          if (seen.has(p.id)) continue;
          seen.add(p.id); taken++; urls.push(p.largeImageURL as string);
        }
      } catch { /* fall back to placeholder photos below */ }
    }
  }
  return (await Promise.all(urls.map(fetchPhoto))).filter((u): u is string => !!u);
}

async function stockVideos(key: string, groups: { q: string; cap: number }[], n: number, quality: "medium" | "small", page = 1): Promise<string[]> {
  const seen = new Set<number>(), urls: string[] = [];
  if (!key) return [];
  for (const g of groups) {
    if (!g.q || urls.length >= n) continue;
    try {
      const r = await apiStock(`provider=pixabay&kind=videos&q=${encodeURIComponent(g.q)}&per_page=${Math.min(50, n + 8)}&page=${page}`, key);
      if (!r.ok) continue;
      let taken = 0;
      for (const p of (await r.json()).hits ?? []) {
        if (urls.length >= n || taken >= g.cap) break;
        if (seen.has(p.id) || (p.duration && p.duration < 4)) continue;
        const v = p.videos?.[quality]?.url || p.videos?.small?.url || p.videos?.medium?.url;
        if (!v) continue;
        seen.add(p.id); taken++; urls.push(v as string);
      }
    } catch { /* try next */ }
  }
  return (await Promise.all(urls.map(async (u) => {
    try { const r = await fetch(u); if (r.ok) return URL.createObjectURL(await r.blob()); } catch { /* skip */ }
    return null;
  }))).filter((u): u is string => !!u);
}

type PxFile = { file_type?: string; width?: number; height?: number; link?: string };
const blobUrl = async (u: string): Promise<string | null> => {
  try { const r = await fetch(u); if (r.ok) return URL.createObjectURL(await r.blob()); } catch { /* skip */ }
  return null;
};
async function pexelsVideos(key: string, groups: { q: string; cap: number }[], f: Fmt, n: number, res: number, page = 1): Promise<string[]> {
  if (!key || n <= 0) return [];
  const seen = new Set<number>(), links: string[] = [];
  const want = res >= 1440 ? 1920 : 1280;
  const side = (x: PxFile) => Math.max(x.width ?? 0, x.height ?? 0);
  for (const g of groups) {
    if (!g.q || links.length >= n) continue;
    try {
      const r = await apiStock(`provider=pexels&kind=videos&q=${encodeURIComponent(g.q)}&orientation=${orient(f)}&per_page=${Math.min(40, n + 8)}&page=${page}`, key);
      if (!r.ok) continue;
      let taken = 0;
      for (const v of (await r.json()).videos ?? []) {
        if (links.length >= n || taken >= g.cap) break;
        if (seen.has(v.id) || (v.duration && v.duration < 4)) continue;
        const files = ((v.video_files ?? []) as PxFile[]).filter((x) => x.link && x.file_type === "video/mp4" && x.width && x.height);
        const pick = files.filter((x) => side(x) >= want).sort((x, y) => side(x) - side(y))[0] ?? files.sort((x, y) => side(y) - side(x))[0];
        if (!pick?.link) continue;
        seen.add(v.id); taken++; links.push(pick.link);
      }
    } catch { /* try next search */ }
  }
  return (await Promise.all(links.map(blobUrl))).filter((u): u is string => !!u);
}
async function pexelsPhotos(key: string, groups: { q: string; cap: number }[], f: Fmt, n: number, page = 1): Promise<string[]> {
  if (!key || n <= 0) return [];
  const seen = new Set<number>(), urls: string[] = [];
  for (const g of groups) {
    if (!g.q || urls.length >= n) continue;
    try {
      const r = await apiStock(`provider=pexels&kind=photos&q=${encodeURIComponent(g.q)}&orientation=${orient(f)}&per_page=${Math.min(40, n + 6)}&page=${page}`, key);
      if (!r.ok) continue;
      let taken = 0;
      for (const p of (await r.json()).photos ?? []) {
        if (urls.length >= n || taken >= g.cap) break;
        if (seen.has(p.id)) continue;
        const u = p.src?.large2x || p.src?.large;
        if (!u) continue;
        seen.add(p.id); taken++; urls.push(u as string);
      }
    } catch { /* try next search */ }
  }
  return (await Promise.all(urls.map(fetchPhoto))).filter((u): u is string => !!u);
}

// Order: Pexels video, Pixabay video, Pexels photos, Pixabay photos. Every clip is tagged with its source.
async function stockFootage(k: { pixabay: string; pexels: string }, groups: { q: string; cap: number }[], f: Fmt, n: number, res: number, video: boolean, page = 1): Promise<Clip[]> {
  const out: Clip[] = [];
  const add = (urls: string[], kind: Clip["kind"], src: NonNullable<Clip["src"]>) => urls.forEach((url) => { if (out.length < n) out.push({ url, kind, src }); });
  if (video && k.pexels) add(await pexelsVideos(k.pexels, groups, f, n, res, page), "video", "pexels");
  if (video && k.pixabay && out.length < n) add(await stockVideos(k.pixabay, groups, n - out.length, res >= 1080 ? "medium" : "small", page), "video", "pixabay");
  if (out.length < n && k.pexels) add(await pexelsPhotos(k.pexels, groups, f, n - out.length, page), "image", "pexels");
  if (out.length < n) {
    try { add(await stockImages(k.pixabay, groups, f, n - out.length, page), "image", "pixabay"); }
    catch (e) { if (!out.length) throw e; }
  }
  return out;
}
// Visuals the user supplied (uploads, or recorded on camera) are never replaced by generated ones.
const mine = (c: Clip) => c.src === "upload" || !c.src;
const ORIGIN: Record<string, string> = { upload: "Your upload", ai: "AI image", pexels: "Pexels", pixabay: "Pixabay" };
const originOf = (c: Clip) => (c.src ? `${ORIGIN[c.src]}${c.src === "pexels" || c.src === "pixabay" ? (c.kind === "video" ? " video" : " photo") : ""}` : "Camera recording");
// Pexels and Pixabay ask for a visible source line. It is kept in the description automatically, only while their visuals are in the video.
const CREDIT_HEAD = "\n\nStock footage credits:";
const withCredits = (d: string, list: Scene[]) => {
  const head = d.split(CREDIT_HEAD)[0];
  const all = list.flatMap((s) => s.clips);
  const lines: string[] = [];
  if (all.some((c) => c.src === "pexels")) lines.push("Videos and photos provided by Pexels (https://www.pexels.com)");
  if (all.some((c) => c.src === "pixabay")) lines.push("Videos and photos from Pixabay (https://pixabay.com)");
  return lines.length ? `${head}${CREDIT_HEAD}\n${lines.join("\n")}` : head;
};
type AiState = { fails: number };
const ANGLES = ["wide establishing shot", "close-up detail", "medium shot with natural action", "low angle dramatic view", "aerial view", "soft focus foreground depth"];
const aiShots = (dur: number) => Math.max(3, Math.min(6, Math.ceil(dur / 8)));
// Free, keyless photoreal image generation. Fails safe: after 3 failed images it stops trying for the rest of the run.
async function aiImages(queries: string[], topic: string, f: Fmt, n: number, st: AiState, narr: string[] = []): Promise<string[]> {
  if (n <= 0 || !queries.length) return [];
  const [w, h] = f === "long" ? [1280, 720] : [720, 1280];
  const one = async (i: number): Promise<string | null> => {
    const prompt = `${narr[i] ? `Scene: ${narr[i]}. ` : ""}${queries[i % queries.length]}, ${topic}, ${ANGLES[i % ANGLES.length]}, ultra realistic professional photograph, natural lighting, sharp focus, high detail, no text, no watermark`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&model=flux&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
    for (let a = 0; a < 2; a++) {
      const ctl = new AbortController();
      const to = window.setTimeout(() => ctl.abort(), 60000);
      try {
        const r = await fetch(url, { signal: ctl.signal });
        if (r.ok && (r.headers.get("content-type") || "").startsWith("image")) {
          const b = await r.blob();
          if (b.size > 5000) { clearTimeout(to); return URL.createObjectURL(b); }
        }
      } catch { /* retry once */ }
      clearTimeout(to);
    }
    st.fails++;
    return null;
  };
  const out: string[] = [];
  for (let i = 0; i < n && st.fails < 3; i += 2) {
    const got = await Promise.all([i, i + 1].filter((k) => k < n).map(one));
    got.forEach((u) => { if (u) out.push(u); });
  }
  return out;
}
type Source = "ai" | "stock" | "mix";
const shotsFor = (src: Source, dur: number, moving: boolean) => (src === "ai" ? aiShots(dur) : src === "mix" ? Math.max(4, Math.min(8, Math.ceil(dur / 7))) : shotCount(dur, moving));
type Gather = { keys: { pixabay: string; pexels: string }; source: Source; topic: string; f: Fmt; res: number; moving: boolean; st: AiState; page?: number };
// The sentence being narrated at a given point (0 to 1) of a scene, used to make AI pictures match the story.
const narrAt = (text: string, frac: number) => {
  const ss = sentencesOf(text);
  if (!ss.length) return "";
  const x = ss[Math.min(ss.length - 1, Math.floor(Math.max(0, frac) * ss.length))];
  return x.length > 140 ? x.slice(0, 140) : x;
};
async function gatherClips(o: Gather, sc: Scene, n: number): Promise<Clip[]> {
  const own = sc.visual.split("|").map((x) => x.trim()).filter(Boolean);
  const qs = own.length ? own : [sc.title];
  const page = o.page ?? 1;
  const aiClips = async (count: number, offset: number): Promise<Clip[]> => {
    const narr = Array.from({ length: count }, (_, i) => narrAt(sc.text, (offset + i) / Math.max(1, n)));
    return (await aiImages(qs, o.topic, o.f, count, o.st, narr)).map((url) => ({ url, kind: "image" as const, src: "ai" as const }));
  };
  if (o.source === "mix") {
    // Half real stock video, half AI photos, interleaved so every scene has both moving video and images.
    const vids: Clip[] = [];
    const want = o.moving ? Math.floor(n / 2) : 0;
    if (want > 0) {
      const groups = photoGroups(sc, o.topic, want);
      if (o.keys.pexels) (await pexelsVideos(o.keys.pexels, groups, o.f, want, o.res, page)).forEach((url) => vids.push({ url, kind: "video", src: "pexels" }));
      if (vids.length < want && o.keys.pixabay) (await stockVideos(o.keys.pixabay, groups, want - vids.length, o.res >= 1080 ? "medium" : "small", page)).forEach((url) => vids.push({ url, kind: "video", src: "pixabay" }));
    }
    const nImg = n - vids.length;
    const slot = (i: number) => (i < vids.length ? 2 * i + 1 : vids.length + i);
    const narr = Array.from({ length: nImg }, (_, i) => narrAt(sc.text, slot(i) / Math.max(1, n)));
    const imgs = (await aiImages(qs, o.topic, o.f, nImg, o.st, narr)).map((url) => ({ url, kind: "image" as const, src: "ai" as const }));
    const mixed: Clip[] = [];
    for (let i = 0; i < Math.max(vids.length, imgs.length); i++) {
      if (i < vids.length) mixed.push(vids[i]);
      if (i < imgs.length) mixed.push(imgs[i]);
    }
    return mixed;
  }
  const out: Clip[] = [];
  const hasStockKey = !!(o.keys.pexels || o.keys.pixabay);
  if (o.source === "ai") out.push(...(await aiClips(n, 0)));
  if (out.length < n && hasStockKey) {
    const need = n - out.length;
    try { out.push(...(await stockFootage(o.keys, photoGroups(sc, o.topic, need), o.f, need, o.res, o.moving, page))); }
    catch (e) { if (!out.length) throw e; }
  }
  // Stock mode: any gap is filled with AI pictures made from the narration, never random photos.
  if (o.source === "stock" && out.length < n) out.push(...(await aiClips(n - out.length, out.length)));
  return out;
}
// Keyword searches only: the scene's own VISUAL lines and shorter versions of them. Generic title/topic searches are used only when a scene has no VISUAL line.
const FILLER = /^(aerial|view|shot|close-up|closeup|wide|medium|slow|footage|scene)$/i;
const photoGroups = (s: Scene, topic: string, n: number) => {
  const own = s.visual.split("|").map((x) => x.trim()).filter(Boolean);
  const per = Math.ceil(n / Math.max(1, own.length));
  const seen = new Set<string>();
  const out: { q: string; cap: number }[] = [];
  const add = (q: string, cap: number) => { const k = q.trim().toLowerCase(); if (k && !seen.has(k)) { seen.add(k); out.push({ q: q.trim(), cap }); } };
  own.forEach((q) => add(q, per));
  own.forEach((q) => { const w = words(q).filter((x) => !FILLER.test(x)); add(w.slice(-2).join(" "), per); add(w.slice(0, 2).join(" "), per); });
  if (!own.length) { add(s.title, n); add(topic, n); }
  return out;
};

const borrowVisuals = (list: Scene[]): Scene[] =>
  list.map((sc, i) => {
    if (sc.clips.length) return sc;
    let best: Scene | undefined, bd = Infinity;
    for (let j = 0; j < list.length; j++) if (list[j].clips.length && Math.abs(j - i) < bd) { best = list[j]; bd = Math.abs(j - i); }
    return best ? { ...sc, clips: best.clips } : sc;
  });

/* ---------- SAVED PROJECT (this browser only) ---------- */
// Saves the script, scene text, durations and settings. Pictures, clips and audio are NOT saved,
// because they live in memory; they are fetched or recorded again.
const SAVE_KEY = "vortex-project";
type Saved = {
  v: 1; fmt: Fmt; res: number; fps: number; wpm: number; topic: string; tone: string; minutes: number; minSec: number;
  scriptText: string; intro: string; source: Source; moving: boolean; caps: boolean; fit?: Fit; musicStyle?: MusicStyle; autoMusic?: boolean; balance?: boolean; leadSec?: number; outro?: string;
  vTitle: string; vDesc: string; vTags: string; thumbText: string;
  scenes: Omit<Scene, "clips" | "marks">[];
};
function loadSaved(): Saved | null {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || "null") as Partial<Saved> | null;
    if (!d || d.v !== 1 || !Array.isArray(d.scenes) || !d.scenes.length) return null;
    return d as Saved;
  } catch { return null; }
}

/* ---------- NARRATION ---------- */
async function speak(key: string, text: string, voice: string) {
  let last = "";
  for (let a = 0; a < 3; a++) {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-code": key },
      body: JSON.stringify({ text, voice }),
    });
    if (r.ok) return r.blob();
    const why = await r.json().then((j: { error?: string }) => j.error).catch(() => undefined);
    if (![429, 502, 503, 504].includes(r.status)) throw new Error(why || `Voice API returned ${r.status}.`);
    last = why || `Voice API returned ${r.status}.`;
    await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
  }
  throw new Error(last || "Voice API is busy.");
}
const splitText = (t: string, max = 3500) => {
  const out: string[] = [];
  let cur = "";
  for (const s of t.match(/[^.!?]+[.!?]*\s*/g) ?? [t]) { if (cur && (cur + s).length > max) { out.push(cur.trim()); cur = ""; } cur += s; }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
function toWav(data: Float32Array, sr: number) {
  const buf = new ArrayBuffer(44 + data.length * 2), v = new DataView(buf);
  const w = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + data.length * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) { const x = Math.max(-1, Math.min(1, data[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = [];
  let line = "";
  for (const w of words(text)) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/* ---------- RENDER & TIMING ---------- */
const sentencesOf = (t: string) => (t.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [t]).map((x) => x.trim()).filter(Boolean);
type Cue = { t0: number; t1: number; ws: string[] };
const cueCache = new WeakMap<Scene, Cue[]>();
function cuesOf(sc: Scene): Cue[] {
  const hit = cueCache.get(sc);
  if (hit) return hit;
  let out: Cue[];
  if (sc.marks?.length) out = sc.marks.map((m) => ({ t0: m.at, t1: m.at + m.len, ws: words(m.text) }));
  else {
    const ss = sentencesOf(sc.text), wt = ss.map((x) => x.length + 14), tot = wt.reduce((a, b) => a + b, 0) || 1;
    let at = 0;
    out = ss.map((x, i) => { const len = (sc.duration * wt[i]) / tot; const c = { t0: at, t1: at + len, ws: words(x) }; at += len; return c; });
  }
  cueCache.set(sc, out);
  return out;
}
const startCache = new WeakMap<Scene, number[]>();
function shotStarts(sc: Scene): number[] {
  const hit = startCache.get(sc);
  if (hit) return hit;
  const n = shotsOf(sc).length, step = sc.duration / Math.max(1, n);
  const cand = cuesOf(sc).slice(1).map((c) => c.t0);
  const out = [0];
  for (let k = 1; k < n; k++) {
    const ideal = step * k;
    let best = ideal, bd = Infinity;
    for (const c of cand) { const d = Math.abs(c - ideal); if (d < bd) { bd = d; best = c; } }
    let st = bd <= step * 0.45 ? best : ideal;
    st = Math.max(st, out[k - 1] + Math.min(1.0, step * 0.5));
    out.push(Math.min(st, sc.duration - 0.3));
  }
  startCache.set(sc, out);
  return out;
}
function shotAt(sc: Scene, local: number) {
  const n = shotsOf(sc).length;
  if (!n) return null;
  const st = shotStarts(sc);
  let k = 0;
  for (let j = 0; j < n; j++) if (local >= st[j]) k = j;
  const end = k < n - 1 ? st[k + 1] : sc.duration;
  return { k, n, len: Math.max(0.1, end - st[k]), sl: Math.max(0, local - st[k]) };
}
function drawBg(ctx: CanvasRenderingContext2D, w: number, h: number, sc: Scene, time: number) {
  const [a, b] = PALETTES[sc.palette % PALETTES.length];
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (sc.clips.length) return;
  for (let i = 0; i < 3; i++) {
    const t = time * 0.25 + i * 2.1;
    const cx = w * (0.5 + 0.35 * Math.cos(t + i)), cy = h * (0.5 + 0.3 * Math.sin(t * 0.8 + i * 1.7)), r = Math.min(w, h) * (0.35 + 0.08 * i);
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, "rgba(255,255,255,0.16)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
  }
}
const mediaReady = (m: Media | undefined) => !!m && (m instanceof HTMLVideoElement ? m.readyState >= 2 && m.videoWidth > 0 : m.complete && m.naturalWidth > 0);
const mediaSettled = (m: Media | undefined) => !m || (m instanceof HTMLVideoElement ? m.readyState >= 2 || !!m.error : m.complete);
// Pictures are shrunk once (in steps, with high quality) to about 1.5 times the video size. Drawing a huge phone photo
// straight onto a small frame while it moves makes it shimmer.
type Src = { img: CanvasImageSource; w: number; h: number };
const shrunk = new WeakMap<HTMLImageElement, { long: number; c: HTMLCanvasElement }>();
function srcOf(m: Media, long: number): Src | null {
  if (m instanceof HTMLVideoElement) return m.videoWidth && m.videoHeight ? { img: m, w: m.videoWidth, h: m.videoHeight } : null;
  const nw = m.naturalWidth, nh = m.naturalHeight;
  if (!nw || !nh) return null;
  if (Math.max(nw, nh) <= long * 1.25) return { img: m, w: nw, h: nh };
  const hit = shrunk.get(m);
  if (hit && hit.long === long) return { img: hit.c, w: hit.c.width, h: hit.c.height };
  const sc = long / Math.max(nw, nh), tw = Math.max(1, Math.round(nw * sc)), th = Math.max(1, Math.round(nh * sc));
  let cur: CanvasImageSource = m, cw = nw, ch = nh;
  const step = (w2: number, h2: number) => {
    const c = document.createElement("canvas");
    c.width = w2; c.height = h2;
    const x = c.getContext("2d");
    if (!x) return null;
    x.imageSmoothingQuality = "high";
    x.drawImage(cur, 0, 0, w2, h2);
    return c;
  };
  while (cw / 2 >= tw) {
    const c = step(Math.round(cw / 2), Math.max(1, Math.round(ch / 2)));
    if (!c) return { img: m, w: nw, h: nh };
    cur = c; cw = c.width; ch = c.height;
  }
  const fin = step(tw, th);
  if (!fin) return { img: m, w: nw, h: nh };
  shrunk.set(m, { long, c: fin });
  return { img: fin, w: tw, h: th };
}
let blurCv: HTMLCanvasElement | null = null;
let fitMode: Fit = "blur"; // set once per frame from the project setting
// Draws a picture or video into the frame. If its shape is close to the frame's, it fills the frame. If not
// (for example an upright phone photo in a wide video), the whole picture is shown over a blurred, darkened copy of itself.
function paintMedia(ctx: CanvasRenderingContext2D, w: number, h: number, m: Media, z: number, px: number, py: number) {
  const s = srcOf(m, Math.ceil(Math.max(w, h) * 1.5));
  if (!s) return;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  const matches = fillsFrame(s.w, s.h, w, h);
  if (matches || fitMode === "fill") {
    const base = Math.max(w / s.w, h / s.h), dw = s.w * base * z, dh = s.h * base * z;
    const spareY = dh - h;
    // A picture that does not match the frame is cropped with its upper part kept, because faces and subjects sit higher up.
    const y = matches ? (h - dh) / 2 + (py * spareY) / 2 : Math.max(-spareY, Math.min(0, -spareY * 0.3 + (py * spareY) / 2));
    ctx.drawImage(s.img, (w - dw) / 2 + (px * (dw - w)) / 2, y, dw, dh);
    return;
  }
  if (fitMode === "plain") {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#14151f"); g.addColorStop(1, "#07080d");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  } else {
    const bw = 96, bh = Math.max(2, Math.round((96 * h) / w));
    blurCv ??= document.createElement("canvas");
    if (blurCv.width !== bw || blurCv.height !== bh) { blurCv.width = bw; blurCv.height = bh; }
    const bx = blurCv.getContext("2d");
    if (bx) {
      bx.imageSmoothingQuality = "high";
      const k = Math.max(bw / s.w, bh / s.h), cw = bw / k, ch = bh / k;
      bx.drawImage(s.img, (s.w - cw) / 2, (s.h - ch) / 2, cw, ch, 0, 0, bw, bh);
      ctx.drawImage(blurCv, 0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, w, h);
    }
  }
  const base = Math.min(w / s.w, h / s.h), zz = 1 + (z - 1) * 0.4, dw = s.w * base * zz, dh = s.h * base * zz;
  ctx.drawImage(s.img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
function drawMedia(ctx: CanvasRenderingContext2D, w: number, h: number, m: Media, p: number, mv: Move | null, len: number) {
  const c = pose(mv, p, len, m instanceof HTMLVideoElement);
  paintMedia(ctx, w, h, m, c.z, c.px, c.py);
}
function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, sc: Scene, local: number, time: number, getMedia: (url: string) => Media | undefined, si: number, count: number) {
  drawBg(ctx, w, h, sc, time);
  const sh = shotAt(sc, local);
  if (!sh) return;
  const shots = shotsOf(sc);
  const mvOf = (k: number) => (sc.onCam ? null : moveFor(si, k, si === 0 && k === 0, si === count - 1 && k === sh.n - 1));
  let m = getMedia(shots[sh.k].url);
  if (!mediaReady(m)) m = shots.map((x) => getMedia(x.url)).find(mediaReady);
  if (m) drawMedia(ctx, w, h, m, motionP(sh.k, sh.sl, sh.len), mvOf(sh.k), sh.len);
  const xf = Math.min(XFD, sh.len * 0.3);
  if (sh.k < sh.n - 1 && sh.sl > sh.len - xf) {
    const nm = getMedia(shots[sh.k + 1].url);
    if (mediaReady(nm) && nm) {
      // The next shot is already moving while it fades in, so nothing freezes during the dissolve.
      const st = shotStarts(sc), nlen = (sh.k + 1 < sh.n - 1 ? st[sh.k + 2] : sc.duration) - st[sh.k + 1];
      ctx.globalAlpha = (sh.sl - (sh.len - xf)) / xf;
      drawMedia(ctx, w, h, nm, motionP(sh.k + 1, Math.min(0, sh.sl - sh.len), nlen), mvOf(sh.k + 1), nlen);
      ctx.globalAlpha = 1;
    }
  }
  if (m && !sc.onCam) { ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(0, 0, w, h); }
}
function drawFrame(ctx: CanvasRenderingContext2D, L: Live, i: number, tt: number, getMedia: (url: string) => Media | undefined) {
  const { W: w, H: h } = L;
  fitMode = L.fit;
  const sc = L.scenes[i];
  if (!sc) { ctx.fillStyle = "#05060d"; ctx.fillRect(0, 0, w, h); return; }
  const u = Math.min(w, h) / 1080;
  const local = tt - L.starts[i];
  const XF = XFD;
  if (i > 0 && local < XF) {
    const pv = L.scenes[i - 1];
    drawScene(ctx, w, h, pv, pv.duration + local, tt, getMedia, i - 1, L.scenes.length); // the old scene keeps moving while it fades out
    ctx.globalAlpha = Math.max(0, local / XF);
    drawScene(ctx, w, h, sc, local, tt, getMedia, i, L.scenes.length);
    ctx.globalAlpha = 1;
  } else drawScene(ctx, w, h, sc, local, tt, getMedia, i, L.scenes.length);

  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff";

  // Title: bold, large, slightly above centre, thin dark outline. With a music-only lead-in it shows while the music plays alone.
  const introEnd = Math.min(L.lead > 0 ? L.lead + 1.8 : 5.5, L.scenes[0].duration - 0.3, L.total * 0.4);
  const introStart = L.lead > 0 ? 0.5 : 0.4;
  if (L.intro && tt > introStart && tt < introEnd) {
    ctx.globalAlpha = Math.max(0, Math.min(1, (tt - introStart) / 0.7, (introEnd - tt) / 0.6));
    ctx.font = `700 ${54 * u}px ${FONT}`; // moderate size: about 5% of the frame height
    ctx.lineJoin = "round"; ctx.lineWidth = 4 * u; ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 12 * u;
    const lines = wrap(ctx, L.intro, w * 0.75), lh = 68 * u, y0 = h * 0.4 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, k) => { ctx.strokeText(l, w / 2, y0 + k * lh); ctx.fillText(l, w / 2, y0 + k * lh); });
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent"; ctx.globalAlpha = 1;
  }
  // Ending message: typed by you, shown over the last seconds while the music rises and fades.
  if (L.outro && L.tail > 0 && tt > L.total - L.tail + 0.3 && tt < L.total - 0.6) {
    ctx.globalAlpha = Math.max(0, Math.min(1, (tt - (L.total - L.tail + 0.3)) / 0.7));
    ctx.font = `700 ${50 * u}px ${FONT}`;
    ctx.lineJoin = "round"; ctx.lineWidth = 5 * u; ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 16 * u;
    const lines = wrap(ctx, L.outro, w * 0.8), lh = 80 * u, y0 = h * 0.45 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, k) => { ctx.strokeText(l, w / 2, y0 + k * lh); ctx.fillText(l, w / 2, y0 + k * lh); });
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent"; ctx.globalAlpha = 1;
  }

  if (L.caps && sc.text) {
    const cues = cuesOf(sc);
    let ci = 0;
    cues.forEach((c, k) => { if (local >= c.t0 - 0.05) ci = k; });
    const cue = cues[ci];
    if (cue && local >= cue.t0 - 0.05 && local <= cue.t1 + 0.5) { // never before the voice says it: no caption during the music-only start
      const nCh = Math.max(1, Math.ceil(cue.ws.length / 7)), size = Math.ceil(cue.ws.length / nCh);
      const pr = Math.max(0, Math.min(0.999, (local - cue.t0) / Math.max(0.2, cue.t1 - cue.t0)));
      const idx = Math.min(nCh - 1, Math.floor(pr * nCh));
      drawCaption(ctx, w, h, cue.ws.slice(idx * size, idx * size + size).join(" "));
    }
  }

  const fade = tt < 0.5 ? 1 - tt / 0.5 : L.total - tt < 0.6 ? 1 - (L.total - tt) / 0.6 : 0;
  if (fade > 0) { ctx.globalAlpha = Math.min(1, fade); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
}

const thumbBlob = (c: HTMLCanvasElement): Promise<Blob | null> => new Promise((res) => {
  const qs = [0.92, 0.82, 0.7, 0.55];
  const go = (i: number) => c.toBlob((b) => { if (!b) return res(null); if (b.size < 1.9e6 || i === qs.length - 1) return res(b); go(i + 1); }, "image/jpeg", qs[i]);
  try { go(0); } catch { res(null); }
});

const inp = "w-full rounded-md bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-sm focus:outline-none focus:border-violet-500";
const btn = (p = false) => `rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${p ? "bg-violet-600 hover:bg-violet-500" : "bg-slate-800 hover:bg-slate-700"}`;
const Field = ({ l, children }: { l: string; children: ReactNode }) => (
  <label className="block"><span className="mb-1 block text-xs text-slate-400">{l}</span>{children}</label>
);
const STEPS = ["Read script", "Voiceover and music", "Find visuals", "Render video"];

export default function App() {
  const [saved] = useState(loadSaved);
  const [fmt, setFmt] = useState<Fmt>(saved?.fmt ?? "long");
  const [res, setRes] = useState(saved?.res ?? 1080);
  const [fps, setFps] = useState(saved?.fps ?? 30);
  const [wpm, setWpm] = useState(saved?.wpm ?? 150);
  const [tab, setTab] = useState<Tab>("create");
  const [topic, setTopic] = useState(saved?.topic ?? "");
  const [tone, setTone] = useState(saved?.tone ?? "Friendly");
  const [minutes, setMinutes] = useState(saved?.minutes ?? 3);
  const [minSec, setMinSec] = useState(saved?.minSec ?? 120);
  const [scriptText, setScriptText] = useState(saved?.scriptText ?? "");
  const [intro, setIntro] = useState(saved?.intro ?? "Vortex AI Studio");
  const [scenes, setScenes] = useState<Scene[]>(() =>
    saved
      ? saved.scenes.map((s) => ({ ...s, onCam: false, clips: [] }))
      : [mkScene({ title: "Hook", text: "Paste a script in the Create tab and press Generate video.", onScreen: "", visual: "" }, 0, 150)]);
  const [selId, setSelId] = useState("");
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [caps, setCaps] = useState(saved?.caps ?? true);
  const [fit, setFit] = useState<Fit>(saved?.fit ?? "blur");
  const [adding, setAdding] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [safe, setSafe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [autoRender, setAutoRender] = useState(false);
  const [moving, setMoving] = useState(saved?.moving ?? true);
  const [source, setSource] = useState<Source>(saved?.source ?? "mix");
  const aiSt = useRef<AiState>({ fails: 0 });
  const findPage = useRef<Record<string, number>>({}); // per scene: which page of stock results "Find and add more" is on
  const [msg, setMsg] = useState("");
  const [code, setCode] = useState<string>(() => { try { return localStorage.getItem("vortex-access") || ""; } catch { return ""; } });
  const [server, setServer] = useState(NO_PROVIDERS);
  const [serverMsg, setServerMsg] = useState("");
  // Each value is the access code when that provider has a key on the server, otherwise "".
  const keys = { pixabay: server.pixabay ? code : "", pexels: server.pexels ? code : "", voice: server.voice ? code : "" };
  const [oaVoice, setOaVoice] = useState("alloy");
  const [cfVoice, setCfVoice] = useState("orion");
  const [musicUrl, setMusicUrl] = useState("");
  const [musicVol, setMusicVol] = useState(0.15);
  const [musicStyle, setMusicStyle] = useState<MusicStyle>(saved?.musicStyle ?? "calm");
  const [autoMusic, setAutoMusic] = useState(saved?.autoMusic ?? true); // Generate video adds a music track by itself
  const [leadSec, setLeadSec] = useState(saved?.leadSec ?? 4); // seconds of music alone before the voice and captions start
  const [outro, setOutro] = useState(saved?.outro ?? ""); // typed ending message, shown over the last seconds
  const [leadUsed, setLeadUsed] = useState(0); // lead-in and ending actually built into the current timeline
  const [tailUsed, setTailUsed] = useState(0);
  const [balance, setBalance] = useState(saved?.balance ?? true); // level the voice and keep the music under it
  const [voiceRms, setVoiceRms] = useState<number | null>(null); // measured loudness of the voiceover and the music
  const [musicRms, setMusicRms] = useState<number | null>(null);
  const [makingMusic, setMakingMusic] = useState(false);
  const [voiceUrl, setVoiceUrl] = useState("");
  const [voiceVol, setVoiceVol] = useState(1);
  const [voiceDur, setVoiceDur] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [camOn, setCamOn] = useState(false);
  const [camMode, setCamMode] = useState<"video" | "audio">("video");
  const [recording, setRecording] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [file, setFile] = useState<{ url: string; name: string; mb: number; blob: Blob } | null>(null);
  const [vTitle, setVTitle] = useState(saved?.vTitle ?? "");
  const [vDesc, setVDesc] = useState(saved?.vDesc ?? "");
  const [vTags, setVTags] = useState(saved?.vTags ?? "");
  const [thumbText, setThumbText] = useState(saved?.thumbText ?? "");
  const [thumbMb, setThumbMb] = useState<number | null>(null);
  const [thumbClip, setThumbClip] = useState("");
  const [thumbBump, setThumbBump] = useState(0);

  const frameRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const thumbRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<HTMLVideoElement | null>(null);
  const camStream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const recStart = useRef(0);
  const mediaRef = useRef<Record<string, Media>>({});
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const onEnd = useRef<(() => void) | null>(null);
  const exportStart = useRef<number | null>(null);
  const capture = useRef<{ req: () => void; frames: number } | null>(null); // while rendering: pushes each drawn picture into the recording
  const acRef = useRef<AudioContext | null>(null);
  const tracks = useRef<Record<string, { el: HTMLAudioElement; gain: GainNode }>>({});
  const clipGain = useRef<GainNode | null>(null);
  const clipNodes = useRef<Map<HTMLVideoElement, MediaElementAudioSourceNode>>(new Map());

  const [W, H] = dims(fmt, res); // the size of the finished video
  // While editing, the preview is drawn smaller (a phone cannot redraw 1080p many times a second); the full size is used only while rendering.
  const previewLong = typeof window !== "undefined" && window.innerWidth >= 1024 ? 1280 : 854;
  const ps = exporting ? 1 : Math.min(1, previewLong / Math.max(W, H));
  const cw = Math.max(2, Math.round((W * ps) / 2) * 2), ch = Math.max(2, Math.round((H * ps) / 2) * 2);
  const lv = levels(voiceRms, musicRms);
  const voiceGain = balance ? voiceVol * lv.voice : voiceVol;
  const musicGain = balance ? lv.music : musicVol;
  const sel = scenes.find((s) => s.id === selId) ?? scenes[0];
  const starts = useMemo(() => scenes.reduce<number[]>((a, _s, i) => [...a, i ? a[i - 1] + scenes[i - 1].duration : 0], []), [scenes]);
  const total = scenes.reduce((a, s) => a + s.duration, 0);
  const live = useRef<Live>({ scenes, starts, total, fit, caps, W: cw, H: ch, intro, voiceVol: voiceGain, musicVol: musicGain, duck: balance, lead: leadUsed, tail: tailUsed, outro });
  live.current = { scenes, starts, total, fit, caps, W: cw, H: ch, intro, voiceVol: voiceGain, musicVol: musicGain, duck: balance, lead: leadUsed, tail: tailUsed, outro };

  const totalWords = Math.round(minutes * wpm);
  const nScenes = fmt === "short" ? 4 : Math.max(6, Math.min(16, Math.round(minutes * 2)));
  const perScene = Math.round(totalWords / nScenes);
  const aiPrompt = `Write a YouTube ${fmt === "short" ? "Short" : "video"} script about: "${topic.trim() || "[your topic]"}".
Tone: ${tone}. The narration must run about ${minutes} minute${minutes > 1 ? "s" : ""} when read aloud: at least ${totalWords} spoken words in total, and at least ${Math.round(perScene * 0.85)} words in every scene. Do not summarise or shorten.
${fmt === "short" ? "This is a vertical Short: hook the viewer in the first 3 seconds and keep every scene punchy." : "Hook the viewer in the first 10 seconds, state the promise of the video, give one idea per scene, and end with a short call to action."}
Use exactly ${nScenes} scenes. Write the narration as plain spoken sentences only, with no stage directions and no emojis. The video opens on a wide establishing view and closes on a wide, calm view, so keep the searches of the first and last scenes wide.
Reply in exactly this format and nothing else:

TITLE: (under 70 characters)
INTRO TEXT: (a short line of 3 to 8 words for the opening seconds. It must match the video, but must not be the full title)
DESCRIPTION: (2 to 3 sentences)
TAGS: (8 to 12 tags, separated by commas)
THUMBNAIL: (maximum 4 words)

## Scene 1: Hook
VISUAL: (3 different stock photo searches of 2 to 4 words each, separated by |, in the order the narration mentions them. Mix camera angles: one wide or aerial view, one close-up detail, one medium shot with people or action. Prefer real movement, such as 'person typing laptop' or 'woman walking park', over still objects)
DELIVERY: voiceover
(narration for this scene)

## Scene 2: (scene name)
VISUAL: ...
DELIVERY: voiceover
(narration for this scene)

(continue until Scene ${nScenes}. Use "DELIVERY: on-camera" only for a scene where a real person must speak straight to the viewer. Otherwise always use "DELIVERY: voiceover".)`;

  const ensureAc = () => { if (!acRef.current) acRef.current = new AudioContext(); return acRef.current; };
  // Loudness of an audio file (speech: only the speaking parts count), used to balance the voice and the music.
  const measure = async (url: string, speech: boolean) => {
    try {
      const a = await ensureAc().decodeAudioData(await (await fetch(url)).arrayBuffer());
      const d = a.getChannelData(0);
      return speech ? rmsActive(d) : rmsAll(d);
    } catch { return null; }
  };
  const track = (k: "music" | "voice") => {
    const ac = ensureAc();
    if (!tracks.current[k]) {
      const el = new Audio();
      const gain = ac.createGain();
      ac.createMediaElementSource(el).connect(gain);
      gain.connect(ac.destination);
      tracks.current[k] = { el, gain };
    }
    return tracks.current[k];
  };
  const getClipGain = () => {
    if (!clipGain.current) { const ac = ensureAc(); const g = ac.createGain(); g.connect(ac.destination); clipGain.current = g; }
    return clipGain.current;
  };
  const syncAudio = (play: boolean) =>
    (["music", "voice"] as const).forEach((k) => {
      const T = tracks.current[k];
      if (!T || !T.el.src) return;
      if (!play) { T.el.pause(); return; }
      const d = T.el.duration;
      T.el.currentTime = k === "music" && isFinite(d) && d > 0 ? tRef.current % d : tRef.current;
      T.el.play().catch(() => {});
    });
  const play = () => {
    acRef.current?.resume();
    if (tRef.current >= live.current.total) tRef.current = 0;
    playingRef.current = true; setPlaying(true); syncAudio(true);
  };
  const pause = () => { playingRef.current = false; setPlaying(false); syncAudio(false); };
  const seek = (s: number) => { tRef.current = Math.max(0, Math.min(s, live.current.total)); setT(tRef.current); if (playingRef.current) syncAudio(true); };

  useEffect(() => { try { localStorage.setItem("vortex-access", code); } catch { /* ignore */ } }, [code]);
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const data: Saved = {
          v: 1, fmt, res, fps, wpm, topic, tone, minutes, minSec, scriptText, intro, source, moving, caps, fit, musicStyle, autoMusic, balance, leadSec, outro, vTitle, vDesc, vTags, thumbText,
          scenes: scenes.map((s) => ({ id: s.id, title: s.title, text: s.text, onScreen: s.onScreen, visual: s.visual, duration: s.duration, palette: s.palette })),
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch { /* storage full or blocked: skip */ }
    }, 800);
    return () => clearTimeout(id);
  }, [fmt, res, fps, wpm, topic, tone, minutes, minSec, scriptText, intro, source, moving, caps, fit, musicStyle, autoMusic, balance, leadSec, outro, vTitle, vDesc, vTags, thumbText, scenes]);
  useEffect(() => {
    if (!code) { setServer(NO_PROVIDERS); setServerMsg(""); return undefined; }
    const ctl = new AbortController();
    const id = window.setTimeout(async () => {
      try {
        const r = await fetch("/api/status", { headers: { "x-access-code": code }, signal: ctl.signal });
        const j = (await r.json()) as { error?: string; voice?: boolean; voiceProvider?: string; pexels?: boolean; pixabay?: boolean };
        if (!r.ok) { setServer(NO_PROVIDERS); setServerMsg(j.error || `The server returned ${r.status}.`); return; }
        setServer({ voice: !!j.voice, voiceProvider: j.voiceProvider ?? "", pexels: !!j.pexels, pixabay: !!j.pixabay });
        setServerMsg("Connected.");
      } catch {
        if (!ctl.signal.aborted) { setServer(NO_PROVIDERS); setServerMsg("Could not reach the server. The server functions only run on the hosted site (Netlify or Cloudflare), not in a local preview."); }
      }
    }, 500);
    return () => { ctl.abort(); clearTimeout(id); };
  }, [code]);

  // Keeps the Pexels/Pixabay source line in the description in step with the visuals actually used.
  useEffect(() => { setVDesc((d) => withCredits(d, scenes)); }, [scenes]);

  useEffect(() => {
    const m = mediaRef.current;
    scenes.forEach((s) => s.clips.forEach((c) => {
      if (m[c.url]) return;
      let el: Media;
      if (c.kind === "video") {
        el = Object.assign(document.createElement("video"), { muted: true, loop: true, playsInline: true, preload: "auto", src: c.url });
      } else {
        const im = new Image();
        if (!c.url.startsWith("blob:")) im.crossOrigin = "anonymous";
        im.src = c.url;
        el = im;
      }
      m[c.url] = el;
    }));
  }, [scenes]);

  useEffect(() => {
    let last = performance.now(), lastUi = 0, lastL: Live | null = null, lastT = -1, lastDraw = 0;
    const getMedia = (u: string) => mediaRef.current[u];
    const tick = () => {
      const now = performance.now();
      const L = live.current, dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      if (playingRef.current) {
        if (exportStart.current !== null) {
          tRef.current = (now - exportStart.current) / 1000;
        } else {
          const v = tracks.current.voice?.el;
          if (v && v.src && v.readyState >= 2 && !v.paused && !v.ended && !v.seeking) tRef.current = v.currentTime;
          else tRef.current += dt;
        }
        if (tRef.current >= L.total) { tRef.current = L.total; setT(L.total); pause(); onEnd.current?.(); }
        else if (now - lastUi > 200) { lastUi = now; setT(tRef.current); }
      }
      // Nothing is playing and nothing changed: do not redraw the picture 60 times a second (this is what made taps lag).
      // A slow redraw every 0.4 s still catches pictures that finish loading.
      if (!playingRef.current && exportStart.current === null && L === lastL && tRef.current === lastT && now - lastDraw < 400) return;
      lastL = L; lastT = tRef.current;
      const tt = Math.min(tRef.current, Math.max(0, L.total - 0.001));
      let i = 0;
      L.starts.forEach((s, k) => { if (tt >= s) i = k; });
      const sc = L.scenes[i], local = tt - (L.starts[i] ?? 0);
      const sh = sc ? shotAt(sc, local) : null;
      const clip = sc && sh ? shotsOf(sc)[sh.k] : undefined;
      const media = clip ? mediaRef.current[clip.url] : undefined;
      const xfNext = sc && sh && sh.k < sh.n - 1 && sh.sl > sh.len - Math.min(0.5, sh.len * 0.3) ? shotsOf(sc)[sh.k + 1] : undefined;
      const nextMedia = xfNext ? mediaRef.current[xfNext.url] : undefined;
      Object.values(mediaRef.current).forEach((el) => { if (el instanceof HTMLVideoElement && el !== media && el !== nextMedia && !el.paused) el.pause(); });
      const LEAD = 0.5;
      const run = (v: Media | undefined, want: number, on: boolean) => {
        if (!(v instanceof HTMLVideoElement) || !v.duration) return;
        if (on && !clipNodes.current.has(v)) { clipNodes.current.set(v, ensureAc().createMediaElementSource(v)); clipNodes.current.get(v)!.connect(getClipGain()); }
        v.muted = !on; v.loop = !on;
        const t = on ? Math.max(0, Math.min(want, v.duration - 0.05)) : want % v.duration;
        if (playingRef.current) {
          if (v.paused) v.play().catch(() => {});
          if (Math.abs(v.currentTime - t) > (on ? 0.3 : 0.5)) v.currentTime = t;
        } else {
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - t) > 0.1) v.currentTime = t;
        }
      };
      if (sh) run(media, sc?.onCam ? sh.sl : sh.sl + LEAD, !!sc?.onCam);
      if (sh && nextMedia) run(nextMedia, Math.max(0, LEAD - (sh.len - sh.sl)), false);
      const ac = acRef.current;
      if (ac) {
        const vt = tracks.current.voice, mt = tracks.current.music;
        // Music ducks under speech: down quickly when a sentence starts, back up slowly afterwards.
        const duck = L.duck ? duckFactor(!!(vt && vt.el.src), sc?.marks, local) : 1;
        const vTarget = sc?.onCam ? 0 : L.voiceVol, mTarget = L.musicVol * (sc?.onCam ? 0.25 : 1) * duck
          * (L.lead > 0 && tt < L.lead ? 1.7 : 1) // a little more music while it plays alone at the start
          * (L.tail > 0 && tt > L.total - L.tail ? 1.3 * Math.max(0, Math.min(1, (L.total - tt) / 2.5)) : 1); // swell, then fade out at the end
        if (vt && Math.abs(vt.gain.gain.value - vTarget) > 0.001) vt.gain.gain.setTargetAtTime(vTarget, ac.currentTime, 0.03);
        if (mt && Math.abs(mt.gain.gain.value - mTarget) > 0.001) mt.gain.gain.setTargetAtTime(mTarget, ac.currentTime, mTarget < mt.gain.gain.value ? 0.08 : 0.5);
      }
      const ctx = canvasRef.current?.getContext("2d");
      // While previewing, 30 pictures a second is plenty. Rendering draws every tick.
      if (ctx && !(exportStart.current === null && playingRef.current && now - lastDraw < 30)) { lastDraw = now; drawFrame(ctx, L, i, tt, getMedia); const cap = capture.current; if (cap) { cap.req(); cap.frames++; } }
    };
    let worker: Worker | null = null, timer = 0;
    try {
      worker = new Worker(URL.createObjectURL(new Blob(["let id;onmessage=e=>{clearInterval(id);id=setInterval(()=>postMessage(0),e.data)}"], { type: "text/javascript" })));
      worker.onmessage = tick;
      worker.postMessage(16);
    } catch { timer = window.setInterval(tick, 16); }
    return () => { worker?.terminate(); clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!musicUrl) {
      const old = tracks.current.music; // music was removed: stop it and empty the player
      if (old) { old.el.pause(); old.el.removeAttribute("src"); }
      setMusicRms(null);
      return;
    }
    void measure(musicUrl, false).then(setMusicRms);
    const T = track("music"); T.el.src = musicUrl; T.el.loop = true;
  }, [musicUrl]);
  useEffect(() => {
    if (!voiceUrl) { setVoiceRms(null); return; }
    void measure(voiceUrl, true).then(setVoiceRms);
    const el = track("voice").el;
    el.src = voiceUrl;
    el.onloadedmetadata = () => {
      if (el.duration === Infinity) {
        el.currentTime = 1e101;
        el.ontimeupdate = () => { el.ontimeupdate = null; el.currentTime = 0; setVoiceDur(el.duration); };
      } else setVoiceDur(el.duration);
    };
  }, [voiceUrl]);
  useEffect(() => {
    const load = () => { const v = speechSynthesis.getVoices(); setVoices(v); setVoiceName((n) => n || v[0]?.name || ""); };
    load(); speechSynthesis.onvoiceschanged = load;
    return () => { camStream.current?.getTracks().forEach((x) => x.stop()); speechSynthesis.cancel(); };
  }, []);

  useEffect(() => {
    const c = thumbRef.current, ctx = c?.getContext("2d");
    if (!c || !ctx) return undefined;
    const [a, b] = PALETTES[(scenes[0]?.palette ?? 0) % PALETTES.length];
    const g = ctx.createLinearGradient(0, 0, 1280, 720);
    g.addColorStop(0, a); g.addColorStop(1, b);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 720);
    const hook = scenes[0]?.clips ?? [];
    const url = thumbClip === "frame" ? "" : thumbClip || (hook.length ? hook[Math.min(2, hook.length - 1)].url : "");
    const bg: CanvasImageSource | undefined = thumbClip === "frame" ? frameRef.current ?? undefined : url ? mediaRef.current[url] : undefined;
    let bw = 0, bh = 0, ready = true;
    if (bg instanceof HTMLVideoElement) { bw = bg.videoWidth; bh = bg.videoHeight; ready = bg.readyState >= 2 && !bg.seeking; }
    else if (bg instanceof HTMLImageElement) { bw = bg.naturalWidth; bh = bg.naturalHeight; ready = bg.complete && bw > 0; }
    else if (bg instanceof HTMLCanvasElement) { bw = bg.width; bh = bg.height; }
    else if (url) ready = false;
    if (bg && bw && bh && ready) {
      if (bg instanceof HTMLVideoElement || bg instanceof HTMLImageElement) paintMedia(ctx, 1280, 720, bg, 1, 0, 0);
      else { const k = Math.max(1280 / bw, 720 / bh); ctx.drawImage(bg, (1280 - bw * k) / 2, (720 - bh * k) / 2, bw * k, bh * k); }
    }
    const sh = ctx.createLinearGradient(0, 0, 1280, 0);
    sh.addColorStop(0, "rgba(0,0,0,.7)"); sh.addColorStop(0.65, "rgba(0,0,0,.25)"); sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh; ctx.fillRect(0, 0, 1280, 720);
    const txt = (thumbText || firstWords(vTitle || "Your title", 4)).toUpperCase();
    ctx.font = `900 130px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.lineWidth = 14; ctx.strokeStyle = "#000"; ctx.lineJoin = "round";
    const ls = wrap(ctx, txt, 820).slice(0, 3);
    ls.forEach((l, i) => {
      const y = 360 + (i - (ls.length - 1) / 2) * 150;
      const ws = l.split(" ");
      let x = 80;
      ws.forEach((wd, j) => {
        const piece = wd + (j < ws.length - 1 ? " " : "");
        ctx.fillStyle = i === ls.length - 1 && j === ws.length - 1 ? "#ffd400" : "#fff";
        ctx.strokeText(piece, x, y); ctx.fillText(piece, x, y);
        x += ctx.measureText(piece).width;
      });
    });
    if (!ready && thumbBump < 8) { const id = window.setTimeout(() => setThumbBump((n) => n + 1), 500); return () => clearTimeout(id); }
    void thumbBlob(c).then((bl) => setThumbMb(bl ? bl.size / 1e6 : null));
    return undefined;
  }, [thumbText, vTitle, scenes, tab, thumbClip, thumbBump]);

  const patch = (p: Partial<Scene>) => sel && setScenes((ss) => ss.map((s) => (s.id === sel.id ? { ...s, ...p } : s)));
  const addScene = () => { const s = mkScene({ title: `Scene ${scenes.length + 1}`, text: "", onScreen: "", visual: "" }, scenes.length, wpm); setScenes([...scenes, s]); setSelId(s.id); };
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= scenes.length) return; const c = [...scenes]; [c[i], c[j]] = [c[j], c[i]]; setScenes(c); };
  const repace = () => setScenes(scenes.map((s) => ({ ...s, duration: paceOf(s.text, wpm), marks: undefined })));
  const fitTo = (list: Scene[], dur: number) => {
    const tw = list.reduce((a, s) => a + words(s.text).length, 0) || 1;
    return list.map((s) => ({ ...s, duration: Math.max(1, (dur * words(s.text).length) / tw), marks: undefined }));
  };
  const fitVoice = () => { setScenes(fitTo(scenes, voiceDur)); setMsg("Scene lengths now match your voiceover."); };
  const attach = async (files: File[]) => {
    if (!files.length || !sel) return;
    const id = sel.id;
    setAdding(true);
    const got: (Clip | undefined)[] = [], failed: string[] = [];
    let nextFile = 0, finished = 0;
    // Two files at a time: faster than one by one, and still gentle on phone memory.
    const worker = async () => {
      while (nextFile < files.length) {
        const i = nextFile++;
        try { got[i] = await importFile(files[i]); }
        catch (e) { failed.push(`${files[i].name} (${e instanceof Error ? e.message : "could not be read"})`); }
        finished++;
        setMsg(`Adding files: ${finished} of ${files.length} done…`);
      }
    };
    setMsg(`Adding ${files.length} file${files.length === 1 ? "" : "s"}…`);
    await Promise.all([worker(), worker()]);
    const added = got.filter((c): c is Clip => !!c);
    if (added.length) setScenes((ss) => ss.map((x) => (x.id === id ? { ...x, clips: [...x.clips, ...added] } : x)));
    setAdding(false);
    setMsg(`${added.length ? `${added.length} file${added.length === 1 ? "" : "s"} added to this scene. ` : ""}${failed.length ? `Could not add: ${failed.join("; ")}.` : ""}`.trim());
  };
  const dropClip = (k: number) => { if (sel) patch({ clips: sel.clips.filter((_, i) => i !== k) }); };
  const moveClip = (k: number, d: number) => {
    if (!sel) return;
    const j = k + d;
    if (j < 0 || j >= sel.clips.length) return;
    const c = [...sel.clips];
    [c[k], c[j]] = [c[j], c[k]];
    patch({ clips: c });
  };
  const findPhoto = async () => {
    if (!sel) return;
    const id = sel.id;
    setBusy(true);
    try {
      aiSt.current = { fails: 0 };
      const n = shotsFor(source, sel.duration, moving);
      const page = (findPage.current[id] ?? 1) + 1; // page 1 was used when the video was generated; each press moves on to fresh results
      findPage.current[id] = page;
      setMsg(source !== "stock" ? "Generating more visuals for this scene (can take a minute)…" : "Finding more visuals for this scene…");
      const clips = await gatherClips({ keys, source, topic: topic.trim(), f: fmt, res, moving, st: aiSt.current, page }, sel, n);
      // Added after what the scene already has, so uploads and earlier finds are kept.
      setScenes((ss) => ss.map((s) => (s.id === id ? { ...s, clips: [...s.clips, ...clips] } : s)));
      const vids = clips.filter((c) => c.kind === "video").length;
      setMsg(clips.length ? `Added ${vids} video clip${vids === 1 ? "" : "s"} and ${clips.length - vids} photo${clips.length - vids === 1 ? "" : "s"}. Your other visuals were kept.` : "Nothing new was found. Your existing visuals were kept.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Visual search failed."); }
    setBusy(false);
  };

  const grabFrame = () => {
    const L = { ...live.current, W, H, caps: false, intro: "" }; // thumbnails use the full size, not the small preview
    const c = document.createElement("canvas");
    c.width = L.W; c.height = L.H;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const tt = Math.min(Math.max(tRef.current, 1), Math.max(1, L.total - 1));
    let i = 0;
    L.starts.forEach((st, k) => { if (tt >= st) i = k; });
    drawFrame(ctx, L, i, tt, (u) => mediaRef.current[u]);
    frameRef.current = c; setThumbBump(0); setThumbClip("frame");
    setMsg("Thumbnail picture set from preview frame.");
  };
  const downloadThumb = async () => {
    const c = thumbRef.current;
    const bl = c ? await thumbBlob(c) : null;
    if (!bl) { setMsg("Could not make the thumbnail file. Wait for the preview to load, then try again."); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(bl); a.download = "thumbnail.jpg"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  // Share: the phone's own share sheet (WhatsApp, Telegram, Drive, YouTube...). The video file is sent as it is; nothing is uploaded by this app.
  const shareText = [vTitle.trim(), vDesc.trim()].filter(Boolean).join("\n\n");
  const shareVideo = async () => {
    if (!file) { setMsg("Render the video first, then share it."); return; }
    const f = new File([file.blob], file.name, { type: file.blob.type || "video/webm" });
    try {
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [f] })) {
        // File only. Sending text with the file makes apps such as Messenger send just the text and drop the video.
        await navigator.share({ files: [f] });
        setMsg("Shared. The title and description are not sent with the video. Use “Copy title and description” to paste them.");
      } else setMsg("This browser cannot share files. Download the video, then attach it in the app you want. “Copy title and description” helps with the text.");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // you closed the share sheet
      setMsg("Sharing failed. The file may be too big for that app. Download it and attach it by hand instead.");
    }
  };
  const copyShareText = async () => {
    try { await navigator.clipboard.writeText(shareText); setMsg("Title and description copied."); }
    catch { setMsg("Couldn't copy automatically. Select the text in the boxes above and copy it by hand."); }
  };
  const makeBgMusic = async () => {
    setMakingMusic(true); setMsg("Making background music (a few seconds)…");
    await new Promise((r) => setTimeout(r, 50)); // lets the message show before the work starts
    try {
      const sr = 22050;
      setMusicUrl(URL.createObjectURL(toWav(makeMusic(musicStyle, sr), sr)));
      setMsg("Background music added. It loops under the whole video. Set its volume below.");
    } catch { setMsg("Could not make the music on this device."); }
    setMakingMusic(false);
  };
  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(aiPrompt); setMsg("Prompt copied. Paste it into Claude or ChatGPT, then paste the reply into the “Paste the script here” box."); }
    catch { setMsg("Couldn't copy automatically. Open “Show prompt” and copy it by hand."); }
  };

  const fillMeta = (m: Meta, list: Scene[]) => {
    let at = 0;
    const chapters = list.map((s) => { const l = `${clock(at)} ${s.title}`; at += s.duration; return l; }).join("\n");
    setVTitle(m.title || topic.trim() || list[0]?.title || "");
    setIntro(m.intro || list[0]?.onScreen || firstWords(m.title || topic.trim() || list[0]?.text || "", 7));
    setThumbText(m.thumb || firstWords(m.title || topic.trim() || list[0]?.title || "", 4));
    setVTags((m.tags || []).join(", "));
    setVDesc([m.description, fmt === "long" && list.length >= 3 ? chapters : ""].filter(Boolean).join("\n\n"));
  };
  const loadScript = () => {
    const p = parseScript(scriptText);
    if (!p.scenes.length) { setMsg("Paste a script first. Use the “Get a script” prompt to get one from Claude or ChatGPT."); return null; }
    // Scenes whose narration is unchanged keep the visuals you added yourself (uploads or camera clips).
    const norm = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
    const pool = scenes.filter((s) => s.clips.some(mine));
    const list = p.scenes.map((d, i) => {
      const sc = mkScene(d, i, wpm);
      const o = pool.find((x) => norm(x.text) === norm(d.text));
      if (!o) return sc;
      pool.splice(pool.indexOf(o), 1);
      return { ...sc, clips: o.clips, ...(o.onCam ? { onCam: true, duration: o.duration } : {}) };
    });
    setScenes(list); setSelId(list[0].id);
    return { meta: p.meta, list };
  };
  const loadOnly = () => {
    const r = loadScript();
    if (!r) return;
    fillMeta(r.meta, r.list);
    const kept = r.list.filter((s) => s.clips.length).length;
    setMsg(`Loaded ${r.list.length} scenes${kept ? `, keeping your own visuals in ${kept}` : ""}. Check them in the Scenes tab, then press Generate video.`);
  };

  const narrate = async (list: Scene[]) => {
    const ac = ensureAc(), sr = ac.sampleRate, GAP = Math.round(0.2 * sr);
    const parts: { data?: Float32Array; dur: number; marks?: Mark[] }[] = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s.text.trim() || (s.onCam && s.clips[0]?.kind === "video")) { parts.push({ dur: s.duration }); continue; }
      const sents = sentencesOf(s.text);
      const chunks: Float32Array[] = [], marks: Mark[] = [];
      let len = 0;
      for (let j = 0; j < sents.length; j++) {
        setMsg(`Recording narration ${i + 1} of ${list.length} (sentence ${j + 1} of ${sents.length})…`);
        const pcs: Float32Array[] = [];
        for (const piece of splitText(sents[j])) {
          const b = await speak(keys.voice, piece, server.voiceProvider === "cloudflare" ? cfVoice : oaVoice);
          pcs.push((await ac.decodeAudioData(await b.arrayBuffer())).getChannelData(0).slice());
        }
        const n = pcs.reduce((a, c) => a + c.length, 0), d = new Float32Array(n);
        let o = 0;
        pcs.forEach((c) => { d.set(c, o); o += c.length; });
        marks.push({ at: len / sr, len: n / sr, text: sents[j] });
        chunks.push(d); len += n;
        if (j < sents.length - 1) { chunks.push(new Float32Array(GAP)); len += GAP; }
      }
      const data = new Float32Array(len);
      let o = 0;
      chunks.forEach((c) => { data.set(c, o); o += c.length; });
      parts.push({ data, dur: Math.max(2, len / sr + 0.3), marks });
    }
    // Music-only lead-in: silence before the first sentence; the first scene, its captions and the picture shift by the same amount.
    const lead = parts[0]?.data && leadSec > 0 ? leadSec : 0;
    if (lead) {
      const p0 = parts[0], pad = new Float32Array(Math.round(lead * sr) + p0.data!.length);
      pad.set(p0.data!, Math.round(lead * sr));
      parts[0] = { data: pad, dur: p0.dur + lead, marks: p0.marks?.map((m) => ({ ...m, at: m.at + lead })) };
    }
    setLeadUsed(lead);
    if (parts.length) parts[parts.length - 1].dur += 0.8;
    const out = new Float32Array(parts.reduce((a, p) => a + Math.round(p.dur * sr), 0));
    let at = 0;
    parts.forEach((p) => { if (p.data) out.set(p.data.subarray(0, Math.min(p.data.length, out.length - at)), at); at += Math.round(p.dur * sr); });
    setVoiceUrl(URL.createObjectURL(toWav(out, sr)));
    return list.map((s, i) => ({ ...s, duration: parts[i].dur, marks: parts[i].marks }));
  };

  const generateVideo = async () => {
    setBusy(true); setFile(null); setMsg(""); setStage(1); setThumbClip(""); setThumbBump(0);
    try {
      const r = loadScript();
      if (!r) { setStage(0); return; }
      const wc = r.list.reduce((a, s) => a + words(s.text).length, 0);
      if (minSec && (wc / wpm) * 60 < minSec * 0.85) {
        setMsg(`This script is only about ${clock((wc / wpm) * 60)}. The minimum is ${clock(minSec)}.`);
        setStage(0); return;
      }
      let next = r.list, note = "";
      setStage(2);
      // Music and voiceover are both made here, in one go.
      if (autoMusic && !musicUrl) {
        setMsg("Making background music…");
        await new Promise((res) => setTimeout(res, 50));
        try { const sr = 22050; setMusicUrl(URL.createObjectURL(toWav(makeMusic(musicStyle, sr), sr))); note += " Background music added."; }
        catch { note += " Could not make background music on this device."; }
      }
      if (!keys.voice && !voiceUrl) note += " No voiceover was added because the server voice is not connected (enter the access code under Server access).";
      setLeadUsed(0);
      if (keys.voice) next = await narrate(next);
      else if (voiceDur) next = fitTo(next, voiceDur);
      const len = next.reduce((a, s) => a + s.duration, 0);
      if (minSec && len < minSec) {
        setScenes(next); fillMeta(r.meta, next);
        setMsg(`Finished video is ${clock(len)}, shorter than the ${clock(minSec)} minimum.`);
        setStage(0); return;
      }
      const tail = outro.trim() ? 5 : 3; // ending: typed message (or just a calm music fade-out) after the last word
      next = next.map((x, k) => (k === next.length - 1 ? { ...x, duration: x.duration + tail } : x));
      setTailUsed(tail);
      setStage(3);
      const withPics: Scene[] = [];
      aiSt.current = { fails: 0 };
      let failure = "";
      for (let i = 0; i < next.length; i++) {
        const s = next[i];
        if (s.clips.some(mine)) { withPics.push(s); continue; } // your own visuals stay; only scenes without them get generated ones
        setMsg(source !== "stock" ? `Generating photoreal visuals for scene ${i + 1} of ${next.length} (can take a minute each)…` : `Finding multiple unique visuals for scene ${i + 1} of ${next.length}…`);
        const n = shotsFor(source, s.duration, moving);
        try {
          const clips = await gatherClips({ keys, source, topic: topic.trim(), f: fmt, res, moving, st: aiSt.current }, s, n);
          withPics.push({ ...s, clips });
        } catch (e) { failure = e instanceof Error ? e.message : ""; withPics.push(s); }
      }
      const keptOwn = withPics.filter((x) => x.clips.some(mine)).length;
      if (keptOwn) note += ` Kept your own visuals in ${keptOwn} scene(s).`;
      if (failure) note += ` Some visuals failed: ${failure}`;
      const filled = borrowVisuals(withPics);
      const reused = withPics.filter((x) => !x.clips.length).length;
      const bare = filled.filter((x) => !x.clips.length).length;
      if (reused && !bare) note += ` ${reused} scene(s) found no matching footage and reuse visuals from a neighbouring scene.`;
      if (bare) note += ` ${bare} scene(s) have no visuals at all. Enter the access code in the Create tab for stock footage, or upload your own clips.`;
      next = filled;
      setScenes(next);
      fillMeta(r.meta, next);
      setStage(4); setMsg(`Rendering video in real time (${clock(len)}). Keep this tab open and in front.${note}`);
      setAutoRender(true);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Generation failed."); setStage(0); }
    finally { setBusy(false); }
  };

  const previewVoice = () => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(scenes.map((s) => s.text).join(" "));
    u.rate = wpm / 150; u.voice = voices.find((v) => v.name === voiceName) ?? null;
    speechSynthesis.speak(u);
  };
  const aiVoiceOnly = async () => {
    if (!keys.voice) { setMsg("AI voiceover needs the access code in the Create tab, and a voice service set on the server (the free Cloudflare one or OpenAI)."); return; }
    setBusy(true);
    try { setScenes(await narrate(scenes)); setMsg("Voiceover ready."); } catch (e) { setMsg(e instanceof Error ? e.message : "Voiceover failed."); }
    setBusy(false);
  };

  const startCam = async (mode: "video" | "audio") => {
    try {
      camStream.current?.getTracks().forEach((x) => x.stop());
      const s = await navigator.mediaDevices.getUserMedia({ video: mode === "video" ? { width: 1920, height: 1080 } : false, audio: { echoCancellation: true, noiseSuppression: true } });
      camStream.current = s; setCamMode(mode); setCamOn(true);
      if (camRef.current) { camRef.current.srcObject = s; camRef.current.play().catch(() => {}); }
    } catch { setMsg("Could not access camera or microphone. Allow permission in your browser."); }
  };
  const stopCam = () => { camStream.current?.getTracks().forEach((x) => x.stop()); camStream.current = null; setCamOn(false); setRecording(false); };
  const toggleRec = () => {
    if (recording) { rec.current?.stop(); return; }
    if (!camStream.current) return;
    const chunks: Blob[] = [], r = new MediaRecorder(camStream.current);
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: r.mimeType }));
      const secs = (performance.now() - recStart.current) / 1000;
      if (camMode === "video") patch({ clips: [{ url, kind: "video" }], onCam: true, duration: Math.max(1, secs), marks: undefined });
      else setVoiceUrl(url);
      setRecording(false);
      setMsg(camMode === "video" ? "Clip added with on-camera voice." : "Voiceover recorded.");
    };
    r.start(); recStart.current = performance.now(); rec.current = r; setRecording(true);
  };

  const rewind = (el: HTMLAudioElement) => new Promise<void>((ok) => {
    el.pause();
    if (!el.src || el.currentTime === 0) return ok();
    let fin = false;
    const done = () => { if (fin) return; fin = true; el.removeEventListener("seeked", done); ok(); };
    el.addEventListener("seeked", done);
    el.currentTime = 0;
    setTimeout(done, 1500);
  });

  const exportVideo = async (attempt = 0): Promise<void> => {
    const c = canvasRef.current;
    if (!c || !live.current.total) return;
    if (typeof MediaRecorder === "undefined") { setMsg("This browser can't record video. Use desktop Chrome or Edge."); return; }
    // First attempt: preferred codecs, with audio only if the video actually has an audio source.
    // Retry: browser-default codec and no audio track, which works on most phones.
    const hasAudio = attempt === 0 && (Object.keys(tracks.current).length > 0 || live.current.scenes.some((s) => s.onCam));
    const mime = attempt === 0
      ? MIME_CANDIDATES.map((m) => (hasAudio ? m : m.replace(/,(?:opus|aac|mp4a[^,]*)$/, ""))).find((m) => MediaRecorder.isTypeSupported(m))
      : undefined;
    if (attempt === 0 && !mime) { setMsg("This browser can't record video. Use desktop Chrome or Edge."); return; }
    pause(); setFile(null); setExporting(true); setStage(4);
    Object.values(mediaRef.current).forEach((el) => {
      if (el instanceof HTMLVideoElement && el.readyState < 2) { el.preload = "auto"; el.load(); el.play().then(() => el.pause()).catch(() => {}); }
    });
    const t0 = performance.now();
    while (performance.now() - t0 < 40000) {
      const ok = live.current.scenes.every((s) => s.clips.every((cl) => mediaSettled(mediaRef.current[cl.url])));
      if (ok) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    exportStart.current = null;
    seek(0);
    await Promise.all(Object.values(tracks.current).map((T) => rewind(T.el)));
    const ac = ensureAc();
    await ac.resume();
    if (hasAudio && live.current.scenes.some((s) => s.onCam)) getClipGain();
    const dest = hasAudio ? ac.createMediaStreamDestination() : null;
    const outs = hasAudio ? [...Object.values(tracks.current).map((T) => T.gain), ...(clipGain.current ? [clipGain.current] : [])] : [];
    if (dest) outs.forEach((g) => g.connect(dest));
    for (let k = 0; k < 40 && c.width !== W; k++) await new Promise((r) => setTimeout(r, 50)); // wait until the canvas is full size (the preview is smaller)
    // Ask for a recorded picture exactly when one has been drawn (more reliable on phones than a timer: no frozen or repeated pictures).
    const stream = c.captureStream(0);
    const vtrack = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
    if (!vtrack?.requestFrame) { stream.getTracks().forEach((t) => stream.removeTrack(t)); stream.addTrack(c.captureStream(fps).getVideoTracks()[0]); }
    capture.current = vtrack?.requestFrame ? { req: () => vtrack.requestFrame!(), frames: 0 } : null;
    if (dest) dest.stream.getAudioTracks().forEach((a) => stream.addTrack(a));
    const opts: MediaRecorderOptions = { videoBitsPerSecond: res >= 1440 ? 12e6 : res >= 1080 ? 6e6 : 3e6 };
    if (mime) opts.mimeType = mime;
    const r = new MediaRecorder(stream, opts);
    const chunks: Blob[] = [];
    let recErr = "";
    r.onerror = (e) => { recErr = (e as Event & { error?: DOMException }).error?.name || "unknown error"; };
    let hidden = document.hidden;
    const onVis = () => { if (document.hidden) hidden = true; };
    document.addEventListener("visibilitychange", onVis);
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const safety = window.setTimeout(() => { if (r.state !== "inactive") r.stop(); }, (live.current.total + 20) * 1000);
    const began = performance.now();
    r.onstop = () => {
      clearTimeout(safety);
      document.removeEventListener("visibilitychange", onVis);
      exportStart.current = null;
      const drawn = capture.current?.frames ?? 0; capture.current = null;
      if (dest) outs.forEach((g) => { try { g.disconnect(dest); } catch { /* ignore */ } });
      const type = (mime ?? (r.mimeType || "video/webm")).split(";")[0];
      const blob = new Blob(chunks, { type });
      if (blob.size < 50_000) {
        if (attempt === 0) {
          setExporting(false);
          setMsg("First recording was empty. Retrying in a simpler mode (no audio in the file). Keep this tab in front.");
          void exportVideo(1);
          return;
        }
        setFile(null); setExporting(false); setStage(0);
        setMsg(`Recording failed (empty file${recErr ? `, ${recErr}` : ""}). Try desktop Chrome or Edge.`);
        return;
      }
      const took = (performance.now() - began) / 1000;
      setFile({ url: URL.createObjectURL(blob), name: `vortex-${fmt}-${res}p.${type === "video/mp4" ? "mp4" : "webm"}`, mb: blob.size / 1e6, blob });
      setExporting(false); setStage(5);
      const gotFps = drawn / Math.max(1, took);
      const slow = drawn > 0 && gotFps < fps * 0.6 ? ` Your phone only managed about ${Math.round(gotFps)} pictures a second at ${res}p, so motion may look choppy. Try 720p, or 30 fps, for smoother results.` : "";
      setMsg(`Recorded ${clock(took)} of ${clock(live.current.total)} planned.${slow}${hidden ? " The tab was hidden while rendering, so the video may be incomplete." : ""}${attempt > 0 ? " Saved without audio." : ""}`);
    };
    onEnd.current = () => { onEnd.current = null; setTimeout(() => { if (r.state !== "inactive") r.stop(); }, 400); };
    const vEl = tracks.current.voice?.el;
    const started = new Promise<void>((res) => {
      if (!vEl || !vEl.src) return res();
      const f = () => { vEl.removeEventListener("playing", f); res(); };
      vEl.addEventListener("playing", f);
      setTimeout(res, 1500);
    });
    r.start(250); play();
    await started;
    exportStart.current = performance.now() - (vEl && vEl.src ? vEl.currentTime * 1000 : 0);
  };
  useEffect(() => {
    if (!autoRender) return;
    setAutoRender(false);
    setTimeout(() => { void exportVideo(); }, 800);
  }, [autoRender]);

  const checks = [
    { ok: fmt === "short" ? total > 0 && total <= 180 : total > 0, t: fmt === "short" ? "Shorts run 3:00 or less" : "Video has content" },
    { ok: !minSec || total >= minSec, t: minSec ? `Length is at least ${clock(minSec)}` : "No minimum length set" },
    { ok: res >= 1080, t: "Resolution is 1080p or higher" },
    { ok: vTitle.length > 0 && vTitle.length <= 100, t: "Title is 1 to 100 characters" },
    { ok: vDesc.length <= 5000, t: "Description is under 5,000 characters" },
    { ok: vTags.length <= 500, t: "Tags are under 500 characters" },
    { ok: fmt === "short" || (scenes.length >= 3 && scenes.every((s) => s.duration >= 10)), t: "Chapters: 3 or more, each 10 seconds or longer" },
    { ok: !!voiceUrl || !!musicUrl, t: "Audio track attached" },
    { ok: caps, t: "Captions burned into the video" },
    { ok: thumbMb !== null && thumbMb < 2, t: "Thumbnail 1280×720, under 2 MB" },
  ];
  const tabs: [Tab, string][] = [["create", "Create"], ["scenes", "Scenes"], ["audio", "Audio"], ["camera", "Camera"], ["publish", "Publish"]];
  const switchFmt = (f: Fmt) => { setFmt(f); setMinutes(f === "short" ? 1 : 3); setMinSec(f === "short" ? 0 : 120); };

  return (
    <div className="vtx-app flex min-h-0 flex-1 flex-col overflow-hidden" style={{ fontFamily: FONT }}>
      <header className="flex flex-wrap items-center gap-2 sm:gap-3 border-b border-slate-800 bg-slate-950 px-3 sm:px-4 py-2.5">
        <div className="text-base sm:text-lg font-extrabold tracking-tight">Vortex <span className="text-violet-400">AI Studio</span></div>
        <div className="ml-2 flex rounded-md bg-slate-900 p-0.5 text-xs sm:text-sm">
          {(["long", "short"] as Fmt[]).map((f) => (
            <button key={f} onClick={() => switchFmt(f)} className={`rounded px-2.5 sm:px-3 py-1 ${fmt === f ? "bg-violet-600" : "text-slate-400"}`}>
              {f === "long" ? "Video 16:9" : "Short 9:16"}
            </button>
          ))}
        </div>
        <select className={`${inp} !w-auto text-xs sm:text-sm`} value={res} onChange={(e) => setRes(+e.target.value)}>
          <option value={720}>720p</option><option value={1080}>1080p</option><option value={1440}>1440p</option>
        </select>
        <select className={`${inp} !w-auto text-xs sm:text-sm hidden sm:block`} value={fps} onChange={(e) => setFps(+e.target.value)}>
          <option value={30}>30 fps</option><option value={60}>60 fps</option>
        </select>
        <span className="text-xs sm:text-sm text-slate-400 hidden md:inline">{W}×{H} · {clock(total)}</span>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {msg && <span className="basis-full text-xs text-amber-300 sm:basis-auto sm:max-w-xs sm:truncate sm:text-slate-400" title={msg}>{msg}</span>}
          {file && <button onClick={() => void shareVideo()} className={`${btn()} text-xs sm:text-sm`}>Share</button>}
          {file && <a href={file.url} download={file.name} className={`${btn(true)} text-xs sm:text-sm`}>Download {file.name.split(".").pop()?.toUpperCase()} {file.mb.toFixed(1)} MB</a>}
          <button onClick={() => void exportVideo()} disabled={exporting || busy} className={`${btn()} text-xs sm:text-sm`}>{exporting ? `Rendering ${Math.round((t / (total || 1)) * 100)}%` : "Re-render"}</button>
        </div>
      </header>

      <div className="vtx-body flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="vtx-side flex w-full lg:w-[400px] shrink-0 flex-col border-r border-b lg:border-b-0 border-slate-800 bg-slate-950 max-h-[45dvh] lg:max-h-none overflow-y-auto">
          <nav className="flex border-b border-slate-800 overflow-x-auto">
            {tabs.map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 min-w-[70px] py-2.5 text-xs sm:text-sm whitespace-nowrap ${tab === k ? "border-b-2 border-violet-500 text-white" : "text-slate-400 hover:text-slate-200"}`}>{l}</button>
            ))}
          </nav>
          <div className="vtx-side-inner min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
            {tab === "create" && (<>
              <Field l="Video topic or title"><input className={inp} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. 5 habits for productivity" /></Field>

              <div className="space-y-3 rounded-md border border-slate-800 p-3">
                <p className="text-sm font-medium">Get a script from Claude, ChatGPT or any AI</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field l="Tone"><select className={inp} value={tone} onChange={(e) => setTone(e.target.value)}>{["Friendly", "Professional", "Energetic", "Calm", "Funny"].map((x) => <option key={x}>{x}</option>)}</select></Field>
                  <Field l="Length (minutes)"><input type="number" min={fmt === "short" ? 1 : 2} max={fmt === "short" ? 3 : 15} className={inp} value={minutes} onChange={(e) => setMinutes(Math.max(fmt === "short" ? 1 : 2, +e.target.value))} /></Field>
                </div>
                <Field l="Minimum video length (seconds)"><input type="number" min={0} step={10} className={inp} value={minSec} onChange={(e) => setMinSec(Math.max(0, +e.target.value))} /></Field>
                <Field l={`Speaking pace: ${wpm} wpm`}><input type="range" min={110} max={190} value={wpm} onChange={(e) => setWpm(+e.target.value)} className="w-full accent-violet-500" /></Field>
                <button className={`${btn()} w-full`} onClick={copyPrompt}>Copy prompt for AI</button>
                <details className="text-xs text-slate-400">
                  <summary className="cursor-pointer">Show prompt</summary>
                  <textarea readOnly className={`${inp} mt-2 h-40 text-xs`} value={aiPrompt} />
                </details>
              </div>

              <Field l="Paste the script here">
                <textarea className={inp} rows={8} value={scriptText} onChange={(e) => setScriptText(e.target.value)} placeholder={"Paste AI script reply here..."} />
              </Field>
              <Field l="Visual source">
                <select className={inp} value={source} onChange={(e) => setSource(e.target.value as Source)}>
                  <option value="mix">Both: AI images + stock video (free, recommended)</option>
                  <option value="ai">AI photoreal images only (free, no key)</option>
                  <option value="stock">Stock footage (Pexels and Pixabay; AI pictures fill any gaps)</option>
                </select>
              </Field>
              {source !== "stock" && <p className="text-xs text-slate-500">{source === "mix" ? "Each scene gets AI photos plus real video clips (the video clips come from Pexels and Pixabay, which needs their keys on the server and your access code; without them every picture is AI)." : "Each scene gets AI photos that match your VISUAL lines. "}Allow about 1 to 2 minutes per scene before rendering starts.</p>}
              <label className="flex items-start gap-2 rounded-md border border-slate-800 p-2 text-xs text-slate-400">
                <input type="checkbox" className="mt-0.5" checked={moving} onChange={(e) => setMoving(e.target.checked)} />
                <span><b className="text-slate-200">Use moving video footage.</b> Finds multiple video clips per scene. Rich visual assets automatically fill in to pack every scene with high visual variety.</span>
              </label>
              <label className="flex items-start gap-2 rounded-md border border-slate-800 p-2 text-xs text-slate-400">
                <input type="checkbox" className="mt-0.5" checked={autoMusic} onChange={(e) => setAutoMusic(e.target.checked)} />
                <span><b className="text-slate-200">Add background music automatically.</b> Generate video makes a music track in the style below and keeps it quietly under the voiceover, so the voice stays clear.</span>
              </label>
              <Field l="Music-only start (seconds before the voice and captions begin)"><select className={inp} value={leadSec} onChange={(e) => setLeadSec(+e.target.value)}>{[0, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n === 0 ? "None, voice starts at once" : `${n} seconds`}</option>)}</select></Field>
              <Field l="Music style"><select className={inp} value={musicStyle} onChange={(e) => setMusicStyle(e.target.value as MusicStyle)}>{MUSIC_STYLES.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.note})</option>)}</select></Field>
              <Field l="Pictures that do not match the video shape">
                <select className={inp} value={fit} onChange={(e) => setFit(e.target.value as Fit)}>
                  <option value="blur">Whole picture over a blurred background</option>
                  <option value="fill">Fill the frame (crops the edges)</option>
                  <option value="plain">Whole picture on a plain dark background</option>
                </select>
              </Field>
              <p className="text-xs text-slate-500">This affects things like upright phone photos in a wide video. Pictures close to the video's shape always fill the frame. For upright photos, the vertical (Shorts) format fills the screen with no bars.</p>
              <button className={`${btn(true)} w-full !py-2.5`} disabled={busy || exporting} onClick={generateVideo}>{busy || exporting ? "Working…" : "Generate video"}</button>
              <button className={`${btn()} w-full`} disabled={busy || exporting} onClick={loadOnly}>Load script into scenes only</button>
              <button className={`${btn()} w-full`} disabled={busy || exporting} onClick={() => { if (window.confirm("Clear the saved project and start fresh?")) { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } window.location.reload(); } }}>Start a new project</button>
              <p className="text-xs text-slate-500">Your script, scenes and settings are saved in this browser. Pictures, clips and audio are not saved, so they are fetched again after a refresh.</p>
              {stage > 0 && (
                <ul className="space-y-1 text-sm">
                  {STEPS.map((s, i) => {
                    const n = i + 1, done = stage > n, act = stage === n;
                    return <li key={s} className={done ? "text-emerald-400" : act ? "text-white" : "text-slate-600"}>{done ? "✓" : act ? "…" : "○"} {s}</li>;
                  })}
                </ul>
              )}
              <details className="rounded-md border border-slate-800 p-3 text-sm">
                <summary className="cursor-pointer text-slate-300">Server access (optional)</summary>
                <div className="mt-3 space-y-3">
                  <Field l="Access code"><input type={showCode ? "text" : "password"} autoComplete="off" autoCapitalize="none" spellCheck={false} className={inp} value={code} onChange={(e) => setCode(e.target.value.trim())} /></Field>
                  <label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} />Show the code (to check for typos)</label>
                  {serverMsg && <p className="text-xs text-slate-300">{serverMsg}{serverMsg === "Connected." && ` AI voiceover: ${server.voice ? `on (${server.voiceProvider === "cloudflare" ? "Cloudflare, free allowance" : "OpenAI"})` : "off"}. Pexels: ${server.pexels ? "on" : "off"}. Pixabay: ${server.pixabay ? "on" : "off"}.`}</p>}
                  <p className="text-xs text-slate-500">Provider keys live on the server and never reach this browser. Enter the access code you set there to unlock AI voiceover and Pexels or Pixabay stock footage. Without it, the app still uses free AI images and your own uploads. When Pexels or Pixabay visuals are used, a credit line is added to the description automatically. You can also upload your own clips per scene in the Scenes tab.</p>
                </div>
              </details>
            </>)}

            {tab === "scenes" && (<>
              <Field l="Intro text (first seconds)"><input className={inp} value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="Opening intro text" /></Field>
              <Field l="Ending message (last seconds)"><input className={inp} value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="e.g. Subscribe for more true stories" /></Field>
              <div className="space-y-1.5">
                {scenes.map((s, i) => (
                  <div key={s.id} onClick={() => { setSelId(s.id); seek(starts[i]); }} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm ${s.id === sel?.id ? "border-violet-500 bg-slate-900" : "border-slate-800 hover:bg-slate-900"}`}>
                    <span className="h-3 w-3 rounded-full" style={{ background: PALETTES[s.palette][1] }} />
                    <span className="flex-1 truncate">{s.title}{s.onCam ? " 🎥" : ""}</span>
                    <span className="text-xs text-slate-500">{s.duration.toFixed(1)}s</span>
                    <button className="px-1 text-slate-500 hover:text-white" onClick={(e) => { e.stopPropagation(); move(i, -1); }}>↑</button>
                    <button className="px-1 text-slate-500 hover:text-white" onClick={(e) => { e.stopPropagation(); move(i, 1); }}>↓</button>
                    <button className="px-1 text-slate-500 hover:text-red-400" onClick={(e) => { e.stopPropagation(); if (scenes.length > 1) setScenes(scenes.filter((x) => x.id !== s.id)); }}>✕</button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2"><button className={btn()} onClick={addScene}>Add scene</button><button className={btn()} onClick={repace}>Re-pace</button></div>
              {sel && (<div className="space-y-3 border-t border-slate-800 pt-4">
                <Field l="Scene name"><input className={inp} value={sel.title} onChange={(e) => patch({ title: e.target.value })} /></Field>
                <Field l="Narration"><textarea className={inp} rows={4} value={sel.text} onChange={(e) => patch({ text: e.target.value, duration: paceOf(e.target.value, wpm), marks: undefined })} /></Field>
                <Field l="Duration (seconds)"><input type="number" min={1} step={0.5} className={inp} value={Number(sel.duration.toFixed(1))} onChange={(e) => patch({ duration: Math.max(1, +e.target.value), marks: undefined })} /></Field>
                <div className="flex gap-2">{PALETTES.map((p, i) => <button key={i} onClick={() => patch({ palette: i })} className={`h-7 w-7 rounded-full border-2 ${sel.palette === i ? "border-white" : "border-transparent"}`} style={{ background: `linear-gradient(135deg,${p[0]},${p[1]})` }} />)}</div>
                <Field l="Visual search keywords"><input className={inp} value={sel.visual} onChange={(e) => patch({ visual: e.target.value })} /></Field>
                <button className={btn()} disabled={busy} onClick={findPhoto}>Find and add more visuals</button>
                <p className="text-xs text-slate-500">New visuals are added to the end of the list. Nothing you uploaded is replaced.</p>
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-400">{sel.clips.length ? `${sel.clips.length} visual${sel.clips.length === 1 ? "" : "s"} in this scene, shown in this order:` : "No visuals in this scene yet."}{sel.onCam ? " (Camera scene: only the first one is used.)" : ""}</p>
                  {sel.clips.map((c, k) => (
                    <div key={`${c.url}-${k}`} className="flex items-center gap-2 rounded-md border border-slate-800 p-1.5">
                      <span className="w-5 text-center text-xs text-slate-500">{k + 1}</span>
                      {c.kind === "video"
                        ? <video src={c.url} muted playsInline preload="metadata" className="h-12 w-20 shrink-0 rounded bg-black object-cover" />
                        : <img src={c.url} alt="" className="h-12 w-20 shrink-0 rounded bg-black object-cover" />}
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{originOf(c)}</span>
                      <button aria-label="Move earlier" disabled={k === 0} className="px-2 py-1.5 text-slate-400 hover:text-white disabled:opacity-30" onClick={() => moveClip(k, -1)}>↑</button>
                      <button aria-label="Move later" disabled={k === sel.clips.length - 1} className="px-2 py-1.5 text-slate-400 hover:text-white disabled:opacity-30" onClick={() => moveClip(k, 1)}>↓</button>
                      <button aria-label="Remove this visual" className="px-2 py-1.5 text-slate-400 hover:text-red-400" onClick={() => dropClip(k)}>✕</button>
                    </div>
                  ))}
                </div>
                <Field l="Add your own images and videos (select several; they are added to the list)"><input type="file" multiple accept="image/*,video/*" disabled={adding} className="text-xs" onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ""; void attach(picked); }} /></Field>
              </div>)}
            </>)}

            {tab === "audio" && (<>
              <h3 className="text-sm font-semibold">Voiceover</h3>
              {server.voiceProvider === "openai" && <Field l="AI voice"><select className={inp} value={oaVoice} onChange={(e) => setOaVoice(e.target.value)}>{["alloy", "nova", "onyx", "echo", "shimmer", "fable"].map((v) => <option key={v}>{v}</option>)}</select></Field>}
              {server.voiceProvider === "cloudflare" && <Field l="AI voice"><select className={inp} value={cfVoice} onChange={(e) => setCfVoice(e.target.value)}>
                <optgroup label="Male">{["orion", "arcas", "perseus", "angus", "orpheus", "helios", "zeus"].map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}</optgroup>
                <optgroup label="Female">{["asteria", "luna", "athena", "hera", "stella"].map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}<option value="melo">Standard (uses far less of the free allowance)</option></optgroup>
              </select></Field>}
              <p className="text-xs text-slate-500">{server.voice ? (server.voiceProvider === "cloudflare" ? "Voices run on Cloudflare's free daily allowance. The named voices sound better but use it up faster (roughly 8 minutes of speech a day); “Standard” lasts much longer. Male and female labels are from Deepgram's published voice list, so listen before a long video." : "Voice from OpenAI. Pick one above.") : "AI voiceover is off. Enter the access code in the Create tab, and set up a voice service on the server (see the README)."}</p>
              <button className={btn(true)} disabled={busy} onClick={aiVoiceOnly}>Record AI voiceover</button>
              <Field l="Browser voice (preview)"><select className={inp} value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>{voices.map((v) => <option key={v.name}>{v.name}</option>)}</select></Field>
              <div className="flex gap-2"><button className={btn()} onClick={previewVoice}>Preview</button><button className={btn()} onClick={() => speechSynthesis.cancel()}>Stop</button></div>
              <Field l="Upload custom voiceover"><input type="file" accept="audio/*" className="text-xs" onChange={(e) => e.target.files?.[0] && setVoiceUrl(URL.createObjectURL(e.target.files[0]))} /></Field>
              {voiceUrl && (<>
                <Field l={`Voice volume: ${Math.round(voiceVol * 100)}%`}><input type="range" min={0} max={1.5} step={0.05} value={voiceVol} onChange={(e) => setVoiceVol(+e.target.value)} className="w-full accent-violet-500" /></Field>
                <button className={btn()} disabled={!voiceDur} onClick={fitVoice}>Fit scenes to voiceover</button>
              </>)}
              <h3 className="border-t border-slate-800 pt-4 text-sm font-semibold">Background music</h3>
              <Field l="Built-in music style"><select className={inp} value={musicStyle} onChange={(e) => setMusicStyle(e.target.value as MusicStyle)}>{MUSIC_STYLES.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.note})</option>)}</select></Field>
              <button className={btn(true)} disabled={makingMusic} onClick={() => void makeBgMusic()}>{makingMusic ? "Making music…" : "Make background music"}</button>
              <p className="text-xs text-slate-500">Made on your device, so there is nothing to download and no licence to worry about. It is a short loop of simple synthesised instruments, so expect a plain backing track, not a studio recording. You can make another style to replace it.</p>
              <Field l="Or upload your own music"><input type="file" accept="audio/*" className="text-xs" onChange={(e) => e.target.files?.[0] && setMusicUrl(URL.createObjectURL(e.target.files[0]))} /></Field>
              <label className="flex items-start gap-2 rounded-md border border-slate-800 p-2 text-xs text-slate-400">
                <input type="checkbox" className="mt-0.5" checked={balance} onChange={(e) => setBalance(e.target.checked)} />
                <span><b className="text-slate-200">Balance voice and music automatically (recommended).</b> Evens out the voice, keeps the music well below it, and lowers it further while someone is speaking.</span>
              </label>
              {musicUrl && (<>
                {!balance && <Field l={`Music volume: ${Math.round(musicVol * 100)}%`}><input type="range" min={0} max={1} step={0.05} value={musicVol} onChange={(e) => setMusicVol(+e.target.value)} className="w-full accent-violet-500" /></Field>}
                <button className={btn()} onClick={() => setMusicUrl("")}>Remove background music</button>
              </>)}
            </>)}

            {tab === "camera" && (<>
              <video ref={camRef} muted playsInline className={`w-full rounded-md bg-black ${camOn && camMode === "video" ? "" : "hidden"}`} />
              <div className="flex flex-wrap gap-2">
                <button className={btn()} onClick={() => startCam("video")}>Camera + mic</button>
                <button className={btn()} onClick={() => startCam("audio")}>Mic only</button>
                {camOn && <button className={btn()} onClick={stopCam}>Turn off</button>}
              </div>
              <button disabled={!camOn} onClick={toggleRec} className={`w-full rounded-md py-2 text-sm font-semibold disabled:opacity-40 ${recording ? "bg-red-600" : "bg-slate-800 hover:bg-slate-700"}`}>
                {recording ? "Stop recording" : "Record clip"}
              </button>
            </>)}

            {tab === "publish" && (<>
              <Field l={`Title (${vTitle.length}/100)`}><input className={inp} value={vTitle} onChange={(e) => setVTitle(e.target.value)} /></Field>
              <Field l={`Description (${vDesc.length}/5000)`}><textarea className={inp} rows={5} value={vDesc} onChange={(e) => setVDesc(e.target.value)} /></Field>
              <Field l="Thumbnail text"><input className={inp} value={thumbText} onChange={(e) => setThumbText(e.target.value)} placeholder="3–5 words" /></Field>
              <canvas ref={thumbRef} width={1280} height={720} className="w-full rounded-md" />
              <button className={btn()} onClick={grabFrame}>Use current preview frame</button>
              <button className={btn()} onClick={() => void downloadThumb()}>Download thumbnail</button>
              <div className="space-y-2 border-t border-slate-800 pt-4">
                <h3 className="text-sm font-semibold">Share</h3>
                <button className={`${btn(true)} w-full`} disabled={!file} onClick={() => void shareVideo()}>{file ? `Share video (${file.name.split(".").pop()?.toUpperCase()}, ${file.mb.toFixed(1)} MB)` : "Share video (render it first)"}</button>
                <button className={`${btn()} w-full`} disabled={!shareText} onClick={() => void copyShareText()}>Copy title and description</button>
                <p className="text-xs text-slate-500">Opens your phone's share menu so you can send the video to WhatsApp, Telegram, Google Drive and more. Only the video file is sent, not the title or description (use the copy button for those). It goes straight from this device to the app you pick; this app does not upload or host it. Desktop browsers often cannot share files, so use Download there.</p>
              </div>
              <ul className="space-y-1 text-xs">
                {checks.map((c) => <li key={c.t} className={c.ok ? "text-emerald-400" : "text-slate-500"}>{c.ok ? "✓" : "○"} {c.t}</li>)}
              </ul>
            </>)}
          </div>
        </aside>

        <main className="vtx-main flex min-w-0 flex-1 flex-col bg-black/40">
          <div className="vtx-stage flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4">
            <div className={`relative ${fmt === "short" ? "vtx-short" : ""}`} style={fmt === "long" ? { width: "min(100%, 880px)", aspectRatio: `${W}/${H}` } : { aspectRatio: `${W}/${H}` }}>
              <canvas ref={canvasRef} width={cw} height={ch} className="h-full w-full rounded-md shadow-2xl object-contain" />
              {safe && fmt === "short" && <div className="pointer-events-none absolute inset-x-0 top-0 bottom-0 rounded-md border border-dashed border-amber-400/50" style={{ margin: "6% 14% 22% 5%" }} />}
            </div>
          </div>
          <div className="space-y-3 border-t border-slate-800 bg-slate-950 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button className={btn(true)} onClick={playing ? pause : play}>{playing ? "Pause" : "Play"}</button>
              <button className={btn()} onClick={() => { pause(); seek(0); }}>Restart</button>
              <span className="w-24 text-xs sm:text-sm tabular-nums text-slate-300">{clock(t)} / {clock(total)}</span>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400"><input type="checkbox" checked={caps} onChange={(e) => setCaps(e.target.checked)} />Captions</label>
              {fmt === "short" && <label className="flex items-center gap-1.5 text-xs text-slate-400"><input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} />Safe zone</label>}
            </div>
            <div className="relative cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * total); }}>
              <div className="flex h-10 sm:h-12 gap-0.5 overflow-hidden rounded">
                {scenes.map((s) => (
                  <div key={s.id} onClick={() => setSelId(s.id)} title={s.title} style={{ flex: s.duration, background: `linear-gradient(135deg,${PALETTES[s.palette][0]},${PALETTES[s.palette][1]})` }} className={`truncate px-2 py-1 text-xs ${s.id === sel?.id ? "ring-2 ring-inset ring-white" : ""}`}>{s.title}</div>
                ))}
              </div>
              <div className="pointer-events-none absolute top-0 h-10 sm:h-12 w-0.5 bg-white" style={{ left: `${total ? (t / total) * 100 : 0}%` }} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
