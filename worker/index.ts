import { status } from "../server/status.ts";
import { stock } from "../server/stock.ts";
import { tts } from "../server/tts.ts";

// Cloudflare Workers entry point. The built app (dist/) is served as static files by Cloudflare itself;
// only /api/* requests reach this code (see run_worker_first in wrangler.jsonc). The logic lives in server/ and is shared with Netlify.
type Assets = { fetch(req: Request): Promise<Response> };
type WorkerEnv = Record<string, unknown> & { ASSETS?: Assets };

const strings = (env: WorkerEnv) => Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as Record<string, string>;

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    const vars = strings(env);
    if (path === "/api/status") return status(request, vars);
    if (path === "/api/tts") return tts(request, vars);
    if (path === "/api/stock") return stock(request, vars);
    if (path.startsWith("/api/")) return new Response(JSON.stringify({ error: "Unknown endpoint." }), { status: 404, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
  },
};
