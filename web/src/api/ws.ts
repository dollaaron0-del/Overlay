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
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.backoffMs = 500;
      for (const l of this.openListeners) l();
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data) as TServerMsg;
        for (const l of this.listeners) l(msg);
      } catch {
        // ignore malformed frames
      }
    });

    ws.addEventListener("close", () => {
      for (const l of this.closeListeners) l();
      if (this.closedByUser) return;
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
      setTimeout(() => this.connect(), delay);
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
    this.ws?.close();
  }
}

export function wsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}
