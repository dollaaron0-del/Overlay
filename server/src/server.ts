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
import { ideaChatRouter, ideaChatAttachmentsRouter } from "./ideachat/ideachat.routes.js";
import { obsidianRouter } from "./obsidian/obsidian.routes.js";
import { automationRouter } from "./automation/automation.routes.js";
import { requireAutomationToken } from "./automation/automation.middleware.js";
import { emmyRouter, emmySendRouter } from "./emmy/emmy.routes.js";
import { emmyInboundRouter } from "./emmy/emmy-inbound.routes.js";
import { requireEmmyInboundToken } from "./emmy/emmy-inbound.middleware.js";
import { agentDecisionsRouter } from "./agent-decisions/agent-decisions.routes.js";
import { agentDecisionsInboundRouter } from "./agent-decisions/agent-decisions-inbound.routes.js";
import { apiRateLimiter } from "./rate-limit.js";

// Quick-capture photos arrive as base64 JSON (~33% larger than the raw
// file) — comfortably covers a real phone photo without raising the body
// limit for every other endpoint.
const QUICK_CAPTURE_BODY_LIMIT = "15mb";

// Idea-chat attachments (documents/photos) are also base64 JSON, and a
// request can carry several files at once — same reasoning as quick-capture
// above, just a bit more headroom for multi-file uploads.
const IDEA_CHAT_ATTACHMENT_BODY_LIMIT = "40mb";

// Emmy chat attachments (any file type, up to 25mb each, up to 10 per send) —
// base64 JSON, same reasoning as the two limits above.
const EMMY_ATTACHMENT_BODY_LIMIT = "60mb";

// Emmy's reply text can run up to 300,000 chars (emmy-inbound.routes.ts's
// schema) for a full research report — comfortably under this so the JSON
// body parser never rejects a long report before Zod even sees it.
const EMMY_INBOUND_BODY_LIMIT = "2mb";

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

  // Must be registered (and consume the request body) before the
  // default-limit express.json() below — see the quick-capture mount above
  // for why. Non-attachment idea-chat requests hitting this prefix (e.g.
  // POST /messages) simply fall through unmatched to the protectedApi mount
  // further down, body already parsed.
  app.use("/api/idea-chats", express.json({ limit: IDEA_CHAT_ATTACHMENT_BODY_LIMIT }), requireAuth, ideaChatAttachmentsRouter);

  // Emmy chat message-send + attachment download. Mounted at the "/chats"
  // subpath (not the "/api/emmy" prefix) so its session-auth middleware can't
  // shadow the token-gated "/api/emmy/inbound" callback mounted below. Own
  // larger body limit for attachments, before the default express.json — same
  // reasoning as the idea-chats mount above; unmatched requests (e.g. GET
  // /chats or CRUD) fall through to the protectedApi emmyRouter mount.
  app.use("/api/emmy/chats", express.json({ limit: EMMY_ATTACHMENT_BODY_LIMIT }), requireAuth, emmySendRouter);

  // Same reasoning as the emmy/chats mount above (must consume the body
  // before the default-limit express.json() below) — OpenClaw calling in to
  // deliver Emmy's reply has no browser session, so it authenticates with
  // its own Bearer token (EMMY_INBOUND_TOKEN) instead of a session cookie.
  // Mounted at the exact "/api/emmy/inbound" path (not the "/api/emmy"
  // prefix) so this token-gated middleware can't shadow the session-
  // authenticated "/api/emmy/messages" routes mounted below under protectedApi.
  app.use(
    "/api/emmy/inbound",
    express.json({ limit: EMMY_INBOUND_BODY_LIMIT }),
    requireEmmyInboundToken,
    emmyInboundRouter,
  );

  // Same trust boundary and token as the emmy inbound mount above — an agent
  // process reporting a decision has no browser session either. Own body
  // limit for headroom on the reasoning field (up to 20,000 chars, see
  // agent-decisions-inbound.routes.ts's schema).
  app.use(
    "/api/agent-decisions/inbound",
    express.json({ limit: "512kb" }),
    requireEmmyInboundToken,
    agentDecisionsInboundRouter,
  );

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
  protectedApi.use("/emmy", emmyRouter);
  protectedApi.use("/agent-decisions", agentDecisionsRouter);
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
