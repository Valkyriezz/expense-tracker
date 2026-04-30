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

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", expensesRouter);

  // In production we serve the built React app from ../web/dist.
  const here = dirname(fileURLToPath(import.meta.url));
  // In dev (tsx) `here` is server/src; in prod (built) it's server/dist.
  // Both are one parent + one sibling away from web/dist.
  const webDist = resolve(here, "../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api|\/health).*/, (_req, res) => {
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
