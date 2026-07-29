import { Router } from "express";
import { getProject, resolveProjectDir } from "../projects/projects.registry.js";
import { describeProcess, restartProcess, startProcess, statusOf, stopProcess } from "./pm2.service.js";
import { appendAuditEntry } from "../audit/audit-log.js";

export const pm2Router = Router();

pm2Router.get("/:id/status", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const desc = await describeProcess(project.pm2Name);
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
    const [script, ...args] = project.startScript.split(" ");
    await startProcess({
      name: project.pm2Name,
      script,
      args,
      cwd: resolveProjectDir(project),
    });
    await appendAuditEntry({ type: "project_start", detail: project.id });
    res.json({ ok: true });
  } catch (err) {
    // A rejected PM2 callback (e.g. a stale/conflicting process entry) must
    // never bubble up as an unhandled rejection here — Express 4 doesn't
    // catch async handler rejections itself, so without this it would take
    // down the whole server process, not just this one request.
    res.status(500).json({ error: "pm2_error", message: (err as Error).message });
  }
});

pm2Router.post("/:id/stop", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    await stopProcess(project.pm2Name);
    await appendAuditEntry({ type: "project_stop", detail: project.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "pm2_error", message: (err as Error).message });
  }
});

pm2Router.post("/:id/restart", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    await restartProcess(project.pm2Name);
    await appendAuditEntry({ type: "project_restart", detail: project.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "pm2_error", message: (err as Error).message });
  }
});
