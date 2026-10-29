import { tts } from "../../server/tts.ts";

// Netlify entry point. The logic lives in server/tts.ts so other hosts can share it.
export default (req: Request) => tts(req, process.env);

export const config = { path: "/api/tts" };
