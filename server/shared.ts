// Server code shared by every host (Netlify and Cloudflare). It uses only standard Web APIs,
// and reads settings from the `env` object each host hands in, so it does not depend on any one platform.
export type Env = Record<string, string | undefined>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const enc = new TextEncoder();
// Compares without stopping at the first difference, so response timing does not hint at the code.
const same = (a: string, b: string) => {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
};

// Every endpoint calls this first. It fails closed: if ACCESS_CODE is not set on the
// server, all calls are refused, so a public site can never spend your API credit by accident.
export function guard(req: Request, env: Env): Response | null {
  const expected = env.ACCESS_CODE;
  if (!expected) return json({ error: "The server has no ACCESS_CODE set." }, 500);
  if (!same(req.headers.get("x-access-code") ?? "", expected)) return json({ error: "Wrong or missing access code." }, 401);
  return null;
}
