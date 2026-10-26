import { guard, json, type Env } from "./shared.ts";

const VOICES = ["alloy", "nova", "onyx", "echo", "shimmer", "fable"]; // OpenAI voices
// Cloudflare: "melo" = MeloTTS (one female voice, cheapest on the free allowance). The rest are Deepgram Aura-1 speakers.
const AURA = ["orion", "arcas", "perseus", "angus", "orpheus", "helios", "zeus", "asteria", "luna", "athena", "hera", "stella"];
const CF_VOICES = ["melo", ...AURA];

export type VoiceProvider = "cloudflare" | "openai" | "";
// Which voice service this server will use. Cloudflare comes first because it has a free daily allowance.
// Set TTS_PROVIDER=openai to prefer OpenAI when both are configured.
export function voiceProvider(env: Env): VoiceProvider {
  const cf = !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
  const oa = !!env.OPENAI_TTS_API_KEY;
  if (env.TTS_PROVIDER === "openai" && oa) return "openai";
  if (env.TTS_PROVIDER === "cloudflare" && cf) return "cloudflare";
  return cf ? "cloudflare" : oa ? "openai" : "";
}

const MP3 = { "content-type": "audio/mpeg" };

// Cloudflare Workers AI: MeloTTS (English) or Deepgram Aura-1. Free daily allowance; keys stay on the server.
async function viaCloudflare(env: Env, text: string, voice: string): Promise<Response> {
  const id = env.CLOUDFLARE_ACCOUNT_ID ?? "", token = env.CLOUDFLARE_API_TOKEN ?? "";
  if (!/^[0-9a-f]{32}$/i.test(id)) return json({ error: "CLOUDFLARE_ACCOUNT_ID on the server looks wrong. It should be 32 letters and numbers." }, 500);
  const aura = voice !== "melo";
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${id}/ai/run/${aura ? "@cf/deepgram/aura-1" : "@cf/myshell-ai/melotts"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(aura ? { text, speaker: voice } : { prompt: text, lang: "en" }),
  });
  if (!r.ok) {
    const d = (await r.json().catch(() => null)) as { errors?: { code?: unknown }[] } | null;
    const code = d?.errors?.[0]?.code;
    const why = typeof code === "number" || typeof code === "string" ? String(code) : "";
    if (r.status === 401 || r.status === 403) return json({ error: "Cloudflare rejected the token saved on the server. Check the token has Workers AI permission and the account ID is the right one." }, 424);
    if (r.status === 429) return json({ error: "Cloudflare is rate limiting, or today's free voice allowance is used up (it resets at midnight UTC). Try again later." }, 429);
    if (r.status >= 500) return json({ error: `Cloudflare had a problem (${r.status}). Try again shortly.` }, 502);
    return json({ error: `Cloudflare refused the request (${r.status}${why ? `, code ${why}` : ""}).` }, 424);
  }
  // A model can answer with raw audio or with JSON holding base64 audio. Both are handled.
  if (!(r.headers.get("content-type") ?? "").includes("json")) return new Response(r.body, { status: 200, headers: MP3 });
  const d = (await r.json().catch(() => null)) as { result?: { audio?: unknown } | string; audio?: unknown } | null;
  const b64 = typeof d?.result === "string" ? d.result : typeof d?.result === "object" && d.result ? d.result.audio : d?.audio;
  if (typeof b64 !== "string" || !b64) return json({ error: "Cloudflare replied, but without any audio." }, 502);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return json({ error: "Cloudflare sent audio in a format the server could not read." }, 502); }
  return new Response(bytes, { status: 200, headers: MP3 });
}

// The variable is deliberately NOT called OPENAI_API_KEY: Netlify's AI Gateway fills that name
// automatically with its own key, which OpenAI rejects when sent straight to api.openai.com.
async function viaOpenAI(env: Env, text: string, voice: string): Promise<Response> {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_TTS_API_KEY}` },
    body: JSON.stringify({ model: "tts-1", voice, input: text }),
  });
  if (!r.ok) {
    // Say what really went wrong, without ever repeating OpenAI's raw message (it can contain part of a key).
    const d = (await r.json().catch(() => null)) as { error?: { code?: unknown } } | null;
    const why = typeof d?.error?.code === "string" ? d.error.code : "";
    if (r.status === 401 || r.status === 403) return json({ error: "OpenAI rejected the key saved on the server. It may be wrong, expired or revoked." }, 424);
    if (r.status === 429 && why === "insufficient_quota") return json({ error: "The OpenAI account has no credit or quota left. Add credit on the OpenAI account, then try again." }, 402);
    if (r.status === 429) return json({ error: "OpenAI is rate limiting requests. Wait a minute and try again." }, 429);
    if (r.status >= 500) return json({ error: `OpenAI had a problem (${r.status}). Try again shortly.` }, 502);
    return json({ error: `OpenAI refused the request (${r.status}${why ? `, ${why}` : ""}).` }, 424);
  }
  return new Response(r.body, { status: 200, headers: MP3 });
}

// POST /api/tts  { text, voice }  ->  audio/mpeg
export async function tts(req: Request, env: Env) {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const denied = guard(req, env);
  if (denied) return denied;
  const provider = voiceProvider(env);
  if (!provider) return json({ error: "No voice service is set on the server. Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (free), or OPENAI_TTS_API_KEY." }, 500);

  let body: { text?: unknown; voice?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Request body must be JSON." }, 400); }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voice = typeof body.voice === "string" && VOICES.includes(body.voice) ? body.voice : "alloy";
  if (!text || text.length > 4000) return json({ error: "Text must be 1 to 4000 characters." }, 400);

  const cfVoice = typeof body.voice === "string" && CF_VOICES.includes(body.voice) ? body.voice : "melo";
  return provider === "cloudflare" ? viaCloudflare(env, text, cfVoice) : viaOpenAI(env, text, voice);
}
