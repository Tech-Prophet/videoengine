import { status } from "../../server/status.ts";

// Cloudflare Pages entry point (served at /api/status). The logic lives in server/status.ts.
export const onRequest = (ctx: { request: Request; env: Record<string, string | undefined> }) => status(ctx.request, ctx.env);
