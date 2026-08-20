import { Router } from "express";
import { getProject, resolveProjectDir } from "../projects/projects.registry.js";
import { describeProcess, restartProcess, startProcess, statusOf, stopProcess } from "./pm2.service.js";
import { systemdAction, systemdStatus } from "../systemd/systemd.service.js";
import { pm2RootAction, pm2RootStatus } from "../pm2root/pm2root.service.js";
import { appendAuditEntry } from "../audit/audit-log.js";

export const pm2Router = Router();

pm2Router.get("/:id/status", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (project.kind === "systemd") {
    // No per-process uptime/restart-count/resource numbers from a plain
    // `systemctl is-active` — PM2's richer stats just don't have a systemd
    // equivalent worth shelling out separately for here.
    const status = await systemdStatus(project.systemdUnit!);
    res.json({ status, uptimeMs: null, restarts: null, memoryBytes: null, cpuPercent: null });
    return;
  }
  if (project.kind === "pm2-root") {
    // Same reasoning as the systemd branch above: no per-process
    // uptime/restart/resource numbers worth shelling out separately for.
    const status = await pm2RootStatus(project.pm2RootName!);
    res.json({ status, uptimeMs: null, restarts: null, memoryBytes: null, cpuPercent: null });
    return;
  }
  const desc = await describeProcess(project.pm2Name!);
  const env = desc?.pm2_env as { pm_uptime?: number; restart_time?: number } | undefined;
  const monit = desc?.monit as { memory?: number; cpu?: number } | undefined;
  res.json({
    status: statusOf(desc),
    uptimeMs: env?.pm_uptime ? Date.now() - env.pm_uptime : null,
    restarts: env?.restart_time ?? null,
    memoryBytes: monit?.memory ?? null,
    cpuPercent: monit?.cpu ?? null,
  });
});

pm2Router.post("/:id/start", async (req, res) => {
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
      await startProcess({
        name: project.pm2Name!,
        script,
        args,
        cwd: resolveProjectDir(project),
      });
    }
    await appendAuditEntry({ type: "project_start", detail: project.id });
    res.json({ ok: true });
  } catch (err) {
    // A rejected PM2 callback (e.g. a stale/conflicting process entry) must
    // never bubble up as an unhandled rejection here — Express 4 doesn't
    // catch async handler rejections itself, so without this it would take
    // down the whole server process, not just this one request. Same for a
    // rejected systemd action (e.g. a missing sudoers rule).
    res.status(500).json({ error: "start_failed", message: (err as Error).message });
  }
});

pm2Router.post("/:id/stop", async (req, res) => {
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
    await appendAuditEntry({ type: "project_stop", detail: project.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "stop_failed", message: (err as Error).message });
  }
});

pm2Router.post("/:id/restart", async (req, res) => {
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
    await appendAuditEntry({ type: "project_restart", detail: project.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "restart_failed", message: (err as Error).message });
  }
});
