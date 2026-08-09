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

  constructor(command: string, args: string[], cwd: string, env: Record<string, string> = {}) {
    this.proc = pty.spawn(command, args, {
      name: "xterm-256color",
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      cwd,
      env: { ...(process.env as Record<string, string>), ...env },
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
   * Records one client's viewport and sizes the pty to the most recently
   * active one.
   *
   * A pty has exactly one size, but several clients can attach to the same
   * project session (iPad and desktop). Two approaches were tried before this
   * one, and both are worth remembering:
   *
   * Applying each incoming size directly, with no bookkeeping, meant a
   * disconnecting client left its size behind forever — open a project once
   * on the iPad and the desktop terminal stayed shrunk indefinitely.
   *
   * Taking the smallest of all attached clients (what tmux does) fixed that
   * but was wrong for how this app is actually used: the devices here are
   * rarely watched at the same time, one just sits in a background tab. A
   * portrait iPad left open then capped the desktop's columns at its own
   * while the rows still came from the desktop, so the output filled the full
   * height but only part of the width.
   *
   * Most-recently-active wins instead. Clients re-report their size whenever
   * they become visible (see useTerminalSocket), so the device actually being
   * looked at is the one that decides, and a background tab stops mattering
   * until it is brought forward again.
   */
  setClientSize(clientId: string, cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    // Re-inserting moves this client to the end: Map iterates in insertion
    // order, so "last entry" is the same as "most recently reported".
    this.clientSizes.delete(clientId);
    this.clientSizes.set(clientId, { cols, rows });
    this.applyActiveClientSize();
  }

  /** Drops a disconnected client and falls back to whoever reported last. */
  removeClient(clientId: string): void {
    if (this.clientSizes.delete(clientId)) this.applyActiveClientSize();
  }

  private applyActiveClientSize(): void {
    // With no client attached there is nothing to resize to, so the last
    // agreed size is kept until someone attaches again.
    if (this.exited || this.clientSizes.size === 0) return;

    let active: { cols: number; rows: number } | undefined;
    for (const size of this.clientSizes.values()) active = size;
    if (!active || (active.cols === this.cols && active.rows === this.rows)) return;

    this.cols = active.cols;
    this.rows = active.rows;
    this.proc.resize(active.cols, active.rows);
  }

  /** Current pty grid, i.e. the most recently active client. Exposed for tests. */
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
