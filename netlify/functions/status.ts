import { status } from "../../server/status.ts";

// Netlify entry point. The logic lives in server/status.ts so other hosts can share it.
export default (req: Request) => status(req, process.env);

export const config = { path: "/api/status" };
