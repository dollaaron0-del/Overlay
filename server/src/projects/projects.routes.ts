import { Router } from "express";
import { z } from "zod";
import {
  addProject,
  getProject,
  InvalidDirNameError,
  listAvailableDirs,
  listProjects,
  removeProject,
  resolveProjectDir,
  updateProjectIcon,
} from "./projects.registry.js";
import { describeProcess, restartProcess, statusOf } from "../pm2/pm2.service.js";
import { appendAuditEntry } from "../audit/audit-log.js";
import { runCommand } from "../security/run-tool.js";
import { config } from "../config.js";

export const projectsRouter = Router();

// Must come before "/:id"-shaped routes further down so it isn't swallowed
// as an id param — there is no such route currently, but keep this first
// for that reason if one gets added later.
projectsRouter.get("/available-dirs", async (_req, res) => {
  const dirs = await listAvailableDirs();
  res.json(dirs);
});

projectsRouter.get("/", async (_req, res) => {
  const projects = await listProjects();
  const withStatus = await Promise.all(
    projects.map(async (project) => {
      const desc = await describeProcess(project.pm2Name).catch(() => undefined);
      return { ...project, status: statusOf(desc) };
    }),
  );
  res.json(withStatus);
});

const addProjectSchema = z.object({
  id: z.string().min(1),
  dirName: z.string().min(1),
  pm2Name: z.string().min(1),
  startScript: z.string().min(1),
  deployScript: z.string().optional(),
});

projectsRouter.post("/", async (req, res) => {
  const parsed = addProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  try {
    const project = await addProject({
      ...parsed.data,
      deployScript: parsed.data.deployScript?.trim() || undefined,
    });
    await appendAuditEntry({ type: "project_added", detail: project.id });
    res.status(201).json(project);
  } catch (err) {
    if (err instanceof InvalidDirNameError) {
      res.status(400).json({ error: "invalid_dir_name", message: err.message });
      return;
    }
    res.status(400).json({ error: "add_failed", message: (err as Error).message });
  }
});

projectsRouter.delete("/:id", async (req, res) => {
  const removed = await removeProject(req.params.id);
  if (!removed) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await appendAuditEntry({ type: "project_removed", detail: req.params.id });
  res.json({ ok: true });
});

const updateProjectSchema = z.object({
  // A single emoji can be multiple UTF-16 code units (skin tone/ZWJ
  // sequences), so this caps on visual length loosely rather than exactly —
  // generous enough for any real emoji, tight enough to block someone
  // pasting a paragraph in here.
  icon: z.string().max(16).nullable(),
});

projectsRouter.patch("/:id", async (req, res) => {
  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const updated = await updateProjectIcon(req.params.id, parsed.data.icon);
  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(updated);
});

projectsRouter.post("/:id/deploy", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!project.deployScript) {
    res.status(400).json({ error: "no_deploy_script" });
    return;
  }

  // Run as a shell command (not execFile-style args) so a deploy script can
  // chain steps ("git pull && npm install && npm run build") — this is the
  // project owner's own trusted command, equivalent in trust level to what
  // they could already run themselves in the Claude terminal panel.
  const result = await runCommand("sh", ["-c", project.deployScript], {
    cwd: resolveProjectDir(project),
    timeoutMs: config.DEPLOY_TIMEOUT_MS,
  }).catch((err) => ({ stdout: "", stderr: (err as Error).message, exitCode: null }));

  const success = result.exitCode === 0;
  if (success) {
    // Best-effort: pick up the newly deployed build. Not fatal if the
    // process isn't running yet — the deploy itself already succeeded.
    await restartProcess(project.pm2Name).catch(() => undefined);
  }

  await appendAuditEntry({ type: "project_deployed", detail: `${project.id} (${success ? "ok" : "failed"})` });
  res.json({ ok: success, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
});
