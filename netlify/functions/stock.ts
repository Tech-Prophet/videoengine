import { guard, json } from "../lib/shared.ts";

// GET /api/stock?provider=pexels|pixabay&kind=photos|videos&q=...&orientation=landscape|portrait&per_page=10&page=1
// Looks up stock media with the server's key and returns the provider's JSON unchanged.
export default async (req: Request) => {
  if (req.method !== "GET") return json({ error: "Use GET." }, 405);
  const denied = guard(req);
  if (denied) return denied;

  const p = new URL(req.url).searchParams;
  const provider = p.get("provider");
  const kind = p.get("kind") === "videos" ? "videos" : "photos";
  const q = (p.get("q") ?? "").trim().slice(0, 100);
  const portrait = p.get("orientation") === "portrait";
  const perPage = Math.max(3, Math.min(50, Number(p.get("per_page")) || 10));
  const page = Math.max(1, Math.min(20, Math.floor(Number(p.get("page"))) || 1));
  if (!q) return json({ error: "Missing search text (q)." }, 400);

  let url: string;
  const headers: Record<string, string> = {};
  if (provider === "pexels") {
    const key = process.env.PEXELS_API_KEY;
    if (!key) return json({ error: "PEXELS_API_KEY is not set on the server." }, 500);
    headers.Authorization = key;
    const base = kind === "videos" ? "https://api.pexels.com/videos/search" : "https://api.pexels.com/v1/search";
    url = `${base}?query=${encodeURIComponent(q)}&orientation=${portrait ? "portrait" : "landscape"}&per_page=${perPage}&page=${page}`;
  } else if (provider === "pixabay") {
    const key = process.env.PIXABAY_API_KEY;
    if (!key) return json({ error: "PIXABAY_API_KEY is not set on the server." }, 500);
    const base = kind === "videos" ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/";
    const extra = kind === "videos" ? "" : `&image_type=photo&orientation=${portrait ? "vertical" : "horizontal"}`;
    url = `${base}?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&safesearch=true&per_page=${perPage}&page=${page}${extra}`;
  } else return json({ error: "provider must be pexels or pixabay." }, 400);

  const r = await fetch(url, { headers });
  if (!r.ok) return json({ error: `The ${provider} request returned ${r.status}.` }, r.status === 429 ? 429 : 502);
  return new Response(r.body, { status: 200, headers: { "content-type": "application/json" } });
};

export const config = { path: "/api/stock" };
