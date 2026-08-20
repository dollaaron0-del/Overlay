import { spawn } from "node:child_process";
import readline from "node:readline";
import { runCommand } from "../security/run-tool.js";

const NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const BACKLOG_TIMEOUT_MS = 10_000;

function assertValidName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Refusing to read logs for an invalid pm2-root process name: ${name}`);
  }
}

export interface LogLine {
  stream: "out" | "err";
  text: string;
}

/**
 * Unlike the systemd-kind logbus, this needs the *same* sudoers rule as
 * pm2RootAction — root's PM2 log files live under /root/.pm2/logs, which the
 * Overlay service user has no read access to, so even the backlog is a
 * privileged read here.
 */
export async function getBacklog(name: string, maxLines = 200): Promise<LogLine[]> {
  assertValidName(name);
  const result = await runCommand(
    "sudo",
    ["/usr/bin/pm2", "logs", name, "--lines", String(maxLines), "--nostream", "--raw"],
    { timeoutMs: BACKLOG_TIMEOUT_MS },
  ).catch(() => null);
  if (!result || result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((text) => ({ stream: "out" as const, text }));
}

/** One `sudo pm2 logs -f`-equivalent child process per subscriber — same reasoning as systemd.logbus.ts. */
export function subscribeToLogs(name: string, onLine: (line: LogLine) => void): () => void {
  assertValidName(name);
  // --lines 0 skips pm2's own historical backlog on stream start, since
  // getBacklog above already covers that — avoids duplicate lines.
  const child = spawn("sudo", ["/usr/bin/pm2", "logs", name, "--raw", "--lines", "0"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  // Without this, a spawn failure (sudo missing, EACCES, EMFILE) fires an
  // unhandled 'error' event and crashes the whole process — not just this
  // one subscriber.
  child.on("error", (err) => console.error(`[pm2root.logbus] Failed to spawn sudo pm2 logs for "${name}":`, err));
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (text) => onLine({ stream: "out", text }));

  return () => {
    rl.close();
    child.kill();
  };
}
