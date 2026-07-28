import * as pty from "node-pty";
import type { IPty } from "node-pty";

const SCROLLBACK_MAX_CHARS = 1_000_000; // ~1MB of terminal output

export class PtySession {
  readonly proc: IPty;
  private scrollback = "";
  private readonly subscribers = new Set<(chunk: string) => void>();
  private readonly exitSubscribers = new Set<(code: number, signal?: number) => void>();
  private exited = false;

  constructor(command: string, args: string[], cwd: string) {
    this.proc = pty.spawn(command, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
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

  resize(cols: number, rows: number): void {
    if (!this.exited && cols > 0 && rows > 0) this.proc.resize(cols, rows);
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
