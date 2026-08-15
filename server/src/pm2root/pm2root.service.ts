import { runCommand } from "../security/run-tool.js";

// Kept in sync with the same pattern in projects.registry.ts's
// assertValidPm2RootName — checked again here since this is the function
// that actually shells out, and must never trust a name it wasn't the one to
// validate (e.g. a value read straight from projects.json).
const NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

function assertValidName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Refusing to operate on an invalid pm2-root process name: ${name}`);
  }
}

export type Pm2RootStatus = "online" | "stopped" | "errored" | "unknown";

const STATUS_TIMEOUT_MS = 10_000;
const ACTION_TIMEOUT_MS = 20_000;

interface Pm2JlistEntry {
  name?: string;
  pm2_env?: { status?: string };
}

/**
 * `pm2 jlist` only works against the daemon owned by whoever runs it — since
 * this process is owned by *root's* PM2 daemon, reading its status needs
 * sudo just like the mutating actions below (unlike systemd, where
 * `systemctl is-active` needs no privilege). Requires the same sudoers rule
 * as pm2RootAction, see docs/DEPLOYMENT.md.
 */
export async function pm2RootStatus(name: string): Promise<Pm2RootStatus> {
  assertValidName(name);
  const result = await runCommand("sudo", ["/usr/bin/pm2", "jlist"], { timeoutMs: STATUS_TIMEOUT_MS }).catch(
    () => null,
  );
  if (!result || result.exitCode !== 0) return "unknown";

  let list: unknown;
  try {
    list = JSON.parse(result.stdout);
  } catch {
    return "unknown";
  }
  if (!Array.isArray(list)) return "unknown";

  const entry = (list as Pm2JlistEntry[]).find((p) => p?.name === name);
  if (!entry) return "stopped";
  return mapState(entry.pm2_env?.status);
}

function mapState(status: string | undefined): Pm2RootStatus {
  if (status === "online") return "online";
  if (status === "stopped" || status === "stopping") return "stopped";
  if (status === "errored") return "errored";
  return "unknown";
}

/**
 * Mutating actions need root. Overlay never grants that itself — the real
 * server needs a narrow, per-process-name sudoers rule added by hand (same
 * pattern as the systemd-kind projects in server/src/systemd/systemd.service.ts,
 * see docs/DEPLOYMENT.md's "PM2-Prozesse unter fremdem User" section).
 * Without a matching rule this just fails with a clear permission error,
 * surfaced to the Overlay UI like any other failed action — it does not
 * silently no-op.
 */
export async function pm2RootAction(name: string, action: "start" | "stop" | "restart"): Promise<void> {
  assertValidName(name);
  const result = await runCommand("sudo", ["/usr/bin/pm2", action, name], { timeoutMs: ACTION_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    throw new Error(
      `sudo pm2 ${action} ${name} fehlgeschlagen (exit ${result.exitCode}): ${result.stderr.slice(0, 500) || 'siehe docs/DEPLOYMENT.md, Abschnitt "PM2-Prozesse unter fremdem User" (sudoers-Einrichtung)'}`,
    );
  }
}
