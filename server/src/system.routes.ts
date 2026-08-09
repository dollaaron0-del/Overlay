import { Router } from "express";
import { getSystemStats } from "./system-stats.js";
import { runCommand } from "./security/run-tool.js";
import { appendAuditEntry } from "./audit/audit-log.js";

export const systemRouter = Router();

systemRouter.get("/stats", async (_req, res) => {
  res.json(await getSystemStats());
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
