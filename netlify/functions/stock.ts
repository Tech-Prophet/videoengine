import { stock } from "../../server/stock.ts";

// Netlify entry point. The logic lives in server/stock.ts so other hosts can share it.
export default (req: Request) => stock(req, process.env);

export const config = { path: "/api/stock" };
