// Server code shared by every host (Netlify and Cloudflare). It uses only standard Web APIs,
// and reads settings from the `env` object each host hands in, so it does not depend on any one platform.
export type Env = Record<string, string | undefined>;

// API answers are private and often large (audio, stock search results): never let a browser or CDN keep a copy.
export const NO_STORE = { "cache-control": "no-store" };

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...NO_STORE } });

const enc = new TextEncoder();
// Compares without stopping at the first difference, so response timing does not hint at the code.
const same = (a: string, b: string) => {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
};

// Wrong-code limit: after MAX_FAILS wrong codes from one address within WINDOW_MS, that address is refused until the window ends.
// This is a best-effort brake: the counts live in memory, so each running server instance keeps its own, and they reset when it restarts.
// It makes guessing the code far slower; it does not replace choosing a long, random ACCESS_CODE.
const WINDOW_MS = 10 * 60_000;
const MAX_FAILS = 10;
const fails = new Map<string, { n: number; first: number }>();

// The caller's address as the host reports it. When no address is available, nothing is limited (so strangers sharing one
// "unknown" bucket cannot lock out the real owner); the access code itself still protects the endpoint.
const clientOf = (req: Request): string | null =>
  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;

function recentFails(id: string, now: number) {
  const rec = fails.get(id);
  if (rec && now - rec.first > WINDOW_MS) { fails.delete(id); return undefined; }
  return rec;
}

// Every endpoint calls this first. It fails closed: if ACCESS_CODE is not set on the
// server, all calls are refused, so a public site can never spend your API credit by accident.
export function guard(req: Request, env: Env): Response | null {
  const expected = env.ACCESS_CODE;
  if (!expected) return json({ error: "The server has no ACCESS_CODE set." }, 500);
  const id = clientOf(req), now = Date.now();
  if (id && (recentFails(id, now)?.n ?? 0) >= MAX_FAILS) return json({ error: "Too many wrong access codes. Wait about 10 minutes and try again." }, 429);
  if (!same(req.headers.get("x-access-code") ?? "", expected)) {
    if (id) {
      if (fails.size > 1000) for (const [k, v] of fails) if (now - v.first > WINDOW_MS) fails.delete(k); // keep the table small
      const rec = recentFails(id, now);
      fails.set(id, { n: (rec?.n ?? 0) + 1, first: rec?.first ?? now });
    }
    return json({ error: "Wrong or missing access code." }, 401);
  }
  if (id) fails.delete(id);
  return null;
}
