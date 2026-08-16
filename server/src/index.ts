import fs from "node:fs";
import http from "node:http";
import { config } from "./config.js";
import { createApp } from "./server.js";
import { attachWebSocketServer } from "./ws/ws.server.js";
import { loadSessions } from "./auth/session.js";
import { reconcileMemoryIndex } from "./emmy/emmy-memory.js";
import { sharedCredentialsFile } from "./pty/claude-home.js";

// Defense in depth: Express 4 does not catch a rejected promise thrown by an
// async route handler on its own — without this, one unexpected rejection
// (a flaky PM2 call, a transient fs error, anything not wrapped in its own
// try/catch) would otherwise crash this entire process for every project
// and every open terminal, not just fail the one request that triggered it.
// Route handlers should still catch their own expected failure modes and
// return a proper error response; this is only the last-resort net.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

await loadSessions();

// Best-effort, not awaited: backfills Emmy's memory index for any message
// (live or archived) that predates this feature or was sent while Ollama was
// unreachable. Never blocks server startup and can never take the process down.
void reconcileMemoryIndex();

const app = createApp();
const server = http.createServer(app);
attachWebSocketServer(server);

server.listen(config.PORT, config.BIND_ADDRESS, () => {
  console.log(`Overlay server listening on http://${config.BIND_ADDRESS}:${config.PORT} (${config.NODE_ENV})`);
  // Loud on every start, because the one way this flag turns dangerous is
  // being forgotten: it is only safe while an auth proxy really is in front.
  if (config.AUTH_DISABLED) {
    console.warn(
      "[auth] AUTH_DISABLED=1 — Overlay's own login is OFF. Every route is unauthenticated unless a proxy (Authelia) enforces auth in front of this process.",
    );
  }
  // Loud on every start, because this is otherwise a silent failure: without
  // it, ensureProjectClaudeHome() just skips the credentials symlink (see
  // pty/claude-home.ts's linkCredentials) and every project terminal quietly
  // falls back to prompting for /login instead of sharing the one account.
  if (!fs.existsSync(sharedCredentialsFile())) {
    console.warn(
      `[claude-home] No Claude Code credentials found at ${sharedCredentialsFile()} — every project terminal will prompt for /login instead of sharing one account. ` +
        (config.CLAUDE_SHARED_HOME
          ? "CLAUDE_SHARED_HOME is set, but nothing is logged in at that path yet — run `claude login` as the user who owns it."
          : "CLAUDE_SHARED_HOME is unset, so this fell back to this process's own home dir — set it to the .claude directory of whichever user ran `claude login` (see docs/DEPLOYMENT.md)."),
    );
  }
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
