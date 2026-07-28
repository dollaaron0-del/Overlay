import { Router } from "express";
import { z } from "zod";
import { addProject, InvalidDirNameError, listProjects, removeProject } from "./projects.registry.js";
import { describeProcess, statusOf } from "../pm2/pm2.service.js";

export const projectsRouter = Router();

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
});

projectsRouter.post("/", async (req, res) => {
  const parsed = addProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  try {
    const project = await addProject(parsed.data);
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
  res.json({ ok: true });
});
