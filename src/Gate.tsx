import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { btn, inp } from "./ui.ts";

// The lock screen. The app is not shown until the server confirms the access code. Only the server knows the real code,
// so the answer cannot be faked in the browser. The code is kept on this device (the same place the app reads it from),
// so it only has to be typed once per browser.
const KEY = "vortex-access";
const readCode = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
const saveCode = (c: string) => { try { localStorage.setItem(KEY, c); } catch { /* storage blocked: the code is asked for again next time */ } };
const clearCode = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

type Verdict = { kind: "ok" } | { kind: "wrong" } | { kind: "limited" | "setup" | "down"; msg: string };
const DOWN = "Could not reach the server. The studio only opens on the hosted site (Netlify or Cloudflare), and needs a connection to check your code.";

async function check(code: string): Promise<Verdict> {
  try {
    const r = await fetch("/api/status", { headers: { "x-access-code": code }, cache: "no-store" });
    const j = (await r.json().catch(() => null)) as { error?: string; voice?: unknown } | null;
    // A real answer from the server has a "voice" field. A host that sends back its home page for unknown addresses must not unlock the app.
    if (r.ok) return j && typeof j.voice === "boolean" ? { kind: "ok" } : { kind: "down", msg: DOWN };
    if (r.status === 401) return { kind: "wrong" };
    if (r.status === 429) return { kind: "limited", msg: j?.error || "Too many wrong codes. Wait about 10 minutes and try again." };
    if (r.status === 500 && j?.error) return { kind: "setup", msg: j.error };
    return { kind: "down", msg: DOWN };
  } catch { return { kind: "down", msg: DOWN }; }
}

type Phase = "checking" | "locked" | "down" | "open";

export default function Gate({ children }: { children: ReactNode }) {
  // "npm run dev" has no server to ask, so the lock screen is skipped there. A production build never skips it.
  const [phase, setPhase] = useState<Phase>(() => (import.meta.env.DEV ? "open" : readCode() ? "checking" : "locked"));
  const [msg, setMsg] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const verifySaved = useCallback(async () => {
    setPhase("checking");
    const v = await check(readCode());
    if (v.kind === "ok") { setPhase("open"); return; }
    if (v.kind === "wrong") { clearCode(); setMsg("The saved access code no longer works. Enter the new one."); setPhase("locked"); return; }
    setMsg(v.msg);
    setPhase(v.kind === "limited" ? "locked" : "down");
  }, []);

  useEffect(() => {
    if (phase !== "checking") return;
    void verifySaved();
    // runs once, on first load with a saved code
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true); setMsg("");
    const v = await check(c);
    setBusy(false);
    if (v.kind === "ok") { saveCode(c); setPhase("open"); return; }
    setMsg(v.kind === "wrong" ? "That access code is not right." : v.msg);
  };

  if (phase === "open") return <>{children}</>;

  const shell = (inner: ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h1 className="text-lg font-bold">Vortex <span className="text-violet-400">AI Studio</span></h1>
        {inner}
      </div>
    </div>
  );

  if (phase === "checking") return shell(<p className="text-sm text-slate-400">Checking access…</p>);
  if (phase === "down") return shell(<>
    <p role="alert" className="text-sm text-amber-300">{msg}</p>
    <button className={`${btn(true)} w-full`} onClick={() => void verifySaved()}>Try again</button>
  </>);

  return shell(
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <p className="text-sm text-slate-400">This studio is private. Enter your access code to open it.</p>
      <input aria-label="Access code" type={show ? "text" : "password"} autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} className={inp} value={code} onChange={(e) => setCode(e.target.value)} />
      <label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />Show the code (to check for typos)</label>
      {msg && <p role="alert" className="text-sm text-red-400">{msg}</p>}
      <button type="submit" className={`${btn(true)} w-full`} disabled={busy || !code.trim()}>{busy ? "Checking…" : "Unlock"}</button>
    </form>
  );
}
