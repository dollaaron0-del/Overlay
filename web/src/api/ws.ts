type Listener<T> = (msg: T) => void;

/**
 * A reconnecting WebSocket wrapper. Handles exponential backoff and treats
 * page foreground events (visibilitychange/pageshow) as "the socket may be
 * dead" — important on iOS, which suspends background WebSockets aggressively
 * when a PWA is backgrounded, so a stale connection must be detected and
 * replaced quickly on return rather than silently doing nothing.
 */
export class ReconnectingSocket<TServerMsg, TClientMsg> {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private backoffMs = 500;
  private readonly maxBackoffMs = 5000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<Listener<TServerMsg>>();
  private readonly openListeners = new Set<() => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(private readonly url: string) {
    this.connect();
    document.addEventListener("visibilitychange", this.handleVisible);
    window.addEventListener("pageshow", this.handleVisible);
  }

  private handleVisible = () => {
    if (document.visibilityState !== "visible") return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.connect();
    }
  };

  private connect(): void {
    if (this.closedByUser) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // handleVisible can force a fresh connect() while a stale socket (e.g.
    // suspended by iOS backgrounding) is still open/connecting — close it so
    // its belated 'close' event doesn't fire a second, redundant reconnect
    // on top of the new socket below.
    this.ws?.close();

    const ws = new WebSocket(this.url);
    this.ws = ws;

    // Each listener below is scoped to the socket it was registered on, so a
    // stale/superseded socket's late-firing events (once `this.ws` has moved
    // on to a newer one) are ignored instead of corrupting the newer
    // connection's state or double-scheduling a reconnect.
    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this.backoffMs = 500;
      for (const l of this.openListeners) l();
    });

    ws.addEventListener("message", (event) => {
      if (this.ws !== ws) return;
      try {
        const msg = JSON.parse(event.data) as TServerMsg;
        for (const l of this.listeners) l(msg);
      } catch {
        // ignore malformed frames
      }
    });

    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      for (const l of this.closeListeners) l();
      if (this.closedByUser) return;
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }

  send(msg: TClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(listener: Listener<TServerMsg>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onOpen(listener: () => void): () => void {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    this.closedByUser = true;
    document.removeEventListener("visibilitychange", this.handleVisible);
    window.removeEventListener("pageshow", this.handleVisible);
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }
}

export function wsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}
