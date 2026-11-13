import { useCallback, useEffect, useRef, useState } from "react";
import { btn, inp } from "./ui.ts";
import { failText, loadHistory, myChannel, parseTags, problems, saveHistory, sendVideo, setThumbnail, signIn, signOut, startSession, statusOf, videoState } from "./youtube.ts";
import type { Channel, Entry, Meta, Status, Token, Visibility } from "./youtube.ts";

const CATS: [string, string][] = [["27", "Education"], ["22", "People & Blogs"], ["24", "Entertainment"], ["25", "News & Politics"], ["28", "Science & Technology"], ["1", "Film & Animation"]];
const CLIENT_KEY = "vortex-yt-client";
const LABEL: Record<Status, string> = { uploading: "Uploading", processing: "Processing on YouTube", scheduled: "Scheduled", published: "Published", private: "Private", unlisted: "Unlisted", failed: "Failed" };
const COLOR: Record<Status, string> = { uploading: "text-sky-300", processing: "text-amber-300", scheduled: "text-violet-300", published: "text-emerald-400", private: "text-slate-300", unlisted: "text-slate-300", failed: "text-rose-400" };
const mb = (n: number) => (n / 1e6).toFixed(1);
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

type Props = {
  file: { url: string; name: string; mb: number; blob: Blob } | null;
  title: string; setTitle: (s: string) => void;
  desc: string; setDesc: (s: string) => void;
  tags: string; setTags: (s: string) => void;
  getThumb: () => Promise<Blob | null>;
};

// The Share to YouTube box in the Publish tab. The title, description and tags are the same ones as in the boxes below it,
// so anything edited here is edited there too.
export function YouTubePanel({ file, title, setTitle, desc, setDesc, tags, setTags, getThumb }: Props) {
  const [clientId, setClientId] = useState(() => { try { return localStorage.getItem(CLIENT_KEY) ?? ""; } catch { return ""; } });
  const [token, setTokenState] = useState<Token | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false); // signing in
  const [vis, setVis] = useState<Visibility>("public");
  const [at, setAt] = useState("");
  const [cat, setCat] = useState("27");
  const [kids, setKids] = useState(false);
  const [sure, setSure] = useState(false);
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState("");
  const [hist, setHist] = useState<Entry[]>(loadHistory);
  const [thumbUrl, setThumbUrl] = useState("");
  const [needAuth, setNeedAuth] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const tokenRef = useRef<Token | null>(null);
  const reauth = useRef<((t: Token) => void) | null>(null);
  const setToken = (t: Token | null) => { tokenRef.current = t; setTokenState(t); };

  const remember = (h: Entry[]) => { setHist(h); saveHistory(h); };
  const patch = (key: string, at: string, p: Partial<Entry>) => setHist((old) => { const n = old.map((e) => e.key === key && e.uploadedAt === at ? { ...e, ...p } : e); saveHistory(n); return n; });

  // Thumbnail preview, made from the Thumbnail section's picture.
  const refreshThumb = useCallback(async () => {
    const b = await getThumb();
    setThumbUrl((old) => { if (old) URL.revokeObjectURL(old); return b ? URL.createObjectURL(b) : ""; });
  }, [getThumb]);
  useEffect(() => {
    let live = true;
    void getThumb().then((b) => { if (live) setThumbUrl((old) => { if (old) URL.revokeObjectURL(old); return b ? URL.createObjectURL(b) : ""; }); });
    return () => { live = false; };
  }, [getThumb, title]);

  // Do not lose a running upload by accident.
  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  const connect = async () => {
    setErr(""); setBusy(true);
    try {
      try { localStorage.setItem(CLIENT_KEY, clientId.trim()); } catch { /* not saved */ }
      const t = await signIn(clientId);
      setToken(t); setChannel(await myChannel(t));
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not connect."); setToken(null); setChannel(null); }
    setBusy(false);
  };
  const disconnect = async () => { await signOut(token); setToken(null); setChannel(null); setErr(""); };

  // A token for the upload. If it ran out in the middle, try quietly first, then ask the user to press Reconnect.
  const freshToken = async (stale: boolean): Promise<string> => {
    const t = tokenRef.current;
    if (t && !stale && t.exp - Date.now() > 60000) return t.value;
    try { const n = await signIn(clientId, ""); setToken(n); return n.value; } catch { /* needs a click */ }
    setNeedAuth(true); setPhase("Your Google sign-in ran out. Press Reconnect to carry on.");
    return new Promise<string>((ok) => { reauth.current = (n) => { setToken(n); setNeedAuth(false); ok(n.value); }; });
  };
  const reconnect = async () => { try { const n = await signIn(clientId); reauth.current?.(n); } catch (e) { setErr(e instanceof Error ? e.message : "Could not reconnect."); } };

  const meta = (): Meta => ({ title, description: desc, tags: parseTags(tags), categoryId: cat, madeForKids: kids, visibility: vis, publishAt: vis === "schedule" ? at : undefined });
  const issues = problems(meta());
  const dupe = file ? hist.find((e) => e.key === `${file.name}|${file.blob.size}` && e.status !== "failed") : undefined;

  const publish = async (m: Meta = meta(), retryOf?: Entry) => {
    if (!file || !token || !channel || running) return;
    const key = `${file.name}|${file.blob.size}`;
    if (!retryOf && dupe && !window.confirm(`This video was already sent to YouTube ("${dupe.title}", ${LABEL[dupe.status].toLowerCase()}). Send it again as a new video?`)) return;
    setErr(""); setRunning(true); setPct(0); setPhase("Starting the upload…");
    const ctl = new AbortController(); abort.current = ctl;
    const started = new Date().toISOString();
    const row: Entry = { key, title: m.title.trim(), videoId: "", channel: channel.title, status: "uploading", visibility: m.visibility, publishAt: m.publishAt ?? "", uploadedAt: started, error: "", meta: m };
    remember([row, ...hist.filter((e) => e !== retryOf)]);
    try {
      const session = await startSession({ value: await freshToken(false), exp: 0 }, m, file.blob.size, file.blob.type);
      setPhase("Uploading…");
      const { id } = await sendVideo(session, file.blob, freshToken, (d, t) => { setPct(Math.round((d / t) * 100)); }, ctl.signal);
      patch(key, started, { videoId: id, status: "processing" });
      let note = "";
      setPhase("Uploaded. Sending the thumbnail…");
      const th = await getThumb();
      if (th) { try { await setThumbnail({ value: await freshToken(false), exp: 0 }, id, th); } catch (e) { note = e instanceof Error ? e.message : "The thumbnail was not sent."; } }
      setPhase("Uploaded. YouTube is processing the video…");
      if (note) patch(key, started, { error: note });
      await watch(key, started, id, m, ctl.signal);
    } catch (e) {
      const text = e instanceof Error ? e.message : "The upload failed.";
      patch(key, started, { status: "failed", error: text }); setErr(text); setPhase("");
    }
    setRunning(false); abort.current = null; setSure(false);
  };

  // Ask YouTube every few seconds until it has finished processing, for up to ten minutes.
  const watch = async (key: string, started: string, id: string, m: Meta, signal: AbortSignal) => {
    for (let i = 0; i < 75 && !signal.aborted; i++) {
      const v = await videoState({ value: await freshToken(false), exp: 0 }, id).catch(() => null);
      if (v) {
        const s = statusOf(v, m);
        if (s === "failed") { patch(key, started, { status: "failed", error: failText(v) }); setPhase(""); return; }
        if (s !== "processing") { patch(key, started, { status: s, publishAt: v.publishAt || m.publishAt || "" }); setPhase(""); return; }
      }
      await new Promise((r) => setTimeout(r, 8000));
    }
    setPhase("YouTube is still processing. Press Check status in the history in a few minutes.");
  };
  const check = async (e: Entry) => {
    if (!token || !e.videoId) return;
    const v = await videoState(token, e.videoId).catch((x) => { setErr(x instanceof Error ? x.message : "Could not check."); return null; });
    if (!v) return;
    const s = statusOf(v, e.meta);
    patch(e.key, e.uploadedAt, s === "failed" ? { status: s, error: failText(v) } : { status: s, publishAt: v.publishAt || e.publishAt });
  };
  const cancel = () => abort.current?.abort();
  const rm = (e: Entry) => remember(hist.filter((x) => x !== e));

  const ready = !!file && !!token && !!channel && !running && issues.length === 0 && sure;
  const fmtTime = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(); };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Send the finished video straight to your YouTube channel. Nothing is sent until you press the button at the end.</p>

      <div className="space-y-2 rounded-md border border-slate-800 p-2">
        <p className="text-xs font-semibold text-slate-300">1. Connect your channel</p>
        {channel && token ? <div className="flex items-center gap-2 text-sm">
          {channel.thumb && <img src={channel.thumb} alt="" className="h-8 w-8 rounded-full" />}
          <span className="min-w-0 flex-1 truncate">Connected: <b>{channel.title}</b></span>
          <button className={btn()} onClick={() => void disconnect()}>Disconnect</button>
        </div> : <>
          <label className="block"><span className="mb-1 block text-xs text-slate-400">Google OAuth Client ID (from your Google Cloud project, see the README)</span>
            <input className={inp} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="123456789-abc….apps.googleusercontent.com" autoComplete="off" spellCheck={false} /></label>
          <button className={`${btn(true)} w-full`} disabled={busy || !clientId.trim().endsWith(".apps.googleusercontent.com")} onClick={() => void connect()}>{busy ? "Waiting for Google…" : "Connect YouTube channel"}</button>
        </>}
        {token && Date.now() > token.exp - 120000 && <p className="text-xs text-amber-300">Your Google sign-in is about to expire. Disconnect and connect again before you upload.</p>}
      </div>

      <div className="space-y-2 rounded-md border border-slate-800 p-2">
        <p className="text-xs font-semibold text-slate-300">2. Check the details</p>
        {file ? <video src={file.url} controls playsInline className="mx-auto max-h-56 w-full rounded-md bg-black" /> : <p className="rounded-md border border-amber-500/40 p-2 text-xs text-amber-300">There is no video yet. Render it first (Export), then come back.</p>}
        {thumbUrl && <div className="flex items-center gap-2"><img src={thumbUrl} alt="Thumbnail that will be sent" className="h-16 rounded-md" /><button className={btn()} onClick={() => void refreshThumb()}>Refresh thumbnail</button></div>}
        <label className="block"><span className="mb-1 block text-xs text-slate-400">Title ({title.length}/100)</span><input className={inp} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs text-slate-400">Description</span><textarea className={inp} rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs text-slate-400">Tags, separated by commas</span><textarea className={inp} rows={2} value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="mb-1 block text-xs text-slate-400">Category</span><select className={inp} value={cat} onChange={(e) => setCat(e.target.value)}>{CATS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs text-slate-400">Made for kids?</span><select className={inp} value={kids ? "yes" : "no"} onChange={(e) => setKids(e.target.value === "yes")}><option value="no">No, not made for kids</option><option value="yes">Yes, made for kids</option></select></label>
        </div>
        <p className="text-xs text-slate-500">Descriptions with a spoiler-free hook, chapters off and a pinned comment are prepared in the boxes below. A pinned comment cannot be added from this app: post it in YouTube after the upload.</p>
      </div>

      <div className="space-y-2 rounded-md border border-slate-800 p-2">
        <p className="text-xs font-semibold text-slate-300">3. Choose when it goes live</p>
        {([["public", "Publish immediately"], ["schedule", "Schedule for a date and time"], ["private", "Save as private"], ["unlisted", "Upload as unlisted"]] as [Visibility, string][]).map(([v, n]) =>
          <label key={v} className="flex items-center gap-2 text-sm"><input type="radio" name="yt-vis" className="accent-violet-500" checked={vis === v} onChange={() => { setVis(v); if (v === "schedule" && !at) setAt(localInput(new Date(Date.now() + 24 * 3600 * 1000))); }} />{n}</label>)}
        {vis === "schedule" && <label className="block"><span className="mb-1 block text-xs text-slate-400">Goes live on (your local time)</span><input type="datetime-local" className={inp} value={at} min={localInput(new Date(Date.now() + 5 * 60000))} onChange={(e) => setAt(e.target.value)} /></label>}
      </div>

      <div className="space-y-2 rounded-md border border-slate-800 p-2">
        <p className="text-xs font-semibold text-slate-300">4. Publish</p>
        {issues.length > 0 && <ul className="space-y-0.5 text-xs text-amber-300">{issues.map((x) => <li key={x}>• {x}</li>)}</ul>}
        {dupe && <p className="text-xs text-amber-300">This video file was already sent as "{dupe.title}" ({LABEL[dupe.status].toLowerCase()}). You will be asked to confirm before it goes again.</p>}
        <label className="flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" className="mt-0.5 accent-violet-500" checked={sure} onChange={(e) => setSure(e.target.checked)} /><span>I have checked the title, description and settings, and I want to send this video to {channel ? <b>{channel.title}</b> : "my channel"}.</span></label>
        <button className={`${btn(true)} w-full`} disabled={!ready} onClick={() => void publish()}>{running ? "Working…" : vis === "public" ? "Publish to YouTube" : vis === "schedule" ? "Upload and schedule" : vis === "private" ? "Upload as private" : "Upload as unlisted"}</button>
        {running && <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} /></div>
          <p className="text-xs text-slate-300">{phase} {pct > 0 && pct < 100 ? `${pct}% of ${file ? mb(file.blob.size) : ""} MB` : ""}</p>
          <p className="text-xs text-slate-500">Keep this tab open until the upload finishes.</p>
          {needAuth && <button className={`${btn(true)} w-full`} onClick={() => void reconnect()}>Reconnect</button>}
          <button className={`${btn()} w-full`} onClick={cancel}>Cancel upload</button>
        </div>}
        {!running && phase && <p className="text-xs text-amber-300">{phase}</p>}
        {err && <p role="alert" className="text-xs text-rose-400">{err}</p>}
      </div>

      {hist.length > 0 && <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-300">Upload history</p>
        <ul className="space-y-2">
          {hist.map((e) => <li key={e.key + e.uploadedAt} className="rounded-md border border-slate-800 p-2 text-xs">
            <div className="flex items-start justify-between gap-2"><span className="min-w-0 flex-1 break-words font-medium">{e.title}</span><span className={`shrink-0 ${COLOR[e.status]}`}>{LABEL[e.status]}</span></div>
            <p className="text-slate-500">{e.channel} · sent {fmtTime(e.uploadedAt)}{e.publishAt ? ` · goes live ${fmtTime(e.publishAt)}` : ""}</p>
            {e.videoId && <p className="break-all"><a className="text-violet-300 underline" href={`https://www.youtube.com/watch?v=${e.videoId}`} target="_blank" rel="noreferrer">youtube.com/watch?v={e.videoId}</a></p>}
            {e.error && <p className={e.status === "failed" ? "text-rose-400" : "text-amber-300"}>{e.error}</p>}
            <div className="mt-1 flex gap-2">
              {e.videoId && token && e.status !== "failed" && <button className={btn()} onClick={() => void check(e)}>Check status</button>}
              {e.status === "failed" && !e.videoId && file && token && !running && <button className={btn()} onClick={() => void publish(e.meta, e)}>Retry upload</button>}
              {e.status !== "uploading" && <button className={btn()} onClick={() => rm(e)}>Remove from list</button>}
            </div>
          </li>)}
        </ul>
      </div>}
    </div>
  );
}
