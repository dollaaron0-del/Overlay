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
    const container = containerRef.current;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      theme: { background: "#0b0e14" },
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    // xterm's own internal scroll-area sync can throw ("Cannot read
    // properties of undefined (reading 'dimensions')") if it fires before
    // the renderer has fully initialized — observed in practice right after
    // open(). An uncaught throw here would abort whichever fit() call hit
    // it, which (if it's the very first one) skips every mitigation below
    // it in this effect — fonts.ready/raf/timeout refits, and the
    // ResizeObserver subscription itself — leaving the terminal stuck at
    // its default 80x24 size for the lifetime of the mount, immune to any
    // later resize. Swallow and retry on the next frame instead.
    const safeFit = () => {
      try {
        fitAddon.fit();
      } catch {
        requestAnimationFrame(() => fitAddon.fit());
      }
    };

    // Two selections can be active in this panel: xterm's own cell-grid one
    // (mouse drag on desktop) and the browser's native one (iOS long-press,
    // enabled via the user-select override in index.css). Prefer the native
    // one when it actually lies inside the terminal, so whichever the user
    // sees highlighted is what gets copied.
    const selectedText = () => {
      const selection = window.getSelection();
      const nativeText = selection && !selection.isCollapsed ? selection.toString() : "";
      if (nativeText.trim() && container.contains(selection!.anchorNode)) {
        return nativeText;
      }
      return term.hasSelection() ? term.getSelection() : "";
    };

    // xterm.js otherwise always forwards Ctrl/Cmd+C as SIGINT (0x03) to the
    // pty, even with an active selection, and relies on the browser's native
    // paste event for Ctrl/Cmd+V, which doesn't reliably fire while focus sits
    // in xterm's off-screen helper textarea. Handle both explicitly via the
    // clipboard API so copy doesn't kill the running command and paste works.
    // With no selection at all, Ctrl+C must still fall through as SIGINT.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "c") {
        const text = selectedText();
        if (!text) return true;
        navigator.clipboard.writeText(text).catch(() => {});
        event.preventDefault();
        return false;
      }
      if (mod && event.key.toLowerCase() === "v") {
        navigator.clipboard
          .readText()
          .then((text) => term.paste(text))
          .catch(() => {});
        event.preventDefault();
        return false;
      }
      return true;
    });

    // The Ctrl/Cmd+C handler above only fires on keydown, so it never runs on
    // mobile: tapping "Kopieren" in iOS's selection callout dispatches a `copy`
    // ClipboardEvent instead, with no keydown involved. WebKit's default
    // handling would copy the native selection correctly on its own, but
    // xterm registers its own `copy` listener on term.element (a descendant of
    // this container) which overwrites clipboardData from its internal
    // selection whenever that one happens to be non-empty. Setting the data
    // again here, on the way up, makes the visible selection win.
    const onCopy = (event: ClipboardEvent) => {
      const text = selectedText();
      if (!text) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
    };
    container.addEventListener("copy", onCopy);

    // The user-select:text override above (for native iOS selection) can stop
    // xterm's own mousedown->focus() chain from firing reliably on a simple
    // tap: WebKit sometimes treats a tap on selectable text as the start of a
    // selection gesture rather than a click, so the hidden helper textarea
    // never gets focus and neither an on-screen nor an external keyboard has
    // anywhere to send keystrokes. Force focus explicitly on touch release,
    // unless the tap actually produced a selection (so tapping to copy
    // doesn't yank focus and pop the on-screen keyboard open).
    const onTouchEnd = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        term.focus();
      }
    };
    container.addEventListener("touchend", onTouchEnd);

    term.open(container);
    safeFit();
    setTerminal(term);

    // fit() right after open() can undersize the grid: the monospace font
    // xterm measures cell size from may still be loading, and the very
    // first layout pass isn't guaranteed final. Re-fit once fonts are
    // actually ready and after the next paint, instead of trusting only
    // the synchronous call above.
    document.fonts?.ready.then(safeFit);
    const raf = requestAnimationFrame(safeFit);

    // iOS Safari finalizes flex layout a beat after mount; the raf/fonts.ready
    // refits can still land before the container has its real height. One more
    // delayed fit removes the "cursor row clipped until you rotate" bug.
    const lateFit = setTimeout(safeFit, 300);

    const resizeObserver = new ResizeObserver(safeFit);
    resizeObserver.observe(container);
    // Covers iOS keyboard show/hide: the container's box size changes via
    // the --app-vh cascade (see useDynamicViewportHeight), which normally
    // reaches this ResizeObserver too, but re-fitting directly off
    // visualViewport as well costs nothing and removes that assumption.
    window.visualViewport?.addEventListener("resize", safeFit);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(lateFit);
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", safeFit);
      container.removeEventListener("copy", onCopy);
      container.removeEventListener("touchend", onTouchEnd);
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
