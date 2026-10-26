import { guard, json } from "../lib/shared.ts";

const VOICES = ["alloy", "nova", "onyx", "echo", "shimmer", "fable"];

// POST /api/tts  { text, voice }  ->  audio/mpeg
// The OpenAI key stays on the server and is never sent to the browser.
// The variable is deliberately NOT called OPENAI_API_KEY: Netlify's AI Gateway fills that name
// automatically with its own key, which OpenAI rejects when sent straight to api.openai.com.
export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const denied = guard(req);
  if (denied) return denied;
  const key = process.env.OPENAI_TTS_API_KEY;
  if (!key) return json({ error: "OPENAI_TTS_API_KEY is not set on the server." }, 500);

  let body: { text?: unknown; voice?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Request body must be JSON." }, 400); }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voice = typeof body.voice === "string" && VOICES.includes(body.voice) ? body.voice : "alloy";
  if (!text || text.length > 4000) return json({ error: "Text must be 1 to 4000 characters." }, 400);

  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
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
  return new Response(r.body, { status: 200, headers: { "content-type": "audio/mpeg" } });
};

export const config = { path: "/api/tts" };
