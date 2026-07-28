import type { WebSocket } from "ws";
import type { PtyClientMessage, PtyServerMessage } from "@overlay/shared";
import { getProject } from "../projects/projects.registry.js";
import { getOrCreateSession } from "./pty.manager.js";

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function handlePtyConnection(ws: WebSocket, projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    ws.close(4404, "project_not_found");
    return;
  }

  const session = getOrCreateSession(project);

  const send = (msg: PtyServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  // Replay scrollback so a newly attached client (including reconnects after the
  // iPad app was backgrounded) repaints the terminal correctly before going live.
  const scrollback = session.getScrollback();
  if (scrollback) send({ type: "data", chunk: scrollback });

  const unsubData = session.onData((chunk) => send({ type: "data", chunk }));
  const unsubExit = session.onExit((code) => send({ type: "exit", code }));

  const heartbeat = setInterval(() => send({ type: "ping" }), HEARTBEAT_INTERVAL_MS);

  ws.on("message", (raw) => {
    let msg: PtyClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case "input":
        session.write(msg.data);
        break;
      case "resize":
        session.resize(msg.cols, msg.rows);
        break;
      case "pong":
        break;
    }
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    unsubData();
    unsubExit();
    // Intentionally do NOT kill the pty session here — it stays alive so the
    // Claude Code session survives the iPad app being backgrounded/reopened.
  });
}
