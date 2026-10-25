import { timingSafeEqual } from "node:crypto";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Every function calls this first. It fails closed: if ACCESS_CODE is not set on the
// server, all calls are refused, so a public site can never spend your API credit by accident.
export function guard(req: Request): Response | null {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return json({ error: "The server has no ACCESS_CODE set." }, 500);
  if (!same(req.headers.get("x-access-code") ?? "", expected)) return json({ error: "Wrong or missing access code." }, 401);
  return null;
}
