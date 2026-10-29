import { guard, json, type Env } from "./shared.ts";
import { voiceProvider } from "./tts.ts";

// GET /api/status  ->  { voice, voiceProvider, pexels, pixabay }
// Tells the app which providers this server has keys for. It never returns the keys.
export async function status(req: Request, env: Env) {
  if (req.method !== "GET") return json({ error: "Use GET." }, 405);
  const denied = guard(req, env);
  if (denied) return denied;
  const vp = voiceProvider(env);
  return json({
    voice: vp !== "",
    voiceProvider: vp,
    pexels: !!env.PEXELS_API_KEY,
    pixabay: !!env.PIXABAY_API_KEY,
  });
}
