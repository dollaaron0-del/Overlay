import { Router } from "express";
import { getSystemStats } from "./system-stats.js";
import { runCommand } from "./security/run-tool.js";
import { appendAuditEntry } from "./audit/audit-log.js";
import {
  parseUpdateUnitStatus,
  describeUpdateFailure,
  UPDATE_UNIT_PROPERTIES,
  UPDATE_JOURNAL_LINES,
} from "./update-status.js";
import { captureCpuHealthSnapshot } from "./cpu-health/cpu-health.js";
import { readCpuHealthHistory } from "./cpu-health/cpu-health-store.js";
import { getNetworkThroughput } from "./network-throughput.js";

export const systemRouter = Router();

systemRouter.get("/stats", async (_req, res) => {
  res.json(await getSystemStats());
});

// Live snapshot (sensors + ping run fresh on every call, ~2s worst case) —
// deliberately not read from the history store so the widget's "current
// values" are never more than a poll interval stale.
systemRouter.get("/health/current", async (_req, res) => {
  res.json(await captureCpuHealthSnapshot());
});

// Live up/down throughput on the physical interfaces, maintained by a
// background sampler (network-throughput.ts) so it's ready without waiting
// on a fresh measurement.
systemRouter.get("/network", (_req, res) => {
  res.json(getNetworkThroughput());
});

const MAX_HISTORY_HOURS = 24 * 31;

systemRouter.get("/health/history", async (req, res) => {
  const requestedHours = Number(req.query.hours);
  const hours = Math.min(Math.max(Number.isFinite(requestedHours) ? requestedHours : 24, 1), MAX_HISTORY_HOURS);
  res.json(await readCpuHealthHistory(hours * 60 * 60 * 1000));
});

// Pulls whatever branch /opt/overlay currently tracks — that branch is
// protected on GitHub (PR review required before anything lands on it, see
// docs/DEPLOYMENT.md section 15), so anything this pulls has already been
// reviewed. Same privilege-separation pattern as the security-scan trigger
// (security/security.routes.ts): this unprivileged web server can't rebuild
// itself (root-owned files, see SECURITY.md) or restart its own PM2 process
// under a different user, so it asks systemd to run the real, root-privileged
// unit via a narrowly scoped sudoers rule that allows nothing except this one
// command.
//
// --no-block is required here, unlike the security-scan trigger: the scan
// never touches this process, but the update unit's last step restarts THIS
// VERY SERVER (pm2 restart overlay). Without --no-block, "systemctl start"
// blocks until the unit finishes — which never happens from this request's
// point of view, because the process handling it gets killed by its own
// restart step first, and the connection just drops instead of returning a
// clean response. --no-block returns as soon as the job is queued, well
// before the restart, so the client gets a real "ok" before the server goes
// down for its own reload.
const OVERLAY_UPDATE_UNIT = "overlay-update.service";
const OVERLAY_UPDATE_TRIGGER_TIMEOUT_MS = 15_000;

systemRouter.post("/update", async (_req, res) => {
  try {
    const result = await runCommand("sudo", ["systemctl", "start", "--no-block", OVERLAY_UPDATE_UNIT], {
      timeoutMs: OVERLAY_UPDATE_TRIGGER_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      res.status(500).json({
        error: "trigger_failed",
        message: `sudo systemctl start --no-block ${OVERLAY_UPDATE_UNIT} fehlgeschlagen (exit ${result.exitCode}): ${result.stderr.slice(0, 500) || "siehe docs/DEPLOYMENT.md Abschnitt 15 (sudoers-Einrichtung)"}`,
      });
      return;
    }
    await appendAuditEntry({ type: "overlay_update_triggered" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "trigger_failed", message: (err as Error).message });
  }
});

// How the triggered run actually went. Needed because "queued" is all the
// trigger above can ever report: an update that dies in its first second
// (a checkout with local changes makes `git merge --ff-only` abort) used to
// be indistinguishable from one still building. Reading a unit's properties
// needs no privileges, so this one goes without sudo.
const OVERLAY_UPDATE_STATUS_TIMEOUT_MS = 5_000;

/**
 * The failing run's own output, so the message can name the actual cause
 * instead of guessing. Filtering by invocation id is what keeps this to the
 * run that just failed rather than mixing in last week's; like `systemctl
 * show` above it needs no privileges. Best-effort: if the journal can't be
 * read (no systemd-journald, restricted access), the caller falls back to the
 * generic hint rather than losing the status entirely.
 */
async function readUpdateJournal(invocationId: string | null): Promise<string | undefined> {
  if (!invocationId) return undefined;
  try {
    const result = await runCommand(
      "journalctl",
      [
        "-u",
        OVERLAY_UPDATE_UNIT,
        `_SYSTEMD_INVOCATION_ID=${invocationId}`,
        "-n",
        String(UPDATE_JOURNAL_LINES),
        "-o",
        "cat",
        "--no-pager",
      ],
      { timeoutMs: OVERLAY_UPDATE_STATUS_TIMEOUT_MS },
    );
    return result.stdout || undefined;
  } catch {
    return undefined;
  }
}

systemRouter.get("/update/status", async (_req, res) => {
  try {
    const result = await runCommand(
      "systemctl",
      ["show", OVERLAY_UPDATE_UNIT, `--property=${UPDATE_UNIT_PROPERTIES}`],
      { timeoutMs: OVERLAY_UPDATE_STATUS_TIMEOUT_MS },
    );
    const status = parseUpdateUnitStatus(result.stdout);
    const journal = status.state === "failed" ? await readUpdateJournal(status.invocationId) : undefined;
    res.json({
      ...status,
      ...(status.state === "failed" ? { message: describeUpdateFailure(status, journal) } : {}),
    });
  } catch (err) {
    // No systemd, unit not installed, systemctl missing: not knowing the state
    // is its own answer — the client falls back to waiting for the restart.
    res.status(503).json({ error: "status_unavailable", message: (err as Error).message });
  }
});
