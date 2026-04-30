import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expensesRouter } from "./routes/expenses.js";

export function buildApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", expensesRouter);

  // In single-process deployments (Render, local) we also serve the built
  // React app. On Vercel the static files are served by the CDN directly,
  // and this dist directory isn't bundled into the serverless function — so
  // the existsSync check just no-ops and Vercel handles the SPA itself.
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(here, "../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(resolve(webDist, "index.html"));
    });
  }

  // Final error handler — keep responses JSON so the client can render them.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("unhandled_error", err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
