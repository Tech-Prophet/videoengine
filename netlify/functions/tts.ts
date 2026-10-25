import { guard, json } from "../lib/shared.ts";

const VOICES = ["alloy", "nova", "onyx", "echo", "shimmer", "fable"];

// POST /api/tts  { text, voice }  ->  audio/mpeg
// The OpenAI key stays on the server and is never sent to the browser.
export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const denied = guard(req);
  if (denied) return denied;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return json({ error: "OPENAI_API_KEY is not set on the server." }, 500);

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
  if (!r.ok) return json({ error: `The voice provider returned ${r.status}.` }, r.status === 429 ? 429 : 502);
  return new Response(r.body, { status: 200, headers: { "content-type": "audio/mpeg" } });
};

export const config = { path: "/api/tts" };
