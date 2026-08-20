import { Router } from "express";
import { z } from "zod";
import {
  addProject,
  getProject,
  InvalidDirNameError,
  InvalidExternalUrlError,
  InvalidPm2RootNameError,
  InvalidSystemdUnitError,
  listAvailableDirs,
  listProjects,
  removeProject,
  resolveHomeSection,
  resolveProjectDir,
  scaffoldProject,
  updateProjectHomeSection,
  updateProjectIcon,
  updateProjectName,
} from "./projects.registry.js";
import { notifyProjectsChanged } from "../ws/status.ws.js";
import { describeProcess, restartProcess, statusOf } from "../pm2/pm2.service.js";
import { systemdStatus } from "../systemd/systemd.service.js";
import { pm2RootStatus } from "../pm2root/pm2root.service.js";
import { appendAuditEntry } from "../audit/audit-log.js";
import { runDeployScript } from "./deploy-runner.js";
import { startDeployRun, recordDeployLine, endDeployRun, isDeployRunning } from "./deploy-log-bus.js";
import { config } from "../config.js";
import { getOrCreateSession } from "../pty/pty.manager.js";

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
      const homeSection = resolveHomeSection(project);
      // One project's status check throwing must never take the rest of the
      // list down with it (see the matching guard in ws/status.ws.ts) — it
      // just degrades that one project's tile to "unknown" instead.
      try {
        if (project.kind === "systemd") {
          return { ...project, homeSection, status: await systemdStatus(project.systemdUnit!) };
        }
        if (project.kind === "pm2-root") {
          return { ...project, homeSection, status: await pm2RootStatus(project.pm2RootName!) };
        }
        const desc = await describeProcess(project.pm2Name!).catch(() => undefined);
        return { ...project, homeSection, status: statusOf(desc) };
      } catch (err) {
        console.error(`[projects] Failed to build status for project "${project.id}":`, err);
        return { ...project, homeSection, status: "unknown" as const };
      }
    }),
  );
  res.json(withStatus);
});

const addPm2ProjectSchema = z.object({
  kind: z.literal("pm2").optional(),
  id: z.string().min(1),
  dirName: z.string().min(1),
  pm2Name: z.string().min(1),
  startScript: z.string().min(1),
  deployScript: z.string().optional(),
});

// A systemd-kind project's dirName is client-supplied here as a suggestion —
// the registry treats it as a placeholder it creates/owns itself (see
// ensureStubDir in projects.registry.ts), not a real APPS_ROOT directory
// the client is claiming already exists.
const addSystemdProjectSchema = z.object({
  kind: z.literal("systemd"),
  id: z.string().min(1),
  dirName: z.string().min(1),
  systemdUnit: z.string().min(1),
  externalUrl: z.string().min(1),
});

// A pm2-root-kind project's dirName is client-supplied here as a suggestion,
// same reasoning as addSystemdProjectSchema above — the process itself lives
// in a different Linux user's PM2 daemon, reached via sudo, not under
// APPS_ROOT.
const addPm2RootProjectSchema = z.object({
  kind: z.literal("pm2-root"),
  id: z.string().min(1),
  dirName: z.string().min(1),
  pm2RootName: z.string().min(1),
  externalUrl: z.string().min(1),
});

const addProjectSchema = z.union([addPm2ProjectSchema, addSystemdProjectSchema, addPm2RootProjectSchema]);

projectsRouter.post("/", async (req, res) => {
  const parsed = addProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  try {
    const project =
      parsed.data.kind === "systemd" || parsed.data.kind === "pm2-root"
        ? await addProject(parsed.data)
        : await addProject({ ...parsed.data, deployScript: parsed.data.deployScript?.trim() || undefined });
    await appendAuditEntry({ type: "project_added", detail: project.id });
    notifyProjectsChanged();
    res.status(201).json(project);
  } catch (err) {
    if (err instanceof InvalidDirNameError) {
      res.status(400).json({ error: "invalid_dir_name", message: err.message });
      return;
    }
    if (err instanceof InvalidSystemdUnitError) {
      res.status(400).json({ error: "invalid_systemd_unit", message: err.message });
      return;
    }
    if (err instanceof InvalidPm2RootNameError) {
      res.status(400).json({ error: "invalid_pm2_root_name", message: err.message });
      return;
    }
    if (err instanceof InvalidExternalUrlError) {
      res.status(400).json({ error: "invalid_external_url", message: err.message });
      return;
    }
    res.status(400).json({ error: "add_failed", message: (err as Error).message });
  }
});

const scaffoldProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  initialPrompt: z.string().min(1),
});

// Creates a fresh, empty PM2-kind project and immediately hands the given
// prompt to its (freshly spawned) Claude terminal session — the "umsetzen"
// half of Emmy's "Ergebnis in neues Projekt umsetzen" flow, where the caller
// has no existing project to target yet.
projectsRouter.post("/scaffold", async (req, res) => {
  const parsed = scaffoldProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const project = await scaffoldProject(parsed.data.name);
  await appendAuditEntry({ type: "project_added", detail: `${project.id} (scaffolded)` });
  notifyProjectsChanged();
  const session = getOrCreateSession(project);
  session.paste(parsed.data.initialPrompt);
  res.status(201).json(project);
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
  icon: z.string().max(16).nullable().optional(),
  name: z.string().trim().min(1).max(100).nullable().optional(),
  homeSection: z.enum(["dashboard", "terminal"]).nullable().optional(),
});

projectsRouter.patch("/:id", async (req, res) => {
  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  if (parsed.data.icon === undefined && parsed.data.name === undefined && parsed.data.homeSection === undefined) {
    res.status(400).json({ error: "invalid_request", message: "Nothing to update" });
    return;
  }

  let updated = await getProject(req.params.id);
  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (parsed.data.icon !== undefined) updated = await updateProjectIcon(req.params.id, parsed.data.icon);
  if (updated && parsed.data.name !== undefined) updated = await updateProjectName(req.params.id, parsed.data.name);
  if (updated && parsed.data.homeSection !== undefined) {
    // The Dashboards section always links a tile straight to its
    // externalUrl — only kind "systemd"/"pm2-root" projects have one, so a
    // plain pm2 project can't be moved there (it would be an unreachable
    // dashboard tile with nowhere to link).
    if (parsed.data.homeSection === "dashboard" && updated.kind !== "systemd" && updated.kind !== "pm2-root") {
      res.status(400).json({
        error: "dashboard_requires_external_url",
        message: "Nur extern verlinkte Projekte (systemd/pm2-root) können ins Dashboard-Segment verschoben werden.",
      });
      return;
    }
    updated = await updateProjectHomeSection(req.params.id, parsed.data.homeSection);
  }
  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ...updated, homeSection: resolveHomeSection(updated) });
});

const terminalInputSchema = z.object({
  text: z.string().min(1),
});

// Writes text straight into the project's persistent Claude terminal
// session (spawning one if it isn't running yet) and submits it, so content
// picked elsewhere in Overlay (e.g. an Emmy message) can be handed to that
// project's terminal without the browser needing its own pty connection.
projectsRouter.post("/:id/terminal-input", async (req, res) => {
  const parsed = terminalInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // A systemd- or pm2-root-kind project's dirName is an empty Overlay-owned
  // placeholder, not the app's real code — a terminal there would be
  // pointless, and the frontend never shows this tab for either kind, so
  // this guard only ever fires for a stale/hand-crafted request.
  if (project.kind === "systemd" || project.kind === "pm2-root") {
    res.status(400).json({ error: "not_supported_for_kind" });
    return;
  }
  const session = getOrCreateSession(project);
  session.paste(parsed.data.text);
  res.json({ ok: true });
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
  if (isDeployRunning(project.id)) {
    res.status(409).json({ error: "deploy_already_running" });
    return;
  }

  // Run as a shell command (not execFile-style args) so a deploy script can
  // chain steps ("git pull && npm install && npm run build") — this is the
  // project owner's own trusted command, equivalent in trust level to what
  // they could already run themselves in the Claude terminal panel. Streamed
  // live (see deploy-runner.ts) to /ws/deploy/:id as it runs — there's no
  // known step count for an arbitrary script, so live output is the honest
  // stand-in for a progress bar here.
  startDeployRun(project.id);
  const result = await runDeployScript(project.deployScript, resolveProjectDir(project), config.DEPLOY_TIMEOUT_MS, (line) => {
    recordDeployLine(project.id, { type: "line", stream: line.stream, text: line.text });
  }).catch((err) => ({ stdout: "", stderr: (err as Error).message, exitCode: null }));

  const success = result.exitCode === 0;
  endDeployRun(project.id, { type: "exit", success, exitCode: result.exitCode });

  if (success) {
    // Best-effort: pick up the newly deployed build. Not fatal if the
    // process isn't running yet — the deploy itself already succeeded.
    // deployScript is never set on a systemd- or pm2-root-kind project, so
    // pm2Name is guaranteed here even though the type is optional.
    await restartProcess(project.pm2Name!).catch(() => undefined);
  }

  await appendAuditEntry({ type: "project_deployed", detail: `${project.id} (${success ? "ok" : "failed"})` });
  res.json({ ok: success, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
});
