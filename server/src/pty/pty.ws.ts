import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { PtyClientMessage, PtyServerMessage } from "@overlay/shared";
import { getProject } from "../projects/projects.registry.js";
import { getOrCreateSession } from "./pty.manager.js";
import { getOrCreateHostSession } from "./host-terminal.manager.js";
import type { PtySession } from "./pty.session.js";

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function handlePtyConnection(ws: WebSocket, projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    ws.close(4404, "project_not_found");
    return;
  }

  // getOrCreateSession throws synchronously when the sandbox is required but
  // bwrap is missing (see sandbox.ts). Since this function is async and its
  // caller does `void handlePtyConnection(...)`, an uncaught throw here would
  // become a silent unhandled rejection — logged server-side only, with the
  // browser left connecting forever. Surface it as terminal output instead,
  // the one place this connection can still put something in front of the user.
  let session: PtySession;
  try {
    session = getOrCreateSession(project);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (ws.readyState === ws.OPEN) {
      const chunk: PtyServerMessage = { type: "data", chunk: `\r\n${message}\r\n` };
      ws.send(JSON.stringify(chunk));
    }
    ws.close(4500, "session_start_failed");
    return;
  }
  attachPtySession(ws, session);
}

/**
 * The host terminal has no owning project to look up and no sandbox to fail
 * to build — getOrCreateHostSession() spawns a plain shell, so unlike
 * handlePtyConnection above there is nothing here that can throw.
 */
export function handleHostPtyConnection(ws: WebSocket): void {
  attachPtySession(ws, getOrCreateHostSession());
}

function attachPtySession(ws: WebSocket, session: PtySession): void {
  // Identifies this one browser tab for the duration of the connection, so
  // its viewport can be dropped from the session's size arbitration when it
  // goes away (see PtySession.setClientSize).
  const clientId = randomUUID();

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
      case "paste":
        // No auto-submit: see PtySession.paste's doc comment on why
        // interactive human paste must leave pressing Enter to the user.
        session.paste(msg.data, false);
        break;
      case "resize":
        session.setClientSize(clientId, msg.cols, msg.rows);
        break;
      case "pong":
        break;
    }
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    unsubData();
    unsubExit();
    // Give the remaining clients their size back — without this the pty stays
    // stuck at the smallest viewport that was ever attached.
    session.removeClient(clientId);
    // Intentionally do NOT kill the pty session here — it stays alive so the
    // Claude Code session survives the iPad app being backgrounded/reopened.
  });
}
