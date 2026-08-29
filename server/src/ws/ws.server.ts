import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { isAuthenticatedUpgradeRequest } from "../auth/auth.middleware.js";
import { handlePtyConnection, handleHostPtyConnection } from "../pty/pty.ws.js";
import { handleLogsConnection } from "../pm2/pm2.ws.js";
import { handleStatusConnection } from "./status.ws.js";
import { handleBackupProgressConnection } from "../backup/backup.ws.js";
import { handleDeployConnection } from "../projects/deploy.ws.js";
import { handleEmmyConnection } from "../emmy/emmy.ws.js";
import { handleAgentDecisionsConnection } from "../agent-decisions/agent-decisions.ws.js";
import { isAllowedOrigin } from "./origin-check.js";
import { tryProxyUpgrade } from "../programs/programs.proxy.js";

// Returns the underlying WebSocketServer so callers (see index.ts's shutdown)
// can force-close every live connection (terminal/status/logs/…) on
// SIGTERM/SIGINT — otherwise http.Server#close() alone waits forever for
// those long-lived, upgraded sockets to close on their own, since it only
// stops accepting *new* connections.
export function attachWebSocketServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    // Program-dashboard reverse proxy (e.g. Streamlit's websocket under
    // /x/aktien/_stcore/stream) — handled before our own /ws router and its
    // auth check, same as the HTTP proxy mount.
    if (tryProxyUpgrade(req, socket, head)) return;

    if (!isAllowedOrigin(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!isAuthenticatedUpgradeRequest(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const segments = url.pathname.split("/").filter(Boolean); // e.g. ["ws", "pty", "<id>"]

    if (segments[0] !== "ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      // A misbehaving client (e.g. an unmasked frame → WS_ERR_EXPECTED_MASK)
      // makes ws emit 'error' on this socket. Without a listener, Node rethrows
      // it as an uncaughtException and takes the whole process down — which
      // crash-looped Overlay and silently killed any in-flight Emmy turn. Log
      // and drop just this one socket instead. Attached before routing so it
      // covers every endpoint below.
      ws.on("error", (err) => {
        console.error(`[ws] socket error on ${url.pathname}: ${(err as Error).message}`);
      });
      if (segments[1] === "pty" && segments[2]) {
        void handlePtyConnection(ws, segments[2]);
      } else if (segments[1] === "host-terminal") {
        handleHostPtyConnection(ws);
      } else if (segments[1] === "logs" && segments[2]) {
        void handleLogsConnection(ws, segments[2]);
      } else if (segments[1] === "status") {
        handleStatusConnection(ws);
      } else if (segments[1] === "backup-progress") {
        handleBackupProgressConnection(ws);
      } else if (segments[1] === "deploy" && segments[2]) {
        handleDeployConnection(ws, segments[2]);
      } else if (segments[1] === "emmy") {
        handleEmmyConnection(ws);
      } else if (segments[1] === "agent-decisions" && segments[2]) {
        handleAgentDecisionsConnection(ws, segments[2]);
      } else {
        ws.close(4404, "unknown_route");
      }
    });
  });

  return wss;
}
