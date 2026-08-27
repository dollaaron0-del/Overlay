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

export function TerminalPanel({ wsPath }: { wsPath: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Populated by useTerminalSocket once its socket is open; see its doc
  // comment for why every interactive paste path below goes through this
  // instead of xterm's own term.paste().
  const sendPasteRef = useRef<(text: string) => void>(() => {});
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [pasteBoxOpen, setPasteBoxOpen] = useState(false);

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

    // navigator.clipboard is only defined in a secure context (HTTPS). If
    // Overlay is reached over plain HTTP (e.g. Tailscale cert not set up
    // yet), writeText is missing entirely and would throw synchronously
    // rather than reject a promise, so callers must not assume it exists.
    // document.execCommand("copy") has no such restriction, so fall back to
    // it via a throwaway off-screen textarea whenever the modern API can't
    // be used or silently fails.
    const execCommandCopy = (text: string) => {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.top = "0";
      helper.style.left = "-9999px";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.focus();
      helper.select();
      try {
        document.execCommand("copy");
      } catch {
        // ignore — nothing more we can do
      }
      document.body.removeChild(helper);
    };
    const writeClipboardText = (text: string) => {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => execCommandCopy(text));
      } else {
        execCommandCopy(text);
      }
    };

    // Shared by the right-click and middle-click paste handlers further
    // down. Unlike writeClipboardText, there's no execCommand("paste")
    // fallback left in modern browsers for JS-initiated reads — over plain
    // HTTP (a non-secure context) navigator.clipboard is entirely undefined,
    // not just missing readText, so `navigator.clipboard?.readText()` alone
    // would previously short-circuit to undefined and silently do nothing
    // with no feedback at all. Open the manual paste box instead, which
    // needs no permission or secure context — pasting into a real, visible
    // textarea always works. Delivered via sendPasteRef, not term.paste():
    // see useTerminalSocket's doc comment on why that goes through a
    // dedicated "paste" message instead of xterm's own bracketed-paste
    // handling.
    const pasteFromClipboard = () => {
      if (typeof navigator.clipboard?.readText !== "function") {
        setPasteBoxOpen(true);
        return;
      }
      navigator.clipboard.readText().then(
        (text) => sendPasteRef.current(text),
        () => setPasteBoxOpen(true),
      );
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
        writeClipboardText(text);
        event.preventDefault();
        return false;
      }
      if (mod && event.key.toLowerCase() === "v") {
        // navigator.clipboard.readText requires the page to hold the
        // "clipboard-read" permission, which Firefox doesn't grant to
        // ordinary pages at all and which a user can block in Chrome (unlike
        // clipboard-write, there's no execCommand("paste") fallback left in
        // modern browsers — it was removed for security). Preempting the key
        // here would silently eat every Ctrl/Cmd+V forever in that case,
        // repasting whatever was already on the line instead of the newly
        // copied text. Bail out and let the browser's native paste event
        // (see onPaste below, and xterm's own internal paste handler on its
        // helper textarea) carry it instead — that path needs no permission
        // at all, though it isn't fully reliable either in practice, which
        // is what the visible "Einfügen" button (pasteBoxOpen) is for.
        if (typeof navigator.clipboard?.readText !== "function") return true;
        pasteFromClipboard();
        event.preventDefault();
        return false;
      }
      return true;
    });

    // Programs running inside the pty (e.g. the claude CLI's own "copy this
    // login link" prompt) can ask the terminal to put text on the system
    // clipboard via the OSC 52 escape sequence (`OSC 52 ; c ; <base64> ST`)
    // instead of relying on the browser's own copy/paste. xterm.js parses
    // the sequence but has no built-in handler for it, so without this it's
    // silently dropped — the CLI shows its own "copied" confirmation while
    // nothing actually reaches the clipboard.
    const oscClipboardHandler = term.parser.registerOscHandler(52, (data) => {
      const [, payload] = data.split(";");
      if (!payload || payload === "?") return true;
      try {
        const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
        writeClipboardText(new TextDecoder().decode(bytes));
      } catch {
        // malformed payload — nothing to copy
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

    // Fallback for the Ctrl/Cmd+V case above where navigator.clipboard.readText
    // isn't usable: a real paste ClipboardEvent carries clipboardData without
    // needing any Clipboard API permission. Skip it whenever the keydown
    // handler already served the paste via readText, so text isn't inserted
    // twice.
    const onPaste = (event: ClipboardEvent) => {
      if (typeof navigator.clipboard?.readText === "function") return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      sendPasteRef.current(text);
    };
    container.addEventListener("paste", onPaste);

    // The terminal surface xterm renders into is a grid of <span>s, not a
    // real text input, so the browser never offers a working native "Paste"
    // on right-click there and middle-click (the Linux primary-selection
    // paste gesture) is silently swallowed the same way — both only do
    // anything over an actually-focused editable element. Handle them
    // ourselves via the Clipboard API instead. This still needs a secure
    // context (HTTPS) to work, same constraint as pasteFromClipboard above;
    // there is no ClipboardEvent to fall back to here since neither gesture
    // is a real browser paste action on this element.
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const text = selectedText();
      if (text) {
        writeClipboardText(text);
        term.clearSelection();
        window.getSelection()?.removeAllRanges();
      } else {
        pasteFromClipboard();
      }
    };
    container.addEventListener("contextmenu", onContextMenu);

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      pasteFromClipboard();
    };
    container.addEventListener("mousedown", onMouseDown);

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
      oscClipboardHandler.dispose();
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", safeFit);
      container.removeEventListener("copy", onCopy);
      container.removeEventListener("paste", onPaste);
      container.removeEventListener("contextmenu", onContextMenu);
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("touchend", onTouchEnd);
      term.dispose();
      setTerminal(null);
    };
    // wsPath change remounts a fresh terminal instance (via a `key` prop on
    // the caller's side), so this effect intentionally only runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = useTerminalSocket(wsPath, terminal, sendPasteRef);

  // Autofocus the moment the box opens so the very next keystroke (or a
  // right-click "Paste" on a real, visible textarea) lands there — this is
  // the guaranteed-to-work escape hatch for browsers/contexts where neither
  // the Clipboard API nor xterm's own native-paste-event handling on its
  // off-screen helper textarea comes through (see pasteFromClipboard above).
  useEffect(() => {
    if (pasteBoxOpen) pasteTextareaRef.current?.focus();
  }, [pasteBoxOpen]);

  const submitPasteBox = () => {
    const text = pasteTextareaRef.current?.value;
    if (text) sendPasteRef.current(text);
    setPasteBoxOpen(false);
    terminal?.focus();
  };

  const cancelPasteBox = () => {
    setPasteBoxOpen(false);
    terminal?.focus();
  };

  return (
    <div className="terminal-panel-wrapper">
      <div className="terminal-status-bar">
        <span className={`connection-dot connection-${status}`} />
        {STATUS_LABEL[status]}
        <button type="button" className="terminal-paste-button" onClick={() => setPasteBoxOpen(true)}>
          Einfügen
        </button>
      </div>
      <div className="terminal-panel" ref={containerRef} />
      {pasteBoxOpen && (
        <div className="terminal-paste-box-backdrop" onClick={cancelPasteBox}>
          <div className="terminal-paste-box" onClick={(e) => e.stopPropagation()}>
            <p>Text hier einfügen (Strg/Cmd+V oder Rechtsklick → Einfügen) und Enter drücken:</p>
            <textarea
              ref={pasteTextareaRef}
              rows={4}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitPasteBox();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelPasteBox();
                }
              }}
            />
            <div className="terminal-paste-box-actions">
              <button type="button" onClick={submitPasteBox}>
                Einfügen
              </button>
              <button type="button" onClick={cancelPasteBox}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
