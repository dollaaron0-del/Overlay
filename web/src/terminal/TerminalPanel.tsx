import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useTerminalSocket } from "./useTerminalSocket";

const STATUS_LABEL = {
  connecting: "Verbinde…",
  connected: "Verbunden",
  reconnecting: "Verbindung wird wiederhergestellt…",
};

export function TerminalPanel({ projectId }: { projectId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      theme: { background: "#0b0e14" },
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();
    setTerminal(term);

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      setTerminal(null);
    };
    // projectId change remounts a fresh terminal instance (below via key prop),
    // so this effect intentionally only runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = useTerminalSocket(projectId, terminal);

  return (
    <div className="terminal-panel-wrapper">
      <div className="terminal-status-bar">
        <span className={`connection-dot connection-${status}`} />
        {STATUS_LABEL[status]}
      </div>
      <div className="terminal-panel" ref={containerRef} />
    </div>
  );
}
