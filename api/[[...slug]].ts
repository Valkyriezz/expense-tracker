// Vercel serverless entry. The repo's Express app is built once during
// `npm run build` and reused here. Vercel routes every request matching
// `/api/*` to this catch-all function; static files (web/dist) are served
// directly by Vercel's CDN, not by Express.
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "../server/dist/app.js";

const app = buildApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // Express's request handler signature is compatible with raw Node http,
  // and Vercel's request/response are extensions of those.
  return (app as unknown as (
    req: IncomingMessage,
    res: ServerResponse,
  ) => void)(req, res);
}
