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
import { securityRouter } from "./security/security.routes.js";
import { backupRouter } from "./backup/backup.routes.js";
import { systemRouter } from "./system.routes.js";
import { auditRouter } from "./audit/audit.routes.js";
import { quickCaptureRouter } from "./quickcapture/quickcapture.routes.js";
import { ideaChatRouter } from "./ideachat/ideachat.routes.js";
import { obsidianRouter } from "./obsidian/obsidian.routes.js";
import { automationRouter } from "./automation/automation.routes.js";
import { requireAutomationToken } from "./automation/automation.middleware.js";
import { apiRateLimiter } from "./rate-limit.js";

// Quick-capture photos arrive as base64 JSON (~33% larger than the raw
// file) — comfortably covers a real phone photo without raising the body
// limit for every other endpoint.
const QUICK_CAPTURE_BODY_LIMIT = "15mb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  // Caddy terminates TLS on the Tailscale interface and proxies to this
  // process over loopback (see deploy/caddy/Caddyfile), so without this every
  // request's req.ip is 127.0.0.1 — which collapses the per-IP login backoff
  // (auth.routes.ts) and the /api rate limiter into one shared bucket: any
  // client hammering /login would lock out the real admin too, and every
  // failed-login audit entry would record "127.0.0.1" instead of where the
  // attempt actually came from. "loopback" trusts only a proxy on 127.0.0.1
  // to set X-Forwarded-For, so a remote client still can't spoof its own IP.
  app.set("trust proxy", "loopback");

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

  app.use("/api", apiRateLimiter);

  // Intentionally unauthenticated (a healthcheck pinger has no session), and
  // intentionally minimal — no version info, no project/process details.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.floor(process.uptime()) });
  });

  // Own, larger body-size limit for quick-capture photos — must be
  // registered (and consume the request body) before the default-limit
  // express.json() below, since only the first body parser a request
  // reaches ever gets to read the stream.
  app.use("/api/quick-capture", express.json({ limit: QUICK_CAPTURE_BODY_LIMIT }), requireAuth, quickCaptureRouter);

  app.use(express.json());
  app.use("/api", authRouter);

  // Token-authenticated, not session-cookie-authenticated — see
  // automation.middleware.ts. Deliberately its own mount, outside
  // protectedApi/requireAuth below.
  app.use("/api/automation", requireAutomationToken, automationRouter);

  const protectedApi = express.Router();
  protectedApi.use(requireAuth);
  protectedApi.use("/projects", projectsRouter);
  protectedApi.use("/projects", pm2Router);
  protectedApi.use("/projects", filesRouter);
  protectedApi.use("/projects", obsidianRouter);
  protectedApi.use("/security", securityRouter);
  protectedApi.use("/backup", backupRouter);
  protectedApi.use("/system", systemRouter);
  protectedApi.use("/audit", auditRouter);
  protectedApi.use("/idea-chats", ideaChatRouter);
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
