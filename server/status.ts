import { guard, json, type Env } from "./shared.ts";

// GET /api/status  ->  { openai, pexels, pixabay }
// Tells the app which providers this server has keys for. It never returns the keys.
export async function status(req: Request, env: Env) {
  if (req.method !== "GET") return json({ error: "Use GET." }, 405);
  const denied = guard(req, env);
  if (denied) return denied;
  return json({
    openai: !!env.OPENAI_TTS_API_KEY,
    pexels: !!env.PEXELS_API_KEY,
    pixabay: !!env.PIXABAY_API_KEY,
  });
}

