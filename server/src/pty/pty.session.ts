import * as pty from "node-pty";
import type { IPty } from "node-pty";

const SCROLLBACK_MAX_CHARS = 1_000_000; // ~1MB of terminal output
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

export class PtySession {
  readonly proc: IPty;
  private scrollback = "";
  private readonly subscribers = new Set<(chunk: string) => void>();
  private readonly exitSubscribers = new Set<(code: number, signal?: number) => void>();
  private exited = false;
  /** Viewport last reported by each attached client, keyed by connection. */
  private readonly clientSizes = new Map<string, { cols: number; rows: number }>();
  private cols = INITIAL_COLS;
  private rows = INITIAL_ROWS;

  constructor(command: string, args: string[], cwd: string) {
    this.proc = pty.spawn(command, args, {
      name: "xterm-256color",
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      cwd,
      env: process.env as Record<string, string>,
    });

    this.proc.onData((chunk) => {
      this.scrollback += chunk;
      if (this.scrollback.length > SCROLLBACK_MAX_CHARS) {
        this.scrollback = this.scrollback.slice(-SCROLLBACK_MAX_CHARS);
      }
      for (const sub of this.subscribers) sub(chunk);
    });

    this.proc.onExit(({ exitCode, signal }) => {
      this.exited = true;
      for (const sub of this.exitSubscribers) sub(exitCode, signal);
    });
  }

  get isAlive(): boolean {
    return !this.exited;
  }

  write(data: string): void {
    if (!this.exited) this.proc.write(data);
  }

  /**
   * Records one client's viewport and resizes the pty to the smallest one
   * currently attached.
   *
   * A pty has exactly one size, but several clients can be attached to the
   * same session (iPad and desktop on the same project). Applying each
   * client's size directly meant the last one to report won: opening a
   * project on the iPad shrank the desktop terminal to the iPad's grid, so
   * the TUI redrew into the top-left corner of a much larger window — and
   * because nothing recomputed on disconnect, it stayed that way even after
   * the iPad was gone.
   *
   * Smallest-wins is what tmux does with several attached clients, and it is
   * the only choice where the output fits on every screen showing it. The
   * part that actually fixes the reported bug is that this is recomputed when
   * a client leaves, so closing the iPad gives the desktop its full size back.
   */
  setClientSize(clientId: string, cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    this.clientSizes.set(clientId, { cols, rows });
    this.applySmallestClientSize();
  }

  /** Drops a disconnected client's viewport and re-expands to the remaining ones. */
  removeClient(clientId: string): void {
    if (this.clientSizes.delete(clientId)) this.applySmallestClientSize();
  }

  private applySmallestClientSize(): void {
    // With no client attached there is nothing meaningful to shrink to, so
    // the last agreed size is kept until someone attaches again.
    if (this.exited || this.clientSizes.size === 0) return;

    let cols = Infinity;
    let rows = Infinity;
    for (const size of this.clientSizes.values()) {
      cols = Math.min(cols, size.cols);
      rows = Math.min(rows, size.rows);
    }
    if (cols === this.cols && rows === this.rows) return;

    this.cols = cols;
    this.rows = rows;
    this.proc.resize(cols, rows);
  }

  /** Current pty grid, i.e. the smallest attached client. Exposed for tests. */
  get size(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  /** Returns the current scrollback so a newly attached client can repaint the terminal. */
  getScrollback(): string {
    return this.scrollback;
  }

  onData(listener: (chunk: string) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  onExit(listener: (code: number, signal?: number) => void): () => void {
    this.exitSubscribers.add(listener);
    return () => this.exitSubscribers.delete(listener);
  }

  kill(): void {
    if (!this.exited) this.proc.kill();
  }
}
