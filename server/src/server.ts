import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { authRouter } from "./auth/auth.routes.js";
import { requireAuth } from "./auth/auth.middleware.js";
import { projectsRouter } from "./projects/projects.routes.js";
import { pm2Router } from "./pm2/pm2.routes.js";
import { filesRouter } from "./files/files.routes.js";
import { apiRateLimiter } from "./rate-limit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  // Everything served by this app is same-origin (the built SPA + our own
  // API/WS) — a strict, self-only CSP costs nothing here and blocks the
  // classic "inject a <script src=evil.com>" XSS payload outright. style-src
  // keeps 'unsafe-inline' because xterm.js sets inline style attributes for
  // cursor/cell positioning; that's a much lower-value CSP restriction than
  // script-src, so the trade-off is worth it rather than risking broken
  // terminal rendering.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          manifestSrc: ["'self'"],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: "deny" },
    }),
  );

  app.use(express.json());
  app.use("/api", apiRateLimiter);

  // Intentionally unauthenticated (a healthcheck pinger has no session), and
  // intentionally minimal — no version info, no project/process details.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.floor(process.uptime()) });
  });

  app.use("/api", authRouter);

  const protectedApi = express.Router();
  protectedApi.use(requireAuth);
  protectedApi.use("/projects", projectsRouter);
  protectedApi.use("/projects", pm2Router);
  protectedApi.use("/projects", filesRouter);
  app.use("/api", protectedApi);

  if (config.isProduction) {
    const webDist = path.resolve(__dirname, "../../web/dist");
    app.use(express.static(webDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  return app;
}
