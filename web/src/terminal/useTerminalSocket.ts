import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { PtyClientMessage, PtyServerMessage } from "@overlay/shared";
import { ReconnectingSocket, wsUrl } from "../api/ws";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

/**
 * Binds an xterm.js Terminal instance to a project's pty WebSocket. The
 * backend keeps the Claude CLI session alive independent of this connection,
 * so a reconnect (e.g. after the iPad PWA was backgrounded) just resumes:
 * the server replays its scrollback buffer on attach, and ReconnectingSocket
 * already re-establishes on visibilitychange/pageshow.
 */
export function useTerminalSocket(projectId: string | null, terminal: Terminal | null): ConnectionStatus {
  const socketRef = useRef<ReconnectingSocket<PtyServerMessage, PtyClientMessage> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    if (!projectId || !terminal) return;

    setStatus("connecting");
    const socket = new ReconnectingSocket<PtyServerMessage, PtyClientMessage>(wsUrl(`/ws/pty/${projectId}`));
    socketRef.current = socket;

    const unsubscribe = socket.onMessage((msg) => {
      if (msg.type === "data") terminal.write(msg.chunk);
      else if (msg.type === "ping") socket.send({ type: "pong" });
      else if (msg.type === "exit") terminal.write(`\r\n[Prozess beendet, Code ${msg.code}]\r\n`);
    });
    const unsubOpen = socket.onOpen(() => setStatus("connected"));
    const unsubClose = socket.onClose(() => setStatus("reconnecting"));

    const dataDisposable = terminal.onData((data) => socket.send({ type: "input", data }));
    const resizeDisposable = terminal.onResize(({ cols, rows }) => socket.send({ type: "resize", cols, rows }));

    return () => {
      unsubscribe();
      unsubOpen();
      unsubClose();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      socket.close();
      socketRef.current = null;
    };
  }, [projectId, terminal]);

  return status;
}
