import { Router } from "express";
import { config } from "../config.js";
import { getProject, resolveProjectDir } from "../projects/projects.registry.js";
import { describeProcess, restartProcess, startProcess, statusOf, stopProcess } from "../pm2/pm2.service.js";
import { systemdAction, systemdStatus } from "../systemd/systemd.service.js";
import { pm2RootAction, pm2RootStatus } from "../pm2root/pm2root.service.js";
import { runDeployScript } from "../projects/deploy-runner.js";
import { startDeployRun, recordDeployLine, endDeployRun } from "../projects/deploy-log-bus.js";
import { runBackupJob } from "../backup/backup-job.js";
import { runCommand } from "../security/run-tool.js";
import { appendAuditEntry } from "../audit/audit-log.js";

export const automationRouter = Router();

// Same unit the sudoers-gated manual trigger in security.routes.ts starts —
// see that file for why the scan can't just run in-process here.
const SECURITY_SCAN_UNIT = "overlay-security-scan.service";

// Distinguishes actions taken via the token-authenticated automation API
// from ones taken by a logged-in human, in the audit log.
const ACTOR = "automation";

automationRouter.get("/projects/:id/status", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (project.kind === "systemd") {
    res.json({ status: await systemdStatus(project.systemdUnit!) });
    return;
  }
  if (project.kind === "pm2-root") {
    res.json({ status: await pm2RootStatus(project.pm2RootName!) });
    return;
  }
  const desc = await describeProcess(project.pm2Name!);
  res.json({ status: statusOf(desc) });
});

automationRouter.post("/projects/:id/start", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    if (project.kind === "systemd") {
      await systemdAction(project.systemdUnit!, "start");
    } else if (project.kind === "pm2-root") {
      await pm2RootAction(project.pm2RootName!, "start");
    } else {
      const [script, ...args] = project.startScript!.split(" ");
      await startProcess({ name: project.pm2Name!, script, args, cwd: resolveProjectDir(project) });
    }
    await appendAuditEntry({ type: "project_start", actor: ACTOR, detail: project.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "start_failed", message: (err as Error).message });
  }
});

automationRouter.post("/projects/:id/stop", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    if (project.kind === "systemd") {
      await systemdAction(project.systemdUnit!, "stop");
    } else if (project.kind === "pm2-root") {
      await pm2RootAction(project.pm2RootName!, "stop");
    } else {
      await stopProcess(project.pm2Name!);
    }
    await appendAuditEntry({ type: "project_stop", actor: ACTOR, detail: project.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "stop_failed", message: (err as Error).message });
  }
});

automationRouter.post("/projects/:id/restart", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    if (project.kind === "systemd") {
      await systemdAction(project.systemdUnit!, "restart");
    } else if (project.kind === "pm2-root") {
      await pm2RootAction(project.pm2RootName!, "restart");
    } else {
      await restartProcess(project.pm2Name!);
    }
    await appendAuditEntry({ type: "project_restart", actor: ACTOR, detail: project.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "restart_failed", message: (err as Error).message });
  }
});

automationRouter.post("/projects/:id/deploy", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!project.deployScript) {
    res.status(400).json({ error: "no_deploy_script" });
    return;
  }

  startDeployRun(project.id);
  const result = await runDeployScript(project.deployScript, resolveProjectDir(project), config.DEPLOY_TIMEOUT_MS, (line) => {
    recordDeployLine(project.id, { type: "line", stream: line.stream, text: line.text });
  }).catch((err) => ({ stdout: "", stderr: (err as Error).message, exitCode: null }));

  const success = result.exitCode === 0;
  endDeployRun(project.id, { type: "exit", success, exitCode: result.exitCode });
  // deployScript (checked above) is never set on a systemd- or pm2-root-kind
  // project, so pm2Name is guaranteed here even though the type is optional.
  if (success) await restartProcess(project.pm2Name!).catch(() => undefined);

  await appendAuditEntry({
    type: "project_deployed",
    actor: ACTOR,
    detail: `${project.id} (${success ? "ok" : "failed"})`,
  });
  res.json({ ok: success, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
});

automationRouter.post("/backup", async (_req, res) => {
  if (!config.RESTIC_REPOSITORY) {
    res.status(400).json({ error: "not_configured" });
    return;
  }
  runBackupJob().catch((err) => console.error("[automation] backup trigger failed", err));
  await appendAuditEntry({ type: "backup_triggered", actor: ACTOR });
  res.json({ ok: true });
});

automationRouter.post("/scan", async (_req, res) => {
  try {
    const result = await runCommand("sudo", ["systemctl", "start", SECURITY_SCAN_UNIT], { timeoutMs: 15_000 });
    if (result.exitCode !== 0) {
      res.status(500).json({
        error: "trigger_failed",
        message: `sudo systemctl start ${SECURITY_SCAN_UNIT} fehlgeschlagen (exit ${result.exitCode}): ${result.stderr.slice(0, 500) || "siehe docs/DEPLOYMENT.md Abschnitt 7.5 (sudoers-Einrichtung)"}`,
      });
      return;
    }
    await appendAuditEntry({ type: "scan_triggered", actor: ACTOR });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "trigger_failed", message: (err as Error).message });
  }
});
