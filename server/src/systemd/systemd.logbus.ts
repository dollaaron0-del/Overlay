import { spawn } from "node:child_process";
import readline from "node:readline";
import { runCommand } from "../security/run-tool.js";

const UNIT_PATTERN = /^[a-zA-Z0-9_.-]+\.service$/;
const BACKLOG_TIMEOUT_MS = 5_000;

function assertValidUnit(unit: string): void {
  if (!UNIT_PATTERN.test(unit)) {
    throw new Error(`Refusing to read logs for an invalid systemd unit name: ${unit}`);
  }
}

export interface LogLine {
  stream: "out" | "err";
  text: string;
}

/**
 * Read-only, no sudoers rule needed — but the `overlay` service user does
 * need to be in the `systemd-journal` group on the real server (see
 * docs/DEPLOYMENT.md), otherwise journalctl can only see its own unit's
 * logs. Missing membership fails closed (empty backlog), same as any other
 * best-effort read here.
 */
export async function getBacklog(unit: string, maxLines = 200): Promise<LogLine[]> {
  assertValidUnit(unit);
  const result = await runCommand(
    "journalctl",
    ["-u", unit, "-n", String(maxLines), "--no-pager", "-o", "cat"],
    { timeoutMs: BACKLOG_TIMEOUT_MS },
  ).catch(() => null);
  if (!result || result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((text) => ({ stream: "out" as const, text }));
}

/** One `journalctl -f` child process per subscriber — simpler and safer than a shared/ref-counted bus for a homelab-scale, single-user dashboard. */
export async function subscribeToLogs(unit: string, onLine: (line: LogLine) => void): Promise<() => void> {
  assertValidUnit(unit);
  const child = spawn("journalctl", ["-u", unit, "-n", "0", "-f", "-o", "cat"], { stdio: ["ignore", "pipe", "ignore"] });
  // Without this, a spawn failure (journalctl missing, EACCES, EMFILE) fires
  // an unhandled 'error' event and crashes the whole process — not just this
  // one subscriber.
  child.on("error", (err) => console.error(`[systemd.logbus] Failed to spawn journalctl for unit "${unit}":`, err));
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (text) => onLine({ stream: "out", text }));

  return () => {
    rl.close();
    child.kill();
  };
}
