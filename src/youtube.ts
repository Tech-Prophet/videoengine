// Share to YouTube: everything that talks to Google, with no screens in it.
// The browser signs in with Google's own pop-up (Google Identity Services), gets a short-lived access token, and sends
// the finished video straight to YouTube with the resumable upload protocol. No secret is needed here: only the public
// Client ID of your Google Cloud project. The token lives in memory only (about an hour) and is never saved.

export const SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";
export const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KB, 8 MB is a good size for steady progress

// ---------- Google sign-in ----------
type TokenResp = { access_token?: string; expires_in?: number | string; error?: string; error_description?: string };
type GisClient = { requestAccessToken(o?: { prompt?: string }): void };
type Gis = { accounts: { oauth2: { initTokenClient(c: { client_id: string; scope: string; callback: (r: TokenResp) => void; error_callback?: (e: { type?: string; message?: string }) => void }): GisClient; revoke(t: string, done?: () => void): void } } };
const gis = () => (window as unknown as { google?: Gis }).google;

let gisLoad: Promise<void> | null = null;
export function loadGis(): Promise<void> {
  if (gis()?.accounts?.oauth2) return Promise.resolve();
  gisLoad ??= new Promise<void>((ok, bad) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => ok();
    s.onerror = () => { gisLoad = null; bad(new Error("Could not load Google sign-in. Check your connection, and turn off any ad blocker for this page.")); };
    document.head.appendChild(s);
  });
  return gisLoad;
}

export type Token = { value: string; exp: number }; // exp = time in ms when it stops working
// prompt "" asks Google to reuse an earlier approval without showing anything when it can.
export async function signIn(clientId: string, prompt = "consent"): Promise<Token> {
  await loadGis();
  const g = gis();
  if (!g) throw new Error("Google sign-in did not start.");
  return new Promise<Token>((ok, bad) => {
    const c = g.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(), scope: SCOPES,
      callback: (r) => {
        if (r.access_token) ok({ value: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
        else bad(new Error(r.error_description || r.error || "Google did not give access."));
      },
      error_callback: (e) => bad(new Error(e.type === "popup_closed" ? "The Google window was closed before you finished." : e.type === "popup_failed_to_open" ? "Your browser blocked the Google window. Allow pop-ups for this page and try again." : e.message || "Google sign-in failed.")),
    });
    c.requestAccessToken({ prompt });
  });
}
export async function signOut(t: Token | null) {
  if (!t) return;
  try { await loadGis(); gis()?.accounts.oauth2.revoke(t.value); } catch { /* nothing to undo */ }
}

// ---------- Errors in plain words ----------
export class YtError extends Error {
  status: number; reason: string;
  constructor(message: string, status = 0, reason = "") { super(message); this.status = status; this.reason = reason; }
}
const REASONS: Record<string, string> = {
  quotaExceeded: "YouTube's daily limit for this Google project is used up. Try again tomorrow.",
  uploadLimitExceeded: "This YouTube channel has reached its upload limit for now. Try again later.",
  forbidden: "YouTube refused this request. Check that this Google account owns the channel and that the YouTube Data API is switched on.",
  youtubeSignupRequired: "This Google account has no YouTube channel yet. Create one on YouTube first.",
  invalidTitle: "YouTube did not accept the title. Remove any < or > characters and keep it under 100 characters.",
  invalidDescription: "YouTube did not accept the description. Remove any < or > characters and keep it under 5,000 characters.",
  invalidTags: "YouTube did not accept the tags. Shorten them or remove odd characters.",
  invalidPublishAt: "YouTube did not accept the scheduled time. Pick a time in the future.",
  mediaBodyRequired: "The video file was empty.",
  insufficientPermissions: "The sign-in does not allow uploads. Disconnect, then connect again and tick every box Google shows.",
  authError: "Your Google sign-in has expired. Connect again.",
};
async function failFrom(status: number, body: string): Promise<YtError> {
  let reason = "", msg = "";
  try { const j = JSON.parse(body) as { error?: { message?: string; errors?: { reason?: string }[] } }; reason = j.error?.errors?.[0]?.reason ?? ""; msg = j.error?.message ?? ""; } catch { /* not JSON */ }
  if (status === 401) return new YtError(REASONS.authError, 401, "authError");
  return new YtError(REASONS[reason] || (msg ? `YouTube said: ${msg}` : `YouTube returned an error (${status}).`), status, reason);
}

// ---------- Channel and video state ----------
export type Channel = { id: string; title: string; thumb: string };
export async function myChannel(t: Token): Promise<Channel> {
  const r = await fetch(`${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${t.value}` } });
  if (!r.ok) throw await failFrom(r.status, await r.text());
  const j = await r.json() as { items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url: string } } } }[] };
  const c = j.items?.[0];
  if (!c) throw new YtError(REASONS.youtubeSignupRequired, 404, "youtubeSignupRequired");
  return { id: c.id, title: c.snippet.title, thumb: c.snippet.thumbnails?.default?.url ?? "" };
}

export type VideoState = { upload: string; privacy: string; publishAt: string; processing: string };
export async function videoState(t: Token, id: string): Promise<VideoState | null> {
  const r = await fetch(`${API}/videos?part=status,processingDetails&id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${t.value}` } });
  if (!r.ok) throw await failFrom(r.status, await r.text());
  const j = await r.json() as { items?: { status?: { uploadStatus?: string; privacyStatus?: string; publishAt?: string }; processingDetails?: { processingStatus?: string } }[] };
  const v = j.items?.[0];
  return v ? { upload: v.status?.uploadStatus ?? "", privacy: v.status?.privacyStatus ?? "", publishAt: v.status?.publishAt ?? "", processing: v.processingDetails?.processingStatus ?? "" } : null;
}

// ---------- Checking the details before anything is sent ----------
export type Visibility = "public" | "schedule" | "private" | "unlisted";
export type Meta = { title: string; description: string; tags: string[]; categoryId: string; madeForKids: boolean; visibility: Visibility; publishAt?: string };

export const parseTags = (s: string) => s.split(/[,\n]/).map((x) => x.trim().replace(/^#/, "")).filter(Boolean);
const bytes = (s: string) => new TextEncoder().encode(s).length;
// YouTube counts a tag with a space as two more characters (the quotes around it).
const tagChars = (t: string[]) => t.reduce((n, x) => n + x.length + (x.includes(" ") ? 2 : 0), 0) + Math.max(0, t.length - 1);

export function problems(m: Meta, now = Date.now()): string[] {
  const p: string[] = [];
  if (!m.title.trim()) p.push("Add a title.");
  else if (m.title.length > 100) p.push("The title must be 100 characters or fewer.");
  if (/[<>]/.test(m.title)) p.push("Remove < and > from the title.");
  if (/[<>]/.test(m.description)) p.push("Remove < and > from the description.");
  if (bytes(m.description) > 5000) p.push("The description is over YouTube's 5,000 byte limit.");
  if (tagChars(m.tags) > 500) p.push("The tags are over 500 characters in total.");
  if (m.visibility === "schedule") {
    const at = m.publishAt ? Date.parse(m.publishAt) : NaN;
    if (!Number.isFinite(at)) p.push("Pick the date and time to publish.");
    else if (at < now + 5 * 60 * 1000) p.push("Pick a publish time at least 5 minutes from now.");
  }
  return p;
}

export const bodyOf = (m: Meta) => ({
  snippet: { title: m.title.trim(), description: m.description, tags: m.tags, categoryId: m.categoryId },
  // A scheduled video is uploaded as private and YouTube makes it public at publishAt.
  status: { privacyStatus: m.visibility === "public" ? "public" : m.visibility === "unlisted" ? "unlisted" : "private", selfDeclaredMadeForKids: m.madeForKids, ...(m.visibility === "schedule" && m.publishAt ? { publishAt: new Date(m.publishAt).toISOString() } : {}) },
});

// ---------- Resumable upload ----------
export async function startSession(t: Token, m: Meta, size: number, type: string): Promise<string> {
  const r = await fetch(`${UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t.value}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": type || "video/mp4" },
    body: JSON.stringify(bodyOf(m)),
  });
  if (!r.ok) throw await failFrom(r.status, await r.text());
  const at = r.headers.get("Location");
  if (!at) throw new YtError("YouTube did not start the upload. Try again.");
  return at;
}

type Put = { status: number; range: string | null; text: string };
function put(url: string, body: Blob | null, range: string, token: string, onBytes: (n: number) => void, signal: AbortSignal): Promise<Put> {
  return new Promise((ok, bad) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Authorization", `Bearer ${token}`);
    x.setRequestHeader("Content-Range", range);
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => ok({ status: x.status, range: x.getResponseHeader("Range"), text: x.responseText });
    x.onerror = () => ok({ status: 0, range: null, text: "" }); // a dropped connection: the caller decides to resume
    x.ontimeout = x.onerror;
    x.onabort = () => bad(new YtError("Upload cancelled."));
    signal.addEventListener("abort", () => x.abort(), { once: true });
    x.send(body);
  });
}
const doneBytes = (range: string | null) => { const m = range?.match(/bytes=0-(\d+)/); return m ? parseInt(m[1], 10) + 1 : 0; };
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((ok, bad) => { const id = setTimeout(ok, ms); signal.addEventListener("abort", () => { clearTimeout(id); bad(new YtError("Upload cancelled.")); }, { once: true }); });

export type Sent = { id: string };
// Sends the video in chunks. If the connection drops or YouTube has a hiccup, asks YouTube how much it has and carries on from there.
// getToken is asked for a fresh token when YouTube says the old one ran out.
export async function sendVideo(session: string, blob: Blob, getToken: (stale: boolean) => Promise<string>, onProgress: (done: number, total: number) => void, signal: AbortSignal, pause = wait, chunk = CHUNK): Promise<Sent> {
  const size = blob.size;
  let offset = 0, token = await getToken(false), bad = 0;
  for (;;) {
    const end = Math.min(offset + chunk, size);
    const res = await put(session, blob.slice(offset, end), `bytes ${offset}-${end - 1}/${size}`, token, (n) => onProgress(offset + n, size), signal);
    if (res.status === 200 || res.status === 201) {
      onProgress(size, size);
      const id = (JSON.parse(res.text) as { id?: string }).id;
      if (!id) throw new YtError("YouTube finished the upload but did not return a video ID.");
      return { id };
    }
    if (res.status === 308) { bad = 0; offset = res.range === null ? end : doneBytes(res.range); onProgress(offset, size); continue; }
    if (res.status === 401) { token = await getToken(true); continue; }
    if (res.status === 0 || res.status >= 500) {
      if (++bad > 6) throw new YtError("The connection to YouTube kept failing. Check your internet and try again.");
      await pause(Math.min(30000, 1000 * 2 ** bad), signal);
      const q = await put(session, null, `bytes */${size}`, token, () => {}, signal); // how much did YouTube get?
      if (q.status === 200 || q.status === 201) { const id = (JSON.parse(q.text) as { id?: string }).id; if (id) return { id }; }
      if (q.status === 308) offset = doneBytes(q.range);
      else if (q.status === 404) throw new YtError("The upload session ran out. Start the upload again.", 404);
      continue;
    }
    throw await failFrom(res.status, res.text);
  }
}

export async function setThumbnail(t: Token, id: string, img: Blob): Promise<void> {
  const r = await fetch(`${UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(id)}`, { method: "POST", headers: { Authorization: `Bearer ${t.value}`, "Content-Type": img.type || "image/jpeg" }, body: img });
  if (r.ok) return;
  const e = await failFrom(r.status, await r.text());
  throw new YtError(r.status === 403 && (e.reason === "forbidden" || !e.reason) ? "YouTube would not take the thumbnail. Custom thumbnails need a channel with a verified phone number (YouTube Studio, Settings, Channel, Feature eligibility). The video itself was uploaded." : e.message, r.status, e.reason);
}

// ---------- Upload history, kept in this browser ----------
export type Status = "uploading" | "processing" | "scheduled" | "published" | "private" | "unlisted" | "failed";
export type Entry = { key: string; title: string; videoId: string; channel: string; status: Status; visibility: Visibility; publishAt: string; uploadedAt: string; error: string; meta: Meta };
const HKEY = "vortex-yt-history";
export function loadHistory(): Entry[] {
  try {
    const h = JSON.parse(localStorage.getItem(HKEY) || "[]") as Entry[];
    // A page that closed during an upload cannot finish it: the video file was only in memory.
    return h.map((e) => e.status === "uploading" ? { ...e, status: "failed" as Status, error: "The page was closed before the upload finished. Render the video again and upload it again." } : e);
  } catch { return []; }
}
export function saveHistory(h: Entry[]) { try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 50))); } catch { /* storage full or blocked */ } }

// What to show once YouTube has the file. Nothing is called "published" until YouTube has finished processing it.
export function statusOf(v: VideoState, m: Meta): Status {
  if (v.upload === "failed" || v.upload === "rejected" || v.upload === "deleted" || v.processing === "failed" || v.processing === "terminated") return "failed";
  if (v.upload !== "processed" || (v.processing && v.processing !== "succeeded" && v.processing !== "")) return "processing";
  if (v.publishAt || m.visibility === "schedule") return "scheduled";
  return v.privacy === "public" ? "published" : v.privacy === "unlisted" ? "unlisted" : "private";
}
export const failText = (v: VideoState) => v.upload === "rejected" ? "YouTube rejected this video (for example a duplicate or a policy problem). Check YouTube Studio." : v.upload === "failed" ? "YouTube could not process this video. Check YouTube Studio." : v.upload === "deleted" ? "This video was deleted on YouTube." : v.processing === "failed" || v.processing === "terminated" ? "YouTube could not process this video. Check YouTube Studio." : "";
