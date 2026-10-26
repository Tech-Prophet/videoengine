import { guard, json } from "../lib/shared.ts";

// GET /api/status  ->  { openai, pexels, pixabay }
// Tells the app which providers this server has keys for. It never returns the keys.
export default async (req: Request) => {
  if (req.method !== "GET") return json({ error: "Use GET." }, 405);
  const denied = guard(req);
  if (denied) return denied;
  return json({
    openai: !!process.env.OPENAI_TTS_API_KEY,
    pexels: !!process.env.PEXELS_API_KEY,
    pixabay: !!process.env.PIXABAY_API_KEY,
  });
};

export const config = { path: "/api/status" };
