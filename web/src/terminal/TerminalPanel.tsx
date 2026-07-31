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

    // fit() right after open() can undersize the grid: the monospace font
    // xterm measures cell size from may still be loading, and the very
    // first layout pass isn't guaranteed final. Re-fit once fonts are
    // actually ready and after the next paint, instead of trusting only
    // the synchronous call above.
    document.fonts?.ready.then(() => fitAddon.fit());
    const raf = requestAnimationFrame(() => fitAddon.fit());

    // iOS Safari finalizes flex layout a beat after mount; the raf/fonts.ready
    // refits can still land before the container has its real height. One more
    // delayed fit removes the "cursor row clipped until you rotate" bug.
    const lateFit = setTimeout(() => fitAddon.fit(), 300);

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);
    // Covers iOS keyboard show/hide: the container's box size changes via
    // the --app-vh cascade (see useDynamicViewportHeight), which normally
    // reaches this ResizeObserver too, but re-fitting directly off
    // visualViewport as well costs nothing and removes that assumption.
    const onViewportResize = () => fitAddon.fit();
    window.visualViewport?.addEventListener("resize", onViewportResize);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(lateFit);
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", onViewportResize);
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
