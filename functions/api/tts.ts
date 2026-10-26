import { tts } from "../../server/tts.ts";

// Cloudflare Pages entry point (served at /api/tts). The logic lives in server/tts.ts.
export const onRequest = (ctx: { request: Request; env: Record<string, string | undefined> }) => tts(ctx.request, ctx.env);
