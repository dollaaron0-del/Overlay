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
    const unsubOpen = socket.onOpen(() => {
      setStatus("connected");
      // Report the grid we already have, rather than waiting for an onResize
      // that will never come. TerminalPanel fits the terminal to its
      // container immediately after open(), which is before this hook can
      // subscribe below — that first fit is what establishes the real size,
      // and its event is gone by now. Every later fit computes the same
      // numbers and FitAddon skips the resize entirely when nothing changed,
      // so no further event is emitted either. Without this the pty kept the
      // 80x24 it was spawned with while xterm rendered a much larger grid,
      // and full-screen programs drew into the top-left corner of it.
      // Sending on every (re)connect also re-asserts the size after a
      // reconnect, where the server may have resized for another client.
      socket.send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
    });
    const unsubClose = socket.onClose(() => setStatus("reconnecting"));

    const dataDisposable = terminal.onData((data) => socket.send({ type: "input", data }));
    const resizeDisposable = terminal.onResize(({ cols, rows }) => socket.send({ type: "resize", cols, rows }));

    // The pty follows whichever client reported last (see PtySession), so
    // coming back to a tab has to re-assert its grid: otherwise a second
    // device that was opened in between keeps the pty at its size and this
    // one silently renders into a mismatched grid.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        socket.send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
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
