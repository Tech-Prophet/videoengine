import { stock } from "../../server/stock.ts";

// Cloudflare Pages entry point (served at /api/stock). The logic lives in server/stock.ts.
export const onRequest = (ctx: { request: Request; env: Record<string, string | undefined> }) => stock(ctx.request, ctx.env);
