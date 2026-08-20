import { runCommand } from "../security/run-tool.js";

// Kept in sync with the same pattern in projects.registry.ts's
// assertValidSystemdUnit — checked again here since this is the function
// that actually shells out, and must never trust a unit name it wasn't the
// one to validate (e.g. a value read straight from projects.json).
const UNIT_PATTERN = /^[a-zA-Z0-9_.-]+\.service$/;

function assertValidUnit(unit: string): void {
  if (!UNIT_PATTERN.test(unit)) {
    throw new Error(`Refusing to operate on an invalid systemd unit name: ${unit}`);
  }
}

export type SystemdStatus = "online" | "stopped" | "errored" | "unknown";

const STATUS_TIMEOUT_MS = 5_000;
const ACTION_TIMEOUT_MS = 15_000;

/**
 * Read-only — `systemctl is-active` needs no privilege for any local user to
 * query another user's unit, unlike start/stop/restart below. No sudoers
 * rule required for this one.
 */
export async function systemdStatus(unit: string): Promise<SystemdStatus> {
  assertValidUnit(unit);
  const result = await runCommand("systemctl", ["is-active", unit], { timeoutMs: STATUS_TIMEOUT_MS }).catch(
    () => null,
  );
  if (!result) return "unknown";
  return mapState(result.stdout.trim());
}

function mapState(state: string): SystemdStatus {
  if (state === "active") return "online";
  if (state === "inactive" || state === "deactivating") return "stopped";
  if (state === "failed") return "errored";
  return "unknown";
}

/**
 * Mutating actions need root. Overlay never grants that itself — the real
 * server needs a narrow, per-unit sudoers rule added by hand (same pattern
 * as the existing security-scan trigger, see docs/DEPLOYMENT.md's "Extern
 * verwaltete Projekte" section). Without a matching rule this just fails
 * with a clear permission error, surfaced to the Overlay UI like any other
 * failed action — it does not silently no-op.
 */
export async function systemdAction(unit: string, action: "start" | "stop" | "restart"): Promise<void> {
  assertValidUnit(unit);
  const result = await runCommand("sudo", ["/usr/bin/systemctl", action, unit], { timeoutMs: ACTION_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    throw new Error(
      `sudo systemctl ${action} ${unit} failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500) || "see docs/DEPLOYMENT.md, section \"Extern verwaltete Projekte\" (sudoers setup)"}`,
    );
  }
}
