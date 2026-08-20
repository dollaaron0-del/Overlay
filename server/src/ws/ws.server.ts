import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { isAuthenticatedUpgradeRequest } from "../auth/auth.middleware.js";
import { handlePtyConnection, handleHostPtyConnection } from "../pty/pty.ws.js";
import { handleLogsConnection } from "../pm2/pm2.ws.js";
import { handleStatusConnection } from "./status.ws.js";
import { handleBackupProgressConnection } from "../backup/backup.ws.js";
import { handleDeployConnection } from "../projects/deploy.ws.js";
import { handleEmmyConnection } from "../emmy/emmy.ws.js";
import { isAllowedOrigin } from "./origin-check.js";

export function attachWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
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
      } else {
        ws.close(4404, "unknown_route");
      }
    });
  });
}
